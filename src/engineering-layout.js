import { positions, workshopFloor } from './layout.js';
import { rackColumns, rackRailZ, sortInlet, sortPorts, truckPark } from './logistics-layout.js';
import { CHARGING_ZONE_CENTER } from './patrol-layout.js';
import { REJECT_TRUCK_PARK } from './reject-layout.js';

// Coordination model only: dimensions are assumed, not surveyed or checked against
// building, fire, structural or electrical requirements. Boundary exits have no
// modeled discharge beyond the slab; these are not operational evacuation routes.
// All points/centers in the plan are [x, z], sizes are [widthX, depthZ], all in m.
// Fixture faces point along local +Z before applying yaw (radians). Bounds use XYZ.
const floorEdges = {
  east: workshopFloor.center[0] + workshopFloor.size[0] / 2,
  south: workshopFloor.center[2] + workshopFloor.size[1] / 2,
};
const exits = [
  { id: 'EX-01', label: 'B 区疏散示意', center: [14.72, floorEdges.south - 0.14], yaw: Math.PI,
    clearWidth: 1.34, clearHeight: 2.32, jamb: 0.105, depth: 0.18, header: 0.33, outward: [0, 1] },
  { id: 'EX-02', label: '东侧疏散示意', center: [floorEdges.east - 0.066, 7.04], yaw: -Math.PI / 2,
    clearWidth: 1.28, clearHeight: 2.32, jamb: 0.105, depth: 0.125, header: 0.33, outward: [1, 0] },
];
const fireAisles = [
  { id: 'FA-01', exitId: 'EX-01', label: '消防通道示意', width: 1.10, solid: false,
    points: [[7.1, 19.87], [exits[0].center[0], 19.87], [exits[0].center[0], floorEdges.south]], labelPoint: [10.2, 19.88] },
  { id: 'FA-02', exitId: 'EX-02', label: '消防通道示意', width: 1.06, solid: false,
    points: [[37.85, 9.65], [37.85, exits[1].center[1]], [floorEdges.east, exits[1].center[1]]], labelPoint: [37.86, 8.71], labelYaw: Math.PI / 2 },
];

const column = (id, center) => ({ id, center, size: [0.60, 0.55], height: 5.52,
  flangeWidth: 0.31, sectionDepth: 0.33 });
const columns = [
  column('C-A1', [-16.30, -8.52]), column('C-A2', [-7.10, -8.52]),
  column('C-A3', [0.78, -8.52]), column('C-A4', [8.60, -8.52]),
  column('C-B1', [-15.25, 7.72]), column('C-B2', [-15.25, 13.05]), column('C-B3', [-15.25, 18.55]),
  column('C-E1', [34.51, -4.90]), column('C-E2', [34.51, 7.42]),
];
const hydrants = [
  { id: 'FH-01', label: '室内消火栓', center: [-19.10, -7.22], size: [0.85, 0.58], height: 1.93, yaw: 0 },
  { id: 'FH-02', label: '室内消火栓', center: [28.8, 17.48], size: [0.85, 0.58], height: 1.93, yaw: Math.PI },
];
const electricalCabinets = [
  { id: 'DB-01', label: '动力配电', center: [-17.58, -7.22], size: [1.45, 0.78], height: 2.11, yaw: 0 },
  { id: 'DB-02', label: '仓储配电', center: [31.5, -4.85], size: [1.45, 0.78], height: 2.11, yaw: 0 },
];

const duct = (id, from, to, width, height, y, system = 'supply') => ({ id, from, to, width, height, y, system });
// Duct dimensions include flange and hanger allowances. The diffuser face is
// at its bottom elevation; the support arms sit above the duct, not at roof level.
const hvac = {
  label: '架空送回风',
  ducts: [
    duct('SA-A', [-16.49, -7.93], [11.05, -7.93], 0.76, 0.56, 4.91),
    duct('SA-A1', [-5.8, -7.93], [-5.8, -4.55], 0.43, 0.37, 4.91),
    duct('SA-A2', [8.6, -7.93], [8.6, -4.55], 0.43, 0.37, 4.91),
    duct('SA-B', [-14.60, 7.54], [-14.60, 18.73], 0.73, 0.56, 4.91),
    duct('SA-B1', [-14.60, 7.72], [-8.2, 7.72], 0.43, 0.37, 4.91),
    duct('SA-B2', [-14.60, 14.7], [-8.2, 14.7], 0.43, 0.37, 4.91),
    duct('RA-E', [33.28, -4.90], [33.28, 7.42], 0.69, 0.58, 4.98, 'return'),
    duct('RA-E1', [33.28, 1.10], [31.5, 1.10], 0.40, 0.39, 4.98, 'return'),
  ],
  diffusers: [
    { id: 'DF-A1', center: [-5.8, -4.62], size: [0.66, 0.75], y: 4.56, height: 0.24, system: 'supply' },
    { id: 'DF-A2', center: [8.6, -4.62], size: [0.66, 0.75], y: 4.56, height: 0.24, system: 'supply' },
    { id: 'DF-B1', center: [-8.27, 7.72], size: [0.75, 0.66], y: 4.56, height: 0.24, system: 'supply' },
    { id: 'DF-B2', center: [-8.27, 14.7], size: [0.75, 0.66], y: 4.56, height: 0.24, system: 'supply' },
    { id: 'GR-E1', center: [31.60, 1.10], size: [0.64, 0.60], y: 4.62, height: 0.24, system: 'return' },
  ],
  supports: columns.map(({ id, center: [x, z] }) => {
    const end = id.startsWith('C-A') ? [x, -7.93] : id.startsWith('C-B') ? [-14.60, z] : [33.28, z];
    return { id: `HK-${id.slice(2)}`, center: [(x + end[0]) / 2, (z + end[1]) / 2],
      size: [Math.abs(x - end[0]) + 0.17, Math.abs(z - end[1]) + 0.17], y: 5.16, height: 0.36, dropAt: end };
  }),
};

const slab = {
  datum: workshopFloor.center[1], assumedThickness: 0.32, status: 'assumed geometry / no settlement observations',
  markers: [
    { id: 'BM-01', role: 'reference', center: [-20.55, -8.30], labelOffset: [0, 0.34] },
    { id: 'SP-01', role: 'survey-point', center: [-12.25, -8.46], labelOffset: [0, 0.34] },
    { id: 'SP-02', role: 'survey-point', center: [4.7, -8.46], labelOffset: [0, 0.34] },
    { id: 'SP-03', role: 'survey-point', center: [-14.62, 13.4], labelOffset: [0, 0.34] },
    { id: 'SP-04', role: 'survey-point', center: [15.18, 18.49], labelOffset: [0, -0.34] },
    { id: 'SP-05', role: 'survey-point', center: [32.26, 8.87], labelOffset: [0, 0.34] },
    { id: 'SP-06', role: 'survey-point', center: [28.30, 16.18], labelOffset: [0, 0.34] },
  ].map(marker => ({ ...marker, diameter: 0.26, elevation: 0, measuredSettlement: null, solid: false })),
};
const trench = {
  id: 'UT-01', label: '综合管沟 · 齐平盖板', from: [-17.8, -9.29], to: [11.45, -9.29], width: 0.44,
  assumedDepth: 0.26, coverTop: slab.datum, coverCount: 39, coverSeam: 0.018,
  representation: 'closed surface only; the existing slab is not cut', solid: false,
};

const area = (id, label, center, size, labelPoint, height) => ({ id, label, center, size, labelPoint,
  height, solid: false });
const maintenanceEnvelopes = [
  area('ME-ASRS', 'AS/RS 检修包络', [(rackColumns[0] + rackColumns.at(-1)) / 2, rackRailZ - 0.12], [10.58, 4.04], [24.00, -0.91], 4.85),
  area('ME-SORT', '分拣检修包络', [(sortInlet[0] + sortPorts[0][0]) / 2, 2.82], [4.66, 3.54], [18.03, 4.34], 1.95),
  area('ME-CHG', '充电检修包络', [CHARGING_ZONE_CENTER[0], CHARGING_ZONE_CENTER[2]], [5.70, 2.94], [32.90, -2.49], 2.20),
];
const antiCollisionZones = [
  ...['robot', 'robot2'].map((station, i) => area(`AC-${i + 1}`, '机械臂限入',
    [positions[station][0], positions[station][2]], [4.46, 3.69],
    [positions[station][0], positions[station][2] - 1.58], 2.35)),
  area('AC-3', '装车交互区', [truckPark[0], truckPark[2] - 1.11], [4.43, 2.58], [truckPark[0], 2.54], 2.35),
  area('AC-4', '专车道 · 禁停', [31.02, REJECT_TRUCK_PARK[2]], [4.8, 3.26], [31.02, 16.46], 1.95),
];

export const ENGINEERING_LAYOUT = {
  status: 'modeled design intent only / not verified for code compliance',
  exits, fireAisles, columns, hydrants, electricalCabinets, hvac, slab, trench, maintenanceEnvelopes, antiCollisionZones,
};

function bounds(id, ownerId, [x, z], [w, d], low, high, yaw = 0) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const hw = (Math.abs(c) * w + Math.abs(s) * d) / 2;
  const hd = (Math.abs(s) * w + Math.abs(c) * d) / 2;
  return { id, ownerId, min: [x - hw, low, z - hd], max: [x + hw, high, z + hd] };
}

export function engineeringDuctSpan({ from, to }) {
  const [dx, dz] = [to[0] - from[0], to[1] - from[1]];
  return { center: [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2],
    length: Math.hypot(dx, dz), yaw: -Math.atan2(dz, dx) };
}

function exitBounds(exit) {
  const { id, center: [x, z], yaw, clearWidth, clearHeight, jamb, depth, header } = exit;
  return [
    ...[-1, 1].map(side => {
      const u = side * (clearWidth + jamb) / 2;
      return bounds(`${id}/${side < 0 ? 'left' : 'right'}`, id,
        [x + u * Math.cos(yaw), z - u * Math.sin(yaw)], [jamb, depth], 0, clearHeight, yaw);
    }),
    bounds(`${id}/header`, id, [x, z], [clearWidth + 2 * jamb, depth], clearHeight, clearHeight + header, yaw),
  ];
}

const fixtureBounds = fixture => bounds(fixture.id, fixture.id, fixture.center, fixture.size, 0, fixture.height, fixture.yaw);
export const ENGINEERING_SOLID_BOUNDS = [
  ...exits.flatMap(exitBounds), ...[...columns, ...hydrants, ...electricalCabinets].map(fixtureBounds),
  ...hvac.ducts.map(duct => {
    const { center, length, yaw } = engineeringDuctSpan(duct);
    return bounds(duct.id, duct.id, center, [length, duct.width], duct.y - duct.height / 2, duct.y + duct.height / 2, yaw);
  }),
  ...[...hvac.diffusers, ...hvac.supports].map(({ id, center, size, y, height }) => bounds(id, id, center, size, y, y + height)),
];
