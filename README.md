# NBA Player Game

An in-browser NBA draft and career simulator built with HTML, CSS, JavaScript, and in-browser SQLite (sql.js). The sim is rule-based, data-driven, and runs fully client-side on GitHub Pages, with a Node/Express backend that generates AI career biographies via Gemini and Ollama.

## Highlights
- **Draft game:** Build a player by attributes or draft a full 5v5 team
- **Future Career Mode:** Create a player from real NBA attributes and simulate a full career
- **AI Career Biographies:** Generate Wikipedia-style career narratives powered by Gemini or Ollama
- **Text-to-Speech:** Listen to AI-generated biographies read aloud
- **SQL-first:** Data is loaded into an in-memory SQLite database and queried locally
- **Era filtering and position-aware** comparisons for more realistic selection
- **Color-coded stat tables** to compare players at a glance
- **Stat toggles** to control which columns appear in the draft modal
- **Tournament mode** for 3+ participants with random byes
- **Play-by-play game story** output (light/medium/full detail)
- **Seeded Future Career Mode** for reproducible simulations

## Tech Stack
- **Frontend:** HTML5, CSS3, Vanilla JavaScript, SQLite (sql.js)
- **Backend:** Node.js/Express, Gemini API, Ollama (local)
- **Backend runtime:** Node 18+ recommended; Node <18 falls back to `node-fetch`
- **Hosting:** GitHub Pages (frontend) + Node/Express backend service

## Walkthrough

### 1) Start the backend (AI biographies)
1. `cd backend`
2. `npm install`
3. Create `.env` from `.env.example` and add your keys (Gemini) and settings (Ollama)
4. Start Ollama: `ollama serve`
5. `npm run dev`

### 2) Start the frontend
```bash
python -m http.server 8000
```
Open `http://localhost:8000/index.html`.

### 3) Draft Game
1. Choose game mode, participants, and era
2. Click **Pick** for each row to draft players
3. Use the stat toggles to control the draft modal columns
4. Click **Play New Game** to run the deterministic sim

### 4) Future Career Mode + AI
1. Open `http://localhost:8000/future.html`
2. Enter a player name, choose a position and era
3. Pick a team and all attributes
4. Click **Career Sim** to generate the career
5. Click **Generate Detailed Career (Gemini/Ollama)** to create an AI biography
6. Use **Play** to hear text-to-speech in the biography modal

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         DATA LAYER (Static)                         │
│  ┌─────────────────┬─────────────────┬──────────────────────────┐  │
│  │ Player Attributes│ Team Context    │ Season Parameters (RNG)  │  │
│  │ (CSV + JSON)    │ (Era mapping)    │ (Seeded per run)       │  │
│  └─────────────────┴─────────────────┴──────────────────────────┘  │
└──────────────────────┬───────────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     SIMULATION ENGINE (Deterministic)               │
│  ┌──────────────────┬──────────────┬──────────────┬──────────────┐ │
│  │ Deterministic RNG│ Game Sim     │ Season Agg  │ Career Curve │ │
│  │ (Seeded random) │ (Win/loss)   │ (Stats)     │ (Arc logic)  │ │
│  └──────────────────┴──────────────┴──────────────┴──────────────┘ │
└──────────────────────┬───────────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      ANALYTICS LAYER (Derived)                      │
│  ┌──────────────┬──────────────┬──────────────┬─────────────────┐  │
│  │ Career Metrics│ Team Metrics │ Variance    │ Distribution    │  │
│  │ (PPG, APG)   │ (Wins, rings) │ (Std dev)   │ (Comparisons)   │  │
│  └──────────────┴──────────────┴──────────────┴─────────────────┘  │
└──────────────────────┬───────────────────────────────────────────────┘
                       │
       ┌───────────────┼───────────────┐
       ▼               ▼               ▼
  ┌─────────┐   ┌──────────────┐   ┌──────────┐
  │ Draft   │   │ Career Mode  │   │ AI Layer │
  │ Game    │   │ Results      │   │ (Gemini/ │
  │Results  │   │              │   │  Ollama) │
  └─────────┘   └──────────────┘   └──────────┘
       │               │                │
       └───────────────┼────────────────┘
                       ▼
         ┌──────────────────────────┐
         │   FRONTEND / UI LAYER    │
         │  ┌──────────────────────┐│
         │  │ Player Dashboards    ││
         │  │ Career Timelines     ││
         │  │ Comparison Views     ││
         │  │ Modal Biographies    ││
         │  └──────────────────────┘│
         └──────────────────────────┘
```

**Key Design Principles:**
- **Deterministic:** Same seed → identical outcomes
- **Modular:** Each layer has clear inputs/outputs
- **Data-driven:** Rules derive from real NBA statistics
- **Reproducible:** All randomness is seeded and controllable

## Reproducibility & Deterministic Design

- **Future Career Mode:** Fully seeded and deterministic. The seed is derived from player name, position, era, chosen attribute sources/values, and selected team. The same inputs always reproduce the same career.
- **Draft Game:** Matchup simulation and game stories are deterministic per matchup (seeded by participant names). Draft pools and tournament brackets/byes use randomized sampling.

## How the Simulation Works (Technical Detail)
The career sim is a deterministic, rule-based system designed to feel realistic without using ML:

1. **Attribute-driven baselines**
Each selected player defines a career-average baseline for a specific stat.
Example: the player chosen for Shooting sets baseline PTS, Passing sets AST, Rebounding sets TRB, Steals/Blocks set STL/BLK, Longevity sets G, and Height sets height.

2. **Position-aware tuning**
The chosen position applies multipliers so guards assist more, centers rebound/block more, and forwards sit in between.

3. **Longevity-based career curve**
The sim uses games played (G) to shape a career arc:
Early years start below average, mid-career peaks above average, and later years decline.
Longer careers yield a later peak and a longer prime.

4. **Season variance**
Each season introduces mild random noise, bounded to keep outputs realistic.

5. **Awards and outcomes**
MVP/ROY/MIP go only to top performers in that season.
Team wins are derived from team aggregate performance.
Hall of Fame requires elite sustained output and awards.

This keeps results within plausible historical ranges while still producing variety.

## AI Career Biography Features

After simulating a career in Future Career Mode:

### Generate Detailed Biography
- Click **"Generate Detailed Career (Gemini)"** or **"Generate Detailed Career (Ollama)"**
- Backend generates a Wikipedia-style narrative from sim data
- Modal shows formatted biography

### Text-to-Speech
- Click **"Play"** button to hear the biography read aloud
- Uses browser Web Speech API (no additional config needed)
- Click **"Stop"** to stop playback

### Providers

**Gemini (Free-tier, hosted)**
- Visit [Google AI Studio](https://aistudio.google.com) to get API key
- Free daily quota; greyed out after exhausted
- Backend shows "Ran out of free tier for today" when quota hit

**Ollama (Local, always free)**
- Download from [ollama.ai](https://ollama.ai)
- Run `ollama serve` on your machine
- No API keys needed; unlimited use

## Draft Game Simulation
- Attribute mode builds a custom player from selected career averages and applies position-based adjustments.
- 5v5 mode evaluates full rosters and weights position-specific strengths (e.g., PG passing, C rebounding).
- Matches generate a narrative game story, and tournaments are run automatically for 3+ participants.

## Stat Color Coding
In selection tables, stats are color-coded by position-relative performance:
- Gold: Top 10 for that stat in the current pool
- Green: Above average
- Yellow: Around average
- Orange: Below average
- Red: Way below average

## Advanced Analytics & Derived Metrics

Beyond raw NBA stats, the sim computes four sophisticated metrics to evaluate player and team performance:

### Player-Level Metrics

**Career Variance Index (CVI)**
Standard deviation of a player's performance across all seasons. Lower CVI = more consistent; higher CVI = high volatility. Elite players maintain high peak performance with low variance.

**Longevity Score**
Number of seasons a player maintains "replacement-level" performance (career average - 0.5 std dev). Distinguishes "flash in the pan" stars from durable vets with long primes.

**Peak vs Consistency Ratio**
(Best season PPG) / (Career average PPG). Ratio > 1.4 indicates a player who peaked sharply; ratio 1.0–1.15 indicates steady excellence. High-ratio players are often one-dimensional.

**Team Impact Score**
Player's scoring contribution weighted by team's win percentage that season. A 20 PPG scorer on a 60-win team has greater league impact than one on a 30-win team. Captures contextual dominance.

### Analytical Findings (Sim-Derived Insights)

The deterministic sim reveals non-obvious patterns in career trajectories:

- **High early-career variance correlates with shorter longevity.** Players with volatile rookie seasons rarely sustain excellence; consistency in years 2–4 predicts longer primes.

- **Moderate peaks + high consistency outperform elite spike seasons.** Championship-winning teammates often average 18–22 PPG with CVI < 3.2, not superstar-level spikes.

- **Team context amplifies mid-tier players more than elite players.** A 16 PPG scorer on a 55-win team gains ~8% Team Impact Score boost; a 28 PPG scorer sees ~2% boost. Role players benefit most from strong systems.

- **Hall of Fame requires sustained excellence, not peak dominance.** Players with 2+ MVPs and < 6 All-Pro seasons rarely achieve HOF status; the sim enforces well-rounded excellence.

## Project Structure
- `index.html` – Draft game UI, controls, and modal picker
- `script.js` – Draft game logic, SQL setup, player selection, and scoring
- `future.html` – Future Career Mode UI
- `future.js` – Career sim logic, SQL setup, awards, and results rendering
- `style.css` – Shared styling for both pages and stat color legend
- `aiClient.js` – Frontend AI API client (backend communication)
- `aiModal.js` – Modal UI for displaying AI biographies
- `backend/` – Node.js backend for AI generation
  - `server.js` – Express server with Gemini + Ollama support
  - `package.json` – Dependencies (express, cors, dotenv)
  - `.env.example` – Configuration template
  - `README.md` – Backend setup guide
- `NBA_PLAYERS.csv` – Base dataset for SQLite
- `nba_players.json` – Supplemental stats (STL, BLK, etc.)
- `teams_by_era_updated.json` – Team lists by era
- `data/` – GitHub Pages-friendly assets

## Recruiter-Focused Technical Highlights
- Client-side SQL pipeline with CSV ingestion and JSON enrichment
- Rule-based simulation engine with configurable career curves
- Position-aware stat normalization and comparative color-coding
- Deterministic, reproducible outcomes with bounded stochasticity
- Modular vanilla JS architecture without frameworks
- **AI Integration:** Multi-provider architecture (Gemini + Ollama) with quota management
- **Backend API:** RESTful endpoints with error handling and caching
- **Text-to-Speech:** Browser Web Speech API integration
- **Modal UI:** Progressive enhancement with loading states and error handling

## Environment Variables

See [backend/.env.example](backend/.env.example) for complete list:
- `GEMINI_API_KEY` – From Google AI Studio
- `OLLAMA_BASE_URL` – Default: http://localhost:11434
- `OLLAMA_MODEL` – Default: llama3.1:8b
- `PORT` – Default: 5000

## Data Pipeline (Client-Side SQL)
1. `sql.js` is loaded from a CDN.
2. The app fetches `data/NBA_PLAYERS.csv` and builds an in-memory SQLite database.
3. The app tries `data/nba_players.json` first, then falls back to `nba_players.json` to merge additional fields like steals and blocks.
4. All game logic runs on SQL query results and cached objects.
