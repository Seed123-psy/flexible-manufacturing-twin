import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Box3, Matrix4, PerspectiveCamera, Raycaster, Scene, Vector2, Vector3 } from 'three';
import { buildControlRoom, CONTROL_ROOM_CENTER, CONTROL_ROOM_SIZE } from '../src/control-room-model.js';
import { HUMAN_WALKWAYS, PATROL_WAYPOINTS, PATROL_RADIUS } from '../src/patrol-layout.js';
import { REJECT_ROAD_WIDTH, REJECT_TRUCK_PARK, REJECT_TRUCK_EXTENTS } from '../src/reject-layout.js';

function model() {
  const saved = globalThis.document;
  const context = new Proxy({ createLinearGradient: () => ({ addColorStop() {} }) }, { get: (target, key) => target[key] ?? (() => {}) });
  globalThis.document = { createElement: () => ({ getContext: () => context }) };
  try {
    const room = buildControlRoom(new Scene());
    room.group.updateWorldMatrix(true, true);
    return room;
  } finally {
    if (saved === undefined) delete globalThis.document;
    else globalThis.document = saved;
  }
}

function meshBounds(group) {
  const bounds = new Box3();
  const instance = new Matrix4();
  group.traverse((object) => {
    if (!object.isMesh) return;
    object.geometry.computeBoundingBox();
    for (let i = 0; i < (object.isInstancedMesh ? object.count : 1); i++) {
      const box = object.geometry.boundingBox.clone();
      if (object.isInstancedMesh) {
        object.getMatrixAt(i, instance);
        box.applyMatrix4(instance);
      }
      bounds.union(box.applyMatrix4(object.matrixWorld));
    }
  });
  return bounds;
}

test('the physical control room stays clear of people, patrol and the reject truck lane', () => {
  const room = model();
  const bounds = meshBounds(room.group);
  const [x, , z] = CONTROL_ROOM_CENTER;
  const [width, depth] = CONTROL_ROOM_SIZE;
  for (const [actual, planned] of [[bounds.min.x, x - width / 2], [bounds.max.x, x + width / 2],
    [bounds.min.z, z - depth / 2], [bounds.max.z, z + depth / 2]]) {
    assert.ok(Math.abs(actual - planned) < 0.03, `${actual} versus ${planned}`);
  }
  const patrol = { id: 'patrol', width: 2 * PATROL_RADIUS, points: PATROL_WAYPOINTS.map(({ point }) => point) };
  for (const { points, width, id } of [...HUMAN_WALKWAYS, patrol]) {
    const radius = width / 2 + 0.08;
    for (const [i, [ax, , az]] of points.slice(0, -1).entries()) {
      const [bx, , bz] = points[i + 1];
      assert.ok(Math.min(ax, bx) - radius > bounds.max.x || Math.max(ax, bx) + radius < bounds.min.x ||
        Math.min(az, bz) - radius > bounds.max.z || Math.max(az, bz) + radius < bounds.min.z, `${id} segment ${i} crosses CR-01`);
    }
  }
  assert.ok(bounds.max.z + 0.40 < REJECT_TRUCK_PARK[2] - REJECT_ROAD_WIDTH / 2);
  assert.ok(room.cameraPosition[2] < REJECT_TRUCK_PARK[2] - REJECT_TRUCK_EXTENTS.halfWidth);
});

test('the interactive display has the physical monitor aspect and clear mouse rays from the docked camera', () => {
  const room = model();
  assert.equal(room.width / room.height, 1120 / 640);
  const camera = new PerspectiveCamera(43, 1.6, 0.12, 160);
  camera.position.set(...room.cameraPosition);
  camera.lookAt(new Vector3(...room.cameraTarget));
  camera.updateMatrixWorld();
  const projected = (x, y) => room.screen.localToWorld(new Vector3(x, y, 0)).project(camera);
  const topLeft = projected(-room.width / 2, room.height / 2);
  const bottomRight = projected(room.width / 2, -room.height / 2);
  const aspect = (bottomRight.x - topLeft.x) * camera.aspect / (topLeft.y - bottomRight.y);
  assert.ok(Math.abs(aspect - 1.75) < 1e-8);
  assert.ok(Math.abs(topLeft.x + bottomRight.x) < 1e-8);
  assert.ok(Math.abs(topLeft.y + bottomRight.y) < 1e-8);
  for (const x of [-0.92, 0, 0.92]) for (const y of [-0.92, 0, 0.92]) {
    const { x: ndcX, y: ndcY } = projected(x * room.width / 2, y * room.height / 2);
    const raycaster = new Raycaster();
    raycaster.setFromCamera(new Vector2(ndcX, ndcY), camera);
    const [hit] = raycaster.intersectObject(room.group);
    assert.equal(hit?.object.name, room.screen.name, `blocked sightline at ${x}, ${y}`);
  }
});
