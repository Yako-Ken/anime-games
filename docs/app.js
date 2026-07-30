const screens = {
  setup: document.getElementById('screen-setup'),
  loading: document.getElementById('screen-loading'),
  draft: document.getElementById('screen-draft'),
  match: document.getElementById('screen-match'),
  history: document.getElementById('screen-history'),
};

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
}

document.getElementById('navPlay').onclick = () => {
  setNav('navPlay');
  showScreen(state.pool ? (state.matchDone ? 'match' : 'draft') : 'setup');
};
document.getElementById('navHistory').onclick = () => {
  setNav('navHistory');
  loadHistory();
  showScreen('history');
};
function setNav(id) {
  document.querySelectorAll('.navbtn').forEach(b => b.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

const state = {
  players: [
    { name: 'اللاعب 1', budget: 200, startBudget: 200, squad: [] },
    { name: 'اللاعب 2', budget: 200, startBudget: 200, squad: [] },
  ],
  squadSize: 11,
  pool: null,
  matchDone: false,
  // auction state — each round reveals a pair of characters: pool[round*2] goes up
  // for auction, pool[round*2+1] is a free consolation for whoever loses that bid.
  round: 0,
  opener: 0,        // which player opens bidding for the current round
  currentBid: 0,
  currentBidder: null, // 0 | 1 | null
  turnToAct: 0,
};

document.getElementById('startBtn').onclick = startDraft;

async function startDraft() {
  const p1 = document.getElementById('p1Name').value.trim() || 'اللاعب 1';
  const p2 = document.getElementById('p2Name').value.trim() || 'اللاعب 2';
  const squadSize = Math.min(15, Math.max(3, parseInt(document.getElementById('squadSize').value, 10) || 11));
  const budget = Math.min(1000, Math.max(10, parseInt(document.getElementById('budget').value, 10) || 200));

  state.players = [
    { name: p1, budget, startBudget: budget, squad: [] },
    { name: p2, budget, startBudget: budget, squad: [] },
  ];
  state.squadSize = squadSize;
  state.matchDone = false;
  state.round = 0;
  state.opener = 0;
  state.currentBid = 0;
  state.currentBidder = null;
  state.turnToAct = 0;

  showScreen('loading');
  const total = squadSize * 2; // one auctioned + one free character per round
  const progressBar = document.getElementById('progressBar');
  const loadingText = document.getElementById('loadingText');
  progressBar.style.width = '5%';
  loadingText.textContent = `جاري تحميل ${total} شخصية عشوائية من MyAnimeList...`;

  // fake incremental progress while the (rate-limited) fetch runs
  let fakePct = 5;
  const tick = setInterval(() => {
    fakePct = Math.min(92, fakePct + 2);
    progressBar.style.width = fakePct + '%';
  }, 400);

  try {
    state.pool = await getRandomPricedPool(total);
    clearInterval(tick);
    progressBar.style.width = '100%';
    setTimeout(() => {
      document.getElementById('p1NameLabel').textContent = state.players[0].name;
      document.getElementById('p2NameLabel').textContent = state.players[1].name;
      showScreen('draft');
      startRound();
    }, 300);
  } catch (e) {
    clearInterval(tick);
    loadingText.textContent = poolLoadErrorMessage(e);
  }
}

function updatePanels() {
  document.getElementById('p1Budget').textContent = state.players[0].budget;
  document.getElementById('p2Budget').textContent = state.players[1].budget;

  document.getElementById('p1Squad').innerHTML = squadHtml(state.players[0]);
  document.getElementById('p2Squad').innerHTML = squadHtml(state.players[1]);

  const emptySlots1 = state.squadSize - state.players[0].squad.length;
  const emptySlots2 = state.squadSize - state.players[1].squad.length;
  document.getElementById('p1Squad').innerHTML += emptySlotHtml(emptySlots1);
  document.getElementById('p2Squad').innerHTML += emptySlotHtml(emptySlots2);

  document.getElementById('panelP1').classList.toggle('active-turn', state.turnToAct === 0);
  document.getElementById('panelP2').classList.toggle('active-turn', state.turnToAct === 1);
  document.getElementById('turnLabel').textContent = `تم حسم ${state.players[0].squad.length + state.players[1].squad.length} من ${state.squadSize * 2}`;
}

// ---- Auction flow ----

function pickEligibleStarter() {
  const order = [state.opener, 1 - state.opener];
  for (const idx of order) {
    const p = state.players[idx];
    if (p.squad.length < state.squadSize && p.budget >= 1) return idx;
  }
  return null;
}

function currentPair() {
  return {
    auctionChar: state.pool[state.round * 2],
    bonusChar: state.pool[state.round * 2 + 1],
  };
}

function startRound() {
  if (state.round >= state.squadSize) {
    updatePanels();
    setTimeout(runMatch, 400);
    return;
  }

  const starter = pickEligibleStarter();
  if (starter === null) {
    // both players broke or full — extremely rare edge case (e.g. budget spent too
    // fast). Hand both this round's characters out for free so squads stay in sync.
    const { auctionChar, bonusChar } = currentPair();
    state.players[0].squad.push({ ...auctionChar, price: 0 });
    state.players[1].squad.push({ ...bonusChar, price: 0 });
    state.round++;
    state.opener = 1 - state.opener;
    startRound();
    return;
  }

  state.currentBid = 0;
  state.currentBidder = null;
  state.turnToAct = starter;
  autoResolveOrRender();
}

function autoResolveOrRender() {
  const p = state.players[state.turnToAct];
  const cannotRespond = state.currentBidder !== null && p.budget < state.currentBid + 1;
  if (cannotRespond) {
    resolvePass();
    return;
  }
  renderAuction();
}

function renderAuction() {
  const { auctionChar, bonusChar } = currentPair();
  updatePanels();

  document.getElementById('auctionCounter').textContent =
    `جولة ${state.round + 1} من ${state.squadSize} — الشخصية اللي هتخسر المزاد هتاخد "${bonusChar.name}" ببلاش`;
  document.getElementById('auctionImg').src = auctionChar.image;
  document.getElementById('auctionImg').alt = auctionChar.name;
  document.getElementById('auctionName').textContent = auctionChar.name;

  const bidLabel = document.getElementById('bidAmountLabel');
  bidLabel.textContent = state.currentBid === 0 ? 'لسه محدش زايد' : `${state.currentBid} M`;

  const leaderLabel = document.getElementById('bidLeaderLabel');
  leaderLabel.className = 'bid-leader';
  if (state.currentBidder !== null) {
    const leader = state.players[state.currentBidder];
    leaderLabel.textContent = `أعلى عرض: ${leader.name}`;
    leaderLabel.classList.add(state.currentBidder === 0 ? 'p1' : 'p2');
  } else {
    leaderLabel.textContent = '';
  }

  const turnLabel = document.getElementById('bidTurnLabel');
  const actor = state.players[state.turnToAct];
  turnLabel.className = 'bid-turn';
  turnLabel.classList.add(state.turnToAct === 0 ? 'p1' : 'p2');
  turnLabel.textContent = state.currentBidder === null
    ? `دور: ${actor.name} — افتتح المزايدة (لازم تعرض على الأقل 1M)`
    : `دور: ${actor.name} — زايد أو انسحب`;

  document.querySelectorAll('.bid-btn[data-inc]').forEach(btn => {
    const inc = parseInt(btn.dataset.inc, 10);
    btn.disabled = actor.budget < state.currentBid + inc;
  });

  const customInput = document.getElementById('customBidInput');
  customInput.value = '';
  customInput.max = actor.budget;

  // opening bid is mandatory — passing is only allowed once there's a bid to concede
  const passBtn = document.getElementById('passBtn');
  passBtn.disabled = state.currentBidder === null;
  passBtn.textContent = state.currentBidder === null
    ? '🚫 لازم تفتح المزايدة الأول'
    : `🚫 انسحب — هتاخد "${bonusChar.name}" ببلاش`;
}

function raiseBid(newBidTotal) {
  const actor = state.players[state.turnToAct];
  if (!(newBidTotal > state.currentBid && newBidTotal <= actor.budget)) return;
  state.currentBid = newBidTotal;
  state.currentBidder = state.turnToAct;
  state.turnToAct = 1 - state.turnToAct;
  autoResolveOrRender();
}

function resolvePass() {
  // passing is only legal once someone has already bid (see renderAuction)
  const { auctionChar, bonusChar } = currentPair();
  const winner = state.players[state.currentBidder];
  const loser = state.players[1 - state.currentBidder];
  winner.squad.push({ ...auctionChar, price: state.currentBid });
  winner.budget -= state.currentBid;
  loser.squad.push({ ...bonusChar, price: 0 });

  state.round++;
  state.opener = 1 - state.opener;
  startRound();
}

document.querySelectorAll('.bid-btn[data-inc]').forEach(btn => {
  btn.onclick = () => raiseBid(state.currentBid + parseInt(btn.dataset.inc, 10));
});
document.getElementById('customBidBtn').onclick = () => {
  const val = parseInt(document.getElementById('customBidInput').value, 10);
  if (!isNaN(val) && val > 0) raiseBid(val);
};
document.getElementById('passBtn').onclick = () => resolvePass();

function squadHtml(player) {
  return player.squad.map(c => {
    const priceLabel = c.price === 0 ? '🎁 ببلاش' : `${c.price}M`;
    return `
    <div class="squad-slot" title="${escapeHtml(c.name)} — ${priceLabel}">
      <img src="${c.image}" alt="${escapeHtml(c.name)}">
      <div class="slot-name">${escapeHtml(c.name)} · ${priceLabel}</div>
    </div>`;
  }).join('');
}

function emptySlotHtml(n) {
  let out = '';
  for (let i = 0; i < n; i++) out += `<div class="squad-slot"></div>`;
  return out;
}

function runMatch() {
  const p1 = state.players[0];
  const p2 = state.players[1];
  const result = simulateMatch(p1.squad, p2.squad);

  renderMatchScreen(p1.name, p2.name, result);
  renderManOfTheMatch(p1.name, p2.name, p1.squad, p2.squad, result.scorers1, result.scorers2);

  state.matchDone = true;
  showScreen('match');

  saveHistory(p1, p2, result);
}

async function saveHistory(p1, p2, result) {
  const record = {
    mode: 'draft',
    players: [
      { name: p1.name, budgetLeft: p1.budget, power: result.power1, squad: p1.squad.map(c => ({ name: c.name, price: c.price, image: c.image })) },
      { name: p2.name, budgetLeft: p2.budget, power: result.power2, squad: p2.squad.map(c => ({ name: c.name, price: c.price, image: c.image })) },
    ],
    score: { p1: result.goals1, p2: result.goals2 },
    scorers: { p1: result.scorers1, p2: result.scorers2 },
  };
  await postHistory(record);
}

document.getElementById('newGameBtn').onclick = () => {
  state.pool = null;
  state.matchDone = false;
  setNav('navPlay');
  showScreen('setup');
};

async function loadHistory() {
  const list = document.getElementById('historyList');
  list.innerHTML = 'جاري التحميل...';
  try {
    const data = getHistoryRecords();
    if (!data.length) {
      list.innerHTML = '<p>مفيش مباريات متسجلة لسه.</p>';
      return;
    }
    list.innerHTML = data.map(rec => {
      const scorersLine = (name, scorers) => {
        if (!scorers || !scorers.length) return `<strong>${escapeHtml(name)}:</strong> مفيش أهداف`;
        const counts = tallyScorers(scorers);
        const parts = [...counts.entries()].map(([n, c]) => `${escapeHtml(n)}${c > 1 ? ` ×${c}` : ''}`);
        return `<strong>⚽ ${escapeHtml(name)}:</strong> ${parts.join('، ')}`;
      };
      const modeIcon = rec.mode === 'dealnodeal' ? '🎁' : rec.mode === 'packs' ? '📦' : '⚔️';
      return `
      <div class="hist-item">
        <div class="hist-header">
          <span>${modeIcon} ${escapeHtml(rec.players[0].name)} ${rec.score.p1} - ${rec.score.p2} ${escapeHtml(rec.players[1].name)}</span>
          <span class="hist-date">${new Date(rec.date).toLocaleString('ar-EG')}</span>
        </div>
        <div class="hist-squads">
          <div><strong>${escapeHtml(rec.players[0].name)}:</strong> ${rec.players[0].squad.map(c => c ? escapeHtml(c.name) : 'فاضي').join('، ')}</div>
          <div><strong>${escapeHtml(rec.players[1].name)}:</strong> ${rec.players[1].squad.map(c => c ? escapeHtml(c.name) : 'فاضي').join('، ')}</div>
        </div>
        ${rec.scorers ? `
        <div class="hist-squads">
          <div>${scorersLine(rec.players[0].name, rec.scorers.p1)}</div>
          <div>${scorersLine(rec.players[1].name, rec.scorers.p2)}</div>
        </div>` : ''}
      </div>
    `;
    }).join('');
  } catch (e) {
    list.innerHTML = 'تعذر تحميل السجل.';
  }
}

if (new URLSearchParams(location.search).get('tab') === 'history') {
  setNav('navHistory');
  loadHistory();
  showScreen('history');
}
