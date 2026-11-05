import { Game, category, moveBoard } from './engine.js';
import { Storage } from './storage.js';
import { Leaderboard } from './leaderboard.js';
import { exact, formatInteger, completionStats } from './numbers.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const icons = {
  home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/>',
  undo: '<path d="M4 10h10a6 6 0 0 1 0 12" transform="translate(0 -3)"/><path d="m8 3-4 4 4 4"/>',
  restart: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 6a8 8 0 0 1 13 2l1 4M4 12l1 4a8 8 0 0 0 13 2"/>',
  trophy: '<path d="M8 3h8v7a4 4 0 0 1-8 0ZM8 5H4v3a4 4 0 0 0 4 4m8-7h4v3a4 4 0 0 1-4 4m-4 2v5m-4 2h8m-6-2h4"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1-4c-1-1 0-3 2-3h2a3 3 0 0 0 3-3 9 9 0 0 0-9-8Z"/><circle cx="7.5" cy="10" r=".8"/><circle cx="11" cy="6.7" r=".8"/><circle cx="16" cy="8" r=".8"/><circle cx="7.5" cy="15" r=".8"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1 .5-1.5 1-1.5 2m0 3v.1"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  back: '<path d="m12 5-7 7 7 7M5 12h15"/>',
  settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
  sparkle: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/>'
};
const themes = { classic: 'Classic', forest: 'Forest', ocean: 'Ocean', twilight: 'Twilight' };
const themeColours = { classic: '#faf8ef', forest: '#348d6c', ocean: '#16849c', twilight: '#6376c2' };
const svg = key => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[key] || ''}</svg>`;
function paintIcons(root = document) { root.querySelectorAll('[data-icon]').forEach(el => el.innerHTML = svg(el.dataset.icon)); }
const fmt = formatInteger;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const spawnExplanation = 'The 2/4 switch lets you choose which tile spawns next. Merging two 2s into a 4 earns 4 points; a 4 that spawns directly earns none. For the same final tiles, each spawned 4 replacing two spawned 2s leaves your score 4 points lower. Choose 2 for the higher scoring potential, or 4 when it helps your board.';
const smartSpawnExplanation = 'On 4 × 4, follows the edge shared by your highest corner tile and its adjacent second-highest tile. After sliding and merging, if that row or column and the next one inward are full, and the third has three tiles, its last empty cell is protected: the new tile spawns on the opposite edge. If no other space is available, the remaining cell is used.';
const largeTileExplanation = 'Asks before moving a large tile unless a tile at or above the same threshold merges on that swipe. Thresholds: 3 × 3: 1,024; 4 × 4: 2,048; 5 × 5: 4,096; 6 × 6: 8,192; 7 × 7: 16,384; 8 × 8: 32,768.';
const assistanceExplanation = `<p>Tap the shield next to Home to turn assistance on or off. Hold it to see this help.</p><p><strong>Smart spawning (4 × 4 only):</strong> ${smartSpawnExplanation}</p><p><strong>Large-tile warning:</strong> ${largeTileExplanation}</p><p><strong>Corner warning:</strong> after reaching 4096, asks before moving away from the shared edge of your highest corner tile and its adjacent second-highest tile.</p><p>You can cancel a warning or continue the move. Assistance starts off in a new game, stays as selected when you resume, and uses the same leaderboard.</p>`;
let storage, leaderboard, game = null, games = {}, records = {}, prefs = { size: 4, mode: 'standard', theme: 'classic', nickname: '' };
let screen = 'home', previousScreen = 'home', busy = false, queued = null, geom = {}, toastTimer, refreshTimer, rankingRequest = 0, lastSync = 0;
let pointer = null, savingFailed = false, queuedUndos = 0;
let completedView = null;

function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').hidden = true, 4000); }
function saveFailure() { if (!savingFailed) { savingFailed = true; toast('Your progress could not be saved. Keep the app open and free some device storage.'); } }
function saveGame(reset = false) { games[game.size] = game; storage?.saveGame(game, reset).catch(saveFailure); }
function savePrefs() { storage?.write('prefs', prefs).catch(saveFailure); }
function applyTheme(name) {
  prefs.theme = themes[name] ? name : 'classic';
  document.body.dataset.theme = prefs.theme;
  document.documentElement.style.background = themeColours[prefs.theme];
  $('meta[name="theme-color"]').content = themeColours[prefs.theme];
  $$('.theme-choice').forEach(b => { const yes = b.dataset.theme === prefs.theme; b.classList.toggle('selected', yes); b.setAttribute('aria-pressed', String(yes)); b.innerHTML = yes ? '<span>✓</span>' : ''; });
  window.AndroidHost?.setThemeColour(themeColours[prefs.theme], prefs.theme === 'classic');
  savePrefs();
}
function themeButtons() { return Object.entries(themes).map(([id, label]) => `<button type="button" class="theme-choice" data-theme="${id}" aria-label="${label} theme" aria-pressed="false"></button>`).join(''); }
function updateHome() {
  $('#board-size-label').textContent = `${prefs.size} × ${prefs.size}`;
  $('[data-action="smaller"]').disabled = prefs.size === 3;
  $('[data-action="larger"]').disabled = prefs.size === 8;
  const selected = games[prefs.size];
  const resumable = selected && (selected.complete || !selected.over || selected.canUndo);
  $('#resume-button').disabled = !resumable;
  $('#resume-button').title = resumable ? 'Continue this board' : 'No saved game for this board size';
}
function showScreen(name) {
  if (screen === 'leaderboard' && name !== 'leaderboard') { clearInterval(refreshTimer); rankingRequest++; }
  screen = name;
  pointer = null;
  document.body.classList.toggle('playing', name === 'game');
  $$('.screen').forEach(el => el.hidden = el.id !== name + '-screen');
  window.scrollTo(0, 0);
  if (name === 'home') updateHome();
  if (name === 'game') { completedView = null; requestAnimationFrame(() => { layoutBoard(); renderBoard(); updateGameUI(); }); }
}
function modal(title, content, actions = []) {
  pointer = null;
  if ($('#modal').open) $('#modal').close();
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = content;
  $('#modal-actions').innerHTML = '';
  for (const action of actions) {
    const b = document.createElement('button'); b.type = 'button'; b.className = action.secondary ? 'secondary' : 'primary'; b.textContent = action.label;
    b.onclick = () => action.run(b); $('#modal-actions').append(b);
  }
  paintIcons($('#modal'));
  $('#modal').showModal();
}
function confirmNew(restart = false) {
  const start = () => { $('#modal').close(); startGame(restart ? game.size : prefs.size, restart ? game.mode : prefs.mode, restart ? game.nextTile : 2); };
  const selected = restart ? game : games[prefs.size];
  if (selected && selected.moves > 0 && (!selected.over || selected.canUndo)) modal(restart ? 'Start fresh?' : 'Start a new game?', `<p>Your ${selected.size} × ${selected.size} board and undo history will be replaced. Other board sizes and your high scores stay saved.</p>`, [{ label: 'Keep playing', secondary: true, run: () => $('#modal').close() }, { label: 'New game', run: start }]);
  else start();
}
function optionsDialog(start = false) {
  const choices = (id, title, options) => `<fieldset id="${id}" class="mode-group"><legend>${title}</legend><div class="mode-choices">${options.map(([value, label, hint]) => `<label class="mode-choice"><input type="radio" name="${id}" value="${value}"><span class="mode-card"><span class="mode-label">${label}<span class="mode-check" aria-hidden="true">✓</span></span><small>${hint}</small></span></label>`).join('')}</div></fieldset>`;
  modal(start ? 'New game' : 'Game options', choices('option-undo', 'Undo', [['standard','Standard','One at a time'],['unlimited','Unlimited','Rewind freely']]) + '<p class="muted leaderboard-note">These modes have separate leaderboards.</p><details class="option-details"><summary>About these options</summary><p>Standard undo requires a successful move before another undo. Unlimited lets you rewind repeatedly. Their high scores stay separate.</p><p><strong>Smart spawning:</strong> ' + smartSpawnExplanation + '</p><p><strong>Large-tile warning:</strong> ' + largeTileExplanation + '</p><p>After reaching 4096, the corner warning asks before swiping away from the edge shared by your highest corner tile and its adjacent second-highest tile. New games start with assistance off. Toggle it beside Home during play. Assistance uses the same leaderboard as unassisted play.</p><p>New-game setup starts on Standard. Saved games keep their original undo mode.</p></details>', [{ label: start ? 'Play' : 'Done', run: () => {
    prefs.mode = $('#option-undo input:checked').value;
    savePrefs(); $('#modal').close();
    if (start) confirmNew();
  } }]);
  $(`#option-undo input[value="${start ? 'standard' : prefs.mode}"]`).checked = true;
}
function startGame(size, mode, spawn = 2) {
  queued = null;
  queuedUndos = 0;
  game = new Game(size, mode, spawn, Math.random, false);
  prefs.size = size; savePrefs();
  saveGame(true);
  buildCells();
  showScreen('game');
}
function buildCells() {
  if (!game) return;
  $('#board').style.setProperty('--size', game.size);
  $('#cells').replaceChildren(...Array.from({ length: game.size ** 2 }, () => { const cell = document.createElement('div'); cell.className = 'cell'; return cell; }));
  layoutBoard();
}
function layoutBoard() {
  if (!game || $('#game-screen').hidden) return;
  const width = $('#board').getBoundingClientRect().width;
  const gap = game.size <= 4 ? 9 : game.size <= 6 ? 7 : 5;
  const pad = game.size <= 5 ? 10 : 8;
  const cell = (width - pad * 2 - gap * (game.size - 1)) / game.size;
  geom = { gap, pad, cell };
  $('#board').style.setProperty('--board-gap', gap + 'px');
  $('#board').style.setProperty('--board-pad', pad + 'px');
  $('#board').style.setProperty('--cell-size', cell + 'px');
}
function position(el, r, c) { el.style.transform = `translate(${geom.pad + c * (geom.cell + geom.gap)}px,${geom.pad + r * (geom.cell + geom.gap)}px)`; }
function tile(value, r, c, className = '') {
  const el = document.createElement('div'); el.className = `tile ${value > 2048 ? 'large ' : ''}${className}`; el.dataset.value = value; el.dataset.cell = `${r},${c}`;
  const digits = exact(value).toString().length;
  const powerLabel = digits * 5 > geom.cell - 4;
  el.style.setProperty('--tile-font', (powerLabel ? geom.cell * .45 : Math.max(9, Math.min(geom.cell * .48, geom.cell * 1.5 / Math.max(2.4, digits)))) + 'px');
  const label = document.createElement('span');
  if (powerLabel) { label.textContent = '2'; const exponent = document.createElement('sup'); exponent.textContent = Math.log2(value); label.append(exponent); }
  else label.textContent = exact(value).toString();
  el.title = fmt(value); el.append(label); position(el, r, c); return el;
}
function renderBoard(result = null) {
  if (!game || !geom.cell) return;
  const merged = new Set(result?.motions.filter(m => m.merge).map(m => m.to.join(',')) || []);
  const nodes = [];
  game.board.forEach((row, r) => row.forEach((v, c) => {
    if (v) nodes.push(tile(v, r, c, result?.spawned?.r === r && result?.spawned?.c === c ? 'spawn' : merged.has(`${r},${c}`) ? 'merge' : ''));
  }));
  $('#tiles').replaceChildren(...nodes);
  $('#board').setAttribute('aria-label', `${game.size} by ${game.size} board. Rows: ${game.board.map(r => r.map(v => v ? fmt(v) : 'empty').join(', ')).join('; ')}. Swipe or use arrow keys to move.`);
}
function updateGameUI() {
  if (!game) return;
  $('#score').textContent = fmt(game.score);
  $('#best').textContent = fmt(records[category(game.size, game.mode)]?.score || 0);
  $('#score').dataset.exact = exact(game.score).toString();
  $('#best').dataset.exact = exact(records[category(game.size, game.mode)]?.score || 0).toString();
  fitScores();
  // A move is already committed while it animates; retain taps for the animation's end.
  const undoLimit = game.mode === 'standard' ? 1 : game.history.length;
  $$('[data-action="undo"]').forEach(b => b.disabled = !game.canUndo || queuedUndos >= undoLimit);
  $('#undo-button').title = game.undoLocked ? 'Make a move to unlock undo' : 'Undo last move';
  $('#assistance-button').setAttribute('aria-pressed', String(game.assisted));
  $('#assistance-button').title = `Assistance ${game.assisted ? 'on' : 'off'}`;
  $('#assistance-state').textContent = game.assisted ? 'ON' : 'OFF';
  $$('[data-spawn]').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.spawn) === game.nextTile)));
  const complete = game.complete;
  if (!complete) completedView = null;
  const showComplete = complete && !busy && queuedUndos === 0 && completedView !== game;
  $('#completion-overlay').hidden = !showComplete;
  $('#board').classList.toggle('completed', showComplete);
  if (complete) {
    const stats = completionStats(game.size, game.score);
    $('#completion-score').textContent = fmt(game.score);
    $('#completion-max').textContent = fmt(stats.max);
    $('#completion-percent').textContent = `${stats.percent}% of the maximum`;
    $('#completion-gap').textContent = exact(stats.gap) === 0n ? 'A perfect score!' : `${fmt(stats.gap)} points from perfect`;
    $('#completion-subtitle').textContent = `Maximum ${game.size} × ${game.size} configuration reached`;
  }
  const won = !complete && game.won && !game.winAcknowledged;
  const showWin = won && !busy && queuedUndos === 0;
  $('#win-overlay').classList.toggle('visible', showWin);
  $('#win-overlay').setAttribute('aria-hidden', String(!showWin));
  $('#win-overlay').tabIndex = showWin ? 0 : -1;
  $('#board-overlay').hidden = complete || busy || won || !game.over;
  if (game.over) {
    $('#overlay-title').textContent = 'Out of moves.';
    $('#overlay-description').textContent = `You scored ${fmt(game.score)}. ${game.canUndo ? 'Try a different move, or start fresh.' : 'A fresh board is a fresh possibility.'}`;
    $('#overlay-symbol').textContent = '↻';
    $('#overlay-main').textContent = 'Try again';
    $('#overlay-main').dataset.action = 'restart';
    $('#overlay-undo').hidden = !game.canUndo;
  }
}
function fitScores() {
  for (const el of [$('#score'), $('#best')]) {
    const digits = el.dataset.exact || '0';
    el.textContent = fmt(digits); el.title = fmt(digits); el.setAttribute('aria-label', fmt(digits));
    el.style.fontSize = '22px';
    if (!el.clientWidth) continue;
    for (let size = 21; el.scrollWidth > el.clientWidth && size >= 8; size--) el.style.fontSize = size + 'px';
    if (el.scrollWidth > el.clientWidth) {
      el.textContent = `${digits[0]}.${digits.slice(1, 5)}e${digits.length - 1}`;
      el.style.fontSize = '16px';
      for (let size = 15; el.scrollWidth > el.clientWidth && size >= 8; size--) el.style.fontSize = size + 'px';
    }
  }
}
function recordBest() {
  const key = category(game.size, game.mode);
  if (exact(game.score) > exact(records[key]?.score || 0)) {
    records[key] = { score: game.score, maxTile: game.maxTile, at: Date.now() };
    storage.write('records', records).catch(saveFailure);
  }
}
async function move(direction, confirmed = false) {
  if (screen !== 'game' || !game || game.complete || $('#modal').open || !$('#board-overlay').hidden || (game.won && !game.winAcknowledged)) return;
  if (busy) { if (!queuedUndos) queued = direction; return; }
  const warning = !confirmed && game.warningFor(direction);
  if (warning) {
    queued = null;
    const pendingGame = game;
    const message = warning.type === 'large-tile'
      ? `Swipe ${direction} and move your ${fmt(warning.highest)} tile without merging any tiles of ${fmt(warning.threshold)} or higher?`
      : `Swipe ${direction}, away from the ${warning.edge} edge holding your ${fmt(warning.highest)} and ${fmt(warning.second)} tiles?`;
    modal('Are you sure?', `<p>${message}</p><p class="muted">Turn assistance off with the button next to Home to disable these warnings.</p>`, [
      { label: 'Cancel', secondary: true, run: () => $('#modal').close() },
      { label: 'Swipe anyway', run: () => { $('#modal').close(); if (game === pendingGame && screen === 'game') move(direction, true); } }
    ]);
    return;
  }
  const result = game.move(direction);
  if (!result.changed) return;
  busy = true;
  recordBest(); saveGame(); updateGameUI();
  const nodes = new Map($$('.tile').map(el => [el.dataset.cell, el]));
  for (const motion of result.motions) {
    const el = nodes.get(motion.from.join(','));
    if (el) position(el, ...motion.to);
  }
  if (result.gained) {
    $('#score-gain').textContent = '+' + fmt(result.gained);
    $('#score-gain').classList.remove('animate'); void $('#score-gain').offsetWidth; $('#score-gain').classList.add('animate');
  }
  await delay(reduced.matches ? 0 : 110);
  renderBoard(result);
  busy = false;
  updateGameUI();
  $('#live-status').textContent = game.complete ? `Board complete! ${completionStats(game.size, game.score).percent}% of the maximum score.` : game.won && !game.winAcknowledged ? '2048 reached. You win! Tap the board to continue.' : `Score ${game.score}. New ${result.spawned.value} at row ${result.spawned.r + 1}, column ${result.spawned.c + 1}.`;
  if (game.over || (game.won && !game.winAcknowledged)) syncScores();
  drainInput();
}
function drainInput() {
  if (queuedUndos) { queuedUndos--; undo(); return; }
  const next = queued; queued = null;
  if (next) move(next);
}
async function undo() {
  if (!game?.canUndo || $('#modal').open) return;
  if (busy) {
    queued = null;
    queuedUndos = Math.min(queuedUndos + 1, game.mode === 'standard' ? 1 : game.history.length);
    updateGameUI();
    return;
  }
  const previous = game.history[game.history.length - 1];
  const motions = previous.direction ? moveBoard(previous.board, previous.direction).motions : null;
  if (!game.undo()) return;
  busy = true;
  queued = null;
  saveGame(); updateGameUI();
  if (motions && !reduced.matches) {
    const nodes = motions.map(m => tile(m.value, ...m.to));
    nodes.forEach(el => el.style.transition = 'none');
    $('#tiles').replaceChildren(...nodes);
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    nodes.forEach((el, i) => { el.style.transition = ''; position(el, ...motions[i].from); });
    await delay(110);
  }
  renderBoard(); busy = false; updateGameUI();
  $('#live-status').textContent = `Move undone. Score ${game.score}.`;
  drainInput();
}
function syncScores(force = false) {
  if (!leaderboard?.configured || !prefs.nickname || (!force && Date.now() - lastSync < 30000)) return Promise.resolve();
  lastSync = Date.now();
  return leaderboard.sync(structuredClone(records), prefs.nickname).catch(e => { if (screen === 'leaderboard') $('#ranking-status').textContent = friendlyError(e); });
}
function friendlyError(error) {
  const m = error.message || '';
  if (/PERMISSION_DENIED|Missing or insufficient/.test(m)) return 'The project needs the supplied Firestore rules. Your scores are safe on this phone.';
  if (/OPERATION_NOT_ALLOWED|ADMIN_ONLY/.test(m)) return 'Enable Anonymous sign-in in the Firebase project, then refresh.';
  if (/API_KEY|API key/.test(m)) return 'The Firebase Web API key was not accepted. Check the connection settings.';
  if (/Failed to fetch|NetworkError|network|offline/i.test(m) || !navigator.onLine) return 'You’re offline. Your high scores will sync when you reconnect.';
  return m.length < 200 ? m : 'Could not connect. Your scores are saved on this phone.';
}
function openLeaderboard() {
  if (busy) return;
  previousScreen = screen === 'game' ? 'game' : 'home';
  $('#ranking-size').value = String(game && screen === 'game' ? game.size : prefs.size);
  $('#ranking-mode').value = 'standard';
  showScreen('leaderboard');
  refreshRankings();
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => { if (!document.hidden && !$('#modal').open) refreshRankings(); }, 30000);
}
function showEmpty(title, description, connect = false) {
  $('#ranking-empty').hidden = false;
  $('#empty-title').textContent = title;
  $('#empty-description').textContent = description;
  $('#connect-button').hidden = !connect;
}
async function refreshRankings() {
  const request = ++rankingRequest;
  const size = Number($('#ranking-size').value), mode = $('#ranking-mode').value;
  const key = category(size, mode);
  $('#ranking-best').textContent = fmt(records[key]?.score || 0);
  $('#ranking-best-mode').textContent = `${size} × ${size} · ${mode === 'standard' ? 'Standard' : 'Unlimited'} · Saved on this phone`;
  $('#nickname-button').textContent = prefs.nickname ? prefs.nickname + ' ↗' : 'Set nickname ↗';
  $('#rankings').replaceChildren();
  $('#ranking-empty').hidden = true;
  $('#ranking-status').textContent = '';
  if (!leaderboard.configured) {
    showEmpty('Bring your friends along.', 'Your game and personal bests are ready. Connect the shared Firebase project once to see scores from other phones.', true);
    return;
  }
  if (!prefs.nickname) {
    showEmpty('Make a name for yourself.', 'Set a nickname above to share your high scores with friends.');
    return;
  }
  $('#ranking-status').textContent = 'Getting the latest scores…';
  try {
    await leaderboard.sync(structuredClone(records), prefs.nickname);
    const rows = await leaderboard.fetchBoard(key);
    if (request !== rankingRequest || screen !== 'leaderboard') return;
    await storage.write('ranking-cache-' + leaderboard.config.projectId + '-' + key, { rows, at: Date.now() });
    renderRankings(rows);
    $('#ranking-status').textContent = rows.length ? 'All-time scores · Updated just now' : '';
    if (!rows.length) showEmpty('The first move is yours.', 'No shared scores in this category yet. Play a game to set the first record.');
  } catch (e) {
    if (request !== rankingRequest || screen !== 'leaderboard') return;
    $('#ranking-status').textContent = friendlyError(e);
    const cached = await storage.read('ranking-cache-' + leaderboard.config.projectId + '-' + key);
    if (request !== rankingRequest || screen !== 'leaderboard') return;
    if (cached?.rows.length) { renderRankings(cached.rows); $('#ranking-status').textContent += ' Showing previously saved scores.'; }
    else showEmpty('Your next move can wait for no Wi-Fi.', 'Keep playing offline. Refresh here when your connection is back.');
  }
}
function renderRankings(rows) {
  $('#rankings').replaceChildren();
  let rank = 0, previousScore = -1;
  rows.forEach((row, i) => {
    if (exact(row.score) !== exact(previousScore)) rank = i + 1;
    previousScore = row.score;
    const li = document.createElement('li');
    const mine = row.uid === leaderboard.auth?.uid;
    if (mine) li.className = 'mine';
    const place = document.createElement('span'); place.className = 'rank-number'; place.textContent = String(rank).padStart(2, '0');
    const info = document.createElement('span'); info.className = 'player-info';
    const name = document.createElement('strong'); name.textContent = row.nickname + (mine ? ' (you)' : '');
    const max = document.createElement('small'); max.textContent = 'Best tile ' + fmt(row.maxTile); info.append(name, max);
    const score = document.createElement('span'); score.className = 'rank-score'; score.textContent = fmt(row.score);
    li.append(place, info, score); $('#rankings').append(li);
  });
}
function nicknameDialog() {
  modal('What should we call you?', '<p>Your nickname appears beside your scores. No email or password needed.</p><label>Nickname<input id="nickname-input" maxlength="20" autocomplete="nickname" placeholder="Your nickname"></label><p class="muted">This guest identity belongs to this app installation. Clearing app data or reinstalling creates a new identity.</p><p id="nickname-error" class="form-error" role="alert"></p>', [{ label: 'Save nickname', run: async () => {
    const value = $('#nickname-input').value.trim().replace(/\s+/g, ' ');
    if (!value || value.length > 20 || /[\u0000-\u001f\u007f]/.test(value)) { $('#nickname-error').textContent = 'Use 1–20 visible characters.'; return; }
    prefs.nickname = value; await storage.write('prefs', prefs); $('#modal').close(); refreshRankings();
  } }]);
  $('#nickname-input').value = prefs.nickname;
  $('#nickname-input').focus();
}
function connectDialog() {
  modal('Connect your shared board', '<p>Use the same Firebase project on each phone. The project owner must enable <strong>Anonymous sign-in</strong>, create <strong>Cloud Firestore</strong>, and publish the rules supplied with the app.</p><label>Project ID<input id="project-input" spellcheck="false" autocapitalize="none" placeholder="your-project-id"></label><label>Web API key<input id="key-input" spellcheck="false" autocapitalize="none" placeholder="AIza…"></label><p class="muted">Use the public app configuration only. Never enter a service-account private key.</p><p id="connect-error" class="form-error" role="alert"></p>', [{ label: 'Connect', run: async b => {
    b.disabled = true; b.textContent = 'Connecting…';
    try { await leaderboard.configure($('#project-input').value.trim(), $('#key-input').value.trim()); $('#modal').close(); if (!prefs.nickname) nicknameDialog(); else refreshRankings(); }
    catch (e) { $('#connect-error').textContent = friendlyError(e); }
    finally { b.disabled = false; b.textContent = 'Connect'; }
  } }]);
  $('#project-input').value = leaderboard.config?.projectId || '';
  $('#key-input').value = leaderboard.config?.apiKey || '';
}
function back() {
  if ($('#modal').open) { $('#modal').close(); return; }
  if (busy) return;
  if (screen === 'leaderboard') showScreen(previousScreen);
  else if (screen === 'game') { syncScores(true); showScreen('home'); }
  else window.AndroidHost?.exitApp();
}
function chooseSpawn(value) {
  if (!game || screen !== 'game' || $('#modal').open || game.nextTile === value) return;
  if (value === 4 && !game.fourWarningShown) {
    game.fourWarningShown = true;
    saveGame();
    queued = null;
    const pendingGame = game;
    modal('Switch to spawning 4?', `<p>${spawnExplanation}</p>`, [
      { label: 'Keep 2', secondary: true, run: () => $('#modal').close() },
      { label: 'Use 4', run: () => { $('#modal').close(); if (game === pendingGame) { game.setNextTile(4); saveGame(); updateGameUI(); } } }
    ]);
    return;
  }
  game.setNextTile(value); saveGame(); updateGameUI();
}
const actions = {
  start: () => { if (!busy) optionsDialog(true); }, resume: () => { if (busy || !games[prefs.size]) return; game = games[prefs.size]; saveGame(); buildCells(); showScreen('game'); },
  assistance: () => { if (!game || screen !== 'game') return; game.assisted = !game.assisted; saveGame(); updateGameUI(); $('#live-status').textContent = `Assistance ${game.assisted ? 'on' : 'off'}.`; },
  options: () => optionsDialog(),
  smaller: () => { prefs.size = Math.max(3, prefs.size - 1); updateHome(); savePrefs(); },
  larger: () => { prefs.size = Math.min(8, prefs.size + 1); updateHome(); savePrefs(); },
  home: () => { if (!busy) { syncScores(true); showScreen('home'); } },
  restart: () => { if (!busy) confirmNew(true); }, undo,
  'keep-playing': () => { game.winAcknowledged = true; saveGame(); updateGameUI(); },
  'view-completed': () => { completedView = game; updateGameUI(); },
  leaderboard: openLeaderboard, back, refresh: refreshRankings, nickname: nicknameDialog, connect: connectDialog,
  themes: () => { modal('Themes', '<div class="theme-options" role="group" aria-label="Colour theme">' + themeButtons() + '</div>'); applyTheme(prefs.theme); },
  'undo-info': () => modal('Room to rethink', '<p><strong>Standard:</strong> undo your last move once. Make a successful move before undoing again. Swiping without moving any tiles does not unlock undo.</p><p><strong>Unlimited:</strong> undo repeatedly, all the way to your opening board. Choose this mode before starting a new game.</p><p>Undo restores your board and score. Replaying samples a new spawn location. Your 2/4 switch stays where you set it. Personal bests and rankings are separate for the two modes.</p>'),
  help: () => modal('How to play', '<p>Swipe on the board or the empty space around it. Matching tiles merge, adding their new value to your score. A swipe takes effect as soon as its direction is clear.</p><p>' + spawnExplanation + '</p><p>Undo restores the board and score. Each board size keeps its own saved game. Choose a size on Home and tap Continue to return to it.</p>' + assistanceExplanation)
};
let assistPress = null, suppressAssistClick = false;
function clearAssistPress() { if (assistPress) clearTimeout(assistPress.timer); assistPress = null; }
$('#assistance-button').addEventListener('pointerdown', e => {
  if (e.button !== 0 || screen !== 'game' || $('#modal').open) return;
  clearAssistPress(); suppressAssistClick = false;
  const press = { id: e.pointerId, x: e.clientX, y: e.clientY };
  press.timer = setTimeout(() => {
    if (assistPress !== press || screen !== 'game' || $('#modal').open) return;
    suppressAssistClick = true; queued = null;
    modal('Assistance', assistanceExplanation);
  }, 500);
  assistPress = press;
});
document.addEventListener('pointermove', e => {
  if (assistPress?.id === e.pointerId && Math.hypot(e.clientX - assistPress.x, e.clientY - assistPress.y) > 12) {
    suppressAssistClick = true; clearAssistPress();
  }
});
for (const event of ['pointerup', 'pointercancel']) document.addEventListener(event, e => {
  if (assistPress?.id === e.pointerId) { if (event === 'pointercancel') suppressAssistClick = true; clearAssistPress(); }
});
$('#assistance-button').addEventListener('contextmenu', e => e.preventDefault());
$('#assistance-button').addEventListener('keydown', e => {
  if (e.key === 'F1' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); modal('Assistance', assistanceExplanation); }
});
// A quick second-finger press may never produce a click while a swipe is held.
// Accept every Undo pointer (including non-primary touches) as soon as it lands.
$$('[data-action="undo"]').forEach(button => button.addEventListener('pointerdown', e => {
  if (e.button !== 0 || e.currentTarget.disabled || screen !== 'game') return;
  undo();
}));
document.addEventListener('click', e => {
  const button = e.target.closest('button');
  if (!button || button.disabled) return;
  if (button.id === 'assistance-button' && suppressAssistClick) { suppressAssistClick = false; if (e.detail > 0 || e.pointerType) return; }
  // Pointer presses already ran Undo. Keep zero-detail keyboard/accessibility
  // activation, but never apply a physical press again through its click event.
  if (button.dataset.action === 'undo' && (e.detail > 0 || e.pointerType)) return;
  if (button.dataset.action) { actions[button.dataset.action]?.(); return; }
  if (button.dataset.theme) applyTheme(button.dataset.theme);
  if (button.dataset.spawn) chooseSpawn(Number(button.dataset.spawn));
});
$('#modal').addEventListener('click', e => { if (e.target === $('#modal')) { const r = $('#modal').getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) $('#modal').close(); } });
$('#modal form').addEventListener('submit', e => { if (e.submitter?.value !== 'cancel') e.preventDefault(); });
document.addEventListener('pointerdown', e => {
  if (screen !== 'game' || !e.isPrimary || e.button !== 0 || $('#modal').open || !$('#board-overlay').hidden || e.target.closest('button,input,select,dialog,a')) return;
  pointer = { x: e.clientX, y: e.clientY, id: e.pointerId, fired: false };
  $('#game-screen').setPointerCapture(e.pointerId);
});
function recognizeSwipe(e) {
  if (!pointer || pointer.id !== e.pointerId || pointer.fired) return;
  const dx = e.clientX - pointer.x, dy = e.clientY - pointer.y;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 18 || Math.max(Math.abs(dx), Math.abs(dy)) < Math.min(Math.abs(dx), Math.abs(dy)) * 1.15) return;
  pointer.fired = true;
  move(Math.abs(dx) > Math.abs(dy) ? dx > 0 ? 'right' : 'left' : dy > 0 ? 'down' : 'up');
}
document.addEventListener('pointermove', recognizeSwipe);
document.addEventListener('pointerup', e => {
  recognizeSwipe(e);
  if (pointer?.id === e.pointerId) pointer = null;
});
document.addEventListener('pointercancel', e => { if (pointer?.id === e.pointerId) pointer = null; });
document.addEventListener('lostpointercapture', e => { if (pointer?.id === e.pointerId) pointer = null; });
document.addEventListener('keydown', e => {
  if ($('#modal').open || ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
  const directions = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', a: 'left', d: 'right', w: 'up', s: 'down' };
  if (directions[e.key] && screen === 'game') { e.preventDefault(); move(directions[e.key]); }
  if (e.key === 'Escape') back();
  if (e.key.toLowerCase() === 'z' && screen === 'game') { e.preventDefault(); undo(); }
});
new ResizeObserver(() => { if (!busy && screen === 'game') { layoutBoard(); renderBoard(); fitScores(); } }).observe($('#board'));
$('#ranking-size').addEventListener('change', refreshRankings);
$('#ranking-mode').addEventListener('change', refreshRankings);
window.addEventListener('online', () => { syncScores(true).then(() => { if (screen === 'leaderboard') refreshRankings(); }); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { clearAssistPress(); pointer = null; queued = null; syncScores(true); } });
window.gameBack = back;
window.gamePause = () => { clearAssistPress(); pointer = null; queued = null; syncScores(true); };

async function init() {
  paintIcons();
  $('#completion-confetti').replaceChildren(...Array.from({ length: 24 }, (_, i) => {
    const piece = document.createElement('i');
    piece.style.setProperty('--x', `${(i * 43 % 100)}%`);
    piece.style.setProperty('--delay', `${(i % 8) * .08}s`);
    piece.style.setProperty('--spin', `${i % 2 ? 270 : -240}deg`);
    return piece;
  }));
  $('#ranking-size').innerHTML = [3, 4, 5, 6, 7, 8].map(n => `<option value="${n}">${n} × ${n}</option>`).join('');
  try {
    storage = await new Storage().open();
    prefs = { ...prefs, ...await storage.read('prefs') };
    if (![3, 4, 5, 6, 7, 8].includes(prefs.size)) prefs.size = 4;
    if (!['standard', 'unlimited'].includes(prefs.mode)) prefs.mode = 'standard';
    records = await storage.read('records') || {};
    game = Game.restore(await storage.loadGame());
    for (const size of [3, 4, 5, 6, 7, 8]) {
      const saved = Game.restore(await storage.loadGame(size));
      if (saved) games[size] = saved;
    }
    if (game) { game = games[game.size]; prefs.size = game.size; }
    leaderboard = await new Leaderboard(storage).init();
    $('.connection-link').hidden = leaderboard.configured;
    applyTheme(prefs.theme); updateHome();
    if (game) buildCells();
    syncScores(true);
    document.body.dataset.ready = 'true';
  } catch (e) {
    modal('Storage is unavailable', '<p>The app needs local storage to save games and undo history. Please free some device storage and reopen the app.</p>');
    console.error(e);
  }
}
init();
