/* =========================================================
   NBA GAME BACKEND - AI Biography Server
   Supports Gemini + Ollama with quota management
   ========================================================= */

const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(express.json());
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true
}));

// ============================================
// PROVIDER MANAGEMENT & QUOTA TRACKING
// ============================================

let geminiDisabledUntil = null;
const bioCache = new Map(); // (playerId, seasonId, seed, provider) -> text

function isGeminiEnabledNow() {
  if (!geminiDisabledUntil) return true;
  return Date.now() > geminiDisabledUntil;
}

function disableGeminiForToday() {
  const d = new Date();
  d.setHours(24, 0, 0, 0); // midnight tomorrow
  geminiDisabledUntil = d.getTime();
  console.warn(`[QUOTA] Gemini disabled until ${new Date(geminiDisabledUntil).toISOString()}`);
}

function getCacheKey(playerId, seasonId, seed, provider) {
  return `${playerId}|${seasonId}|${seed}|${provider}`;
}

// ============================================
// PROVIDER: GEMINI
// ============================================

async function callGemini(systemPrompt, userPrompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set in environment');
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const payload = {
    system_instruction: {
      parts: {
        text: systemPrompt
      }
    },
    contents: {
      parts: {
        text: userPrompt
      }
    },
    safety_settings: [
      {
        category: 'HARM_CATEGORY_UNSPECIFIED',
        threshold: 'BLOCK_NONE'
      }
    ],
    generation_config: {
      temperature: 1,
      max_output_tokens: 1500
    }
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    // Handle quota / rate-limit
    if (res.status === 429 || res.status === 503) {
      disableGeminiForToday();
      throw new Error('Gemini quota exceeded or rate-limited');
    }

    if (!res.ok) {
      const errBody = await res.text();
      console.error(`[GEMINI] HTTP ${res.status}: ${errBody}`);
      throw new Error(`Gemini error: ${res.status}`);
    }

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error('No text in Gemini response');
    }

    return text;
  } catch (err) {
    console.error('[GEMINI] Call failed:', err.message);
    throw err;
  }
}

// ============================================
// PROVIDER: OLLAMA
// ============================================

async function callOllama(systemPrompt, userPrompt) {
  const baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
  const model = process.env.OLLAMA_MODEL || 'llama3.1:8b';

  const url = `${baseUrl}/api/chat`;

  const payload = {
    model,
    messages: [
      {
        role: 'system',
        content: systemPrompt
      },
      {
        role: 'user',
        content: userPrompt
      }
    ],
    stream: false
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      throw new Error(`Ollama HTTP ${res.status}`);
    }

    const data = await res.json();
    const text = data.message?.content;
    if (!text) {
      throw new Error('No text in Ollama response');
    }

    return text;
  } catch (err) {
    console.error('[OLLAMA] Call failed:', err.message);
    throw err;
  }
}

// ============================================
// SHARED PROMPT TEMPLATE
// ============================================

function buildSystemPrompt() {
  return `You are writing a simulated basketball biography in a Wikipedia-like tone.
You are given a structured JSON object with facts about a simulated NBA player's career.
Your job is to convert these facts into a narrative biography.

STRICT RULES:
- Use ONLY the facts provided. Do NOT invent new facts, dates, or events.
- If a detail is missing from the provided data, omit it.
- Do NOT compute statistics or invent career achievements.
- Write in a professional, Wikipedia-like narrative style.
- Use paragraphs, not bullet points.
- If team sections are provided, organize by team and years.
- At the very end, add one short line: "This biography is generated from a deterministic simulation."

Do not include disclaimers or warnings in the middle of the text.`;
}

function buildUserPrompt(careerPayload) {
  return `Please write a career biography for the following simulated player using ONLY the facts provided:

${JSON.stringify(careerPayload, null, 2)}

Remember: do not invent facts, do not compute stats, do not add new achievements.`;
}

// ============================================
// API ENDPOINTS
// ============================================

/**
 * GET /api/ai/status
 * Returns provider availability
 */
app.get('/api/ai/status', (req, res) => {
  res.json({
    gemini: {
      enabled: isGeminiEnabledNow(),
      reason: isGeminiEnabledNow() ? null : 'Ran out of free tier for today.'
    },
    ollama: {
      enabled: true, // Ollama is local; assume available unless connection fails
      reason: null
    }
  });
});

/**
 * POST /api/ai/career
 * Generates a career biography
 *
 * Request body:
 * {
 *   "provider": "gemini" | "ollama",
 *   "careerPayload": {...},
 *   "cacheKey": "optional-cache-key"
 * }
 */
app.post('/api/ai/career', async (req, res) => {
  try {
    const { provider, careerPayload, cacheKey } = req.body;

    if (!provider || !careerPayload) {
      return res.status(400).json({ error: 'Missing provider or careerPayload' });
    }

    // Check cache
    if (cacheKey && bioCache.has(cacheKey)) {
      console.log(`[CACHE] Hit for ${cacheKey}`);
      return res.json({
        status: 'success',
        provider,
        text: bioCache.get(cacheKey),
        fromCache: true
      });
    }

    // Check Gemini quota
    if (provider === 'gemini' && !isGeminiEnabledNow()) {
      return res.status(403).json({
        status: 'disabled',
        provider: 'gemini',
        reason: 'Ran out of free tier for today.'
      });
    }

    // Call provider
    let text;
    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt(careerPayload);

    if (provider === 'gemini') {
      text = await callGemini(systemPrompt, userPrompt);
    } else if (provider === 'ollama') {
      text = await callOllama(systemPrompt, userPrompt);
    } else {
      return res.status(400).json({ error: 'Unknown provider' });
    }

    // Cache result
    if (cacheKey) {
      bioCache.set(cacheKey, text);
    }

    return res.json({
      status: 'success',
      provider,
      text,
      fromCache: false
    });
  } catch (err) {
    console.error('[API ERROR]', err.message);

    // If Gemini failed due to quota, mark it as disabled
    if (req.body.provider === 'gemini' && err.message.includes('quota')) {
      return res.status(429).json({
        status: 'disabled',
        provider: 'gemini',
        reason: 'Ran out of free tier for today.'
      });
    }

    return res.status(500).json({
      error: err.message,
      provider: req.body.provider
    });
  }
});

// ============================================
// HEALTH CHECK
// ============================================

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    geminiEnabled: isGeminiEnabledNow()
  });
});

// ============================================
// START SERVER
// ============================================

app.listen(PORT, () => {
  console.log(`\n🏀 NBA Game Backend listening on http://localhost:${PORT}`);
  console.log(`   Gemini enabled: ${isGeminiEnabledNow()}`);
  console.log(`   Ollama URL: ${process.env.OLLAMA_BASE_URL || 'http://localhost:11434'}\n`);
});
