# NBA Player Game - Backend Setup Guide

This backend provides AI-powered career biography generation using Gemini and Ollama.

## Quick Start

### 1. Install Dependencies

```bash
cd backend
npm install
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env` and fill in your API keys:

```bash
cp .env.example .env
```

Then edit `.env`:

```env
# Required: Get this from Google AI Studio (https://aistudio.google.com)
GEMINI_API_KEY=YOUR_KEY_HERE

# Optional: Ollama model (default is llama3.1:8b)
OLLAMA_MODEL=llama3.1:8b

# Backend port
PORT=5000
```

### 3. Set Up Ollama (Local, Always Free)

Ollama runs locally on your machine and provides free AI generation.

#### Install Ollama
- Download from [ollama.ai](https://ollama.ai)
- Follow installation instructions for your OS

#### Pull a Model
```bash
ollama pull llama3.1:8b
```

#### Start Ollama Server
```bash
ollama serve
```

This starts Ollama at `http://localhost:11434` (default).

### 4. Set Up Gemini (Optional, Free-Tier)

Gemini provides hosted AI generation with daily quotas.

1. Visit [Google AI Studio](https://aistudio.google.com)
2. Create a free API key
3. Add to `.env` as `GEMINI_API_KEY`

**Important:** Gemini has rate limits on the free tier. The backend automatically disables it for 24 hours once quota is exhausted.

### 5. Start the Backend Server

```bash
# Development (with auto-reload)
npm run dev

# Production
npm start
```

You should see:
```
🏀 NBA Game Backend listening on http://localhost:5000
   Gemini enabled: true
   Ollama URL: http://localhost:11434
```

## API Endpoints

### GET `/health`

Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-06-26T12:00:00.000Z",
  "geminiEnabled": true
}
```

### GET `/api/ai/status`

Returns provider availability (quota status for Gemini, etc).

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

### POST `/api/ai/career`

Generate a career biography.

**Request Body:**
```json
{
  "provider": "gemini" or "ollama",
  "careerPayload": {
    "player": {
      "fullName": "Alice Johnson",
      "birthDate": "1996-02-20",
      "nationality": "American",
      "position": "SG",
      "height": "6'3\"",
      "college": "Duke"
    },
    "careerTimeline": [
      {
        "date": "2024-06-26",
        "event": "Drafted",
        "details": "Selected in the 2024 NBA Draft"
      }
    ],
    "careerStats": {
      "seasons": 3,
      "teams": ["Lakers", "Warriors"],
      "careerHighPoints": 45,
      "careerHighAssists": 12,
      "awards": ["All-Star", "MVP"],
      "injuries": []
    },
    "modeContext": {
      "gameMode": "career",
      "seed": null,
      "note": "All details are simulated from deterministic engine outputs."
    }
  },
  "cacheKey": "optional-cache-key"
}
```

**Response (Success):**
```json
{
  "status": "success",
  "provider": "gemini",
  "text": "Alice Johnson (born February 20, 1996) is an American professional basketball player...",
  "fromCache": false
}
```

**Response (Quota Exhausted):**
```json
{
  "status": "disabled",
  "provider": "gemini",
  "reason": "Ran out of free tier for today."
}
```

## Quota Management

### Gemini Daily Quota

- Free tier has per-day rate limits
- When quota is hit (HTTP 429), the backend:
  - Disables Gemini until midnight (local time)
  - Returns 403 with "disabled" status
  - Frontend greyed-out Gemini button
  - Shows "Ran out of free tier for today"

This is tracked **in-memory** and resets on server restart. For production, consider using Redis or a database.

### Ollama

Ollama has no daily quota (runs locally). It's always available unless the connection fails.

## Frontend Integration

Make sure your frontend scripts include:

```html
<script src="aiClient.js"></script>
<script src="aiModal.js"></script>
```

And set the backend URL (defaults to `http://localhost:5000`):

```javascript
setAIBackendUrl('http://your-backend-url:5000');
```

## Deployment

For production deployment (e.g., Render, Fly.io, Heroku):

1. Set environment variables in your hosting platform
2. Ensure backend URL is reachable from frontend (update CORS)
3. For Ollama: you'll need local-only mode or a separate Ollama server
4. Consider using Redis for quota tracking across multiple instances

### Example for GitHub Pages → Render

- **Frontend:** GitHub Pages (static)
- **Backend:** Render (https://render.com)
- **Ollama:** Local (dev only) or separate Ollama server
- **Gemini:** Uses free API key from AI Studio

Update `aiClient.js`:
```javascript
const AI_CONFIG = {
  backendUrl: 'https://your-render-url.onrender.com',
  // ...
}
```

## Troubleshooting

### "Ollama is unreachable"
- Ensure Ollama server is running: `ollama serve`
- Check `OLLAMA_BASE_URL` in `.env`
- Default: `http://localhost:11434`

### "Gemini API key invalid"
- Verify key from [AI Studio](https://aistudio.google.com)
- Check `.env` has correct `GEMINI_API_KEY`
- Ensure no extra whitespace

### "Too many requests (429)"
- Gemini daily quota exhausted
- Backend automatically disables until midnight
- Use Ollama as fallback (always free)

### "Can't connect to backend"
- Ensure backend is running: `npm run dev`
- Check `aiClient.js` has correct backend URL
- Check CORS configuration in `server.js`

## Architecture Notes

- **In-memory quota tracking:** Resets on server restart. Use Redis for persistence.
- **Bio caching:** Cached by `(playerId, seasonId, seed, provider)` in memory.
- **Stateless:** Each request is independent; no database required.
- **Framework-agnostic:** Prompts and payloads are language-independent.

## Next Steps

1. Run backend: `npm run dev`
2. Start Ollama: `ollama serve`
3. Open `future.html` in browser
4. Create a player and simulate career
5. Click "Generate Detailed Career (Ollama)" button
6. Biography modal opens with AI-generated text
7. Click "Play" to read aloud via text-to-speech

Enjoy! 🏀
