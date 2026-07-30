const screens = {
  setup: document.getElementById('screen-setup'),
  loading: document.getElementById('screen-loading'),
  packs: document.getElementById('screen-packs'),
  teams: document.getElementById('screen-teams'),
  match: document.getElementById('screen-match'),
};

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
}

// Only ~56-60 unique "Main"-tagged characters exist across our 40-anime pool, so
// an 8-character pack (48 total) leaves a safe margin instead of an 11-man squad.
const PACK_SIZE = 8;
const TOTAL_NEEDED = PACK_SIZE * 6;

const state = {
  players: [
    { name: 'اللاعب 1', packs: [] },
    { name: 'اللاعب 2', packs: [] },
  ],
  turnPlayer: 0,
  matchDone: false,
};

document.getElementById('startBtn').onclick = startGame;

async function startGame() {
  const p1 = document.getElementById('p1Name').value.trim() || 'اللاعب 1';
  const p2 = document.getElementById('p2Name').value.trim() || 'اللاعب 2';

  state.players = [
    { name: p1, packs: [] },
    { name: p2, packs: [] },
  ];
  state.turnPlayer = 0;
  state.matchDone = false;

  showScreen('loading');
  const progressBar = document.getElementById('progressBar');
  const loadingText = document.getElementById('loadingText');
  progressBar.style.width = '5%';
  loadingText.textContent = `جاري تحميل ${TOTAL_NEEDED} شخصية عشوائية من MyAnimeList...`;

  let fakePct = 5;
  const tick = setInterval(() => {
    fakePct = Math.min(92, fakePct + 2);
    progressBar.style.width = fakePct + '%';
  }, 400);

  try {
    const pool = await getFullCharacterDatabase();
    clearInterval(tick);
    buildPacks(pool);
    progressBar.style.width = '100%';
    setTimeout(() => {
      showScreen('packs');
      renderTurn();
    }, 300);
  } catch (e) {
    clearInterval(tick);
    loadingText.textContent = poolLoadErrorMessage(e);
  }
}

// Each pack hides a random "twist" — good or bad — revealed only when the pack
// is opened, like a shock red card or a player in career-best form. `target`
// says who it hits (a random squad member, specifically the headline star, or
// the whole team), and `multiplier` scales that target's favorites (their
// power contribution) before the match sim runs. `eject: true` removes the
// target from the squad entirely instead of scaling them.
const PACK_TWISTS = [
  // bad
  { key: 'red_card', kind: 'bad', icon: '🟥', target: 'random', eject: true, text: n => `كارت أحمر! ${n} اتطرد وهيلعب المباراة ناقص` },
  { key: 'injury', kind: 'bad', icon: '🤕', target: 'random', multiplier: 0.5, text: n => `إصابة! ${n} هيلعب المباراة بنص قوته بس` },
  { key: 'yellow_card', kind: 'bad', icon: '🟨', target: 'random', multiplier: 0.7, text: n => `كارت أصفر! ${n} هيلعب بحذر شديد وقوته هتقل` },
  { key: 'internal_conflict', kind: 'bad', icon: '😤', target: 'random', multiplier: 0.6, text: n => `خلاف داخلي! ${n} مش مركز خالص النهاردة` },
  { key: 'stage_fright', kind: 'bad', icon: '😰', target: 'headliner', multiplier: 0.5, text: n => `رهبة الجمهور! ${n} (نجم الباكة) متوتر وهيلعب بنص قوته` },
  { key: 'tired', kind: 'bad', icon: '😴', target: 'team', multiplier: 0.8, text: () => 'الفريق مرهق! قوة التشكيلة كلها هتقل شوية' },
  { key: 'bad_weather', kind: 'bad', icon: '🌧️', target: 'team', multiplier: 0.85, text: () => 'جو المباراة وحش! التشكيلة كلها متأثرة شوية' },
  { key: 'jet_lag', kind: 'bad', icon: '✈️', target: 'team', multiplier: 0.9, text: () => 'سفر طويل قبل المباراة! التشكيلة مش في أحسن حالاتها' },
  // good
  { key: 'star_form', kind: 'good', icon: '⭐', target: 'random', multiplier: 2.0, text: n => `${n} في فورمة النار! هيلعب بضعف قوته الحقيقية` },
  { key: 'hot_streak', kind: 'good', icon: '🔥', target: 'random', multiplier: 2.5, text: n => `${n} مشتعل النهاردة! قوته زادت جامد` },
  { key: 'lucky_sub', kind: 'good', icon: '🔄', target: 'random', multiplier: 2.2, text: n => `بديل مميز! ${n} هيدخل بقوة إضافية ويقلب المباراة` },
  { key: 'captain_spirit', kind: 'good', icon: '👑', target: 'headliner', multiplier: 1.6, text: n => `روح القيادة! ${n} (نجم الباكة) بيقود الفريق بقوة زيادة` },
  { key: 'tactical_genius', kind: 'good', icon: '🧠', target: 'headliner', multiplier: 1.8, text: n => `عبقرية تكتيكية! ${n} بيلعب بذكاء زيادة النهاردة` },
  { key: 'morale', kind: 'good', icon: '💪', target: 'team', multiplier: 1.2, text: () => 'روح معنوية عالية! قوة التشكيلة كلها هتزيد شوية' },
  { key: 'home_crowd', kind: 'good', icon: '📣', target: 'team', multiplier: 1.15, text: () => 'دعم جماهيري رهيب! التشكيلة كلها متحمسة' },
  { key: 'lucky_day', kind: 'good', icon: '🍀', target: 'team', multiplier: 1.1, text: () => 'يوم سعيد! حظ التشكيلة كويس النهاردة' },
];

function pickTwist(characters, headliner) {
  const twist = PACK_TWISTS[Math.floor(Math.random() * PACK_TWISTS.length)];
  let targetChar = null;
  if (twist.target === 'random') targetChar = characters[Math.floor(Math.random() * characters.length)];
  else if (twist.target === 'headliner') targetChar = headliner;
  return { ...twist, targetName: targetChar ? targetChar.name : null, message: twist.text(targetChar?.name) };
}

// Applies a pack's twist to a squad copy before it goes into the match sim.
function applyTwist(characters, twist) {
  const squad = characters.map(c => ({ ...c }));
  if (twist.eject) return squad.filter(c => c.name !== twist.targetName);
  if (twist.target === 'team') return squad.map(c => ({ ...c, favorites: Math.round((c.favorites || 0) * twist.multiplier) }));
  return squad.map(c => c.name === twist.targetName ? { ...c, favorites: Math.round((c.favorites || 0) * twist.multiplier) } : c);
}

function buildPacks(poolFlat) {
  if (poolFlat.length < TOTAL_NEEDED) {
    document.getElementById('loadingText').textContent =
      `تعذر تجميع ${TOTAL_NEEDED} شخصية كافية (وصلنا لـ ${poolFlat.length} بس) — حاول تاني.`;
    return;
  }

  // Each pack is fronted by a real headline star (the 6 most-favorited characters
  // overall), guaranteed to be inside that pack's lineup — the rest is random,
  // same as the show's "Lewandowski pack" / "Bale pack" branding.
  const sortedByFame = [...poolFlat].sort((a, b) => (b.favorites || 0) - (a.favorites || 0));
  const headliners = sortedByFame.slice(0, 6);
  const headlinerIds = new Set(headliners.map(c => c.mal_id));
  const rest = shuffle(poolFlat.filter(c => !headlinerIds.has(c.mal_id)));

  let cursor = 0;
  let headlinerCursor = 0;
  for (let player = 0; player < 2; player++) {
    state.players[player].packs = [];
    for (let p = 0; p < 3; p++) {
      const headliner = headliners[headlinerCursor++];
      const fillers = rest.slice(cursor, cursor + PACK_SIZE - 1);
      cursor += PACK_SIZE - 1;
      const characters = shuffle([headliner, ...fillers]);
      state.players[player].packs.push({
        headliner,
        characters,
        twist: pickTwist(characters, headliner),
        asksUsed: 0,
        maxAsks: 3,
        opened: false,
      });
    }
  }
}

// This is a local pass-and-play round: while it's a player's turn, the OTHER
// player acts as judge — they can see this screen (the real lineup in every
// pack) and answer the asking player's spoken yes/no questions honestly. The
// app doesn't generate or grade questions itself, it only tracks how many of
// the 3 allowed questions have been used per pack via the "سؤال 1/2/3" toggles.
function renderTurn() {
  const player = state.turnPlayer;
  const judge = state.players[1 - player].name;
  document.getElementById('turnTitle').textContent = `دور ${state.players[player].name} — و${judge} هو الحكم`;
  document.getElementById('packsHint').textContent =
    `${judge}: بص في الباكات وجاوب ${state.players[player].name} بصراحة على أي سؤال يسأله. لما يسأل سؤال، دوس على "سؤال 1/2/3" عشان تسجل إنه اتسأل.`;
  renderPacksGrid(player);
}

function renderPacksGrid(player) {
  const grid = document.getElementById('packsGrid');
  const packs = state.players[player].packs;

  grid.innerHTML = packs.map((pack, idx) => {
    const askButtonsHtml = Array.from({ length: pack.maxAsks }, (_, qi) => {
      const used = qi < pack.asksUsed;
      return `<button class="pack-btn ask ${used ? 'used' : ''}" data-pack="${idx}" ${used || pack.opened ? 'disabled' : ''}>
        ${used ? '✔️' : '❓'} سؤال ${qi + 1}
      </button>`;
    }).join('');

    const lineupHtml = `
      <div class="pack-lineup">
        ${pack.characters.map(c => `
          <div class="pack-lineup-item">
            <img src="${c.image}" alt="${escapeHtml(c.name)}">
            <div class="lineup-name">${escapeHtml(c.name)}</div>
          </div>
        `).join('')}
      </div>`;

    return `
      <div class="pack-card ${pack.opened ? 'opened' : ''}">
        <img class="pack-cover" src="${pack.headliner.image}" alt="${escapeHtml(pack.headliner.name)}">
        <div class="pack-title">باكة ${escapeHtml(pack.headliner.name)}${pack.opened ? ' (المختارة)' : ''}</div>
        <div class="ask-row">${askButtonsHtml}</div>
        <div class="judge-note">👁️ للحكم بس — اللاعب متبصش:</div>
        ${lineupHtml}
        ${!pack.opened ? `<div class="pack-actions"><button class="pack-btn open" data-open="${idx}">📦 افتح الباكة دي</button></div>` : ''}
      </div>
    `;
  }).join('');

  grid.querySelectorAll('.pack-btn.ask:not([disabled])').forEach(btn => {
    btn.onclick = () => {
      const packIdx = parseInt(btn.dataset.pack, 10);
      packs[packIdx].asksUsed++;
      renderPacksGrid(player);
    };
  });

  grid.querySelectorAll('[data-open]').forEach(btn => {
    btn.onclick = () => openPack(player, parseInt(btn.dataset.open, 10));
  });
}

function openPack(player, packIdx) {
  state.players[player].packs.forEach(p => { p.opened = false; });
  const pack = state.players[player].packs[packIdx];
  pack.opened = true;
  renderTwistReveal(player, pack);
}

function renderTwistReveal(player, pack) {
  const grid = document.getElementById('packsGrid');
  const twist = pack.twist;
  document.getElementById('turnTitle').textContent = `${state.players[player].name} فتح باكة ${pack.headliner.name}!`;
  document.getElementById('packsHint').textContent = '';
  grid.innerHTML = `
    <div class="pack-card opened twist-reveal">
      <img class="pack-cover" src="${pack.headliner.image}" alt="${escapeHtml(pack.headliner.name)}">
      <div class="pack-title">باكة ${escapeHtml(pack.headliner.name)}</div>
      <div class="twist-banner ${twist.kind}">${twist.icon} ${escapeHtml(twist.message)}</div>
      <div class="pack-lineup">
        ${pack.characters.map(c => `
          <div class="pack-lineup-item ${c.name === twist.targetName ? 'twist-target' : ''}">
            <img src="${c.image}" alt="${escapeHtml(c.name)}">
            <div class="lineup-name">${escapeHtml(c.name)}</div>
          </div>
        `).join('')}
      </div>
      <button class="primary-btn" id="twistContinueBtn" style="margin-top:16px;">متابعة ▶️</button>
    </div>
  `;
  document.getElementById('twistContinueBtn').onclick = advanceAfterOpen;
}

function advanceAfterOpen() {
  if (state.turnPlayer === 0) {
    state.turnPlayer = 1;
    renderTurn();
  } else {
    renderTeamsPreview();
  }
}

function renderTeamsPreview() {
  const grid = document.getElementById('teamsGrid');
  grid.innerHTML = [0, 1].map(player => {
    const p = state.players[player];
    const pack = p.packs.find(pk => pk.opened);
    const twist = pack.twist;
    return `
      <div class="team-col">
        <h3 class="${player === 0 ? 'p1' : 'p2'}">${escapeHtml(p.name)}</h3>
        <div class="twist-banner ${twist.kind}">${twist.icon} ${escapeHtml(twist.message)}</div>
        <div class="pack-lineup">
          ${pack.characters.map(c => `
            <div class="pack-lineup-item ${c.name === twist.targetName ? 'twist-target' : ''} ${twist.eject && c.name === twist.targetName ? 'ejected' : ''}">
              <img src="${c.image}" alt="${escapeHtml(c.name)}">
              <div class="lineup-name">${escapeHtml(c.name)}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }).join('');

  showScreen('teams');
}

document.getElementById('showMatchBtn').onclick = finalizeGame;

function squadFromOpenedPack(player) {
  const openedPack = state.players[player].packs.find(p => p.opened);
  if (!openedPack) return [];
  const twisted = applyTwist(openedPack.characters, openedPack.twist);
  return twisted.map(c => ({ name: c.name, image: c.image, favorites: c.favorites }));
}

function finalizeGame() {
  const p1 = state.players[0];
  const p2 = state.players[1];
  const squad1 = squadFromOpenedPack(0);
  const squad2 = squadFromOpenedPack(1);
  const result = simulateMatch(squad1, squad2);

  renderMatchScreen(p1.name, p2.name, result);
  renderManOfTheMatch(p1.name, p2.name, squad1, squad2, result.scorers1, result.scorers2);

  state.matchDone = true;
  showScreen('match');

  const twist1 = p1.packs.find(p => p.opened)?.twist.message || '';
  const twist2 = p2.packs.find(p => p.opened)?.twist.message || '';
  const record = {
    mode: 'packs',
    players: [
      { name: p1.name, power: result.power1, squad: squad1.map(c => ({ name: c.name, image: c.image, price: 0 })), twist: twist1 },
      { name: p2.name, power: result.power2, squad: squad2.map(c => ({ name: c.name, image: c.image, price: 0 })), twist: twist2 },
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
