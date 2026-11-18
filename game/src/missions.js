// missions.js — the story of Neon Tides, told in three jobs for the fixer Lucia Ferran.
// Dario Solano, a night courier who owes money all over Solmaris, takes one package job too
// many: the package is evidence in Captain Reyes's port investigation, and the rival courier
// Vex Marlowe wants it back. The chain is a small state machine the game drives every frame:
//
//   1. Pier Pressure — fetch the package from the Pier 9 kiosk, deliver it to Lucia's garage.
//   2. Hot Cargo     — the drop was watched: shake a three-star heat, then reach the hideout.
//   3. Neon Reckoning — Vex's crew waits at the old fish warehouse. Settle it, then run.
//
// The runner owns the objective text, the map marker and the dialogue queue; the game owns
// the world (spawning rivals, setting the wanted level, paying the money) through hooks.

import { LANDMARKS } from './city.js';
import { CAST } from './config.js';

/** How long each dialogue line stays on screen, in seconds (longer lines linger). */
function lineTime(text) {
  return Math.min(6.5, 2.2 + text.length / 22);
}

export class MissionRunner {
  /**
   * hooks: {
   *   say(who, text), clearSay(), setObjective(title, text), hideObjective(),
   *   pay(amount, label), setHeat(stars), spawnRivals(), celebrate(text),
   * }
   * progress: 0..3 — how many missions are already done (from a save).
   */
  constructor(hooks, progress = 0) {
    this.hooks = hooks;
    this.index = progress; // the mission in play; 3 = story finished
    this.stage = 'intro';
    this.timer = 0;
    this.dialogue = [];
    this.dialogueTimer = 0;
    this.rivalsLeft = 0;
    this.marker = null;
    this.started = false;
  }

  /** Begin (or resume) the current mission from its first stage. */
  start() {
    this.started = true;
    this.dialogue = [];
    if (this.index === 0) {
      this.stage = 'go-pier';
      this.marker = { ...LANDMARKS.pier };
      this.hooks.setObjective('PIER PRESSURE', 'Pick up Lucia’s package at the Pier 9 kiosk, south end of the pier.');
      this.queue([
        ['lucia', 'Dario. A package came in on the night boat — it sits in the Pier 9 kiosk, and it is worth more than your car.'],
        ['dario', 'Everything is worth more than my car, Lucia.'],
        ['lucia', 'Then drive like it. Pick it up, bring it to my garage. No opening it.'],
      ]);
    } else if (this.index === 1) {
      this.stage = 'escape';
      this.marker = null;
      this.hooks.setHeat(3);
      this.hooks.setObjective('HOT CARGO', 'The drop was watched! Lose the police heat, then reach the hideout lot.');
      this.queue([
        ['radio', 'All units — courier suspect fleeing the marina district. Apprehend on sight.'],
        ['lucia', 'Reyes had eyes on the pier, Dario — that package is her port case, gift-wrapped by you.'],
        ['dario', 'You knew?!'],
        ['lucia', 'I suspected. Run now, argue later. Lose them, then the lot behind the north blocks.'],
      ]);
    } else if (this.index === 2) {
      this.stage = 'go-warehouse';
      this.marker = { ...LANDMARKS.warehouse };
      this.hooks.setObjective('NEON RECKONING', 'Meet Vex’s crew at the old fish warehouse on the east edge. Be ready.');
      this.queue([
        ['lucia', 'Vex Marlowe says the package was his. He wants a meeting — the old fish warehouse, east edge.'],
        ['dario', 'A meeting. With his whole crew, I suppose.'],
        ['lucia', 'Bring the iron I left in your trunk. Settle it, and we are square, you and I.'],
      ]);
    } else {
      this.stage = 'done';
      this.marker = null;
      this.hooks.hideObjective();
    }
  }

  /** Restart the current mission's opening stage (after a bust or a hospital visit). */
  restartStage() {
    if (this.index === 1) this.hooks.setHeat(0);
    this.start();
  }

  /** Queue dialogue lines: [[who, text], ...]. They play in order over the action. */
  queue(lines) {
    for (const [who, text] of lines) this.dialogue.push({ who, text });
  }

  /** The current line ends; show the next one, or clear the subtitle. */
  advanceDialogue() {
    const line = this.dialogue.shift();
    if (!line) {
      this.hooks.clearSay();
      this.dialogueTimer = 0;
      return;
    }
    const cast = CAST[line.who];
    this.hooks.say(cast.name, cast.color, line.text);
    this.dialogueTimer = lineTime(line.text);
  }

  /** Finish the current mission: pay, celebrate, and roll into the next one. */
  complete(amount, label) {
    this.hooks.pay(amount, label);
    this.hooks.celebrate(`+$${amount} — JOB DONE`);
    this.index += 1;
    this.marker = null;
    this.start();
  }

  /**
   * Drive the story. ctx: { playerPos {x,z}, wanted (stars, float), rivalsAlive }.
   * Returns 'story-complete' once, on the frame the last job ends; otherwise null.
   */
  update(dt, ctx) {
    if (!this.started) return null;
    if (this.dialogueTimer > 0) {
      this.dialogueTimer -= dt;
      if (this.dialogueTimer <= 0) this.advanceDialogue();
    } else if (this.dialogue.length > 0) {
      this.advanceDialogue();
    }
    if (this.index >= 3) return null;

    const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
    const pos = ctx.playerPos;

    if (this.index === 0) {
      if (this.stage === 'go-pier' && dist(pos, LANDMARKS.pier) < 7) {
        this.stage = 'deliver';
        this.timer = 210;
        this.marker = { ...LANDMARKS.garage };
        this.hooks.setObjective('PIER PRESSURE', 'Package in hand. Deliver it to Lucia’s garage — the clock is running.');
        this.queue([
          ['dario', 'Got it. Heavier than it looks. And it ticks? Please tell me it does not tick.'],
          ['lucia', 'It does not tick. Much. Garage, Dario — Reyes patrols the marina at night.'],
        ]);
        this.hooks.celebrate('PACKAGE PICKED UP');
      } else if (this.stage === 'deliver') {
        this.timer -= dt;
        const left = Math.max(0, Math.ceil(this.timer));
        this.hooks.setObjective('PIER PRESSURE', `Deliver the package to Lucia’s garage. ${left}s left.`);
        if (dist(pos, LANDMARKS.garage) < 9) {
          this.queue([
            ['lucia', 'Intact. You surprise me. Count it — five hundred, as agreed.'],
            ['dario', 'Pleasure doing— wait. Those sirens are close.'],
          ]);
          this.complete(500, 'Pier Pressure');
        } else if (this.timer <= 0) {
          this.timer = 210;
          this.queue([['lucia', 'The buyer left and came back. Once more, Dario — and hurry.']]);
        }
      }
    } else if (this.index === 1) {
      if (this.stage === 'escape') {
        if (ctx.wanted < 0.7) {
          this.stage = 'hideout';
          this.marker = { ...LANDMARKS.hideout };
          this.hooks.setObjective('HOT CARGO', 'Heat is gone. Quietly now — reach the hideout lot behind the north blocks.');
          this.queue([['lucia', 'Good. Off their board. The lot, Dario, and keep it slow and boring.']]);
        }
      } else if (this.stage === 'hideout' && dist(pos, LANDMARKS.hideout) < 9) {
        this.queue([
          ['dario', 'I am in. My heart is somewhere around my knees.'],
          ['lucia', 'Rest it. Tomorrow we end this — Vex has been asking the whole port for you.'],
        ]);
        this.complete(800, 'Hot Cargo');
      }
    } else if (this.index === 2) {
      if (this.stage === 'go-warehouse' && dist(pos, LANDMARKS.warehouse) < 16) {
        this.stage = 'fight';
        this.marker = null;
        this.hooks.spawnRivals();
        this.hooks.setObjective('NEON RECKONING', 'Clear the warehouse yard.');
        this.queue([
          ['vex', 'The courier himself! Hand over what you carried, and you walk.'],
          ['dario', 'It was never yours, Vex. Come and take it.'],
        ]);
      } else if (this.stage === 'fight') {
        this.rivalsLeft = ctx.rivalsAlive;
        this.hooks.setObjective('NEON RECKONING', `Clear the warehouse yard. ${this.rivalsLeft} of Vex’s crew still standing.`);
        if (ctx.rivalsAlive === 0) {
          this.stage = 'getaway';
          this.marker = { ...LANDMARKS.garage };
          this.hooks.setHeat(2);
          this.hooks.setObjective('NEON RECKONING', 'It is done — but Reyes heard the shots. Get back to Lucia’s garage.');
          this.queue([
            ['vex', 'Enough — enough! The port is yours, courier. Tell Lucia… tell her the tide took it.'],
            ['radio', 'Shots fired, east docks. All units respond.'],
          ]);
        }
      } else if (this.stage === 'getaway' && dist(pos, LANDMARKS.garage) < 9) {
        this.queue([
          ['lucia', 'Vex folded, Reyes has nothing, and the package is where it belongs. We are rich in everything but money.'],
          ['dario', 'Speak for yourself. I just made two thousand eight hundred.'],
          ['lucia', 'Then Solmaris is yours, Dario. Try not to buy it all at once.'],
        ]);
        this.complete(1500, 'Neon Reckoning');
        return 'story-complete';
      }
    }
    return null;
  }
}
