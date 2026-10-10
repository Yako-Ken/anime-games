const screens = {
  setup: document.getElementById('screen-setup'),
  loading: document.getElementById('screen-loading'),
  round: document.getElementById('screen-round'),
  reveal: document.getElementById('screen-reveal'),
};

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
}

const HINT_TIME = 60;

const state = {
  players: [
    { name: 'اللاعب 1', score: 0 },
    { name: 'اللاعب 2', score: 0 },
  ],
  pool: [],
  hintBank: null,
  round: 0,
  currentChar: null,
  hints: [],
  hintIndex: 0,
  timeLeft: HINT_TIME,
  timerId: null,
  usedIds: new Set(),
};

document.getElementById('startBtn').onclick = startGame;

async function startGame() {
  const p1 = document.getElementById('p1Name').value.trim() || 'اللاعب 1';
  const p2 = document.getElementById('p2Name').value.trim() || 'اللاعب 2';

  state.players = [{ name: p1, score: 0 }, { name: p2, score: 0 }];
  state.round = 0;
  state.usedIds = new Set();

  showScreen('loading');
  const progressBar = document.getElementById('progressBar');
  const loadingText = document.getElementById('loadingText');
  progressBar.style.width = '5%';
  loadingText.textContent = 'جاري تحميل الشخصيات...';

  let fakePct = 5;
  const tick = setInterval(() => {
    fakePct = Math.min(92, fakePct + 3);
    progressBar.style.width = fakePct + '%';
  }, 300);

  try {
    state.pool = await getFullCharacterDatabase();
    clearInterval(tick);
    if (state.pool.length < 5) throw new Error('Not enough characters (have ' + state.pool.length + ')');
    try {
      const res = await fetch('guess-hints.json');
      if (res.ok) state.hintBank = await res.json();
    } catch (e) { state.hintBank = null; }
    progressBar.style.width = '100%';
    document.getElementById('p1GuessLabel').textContent = p1;
    document.getElementById('p2GuessLabel').textContent = p2;
    setTimeout(startRound, 300);
  } catch (e) {
    clearInterval(tick);
    loadingText.textContent = poolLoadErrorMessage(e);
  }
}

// Curated hard hints from guess-hints.json when available (keyed by exact
// name); otherwise deductive fallback hints (rank, same-world comparison)
// — never fame-tier labels, never letter counting.
function generateHints(char, pool) {
  const bank = state.hintBank;
  if (bank && Array.isArray(bank[char.name]) && bank[char.name].length >= 3) {
    return bank[char.name].slice(0, 5);
  }
  const fallback = (bank && Array.isArray(bank.__default__) && bank.__default__.length)
    ? bank.__default__.map(h => h.split('{anime}').join(char.anime))
    : [];
  return [...generateBasicHints(char, pool), ...fallback].slice(0, 5);
}

function popularityRank(char, pool) {
  const sorted = [...pool].sort((a, b) => (b.favorites || 0) - (a.favorites || 0));
  return sorted.findIndex(c => c.mal_id === char.mal_id) + 1;
}

function generateBasicHints(char, pool) {
  const rank = popularityRank(char, pool);
  const sameWorld = [...pool]
    .filter(c => c.anime === char.anime && c.mal_id !== char.mal_id)
    .sort((a, b) => (b.favorites || 0) - (a.favorites || 0));
  const top = sameWorld[0];
  const wordCount = char.name.split(/[\s,]+/).filter(Boolean).length;

  const out = [`ترتيبها رقم ${rank} من ${pool.length} في الشعبية 🔢`];
  if (top) out.push(`في عالم "${char.anime}"، "${top.name}" أشهر منها بكتير 👑`);
  else out.push(`هي الأشهر على الإطلاق في عالم "${char.anime}" 👑`);
  out.push(`العالم بتاعها هو "${char.anime}" 🌍`);
  out.push(`اسمها مكوّن من ${wordCount === 1 ? 'كلمة واحدة' : wordCount + ' كلمات'} 📝`);
  return out;
}

function pickRandomChar() {
  let candidates = state.pool.filter(c => !state.usedIds.has(c.mal_id));
  if (candidates.length === 0) {
    state.usedIds.clear();
    candidates = state.pool;
  }
  const char = candidates[Math.floor(Math.random() * candidates.length)];
  state.usedIds.add(char.mal_id);
  return char;
}

function startRound() {
  state.round++;
  state.currentChar = pickRandomChar();
  state.hints = generateHints(state.currentChar, state.pool);
  state.hintIndex = 0;

  document.getElementById('p1NameLabel').textContent = state.players[0].name;
  document.getElementById('p2NameLabel').textContent = state.players[1].name;
  document.getElementById('p1ScoreLabel').textContent = state.players[0].score;
  document.getElementById('p2ScoreLabel').textContent = state.players[1].score;
  document.getElementById('roundNumLabel').textContent = state.round;
  document.getElementById('hintsList').innerHTML = '';
  document.getElementById('p1CorrectBtn').disabled = false;
  document.getElementById('p2CorrectBtn').disabled = false;
  document.getElementById('answerImg').src = state.currentChar.image;
  document.getElementById('answerImg').alt = state.currentChar.name;
  document.getElementById('answerName').textContent = state.currentChar.name;

  showScreen('round');
  revealNextHint();
}

function revealNextHint() {
  if (state.hintIndex >= state.hints.length) return;
  const hint = state.hints[state.hintIndex];
  state.hintIndex++;

  const row = document.createElement('div');
  row.className = 'hint-row';
  row.innerHTML = `<span class="hint-num">${state.hintIndex}.</span><span>${escapeHtml(hint)}</span>`;
  document.getElementById('hintsList').appendChild(row);

  document.getElementById('nextHintBtn').disabled = state.hintIndex >= state.hints.length;
  document.getElementById('nextHintBtn').textContent = state.hintIndex >= state.hints.length
    ? '🚫 خلصت الهينتات'
    : 'الهينت الجاي ⏭️';

  restartTimer();
}

function restartTimer() {
  clearInterval(state.timerId);
  state.timeLeft = HINT_TIME;
  updateTimerDisplay();
  state.timerId = setInterval(() => {
    state.timeLeft--;
    updateTimerDisplay();
    if (state.timeLeft <= 0) {
      clearInterval(state.timerId);
      if (state.hintIndex < state.hints.length) revealNextHint();
    }
  }, 1000);
}

function updateTimerDisplay() {
  const el = document.getElementById('timerNum');
  el.textContent = state.timeLeft;
  el.classList.toggle('low', state.timeLeft <= 10);
}

document.getElementById('nextHintBtn').onclick = revealNextHint;
document.getElementById('p1CorrectBtn').onclick = () => endRound(0);
document.getElementById('p2CorrectBtn').onclick = () => endRound(1);
document.getElementById('nobodyBtn').onclick = () => endRound(null);

function endRound(winnerIdx) {
  clearInterval(state.timerId);
  if (winnerIdx !== null) state.players[winnerIdx].score++;

  document.getElementById('revealTitle').textContent = winnerIdx !== null
    ? `🏆 ${state.players[winnerIdx].name} خمن صح!`
    : '🤷 محدش خمنها';
  document.getElementById('revealImg').src = state.currentChar.image;
  document.getElementById('revealImg').alt = state.currentChar.name;
  document.getElementById('revealName').textContent = state.currentChar.name;

  document.getElementById('p1NameLabel2').textContent = state.players[0].name;
  document.getElementById('p2NameLabel2').textContent = state.players[1].name;
  document.getElementById('p1ScoreLabel2').textContent = state.players[0].score;
  document.getElementById('p2ScoreLabel2').textContent = state.players[1].score;

  showScreen('reveal');
}

document.getElementById('nextRoundBtn').onclick = startRound;
document.getElementById('endGameBtn').onclick = () => {
  const record = {
    mode: 'guess',
    players: [
      { name: state.players[0].name, score: state.players[0].score },
      { name: state.players[1].name, score: state.players[1].score },
    ],
    score: { p1: state.players[0].score, p2: state.players[1].score },
  };
  postHistory(record);
  showScreen('setup');
};
