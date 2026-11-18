// game.js — the game itself: one Game object owns the world (city, traffic, crowd, police),
// the player (Dario, on foot or behind a wheel), the wanted system, the shooting, the camera
// and the story's hooks. main.js only boots it and wires the menus; shots.js stages scenes
// by reaching into the same fields a player would change by playing.
//
// Crime and heat: the wanted level is a float (the HUD shows it as stars). Crimes witnessed
// by anyone nearby raise it; it cools while no police car can see the player. Police spawn
// on the roads around the player in numbers the heat earns, chase, ram, and arrest a player
// they can keep within arm's reach — the BUSTED bar — while gunfire and crashes drain the
// health bar toward WASTED. Both ends respawn Dario at the marina with lighter pockets.

import * as THREE from 'three';
import { CAR, PIER_END_Z, PLAYER, SAVE_KEY, SHORE_Z, WANTED } from './config.js';
import { createRandom, range } from './random.js';
import {
  AVENUES_X, LANDMARKS, STREETS_Z, buildCity, resolveCollisions,
} from './city.js';
import { TrafficSystem, createCar, forwardOf, parkingSpots, stepCar } from './vehicles.js';
import { PedestrianSystem, makePerson, posePerson } from './people.js';
import { Hud } from './hud.js';
import { MissionRunner } from './missions.js';
import { SoundEngine } from './audio.js';

/** Shortest signed difference between two headings, in (-PI, PI]. */
function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** A tiny pooled particle system for sparks, muzzle flashes and crash debris. */
class Particles {
  constructor(scene, max = 900) {
    this.max = max;
    this.positions = new Float32Array(max * 3);
    this.colors = new Float32Array(max * 3);
    this.items = [];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.32, vertexColors: true, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);
    for (let i = 0; i < max; i += 1) this.positions[i * 3 + 1] = -100;
  }

  burst(x, y, z, colorHex, count, speed, life = 0.5, up = 2.2) {
    const color = new THREE.Color(colorHex);
    for (let n = 0; n < count; n += 1) {
      if (this.items.length >= this.max) this.items.shift();
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.3 + Math.random() * 0.9);
      this.items.push({
        x, y, z,
        vx: Math.cos(a) * s, vy: Math.random() * up, vz: Math.sin(a) * s,
        life: life * (0.5 + Math.random() * 0.8), maxLife: life,
        r: color.r, g: color.g, b: color.b,
      });
    }
  }

  update(dt) {
    const alive = [];
    for (const p of this.items) {
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vy -= 6.5 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.y < 0.05) { p.y = 0.05; p.vy *= -0.4; }
      alive.push(p);
    }
    this.items = alive;
    for (let i = 0; i < this.max; i += 1) {
      const p = this.items[i];
      if (p) {
        this.positions[i * 3] = p.x;
        this.positions[i * 3 + 1] = p.y;
        this.positions[i * 3 + 2] = p.z;
        const fade = p.life / p.maxLife;
        this.colors[i * 3] = p.r * fade;
        this.colors[i * 3 + 1] = p.g * fade;
        this.colors[i * 3 + 2] = p.b * fade;
      } else {
        this.positions[i * 3 + 1] = -100;
      }
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.1, 3200);
    this.sound = new SoundEngine();
    this.hud = new Hud();
    this.state = 'title'; // title | playing | paused | over | end
    this.onStateChange = () => {};
    this.elapsed = 0;
    this.gameMinutes = 0;

    const next = createRandom(20261118);
    this.rng = next;
    const built = buildCity(this.scene, next);
    this.city = built;
    this.colliders = built.colliders;
    // Cars may not drive onto the pier deck (people walk on top of it instead).
    this.carColliders = [...built.colliders,
      { minX: LANDMARKS.pier.x - 5.4, maxX: LANDMARKS.pier.x + 5.4, minZ: SHORE_Z - 20, maxZ: PIER_END_Z + 4, h: 2 }];

    this.traffic = new TrafficSystem(this.scene, next, this.carColliders, 13);
    this.peds = new PedestrianSystem(this.scene, next, this.colliders, 26);
    this.particles = new Particles(this.scene);

    // Parked cars, plus one good red coupe waiting by the spawn avenue.
    this.parked = [];
    for (const spot of parkingSpots(next, 15)) {
      const car = createCar(this.scene, spot.x, spot.z, spot.heading, [0xc23b4e, 0x3b6ec2, 0xe0a51f, 0xd8d8de, 0x22242c, 0x39b56a][Math.floor(next() * 6)]);
      car.parked = true;
      this.parked.push(car);
    }
    const hero = createCar(this.scene, LANDMARKS.spawn.x - 4.5, LANDMARKS.spawn.z + 7, 0, 0xd8283c);
    hero.parked = true;
    this.parked.push(hero);
    this.heroCar = hero;

    this.police = [];
    this.enemies = [];
    this.fleers = [];

    // The player.
    this.playerMesh = makePerson(next, { shirt: 0x1f8a8a, pants: 0x2b3550, skin: 0xc68863 });
    this.scene.add(this.playerMesh);
    this.player = {
      x: LANDMARKS.spawn.x, z: LANDMARKS.spawn.z, heading: Math.PI, health: PLAYER.health,
      car: null, walkPhase: 0, hurtFlash: 0, dead: false,
    };
    this.money = 120;
    this.heat = 0;
    this.bust = 0;
    this.crimeCooldown = 0;
    this.fireCooldown = 0;
    this.camYaw = Math.PI;
    this.camPitch = 0.32;
    this.camDistance = 9;
    this.keys = new Set();
    this.mouseDown = false;
    this.pointerLocked = false;
    this.missionIndex = 0;

    // One headlight beam that follows whichever car the player is driving.
    this.headlight = new THREE.SpotLight(0xffe6b0, 0, 60, 0.5, 0.5, 1.2);
    this.headlightTarget = new THREE.Object3D();

    this.story = null; // built in startStory, once the hooks below exist
    this.bindInput();
    this.resize();
  }

  // ------------------------------------------------------------------ setup

  /** The hooks the story runner calls back into the world through. */
  storyHooks() {
    return {
      say: (name, color, text) => this.hud.say(name, color, text),
      clearSay: () => this.hud.clearSay(),
      setObjective: (title, text) => this.hud.setObjective(title, text),
      hideObjective: () => this.hud.hideObjective(),
      pay: (amount) => {
        this.money += amount;
        this.save();
      },
      setHeat: (stars) => { this.heat = Math.max(this.heat, stars); },
      spawnRivals: () => this.spawnRivals(),
      celebrate: (text) => this.hud.celebrate(text),
    };
  }

  /** Start the story at a mission index (0 for a new game, the saved one to continue). */
  startStory(index) {
    this.missionIndex = index;
    this.story = new MissionRunner(this.storyHooks(), index);
    this.story.start();
  }

  /** Wire keyboard and mouse. Menus live in main.js; this is the in-game half. */
  bindInput() {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyP' || e.code === 'Escape') {
        if (this.state === 'playing') this.pause();
        else if (this.state === 'paused') this.resume();
        return;
      }
      this.keys.add(e.code);
      if (this.state === 'playing') this.sound.unlock();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        this.mouseDown = true;
        if (this.state === 'playing') this.sound.unlock();
      }
    });
    window.addEventListener('mouseup', (e) => { if (e.button === 0) this.mouseDown = false; });
    window.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked || this.state !== 'playing') return;
      this.camYaw -= e.movementX * 0.0031;
      this.camPitch = THREE.MathUtils.clamp(this.camPitch + e.movementY * 0.0026, -0.12, 1.05);
    });
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
    });
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Ask for pointer lock (called by main.js when the player clicks into the game). */
  grabPointer() {
    if (this.state === 'playing' && !this.pointerLocked) this.canvas.requestPointerLock();
  }

  // ------------------------------------------------------------------ flow

  newGame() {
    try { window.localStorage.removeItem(SAVE_KEY); } catch { /* storage off */ }
    this.resetRun(0, 120);
    this.startStory(0);
    this.setState('playing');
  }

  continueGame() {
    const save = this.readSave();
    if (!save) {
      this.newGame();
      return;
    }
    this.resetRun(save.missionIndex || 0, save.money ?? 120);
    this.player.x = save.x ?? LANDMARKS.spawn.x;
    this.player.z = save.z ?? LANDMARKS.spawn.z;
    this.startStory(this.missionIndex);
    this.setState('playing');
    this.hud.celebrate('WELCOME BACK TO SOLMARIS');
  }

  /** Reset the run-scoped state (health, heat, police, enemies) for a fresh start. */
  resetRun(missionIndex, money) {
    this.missionIndex = missionIndex;
    this.money = money;
    this.player.health = PLAYER.health;
    this.player.car = null;
    this.player.dead = false;
    this.player.x = LANDMARKS.spawn.x;
    this.player.z = LANDMARKS.spawn.z;
    this.player.heading = Math.PI;
    this.playerMesh.visible = true;
    this.heat = 0;
    this.bust = 0;
    for (const cop of this.police) this.scene.remove(cop.mesh);
    this.police = [];
    for (const foe of this.enemies) this.scene.remove(foe.mesh);
    this.enemies = [];
    this.hud.hideObjective();
    this.hud.clearSay();
  }

  pause() {
    if (this.state !== 'playing') return;
    this.save();
    this.setState('paused');
    if (document.exitPointerLock) document.exitPointerLock();
  }

  resume() {
    if (this.state === 'paused') this.setState('playing');
  }

  toTitle() {
    this.setState('title');
    if (document.exitPointerLock) document.exitPointerLock();
  }

  setState(state, info = {}) {
    this.state = state;
    this.onStateChange(state, info);
    if (state === 'playing') this.hud.show();
    if (state === 'title') this.hud.hide();
  }

  readSave() {
    try {
      const raw = window.localStorage.getItem(SAVE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  hasSave() {
    return this.readSave() !== null;
  }

  /** Persist money, story progress and position (called on mission pay, pause, bust). */
  save() {
    try {
      window.localStorage.setItem(SAVE_KEY, JSON.stringify({
        money: Math.floor(this.money),
        missionIndex: this.story ? this.story.index : this.missionIndex,
        x: Math.round(this.player.x),
        z: Math.round(this.player.z),
      }));
    } catch { /* storage off: the run simply isn't saved */ }
  }

  /** WASTED or BUSTED: show the end screen; retry respawns at the marina, poorer. */
  gameOver(kind) {
    this.sound.sting();
    this.sound.setEngine(0, 0);
    this.money = Math.floor(this.money * 0.9);
    this.setState('over', { kind });
    if (document.exitPointerLock) document.exitPointerLock();
  }

  respawn() {
    this.player.health = PLAYER.health;
    this.player.dead = false;
    if (this.player.car) this.leaveCar(true);
    this.player.x = LANDMARKS.spawn.x;
    this.player.z = LANDMARKS.spawn.z;
    this.player.heading = Math.PI;
    this.playerMesh.visible = true;
    this.heat = 0;
    this.bust = 0;
    for (const cop of this.police) this.scene.remove(cop.mesh);
    this.police = [];
    for (const foe of this.enemies) this.scene.remove(foe.mesh);
    this.enemies = [];
    if (this.story) this.story.restartStage();
    this.save();
    this.setState('playing');
  }

  // ------------------------------------------------------------------ crime & police

  /**
   * Record a crime: heat rises only if someone is close enough to have seen it (a
   * pedestrian, a traffic driver, an officer). kind sets how serious it is.
   */
  crime(kind, x, z) {
    const amounts = { shoot: 0.32, steal: 0.85, hitPed: 1.25, hitCop: 0.9, hitCar: 0.3, shotAt: 0.5 };
    let witnessed = false;
    const see = (px, pz) => Math.hypot(px - x, pz - z) < 46;
    for (const p of this.peds.people) if (!p.dead && see(p.mesh.position.x, p.mesh.position.z)) witnessed = true;
    for (const c of this.traffic.cars) if (see(c.mesh.position.x, c.mesh.position.z)) witnessed = true;
    for (const c of this.police) if (see(c.mesh.position.x, c.mesh.position.z)) witnessed = true;
    if (kind === 'hitCop') witnessed = true;
    if (!witnessed) return;
    this.heat = Math.min(WANTED.max, this.heat + (amounts[kind] || 0.3));
  }

  /** How many police cars the current heat has earned. */
  wantedCars() {
    if (this.heat < 0.45) return 0;
    return Math.min(5, Math.ceil(this.heat));
  }

  /** Spawn a police car on a road 120–190 m from the player (never in plain sight). */
  spawnPolice() {
    const next = this.rng;
    for (let tries = 0; tries < 20; tries += 1) {
      const vertical = next() < 0.5;
      let x;
      let z;
      let heading;
      if (vertical) {
        const ax = AVENUES_X[Math.floor(next() * AVENUES_X.length)];
        x = ax;
        z = this.player.z + (next() < 0.5 ? -1 : 1) * range(next, 120, 190);
        heading = next() < 0.5 ? 0 : Math.PI;
      } else {
        const sz = STREETS_Z[Math.floor(next() * STREETS_Z.length)];
        z = sz;
        x = this.player.x + (next() < 0.5 ? -1 : 1) * range(next, 120, 190);
        heading = next() < 0.5 ? Math.PI / 2 : -Math.PI / 2;
      }
      if (Math.hypot(x - this.player.x, z - this.player.z) < 100) continue;
      const cop = createCar(this.scene, x, z, heading, 0xffffff, 'police');
      cop.driver = { stuck: 0, reverse: 0 };
      this.police.push(cop);
      return;
    }
  }

  /** Advance the police: chase, ram, unstick, arrest. */
  updatePolice(dt) {
    const wanted = this.wantedCars();
    if (this.police.length < wanted) this.spawnPolice();
    if (this.police.length > wanted + 1) {
      const far = this.police.pop();
      this.scene.remove(far.mesh);
    }
    const target = this.player.car
      ? { x: this.player.car.mesh.position.x, z: this.player.car.mesh.position.z, speed: this.player.car.speed }
      : { x: this.player.x, z: this.player.z, speed: 0 };
    let anySees = false;
    let nearest = Infinity;
    for (const cop of this.police) {
      const pos = cop.mesh.position;
      const dist = Math.hypot(target.x - pos.x, target.z - pos.z);
      nearest = Math.min(nearest, dist);
      if (dist < WANTED.sightRange) anySees = true;
      // Flash the light bar.
      const phase = Math.floor(this.elapsed * 5) % 2 === 0;
      cop.mesh.userData.lightBar.red.material.color.setHex(phase ? 0xff2233 : 0x551118);
      cop.mesh.userData.lightBar.blue.material.color.setHex(phase ? 0x112255 : 0x2266ff);

      if (this.heat < 0.45) {
        // No heat: cruise away slowly and give up.
        stepCar(cop, { throttle: 0.3, steer: 0, brake: false }, dt, this.carColliders, this.allCars());
        continue;
      }
      // Aim at where the target will be, not where it is.
      const lead = Math.min(1.2, dist / 40);
      const [tfx, tfz] = this.player.car ? forwardOf(this.player.car.heading) : [0, 0];
      const aimX = target.x + tfx * target.speed * lead;
      const aimZ = target.z + tfz * target.speed * lead;
      const wantedHeading = Math.atan2(aimX - pos.x, aimZ - pos.z);
      const steer = THREE.MathUtils.clamp(angleDiff(wantedHeading, cop.heading) * -1.6, -1, 1);
      let throttle = dist > 16 ? 1 : 0.55;
      if (!this.player.car && dist < 9) throttle = 0; // on foot: stop and make the arrest
      if (this.player.car && Math.abs(this.player.car.speed) < 1 && dist < 8) throttle = 0.2;
      // Unstick: if barely moving while trying, reverse briefly.
      if (Math.abs(cop.speed) < 0.6 && throttle > 0) cop.driver.stuck += dt;
      else cop.driver.stuck = 0;
      if (cop.driver.stuck > 2.2) {
        cop.driver.reverse = 1.1;
        cop.driver.stuck = 0;
      }
      if (cop.driver.reverse > 0) {
        cop.driver.reverse -= dt;
        stepCar(cop, { throttle: -1, steer: -steer, brake: false }, dt, this.carColliders, this.allCars());
      } else {
        const impact = stepCar(cop, { throttle, steer, brake: false }, dt, this.carColliders, this.allCars());
        if (impact > 9) {
          this.particles.burst(pos.x, 0.8, pos.z, 0xffa040, 16, 5, 0.5);
          this.sound.thud(0.8);
          if (this.player.car && Math.hypot(pos.x - target.x, pos.z - target.z) < 6) {
            this.damagePlayer(4);
            this.crime('hitCop', pos.x, pos.z);
          }
        }
      }
      // Running the player down hurts.
      if (!this.player.car && dist < 2.6 && Math.abs(cop.speed) > 6) {
        this.damagePlayer(16);
        this.player.x += (this.player.x - pos.x) * 0.4;
        this.player.z += (this.player.z - pos.z) * 0.4;
      }
    }
    // Heat cools only while no officer can see the player; the arrest meter fills
    // while an officer is close and the player is slow or on foot.
    if (!anySees) {
      this.heat = Math.max(0, this.heat - WANTED.decayPerSecond * dt);
    }
    const playerSlow = this.player.car ? Math.abs(this.player.car.speed) < 1.6 : true;
    if (this.heat >= 0.45 && nearest < 7 && playerSlow) {
      this.bust = Math.min(1, this.bust + dt / WANTED.bustFillSeconds);
      if (this.bust >= 1) {
        this.bust = 0;
        this.gameOver('busted');
      }
    } else {
      this.bust = Math.max(0, this.bust - dt * 0.8);
    }
    this.sound.setSirenLevel(nearest === Infinity ? 0 : Math.max(0, 1 - nearest / 90));
    return anySees;
  }

  // ------------------------------------------------------------------ people & combat

  /** Vex's crew, spawned by the third mission around the warehouse crates. */
  spawnRivals() {
    const next = this.rng;
    const w = LANDMARKS.warehouse;
    const spots = [
      [-20, -6], [-16, 6], [-24, 2], [-12, -10], [-19, 12],
    ];
    for (const [dx, dz] of spots) {
      const mesh = makePerson(next, { shirt: 0x27331f, pants: 0x1c1c22, gun: true });
      mesh.position.set(w.x + dx, 0, w.z + dz);
      this.scene.add(mesh);
      this.enemies.push({
        mesh, health: 100, dead: false, phase: range(next, 0, 6),
        shootTimer: range(next, 0.6, 1.8), rangeBand: range(next, 15, 24),
      });
    }
  }

  /** The rivals fight: keep their distance band, strafe a little, shoot back. */
  updateEnemies(dt) {
    for (const foe of this.enemies) {
      if (foe.dead) continue;
      const pos = foe.mesh.position;
      const dx = this.player.x - pos.x;
      const dz = this.player.z - pos.z;
      const dist = Math.hypot(dx, dz);
      foe.mesh.rotation.y = Math.atan2(dx, dz);
      let move = 0;
      if (dist > foe.rangeBand + 4) move = 1;
      else if (dist < foe.rangeBand - 5) move = -1;
      if (move !== 0) {
        const step = move * 3.1 * dt;
        let nx = pos.x + (dx / dist) * step;
        let nz = pos.z + (dz / dist) * step;
        [nx, nz] = resolveCollisions(this.colliders, nx, nz, 0.6);
        pos.x = nx;
        pos.z = nz;
        foe.phase += dt * 7;
      }
      posePerson(foe.mesh, foe.phase, move !== 0 ? 0.7 : 0.25, true);
      foe.shootTimer -= dt;
      if (foe.shootTimer <= 0 && dist < 38 && !this.player.car) {
        foe.shootTimer = range(this.rng, 0.8, 1.7);
        this.sound.shot();
        this.particles.burst(pos.x, 1.35, pos.z, 0xffd27a, 3, 1.4, 0.18, 0.4);
        const hitChance = THREE.MathUtils.clamp(0.62 - dist * 0.011, 0.15, 0.6);
        if (Math.random() < hitChance) {
          this.damagePlayer(range(this.rng, 4, 9));
          this.particles.burst(this.player.x, 1.2, this.player.z, 0xff5040, 6, 2.4, 0.3);
        }
      } else if (foe.shootTimer <= 0) {
        foe.shootTimer = 0.5;
      }
    }
  }

  /** Hurt the player; at zero health the run ends WASTED. */
  damagePlayer(amount) {
    if (this.state !== 'playing' || this.player.dead) return;
    this.player.health -= amount;
    this.player.hurtFlash = 0.85;
    if (this.player.health <= 0) {
      this.player.health = 0;
      this.player.dead = true;
      this.gameOver('wasted');
    }
  }

  /** The player's own gun: a hitscan ray along the camera's aim. */
  shoot() {
    const origin = this.camera.position.clone();
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const rangeMax = 90;
    let bestT = rangeMax;
    let bestHit = null;
    // Enemies and pedestrians are spheres at chest height.
    const testPerson = (x, z, ref, kind) => {
      const cx = x - origin.x;
      const cy = 1.25 - origin.y;
      const cz = z - origin.z;
      const t = cx * dir.x + cy * dir.y + cz * dir.z;
      if (t < 0 || t > bestT) return;
      const px = origin.x + dir.x * t;
      const py = origin.y + dir.y * t;
      const pz = origin.z + dir.z * t;
      if (Math.hypot(px - x, py - 1.25, pz - z) < 0.85) {
        bestT = t;
        bestHit = { ref, kind, x: px, y: py, z: pz };
      }
    };
    for (const foe of this.enemies) if (!foe.dead) testPerson(foe.mesh.position.x, foe.mesh.position.z, foe, 'enemy');
    for (const p of this.peds.people) if (!p.dead) testPerson(p.mesh.position.x, p.mesh.position.z, p, 'ped');
    // Cars are boxes: test centre distance to the ray, generously.
    const testCar = (car, kind) => {
      const p = car.mesh.position;
      const cx = p.x - origin.x;
      const cy = 0.8 - origin.y;
      const cz = p.z - origin.z;
      const t = cx * dir.x + cy * dir.y + cz * dir.z;
      if (t < 0 || t > bestT) return;
      const px = origin.x + dir.x * t;
      const py = origin.y + dir.y * t;
      const pz = origin.z + dir.z * t;
      if (Math.hypot(px - p.x, pz - p.z) < 2.4 && Math.abs(py - 0.8) < 1.3) {
        bestT = t;
        bestHit = { ref: car, kind, x: px, y: py, z: pz };
      }
    };
    for (const car of this.allCars()) testCar(car, car.kind === 'police' ? 'copCar' : 'car');
    // Buildings stop the bullet: ray vs AABB (slab test) on the colliders.
    for (const b of this.colliders) {
      let tmin = 0;
      let tmax = bestT;
      const axes = [
        [origin.x, dir.x, b.minX, b.maxX],
        [origin.z, dir.z, b.minZ, b.maxZ],
      ];
      let ok = true;
      for (const [o, d, lo, hi] of axes) {
        if (Math.abs(d) < 1e-8) {
          if (o < lo || o > hi) { ok = false; break; }
        } else {
          let t1 = (lo - o) / d;
          let t2 = (hi - o) / d;
          if (t1 > t2) [t1, t2] = [t2, t1];
          tmin = Math.max(tmin, t1);
          tmax = Math.min(tmax, t2);
          if (tmin > tmax) { ok = false; break; }
        }
      }
      if (ok && tmin < bestT && origin.y < b.h + 2) {
        bestT = tmin;
        bestHit = {
          ref: null, kind: 'wall',
          x: origin.x + dir.x * tmin, y: Math.min(origin.y + dir.y * tmin, b.h), z: origin.z + dir.z * tmin,
        };
      }
    }

    const gunX = this.player.x + Math.sin(this.player.heading) * 0.5;
    const gunZ = this.player.z + Math.cos(this.player.heading) * 0.5;
    this.particles.burst(gunX, 1.35, gunZ, 0xffe28a, 4, 1.6, 0.12, 0.3);
    this.sound.shot();
    this.peds.scare(this.player.x, this.player.z, 40);
    this.crime('shoot', this.player.x, this.player.z);
    if (!bestHit) return;
    this.particles.burst(bestHit.x, bestHit.y, bestHit.z, 0xffc46a, 7, 3, 0.35);
    if (bestHit.kind === 'enemy') {
      const foe = bestHit.ref;
      foe.health -= 34;
      this.particles.burst(bestHit.x, bestHit.y, bestHit.z, 0xff5040, 8, 2.6, 0.4);
      if (foe.health <= 0 && !foe.dead) {
        foe.dead = true;
        foe.mesh.rotation.x = -Math.PI / 2;
        foe.mesh.position.y = 0.25;
        this.hud.celebrate('RIVAL DOWN');
      }
    } else if (bestHit.kind === 'ped') {
      const ped = bestHit.ref;
      ped.dead = true;
      ped.mesh.rotation.x = -Math.PI / 2;
      ped.mesh.position.y = 0.25;
      this.crime('hitPed', this.player.x, this.player.z);
    } else if (bestHit.kind === 'copCar' || bestHit.kind === 'car') {
      const car = bestHit.ref;
      car.health -= 12;
      this.sound.thud(0.5);
      if (bestHit.kind === 'copCar') this.crime('shotAt', this.player.x, this.player.z);
      if (car.health <= 0 && !car.wrecked) {
        car.wrecked = true;
        this.particles.burst(car.mesh.position.x, 1, car.mesh.position.z, 0xff7a30, 26, 5, 0.8);
      }
    }
  }

  // ------------------------------------------------------------------ cars & the player

  /** Every car in the world, for collisions and minimap blips. */
  allCars() {
    return [...this.traffic.cars, ...this.parked, ...this.police];
  }

  /** The car the E prompt would use right now, or null. */
  nearestCar() {
    let best = null;
    let bestD = PLAYER.reachCar;
    for (const car of this.allCars()) {
      if (car.kind === 'police') continue;
      const d = Math.hypot(car.mesh.position.x - this.player.x, car.mesh.position.z - this.player.z);
      if (d < bestD) {
        bestD = d;
        best = car;
      }
    }
    return best;
  }

  /** Climb into a car: hide Dario, take the wheel, keep any traffic driver running. */
  enterCar(car) {
    if (car.driver && !car.parked) {
      // A traffic driver bails out and runs.
      const fleer = makePerson(this.rng, {});
      fleer.position.set(car.mesh.position.x + 2, 0, car.mesh.position.z);
      this.scene.add(fleer);
      this.fleers.push({ mesh: fleer, life: 6, phase: 0, heading: car.heading + Math.PI / 2 });
      car.driver = null;
      const idx = this.traffic.cars.indexOf(car);
      if (idx >= 0) this.traffic.cars.splice(idx, 1);
      this.parked.push(car);
    }
    car.occupied = true;
    car.parked = false;
    this.player.car = car;
    this.playerMesh.visible = false;
    car.mesh.add(this.headlight);
    car.mesh.add(this.headlightTarget);
    this.headlight.position.set(0, 0.8, 2.2);
    this.headlightTarget.position.set(0, 0.2, 26);
    this.headlight.target = this.headlightTarget;
    this.headlight.intensity = 260;
    this.crime('steal', car.mesh.position.x, car.mesh.position.z);
    this.peds.scare(car.mesh.position.x, car.mesh.position.z, 14);
  }

  /** Climb out beside the car. silent=true skips the crime/prompt side effects (respawn). */
  leaveCar(silent = false) {
    const car = this.player.car;
    if (!car) return;
    car.occupied = false;
    car.parked = true;
    if (!this.parked.includes(car)) this.parked.push(car);
    car.mesh.remove(this.headlight);
    car.mesh.remove(this.headlightTarget);
    this.headlight.intensity = 0;
    const [fx, fz] = forwardOf(car.heading);
    this.player.x = car.mesh.position.x - fz * 2.6;
    this.player.z = car.mesh.position.z + fx * 2.6;
    [this.player.x, this.player.z] = resolveCollisions(this.colliders, this.player.x, this.player.z, PLAYER.radius);
    this.player.heading = car.heading;
    this.player.car = null;
    this.playerMesh.visible = true;
    this.sound.setEngine(0, 0);
    if (!silent) this.save();
  }

  /** Height of the ground under a point: the pier deck, or the street. */
  groundY(x, z) {
    if (Math.abs(x - LANDMARKS.pier.x) < 5 && z > SHORE_Z - 20 && z < PIER_END_Z + 4) return 2.0;
    return 0;
  }

  /** Advance the player from the current input: driving, or on foot. */
  updatePlayer(dt) {
    const k = this.keys;
    if (this.player.car) {
      const car = this.player.car;
      const input = {
        throttle: (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) + (k.has('KeyS') || k.has('ArrowDown') ? -1 : 0),
        steer: (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) + (k.has('KeyA') || k.has('ArrowLeft') ? -1 : 0),
        brake: k.has('Space'),
      };
      const impact = stepCar(car, input, dt, this.carColliders, this.allCars());
      this.player.x = car.mesh.position.x;
      this.player.z = car.mesh.position.z;
      this.player.heading = car.heading;
      if (impact > 7) {
        this.sound.thud(Math.min(1, impact / 22));
        this.particles.burst(car.mesh.position.x, 0.7, car.mesh.position.z, 0xffb35e, 14, 4.5, 0.45);
        this.damagePlayer(impact * 0.22);
        this.crime('hitCar', car.mesh.position.x, car.mesh.position.z);
        this.peds.scare(car.mesh.position.x, car.mesh.position.z, 30);
      }
      this.sound.setEngine(Math.abs(car.speed) / CAR.maxSpeed, Math.abs(input.throttle));
      this.hud.setSpeed(car.speed * 3.6);
      if (k.has('KeyE')) {
        k.delete('KeyE');
        this.leaveCar();
      }
    } else {
      // On foot: WASD moves relative to the camera, Shift runs, the mouse aims.
      const run = k.has('ShiftLeft') || k.has('ShiftRight');
      const speed = run ? PLAYER.runSpeed : PLAYER.walkSpeed;
      const fwd = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) + (k.has('KeyS') || k.has('ArrowDown') ? -1 : 0);
      const strafe = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) + (k.has('KeyA') || k.has('ArrowLeft') ? -1 : 0);
      const sin = Math.sin(this.camYaw);
      const cos = Math.cos(this.camYaw);
      // Camera forward is (sin, cos); screen-right is (-cos, sin). WASD mixes the two.
      let mx = sin * fwd - cos * strafe;
      let mz = cos * fwd + sin * strafe;
      const len = Math.hypot(mx, mz);
      let moving = 0;
      if (len > 0.01) {
        mx /= len;
        mz /= len;
        moving = 1;
        this.player.heading = Math.atan2(mx, mz);
        let nx = this.player.x + mx * speed * dt;
        let nz = this.player.z + mz * speed * dt;
        [nx, nz] = resolveCollisions(this.colliders, nx, nz, PLAYER.radius);
        // Cars are solid too.
        for (const car of this.allCars()) {
          const dx = nx - car.mesh.position.x;
          const dz = nz - car.mesh.position.z;
          const d = Math.hypot(dx, dz);
          if (d > 0.01 && d < 2.6) {
            nx = car.mesh.position.x + (dx / d) * 2.6;
            nz = car.mesh.position.z + (dz / d) * 2.6;
          }
        }
        // The sea is out of bounds except along the pier.
        if (nz > SHORE_Z + 2 && this.groundY(nx, nz) === 0) nz = SHORE_Z + 2;
        this.player.x = THREE.MathUtils.clamp(nx, -600, 600);
        this.player.z = THREE.MathUtils.clamp(nz, -600, PIER_END_Z);
        this.player.walkPhase += speed * dt * 1.9;
      }
      this.playerMesh.position.set(this.player.x, this.groundY(this.player.x, this.player.z), this.player.z);
      this.playerMesh.rotation.y = this.pointerLocked || this.mouseDown ? this.camYaw : this.player.heading;
      const aiming = this.mouseDown;
      posePerson(this.playerMesh, this.player.walkPhase, moving * (run ? 1 : 0.55), aiming);
      this.hud.setSpeed(null);
      this.sound.setEngine(0, 0);
      // Shooting.
      this.fireCooldown -= dt;
      if (this.mouseDown && this.fireCooldown <= 0 && this.pointerLocked) {
        this.fireCooldown = 0.13;
        this.shoot();
      }
      // Entering a car.
      const near = this.nearestCar();
      if (near) {
        this.hud.setPrompt('<b>[E]</b> Enter car');
        if (k.has('KeyE')) {
          k.delete('KeyE');
          this.enterCar(near);
          this.hud.setPrompt(null);
        }
      } else {
        this.hud.setPrompt(null);
      }
      // Bumping into traffic on foot is rude and painful.
      for (const car of this.traffic.cars) {
        if (Math.abs(car.speed) > 5 && Math.hypot(car.mesh.position.x - this.player.x, car.mesh.position.z - this.player.z) < 2.4) {
          this.damagePlayer(9);
          this.player.x += (this.player.x - car.mesh.position.x) * 0.5;
          this.player.z += (this.player.z - car.mesh.position.z) * 0.5;
        }
      }
    }
    this.player.hurtFlash = Math.max(0, this.player.hurtFlash - dt * 1.4);
    // Slow health regen after five calm seconds.
    if (this.player.hurtFlash <= 0 && this.player.health > 0 && this.player.health < PLAYER.health) {
      this.player.health = Math.min(PLAYER.health, this.player.health + dt * 2.2);
    }
  }

  // ------------------------------------------------------------------ camera & frame

  /** The third-person camera: behind and above, smoothed, kept out of the buildings. */
  updateCamera(dt, snap = false) {
    const inCar = !!this.player.car;
    const targetDist = inCar ? 11.5 : 8.6;
    this.camDistance = THREE.MathUtils.lerp(this.camDistance, targetDist, snap ? 1 : dt * 3);
    if (!this.pointerLocked && this.state === 'playing') {
      // Without pointer lock (menus, screenshots), ease the camera behind the player:
      // the camera offset uses the same angle as the view forward, so yaw → heading.
      this.camYaw += angleDiff(this.player.heading, this.camYaw) * Math.min(1, dt * 1.6);
    }
    const focusY = inCar ? 1.6 : 1.7;
    const tx = this.player.x;
    const tz = this.player.z;
    const ty = this.groundY(tx, tz) + focusY;
    const cx = tx - Math.sin(this.camYaw) * Math.cos(this.camPitch) * this.camDistance;
    const cz = tz - Math.cos(this.camYaw) * Math.cos(this.camPitch) * this.camDistance;
    const cy = ty + Math.sin(this.camPitch) * this.camDistance + 0.6;
    let [px, pz] = resolveCollisions(this.colliders, cx, cz, 1.1);
    px = THREE.MathUtils.clamp(px, -640, 640);
    pz = THREE.MathUtils.clamp(pz, -640, 700);
    const py = Math.max(cy, this.groundY(px, pz) + 0.7);
    if (snap) this.camera.position.set(px, py, pz);
    else {
      const t = 1 - Math.exp(-dt * 7);
      this.camera.position.x += (px - this.camera.position.x) * t;
      this.camera.position.y += (py - this.camera.position.y) * t;
      this.camera.position.z += (pz - this.camera.position.z) * t;
    }
    this.camera.lookAt(tx, ty + 0.4, tz);
  }

  /** Everything the minimap needs, gathered fresh each frame. */
  minimapState() {
    const blips = (list, get) => list.filter((e) => !e.dead).map(get);
    return {
      player: { x: this.player.x, z: this.player.z, heading: this.player.heading },
      traffic: this.traffic.cars.map((c) => ({ x: c.mesh.position.x, z: c.mesh.position.z })),
      peds: blips(this.peds.people, (p) => ({ x: p.mesh.position.x, z: p.mesh.position.z })),
      police: this.police.map((c) => ({ x: c.mesh.position.x, z: c.mesh.position.z })),
      enemies: blips(this.enemies, (f) => ({ x: f.mesh.position.x, z: f.mesh.position.z })),
      marker: this.story ? this.story.marker : null,
    };
  }

  /** One frame of the whole game. dt is clamped by the caller. */
  update(dt) {
    this.elapsed += dt;
    this.city.update(dt, this.elapsed);
    if (this.state === 'playing') {
      this.gameMinutes += dt;
      this.updatePlayer(dt);
      const focus = { x: this.player.x, z: this.player.z };
      this.traffic.update(dt, focus, this.allCars());
      const danger = this.player.car && Math.abs(this.player.car.speed) > 4
        ? { x: this.player.x, z: this.player.z } : null;
      this.peds.update(dt, focus, danger);
      this.updatePolice(dt);
      this.updateEnemies(dt);
      // Fleers (bailed-out drivers) run a few seconds and vanish.
      for (let i = this.fleers.length - 1; i >= 0; i -= 1) {
        const f = this.fleers[i];
        f.life -= dt;
        f.phase += dt * 9;
        f.mesh.position.x += Math.sin(f.heading) * 5 * dt;
        f.mesh.position.z += Math.cos(f.heading) * 5 * dt;
        f.mesh.rotation.y = f.heading;
        posePerson(f.mesh, f.phase, 1);
        if (f.life <= 0) {
          this.scene.remove(f.mesh);
          this.fleers.splice(i, 1);
        }
      }
      if (this.story) {
        const result = this.story.update(dt, {
          playerPos: { x: this.player.x, z: this.player.z },
          wanted: this.heat,
          rivalsAlive: this.enemies.filter((f) => !f.dead).length,
        });
        if (result === 'story-complete') {
          this.save();
          this.setState('end');
        }
      }
      // HUD.
      this.hud.setHealth(this.player.health, this.player.hurtFlash);
      this.hud.setWanted(this.heat);
      this.hud.setMoney(this.money);
      this.hud.setClock(this.gameMinutes);
      this.hud.setBusted(this.bust);
      this.hud.setCrosshair(!this.player.car && this.pointerLocked);
      this.hud.drawMinimap(this.minimapState());
    }
    this.particles.update(dt);
    this.hud.update(dt);
    this.updateCamera(dt);
    this.renderer.render(this.scene, this.camera);
  }

  /** Render one frame without advancing anything (screenshot staging, title backdrop). */
  renderOnce() {
    this.city.update(0.016, this.elapsed);
    this.particles.update(0.016);
    this.renderer.render(this.scene, this.camera);
  }
}
