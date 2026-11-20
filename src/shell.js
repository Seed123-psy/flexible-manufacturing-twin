import { DEFAULT_ORDER, PRESETS } from './simulation.js';
import { routeMapControls } from './factory-route-map.js';
import { SHIFT_CLOCK_RATE } from './lighting-shift.js';
import './equipment-panel.css';

const orderCount = new Intl.NumberFormat('zh-CN');

const paths = {
  mark: '<path d="M12 2.7 21 7.8v8.4l-9 5.1-9-5.1V7.8l9-5.1Z"/><path d="m3 7.8 9 5.2 9-5.2M12 13v8.3M7.5 5.3l9 5.2v4.1"/>',
  arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
  back: '<path d="M20 12H5m6-6-6 6 6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  pulse: '<path d="M2 12h5l3-7 4 14 3-7h5"/>',
  layer: '<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/>',
  cube: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Zm-8 4.5 8 4.5 8-4.5M12 12v9"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  storage: '<path d="M3 10 12 4l9 6v10H3V10Zm4 10v-7h10v7M10 16h4"/>',
  minus: '<path d="M5 12h14"/>',
  fit: '<path d="M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5"/>',
  focus: '<path d="M8 4H4v4m12-4h4v4m0 8v4h-4M4 16v4h4"/><circle cx="12" cy="12" r="3"/>',
  grid: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>',
  camera: '<path d="M18.8 9A7.5 7.5 0 0 0 6 6.7L3 9m0 0V4m0 5h5m-2.8 6A7.5 7.5 0 0 0 18 17.3l3-2.3m0 0v5m0-5h-5"/>',
  cursor: '<rect x="7" y="3" width="10" height="18" rx="5"/><path d="M12 6v4"/>',
  play: '<path d="M9 5.8v12.4L19 12 9 5.8Z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M9 6v12m6-12v12" stroke-width="2.8"/>',
  monitor: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4m-5-9 3 2 6-5"/>',
  printer: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 8h16m-8 0v4m-2 0h4m-6 4h8"/>',
  quality: '<path d="M7 6H5v15h14V6h-2m-8-2h6v4H9V4Z"/><path d="m8 13 3 3 5-5"/>',
  paper: '<path d="M5 3h9l5 5v13H5V3Zm9 0v6h5M8 13h8m-8 4h6"/>',
  robot: '<path d="M4 21h13m-9 0v-5l4-5m0 0-3-4 4-4 5 5m-6 3 5 4m1-7 3 3-2 3m-2 1 2 3"/><circle cx="12" cy="11" r="2"/>',
  sort: '<path d="M4 6h16M4 12h12M4 18h7m6-2 3 2-3 2m-3-2h6"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/>',
  scan: '<path d="M8 4H4v4m12-4h4v4m0 8v4h-4M4 16v4h4M8 9v6m3-6v6m2-6v6m3-6v6"/>',
  truck: '<path d="M3 6h12v11H3zm12 4h3l3 3v4h-6"/><circle cx="7" cy="17" r="2" fill="var(--panel)"/><circle cx="18" cy="17" r="2" fill="var(--panel)"/>',
  cartons: '<path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5v-9Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9M8 5.3l8 4.4"/>',
  alert: '<path d="m12 3 9 17H3L12 3Z"/><path d="M12 9v4m0 4h.01"/>',
  parallel: '<path d="M4 7h9l-3-3m3 3-3 3M20 17h-9l3-3m-3 3 3 3"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  battery: '<rect x="3" y="7" width="16" height="10" rx="2"/><path d="M21 10v4M6 10h6v4H6z"/>',
  map: '<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15m6-12v15"/>',
  patrol: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2M4 5l2 2m14-2-2 2"/>',
  recycle: '<path d="m8 6 2-3 2 3m-2-3v8m5 1 3 1-1 3m1-3-7 4m-5-5-3-1 1-3m-1 3 7-4"/><path d="m16 18-1 3-3-1M8 6l-3-1 1-3"/>',
};

function icon(name, size = 18) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
}

function metric(id, label, value, iconName, unit = '') {
  return `<div class="metric metric--${id}">
    <span class="metric-icon">${icon(iconName, 19)}</span>
    <div class="metric-content">
      <span class="metric-label">${label}</span>
      <div class="metric-reading"><strong id="${id}">${value}</strong>${unit ? `<span class="metric-unit">${unit}</span>` : ''}</div>
    </div>
  </div>`;
}

function flow(id, label, iconName, group = '') {
  return `<button class="flow-node" data-flow="${id}" type="button" aria-label="${group}${label}"><span class="flow-icon">${icon(iconName, 15)}</span><span>${label}</span></button>`;
}

function lightingControl() {
  return `<div class="shift-lighting" title="灯光时钟从 08:00 开始，按仿真时间的 ${SHIFT_CLOCK_RATE} 倍推进；自动模式 06:00 日班、18:00 夜班。">
    <span class="shift-lighting-state" data-lighting-state>日班 · 08:00</span>
    <select class="shift-lighting-mode" data-lighting-mode aria-label="厂区照明模式">
      <option value="auto" selected>自动</option><option value="day">日班</option><option value="night">夜班</option>
    </select>
  </div>`;
}

function presetButton(id, preset, label) {
  const quantity = orderCount.format(preset.quantity);
  return `<button class="button button--secondary" id="${id}" type="button" disabled aria-label="${quantity} 件${label}" title="${quantity} 件${label}"><span class="control-icon">${icon('layer', 16)}</span><span class="control-label">${quantity} 件</span></button>`;
}

function numberField(id, label, value, unit = 'mm') {
  return `<label class="field" for="order-${id}">
    <span>${label}</span>
    <span class="field-with-unit"><input id="order-${id}" name="${id}" type="number" step="1" value="${value}" required><span>${unit}</span></span>
  </label>`;
}

function readout(id, label, value) {
  return `<div class="console-readout"><div><span id="${id}-label">${label}</span><strong id="${id}-value">${value}</strong></div><progress id="${id}" aria-labelledby="${id}-label" max="100" value="0"></progress></div>`;
}

const tabs = [
  ['overview', '总览', 'grid'],
  ['production', '生产', 'printer'],
  ['operations', '调度', 'pulse'],
  ['equipment', '设备', 'focus'],
  ['routes', '工程图', 'map'],
  ['engineering', '测算', 'paper'],
];

function consoleTab([id, label, iconName], index) {
  const selected = index === 0;
  return `<button class="console-tab${selected ? ' is-active' : ''}" id="console-tab-${id}" type="button" role="tab" data-console-tab="${id}" aria-controls="console-page-${id}" aria-selected="${selected}" tabindex="${selected ? 0 : -1}">${icon(iconName, 17)}<span>${label}</span><small aria-hidden="true">0${index + 1}</small></button>`;
}

export const shell = `
  <div class="dashboard factory-shell">
    <main class="scene" id="viewport" aria-label="交互式 3D 制造车间">
      <div id="scene-stage" class="scene-stage"></div>

      <div class="control-screen-layer" id="control-screen-layer" hidden>
        <section class="control-screen" id="control-screen" aria-labelledby="console-title">
          <header class="console-header">
            <div class="console-brand">
              <span class="console-brand-mark">${icon('mark', 24)}</span>
              <div><p class="console-kicker">FLEX / FACTORY CONTROL</p><h2 id="console-title">柔性制造主控台</h2></div>
            </div>
            <div class="console-header-end">
              ${lightingControl()}
              <span class="console-mode"><i aria-hidden="true"></i>仿真模式</span>
              <span class="console-terminal" aria-label="终端 01">TERM<span> / </span>01</span>
            </div>
          </header>

          <div class="console-tabs" role="tablist" aria-label="主控台页面">
            ${tabs.map(consoleTab).join('')}
          </div>

          <div class="console-pages">
            <section class="console-page console-overview" id="console-page-overview" role="tabpanel" data-console-page="overview" aria-labelledby="console-tab-overview" tabindex="0">
              <section class="console-card kpi-board" aria-labelledby="kpi-title">
                <header class="console-section-head"><div><p class="console-kicker">ORDER TELEMETRY</p><h3 id="kpi-title">订单指标</h3></div>${icon('pulse', 21)}</header>
                <div class="metrics">
                  ${metric('stage', '订单阶段', '待下单', 'pulse')}
                  ${metric('quantity', '订单数量', '0', 'layer', '件')}
                  ${metric('good', '质检合格', '0', 'check', '件')}
                  ${metric('sorted', '已分拣', '0', 'sort', '件')}
                  ${metric('stored', '累计入库', '0', 'storage', '件')}
                  ${metric('shipped', '已装车发运', '0', 'truck', '件')}
                  ${metric('onHand', '实时在库', '0', 'storage', '件')}
                  ${metric('warehouse', '仓库占用', '0 / 0', 'storage')}
                  ${metric('dispatching', '出库月台', '1', 'parallel', '路')}
                  ${metric('cartons', '线边盒坯', '20', 'cartons', '个')}
                  ${metric('rejects', '累计不合格', '0', 'alert', '件')}
                  ${metric('ecoHold', '不合格已清运', '0', 'recycle', '件')}
                  ${metric('robotPower', '机器人电量', '100', 'battery', '%')}
                  ${metric('robotBackup', '备用机器人', '1', 'robot', '台')}
                  ${metric('patrol', '巡检状态', '待命', 'patrol')}
                </div>
                <div class="console-readouts" aria-label="订单、质检与在库比率">
                  ${readout('overview-progress', '订单进度', '0%')}
                  ${readout('overview-yield', '质检合格率', '—')}
                  ${readout('overview-utilization', '立库利用率', '0%')}
                </div>
              </section>
              <section class="console-card ops-board" aria-labelledby="zones-title">
                <header class="console-section-head ops-heading"><div><p class="console-kicker">LIVE OPERATIONS</p><h3 id="zones-title">区域状态总览</h3></div><span class="console-index">10 个区域</span></header>
                <div class="zone-grid">
                  <article class="zone-card zone-card--production"><span class="zone-index">A · B</span><div><h3>双线生产区</h3><p id="zone-production-meta">两条产线并行排产</p></div><strong id="zone-production-value">待机</strong></article>
                  <article class="zone-card zone-card--warehouse"><span class="zone-index">WH</span><div><h3>成品立库</h3><p id="zone-warehouse-meta">扩大库容 · 入库/出库同步</p></div><strong id="zone-warehouse-value">0 / 0</strong></article>
                  <article class="zone-card zone-card--cartons"><span class="zone-index">BX</span><div><h3>包装盒仓</h3><p id="zone-cartons-meta">机器人按需领用，库存受控</p></div><strong id="zone-cartons-value">0 个</strong></article>
                  <article class="zone-card zone-card--filament"><span class="zone-index">AMS</span><div><h3>打印耗材仓</h3><p id="zone-filament-meta">按需配送卷料，停机换卷</p></div><strong id="zone-filament-value">600 卷</strong></article>
                  <article class="zone-card zone-card--exception"><span class="zone-index">QA</span><div><h3>质检红色旁路</h3><p id="zone-exception-meta">经高架送往隔离周转架</p></div><strong id="zone-exception-value">0 件</strong></article>
                  <article class="zone-card zone-card--outbound"><span class="zone-index">OUT</span><div><h3>发运月台</h3><p id="zone-outbound-meta">入库完成即进入拣货队列</p></div><strong id="zone-outbound-value">待机</strong></article>
                  <article class="zone-card zone-card--charging"><span class="zone-index">PWR</span><div><h3>机器人充电站</h3><p id="zone-charging-meta">充电位与备用机器人随时接管</p></div><strong id="zone-charging-value">100%</strong></article>
                  <article class="zone-card zone-card--backup"><span class="zone-index">BOT</span><div><h3>备用机器人</h3><p id="zone-backup-meta">热备资源在线</p></div><strong id="zone-backup-value">1 台</strong></article>
                  <article class="zone-card zone-card--patrol"><span class="zone-index">巡检</span><div><h3>巡检机器人</h3><p id="zone-patrol-meta">外围路线持续覆盖</p></div><strong id="zone-patrol-value">待命</strong></article>
                  <article class="zone-card zone-card--eco"><span class="zone-index">ECO</span><div><h3>不合格品周转与清运</h3><p id="zone-eco-meta">在架 · 车上 0 件 · 已清运 0 件</p></div><strong id="zone-eco-value">0 / 8</strong></article>
                </div>
              </section>
              <div class="console-alert">${icon('pulse', 17)}<span class="console-alert-label">厂区动态</span><p id="flow-alert" class="flow-alert" role="status">等待订单启动，仓储与包装资源将实时联动</p></div>
            </section>

            <section class="console-page console-production" id="console-page-production" role="tabpanel" data-console-page="production" aria-labelledby="console-tab-production" tabindex="0" hidden>
              <section class="console-card flow" aria-labelledby="flow-title">
                <header class="console-section-head flow-heading"><div><p class="console-kicker">PROCESS CHAIN</p><h3 id="flow-title">订单八段链路</h3></div><span class="flow-heading-note">选择环节查看设备</span></header>
                <div class="flow-stations flow-stations--eight" id="flow-stations">
                  <div class="flow-segment" data-segment="design">
                    <span class="flow-segment-step">01</span>
                    ${flow('design', '设计建模', 'monitor')}
                    <span class="flow-segment-meta" id="flow-meta-design">待机</span>
                  </div>
                  <div class="flow-segment" data-segment="print">
                    <span class="flow-segment-step">02</span>
                    ${flow('print', '双线打印', 'printer')}
                    <span class="flow-segment-meta" id="flow-meta-print">0 / 0 件</span>
                  </div>
                  <div class="flow-segment" data-segment="qualityPack">
                    <span class="flow-segment-step">03</span>
                    ${flow('qualityPack', '质检装盒', 'quality')}
                    <span class="flow-segment-meta" id="flow-meta-qualityPack">0 / 0 件</span>
                  </div>
                  <div class="flow-segment" data-segment="boxSupply">
                    <span class="flow-segment-step">04</span>
                    ${flow('boxSupply', '包装盒补给', 'cartons')}
                    <span class="flow-segment-meta" id="flow-meta-boxSupply">0 个余量</span>
                  </div>
                  <div class="flow-segment" data-segment="sort">
                    <span class="flow-segment-step">05</span>
                    ${flow('sort', '扫码分拣', 'sort')}
                    <span class="flow-segment-meta" id="flow-meta-sort">0 / 0 件</span>
                  </div>
                  <div class="flow-segment" data-segment="storage">
                    <span class="flow-segment-step">06</span>
                    ${flow('storage', '智能立库', 'storage')}
                    <span class="flow-segment-meta" id="flow-meta-storage">0 / 0 件</span>
                  </div>
                  <div class="flow-segment" data-segment="exception">
                    <span class="flow-segment-step">07</span>
                    ${flow('exception', '不合格旁路', 'alert')}
                    <span class="flow-segment-meta" id="flow-meta-exception">0 件不合格</span>
                  </div>
                  <div class="flow-segment" data-segment="dispatch">
                    <span class="flow-segment-step">08</span>
                    ${flow('dispatch', '并行拣货发运', 'parallel')}
                    <span class="flow-segment-meta" id="flow-meta-dispatch">0 / 0 件</span>
                  </div>
                </div>
              </section>
              <nav class="console-card station-dock" aria-label="车间工位">
                <header class="console-section-head station-dock-title"><div><p class="console-kicker">STATION INDEX</p><h3>车间工位</h3></div><span class="station-key"><i class="station-dot" aria-hidden="true"></i>运行中</span></header>
                <div class="station-groups">
                  <div class="station-group"><h3>设计办公室 <small>DS</small></h3><div class="station-list" id="station-list-office"></div></div>
                  <div class="station-group"><h3>A 线 <small>LN A</small></h3><div class="station-list" id="station-list-line-a"></div></div>
                  <div class="station-group"><h3>B 线 <small>LN B</small></h3><div class="station-list" id="station-list-line-b"></div></div>
                  <div class="station-group"><h3>仓储发运区 <small>WH</small></h3><div class="station-list" id="station-list-logistics"></div></div>
                </div>
              </nav>
              <aside class="console-card device-card" aria-label="设备详情">
                <div class="device-header">
                  <span>设备详情</span>
                  <span class="device-code" id="device-code">DS-01</span>
                  <button class="button button--secondary device-focus" id="focus-station" type="button">${icon('focus', 17)}<span>在厂区定位</span>${icon('arrow', 15)}</button>
                </div>
                <div class="device-main">
                  <h3 id="device-name">设计工作站</h3>
                  <p id="device-role">调整玩偶尺寸并准备打印任务</p>
                </div>
                <div class="device-activity">
                  <div class="device-action"><span id="device-action">待机</span><strong id="device-percent">0%</strong></div>
                  <progress id="device-progress" aria-label="工位进度" max="100" value="0"></progress>
                </div>
                <div class="device-order"><span>当前订单</span><strong id="device-order">—</strong></div>
                <div id="device-extra" class="device-extra"></div>
                <div id="device-supply-actions" hidden>
                  <div class="device-extra">
                    <button class="button button--secondary" id="focus-supply" type="button" aria-pressed="false" disabled>查看换卷机</button>
                    <button class="button button--secondary" id="seek-supply" type="button" title="暂停并跳转到本机下一次换卷" disabled>定位换卷</button>
                    <button class="button button--secondary" id="seek-pickup" type="button" title="暂停并跳转到本机下一次货架取卷" disabled>定位取卷</button>
                  </div>
                </div>
                <div id="device-reject-actions" hidden>
                  <div class="device-extra">
                    <button class="button button--secondary" id="seek-reject-load" type="button" title="暂停并定位下一件不合格品装车" disabled>定位装车</button>
                    <button class="button button--secondary" id="seek-reject-trip" type="button" title="暂停并定位下一车满载或尾批发车" disabled>定位发车</button>
                  </div>
                </div>
              </aside>
            </section>

            <section class="console-page console-operations" id="console-page-operations" role="tabpanel" data-console-page="operations" aria-labelledby="console-tab-operations" tabindex="0" hidden>
              <section class="console-card playback" aria-labelledby="playback-title">
                <header class="console-section-head"><div><p class="console-kicker">SIMULATION CONTROL</p><h3 id="playback-title">仿真调度</h3></div>${icon('play', 22)}</header>
                <div class="playback-actions">
                  <div class="preset-block">
                    <div class="playback-caption"><h4>启动生产</h4><span>选择预设或提交定制订单</span></div>
                    <div class="order-presets" role="group" aria-label="启动预设订单">
                      <button class="button button--primary" id="run-single" type="button" disabled><span class="control-icon">${icon('play', 18)}</span><span class="control-label">单件定制</span></button>
                      ${presetButton('run-batch', PRESETS.batch, '批量生产')}
                      ${presetButton('run-scale', PRESETS.scale, '规模生产')}
                    </div>
                    <button class="button button--order" id="custom-order" type="button" disabled>${icon('plus', 17)}<span>定制下单</span></button>
                  </div>
                </div>
                <div class="timeline">
                  <div class="console-kicker">PLAYBACK TIMELINE</div>
                  <div class="timeline-label"><span>订单进度</span><span class="timeline-time" id="timeline-time">00:00 / 00:00</span><strong id="timeline-label">0%</strong></div>
                  <input id="timeline-progress" class="timeline-slider" type="range" aria-label="拖动定位订单进度" min="0" max="1" value="0" step="1" disabled>
                  <div class="playback-transport">
                    <p>拖动时间轴定位生产进度</p>
                    <div class="playback-divider"></div>
                    <div class="transport-actions" role="group" aria-label="播放控制">
                      <button class="button button--quiet" id="pause" type="button" disabled aria-label="暂停"><span class="control-icon">${icon('pause', 16)}</span><span class="control-label">暂停</span></button>
                      <button class="button button--quiet speed-button" id="speed" type="button" aria-label="当前倍速 1 倍，点击切换" title="切换仿真倍速"><span class="control-label">1×</span></button>
                    </div>
                  </div>
                </div>
              </section>
              <section class="console-card event-panel" aria-labelledby="event-title">
                <header class="console-section-head"><div><p class="console-kicker">EVENT LOG</p><h3 id="event-title">最近动态</h3></div><span class="console-index">最新在前</span></header>
                <ul id="event-log"><li>等待提交订单</li></ul>
              </section>
            </section>

            <section class="console-page console-equipment" id="console-page-equipment" role="tabpanel" data-console-page="equipment" aria-labelledby="console-tab-equipment" tabindex="0" hidden>
              <div id="equipment-panel" class="equipment-panel"><p class="equipment-empty">正在等待设备数据。</p></div>
            </section>

            <section class="console-page console-routes" id="console-page-routes" role="tabpanel" data-console-page="routes" aria-labelledby="console-tab-routes" tabindex="0" hidden>
              <section class="route-map-panel" id="route-map-panel" aria-label="动态厂区工程图">
                <div class="route-map-body">
                  <canvas class="route-map-canvas" role="img" aria-label="按厂区坐标绘制的动态工程图，包含设备、流线、建筑与安全分区图层"></canvas>
                  <div class="drawing-overlay" role="group" aria-label="工程图操作">
                    <button class="button drawing-icon" type="button" id="drawing-back" title="返回主控台（Esc）" aria-label="返回主控台">${icon('back', 18)}</button>
                    <button class="button drawing-icon" type="button" data-map-zoom="out" title="缩小图纸" aria-label="缩小图纸">${icon('minus', 18)}</button>
                    <button class="button drawing-icon" type="button" data-map-zoom="in" title="放大图纸" aria-label="放大图纸">${icon('plus', 18)}</button>
                    <button class="button drawing-icon" type="button" data-map-zoom="reset" title="恢复当前分区全图（Home）" aria-label="恢复当前分区全图">${icon('fit', 18)}</button>
                    <details class="drawing-tools">
                      <summary class="button drawing-icon" title="工程图工具" aria-label="工程图工具">${icon('layer', 18)}</summary>
                      <div class="drawing-tool-panel">
                        ${routeMapControls}
                        <details class="drawing-camera-tools">
                          <summary>仿真与 3D 视角</summary>
                          <div class="drawing-monitor">
                            <span>仿真时间</span><strong id="drawing-clock">00:00</strong>
                            <button class="button scene-view" id="drawing-pause" type="button" disabled>${icon('pause', 15)}<span>暂停</span></button>
                          </div>
                          <div class="scene-heading">${icon('focus', 16)}<h4 id="camera-view">厂区总览</h4></div>
                          <nav class="scene-views" aria-label="厂区视角切换">
                            <button class="button scene-view is-active" id="reset-view" type="button" aria-pressed="true" title="返回全景" data-view="overview">${icon('camera', 15)}<span>全景</span></button>
                            <button class="button scene-view" type="button" aria-pressed="false" data-view="design" aria-label="设计办公室">${icon('monitor', 15)}<span>设计办公室</span></button>
                            <button class="button scene-view" type="button" aria-pressed="false" data-view="production" aria-label="生产区总览">${icon('printer', 15)}<span>生产区</span></button>
                            <button class="button scene-view" type="button" aria-pressed="false" data-view="lineA" aria-label="A 线视角">${icon('layer', 15)}<span>A 线</span></button>
                            <button class="button scene-view" type="button" aria-pressed="false" data-view="lineB" aria-label="B 线视角">${icon('layer', 15)}<span>B 线</span></button>
                            <button class="button scene-view" type="button" aria-pressed="false" data-view="logistics" aria-label="仓储发运区">${icon('storage', 15)}<span>仓储发运</span></button>
                          </nav>
                          <button class="button scene-view engineering-markings" id="engineering-markings" type="button" aria-pressed="true" title="切换 3D 工程地面标识">${icon('layer', 15)}<span>3D 工程标识</span></button>
                          <button class="button scene-view drawing-analysis-link" type="button" data-console-link="engineering">${icon('paper', 15)}<span>物料与节拍测算</span></button>
                        </details>
                        <p class="route-map-note">仅用于仿真展示；消防、净空、荷载与沉降等工程数据须现场复核。</p>
                      </div>
                    </details>
                  </div>
                </div>
              </section>
            </section>
            <section class="console-page console-engineering" id="console-page-engineering" role="tabpanel" data-console-page="engineering" aria-labelledby="console-tab-engineering" tabindex="0" hidden>
              <div class="engineering-workspace">
                <div class="engineering-example" id="engineering-example"><span><b>示例排程</b> · 240 件预设尚未启动；运行订单后切换为该订单的测算。</span><button class="button" type="button" data-console-link="operations">前往调度</button></div>
                <div id="engineering-analysis"></div>
              </div>
            </section>
          </div>

          <footer class="console-footer"><span><i aria-hidden="true"></i>柔性定制制造车间</span><span class="console-footer-channel" aria-hidden="true">DESIGN <b>/</b> MAKE <b>/</b> SHIP</span><span>数字孪生 <b>/</b> F01</span></footer>
        </section>
      </div>

      <div class="factory-hud" id="factory-hud">
        <header class="app-header factory-header">
          <div class="brand factory-brand">
            <div class="brand-mark">${icon('mark', 26)}</div>
            <div><p class="brand-subtitle">F01 <span></span> 3D 数字孪生</p><h1>柔性定制制造车间</h1></div>
          </div>
          <div class="header-actions factory-actions">
            <div class="scene-status"><span aria-hidden="true"></span><span id="status-text" role="status">正在加载玩偶模型</span></div>
            ${lightingControl()}
            <button class="button factory-enter" id="enter-control-room" type="button" aria-expanded="false" aria-controls="control-screen-layer">${icon('monitor', 17)}<span>进入监控室</span>${icon('arrow', 17)}</button>
          </div>
        </header>
        <div class="scene-guide">
          <a class="camera-guide design-platform-link" id="design-platform-link" href="https://www.wwsstory.com/" target="_blank" rel="noopener noreferrer" aria-label="在新标签页打开设计平台" hidden>
            <span>点电脑屏幕进入设计平台</span><span aria-hidden="true">↗</span>
          </a>
          <span class="camera-guide">
            ${icon('cursor', 15)}
            <span class="camera-guide-mouse">拖动旋转 · 滚轮缩放</span>
            <span class="camera-guide-touch">单指旋转 · 双指缩放</span>
          </span>
        </div>
      </div>
      <button class="button factory-leave" id="leave-control-room" type="button">${icon('back', 17)}<span>返回厂区</span></button>
    </main>
  </div>

  <dialog id="order-dialog" aria-labelledby="order-dialog-title">
    <form id="order-form">
      <header class="order-header">
        <div><h2 id="order-dialog-title">定制椰子榴莲玩偶</h2><p>玩偶按原比例缩放至尺寸上限内</p></div>
        <button class="button close-order" id="order-cancel" aria-label="关闭定制订单" type="button">${icon('close', 21)}</button>
      </header>
      <div class="order-layout">
        <div class="order-visual">
          <div class="order-preview" id="order-preview" aria-label="玩偶 3D 预览">
            <div class="preview-tag">${icon('cube', 14)}3D 预览</div>
            <div class="preview-hint">${icon('cursor', 14)}拖动查看模型</div>
          </div>
          <div class="order-estimate" id="order-estimate" aria-live="polite"></div>
        </div>
        <div class="order-fields">
          <label class="field" for="order-text"><span>包装标签</span><input id="order-text" name="text" type="text" value="${DEFAULT_ORDER.text}" autofocus required></label>
          <label class="field" for="order-color"><span>打印颜色</span><select id="order-color" name="color" required></select></label>
          <div class="order-dimensions">
            ${numberField('width', '宽度上限', DEFAULT_ORDER.width)}${numberField('depth', '深度上限', DEFAULT_ORDER.depth)}${numberField('height', '高度上限', DEFAULT_ORDER.height)}
          </div>
          ${numberField('quantity', '订单数量', DEFAULT_ORDER.quantity, '件')}
          <p id="order-error" class="order-error" role="alert" hidden></p>
          <button class="button button--primary order-submit" id="order-submit" type="submit"><span class="control-icon">${icon('play', 18)}</span><span class="control-label">确认订单并启动</span></button>
        </div>
      </div>
    </form>
  </dialog>`;
