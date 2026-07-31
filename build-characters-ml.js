// One-time build script: pulls Mobile Legends: Bang Bang hero data (name +
// official portrait image) from the p3hndrx/MLBB-API community dataset and
// bakes it into docs/characters-ml.json in the same schema as characters.json
// so the frontend can load it identically regardless of theme.
const fs = require('fs');
const path = require('path');

const SOURCE_URL = 'https://raw.githubusercontent.com/p3hndrx/MLBB-API/main/v1/hero-meta-final.json';

// No real "favorites/popularity" metric exists in this dataset, so we assign a
// stable pseudo-random value per hero (seeded by name) purely so the existing
// pricing curve / twist system has some spread to work with — re-running this
// script produces the same numbers every time.
function seededRandom(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return () => {
    h = (h * 1664525 + 1013904223) >>> 0;
    return h / 4294967296;
  };
}

(async () => {
  const res = await fetch(SOURCE_URL);
  if (!res.ok) throw new Error('Failed to fetch MLBB hero data: ' + res.status);
  const json = await res.json();

  const seen = new Set();
  const out = [];
  for (const h of json.data || []) {
    if (!h.hero_name || h.hero_name === 'None' || !h.portrait) continue;
    if (seen.has(h.hero_name)) continue;
    seen.add(h.hero_name);
    const rand = seededRandom(h.hero_name);
    out.push({
      mal_id: parseInt(h.mlid, 10) || (10000 + out.length),
      name: h.hero_name,
      image: h.portrait,
      favorites: Math.round(300 + rand() * 60000),
      anime: 'Mobile Legends',
    });
  }

  const outPath = path.join(__dirname, 'docs', 'characters-ml.json');
  fs.writeFileSync(outPath, JSON.stringify(out), 'utf8');
  console.log(`Wrote ${out.length} Mobile Legends heroes to ${outPath}`);
})();
