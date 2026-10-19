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
const isPlaceholder =
  rawKey === 'MY_GEMINI_API_KEY' ||
  rawKey === '"MY_GEMINI_API_KEY"' ||
  rawKey === "'MY_GEMINI_API_KEY'";
const KEY =
  rawKey && !isPlaceholder && rawKey.trim() !== ''
    ? rawKey.replace(/^["']|["']$/g, '').trim()
    : undefined;

// Model comes only from env — no hardcoded fallbacks or filters
const activeModel = (process.env.GEMINI_MODEL ?? '')
  .replace(/^["']|["']$/g, '')
  .trim();

const PORT = Number(process.env.PORT) || 3000;
const BELTS = ['yellow', 'red', 'green', 'blue'] as const;
const ACTS = [
  'increase_speed',
  'decrease_speed',
  'add_block',
  'remove_block',
] as const;

interface BeltSnap {
  color: string;
  blocks_per_batch: number;
  interval_s: number;
  throughput_per_s?: number;
  status: string;
  repair_left_s?: number;
  in_pattern?: boolean;
  remaining_needed?: number;
  in_flight?: number;
}

interface Snapshot {
  event?: string;
  elapsed_s?: number;
  capacity_pct: number;
  pattern: string[];
  pattern_seconds_left?: number;
  container_counts?: Record<string, number>;
  remaining_demand?: Record<string, number>;
  objective?: string;
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

CONTROLS (per belt):
- "increase_speed": faster drops (lower interval, min 1s)
- "decrease_speed": slower drops (higher interval, max 4s)
- "add_block": more blocks per batch (max 4)
- "remove_block": fewer blocks per batch (min 1)
Throughput = blocks_per_batch / interval_s (about 0.25–4.0 /s).

MECHANICS:
- Container only removes blocks when a full pattern set is present.
- Colors NOT in the pattern stay in the container and waste capacity.
- At 100% capacity the simulation fails.

RULES (follow strictly):
1. Colors with 0 occurrences in pattern → throttle to minimum (interval 4, batch 1) using decrease_speed / remove_block.
2. Colors in the pattern that still need more blocks (see remaining_demand / in_pattern / container_counts) → boost with increase_speed / add_block.
3. If a NEEDED belt is under repair, boost OTHER needed colors; do NOT throttle needed colors. Only throttle non-pattern colors.
4. Prefer at most 6 actions. Be decisive on pattern changes.

Return ONLY JSON:
{
  "summary": "one short sentence",
  "actions": [
    { "belt": "yellow"|"red"|"green"|"blue", "action": "increase_speed"|"decrease_speed"|"add_block"|"remove_block", "reason": "max 85 chars" }
  ]
}`;

function rules(s: Snapshot): Omit<Result, 'source'> {
  const need: Record<string, number> = {};
  s.pattern.forEach((c) => {
    need[c] = (need[c] || 0) + 1;
  });

  const counts = s.container_counts ?? {};
  const blockedNeeded = s.belts.find(
    (b) => b.status !== 'running' && need[b.color],
  );
  const [ev, evColor] = (s.event || '').split(':');
  const actions: Act[] = [];

  for (const b of s.belts) {
    if (b.status !== 'running') continue;

    const inPattern = !!need[b.color];

    if (!inPattern) {
      if (b.interval_s < 4) {
        actions.push({
          belt: b.color,
          action: 'decrease_speed',
          reason: `${b.color} is not in the target pattern; slowing belt to minimum.`,
        });
      }
      if (b.blocks_per_batch > 1) {
        actions.push({
          belt: b.color,
          action: 'remove_block',
          reason: `${b.color} is not in the target pattern; reducing batch to 1.`,
        });
      }
      continue;
    }

    const inBox = counts[b.color] ?? 0;
    const required = need[b.color];
    const shortfall = required - inBox;

    if (shortfall > 0 || blockedNeeded) {
      if (b.interval_s > 1) {
        actions.push({
          belt: b.color,
          action: 'increase_speed',
          reason: blockedNeeded
            ? `Compensating for ${blockedNeeded.color} repair; speeding ${b.color}.`
            : `Target needs ${required} ${b.color}; only ${inBox} in box – increase speed.`,
        });
      }
      if (b.blocks_per_batch < Math.min(4, Math.max(required, 2))) {
        actions.push({
          belt: b.color,
          action: 'add_block',
          reason: `Target needs ${required} ${b.color}; increasing batch size.`,
        });
      }
    } else if (b.blocks_per_batch > 1 && b.interval_s <= 1) {
      actions.push({
        belt: b.color,
        action: 'remove_block',
        reason: `Enough ${b.color} in box; reduce batch to avoid surplus.`,
      });
    }
  }

  const uniqueNeeded = Object.keys(need);
  const summary = blockedNeeded
    ? `${blockedNeeded.color} needed but under repair; boosting other pattern colors.`
    : uniqueNeeded.length === 1
      ? `Target requires ${need[uniqueNeeded[0]]} ${uniqueNeeded[0]}; maximizing it and throttling others.`
      : ev === 'pattern_changed'
        ? `New pattern (${s.pattern.join(', ')}); recalibrating throughput.`
        : ev === 'repair_finished'
          ? `${evColor} repaired; restoring pattern speeds.`
          : 'Matching belt throughput to current target pattern.';

  return { summary, actions: actions.slice(0, 6) };
}

const clean = (r: { summary?: unknown; actions?: Act[] }) => ({
  summary: String(r.summary ?? ''),
  actions: (Array.isArray(r.actions) ? r.actions : [])
    .filter(
      (a) =>
        BELTS.includes(a.belt as (typeof BELTS)[number]) &&
        ACTS.includes(a.action as (typeof ACTS)[number]),
    )
    .map((a) => ({
      belt: a.belt,
      action: a.action,
      reason:
        typeof a.reason === 'string' ? a.reason.slice(0, 140) : undefined,
    }))
    .slice(0, 6),
});

function extractJson(text: string): unknown {
  let cleaned = text.trim();

  // Strip markdown code fences if present
  if (cleaned.startsWith('```')) {
    cleaned = cleaned
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
  }

  // Take the outermost { ... } in case of leading/trailing prose
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('No JSON object found in model response');
  }
  cleaned = cleaned.slice(start, end + 1);

  // Common model mistakes: trailing commas before } or ]
  cleaned = cleaned.replace(/,\s*([\]}])/g, '$1');

  return JSON.parse(cleaned);
}

async function requestGemini(modelName: string, s: Snapshot) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': KEY!,
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: `${PROMPT}\n\nState:\n${JSON.stringify(s)}`,
              },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.2,
        },
      }),
    },
  );

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Gemini HTTP ${res.status}: ${errBody}`);
  }

  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('No text candidate in Gemini response');

  try {
    return extractJson(text);
  } catch (e) {
    const msg = (e as Error).message || '';
    throw new Error(
      `Invalid JSON from model: ${msg} | raw=${text.slice(0, 240)}`,
    );
  }
}

async function control(s: Snapshot): Promise<Result> {
  if (!KEY) {
    console.warn('[AI Control] No GEMINI_API_KEY – using Rules');
    return { ...rules(s), source: 'Rules' };
  }

  if (!activeModel) {
    console.warn('[AI Control] No GEMINI_MODEL in env – using Rules');
    return { ...rules(s), source: 'Rules' };
  }

  const attempts = 2;
  for (let i = 0; i < attempts; i++) {
    try {
      const parsed = await requestGemini(activeModel, s);
      console.log(`[AI Control] LLM ok via ${activeModel}`);
      return {
        ...clean(parsed as { summary?: unknown; actions?: Act[] }),
        source: 'LLM',
      };
    } catch (e) {
      const msg = (e as Error).message || '';
      console.warn(
        `[AI Control] ${activeModel} attempt ${i + 1}/${attempts} failed: ${msg.slice(0, 200)}`,
      );
      // Don't retry auth / quota errors
      if (
        msg.includes('HTTP 401') ||
        msg.includes('HTTP 403') ||
        msg.includes('HTTP 429')
      ) {
        break;
      }
    }
  }

  console.error('[AI Control] LLM failed – Rules fallback');
  return { ...rules(s), source: 'Rules' };
}

async function startServer() {
  const app = express();
  app.use(express.json());

  app.get('/api/status', (_req, res) => {
    res.json({
      configured: !!KEY && !!activeModel,
      model: activeModel || null,
      source: KEY && activeModel ? 'LLM' : 'Rules',
    });
  });

  app.get(['/api/download-zip', '/download'], (_req, res) => {
    const zipPath = path.resolve(__dirname, 'public', 'prm-app.zip');
    res.download(zipPath, 'prm-app.zip', (err) => {
      if (err) {
        console.error('Failed to send zip:', err);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to download zip' });
        }
      }
    });
  });

  app.post('/api/control', async (req, res) => {
    const s = req.body as Snapshot;
    if (!s || !Array.isArray(s.belts) || !Array.isArray(s.pattern)) {
      return res.status(400).json({ error: 'Invalid state snapshot' });
    }
    try {
      const result = await control(s);
      res.json(result);
    } catch (err) {
      console.error('[AI Control] Unhandled error:', err);
      res.json({ ...rules(s), source: 'Rules' });
    }
  });

  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  } else {
    const { createServer } = await import('vite');
    const vite = await createServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on port ${PORT}`);
    if (KEY && activeModel) {
      console.log(`AI Controller: Gemini LLM (model: ${activeModel})`);
    } else if (isPlaceholder) {
      console.log(
        'AI Controller: Rules — GEMINI_API_KEY is still the placeholder. Set a real key in .env',
      );
    } else if (!KEY) {
      console.log(
        'AI Controller: Rules — No GEMINI_API_KEY found in .env / .env.local',
      );
    } else {
      console.log('AI Controller: Rules — No GEMINI_MODEL set in .env');
    }
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});