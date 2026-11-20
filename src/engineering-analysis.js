import { COLORS, STATIONS } from './simulation.js';
import { palletDepth, palletHeight, palletWidth, printerIds, productionLines } from './layout.js';
import { rackColumns, rackLevels, shippingSlot, warehouseCapacity, warehouseWaveSize } from './logistics-layout.js';
import { FILAMENT_COLORS, FILAMENT_SPOOL_GRAMS, FILAMENT_STOCK_PER_COLOR } from './filament-exchange.js';
import { REJECT_CARGO_SLOTS, REJECT_RACK_SLOTS } from './reject-layout.js';

const HOUR = 3600;
const stageGroups = [
  { id: 'print', label: '打印 · 冷却 · 出件', ids: printerIds },
  { id: 'quality', label: '清理 · 尺寸与外观质检', ids: productionLines.map(line => line.quality) },
  { id: 'boxes', label: '制盒 · 印刷与折叠', ids: productionLines.map(line => line.boxes) },
  { id: 'packing', label: '机械臂装盒 · 封贴', ids: productionLines.map(line => line.robot) },
  { id: 'buffer', label: '成品接驳 · 箱标复核', ids: productionLines.map(line => line.buffer) },
  { id: 'merge', label: '共用合流 · 粗分与扫描', ids: ['presort', 'scan', 'exception'] },
  { id: 'sort', label: '分流 · 入库 AGV 往返', ids: ['sort'] },
  { id: 'storage', label: '堆垛机上架 · 拣取', ids: ['storage'] },
  { id: 'dispatch', label: '出库接箱 · 装车与发车', ids: ['dispatch'] },
];

const byMotion = {
  waveMotions: new Set(['depart', 'truck-return']),
  blocks: new Set(['restock', 'load-filament', 'wait-filament', 'wait-outfeed', 'wait-merge', 'wait-agv']),
};

function unionSeconds(intervals) {
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  let end = -Infinity;
  let total = 0;
  for (const span of sorted) {
    if (span.end > end) total += span.end - Math.max(end, span.start);
    end = Math.max(end, span.end);
  }
  return total;
}

function resourceWork(id, spans, shipped, label = STATIONS[id]?.shortName) {
  const service = [];
  const batch = [];
  const first = [];
  const visits = new Set();
  const batchVisits = new Set();
  const phases = new Map();
  for (const span of spans) {
    if (!(span.end > span.start)) continue;
    const { unit, motion } = span;
    const action = ({ putaway: '堆垛机将纸箱上架', retrieve: '堆垛机按单拣箱' })[motion] ?? span.action;
    const kind = byMotion.blocks.has(motion) ? 'blocked' : byMotion.waveMotions.has(motion) ? 'wave' : 'work';
    const phaseKey = `${motion}:${action}`;
    if (!phases.has(phaseKey)) phases.set(phaseKey, { motion, action, kind, count: 0, seconds: 0 });
    const phase = phases.get(phaseKey);
    phase.count += 1;
    phase.seconds += span.end - span.start;
    if (kind !== 'blocked') service.push(span);
    // A departure is assigned the last unit ID in its wave, but is not a unit visit.
    if (kind !== 'work' || unit == null) continue;
    visits.add(unit);
    if (unit === 1) first.push(span);
    else {
      batch.push(span);
      batchVisits.add(unit);
    }
  }
  const busySeconds = unionSeconds(service);
  const occupiedSeconds = unionSeconds(spans);
  return {
    id, code: STATIONS[id]?.code ?? id.toUpperCase(), label,
    visits: visits.size, batchVisits: batchVisits.size,
    busySeconds, blockedSeconds: Math.max(0, occupiedSeconds - busySeconds),
    firstArticleSeconds: first.length ? unionSeconds(first) : null,
    batchSecondsPerVisit: batchVisits.size ? unionSeconds(batch) / batchVisits.size : null,
    ratePerHour: busySeconds > 0 && visits.size ? HOUR * visits.size / busySeconds : null,
    secondsPerGood: shipped > 0 ? busySeconds / shipped : null,
    phases: [...phases.values()],
  };
}

function mergeSpans(transfers) {
  const entries = new Map();
  const bufferIds = new Set(productionLines.map(line => line.buffer));
  const spans = [];
  for (const span of transfers) {
    if (span.to === 'presort' && bufferIds.has(span.from)) entries.set(span.unit, span.start);
    if (span.to === 'sort' && entries.has(span.unit)) {
      spans.push({ start: entries.get(span.unit), end: span.end, unit: span.unit, motion: 'merge-window',
        action: '接驳口放行至分拣入口（含输送、粗分、扫描及复核旁路）' });
    }
  }
  return spans;
}

function summarizeSchedule(timeline, shipped) {
  return stageGroups.map(({ id, label, ids }) => {
    const resources = ids.map(station => resourceWork(station, timeline.phases[station] ?? [], shipped));
    // These stations lie in a single reserved merge path. Do not add their rates in parallel.
    const modeled = id === 'merge' ? [resourceWork('merge', mergeSpans(timeline.transfers), shipped, '共用合流路径')] : resources;
    const active = modeled.filter(resource => resource.visits > 0);
    const controllingResource = active.reduce((slowest, resource) =>
      !slowest || resource.busySeconds > slowest.busySeconds ? resource : slowest, null);
    const secondsPerGood = controllingResource?.secondsPerGood ?? null;
    return { id, label, configuredResources: modeled.length, activeResources: active.length,
      controllingResource, secondsPerGood,
      ratePerHour: secondsPerGood > 0 ? HOUR / secondsPerGood : null,
      parallelRatePerHour: active.length ? active.reduce((total, resource) => total + resource.ratePerHour, 0) : null,
      resources: id === 'merge' ? [...modeled, ...resources] : resources };
  });
}

const sharedZones = [
  ['east', '仓储东侧共用通道', 'warehouse-east-service'],
  ['inbound', '入库对接口', 'inbound-dock-mouth'],
  ['north', '北侧共用通道', 'north-service'],
  ['west', '西侧补给通道', 'west-supply-service'],
];
const mobileActions = {
  work: '作业占用', 'handoff-out': '交班驶出', 'handoff-in': '接班驶入',
  approach: '驶向充电位', exit: '离开充电位', charging: '充电', return: '充电后或交班后返回',
  filament: '卷料取送、换卷及回收',
};

function summarizeSharedZones(timeline, shipped, lastDeparture) {
  return sharedZones.map(([id, label, key]) => {
    const reservations = timeline.mobile.intervals.filter(span => span.resources.includes(`zone:${key}`));
    // Filament transport reserves the west lane directly, not through the mobile fleet interval log.
    if (id === 'west') for (const exchange of timeline.filamentDeliveries) reservations.push({ ...exchange, kind: 'filament' });
    const clipped = reservations.filter(span => span.start < lastDeparture).map(span => ({
      start: span.start, end: Math.min(span.end, lastDeparture), motion: span.kind,
      action: mobileActions[span.kind] ?? span.kind,
    }));
    const resource = resourceWork(id, clipped, shipped, label);
    const secondsPerGood = resource.secondsPerGood;
    return { id, label, kind: 'zone', configuredResources: 1, activeResources: Number(resource.busySeconds > 0),
      controllingResource: resource, secondsPerGood,
      ratePerHour: secondsPerGood > 0 ? HOUR / secondsPerGood : null,
      utilization: lastDeparture > 0 ? resource.busySeconds / lastDeparture : null,
      resources: [resource] };
  });
}

function cadence(count, firstAt, lastAt) {
  const secondsPerUnit = count > 1 && lastAt > firstAt ? (lastAt - firstAt) / (count - 1) : null;
  return { count, firstAt, lastAt, secondsPerUnit, ratePerHour: secondsPerUnit ? HOUR / secondsPerUnit : null };
}

function cartonSceneBody(part, carton) {
  // Match models.js cartonDimensions and the closed body/lid, excluding tape and decals.
  // The renderer's scale is deliberately enlarged; these are scene coordinates, not millimetres.
  const rounded = (axis, multiplier, floor) =>
    Math.round((part[axis] * 0.0055 + Math.max((carton[axis] - part[axis]) * multiplier, floor)) * 100) / 100;
  return { width: rounded('width', 0.005, 0.12), depth: rounded('depth', 0.006, 0.11),
    height: rounded('height', 0.0045, 0.07) + 0.023 * 1.5 };
}

function totalsFrom(milestones) {
  const counts = Object.create(null);
  const peaks = Object.create(null);
  let firstBoxedAt = null;
  let lastBoxedAt = null;
  for (const { count, amount, time } of milestones) {
    if (!count) continue;
    counts[count] = (counts[count] ?? 0) + amount;
    peaks[count] = Math.max(peaks[count] ?? 0, counts[count]);
    if (count === 'stored' || count === 'picked') {
      peaks.onHand = Math.max(peaks.onHand ?? 0, (counts.stored ?? 0) - (counts.picked ?? 0));
    }
    if (count === 'boxed') {
      firstBoxedAt ??= time;
      lastBoxedAt = time;
    }
  }
  return { counts, peaks, firstBoxedAt, lastBoxedAt };
}

function filamentUsage(timeline) {
  return FILAMENT_COLORS.map(({ id, label, code, index }) => {
    let perUnitTenths = null;
    let usedTenths = 0;
    for (const changes of Object.values(timeline.filamentChanges)) {
      let previous = FILAMENT_SPOOL_GRAMS * 10;
      for (const { remaining } of changes[index]) {
        const delta = previous - remaining;
        if (delta > 0) {
          perUnitTenths ??= delta;
          usedTenths += delta;
        }
        previous = remaining;
      }
    }
    return { id, label, code, gramsPerUnit: perUnitTenths == null ? null : perUnitTenths / 10,
      orderGrams: usedTenths / 10, warehouseSpools: FILAMENT_STOCK_PER_COLOR };
  });
}

/** Compare an explicit shift target to the modeled rate; this does not calibrate the clocks. */
export function calculateEngineeringTakt(availableMinutes, demandPerShift, wholeOrderRatePerHour) {
  const netShiftSeconds = availableMinutes * 60;
  if (!Number.isFinite(netShiftSeconds) || netShiftSeconds <= 0 || !Number.isSafeInteger(demandPerShift) || demandPerShift <= 0) return null;
  const taktSeconds = netShiftSeconds / demandPerShift;
  const ratePerHour = HOUR / taktSeconds;
  if (!Number.isFinite(ratePerHour)) return null;
  const modeledSecondsPerGood = Number.isFinite(wholeOrderRatePerHour) && wholeOrderRatePerHour > 0 ? HOUR / wholeOrderRatePerHour : null;
  return { netShiftSeconds, demandPerShift, taktSeconds, ratePerHour, modeledSecondsPerGood,
    gapSeconds: modeledSecondsPerGood == null ? null : modeledSecondsPerGood - taktSeconds };
}

/** Analyze the active order's deterministic schedule, independent of playback position. */
export function buildEngineeringAnalysis(sim) {
  if (!sim?.order || !sim?.timeline) return null;
  const { order, timeline } = sim;
  const { counts, peaks, firstBoxedAt, lastBoxedAt } = totalsFrom(timeline.milestones);
  const shipped = counts.shipped ?? 0;
  const lastDeparture = timeline.lastDeparture || null;
  const stages = summarizeSchedule(timeline, shipped);
  const zones = summarizeSharedZones(timeline, shipped, lastDeparture);
  const mostLoaded = (rows) => rows.reduce((slowest, row) =>
    row.secondsPerGood > (slowest?.secondsPerGood ?? 0) ? row : slowest, null)?.id ?? null;
  const input = { width: order.width, depth: order.depth, height: order.height };
  const product = { ...order.productSize };
  const carton = { ...order.box };
  // Reconstruct initial blank inventory from the frame and all applied stock draws.
  const drawnBlanks = timeline.cartonDeliveries.reduce((total, delivery) =>
    total + (delivery.pickup <= sim.time ? delivery.amount : 0), 0);
  const waves = new Map();
  for (const { wave } of timeline.warehouseUnits) waves.set(wave, (waves.get(wave) ?? 0) + 1);
  const peakWave = [...waves.values()].reduce((max, size) => Math.max(max, size), 0);
  return {
    order: { id: order.id, text: order.text, quantity: order.quantity },
    materials: {
      // This local reference describes the active configuration; it is not an ERP-issued SKU.
      configurationRef: `CD/${input.width}×${input.depth}×${input.height}/${order.color === 'original' ? 'ORG' : order.color.slice(1).toUpperCase()}`,
      procurementSku: null,
      finish: COLORS.find(color => color.value.toLowerCase() === order.color.toLowerCase())?.label ?? order.color,
      requestedMm: input, productMm: product,
      unitFilamentGrams: order.filamentGrams,
      estimate: { fillFactor: 0.12, densityGramsPerCm3: 1.24 },
      orderFilamentGrams: (counts.filamentUsed ?? 0) / 10,
      recoveredFilamentGrams: (counts.filamentScrap ?? 0) / 10,
      spoolGrams: FILAMENT_SPOOL_GRAMS, colors: filamentUsage(timeline),
      spoolExchanges: timeline.filamentDeliveries.length,
      cartonMm: carton,
      nominalCartonMinusPartMm: { width: carton.width - product.width, depth: carton.depth - product.depth, height: carton.height - product.height },
      unitsPerCarton: 1, cartonsFormed: counts.boxesReady ?? 0,
      cartonRefills: timeline.cartonDeliveries.length,
      lineSideBlankCapacity: sim.packaging.capacity,
      initialBlankWarehouseStock: sim.packaging.warehouseStock + drawnBlanks,
      unknown: { cartonGrade: null, cartonTareGrams: null, filamentGrade: null, filamentDiameterMm: null },
    },
    envelope: {
      unknown: { grossMassGrams: null, centerOfGravity: null, workingLoadRatings: null, verifiedClearances: null },
      cartonBodyScene: cartonSceneBody(product, carton),
      palletScene: { width: palletWidth, depth: palletDepth, height: palletHeight },
      warehouse: { columns: rackColumns.length, levels: rackLevels.length, slots: warehouseCapacity, peakOnHand: peaks.onHand ?? 0,
        columnPitchScene: rackColumns[1] - rackColumns[0], levelPitchScene: rackLevels[1] - rackLevels[0] },
      shipment: { cartonsPerWave: warehouseWaveSize, waves: waves.size, peakCartonsPerWave: peakWave,
        unitNetGrams: order.filamentGrams, peakWaveNetGrams: Math.round(peakWave * order.filamentGrams * 10) / 10,
        cartonsPerAgvTrip: 1, loadingLanes: sim.dispatch.lanes,
        slotPitchXScene: Math.abs(shippingSlot(1)[0] - shippingSlot(0)[0]),
        slotPitchZScene: Math.abs(shippingSlot(3)[2] - shippingSlot(0)[2]) },
      reject: { slots: REJECT_RACK_SLOTS.length, truckSlots: REJECT_CARGO_SLOTS.length, peakOnRack: peaks.reworkQueue ?? 0,
        trips: timeline.rejectPlan.trips.length },
    },
    balance: {
      shipped, rejected: counts.rejected ?? 0,
      wholeOrder: { lastDeparture, elapsedSeconds: lastDeparture, playbackSeconds: timeline.duration,
        ratePerHour: lastDeparture > 0 ? HOUR * shipped / lastDeparture : null },
      packingCadence: cadence(counts.boxed ?? 0, firstBoxedAt, lastBoxedAt),
      setup: resourceWork('design', timeline.phases.design, shipped),
      stages, zones, constraint: mostLoaded([...stages, ...zones]), stationConstraint: mostLoaded(stages),
      // Order quantity is a lot size, not demand per shift. Neither input exists in this simulation.
      target: { demandPerShift: null, netShiftSeconds: null, taktSeconds: null, ratePerHour: null },
    },
  };
}
