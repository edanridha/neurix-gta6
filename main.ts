// Neon Tides: Solmaris — hand-in program for the make.fun "Make GTA 6" bounty (gta6-01).
//
// The game itself is the static site in game/ (open game/index.html in a desktop browser and
// play; it loads nothing from the network). This program's only job is to hand that game in:
// it copies game/ and screenshots/ into the output directory and writes dossier.json there
// with buildDossier from the kit's library in vendor/, which the scorer re-runs and compares
// byte for byte, so the dossier must be produced by that library and nothing else.
//
// Run it the way the grader does (no MAKEFUN_OUTPUT_DIR set, output goes to /output):
//   node main.ts
// or locally, to inspect what would be handed in:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

/** The repository root: the directory this file sits in, wherever it is checked out. */
const repoRoot = fileURLToPath(new URL('.', import.meta.url));

/** Where the entry goes: /output for the grader, $MAKEFUN_OUTPUT_DIR when run by hand. */
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** Copy one directory tree from the repository into the output, creating what is missing. */
function handOver(name: string): void {
  const from = join(repoRoot, name);
  const to = join(outputDir, name);
  mkdirSync(to, { recursive: true });
  if (existsSync(from)) cpSync(from, to, { recursive: true });
}

mkdirSync(outputDir, { recursive: true });
handOver('game');
handOver('screenshots');

// The caps below are the scorer's own (see the gate in the kit's RULES.txt): at most four
// screenshots of 256 KiB each, at most 993 entries and 48 MiB under game/, no game/ path over
// 1,000 bytes, and the dossier text capped at 160 KiB. Passing them here means the dossier we
// write is exactly the one the scorer rebuilds from the same files.
const dossier = buildDossier(outputDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
});
writeFileSync(join(outputDir, 'dossier.json'), dossier);
