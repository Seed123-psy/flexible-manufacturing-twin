import {
  REJECT_CARGO_SLOTS, REJECT_GANTRY_HOME, REJECT_INTAKE, REJECT_OFFSITE_SECONDS,
  REJECT_RACK_SLOTS, REJECT_TRUCK_EXIT, REJECT_TRUCK_PARK, REJECT_TRUCK_SECONDS,
} from './reject-layout.js';

const safeY = REJECT_GANTRY_HOME[1];
const overhead = ([x, , z]) => [x, safeY, z];
const mix = (a, b, t) => a.map((value, i) => value + (b[i] - value) * t);
const ease = (p) => p * p * (3 - 2 * p);
const duration = (a, b) => Math.max(0.18, Math.hypot(a[0] - b[0], a[2] - b[2]) / 3.2, Math.abs(a[1] - b[1]) / 2.2);

function gantryJob(kind, unit, pickup, drop) {
  // Return to a known home pose so work can be inserted into future idle gaps.
  const points = [REJECT_GANTRY_HOME, overhead(pickup), pickup, overhead(pickup), overhead(drop), drop, overhead(drop), REJECT_GANTRY_HOME];
  let span = 0;
  const legs = points.slice(1).map((to, index) => {
    const from = points[index];
    const start = span;
    span += duration(from, to);
    return { from, to, start, end: span };
  });
  return { kind, unit, legs, span };
}

export function createRejectPlan() {
  const units = [];
  const jobs = [];
  const trips = [];
  const rackFree = REJECT_RACK_SLOTS.map(() => 0);
  let laneFree = 0;
  let truckFree = 0;
  let nextLoad = 0;
  let batch = [];

  function reserve(job, earliest) {
    let start = earliest;
    let i = 0;
    for (; i < jobs.length; i++) {
      const other = jobs[i];
      if (start + job.span <= other.start) break;
      start = Math.max(start, other.end);
    }
    const reserved = { ...job, start, end: start + job.span,
      pickup: start + job.legs[1].end, clear: start + job.legs[2].end, drop: start + job.legs[4].end };
    jobs.splice(i, 0, reserved);
    return reserved;
  }

  function dispatch(ready) {
    const depart = Math.max(ready, nextLoad) + 0.60; // Cargo locks and departure beacon.
    const handover = depart + REJECT_TRUCK_SECONDS;
    const returnStart = handover + REJECT_OFFSITE_SECONDS;
    const returned = returnStart + REJECT_TRUCK_SECONDS;
    const trip = { units: batch.map(({ unit }) => unit), depart, handover, returnStart, returned };
    for (const record of batch) record.handover = handover;
    trips.push(trip);
    truckFree = returned;
    batch = [];
  }

  return {
    units, jobs, trips,
    receive(unit, quality, inspected, travel) {
      const earliest = Math.max(inspected, laneFree);
      // Reserve a physical address before releasing the piece from QC. A full rack
      // or busy transfer link holds the part at its QC station, not in a floor pile.
      let slot = rackFree.findIndex((free) => free <= earliest);
      if (slot < 0) slot = rackFree.indexOf(Math.min(...rackFree));
      const release = Math.max(earliest, rackFree[slot]);
      const arrival = release + travel;
      const putaway = reserve(gantryJob('store', unit, REJECT_INTAKE, REJECT_RACK_SLOTS[slot]), arrival);
      laneFree = putaway.end;
      const truckSlot = batch.length;
      const loading = reserve(gantryJob('load', unit, REJECT_RACK_SLOTS[slot], REJECT_CARGO_SLOTS[truckSlot]),
        Math.max(truckFree, nextLoad, putaway.end));
      rackFree[slot] = loading.clear;
      nextLoad = loading.end;
      const record = { unit, quality, release, arrival, putaway, loading, slot, truckSlot, handover: Infinity };
      units.push(record);
      batch.push(record);
      if (batch.length === REJECT_CARGO_SLOTS.length) dispatch(loading.end);
      return record;
    },
    finish(lastInspection) {
      if (batch.length) dispatch(lastInspection);
      return trips.at(-1)?.returned ?? 0;
    },
  };
}

export function rejectFrame(plan, time, cleared = 0) {
  const job = plan.jobs.find(({ start, end }) => start <= time && time < end);
  const local = job && time - job.start;
  const leg = job?.legs.find(({ end }) => local < end);
  const gantry = leg ? mix(leg.from, leg.to, ease((local - leg.start) / (leg.end - leg.start))) : REJECT_GANTRY_HOME;
  const carrying = job && time >= job.pickup && time < job.drop ? job.unit : null;
  const trip = plan.trips.find(({ depart, returned }) => depart <= time && time < returned);
  let truck = 'docked';
  let travel = 0;
  let truckVisible = true;
  if (trip) {
    if (time < trip.handover) {
      truck = 'departing';
      travel = ease((time - trip.depart) / (trip.handover - trip.depart));
    } else if (time < trip.returnStart) {
      truck = 'offsite';
      travel = 1;
      truckVisible = false;
    } else {
      truck = 'returning';
      travel = 1 - ease((time - trip.returnStart) / (trip.returned - trip.returnStart));
    }
  }
  const rack = [];
  const cargo = [];
  let intake = null;
  let feed = null;
  for (const record of plan.units) {
    if (record.release > time) break;
    if (record.handover <= time) continue;
    if (time < record.putaway.end) feed = record;
    if (time >= record.loading.drop) cargo.push(record);
    else if (time >= record.putaway.drop && time < record.loading.pickup) rack.push(record);
    else if (time >= record.arrival && time < record.putaway.pickup) intake = record;
  }
  return { rack, cargo, intake, feed, carrying, gantry, job, truck, truckVisible, cleared,
    truckX: mix(REJECT_TRUCK_PARK, REJECT_TRUCK_EXIT, travel)[0],
    trips: plan.trips.filter(({ handover }) => handover <= time).length };
}
