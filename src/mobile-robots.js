import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { CHARGING_ZONE_CENTER, FILAMENT_PICKUP, FILAMENT_WAREHOUSE_CENTER } from './patrol-layout.js';
import { MOBILE_CHARGING_BAYS } from './mobile-layout.js';

const positiveY = new THREE.Vector3(0, 1, 0);
const geometryCache = new Map();
const labelCache = new Map();

function coating(color, metalness, roughness, emissiveIntensity = 0) {
  return new THREE.MeshStandardMaterial({ color, metalness, roughness, emissive: color, emissiveIntensity });
}

const paint = {
  white: coating('#edf4f8', 0.31, 0.34),
  alloy: coating('#a1b4c5', 0.61, 0.38),
  slate: coating('#45647b', 0.46, 0.43),
  carbon: coating('#1d3346', 0.38, 0.47),
  rubber: coating('#102031', 0.08, 0.86),
  glass: coating('#081320', 0.46, 0.24),
  amber: coating('#e9a852', 0.29, 0.43),
  cyan: coating('#39dce8', 0.26, 0.39, 0.9),
  whiteLamp: coating('#d4fbff', 0.17, 0.31, 1.05),
};

function geometry(key, create) {
  if (!geometryCache.has(key)) geometryCache.set(key, create());
  return geometryCache.get(key);
}

function group(parent, x = 0, y = 0, z = 0) {
  const child = new THREE.Group();
  child.position.set(x, y, z);
  parent?.add(child);
  return child;
}

function mesh(parent, shape, material, x, y, z, shadow = false) {
  const child = new THREE.Mesh(shape, material);
  child.position.set(x, y, z);
  child.castShadow = shadow;
  child.receiveShadow = shadow;
  parent.add(child);
  return child;
}

function box(parent, w, h, d, x, y, z, material, radius = 0, shadow = false) {
  const shape = geometry(`box:${w}:${h}:${d}:${radius}`, () => radius
    ? new RoundedBoxGeometry(w, h, d, 2, Math.min(radius, w * 0.46, h * 0.46, d * 0.46))
    : new THREE.BoxGeometry(w, h, d));
  return mesh(parent, shape, material, x, y, z, shadow);
}

function cylinder(parent, radius, height, x, y, z, material, segments = 16) {
  const shape = geometry(`cyl:${radius}:${height}:${segments}`, () => new THREE.CylinderGeometry(radius, radius, height, segments));
  return mesh(parent, shape, material, x, y, z);
}

function axle(parent, radius, width, x, y, z, material, segments = 16) {
  const part = cylinder(parent, radius, width, x, y, z, material, segments);
  part.rotation.z = Math.PI / 2;
  return part;
}

function label(parent, text, w, h, x, y, z, yaw = 0) {
  if (typeof document === 'undefined') return;
  if (!labelCache.has(text)) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#162b3c';
    ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = '#54cfdb';
    ctx.fillRect(0, 0, 9, 64);
    ctx.fillStyle = '#f0f6fa';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 34px Consolas, "Microsoft YaHei", monospace';
    ctx.fillText(text, 132, 32, 221);
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 4;
    labelCache.set(text, new THREE.MeshBasicMaterial({ map, toneMapped: false }));
  }
  const shape = geometry(`label:${w}:${h}`, () => new THREE.PlaneGeometry(w, h));
  mesh(parent, shape, labelCache.get(text), x, y, z).rotation.y = yaw;
}

// The scene lighting controller toggles each registered group through userData.
export function makeVehicleHeadlight(vehicle, origins, aim, { intensity = 18, distance = 7 } = {}) {
  const beams = origins.map((origin) => {
    const light = new THREE.SpotLight(0xd7edff, intensity / origins.length, distance, Math.PI / 5, 0.78, 2);
    light.name = 'Vehicle headlight beam';
    light.position.set(...origin);
    light.target.position.set(...aim);
    vehicle.add(light, light.target);
    return light;
  });
  const lens = paint.whiteLamp.clone();
  let night = false;
  let driving = false;
  function refresh() {
    const enabled = night && driving;
    beams.forEach((light) => { light.visible = enabled; });
    lens.emissiveIntensity = enabled ? 2.3 : driving ? 0.78 : 0.16;
  }
  vehicle.userData.setNightMode = (enabled) => { night = Boolean(enabled); refresh(); };
  refresh();
  return { lens, pose(moving) { driving = Boolean(moving); refresh(); } };
}

export function makeFilamentChargingDock() {
  const dock = group();
  dock.name = 'MAT-01 磁感应充电座';
  dock.position.fromArray(FILAMENT_PICKUP);
  // The primary coil sits between the tire tracks. The two markers sit outside the body envelope.
  const coil = box(dock, 0.34, 0.053, 0.33, 0, -0.016, 0, paint.carbon, 0.015);
  coil.name = 'Recessed induction transmitter';
  box(dock, 0.27, 0.012, 0.25, 0, 0.010, 0, paint.slate, 0.009);
  const indicator = coating('#ffd298', 0.12, 0.49, 0.55);
  for (const z of [-0.409, 0.409]) {
    box(dock, 0.91, 0.026, 0.054, 0, 0.004, z, paint.carbon, 0.009);
    box(dock, 0.66, 0.011, 0.026, 0, 0.018, z, indicator, 0.004);
  }
  // The terminal is bolted to the rack's right-hand front upright, outside the lift/reel travel.
  const x = FILAMENT_WAREHOUSE_CENTER[0] + 1.16 - FILAMENT_PICKUP[0];
  const z = FILAMENT_WAREHOUSE_CENTER[2] + 0.50 - FILAMENT_PICKUP[2];
  box(dock, 0.094, 0.43, 0.046, x, 0.96, z + 0.052, paint.alloy, 0.009);
  box(dock, 0.218, 0.31, 0.13, x, 0.98, z + 0.114, paint.carbon, 0.021);
  box(dock, 0.166, 0.081, 0.013, x, 0.955, z + 0.182, paint.glass, 0.009);
  box(dock, 0.143, 0.023, 0.011, x, 1.023, z + 0.181, indicator, 0.007);
  const meter = box(dock, 0.133, 0.016, 0.004, x, 0.953, z + 0.191, indicator, 0.003);
  label(dock, '充电 / CHG', 0.198, 0.047, x, 1.081, z + 0.184);
  cylinder(dock, 0.018, 0.81, x, 0.420, z + 0.064, paint.slate, 8);
  box(dock, 0.55, 0.014, 0.024, x / 2, 0.003, z + 0.13, paint.slate, 0.004);
  box(dock, 0.024, 0.014, Math.abs(z + 0.13), 0, 0.003, (z + 0.13) / 2, paint.slate, 0.004);

  function update({ parked = true, charging = false, battery = 1 } = {}) {
    const color = charging ? 0x70ffe0 : parked ? 0xc9f5c0 : 0xffcd88;
    indicator.color.setHex(color);
    indicator.emissive.setHex(color);
    indicator.emissiveIntensity = charging ? 2.05 : parked ? 0.83 : 0.32;
    meter.scale.x = Math.max(0.01, battery);
    meter.position.x = x - 0.0665 * (1 - meter.scale.x);
  }
  update();
  return { group: dock, update };
}

export function makeBoxRobotChargingDock(id, position) {
  const dock = group();
  dock.name = `${id} 就地充电座`;
  dock.position.fromArray(position);
  const indicator = coating('#6eb5b9', 0.18, 0.48, 0.49);
  // Embedded plates meet the robot's sole contacts at the floor datum.
  box(dock, 0.81, 0.022, 0.88, 0, -0.009, -0.125, paint.carbon, 0.008);
  for (const x of [-0.153, 0.153]) {
    const contact = box(dock, 0.109, 0.002, 0.14, x, 0.003, 0.045, paint.alloy);
    contact.name = 'Floor charging contact';
  }
  for (const x of [-0.385, 0.385]) {
    box(dock, 0.030, 0.004, 0.48, x, 0.004, -0.032, indicator);
  }
  // The low power module sits behind the standing envelope on the same base.
  const module = box(dock, 0.63, 0.13, 0.19, 0, 0.067, -0.51, paint.slate, 0.019, true);
  module.name = 'Floor dock power module';
  box(dock, 0.59, 0.022, 0.153, 0, 0.137, -0.51, paint.alloy, 0.007);
  box(dock, 0.264, 0.032, 0.043, 0.138, 0.104, -0.418, paint.carbon, 0.007);
  const meter = box(dock, 0.233, 0.012, 0.007, 0.138, 0.104, -0.394, indicator, 0.003);
  label(dock, `${id} / CHG`, 0.27, 0.054, -0.147, 0.082, -0.413);

  function update({ parked = false, charging = false, battery = 1 } = {}) {
    const color = charging ? 0x75ffcd : parked ? 0x8edbdf : 0xe3b369;
    indicator.color.setHex(color);
    indicator.emissive.setHex(color);
    indicator.emissiveIntensity = charging ? 2.2 : parked ? 0.75 : 0.30;
    meter.scale.x = Math.max(0.01, battery);
    meter.position.x = 0.138 - (1 - meter.scale.x) * 0.1165;
  }
  update();
  return { group: dock, update };
}

const agvDeckHeight = 0.36;
const agvRaisedHeight = 0.633;
const wheelRadius = 0.116;

export function makeAgv({ id = 'AGV-01', induction = false } = {}) {
  const chassis = group();
  chassis.name = id;
  const warning = coating('#ffad48', 0.22, 0.32, 0.9);
  const status = coating('#45dce4', 0.23, 0.37, 0.9);
  const headlight = makeVehicleHeadlight(chassis, [-0.28, 0.28].map((x) => [x, 0.202, 0.803]), [0, 0, 2.75], { intensity: 5, distance: 4 });
  if (induction) {
    const receiver = box(chassis, 0.50, 0.048, 0.47, 0, 0.075, 0, paint.carbon, 0.025);
    receiver.name = 'MAT-01 underbody induction receiver';
  }
  const wheels = [];
  const rollers = [];
  box(chassis, 1.11, 0.13, 1.49, 0, 0.15, 0, paint.rubber, 0.065, true);
  box(chassis, 1.24, 0.16, 1.56, 0, 0.234, 0, paint.white, 0.071, true);
  box(chassis, 1.15, 0.04, 1.53, 0, 0.306, 0, paint.carbon, 0.017);
  for (const sign of [-1, 1]) {
    box(chassis, 0.042, 0.067, 0.99, sign * 0.62, 0.23, 0, paint.slate, 0.017);
    box(chassis, 0.045, 0.016, 0.73, sign * 0.627, 0.256, 0, paint.cyan, 0.006);
    box(chassis, 0.78, 0.059, 0.066, 0, 0.177, sign * 0.762, paint.carbon, 0.025);
    if (sign > 0) {
      for (const x of [-0.28, 0.28]) box(chassis, 0.17, 0.029, 0.009, x, 0.202, 0.797, headlight.lens, 0.006);
    } else {
      box(chassis, 0.40, 0.020, 0.009, 0, 0.202, -0.797, warning, 0.006);
    }
    label(chassis, id, 0.33, 0.078, sign * 0.64, 0.224, 0.054, sign * Math.PI / 2);
    for (const z of [-0.52, 0.52]) {
      const wheel = group(chassis, sign * 0.505, wheelRadius, z);
      wheels.push(wheel);
      axle(wheel, wheelRadius, 0.142, 0, 0, 0, paint.rubber, 24).castShadow = true;
      axle(wheel, 0.081, 0.019, sign * 0.072, 0, 0, paint.slate);
      axle(wheel, 0.037, 0.020, sign * 0.088, 0, 0, paint.alloy, 6);
      for (let lug = 0; lug < 8; lug++) {
        const angle = lug * Math.PI / 4;
        axle(wheel, 0.007, 0.022, sign * 0.088, Math.sin(angle) * 0.062, Math.cos(angle) * 0.062, paint.alloy, 6);
      }
    }
    for (const end of [-1, 1]) {
      const corner = group(chassis, sign * 0.49, 0.225, end * 0.693);
      corner.rotation.y = sign * end * 0.34;
      box(corner, 0.195, 0.091, 0.167, 0, 0, 0, paint.carbon, 0.029);
      box(corner, 0.137, 0.025, 0.010, 0, 0.008, end * 0.086, warning, 0.009);
      box(corner, 0.09, 0.041, 0.010, 0, -0.022, end * 0.086, paint.glass, 0.009);
    }
  }
  const lidar = group(chassis, 0, 0.268, 0.742);
  cylinder(lidar, 0.088, 0.048, 0, 0, 0, paint.carbon, 24);
  cylinder(lidar, 0.072, 0.028, 0, 0.03, 0, paint.glass, 24);
  cylinder(lidar, 0.055, 0.010, 0, 0.047, 0, status, 24);
  box(lidar, 0.041, 0.025, 0.009, 0, 0.029, 0.072, paint.cyan, 0.006);

  const deck = group(chassis, 0, agvDeckHeight, 0);
  box(deck, 1.10, 0.047, 1.43, 0, -0.049, 0, paint.carbon, 0.015, true);
  box(deck, 1.10, 0.025, 1.42, 0, -0.030, 0, paint.alloy, 0.011);
  for (const sign of [-1, 1]) {
    box(deck, 0.079, 0.035, 1.43, sign * 0.513, -0.020, 0, paint.slate, 0.013);
    box(deck, 0.026, 0.010, 1.26, sign * 0.523, -0.005, 0, paint.amber, 0.004);
    for (const z of [-0.60, 0.60]) {
      cylinder(deck, 0.016, 0.009, sign * 0.50, -0.0045, z, paint.rubber, 6);
    }
  }
  for (let index = 0; index < 13; index++) {
    const z = -0.648 + index * 0.108;
    const roller = group(deck, 0, -0.027, z);
    axle(roller, 0.027, 0.96, 0, 0, 0, index % 4 === 0 ? paint.carbon : paint.slate, 10);
    rollers.push(roller);
  }
  const liftSections = [];
  for (const sign of [-1, 1]) {
    for (const z of [-0.39, 0.39]) {
      const jack = group(chassis, sign * 0.34, 0.286, z);
      box(jack, 0.132, 0.45, 0.164, 0, 0.225, 0, paint.carbon, 0.025);
      box(jack, 0.090, 0.76, 0.120, 0, 0.62, 0, paint.alloy, 0.015);
      liftSections.push(jack);
    }
  }

  function getCargoHeight(lift = 0) {
    return THREE.MathUtils.lerp(agvDeckHeight, agvRaisedHeight, THREE.MathUtils.clamp(lift, 0, 1));
  }

  function pose({ distance = 0, moving = false, loaded = false, time = 0, lift = 0, deckHeight, rollerTravel = 0, battery = 1, charging = false, yielding = false } = {}) {
    const height = THREE.MathUtils.clamp(deckHeight ?? getCargoHeight(lift), agvDeckHeight, agvRaisedHeight);
    deck.position.y = height;
    for (const section of liftSections) section.scale.y = Math.max(0.014, height - 0.32);
    for (const wheel of wheels) wheel.rotation.x = distance / wheelRadius;
    for (const roller of rollers) roller.rotation.x = rollerTravel / 0.027;
    lidar.rotation.y = time * (moving ? 4.2 : 1.8);
    headlight.pose(!charging && moving);
    const charge = THREE.MathUtils.clamp(Number(battery) || 0, 0, 1);
    warning.emissiveIntensity = charging ? 0.34 + 0.28 * (0.5 + 0.5 * Math.sin(time * 8))
      : moving ? 0.68 + 0.50 * (0.5 + 0.5 * Math.sin(time * 10)) : 0.45 + (1 - charge) * 0.35;
    status.color.set(charging ? '#7ef4ac' : yielding ? '#ffb454' : '#45dce4');
    status.emissive.copy(status.color);
    status.emissiveIntensity = charging ? 0.86 + 0.50 * (0.5 + 0.5 * Math.sin(time * 7))
      : loaded ? 1.23 : 0.36 + charge * 0.42;
  }

  pose();
  return { group: chassis, deckHeight: agvDeckHeight, liftHeight: agvRaisedHeight - agvDeckHeight, getCargoHeight, pose };
}


const bayStates = {
  idle: { label: 'READY', color: '#6cc5d2' },
  return: { label: 'APPROACHING', color: '#ffd08a' },
  approach: { label: 'APPROACHING', color: '#ffd08a' },
  charging: { label: 'CHARGING', color: '#84f3b1' },
  exit: { label: 'DEPARTING', color: '#ffd08a' },
};

function makeBayDisplay(parent, x, bay) {
  if (typeof document === 'undefined') return () => {};
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 192;
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => {};
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  mesh(parent, new THREE.PlaneGeometry(0.89, 0.332), new THREE.MeshBasicMaterial({ map, toneMapped: false }), x, 0.935, -0.819);
  let lastKey;
  return ({ state, id, percent }) => {
    const key = `${state.label}/${id}/${percent}`;
    if (lastKey === key) return;
    lastKey = key;
    ctx.fillStyle = '#091e2a';
    ctx.fillRect(0, 0, 512, 192);
    ctx.fillStyle = state.color;
    ctx.fillRect(0, 0, 10, 192);
    ctx.font = 'bold 29px Consolas, monospace';
    ctx.fillText(`BAY ${String(bay + 1).padStart(2, '0')}  /  ${state.label}`, 31, 46, 450);
    ctx.fillStyle = '#e9f4f8';
    ctx.font = 'bold 43px Consolas, monospace';
    ctx.fillText(id || '—', 30, 109, 295);
    ctx.textAlign = 'right';
    ctx.fillText(percent == null ? '—%' : `${percent}%`, 480, 109);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#294754';
    ctx.fillRect(31, 139, 450, 20);
    if (percent != null) {
      ctx.fillStyle = state.color;
      ctx.fillRect(31, 139, 450 * percent / 100, 20);
    }
    map.needsUpdate = true;
  };
}

export function makeChargingStation({ id = 'charge-01' } = {}) {
  const station = group();
  station.name = id;
  station.userData.station = id;
  const base = coating('#1b3044', 0.48, 0.46);
  const trim = coating('#3c6f88', 0.55, 0.34);
  const berths = MOBILE_CHARGING_BAYS.map((point) => point.map((coordinate, axis) => coordinate - CHARGING_ZONE_CENTER[axis]));
  const width = 3.74;
  const depth = 1.94;
  const rear = -depth / 2;
  const frontFace = rear + 0.14;
  // The pad top matches the layout's berth elevation. The +Z edge is flush and open.
  const padHeight = berths[0][1];
  box(station, width, padHeight, depth, 0, padHeight / 2, 0, base, 0.014, true);
  box(station, width - 0.16, 1.48, 0.14, 0, 0.74, rear + 0.07, trim, 0.022, true);
  box(station, width - 0.06, 0.075, 0.154, 0, 1.49, rear + 0.077, paint.carbon, 0.027);
  box(station, 0.77, 1.17, 0.023, 0, 0.697, frontFace, paint.carbon, 0.009);
  box(station, 2.42, 0.245, 0.041, 0, 1.287, frontFace, paint.carbon, 0.015);
  label(station, '机器人充电站  /  CHARGING', 2.34, 0.21, 0, 1.287, frontFace + 0.023);
  for (const x of [-1.72, 1.72]) {
    box(station, 0.105, 1.29, 0.10, x, 0.675, rear + 0.07, paint.carbon, 0.02);
    box(station, 0.21, 0.038, 0.22, x, padHeight + 0.019, rear + 0.11, paint.slate, 0.012);
  }
  const bays = berths.map(([x, , z], index) => {
    const indicator = coating(bayStates.idle.color, 0.2, 0.29, 0.55);
    const guide = coating(bayStates.idle.color, 0.24, 0.36, 0.22);
    for (const side of [-1, 1]) {
      box(station, 0.036, 0.006, 1.61, x + side * 0.695, padHeight + 0.002, z + 0.05, guide);
      box(station, 0.15, 0.006, 0.034, x + side * 0.614, padHeight + 0.002, z + 0.84, guide);
    }
    box(station, 1.03, 0.434, 0.03, x, 0.935, frontFace - 0.004, paint.glass, 0.014);
    box(station, 0.31, 0.033, 0.02, x, 0.684, frontFace, indicator, 0.007);
    box(station, 0.73, 0.36, 0.03, x, 0.35, frontFace - 0.004, base, 0.013);
    box(station, 0.30, 0.11, 0.023, x, 0.34, frontFace, paint.carbon, 0.009);
    for (const side of [-1, 1]) {
      box(station, 0.048, 0.054, 0.014, x + side * 0.068, 0.34, frontFace + 0.012, paint.alloy, 0.006);
    }
    for (let vent = 0; vent < 6; vent++) {
      box(station, 0.66, 0.012, 0.006, x, 0.13 + vent * 0.018, frontFace + 0.013, paint.slate);
    }
    return { indicator, guide, render: makeBayDisplay(station, x, index) };
  });
  let time = 0;
  let active = [];
  let night = false;
  const status = [];
  station.userData.bays = status;
  function refresh() {
    bays.forEach(({ indicator, guide, render }, bay) => {
      const candidates = active.filter((item) => item.bay === bay);
      const entry = candidates.find((item) => item.phase === 'charging') ?? candidates[0];
      const phase = entry?.phase ?? 'idle';
      const state = bayStates[phase] ?? bayStates.idle;
      const percent = Number.isFinite(entry?.battery) ? Math.round(100 * THREE.MathUtils.clamp(entry.battery, 0, 1)) : null;
      status[bay] = { bay, phase, id: entry?.id ?? null, percent };
      for (const material of [indicator, guide]) {
        material.color.set(state.color);
        material.emissive.copy(material.color);
      }
      const pulse = 0.5 + 0.5 * Math.sin(time * 5 + bay);
      indicator.emissiveIntensity = phase === 'charging' ? 1.25 + 0.55 * pulse : entry ? 1.05 : 0.35;
      guide.emissiveIntensity = (entry ? 0.44 : 0.17) * (night ? 2.1 : 1);
      render({ state, id: entry?.id, percent });
    });
  }
  function pose(frame = {}) {
    time = frame.time ?? 0;
    active = frame.active ?? [];
    refresh();
  }
  station.userData.setNightMode = (enabled) => { night = Boolean(enabled); refresh(); };
  pose();
  return { group: station, pose, berths };
}

export function makeInspectionRobot({ id = 'INSPECT-01' } = {}) {
  const robot = makeAgv({ id });
  const mast = group(robot.group, 0, 0.34, 0.16);
  const mastMaterial = coating('#34566d', 0.52, 0.38);
  const scannerMaterial = coating('#70f3ee', 0.18, 0.25, 1.5);
  cylinder(mast, 0.035, 0.42, 0, 0.18, 0, mastMaterial, 12);
  const scanner = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.027, 8, 24), scannerMaterial);
  scanner.rotation.x = Math.PI / 2;
  scanner.position.y = 0.42;
  mast.add(scanner);
  const beamMaterial = new THREE.MeshBasicMaterial({ color: 0x50e7eb, transparent: true, opacity: 0.16, depthWrite: false });
  const beam = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.82, 24, 1, true), beamMaterial);
  beam.position.y = 0.02;
  beam.scale.y = 0.55;
  mast.add(beam);
  function pose(options = {}) {
    robot.pose(options);
    const scanning = Boolean(options.scanning);
    scanner.visible = scanning;
    beam.visible = scanning;
    beam.rotation.z = scanning ? Math.sin((options.time ?? 0) * 6) * 0.20 : 0;
    scanner.rotation.z = (options.time ?? 0) * 5.5;
    beam.material.opacity = scanning ? 0.12 + 0.10 * (0.5 + 0.5 * Math.sin((options.time ?? 0) * 9)) : 0;
  }
  pose();
  return { ...robot, scanner, beam, pose };
}

const armUpper = 0.43;
const armLower = 0.44;
const legUpper = 0.45;
const legLower = 0.45;
const hipRest = 0.965;
const shoulderOffset = 0.445;
const shoulderHalf = 0.31;
const ankleHeight = 0.105;

function joint(parent, x, y, z, radius, length) {
  const pivot = group(parent, x, y, z);
  axle(pivot, radius, length, 0, 0, 0, paint.carbon, 20);
  for (const sign of [-1, 1]) {
    axle(pivot, radius * 0.69, 0.022, sign * length * 0.52, 0, 0, paint.alloy, 16);
    axle(pivot, radius * 0.32, 0.013, sign * (length * 0.52 + 0.014), 0, 0, paint.slate, 6);
  }
  return pivot;
}

function limb(parent, length, w, d, lower) {
  const link = group(parent);
  box(link, w * 0.69, length * 0.95, d * 0.68, 0, length / 2, 0, paint.carbon, 0.039);
  const shellLength = length * (lower ? 0.67 : 0.73);
  box(link, w, shellLength, d, 0, length / 2, 0.017, paint.white, 0.045, true);
  box(link, w * 0.69, length * 0.43, 0.022, 0, length / 2, d / 2 + 0.020, paint.slate, 0.009);
  box(link, w * 0.29, length * 0.21, 0.013, 0, length * 0.55, d / 2 + 0.033, paint.cyan, 0.004);
  return link;
}

function pointLink(link, start, end, direction) {
  link.position.copy(start);
  direction.subVectors(end, start).normalize();
  link.quaternion.setFromUnitVectors(positiveY, direction);
}

function bendCenter(start, end, upper, lower, pole, result, along, normal) {
  along.subVectors(end, start);
  const original = along.length();
  const length = THREE.MathUtils.clamp(original, 0.025, upper + lower - 0.001);
  if (original < 0.00001) along.set(0, 0, 1);
  else along.multiplyScalar(1 / original);
  end.copy(start).addScaledVector(along, length);
  normal.copy(pole).addScaledVector(along, -pole.dot(along)).normalize();
  const projection = (upper * upper + length * length - lower * lower) / (2 * length);
  const offset = Math.sqrt(Math.max(0, upper * upper - projection * projection));
  return result.copy(start).addScaledVector(along, projection).addScaledVector(normal, offset);
}

function hand(parent, sign) {
  const palm = group(parent);
  box(palm, 0.125, 0.158, 0.148, 0, 0, 0.020, paint.carbon, 0.03);
  box(palm, 0.118, 0.112, 0.105, sign * 0.025, 0.012, 0.029, paint.white, 0.025);
  box(palm, 0.018, 0.045, 0.058, sign * 0.087, 0.014, 0.035, paint.cyan, 0.005);
  for (const y of [-0.057, 0.057]) {
    box(palm, 0.035, 0.037, 0.114, -sign * 0.049, y, 0.100, paint.alloy, 0.012);
    box(palm, 0.021, 0.031, 0.062, -sign * 0.068, y, 0.145, paint.rubber, 0.006);
  }
  return palm;
}

export function makeHandlingRobot({ id = 'ORION-H01', floorCharging = false } = {}) {
  const body = group();
  body.name = id;
  const torso = group(body);
  const head = group(torso, 0, 0.664, 0.023);
  const carryAnchor = group(body);
  box(torso, 0.42, 0.19, 0.29, 0, 0.009, 0, paint.carbon, 0.053, true);
  box(torso, 0.365, 0.124, 0.278, 0, 0.020, 0.031, paint.white, 0.041);
  cylinder(torso, 0.103, 0.145, 0, 0.157, 0, paint.slate, 16);
  cylinder(torso, 0.114, 0.038, 0, 0.150, 0, paint.alloy, 20);
  box(torso, 0.472, 0.29, 0.288, 0, 0.346, 0, paint.carbon, 0.066, true);
  box(torso, 0.443, 0.248, 0.204, 0, 0.360, 0.078, paint.white, 0.076, true);
  box(torso, 0.29, 0.095, 0.085, 0, 0.361, 0.155, paint.glass, 0.030);
  const chestStatus = coating('#39dce8', 0.26, 0.39, 0.90);
  box(torso, 0.221, 0.015, 0.008, 0, 0.377, 0.200, chestStatus, 0.003);
  label(torso, id, 0.219, 0.047, 0, 0.345, 0.2005);
  box(torso, 0.28, 0.257, 0.13, 0, 0.371, -0.155, paint.slate, 0.045, true);
  box(torso, 0.194, 0.089, 0.025, 0, 0.415, -0.226, paint.carbon, 0.01);
  for (let i = 0; i < 5; i++) {
    box(torso, 0.135, 0.005, 0.012, 0, 0.457 - i * 0.017, -0.240, i === 0 ? paint.cyan : paint.alloy, 0.002);
  }
  cylinder(torso, 0.076, 0.121, 0, 0.530, 0.014, paint.alloy, 16);
  cylinder(torso, 0.091, 0.024, 0, 0.557, 0.014, paint.carbon, 20);
  box(head, 0.324, 0.235, 0.261, 0, 0, -0.006, paint.white, 0.076, true);
  box(head, 0.275, 0.126, 0.134, 0, 0.004, 0.081, paint.glass, 0.046);
  box(head, 0.095, 0.012, 0.007, 0, -0.019, 0.150, paint.slate, 0.004);
  const workLamp = makeVehicleHeadlight(head, [-0.047, 0.047].map((x) => [x, 0.018, 0.160]), [0, -0.85, 2.6], { intensity: 4, distance: 4 });
  for (const sign of [-1, 1]) {
    box(head, 0.062, 0.025, 0.007, sign * 0.066, 0.018, 0.151, paint.cyan, 0.008);
    box(head, 0.012, 0.025, 0.009, sign * 0.047, 0.018, 0.154, workLamp.lens, 0.004);
    axle(head, 0.057, 0.025, sign * 0.162, 0.005, -0.014, paint.slate);
    axle(head, 0.038, 0.012, sign * 0.179, 0.005, -0.014, paint.carbon);
    axle(head, 0.017, 0.014, sign * 0.186, 0.005, -0.014, paint.cyan);
  }
  box(head, 0.077, 0.024, 0.087, 0, 0.119, -0.008, paint.slate, 0.01);

  const sides = [-1, 1].map((sign) => {
    const shoulderJoint = joint(body, sign * shoulderHalf, hipRest + shoulderOffset, 0, 0.094, 0.147);
    const hipJoint = joint(body, sign * 0.142, hipRest, 0, 0.092, 0.143);
    const elbowJoint = joint(body, 0, 0, 0, 0.070, 0.125);
    const kneeJoint = joint(body, 0, 0, 0, 0.072, 0.143);
    const upperArm = limb(body, armUpper, 0.15, 0.158, false);
    const lowerArm = limb(body, armLower, 0.137, 0.154, true);
    const thigh = limb(body, legUpper, 0.185, 0.195, false);
    const shin = limb(body, legLower, 0.165, 0.180, true);
    const foot = group(body);
    box(foot, 0.192, 0.055, 0.306, 0, -0.077, 0.057, paint.rubber, 0.026, true);
    box(foot, 0.177, 0.077, 0.266, 0, -0.042, 0.052, paint.white, 0.028);
    box(foot, 0.127, 0.017, 0.100, 0, -0.005, 0.109, paint.slate, 0.007);
    box(foot, 0.094, 0.015, 0.012, 0, -0.04, 0.187, paint.cyan, 0.004);
    axle(foot, 0.053, 0.127, 0, 0, 0, paint.carbon);
    if (floorCharging) {
      const contact = box(foot, 0.07, 0.004, 0.10, 0, -0.103, 0.045, paint.alloy);
      contact.name = 'Sole charging contact';
    }
    return {
      sign, shoulderJoint, hipJoint, elbowJoint, kneeJoint, upperArm, lowerArm, thigh, shin, foot,
      gripper: hand(body, sign), elbow: new THREE.Vector3(), knee: new THREE.Vector3(),
      armPole: new THREE.Vector3(sign, -0.48, -0.25),
    };
  });
  const elbowGoal = new THREE.Vector3();
  const footGoal = new THREE.Vector3();
  const packageGoal = new THREE.Vector3();
  const along = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const linkAxis = new THREE.Vector3();
  const kneePole = new THREE.Vector3(0, 0, 1);

  function pose({ motion = 'idle', progress = 0, time = 0, target, gripWidth = 0.58, walking = false, stride, reach, battery = 1, charging = false } = {}) {
    chestStatus.color.set(charging ? '#7ef4ac' : battery <= 0.20 ? '#ffb454' : '#39dce8');
    chestStatus.emissive.copy(chestStatus.color);
    chestStatus.emissiveIntensity = charging ? 1.1 + 0.56 * Math.sin(time * 6) : 0.82;
    const handling = Boolean(target) || ['pick', 'carry', 'place', 'lift', 'load', 'unload', 'hold'].includes(motion);
    workLamp.pose(!charging && (walking || handling));
    if (Array.isArray(target)) packageGoal.fromArray(target);
    else if (target) packageGoal.copy(target);
    else packageGoal.set(0, motion === 'pick' || motion === 'place' ? 0.78 : 1.126, reach ?? 0.73);
    carryAnchor.position.copy(packageGoal);

    const phase = stride ?? time * 7;
    const gait = walking ? Math.sin(Math.PI * THREE.MathUtils.clamp(progress, 0, 1)) : 0;
    const step = Math.sin(phase) * gait;
    const squat = handling ? THREE.MathUtils.clamp((1.09 - packageGoal.y) * 0.52, 0, 0.26) : 0;
    const idleBreath = handling ? 0 : Math.sin(time * 2.7) * 0.007;
    const hips = hipRest - squat - Math.abs(step) * 0.035 + idleBreath;
    const torsoForward = handling ? squat * 0.34 : 0;
    torso.position.set(0, hips, torsoForward);
    head.rotation.x = handling ? THREE.MathUtils.clamp((1.235 - packageGoal.y) * 0.57, -0.15, 0.40) : Math.sin(time * 1.3) * 0.035;
    head.rotation.y = handling ? THREE.MathUtils.clamp(packageGoal.x * 0.62, -0.30, 0.30) : Math.sin(time * 0.92 + progress) * 0.12;

    for (const side of sides) {
      const { sign, shoulderJoint, hipJoint, elbowJoint, kneeJoint, upperArm, lowerArm,
        thigh, shin, foot, gripper, elbow, knee, armPole } = side;
      const footForward = step * sign * 0.14;
      const footLift = Math.max(0, Math.cos(phase) * sign) * 0.065 * gait;
      hipJoint.position.set(sign * 0.142, hips, torsoForward);
      footGoal.set(sign * (0.153 + squat * 0.13), ankleHeight + footLift, footForward);
      bendCenter(hipJoint.position, footGoal, legUpper, legLower, kneePole, knee, along, normal);
      kneeJoint.position.copy(knee);
      pointLink(thigh, hipJoint.position, knee, linkAxis);
      pointLink(shin, knee, footGoal, linkAxis);
      foot.position.copy(footGoal);
      foot.rotation.x = walking ? footLift * -2.0 : 0;
      foot.rotation.y = sign * 0.09;

      shoulderJoint.position.set(sign * shoulderHalf, hips + shoulderOffset, torsoForward);
      if (handling) {
        elbowGoal.set(packageGoal.x + sign * (gripWidth / 2 + 0.070), packageGoal.y, packageGoal.z - 0.142);
      } else {
        elbowGoal.set(sign * 0.36, hips - 0.302, 0.07 - footForward * 0.75);
      }
      bendCenter(shoulderJoint.position, elbowGoal, armUpper, armLower, armPole, elbow, along, normal);
      elbowJoint.position.copy(elbow);
      pointLink(upperArm, shoulderJoint.position, elbow, linkAxis);
      pointLink(lowerArm, elbow, elbowGoal, linkAxis);
      gripper.position.copy(elbowGoal);
      gripper.rotation.set(handling ? 0 : 1.03, handling ? 0 : -sign * 0.19, 0);
    }
  }

  pose();
  return { group: body, carryAnchor, pose };
}
