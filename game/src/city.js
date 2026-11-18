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
    g.fillStyle = '#4a4149';
    g.fillRect(0, 0, S, S);
    // The sea floor under the water plane (south edge).
    const shore = toPx(SHORE_Z);
    g.fillStyle = '#8a6f4d';
    g.fillRect(0, shore, S, S - shore);
    // The beach: a pale sand band just north of the waterline, with a darker wet rim
    // where the water touches it.
    g.fillStyle = '#e3c08a';
    g.fillRect(0, toPx(SHORE_Z - 26), S, shore - toPx(SHORE_Z - 26));
    g.fillStyle = '#b28c5c';
    g.fillRect(0, toPx(SHORE_Z - 3), S, shore - toPx(SHORE_Z - 3));
    // The promenade between the beachfront avenue and the sand: warm terracotta tiles
    // with a grout line every few metres, so the strip reads as a boardwalk esplanade.
    const promTop = toPx(BEACH_AVENUE_Z + CITY.roadHalf);
    const promBot = toPx(SHORE_Z - 26);
    g.fillStyle = '#9a5f4a';
    g.fillRect(0, promTop, S, promBot - promTop);
    g.strokeStyle = 'rgba(60,30,20,0.35)';
    g.lineWidth = 1.5;
    for (let x = 0; x < S; x += 4 * scale) {
      g.beginPath();
      g.moveTo(x, promTop);
      g.lineTo(x, promBot);
      g.stroke();
    }
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
    g.fillStyle = '#38333d';
    for (const ax of AVENUES_X) g.fillRect(toPx(ax - CITY.roadHalf), 0, CITY.roadHalf * 2 * scale, toPx(SHORE_Z - 20));
    for (const sz of STREETS_Z) g.fillRect(0, toPx(sz - CITY.roadHalf), S, CITY.roadHalf * 2 * scale);
    g.fillRect(0, toPx(BEACH_AVENUE_Z - CITY.roadHalf), S, CITY.roadHalf * 2 * scale);
    // Asphalt grain: thousands of faint speckles so the streets are not flat colour.
    for (let n = 0; n < 5200; n += 1) {
      const v = 46 + Math.floor(next() * 26);
      g.fillStyle = `rgba(${v + 14},${v + 8},${v + 16},0.5)`;
      g.fillRect(next() * S, next() * toPx(SHORE_Z - 20), 2.2, 2.2);
    }
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

/**
 * A facade texture: walls, a grid of windows, some of them lit for the evening.
 * `style` varies the recipe — window rhythm, a vertical colour band, balconies, and
 * (styles 1 and 3) a glowing shopfront with an awning along the ground floor, which
 * is what street-level screenshots actually show.
 */
function facadeTexture(next, warm, style) {
  return canvasTexture(128, 256, (g, w, h) => {
    g.fillStyle = warm ? '#54403e' : style === 2 ? '#2f3a44' : '#3d4152';
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(0, 0, w, 10); // parapet shadow line
    if (style === 2) { // a vertical band of paler stone down one side
      g.fillStyle = 'rgba(255,235,200,0.10)';
      g.fillRect(w * 0.62, 0, w * 0.2, h);
    }
    const cols = style === 4 ? 5 : 6;
    const rows = style === 1 ? 12 : 14;
    const litRatio = style === 3 ? 0.58 : 0.48;
    for (let x = 0; x < cols; x += 1) {
      for (let y = 0; y < rows; y += 1) {
        const lit = chance(next, litRatio);
        const warmLit = chance(next, 0.7);
        g.fillStyle = lit ? (warmLit ? '#ffd489' : '#bfe3ff') : '#171a24';
        g.fillRect(8 + x * 20, 18 + y * 17, 12, 10);
        if (style === 4 && y % 3 === 2) { // balcony slab under every third row
          g.fillStyle = 'rgba(0,0,0,0.4)';
          g.fillRect(6 + x * 20, 29 + y * 17, 16, 3);
        }
      }
    }
    if (style === 1 || style === 3) {
      // Ground floor: a run of bright shop windows under a striped awning.
      const gy = h - 34;
      g.fillStyle = '#120e16';
      g.fillRect(0, gy, w, 34);
      for (let x = 0; x < 4; x += 1) {
        g.fillStyle = chance(next, 0.8) ? '#ffca7a' : '#9adfff';
        g.fillRect(6 + x * 31, gy + 10, 25, 20);
      }
      const awn = style === 1 ? '#c23b4e' : '#1f8a8a';
      for (let x = 0; x < 8; x += 1) {
        g.fillStyle = x % 2 ? awn : '#e8e2d4';
        g.fillRect(x * 16, gy - 7, 16, 7);
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
  scene.fog = new THREE.Fog(PALETTE.fog, 170, 1280);
  const skyTex = canvasTexture(64, 512, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#241243');
    grad.addColorStop(0.42, '#6b3a63');
    grad.addColorStop(0.68, '#d96f7e');
    grad.addColorStop(0.86, '#ff9550');
    grad.addColorStop(1, '#ffc06a');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  });
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(1500, 24, 16),
    new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false }),
  );
  group.add(sky);

  const hemi = new THREE.HemisphereLight(0xb08ae0, 0x3a2a33, 1.5);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(PALETTE.sun, 2.15);
  sun.position.set(-420, 190, 260);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x6db3ff, 0.36);
  fill.position.set(300, 200, -200);
  scene.add(fill);

  // The sun itself: a broad warm halo and a bright core, low over the sea to the west.
  const glowTex = glowTexture('rgba(255,190,110,1)', 'rgba(255,120,40,0)');
  const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, fog: false, depthWrite: false, transparent: true, opacity: 0.95 }));
  sunSprite.position.set(-980, 120, 420);
  sunSprite.scale.setScalar(560);
  group.add(sunSprite);
  const sunCore = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture('rgba(255,244,214,1)', 'rgba(255,190,110,0)'), fog: false, depthWrite: false, transparent: true,
  }));
  sunCore.position.set(-980, 118, 420);
  sunCore.scale.setScalar(190);
  group.add(sunCore);

  // Distant skyline silhouettes: dark towers on the northern horizon and across the
  // bay to the south-west, so every view ends in layered, fog-hazed shapes.
  const silhouetteMat = new THREE.MeshBasicMaterial({ color: 0x452a52 });
  const silhouetteGeo = new THREE.BoxGeometry(1, 1, 1);
  silhouetteGeo.translate(0, 0.5, 0);
  const silhouettes = [];
  for (let x = -640; x <= 640; x += range(next, 46, 84)) {
    silhouettes.push({ x, z: range(next, -585, -520), w: range(next, 30, 58), h: range(next, 55, 165), d: 34 });
  }
  for (let z = -420; z <= 240; z += range(next, 52, 90)) {
    silhouettes.push({ x: range(next, 545, 600), z, w: 34, h: range(next, 45, 130), d: range(next, 30, 55) });
  }
  const silhMesh = new THREE.InstancedMesh(silhouetteGeo, silhouetteMat, silhouettes.length);
  {
    const m = new THREE.Matrix4();
    silhouettes.forEach((s, k) => {
      m.makeScale(s.w, s.h, s.d).setPosition(s.x, 0, s.z);
      silhMesh.setMatrixAt(k, m);
    });
  }
  group.add(silhMesh);
  // A low island across the water, west of the pier: a dark ridge with a small tower,
  // sitting right where the sun goes down.
  const islandMat = new THREE.MeshLambertMaterial({ color: 0x33203e });
  const island = new THREE.Group();
  const ridge = new THREE.Mesh(new THREE.BoxGeometry(120, 13, 30), islandMat);
  ridge.position.set(0, 4, 0);
  island.add(ridge);
  const ridge2 = new THREE.Mesh(new THREE.BoxGeometry(64, 20, 24), islandMat);
  ridge2.position.set(-24, 7, -2);
  island.add(ridge2);
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 4.2, 26, 8), islandMat);
  tower.position.set(18, 16, 0);
  island.add(tower);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(1.7, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd9a0 }));
  beacon.position.set(18, 30.5, 0);
  island.add(beacon);
  island.position.set(-455, 0, SHORE_Z + 105);
  group.add(island);

  // ---- Ground and sea -------------------------------------------------------
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD_SPAN, WORLD_SPAN),
    new THREE.MeshLambertMaterial({ map: groundTexture(next) }),
  );
  ground.rotation.x = -Math.PI / 2;
  group.add(ground);

  const waterTex = canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#174d68';
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
    new THREE.MeshPhongMaterial({ map: waterTex, transparent: true, opacity: 0.9, shininess: 160, specular: 0xffb066 }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, 0.35, SHORE_Z + 196);
  group.add(water);

  // Sparkle: a second, additive skin of glints drifting against the swell.
  const sparkleTex = canvasTexture(256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 340; i += 1) {
      const a = 0.25 + next() * 0.75;
      g.fillStyle = `rgba(255,214,150,${a.toFixed(2)})`;
      g.fillRect(next() * w, next() * h, 1 + next() * 3.2, 1.1);
    }
  }, [30, 12]);
  const sparkle = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD_SPAN, 420),
    new THREE.MeshBasicMaterial({ map: sparkleTex, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  sparkle.rotation.x = -Math.PI / 2;
  sparkle.position.set(0, 0.48, SHORE_Z + 196);
  group.add(sparkle);

  // The sun's glitter path: a soft orange sheen stretched across the water toward
  // the sunset, so the cover shot gets its band of molten light.
  const glitter = new THREE.Mesh(
    new THREE.PlaneGeometry(560, 120),
    new THREE.MeshBasicMaterial({ map: glowTexture('rgba(255,150,70,0.55)', 'rgba(255,120,40,0)'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  glitter.rotation.x = -Math.PI / 2;
  glitter.rotation.z = 0.1;
  glitter.position.set(-330, 0.55, SHORE_Z + 105);
  group.add(glitter);

  // Boats at anchor: a hull, a cabin and a mast, bobbing on the swell (see update).
  const boats = [];
  {
    const hullMat = new THREE.MeshLambertMaterial({ color: 0xe8e4da });
    const hullMat2 = new THREE.MeshLambertMaterial({ color: 0x3b6ec2 });
    const cabinMat = new THREE.MeshLambertMaterial({ color: 0x2b3550 });
    const mastMat = new THREE.MeshLambertMaterial({ color: 0x8a8f99 });
    const boatSpots = [
      { x: -150, z: SHORE_Z + 55, r: 0.7 }, { x: 90, z: SHORE_Z + 130, r: -0.4 },
      { x: -320, z: SHORE_Z + 45, r: 1.9 }, { x: 230, z: SHORE_Z + 75, r: 2.8 },
      { x: LANDMARKS.pier.x + 42, z: SHORE_Z + 34, r: -1.2 }, { x: -40, z: SHORE_Z + 190, r: 0.2 },
    ];
    boatSpots.forEach((s, k) => {
      const boat = new THREE.Group();
      const hull = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.0, 6.4), k % 2 ? hullMat2 : hullMat);
      hull.position.y = 0.55;
      boat.add(hull);
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.9, 2.2), cabinMat);
      cabin.position.set(0, 1.4, -0.4);
      boat.add(cabin);
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 6.5, 5), mastMat);
      mast.position.set(0, 3.6, 0.9);
      boat.add(mast);
      boat.position.set(s.x, 0.3, s.z);
      boat.rotation.y = s.r;
      group.add(boat);
      boats.push({ mesh: boat, phase: k * 1.7 });
    });
  }

  // ---- Buildings ------------------------------------------------------------
  const facades = [
    facadeTexture(next, true, 0), facadeTexture(next, false, 1), facadeTexture(next, false, 2),
    facadeTexture(next, true, 3), facadeTexture(next, false, 4),
  ];
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  boxGeo.translate(0, 0.5, 0); // grow upward from the ground
  const placements = facades.map(() => []);
  const allBuildings = [];
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
        const texIndex = intRange(next, 0, 4);
        placements[texIndex].push({ x, z, w, d, h });
        allBuildings.push({ x, z, w, d, h });
        colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, h });
        // Some street-facing buildings earn a neon sign for the dossier's skyline.
        if (h > 16 && chance(next, 0.42)) {
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
      tint.setHSL(0.08 + next() * 0.75, 0.13, 0.66 + next() * 0.26);
      mesh.setColorAt(k, tint);
    });
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
  });

  // Rooftop props: AC boxes, water towers and antennas, instanced like the towers
  // themselves — they break up the skyline in every high or distant shot.
  {
    const acSpots = [];
    const towerSpots = [];
    const antennaSpots = [];
    for (const b of allBuildings) {
      const n = chance(next, 0.55) ? intRange(next, 1, 3) : 0;
      for (let k = 0; k < n; k += 1) {
        acSpots.push({
          x: b.x + range(next, -b.w / 4, b.w / 4), z: b.z + range(next, -b.d / 4, b.d / 4),
          y: b.h, s: range(next, 1.2, 2.4),
        });
      }
      if (b.h > 22 && chance(next, 0.2)) towerSpots.push({ x: b.x + range(next, -4, 4), z: b.z + range(next, -4, 4), y: b.h });
      if (b.h > 18 && chance(next, 0.3)) antennaSpots.push({ x: b.x + range(next, -b.w / 4, b.w / 4), z: b.z, y: b.h, h: range(next, 3.5, 7) });
    }
    const m = new THREE.Matrix4();
    const acMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1.7, 0.95, 1.7),
      new THREE.MeshLambertMaterial({ color: 0x9aa0ab }), acSpots.length);
    acSpots.forEach((s, k) => {
      m.makeScale(s.s, 1, s.s).setPosition(s.x, s.y + 0.48, s.z);
      acMesh.setMatrixAt(k, m);
    });
    group.add(acMesh);
    const towerMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(1.5, 1.7, 3.1, 8),
      new THREE.MeshLambertMaterial({ color: 0x74513a }), towerSpots.length);
    const roofMesh = new THREE.InstancedMesh(new THREE.ConeGeometry(1.9, 1.3, 8),
      new THREE.MeshLambertMaterial({ color: 0x4a3428 }), towerSpots.length);
    towerSpots.forEach((s, k) => {
      m.identity().setPosition(s.x, s.y + 2.1, s.z);
      towerMesh.setMatrixAt(k, m);
      m.identity().setPosition(s.x, s.y + 4.3, s.z);
      roofMesh.setMatrixAt(k, m);
    });
    group.add(towerMesh);
    group.add(roofMesh);
    const antGeo = new THREE.CylinderGeometry(0.07, 0.12, 1, 5);
    antGeo.translate(0, 0.5, 0);
    const antMesh = new THREE.InstancedMesh(antGeo, new THREE.MeshLambertMaterial({ color: 0x2e2e38 }), antennaSpots.length);
    antennaSpots.forEach((s, k) => {
      m.makeScale(1, s.h, 1).setPosition(s.x, s.y, s.z);
      antMesh.setMatrixAt(k, m);
    });
    group.add(antMesh);
  }

  // Neon signs: glowing boards on the faces the RNG picked, each with a halo sprite
  // tinted to its own colour.
  const signColors = ['#ff4fd8', '#ffb340', '#4fd8ff', '#7dff8a', '#ff5e4d'];
  const haloTexByColor = {
    '#ff4fd8': glowTexture('rgba(255,79,216,0.34)', 'rgba(255,79,216,0)'),
    '#ffb340': glowTexture('rgba(255,179,64,0.34)', 'rgba(255,179,64,0)'),
    '#4fd8ff': glowTexture('rgba(79,216,255,0.34)', 'rgba(79,216,255,0)'),
    '#7dff8a': glowTexture('rgba(125,255,138,0.30)', 'rgba(125,255,138,0)'),
    '#ff5e4d': glowTexture('rgba(255,94,77,0.34)', 'rgba(255,94,77,0)'),
  };
  const signGroup = new THREE.Group();
  signSpots.slice(0, 30).forEach((s, k) => {
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
      map: haloTexByColor[color], depthWrite: false, transparent: true,
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
  special(LANDMARKS.warehouse.x, LANDMARKS.warehouse.z, 30, 11, 20, 0x5f4230, 'PESCA FRIA', '#4fd8ff');
  // Vents and a painted stripe high on its yard face, so the big wall has features.
  const ventMat = new THREE.MeshLambertMaterial({ color: 0x241c16 });
  for (const dz of [-6, 0, 6]) {
    const vent = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.3), ventMat);
    vent.position.set(LANDMARKS.warehouse.x - 15.2, 8.2, LANDMARKS.warehouse.z + dz);
    vent.rotation.y = -Math.PI / 2;
    group.add(vent);
  }
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.7, 19),
    new THREE.MeshLambertMaterial({ color: 0x1f8a8a }));
  stripe.position.set(LANDMARKS.warehouse.x - 15.1, 6.4, LANDMARKS.warehouse.z);
  group.add(stripe);
  // Sliding doors on the faces the story looks at, so the blocks read as buildings
  // with a way in, not coloured bricks.
  const doorMat = new THREE.MeshLambertMaterial({ color: 0x2e2a26 });
  const whDoor = new THREE.Mesh(new THREE.PlaneGeometry(9, 6.4), doorMat);
  whDoor.position.set(LANDMARKS.warehouse.x - 15.2, 3.2, LANDMARKS.warehouse.z);
  whDoor.rotation.y = -Math.PI / 2;
  group.add(whDoor);
  const gaDoor = new THREE.Mesh(new THREE.PlaneGeometry(7.5, 4.6), doorMat);
  gaDoor.position.set(LANDMARKS.garage.x - 10.2, 2.3, LANDMARKS.garage.z);
  gaDoor.rotation.y = -Math.PI / 2;
  group.add(gaDoor);
  // A yard floodlight over the warehouse crates: one real spotlight, so the third
  // mission's shootout plays in a pool of hard white light instead of dusk murk.
  const floodPole = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 13, 6),
    new THREE.MeshLambertMaterial({ color: 0x2e2e38 }));
  floodPole.position.set(LANDMARKS.warehouse.x - 29, 6.5, LANDMARKS.warehouse.z + 14);
  group.add(floodPole);
  const floodHead = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.5, 0.6),
    new THREE.MeshBasicMaterial({ color: 0xfff3d0 }));
  floodHead.position.set(LANDMARKS.warehouse.x - 29, 13.1, LANDMARKS.warehouse.z + 14);
  group.add(floodHead);
  const flood = new THREE.SpotLight(0xfff0d0, 620, 85, 0.78, 0.65, 1.4);
  flood.position.set(LANDMARKS.warehouse.x - 29, 13, LANDMARKS.warehouse.z + 14);
  flood.target.position.set(LANDMARKS.warehouse.x - 15, 0, LANDMARKS.warehouse.z - 2);
  group.add(flood);
  group.add(flood.target);
  // Crates stacked outside the warehouse (cover for the shootout, and solid).
  const crateGeo = new THREE.BoxGeometry(2.4, 2.4, 2.4);
  const crateMats = [0x8a6b42, 0x6e7a4a, 0x9a5f3c].map((c) => new THREE.MeshLambertMaterial({ color: c }));
  for (let k = 0; k < 9; k += 1) {
    const cx = LANDMARKS.warehouse.x - 22 + (k % 3) * 5.5;
    const cz = LANDMARKS.warehouse.z - 8 + Math.floor(k / 3) * 6;
    const crate = new THREE.Mesh(crateGeo, crateMats[k % crateMats.length]);
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
  // Lamp globes along both edges of the deck, a dotted line of light over the water.
  {
    const lampSpots = [];
    for (let z = SHORE_Z + 4; z < PIER_END_Z - 4; z += 11) {
      lampSpots.push({ x: LANDMARKS.pier.x - 4.5, z });
      lampSpots.push({ x: LANDMARKS.pier.x + 4.5, z });
    }
    const postGeo = new THREE.CylinderGeometry(0.07, 0.09, 1.9, 5);
    postGeo.translate(0, 0.95, 0);
    const globeGeo = new THREE.SphereGeometry(0.3, 8, 6);
    globeGeo.translate(0, 2.05, 0);
    const posts = new THREE.InstancedMesh(postGeo, pierMat, lampSpots.length);
    const globes = new THREE.InstancedMesh(globeGeo, new THREE.MeshBasicMaterial({ color: 0xffe2b0 }), lampSpots.length);
    const m = new THREE.Matrix4();
    lampSpots.forEach((s, k) => {
      m.identity().setPosition(s.x, 2.0, s.z);
      posts.setMatrixAt(k, m);
      globes.setMatrixAt(k, m);
    });
    group.add(posts);
    group.add(globes);
  }

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

  // Street furniture at the corners: litter bins and planters, one instanced mesh,
  // so pavements have the small clutter real streets collect.
  {
    const spots = [];
    for (const ax of AVENUES_X) {
      for (const sz of STREETS_Z) {
        if (chance(next, 0.4)) spots.push({ x: ax + CITY.roadHalf + 2.2, z: sz + CITY.roadHalf + 2.2 });
        if (chance(next, 0.3)) spots.push({ x: ax - CITY.roadHalf - 2.2, z: sz - CITY.roadHalf - 2.2 });
      }
    }
    const binGeo = new THREE.CylinderGeometry(0.55, 0.48, 1.15, 7);
    binGeo.translate(0, 0.58, 0);
    const bins = new THREE.InstancedMesh(binGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), spots.length);
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    spots.forEach((s, k) => {
      m.identity().setPosition(s.x, 0, s.z);
      bins.setMatrixAt(k, m);
      bins.setColorAt(k, c.setHex(k % 3 === 0 ? 0xb0563a : 0x2e4a3a));
    });
    group.add(bins);
  }
  // Pools of light on the asphalt under each lamp: one instanced additive plane.
  const poolGeo = new THREE.PlaneGeometry(14, 14);
  poolGeo.rotateX(-Math.PI / 2);
  const pools = new THREE.InstancedMesh(
    poolGeo,
    new THREE.MeshBasicMaterial({ map: glowTexture('rgba(255,190,110,0.27)', 'rgba(255,190,110,0)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
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

  // The boardwalk: a plank deck running the length of the beach over the sand.
  const boardTex = canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#8a6844';
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(50,30,14,0.55)';
    for (let x = 0; x < w; x += 16) g.fillRect(x, 0, 2, h);
    g.fillStyle = 'rgba(255,220,170,0.10)';
    for (let x = 8; x < w; x += 16) g.fillRect(x, 0, 5, h);
  }, [90, 1]);
  const boardwalk = new THREE.Mesh(
    new THREE.BoxGeometry(1120, 0.22, 8),
    new THREE.MeshLambertMaterial({ map: boardTex }),
  );
  boardwalk.position.set(0, 0.11, SHORE_Z - 20);
  group.add(boardwalk);

  // Beach umbrellas: coloured cones on poles, with towels spread beneath some.
  const umbGeo = new THREE.ConeGeometry(2.4, 1.1, 8);
  umbGeo.translate(0, 2.6, 0);
  const umbPoleGeo = new THREE.CylinderGeometry(0.05, 0.05, 2.4, 5);
  umbPoleGeo.translate(0, 1.2, 0);
  const umbColors = [0xff5e7a, 0x4fd8ff, 0xffb340, 0x7dff8a, 0xff8c42, 0xf4f1ea];
  const umbCount = 26;
  const umbs = new THREE.InstancedMesh(umbGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), umbCount);
  const umbPoles = new THREE.InstancedMesh(umbPoleGeo, new THREE.MeshLambertMaterial({ color: 0xd8d8de }), umbCount);
  const towelGeo = new THREE.PlaneGeometry(1.1, 2.0);
  towelGeo.rotateX(-Math.PI / 2);
  const towels = new THREE.InstancedMesh(towelGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), 14);
  {
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    for (let k = 0; k < umbCount; k += 1) {
      const ux = range(next, blockX(0), blockX(CITY.cols - 1));
      const uz = SHORE_Z - range(next, 5, 15);
      m.identity().setPosition(ux, 0, uz);
      umbs.setMatrixAt(k, m);
      umbPoles.setMatrixAt(k, m);
      umbs.setColorAt(k, c.setHex(umbColors[k % umbColors.length]));
      if (k < 14) {
        m.identity().setPosition(ux + range(next, -1.6, 1.6), 0.06, uz + range(next, 1, 2.4));
        towels.setMatrixAt(k, m);
        towels.setColorAt(k, c.setHex(umbColors[(k + 2) % umbColors.length]));
      }
    }
  }
  group.add(umbs);
  group.add(umbPoles);
  group.add(towels);

  // A lifeguard stand watching the water, midway along the beach.
  {
    const stand = new THREE.Group();
    const legMat = new THREE.MeshLambertMaterial({ color: 0xe8e2d4 });
    for (const [lx, lz] of [[-1.1, -0.8], [1.1, -0.8], [-1.1, 0.8], [1.1, 0.8]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.18, 3.1, 0.18), legMat);
      leg.position.set(lx, 1.55, lz);
      stand.add(leg);
    }
    const hut = new THREE.Mesh(new THREE.BoxGeometry(2.9, 1.5, 2.2), new THREE.MeshLambertMaterial({ color: 0xff5e7a }));
    hut.position.y = 3.8;
    stand.add(hut);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(2.5, 1.0, 4), new THREE.MeshLambertMaterial({ color: 0xf4f1ea }));
    roof.position.y = 5.05;
    roof.rotation.y = Math.PI / 4;
    stand.add(roof);
    stand.position.set(blockX(5) + 30, 0, SHORE_Z - 12);
    group.add(stand);
  }

  // Clouds: soft pink-lit blobs drifting high over the bay (sprites, no fog so they
  // stay luminous against the dusk).
  const cloudTex = canvasTexture(256, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const blob = (x, y, r, a) => {
      const grad = g.createRadialGradient(x, y, 2, x, y, r);
      grad.addColorStop(0, `rgba(255,225,205,${a})`);
      grad.addColorStop(1, 'rgba(255,225,205,0)');
      g.fillStyle = grad;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    };
    blob(80, 78, 52, 0.85);
    blob(128, 64, 62, 0.95);
    blob(178, 78, 48, 0.8);
    blob(110, 88, 55, 0.7);
    blob(150, 88, 50, 0.7);
  });
  const clouds = [];
  for (let k = 0; k < 14; k += 1) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: cloudTex, color: 0xffc0a8, transparent: true, opacity: range(next, 0.34, 0.6), depthWrite: false, fog: false,
    }));
    sprite.position.set(range(next, -750, 750), range(next, 130, 240), range(next, -520, 560));
    sprite.scale.set(range(next, 200, 340), range(next, 44, 74), 1);
    group.add(sprite);
    clouds.push(sprite);
  }

  // Gulls over the beach: two-triangle birds on wide circles, wings flapping.
  const birds = [];
  {
    const birdMat = new THREE.MeshBasicMaterial({ color: 0x241631, side: THREE.DoubleSide });
    for (let k = 0; k < 11; k += 1) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(18), 3));
      const mesh = new THREE.Mesh(geo, birdMat);
      mesh.frustumCulled = false;
      group.add(mesh);
      birds.push({
        mesh,
        cx: range(next, -160, 160), cz: SHORE_Z - range(next, 10, 130),
        r: range(next, 60, 190), h: range(next, 34, 68),
        speed: range(next, 0.05, 0.11) * (next() < 0.5 ? 1 : -1),
        phase: range(next, 0, Math.PI * 2), flap: range(next, 7, 10),
      });
    }
  }

  // The hero spot for the cover: on the beachfront avenue, facing the sunset and the skyline.
  const heroCarSpot = { x: blockX(4) - 12, z: BEACH_AVENUE_Z, heading: Math.PI / 2 };

  let flicker = 0;
  return {
    colliders,
    heroCarSpot,
    /** Animate the sea, the boats, the clouds and the gulls; let one sign buzz. */
    update(dt, elapsed) {
      waterTex.offset.set(elapsed * 0.008, elapsed * 0.005);
      sparkleTex.offset.set(-elapsed * 0.013, elapsed * 0.004);
      for (const b of boats) {
        b.mesh.position.y = 0.3 + Math.sin(elapsed * 0.85 + b.phase) * 0.16;
        b.mesh.rotation.z = Math.sin(elapsed * 0.6 + b.phase) * 0.03;
      }
      for (const c of clouds) {
        c.position.x += dt * 1.4;
        if (c.position.x > 820) c.position.x = -820;
      }
      for (const b of birds) {
        const a = elapsed * b.speed + b.phase;
        const x = b.cx + Math.cos(a) * b.r;
        const z = b.cz + Math.sin(a) * b.r * 0.62;
        const y = b.h + Math.sin(elapsed * 0.6 + b.phase) * 2.4;
        b.mesh.position.set(x, y, z);
        const s = Math.sign(b.speed);
        b.mesh.rotation.y = Math.atan2(-Math.sin(a) * s, Math.cos(a) * 0.62 * s);
        const flapY = Math.sin(elapsed * b.flap + b.phase) * 0.42;
        const p = b.mesh.geometry.attributes.position.array;
        // Nose, tail, and the two wing triangles fanning from the body line.
        p[0] = 0; p[1] = 0; p[2] = 0.62; p[3] = 0; p[4] = 0; p[5] = -0.5; p[6] = -1.25; p[7] = flapY; p[8] = -0.12;
        p[9] = 0; p[10] = 0; p[11] = 0.62; p[12] = 1.25; p[13] = flapY; p[14] = -0.12; p[15] = 0; p[16] = 0; p[17] = -0.5;
        b.mesh.geometry.attributes.position.needsUpdate = true;
      }
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
