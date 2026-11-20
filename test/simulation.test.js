import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FILAMENT_COLORS, FILAMENT_SPOOL_GRAMS, FILAMENT_STOCK_PER_COLOR, filamentExchangeAt } from '../src/filament-exchange.js';
import { createPatrolTraffic, planPatrol } from '../src/patrol-traffic.js';
import { warehouseCapacity, warehouseWaveSize } from '../src/logistics-layout.js';
import { createSimulation, PRESETS, seekSimulation } from '../src/simulation.js';

const batch = createSimulation(PRESETS.batch);

function filamentSnapshot(time) {
  seekSimulation(batch, time);
  return structuredClone(batch.filament);
}

test('RGB exchanges consume physical reels, account for recovery, and replay deterministically', () => {
  const { filamentDeliveries } = batch.timeline;
  const initial = filamentSnapshot(0);
  const initialMass = initial.warehouseStock * FILAMENT_SPOOL_GRAMS + Object.values(initial.printers).flat().reduce((a, b) => a + b, 0);
  const feedSnapshots = [];
  for (const job of filamentDeliveries) {
    const feedTime = job.arrival + (job.loaded - job.arrival) * 0.78;
    for (const time of [job.start, job.pickup, job.arrival, feedTime, job.loaded, job.returned, job.end]) {
      const state = filamentSnapshot(time);
      const { delivery, printers, stockByColor } = state;
      const newReel = ['delivery', 'install'].includes(delivery?.phase) ? FILAMENT_SPOOL_GRAMS : 0;
      const oldReel = ['return', 'recover'].includes(delivery?.phase) ? delivery.oldGrams : 0;
      const loaded = Object.values(printers).flat().reduce((a, b) => a + b, 0);
      const mass = state.warehouseStock * FILAMENT_SPOOL_GRAMS + loaded + state.usedGrams + state.recoveredGrams + newReel + oldReel;
      assert.ok(Math.abs(mass - initialMass) < 1e-6, `material mass changed at ${time}`);
      assert.deepEqual(stockByColor, FILAMENT_COLORS.map(({ index }) => FILAMENT_STOCK_PER_COLOR -
        filamentDeliveries.filter((entry) => entry.slot === index && entry.pickup <= time).length));
      if (time === feedTime) {
        assert.equal(delivery.slot, job.slot);
        assert.equal(batch.stations[job.station].motion, 'load-filament');
        const pose = filamentExchangeAt(delivery.phaseProgress, job.slot);
        assert.ok(pose.freshBay && pose.feed > 0 && pose.feed < 1);
        feedSnapshots.push([time, state]);
      }
    }
  }
  assert.deepEqual([...new Set(filamentDeliveries.map(({ slot }) => slot))].sort(), [0, 1, 2]);
  for (const [time, state] of feedSnapshots.reverse()) assert.deepEqual(filamentSnapshot(time), state);
});

test('warehouse starts shipping before full without overlapping slot ownership', () => {
  const { warehouseUnits, rejectedUnits, phases, mobile } = batch.timeline;
  const firstDeparture = warehouseUnits[0].departure;
  const receivedByDeparture = warehouseUnits.filter((record) => record.putawayAt <= firstDeparture).length;
  assert.ok(receivedByDeparture >= warehouseWaveSize && receivedByDeparture < warehouseCapacity);
  const inbound = phases.sort.filter(({ motion }) => ['approach-in', 'dock-in', 'drive-in', 'rack-dock', 'return-in'].includes(motion));
  const outbound = phases.dispatch.filter(({ motion }) => !['depart', 'truck-return'].includes(motion));
  assert.ok(inbound.some((a) => outbound.some((b) => Math.max(a.start, b.start) < Math.min(a.end, b.end))));
  const events = warehouseUnits.flatMap(({ slot, putawayAt, pickStart }) => [[putawayAt, 1, slot], [pickStart, -1, slot]]);
  events.sort(([a, changeA], [b, changeB]) => a - b || changeA - changeB);
  const occupied = new Set();
  for (const [, change, slot] of events) {
    if (change > 0) {
      assert.ok(!occupied.has(slot));
      occupied.add(slot);
    } else {
      assert.ok(occupied.delete(slot));
    }
  }
  assert.equal(occupied.size, 0);
  assert.ok(mobile.inspection.laps.length > 0);
  assert.ok(mobile.inspection.laps.every(({ meta }) => meta.events.length === 25));
  seekSimulation(batch, batch.duration);
  assert.equal(batch.shipped, warehouseUnits.length);
  assert.equal(batch.reworkQueue, 0);
  assert.equal(batch.quality.cleared, rejectedUnits.length);
  assert.equal(batch.shipped + batch.quality.cleared, batch.order.quantity);
});

test('carton deliveries and robot handoffs reserve the north service lane', () => {
  const intervals = batch.timeline.mobile.intervals;
  const carton = intervals.filter(({ fleet }) => fleet === 'packagingRobot');
  for (const kind of ['work', 'handoff-in', 'handoff-out']) {
    assert.ok(carton.some((interval) => interval.kind === kind), `batch does not exercise ${kind}`);
    assert.ok(carton.filter((interval) => interval.kind === kind).every(({ resources }) => resources.includes('zone:north-service')), `unreserved carton ${kind} route`);
  }
  assert.ok(carton.every(({ kind }) => kind !== 'return' && kind !== 'exit'), 'local docks need no central charger transit');
  const bookings = intervals.filter(({ resources }) => resources.includes('zone:north-service')).sort((a, b) => a.start - b.start);
  for (let i = 1; i < bookings.length; i++) {
    assert.ok(bookings[i - 1].end <= bookings[i].start + 1e-7, 'double booking in the north service lane');
  }
});

test('patrol waits before a swept crossing and only for the blocked part of its route', () => {
  const traffic = createPatrolTraffic();
  traffic.sweep([4, 0, -2], [4, 0, 2], 0.5, 3, 6);
  const base = { segments: [{ kind: 'travel', from: [0, 0, 0], to: [8, 0, 0], start: 0, end: 8, length: 8 }] };
  const fit = planPatrol(base, traffic.zones(), 0.5);
  const blocked = fit(0);
  assert.equal(blocked.segments[0].kind, 'yield');
  assert.deepEqual(blocked.segments[0].from, blocked.segments[0].to);
  assert.ok(Math.abs(blocked.segments[0].end - 3) < 0.01);
  assert.equal(fit(7).segments[0].kind, 'travel');
});
