const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 4477;
const HISTORY_FILE = path.join(__dirname, 'data', 'history.json');
const JIKAN_BASE = 'https://api.jikan.moe/v4';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function readHistory() {
  try {
    return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function writeHistory(list) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(list, null, 2), 'utf8');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Main characters of famous anime almost all have high raw favorite counts, so a
// flat formula bunches everyone at the price cap. Instead, price by rank within
// the sampled pool itself: most-favorited character lands near 150M, least near
// 1M, with a curve (not linear) so a handful of "superstars" stand out — same
// shape as the football show's price spread.
function assignPricesByRank(characters) {
  const sorted = [...characters].sort((a, b) => b.favorites - a.favorites);
  const n = sorted.length;
  return sorted.map((c, i) => {
    const percentile = n <= 1 ? 0 : i / (n - 1); // 0 = most favorited, 1 = least
    const curved = Math.pow(1 - percentile, 2.2);
    const jitter = Math.floor(Math.random() * 7) - 3;
    const price = Math.round(curved * 149) + 1 + jitter;
    return { ...c, price: Math.min(150, Math.max(1, price)) };
  });
}

// Jikan's /random and list endpoints proxy to MyAnimeList directly and frequently
// 504 under load. Per-anime character lookups are far more reliable, so we pull
// from a curated pool of only very well-known, mainstream anime — and below we
// keep only characters tagged role:"Main" so filler/background names never show up.
const ANIME_TITLES = {
  20: 'Naruto',
  1735: 'Naruto: Shippuden',
  21: 'One Piece',
  223: 'Dragon Ball',
  813: 'Dragon Ball Z',
  16498: 'Attack on Titan',
  31964: 'My Hero Academia',
  38000: 'Demon Slayer',
  40748: 'Jujutsu Kaisen',
  269: 'Bleach',
  1535: 'Death Note',
  5114: 'Fullmetal Alchemist: Brotherhood',
  11061: 'Hunter x Hunter',
  30276: 'One Punch Man',
  22319: 'Tokyo Ghoul',
  11757: 'Sword Art Online',
  6702: 'Fairy Tail',
  1575: 'Code Geass',
  44511: 'Chainsaw Man',
  50265: 'Spy x Family',
  20583: 'Haikyuu!!',
  32182: 'Mob Psycho 100',
  9253: 'Steins;Gate',
  37521: 'Vinland Saga',
  34572: 'Black Clover',
  31240: 'Re:Zero',
  38691: 'Dr. Stone',
  14719: "JoJo's Bizarre Adventure",
  30012: 'Overlord',
  24833: 'Assassination Classroom',
  1: 'Cowboy Bebop',
  30: 'Neon Genesis Evangelion',
  10087: 'Fate/Zero',
  37779: 'The Promised Neverland',
  34599: 'Made in Abyss',
  33352: 'Violet Evergarden',
  31043: 'Erased',
  4224: 'Toradora!',
  23273: 'Your Lie in April',
  22535: 'Parasyte -the maxim-',
}; // exactly 40 well-known, mainstream anime
const ANIME_IDS = Object.keys(ANIME_TITLES).map(Number);

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Cache each anime's character list in memory — Jikan/MAL is a free, rate-limited,
// occasionally-flaky public API, so re-fetching the same 40 series on every single
// game start is what was making the loading screen take 60-90+ seconds. Once an
// anime is cached, every future game reuses it instantly until it expires.
const characterCache = new Map(); // animeId -> { data, expiresAt }
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour — character rosters never change anyway

async function fetchAnimeCharacters(animeId, attempt = 0) {
  const cached = characterCache.get(animeId);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const res = await fetch(`${JIKAN_BASE}/anime/${animeId}/characters`);
  if (res.status === 429 || res.status === 504) {
    if (attempt >= 1) return []; // skip fast and move to the next anime instead of retrying slowly
    await sleep(400);
    return fetchAnimeCharacters(animeId, attempt + 1);
  }
  if (!res.ok) return [];
  const json = await res.json();
  // MAL's "Main" role tag is very strict — e.g. Naruto's anime entry only tags 4
  // characters as Main, starving the whole pool to ~56 characters across all 40
  // anime (hence the heavy repetition). A favorites threshold instead pulls in
  // every character players would actually recognize (Itachi, Gaara, Shikamaru,
  // etc. are all "Supporting" by MAL's tagging) while still excluding true filler.
  const data = (json.data || [])
    .filter(entry => (entry.favorites || 0) >= 300 && entry.character?.mal_id && entry.character?.name)
    .map(entry => ({
      mal_id: entry.character.mal_id,
      name: entry.character.name.trim(),
      image: entry.character.images?.jpg?.image_url || entry.character.images?.webp?.image_url || '',
      favorites: entry.favorites || 0,
      anime: ANIME_TITLES[animeId] || 'Unknown',
    }))
    .filter(c => c.image); // an anime character card with no picture is useless in the auction

  characterCache.set(animeId, { data, expiresAt: Date.now() + CACHE_TTL_MS });
  return data;
}

// Warm the cache on boot so the first game doesn't pay the full cold-start cost.
(async () => {
  for (const animeId of ANIME_IDS) {
    await fetchAnimeCharacters(animeId);
    await sleep(350);
  }
  console.log(`[warmup] cached characters for ${characterCache.size}/${ANIME_IDS.length} anime`);
})();

app.get('/api/pool', async (req, res) => {
  const count = Math.min(180, Math.max(2, parseInt(req.query.count, 10) || 22));
  const seen = new Set();
  const collected = [];
  // Try every already-cached anime first (near-instant) before falling back to
  // live fetches, so a request only pays network latency when it truly has to.
  const cached = ANIME_IDS.filter(id => characterCache.has(id));
  const uncached = ANIME_IDS.filter(id => !characterCache.has(id));
  const orderedAnime = [...shuffle(cached), ...shuffle(uncached)];

  try {
    for (const animeId of orderedAnime) {
      if (collected.length >= count * 1.5) break; // gather a modest surplus, then sample
      const cachedAlready = characterCache.has(animeId);
      const chars = await fetchAnimeCharacters(animeId);
      for (const c of chars) {
        if (!c.image || seen.has(c.mal_id)) continue;
        seen.add(c.mal_id);
        collected.push(c);
      }
      if (!cachedAlready) await sleep(350); // only throttle when we actually hit the network
    }

    if (collected.length < count) {
      return res.status(502).json({ error: 'Not enough characters returned from Jikan API', detail: `got ${collected.length}, need ${count}` });
    }

    const sample = shuffle(collected).slice(0, count);
    const pool = shuffle(assignPricesByRank(sample));
    res.json({ pool });
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch characters from Jikan API', detail: String(err) });
  }
});

app.get('/api/history', (req, res) => {
  res.json(readHistory());
});

app.post('/api/history', (req, res) => {
  const record = req.body;
  if (!record || !record.players || !record.score) {
    return res.status(400).json({ error: 'invalid record' });
  }
  record.date = new Date().toISOString();
  const list = readHistory();
  list.unshift(record);
  writeHistory(list.slice(0, 200));
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Anime Draft Game running at http://localhost:${PORT}`);
});
