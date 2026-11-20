import { buildEngineeringAnalysis, calculateEngineeringTakt } from './engineering-analysis.js';

const painted = new WeakMap();
const formats = new Map();
function number(value, digits = 0) {
  if (!Number.isFinite(value)) return '—';
  if (!formats.has(digits)) formats.set(digits, new Intl.NumberFormat('zh-CN', { maximumFractionDigits: digits }));
  return formats.get(digits).format(value);
}
const dimensions = ({ width, depth, height }, digits = 0) => [width, depth, height].map(n => number(n, digits)).join(' × ');
const escapeHtml = (text) => String(text ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const tag = (type, label) => `<span class="ea-tag ea-tag--${type}">${label}</span>`;
const entry = (label, value) => `<div><dt>${label}</dt><dd>${value}</dd></div>`;
const heading = (index, label, type) => `<header class="ea-card-head"><h4><span>${index}</span>${label}</h4>${type}</header>`;
const grams = value => `${number(value, 1)} g`;
const seconds = (value, precision = 2) => value == null ? '—' : `${number(value, precision)} s`;

function materialCard(m) {
  return `<section class="ea-card" aria-label="物料规格">
    ${heading('01', '物料规格', tag('assumption', '估算 / 设计值'))}
    <div class="ea-hero"><div><small>件型配置码 · 非采购 SKU</small><strong>${escapeHtml(m.configurationRef)}</strong></div>
    <div><small>单件耗材估计</small><strong>${grams(m.unitFilamentGrams)}</strong></div></div>
    <dl class="ea-data">
      ${entry('产品包络 · 对比输入框', `<strong>${dimensions(m.productMm, 1)} mm</strong><small>输入 ${dimensions(m.requestedMm)} mm · ${escapeHtml(m.finish)}（外观预览）</small>`)}
      ${entry('纸盒名义外形 · 1 件/盒', `<strong>${dimensions(m.cartonMm)} mm</strong><small>外形与产品之差 ${dimensions(m.nominalCartonMinusPartMm, 1)} mm，不是内净空</small>`)}
      ${entry('RGB 模拟投料 · 非外观配色', `<strong>${grams(m.orderFilamentGrams)} / 单</strong><small>${m.colors.map(c => `${c.code} ${grams(c.gramsPerUnit)}`).join(' · ')} / 件（含不良件）</small>`)}
    </dl>
    <details class="ea-details"><summary>供料、盒坯及估算口径</summary>
      <p>耗材 = 产品包络体积 × ${number(m.estimate.fillFactor * 100)}% × ${number(m.estimate.densityGramsPerCm3, 2)} g/cm³；未经过切片称重。换卷回收余料 ${grams(m.recoveredFilamentGrams)}不计入打印耗用。</p>
      <p>每色 ${number(m.colors[0].warehouseSpools)} 卷初始仓存 · ${grams(m.spoolGrams)}/卷 · 排程换卷 ${number(m.spoolExchanges)} 次。预览色不改变三色料道。</p>
      <p>线边 ${number(m.lineSideBlankCapacity)} 个盒坯/线 · 仓库初始 ${number(m.initialBlankWarehouseStock)} 个 · 排程补料 ${number(m.cartonRefills)} 次 · 成型 ${number(m.cartonsFormed)} 盒。</p>
      <p>${tag('unknown', '未建模')} 采购 SKU、丝材料号/直径、纸板等级/厚度及空盒质量。</p>
    </details>
  </section>`;
}

function envelopeCard(e) {
  const { warehouse: w, shipment: s, reject: r } = e;
  return `<section class="ea-card" aria-label="载荷与包络">
    ${heading('02', '载荷与包络', tag('model', '仿真配置'))}
    <dl class="ea-tiles">
      ${entry('立库 · 1 盒/位', `<strong>${number(w.slots)} <small>位</small></strong><small>${w.columns} 列 × ${w.levels} 层 · 本单峰值 ${number(w.peakOnHand)} 盒</small>`)}
      ${entry('成品发运 · 单月台', `<strong>${number(s.cartonsPerWave)} <small>盒/车</small></strong><small>${number(s.waves)} 波 · 峰值 ${number(s.peakCartonsPerWave)} 盒/波</small>`)}
      ${entry('不良品独立周转', `<strong>${number(r.slots)} <small>位</small> / ${number(r.truckSlots)} <small>件/车</small></strong><small>在架峰值 ${number(r.peakOnRack)} 件 · ${number(r.trips)} 趟</small>`)}
      ${entry('成品 AGV · 单箱转运', `<strong>${number(s.cartonsPerAgvTrip)} <small>盒/趟</small></strong><small>单箱内件约 ${grams(s.unitNetGrams)} · 不含包装</small>`)}
    </dl>
    <details class="ea-details"><summary>场景几何与承载限制</summary>
      <p>纸盒闭合本体 ${dimensions(e.cartonBodyScene, 3)}；打印托盘 ${dimensions(e.palletScene, 3)}（宽 × 深 × 高，场景单位）。</p>
      <p>立库列距/层距 ${number(w.columnPitchScene, 3)} / ${number(w.levelPitchScene, 3)}；车载相邻箱位中心距 ${number(s.slotPitchXScene, 3)} / ${number(s.slotPitchZScene, 3)}（场景单位，非可用净空）。</p>
      <p>最大实际波次仅计内件约 ${grams(s.peakWaveNetGrams)}。${tag('unknown', '未校核')} 毛重、重心、允许承载、层间/抓取净空。位数和场景尺寸不等于物理额载或验收结果。</p>
    </details>
  </section>`;
}

function resourceDetails(stage) {
  return stage.resources.filter(r => r.busySeconds || r.blockedSeconds).map(r => `<li>
    <strong>${escapeHtml(r.label)} <code>${escapeHtml(r.code)}</code></strong>
    <span>${r.visits ? `${number(r.visits)} 件 · ` : ''}忙 ${seconds(r.busySeconds, 1)}${r.blockedSeconds > 0.005 ? ` · 阻塞 ${seconds(r.blockedSeconds, 1)}` : ''}</span>
    ${r.visits ? `<small>首件 ${seconds(r.firstArticleSeconds)} · 批量均值 ${seconds(r.batchSecondsPerVisit)}/件 · ${number(r.ratePerHour, 1)} 件/仿真时（仅忙时）</small>` : ''}
    <small>${r.phases.map(p => `${escapeHtml(p.action)} ${seconds(p.seconds, 1)}${p.kind === 'blocked' ? '（阻塞）' : ''}`).join('；')}</small>
  </li>`).join('');
}

function balanceCard(balance) {
  const { wholeOrder, packingCadence, setup, stages, zones, rejected, shipped, constraint, stationConstraint } = balance;
  const rows = [...stages, ...zones.filter(zone => zone.activeResources)];
  const peak = rows.find(row => row.id === constraint);
  const stationPeak = stages.find(row => row.id === stationConstraint);
  const ratio = row => peak?.secondsPerGood ? Math.min(100, row.secondsPerGood / peak.secondsPerGood * 100) : 0;
  const chartRow = row => {
    const critical = row.id === constraint;
    return `<li class="ea-chart-row${critical ? ' ea-chart-row--critical' : ''}">
      <span>${escapeHtml(row.label)}${critical ? '<b>约束</b>' : ''}</span>
      <small>${row.activeResources}/${row.configuredResources}</small>
      <span class="ea-track" aria-hidden="true"><i style="width:${ratio(row).toFixed(2)}%"></i></span>
      <strong>${number(row.secondsPerGood, 2)}</strong>
    </li>`;
  };
  const detailRows = stages.map(stage => `<li><details class="ea-details"><summary>${escapeHtml(stage.label)}${stage.controllingResource ? ` · ${number(stage.ratePerHour, 1)} 发运合格件/仿真时（忙时上界）` : ' · 未启用'}</summary>
    ${stage.activeResources > 1 ? `<p>启用工位忙时速率之和：${number(stage.parallelRatePerHour, 1)} 本工序件/仿真时（完全并行、忽略分配不均、等待与互锁）。</p>` : ''}
    <ul class="ea-resources">${resourceDetails(stage)}</ul></details></li>`).join('');
  return `<section class="ea-card ea-balance" aria-label="节拍与负载平衡">
    ${heading('03', '节拍与负载平衡', tag('model', '全单排程'))}
    <div class="ea-kpis">
      <div><small>整单发运速率</small><strong>${number(wholeOrder.ratePerHour, 1)}</strong><small>合格件 / 仿真时</small></div>
      <div><small>装盒实测间隔</small><strong>${number(packingCadence.secondsPerUnit, 2)}</strong><small>${packingCadence.secondsPerUnit != null ? '仿真秒 / 合格件' : '少于两次装盒完成'}</small></div>
      <div><small>需求目标 TAKT</small><strong class="ea-unknown" data-ea-takt>—</strong><small data-ea-takt-unit>缺净班时与每班需求</small></div>
    </div>
    <p class="ea-caption">发运 ${number(shipped)} 件 · 不良 ${number(rejected)} 件。整单速率以接单至末车发运 ${seconds(wholeOrder.elapsedSeconds, 1)} 为分母；装盒间隔取首末完成之差 ÷（完成数 − 1）。</p>
    <details class="ea-details ea-takt">
      <summary>设定目标节拍（可选）</summary>
      <fieldset class="ea-takt-fields">
        <legend class="ea-sr-only">目标节拍输入</legend>
        <label>每班净可用分钟<input data-ea-minutes type="number" inputmode="decimal" min="0" step="any" autocomplete="off"></label>
        <label>每班需求（合格件）<input data-ea-demand type="number" inputmode="numeric" min="1" step="1" autocomplete="off"></label>
      </fieldset>
      <p class="ea-takt-result" data-ea-takt-result role="status" aria-live="polite"></p>
      <p>净可用时间 ÷ 需求。差值仅比较数值：仿真时钟未按真实班次校准，不能用于班产承诺。</p>
    </details>
    <figure class="ea-chart">
      <figcaption><strong>${peak ? `模拟约束 · ${escapeHtml(peak.label)}` : '仿真负载'}</strong><span>启用/配置　·　仿真秒 / 发运合格件</span></figcaption>
      <ol>${rows.map(chartRow).join('')}</ol>
    </figure>
    <p class="ea-caption">${peak?.kind === 'zone' ? `通道累计占用 ${number(peak.utilization * 100, 1)}%（至末车）；仅看设备工序，${escapeHtml(stationPeak?.label)}负载最高。` : shipped + rejected === 1 ? '单件按首件排程计算，不代表批量稳态瓶颈。' : '约束是按占用量比较，并不等同于已验证的因果瓶颈。'} 同组并行工位取最忙一台，路径按占用并集；等待不计工作量，实际串联、补给和交通仍会拉长间隔。</p>
    <details class="ea-details ea-stage-details"><summary>展开工位、并行速率与作业阶段</summary>
      <p>首件与批量分别统计；设备累计忙时含发车/换车，不含等待与补给停机。通道计已排程占用（含充电往返、交班及补给），按末车发运截断。均非班产承诺。</p>
      <p>订单设计与任务下发共 ${seconds(setup.busySeconds)}，属于一次性准备，不计入逐件平衡图。播放全程 ${seconds(wholeOrder.playbackSeconds, 1)} 可含末车之后的巡检/清运等活动。</p>
      <ul class="ea-stage-list">${detailRows}${zones.filter(z => z.activeResources).map(z => `<li><details class="ea-details"><summary>${escapeHtml(z.label)} · ${number(z.utilization * 100, 1)}% 排程占用</summary><ul class="ea-resources">${resourceDetails(z)}</ul></details></li>`).join('')}</ul>
    </details>
  </section>`;
}

function connectTarget(host, report, remembered = {}) {
  const minutes = host.querySelector('[data-ea-minutes]');
  const demand = host.querySelector('[data-ea-demand]');
  const output = host.querySelector('[data-ea-takt-result]');
  const takt = host.querySelector('[data-ea-takt]');
  const unit = host.querySelector('[data-ea-takt-unit]');
  const disclosure = minutes.closest('details');
  minutes.value = remembered.minutes?.value ?? '';
  demand.value = remembered.demand?.value ?? '';
  disclosure.open = remembered.disclosure?.open ?? false;
  const update = () => {
    const target = calculateEngineeringTakt(minutes.valueAsNumber, demand.valueAsNumber, report.balance.wholeOrder.ratePerHour);
    takt.textContent = target ? number(target.taktSeconds, 2) : '—';
    unit.textContent = target ? '班次秒 / 合格件' : '缺有效净班时与需求';
    if (!target) {
      output.textContent = minutes.validity.badInput || demand.validity.badInput ||
        (minutes.value && !(minutes.valueAsNumber > 0)) || (demand.value && !(Number.isSafeInteger(demand.valueAsNumber) && demand.valueAsNumber > 0))
        ? '净可用分钟须大于零；需求须为正整数。' : '填写两项后计算目标。';
    } else {
      const { modeledSecondsPerGood, gapSeconds } = target;
      const comparison = gapSeconds == null ? '暂无可比较的整单发运间隔。' :
        `模拟整单 ${seconds(modeledSecondsPerGood)}/件，${Math.abs(gapSeconds) < 0.005 ? '数值上接近目标' :
          `数值上比目标${gapSeconds > 0 ? '慢' : '快'} ${seconds(Math.abs(gapSeconds))}/件`}。`;
      output.textContent = `目标 ${seconds(target.taktSeconds)}/件 · 所需 ${number(target.ratePerHour, 1)} 件/班次小时。${comparison}`;
    }
  };
  minutes.addEventListener('input', update);
  demand.addEventListener('input', update);
  update();
  return { minutes, demand, disclosure };
}

/** Paint once per active order/schedule. Seek and playback never reset the disclosure state. */
export function paintEngineeringAnalysis(host, sim) {
  if (!host) return null;
  const timeline = sim?.timeline ?? null;
  const order = sim?.order ?? null;
  const previous = painted.get(host);
  if (previous && previous.timeline === timeline && previous.order === order) return previous.report;
  const report = buildEngineeringAnalysis(sim);
  host.innerHTML = report ? `<div class="ea-panel">
    <header class="ea-head"><div><span class="ea-eyebrow">CR–01 / ENGINEERING ANALYSIS</span><h3>工艺规格与产线平衡</h3></div>
    <span class="ea-order">${escapeHtml(report.order.id)}<span aria-hidden="true"> / </span>${escapeHtml(report.order.text)}<span aria-hidden="true"> / </span>${number(report.order.quantity)} 件</span></header>
    <div class="ea-grid"><div class="ea-spec">${materialCard(report.materials)}${envelopeCard(report.envelope)}</div>${balanceCard(report.balance)}</div>
  </div>` : '<p class="ea-empty">暂无有效订单排程。提交订单后生成工艺分析。</p>';
  const target = report ? connectTarget(host, report, previous?.target) : previous?.target;
  painted.set(host, { timeline, order, report, target });
  return report;
}
