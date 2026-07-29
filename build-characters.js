// One-time build script: fetches every qualifying character (favorites >= 300)
// across our curated 40-anime list from Jikan and bakes them into a static
// JSON file the frontend can load directly — no runtime API/server needed.
const fs = require('fs');
const path = require('path');

const JIKAN_BASE = 'https://api.jikan.moe/v4';

const ANIME_TITLES = {
  20: 'Naruto', 1735: 'Naruto: Shippuden', 21: 'One Piece', 223: 'Dragon Ball',
  813: 'Dragon Ball Z', 16498: 'Attack on Titan', 31964: 'My Hero Academia',
  38000: 'Demon Slayer', 40748: 'Jujutsu Kaisen', 269: 'Bleach', 1535: 'Death Note',
  5114: 'Fullmetal Alchemist: Brotherhood', 11061: 'Hunter x Hunter', 30276: 'One Punch Man',
  22319: 'Tokyo Ghoul', 11757: 'Sword Art Online', 6702: 'Fairy Tail', 1575: 'Code Geass',
  44511: 'Chainsaw Man', 50265: 'Spy x Family', 20583: 'Haikyuu!!', 32182: 'Mob Psycho 100',
  9253: 'Steins;Gate', 37521: 'Vinland Saga', 34572: 'Black Clover', 31240: 'Re:Zero',
  38691: 'Dr. Stone', 14719: "JoJo's Bizarre Adventure", 30012: 'Overlord',
  24833: 'Assassination Classroom', 1: 'Cowboy Bebop', 30: 'Neon Genesis Evangelion',
  10087: 'Fate/Zero', 37779: 'The Promised Neverland', 34599: 'Made in Abyss',
  33352: 'Violet Evergarden', 31043: 'Erased', 4224: 'Toradora!', 23273: 'Your Lie in April',
  22535: 'Parasyte -the maxim-',
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchAnimeCharacters(animeId, attempt = 0) {
  const res = await fetch(`${JIKAN_BASE}/anime/${animeId}/characters`);
  if (res.status === 429 || res.status === 504) {
    if (attempt >= 3) return [];
    await sleep(1000);
    return fetchAnimeCharacters(animeId, attempt + 1);
  }
  if (!res.ok) return [];
  const json = await res.json();
  return (json.data || [])
    .filter(entry => (entry.favorites || 0) >= 300 && entry.character?.mal_id && entry.character?.name)
    .map(entry => ({
      mal_id: entry.character.mal_id,
      name: entry.character.name.trim(),
      image: entry.character.images?.jpg?.image_url || entry.character.images?.webp?.image_url || '',
      favorites: entry.favorites || 0,
      anime: ANIME_TITLES[animeId] || 'Unknown',
    }))
    .filter(c => c.image);
}

(async () => {
  const seen = new Set();
  const all = [];
  const ids = Object.keys(ANIME_TITLES).map(Number);
  for (const id of ids) {
    process.stdout.write(`Fetching ${ANIME_TITLES[id]}... `);
    const chars = await fetchAnimeCharacters(id);
    let added = 0;
    for (const c of chars) {
      if (seen.has(c.mal_id)) continue;
      seen.add(c.mal_id);
      all.push(c);
      added++;
    }
    console.log(`${added} new (total ${all.length})`);
    await sleep(500);
  }
  const outPath = path.join(__dirname, 'public', 'characters.json');
  fs.writeFileSync(outPath, JSON.stringify(all), 'utf8');
  console.log(`\nDone. Wrote ${all.length} characters to ${outPath}`);
})();
