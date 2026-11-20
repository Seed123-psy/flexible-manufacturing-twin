import { rollerTop, sortInlet, sortJunction, sortPorts } from './logistics-layout.js';
import { rejectWarehouseCenter, REJECT_ELBOWS, REJECT_INTAKE, REJECT_INTAKE_LIFT, REJECT_LINK_HEIGHT, REJECT_LIFT_SPEED, REJECT_ORIGIN } from './reject-layout.js';

export { rollerTop } from './logistics-layout.js';

const productionGeometry = {
  print1: [-7.2, 0, -2.9],
  print2: [-3.6, 0, -2.9],
  print3: [0, 0, -2.9],
  quality: [3.7, 0, -2.9],
  boxes: [-0.5, 0, 2.40],
  robot: [6.55, 0, 2],
  buffer: [10.4, 0, 2.1],
};
const productionGeometryB = {
  print4: 'print1', print5: 'print2', print6: 'print3',
  quality2: 'quality', robot2: 'robot', buffer2: 'buffer',
};

export const workshopFloor = { center: [7.8875, 0, 5.60], size: [61.525, 30.40] };

export const lineSpacing = 11.5;
export const productionLines = [
  { key: 'lineA', printers: ['print1', 'print2', 'print3'], quality: 'quality', boxes: 'boxes', robot: 'robot', buffer: 'buffer' },
  { key: 'lineB', printers: ['print4', 'print5', 'print6'], quality: 'quality2', boxes: 'boxes2', robot: 'robot2', buffer: 'buffer2' },
];
export const productionPads = [
  { label: 'A 线生产区', center: [0.1, 0, 0.05], size: [19.4, 10.1], labelPoint: [-6.7, 0, 1.14], color: '#70c8b6', floor: 0x495f61 },
  { label: 'B 线生产区', center: [1.67, 0, 11.55], size: [22.54, 10.1], labelPoint: [-6.7, 0, 13.55], color: '#e3bc81', floor: 0x665c50 },
];
export const printerIds = productionLines.flatMap(({ printers }) => printers);

export const positions = {
  design: [-18.1, 0, 2.1],
  ...productionGeometry,
  ...Object.fromEntries(Object.entries(productionGeometryB).map(([id, source]) => {
    const [x, y, z] = productionGeometry[source];
    return [id, [x, y, z + lineSpacing]];
  })),
  // B keeps its original carton station when A's carton machine moves.
  boxes2: [-0.5, 0, 15.75],
  sort: [17.9, 0, 2.65],
  presort: [14.77, 0, sortInlet[2]],
  scan: [15.34, 0, sortInlet[2]],
  exception: [15.96, 0, 4.83],
  staging: [24.1, 0, 1.10],
  storage: [24.1, 0, -3.40],
  dispatch: [25.12, 0, 3.45],
  reject: rejectWarehouseCenter,
};

export const palletHeight = 0.058;
export const palletWidth = 0.694;
export const palletDepth = 0.592;
export const printerOutlet = [0, rollerTop, 0.965];
export const qualityInlet = [-0.62, rollerTop, 0.27];
export const qualityOutlet = [0.92, rollerTop, 0.27];
export const cartonOutlet = [2.09, rollerTop, 0.25];
export const robotPick = [-1.12, rollerTop, 0.63];
export const robotDrop = [1.02, rollerTop, 0.65];
export const robotOutlet = [1.65, rollerTop, 0.65];
export const warehouseIntake = [-0.77, rollerTop, 0.55];
export const bufferOutlet = [2.85, rollerTop, 0.55];

const floorPoint = (x, z) => [x, rollerTop, z];
function world(station, point) {
  const [x, y, z] = positions[station];
  return [x + point[0], y + point[1], z + point[2]];
}

export const junctionWidth = 0.88;
export const junctionDeckEdge = junctionWidth / 2 + 0.008;
const edge = junctionWidth / 2 - 0.012;
const routes = {};
export const junctions = [];
export const conveyorRuns = [];

for (const [index, line] of productionLines.entries()) {
  const { printers, quality, boxes, robot, buffer } = line;
  const mergeZ = -1.43 + index * lineSpacing;
  const qualityEntry = world(quality, qualityInlet);
  const qualityExit = world(quality, qualityOutlet);
  const robotProduct = world(robot, robotPick);
  const robotBox = world(robot, robotDrop);
  const boxExit = world(boxes, cartonOutlet);
  const robotExit = world(robot, robotOutlet);
  const bufferEntry = world(buffer, warehouseIntake);
  const qualityTurn = floorPoint(qualityEntry[0], mergeZ);
  const outputTurn = floorPoint(robotProduct[0], qualityExit[2]);
  const printerJunctions = printers.map((id) => floorPoint(positions[id][0], mergeZ));
  junctions.push(...printerJunctions, qualityTurn, outputTurn);

  for (const [i, id] of printers.entries()) {
    const [x, , z] = positions[id];
    conveyorRuns.push([floorPoint(x, z + 0.708), floorPoint(x, mergeZ - edge)]);
    routes[id + '/' + quality] = [world(id, printerOutlet), printerJunctions[i], qualityTurn, qualityEntry];
  }
  const trunk = [...printerJunctions, qualityTurn];
  for (let i = 1; i < trunk.length; i++) {
    conveyorRuns.push([floorPoint(trunk[i - 1][0] + edge, mergeZ), floorPoint(trunk[i][0] - edge, mergeZ)]);
  }
  conveyorRuns.push(
    [floorPoint(qualityEntry[0], mergeZ - edge), floorPoint(qualityEntry[0], qualityEntry[2] + 0.38)],
    [floorPoint(qualityExit[0] + 0.33, qualityExit[2]), floorPoint(outputTurn[0] - edge, outputTurn[2])],
    [floorPoint(outputTurn[0], outputTurn[2] + edge), floorPoint(robotProduct[0], robotProduct[2] - 0.42)],
  );
  routes[quality + '/' + robot] = [qualityExit, outputTurn, robotProduct];
  if (index === 0) {
    // The two A ports line up in Z, but the live product pickup sits between
    // them. Pass in front of the pickup and enter the carton drop from +Z.
    const bypassX = 4.58;
    const bypassZ = 4.12;
    const bypassEntry = floorPoint(bypassX, boxExit[2]);
    const bypassCorner = floorPoint(bypassX, bypassZ);
    const dropTurn = floorPoint(robotBox[0], bypassZ);
    junctions.push(bypassEntry, bypassCorner, dropTurn);
    conveyorRuns.push(
      [floorPoint(boxExit[0] + 0.008, boxExit[2]), floorPoint(bypassX - edge, boxExit[2])],
      [floorPoint(bypassX, boxExit[2] + edge), floorPoint(bypassX, bypassZ - edge)],
      [floorPoint(bypassX + edge, bypassZ), floorPoint(robotBox[0] - edge, bypassZ)],
      [floorPoint(robotBox[0], bypassZ - edge), floorPoint(robotBox[0], robotBox[2] + 0.42)],
    );
    routes[boxes + '/' + robot] = [boxExit, bypassEntry, bypassCorner, dropTurn, robotBox];
  } else {
    const boxTurn = floorPoint(robotBox[0], boxExit[2]);
    junctions.push(boxTurn);
    conveyorRuns.push(
      [floorPoint(boxExit[0] + 0.008, boxExit[2]), floorPoint(boxTurn[0] - edge, boxTurn[2])],
      [floorPoint(boxTurn[0], boxTurn[2] - edge), floorPoint(robotBox[0], robotBox[2] + 0.42)],
    );
    routes[boxes + '/' + robot] = [boxExit, boxTurn, robotBox];
  }
  conveyorRuns.push([floorPoint(robotExit[0] + 0.188, robotExit[2]), floorPoint(bufferEntry[0] - 0.268, bufferEntry[2])]);
  routes[robot + '/' + buffer] = [robotExit, bufferEntry];
}

const [feedA, feedB] = productionLines.map(({ buffer }) => world(buffer, bufferOutlet));
const mergeA = floorPoint(14.12, feedA[2]);
const mergeB = floorPoint(14.12, feedB[2]);
const presortPoint = world('presort', [0, rollerTop, 0]);
const scanPoint = world('scan', [0, rollerTop, 0]);
const exceptionPoint = world('exception', [0, rollerTop, 0]);
const exceptionEntry = floorPoint(scanPoint[0], exceptionPoint[2]);
const exceptionExit = floorPoint(sortInlet[0], exceptionPoint[2]);
const deckEdge = junctionDeckEdge;
const sortLaneJunctions = sortPorts.map((port) => floorPoint(sortJunction[0], port[2]));
junctions.push(mergeA, mergeB, scanPoint, exceptionEntry, exceptionExit, sortInlet, sortJunction, ...sortLaneJunctions);
conveyorRuns.push(
  [floorPoint(feedA[0] + 0.268, feedA[2]), floorPoint(mergeA[0] - deckEdge, feedA[2])],
  [floorPoint(feedB[0] + 0.268, feedB[2]), floorPoint(mergeB[0] - deckEdge, feedB[2])],
  [floorPoint(mergeA[0], mergeA[2] + deckEdge), floorPoint(mergeB[0], mergeB[2] - deckEdge)],
  [floorPoint(mergeA[0] + deckEdge, mergeA[2]), floorPoint(scanPoint[0] - deckEdge, scanPoint[2])],
  [floorPoint(scanPoint[0] + deckEdge, scanPoint[2]), floorPoint(sortInlet[0] - deckEdge, sortInlet[2])],
  [floorPoint(scanPoint[0], scanPoint[2] + deckEdge), floorPoint(exceptionEntry[0], exceptionEntry[2] - deckEdge)],
  [floorPoint(exceptionEntry[0] + deckEdge, exceptionEntry[2]), floorPoint(exceptionExit[0] - deckEdge, exceptionExit[2])],
  [floorPoint(exceptionExit[0], exceptionExit[2] - deckEdge), floorPoint(sortInlet[0], sortInlet[2] + deckEdge)],
  [floorPoint(sortInlet[0] + deckEdge, sortInlet[2]), floorPoint(sortJunction[0] - deckEdge, sortJunction[2])],
  ...sortLaneJunctions.map(([x, , z]) => {
    const side = Math.sign(z - sortJunction[2]);
    return [floorPoint(x, sortJunction[2] + side * deckEdge), floorPoint(x, z - side * deckEdge)];
  }),
);
routes['buffer/presort'] = [feedA, mergeA, presortPoint];
routes['buffer2/presort'] = [feedB, mergeB, mergeA, presortPoint];
routes['presort/scan'] = [presortPoint, scanPoint];
routes['scan/sort'] = [scanPoint, sortInlet];
routes['scan/exception'] = [scanPoint, exceptionEntry, exceptionPoint];
routes['exception/sort'] = [exceptionPoint, exceptionExit, sortInlet];

// The same support coordinates are used for moving and stopped cartons.
const parcelStops = { presort: presortPoint, scan: scanPoint, exception: exceptionPoint };
const bufferStations = new Set(productionLines.map(({ buffer }) => buffer));
export function conveyorParcelPosition(station, frame) {
  if (!frame?.active) return undefined;
  if (!bufferStations.has(station)) return parcelStops[station];
  const p = frame.motion === 'wait-merge' ? 1 : frame.phaseProgress;
  const [x, y, z] = warehouseIntake;
  return world(station, [x + (bufferOutlet[0] - x) * p, y, z]);
}

// The two QC spurs merge into the new isolated, elevated transfer link.
export const rejectConveyorRuns = [];
export const rejectJunctions = [];
const holdZ = REJECT_ORIGIN[2];
const bridgeX = 10.85;
const bridgeY = 2.84;
const holdMerge = floorPoint(bridgeX, holdZ);
const liftTop = ([x, , z]) => [x, REJECT_LINK_HEIGHT, z];
const topOrigin = liftTop(REJECT_ORIGIN);
const topIntake = liftTop(REJECT_INTAKE_LIFT);
const link = [REJECT_ORIGIN, topOrigin, ...REJECT_ELBOWS, topIntake, REJECT_INTAKE_LIFT, REJECT_INTAKE];
export const rejectSkyRuns = link.slice(2, -2).map((end, i) => [link[i + 1], end]);
const bridgeTurn = [bridgeX, bridgeY, -2.63];
const bridgeLanding = floorPoint(bridgeX, 4.47); // Leave room for the level approach to the merge deck.
for (const quality of ['quality', 'quality2']) {
  const outlet = world(quality, qualityOutlet);
  const diverter = floorPoint(5.43, outlet[2]);
  const branch = quality === 'quality'
    ? [diverter, floorPoint(6.0, outlet[2]), [9.85, bridgeY, outlet[2]], bridgeTurn,
      [bridgeX, bridgeY, 3.10], bridgeLanding, holdMerge]
    : [diverter, floorPoint(bridgeX, outlet[2]), holdMerge];
  routes[quality + '/reject'] = [outlet, ...branch, ...link];
  branch.slice(1).forEach((point, i) => {
    const previous = branch[i];
    // The installed QC cross-belt already covers the first part of the spur.
    const from = i === 0 ? floorPoint(previous[0] + edge, previous[2]) : previous;
    rejectConveyorRuns.push([from, point]);
  });
  if (quality === 'quality2') rejectJunctions.push(branch[1]);
}
rejectConveyorRuns.push([holdMerge, REJECT_ORIGIN], [REJECT_INTAKE_LIFT, REJECT_INTAKE]);
rejectJunctions.push(...REJECT_ELBOWS);
rejectJunctions.push(bridgeTurn, holdMerge);

export function getMaterialRoute(from, to) { return routes[from + '/' + to]; }

const heading = ({ start, end }) => -Math.atan2(end[2] - start[2], end[0] - start[0]);

function describeTravel(points, reject, alignCarton) {
  const steps = [];
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    const start = points[i - 1];
    const end = points[i];
    const vertical = reject && start[0] === end[0] && start[2] === end[2];
    const meters = Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2]);
    const distance = vertical ? meters * 3.3 / REJECT_LIFT_SPEED : meters;
    steps.push({ start, end, offset: length, distance, vertical });
    length += distance;
    const next = points[i + 1];
    if (next || alignCarton) {
      const cornerHold = next ? 0.36 : 0.52;
      steps.push({ start: end, end, offset: length, distance: cornerHold,
        turnFrom: heading({ start, end }), turnTo: next ? heading({ start: end, end: next }) : 0 });
      length += cornerHold;
    }
  }
  return { steps, length, duration: Math.max(0.72, length / 3.3) };
}

const travel = Object.fromEntries(Object.entries(routes).map(([id, points]) =>
  [id, describeTravel(points, id.endsWith('/reject'), id.startsWith('boxes'))]));
export function getMaterialTravel(from, to) { return travel[from + '/' + to]; }

export function conveyorMaterialPose(from, to, kind, progress) {
  const { steps, length } = getMaterialTravel(from, to);
  const distance = progress * length;
  const step = steps.find(({ offset, distance: span }) => distance < offset + span) ?? steps.at(-1);
  const p = Math.max(0, Math.min(1, (distance - step.offset) / step.distance));
  const position = step.start.map((value, i) => value + (step.end[i] - value) * p);
  // Cross-belts shift sealed cartons sideways without rotating the shipping label.
  if (kind === 'parcel') return { position, yaw: 0 };
  if (step.turnTo === undefined) return { position, yaw: heading(step) };
  const delta = step.turnTo - step.turnFrom;
  const eased = p * p * (3 - 2 * p);
  return { position, yaw: step.turnFrom + Math.atan2(Math.sin(delta), Math.cos(delta)) * eased };
}

// Used by both the visible pallet and its lift car; the pallet never tips in a vertical lift.
export function rejectMaterialPose(from, progress) {
  const { steps, length } = getMaterialTravel(from, 'reject');
  const distance = progress * length;
  const found = steps.findIndex(({ offset, distance: span }) => distance < offset + span);
  const index = found < 0 ? steps.length - 1 : found;
  const step = steps[index];
  const t = Math.max(0, Math.min(1, (distance - step.offset) / step.distance));
  const position = step.start.map((v, i) => v + (step.end[i] - v) * t);
  const moving = (leg) => !leg.vertical && leg.start !== leg.end;
  const previous = steps.slice(0, index).findLast(moving);
  const next = steps.slice(index + 1).find(moving);
  const descending = step.vertical && step.end[1] < step.start[1];
  const hold = step.start === step.end;
  // Both holds around a descent use the lower deck's exit alignment.
  const afterDescent = hold && steps[index - 1]?.vertical && steps[index - 1].end[1] < steps[index - 1].start[1];
  const fromYaw = heading((descending || afterDescent ? next : step.vertical || hold ? previous : step) ?? step);
  // The origin car receives along X and only turns after rising to its Z exit.
  const beforeAscent = hold && steps[index + 1]?.vertical && steps[index + 1].end[1] > step.end[1];
  const yawDelta = hold && !beforeAscent && next ? heading(next) - fromYaw : 0;
  const yaw = fromYaw + Math.atan2(Math.sin(yawDelta), Math.cos(yawDelta)) * t;
  const pitch = step.vertical || step.start === step.end ? 0 : Math.atan2(step.end[1] - step.start[1],
    Math.hypot(step.end[0] - step.start[0], step.end[2] - step.start[2]));
  return { position, yaw, pitch };
}
