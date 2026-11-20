import * as THREE from 'three';
import { buildRejectBridge } from './reject-bridge-model.js';
import { REJECT_HANDOFF_GAP, REJECT_LIFTS, REJECT_LIFT_DECK_SIZE, REJECT_LINK_HEIGHT } from './reject-layout.js';
import { conveyorRuns, junctions, junctionWidth, palletDepth, palletHeight, palletWidth, rejectConveyorRuns, rejectJunctions, rejectSkyRuns, rollerTop } from './layout.js';

const metal = (color, metalness = 0.35, roughness = 0.61) => new THREE.MeshStandardMaterial({ color, metalness, roughness });
const frame = metal(0x343d42);
const dark = metal(0x232b2e, 0.19, 0.76);
const rail = metal(0x9a9f9d, 0.65, 0.43);
const safety = metal(0xdca751, 0.23);
const rubber = metal(0x283235, 0.03, 0.85);
const palletEdge = metal(0x44776f, 0.49);
const active = new THREE.MeshBasicMaterial({ color: 0x8ad9ba });
const boxGeometries = new Map();

function block(parent, material, width, height, depth, x, y, z) {
  const key = `${width}/${height}/${depth}`;
  if (!boxGeometries.has(key)) boxGeometries.set(key, new THREE.BoxGeometry(width, height, depth));
  const mesh = new THREE.Mesh(boxGeometries.get(key), material);
  mesh.position.set(x, y, z);
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

export function makePallet() {
  const pallet = new THREE.Group();
  const chassis = block(pallet, dark, palletWidth, 0.038, palletDepth, 0, 0.028, 0);
  chassis.castShadow = true;
  block(pallet, rubber, palletWidth - 0.052, 0.014, palletDepth - 0.052, 0, palletHeight - 0.007, 0);
  for (const side of [-1, 1]) {
    block(pallet, rubber, palletWidth - 0.056, 0.016, 0.075, 0, 0.008, side * 0.20);
    block(pallet, palletEdge, 0.034, 0.019, palletDepth - 0.082, side * (palletWidth / 2 - 0.020), 0.043, 0);
    block(pallet, rail, 0.095, 0.009, 0.035, side * 0.246, 0.047, 0.267);
  }
  block(pallet, safety, 0.131, 0.012, 0.005, 0, 0.025, palletDepth / 2 + 0.003);
  return pallet;
}

const conveyorWidth = 0.83;
const rollerRadius = 0.032;
const rollerGeometry = new THREE.CylinderGeometry(rollerRadius, rollerRadius, 1, 12, 1, true);
rollerGeometry.rotateX(Math.PI / 2);
const rollerMatrix = new THREE.Matrix4();
const rollerScale = new THREE.Vector3();
const rollerRotation = new THREE.Quaternion();
const rollerPosition = new THREE.Vector3();

function rollers(parent, surface, length, width, y, count) {
  const assembly = new THREE.InstancedMesh(rollerGeometry, surface, count);
  for (let i = 0; i < count; i++) {
    const x = (i + 0.5) * length / count - length / 2;
    rollerPosition.set(x, y - rollerRadius, 0);
    rollerScale.set(1, 1, width);
    rollerMatrix.compose(rollerPosition, rollerRotation, rollerScale);
    assembly.setMatrixAt(i, rollerMatrix);
  }
  assembly.receiveShadow = true;
  parent.add(assembly);
}

function support(parent, x, y, z) {
  block(parent, frame, 0.069, y - 0.101, 0.067, x, (y - 0.101) / 2, z).name = 'Conveyor stand column';
  block(parent, rail, 0.139, 0.028, 0.124, x, 0.028, z);
  block(parent, dark, 0.086, 0.022, 0.086, x, 0.011, z);
}

function segment(parent, surface, [start, end], suspended = false) {
  const [x, y, z] = start;
  const run = Math.hypot(end[0] - x, end[2] - z);
  const rise = end[1] - y;
  const length = Math.hypot(run, rise);
  const isOverpass = Math.min(y, end[1]) > 2 && Math.abs(end[2] - z) > 2;
  const group = new THREE.Group();
  group.position.set((x + end[0]) / 2, (y + end[1]) / 2, (z + end[2]) / 2);
  group.rotation.order = 'YXZ';
  group.rotation.y = -Math.atan2(end[2] - z, end[0] - x);
  group.rotation.z = Math.atan2(rise, run);
  parent.add(group);

  block(group, dark, length, 0.099, conveyorWidth - 0.045, 0, -0.109, 0).name = 'Conveyor carrier pan';
  rollers(group, surface, length, conveyorWidth - 0.087, 0, Math.ceil(length / 0.115));
  for (const side of [-1, 1]) {
    const zRail = side * conveyorWidth / 2;
    block(group, frame, length, isOverpass ? 0.153 : 0.092, 0.062, 0, -0.036, zRail);
    block(group, rail, length, 0.022, 0.062, 0, 0.013, zRail);
    const stands = (isOverpass || suspended) ? 0 : Math.max(1, Math.ceil(length / 1.38));
    for (let i = 0; i < stands; i++) {
      const fraction = (i + 0.5) / stands;
      const height = y + rise * fraction;
      const yaw = group.rotation.y;
      const xStand = (fraction - 0.5) * run;
      const stand = new THREE.Group();
      stand.position.set(group.position.x + Math.cos(yaw) * xStand + Math.sin(yaw) * zRail,
        0, group.position.z - Math.sin(yaw) * xStand + Math.cos(yaw) * zRail);
      parent.add(stand);
      support(stand, 0, height, 0);
    }
  }
  if (length > 1.0) {
    block(group, frame, 0.244, 0.146, 0.148, -length / 2 + 0.24, -0.16, 0.36).name = 'Conveyor gearmotor';
    block(group, rail, 0.112, 0.075, 0.02, -length / 2 + 0.254, -0.143, 0.443);
    block(group, active, 0.027, 0.015, 0.011, -length / 2 + 0.253, -0.141, 0.457);
  }
}

function junction(parent, surface, [x, y, z], suspended = false) {
  const station = new THREE.Group();
  station.position.set(x, 0, z);
  parent.add(station);
  block(station, frame, junctionWidth, 0.147, junctionWidth, 0, y - 0.134, 0).name = 'Turntable housing';
  const deck = junctionWidth - 0.058;
  rollers(station, surface, deck, deck, y, 8);
  for (const side of [-1, 1]) {
    for (const end of [-1, 1]) {
      const offset = junctionWidth / 2 - 0.061;
      block(station, safety, 0.095, 0.016, 0.095, side * offset, y, end * offset);
      if (!suspended) support(station, side * offset, y - 0.06, end * offset);
    }
  }
  // Insert the Z-direction belts in the spaces between the X-feed rollers.
  for (const interval of [-2, 0, 2]) {
    block(station, rubber, 0.031, 0.009, deck, interval * deck / 8, y - 0.0045, 0);
  }
  block(station, safety, 0.308, 0.083, 0.206, 0, y - 0.186, junctionWidth / 2 - 0.037);
  block(station, dark, 0.238, 0.046, 0.011, 0, y - 0.186, junctionWidth / 2 + 0.068);
  block(station, active, 0.051, 0.016, 0.007, 0.072, y - 0.186, junctionWidth / 2 + 0.075);
}

// Route coordinates are pallet centerlines. Stop the hardware at each deck
// edge instead of extending a fixed conveyor into the lift car or turntable.
function rejectHardwareRun([start, end]) {
  const trim = (point, toward) => {
    const [x, , z] = point;
    const lift = REJECT_LIFTS.some(([liftX, , liftZ]) => x === liftX && z === liftZ);
    const halfDeck = lift ? REJECT_LIFT_DECK_SIZE / 2 : rejectJunctions.includes(point) ? junctionWidth / 2 : 0;
    if (!halfDeck) return point;
    const ratio = (halfDeck + REJECT_HANDOFF_GAP) / Math.hypot(toward[0] - x, toward[2] - z);
    return point.map((value, axis) => value + (toward[axis] - value) * ratio);
  };
  return [trim(start, end), trim(end, start)];
}

export function buildConveyors(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const shades = [225, 225, 214, 194, 174, 179, 203, 219];
  const pixels = new Uint8Array(shades.length * 4);
  shades.forEach((value, i) => pixels.set([value, value, value, 255], i * 4));
  const texture = new THREE.DataTexture(pixels, shades.length, 1);
  texture.wrapS = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  const surface = metal(0xabb2b3, 0.55, 0.42);
  surface.map = texture;
  const rejectTexture = texture.clone();
  rejectTexture.needsUpdate = true;
  const rejectSurface = metal(0xb34e4e, 0.42, 0.48);
  rejectSurface.map = rejectTexture;

  conveyorRuns.forEach((run) => segment(group, surface, run));
  junctions.forEach((point) => junction(group, surface, point));
  const feed = new THREE.Group();
  feed.name = 'Reject feed conveyors';
  group.add(feed);
  rejectConveyorRuns.forEach((run) => segment(feed, rejectSurface, rejectHardwareRun(run)));
  const link = new THREE.Group();
  link.name = 'Elevated reject link';
  group.add(link);
  rejectSkyRuns.forEach((run) => segment(link, rejectSurface, rejectHardwareRun(run), true));
  rejectJunctions.forEach((point) => {
    const overhead = point[1] === REJECT_LINK_HEIGHT;
    junction(overhead ? link : feed, rejectSurface, point, overhead);
  });
  buildRejectBridge(feed, 'feed');
  buildRejectBridge(link, 'sky');
  return {
    advance(delta) {
      texture.offset.x = (texture.offset.x + delta * 2.8) % 1;
      rejectTexture.offset.x = (rejectTexture.offset.x + delta * 2.15) % 1;
    },
  };
}

