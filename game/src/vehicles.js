// vehicles.js — everything with four wheels: how a car looks, how it drives, and the
// traffic that drives itself. A car is a plain object { mesh, heading, speed, kind, ... }
// whose mesh is a small group of boxes and cylinders — body, glass cabin, wheels that steer
// and spin, lights that glow — over a soft blob shadow (the game uses no shadow maps).
//
// Headings follow the three.js convention: heading 0 faces +Z (south, toward the sea) and
// the forward vector is (sin(heading), 0, cos(heading)).

import * as THREE from 'three';
import { CAR, CAR_COLORS } from './config.js';
import { AVENUES_X, STREETS_Z, resolveCollisions } from './city.js';
import { pick, range } from './random.js';

/** Forward vector for a heading, as [x, z]. */
export function forwardOf(heading) {
  return [Math.sin(heading), Math.cos(heading)];
}

/** The shared soft shadow texture every car and person stands on. */
let shadowTexture = null;
function blobShadow(radius) {
  if (!shadowTexture) {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const g = canvas.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 6, 64, 64, 62);
    grad.addColorStop(0, 'rgba(0,0,0,0.5)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    shadowTexture = new THREE.CanvasTexture(canvas);
  }
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(radius * 2, radius * 2),
    new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.05;
  return mesh;
}

const paintMats = new Map();
function paintMaterial(color) {
  if (!paintMats.has(color)) {
    paintMats.set(color, new THREE.MeshPhongMaterial({ color, shininess: 90, specular: 0x886644 }));
  }
  return paintMats.get(color);
}
const glassMat = new THREE.MeshPhongMaterial({ color: 0x10151f, shininess: 140, specular: 0xaaccff });
const tyreMat = new THREE.MeshLambertMaterial({ color: 0x17181c });
const chromeMat = new THREE.MeshPhongMaterial({ color: 0xb9bec9, shininess: 120 });

/**
 * Build a car's mesh. kind: 'car' (civilian), 'police' (black-and-white with a light bar)
 * or 'taxi' (yellow with a roof sign). The returned group faces +Z; its userData holds the
 * moving parts: wheels (front pair steers), lightBar (police), brakeLights.
 */
export function makeCarMesh(color, kind = 'car') {
  const group = new THREE.Group();
  const paint = kind === 'police' ? 0xf2f2f5 : kind === 'taxi' ? 0xf2b21b : color;
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.92, 0.58, 4.35), paintMaterial(paint));
  body.position.y = 0.58;
  group.add(body);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.34, 0.7), paintMaterial(paint));
  nose.position.set(0, 0.48, 2.3);
  group.add(nose);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.66, 0.52, 2.1), glassMat);
  cabin.position.set(0, 1.08, -0.25);
  group.add(cabin);
  if (kind === 'police') {
    const band = new THREE.Mesh(new THREE.BoxGeometry(1.94, 0.3, 1.6), new THREE.MeshLambertMaterial({ color: 0x14151c }));
    band.position.set(0, 0.6, 0.1);
    group.add(band);
    const bar = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.12, 0.4), tyreMat);
    base.position.y = 0.06;
    bar.add(base);
    const red = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.16, 0.34),
      new THREE.MeshBasicMaterial({ color: 0xff2233 }));
    red.position.set(-0.33, 0.2, 0);
    const blue = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.16, 0.34),
      new THREE.MeshBasicMaterial({ color: 0x2266ff }));
    blue.position.set(0.33, 0.2, 0);
    bar.add(red);
    bar.add(blue);
    bar.position.set(0, 1.36, -0.25);
    group.add(bar);
    group.userData.lightBar = { red, blue };
  }
  if (kind === 'taxi') {
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.2, 0.34),
      new THREE.MeshBasicMaterial({ color: 0xffe98a }));
    sign.position.set(0, 1.44, -0.25);
    group.add(sign);
  }
  // Headlights and tail lights: small emissive boxes; the brake lights brighten in stepCar.
  const headMat = new THREE.MeshBasicMaterial({ color: 0xfff2c0 });
  for (const side of [-0.62, 0.62]) {
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.06), headMat);
    head.position.set(side, 0.62, 2.66);
    group.add(head);
  }
  const brakeMat = new THREE.MeshBasicMaterial({ color: 0x881111 });
  for (const side of [-0.62, 0.62]) {
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.15, 0.06), brakeMat);
    tail.position.set(side, 0.66, -2.19);
    group.add(tail);
  }
  group.userData.brakeMat = brakeMat;
  // Wheels.
  const wheelGeo = new THREE.CylinderGeometry(0.37, 0.37, 0.3, 12);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheels = [];
  const wheelPos = [[-0.88, 1.42], [0.88, 1.42], [-0.88, -1.42], [0.88, -1.42]];
  wheelPos.forEach(([x, z], i) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.37, z);
    const wheel = new THREE.Mesh(wheelGeo, tyreMat);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.32, 8).rotateZ(Math.PI / 2), chromeMat);
    pivot.add(wheel);
    pivot.add(hub);
    group.add(pivot);
    wheels.push({ pivot, wheel, front: i < 2 });
  });
  group.userData.wheels = wheels;
  group.add(blobShadow(3.1));
  return group;
}

/** Create a car object and add its mesh to the scene at (x, z) facing `heading`. */
export function createCar(scene, x, z, heading, color, kind = 'car') {
  const mesh = makeCarMesh(color, kind);
  mesh.position.set(x, 0, z);
  mesh.rotation.y = heading;
  scene.add(mesh);
  return {
    mesh, kind, color,
    heading, speed: 0,
    health: 100,
    driver: null, // traffic AI state, set by TrafficSystem for its own cars
    occupied: false, // the player is driving it
    parked: false,
    wrecked: false,
  };
}

/**
 * Advance one car by dt with arcade physics. input: { throttle -1..1, steer -1..1, brake }.
 * Collides with the city's boxes and with `others` (an array of cars) softly. Returns the
 * impact speed of the hardest hit this step (0 = none), so callers can play sounds, sparks
 * and wanted-level consequences.
 */
export function stepCar(car, input, dt, colliders, others) {
  const mesh = car.mesh;
  const topSpeed = car.wrecked ? CAR.maxSpeed * 0.35 : CAR.maxSpeed;
  if (input.throttle > 0) car.speed += CAR.accel * input.throttle * dt * (1 - Math.max(0, car.speed) / (topSpeed * 1.25));
  else if (input.throttle < 0) {
    if (car.speed > 0.5) car.speed -= CAR.brake * dt;
    else car.speed = Math.max(-CAR.maxReverse, car.speed + CAR.accel * input.throttle * dt);
  }
  if (input.brake) car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), CAR.brake * 1.4 * dt);
  car.speed -= car.speed * CAR.drag * dt * 0.4;
  if (Math.abs(car.speed) < 0.02 && input.throttle === 0) car.speed = 0;

  // Steering: input.steer is +1 for a right turn, -1 for a left. Facing +Z (south), a right
  // turn swings the nose toward -X, which is a decreasing heading; reversing flips it, and
  // the turn rate grows with speed up to a cap so parking is gentle and cruising is calm.
  if (car.speed !== 0) {
    const speedFactor = Math.min(1, Math.abs(car.speed) / 11);
    const turnRate = 1.15 + 0.85 * speedFactor;
    car.heading -= input.steer * turnRate * dt * Math.sign(car.speed);
  }

  const [fx, fz] = forwardOf(car.heading);
  let x = mesh.position.x + fx * car.speed * dt;
  let z = mesh.position.z + fz * car.speed * dt;
  let impact = 0;

  const before = Math.abs(car.speed);
  [x, z] = resolveCollisions(colliders, x, z, CAR.radius);
  if (Math.hypot(x - mesh.position.x, z - mesh.position.z) < Math.abs(car.speed * dt) * 0.45 && Math.abs(car.speed) > 4) {
    impact = before;
    car.speed *= -0.18;
    car.health -= before * 1.4;
  }
  // Soft car-to-car bumps.
  for (const other of others) {
    if (other === car) continue;
    const dx = x - other.mesh.position.x;
    const dz = z - other.mesh.position.z;
    const d = Math.hypot(dx, dz);
    const minD = CAR.radius * 2 - 0.5;
    if (d > 0.01 && d < minD) {
      x += (dx / d) * (minD - d) * 0.6;
      z += (dz / d) * (minD - d) * 0.6;
      if (Math.abs(car.speed) > 5) {
        impact = Math.max(impact, Math.abs(car.speed) * 0.7);
        car.speed *= 0.55;
        other.speed = (other.speed || 0) + car.speed * 0.2;
      }
    }
  }
  mesh.position.x = x;
  mesh.position.z = z;
  mesh.rotation.y = car.heading;
  // Visuals: front wheels steer and all wheels spin; the body leans a touch in corners.
  const spin = (car.speed * dt) / 0.37;
  for (const w of car.mesh.userData.wheels) {
    if (w.front) w.pivot.rotation.y = input.steer * 0.45;
    w.wheel.rotation.x += spin;
  }
  mesh.rotation.z = THREE.MathUtils.lerp(mesh.rotation.z, -input.steer * Math.min(0.05, Math.abs(car.speed) * 0.0016), 0.2);
  mesh.userData.brakeMat.color.setHex(input.brake || input.throttle < 0 ? 0xff2222 : 0x881111);
  if (car.health <= 0 && !car.wrecked) car.wrecked = true;
  return impact;
}

/** Spawn points along the road edges where parked cars sit, nose along the road. */
export function parkingSpots(next, count) {
  const spots = [];
  let guard = 0;
  while (spots.length < count && guard < count * 30) {
    guard += 1;
    const vertical = next() < 0.5;
    if (vertical) {
      const ax = pick(next, AVENUES_X);
      const z = range(next, STREETS_Z[0], STREETS_Z[STREETS_Z.length - 1]);
      const side = next() < 0.5 ? -1 : 1;
      spots.push({ x: ax + side * (CAR.radius + 5.6), z, heading: side < 0 ? Math.PI : 0 });
    } else {
      const sz = pick(next, STREETS_Z);
      const x = range(next, AVENUES_X[0], AVENUES_X[AVENUES_X.length - 1]);
      const side = next() < 0.5 ? -1 : 1;
      spots.push({ x, z: sz + side * (CAR.radius + 5.6), heading: side < 0 ? -Math.PI / 2 : Math.PI / 2 });
    }
  }
  return spots;
}

/**
 * The city's civilian traffic: cars that pick a road, drive its right-hand lane to the next
 * junction, and there turn or go straight, forever. They slow for the car ahead and respawn
 * near the player when they wander too far off, so the streets around the player stay alive.
 */
export class TrafficSystem {
  constructor(scene, next, colliders, count = 13) {
    this.scene = scene;
    this.next = next;
    this.colliders = colliders;
    this.cars = [];
    for (let i = 0; i < count; i += 1) {
      const car = createCar(scene, 0, 0, 0, pick(next, CAR_COLORS), next() < 0.08 ? 'taxi' : 'car');
      this.placeOnRoad(car, null, true);
      this.cars.push(car);
    }
  }

  /** Put a traffic car on a random lane, anywhere (far) or near a point. */
  placeOnRoad(car, near, anywhere = false) {
    const next = this.next;
    for (let tries = 0; tries < 24; tries += 1) {
      const vertical = next() < 0.5;
      const dir = next() < 0.5 ? 1 : -1;
      let x;
      let z;
      let heading;
      if (vertical) {
        const ax = pick(next, AVENUES_X);
        x = ax + (dir > 0 ? -3.4 : 3.4);
        z = range(next, STREETS_Z[0] + 10, STREETS_Z[STREETS_Z.length - 1] - 10);
        heading = dir > 0 ? 0 : Math.PI;
      } else {
        const sz = pick(next, STREETS_Z);
        z = sz + (dir > 0 ? 3.4 : -3.4);
        x = range(next, AVENUES_X[0] + 10, AVENUES_X[AVENUES_X.length - 1] - 10);
        heading = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      }
      if (near && !anywhere && Math.hypot(x - near.x, z - near.z) < 46) continue;
      if (near && Math.hypot(x - near.x, z - near.z) > 330) continue;
      car.mesh.position.set(x, 0, z);
      car.heading = heading;
      car.speed = range(next, 7, 11);
      car.driver = { vertical, dir, cruise: range(next, 9, 13.5) };
      return;
    }
  }

  /** At a junction a traffic car may turn: swing its heading toward the crossing road. */
  maybeTurn(car) {
    const d = car.driver;
    const pos = car.mesh.position;
    const cross = d.vertical ? STREETS_Z : AVENUES_X;
    const along = d.vertical ? pos.z : pos.x;
    for (const c of cross) {
      if (Math.abs(along - c) < 3.2 && this.next() < 0.42) {
        // Turn onto the crossing road, snapping to its right-hand lane.
        const newDir = this.next() < 0.5 ? 1 : -1;
        if (d.vertical) {
          car.mesh.position.z = c + (newDir > 0 ? 3.4 : -3.4);
          car.heading = newDir > 0 ? Math.PI / 2 : -Math.PI / 2;
          car.driver = { vertical: false, dir: newDir, cruise: d.cruise };
        } else {
          car.mesh.position.x = c + (newDir > 0 ? -3.4 : 3.4);
          car.heading = newDir > 0 ? 0 : Math.PI;
          car.driver = { vertical: true, dir: newDir, cruise: d.cruise };
        }
        return;
      }
    }
  }

  /** Advance every traffic car; `focus` is the player position they stay near. */
  update(dt, focus, allCars) {
    for (const car of this.cars) {
      if (car.occupied) continue;
      const pos = car.mesh.position;
      if (Math.hypot(pos.x - focus.x, pos.z - focus.z) > 360) {
        this.placeOnRoad(car, focus);
        continue;
      }
      // Slow for whatever is ahead in the lane.
      const [fx, fz] = forwardOf(car.heading);
      let target = car.driver.cruise;
      for (const other of allCars) {
        if (other === car) continue;
        const dx = other.mesh.position.x - pos.x;
        const dz = other.mesh.position.z - pos.z;
        const ahead = dx * fx + dz * fz;
        const side = Math.abs(dx * fz - dz * fx);
        if (ahead > 0 && ahead < 11 && side < 2.6) target = Math.min(target, Math.max(0, (ahead - 6) * 1.6));
      }
      const input = { throttle: car.speed < target ? 0.55 : 0, steer: 0, brake: car.speed > target + 1 };
      // Lane keeping: ease toward the lane centre line of the current road. (Signs follow
      // stepCar's convention: steer +1 turns toward the driver's right.)
      if (car.driver.vertical) {
        const ax = AVENUES_X.reduce((a, b) => (Math.abs(b - pos.x) < Math.abs(a - pos.x) ? b : a));
        const lane = ax + (car.driver.dir > 0 ? -3.4 : 3.4);
        input.steer = THREE.MathUtils.clamp((pos.x - lane) * 0.14, -0.55, 0.55) * (car.driver.dir > 0 ? 1 : -1);
      } else {
        const sz = STREETS_Z.reduce((a, b) => (Math.abs(b - pos.z) < Math.abs(a - pos.z) ? b : a));
        const lane = sz + (car.driver.dir > 0 ? 3.4 : -3.4);
        input.steer = THREE.MathUtils.clamp((pos.z - lane) * 0.14, -0.55, 0.55) * (car.driver.dir > 0 ? -1 : 1);
      }
      stepCar(car, input, dt, this.colliders, allCars);
      this.maybeTurn(car);
    }
  }
}
