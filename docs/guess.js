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
    progressBar.style.width = '100%';
    document.getElementById('p1GuessLabel').textContent = p1;
    document.getElementById('p2GuessLabel').textContent = p2;
    setTimeout(startRound, 300);
  } catch (e) {
    clearInterval(tick);
    loadingText.textContent = poolLoadErrorMessage(e);
  }
}

// From vague to specific, using only data every character in the database
// already has (name, source series, popularity rank) — no live AI call needed
// since this is a static site with no backend to hide an API key behind.
function generateHints(char, pool) {
  const sorted = [...pool].sort((a, b) => (b.favorites || 0) - (a.favorites || 0));
  const rank = sorted.findIndex(c => c.mal_id === char.mal_id);
  const percentile = pool.length <= 1 ? 0 : rank / (pool.length - 1);

  let tier;
  if (percentile <= 0.1) tier = 'شخصية أسطورية معروفة لكل حد تقريبًا';
  else if (percentile <= 0.35) tier = 'شخصية مشهورة جدًا';
  else if (percentile <= 0.65) tier = 'شخصية معروفة بس مش من الأشهر';
  else tier = 'شخصية مش معروفة أوي — تحدي حقيقي';

  const cleanName = char.name.replace(/[.,]/g, '').replace(/\s+/g, '');
  const letterCount = cleanName.length;
  const firstLetter = char.name.trim()[0];
  const lastLetter = char.name.trim().slice(-1);
  const wordCount = char.name.split(/[\s,]+/).filter(Boolean).length;

  return [
    tier,
    `الشخصية دي من عالم "${char.anime}"`,
    `اسمها مكوّن من ${wordCount === 1 ? 'كلمة واحدة' : wordCount + ' كلمات'}، وعدد حروفه ${letterCount} حرف`,
    `اسمها بيبدأ بحرف "${firstLetter}"`,
    `اسمها بينتهي بحرف "${lastLetter}"`,
  ];
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
