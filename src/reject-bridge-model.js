import * as THREE from 'three';
import { REJECT_BRIDGE_LAYOUT, REJECT_BRIDGE_SECTIONS } from './reject-bridge-layout.js';

const steel = (color, metalness, roughness) => new THREE.MeshStandardMaterial({ color, metalness, roughness });
const red = steel(0x9a433b, 0.38, 0.46);
const frame = steel(0x394349, 0.53, 0.51);
const galv = steel(0x8e9ba1, 0.64, 0.45);
const concrete = steel(0x666a64, 0.04, 0.91);
const amber = steel(0xe4a552, 0.22, 0.58);
const unitBox = new THREE.BoxGeometry();
const boltHead = new THREE.CylinderGeometry(1, 1, 1, 6);

function block(parent, name, material, size, [x, y, z]) {
  const mesh = new THREE.Mesh(unitBox, material);
  mesh.name = name;
  mesh.scale.set(...size);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function member(parent, name, material, from, to, height, width) {
  const direction = new THREE.Vector3().fromArray(to).sub(new THREE.Vector3().fromArray(from));
  const position = from.map((value, i) => (value + to[i]) / 2);
  const beam = block(parent, name, material, [direction.length(), height, width], position);
  const horizontal = Math.hypot(direction.x, direction.z);
  beam.rotation.set(0, -Math.atan2(direction.z, direction.x), Math.atan2(direction.y, horizontal), 'YXZ');
  return beam;
}

function anchor(parent, x, z) {
  const mesh = new THREE.Mesh(boltHead, galv);
  mesh.name = 'Hex anchor head';
  mesh.position.set(x, 0.128, z);
  mesh.scale.set(0.023, 0.022, 0.023);
  mesh.castShadow = true;
  parent.add(mesh);
}

function buildPortal(parent, portal) {
  const { id, posts: [[ax, az], [bx, bz]], feet, beamTop, soffit, postSize } = portal;
  const assembly = new THREE.Group();
  assembly.name = id;
  parent.add(assembly);
  const crossX = Math.sign(bx - ax);
  const crossZ = Math.sign(bz - az);
  const headHeight = beamTop - soffit;
  const headY = (beamTop + soffit) / 2;
  member(assembly, 'Portal header', red,
    [ax - crossX * 0.14, headY, az - crossZ * 0.14], [bx + crossX * 0.14, headY, bz + crossZ * 0.14], headHeight, 0.24);
  for (const [i, { id: footId, center: [x, z], size: [width, depth] }] of feet.entries()) {
    const [postX, postZ] = postSize;
    const inward = i === 0 ? 1 : -1;
    block(assembly, footId, concrete, [width, 0.072, depth], [x, 0.036, z]);
    block(assembly, 'Anchor base plate', frame, [0.355, 0.045, 0.355], [x, 0.094, z]);
    block(assembly, 'Box-section column', frame, [postX, soffit - 0.113, postZ], [x, (soffit + 0.113) / 2, z]);
    for (const dx of [-0.132, 0.132]) for (const dz of [-0.132, 0.132]) anchor(assembly, x + dx, z + dz);
    member(assembly, 'Portal knee', red, [x, soffit - 0.34, z],
      [x + inward * crossX * 0.39, soffit + 0.016, z + inward * crossZ * 0.39], 0.086, 0.11);
    block(assembly, 'Column cap', galv, [0.253, 0.026, 0.253], [x, soffit - 0.012, z]);
    const stripe = block(assembly, 'Foot visibility band', amber, [0.196, 0.058, 0.196], [x, 0.366, z]);
    stripe.castShadow = false;
  }
}

function buildSpan(parent, span) {
  const { id, section, from: [ax, az], to: [bx, bz], length, bearingIds } = span;
  const { topAxis, bottomAxis, chordWidth, chordHeight, halfWidth, seatTop } = REJECT_BRIDGE_SECTIONS[section];
  const assembly = new THREE.Group();
  assembly.name = id;
  assembly.position.set(ax, 0, az);
  assembly.rotation.y = -Math.atan2(bz - az, bx - ax);
  parent.add(assembly);
  const elbowEnds = bearingIds.map((id) => id.startsWith('RJ-E'));
  const start = elbowEnds[0] ? 0.423 : 0;
  const end = elbowEnds[1] ? length - 0.423 : length;
  const panels = Math.max(2, Math.ceil((end - start) / 0.64));
  const panel = (end - start) / panels;
  const chordTop = topAxis + chordHeight / 2;
  // At a shared portal, only the arriving span installs the end web and cross tie.
  const installsStartWeb = !bearingIds[0].startsWith('RJ-P');
  for (const side of [-1, 1]) {
    const z = side * halfWidth;
    for (const y of [topAxis, bottomAxis]) {
      member(assembly, 'Box truss chord', red, [start, y, z], [end, y, z], chordHeight, chordWidth);
    }
    for (let i = 0; i <= panels; i++) {
      const x = start + i * panel;
      if (i > 0 || installsStartWeb) {
        block(assembly, 'Vertical web', frame, [0.062, topAxis - bottomAxis, 0.060], [x, (topAxis + bottomAxis) / 2, z]);
      }
      if (i < panels) {
        const [y1, y2] = i % 2 ? [topAxis, bottomAxis] : [bottomAxis, topAxis];
        member(assembly, 'Diagonal web', frame, [x, y1, z], [x + panel, y2, z], 0.051, 0.050);
      }
      // Keep the seat clear of the roller drive near each conveyor inlet.
      if (i > 0 && (i < panels || bearingIds[1] === 'RJ-T02')) {
        const seatStart = chordTop - 0.010;
        block(assembly, 'Bolted conveyor seat', galv, [0.084, seatTop - seatStart, 0.085],
          [x, (seatTop + seatStart) / 2, z]);
      }
    }
    if (bearingIds[0] === 'RJ-T01') {
      block(assembly, 'Trestle splice plate', galv, [0.081, 0.185, 0.099], [0.005, (topAxis + bottomAxis) / 2, z]);
    }
  }
  // The lower tie ladder keeps the paired side webs spaced beneath the roller bed.
  for (let i = installsStartWeb ? 0 : 1; i <= panels; i++) {
    const x = start + i * panel;
    member(assembly, 'Lateral tie', frame, [x, bottomAxis, -halfWidth], [x, bottomAxis, halfWidth], 0.062, 0.054);
  }
}

function buildElbow(parent, { id, center: [x, z], size: [width, depth], soffit }) {
  const { topAxis, bottomAxis, chordHeight } = REJECT_BRIDGE_SECTIONS.sky;
  const elbow = new THREE.Group();
  elbow.name = id;
  parent.add(elbow);
  block(elbow, 'Elbow torsion diaphragm', frame,
    [width, bottomAxis - soffit + 0.034, depth], [x, (bottomAxis + soffit + 0.034) / 2, z]);
  for (const dx of [-0.38, 0.38]) for (const dz of [-0.38, 0.38]) {
    const top = topAxis + chordHeight / 2;
    block(elbow, 'Elbow web and bearing', red, [0.125, top - bottomAxis - 0.007, 0.125], [x + dx, (top + bottomAxis - 0.007) / 2, z + dz]);
    block(elbow, 'Turntable bearing seat', galv, [0.104, 0.102, 0.104],
      [x + Math.sign(dx) * 0.283, top + 0.039, z + Math.sign(dz) * 0.283]);
  }
}

export function buildRejectBridge(parent, section) {
  const bridge = new THREE.Group();
  bridge.name = section === 'sky' ? 'Reject skybridge reinforcement' : 'Reject feed bridge reinforcement';
  parent.add(bridge);
  for (const span of REJECT_BRIDGE_LAYOUT.spans.filter((span) => span.section === section)) buildSpan(bridge, span);
  for (const portal of REJECT_BRIDGE_LAYOUT.portals.filter((portal) => portal.section === section)) buildPortal(bridge, portal);
  if (section === 'sky') for (const elbow of REJECT_BRIDGE_LAYOUT.elbows) buildElbow(bridge, elbow);
  return bridge;
}
