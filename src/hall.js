import * as THREE from 'three';
import { mountLinearLight } from './work-light.js';
import { ENGINEERING_LAYOUT } from './engineering-layout.js';
import { getMaterialTravel, productionLines, productionPads, workshopFloor } from './layout.js';
import { DISPATCH_APRON_END, DISPATCH_ROAD_WIDTH, truckPark } from './logistics-layout.js';
import { MOBILE_FLEET_POSES, NORTH_CHARGE_AISLE } from './mobile-layout.js';
import {
  CHARGING_ZONE_CENTER, FILAMENT_DELIVERY_ROUTES, FILAMENT_WAREHOUSE_CENTER, FILAMENT_WAREHOUSE_FOOTPRINT,
  HUMAN_CROSSINGS, HUMAN_WALKWAYS, PACKAGING_WAREHOUSE_CENTER, PATROL_WAYPOINTS,
} from './patrol-layout.js';

const rearWall = -7.40;
import { rejectWarehouseCenter, REJECT_APRON_END, REJECT_ROAD_WIDTH, REJECT_TRUCK_PARK, REJECT_ZONE_SIZE } from './reject-layout.js';

const { center: [floorX, , floorZ], size: [platformWidth, platformDepth] } = workshopFloor;
const floorCenter = [floorX, floorZ];

function sheet(color, roughness = 0.78, metalness = 0.16) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function stencil(color) {
  return new THREE.MeshBasicMaterial({ color, toneMapped: false });
}

function concreteTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const pixels = ctx.createImageData(canvas.width, canvas.height);
  let seed = 43;
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const trowel = Math.sin(x / 16 + y / 53) * Math.cos(y / 21 - x / 65) * 4;
      const gray = 223 + trowel + ((seed >>> 26) - 32) * 0.38;
      const i = (y * canvas.width + x) * 4;
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = gray;
      pixels.data[i + 3] = 255;
    }
  }
  ctx.putImageData(pixels, 0, 0);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(9, 8);
  map.anisotropy = 8;
  return map;
}

function glazingTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 192;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, '#aec2c9');
  gradient.addColorStop(0.48, '#829ca9');
  gradient.addColorStop(1, '#4b626c');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#e7f3fc30';
  ctx.beginPath();
  ctx.moveTo(0, 108);
  ctx.lineTo(128, 3);
  ctx.lineTo(128, 30);
  ctx.lineTo(0, 139);
  ctx.fill();
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = '#d5e5ef42';
  for (let y = 32; y < 192; y += 5) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(128, y);
    ctx.stroke();
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  return map;
}

function sign(parent, text, width, height, position, { floor = false, color = '#e4e3d8' } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = Math.max(64, Math.round(512 * height / width));
  const ctx = canvas.getContext('2d');
  if (!floor) {
    ctx.fillStyle = '#343d42';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#dcab62';
    ctx.fillRect(0, 0, 10, canvas.height);
  }
  ctx.font = `700 ${canvas.height * 0.65}px 'Microsoft YaHei', sans-serif`;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height * 0.51, canvas.width * 0.9);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  const material = new THREE.MeshBasicMaterial({ map, transparent: floor, depthWrite: !floor, toneMapped: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  mesh.name = text;
  mesh.position.set(...position);
  if (floor) mesh.rotation.x = -Math.PI / 2;
  parent.add(mesh);
  return mesh;
}

function boxBatches(parent) {
  const batches = new Map();
  const transform = new THREE.Object3D();
  function add(material, size, point, rotation = [0, 0, 0], shadow = false) {
    const key = `${material.uuid}/${shadow}`;
    if (!batches.has(key)) batches.set(key, { material, shadow, transforms: [] });
    transform.position.set(...point);
    transform.rotation.set(...rotation);
    transform.scale.set(...size);
    transform.updateMatrix();
    batches.get(key).transforms.push(transform.matrix.clone());
  }
  function finish() {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    for (const { material, shadow, transforms } of batches.values()) {
      const meshes = new THREE.InstancedMesh(geometry, material, transforms.length);
      meshes.castShadow = shadow;
      meshes.receiveShadow = !material.isMeshBasicMaterial;
      transforms.forEach((matrix, i) => meshes.setMatrixAt(i, matrix));
      parent.add(meshes);
    }
  }
  return { add, finish };
}

function buildDesignOffice(hall, [x, , z]) {
  const room = new THREE.Group();
  room.name = 'Enclosed design office';
  room.position.set(x, 0, z);
  hall.add(room);
  const { add, finish } = boxBatches(room);
  const shell = sheet(0xc3beb0, 0.88, 0.02);
  const skirting = sheet(0x798784, 0.72, 0.15);
  const graphite = sheet(0x33434a, 0.55, 0.28);
  const plinth = sheet(0x424a48, 0.86, 0.15);
  const oak = sheet(0xa47c52, 0.79, 0.03);
  const worktop = sheet(0xc39d71, 0.68, 0.06);
  const upholstery = sheet(0x617f7e, 0.92, 0.01);
  const officeDiffuser = sheet(0xe1dbd0, 0.44, 0.06);
  officeDiffuser.emissive.setHex(0xffe8cb);
  const officeLights = [];
  const pane = new THREE.MeshStandardMaterial({
    color: 0xacc8cd,
    metalness: 0.05,
    roughness: 0.26,
    transparent: true,
    opacity: 0.12,
    depthWrite: false,
  });

  const width = 8.35;
  const depth = 6.1;
  const left = -width / 2;
  const right = width / 2;
  const rear = -depth / 2;
  const front = depth / 2;
  const top = 3.04;
  const doorway = [0.65, 2.03];
  add(plinth, [width + 0.12, 0.52, depth + 0.12], [0, -0.26, 0], undefined, true);
  add(oak, [width, 0.02, depth], [0, 0.006, 0]);
  add(graphite, [0.24, 0.47, depth], [right + 0.1, -0.235, 0]);
  add(skirting, [0.26, 0.02, doorway[1] - doorway[0]], [right + 0.11, 0.015, (doorway[0] + doorway[1]) / 2]);
  for (let column = -14; column <= 14; column++) {
    add(skirting, [0.009, 0.002, depth - 0.06], [column * 0.29, 0.018, 0]);
  }

  add(shell, [width, top, 0.13], [0, top / 2, rear], undefined, true);
  add(skirting, [width, 0.16, 0.18], [0, 0.08, rear + 0.036]);
  add(shell, [0.13, top, depth], [left, top / 2, 0], undefined, true);
  for (const [start, end] of [[rear, doorway[0]], [doorway[1], front]]) {
    add(shell, [0.12, 0.42, end - start], [right, 0.21, (start + end) / 2], undefined, true);
    add(pane, [0.035, 2.04, end - start - 0.04], [right, 1.45, (start + end) / 2]);
    add(shell, [0.12, 0.56, end - start], [right, 2.78, (start + end) / 2], undefined, true);
  }
  add(graphite, [0.135, 0.26, doorway[1] - doorway[0] + 0.14], [right, 2.52, (doorway[0] + doorway[1]) / 2]);
  add(shell, [0.14, 0.4, doorway[1] - doorway[0]], [right, 2.84, (doorway[0] + doorway[1]) / 2]);
  for (const edge of doorway) add(graphite, [0.16, 2.4, 0.09], [right, 1.2, edge]);

  const mullions = [left, -1.45, 1.45, right];
  for (const mullion of mullions) add(graphite, [0.072, top, 0.092], [mullion, top / 2, front]);
  for (let i = 0; i < mullions.length - 1; i++) {
    const panelWidth = mullions[i + 1] - mullions[i] - 0.04;
    const center = (mullions[i + 1] + mullions[i]) / 2;
    add(pane, [panelWidth, 2.45, 0.035], [center, 1.38, front]);
    add(graphite, [panelWidth, 0.11, 0.105], [center, 0.095, front]);
    add(graphite, [panelWidth, 0.035, 0.057], [center, 2.58, front]);
  }
  add(graphite, [width + 0.1, 0.32, 0.18], [0, 2.87, front], undefined, true);
  add(graphite, [width + 0.1, 0.19, 0.19], [0, 2.99, rear], undefined, true);
  for (const side of [left, right]) add(graphite, [0.15, 0.19, depth], [side, 2.99, 0], undefined, true);
  for (const fixture of [-1.63, 1.63]) {
    add(graphite, [0.095, 0.10, depth], [fixture, 2.92, 0], undefined, true);
    add(skirting, [0.164, 0.063, 2.74], [fixture, 2.852, -0.15]);
    add(officeDiffuser, [0.124, 0.025, 2.61], [fixture, 2.811, -0.15]);
    const light = new THREE.SpotLight(0xffe8cb, 18, 8, Math.PI * 0.31, 0.72, 2);
    light.position.set(fixture, 2.797, -0.15);
    light.target.position.set(fixture, 0.4, 0.08);
    room.add(light, light.target);
    officeLights.push(light);
  }

  // Meeting table and material library sit beside the CAD desk, away from its sightline.
  add(worktop, [1.75, 0.097, 1.55], [-2.88, 0.79, 0.05], undefined, true);
  for (const dx of [-0.69, 0.69]) {
    for (const dz of [-0.56, 0.56]) add(graphite, [0.077, 0.78, 0.077], [-2.88 + dx, 0.39, 0.05 + dz]);
  }
  for (const side of [-1, 1]) {
    const cz = 0.05 + side * 1.22;
    add(upholstery, [0.57, 0.13, 0.55], [-2.88, 0.46, cz], undefined, true);
    add(upholstery, [0.57, 0.48, 0.075], [-2.88, 0.69, cz + side * 0.25], [side * -0.12, 0, 0]);
    for (const dx of [-0.21, 0.21]) {
      for (const dz of [-0.2, 0.2]) add(graphite, [0.046, 0.41, 0.046], [-2.88 + dx, 0.21, cz + dz]);
    }
  }
  add(oak, [1.75, 1.08, 0.45], [-2.84, 0.58, rear + 0.32], undefined, true);
  add(graphite, [1.79, 0.055, 0.48], [-2.84, 1.14, rear + 0.32]);
  for (const drawer of [-0.57, 0, 0.57]) {
    add(worktop, [0.52, 0.82, 0.035], [-2.84 + drawer, 0.58, rear + 0.56]);
    add(graphite, [0.21, 0.029, 0.039], [-2.84 + drawer, 0.87, rear + 0.593]);
  }
  add(skirting, [1.34, 0.86, 0.066], [2.4, 1.81, rear + 0.11]);
  add(shell, [1.23, 0.75, 0.023], [2.4, 1.81, rear + 0.15]);
  for (const dx of [-0.31, 0.02, 0.35]) {
    add(upholstery, [0.18, 0.22, 0.015], [2.4 + dx, 1.92, rear + 0.166]);
    add(oak, [0.22, 0.07, 0.012], [2.4 + dx, 1.71, rear + 0.165]);
  }
  sign(room, '设计办公室', 2.52, 0.28, [-1.94, 2.87, front + 0.103]);
  sign(room, '打样评审', 1.18, 0.22, [-2.84, 1.59, rear + 0.102]);
  const entry = sign(room, '设计室入口', 1.41, 0.19, [right + 0.086, 2.52, 1.34]);
  entry.rotation.y = Math.PI / 2;
  room.userData.setOfficeLights = (night) => {
    officeDiffuser.emissiveIntensity = night ? 2.0 : 0.72;
    officeLights.forEach((light) => { light.intensity = night ? 54 : 18; });
  };
  room.userData.setOfficeLights(false);
  finish();
  return room;
}

function buildTransferGate(hall, x, z, target, title, limits, { jambOffset = 0.65, sillHeight = 0.59 } = {}) {
  const gate = new THREE.Group();
  gate.name = title;
  gate.position.set(x, 0, z);
  hall.add(gate);
  const shell = sheet(0x658087, 0.68, 0.20);
  const lower = sheet(0x4b6268, 0.86, 0.16);
  const graphite = sheet(0x2b454b, 0.55, 0.28);
  const metal = sheet(0x87989a, 0.50, 0.34);
  const warning = sheet(0xc98950, 0.66, 0.16);
  const glazed = new THREE.MeshStandardMaterial({ color: 0x9ebfc4, transparent: true, opacity: 0.18, depthWrite: false, roughness: 0.32 });
  const lampOpen = stencil(0x8cd7b4);
  const lampClosed = stencil(0xe9a96b);
  const { add, finish } = boxBatches(gate);
  const top = 2.54;
  const doorHeight = top - 0.05 - sillHeight;
  const wallHeight = 3.24;
  const segments = [[limits[0] - z, -jambOffset], [jambOffset, limits[1] - z]];
  for (const [start, end] of segments) {
    const span = end - start;
    if (span < 0.12) continue;
    const center = (start + end) / 2;
    add(lower, [0.12, 0.64, span], [0, 0.32, center], undefined, true);
    add(glazed, [0.067, 1.68, span], [0, 1.49, center]);
    add(shell, [0.13, 0.65, span], [0, wallHeight - 0.325, center], undefined, true);
    add(graphite, [0.145, 0.06, span], [0, 2.29, center]);
    add(graphite, [0.145, 0.07, span], [0, 0.65, center]);
    const panelCount = Math.max(1, Math.round(span / 1.43));
    for (let panel = 0; panel <= panelCount; panel++) {
      add(graphite, [0.15, wallHeight, 0.055], [0, wallHeight / 2, start + span * panel / panelCount], undefined, true);
    }
  }
  add(lower, [0.126, 0.56, 2 * jambOffset], [0, 2.87, 0], undefined, true);
  add(graphite, [0.31, 0.34, 2 * jambOffset + 0.10], [0, top + 0.06, 0], undefined, true);
  for (const side of [-1, 1]) {
    add(graphite, [0.28, top + 0.14, 0.10], [0, (top + 0.14) * 0.5, side * jambOffset], undefined, true);
    add(metal, [0.086, top - 0.50, 0.068], [0.045, (top + 0.49) * 0.5, side * (jambOffset - 0.059)]);
    add(warning, [0.062, 0.29, 0.073], [-0.18, 0.86, side * (jambOffset + 0.002)]);
    add(graphite, [0.066, 0.073, 0.077], [-0.182, 0.91, side * (jambOffset + 0.002)]);
  }
  const plaque = sign(gate, title, 1.32, 0.18, [0.161, top + 0.07, 0]);
  plaque.rotation.y = Math.PI / 2;
  const reverse = sign(gate, title, 1.32, 0.18, [-0.161, top + 0.07, 0]);
  reverse.rotation.y = -Math.PI / 2;
  finish();

  const shutter = new THREE.Group();
  shutter.position.y = top - 0.05;
  gate.add(shutter);
  const { add: shutterPart, finish: finishShutter } = boxBatches(shutter);
  const shutterWidth = 2 * jambOffset - 0.06;
  shutterPart(metal, [0.087, doorHeight, shutterWidth], [0, -doorHeight * 0.5, 0], undefined, true);
  for (let slat = 1; slat < 12; slat++) shutterPart(shell, [0.105, 0.014, shutterWidth - 0.006], [0, -slat * doorHeight / 12, 0]);
  shutterPart(warning, [0.104, 0.075, shutterWidth + 0.002], [0, -doorHeight + 0.039, 0]);
  finishShutter();
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.026, 0.38), lampClosed);
  lamp.position.set(0.036, top + 0.256, 0);
  gate.add(lamp);

  return {
    group: gate, x, z, target,
    positionCargo(cargoX, cargoZ) {
      const dx = cargoX - x;
      const approach = THREE.MathUtils.smoothstep(dx, -2.25, -0.69);
      const clear = 1 - THREE.MathUtils.smoothstep(dx, 0.63, 1.31);
      const aligned = 1 - THREE.MathUtils.smoothstep(Math.abs(cargoZ - z), jambOffset - 0.19, jambOffset + 0.21);
      return approach * clear * aligned;
    },
    setOpening(open) {
      shutter.scale.y = Math.max(0.006, 1 - open);
      lamp.material = open > 0.88 ? lampOpen : lampClosed;
    },
  };
}

export function buildHall(scene, positions) {
  const hall = new THREE.Group();
  hall.name = 'Workshop shell and floor markings';
  scene.add(hall);
  const { add: box, finish } = boxBatches(hall);
  const floor = sheet(0x626970, 0.93, 0.04);
  floor.map = concreteTexture();
  const platform = new THREE.Mesh(new THREE.PlaneGeometry(platformWidth, platformDepth), floor);
  platform.rotation.x = -Math.PI / 2;
  platform.position.set(floorCenter[0], 0, floorCenter[1]);
  platform.receiveShadow = true;
  hall.add(platform);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(220, 220), sheet(0x272d33, 0.98, 0));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.66;
  ground.receiveShadow = true;
  hall.add(ground);

  const slab = sheet(0x454b50, 0.91, 0.03);
  const foot = sheet(0x2a3237, 0.82);
  const trim = sheet(0x68727a, 0.51, 0.45);
  const seam = sheet(0x3f464c, 0.95);
  const safety = sheet(0xc4914c, 0.84, 0);
  box(slab, [platformWidth, 0.32, platformDepth], [floorCenter[0], -0.162, floorCenter[1]], undefined, true);
  box(foot, [platformWidth + 0.28, 0.22, platformDepth + 0.28], [floorCenter[0], -0.428, floorCenter[1]], undefined, true);
  box(foot, [platformWidth - 0.58, 0.124, platformDepth - 0.58], [floorCenter[0], -0.599, floorCenter[1]]);
  box(trim, [platformWidth - 0.12, 0.032, 0.041], [floorCenter[0], -0.252, floorCenter[1] + platformDepth / 2 + 0.014]);
  for (const side of [-1, 1]) {
    const edgeX = floorCenter[0] + side * (platformWidth / 2 + 0.014);
    box(trim, [0.041, 0.032, platformDepth - 0.12], [edgeX, -0.252, floorCenter[1]]);
    box(safety, [1.10, 0.008, 0.058], [edgeX - side * 0.9, 0.007, floorCenter[1] + platformDepth / 2 - 0.34]);
    box(safety, [0.058, 0.008, 0.88], [edgeX - side * 0.4, 0.007, floorCenter[1] + platformDepth / 2 - 0.75]);
  }
  for (let x = -10.4; x < 15; x += 3.47) box(seam, [0.027, 0.002, platformDepth - 0.22], [x, 0.002, floorCenter[1]]);
  for (const z of [-3.6, 0, 3.6, 7.2, 10.8, 14.4]) box(seam, [platformWidth - 0.32, 0.002, 0.025], [floorCenter[0], 0.002, z]);

  const walkway = sheet(0x3c7770, 0.93, 0.03);
  const walkwayEdge = sheet(0xe2eed5, 0.81, 0.03);
  const crossingPaint = sheet(0xf0dcab, 0.71, 0.03);
  const patrolPaint = sheet(0x7fcaff, 0.65, 0.10);
  const filamentPaint = sheet(0xe5bd7c, 0.69, 0.08);
  const checkpointPaint = sheet(0x6de4ed, 0.59, 0.20);

  const paintRun = (material, from, to, width, y) => {
    const dx = to[0] - from[0];
    const dz = to[2] - from[2];
    const length = Math.hypot(dx, dz);
    if (length < 0.01) return;
    box(material, [length, 0.003, width], [(from[0] + to[0]) / 2, y, (from[2] + to[2]) / 2], [0, -Math.atan2(dz, dx), 0]);
  };
  for (const { points, width } of HUMAN_WALKWAYS) {
    for (let index = 1; index < points.length; index++) {
      const start = points[index - 1];
      const end = points[index];
      paintRun(walkwayEdge, start, end, width, 0.020);
      paintRun(walkway, start, end, width - 0.085, 0.023);
    }
    for (const [x, , z] of points.slice(1, -1)) {
      box(walkwayEdge, [width, 0.003, width], [x, 0.020, z]);
      box(walkway, [width - 0.085, 0.003, width - 0.085], [x, 0.024, z]);
    }
  }

  const paintedEdges = new Set();
  const paintRoute = (points, material, y, offset = 0) => {
    for (let index = 1; index < points.length; index++) {
      const start = points[index - 1];
      const end = points[index];
      const key = [start.join(','), end.join(',')].sort().join('|') + '/' + y;
      if (paintedEdges.has(key)) continue;
      paintedEdges.add(key);
      const dx = end[0] - start[0];
      const dz = end[2] - start[2];
      const length = Math.hypot(dx, dz);
      if (length === 0) continue;
      const sample = (d) => [start[0] + (dx * d - dz * offset) / length, y, start[2] + (dz * d + dx * offset) / length];
      for (let d = 0; d < length; d += 0.94) paintRun(material, sample(d), sample(Math.min(d + 0.60, length)), 0.055, y);
    }
  };
  const chargeRoutePaint = sheet(0x9abbe8, 0.75, 0.10);
  paintRoute(NORTH_CHARGE_AISLE, chargeRoutePaint, 0.030);
  paintRoute(PATROL_WAYPOINTS.map(({ point }) => point), patrolPaint, 0.029);
  Object.values(FILAMENT_DELIVERY_ROUTES).forEach((route) => paintRoute(route, filamentPaint, 0.031, 0.15));
  for (const { point: [x, , z], station } of PATROL_WAYPOINTS) {
    if (station) box(checkpointPaint, [0.22, 0.004, 0.22], [x, 0.034, z], [0, Math.PI / 4, 0]);
  }
  for (const { point: [x, , z], angle, width, length } of HUMAN_CROSSINGS) {
    const stripes = 6;
    for (let step = 0; step < stripes; step++) {
      const offset = ((step + 0.5) / stripes - 0.5) * length;
      box(crossingPaint, [length / (stripes * 1.9), 0.004, width - 0.08], [x + Math.cos(angle) * offset, 0.036, z - Math.sin(angle) * offset], [0, angle, 0]);
    }
  }
  sign(hall, '人员通道', 2.40, 0.36, [-8.8, 0.040, 19.87], { floor: true, color: '#e1f7db' });
  sign(hall, '巡检路线', 1.92, 0.35, [-10.45, 0.037, 10.95], { floor: true, color: '#b9ddff' });
  sign(hall, '仓储人员通道', 2.56, 0.34, [20.1, 0.027, 8.8], { floor: true, color: '#e1f7db' });
  sign(hall, '外围检修通道', 2.40, 0.35, [29.2, 0.042, -8.85], { floor: true, color: '#e1f7db' });

  const zoneFloor = sheet(0x535d62, 0.91, 0.01);
  const service = sheet(0x506871, 0.87, 0.04);
  function zone(x, z, width, depth, boundary, material = zoneFloor) {
    box(material, [width, 0.004, depth], [x, 0.004, z]);
    for (const side of [-1, 1]) {
      box(boundary, [width, 0.003, 0.041], [x, 0.008, z + side * depth / 2]);
      box(boundary, [0.041, 0.003, depth], [x + side * width / 2, 0.008, z]);
    }
  }
  zone(positions.design[0], positions.design[2], 3.98, 2.72, service);
  const robotPad = sheet(0x605a51, 0.91, 0.02);
  for (const [index, { printers, quality, boxes, robot, buffer }] of productionLines.entries()) {
    const { label, center: [x, , z], size: [w, d], labelPoint, color, floor: groundColor } = productionPads[index];
    const border = sheet(color, 0.79, 0.06);
    box(sheet(groundColor, 0.91, 0.03), [w, 0.002, d], [x, 0.0023, z]);
    for (const side of [-1, 1]) {
      box(border, [w, 0.002, 0.045], [x, 0.004, z + side * d / 2]);
      box(border, [0.045, 0.002, d], [x + side * w / 2, 0.004, z]);
    }
    sign(hall, label, 2.62, 0.46, [labelPoint[0], 0.012, labelPoint[2]], { floor: true, color });
    zone(positions[printers[1]][0], positions[printers[1]][2] - 0.31, 10.1, 2.76, border);
    zone(positions[quality][0], positions[quality][2] - 0.25, 3.27, 2.74, border);
    zone(positions[boxes][0], positions[boxes][2], 4.75, 2.56, border);
    zone(positions[robot][0], positions[robot][2], 4.12, 3.35, safety, robotPad);
    zone(positions[buffer][0], positions[buffer][2], 4.65, 2.21, border);
  }
  sign(hall, '机械臂作业区', 2.26, 0.37, [6.63, 0.013, 3.5], { floor: true, color: '#efce91' });

  // Support zones: charging, patrol and environmental hold are separated from the production aisles.
  const chargeFloor = sheet(0x344f76, 0.89, 0.04);
  const chargeBorder = sheet(0x85b9ff, 0.57, 0.28);
  const environmentalFloor = sheet(0x6d3f47, 0.9, 0.02);
  const environmentalBorder = sheet(0xe78072, 0.58, 0.26);
  const packagingFloor = sheet(0x326c66, 0.91, 0.02);
  const packagingBorder = sheet(0x82d8b9, 0.64, 0.24);

  // Matches the dedicated models in logistics-platform.js.
  zone(PACKAGING_WAREHOUSE_CENTER[0], PACKAGING_WAREHOUSE_CENTER[2], 2.75, 2.40, packagingBorder, packagingFloor);
  zone(FILAMENT_WAREHOUSE_CENTER[0], FILAMENT_WAREHOUSE_CENTER[2], FILAMENT_WAREHOUSE_FOOTPRINT[0] + 0.20, FILAMENT_WAREHOUSE_FOOTPRINT[1] + 0.16, filamentPaint, sheet(0x685544, 0.90, 0.03));
  sign(hall, '打印耗材仓', 2.07, 0.33, [-11, 0.026, -3.51], { floor: true, color: '#f4d5a2' });
  sign(hall, '包装耗材仓', 2.30, 0.34, [16.05, 0.015, -4.32], { floor: true, color: '#b9f2d8' });
  sign(hall, 'FINITE STOCK', 1.78, 0.23, [16.05, 0.017, -3.87], { floor: true, color: '#8ce0c2' });

  const [qaX, , qaZ] = rejectWarehouseCenter;
  zone(qaX, qaZ, ...REJECT_ZONE_SIZE, environmentalBorder, environmentalFloor);
  sign(hall, '隔离周转区', 2.45, 0.28, [qaX + 0.55, 0.017, 12.42], { floor: true, color: '#ffc1a6' });
  const [dockX, , roadZ] = REJECT_TRUCK_PARK;
  const roadStart = dockX - 2.10;
  const floorEnd = floorX + platformWidth / 2;
  const apron = new THREE.Group();
  apron.name = 'Reject collection apron';
  hall.add(apron);
  const { add: apronBox, finish: finishApron } = boxBatches(apron);
  apronBox(slab, [REJECT_APRON_END - floorEnd + 0.02, 0.32, REJECT_ROAD_WIDTH + 0.64],
    [(floorEnd + REJECT_APRON_END) / 2, -0.162, roadZ], undefined, true);
  finishApron();
  const outboundApron = new THREE.Group();
  outboundApron.name = 'Finished goods dispatch apron';
  hall.add(outboundApron);
  const dispatchSlab = boxBatches(outboundApron);
  dispatchSlab.add(slab, [DISPATCH_APRON_END - floorEnd + 0.02, 0.32, DISPATCH_ROAD_WIDTH + 0.60],
    [(floorEnd + DISPATCH_APRON_END) / 2, -0.162, truckPark[2]], undefined, true);
  dispatchSlab.finish();
  const dispatchStart = truckPark[0] + 3.75;
  zone((DISPATCH_APRON_END + dispatchStart) / 2, truckPark[2], DISPATCH_APRON_END - dispatchStart,
    DISPATCH_ROAD_WIDTH, chargeBorder, sheet(0x485563, 0.91, 0.025));
  const dispatchStripe = sheet(0x91b8ce);
  for (let at = dispatchStart + 0.7; at < DISPATCH_APRON_END - 0.60; at += 1.38) {
    box(dispatchStripe, [0.62, 0.004, 0.046], [at, 0.010, truckPark[2]]);
  }
  zone((roadStart + REJECT_APRON_END) / 2, roadZ, REJECT_APRON_END - roadStart, REJECT_ROAD_WIDTH,
    environmentalBorder, sheet(0x48424a, 0.92, 0.025));
  const safetyPaint = sheet(0xefab72, 0.72, 0.15);
  for (let x = dockX + 3.0; x < REJECT_APRON_END - 0.90; x += 1.4) {
    box(safetyPaint, [0.75, 0.004, 0.050], [x, 0.027, roadZ]);
  }
  sign(hall, '不合格品专车道', 2.87, 0.31, [30.7, 0.030, roadZ + 0.60], { floor: true, color: '#ffc1a6' });
  sign(hall, '场外处理交接方向 ›', 3.27, 0.28, [41.9, 0.030, roadZ + 0.65], { floor: true, color: '#ffc1a6' });

  zone(CHARGING_ZONE_CENTER[0], CHARGING_ZONE_CENTER[2], 5.30, 2.30, chargeBorder, chargeFloor);
  sign(hall, '机器人充电站', 2.62, 0.38, [31.45, 0.016, -1.30], { floor: true, color: '#c7e4ff' });
  sign(hall, 'HOT-SWAP / BACKUP', 2.75, 0.23, [31.45, 0.018, -0.72], { floor: true, color: '#93c8ff' });
  const standbyFloor = sheet(0x394e60, 0.89, 0.03);
  const standbyLine = sheet(0x91b4d3, 0.66, 0.18);
  for (const [fleet, { parking }] of Object.entries(MOBILE_FLEET_POSES)) {
    const size = fleet.endsWith('Agv') ? [1.75, 1.05] : fleet === 'inspectionRobot' ? [1.55, 1.80] : [0.79, 0.92];
    for (const [x, , z] of Object.values(parking)) zone(x, z, ...size, standbyLine, standbyFloor);
  }
  const columns = sheet(0x59616a, 0.53, 0.42);
  const steel = sheet(0x333d45, 0.57, 0.42);
  const cladding = sheet(0x525957, 0.81, 0.18);
  const panelLip = sheet(0x646e6e, 0.72, 0.26);
  const glass = sheet(0x758f9d, 0.44, 0.21);
  glass.map = glazingTexture();
  const door = sheet(0x6a7379, 0.64, 0.32);
  const workLights = [];
  const conduit = sheet(0x896758, 0.55, 0.42);

  box(steel, [27.1, 0.20, 0.31], [0, 0.1, rearWall], undefined, true);
  box(columns, [27.3, 0.22, 0.32], [0, 4.22, rearWall], undefined, true);
  box(cladding, [27.15, 0.66, 0.19], [0, 3.81, rearWall - 0.02]);
  box(steel, [27.1, 0.14, 0.28], [0, 3.45, rearWall]);
  box(conduit, [26.74, 0.052, 0.052], [0, 3.31, rearWall + 0.22]);

  for (let bay = 0; bay < 8; bay++) {
    const x = (bay - 3.5) * 3.37;
    const isServiceDoor = bay === 0 || bay === 7;
    box(columns, [0.143, 4.25, 0.32], [x - 1.69, 2.16, rearWall + 0.008], undefined, true);
    box(panelLip, [0.047, 4.11, 0.027], [x - 1.69, 2.13, rearWall + 0.183]);
    box(steel, [0.39, 0.10, 0.56], [x - 1.69, 0.057, rearWall + 0.09]);
    if ([0, 2, 4, 6, 7].includes(bay)) {
      workLights.push(mountLinearLight(hall, {
        name: bay === 7 ? '物料出入口 / LED 灯具' : `A 线墙灯 A${bay + 1}`,
        position: [x, 3.48, rearWall + 0.13], width: isServiceDoor ? 2.24 : 1.82,
        strength: isServiceDoor ? 175 : 135, color: isServiceDoor ? 0xffdfb5 : 0xecf4ff,
      }));
    }

    if (isServiceDoor) {
      box(steel, [3.24, 3.14, 0.25], [x, 1.63, rearWall - 0.015]);
      box(door, [2.84, 2.84, 0.085], [x, 1.5, rearWall + 0.143]);
      for (let slat = 0; slat < 16; slat++) box(steel, [2.8, 0.027, 0.019], [x, 0.18 + slat * 0.172, rearWall + 0.20]);
      box(trim, [2.97, 0.205, 0.182], [x, 3.01, rearWall + 0.166]);
      for (const side of [-1, 1]) {
        box(trim, [0.09, 2.98, 0.145], [x + side * 1.47, 1.52, rearWall + 0.206]);
        box(safety, [0.161, 0.63, 0.15], [x + side * 1.48, 0.34, rearWall + 0.32], undefined, true);
        for (let band = 0; band < 3; band++) {
          box(steel, [0.164, 0.069, 0.158], [x + side * 1.48, 0.27 + band * 0.14, rearWall + 0.32]);
        }
      }
      continue;
    }

    box(cladding, [3.23, 1.37, 0.20], [x, 0.75, rearWall - 0.02]);
    for (let panel = -1; panel <= 1; panel++) {
      const center = x + panel * 1.06;
      box(panelLip, [0.027, 1.18, 0.025], [center - 0.50, 0.77, rearWall + 0.09]);
      box(panelLip, [0.14, 0.037, 0.028], [center + 0.34, 1.17, rearWall + 0.103]);
      box(glass, [0.985, 1.86, 0.045], [center, 2.38, rearWall]);
      box(columns, [0.065, 1.99, 0.14], [center - 0.52, 2.41, rearWall + 0.03]);
    }
    box(steel, [3.26, 0.108, 0.153], [x, 1.43, rearWall + 0.07]);
    box(columns, [3.22, 0.056, 0.096], [x, 2.64, rearWall + 0.056]);
    box(trim, [3.25, 0.055, 0.24], [x, 1.36, rearWall + 0.12]);
  }
  box(columns, [0.143, 4.25, 0.32], [13.485, 2.16, rearWall + 0.008], undefined, true);

  // Keep the front and equipment side open while giving the rear corner real depth.
  const returnX = -13.48;
  const returnDepth = 3.52;
  const returnCenter = rearWall + returnDepth / 2;
  box(cladding, [0.18, 1.40, returnDepth], [returnX, 0.71, returnCenter], undefined, true);
  box(cladding, [0.18, 0.65, returnDepth], [returnX, 3.83, returnCenter], undefined, true);
  box(steel, [0.28, 0.14, returnDepth], [returnX, 1.41, returnCenter]);
  box(steel, [0.27, 0.17, returnDepth], [returnX, 3.45, returnCenter]);
  box(columns, [0.31, 0.22, returnDepth + 0.017], [returnX, 4.22, returnCenter], undefined, true);
  for (let column = 1; column <= 4; column++) {
    const z = rearWall + column * returnDepth / 4;
    box(columns, [0.28, 4.20, 0.105], [returnX, 2.13, z], undefined, true);
    box(glass, [0.051, 1.86, 0.79], [returnX, 2.43, z - returnDepth / 8]);
    box(panelLip, [0.022, 1.18, 0.023], [returnX + 0.102, 0.77, z - 0.086]);
  }
  workLights.push(mountLinearLight(hall, {
    name: 'RGB 耗材仓 / 取料泊位照明', position: [returnX + 0.13, 3.45, -4.81], yaw: Math.PI / 2,
    width: 1.44, strength: 132, standby: 12, color: 0xffe3bd, aim: [0.25, -3.1, 2.45],
  }));

  for (const x of [-13.48, -6.74, 0, 6.74, 13.48]) {
    box(steel, [0.19, 0.19, 1.51], [x, 4.14, -6.13], undefined, true);
    box(columns, [0.095, 1.38, 0.12], [x, 3.77, -6.26], [Math.PI * 0.31, 0, 0], true);
    box(steel, [0.27, 0.23, 0.032], [x, 3.39, rearWall + 0.19]);
  }
  for (const x of [-8.9, 1.85, 8.75]) {
    box(conduit, [0.044, 2.63, 0.041], [x, 1.99, rearWall + 0.15]);
    box(steel, [0.39, 0.54, 0.19], [x, 0.55, rearWall + 0.15], undefined, true);
    box(trim, [0.29, 0.42, 0.04], [x, 0.55, rearWall + 0.262]);
    box(safety, [0.052, 0.071, 0.021], [x + 0.075, 0.67, rearWall + 0.294]);
  }
  for (const x of [-11.79, 11.79]) {
    box(safety, [3.1, 0.004, 0.033], [x, 0.006, -6.03]);
    for (let mark = -6; mark <= 6; mark++) {
      box(safety, [0.038, 0.004, 0.20], [x + mark * 0.234, 0.006, -6.17], [0, Math.PI / 4, 0]);
    }
  }
  // Second production bay is enclosed by its own glazed thermal shell.
  const northWall = 20.80;
  box(steel, [27.1, 0.20, 0.31], [0, 0.1, northWall], undefined, true);
  box(cladding, [27.15, 0.66, 0.19], [0, 3.81, northWall - 0.02]);
  box(columns, [27.3, 0.22, 0.32], [0, 4.22, northWall], undefined, true);
  for (let bay = 0; bay < 8; bay++) {
    const x = (bay - 3.5) * 3.37;
    box(glass, [2.72, 1.93, 0.045], [x, 2.30, northWall]);
    box(columns, [0.14, 3.92, 0.19], [x - 1.68, 2.04, northWall + 0.02], undefined, true);
    box(trim, [2.77, 0.055, 0.24], [x, 1.35, northWall + 0.12]);
    box(columns, [2.78, 0.06, 0.10], [x, 2.64, northWall + 0.06]);
    if ([0, 2, 4, 7].includes(bay)) {
      workLights.push(mountLinearLight(hall, {
        name: `B 线墙灯 B${bay + 1}`, position: [x, 3.71, northWall - 0.115], yaw: Math.PI,
        strength: 156, color: 0xecf4ff, aim: [0, -3.5, 2.95],
      }));
    }
  }
  box(columns, [0.14, 3.92, 0.19], [13.48, 2.04, northWall + 0.02], undefined, true);
  sign(hall, '设备检修', 1.65, 0.32, [-11.79, 3.83, rearWall + 0.10]);
  sign(hall, '增材制造', 2.24, 0.36, [-5.05, 3.83, rearWall + 0.10]);
  sign(hall, '后处理与质检', 2.74, 0.36, [5.05, 3.83, rearWall + 0.10]);
  sign(hall, '物料出入口', 2.08, 0.32, [11.79, 3.83, rearWall + 0.10]);
  // Each plaque owns a separate wall span: coplanar overlap causes depth flicker.
  const bSignZ = northWall + 0.14;
  sign(hall, '增材制造 B', 2.34, 0.36, [-5.05, 3.83, bSignZ]);
  sign(hall, '并行生产 B 区', 2.48, 0.34, [0, 3.83, bSignZ]);
  sign(hall, '后处理 B 区', 2.18, 0.36, [5.05, 3.83, bSignZ]);

  // Low traffic stays in front of the two bays. Both the post and its anchors are behind them.
  const { primary: boxPrimary, backup: boxBackup } = MOBILE_FLEET_POSES.packagingRobot.parking;
  const dockPostX = (boxPrimary[0] + boxBackup[0]) / 2;
  const dockPostZ = boxPrimary[2] - 0.55;
  box(steel, [0.26, 0.07, 0.29], [dockPostX, 0.035, dockPostZ], undefined, true);
  box(columns, [0.105, 2.97, 0.102], [dockPostX, 1.49, dockPostZ], undefined, true);
  box(columns, [1.55, 0.105, 0.104], [dockPostX, 2.94, dockPostZ], undefined, true);
  workLights.push(mountLinearLight(hall, {
    name: '盒坯机器人泊位 / LED 作业灯', position: [dockPostX, 2.94, dockPostZ + 0.052],
    width: 1.47, strength: 118, color: 0xffe4c0, aim: [0, -2.55, 1.7],
  }));
  const designOffice = buildDesignOffice(hall, positions.design);
  const thermalGates = [
    buildTransferGate(hall, 1.7, -1.43, ['quality', 'quality2'], '恒温物流门 A', [-4.05, 3.46]),
    buildTransferGate(hall, 1.7, 10.07, ['quality2'], '恒温物流门 B', [7.87, 16.67]),
  ];
  // Mount inspection lights to the opaque upper bands, above both service aisles.
  for (const [index, { group }] of thermalGates.entries()) {
    const workBay = index === 0 ? 'A' : 'B';
    for (const face of [-1, 1]) {
      workLights.push(mountLinearLight(group, {
        name: `${workBay} 线隔墙 / 工位照明`, position: [face * 0.06, 2.98, index === 0 ? 2.40 : 2.85],
        yaw: face * Math.PI / 2, width: 1.30, color: 0xe2eeff, strength: 92,
        aim: [face * 0.75, -2.35, 3.0],
      }));
    }
  }
  // The downstream portal clears the scanner frame and leaves the north AGV bypass open.
  const corridorGate = buildTransferGate(hall, 15.98, 2.72, ['sort', 'exception'], '仓储隔热门', [1.15, 4.43], {
    jambOffset: 1.38, sillHeight: 0.67,
  });
  finish();
  return {
    designOffice,
    setNightLighting(night) {
      designOffice.userData.setOfficeLights(night);
      workLights.forEach((setNight) => setNight(night));
    },
    update(sim) {
      const active = sim?.transfers ?? [];
      const openGate = (gate) => {
        let open = 0;
        for (const transfer of active) {
          if (!gate.target.includes(transfer.to)) continue;
          const travel = getMaterialTravel(transfer.from, transfer.to);
          if (!travel) continue;
          const distance = travel.length * THREE.MathUtils.clamp(transfer.progress, 0, 1);
          const step = travel.steps.find((candidate) => distance <= candidate.offset + candidate.distance) ?? travel.steps.at(-1);
          const p = THREE.MathUtils.clamp((distance - step.offset) / Math.max(step.distance, 0.001), 0, 1);
          open = Math.max(open, gate.positionCargo(
            THREE.MathUtils.lerp(step.start[0], step.end[0], p),
            THREE.MathUtils.lerp(step.start[2], step.end[2], p)));
        }
        gate.setOpening(THREE.MathUtils.smoothstep(open, 0.10, 0.86));
      };
      thermalGates.forEach(openGate);
      openGate(corridorGate);
    },
  };
}

export function buildLights(scene, { capture = false } = {}) {
  const ambient = new THREE.HemisphereLight(0xe8eff7, 0x5d5751, 2.1);
  scene.add(ambient);
  const key = new THREE.DirectionalLight(0xfff0dd, 3.08);
  key.position.set(-1.0, 18, 13);
  key.target.position.set(8.5, 0, 0);
  key.castShadow = true;
  key.shadow.mapSize.setScalar(capture ? 3072 : 2048);
  key.shadow.intensity = capture ? 0.62 : 1;
  key.shadow.camera.left = -28;
  key.shadow.camera.right = 29;
  key.shadow.camera.top = 18;
  key.shadow.camera.bottom = -19;
  key.shadow.camera.far = 64;
  key.shadow.normalBias = 0.023;
  key.shadow.bias = -0.00025;
  key.shadow.radius = 2.6;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(0xb6d2e4, 1.28);
  fill.position.set(7, 9, -8);
  scene.add(fill);
  const bounce = new THREE.DirectionalLight(0xe8edf3, 0.66);
  bounce.position.set(15, 6, 14);
  scene.add(bounce);

  const downlights = new THREE.Group();
  downlights.name = 'Night shift work lights';
  const fixtures = new THREE.Group();
  fixtures.name = 'Column-mounted industrial work lights';
  const housing = sheet(0x303f4c, 0.51, 0.46);
  const bracket = sheet(0x65717d, 0.52, 0.38);
  const lens = new THREE.MeshStandardMaterial({ color: 0xc9dce7, emissive: 0xd5eaff, emissiveIntensity: 0.08 });
  const workAreas = [
    ['C-A2', 1, [-5.0, 0, -1.0], 205],
    ['C-A3', 1, [4.9, 0, -0.5], 205],
    ['C-A4', 1, [14.8, 0, -2.6], 220],
    ['C-B2', -1, [-6.4, 0, 12.2], 290],
    ['C-B3', -1, [1.2, 0, 15.1], 315],
    ['C-E1', 1, [27.0, 0, -2.0], 320],
    ['C-E1', -1, [36.7, 0, -6.1], 105, 0xffe5c1],
    ['C-E2', 1, [24.3, 0, 11.8], 295, 0xffdfb9],
  ];
  const { add, finish } = boxBatches(fixtures);
  for (const [id, face, [tx, ty, tz], intensity, color = 0xd8edff] of workAreas) {
    const { center: [x, z], sectionDepth, height } = ENGINEERING_LAYOUT.columns.find((column) => column.id === id);
    const y = height - 0.94;
    const flange = z + face * sectionDepth / 2;
    // The backplate intersects the column flange and the arm meets both housings.
    add(bracket, [0.23, 0.23, 0.045], [x, y, flange]);
    add(bracket, [0.11, 0.10, 0.32], [x, y, flange + face * 0.15]);
    add(housing, [0.34, 0.11, 0.29], [x, y - 0.055, flange + face * 0.30]);
    add(lens, [0.291, 0.023, 0.235], [x, y - 0.116, flange + face * 0.30]);
    const light = new THREE.SpotLight(color, intensity, 24, Math.PI * 0.30, 0.65, 2);
    light.position.set(x, y - 0.135, flange + face * 0.30);
    light.target.position.set(tx, ty, tz);
    downlights.add(light, light.target);
  }
  finish();
  scene.add(fixtures, downlights);
  downlights.visible = false;

  return function setNightLighting(night) {
    ambient.color.setHex(night ? 0x9bbce8 : 0xe8eff7);
    ambient.groundColor.setHex(night ? 0x455368 : 0x5d5751);
    ambient.intensity = night ? 1.34 : 2.1;
    key.color.setHex(night ? 0xb1caff : 0xfff0dd);
    key.intensity = night ? 0.16 : 3.08;
    key.shadow.intensity = night ? 0.42 : capture ? 0.62 : 1;
    fill.intensity = night ? 0.28 : 1.28;
    bounce.intensity = night ? 0.16 : 0.66;
    lens.emissiveIntensity = night ? 2.5 : 0.08;
    downlights.visible = night;
  };
}

