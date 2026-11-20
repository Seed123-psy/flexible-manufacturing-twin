import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Box3, BoxGeometry, Matrix4, Mesh, Scene, Vector3 } from 'three';
import { OBB } from 'three/addons/math/OBB.js';
import { buildBuildingEnvelope } from '../src/building-envelope.js';
import { buildConveyors } from '../src/conveyors.js';
import { ENGINEERING_LAYOUT, ENGINEERING_SOLID_BOUNDS } from '../src/engineering-layout.js';
import { buildHall } from '../src/hall.js';
import { getMaterialTravel, palletDepth, palletHeight, palletWidth, positions, rejectMaterialPose, workshopFloor } from '../src/layout.js';
import { intakeDrives, outboundDrive, returnIn } from '../src/logistics-drive.js';
import { buildLogisticsPlatform } from '../src/logistics-platform.js';
import { MOBILE_CHARGING_BAYS, MOBILE_FLEET_POSES, PACKAGING_DELIVERY_ROUTES, routeForHandoff, routeToChargingBay } from '../src/mobile-layout.js';
import { makeStation } from '../src/models.js';
import { FILAMENT_DELIVERY_ROUTES, HUMAN_WALKWAYS, PATROL_RADIUS, PATROL_WAYPOINTS } from '../src/patrol-layout.js';
import { REJECT_BRIDGE_LAYOUT } from '../src/reject-bridge-layout.js';
import { REJECT_LIFTS, REJECT_LINK_HEIGHT, REJECT_ROAD_WIDTH, REJECT_TRUCK_EXIT, REJECT_TRUCK_EXTENTS, REJECT_TRUCK_PARK } from '../src/reject-layout.js';

const margin = 0.05;
const at = ([x, z]) => [x, 0, z];

function buildScene() {
  const previousDocument = globalThis.document;
  const context = new Proxy({
    createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
    createLinearGradient: () => ({ addColorStop() {} }),
  }, { get: (target, key) => target[key] ?? (() => {}) });
  globalThis.document = { createElement: () => ({ getContext: () => context }) };
  const scene = new Scene();
  try {
    const environment = new Scene();
    buildHall(environment, positions);
    buildBuildingEnvelope(environment);
    const platform = buildLogisticsPlatform(environment);
    for (const id of ['quality', 'quality2', 'robot', 'robot2', 'buffer', 'buffer2']) {
      const { group } = makeStation(id);
      group.name = id;
      group.position.set(...positions[id]);
      environment.add(group);
    }
    platform.rejectCell.update(null, [REJECT_LIFTS[0][1], REJECT_LINK_HEIGHT]);
    buildConveyors(scene);
    const bridges = ['Reject feed bridge reinforcement', 'Reject skybridge reinforcement'].map((name) => {
      const group = scene.getObjectByName(name);
      assert.ok(group, `${name} is missing from the scene`);
      return group;
    });
    return { scene, environment, bridges, structure: bridges.flatMap(boxesFor) };
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
}

function boxesFor(group) {
  const boxes = [];
  group.updateWorldMatrix(true, true);
  const instance = new Matrix4();
  group.traverse((part) => {
    if (!part.isMesh) return;
    part.geometry.computeBoundingBox();
    for (let i = 0; i < (part.isInstancedMesh ? part.count : 1); i++) {
      const transform = part.matrixWorld.clone();
      if (part.isInstancedMesh) {
        part.getMatrixAt(i, instance);
        transform.multiply(instance);
      }
      boxes.push({ box: part.geometry.boundingBox.clone().applyMatrix4(transform), name: part.name, part });
    }
  });
  return boxes;
}

// Exact segment-to-rectangle distance in plan, with round pivot envelopes on each swept route.
function distanceToBox(from, to, box) {
  const pointDistance = ([x, , z]) => Math.hypot(
    Math.max(box.min.x - x, 0, x - box.max.x), Math.max(box.min.z - z, 0, z - box.max.z),
  );
  let entry = 0;
  let exit = 1;
  for (const [i, axis] of [[0, 'x'], [2, 'z']]) {
    const delta = to[i] - from[i];
    if (delta === 0) {
      if (from[i] < box.min[axis] || from[i] > box.max[axis]) entry = Infinity;
      continue;
    }
    const t1 = (box.min[axis] - from[i]) / delta;
    const t2 = (box.max[axis] - from[i]) / delta;
    entry = Math.max(entry, Math.min(t1, t2));
    exit = Math.min(exit, Math.max(t1, t2));
  }
  if (entry <= exit) return 0;
  let distance = Math.min(pointDistance(from), pointDistance(to));
  const dx = to[0] - from[0];
  const dz = to[2] - from[2];
  const lengthSquared = dx * dx + dz * dz;
  if (!lengthSquared) return distance;
  for (const x of [box.min.x, box.max.x]) for (const z of [box.min.z, box.max.z]) {
    const u = Math.max(0, Math.min(1, ((x - from[0]) * dx + (z - from[2]) * dz) / lengthSquared));
    distance = Math.min(distance, Math.hypot(x - from[0] - u * dx, z - from[2] - u * dz));
  }
  return distance;
}

function circulation() {
  const routes = [];
  const add = (id, points, radius, height) => routes.push({ id, points, radius, height });
  for (const { id, points, width } of HUMAN_WALKWAYS) add(id, points, width / 2, 2.15);
  for (const { id, points, width } of ENGINEERING_LAYOUT.fireAisles) add(id, points.map(at), width / 2, 2.15);
  add('inspection', PATROL_WAYPOINTS.map(({ point }) => point), PATROL_RADIUS, 1.5);
  for (const [id, points] of Object.entries(FILAMENT_DELIVERY_ROUTES)) add(`MAT-01/${id}`, points, 0.54, 1.5);
  for (const [id, { points }] of Object.entries(PACKAGING_DELIVERY_ROUTES)) add(`carton/${id}`, points, 0.66, 2.15);
  for (const [id, { home, parking, chargeAtParking }] of Object.entries(MOBILE_FLEET_POSES)) {
    const agv = id.endsWith('Agv');
    const radius = agv ? 1.07 : id === 'inspectionRobot' ? PATROL_RADIUS : 0.66;
    const height = agv ? 1.05 : 2.15;
    for (const [role, berth] of Object.entries(parking)) {
      add(`${id}/${role}`, routeForHandoff(id, home, berth), radius, height);
      if (chargeAtParking) continue;
      for (const [i, bay] of MOBILE_CHARGING_BAYS.entries()) add(`${id}/${role}/charge${i}`, routeToChargingBay(id, berth, bay), radius, height);
    }
  }
  const drives = [...intakeDrives.flatMap(({ approach, lane }) => [approach, lane]), returnIn, outboundDrive];
  for (const [i, curve] of drives.entries()) add(`AGV drive ${i}`, curve.getSpacedPoints(128).map((v) => v.toArray()), 1.07, 1.05);
  return routes;
}

function planBox([x, z], [width, depth], low, high) {
  return new Box3(new Vector3(x - width / 2, low, z - depth / 2), new Vector3(x + width / 2, high, z + depth / 2));
}

const describe = (box) => `${box.min.toArray().map((v) => v.toFixed(3))} to ${box.max.toArray().map((v) => v.toFixed(3))}`;

test('each portal footing and header in the drawing matches the installed geometry and contacts the span', () => {
  const { scene } = buildScene();
  const { footprint, portals, spans, elbows, liftBearings, feedConnections } = REJECT_BRIDGE_LAYOUT;
  assert.doesNotThrow(() => JSON.stringify(REJECT_BRIDGE_LAYOUT));
  const floor = planBox([workshopFloor.center[0], workshopFloor.center[2]], workshopFloor.size, 0, 1);
  assert.equal(footprint.length, 6);
  for (const { id, center, size } of footprint) {
    const part = scene.getObjectByName(id);
    assert.ok(part, id);
    const box = new Box3().setFromObject(part);
    assert.ok(floor.containsBox(box), id);
    assert.ok(box.min.distanceTo(planBox(center, size, 0, 1).min) < 1e-8, id);
    assert.deepEqual([box.max.x, box.max.z], center.map((value, i) => value + size[i] / 2), id);
  }
  for (const { id, soffit } of portals) {
    const parts = boxesFor(scene.getObjectByName(id));
    const { box: header } = parts.find(({ name }) => name === 'Portal header');
    assert.ok(Math.abs(header.min.y - soffit) < 1e-8, id);
    assert.ok(parts.filter(({ name }) => name === 'Box-section column').every(({ box }) =>
      box.clone().expandByScalar(1e-8).intersectsBox(header)), id);
    for (const { id: spanId } of spans.filter(({ bearingIds }) => bearingIds.includes(id))) {
      const chordBoxes = boxesFor(scene.getObjectByName(spanId)).filter(({ name }) => name === 'Box truss chord');
      assert.equal(chordBoxes.filter(({ box }) => box.intersectsBox(header)).length, 2, spanId);
    }
  }
  for (const { id, soffit } of elbows) {
    const parts = boxesFor(scene.getObjectByName(id));
    const { box: diaphragm } = parts.find(({ name }) => name === 'Elbow torsion diaphragm');
    assert.ok(Math.abs(diaphragm.min.y - soffit) < 1e-8, id);
    for (const { id: spanId } of spans.filter(({ bearingIds }) => bearingIds.includes(id))) {
      const chordBoxes = boxesFor(scene.getObjectByName(spanId)).filter(({ name }) => name === 'Box truss chord');
      assert.equal(chordBoxes.filter(({ box }) => box.intersectsBox(diaphragm)).length, 2, spanId);
    }
  }
  const jointIds = new Set([...portals, ...elbows, ...liftBearings, ...feedConnections].map(({ id }) => id));
  assert.ok(spans.every(({ bearingIds }) => bearingIds.every((id) => jointIds.has(id))));
});

test('rendered bridge clears swept ground traffic and reserved maintenance volumes', () => {
  const { structure } = buildScene();
  for (const { id, points, radius, height } of circulation()) {
    for (const { name, box } of structure) {
      if (box.min.y >= height + margin) continue;
      for (let i = 1; i < points.length; i++) {
        assert.ok(distanceToBox(points[i - 1], points[i], box) >= radius + margin,
          `${id} leg ${i} interferes with ${name} (${describe(box)})`);
      }
    }
  }
  const rejectRoad = planBox([(REJECT_TRUCK_PARK[0] + REJECT_TRUCK_EXIT[0] + REJECT_TRUCK_EXTENTS.rear + REJECT_TRUCK_EXTENTS.front) / 2,
    REJECT_TRUCK_PARK[2]], [REJECT_TRUCK_EXIT[0] - REJECT_TRUCK_PARK[0] - REJECT_TRUCK_EXTENTS.rear + REJECT_TRUCK_EXTENTS.front, REJECT_ROAD_WIDTH],
  0, REJECT_TRUCK_EXTENTS.height + margin);
  const volumes = [...ENGINEERING_LAYOUT.maintenanceEnvelopes, ...ENGINEERING_LAYOUT.antiCollisionZones]
    .map(({ id, center, size, height }) => ({ id, box: planBox(center, size, 0, height) }));
  volumes.push({ id: 'reject truck', box: rejectRoad });
  for (const { id, box } of volumes) for (const part of structure) {
    assert.ok(!part.box.intersectsBox(box), `${id} intersects ${part.name} (${describe(part.box)})`);
  }
});

test('installed reinforcement clears adjacent hardware and the reject pallet throughout its route', () => {
  const { scene, environment, bridges, structure } = buildScene();
  const conveyorBoxes = boxesFor(scene).filter(({ part }) => {
    for (let ancestor = part; ancestor; ancestor = ancestor.parent) {
      if (bridges.includes(ancestor)) return false;
    }
    return true;
  });
  const environmentBoxes = [...boxesFor(environment), ...conveyorBoxes].filter(({ box }) => box.max.y > 0.045);
  const interfaceContacts = new Map();
  for (const { box, name } of structure) {
    const interior = box.clone().expandByScalar(-0.001);
    for (const fixture of environmentBoxes) {
      if (!fixture.box.intersectsBox(interior)) continue;
      const overlap = box.clone().intersect(fixture.box).getSize(new Vector3());
      const mount = fixture.part.parent.name;
      const isInterface =
        (name === 'Bolted conveyor seat' && fixture.name === 'Conveyor carrier pan' && overlap.y < 0.014) ||
        (name === 'Turntable bearing seat' && fixture.name === 'Turntable housing' && overlap.y < 0.008) ||
        (name === 'Trestle splice plate' && fixture.name === 'Conveyor stand column' && overlap.z < 0.005) ||
        (name === 'Bolted conveyor seat' && fixture.part.parent.parent?.name === 'Reject link trusses' && overlap.y < 0.026) ||
        (name === 'Box truss chord' && ['Reject lift 1', 'Reject lift 2'].includes(mount) && overlap.y < 0.010);
      assert.ok(isInterface, `${name} (${describe(box)}) intersects ${fixture.name || mount} (${describe(fixture.box)})`);
      interfaceContacts.set(name, (interfaceContacts.get(name) ?? 0) + 1);
    }
  }
  assert.ok(interfaceContacts.get('Bolted conveyor seat') >= 14);
  assert.equal(interfaceContacts.get('Turntable bearing seat'), 8);
  assert.equal(interfaceContacts.get('Trestle splice plate'), 2);
  assert.equal(interfaceContacts.get('Box truss chord'), 4);
  for (const { id, min, max } of ENGINEERING_SOLID_BOUNDS) {
    const box = new Box3(new Vector3(...min), new Vector3(...max));
    for (const part of structure) assert.ok(!part.box.intersectsBox(box), `${id} intersects ${part.name}`);
  }
  const payload = new Mesh(new BoxGeometry(palletWidth, palletHeight + 0.52, palletDepth));
  payload.rotation.order = 'YXZ';
  const local = new OBB(new Vector3(0, (palletHeight + 0.52) / 2, 0), new Vector3(palletWidth / 2, (palletHeight + 0.52) / 2, palletDepth / 2));
  for (const qc of ['quality', 'quality2']) {
    const { steps, length } = getMaterialTravel(qc, 'reject');
    for (const [i, { offset, distance }] of steps.entries()) for (let sample = 0; sample <= 24; sample++) {
      const { position, yaw, pitch } = rejectMaterialPose(qc, (offset + distance * sample / 24) / length);
      payload.position.set(...position);
      payload.rotation.set(0, yaw, pitch);
      payload.updateMatrix();
      const carried = local.clone().applyMatrix4(payload.matrix);
      // OBB.applyMatrix4 translates its centre, so transform the local offset explicitly.
      carried.center.copy(local.center).applyMatrix4(payload.matrix);
      const hit = structure.find(({ box }) => carried.intersectsBox3(box));
      assert.ok(!hit, `${qc} leg ${i} at ${position} intersects ${hit?.name}`);
    }
  }
});
