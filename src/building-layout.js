import { ENGINEERING_LAYOUT } from './engineering-layout.js';
import { productionLines, workshopFloor } from './layout.js';
import { truckPark, truckTravel } from './logistics-layout.js';
import { REJECT_TRUCK_PARK } from './reject-layout.js';

const { center: [x, , z], size: [width, depth] } = workshopFloor;
export const envelopeEdges = { west: x - width / 2, east: x + width / 2, north: z - depth / 2, south: z + depth / 2 };
const { west, east, north, south } = envelopeEdges;
export const EAVE = 6.72;
export const RIDGE = 7.85;
export const WALL_OFFSET = 0.30;
export const WALL_THICKNESS = 0.24;
export const roofRidgeZ = z;
export const roofHeightAt = (atZ) => RIDGE - (RIDGE - EAVE) * Math.abs(atZ - z) / (depth / 2);
const vehicleDoor = (id, label, station, at, clearWidth, clearHeight) => ({
  id, label, side: 'east', station, at, clearWidth, clearHeight, jamb: 0.21, type: 'vehicle',
});
export const envelopeDoors = [
  ...ENGINEERING_LAYOUT.exits.map((door, index) => ({ ...door, side: index === 0 ? 'south' : 'east',
    at: door.center[index], type: 'egress' })),
  vehicleDoor('VD-01', '成品发运', 'dispatch', truckPark[2], 2.66, 2.88),
  vehicleDoor('VD-02', '隔离清运', 'reject', REJECT_TRUCK_PARK[2], 3.48, 3.22),
  { id: 'SD-01', label: '机电检修', side: 'west', at: -4.88, clearWidth: 1.64, clearHeight: 2.42, jamb: 0.18, type: 'service' },
];
const southExit = envelopeDoors.find(({ side }) => side === 'south');
export const roofFrames = Array.from({ length: 11 }, (_, index) => {
  const at = west + 0.33 + (width - 0.66) * index / 10;
  return Math.abs(at - southExit.at) < (southExit.clearWidth / 2 + southExit.jamb + 0.35)
    ? southExit.at + southExit.clearWidth / 2 + southExit.jamb + 0.60 : at;
});
export const envelopeSides = {
  north: { min: west, max: east, edge: north, normal: [0, -1] },
  south: { min: west, max: east, edge: south, normal: [0, 1] },
  west: { min: north, max: south, edge: west, normal: [-1, 0] },
  east: { min: north, max: south, edge: east, normal: [1, 0] },
};

export function envelopePoint(side, at, offset = WALL_OFFSET) {
  const { edge, normal } = envelopeSides[side];
  return normal[0] ? [edge + normal[0] * offset, at] : [at, edge + normal[1] * offset];
}

export const envelopeWalls = Object.entries(envelopeSides).flatMap(([side, { min, max }]) => {
  const doors = envelopeDoors.filter((door) => door.side === side).sort((a, b) => a.at - b.at);
  let start = min;
  const spans = [];
  for (const door of doors) {
    const cut = door.clearWidth / 2 + door.jamb;
    spans.push({ side, from: start, to: door.at - cut });
    start = door.at + cut;
  }
  return [...spans, { side, from: start, to: max }];
});

// The lower ductheads are the connection points to the production-floor network.
export const roofAirUnits = [
  { id: 'AHU-A', center: [-15.7, -4.10], system: 'supply', line: 0, duct: 'SA-A', tap: [-15.7, -7.93], bends: [] },
  { id: 'AHU-B', center: [-11.55, 13.55], system: 'supply', line: 1, duct: 'SA-B', tap: [-14.60, 13.55], bends: [] },
  { id: 'AHU-E', center: [30.25, -1.72], system: 'return', duct: 'RA-E', tap: [33.28, -1.72], bends: [] },
];
export const roofAirRoutes = roofAirUnits.map((unit) => ({ ...unit, points: [unit.center, ...unit.bends, unit.tap], width: 0.54 }));

export function getAirUnitMode(unit, sim) {
  // Base ventilation runs continuously and increases while the served line prints.
  const lines = unit.system === 'return' ? productionLines : [productionLines[unit.line]];
  const boost = lines.some(({ printers }) => printers.some((id) => sim?.stations?.[id]?.motion === 'print'));
  return boost ? 'boost' : 'base';
}

export function smoothFactor(value, start, end) {
  const t = Math.min(1, Math.max(0, (value - start) / (end - start)));
  return t * t * (3 - 2 * t);
}

export function roofVisibility(distance) {
  return smoothFactor(distance, 29, 47);
}

// Both lane scanners share the wall coordinate. The curtain has finished opening
// by the time the longest vehicle's front bumper reaches the threshold.
export function vehicleDoorOpening(vehicleX, active = true) {
  return active && Number.isFinite(vehicleX)
    ? smoothFactor(vehicleX, east - 10.2, east - 4.0) * (1 - smoothFactor(vehicleX, east + 2.38, east + 3.55))
    : 0;
}

export function getEnvelopeDoorOpening(station, sim) {
  if (station === 'reject') {
    const rejects = sim?.logistics?.rejects;
    return vehicleDoorOpening(rejects?.truckX, Boolean(rejects?.truckVisible));
  }
  const dispatch = sim?.stations?.dispatch;
  const phase = dispatch?.phaseProgress ?? 0;
  let travel = sim?.finalDeparture ? 1 : 0;
  if (dispatch?.motion === 'depart') travel = smoothFactor(phase, 0.25, 1);
  if (dispatch?.motion === 'truck-return') travel = 1 - smoothFactor(phase, 0, 0.83);
  return vehicleDoorOpening(truckPark[0] + truckTravel * travel);
}
