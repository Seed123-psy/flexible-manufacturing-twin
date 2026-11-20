import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Box3, Scene } from 'three';
import { buildHall } from '../src/hall.js';
import { buildControlRoom } from '../src/control-room-model.js';
import { isNightShift, shiftMinuteAt } from '../src/lighting-shift.js';
import { positions } from '../src/layout.js';
import { MOBILE_FLEET_POSES } from '../src/mobile-layout.js';
import { buildLogisticsPlatform } from '../src/logistics-platform.js';
import { createLogisticsMotion } from '../src/logistics-motion.js';
import { FILAMENT_PICKUP } from '../src/patrol-layout.js';
import { createFilamentSupply } from '../src/scene.js';
import { createSimulation, PRESETS, seekSimulation } from '../src/simulation.js';

function withCanvasStub(run) {
  const saved = globalThis.document;
  const context = new Proxy({
    createLinearGradient: () => ({ addColorStop() {} }),
    createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
  }, { get: (object, key) => object[key] ?? (() => {}) });
  globalThis.document = { createElement: () => ({ getContext: () => context }) };
  try { return run(); }
  finally {
    if (saved === undefined) delete globalThis.document;
    else globalThis.document = saved;
  }
}

test('the daylight boundary switches mounted wall lamps without cutting power to duty desks', () => withCanvasStub(() => {
  for (const [seconds, night] of [[0, false], [2399, false], [2400, true], [5279, true], [5280, false]]) {
    assert.equal(isNightShift('auto', shiftMinuteAt(seconds)), night);
  }
  const scene = new Scene();
  const hall = buildHall(scene, positions);
  const room = buildControlRoom(scene);
  const inlet = scene.getObjectByName('物料出入口 / LED 灯具');
  const diffuser = inlet.getObjectByName('LED diffuser');
  const inletBeam = inlet.getObjectByName('LED work light');
  const dutyLight = room.group.getObjectByName('监控室 / 生产席值守灯').getObjectByName('LED work light');
  assert.equal(inletBeam.visible, false);
  assert.ok(dutyLight.visible && dutyLight.intensity > 0);
  const standby = dutyLight.intensity;
  const dayGlow = diffuser.material.emissiveIntensity;
  hall.setNightLighting(true);
  room.setNightLighting(true);
  assert.ok(inletBeam.visible && inletBeam.intensity > 0);
  assert.ok(diffuser.material.emissiveIntensity > dayGlow);
  assert.ok(Math.abs(inletBeam.position.y - (diffuser.position.y - diffuser.scale.y / 2)) < 0.005);
  assert.equal(inletBeam.position.z, diffuser.position.z);
  assert.ok(dutyLight.intensity > standby);
  hall.setNightLighting(false);
  room.setNightLighting(false);
  assert.equal(inletBeam.visible, false);
  assert.equal(dutyLight.intensity, standby);
}));

test('MAT-01 clears the floor transmitter, runs the job and charges only after returning', () => withCanvasStub(() => {
  const scene = new Scene();
  const draw = createFilamentSupply(scene);
  const sim = createSimulation(PRESETS.batch);
  const job = sim.timeline.filamentDeliveries.at(-1);
  const cart = scene.getObjectByName('MAT-01');
  const dock = scene.getObjectByName('MAT-01 磁感应充电座');
  const receiver = cart.getObjectByName('MAT-01 underbody induction receiver');
  const transmitter = dock.getObjectByName('Recessed induction transmitter');
  const beams = cart.children.filter((object) => object.isSpotLight);
  assert.equal(beams.length, 2);
  cart.userData.setNightMode(true);
  seekSimulation(sim, job.pickup + (job.arrival - job.pickup) * 0.5);
  draw(sim);
  assert.equal(sim.filament.charger.charging, false);
  assert.notDeepEqual(cart.position.toArray(), FILAMENT_PICKUP);
  assert.ok(beams.every((beam) => beam.visible));
  seekSimulation(sim, job.end);
  draw(sim);
  assert.deepEqual(cart.position.toArray(), FILAMENT_PICKUP);
  assert.equal(sim.filament.charger.charging, true);
  assert.ok(beams.every((beam) => !beam.visible));
  const receiverBounds = new Box3().setFromObject(receiver);
  const transmitterBounds = new Box3().setFromObject(transmitter);
  assert.ok(receiverBounds.min.y > transmitterBounds.max.y);
  for (const axis of ['x', 'z']) {
    assert.ok(receiverBounds.min[axis] < transmitterBounds.max[axis]);
    assert.ok(receiverBounds.max[axis] > transmitterBounds.min[axis]);
  }
  const low = sim.filament.charger.battery;
  seekSimulation(sim, job.end + 1);
  assert.ok(sim.filament.charger.battery > low);
}));


test('both BOX robots physically dock and recharge at their own berth without using the central station', () => withCanvasStub(() => {
  const scene = new Scene();
  const logistics = createLogisticsMotion(scene, buildLogisticsPlatform(scene));
  const sim = createSimulation(PRESETS.batch);
  for (const role of ['primary', 'backup']) {
    const reserved = sim.timeline.mobile.intervals.find((interval) =>
      interval.fleet === 'packagingRobot' && interval.role === role && interval.kind === 'charging');
    assert.ok(reserved);
    const robot = scene.getObjectByName(reserved.agent);
    const dock = scene.getObjectByName(`${reserved.agent} 就地充电座`);
    const module = new Box3().setFromObject(dock.getObjectByName('Floor dock power module'));
    const contacts = dock.children.filter(({ name }) => name === 'Floor charging contact');
    const soleContacts = [];
    robot.traverse((object) => { if (object.name === 'Sole charging contact') soleContacts.push(object); });
    assert.equal(contacts.length, 2);
    assert.equal(soleContacts.length, 2);
    const [x, , z] = MOBILE_FLEET_POSES.packagingRobot.parking[role];
    seekSimulation(sim, reserved.start + 2);
    const power = sim.battery.fleets.packagingRobot[role];
    assert.ok(power.charging);
    assert.ok(!sim.charging.active.includes(robot.name));
    logistics.update(sim, sim.order);
    assert.equal(robot.position.x, x);
    assert.equal(robot.position.z, z);
    scene.updateMatrixWorld(true);
    for (const [index, contact] of contacts.entries()) {
      const plate = new Box3().setFromObject(contact);
      const sole = new Box3().setFromObject(soleContacts[index]);
      assert.ok(sole.min.x > plate.min.x && sole.max.x < plate.max.x);
      assert.ok(sole.min.z > plate.min.z && sole.max.z < plate.max.z);
      assert.ok(Math.abs(sole.min.y - plate.max.y) < 0.0001);
      assert.ok(!module.intersectsBox(sole));
    }
    seekSimulation(sim, reserved.start + 6);
    assert.ok(sim.battery.fleets.packagingRobot[role].battery > power.battery);
  }
}));
