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
      <label>Team Name</label>
      <input value="${p.teamName || ''}" onchange="participants[${i}].teamName=this.value" placeholder="Required for 5v5">
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
      <td><button type="button" class="dice-btn">Select</button></td>
    `;

    const selectHandler = () => {
      selectPlayer(participantIndex, key, p, isTeam);
      modal.classList.add('hidden');
    };
    const btn = tr.querySelector('button');
    if (btn) {
      btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        selectHandler();
      };
    }
    tr.onclick = selectHandler;

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
      source: p.Name,
      player: p
    };
  }

  renderGame();
}

/* =========================
   SIMULATION
   ========================= */
function runDeterministicSim() {
  const detail = document.getElementById('simDetail')?.value || 'full';
  const useDetail = gameMode === 'attribute' ? 'full' : detail;
  if (gameMode === 'team') {
    const missing = participants.some(p => !String(p.teamName || '').trim());
    if (missing) {
      alert('Please enter a team name for each participant.');
      return;
    }
  }
  const result = simulateMatchup(useDetail);
  document.getElementById('simulationResult').textContent = result;
}

function buildPlayerFromAttributes(p) {
  const shooting = p.attributes.shooting?.player;
  const passing = p.attributes.passing?.player;
  const rebounding = p.attributes.rebounding?.player;
  const longevity = p.attributes.longevity?.player;

  return {
    name: p.teamName || p.name,
    pts: Number(shooting?.PTS) || 0,
    ast: Number(passing?.AST) || 0,
    reb: Number(rebounding?.TRB) || 0,
    per: Number(shooting?.PER) || Number(passing?.PER) || Number(rebounding?.PER) || 0,
    fg: Number(shooting?.['FG%']) || 0,
    g: Number(longevity?.G) || 0
  };
}

function buildTeamFromDraft(p) {
  const playersArr = Object.values(p.team).filter(Boolean);
  const totals = playersArr.reduce((acc, pl) => {
    acc.pts += Number(pl.PTS) || 0;
    acc.ast += Number(pl.AST) || 0;
    acc.reb += Number(pl.TRB) || 0;
    acc.per += Number(pl.PER) || 0;
    acc.fg += Number(pl['FG%']) || 0;
    return acc;
  }, { pts: 0, ast: 0, reb: 0, per: 0, fg: 0 });

  const count = playersArr.length || 1;
  const impact = playersArr.reduce((sum, pl) => sum + playerImpact(pl), 0);
  return {
    name: p.name,
    pts: totals.pts,
    ast: totals.ast,
    reb: totals.reb,
    per: totals.per / count,
    fg: totals.fg / count,
    impact,
    players: playersArr
  };
}

function playerImpact(pl) {
  const pos = String(pl.Position || '').toUpperCase();
  const pts = Number(pl.PTS) || 0;
  const ast = Number(pl.AST) || 0;
  const reb = Number(pl.TRB) || 0;
  const per = Number(pl.PER) || 0;
  const hgt = Number(pl.Height) || 0;

  if (pos.includes('PG')) return ast * 1.6 + pts * 0.6 + per * 0.3;
  if (pos.includes('SG')) return pts * 1.6 + ast * 0.5 + per * 0.3;
  if (pos.includes('SF') || pos.includes('PF')) return per * 1.6 + pts * 0.6 + reb * 0.4;
  if (pos.includes('C')) return reb * 1.4 + hgt * 0.2 + per * 0.4;
  return pts * 1.0 + ast * 0.4 + reb * 0.4 + per * 0.3;
}

function seedFromNames(a, b) {
  const str = `${a}::${b}`;
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function rngFromSeed(seed) {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

function scoreFromStats(s, isTeam) {
  const pace = isTeam ? 110 : 100;
  const base = s.pts * 1.0 + s.ast * 0.4 + s.reb * 0.25 + s.per * 0.3 + s.fg * 0.2;
  const impactBoost = isTeam ? (s.impact || 0) * 0.35 : 0;
  const raw = base + impactBoost;
  return Math.max(60, Math.min(140, (raw / (isTeam ? 2.5 : 1.6)) + pace));
}

function simulateGameStory(a, b, detail, isTeam) {
  const seed = seedFromNames(a.name, b.name);
  const rng = rngFromSeed(seed);
  const baseA = scoreFromStats(a, isTeam);
  const baseB = scoreFromStats(b, isTeam);
  const variance = () => (rng() - 0.5) * 8;
  const scoreA = Math.round(baseA + variance());
  const scoreB = Math.round(baseB + variance());

  const lines = [];
  const leader = scoreA >= scoreB ? a : b;
  const trailer = scoreA >= scoreB ? b : a;

  const factors = isTeam ? buildTeamFactors(a, b) : buildPlayerFactors(a, b);

  if (detail === 'light') {
    lines.push(`Tipoff: ${a.name} vs ${b.name}`);
    lines.push(`${leader.name} starts strong and builds an early edge.`);
    lines.push(`Halftime: ${leader.name} leads.`);
    lines.push(`${trailer.name} makes a third-quarter push.`);
    lines.push(`Keys for ${leader.name}: ${factors.leader.join(', ')}`);
    lines.push(`Final: ${a.name} ${scoreA} - ${b.name} ${scoreB}`);
  } else if (detail === 'medium') {
    lines.push(`Tipoff: ${a.name} vs ${b.name}`);
    lines.push(`Q1: ${leader.name} takes the first lead.`);
    lines.push(`Q2: ${trailer.name} keeps it close before halftime.`);
    lines.push(`Halftime: ${leader.name} ahead.`);
    lines.push(`Q3: Momentum swings back and forth.`);
    lines.push(`Q4: ${leader.name} closes it out.`);
    lines.push(`Keys for ${leader.name}: ${factors.leader.join(', ')}`);
    lines.push(`Struggles for ${trailer.name}: ${factors.trailer.join(', ')}`);
    lines.push(`Final: ${a.name} ${scoreA} - ${b.name} ${scoreB}`);
  } else {
    lines.push(`Tipoff: ${a.name} vs ${b.name}`);
    lines.push(`${leader.name} jumps out early behind efficient scoring.`);
    lines.push(`${trailer.name} answers with a run to tighten it up.`);
    lines.push(`Halftime: ${leader.name} leads by a small margin.`);
    lines.push(`${trailer.name} pushes the pace in the third quarter.`);
    lines.push(`${leader.name} steadies with rebounding and ball movement.`);
    lines.push(`Final possessions: ${leader.name} seals the game.`);
    lines.push(`Keys for ${leader.name}: ${factors.leader.join(', ')}`);
    lines.push(`Struggles for ${trailer.name}: ${factors.trailer.join(', ')}`);
    lines.push(`Final: ${a.name} ${scoreA} - ${b.name} ${scoreB}`);
  }

  return { scoreA, scoreB, lines };
}

function topDiffs(a, b) {
  return [
    { label: 'Scoring', diff: (a.pts || 0) - (b.pts || 0) },
    { label: 'Playmaking', diff: (a.ast || 0) - (b.ast || 0) },
    { label: 'Rebounding', diff: (a.reb || 0) - (b.reb || 0) },
    { label: 'Efficiency', diff: (a.per || 0) - (b.per || 0) },
    { label: 'Shooting', diff: (a.fg || 0) - (b.fg || 0) }
  ].sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff));
}

function teamRoleMetrics(team) {
  const players = team.players || [];
  const metrics = {
    pgPlaymaking: 0,
    sgScoring: 0,
    wingEfficiency: 0,
    centerBoards: 0
  };
  players.forEach(pl => {
    const pos = String(pl.Position || '').toUpperCase();
    if (pos.includes('PG')) metrics.pgPlaymaking += Number(pl.AST) || 0;
    if (pos.includes('SG')) metrics.sgScoring += Number(pl.PTS) || 0;
    if (pos.includes('SF') || pos.includes('PF')) metrics.wingEfficiency += Number(pl.PER) || 0;
    if (pos.includes('C')) metrics.centerBoards += (Number(pl.TRB) || 0) + (Number(pl.Height) || 0) * 0.1;
  });
  return metrics;
}

function buildTeamFactors(a, b) {
  const diffs = topDiffs(a, b).slice(0, 2).map(d => ({
    label: `${d.label} edge`,
    score: Math.abs(d.diff)
  }));

  const aRoles = teamRoleMetrics(a);
  const bRoles = teamRoleMetrics(b);
  const roleDiffs = [
    { label: 'PG playmaking edge', score: Math.abs(aRoles.pgPlaymaking - bRoles.pgPlaymaking) },
    { label: 'SG scoring edge', score: Math.abs(aRoles.sgScoring - bRoles.sgScoring) },
    { label: 'Wing efficiency edge', score: Math.abs(aRoles.wingEfficiency - bRoles.wingEfficiency) },
    { label: 'Center rebounding edge', score: Math.abs(aRoles.centerBoards - bRoles.centerBoards) }
  ].sort((x, y) => y.score - x.score);

  const combined = [...diffs, roleDiffs[0]];
  const leader = combined.map(d => d.label).slice(0, 3);
  const trailer = combined.map(d => d.label.replace('edge', 'gap')).slice(0, 3);
  return { leader, trailer };
}

function buildPlayerFactors(a, b) {
  const diffs = topDiffs(a, b).slice(0, 3);
  const leader = diffs.map(d => `${d.label} advantage`);
  const trailer = diffs.map(d => `${d.label} deficit`);
  return { leader, trailer };
}

function simulateMatchup(detail) {
  if (participants.length < 2) {
    return 'Need at least 2 participants to simulate a matchup.';
  }

  const isTeam = gameMode === 'team';
  const entrants = participants.map(p => {
    if (gameMode === 'attribute') {
      return { entity: buildPlayerFromAttributes(p), participant: p };
    }
    return { entity: buildTeamFromDraft(p), participant: p };
  });

  const lines = [];

  const renderMatch = (a, b, roundLabel) => {
    const story = simulateGameStory(a.entity, b.entity, detail, isTeam);
    const header = isTeam
      ? `Team Battle: ${a.entity.name} vs ${b.entity.name}`
      : `Custom Players: ${a.entity.name} vs ${b.entity.name}`;
    lines.push(`${roundLabel} - ${header}`, '');
    lines.push(...buildStatLines(a, b, isTeam), '');
    lines.push(...story.lines, '');
    const winner = story.scoreA >= story.scoreB ? a : b;
    return winner;
  };

  if (entrants.length === 2) {
    renderMatch(entrants[0], entrants[1], 'Match');
    return lines.join('\n');
  }

  lines.push('Tournament Bracket', '');
  let round = 1;
  let current = entrants.slice().sort(() => 0.5 - Math.random());

  while (current.length > 1) {
    lines.push(`Round ${round}`, '');
    let next = [];
    if (current.length % 2 === 1) {
      const byeIdx = Math.floor(Math.random() * current.length);
      const bye = current.splice(byeIdx, 1)[0];
      lines.push(`${bye.entity.name} receives a bye.`, '');
      next.push(bye);
    }
    for (let i = 0; i < current.length; i += 2) {
      const winner = renderMatch(current[i], current[i + 1], `Round ${round}`);
      next.push(winner);
    }
    current = next;
    round += 1;
  }

  lines.push(`Champion: ${current[0].entity.name}`);
  return lines.join('\n');
}

function buildStatLines(a, b, isTeam) {
  const statLines = [];
  if (!isTeam) {
    const attrOrder = ['shooting', 'passing', 'rebounding', 'longevity', 'athleticism', 'height'];
    const labelMap = { shooting: 'Shooting', passing: 'Passing', rebounding: 'Rebounding', longevity: 'Longevity', athleticism: 'Athleticism', height: 'Height' };
    const buildAttrLines = (p) => {
      const lines = [`${p.participant.name} Attribute Picks:`];
      attrOrder.forEach(attr => {
        const sel = p.participant.attributes?.[attr];
        if (!sel) return;
        const pl = sel.player || {};
        const pts = fmt(pl.PTS, 1);
        const ast = fmt(pl.AST, 1);
        const reb = fmt(pl.TRB, 1);
        const per = fmt(pl.PER, 1);
        const fg = fmt(pl['FG%'], 1);
        lines.push(`- ${labelMap[attr]}: ${sel.source} | PTS ${pts} AST ${ast} REB ${reb} PER ${per} FG% ${fg}`);
      });
      return lines;
    };
    statLines.push(...buildAttrLines(a), '', ...buildAttrLines(b));
  } else {
    const buildTeamLines = (team) => {
      const lines = [`${team.entity.name} Roster:`];
      team.entity.players.forEach(pl => {
        lines.push(`- ${pl.Name} | PTS ${fmt(pl.PTS, 1)} AST ${fmt(pl.AST, 1)} REB ${fmt(pl.TRB, 1)} PER ${fmt(pl.PER, 1)} FG% ${fmt(pl['FG%'], 1)}`);
      });
      return lines;
    };
    statLines.push(...buildTeamLines(a), '', ...buildTeamLines(b));
  }
  return statLines;
}
