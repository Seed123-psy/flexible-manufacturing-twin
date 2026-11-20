const BAY_COUNT = 2;
const DEFAULT_TRAVEL = { handoffOut: 0.65, toCharge: 1.3, fromCharge: 1.3, handoffIn: 0.65 };
const BATTERY_EPSILON = 1e-8;
const STATUS = {
  work: 'working', 'handoff-out': 'handoff-out', return: 'returning',
  charging: 'charging', exit: 'exiting', 'handoff-in': 'handoff-in',
};

function number(value, name, { positive = false } = {}) {
  if (!Number.isFinite(value) || value < 0 || (positive && value === 0)) {
    throw new RangeError(`${name} must be a finite ${positive ? 'positive' : 'non-negative'} number`);
  }
  return value;
}

function name(value, field) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${field} must be a non-empty string`);
  return value;
}

function zones(resources = []) {
  if (!Array.isArray(resources)) throw new TypeError('resources must be an array of zone names');
  return resources.map((resource) => `zone:${name(resource, 'resource')}`);
}

function point(value) {
  if (value == null) return null;
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) {
    throw new TypeError('Route positions must be [x, y, z] arrays');
  }
  return Object.freeze([...value]);
}

function firstAfter(items, time, key) {
  let lo = 0;
  let hi = items.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (items[mid][key] <= time) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// Express each resource's occupancy relative to the start of a plan. Merge
// adjacent spans where the same vehicle moves from one action into the next.
function resourceSpans(steps) {
  const groups = new Map();
  let offset = 0;
  for (const { seconds, resources } of steps) {
    const end = offset + seconds;
    for (const resource of new Set(resources)) {
      if (!groups.has(resource)) groups.set(resource, []);
      const spans = groups.get(resource);
      const last = spans.at(-1);
      if (last?.end === offset) last.end = end;
      else spans.push({ resource, start: offset, end });
    }
    offset = end;
  }
  return [...groups.values()].flat();
}

function location(id, position) {
  return Object.freeze({ id, position: point(position) });
}

function route(spec, context, from, to, resources) {
  const definition = typeof spec === 'function' ? spec({ ...context, from, to }) : spec;
  const { points, resources: routeZones } = definition ?? {};
  const path = points == null ? [from.position, to.position].filter(Boolean) : points.map(point);
  return Object.freeze({
    from, to, points: Object.freeze(path),
    resources: Object.freeze([...new Set([...resources, ...zones(routeZones)])]),
  });
}

/**
 * Online, deterministic scheduler. Times are simulated seconds and battery
 * values use the units of fleet.capacity. Each fleet has one service position
 * and two serial-numbered vehicles, initially full, with the primary in service.
 *
 * Fleet config: { label, primary, backup, capacity, reserve, drainPerSecond,
 *   chargeSeconds, chargeAtParking?, travelDrainPerSecond?, travel?: { handoffOut, toCharge,
 *   fromCharge, handoffIn }, home?: [x,y,z], parking?: { primary, backup },
 *   workResources?: string[], routes?: { handoffOut, toCharge, fromCharge,
 *   handoffIn } }. A route definition is { points?: [x,y,z][], resources?:
 *   string[] }, or a function ({ fleet, agent, role, bay, station, from, to })
 *   returning that shape. Bay indexes are 0 and 1, and null for handoffs.
 *   Points include endpoints and are in travel order. Parking locations are
 *   dedicated waiting areas. Shared aisles/crossings must use matching resource
 *   names on every task or route that uses them. The whole interval locks them.
 * Station config: { id?, name?, location?, bays?: 2, positions?: [x,y,z][] }.
 *
 * reserveTask(fleet, { earliest, duration, id?, energy?, resources?, meta? })
 *   returns one work interval, with actual start/end/agent and the request's
 *   earliest time. The task must start and end at the fleet home, including any
 *   empty return before a vehicle can be relieved. Reservations are processed
 *   in call order within a fleet. An incumbent recharges when a new task would
 *   exhaust its working budget. Commit caller phases at the returned start.
 * getIntervals(fleet?) returns sorted, half-open [start, end) intervals. Kinds
 *   are work, handoff-out, return, charging, exit, and handoff-in. The last five
 *   carry the route (from, to, points), duration and applicable bay index.
 * snapshot(time) returns { fleets, charging } with active vehicle IDs and
 *   per-vehicle interval progress for an arbitrary replay time.
 */
export function createMobileScheduler({ fleets, station: stationConfig = {} } = {}) {
  if (!fleets || Object.keys(fleets).length === 0) throw new TypeError('Configure at least one mobile fleet');
  if ((stationConfig.bays ?? BAY_COUNT) !== BAY_COUNT) throw new RangeError('The shared station has exactly two bays');
  if (stationConfig.positions && stationConfig.positions.length !== BAY_COUNT) {
    throw new RangeError('Provide exactly two charging bay positions');
  }
  const station = Object.freeze({
    id: name(stationConfig.id ?? 'charge-01', 'station.id'),
    name: stationConfig.name ?? '中央机器人充电站',
    location: stationConfig.location,
    bays: BAY_COUNT,
    positions: Object.freeze(Array.from({ length: BAY_COUNT }, (_, bay) => point(stationConfig.positions?.[bay]))),
  });
  const access = `charger:${station.id}:access`;
  const bays = station.positions.map((position, bay) => location(`charger:${station.id}:bay:${bay}`, position));
  const calendars = new Map();
  const priority = stationConfig.priority;
  const protectedResources = priority ? new Set([access, bays[0].id, ...zones(priority.resources)]) : new Set();
  const fleetStates = new Map();
  const agentIds = new Set();
  const intervals = [];

  for (const [key, config] of Object.entries(fleets)) {
    const capacity = number(config.capacity, `${key}.capacity`, { positive: true });
    const reserve = number(config.reserve, `${key}.reserve`);
    const drain = number(config.drainPerSecond, `${key}.drainPerSecond`, { positive: true });
    const chargeSeconds = number(config.chargeSeconds, `${key}.chargeSeconds`, { positive: true });
    const travelDrain = number(config.travelDrainPerSecond ?? drain, `${key}.travelDrainPerSecond`);
    const travel = Object.fromEntries(Object.entries(DEFAULT_TRAVEL).map(([kind, fallback]) => [
      kind, number(config.travel?.[kind] ?? fallback, `${key}.travel.${kind}`, { positive: true }),
    ]));
    const energy = Object.fromEntries(Object.entries(travel).map(([kind, seconds]) => [kind, seconds * travelDrain]));
    const chargeAtParking = config.chargeAtParking === true;
    if (chargeAtParking) energy.toCharge = energy.fromCharge = 0;
    const serviceResource = `fleet:${key}:service`;
    const home = location(serviceResource, config.home);
    const minimumAtHome = reserve + energy.handoffOut + energy.toCharge;
    const maxTaskEnergy = capacity - energy.fromCharge - energy.handoffIn - minimumAtHome;
    if (maxTaskEnergy <= 0) throw new RangeError(`${key} has no usable battery after reserving travel and charge access`);
    const agents = ['primary', 'backup'].map((role) => {
      const id = name(config[role], `${key}.${role}`);
      if (agentIds.has(id)) throw new TypeError(`Duplicate vehicle ID ${id}`);
      agentIds.add(id);
      const parking = location(`parking:${id}`, config.parking?.[role]);
      const context = { fleet: key, agent: id, role, station, bay: null };
      return {
        id, role, parking, readyAt: 0, battery: capacity, initialLocation: role === 'primary' ? home : parking,
        intervals: [],
        handoffOut: route(config.routes?.handoffOut, context, home, parking, [serviceResource]),
        handoffIn: route(config.routes?.handoffIn, context, parking, home, [serviceResource]),
        toCharge: chargeAtParking ? [] : bays.map((dock, bay) => route(config.routes?.toCharge, { ...context, bay }, parking, dock, [access, dock.id])),
        fromCharge: chargeAtParking ? [] : bays.map((dock, bay) => route(config.routes?.fromCharge, { ...context, bay }, dock, parking, [access, dock.id])),
      };
    });
    fleetStates.set(key, {
      key, label: config.label ?? key, capacity, reserve, drain, chargeSeconds, travel, energy,
      minimumAtHome, maxTaskEnergy, chargeAtParking, agents, home, workResources: [serviceResource, ...zones(config.workResources)],
      incumbent: agents[0], availableAt: 0,
    });
  }

  function getFleet(key) {
    const fleet = fleetStates.get(key);
    if (!fleet) throw new RangeError(`Unknown mobile fleet ${key}`);
    return fleet;
  }

  function plan(steps, earliest, fleetKey) {
    const spans = resourceSpans(steps);
    let start = earliest;
    // Each conflict forbids every earlier candidate up to the end of that
    // reservation minus our offset. Search all calendars again after advancing.
    for (;;) {
      let next = start;
      for (const span of spans) {
        const busy = calendars.get(span.resource);
        const conflict = busy?.[firstAfter(busy, start + span.start, 'end')];
        if (protectedResources.has(span.resource) && fleetKey !== priority.fleet) {
          const first = priority.first;
          const now = start + span.start;
          const cycle = Math.max(0, Math.floor((now - first - priority.seconds) / priority.period) + 1);
          const slot = first + cycle * priority.period;
          if (slot < start + span.end && slot + priority.seconds > now) {
            next = Math.max(next, slot + priority.seconds - span.start + 0.0001);
          }
        }
        if (conflict && conflict.start < start + span.end) {
          const after = conflict.end - span.start;
          const advance = after > start ? after : start + Math.max(1e-9, Math.abs(start) * Number.EPSILON);
          next = Math.max(next, advance);
        }
      }
      if (next === start) return { start, steps, spans };
      start = next;
    }
  }

  function commit(fleet, agent, { start, steps, spans }) {
    for (const span of spans) {
      const busy = calendars.get(span.resource) ?? [];
      const boundary = { start: start + span.start, end: start + span.end };
      busy.splice(firstAfter(busy, boundary.start, 'end'), 0, boundary);
      calendars.set(span.resource, busy);
    }
    let offset = 0;
    for (const { kind, seconds, energy, route, resources, bay, request } of steps) {
      const batteryStart = agent.battery;
      const batteryEnd = kind === 'charging' ? fleet.capacity : batteryStart - energy;
      const interval = Object.freeze({
        start: start + offset, end: start + (offset + seconds), kind, duration: seconds,
        fleet: fleet.key, agent: agent.id, role: agent.role, batteryStart, batteryEnd,
        route, resources: Object.freeze([...new Set(resources)]), bay: bay ?? null,
        station: bay == null ? null : station.id,
        ...request,
      });
      offset += seconds;
      agent.readyAt = interval.end;
      agent.battery = batteryEnd;
      agent.intervals.push(interval);
      intervals.push(interval);
    }
    return agent.intervals.at(-1);
  }

  function movement(fleet, kind, travel, path, bay) {
    return { kind, seconds: fleet.travel[travel], energy: fleet.energy[travel], route: path, resources: path.resources, bay };
  }

  function retire(fleet, agent, at) {
    const departure = movement(fleet, 'handoff-out', 'handoffOut', agent.handoffOut);
    const { end } = commit(fleet, agent, plan([departure], at));
    fleet.availableAt = end;
    fleet.incumbent = null;

    if (fleet.chargeAtParking) {
      const dock = agent.parking;
      const resources = [dock.id];
      const step = { kind: 'charging', seconds: fleet.chargeSeconds, resources,
        route: route(null, null, dock, dock, resources) };
      commit(fleet, agent, plan([step], end));
      return;
    }

    // Reserve ingress, the complete docking window, and egress together. When
    // both bays are busy the vehicle waits at its parking location off the aisle.
    const options = bays.map((dock, bay) => plan([
      movement(fleet, 'return', 'toCharge', agent.toCharge[bay], bay),
      { kind: 'charging', seconds: fleet.chargeSeconds, resources: [dock.id], route: route(null, null, dock, dock, [dock.id]), bay },
      movement(fleet, 'exit', 'fromCharge', agent.fromCharge[bay], bay),
    ], end, fleet.key));
    const [first, second] = options;
    commit(fleet, agent, first.start <= second.start ? first : second);
  }

  function prepareTask(key, { earliest, duration, id, energy, resources, meta } = {}) {
    const fleet = getFleet(key);
    const requested = number(earliest, 'task.earliest');
    const seconds = number(duration, 'task.duration', { positive: true });
    const cost = number(energy ?? seconds * fleet.drain, 'task.energy');
    const workResources = [...fleet.workResources, ...zones(resources)];
    const work = {
      kind: 'work', seconds, energy: cost, resources: workResources,
      route: route(null, null, fleet.home, fleet.home, workResources),
      request: { id, earliest: requested, meta },
    };
    const at = Math.max(requested, fleet.availableAt);
    const atHome = fleet.incumbent;
    const canWork = (battery) => battery - cost >= fleet.minimumAtHome - BATTERY_EPSILON;
    const canCallUp = (agent) => canWork(agent.battery - fleet.energy.handoffIn);
    if (atHome && canWork(atHome.battery)) return { fleet, agent: atHome, work, ready: at };
    const standbyCanWork = fleet.agents.some((agent) => agent !== atHome && canCallUp(agent));
    if (!standbyCanWork && cost > fleet.maxTaskEnergy + BATTERY_EPSILON) {
      throw new RangeError(`${key} task ${id ?? ''} exceeds the available battery budget (${fleet.maxTaskEnergy} after charging)`);
    }
    if (atHome) retire(fleet, atHome, at);
    const candidates = fleet.agents.filter(canCallUp).map((agent) => ({
      agent,
      plan: plan([movement(fleet, 'handoff-in', 'handoffIn', agent.handoffIn)],
        Math.max(at, fleet.availableAt, agent.readyAt)),
    }));
    const [first, second] = candidates;
    const selected = second && second.plan.start < first.plan.start ? second : first;
    const handoff = commit(fleet, selected.agent, selected.plan);
    fleet.incumbent = selected.agent;
    fleet.availableAt = handoff.end;
    return { fleet, agent: selected.agent, work, ready: handoff.end };
  }

  function finishTask({ fleet, agent, work }, start) {
    const task = commit(fleet, agent, plan([work], start));
    fleet.availableAt = task.end;
    return task;
  }

  function reserveTask(key, request) {
    const task = prepareTask(key, request);
    if (request.fit) {
      // Dynamic patrol timing has no additional work zones. The fleet's own
      // home is available now, so the fitted path starts at this exact time.
      if (request.resources?.length || request.energy == null) throw new RangeError('Fitted tasks require fixed energy and a private work zone');
      const fitted = request.fit(task.ready);
      task.work.seconds = number(fitted.duration, 'task.fittedDuration', { positive: true });
      task.work.request = { ...task.work.request, meta: fitted };
    }
    return finishTask(task, task.ready);
  }

  function reserveResource(resource, earliest, seconds) {
    const resources = zones([resource]);
    const { start, spans } = plan([{ seconds, resources }], earliest);
    const busy = calendars.get(resources[0]) ?? [];
    const boundary = { start, end: start + spans[0].end };
    busy.splice(firstAfter(busy, start, 'end'), 0, boundary);
    calendars.set(resources[0], busy);
    return start;
  }

  // Multiple fleets can rendezvous at one loading job. Commit the independent
  // handoffs first, then find one start at which every participant can work.
  function reserveConcurrentTasks(requests) {
    const tasks = requests.map(({ fleet, ...request }) => prepareTask(fleet, request));
    const resources = tasks.flatMap(({ work }) => [...new Set(work.resources)]);
    if (new Set(resources).size !== resources.length) throw new RangeError('Concurrent tasks must occupy separate work zones');
    let start = Math.max(...tasks.map(({ ready }) => ready));
    for (;;) {
      const next = Math.max(...tasks.map(({ work }) => plan([work], start).start));
      if (next === start) break;
      start = next;
    }
    return tasks.map((task) => finishTask(task, start));
  }

  function getIntervals(key) {
    if (key !== undefined) getFleet(key);
    return intervals.filter((item) => key === undefined || item.fleet === key)
      .sort((a, b) => a.start - b.start || a.end - b.end);
  }

  function agentAt(fleet, agent, time) {
    const index = firstAfter(agent.intervals, time, 'start') - 1;
    const last = agent.intervals[index];
    const interval = last && time < last.end ? last : null;
    const progress = interval ? (time - interval.start) / (interval.end - interval.start) : 0;
    return {
      id: agent.id,
      battery: interval
        ? interval.batteryStart + (interval.batteryEnd - interval.batteryStart) * progress
        : last?.batteryEnd ?? fleet.capacity,
      status: interval ? STATUS[interval.kind] : 'standby',
      charging: interval?.kind === 'charging',
      location: interval ? interval.route.from : last?.route.to ?? agent.initialLocation,
      interval,
      progress,
    };
  }

  function snapshot(time) {
    number(time, 'snapshot.time');
    const charging = [];
    const frames = Array.from(fleetStates, ([key, fleet]) => {
      const [primary, backup] = fleet.agents.map((agent) => agentAt(fleet, agent, time));
      const states = [primary, backup];
      const docked = states.filter((agent) => agent.charging);
      charging.push(...docked.map((agent) => agent.interval).filter((interval) => interval.bay !== null));
      return [key, {
        fleet: fleet.label, capacity: fleet.capacity, reserve: fleet.reserve, primary, backup,
        active: states.find((agent) => agent.status === 'working' || agent.status === 'handoff-in'
          || (agent.status === 'standby' && agent.location === fleet.home))?.id ?? null,
        lowBattery: states.some((agent) => agent.battery < fleet.minimumAtHome + BATTERY_EPSILON),
        charging: docked.map((agent) => agent.id),
      }];
    });
    charging.sort((a, b) => a.bay - b.bay);
    return {
      fleets: Object.fromEntries(frames),
      charging: { station, active: charging.map((interval) => interval.agent), occupiedBays: charging.length, intervals: charging },
    };
  }

  return { station, reserveTask, reserveResource, reserveConcurrentTasks, getIntervals, snapshot };
}
