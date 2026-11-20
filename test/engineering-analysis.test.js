import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildEngineeringAnalysis, calculateEngineeringTakt } from '../src/engineering-analysis.js';
import { createSimulation, DEFAULT_ORDER, PRESETS, seekSimulation } from '../src/simulation.js';

const close = (actual, expected, epsilon = 1e-8) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`);

test('target takt requires explicit, valid shift inputs', () => {
  assert.equal(calculateEngineeringTakt('', '', 120), null);
  assert.equal(calculateEngineeringTakt(0, 10, 120), null);
  assert.equal(calculateEngineeringTakt(480, 0, 120), null);
  assert.equal(calculateEngineeringTakt(480, 10.5, 120), null);
  assert.equal(calculateEngineeringTakt(Number.NaN, 10, 120), null);
});

test('target takt compares shift demand to whole-order modeled cadence transparently', () => {
  const result = calculateEngineeringTakt(480, 960, 120);
  assert.equal(result.netShiftSeconds, 28800);
  assert.equal(result.demandPerShift, 960);
  close(result.taktSeconds, 30);
  close(result.ratePerHour, 120);
  close(result.modeledSecondsPerGood, 30);
  close(result.gapSeconds, 0);
  const slower = calculateEngineeringTakt(480, 1200, 120);
  close(slower.taktSeconds, 24);
  close(slower.gapSeconds, 6);
  const noRate = calculateEngineeringTakt(480, 960, null);
  assert.equal(noRate.modeledSecondsPerGood, null);
  assert.equal(noRate.gapSeconds, null);
});

// Shared batch fixture exercises both lines, rejects, multiple waves, and both supply systems.
const batch = createSimulation({ ...PRESETS.batch, text: '加急批次', color: '#55c8ff', width: 74, depth: 66 });
const report = buildEngineeringAnalysis(batch);

test('material data uses actual fitted dimensions, simulated RGB consumption, and nominal packaging', () => {
  const m = report.materials;
  assert.equal(report.order.text, '加急批次');
  assert.match(m.configurationRef, /74×66×100\/55C8FF$/);
  assert.equal(m.procurementSku, null);
  assert.equal(m.finish, '冰川蓝');
  assert.deepEqual(m.requestedMm, { width: 74, depth: 66, height: 100 });
  assert.deepEqual(m.productMm, batch.order.productSize);
  assert.ok(m.productMm.height < m.requestedMm.height);
  assert.deepEqual(m.cartonMm, batch.order.box);
  assert.equal(m.unitsPerCarton, 1);
  close(m.colors.reduce((sum, row) => sum + row.gramsPerUnit, 0), batch.order.filamentGrams);
  close(m.colors.reduce((sum, row) => sum + row.orderGrams, 0), m.orderFilamentGrams);
  close(m.orderFilamentGrams, batch.order.filamentGrams * batch.order.quantity);
  assert.equal(m.spoolExchanges, batch.timeline.filamentDeliveries.length);
  assert.equal(m.cartonRefills, batch.timeline.cartonDeliveries.length);
  assert.equal(m.lineSideBlankCapacity, batch.packaging.capacity);
  assert.equal(m.unknown.cartonGrade, null);
  assert.equal(m.unknown.filamentDiameterMm, null);
});

test('load envelope distinguishes actual wave and inventory peaks from modeled capacity', () => {
  const { warehouse, shipment, reject, cartonBodyScene, unknown } = report.envelope;
  assert.equal(warehouse.slots, batch.warehouse.capacity);
  assert.equal(warehouse.columns * warehouse.levels, warehouse.slots);
  assert.equal(warehouse.peakOnHand, 6);
  close(warehouse.columnPitchScene, 0.94);
  close(warehouse.levelPitchScene, 0.62);
  assert.equal(shipment.cartonsPerWave, 6);
  assert.equal(shipment.peakCartonsPerWave, 6);
  assert.equal(shipment.cartonsPerAgvTrip, 1);
  assert.equal(shipment.loadingLanes, batch.dispatch.lanes);
  assert.equal(reject.slots, batch.quality.rackCapacity);
  assert.equal(reject.truckSlots, batch.quality.truckCapacity);
  assert.ok(reject.trips > 0);
  assert.ok(cartonBodyScene.width > 0 && cartonBodyScene.width < 1);
  assert.equal(unknown.workingLoadRatings, null);
  assert.equal(unknown.verifiedClearances, null);
  assert.equal(unknown.grossMassGrams, null);
});

test('balance uses named phases, distinct visits, active resources and shared-zone time', () => {
  const { balance } = report;
  const printers = balance.stages.find(stage => stage.id === 'print');
  const modelBusy = batch.timeline.phases.print1.filter(p => ['print', 'cool', 'unload', 'reset'].includes(p.motion));
  const print1 = printers.resources.find(r => r.id === 'print1');
  assert.equal(printers.activeResources, 6);
  assert.equal(printers.resources.reduce((total, r) => total + r.visits, 0), batch.order.quantity);
  assert.equal(print1.visits, new Set(modelBusy.map(phase => phase.unit)).size);
  close(print1.busySeconds, modelBusy.reduce((sum, phase) => sum + phase.end - phase.start, 0));
  close(print1.firstArticleSeconds, 13.75);
  close(print1.batchSecondsPerVisit, 7.35);
  assert.ok(print1.blockedSeconds > 0);
  assert.ok(print1.phases.some(phase => phase.action === '逐层打印首件'));
  assert.ok(print1.phases.some(phase => phase.action === '逐层打印批量件'));
  close(printers.secondsPerGood, Math.max(...printers.resources.map(r => r.busySeconds)) / balance.shipped);
  assert.ok(printers.parallelRatePerHour >= printers.ratePerHour);
  const merge = balance.stages.find(stage => stage.id === 'merge');
  assert.equal(merge.activeResources, 1);
  assert.equal(merge.controllingResource.visits, balance.shipped);
  const east = balance.zones.find(zone => zone.id === 'east');
  const eastOccupied = batch.timeline.mobile.intervals.filter(interval => interval.resources.includes('zone:warehouse-east-service'))
    .reduce((total, interval) => total + Math.max(0, Math.min(interval.end, batch.timeline.lastDeparture) - interval.start), 0);
  close(east.secondsPerGood, eastOccupied / balance.shipped);
  close(east.utilization, eastOccupied / batch.timeline.lastDeparture);
  assert.equal(balance.constraint, 'east');
  assert.equal(balance.stationConstraint, 'dispatch');
});

test('whole-order and inter-completion cadence are different measures and independent of seek', () => {
  const { balance } = report;
  const completions = batch.timeline.milestones.filter(m => m.count === 'boxed');
  close(balance.wholeOrder.ratePerHour, completions.length * 3600 / batch.timeline.lastDeparture);
  close(balance.packingCadence.secondsPerUnit, (completions.at(-1).time - completions[0].time) / (completions.length - 1));
  assert.equal(balance.target.taktSeconds, null);
  assert.equal(balance.target.demandPerShift, null);
  assert.equal(balance.target.netShiftSeconds, null);
  seekSimulation(batch, batch.duration);
  assert.equal(balance.shipped, batch.shipped);
  assert.equal(balance.rejected, batch.rejected);
  assert.equal(report.materials.cartonsFormed, batch.boxesReady);
  assert.deepEqual(buildEngineeringAnalysis(batch), report);
});

test('a first article has no inter-completion cadence or phantom parallel capacity', () => {
  const one = buildEngineeringAnalysis(createSimulation(DEFAULT_ORDER));
  assert.equal(one.balance.packingCadence.secondsPerUnit, null);
  assert.equal(one.balance.shipped, 1);
  assert.equal(one.balance.constraint, 'dispatch');
  const printers = one.balance.stages.find(stage => stage.id === 'print');
  assert.equal(printers.configuredResources, 6);
  assert.equal(printers.activeResources, 1);
  assert.equal(printers.resources[0].batchSecondsPerVisit, null);
  assert.equal(one.envelope.shipment.peakCartonsPerWave, 1);
  assert.equal(one.materials.spoolExchanges, 0);
  assert.equal(buildEngineeringAnalysis(null), null);
});
