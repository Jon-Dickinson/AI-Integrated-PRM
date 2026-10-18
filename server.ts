import dotenv from 'dotenv';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();
if (!process.env.GEMINI_API_KEY) {
  dotenv.config({ path: '.env.local' });
}
if (!process.env.GEMINI_API_KEY) {
  dotenv.config({ path: '.env.example' });
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rawKey = process.env.GEMINI_API_KEY;
const isPlaceholder = rawKey === 'MY_GEMINI_API_KEY' || rawKey === '"MY_GEMINI_API_KEY"';
const KEY = (rawKey && !isPlaceholder && rawKey.trim() !== '') ? rawKey.replace(/^["']|["']$/g, '').trim() : undefined;

// Default to gemini-3.1-flash-lite which has generous free tier limits for simulation loops
const rawModel = process.env.GEMINI_MODEL;
let activeModel = (rawModel && !rawModel.includes('2.5') && !rawModel.includes('2.0') && !rawModel.includes('1.5') && rawModel !== 'gemini-3.8-flash')
  ? rawModel
  : 'gemini-3.1-flash-lite';

const PORT = Number(process.env.PORT) || 3000;
const BELTS = ['yellow', 'red', 'green', 'blue'];
const ACTS = ['increase_speed', 'decrease_speed', 'add_block', 'remove_block'];

interface BeltSnap {
  color: string;
  blocks_per_batch: number;
  interval_s: number;
  throughput_per_s?: number;
  status: string;
  repair_left_s?: number;
}

interface Snapshot {
  event?: string;
  elapsed_s?: number;
  capacity_pct: number;
  pattern: string[];
  pattern_seconds_left?: number;
  container_counts?: Record<string, number>;
  belts: BeltSnap[];
}

interface Act {
  belt: string;
  action: string;
  reason?: string;
}

interface Result {
  summary: string;
  actions: Act[];
  source: 'LLM' | 'Rules';
}

const PROMPT = `You control 4 conveyor belts (yellow, red, green, blue) that drop colored blocks into a shared container. You are the automated AI controller.

CONTROLS AVAILABLE FOR EACH BELT:
- "increase_speed": Lowers interval_s by 1s (faster belt, drops more often, min 1s).
- "decrease_speed": Raises interval_s by 1s (slower belt, drops less often, max 4s).
- "add_block": Increases blocks_per_batch by 1 (drops more blocks at once, max 4).
- "remove_block": Decreases blocks_per_batch by 1 (drops fewer blocks at once, min 1).
Throughput = blocks_per_batch / interval_s (min 0.25 blocks/sec, max 4.00 blocks/sec).

SIMULATION MECHANICS:
- The container removes blocks ONLY when a full "pattern" (e.g. [yellow, yellow, yellow, yellow] or [yellow, red, green, blue]) is matched.
- Any color not in the target pattern remains trapped in the container, rapidly wasting capacity. If capacity reaches 100%, the simulation overflows and fails!

CRITICAL CONTROLLER RULES:
1. STRICTLY MINIMIZE UNUSED COLORS:
   Whenever a color has 0 occurrences in the target pattern (for example, if the pattern contains 4 yellow blocks, red, green, and blue have 0 occurrences):
   You MUST immediately throttle that color to the absolute minimum throughput (0.25 blocks/sec):
   - Call "decrease_speed" if its interval_s < 4 (to slow the belt down to interval 4s).
   - Call "remove_block" if its blocks_per_batch > 1 (to reduce the batch to 1 block).
   Every extra block of an unused color hurts container capacity!

2. MAXIMIZE AND MATCH NEEDED COLORS:
   If a color appears in the pattern (e.g. 4 yellow blocks):
   - Strongly boost that color using "increase_speed" (towards interval 1s) and "add_block" (towards 4 blocks/batch) to clear the pattern rapidly.
   - If multiple colors are needed (e.g. 2 red, 1 green, 1 blue), balance their throughputs proportionally (2:1:1).

3. HANDLE BREAKDOWNS:
   If a needed belt is under "repair", slow down the other belts with "decrease_speed" and "remove_block" so surplus blocks do not flood the container while waiting for the repair to finish.

Return ONLY JSON:
{
  "summary": string (1 concise sentence explaining your strategy),
  "actions": [
    up to 6 of {
      "belt": "yellow" | "red" | "green" | "blue",
      "action": "increase_speed" | "decrease_speed" | "add_block" | "remove_block",
      "reason": string (max 85 chars, explaining why you increased or decreased speed/batch)
    }
  ]
}`;

function rules(s: Snapshot): Omit<Result, 'source'> {
  const need: Record<string, number> = {};
  s.pattern.forEach(c => (need[c] = (need[c] || 0) + 1));
  const blocked = s.belts.find(b => b.status !== 'running' && need[b.color]);
  const [ev, evColor] = (s.event || '').split(':');
  const actions: Act[] = [];

  for (const b of s.belts) {
    if (b.status !== 'running') continue;

    if (!need[b.color] || blocked) {
      // Color NOT in target pattern (e.g. Red, Blue, Green when target is 4 Yellow) -> reduce to minimum!
      if (b.interval_s < 4) {
        actions.push({
          belt: b.color,
          action: 'decrease_speed',
          reason: blocked
            ? `${blocked.color} belt is under repair; slowing ${b.color} to avoid overflow.`
            : `${b.color} is not in the target pattern; slowing belt to minimum.`
        });
      }
      if (b.blocks_per_batch > 1) {
        actions.push({
          belt: b.color,
          action: 'remove_block',
          reason: blocked
            ? `${blocked.color} belt is under repair; reducing ${b.color} batch to minimum.`
            : `${b.color} is not in the target pattern; reducing block batch to 1.`
        });
      }
    } else {
      // Color IS in target pattern -> scale up!
      const count = need[b.color];
      const wantSpeed = count >= 2 ? 1 : 2; // interval 1s (fastest) if 2+ blocks needed
      const wantBatch = count; // 1 to 4 blocks

      if (b.blocks_per_batch < wantBatch) {
        actions.push({
          belt: b.color,
          action: 'add_block',
          reason: `Target needs ${count} ${b.color}; increasing batch size to ${wantBatch}.`
        });
      } else if (b.blocks_per_batch > wantBatch) {
        actions.push({
          belt: b.color,
          action: 'remove_block',
          reason: `Target needs only ${count} ${b.color}; reducing batch size to match.`
        });
      }

      if (b.interval_s > wantSpeed) {
        actions.push({
          belt: b.color,
          action: 'increase_speed',
          reason: `Target needs ${count} ${b.color}; speeding up belt to ${wantSpeed}s interval.`
        });
      } else if (b.interval_s < wantSpeed) {
        actions.push({
          belt: b.color,
          action: 'decrease_speed',
          reason: `Adjusting speed to match ${count} ${b.color} target ratio.`
        });
      }
    }
  }

  const uniqueNeeded = Object.keys(need);
  const summary = blocked
    ? `${blocked.color} is needed but under repair; holding other colors back.`
    : uniqueNeeded.length === 1
    ? `Target requires 4 ${uniqueNeeded[0]}; maximizing ${uniqueNeeded[0]} and throttling all other colors to minimum.`
    : ev === 'pattern_changed'
    ? `New pattern (${s.pattern.join(', ')}); recalibrating belt throughput.`
    : ev === 'repair_finished'
    ? `${evColor} repaired; restoring normal speeds.`
    : 'Matching belt throughput and batch sizes to current target pattern.';

  return { summary, actions: actions.slice(0, 6) };
}

const clean = (r: { summary?: unknown; actions?: Act[] }) => ({
  summary: String(r.summary ?? ''),
  actions: (Array.isArray(r.actions) ? r.actions : [])
    .filter(a => BELTS.includes(a.belt) && ACTS.includes(a.action))
    .map(a => ({
      belt: a.belt,
      action: a.action,
      reason: typeof a.reason === 'string' ? a.reason.slice(0, 140) : undefined
    }))
    .slice(0, 6)
});

async function requestGemini(modelName: string, s: Snapshot) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': KEY!,
        'User-Agent': 'aistudio-build'
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${PROMPT}\n\nState:\n${JSON.stringify(s)}` }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.2
        }
      })
    }
  );

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Gemini HTTP ${res.status}: ${errBody}`);
  }

  const data = (await res.json()) as {
    candidates: { content: { parts: { text: string }[] } }[];
  };

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('No text candidate in Gemini response');
  return JSON.parse(text);
}

async function control(s: Snapshot): Promise<Result> {
  if (!KEY) {
    return { ...rules(s), source: 'Rules' };
  }

  const modelsToTry = [activeModel, 'gemini-3.1-flash-lite'].filter(
    (v, i, a) => a.indexOf(v) === i
  );

  for (const m of modelsToTry) {
    try {
      const parsed = await requestGemini(m, s);
      activeModel = m; // Remember working model
      return { ...clean(parsed), source: 'LLM' };
    } catch (e) {
      const msg = (e as Error).message || '';
      if (msg.includes('429')) {
        console.warn(`[AI Control] ${m} quota limit reached (20/day limit on 3.8-flash). Switching to gemini-3.1-flash-lite.`);
        activeModel = 'gemini-3.1-flash-lite';
      } else {
        console.warn(`[AI Control] Model ${m} call failed:`, msg.slice(0, 120));
      }
    }
  }

  console.error('[AI Control] Model calls failed; falling back to Rules');
  return { ...rules(s), source: 'Rules' };
}

async function startServer() {
  const app = express();
  app.use(express.json());

  // API status check
  app.get('/api/status', (_req, res) => {
    res.json({
      configured: !!KEY,
      model: activeModel,
      source: KEY ? 'LLM' : 'Rules'
    });
  });

  // Download project ZIP
  app.get(['/api/download-zip', '/download'], (_req, res) => {
    const zipPath = path.resolve(__dirname, 'public', 'prm-app.zip');
    res.download(zipPath, 'prm-app.zip', err => {
      if (err) {
        console.error('Failed to send zip:', err);
        if (!res.headersSent) res.status(500).json({ error: 'Failed to download zip' });
      }
    });
  });

  // AI decision control route
  app.post('/api/control', async (req, res) => {
    const s = req.body as Snapshot;
    if (!s || !Array.isArray(s.belts) || !Array.isArray(s.pattern)) {
      return res.status(400).json({ error: 'Invalid state snapshot' });
    }
    const result = await control(s);
    res.json(result);
  });

  // Vite middleware in dev or static files in production
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  } else {
    const { createServer } = await import('vite');
    const vite = await createServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on port ${PORT}`);
    if (KEY) {
      console.log(`AI Controller active: Gemini LLM (${activeModel})`);
    } else if (isPlaceholder) {
      console.log(`AI Controller active: Rules (GEMINI_API_KEY is still set to placeholder "MY_GEMINI_API_KEY". Paste your real key in .env)`);
    } else {
      console.log(`AI Controller active: Rules (No GEMINI_API_KEY found in .env)`);
    }
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
