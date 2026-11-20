const stateLabels = {
  active: '运行中', charging: '充电中', idle: '待机', waiting: '等待',
  standby: '备用', open: '开启', closed: '关闭', docked: '已停靠', offsite: '在场外',
  maintenance: '检修中', fault: '故障', offline: '离线', unknown: '未记录',
};
const stateGroups = {
  working: 'active', running: 'active', moving: 'active', printing: 'active', delivering: 'active',
  busy: 'active', loading: 'active', operating: 'active', returning: 'active', departing: 'active',
  'handoff-in': 'active', 'handoff-out': 'active', exiting: 'active',
  queued: 'waiting', blocked: 'waiting', parked: 'idle', ready: 'idle', stopped: 'idle',
};
const typeLabels = {
  printer: '3D 打印机', robot: '机器人', agv: '无人小车', vehicle: '运输车辆', truck: '货车',
  conveyor: '传送设备', production: '生产设备', warehouse: '仓储设备', logistics: '物流设备',
  hvac: '暖通设备', scanner: '扫码设备', sorter: '分拣设备', charger: '充电设备', gate: '自动门', door: '自动门',
  lift: '升降设备', workstation: '工作站', equipment: '固定设备',
  'spool-changer': '换卷机', 'inspection-cell': '质检单元', 'carton-former': '纸箱成型机',
  'fixed-robot': '固定机械臂', 'mobile-robot': '移动机器人', 'material-cart': '物料小车',
  sealer: '封盒机', labeler: '贴标机', outfeed: '出料设备', 'powered-door': '自动门',
  'accumulation-conveyor': '积放滚筒', 'exception-bypass': '异常旁路', 'staging-conveyor': '暂存滚筒',
  'loading-conveyor': '装车滚筒', stacker: '堆垛机', gantry: '龙门装载机',
};
const colors = [['r', '红', 'red'], ['g', '绿', 'green'], ['b', '蓝', 'blue']];
const grams = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 });
const normalize = (value) => String(value ?? '').normalize('NFKC').trim().toLowerCase();
const timeOf = (snapshot) => snapshot?.time ?? snapshot?.elapsed ?? snapshot?.elapsedSeconds;

function replayTime(seconds) {
  if (!Number.isFinite(seconds)) return '—';
  const whole = Math.max(0, Math.floor(seconds));
  return [Math.floor(whole / 3600), Math.floor(whole / 60) % 60, whole % 60]
    .map((part) => String(part).padStart(2, '0')).join(':');
}

function text(node, value) {
  const next = String(value ?? '');
  if (node.textContent !== next) node.textContent = next;
}

function attribute(node, key, value) {
  const next = String(value);
  if (node.getAttribute(key) !== next) node.setAttribute(key, next);
}

function meter(node, value) {
  const visible = Number.isFinite(value);
  node.hidden = !visible;
  if (!visible) return;
  const bounded = Math.min(100, Math.max(0, value));
  if (node.value !== bounded) node.value = bounded;
}

function stateOf(asset) {
  if (asset.power?.charging === true) return 'charging';
  const key = normalize(asset.state);
  return (stateGroups[key] ?? key) || 'unknown';
}

function stateLabel(asset, state = stateOf(asset)) {
  return asset.stateLabel || stateLabels[state] || stateLabels.unknown;
}

function paintStatus(node, asset) {
  const state = stateOf(asset);
  attribute(node, 'data-state', state);
  text(node, stateLabel(asset, state));
}

function labelForType(asset) {
  return asset.typeLabel || typeLabels[asset.type] || asset.type || '未分类';
}

function powerReading(power = {}) {
  if (power.kind === 'battery') {
    const percent = Number.isFinite(power.batteryPercent)
      ? Math.round(Math.min(100, Math.max(0, power.batteryPercent))) : null;
    return { label: percent === null ? '电量未记录' : `${percent}%`, note: power.charging ? '电池 · 正在补电' : '电池供电', percent };
  }
  if (power.kind === 'mains') {
    const confirmed = power.on ?? power.powered;
    return { label: confirmed === false ? '市电断开' : '市电供电', note: confirmed === true ? '已通电' : '' };
  }
  return { label: '供能未记录', note: '' };
}

function activityLabel(asset) {
  return typeof asset.activity === 'string' ? asset.activity : asset.activity?.label;
}

function taskLabel(task, showProgress = false) {
  if (!task) return '';
  const item = Number.isInteger(task.unit) ? `工件 #${task.unit}` : '';
  const destination = task.destinationId ? `目的地 ${task.destinationId}` : '';
  const progress = showProgress && Number.isFinite(task.progress) ? `当前步骤 ${Math.round(task.progress * 100)}%` : '';
  return [item, destination, progress].filter(Boolean).join(' · ');
}

function spoolFor(printer, key, colorName) {
  return printer.colors?.find((spool) => [key, colorName].includes(normalize(spool.id ?? spool.code)));
}

function panelMarkup() {
  return `
    <header class="equipment-overview">
      <div class="equipment-overview-title"><h3>设备监控</h3></div>
      <label class="equipment-field equipment-archive"><span>本机订单回放</span>
        <select id="equipment-replays"><option value="">当前订单</option></select>
      </label>
      <div class="equipment-stat"><span>登记</span><strong data-eq="total">—</strong></div>
      <div class="equipment-stat equipment-stat--active"><span>运行</span><strong data-eq="active">—</strong></div>
      <div class="equipment-stat equipment-stat--charge"><span>充电</span><strong data-eq="charging">—</strong></div>
      <div class="equipment-clock"><span>回放时间</span><strong data-eq="clock">—</strong></div>
    </header>
    <div class="equipment-body">
      <section class="equipment-directory" aria-label="设备目录">
        <div class="equipment-toolbar" role="search" aria-label="筛选设备">
          <label class="equipment-field equipment-search"><span>搜索设备</span><input data-eq="search" type="search" placeholder="编号、名称或区域" autocomplete="off" spellcheck="false"></label>
          <label class="equipment-field"><span>设备类型</span><select data-eq="type"></select></label>
          <label class="equipment-field"><span>工作状态</span><select data-eq="state"></select></label>
        </div>
        <div class="equipment-list-head"><span>设备名称 / 编号</span><span data-eq="count">—</span></div>
        <div class="equipment-list-scroll">
          <p class="equipment-empty" data-eq="list-empty">正在等待设备数据。</p>
          <ul class="equipment-list" data-eq="list" aria-label="设备列表"></ul>
        </div>
        <p class="equipment-visually-hidden" data-eq="announcement" role="status"></p>
      </section>
      <section class="equipment-detail" aria-label="单台设备详情" data-eq="detail" tabindex="0">
        <p class="equipment-empty" data-eq="detail-empty">选择设备以查看详情。</p>
        <div class="equipment-detail-content" data-eq="detail-content" hidden>
          <header class="equipment-detail-header">
            <div><p class="equipment-detail-id"><span data-eq="id"></span><span data-eq="category"></span></p><h3 class="equipment-name" data-eq="name"></h3></div>
            <span class="equipment-status" data-eq="detail-state"></span>
          </header>
          <dl class="equipment-readings">
            <div><dt>当前工作</dt><dd><span data-eq="activity"></span><span class="equipment-reading-sub" data-eq="task"></span></dd></div>
            <div><dt>供能与电量</dt><dd><span data-eq="power"></span><progress data-eq="battery" max="100" aria-label="电池百分比" hidden></progress><span class="equipment-reading-sub" data-eq="power-note"></span></dd></div>
          </dl>
          <section class="equipment-material" aria-label="打印机 RGB 卷料" data-eq="material" hidden>
            <header class="equipment-section-heading"><h4>RGB 卷料余量</h4><span data-eq="supply"></span></header>
            <div class="equipment-spools">${colors.map(([key, label]) => `
              <div class="equipment-spool equipment-spool--${key}">
                <span class="equipment-spool-label">${label}色 · ${key.toUpperCase()}</span>
                <strong data-eq="spool-${key}"></strong><progress data-eq="meter-${key}" max="100" aria-label="${label}色卷料余量比例" hidden></progress>
              </div>`).join('')}
            </div>
          </section>
          <section class="equipment-records" aria-label="近期回放记录">
            <header class="equipment-section-heading"><h4>近期记录</h4><span>回放采样</span></header>
            <p class="equipment-empty" data-eq="history-empty">暂无记录。</p>
            <ol class="equipment-history" data-eq="history"></ol>
          </section>
        </div>
      </section>
    </div>`;
}

function setOptions(select, placeholder, choices) {
  const key = JSON.stringify(choices);
  if (select.dataset.options === key) return;
  const previous = select.value;
  select.replaceChildren(...[[ '', placeholder ], ...choices].map(([id, label]) => {
    const option = select.ownerDocument.createElement('option');
    option.value = id;
    option.textContent = label;
    return option;
  }));
  if (choices.some(([id]) => id === previous)) select.value = previous;
  select.dataset.options = key;
}

function createRow(document, id) {
  const item = document.createElement('li');
  item.innerHTML = `<button class="equipment-unit" type="button" aria-pressed="false"><span><strong></strong><small></small></span><span class="equipment-status"></span></button>`;
  const button = item.firstElementChild;
  button.dataset.equipmentId = id;
  return { item, button, name: item.querySelector('strong'), meta: item.querySelector('small'), status: item.querySelector('.equipment-status') };
}

function paintAssetDetail(nodes, asset) {
  text(nodes.id, asset.id);
  text(nodes.category, [labelForType(asset), asset.area].filter(Boolean).join(' / '));
  text(nodes.name, asset.name || asset.id);
  paintStatus(nodes['detail-state'], asset);
  text(nodes.activity, activityLabel(asset) || stateLabel(asset));
  const task = taskLabel(asset.task, true);
  nodes.task.hidden = !task;
  text(nodes.task, task);
  const power = powerReading(asset.power);
  text(nodes.power, power.label);
  const charger = asset.power?.charging && asset.details?.chargerId;
  const powerNote = [power.note, charger].filter(Boolean).join(' · ');
  text(nodes['power-note'], powerNote);
  nodes['power-note'].hidden = !powerNote;
  meter(nodes.battery, power.percent);
  nodes.material.hidden = !asset.printer;
  if (!asset.printer) return;
  const supply = asset.printer.supply;
  text(nodes.supply, typeof supply === 'string' ? supply : supply?.label || '补料状态未记录');
  colors.forEach(([key, , colorName]) => {
    const spool = spoolFor(asset.printer, key, colorName);
    const remaining = spool?.remainingGrams ?? spool?.grams;
    const capacity = spool?.capacityGrams;
    const hasGrams = Number.isFinite(remaining);
    const hasCapacity = Number.isFinite(capacity) && capacity > 0;
    text(nodes[`spool-${key}`], hasGrams ? `${grams.format(remaining)}${hasCapacity ? ` / ${grams.format(capacity)}` : ''} g` : '未记录');
    meter(nodes[`meter-${key}`], hasGrams && hasCapacity ? 100 * remaining / capacity : spool?.remainingPercent);
  });
}

function paintHistory(nodes, asset, snapshot, getHistory) {
  const at = timeOf(snapshot);
  const history = getHistory?.(asset.id, at) ?? asset.history ?? [];
  const recent = history.filter((record) => Number.isFinite(timeOf(record)) && (!Number.isFinite(at) || timeOf(record) <= at))
    .sort((a, b) => timeOf(b) - timeOf(a)).slice(0, 6);
  nodes['history-empty'].hidden = recent.length > 0;
  const list = nodes.history;
  while (list.children.length > recent.length) list.lastElementChild.remove();
  for (const [index, record] of recent.entries()) {
    let item = list.children[index];
    if (!item) {
      item = list.ownerDocument.createElement('li');
      item.append(list.ownerDocument.createElement('time'), list.ownerDocument.createElement('span'));
      list.append(item);
    }
    const at = timeOf(record);
    attribute(item.firstElementChild, 'datetime', `PT${Math.max(0, Math.floor(at))}S`);
    text(item.firstElementChild, replayTime(at));
    const recordPower = powerReading(record.power);
    const description = activityLabel(record) || record.label || stateLabel(record);
    text(item.lastElementChild, [description, taskLabel(record.task), recordPower.percent !== null && Number.isFinite(recordPower.percent) ? recordPower.label : ''].filter(Boolean).join(' · '));
  }
}

/**
 * Mount inside #equipment-panel after inserting shell. update accepts the replay snapshot
 * from getEquipmentTelemetry. Optional getHistory(id, elapsed) returns records for that asset.
 */
export function initEquipmentPanel(root, { getHistory } = {}) {
  if (!root) throw new TypeError('The equipment panel mount is required.');
  root.innerHTML = panelMarkup();
  const document = root.ownerDocument;
  const window = document.defaultView;
  const nodes = Object.fromEntries([...root.querySelectorAll('[data-eq]')].map((node) => [node.dataset.eq, node]));
  const visibilityRoots = [root.closest('[data-console-page]'), root.closest('.control-screen-layer')].filter(Boolean);
  const rows = new Map();
  const listeners = new window.AbortController();
  let snapshot;
  let readHistory = getHistory;
  let selectedId;
  let paintedId;
  let frame;
  let historyBucket;
  let catalogOrder = [];
  let paintedSnapshot = null;
  let stableHistoryReader;

  function paint(userAction = false, preferExactId = false) {
    if (visibilityRoots.some((element) => element.hidden)) return;
    if (!userAction && snapshot === paintedSnapshot && readHistory === stableHistoryReader) return;
    paintedSnapshot = snapshot;
    stableHistoryReader = readHistory;
    const assets = snapshot?.assets ?? [];
    const states = new Map(Object.entries(stateLabels));
    const types = new Map();
    let active = 0;
    let charging = 0;
    for (const asset of assets) {
      types.set(asset.type ?? '', labelForType(asset));
      const state = stateOf(asset);
      if (!states.has(state)) states.set(state, stateLabel(asset, state));
      if (state === 'active') active++;
      if (state === 'charging') charging++;
    }
    setOptions(nodes.type, '全部类型', [...types].filter(([key]) => key));
    setOptions(nodes.state, '全部状态', [...states]);
    const query = normalize(nodes.search.value).split(/\s+/).filter(Boolean);
    const filtered = assets.filter((asset) => {
      if (nodes.type.value && nodes.type.value !== asset.type) return false;
      if (nodes.state.value && nodes.state.value !== stateOf(asset)) return false;
      const haystack = normalize([asset.id, asset.name, asset.area, labelForType(asset)].filter(Boolean).join(' '));
      return query.every((word) => haystack.includes(word));
    });
    const exact = preferExactId && filtered.find(({ id }) => query.includes(normalize(id)));
    const selected = exact || filtered.find(({ id }) => id === selectedId) || filtered[0];
    if (selected) selectedId = selected.id;
    const enabledIds = new Set(filtered.map(({ id }) => id));
    const focusedButton = document.activeElement?.closest('button[data-equipment-id]');
    if (focusedButton && nodes.list.contains(focusedButton) && !enabledIds.has(focusedButton.dataset.equipmentId)) nodes.state.focus();
    if (assets.length !== catalogOrder.length || assets.some(({ id }, index) => catalogOrder[index] !== id)) {
      catalogOrder = assets.map(({ id }) => id);
      const catalogIds = new Set(catalogOrder);
      for (const id of rows.keys()) if (!catalogIds.has(id)) rows.delete(id);
      for (const id of catalogOrder) if (!rows.has(id)) rows.set(id, createRow(document, id));
      nodes.list.replaceChildren(...catalogOrder.map((id) => rows.get(id).item));
      if (focusedButton && enabledIds.has(focusedButton.dataset.equipmentId)) focusedButton.focus({ preventScroll: true });
    }
    for (const asset of assets) {
      const row = rows.get(asset.id);
      row.item.hidden = !enabledIds.has(asset.id);
      if (row.item.hidden) continue;
      text(row.name, asset.name || asset.id);
      text(row.meta, [asset.id, asset.area].filter(Boolean).join(' / '));
      attribute(row.button, 'aria-pressed', selected === asset);
      paintStatus(row.status, asset);
    }
    const count = `${filtered.length} / ${assets.length} 台`;
    text(nodes.total, snapshot ? assets.length : '—');
    text(nodes.active, snapshot ? active : '—');
    text(nodes.charging, snapshot ? charging : '—');
    text(nodes.clock, replayTime(timeOf(snapshot)));
    text(nodes.count, count);
    nodes['list-empty'].hidden = filtered.length > 0;
    text(nodes['list-empty'], assets.length ? '没有符合筛选条件的设备。' : '暂无设备数据。');
    if (userAction) text(nodes.announcement, `符合条件 ${filtered.length} 台${selected ? `，当前 ${selected.name || selected.id}` : ''}。`);
    nodes['detail-content'].hidden = !selected;
    nodes['detail-empty'].hidden = Boolean(selected);
    if (!selected) {
      paintedId = undefined;
      return;
    }
    const selectionChanged = paintedId !== selected.id;
    if (selectionChanged) nodes.detail.scrollTop = 0;
    paintAssetDetail(nodes, selected);
    // Whole replay seconds keep history lookups bounded during frame-by-frame updates.
    const bucket = Math.floor(timeOf(snapshot) ?? 0);
    if (selectionChanged || userAction || bucket !== historyBucket) {
      paintHistory(nodes, selected, snapshot, readHistory);
      historyBucket = bucket;
    }
    paintedId = selected.id;
  }

  function schedule() {
    if (frame !== undefined || visibilityRoots.some((element) => element.hidden)) return;
    frame = window.requestAnimationFrame(() => {
      frame = undefined;
      paint();
    });
  }

  const on = (node, name, handler) => node.addEventListener(name, handler, { signal: listeners.signal });
  on(nodes.search, 'input', () => paint(true, true));
  on(nodes.type, 'change', () => paint(true));
  on(nodes.state, 'change', () => paint(true));
  on(nodes.list, 'click', (event) => {
    const button = event.target.closest('button[data-equipment-id]');
    if (!button || !nodes.list.contains(button)) return;
    selectedId = button.dataset.equipmentId;
    paint(true);
  });
  on(nodes.list, 'keydown', (event) => {
    const button = event.target.closest('button[data-equipment-id]');
    if (!button || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const visible = [...nodes.list.querySelectorAll('li:not([hidden]) button')];
    const index = visible.indexOf(button);
    const next = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: visible.length - 1 }[event.key];
    event.preventDefault();
    visible[Math.min(visible.length - 1, Math.max(0, next))]?.focus();
  });
  const observer = new window.MutationObserver(schedule);
  for (const element of visibilityRoots) observer.observe(element, { attributeFilter: ['hidden'] });
  schedule();

  return {
    update(nextSnapshot, historyReader = getHistory) {
      if (readHistory !== historyReader || nextSnapshot?.orderId !== snapshot?.orderId ||
          timeOf(nextSnapshot) < timeOf(snapshot)) historyBucket = undefined;
      snapshot = nextSnapshot;
      readHistory = historyReader;
      schedule();
    },
    destroy() {
      listeners.abort();
      observer.disconnect();
      if (frame !== undefined) window.cancelAnimationFrame(frame);
    },
  };
}
