// Each reservation covers a circular footprint swept along a short path segment.
// Window times are conservative: its whole capsule is reserved during the move.
export function createPatrolTraffic() {
  const zones = new Map();
  const keyPart = (point) => `${point[0].toFixed(4)}:${point[2].toFixed(4)}`;
  function sweep(from, to, radius, start, end) {
    if (start >= end) return;
    const [a, b] = [keyPart(from), keyPart(to)].sort();
    const key = `${a}|${b}:${radius.toFixed(4)}`;
    if (!zones.has(key)) zones.set(key, { from, to, radius: radius + 0.001, windows: [] });
    zones.get(key).windows.push({ start, end });
  }
  const occupy = (point, radius, start, end) => sweep(point, point, radius, start, end);
  function travel(points, radius, start, end) {
    const edges = points.slice(1).map((to, index) => {
      const from = points[index];
      return { from, to, length: Math.hypot(to[0] - from[0], to[2] - from[2]) };
    });
    const length = edges.reduce((sum, edge) => sum + edge.length, 0);
    if (!length) return occupy(points[0], radius, start, end);
    const secondsPerMetre = (end - start) / length;
    let offset = 0;
    for (const edge of edges) {
      const count = Math.ceil(edge.length / 0.7);
      const stride = edge.length / count;
      const at = (fraction) => edge.from.map((value, axis) => value + (edge.to[axis] - value) * fraction);
      for (let i = 0; i < count; i++) {
        sweep(at(i / count), at((i + 1) / count), radius,
          start + offset * secondsPerMetre, start + (offset + stride) * secondsPerMetre);
        offset += stride;
      }
    }
  }
  return { occupy, sweep, travel, zones: () => [...zones.values()] };
}

function circleInterval(x, z, dx, dz, radius) {
  const a = dx * dx + dz * dz;
  const b = x * dx + z * dz;
  const c = x * x + z * z - radius * radius;
  if (!a) return c <= 0 ? [0, 1] : null;
  const discriminant = b * b - a * c;
  if (discriminant < 0) return null;
  const root = Math.sqrt(discriminant);
  return [(-b - root) / a, (-b + root) / a];
}

function slabInterval(value, delta, min, max) {
  if (delta === 0) return value >= min && value <= max ? [0, 1] : null;
  const entry = (min - value) / delta;
  const exit = (max - value) / delta;
  return [Math.min(entry, exit), Math.max(entry, exit)];
}

// Clip the patrol trajectory against the two end caps and the oriented rectangle.
// A capsule is convex, so the surviving clips form one continuous interval.
function withinCapsule(step, { from, to, radius }, clearance) {
  radius += clearance;
  const x = step.from[0] - from[0];
  const z = step.from[2] - from[2];
  const dx = step.to[0] - step.from[0];
  const dz = step.to[2] - step.from[2];
  const vx = to[0] - from[0];
  const vz = to[2] - from[2];
  const length = Math.hypot(vx, vz);
  const intervals = [circleInterval(x, z, dx, dz, radius)];
  if (length) {
    intervals.push(circleInterval(x - vx, z - vz, dx, dz, radius));
    const along = slabInterval((x * vx + z * vz) / length, (dx * vx + dz * vz) / length, 0, length);
    const across = slabInterval((z * vx - x * vz) / length, (dz * vx - dx * vz) / length, -radius, radius);
    if (along && across) intervals.push([Math.max(along[0], across[0]), Math.min(along[1], across[1])]);
  }
  let entry = Infinity;
  let exit = -Infinity;
  for (const interval of intervals) {
    if (!interval) continue;
    const first = Math.max(0, interval[0]);
    const last = Math.min(1, interval[1]);
    if (first > last) continue;
    entry = Math.min(entry, first);
    exit = Math.max(exit, last);
  }
  if (entry > exit) return null;
  const span = step.end - step.start;
  return [step.start + entry * span, step.start + exit * span];
}

function distanceToSweep(point, { from, to }) {
  const vx = to[0] - from[0];
  const vz = to[2] - from[2];
  const x = point[0] - from[0];
  const z = point[2] - from[2];
  const square = vx * vx + vz * vz;
  const projection = square ? Math.max(0, Math.min(1, (x * vx + z * vz) / square)) : 0;
  return Math.hypot(x - projection * vx, z - projection * vz);
}

function firstEndingAfter(windows, time) {
  let lo = 0;
  let hi = windows.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (windows[mid].end <= time) lo = mid + 1;
    else hi = mid;
  }
  return windows[lo];
}

// The rover can wait only outside the swept traffic envelopes. Between safe
// waypoints it keeps rolling, with each crossing booked against its local clock.
export function planPatrol(base, zones, clearance) {
  function describe(zones) {
    const merged = zones.map((zone) => {
      const windows = [];
      for (const window of [...zone.windows].sort((a, b) => a.start - b.start)) {
        if (windows.length && window.start <= windows.at(-1).end) windows.at(-1).end = Math.max(windows.at(-1).end, window.end);
        else windows.push({ ...window });
      }
      return { ...zone, windows };
    });
    return base.segments.map((step) => {
      const crossings = [];
      for (const zone of merged) {
        const times = withinCapsule(step, zone, clearance);
        if (times) crossings.push({ times, windows: zone.windows });
      }
      const safe = merged.every((zone) => distanceToSweep(step.to, zone) > zone.radius + clearance);
      return { safe, crossings };
    });
  }

  const permanent = describe(zones);
  const noExtraZones = [];
  let extras = noExtraZones;
  let blocks;
  function groupSteps(extraZones) {
    const additional = extraZones.length ? describe(extraZones) : [];
    const result = [];
    let block = { steps: [], crossings: [] };
    for (const [i, step] of base.segments.entries()) {
      block.steps.push(step);
      block.crossings.push(...permanent[i].crossings, ...(additional[i]?.crossings ?? []));
      if ((permanent[i].safe && (additional[i]?.safe ?? true)) || i === base.segments.length - 1) {
        result.push(block);
        block = { steps: [], crossings: [] };
      }
    }
    return result;
  }

  return (start, extraZones = noExtraZones) => {
    if (!blocks || extraZones !== extras) {
      extras = extraZones;
      blocks = groupSteps(extras);
    }
    const segments = [];
    let elapsed = 0;
    for (const { steps, crossings } of blocks) {
      const first = steps[0];
      let delay = elapsed;
      for (;;) {
        let next = delay;
        for (const { times: [entry, exit], windows } of crossings) {
          const conflict = firstEndingAfter(windows, start + delay + entry);
          if (conflict && conflict.start < start + delay + exit) {
            next = Math.max(next, conflict.end - start - entry + 0.0001);
          }
        }
        if (next <= delay) break;
        delay = next;
      }
      if (delay > elapsed) {
        segments.push({ ...first, to: first.from, yawDelta: 0, station: null, length: 0, kind: 'yield',
          start: first.start + elapsed, end: first.start + delay, nominalEnd: first.start + delay });
      }
      elapsed = delay;
      for (const step of steps) segments.push({ ...step, start: step.start + elapsed, end: step.end + elapsed,
        nominalEnd: step.end + elapsed });
    }
    const events = segments.filter(({ kind }) => kind === 'scan');
    return { ...base, segments, events, duration: segments.at(-1).end };
  };
}
