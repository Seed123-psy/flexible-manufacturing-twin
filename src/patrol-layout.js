import { FILAMENT_DOCK } from './filament-exchange.js';
import { positions, productionLines } from './layout.js';
import { truckPark } from './logistics-layout.js';

import { rejectWarehouseCenter } from './reject-layout.js';

const at = (x, z) => [x, 0, z];
const distanceXZ = (a, b) => Math.hypot(b[0] - a[0], b[2] - a[2]);
const heading = (a, b) => Math.atan2(b[0] - a[0], b[2] - a[2]);
const interpolate = (a, b, fraction) => a.map((value, axis) => value + (b[axis] - value) * fraction);

export const FILAMENT_WAREHOUSE_CENTER = at(-11.45, -4.5);
export const FILAMENT_WAREHOUSE_FOOTPRINT = [2.5, 1.2];
export const FILAMENT_PICKUP = at(-10.85, -3.31);
export const PACKAGING_WAREHOUSE_CENTER = at(16.05, -4.32);
export const CHARGING_ZONE_CENTER = at(34.1, -3.00);

const rearA = -5.73;
export const PATROL_REAR_A_Z = -5.85; // Offset the rover's pivot from the filament rack.
const rearB = 6.60;
const westServiceX = -8.97;
const patrolWestX = -11.30;
const interlineZ = 4.70;
const interlineTurnX = 2.90;
const lineAAccessZ = 3.44;
const southAisle = 17.98;
const southWalkway = 19.87;
const logisticsAisleX = 22.90;
const warehouseWalkwayX = 23.53;
const eastWalkwayX = 37.85;
const northWalkwayZ = -8.85;
const cartonAccessX = 18.9;
const chargeAccessZ = -3.4;

// Use the polyline as authored, since smoothing a corner can cut into equipment.
export const FILAMENT_DELIVERY_ROUTES = Object.fromEntries(productionLines.flatMap(({ printers }, index) => printers.map((id) => {
  const [x, , printerZ] = positions[id];
  const aisle = index === 0 ? rearA : rearB;
  return [id, [FILAMENT_PICKUP, at(westServiceX, FILAMENT_PICKUP[2]), at(westServiceX, aisle), at(x, aisle), at(x, printerZ + FILAMENT_DOCK.z)]];
})));

const walk = (id, points, width = 1.20) => ({ id, points, width });
export const HUMAN_WALKWAYS = [
  walk('perimeter', [at(-13.87, lineAAccessZ), at(-12.55, lineAAccessZ), at(-12.55, southWalkway), at(18.60, southWalkway), at(18.60, 8.5), at(warehouseWalkwayX, 8.5), at(warehouseWalkwayX, -0.05)]),
  walk('filament-access', [at(-12.55, lineAAccessZ), at(-12.55, -2.95), at(-11.47, -2.95)]),
  walk('line-a-access', [at(-12.55, lineAAccessZ), at(-4.15, lineAAccessZ), at(-4.15, positions.boxes[2]), at(-3.40, positions.boxes[2])]),
  walk('line-b-access', [at(-12.55, 12.40), at(-4.15, 12.40), at(-4.15, 15.75), at(-3.40, 15.75)]),
  walk('qa-observation', [at(18.60, 10.30), at(19.95, 10.30)]),
  walk('east-service-perimeter', [at(warehouseWalkwayX, 8.5), at(eastWalkwayX, 8.5), at(eastWalkwayX, northWalkwayZ), at(cartonAccessX, northWalkwayZ)]),
  walk('carton-access', [at(cartonAccessX, northWalkwayZ), at(cartonAccessX, -4.95), at(17.70, -4.95)]),
  walk('charge-access', [at(eastWalkwayX, chargeAccessZ), at(34.55, chargeAccessZ)]),
];

export const HUMAN_CROSSINGS = [
  { id: 'filament-west', point: at(westServiceX, lineAAccessZ), angle: 0, width: 1.2, length: 1.8 },
  { id: 'patrol-a-west', point: at(patrolWestX, lineAAccessZ), angle: 0, width: 1.2, length: 1.35 },
  { id: 'patrol-west', point: at(patrolWestX, 12.40), angle: 0, width: 1.2, length: 1.8 },
  { id: 'patrol-logistics', point: at(logisticsAisleX, 8.5), angle: 0, width: 1.2, length: 1.8 },
  { id: 'carton-service-crossing', point: at(cartonAccessX, -7.0), angle: Math.PI / 2, width: 1.2, length: 2.2 },
  { id: 'charge-service-crossing', point: at(36.65, chargeAccessZ), angle: 0, width: 1.2, length: 2.2 },
];

const mark = (x, z, station = null, target = positions[station]) => ({ point: at(x, z), station, target });
const designCheckpoint = mark(-11.7, 2.10, 'design');
const interlineEntry = mark(patrolWestX, interlineZ);
const route = [
  designCheckpoint,
  mark(-11.7, -1.23, 'filamentWarehouse', FILAMENT_WAREHOUSE_CENTER),
  mark(westServiceX, -1.23), mark(westServiceX, PATROL_REAR_A_Z),
  ...productionLines[0].printers.map((id) => mark(positions[id][0], PATROL_REAR_A_Z, id)),
  mark(3.7, PATROL_REAR_A_Z, 'quality'), mark(13.55, PATROL_REAR_A_Z),
  mark(13.55, -4.32, 'packagingWarehouse', PACKAGING_WAREHOUSE_CENTER),
  mark(13.55, -2.10, 'scan'), mark(13.55, -0.65, 'presort'),
  mark(12.2, -0.65, 'buffer'), mark(7.0, -0.65, 'robot'),
  mark(13.55, -0.65), mark(13.55, PATROL_REAR_A_Z), mark(westServiceX, PATROL_REAR_A_Z),
  mark(westServiceX, -1.23), mark(patrolWestX, -1.23), interlineEntry,
  // Sweep the gap between A's carton plinth and B's filament traffic. Turn
  // back before A's carton bypass, then reach B's front from the west aisle.
  ...productionLines[1].printers.map((id) => mark(positions[id][0], interlineZ, id)),
  mark(0.65, interlineZ, 'boxes'),
  mark(interlineTurnX, interlineZ, 'quality2'), interlineEntry,
  mark(patrolWestX, southAisle), mark(-0.5, southAisle, 'boxes2'),
  mark(6.55, southAisle, 'robot2'), mark(10.4, southAisle, 'buffer2'),
  mark(16.55, southAisle), mark(16.55, 10.30, 'reject', rejectWarehouseCenter), mark(16.55, 7.20),
  mark(logisticsAisleX, 7.20), mark(logisticsAisleX, 5.45, 'dispatch', truckPark),
  mark(23.50, 3.14, 'sort'), mark(23.50, 1.82, 'staging'),
  mark(logisticsAisleX, -0.43, 'storage'), mark(29.90, 0.96),
  mark(31.40, 0.96, 'charge-01', CHARGING_ZONE_CENTER),
  mark(29.90, 0.96), mark(logisticsAisleX, -0.43), mark(23.50, 1.82), mark(23.50, 3.14), mark(logisticsAisleX, 7.2), mark(16.55, 7.20),
  mark(16.55, southAisle), mark(patrolWestX, southAisle), mark(patrolWestX, 2.10), designCheckpoint,
];
export const PATROL_WAYPOINTS = route;

// A 1.30 × 1.66 m inspection rover must clear about 1.06 m at a pivot.
export const PATROL_RADIUS = 1.06;
const speed = 4.4; // metres per simulation second
const scanTime = 1.18;
const turnRate = Math.PI * 2.3;
const angleDelta = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));

function makeCycle() {
  const segments = [];
  let elapsed = 0;
  let distance = 0;
  let yaw = heading(route.at(-2).point, route[0].point);
  const add = (step, duration) => {
    if (duration <= 0) return;
    segments.push({ ...step, start: elapsed, end: elapsed + duration, distance });
    elapsed += duration;
  };
  const turn = (point, nextYaw) => {
    const change = angleDelta(yaw, nextYaw);
    add({ kind: 'turn', from: point, to: point, yaw, yawDelta: change, length: 0 }, Math.abs(change) / turnRate);
    yaw += change;
  };
  for (let index = 0; index < route.length - 1; index++) {
    const node = route[index];
    const next = route[index + 1];
    if (node.station) {
      if (node.target) turn(node.point, heading(node.point, node.target));
      add({ kind: 'scan', from: node.point, to: node.point, yaw, length: 0, station: node.station }, scanTime);
    }
    turn(node.point, heading(node.point, next.point));
    const length = distanceXZ(node.point, next.point);
    add({ kind: 'travel', from: node.point, to: next.point, yaw, length }, length / speed);
    distance += length;
  }
  return { segments, seconds: elapsed, distance };
}
const cycle = makeCycle();
export const PATROL_CYCLE_SECONDS = cycle.seconds;

const pointInZone = (point, zone, radius) => distanceXZ(point, zone.point) <= radius;
function crossesZone(from, to, zone, radius) {
  const dx = to[0] - from[0];
  const dz = to[2] - from[2];
  const lengthSquared = dx * dx + dz * dz;
  const projection = lengthSquared ? ((zone.point[0] - from[0]) * dx + (zone.point[2] - from[2]) * dz) / lengthSquared : 0;
  return pointInZone(interpolate(from, to, Math.max(0, Math.min(1, projection))), zone, radius);
}

// Timed crossing reservations keep route sampling deterministic after a seek.
// Each blocker is { point, radius, start, end }, with a safe holding waypoint
// upstream of the reserved circle or no in-route static collision guarantee.
export function buildPatrolTimeline(duration, { blockers = [] } = {}) {
  const horizon = Number.isFinite(duration) ? Math.max(0, duration) : 0;
  const events = [];
  const segments = [];
  const routeIds = [...new Set(route.flatMap(({ station }) => station ? [station] : []))];
  const reservations = blockers.filter(({ point, radius, start, end }) => point && radius >= 0 && Number.isFinite(start) && Number.isFinite(end) && end > start);
  let cursor = 0;
  for (let lap = 0; cursor < horizon; lap++) {
    for (const [stepIndex, step] of cycle.segments.entries()) {
      if (cursor >= horizon) break;
      const stepDuration = step.end - step.start;
      if (step.kind === 'travel') {
        // Find the next interval that can be traversed in full. Recheck after
        // a delay, since a later reservation may then also overlap the move.
        let nextStart = cursor;
        while (true) {
          const blockedUntil = reservations.reduce((latest, blocker) => {
            if (blocker.end <= nextStart) return latest;
            const clearance = blocker.radius + PATROL_RADIUS;
            if (pointInZone(step.from, blocker, clearance) || !crossesZone(step.from, step.to, blocker, clearance)) return latest;
            // Keep the reservation until the next safe waypoint, including any
            // turns or scans whose stopping point is inside the crossing.
            let lastIndex = stepIndex;
            while (lastIndex + 1 < cycle.segments.length && pointInZone(cycle.segments[lastIndex].to, blocker, clearance)) {
              lastIndex += 1;
            }
            const traversal = cycle.segments[lastIndex].end - step.start;
            return blocker.start < nextStart + traversal ? Math.max(latest, blocker.end) : latest;
          }, nextStart);
          if (blockedUntil === nextStart) break;
          nextStart = blockedUntil;
        }
        if (nextStart > cursor) {
          segments.push({ ...step, kind: 'yield', from: step.from, to: step.from, length: 0, start: cursor, end: Math.min(horizon, nextStart), lap });
          cursor = nextStart;
          if (cursor >= horizon) break;
        }
      }
      const end = Math.min(horizon, cursor + stepDuration);
      const entry = { ...step, start: cursor, end, nominalEnd: cursor + stepDuration, lap };
      segments.push(entry);
      if (step.kind === 'scan') events.push({ start: cursor, end, lap, station: step.station, point: step.from, yaw: step.yaw, index: events.length });
      cursor += stepDuration;
    }
  }
  return { route: routeIds, cycleSeconds: cycle.seconds, events, segments, duration: horizon };
}

export function getPatrolFrame(time, timeline = null) {
  const seconds = Number.isFinite(time) ? Math.max(0, time) : 0;
  const lap = Math.floor(seconds / cycle.seconds);
  const sampledTime = timeline ? Math.min(seconds, timeline.duration) : seconds - lap * cycle.seconds;
  const segments = timeline?.segments ?? cycle.segments;
  let low = 0;
  let high = segments.length;
  while (low < high) {
    const center = (low + high) >>> 1;
    if (segments[center].end <= sampledTime) low = center + 1;
    else high = center;
  }
  const step = segments[low] ?? segments.at(-1);
  if (!step) return { point: route[0].point, yaw: 0, moving: false, scanning: false, station: null, lap: 0, distance: 0, yielding: false };
  const finished = Boolean(timeline && seconds >= timeline.duration);
  const fraction = Math.max(0, Math.min(1, (sampledTime - step.start) / ((step.nominalEnd ?? step.end) - step.start)));
  return {
    point: interpolate(step.from, step.to, fraction),
    yaw: step.yaw + (step.yawDelta ?? 0) * fraction,
    moving: !finished && step.kind === 'travel',
    scanning: !finished && step.kind === 'scan',
    station: !finished ? step.station ?? null : null,
    lap: step.lap ?? lap,
    distance: (step.lap ?? lap) * cycle.distance + step.distance + step.length * fraction,
    yielding: !finished && step.kind === 'yield',
  };
}
