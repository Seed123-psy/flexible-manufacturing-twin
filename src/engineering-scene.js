import * as THREE from 'three';
import { ENGINEERING_LAYOUT, engineeringDuctSpan } from './engineering-layout.js';

// Box and round details are instanced by section/material to keep the engineering
// layer inexpensive even with hundreds of seams, fins, bolts and stencil marks.
function batches(parent, occupancy) {
  const cube = new THREE.BoxGeometry(1, 1, 1);
  const cylinder = new THREE.CylinderGeometry(0.5, 0.5, 1, 16);
  const map = new Map();
  const part = new THREE.Object3D();
  function add(geometry, ownerId, material, size, xyz, pitch, yaw, shadow) {
    const key = `${geometry.id}/${material.id}/${shadow}`;
    if (!map.has(key)) map.set(key, { geometry, material, shadow, entries: [] });
    part.position.set(...xyz);
    part.rotation.set(pitch, yaw, 0, 'YXZ');
    part.scale.set(...size);
    part.updateMatrix();
    map.get(key).entries.push({ ownerId, matrix: part.matrix.clone() });
  }
  return {
    local(id, [x, z], angle = 0) {
      const cos = Math.cos(angle), sin = Math.sin(angle);
      const world = ([u, y, v]) => [x + u * cos + v * sin, y, z - u * sin + v * cos];
      return {
        box(material, size, center, yaw = 0, shadow = false) {
          add(cube, id, material, size, world(center), 0, angle + yaw, shadow);
        },
        disc(material, diameter, length, center, pitch = 0) {
          add(cylinder, id, material, [diameter, length, diameter], world(center), pitch, angle, false);
        },
        world,
      };
    },
    finish() {
      for (const { geometry, material, shadow, entries } of map.values()) {
        const mesh = new THREE.InstancedMesh(geometry, material, entries.length);
        mesh.name = material.name;
        mesh.castShadow = shadow;
        mesh.receiveShadow = !material.isMeshBasicMaterial;
        mesh.userData.occupancy = occupancy;
        mesh.userData.ownerIds = entries.map(({ ownerId }) => ownerId);
        entries.forEach(({ matrix }, i) => mesh.setMatrixAt(i, matrix));
        parent.add(mesh);
      }
    },
  };
}

const alloy = (name, color, metalness = 0.26, roughness = 0.55) => Object.assign(
  new THREE.MeshStandardMaterial({ color, metalness, roughness }), { name });
const ink = (name, color) => Object.assign(new THREE.MeshBasicMaterial({ color, toneMapped: false }), { name });
function palette() {
  return {
    steel: alloy('Graphite steelwork', 0x394b52), edge: alloy('Rolled section edges', 0x607580),
    zinc: alloy('Galvanized fittings', 0x9ea9aa, 0.55), concrete: alloy('Concrete pedestals', 0x7b7b71, 0.06, 0.92),
    black: alloy('Gaskets and recesses', 0x202b2d, 0.12), green: alloy('Exit frames', 0x276755),
    red: alloy('Hydrant enamel', 0xb93137), redDark: alloy('Hydrant housing', 0x782731),
    glass: alloy('Hydrant inspection panes', 0x554748, 0.18, 0.22), panel: alloy('Powder-coated panels', 0x879595),
    cap: alloy('Cabinet kickplates', 0x46565a), supply: alloy('Supply duct jackets', 0x9aafb1, 0.59),
    return: alloy('Return duct jackets', 0x819aa8, 0.51), cover: alloy('Utility trench covers', 0x626f70, 0.46, 0.7),
    joint: alloy('Utility trench joints', 0x343e43, 0.24, 0.79), brass: alloy('Survey brass', 0xaa8953, 0.48),
    white: ink('Luminous sign white', 0xe5f7ea), egress: ink('Design egress green', 0x83dfae),
    amber: ink('Maintenance ochre', 0xe8b66a), danger: ink('Interaction coral', 0xd78473),
    blue: ink('Utility and survey cyan', 0x91c2cc), lamp: ink('Equipment indicators', 0x63deae),
  };
}

function nameplate(parent, id, xyz, size, title, sub, options = {}) {
  // Node/unit-test callers can build the complete geometric layer without a DOM.
  const canvas = globalThis.document?.createElement('canvas');
  const ctx = canvas?.getContext('2d');
  if (!ctx) return;
  const { floor = false, yaw = 0, accent = '#8fe0be', background = '#22363b' } = options;
  const [width, height] = size;
  canvas.width = 512;
  canvas.height = Math.ceil(512 * height / width);
  const w = canvas.width, h = canvas.height;
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, 14, h);
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#edf3ef';
  ctx.font = `700 ${h * (sub ? 0.43 : 0.65)}px "Microsoft YaHei", sans-serif`;
  ctx.fillText(title, 27, h * (sub ? 0.35 : 0.52), w - 48);
  if (sub) {
    ctx.fillStyle = accent;
    ctx.font = `700 ${h * 0.235}px Consolas, "Microsoft YaHei", monospace`;
    ctx.fillText(sub, 28, h * 0.76, w - 48);
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({ map, toneMapped: false }));
  mesh.name = `${id} · ${title}`;
  mesh.userData.ownerIds = [id];
  mesh.userData.occupancy = floor ? 'overlay' : 'sign';
  mesh.position.set(...xyz);
  mesh.rotation.set(floor ? -Math.PI / 2 : 0, yaw, 0, 'YXZ');
  parent.add(mesh);
}

function buildFixtures(parent, solid, p) {
  for (const exit of ENGINEERING_LAYOUT.exits) {
    const { id, label, center, yaw, clearWidth, clearHeight, depth, jamb, header } = exit;
    const { box, world } = solid.local(id, center, yaw);
    const w = clearWidth + 2 * jamb;
    for (const side of [-1, 1]) {
      const u = side * (clearWidth + jamb) / 2;
      box(p.green, [jamb, clearHeight, depth], [u, clearHeight / 2, 0], 0, true);
      box(p.steel, [jamb, 0.26, depth], [u, 0.13, 0]);
      box(p.egress, [0.025, 1.78, 0.004], [u, 1.27, depth / 2 + 0.001]);
    }
    const top = clearHeight + header / 2;
    box(p.green, [w, header, depth], [0, top, 0], 0, true);
    box(p.egress, [w - 0.08, 0.018, 0.004], [0, clearHeight + 0.025, depth / 2 + 0.001]);
    for (const side of [-1, 1]) box(p.white, [0.06, 0.045, 0.012], [side * (w / 2 - 0.082), top + 0.018, depth / 2 - 0.002]);
    nameplate(parent, id, world([0, top + 0.014, depth / 2 + 0.002]), [w - 0.28, 0.22],
      `出口示意  ${id}`, 'DESIGN EXIT · NO DISCHARGE MODELED', { yaw, background: '#156451' });
    nameplate(parent, id, world([0, top + 0.014, -depth / 2 - 0.002]), [w - 0.28, 0.22],
      label, 'MODEL BOUNDARY ONLY', { yaw: yaw + Math.PI, background: '#156451' });
  }
  for (const { id, center, size: [w, d], height, flangeWidth, sectionDepth } of ENGINEERING_LAYOUT.columns) {
    const { box, disc, world } = solid.local(id, center);
    box(p.concrete, [w, 0.12, d], [0, 0.06, 0], 0, true);
    box(p.steel, [w - 0.04, 0.037, d - 0.04], [0, 0.1385, 0]);
    for (const x of [-0.222, 0.222]) for (const z of [-0.198, 0.198]) disc(p.zinc, 0.062, 0.05, [x, 0.163, z]);
    const span = height - 0.203;
    for (const sign of [-1, 1]) box(p.edge, [flangeWidth, span, 0.045], [0, 0.153 + span / 2, sign * (sectionDepth - 0.045) / 2], 0, true);
    box(p.steel, [0.061, span, sectionDepth - 0.08], [0, 0.153 + span / 2, 0], 0, true);
    box(p.zinc, [flangeWidth + 0.07, 0.05, sectionDepth + 0.07], [0, height - 0.025, 0]);
    box(p.cap, [flangeWidth + 0.12, 0.64, sectionDepth + 0.10], [0, 0.53, 0]);
    for (const y of [0.30, 0.51, 0.72]) box(p.amber, [flangeWidth + 0.14, 0.067, sectionDepth + 0.12], [0, y, 0]);
    nameplate(parent, id, world([0, 1.225, sectionDepth / 2 + 0.003]), [0.26, 0.11], id, null);
  }
  for (const { id, center, size: [w, d], height, yaw, label } of ENGINEERING_LAYOUT.hydrants) {
    const { box, disc, world } = solid.local(id, center, yaw);
    const front = d / 2;
    box(p.redDark, [w, 0.12, d], [0, 0.06, 0], 0, true);
    box(p.red, [w - 0.036, height - 0.13, d - 0.05], [0, (height + 0.11) / 2, -0.018], 0, true);
    box(p.black, [w - 0.073, 1.37, 0.028], [0, 0.83, front - 0.03]);
    box(p.red, [w - 0.095, 1.35, 0.017], [0, 0.83, front - 0.013]);
    box(p.glass, [0.52, 0.68, 0.008], [-0.04, 1.06, front - 0.014]);
    // Shallow inlaid hose-reel graphic, so the inspection pane reads at distance.
    disc(p.redDark, 0.38, 0.004, [-0.04, 1.055, front - 0.008], Math.PI / 2);
    disc(p.concrete, 0.285, 0.004, [-0.04, 1.055, front - 0.005], Math.PI / 2);
    disc(p.redDark, 0.16, 0.004, [-0.04, 1.055, front - 0.002], Math.PI / 2);
    for (const y of [0.35, 1.38]) box(p.cap, [0.047, 0.085, 0.019], [-0.353, y, front - 0.01]);
    box(p.zinc, [0.042, 0.19, 0.021], [0.32, 0.768, front - 0.0105]);
    box(p.white, [0.2, 0.024, 0.006], [-0.03, 0.37, front - 0.003]);
    box(p.white, [0.024, 0.2, 0.006], [-0.03, 0.37, front - 0.003]);
    nameplate(parent, id, world([0, 1.68, front - 0.034]), [0.70, 0.24], label, `${id} / FIRE HOSE`,
      { yaw, accent: '#f7c5b8', background: '#842730' });
  }
  for (const { id, center, size: [w, d], height, yaw, label } of ENGINEERING_LAYOUT.electricalCabinets) {
    const { box, world } = solid.local(id, center, yaw);
    const front = d / 2;
    box(p.cap, [w, 0.16, d], [0, 0.08, 0], 0, true);
    box(p.steel, [w - 0.045, height - 0.19, d - 0.068], [0, (height + 0.13) / 2, -0.025], 0, true);
    box(p.edge, [w, 0.052, d], [0, height - 0.026, 0]);
    const leaf = (w - 0.12) / 2;
    for (const [index, u] of [-leaf / 2 - 0.007, leaf / 2 + 0.007].entries()) {
      box(p.panel, [leaf, 1.80, 0.03], [u, 1.11, front - 0.048]);
      box(p.black, [leaf - 0.15, 0.37, 0.012], [u, 0.492, front - 0.028]);
      for (let i = 0; i < 9; i++) box(p.edge, [leaf - 0.20, 0.014, 0.015], [u, 0.339 + i * 0.038, front - 0.020]);
      box(p.steel, [0.055, 0.22, 0.039], [u + leaf / 2 - 0.067, 1.19, front - 0.0195]);
      box(p.black, [0.195, 0.081, 0.016], [u, 1.57, front - 0.025]);
      for (const [i, material] of [p.lamp, p.amber, p.danger].entries()) box(material, [0.027, 0.028, 0.008], [u + (i - 1) * 0.049, 1.57, front - 0.014]);
      nameplate(parent, id, world([u, 1.82, front - 0.029]), [leaf - 0.08, 0.20], index ? '配电分路' : label,
        `${id} / ${index ? '02' : '01'}`, { yaw, accent: '#f0c378' });
    }
  }
}

function buildAirServices(parent, solid, p) {
  const { ducts, diffusers, supports } = ENGINEERING_LAYOUT.hvac;
  for (const duct of ducts) {
    const { id, width: w, height: h, y, system } = duct;
    const { center, length, yaw } = engineeringDuctSpan(duct);
    const { box, world } = solid.local(id, center, yaw);
    const lw = w - 0.07, lh = h - 0.065;
    box(p[system], [length, lh, lw], [0, y, 0], 0, true);
    const modules = Math.ceil(length / 1.72);
    for (let i = 0; i <= modules; i++) {
      const x = -length / 2 + 0.027 + (length - 0.054) * i / modules;
      for (const side of [-1, 1]) {
        box(p.zinc, [0.054, 0.032, w], [x, y + side * (h - 0.032) / 2, 0]);
        box(p.zinc, [0.054, h - 0.060, 0.036], [x, y, side * (w - 0.036) / 2]);
      }
    }
    const x = length > 4 ? 0.41 : 0;
    const size = [Math.min(length - 0.21, 0.94), 0.19];
    for (const side of [-1, 1]) {
      const z = side * (lw / 2 + 0.001);
      nameplate(parent, id, world([x, y, z]), size, id, system === 'supply' ? 'SUPPLY AIR' : 'RETURN AIR',
        { yaw: yaw + (side < 0 ? Math.PI : 0), accent: system === 'supply' ? '#b3e4d2' : '#a6d4ed' });
    }
  }
  for (const { id, center, size: [w, d], y, height, system } of diffusers) {
    const { box } = solid.local(id, center);
    box(p[system], [w - 0.125, height - 0.056, d - 0.125], [0, y + (height + 0.056) / 2, 0]);
    box(p.zinc, [w, 0.05, d], [0, y + 0.029, 0]);
    box(p.black, [w - 0.091, 0.014, d - 0.091], [0, y + 0.009, 0]);
    for (let i = -5; i <= 5; i++) box(p.edge, [w - 0.102, 0.009, 0.023], [0, y + 0.0045, i * (d - 0.13) / 11]);
  }
  for (const { id, center, size: [w, d], y, height, dropAt } of supports) {
    const { box } = solid.local(id, center);
    box(p.steel, [w, 0.105, d], [0, y + height - 0.075, 0], 0, true);
    box(p.zinc, [w - 0.015, 0.021, d - 0.012], [0, y + height - 0.011, 0]);
    const { box: drop } = solid.local(id, dropAt);
    const rodBase = id.startsWith('HK-E') ? 5.254 : y;
    for (const x of [-0.055, 0.055]) drop(p.zinc, [0.025, y + height - 0.08 - rodBase, 0.025], [x, (rodBase + y + height - 0.08) / 2, 0]);
    drop(p.edge, [0.16, 0.047, 0.15], [0, rodBase + 0.0235, 0]);
  }
}

const stroke = (batch, id, material, from, to, width, y) => {
  const { center, length, yaw } = engineeringDuctSpan({ from, to });
  if (length > 1e-6) batch.local(id, center, yaw).box(material, [length, 0.001, width], [0, y, 0]);
};
const floorTag = (parent, id, [x, z], size, title, sub, accent, yaw = 0) =>
  nameplate(parent, id, [x, 0.037, z], size, title, sub, { floor: true, accent, yaw });

function buildTrench(surf, p) {
  const { id, from, to, width, coverCount, coverSeam, coverTop } = ENGINEERING_LAYOUT.trench;
  const { center, length, yaw } = engineeringDuctSpan({ from, to });
  const { box } = surf.local(id, center, yaw);
  // Existing floor is an uncut plane. Millimetric rendering offsets avoid z-fighting;
  // the modeled finish datum for the closed surface remains coverTop.
  const renderY = coverTop + 0.008;
  box(p.joint, [length, 0.002, width], [0, renderY, 0]);
  for (const side of [-1, 1]) box(p.zinc, [length, 0.001, 0.017], [0, renderY + 0.001, side * (width - 0.019) / 2]);
  const pitch = length / coverCount;
  for (let i = 0; i < coverCount; i++) {
    const x = -length / 2 + pitch * (i + 0.5);
    box(p.cover, [pitch - coverSeam, 0.001, width - 0.044], [x, renderY + 0.002, 0]);
    for (const side of [-1, 1]) {
      box(p.black, [0.09, 0.001, 0.038], [x + side * pitch * 0.26, renderY + 0.003, 0]);
      box(p.zinc, [0.057, 0.001, 0.014], [x + side * pitch * 0.26, renderY + 0.004, 0]);
      for (let j = -2; j <= 2; j++) box(p.edge, [0.10, 0.001, 0.015], [x + j * 0.12, renderY + 0.003, side * 0.13], side * -0.35);
    }
  }
}

function buildMarkings(parent, mark, p) {
  for (const { id, center, role, diameter, labelOffset } of ENGINEERING_LAYOUT.slab.markers) {
    const { box, disc } = mark.local(id, center);
    disc(p.joint, diameter, 0.002, [0, 0.025, 0]);
    disc(p.brass, diameter * 0.79, 0.002, [0, 0.027, 0]);
    disc(p.steel, diameter * 0.45, 0.002, [0, 0.029, 0]);
    disc(p.blue, diameter * 0.19, 0.002, [0, 0.031, 0]);
    for (let q = 0; q < 4; q++) {
      const a = q * Math.PI / 2;
      box(p.blue, [0.052, 0.001, 0.011], [Math.cos(a) * 0.176, 0.032, -Math.sin(a) * 0.176], a);
    }
    floorTag(parent, id, center.map((v, i) => v + labelOffset[i]), [0.98, 0.225], id,
      role === 'reference' ? '参考基点 · 假定' : '沉降观测点 · 未测', '#a2d1df');
  }
  const { id, label, from, to } = ENGINEERING_LAYOUT.trench;
  const { center } = engineeringDuctSpan({ from, to });
  floorTag(parent, id, [center[0], center[1] + 0.39], [2.05, 0.27], label, `${id} / ASSUMED SECTION`, '#abd5de');

  for (const { id, points, width, label, labelPoint, labelYaw = 0, exitId } of ENGINEERING_LAYOUT.fireAisles) {
    for (let i = 1; i < points.length; i++) {
      const { center, length, yaw } = engineeringDuctSpan({ from: points[i - 1], to: points[i] });
      const { box } = mark.local(id, center, yaw);
      const modules = Math.ceil(length / 0.62);
      for (let j = 0; j < modules; j++) {
        const pitch = length / modules;
        const x = -length / 2 + pitch * (j + 0.5);
        for (const side of [-1, 1]) box(p.egress, [pitch * 0.64, 0.001, 0.039], [x, 0.029, side * width / 2]);
      }
      const arrows = length > 3 ? [-length / 2 + 0.77, length / 2 - 0.83] : [0];
      for (const x of arrows) for (const side of [-1, 1]) {
        box(p.egress, [0.22, 0.001, 0.042], [x - 0.035, 0.031, side * 0.062], side * 0.63);
      }
    }
    floorTag(parent, id, labelPoint, [1.91, 0.31], label, `${exitId} / MODEL ONLY`, '#a3eac6', labelYaw);
  }

  const zone = ({ id, center: [x, z], size: [w, d], label, labelPoint }, material, accent, sub) => {
    const { box } = mark.local(id, [x, z]);
    for (const a of [-1, 1]) for (const b of [-1, 1]) {
      box(material, [0.42, 0.001, 0.063], [a * (w / 2 - 0.21), 0.027, b * d / 2]);
      box(material, [0.063, 0.001, 0.40], [a * w / 2, 0.028, b * (d / 2 - 0.20)]);
    }
    for (const side of [-1, 1]) {
      stroke(mark, id, material, [x - w / 2 + 0.55, z + side * d / 2], [x + w / 2 - 0.55, z + side * d / 2], 0.022, 0.027);
      stroke(mark, id, material, [x + side * w / 2, z - d / 2 + 0.52], [x + side * w / 2, z + d / 2 - 0.52], 0.022, 0.027);
      for (let i = 0.56; i < w - 0.52; i += 0.27) {
        box(material, [0.18, 0.001, 0.027], [i - w / 2, 0.028, side * (d / 2 - 0.088)], Math.PI / 4);
      }
    }
    floorTag(parent, id, labelPoint, [1.63, 0.275], label, `${id} / ${sub}`, accent);
  };
  for (const item of ENGINEERING_LAYOUT.maintenanceEnvelopes) zone(item, p.amber, '#efd095', 'SERVICE');
  for (const item of ENGINEERING_LAYOUT.antiCollisionZones) zone(item, p.danger, '#f0ac9c', 'KEEP CLEAR');
}

/** Adds the engineering layer. Set root.userData.markings.visible for the floor annotation toggle. */
export function buildEngineeringScene(scene) {
  const root = new THREE.Group();
  root.name = 'Workshop engineering layer';
  const child = (name) => {
    const group = new THREE.Group();
    group.name = name;
    root.add(group);
    return group;
  };
  const solids = child('Engineering fixtures and overhead services');
  const surfaces = child('Flush utility trench covers');
  const markings = child('Engineering floor markings');
  root.userData = { solids, surfaces, markings, status: ENGINEERING_LAYOUT.status };
  const paletteForScene = palette();
  const fixed = batches(solids, 'solid');
  const flush = batches(surfaces, 'flush');
  const paint = batches(markings, 'overlay');
  buildFixtures(solids, fixed, paletteForScene);
  buildAirServices(solids, fixed, paletteForScene);
  buildTrench(flush, paletteForScene);
  buildMarkings(markings, paint, paletteForScene);
  for (const batch of [fixed, flush, paint]) batch.finish();
  scene.add(root);
  return root;
}
