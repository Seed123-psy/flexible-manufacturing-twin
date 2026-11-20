import { envelopeDoors, envelopePoint, envelopeWalls, envelopeEdges, roofAirRoutes, roofFrames, roofRidgeZ } from './building-layout.js';
import { REJECT_BRIDGE_LAYOUT } from './reject-bridge-layout.js';
import { ENGINEERING_LAYOUT } from './engineering-layout.js';
import { CONTROL_ROOM_CENTER, CONTROL_ROOM_SIZE } from './control-room-model.js';
import { conveyorRuns, getMaterialTravel, positions, productionLines, productionPads, rejectConveyorRuns, rejectSkyRuns, workshopFloor } from './layout.js';
import { followAgvDrive, intakeDrives, outboundDrive, returnIn, sampleAgvDrive, shortestTurn } from './logistics-drive.js';
import { inboundDock, loadingRobotTransfer, outboundDock, outboundStop, rackColumns, rackRailZ, sortJunction, sortPorts, truckPark, truckTravel, warehouseCapacity, warehouseWaveSize } from './logistics-layout.js';
import { LOADING_ROBOT_HOME, MOBILE_CHARGING_BAYS, MOBILE_CHARGING_YAW, MOBILE_FLEET_POSES, PACKAGING_DELIVERY_ROUTES, routeForHandoff, routeToChargingBay } from './mobile-layout.js';
import { CHARGING_ZONE_CENTER, FILAMENT_DELIVERY_ROUTES, FILAMENT_PICKUP, FILAMENT_WAREHOUSE_CENTER, FILAMENT_WAREHOUSE_FOOTPRINT, HUMAN_CROSSINGS, HUMAN_WALKWAYS, PACKAGING_WAREHOUSE_CENTER, PATROL_RADIUS, PATROL_WAYPOINTS } from './patrol-layout.js';
import { REJECT_APRON_END, REJECT_GANTRY_HOME, REJECT_GANTRY_RAILS, REJECT_GANTRY_Z, REJECT_LINK_HEIGHT, REJECT_LIFTS, REJECT_ROAD_WIDTH, REJECT_TRUCK_EXIT, REJECT_TRUCK_EXTENTS, REJECT_TRUCK_PARK, REJECT_ZONE_SIZE } from './reject-layout.js';

const paper = '#f4f2e8';
const ink = '#183842';
const faint = '#557078';
const accent = '#196b60';
const liveInk = '#167449';
const warn = '#a35b17';
const point = (x, z) => [x, 0, z];
const clamp = (n, min = 0, max = 1) => Math.max(min, Math.min(max, n));
const smooth = (n, start = 0, end = 1) => { const p = clamp((n - start) / (end - start)); return p * p * (3 - 2 * p); };
const mix = (a, b, p) => [a[0] + (b[0] - a[0]) * p, a[1] + (b[1] - a[1]) * p, a[2] + (b[2] - a[2]) * p];
const floorEdges = [workshopFloor.center[0] - workshopFloor.size[0] / 2, workshopFloor.center[2] - workshopFloor.size[1] / 2,
  workshopFloor.center[0] + workshopFloor.size[0] / 2, workshopFloor.center[2] + workshopFloor.size[1] / 2];
const mapRegions = {
  overview: { label: '总览', bounds: [floorEdges[0] - 1, floorEdges[1] - 1.4, REJECT_APRON_END + 1, floorEdges[3] + 1.4], description: '从西侧办公室、双线生产区到东侧仓储和发运区。' },
  west: { label: '西侧', bounds: [-23.8, -8.7, -2.7, 8.6], description: '设计办公室、卷料仓及 A 线西段供料与检修通道。' },
  lineA: { label: 'A 线', bounds: [-13.8, -8.3, 14.8, 7.3], description: 'A 线生产、装盒及不合格品跨线旁路。' },
  lineB: { label: 'B 线', bounds: [-13.8, 4.2, 14.8, 21.6], description: 'B 线生产、装盒及线间巡检通道。' },
  east: { label: '仓配', bounds: [12.1, -9.2, 38.7, 9.8], description: '扫码分拣、立库、双位回充及成品发运月台。' },
  reject: { label: '清运', bounds: [10.1, 4.5, REJECT_APRON_END + 0.5, 17.6], description: '高架接驳、隔离周转与不合格品专车道。' },
};

const layers = {
  live: { label: '动态', color: liveInk, on: true, dot: true },
  safety: { label: '安全分区', color: warn, on: true, dash: [4, 3] },
  structure: { label: '结构', color: '#496472', on: true },
  roof: { label: '屋架', color: '#6b7399', dash: [5, 4] },
  fire: { label: '消防', color: '#ae3c35', dot: true },
  power: { label: '供配电', color: '#8b5a12', dash: [4, 2] },
  hvac: { label: '暖通', color: '#4b6094', dash: [8, 3] },
  trench: { label: '地沟', color: '#6e5548', dash: [3, 3] },
  settlement: { label: '沉降点', color: '#884d80', dot: true },
  people: { label: '人员通道', color: '#287457', on: true, width: 1.35 },
  conveyor: { label: '正常输送', color: '#456577', on: true, width: 1.35 },
  reject: { label: '不合格旁路', color: '#b34e46', on: true, width: 1.65 },
  collection: { label: '独立清运', color: '#a45b2b', on: true, width: 1.65, dash: [7, 3] },
  inbound: { label: '入库 AGV', color: '#007d88', on: true, width: 1.6 },
  outbound: { label: '出库发运', color: '#785b94', on: true, width: 1.6 },
  supply: { label: '盒坯及卷料补给', color: '#9a671d', on: true, width: 1.45, dash: [5, 3] },
  patrol: { label: '巡检', color: '#3165a8', on: true, width: 1.45, dash: [3, 3] },
  charge: { label: '换岗与回充', color: '#5573a3', width: 1.3, dash: [6, 4] },
};
const sample = (curve) => curve.getSpacedPoints(32).map((v) => v.toArray());
const patrolRoute = PATROL_WAYPOINTS.map(({ point }) => point);
const packagingPaths = Object.values(PACKAGING_DELIVERY_ROUTES).map(({ points }) => points);
const filamentPaths = Object.values(FILAMENT_DELIVERY_ROUTES);
const flow = {
  people: HUMAN_WALKWAYS.map(({ points }) => points),
  conveyor: [...conveyorRuns, [sortJunction], ...sortPorts.map((port) => [sortJunction, port])],
  reject: rejectConveyorRuns.filter(([a, b]) => Math.max(a[1], b[1]) < 2),
  collection: [[REJECT_TRUCK_PARK, REJECT_TRUCK_EXIT]],
  inbound: [...intakeDrives.flatMap(({ lane, approach }) => [sample(lane), sample(approach)]), sample(returnIn)],
  outbound: [sample(outboundDrive), [LOADING_ROBOT_HOME, loadingRobotTransfer(1)], [truckPark, point(truckPark[0] + truckTravel, truckPark[2])]],
  supply: [...packagingPaths, ...filamentPaths],
  patrol: [patrolRoute],
  charge: Object.entries(MOBILE_FLEET_POSES).flatMap(([fleet, { home, parking, chargeAtParking }]) => Object.values(parking).flatMap((at) =>
    [routeForHandoff(fleet, home, at), ...(chargeAtParking ? [] : MOBILE_CHARGING_BAYS.map((bay) => routeToChargingBay(fleet, at, bay)))])),
};
const elevatedRuns = [...rejectSkyRuns, ...rejectConveyorRuns.filter(([a, b]) => Math.max(a[1], b[1]) >= 2)];
const roadCenter = point((REJECT_TRUCK_PARK[0] - 2.1 + REJECT_APRON_END) / 2, REJECT_TRUCK_PARK[2]);
const roadSize = [REJECT_APRON_END - REJECT_TRUCK_PARK[0] + 2.1, REJECT_ROAD_WIDTH];
const blocks = [
  { label: 'CR-01  监控室', center: CONTROL_ROOM_CENTER, size: CONTROL_ROOM_SIZE, color: '#287565' },
  { label: '设计办公室', center: positions.design, size: [8.1, 6.1], color: '#836b47' },
  ...productionPads.map((pad, i) => ({ ...pad, label: `${i ? 'B' : 'A'} 线生产区`,
    labelPoint: point(-6.9, i ? 6.95 : -4.55), color: i ? '#8c6d36' : '#397365' })),
  { label: '卷料仓', center: FILAMENT_WAREHOUSE_CENTER, size: FILAMENT_WAREHOUSE_FOOTPRINT, labelPoint: point(-11.7, -6.56), color: '#89643b' },
  { label: '盒坯仓', center: PACKAGING_WAREHOUSE_CENTER, size: [2.75, 2.4], labelPoint: point(16.1, -5.9), color: '#287565' },
  { label: '隔离周转', center: positions.reject, size: REJECT_ZONE_SIZE, labelPoint: point(23.45, 11.95), color: '#a14943' },
  { label: '分拣', center: positions.sort, size: [4.4, 4.9], labelPoint: point(17.8, 4.53), color: '#456577' },
  { label: `立库 · ${warehouseCapacity} 位`, center: positions.storage, size: [9.8, 3.35], labelPoint: point(24.1, -4.32), color: '#3b6184' },
  { label: '发运月台', center: truckPark, size: [7.6, 2.65], labelPoint: point(26, 5.92), color: '#785b94' },
  { label: '双位回充', center: CHARGING_ZONE_CENTER, size: [5.3, 2.3], labelPoint: point(32.2, -2.89), color: '#3b6184' },
];
const stations = productionLines.flatMap(({ printers, quality, boxes, robot, buffer }, line) => [
  ...printers.map((id, n) => ({ id, code: `P${line * 3 + n + 1}`, size: [1.55, 1.35] })),
  { id: quality, code: `QC${line + 1}`, size: [2.5, 1.34] }, { id: boxes, code: `BX${line + 1}`, size: [4.48, 2.13] },
  { id: robot, code: `RB${line + 1}`, size: [2.5, 1.34] }, { id: buffer, code: `BF${line + 1}`, size: [2.5, 1.34] },
]);

const fallbackEngineering = {
  // Modelled wall and column axes from hall.js; utilities are explicitly not as-built data.
  structure: {
    paths: [[point(-13.55, -7.4), point(13.55, -7.4)], [point(-13.48, -3.88), point(-13.48, -7.4)],
      [point(-13.55, 20.8), point(13.55, 20.8)]],
    marks: Array.from({ length: 9 }, (_, i) => ({ at: point(-13.485 + i * 3.37, -7.4) }))
      .concat(Array.from({ length: 9 }, (_, i) => ({ at: point(-13.475 + i * 3.37, 20.8) }))),
  },
  roof: {},
  fire: { marks: [{ id: 'FH-01', at: point(-13.05, -5.9) }, { id: 'FH-02', at: point(13.15, -6.6) },
    { id: 'FH-03', at: point(13.15, 19.8) }, { id: 'FH-04', at: point(34.5, 7.15) }] },
  power: { paths: [[point(-13, -7.18), point(13.3, -7.18), point(13.3, -8.12), point(32.2, -8.12), point(32.2, -2.55)]],
    marks: [{ id: 'DB-01', at: point(-8.2, -7.18) }, { id: 'DB-02', at: point(32.2, -8.12) }] },
  hvac: { paths: [[point(-10.6, -1.1), point(9.9, -1.1)], [point(-10.6, 10.4), point(9.9, 10.4)]],
    marks: [{ id: 'AHU-A', at: point(-10.6, -1.1) }, { id: 'AHU-B', at: point(-10.6, 10.4) }] },
  trench: { paths: [[point(-9.7, 18.15), point(14.1, 18.15), point(14.1, 7.7), point(27.9, 7.7)]],
    marks: [{ id: 'TR-01', at: point(10.4, 18.15) }] },
  settlement: { marks: [point(-22.4, -9.2), point(-22.4, 19.9), point(38.1, -9.2), point(38.1, 19.9)]
    .map((at, i) => ({ id: `S${i + 1}`, at })) },
};

const layerControl = (id) => {
  const { color, dash, dot, on, label } = layers[id];
  return `<label style="--route-color:${color}"><input type="checkbox" data-map-layer="${id}" ${on ? 'checked' : ''}>` +
    `<i class="${dot ? 'is-dot' : dash ? 'is-dashed' : ''}" aria-hidden="true"></i>${label}</label>`;
};
const layerMenu = (name, ids) => `<details class="drawing-layer-menu"><summary>${name}</summary><div class="drawing-layer-list">${ids.map(layerControl).join('')}</div></details>`;
export const routeMapControls = `
  <div class="map-regions drawing-toolbar">
    <div class="drawing-views" role="group" aria-label="图纸视区">
      ${Object.entries(mapRegions).map(([id, { label, description }], i) => `<button class="button" type="button" data-map-region="${id}" title="${description}" aria-pressed="${i === 0}">${label}</button>`).join('')}
    </div>
  </div>
  <div class="map-layers drawing-layers" role="group" aria-label="工程图图层">
    <span class="drawing-layer-heading">图层</span>
    ${['live', 'safety', 'structure', 'fire'].map(layerControl).join('')}
    ${layerMenu('机电 / 地基', ['power', 'hvac', 'roof', 'trench', 'settlement'])}
    ${layerMenu('流线', Object.keys(flow))}
  </div>`;

const liveLegend = `<div class="drawing-legend" aria-label="工程图图例">
  <span><i data-symbol="station"></i>作业工位</span><span><i data-symbol="agent"></i>移动设备</span>
  <span><i data-symbol="carton"></i>在途物料</span><span><i data-symbol="bridge"></i>高架输送</span>
  <span><i data-symbol="zone"></i>防碰撞区</span><span><i data-symbol="maintenance"></i>检修包络</span>
  <span><i data-symbol="crossing"></i>人行过街</span>
</div>`;

const useCompactTitle = (width) => width < 330;
const statusCellWidth = (width) => useCompactTitle(width) ? 53 : 75;

function makeView(width, height, region, zoom, shift, cleanView) {
  const frame = cleanView ? { x: 0, y: 0, w: width, h: height } : { x: 30, y: 24, w: width - 44, h: height - 74 };
  const [x0, z0, x1, z1] = region.bounds;
  const scale = Math.max(0.1, Math.min((frame.w - 16) / (x1 - x0), (frame.h - 12) / (z1 - z0))) * zoom;
  const ox = frame.x + frame.w / 2 - ((x0 + x1) / 2 + shift.x) * scale;
  const oz = frame.y + frame.h / 2 - ((z0 + z1) / 2 + shift.z) * scale;
  return { width, height, frame, scale, ox, oz, cleanView };
}

function drawing(ctx, view) {
  const { scale, ox, oz } = view;
  function segment(x1, y1, x2, y2, color, weight = 1) {
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    ctx.lineWidth = weight; ctx.strokeStyle = color; ctx.stroke();
  }
  function path(points, color, weight = 1, dash = []) {
    if (!points?.length) return;
    ctx.beginPath();
    for (const [i, [x, , z]] of points.entries()) {
      if (i) ctx.lineTo(ox + x * scale, oz + z * scale);
      else ctx.moveTo(ox + x * scale, oz + z * scale);
    }
    ctx.lineWidth = weight; ctx.strokeStyle = color; ctx.setLineDash(dash); ctx.stroke(); ctx.setLineDash([]);
  }
  function box([x, , z], [w, h], fill, border, dash = []) {
    const px = ox + (x - w / 2) * scale, py = oz + (z - h / 2) * scale;
    if (fill) { ctx.fillStyle = fill; ctx.fillRect(px, py, w * scale, h * scale); }
    if (border) {
      ctx.lineWidth = 0.9; ctx.strokeStyle = border; ctx.setLineDash(dash);
      ctx.strokeRect(px, py, w * scale, h * scale); ctx.setLineDash([]);
    }
  }
  function text(value, x, y, { color = ink, size = 11, align = 'left', mono = false, weight = 600, halo = false } = {}) {
    ctx.font = `${weight} ${size}px ${mono ? 'ui-monospace, Consolas, monospace' : '"Microsoft YaHei", "PingFang SC", sans-serif'}`;
    ctx.textAlign = align; ctx.textBaseline = 'middle';
    if (halo) { ctx.strokeStyle = paper; ctx.lineWidth = 3.2; ctx.strokeText(value, x, y); }
    ctx.fillStyle = color; ctx.fillText(value, x, y);
  }
  function tag(value, [x, , z], options) {
    text(value, ox + x * scale, oz + z * scale, { align: 'center', halo: true, ...options });
  }
  function cross(x, y, color, radius = 3) {
    segment(x - radius, y, x + radius, y, color); segment(x, y - radius, x, y + radius, color);
  }
  return { segment, path, box, text, tag, cross };
}

function plotClip(ctx, { frame: { x, y, w, h } }) {
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
}

function drawSheet(ctx, view, region, enabled, engineering) {
  const { frame: { x, y, w, h }, width, height, scale, ox, oz, cleanView } = view;
  const { segment, path, box, text, tag, cross } = drawing(ctx, view);
  const right = x + w, bottom = y + h;
  ctx.fillStyle = paper; ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#efede1'; ctx.fillRect(x, y, w, h);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const tick = scale >= 24 ? 2 : scale >= 12 ? 5 : 10;
  const minX = (x - ox) / scale, minZ = (y - oz) / scale;
  const maxX = (right - ox) / scale, maxZ = (bottom - oz) / scale;
  const axisColor = '#9da9a1';
  const grid = (step, minor) => {
    for (let i = Math.ceil(minX / step); i * step < maxX; i++) {
      if (minor && Math.abs(i * step / tick - Math.round(i * step / tick)) < 0.0001) continue;
      const px = ox + i * step * scale;
      segment(px, y, px, bottom, minor ? '#d7d9cc' : '#aebdb2', minor ? 0.48 : 0.85);
    }
    for (let i = Math.ceil(minZ / step); i * step < maxZ; i++) {
      if (minor && Math.abs(i * step / tick - Math.round(i * step / tick)) < 0.0001) continue;
      const py = oz + i * step * scale;
      segment(x, py, right, py, minor ? '#d7d9cc' : '#aebdb2', minor ? 0.48 : 0.85);
    }
  };
  ctx.save(); plotClip(ctx, view);
  box(workshopFloor.center, workshopFloor.size, '#f9f7ee', '#879489');
  grid(tick / (tick === 10 ? 5 : tick), true); grid(tick, false);
  if (minX < 0 && maxX > 0 && minZ < 0 && maxZ > 0) cross(ox, oz, axisColor, 5);

  for (const { center, size, color } of blocks) box(center, size, `${color}10`, `${color}91`);
  box(roadCenter, roadSize, '#a45b2b12', '#ab794c97');
  for (const { id, size } of stations) box(positions[id], size, '#dde5e0', '#54716f');
  for (const rackX of rackColumns) {
    box(point(rackX, rackRailZ - 0.78), [0.82, 1.1], '#dae4ea', '#5d7287');
  }
  for (const berth of MOBILE_CHARGING_BAYS) box(berth, [1.15, 1.38], '#e5ebf4', '#6580a1');
  for (const lift of REJECT_LIFTS) box(lift, [0.86, 0.86], '#f2ddcf', layers.reject.color);
  path([point(REJECT_GANTRY_RAILS[0], REJECT_GANTRY_Z[0]), point(REJECT_GANTRY_RAILS[0], REJECT_GANTRY_Z[1])], '#a35e5a');
  path([point(REJECT_GANTRY_RAILS[1], REJECT_GANTRY_Z[0]), point(REJECT_GANTRY_RAILS[1], REJECT_GANTRY_Z[1])], '#a35e5a');

  if (enabled.has('safety')) {
    const { color } = layers.safety;
    // The robot cells use the hall's marked work envelopes; vehicle sweeps show the model's reservation widths.
    const restricted = engineering.restricted ?? productionLines.map(({ robot }) => ({ center: [positions[robot][0], positions[robot][2]], size: [4.12, 3.35] }));
    for (const area of restricted) box(point(...area.center), area.size, '#b6752025', color, [4, 3]);
    for (const area of engineering.maintenance ?? []) box(point(...area.center), area.size, '#276c8615', '#276c86', [5, 3]);
    if (scale > 15) for (const area of engineering.maintenance ?? []) {
      tag(area.id, point(...area.labelPoint), { color: '#276c86', mono: true, size: 9 });
    }
    box(roadCenter, roadSize, null, color, [5, 4]);
    for (const route of [...flow.inbound, flow.outbound[0]]) path(route, '#ba781222', 2 * 1.07 * scale);
    for (const route of flow.people) {
      if (route === flow.people[5] || route === flow.people[6] || route === flow.people[7]) path(route, '#276c8628', 1.2 * scale);
    }
    path(patrolRoute, '#397fb217', PATROL_RADIUS * 2 * scale);
    tag('外围检修通道', point(31, -9.22), { color: '#35606f', size: 10 });
    if (scale > 14) for (const { robot } of productionLines) {
      const [px, , pz] = positions[robot];
      tag('机械臂作业包络', point(px, pz + 1.42), { color, size: 9 });
    }
  }
  for (const id of Object.keys(flow)) {
    if (!enabled.has(id)) continue;
    const { color, width: weight, dash } = layers[id];
    if (id === 'people') for (const { points, width } of HUMAN_WALKWAYS) path(points, '#7cb59d46', width * scale);
    for (const route of flow[id]) path(route, color, weight, dash);
  }
  if (enabled.has('reject')) {
    for (const route of elevatedRuns) {
      path(route, paper, 4);
      path(route, layers.reject.color, 2.2, [4, 3]);
    }
    tag(`高架段  +${REJECT_LINK_HEIGHT.toFixed(2)} m`, point(15.1, 6.61), { color: layers.reject.color, size: 10 });
  }
  if (enabled.has('patrol')) for (const { point: at, station } of PATROL_WAYPOINTS) {
    if (station) box(at, [0.34, 0.34], paper, layers.patrol.color);
  }
  if (enabled.has('people') || enabled.has('safety')) for (const { point: at, angle, width: crossWidth, length } of HUMAN_CROSSINGS) {
    ctx.save(); ctx.translate(ox + at[0] * scale, oz + at[2] * scale); ctx.rotate(-angle);
    ctx.fillStyle = '#f9f7eb'; ctx.strokeStyle = '#93622f'; ctx.lineWidth = 0.75;
    const cw = length * scale, ch = crossWidth * scale;
    ctx.fillRect(-cw / 2, -ch / 2, cw, ch); ctx.strokeRect(-cw / 2, -ch / 2, cw, ch);
    ctx.fillStyle = '#a97439';
    for (let i = 0; i < 5; i++) ctx.fillRect((i / 5 - 0.45) * cw, -ch / 2 + 1, Math.max(0.5, cw / 10), Math.max(0, ch - 2));
    ctx.restore();
  }

  for (const id of Object.keys(fallbackEngineering)) {
    if (!enabled.has(id)) continue;
    const { color, dash } = layers[id];
    const { paths = [], marks = [] } = engineering[id] ?? fallbackEngineering[id];
    for (const route of paths) {
      if (route.width) path(route.points, `${color}29`, route.width * scale);
      path(route.points ?? route, color, id === 'structure' ? 2.15 : 1.65, route.system === 'return' ? [2, 3] : dash);
    }
    for (const { at, id: markId, size, yaw = 0, outward, labelOffset } of marks) {
      const px = ox + at[0] * scale, py = oz + at[2] * scale;
      if (px < x - 20 || px > right + 20 || py < y - 20 || py > bottom + 20) continue;
      ctx.strokeStyle = color; ctx.fillStyle = paper; ctx.lineWidth = 1.3;
      if (size) {
        ctx.save(); ctx.translate(px, py); ctx.rotate(-yaw);
        const halfWidth = Math.max(2, size[0] * scale / 2), halfHeight = Math.max(2, size[1] * scale / 2);
        ctx.fillStyle = id === 'structure' ? color : `${color}24`;
        ctx.fillRect(-halfWidth, -halfHeight, 2 * halfWidth, 2 * halfHeight);
        ctx.strokeRect(-halfWidth, -halfHeight, 2 * halfWidth, 2 * halfHeight);
        ctx.restore();
      }
      if (outward) {
        const [dx, dz] = outward;
        const distance = Math.max(9, scale * 0.8);
        const nx = px + dx * distance, ny = py + dz * distance;
        segment(px, py, nx, ny, color);
        segment(nx, ny, nx - (dx + dz) * 4, ny - (dz - dx) * 4, color);
        segment(nx, ny, nx - (dx - dz) * 4, ny - (dz + dx) * 4, color);
      } else if (id === 'structure') {
        ctx.fillStyle = color; ctx.fillRect(px - 2, py - 2, 4, 4);
      } else if (id === 'fire' || id === 'settlement') {
        ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        cross(px, py, color, id === 'settlement' ? 5.5 : 2);
      } else {
        ctx.fillRect(px - 3.4, py - 3.4, 6.8, 6.8); ctx.strokeRect(px - 3.4, py - 3.4, 6.8, 6.8);
      }
      if (markId && (id !== 'structure' || scale > 19)) text(markId, px + 6 + (labelOffset?.[0] ?? 0) * scale,
        py - 6 + (labelOffset?.[1] ?? 0) * scale, { color, mono: true, size: 9, halo: true });
    }
  }

  for (const { label, labelPoint, center, color } of blocks) {
    if (scale < 6.8 && width < 500 && !['A 线生产区', 'B 线生产区', '隔离周转'].includes(label) && !label.startsWith('立库')) continue;
    tag(label, labelPoint ?? center, { color, size: width > 510 ? 11 : 10 });
  }
  if (enabled.has('collection')) tag('不合格品专车道  →', point(36, 15.68), { color: layers.collection.color, size: 10 });
  if (scale > 15) for (const { id, code, size } of stations) {
    const [px, , pz] = positions[id];
    tag(code, point(px, pz - size[1] / 2 - 0.38), { color: '#38555a', mono: true, size: 9 });
  }
  ctx.restore();
  const axisText = { color: faint, mono: true, size: 9, align: 'center' };
  if (!cleanView) {
    ctx.lineWidth = 1; ctx.strokeStyle = axisColor; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

    for (let i = Math.ceil(minX / tick); i * tick < maxX; i++) {
      const px = ox + i * tick * scale;
      if (px < x + 12 || px > right - 12) continue;
      segment(px, y, px, y - 4, axisColor); text(`${i * tick}`, px, y - 10, axisText);
    }
    for (let i = Math.ceil(minZ / tick); i * tick < maxZ; i++) {
      const py = oz + i * tick * scale;
      if (py < y + 7 || py > bottom - 7) continue;
      segment(x, py, x - 4, py, axisColor); text(`${i * tick}`, x - 10, py, { ...axisText, align: 'right' });
    }
    text('X / m', 12, 13, { ...axisText, align: 'left', color: accent });
    text('Z', 14, y + 7, { ...axisText, color: accent });

    // A coordinate triad avoids implying surveyed geographic north.
    const ax = right - 32, ay = y + 16;
    ctx.fillStyle = '#f4f2e8df'; ctx.fillRect(ax - 6, ay - 7, 36, 34);
    segment(ax, ay, ax + 14, ay, faint); segment(ax, ay, ax, ay + 14, faint);
    segment(ax + 11, ay - 3, ax + 14, ay, faint); segment(ax + 11, ay + 3, ax + 14, ay, faint);
    segment(ax - 3, ay + 11, ax, ay + 14, faint); segment(ax + 3, ay + 11, ax, ay + 14, faint);
    text('X', ax + 22, ay, axisText); text('Z', ax, ay + 21, axisText);
  }

  const bar = scale >= 25 ? 2 : scale >= 9 ? 5 : 10;
  const barSize = bar * scale, barX = right - barSize - 10, barY = bottom - 12;
  ctx.fillStyle = '#f4f2e8e8'; ctx.fillRect(barX - 8, barY - 20, barSize + 16, 26);
  for (let i = 0; i < 2; i++) {
    ctx.fillStyle = i ? '#fffdf2' : ink; ctx.fillRect(barX + i * barSize / 2, barY - 3, barSize / 2, 4);
  }
  ctx.strokeStyle = ink; ctx.lineWidth = 0.8; ctx.strokeRect(barX, barY - 3, barSize, 4);
  text('0', barX, barY - 10, axisText); text(`${bar} m`, barX + barSize, barY - 10, axisText);

  if (cleanView) return;

  // Title block: dynamic state is painted into the right cell without regenerating the sheet.
  const labelY = bottom + 13, valueY = bottom + 29;
  const statusX = right - statusCellWidth(width);
  const titleSmall = { color: faint, size: 9, weight: 600 };
  ctx.fillStyle = '#e8ebe0'; ctx.fillRect(x, bottom + 1, w, 40);
  segment(x, bottom + 41, right, bottom + 41, axisColor);
  const dividers = [x + 0.5, statusX, right - 0.5];
  if (useCompactTitle(width)) {
    text('F01 · XZ-101', x + 6, labelY, { mono: true, size: 10, weight: 750 });
    text(`R01 · ${scale.toFixed(1)} px/m`, x + 6, valueY, { mono: true, size: 9, color: faint });
    text('仿真状态', statusX + 6, labelY, titleSmall);
  } else {
    const wide = width > 480;
    const revX = x + (wide ? 152 : 101), scaleX = revX + (wide ? 74 : 43);
    dividers.push(revX, scaleX);
    text(wide ? '图号  /  DRAWING NO.' : '图号', x + 8, labelY, titleSmall);
    text('F01 · XZ-101', x + 8, valueY, { mono: true, size: 12, weight: 750 });
    text('修订', revX + 8, labelY, titleSmall); text('R01', revX + 8, valueY, { mono: true, size: 12 });
    text(wide ? '图示比例  /  SCALE' : '比例', scaleX + 8, labelY, titleSmall);
    text(`${scale.toFixed(1)} px/m`, scaleX + 8, valueY, { mono: true, size: 11 });
    if (width > 540) text(`${region.label} · 米制正投影`, scaleX + 105, valueY, { size: 11, color: faint });
    text('状态 / 仿真', statusX + 10, labelY, titleSmall);
  }
  for (const vertical of dividers) segment(vertical, bottom + 1, vertical, bottom + 41, axisColor);
}

function compilePath(points) {
  let length = 0;
  const steps = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const run = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    if (run > 0) { steps.push({ a, b, run, offset: length }); length += run; }
  }
  return { steps, length, first: points[0] };
}
function pointOn({ steps, length, first }, p) {
  if (!steps.length) return { point: first, yaw: 0 };
  const distance = clamp(p) * length;
  const { a, b, run, offset } = steps.find((step) => distance < step.offset + step.run) ?? steps.at(-1);
  return { point: mix(a, b, (distance - offset) / run), yaw: Math.atan2(b[0] - a[0], b[2] - a[2]) };
}
function aisle(path, p, startYaw, endYaw) {
  const pose = pointOn(path, p);
  const before = pointOn(path, p - 0.012).point, after = pointOn(path, p + 0.012).point;
  let yaw = Math.atan2(after[0] - before[0], after[2] - before[2]);
  if (startYaw != null) yaw = shortestTurn(startYaw, yaw, smooth(p, 0, 0.10));
  if (endYaw != null) yaw = shortestTurn(yaw, endYaw, smooth(p, 0.91, 1));
  return { point: pose.point, yaw, moving: true };
}
const packPathByStation = Object.fromEntries(Object.entries(PACKAGING_DELIVERY_ROUTES).map(([id, { points }]) =>
  [id, [compilePath(points), compilePath([...points].reverse())]]));
const filamentPathByStation = Object.fromEntries(Object.entries(FILAMENT_DELIVERY_ROUTES).map(([id, points]) => [id, compilePath(points)]));
const routeCache = new WeakMap();
const east = Math.PI / 2;
function inboundPose(station, home) {
  const { motion, phaseProgress: p = 0 } = station ?? {};
  const route = intakeDrives[station?.lane ?? ((station?.unit ?? 1) - 1) % 2] ?? intakeDrives[0];
  switch (motion) {
    case 'approach-in': return { ...sampleAgvDrive(route.approach, p, -east, east), moving: true };
    case 'dock-in': return { point: route.stop, yaw: east, working: true };
    case 'drive-in': return { ...sampleAgvDrive(route.lane, p, east, east), moving: true, loaded: true };
    case 'rack-dock': return { point: inboundDock, yaw: east, working: true, loaded: true };
    case 'return-in': return { ...sampleAgvDrive(returnIn, p, east, -east), moving: true };
    default: return home;
  }
}
function outboundPoses(station, complete) {
  const { motion, phaseProgress: p = 0, unit, truckSlot } = station ?? {};
  const load = unit && ['human-carry', 'human-place', 'stow'].includes(motion)
    ? loadingRobotTransfer(truckSlot ?? (unit - 1) % warehouseWaveSize) : LOADING_ROBOT_HOME;
  let agv = { point: outboundDock, yaw: east };
  let loader = { point: LOADING_ROBOT_HOME, yaw: Math.PI };
  let travel = complete ? 1 : 0;
  switch (motion) {
    case 'dock-out': agv = { ...agv, working: true, loaded: true }; break;
    case 'drive-out': agv = { ...sampleAgvDrive(outboundDrive, p, east, -east), moving: true, loaded: true }; break;
    case 'human-grab': agv = { point: outboundStop, yaw: -east, loaded: true }; loader = { ...loader, working: true }; break;
    case 'human-carry':
      agv = { ...followAgvDrive(outboundDrive, smooth(p, 0.28, 1) * 0.4, -east, east, true), moving: true };
      loader = { point: mix(LOADING_ROBOT_HOME, load, smooth(p)), yaw: Math.PI * (1 - smooth(p, 0.08, 0.84)), moving: true, loaded: true };
      break;
    case 'human-place':
      agv = { ...followAgvDrive(outboundDrive, 0.4 + 0.37 * smooth(p), -east, east, true), moving: true };
      loader = { point: load, yaw: 0, working: true, loaded: true }; break;
    case 'stow':
      agv = { ...followAgvDrive(outboundDrive, 0.77 + 0.23 * smooth(p), -east, east, true), moving: true };
      loader = { point: mix(load, LOADING_ROBOT_HOME, smooth(p)), yaw: Math.PI * smooth(p, 0.03, 0.86), moving: true }; break;
    case 'depart': travel = smooth(p, 0.25, 1); break;
    case 'truck-return': travel = 1 - smooth(p, 0, 0.83); break;
  }
  return { agv, loader, travel };
}
function packagingPose(delivery, home) {
  const paths = packPathByStation[delivery?.station];
  if (!paths || !delivery.amount) return home;
  const p = delivery.phaseProgress;
  if (delivery.phase === 'delivery') return { ...aisle(paths[0], Math.min(p / 0.88, 1), 0, 0), moving: p < 0.88, loaded: true };
  if (delivery.phase === 'return') return aisle(paths[1], p, 0, 0);
  return { ...home, working: delivery.phase === 'pickup' };
}
function fleetPose(fleet, agent, layout, index, work) {
  const interval = agent?.interval;
  const kind = interval?.kind;
  if (kind === 'charging') {
    const at = MOBILE_CHARGING_BAYS[interval.bay] ?? agent.location?.position;
    if (at) return { point: at, yaw: interval.bay == null ? layout.parkingYaw : MOBILE_CHARGING_YAW, charging: true };
  }
  const route = interval?.route;
  if (kind && kind !== 'work' && route?.points?.length > 1) {
    if (!routeCache.has(route)) routeCache.set(route, compilePath(route.points));
    const { yaw, parkingYaw } = layout;
    const start = { 'handoff-out': yaw, return: parkingYaw, exit: MOBILE_CHARGING_YAW, 'handoff-in': parkingYaw }[kind];
    const end = { 'handoff-out': parkingYaw, return: MOBILE_CHARGING_YAW, exit: parkingYaw, 'handoff-in': yaw }[kind];
    return aisle(routeCache.get(route), agent.progress, start, end);
  }
  if (!fleet ? index === 0 : fleet.active === agent?.id && ['working', 'standby'].includes(agent?.status)) return work;
  return { point: agent?.location?.position ?? (index ? layout.parking.backup : layout.parking.primary), yaw: layout.parkingYaw };
}

function paintLive(ctx, view, frame, sim, enabled, clear) {
  const { width, height, scale, ox, oz, frame: plot, cleanView } = view;
  const { box, text } = drawing(ctx, view);
  if (clear) ctx.clearRect(0, 0, width, height);
  const active = enabled.has('live');
  const right = plot.x + plot.w, bottom = plot.y + plot.h;
  if (!cleanView) {
    const completed = frame?.complete ?? sim?.complete;
    const time = frame?.time ?? sim?.time ?? 0;
    const status = !active ? ['图层关闭', faint] : !frame ? ['未接入', faint] : completed ? ['已完成', accent] : time ? ['已同步', liveInk] : ['就绪', accent];
    const compact = useCompactTitle(width), statusX = right - statusCellWidth(width);
    if (!compact) {
      ctx.fillStyle = status[1]; ctx.beginPath(); ctx.arc(statusX + 11, bottom + 29, 2.8, 0, Math.PI * 2); ctx.fill();
    }
    text(status[0], statusX + (compact ? 6 : 19), bottom + 29, { color: status[1], size: compact ? 10 : 11 });
  }
  if (!active) return;

  ctx.save(); plotClip(ctx, view);
  const stationFrames = frame?.stations;
  for (const { id, size: [w, h] } of stations) {
    const device = stationFrames?.[id];
    if (!device?.active) continue;
    const at = positions[id];
    box(at, [w, h], '#74c89756', liveInk);
    const px = ox + (at[0] - w / 2) * scale, py = oz + (at[2] - h / 2) * scale;
    ctx.fillStyle = liveInk; ctx.fillRect(px, py, Math.max(2, w * scale * (device.progress ?? 0)), 2.2);
  }
  const transfers = frame?.transfers;
  // A bounded active-packet overlay. Never visit historical jobs, inventory, or lane timelines here.
  for (let i = 0, count = Math.min(transfers?.length ?? 0, 96); i < count; i++) {
    const { from, to, progress, kind } = transfers[i];
    const travel = getMaterialTravel(from, to);
    if (!travel?.steps.length) continue;
    const distance = progress * travel.length;
    const step = travel.steps.find(({ offset, distance: length }) => distance < offset + length) ?? travel.steps.at(-1);
    if (!step.distance) continue;
    const at = mix(step.start, step.end, clamp((distance - step.offset) / step.distance));
    const px = ox + at[0] * scale, py = oz + at[2] * scale;
    if (px < plot.x - 4 || px > right + 4 || py < plot.y - 4 || py > bottom + 4) continue;
    const r = clamp(scale * 0.24, 2, 4.3);
    ctx.fillStyle = kind === 'reject' ? '#b34134' : '#d08626';
    ctx.strokeStyle = paper; ctx.lineWidth = 1;
    ctx.fillRect(px - r, py - r, 2 * r, 2 * r); ctx.strokeRect(px - r, py - r, 2 * r, 2 * r);
  }

  function symbol({ point: at, yaw = 0, charging, moving, loaded, yielding, working, scanning }, kind, color, name) {
    if (!at) return;
    const px = ox + at[0] * scale, py = oz + at[2] * scale;
    if (px < plot.x - 20 || px > right + 20 || py < plot.y - 20 || py > bottom + 20) return;
    const highlighted = charging || moving || working || yielding || scanning || loaded;
    if (kind === 'gantry') {
      ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.beginPath();
      ctx.moveTo(ox + REJECT_GANTRY_RAILS[0] * scale, py); ctx.lineTo(ox + REJECT_GANTRY_RAILS[1] * scale, py); ctx.stroke();
    }
    ctx.save(); ctx.translate(px, py); ctx.rotate(-yaw);
    ctx.fillStyle = highlighted ? color : '#e9eee3'; ctx.strokeStyle = color; ctx.lineWidth = 1.2;
    if (kind === 'ship' || kind === 'waste') {
      const truck = kind === 'waste' ? REJECT_TRUCK_EXTENTS : { rear: -1.46, front: 2.26, halfWidth: 0.86 };
      const w = truck.halfWidth * scale, length = (truck.front - truck.rear) * scale;
      const back = truck.rear * scale, nose = truck.front * scale, cab = nose - length * 0.28;
      ctx.fillRect(-w, back, w * 2, length); ctx.strokeRect(-w, back, w * 2, length);
      ctx.fillStyle = highlighted ? '#fff7df' : color; ctx.fillRect(-w * 0.73, cab + 1, w * 1.46, Math.max(1, nose - cab - 2));
    } else {
      const type = kind === 'rover' ? [0.66, 0.77] : kind === 'agv' ? [0.54, 0.76] : [0.4, 0.5];
      const w = Math.max(3.5, type[0] * scale), h = Math.max(4.1, type[1] * scale);
      ctx.beginPath();
      ctx.moveTo(-w, -h); ctx.lineTo(w, -h); ctx.lineTo(w, h * 0.48); ctx.lineTo(0, h); ctx.lineTo(-w, h * 0.48);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      if (loaded || charging) {
        ctx.fillStyle = charging ? '#ffe8a3' : '#fff9e9'; ctx.fillRect(-2, -2, 4, 4);
      }
    }
    ctx.restore();
    if (name && ((scale >= 20 && highlighted) || yielding)) {
      text(yielding ? '巡检让行' : name, px, py + Math.max(10, 0.75 * scale + 5),
        { align: 'center', color: yielding ? warn : color, halo: true, size: 9 });
    }
  }
  const { agv, loader, travel } = outboundPoses(stationFrames?.dispatch, frame?.finalDeparture ?? completed);
  const reject = frame?.logistics?.rejects;
  if (reject?.truckVisible !== false) symbol({ point: point(reject?.truckX ?? REJECT_TRUCK_PARK[0], REJECT_TRUCK_PARK[2]),
    yaw: east, moving: reject?.truck === 'departing' || reject?.truck === 'returning' }, 'waste', layers.reject.color, '清运车');
  symbol({ point: point(truckPark[0] + truckTravel * travel, truckPark[2]), yaw: east, moving: travel > 0 && travel < 1 }, 'ship', layers.outbound.color, '成品车');
  if (reject?.job) symbol({ point: reject.gantry ?? REJECT_GANTRY_HOME, working: true, loaded: reject.carrying }, 'gantry', layers.reject.color, '龙门吊');
  const filament = frame?.filament?.delivery;
  const filamentPath = filamentPathByStation[filament?.station];
  const back = filament?.phase === 'return';
  const filamentProgress = back ? 1 - filament.phaseProgress : filament?.phase === 'delivery' ? filament.phaseProgress : Number(filament?.phase === 'install');
  const filamentPose = filamentPath ? pointOn(filamentPath, filamentProgress) : { point: FILAMENT_PICKUP, yaw: east };
  symbol({ ...filamentPose, yaw: filamentPose.yaw + (back ? Math.PI : 0), working: Boolean(filament),
    moving: back || filament?.phase === 'delivery', loaded: back || filament?.phase === 'delivery' }, 'cart', layers.supply.color, '卷料车');
  for (const [key, layout] of Object.entries(MOBILE_FLEET_POSES)) {
    const fleet = frame?.battery?.fleets?.[key];
    const home = { point: layout.home, yaw: layout.yaw };
    const work = key === 'inboundAgv' ? inboundPose(stationFrames?.sort, home) : key === 'outboundAgv' ? agv
      : key === 'loadingRobot' ? loader : key === 'packagingRobot' ? packagingPose(frame?.packaging?.delivery, home) : frame?.inspection?.frame ?? home;
    const kind = key.endsWith('Agv') ? 'agv' : key === 'inspectionRobot' ? 'rover' : 'handler';
    const color = { inboundAgv: layers.inbound.color, outboundAgv: layers.outbound.color, loadingRobot: '#655082',
      packagingRobot: layers.supply.color, inspectionRobot: layers.patrol.color }[key];
    const primary = fleet?.primary, backup = fleet?.backup;
    symbol(fleetPose(fleet, primary, layout, 0, work), kind, color, primary?.id);
    symbol(fleetPose(fleet, backup, layout, 1, work), kind, color, backup?.id);
  }
  ctx.restore();
}


function prepareEngineering(layout) {
  if (!layout) return { ...fallbackEngineering, coordination: false };
  const mark = ({ id, center, size, yaw, labelOffset }) => ({ id, at: point(...center), size, yaw, labelOffset });
  const span = ({ from, to, points, width, system }) => ({ width, system, points: (points ?? [from, to]).map((at) => point(...at)) });
  const wall = envelopeWalls.map(({ side, from, to }) => span({ from: envelopePoint(side, from), to: envelopePoint(side, to), width: 0.24 }));
  const doorMarks = envelopeDoors.filter(({ type }) => type !== 'egress').map(({ side, at, id, clearWidth }) => mark({
    id, center: envelopePoint(side, at), size: [clearWidth, 0.23], yaw: side === 'east' || side === 'west' ? Math.PI / 2 : 0,
  }));
  const { north, south, west, east } = envelopeEdges;
  const roofAxes = roofFrames.map((x) => span({ from: [x, north], to: [x, south] }));
  roofAxes.push(span({ from: [west, roofRidgeZ], to: [east, roofRidgeZ] }));
  return {
    coordination: true,
    structure: { paths: [...fallbackEngineering.structure.paths, ...wall, ...REJECT_BRIDGE_LAYOUT.spans.map(span)],
      marks: [...fallbackEngineering.structure.marks, ...layout.columns.map(mark), ...doorMarks,
        ...REJECT_BRIDGE_LAYOUT.footprint.map(mark), ...REJECT_BRIDGE_LAYOUT.liftBearings.map(mark)] },
    roof: { paths: roofAxes },
    fire: { paths: layout.fireAisles.map(span), marks: [...layout.hydrants.map(mark), ...layout.exits.map((exit) => ({
      ...mark(exit), size: [exit.clearWidth, exit.depth], outward: exit.outward,
    }))] },
    power: { marks: layout.electricalCabinets.map(mark) },
    hvac: { paths: [...layout.hvac.ducts.map(span), ...roofAirRoutes.map(span)],
      marks: [...layout.hvac.diffusers.map(mark), ...roofAirRoutes.map((unit) => mark({ ...unit, size: [1.78, 0.99] }))] },
    trench: { paths: [span(layout.trench)], marks: [{ id: layout.trench.id, at: point(
      (layout.trench.from[0] + layout.trench.to[0]) / 2, (layout.trench.from[1] + layout.trench.to[1]) / 2,
    ) }] },
    settlement: { marks: layout.slab.markers.map(mark) },
    maintenance: layout.maintenanceEnvelopes,
    restricted: layout.antiCollisionZones,
  };
}

/** Mount once. Call draw(sim) with each visible snapshot, or pass { getSim, engineeringLayout }.
 * A state supplied as the third argument is also accepted. draw() retains it on UI redraws.
 */
export function mountRouteMap(panel, trigger, stateOrOptions) {
  const canvas = panel?.querySelector('.route-map-canvas, canvas');
  if (!canvas) return () => {};
  const context = canvas.getContext('2d');
  if (!context) return () => {};
  const document = canvas.ownerDocument, window = document.defaultView;
  const isDialog = panel.tagName === 'DIALOG';
  const options = typeof stateOrOptions === 'function' ? { getSim: stateOrOptions } : stateOrOptions;
  const cleanView = options?.cleanView === true;
  const controls = panel.querySelector('.route-map-body') ?? canvas.parentElement;
  controls.classList.add('drawing-body');
  panel.classList.add('drawing-panel');
  const stage = document.createElement('div');
  stage.className = 'drawing-stage';
  stage.tabIndex = 0;
  stage.setAttribute('aria-label', '工程图视窗，可用方向键平移、加减键缩放、Home 键复位');
  canvas.before(stage); stage.append(canvas);
  const overlay = document.createElement('canvas');
  overlay.className = 'drawing-live-canvas'; overlay.setAttribute('aria-hidden', 'true');
  stage.append(overlay);
  const liveContext = overlay.getContext('2d') ?? context;
  const description = panel.querySelector('.route-map-description');
  const oldLegend = panel.querySelector('.route-map-body > .ops-legend');
  if (!cleanView) {
    if (oldLegend) oldLegend.outerHTML = liveLegend;
    else stage.insertAdjacentHTML('afterend', liveLegend);
  }
  const note = panel.querySelector('.route-map-note');
  const regionButtons = [...panel.querySelectorAll('[data-map-region]')];
  const layerInputs = [...panel.querySelectorAll('[data-map-layer]')];
  const enabled = new Set(layerInputs.filter((input) => input.checked).map((input) => input.dataset.mapLayer));
  if (!layerInputs.length) for (const [id, layer] of Object.entries(layers)) { if (layer.on) enabled.add(id); }
  const menus = [...panel.querySelectorAll('.drawing-layer-menu')];
  const tools = panel.querySelector('.drawing-tools');
  const toolMenus = [...panel.querySelectorAll('.drawing-camera-tools'), ...menus];
  const getSim = options?.getSim;
  const suppliedLayout = options && Object.hasOwn(options, 'engineeringLayout') ? options.engineeringLayout : ENGINEERING_LAYOUT;
  let engineering = prepareEngineering(suppliedLayout);
  let sim = options?.sim ?? (options && !('getSim' in options || 'engineeringLayout' in options || 'cleanView' in options) ? options : null);
  let selected = 'overview', zoom = 1, width = 0, height = 0, ratio = 0;
  let shift = { x: 0, z: 0 };
  let dirty = true, view, lastSim, lastFrame, lastTime, raf, drag, visible = false, disposed = false;
  function setNote() {
    if (note) note.textContent = engineering.coordination ? '协调模型 · 非竣工图。消防布置、净空及沉降均未经现场核验。'
      : '占位示意 · 机电、消防和沉降点尚无工程数据，不可用于现场作业。';
  }
  function draw(nextSim) {
    if (nextSim !== undefined) sim = nextSim;
    else if (getSim) sim = getSim();
    if (disposed || (isDialog && !panel.open)) return;
    if (!visible) {
      width = stage.clientWidth; height = stage.clientHeight;
      if (width < 185 || height < 130) return;
      visible = true; dirty = true;
    }
    const dpr = Math.min(window?.devicePixelRatio || 1, 2);
    const frame = sim?.frame ?? sim;
    const currentTime = frame?.time ?? sim?.time;
    if (!dirty && dpr === ratio && frame === lastFrame && sim === lastSim && currentTime === lastTime) return;
    const resized = canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr) || dpr !== ratio;
    if (resized) {
      ratio = dpr;
      canvas.width = overlay.width = Math.round(width * dpr);
      canvas.height = overlay.height = Math.round(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (liveContext !== context) liveContext.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    const region = mapRegions[selected];
    if (resized || dirty || !view) view = makeView(width, height, region, zoom, shift, cleanView);
    const separate = liveContext !== context;
    if (resized || dirty || !separate) drawSheet(context, view, region, enabled, engineering);
    paintLive(liveContext, view, frame, sim, enabled, separate);
    dirty = false; lastFrame = frame; lastSim = sim; lastTime = currentTime;
  }
  function invalidate() {
    dirty = true;
    if (raf == null) raf = window.requestAnimationFrame(() => { raf = undefined; draw(); });
  }
  function selectRegion(id) {
    if (!Object.hasOwn(mapRegions, id)) return;
    selected = id;
    zoom = 1; shift = { x: 0, z: 0 };
    for (const button of regionButtons) button.setAttribute('aria-pressed', String(button.dataset.mapRegion === id));
    if (description) description.textContent = mapRegions[id].description;
    invalidate();
  }
  function zoomBy(factor, px, py) {
    const value = clamp(zoom * factor, 0.75, 5);
    if (!view || value === zoom) return;
    const current = makeView(width, height, mapRegions[selected], zoom, shift, cleanView);
    const change = (1 - zoom / value) / current.scale;
    const { frame } = current;
    if (px != null && py != null) shift = { x: shift.x + (px - frame.x - frame.w / 2) * change, z: shift.z + (py - frame.y - frame.h / 2) * change };
    zoom = value;
    invalidate();
  }
  function pan(dx, dy, initial = shift, scale = view?.scale ?? 1) {
    shift = { x: clamp(initial.x - dx / scale, -64, 64), z: clamp(initial.z - dy / scale, -40, 40) };
    invalidate();
  }

  const events = new AbortController();
  const on = (target, type, handler, options = {}) => target?.addEventListener(type, handler, { ...options, signal: events.signal });
  for (const button of regionButtons) on(button, 'click', () => selectRegion(button.dataset.mapRegion));
  for (const button of panel.querySelectorAll('[data-map-zoom]')) on(button, 'click', () => {
    if (button.dataset.mapZoom === 'reset') selectRegion(selected);
    else zoomBy(button.dataset.mapZoom === 'in' ? 1.25 : 0.8);
  });
  for (const input of layerInputs) on(input, 'change', () => {
    if (input.checked) enabled.add(input.dataset.mapLayer);
    else enabled.delete(input.dataset.mapLayer);
    invalidate();
  });
  for (const menu of menus) on(menu, 'toggle', () => {
    if (menu.open) for (const other of menus) if (other !== menu) other.open = false;
  });
  on(document, 'pointerdown', (event) => {
    for (const menu of menus) if (!menu.contains(event.target)) menu.open = false;
    if (tools?.open && !tools.contains(event.target)) tools.open = false;
  });
  on(controls, 'keydown', (event) => {
    if (event.key !== 'Escape') return;
    const menu = toolMenus.find((item) => item.open) ?? (tools?.open ? tools : null);
    if (!menu) return;
    menu.open = false; menu.querySelector('summary')?.focus(); event.stopPropagation();
  });
  on(stage, 'wheel', (event) => {
    if (!cleanView && !event.ctrlKey && !stage.matches(':focus')) return;
    if (!event.deltaY) return;
    event.preventDefault();
    const rect = stage.getBoundingClientRect();
    zoomBy(event.deltaY < 0 ? 1.16 : 1 / 1.16, (event.clientX - rect.left) * width / rect.width, (event.clientY - rect.top) * height / rect.height);
  }, { passive: false });
  on(stage, 'keydown', (event) => {
    if (event.key === '+' || event.key === '=') zoomBy(1.25);
    else if (event.key === '-') zoomBy(0.8);
    else if (event.key === 'Home') selectRegion(selected);
    else if (event.key === 'ArrowLeft') pan(32, 0);
    else if (event.key === 'ArrowRight') pan(-32, 0);
    else if (event.key === 'ArrowUp') pan(0, 32);
    else if (event.key === 'ArrowDown') pan(0, -32);
    else return;
    event.preventDefault(); event.stopPropagation();
  });
  on(stage, 'pointerdown', (event) => {
    if (!view || event.button !== 0 || drag || (!cleanView && event.pointerType === 'touch')) return;
    const rect = stage.getBoundingClientRect();
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, sx: width / rect.width, sy: height / rect.height, shift, scale: view.scale };
    stage.setPointerCapture(event.pointerId); stage.classList.add('is-panning');
  });
  on(stage, 'pointermove', (event) => {
    if (drag?.id !== event.pointerId) return;
    pan((event.clientX - drag.x) * drag.sx, (event.clientY - drag.y) * drag.sy, drag.shift, drag.scale);
  });
  on(tools, 'toggle', () => { if (!tools.open) for (const menu of toolMenus) menu.open = false; });
  on(stage, 'lostpointercapture', () => { drag = undefined; stage.classList.remove('is-panning'); });
  if (isDialog) {
    on(trigger, 'click', () => { if (!panel.open) panel.showModal(); draw(); });
    on(panel.querySelector('[data-map-close]'), 'click', () => panel.close());
    on(panel, 'click', (event) => { if (event.target === panel) panel.close(); });
  }

  const observer = new window.ResizeObserver(([entry]) => {
    const nextWidth = Math.floor(entry.contentRect.width), nextHeight = Math.floor(entry.contentRect.height);
    visible = nextWidth >= 185 && nextHeight >= 130;
    if (!visible || (width === nextWidth && height === nextHeight && !dirty)) return;
    width = nextWidth; height = nextHeight; invalidate();
  });
  observer.observe(stage);
  setNote();
  selectRegion(selected);
  draw.selectRegion = selectRegion;
  draw.setEngineeringLayout = (layout) => { engineering = prepareEngineering(layout); setNote(); invalidate(); };
  draw.destroy = () => { disposed = true; events.abort(); observer.disconnect(); if (raf != null) window.cancelAnimationFrame(raf); };
  return draw;
}

