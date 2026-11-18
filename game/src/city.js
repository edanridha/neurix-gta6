// city.js — Solmaris itself: the ground, the skyline, the sea. buildCity fills a three.js
// scene with the whole city from a seeded generator (so every visit and every screenshot
// shows the same streets) and returns what the gameplay needs to know about it: the solid
// boxes cars and people must not walk through, where the roads run, and the landmark spots
// the story visits (the pier, Lucia's garage, the old fish warehouse, a quiet hideout lot).
//
// Performance notes: buildings, palms and streetlights are drawn with InstancedMesh (one
// draw call per kind), the ground is a single plane with one big painted canvas texture,
// and there are no shadow maps — cars and people carry soft blob shadows instead. The
// sunset does the rest: a low warm sun, violet fog and windows that glow.

import * as THREE from 'three';
import { CITY, NEON_SIGNS, PALETTE, PIER_END_Z, SHORE_Z, WORLD_SPAN } from './config.js';
import { chance, intRange, pick, range } from './random.js';

/** X of the centre of block column i. */
export function blockX(i) {
  return (i - (CITY.cols - 1) / 2) * CITY.pitch;
}

/** Z of the centre of block row j. */
export function blockZ(j) {
  return (j - (CITY.rows - 1) / 2) * CITY.pitch;
}

/** X of every avenue (a north–south road): one along each side of every block column. */
export const AVENUES_X = [];
for (let i = 0; i <= CITY.cols; i += 1) AVENUES_X.push(blockX(0) - CITY.pitch / 2 + i * CITY.pitch);

/** Z of every street (an east–west road): one along each side of every block row. */
export const STREETS_Z = [];
for (let j = 0; j <= CITY.rows; j += 1) STREETS_Z.push(blockZ(0) - CITY.pitch / 2 + j * CITY.pitch);

/** Z of the beachfront avenue, the last road before the sand. */
export const BEACH_AVENUE_Z = STREETS_Z[STREETS_Z.length - 1] + 14;

/** True when (x, z) is on a road rather than inside a block or on the beach. */
export function isOnRoad(x, z) {
  if (Math.abs(z - BEACH_AVENUE_Z) < CITY.roadHalf + 2) return true;
  for (const ax of AVENUES_X) if (Math.abs(x - ax) < CITY.roadHalf + 2) return true;
  for (const sz of STREETS_Z) if (Math.abs(z - sz) < CITY.roadHalf + 2) return true;
  return false;
}

/** The named places the missions and the save file care about. */
export const LANDMARKS = {
  spawn: { x: blockX(4) + CITY.pitch / 2, z: blockZ(5) + 8 }, // on the avenue by the Hotel Marina
  pier: { x: blockX(4), z: PIER_END_Z - 8 },
  pierBase: { x: blockX(4), z: SHORE_Z + 6 },
  garage: { x: blockX(1) - 10, z: blockZ(5) }, // Lucia's, inside block (1,5), facing its avenue
  warehouse: { x: blockX(7) + 6, z: blockZ(4) }, // the old fish warehouse, inside block (7,4)
  hideout: { x: blockX(2), z: blockZ(1) }, // an open lot at the heart of block (2,1), up north
  hotel: { x: blockX(4), z: blockZ(5) },
};

/** A canvas texture helper: run draw(ctx, w, h) on a fresh canvas, get a THREE texture. */
function canvasTexture(w, h, draw, repeat) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  if (repeat) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat[0], repeat[1]);
  }
  return tex;
}

/** The ground: one canvas painting roads, sidewalks, plazas, sand and the sea floor. */
function groundTexture(next) {
  const S = 2048;
  const scale = S / WORLD_SPAN;
  const toPx = (v) => (v + WORLD_SPAN / 2) * scale;
  return canvasTexture(S, S, (g) => {
    // Base: dark plaza concrete everywhere; buildings will cover the block interiors.
    g.fillStyle = '#3f3a44';
    g.fillRect(0, 0, S, S);
    // The sea floor under the water plane (south edge).
    const shore = toPx(SHORE_Z);
    g.fillStyle = '#8a6f4d';
    g.fillRect(0, shore, S, S - shore);
    // The beach: a pale sand band just north of the waterline.
    g.fillStyle = '#d9b380';
    g.fillRect(0, toPx(SHORE_Z - 26), S, shore - toPx(SHORE_Z - 26));
    // Block interiors: slightly varied concrete so the grid reads from the air.
    for (let i = 0; i < CITY.cols; i += 1) {
      for (let j = 0; j < CITY.rows; j += 1) {
        const cx = toPx(blockX(i));
        const cy = toPx(blockZ(j));
        const half = CITY.blockHalf * scale;
        const tone = 62 + Math.floor(next() * 14);
        g.fillStyle = `rgb(${tone + 8},${tone},${tone + 10})`;
        g.fillRect(cx - half, cy - half, half * 2, half * 2);
        // Sidewalk rim around each block.
        g.strokeStyle = '#8f8a94';
        g.lineWidth = 5 * scale;
        g.strokeRect(cx - (CITY.blockHalf + 4) * scale, cy - (CITY.blockHalf + 4) * scale,
          (CITY.blockHalf + 4) * scale * 2, (CITY.blockHalf + 4) * scale * 2);
      }
    }
    // Roads: asphalt strips along every grid line, over the concrete.
    g.fillStyle = '#2b2e36';
    for (const ax of AVENUES_X) g.fillRect(toPx(ax - CITY.roadHalf), 0, CITY.roadHalf * 2 * scale, toPx(SHORE_Z - 20));
    for (const sz of STREETS_Z) g.fillRect(0, toPx(sz - CITY.roadHalf), S, CITY.roadHalf * 2 * scale);
    g.fillRect(0, toPx(BEACH_AVENUE_Z - CITY.roadHalf), S, CITY.roadHalf * 2 * scale);
    // Centre dashes.
    g.fillStyle = '#e8c85a';
    const dash = 6 * scale;
    for (const ax of AVENUES_X) {
      for (let z = -WORLD_SPAN / 2; z < SHORE_Z - 24; z += 12) g.fillRect(toPx(ax) - scale, toPx(z), 2 * scale, dash);
    }
    for (const sz of STREETS_Z) {
      for (let x = -WORLD_SPAN / 2; x < WORLD_SPAN / 2; x += 12) g.fillRect(toPx(x), toPx(sz) - scale, dash, 2 * scale);
    }
    // Crosswalks at every intersection.
    g.fillStyle = 'rgba(235,235,235,0.75)';
    for (const ax of AVENUES_X) {
      for (const sz of STREETS_Z) {
        for (let s = -3; s <= 3; s += 1) {
          g.fillRect(toPx(ax + s * 2.2) - scale * 0.7, toPx(sz - CITY.roadHalf - 3), scale * 1.4, 2.4 * scale);
          g.fillRect(toPx(ax + s * 2.2) - scale * 0.7, toPx(sz + CITY.roadHalf + 0.6), scale * 1.4, 2.4 * scale);
        }
      }
    }
  });
}

/** A facade texture: dark walls, a grid of windows, some of them lit for the evening. */
function facadeTexture(next, warm) {
  return canvasTexture(128, 256, (g, w, h) => {
    g.fillStyle = warm ? '#4a3a3c' : '#363a48';
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(0, 0, w, 10); // parapet shadow line
    const cols = 6;
    const rows = 14;
    for (let x = 0; x < cols; x += 1) {
      for (let y = 0; y < rows; y += 1) {
        const lit = chance(next, 0.42);
        const warmLit = chance(next, 0.7);
        g.fillStyle = lit ? (warmLit ? '#ffd489' : '#bfe3ff') : '#171a24';
        g.fillRect(8 + x * 20, 18 + y * 17, 12, 10);
      }
    }
  });
}

/** A neon sign texture: the shop's name in glowing letters on a dark board. */
function signTexture(text, color) {
  return canvasTexture(512, 128, (g, w, h) => {
    g.fillStyle = '#0c0a14';
    g.fillRect(0, 0, w, h);
    g.font = '900 56px "Arial Black", Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = color;
    g.shadowBlur = 26;
    g.fillStyle = color;
    g.fillText(text, w / 2, h / 2 + 2);
    g.shadowBlur = 8;
    g.fillStyle = '#ffffff';
    g.globalAlpha = 0.75;
    g.fillText(text, w / 2, h / 2 + 2);
  });
}

/** A soft radial glow (streetlight pools, headlight glare, the sun). */
function glowTexture(inner, outer) {
  return canvasTexture(128, 128, (g, w, h) => {
    const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
    grad.addColorStop(0, inner);
    grad.addColorStop(1, outer);
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  });
}

/**
 * Build the whole city into `scene`. Returns:
 *   colliders — [{minX, maxX, minZ, maxZ, h}] solid boxes (buildings, crates, the kiosk)
 *   update(dt, elapsed) — animates the water and one flickering sign; call every frame
 *   heroCarSpot — a photogenic parking spot on the beachfront avenue for the cover shot
 */
export function buildCity(scene, next) {
  const colliders = [];
  const group = new THREE.Group();
  scene.add(group);

  // ---- Sky, fog and light -------------------------------------------------
  scene.fog = new THREE.Fog(PALETTE.fog, 200, 980);
  const skyTex = canvasTexture(64, 512, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#1d1038');
    grad.addColorStop(0.45, '#53355e');
    grad.addColorStop(0.72, '#c65f7d');
    grad.addColorStop(0.88, '#ff8c4a');
    grad.addColorStop(1, '#ffb066');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  });
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(1500, 24, 16),
    new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false }),
  );
  group.add(sky);

  const hemi = new THREE.HemisphereLight(0x9a7bd0, 0x2c2135, 1.3);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(PALETTE.sun, 1.85);
  sun.position.set(-420, 190, 260);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x6db3ff, 0.28);
  fill.position.set(300, 200, -200);
  scene.add(fill);

  // The sun itself: a glowing disc low over the sea to the west.
  const glowTex = glowTexture('rgba(255,190,110,1)', 'rgba(255,120,40,0)');
  const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, fog: false, depthWrite: false }));
  sunSprite.position.set(-980, 120, 420);
  sunSprite.scale.setScalar(420);
  group.add(sunSprite);

  // ---- Ground and sea -------------------------------------------------------
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD_SPAN, WORLD_SPAN),
    new THREE.MeshLambertMaterial({ map: groundTexture(next) }),
  );
  ground.rotation.x = -Math.PI / 2;
  group.add(ground);

  const waterTex = canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#14425e';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(140,220,255,0.20)';
    for (let i = 0; i < 26; i += 1) {
      g.beginPath();
      const y = next() * h;
      g.moveTo(0, y);
      for (let x = 0; x <= w; x += 16) g.lineTo(x, y + Math.sin(x * 0.1 + i) * 2.5);
      g.stroke();
    }
  }, [26, 10]);
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD_SPAN, 420),
    new THREE.MeshPhongMaterial({ map: waterTex, transparent: true, opacity: 0.88, shininess: 140, specular: 0xff9a50 }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, 0.35, SHORE_Z + 196);
  group.add(water);

  // ---- Buildings ------------------------------------------------------------
  const facades = [facadeTexture(next, true), facadeTexture(next, false), facadeTexture(next, true)];
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  boxGeo.translate(0, 0.5, 0); // grow upward from the ground
  const placements = facades.map(() => []);
  const signSpots = [];
  for (let i = 0; i < CITY.cols; i += 1) {
    for (let j = 0; j < CITY.rows; j += 1) {
      const cx = blockX(i);
      const cz = blockZ(j);
      const downtown = 1 - Math.min(1, Math.hypot(i - 4, j - 3) / 6);
      const lots = chance(next, 0.3) ? 1 : intRange(next, 2, 4);
      for (let lot = 0; lot < lots; lot += 1) {
        const w = range(next, 15, 26);
        const d = range(next, 15, 26);
        const spread = lots === 1 ? 0 : CITY.blockHalf - 13;
        const x = cx + range(next, -spread, spread);
        const z = cz + range(next, -spread, spread);
        // Keep the story's own ground clear: no random tower through Lucia's garage,
        // the warehouse yard or the hideout lot.
        const clearOf = [LANDMARKS.garage, LANDMARKS.warehouse, LANDMARKS.hideout];
        if (clearOf.some((p) => Math.hypot(x - p.x, z - p.z) < 27)) continue;
        const h = Math.round(range(next, 12, 26) + downtown * range(next, 18, 52));
        const texIndex = intRange(next, 0, 2);
        placements[texIndex].push({ x, z, w, d, h });
        colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, h });
        // Some street-facing buildings earn a neon sign for the dossier's skyline.
        if (h > 16 && chance(next, 0.34)) {
          signSpots.push({ x, z, w, d, h, face: intRange(next, 0, 3) });
        }
      }
    }
  }
  const tint = new THREE.Color();
  facades.forEach((tex, texIndex) => {
    const list = placements[texIndex];
    const mesh = new THREE.InstancedMesh(boxGeo, new THREE.MeshLambertMaterial({ map: tex }), list.length);
    const m = new THREE.Matrix4();
    list.forEach((b, k) => {
      m.makeScale(b.w, b.h, b.d).setPosition(b.x, 0, b.z);
      mesh.setMatrixAt(k, m);
      tint.setHSL(0.08 + next() * 0.75, 0.18, 0.5 + next() * 0.22);
      mesh.setColorAt(k, tint);
    });
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
  });

  // Neon signs: glowing boards on the faces the RNG picked, each with a halo sprite.
  const signColors = ['#ff4fd8', '#ffb340', '#4fd8ff', '#7dff8a', '#ff5e4d'];
  const signGroup = new THREE.Group();
  signSpots.slice(0, 22).forEach((s, k) => {
    const text = NEON_SIGNS[k % NEON_SIGNS.length];
    const color = signColors[k % signColors.length];
    const tex = signTexture(text, color);
    const width = Math.min(s.w, 20);
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(width, width / 4),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true }),
    );
    const y = Math.min(s.h - 3, 9 + (k % 4) * 3.2);
    const off = 0.35;
    if (s.face === 0) { plane.position.set(s.x, y, s.z - s.d / 2 - off); plane.rotation.y = Math.PI; }
    if (s.face === 1) { plane.position.set(s.x, y, s.z + s.d / 2 + off); }
    if (s.face === 2) { plane.position.set(s.x - s.w / 2 - off, y, s.z); plane.rotation.y = -Math.PI / 2; }
    if (s.face === 3) { plane.position.set(s.x + s.w / 2 + off, y, s.z); plane.rotation.y = Math.PI / 2; }
    signGroup.add(plane);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture('rgba(255,120,220,0.30)', 'rgba(255,120,220,0)'), depthWrite: false, transparent: true,
    }));
    halo.position.copy(plane.position);
    halo.scale.set(width * 1.5, width * 0.6, 1);
    signGroup.add(halo);
  });
  group.add(signGroup);

  // ---- Special buildings the story needs ------------------------------------
  const special = (x, z, w, h, d, color, signText, signColor, signFace = 'W') => {
    const mesh = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color }));
    mesh.scale.set(w, h, d);
    mesh.position.set(x, 0, z);
    group.add(mesh);
    colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, h });
    if (signText) {
      const tex = signTexture(signText, signColor);
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(w, 22), 5), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
      if (signFace === 'W') {
        plane.position.set(x - w / 2 - 0.35, h - 1.5, z);
        plane.rotation.y = -Math.PI / 2;
      } else {
        plane.position.set(x, h - 1.5, z - d / 2 - 0.35);
        plane.rotation.y = Math.PI;
      }
      group.add(plane);
    }
    return mesh;
  };
  // Lucia's garage: a low roller-door block west of its avenue, with her bar's sign on top.
  special(LANDMARKS.garage.x, LANDMARKS.garage.z, 20, 8, 16, 0x5a4a52, 'TIDE BAR', '#ff4fd8');
  // The old fish warehouse on the east edge: long, low, rusty.
  special(LANDMARKS.warehouse.x, LANDMARKS.warehouse.z, 30, 11, 20, 0x63503e, 'PESCA FRIA', '#4fd8ff');
  // Crates stacked outside the warehouse (cover for the shootout, and solid).
  const crateGeo = new THREE.BoxGeometry(2.4, 2.4, 2.4);
  const crateMat = new THREE.MeshLambertMaterial({ color: 0x8a6b42 });
  for (let k = 0; k < 9; k += 1) {
    const cx = LANDMARKS.warehouse.x - 22 + (k % 3) * 5.5;
    const cz = LANDMARKS.warehouse.z - 8 + Math.floor(k / 3) * 6;
    const crate = new THREE.Mesh(crateGeo, crateMat);
    crate.position.set(cx, 1.2 + (k % 2) * 1.2, cz);
    crate.rotation.y = next() * 0.6;
    group.add(crate);
    colliders.push({ minX: cx - 1.4, maxX: cx + 1.4, minZ: cz - 1.4, maxZ: cz + 1.4, h: 3 });
  }

  // ---- The pier ---------------------------------------------------------------
  const pierMat = new THREE.MeshLambertMaterial({ color: 0x7d5f3d });
  const deck = new THREE.Mesh(new THREE.BoxGeometry(10, 0.8, PIER_END_Z - SHORE_Z + 26), pierMat);
  deck.position.set(LANDMARKS.pier.x, 1.6, (SHORE_Z - 8 + PIER_END_Z) / 2);
  group.add(deck);
  const postGeo = new THREE.CylinderGeometry(0.35, 0.35, 3.4, 6);
  for (let z = SHORE_Z + 2; z < PIER_END_Z; z += 9) {
    for (const side of [-4.4, 4.4]) {
      const post = new THREE.Mesh(postGeo, pierMat);
      post.position.set(LANDMARKS.pier.x + side, 0.4, z);
      group.add(post);
    }
  }
  // A little kiosk at the pier's end — the pickup point of the first mission.
  special(LANDMARKS.pier.x, PIER_END_Z - 2, 6, 4.5, 6, 0xb0503c, 'PIER 9', '#ffb340', 'N');

  // ---- Streetlights -------------------------------------------------------------
  const poleGeo = new THREE.CylinderGeometry(0.12, 0.16, 6.4, 5);
  poleGeo.translate(0, 3.2, 0);
  const lampGeo = new THREE.SphereGeometry(0.42, 8, 6);
  lampGeo.translate(0, 6.5, 0);
  const lightSpots = [];
  for (const ax of AVENUES_X) for (let z = blockZ(0) - 30; z < SHORE_Z - 16; z += 38) lightSpots.push({ x: ax + 8.6, z });
  for (const sz of STREETS_Z) for (let x = blockX(0) - 30; x < blockX(CITY.cols - 1) + 30; x += 38) lightSpots.push({ x, z: sz + 8.6 });
  const poles = new THREE.InstancedMesh(poleGeo, new THREE.MeshLambertMaterial({ color: 0x2e2e38 }), lightSpots.length);
  const lamps = new THREE.InstancedMesh(lampGeo, new THREE.MeshBasicMaterial({ color: 0xffd9a0 }), lightSpots.length);
  {
    const m = new THREE.Matrix4();
    lightSpots.forEach((s, k) => {
      m.identity().setPosition(s.x, 0, s.z);
      poles.setMatrixAt(k, m);
      lamps.setMatrixAt(k, m);
    });
  }
  group.add(poles);
  group.add(lamps);
  // Pools of light on the asphalt under each lamp: one instanced additive plane.
  const poolGeo = new THREE.PlaneGeometry(13, 13);
  poolGeo.rotateX(-Math.PI / 2);
  const pools = new THREE.InstancedMesh(
    poolGeo,
    new THREE.MeshBasicMaterial({ map: glowTexture('rgba(255,190,110,0.20)', 'rgba(255,190,110,0)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    lightSpots.length,
  );
  {
    const m = new THREE.Matrix4();
    lightSpots.forEach((s, k) => {
      m.identity().setPosition(s.x, 0.06, s.z);
      pools.setMatrixAt(k, m);
    });
  }
  group.add(pools);

  // ---- Palm trees -----------------------------------------------------------------
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 7.5, 6);
  trunkGeo.translate(0, 3.75, 0);
  const frondTex = canvasTexture(128, 128, (g) => {
    g.clearRect(0, 0, 128, 128);
    g.strokeStyle = '#2e8a4f';
    g.lineWidth = 11;
    for (let k = 0; k < 8; k += 1) {
      const a = (k / 8) * Math.PI * 2;
      g.beginPath();
      g.moveTo(64, 64);
      g.quadraticCurveTo(64 + Math.cos(a) * 34, 64 + Math.sin(a) * 34 - 12, 64 + Math.cos(a) * 58, 64 + Math.sin(a) * 58 + 14);
      g.stroke();
    }
    g.strokeStyle = '#37a35c';
    g.lineWidth = 8;
    for (let k = 0; k < 8; k += 1) {
      const a = ((k + 0.5) / 8) * Math.PI * 2;
      g.beginPath();
      g.moveTo(64, 64);
      g.quadraticCurveTo(64 + Math.cos(a) * 22, 64 + Math.sin(a) * 22 - 10, 64 + Math.cos(a) * 40, 64 + Math.sin(a) * 40 + 8);
      g.stroke();
    }
  });
  const frondGeo = new THREE.PlaneGeometry(8.6, 8.6);
  frondGeo.rotateX(-Math.PI / 2);
  frondGeo.translate(0, 7.6, 0);
  const palmSpots = [];
  for (let x = blockX(0) - 20; x < blockX(CITY.cols - 1) + 30; x += range(next, 13, 20)) {
    palmSpots.push({ x, z: SHORE_Z - 18 + range(next, -4, 4), lean: range(next, -0.09, 0.09) });
  }
  for (const ax of AVENUES_X) {
    for (let z = blockZ(1); z < SHORE_Z - 30; z += range(next, 55, 85)) {
      if (chance(next, 0.6)) palmSpots.push({ x: ax - 10.5, z, lean: range(next, -0.07, 0.07) });
    }
  }
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: 0x8a6b4a }), palmSpots.length);
  const fronds = new THREE.InstancedMesh(frondGeo, new THREE.MeshLambertMaterial({ map: frondTex, transparent: true, alphaTest: 0.35, side: THREE.DoubleSide }), palmSpots.length);
  {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const one = new THREE.Vector3(1, 1, 1);
    palmSpots.forEach((s, k) => {
      e.set(s.lean, next() * Math.PI, s.lean * 0.6);
      q.setFromEuler(e);
      m.compose(new THREE.Vector3(s.x, 0, s.z), q, one);
      trunks.setMatrixAt(k, m);
      fronds.setMatrixAt(k, m);
    });
  }
  group.add(trunks);
  group.add(fronds);

  // Beach umbrellas: small cones on the sand for colour.
  const umbGeo = new THREE.ConeGeometry(2.4, 1.1, 8);
  umbGeo.translate(0, 2.6, 0);
  const umbColors = [0xff5e7a, 0x4fd8ff, 0xffb340, 0x7dff8a];
  const umbs = new THREE.InstancedMesh(umbGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), 16);
  {
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    for (let k = 0; k < 16; k += 1) {
      m.identity().setPosition(range(next, blockX(0), blockX(CITY.cols - 1)), 0, SHORE_Z - range(next, 6, 20));
      umbs.setMatrixAt(k, m);
      umbs.setColorAt(k, c.setHex(umbColors[k % umbColors.length]));
    }
  }
  group.add(umbs);

  // The hero spot for the cover: on the beachfront avenue, facing the sunset and the skyline.
  const heroCarSpot = { x: blockX(4) - 12, z: BEACH_AVENUE_Z, heading: Math.PI / 2 };

  let flicker = 0;
  return {
    colliders,
    heroCarSpot,
    /** Animate the sea and let one sign in the city buzz and flicker, cheaply. */
    update(dt, elapsed) {
      waterTex.offset.set(elapsed * 0.008, elapsed * 0.005);
      flicker += dt;
      if (flicker > 0.11) {
        flicker = 0;
        signGroup.visible = Math.random() > 0.03;
      }
    },
  };
}

/** Push a circle (x, z, radius) out of every collider box it overlaps; returns corrected [x, z]. */
export function resolveCollisions(colliders, x, z, radius) {
  for (const b of colliders) {
    const nx = Math.max(b.minX, Math.min(x, b.maxX));
    const nz = Math.max(b.minZ, Math.min(z, b.maxZ));
    const dx = x - nx;
    const dz = z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 < radius * radius) {
      if (d2 > 0.0001) {
        const d = Math.sqrt(d2);
        x = nx + (dx / d) * radius;
        z = nz + (dz / d) * radius;
      } else {
        // Centre inside the box: leave by the nearest face.
        const left = x - b.minX;
        const right = b.maxX - x;
        const top = z - b.minZ;
        const bottom = b.maxZ - z;
        const min = Math.min(left, right, top, bottom);
        if (min === left) x = b.minX - radius;
        else if (min === right) x = b.maxX + radius;
        else if (min === top) z = b.minZ - radius;
        else z = b.maxZ + radius;
      }
    }
  }
  return [x, z];
}
