import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Box3, Matrix4, Raycaster, Scene, Vector3 } from 'three';
import { ENGINEERING_LAYOUT, ENGINEERING_SOLID_BOUNDS } from '../src/engineering-layout.js';
import { buildEngineeringScene } from '../src/engineering-scene.js';
import { buildControlRoom } from '../src/control-room-model.js';
import { makeChargingStation } from '../src/mobile-robots.js';
import { buildConveyors } from '../src/conveyors.js';
import { buildHall } from '../src/hall.js';
import { buildLogisticsPlatform } from '../src/logistics-platform.js';
import { makeFilamentWarehouse, makeStation } from '../src/models.js';
import { conveyorRuns, getMaterialRoute, junctionWidth, palletDepth, palletWidth, positions, productionLines,
  rejectConveyorRuns, rejectSkyRuns, workshopFloor } from '../src/layout.js';
import { intakeDrives, outboundDrive, returnIn } from '../src/logistics-drive.js';
import { loadingRobotTransfer, rackInlet, rackOutlet, rackRailZ, sortJunction, sortPorts, truckPark,
  truckTravel, warehouseWaveSize } from '../src/logistics-layout.js';
import { LOADING_ROBOT_HOME, MOBILE_CHARGING_BAYS, MOBILE_FLEET_POSES, PACKAGING_DELIVERY_ROUTES,
  routeForHandoff, routeToChargingBay } from '../src/mobile-layout.js';
import { CHARGING_ZONE_CENTER, FILAMENT_DELIVERY_ROUTES, FILAMENT_WAREHOUSE_CENTER, HUMAN_WALKWAYS, PATROL_RADIUS,
  PATROL_WAYPOINTS } from '../src/patrol-layout.js';
import { REJECT_GANTRY_BEAM, REJECT_GANTRY_RAILS, REJECT_GANTRY_Z, REJECT_LIFTS, REJECT_LINK_HEIGHT,
  REJECT_TRUCK_EXTENTS, REJECT_TRUCK_EXIT, REJECT_TRUCK_PARK } from '../src/reject-layout.js';

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

test('B wall plaques are physically separate on the shared wall', () => withCanvas(() => {
  const scene = new Scene();
  buildHall(scene, positions);
  scene.updateMatrixWorld(true);
  const plaques = ['增材制造 B', '并行生产 B 区', '后处理 B 区'].map((name) => {
    const sign = scene.getObjectByName(name);
    assert.ok(sign, `missing ${name}`);
    return new Box3().setFromObject(sign);
  });
  for (let i = 1; i < plaques.length; i++) {
    assert.ok(plaques[i].min.x - plaques[i - 1].max.x >= 1, 'adjacent plaque faces overlap or crowd');
  }
}));

test('both design monitors expose a front-only hit area through the office glazing', () => withCanvas(() => {
  const scene = new Scene();
  const { designOffice } = buildHall(scene, positions);
  const workstation = makeStation('design');
  workstation.group.position.fromArray(positions.design);
  scene.add(workstation.group);
  scene.updateMatrixWorld(true);
  const camera = new Vector3(...positions.design).add(new Vector3(0.62, 2.31, 4.51));
  const officeSolids = designOffice.children.filter((object) => object.isMesh && !object.material.transparent);
  assert.equal(workstation.screens.length, 2);
  for (const screen of workstation.screens) {
    assert.equal(screen.material.visible, false);
    const center = screen.getWorldPosition(new Vector3());
    const aim = center.clone().sub(camera).normalize();
    const frontRay = new Raycaster(camera, aim);
    const [hit] = frontRay.intersectObject(workstation.group);
    assert.equal(hit?.object, screen);
    assert.ok(frontRay.intersectObjects(officeSolids, false).every((solid) => solid.distance > hit.distance));
    const rearRay = new Raycaster(center.clone().add(aim), aim.clone().negate());
    assert.equal(rearRay.intersectObject(screen).length, 0);
  }
}));

const toBox = ({ min, max }) => new Box3(new Vector3(...min), new Vector3(...max));
const tuple = ([x, z]) => [x, 0, z];
const nominal = ENGINEERING_SOLID_BOUNDS.map(({ id, ownerId, ...volume }) => ({ id, ownerId, box: toBox(volume) }));
const engineering = withCanvas(() => buildEngineeringScene(new Scene()));

function meshBounds(root, filter = () => true) {
  const results = [];
  const local = new Matrix4(), transform = new Matrix4();
  root.updateWorldMatrix(true, true);
  root.traverse(mesh => {
    if (!mesh.isMesh || !filter(mesh)) return;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    for (let i = 0; i < (mesh.isInstancedMesh ? mesh.count : 1); i++) {
      if (mesh.isInstancedMesh) mesh.getMatrixAt(i, local);
      const matrix = mesh.isInstancedMesh ? transform.multiplyMatrices(mesh.matrixWorld, local) : mesh.matrixWorld;
      const ownerId = mesh.userData.ownerIds?.[i];
      const box = mesh.geometry.boundingBox.clone().applyMatrix4(matrix);
      results.push({ id: ownerId ?? mesh.name, mesh: mesh.name, ownerId, box });
    }
  });
  return results;
}

const drawnFixtures = meshBounds(engineering.userData.solids);
const modelMargin = 0.04;
const designedAisles = ENGINEERING_LAYOUT.fireAisles.map(({ id, points, width }) => ({
  id, points: points.map(tuple), reach: width / 2, above: 2.15,
}));
const floorLimit = 0.038; // Surface render bias, not another physical layer of slab.

// Slab method in XYZ: conservatively sweep a rectangular footprint with each
// linear path, an asymmetric vertical band relative to current route height,
// and a small model-space margin. Zero-length segments test a parked pose.
function segmentHitsBox(start, end, box) {
  let entry = 0, exit = 1;
  for (const [i, axis] of ['x', 'y', 'z'].entries()) {
    const delta = end[i] - start[i];
    const min = box.min[axis], max = box.max[axis];
    if (Math.abs(delta) < 1e-8) {
      if (start[i] < min || start[i] > max) return false;
    } else {
      const a = (min - start[i]) / delta, b = (max - start[i]) / delta;
      entry = Math.max(entry, Math.min(a, b));
      exit = Math.min(exit, Math.max(a, b));
      if (entry > exit) return false;
    }
  }
  return true;
}

function pathConflicts(paths, obstacles) {
  const conflicts = [];
  for (const { id, points, reach, above, below = 0, margin = modelMargin } of paths) {
    for (const obstacle of obstacles) {
      const swept = obstacle.box.clone().expandByVector(new Vector3(reach + margin, margin, reach + margin));
      swept.min.y -= above;
      swept.max.y += below;
      if (points.slice(1).some((to, i) => segmentHitsBox(points[i], to, swept))) {
        conflicts.push(`${id} → ${obstacle.id} [${obstacle.mesh ?? 'advertised bounds'}]`);
      }
    }
  }
  return [...new Set(conflicts)];
}

function mobilePaths() {
  const paths = [
    ...HUMAN_WALKWAYS.map(({ id, points, width }) => ({ id, points, reach: width / 2, above: 2.15 })),
    ...Object.entries(FILAMENT_DELIVERY_ROUTES).map(([id, points]) => ({ id: `filament/${id}`, points, reach: 0.66, above: 1.1 })),
    ...Object.entries(PACKAGING_DELIVERY_ROUTES).map(([id, { points }]) => ({ id: `carton/${id}`, points, reach: 0.68, above: 2.15 })),
    { id: 'patrol', points: PATROL_WAYPOINTS.map(({ point }) => point), reach: PATROL_RADIUS, above: 1.5 },
  ];
  for (const [fleet, { home, parking }] of Object.entries(MOBILE_FLEET_POSES)) {
    const reach = fleet.endsWith('Agv') ? 1.07 : fleet === 'inspectionRobot' ? PATROL_RADIUS : 0.69;
    const above = fleet.endsWith('Agv') ? 1.05 : fleet === 'inspectionRobot' ? 1.5 : 2.15;
    paths.push({ id: `${fleet}/home`, points: [home, home], reach, above });
    for (const [role, point] of Object.entries(parking)) {
      const id = `${fleet}/${role}`;
      paths.push({ id: `${id}/parked`, points: [point, point], reach, above });
      paths.push({ id: `${id}/handoff`, points: routeForHandoff(fleet, home, point), reach, above });
      for (const [i, berth] of MOBILE_CHARGING_BAYS.entries()) {
        paths.push({ id: `${id}/charge-${i}`, points: routeToChargingBay(fleet, point, berth), reach, above });
      }
    }
  }
  for (const [i, berth] of MOBILE_CHARGING_BAYS.entries()) {
    paths.push({ id: `charge berth ${i}`, points: [berth, berth], reach: 1.07, above: 2.15 });
  }
  const curves = [returnIn, outboundDrive, ...intakeDrives.flatMap(({ approach, lane }) => [approach, lane])];
  curves.forEach((curve, i) => paths.push({ id: `loaded AGV curve ${i}`,
    points: curve.getSpacedPoints(128).map(point => point.toArray()), reach: 1.07, above: 1.12 }));
  for (let slot = 0; slot < warehouseWaveSize; slot++) {
    paths.push({ id: `loader/slot-${slot}`, points: [LOADING_ROBOT_HOME, loadingRobotTransfer(slot)], reach: 1.08, above: 2.28 });
  }
  return paths;
}

function materialPaths() {
  const limit = Math.max(junctionWidth / 2, Math.hypot(palletWidth, palletDepth) / 2) + 0.08;
  const runs = [...conveyorRuns, ...rejectConveyorRuns, ...rejectSkyRuns, ...sortPorts.map(p => [sortJunction, p])];
  for (const { quality } of productionLines) runs.push(getMaterialRoute(quality, 'reject'));
  for (const [x, low, z] of REJECT_LIFTS) runs.push([[x, low, z], [x, REJECT_LINK_HEIGHT, z]]);
  return runs.map((points, i) => ({ id: `material leg ${i}`, points, reach: limit, above: 0.65, below: 0.60 }));
}

function boxAt(min, max) { return new Box3(new Vector3(...min), new Vector3(...max)); }

function machineSweeps(dispatch) {
  // Dispatch translates in X. Include both end poses with loading gate open
  // and closed, which bound all intervening quarter-turn gate and wheel poses
  // except a small corner excursion covered by the model-space margin.
  const dispatchSweep = new Box3();
  for (const x of [truckPark[0], truckPark[0] + truckTravel]) for (const door of [0, 1]) {
    dispatch.position.x = x;
    dispatch.userData.pose(door);
    dispatchSweep.union(boxAt([-1.55, 0, -0.98], [2.31, 1.95, 0.98]).translate(dispatch.position));
    dispatch.updateWorldMatrix(true, true);
    dispatchSweep.expandByObject(dispatch, false);
  }
  const e = REJECT_TRUCK_EXTENTS;
  const [x, , z] = REJECT_TRUCK_PARK;
  return [
    { id: 'dispatch truck', box: dispatchSweep },
    { id: 'reject truck', box: boxAt([x + e.rear, 0, z - e.halfWidth], [REJECT_TRUCK_EXIT[0] + e.front, e.height, z + e.halfWidth]) },
    { id: 'AS/RS mast, forks and payload', box: boxAt([rackInlet[0] - 0.60, 0, rackRailZ - 1.62],
      [rackOutlet[0] + 0.60, 4.91, rackRailZ + 1.44]) },
    { id: 'reject gantry, trolley and payload', box: boxAt([REJECT_GANTRY_RAILS[0] - 0.20, 0.6, REJECT_GANTRY_Z[0] - 0.42],
      [REJECT_GANTRY_RAILS[1] + 0.20, REJECT_GANTRY_BEAM + 0.32, REJECT_GANTRY_Z[1] + 0.42]) },
    ...productionLines.map(({ robot }) => {
      const [x, , z] = positions[robot];
      return { id: `${robot} articulated arm envelope`, box: boxAt([x - 2.30, 0, z - 2.18], [x + 2.30, 3.31, z + 2.18]) };
    }),
  ];
}

function assertClear(conflicts) { assert.deepEqual(conflicts, [], conflicts.slice(0, 16).join('\n')); }

test('engineering metadata accounts for every rendered fixture without filling exit apertures', () => {
  const ids = new Set();
  for (const bounds of nominal) {
    assert.ok(!ids.has(bounds.id), `duplicate ID: ${bounds.id}`);
    ids.add(bounds.id);
    assert.ok(drawnFixtures.some(mesh => mesh.ownerId === bounds.ownerId && bounds.box.clone().expandByScalar(0.012).containsBox(mesh.box)),
      `no rendered fixture in ${bounds.id}`);
  }
  for (const { ownerId, mesh, box } of drawnFixtures) {
    assert.ok(nominal.some(record => record.ownerId === ownerId && record.box.clone().expandByScalar(0.012).containsBox(box)),
      `${ownerId} ${mesh} outside plan bounds: ${box.min.toArray()} to ${box.max.toArray()}`);
    for (const [i, axis] of ['x', 'z'].entries()) {
      const center = workshopFloor.center[i * 2], half = workshopFloor.size[i] / 2;
      // Signs may project slightly from the frame, but all mounts are on the slab.
      if (box.min.y < 0.03) assert.ok(box.min[axis] >= center - half - 1e-5 && box.max[axis] <= center + half + 1e-5,
        `${ownerId} base falls off the slab along ${axis}`);
    }
  }
  assert.match(ENGINEERING_LAYOUT.status, /not verified for code compliance/);
  const exits = new Set(ENGINEERING_LAYOUT.exits.map(({ id }) => id));
  for (const { id, exitId } of ENGINEERING_LAYOUT.fireAisles) assert.ok(exits.has(exitId), `${id} refers to an unknown exit`);
  assertClear(pathConflicts(designedAisles, [...nominal, ...drawnFixtures]));
});

test('new physical fixtures clear existing pedestrian, mobile, and material travel in XYZ', () => {
  const obstacles = [...nominal, ...drawnFixtures];
  assertClear(pathConflicts([...mobilePaths(), ...materialPaths()], obstacles));
  // Check the method distinguishes a gantry-over-aisle from a threshold on it.
  const path = { id: 'test', points: [[-1, 0, 0], [1, 0, 0]], reach: 0.5, above: 2.15 };
  assertClear(pathConflicts([path], [{ id: 'high', box: boxAt([-0.1, 3, -0.1], [0.1, 4, 0.1]) }]));
  assert.equal(pathConflicts([path], [{ id: 'low', box: boxAt([-0.1, 1, -0.1], [0.1, 4, 0.1]) }]).length, 1);
});

test('new fixtures clear moving machinery envelopes and installed factory meshes', () => withCanvas(() => {
  const baseline = new Scene();
  const hall = buildHall(baseline, positions);
  buildControlRoom(baseline);
  const charger = makeChargingStation();
  charger.group.position.set(...CHARGING_ZONE_CENTER);
  baseline.add(charger.group);
  const { truck } = buildLogisticsPlatform(baseline);
  buildConveyors(baseline);
  const filament = makeFilamentWarehouse();
  filament.group.position.set(...FILAMENT_WAREHOUSE_CENTER);
  baseline.add(filament.group);
  for (const id of ['design', ...productionLines.flatMap(line => [...line.printers, line.quality, line.boxes, line.robot, line.buffer])]) {
    const station = makeStation(id);
    station.group.position.set(...positions[id]);
    baseline.add(station.group);
  }
  hall.update();
  const existing = meshBounds(baseline).filter(({ box }) => box.max.y > floorLimit);
  const swept = machineSweeps(truck);
  assertClear(pathConflicts(designedAisles, [...existing, ...swept]));
  const clashes = [];
  for (const { id, mesh, box } of [...nominal, ...drawnFixtures]) {
    for (const envelope of swept) if (envelope.box.clone().expandByScalar(modelMargin).intersectsBox(box)) clashes.push(`${id} → ${envelope.id}`);
    // Ignore sub-mm grazing among details; permanent fixtures must not cut through the modeled shell.
    if (mesh) for (const fixture of existing) {
      if (!box.intersectsBox(fixture.box)) continue;
      const overlap = box.clone().intersect(fixture.box).getSize(new Vector3());
      if (overlap.x > 0.005 && overlap.y > 0.005 && overlap.z > 0.005) {
        clashes.push(`${id} (${mesh}) → ${fixture.id || 'existing geometry'} ${fixture.box.min.toArray().map(v => v.toFixed(2))} … ${fixture.box.max.toArray().map(v => v.toFixed(2))}`);
      }
    }
  }
  assertClear([...new Set(clashes)]);
}));

test('floor-only design annotations toggle independently of fixtures and flush covers', () => {
  const { solids, markings, surfaces } = engineering.userData;
  assert.deepEqual(engineering.children, [solids, surfaces, markings]);
  for (const group of [markings, surfaces]) {
    const entries = meshBounds(group);
    assert.ok(entries.length > 0, `no geometry in ${group.name}`);
    for (const { id, box } of entries) assert.ok(box.max.y <= floorLimit && box.min.y >= -0.003, `${id} projects into physical clearance`);
  }
  const { trench, slab, fireAisles, maintenanceEnvelopes, antiCollisionZones } = ENGINEERING_LAYOUT;
  assert.equal(trench.coverTop, slab.datum);
  const covers = surfaces.getObjectByName('Utility trench covers');
  assert.equal(covers.count, trench.coverCount);
  assert.ok(meshBounds(surfaces).every(({ box }) => box.max.y - trench.coverTop <= 0.013));
  assert.ok(trench.assumedDepth > 0 && trench.assumedDepth <= slab.assumedThickness);
  assert.ok(slab.markers.every(marker => marker.measuredSettlement === null));
  const illustrated = meshBounds(markings).map(({ id }) => id);
  for (const item of [trench, ...slab.markers, ...fireAisles, ...maintenanceEnvelopes, ...antiCollisionZones]) {
    assert.equal(item.solid, false);
    assert.ok(!nominal.some(({ ownerId }) => ownerId === item.id), `${item.id} registered as a physical obstruction`);
    assert.ok(illustrated.includes(item.id), `missing marking for ${item.id}`);
  }
  markings.visible = false;
  const visible = [];
  engineering.traverseVisible(object => visible.push(object));
  markings.visible = true;
  assert.ok(visible.includes(solids) && visible.includes(surfaces) && !visible.includes(markings));
});
