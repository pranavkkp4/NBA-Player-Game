/* =========================================================
   NBA PLAYER GAME - MAIN SCRIPT
   Deterministic / SQL-ready / GitHub Pages safe
   ========================================================= */

let SQL;
let db;

let players = [];
let playersLoaded = false;

let participants = [];
let gameMode = 'attribute';
let eraFilter = 'all';
let positionLocked = false;

const ATTRIBUTES = [
  'shooting',
  'passing',
  'rebounding',
  'longevity',
  'athleticism',
  'height'
];

const ATTR_MAP = {
  shooting: 'FG%',
  passing: 'AST',
  rebounding: 'TRB',
  longevity: 'G',
  height: 'Height'
};

const CSV_PATHS = ['data/NBA_PLAYERS.csv', 'NBA_PLAYERS.csv'];
const JSON_PATHS = ['data/nba_players.json', 'nba_players.json'];
const NUMERIC_COLS = new Set([
  'Debut', 'Final', 'Height', 'Weight', 'G', 'PTS', 'TRB', 'AST',
  'FG%', 'FG3%', 'FT%', 'eFG%', 'PER', 'WS'
]);
const NUMERIC_JSON_COLS = new Set([
  'Height', 'Weight', 'G', 'PTS', 'TRB', 'AST', 'STL', 'BLK',
  'FG%', 'FG3%', 'FT%', 'eFG%', 'PER', 'WS'
]);
const COLOR_STATS = ['PTS', 'AST', 'TRB', 'PER', 'FG%'];

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
   CSV -> SQL Helpers
   ========================= */
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
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

    if (ch === ',') {
      row.push(field);
      field = '';
      continue;
    }

    if (ch === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
      continue;
    }

    field += ch;
  }

  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ''));
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
  throw lastErr || new Error('Failed to load CSV');
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
  throw lastErr || new Error('Failed to load JSON');
}

function buildDatabaseFromCSV(csvText) {
  const rows = parseCSV(csvText);
  const header = rows[0];
  const dataRows = rows.slice(1);

  const columnsSql = header.map(h => `"${h}" ${NUMERIC_COLS.has(h) ? 'REAL' : 'TEXT'}`).join(', ');
  db.run(`CREATE TABLE players (${columnsSql});`);

  const placeholders = header.map(() => '?').join(', ');
  const stmt = db.prepare(`INSERT INTO players VALUES (${placeholders});`);

  db.run('BEGIN TRANSACTION;');
  dataRows.forEach(r => {
    const values = header.map((h, idx) => {
      const raw = r[idx] ?? '';
      if (raw === '') return null;
      if (NUMERIC_COLS.has(h)) return Number(raw);
      return raw;
    });
    stmt.run(values);
  });
  db.run('COMMIT;');
  stmt.free();
}

function parsePosition(pos) {
  if (!pos) return [];
  let arr = [];
  const trimmed = String(pos).trim();
  if (trimmed.startsWith('[')) {
    try {
      arr = JSON.parse(trimmed.replace(/'/g, '"'));
    } catch {
      arr = [];
    }
  } else if (trimmed.includes('-')) {
    arr = trimmed.split('-');
  } else if (trimmed.includes('/')) {
    arr = trimmed.split('/');
  } else {
    arr = [trimmed];
  }
  return arr.map(s => String(s).trim()).filter(Boolean);
}

function positionMatchesSlot(posArray, slot) {
  const roles = new Set(posArray);
  if (slot === 'C') return roles.has('Center');
  if (slot === 'PG' || slot === 'SG') {
    return roles.has('Guard') || roles.has('Guard-Forward') || roles.has('Forward-Guard');
  }
  if (slot === 'SF' || slot === 'PF') {
    return roles.has('Forward') || roles.has('Forward-Center') || roles.has('Center-Forward') || roles.has('Guard-Forward') || roles.has('Forward-Guard');
  }
  return false;
}

function fmt(value, digits = 1) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 'N/A';
  return num.toFixed(digits);
}

function getPositionGroup(posArray) {
  const roles = new Set(posArray || []);
  if (roles.has('Center') && !roles.has('Guard')) return 'C';
  if (roles.has('Guard') && !roles.has('Center')) return 'G';
  return 'F';
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

  ['G', 'F', 'C'].forEach(g => {
    const groupPlayers = pool.filter(p => getPositionGroup(p.PositionArr) === g);
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

  return context;
}

function statClass(value, stat, posGroup, context) {
  const v = Number(value);
  if (!Number.isFinite(v)) return '';
  const top = context.top10[stat];
  if (Number.isFinite(top) && v >= top) return 'stat-gold';
  const entry = context.pos[posGroup]?.[stat];
  if (!entry) return '';
  const mean = entry.mean;
  const std = entry.std || 1;
  if (v > mean + 0.5 * std) return 'stat-green';
  if (v >= mean - 0.5 * std) return 'stat-yellow';
  if (v >= mean - 1.0 * std) return 'stat-orange';
  return 'stat-red';
}

/* =========================
   DATABASE INIT (sql.js)
   ========================= */
let availableCols = new Set();

function loadAvailableCols() {
  const res = db.exec('PRAGMA table_info(players);');
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
    const colType = NUMERIC_JSON_COLS.has(col) || NUMERIC_COLS.has(col) ? 'REAL' : 'TEXT';
    db.run(`ALTER TABLE players ADD COLUMN "${col}" ${colType};`);
    availableCols.add(col);
  });
}

function mergeJsonIntoDatabase(jsonData) {
  if (!Array.isArray(jsonData) || jsonData.length === 0) return;

  const sample = jsonData[0];
  const jsonCols = Object.keys(sample).filter(k => k !== 'Name');
  ensureColumns(jsonCols);

  const colsToUpdate = jsonCols.filter(c => availableCols.has(c));
  if (colsToUpdate.length === 0) return;

  const setSql = colsToUpdate.map(c => `"${c}" = ?`).join(', ');
  const stmt = db.prepare(`UPDATE players SET ${setSql} WHERE Name = ?;`);

  db.run('BEGIN TRANSACTION;');
  jsonData.forEach(row => {
    if (!row || !row.Name) return;
    const values = colsToUpdate.map(c => {
      const raw = row[c];
      if (raw === undefined || raw === null || raw === '') return null;
      if (NUMERIC_JSON_COLS.has(c)) return Number(raw);
      return Array.isArray(raw) ? raw.join(', ') : raw;
    });
    values.push(row.Name);
    stmt.run(values);
  });
  db.run('COMMIT;');
  stmt.free();
}

function updateStatToggles() {
  const toggleRows = document.querySelectorAll('.stat-options label');
  toggleRows.forEach(label => {
    const input = label.querySelector('input[data-stat]');
    if (!input) return;
    const stat = input.getAttribute('data-stat');
    if (!hasCol(stat) && (stat === 'STL' || stat === 'BLK')) {
      label.style.display = 'none';
    }
  });
}

async function initDatabase() {
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

  const res = db.exec(`SELECT Name, Debut, Position, Height, G, PTS, TRB, AST, PER, "FG%" FROM players`);
  players = res[0].values.map(row => {
    const obj = {};
    res[0].columns.forEach((c, i) => obj[c] = row[i]);
    obj.PositionArr = parsePosition(obj.Position);
    return obj;
  });

  playersLoaded = true;
  document.getElementById('dataStatus').textContent =
    `Loaded ${players.length} NBA players`;
  updateStatToggles();
}

/* =========================
   ERA FILTER
   ========================= */
function inEra(player) {
  if (eraFilter === 'all') return true;
  const start = parseInt(eraFilter.slice(0, 4));
  return player.Debut >= start && player.Debut < start + 10;
}

/* =========================
   GAME SETUP
   ========================= */
document.addEventListener('DOMContentLoaded', async () => {
  await initDatabase();

  document.getElementById('startGame').onclick = startGame;
  document.getElementById('simulateLocal').onclick = runDeterministicSim;
  document.getElementById('positionLockToggle').onchange = e =>
    positionLocked = e.target.checked;
  const statsHelpBtn = document.getElementById('statsHelp');
  if (statsHelpBtn) statsHelpBtn.onclick = openStatsHelpModal;
});

function startGame() {
  gameMode = document.getElementById('gameMode').value;
  eraFilter = document.getElementById('era').value;

  const n = parseInt(document.getElementById('numParticipants').value);
  participants = [];

  for (let i = 0; i < n; i++) {
    participants.push({
      name: `Participant ${i + 1}`,
      position: 'PG',
      attributes: {},
      team: {},
      teamName: null
    });
  }

  renderGame();
}

/* =========================
   RENDER
   ========================= */
function renderGame() {
  const area = document.getElementById('gameArea');
  area.innerHTML = '';

  participants.forEach((p, i) => {
    const card = document.createElement('div');
    card.className = 'participant';

    card.innerHTML = `
      <h3>Participant ${i + 1}</h3>
      <label>Name</label>
      <input value="${p.name}" onchange="participants[${i}].name=this.value">
      <label>Position</label>
      <select onchange="participants[${i}].position=this.value">
        <option ${p.position === 'PG' ? 'selected' : ''}>PG</option>
        <option ${p.position === 'SG' ? 'selected' : ''}>SG</option>
        <option ${p.position === 'SF' ? 'selected' : ''}>SF</option>
        <option ${p.position === 'PF' ? 'selected' : ''}>PF</option>
        <option ${p.position === 'C' ? 'selected' : ''}>C</option>
      </select>
      <div class="rows"></div>
    `;

    const rows = card.querySelector('.rows');

    if (gameMode === 'attribute') {
      ATTRIBUTES.forEach(attr => {
        rows.appendChild(attributeRow(i, attr, p));
      });
    } else {
      ['PG', 'SG', 'SF', 'PF', 'C'].forEach(pos => {
        rows.appendChild(teamRow(i, pos, p));
      });
    }

    area.appendChild(card);
  });
}

/* =========================
   ATTRIBUTE ROW
   ========================= */
function attributeRow(i, attr, participant) {
  const row = document.createElement('div');
  row.className = 'attr-row';

  const label = document.createElement('div');
  label.className = 'attr-label';
  label.textContent = attr.toUpperCase();

  const value = document.createElement('div');
  value.className = 'attr-value';
  const selected = participant?.attributes?.[attr];
  const val = selected && Number.isFinite(selected.value) ? selected.value.toFixed(2) : '';
  const display = selected ? `${selected.source}${val ? ` (${val})` : ''}` : '';
  value.innerHTML = `<input readonly placeholder="Not chosen" value="${display}">`;

  const btn = document.createElement('button');
  btn.className = 'dice-btn';
  btn.textContent = 'Pick';
  btn.onclick = () => openModal(i, attr);

  row.append(label, value, btn);
  return row;
}

/* =========================
   TEAM ROW
   ========================= */
function teamRow(i, pos, participant) {
  const row = document.createElement('div');
  row.className = 'attr-row';

  const selected = participant?.team?.[pos];
  const display = selected ? `${selected.Name}` : '';
  row.innerHTML = `
    <div class="attr-label">${pos}</div>
    <div class="attr-value"><input readonly placeholder="Empty" value="${display}"></div>
    <button class="dice-btn">Pick</button>
  `;

  row.querySelector('button').onclick =
    () => openModal(i, pos, true);

  return row;
}

/* =========================
   MODAL
   ========================= */
function openModal(participantIndex, key, isTeam = false) {
  const modal = document.getElementById('modalOverlay');
  const body = document.getElementById('modalBody');
  const legend = document.getElementById('modalLegend');
  if (legend) legend.style.display = '';
  body.innerHTML = '';

  let pool = players.filter(p => inEra(p));
  const context = buildStatContext(pool);

  if (isTeam && positionLocked) {
    pool = pool.filter(p => positionMatchesSlot(p.PositionArr, key));
  }

  pool = pool.sort(() => 0.5 - Math.random()).slice(0, 10);

  const table = document.createElement('table');
  table.className = 'pick-table';

  table.innerHTML = `
    <thead>
      <tr>
        <th>Name</th><th>Pos</th><th>PTS</th>
        <th>AST</th><th>TRB</th><th>PER</th><th>FG%</th>
        <th></th>
      </tr>
    </thead>
    <tbody></tbody>
  `;

  const tb = table.querySelector('tbody');

  pool.forEach(p => {
    const posGroup = getPositionGroup(p.PositionArr);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${p.Name}</td>
      <td>${p.Position}</td>
      <td class="${statClass(p.PTS, 'PTS', posGroup, context)}">${fmt(p.PTS, 1)}</td>
      <td class="${statClass(p.AST, 'AST', posGroup, context)}">${fmt(p.AST, 1)}</td>
      <td class="${statClass(p.TRB, 'TRB', posGroup, context)}">${fmt(p.TRB, 1)}</td>
      <td class="${statClass(p.PER, 'PER', posGroup, context)}">${fmt(p.PER, 1)}</td>
      <td class="${statClass(p['FG%'], 'FG%', posGroup, context)}">${fmt(p['FG%'], 1)}</td>
      <td><button class="dice-btn">Select</button></td>
    `;

    tr.querySelector('button').onclick = () => {
      selectPlayer(participantIndex, key, p, isTeam);
      modal.classList.add('hidden');
    };

    tb.appendChild(tr);
  });

  body.appendChild(table);
  modal.classList.remove('hidden');
  document.getElementById('modalClose').onclick =
    () => modal.classList.add('hidden');
}

function openStatsHelpModal() {
  const modal = document.getElementById('modalOverlay');
  const body = document.getElementById('modalBody');
  const title = document.getElementById('modalTitle');
  const legend = document.getElementById('modalLegend');
  if (legend) legend.style.display = 'none';
  title.textContent = 'How the Simulation Works';

  body.innerHTML = `
    <div class="card" style="box-shadow:none; margin:0;">
      <p class="muted">
        The draft mode compares the real career averages of the players you select.
        Attribute mode combines each picked player’s stat into one custom profile.
      </p>
      <h3>Athleticism (ATH)</h3>
      <pre class="sim-output" style="margin-top:6px; white-space:pre-wrap;">ATH = 0.45*perNorm + 0.20*fgBonus + 0.20*rebBonus + 0.10*durability + 0.05*heightBonus

perNorm = clamp((PER-15)/10, -1.5, 1.5)
fgBonus = (FG% - 0.45) * 4
rebBonus = min(REB / 10, 1.2)
durability = min(G / 1200, 1.0)
heightBonus = (Height - 78) / 12</pre>
      <p class="muted">
        In plain English: ATH blends efficiency, shooting, rebounding, durability, and height into one score.
      </p>
    </div>
  `;

  modal.classList.remove('hidden');
  document.getElementById('modalClose').onclick =
    () => modal.classList.add('hidden');
}

/* =========================
   SELECT PLAYER
   ========================= */
function selectPlayer(i, key, p, isTeam) {
  if (isTeam) {
    participants[i].team[key] = p;
  } else {
    let val;
    if (key === 'athleticism') {
      val = computeAthleticism({
        per: p.PER, fg: p['FG%'],
        reb: p.TRB, g: p.G, height: p.Height
      });
    } else {
      const raw = p[ATTR_MAP[key]] ?? p[key.toUpperCase()];
      const num = Number(raw);
      val = Number.isFinite(num) ? num : 0;
    }

    participants[i].attributes[key] = {
      value: val,
      source: p.Name
    };
  }

  renderGame();
}

/* =========================
   SIMULATION
   ========================= */
function runDeterministicSim() {
  let result = '';

  participants.forEach(p => {
    let score = 0;

    if (gameMode === 'attribute') {
      for (const a of Object.values(p.attributes)) {
        score += a.value || 0;
      }
    } else {
      for (const pl of Object.values(p.team)) {
        score += (Number(pl.PTS) || 0) + (Number(pl.AST) || 0) + (Number(pl.TRB) || 0);
      }
    }

    result += `${p.name}: ${score.toFixed(1)}\n`;
  });

  document.getElementById('simulationResult').textContent = result;
}
