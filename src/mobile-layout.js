import { positions } from './layout.js';
import { outboundDock, outboundStop } from './logistics-layout.js';
import { CHARGING_ZONE_CENTER, PACKAGING_WAREHOUSE_CENTER, PATROL_REAR_A_Z, PATROL_WAYPOINTS } from './patrol-layout.js';

// Points are [x, y, z]. Yaw is measured from +Z toward +X, in radians.
export const MOBILE_CHARGING_BAYS = [-0.86, 0.86].map((offset) =>
  [CHARGING_ZONE_CENTER[0] + offset, CHARGING_ZONE_CENTER[1] + 0.032, CHARGING_ZONE_CENTER[2]]);
export const MOBILE_CHARGING_YAW = 0;
// Outer service lane clears the rack, sorter and normal AGV work positions.
export const NORTH_CHARGE_AISLE = [[15.65, 0, -7.00], [36.65, 0, -7.00], [36.65, 0, -1.05]];
export const INBOUND_AGV_HOME = [19.90, 0, 0.37];
export const LOADING_ROBOT_HOME = [outboundStop[0], 0, outboundStop[2] + 1.27];
export const PACKAGING_ROBOT_HOME = [PACKAGING_WAREHOUSE_CENTER[0] + 0.33, 0, PACKAGING_WAREHOUSE_CENTER[2] - 1.50];

export const PACKAGING_DELIVERY_ROUTES = Object.fromEntries(['boxes', 'boxes2'].map((id) => {
  const [x, , z] = positions[id];
  const feederX = x - 1.66;
  const stop = [feederX, 0, z - 1.58];
  return [id, {
    tray: [feederX, 0.81, z - 0.87],
    points: [PACKAGING_ROBOT_HOME, [-9.60, 0, PACKAGING_ROBOT_HOME[2]], [-9.60, 0, stop[2]], stop],
  }];
}));

export const MOBILE_FLEET_POSES = {
  inboundAgv: {
    home: INBOUND_AGV_HOME, yaw: -Math.PI / 2,
    parking: { primary: [16.65, 0, 0.25], backup: [18.15, 0, -2.00] }, parkingYaw: Math.PI / 2,
  },
  outboundAgv: {
    home: outboundDock, yaw: Math.PI / 2,
    parking: { primary: [32.90, 0, 2.45], backup: [35.40, 0, 2.45] }, parkingYaw: Math.PI / 2,
  },
  loadingRobot: {
    home: LOADING_ROBOT_HOME, yaw: Math.PI,
    parking: { primary: [29.45, 0, 2.67], backup: [31.25, 0, 2.67] }, parkingYaw: Math.PI / 2,
  },
  packagingRobot: {
    home: PACKAGING_ROBOT_HOME, yaw: 0,
    // Each recessed standby berth has its own floor contact charger.
    chargeAtParking: true,
    parking: { primary: [16.05, 0, -8.85], backup: [14.50, 0, -8.85] }, parkingYaw: 0,
  },
  inspectionRobot: {
    home: PATROL_WAYPOINTS[0].point, yaw: Math.atan2(
      PATROL_WAYPOINTS[0].point[0] - PATROL_WAYPOINTS.at(-2).point[0],
      PATROL_WAYPOINTS[0].point[2] - PATROL_WAYPOINTS.at(-2).point[2],
    ),
    parking: { primary: [-16.65, 0, -2.40], backup: [-18.65, 0, -2.40] }, parkingYaw: 0,
  },
};

const at = (x, z) => [x, 0, z];
const roverAccess = (parking) => [parking, at(parking[0], -4.65), at(-14.75, -4.65),
  at(-14.75, -2.20), at(-11.70, -2.20)];

export function routeToChargingBay(fleet, parking, berth) {
  const [x, , z] = parking;
  const [bayX] = berth;
  const [northEntry, ...eastLane] = NORTH_CHARGE_AISLE;
  const exitZ = eastLane.at(-1)[2];
  const northExit = [...eastLane, at(bayX, exitZ), berth];
  if (fleet === 'inspectionRobot') return [...roverAccess(parking), at(-11.70, -1.23), at(-8.97, -1.23),
    at(-8.97, PATROL_REAR_A_Z), at(13.90, PATROL_REAR_A_Z), at(14.40, -6.16), northEntry, ...northExit];
  if (fleet === 'inboundAgv') {
    const access = z > 0 ? [at(15.70, z), at(15.70, -2.40), at(13.92, -2.40)] : [at(13.92, z)];
    return [parking, ...access, at(13.92, -5.98), at(14.70, -6.46), northEntry, ...northExit];
  }
  if (fleet === 'loadingRobot') return [parking, at(x, 0.85), at(32.65, 0.85), at(32.65, exitZ), at(bayX, exitZ), berth];
  return [parking, at(x, exitZ), at(bayX, exitZ), berth];
}

export function routeForHandoff(fleet, home, parking) {
  if (fleet === 'inspectionRobot') return [home, ...roverAccess(parking).reverse()];
  if (fleet === 'inboundAgv') {
    // The lead-in east of home keeps the return turn clear of the sorter legs.
    if (parking[2] > 0) {
      return [home, at(20.29, 0.34), at(20.40, 0.08), at(19.01, -0.05), at(17.81, 0.21), parking];
    }
    return [home, at(20.23, 0.33), at(20.27, 0.10), at(18.75, 0.24), at(18.18, -0.70), at(17.98, -1.40), parking];
  }
  if (fleet === 'outboundAgv') {
    // Keep the standby traffic south of the charge lanes, past the warehouse takeoff.
    return [home, at(31.85, -0.20), at(parking[0], 0.65), parking];
  }
  if (fleet === 'loadingRobot') return [home, at(28.0, 3.08), at(28.75, 1.34), at(parking[0], 1.34), parking];
  if (fleet === 'packagingRobot') return [home, at(parking[0], -7.00), parking];
  return [home, parking];
}
