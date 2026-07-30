const screens = {
  setup: document.getElementById('screen-setup'),
  loading: document.getElementById('screen-loading'),
  game: document.getElementById('screen-game'),
  match: document.getElementById('screen-match'),
};

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
}

const CATEGORIES = [
  { key: 'GK', label: 'الحارس' },
  { key: 'DEF', label: 'المدافع' },
  { key: 'MID', label: 'لاعب الوسط' },
  { key: 'FWD', label: 'المهاجم' },
  { key: 'HC', label: 'المدرب' },
];

const CARD_INFO = {
  protect: { icon: '🛡️', label: 'كارت الحماية', desc: 'هتستخدمه بعد ما كل الاختيارات تخلص — تختار شخصية عندك تحميها للأبد من كارت السرقة.' },
  steal: { icon: '🕵️', label: 'كارت السرقة', desc: 'هتستخدمه بعد ما كل الاختيارات تخلص — تختار فئة تتبادل فيها شخصيتك مع شخصية خصمك (لو مش محمية).' },
  dress: { icon: '👕', label: 'كارت لبس صحبك', desc: 'في الفئة الجاية، إنت اللي هتختار لخصمك بدل ما يختار بنفسه.' },
};

const state = {
  players: [
    { name: 'اللاعب 1', squad: {}, protected: new Set() },
    { name: 'اللاعب 2', squad: {}, protected: new Set() },
  ],
  boxSets: [null, null], // [player0, player1] each: { GK:[4 slots], DEF:[...], ... }
  catIndex: 0,
  order: [0, 1],
  turnPos: 0,
  attempt: 1,
  pendingDress: null,     // { byPlayer, targetPlayer } — dress-up still resolves immediately (affects the NEXT category)
  bankedCards: [],        // { type: 'protect'|'steal', byPlayer } — resolved after all categories are done
  resolutionQueue: [],
  resolutionIndex: 0,
  matchDone: false,
};

function categoryLabel(key) {
  return CATEGORIES.find(c => c.key === key)?.label || key;
}

document.getElementById('startBtn').onclick = startGame;

async function startGame() {
  const p1 = document.getElementById('p1Name').value.trim() || 'اللاعب 1';
  const p2 = document.getElementById('p2Name').value.trim() || 'اللاعب 2';

  state.players = [
    { name: p1, squad: {}, protected: new Set() },
    { name: p2, squad: {}, protected: new Set() },
  ];
  state.catIndex = 0;
  state.order = [0, 1];
  state.turnPos = 0;
  state.attempt = 1;
  state.pendingDress = null;
  state.bankedCards = [];
  state.resolutionQueue = [];
  state.resolutionIndex = 0;
  state.matchDone = false;

  showScreen('loading');
  const progressBar = document.getElementById('progressBar');
  const loadingText = document.getElementById('loadingText');
  progressBar.style.width = '5%';
  loadingText.textContent = 'جاري تحميل 40 شخصية عشوائية من MyAnimeList...';

  let fakePct = 5;
  const tick = setInterval(() => {
    fakePct = Math.min(92, fakePct + 2);
    progressBar.style.width = fakePct + '%';
  }, 400);

  try {
    const pool = await getRandomPricedPool(40);
    clearInterval(tick);
    buildBoxSets(pool);
    progressBar.style.width = '100%';
    setTimeout(() => {
      showScreen('game');
      startCategory();
    }, 300);
  } catch (e) {
    clearInterval(tick);
    loadingText.textContent = poolLoadErrorMessage(e);
  }
}

function buildBoxSets(poolFlat) {
  const pool = shuffle([...poolFlat]);

  // Bank-offer cards are optional per game, and each of the 3 card types can
  // appear at most once in the whole game (a rare, one-off twist each).
  const bankOffersEnabled = Math.random() < 0.6;
  const specialSlots = new Map(); // key `${player}-${cat}-${box}` -> cardType
  if (bankOffersEnabled) {
    const types = shuffle(['protect', 'steal', 'dress']);
    const numCards = 1 + Math.floor(Math.random() * 3); // 1-3
    const chosen = types.slice(0, numCards);
    const used = new Set();
    for (const cardType of chosen) {
      let key;
      do {
        const player = Math.floor(Math.random() * 2);
        const cat = CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)].key;
        const box = Math.floor(Math.random() * 4);
        key = `${player}-${cat}-${box}`;
      } while (used.has(key));
      used.add(key);
      specialSlots.set(key, cardType);
    }
  }

  let cursor = 0;
  for (let player = 0; player < 2; player++) {
    state.boxSets[player] = {};
    for (const cat of CATEGORIES) {
      const slots = [];
      for (let box = 0; box < 4; box++) {
        const character = pool[cursor++];
        const special = specialSlots.get(`${player}-${cat.key}-${box}`) || null;
        slots.push({ character, special, opened: false });
      }
      state.boxSets[player][cat.key] = slots;
    }
  }
}

function showCardBanner(text) {
  const el = document.getElementById('cardBanner');
  el.textContent = text;
  setTimeout(() => { if (el.textContent === text) el.textContent = ''; }, 4000);
}

function renderSquads() {
  document.getElementById('dealName0').textContent = state.players[0].name;
  document.getElementById('dealName1').textContent = state.players[1].name;

  for (let p = 0; p < 2; p++) {
    const container = document.getElementById(`dealSquad${p}`);
    container.innerHTML = CATEGORIES.map(cat => {
      const entry = state.players[p].squad[cat.key];
      const isProtected = state.players[p].protected.has(cat.key);
      if (!entry) {
        return `<div class="deal-squad-row empty"><span class="cat-label">${cat.label}</span> لسه مفتوحش</div>`;
      }
      return `<div class="deal-squad-row">
        <span class="cat-label">${cat.label}</span>
        <img src="${entry.image}" alt="${escapeHtml(entry.name)}">
        <span>${escapeHtml(entry.name)}</span>
        ${isProtected ? '<span class="protected-badge">🛡️</span>' : ''}
      </div>`;
    }).join('');

    document.getElementById(`dealPanel${p}`).classList.toggle('active-turn', state.order[state.turnPos] === p && !state.matchDone);
  }

  if (state.catIndex < CATEGORIES.length) {
    document.getElementById('categoryProgress').textContent =
      `الفئة ${state.catIndex + 1} من ${CATEGORIES.length}: ${CATEGORIES[state.catIndex].label}`;
  }
}

function startCategory() {
  state.attempt = 1;
  state.turnPos = 0;
  renderSquads();
  startPlayerTurn();
}

function startPlayerTurn() {
  const actingPlayer = state.order[state.turnPos];
  renderSquads();

  if (state.pendingDress && state.pendingDress.targetPlayer === actingPlayer) {
    runForcedPick(actingPlayer);
    return;
  }

  state.attempt = 1;
  renderBoxGrid(actingPlayer);
}

function renderBoxGrid(player) {
  const catKey = CATEGORIES[state.catIndex].key;
  const slots = state.boxSets[player][catKey];
  const stage = document.getElementById('dealStage');
  const pClass = player === 0 ? 'p1' : 'p2';

  stage.innerHTML = `
    <div class="stage-title ${pClass}">دور ${escapeHtml(state.players[player].name)} — يفتح صندوق في فئة ${categoryLabel(catKey)}${state.attempt === 2 ? ' (المحاولة الأخيرة)' : ''}</div>
    <div class="box-grid">
      ${slots.map((s, i) => `<button class="box-btn" data-idx="${i}" ${s.opened ? 'disabled' : ''}>${s.opened ? '✔️' : i + 1}</button>`).join('')}
    </div>
  `;

  stage.querySelectorAll('.box-btn:not([disabled])').forEach(btn => {
    btn.onclick = () => revealBox(player, parseInt(btn.dataset.idx, 10));
  });
}

function revealBox(player, boxIdx) {
  const catKey = CATEGORIES[state.catIndex].key;
  const slot = state.boxSets[player][catKey][boxIdx];
  if (slot.opened) return;
  slot.opened = true;

  if (slot.special) {
    renderBankOfferPanel(player, slot);
  } else {
    renderCharacterPanel(player, slot);
  }
}

function renderCharacterPanel(player, slot) {
  const stage = document.getElementById('dealStage');
  const canReject = state.attempt === 1;
  stage.innerHTML = `
    <div class="reveal-panel">
      <img class="reveal-img" src="${slot.character.image}" alt="${escapeHtml(slot.character.name)}">
      <div class="reveal-name">${escapeHtml(slot.character.name)}</div>
      <div class="reveal-actions">
        <button class="reveal-btn accept" id="acceptBtn">✅ أخد الشخصية دي</button>
        ${canReject ? '<button class="reveal-btn reject" id="rejectBtn">🔄 لأ، هفتح صندوق تاني</button>' : ''}
      </div>
    </div>
  `;
  document.getElementById('acceptBtn').onclick = () => acceptCharacter(player, slot);
  if (canReject) document.getElementById('rejectBtn').onclick = () => rejectBox(player);
}

function acceptCharacter(player, slot) {
  const catKey = CATEGORIES[state.catIndex].key;
  state.players[player].squad[catKey] = { name: slot.character.name, image: slot.character.image, favorites: slot.character.favorites };
  showBoxRecap(player, catKey, slot, finishTurn);
}

// For fun: after a pick is locked in, reveal what every box in that set actually
// held, highlighting the one taken. `chosenSlot` is null for the rare "declined
// the final bank offer" case where nothing was taken.
function showBoxRecap(player, catKey, chosenSlot, onContinue) {
  const slots = state.boxSets[player][catKey];
  const stage = document.getElementById('dealStage');
  stage.innerHTML = `
    <div class="reveal-panel">
      <div class="reveal-name">🔎 كل الصناديق كان فيها إيه:</div>
      <div class="recap-grid">
        ${slots.map(s => `
          <div class="recap-item ${s === chosenSlot ? 'chosen' : ''}">
            <img src="${s.character.image}" alt="${escapeHtml(s.character.name)}">
            <div class="recap-name">${escapeHtml(s.character.name)}</div>
            ${s.special ? '<div class="recap-tag">🎁 عرض بنك</div>' : ''}
            ${s === chosenSlot ? '<div class="recap-check">✔️ ده اللي اخدته</div>' : ''}
          </div>
        `).join('')}
      </div>
      <button class="reveal-btn accept" id="recapContinueBtn" style="margin-top:14px;">متابعة ▶️</button>
    </div>
  `;
  document.getElementById('recapContinueBtn').onclick = onContinue;
}

function rejectBox(player) {
  state.attempt = 2;
  renderBoxGrid(player);
}

function renderBankOfferPanel(player, slot) {
  const info = CARD_INFO[slot.special];
  const stage = document.getElementById('dealStage');
  stage.innerHTML = `
    <div class="reveal-panel">
      <div class="reveal-bank">🎁 عرض بنك! ${info.icon} ${info.label}</div>
      <div class="reveal-bank-desc">${info.desc}<br>لو رفضت العرض، مش هتاخد أي حاجة من الصندوق ده.</div>
      <div class="reveal-actions">
        <button class="reveal-btn accept" id="acceptOfferBtn">✅ قبول العرض</button>
        <button class="reveal-btn reject" id="declineOfferBtn">🚫 رفض العرض</button>
      </div>
    </div>
  `;
  document.getElementById('acceptOfferBtn').onclick = () => acceptBankOffer(player, slot);
  document.getElementById('declineOfferBtn').onclick = () => declineBankOffer(player);
}

function acceptBankOffer(player, slot) {
  const catKey = CATEGORIES[state.catIndex].key;
  state.players[player].squad[catKey] = { name: slot.character.name, image: slot.character.image, favorites: slot.character.favorites };

  if (slot.special === 'protect' || slot.special === 'steal') {
    state.bankedCards.push({ type: slot.special, byPlayer: player });
    showCardBanner(`🎴 ${state.players[player].name} خد ${CARD_INFO[slot.special].label}! هيستخدمه بعد ما كل الاختيارات تخلص.`);
    showBoxRecap(player, catKey, slot, finishTurn);
    return;
  }
  if (slot.special === 'dress') {
    const target = 1 - player;
    state.pendingDress = { byPlayer: player, targetPlayer: target };
    showCardBanner(`👕 ${state.players[player].name} فعّل كارت لبس صحبك على ${state.players[target].name}! هيتحكم في اختياره الجاي.`);
    showBoxRecap(player, catKey, slot, finishTurn);
  }
}

function declineBankOffer(player) {
  if (state.attempt === 1) {
    state.attempt = 2;
    renderBoxGrid(player);
    return;
  }
  // final attempt declined — this category ends empty for this player
  const catKey = CATEGORIES[state.catIndex].key;
  state.players[player].squad[catKey] = null;
  showBoxRecap(player, catKey, null, finishTurn);
}

// ---- Post-draft card resolution phase ----
// Protect and steal cards are banked when picked up and only resolved here,
// after every category is filled for both players. Protect cards resolve first
// so any steal that follows sees the final protection state.

function startCardResolutionPhase() {
  const protects = state.bankedCards.filter(c => c.type === 'protect');
  const steals = state.bankedCards.filter(c => c.type === 'steal');
  state.resolutionQueue = [...protects, ...steals];
  state.resolutionIndex = 0;
  processResolutionQueue();
}

function processResolutionQueue() {
  if (state.resolutionIndex >= state.resolutionQueue.length) {
    setTimeout(finalizeGame, 400);
    return;
  }
  const card = state.resolutionQueue[state.resolutionIndex];
  if (card.type === 'protect') renderProtectPicker(card.byPlayer, advanceResolutionQueue);
  else renderStealPicker(card.byPlayer, advanceResolutionQueue);
}

function advanceResolutionQueue() {
  state.resolutionIndex++;
  processResolutionQueue();
}

function renderProtectPicker(player, onDone) {
  const options = CATEGORIES
    .map(c => ({ cat: c, entry: state.players[player].squad[c.key] }))
    .filter(o => o.entry && !state.players[player].protected.has(o.cat.key));

  const stage = document.getElementById('dealStage');
  document.getElementById('categoryProgress').textContent = `🎴 دور كروت ${state.players[player].name}`;

  if (options.length === 0) {
    stage.innerHTML = `<div class="reveal-panel"><div class="reveal-bank">🛡️ مفيش حد تقدر تحميه!</div></div>`;
    showCardBanner('🛡️ ما كانش عند صاحب الكارت حد يحميه — الكارت ضاع من غير فايدة.');
    setTimeout(onDone, 1200);
    return;
  }

  stage.innerHTML = `
    <div class="reveal-panel">
      <div class="reveal-bank">🛡️ ${escapeHtml(state.players[player].name)}، اختار مين تحمي</div>
      <div class="protect-list">
        ${options.map(o => `
          <button data-cat="${o.cat.key}">
            <img src="${o.entry.image}" alt="${escapeHtml(o.entry.name)}">
            <span>${o.cat.label}: ${escapeHtml(o.entry.name)}</span>
          </button>
        `).join('')}
      </div>
    </div>
  `;
  stage.querySelectorAll('.protect-list button').forEach(btn => {
    btn.onclick = () => {
      state.players[player].protected.add(btn.dataset.cat);
      showCardBanner(`🛡️ ${state.players[player].name} حمى شخصية ${categoryLabel(btn.dataset.cat)}!`);
      renderSquads();
      onDone();
    };
  });
}

function renderStealPicker(player, onDone) {
  const other = 1 - player;
  const options = CATEGORIES.filter(c => state.players[other].squad[c.key]);

  const stage = document.getElementById('dealStage');
  document.getElementById('categoryProgress').textContent = `🎴 دور كروت ${state.players[player].name}`;

  if (options.length === 0) {
    stage.innerHTML = `<div class="reveal-panel"><div class="reveal-bank">🕵️ مفيش حاجة تتسرق!</div></div>`;
    showCardBanner('🕵️ الخصم معندوش حاجة تتسرق — الكارت ضاع من غير فايدة.');
    setTimeout(onDone, 1200);
    return;
  }

  stage.innerHTML = `
    <div class="reveal-panel">
      <div class="reveal-bank">🕵️ ${escapeHtml(state.players[player].name)}، اختار فئة تبدلها مع ${escapeHtml(state.players[other].name)}</div>
      <div class="protect-list">
        ${options.map(c => {
          const mine = state.players[player].squad[c.key];
          const theirs = state.players[other].squad[c.key];
          const isProtected = state.players[other].protected.has(c.key);
          return `
          <button data-cat="${c.key}">
            <img src="${theirs.image}" alt="${escapeHtml(theirs.name)}">
            <span>${c.label}: عندك ${mine ? escapeHtml(mine.name) : 'فاضي'} ⇄ عنده ${escapeHtml(theirs.name)} ${isProtected ? '🛡️' : ''}</span>
          </button>
        `;
        }).join('')}
      </div>
    </div>
  `;
  stage.querySelectorAll('.protect-list button').forEach(btn => {
    btn.onclick = () => {
      const catKey = btn.dataset.cat;
      if (state.players[other].protected.has(catKey)) {
        showCardBanner('🛡️ الحماية أوقفت كارت السرقة!');
      } else {
        const tmp = state.players[player].squad[catKey];
        state.players[player].squad[catKey] = state.players[other].squad[catKey];
        state.players[other].squad[catKey] = tmp;
        showCardBanner(`🕵️ السرقة نجحت! اتبادلت فئة ${categoryLabel(catKey)} بين اللاعبين.`);
      }
      renderSquads();
      onDone();
    };
  });
}

function runForcedPick(targetPlayer) {
  const byPlayer = state.pendingDress.byPlayer;
  const catKey = CATEGORIES[state.catIndex].key;
  const slots = state.boxSets[targetPlayer][catKey];
  const stage = document.getElementById('dealStage');

  stage.innerHTML = `
    <div class="forced-pick-note">😈 ${escapeHtml(state.players[byPlayer].name)} بيختار بدل ${escapeHtml(state.players[targetPlayer].name)} في فئة ${categoryLabel(catKey)} (كارت لبس صحبك)</div>
    <div class="box-grid">
      ${slots.map((s, i) => `<button class="box-btn" data-idx="${i}">${i + 1}</button>`).join('')}
    </div>
  `;
  stage.querySelectorAll('.box-btn').forEach(btn => {
    btn.onclick = () => {
      const idx = parseInt(btn.dataset.idx, 10);
      const slot = slots[idx];
      slot.opened = true;
      state.players[targetPlayer].squad[catKey] = { name: slot.character.name, image: slot.character.image, favorites: slot.character.favorites };
      showCardBanner(`👕 تم! ${state.players[targetPlayer].name} لبس اللي ${state.players[byPlayer].name} اختاره له.`);
      state.pendingDress = null;
      showBoxRecap(targetPlayer, catKey, slot, finishTurn);
    };
  });
}

function finishTurn() {
  state.turnPos++;
  if (state.turnPos < state.order.length) {
    startPlayerTurn();
    return;
  }

  renderSquads();

  state.catIndex++;
  if (state.catIndex >= CATEGORIES.length) {
    setTimeout(startCardResolutionPhase, 600);
    return;
  }
  setTimeout(startCategory, 500);
}

function squadToArray(player) {
  return CATEGORIES.map(c => state.players[player].squad[c.key] || null);
}

function finalizeGame() {
  const p1 = state.players[0];
  const p2 = state.players[1];
  const squad1 = squadToArray(0);
  const squad2 = squadToArray(1);
  const result = simulateMatch(squad1, squad2);

  renderMatchScreen(p1.name, p2.name, result);
  renderManOfTheMatch(p1.name, p2.name, squad1, squad2, result.scorers1, result.scorers2);

  state.matchDone = true;
  showScreen('match');

  const record = {
    mode: 'dealnodeal',
    players: [
      { name: p1.name, power: result.power1, squad: squad1.map((c, i) => c ? { name: c.name, image: c.image, price: 0, category: CATEGORIES[i].label } : null) },
      { name: p2.name, power: result.power2, squad: squad2.map((c, i) => c ? { name: c.name, image: c.image, price: 0, category: CATEGORIES[i].label } : null) },
    ],
    score: { p1: result.goals1, p2: result.goals2 },
    scorers: { p1: result.scorers1, p2: result.scorers2 },
  };
  postHistory(record);
}

document.getElementById('newGameBtn').onclick = () => {
  state.matchDone = false;
  showScreen('setup');
};
