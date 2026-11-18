// main.js — the boot and the frame loop for Neon Tides: Solmaris. It builds the Game,
// wires the menu screens (title, pause, game over, story complete) to the game's state,
// and runs requestAnimationFrame with a clamped step so a slow frame never teleports
// anyone. With ?shot=<scene> in the URL it instead stages that scene (see shots.js),
// renders it a few times so every texture and light is warm, then sets
// window.__shotReady — the signal the screenshot tool waits for.

import { Game } from './game.js';
import { stageShot } from './shots.js';

const canvas = document.getElementById('scene');
const status = document.getElementById('status');
const game = new Game(canvas);

const screens = {
  title: document.getElementById('titleScreen'),
  pause: document.getElementById('pauseScreen'),
  over: document.getElementById('overScreen'),
  end: document.getElementById('endScreen'),
};
const btnContinue = document.getElementById('btnContinue');

/** Show exactly the screen a state calls for (none while playing). */
function showScreen(name) {
  for (const [key, node] of Object.entries(screens)) {
    node.classList.toggle('on', key === name);
  }
  if (name === 'title') btnContinue.style.display = game.hasSave() ? '' : 'none';
  if (name === 'pause') {
    document.getElementById('pauseStats').textContent =
      `$${Math.floor(game.money).toLocaleString('en-US')} in pocket · job ${Math.min(3, (game.story ? game.story.index : 0) + 1)} of 3`;
  }
}

game.onStateChange = (state, info) => {
  if (state === 'playing') {
    showScreen(null);
    status.textContent = 'Playing Neon Tides: Solmaris.';
  } else if (state === 'paused') {
    showScreen('pause');
  } else if (state === 'over') {
    const title = document.getElementById('overTitle');
    const text = document.getElementById('overText');
    if (info.kind === 'busted') {
      title.textContent = 'BUSTED';
      title.classList.add('busted');
      text.textContent = 'Captain Reyes finally got her courier. The marina clinic patched the paperwork — and took ten percent.';
    } else {
      title.textContent = 'WASTED';
      title.classList.remove('busted');
      text.textContent = 'Solmaris is a hard town to leave feet-first. The marina clinic did its work — for ten percent.';
    }
    showScreen('over');
  } else if (state === 'end') {
    document.getElementById('endCard').textContent =
      'Vex Marlowe folded, Captain Reyes closed her port case empty-handed, and Lucia Ferran owes Dario Solano a favour — ' +
      'the most dangerous currency in Solmaris. The city is yours now: every street, every shore, every neon hour of it.';
    showScreen('end');
  } else {
    showScreen('title');
  }
};

/** Every menu button, wired once. Sound unlocks on the first click, as browsers require. */
function wire(id, fn) {
  document.getElementById(id).addEventListener('click', () => {
    game.sound.unlock();
    game.sound.click();
    fn();
  });
}
wire('btnNew', () => game.newGame());
wire('btnContinue', () => game.continueGame());
wire('btnResume', () => game.resume());
wire('btnRestart', () => game.newGame());
wire('btnToTitle', () => game.toTitle());
wire('btnRetry', () => game.respawn());
wire('btnOverTitle', () => game.toTitle());
wire('btnFreeRoam', () => game.setState('playing'));
canvas.addEventListener('click', () => {
  game.sound.unlock();
  game.grabPointer();
});

window.__game = game; // a handle for automated smoke tests and curious players alike

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');

if (shot) {
  // Screenshot mode: stage the scene, warm it up with a few renders, then say so.
  stageShot(game, shot);
  for (let i = 0; i < 6; i += 1) {
    game.updateCamera(0.016, true);
    game.renderOnce();
  }
  window.__shotReady = true;
  status.textContent = `Screenshot scene ready: ${shot}.`;
} else {
  showScreen('title');
  let last = performance.now();
  const frame = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (game.state === 'title') game.camYaw += dt * 0.045; // a slow drift over the city
    game.update(dt);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
