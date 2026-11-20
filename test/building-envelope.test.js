import assert from 'node:assert/strict';
import test from 'node:test';
import { Box3, Scene, Vector3 } from 'three';
import { buildBuildingEnvelope } from '../src/building-envelope.js';
import { envelopeDoors, envelopeEdges, envelopePoint, envelopeSides, envelopeWalls, EAVE,
  getEnvelopeDoorOpening, RIDGE, roofAirRoutes, roofFrames, roofHeightAt, roofRidgeZ, roofVisibility,
  smoothFactor, WALL_OFFSET } from '../src/building-layout.js';
import { ENGINEERING_LAYOUT } from '../src/engineering-layout.js';
import { buildHall } from '../src/hall.js';
import { positions, productionLines } from '../src/layout.js';
import { DISPATCH_TRUCK_EXTENTS, truckPark, truckTravel } from '../src/logistics-layout.js';
import { REJECT_TRUCK_EXIT, REJECT_TRUCK_EXTENTS, REJECT_TRUCK_PARK } from '../src/reject-layout.js';
import { getEquipmentTelemetry } from '../src/equipment-telemetry.js';
import { createSimulation, PRESETS, seekSimulation } from '../src/simulation.js';

const sim = createSimulation(PRESETS.batch);

function withCanvas(create) {
  const previous = globalThis.document;
  const context = new Proxy({
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    createLinearGradient: () => ({ addColorStop() {} }),
  }, { get: (target, key) => target[key] ?? (() => {}) });
  globalThis.document = {
    createElement: () => ({ getContext: () => context }),
    createElementNS: () => ({ addEventListener() {}, removeEventListener() {} }),
  };
  try { return create(); } finally {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  }
}

test('each perimeter wall leaves its full door opening and the south roof columns clear the exit', () => {
  for (const [side, { min, max }] of Object.entries(envelopeSides)) {
    for (const wall of envelopeWalls.filter((wall) => wall.side === side)) {
      assert.ok(wall.from >= min && wall.to > wall.from && wall.to <= max, `${side} wall segment`);
      for (const door of envelopeDoors.filter((door) => door.side === side)) {
        const half = door.clearWidth / 2;
        assert.ok(wall.to <= door.at - half || wall.from >= door.at + half, door.id);
      }
    }
  }
  const exit = envelopeDoors.find(({ side }) => side === 'south');
  assert.ok(roofFrames.every((x) => Math.abs(x - exit.at) > exit.clearWidth / 2 + exit.jamb + 0.195));
  assert.equal(roofHeightAt(roofRidgeZ), RIDGE);
  assert.equal(roofHeightAt(envelopeEdges.north), EAVE);
  for (const route of roofAirRoutes) {
    const duct = ENGINEERING_LAYOUT.hvac.ducts.find(({ id }) => id === route.duct);
    for (let axis = 0; axis < 2; axis++) {
      assert.ok(route.tap[axis] >= Math.min(duct.from[axis], duct.to[axis]));
      assert.ok(route.tap[axis] <= Math.max(duct.from[axis], duct.to[axis]));
    }
  }
});

test('vehicle gates reach full clearance before each moving body intersects the facade', () => {
  const scene = new Scene();
  withCanvas(() => buildHall(scene, positions));
  const cases = [
    { station: 'dispatch', park: truckPark, extents: DISPATCH_TRUCK_EXTENTS, end: truckPark[0] + truckTravel,
      apron: 'Finished goods dispatch apron', xAt: (progress, direction) => {
        const motion = direction ? 'depart' : 'truck-return';
        const travel = direction ? smoothFactor(progress, 0.25, 1) : 1 - smoothFactor(progress, 0, 0.83);
        return [truckPark[0] + truckTravel * travel, { stations: { dispatch: { motion, phaseProgress: progress } } }];
      } },
    { station: 'reject', park: REJECT_TRUCK_PARK, extents: REJECT_TRUCK_EXTENTS, end: REJECT_TRUCK_EXIT[0],
      apron: 'Reject collection apron', xAt: (progress, direction) => {
        const travel = direction ? smoothFactor(progress, 0, 1) : 1 - smoothFactor(progress, 0, 1);
        const truckX = REJECT_TRUCK_PARK[0] + (REJECT_TRUCK_EXIT[0] - REJECT_TRUCK_PARK[0]) * travel;
        return [truckX, { logistics: { rejects: { truckX, truckVisible: true } } }];
      } },
  ];
  for (const { station, park, extents, end, apron, xAt } of cases) {
    const door = envelopeDoors.find((value) => value.station === station);
    const [gateX, gateZ] = envelopePoint(door.side, door.at, WALL_OFFSET);
    const { front, rear, halfWidth, height } = extents;
    assert.equal(park[2], gateZ);
    assert.ok(door.clearWidth / 2 - halfWidth > 0.16, door.id);
    assert.ok(door.clearHeight - height > 0.30, door.id);
    const apronBounds = new Box3().setFromObject(scene.getObjectByName(apron));
    assert.ok(apronBounds.max.x - (end + front) > 0.25, apron);
    assert.ok(apronBounds.min.x <= envelopeEdges.east, apron);
    for (const departing of [true, false]) {
      let crossings = 0;
      for (let step = 0; step <= 200; step++) {
        const [x, frame] = xAt(step / 200, departing);
        if (x + front < gateX - 0.24 || x + rear > gateX + 0.24) continue;
        crossings++;
        const available = door.clearHeight * getEnvelopeDoorOpening(station, frame);
        assert.ok(available > height + 0.30, `${door.id} at ${x} has ${available} m clearance`);
      }
      assert.ok(crossings > 0, 'the test must sample both ends of the actual crossing');
    }
  }
});

test('roof fade is monotonic, clears the interior and does not leave the detached roof in the control room', () => {
  const scene = new Scene();
  const envelope = buildBuildingEnvelope(scene);
  const roof = scene.getObjectByName('双坡厂房屋面与悬吊机电');
  const services = scene.getObjectByName('空调机组、消声箱、悬吊风管');
  const target = new Vector3(0, 0, 0);
  const camera = new Vector3(0, 15, 0);
  envelope.update(camera, target, false, sim);
  assert.equal(roof.visible, false);
  assert.equal(services.visible, false);
  camera.z = 55;
  envelope.update(camera, target, false, sim);
  assert.equal(roof.visible, true);
  assert.equal(services.visible, true);
  assert.ok(roof.children.every(({ material }) => material.opacity < 1 && !material.depthWrite));
  assert.ok(roofVisibility(38) > roofVisibility(29) && roofVisibility(38) < roofVisibility(47));
  envelope.update(camera, target, true, sim);
  assert.equal(roof.visible, false);
  assert.equal(services.visible, false);
});

test('vehicle gate telemetry follows the same opening as the animated mesh', () => {
  const depart = sim.timeline.phases.dispatch.find(({ motion }) => motion === 'depart');
  seekSimulation(sim, depart.start + (depart.end - depart.start) * 0.72);
  const { assets } = getEquipmentTelemetry(sim);
  for (const door of envelopeDoors.filter(({ type }) => type === 'vehicle')) {
    const detail = assets.find(({ id }) => id === door.id);
    assert.equal(detail.details.openingPercent, getEnvelopeDoorOpening(door.station, sim) * 100);
  }
});

test('the applicable HVAC units boost with line A printing and their mounted indicators follow telemetry', () => {
  const batch = createSimulation(PRESETS.batch);
  const scene = new Scene();
  const envelope = buildBuildingEnvelope(scene);
  const camera = new Vector3(0, 15, 55);
  const target = new Vector3(0, 0, 0);
  const lens = scene.getObjectByName('AHU-A 运行指示灯');
  envelope.update(camera, target, false, batch);
  const baseColor = lens.material.color.getHex();
  const phase = productionLines[0].printers.flatMap((station) => batch.timeline.phases[station])
    .filter(({ motion }) => motion === 'print').sort((a, b) => a.start - b.start)[0];
  seekSimulation(batch, phase.start + 0.01);
  envelope.update(camera, target, false, batch);
  const hvac = getEquipmentTelemetry(batch).assets.filter(({ type }) => type === 'hvac');
  assert.deepEqual(Object.fromEntries(hvac.map(({ id, details }) => [id, details.mode])),
    { 'AHU-A': 'boost', 'AHU-B': 'base', 'AHU-E': 'boost' });
  assert.notEqual(lens.material.color.getHex(), baseColor);
});
