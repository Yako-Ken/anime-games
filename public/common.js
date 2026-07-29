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

function tallyScorers(names) {
  const counts = new Map();
  for (const name of names) counts.set(name, (counts.get(name) || 0) + 1);
  return counts;
}

// squad may contain null entries (deal-or-no-deal: a category can end up empty)
// and entries may or may not carry a `price` (only the draft game has one).
function teamPower(squad) {
  const present = squad.filter(Boolean);
  const priceSum = present.reduce((s, c) => s + (c.price || 0), 0);
  const favSum = present.reduce((s, c) => s + Math.sqrt(c.favorites || 0), 0);
  return Math.round(priceSum + favSum * 0.5) + 30; // +30 baseline so weak teams can still score
}

// stronger (pricier / more-favorited) characters are more likely to score
function weightedPickScorer(squad) {
  const present = squad.filter(Boolean);
  if (present.length === 0) return null;
  const weights = present.map(c => Math.max(1, (c.price || 0) + Math.sqrt(c.favorites || 0)));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < present.length; i++) {
    r -= weights[i];
    if (r <= 0) return present[i];
  }
  return present[present.length - 1];
}

function simulateMatch(squad1, squad2) {
  const power1 = teamPower(squad1);
  const power2 = teamPower(squad2);
  const scorers1 = [];
  const scorers2 = [];
  const rounds = 6;
  for (let i = 0; i < rounds; i++) {
    if (Math.random() < 0.35) continue; // ~35% chance this round produces no goal
    const r = Math.random() * (power1 + power2);
    const scorer = r < power1 ? weightedPickScorer(squad1) : weightedPickScorer(squad2);
    if (!scorer) continue; // empty squad — nobody to credit the goal to
    if (r < power1) scorers1.push(scorer.name);
    else scorers2.push(scorer.name);
  }
  return { power1, power2, goals1: scorers1.length, goals2: scorers2.length, scorers1, scorers2 };
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
}

async function postHistory(record) {
  try {
    await fetch('/api/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
    });
  } catch (e) {
    console.warn('could not save history', e);
  }
}
