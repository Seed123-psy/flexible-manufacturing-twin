import { createRejectPlan, rejectFrame } from './reject-flow.js';
import { REJECT_CARGO_SLOTS, REJECT_RACK_SLOTS } from './reject-layout.js';
import { createMobileScheduler } from './mobile-schedule.js';
import { MOBILE_CHARGING_BAYS, MOBILE_FLEET_POSES, PACKAGING_DELIVERY_ROUTES, routeForHandoff, routeToChargingBay } from './mobile-layout.js';
import { FILAMENT_COLORS, FILAMENT_EXCHANGE_SECONDS, FILAMENT_PICKUP_SECONDS, FILAMENT_RECOVERY_SECONDS,
  FILAMENT_SPOOL_GRAMS as SPOOL_GRAMS, FILAMENT_STOCK_PER_COLOR, FILAMENT_TRAVEL_SECONDS,
  FILAMENT_WAREHOUSE_STOCK, FILAMENT_ROBOT_CHARGE_RATE, FILAMENT_ROBOT_DRAIN_RATE,
  FILAMENT_ROBOT_START_MIN, filamentExchangeAt } from './filament-exchange.js';
import { buildPatrolTimeline, FILAMENT_DELIVERY_ROUTES, getPatrolFrame, PATROL_CYCLE_SECONDS, PATROL_RADIUS } from './patrol-layout.js';
import { createPatrolTraffic, planPatrol } from './patrol-traffic.js';
import { getMaterialTravel, printerIds, productionLines } from './layout.js';
import { warehouseAddress, warehouseCapacity, warehouseWaveSize, inboundDock, outboundDock, outboundStop } from './logistics-layout.js';
import { intakeDrives, outboundDrive, returnIn } from './logistics-drive.js';

export const COLORS = [
  { label: '模型原色', value: 'original' },
  { label: '冰川蓝', value: '#55c8ff' },
  { label: '薄荷绿', value: '#66e0b6' },
  { label: '极夜紫', value: '#a995ff' },
  { label: '日落橙', value: '#fb9f64' },
  { label: '极昼白', value: '#eff6ff' },
];

export const ORDER_LIMITS = {
  width: [55, 220],
  depth: [25, 90],
  height: [22, 100],
  quantity: [1, 5000],
};

export const DEFAULT_ORDER = {
  text: '椰子榴莲玩偶',
  color: COLORS[0].value,
  width: 82,
  depth: 72,
  height: 100,
  quantity: 1,
};

export const PRESETS = {
  single: DEFAULT_ORDER,
  batch: { ...DEFAULT_ORDER, quantity: 240 },
  scale: { ...DEFAULT_ORDER, quantity: 2000 },
};

const productWidthRatio = 0.834605 / 1.03856;
const productDepthRatio = 0.729542 / 1.03856;

export const STATIONS = {
  design: { name: '数字设计办公室', shortName: '设计办公室', code: 'DS-01', role: '建模、切片与双线排产' },
  print1: { name: '拓竹 3D 打印机 01', shortName: '拓竹 01', code: 'PR-01', role: '首件打样、批量打印与自动出件' },
  print2: { name: '拓竹 3D 打印机 02', shortName: '拓竹 02', code: 'PR-02', role: '批量打印与自动出件' },
  print3: { name: '拓竹 3D 打印机 03', shortName: '拓竹 03', code: 'PR-03', role: '批量打印与自动出件' },
  quality: { name: 'A 线后处理与质检', shortName: 'A 线质检', code: 'QC-01', role: '清理、外观与尺寸检查' },
  boxes: { name: 'A 线纸盒生产', shortName: 'A 线制盒', code: 'BX-01', role: '印刷、模切与折盒' },
  robot: { name: 'A 线机械臂装盒', shortName: 'A 线装盒', code: 'RB-01', role: '装盒、封盒与贴标' },
  buffer: { name: 'A 线成品接驳', shortName: 'A 线接驳', code: 'BF-01', role: '复核箱标，在合流口按序放行' },
  print4: { name: '拓竹 3D 打印机 04', shortName: '拓竹 04', code: 'PR-04', role: 'B 线批量打印与自动出件' },
  print5: { name: '拓竹 3D 打印机 05', shortName: '拓竹 05', code: 'PR-05', role: 'B 线批量打印与自动出件' },
  print6: { name: '拓竹 3D 打印机 06', shortName: '拓竹 06', code: 'PR-06', role: 'B 线批量打印与自动出件' },
  quality2: { name: 'B 线后处理与质检', shortName: 'B 线质检', code: 'QC-02', role: '清理、外观与尺寸检查' },
  boxes2: { name: 'B 线纸盒生产', shortName: 'B 线制盒', code: 'BX-02', role: '印刷、模切与折盒' },
  robot2: { name: 'B 线机械臂装盒', shortName: 'B 线装盒', code: 'RB-02', role: '装盒、封盒与贴标' },
  buffer2: { name: 'B 线成品接驳', shortName: 'B 线接驳', code: 'BF-02', role: '复核箱标，在合流口按序放行' },
  presort: { name: '收货粗分与拉距', shortName: '粗分拉距', code: 'PS-01', role: '积放、拉距与箱型预分' },
  scan: { name: '主扫描识别门', shortName: '主扫描', code: 'SC-01', role: '读取箱号、订单和区域规则' },
  sort: { name: '双路自动分拣站', shortName: '箱件分拣', code: 'SR-01', role: '扫码分配 A/B 库区，AGV 接驳入库' },
  reject: { name: '不合格品周转与清运区', shortName: '不合格品清运', code: 'QA-OUT', role: '独立接收不合格件，按货位周转，由龙门装载机装入专车' },
  exception: { name: '异常复核旁路', shortName: '异常复核', code: 'EX-01', role: '无码、错码与人工复核后回流' },
  storage: { name: '智能立体仓库', shortName: '智能立库', code: 'WH-01', role: '伸缩货叉入位，按波次先进先出' },
  staging: { name: '待发集货区', shortName: '待发集货', code: 'ST-01', role: '按订单和车次集货，齐套后放行' },
  dispatch: { name: '机器人出库月台', shortName: '出库装车', code: 'DO-01', role: '出库 AGV、人形机器人装车与整批发运' },
};

export function validateOrder(params) {
  const errors = {};
  const text = String(params.text ?? '').trim();
  if (!text) errors.text = '请输入包装标签文字';
  else if (Array.from(text).length > 16) errors.text = '包装标签文字最多 16 个字符';

  if (params.color !== 'original' && !/^#[0-9a-f]{6}$/i.test(params.color ?? '')) {
    errors.color = '请选择有效的打印颜色';
  }

  for (const [key, [min, max]] of Object.entries(ORDER_LIMITS)) {
    const value = Number(params[key]);
    if (!Number.isInteger(value) || value < min || value > max) {
      const unit = key === 'quantity' ? '件' : '毫米';
      errors[key] = `请输入 ${min}–${max} ${unit}的整数`;
    }
  }
  return errors;
}

export function getProductSize(params = DEFAULT_ORDER) {
  const maxWidth = Number(params.width ?? DEFAULT_ORDER.width);
  const maxDepth = Number(params.depth ?? DEFAULT_ORDER.depth);
  const maxHeight = Number(params.height ?? DEFAULT_ORDER.height);
  const height = Math.min(maxWidth / productWidthRatio, maxDepth / productDepthRatio, maxHeight);
  return {
    width: Math.min(height * productWidthRatio, maxWidth),
    depth: Math.min(height * productDepthRatio, maxDepth),
    height,
  };
}

export function getOrderSpec(params) {
  const productSize = getProductSize(params);
  const { width, depth, height } = productSize;
  // Estimate filament from the figurine's outer dimensions using a fixed fill factor for the demo.
  const filamentGrams = Math.round(width * depth * height * 0.12 * 0.00124 * 10) / 10;
  const layers = Math.ceil(height / 0.2);
  return {
    productSize,
    box: {
      width: Math.ceil((width + 20) / 5) * 5,
      depth: Math.ceil((depth + 20) / 5) * 5,
      height: Math.ceil((height + 15) / 5) * 5,
    },
    filamentGrams,
    printMinutes: Math.ceil(filamentGrams * 2.4 + layers * 0.04 + 8),
    layers,
  };
}

const STATION_IDS = Object.keys(STATIONS);
const CARTON_CAPACITY = 10;
const CARTON_WAREHOUSE_STOCK = ORDER_LIMITS.quantity[1] - CARTON_CAPACITY * productionLines.length;
const counters = { blanksA: CARTON_CAPACITY, blanksB: CARTON_CAPACITY, blanksWarehouse: CARTON_WAREHOUSE_STOCK,
  rollsWarehouse: FILAMENT_WAREHOUSE_STOCK, rollsInstalled: 0, filamentUsed: 0, filamentScrap: 0,
  good: 0, rejected: 0, sorted: 0, stored: 0, picked: 0, loaded: 0, onHand: 0, shipped: 0, boxesReady: 0, boxesConsumed: 0, boxRefills: 0, boxed: 0, reworkQueue: 0, rejectCleared: 0 };

const CHARGING_STATION = { id: 'charge-01', name: '中央机器人充电站', bays: 2, location: '物流东侧', positions: MOBILE_CHARGING_BAYS };
const QUALITY_FAILURE_RATE = 0.05;

function isQualityFailure(unit) {
  // Stable integer hash: no Math.random(), and exactly repeatable when seeking.
  return ((unit * 73 + 19) % 100) < QUALITY_FAILURE_RATE * 100;
}

const sharedNorthAisle = 'north-service';
const sharedWestAisle = 'west-supply-service';
function createFactoryMobileScheduler() {
  const definitions = {
    inboundAgv: ['入库 AGV', 'AGV-IN', 4.5, 8, 7.6],
    outboundAgv: ['出库 AGV', 'AGV-OUT', 4.3, 8, 1.5],
    loadingRobot: ['装车机器人', 'LOAD', 3.1, 9, 1.5],
    packagingRobot: ['盒坯补给机器人', 'BOX', 2.9, 8],
    inspectionRobot: ['全厂巡检机器人', 'INSP', 0.55, 10, 9.0],
  };
  const fleets = Object.fromEntries(Object.entries(definitions).map(([key, [label, prefix, drainPerSecond, chargeSeconds, corridorSeconds]]) => {
    const pose = MOBILE_FLEET_POSES[key];
    const west = key === 'inspectionRobot' || key === 'packagingRobot';
    const eastService = 'warehouse-east-service';
    const patrolCrossing = 'patrol-west-crossing';
    const routeResources = [eastService];
    if (west || key === 'inboundAgv') routeResources.push(sharedNorthAisle);
    if (west) routeResources.push(sharedWestAisle);
    if (key === 'inboundAgv') routeResources.push('inbound-dock-mouth');
    if (key === 'loadingRobot') routeResources.push('loading-handoff');
    if (key === 'inspectionRobot') routeResources.push(patrolCrossing);
    const handoffResources = key === 'loadingRobot' ? ['loading-handoff', eastService] : key === 'inboundAgv' ? ['inbound-dock-mouth'] : key === 'inspectionRobot'
      ? [patrolCrossing] : key === 'packagingRobot' ? [sharedNorthAisle] : [eastService];
    const handoffSeconds = key === 'packagingRobot' ? 1.50 : 0.85;
    return [key, {
      label, primary: prefix + '-01', backup: prefix + '-02', capacity: 100, reserve: 20,
      drainPerSecond, chargeSeconds, travelDrainPerSecond: west ? 0.75 : key === 'inboundAgv' ? 0.95 : 1.6,
      home: pose.home, parking: pose.parking, chargeAtParking: pose.chargeAtParking,
      travel: { handoffOut: handoffSeconds, handoffIn: handoffSeconds, toCharge: corridorSeconds, fromCharge: corridorSeconds },
      routes: {
        handoffOut: ({ from, to }) => ({ points: routeForHandoff(key, from.position, to.position), resources: handoffResources }),
        handoffIn: ({ from, to }) => ({ points: routeForHandoff(key, to.position, from.position).reverse(), resources: handoffResources }),
        toCharge: ({ from, to }) => ({ points: routeToChargingBay(key, from.position, to.position), resources: routeResources }),
        fromCharge: ({ from, to }) => ({ points: routeToChargingBay(key, to.position, from.position).reverse(), resources: routeResources }),
      },
    }];
  }));
  return createMobileScheduler({ fleets, station: { ...CHARGING_STATION,
    // Leave a periodic window for the long-range rover to reach its charger
    // even under continuous production and material deliveries.
    priority: { fleet: 'inspectionRobot', first: 115, period: 180, seconds: 29,
      resources: [sharedWestAisle, sharedNorthAisle, 'warehouse-east-service'] },
  } });
}

const DESIGN_STEPS = [
  ['model', '载入并缩放玩偶模型', 3.5],
  ['check', '检查尺寸与可打印性', 2.0],
  ['slice', 'Bambu Studio 切片预览', 3.1],
  ['dispatch', '下发首件打印任务', 2.0],
];
const FIRST_PRINT_STEPS = [
  ['print', '逐层打印首件', 8.6],
  ['cool', '冷却打印平台', 2.4],
];
const BATCH_PRINT_STEPS = [
  ['print', '逐层打印批量件', 4.8],
  ['cool', '冷却打印平台', 0.9],
];
const FIRST_QUALITY_STEPS = [
  ['clean', '清理表面与毛边', 1.6],
  ['inspect', '检查首件尺寸与外观', 2.4],
];
const BATCH_QUALITY_STEPS = [
  ['clean', '清理表面与毛边', 0.55],
  ['inspect', '检查尺寸与外观', 0.8],
];
const FIRST_BOX_STEPS = [
  ['feed', '纸板上料', 1.4],
  ['imprint', '印刷包装图文', 1.25],
  ['diecut', '模切与压痕', 1.4],
  ['fold', '折叠纸盒成型', 1.75],
  ['convey', '输送成型纸盒', 1.6],
];
const BATCH_BOX_STEPS = [
  ['feed', '纸板上料', 0.24],
  ['imprint', '印刷包装图文', 0.24],
  ['diecut', '模切与压痕', 0.28],
  ['fold', '折叠纸盒成型', 0.46],
  ['convey', '输送成型纸盒', 0.68],
];
const ROBOT_STEPS = [
  ['approach', '夹爪靠近工件', 0.34],
  ['grasp', '夹紧合格工件', 0.23],
  ['lift', '抬升工件', 0.28],
  ['turn', '转向对应纸盒', 0.37],
  ['place', '下降至纸盒内底', 0.65],
  ['release', '工件落座，松爪撤离', 0.44],
  ['seal', '封闭纸盒', 0.27],
  ['label', '打印并粘贴订单标签', 0.24],
  ['review', '包装复核', 0.22],
];
const SORT_STEPS = [
  ['scan', '识别箱标与订单编号', 0.70],
  ['divert', '分配库区并切换滚筒支线', 1.50],
  ['approach-in', '入库 AGV 驶至指定滚筒口', 0.85],
  ['dock-in', '入库 AGV 升台接箱', 0.84],
  ['drive-in', '入库 AGV 沿专用车道转运', 1.22],
  ['rack-dock', '升台对接立库入库口', 0.92],
  ['return-in', '入库 AGV 返回分拣站', 1.22],
];
// Smoothstep motion has peak speed 1.5*d/t and peak acceleration 6*d/t².
// These are metres per simulated second, scaled for the workshop playback clock.
function driveSeconds(distance, minimum) {
  return Math.max(minimum, 1.5 * distance / 4.8, Math.sqrt(6 * distance / 18));
}

function inboundSteps(lane) {
  const route = intakeDrives[lane];
  const distances = { 'approach-in': route.approach.getLength(), 'drive-in': route.lane.getLength(), 'return-in': returnIn.getLength() };
  return SORT_STEPS.slice(2).map(([motion, label, seconds]) =>
    [motion, label, distances[motion] ? driveSeconds(distances[motion], seconds) : seconds]);
}
const INBOUND_STEPS = intakeDrives.map((_, lane) => inboundSteps(lane));
const DISPATCH_STEPS = [
  ['dock-out', '出库 AGV 在取货口接箱', 0.85],
  ['drive-out', '出库 AGV 驶入装车工位', driveSeconds(outboundDrive.getLength(), 1.26)],
  ['human-grab', '人形机器人双手夹稳纸箱', 0.80],
  ['human-carry', '机器人抱箱转向装载位', 0.85],
  ['human-place', '放至侧面滚筒装车台', 0.66],
  ['stow', '滑入车载托盘并核对件数', 1.02],
];
const IDLE_ACTIONS = {
  design: '等待定制订单',
  print1: '等待打印任务',
  print2: '等待打印任务',
  print3: '等待打印任务',
  print4: '等待打印任务',
  print5: '等待打印任务',
  print6: '等待打印任务',
  quality: '等待打印件',
  quality2: '等待打印件',
  boxes: '等待包装规格',
  boxes2: '等待包装规格',
  robot: '等待合格件与纸盒配对',
  robot2: '等待合格件与纸盒配对',
  buffer: '等待封装成品扫码',
  buffer2: '等待封装成品扫码',
  presort: '等待收货箱件',
  scan: '等待箱件识别',
  exception: '无异常箱件',
  reject: '等待质检旁路送达',
  staging: '等待出库波次',
  sort: '等待分拣指令',
  storage: '等待入位或拣货任务',
  dispatch: '等待本波次货物装车',
};

function addPhases(queue, start, unit, phases, speed = 1) {
  const duration = phases.reduce((total, [, , seconds]) => total + seconds / speed, 0);
  let next = start;
  for (const [motion, action, seconds] of phases) {
    const end = next + seconds / speed;
    queue.push({ start: next, end, motion, action, unit, operationStart: start, duration });
    next = end;
  }
  return next;
}

function addTransfer(queue, start, seconds, from, to, kind, unit) {
  const end = start + seconds;
  queue.push({ start, end, from, to, kind, unit });
  return end;
}

function operationDuration(steps) {
  return steps.reduce((total, [, , duration]) => total + duration, 0);
}

function buildTimeline(order) {
  const phases = Object.fromEntries(STATION_IDS.map((id) => [id, []]));
  const transfers = [];
  const mobile = createFactoryMobileScheduler();
  const packingArrivals = Object.fromEntries(productionLines.map((line) => [line.robot, []]));
  const warehouseUnits = [];
  const rejectPlan = createRejectPlan();
  const rejectedUnits = rejectPlan.units;
  const cartonDeliveries = [];
  const outboundHolds = [];
  const filamentDeliveries = [];
  const filamentChanges = Object.fromEntries(printerIds.map((id) => [id, FILAMENT_COLORS.map(() => [])]));
  const printerSpools = Object.fromEntries(printerIds.map((id) => [id, FILAMENT_COLORS.map(() => SPOOL_GRAMS * 10)]));
  const milestones = [];
  const log = (time, station, message, count, amount = 1) => milestones.push({ time, station, message, count, amount });
  const { quantity } = order;
  let lastGoodUnit = quantity;
  while (isQualityFailure(lastGoodUnit)) lastGoodUnit -= 1;

  log(0, 'design', `接收定制订单 ${order.id}，共 ${quantity} 件`);
  const firstPrintStart = addPhases(phases.design, 0, null, DESIGN_STEPS);
  const boxStart = phases.design[1].end;
  const dispatchStart = phases.design.at(-1).start;
  log(boxStart, 'boxes', `确认纸盒规格 ${order.box.width} × ${order.box.depth} × ${order.box.height} mm`);
  log(dispatchStart, 'design', '切片预览完成，下发首件打印任务');
  addTransfer(transfers, dispatchStart, firstPrintStart - dispatchStart, 'design', 'print1', 'data', 1);

  const lines = productionLines.map((line) => ({
    ...line,
    productTravel: getMaterialTravel(line.quality, line.robot).duration,
    boxTravel: getMaterialTravel(line.boxes, line.robot).duration,
    parcelTravel: getMaterialTravel(line.robot, line.buffer).duration,
    presortTravel: getMaterialTravel(line.buffer, 'presort').duration,
    trunkFree: 0,
    qualityFree: 0,
    previousProductArrival: 0,
    previousCartonArrival: 0,
    boxAvailable: boxStart,
    boxStock: CARTON_CAPACITY,
    stockCounter: line.key === 'lineA' ? 'blanksA' : 'blanksB',
    robotAvailable: 0,
    bufferFree: 0,
  }));
  const bufferDuration = 1.28;
  const occupied = new Set();
  let bridgeFree = 0;
  let sortFree = 0;
  let rackFree = 0;
  let dispatchFree = 0;
  let lastDeparture = 0;
  let lastWaveStart = 0;
  let lastInspection = 0;
  let packagingStock = CARTON_WAREHOUSE_STOCK;
  let packagingRefillFree = boxStart;
  const filamentStock = FILAMENT_COLORS.map(() => FILAMENT_STOCK_PER_COLOR);
  let filamentRobotFree = 0;
  let waveNumber = 0;

  function printAndTransfer(line, id, start, unit) {
    const first = unit === 1;
    const gramsTenths = Math.round(order.filamentGrams * 10);
    // The demonstrator uses equal RGB material shares while retaining the order's preview finish.
    const required = FILAMENT_COLORS.map(({ index }) =>
      Math.floor(gramsTenths / FILAMENT_COLORS.length) + Number(index < gramsTenths % FILAMENT_COLORS.length));
    for (const { index: slot, label } of FILAMENT_COLORS) {
      if (printerSpools[id][slot] >= required[slot]) continue;
      if (filamentStock[slot] === 0) throw new RangeError(`${label}耗材卷料不足`);
      filamentStock[slot] -= 1;
      const cycleSeconds = FILAMENT_PICKUP_SECONDS + FILAMENT_TRAVEL_SECONDS * 2 + FILAMENT_EXCHANGE_SECONDS + FILAMENT_RECOVERY_SECONDS;
      const lastJob = filamentDeliveries.at(-1);
      const remaining = lastJob?.batteryAfter ?? 1;
      const chargeReady = filamentRobotFree + Math.max(0, FILAMENT_ROBOT_START_MIN - remaining) / FILAMENT_ROBOT_CHARGE_RATE;
      const taskStart = mobile.reserveResource(sharedWestAisle, Math.max(start, chargeReady), cycleSeconds);
      const batteryStart = Math.min(1, remaining + (taskStart - filamentRobotFree) * FILAMENT_ROBOT_CHARGE_RATE);
      const pickup = taskStart + FILAMENT_PICKUP_SECONDS;
      const arrival = pickup + FILAMENT_TRAVEL_SECONDS;
      const finish = arrival + FILAMENT_EXCHANGE_SECONDS;
      const returned = finish + FILAMENT_TRAVEL_SECONDS;
      filamentRobotFree = returned + FILAMENT_RECOVERY_SECONDS;
      const oldGrams = printerSpools[id][slot] / 10;
      filamentDeliveries.push({ start: taskStart, pickup, arrival, loaded: finish, returned,
        end: filamentRobotFree, station: id, oldGrams, slot, batteryStart,
        batteryAfter: batteryStart - cycleSeconds * FILAMENT_ROBOT_DRAIN_RATE });
      addPhases(phases[id], start, unit, [
        ['wait-filament', `${label}余量不足，等待卷料配送`, arrival - start],
        ['load-filament', `自动换卷机正在更换${label}耗材`, finish - arrival],
      ]);
      log(pickup, id, null, 'rollsWarehouse', -1);
      log(finish, id, `${label}新卷进料确认`, 'rollsInstalled');
      log(filamentRobotFree, id, null, 'filamentScrap', Math.round(oldGrams * 10));
      printerSpools[id][slot] = SPOOL_GRAMS * 10;
      filamentChanges[id][slot].push({ time: finish, remaining: printerSpools[id][slot] });
      start = finish;
    }
    const [[, , printingSeconds]] = first ? FIRST_PRINT_STEPS : BATCH_PRINT_STEPS;
    const consumeTime = start + printingSeconds;
    for (const { index: slot } of FILAMENT_COLORS) {
      printerSpools[id][slot] -= required[slot];
      filamentChanges[id][slot].push({ time: consumeTime, remaining: printerSpools[id][slot] });
    }
    log(consumeTime, id, null, 'filamentUsed', gramsTenths);
    const unloadTime = first ? 1.85 : 1.10;
    const printSteps = first ? FIRST_PRINT_STEPS : BATCH_PRINT_STEPS;
    const travel = getMaterialTravel(id, line.quality).duration;
    const cooled = start + operationDuration(printSteps);
    const unloadStart = Math.max(cooled, line.trunkFree - unloadTime, line.qualityFree - travel - unloadTime);
    const wait = unloadStart > cooled ? [['wait-outfeed', '托盘就绪，等待本线滚筒放行', unloadStart - cooled]] : [];
    const printerFree = addPhases(phases[id], start, unit, [
      ...printSteps,
      ...wait,
      ['unload', '开启出件门，推送打印托盘', unloadTime],
      ['reset', '收回推板并关闭出件门', first ? 0.9 : 0.55],
    ]);
    const transferStart = phases[id].at(-1).start;
    line.trunkFree = addTransfer(transfers, transferStart, travel, id, line.quality, 'product', unit);
    return { transferStart, arrival: line.trunkFree, printerFree };
  }

  function allocateSlot(unit) {
    // A dispatch wave stays in one bank when possible, using the next vacant address there.
    const preferredLane = Math.floor((unit - 1) / warehouseWaveSize) % 2;
    for (const lane of [preferredLane, 1 - preferredLane]) {
      for (let slot = lane; slot < warehouseCapacity; slot += 2) {
        if (occupied.has(slot)) continue;
        occupied.add(slot);
        return { slot, lane };
      }
    }
    throw new RangeError('Warehouse lot exceeds available storage locations');
  }

  function shipWave(units) {
    lastWaveStart = units[0].index;
    waveNumber += 1;
    const inventoryHold = rackFree + (units.length === 1 ? 1.7 : 0.9);
    for (const [truckSlot, record] of units.entries()) {
      const { unit } = record;
      const retrieve = unit === 1 ? 2.45 : 1.66;
      record.truckSlot = truckSlot;
      record.wave = waveNumber;
      record.pickStart = Math.max(rackFree, inventoryHold, dispatchFree - retrieve);
      const stagingStart = Math.max(rackFree, record.pickStart - 1.15);
      addPhases(phases.staging, stagingStart, unit, [['stage', '待发集货区按订单与车次集货', record.pickStart - stagingStart]]);
      rackFree = addPhases(phases.storage, record.pickStart, unit, [
        ['retrieve', `按单从 ${warehouseAddress(record.slot)} 拣取纸箱`, retrieve],
      ]);
      log(record.pickStart, 'storage', truckSlot === 0 ? `开始拣选第 ${waveNumber} 个发运波次` : null, 'picked');
      const speed = unit === 1 ? 0.74 : 1;
      const dispatchDuration = operationDuration(DISPATCH_STEPS) / speed;
      const [departureTask] = mobile.reserveConcurrentTasks([
        { fleet: 'outboundAgv', earliest: rackFree, duration: dispatchDuration, id: unit, resources: ['warehouse-east-service'] },
        { fleet: 'loadingRobot', earliest: rackFree, duration: dispatchDuration, id: unit, resources: ['truck-loading'] },
      ]);
      if (departureTask.start > rackFree) outboundHolds.push({ unit, start: rackFree, end: departureTask.start });
      dispatchFree = addPhases(phases.dispatch, departureTask.start, unit, DISPATCH_STEPS, speed);
      record.loadedAt = dispatchFree;
      log(dispatchFree, 'dispatch', null, 'loaded');
    }
    const last = units.at(-1).unit;
    lastDeparture = addPhases(phases.dispatch, dispatchFree, last, [['depart', '关车厢侧门，卷帘门放行，整波发运', 8.40]]);
    units.forEach((record) => { record.departure = lastDeparture; });
    log(lastDeparture, 'dispatch', `第 ${waveNumber} 波发车，累计出库 ${units.at(-1).index + 1} 件`, 'shipped', units.length);
    dispatchFree = lastDeparture;
    if (last < lastGoodUnit) {
      dispatchFree = addPhases(phases.dispatch, lastDeparture, last, [['truck-return', '卷帘门放行，空车进入装车月台', 7.60]]);
    }
  }

  function releaseStorageLot(lotSize) {
    const lot = warehouseUnits.slice(-lotSize);
    for (let start = 0; start < lot.length; start += warehouseWaveSize) {
      shipWave(lot.slice(start, start + warehouseWaveSize));
    }
    // Future putaway is queued behind the last pick before addresses are allocated again.
    occupied.clear();
  }

  function packAndStock(line, unit, inspected, qualityFailed = false) {
    const { quality, boxes, robot, buffer, productTravel, boxTravel, parcelTravel } = line;
    if (qualityFailed) {
      const travel = getMaterialTravel(quality, 'reject').duration;
      const record = rejectPlan.receive(unit, quality, inspected, travel);
      const { release } = record;
      if (release > inspected) {
        addPhases(phases[quality], inspected, unit, [['wait-outfeed', '周转货位或红色旁路忙，工件留在质检口等待', release - inspected]]);
      }
      addTransfer(transfers, release, travel, quality, 'reject', 'reject', unit);
      line.qualityFree = release;
      return;
    }
    const productRelease = Math.max(inspected, line.previousProductArrival, line.robotAvailable - productTravel);
    if (productRelease > inspected) {
      addPhases(phases[quality], inspected, unit, [['wait-outfeed', '质检通过，等待本线装盒', productRelease - inspected]]);
    }
    const productReady = addTransfer(transfers, productRelease, productTravel, quality, robot, 'product', unit);
    line.previousProductArrival = productReady;

    const boxSteps = unit === 1 ? FIRST_BOX_STEPS : BATCH_BOX_STEPS;
    const boxDuration = operationDuration(boxSteps);
    const cartonDue = Math.max(line.robotAvailable, productReady - 0.38);
    let cartonStart = Math.max(line.boxAvailable, line.previousCartonArrival - boxDuration,
      unit === 1 ? boxStart : cartonDue - boxTravel - boxDuration);
    if (line.boxStock === 0) {
      const amount = Math.min(CARTON_CAPACITY, packagingStock);
      if (!amount) throw new RangeError('包装盒仓库存不足');
      const refillPlan = mobile.reserveTask('packagingRobot', { earliest: Math.max(cartonStart, packagingRefillFree),
        duration: 11.8, id: unit, resources: [sharedWestAisle, sharedNorthAisle, 'packaging-delivery'], meta: { station: boxes } });
      const refillStart = refillPlan.start;
      const pickup = refillStart + 0.8;
      const arrival = pickup + 6.0;
      packagingRefillFree = arrival + 5.0;
      const refillEnd = addPhases(phases[boxes], refillStart, null, [['restock', '线边盒坯耗尽，等待机器人送货', arrival - refillStart]]);
      cartonDeliveries.push({ start: refillStart, pickup, arrival, end: packagingRefillFree, station: boxes, amount });
      packagingStock -= amount;
      line.boxStock += amount;
      log(pickup, boxes, null, 'blanksWarehouse', -amount);
      log(refillEnd, boxes, null, line.stockCounter, amount);
      log(refillEnd, boxes, `补给机器人送达 ${amount} 个纸盒坯`, 'boxRefills');
      cartonStart = refillEnd;
    }
    line.boxStock -= 1;
    log(cartonStart, boxes, null, line.stockCounter, -1);
    line.boxAvailable = addPhases(phases[boxes], cartonStart, unit, boxSteps);
    const cartonReady = addTransfer(transfers, line.boxAvailable, boxTravel, boxes, robot, 'box', unit);
    line.previousCartonArrival = cartonReady;
    log(cartonReady, boxes, unit === 1 ? '首个纸盒抵达包装缓存' : null, 'boxesReady');

    const robotSpeed = unit === 1 ? 0.65 : 1.15;
    const sortSpeed = unit === 1 ? 0.72 : 1;
    const sortToRack = operationDuration(SORT_STEPS.slice(1, -1)) / sortSpeed;
    const presortSeconds = 0.84 / sortSpeed;
    const scanSeconds = 0.70 / sortSpeed;
    const exceptionSeconds = 1.05 / sortSpeed;
    const exception = unit % 17 === 0;
    const sortTravel = getMaterialTravel('scan', 'sort').duration;
    const scanTravel = getMaterialTravel('presort', 'scan').duration;
    const exceptionInTravel = getMaterialTravel('scan', 'exception').duration;
    const exceptionOutTravel = getMaterialTravel('exception', 'sort').duration;
    const bridgeTravel = line.presortTravel + presortSeconds + scanTravel + scanSeconds
      + (exception ? exceptionInTravel + exceptionSeconds + exceptionOutTravel : sortTravel);
    const readyAt = Math.max(line.robotAvailable, productReady, cartonReady,
      line.bufferFree - parcelTravel - operationDuration(ROBOT_STEPS) / robotSpeed);
    packingArrivals[robot].push({ productReady, cartonReady, readyAt });
    if (unit === 1) log(readyAt, robot, '合格件与纸盒在滚筒线接驳，开始自动装盒');
    line.robotAvailable = addPhases(phases[robot], readyAt, unit, ROBOT_STEPS, robotSpeed);
    log(line.robotAvailable, robot, null, 'boxesConsumed');
    log(line.robotAvailable, robot, null, 'boxed');
    const parcelReady = addTransfer(transfers, line.robotAvailable, parcelTravel, robot, buffer, 'parcel', unit);
    const bufferEnd = addPhases(phases[buffer], parcelReady, unit, [['buffer', '复核箱标，进入跨区合流缓冲', bufferDuration]]);
    // Reserve the whole merge/scan path until its carton can enter the sorter.
    line.bufferFree = Math.max(bufferEnd, bridgeFree, sortFree - bridgeTravel + 1e-8, rackFree - sortToRack - bridgeTravel);
    if (line.bufferFree > bufferEnd) {
      addPhases(phases[buffer], bufferEnd, unit, [['wait-merge', '在积放滚筒等待合流线放行', line.bufferFree - bufferEnd]]);
    }
    const presortReady = addTransfer(transfers, line.bufferFree, line.presortTravel, buffer, 'presort', 'parcel', unit);
    const presortEnd = addPhases(phases.presort, presortReady, unit, [['gap', '整列拉距与箱型粗分', presortSeconds]]);
    const scanReady = addTransfer(transfers, presortEnd, scanTravel, 'presort', 'scan', 'parcel', unit);
    const scanEnd = addPhases(phases.scan, scanReady, unit, [['scan', '读取箱号、订单和区域规则', scanSeconds]]);
    let sortEntry;
    if (exception) {
      const exceptionIn = addTransfer(transfers, scanEnd, exceptionInTravel, 'scan', 'exception', 'parcel', unit);
      const exceptionEnd = addPhases(phases.exception, exceptionIn, unit, [['exception', '标签异常复核后重新放行', exceptionSeconds]]);
      sortEntry = addTransfer(transfers, exceptionEnd, exceptionOutTravel, 'exception', 'sort', 'parcel', unit);
      log(exceptionIn, 'exception', `箱件 #${String(unit).padStart(2, '0')} 进入异常复核旁路`, null);
    } else {
      sortEntry = addTransfer(transfers, scanEnd, sortTravel, 'scan', 'sort', 'parcel', unit);
    }
    bridgeFree = sortEntry;
    const diverted = addPhases(phases.sort, sortEntry, unit, SORT_STEPS.slice(1, 2), sortSpeed);
    const { slot, lane } = allocateSlot(unit);
    const carrySteps = INBOUND_STEPS[lane];
    // Time the rack handoff to the crane's availability. A queued AGV waits
    // at its off-aisle home, leaving the sorter mouth and the outbound lane open.
    const toHandoff = operationDuration(carrySteps.slice(0, -1)) / sortSpeed;
    const inboundTask = mobile.reserveTask('inboundAgv', { earliest: Math.max(diverted, rackFree - toHandoff),
      duration: operationDuration(carrySteps) / sortSpeed, id: unit, resources: ['inbound-dock-mouth'] });
    if (inboundTask.start > diverted) {
      addPhases(phases.sort, diverted, unit, [['wait-agv', '货件留在滚筒末端，等待可用车辆与入库工位', inboundTask.start - diverted]]);
    }
    sortFree = addPhases(phases.sort, inboundTask.start, unit, carrySteps, sortSpeed);
    const sortedAt = phases.sort[phases.sort.length - 2].start;
    const putawayStart = Math.max(rackFree, phases.sort.at(-1).start);
    const address = warehouseAddress(slot);
    log(sortedAt, 'sort', unit === 1 || unit % warehouseWaveSize === 1 ? `箱件 #${String(unit).padStart(2, '0')} 分拨至 ${address}` : null, 'sorted');
    rackFree = addPhases(phases.storage, putawayStart, unit, [
      ['putaway', `堆垛机上架 ${address}`, unit === 1 ? 2.60 : 1.90],
    ]);
    warehouseUnits.push({ unit, index: warehouseUnits.length, slot, lane, putawayAt: rackFree });
    const waveReady = warehouseUnits.length > 0 && (warehouseUnits.length % warehouseWaveSize === 0 || unit === quantity);
    log(rackFree, 'storage', unit === 1 || waveReady ? `累计 ${warehouseUnits.length} 件成品完成入位，入库与出库并行` : null, 'stored');
    if (waveReady) {
      const releaseSize = warehouseUnits.length % warehouseWaveSize === 0 ? warehouseWaveSize : warehouseUnits.length % warehouseWaveSize;
      releaseStorageLot(releaseSize);
    }
    line.qualityFree = productRelease;
  }

  const [firstLine] = lines;
  const firstPrint = printAndTransfer(firstLine, 'print1', firstPrintStart, 1);
  log(firstPrintStart, 'print1', '拓竹 01 开始首件打样');
  log(firstPrint.transferStart, 'print1', '首件托盘对接滚筒线，送往质检');
  const firstQualityStart = firstPrint.arrival;
  const firstQualityEnd = addPhases(phases.quality, firstQualityStart, 1, FIRST_QUALITY_STEPS);
  lastInspection = firstQualityEnd;
  log(firstQualityStart, 'quality', '首件进入尺寸与外观检查');
  log(firstQualityEnd, 'quality', '首件质检通过', 'good');
  packAndStock(firstLine, 1, firstQualityEnd);

  if (quantity > 1) {
    const lineup = ['print2', 'print4', 'print3', 'print5', 'print1', 'print6'];
    const active = lineup.slice(0, quantity - 1);
    const batchDispatchEnd = addPhases(phases.design, firstQualityEnd, null, [['dispatch', '向 A、B 两条产线下发批量打印任务', 2]]);
    const printerAvailability = active.map((id) => ({ id, line: lines.find(({ printers }) => printers.includes(id)), time: batchDispatchEnd }));
    log(firstQualityEnd, 'design', `剩余 ${quantity - 1} 件分配给 ${active.length} 台打印机`);
    active.forEach((id) => addTransfer(transfers, firstQualityEnd, 2, 'design', id, 'data', null));

    for (let unit = 2; unit <= quantity; unit += 1) {
      const printer = printerAvailability.reduce((earliest, candidate) => candidate.time < earliest.time ? candidate : earliest);
      const { line } = printer;
      const printed = printAndTransfer(line, printer.id, printer.time, unit);
      printer.time = printed.printerFree;
      const inspected = addPhases(phases[line.quality], printed.arrival, unit, BATCH_QUALITY_STEPS);
      lastInspection = Math.max(lastInspection, inspected);
      const qualityFailed = isQualityFailure(unit);
      log(inspected, line.quality, null, qualityFailed ? 'rejected' : 'good');
      packAndStock(line, unit, inspected, qualityFailed);
    }
    log(lastInspection, 'quality', `A、B 两线完成 ${quantity} 件质检`);
  }

  // 如果订单最后一件是不合格品，最后一波合格品不会在 packAndStock 中触发
  // unit === quantity 的收尾条件，这里主动释放剩余库存，确保订单能完整出库。
  const remainder = warehouseUnits.length % warehouseWaveSize;
  if (remainder > 0 && rejectedUnits.some(({ unit }) => unit === quantity)) releaseStorageLot(remainder);

  const rejectEnd = rejectPlan.finish(lastInspection);
  for (const { unit, slot, putaway, loading } of rejectedUnits) {
    log(putaway.drop, 'reject', `不合格件 #${unit} 暂存至货位 R${slot + 1}`, 'reworkQueue');
    log(loading.pickup, 'reject', null, 'reworkQueue', -1);
  }
  for (const job of rejectPlan.jobs) {
    addPhases(phases.reject, job.start, job.unit, [[job.kind === 'store' ? 'receive-reject' : 'load-reject',
      job.kind === 'store' ? '龙门装载机接件入架' : '龙门装载机从货架取件并装车', job.span]]);
  }
  for (const [index, trip] of rejectPlan.trips.entries()) {
    log(trip.depart, 'reject', `不合格品专车第 ${index + 1} 次发车，装载 ${trip.units.length} 件`);
    log(trip.handover, 'reject', `第 ${index + 1} 车已交接至场外处理点，清运 ${trip.units.length} 件`, 'rejectCleared', trip.units.length);
  }
  const workEnd = Math.max(lastDeparture, rejectEnd, packagingRefillFree, filamentRobotFree);
  const patrolLaps = [];
  const singleLap = buildPatrolTimeline(PATROL_CYCLE_SECONDS);
  const traffic = createPatrolTraffic();
  for (const delivery of cartonDeliveries) {
    const points = PACKAGING_DELIVERY_ROUTES[delivery.station].points;
    const reach = delivery.pickup + (delivery.arrival - delivery.pickup) * 0.88;
    traffic.travel(points, 0.58, delivery.pickup, reach);
    traffic.occupy(points.at(-1), 0.58, reach, delivery.arrival);
    traffic.travel(points.slice().reverse(), 0.58, delivery.arrival, delivery.end);
  }
  for (const delivery of filamentDeliveries) {
    const points = FILAMENT_DELIVERY_ROUTES[delivery.station];
    traffic.occupy(points[0], 0.60, delivery.start, delivery.pickup);
    traffic.travel(points, 0.60, delivery.pickup, delivery.arrival);
    traffic.occupy(points.at(-1), 0.60, delivery.arrival, delivery.loaded);
    traffic.travel(points.slice().reverse(), 0.60, delivery.loaded, delivery.returned);
    traffic.occupy(points[0], 0.60, delivery.returned, delivery.end);
  }
  const agvRadius = 1.02;
  const smooth = (p) => p * p * (3 - 2 * p);
  const samplesByCurve = new WeakMap();
  // Keep reservation chords short at the tight bends of the AGV turnaround.
  const driveSegments = 32;
  function occupyDrive(phase, curve, from = 0, to = 1, delay = 0) {
    if (!samplesByCurve.has(curve)) samplesByCurve.set(curve, new Map());
    const samples = samplesByCurve.get(curve);
    const key = `${from}:${to}:${delay}`;
    if (!samples.has(key)) {
      const positions = Array.from({ length: driveSegments + 1 }, (_, index) => {
        const eased = smooth(Math.max(0, (index / driveSegments - delay) / (1 - delay)));
        return curve.getPointAt(from + (to - from) * eased).toArray();
      });
      samples.set(key, positions.slice(1).map((point, index) => [positions[index], point]));
    }
    const span = (phase.end - phase.start) / driveSegments;
    samples.get(key).forEach(([from, to], index) =>
      traffic.sweep(from, to, agvRadius + 0.05, phase.start + index * span, phase.start + (index + 1) * span));
  }
  const addresses = new Map(warehouseUnits.map((record) => [record.unit, record]));
  for (const phase of phases.sort) {
    const { lane } = addresses.get(phase.unit);
    const route = intakeDrives[lane];
    if (phase.motion === 'approach-in') occupyDrive(phase, route.approach);
    if (phase.motion === 'drive-in') occupyDrive(phase, route.lane);
    if (phase.motion === 'return-in') occupyDrive(phase, returnIn);
    if (phase.motion === 'dock-in') traffic.occupy(route.stop, agvRadius, phase.start, phase.end);
    if (phase.motion === 'rack-dock') traffic.occupy(inboundDock, agvRadius, phase.start, phase.end);
  }
  for (const phase of phases.dispatch) {
    if (phase.motion === 'drive-out') occupyDrive(phase, outboundDrive);
    if (phase.motion === 'dock-out') traffic.occupy(outboundDock, agvRadius, phase.start, phase.end);
    if (phase.motion === 'human-grab') traffic.occupy(outboundStop, agvRadius, phase.start, phase.end);
    if (phase.motion === 'human-carry') occupyDrive(phase, outboundDrive, 1, 0.60);
    if (phase.motion === 'human-place') occupyDrive(phase, outboundDrive, 0.60, 0.23);
    if (phase.motion === 'stow') occupyDrive(phase, outboundDrive, 0.23, 0);
  }
  for (const { kind, fleet, start, end, route } of mobile.getIntervals()) {
    if (kind !== 'work' && kind !== 'charging' && route?.points.length > 1) {
      const radius = fleet.endsWith('Agv') ? agvRadius : fleet === 'inspectionRobot' ? PATROL_RADIUS : 0.66;
      traffic.travel(route.points, radius, start, end);
    }
  }
  const fitPatrol = planPatrol(singleLap, traffic.zones(), PATROL_RADIUS);
  let pendingChargeTrips = [];
  let chargeZones = [];
  function fitWithReturningRover(start) {
    const trips = mobile.getIntervals('inspectionRobot').filter(({ kind, end }) =>
      end > start && (kind === 'return' || kind === 'exit'));
    if (trips.length !== pendingChargeTrips.length || trips.some((trip, i) => trip !== pendingChargeTrips[i])) {
      const chargeTraffic = createPatrolTraffic();
      for (const { route, start, end } of trips) {
        chargeTraffic.travel(route.points, PATROL_RADIUS + 0.05, start, end);
      }
      chargeZones = chargeTraffic.zones();
      pendingChargeTrips = trips;
    }
    return fitPatrol(start, chargeZones);
  }
  let patrolTime = 0;
  while (patrolLaps.length === 0 || patrolTime + PATROL_CYCLE_SECONDS <= workEnd + 1e-7) {
    const task = mobile.reserveTask('inspectionRobot', { earliest: patrolTime, duration: PATROL_CYCLE_SECONDS,
      id: patrolLaps.length + 1, energy: 58.05, fit: fitWithReturningRover });
    patrolLaps.push(task);
    patrolTime = task.end + 2.0;
  }
  const mobileIntervals = mobile.getIntervals();
  const duration = mobileIntervals.reduce((end, entry) => Math.max(end, entry.end), workEnd);
  return {
    phases,
    rejectedUnits,
    rejectPlan: { units: rejectedUnits, jobs: rejectPlan.jobs, trips: rejectPlan.trips },
    cartonDeliveries,
    outboundHolds,
    filamentDeliveries,
    filamentStockChanges: FILAMENT_COLORS.map(({ index }) => filamentDeliveries.filter(({ slot }) => slot === index)),
    filamentChanges,
    warehouseByUnit: addresses,
    milestones: milestones.sort((a, b) => a.time - b.time),
    transfers: transfers.sort((a, b) => a.start - b.start),
    packingArrivals,
    warehouseUnits,
    lastWaveStart,
    lastDeparture,
    duration,
    firstPrintStart,
    firstTransferStart: firstPrint.transferStart,
    firstQualityStart,
    firstQualityEnd,
    mobile: { ...mobile, intervals: mobileIntervals, inspection: { timeline: singleLap, laps: patrolLaps } },
    qualityFailureRate: QUALITY_FAILURE_RATE,
  };
}

let nextOrderNumber = 1;

export function createSimulation(params = DEFAULT_ORDER, { orderId } = {}) {
  const input = { ...DEFAULT_ORDER, ...params };
  const errors = validateOrder(input);
  if (Object.keys(errors).length) throw new RangeError(Object.values(errors).join('，'));

  const order = {
    id: orderId ?? `DT-${String(nextOrderNumber++).padStart(4, '0')}`,
    text: String(input.text).trim(),
    color: input.color,
    width: Number(input.width),
    depth: Number(input.depth),
    height: Number(input.height),
    quantity: Number(input.quantity),
    ...getOrderSpec(input),
  };
  const timeline = buildTimeline(order);
  const sim = {
    order,
    time: 0,
    duration: timeline.duration,
    complete: false,
    stage: '订单建模',
    ...counters,
    events: [],
    stations: {},
    transfers: [],
    timeline,
    milestoneIndex: 0,
    transferIndex: 0,
    activeTransfers: [],
  };
  return stepSimulation(sim, 0);
}

function currentStage(sim) {
  if (sim.complete) return '订单完成';
  if (sim.time < sim.timeline.firstPrintStart) {
    const motion = sim.stations.design.motion;
    if (motion === 'dispatch') return '下发首件任务';
    if (motion === 'slice') return '切片准备';
    return motion === 'check' ? '可打印性检查' : '订单建模';
  }
  if (sim.time < sim.timeline.firstTransferStart) return '首件打样';
  if (sim.time < sim.timeline.firstQualityStart) return '首件输送';
  if (sim.time < sim.timeline.firstQualityEnd) return '首件质检';
  if (sim.stations.dispatch.active) return '出库装车';
  if (sim.stations.staging.active) return '出库集货';
  if (sim.stations.storage.motion === 'retrieve') return '拣货出库';
  if (sim.stations.storage.active) return '智能入库';
  if (sim.stations.sort.active || productionLines.some(({ buffer }) => sim.stations[buffer]?.active)) return '扫码分拣';
  if (sim.good + sim.rejected < sim.order.quantity) return '多机排产';
  if (sim.boxed < sim.good) return '自动装盒';
  if (sim.stored < sim.good) return '智能入库';
  return sim.rejectCleared < sim.rejected ? '不合格品转运与清运' : '收尾与设备回位';
}

function firstAfter(entries, time, key) {
  let first = 0;
  let end = entries.length;
  while (first < end) {
    const middle = (first + end) >>> 1;
    if (entries[middle][key] <= time) first = middle + 1;
    else end = middle;
  }
  return first;
}

function getStationFrame(sim, id, time = sim.time) {
  const phases = sim.timeline.phases[id];
  const index = firstAfter(phases, time, 'end');
  const phase = phases[index];
  if (!phase || time < phase.start) {
    const finished = phases.length > 0 && index === phases.length;
    let action = IDLE_ACTIONS[id];
    if (finished) action = '本单作业完成';
    else if (id === 'design' && index > 0) action = '等待首件质检结果';
    return { active: false, progress: finished ? 1 : 0, phaseProgress: 0, action, unit: null, motion: 'idle' };
  }

  const logistics = sim.timeline.warehouseByUnit.get(phase.unit);
  return {
    active: true,
    progress: Math.min(1, (time - phase.operationStart) / phase.duration),
    phaseProgress: (time - phase.start) / (phase.end - phase.start),
    action: phase.action,
    unit: phase.unit,
    motion: phase.motion,
    slot: logistics?.slot,
    lane: logistics?.lane,
    truckSlot: logistics?.truckSlot,
    wave: logistics?.wave,
  };
}

function deliveryAt(deliveries, time) {
  const index = firstAfter(deliveries, time, 'end');
  const job = deliveries[index];
  if (!job || time < job.start) return null;
  const phases = [
    ['pickup', job.start, job.pickup],
    ['delivery', job.pickup, job.arrival],
    ['install', job.arrival, job.loaded ?? job.arrival],
    ['return', job.loaded ?? job.arrival, job.returned ?? job.end],
    ['recover', job.returned ?? job.end, job.end],
  ];
  const [phase, from, to] = phases.find(([, , end]) => time < end);
  return { ...job, progress: (time - job.start) / (job.end - job.start), phase, phaseProgress: (time - from) / (to - from) };
}

export function seekSimulation(sim, seconds) {
  if (!Number.isFinite(seconds)) return sim;
  const target = Math.max(0, Math.min(sim.duration, seconds));
  if (target < sim.time) {
    Object.assign(sim, counters);
    sim.milestoneIndex = 0;
    sim.transferIndex = 0;
    sim.activeTransfers = [];
    sim.events.length = 0;
  }
  sim.time = target;
  sim.complete = sim.time >= sim.duration;

  while (sim.milestoneIndex < sim.timeline.milestones.length) {
    const event = sim.timeline.milestones[sim.milestoneIndex];
    if (event.time > sim.time) break;
    if (event.count) sim[event.count] += event.amount;
    if (event.message) sim.events.push({ time: event.time, station: event.station, message: event.message });
    sim.milestoneIndex += 1;
  }

  for (const id of STATION_IDS) sim.stations[id] = getStationFrame(sim, id);
  for (const { robot } of productionLines) {
    const arrivals = sim.timeline.packingArrivals[robot];
    const staged = arrivals[firstAfter(arrivals, sim.time, 'readyAt')];
    sim.stations[robot].waitingProduct = Boolean(staged && sim.time >= staged.productReady);
    sim.stations[robot].waitingCarton = Boolean(staged && sim.time >= staged.cartonReady);
  }
  sim.onHand = sim.stored - sim.picked;
  sim.boxesInStock = Math.max(0, sim.boxesReady - sim.boxesConsumed);
  sim.inbound = sim.sorted;
  sim.outbound = sim.loaded;
  sim.warehouse = { capacity: warehouseCapacity, occupancy: sim.onHand, inbound: sim.sorted, outbound: sim.loaded, availableSlots: Math.max(0, warehouseCapacity - sim.onHand) };
  const cartonDelivery = deliveryAt(sim.timeline.cartonDeliveries, sim.time);
  const filamentDelivery = deliveryAt(sim.timeline.filamentDeliveries, sim.time);
  sim.packaging = { capacity: CARTON_CAPACITY, ready: sim.boxesReady, consumed: sim.boxesConsumed,
    inStock: sim.boxesInStock, available: sim.blanksA + sim.blanksB, warehouseStock: sim.blanksWarehouse,
    lineStock: { boxes: sim.blanksA, boxes2: sim.blanksB }, refills: sim.boxRefills, delivery: cartonDelivery };
  if (filamentDelivery) {
    const { phase, phaseProgress, slot } = filamentDelivery;
    const { label } = FILAMENT_COLORS[slot];
    const status = phase === 'install' ? filamentExchangeAt(phaseProgress, slot) : {
      pickup: { state: 'pickup', label: '货架升降台取卷并送上小车' },
      delivery: { state: 'delivery', label: '小车运往低位交接站' },
      return: { state: 'return', label: '小车送回旧卷' },
      recover: { state: 'return', label: '旧卷送入回收位' },
    }[phase];
    filamentDelivery.stageLabel = `${label} · ${status.label}`;
    filamentDelivery.stageState = status.state;
  }
  const remainingByPrinter = {};
  const supplyByPrinter = {};
  const lowThreshold = Math.max(SPOOL_GRAMS * 0.2, sim.order.filamentGrams / FILAMENT_COLORS.length);
  for (const id of printerIds) {
    const remaining = sim.timeline.filamentChanges[id].map((changes) =>
      (changes[firstAfter(changes, sim.time, 'time') - 1]?.remaining ?? SPOOL_GRAMS * 10) / 10);
    remainingByPrinter[id] = remaining;
    const motion = sim.stations[id].motion;
    if (filamentDelivery?.station === id && ['pickup', 'delivery', 'install'].includes(filamentDelivery.phase)) {
      supplyByPrinter[id] = { state: filamentDelivery.stageState, label: filamentDelivery.stageLabel };
    } else if (motion === 'wait-filament') {
      supplyByPrinter[id] = { state: 'wait', label: '余量不足 · 等待小车' };
    } else if (Math.min(...remaining) <= lowThreshold) {
      supplyByPrinter[id] = { state: 'low', label: '耗材余量低' };
    } else {
      supplyByPrinter[id] = { state: 'ready', label: '供料就绪' };
    }
  }
  const deliveredRolls = sim.timeline.filamentDeliveries;
  const lastDelivery = deliveredRolls[firstAfter(deliveredRolls, sim.time, 'end') - 1];
  const parked = !filamentDelivery;
  const battery = parked
    ? Math.min(1, (lastDelivery?.batteryAfter ?? 1) + (sim.time - (lastDelivery?.end ?? 0)) * FILAMENT_ROBOT_CHARGE_RATE)
    : filamentDelivery.batteryStart - (sim.time - filamentDelivery.start) * FILAMENT_ROBOT_DRAIN_RATE;
  const charger = { parked, battery, charging: parked && battery < 1 };
  const stockByColor = sim.timeline.filamentStockChanges.map((jobs) => FILAMENT_STOCK_PER_COLOR - firstAfter(jobs, sim.time, 'pickup'));
  sim.filament = { warehouseStock: sim.rollsWarehouse, stockByColor, spoolGrams: SPOOL_GRAMS, installed: sim.rollsInstalled,
    usedGrams: sim.filamentUsed / 10, recoveredGrams: sim.filamentScrap / 10, delivery: filamentDelivery,
    printers: remainingByPrinter, supply: supplyByPrinter, charger };
  sim.dispatch = { lanes: 1, receiving: ['approach-in', 'dock-in', 'drive-in', 'rack-dock'].includes(sim.stations.sort.motion) || sim.stations.storage.motion === 'putaway',
    shipping: sim.stations.dispatch.active || sim.stations.storage.motion === 'retrieve' };
  const rejects = rejectFrame(sim.timeline.rejectPlan, sim.time, sim.rejectCleared);
  const loadingReject = Number(rejects.job?.kind === 'load' && Boolean(rejects.carrying));
  sim.quality = { rejected: sim.rejected, reworkQueue: sim.reworkQueue, cleared: sim.rejectCleared,
    rackCapacity: REJECT_RACK_SLOTS.length, truckCapacity: REJECT_CARGO_SLOTS.length,
    truckCargo: rejects.cargo.length, trips: rejects.trips, truck: rejects.truck, loading: loadingReject,
    inbound: sim.rejected - sim.reworkQueue - rejects.cargo.length - sim.rejectCleared - loadingReject,
    failureRate: sim.timeline.qualityFailureRate ?? QUALITY_FAILURE_RATE };
  const mobile = sim.timeline.mobile;
  const power = mobile.snapshot(sim.time);
  sim.battery = { fleets: power.fleets, active: Object.values(power.fleets).map((fleet) => fleet.active).filter(Boolean) };
  sim.charging = power.charging;
  const { timeline: patrol, laps } = mobile.inspection;
  const lapIndex = firstAfter(laps, sim.time, 'end');
  const lap = laps[lapIndex];
  const patrolling = Boolean(lap && sim.time >= lap.start && !sim.complete);
  const localTime = patrolling ? sim.time - lap.start : 0;
  const activePatrol = patrolling ? lap.meta : patrol;
  const patrolFrame = getPatrolFrame(localTime, activePatrol);
  const scanIndex = firstAfter(activePatrol.events, localTime, 'end');
  const nextStation = activePatrol.events[scanIndex]?.station ?? patrol.route[0];
  const previousLap = laps[lapIndex - 1];
  const lastScan = patrolling && scanIndex > 0 ? activePatrol.events[scanIndex - 1] : previousLap?.meta.events.at(-1);
  const scanTime = lastScan ? (patrolling && scanIndex > 0 ? lap : previousLap).start + lastScan.end : 0;
  const specialStationNames = { filamentWarehouse: '打印耗材仓', packagingWarehouse: '包装盒仓', 'charge-01': '充电站' };
  const stationLabel = (id) => STATIONS[id]?.shortName ?? specialStationNames[id] ?? id;
  const lastReading = lastScan ? {
    station: stationLabel(lastScan.station),
    action: STATIONS[lastScan.station] ? getStationFrame(sim, lastScan.station, scanTime).action : '巡视记录已更新',
  } : null;
  sim.inspection = { robot: power.fleets.inspectionRobot, route: patrol.route, cycleSeconds: patrol.cycleSeconds,
    active: patrolling, scanning: patrolling && patrolFrame.scanning, station: patrolling ? patrolFrame.station : null,
    nextStation, stationName: stationLabel(patrolling ? patrolFrame.station ?? nextStation : nextStation), lastReading,
    lap: lapIndex, completed: lapIndex * patrol.events.length + scanIndex,
    frame: { ...patrolFrame, moving: patrolling && patrolFrame.moving, scanning: patrolling && patrolFrame.scanning } };
  const { warehouseUnits, lastWaveStart, lastDeparture, transfers, outboundHolds } = sim.timeline;
  const outboundHold = outboundHolds[firstAfter(outboundHolds, sim.time, 'end')];
  sim.finalDeparture = lastDeparture > 0 && sim.time >= lastDeparture;
  sim.logistics = {
    inventory: warehouseUnits.slice(sim.picked, sim.stored),
    outboundHold: outboundHold && sim.time >= outboundHold.start ? outboundHold.unit : null,
    truckCargo: warehouseUnits.slice(sim.finalDeparture ? lastWaveStart : sim.shipped, sim.loaded),
    rejects,
  };
  sim.activeTransfers = sim.activeTransfers.filter(({ end }) => sim.time < end);
  while (sim.transferIndex < transfers.length && transfers[sim.transferIndex].start <= sim.time) {
    const transfer = transfers[sim.transferIndex++];
    if (sim.time < transfer.end) sim.activeTransfers.push(transfer);
  }
  sim.transfers = sim.activeTransfers.map(({ start, end, from, to, kind, unit }) =>
    ({ from, to, kind, unit, progress: (sim.time - start) / (end - start) }));
  sim.stage = currentStage(sim);
  return sim;
}

export function stepSimulation(sim, deltaSeconds) {
  const delta = Number(deltaSeconds);
  return seekSimulation(sim, sim.time + (Number.isFinite(delta) && delta > 0 ? delta : 0));
}
