// Everything tunable lives here: simulation rules and presentation.

export const colors = [
  { key: 'yellow', name: 'Yellow', light: '#ffb21e', dark: '#f58a07' },
  { key: 'red',    name: 'Red',    light: '#ff5c5c', dark: '#e32f2f' },
  { key: 'green',  name: 'Green',  light: '#6fd16f', dark: '#43a347' },
  { key: 'blue',   name: 'Blue',   light: '#3b8cff', dark: '#1f63e0' },
] as const;

export const sim = {
  // Grid size of the collection container
  cols: 32,
  rows: 57,

  // Target pattern that the player / AI must fill
  patternSize: 4,          // how many items the pattern asks for
  patternSeconds: 20,      // how long a pattern stays active

  // How often completed patterns are removed from the container
  removeEvery: 0.5,        // seconds between removal checks

  // Random belt repair events
  repair: {
    seconds: 5,            // how long a belt stays down
    minGap: 15,            // minimum seconds between repair events
    maxGap: 30,            // maximum seconds between repair events
  },

  // AI controller timing
  aiEverySeconds: 6,       // how often the AI is polled while idle
  aiMinGapSeconds: 3,      // (reserved) minimum gap between AI calls
  aiMaxActions: 6,         // (reserved) max actions the AI may return at once
  aiPressMs: 350,          // visual button-press duration
  aiGapMs: 450,            // pause between successive AI actions

  // Batch size controls (blocks released together)
  batch: {
    min: 1,
    max: 4,
    start: 1,
    spacing: 0.08,         // initial offset between blocks in a batch (0–1)
  },

  // Starting speed level index (0 = slowest)
  startLevel: 1,

  // Speed tiers. Index 0 = slowest.
  // - interval : seconds between batches
  // - travel   : seconds for a block to travel the full belt length
  // - wheelRev : seconds per wheel revolution (lower = faster spin)
  speedLevels: [
    { interval: 4, travel: 3.2, wheelRev: 3.0 },
    { interval: 3, travel: 2.6, wheelRev: 2.0 },
    { interval: 2, travel: 2.0, wheelRev: 1.2 },
    { interval: 1, travel: 1.5, wheelRev: 0.7 },
  ],
};

export const theme = {
  font: '"Poppins","Segoe UI",system-ui,sans-serif',
  bg: 'radial-gradient(ellipse at 70% 100%,#0b4476 0,#030c2b 55%,#020819)',
  text: '#e8eefc',
  muted: '#9fb0d4',
  line: '#cdd6ea',
  panelBg: '#020a26',

  belt: {
    length: 440,       // pixel length of the conveyor track
    trackHeight: 16,
    gap: 20,           // vertical gap between belts
    panel: 104,        // width of the left control panel
    block: 18,         // height/width of each color block on the belt
  },

  wheel: {
    count: 7,          // number of wheels under each belt
    size: 24,
    spokes: 3,
    border: 2,
  },

  container: {
    cell: 11,          // size of each grid cell
    dot: 8,            // size of the filled item dots
    border: '#fff',
  },

  log: {
    width: 320,
    slideMs: 450,      // animation duration when new log entries appear
  },
};

export type AppTheme = typeof theme;