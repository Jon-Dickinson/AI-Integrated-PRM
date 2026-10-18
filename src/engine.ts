import { colors, sim } from './config';

export type Action = 'increase_speed' | 'decrease_speed' | 'add_block' | 'remove_block';

export interface Belt {
  blocks: number;
  level: number;
  rel: number;
  items: number[];
  down: number;
  done: number;
}

export interface LogEntry {
  t: number;
  who: 'You' | 'AI';
  text: string;
  why?: string;
}

export interface GameState {
  t: number;
  fill: number[];
  pattern: number[];
  patternLeft: number;
  rem: number;
  nextRepair: number;
  failed: boolean;
  belts: Belt[];
  log: LogEntry[];
}

export const capacity = sim.cols * sim.rows;

const ri = () => Math.floor(Math.random() * colors.length);
export const newPattern = () => Array.from({ length: sim.patternSize }, ri);

export const createState = (): GameState => ({
  t: 0,
  fill: [],
  pattern: newPattern(),
  patternLeft: sim.patternSeconds,
  rem: 0,
  nextRepair: 12,
  failed: false,
  log: [],
  belts: colors.map(() => ({
    blocks: sim.batch.start,
    level: sim.startLevel,
    rel: 0,
    items: [],
    down: 0,
    done: 0
  }))
});

export function note(s: GameState, who: 'You' | 'AI', text: string, why?: string) {
  s.log.unshift({ t: s.t, who, text, why });
  if (s.log.length > 300) s.log.pop();
}

export function act(s: GameState, i: number, a: Action, who: 'You' | 'AI' = 'You', why?: string): boolean {
  const b = s.belts[i];
  if (s.failed || b.down > 0) return false;
  const top = sim.speedLevels.length - 1;
  let ok = false;
  if (a === 'increase_speed' && b.level < top) {
    b.level++;
    ok = true;
  } else if (a === 'decrease_speed' && b.level > 0) {
    b.level--;
    ok = true;
  } else if (a === 'add_block' && b.blocks < sim.batch.max) {
    b.blocks++;
    ok = true;
  } else if (a === 'remove_block' && b.blocks > sim.batch.min) {
    b.blocks--;
    ok = true;
  }
  if (ok) note(s, who, `${colors[i].name} ${a.replace('_', ' ')}`, why);
  return ok;
}

function removeSet(s: GameState) {
  const need = colors.map(() => 0);
  const have = colors.map(() => 0);
  s.pattern.forEach(c => need[c]++);
  s.fill.forEach(c => have[c]++);
  if (need.every((n, c) => have[c] >= n)) {
    for (const c of s.pattern) {
      const idx = s.fill.indexOf(c);
      if (idx !== -1) {
        s.fill.splice(idx, 1);
      }
    }
  }
}

export function step(s: GameState, dt: number) {
  if (s.failed) return;
  s.t += dt;
  s.patternLeft -= dt;
  if (s.patternLeft <= 0) {
    s.pattern = newPattern();
    s.patternLeft += sim.patternSeconds;
  }
  s.nextRepair -= dt;
  if (s.nextRepair <= 0 && !s.belts.some(b => b.down > 0)) {
    s.belts[ri()].down = sim.repair.seconds;
    s.nextRepair = sim.repair.minGap + Math.random() * (sim.repair.maxGap - sim.repair.minGap);
  }
  s.belts.forEach((b, i) => {
    if (b.down > 0) {
      b.down = Math.max(0, b.down - dt);
      return;
    }
    const lvl = sim.speedLevels[b.level];
    b.rel += dt;
    if (b.rel >= lvl.interval) {
      b.rel -= lvl.interval;
      for (let j = 0; j < b.blocks; j++) {
        b.items.push(-j * sim.batch.spacing);
      }
    }
    const keep: number[] = [];
    for (const x of b.items) {
      const nx = x + dt / lvl.travel;
      if (nx >= 1) {
        s.fill.push(i);
        b.done++;
      } else {
        keep.push(nx);
      }
    }
    b.items = keep;
  });
  s.rem += dt;
  if (s.rem >= sim.removeEvery) {
    s.rem = 0;
    removeSet(s);
  }
  if (s.fill.length >= capacity) s.failed = true;
}

export function snapshot(s: GameState, event = 'periodic') {
  const counts: Record<string, number> = {};
  colors.forEach(c => (counts[c.key] = 0));
  s.fill.forEach(c => counts[colors[c].key]++);
  return {
    event,
    elapsed_s: Math.round(s.t),
    capacity_pct: Math.round((s.fill.length / capacity) * 100),
    pattern: s.pattern.map(c => colors[c].key),
    pattern_seconds_left: Math.round(s.patternLeft),
    container_counts: counts,
    belts: s.belts.map((b, i) => ({
      color: colors[i].key,
      blocks_per_batch: b.blocks,
      interval_s: sim.speedLevels[b.level].interval,
      throughput_per_s: +(b.blocks / sim.speedLevels[b.level].interval).toFixed(2),
      status: b.down > 0 ? 'repair' : 'running',
      repair_left_s: Math.ceil(b.down)
    }))
  };
}
