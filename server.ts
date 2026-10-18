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

const PROMPT = `You control 4 conveyor belts (yellow, red, green, blue) that fill a container with colored blocks. You are the only controller.
Each belt drops "blocks_per_batch" (1-4) blocks every "interval_s" (1-4) seconds. Throughput = blocks_per_batch / interval_s (min 0.25, max 4 per second).
The container automatically removes any set of blocks matching "pattern" (e.g. yellow,yellow,red,green) about twice a second when enough of each color exist; colors outside the pattern are never removed until the pattern changes (every 20s). If capacity_pct reaches 100 the simulation fails.
"event" says why you were called: pattern_changed, repair_started:<color>, repair_finished:<color>, ai_enabled or periodic.
Goal: keep capacity_pct low by sending colors in proportion to the pattern and keeping non-pattern colors at minimum throughput.
Belts with status "repair" cannot be changed. If a color the pattern needs is under repair, slow the other belts to minimum so surplus does not pile up; when it is repaired, speed them back up.
Return ONLY JSON: {"summary": string (max 1 sentence), "actions": [up to 6 of {"belt":"yellow|red|green|blue","action":"increase_speed|decrease_speed|add_block|remove_block","reason": string (max 90 chars, plain language)}]}. increase_speed lowers interval_s by 1; add_block raises blocks_per_batch by 1.`;

function rules(s: Snapshot): Omit<Result, 'source'> {
  const need: Record<string, number> = {};
  s.pattern.forEach(c => (need[c] = (need[c] || 0) + 1));
  const blocked = s.belts.find(b => b.status !== 'running' && need[b.color]);
  const [ev, evColor] = (s.event || '').split(':');
  const press = s.capacity_pct > 50 ? 1.5 : 1;
  const actions: Act[] = [];

  for (const b of s.belts) {
    if (b.status !== 'running') continue;
    let want: number;
    let reason: string;

    if (blocked) {
      want = 0.25;
      reason = `${blocked.color} belt is under repair, so ${b.color} slows to avoid surplus.`;
    } else if (need[b.color]) {
      want = need[b.color] * 0.3 * press;
      reason = ev === 'repair_finished'
        ? `${evColor} belt is back; restoring ${b.color} to ${need[b.color]} per set.`
        : `Pattern needs ${need[b.color]} ${b.color} per set.`;
    } else {
      want = 0.25;
      reason = `${b.color} is not in the pattern, so it stays at minimum.`;
    }

    const thr = b.blocks_per_batch / b.interval_s;
    if (thr < want * 0.8) {
      actions.push({ belt: b.color, action: b.interval_s > 1 ? 'increase_speed' : 'add_block', reason });
    } else if (thr > want * 1.3) {
      actions.push({ belt: b.color, action: b.interval_s < 4 ? 'decrease_speed' : 'remove_block', reason });
    }
  }

  const summary = blocked
    ? `${blocked.color} is needed but under repair; holding other colors back.`
    : ev === 'pattern_changed'
    ? `New pattern (${s.pattern.join(', ')}); recalibrating belts.`
    : ev === 'repair_finished'
    ? `${evColor} repaired; restoring normal speeds.`
    : 'Matching belt throughput to the current pattern.';

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
