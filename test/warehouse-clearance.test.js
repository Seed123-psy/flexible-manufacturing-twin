import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Box3, BoxGeometry, Matrix3, Matrix4, Mesh, Scene, Vector3 } from 'three';
import { OBB } from 'three/addons/math/OBB.js';
import { MOBILE_CHARGING_BAYS, MOBILE_FLEET_POSES, PACKAGING_DELIVERY_ROUTES, routeForHandoff, routeToChargingBay } from '../src/mobile-layout.js';
import { HUMAN_WALKWAYS, PATROL_RADIUS, PATROL_WAYPOINTS } from '../src/patrol-layout.js';
import { buildConveyors, makePallet } from '../src/conveyors.js';
import { REJECT_CARGO_SLOTS, REJECT_LIFTS, REJECT_LINK_HEIGHT, REJECT_RACK_SLOTS, REJECT_ROAD_WIDTH, REJECT_TRUCK_EXIT, REJECT_TRUCK_PARK } from '../src/reject-layout.js';
import { buildHall } from '../src/hall.js';
import { getMaterialTravel, palletHeight, positions, rejectMaterialPose, workshopFloor } from '../src/layout.js';
import { intakeDrives, outboundDrive, returnIn } from '../src/logistics-drive.js';
import { buildLogisticsPlatform } from '../src/logistics-platform.js';
import { createRejectPlan, rejectFrame } from '../src/reject-flow.js';

// Extract world-space boxes from the same mesh instances used by the renderer.
function boxesFor(group, { exclude = [], minTop = 0.045 } = {}) {
  const boxes = [];
  const instanceMatrix = new Matrix4();
  const worldMatrix = new Matrix4();
  group.updateWorldMatrix(true, true);
  function visit(object) {
    if (exclude.includes(object)) return;
    object.children.forEach(visit);
    if (!object.isMesh) return;
    if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
    for (let index = 0; index < (object.isInstancedMesh ? object.count : 1); index++) {
      const box = new Box3().copy(object.geometry.boundingBox);
      let transform = object.matrixWorld;
      if (object.isInstancedMesh) {
        object.getMatrixAt(index, instanceMatrix);
        transform = worldMatrix.multiplyMatrices(transform, instanceMatrix);
      }
      box.applyMatrix4(transform);
      if (box.max.y > minTop) boxes.push(box); // Ignore floor paint when testing traffic.
    }
  }
  visit(group);
  return boxes;
}

function intersectsBox(from, to, box) {
  let entry = 0;
  let exit = 1;
  for (const [index, axis] of [[0, 'x'], [2, 'z']]) {
    const min = box.min[axis];
    const max = box.max[axis];
    const delta = to[index] - from[index];
    if (delta === 0) {
      if (from[index] < min || from[index] > max) return false;
      continue;
    }
    const first = (min - from[index]) / delta;
    const last = (max - from[index]) / delta;
    entry = Math.max(entry, Math.min(first, last));
    exit = Math.min(exit, Math.max(first, last));
    if (entry > exit) return false;
  }
  return true;
}

function distanceFromBox(from, to, box) {
  if (intersectsBox(from, to, box)) return 0;
  const pointDistance = ([x, , z]) => Math.hypot(
    Math.max(box.min.x - x, 0, x - box.max.x), Math.max(box.min.z - z, 0, z - box.max.z),
  );
  let closest = Math.min(pointDistance(from), pointDistance(to));
  const dx = to[0] - from[0];
  const dz = to[2] - from[2];
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared === 0) return closest;
  for (const x of [box.min.x, box.max.x]) {
    for (const z of [box.min.z, box.max.z]) {
      const offsetX = x - from[0];
      const offsetZ = z - from[2];
      const t = Math.max(0, Math.min(1, (offsetX * dx + offsetZ * dz) / lengthSquared));
      closest = Math.min(closest, Math.hypot(offsetX - t * dx, offsetZ - t * dz));
    }
  }
  return closest;
}

function buildWarehouse({ conveyors = false } = {}) {
  const previousDocument = globalThis.document;
  const context = new Proxy({
    createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
    createLinearGradient: () => ({ addColorStop() {} }),
  }, { get: (target, key) => target[key] ?? (() => {}) });
  globalThis.document = { createElement: () => ({ getContext: () => context }) };
  const scene = new Scene();
  try {
    const platform = buildLogisticsPlatform(scene);
    buildHall(scene, positions);
    if (conveyors) buildConveyors(scene);
    return { scene, platform };
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
}

function servicePaths() {
  const paths = [
    ...HUMAN_WALKWAYS.map(({ id, points, width }) => ({ id, points, radius: width / 2, height: 2.15 })),
    ...Object.entries(PACKAGING_DELIVERY_ROUTES).map(([id, { points }]) => ({ id, points, radius: 0.58, height: 2.15 })),
    { id: 'patrol', points: PATROL_WAYPOINTS.map(({ point }) => point), radius: PATROL_RADIUS, height: 1.5 },
  ];
  for (const [fleet, { home, parking, chargeAtParking }] of Object.entries(MOBILE_FLEET_POSES)) {
    const radius = fleet.endsWith('Agv') ? 1.02 : fleet === 'inspectionRobot' ? PATROL_RADIUS : 0.66;
    const height = fleet.endsWith('Agv') ? 1.05 : 2.15;
    for (const [role, position] of Object.entries(parking)) {
      paths.push({ id: `${fleet}/${role} handoff`, points: routeForHandoff(fleet, home, position), radius, height });
      if (chargeAtParking) continue;
      for (const [bay, berth] of MOBILE_CHARGING_BAYS.entries()) {
        paths.push({ id: `${fleet}/${role} charge ${bay + 1}`, points: routeToChargingBay(fleet, position, berth), radius, height });
      }
    }
  }
  const drives = Object.fromEntries(intakeDrives.flatMap(({ approach, lane }, index) => [
    [`inbound approach ${index + 1}`, approach], [`inbound loaded ${index + 1}`, lane],
  ]));
  for (const [id, curve] of Object.entries({ ...drives, returnIn, outboundDrive })) {
    const points = curve.getSpacedPoints(128).map((point) => point.toArray());
    paths.push({ id, points, radius: 1.07, height: 1.05 });
  }
  return paths;
}

test('the carton service bay stays open for people, supply, patrol and vehicle handoffs', () => {
  const { scene } = buildWarehouse();
  const geometry = ['Warehouse backdrop', 'Packaging box warehouse'].flatMap((name) => {
    const part = scene.getObjectByName(name);
    assert.ok(part, `missing geometry: ${name}`);
    return boxesFor(part).map((box) => ({ name, box }));
  });
  // Catch adjacent equipment or hall fixtures added near the carton access.
  for (const box of boxesFor(scene)) {
    if (box.max.x > 12.7 && box.min.x < 20.0 && box.max.z > -9.5 && box.min.z < -3.55) {
      geometry.push({ name: 'carton service bay fixture', box });
    }
  }
  const paths = servicePaths();
  const parkedCartonRobots = Object.entries(MOBILE_FLEET_POSES.packagingRobot.parking).map(([role, position]) => {
    const center = new Vector3(...position);
    for (const [index, axis] of [[0, 'x'], [1, 'z']]) {
      const offset = Math.abs(center[axis] - workshopFloor.center[axis === 'x' ? 0 : 2]);
      assert.ok(offset + 0.58 <= workshopFloor.size[index] / 2, `carton robot ${role} berth hangs over the floor`);
    }
    return { owner: `packagingRobot/${role} `, box: new Box3(center, center) };
  });
  for (const { id, points, radius, height } of paths) {
    for (const [index, from] of points.slice(0, -1).entries()) {
      const to = points[index + 1];
      for (const { owner, box } of parkedCartonRobots) {
        if (id.startsWith(owner)) continue; // The route can enter its own berth.
        const clearance = distanceFromBox(from, to, box) - radius - 0.58;
        assert.ok(clearance >= 0.05, `${id} has ${clearance.toFixed(3)} m clearance to parked ${owner.trim()}`);
      }
      for (const { name, box } of geometry) {
        if (box.min.y >= height + 0.05) continue;
        const clearance = distanceFromBox(from, to, box) - radius;
        assert.ok(clearance >= 0.05, `${id} (${from} to ${to}) has ${clearance.toFixed(3)} m clearance to ${name}`);
      }
    }
  }
});

function named(scene, name) {
  const part = scene.getObjectByName(name);
  assert.ok(part, `missing rendered assembly: ${name}`);
  return part;
}

const rejectLiftRest = [REJECT_LIFTS[0][1], REJECT_LINK_HEIGHT];
const margin = 0.05;
const describeBox = (box) => `${box.min.toArray().map((v) => v.toFixed(2))} to ${box.max.toArray().map((v) => v.toFixed(2))}`;

function pathConflicts(paths, obstacles) {
  const conflicts = [];
  for (const { id, points, radius, height } of paths) {
    for (const { name, box } of obstacles) {
      if (box.min.y >= height + margin) continue;
      const clearance = Math.min(...points.slice(1).map((to, i) => distanceFromBox(points[i], to, box))) - radius;
      if (clearance < margin) conflicts.push({ clearance, detail: `${id}: ${clearance.toFixed(3)} m to ${name} (${describeBox(box)})` });
    }
  }
  return conflicts.sort((a, b) => a.clearance - b.clearance).map(({ detail }) => detail);
}

function rejectTrafficPaths() {
  const paths = servicePaths();
  // Include stationary pivots and berths, independently of whether a route uses them.
  for (const [fleet, { home, parking }] of Object.entries(MOBILE_FLEET_POSES)) {
    const { radius, height } = paths.find(({ id }) => id.startsWith(`${fleet}/`));
    for (const [role, point] of Object.entries({ home, ...parking })) {
      paths.push({ id: `${fleet}/${role} berth`, points: [point, point], radius, height });
    }
  }
  for (const [index, point] of MOBILE_CHARGING_BAYS.entries()) {
    paths.push({ id: `charge berth ${index + 1}`, points: [point, point], radius: 1.07, height: 2.15 });
  }
  return paths;
}

test('rendered reject cell and link clear the surrounding service traffic', () => {
  const { scene, platform } = buildWarehouse({ conveyors: true });
  platform.rejectCell.update(null, rejectLiftRest);
  const geometry = ['Reject transfer cell', 'Reject feed conveyors', 'Elevated reject link'].flatMap((name) =>
    boxesFor(named(scene, name), { exclude: [named(scene, 'Reject collection truck')] }).map((box) => ({ name, box })));
  const conflicts = pathConflicts(rejectTrafficPaths(), geometry);
  assert.equal(conflicts.length, 0, conflicts.slice(0, 16).join('\n'));
});

test('rendered reject truck clears fixtures and service routes throughout departure and return', () => {
  const { scene, platform } = buildWarehouse({ conveyors: true });
  const { rejectCell } = platform;
  const truck = named(scene, 'Reject collection truck');
  // Cargo uses the renderer's pallet geometry and truck-local slot transforms.
  for (const slot of REJECT_CARGO_SLOTS) {
    const pallet = rejectPayload();
    pallet.position.set(...slot.map((v, axis) => v - REJECT_TRUCK_PARK[axis]));
    rejectCell.cargo.add(pallet);
  }
  rejectCell.update({ truckX: REJECT_TRUCK_PARK[0] }, rejectLiftRest);
  const docked = new Box3().setFromObject(truck, true);
  rejectCell.update({ truckX: REJECT_TRUCK_EXIT[0] }, rejectLiftRest);
  const exit = new Box3().setFromObject(truck, true);
  // The truck reverses along the same fixed-Z corridor without turning. A global
  // envelope bounds every intervening pose (the spinning wheels stay inside it).
  const sweep = docked.clone().union(exit);
  sweep.min.y = Math.min(0, sweep.min.y);
  const conflicts = pathConflicts(rejectTrafficPaths(), [{ name: 'truck sweep', box: sweep }]);
  assert.equal(conflicts.length, 0, conflicts.join('\n'));
  const padded = sweep.clone().expandByScalar(margin);
  const hits = boxesFor(scene, { exclude: [truck] }).filter((box) => padded.intersectsBox(box));
  assert.equal(hits.length, 0, hits.slice(0, 12).map(describeBox).join('\n'));
  assert.ok(Math.max(REJECT_TRUCK_PARK[2] - sweep.min.z, sweep.max.z - REJECT_TRUCK_PARK[2]) + margin <= REJECT_ROAD_WIDTH / 2);
  const apron = new Box3().setFromObject(named(scene, 'Reject collection apron'));
  assert.ok(apron.max.x >= sweep.max.x + margin, 'truck runs past the apron');
  assert.ok(apron.min.z <= sweep.min.z - margin && apron.max.z >= sweep.max.z + margin, 'truck hangs off apron side');
  assert.ok(apron.min.x <= workshopFloor.center[0] + workshopFloor.size[0] / 2, 'apron does not meet main floor');
});

// Real carrier mesh plus a conservative box for the tallest 100-mm figurine
// (0.55 scene units, resized uniformly from the production model's aspect ratio).
const payloadSize = [0.445, 0.55, 0.39];
const payloadGeometry = new BoxGeometry(...payloadSize);
function rejectPayload() {
  const carrier = makePallet();
  const product = new Mesh(payloadGeometry);
  product.position.y = palletHeight + payloadSize[1] / 2;
  carrier.add(product);
  return carrier;
}

function assertNoPenetration(moving, fixtures, label) {
  for (const box of moving) {
    // Allow intended surface contact (roller/rack/truck deck and the loader jaws).
    const interior = box.clone().expandByScalar(-0.001);
    if (interior.isEmpty()) continue;
    const hit = fixtures.find((fixture) => interior.intersectsBox(fixture));
    assert.ok(!hit, `${label}: ${describeBox(box)} into ${hit && describeBox(hit)}`);
  }
}

// Keep the yaw of the turning pallet rather than filling the empty corners
// of its world AABB. Its component meshes have rigid, unit-scale transforms.
function assertTurningPayloadClear(payload, fixtures, label) {
  payload.updateWorldMatrix(true, true);
  for (const mesh of payload.children) {
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const local = mesh.geometry.boundingBox;
    const broadPhase = local.clone().applyMatrix4(mesh.matrixWorld);
    const oriented = new OBB(local.getCenter(new Vector3()).applyMatrix4(mesh.matrixWorld),
      local.getSize(new Vector3()).multiplyScalar(0.5).addScalar(-0.001), new Matrix3().setFromMatrix4(mesh.matrixWorld));
    const hit = fixtures.find((fixture) => broadPhase.intersectsBox(fixture) && oriented.intersectsBox3(fixture));
    assert.ok(!hit, `${label}: ${describeBox(broadPhase)} into ${hit && describeBox(hit)}`);
  }
}

test('reject lift cars clear fixed meshes over the full stroke and admit the pallet at both levels', () => {
  const { scene, platform: { rejectCell } } = buildWarehouse({ conveyors: true });
  const decks = REJECT_LIFTS.map((_, i) => named(scene, `Reject lift ${i + 1} deck`));
  rejectCell.update(null, rejectLiftRest);
  const fixtures = boxesFor(scene, { exclude: decks });
  for (const [i, deck] of decks.entries()) {
    const heightsAt = (y) => rejectLiftRest.map((rest, j) => i === j ? y : rest);
    rejectCell.update(null, heightsAt(REJECT_LIFTS[i][1]));
    const low = boxesFor(deck);
    rejectCell.update(null, heightsAt(REJECT_LINK_HEIGHT));
    const high = boxesFor(deck);
    assert.ok(low.length && low.length === high.length);
    // Individual pieces translate only vertically, so their endpoint unions
    // enclose the entire motion, even the height passed between sample frames.
    assertNoPenetration(low.map((box, j) => box.union(high[j])), fixtures, deck.name);
  }

  const payload = rejectPayload();
  payload.rotation.order = 'YXZ';
  for (const qc of ['quality', 'quality2']) {
    const { steps, length } = getMaterialTravel(qc, 'reject');
    for (const [i, index] of steps.flatMap((step, j) => step.vertical ? [j] : []).entries()) {
      for (let j = index - 2; j <= index + 2; j++) {
        const step = steps[j];
        for (let sample = 0; sample <= 16; sample++) {
          const t = sample / 16;
          // Keep external approach samples within the immediate handoff.
          if (j === index - 2 && (1 - t) * step.distance > 0.85) continue;
          if (j === index + 2 && t * step.distance > 0.85) continue;
          const { position, yaw, pitch } = rejectMaterialPose(qc, (step.offset + t * step.distance) / length);
          payload.position.set(...position);
          payload.rotation.set(0, yaw, pitch);
          const heights = [...rejectLiftRest];
          heights[i] = position[1];
          rejectCell.update(null, heights);
          assertTurningPayloadClear(payload, [...fixtures, ...decks.flatMap((deck) => boxesFor(deck))],
            `${qc} lift ${i + 1}, leg ${j}, sample ${sample}`);
        }
      }
    }
  }
});

test('rendered reject loader reaches every rack and cargo address without clipping occupied slots', () => {
  const { scene, platform: { rejectCell } } = buildWarehouse({ conveyors: true });
  const loader = named(scene, 'Reject moving loader');
  const trolley = named(scene, 'Reject loader trolley');
  const truck = named(scene, 'Reject collection truck');
  rejectCell.update(null, rejectLiftRest);
  const fixes = boxesFor(scene, { exclude: [loader, truck] });
  const dockedTruck = boxesFor(truck);
  const unitMeshes = Array.from({ length: REJECT_RACK_SLOTS.length + REJECT_CARGO_SLOTS.length + 1 }, rejectPayload);
  const plan = createRejectPlan();
  for (let unit = 1; unit <= 60; unit++) plan.receive(unit, 'quality', 1, 0.1);
  plan.finish(1);
  assert.equal(new Set(plan.units.map(({ slot }) => slot)).size, REJECT_RACK_SLOTS.length);
  assert.equal(new Set(plan.units.map(({ truckSlot }) => truckSlot)).size, REJECT_CARGO_SLOTS.length);
  for (const job of plan.jobs) {
    for (const leg of job.legs) {
      for (const fraction of [0, 0.25, 0.5, 0.75, 1 - 1e-7]) {
        const frame = rejectFrame(plan, job.start + leg.start + (leg.end - leg.start) * fraction);
        rejectCell.update(frame, rejectLiftRest);
        let used = 0;
        const place = (parent, position) => {
          const assembly = unitMeshes[used++];
          parent.add(assembly);
          assembly.position.set(...position);
        };
        for (const { slot } of frame.rack) place(rejectCell.stock, REJECT_RACK_SLOTS[slot]);
        for (const { truckSlot } of frame.cargo) place(rejectCell.cargo, REJECT_CARGO_SLOTS[truckSlot].map((v, i) => v - REJECT_TRUCK_PARK[i]));
        if (frame.intake) place(rejectCell.intake, [0, 0, 0]);
        if (frame.carrying) place(rejectCell.held, [0, 0, 0]);
        const obstacles = [...fixes, ...(frame.truck === 'docked' ? dockedTruck : []),
          ...[rejectCell.stock, rejectCell.cargo, rejectCell.intake].flatMap((group) => boxesFor(group))];
        // The moving bridge's designed mount overlaps its support rails; check the tool below it.
        assertNoPenetration(boxesFor(trolley), obstacles, `${job.kind} ${job.unit} at ${frame.gantry.join(',')}`);
        for (let i = 0; i < used; i++) unitMeshes[i].removeFromParent();
      }
    }
  }
});
