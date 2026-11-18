// hud.js — everything flat that floats over the 3D world: the health bar, the wanted stars,
// the money counter, the objective card, subtitles, prompts, the speedometer and the round
// minimap. The DOM nodes all live in index.html; this module owns updating them and draws
// the minimap on its canvas each frame from the game's live state.

import { AVENUES_X, BEACH_AVENUE_Z, STREETS_Z } from './city.js';
import { CITY, SHORE_Z, WANTED } from './config.js';

/** Grab a node by id — the one lookup every HUD update goes through. */
function el(id) {
  return document.getElementById(id);
}

export class Hud {
  constructor() {
    this.root = el('hud');
    this.healthBar = el('healthBar');
    this.healthNum = el('healthNum');
    this.stars = el('stars');
    this.money = el('money');
    this.clock = el('clock');
    this.objective = el('objective');
    this.objectiveTitle = el('objectiveTitle');
    this.objectiveText = el('objectiveText');
    this.prompt = el('prompt');
    this.speedo = el('speedo');
    this.speedNum = el('speedNum');
    this.subtitle = el('subtitle');
    this.toast = el('toast');
    this.bustedBar = el('bustedBar');
    this.bustedFill = el('bustedFill');
    this.crosshair = el('crosshair');
    this.vignette = el('damageVignette');
    this.map = el('minimap').getContext('2d');
    this.lastStars = -1;
    this.lastMoney = -1;
    this.toastTimer = 0;
  }

  show() { this.root.classList.add('on'); }
  hide() { this.root.classList.remove('on'); }

  /** Health 0..100: bar width, number, and a red flash while recently hurt. */
  setHealth(value, hurtFlash) {
    const v = Math.max(0, Math.round(value));
    this.healthBar.style.width = `${v}%`;
    this.healthBar.style.background = v < 30
      ? 'linear-gradient(90deg,#ff4d5e,#ff9a4d)'
      : 'linear-gradient(90deg,#57e389,#b7f04a)';
    this.healthNum.textContent = String(v);
    this.vignette.style.opacity = hurtFlash > 0 ? String(Math.min(0.9, hurtFlash)) : '0';
  }

  /** Wanted level as five stars, lit ones gold. Only touches the DOM when it changes. */
  setWanted(level) {
    const lit = level <= 0.05 ? 0 : Math.ceil(level);
    if (lit === this.lastStars) return;
    this.lastStars = lit;
    let html = '';
    for (let i = 0; i < WANTED.max; i += 1) html += i < lit ? '★' : '<span class="off">★</span>';
    this.stars.innerHTML = html;
  }

  setMoney(value) {
    const v = Math.floor(value);
    if (v === this.lastMoney) return;
    this.lastMoney = v;
    this.money.textContent = `$${v.toLocaleString('en-US')}`;
  }

  /** The game clock runs fast: one real second is one game minute from 18:00. */
  setClock(gameMinutes) {
    const total = 18 * 60 + Math.floor(gameMinutes);
    const hh = String(Math.floor(total / 60) % 24).padStart(2, '0');
    const mm = String(total % 60).padStart(2, '0');
    this.clock.textContent = `${hh}:${mm} · SOLMARIS`;
  }

  /** The objective card at the top centre; hideObjective clears it (free roam). */
  setObjective(title, text) {
    this.objective.style.display = 'block';
    this.objectiveTitle.textContent = title;
    this.objectiveText.textContent = text;
  }

  hideObjective() { this.objective.style.display = 'none'; }

  /** The little "[E] Enter car" hint; pass null to hide it. */
  setPrompt(html) {
    if (html === null) {
      this.prompt.style.display = 'none';
    } else {
      this.prompt.style.display = 'block';
      this.prompt.innerHTML = html;
    }
  }

  /** Speedometer while driving; pass null on foot. */
  setSpeed(kmh) {
    if (kmh === null) {
      this.speedo.style.display = 'none';
    } else {
      this.speedo.style.display = 'block';
      this.speedNum.textContent = String(Math.round(Math.abs(kmh)));
    }
  }

  /** A dialogue line at the bottom: who speaks (tinted) and what they say. */
  say(speaker, color, text) {
    this.subtitle.style.display = 'block';
    this.subtitle.innerHTML = `<b style="color:${color}">${speaker}:</b> ${text}`;
  }

  clearSay() { this.subtitle.style.display = 'none'; }

  /** A brief green celebration text ("+$500 — JOB DONE"). */
  celebrate(text) {
    this.toast.textContent = text;
    this.toast.style.opacity = '1';
    this.toastTimer = 2.6;
  }

  /** The BUSTED progress bar while an officer is close enough to make the arrest. */
  setBusted(fraction) {
    if (fraction <= 0) {
      this.bustedBar.style.display = 'none';
    } else {
      this.bustedBar.style.display = 'block';
      this.bustedFill.style.width = `${Math.min(100, fraction * 100)}%`;
    }
  }

  setCrosshair(on) { this.crosshair.style.display = on ? 'block' : 'none'; }

  /** Fade the toast; call every frame. */
  update(dt) {
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toast.style.opacity = '0';
    }
  }

  /**
   * Draw the round minimap: sea and sand to the south, the road grid, then blips —
   * police blue, rivals red, the mission marker amber — and the player as a white arrow
   * turned to their heading. The map is fixed north-up and centred on the player.
   */
  drawMinimap(state) {
    const ctx = this.map;
    const S = 336;
    const half = S / 2;
    const view = 250; // metres across the map
    const scale = S / view;
    const px = state.player.x;
    const pz = state.player.z;
    const toMap = (x, z) => [half + (x - px) * scale, half + (z - pz) * scale];

    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath();
    ctx.arc(half, half, half - 2, 0, Math.PI * 2);
    ctx.clip();
    // Land, then the sea band and the beach along the south.
    ctx.fillStyle = '#232833';
    ctx.fillRect(0, 0, S, S);
    const [, shoreY] = toMap(0, SHORE_Z);
    ctx.fillStyle = '#14425e';
    ctx.fillRect(0, shoreY, S, S - shoreY);
    ctx.fillStyle = '#d9b380';
    ctx.fillRect(0, shoreY - 26 * scale, S, 26 * scale);
    // Roads.
    ctx.strokeStyle = '#565d6e';
    ctx.lineWidth = Math.max(2, CITY.roadHalf * 2 * scale * 0.8);
    ctx.beginPath();
    for (const ax of AVENUES_X) {
      const [x] = toMap(ax, 0);
      ctx.moveTo(x, 0);
      ctx.lineTo(x, S);
    }
    for (const sz of STREETS_Z) {
      const [, y] = toMap(0, sz);
      ctx.moveTo(0, y);
      ctx.lineTo(S, y);
    }
    const [, beachY] = toMap(0, BEACH_AVENUE_Z);
    ctx.moveTo(0, beachY);
    ctx.lineTo(S, beachY);
    ctx.stroke();
    // Blips.
    const blip = (x, z, color, r = 5) => {
      const [mx, my] = toMap(x, z);
      if (mx < -8 || my < -8 || mx > S + 8 || my > S + 8) return;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(mx, my, r, 0, Math.PI * 2);
      ctx.fill();
    };
    for (const c of state.traffic) blip(c.x, c.z, 'rgba(200,205,215,0.65)', 3.5);
    for (const p of state.peds) blip(p.x, p.z, 'rgba(255,255,255,0.4)', 2.5);
    for (const cop of state.police) blip(cop.x, cop.z, '#3d8bff', 5.5);
    for (const foe of state.enemies) blip(foe.x, foe.z, '#ff4d5e', 5.5);
    if (state.marker) {
      // A mission marker off the map's edge is clamped to the rim so it still guides.
      let [mx, my] = toMap(state.marker.x, state.marker.z);
      mx = Math.max(14, Math.min(S - 14, mx));
      my = Math.max(14, Math.min(S - 14, my));
      ctx.fillStyle = '#ffb340';
      ctx.beginPath();
      ctx.arc(mx, my, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#14100a';
      ctx.font = '900 11px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('!', mx, my + 0.5);
    }
    // The player arrow.
    ctx.translate(half, half);
    ctx.rotate(-state.player.heading + Math.PI);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, -10);
    ctx.lineTo(6.5, 8);
    ctx.lineTo(0, 4);
    ctx.lineTo(-6.5, 8);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}
