import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mountLinearLight } from './work-light.js';

// Clear of the east service walkway (ends at z=9.10), the reject truck lane
// (starts at z=13.29), and the reject gantry to the west. Extents include trim.
export const CONTROL_ROOM_CENTER = Object.freeze([31.10, 0, 11.07]);
export const CONTROL_ROOM_SIZE = Object.freeze([6.76, 3.56]);
const WIDTH = 3.64;
const HEIGHT = 2.08;
const SCREEN_CENTER = [0, 1.94, -1.45];
// Stand in the viewing bay, before the dedicated truck lane, so passing cargo
// cannot occlude the physical screen or its interactive overlay.
const CAMERA_LOCAL = [0, SCREEN_CENTER[1], 2.17];

const cube = new THREE.BoxGeometry(1, 1, 1);
const rounded = new Map();
const steel = (color, roughness = 0.69, metalness = 0.22) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness });
const ink = (color) => new THREE.MeshBasicMaterial({ color, toneMapped: false });
const palette = {
  plinth: steel(0x2c383d), frame: steel(0x35494f, 0.52, 0.34),
  trim: steel(0x829b9d, 0.47, 0.42), shell: steel(0xb7b9ab, 0.84, 0.08),
  floor: steel(0x686f68, 0.93, 0.05), seam: steel(0x464e49, 0.94, 0.02),
  oak: steel(0xad845d, 0.81, 0.03), cabinet: steel(0x586d70),
  seat: steel(0x385b59, 0.93, 0.02), bezel: steel(0x101b20, 0.44, 0.26),
  graphite: steel(0x29383d, 0.7, 0.14), rubber: steel(0x273135, 0.91, 0.02),
  mint: ink(0x8ed9cc), amber: ink(0xe3b773), light: ink(0xe1f3e7),
};

function blocks(parent) {
  const batches = new Map();
  const part = new THREE.Object3D();
  function add(material, size, position, { radius = 0, pitch = 0, yaw = 0, shadow = false } = {}) {
    if (radius) {
      const key = `${size.join('/')}/${radius}`;
      if (!rounded.has(key)) rounded.set(key, new RoundedBoxGeometry(...size, 2, radius));
      const mesh = new THREE.Mesh(rounded.get(key), material);
      mesh.position.set(...position);
      mesh.rotation.set(pitch, yaw, 0);
      mesh.castShadow = shadow;
      mesh.receiveShadow = !material.isMeshBasicMaterial;
      parent.add(mesh);
      return;
    }
    const key = `${material.id}/${shadow}`;
    if (!batches.has(key)) batches.set(key, { material, shadow, matrices: [] });
    part.scale.set(...size);
    part.position.set(...position);
    part.rotation.set(pitch, yaw, 0);
    part.updateMatrix();
    batches.get(key).matrices.push(part.matrix.clone());
  }
  function finish() {
    for (const { material, shadow, matrices } of batches.values()) {
      const batch = new THREE.InstancedMesh(cube, material, matrices.length);
      batch.castShadow = shadow;
      batch.receiveShadow = !material.isMeshBasicMaterial;
      matrices.forEach((matrix, index) => batch.setMatrixAt(index, matrix));
      parent.add(batch);
    }
  }
  return { add, finish };
}

function graphic(parent, size, position, fallback, draw) {
  const material = ink(fallback);
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = Math.round(canvas.width * size[1] / size[0]);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      draw(ctx, canvas.width, canvas.height);
      material.color.set(0xffffff);
      material.map = new THREE.CanvasTexture(canvas);
      material.map.colorSpace = THREE.SRGBColorSpace;
      material.map.anisotropy = 8;
    }
  }
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(...size), material);
  mesh.position.set(...position);
  parent.add(mesh);
  return mesh;
}

function plaque(parent, size, position, title, detail, accent = '#93d7ca') {
  return graphic(parent, size, position, 0x213139, (ctx, w, h) => {
    ctx.fillStyle = '#213139';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, Math.max(8, h * 0.05), h);
    const inset = h * 0.20;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#edf1e7';
    ctx.font = `700 ${Math.round(h * 0.47)}px "Microsoft YaHei", sans-serif`;
    ctx.fillText(title, inset, h * 0.39, w - inset * 2);
    ctx.fillStyle = accent;
    ctx.font = `600 ${Math.round(h * 0.22)}px Consolas, monospace`;
    ctx.fillText(detail, inset, h * 0.77, w - inset * 2);
  });
}

function glass(parent, width, height, position, yaw, opacity) {
  const material = new THREE.MeshBasicMaterial({
    color: 0xa9cdd1, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide,
  });
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  pane.position.set(...position);
  pane.rotation.y = yaw;
  // Decorative glazing must not intercept picks of the display behind it.
  pane.raycast = () => {};
  parent.add(pane);
}

function addFacade(group, add) {
  const { frame, trim, oak, amber, graphite, light } = palette;
  const front = 1.66;
  const rear = -1.70;
  const side = 3.27;
  const opening = 1.55;
  const ceiling = 3.34;
  const sill = 0.13;
  const head = 3.03;
  const glazingHeight = head - sill;
  const glassY = (head + sill) / 2;

  // Roof and opaque returns are cut away for the workshop's high overview.
  // Omit the center lite in the cutaway: neither picks nor the projected display
  // should have to pass through a tinted surface. The wings remain glazed.
  for (const x of [-side, -opening, opening, side]) {
    add(frame, [0.082, head, 0.115], [x, head / 2 + 0.035, front]);
  }
  add(frame, [6.66, 0.28, 0.21], [0, (head + ceiling) / 2, front], { shadow: true });
  add(trim, [6.62, 0.07, 0.12], [0, 0.098, front]);
  add(amber, [6.54, 0.023, 0.018], [0, 3.298, front + 0.108]);
  add(light, [2.85, 0.018, 0.056], [0, head - 0.008, front - 0.055]);

  for (const sign of [-1, 1]) {
    const x = sign * (side + opening) / 2;
    glass(group, side - opening - 0.05, glazingHeight, [x, glassY, front], 0, 0.15);
    add(trim, [side - opening - 0.07, 0.06, 0.024], [x, 1.05, front + 0.017]);
    add(oak, [side - opening - 0.09, 0.22, 0.045], [x, 0.255, front - 0.023]);
    add(frame, [0.12, 0.18, 3.40], [sign * side, 3.23, -0.02], { shadow: true });
    add(frame, [0.083, 3.16, 0.09], [sign * side, 1.62, rear + 0.05]);
    add(light, [0.032, 0.025, 1.63], [sign * (side - 0.04), 3.129, -0.19]);
  }

  // East-side entry has no door leaf or landing protruding into neighboring aisles.
  const sides = [[-side, [[rear + 0.09, front]]], [side, [[rear + 0.09, 0.11], [1.19, front]]]];
  for (const [x, runs] of sides) {
    for (const [start, end] of runs) {
      const z = (start + end) / 2;
      glass(group, end - start - 0.065, glazingHeight, [x, glassY, z], Math.PI / 2, 0.14);
      add(frame, [0.074, 0.12, end - start], [x, 0.106, z]);
      add(trim, [0.026, 0.05, end - start - 0.065], [x, 1.05, z]);
    }
  }
  for (const z of [0.11, 1.19]) add(frame, [0.10, 3.16, 0.085], [side, 1.62, z]);
  add(graphite, [0.11, 0.24, 1.08], [side, 3.045, 0.65]);
  const entry = plaque(group, [0.99, 0.195], [side + 0.056, 3.042, 0.65], '值班入口', 'STAFF ENTRY', '#e9bc7d');
  entry.rotation.y = Math.PI / 2;
  plaque(group, [3.60, 0.213], [-0.60, 3.171, front + 0.107], '车间监控室', 'FACTORY CONTROL ROOM');
  plaque(group, [0.81, 0.213], [2.55, 3.171, front + 0.107], '中控', 'CR–01', '#e9bc7d');
}

function addConsole(group, add, side, title, code) {
  const { frame, trim, oak, cabinet, seat, rubber, graphite, bezel, mint } = palette;
  const x = side * 2.38;
  const z = -0.55;
  add(oak, [1.48, 0.075, 0.68], [x, 0.813, z], { radius: 0.025, shadow: true });
  add(frame, [1.39, 0.24, 0.07], [x, 0.655, z - 0.263]);
  for (const offset of [-0.64, 0.64]) {
    add(frame, [0.075, 0.71, 0.07], [x + offset, 0.415, z - 0.20]);
    add(trim, [0.078, 0.049, 0.61], [x + offset, 0.081, z]);
  }
  const pedestal = x + side * 0.47;
  add(cabinet, [0.37, 0.61, 0.46], [pedestal, 0.37, z + 0.035], { radius: 0.024, shadow: true });
  for (const y of [0.29, 0.47, 0.59]) add(trim, [0.14, 0.024, 0.032], [pedestal, y, z + 0.269]);
  add(graphite, [0.23, 0.025, 0.166], [x, 0.863, z - 0.17]);
  add(frame, [0.047, 0.217, 0.056], [x, 0.975, z - 0.18]);
  add(bezel, [0.58, 0.342, 0.051], [x, 1.125, z - 0.20], { radius: 0.016 });
  plaque(group, [0.53, 0.287], [x, 1.125, z - 0.173], title, code);
  add(graphite, [0.37, 0.024, 0.138], [x - 0.075, 0.863, z + 0.127], { radius: 0.008 });
  for (const dz of [0.09, 0.124, 0.158]) add(trim, [0.31, 0.003, 0.008], [x - 0.075, 0.876, z + dz]);
  add(rubber, [0.059, 0.025, 0.092], [x + 0.19, 0.862, z + 0.133], { radius: 0.011 });
  add(mint, [0.025, 0.009, 0.006], [x + 0.235, 0.97, z - 0.172]);

  // Desk lamp bolted to the worktop. Its stem supports a hood with a downward-facing diffuser.
  const lampX = x + side * 0.54;
  add(graphite, [0.17, 0.021, 0.15], [lampX, 0.861, z - 0.22], { radius: 0.012 });
  add(trim, [0.026, 0.52, 0.026], [lampX, 1.124, z - 0.22], { radius: 0.008 });
  add(trim, [0.036, 0.032, 0.25], [lampX, 1.384, z - 0.10], { radius: 0.008 });
  add(graphite, [0.23, 0.071, 0.127], [lampX, 1.365, z], { radius: 0.018 });
  const glow = steel(0xd4c3ad, 0.5, 0.01);
  glow.emissive.setHex(0xffd5a2);
  add(glow, [0.19, 0.014, 0.097], [lampX, 1.329, z], { radius: 0.006 });
  const taskLight = new THREE.SpotLight(0xffd5a2, 1.6, 1.9, Math.PI * 0.29, 0.8, 2);
  taskLight.position.set(lampX, 1.319, z);
  taskLight.target.position.set(x + side * 0.25, 0.85, z + 0.16);
  group.add(taskLight, taskLight.target);

  const chairZ = 0.44;
  add(seat, [0.53, 0.10, 0.51], [x, 0.54, chairZ], { radius: 0.045, shadow: true });
  add(seat, [0.49, 0.44, 0.085], [x, 0.785, chairZ + 0.248], { radius: 0.039, pitch: 0.10 });
  add(frame, [0.12, 0.40, 0.07], [x, 0.59, chairZ + 0.216]);
  add(trim, [0.067, 0.36, 0.067], [x, 0.285, chairZ]);
  for (let i = 0; i < 5; i++) {
    const yaw = i * Math.PI * 2 / 5;
    add(frame, [0.057, 0.038, 0.24], [x + 0.12 * Math.sin(yaw), 0.137, chairZ + 0.12 * Math.cos(yaw)], { yaw });
    add(rubber, [0.054, 0.074, 0.054], [x + 0.235 * Math.sin(yaw), 0.101, chairZ + 0.235 * Math.cos(yaw)], { radius: 0.015 });
  }
  for (const offset of [-0.255, 0.255]) {
    add(frame, [0.038, 0.18, 0.048], [x + offset, 0.62, chairZ + 0.06]);
    add(rubber, [0.063, 0.043, 0.25], [x + offset, 0.71, chairZ + 0.01], { radius: 0.016 });
  }
  return (night) => {
    glow.emissiveIntensity = night ? 2.2 : 0.8;
    taskLight.intensity = night ? 4.2 : 1.6;
  };
}

function addMediaWall(group, add) {
  const { shell, frame, graphite, trim, bezel, seam, mint, amber } = palette;
  const rear = -1.70;
  add(shell, [6.66, 3.33, 0.15], [0, 1.665, rear], { shadow: true });
  add(frame, [6.66, 0.15, 0.18], [0, 3.255, rear + 0.015]);
  add(frame, [6.64, 0.13, 0.09], [0, 0.12, rear + 0.078]);
  for (const x of [-3.09, -2.70, -2.31, 2.31, 2.70, 3.09]) {
    add(trim, [0.016, 2.84, 0.014], [x, 1.67, rear + 0.079]);
  }
  add(graphite, [4.21, 3.08, 0.076], [0, 1.695, -1.592], { radius: 0.018 });
  for (const x of [-2.02, 2.02]) {
    add(seam, [0.069, 2.92, 0.018], [x, 1.695, -1.545]);
    add(mint, [0.023, 2.13, 0.017], [x, SCREEN_CENTER[1], -1.529]);
  }
  plaque(group, [2.21, 0.165], [0, 3.127, -1.55], '生产态势总览', 'OPERATIONS  /  VIDEO WALL');

  for (const side of [-1, 1]) {
    const x = side * 2.66;
    const panelTitle = side < 0 ? '产线状态' : '物流状态';
    const panelCode = side < 0 ? 'LINE STATUS' : 'MATERIAL FLOW';
    add(frame, [0.93, 1.46, 0.114], [x, 2.03, -1.573], { radius: 0.025 });
    plaque(group, [0.84, 0.32], [x, 2.535, -1.513], panelTitle, panelCode);
    const rows = side < 0 ? ['A / PRINT', 'B / PRINT', 'QA / SORT'] : ['AGV / DOCK', 'ASRS / RACK', 'QA / HOLD'];
    rows.forEach((row, index) => {
      const y = 2.22 - index * 0.259;
      add(graphite, [0.83, 0.21, 0.027], [x, y, -1.506]);
      plaque(group, [0.57, 0.16], [x - 0.086, y, -1.491], row, `CHANNEL 0${index + 1}`);
      add(bezel, [0.108, 0.094, 0.025], [x + 0.279, y, -1.486], { radius: 0.010 });
      add(index === 2 ? amber : mint, [0.053, 0.037, 0.01], [x + 0.279, y, -1.468]);
    });
    for (const y of [1.38, 1.42, 1.46]) add(seam, [0.59, 0.013, 0.011], [x, y, -1.51]);
  }

  const [, y, z] = SCREEN_CENTER;
  add(trim, [WIDTH + 0.17, HEIGHT + 0.17, 0.052], [0, y, z - 0.078], { radius: 0.022 });
  add(bezel, [WIDTH + 0.108, HEIGHT + 0.11, 0.079], [0, y, z - 0.045], { radius: 0.020 });
  add(mint, [0.050, 0.015, 0.009], [WIDTH / 2 - 0.073, y - HEIGHT / 2 - 0.026, z - 0.005]);

  // Static standby face only; the caller can replace its material/map with live content.
  const screen = graphic(group, [WIDTH, HEIGHT], SCREEN_CENTER, 0x132730, (ctx, w, h) => {
    const background = ctx.createLinearGradient(0, 0, w, h);
    background.addColorStop(0, '#1b3540');
    background.addColorStop(1, '#0f1d25');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#81b7b122';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 32; x < w; x += 32) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    for (let y = 32; y < h; y += 32) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();

    ctx.strokeStyle = '#81c6bd';
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const x = w / 2 + sx * (w / 2 - 23);
      const y = h / 2 + sy * (h / 2 - 23);
      ctx.moveTo(x - sx * 25, y);
      ctx.lineTo(x, y);
      ctx.lineTo(x, y - sy * 25);
    }
    ctx.stroke();
    ctx.fillStyle = '#82c4b9';
    ctx.font = '600 19px Consolas, monospace';
    ctx.fillText('CR–01   /   PRIMARY DISPLAY', 43, 56);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#e5f0e9';
    ctx.font = '700 63px "Microsoft YaHei", sans-serif';
    ctx.fillText('车间监控', w / 2, h / 2 + 12);
    ctx.fillStyle = '#82c4b9';
    ctx.font = '600 23px Consolas, monospace';
    ctx.fillText('WORKSHOP MONITORING', w / 2, h / 2 + 57);
  });
  screen.name = 'CR-01 primary display';
  return screen;
}

/** Attach the physical model and provide a straight-on service view. */
export function buildControlRoom(parent) {
  const group = new THREE.Group();
  group.name = 'CR-01 Workshop control room';
  group.position.set(...CONTROL_ROOM_CENTER);
  parent.add(group);

  const { add, finish } = blocks(group);
  const [padWidth, padDepth] = CONTROL_ROOM_SIZE;
  add(palette.plinth, [padWidth, 0.07, padDepth], [0, 0.033, 0], { shadow: true });
  add(palette.floor, [6.63, 0.019, 3.42], [0, 0.066, -0.005]);
  for (const z of [-1.26, -0.45, 0.36, 1.17]) add(palette.seam, [6.56, 0.003, 0.013], [0, 0.076, z]);
  for (const x of [-2.45, -1.63, -0.81, 0, 0.81, 1.63, 2.45]) {
    add(palette.seam, [0.013, 0.003, 3.38], [x, 0.076, 0]);
  }
  add(palette.amber, [0.083, 0.005, 1.00], [3.17, 0.079, 0.65]);
  addFacade(group, add);
  const screen = addMediaWall(group, add);
  const dutyLights = [
    addConsole(group, add, -1, '生产调度', 'PRODUCTION'),
    addConsole(group, add, 1, '物流调度', 'LOGISTICS'),
  ];
  for (const side of [-1, 1]) {
    dutyLights.push(mountLinearLight(group, {
      name: side < 0 ? '监控室 / 生产席值守灯' : '监控室 / 物流席值守灯',
      position: [side * 3.24, 3.20, -0.18], yaw: -side * Math.PI / 2,
      width: 1.32, color: 0xffecd0, strength: 44, standby: 10, distance: 7, aim: [0, -2.55, 1.42],
    }));
  }
  const setNightLighting = (night) => dutyLights.forEach((setNight) => setNight(night));
  setNightLighting(false);
  finish();

  const worldPoint = (point) => group.localToWorld(new THREE.Vector3(...point)).toArray();
  return {
    group, screen, setNightLighting, width: WIDTH, height: HEIGHT,
    cameraPosition: worldPoint(CAMERA_LOCAL),
    cameraTarget: worldPoint(SCREEN_CENTER),
  };
}
