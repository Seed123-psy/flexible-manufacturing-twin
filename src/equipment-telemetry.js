import { envelopeDoors, getAirUnitMode, getEnvelopeDoorOpening, roofAirUnits } from './building-layout.js';
import { FILAMENT_COLORS } from './filament-exchange.js';
import { conveyorMaterialPose, getMaterialTravel, printerIds, productionLines } from './layout.js';
import { seekSimulation, STATIONS } from './simulation.js';

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const smoothstep = (value, min, max) => {
  const progress = clamp((value - min) / (max - min));
  return progress * progress * (3 - 2 * progress);
};

const MAX_HISTORY = 120;
const MAINS = Object.freeze({ kind: 'mains', batteryPercent: null, charging: false });
const UNMODELED = Object.freeze({ kind: 'unmodeled', batteryPercent: null, charging: false });

function batteryPower(percent, charging = false) {
  return { kind: 'battery', batteryPercent: clamp(percent, 0, 100), charging };
}

function task(orderId, { id = null, unit = null, motion, progress, stationId = null,
  destinationId = null, startedAt = null, endsAt = null, ...details }) {
  return { id, orderId, unit, motion, progress, stationId, destinationId, startedAt, endsAt, ...details };
}

function asset(id, name, type, area, read, { power = MAINS, ...links } = {}) {
  return { catalog: Object.freeze({ id, name, type, area, powerKind: power.kind, ...links }), power, read };
}

function phaseAt(phases, time) {
  let first = 0;
  let last = phases.length;
  while (first < last) {
    const middle = (first + last) >>> 1;
    if (phases[middle].end <= time) first = middle + 1;
    else last = middle;
  }
  return phases[first];
}

function readStation(sim, stationId, motions) {
  const frame = sim.stations[stationId];
  if (!frame.active || (motions && !motions.includes(frame.motion))) {
    return { state: 'idle', activity: motions && frame.active ? '等待本设备作业' : frame.action };
  }
  const waiting = frame.motion.startsWith('wait-') || frame.motion === 'restock';
  const phase = phaseAt(sim.timeline.phases[stationId], sim.time);
  return {
    state: waiting ? 'waiting' : 'working', activity: frame.action,
    task: task(sim.order.id, { unit: frame.unit, stationId, motion: frame.motion, progress: frame.phaseProgress,
      startedAt: phase.start, endsAt: phase.end, operationProgress: frame.progress,
      slot: frame.slot ?? null, lane: frame.lane ?? null, wave: frame.wave ?? null }),
  };
}

function stationAsset(stationId, type, area, options = {}) {
  const { id = STATIONS[stationId].code, name = STATIONS[stationId].name, motions } = options;
  return asset(id, name, type, area, (sim) => readStation(sim, stationId, motions), { stationId });
}

function readPrinter(sim, stationId) {
  const filament = sim.filament;
  const job = filament.delivery?.station === stationId ? filament.delivery : null;
  const supply = filament.supply[stationId];
  const activeSupply = job && ['pickup', 'delivery', 'install'].includes(job.phase);
  return {
    ...readStation(sim, stationId),
    printer: {
      colors: FILAMENT_COLORS.map(({ id, label, code, tint, index }) => {
        const remainingGrams = filament.printers[stationId][index];
        return { id, label, code, tint, remainingGrams, capacityGrams: filament.spoolGrams,
          remainingPercent: clamp(remainingGrams / filament.spoolGrams) * 100 };
      }),
      supply: { ...supply, phase: activeSupply ? job.phase : null, colorId: activeSupply ? FILAMENT_COLORS[job.slot].id : null,
        progress: activeSupply ? job.phaseProgress : null, vehicleId: activeSupply ? 'MAT-01' : null,
        startedAt: activeSupply ? job.start : null, endsAt: activeSupply ? job.loaded : null },
    },
  };
}

const MOBILE_ACTIVITY = {
  standby: '待命', 'handoff-out': '退出任务位，交接班', returning: '驶向充电位', charging: '正在充电',
  exiting: '离开充电位', 'handoff-in': '接替设备，驶入任务位',
};

function readMobile(sim, fleetId, role, stationId) {
  const fleet = sim.battery.fleets[fleetId];
  const agent = fleet[role];
  const interval = agent.interval;
  const result = {
    state: agent.status, activity: MOBILE_ACTIVITY[agent.status],
    power: batteryPower(agent.battery / fleet.capacity * 100, agent.charging),
    details: { role, fleetId, locationId: agent.location?.id ?? null, assigned: fleet.active === agent.id,
      reservePercent: fleet.reserve / fleet.capacity * 100,
      chargeBay: agent.charging && interval?.bay != null ? interval.bay + 1 : null,
      chargerId: !agent.charging ? null : interval.bay != null ? `CH-CEN-0${interval.bay + 1}`
        : fleetId === 'packagingRobot' ? `CH-BOX-${agent.id.slice(-2)}` : null },
  };
  if (!interval) return result;
  const timing = { startedAt: interval.start, endsAt: interval.end };
  if (agent.status !== 'working') {
    result.task = task(sim.order.id, { ...timing, motion: interval.kind, progress: agent.progress,
      destinationId: interval.route.to.id });
    return result;
  }
  if (fleetId === 'inspectionRobot') {
    const patrol = sim.inspection;
    const motion = patrol.scanning ? 'scan' : patrol.frame.moving ? 'patrol' : 'patrol-wait';
    result.activity = `${patrol.scanning ? '巡检扫码' : patrol.frame.moving ? '巡检前往' : '巡检待行'} · ${patrol.stationName}`;
    result.task = task(sim.order.id, { ...timing, id: interval.id, stationId: patrol.station,
      destinationId: patrol.nextStation, motion, progress: agent.progress, lap: patrol.lap + 1 });
  } else if (fleetId === 'packagingRobot') {
    const job = sim.packaging.delivery;
    const labels = { pickup: '盒坯仓取料', delivery: '配送盒坯', return: '补料完成，返回泊位' };
    result.activity = labels[job?.phase] ?? '盒坯补给';
    result.task = task(sim.order.id, { ...timing, id: interval.id, unit: interval.id,
      destinationId: job?.station ?? interval.meta?.station, motion: job?.phase ?? 'refill',
      progress: job?.phaseProgress ?? agent.progress, amount: job?.amount });
  } else {
    const frame = sim.stations[stationId];
    const waitingForHandoff = fleetId === 'loadingRobot' && ['dock-out', 'drive-out'].includes(frame.motion);
    result.state = waitingForHandoff ? 'waiting' : 'working';
    result.activity = waitingForHandoff ? '等待出库 AGV 送达装车位' : frame.action;
    result.task = task(sim.order.id, { ...timing, id: interval.id, unit: frame.unit ?? interval.id,
      stationId, motion: waitingForHandoff ? 'wait-handoff' : frame.motion, progress: frame.phaseProgress });
  }
  return result;
}

function readMat(sim) {
  const { charger, delivery } = sim.filament;
  const state = charger.charging ? 'charging' : delivery ? 'working' : 'standby';
  return {
    state, activity: delivery?.stageLabel ?? (charger.charging ? '取料泊位感应补电' : '取料泊位待命'),
    power: batteryPower(charger.battery * 100, charger.charging),
    task: delivery ? task(sim.order.id, { motion: delivery.phase, progress: delivery.phaseProgress,
      destinationId: delivery.station, colorId: FILAMENT_COLORS[delivery.slot].id,
      startedAt: delivery.start, endsAt: delivery.end }) : null,
    details: { parked: charger.parked, chargerId: 'CH-MAT-01' },
  };
}

function readDocks(robotIds) {
  return (sim) => {
    const chargingRobotIds = robotIds(sim);
    const occupied = chargingRobotIds.length > 0;
    return { state: occupied ? 'working' : 'idle', activity: occupied ? `正在供电 · ${chargingRobotIds.join(' / ')}` : '等待设备对接',
      details: { chargingRobotIds } };
  };
}

function readTransfer(sim, usesTransfer, label) {
  const transfers = sim.transfers.filter(usesTransfer);
  const transfer = transfers[0];
  if (!transfer) return { state: 'idle', activity: '等待来料' };
  return { state: 'working', activity: `${label} · ${transfers.length} 件`,
    task: task(sim.order.id, { unit: transfer.unit, stationId: transfer.from, destinationId: transfer.to,
      motion: transfer.kind, progress: transfer.progress }),
    details: { units: transfers.map(({ unit }) => unit) } };
}

function rangeOfRejectTransfer(sim) {
  const transfer = sim.transfers.find(({ kind }) => kind === 'reject');
  if (!transfer) return null;
  const travel = getMaterialTravel(transfer.from, transfer.to);
  return { transfer, travel, distance: transfer.progress * travel.length };
}

function readRejectLift(sim, liftIndex) {
  const current = rangeOfRejectTransfer(sim);
  if (current) {
    const { transfer, travel, distance } = current;
    const lift = travel.steps.filter(({ vertical }) => vertical)[liftIndex];
    const liftEnd = lift.offset + lift.distance;
    const resetAt = liftEnd + (travel.steps[travel.steps.indexOf(lift) + 1]?.distance ?? 0) + 0.4;
    if (distance >= lift.offset && distance < liftEnd) {
      return { state: 'working', activity: liftIndex === 0 ? '载料上升至高架' : '载料下降至入库台',
        task: task(sim.order.id, { unit: transfer.unit, motion: liftIndex === 0 ? 'lift' : 'lower',
          progress: clamp((distance - lift.offset) / lift.distance) }) };
    }
    if (distance >= resetAt && distance < resetAt + lift.distance) {
      return { state: 'working', activity: '空载复位', task: task(sim.order.id, { motion: 'reset',
        progress: clamp((distance - resetAt) / lift.distance) }) };
    }
  } else if (liftIndex === 1) {
    const feed = sim.logistics.rejects.feed;
    const reset = feed && (sim.time - feed.arrival) * 0.52;
    if (feed && reset >= 0 && reset < 1) {
      return { state: 'working', activity: '空载复位', task: task(sim.order.id, { motion: 'reset', progress: reset }) };
    }
  }
  return { state: 'idle', activity: '等待不合格品托盘' };
}

function readGate(sim, { x, z, targets, jambOffset }) {
  let opening = 0;
  let cause;
  for (const transfer of sim.transfers) {
    if (!targets.includes(transfer.to)) continue;
    if (!getMaterialTravel(transfer.from, transfer.to)) continue;
    const [cargoX, , cargoZ] = conveyorMaterialPose(transfer.from, transfer.to, transfer.kind, transfer.progress).position;
    const offset = cargoX - x;
    const approach = smoothstep(offset, -2.25, -0.69);
    const clear = 1 - smoothstep(offset, 0.63, 1.31);
    const aligned = 1 - smoothstep(Math.abs(cargoZ - z), jambOffset - 0.19, jambOffset + 0.21);
    const candidate = smoothstep(approach * clear * aligned, 0.10, 0.86);
    if (candidate > opening) {
      opening = candidate;
      cause = transfer;
    }
  }
  return { state: opening === 0 ? 'closed' : opening >= 0.99 ? 'open' : 'working',
    activity: opening === 0 ? '闸门关合' : opening >= 0.99 ? '闸门开启，物料通行' : '闸门升降联动',
    task: cause ? task(sim.order.id, { unit: cause.unit, stationId: cause.from, destinationId: cause.to,
      motion: 'transfer-gate', progress: cause.progress }) : null,
    details: { openingPercent: opening * 100 } };
}

function readDispatchTruck(sim) {
  const frame = sim.stations.dispatch;
  const inTransit = ['depart', 'truck-return'].includes(frame.motion);
  const cargoCount = sim.logistics.truckCargo.length;
  return {
    state: inTransit ? frame.motion === 'depart' ? 'departing' : 'returning' : sim.finalDeparture ? 'offsite' : 'docked',
    activity: inTransit ? frame.action : sim.finalDeparture ? '末班车已发运' : frame.active ? '停靠月台装车' : '停靠月台待装',
    task: inTransit || frame.active ? task(sim.order.id, { unit: frame.unit, stationId: 'dispatch',
      motion: frame.motion, progress: frame.phaseProgress, wave: frame.wave }) : null,
    details: { cargoCount, shipped: sim.shipped },
  };
}

function readRejectTruck(sim) {
  const { truck, cargo, job, trips } = sim.logistics.rejects;
  const tripIndex = truck === 'departing' ? trips : trips - 1;
  const trip = truck === 'docked' ? null : sim.timeline.rejectPlan.trips[tripIndex];
  const labels = { docked: '停靠废品月台', departing: '驶向场外交接点', offsite: '场外卸货与交接', returning: '空车返回月台' };
  const range = trip && { departing: [trip.depart, trip.handover], offsite: [trip.handover, trip.returnStart],
    returning: [trip.returnStart, trip.returned] }[truck];
  return { state: truck, activity: labels[truck],
    task: range ? task(sim.order.id, { motion: truck, progress: clamp((sim.time - range[0]) / (range[1] - range[0])),
      stationId: 'reject', startedAt: range[0], endsAt: range[1], trip: tripIndex + 1 })
      : job?.kind === 'load' ? task(sim.order.id, { unit: job.unit, motion: 'load', stationId: 'reject',
        progress: clamp((sim.time - job.start) / job.span), startedAt: job.start, endsAt: job.end }) : null,
    details: { cargoCount: cargo.length, trips } };
}

const definitions = [stationAsset('design', 'workstation', '设计办公室')];
for (const [index, line] of productionLines.entries()) {
  const letter = index === 0 ? 'A' : 'B';
  const area = `${letter} 产线`;
  for (const stationId of line.printers) {
    const code = STATIONS[stationId].code;
    definitions.push(asset(code, STATIONS[stationId].name, 'printer', area,
      (sim) => readPrinter(sim, stationId), { stationId }));
    definitions.push(stationAsset(stationId, 'spool-changer', area, {
      id: `AMS-${code.slice(-2)}`, name: `${STATIONS[stationId].shortName} 自动换卷机`, motions: ['load-filament'],
    }));
  }
  definitions.push(stationAsset(line.quality, 'inspection-cell', area),
    stationAsset(line.boxes, 'carton-former', area),
    stationAsset(line.robot, 'fixed-robot', area, { motions: ['approach', 'grasp', 'lift', 'turn', 'place', 'release', 'seal'] }),
    stationAsset(line.robot, 'sealer', area, { id: `SEAL-${letter}`, name: `${letter} 线封盒机`, motions: ['seal'] }),
    stationAsset(line.robot, 'labeler', area, { id: `LBL-${letter}`, name: `${letter} 线打印贴标与复核机`, motions: ['label', 'review'] }),
    stationAsset(line.buffer, 'outfeed', area),
    asset(`CV-${letter}-PR`, `${letter} 线打印出料滚筒`, 'conveyor', area,
      (sim) => readTransfer(sim, ({ from, to }) => line.printers.includes(from) && to === line.quality, '运送打印托盘')),
    asset(`CV-${letter}-QC`, `${letter} 线合格品转运滚筒`, 'conveyor', area,
      (sim) => readTransfer(sim, ({ from, to }) => from === line.quality && to === line.robot, '运送合格工件')),
    asset(`CV-${letter}-BX`, `${letter} 线制盒出料滚筒`, 'conveyor', area,
      (sim) => readTransfer(sim, ({ from }) => from === line.boxes, '输送成型纸盒')),
    asset(`CV-${letter}-RB`, `${letter} 线装盒出料滚筒`, 'conveyor', area,
      (sim) => readTransfer(sim, ({ from }) => from === line.robot, '输送封装成品')));
}

for (const [fleetId, prefix, label, type, area, stationId] of [
  ['inboundAgv', 'AGV-IN', '入库 AGV', 'agv', '仓储', 'sort'],
  ['outboundAgv', 'AGV-OUT', '出库 AGV', 'agv', '发运月台', 'dispatch'],
  ['loadingRobot', 'LOAD', '装车机器人', 'mobile-robot', '发运月台', 'dispatch'],
  ['packagingRobot', 'BOX', '盒坯补给机器人', 'mobile-robot', '物料出入口'],
  ['inspectionRobot', 'INSP', '全厂巡检机器人', 'mobile-robot', '巡检通道'],
]) {
  for (const [role, number, description] of [['primary', '01', '主机'], ['backup', '02', '备机']]) {
    definitions.push(asset(`${prefix}-${number}`, `${label} · ${description}`, type, area,
      (sim) => readMobile(sim, fleetId, role, stationId), { power: batteryPower(100), fleetId, role, stationId }));
  }
}

definitions.push(
  asset('MAT-01', 'RGB 卷料补给车', 'material-cart', '耗材仓', readMat, { power: batteryPower(100) }),
  asset('MAT-LIFT-01', 'RGB 耗材仓取卷升降台', 'lift', '耗材仓', (sim) => {
    const job = sim.filament.delivery;
    const moving = job && ['pickup', 'recover'].includes(job.phase);
    return { state: moving ? 'working' : 'idle', activity: moving ? job.stageLabel : '等待取卷或回收旧卷',
      task: moving ? task(sim.order.id, { destinationId: job.station, motion: job.phase, progress: job.phaseProgress,
        colorId: FILAMENT_COLORS[job.slot].id }) : null,
      details: { stockByColor: Object.fromEntries(FILAMENT_COLORS.map(({ id, index }) => [id, sim.filament.stockByColor[index]])),
        warehouseStock: sim.filament.warehouseStock } };
  }),
  asset('CH-MAT-01', '卷料补给车感应充电座', 'charger', '耗材仓',
    readDocks((sim) => sim.filament.charger.charging ? ['MAT-01'] : [])),
  ...['primary', 'backup'].map((role, index) => asset(`CH-BOX-0${index + 1}`, `盒坯机器人充电座 ${index + 1}`,
    'charger', '物料出入口', readDocks((sim) => {
      const robot = sim.battery.fleets.packagingRobot[role];
      return robot.charging ? [robot.id] : [];
    }))),
  ...[0, 1].map((bay) => asset(`CH-CEN-0${bay + 1}`, `中央充电仓 ${bay + 1} 号位`, 'charger', '仓储',
    readDocks((sim) => sim.charging.intervals.filter((interval) => interval.bay === bay).map(({ agent }) => agent)))),
  asset('CV-MERGE', '双线成品合流滚筒', 'conveyor', '仓储',
    (sim) => readTransfer(sim, ({ to }) => to === 'presort', '输送待收货纸箱')),
  stationAsset('presort', 'accumulation-conveyor', '仓储'),
  stationAsset('scan', 'scanner', '仓储'),
  stationAsset('sort', 'sorter', '仓储', { motions: ['scan', 'divert', 'wait-agv'] }),
  stationAsset('exception', 'exception-bypass', '仓储'),
  asset('CV-SCAN', '主扫描与分拣连接滚筒', 'conveyor', '仓储',
    (sim) => readTransfer(sim, ({ from, to }) => to === 'scan' || from === 'scan' || from === 'exception', '输送分拣纸箱')),
  asset('WH-01', '智能立库堆垛机', 'stacker', '仓储',
    (sim) => ({ ...readStation(sim, 'storage'), details: { ...sim.warehouse } }), { stationId: 'storage' }),
  stationAsset('staging', 'staging-conveyor', '发运月台'),
  stationAsset('dispatch', 'loading-conveyor', '发运月台', { motions: ['human-place', 'stow'] }),
  asset('TRUCK-OUT-01', '成品发运货车', 'truck', '发运月台', readDispatchTruck, { power: UNMODELED }),
  asset('DOOR-TRUCK-01', '货车侧装卷门', 'powered-door', '发运月台', (sim) => {
    const frame = sim.stations.dispatch;
    const fraction = frame.motion === 'depart' ? 1 - smoothstep(frame.phaseProgress, 0, 0.26)
      : frame.motion === 'truck-return' ? smoothstep(frame.phaseProgress, 0.77, 1) : Number(!sim.finalDeparture);
    return { state: fraction === 0 ? 'closed' : fraction === 1 ? 'open' : 'working',
      activity: fraction === 0 ? '侧门关闭' : fraction === 1 ? '侧门开启' : frame.action,
      details: { openingPercent: fraction * 100 } };
  }, { power: UNMODELED }),
  ...[0, 1].map((index) => asset(`RJ-LIFT-0${index + 1}`, `不合格品升降机 ${index + 1}`, 'lift', '不合格品周转区',
    (sim) => readRejectLift(sim, index))),
  asset('CV-REJECT', '不合格品地面转运滚筒', 'conveyor', '不合格品周转区', (sim) => {
    const current = rangeOfRejectTransfer(sim);
    const lifts = current?.travel.steps.filter(({ vertical }) => vertical);
    return readTransfer(sim, (transfer) => transfer === current?.transfer && (current.distance < lifts[0].offset
      || current.distance >= lifts[1].offset + lifts[1].distance), '输送不合格品托盘');
  }),
  asset('CV-REJECT-SKY', '不合格品高架转运滚筒', 'conveyor', '不合格品周转区', (sim) => {
    const current = rangeOfRejectTransfer(sim);
    const lifts = current?.travel.steps.filter(({ vertical }) => vertical);
    return readTransfer(sim, (transfer) => transfer === current?.transfer && current.distance >= lifts[0].offset + lifts[0].distance
      && current.distance < lifts[1].offset, '高架输送不合格品');
  }),
  asset('QA-OUT', '不合格品龙门装载机', 'gantry', '不合格品周转区',
    (sim) => ({ ...readStation(sim, 'reject'), details: { rackOccupancy: sim.logistics.rejects.rack.length,
      rackCapacity: sim.quality.rackCapacity } }), { stationId: 'reject' }),
  ...envelopeDoors.filter(({ type }) => type === 'vehicle').map(({ id, label, station }) =>
    asset(id, `${label}卷帘门`, 'powered-door', '厂房东侧', (sim) => {
      const opening = getEnvelopeDoorOpening(station, sim);
      return { state: opening === 1 ? 'open' : opening === 0 ? 'closed' : 'working',
        activity: `卷帘门开度 ${Math.round(opening * 100)}%`, details: { openingPercent: opening * 100 } };
    })),
  ...roofAirUnits.map((unit) => {
    const { id, duct, system } = unit;
    return asset(id, `空调${system === 'return' ? '回风' : '送风'}机组 ${id.slice(-1)}`,
      'hvac', '厂房顶棚', (sim) => {
        const mode = getAirUnitMode(unit, sim);
        const airflow = system === 'return' ? '回风' : '送风';
        return { state: 'working', activity: `${mode === 'boost' ? '增强' : '常态'}${airflow} · ${duct}`,
          details: { mode, duct } };
      });
  }),
  asset('TRUCK-RJ-01', '不合格品清运货车', 'truck', '不合格品周转区', readRejectTruck, { power: UNMODELED }),
  ...[
    ['DOOR-A', 'A 线恒温物流门', 'A 产线', { x: 1.7, z: -1.43, targets: ['quality', 'quality2'], jambOffset: 0.65 }],
    ['DOOR-B', 'B 线恒温物流门', 'B 产线', { x: 1.7, z: 10.07, targets: ['quality2'], jambOffset: 0.65 }],
    ['DOOR-WH', '仓储隔热门', '仓储', { x: 15.98, z: 2.72, targets: ['sort', 'exception'], jambOffset: 1.38 }],
  ].map(([id, name, area, gate]) => asset(id, name, 'powered-door', area, (sim) => readGate(sim, gate))),
);

const definitionsById = new Map(definitions.map((definition) => [definition.catalog.id, definition]));
export const EQUIPMENT_CATALOG = Object.freeze(definitions.map(({ catalog }) => catalog));

function readAsset({ catalog, power, read }, sim) {
  return { ...catalog, time: sim.time, power, task: null, printer: null, details: null, ...read(sim) };
}

function replayTime(sim, elapsed) {
  if (!Number.isFinite(elapsed)) throw new RangeError('elapsed must be a finite number of simulation seconds');
  return clamp(elapsed, 0, sim.duration);
}

function replayCursor(sim) {
  // Only the mutable seek cursor is copied. All readers use the same scheduled operations.
  return { ...sim, events: [], stations: {}, activeTransfers: [...sim.activeTransfers] };
}

/**
 * Read a complete equipment frame at any simulation time without updating the caller's simulation.
 * `time` and task times are simulation seconds. Percent readings use 0–100, task progress uses 0–1.
 * `printer` is null on other equipment, and `task` is null if the equipment has no assigned operation.
 */
export function getEquipmentTelemetry(sim, elapsed = sim.time) {
  const time = replayTime(sim, elapsed);
  const frame = time === sim.time ? sim : seekSimulation(replayCursor(sim), time);
  return { time, duration: sim.duration, orderId: sim.order.id, assets: definitions.map((entry) => readAsset(entry, frame)) };
}

/** Read at most 120 per-asset samples, oldest first, ending at the requested replay time. */
export function getEquipmentHistory(sim, elapsed, assetId, { limit = 12, intervalSeconds = 5 } = {}) {
  const definition = definitionsById.get(assetId);
  if (!definition) return [];
  const time = replayTime(sim, elapsed ?? sim.time);
  if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) throw new RangeError('intervalSeconds must be positive');
  if (!Number.isFinite(limit)) throw new RangeError('limit must be finite');
  const count = clamp(Math.trunc(limit), 0, MAX_HISTORY);
  if (count === 0) return [];
  const samples = [time];
  // Walk back from the requested playhead. Include t=0 once when it lies in the history window.
  for (let offset = 1; offset < count && samples.at(-1) > 0; offset += 1) {
    const earlier = Math.max(0, time - offset * intervalSeconds);
    if (earlier === samples.at(-1)) break;
    samples.push(earlier);
  }
  const cursor = replayCursor(sim);
  return samples.reverse().map((at) => readAsset(definition, at === sim.time ? sim : seekSimulation(cursor, at)));
}
