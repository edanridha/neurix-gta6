// people.js — the humans of Solmaris. One articulated low-poly figure (legs and arms that
// swing as it walks, a torso, a head) is dressed in different colours to become the player,
// a strolling pedestrian, a fleeing driver or a rival with a gun. Pedestrians wander the
// sidewalks and the beach, step out of the way of trouble, and run when shots are fired.

import * as THREE from 'three';
import { CITY, SHORE_Z } from './config.js';
import { blockX, blockZ, resolveCollisions } from './city.js';
import { pick, range } from './random.js';

const skinTones = [0xe8b98d, 0xc68863, 0x8a5a3b, 0xf0c8a0, 0x6e4426];
const shirtColors = [0xff5e7a, 0x4fd8ff, 0xffb340, 0x7dff8a, 0xe8e8e8, 0x7a4fd0, 0x2ec4b6, 0xff8c42,
  0xf4f1ea, 0x30343f, 0xffd1dc, 0x9be7c4, 0xffe066, 0xff7f50, 0x5b8def, 0xd94f70];
const pantsColors = [0x2b3550, 0x3a3a3a, 0x70543a, 0x243028, 0x54383e, 0xd8d8de, 0x7a4a2b, 0x1f3a5f];
const capColors = [0xff4f6d, 0xffb340, 0x4fd8ff, 0xf4f1ea, 0x22242c, 0x7dff8a];

/**
 * Build one person. Returns a group facing +Z whose userData carries the limbs:
 * { legL, legR, armL, armR, torso } — swing them with posePerson while walking.
 * opts: { shirt, pants, skin, gun } — gun adds a small pistol in the right hand.
 */
export function makePerson(next, opts = {}) {
  const shirt = opts.shirt ?? pick(next, shirtColors);
  const pants = opts.pants ?? pick(next, pantsColors);
  const skin = opts.skin ?? pick(next, skinTones);
  const group = new THREE.Group();
  const mat = (color) => new THREE.MeshLambertMaterial({ color });

  const legGeo = new THREE.BoxGeometry(0.21, 0.78, 0.24);
  legGeo.translate(0, -0.39, 0);
  const legL = new THREE.Mesh(legGeo, mat(pants));
  legL.position.set(-0.14, 0.8, 0);
  const legR = new THREE.Mesh(legGeo, mat(pants));
  legR.position.set(0.14, 0.8, 0);
  group.add(legL);
  group.add(legR);

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.66, 0.3), mat(shirt));
  torso.position.y = 1.13;
  group.add(torso);

  const armGeo = new THREE.BoxGeometry(0.16, 0.68, 0.18);
  armGeo.translate(0, -0.3, 0);
  const armL = new THREE.Mesh(armGeo, mat(shirt));
  armL.position.set(-0.37, 1.42, 0);
  const armR = new THREE.Mesh(armGeo, mat(shirt));
  armR.position.set(0.37, 1.42, 0);
  group.add(armL);
  group.add(armR);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.38, 0.34), mat(skin));
  head.position.y = 1.66;
  group.add(head);
  const hair = new THREE.Mesh(new THREE.BoxGeometry(0.37, 0.12, 0.37), mat(pick(next, [0x1c1410, 0x3a2415, 0x6e4a22, 0xb8b0a4, 0x802020])));
  hair.position.y = 1.88;
  group.add(hair);
  // A third of the city wears a bright beach cap instead of hair.
  if (!opts.gun && next() < 0.34) {
    hair.visible = false;
    const capMat = mat(pick(next, capColors));
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.19, 0.15, 8), capMat);
    crown.position.y = 1.9;
    group.add(crown);
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.04, 0.24), capMat);
    brim.position.set(0, 1.85, 0.26);
    group.add(brim);
  }

  if (opts.gun) {
    const pistol = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.14, 0.34), mat(0x17181c));
    pistol.position.set(0, -0.62, 0.14);
    armR.add(pistol);
    group.userData.pistol = pistol;
  }

  // Soft blob shadow, like the cars use.
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const g = canvas.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 3, 32, 32, 30);
  grad.addColorStop(0, 'rgba(0,0,0,0.45)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1.7, 1.7),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.04;
  group.add(shadow);

  group.userData.limbs = { legL, legR, armL, armR };
  return group;
}

/**
 * Pose a person for a walk cycle: phase advances with distance walked; speed01 is how fast
 * they are moving (0 = standing, arms at rest). When `aiming` is true the right arm points
 * forward, pistol-style, instead of swinging.
 */
export function posePerson(mesh, phase, speed01, aiming = false) {
  const { legL, legR, armL, armR } = mesh.userData.limbs;
  const swing = Math.sin(phase) * 0.62 * Math.min(1, speed01 + 0.15);
  legL.rotation.x = swing;
  legR.rotation.x = -swing;
  armL.rotation.x = -swing * 0.8;
  armR.rotation.x = aiming ? -Math.PI / 2 + 0.12 : swing * 0.8;
  if (aiming) armR.rotation.z = 0;
}

/**
 * The crowd: pedestrians who pick a sidewalk corner, stroll to it, pick another. They keep
 * to the rims of the blocks and the beach, flee from gunfire and from cars that mount the
 * pavement, and respawn near the player when they end up too far away to be seen.
 */
export class PedestrianSystem {
  constructor(scene, next, colliders, count = 26) {
    this.next = next;
    this.colliders = colliders;
    this.people = [];
    for (let i = 0; i < count; i += 1) {
      const mesh = makePerson(next);
      scene.add(mesh);
      const p = {
        mesh, heading: range(next, 0, Math.PI * 2), speed: 0,
        target: null, phase: range(next, 0, 6), panic: 0, dead: false,
      };
      this.placeNear(p, null, true);
      this.people.push(p);
    }
  }

  /** A random stroll target: a block corner, a beach spot, or a pier point. */
  randomTarget(next) {
    const r = next();
    if (r < 0.16) return { x: range(next, blockX(0), blockX(CITY.cols - 1)), z: SHORE_Z - range(next, 4, 22) };
    if (r < 0.22) return { x: blockX(4) + range(next, -3, 3), z: range(next, SHORE_Z, SHORE_Z + 70) };
    const i = Math.floor(next() * CITY.cols);
    const j = Math.floor(next() * CITY.rows);
    const sx = next() < 0.5 ? -1 : 1;
    const sz = next() < 0.5 ? -1 : 1;
    return { x: blockX(i) + sx * (CITY.blockHalf + 5), z: blockZ(j) + sz * (CITY.blockHalf + 5) };
  }

  /** Drop a pedestrian somewhere sensible, optionally near a focus point. */
  placeNear(p, focus, anywhere = false) {
    for (let tries = 0; tries < 20; tries += 1) {
      const t = this.randomTarget(this.next);
      if (focus && !anywhere) {
        const d = Math.hypot(t.x - focus.x, t.z - focus.z);
        if (d < 30 || d > 190) continue;
      }
      p.mesh.position.set(t.x, 0, t.z);
      p.target = this.randomTarget(this.next);
      return;
    }
    p.mesh.position.set(blockX(4), 0, blockZ(5));
    p.target = this.randomTarget(this.next);
  }

  /** Shots fired or a crash nearby: everyone in earshot runs for a few seconds. */
  scare(x, z, radius = 42) {
    for (const p of this.people) {
      if (p.dead) continue;
      if (Math.hypot(p.mesh.position.x - x, p.mesh.position.z - z) < radius) p.panic = range(this.next, 2.5, 4.5);
    }
  }

  /** Advance the crowd. `danger` is an optional {x, z} everyone keeps clear of (the player's car). */
  update(dt, focus, danger) {
    for (const p of this.people) {
      if (p.dead) continue;
      const pos = p.mesh.position;
      if (Math.hypot(pos.x - focus.x, pos.z - focus.z) > 260) {
        this.placeNear(p, focus);
        continue;
      }
      let tx = p.target.x;
      let tz = p.target.z;
      let speed = 1.6;
      if (p.panic > 0) {
        p.panic -= dt;
        speed = 5.2;
        // Run directly away from the focus of the scare (the last danger point seen).
        tx = pos.x + (pos.x - focus.x);
        tz = pos.z + (pos.z - focus.z);
        if (danger) { tx = pos.x + (pos.x - danger.x); tz = pos.z + (pos.z - danger.z); }
      } else if (danger && Math.hypot(pos.x - danger.x, pos.z - danger.z) < 7) {
        speed = 4.6;
        tx = pos.x + (pos.x - danger.x);
        tz = pos.z + (pos.z - danger.z);
      }
      const dx = tx - pos.x;
      const dz = tz - pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 1.6 && p.panic <= 0) {
        p.target = this.randomTarget(this.next);
        continue;
      }
      const wanted = Math.atan2(dx, dz);
      let turn = wanted - p.heading;
      while (turn > Math.PI) turn -= Math.PI * 2;
      while (turn < -Math.PI) turn += Math.PI * 2;
      p.heading += THREE.MathUtils.clamp(turn, -4 * dt, 4 * dt);
      const step = Math.min(dist, speed * dt);
      let nx = pos.x + Math.sin(p.heading) * step;
      let nz = pos.z + Math.cos(p.heading) * step;
      [nx, nz] = resolveCollisions(this.colliders, nx, nz, 0.6);
      pos.x = nx;
      pos.z = nz;
      pos.y = 0;
      p.mesh.rotation.y = p.heading;
      p.phase += step * 2.4;
      posePerson(p.mesh, p.phase, speed / 5);
    }
  }
}
