import { DEFAULT_ORDER, validateOrder } from './simulation.js';

const key = 'workshop.order-replays.v1';
const capacity = 20;
const orderFields = Object.keys(DEFAULT_ORDER);

export function readOrderReplays(storage) {
  try {
    const entries = JSON.parse(storage.getItem(key) ?? '[]');
    if (!Array.isArray(entries)) return [];
    return entries.filter((entry) => entry && typeof entry.id === 'string' && typeof entry.orderId === 'string'
      && Number.isFinite(entry.startedAt) && Number.isFinite(entry.elapsed) && entry.elapsed >= 0 && entry.params
      && !Object.keys(validateOrder(entry.params)).length).slice(0, capacity);
  } catch {
    return [];
  }
}

export function startOrderReplay(sim) {
  return { id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`, orderId: sim.order.id,
    startedAt: Date.now(), elapsed: 0, params: Object.fromEntries(orderFields.map((field) => [field, sim.order[field]])) };
}

export function storeOrderReplay(storage, entry, elapsed) {
  try {
    const entries = readOrderReplays(storage);
    const saved = entries.find(({ id }) => id === entry.id);
    const updated = { ...entry, elapsed: Math.max(saved?.elapsed ?? 0, entry.elapsed, elapsed) };
    const next = [updated, ...entries.filter(({ id }) => id !== entry.id)]
      .sort((a, b) => b.startedAt - a.startedAt).slice(0, capacity);
    storage.setItem(key, JSON.stringify(next));
    return updated;
  } catch {
    return entry;
  }
}
