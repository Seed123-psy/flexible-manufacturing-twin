import assert from 'node:assert/strict';
import test from 'node:test';
import { EQUIPMENT_CATALOG, getEquipmentHistory, getEquipmentTelemetry } from '../src/equipment-telemetry.js';
import { FILAMENT_COLORS } from '../src/filament-exchange.js';
import { createSimulation, PRESETS, seekSimulation } from '../src/simulation.js';

const midpoint = (start, end) => (start + end) / 2;
const assetAt = (sim, time, id) => {
  const asset = getEquipmentTelemetry(sim, time).assets.find((record) => record.id === id);
  assert.ok(asset, `missing ${id}`);
  return asset;
};

const sim = createSimulation(PRESETS.batch);

test('equipment IDs are unique and each scheduled mobile fleet member has a battery record', () => {
  const { assets } = getEquipmentTelemetry(sim);
  assert.deepEqual(assets.map(({ id }) => id), EQUIPMENT_CATALOG.map(({ id }) => id));
  assert.equal(new Set(assets.map(({ id }) => id)).size, assets.length);
  const batteryIds = [...Object.values(sim.battery.fleets).flatMap(({ primary, backup }) => [primary.id, backup.id]), 'MAT-01'];
  assert.deepEqual(assets.filter(({ power }) => power.kind === 'battery').map(({ id }) => id).sort(), batteryIds.sort());
  assert.equal(assets.filter(({ type }) => type === 'printer').length, 6);
  for (const id of ['PR-01', 'AMS-06', 'QC-01', 'BX-02', 'RB-02', 'WH-01', 'RJ-LIFT-01', 'RJ-LIFT-02', 'QA-OUT', 'CV-REJECT-SKY', 'DOOR-A', 'DOOR-B', 'DOOR-WH']) {
    const { power } = assetAt(sim, 0, id);
    assert.equal(power.kind, 'mains');
    assert.equal(power.batteryPercent, null);
  }
  for (const id of ['TRUCK-OUT-01', 'TRUCK-RJ-01']) {
    const { power } = assetAt(sim, 0, id);
    assert.equal(power.kind, 'unmodeled');
    assert.equal(power.batteryPercent, null);
  }
});

test('charging history follows the individual AGVs and BOX robots and their real charging locations', () => {
  for (const [fleetId, role] of [['inboundAgv', 'primary'], ['packagingRobot', 'primary'], ['packagingRobot', 'backup']]) {
    const charge = sim.timeline.mobile.intervals.find((entry) => entry.fleet === fleetId && entry.role === role && entry.kind === 'charging');
    assert.ok(charge);
    const time = midpoint(charge.start, charge.end);
    const frame = getEquipmentTelemetry(sim, time);
    const actual = frame.assets.find(({ id }) => id === charge.agent);
    const peer = frame.assets.find((record) => record.fleetId === fleetId && record.id !== charge.agent);
    const expected = sim.timeline.mobile.snapshot(time).fleets[fleetId];
    assert.equal(actual.state, 'charging');
    assert.equal(actual.power.charging, true);
    assert.equal(actual.power.batteryPercent, expected[role].battery);
    assert.equal(peer.power.batteryPercent, expected[peer.role].battery);
    assert.deepEqual(assetAt(sim, time, actual.details.chargerId).details.chargingRobotIds, [actual.id]);
    const history = getEquipmentHistory(sim, time, actual.id, { limit: 2, intervalSeconds: 1 });
    assert.ok(history[0].power.batteryPercent < history[1].power.batteryPercent);
  }
});

test('all printers expose separate RGB inventories with replayable supply and printing tasks', () => {
  const printerCatalog = EQUIPMENT_CATALOG.filter(({ type }) => type === 'printer');
  for (const { id, stationId } of printerCatalog) {
    const phase = sim.timeline.phases[stationId].find(({ motion }) => motion === 'print');
    assert.ok(phase);
    const printing = assetAt(sim, midpoint(phase.start, phase.end), id);
    assert.equal(printing.task.unit, phase.unit);
    assert.equal(printing.task.motion, 'print');
    assert.equal(printing.task.startedAt, phase.start);
    assert.deepEqual(printing.printer.colors.map(({ id }) => id), ['red', 'green', 'blue']);
    assert.ok(printing.printer.colors.every(({ remainingGrams, capacityGrams }) => remainingGrams === capacityGrams));
    assert.ok(assetAt(sim, phase.end, id).printer.colors.every(({ remainingGrams, capacityGrams }) => remainingGrams < capacityGrams));
  }
  const job = sim.timeline.filamentDeliveries[0];
  const printerId = printerCatalog.find(({ stationId }) => stationId === job.station).id;
  const other = printerCatalog.find(({ id }) => id !== printerId).id;
  const installingAt = midpoint(job.arrival, job.loaded);
  const receiving = assetAt(sim, installingAt, printerId);
  assert.equal(receiving.task.motion, 'load-filament');
  assert.equal(receiving.printer.supply.phase, 'install');
  assert.equal(receiving.printer.supply.colorId, FILAMENT_COLORS[job.slot].id);
  assert.equal(receiving.printer.supply.vehicleId, 'MAT-01');
  assert.equal(assetAt(sim, installingAt, other).printer.supply.colorId, null);
  assert.equal(assetAt(sim, installingAt, `AMS-${printerId.slice(-2)}`).state, 'working');
  const replenished = assetAt(sim, job.loaded, printerId).printer.colors[job.slot];
  assert.equal(replenished.remainingGrams, replenished.capacityGrams);
  const carrying = assetAt(sim, midpoint(job.pickup, job.arrival), 'MAT-01');
  const returnedAt = sim.timeline.filamentDeliveries.at(-1).end;
  const charging = assetAt(sim, returnedAt, 'MAT-01');
  assert.equal(carrying.task.destinationId, job.station);
  assert.equal(carrying.power.charging, false);
  assert.equal(charging.power.charging, true);
  assert.equal(assetAt(sim, returnedAt, 'CH-MAT-01').state, 'working');
});

test('truck, lift, sorter, and stacker records use distinct scheduled work', () => {
  const dispatch = sim.timeline.phases.dispatch.find(({ motion }) => motion === 'depart');
  const stacker = sim.timeline.phases.storage[0];
  const sort = sim.timeline.phases.sort.find(({ motion }) => motion === 'divert');
  assert.equal(assetAt(sim, midpoint(dispatch.start, dispatch.end), 'TRUCK-OUT-01').state, 'departing');
  assert.equal(assetAt(sim, sim.timeline.lastDeparture, 'TRUCK-OUT-01').state, 'offsite');
  assert.equal(assetAt(sim, midpoint(stacker.start, stacker.end), 'WH-01').task.motion, 'putaway');
  assert.equal(assetAt(sim, midpoint(sort.start, sort.end), 'SR-01').task.motion, 'divert');
  const [trip] = sim.timeline.rejectPlan.trips;
  const [job] = sim.timeline.rejectPlan.jobs;
  assert.equal(assetAt(sim, trip.depart, 'TRUCK-RJ-01').state, 'departing');
  assert.equal(assetAt(sim, trip.handover, 'TRUCK-RJ-01').state, 'offsite');
  assert.equal(assetAt(sim, trip.returnStart, 'TRUCK-RJ-01').state, 'returning');
  assert.equal(assetAt(sim, trip.returned, 'TRUCK-RJ-01').state, 'docked');
  assert.equal(assetAt(sim, midpoint(job.start, job.end), 'QA-OUT').task.unit, job.unit);
  assert.ok(getEquipmentHistory(sim, trip.depart, 'RJ-LIFT-01', { limit: 120, intervalSeconds: 0.6 })
    .some(({ task }) => task?.motion === 'lift'));
});

test('replay history is bounded, ordered, playhead-inclusive and independent of seek order', () => {
  const replay = createSimulation(PRESETS.batch);
  const time = replay.timeline.filamentDeliveries[0].end + 1;
  const current = getEquipmentTelemetry(replay, time);
  const history = getEquipmentHistory(replay, time, 'MAT-01', { limit: 10_000, intervalSeconds: 0.5 });
  assert.equal(history.length, 120);
  assert.ok(history.every((record, i) => i === 0 || record.time > history[i - 1].time));
  assert.deepEqual(history.at(-1), current.assets.find(({ id }) => id === 'MAT-01'));
  assert.equal(replay.time, 0);
  seekSimulation(replay, replay.duration);
  const { time: liveTime, milestoneIndex, events, activeTransfers, stations } = replay;
  const previousEvents = events.slice();
  assert.deepEqual(getEquipmentTelemetry(replay, time), current);
  assert.deepEqual(getEquipmentHistory(replay, time, 'MAT-01', { limit: 10_000, intervalSeconds: 0.5 }), history);
  assert.equal(replay.time, liveTime);
  assert.equal(replay.milestoneIndex, milestoneIndex);
  assert.strictEqual(replay.activeTransfers, activeTransfers);
  assert.strictEqual(replay.stations, stations);
  assert.deepEqual(replay.events, previousEvents);
  assert.deepEqual(getEquipmentHistory(replay, 2, 'PR-01').map((entry) => entry.time), [0, 2]);
  assert.deepEqual(getEquipmentHistory(replay, -2, 'PR-01').map((entry) => entry.time), [0]);
  assert.deepEqual(getEquipmentHistory(replay, 2, 'unknown'), []);
  assert.deepEqual(getEquipmentHistory(replay, 2, 'PR-01', { limit: 0 }), []);
  assert.throws(() => getEquipmentHistory(replay, 2, 'PR-01', { intervalSeconds: 0 }), RangeError);
});

test('each thermal door reports opening independently as its material approaches', () => {
  const gates = [['DOOR-A', 'quality'], ['DOOR-B', 'quality2'], ['DOOR-WH', 'sort']];
  for (const [id, destinationId] of gates) {
    const transfer = sim.timeline.transfers.find(({ to }) => to === destinationId);
    assert.ok(transfer);
    assert.equal(assetAt(sim, 0, id).state, 'closed');
    const samples = Array.from({ length: 16 }, (_, i) =>
      assetAt(sim, transfer.start + (transfer.end - transfer.start) * i / 16, id));
    const open = samples.find(({ state }) => state === 'open');
    assert.ok(open, `${id} stayed closed for ${destinationId}`);
    assert.equal(open.task.unit, transfer.unit);
    assert.equal(open.task.destinationId, destinationId);
  }
});
