import { useState, useEffect, useRef, useCallback } from 'react';
import { colors, sim } from './config';
import {
  createState,
  step,
  snapshot,
  act as engineAct,
  type GameState,
  type Action
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

export function useSim() {
  const [state, setState] = useState<GameState>(() => createState());
  const [mode, setModeState] = useState<'manual' | 'ai'>('ai');
  const [ai, setAi] = useState<AiState>({
    source: '',
    why: 'Initializing LLM controller...'
  });
  const [press, setPress] = useState<PressInfo | null>(null);

  const stateRef = useRef<GameState>(state);
  stateRef.current = state;

  const modeRef = useRef<'manual' | 'ai'>(mode);
  modeRef.current = mode;

  const isCallingRef = useRef(false);
  const lastAiCallTimeRef = useRef(0);
  const actionQueueRef = useRef<QueuedAction[]>([]);
  const isExecutingQueueRef = useRef(false);
  const queueTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Helper to trigger a React re-render of current state
  const forceRender = useCallback(() => {
    setState({ ...stateRef.current });
  }, []);

  // Process queued actions sequentially with animated button presses
  const runQueue = useCallback(async () => {
    if (isExecutingQueueRef.current) return;
    isExecutingQueueRef.current = true;

    while (actionQueueRef.current.length > 0) {
      if (modeRef.current !== 'ai' || stateRef.current.failed) {
        actionQueueRef.current = [];
        setPress(null);
        break;
      }

      const item = actionQueueRef.current.shift()!;
      const beltIndex = colors.findIndex(c => c.key === item.belt);
      if (beltIndex === -1) continue;

      const belt = stateRef.current.belts[beltIndex];
      if (belt.down > 0) continue; // Skip if belt is under repair

      // 1. Press down the button
      setPress({ belt: beltIndex, action: item.action });

      await new Promise(r => {
        queueTimeoutRef.current = setTimeout(r, sim.aiPressMs);
      });

      // 2. Execute the action in the engine
      engineAct(stateRef.current, beltIndex, item.action, 'AI', item.reason);
      forceRender();

      // 3. Release button
      setPress(null);

      // 4. Gap between actions
      await new Promise(r => {
        queueTimeoutRef.current = setTimeout(r, sim.aiGapMs);
      });
    }

    isExecutingQueueRef.current = false;
  }, [forceRender]);

  // Request AI instructions from the server
  const callAi = useCallback(
    async (event: string) => {
      if (modeRef.current !== 'ai' || stateRef.current.failed) return;
      if (isCallingRef.current) return;

      isCallingRef.current = true;
      lastAiCallTimeRef.current = stateRef.current.t;

      try {
        const snap = snapshot(stateRef.current, event);
        const res = await fetch('/api/control', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(snap)
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        const src = (data.source === 'gemini' || data.source === 'LLM' || data.source === 'llm')
          ? 'LLM'
          : 'Rules';

        setAi({
          source: src,
          why: data.summary || 'Balancing conveyor throughput.'
        });

        if (Array.isArray(data.actions) && data.actions.length > 0) {
          actionQueueRef.current.push(...data.actions);
          runQueue();
        }
      } catch (err) {
        console.error('AI call failed:', err);
        setAi(prev => ({
          ...prev,
          source: prev.source || 'Rules',
          why: 'Controller communication retrying...'
        }));
      } finally {
        isCallingRef.current = false;
      }
    },
    [runQueue]
  );

  // Set mode handler
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
    [callAi]
  );

  // Manual action handler
  const act = useCallback(
    (beltIndex: number, action: Action) => {
      if (modeRef.current === 'ai') return;
      engineAct(stateRef.current, beltIndex, action, 'You');
      forceRender();
    },
    [forceRender]
  );

  // Reset simulation
  const reset = useCallback(() => {
    if (queueTimeoutRef.current) clearTimeout(queueTimeoutRef.current);
    actionQueueRef.current = [];
    isExecutingQueueRef.current = false;
    isCallingRef.current = false;
    setPress(null);

    const fresh = createState();
    stateRef.current = fresh;
    setState(fresh);

    if (modeRef.current === 'ai') {
      callAi('ai_enabled');
    }
  }, [callAi]);

  // Main simulation tick loop
  useEffect(() => {
    let animId: number;
    let lastTime = performance.now();
    let prevPattern = [...stateRef.current.pattern];
    const prevDowns = stateRef.current.belts.map(b => b.down > 0);

    const loop = (now: number) => {
      const dt = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;

      const s = stateRef.current;
      if (!s.failed) {
        step(s, dt);

        // Check if pattern changed
        const currentPattern = s.pattern;
        const patternChanged =
          currentPattern.length !== prevPattern.length ||
          currentPattern.some((c, idx) => c !== prevPattern[idx]);

        if (patternChanged) {
          prevPattern = [...currentPattern];
          if (modeRef.current === 'ai') {
            callAi('pattern_changed');
          }
        }

        // Check repair state changes
        s.belts.forEach((b, i) => {
          const isDown = b.down > 0;
          if (isDown && !prevDowns[i]) {
            prevDowns[i] = true;
            if (modeRef.current === 'ai') {
              callAi(`repair_started:${colors[i].key}`);
            }
          } else if (!isDown && prevDowns[i]) {
            prevDowns[i] = false;
            if (modeRef.current === 'ai') {
              callAi(`repair_finished:${colors[i].key}`);
            }
          }
        });

        // Periodic AI check
        if (
          modeRef.current === 'ai' &&
          s.t - lastAiCallTimeRef.current >= sim.aiEverySeconds &&
          !isCallingRef.current &&
          actionQueueRef.current.length === 0
        ) {
          callAi('periodic');
        }

        forceRender();
      }

      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);

    // Initial AI kickoff
    if (modeRef.current === 'ai') {
      callAi('ai_enabled');
    }

    return () => {
      cancelAnimationFrame(animId);
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
    reset
  };
}
