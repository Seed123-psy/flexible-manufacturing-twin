import * as THREE from 'three';
import { junctionDeckEdge, positions } from './layout.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { rackColumns, rackInlet, rackLevels, rackOutlet, rackRailZ, sortJunction, sortPorts, shippingPalletHeight, truckDeck, truckPark, warehouseAddress, warehouseCapacity } from './logistics-layout.js';

import { REJECT_CARGO_SLOTS, REJECT_ELBOWS, REJECT_GANTRY_BEAM, REJECT_GANTRY_HOME,
  REJECT_GANTRY_RAILS, REJECT_GANTRY_Z, REJECT_HANDOFF_GAP, REJECT_INTAKE, REJECT_LIFTS, REJECT_LIFT_DECK_SIZE, REJECT_LINK_HEIGHT, REJECT_RACK_SLOTS,
  REJECT_TRUCK_PARK } from './reject-layout.js';
import { PACKAGING_WAREHOUSE_CENTER } from './patrol-layout.js';
import { makeVehicleHeadlight } from './mobile-robots.js';

const alloy = (color, roughness = 0.6, metalness = 0.28) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
const ink = (color) => new THREE.MeshBasicMaterial({ color, toneMapped: false });
const colors = {
  floor: alloy(0x414c52, 0.93, 0.04), slab: alloy(0x394148), base: alloy(0x222d32),
  asphalt: alloy(0x2b3339, 0.96, 0.01), trim: alloy(0x647780, 0.49, 0.56),
  seam: ink(0x34454d), stripe: ink(0xa38c65), path: ink(0x3f6267), pathEdge: ink(0x6a8587),
  white: ink(0xb7c8c9), warm: ink(0xd8a758), mist: ink(0x82bfc3),
  dark: alloy(0x24333a), frame: alloy(0x3a515a), cladding: alloy(0x798e92), panels: alloy(0xd3dbd7),
  copper: alloy(0xc19152, 0.46, 0.39), silver: alloy(0xb4c2c4, 0.42, 0.68), rubber: alloy(0x192329, 0.88, 0.03),
  glass: alloy(0x2a5967, 0.24, 0.47), lamp: ink(0x80ebdc), standby: ink(0x33585a), amber: ink(0xf6bf62),
  brake: ink(0xef6452), turquoise: alloy(0x477e85), blue: alloy(0x4d6978),
  packaging: alloy(0x4c9b8f, 0.52, 0.32), packagingAccent: ink(0x8ce0c2),
  reject: alloy(0x8e3c43, 0.58, 0.24), rejectAccent: ink(0xff8b70), warning: ink(0xf0c15b),
};
const cube = new THREE.BoxGeometry(1, 1, 1);
const rollerGeometry = new THREE.CylinderGeometry(0.034, 0.034, 1, 12);
rollerGeometry.rotateX(Math.PI / 2);
const rollerPart = new THREE.Object3D();
const roundedBoxes = new Map();

function group(parent, x = 0, y = 0, z = 0) {
  const result = new THREE.Group();
  result.position.set(x, y, z);
  parent.add(result);
  return result;
}

function block(parent, material, size, point, radius = 0) {
  let geometry = cube;
  if (radius) {
    const key = `${size.join(',')}/${radius}`;
    if (!roundedBoxes.has(key)) roundedBoxes.set(key, new RoundedBoxGeometry(...size, 2, radius));
    geometry = roundedBoxes.get(key);
  }
  const mesh = new THREE.Mesh(geometry, material);
  if (!radius) mesh.scale.set(...size);
  mesh.position.set(...point);
  mesh.castShadow = !material.isMeshBasicMaterial;
  mesh.receiveShadow = !material.isMeshBasicMaterial;
  parent.add(mesh);
  return mesh;
}

function batchBlocks(parent) {
  const entries = new Map();
  const part = new THREE.Object3D();
  return {
    add(material, size, point, yaw = 0, shadow = false) {
      const key = `${material.id}/${shadow}`;
      if (!entries.has(key)) entries.set(key, { material, shadow, matrices: [] });
      part.scale.set(...size);
      part.position.set(...point);
      part.rotation.y = yaw;
      part.updateMatrix();
      entries.get(key).matrices.push(part.matrix.clone());
    },
    finish() {
      for (const { material, shadow, matrices } of entries.values()) {
        const mesh = new THREE.InstancedMesh(cube, material, matrices.length);
        matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
        mesh.castShadow = shadow;
        mesh.receiveShadow = !material.isMeshBasicMaterial;
        parent.add(mesh);
      }
    },
  };
}

function label(parent, position, size, title, detail, options = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = Math.max(60, Math.round(canvas.width * size[1] / size[0]));
  const { width, height } = canvas;
  const ctx = canvas.getContext('2d');
  const accent = options.accent ?? '#86d5cd';
  if (!options.floor) {
    ctx.fillStyle = '#20363f';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, 14, height);
    ctx.fillStyle = '#375662';
    ctx.fillRect(24, height - 6, width - 24, 6);
  }
  ctx.textBaseline = 'middle';
  const inset = options.floor ? 8 : 35;
  ctx.font = `700 ${Math.min(detail ? height * 0.42 : height * 0.58, 84)}px "Microsoft YaHei", sans-serif`;
  ctx.fillStyle = options.floor ? accent : '#e0e9e4';
  ctx.fillText(title, inset, detail ? height * 0.38 : height * 0.5, width - inset - 10);
  if (detail) {
    ctx.font = `600 ${Math.min(height * 0.25, 34)}px Consolas, monospace`;
    ctx.fillStyle = accent;
    ctx.fillText(detail, inset + 1, height * 0.76, width - inset - 10);
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  const material = new THREE.MeshBasicMaterial({ map, transparent: !!options.floor, depthWrite: !options.floor, toneMapped: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(...size), material);
  mesh.position.set(...position);
  mesh.rotation.x = options.floor ? -Math.PI / 2 : 0;
  mesh.rotation.y = options.yaw ?? 0;
  parent.add(mesh);
  return mesh;
}

// A rigid faceplate, with the artwork offset just beyond its front surface.
function signPlate(parent, position, [width, height], title, detail, { accent, yaw = 0, depth = 0.055 } = {}) {
  const plate = group(parent, ...position);
  plate.name = `${title} sign assembly`;
  plate.rotation.y = yaw;
  block(plate, colors.dark, [width, height, depth], [0, 0, 0], 0.01);
  label(plate, [0, 0, depth / 2 + 0.002], [width - 0.035, height - 0.022], title, detail, { accent });
  return plate;
}

function arrow(add, x, z, angle, material = colors.white, size = 0.38) {
  add(material, [size * 1.17, 0.004, 0.026], [x, 0.017, z], angle);
  const head = new THREE.Vector2(Math.cos(angle), -Math.sin(angle)).multiplyScalar(size * 0.4);
  for (const side of [-1, 1]) {
    const crossX = Math.sin(angle) * size * side * 0.13;
    const crossZ = Math.cos(angle) * size * side * 0.13;
    add(material, [size * 0.57, 0.004, 0.027], [x + head.x + crossX, 0.019, z + head.y + crossZ], angle + side * 0.63);
  }
}

function makeDeck(parent) {
  const { add, finish } = batchBlocks(parent);
  add(colors.base, [13.38, 0.33, 12.19], [21.725, -0.486, -0.1], 0, true);
  // Separate visible layers: the workshop plane is y=0 and must not share a top face.
  add(colors.slab, [13.22, 0.284, 12.05], [21.725, -0.170, -0.1], 0, true);
  add(colors.floor, [13.17, 0.025, 12.0], [21.725, -0.0105, -0.1]);
  add(colors.slab, [1.46, 0.204, 2.15], [14.45, -0.128, 2.65]);
  add(colors.floor, [1.45, 0.024, 2.1], [14.45, -0.010, 2.65]);
  add(colors.trim, [13.37, 0.043, 0.046], [21.725, -0.265, 5.99]);
  add(colors.trim, [0.046, 0.043, 12.12], [15.09, -0.265, -0.1]);
  for (const x of [17.92, 20.39, 22.86, 25.64]) add(colors.seam, [0.014, 0.001, 11.9], [x, 0.003, -0.1]);
  for (const z of [-5.01, -3.01, -1.01, 1, 3.01, 5.02]) add(colors.seam, [13.13, 0.001, 0.014], [21.725, 0.003, z]);
  for (const x of [15.45, 27.94]) {
    add(colors.stripe, [0.034, 0.004, 1.06], [x, 0.009, -5.33]);
    add(colors.stripe, [0.81, 0.004, 0.034], [x + (x < 20 ? 0.4 : -0.4), 0.009, -5.86]);
  }
  add(colors.path, [1.04, 0.004, 6.32], [21.14, 0.006, 0.74]);
  add(colors.path, [6.46, 0.004, 0.89], [24.11, 0.007, -0.36]);
  add(colors.path, [0.87, 0.004, 3.26], [27.48, 0.006, 0.43]);
  for (const x of [20.6, 21.68]) add(colors.pathEdge, [0.025, 0.004, 6.32], [x, 0.011, 0.74]);
  for (const z of [-0.81, 0.09]) add(colors.pathEdge, [6.46, 0.004, 0.026], [24.11, 0.011, z]);
  for (const z of [2.5, 0.65, -1.77]) arrow(add, 21.14, z, Math.PI / 2, colors.mist);
  for (const x of [22.4, 24.1, 25.58]) arrow(add, x, -0.36, 0, colors.mist);

  add(colors.slab, [6.63, 0.46, 2.86], [31.58, -0.240, 4.7]);
  add(colors.base, [6.67, 0.18, 2.92], [31.58, -0.55, 4.7]);
  add(colors.asphalt, [13.0, 0.013, 2.79], [28.45, -0.003, 4.7]);
  for (const z of [3.32, 5.92]) add(colors.stripe, [13.06, 0.004, 0.046], [28.38, 0.009, z]);
  for (let x = 23.2; x <= 34.6; x += 1.34) add(colors.pathEdge, [0.64, 0.005, 0.048], [x, 0.01, 4.65]);
  for (const x of [28.6, 31.25, 34.05]) arrow(add, x, 5.34, 0, colors.white, 0.58);
  for (const x of [23.6, 26.94]) {
    for (const side of [-1, 1]) add(colors.warm, [0.038, 0.004, 0.39], [x, 0.016, 4.63 + side * 0.89]);
  }
  for (let z = 1.82; z < 2.62; z += 0.16) add(colors.pathEdge, [0.042, 0.004, 0.105], [24.08, 0.012, z], 0.6);
  add(colors.pathEdge, [1.42, 0.004, 0.024], [24.75, 0.013, 2.8]);
  add(colors.pathEdge, [1.42, 0.004, 0.024], [24.75, 0.013, 1.63]);
  add(colors.pathEdge, [0.024, 0.004, 1.17], [25.46, 0.013, 2.215]);
  finish();
  label(parent, [23.55, 0.018, 1.33], [2.24, 0.36], '出库交接', 'OUTBOUND TRANSFER', { floor: true, accent: '#a9c7c4' });
  label(parent, [16.9, 0.018, 4.78], [2.58, 0.43], '分拣缓冲', 'SCAN / ROUTE', { floor: true, accent: '#a9c7c4' });
  label(parent, [26.68, 0.018, 5.56], [2.12, 0.36], '发运车道', 'DISPATCH LANE', { floor: true, accent: '#dec494' });
}

function belt(parent, start, end, { width = 0.81, stop = false, legs = true, crossTransfer = false } = {}) {
  const [x, y, z] = start;
  const dx = end[0] - x;
  const dz = end[2] - z;
  const length = Math.hypot(dx, dz);
  const bed = group(parent, x + dx / 2, 0, z + dz / 2);
  bed.rotation.y = -Math.atan2(dz, dx);
  const { add, finish } = batchBlocks(bed);
  add(colors.dark, [length, 0.113, width + 0.052], [0, y - 0.116, 0]);
  add(colors.frame, [length, 0.061, width + 0.104], [0, y - 0.052, 0]);
  const rollerCount = Math.max(4, Math.ceil(length / 0.096));
  const rollers = new THREE.InstancedMesh(rollerGeometry, colors.silver, rollerCount);
  for (let i = 0; i < rollerCount; i++) {
    rollerPart.position.set(((i + 0.5) / rollerCount - 0.5) * length, y - 0.034, 0);
    rollerPart.scale.set(1, 1, width - 0.061);
    rollerPart.updateMatrix();
    rollers.setMatrixAt(i, rollerPart.matrix);
  }
  rollers.receiveShadow = true;
  bed.add(rollers);
  for (const side of [-1, 1]) {
    const railZ = side * width / 2;
    if (crossTransfer) add(colors.rubber, [length - 0.035, 0.010, 0.069], [0, y - 0.005, side * 0.211]);
    else add(colors.silver, [length, 0.021, 0.047], [0, y - 0.002, railZ]);
    if (!legs) continue;
    const stands = Math.max(1, Math.ceil(length / 1.22));
    for (let i = 0; i < stands; i++) {
      const px = ((i + 0.5) / stands - 0.5) * length;
      add(colors.frame, [0.08, y - 0.14, 0.075], [px, (y - 0.14) / 2, railZ]);
      add(colors.trim, [0.142, 0.027, 0.13], [px, 0.035, railZ]);
      add(colors.rubber, [0.116, 0.018, 0.108], [px, 0.009, railZ]);
      if (side === 1) add(colors.frame, [0.062, 0.048, width], [px, 0.193, 0]);
    }
  }
  if (stop) {
    for (const side of [-1, 1]) {
      add(colors.copper, [0.14, 0.046, 0.072], [length / 2 - 0.045, y - 0.036, side * width / 2]);
      add(colors.rubber, [0.025, 0.066, 0.092], [length / 2 + 0.031, y - 0.075, side * width / 2]);
    }
  }
  finish();
  return bed;
}

function scanPortal(parent, [x, , z], title, activeColor) {
  const portal = group(parent, x, 0, z);
  portal.name = title;
  for (const side of [-1, 1]) {
    block(portal, colors.frame, [0.16, 0.85, 0.10], [0, 1.025, side * 0.49], 0.021);
    block(portal, colors.glass, [0.15, 0.235, 0.048], [0, 1.06, side * 0.426], 0.011);
  }
  block(portal, colors.panels, [0.245, 0.156, 1.13], [0, 1.47, 0], 0.032);
  block(portal, colors.glass, [0.135, 0.055, 0.84], [0, 1.379, 0], 0.013);
  const lamp = block(portal, colors.standby, [0.034, 0.012, 0.72], [0, 1.346, 0]);
  label(portal, [0, 1.48, 0.569], [0.23, 0.082], title, null);
  return (active) => { lamp.material = active ? activeColor : colors.standby; };
}

function makeSorter(parent) {
  const [x, y] = sortJunction;
  const indicators = [];
  for (const [lane, port] of sortPorts.entries()) {
    belt(parent, [x + junctionDeckEdge, y, port[2]], [port[0] + 0.055, y, port[2]], { stop: true });
    const color = lane === 0 ? '#86dfd1' : '#e8ba7b';
    signPlate(parent, [port[0] - 0.37, y - 0.104, port[2] + 0.433], [0.68, 0.12], `0${lane + 1}  ${lane === 0 ? 'A' : 'B'} 道`, null, { accent: color, depth: 0.040 });
    indicators.push(block(parent, colors.standby, [0.19, 0.027, 0.023], [port[0] + 0.09, y - 0.11, port[2] + 0.461]));
  }

  const scan = scanPortal(parent, positions.scan, 'SCAN', colors.lamp);
  const exception = scanPortal(parent, positions.exception, 'CHECK', colors.amber);
  label(parent, [17.88, 0.035, 4.27], [0.45, 0.14], '02', null, { floor: true, accent: '#d2ae7c' });
  return ({ sortLane, sorting, dock, scanning, checking }) => {
    scan(scanning);
    exception(checking);
    indicators.forEach((indicator, lane) => { indicator.material = (sorting && sortLane === lane || dock === (lane === 0 ? 'A' : 'B')) ? (lane === 0 ? colors.lamp : colors.amber) : colors.standby; });
  };
}

const rackBayZ = -3.64;
export const rackSlots = rackLevels.flatMap((y) => rackColumns.map((x) => [x, y, rackBayZ]));

function makeRacking(parent) {
  const rackMinX = rackColumns[0] - 0.47;
  const rackMaxX = rackColumns.at(-1) + 0.47;
  const rackWidth = rackMaxX - rackMinX;
  const rackTop = rackLevels.at(-1) + 0.34;
  const rear = rackBayZ - 0.58;
  const front = rackBayZ + 0.60;
  // Four structural frames divide the expanded ten-column rack without
  // changing the public slot coordinates consumed by the simulation.
  const uprights = [
    rackMinX,
    rackColumns[3] - 0.47,
    rackColumns[6] - 0.47,
    rackMaxX,
  ];
  const { add, finish } = batchBlocks(parent);
  for (const z of [rear, front]) {
    for (const x of uprights) {
      add(colors.blue, [0.133, rackTop, 0.135], [x, rackTop / 2, z], 0, true);
      add(colors.trim, [0.24, 0.037, 0.25], [x, 0.019, z]);
      add(colors.copper, [0.18, 0.34, 0.18], [x, 0.224, z]);
      for (let y = 0.47; y < rackTop - 0.1; y += 0.126) add(colors.dark, [0.034, 0.027, 0.006], [x, y, z + 0.071]);
    }
    add(colors.frame, [rackWidth, 0.14, 0.12], [(rackMinX + rackMaxX) / 2, rackTop, z], 0, true);
  }
  for (const [index, [x, y, z]] of rackSlots.entries()) {
    for (const beam of [rear, front]) add(colors.copper, [0.83, 0.091, 0.107], [x, y - 0.116, beam], 0, true);
    // The central rail supports narrow cartons between the two retracting forks.
    add(colors.silver, [0.064, 0.027, 1.082], [x, y - 0.0135, z]);
    add(colors.dark, [0.055, 0.06, 1.062], [x, y - 0.053, z]);
    for (const side of [-1, 1]) {
      add(colors.silver, [0.075, 0.029, 1.082], [x + side * 0.235, y - 0.0145, z]);
      add(colors.dark, [0.064, 0.069, 1.062], [x + side * 0.235, y - 0.057, z]);
    }
    for (const filler of [-0.68, -0.48, 0.48, 0.68]) add(colors.blue, [0.12, 0.026, 1.075], [x + filler, y - 0.026, z]);
    add(colors.frame, [0.81, 0.037, 0.097], [x, y - 0.016, rear]);
    label(parent, [x, y - 0.112, front + 0.055], [0.42, 0.091], warehouseAddress(index), null, { accent: index % 2 === 0 ? '#86d5cd' : '#e5b86e' });
  }
  // Rear safety mesh is sized from the actual expanded rack footprint.
  for (const x of uprights) {
    for (const y of [0.4, 1.2, 2.0, 2.8, 3.6, 4.4]) add(colors.frame, [0.071, 0.052, 1.22], [x, y, rackBayZ]);
  }
  for (let x = rackMinX + 0.35; x <= rackMaxX - 0.35; x += 0.15) add(colors.frame, [0.012, rackTop - 0.23, 0.015], [x, (rackTop - 0.23) / 2, rear - 0.055]);
  for (let y = 0.45; y < rackTop - 0.1; y += 0.16) add(colors.frame, [rackWidth - 0.16, 0.015, 0.012], [(rackMinX + rackMaxX) / 2, y, rear - 0.055]);
  finish();

  const dockLights = [rackInlet, rackOutlet].map(([x, y, z], index) => {
    const dock = group(parent, x, 0, z);
    const { add, finish } = batchBlocks(dock);
    const back = index ? -1 : 1;
    const dockCenter = back * 0.15;
    add(colors.dark, [0.565, 0.123, 0.826], [dockCenter, y - 0.165, 0]);
    // The center strip carries narrow cartons and the open channels admit the fork tips.
    for (const px of [0, back * 0.268, back * 0.37]) {
      const roller = new THREE.Mesh(rollerGeometry, colors.silver);
      roller.position.set(px, y - 0.034, 0);
      roller.scale.z = 0.771;
      roller.receiveShadow = true;
      dock.add(roller);
    }
    for (const px of [back * 0.04, back * 0.34]) {
      for (const pz of [-0.34, 0.34]) {
        add(colors.frame, [0.088, y - 0.12, 0.087], [px, (y - 0.12) / 2, pz]);
        add(colors.trim, [0.165, 0.028, 0.153], [px, 0.023, pz]);
      }
    }
    add(colors.trim, [0.565, 0.046, 0.041], [dockCenter, y - 0.084, 0.419]);
    add(colors.trim, [0.565, 0.046, 0.041], [dockCenter, y - 0.084, -0.419]);
    finish();
    signPlate(dock, [dockCenter - 0.04, y - 0.104, 0.421], [0.45, 0.111], index ? 'OUT  出库交接' : 'IN  入库交接', null, { accent: index ? '#e5b86e' : '#86d5cd', depth: 0.033 });
    return block(dock, colors.standby, [0.079, 0.024, 0.021], [dockCenter + 0.235, y - 0.084, 0.438]);
  });
  return (dock) => {
    dockLights[0].material = dock === 'inbound' ? colors.lamp : colors.standby;
    dockLights[1].material = dock === 'outbound' ? colors.amber : colors.standby;
  };
}

function makeStacker(parent) {
  const railMinX = Math.min(rackInlet[0], rackColumns[0]);
  const railMaxX = Math.max(rackOutlet[0], rackColumns.at(-1));
  const railWidth = railMaxX - railMinX;
  const railCenterX = (railMinX + railMaxX) / 2;
  for (const z of [rackRailZ - 0.21, rackRailZ + 0.21]) {
    block(parent, colors.dark, [railWidth, 0.072, 0.155], [railCenterX, 0.036, z]);
    block(parent, colors.silver, [railWidth - 0.13, 0.025, 0.065], [railCenterX, 0.08, z]);
    for (const x of [railMinX, railMaxX]) block(parent, colors.copper, [0.14, 0.098, 0.157], [x, 0.05, z], 0.011);
  }
  block(parent, colors.silver, [railWidth - 0.04, 0.054, 0.12], [railCenterX, 4.88, rackRailZ]);
  for (const x of [railMinX, railMaxX]) {
    block(parent, colors.dark, [0.11, 4.90, 0.12], [x, 2.45, rackRailZ + 0.15]);
    block(parent, colors.copper, [0.166, 0.20, 0.167], [x, 0.144, rackRailZ + 0.15]);
  }
  const mast = group(parent, rackInlet[0], 0, rackRailZ);
  block(mast, colors.frame, [0.67, 0.172, 0.68], [0, 0.16, 0], 0.029);
  block(mast, colors.copper, [0.69, 0.054, 0.545], [0, 0.252, 0], 0.016);
  for (const side of [-1, 1]) {
    block(mast, colors.frame, [0.082, 2.94, 0.108], [side * 0.307, 1.726, 0.035]);
    block(mast, colors.silver, [0.029, 2.95, 0.017], [side * 0.307, 1.726, 0.096]);
  }
  block(mast, colors.copper, [0.68, 0.14, 0.23], [0, 4.77, 0.022], 0.021);
  block(mast, colors.dark, [0.49, 0.15, 0.037], [0, 4.757, 0.151], 0.006);
  const status = block(mast, colors.standby, [0.15, 0.025, 0.01], [0.07, 4.752, 0.174]);
  const lift = group(mast, 0, rackInlet[1], 0);
  for (const side of [-1, 1]) block(lift, colors.copper, [0.124, 0.244, 0.145], [side * 0.29, -0.139, 0.099], 0.017);
  block(lift, colors.frame, [0.6, 0.104, 0.43], [0, -0.155, 0.05], 0.018);
  const forks = group(lift);
  const extension = [];
  const tines = [];
  for (const side of [-1, 1]) {
    const tine = group(forks, side * 0.139);
    tines.push(tine);
    block(tine, colors.silver, [0.047, 0.039, 0.54], [0, -0.0195, 0], 0.008);
    block(tine, colors.copper, [0.048, 0.041, 0.106], [0, -0.0195, 0.239], 0.007);
    extension.push(block(lift, colors.trim, [0.049, 0.039, 1], [side * 0.139, -0.055, 0]));
  }
  return ({ x = rackInlet[0], y = rackInlet[1], z = rackRailZ, active = false, cargoWidth = 0.49 } = {}) => {
    mast.position.x = THREE.MathUtils.clamp(x, railMinX, railMaxX);
    lift.position.y = y;
    forks.position.z = z - rackRailZ;
    const spacing = THREE.MathUtils.clamp(cargoWidth * 0.32, 0.074, 0.164);
    extension.forEach((shaft, index) => {
      tines[index].position.x = (index * 2 - 1) * spacing;
      shaft.position.x = tines[index].position.x;
      shaft.position.z = forks.position.z * 0.5;
      shaft.scale.z = 0.32 + Math.abs(forks.position.z);
    });
    status.material = active ? colors.lamp : colors.standby;
  };
}

function makePackagingWarehouse(parent) {
  const warehouse = group(parent, ...PACKAGING_WAREHOUSE_CENTER);
  warehouse.name = 'Packaging box warehouse';
  const stock = [];
  block(warehouse, colors.base, [1.86, 0.18, 1.52], [0, -0.09, 0]);
  block(warehouse, colors.packaging, [1.78, 0.035, 1.44], [0, 0.015, 0]);
  // A low guard rail makes the finite inventory zone legible from above.
  for (const side of [-1, 1]) block(warehouse, colors.packagingAccent, [1.86, 0.055, 0.045], [0, 0.07, side * 0.73]);
  for (const side of [-1, 1]) block(warehouse, colors.packagingAccent, [0.045, 0.055, 1.42], [side * 0.91, 0.07, 0]);
  for (const z of [-0.53, -0.05, 0.43]) {
    block(warehouse, colors.frame, [1.58, 0.07, 0.06], [0, 0.56, z]);
    block(warehouse, colors.frame, [1.58, 0.07, 0.06], [0, 1.09, z]);
  }
  for (const y of [0.31, 0.84, 1.37]) {
    for (const x of [-0.65, 0, 0.65]) {
      const bundle = group(warehouse);
      stock.push(bundle);
      block(bundle, colors.panels, [0.52, 0.34, 0.39], [x, y, 0.21], 0.035);
      block(bundle, colors.packagingAccent, [0.38, 0.02, 0.025], [x, y + 0.16, 0.41]);
    }
  }
  block(warehouse, colors.frame, [1.75, 0.11, 0.09], [0, 1.72, 0.13], 0.02);
  block(warehouse, colors.packagingAccent, [0.10, 0.13, 0.10], [0.72, 1.75, 0.20], 0.02);
  for (const x of [-0.62, 0.62]) block(warehouse, colors.frame, [0.06, 0.22, 0.067], [x, 1.846, 0.147]);
  signPlate(warehouse, [0, 1.918, 0.177], [1.54, 0.29], '包装盒仓', 'PACKAGING / FINITE STOCK', { accent: '#8ce0c2' });
  label(warehouse, [0, 0.026, 0], [1.54, 0.30], '机器人补给', 'ROBOT REFILL', { floor: true, accent: '#8ce0c2' });
  return (count = 4980) => stock.forEach((bundle, index) => { bundle.visible = index < Math.ceil(stock.length * count / 4980); });
}

function makeRejectCell(parent) {
  const cell = group(parent);
  cell.name = 'Reject transfer cell';
  const [railWest, railEast] = REJECT_GANTRY_RAILS;
  const [front, rear] = REJECT_GANTRY_Z;
  const beamY = REJECT_GANTRY_BEAM;
  const liftDecks = REJECT_LIFTS.map(([x, , z], index) => {
    const tower = group(cell, x, 0, z);
    tower.name = `Reject lift ${index + 1}`;
    // Open on both transfer axes: low runs enter along X, sky runs along Z.
    for (const dx of [-0.51, 0.51]) for (const dz of [-0.51, 0.51]) {
      block(tower, colors.frame, [0.10, 3.75, 0.075], [dx, 1.875, dz], 0.012);
      block(tower, colors.dark, [0.26, 0.08, 0.18], [dx, 0.04, dz]);
    }
    for (const dx of [-0.51, 0.51]) {
      block(tower, colors.reject, [0.10, 0.13, 1.095], [dx, 3.70, 0]);
      // Side brackets reach the suspended truss without crossing the car opening.
      block(tower, colors.frame, [0.22, 0.13, 0.12], [Math.sign(dx) * 0.45, REJECT_LINK_HEIGHT - 0.235, index ? -0.51 : 0.51]);
    }
    signPlate(tower, [0.571, 3.70, 0], [1.04, 0.15], `转载升降 ${index + 1}`, 'PALLET LIFT', { accent: '#ffad87', yaw: Math.PI / 2, depth: 0.032 });
    const deck = group(tower);
    deck.name = `Reject lift ${index + 1} deck`;
    const half = REJECT_LIFT_DECK_SIZE / 2;
    belt(deck, [-half, 0, 0], [half, 0, 0], { width: REJECT_LIFT_DECK_SIZE - 0.104, legs: false, crossTransfer: true });
    return deck;
  });
  // A trussed link is supported by the lift frames, with no legs in the crossing.
  const hangers = group(cell);
  hangers.name = 'Reject link trusses';
  const overhead = [REJECT_LIFTS[0], ...REJECT_ELBOWS, REJECT_LIFTS[1]];
  for (let i = 1; i < overhead.length; i++) {
    const [ax, , az] = overhead[i - 1];
    const [bx, , bz] = overhead[i];
    const length = Math.hypot(bx - ax, bz - az);
    const inset = REJECT_LIFT_DECK_SIZE / 2 + REJECT_HANDOFF_GAP;
    const start = i === 1 ? inset : 0;
    const end = i === overhead.length - 1 ? length - inset : length;
    const center = (start + end) / (2 * length);
    const span = end - start;
    const truss = group(hangers, ax + (bx - ax) * center, REJECT_LINK_HEIGHT - 0.235, az + (bz - az) * center);
    truss.rotation.y = -Math.atan2(bz - az, bx - ax);
    for (const z of [-0.37, 0.37]) {
      block(truss, colors.reject, [span, 0.075, 0.055], [0, 0, z]);
      const n = Math.ceil(span / 0.86);
      for (let j = 0; j < n; j++) {
        const brace = block(truss, colors.frame, [Math.hypot(span / n, 0.125), 0.034, 0.045],
          [span * ((j + 0.5) / n - 0.5), 0.07, z]);
        brace.rotation.z = Math.atan2(j % 2 ? -0.125 : 0.125, span / n);
      }
    }
  }

  const rack = group(cell);
  rack.name = 'Reject staging rack';
  for (const [index, [x, y, z]] of REJECT_RACK_SLOTS.entries()) {
    for (const side of [-1, 1]) block(rack, colors.reject, [0.75, 0.071, 0.082], [x, y - 0.036, z + side * 0.252]);
    block(rack, colors.frame, [0.75, 0.047, 0.42], [x, y - 0.067, z]);
    for (const side of [-1, 1]) block(rack, colors.frame, [0.062, y - 0.085, 0.10], [x + side * 0.306, (y - 0.085) / 2, z]);
    // Apply the address directly to the front rail to preserve loader clearance.
    label(rack, [x, y - 0.036, z + 0.294], [0.425, 0.057], `R${index + 1}`, null, { accent: '#ffad87' });
  }
  const gantry = group(cell);
  gantry.name = 'Reject loading gantry';
  for (const x of [railWest, railEast]) {
    block(gantry, colors.frame, [0.17, 0.18, rear - front + 0.35], [x, beamY + 0.15, (front + rear) / 2]);
    for (const z of [front - 0.21, rear + 0.06]) {
      block(gantry, colors.reject, [0.14, beamY + 0.24, 0.14], [x, (beamY + 0.24) / 2, z], 0.012);
      block(gantry, colors.dark, [0.35, 0.075, 0.28], [x, 0.0375, z]);
    }
  }
  const headerX = (railWest + railEast) / 2;
  const headerZ = front - 0.21;
  // Extend the fixed front uprights above the moving loader sweep.
  for (const x of [railWest, railEast]) {
    block(gantry, colors.reject, [0.14, 0.62, 0.14], [x, beamY + 0.48, headerZ], 0.012);
  }
  block(gantry, colors.frame, [railEast - railWest + 0.14, 0.13, 0.14], [headerX, beamY + 0.73, headerZ]);
  signPlate(gantry, [headerX, beamY + 0.73, headerZ + 0.085], [3.28, 0.36], '不合格品周转 · 专车清运',
    `${REJECT_RACK_SLOTS.length} RACK / ${REJECT_CARGO_SLOTS.length} PER TRIP`, { accent: '#ffad87' });
  const bridge = group(gantry);
  bridge.name = 'Reject moving loader';
  block(bridge, colors.reject, [railEast - railWest + 0.20, 0.14, 0.18], [(railEast + railWest) / 2, beamY, 0], 0.012);
  const trolley = group(bridge);
  trolley.name = 'Reject loader trolley';
  block(trolley, colors.dark, [0.26, 0.17, 0.28], [0, beamY - 0.14, 0], 0.018);
  const hoist = block(trolley, colors.silver, [0.062, 1, 0.062], [0, 0, 0]);
  const forks = group(trolley);
  // Opposed side jaws grip the carrier frame below the product, then lift it.
  const jaws = [-1, 1].map((side) => {
    const jaw = group(forks);
    block(jaw, colors.frame, [0.035, 0.70, 0.085], [0, 0.392, 0]);
    block(jaw, colors.warning, [0.056, 0.047, 0.17], [-side * 0.006, 0.038, 0], 0.008);
    return jaw;
  });
  block(forks, colors.dark, [0.86, 0.050, 0.10], [0, 0.742, 0]);

  const truck = group(cell, ...REJECT_TRUCK_PARK);
  truck.name = 'Reject collection truck';
  const headlight = makeVehicleHeadlight(truck, [-0.61, 0.61].map((z) => [2.674, 0.774, z]), [7.2, 0, 0]);
  const tire = new THREE.CylinderGeometry(0.29, 0.29, 0.19, 22).rotateX(Math.PI / 2);
  const hub = new THREE.CylinderGeometry(0.13, 0.13, 0.219, 10).rotateX(Math.PI / 2);
  const wheels = [];
  for (const x of [-1.05, 1.83]) for (const z of [-0.91, 0.91]) {
    const wheel = group(truck, x, 0.29, z);
    wheel.add(new THREE.Mesh(tire, colors.rubber), new THREE.Mesh(hub, colors.silver));
    wheels.push(wheel);
  }
  block(truck, colors.dark, [4.21, 0.19, 1.70], [0.47, 0.44, 0], 0.035);
  block(truck, colors.silver, [3.46, 0.075, 2.15], [0, 0.6725, 0], 0.014);
  for (const side of [-1, 1]) {
    block(truck, colors.reject, [3.47, 0.29, 0.073], [0, 0.79, side * 1.111], 0.022);
    block(truck, colors.warning, [3.16, 0.020, 0.016], [0, 0.911, side * 1.15]);
    block(truck, colors.brake, [0.033, 0.080, 0.19], [-1.636, 0.509, side * 0.83]);
    block(truck, colors.glass, [0.48, 0.282, 0.03], [1.981, 1.328, side * 0.906], 0.012);
    block(truck, headlight.lens, [0.028, 0.11, 0.225], [2.658, 0.774, side * 0.61], 0.012);
  }
  for (const x of [-1.72, 1.72]) block(truck, colors.reject, [0.055, 0.27, 2.16], [x, 0.803, 0], 0.016);
  block(truck, colors.reject, [0.96, 0.83, 1.80], [2.19, 1.124, 0], 0.084);
  block(truck, colors.frame, [0.94, 0.20, 1.80], [2.20, 0.63, 0], 0.037);
  block(truck, colors.glass, [0.038, 0.28, 1.52], [2.661, 1.333, 0], 0.014);
  block(truck, colors.warning, [0.17, 0.11, 0.33], [2.02, 1.63, 0], 0.031);
  label(truck, [0, 0.806, 1.15], [1.32, 0.147], '不合格品专车', 'QA COLLECTION', { accent: '#ffad87' });
  const cargo = group(truck);
  const stock = group(cell);
  const held = group(forks);
  const intake = group(cell, ...REJECT_INTAKE);
  return { stock, cargo, held, intake, update(frame, liftHeights) {
    const [x, y, z] = frame?.gantry ?? REJECT_GANTRY_HOME;
    bridge.position.z = z;
    trolley.position.x = x;
    forks.position.y = y;
    jaws.forEach((jaw, i) => { jaw.position.x = (i ? 1 : -1) * (frame?.carrying ? 0.381 : 0.395); });
    const forkTop = y + 0.767;
    const stem = beamY - 0.11 - forkTop;
    hoist.scale.y = stem;
    hoist.position.set(0, forkTop + stem / 2, 0);
    truck.visible = frame?.truckVisible ?? true;
    headlight.pose(truck.visible && (frame?.truck === 'departing' || frame?.truck === 'returning'));
    truck.position.x = frame?.truckX ?? REJECT_TRUCK_PARK[0];
    wheels.forEach((wheel) => { wheel.rotation.z = -(truck.position.x - REJECT_TRUCK_PARK[0]) / 0.29; });
    liftDecks.forEach((deck, i) => { deck.position.y = liftHeights[i]; });
  } };
}

function makeBackdrop(parent) {
  const backdrop = group(parent);
  backdrop.name = 'Warehouse backdrop';
  // Confine the facade to the AS/RS bays east of the carton and pedestrian access.
  const firstColumn = 20.45;
  const bayWidth = 2.42;
  const bayCount = 3;
  const centerX = firstColumn + bayWidth * bayCount / 2;
  const span = bayWidth * bayCount + 0.20;
  const { add, finish } = batchBlocks(backdrop);
  for (const y of [0.115, 4.69]) add(colors.dark, [span, 0.23, 0.36], [centerX, y, -5.58], 0, true);
  add(colors.cladding, [span, 0.10, 0.27], [centerX, 3.97, -5.6], 0, true);
  for (const y of [4.06, 4.78]) add(colors.frame, [span, 0.14, 0.60], [centerX, y, -5.38], 0, true);
  for (const y of [4.14, 4.86]) add(colors.cladding, [span, 0.035, 0.655], [centerX, y, -5.365]);
  for (let column = 0; column <= bayCount; column++) {
    const x = firstColumn + column * bayWidth;
    add(colors.frame, [0.18, 4.58, 0.30], [x, 2.29, -5.59], 0, true);
    add(colors.trim, [0.15, 3.34, 0.045], [x, 2.12, -5.414]);
    add(colors.copper, [0.22, 0.30, 0.34], [x, 0.25, -5.57]);
  }
  for (let bay = 0; bay < bayCount; bay++) {
    const x = firstColumn + (bay + 0.5) * bayWidth;
    add(colors.frame, [bayWidth - 0.16, 2.08, 0.12], [x, 1.27, -5.62], 0, true);
    for (const y of [0.66, 1.91]) add(colors.dark, [bayWidth - 0.22, 0.015, 0.042], [x, y, -5.537]);
    for (let i = -5; i <= 5; i++) add(colors.cladding, [0.018, 1.77, 0.05], [x + i * 0.20, 1.28, -5.537]);
    for (const side of [-1, 1]) {
      const panelX = x + side * bayWidth / 4;
      add(colors.blue, [bayWidth / 2 - 0.08, 1.18, 0.053], [panelX, 2.939, -5.58], 0, true);
      add(colors.dark, [bayWidth / 2 - 0.10, 0.025, 0.04], [panelX, 2.85, -5.547]);
    }
    add(colors.trim, [bayWidth - 0.17, 0.09, 0.156], [x, 2.32, -5.59]);
    add(colors.trim, [bayWidth - 0.17, 0.05, 0.088], [x, 3.57, -5.59]);
    add(colors.frame, [0.042, 1.22, 0.1], [x, 2.93, -5.6]);
  }
  finish();

  const heading = group(backdrop, centerX, 3.04, -5.48);
  for (const x of [-2.25, 2.25]) block(heading, colors.frame, [0.13, 0.83, 0.075], [x, 0, -0.075]);
  block(heading, colors.dark, [5.37, 1.01, 0.12], [0, 0, 0], 0.052);
  label(heading, [0, 0, 0.068], [5.22, 0.88], '智能仓储与发运', 'AUTOMATED FULFILLMENT');
  const wms = group(backdrop, 21.66, 0, -5.04);
  block(wms, colors.dark, [1.51, 0.78, 0.36], [0, 0.42, 0], 0.044);
  block(wms, colors.panels, [1.43, 0.63, 0.035], [0, 0.45, 0.196], 0.018);
  block(wms, colors.frame, [1.53, 0.09, 0.37], [0, 0.84, 0], 0.021);
  block(wms, colors.frame, [0.094, 0.49, 0.13], [0, 0.9, -0.002]);
  signPlate(wms, [0, 1.075, 0.077], [1.47, 0.40], '仓储调度', 'WMS / ASRS');
  for (const x of [-0.5, 0.48]) {
    block(wms, colors.trim, [0.06, 0.21, 0.051], [x, 0.453, 0.227], 0.013);
    block(wms, colors.lamp, [0.045, 0.032, 0.007], [x, 0.62, 0.224]);
  }
  for (const x of [23.04, 25.56]) block(backdrop, colors.frame, [0.11, 0.43, 0.14], [x, 4.58, -5.09]);
  signPlate(backdrop, [24.3, 4.45, -5.014], [3.67, 0.46], '立体仓储', `${warehouseCapacity} SLOTS / ASRS`, { accent: '#e0b873' });
}

function makeTruck(parent) {
  const truck = group(parent, ...truckPark);
  truck.name = 'Dispatch truck';
  const headlight = makeVehicleHeadlight(truck, [-0.544, 0.544].map((z) => [2.244, 0.856, z]), [6.7, 0, 0]);
  const axleGeometry = new THREE.CylinderGeometry(0.09, 0.09, 1.45, 12).rotateX(Math.PI / 2);
  const tireGeometry = new THREE.CylinderGeometry(0.285, 0.285, 0.199, 32).rotateX(Math.PI / 2);
  const hubGeometry = new THREE.CylinderGeometry(0.173, 0.173, 0.039, 20).rotateX(Math.PI / 2);
  const diskGeometry = new THREE.CylinderGeometry(0.087, 0.087, 0.022, 16).rotateX(Math.PI / 2);
  const lugGeometry = new THREE.CylinderGeometry(0.011, 0.011, 0.017, 8).rotateX(Math.PI / 2);
  function wheelPart(parentGroup, geometry, material, x, y, z) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parentGroup.add(mesh);
  }
  const wheels = [];
  for (const x of [-0.99, 1.54]) {
    wheelPart(truck, axleGeometry, colors.frame, x, 0.285, 0);
    for (const side of [-1, 1]) {
      const wheel = group(truck, x, 0.285, side * 0.69);
      wheelPart(wheel, tireGeometry, colors.rubber, 0, 0, 0);
      wheelPart(wheel, hubGeometry, colors.trim, 0, 0, side * 0.088);
      wheelPart(wheel, diskGeometry, colors.panels, 0, 0, side * 0.113);
      for (let i = 0; i < 6; i++) {
        const theta = i * Math.PI / 3;
        wheelPart(wheel, lugGeometry, colors.dark, Math.cos(theta) * 0.104, Math.sin(theta) * 0.104, side * 0.118);
      }
      wheels.push(wheel);
    }
  }

  block(truck, colors.dark, [3.74, 0.165, 1.18], [0.32, 0.393, 0], 0.032);
  block(truck, colors.turquoise, [2.6, 0.075, 1.578], [0, truckDeck - 0.088, 0], 0.014);
  block(truck, colors.dark, [2.558, 0.052, 1.567], [0, truckDeck - 0.030, 0]);
  for (let x = -1.22; x <= 1.23; x += 0.136) block(truck, colors.frame, [0.032, 0.005, 1.49], [x, truckDeck - 0.0025, 0]);
  for (const side of [-1, 1]) {
    block(truck, colors.trim, [2.58, 0.025, 0.027], [0, truckDeck - 0.015, side * 0.788]);
    block(truck, colors.copper, [1.27, 0.025, 0.01], [0, truckDeck - 0.064, side * 0.792]);
    block(truck, colors.rubber, [0.035, 0.20, 0.187], [-1.29, 0.313, side * 0.687], 0.012);
    block(truck, colors.brake, [0.02, 0.078, 0.147], [-1.321, 0.478, side * 0.651], 0.009);
    block(truck, colors.turquoise, [0.42, 0.22, 0.051], [0.91, 0.385, side * 0.587], 0.018);
    block(truck, colors.panels, [0.14, 0.034, 0.014], [0.94, 0.396, side * 0.621], 0.004);
  }
  block(truck, colors.turquoise, [0.062, 0.29, 1.55], [-1.285, 0.802, 0], 0.015);
  block(truck, colors.turquoise, [2.59, 0.23, 0.06], [0, 0.774, 0.771], 0.018);
  block(truck, colors.panels, [2.51, 0.045, 0.085], [0, 0.894, 0.777], 0.013);
  for (const x of [-1.24, 1.224]) {
    block(truck, colors.turquoise, [0.09, 1.28, 0.083], [x, 1.233, 0.754], 0.017);
    block(truck, colors.turquoise, [0.09, 1.28, 0.083], [x, 1.233, -0.754], 0.017);
  }
  block(truck, colors.panels, [2.62, 0.054, 1.62], [0, 1.872, 0], 0.019);
  for (const side of [-1, 1]) {
    block(truck, colors.turquoise, [2.62, 0.08, 0.054], [0, 1.839, side * 0.791], 0.012);
    block(truck, colors.lamp, [2.37, 0.007, 0.013], [0, 1.794, side * 0.735]);
  }
  label(truck, [-0.55, 0.779, 0.804], [1.26, 0.155], '万物闪闪', 'DISPATCH');
  block(truck, colors.panels, [0.933, 0.57, 1.52], [1.739, 0.829, 0], 0.114);
  block(truck, colors.frame, [0.951, 0.188, 1.493], [1.752, 0.551, 0], 0.052);
  block(truck, colors.panels, [0.825, 0.84, 1.38], [1.638, 1.277, 0], 0.114);
  block(truck, colors.turquoise, [0.847, 0.081, 1.384], [1.638, 1.707, 0], 0.025);
  block(truck, colors.glass, [0.039, 0.384, 1.176], [2.064, 1.362, 0], 0.016);
  block(truck, colors.dark, [0.007, 0.335, 0.034], [2.087, 1.362, 0]);
  block(truck, colors.turquoise, [0.083, 0.27, 0.83], [2.2, 0.762, 0], 0.021);
  block(truck, colors.dark, [0.024, 0.19, 0.746], [2.247, 0.779, 0], 0.012);
  for (const y of [0.728, 0.774, 0.82]) block(truck, colors.trim, [0.02, 0.012, 0.69], [2.26, y, 0]);
  for (const side of [-1, 1]) {
    block(truck, colors.glass, [0.586, 0.388, 0.031], [1.654, 1.37, side * 0.699], 0.021);
    block(truck, colors.dark, [0.028, 0.032, 0.34], [1.956, 1.326, side * 0.78], 0.01);
    block(truck, colors.dark, [0.11, 0.22, 0.102], [1.938, 1.393, side * 0.867], 0.02);
    block(truck, colors.glass, [0.015, 0.162, 0.066], [1.88, 1.398, side * 0.87], 0.012);
    block(truck, colors.trim, [0.20, 0.024, 0.028], [1.51, 1.083, side * 0.701], 0.008);
    block(truck, colors.glass, [0.041, 0.183, 0.249], [2.208, 0.824, side * 0.544], 0.034);
    block(truck, headlight.lens, [0.016, 0.055, 0.206], [2.235, 0.856, side * 0.544], 0.012);
    block(truck, colors.amber, [0.013, 0.023, 0.116], [2.236, 0.772, side * 0.583], 0.009);
  }
  label(truck, [1.66, 0.994, 0.715], [0.46, 0.115], 'EV 01', null);
  const loadingGate = group(truck, 0, truckDeck + shippingPalletHeight, -0.588);
  loadingGate.name = 'Hinged roller loading gate';
  block(loadingGate, colors.frame, [1.99, 0.318, 0.049], [0, 0.158, -0.077], 0.008);
  block(loadingGate, colors.turquoise, [1.99, 0.318, 0.027], [0, 0.158, -0.113], 0.009);
  for (const x of [-0.976, 0.976]) {
    block(loadingGate, colors.copper, [0.026, 0.31, 0.083], [x, 0.16, -0.042], 0.007);
    block(truck, colors.trim, [0.087, 0.065, 0.102], [x, truckDeck + 0.032, -0.591], 0.012);
  }
  const loadingRollerGeometry = new THREE.CylinderGeometry(0.025, 0.025, 1.89, 12).rotateZ(Math.PI / 2);
  for (const offset of [0.034, 0.105, 0.176, 0.246, 0.307]) {
    const roller = new THREE.Mesh(loadingRollerGeometry, colors.silver);
    roller.position.set(0, offset, -0.025);
    roller.receiveShadow = true;
    loadingGate.add(roller);
  }
  label(loadingGate, [-0.44, 0.165, -0.128], [0.92, 0.104], '装载侧门', null, { yaw: Math.PI });
  truck.userData.pose = (door, moving) => {
    headlight.pose(moving);
    const rotation = -(truck.position.x - truckPark[0]) / 0.285;
    for (const wheel of wheels) wheel.rotation.z = rotation;
    loadingGate.rotation.x = -Math.PI / 2 * door;
  };
  truck.userData.pose(1);
  return truck;
}

export function buildLogisticsPlatform(scene) {
  const platform = group(scene);
  platform.name = 'Warehouse and dispatch platform';
  makeDeck(platform);
  makeBackdrop(platform);
  const setCartonStock = makePackagingWarehouse(platform);
  const rejectCell = makeRejectCell(platform);
  const poseSorter = makeSorter(platform);
  const poseDock = makeRacking(platform);
  const poseStacker = makeStacker(platform);
  const truck = makeTruck(platform);
  return {
    group: platform,
    truck,
    rejectCell,
    setSupportStock: setCartonStock,
    pose({ sortLane, sorting, scanning, checking, stacker, dock, truckDoor = 1, truckMoving = false } = {}) {
      poseSorter({ sortLane, sorting, dock, scanning, checking });
      poseStacker(stacker);
      poseDock(dock);
      truck.userData.pose(truckDoor, truckMoving);
    },
  };
}





