import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildBuildingEnvelope } from './building-envelope.js';
import { buildControlRoom } from './control-room-model.js';
import { buildEngineeringScene } from './engineering-scene.js';
import { buildConveyors, makePallet } from './conveyors.js';
import { FILAMENT_COLORS, FILAMENT_DOCK, FILAMENT_STOCK_PER_COLOR, filamentExchangeAt, filamentPickupAt } from './filament-exchange.js';
import { buildHall, buildLights } from './hall.js';
import { conveyorMaterialPose, conveyorParcelPosition, getMaterialTravel, palletHeight, positions, printerIds, productionLines, rejectMaterialPose } from './layout.js';
import { REJECT_CARGO_SLOTS, REJECT_LIFTS, REJECT_LINK_HEIGHT, REJECT_RACK_SLOTS, REJECT_TRUCK_PARK } from './reject-layout.js';
import { logisticsCenter } from './logistics-layout.js';
import { createLogisticsMotion } from './logistics-motion.js';
import { buildLogisticsPlatform } from './logistics-platform.js';
import { makeCarton, makeFilamentSpool, makeFilamentWarehouse, makeProduct, makeStation } from './models.js';
import { makeAgv, makeFilamentChargingDock } from './mobile-robots.js';
import { FILAMENT_DELIVERY_ROUTES, FILAMENT_PICKUP, FILAMENT_WAREHOUSE_CENTER } from './patrol-layout.js';
import { STATIONS } from './simulation.js';

const labelHeight = {
  design: 2.55, print1: 3.0, print2: 3.0, print3: 3.0,
  quality: 2.14, boxes: 2.65, robot: 3.2, buffer: 2.18, presort: 2.35, scan: 2.45,
  sort: 2.15, reject: 3.85, exception: 2.35, staging: 2.10, storage: 5.10, dispatch: 2.40,
};
const logisticsHits = {
  reject: [5.10, 2.2, 3.15],
  presort: [3.6, 1.7, 2.0],
  scan: [3.6, 1.9, 2.0],
  exception: [3.0, 1.7, 2.2],
  sort: [3.6, 1.7, 2.9],
  staging: [3.6, 1.5, 2.0],
  storage: [8.2, 4.8, 1.6],
  dispatch: [3.3, 1.85, 2.9],
};
const invisibleHitMaterial = new THREE.MeshBasicMaterial({ visible: false });
const idleFrame = { active: false, action: '待机', motion: 'idle', progress: 0, phaseProgress: 0 };
const CYAN = 0x75d8d9;
const rejectTagGeometry = new THREE.BoxGeometry(0.17, 0.042, 0.075);
const rejectTagMaterial = new THREE.MeshStandardMaterial({ color: 0xe14f41, emissive: 0x77231e, emissiveIntensity: 0.55 });

function unlit(color, opacity = 1) {
  return new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity === 1 });
}

function line(parent, points, color, opacity = 1) {
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({ color, opacity, transparent: opacity < 1 });
  const result = new THREE.Line(geometry, material);
  parent.add(result);
  return result;
}

function makeHalo() {
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.47, 1.5, 56), unlit(CYAN, 0.72));
  ring.rotation.x = -Math.PI/2;
  ring.position.y = 0.017;
  ring.visible = false;
  return ring;
}

function makeRejectPallet(order) {
  const pallet = makePallet();
  const product = makeProduct(order);
  product.position.y = palletHeight;
  const tag = new THREE.Mesh(rejectTagGeometry, rejectTagMaterial);
  tag.position.set(0.22, palletHeight + 0.024, 0.18);
  pallet.add(product, tag);
  return { pallet, product };
}

function createRejectMotion(cell) {
  const pieces = new Map();
  let previousOrder;
  return (sim) => {
    const { order, time, logistics } = sim ?? {};
    if (previousOrder !== order) {
      for (const { pallet, product } of pieces.values()) {
        pallet.removeFromParent();
        product.userData.dispose();
      }
      pieces.clear();
      previousOrder = order;
    }
    const frame = logistics?.rejects;
    const live = new Set();
    const place = (unit, parent, position) => {
      live.add(unit);
      if (!pieces.has(unit)) pieces.set(unit, makeRejectPallet(order));
      const { pallet } = pieces.get(unit);
      if (pallet.parent !== parent) parent.add(pallet);
      pallet.position.set(...position);
    };
    for (const { unit, slot } of frame?.rack ?? []) place(unit, cell.stock, REJECT_RACK_SLOTS[slot]);
    for (const { unit, truckSlot } of frame?.cargo ?? []) {
      place(unit, cell.cargo, REJECT_CARGO_SLOTS[truckSlot].map((v, i) => v - REJECT_TRUCK_PARK[i]));
    }
    if (frame?.intake) place(frame.intake.unit, cell.intake, [0, 0, 0]);
    if (frame?.carrying) place(frame.carrying, cell.held, [0, 0, 0]);
    for (const [unit, { pallet, product }] of pieces) {
      if (live.has(unit)) continue;
      pallet.removeFromParent();
      product.userData.dispose();
      pieces.delete(unit);
    }

    const heights = REJECT_LIFTS.map(([, y], index) => index === 0 ? y : REJECT_LINK_HEIGHT);
    const feed = frame?.feed;
    if (feed && time < feed.arrival) {
      const { steps, length } = getMaterialTravel(feed.quality, 'reject');
      const distance = Math.min(length, Math.max(0, (time - feed.release) / (feed.arrival - feed.release) * length));
      steps.filter(({ vertical }) => vertical).forEach((lift, index) => {
        const { offset, distance: span } = lift;
        const phase = THREE.MathUtils.clamp((distance - offset) / span, 0, 1);
        const exit = steps[steps.indexOf(lift) + 1]?.distance ?? 0;
        const reset = THREE.MathUtils.clamp((distance - offset - span - exit - 0.40) / span, 0, 1);
        heights[index] = THREE.MathUtils.lerp(lift.start[1], lift.end[1], phase - reset);
      });
    } else if (feed) {
      const reset = THREE.MathUtils.clamp((time - feed.arrival) * 0.52, 0, 1);
      heights[1] = THREE.MathUtils.lerp(REJECT_LIFTS[1][1], REJECT_LINK_HEIGHT, reset);
    }
    cell.update(frame, heights);
  };
}

function transferObject(transfer, order) {
  const group = new THREE.Group();

  if (transfer.kind === 'data') {
    const from = positions[transfer.from];
    const to = positions[transfer.to];
    const points = [
      [from[0] + 0.72, 1.62, from[2] + 0.06],
      [from[0] + 0.72, 0.19, from[2] - 1.91],
      [to[0], 0.19, -0.85],
      [to[0], 1.66, to[2] + 0.5],
    ];
    const path = new THREE.CatmullRomCurve3(points.map((point) => new THREE.Vector3(...point)));
    const signal = new THREE.Mesh(new THREE.SphereGeometry(0.068, 12, 8), unlit(0xa6fff2));
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.126, 12, 8), unlit(CYAN, 0.19));
    const route = line(group, path.getPoints(40), CYAN, 0.54);
    signal.add(glow);
    group.add(signal);
    return {
      group,
      move(progress) { path.getPointAt(progress, signal.position); },
      dispose() {
        for (const part of [route, signal, glow]) {
          part.geometry.dispose();
          part.material.dispose();
        }
      },
    };
  }

  group.rotation.order = 'YXZ';
  let product;
  if (transfer.kind === 'reject') {
    const part = makeRejectPallet(order);
    product = part.product;
    group.add(part.pallet);
  } else if (transfer.kind === 'product') {
    const pallet = makePallet();
    product = makeProduct(order);
    product.position.y = palletHeight;
    pallet.add(product);
    group.add(pallet);

  } else {
    group.add(makeCarton(order));
  }
  return {
    group,
    move(progress) {
      if (transfer.kind === 'reject') {
        const { position, yaw, pitch } = rejectMaterialPose(transfer.from, progress);
        group.position.set(...position);
        group.rotation.set(0, yaw, pitch);
        return;
      }
      const { position, yaw } = conveyorMaterialPose(transfer.from, transfer.to, transfer.kind, progress);
      group.position.set(...position);
      group.rotation.y = yaw;
    },
    dispose() { product?.userData.dispose(); },
  };
}

export function createFilamentSupply(scene) {
  const warehouse = makeFilamentWarehouse();
  warehouse.group.position.set(...FILAMENT_WAREHOUSE_CENTER);
  const cart = makeAgv({ id: 'MAT-01', induction: true });
  const chargingDock = makeFilamentChargingDock();
  // The narrow material runner fits the dedicated service aisle at the back of the printers.
  cart.group.scale.setScalar(0.58);
  const reel = makeFilamentSpool();
  const paths = Object.fromEntries(Object.entries(FILAMENT_DELIVERY_ROUTES).map(([id, points]) => {
    let length = 0;
    const spans = points.slice(1).map((to, index) => {
      const from = points[index];
      const run = Math.hypot(to[0] - from[0], to[2] - from[2]);
      const span = { from, to, offset: length, run };
      length += run;
      return span;
    });
    return [id, { spans, length }];
  }));
  scene.add(warehouse.group, cart.group, chargingDock.group, reel);
  const initialStock = FILAMENT_COLORS.map(() => FILAMENT_STOCK_PER_COLOR);
  return (sim) => {
    const job = sim?.filament.delivery;
    const picking = job?.phase === 'pickup';
    const recovering = job?.phase === 'recover';
    warehouse.update(sim?.filament.stockByColor ?? initialStock, picking ? job : null);
    let point = FILAMENT_PICKUP;
    let distance = 0;
    let yaw = Math.PI / 2;
    if (job) {
      const { phase, phaseProgress } = job;
      const { spans, length } = paths[job.station];
      const returnTrip = phase === 'return';
      const progress = picking || recovering ? 0 : phase === 'install' ? 1 : returnTrip ? 1 - phaseProgress : phaseProgress;
      distance = progress * length;
      const span = spans.find(({ offset, run }) => distance < offset + run) ?? spans.at(-1);
      const fraction = (distance - span.offset) / span.run;
      point = span.from.map((value, axis) => THREE.MathUtils.lerp(value, span.to[axis], fraction));
      yaw = Math.atan2(span.to[0] - span.from[0], span.to[2] - span.from[2]) + (returnTrip ? Math.PI : 0);
    }
    cart.group.position.set(...point);
    cart.group.rotation.y = yaw;
    const exchange = job?.phase === 'install' ? filamentExchangeAt(job.phaseProgress, job.slot) : null;
    const carryingOld = job?.phase === 'return' || exchange?.oldCart;
    const carryingNew = job?.phase === 'delivery' || (exchange && !exchange.freshTool && !exchange.freshBay);
    const loaded = Boolean(carryingNew || carryingOld);
    const charger = sim?.filament.charger;
    chargingDock.update(charger);
    cart.pose({ time: sim?.time ?? 0, deckHeight: 0.38, loaded,
      charging: charger?.charging, battery: charger?.battery,
      moving: job?.phase === 'delivery' || job?.phase === 'return', distance });
    reel.visible = loaded || picking || recovering;
    reel.position.set(point[0], FILAMENT_DOCK.y, point[2]);
    // The cradle and both dock tools keep the reel axle aligned with the rack's X axis.
    reel.rotation.y = 0;
    if (picking) {
      const { x, y, z } = filamentPickupAt(job.phaseProgress, job.slot);
      reel.position.set(FILAMENT_WAREHOUSE_CENTER[0] + x, y, FILAMENT_WAREHOUSE_CENTER[2] + z);
    } else if (recovering) {
      const p = job.phaseProgress;
      const ease = p * p * (3 - 2 * p);
      reel.position.set(THREE.MathUtils.lerp(point[0], FILAMENT_WAREHOUSE_CENTER[0] - 0.64, ease),
        FILAMENT_DOCK.y + 0.35 * Math.sin(Math.PI * p) + 0.10 * ease,
        THREE.MathUtils.lerp(point[2], FILAMENT_WAREHOUSE_CENTER[2] + 0.69, ease));
    }
    if (reel.visible) {
      reel.userData.setTint(FILAMENT_COLORS[job.slot].tint);
      reel.userData.setRemaining(carryingOld || recovering ? job.oldGrams / sim.filament.spoolGrams : 1);
    }
  };
}

export function mountFactory(container, onSelect, { onControlRoom, onScreen, onDesignPlatform, capture = false } = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x252e39);
  scene.fog = new THREE.FogExp2(0x252e39, 0.012);
  const overviewFov = 35;
  const camera = new THREE.PerspectiveCamera(overviewFov, 1, capture ? 0.58 : 0.12, capture ? 128 : 160);
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: capture });
  renderer.domElement.className = 'factory-canvas';
  renderer.domElement.setAttribute('aria-label', '可旋转的 3D 数字孪生车间');
  renderer.localClippingEnabled = true;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.setPixelRatio(capture ? 1 : Math.min(window.devicePixelRatio, 1.65));
  container.prepend(renderer.domElement);
  const hall = buildHall(scene, positions);
  const envelope = buildBuildingEnvelope(scene);
  const controlRoom = buildControlRoom(scene);
  const engineering = buildEngineeringScene(scene);
  const setNightLighting = buildLights(scene, { capture });
  let nightShift = false;
  const conveyors = buildConveyors(scene);
  const platform = buildLogisticsPlatform(scene);
  const logistics = createLogisticsMotion(scene, platform);
  const updateRejectMotion = createRejectMotion(platform.rejectCell);
  const updateFilamentSupply = createFilamentSupply(scene);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.085;
  controls.minDistance = 3.2;
  controls.maxDistance = 106;
  controls.maxPolarAngle = Math.PI * 0.485;
  controls.target.set(0, 0.65, 0);
  let fly;
  let inControlRoom = false;
  let roomFrameRendered = false;
  let needsRender = true;
  let lastRenderedSim;
  let lastRenderedTime;
  let pointerStart;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const screenCenter = new THREE.Vector3();
  const screenUpper = new THREE.Vector3();
  const screenLower = new THREE.Vector3();
  const screenFrame = () => {
    const target = new THREE.Vector3(...controlRoom.cameraTarget);
    const position = new THREE.Vector3(...controlRoom.cameraPosition);
    const distance = position.distanceTo(target);
    // Widen the lens instead of dollying out into the active collection lane.
    const tangent = Math.max(controlRoom.height / (1.52 * distance), controlRoom.width / (1.78 * distance * camera.aspect));
    return { target, position, fov: Math.min(94, THREE.MathUtils.radToDeg(2 * Math.atan(tangent))) };
  };
  const overview = () => {
    const factor = Math.max(0.93, 1.62 / Math.max(0.84, camera.aspect));
    const target = new THREE.Vector3(9.05, 0.74, 0.15);
    const position = new THREE.Vector3(7.0, 25.2, 37.0).multiplyScalar(factor).add(target);
    return { target, position };
  };
  let focused = null;
  function fit() {
    needsRender = true;
    roomFrameRendered = false;
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    if (inControlRoom) {
      const frame = screenFrame();
      if (fly) fly = frame;
      else {
        camera.position.copy(frame.position);
        controls.target.copy(frame.target);
        camera.fov = frame.fov;
        camera.updateProjectionMatrix();
      }
    }
  }
  fit();
  const initial = overview();
  camera.position.copy(initial.position);
  controls.target.copy(initial.target);
  controls.update();
  renderer.domElement.addEventListener('webglcontextrestored', () => {
    needsRender = true;
    roomFrameRendered = false;
  });
  const observer = new ResizeObserver(fit);
  observer.observe(container);

  const labels = document.createElement('div');
  labels.className = 'factory-labels';
  container.append(labels);
  const roomBadge = document.createElement('button');
  roomBadge.type = 'button';
  roomBadge.className = 'world-label control-room-marker';
  roomBadge.hidden = true;
  roomBadge.innerHTML = '<i aria-hidden="true"></i><span>监控室 ↗</span>';
  roomBadge.addEventListener('click', () => onControlRoom?.());
  labels.append(roomBadge);
  const devices = {};
  const hitObjects = [];
  // Glass remains clickable through; the opaque office shell and furniture do not.
  const officeOccluders = hall.designOffice.children.filter((object) => object.isMesh && !object.material.transparent);
  for (const [id, location] of Object.entries(positions)) {
    const dimensions = logisticsHits[id];
    const device = dimensions ? null : makeStation(id);
    const subject = device?.group ?? new THREE.Mesh(new THREE.BoxGeometry(...dimensions), invisibleHitMaterial);
    subject.position.set(...location);
    if (dimensions) subject.position.y = dimensions[1] / 2;
    subject.userData.station = id;
    scene.add(subject);
    hitObjects.push(subject);
    const halo = makeHalo();
    if (id === 'boxes') halo.scale.set(1.5, 1, 1);
    halo.position.x = location[0];
    halo.position.z = location[2];
    scene.add(halo);
    const badge = document.createElement('button');
    badge.type = 'button';
    badge.className = 'world-label';
    badge.setAttribute('aria-label', STATIONS[id].name);
    badge.innerHTML = '<i></i><span></span>';
    badge.querySelector('span').textContent = STATIONS[id].shortName;
    badge.addEventListener('click', () => onSelect(id));
    labels.append(badge);
    devices[id] = { ...device, halo, badge, labelPosition: new THREE.Vector3(location[0], labelHeight[id], location[2]) };
  }

  const cursor = new THREE.Vector2();
  const projection = new THREE.Vector3();
  const raycaster = new THREE.Raycaster();
  const transfers = new Map();
  let lastTransportTime = 0;
  let selected = 'design';
  controls.addEventListener('start', () => { if (!inControlRoom) fly = undefined; });
  const canvas = renderer.domElement;
  const designScreens = devices.design.screens;
  const setDesignHover = (hover) => canvas.classList.toggle('is-design-screen', hover);
  function pointAt(event) {
    const rect = canvas.getBoundingClientRect();
    cursor.set((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2);
    raycaster.setFromCamera(cursor, camera);
  }
  function isDesignScreen(hit) {
    return Boolean(onDesignPlatform && hit && designScreens.includes(hit.object) &&
      !raycaster.intersectObjects(officeOccluders, false).some(({ distance }) => distance < hit.distance));
  }
  const moved = (event, start) => Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5;
  canvas.addEventListener('pointerdown', (event) => {
    if (event.isPrimary && event.button === 0) pointerStart = { id: event.pointerId, x: event.clientX, y: event.clientY };
    setDesignHover(false);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (pointerStart?.id === event.pointerId && moved(event, pointerStart)) pointerStart = undefined;
    if (!onDesignPlatform || inControlRoom || event.buttons || event.pointerType === 'touch') return;
    pointAt(event);
    const [screenHit] = raycaster.intersectObjects(designScreens, false);
    const [hit] = screenHit ? raycaster.intersectObjects(hitObjects) : [];
    setDesignHover(isDesignScreen(hit));
  });
  const clearPointer = () => { pointerStart = undefined; setDesignHover(false); };
  canvas.addEventListener('pointerleave', clearPointer);
  canvas.addEventListener('pointercancel', clearPointer);
  canvas.addEventListener('pointerup', (event) => {
    const start = pointerStart;
    if (start?.id !== event.pointerId) return;
    pointerStart = undefined;
    if (inControlRoom || event.button !== 0 || moved(event, start)) return;
    pointAt(event);
    const [roomHit] = raycaster.intersectObject(controlRoom.screen);
    const [hit] = raycaster.intersectObjects(hitObjects);
    if (roomHit && (!hit || roomHit.distance < hit.distance)) {
      onControlRoom?.();
      return;
    }
    if (isDesignScreen(hit)) {
      if (event.pointerType !== 'touch') setDesignHover(true);
      onDesignPlatform();
      return;
    }
    if (!hit) return;
    let current = hit.object;
    while (current && !current.userData.station) current = current.parent;
    if (current?.userData.station) onSelect(current.userData.station);
  });

  const lineStations = Object.fromEntries(productionLines.map(({ key, printers, quality, boxes, robot, buffer }) =>
    [key, new Set([...printers, quality, boxes, robot, buffer])]));
  const regionViews = {
    production: { target: [0, 0.78, 4.15], offset: [7.5, 21.5, 27.5] },
    ...Object.fromEntries(productionLines.map(({ key, quality }) => [key, {
      target: [1.45, 0.78, positions[quality][2] + 3.25], offset: [2.7, 13.3, 20.2],
    }])),
    logistics: { target: logisticsCenter, offset: [4.9, 9.2, 15.2] },
  };

  function enterControlRoom() {
    clearPointer();
    roomFrameRendered = false;
    inControlRoom = true;
    focused = 'control-room';
    controls.enabled = false;
    controls.maxPolarAngle = Math.PI / 2;
    fly = screenFrame();
  }

  function releaseControlRoomCamera() {
    if (!inControlRoom) return;
    inControlRoom = false;
    fly = undefined;
    controls.enabled = true;
    controls.maxPolarAngle = Math.PI * 0.485;
  }

  function projectScreen() {
    const { screen, width, height } = controlRoom;
    if (!inControlRoom || fly) return;
    const a = screen.localToWorld(screenUpper.set(-width / 2, height / 2, 0)).project(camera);
    const b = screen.localToWorld(screenLower.set(width / 2, -height / 2, 0)).project(camera);
    const w = container.clientWidth;
    const h = container.clientHeight;
    onScreen?.({ left: (1 + a.x) * w / 2, top: (1 - a.y) * h / 2, width: (b.x - a.x) * w / 2, height: (a.y - b.y) * h / 2 });
  }

  function focus(id) {
    const region = regionViews[id];
    if (!region && !positions[id]) return;
    setDesignHover(false);
    releaseControlRoomCamera();
    if (region) {
      const target = new THREE.Vector3(...region.target);
      const offset = new THREE.Vector3(...region.offset);
      offset.multiplyScalar(Math.max(1, 1.3 / Math.max(0.7, camera.aspect)));
      focused = id;
      fly = { target, position: offset.add(target) };
      return;
    }
    selected = id;
    focused = id;
    const target = new THREE.Vector3(...positions[id]);
    const printer = printerIds.includes(id);
    const design = id === 'design';
    target.y += design ? 1.35 : printer ? 1.25 : 1.09;
    target.z += printer ? 0.38 : 0.16;
    const logisticsOffsets = { reject: [8.8, 6.4, 10.8], sort: [3.5, 4.4, 5.8], storage: [4.5, 3.6, 6.5], dispatch: [-4.2, 2.9, -3.3] };
    if (id === 'storage') target.z += 0.66;
    if (id === 'dispatch') target.z += 0.42;
    if (id === 'reject') target.z += 1.46;
    const offset = logisticsOffsets[id] ?? (design ? [0.62, 0.96, 4.35] : printer ? [2.62, 2.26, 4.76] : [3.35, 2.76, 5.55]);
    fly = {
      target,
      position: new THREE.Vector3(...offset).multiplyScalar(camera.aspect < 1.1 ? 1.27 : 1).add(target),
    };
  }

  function focusSupply(id) {
    if (!printerIds.includes(id)) return;
    releaseControlRoomCamera();
    selected = id;
    focused = id;
    const target = new THREE.Vector3(...positions[id]);
    target.y += 1.57;
    target.z -= 1.28;
    const offset = new THREE.Vector3(2.05, 1.65, -4.85).multiplyScalar(camera.aspect < 1.1 ? 1.25 : 1);
    fly = { target, position: offset.add(target) };
  }

  function focusFilamentWarehouse() {
    releaseControlRoomCamera();
    focused = 'filamentWarehouse';
    const target = new THREE.Vector3(...FILAMENT_WAREHOUSE_CENTER).add(new THREE.Vector3(0.25, 0.9, 0.55));
    fly = { target, position: target.clone().add(new THREE.Vector3(2.9, 1.45, 3.8)) };
  }

  function reset() {
    setDesignHover(false);
    releaseControlRoomCamera();
    focused = null;
    fly = overview();
  }

  function drawTransfers(sim) {
    const existing = new Set();
    let materialMoving = false;
    function getObject(key, create) {
      existing.add(key);
      if (!transfers.has(key)) {
        const object = create();
        transfers.set(key, object);
        scene.add(object.group);
      }
      return transfers.get(key);
    }
    function placeParcel(unit, position) {
      const parcel = getObject(`parcel-${unit}`, () => {
        const group = makeCarton(sim.order, true);
        group.name = `Conveyor parcel #${unit}`;
        return { group, dispose() {} };
      });
      parcel.group.position.set(...position);
    }
    for (const id of ['buffer', 'buffer2', 'presort', 'scan', 'exception']) {
      const frame = sim?.stations[id];
      const position = conveyorParcelPosition(id, frame);
      if (position) placeParcel(frame.unit, position);
      if (frame?.motion === 'buffer') materialMoving = true;
    }
    for (const transfer of sim?.transfers ?? []) {
      if (transfer.kind === 'parcel') {
        const { position } = conveyorMaterialPose(transfer.from, transfer.to, transfer.kind, transfer.progress);
        placeParcel(transfer.unit, position);
      } else {
        const key = [transfer.kind, transfer.unit, transfer.from, transfer.to].join('-');
        getObject(key, () => transferObject(transfer, sim.order)).move(transfer.progress);
      }
      if (transfer.kind !== 'data') materialMoving = true;
    }
    for (const [key, object] of transfers) {
      if (existing.has(key)) continue;
      scene.remove(object.group);
      object.dispose();
      transfers.delete(key);
    }
    const time = sim?.time ?? 0;
    if (materialMoving && time > lastTransportTime) conveyors.advance(time - lastTransportTime);
    lastTransportTime = time;
  }

  function draw(sim, order, dt) {
    // Once docked, the room camera faces a static interior wall. The HTML screen
    // and the simulation keep running without repainting the entire 3D factory.
    if (inControlRoom && roomFrameRendered && !fly) return;
    const wasFlying = Boolean(fly);
    if (fly) {
      const ease = reducedMotion.matches ? 1 : 1 - Math.exp(-dt * 8);
      camera.position.lerp(fly.position, ease);
      controls.target.lerp(fly.target, ease);
      const fov = fly.fov ?? overviewFov;
      camera.fov = THREE.MathUtils.lerp(camera.fov, fov, ease);
      if (camera.position.distanceTo(fly.position) < 0.018 && controls.target.distanceTo(fly.target) < 0.018) {
        camera.position.copy(fly.position);
        controls.target.copy(fly.target);
        camera.fov = fov;
        fly = undefined;
      }
      camera.updateProjectionMatrix();
    }
    const orbitChanged = controls.update();
    if (!wasFlying && !orbitChanged && !needsRender && sim === lastRenderedSim && sim?.time === lastRenderedTime) return;
    needsRender = false;
    lastRenderedSim = sim;
    lastRenderedTime = sim?.time;
    camera.updateMatrixWorld();
    projectScreen();
    controlRoom.screen.getWorldPosition(screenCenter);
    screenCenter.y += controlRoom.height / 2 + 0.85;
    screenCenter.project(camera);
    roomBadge.hidden = Boolean(focused) || Math.abs(screenCenter.x) > 0.96 || Math.abs(screenCenter.y) > 0.95 || screenCenter.z > 1;
    if (!roomBadge.hidden) {
      roomBadge.style.left = `${(screenCenter.x + 1) * 50}%`;
      roomBadge.style.top = `${(1 - screenCenter.y) * 50}%`;
    }
    hall?.update?.(sim);
    envelope.update(camera.position, controls.target, inControlRoom, sim);
    for (const [id, device] of Object.entries(devices)) {
      const frame = sim?.stations[id] ?? idleFrame;
      const filamentJob = sim?.filament.delivery;
      device.update?.({ ...frame, filamentSlot: filamentJob?.station === id ? filamentJob.slot : undefined,
        filamentRemaining: sim?.filament.printers[id],
        filamentState: sim?.filament.supply[id]?.state, time: sim?.time ?? 0, order });
      device.halo.visible = frame.active || (focused === id);
      device.halo.material.opacity = frame.active ? (capture ? 0.35 : 0.48 + Math.sin((sim?.time ?? 0) * 4) * 0.22) : 0.34;
      projection.copy(device.labelPosition).project(camera);
      const included = focused === 'logistics' ? Boolean(logisticsHits[id])
        : focused === 'production' ? !logisticsHits[id] && id !== 'design'
        : lineStations[focused]?.has(id) ?? focused === id;
      device.badge.hidden = !included || Math.abs(projection.x) > 0.94 || Math.abs(projection.y) > 0.9 || projection.z > 1;
      if (!device.badge.hidden) {
        device.badge.style.left = `${(projection.x+1)*50}%`;
        device.badge.style.top = `${(1-projection.y)*50}%`;
      }
      device.badge.classList.toggle('is-active', frame.active);
      device.badge.classList.toggle('is-picked', selected === id);
    }
    logistics.update(sim, order);
    platform.setSupportStock(sim?.packaging.warehouseStock);
    updateRejectMotion(sim);
    updateFilamentSupply(sim);
    drawTransfers(sim);
    renderer.render(scene, camera);
    roomFrameRendered = inControlRoom && !fly;
  }

  function setLightingShift(night) {
    if (night === nightShift) return;
    nightShift = night;
    setNightLighting(night);
    hall.setNightLighting(night);
    envelope.setNightLighting(night);
    controlRoom.setNightLighting(night);
    const sky = night ? 0x101c30 : 0x252e39;
    scene.background.setHex(sky);
    scene.fog.color.setHex(sky);
    scene.fog.density = night ? 0.016 : 0.012;
    renderer.toneMappingExposure = night ? 1.0 : 1.08;
    // Refresh the factory even with a paused sim, and repaint the docked room once.
    needsRender = true;
    roomFrameRendered = false;
  }

  function setEngineeringMarkings(visible) {
    engineering.userData.markings.visible = visible;
    needsRender = true;
  }

  const setCaptureCamera = capture ? ({ position, target, fov = overviewFov, room = false }) => {
    if (!room) releaseControlRoomCamera();
    inControlRoom = room;
    roomFrameRendered = false;
    needsRender = true;
    fly = undefined;
    controls.maxPolarAngle = Math.PI;
    camera.position.fromArray(position);
    controls.target.fromArray(target);
    camera.fov = fov;
    camera.updateProjectionMatrix();
  } : undefined;
  return { draw, focus, focusSupply, focusFilamentWarehouse, reset, enterControlRoom, setEngineeringMarkings, setCaptureCamera, setLightingShift };
}

export function mountProductPreview(container) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.05, 20);
  camera.position.set(1.02, 0.9, 2.75);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.domElement.className = 'preview-canvas';
  renderer.domElement.setAttribute('aria-label', '可旋转的玩偶模型');
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.65));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  container.prepend(renderer.domElement);
  scene.add(new THREE.HemisphereLight(0xd7f7ff, 0x59718a, 2.2));
  const light = new THREE.DirectionalLight(0xf4fbff, 3.6);
  light.position.set(-2, 4, 4);
  scene.add(light);
  const grid = new THREE.GridHelper(3.8, 19, 0x345674, 0x284259);
  grid.position.y = -0.021;
  grid.material.transparent = true;
  grid.material.opacity = 0.65;
  scene.add(grid);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = 0.3;
  controls.maxDistance = 6;
  controls.maxPolarAngle = Math.PI*0.49;
  controls.target.set(0, 0.26, 0);
  let product;
  let renderedWidth = 0;
  let renderedHeight = 0;
  function setOrder(order) {
    const previousHeight = product?.userData.size.height;
    if (product) {
      scene.remove(product);
      product.userData.dispose?.();
    }
    product = makeProduct(order);
    scene.add(product);
    const { height } = product.userData.size;
    const offset = camera.position.clone().sub(controls.target);
    const distance = previousHeight ? offset.length() * height / previousHeight : height * 2.85;
    offset.setLength(THREE.MathUtils.clamp(distance, controls.minDistance, controls.maxDistance));
    controls.target.set(0, height * 0.47, 0);
    camera.position.copy(controls.target).add(offset);
  }
  function draw() {
    const { clientWidth: width, clientHeight: height } = container;
    if (!width || !height) return;
    if (renderedWidth !== width || renderedHeight !== height) {
      renderedWidth = width;
      renderedHeight = height;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    }
    controls.update();
    renderer.render(scene, camera);
  }
  return { draw, setOrder };
}
