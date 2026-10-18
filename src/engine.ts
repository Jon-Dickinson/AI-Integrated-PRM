import { colors, sim } from './config';

export type Action = 'increase_speed' | 'decrease_speed' | 'add_block' | 'remove_block';

export interface Belt {
  blocks: number;
  level: number;
  rel: number;          // time accumulator toward next batch
  items: number[];      // positions of items currently on the belt (0 → 1)
  down: number;         // remaining repair downtime (seconds)
  done: number;         // total items this belt has delivered
}

export interface LogEntry {
  t: number;            // game time when the entry was created
  who: 'You' | 'AI';
  text: string;
  why?: string;
}

export interface GameState {
  t: number;            // elapsed game time (seconds)
  fill: number[];       // color indices currently in the container
  pattern: number[];    // current required color indices
  patternLeft: number;  // seconds until the pattern refreshes
  rem: number;          // time accumulator for the periodic remove step
  nextRepair: number;   // seconds until the next random repair is scheduled
  failed: boolean;
  belts: Belt[];
  log: LogEntry[];
}

export interface SuggestedAction {
  belt: string;         // color key, e.g. "yellow"
  action: Action;
  reason: string;
}

export const capacity = sim.cols * sim.rows;

const randomColorIndex = () => Math.floor(Math.random() * colors.length);

export const newPattern = () =>
  Array.from({ length: sim.patternSize }, randomColorIndex);

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
    done: 0,
  })),
});

export function note(
  state: GameState,
  who: 'You' | 'AI',
  text: string,
  why?: string,
) {
  state.log.unshift({ t: state.t, who, text, why });
  if (state.log.length > 300) {
    state.log.pop();
  }
}

export function act(
  state: GameState,
  beltIndex: number,
  action: Action,
  who: 'You' | 'AI' = 'You',
  why?: string,
): boolean {
  const belt = state.belts[beltIndex];
  if (state.failed || belt.down > 0) return false;

  const maxLevel = sim.speedLevels.length - 1;
  let success = false;

  if (action === 'increase_speed' && belt.level < maxLevel) {
    belt.level++;
    success = true;
  } else if (action === 'decrease_speed' && belt.level > 0) {
    belt.level--;
    success = true;
  } else if (action === 'add_block' && belt.blocks < sim.batch.max) {
    belt.blocks++;
    success = true;
  } else if (action === 'remove_block' && belt.blocks > sim.batch.min) {
    belt.blocks--;
    success = true;
  }

  if (success) {
    note(
      state,
      who,
      `${colors[beltIndex].name} ${action.replace('_', ' ')}`,
      why,
    );
  }
  return success;
}

function removeMatchingPattern(state: GameState) {
  const needed = colors.map(() => 0);
  const available = colors.map(() => 0);

  state.pattern.forEach((colorIndex) => needed[colorIndex]++);
  state.fill.forEach((colorIndex) => available[colorIndex]++);

  const canRemove = needed.every(
    (count, colorIndex) => available[colorIndex] >= count,
  );
  if (!canRemove) return;

  for (const colorIndex of state.pattern) {
    const index = state.fill.indexOf(colorIndex);
    if (index !== -1) {
      state.fill.splice(index, 1);
    }
  }
}

/** How many of each color the pattern lists (raw membership counts). */
function getPatternCounts(): number[] {
  // placeholder – real counts come from state.pattern
  return colors.map(() => 0);
}

/**
 * Remaining demand per color after subtracting:
 *  1. items already in the container
 *  2. items already in-flight on that color's belt
 */
function getPatternDemand(state: GameState): number[] {
  const demand = colors.map(() => 0);
  state.pattern.forEach((colorIndex) => demand[colorIndex]++);

  // Subtract what is already sitting in the container
  state.fill.forEach((colorIndex) => {
    if (demand[colorIndex] > 0) demand[colorIndex]--;
  });

  // Subtract items already on the belt (they will arrive soon)
  state.belts.forEach((belt, beltIndex) => {
    let inFlight = belt.items.length;
    while (inFlight > 0 && demand[beltIndex] > 0) {
      demand[beltIndex]--;
      inFlight--;
    }
  });

  return demand;
}

/** True for every color that appears at least once in the current pattern. */
function getPatternMembership(state: GameState): boolean[] {
  const membership = colors.map(() => false);
  state.pattern.forEach((colorIndex) => {
    membership[colorIndex] = true;
  });
  return membership;
}

/** Current throughput (items / second) of a belt. */
function throughput(belt: Belt): number {
  const interval = sim.speedLevels[belt.level].interval;
  return belt.blocks / interval;
}

/**
 * Rules-based optimizer.
 *
 * Objective:
 * 1. Keep the container as empty as possible.
 * 2. Only produce colours that appear in the current pattern.
 * 3. When the pattern changes, immediately throttle colours that are no longer relevant.
 * 4. When a high-relevance belt breaks, compensate by boosting other needed colours.
 * 5. Account for in-flight items so we do not over-produce.
 */
export function suggestActions(
  state: GameState,
  _event = 'periodic',
): SuggestedAction[] {
  if (state.failed) return [];

  const demand = getPatternDemand(state);
  const membership = getPatternMembership(state);
  const suggestions: SuggestedAction[] = [];

  const maxLevel = sim.speedLevels.length - 1;
  const maxActions = sim.aiMaxActions ?? 6;

  const containerCounts = colors.map(() => 0);
  state.fill.forEach((colorIndex) => {
    containerCounts[colorIndex]++;
  });

  const patternCounts = colors.map(() => 0);
  state.pattern.forEach((colorIndex) => {
    patternCounts[colorIndex]++;
  });

  // ------------------------------------------------------------------
  // 1. Hard-throttle any belt whose colour is NOT in the pattern
  //    Emit as many actions as needed (up to maxActions) to drive
  //    batch size and speed toward minimum quickly.
  // ------------------------------------------------------------------
  state.belts.forEach((belt, beltIndex) => {
    if (belt.down > 0) return;
    if (membership[beltIndex]) return;
    if (suggestions.length >= maxActions) return;

    const colorKey = colors[beltIndex].key;

    // Drain batch size first
    if (belt.blocks > sim.batch.min) {
      suggestions.push({
        belt: colorKey,
        action: 'remove_block',
        reason: `${colorKey} is not in the target pattern; reducing batch to minimise waste`,
      });
    }
    // Then lower speed
    if (belt.level > 0 && suggestions.length < maxActions) {
      suggestions.push({
        belt: colorKey,
        action: 'decrease_speed',
        reason: `${colorKey} is not in the target pattern; slowing belt to minimum`,
      });
    }
  });

  // ------------------------------------------------------------------
  // 2. For colours that ARE in the pattern, keep production matched
  //    to remaining demand (container + in-flight already subtracted).
  // ------------------------------------------------------------------
  const containerPressure = state.fill.length / capacity;

  state.belts.forEach((belt, beltIndex) => {
    if (belt.down > 0) return;
    if (!membership[beltIndex]) return;
    if (suggestions.length >= maxActions) return;

    const colorKey = colors[beltIndex].key;
    const remaining = demand[beltIndex];
    const currentRate = throughput(belt);
    const inBox = containerCounts[beltIndex];
    const needed = patternCounts[beltIndex];

    // Still short of what the pattern requires in the box → boost hard
    const shortfall = needed - inBox;
    if (shortfall > 0) {
      // Prefer speed, then batch size
      if (belt.level < maxLevel) {
        suggestions.push({
          belt: colorKey,
          action: 'increase_speed',
          reason: `Target needs ${needed} ${colorKey}; only ${inBox} in box – increasing speed`,
        });
      } else if (belt.blocks < sim.batch.max) {
        suggestions.push({
          belt: colorKey,
          action: 'add_block',
          reason: `Target needs ${needed} ${colorKey}; only ${inBox} in box – increasing batch size`,
        });
      }
      return;
    }

    // Enough (or more) already in the box for this pattern slot.
    // If residual demand is 0 and we are still producing fast, ease off.
    if (remaining <= 0 && currentRate > 0.15) {
      if (belt.blocks > sim.batch.min) {
        suggestions.push({
          belt: colorKey,
          action: 'remove_block',
          reason: `Enough ${colorKey} already in box / in-flight – reduce batch to avoid surplus`,
        });
      } else if (belt.level > 0) {
        suggestions.push({
          belt: colorKey,
          action: 'decrease_speed',
          reason: `Enough ${colorKey} already in box / in-flight – slow belt to avoid surplus`,
        });
      }
      return;
    }

    // Fine-tune rate toward finishing remaining demand before pattern expires
    const secondsLeft = Math.max(state.patternLeft, 1);
    const idealRate = Math.max(remaining / secondsLeft, 0.05);
    const pressureFactor = containerPressure > 0.7 ? 0.5 : 1.0;
    const targetRate = idealRate * pressureFactor;

    if (currentRate < targetRate * 0.85) {
      if (belt.level < maxLevel) {
        suggestions.push({
          belt: colorKey,
          action: 'increase_speed',
          reason: `Need ${remaining} more ${colorKey} – increase speed (target ${targetRate.toFixed(2)}/s)`,
        });
      } else if (belt.blocks < sim.batch.max) {
        suggestions.push({
          belt: colorKey,
          action: 'add_block',
          reason: `Need ${remaining} more ${colorKey} – increase batch size`,
        });
      }
    } else if (currentRate > targetRate * 1.4 && remaining <= 1) {
      if (belt.blocks > sim.batch.min) {
        suggestions.push({
          belt: colorKey,
          action: 'remove_block',
          reason: `Almost enough ${colorKey} – reduce batch to avoid surplus`,
        });
      } else if (belt.level > 0) {
        suggestions.push({
          belt: colorKey,
          action: 'decrease_speed',
          reason: `Almost enough ${colorKey} – slow belt to avoid surplus`,
        });
      }
    }
  });

  // ------------------------------------------------------------------
  // 3. Repair compensation: if a pattern colour is down, boost other
  //    pattern colours that still have demand.
  // ------------------------------------------------------------------
  const brokenRelevant = state.belts.some(
    (belt, idx) => belt.down > 0 && membership[idx],
  );

  if (brokenRelevant) {
    state.belts.forEach((belt, beltIndex) => {
      if (belt.down > 0) return;
      if (!membership[beltIndex]) return;
      if (demand[beltIndex] <= 0) return;
      if (suggestions.length >= maxActions) return;

      const colorKey = colors[beltIndex].key;

      if (belt.level < maxLevel) {
        suggestions.push({
          belt: colorKey,
          action: 'increase_speed',
          reason: `Compensating for broken pattern belt – boost ${colorKey}`,
        });
      } else if (belt.blocks < sim.batch.max) {
        suggestions.push({
          belt: colorKey,
          action: 'add_block',
          reason: `Compensating for broken pattern belt – larger batches of ${colorKey}`,
        });
      }
    });
  }

  return suggestions.slice(0, maxActions);
}

export function step(state: GameState, deltaTime: number) {
  if (state.failed) return;

  state.t += deltaTime;
  state.patternLeft -= deltaTime;

  if (state.patternLeft <= 0) {
    state.pattern = newPattern();
    state.patternLeft += sim.patternSeconds;
  }

  state.nextRepair -= deltaTime;
  const anyBeltUnderRepair = state.belts.some((belt) => belt.down > 0);
  if (state.nextRepair <= 0 && !anyBeltUnderRepair) {
    const randomBelt = state.belts[randomColorIndex()];
    randomBelt.down = sim.repair.seconds;
    state.nextRepair =
      sim.repair.minGap +
      Math.random() * (sim.repair.maxGap - sim.repair.minGap);
  }

  state.belts.forEach((belt, beltIndex) => {
    if (belt.down > 0) {
      belt.down = Math.max(0, belt.down - deltaTime);
      return;
    }

    const speedLevel = sim.speedLevels[belt.level];
    belt.rel += deltaTime;

    if (belt.rel >= speedLevel.interval) {
      belt.rel -= speedLevel.interval;
      for (let offset = 0; offset < belt.blocks; offset++) {
        belt.items.push(-offset * sim.batch.spacing);
      }
    }

    const remainingItems: number[] = [];
    for (const position of belt.items) {
      const newPosition = position + deltaTime / speedLevel.travel;
      if (newPosition >= 1) {
        state.fill.push(beltIndex);
        belt.done++;
      } else {
        remainingItems.push(newPosition);
      }
    }
    belt.items = remainingItems;
  });

  state.rem += deltaTime;
  if (state.rem >= sim.removeEvery) {
    state.rem = 0;
    removeMatchingPattern(state);
  }

  if (state.fill.length >= capacity) {
    state.failed = true;
  }
}

export function snapshot(state: GameState, event = 'periodic') {
  const counts: Record<string, number> = {};
  colors.forEach((color) => {
    counts[color.key] = 0;
  });
  state.fill.forEach((colorIndex) => {
    counts[colors[colorIndex].key]++;
  });

  const demand = getPatternDemand(state);
  const membership = getPatternMembership(state);

  return {
    event,
    elapsed_s: Math.round(state.t),
    capacity_pct: Math.round((state.fill.length / capacity) * 100),
    pattern: state.pattern.map((colorIndex) => colors[colorIndex].key),
    pattern_seconds_left: Math.round(state.patternLeft),
    container_counts: counts,

    remaining_demand: Object.fromEntries(
      colors.map((color, idx) => [color.key, demand[idx]]),
    ),
    objective:
      'Minimise blocks in the container. Only produce colours that appear in the current pattern. Throttle irrelevant belts immediately when the pattern changes. Account for in-flight items. Compensate when a pattern belt is under repair.',

    belts: state.belts.map((belt, beltIndex) => ({
      color: colors[beltIndex].key,
      blocks_per_batch: belt.blocks,
      interval_s: sim.speedLevels[belt.level].interval,
      throughput_per_s: +throughput(belt).toFixed(2),
      status: belt.down > 0 ? 'repair' : 'running',
      repair_left_s: Math.ceil(belt.down),
      in_pattern: membership[beltIndex],
      remaining_needed: demand[beltIndex],
      in_flight: belt.items.length,
    })),
  };
}