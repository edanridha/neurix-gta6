// config.js — the numbers and names that define Neon Tides: Solmaris.
// Everything the other modules agree on lives here: the city's shape, the colours of the
// sunset, the cast of the story and the words they say. Original names throughout: Solmaris
// is an invented coastal city, and Dario, Lucia, Vex and Captain Reyes are invented people.

/** The game's public name, shown on the title screen and in the save file. */
export const GAME_TITLE = 'Neon Tides: Solmaris';

/** localStorage key for the save slot (money, story progress, position). */
export const SAVE_KEY = 'neon-tides-solmaris-save-v1';

/**
 * The city grid. Blocks are square; a road runs along every grid line. Block (i, j) has its
 * centre at (i * PITCH, j * PITCH) and the coast lies toward +Z: the last two rows are the
 * beachfront avenue, the sand and the sea.
 */
export const CITY = {
  cols: 9, // blocks east-west (x)
  rows: 8, // blocks north-south (z), row 0 is the north edge
  pitch: 76, // centre-to-centre distance between neighbouring blocks
  roadHalf: 9, // half the width of a road, so a road is 18 m wide
  blockHalf: 29, // half the width of a block's buildable square
};

/**
 * World-space z of the shoreline: the last block row's centre plus a promenade, the
 * beachfront avenue and the sand. South of this line is open water.
 */
export const SHORE_Z = ((CITY.rows - 1) / 2) * CITY.pitch + 106;
/** World-space z where the wooden pier ends over the water. */
export const PIER_END_Z = SHORE_Z + 95;
/** The whole playable ground spans this many metres in x and z (centred on 0, 0). */
export const WORLD_SPAN = 1240;

/** Sunset palette: the game is set in the last hour of light, sliding into neon dusk. */
export const PALETTE = {
  sky: 0x2e1a47,
  skyHorizon: 0xff9550,
  fog: 0x74355c,
  sun: 0xffc06a,
  ambient: 0x9a7bd0,
  water: 0x174d68,
  waterGlow: 0x2e7ea6,
  sand: 0xe3c08a,
  asphalt: 0x38333d,
  sidewalk: 0x9a95a0,
  plaza: 0x4c4550,
};

/** Neon sign words for the city's invented shops, bars and clubs. */
export const NEON_SIGNS = [
  'HOTEL MARINA', 'CLUB VELVET', 'TIDE BAR', 'PALMS CASINO', 'NOODLE 9',
  'SOLMARIS DINER', 'DISCO NAU', 'KITE SURF', 'HOTEL BRISA', 'CLUB FARO',
  'TACOS LUNA', 'PIER 9', 'NEON GYM', 'BAR CORAL', 'CINE OLE',
];

/** Car paint jobs the city drives in. */
export const CAR_COLORS = [0xc23b4e, 0x3b6ec2, 0xe0a51f, 0x39b56a, 0xd8d8de, 0x22242c, 0x7a4fd0, 0xe8e8e8, 0x1f8a8a, 0xd96c2c, 0xff6b9d, 0x9be7c4, 0xf4f1ea, 0x274690];

/** The cast: name → the colour their dialogue is tinted with on screen. */
export const CAST = {
  dario: { name: 'Dario', color: '#ffb340' },
  lucia: { name: 'Lucia', color: '#ff7ad9' },
  vex: { name: 'Vex Marlowe', color: '#7dff8a' },
  reyes: { name: 'Capt. Reyes', color: '#6db3ff' },
  radio: { name: 'Police radio', color: '#6db3ff' },
};

/** Player tuning. */
export const PLAYER = {
  walkSpeed: 6.2,
  runSpeed: 10.5,
  radius: 0.85,
  health: 100,
  reachCar: 4.2, // how close to a car the E prompt works
};

/** Car tuning shared by every vehicle; individual cars vary it a little. */
export const CAR = {
  accel: 26,
  brake: 42,
  drag: 0.55,
  maxSpeed: 46, // m/s, ~165 km/h
  maxReverse: 12,
  steer: 0.62, // radians of front-wheel angle at full lock
  radius: 2.3,
};

/** Wanted-level tuning: how fast heat builds and cools. */
export const WANTED = {
  max: 5,
  decayPerSecond: 0.055, // heat lost per second while no police officer can see the player
  sightRange: 90, // police spot the player inside this
  bustFillSeconds: 2.6, // standing next to an officer this long while wanted = busted
};
