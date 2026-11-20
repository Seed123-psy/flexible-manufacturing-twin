export const FILAMENT_DOCK = { y: 0.43, z: -1.85 };
export const FILAMENT_SPOOL_GRAMS = 1000;
export const FILAMENT_STOCK_PER_COLOR = 200;
export const FILAMENT_EXCHANGE_SECONDS = 6.4;
export const FILAMENT_PICKUP_SECONDS = 2.4;
export const FILAMENT_TRAVEL_SECONDS = 4.6;
export const FILAMENT_RECOVERY_SECONDS = 1.8;
// Battery fractions per simulation second for the MAT-01 service cycle.
export const FILAMENT_ROBOT_CHARGE_RATE = 0.008;
export const FILAMENT_ROBOT_DRAIN_RATE = 0.0022;
export const FILAMENT_ROBOT_START_MIN = 0.24;
export const FILAMENT_TOOL_SPACING = 0.48;

export const FILAMENT_COLORS = [
  { id: 'red', label: '红色', code: 'R', tint: '#f54a56' },
  { id: 'green', label: '绿色', code: 'G', tint: '#46da78' },
  { id: 'blue', label: '蓝色', code: 'B', tint: '#4297fd' },
].map((color, index) => ({
  ...color, index,
  bay: { x: (index - 1.5) * 0.29, y: 2.615, z: -0.115 },
  shelfY: 0.22 + index * 0.46,
}));
export const FILAMENT_WAREHOUSE_STOCK = FILAMENT_COLORS.length * FILAMENT_STOCK_PER_COLOR;

const clamp = (value) => Math.min(1, Math.max(0, value));
const smooth = (value) => { const p = clamp(value); return p * p * (3 - 2 * p); };
const home = { x: 0, y: 0.80, freshReach: 0, oldReach: 0, hatch: 0 };

function stagesFor({ bay }) {
  const reach = bay.z - FILAMENT_DOCK.z;
  const dock = { ...home, y: FILAMENT_DOCK.y };
  const raised = { ...home, x: bay.x + FILAMENT_TOOL_SPACING, y: bay.y, hatch: 1 };
  const aligned = { ...raised, x: bay.x };
  const reset = { ...dock, x: FILAMENT_TOOL_SPACING };
  return [
    { end: 0.08, state: 'handoff', label: '低位接卷', pose: dock },
    { end: 0.24, state: 'lift', label: '升降台举升新卷', pose: raised },
    { end: 0.32, state: 'unload', label: '夹取旧卷', pose: { ...raised, oldReach: reach } },
    { end: 0.41, state: 'unload', label: '抽出旧卷', pose: raised },
    { end: 0.48, state: 'insert', label: '横移至对应料槽', pose: aligned },
    { end: 0.60, state: 'insert', label: '将新卷推入料槽', pose: { ...aligned, freshReach: reach } },
    { end: 0.70, state: 'verify', label: '收回夹具', pose: { ...aligned, hatch: 1 } },
    { end: 0.86, state: 'feed', label: '进料轮牵引丝材入机', pose: { ...reset, hatch: 0.38 } },
    { end: 0.91, state: 'verify', label: '旧卷交给回收小车', pose: reset },
    { end: 0.96, state: 'verify', label: '夹具松开并退回', pose: { ...home, x: FILAMENT_TOOL_SPACING } },
    { end: 1, state: 'verify', label: '确认进料并放行', pose: home },
  ];
}
const colorStages = FILAMENT_COLORS.map(stagesFor);

export function filamentExchangeAt(progress, slot = 0) {
  if (progress == null) return { ...home, state: 'ready', label: '待命', feed: 0 };
  const stages = colorStages[slot];
  const match = stages.findIndex(({ end }) => progress < end);
  const index = match < 0 ? stages.length - 1 : match;
  const stage = stages[index];
  const previous = stages[index - 1];
  const start = previous?.end ?? 0;
  const ease = smooth((progress - start) / (stage.end - start));
  const pose = { state: stage.state, label: stage.label };
  for (const key of Object.keys(home)) {
    const from = previous?.pose[key] ?? home[key];
    pose[key] = from + (stage.pose[key] - from) * ease;
  }
  // Each reel has exactly one visual owner at the transfers.
  pose.freshTool = progress >= 0.08 && progress < 0.60;
  pose.freshBay = progress >= 0.60;
  pose.oldBay = progress < 0.32;
  pose.oldTool = progress >= 0.32 && progress < 0.91;
  pose.oldCart = progress >= 0.91;
  pose.feed = clamp((progress - 0.70) / 0.16);
  return pose;
}

// One powered lift at the rack face retracts the selected cradle, then lowers it to deck height.
export function filamentPickupAt(progress, slot) {
  const { shelfY } = FILAMENT_COLORS[slot];
  const motion = (from, to, at, duration) => from + (to - from) * smooth((progress - at) / duration);
  const shelfHeight = shelfY + 0.24;
  return {
    x: 0.60,
    y: motion(shelfHeight, FILAMENT_DOCK.y, 0.45, 0.55),
    z: motion(0.05, 1.19, 0.10, 0.35),
  };
}
