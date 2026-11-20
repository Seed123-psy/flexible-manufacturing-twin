import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getMaterialTravel, rejectMaterialPose } from '../src/layout.js';
import { createRejectPlan, rejectFrame } from '../src/reject-flow.js';
import { REJECT_CARGO_SLOTS, REJECT_LIFTS, REJECT_RACK_SLOTS, REJECT_TRUCK_PARK } from '../src/reject-layout.js';
import { createSimulation, PRESETS, seekSimulation } from '../src/simulation.js';

test('reject lift motion follows both conveyors and keeps carriers level on each vertical leg', () => {
  for (const qc of ['quality', 'quality2']) {
    const { steps, length } = getMaterialTravel(qc, 'reject');
    const lifts = steps.filter(({ vertical }) => vertical);
    assert.equal(lifts.length, 2);
    for (const [index, { offset, distance, start, end }] of lifts.entries()) {
      const { position, pitch } = rejectMaterialPose(qc, (offset + distance / 2) / length);
      assert.equal(position[0], REJECT_LIFTS[index][0]);
      assert.equal(position[2], REJECT_LIFTS[index][2]);
      assert.ok(Math.abs(position[1] - (start[1] + end[1]) / 2) < 1e-9);
      assert.equal(pitch, 0);
      for (const boundary of [offset, offset + distance]) {
        const before = rejectMaterialPose(qc, (boundary - 1e-7) / length);
        const after = rejectMaterialPose(qc, (boundary + 1e-7) / length);
        const delta = after.yaw - before.yaw;
        assert.ok(Math.abs(Math.atan2(Math.sin(delta), Math.cos(delta))) < 1e-5, `${qc} lift ${index + 1} snaps at handoff`);
      }
    }
  }
});

for (const [quantity, expected] of [[1, 0], [20, 1], [2000, 100], [5000, 250]]) {
  test(`${quantity} units: isolated reject loading, offsite handover, return and final accounting`, () => {
    const sim = createSimulation({ ...PRESETS.batch, quantity });
    const { units, jobs, trips } = sim.timeline.rejectPlan;
    assert.equal(units.length, expected);
    assert.equal(trips.length, Math.ceil(expected / REJECT_CARGO_SLOTS.length));
    assert.deepEqual(trips.flatMap(({ units }) => units), units.map(({ unit }) => unit));
    assert.equal(new Set(trips.flatMap(({ units }) => units)).size, expected);
    const times = new Set([0, sim.duration]);
    for (const [index, job] of jobs.entries()) {
      if (index) assert.ok(jobs[index - 1].end <= job.start + 1e-7);
      times.add(job.pickup);
      times.add(job.drop);
      times.add((job.pickup + job.drop) / 2);
    }
    for (const [index, trip] of trips.entries()) {
      if (index) assert.ok(trips[index - 1].returned <= trip.depart);
      assert.equal(trip.units.length, index < trips.length - 1 ? REJECT_CARGO_SLOTS.length : expected % REJECT_CARGO_SLOTS.length || REJECT_CARGO_SLOTS.length);
      const loaded = units.filter(({ handover }) => handover === trip.handover);
      assert.equal(loaded.length, trip.units.length);
      assert.ok(loaded.every(({ loading }) => loading.end < trip.depart && (!index || loading.start >= trips[index - 1].returned)));
      for (const time of [trip.depart, trip.handover - 1e-6, trip.handover, trip.returnStart, trip.returned]) times.add(time);
    }
    for (const { release, arrival, slot, putaway, loading } of units) {
      assert.ok(release < arrival && arrival <= putaway.start && putaway.end <= loading.start);
      assert.ok(slot >= 0 && slot < REJECT_RACK_SLOTS.length);
      times.add(release);
      times.add(arrival);
      // Rack and cargo occupancy can only change at these events or handover.
      times.add(putaway.drop);
      times.add(loading.pickup);
      times.add(loading.drop);
    }
    let peakRack = 0;
    let peakCargo = 0;
    for (const time of [...times].sort((a, b) => a - b)) {
      seekSimulation(sim, time);
      const { rack, cargo, carrying, intake, job, truck, truckVisible, truckX } = sim.logistics.rejects;
      const { inbound, reworkQueue, loading, cleared, rejected } = sim.quality;
      peakRack = Math.max(peakRack, rack.length);
      peakCargo = Math.max(peakCargo, cargo.length);
      assert.equal(reworkQueue, rack.length);
      assert.ok(reworkQueue <= REJECT_RACK_SLOTS.length);
      assert.ok(cargo.length <= REJECT_CARGO_SLOTS.length);
      assert.equal(new Set(rack.map(({ slot }) => slot)).size, rack.length);
      assert.equal(new Set(cargo.map(({ truckSlot }) => truckSlot)).size, cargo.length);
      const visible = [...rack.map(({ unit }) => unit), ...cargo.map(({ unit }) => unit),
        ...[carrying, intake?.unit].filter(Boolean), ...sim.transfers.filter(({ kind }) => kind === 'reject').map(({ unit }) => unit)];
      assert.equal(new Set(visible).size, visible.length);
      assert.ok(inbound >= 0 && visible.length <= rejected - cleared);
      assert.equal(inbound + reworkQueue + cargo.length + loading + cleared, rejected);
      if (job?.kind === 'load') {
        assert.equal(truck, 'docked');
        assert.equal(truckX, REJECT_TRUCK_PARK[0]);
      }
      if (truck === 'offsite' || truck === 'returning') assert.equal(cargo.length, 0);
      if (truck === 'offsite') assert.equal(truckVisible, false);
    }
    assert.equal(sim.shipped, quantity - expected);
    assert.equal(sim.quality.cleared, expected);
    assert.equal(sim.quality.reworkQueue, 0);
    assert.equal(sim.quality.truck, 'docked');
    if (quantity === 2000) {
      assert.equal(peakRack, 1);
      assert.equal(peakCargo, 12);
      assert.equal(trips.length, 9);
      assert.equal(trips.at(-1).units.length, 4);
      assert.ok(trips[0].handover < sim.timeline.lastDeparture);
    }
    seekSimulation(sim, 0);
    assert.equal(sim.quality.cleared, 0);
    assert.equal(sim.quality.trips, 0);
    if (expected) {
      seekSimulation(sim, trips[0].handover);
      assert.equal(sim.quality.cleared, trips[0].units.length);
    }
  });
}

test('surge reserves rack addresses before releasing QC and applies backpressure', () => {
  const plan = createRejectPlan();
  for (let unit = 1; unit <= 60; unit++) plan.receive(unit, 'quality', 1, 0.10);
  plan.finish(1);
  const history = REJECT_RACK_SLOTS.map(() => []);
  let delayedByRack = 0;
  for (const [index, { slot, release, loading }] of plan.units.entries()) {
    const previous = history[slot].at(-1);
    if (previous) {
      assert.ok(previous <= release);
      if (release > plan.units[index - 1].putaway.end + 1e-7) delayedByRack++;
    }
    history[slot].push(loading.clear);
  }
  assert.ok(delayedByRack > 0);
  assert.equal(plan.trips.flatMap(({ units }) => units).length, 60);
  assert.equal(rejectFrame(plan, plan.trips.at(-1).returned, 60).rack.length, 0);
});
