import * as THREE from 'three';
import { envelopeDoors, envelopeEdges, envelopePoint, envelopeSides, envelopeWalls, EAVE, RIDGE,
  roofAirRoutes, roofFrames, roofHeightAt, roofRidgeZ, roofVisibility, smoothFactor,
  getAirUnitMode, getEnvelopeDoorOpening, WALL_OFFSET, WALL_THICKNESS } from './building-layout.js';
import { mountLinearLight } from './work-light.js';

const unitBox = new THREE.BoxGeometry(1, 1, 1);
const powder = (color, roughness = 0.68, metalness = 0.26) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
const palette = () => ({
  concrete: powder(0x586578, 0.91, 0.03), wall: powder(0x728697), accent: powder(0x294452),
  seam: powder(0x526878), steel: powder(0x263c4b), frame: powder(0x93a7af),
  ribbon: Object.assign(powder(0x73afba, 0.29), { emissive: new THREE.Color(0x294958), emissiveIntensity: 0.19 }),
  roof: powder(0x6494a6), roofSeam: powder(0x75a4b4), skylight: powder(0x9edce4, 0.27),
  supply: powder(0x638ba1), return: powder(0xc19b73), grille: powder(0x203844),
  warning: powder(0xf2ac52), door: powder(0x425b66), exit: powder(0x237854),
});

function pieces(parent, materials) {
  const batches = new Map();
  return {
    add(key, size, xyz, rotation) {
      const pose = new THREE.Object3D();
      pose.position.set(...xyz);
      pose.scale.set(...size);
      if (rotation) pose.rotation.set(...rotation);
      pose.updateMatrix();
      if (!batches.has(key)) batches.set(key, []);
      batches.get(key).push(pose.matrix);
    },
    finish() {
      for (const [key, matrices] of batches) {
        const mesh = new THREE.InstancedMesh(unitBox, materials[key], matrices.length);
        matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
        mesh.receiveShadow = key !== 'roof' && key !== 'skylight';
        parent.add(mesh);
      }
    },
  };
}

function beam(add, key, a, b, width, height = width) {
  const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
  const length = start.distanceTo(end);
  if (length < 0.0001) return;
  const rotation = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(1, 0, 0), end.sub(start).normalize()));
  add(key, [length, height, width], start.addScaledVector(end, length / 2).toArray(),
    [rotation.x, rotation.y, rotation.z]);
}

function wallBox(add, side, key, length, height, depth, at, y, offset) {
  const [x, z] = envelopePoint(side, at, offset);
  add(key, envelopeSides[side].normal[0] ? [depth, height, length] : [length, height, depth], [x, y, z]);
}

function nameplate(parent, door, position, yaw) {
  if (typeof document === 'undefined') return;
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 120;
  const context = canvas.getContext('2d');
  context.fillStyle = '#112b3c'; context.fillRect(0, 0, 640, 120);
  context.fillStyle = '#5dd3da'; context.fillRect(0, 0, 12, 120);
  context.font = 'bold 48px "Microsoft YaHei", sans-serif';
  context.fillStyle = '#ecf8ff'; context.fillText(door.label, 34, 69);
  context.font = '32px Consolas, monospace'; context.fillText(door.id, 478, 68);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const surface = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(2.35, door.clearWidth - 0.11), 0.30),
    new THREE.MeshBasicMaterial({ map, toneMapped: false }));
  surface.position.set(...position);
  surface.rotation.y = yaw;
  surface.name = `${door.id} 标牌`;
  parent.add(surface);
}

function buildFacade(scene, side) {
  const context = envelopeSides[side];
  const materials = palette();
  const group = new THREE.Group();
  group.name = `外围护 ${side}`;
  scene.add(group);
  const base = pieces(group, materials);
  const wall = (...args) => wallBox(base.add, side, ...args);
  const fascia = new THREE.Group();
  fascia.name = `${side} 墙体及门组`;
  group.add(fascia);
  const skins = pieces(fascia, materials);
  const panel = (...args) => wallBox(skins.add, side, ...args);
  const yaw = Math.atan2(context.normal[0], context.normal[1]);
  const doorDetails = pieces(group, materials);
  const fixedDoor = (...args) => wallBox(doorDetails.add, side, ...args);
  const animatedDoors = [];
  const lights = [];

  if (!context.normal[0]) {
    for (const x of roofFrames) {
      wall('concrete', 0.39, 0.30, 0.37, x, 0.15, 0.18);
      panel('steel', 0.17, EAVE - 0.15, 0.20, x, (EAVE + 0.15) / 2, 0.21);
      panel('frame', 0.25, 0.12, 0.30, x, EAVE - 0.085, 0.15);
    }
  }
  for (const { from, to } of envelopeWalls.filter((span) => span.side === side)) {
    const length = to - from;
    const at = (from + to) / 2;
    wall('concrete', length, 0.48, WALL_THICKNESS + 0.14, at, 0.24);
    panel('wall', length, 3.68, WALL_THICKNESS, at, 2.32);
    panel('accent', length, EAVE - 5.30, WALL_THICKNESS, at, (EAVE + 5.30) / 2);
    panel('ribbon', length, 1.14, 0.105, at, 4.73);
    for (const y of [4.15, 5.31, 6.68]) panel('frame', length, 0.068, 0.31, at, y);
    const bays = Math.ceil(length / 2.45);
    for (let k = 1; k < bays; k++) {
      const seam = from + k * length / bays;
      panel('seam', 0.036, 3.65, WALL_THICKNESS + 0.018, seam, 2.32);
      panel('frame', 0.061, 1.14, 0.246, seam, 4.73);
      panel('seam', 0.039, 1.27, WALL_THICKNESS + 0.02, seam, 5.96);
    }
  }

  for (const door of envelopeDoors.filter((item) => item.side === side)) {
    const { id, type, at, clearWidth, clearHeight, jamb } = door;
    const width = clearWidth + 2 * jamb;
    const isEgress = type === 'egress';
    const isVehicle = type === 'vehicle';
    const head = isEgress ? 0.27 : isVehicle ? 0.44 : 0.33;
    const lintelBottom = clearHeight + head;
    const key = isEgress ? 'exit' : 'steel';
    for (const direction of [-1, 1]) {
      const post = at + direction * (clearWidth + jamb) / 2;
      fixedDoor(key, jamb, lintelBottom, 0.37, post, lintelBottom / 2);
      fixedDoor('frame', 0.037, clearHeight - 0.04, 0.41, post - direction * (jamb / 2 - 0.027), clearHeight / 2);
      if (isVehicle) {
        const guard = at + direction * (clearWidth / 2 + 0.095);
        wall('steel', 0.128, 0.60, 0.128, guard, 0.30, -0.36);
        wall('warning', 0.133, 0.12, 0.133, guard, 0.45, -0.36);
      }
    }
    fixedDoor(key, width, head, 0.44, at, clearHeight + head / 2);
    panel('wall', width, 4.16 - lintelBottom, WALL_THICKNESS, at, (lintelBottom + 4.16) / 2);
    panel('ribbon', width, 1.14, 0.105, at, 4.73);
    panel('accent', width, EAVE - 5.30, WALL_THICKNESS, at, (EAVE + 5.30) / 2);
    for (const y of [4.15, 5.31, 6.68]) panel('frame', width, 0.068, 0.31, at, y);
    const [x, z] = envelopePoint(side, at, WALL_OFFSET + 0.222);
    if (!isEgress) nameplate(group, door, [x, clearHeight + head / 2, z], yaw);

    if (isEgress || type === 'service') {
      wall('concrete', clearWidth - 0.008, 0.21, isEgress ? 1.32 : 0.99, at, -0.109, 0.56);
    }
    if (isVehicle) {
      // Scale the visible curtain from its fixed upper reel. Rails and housing remain fixed.
      const root = new THREE.Group();
      root.name = id;
      const [doorX, doorZ] = envelopePoint(side, at);
      root.position.set(doorX, clearHeight, doorZ);
      root.rotation.y = yaw;
      group.add(root);
      const leaves = new THREE.Group();
      root.add(leaves);
      const slats = pieces(leaves, materials);
      const count = Math.ceil(clearHeight / 0.14);
      for (let index = 0; index < count; index++) {
        const step = clearHeight / count;
        slats.add(index === count - 1 ? 'warning' : 'door', [clearWidth - 0.014, step - 0.012, 0.085],
          [0, -(index + 0.5) * step, 0]);
      }
      slats.finish();
      animatedDoors.push({ door, leaves });
    } else if (isEgress) {
      // Held open against its jamb in this coordination model, leaving the entire path clear.
      const hinge = at - clearWidth / 2 - jamb * 0.38;
      fixedDoor('exit', 0.055, clearHeight - 0.055, clearWidth - 0.06, hinge, clearHeight / 2,
        WALL_OFFSET + (clearWidth - 0.06) / 2);
      fixedDoor('frame', 0.066, 0.06, 0.28, hinge, 1.02, WALL_OFFSET + clearWidth - 0.25);
    } else {
      fixedDoor('door', clearWidth - 0.025, clearHeight - 0.025, 0.14, at, clearHeight / 2);
      fixedDoor('frame', 0.027, clearHeight - 0.055, 0.18, at, clearHeight / 2);
      for (const direction of [-1, 1]) fixedDoor('warning', 0.07, 0.16, 0.21, at + direction * 0.13, 1.06);
    }
    if (isVehicle || isEgress) {
      const [lampX, lampZ] = envelopePoint(side, at, WALL_OFFSET - 0.23);
      // Attach at header height. Separate the lighting from the camera-only cutaway.
      lights.push(mountLinearLight(group, { name: `${id} 门楣灯`, position: [lampX, clearHeight + head * 0.55, lampZ],
        yaw: yaw + Math.PI, width: isVehicle ? 1.45 : 0.73, strength: isVehicle ? 139 : 76, standby: 9,
        distance: 8.5, aim: [0, -2.65, 2.75] }));
    }
  }

  if (context.normal[0]) {
    for (const [at, direction] of [[context.min, -1], [context.max, 1]]) {
      wall('concrete', 0.46, 0.48, 0.42, at + direction * WALL_OFFSET, 0.24);
      panel('steel', 0.44, EAVE - 0.48, 0.42, at + direction * WALL_OFFSET, (EAVE + 0.48) / 2);
    }
  }
  // Downspouts and perimeter bracing live beyond the walking surface.
  for (const at of [context.min + 0.20, context.max - 0.20]) {
    panel('steel', 0.22, EAVE, 0.34, at, EAVE / 2);
    panel('frame', 0.092, EAVE - 0.20, 0.10, at, EAVE / 2 - 0.04, WALL_OFFSET + 0.26);
    for (const y of [0.55, 2.95, 5.24]) panel('steel', 0.13, 0.08, 0.16, at, y, WALL_OFFSET + 0.22);
  }
  if (context.normal[0]) {
    const atZ = context.normal[0] < 0 ? envelopeEdges.west : envelopeEdges.east;
    const outward = (WALL_OFFSET + 0.045) * context.normal[0];
    const shape = new THREE.Shape();
    const length = context.max - context.min;
    shape.moveTo(-length / 2, EAVE); shape.lineTo(0, RIDGE); shape.lineTo(length / 2, EAVE); shape.closePath();
    const geometry = new THREE.ShapeGeometry(shape);
    const endcap = new THREE.Mesh(geometry, materials.accent);
    materials.accent.side = THREE.DoubleSide;
    endcap.rotation.y = Math.PI / 2;
    endcap.position.set(atZ + outward, 0, roofRidgeZ);
    fascia.add(endcap);
  }
  base.finish();
  skins.finish();
  doorDetails.finish();
  const visibleMaterials = new Map();
  const fadeMaterials = new Map();
  fascia.traverse((mesh) => {
    if (!mesh.isMesh) return;
    if (!fadeMaterials.has(mesh.material)) {
      const faded = mesh.material.clone();
      faded.transparent = true;
      faded.depthWrite = false;
      fadeMaterials.set(mesh.material, faded);
    }
    visibleMaterials.set(mesh, mesh.material);
  });
  let blend;
  function setFade(opacity) {
    fascia.visible = opacity > 0.025;
    if (!fascia.visible) return;
    const opaque = opacity > 0.995;
    if (opaque !== blend) {
      for (const [mesh, original] of visibleMaterials) mesh.material = opaque ? original : fadeMaterials.get(original);
      blend = opaque;
    }
    if (!opaque) for (const faded of fadeMaterials.values()) faded.opacity = opacity;
  }
  return { ...context, group, lights, animatedDoors, setFade };
}

function buildRoof(scene) {
  const p = palette();
  const group = new THREE.Group();
  group.name = '双坡厂房屋面与悬吊机电';
  scene.add(group);
  const { west, east, north, south } = envelopeEdges;
  const roof = pieces(group, p);
  const { add } = roof;
  const span = east - west + 0.94;
  const middleX = (east + west) / 2;
  const zHalf = south - roofRidgeZ;
  const slope = Math.atan2(RIDGE - EAVE, zHalf);
  const roofDepth = (zHalf + 0.47) / Math.cos(slope);
  for (const direction of [-1, 1]) {
    const edge = direction < 0 ? north : south;
    const halfZ = (edge + roofRidgeZ) / 2 + direction * 0.235;
    add('roof', [span, 0.09, roofDepth], [middleX, roofHeightAt(halfZ) + 0.14, halfZ], [direction * slope, 0, 0]);
    for (let x = west; x < east + 0.4; x += 1.08) {
      add('roofSeam', [0.035, 0.035, roofDepth], [x, roofHeightAt(halfZ) + 0.207, halfZ], [direction * slope, 0, 0]);
    }
    for (const z of [roofRidgeZ + direction * 4.7, roofRidgeZ + direction * 10.3]) {
      add('skylight', [span - 2.20, 0.045, 0.93], [middleX, roofHeightAt(z) + 0.24, z], [direction * slope, 0, 0]);
      for (const x of roofFrames) add('frame', [0.06, 0.048, 1.03], [x, roofHeightAt(z) + 0.27, z], [direction * slope, 0, 0]);
    }
    add('steel', [span + 0.02, 0.22, 0.23], [middleX, EAVE - 0.05, edge + direction * 0.41]);
    for (const offset of [3.9, 8.2, 12.35]) {
      const z = roofRidgeZ + offset * direction;
      add('steel', [span - 0.36, 0.10, 0.092], [middleX, roofHeightAt(z) - 0.12, z]);
    }
  }
  add('frame', [span + 0.025, 0.14, 0.23], [middleX, RIDGE + 0.18, roofRidgeZ]);
  const chordY = EAVE - 0.10;
  for (const x of roofFrames) {
    beam(add, 'steel', [x, EAVE + 0.025, north - 0.21], [x, RIDGE + 0.025, roofRidgeZ], 0.21, 0.16);
    beam(add, 'steel', [x, RIDGE + 0.025, roofRidgeZ], [x, EAVE + 0.025, south + 0.21], 0.21, 0.16);
    add('steel', [0.145, 0.13, south - north + 0.42], [x, chordY, roofRidgeZ]);
    for (let index = 1; index < 8; index++) {
      const z = north + index * (south - north) / 8;
      const towardsRidge = z + (z < roofRidgeZ ? 1 : -1) * (south - north) / 16;
      beam(add, 'frame', [x, chordY, z], [x, roofHeightAt(towardsRidge), towardsRidge], 0.071);
    }
  }
  roof.finish();
  const services = new THREE.Group();
  services.name = '空调机组、消声箱、悬吊风管';
  scene.add(services);
  const equipment = pieces(services, p);
  const indicators = [];
  for (const unit of roofAirRoutes) {
    const [x, z] = unit.center;
    const [tapX, tapZ] = unit.tap;
    const key = unit.system;
    const lineY = 6.13;
    const roofY = roofHeightAt(z) + 0.15;
    equipment.add('steel', [1.95, 0.11, 1.14], [x, roofY + 0.16, z]);
    equipment.add(key, [1.78, 0.61, 0.99], [x, roofY + 0.48, z]);
    equipment.add('frame', [1.83, 0.105, 1.03], [x, roofY + 0.835, z]);
    equipment.add('grille', [1.47, 0.43, 0.038], [x, roofY + 0.48, z + 0.51]);
    equipment.add('steel', [0.21, 0.115, 0.048], [x + 0.73, roofY + 0.66, z + 0.544]);
    const lens = new THREE.Mesh(unitBox, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }));
    lens.position.set(x + 0.73, roofY + 0.66, z + 0.573);
    lens.scale.set(0.12, 0.055, 0.02);
    lens.name = `${unit.id} 运行指示灯`;
    services.add(lens);
    indicators.push({ unit, lens });
    for (let i = -9; i <= 9; i++) equipment.add('frame', [0.025, 0.345, 0.028], [x + i * 0.078, roofY + 0.48, z + 0.54]);
    equipment.add(key, [0.47, roofY + 0.20 - lineY, 0.45], [x, (roofY + 0.20 + lineY) / 2, z]);
    for (let index = 1; index < unit.points.length; index++) {
      const [fromX, fromZ] = unit.points[index - 1], [toX, toZ] = unit.points[index];
      beam(equipment.add, key, [fromX, lineY, fromZ], [toX, lineY, toZ], unit.width, 0.40);
      const xAxis = Math.abs(toX - fromX) > Math.abs(toZ - fromZ);
      equipment.add('frame', xAxis ? [0.05, 0.46, 0.60] : [0.60, 0.46, 0.05],
        [(fromX + toX) / 2, lineY, (fromZ + toZ) / 2]);
    }
    equipment.add(key, [0.45, lineY - 5.08, 0.46], [tapX, (lineY + 5.08) / 2, tapZ]);
    for (const [hangerX, hangerZ] of unit.points) {
      const top = roofHeightAt(hangerZ) - 0.02;
      const bottom = lineY - 0.25;
      equipment.add('steel', [0.91, 0.09, 0.095], [hangerX, top, hangerZ]);
      for (const offset of [-0.33, 0.33]) {
        equipment.add('steel', [0.033, top - bottom, 0.033], [hangerX + offset, (top + bottom) / 2, hangerZ]);
      }
      equipment.add('frame', [0.77, 0.042, 0.058], [hangerX, bottom, hangerZ]);
    }
  }
  equipment.finish();
  const strengths = new Map([['roof', 0.24], ['skylight', 0.49], ['roofSeam', 0.31], ['steel', 0.52],
    ['frame', 0.64], ['supply', 0.83], ['return', 0.83], ['grille', 0.77]]);
  for (const [key, value] of strengths) {
    p[key].transparent = true;
    p[key].depthWrite = false;
    p[key].userData.maxOpacity = value;
  }
  return (fade, sim) => {
    group.visible = services.visible = fade > 0.014;
    if (!group.visible) return;
    for (const key of strengths.keys()) p[key].opacity = fade * p[key].userData.maxOpacity;
    for (const { unit, lens } of indicators) {
      lens.material.opacity = fade;
      lens.material.color.setHex(getAirUnitMode(unit, sim) === 'boost' ? 0x92f5de : 0x4b8d90);
    }
  };
}

export function buildBuildingEnvelope(scene) {
  const facades = Object.keys(envelopeSides).map((side) => buildFacade(scene, side));
  const updateRoof = buildRoof(scene);
  function update(camera, target, inControlRoom, sim) {
    const distance = camera.distanceTo(target);
    const roof = inControlRoom ? 0 : roofVisibility(distance);
    updateRoof(roof, sim);
    for (const facade of facades) {
      const { normal, edge } = facade;
      const outwardDistance = normal[0] ? (camera.x - edge) * normal[0] : (camera.z - edge) * normal[1];
      const cameraFacing = smoothFactor(outwardDistance, -0.25, 3.8);
      facade.group.visible = !inControlRoom;
      facade.setFade(1 - cameraFacing * (1 - 0.27 * roof));
      for (const { door, leaves } of facade.animatedDoors) {
        const opening = getEnvelopeDoorOpening(door.station, sim);
        leaves.scale.y = Math.max(0.014, 1 - opening);
      }
    }
  }
  return { update, setNightLighting(night) {
    for (const facade of facades) for (const light of facade.lights) light(night);
  } };
}
