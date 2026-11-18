// random.js — a small seeded random number generator (mulberry32) and the helpers the city
// builder and the screenshot stager share. A fixed seed must always grow the same city, so
// the screenshots and the skyline never depend on Math.random.

/** Create a generator from a 32-bit seed. Each call returns a float in [0, 1). */
export function createRandom(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A float in [min, max) from a generator made by createRandom. */
export function range(next, min, max) {
  return min + next() * (max - min);
}

/** An integer in [min, max] (both ends included) from a generator. */
export function intRange(next, min, max) {
  return min + Math.floor(next() * (max - min + 1));
}

/** One item of an array, chosen by a generator. */
export function pick(next, items) {
  return items[Math.floor(next() * items.length)];
}

/** True with the given probability (0..1) on a generator's next roll. */
export function chance(next, probability) {
  return next() < probability;
}
