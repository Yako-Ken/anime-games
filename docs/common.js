// Shared helpers used by both games (draft auction + deal-or-no-deal boxes):
// match simulation, goal-scorer weighting, and history persistence.

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

let _characterDbCache = null;
let _characterDbCacheTheme = null;

function getGameTheme() {
  return localStorage.getItem('gameTheme') || 'anime';
}

function getThemeDatabaseFile(theme) {
  if (theme === 'ml') return 'characters-ml.json';
  if (theme === 'football') return 'players-football.json';
  return 'characters.json';
}

async function loadCharacterDatabase() {
  const theme = getGameTheme();
  if (_characterDbCache && _characterDbCacheTheme === theme) return _characterDbCache;
  const file = getThemeDatabaseFile(theme);
  const res = await fetch(file);
  if (!res.ok) throw new Error(`Failed to load ${file}: ${res.status}`);
  _characterDbCache = await res.json();
  _characterDbCacheTheme = theme;
  return _characterDbCache;
}

// Friendly Arabic error message for the loading-screen catch blocks in
// app.js/deal.js/packs.js — an empty/too-small theme database (e.g. Mobile
// Legends before its data file is filled in) is a very different situation
// from a real network failure, so it gets its own message.
function poolLoadErrorMessage(e) {
  if (getGameTheme() === 'ml') {
    return 'قاعدة بيانات موبايل ليجند لسه فاضية أو ناقصة شخصيات — ضيف شخصيات في characters-ml.json الأول.';
  }
  return 'تعذر تحميل الشخصيات: ' + (e?.message || 'حصل خطأ غير متوقع') + '. تأكد إن عندك إنترنت.';
}

// Same rank-based pricing curve the old server used: most-favorited character in the
// SAMPLE lands near 150, least favorited near 1, curved (not linear) so a handful of
// "superstars" stand out.
function assignPricesByRank(characters) {
  const sorted = [...characters].sort((a, b) => b.favorites - a.favorites);
  const n = sorted.length;
  return sorted.map((c, i) => {
    const percentile = n <= 1 ? 0 : i / (n - 1);
    const curved = Math.pow(1 - percentile, 2.2);
    const jitter = Math.floor(Math.random() * 7) - 3;
    const price = Math.round(curved * 149) + 1 + jitter;
    return { ...c, price: Math.min(150, Math.max(1, price)) };
  });
}

// Returns `count` random characters from the database, each with a `price` assigned.
// Throws if the database has fewer than `count` characters (caller should catch).
async function getRandomPricedPool(count) {
  const db = await loadCharacterDatabase();
  if (db.length < count) throw new Error(`Not enough characters (have ${db.length}, need ${count})`);
  const sample = shuffle([...db]).slice(0, count);
  return shuffle(assignPricesByRank(sample));
}

// Returns the full raw database (unshuffled, no price field) for callers that do
// their own sampling logic (e.g. sorting by favorites for "headliner" characters).
async function getFullCharacterDatabase() {
  return loadCharacterDatabase();
}

function tallyScorers(names) {
  const counts = new Map();
  for (const name of names) counts.set(name, (counts.get(name) || 0) + 1);
  return counts;
}

// Broken-image fallback (offline / empty image field): swap any failed <img>
// for an inline SVG placeholder. Registered once via capture-phase listener.
const PLACEHOLDER_IMG = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="266"><rect width="200" height="266" rx="12" fill="#23263d"/><text x="100" y="140" font-size="64" text-anchor="middle">🎴</text></svg>`
);
document.addEventListener('error', (e) => {
  const t = e.target;
  if (t && t.tagName === 'IMG' && !t.dataset.fb) {
    t.dataset.fb = '1';
    t.src = PLACEHOLDER_IMG;
  }
}, true);

// ---- Skill-based power engine ----
// Football entries carry explicit stats (rating/pac/sho/pas/dri/def/phy).
// Anime/ML entries carry only `favorites` (+ draft `price`), so we derive a
// stable per-character card from them: overall follows favorites (log scale,
// 62..99, so true popularity order is preserved), and atk/def/spd are split
// deterministically from mal_id (same character => same card every game).
function seededFrac(seed, salt) {
  let h = (seed * 2654435761 + salt * 40503) >>> 0;
  h ^= h >>> 15; h = (h * 2246822519) >>> 0; h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

function charCard(c) {
  if (c && typeof c.rating === 'number') {
    return {
      overall: c.rating,
      atk: c.position === 'GK' ? 45 : Math.round(((c.sho || 60) + (c.dri || 60) + (c.pac || 60)) / 3),
      def: Math.round(((c.def || 60) + (c.phy || 60)) / 2),
      spd: c.pac || 60,
      star: c.rating >= 93,
    };
  }
  const fav = c.favorites || 0;
  const overall = Math.round(62 + 37 * (Math.log10(fav + 10) / 5));
  const id = c.mal_id || 1;
  const atk = Math.min(99, overall - 4 + Math.round(seededFrac(id, 1) * 10));
  const def = Math.min(99, overall - 4 + Math.round(seededFrac(id, 2) * 10));
  return { overall, atk, def, spd: Math.min(99, overall - 2 + Math.round(seededFrac(id, 3) * 8)), star: overall >= 90 };
}

// squad may contain null entries (deal-or-no-deal: a category can end up empty)
// and entries may or may not carry a `price` (only the draft game has one).
function teamPower(squad) {
  const present = squad.filter(Boolean);
  const priceSum = present.reduce((s, c) => s + (c.price || 0), 0);
  const ovSum = present.reduce((s, c) => s + charCard(c).overall, 0);
  return Math.round(ovSum + priceSum * 0.15);
}

// ---- Abilities / tiers / lines (engine v2) ----
const ABIL_FILES = {
  anime: 'characters-abilities.json',
  ml: 'ml-abilities.json',
  football: 'football-abilities.json',
};
let _abilCache = {}; // theme -> {name: entry}

async function ensureAbilities(theme) {
  theme = theme || getGameTheme();
  if (_abilCache[theme]) return _abilCache[theme];
  _abilCache[theme] = {};
  try {
    const res = await fetch(ABIL_FILES[theme] || ABIL_FILES.anime);
    if (res.ok) {
      const data = await res.json();
      _abilCache[theme] = data && typeof data === 'object' ? data : {};
    }
  } catch (e) { /* offline-first: play with defaults */ }
  return _abilCache[theme];
}

function getAbil(name, theme) {
  const map = _abilCache[theme || getGameTheme()] || {};
  return map[name] || null;
}

// True cross-universe fighting tier (5 = godlike, 1 = normal human).
// Uncurated characters default low so a famous human can never out-tank a curse.
function tierOf(c, theme) {
  const a = c && getAbil(c.name, theme);
  if (a && typeof a.tier === 'number') return a.tier;
  if (c && typeof c.rating === 'number') return c.rating >= 90 ? 2 : 1;
  return 2;
}

function abilOf(c, effect, theme) {
  const a = c && getAbil(c.name, theme);
  const list = a && Array.isArray(a.abilities) ? a.abilities : [];
  return list.find(ab => ab.effect === effect) || null;
}

const LINE_META = {
  GK: { icon: '🧤', label: 'حارس' },
  DEF: { icon: '🛡️', label: 'مدافع' },
  MID: { icon: '🎯', label: 'وسط' },
  FWD: { icon: '⚽', label: 'مهاجم' },
};

// Fixed positional line for a character. Football uses the real position,
// ML uses the curated line, anime falls back to a stat archetype.
// A character NEVER changes line during a match.
function lineOf(c, theme) {
  theme = theme || getGameTheme();
  if (c && c.position && LINE_META[c.position]) return c.position;
  const a = c && getAbil(c.name, theme);
  if (a && LINE_META[a.line]) return a.line;
  const card = charCard(c || {});
  if (card.atk >= card.def + 6) return 'FWD';
  if (card.def >= card.atk + 6) return 'DEF';
  return 'MID';
}

function formationFor(n) {
  if (n <= 0) return { GK: 0, DEF: 0, MID: 0, FWD: 0 };
  if (n === 1) return { GK: 0, DEF: 0, MID: 1, FWD: 0 };
  if (n === 2) return { GK: 1, DEF: 0, MID: 0, FWD: 1 };
  if (n === 3) return { GK: 1, DEF: 1, MID: 0, FWD: 1 };
  const rest = n - 1;
  const fwd = Math.max(1, Math.round(rest * 0.27));
  const def = Math.max(1, Math.round(rest * 0.4));
  return { GK: 1, DEF: def, MID: Math.max(0, rest - fwd - def), FWD: fwd };
}

// Split a squad into fixed lines for the whole match: GK = best shot-stopper,
// DEF = next best defenders (prefer true defenders), FWD = best attackers
// (prefer true forwards), rest = MID.
function assignLines(squad, theme) {
  theme = theme || getGameTheme();
  const present = squad.filter(Boolean);
  const lines = { GK: [], DEF: [], MID: [], FWD: [] };
  if (!present.length) return lines;
  const form = formationFor(present.length);
  const pool = [...present];
  const takeBest = (n, key, preferLine) => {
    const out = [];
    const pref = pool.filter(c => lineOf(c, theme) === preferLine)
      .sort((a, b) => charCard(b)[key] - charCard(a)[key]);
    while (out.length < n && pref.length) {
      const c = pref.shift();
      pool.splice(pool.indexOf(c), 1);
      out.push(c);
    }
    pool.sort((a, b) => charCard(b)[key] - charCard(a)[key]);
    while (out.length < n && pool.length) out.push(pool.shift());
    return out;
  };
  lines.GK = takeBest(form.GK, 'def', 'GK');
  lines.DEF = takeBest(form.DEF, 'def', 'DEF');
  lines.FWD = takeBest(form.FWD, 'atk', 'FWD');
  lines.MID = pool;
  return lines;
}

// Positional pool for position-ordered games (draft: GK -> DEF -> MID -> FWD).
// Returns priced characters in slot order, each with a `slot` line field.
async function getSlotPool(quotas, theme) {
  theme = theme || getGameTheme();
  await ensureAbilities(theme);
  const db = await loadCharacterDatabase();
  const total = quotas.GK + quotas.DEF + quotas.MID + quotas.FWD;
  if (db.length < total) throw new Error(`Not enough characters (have ${db.length}, need ${total})`);
  const groups = { GK: [], DEF: [], MID: [], FWD: [] };
  for (const c of shuffle([...db])) groups[lineOf(c, theme)].push(c);
  const picked = [];
  const take = (line, n, fallback) => {
    for (let i = 0; i < n; i++) {
      let c = groups[line].pop();
      if (!c) c = (fallback || ['DEF', 'MID', 'FWD', 'GK']).map(l => groups[l].pop()).find(Boolean);
      if (!c) throw new Error('Pool exhausted while filling ' + line + ' slots');
      picked.push({ ...c, slot: line });
    }
  };
  take('GK', quotas.GK, ['DEF', 'MID', 'FWD']);
  take('DEF', quotas.DEF);
  take('MID', quotas.MID);
  take('FWD', quotas.FWD);
  const priced = assignPricesByRank(picked);
  const byKey = new Map(picked.map(c => [c.mal_id + '|' + c.name, c.slot]));
  return priced.map(c => ({ ...c, slot: byKey.get(c.mal_id + '|' + c.name) || 'MID' }));
}

// Group an ordered slot pool into auction pairs (same line per round:
// winner takes the auctioned star, loser takes the bonus consolation).
function pairBySlot(pool) {
  const groups = { GK: [], DEF: [], MID: [], FWD: [] };
  for (const c of pool) (groups[c.slot] || groups.MID).push(c);
  const pairs = [];
  for (const line of ['GK', 'DEF', 'MID', 'FWD']) {
    const g = groups[line];
    for (let i = 0; i + 1 < g.length; i += 2) {
      pairs.push({ line, auction: g[i], bonus: g[i + 1] });
    }
  }
  return pairs;
}

// Weighted pick among shooters (MID/FWD, rare DEF long shot).
function weightedPickShooter(lines, theme) {
  const cand = [...lines.MID, ...lines.FWD];
  const defs = lines.DEF;
  if (!cand.length && !defs.length) return null;
  if (cand.length && (defs.length === 0 || Math.random() > 0.12)) {
    const weights = cand.map(c => Math.max(1, charCard(c).atk * 2 + ((abilOf(c, 'finisher', theme)?.p || 0) * 120)));
    let r = Math.random() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < cand.length; i++) { r -= weights[i]; if (r <= 0) return cand[i]; }
    return cand[cand.length - 1];
  }
  return defs[Math.floor(Math.random() * defs.length)];
}

function activePlayers(lines, ejected) {
  return [...lines.GK, ...lines.DEF, ...lines.MID, ...lines.FWD].filter(c => !ejected.has(c));
}

function avgStat(list, key) {
  if (!list.length) return 50;
  return list.reduce((s, c) => s + charCard(c)[key], 0) / list.length;
}

// Full 90-minute simulation with FIXED positional lines, real abilities,
// true power tiers, goal-line clearances, and real red-card ejections.
// Events are icon+name only (no commentary): each carries a HOW chain
// (dribbled-past names, skill used, rocket shot, keeper action).
// Returns classic score fields + timeline + stats + lines + ejected.
function simulateMatch(squad1, squad2, theme) {
  theme = theme || getGameTheme();
  const L1 = assignLines(squad1, theme);
  const L2 = assignLines(squad2, theme);
  const power1 = teamPower(squad1);
  const power2 = teamPower(squad2);
  const scorers1 = [];
  const scorers2 = [];
  const timeline = [];
  const ejected = new Set();
  const yellows = new Map(); // player obj -> count
  const stats = {
    1: { shots: 0, onTarget: 0, saves: 0, clearances: 0, skills: 0, yellow: 0, red: 0 },
    2: { shots: 0, onTarget: 0, saves: 0, clearances: 0, skills: 0, yellow: 0, red: 0 },
  };
  const key = (c) => c;
  const push = (ev) => timeline.push(ev);

  const teamMods = (L, opp) => {
    let play = 0, wall = 0;
    for (const c of activePlayers(L, ejected)) {
      if (abilOf(c, 'playmaker', theme)) play += 0.02;
      if (abilOf(c, 'wall', theme)) wall += 0.03;
    }
    return { play: Math.min(0.06, play), wall: Math.min(0.09, wall) };
  };

  const keeperOf = (L) => {
    const act = activePlayers(L, ejected);
    if (!act.length) return null;
    const gk = L.GK.find(c => !ejected.has(c));
    if (gk) return gk;
    return act.reduce((b, c) => (charCard(c).def > charCard(b).def ? c : b), act[0]);
  };

  const resolveShot = (min, side, shooter, viaBlitz) => {
    const L = side === 1 ? L1 : L2;
    const O = side === 1 ? L2 : L1;
    const st = stats[side];
    st.shots++;
    const card = charCard(shooter);
    const keeper = keeperOf(O);
    const keeperCard = keeper ? charCard(keeper) : { def: 55, overall: 55 };
    const keeperTier = keeper ? tierOf(keeper, theme) : 1;
    const mods = teamMods(L, O);
    const oppMods = teamMods(O, L);

    let beat = [];
    if (!viaBlitz && Math.random() < 0.35) {
      const blockers = [...O.MID, ...O.DEF].filter(c => !ejected.has(c) && c !== keeper);
      if (blockers.length) beat = [blockers[Math.floor(Math.random() * blockers.length)].name];
    }
    let skill = null;
    const fin = abilOf(shooter, 'finisher', theme);
    if (fin && Math.random() < fin.p) skill = { icon: fin.icon, name: fin.name, effect: 'finisher' };
    const rocket = card.atk >= 94;
    const clutch = abilOf(shooter, 'clutch', theme) && min >= 75;
    if (clutch && !skill) {
      const cl = abilOf(shooter, 'clutch', theme);
      skill = { icon: cl.icon, name: cl.name, effect: 'clutch' };
    }

    let goalP = 0.40 * (card.atk / Math.max(50, keeperCard.def))
      + 0.05 * (tierOf(shooter, theme) - keeperTier)
      + (skill ? 0.10 : 0) + (clutch ? 0.12 : 0)
      + mods.play - oppMods.wall;
    goalP = Math.min(0.92, Math.max(0.05, goalP));

    if (Math.random() < goalP) {
      // Nullifiers (Infinity, shields...) can still cancel it — unless
      // the shooter out-tiers them by 2+ (a god ignores mortal shields).
      const nullifiers = activePlayers(O, ejected).filter(c => abilOf(c, 'nullify', theme));
      for (const n of nullifiers) {
        const ab = abilOf(n, 'nullify', theme);
        const p = ab.p * (tierOf(shooter, theme) > tierOf(n, theme) + 1 ? 0.5 : 1);
        if (Math.random() < p) {
          st.onTarget++;
          stats[side === 1 ? 2 : 1].saves++;
          push({ min, side, t: 'cancel', player: n.name, skill: { icon: ab.icon, name: ab.name, effect: 'nullify' }, shooter: shooter.name });
          return;
        }
      }
      // Goal-line clearance by a defender?
      const backs = O.DEF.filter(c => !ejected.has(c));
      if (backs.length && Math.random() < 0.10 * (avgStat(backs, 'def') / 80)) {
        const d = backs[Math.floor(Math.random() * backs.length)];
        st.onTarget++;
        stats[side === 1 ? 2 : 1].clearances++;
        stats[side === 1 ? 2 : 1].saves++;
        push({ min, side, t: 'clear', player: d.name, shooter: shooter.name });
        return;
      }
      (side === 1 ? scorers1 : scorers2).push(shooter.name);
      st.onTarget++;
      if (skill) st.skills++;
      push({ min, side, t: 'goal', player: shooter.name, beat, skill, rocket, keeper: keeper ? keeper.name : null });
    } else {
      st.onTarget++;
      stats[side === 1 ? 2 : 1].saves++;
      const big = card.star || tierOf(shooter, theme) >= 4;
      push({ min, side, t: 'save', player: keeper ? keeper.name : '—', shooter: shooter.name, big });
      if (skill) st.skills++;
      if (skill && Math.random() < 0.5) push({ min, side, t: 'star', player: shooter.name, skill });
    }
  };

  for (let min = 1; min <= 90; min++) {
    for (const side of [1, 2]) {
      const L = side === 1 ? L1 : L2;
      const O = side === 1 ? L2 : L1;
      const atkPool = [...L.MID, ...L.FWD].filter(c => !ejected.has(c));
      if (!atkPool.length) continue;
      const defPool = [...O.DEF, ...O.GK].filter(c => !ejected.has(c));
      const chanceP = 0.05 * (avgStat(atkPool, 'atk') / Math.max(55, avgStat(defPool, 'def')));
      if (Math.random() >= chanceP) continue;
      const shooter = weightedPickShooter(
        { GK: L.GK.filter(c => !ejected.has(c)), DEF: L.DEF.filter(c => !ejected.has(c)), MID: L.MID.filter(c => !ejected.has(c)), FWD: L.FWD.filter(c => !ejected.has(c)) },
        theme
      );
      if (!shooter || ejected.has(shooter)) continue;
      resolveShot(min, side, shooter, false);
      // Blitz counters (teleport / light-speed): instant extra chance.
      const blitzers = L.FWD.filter(c => !ejected.has(c) && c !== shooter && abilOf(c, 'blitz', theme));
      for (const b of blitzers) {
        const ab = abilOf(b, 'blitz', theme);
        if (Math.random() < ab.p * 0.3) {
          stats[side].skills++;
          push({ min, side, t: 'blitz', player: b.name, skill: { icon: ab.icon, name: ab.name, effect: 'blitz' } });
          resolveShot(min, side, b, true);
        }
      }
    }
    // Bookings — tracked per player; second yellow = red = ejection.
    if (Math.random() < 0.02) {
      const side = Math.random() < 0.5 ? 1 : 2;
      const L = side === 1 ? L1 : L2;
      const act = activePlayers(L, ejected);
      if (act.length) {
        const p = act[Math.floor(Math.random() * act.length)];
        const n = (yellows.get(key(p)) || 0) + 1;
        yellows.set(key(p), n);
        if (n >= 2) {
          ejected.add(p);
          stats[side].red++;
          push({ min, side, t: 'rc', player: p.name, secondYellow: true });
        } else {
          stats[side].yellow++;
          push({ min, side, t: 'yc', player: p.name });
        }
      }
    }
    // Rare straight red — the player is ejected and the team plays short.
    if (Math.random() < 0.004) {
      const side = Math.random() < 0.5 ? 1 : 2;
      const L = side === 1 ? L1 : L2;
      const act = [...L.DEF, ...L.MID].filter(c => !ejected.has(c));
      if (act.length) {
        const p = act[Math.floor(Math.random() * act.length)];
        ejected.add(p);
        stats[side].red++;
        push({ min, side, t: 'rc', player: p.name });
      }
    }
  }
  timeline.sort((a, b) => a.min - b.min);
  const names = (L) => ({
    GK: L.GK.map(c => c.name), DEF: L.DEF.map(c => c.name),
    MID: L.MID.map(c => c.name), FWD: L.FWD.map(c => c.name),
  });
  const chances = stats[1].shots + stats[2].shots;
  const poss = (s) => chances ? Math.round((stats[s].shots / chances) * 100) : 50;
  return {
    power1, power2, goals1: scorers1.length, goals2: scorers2.length, scorers1, scorers2, timeline,
    stats: { 1: { ...stats[1], poss: poss(1) }, 2: { ...stats[2], poss: poss(2) } },
    lines: { 1: names(L1), 2: names(L2) },
    ejected: [...ejected].map(c => c.name),
  };
}

function renderScorers(p1Name, p2Name, scorers1, scorers2) {
  document.getElementById('scorersP1Name').textContent = p1Name;
  document.getElementById('scorersP2Name').textContent = p2Name;

  const toListHtml = (counts) => {
    if (counts.size === 0) return '<li class="empty">مفيش أهداف</li>';
    return [...counts.entries()]
      .map(([name, n]) => `<li>${escapeHtml(name)}${n > 1 ? ` × ${n}` : ''}</li>`)
      .join('');
  };

  document.getElementById('scorersP1List').innerHTML = toListHtml(tallyScorers(scorers1));
  document.getElementById('scorersP2List').innerHTML = toListHtml(tallyScorers(scorers2));
}

function renderManOfTheMatch(p1Name, p2Name, squad1, squad2, scorers1, scorers2) {
  const box = document.getElementById('motmBox');
  const allCounts = new Map();
  for (const name of scorers1) allCounts.set(name, (allCounts.get(name) || 0) + 1);
  for (const name of scorers2) allCounts.set(name, (allCounts.get(name) || 0) + 1);

  if (allCounts.size === 0) {
    box.style.display = 'none';
    return;
  }
  box.style.display = '';

  let bestName = null, bestCount = 0;
  for (const [name, n] of allCounts.entries()) {
    if (n > bestCount) { bestName = name; bestCount = n; }
  }
  const all = [...squad1, ...squad2].filter(Boolean);
  const character = all.find(c => c.name === bestName);
  const teamName = squad1.filter(Boolean).some(c => c.name === bestName) ? p1Name : p2Name;

  document.getElementById('motmImg').src = character?.image || '';
  document.getElementById('motmImg').alt = bestName;
  document.getElementById('motmName').textContent = bestName;
  document.getElementById('motmDetail').textContent = `${bestCount} هدف — فريق ${teamName}`;
}

function renderMatchScreen(p1Name, p2Name, result) {
  const { power1, power2, goals1, goals2, scorers1, scorers2 } = result;

  document.getElementById('matchP1Name').textContent = p1Name;
  document.getElementById('matchP2Name').textContent = p2Name;
  document.getElementById('matchP1Power').textContent = `قوة التشكيلة: ${power1}`;
  document.getElementById('matchP2Power').textContent = `قوة التشكيلة: ${power2}`;
  document.getElementById('matchScore').textContent = `${goals1} - ${goals2}`;

  let winnerText;
  if (goals1 > goals2) winnerText = `🏆 ${p1Name} فاز!`;
  else if (goals2 > goals1) winnerText = `🏆 ${p2Name} فاز!`;
  else winnerText = `🤝 تعادل!`;
  document.getElementById('matchWinner').textContent = winnerText;

  renderScorers(p1Name, p2Name, scorers1, scorers2);
  renderTimeline(result.timeline);
  renderAnalysis(result);
  renderLineup(result, p1Name, p2Name);
}

// Arabic skill narration (anime + ML only — football stays icons-only).
// Each skill tells what it did, in words: freeze, teleport, detonate...
function skillArHtml(ev, theme) {
  if (theme === 'football' || !ev.skill) return '';
  const p = escapeHtml(ev.player);
  const s = escapeHtml(ev.skill.name);
  const ic = ev.skill.icon;
  if (ev.t === 'goal' && ev.skill.effect === 'finisher') return `<span class="tl-ar">🚀 ${p} فجّر ${ic} ${s} في الشبكة</span>`;
  if (ev.t === 'goal' && ev.skill.effect === 'clutch') return `<span class="tl-ar">🔥 ${p} حسمها بـ${ic} ${s} في الآخر</span>`;
  if (ev.t === 'cancel') return `<span class="tl-ar">🧊 ${p} جمّد الهجمة بـ${ic} ${s}</span>`;
  if (ev.t === 'blitz') return `<span class="tl-ar">💫 ${p} اختفى بـ${ic} ${s} وظهر ورا الدفاع</span>`;
  if (ev.t === 'star') return `<span class="tl-ar">⭐ ${p} استعرض بـ${ic} ${s}</span>`;
  return '';
}

// One timeline row: minute badge + icon + player + HOW chain
// (dribbled-past names, skill used, rocket shot, keeper/clearance action)
// plus an Arabic skill line for anime/ML.
function evRowHtml(ev) {
  const theme = getGameTheme();
  const bdi = (t) => `<bdi class="tl-player">${escapeHtml(t)}</bdi>`;
  const skill = ev.skill ? `<span class="tl-skill">${ev.skill.icon} ${escapeHtml(ev.skill.name)}</span>` : '';
  const beat = (ev.beat || []).map(n => `<span class="tl-beat">⚡ ${escapeHtml(n)}</span>`).join('');
  const rocket = ev.rocket ? `<span class="tl-rocket">🚀</span>` : '';
  const ar = skillArHtml(ev, theme);
  let body = '';
  if (ev.t === 'goal') {
    body = `<span class="tl-icon">⚽</span>${bdi(ev.player)}${beat}${skill}${rocket}` +
      (ev.keeper ? `<span class="tl-keeper">🧤 ${escapeHtml(ev.keeper)}</span>` : '');
  } else if (ev.t === 'save') {
    body = `<span class="tl-icon">🧤</span>${bdi(ev.player)}<span class="tl-keeper">🥅 ${escapeHtml(ev.shooter)}</span>`;
  } else if (ev.t === 'clear') {
    body = `<span class="tl-icon">🧱</span>${bdi(ev.player)}<span class="tl-keeper">🥅 ${escapeHtml(ev.shooter)}</span>`;
  } else if (ev.t === 'cancel') {
    body = `<span class="tl-icon">${ev.skill.icon}</span>${bdi(ev.player)}${skill}<span class="tl-keeper">🥅 ${escapeHtml(ev.shooter)}</span>`;
  } else if (ev.t === 'yc') {
    body = `<span class="tl-icon">🟨</span>${bdi(ev.player)}`;
  } else if (ev.t === 'rc') {
    body = `<span class="tl-icon">🟥</span>${bdi(ev.player)}${ev.secondYellow ? '<span class="tl-skill">2nd 🟨</span>' : ''}`;
  } else if (ev.t === 'star') {
    body = `<span class="tl-icon">⭐</span>${bdi(ev.player)}${skill}`;
  } else if (ev.t === 'blitz') {
    body = `<span class="tl-icon">💫</span>${bdi(ev.player)}${skill}`;
  } else {
    return '';
  }
  return `<li class="tl-event ${ev.side === 1 ? 'p1' : 'p2'}"><span class="tl-min">${ev.min}'</span>${body}${ar}</li>`;
}

// Key-moments timeline (no-op on pages without #timelineList).
function renderTimeline(timeline) {
  const list = document.getElementById('timelineList');
  if (!list) return;
  if (!timeline || !timeline.length) {
    list.innerHTML = '<li class="empty">مفيش أحداث</li>';
    return;
  }
  list.innerHTML = timeline.map(evRowHtml).join('');
}

// Post-match analysis: stats table + turning points only
// (goals, reds, big saves, cancelled wonder-goals, clearances).
function renderAnalysis(result) {
  const box = document.getElementById('statsTable');
  if (box && result.stats) {
    const s = result.stats;
    const row = (label, k, suffix) => `<div class="stat-row"><span>${s[1][k]}${suffix || ''}</span><b>${label}</b><span>${s[2][k]}${suffix || ''}</span></div>`;
    box.innerHTML =
      row('استحواذ', 'poss', '%') + row('تسديدات', 'shots') + row('على المرمى', 'onTarget') +
      row('تصديات', 'saves') + row('إنقاذ من الخط', 'clearances') + row('مهارات', 'skills') +
      row('🟨', 'yellow') + row('🟥', 'red');
  }
  const km = document.getElementById('keyMoments');
  if (km) {
    const keys = (result.timeline || []).filter(ev =>
      ev.t === 'goal' || ev.t === 'rc' || ev.t === 'clear' || ev.t === 'cancel' || ev.t === 'blitz' || (ev.t === 'save' && ev.big));
    km.innerHTML = keys.length ? keys.map(evRowHtml).join('') : '<li class="empty">مفيش لحظات حاسمة</li>';
  }
}

// OSM-style lineup grouped by fixed lines.
function renderLineup(result, p1Name, p2Name) {
  const grid = document.getElementById('lineupGrid');
  if (!grid || !result.lines) return;
  const order = ['FWD', 'MID', 'DEF', 'GK'];
  grid.innerHTML = [1, 2].map(side => {
    const L = result.lines[side];
    const ejected = new Set(result.ejected || []);
    const rows = order.map(line => {
      const names = (L[line] || []).map(n =>
        `<span class="lu-name${ejected.has(n) ? ' ejected' : ''}">${escapeHtml(n)}${ejected.has(n) ? ' 🟥' : ''}</span>`);
      if (!names.length) return '';
      return `<div class="lu-row"><span class="lu-line">${LINE_META[line].icon} ${LINE_META[line].label}</span><span class="lu-names">${names.join('، ')}</span></div>`;
    }).join('');
    return `<div class="lu-team"><h5 class="${side === 1 ? 'p1' : 'p2'}">${escapeHtml(side === 1 ? p1Name : p2Name)}</h5>${rows}</div>`;
  }).join('');
}

const HISTORY_STORAGE_KEY = 'animeGamesHistory';

function getHistoryRecords() {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function postHistory(record) {
  try {
    record.date = new Date().toISOString();
    const list = getHistoryRecords();
    list.unshift(record);
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(list.slice(0, 200)));
  } catch (e) {
    console.warn('could not save history', e);
  }
}
