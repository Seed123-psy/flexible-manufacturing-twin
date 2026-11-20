import * as THREE from 'three';
import { CHARGING_ZONE_CENTER, PACKAGING_WAREHOUSE_CENTER, getPatrolFrame } from './patrol-layout.js';
import {
  LOADING_ROBOT_HOME, MOBILE_CHARGING_BAYS, MOBILE_CHARGING_YAW, MOBILE_FLEET_POSES,
  PACKAGING_DELIVERY_ROUTES, PACKAGING_ROBOT_HOME,
} from './mobile-layout.js';
import { followAgvDrive, intakeDrives, outboundDrive, returnIn, sampleAgvDrive, shortestTurn } from './logistics-drive.js';
import { makeCarton } from './models.js';
import { makeAgv, makeChargingStation, makeHandlingRobot, makeInspectionRobot, makeBoxRobotChargingDock } from './mobile-robots.js';
import { rackSlots } from './logistics-platform.js';
import {
  inboundDock, loadingRobotDrop, loadingRobotTransfer, outboundDock, outboundStop, rackInlet, rackOutlet,
  rackRailZ, shippingPalletHeight, shippingSlot, sortInlet, sortJunction, sortPorts,
  truckDeck, truckPark, truckTravel, warehouseWaveSize,
} from './logistics-layout.js';

const dockHeight = sortInlet[1];
const east = Math.PI / 2;
const up = new THREE.Vector3(0, 1, 0);
const craneHome = [24.2, dockHeight, rackRailZ];
const humanHome = LOADING_ROBOT_HOME;
const carryHeight = 0.84;
const idleFrame = { motion: 'idle', phaseProgress: 0, unit: null };
const boxWarehouseCenter = PACKAGING_WAREHOUSE_CENTER;
const boxSupplyHome = PACKAGING_ROBOT_HOME;
const boxPickup = [boxWarehouseCenter[0], 0.81, boxWarehouseCenter[2] - 0.85];
const boxCarry = [0, 1.07, 0.64];
const blend = (start, end, p) => start.map((value, axis) => THREE.MathUtils.lerp(value, end[axis], p));
const ease = (p, start = 0, end = 1) => THREE.MathUtils.smoothstep(p, start, end);
const atHeight = (point, y) => [point[0], y, point[2]];

function polyline(points) {
  const curve = new THREE.CurvePath();
  for (let i = 1; i < points.length; i++) {
    const from = new THREE.Vector3(...points[i - 1]);
    const to = new THREE.Vector3(...points[i]);
    if (!from.equals(to)) curve.add(new THREE.LineCurve3(from, to));
  }
  return curve;
}

function followAisle(curve, progress, startYaw, endYaw) {
  const p = THREE.MathUtils.clamp(progress, 0, 1);
  const point = curve.getPoint(p).toArray();
  // Look across the turn while keeping the base exactly on the clearance-checked waypoints.
  const before = curve.getPoint(Math.max(p - 0.012, 0));
  const after = curve.getPoint(Math.min(p + 0.012, 1));
  let yaw = Math.atan2(after.x - before.x, after.z - before.z);
  if (startYaw != null) yaw = shortestTurn(startYaw, yaw, ease(p, 0, 0.10));
  if (endYaw != null) yaw = shortestTurn(yaw, endYaw, ease(p, 0.91, 1));
  return { point, yaw, distance: p * curve.getLength() };
}

const packagingRoutes = Object.fromEntries(Object.entries(PACKAGING_DELIVERY_ROUTES).map(([id, { tray, points }]) =>
  [id, { tray, outbound: polyline(points), inbound: polyline(points.slice().reverse()) }]));

const paper = new THREE.MeshStandardMaterial({ color: 0xcd9966, roughness: 0.88 });
const kraftEdge = new THREE.MeshStandardMaterial({ color: 0xa86739, roughness: 0.88 });
const trayMetal = new THREE.MeshStandardMaterial({ color: 0x366d72, metalness: 0.55, roughness: 0.53 });
const blankShape = new THREE.BoxGeometry(0.52, 0.013, 0.34);
const trayShape = new THREE.BoxGeometry(0.64, 0.055, 0.43);
const legShape = new THREE.BoxGeometry(0.043, 0.75, 0.043);

function makePaperStack(count) {
  const stack = new THREE.Group();
  for (let index = 0; index < count; index++) {
    const blank = new THREE.Mesh(blankShape, index % 4 === 0 ? kraftEdge : paper);
    blank.position.set((index % 3 - 1) * 0.012, index * 0.014, 0);
    blank.castShadow = true;
    stack.add(blank);
  }
  return stack;
}

function makeRefillTray(parent, point, name) {
  const tray = new THREE.Group();
  tray.name = name;
  tray.position.set(...point);
  const top = new THREE.Mesh(trayShape, trayMetal);
  top.position.y = -0.04;
  top.castShadow = true;
  tray.add(top);
  for (const x of [-0.27, 0.27]) for (const z of [-0.17, 0.17]) {
    const leg = new THREE.Mesh(legShape, trayMetal);
    leg.position.set(x, -0.432, z);
    tray.add(leg);
  }
  const stack = makePaperStack(10);
  tray.add(stack);
  parent.add(tray);
  return stack;
}

function keyframe(frames, progress) {
  const i = frames.findIndex(([time]) => time >= progress);
  if (i <= 0) return frames[i === -1 ? frames.length - 1 : 0][1];
  const [start, first] = frames[i - 1];
  const [end, next] = frames[i];
  return blend(first, next, ease(progress, start, end));
}

function craneTrajectory(slot, retrieving, p) {
  const port = retrieving ? rackOutlet : rackInlet;
  const staging = [port[0], port[1], rackRailZ];
  const level = slot[1] + 0.046;
  const shelfFront = [slot[0], level, rackRailZ];
  const raised = atHeight(slot, level);
  const lifted = atHeight(staging, level);
  if (retrieving) {
    const fork = keyframe([[0, craneHome], [0.15, shelfFront], [0.28, slot], [0.37, raised],
      [0.50, shelfFront], [0.61, lifted], [0.70, staging], [0.83, port],
      [0.88, atHeight(port, port[1] - 0.028)], [0.94, atHeight(staging, staging[1] - 0.028)], [1, craneHome]], p);
    return { fork, cargo: p < 0.28 ? slot : p > 0.83 ? port : fork };
  }
  const fork = keyframe([[0, craneHome], [0.13, staging], [0.25, port], [0.36, staging],
    [0.45, lifted], [0.60, shelfFront], [0.72, raised], [0.80, slot], [0.86, atHeight(slot, slot[1] - 0.028)],
    [0.94, atHeight(shelfFront, slot[1] - 0.028)], [1, craneHome]], p);
  return { fork, cargo: p < 0.25 ? port : p > 0.80 ? slot : fork };
}

function makeShippingPallet() {
  const pallet = new THREE.Group();
  const board = new THREE.MeshStandardMaterial({ color: 0x927048, roughness: 0.84 });
  const brace = new THREE.MeshStandardMaterial({ color: 0x645240, roughness: 0.83 });
  const slat = new THREE.BoxGeometry(1.82, 0.025, 0.158);
  for (let i = 0; i < 7; i++) {
    const part = new THREE.Mesh(slat, board);
    part.position.set(0, shippingPalletHeight - 0.0125, (i - 3) * 0.167);
    part.receiveShadow = true;
    part.castShadow = true;
    pallet.add(part);
  }
  const skid = new THREE.BoxGeometry(0.14, shippingPalletHeight - 0.025, 1.16);
  for (const x of [-0.73, 0, 0.73]) {
    const part = new THREE.Mesh(skid, brace);
    part.position.set(x, (shippingPalletHeight - 0.025) / 2, 0);
    pallet.add(part);
  }
  pallet.position.y = truckDeck;
  return pallet;
}

export function createLogisticsMotion(scene, platform) {
  const inbound = makeAgv({ id: 'AGV-IN-01' });
  const inboundBackup = makeAgv({ id: 'AGV-IN-02' });
  const outbound = makeAgv({ id: 'AGV-OUT-01' });
  const outboundBackup = makeAgv({ id: 'AGV-OUT-02' });
  const human = makeHandlingRobot({ id: 'LOAD-01' });
  const humanBackup = makeHandlingRobot({ id: 'LOAD-02' });
  const boxSupplyRobot = makeHandlingRobot({ id: 'BOX-01', floorCharging: true });
  const boxSupplyBackup = makeHandlingRobot({ id: 'BOX-02', floorCharging: true });
  const chargingStation = makeChargingStation();
  const boxParking = MOBILE_FLEET_POSES.packagingRobot.parking;
  const boxDocks = [boxSupplyRobot, boxSupplyBackup].map(({ group }, index) => {
    const dock = makeBoxRobotChargingDock(group.name, index === 0 ? boxParking.primary : boxParking.backup);
    scene.add(dock.group);
    return dock;
  });
  const inspectionRobot = makeInspectionRobot({ id: 'INSP-01' });
  const inspectionBackup = makeInspectionRobot({ id: 'INSP-02' });
  const shipmentPallet = makeShippingPallet();
  const warehouseStock = makeRefillTray(scene, boxPickup, 'Warehouse paper blank pickup');
  const lineStock = Object.fromEntries(Object.entries(packagingRoutes).map(([id, { tray }]) =>
    [id, makeRefillTray(scene, tray, id + ' line-side paper stock')]));
  const boxSupplyCargo = makePaperStack(10);
  boxSupplyCargo.name = 'Packaging refill batch';
  scene.add(boxSupplyCargo);
  chargingStation.group.position.set(...CHARGING_ZONE_CENTER);
  const parcels = new THREE.Group();
  parcels.name = 'Warehouse carton transfers';
  platform.truck.add(shipmentPallet);
  boxSupplyRobot.group.userData.role = 'packaging box replenishment robot';
  boxSupplyBackup.group.userData.role = boxSupplyRobot.group.userData.role;
  scene.add(inbound.group, inboundBackup.group, outbound.group, outboundBackup.group, human.group, humanBackup.group, boxSupplyRobot.group, boxSupplyBackup.group, chargingStation.group, inspectionRobot.group, inspectionBackup.group, parcels);
  let currentOrder;
  let sortedBox;
  let storedBox;
  let outboundHoldBox;
  let dispatchedBox;
  let inventory = [];
  let shipment = [];
  let time = 0;

  // The factory's lighting toggle changes this group before it requests a redraw.
  // Read it in the model update so the same switch works during paused playback.
  const nightWorkLights = scene.getObjectByName('Night shift work lights');
  let nightMode;
  function syncNightMode() {
    if (!nightWorkLights || nightMode === nightWorkLights.visible) return;
    nightMode = nightWorkLights.visible;
    scene.traverse((object) => object.userData.setNightMode?.(nightMode));
  }

  const routeCache = new WeakMap();
  let chargingByRobot = new Map();

  function updateCharging(sim) {
    const agents = new Map();
    for (const fleet of Object.values(sim?.battery?.fleets ?? {})) {
      for (const agent of [fleet.primary, fleet.backup]) {
        if (agent) agents.set(agent.id, { agent, fleet });
      }
    }
    const intervals = sim?.charging?.intervals ?? [];
    const bayStatus = [];
    chargingByRobot = new Map();
    for (const entry of sim?.charging?.active ?? []) {
      const id = typeof entry === 'string' ? entry : entry.id ?? entry.agent;
      const snapshot = agents.get(id);
      const interval = intervals.find((reservation) => reservation.agent === id) ?? snapshot?.agent.interval;
      const bay = entry.bay ?? interval?.bay;
      if (!chargingStation.berths[bay]) continue;
      const status = {
        id, bay, phase: entry.phase ?? interval?.kind ?? 'charging',
        position: entry.position ?? interval?.route?.to?.position,
        battery: snapshot ? batteryLevel(snapshot.fleet, snapshot.agent) : null,
      };
      chargingByRobot.set(id, status);
      bayStatus.push(status);
    }
    for (const { agent, fleet } of agents.values()) {
      const interval = agent.interval;
      if (chargingByRobot.has(agent.id) || !chargingStation.berths[interval?.bay]) continue;
      // A bay transit can overlap another agent's charging window. A docked agent has display priority.
      if (['approach', 'return', 'charging', 'exit'].includes(interval.kind)) {
        bayStatus.push({ id: agent.id, bay: interval.bay, phase: interval.kind, battery: batteryLevel(fleet, agent) });
      }
    }
    chargingStation.pose({ time, active: bayStatus });
  }

  function fleetFor(sim, key) {
    return sim?.battery?.fleets?.[key];
  }

  function batteryLevel(fleet, agent) {
    return THREE.MathUtils.clamp((agent?.battery ?? fleet?.capacity ?? 100) / (fleet?.capacity ?? 100), 0, 1);
  }

  function mobilePose(fleet, agent, index, key, work) {
    const charge = chargingByRobot.get(agent?.id);
    const interval = agent?.interval;
    const route = interval?.route;
    const power = { battery: batteryLevel(fleet, agent), charging: false };
    const agentStatus = agent?.status;
    const layout = MOBILE_FLEET_POSES[key];
    if (interval?.kind === 'charging' || charge?.phase === 'charging') {
      const bay = interval?.bay ?? charge?.bay;
      const point = charge?.position ?? MOBILE_CHARGING_BAYS[bay] ?? interval?.route.to.position;
      if (point) return { point, yaw: bay == null ? layout.parkingYaw : MOBILE_CHARGING_YAW,
        moving: false, distance: 0, power: { ...power, charging: true } };
    }
    if (interval && interval.kind !== 'work' && route?.points?.length > 1) {
      if (!routeCache.has(route)) routeCache.set(route, polyline(route.points));
      const curve = routeCache.get(route);
      if (curve.curves.length) {
        const { yaw, parkingYaw } = layout;
        const startYaw = { 'handoff-out': yaw, return: parkingYaw, exit: MOBILE_CHARGING_YAW, 'handoff-in': parkingYaw }[interval.kind];
        const endYaw = { 'handoff-out': parkingYaw, return: MOBILE_CHARGING_YAW, exit: parkingYaw, 'handoff-in': yaw }[interval.kind];
        const pose = followAisle(curve, agent.progress, startYaw, endYaw);
        return { ...pose, moving: true, power };
      }
    }
    const working = !fleet ? index === 0 : fleet.active === agent?.id &&
      (agentStatus === 'working' || agentStatus === 'standby');
    if (working) return { ...work, working: true, power };
    const role = index === 0 ? 'primary' : 'backup';
    return { point: agent?.location?.position ?? layout.parking[role], yaw: layout.parkingYaw,
      moving: false, distance: 0, power };
  }

  function moveAgvPair(vehicles, sim, key, work) {
    const fleet = fleetFor(sim, key);
    vehicles.forEach((vehicle, index) => {
      const agent = index === 0 ? fleet?.primary : fleet?.backup;
      const pose = mobilePose(fleet, agent, index, key, work);
      vehicle.group.userData.agentId = agent?.id ?? vehicle.group.name;
      moveVehicle(vehicle, pose.point, pose.yaw, pose.deck ?? vehicle.deckHeight,
        pose.working && work.loaded, pose.moving, pose.distance, pose.working ? work.rollerTravel : 0, pose.power);
    });
  }

  function moveHandlingPair(robots, sim, key, work) {
    const fleet = fleetFor(sim, key);
    robots.forEach((robot, index) => {
      const agent = index === 0 ? fleet?.primary : fleet?.backup;
      const pose = mobilePose(fleet, agent, index, key, work);
      robot.group.userData.agentId = agent?.id ?? robot.group.name;
      robot.group.position.set(...pose.point);
      robot.group.rotation.y = pose.yaw;
      const target = pose.working && work.target ? robot.group.worldToLocal(new THREE.Vector3(...work.target)) : undefined;
      robot.pose({ motion: target ? 'carry' : 'idle', progress: pose.working ? work.progress : 0.5,
        time, target, gripWidth: 0.58, walking: pose.moving, stride: pose.distance * 9, ...pose.power });
    });
  }

  function animateInspection(sim) {
    const inspection = sim?.inspection;
    const timeline = sim?.timeline?.mobile?.inspection;
    const sharedFrame = inspection?.frame ?? (inspection?.point ? inspection : null);
    const frame = sharedFrame ?? getPatrolFrame(time, timeline?.segments ? timeline : null);
    const fleet = fleetFor(sim, 'inspectionRobot');
    const workingFrame = sim && !sim.complete ? frame : { ...frame, scanning: false, moving: false };
    [inspectionRobot, inspectionBackup].forEach((robot, index) => {
      const agent = index === 0 ? fleet?.primary : fleet?.backup;
      const pose = mobilePose(fleet, agent, index, 'inspectionRobot', workingFrame);
      robot.group.userData.agentId = agent?.id ?? robot.group.name;
      robot.group.userData.station = pose.working ? workingFrame.station : null;
      robot.group.position.set(...pose.point);
      robot.group.rotation.y = pose.yaw;
      robot.pose({ time, moving: pose.moving, distance: pose.distance, scanning: pose.working && workingFrame.scanning,
        yielding: pose.working && workingFrame.yielding, ...pose.power });
    });
  }

  function ensureOrder(order) {
    if (currentOrder === order) return;
    currentOrder = order;
    parcels.clear();
    shipment.forEach((item) => platform.truck.remove(item));
    sortedBox = makeCarton(order, true);
    storedBox = makeCarton(order, true);
    dispatchedBox = makeCarton(order, true);
    outboundHoldBox = makeCarton(order, true);
    outboundHoldBox.name = 'Outbound dock waiting parcel';
    outboundHoldBox.position.set(...rackOutlet);
    sortedBox.name = 'AGV inbound parcel';
    storedBox.name = 'Stacker parcel';
    dispatchedBox.name = 'AGV outbound parcel';
    inventory = rackSlots.map((point) => {
      const item = makeCarton(order, true);
      item.position.set(...point);
      return item;
    });
    shipment = Array.from({ length: warehouseWaveSize }, (_, slot) => {
      const parcel = makeCarton(order, true);
      const [x, y, z] = shippingSlot(slot);
      parcel.position.set(x - truckPark[0], y, z - truckPark[2]);
      platform.truck.add(parcel);
      return parcel;
    });
    parcels.add(sortedBox, storedBox, dispatchedBox, outboundHoldBox, ...inventory);
  }

  function moveVehicle(vehicle, point, yaw, deck, loaded = false, moving = false, distance = 0, rollerTravel = 0, power = {}) {
    vehicle.group.position.set(...point);
    vehicle.group.rotation.y = yaw;
    vehicle.pose({ deckHeight: deck, loaded, moving, distance, time, rollerTravel,
      battery: power.battery ?? 1, charging: Boolean(power.charging) });
  }

  function sort(frame, sim) {
    const { motion, phaseProgress: p, unit } = frame;
    const lane = Number.isInteger(frame.lane) ? frame.lane : (unit - 1) % 2;
    const port = sortPorts[lane];
    const route = intakeDrives[lane];
    const low = inbound.deckHeight;
    let point = MOBILE_FLEET_POSES.inboundAgv.home;
    let yaw = -east;
    let deck = low;
    let pose;
    let cargo;
    let cargoYaw = 0;
    let dock;
    if (motion === 'divert') {
      cargo = keyframe([[0, sortInlet], [0.37, sortJunction],
        [0.61, [sortJunction[0], dockHeight, port[2]]], [1, port]], p);
    } else if (motion === 'wait-agv' || motion === 'approach-in') {
      cargo = port;
      if (motion === 'approach-in') pose = sampleAgvDrive(route.approach, p, -east, east);
    } else if (motion === 'dock-in') {
      point = route.stop;
      yaw = east;
      deck = THREE.MathUtils.lerp(low, dockHeight, ease(p, 0, 0.28) - ease(p, 0.72, 1));
      cargo = blend(port, atHeight(point, deck), ease(p, 0.29, 0.72));
      dock = lane === 0 ? 'A' : 'B';
    } else if (motion === 'drive-in') {
      pose = sampleAgvDrive(route.lane, p, east, east);
      cargo = atHeight(pose.point, deck);
      cargoYaw = pose.yaw - east;
    } else if (motion === 'rack-dock') {
      point = inboundDock;
      yaw = east;
      deck = THREE.MathUtils.lerp(low, dockHeight, ease(p, 0, 0.30) - ease(p, 0.86, 1));
      cargo = blend(atHeight(point, deck), rackInlet, ease(p, 0.32, 0.85));
      dock = 'inbound';
    } else if (motion === 'return-in') {
      pose = sampleAgvDrive(returnIn, p, east, -east);
    }
    if (pose) ({ point, yaw } = pose);
    moveAgvPair([inbound, inboundBackup], sim, 'inboundAgv', { point, yaw, deck,
      loaded: Boolean(cargo && ['dock-in', 'drive-in', 'rack-dock'].includes(motion)), moving: Boolean(pose),
      distance: pose?.distance ?? 0, rollerTravel: dock ? cargo[0] - point[0] : 0 });
    sortedBox.visible = Boolean(cargo);
    if (cargo) {
      sortedBox.position.set(...cargo);
      sortedBox.rotation.y = cargoYaw;
    }
    return dock;
  }

  function store(frame) {
    const active = frame.motion === 'putaway' || frame.motion === 'retrieve';
    let fork = craneHome;
    if (active) {
      const slot = rackSlots[frame.slot ?? ((frame.unit - 1) % rackSlots.length)];
      const trajectory = craneTrajectory(slot, frame.motion === 'retrieve', frame.phaseProgress);
      fork = trajectory.fork;
      storedBox.position.set(...trajectory.cargo);
    }
    storedBox.visible = active;
    return { x: fork[0], y: fork[1], z: fork[2], active, cargoWidth: storedBox.userData.size.width };
  }


  function animateBoxSupply(sim) {
    const packaging = sim?.packaging;
    const delivery = packaging?.delivery;
    const route = packagingRoutes[delivery?.station];
    const amount = THREE.MathUtils.clamp(delivery?.amount ?? 0, 0, boxSupplyCargo.children.length);
    const transferring = Boolean(route && amount);
    const p = THREE.MathUtils.clamp(delivery?.phaseProgress ?? 0, 0, 1);
    const picking = transferring && delivery.phase === 'pickup';
    const delivering = transferring && delivery.phase === 'delivery';
    const returning = transferring && delivery.phase === 'return';
    const pickupLift = picking && p >= 0.34;
    const placing = delivering && p >= 0.88;

    const work = { point: boxSupplyHome, yaw: 0, distance: 0, moving: false };
    if (delivering) Object.assign(work, followAisle(route.outbound, Math.min(p / 0.88, 1), 0, 0), { moving: !placing });
    if (returning) Object.assign(work, followAisle(route.inbound, p, 0, 0), { moving: true });

    const fleet = fleetFor(sim, 'packagingRobot');
    boxSupplyCargo.visible = false;
    let batchInTransit = false;
    [boxSupplyRobot, boxSupplyBackup].forEach((robot, index) => {
      const agent = index === 0 ? fleet?.primary : fleet?.backup;
      const pose = mobilePose(fleet, agent, index, 'packagingRobot', work);
      const dock = boxDocks[index];
      const parked = !pose.moving && pose.point[0] === dock.group.position.x && pose.point[2] === dock.group.position.z;
      dock.update({ parked, ...pose.power });
      robot.group.userData.agentId = agent?.id ?? robot.group.name;
      robot.group.position.set(...pose.point);
      if (parked) robot.group.position.y += 0.004;
      robot.group.rotation.y = pose.yaw;
      let target;
      let motion = 'idle';
      if (pose.working && (picking || delivering)) {
        const carryPoint = new THREE.Vector3(...boxCarry).applyAxisAngle(up, pose.yaw).add(robot.group.position);
        const batchPoint = picking ? new THREE.Vector3(...boxPickup) : carryPoint.clone();
        if (pickupLift) batchPoint.lerp(carryPoint, ease(p, 0.34, 1));
        if (placing) batchPoint.lerp(new THREE.Vector3(...route.tray), ease(p, 0.88, 1));
        target = robot.group.worldToLocal(batchPoint.clone());
        target.y += (amount - 1) * 0.007;
        motion = picking ? 'pick' : placing ? 'place' : 'carry';
        if (pickupLift || delivering) {
          batchInTransit = true;
          boxSupplyCargo.visible = true;
          boxSupplyCargo.position.copy(batchPoint);
          boxSupplyCargo.rotation.y = pose.yaw;
        }
      }
      robot.pose({ motion, progress: pose.working ? p : agent?.progress ?? 0.5,
        time, target, gripWidth: 0.46, walking: pose.moving, stride: pose.distance * 9, ...pose.power });
    });

    // The pickup tray stages one batch. Reserve stock is displayed by the warehouse itself.
    const warehouseAmount = batchInTransit || returning ? 0 : picking ? amount : packaging?.warehouseStock ?? 10;
    warehouseStock.children.forEach((blank, index) => { blank.visible = index < warehouseAmount; });
    boxSupplyCargo.children.forEach((blank, index) => { blank.visible = index < amount; });
    for (const [id, stack] of Object.entries(lineStock)) {
      const stock = packaging?.lineStock?.[id] ?? 10;
      stack.children.forEach((blank, index) => { blank.visible = index < stock; });
    }
  }

  function dispatch(frame, finished, sim) {
    const { motion, phaseProgress: p, unit } = frame;
    const truckSlot = Number.isInteger(frame.truckSlot) ? frame.truckSlot : (unit - 1) % warehouseWaveSize;
    const slotIndex = unit ? truckSlot : 0;
    const slot = shippingSlot(slotIndex);
    const drop = loadingRobotDrop(slotIndex);
    const loadPose = loadingRobotTransfer(slotIndex);
    const low = outbound.deckHeight;
    let point = outboundDock;
    let yaw = east;
    let deck = low;
    let pose;
    let cargo;
    let cargoYaw = 0;
    let humanPoint = humanHome;
    let humanYaw = Math.PI;
    let handling = false;
    let walking = false;
    let gripOffset = 0;
    let stride = 0;
    let door = 1;
    let travel = finished ? 1 : 0;

    if (motion === 'dock-out') {
      deck = THREE.MathUtils.lerp(low, dockHeight, ease(p, 0, 0.27) - ease(p, 0.75, 1));
      cargo = blend(rackOutlet, atHeight(outboundDock, deck), ease(p, 0.28, 0.74));
    } else if (motion === 'drive-out') {
      pose = sampleAgvDrive(outboundDrive, p, east, -east);
      cargo = atHeight(pose.point, deck);
      cargoYaw = pose.yaw - east;
    } else if (motion === 'human-grab') {
      point = outboundStop;
      yaw = -east;
      cargo = [point[0], THREE.MathUtils.lerp(low, carryHeight, ease(p, 0.50, 1)), point[2] + 0.49 * ease(p, 0.08, 0.48)];
      cargoYaw = Math.PI;
      handling = true;
      gripOffset = (1 - ease(p, 0.20, 0.47)) * 0.16;
    } else if (motion === 'human-carry') {
      point = outboundStop;
      yaw = -east;
      const travel = ease(p);
      humanPoint = blend(humanHome, loadPose, travel);
      humanYaw = Math.PI * (1 - ease(p, 0.24, 0.91));
      const reach = THREE.MathUtils.lerp(humanHome[2] - outboundStop[2] - 0.49, 0.74, travel);
      cargo = [humanPoint[0] + Math.sin(humanYaw) * reach, carryHeight, humanPoint[2] + Math.cos(humanYaw) * reach];
      cargoYaw = humanYaw;
      handling = true;
      walking = true;
      stride = travel * Math.PI * 2;
      pose = followAgvDrive(outboundDrive, 1 - ease(p) * 0.40, east, -east);
    } else if (motion === 'human-place') {
      point = outboundStop;
      yaw = -east;
      humanPoint = loadPose;
      humanYaw = 0;
      cargo = atHeight(drop, THREE.MathUtils.lerp(carryHeight, drop[1], ease(p, 0, 0.73)));
      handling = true;
      gripOffset = ease(p, 0.73, 1) * 0.14;
      pose = followAgvDrive(outboundDrive, THREE.MathUtils.lerp(0.60, 0.23, ease(p)), east, -east);
    } else if (motion === 'stow') {
      point = outboundStop;
      yaw = -east;
      cargo = blend(drop, slot, ease(p, 0.12, 1));
      humanPoint = blend(loadPose, humanHome, ease(p));
      humanYaw = Math.PI * ease(p, 0.03, 0.86);
      walking = true;
      stride = ease(p) * Math.PI * 2;
      pose = followAgvDrive(outboundDrive, THREE.MathUtils.lerp(0.23, 0, ease(p)), east, -east);
    } else if (motion === 'depart') {
      door = 1 - ease(p, 0, 0.26);
      travel = ease(p, 0.25, 1);
    } else if (motion === 'truck-return') {
      door = ease(p, 0.77, 1);
      travel = 1 - ease(p, 0, 0.83);
    } else if (finished) {
      door = 0;
    }

    if (pose) ({ point, yaw } = pose);
    moveAgvPair([outbound, outboundBackup], sim, 'outboundAgv', { point, yaw, deck,
      loaded: ['dock-out', 'drive-out', 'human-grab'].includes(motion), moving: Boolean(pose),
      distance: pose?.distance ?? 0, rollerTravel: motion === 'dock-out' ? cargo[0] - outboundDock[0] : 0 });
    const handlingTarget = handling ? [cargo[0], cargo[1] + dispatchedBox.userData.size.height * 0.53, cargo[2]] : null;
    moveHandlingPair([human, humanBackup], sim, 'loadingRobot', { point: humanPoint, yaw: humanYaw,
      target: handlingTarget, moving: walking, progress: p, distance: stride / 9 });
    dispatchedBox.visible = Boolean(cargo);
    if (cargo) {
      dispatchedBox.position.set(...cargo);
      dispatchedBox.rotation.y = cargoYaw;
    }
    platform.truck.position.x = truckPark[0] + travel * truckTravel;
    const moving = travel > 0 && travel < 1 && (motion === 'depart' || motion === 'truck-return');
    return { door, moving };
  }

  return {
    update(sim, order) {
      ensureOrder(order);
      time = sim?.time ?? 0;
      syncNightMode();
      updateCharging(sim);
      const sorting = sim?.stations.sort ?? idleFrame;
      const outboundFrame = sim?.stations.dispatch ?? idleFrame;
      const dock = sort(sorting, sim);
      const stacker = store(sim?.stations.storage ?? idleFrame);
      const truck = dispatch(outboundFrame, sim?.finalDeparture ?? Boolean(sim?.complete), sim);
      animateBoxSupply(sim);
      animateInspection(sim);
      const goods = sim?.logistics;
      outboundHoldBox.visible = Boolean(goods?.outboundHold);
      inventory.forEach((item, slot) => { item.visible = goods?.inventory.some((entry) => entry.slot === slot) ?? false; });
      shipment.forEach((item, truckSlot) => { item.visible = goods?.truckCargo.some((entry) => entry.truckSlot === truckSlot) ?? false; });
      // 入库与出库使用独立 AGV、独立 station frame；这里不做互斥门控，允许同一帧同时运动。
      platform.pose({ sortLane: sorting.unit ? (Number.isInteger(sorting.lane) ? sorting.lane : (sorting.unit - 1) % 2) : null,
        sorting: sorting.motion === 'divert' && sorting.phaseProgress >= 0.37 && sorting.phaseProgress <= 0.61,
        scanning: sim?.stations.scan.active, checking: sim?.stations.exception.active, stacker,
        dock: outboundFrame.motion === 'dock-out' ? 'outbound' : dock,
        inboundDockActive: Boolean(sorting.active), outboundDockActive: Boolean(outboundFrame.active),
        truckDoor: truck.door, truckMoving: truck.moving, time });
    },
  };
}

