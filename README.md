# NBA Player Game

An in-browser NBA draft and 10-year career simulator built with HTML, CSS, JavaScript, and in-browser SQLite (sql.js). The sim is rule-based, data-driven, and runs fully client-side on GitHub Pages.

## Highlights
- Draft game: build a player by attributes or draft a full 5v5 team
- Future Career Mode: create a player from real NBA attributes and simulate 10 seasons
- SQL-first: data is loaded into an in-memory SQLite database and queried locally
- Era filtering and position-aware comparisons for more realistic selection
- Color-coded stat tables to compare players at a glance

## Tech Stack
- HTML5
- CSS3
- Vanilla JavaScript
- SQLite in the browser via `sql.js`
- GitHub Pages hosting (static site)

## How the Simulation Works (Technical Detail)
The 10-year career sim is a deterministic, rule-based system designed to feel realistic without using ML:

1. Attribute-driven baselines
Each selected player defines a career-average baseline for a specific stat.
Example: the player chosen for Shooting sets baseline PTS, Passing sets AST, Rebounding sets TRB, Steals/Blocks set STL/BLK, Longevity sets G, and Height sets height.

2. Position-aware tuning
The chosen position applies multipliers so guards assist more, centers rebound/block more, and forwards sit in between.

3. Longevity-based career curve
The sim uses games played (G) to shape a career arc:
Early years start below average, mid-career peaks above average, and later years decline.
Longer careers yield a later peak and a longer prime.

4. Season variance
Each season introduces mild random noise, bounded to keep outputs realistic.

5. Awards and outcomes
MVP/ROY/MIP go only to top performers in that season.
Team wins are derived from team aggregate performance.
Hall of Fame requires elite sustained output and awards.

This keeps results within plausible historical ranges while still producing variety.

## Stat Color Coding
In selection tables, stats are color-coded by position-relative performance:
- Gold: Top 10 for that stat in the current pool
- Green: Above average
- Yellow: Around average
- Orange: Below average
- Red: Way below average

## Project Structure
- `index.html`
  - Draft game UI, controls, and modal picker
- `script.js`
  - Draft game logic, SQL setup, player selection, and scoring
- `future.html`
  - Future Career Mode UI
- `future.js`
  - Career sim logic, SQL setup, awards, and results rendering
- `style.css`
  - Shared styling for both pages and stat color legend
- `NBA_PLAYERS.csv`
  - Base dataset used to build the SQLite `players` table in-browser
- `nba_players.json`
  - Supplemental dataset used to enrich the SQL table with extra fields (e.g., STL/BLK)
- `teams_by_era_updated.json`
  - Team lists used by era in Future Career Mode
- `data/`
  - Data folder for GitHub Pages-friendly assets
  - `data/NBA_PLAYERS.csv` is the primary dataset used by the app
  - Large files (e.g., raw CSVs and `nba.sqlite`) are excluded from git to keep Pages deploys working

## Data Pipeline (Client-Side SQL)
1. `sql.js` is loaded from a CDN.
2. The app fetches `data/NBA_PLAYERS.csv` and builds an in-memory SQLite database.
3. If `data/nba_players.json` (or root `nba_players.json`) is present, it merges in additional fields like steals and blocks.
4. All game logic runs on SQL query results and cached objects.

## Recruiter-Focused Technical Highlights
- Client-side SQL pipeline with CSV ingestion and JSON enrichment
- Rule-based simulation engine with configurable career curves
- Position-aware stat normalization and comparative color-coding
- Deterministic, reproducible outcomes with bounded stochasticity
- Modular vanilla JS architecture without frameworks

## Local Run
Open `index.html` in a browser. For best results, use a static server (e.g., VS Code Live Server) so fetch requests work properly.
