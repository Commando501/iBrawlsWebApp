import * as THREE from 'three';

/** One court layout, separate from the repeating surface material. */
export function buildStadiumFieldMarkings(halfX: number, halfZ: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'stadium_field_markings';
  const white = new THREE.MeshStandardMaterial({
    color: '#cbd5df', roughness: 0.72, metalness: 0.12,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });
  const blue = white.clone();
  blue.color.set('#167fcc');
  blue.emissive.set('#07519a');
  blue.emissiveIntensity = 0.18;
  const red = white.clone();
  red.color.set('#d54c51');
  red.emissive.set('#8d1225');
  red.emissiveIntensity = 0.18;
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, x = 0, z = 0) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.012, z);
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  const line = (x: number, z: number, width: number, depth: number, material = white) =>
    add(new THREE.PlaneGeometry(width, depth), material, x, z);
  const insetX = Math.max(0.5, halfX - 0.8), insetZ = Math.max(0.5, halfZ - 0.8);
  line(0, -insetZ, insetX * 2, 0.12);
  line(0, insetZ, insetX * 2, 0.12);
  line(-insetX, 0, 0.12, insetZ * 2, blue);
  line(insetX, 0, 0.12, insetZ * 2, red);
  line(0, 0, 0.1, insetZ * 2);
  const radius = Math.min(4.5, halfX * 0.22, halfZ * 0.3);
  add(new THREE.RingGeometry(radius - 0.09, radius, 96), white);
  add(new THREE.RingGeometry(0.45, 0.52, 48), white);
  for (const side of [-1, 1]) {
    const material = side < 0 ? blue : red;
    const goalX = side * Math.max(0, halfX - 5);
    add(new THREE.RingGeometry(2.6, 2.7, 64), material, goalX);
    line(side * halfX * 0.5, 0, 0.09, insetZ * 2, material);
    for (let lane = -2; lane <= 2; lane++) {
      for (let distance = 1; distance <= 3; distance++) {
        line(side * (radius + distance * (halfX - radius) / 5), lane * halfZ * 0.32, 0.65, 0.08, material);
      }
    }
  }
  return group;
}
