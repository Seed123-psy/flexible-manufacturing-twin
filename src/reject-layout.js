// Shared survey coordinates for the isolated southeast reject transfer cell.
export const rejectWarehouseCenter = [23.18, 0, 11.12];
export const REJECT_ZONE_SIZE = [6.30, 3.20];
export const REJECT_LINK_HEIGHT = 3.45;
export const REJECT_LIFT_DECK_SIZE = 0.86;
export const REJECT_HANDOFF_GAP = 0.018;
export const REJECT_LIFT_LOW = 0.633;
export const REJECT_ORIGIN = [12.0, REJECT_LIFT_LOW, 5.05];
export const REJECT_INTAKE_LIFT = [21.20, REJECT_LIFT_LOW, 10.30];
export const REJECT_INTAKE = [22.53, REJECT_LIFT_LOW, REJECT_INTAKE_LIFT[2]];
export const REJECT_ELBOWS = [[12.0, REJECT_LINK_HEIGHT, 7.2], [REJECT_INTAKE_LIFT[0], REJECT_LINK_HEIGHT, 7.2]];
export const REJECT_LIFTS = [REJECT_ORIGIN, REJECT_INTAKE_LIFT];
export const REJECT_RACK_SLOTS = Array.from({ length: 8 }, (_, i) =>
  [23.0 + (i % 4) * 0.80, 0.69, 10.98 + Math.floor(i / 4) * 0.74]);
export const REJECT_TRUCK_PARK = [24.05, 0, 14.68];
export const REJECT_TRUCK_EXIT = [42.35, 0, REJECT_TRUCK_PARK[2]];
export const REJECT_TRUCK_EXTENTS = { rear: -1.78, front: 2.69, halfWidth: 1.18, height: 1.78 };
export const REJECT_ROAD_WIDTH = 2.78;
export const REJECT_APRON_END = REJECT_TRUCK_EXIT[0] + REJECT_TRUCK_EXTENTS.front + 0.36;
export const REJECT_CARGO_SLOTS = Array.from({ length: 12 }, (_, i) => [
  REJECT_TRUCK_PARK[0] - 1.20 + (i % 4) * 0.80,
  0.71, REJECT_TRUCK_PARK[2] - 0.72 + Math.floor(i / 4) * 0.72,
]);
export const REJECT_GANTRY_RAILS = [22.02, 26.55];
export const REJECT_GANTRY_Z = [9.95, 16.27];
export const REJECT_GANTRY_HOME = [22.53, 2.04, 11.65];
export const REJECT_GANTRY_BEAM = 2.98;
export const REJECT_TRUCK_SECONDS = 11;
export const REJECT_OFFSITE_SECONDS = 18;
export const REJECT_LIFT_SPEED = 1.45;
