import { FILAMENT_COLORS, FILAMENT_SPOOL_GRAMS, FILAMENT_STOCK_PER_COLOR } from './filament-exchange.js';
import { readOrderReplays, startOrderReplay, storeOrderReplay } from './order-replays.js';
import { initEquipmentPanel } from './equipment-panel.js';
import { getEquipmentHistory, getEquipmentTelemetry } from './equipment-telemetry.js';
import { shell } from './shell.js';
import { mountRouteMap } from './factory-route-map.js';
import { paintEngineeringAnalysis } from './engineering-analysis-panel.js';
import './style.css';
import './control-room.css';
import './engineering-drawing.css';
import './engineering-analysis.css';
import { productionLines } from './layout.js';
import { warehouseAddress, warehouseCapacity, warehouseWaveSize } from './logistics-layout.js';
import { loadProductModel } from './models.js';
import { mountFactory, mountProductPreview } from './scene.js';
import { formatShiftClock, isNightShift, shiftMinuteAt } from './lighting-shift.js';
import {
  COLORS, DEFAULT_ORDER, ORDER_LIMITS, PRESETS, STATIONS, createSimulation,
  getOrderSpec, seekSimulation, stepSimulation, validateOrder,
} from './simulation.js';

document.getElementById('app').innerHTML = shell;
const $ = (id) => document.getElementById(id);
const drawRouteMap = mountRouteMap($('route-map-panel'), undefined, { cleanView: true });
const drawingTools = document.querySelector('.drawing-tools');
const drawingPause = $('drawing-pause');
const engineeringMarkings = $('engineering-markings');
const lightingControls = [...document.querySelectorAll('[data-lighting-mode]')];
const lightingReadouts = [...document.querySelectorAll('[data-lighting-state]')];
let lightingMode = 'auto';
let displayedShiftMinute;
let displayedNightShift;
const ids = Object.fromEntries([
  'viewport', 'stage', 'quantity', 'good', 'sorted', 'stored', 'onHand', 'shipped', 'warehouse', 'cartons', 'rejects', 'dispatching', 'robotPower', 'robotBackup', 'patrol', 'ecoHold', 'flow-alert', 'device-name',
  'station-list-office', 'station-list-line-a', 'station-list-line-b', 'station-list-logistics',
  'zone-charging-value', 'zone-charging-meta', 'zone-backup-value', 'zone-backup-meta', 'zone-patrol-value', 'zone-patrol-meta', 'zone-eco-value', 'zone-eco-meta',
  'device-code', 'device-role', 'device-action', 'device-progress', 'device-percent',
  'device-order', 'device-extra', 'device-supply-actions', 'focus-supply', 'seek-supply', 'seek-pickup',
  'device-reject-actions', 'seek-reject-load', 'seek-reject-trip',
  'status-text', 'run-single', 'run-batch', 'run-scale', 'pause',
  'speed', 'custom-order', 'timeline-label', 'timeline-time', 'timeline-progress',
  'event-log', 'order-dialog', 'order-form', 'order-preview', 'order-estimate',
  'order-cancel', 'order-submit', 'order-error',
].map((id) => [id, $(id)]));
const fields = Object.fromEntries(['text', 'color', 'width', 'depth', 'height', 'quantity']
  .map((id) => [id, $(`order-${id}`)]));

const stationButtons = {};
const laneStations = (line) => [...line.printers, line.quality, line.boxes, line.robot, line.buffer];
const printerIds = new Set(productionLines.flatMap((line) => line.printers));
const supplyLabels = {
  ready: '供料就绪', low: '耗材余量低', wait: '等待卷料配送',
  handoff: '低位接卷', 'hand-off': '低位接卷', lift: '举升新卷',
  unload: '卸下旧卷', insert: '装入新卷', verify: '确认进料',
};
const deliveryLabels = {
  pickup: '小车取新卷', delivery: '运送新卷', install: '正在更换耗材', return: '小车送回旧卷',
};
const warehouses = ['sort', 'exception', 'reject', 'storage', 'staging', 'dispatch'];
const stationGroups = {
  office: ['design'],
  'line-a': laneStations(productionLines[0]),
  'line-b': laneStations(productionLines[1]),
  logistics: warehouses,
};
const cameraRegions = {
  production: [...stationGroups['line-a'], ...stationGroups['line-b']],
  lineA: stationGroups['line-a'],
  lineB: stationGroups['line-b'],
  logistics: warehouses,
};
const lineSteps = ['quality', 'boxes', 'robot', 'buffer'];
const productionRoles = Object.fromEntries(lineSteps.map((step) => [step, productionLines.map((line) => line[step])]));
const flowStations = {
  design: ['design'],
  print: productionLines.flatMap((line) => line.printers),
  qualityPack: [...productionRoles.quality, ...productionRoles.boxes, ...productionRoles.robot, ...productionRoles.buffer],
  boxSupply: productionRoles.boxes,
  exception: ['reject'],
  sort: ['sort'],
  storage: ['storage'],
  dispatch: ['staging', 'storage', 'dispatch'],
  ...Object.fromEntries(productionLines.flatMap((line, index) => {
    const prefix = index === 0 ? 'a' : 'b';
    return [[`${prefix}-print`, line.printers], ...lineSteps.map((step) => [`${prefix}-${step}`, [line[step]]])];
  })),
};
const stages = {
  首件打样: ['print1'],
  首件输送: ['print1'],
  首件质检: ['quality'],
  多机排产: cameraRegions.production,
  双线生产: cameraRegions.production,
  自动装盒: [...productionRoles.robot, ...productionRoles.boxes, ...productionRoles.buffer],
  扫码分拣: ['sort', ...productionRoles.buffer],
  智能入库: ['storage', 'sort'],
  拣货出库: ['storage', 'dispatch'],
  出库装车: ['dispatch', 'storage'],
  并行出库: ['staging', 'storage', 'dispatch'],
  异常待处理: ['reject', 'exception'],
  不合格品转运与清运: ['reject'],
  订单完成: ['dispatch', 'storage'],
};
const cameraViews = {
  overview: '厂区总览', design: '设计办公室', production: '生产区总览',
  lineA: 'A 线生产区', lineB: 'B 线生产区', logistics: '仓储发运区',
};
const viewButtons = [...document.querySelectorAll('[data-view]')];
const flowNodes = [...document.querySelectorAll('[data-flow]')];
const flowSegments = [...document.querySelectorAll('[data-segment]')];
const flowSegmentMeta = Object.fromEntries(flowSegments.map((segment) => [segment.dataset.segment, segment.querySelector('.flow-segment-meta')]));
const speeds = [1, 2, 4, 8, 32, 128, 512];
const countFormat = new Intl.NumberFormat('zh-CN');
const dimensionFormat = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 });
const timelineSteps = 10000;
const segmentCounters = {
  design: (sim) => sim ? (sim.stage === '订单建模' ? '建模中' : '已完成') : '待启动',
  print: (sim, total) => sim ? `质检 ${countFormat.format(sim.good ?? 0)} / ${total} 件` : `0 / ${total} 件`,
  qualityPack: (sim, total) => sim ? `装盒 ${countFormat.format(sim.boxed ?? 0)} / ${total} 件` : `0 / ${total} 件`,
  boxSupply: (sim) => sim ? `余量 ${countFormat.format(getOpsSnapshot(sim).cartons)} 个` : '0 个余量',
  sort: (sim, total) => sim ? `分拣 ${countFormat.format(sim.sorted ?? 0)} / ${total} 件` : `0 / ${total} 件`,
  storage: (sim, total) => sim ? `在库 ${countFormat.format(sim.onHand ?? 0)} / ${total} 件` : `0 / ${total} 件`,
  exception: (sim) => sim ? `累计 ${countFormat.format(sim.quality.rejected)} / 已清运 ${countFormat.format(sim.quality.cleared)} 件` : '0 件不合格',
  dispatch: (sim, total) => sim ? `并行发运 ${countFormat.format(sim.shipped ?? 0)} / ${total} 件` : `0 / ${total} 件`,
};
const glyphs = {
  play: '<path d="m8 5 12 7-12 7z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M9 5v14M15 5v14" stroke-width="2.2"/>',
};

let sim = null;
let paused = false;
let speedIndex = 0;
let speedManuallySelected = false;
let stationId = 'design';
let pinnedStation = false;
let cameraView = 'overview';
let draft = { ...DEFAULT_ORDER };
let armed = false;
let preview;
let factory;
let modelStatus = '正在加载玩偶模型';
let lastPaint = -Infinity;
let logKey = '';
let detailKey = '';
let editingPreviewKey = '';

const designPlatformLink = $('design-platform-link');
const screenLayer = $('control-screen-layer');
const screen = $('control-screen');
const tabs = [...screen.querySelectorAll('[data-console-tab]')];
const pages = [...screen.querySelectorAll('[data-console-page]')];
const compactViewport = window.matchMedia('(max-width: 790px), (max-height: 490px), (max-aspect-ratio: 11/10)');
let roomOpen = false;
let consoleTab = 'overview';
let drawingReturnTab = 'overview';
let roomReturnFocus;
let previousScreenTransform;
let cachedScreenRect;
let engineeringExample;
let equipmentIdle;
let activeReplay;
let lastReplaySave = -Infinity;
const equipmentPanel = initEquipmentPanel($('equipment-panel'), {
  getHistory: (assetId, time) => getEquipmentHistory(sim ?? equipmentIdle, time, assetId),
});
const replayPicker = $('equipment-replays');
const replayDate = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const replayStorage = (() => { try { return window.localStorage; } catch { return null; } })();

function saveReplay() {
  if (!sim || !activeReplay) return;
  activeReplay = storeOrderReplay(replayStorage, activeReplay, sim.time);
  lastReplaySave = performance.now();
}

function refreshReplayPicker() {
  const entries = readOrderReplays(replayStorage);
  const current = activeReplay?.id;
  const options = [new Option(sim ? `当前订单 · ${sim.order.text}` : '尚未启动订单', '')];
  for (const entry of entries) {
    if (entry.id === current) continue;
    options.push(new Option(`${replayDate.format(entry.startedAt)} · ${entry.params.text} · ${entry.params.quantity} 件`, entry.id));
  }
  replayPicker.replaceChildren(...options);
  replayPicker.disabled = options.length < 2;
}

replayPicker.addEventListener('change', () => {
  const entry = readOrderReplays(replayStorage).find(({ id }) => id === replayPicker.value);
  if (!entry) return;
  saveReplay();
  sim = createSimulation(entry.params, { orderId: entry.orderId });
  activeReplay = entry;
  stationId = 'design';
  pinnedStation = false;
  seekPaused(entry.elapsed);
  paintEngineeringTab();
  refreshReplayPicker();
  paint();
});
window.addEventListener('pagehide', saveReplay);
let renderedEquipmentSource;
let renderedEquipmentTime;

function paintEquipmentTab() {
  if (!roomOpen || screenLayer.hidden || consoleTab !== 'equipment') return;
  const source = sim ?? (equipmentIdle ??= createSimulation(DEFAULT_ORDER, { orderId: 'DT-IDLE' }));
  if (renderedEquipmentSource === source && renderedEquipmentTime === source.time) return;
  renderedEquipmentSource = source;
  renderedEquipmentTime = source.time;
  equipmentPanel.update(getEquipmentTelemetry(source));
}

function paintEngineeringTab() {
  if (consoleTab !== 'engineering') return;
  $('engineering-example').hidden = Boolean(sim);
  const source = sim ?? (engineeringExample ??= createSimulation(PRESETS.batch));
  paintEngineeringAnalysis($('engineering-analysis'), source);
}

function selectConsoleTab(key, moveFocus = false) {
  const next = tabs.find((tab) => tab.dataset.consoleTab === key);
  if (!next) return;
  const drawing = key === 'routes';
  if (consoleTab !== key) {
    screen.querySelector('.console-pages').scrollTop = 0;
    if (drawing) drawingReturnTab = consoleTab;
    else drawingTools.open = false;
  }
  consoleTab = key;
  screenLayer.classList.toggle('is-drawing-view', drawing);
  positionConsole();
  for (const tab of tabs) {
    const active = next === tab;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    tab.classList.toggle('is-active', active);
  }
  for (const page of pages) page.hidden = page.dataset.consolePage !== key;
  if (drawing) {
    $('route-map-panel').querySelector('.drawing-stage')?.focus({ preventScroll: true });
    requestAnimationFrame(() => drawRouteMap?.(sim));
  } else if (moveFocus) next.focus();
  if (key === 'engineering') paintEngineeringTab();
  if (key === 'equipment') {
    refreshReplayPicker();
    paintEquipmentTab();
  }
}

for (const [index, tab] of tabs.entries()) {
  tab.addEventListener('click', () => selectConsoleTab(tab.dataset.consoleTab));
  tab.addEventListener('keydown', (event) => {
    const direction = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
    if (direction === undefined && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + direction + tabs.length) % tabs.length;
    selectConsoleTab(tabs[next].dataset.consoleTab, true);
  });
}
for (const link of screen.querySelectorAll('[data-console-link]')) {
  link.addEventListener('click', () => selectConsoleTab(link.dataset.consoleLink, true));
}
$('drawing-back').addEventListener('click', () => selectConsoleTab(drawingReturnTab, true));
selectConsoleTab('overview');

function positionConsole(rect) {
  if (!roomOpen) return;
  if (rect) cachedScreenRect = rect;
  else rect = cachedScreenRect;
  const compact = consoleTab === 'routes' || compactViewport.matches || !factory;
  screenLayer.classList.toggle('is-compact', compact);
  if (!compact && (!rect || rect.width <= 0 || rect.height <= 0)) return;
  if (!compact) {
    const scale = Math.min(rect.width / 1120, rect.height / 640);
    const x = rect.left + (rect.width - 1120 * scale) / 2;
    const y = rect.top + (rect.height - 640 * scale) / 2;
    const transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) scale(${scale.toFixed(5)})`;
    if (transform !== previousScreenTransform) screen.style.transform = previousScreenTransform = transform;
  } else {
    screen.style.removeProperty('transform');
    previousScreenTransform = undefined;
  }
  if (screenLayer.hidden) {
    screenLayer.hidden = false;
    ids.viewport.classList.remove('is-travelling');
    const focusTarget = consoleTab === 'routes' ? '.drawing-stage' : '[aria-selected="true"]';
    screen.querySelector(focusTarget)?.focus({ preventScroll: true });
    requestAnimationFrame(() => { if (consoleTab === 'routes') drawRouteMap?.(sim); });
    paintEquipmentTab();
  }
}

function enterControlRoom() {
  if (roomOpen) return;
  roomReturnFocus = document.activeElement;
  roomOpen = true;
  cachedScreenRect = undefined;
  ids.viewport.classList.add('is-control-room', 'is-travelling');
  $('enter-control-room').setAttribute('aria-expanded', 'true');
  if (factory) factory.enterControlRoom();
  positionConsole();
}

function closeConsole({ restoreFocus = true } = {}) {
  if (!roomOpen) return;
  roomOpen = false;
  screenLayer.hidden = true;
  ids.viewport.classList.remove('is-control-room', 'is-travelling');
  $('enter-control-room').setAttribute('aria-expanded', 'false');
  if (restoreFocus) {
    const destination = roomReturnFocus?.isConnected && !roomReturnFocus.hidden ? roomReturnFocus : $('enter-control-room');
    destination?.focus({ preventScroll: true });
    if (document.activeElement !== destination || destination === document.body) $('enter-control-room').focus({ preventScroll: true });
  }
}

$('enter-control-room').addEventListener('click', enterControlRoom);
$('leave-control-room').addEventListener('click', () => selectView('overview'));
$('focus-station').addEventListener('click', () => selectStation(stationId, true));
engineeringMarkings.addEventListener('click', () => {
  const visible = engineeringMarkings.getAttribute('aria-pressed') !== 'true';
  engineeringMarkings.setAttribute('aria-pressed', String(visible));
  factory?.setEngineeringMarkings(visible);
});
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || event.defaultPrevented || !roomOpen || document.querySelector('dialog[open]')) return;
  event.preventDefault();
  if (consoleTab === 'routes') selectConsoleTab(drawingReturnTab, true);
  else selectView('overview');
});
compactViewport.addEventListener('change', () => positionConsole());
window.addEventListener('resize', () => positionConsole());

function setText(element, value) {
  const text = String(value);
  if (element.textContent !== text) element.textContent = text;
}

function paintLighting() {
  const minute = shiftMinuteAt(sim?.time);
  const night = isNightShift(lightingMode, minute);
  factory?.setLightingShift(night);
  if (minute === displayedShiftMinute && night === displayedNightShift) return;
  displayedShiftMinute = minute;
  displayedNightShift = night;
  const clock = formatShiftClock(minute);
  for (const readout of lightingReadouts) setText(readout, `${night ? '夜班' : '日班'} · ${clock}`);
  ids.viewport.dataset.lighting = night ? 'night' : 'day';
}

for (const select of lightingControls) select.addEventListener('change', () => {
  lightingMode = select.value;
  for (const control of lightingControls) control.value = lightingMode;
  paintLighting();
});

for (const [group, stations] of Object.entries(stationGroups)) for (const id of stations) {
  const station = STATIONS[id];
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'station-button';
  button.dataset.station = id;
  button.innerHTML = '<span class="station-dot"></span><span class="station-name"></span><small class="station-code"></small>';
  button.querySelector('.station-name').textContent = station.shortName;
  button.querySelector('.station-code').textContent = station.code;
  button.addEventListener('click', () => selectStation(id));
  stationButtons[id] = button;
  ids[`station-list-${group}`].append(button);
}

function selectStation(id, flyToStation = !roomOpen) {
  pinnedStation = true;
  stationId = id;
  if (flyToStation) {
    closeConsole();
    cameraView = id;
    setText($('camera-view'), cameraViews[id] ?? STATIONS[id].shortName);
    factory?.focus(id);
  }
  paint();
}

function focusSelectedSupply() {
  if (!printerIds.has(stationId)) return;
  closeConsole();
  factory?.focusSupply(stationId);
  pinnedStation = true;
  cameraView = 'supply';
  setText($('camera-view'), `${STATIONS[stationId].shortName} · 后置换卷机`);
}

function nextSupplyInstall(id, includePickup = false) {
  let firstInstall;
  for (const delivery of sim?.timeline?.filamentDeliveries ?? []) {
    if (delivery.station !== id || !Number.isFinite(delivery.arrival) || delivery.loaded <= delivery.arrival) continue;
    const time = includePickup ? delivery.start : delivery.arrival;
    firstInstall ??= time;
    if (time > sim.time) return time;
  }
  return firstInstall;
}

function recoveryMessage(container, message) {
  const note = document.createElement('p');
  note.className = 'canvas-notice';
  note.textContent = message;
  container.prepend(note);
}

function selectView(view) {
  if (view === 'design') {
    selectStation('design', true);
    return;
  }
  closeConsole();
  pinnedStation = false;
  cameraView = view;
  if (!sim) stationId = cameraRegions[view]?.[0] ?? 'design';
  setText($('camera-view'), cameraViews[view]);
  if (view === 'overview') factory?.reset();
  else factory?.focus(view);
  paint();
}

for (const button of viewButtons) {
  button.addEventListener('click', () => selectView(button.dataset.view));
}
for (const node of flowNodes) {
  const candidates = flowStations[node.dataset.flow].filter((id) => STATIONS[id]);
  node.disabled = candidates.length === 0;
  node.addEventListener('click', () => {
    const active = candidates.find((id) => sim?.stations[id]?.active);
    selectStation(active ?? candidates[0]);
  });
}

async function startFactory() {
  const stage = $('scene-stage');
  try {
    await loadProductModel();
  } catch (error) {
    console.error(error);
    modelStatus = '玩偶模型加载失败';
    recoveryMessage(stage, '玩偶模型加载失败，请刷新页面重试。');
    paint();
    return;
  }

  try {
    factory = mountFactory(stage, (id) => selectStation(id, true), {
      onControlRoom: enterControlRoom,
      onScreen: positionConsole,
      onDesignPlatform: () => designPlatformLink.click(),
    });
    factory.setEngineeringMarkings(engineeringMarkings.getAttribute('aria-pressed') === 'true');
    if (roomOpen) factory.enterControlRoom();
    else if (cameraView !== 'overview') factory.focus(cameraView);
  } catch (error) {
    console.error(error);
    recoveryMessage(stage, '当前浏览器无法启用 WebGL 2。订单流程仍可演示。');
  }
  modelStatus = '';
  for (const id of ['run-single', 'run-batch', 'run-scale', 'custom-order']) ids[id].disabled = false;
  paint();
}

function formatTime(value) {
  const seconds = Math.floor(value);
  const parts = [Math.floor(seconds / 60) % 60, seconds % 60];
  if (seconds >= 3600) parts.unshift(Math.floor(seconds / 3600));
  return parts.map((part) => String(part).padStart(2, '0')).join(':');
}

function dimensionText(spec) {
  return `${dimensionFormat.format(spec.width)} × ${dimensionFormat.format(spec.depth)} × ${dimensionFormat.format(spec.height)} mm`;
}

function replaceStats(host, stats) {
  const fragment = document.createDocumentFragment();
  for (const [label, value] of stats) {
    const row = document.createElement('div');
    row.className = 'stat-row';
    const key = document.createElement('span');
    key.textContent = label;
    const result = document.createElement('strong');
    result.textContent = value;
    row.append(key, result);
    fragment.append(row);
  }
  host.replaceChildren(fragment);
}


function readPath(source, paths, fallback = 0) {
  for (const path of paths) {
    const value = path.split('.').reduce((current, key) => current?.[key], source);
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return fallback;
}

function numberValue(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function getOpsSnapshot(source = sim) {
  const onHand = Math.max(0, numberValue(source?.onHand, 0));
  const capacity = Math.max(1, numberValue(readPath(source, ['warehouse.capacity', 'logistics.capacity', 'storage.capacity', 'warehouseCapacity'], warehouseCapacity), warehouseCapacity));
  const cartons = source?.packaging.available ?? 20;
  const cartonWarehouse = source?.packaging.warehouseStock ?? 4980;
  const quality = source?.quality;
  const rejects = quality?.rejected ?? 0;
  const rejectInTransit = quality?.inbound ?? 0;
  const fleets = Object.values(source?.battery.fleets ?? {});
  const fleetLevels = fleets.map((fleet) => fleet.activeState?.battery ??
    (fleet.active === fleet.backup.id ? fleet.backup.battery : fleet.primary.battery));
  const robotPower = fleetLevels.length ? Math.min(...fleetLevels) : 100;
  const robotBackup = fleets.reduce((count, fleet) => count + [fleet.primary, fleet.backup]
    .filter((agent) => agent.id !== fleet.active && agent.status === 'standby').length, 0);
  const inspection = source?.inspection;
  const patrolStation = inspection?.station ?? inspection?.nextStation;
  const patrolTarget = inspection?.stationName ?? STATIONS[patrolStation]?.shortName ?? patrolStation;
  const patrol = inspection?.active ? (inspection.frame.yielding ? '路口让行' : patrolTarget || '巡检中') : '待命';
  const charging = source?.charging.occupiedBays ?? 0;
  const bays = source?.charging.station.bays ?? 2;
  const lanes = source?.dispatch.lanes ?? 1;
  return { onHand, capacity, cartons, cartonWarehouse, rejects, rejectInTransit,
    lanes, charging, bays, robotPower, robotBackup, patrol, ecoHold: quality?.cleared ?? 0 };
}

function nextRejectMoment(kind) {
  const plan = sim?.timeline.rejectPlan;
  if (!plan) return null;
  if (kind === 'load') {
    const job = plan.jobs.find(({ kind, drop }) => kind === 'load' && drop - 0.01 > sim.time);
    return job ? Math.max((job.pickup + job.drop) / 2, sim.time + 0.01) : null;
  }
  const trip = plan.trips.find(({ depart }) => depart + 1.2 > sim.time);
  return trip ? trip.depart + 1.2 : null;
}

function paintDevice() {
  const station = STATIONS[stationId] ?? STATIONS.design;
  const frame = sim?.stations[stationId];
  const order = sim?.order;
  const percent = Math.round((frame?.progress ?? 0) * 100);
  const ops = getOpsSnapshot(sim);
  setText(ids['device-name'], station.name);
  setText(ids['device-code'], station.code);
  setText(ids['device-role'], station.role);
  setText(ids['device-action'], frame?.action ?? '等待定制订单');
  setText(ids['device-percent'], `${percent}%`);
  ids['device-progress'].value = percent;
  setText(ids['device-order'], order?.id ?? '—');
  const isPrinter = printerIds.has(stationId);
  ids['device-supply-actions'].hidden = !isPrinter;
  if (isPrinter) {
    ids['focus-supply'].disabled = typeof factory?.focusSupply !== 'function';
    ids['focus-supply'].setAttribute('aria-pressed', String(cameraView === 'supply'));
    ids['seek-supply'].disabled = nextSupplyInstall(stationId) == null;
    ids['seek-pickup'].disabled = ids['seek-supply'].disabled;
  }
  ids['device-reject-actions'].hidden = stationId !== 'reject';
  if (stationId === 'reject') {
    ids['seek-reject-load'].disabled = nextRejectMoment('load') == null;
    ids['seek-reject-trip'].disabled = nextRejectMoment('trip') == null;
  }
  const stats = [];
  const totalText = order ? countFormat.format(order.quantity) : '';
  const completed = (count) => `${countFormat.format(count)} / ${totalText} 件`;
  if (order && stationId === 'design') {
    stats.push(['包装标签', order.text], ['模型尺寸', dimensionText(order.productSize)]);
    if (frame.motion === 'slice' || frame.motion === 'dispatch' || frame.progress === 1) {
      stats.push(['预计耗材 / 件', `${order.filamentGrams} g`], ['预计打印 / 件', `${order.printMinutes} min`]);
    }
  } else if (isPrinter) {
    const filament = sim?.filament;
    const remaining = filament?.printers?.[stationId] ?? FILAMENT_COLORS.map(() => FILAMENT_SPOOL_GRAMS);
    const supply = filament?.supply?.[stationId];
    stats.push(['各槽余量', FILAMENT_COLORS.map(({ code, index }) => `${code} ${remaining[index].toFixed(1)} g`).join(' / ')],
      ['供料状态', supply?.label ?? supplyLabels[supply?.state] ?? supplyLabels.ready]);
    if (order && frame) {
      const layer = frame.motion === 'print' ? Math.floor(frame.phaseProgress * order.layers)
        : frame.active || frame.progress === 1 ? order.layers : 0;
      stats.push(['当前层数', `${layer} / ${order.layers}`], ['预计工时 / 件', `${order.printMinutes} min`]);
    }
  } else if (order && productionRoles.boxes.includes(stationId)) {
    stats.push(['纸盒外形', dimensionText(order.box)], ['累计成型', completed(sim.boxesReady)], ['本线盒坯', `${sim.packaging.lineStock[stationId]} 个`]);
  } else if (order && productionRoles.quality.includes(stationId)) {
    stats.push(['累计质检合格', completed(sim.good)]);
  } else if (order && productionRoles.robot.includes(stationId)) {
    stats.push(['累计装盒复核', completed(sim.boxed)], ['纸盒规格', dimensionText(order.box)]);
  } else if (order && productionRoles.buffer.includes(stationId)) {
    stats.push(['累计封盒贴标', completed(sim.boxed)]);
  } else if (order && stationId === 'sort') {
    stats.push(['已分配货位', completed(sim.sorted ?? 0)]);
    if (frame.lane != null && frame.motion !== 'scan') stats.push(['分拣去向', frame.lane === 0 ? 'A 区' : 'B 区']);
  } else if (order && stationId === 'storage') {
    stats.push(['累计上架', completed(sim.stored ?? 0)], ['货位占用', `${countFormat.format(sim.onHand)} / ${warehouseCapacity}`]);
    if (frame.slot != null) stats.push(['当前货位', warehouseAddress(frame.slot)]);
  } else if (order && stationId === 'exception') {
    stats.push(['复核模式', '标签复核后重新进入分拣线']);
  } else if (stationId === 'reject') {
    const qa = sim?.quality ?? { rejected: 0, inbound: 0, reworkQueue: 0, rackCapacity: 8, loading: 0, truckCargo: 0, truckCapacity: 12, truck: 'docked', cleared: 0, trips: 0 };
    const truckLabel = { docked: '靠台 · 等待装载', departing: '载货清运中', offsite: '场外交接', returning: '空车回位' }[qa.truck];
    stats.push(['累计不合格', `${countFormat.format(qa.rejected)} 件`],
      ['上游待放行与在途', `${qa.inbound} 件`], ['周转货位', `${qa.reworkQueue} / ${qa.rackCapacity}`],
      ['装载机持件', `${qa.loading} 件`], ['车上件数', `${qa.truckCargo} / ${qa.truckCapacity}`],
      ['清运车辆', truckLabel], ['已交接清运', `${countFormat.format(qa.cleared)} 件 · ${qa.trips} 车次`]);
  } else if (order && stationId === 'dispatch') {
    stats.push(
      ['已从立库取货', completed(sim.picked ?? 0)],
      ['出库通道', `${countFormat.format(ops.lanes)} 路`],
      ['车厢待发', `${countFormat.format(Math.max(0, (sim.loaded ?? 0) - (sim.shipped ?? 0)))} 件`],
      ['已装车发运', completed(sim.shipped ?? 0)],
    );
    if (frame.unit != null) {
      const totalWaves = Math.ceil(sim.timeline.warehouseUnits.length / warehouseWaveSize);
      const currentWave = frame.wave;
      stats.push(['当前车次', `${countFormat.format(currentWave)} / ${countFormat.format(totalWaves)}`]);
    }
  }
  if (frame?.unit != null) stats.push(['当前件号', `#${String(frame.unit).padStart(String(order.quantity).length, '0')}`]);
  const newDetail = JSON.stringify(stats);
  if (newDetail !== detailKey) {
    detailKey = newDetail;
    replaceStats(ids['device-extra'], stats);
  }
}

function paintLog() {
  const events = sim?.events ?? [];
  const latest = events.at(-1);
  const key = `${sim?.order.id ?? ''}/${events.length}/${latest?.time ?? ''}`;
  if (key === logKey) return;
  logKey = key;
  const items = events.slice(-14).reverse().map((event) => {
    const li = document.createElement('li');
    const time = document.createElement('time');
    time.textContent = formatTime(event.time ?? sim?.time ?? 0);
    const label = document.createElement('span');
    label.textContent = event.message ?? event.label ?? event.title ?? '流程状态更新';
    if (event.kind || event.type) li.dataset.kind = event.kind ?? event.type;
    li.append(time, label);
    return li;
  });
  if (!items.length) {
    const li = document.createElement('li');
    li.textContent = '等待提交订单';
    items.push(li);
  }
  ids['event-log'].replaceChildren(...items);
}

function updateReadout(id, percent, precision = 0) {
  const value = Math.max(0, Math.min(100, percent ?? 0));
  const bar = $(id);
  if (bar.value !== value) bar.value = value;
  const text = percent == null ? '—' : `${Number(value.toFixed(precision))}%`;
  setText($(`${id}-value`), text);
  bar.setAttribute('aria-valuetext', percent == null ? '尚无质检数据' : text);
}

function paint() {
  paintLighting();
  designPlatformLink.hidden = cameraView !== 'design';
  if (sim && !pinnedStation) {
    const region = cameraRegions[cameraView];
    const range = stages[sim.stage] ?? ['design'];
    const visible = region ? range.filter((id) => region.includes(id)) : range;
    stationId = visible.find((id) => sim.stations[id]?.active)
      ?? region?.find((id) => sim.stations[id]?.active)
      ?? visible[0] ?? region?.[0] ?? 'design';
  }
  const fraction = sim ? sim.time / Math.max(1, sim.duration ?? 0) : 0;
  const progress = Math.floor(fraction * 100);
  const status = !sim ? '等待订单' : sim.complete ? '订单已完成' : paused ? '演示已暂停' : '仿真运行中';
  setText(ids.stage, sim?.stage ?? '待下单');
  setText(ids.quantity, countFormat.format(sim?.order.quantity ?? 0));
  setText(ids.good, countFormat.format(sim?.good ?? 0));
  setText(ids.sorted, countFormat.format(sim?.sorted ?? 0));
  setText(ids.stored, countFormat.format(sim?.stored ?? 0));
  setText(ids.onHand, countFormat.format(sim?.onHand ?? 0));
  setText(ids.shipped, countFormat.format(sim?.shipped ?? 0));
  const ops = getOpsSnapshot(sim);
  const inspected = (sim?.good ?? 0) + ops.rejects;
  updateReadout('overview-progress', progress);
  updateReadout('overview-yield', inspected ? (100 * sim.good) / inspected : null, 1);
  updateReadout('overview-utilization', (100 * ops.onHand) / ops.capacity, 1);
  setText(ids.warehouse, `${countFormat.format(ops.onHand)} / ${countFormat.format(ops.capacity)}`);
  setText(ids.cartons, countFormat.format(ops.cartons));
  setText(ids.rejects, countFormat.format(ops.rejects));
  setText(ids.dispatching, countFormat.format(ops.lanes));
  setText(ids.robotPower, `${Math.round(ops.robotPower)}`);
  setText(ids.robotBackup, countFormat.format(ops.robotBackup));
  setText(ids.patrol, ops.patrol);
  setText(ids.ecoHold, countFormat.format(ops.ecoHold));
  setText(ids['zone-charging-value'], `${ops.charging} / ${ops.bays}`);
  setText(ids['zone-charging-meta'], ops.charging ? '设备已停靠充电' : '双充电位 · 主备交接');
  setText(ids['zone-backup-value'], `${countFormat.format(ops.robotBackup)} 台`);
  setText(ids['zone-backup-meta'], ops.robotBackup > 0 ? '热备资源在线' : '暂无备用机器人');
  setText(ids['zone-patrol-value'], ops.patrol);
  const reading = sim?.inspection.lastReading;
  ids['zone-patrol-meta'].title = reading ? `${reading.station} · ${reading.action}` : '';
  setText(ids['zone-patrol-meta'], sim?.inspection.active ? `${sim.inspection.frame.yielding ? '等待共用通道放行' : sim.inspection.scanning ? '扫描设备' : '前往设备'} · 已巡检 ${sim.inspection.completed} 次` : '按路线巡检各工位与仓区');
  const qa = sim?.quality;
  setText(ids['zone-eco-value'], `${qa?.reworkQueue ?? 0} / ${qa?.rackCapacity ?? 8}`);
  setText(ids['zone-eco-meta'], `在架 · 车上 ${qa?.truckCargo ?? 0} 件 · 已清运 ${countFormat.format(ops.ecoHold)} 件`);
  setText($('zone-production-value'), sim ? (sim.stations?.print1?.active || sim.stations?.print4?.active ? '双线运行' : '排产中') : '待机');
  setText($('zone-production-meta'), sim ? `合格 ${countFormat.format(sim.good ?? 0)} / ${countFormat.format(sim.order?.quantity ?? 0)} 件` : '两条产线并行排产');
  setText($('zone-warehouse-value'), `${countFormat.format(ops.onHand)} / ${countFormat.format(ops.capacity)}`);
  setText($('zone-warehouse-meta'), sim ? `入库 ${countFormat.format(sim.stored ?? 0)} · 出库 ${countFormat.format(sim.shipped ?? 0)}` : '扩大库容 · 入库/出库同步');
  setText($('zone-cartons-value'), `${countFormat.format(ops.cartonWarehouse)} 个`);
  const cartonCharge = sim?.battery?.fleets?.packagingRobot?.charging ?? [];
  const cartonWork = sim?.packaging.delivery
    ? `补给${STATIONS[sim.packaging.delivery.station].shortName} · 已完成 ${sim.packaging.refills} 次`
    : `线边剩余 ${ops.cartons} 个盒坯`;
  setText($('zone-cartons-meta'), cartonCharge.length ? `${cartonWork} · ${cartonCharge.join(' / ')} 充电中` : cartonWork);
  const filament = sim?.filament;
  const delivery = filament?.delivery;
  const stock = filament?.stockByColor ?? FILAMENT_COLORS.map(() => FILAMENT_STOCK_PER_COLOR);
  setText($('zone-filament-value'), `R ${stock[0]} · G ${stock[1]} · B ${stock[2]} 卷`);
  const materialDockStatus = filament?.charger.charging ? '充电中' : '已停靠';
  const materialPower = Math.round(100 * (filament?.charger.battery ?? 1));
  setText($('zone-filament-meta'), delivery
    ? `${STATIONS[delivery.station]?.shortName ?? delivery.station ?? '打印机'} · ${delivery.stageLabel ?? deliveryLabels[delivery.phase] ?? '卷料配送中'}`
    : `MAT-01 ${materialDockStatus} ${materialPower}% · 已换卷 ${filament?.installed ?? 0} 次 · 回收余料 ${countFormat.format(filament?.recoveredGrams ?? 0)} g`);
  setText($('zone-exception-value'), `${ops.rejectInTransit} 件`);
  setText($('zone-exception-meta'), ops.rejectInTransit ? '红色旁路正在转运' : '高架旁路接驳不合格品周转架');
  setText($('zone-outbound-value'), sim?.dispatch.receiving && sim.dispatch.shipping ? '入出库并行' : sim?.dispatch.shipping ? '发运中' : '待机');
  setText($('zone-outbound-meta'), sim ? `已发运 ${countFormat.format(sim.shipped)} · 待发 ${countFormat.format(sim.loaded - sim.shipped)}` : '按小批次拣货装车');
  const patrolAlert = /异常|离线|故障/i.test(ops.patrol);
  const alertText = !sim ? '等待订单启动，仓储与包装资源将实时联动' : ops.robotPower < 25 ? '机器人电量偏低，充电站与备用机器人已进入接管准备' : patrolAlert ? '巡检机器人状态异常，请安排人工确认巡检路线' : qa && qa.reworkQueue === qa.rackCapacity ? '不合格品周转货位已满，质检口按预约限流' : qa?.truck === 'departing' ? '不合格品专车已发车，正在前往场外交接点' : Boolean(sim?.packaging.delivery) ? '包装盒补给机器人正在执行任务' : sim.dispatch.receiving && sim.dispatch.shipping ? '入库与出库同时进行' : '双线生产、包装补给与仓储流程运行正常';
  setText(ids['flow-alert'], alertText);
  ids.viewport.classList.toggle('has-alert', Boolean(ops.robotPower < 25 || patrolAlert || ops.rejects || (sim && Boolean(sim?.packaging.delivery))));
  $('zone-charging-value')?.closest('.zone-card')?.classList.toggle('is-alert', ops.robotPower < 25);
  $('zone-patrol-value')?.closest('.zone-card')?.classList.toggle('is-alert', patrolAlert);
  $('zone-eco-value')?.closest('.zone-card')?.classList.toggle('is-alert', Boolean(qa && qa.reworkQueue === qa.rackCapacity));
  setText(ids['status-text'], modelStatus || status);
  ids.viewport.dataset.state = !sim ? 'idle' : sim.complete ? 'complete' : paused ? 'paused' : 'running';
  setText(ids['timeline-label'], `${progress}%`);
  const elapsed = formatTime(sim?.time ?? 0);
  const duration = formatTime(sim?.duration ?? 0);
  setText($('drawing-clock'), elapsed);
  drawingPause.disabled = !sim || sim.complete;
  if (roomOpen && !screenLayer.hidden && consoleTab === 'routes') drawRouteMap?.(sim);
  paintEquipmentTab();
  setText(ids['timeline-time'], `${elapsed} / ${duration}`);
  const slider = ids['timeline-progress'];
  slider.value = Math.round(fraction * timelineSteps);
  slider.style.setProperty('--timeline-fill', `${progress}%`);
  slider.setAttribute('aria-valuetext', `${elapsed}，总时长 ${duration}`);
  slider.disabled = !sim;
  ids.pause.disabled = !sim || sim.complete;

  for (const button of viewButtons) {
    const active = button.dataset.view === cameraView;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  for (const [id, button] of Object.entries(stationButtons)) {
    button.classList.toggle('is-running', Boolean(sim?.stations[id]?.active));
    button.classList.toggle('is-selected', stationId === id);
    button.setAttribute('aria-pressed', String(stationId === id));
  }
  const total = countFormat.format(sim?.order.quantity ?? 0);
  for (const segment of flowSegments) {
    const key = segment.dataset.segment;
    const idsForSegment = flowStations[key] ?? [];
    const state = idsForSegment.map((id) => sim?.stations[id]);
    const hasWork = idsForSegment.map((id) => Boolean(sim?.timeline?.phases?.[id]?.length));
    const anyWork = hasWork.some(Boolean);
    const active = state.some((frame) => frame?.active);
    const done = Boolean(sim && anyWork && state.every((frame, index) => !hasWork[index] || frame?.progress === 1));
    segment.classList.toggle('is-current', active);
    segment.classList.toggle('is-done', done);
    setText(flowSegmentMeta[key], segmentCounters[key]?.(sim, total) ?? '待启动');
  }
  for (const node of flowNodes) {
    const idsForFlow = flowStations[node.dataset.flow];
    const state = idsForFlow.map((id) => sim?.stations[id]);
    const hasWork = idsForFlow.map((id) => Boolean(sim?.timeline?.phases?.[id]?.length));
    node.classList.toggle('is-current', state.some((frame) => frame?.active));
    node.classList.toggle('is-done', Boolean(sim && state.some((frame) => frame?.progress === 1)
      && state.every((frame, i) => !hasWork[i] || frame?.progress === 1)));
  }
  paintDevice();
  paintLog();
}

function updatePause() {
  const button = ids.pause;
  const title = paused ? '继续' : '暂停';
  setText(button.querySelector('.control-label'), title);
  button.setAttribute('aria-label', title);
  const icon = button.querySelector('.control-icon svg');
  icon.innerHTML = paused ? glyphs.play : glyphs.pause;
  setText(drawingPause.querySelector('span'), title);
  drawingPause.querySelector('svg').innerHTML = paused ? glyphs.play : glyphs.pause;
}

function run(params) {
  saveReplay();
  const lastNumber = readOrderReplays(replayStorage).reduce((max, { orderId }) => {
    const number = /^DT-(\d+)$/.exec(orderId)?.[1];
    return Math.max(max, Number(number) || 0);
  }, 0);
  const orderId = lastNumber ? `DT-${String(lastNumber + 1).padStart(4, '0')}` : undefined;
  sim = createSimulation(params, { orderId });
  activeReplay = startOrderReplay(sim);
  saveReplay();
  refreshReplayPicker();
  if (!speedManuallySelected) {
    const initialSpeed = params.quantity >= 1000 ? 32 : params.quantity >= 240 ? 8 : 1;
    setSpeed(speeds.indexOf(initialSpeed));
  }
  paused = false;
  stationId = 'design';
  pinnedStation = false;
  if (!roomOpen) selectView('overview');
  updatePause();
  paintEngineeringTab();
  paint();
}

ids['run-single'].addEventListener('click', () => run(PRESETS.single));
ids['run-batch'].addEventListener('click', () => run(PRESETS.batch));
ids['run-scale'].addEventListener('click', () => run(PRESETS.scale));
function togglePause() {
  if (!sim || sim.complete) return;
  paused = !paused;
  updatePause();
  paint();
}
ids.pause.addEventListener('click', togglePause);
drawingPause.addEventListener('click', togglePause);
function setSpeed(index) {
  speedIndex = index;
  setText(ids.speed.querySelector('.control-label'), `${speeds[speedIndex]}×`);
  ids.speed.setAttribute('aria-label', `当前倍速 ${speeds[speedIndex]} 倍，点击切换`);
}
ids.speed.addEventListener('click', () => {
  speedManuallySelected = true;
  setSpeed((speedIndex + 1) % speeds.length);
});
function seekPaused(seconds) {
  paused = true;
  seekSimulation(sim, seconds);
  saveReplay();
  updatePause();
}

ids['timeline-progress'].max = timelineSteps;
ids['timeline-progress'].addEventListener('input', (event) => {
  if (!sim) return;
  seekPaused(Number(event.target.value) / timelineSteps * sim.duration);
  paint();
});
for (const kind of ['load', 'trip']) {
  ids[`seek-reject-${kind}`].addEventListener('click', () => {
    const time = nextRejectMoment(kind);
    if (time == null || stationId !== 'reject') return;
    pinnedStation = true;
    seekPaused(time);
    selectStation('reject', true);
    paint();
  });
}
ids['focus-supply'].addEventListener('click', () => {
  focusSelectedSupply();
  paint();
});
ids['seek-supply'].addEventListener('click', () => {
  if (!sim || !printerIds.has(stationId)) return;
  const install = nextSupplyInstall(stationId);
  if (install == null) return;
  pinnedStation = true;
  seekPaused(install);
  focusSelectedSupply();
  paint();
});
ids['seek-pickup'].addEventListener('click', () => {
  const pickup = nextSupplyInstall(stationId, true);
  if (pickup == null) return;
  pinnedStation = true;
  seekPaused(pickup);
  closeConsole();
  factory?.focusFilamentWarehouse();
  cameraView = 'supply';
  setText($('camera-view'), 'RGB 耗材仓 · 取卷工位');
  paint();
});
for (const [field, [min, max]] of Object.entries(ORDER_LIMITS)) {
  fields[field].min = min;
  fields[field].max = max;
}
for (const color of COLORS) fields.color.add(new Option(color.label, color.value));
ids['order-form'].noValidate = true;

function readDraft() {
  return {
    text: fields.text.value,
    color: fields.color.value,
    width: Number(fields.width.value),
    depth: Number(fields.depth.value),
    height: Number(fields.height.value),
    quantity: Number(fields.quantity.value),
  };
}

function changeSubmit(confirmed) {
  armed = confirmed;
  setText(ids['order-submit'].querySelector('.control-label'), confirmed ? '确认并启动生产' : '生成定制模型');
}

function paintPreview(order) {
  const spec = getOrderSpec(order);
  const key = JSON.stringify(order);
  if (editingPreviewKey === key) return;
  editingPreviewKey = key;
  preview?.setOrder({ ...order, ...spec });
  replaceStats(ids['order-estimate'], [
    ['模型尺寸', dimensionText(spec.productSize)],
    ['盒子规格', dimensionText(spec.box)],
    ['预计耗材 / 件', `${spec.filamentGrams} g`],
    ['预计工时 / 件', `${spec.printMinutes} min`],
  ]);
}

ids['custom-order'].addEventListener('click', () => {
  for (const [key, input] of Object.entries(fields)) {
    input.value = draft[key];
    input.removeAttribute('aria-invalid');
  }
  ids['order-error'].hidden = true;
  changeSubmit(false);
  ids['order-dialog'].showModal();
  if (!preview) {
    try {
      preview = mountProductPreview(ids['order-preview']);
    } catch (error) {
      console.error(error);
      if (!ids['order-preview'].querySelector('.canvas-notice')) {
        recoveryMessage(ids['order-preview'], '当前浏览器无法显示 3D 模型');
      }
    }
  }
  paintPreview(draft);
});
ids['order-cancel'].addEventListener('click', () => ids['order-dialog'].close());
ids['order-dialog'].addEventListener('click', (event) => {
  if (event.target === ids['order-dialog']) ids['order-dialog'].close();
});
ids['order-form'].addEventListener('input', (event) => {
  event.target.removeAttribute('aria-invalid');
  const values = readDraft();
  const errors = validateOrder(values);
  ids['order-error'].hidden = true;
  changeSubmit(false);
  if (!Object.keys(errors).length) paintPreview(values);
});
ids['order-form'].addEventListener('submit', (event) => {
  event.preventDefault();
  const values = readDraft();
  const errors = validateOrder(values);
  for (const [key, input] of Object.entries(fields)) {
    if (errors[key]) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }
  const firstError = Object.keys(errors)[0];
  ids['order-error'].hidden = !firstError;
  if (firstError) {
    setText(ids['order-error'], errors[firstError]);
    fields[firstError].focus();
    return;
  }
  paintPreview(values);
  if (!armed) {
    changeSubmit(true);
    return;
  }
  draft = values;
  run(values);
  ids['order-dialog'].close();
});

let previousTime = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.25, Math.max(0, (now - previousTime) / 1000));
  previousTime = now;
  if (sim && !sim.complete && !paused) {
    stepSimulation(sim, dt * speeds[speedIndex]);
    if (sim.complete || now - lastReplaySave > 3000) saveReplay();
  }
  if (now - lastPaint > 95) {
    lastPaint = now;
    paint();
  }
  if (ids['order-dialog'].open) preview?.draw();
  else factory?.draw(sim, sim?.order ?? DEFAULT_ORDER, dt);
}

paint();
requestAnimationFrame(frame);
startFactory();

