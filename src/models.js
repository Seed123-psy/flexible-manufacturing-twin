import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { makePallet } from './conveyors.js';
import { bufferOutlet, cartonOutlet, palletDepth, palletHeight, printerOutlet, qualityInlet, qualityOutlet, robotDrop, robotOutlet, robotPick, rollerTop, warehouseIntake } from './layout.js';
import { FILAMENT_COLORS, FILAMENT_DOCK, FILAMENT_SPOOL_GRAMS, FILAMENT_STOCK_PER_COLOR,
  FILAMENT_TOOL_SPACING, filamentExchangeAt, filamentPickupAt } from './filament-exchange.js';
import { getProductSize } from './simulation.js';

const palette = {
  pale: '#c9d9e4', silver: '#92aabe', steel: '#445c70', graphite: '#263f55', navy: '#102437',
  midnight: '#091623', ink: '#0c1823', teal: '#2a9c9b', cyan: '#45d5e0',
  amber: '#e9ae58', orange: '#ca854b', paper: '#d7a477', innerPaper: '#b27a55', rubber: '#172334',
};

const surfaces = new Map();
const geometries = new Map();
const labelTextures = new Map();
const labelSurfaces = new WeakMap();
const positiveY = new THREE.Vector3(0, 1, 0);
const sceneUnitsPerMillimeter = 0.0055;
let productTemplate;
let templateHeight;

function paint(name, emissive = 0) {
  const key = `${name}:${emissive}`;
  if (!surfaces.has(key)) {
    const color = palette[name] || name;
    surfaces.set(key, new THREE.MeshStandardMaterial({
      color, emissive: color, emissiveIntensity: emissive,
      metalness: ['silver', 'steel', 'graphite'].includes(name) ? 0.38 : 0.16,
      roughness: ['paper', 'innerPaper', 'rubber'].includes(name) ? 0.88 : 0.43,
    }));
  }
  return surfaces.get(key);
}

const glass = new THREE.MeshPhysicalMaterial({
  color: '#65b1c6', transparent: true, opacity: 0.115, depthWrite: false,
  metalness: 0.26, roughness: 0.2, side: THREE.DoubleSide,
});

function assembly(parent, x = 0, y = 0, z = 0) {
  const group = new THREE.Group();
  group.position.set(x, y, z);
  parent?.add(group);
  return group;
}

function mesh(parent, geometry, surface, x, y, z, shadow = false) {
  const part = new THREE.Mesh(geometry, typeof surface === 'string' ? paint(surface) : surface);
  parent.add(part);
  part.position.set(x, y, z);
  part.castShadow = shadow;
  part.receiveShadow = shadow;
  return part;
}

function box(parent, width, height, depth, x, y, z, surface, radius = 0, shadow = false) {
  const key = `b:${width}:${height}:${depth}:${radius}`;
  if (!geometries.has(key)) {
    const size = Math.min(width, height, depth) * 0.47;
    geometries.set(key, radius > 0
      ? new RoundedBoxGeometry(width, height, depth, 2, Math.min(radius, size))
      : new THREE.BoxGeometry(width, height, depth));
  }
  return mesh(parent, geometries.get(key), surface, x, y, z, shadow);
}

function tube(parent, radius, height, x, y, z, surface, segments = 16) {
  const key = `c:${radius}:${height}:${segments}`;
  if (!geometries.has(key)) geometries.set(key, new THREE.CylinderGeometry(radius, radius, height, segments));
  return mesh(parent, geometries.get(key), surface, x, y, z);
}

function ring(parent, radius, thickness, x, y, z, surface) {
  const key = `t:${radius}:${thickness}`;
  if (!geometries.has(key)) geometries.set(key, new THREE.TorusGeometry(radius, thickness, 8, 32));
  return mesh(parent, geometries.get(key), surface, x, y, z);
}

function imageMap(width, height, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d'));
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  return map;
}

function decal(parent, map, width, height, x, y, z, transparent = false, shared = false) {
  const key = `p:${width}:${height}`;
  if (!geometries.has(key)) geometries.set(key, new THREE.PlaneGeometry(width, height));
  let surface = shared ? labelSurfaces.get(map) : undefined;
  if (!surface) {
    surface = new THREE.MeshBasicMaterial({ map, transparent, alphaTest: transparent ? 0.02 : 0, toneMapped: false });
    if (shared) labelSurfaces.set(map, surface);
  }
  return mesh(parent, geometries.get(key), surface, x, y, z);
}

function label(parent, text, width, height, x, y, z, accent = '#bad9e5', back = '#152c40') {
  const key = `${text}:${width}:${height}:${accent}:${back}`;
  if (!labelTextures.has(key)) {
    const ratio = width / height;
    labelTextures.set(key, imageMap(384, Math.max(36, Math.round(384 / ratio)), (ctx) => {
      const { width: w, height: h } = ctx.canvas;
      ctx.fillStyle = back;
      ctx.fillRect(0, 0, w, h);
      const size = Math.min(h * 0.67, w / Math.max(text.length * 0.60, 3));
      ctx.font = `700 ${size}px Consolas, "Microsoft YaHei", monospace`;
      ctx.fillStyle = accent;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, w / 2, h / 2, w * 0.94);
    }));
  }
  return decal(parent, labelTextures.get(key), width, height, x, y, z, false, true);
}

function bolt(parent, x, y, z, size = 0.025) {
  const fastener = tube(parent, size, 0.017, x, y, z, 'steel', 6);
  fastener.rotation.x = Math.PI / 2;
  return fastener;
}

function plinth(group, width, depth, h = 0.11) {
  box(group, width, h, depth, 0, h * 0.5, 0, 'navy', 0.025, true);
  box(group, width - 0.08, 0.027, depth - 0.08, 0, h + 0.007, 0, 'graphite', 0.015);
  for (const direction of [-1, 1]) {
    box(group, 0.23, 0.017, 0.06, direction * (width / 2 - 0.22), h + 0.023, depth / 2 - 0.065, paint('cyan', 0.7));
  }
}

function led(parent, x, y, z) {
  const light = box(parent, 0.08, 0.025, 0.026, x, y, z, paint('cyan', 0.22), 0.01);
  return (active) => { light.material = active ? paint('cyan', 2.2) : paint('teal', 0.22); };
}

function tower(group, x, y, z) {
  tube(group, 0.061, 0.05, x, y + 0.026, z, 'navy');
  const upper = tube(group, 0.043, 0.075, x, y + 0.095, z, paint('amber', 0.5));
  const lower = tube(group, 0.045, 0.079, x, y + 0.045, z, paint('teal', 0.4));
  return (active) => {
    upper.material = active ? paint('amber', 0.28) : paint('amber', 0.9);
    lower.material = active ? paint('cyan', 2.8) : paint('teal', 0.29);
  };
}

function dimensions(order) {
  const { width, depth, height } = order?.productSize ?? getProductSize(order);
  return {
    width: width * sceneUnitsPerMillimeter,
    depth: depth * sceneUnitsPerMillimeter,
    height: height * sceneUnitsPerMillimeter,
  };
}

export async function loadProductModel() {
  const url = new URL('./assets/coconut-durian.glb', import.meta.url);
  const { scene } = await new GLTFLoader().loadAsync(url.href);
  const bounds = new THREE.Box3().setFromObject(scene);
  const center = bounds.getCenter(new THREE.Vector3());
  const height = bounds.max.y - bounds.min.y;
  if (!Number.isFinite(height) || height <= 0) throw new Error('Invalid product model bounds');

  // Every station places the product by its bottom center.
  productTemplate = assembly();
  scene.position.sub(center.setY(bounds.min.y));
  productTemplate.add(scene);
  templateHeight = height;
}

export function makeProduct(order) {
  const group = assembly();
  const size = dimensions(order);
  const model = productTemplate.clone();
  model.scale.setScalar(size.height / templateHeight);
  group.add(model);
  group.userData.size = size;

  const tint = order?.color === 'original' ? undefined : order?.color;
  const materials = new Map();
  function instanceMaterial(source) {
    if (materials.has(source)) return materials.get(source);
    const material = source.clone();
    if (tint) {
      material.color.set(tint);
      material.map = null;
      material.metalness = 0;
      material.metalnessMap = null;
      material.roughness = 0.55;
      material.roughnessMap = null;
    }
    materials.set(source, material);
    return material;
  }
  function prepareMaterials() {
    if (materials.size) return;
    model.traverse((part) => {
      if (part.isMesh) part.material = Array.isArray(part.material)
        ? part.material.map(instanceMaterial) : instanceMaterial(part.material);
    });
  }
  if (tint) prepareMaterials();

  const layerPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0));
  const clippingPlanes = [layerPlane];
  const layerTop = new THREE.Vector3();
  let clipped = false;
  group.userData.reveal = (progress) => {
    const partial = progress < 1;
    if (partial) {
      group.localToWorld(layerTop.set(0, size.height * progress, 0));
      layerPlane.constant = layerTop.y;
    }
    if (partial === clipped) return;
    prepareMaterials();
    for (const material of materials.values()) material.clippingPlanes = partial ? clippingPlanes : null;
    clipped = partial;
  };
  group.userData.dispose = () => {
    for (const material of materials.values()) material.dispose();
  };
  return group;
}

function cartonDimensions(order) {
  const product = dimensions(order);
  const base = order?.productSize ?? getProductSize(order);
  return {
    width: Math.round((product.width + (order?.box ? Math.max((order.box.width - base.width) * 0.005, 0.12) : 0.13)) * 100) / 100,
    depth: Math.round((product.depth + (order?.box ? Math.max((order.box.depth - base.depth) * 0.006, 0.11) : 0.12)) * 100) / 100,
    height: Math.round((product.height + (order?.box ? Math.max((order.box.height - base.height) * 0.0045, 0.07) : 0.08)) * 100) / 100,
  };
}

export function makeCarton(order, closed = false) {
  const group = assembly();
  const { width, depth, height } = cartonDimensions(order);
  group.userData.size = { width, depth, height };
  const thickness = 0.023;
  box(group, width, thickness, depth, 0, thickness * 0.5, 0, 'innerPaper', 0.005, true);
  const front = assembly(group, 0, thickness, depth / 2 - thickness / 2);
  const rear = assembly(group, 0, thickness, -depth / 2 + thickness / 2);
  const left = assembly(group, -width / 2 + thickness / 2, thickness, 0);
  const right = assembly(group, width / 2 - thickness / 2, thickness, 0);
  const wallHeight = height - thickness * 2;
  for (const side of [front, rear]) box(side, width, wallHeight, thickness, 0, wallHeight / 2, 0, 'paper', 0.005, true);
  for (const side of [left, right]) box(side, thickness, wallHeight, depth - thickness * 2, 0, wallHeight / 2, 0, 'paper', 0.005, true);
  const lid = assembly(rear, 0, wallHeight, -thickness / 2);
  box(lid, width, thickness, depth, 0, thickness / 2, depth / 2, 'paper', 0.005, true);
  box(lid, 0.065, 0.003, depth - 0.012, 0, thickness + 0.0015, depth / 2, 'innerPaper');
  const stickerWidth = width * 0.32;
  const stickerX = 0.034 + stickerWidth / 2 + (width * 0.34 - 0.034 - stickerWidth / 2) * 0.75;
  const sticker = box(lid, stickerWidth, 0.002, depth * 0.32, stickerX, thickness + 0.001, depth * 0.47, '#e2e2d4');
  const ticketY = thickness + 0.005;
  const barcode = label(lid, '││┃│││┃│', width * 0.25, depth * 0.10, stickerX, ticketY, depth * 0.41, '#1a2f36', '#e2e2d4');
  const ticket = label(lid, String(order?.id ?? 'ORDER'), width * 0.25, depth * 0.10, stickerX, ticketY, depth * 0.52, '#1a2f36', '#e2e2d4');
  barcode.rotation.x = -Math.PI / 2;
  ticket.rotation.x = -Math.PI / 2;
  const stamp = order?.text?.trim() || 'CUSTOM / MADE';
  const marker = label(front, stamp, width * 0.54, Math.min(height * 0.26, 0.12), 0, height * 0.48, (thickness / 2 + 0.003), '#483427', '#d7a477');
  const flatMarker = label(front, stamp, width * 0.54, Math.min(height * 0.26, 0.12), 0, height * 0.48, -(thickness / 2 + 0.003), '#483427', '#d7a477');
  flatMarker.rotation.y = Math.PI;
  const scores = assembly(group, 0, thickness + 0.003, 0);
  for (const direction of [-1, 1]) {
    box(scores, width - 0.07, 0.003, 0.012, 0, 0, direction * (depth / 2 - 0.035), '#765a47');
    box(scores, 0.012, 0.003, depth - 0.094, direction * (width / 2 - 0.035), 0, 0, '#765a47');
  }
  group.userData.pose = (fold, seal = 0, labeled = false, stamped = true, scored = false) => {
    const unfolding = (1 - fold) * Math.PI / 2;
    front.rotation.x = unfolding;
    rear.rotation.x = -unfolding;
    left.rotation.z = unfolding;
    right.rotation.z = -unfolding;
    lid.rotation.x = -Math.PI / 1.99 * (1 - seal);
    sticker.visible = labeled;
    barcode.visible = labeled;
    ticket.visible = labeled;
    marker.visible = stamped && fold >= 0.55;
    flatMarker.visible = stamped && fold < 0.55;
    scores.visible = scored && fold < 0.82;
  };
  group.userData.pose(1, Number(closed), closed);
  return group;
}

function setItem(group, old, create, order, tag) {
  if (old?.userData.tag === tag) return old;
  if (old) {
    group.remove(old);
    old.userData.dispose?.();
  }
  const item = create(order);
  item.userData.tag = tag;
  group.add(item);
  return item;
}

function orderTag(order) {
  return [order?.id, order?.text, order?.color, order?.width, order?.depth, order?.height].join('|');
}

function monitor(parent, x, y, z, width, rotation, picture) {
  const group = assembly(parent, x, y, z);
  group.rotation.y = rotation;
  const height = width * 0.57;
  const screenWidth = width - 0.055;
  const screenHeight = height - 0.063;
  box(group, width, height, 0.07, 0, 0, 0, 'silver', 0.03);
  box(group, width - 0.026, height - 0.029, 0.016, 0, 0, 0.04, 'midnight', 0.011);
  box(group, 0.072, 0.24, 0.073, 0, -height / 2 - 0.10, -0.005, 'graphite', 0.02);
  box(group, width * 0.48, 0.036, 0.21, 0, -height / 2 - 0.20, 0.015, 'steel', 0.008);

  if (picture) {
    new THREE.TextureLoader().load(picture, (map) => {
      map.colorSpace = THREE.SRGBColorSpace;
      map.anisotropy = 8;
      const aspect = map.image.width / map.image.height;
      const contentWidth = Math.min(screenWidth, screenHeight * aspect);
      decal(group, map, contentWidth, contentWidth / aspect, 0, 0.005, 0.051);
    });
  } else {
    const map = imageMap(448, 252, (ctx) => {
      ctx.fillStyle = '#081a2b';
      ctx.fillRect(0, 0, 448, 252);
      ctx.fillStyle = '#1b3851';
      ctx.fillRect(0, 0, 448, 29);
      ctx.fillStyle = '#93c9d6';
      ctx.font = '700 15px Consolas, monospace';
      ctx.fillText('  DEVICE MONITOR', 7, 20);
      ctx.strokeStyle = '#25465a';
      ctx.beginPath();
      for (let i = 29; i < 252; i += 18) {
        ctx.moveTo(0, i);
        ctx.lineTo(448, i);
      }
      for (let i = 10; i < 448; i += 22) {
        ctx.moveTo(i, 29);
        ctx.lineTo(i, 252);
      }
      ctx.stroke();
      for (let i = 0; i < 12; i++) {
        const h = 32 + (i * 47) % 104;
        ctx.fillStyle = i % 4 ? '#2a879a' : '#79d1dc';
        ctx.fillRect(35 + i * 33, 221 - h, 16, h);
      }
    });
    decal(group, map, screenWidth, screenHeight, 0, 0.005, 0.051);
  }
  led(group, width * 0.40, -height / 2 + 0.014, 0.054);
  if (picture) {
    // A front-facing hit surface covers the display, even before its texture loads.
    const hitMaterial = new THREE.MeshBasicMaterial({ visible: false });
    const hitArea = mesh(group, new THREE.PlaneGeometry(screenWidth, screenHeight), hitMaterial, 0, 0.005, 0.052);
    hitArea.name = 'Design platform screen';
    return hitArea;
  }
}

function workstation() {
  const group = assembly();
  plinth(group, 3.13, 1.9);
  box(group, 2.94, 0.114, 1.28, 0, 1.09, 0.04, 'pale', 0.036, true);
  box(group, 2.73, 0.08, 1.12, 0, 1.00, 0.02, 'graphite', 0.014);
  for (const x of [-1.26, 1.26]) {
    box(group, 0.17, 0.88, 0.96, x, 0.56, -0.01, 'steel', 0.022, true);
    box(group, 0.24, 0.07, 1.16, x, 0.16, 0.02, 'silver', 0.02);
  }
  box(group, 0.54, 0.69, 0.68, -0.875, 0.49, 0.10, 'navy', 0.034, true);
  box(group, 0.47, 0.57, 0.018, -0.875, 0.50, 0.451, 'graphite', 0.009);
  for (let i = 0; i < 5; i++) box(group, 0.31, 0.017, 0.013, -0.875, 0.34 + i * 0.043, 0.464, 'midnight', 0.003);
  led(group, -0.72, 0.70, 0.468)(true);
  const screens = [
    monitor(group, -0.76, 1.68, -0.24, 1.15, 0.028, new URL('./assets/design-workspace.png', import.meta.url).href),
    monitor(group, 0.43, 1.68, -0.26, 1.15, -0.065, new URL('./assets/design-collection.png', import.meta.url).href),
  ];
  box(group, 0.62, 0.031, 0.21, -0.71, 1.17, 0.37, 'navy', 0.015);
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 7; column++) {
      box(group, 0.07, 0.007, 0.04, -0.96 + column * 0.08, 1.188, 0.307 + row * 0.061, column === 6 ? 'teal' : 'steel', 0.004);
    }
  }
  box(group, 0.084, 0.029, 0.131, -0.26, 1.161, 0.40, 'graphite', 0.025);
  const cradle = assembly(group, 1.06, 1.14, 0.39);
  tube(cradle, 0.35, 0.068, 0, 0.036, 0, 'navy', 32);
  const halo = ring(cradle, 0.287, 0.014, 0, 0.082, 0, paint('cyan', 1.7));
  halo.rotation.x = -Math.PI / 2;
  tube(cradle, 0.252, 0.015, 0, 0.075, 0, 'graphite', 32);
  label(group, 'CAD / 01', 0.56, 0.12, 0.54, 1.082, 0.686, '#27465a', '#c9d9e4');
  const light = led(group, 1.25, 1.083, 0.683);
  let sample;
  return { group, screens, update(frame) {
    light(frame.active);
    sample = setItem(cradle, sample, makeProduct, frame.order, orderTag(frame.order));
    sample.scale.setScalar(0.64);
    sample.position.y = 0.095 + (frame.active ? 0.065 : 0.014) + Math.sin(frame.time * 1.6) * (frame.active ? 0.025 : 0.004);
    sample.rotation.y = frame.time * (frame.motion === 'model' ? 1.3 : 0.38);
    const sliced = frame.motion === 'slice';
    sample.userData.reveal(sliced ? Math.ceil(frame.phaseProgress * 21) / 21 : 1);
  } };
}

export function makeFilamentSpool(tint = '#62cece') {
  const group = assembly();
  for (const side of [-1, 1]) {
    tube(group, 0.205, 0.025, side * 0.087, 0, 0, 'ink', 24).rotation.z = Math.PI / 2;
    ring(group, 0.175, 0.018, side * 0.103, 0, 0, 'steel').rotation.y = Math.PI / 2;
  }
  const winding = tube(group, 0.163, 0.16, 0, 0, 0, tint, 24);
  winding.rotation.z = Math.PI / 2;
  group.userData.setTint = (color) => { winding.material = paint(color); };
  group.userData.setRemaining = (fraction) => {
    const radius = 0.40 + 0.60 * Math.sqrt(THREE.MathUtils.clamp(fraction, 0, 1));
    winding.scale.set(radius, 1, radius);
  };
  return group;
}

export function makeFilamentLoader(parent, id) {
  const group = assembly(parent, 0, 0, FILAMENT_DOCK.z);
  group.name = `Spool exchanger ${id}`;
  const frameZ = -0.13;
  const amber = '#f5bb69';
  const rearLabel = (text, width, height, x, y, z, color = amber) => {
    label(group, text, width, height, x, y, z, color, '#142a35').rotation.y = Math.PI;
  };
  for (const x of [-1.10, 0.78]) {
    box(group, 0.35, 0.09, 0.48, x, 0.055, frameZ + 0.05, 'navy', 0.028, true);
    box(group, 0.32, 0.033, 0.38, x, 0.105, frameZ + 0.05, 'amber', 0.012);
    box(group, 0.137, 2.94, 0.16, x, 1.57, frameZ, 'graphite', 0.021, true);
    box(group, 0.054, 2.69, 0.054, x, 1.53, frameZ - 0.083, 'silver', 0.008);
    for (let step = 0; step < 10; step += 1) {
      box(group, 0.054, 0.014, 0.009, x, 0.37 + step * 0.24, frameZ - 0.114, 'navy');
    }
    const sensorX = Math.sign(x) * 0.77;
    const sensor = box(group, 0.116, 0.080, 0.108, sensorX, FILAMENT_DOCK.y, -0.09, 'graphite', 0.013);
    box(group, 0.070, 0.032, 0.014, sensor.position.x, FILAMENT_DOCK.y, -0.15, paint('cyan', 1.0), 0.007);
    box(group, 0.074, 0.28, 0.20, sensorX, 0.19, -0.09, 'steel', 0.014);
  }
  box(group, 2.08, 0.126, 0.20, -0.16, 3.075, frameZ, 'graphite', 0.022, true);
  box(group, 0.82, 0.213, 0.095, -0.16, 3.06, frameZ - 0.106, 'navy', 0.017);
  rearLabel(`换卷机 ${id.slice(5).padStart(2, '0')}`, 0.78, 0.17, -0.16, 3.06, frameZ - 0.157);
  rearLabel('低位交接', 0.58, 0.12, -0.16, 0.14, frameZ - 0.13);
  const lamp = box(group, 0.13, 0.10, 0.12, 0.78, 3.19, frameZ, paint('teal', 0.6), 0.017);
  const control = box(group, 0.22, 0.33, 0.15, 0.82, 1.10, frameZ - 0.055, 'navy', 0.028);
  box(group, 0.131, 0.095, 0.012, control.position.x, 1.15, frameZ - 0.138, paint('cyan', 0.65), 0.012);
  tube(group, 0.023, 0.026, 0.82, 1.022, frameZ - 0.142, '#ee6453').rotation.x = Math.PI / 2;
  const lifeBar = box(group, 0.49, 0.034, 0.025, -0.16, 2.957, frameZ - 0.16, 'midnight', 0.008);
  const remainingBar = box(group, 0.49, 0.019, 0.014, -0.16, 2.957, frameZ - 0.18, paint('cyan', 0.75), 0.006);
  const carriage = assembly(group);
  box(carriage, 2.0, 0.097, 0.114, -0.16, 0.085, frameZ, 'silver', 0.015);
  for (const x of [-1.10, 0.78]) box(carriage, 0.185, 0.22, 0.173, x, 0.055, frameZ, 'steel', 0.015);
  const slide = assembly(carriage);
  box(slide, 0.72, 0.116, 0.155, -FILAMENT_TOOL_SPACING / 2, 0.085, frameZ + 0.016, 'amber', 0.018);
  function makeTool(x, tint) {
    const arm = assembly(slide, x, 0, 0);
    const link = box(arm, 0.075, 0.055, 1, 0, 0.14, 0, 'steel', 0.009);
    const grip = assembly(arm);
    box(grip, 0.300, 0.078, 0.126, 0, 0.218, -0.075, tint, 0.014);
    for (const side of [-1, 1]) {
      box(grip, 0.041, 0.173, 0.141, side * 0.148, 0.125, -0.031, 'graphite', 0.011);
      box(grip, 0.065, 0.053, 0.101, side * 0.132, 0.031, -0.006, 'rubber', 0.009);
    }
    const reel = makeFilamentSpool();
    grip.add(reel);
    return (reach, visible, fraction, tint) => {
      grip.position.z = reach;
      link.position.z = (reach + frameZ) / 2;
      link.scale.z = reach - frameZ;
      reel.visible = Boolean(visible);
      if (visible) {
        reel.userData.setTint(tint);
        reel.userData.setRemaining(fraction);
      }
    };
  }
  const freshTool = makeTool(0, 'teal');
  const oldTool = makeTool(-FILAMENT_TOOL_SPACING, 'orange');
  return (pose, remaining, state, tint) => {
    carriage.position.y = pose.y;
    slide.position.x = pose.x;
    freshTool(pose.freshReach, pose.freshTool, 1, tint);
    oldTool(pose.oldReach, pose.oldTool, remaining, tint);
    const alert = ['low', 'wait', 'pickup', 'delivery'].includes(state);
    const active = Boolean(pose.hatch || pose.freshTool || pose.oldTool || pose.state === 'handoff' || pose.state === 'verify');
    lamp.material = active ? paint('cyan', 2.0) : alert ? paint('amber', 1.25) : paint('teal', 0.55);
    remainingBar.material = alert ? paint('amber', 0.8) : paint('cyan', 0.75);
    remainingBar.scale.x = Math.max(0.001, remaining);
    remainingBar.position.x = lifeBar.position.x + 0.245 * (remaining - 1);
  };
}

export function makeFilamentWarehouse() {
  const group = assembly();
  group.name = 'RGB filament warehouse';
  box(group, 2.50, 0.09, 1.20, 0, 0.05, 0, 'navy', 0.030, true);
  for (const x of [-1.16, 1.16]) for (const z of [-0.50, 0.50]) {
    box(group, 0.09, 1.58, 0.09, x, 0.82, z, 'graphite', 0.011, true);
    box(group, 0.19, 0.09, 0.15, x, 0.06, z, 'amber', 0.011);
  }
  const stock = FILAMENT_COLORS.map(({ shelfY, code, label: name, tint }) => {
    box(group, 2.35, 0.07, 1.02, 0, shelfY, 0, 'steel', 0.01, true);
    label(group, `${code} ${name}`, 0.58, 0.15, -0.76, shelfY + 0.11, 0.53, tint, '#142a35');
    const rackReels = [];
    for (const x of [-0.20, 0.055, 0.31, 0.60]) {
      const reel = makeFilamentSpool(tint);
      reel.position.set(x, shelfY + 0.24, 0.05);
      group.add(reel);
      rackReels.push(reel);
    }
    return rackReels.reverse(); // The rightmost reel is the one on the extraction cradle.
  });
  box(group, 2.47, 0.13, 0.10, 0, 1.60, -0.42, 'navy', 0.012);
  label(group, 'RGB 耗材仓', 2.30, 0.23, 0, 1.76, 0.52, '#9beada', '#1d354e');
  box(group, 0.075, 1.38, 0.075, 0.91, 0.75, 0.62, 'silver', 0.013, true);
  box(group, 0.29, 0.33, 0.46, -0.64, 0.20, 0.69, 'navy', 0.027, true);
  label(group, '旧卷回收', 0.42, 0.10, -0.64, 0.26, 0.925, '#ffd18a', '#142a35');
  const lift = assembly(group);
  box(lift, 0.26, 0.055, 0.38, 0, -0.206, 0, 'amber', 0.01);
  const link = box(lift, 0.065, 0.06, 1, 0.31, -0.15, 0, 'steel', 0.01);
  return { group, update(remaining, pickup) {
    stock.forEach((reels, slot) => {
      const visible = Math.ceil(reels.length * remaining[slot] / FILAMENT_STOCK_PER_COLOR);
      reels.forEach((reel, index) => { reel.visible = visible > index && (slot !== pickup?.slot || index !== 0); });
    });
    const pose = pickup ? filamentPickupAt(pickup.phaseProgress, pickup.slot) : { x: 0.60, y: 0.43, z: 0.62 };
    lift.position.set(pose.x, pose.y, pose.z);
    link.scale.z = Math.max(0.08, Math.abs(pose.z - 0.62));
    link.position.z = (0.62 - pose.z) / 2;
  } };
}

function makeFeedPath(group, { bay, tint }) {
  const points = [[bay.x, bay.y + 0.16, bay.z], [bay.x, bay.y + 0.19, 0.13],
    [bay.x, 2.53, 0.31], [0.48, 2.53, 0.42], [0.56, 2.24, 0.42], [0.56, 2.08, 0.37]]
    .map((point) => new THREE.Vector3(...point));
  const up = new THREE.Vector3(0, 1, 0);
  let length = 0;
  const segments = points.slice(1).map((to, index) => {
    const from = points[index];
    const axis = to.clone().sub(from);
    const run = axis.length();
    const conductor = tube(group, 0.020, run, 0, 0, 0, paint(tint, 0.85), 8);
    conductor.quaternion.setFromUnitVectors(up, axis.normalize());
    const offset = length;
    length += run;
    return { from, to, run, offset, conductor };
  });
  const roller = assembly(group, bay.x, 2.59, 0.32);
  tube(roller, 0.048, 0.074, 0, 0, 0, 'silver', 12).rotation.z = Math.PI / 2;
  box(roller, 0.078, 0.01, 0.018, 0, 0.046, 0, tint, 0.003);
  const leader = tube(group, 0.030, 0.055, 0, 0, 0, paint(tint, 1.6), 8);
  return (progress, rotation, moving) => {
    roller.rotation.x = rotation;
    leader.visible = false;
    for (const { from, to, run, offset, conductor } of segments) {
      const fraction = THREE.MathUtils.clamp((progress * length - offset) / run, 0, 1);
      conductor.visible = fraction > 0;
      if (!conductor.visible) continue;
      conductor.scale.y = fraction;
      conductor.position.copy(from).lerp(to, fraction / 2);
      if (moving && fraction < 1) {
        leader.visible = true;
        leader.position.copy(from).lerp(to, fraction);
        leader.quaternion.copy(conductor.quaternion);
      }
    }
  };
}

function printer(id) {
  const group = assembly();
  const [, rollerTop, outletZ] = printerOutlet;
  const bedDeck = 0.071;
  const bedAtDock = rollerTop - bedDeck;
  plinth(group, 1.98, 1.77);
  box(group, 1.70, 0.19, 1.51, 0, 0.22, -0.06, 'graphite', 0.045, true);
  box(group, 1.57, 0.21, 1.43, 0, 2.14, -0.075, 'pale', 0.043, true);
  box(group, 1.55, 0.14, 1.43, 0, 0.38, -0.075, 'silver', 0.025);
  box(group, 1.51, 1.70, 0.073, 0, 1.26, -0.756, 'graphite', 0.022, true);
  box(group, 1.23, 1.43, 0.022, 0, 1.25, -0.71, 'steel', 0.014);
  for (const x of [-0.733, 0.733]) {
    box(group, 0.126, 1.74, 1.38, x, 1.27, -0.05, x < 0 ? 'silver' : 'graphite', 0.021, true);
    box(group, 0.142, 1.77, 0.106, x, 1.27, 0.672, 'pale', 0.027);
    box(group, 0.036, 1.59, 0.045, x * 0.84, 1.24, 0.621, 'navy', 0.015);
    for (const z of [-0.49, 0.44]) box(group, 0.18, 0.066, 0.20, x * 0.87, 0.133, z, 'rubber', 0.018);
    for (const y of [0.45, 2.05]) bolt(group, x, y, 0.729, 0.022);
  }
  box(group, 1.42, 0.13, 0.08, 0, 1.995, 0.67, 'navy', 0.017);
  box(group, 1.41, 0.12, 0.082, 0, 0.442, 0.68, 'graphite', 0.013);
  const door = assembly(group, -0.653, 0, 0.715);
  box(door, 1.282, 1.265, 0.02, 0.641, 1.319, 0, glass, 0.014);
  for (const x of [0.014, 1.268]) {
    box(door, 0.027, 1.285, 0.035, x, 1.319, 0.01, 'graphite', 0.006);
  }
  for (const y of [0.681, 1.958]) {
    box(door, 1.285, 0.026, 0.038, 0.643, y, 0.01, 'graphite', 0.006);
    tube(group, 0.042, 0.119, -0.665, y + (y < 1 ? 0.073 : -0.073), 0.727, 'steel', 12);
  }
  box(door, 0.041, 0.182, 0.058, 1.173, 1.331, 0.037, 'pale', 0.013);
  box(group, 1.31, 0.071, 0.1, 0, 0.555, 0.671, 'steel', 0.013, true);
  for (const x of [-0.444, 0.444]) {
    box(group, 0.12, 0.095, 0.11, x, 0.604, 0.746, 'graphite', 0.009);
    box(group, 0.055, 0.010, 0.027, x, 0.653, 0.779, paint('amber', 0.7), 0.003);
  }
  box(group, 1.20, 0.027, 0.037, -0.01, 1.93, 0.35, paint('cyan', 1.4));
  box(group, 0.319, 0.187, 0.038, 0.57, 2.15, 0.674, 'navy', 0.022);
  label(group, id.toUpperCase().replace('PRINT', 'P-0'), 0.257, 0.105, 0.571, 2.155, 0.697, '#8cfff4', '#102d41');
  label(group, 'BAMBU LAB', 0.59, 0.102, -0.35, 2.145, 0.677, '#27465a', '#c9d9e4');
  const activity = led(group, -0.07, 0.437, 0.738);
  const releaseSignal = led(group, 0.53, 0.555, 0.728);
  for (let i = 0; i < 7; i++) box(group, 0.20, 0.021, 0.012, -0.45, 0.19 + (i % 3) * 0.031, 0.704, 'midnight');

  const rails = assembly(group);
  for (const x of [-0.538, 0.538]) {
    tube(rails, 0.026, 1.47, x, 1.174, -0.40, 'pale');
    tube(rails, 0.018, 1.47, x, 1.174, 0.23, 'steel');
  }
  const bed = assembly(group, 0, 0.66, -0.10);
  box(bed, 1.14, 0.087, 1.069, 0, 0, 0, 'midnight', 0.027);
  box(bed, 1.07, 0.026, 0.992, 0, 0.057, 0, 'steel', 0.012);
  for (let i = 0; i < 7; i++) {
    box(bed, 0.974, 0.002, 0.008, 0, 0.072, (i - 3) * 0.133, 'graphite');
    box(bed, 0.008, 0.002, 0.91, (i - 3) * 0.14, 0.072, 0, 'graphite');
  }
  box(bed, 0.27, 0.04, 0.08, 0, 0.01, 0.552, 'teal', 0.015);
  const plate = makePallet();
  bed.add(plate);
  const extraction = assembly(bed);
  const guides = [];
  for (const x of [-0.245, 0.245]) {
    box(bed, 0.059, 0.025, 0.95, x, bedDeck - 0.016, 0.007, 'graphite', 0.006);
    guides.push(box(extraction, 0.044, 0.017, 1, x, bedDeck - 0.010, 0, 'silver', 0.003));
    box(extraction, 0.033, 0.024, 0.067, x, bedDeck + 0.006, 0, 'amber', 0.004);
  }
  const pushBar = box(extraction, 0.557, 0.019, 0.051, 0, bedDeck + 0.012, 0, 'steel', 0.006);
  const gantry = assembly(group, 0, 1.63, -0.03);
  const cross = tube(gantry, 0.035, 1.26, 0, 0, 0, 'pale');
  cross.rotation.z = Math.PI / 2;
  box(gantry, 1.23, 0.04, 0.082, 0, 0.095, 0.08, 'graphite', 0.012);
  const tool = assembly(gantry);
  box(tool, 0.278, 0.262, 0.253, 0, -0.043, 0.045, 'pale', 0.041);
  box(tool, 0.224, 0.16, 0.024, 0, -0.052, 0.180, 'navy', 0.020);
  tube(tool, 0.074, 0.023, 0, -0.049, 0.203, 'steel').rotation.x = Math.PI / 2;
  tube(tool, 0.029, 0.022, 0, -0.049, 0.215, 'navy').rotation.x = Math.PI / 2;
  tube(tool, 0.03, 0.11, 0, -0.205, 0.024, 'amber');
  box(tool, 0.062, 0.020, 0.032, 0.09, -0.139, 0.168, paint('cyan', 1.7));

  const feeder = assembly(group, 0, 2.25, -0.07);
  box(feeder, 1.34, 0.12, 1.03, 0, 0.085, 0.010, 'navy', 0.035, true);
  const spoolCover = assembly(feeder, 0, 0.55, 0.45);
  box(spoolCover, 1.28, 0.046, 0.91, 0, 0, -0.453, 'graphite', 0.02);
  box(spoolCover, 1.25, 0.36, 0.032, 0, -0.204, -0.903, glass, 0.008);
  box(feeder, 1.25, 0.35, 0.024, 0, 0.345, 0.458, glass, 0.008);
  box(feeder, 1.22, 0.048, 0.026, 0, 0.204, -0.482, 'teal', 0.006);
  const refillLight = led(feeder, -0.57, 0.174, 0.474);
  const spools = [];
  const feedPaths = [];
  for (const { index, code, tint, bay } of FILAMENT_COLORS) {
    box(feeder, 0.237, 0.061, 0.80, bay.x, 0.18, -0.028, 'graphite', 0.023);
    const spool = makeFilamentSpool(tint);
    spool.position.set(bay.x, bay.y - feeder.position.y, bay.z - feeder.position.z);
    feeder.add(spool);
    spools.push(spool);
    label(feeder, `${code}${index + 1}`, 0.19, 0.086, bay.x, 0.177, 0.478, tint, '#142a35');
    label(feeder, code, 0.17, 0.085, bay.x, 0.177, -0.50, tint, '#142a35').rotation.y = Math.PI;
    feedPaths.push(makeFeedPath(group, FILAMENT_COLORS[index]));
  }
  const updateLoader = makeFilamentLoader(group, id);
  const frontVents = assembly(group);
  for (let i = 0; i < 7; i++) box(frontVents, 0.018, 0.45, 0.038, 0.798, 0.752, -0.56 + i * 0.068, 'ink', 0.007);
  for (const y of [1.63, 1.36]) {
    const wheel = ring(group, 0.104, 0.025, 0.8, y, -0.53, 'steel', 18);
    wheel.rotation.y = Math.PI / 2;
    for (let i = -2; i <= 2; i++) box(group, 0.020, 0.013, 0.17, 0.808, y + i * 0.035, -0.53, 'ink', 0.003);
  }
  let sample;
  return { group, update(frame) {
    activity(frame.active);
    sample = setItem(plate, sample, makeProduct, frame.order, orderTag(frame.order));
    const printing = frame.motion === 'print';
    const unloading = frame.motion === 'unload';
    const resetting = frame.motion === 'reset';
    const changing = frame.motion === 'load-filament';
    const waitingForMaterial = frame.motion === 'wait-filament';
    releaseSignal(unloading || resetting);
    const steps = Math.min(Math.max(frame.order?.layers || 180, 1), 90);
    const progress = printing ? Math.max(1, Math.floor(frame.phaseProgress * steps)) / steps : 1;
    const size = sample.userData.size;
    const p = frame.phaseProgress;
    const open = unloading ? THREE.MathUtils.smoothstep(p, 0, 0.28)
      : resetting ? 1 - THREE.MathUtils.smoothstep(p, 0.44, 1) : 0;
    door.rotation.y = -1.46 * open;
    const extension = unloading ? THREE.MathUtils.smoothstep(p, 0.27, 1)
      : resetting ? 1 - THREE.MathUtils.smoothstep(p, 0, 0.65) : 0;
    const travel = outletZ - bed.position.z - 0.01;
    const pushPosition = 0.01 - palletDepth * 0.49 + travel * extension;
    extraction.visible = unloading || resetting;
    pushBar.position.z = pushPosition;
    for (const guide of guides) {
      const guideStart = -0.45;
      const guideEnd = pushPosition + 0.19;
      guide.position.z = (guideStart + guideEnd) / 2;
      guide.scale.z = guideEnd - guideStart;
    }
    bed.position.y = THREE.MathUtils.lerp(0.80, bedAtDock, progress);
    plate.position.set(0, bedDeck, 0.01 + (unloading ? travel * extension : 0));
    plate.visible = !resetting || p > 0.73;
    sample.position.y = palletHeight;
    sample.visible = frame.active && !resetting && !changing && !waitingForMaterial;
    gantry.position.y = printing ? bed.position.y + bedDeck + palletHeight + 0.266 + size.height * progress : 1.71;
    gantry.position.z = printing ? -0.114 + (((p * 48) % 1) - 0.5) * size.depth : -0.19;
    tool.position.x = printing ? Math.sin(frame.time * 22) * size.width / 2 : -0.43;
    sample.userData.reveal(progress);
    const slot = frame.filamentSlot ?? 0;
    const pose = filamentExchangeAt(changing ? p : null, slot);
    const remaining = (index) => (frame.filamentRemaining?.[index] ?? FILAMENT_SPOOL_GRAMS) / FILAMENT_SPOOL_GRAMS;
    spoolCover.rotation.x = 1.65 * pose.hatch;
    for (const { index } of FILAMENT_COLORS) {
      const reel = spools[index];
      const replacing = changing && index === slot;
      reel.visible = !replacing || pose.oldBay || pose.freshBay;
      reel.userData.setRemaining(replacing && pose.freshBay ? 1 : remaining(index));
      const priming = replacing && pose.feed > 0 && pose.feed < 1;
      const printingColor = printing && index === Math.min(spools.length - 1, Math.floor(p * spools.length));
      const angle = priming ? pose.feed * Math.PI * 4 : printingColor ? frame.time * 4.0 : 0;
      reel.rotation.x = angle;
      feedPaths[index](replacing ? pose.feed : 1, angle * 3, priming);
    }
    const lowest = Math.min(...FILAMENT_COLORS.map(({ index }) => remaining(index)));
    updateLoader(pose, changing ? remaining(slot) : lowest, frame.filamentState, FILAMENT_COLORS[slot].tint);
    refillLight(changing || waitingForMaterial);
  } };
}

function bedWithRollers(parent, width, depth, x, y, z, cutouts = {}) {
  const frame = assembly(parent, x, y, z);
  box(frame, width, 0.125, depth, 0, -0.02, 0, 'navy', 0.024, true);
  for (const rail of [-1, 1]) {
    const limit = width / 2;
    const gap = rail > 0 ? cutouts.front : cutouts.rear;
    const spans = gap ? [[-limit, gap[0]], [gap[1], limit]] : [[-limit, limit]];
    for (const [start, end] of spans) {
      const length = Math.min(end, limit) - Math.max(start, -limit);
      if (length < 0.045) continue;
      const center = Math.max(start, -limit) + length / 2;
      box(frame, length, 0.092, 0.071, center, 0.02, rail * depth * 0.485, 'silver', 0.012);
      box(frame, length * 0.89, 0.012, 0.026, center, 0.072, rail * depth * 0.486, paint('teal', 0.5));
    }
  }
  const bars = Math.ceil(width / 0.16);
  for (let i = 0; i < bars; i++) {
    tube(frame, 0.032, depth - 0.135, ((i + 0.5) / bars - 0.5) * width, 0.025, 0, i % 4 === 0 ? 'silver' : 'steel', 10).rotation.x = Math.PI / 2;
  }
  return frame;
}

function quality() {
  const group = assembly();
  const [inX, deck, bedZ] = qualityInlet;
  const [outX] = qualityOutlet;
  plinth(group, 3.02, 2.17);

  box(group, 2.66, 0.092, 0.74, 0, 0.925, -0.461, 'pale', 0.022, true);
  for (const x of [-1.10, 1.08]) {
    box(group, 0.34, 0.74, 0.55, x, 0.51, -0.421, 'graphite', 0.021, true);
    box(group, 0.253, 0.513, 0.024, x, 0.518, -0.136, 'steel', 0.013);
    box(group, 0.12, 0.022, 0.031, x, 0.701, -0.112, 'pale', 0.006);
  }
  box(group, 2.46, 0.089, 0.079, 0, 0.256, -0.482, 'steel', 0.012);
  bedWithRollers(group, 2.64, 0.82, 0, deck - 0.057, bedZ, { front: [inX - 0.43, inX + 0.43] });
  for (const x of [-1.17, -0.33, 0.92]) {
    box(group, 0.074, 0.36, 0.068, x, 0.325, bedZ + 0.27, 'graphite', 0.009);
    box(group, 0.148, 0.028, 0.139, x, 0.148, bedZ + 0.27, 'steel', 0.007);
  }
  for (const side of [-1, 1]) {
    box(group, 0.062, 0.012, 0.67, inX + side * 0.195, deck - 0.006, bedZ + 0.12, 'rubber', 0.002);
    box(group, 0.045, 0.079, 0.105, inX + side * 0.42, deck + 0.03, bedZ + 0.42, 'amber', 0.009);
  }

  const arch = assembly(group, 0.44, deck, bedZ);
  for (const z of [-0.428, 0.428]) {
    box(arch, 0.142, 0.91, 0.09, 0, 0.441, z, 'silver', 0.014, true);
    box(arch, 0.169, 0.045, 0.117, 0, 0.04, z, 'graphite', 0.008);
    box(arch, 0.058, 0.637, 0.01, 0.042, 0.435, z * 0.884, paint('cyan', 0.55), 0.004);
  }
  box(arch, 0.36, 0.128, 0.98, 0, 0.858, 0, 'graphite', 0.025, true);
  label(arch, 'OPTICAL QC', 0.29, 0.062, 0, 0.855, 0.501, '#d7f4eb', '#263d40');
  const sensor = box(arch, 0.16, 0.075, 0.34, 0, 0.764, 0, 'navy', 0.012);
  const scanRing = tube(arch, 0.053, 0.021, 0, 0.722, 0, paint('cyan', 0.57), 16);
  const beamMaterial = new THREE.MeshBasicMaterial({ color: 0x69f7cd, transparent: true, opacity: 0.21, depthWrite: false });
  const beam = box(arch, 0.01, 0.684, 0.69, 0.011, 0.367, 0, beamMaterial);

  monitor(group, -0.88, 1.37, -0.48, 0.62, 0.18);
  const status = tower(group, 1.10, 1.088, -0.51);
  const workLight = led(group, 1.02, 0.907, -0.07);
  const cleaner = assembly(group, inX, 1.28, bedZ - 0.26);
  box(cleaner, 0.28, 0.097, 0.356, 0, 0.097, -0.079, 'graphite', 0.014);
  tube(cleaner, 0.029, 0.162, 0, 0.026, 0.092, 'silver');
  const cleaningTip = tube(cleaner, 0.055, 0.07, 0, -0.057, 0.092, 'amber');
  const pallet = makePallet();
  group.add(pallet);
  let sample;

  return { group, update(frame) {
    status(frame.active);
    const cleaning = frame.motion === 'clean';
    const inspecting = frame.motion === 'inspect';
    const waiting = frame.motion === 'wait-outfeed';
    pallet.visible = cleaning || inspecting || waiting;
    workLight(inspecting);
    if (!pallet.visible) {
      beam.visible = false;
      return;
    }

    sample = setItem(pallet, sample, makeProduct, frame.order, orderTag(frame.order));
    sample.position.y = palletHeight;
    const p = frame.phaseProgress;
    const distance = inspecting ? THREE.MathUtils.smoothstep(p, 0, 0.98) : Number(waiting);
    pallet.position.set(THREE.MathUtils.lerp(inX, outX, distance), deck, bedZ);
    const size = sample.userData.size;
    const cleanStroke = cleaning ? Math.sin(Math.PI * p) : 0;
    cleaner.position.x = inX + Math.sin(p * Math.PI * 3) * size.width * 0.37 * cleanStroke;
    cleaner.position.y = THREE.MathUtils.lerp(1.38, deck + palletHeight + size.height * 0.83 + 0.075, cleanStroke);
    cleaningTip.rotation.y = frame.time * cleanStroke * 8;
    beam.visible = inspecting && Math.abs(pallet.position.x - 0.44) < 0.35;
    sensor.position.z = scanRing.position.z = inspecting ? Math.sin(p * Math.PI * 4) * 0.115 : 0;
  } };
}

function cartonLine() {
  const group = assembly();
  plinth(group, 4.48, 2.13);
  for (const x of [-1.87, -0.73, 0.48, 1.79]) {
    for (const z of [-0.29, 0.76]) {
      box(group, 0.11, 0.48, 0.1, x, 0.39, z, 'graphite', 0.011, true);
      box(group, 0.18, 0.052, 0.17, x, 0.159, z, 'steel', 0.009);
      bolt(group, x, 0.188, z + 0.05, 0.018).rotation.x = 0;
    }
    box(group, 0.13, 0.07, 1.08, x, 0.31, 0.235, 'steel', 0.009);
  }
  bedWithRollers(group, 4.34, 1.36, -0.08, rollerTop - 0.057, cartonOutlet[2]);
  box(group, 4.22, 0.11, 0.032, -0.08, 0.491, 0.933, 'graphite', 0.006);
  box(group, 3.98, 0.056, 0.06, -0.08, 0.285, 0.76, 'steel', 0.008);
  for (const [index, name] of ['FEED', 'PRINT', 'DIE CUT', 'FOLD'].entries()) {
    label(group, name, 0.56, 0.088, -1.57 + index * 0.91, 0.491, 0.952, '#d0e2e5', '#263f55');
  }
  const feeder = assembly(group, -1.66, rollerTop, cartonOutlet[2]);
  for (const x of [-0.40, 0.39]) {
    box(feeder, 0.073, 0.53, 0.06, x, 0.27, -0.35, 'steel', 0.007);
    box(feeder, 0.073, 0.53, 0.06, x, 0.27, 0.36, 'steel', 0.007);
    box(feeder, 0.05, 0.06, 0.78, x, 0.51, 0, 'silver', 0.006);
  }
  const blanks = assembly(feeder, 0, 0.29, 0);
  box(blanks, 0.80, 0.058, 0.72, 0, -0.02, 0, 'graphite', 0.01);
  for (let i = 0; i < 7; i++) {
    box(blanks, 0.69, 0.015, 0.62, -i * 0.006, 0.02 + i * 0.022, 0.015, i % 2 ? 'paper' : 'innerPaper', 0.002);
  }
  for (const x of [-0.25, 0.25]) {
    tube(feeder, 0.063, 0.62, x, 0.117, 0, 'rubber', 16).rotation.x = Math.PI / 2;
    tube(feeder, 0.038, 0.05, x, 0.117, 0.33, 'steel', 12).rotation.x = Math.PI / 2;
  }
  box(feeder, 0.37, 0.09, 0.035, -0.05, 0.51, 0.399, 'navy', 0.007);
  label(feeder, 'MAGAZINE', 0.32, 0.069, -0.05, 0.51, 0.419, '#bad6dd', '#102437');

  const gantries = [];
  for (const [x, title, clearance] of [[-0.60, 'DIGITAL PRESS', 0], [0.35, 'CREASE / DIE', 0], [1.21, 'BOX FORMER', 0.94]]) {
    const frame = assembly(group, x, rollerTop - 0.048, 0.09);
    for (const z of [-0.556, 0.548]) {
      box(frame, 0.135, 0.63 + clearance, 0.116, 0, 0.32 + clearance / 2, z, 'silver', 0.025, true);
      box(frame, 0.087, 0.56 + clearance, 0.015, 0, 0.336 + clearance / 2, z + 0.063, 'graphite', 0.006);
    }
    box(frame, 0.78, 0.17, 1.20, 0, 0.696 + clearance, 0, 'pale', 0.034, true);
    box(frame, 0.732, 0.08, 1.14, 0, 0.578 + clearance, 0, 'graphite', 0.016);
    box(frame, 0.58, 0.47 + clearance, 0.012, 0, 0.31 + clearance / 2, -0.61, glass, 0.012);
    box(frame, 0.57, 0.03, 0.025, 0, 0.52 + clearance, 0.53, paint('pale', 0.5), 0.003);
    label(frame, title, 0.62, 0.093, 0, 0.687 + clearance, 0.609, '#27465a', '#c9d9e4');
    const head = assembly(frame, 0, 0.46 + clearance, 0.013);
    tube(head, 0.031, 0.25, -0.19, 0.069, 0, 'silver');
    tube(head, 0.031, 0.25, 0.19, 0.069, 0, 'silver');
    box(head, 0.52, 0.098, 0.80, 0, -0.066, 0, 'steel', 0.023);
    box(head, 0.49, 0.022, 0.052, 0, -0.107, 0.399, paint('amber', 1.15), 0.004);
    gantries.push({ head, rest: 0.46 + clearance });
  }
  const folders = [-1, 1].map((side) => {
    const hinge = assembly(group, 1.38, rollerTop + 0.01, cartonOutlet[2] + side * 0.41);
    box(hinge, 0.63, 0.025, 0.25, 0, 0, -side * 0.12, 'silver', 0.01);
    box(hinge, 0.62, 0.034, 0.043, 0, 0.02, -side * 0.23, 'amber', 0.007);
    tube(hinge, 0.032, 0.58, 0, 0, 0, 'graphite').rotation.z = Math.PI / 2;
    return hinge;
  });
  const drive = assembly(group, 1.89, 0.53, 0.82);
  tube(drive, 0.082, 0.22, 0, 0, 0.04, 'steel', 16).rotation.x = Math.PI / 2;
  tube(drive, 0.066, 0.035, 0, 0, 0.158, 'graphite', 16).rotation.x = Math.PI / 2;
  for (let i = -2; i <= 2; i++) box(drive, 0.141, 0.018, 0.11, 0, i * 0.028, 0.01, 'graphite', 0.004);
  const signal = tower(group, 1.44, 2.306, -0.31);
  const status = led(group, 1.71, 0.491, 0.949);
  const steps = ['feed', 'imprint', 'diecut', 'fold', 'convey'];
  const stageLimits = [-1.69, -0.94, -0.03, 0.89, 1.53, cartonOutlet[0]];
  let carton;
  return { group, update(frame) {
    signal(frame.active);
    status(frame.active);
    carton = setItem(group, carton, makeCarton, frame.order, orderTag(frame.order));
    const step = steps.indexOf(frame.motion);
    const p = frame.phaseProgress;
    carton.visible = step >= 0;
    const fold = step === 3 ? THREE.MathUtils.smoothstep(p, 0.16, 0.83) : Number(step > 3);
    if (carton.visible) {
      carton.position.set(THREE.MathUtils.lerp(stageLimits[step], stageLimits[step + 1], p), cartonOutlet[1], cartonOutlet[2]);
      carton.userData.pose(fold, 0, false, step > 1 || (step === 1 && p > 0.46), step > 2 || (step === 2 && p > 0.50));
    }
    blanks.position.y = 0.29 - (step === 0 ? Math.sin(p * Math.PI) * 0.044 : 0);
    for (let i = 0; i < folders.length; i++) folders[i].rotation.x = (i * 2 - 1) * Math.sin(fold * Math.PI) * 0.66;
    gantries.forEach(({ head, rest }, i) => {
      const stroke = i < 2 ? 0.29 : 0.035;
      head.position.y = rest - (step === i + 1 ? Math.sin(p * Math.PI) * stroke : 0);
    });
  } };
}

function robotCell() {
  const group = assembly();
  plinth(group, 3.56, 2.91);
  const pick = new THREE.Vector3(...robotPick);
  const drop = new THREE.Vector3(...robotDrop);
  const pedestal = new THREE.Vector3(-0.08, 0.92, -0.38);
  bedWithRollers(group, 0.76, 0.85, pick.x, rollerTop - 0.057, pick.z, { rear: [-0.36, 0.36], front: [-0.36, 0.36] });
  const packWidth = 1.72;
  const packCenter = robotOutlet[0] + 0.18 - packWidth / 2;
  const dropOffset = drop.x - packCenter;
  bedWithRollers(group, packWidth, 0.92, packCenter, rollerTop - 0.057, drop.z, { front: [dropOffset - 0.38, dropOffset + 0.38] });
  for (const x of [-1.52, -0.73, 0.52, 1.49]) {
    box(group, 0.10, 0.39, 0.81, x, 0.324, 0.62, 'graphite', 0.018, true);
    box(group, 0.16, 0.059, 0.85, x, 0.175, 0.62, 'silver', 0.013);
  }
  label(group, 'PALLET IN', 0.57, 0.080, pick.x, 0.514, 1.08, '#8bbdc7', '#152c40');
  label(group, 'PACK / OUT', 0.63, 0.080, drop.x + 0.15, 0.514, 1.143, '#8bbdc7', '#152c40');
  const returnTray = assembly(group, pick.x, rollerTop, pick.z + 0.48);
  box(returnTray, 0.74, 0.057, 0.42, 0, -0.032, 0.035, 'graphite', 0.008, true);
  box(returnTray, 0.71, 0.047, 0.029, 0, 0.015, 0.244, 'steel', 0.006);
  const transferBelts = [];
  for (const side of [-1, 1]) {
    box(returnTray, 0.094, 0.047, 0.043, 0.29 * side, 0.015, -0.13, 'amber', 0.004);
    box(returnTray, 0.064, 0.435, 0.063, 0.29 * side, -0.282, 0.15, 'steel', 0.006);
    const belt = box(group, 0.051, 0.017, 0.83, pick.x + side * 0.19, rollerTop - 0.012, pick.z + 0.235, 'rubber', 0.005);
    transferBelts.push(belt);
  }
  box(group, 0.12, 0.29, 0.072, pick.x + 0.39, rollerTop + 0.122, pick.z - 0.27, 'steel', 0.011);
  const pickSensor = led(group, pick.x + 0.39, rollerTop + 0.24, pick.z - 0.222);
  const pallet = makePallet();
  group.add(pallet);
  const sealingUnit = assembly(group, 1.50, 0.58, 0.12);
  box(sealingUnit, 0.27, 0.83, 0.22, 0, 0.43, 0, 'steel', 0.022, true);
  box(sealingUnit, 0.26, 0.147, 0.22, 0, 0.47, 0.044, 'navy', 0.018);
  label(sealingUnit, 'SEAL', 0.173, 0.058, 0, 0.47, 0.16, '#91d9de', '#102437');
  box(sealingUnit, 0.13, 0.069, 0.53, 0, 0.88, 0.24, 'silver', 0.016);
  const labelHead = assembly(sealingUnit, -0.14, 0.75, 0.48);
  box(labelHead, 0.376, 0.090, 0.178, 0, 0, 0, 'graphite', 0.019);
  box(labelHead, 0.235, 0.012, 0.017, -0.02, -0.007, 0.094, paint('cyan', 0.64));
  tube(labelHead, 0.035, 0.205, -0.163, 0.047, 0, 'silver').rotation.z = Math.PI / 2;
  tube(labelHead, 0.05, 0.056, 0.15, 0.03, 0.048, 'amber').rotation.z = Math.PI / 2;
  const sealingRam = tube(sealingUnit, 0.031, 0.23, -0.14, 0.8, 0.48, 'silver');

  const base = assembly(group, pedestal.x, 0.125, pedestal.z);
  tube(base, 0.441, 0.10, 0, 0.08, 0, 'rubber', 24);
  tube(base, 0.377, 0.252, 0, 0.201, 0, 'steel', 28);
  tube(base, 0.343, 0.101, 0, 0.363, 0, 'navy', 24);
  tube(base, 0.315, 0.061, 0, 0.425, 0, paint('cyan', 0.68), 28);
  tube(base, 0.276, 0.205, 0, 0.525, 0, 'amber', 24);
  for (let i = 0; i < 8; i++) {
    const angle = i * Math.PI / 4;
    bolt(base, Math.cos(angle) * 0.357, 0.135, Math.sin(angle) * 0.357, 0.02).rotation.x = 0;
  }
  const rotatingBase = assembly(base, 0, 0.61, 0);
  box(rotatingBase, 0.448, 0.34, 0.49, 0, 0.056, 0, 'amber', 0.076, true);
  box(rotatingBase, 0.19, 0.119, 0.057, 0, 0.077, 0.244, 'steel', 0.019);
  label(rotatingBase, 'AX-06', 0.159, 0.056, 0, 0.08, 0.274, '#dfe4dc', '#445c70');

  const segments = [];
  for (const [width, depth, color] of [[0.29, 0.33, 'amber'], [0.235, 0.25, '#d79a52']]) {
    const arm = assembly(group);
    box(arm, width, 1, depth, 0, 0.50, 0, color, 0.064, true);
    box(arm, width * 0.60, 0.64, 0.031, 0, 0.49, depth / 2, 'graphite', 0.012);
    box(arm, width * 0.24, 0.46, 0.033, 0, 0.49, depth / 2 + 0.016, 'steel', 0.008);
    box(arm, 0.033, 0.66, depth * 0.50, -width / 2 - 0.015, 0.50, 0, 'navy', 0.011);
    for (const y of [0.23, 0.78]) box(arm, 0.043, 0.084, depth * 0.66, -width / 2 - 0.02, y, 0, 'steel', 0.006);
    segments.push(arm);
  }
  const pivots = [];
  for (const radius of [0.24, 0.202, 0.151]) {
    const hub = assembly(group);
    tube(hub, radius, radius * 1.43, 0, 0, 0, 'graphite', 24).rotation.x = Math.PI / 2;
    tube(hub, radius * 0.79, 0.05, 0, 0, radius * 0.72, 'silver', 24).rotation.x = Math.PI / 2;
    ring(hub, radius * 0.52, 0.017, 0, 0, radius * 0.83, paint('cyan', 0.59));
    tube(hub, radius * 0.18, 0.021, 0, 0, radius * 0.879, 'rubber', 14).rotation.x = Math.PI / 2;
    pivots.push(hub);
  }

  const gripper = assembly(group);
  tube(gripper, 0.112, 0.12, 0, -0.050, 0, 'steel');
  const guide = box(gripper, 0.64, 0.097, 0.22, 0, -0.138, 0, 'navy', 0.023);
  const slide = box(gripper, 0.59, 0.031, 0.18, 0, -0.194, 0, 'silver', 0.008);
  box(gripper, 0.35, 0.023, 0.022, 0, -0.125, 0.114, 'amber', 0.004);
  const jawSignal = led(gripper, 0, -0.114, 0.132);
  const jaws = [];
  for (const sign of [-1, 1]) {
    const jaw = assembly(gripper, sign * 0.22, -0.26, 0);
    box(jaw, 0.043, 0.141, 0.175, 0, 0, 0, 'silver', 0.004);
    box(jaw, 0.035, 0.075, 0.16, -sign * 0.039, -0.046, 0, 'rubber', 0.008);
    for (let i = -1; i <= 1; i++) box(jaw, 0.012, 0.008, 0.12, -sign * 0.06, -0.046 + i * 0.02, 0, 'graphite', 0.001);
    jaws.push(jaw);
  }

  const fence = assembly(group, 0.10, -0.01, -1.23);
  box(fence, 2.97, 0.054, 0.05, 0, 0.66, 0, 'silver', 0.008);
  box(fence, 2.97, 0.048, 0.05, 0, 0.22, 0, 'graphite', 0.008);
  for (const x of [-1.43, -0.47, 0.49, 1.46]) {
    box(fence, 0.067, 0.61, 0.075, x, 0.42, 0, 'amber', 0.008);
    box(fence, 0.115, 0.039, 0.11, x, 0.132, 0, 'steel', 0.006);
  }
  for (let i = 0; i < 17; i++) box(fence, 0.016, 0.45, 0.018, -1.36 + i * 0.173, 0.44, 0, 'steel');
  for (let i = 0; i < 4; i++) box(fence, 2.89, 0.012, 0.018, 0, 0.26 + i * 0.115, 0, 'steel');
  const status = tower(fence, 1.45, 0.742, 0);

  const motion = new THREE.Vector3();
  const elbow = new THREE.Vector3();
  const jointDirection = new THREE.Vector3();
  const home = new THREE.Vector3();
  const ready = new THREE.Vector3();
  const retract = new THREE.Vector3();
  const travel = new THREE.Vector3();
  const place = new THREE.Vector3();
  const approach = new THREE.Vector3();
  const steps = ['approach', 'grasp', 'lift', 'turn', 'place', 'release', 'seal', 'label', 'review'];
  const armLength = 1.08;
  let carton;
  let cartonHeight = 0;
  let product;

  function poseArm() {
    const dx = motion.x - pedestal.x;
    const dz = motion.z - pedestal.z;
    const horizontal = Math.max(0.0001, Math.hypot(dx, dz));
    const elevation = motion.y - pedestal.y;
    const dist = Math.hypot(horizontal, elevation);
    const open = Math.acos(THREE.MathUtils.clamp(dist / (armLength * 2), 0, 0.997));
    const theta = Math.atan2(elevation, horizontal) + open;
    elbow.set(pedestal.x + dx / horizontal * armLength * Math.cos(theta), pedestal.y + armLength * Math.sin(theta), pedestal.z + dz / horizontal * armLength * Math.cos(theta));
    const yaw = Math.atan2(dx, dz);
    rotatingBase.rotation.y = yaw;
    [pedestal, elbow, motion].forEach((point, i) => {
      pivots[i].position.copy(point);
      pivots[i].rotation.y = yaw - Math.PI / 2;
    });
    [pedestal, elbow].forEach((point, i) => {
      const arm = segments[i];
      arm.position.copy(point);
      jointDirection.subVectors(i === 0 ? elbow : motion, point);
      arm.scale.y = jointDirection.length();
      arm.quaternion.setFromUnitVectors(positiveY, jointDirection.normalize());
    });
    gripper.position.copy(motion);
  }

  return { group, update(frame) {
    status(frame.active);
    const tag = orderTag(frame.order);
    if (carton?.userData.tag !== tag) cartonHeight = cartonDimensions(frame.order).height;
    product = setItem(group, product, makeProduct, frame.order, tag);
    carton = setItem(group, carton, makeCarton, frame.order, tag);
    const p = THREE.MathUtils.smoothstep(frame.phaseProgress, 0, 1);
    const step = steps.indexOf(frame.motion);
    const size = product.userData.size;
    const gripHeight = size.height * 0.78 + 0.30;
    const pickHeight = pick.y + palletHeight + gripHeight;
    const dropHeight = drop.y + 0.023 + gripHeight;
    home.set(0.04, 1.98, 0.45);
    approach.set(pick.x, pickHeight, pick.z);
    const clearance = drop.y + 0.023 + cartonHeight + 0.075 + gripHeight;
    ready.set(pick.x, Math.max(clearance, pickHeight + 0.27), pick.z);
    travel.set(drop.x, clearance, drop.z);
    place.set(drop.x, dropHeight, drop.z);
    retract.set(drop.x, 1.78, drop.z);
    const seated = step === 5 || step === 6;
    const carrier = seated ? carton : group;
    if (product.parent !== carrier) carrier.add(product);
    if (seated) product.position.set(0, 0.023, 0);
    else {
      product.position.copy(pick);
      product.position.y += palletHeight;
    }
    product.visible = (step >= 0 && step < 7) || Boolean(frame.waitingProduct);
    carton.visible = step >= 0 || Boolean(frame.waitingCarton);
    carton.position.copy(drop);
    const sealed = step === 6 ? THREE.MathUtils.smoothstep(p, 0.04, 0.57) : Number(step > 6);
    carton.userData.pose(1, sealed, step === 7 ? p > 0.45 : step > 7);
    const press = step === 7 ? Math.sin(Math.PI * p)
      : step === 6 ? Math.sin(Math.PI * THREE.MathUtils.smoothstep(p, 0.5, 1)) : 0;
    const labelContact = drop.y + cartonHeight + 0.050 - sealingUnit.position.y;
    labelHead.position.y = THREE.MathUtils.lerp(0.80, labelContact, press);
    sealingRam.position.y = (labelHead.position.y + 0.88) / 2;
    sealingRam.scale.y = Math.max(0.23, (0.88 - labelHead.position.y) / 0.23);
    const returning = step === 6 ? p : Number(step > 6);
    const crossLift = Math.sin(Math.PI * returning) * 0.025;
    pallet.position.set(pick.x, pick.y + crossLift, pick.z + returning * 0.48);
    pallet.visible = step >= 0 || Boolean(frame.waitingProduct);
    for (const belt of transferBelts) belt.position.y = rollerTop - 0.012 + crossLift;
    pickSensor(step >= 0 && step <= 2 || Boolean(frame.waitingProduct));
    jawSignal(step >= 1 && step <= 4);
    const open = size.width * 0.41 + 0.127;
    const closed = size.width * 0.42 + 0.037;
    let gripWidth = open;
    motion.copy(home);
    if (step === 0) motion.lerp(approach, p);
    if (step === 1) {
      motion.copy(approach);
      gripWidth = THREE.MathUtils.lerp(open, closed, p);
    }
    if (step === 2) motion.copy(approach).lerp(ready, p);
    if (step === 3) {
      motion.copy(ready).lerp(travel, p);
      motion.y += Math.sin(Math.PI * p) * 0.21;
    }
    if (step === 4) motion.copy(travel).lerp(place, p);
    if (step >= 2 && step <= 4) {
      product.position.copy(motion);
      product.position.y -= gripHeight;
      gripWidth = closed;
    }
    if (step >= 5) {
      if (step === 5) {
        motion.copy(place).lerp(retract, p);
        gripWidth = closed + 0.018 * THREE.MathUtils.smoothstep(p, 0, 0.24)
          + (open - closed - 0.018) * THREE.MathUtils.smoothstep(p, 0.61, 1);
      }
      if (step === 6) motion.copy(retract).lerp(home, p);
      if (step === 8) carton.position.x = THREE.MathUtils.lerp(drop.x, robotOutlet[0], p);
    }
    jaws[0].position.x = -gripWidth;
    jaws[1].position.x = gripWidth;
    guide.scale.x = Math.max(1, (gripWidth + 0.036) / 0.32);
    slide.scale.x = Math.max(1, (gripWidth + 0.031) / 0.295);
    poseArm();
  } };
}

function transferBuffer() {
  const group = assembly();
  const [inX, deck, z] = warehouseIntake;
  const [outX] = bufferOutlet;
  const width = outX - inX + 0.52;
  const center = (inX + outX) / 2;
  plinth(group, 2.12, 1.58);
  bedWithRollers(group, width, 0.88, center, deck - 0.057, z);
  for (const x of [inX + 0.25, center + 0.18, outX - 0.33]) {
    for (const side of [-1, 1]) {
      box(group, 0.079, 0.48, 0.078, x, 0.27, z + side * 0.36, 'steel', 0.008, true);
      box(group, 0.155, 0.031, 0.151, x, 0.026, z + side * 0.36, 'graphite', 0.006);
    }
  }
  const scanner = assembly(group, 0.26, deck, z);
  for (const side of [-1, 1]) {
    box(scanner, 0.108, 0.86, 0.085, 0, 0.43, side * 0.47, 'silver', 0.01, true);
    box(scanner, 0.048, 0.59, 0.028, 0.031, 0.42, side * 0.44, 'graphite', 0.005);
  }
  box(scanner, 0.23, 0.13, 1.02, 0, 0.87, 0, 'graphite', 0.019, true);
  box(scanner, 0.128, 0.028, 0.59, 0, 0.791, 0, paint('cyan', 0.95), 0.008);
  box(scanner, 0.79, 0.115, 0.031, 0, 0.877, 0.508, 'graphite', 0.012);
  label(scanner, 'LINE TRANSFER', 0.74, 0.078, 0, 0.879, 0.531, '#d7f2ef', '#354348');
  const status = tower(scanner, 0.09, 0.93, -0.34);
  const read = led(scanner, 0.08, 0.777, 0.29);

  return { group, update(frame) {
    status(frame.active);
    const x = THREE.MathUtils.lerp(inX, outX, frame.phaseProgress);
    read(frame.motion === 'buffer' && Math.abs(x - scanner.position.x) < 0.31);
  } };
}

export function makeStation(id) {
  switch (id) {
    case 'design': return workstation();
    case 'print1':
    case 'print2':
    case 'print3':
    case 'print4':
    case 'print5':
    case 'print6': return printer(id);
    case 'quality':
    case 'quality2': return quality();
    case 'boxes':
    case 'boxes2': return cartonLine();
    case 'robot':
    case 'robot2': return robotCell();
    case 'buffer':
    case 'buffer2': return transferBuffer();
    default: throw new RangeError(`Unknown factory station: ${id}`);
  }
}
