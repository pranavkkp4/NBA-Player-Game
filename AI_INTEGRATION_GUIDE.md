# NBA Player Game - AI Integration Complete ✅

## Overview

Your NBA Player Game has been fully refactored with AI-powered career biography generation. Here's what was added:

### ✨ New Features

1. **AI-Generated Career Biographies**
   - Wikipedia-style narratives from simulated career data
   - Two providers: Gemini (cloud, free-tier) + Ollama (local, unlimited)

2. **Text-to-Speech**
   - Read biographies aloud using browser Web Speech API
   - Play/Stop/Copy controls in modal

3. **Provider Quota Management**
   - Gemini quota tracking with 24-hour disable window
   - UI greyed-out when provider unavailable
   - Fallback to Ollama when Gemini quota exhausted

4. **Caching**
   - Results cached by `(playerName, position, provider)` to avoid redundant API calls

---

## File Structure

### Frontend Files (Added/Modified)

```
├── aiClient.js                    [NEW] AI API client + TTS utilities
├── aiModal.js                     [NEW] Career biography modal UI
├── future.html                    [MODIFIED] Added AI script imports
├── future.js                      [MODIFIED] AI button integration + payload builder
├── style.css                      [MODIFIED] Added AI modal + button styles
├── index.html                     [unchanged]
├── script.js                      [unchanged]
└── index.html                     [unchanged]
```

### Backend Files (Created)

```
backend/
├── server.js                      Express server + AI provider logic
├── package.json                   Dependencies (express, cors, dotenv)
├── careerPayloadBuilder.js        Payload converter utilities
├── .env.example                   Configuration template
└── README.md                      Backend setup guide
```

---

## Setup Instructions

### Step 1: Backend Setup

```bash
# Navigate to backend directory
cd backend

# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env with your API keys
# - GEMINI_API_KEY from https://aistudio.google.com
# - OLLAMA_BASE_URL (default: http://localhost:11434)
```

### Step 2: Start Ollama (Optional but Recommended)

```bash
# Install Ollama from https://ollama.ai
# Then:
ollama pull llama3.1:8b
ollama serve

# Runs at http://localhost:11434
```

### Step 3: Start Backend

```bash
# In backend/ directory
npm run dev

# Output:
# 🏀 NBA Game Backend listening on http://localhost:5000
#    Gemini enabled: true
#    Ollama URL: http://localhost:11434
```

### Step 4: Start Frontend

```bash
# In project root (NBA-Player-Game-main/)
python -m http.server 8000

# Open http://localhost:8000/future.html
```

---

## How It Works

### User Flow

1. **Create Player** → Select attributes from real NBA players
2. **Simulate Career** → Run deterministic sim (10 seasons)
3. **See Results** → Career summary + stats
4. **Click "Generate Detailed Career (Gemini/Ollama)"**
5. **Modal Opens** → Loading spinner
6. **Biography Renders** → Wikipedia-style narrative
7. **Optional:** Click "Play" to hear it read aloud

### Backend Architecture

```
Frontend     →  Express Backend  →  AI Providers
                    ↓
              Caches results
              Tracks Gemini quota
              Returns JSON
```

**Data Flow:**
```
Career Sim Output
    ↓
careerPayloadBuilder (future.js)
    ↓
CareerPayload JSON
    ↓
POST /api/ai/career
    ↓
Provider Handler
  - Gemini: HTTP request to Google API
  - Ollama: HTTP request to localhost:11434
    ↓
Biography Text
    ↓
Modal Renders
    ↓
TTS (optional)
```

---

## API Endpoints

### POST `/api/ai/career`

Generate a biography.

**Request:**
```javascript
{
  "provider": "gemini" | "ollama",
  "careerPayload": {
    "player": {...},
    "careerTimeline": [...],
    "careerStats": {...},
    "modeContext": {...}
  },
  "cacheKey": "playerName|position|career|provider"
}
```

**Success Response:**
```json
{
  "status": "success",
  "provider": "gemini",
  "text": "Alice Johnson (born...) is an American professional basketball player...",
  "fromCache": false
}
```

**Error Response (Quota):**
```json
{
  "status": "disabled",
  "provider": "gemini",
  "reason": "Ran out of free tier for today."
}
```

### GET `/api/ai/status`

Check provider availability.

**Response:**
```json
{
  "gemini": {
    "enabled": true,
    "reason": null
  },
  "ollama": {
    "enabled": true,
    "reason": null
  }
}
```

---

## Configuration

### Frontend Configuration (`aiClient.js`)

```javascript
const AI_CONFIG = {
  backendUrl: 'http://localhost:5000', // Change for production
  cacheEnabled: true
};

// Override at runtime:
setAIBackendUrl('https://your-backend-url.com');
```

### Backend Configuration (`.env`)

```env
# Gemini (free-tier, daily quota)
GEMINI_API_KEY=YOUR_KEY_HERE
GEMINI_MODEL=gemini-2.0-flash

# Ollama (local, unlimited)
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.1:8b

# Server
PORT=5000
FRONTEND_URL=http://localhost:8000
```

---

## Production Deployment

### Frontend → GitHub Pages
No changes needed; static hosting works as-is.

### Backend → Render / Fly.io / Heroku

1. Set environment variables in platform dashboard
2. Update `aiClient.js` to point to production backend:
   ```javascript
   setAIBackendUrl('https://your-render-url.onrender.com');
   ```
3. For Ollama:
   - **Dev:** Runs locally on same machine
   - **Production:** Use hosted Ollama or just Gemini

Example Render deployment:
```bash
# ./Procfile (for Render)
web: cd backend && npm start
```

---

## Testing

### Test Gemini
```javascript
// In browser console
await generateCareerBiography('gemini', {
  player: { fullName: 'Test Player', position: 'SG' },
  careerTimeline: [],
  careerStats: { seasons: 1, teams: [], careerHighPoints: 20 },
  modeContext: { gameMode: 'career' }
});
```

### Test Ollama
```javascript
// Same as above, but with provider: 'ollama'
// Ollama must be running locally
```

### Check Backend Health
```bash
curl http://localhost:5000/health
# {"status":"ok","timestamp":"...","geminiEnabled":true}
```

---

## Troubleshooting

### "Backend unreachable"
- Ensure `npm run dev` is running in `backend/`
- Check `aiClient.js` has correct `backendUrl`
- Verify CORS: check `server.js` line ~18

### "Ollama not responding"
- Run `ollama serve` in separate terminal
- Check `OLLAMA_BASE_URL` in `.env`
- Default: `http://localhost:11434`

### "Gemini 429 (Too Many Requests)"
- You've hit free-tier daily quota
- Backend auto-disables until midnight
- Use Ollama as fallback (always free)

### "No biography text returned"
- Check browser console for errors
- Verify payload structure matches schema
- Try other provider

### "Text-to-speech not working"
- Not supported in all browsers (check [MDN](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis))
- Try different browser
- Check speaker volume

---

## Code Examples

### Generate Biography Programmatically

```javascript
// Build payload from sim
const payload = buildCareerPayloadFromSim(simOutput, 'John Doe', 'SG');
const cacheKey = 'john-doe|sg|career|gemini';

// Generate
const result = await generateCareerBiography('gemini', payload, cacheKey);

if (result.status === 'success') {
  console.log(result.text); // Print biography
}
```

### Add AI to Every Page

Include in your HTML:
```html
<script src="aiClient.js"></script>
<script src="aiModal.js"></script>

<div id="results">
  <!-- Your content here -->
</div>

<div class="ai-button-group">
  <button onclick="generateBio('gemini')">Generate (Gemini)</button>
  <button onclick="generateBio('ollama')">Generate (Ollama)</button>
</div>

<script>
  function generateBio(provider) {
    const payload = { /* your payload */ };
    aiModal.open(provider, payload);
  }
</script>
```

---

## Architecture Decisions

### Why In-Memory Quota Tracking?
- Simple, no database needed
- Resets on server restart (acceptable for free-tier)
- For production, use Redis

### Why Two Providers?
- **Gemini:** Cloud-hosted, powerful, daily quota
- **Ollama:** Local, unlimited, offline-capable

### Why No Framework?
- Vanilla JS is lightweight, no build step
- Works on GitHub Pages (static only)
- Easier to integrate into existing code

### Why Modal Instead of Inline?
- Cleaner UX for long text
- Separates concerns (modal vs. page)
- Supports TTS easily

---

## Future Enhancements

1. **Redis Quota Tracking**
   - Persists quota across server restarts
   - Multi-instance support

2. **More Providers**
   - Claude (via Anthropic API)
   - OpenAI GPT-4
   - Local LLMs (Mistral, etc.)

3. **Advanced Caching**
   - Database-backed cache
   - LRU eviction policy

4. **History/Favorites**
   - Save generated biographies
   - User accounts (optional)

5. **Mobile Optimization**
   - Better touch interactions
   - Responsive modal design

---

## Support

For issues or questions:
1. Check [backend/README.md](backend/README.md) for backend-specific help
2. Review error messages in browser console + server logs
3. Verify `.env` configuration
4. Ensure Ollama is running (if using Ollama provider)

---

## Summary

Your NBA Player Game is now AI-powered! 🏀🤖

- **Frontend:** Fully functional, no breaking changes to existing sim
- **Backend:** Ready to run locally or in production
- **Providers:** Flexible (Gemini + Ollama), quota-aware
- **UI:** Modal-based with TTS support
- **Code:** Modular, extensible, vanilla JS (no frameworks)

Enjoy generating epic career biographies! 🎬✍️
