import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import { inboundDock, outboundDock, outboundStop, sortPorts } from './logistics-layout.js';
import { INBOUND_AGV_HOME } from './mobile-layout.js';

const path = (points) => new CatmullRomCurve3(points.map((point) => new Vector3(...point)));

// Pass the ends of the sorter stands before turning into the pickup lanes.
const inboundAisleX = 21.83;
export const intakeDrives = sortPorts.map((port) => {
  const stop = [20.96, 0, port[2]];
  const lane = path([stop, [21.55, 0, port[2]], [inboundAisleX, 0, port[2] - 0.48],
    [inboundAisleX, 0, -0.83], [21.69, 0, -1.37], [21.43, 0, -1.45], inboundDock]);
  const approach = path([INBOUND_AGV_HOME, [20.66, 0, 0.37], [21.38, 0, 0.56],
    [21.63, 0, port[2] - 0.39], [21.39, 0, port[2]], stop]);
  return { stop, lane, approach };
});
export const returnIn = path([inboundDock, [21.63, 0, -1.45], [21.84, 0, -1.10],
  [21.73, 0, -0.26], [21.33, 0, 0.27], [20.68, 0, 0.37], INBOUND_AGV_HOME]);
// Leave the stand on its free (east) end before looping south and west.
export const outboundDrive = path([outboundDock, [30.44, 0, -1.02], [30.40, 0, -0.59],
  [30.03, 0, -0.15], [29.30, 0, -0.06], [28.14, 0, -0.06],
  [27.53, 0, 0.37], [27.50, 0, 1.53], [27.16, 0, 1.99], outboundStop]);

export function shortestTurn(from, to, p) {
  return from + Math.atan2(Math.sin(to - from), Math.cos(to - from)) * p;
}

// Sample by normalized distance along the Catmull-Rom curve.
export function followAgvDrive(curve, progress, startYaw, endYaw, reverse = false) {
  const p = MathUtils.clamp(progress, 0, 1);
  const parameter = reverse ? 1 - p : p;
  const tangent = curve.getTangentAt(parameter);
  if (reverse) tangent.negate();
  let yaw = Math.atan2(tangent.x, tangent.z);
  yaw = shortestTurn(startYaw, yaw, MathUtils.smoothstep(p, 0, 0.18));
  yaw = shortestTurn(yaw, endYaw, MathUtils.smoothstep(p, 0.82, 1));
  return { point: curve.getPointAt(parameter).toArray(), yaw, distance: curve.getLength() * parameter };
}

// Sample by elapsed fraction of a motion phase, including the renderer's easing.
export function sampleAgvDrive(curve, phaseProgress, startYaw, endYaw, reverse = false) {
  return followAgvDrive(curve, MathUtils.smoothstep(phaseProgress, 0, 1), startYaw, endYaw, reverse);
}
