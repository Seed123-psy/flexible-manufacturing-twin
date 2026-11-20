import { rejectConveyorRuns, rejectSkyRuns } from './layout.js';
import { REJECT_HANDOFF_GAP, REJECT_LIFT_DECK_SIZE } from './reject-layout.js';

// Simulation geometry, in metres. Plan coordinates are [x, z], elevations use the floor datum.
const plan = ([x, , z]) => [x, z];
const [liftA, westElbow] = rejectSkyRuns[0];
const [, eastElbow] = rejectSkyRuns[1];
const [, liftB] = rejectSkyRuns[2];
const [feedTurn, feedCrest] = rejectConveyorRuns.find(([from, to]) =>
  from[1] > 2 && to[1] === from[1] && Math.abs(to[2] - from[2]) > 2);

const chordWidth = 0.074;
const chordHeight = 0.092;
export const REJECT_BRIDGE_SECTIONS = {
  sky: { chordWidth, chordHeight, halfWidth: 0.37, topAxis: 3.113, bottomAxis: 2.89, seatTop: 3.202 },
  feed: { chordWidth, chordHeight, halfWidth: 0.37, topAxis: 2.55, bottomAxis: 2.435, seatTop: 2.695 },
};

function portal(id, section, center, posts, beamDepth) {
  const beamTop = REJECT_BRIDGE_SECTIONS[section].bottomAxis - chordHeight / 2 + 0.008;
  const feet = posts.map((point, i) => ({ id: `${id}.${i + 1}`, center: point, size: [0.44, 0.44] }));
  const baseClearWidth = Math.hypot(posts[0][0] - posts[1][0], posts[0][1] - posts[1][1]) - feet[0].size[0];
  return { id, type: 'freestanding-portal', section, center, posts, feet, baseClearWidth,
    beamTop, soffit: beamTop - beamDepth, postSize: [0.19, 0.19] };
}

const portalFeed = portal('RJ-P01', 'feed', [feedTurn[0], 0.98], [[9.47, 0.98], [12.35, 0.98]], 0.146);
const portalWest = portal('RJ-P02', 'sky', [15.00, westElbow[2]], [[15.00, 5.63], [15.00, 8.77]], 0.204);
const portalEast = portal('RJ-P03', 'sky', [19.60, eastElbow[2]], [[19.60, 5.14], [19.60, 9.39]], 0.204);
const portals = [portalFeed, portalWest, portalEast];

const liftInset = REJECT_LIFT_DECK_SIZE / 2 + REJECT_HANDOFF_GAP + 0.035;
const liftBearingElevation = REJECT_BRIDGE_SECTIONS.sky.topAxis + chordHeight / 2;
const liftBearings = [
  { id: 'RJ-L01', type: 'existing-lift-frame', center: [liftA[0], liftA[2] + liftInset], elevation: liftBearingElevation },
  { id: 'RJ-L02', type: 'existing-lift-frame', center: [liftB[0], liftB[2] - liftInset], elevation: liftBearingElevation },
];

const span = (id, section, from, to, bearingIds) => {
  const profile = REJECT_BRIDGE_SECTIONS[section];
  return { id, section, from, to, bearingIds,
    length: Math.hypot(to[0] - from[0], to[1] - from[1]),
    width: 2 * profile.halfWidth + profile.chordWidth,
    soffit: profile.bottomAxis - profile.chordHeight / 2 };
};

const spans = [
  span('RJ-F01a', 'feed', [feedTurn[0], feedTurn[2] + 0.445], portalFeed.center, ['RJ-T01', portalFeed.id]),
  span('RJ-F01b', 'feed', portalFeed.center, [feedCrest[0], feedCrest[2] - 0.20], [portalFeed.id, 'RJ-T02']),
  span('RJ-S01', 'sky', liftBearings[0].center, plan(westElbow), [liftBearings[0].id, 'RJ-E01']),
  span('RJ-S02a', 'sky', plan(westElbow), portalWest.center, ['RJ-E01', portalWest.id]),
  span('RJ-S02b', 'sky', portalWest.center, portalEast.center, [portalWest.id, portalEast.id]),
  span('RJ-S02c', 'sky', portalEast.center, plan(eastElbow), [portalEast.id, 'RJ-E02']),
  span('RJ-S03', 'sky', plan(eastElbow), liftBearings[1].center, ['RJ-E02', liftBearings[1].id]),
];

const elbows = [westElbow, eastElbow].map((point, i) => ({
  id: `RJ-E0${i + 1}`, center: plan(point), size: [0.93, 0.93], soffit: 2.779,
}));

export const REJECT_BRIDGE_LAYOUT = {
  id: 'RJ-BRIDGE',
  units: 'm',
  status: 'simulation geometry',
  portals,
  spans,
  elbows,
  liftBearings,
  feedConnections: [
    { id: 'RJ-T01', center: spans[0].from, type: 'existing-turntable-trestle' },
    { id: 'RJ-T02', center: spans[1].to, type: 'cantilever-end-seat' },
  ],
  footprint: portals.flatMap(({ feet }) => feet),
};
