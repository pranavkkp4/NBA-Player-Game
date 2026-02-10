/* =========================================================
   FUTURE CAREER MODE - future.js
   Deterministic / SQL-backed / era-filtered
   ========================================================= */

let SQL;
let db;

let players = [];
let playersLoaded = false;
let eraFilter = "all";
let teamsByEra = {};
let statSummary = {};

const ATTRIBUTES = [
  "shooting",
  "passing",
  "rebounding",
  "steals",
  "blocks",
  "longevity",
  "athleticism",
  "height"
];

const ATTR_MAP = {
  shooting: "PTS",
  passing: "AST",
  rebounding: "TRB",
  steals: "STL",
  blocks: "BLK",
  longevity: "G",
  height: "Height"
};

const CSV_PATHS = ["data/NBA_PLAYERS.csv", "NBA_PLAYERS.csv"];
const JSON_PATHS = ["data/nba_players.json", "nba_players.json"];
const NUMERIC_COLS = new Set([
  "Debut", "Final", "Height", "Weight", "G", "PTS", "TRB", "AST",
  "FG%", "FG3%", "FT%", "eFG%", "PER", "WS"
]);
const NUMERIC_JSON_COLS = new Set([
  "Height", "Weight", "G", "PTS", "TRB", "AST", "STL", "BLK",
  "FG%", "FG3%", "FT%", "eFG%", "PER", "WS"
]);
const COLOR_STATS = ["PTS", "AST", "TRB", "PER", "FG%", "STL", "BLK", "G", "Height"];

/* =========================
   Athleticism (YOUR MODEL)
   ========================= */
function computeAthleticism({ per, fg, reb, g, height }) {
  if (!per) return 0;

  const perNorm = Math.min(Math.max((per - 15) / 10, -1.5), 1.5);
  const fgPct = fg ? (fg > 1 ? fg / 100 : fg) : 0;
  const fgBonus = fgPct ? (fgPct - 0.45) * 4 : 0;
  const rebBonus = reb ? Math.min(reb / 10, 1.2) : 0;
  const durability = g ? Math.min(g / 1200, 1.0) : 0;
  const heightBonus = height ? (height - 78) / 12 : 0;

  return (
    0.45 * perNorm +
    0.20 * fgBonus +
    0.20 * rebBonus +
    0.10 * durability +
    0.05 * heightBonus
  );
}

/* =========================
   ADVANCED METRICS (RECRUITER-FOCUSED)
   ========================= */

/**
 * Career Variance Index (CVI)
 * Std dev of performance across seasons
 * Lower = more consistent; higher = volatile
 */
function computeCareerVarianceIndex(seasonStats) {
  if (!Array.isArray(seasonStats) || seasonStats.length === 0) return 0;
  const ppgs = seasonStats.map(s => num(s.pts)).filter(v => Number.isFinite(v));
  if (ppgs.length < 2) return 0;
  const mean = ppgs.reduce((a, b) => a + b, 0) / ppgs.length;
  const variance = ppgs.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / ppgs.length;
  return Math.sqrt(variance);
}

/**
 * Longevity Score
 * Number of seasons above replacement level (career_avg - 0.5*std_dev)
 */
function computeLongevityScore(seasonStats) {
  if (!Array.isArray(seasonStats) || seasonStats.length === 0) return 0;
  const ppgs = seasonStats.map(s => num(s.pts)).filter(v => Number.isFinite(v));
  if (ppgs.length === 0) return 0;
  const mean = ppgs.reduce((a, b) => a + b, 0) / ppgs.length;
  const variance = ppgs.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / ppgs.length;
  const std = Math.sqrt(variance) || 1;
  const threshold = mean - 0.5 * std;
  return ppgs.filter(p => p >= threshold).length;
}

/**
 * Peak vs Consistency Ratio
 * (Best season PPG) / (Career average PPG)
 * > 1.4 = sharp peak; 1.0-1.15 = steady excellence
 */
function computePeakVsConsistency(seasonStats) {
  if (!Array.isArray(seasonStats) || seasonStats.length === 0) return 1.0;
  const ppgs = seasonStats.map(s => num(s.pts)).filter(v => Number.isFinite(v));
  if (ppgs.length === 0) return 1.0;
  const peak = Math.max(...ppgs);
  const avg = ppgs.reduce((a, b) => a + b, 0) / ppgs.length;
  return avg > 0 ? peak / avg : 1.0;
}

/**
 * Team Impact Score
 * Player PPG weighted by team's win percentage
 * Captures contextual dominance
 */
function computeTeamImpactScore(seasonStats) {
  if (!Array.isArray(seasonStats) || seasonStats.length === 0) return 0;
  let totalImpact = 0;
  const validSeasons = seasonStats.filter(s => {
    const pts = num(s.pts);
    const wins = num(s.wins);
    return Number.isFinite(pts) && Number.isFinite(wins);
  });
  
  validSeasons.forEach(season => {
    const pts = num(season.pts);
    const wins = num(season.wins);
    const winPct = wins / 82; // seasons typically have 82 games
    const impact = pts * winPct;
    totalImpact += impact;
  });
  
  return validSeasons.length > 0 ? totalImpact / validSeasons.length : 0;
}

/* =========================
   Helpers
   ========================= */
function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function fmt(value, digits = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "N/A";
  return n.toFixed(digits);
}

function inEra(player) {
  if (eraFilter === "all") return true;
  const start = parseInt(eraFilter.slice(0, 4));
  const debut = Number(player.Debut);
  if (!Number.isFinite(debut)) return false;
  return debut >= start && debut < start + 10;
}

function randn() {
  // rough gaussian-ish
  return (Math.random() + Math.random() + Math.random() + Math.random() - 2) / 2;
}

/* =========================
   CSV -> SQL Helpers
   ========================= */
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }

    if (ch === ",") {
      row.push(field);
      field = "";
      continue;
    }

    if (ch === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
      continue;
    }

    field += ch;
  }

  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }

  return rows;
}

async function fetchCSVText() {
  let lastErr;
  for (const path of CSV_PATHS) {
    try {
      const res = await fetch(path);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
      return await res.text();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("Failed to load CSV");
}

async function fetchJSONData() {
  let lastErr;
  for (const path of JSON_PATHS) {
    try {
      const res = await fetch(path);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("Failed to load JSON");
}

function buildDatabaseFromCSV(csvText) {
  const rows = parseCSV(csvText);
  const header = rows[0];
  const dataRows = rows.slice(1);

  const columnsSql = header.map(h => `"${h}" ${NUMERIC_COLS.has(h) ? "REAL" : "TEXT"}`).join(", ");
  db.run(`CREATE TABLE players (${columnsSql});`);

  const placeholders = header.map(() => "?").join(", ");
  const stmt = db.prepare(`INSERT INTO players VALUES (${placeholders});`);

  db.run("BEGIN TRANSACTION;");
  dataRows.forEach(r => {
    const values = header.map((h, idx) => {
      const raw = r[idx] ?? "";
      if (raw === "") return null;
      if (NUMERIC_COLS.has(h)) return Number(raw);
      return raw;
    });
    stmt.run(values);
  });
  db.run("COMMIT;");
  stmt.free();
}

function computeMeanStd(values) {
  if (!values.length) return { mean: 0, std: 1 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
  const std = Math.sqrt(variance) || 1;
  return { mean, std };
}

function buildStatSummary() {
  const cols = ["PTS", "AST", "TRB", "PER", "G", "Height", "FG%", "STL", "BLK"];
  const summary = {};
  cols.forEach(col => {
    if (!hasCol(col)) return;
    const vals = players.map(p => Number(p[col])).filter(v => Number.isFinite(v));
    summary[col] = computeMeanStd(vals);
  });
  const athVals = players.map(p => computeAthleticism({
    per: p.PER,
    fg: p["FG%"],
    reb: p.TRB,
    g: p.G,
    height: p.Height
  })).filter(v => Number.isFinite(v));
  summary.ATH = computeMeanStd(athVals);
  statSummary = summary;
}

function zScore(value, statKey) {
  const entry = statSummary[statKey];
  if (!entry) return 0;
  const val = Number(value);
  if (!Number.isFinite(val)) return 0;
  return (val - entry.mean) / entry.std;
}

function getPositionGroup(position) {
  const pos = String(position || "").toLowerCase();
  if (pos.includes("center")) return "C";
  if (pos.includes("guard")) return "G";
  if (pos.includes("forward")) return "F";
  return "F";
}

function buildStatContext(pool) {
  const context = {
    top10: {},
    pos: { G: {}, F: {}, C: {} }
  };

  COLOR_STATS.forEach(stat => {
    const values = pool.map(p => Number(p[stat])).filter(v => Number.isFinite(v));
    const sorted = [...values].sort((a, b) => b - a);
    context.top10[stat] = sorted[Math.min(9, sorted.length - 1)] ?? null;
  });

  ["G", "F", "C"].forEach(g => {
    const groupPlayers = pool.filter(p => getPositionGroup(p.Position) === g);
    COLOR_STATS.forEach(stat => {
      const vals = groupPlayers.map(p => Number(p[stat])).filter(v => Number.isFinite(v));
      if (!vals.length) {
        context.pos[g][stat] = { mean: 0, std: 1 };
        return;
      }
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      const variance = vals.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / vals.length;
      const std = Math.sqrt(variance) || 1;
      context.pos[g][stat] = { mean, std };
    });
  });

  const athVals = pool.map(p => computeAthleticism({
    per: p.PER,
    fg: p["FG%"],
    reb: p.TRB,
    g: p.G,
    height: p.Height
  })).filter(v => Number.isFinite(v));
  const athSorted = [...athVals].sort((a, b) => b - a);
  context.top10.ATH = athSorted[Math.min(9, athSorted.length - 1)] ?? null;
  const athMean = athVals.reduce((a, b) => a + b, 0) / (athVals.length || 1);
  const athVar = athVals.reduce((a, b) => a + Math.pow(b - athMean, 2), 0) / (athVals.length || 1);
  context.pos.G.ATH = { mean: athMean, std: Math.sqrt(athVar) || 1 };
  context.pos.F.ATH = { mean: athMean, std: Math.sqrt(athVar) || 1 };
  context.pos.C.ATH = { mean: athMean, std: Math.sqrt(athVar) || 1 };

  return context;
}

function statClass(value, stat, posGroup, context) {
  const v = Number(value);
  if (!Number.isFinite(v)) return "";
  const top = context.top10[stat];
  if (Number.isFinite(top) && v >= top) return "stat-gold";
  const entry = context.pos[posGroup]?.[stat];
  if (!entry) return "";
  const mean = entry.mean;
  const std = entry.std || 1;
  if (v > mean + 0.5 * std) return "stat-green";
  if (v >= mean - 0.5 * std) return "stat-yellow";
  if (v >= mean - 1.0 * std) return "stat-orange";
  return "stat-red";
}

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

function positionAdjustments(pos) {
  const p = String(pos || "").toLowerCase();
  if (p.includes("point")) {
    return { pts: 0, ast: 0.7, reb: -0.5, stl: 0, blk: 0 };
  }
  if (p.includes("shooting")) {
    return { pts: 1.5, ast: 0, reb: -0.5, stl: 0, blk: 0 };
  }
  if (p.includes("center")) {
    return { pts: -1.5, ast: -1.0, reb: 3.0, stl: 0, blk: 0 };
  }
  return { pts: 0, ast: 0, reb: 0, stl: 0, blk: 0 };
}

function careerFactorByYear(yearIndex, longevityG, totalYears) {
  const g = Number(longevityG);
  const gNorm = clamp01((g - 300) / 1200); // 0..1
  const peakStart = Math.round(2 + gNorm * 2); // 2..4
  const peakLength = Math.round(1 + gNorm * 3); // 1..4
  const peakEnd = Math.min(totalYears, peakStart + peakLength - 1);

  const startFloor = 0.75 + gNorm * 0.08; // 0.75..0.83
  const peakCeil = 1.08 + gNorm * 0.12; // 1.08..1.20
  const declineFloor = 0.82 + gNorm * 0.05; // 0.82..0.87

  if (yearIndex < peakStart) {
    const t = (yearIndex - 1) / Math.max(1, peakStart - 1);
    return startFloor + t * (1.0 - startFloor);
  }
  if (yearIndex <= peakEnd) {
    const t = (yearIndex - peakStart) / Math.max(1, peakEnd - peakStart);
    return 1.0 + t * (peakCeil - 1.0);
  }
  const t = (yearIndex - peakEnd) / Math.max(1, totalYears - peakEnd);
  return peakCeil - t * (peakCeil - declineFloor);
}

/* =========================
   INIT: Database + Teams
   ========================= */
let availableCols = new Set();
let activeAttributes = [];

function loadAvailableCols() {
  const res = db.exec("PRAGMA table_info(players);");
  if (!res[0]) return;
  res[0].values.forEach(row => {
    const name = row[1];
    availableCols.add(name);
  });
}

function hasCol(col) {
  return availableCols.has(col);
}

function ensureColumns(columns) {
  columns.forEach(col => {
    if (availableCols.has(col)) return;
    const colType = NUMERIC_JSON_COLS.has(col) || NUMERIC_COLS.has(col) ? "REAL" : "TEXT";
    db.run(`ALTER TABLE players ADD COLUMN "${col}" ${colType};`);
    availableCols.add(col);
  });
}

function mergeJsonIntoDatabase(jsonData) {
  if (!Array.isArray(jsonData) || jsonData.length === 0) return;

  const sample = jsonData[0];
  const jsonCols = Object.keys(sample).filter(k => k !== "Name");
  ensureColumns(jsonCols);

  const colsToUpdate = jsonCols.filter(c => availableCols.has(c));
  if (colsToUpdate.length === 0) return;

  const setSql = colsToUpdate.map(c => `"${c}" = ?`).join(", ");
  const stmt = db.prepare(`UPDATE players SET ${setSql} WHERE Name = ?;`);

  db.run("BEGIN TRANSACTION;");
  jsonData.forEach(row => {
    if (!row || !row.Name) return;
    const values = colsToUpdate.map(c => {
      const raw = row[c];
      if (raw === undefined || raw === null || raw === "") return null;
      if (NUMERIC_JSON_COLS.has(c)) return Number(raw);
      return Array.isArray(raw) ? raw.join(", ") : raw;
    });
    values.push(row.Name);
    stmt.run(values);
  });
  db.run("COMMIT;");
  stmt.free();
}

function computeActiveAttributes() {
  activeAttributes = ATTRIBUTES.filter(attr => {
    if (attr === "athleticism") return true;
    const col = ATTR_MAP[attr];
    return hasCol(col);
  });
}

async function initDatabase() {
  const statusEl = document.getElementById("futureDataStatus");
  statusEl.textContent = "Loading database...";

  SQL = await initSqlJs({
    locateFile: f => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${f}`
  });

  db = new SQL.Database();
  const csvText = await fetchCSVText();
  buildDatabaseFromCSV(csvText);
  loadAvailableCols();
  try {
    const jsonData = await fetchJSONData();
    mergeJsonIntoDatabase(jsonData);
  } catch {
    // optional JSON enrichment
  }
  loadAvailableCols();
  computeActiveAttributes();

  const selectCols = [
    "Name", "Debut", "Position", "Height", "G", "PTS", "TRB", "AST", "PER", "FG%"
  ];
  if (hasCol("STL")) selectCols.push("STL");
  if (hasCol("BLK")) selectCols.push("BLK");
  const selectSql = selectCols.map(c => (c === "FG%" ? `"${c}"` : c)).join(", ");
  const res = db.exec(`SELECT ${selectSql} FROM players`);
  players = res[0].values.map(row => {
    const obj = {};
    res[0].columns.forEach((c, i) => obj[c] = row[i]);
    return obj;
  });
  buildStatSummary();

  // Try load real franchises mapping (optional)
  try {
    teamsByEra = await fetch("teams_by_era_updated.json").then(r => r.json());
  } catch {
    teamsByEra = {};
  }

  playersLoaded = true;
  statusEl.textContent = `Loaded ${players.length} players from SQLite database`;
}

/* =========================
   UI Setup
   ========================= */
const customPeak = {}; // stores selected peak attribute values
let teamOptions = [];
let chosenTeam = null;

function renderAttributeRows() {
  const list = document.getElementById("attributeList");
  list.innerHTML = "";

  const teamRow = document.createElement("div");
  teamRow.className = "attr-row";
  teamRow.innerHTML = `
    <div class="attr-label">TEAM</div>
    <div class="attr-value"><input id="future-team-value" readonly placeholder="Not chosen" /></div>
    <button class="dice-btn">Pick</button>
  `;
  teamRow.querySelector("button").onclick = () => openTeamModal();
  list.appendChild(teamRow);

  activeAttributes.forEach(attr => {
    const row = document.createElement("div");
    row.className = "attr-row";

    const label = document.createElement("div");
    label.className = "attr-label";
    label.textContent = attr.toUpperCase();

    const val = document.createElement("div");
    val.className = "attr-value";
    val.innerHTML = `<input id="future-${attr}-value" readonly placeholder="Not chosen" />`;

    const btn = document.createElement("button");
    btn.className = "dice-btn";
    btn.textContent = "Pick";
    btn.onclick = () => openFutureModal(attr);

    row.append(label, val, btn);
    list.appendChild(row);
  });
}

function generateTeamOptions() {
  const era = document.getElementById("futureEra").value;
  const pool = pickTeamsForEra(era).slice();
  const picked = [];
  while (pool.length && picked.length < 5) {
    const idx = Math.floor(Math.random() * pool.length);
    picked.push(pool.splice(idx, 1)[0]);
  }
  teamOptions = picked;
  chosenTeam = null;
}

function resetPlayerBuilder() {
  const nameInput = document.getElementById("playerName");
  nameInput.value = "";
  document.getElementById("futureResults").textContent = "";
  Object.keys(customPeak).forEach(k => delete customPeak[k]);
  renderAttributeRows();
  teamOptions = [];
  chosenTeam = null;
  const teamInput = document.getElementById("future-team-value");
  if (teamInput) teamInput.value = "";
}

function openTeamModal() {
  if (!playersLoaded) return alert("Dataset is still loading.");

  generateTeamOptions();

  const modal = document.getElementById("modalOverlay");
  const body = document.getElementById("modalBody");
  const title = document.getElementById("modalTitle");
  const legend = document.getElementById("modalLegend");
  title.textContent = "Select a Team";
  if (legend) legend.style.display = "none";

  body.innerHTML = "";

  const table = document.createElement("table");
  table.className = "pick-table";
  table.innerHTML = `
    <thead>
      <tr>
        <th>Team</th><th></th>
      </tr>
    </thead>
    <tbody></tbody>
  `;

  const tb = table.querySelector("tbody");
  teamOptions.forEach(team => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${team}</td><td><button class="dice-btn">Select</button></td>`;
    tr.querySelector("button").onclick = () => {
      chosenTeam = team;
      const input = document.getElementById("future-team-value");
      if (input) input.value = team;
      modal.classList.add("hidden");
    };
    tb.appendChild(tr);
  });

  body.appendChild(table);
  document.getElementById("modalClose").onclick = () => modal.classList.add("hidden");
  modal.classList.remove("hidden");
}

/* =========================
   Player Selection Modal
   ========================= */
function openFutureModal(attrKey) {
  if (!playersLoaded) return alert("Dataset is still loading.");

  const modal = document.getElementById("modalOverlay");
  const body = document.getElementById("modalBody");
  const title = document.getElementById("modalTitle");
  const legend = document.getElementById("modalLegend");
  title.textContent = `Select a player for ${attrKey.toUpperCase()}`;
  if (legend) legend.style.display = "";

  body.innerHTML = "";

  let pool = players.filter(p => inEra(p));
  const context = buildStatContext(pool);
  pool = pool.sort(() => 0.5 - Math.random()).slice(0, 10);

  const table = document.createElement("table");
  table.className = "pick-table";
  if (attrKey === "athleticism") {
    table.innerHTML = `
      <thead>
        <tr>
          <th>Name</th><th>Pos</th><th>ATH</th><th></th>
        </tr>
      </thead>
      <tbody></tbody>
    `;
  } else {
    table.innerHTML = `
      <thead>
        <tr>
          <th>Name</th><th>Pos</th><th>PTS</th><th>AST</th>
          <th>TRB</th><th>PER</th><th>FG%</th><th>G</th><th>Hgt</th><th></th>
        </tr>
      </thead>
      <tbody></tbody>
    `;
  }

  const tb = table.querySelector("tbody");

  pool.forEach(p => {
    const posGroup = getPositionGroup(p.Position);
    const tr = document.createElement("tr");
    if (attrKey === "athleticism") {
      const ath = computeAthleticism({
        per: p.PER,
        fg: p["FG%"],
        reb: p.TRB,
        g: p.G,
        height: p.Height
      });
      tr.innerHTML = `
        <td>${p.Name}</td>
        <td>${p.Position}</td>
        <td class="${statClass(ath, "ATH", posGroup, context)}">${fmt(ath, 2)}</td>
        <td><button class="dice-btn">Select</button></td>
      `;
    } else {
      tr.innerHTML = `
        <td>${p.Name}</td>
        <td>${p.Position}</td>
        <td class="${statClass(p.PTS, "PTS", posGroup, context)}">${fmt(p.PTS, 1)}</td>
        <td class="${statClass(p.AST, "AST", posGroup, context)}">${fmt(p.AST, 1)}</td>
        <td class="${statClass(p.TRB, "TRB", posGroup, context)}">${fmt(p.TRB, 1)}</td>
        <td class="${statClass(p.PER, "PER", posGroup, context)}">${fmt(p.PER, 1)}</td>
        <td class="${statClass(p["FG%"], "FG%", posGroup, context)}">${fmt(p["FG%"], 1)}</td>
        <td class="${statClass(p.G, "G", posGroup, context)}">${fmt(p.G, 0)}</td>
        <td class="${statClass(p.Height, "Height", posGroup, context)}">${fmt(p.Height, 0)}</td>
        <td><button class="dice-btn">Select</button></td>
      `;
    }

    tr.querySelector("button").onclick = () => {
      let value;
      if (attrKey === "athleticism") {
        value = computeAthleticism({
          per: p.PER,
          fg: p["FG%"],
          reb: p.TRB,
          g: p.G,
          height: p.Height
        });
      } else {
        value = num(p[ATTR_MAP[attrKey]]);
      }

      customPeak[attrKey] = { value, source: p.Name };

      const input = document.getElementById(`future-${attrKey}-value`);
      if (attrKey === "athleticism") {
        input.value = `${value.toFixed(2)}`;
      } else {
        input.value = `${p.Name} (${value.toFixed(2)})`;
      }

      modal.classList.add("hidden");
    };

    tb.appendChild(tr);
  });

  body.appendChild(table);

  document.getElementById("modalClose").onclick = () => modal.classList.add("hidden");
  modal.classList.remove("hidden");
}

function openStatsHelpModal() {
  const modal = document.getElementById("modalOverlay");
  const body = document.getElementById("modalBody");
  const title = document.getElementById("modalTitle");
  const legend = document.getElementById("modalLegend");
  title.textContent = "How the Simulation Works";
  if (legend) legend.style.display = "none";

  body.innerHTML = `
    <div class="card" style="box-shadow:none; margin:0;">
      <p class="muted">
        This sim builds a custom player by borrowing each stat from the players you picked.
        Career length is based on the Longevity pick (games played), and the career arc starts
        below those averages, peaks above them, and declines later.
      </p>
      <h3>Career Arc</h3>
      <p class="muted">
        Early years are below your selected averages, mid-career reaches a peak, and later
        years taper off. Players with higher longevity (more career games) peak later and
        stay in their prime longer.
      </p>
      <h3>Athleticism (ATH)</h3>
      <pre class="sim-output" style="margin-top:6px; white-space:pre-wrap;">ATH = 0.45*perNorm + 0.20*fgBonus + 0.20*rebBonus + 0.10*durability + 0.05*heightBonus

perNorm = clamp((PER-15)/10, -1.5, 1.5)
fgBonus = (FG% - 0.45) * 4
rebBonus = min(REB / 10, 1.2)
durability = min(G / 1200, 1.0)
heightBonus = (Height - 78) / 12</pre>
      <p class="muted">
        Thus, ATH blends efficiency, shooting, rebounding, durability, and height into one score.
      </p>

      <h3>Advanced Metrics (Recruiter-Focused)</h3>
      
      <p><strong>Career Variance Index (CVI):</strong> Standard deviation of performance across seasons. Lower = more consistent; higher = volatile. Elite players maintain high averages with low variance.</p>
      
      <p><strong>Longevity Score:</strong> Number of seasons a player stays above replacement-level (career average - 0.5 std dev). Distinguishes one-hit wonders from durable veterans.</p>
      
      <p><strong>Peak vs Consistency Ratio:</strong> (Best season PPG) / (Career average PPG). Above 1.4 = sharp peak player; 1.0–1.15 = steady excellence. High-ratio players are often one-dimensional.</p>
      
      <p><strong>Team Impact Score:</strong> Player PPG weighted by team's win percentage that season. Captures contextual dominance—a 20 PPG scorer on a 60-win team has greater league impact than one on a 30-win team.</p>

      <h3>Analytical Insights</h3>
      <p class="muted" style="font-style: italic;">
        • High early-career variance correlates with shorter longevity.<br/>
        • Moderate peaks + high consistency outperform elite spike seasons.<br/>
        • Team context amplifies mid-tier players more than elite players.<br/>
        • Hall of Fame requires sustained excellence, not peak dominance.
      </p>

      <h3>Career Average Score</h3>
      <p class="muted">
        careerAvgScore is a weighted career-average performance metric based on your season stats:
      </p>
      <pre class="sim-output" style="margin-top:6px; white-space:pre-wrap;">score = PTS*0.55 + REB*0.30 + AST*0.25 + PER*0.15
careerAvgScore = sum(score * games) / totalGames</pre>
      <h3>PER</h3>
      <p class="muted">
        PER (Player Efficiency Rating) is a single-number summary of a player’s overall per-minute impact.
        Higher PER generally means a stronger all-around statistical season.
      </p>
      <h3>Hall of Fame</h3>
      <p class="muted">
        HOF is awarded only with elite, sustained output. The sim checks MVPs, All-Pro counts,
        championships, and your career average performance score.
      </p>
      <pre class="sim-output" style="margin-top:6px; white-space:pre-wrap;">HOF if any are true:
- MVP >= 1 AND careerAvgScore > 20
- All-Pro >= 6 AND careerAvgScore > 18
- Championships >= 2 AND All-Pro >= 3 AND careerAvgScore > 17
- MVP >= 4 AND All-Pro >= 7 (automatic)</pre>
    </div>
  `;

  document.getElementById("modalClose").onclick = () => modal.classList.add("hidden");
  modal.classList.remove("hidden");
}

/* =========================
   CAREER SIMULATION
   ========================= */

function pickTeamsForEra(era) {
  if (teamsByEra && teamsByEra[era] && teamsByEra[era].length >= 10) return teamsByEra[era];

  // fallback simple list
  return [
    "Lakers", "Celtics", "Bulls", "Warriors", "Spurs",
    "Heat", "Knicks", "Suns", "Mavs", "Nuggets",
    "Raptors", "Jazz", "Sixers", "Pistons", "Hawks",
    "Clippers", "Pacers", "Wizards", "Bucks", "Blazers"
  ];
}

function simulateCareer(customName, customPosition, peak, teamOverride = null) {
  const teams = pickTeamsForEra(eraFilter).slice();
  const leagueSize = 150;
  const totalGames = Math.max(0, Math.round(num(peak.g)));
  const totalYears = clamp(Math.round(totalGames / 82) || 1, 1, 20);
  const baseGames = Math.floor(totalGames / totalYears);
  const remainderGames = totalGames - baseGames * totalYears;
  const gamesBySeason = Array.from({ length: totalYears }, (_, i) =>
    baseGames + (i < remainderGames ? 1 : 0)
  );

  // build league players sampled from era
  const pool = players.filter(p => inEra(p));
  const league = pool.sort(() => 0.5 - Math.random()).slice(0, leagueSize).map(p => {
    const ath = computeAthleticism({
      per: p.PER, fg: p["FG%"], reb: p.TRB, g: p.G, height: p.Height
    });
    return {
      name: p.Name,
      team: teams[Math.floor(Math.random() * teams.length)],
      base: {
        pts: num(p.PTS),
        ast: num(p.AST),
        reb: num(p.TRB),
        stl: num(p.STL),
        blk: num(p.BLK),
        per: num(p.PER),
        fg: num(p["FG%"]),
        ath
      }
    };
  });

  // custom player in league
  const customTeam = teamOverride && teams.includes(teamOverride)
    ? teamOverride
    : teams[Math.floor(Math.random() * teams.length)];
  const posAdj = positionAdjustments(customPosition);
  const custom = {
    name: customName,
    team: customTeam,
    isCustom: true,
    base: {
      pts: peak.pts + posAdj.pts,
      ast: peak.ast + posAdj.ast,
      reb: peak.reb + posAdj.reb,
      stl: peak.stl + posAdj.stl,
      blk: peak.blk + posAdj.blk,
      g: peak.g,
      ath: peak.ath,
      height: peak.height
    }
  };

  const seasons = [];
  let awards = { MVP: 0, ROY: 0, MIP: 0, AllPro: 0, Champs: 0, FinalsMVP: 0 };

  // rookies need improvement baseline
  let lastYearScore = null;

  for (let year = 1; year <= totalYears; year++) {
    const curve = careerFactorByYear(year, custom.base.g, totalYears);
    const yearVariance = clamp(0.95 + randn() * 0.06, 0.85, 1.1);
    const factor = curve * yearVariance;
    const games = gamesBySeason[year - 1] || 0;

    // simulate custom seasonal stats around selected career averages + curve
    const pts = clamp((custom.base.pts + randn() * 1.8) * factor, 0, 45);
    const ast = clamp((custom.base.ast + randn() * 0.7) * factor, 0, 15);
    const reb = clamp((custom.base.reb + randn() * 0.9) * factor, 0, 18);
    const stl = clamp((custom.base.stl + randn() * 0.25) * factor, 0, 3.5);
    const blk = clamp((custom.base.blk + randn() * 0.25) * factor, 0, 3.5);

    // PER clamped
    const per = clamp(10 + pts * 0.55 + ast * 0.45 + reb * 0.35 + stl * 1.3 + blk * 1.2, 8, 32);

    const score = pts * 0.55 + reb * 0.30 + ast * 0.25 + per * 0.15 + stl * 0.4 + blk * 0.4;

    const seasonPlayers = [];

    // add custom to season leaderboard pool
    seasonPlayers.push({
      name: custom.name,
      team: custom.team,
      pts, ast, reb, stl, blk, per, score,
      isCustom: true
    });

    // simulate league players around base stats with mild noise
    league.forEach(pl => {
      const ptsL = clamp(pl.base.pts + randn() * 2.0, 0, 40);
      const astL = clamp(pl.base.ast + randn() * 1.0, 0, 15);
      const rebL = clamp(pl.base.reb + randn() * 1.2, 0, 18);
      const stlL = clamp(pl.base.stl + randn() * 0.35, 0, 3.5);
      const blkL = clamp(pl.base.blk + randn() * 0.35, 0, 4);
      const perL = clamp(pl.base.per + randn() * 2.5, 5, 32);

      const scoreL = ptsL * 0.55 + rebL * 0.30 + astL * 0.25 + perL * 0.15;

      seasonPlayers.push({
        name: pl.name,
        team: pl.team,
        pts: ptsL, ast: astL, reb: rebL, stl: stlL, blk: blkL, per: perL, score: scoreL,
        isCustom: false
      });
    });

    // leaderboards (top 10)
    const topPts = [...seasonPlayers].sort((a, b) => b.pts - a.pts).slice(0, 10);
    const topAst = [...seasonPlayers].sort((a, b) => b.ast - a.ast).slice(0, 10);
    const topReb = [...seasonPlayers].sort((a, b) => b.reb - a.reb).slice(0, 10);
    const topPer = [...seasonPlayers].sort((a, b) => b.per - a.per).slice(0, 10);

    // awards (strict: only top performers win)
    const seasonByScore = [...seasonPlayers].sort((a, b) => b.score - a.score);
    const mvp = seasonByScore[0];

    // ROY: year 1 only, custom always eligible
    let roy = null;
    if (year === 1) {
      roy = seasonByScore[0];
    }

    // MIP: biggest jump in score vs last year (for custom + a sample of league)
    let mip = null;
    if (year > 1) {
      const improv = seasonPlayers.map(pl => {
        let prev = pl.isCustom ? lastYearScore : pl.score - (Math.random() * 3); // proxy
        return { ...pl, delta: pl.score - prev };
      }).sort((a, b) => b.delta - a.delta);
      mip = improv[0];
    }

    // championships: team points proxy
    const teamTotals = {};
    seasonPlayers.forEach(pl => {
      teamTotals[pl.team] = (teamTotals[pl.team] || 0) + pl.score;
    });

    const teamEntries = Object.entries(teamTotals).sort((a, b) => b[1] - a[1]);
    const champTeam = teamEntries[0][0];
    const champCandidates = seasonPlayers.filter(pl => pl.team === champTeam);
    const finalsMVP = [...champCandidates].sort((a, b) => b.score - a.score)[0];

    const minScore = teamEntries[teamEntries.length - 1][1];
    const maxScore = teamEntries[0][1];
    const span = Math.max(1, maxScore - minScore);
    const teamWins = {};
    teamEntries.forEach(([team, score]) => {
      const pct = (score - minScore) / span;
      teamWins[team] = Math.round(20 + pct * 40); // 20..60
    });

    // All-Pro proxy: top 15 PER
    const allPro = [...seasonPlayers].sort((a, b) => b.per - a.per).slice(0, 15).map(p => p.name);

    // update awards for custom (must be top of league)
    if (mvp.name === custom.name) awards.MVP++;
    if (roy && roy.name === custom.name) awards.ROY++;
    if (mip && mip.name === custom.name) awards.MIP++;
    if (finalsMVP.name === custom.name) awards.FinalsMVP++;
    if (champTeam === custom.team) awards.Champs++;
    if (allPro.includes(custom.name)) awards.AllPro++;

    lastYearScore = score;

    seasons.push({
      year,
      custom: {
        name: custom.name,
        pts, ast, reb, stl, blk, per,
        team: custom.team,
        wins: teamWins[custom.team] || 0,
        games
      },
      leaderboards: { topPts, topAst, topReb, topPer },
      awards: {
        MVP: mvp,
        ROY: roy,
        MIP: mip,
        Champion: champTeam,
        FinalsMVP: finalsMVP
      }
    });
  }

  // Hall of Fame decision (simple):
  // at least 5 All-Pro OR 1 MVP OR 2+ Championships + All-Pro
  // HOF requires elite league-level performance
  const careerScores = seasons.map(s =>
    (s.custom.pts * 0.55 + s.custom.reb * 0.30 + s.custom.ast * 0.25 + s.custom.per * 0.15) * s.custom.games
  );
  const totalPlayed = seasons.reduce((a, s) => a + s.custom.games, 0) || 1;
  const careerAvgScore = careerScores.reduce((a, b) => a + b, 0) / totalPlayed;
  const hof =
    (awards.MVP >= 1 && careerAvgScore > 20) ||
    (awards.AllPro >= 6 && careerAvgScore > 18) ||
    (awards.Champs >= 2 && awards.AllPro >= 3 && careerAvgScore > 17) ||
    (awards.MVP >= 4 && awards.AllPro >= 7);

  // Compute advanced metrics
  const seasonPts = seasons.map(s => s.custom.pts);
  const cvi = computeCareerVarianceIndex(seasons.map(s => ({ pts: s.custom.pts })));
  const longevityScore = computeLongevityScore(seasons.map(s => ({ pts: s.custom.pts })));
  const peakRatio = computePeakVsConsistency(seasons.map(s => ({ pts: s.custom.pts })));
  const teamImpact = computeTeamImpactScore(seasons.map(s => ({ pts: s.custom.pts, wins: s.custom.wins })));

  return {
    seasons,
    awards,
    hof,
    customName: custom.name,
    totalGames,
    totalYears,
    advancedMetrics: {
      careerVarianceIndex: cvi,
      longevityScore: longevityScore,
      peakVsConsistency: peakRatio,
      teamImpactScore: teamImpact
    }
  };
}

/* =========================
   Render Results
   ========================= */
let lastSimulationOutput = null;

function renderResults(output) {
  const box = document.getElementById("futureResults");
  box.innerHTML = "";
  
  // Store for AI generation
  lastSimulationOutput = output;

  let text = `=== CAREER SUMMARY ===\n`;
  text += `MVP: ${output.awards.MVP}\n`;
  text += `ROY: ${output.awards.ROY}\n`;
  text += `MIP: ${output.awards.MIP}\n`;
  text += `All-Pro (Top15 PER): ${output.awards.AllPro}\n`;
  text += `Championships: ${output.awards.Champs}\n`;
  text += `Finals MVP: ${output.awards.FinalsMVP}\n`;
  text += `Hall of Fame: ${output.hof ? "YES" : "NO"}\n\n`;
  const totalGames = output.seasons.reduce((a, s) => a + s.custom.games, 0) || 1;
  const avgPts = output.seasons.reduce((a, s) => a + s.custom.pts * s.custom.games, 0) / totalGames;
  const avgAst = output.seasons.reduce((a, s) => a + s.custom.ast * s.custom.games, 0) / totalGames;
  const avgReb = output.seasons.reduce((a, s) => a + s.custom.reb * s.custom.games, 0) / totalGames;
  const avgStl = output.seasons.reduce((a, s) => a + s.custom.stl * s.custom.games, 0) / totalGames;
  const avgBlk = output.seasons.reduce((a, s) => a + s.custom.blk * s.custom.games, 0) / totalGames;
  const avgPer = output.seasons.reduce((a, s) => a + s.custom.per * s.custom.games, 0) / totalGames;
  text += `Career Length: ${output.totalYears} seasons (${output.totalGames} games)\n`;
  text += `Career Averages (Years ${output.totalYears}): PTS ${avgPts.toFixed(1)} | AST ${avgAst.toFixed(1)} | REB ${avgReb.toFixed(1)} | STL ${avgStl.toFixed(1)} | BLK ${avgBlk.toFixed(1)} | PER ${avgPer.toFixed(1)}\n\n`;

  // Advanced Metrics
  text += `=== ADVANCED METRICS ===\n`;
  text += `Career Variance Index (CVI): ${output.advancedMetrics.careerVarianceIndex.toFixed(2)} (std dev of PPG; lower = consistent)\n`;
  text += `Longevity Score: ${output.advancedMetrics.longevityScore} seasons (above replacement-level)\n`;
  text += `Peak vs Consistency Ratio: ${output.advancedMetrics.peakVsConsistency.toFixed(2)} (1.0–1.15 = steady; >1.4 = sharp peak)\n`;
  text += `Team Impact Score: ${output.advancedMetrics.teamImpactScore.toFixed(2)} (PPG × win% context)\n\n`;

  // Analytical Findings
  text += `=== ANALYTICAL FINDINGS ===\n`;
  const cviInterpretation = output.advancedMetrics.careerVarianceIndex < 2.5 ? "highly consistent" : output.advancedMetrics.careerVarianceIndex < 4.0 ? "moderately consistent" : "high variance";
  text += `• Career Profile: This player showed ${cviInterpretation} performance.\n`;
  
  if (output.advancedMetrics.longevityScore >= output.totalYears * 0.75) {
    text += `• Durability: Sustained excellence across multiple seasons (${output.advancedMetrics.longevityScore}/${output.totalYears}).\n`;
  } else {
    text += `• Career Arc: Performance fluctuated significantly (only ${output.advancedMetrics.longevityScore}/${output.totalYears} seasons above replacement level).\n`;
  }

  if (output.advancedMetrics.peakVsConsistency > 1.35) {
    text += `• Playing Style: Sharp peak player—elite potential but less sustained excellence.\n`;
  } else if (output.advancedMetrics.peakVsConsistency < 1.15) {
    text += `• Playing Style: Steady excellence—consistent performance throughout career.\n`;
  }

  if (output.advancedMetrics.teamImpactScore > avgPts * 0.6) {
    text += `• Team Context: High contextual impact—thrived on winning teams.\n`;
  } else {
    text += `• Team Context: Performance relatively independent of team success.\n`;
  }

  text += `\n`;
    text += `--- Season ${s.year} (${s.custom.team}) ---\n`;
    text += `${s.custom.name} Stats: PTS ${s.custom.pts.toFixed(1)} | AST ${s.custom.ast.toFixed(1)} | REB ${s.custom.reb.toFixed(1)} | STL ${s.custom.stl.toFixed(1)} | BLK ${s.custom.blk.toFixed(1)} | PER ${s.custom.per.toFixed(1)} | GP ${s.custom.games}\n`;
    text += `Team Wins: ${s.custom.wins}\n`;
    text += `MVP: ${s.awards.MVP.name} (${s.awards.MVP.team})\n`;
    if (s.awards.ROY) text += `ROY: ${s.awards.ROY.name} (${s.awards.ROY.team})\n`;
    if (s.awards.MIP) text += `MIP: ${s.awards.MIP.name} (${s.awards.MIP.team})\n`;
    text += `Champion: ${s.awards.Champion}\n`;
    text += `Finals MVP: ${s.awards.FinalsMVP.name} (${s.awards.FinalsMVP.team})\n\n`;

    text += `Top 10 PTS:\n`;
    s.leaderboards.topPts.forEach((p, idx) => {
      const mark = p.name === s.custom.name ? " *" : "";
      text += `${idx + 1}. ${p.name} (${p.team}) - ${p.pts.toFixed(1)}${mark}\n`;
    });

    text += `Top 10 AST:\n`;
    s.leaderboards.topAst.forEach((p, idx) => {
      const mark = p.name === s.custom.name ? " *" : "";
      text += `${idx + 1}. ${p.name} (${p.team}) - ${p.ast.toFixed(1)}${mark}\n`;
    });

    text += `Top 10 REB:\n`;
    s.leaderboards.topReb.forEach((p, idx) => {
      const mark = p.name === s.custom.name ? " *" : "";
      text += `${idx + 1}. ${p.name} (${p.team}) - ${p.reb.toFixed(1)}${mark}\n`;
    });

    text += `Top 10 PER:\n`;
    s.leaderboards.topPer.forEach((p, idx) => {
      const mark = p.name === s.custom.name ? " *" : "";
      text += `${idx + 1}. ${p.name} (${p.team}) - ${p.per.toFixed(1)}${mark}\n`;
    });

    text += `\n`;
  });

  const preEl = document.createElement('pre');
  preEl.className = 'sim-output';
  preEl.textContent = text;

  // Create AI buttons section
  const aiSection = document.createElement('div');
  aiSection.className = 'ai-button-group';
  aiSection.innerHTML = `
    <button id="aiGenGemini" class="ai-button" data-provider="gemini">✨ Generate Detailed Career (Gemini)</button>
    <button id="aiGenOllama" class="ai-button" data-provider="ollama">✨ Generate Detailed Career (Ollama)</button>
  `;

  box.appendChild(preEl);
  box.appendChild(aiSection);

  // Attach AI button handlers and check status
  setupAIButtons(output);
}

async function setupAIButtons(output) {
  // Fetch provider status
  const status = await fetchAIStatus();

  const geminiBtn = document.getElementById('aiGenGemini');
  const ollamaBtn = document.getElementById('aiGenOllama');

  // Disable Gemini if quota exhausted
  if (!status.gemini.enabled) {
    geminiBtn.disabled = true;
    geminiBtn.title = status.gemini.reason || 'Gemini is unavailable';
  } else {
    geminiBtn.onclick = () => generateAIBiography(output, 'gemini');
  }

  // Disable Ollama if unavailable
  if (!status.ollama.enabled) {
    ollamaBtn.disabled = true;
    ollamaBtn.title = status.ollama.reason || 'Ollama is unavailable';
  } else {
    ollamaBtn.onclick = () => generateAIBiography(output, 'ollama');
  }
}

async function generateAIBiography(output, provider) {
  const playerName = document.getElementById('playerName').value.trim();
  const position = document.getElementById('playerPosition').value;

  // Build career payload from simulation
  const careerPayload = buildCareerPayloadFromSim(output, playerName, position);
  const cacheKey = buildAICacheKey(playerName, position, provider);

  // Open modal and generate
  aiModal.open(provider, careerPayload, cacheKey);
}

function buildCareerPayloadFromSim(output, playerName, position) {
  const timeline = [];
  const teams = new Set();
  let careerHighPts = 0;
  let careerHighAst = 0;
  let careerHighReb = 0;
  const awards = [];

  // Build timeline and extract stats
  output.seasons.forEach((season, idx) => {
    teams.add(season.custom.team);
    careerHighPts = Math.max(careerHighPts, season.custom.pts);
    careerHighAst = Math.max(careerHighAst, season.custom.ast);
    careerHighReb = Math.max(careerHighReb, season.custom.reb);

    // Track awards
    if (idx === 0) {
      timeline.push({
        date: '2024-06-26',
        event: 'Drafted',
        details: `Selected in the 2024 NBA Draft`
      });

      timeline.push({
        date: '2024-10-01',
        event: 'NBA Debut',
        details: `Debuted with the ${season.custom.team}`
      });
    }

    // Add major awards as events
    if (season.awards && season.awards.MVP && season.awards.MVP.name === playerName) {
      timeline.push({
        date: `${2023 + idx}-04-01`,
        event: 'MVP Award',
        details: `Won the MVP award`
      });
    }

    if (season.awards && season.awards.ROY && season.awards.ROY.name === playerName) {
      timeline.push({
        date: `${2023 + idx}-05-01`,
        event: 'Rookie of the Year',
        details: `Won the Rookie of the Year award`
      });
    }

    if (season.custom.team === season.awards.Champion) {
      timeline.push({
        date: `${2023 + idx}-06-01`,
        event: 'Championship',
        details: `Won NBA championship with ${season.custom.team}`
      });
    }
  });

  return {
    player: {
      fullName: playerName,
      birthDate: 'Unknown',
      nationality: 'American',
      position: position,
      height: 'Unknown',
      college: 'Unknown'
    },
    careerTimeline: timeline,
    careerStats: {
      seasons: output.totalYears,
      teams: Array.from(teams),
      careerHighPoints: Math.round(careerHighPts),
      careerHighAssists: Math.round(careerHighAst),
      careerHighRebounds: Math.round(careerHighReb),
      awards: [
        `${output.awards.MVP} MVP Awards`,
        `${output.awards.AllPro} All-Pro Selections`,
        `${output.awards.Champs} Championships`
      ],
      injuries: []
    },
    modeContext: {
      gameMode: 'career',
      seed: null,
      note: 'All details are simulated from deterministic engine outputs.'
    }
  };
}

function buildAICacheKey(playerName, position, provider) {
  return `${playerName}|${position}|career|${provider}`;
}


/* =========================
   Wiring UI events
   ========================= */
document.addEventListener("DOMContentLoaded", async () => {
  await initDatabase();
  renderAttributeRows();

  document.getElementById("futureEra").onchange = e => {
    eraFilter = e.target.value;
  };

  document.getElementById("clearFuture").onclick = () => {
    resetPlayerBuilder();
  };

  document.getElementById("statsHelp").onclick = () => {
    openStatsHelpModal();
  };

  document.getElementById("simulateFuture").onclick = () => {
    if (!playersLoaded) return alert("Dataset still loading.");

    eraFilter = document.getElementById("futureEra").value;

    const name = document.getElementById("playerName").value.trim();
    if (!name) {
      alert("Please enter a player name before simulating.");
      return;
    }

    // ensure all attributes selected
    for (const a of activeAttributes) {
      if (!customPeak[a]) {
        alert(`Pick a player for ${a.toUpperCase()} first.`);
        return;
      }
    }

    const peak = {
      pts: customPeak.shooting ? customPeak.shooting.value : 0,
      ast: customPeak.passing ? customPeak.passing.value : 0,
      reb: customPeak.rebounding ? customPeak.rebounding.value : 0,
      stl: customPeak.steals ? customPeak.steals.value : 0,
      blk: customPeak.blocks ? customPeak.blocks.value : 0,
      g: customPeak.longevity ? customPeak.longevity.value : 0,
      ath: customPeak.athleticism ? customPeak.athleticism.value : 0,
      height: customPeak.height ? customPeak.height.value : 0
    };

    if (!chosenTeam) {
      alert("Pick a team before simulating.");
      return;
    }

    const output = simulateCareer(
      name,
      document.getElementById("playerPosition").value,
      peak,
      chosenTeam
    );
    renderResults(output);
  };
});
