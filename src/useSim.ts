import { useState, useEffect, useRef, useCallback } from 'react';
import { colors, sim } from './config';
import {
  createState,
  step,
  snapshot,
  act as engineAct,
  type GameState,
  type Action,
} from './engine';

export interface AiState {
  source: string; // 'LLM' | 'Rules'
  why: string;
}

export interface PressInfo {
  belt: number;
  action: Action;
}

interface QueuedAction {
  belt: string;
  action: Action;
  reason?: string;
}

/** Deep-ish snapshot so React always sees new array references for items/fill. */
function cloneForReact(live: GameState): GameState {
  return {
    ...live,
    fill: [...live.fill],
    pattern: [...live.pattern],
    log: live.log.slice(),
    belts: live.belts.map((belt) => ({
      ...belt,
      items: [...belt.items],
    })),
  };
}

export function useSim() {
  // Live mutable engine state — the animation loop mutates this object only.
  // React state is a read-only copy used purely for rendering.
  const stateRef = useRef<GameState>(createState());

  const [state, setState] = useState<GameState>(() =>
    cloneForReact(stateRef.current),
  );
  const [mode, setModeState] = useState<'manual' | 'ai'>('ai');
  const [ai, setAi] = useState<AiState>({
    source: '',
    why: 'Initializing LLM controller...',
  });
  const [press, setPress] = useState<PressInfo | null>(null);

  const modeRef = useRef<'manual' | 'ai'>(mode);
  modeRef.current = mode;

  const isCallingAiRef = useRef(false);
  const lastAiCallTimeRef = useRef(0);
  const actionQueueRef = useRef<QueuedAction[]>([]);
  const isExecutingQueueRef = useRef(false);
  const queueTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Push a fresh copy of the live engine state into React
  const forceRender = useCallback(() => {
    setState(cloneForReact(stateRef.current));
  }, []);

  // Process queued AI actions one-by-one with press animation
  const runQueue = useCallback(async () => {
    if (isExecutingQueueRef.current) return;
    isExecutingQueueRef.current = true;

    while (actionQueueRef.current.length > 0) {
      if (modeRef.current !== 'ai' || stateRef.current.failed) {
        actionQueueRef.current = [];
        setPress(null);
        break;
      }

      const queued = actionQueueRef.current.shift()!;
      const beltIndex = colors.findIndex((color) => color.key === queued.belt);
      if (beltIndex === -1) continue;

      const belt = stateRef.current.belts[beltIndex];
      if (belt.down > 0) continue;

      setPress({ belt: beltIndex, action: queued.action });

      await new Promise((resolve) => {
        queueTimeoutRef.current = setTimeout(resolve, sim.aiPressMs);
      });

      engineAct(
        stateRef.current,
        beltIndex,
        queued.action,
        'AI',
        queued.reason,
      );
      forceRender();

      setPress(null);

      await new Promise((resolve) => {
        queueTimeoutRef.current = setTimeout(resolve, sim.aiGapMs);
      });
    }

    isExecutingQueueRef.current = false;
  }, [forceRender]);

  const callAi = useCallback(
    async (event: string) => {
      if (modeRef.current !== 'ai' || stateRef.current.failed) return;
      if (isCallingAiRef.current) return;

      isCallingAiRef.current = true;
      lastAiCallTimeRef.current = stateRef.current.t;

      try {
        const snap = snapshot(stateRef.current, event);
        const response = await fetch('/api/control', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(snap),
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();

        const source =
          data.source === 'gemini' ||
          data.source === 'LLM' ||
          data.source === 'llm'
            ? 'LLM'
            : 'Rules';

        setAi({
          source,
          why: data.summary || 'Balancing conveyor throughput.',
        });

        if (Array.isArray(data.actions) && data.actions.length > 0) {
          actionQueueRef.current.push(...data.actions);
          runQueue();
        }
      } catch (error) {
        console.error('AI call failed:', error);
        setAi((previous) => ({
          ...previous,
          source: previous.source || 'Rules',
          why: 'Controller communication retrying...',
        }));
      } finally {
        isCallingAiRef.current = false;
      }
    },
    [runQueue],
  );

  const setMode = useCallback(
    (newMode: 'manual' | 'ai') => {
      setModeState(newMode);
      modeRef.current = newMode;

      if (newMode === 'manual') {
        actionQueueRef.current = [];
        setPress(null);
      } else {
        callAi('ai_enabled');
      }
    },
    [callAi],
  );

  const act = useCallback(
    (beltIndex: number, action: Action) => {
      if (modeRef.current === 'ai') return;
      engineAct(stateRef.current, beltIndex, action, 'You');
      forceRender();
    },
    [forceRender],
  );

  const reset = useCallback(() => {
    if (queueTimeoutRef.current) clearTimeout(queueTimeoutRef.current);

    actionQueueRef.current = [];
    isExecutingQueueRef.current = false;
    isCallingAiRef.current = false;
    setPress(null);

    const freshState = createState();
    stateRef.current = freshState;
    setState(cloneForReact(freshState));

    if (modeRef.current === 'ai') {
      callAi('ai_enabled');
    }
  }, [callAi]);

  // Main simulation + AI tick loop
  useEffect(() => {
    let animationFrameId: number;
    let lastFrameTime = performance.now();

    let previousPattern = [...stateRef.current.pattern];
    const previousRepairStates = stateRef.current.belts.map(
      (belt) => belt.down > 0,
    );

    const loop = (now: number) => {
      const deltaTime = Math.min((now - lastFrameTime) / 1000, 0.1);
      lastFrameTime = now;

      const currentState = stateRef.current;

      if (!currentState.failed) {
        step(currentState, deltaTime);

        // Detect pattern change
        const currentPattern = currentState.pattern;
        const patternChanged =
          currentPattern.length !== previousPattern.length ||
          currentPattern.some(
            (colorIndex, index) => colorIndex !== previousPattern[index],
          );

        if (patternChanged) {
          previousPattern = [...currentPattern];
          if (modeRef.current === 'ai') {
            callAi('pattern_changed');
          }
        }

        // Detect repair start / finish on each belt
        currentState.belts.forEach((belt, beltIndex) => {
          const isUnderRepair = belt.down > 0;

          if (isUnderRepair && !previousRepairStates[beltIndex]) {
            previousRepairStates[beltIndex] = true;
            if (modeRef.current === 'ai') {
              callAi(`repair_started:${colors[beltIndex].key}`);
            }
          } else if (!isUnderRepair && previousRepairStates[beltIndex]) {
            previousRepairStates[beltIndex] = false;
            if (modeRef.current === 'ai') {
              callAi(`repair_finished:${colors[beltIndex].key}`);
            }
          }
        });

        // Periodic AI poll
        const timeSinceLastAiCall =
          currentState.t - lastAiCallTimeRef.current;
        if (
          modeRef.current === 'ai' &&
          timeSinceLastAiCall >= sim.aiEverySeconds &&
          !isCallingAiRef.current &&
          actionQueueRef.current.length === 0
        ) {
          callAi('periodic');
        }

        forceRender();
      }

      animationFrameId = requestAnimationFrame(loop);
    };

    animationFrameId = requestAnimationFrame(loop);

    if (modeRef.current === 'ai') {
      callAi('ai_enabled');
    }

    return () => {
      cancelAnimationFrame(animationFrameId);
      if (queueTimeoutRef.current) clearTimeout(queueTimeoutRef.current);
    };
  }, [callAi, forceRender]);

  return {
    state,
    mode,
    ai,
    press,
    setMode,
    act,
    reset,
  };
}