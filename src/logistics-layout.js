export const logisticsCenter = [23.15, 0.75, 0.25];
export const rollerTop = 0.633;
export const sortInlet = [16.58, rollerTop, 2.65];
export const sortJunction = [18.15, rollerTop, 2.65];
export const sortPorts = [[19.82, rollerTop, 1.65], [19.82, rollerTop, 3.65]];
// Expanded AS/RS footprint: independent inbound and outbound transfer ends.
export const rackInlet = [19.72, rollerTop, -1.45];
export const rackOutlet = [29.18, rollerTop, -1.45];
// AGV centers stop east of the rack handoff stands, beyond their support legs.
export const inboundDock = [21.02, 0, -1.45];
// Align the reachable roller handoff with the outbound aisle.
export const outboundDock = [30.25, 0, -1.24];
export const outboundStop = [26.35, 0, 1.99];
export const truckPark = [25.9, 0, 4.7];
export const truckTravel = 16.95;
export const DISPATCH_TRUCK_EXTENTS = { rear: -1.76, front: 2.32, halfWidth: 0.94, height: 1.82 };
export const DISPATCH_ROAD_WIDTH = 2.64;
export const DISPATCH_APRON_END = truckPark[0] + truckTravel + DISPATCH_TRUCK_EXTENTS.front + 0.40;
export const rackRailZ = -2.40;
export const warehouseWaveSize = 6;
export const rackColumns = Array.from({ length: 10 }, (_, index) => 19.72 + index * 0.94);
export const rackLevels = Array.from({ length: 7 }, (_, index) => 0.72 + index * 0.62);
export const warehouseCapacity = rackColumns.length * rackLevels.length;
export const truckDeck = 0.66;
export const shippingPalletHeight = 0.062;
export const loadingEdgeZ = 3.93;

export function warehouseAddress(slot) {
  const index = Number.isInteger(slot) ? Math.max(0, Math.min(warehouseCapacity - 1, slot)) : 0;
  return `${index % 2 === 0 ? 'A' : 'B'}-${String(Math.floor(index / 2) + 1).padStart(2, '0')}`;
}

export function loadingRobotDrop(slot) {
  const [x, y] = shippingSlot(slot);
  return [x, y, loadingEdgeZ];
}

export function loadingRobotTransfer(slot) {
  const [x, , z] = loadingRobotDrop(slot);
  return [x, 0, z - 0.74];
}

export function shippingSlot(slot) {
  return [truckPark[0] + (slot % 3 - 1) * 0.604,
    truckDeck + shippingPalletHeight, truckPark[2] + (slot < 3 ? 0.285 : -0.257)];
}
