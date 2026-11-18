// shots.js — the deterministic scenes behind ?shot=cover|drive|chase|mission&seed=1.
// Each one puts the real game into a real state (the player in a car on the beachfront
// avenue, a three-star chase mid-street, Dario facing Vex's crew at the warehouse) and
// poses the camera, so the maker's screenshots are honest renders of the game itself —
// the same code paths a player drives, frozen for the camera. Nothing here draws or
// fakes anything: it only moves pieces the game already owns and lets it render.

import { LANDMARKS } from './city.js';
import { createCar } from './vehicles.js';
import { posePerson } from './people.js';

/** Put the player in a car for a shot: no crime, no fuss, just seated and hidden. */
function seatPlayer(game, car, x, z, heading) {
  car.mesh.position.set(x, 0, z);
  car.heading = heading;
  car.mesh.rotation.y = heading;
  car.speed = 0;
  car.parked = false;
  car.occupied = true;
  game.player.car = car;
  game.player.x = x;
  game.player.z = z;
  game.player.heading = heading;
  game.playerMesh.visible = false;
  // The headlight beam enterCar would switch on, so dusk shots get their pool of light.
  car.mesh.add(game.headlight);
  car.mesh.add(game.headlightTarget);
  game.headlight.position.set(0, 0.8, 2.2);
  game.headlightTarget.position.set(0, 0.2, 26);
  game.headlight.target = game.headlightTarget;
  game.headlight.intensity = 260;
}

/** Aim the game's own chase camera: yaw is the view direction, pitch looks down a touch. */
function poseCamera(game, yaw, pitch, distance) {
  game.camYaw = yaw;
  game.camPitch = pitch;
  game.camDistance = distance;
  game.updateCamera(0.016, true);
}

/** The HUD numbers a living game would show in each scene. */
function dressHud(game, { wanted = 0, money = 120, speed = null, clock = 34 } = {}) {
  game.hud.setHealth(100, 0);
  game.hud.setWanted(wanted);
  game.hud.setMoney(money);
  game.hud.setClock(clock);
  game.hud.setSpeed(speed);
  game.hud.drawMinimap(game.minimapState());
}

/**
 * Stage the named scene on `game` and render it. Returns nothing; when the frames are
 * painted the caller sets window.__shotReady so the screenshot tool knows to fire.
 */
export function stageShot(game, name) {
  game.startStory(0);
  game.setState('playing');
  game.story.dialogue = []; // no subtitles over the posed scenes, except where staged below
  game.hud.clearSay();

  if (name === 'drive') {
    // Downtown at dusk: Dario's coupe on a north–south avenue, traffic around him.
    const avenueX = -114; // the avenue three blocks west of the centre
    const car = game.heroCar;
    seatPlayer(game, car, avenueX - 3.4, 40, 0);
    car.speed = 17;
    const others = game.traffic.cars;
    if (others[0]) {
      others[0].mesh.position.set(avenueX - 3.4, 0, 68);
      others[0].heading = 0;
      others[0].mesh.rotation.y = 0;
    }
    if (others[1]) {
      others[1].mesh.position.set(avenueX + 3.4, 0, 6);
      others[1].heading = Math.PI;
      others[1].mesh.rotation.y = Math.PI;
    }
    if (others[2]) {
      others[2].mesh.position.set(avenueX - 3.4, 0, -34);
      others[2].heading = 0;
      others[2].mesh.rotation.y = 0;
    }
    poseCamera(game, 0.35, 0.3, 11.5);
    dressHud(game, { money: 620, speed: 61, clock: 52 });
    return;
  }

  if (name === 'chase') {
    // Three stars on the beachfront avenue: two patrol cars on his tail, one cutting in.
    const z = game.city.heroCarSpot.z;
    const car = game.heroCar;
    // x = -52 keeps the camera clear of the nearest street lamps (they balloon in frame).
    seatPlayer(game, car, -52, z, -Math.PI / 2);
    car.speed = 26;
    // All three units west of the camera, so all three are in frame: one alongside in
    // the south lane, two ahead trying to box him in.
    const copA = createCar(game.scene, -66, z + 6, -Math.PI / 2 + 0.15, 0xffffff, 'police');
    const copB = createCar(game.scene, -55, z - 7, -Math.PI / 2, 0xffffff, 'police');
    const copC = createCar(game.scene, -78, z - 2, -Math.PI / 2 - 0.2, 0xffffff, 'police');
    for (const cop of [copA, copB, copC]) {
      cop.driver = { stuck: 0, reverse: 0 };
      cop.mesh.userData.lightBar.red.material.color.setHex(0xff2233);
      cop.mesh.userData.lightBar.blue.material.color.setHex(0x2266ff);
      game.police.push(cop);
    }
    game.heat = 3;
    game.particles.burst(-55, 0.7, z + 2, 0xffb35e, 22, 5, 0.7);
    poseCamera(game, -Math.PI / 2 + 0.4, 0.3, 12.5);
    dressHud(game, { wanted: 3, money: 1450, speed: 94, clock: 88 });
    return;
  }

  if (name === 'mission') {
    // The warehouse yard: Dario on foot, pistol up, Vex's crew among the crates.
    const w = LANDMARKS.warehouse;
    // Staged west of the crew, mid-block: every streetlight pole is 25+ m away, so
    // nothing photobombs the camera, and the crew is 4–16 m ahead among the crates.
    game.player.x = w.x - 26;
    game.player.z = w.z + 6;
    game.player.heading = Math.PI / 2;
    game.playerMesh.position.set(game.player.x, 0, game.player.z);
    game.playerMesh.rotation.y = Math.PI / 2;
    posePerson(game.playerMesh, 0, 0.2, true);
    game.spawnRivals();
    for (const foe of game.enemies) {
      foe.mesh.rotation.y = Math.atan2(game.player.x - foe.mesh.position.x, game.player.z - foe.mesh.position.z);
      posePerson(foe.mesh, foe.phase, 0.3, true);
    }
    game.particles.burst(game.player.x + 1, 1.35, game.player.z, 0xffe28a, 5, 1.6, 0.2, 0.3);
    game.hud.setObjective('NEON RECKONING', 'Clear the warehouse yard. 5 of Vex’s crew still standing.');
    game.hud.say('Vex Marlowe', '#7dff8a', 'The courier himself! Hand over what you carried, and you walk.');
    poseCamera(game, Math.PI / 2 - 0.3, 0.3, 9);
    dressHud(game, { wanted: 1, money: 1300, clock: 130 });
    return;
  }

  // 'cover' (and anything else): the hero shot — the red coupe on the beachfront avenue
  // at sunset, skyline behind, sea beside, the whole city in one frame.
  const spot = game.city.heroCarSpot;
  const car = game.heroCar;
  // x = -49 sits midway between two streetlight poles, so no pole photobombs the hero.
  seatPlayer(game, car, -49, spot.z - 3.4, -Math.PI / 2);
  car.speed = 12;
  // Life on the avenue: one car ahead in his lane, one coming the other way, a stroller
  // on the promenade.
  const traffic = game.traffic.cars;
  if (traffic[3]) {
    traffic[3].mesh.position.set(-97, 0, spot.z - 3.4);
    traffic[3].heading = -Math.PI / 2;
    traffic[3].mesh.rotation.y = -Math.PI / 2;
  }
  if (traffic[4]) {
    traffic[4].mesh.position.set(-140, 0, spot.z + 3.4);
    traffic[4].heading = Math.PI / 2;
    traffic[4].mesh.rotation.y = Math.PI / 2;
  }
  const stroller = game.peds.people[0];
  if (stroller) stroller.mesh.position.set(-54, 0, spot.z + 13);
  poseCamera(game, -Math.PI / 2 + 0.38, 0.24, 12.5);
  dressHud(game, { money: 120, clock: 24 });
}
