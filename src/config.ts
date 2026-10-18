// Everything tunable lives here: simulation rules and presentation.
export const colors = [
  { key: 'yellow', name: 'Yellow', light: '#ffb21e', dark: '#f58a07' },
  { key: 'red', name: 'Red', light: '#ff5c5c', dark: '#e32f2f' },
  { key: 'green', name: 'Green', light: '#6fd16f', dark: '#43a347' },
  { key: 'blue', name: 'Blue', light: '#3b8cff', dark: '#1f63e0' }
] as const;

export const sim = {
  cols: 32,
  rows: 57,
  patternSize: 4,
  patternSeconds: 20,
  removeEvery: 0.5,
  repair: { seconds: 5, minGap: 15, maxGap: 30 },
  aiEverySeconds: 6,
  aiMinGapSeconds: 3,
  aiMaxActions: 6,
  aiPressMs: 350,
  aiGapMs: 450,
  batch: { min: 1, max: 4, start: 1, spacing: 0.08 },
  startLevel: 1,
  // index 0 = slowest. interval: seconds between batches; travel: seconds for a block to cross;
  // wheelRev: seconds per wheel revolution (lower = faster spin).
  speedLevels: [
    { interval: 4, travel: 3.2, wheelRev: 3.0 },
    { interval: 3, travel: 2.6, wheelRev: 2.0 },
    { interval: 2, travel: 2.0, wheelRev: 1.2 },
    { interval: 1, travel: 1.5, wheelRev: 0.7 }
  ]
};

export const theme = {
  font: '"Poppins","Segoe UI",system-ui,sans-serif',
  bg: 'radial-gradient(ellipse at 70% 100%,#0b4476 0,#030c2b 55%,#020819)',
  text: '#e8eefc',
  muted: '#9fb0d4',
  line: '#cdd6ea',
  panelBg: '#020a26',
  belt: { length: 440, trackHeight: 16, block: 20, panel: 104 },
  wheel: { count: 7, size: 24, spokes: 3, border: 2 },
  container: { cell: 11, dot: 8, border: '#fff' },
  log: { width: 320, slideMs: 450 }
};

export type AppTheme = typeof theme;
