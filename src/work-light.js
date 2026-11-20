import * as THREE from 'three';

const cube = new THREE.BoxGeometry(1, 1, 1);
const aluminum = new THREE.MeshStandardMaterial({ color: 0x8c9ca7, roughness: 0.53, metalness: 0.35 });
const graphite = new THREE.MeshStandardMaterial({ color: 0x263643, roughness: 0.62, metalness: 0.25 });

function part(parent, material, size, position) {
  const mesh = new THREE.Mesh(cube, material);
  mesh.scale.set(...size);
  mesh.position.set(...position);
  parent.add(mesh);
  return mesh;
}

// Local +Z faces the work area, with the backplate on the mounting surface.
export function mountLinearLight(parent, { name, position, yaw = 0, width = 1.64,
  color = 0xffedd7, strength = 125, standby = 0, distance = 14, aim = [0, -3.1, 2.8] }) {
  const fixture = new THREE.Group();
  fixture.name = name;
  fixture.position.set(...position);
  fixture.rotation.y = yaw;
  parent.add(fixture);
  const lens = new THREE.MeshStandardMaterial({ color: 0xc9d4da, emissive: color, roughness: 0.47 });
  for (const x of [-0.37 * width, 0.37 * width]) {
    part(fixture, aluminum, [0.11, 0.20, 0.042], [x, 0.017, 0.005]);
    part(fixture, graphite, [0.082, 0.075, 0.22], [x, -0.016, 0.11]);
    for (const y of [-0.048, 0.078]) part(fixture, graphite, [0.024, 0.024, 0.015], [x, y, 0.032]);
  }
  part(fixture, aluminum, [width, 0.095, 0.21], [0, -0.019, 0.20]);
  part(fixture, graphite, [width - 0.062, 0.039, 0.177], [0, -0.071, 0.204]);
  const diffuser = part(fixture, lens, [width - 0.105, 0.023, 0.145], [0, -0.088, 0.209]);
  diffuser.name = 'LED diffuser';
  // A narrow front reveal makes the status of the light legible from the cutaway camera.
  const reveal = new THREE.MeshStandardMaterial({ color: 0x8d9aa3, emissive: color, roughness: 0.4 });
  part(fixture, reveal, [width - 0.18, 0.017, 0.013], [0, -0.048, 0.307]);
  const light = new THREE.SpotLight(color, strength, distance, Math.PI * 0.32, 0.78, 2);
  light.name = 'LED work light';
  light.position.set(0, -0.101, 0.209);
  light.target.position.set(...aim);
  fixture.add(light, light.target);

  function setNight(night) {
    light.intensity = night ? strength : standby;
    light.visible = light.intensity > 0;
    lens.emissiveIntensity = night ? 2.65 : standby > 0 ? 0.84 : 0.04;
    reveal.emissiveIntensity = 0.52 * lens.emissiveIntensity;
  }
  setNight(false);
  return setNight;
}
