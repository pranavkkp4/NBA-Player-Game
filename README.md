# NBA Player Game

An in-browser NBA player draft and career simulation game built with HTML, CSS, JavaScript, and SQLite (via sql.js). It runs fully on GitHub Pages without a backend.

## Highlights
- Draft game: build a player by attributes or draft a full 5v5 team
- Future Career Mode: create a player from real NBA attributes and simulate 10 seasons
- SQL-first: data is loaded into an in-memory SQLite database and queried locally
- Deterministic simulation runs client-side

## Tech Stack
- HTML5
- CSS3
- Vanilla JavaScript
- SQLite (in-browser) via `sql.js`
- GitHub Pages hosting (static site)

## Project Structure
- `index.html`
  - Main UI for the draft game, controls, and modal player picker
- `script.js`
  - Draft game logic, SQL setup, player selection, and simulation
- `future.html`
  - UI for Future Career Mode
- `future.js`
  - Future Career Mode logic, SQL setup, simulation, and results
- `style.css`
  - Shared styling for both pages
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

## How Data Is Loaded
1. `sql.js` is loaded from a CDN.
2. The app fetches `data/NBA_PLAYERS.csv` and builds an in-memory SQLite database.
3. If `data/nba_players.json` (or root `nba_players.json`) is present, it merges in additional fields (like steals and blocks).
4. All game logic runs on SQL query results and cached objects.

## GitHub Pages Notes
This project is designed for static hosting. Large raw data files are intentionally excluded from git due to GitHub’s 100MB file limit. The app only needs the CSV in `data/NBA_PLAYERS.csv` and (optionally) `data/nba_players.json` to run.

## Recruiter-Friendly Summary
This project demonstrates:
- Building a data-driven web app without a backend
- Client-side SQL with SQLite via `sql.js`
- Data ingestion, normalization, and enrichment from multiple sources
- Interactive UI state management in vanilla JS
- Simulation logic with repeatable outcomes

## Local Run
Open `index.html` in a browser. For the best experience, serve via a static server (e.g., VS Code Live Server) so fetch requests work properly.

