import { mockFirebase } from './mock-firebase.mjs';
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let playwright;
try { playwright = await import('playwright'); }
catch { playwright = createRequire(resolve(process.env.CODEX_NODE_MODULES || 'C:/Users/LENOVO/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json'))('playwright'); }
const browser = await playwright.chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const context = await browser.newContext({ viewport: { width: 393, height: 851 }, isMobile: true, hasTouch: true });
const page = await context.newPage();
await mockFirebase(page);
const touch = await context.newCDPSession(page);
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.route('https://game.test/**', async route => {
  const pathname = new URL(route.request().url()).pathname;
  const file = pathname === '/' ? 'index.html' : pathname.slice(1);
  try {
    await route.fulfill({ status: 200, contentType: file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html', body: await readFile(resolve(root, 'app/src/main/assets', file)) });
  } catch { await route.fulfill({ status: 404, body: '' }); }
});
const ready = async () => page.waitForSelector('body[data-ready="true"]');
const saved = () => page.evaluate(async () => { const { Storage } = await import('./storage.js'); const s = await new Storage().open(); const state = await s.loadGame(); s.db.close(); return state; });
const seed = async (board, mode = 'standard', score = 0, assisted = true) => {
  await page.evaluate(async ({ board, mode, score, assisted }) => {
    const { Storage } = await import('./storage.js'); const { Game } = await import('./engine.js');
    const s = await new Storage().open(); const g = new Game(board.length, mode, 2, Math.random, assisted);
    g.board = board; g.score = score; g.moves = 1;
    g.winAcknowledged = g.maxTile >= 2048;
    g.reached4096 = g.maxTile >= 4096;
    if (score) await s.write('records', { [`v1_${board.length}_${mode}`]: { score, maxTile: g.maxTile, at: Date.now() } });
    await s.saveGame(g, true); s.db.close();
  }, { board, mode, score, assisted });
  await page.reload(); await ready(); await page.locator('#resume-button').click(); await page.waitForTimeout(80);
};
async function key(key) { await page.keyboard.press(key); await page.waitForTimeout(260); }
async function noOverflow() { assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); }

try {
  await mkdir(resolve(root, 'build/previews'), { recursive: true });
  await page.goto('https://game.test/'); await ready();
  await noOverflow();
  await page.screenshot({ path: resolve(root, 'build/previews/home.png') });
  await page.locator('#start-button').click();
  assert.equal(await page.locator('#option-assistance').count(), 0);
  await page.locator('#modal-actions button').click(); await page.waitForTimeout(100);
  assert.equal(await page.locator('.tile').count(), 2);
  await page.screenshot({ path: resolve(root, 'build/previews/classic.png') });

  // A fixed board gives deterministic merge and undo expectations without exposing app internals.
  const base = [[2, 2, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  await seed(base);
  await page.locator('[data-spawn="4"]').click();
  if (await page.getByRole('button', { name: 'Use 4', exact: true }).isVisible()) await page.getByRole('button', { name: 'Use 4', exact: true }).click(); await key('ArrowLeft');
  assert.equal((await saved()).score, 4);
  assert.deepEqual((await saved()).board.flat().filter(Boolean).sort(), [4, 4]);
  await page.locator('#undo-button').click();
  await page.waitForTimeout(220);
  assert.deepEqual((await saved()).board, base);
  assert.equal((await saved()).nextTile, 4);
  assert.equal(await page.locator('#undo-button').isDisabled(), true);
  await key('ArrowUp');
  assert.equal(await page.locator('#undo-button').isDisabled(), true);
  await key('ArrowDown');
  assert.equal(await page.locator('#undo-button').isEnabled(), true);
  const resumeState = await saved();
  await page.reload(); await ready(); await page.locator('#resume-button').click(); await page.waitForTimeout(80);
  assert.deepEqual((await saved()).board, resumeState.board);
  assert.equal((await saved()).nextTile, 4);

  await seed(base, 'unlimited');
  for (const direction of ['ArrowLeft', 'ArrowDown', 'ArrowRight']) await key(direction);
  const undoCount = (await saved()).history.length;
  await page.reload(); await ready(); await page.locator('#resume-button').click(); await page.waitForTimeout(80);
  for (let i = 0; i < undoCount; i++) { await page.locator('#undo-button').click(); await page.waitForTimeout(220); }
  assert.deepEqual((await saved()).board, base);
  assert.equal(await page.locator('#undo-button').isDisabled(), true);

  // Top-row constraint after a swipe, not just in engine unit tests.
  await seed([[0, 0, 0, 0], [2, 4, 0, 8], [2, 4, 8, 16], [4, 8, 16, 32]]);
  await key('ArrowLeft');
  const restricted = await saved();
  assert.equal(restricted.board[0].filter(Boolean).length, 1);
  assert.equal(restricted.board[1][3], 0);

  // Capture the reference palettes on a populated game board.
  for (const theme of ['classic', 'forest', 'ocean', 'twilight']) {
    await page.locator('.game-toolbar [data-action="home"]').click();
    await page.locator('[data-action="themes"]').click();
    await page.locator(`#modal [data-theme="${theme}"]`).click();
    await page.locator('#modal button[value="cancel"]').click();
    await page.locator('#resume-button').click();
    await page.waitForTimeout(250);
    await page.screenshot({ path: resolve(root, `build/previews/${theme}.png`) });
    assert.equal(await page.locator('body').getAttribute('data-theme'), theme);
  }
  await page.reload(); await ready();
  assert.equal(await page.locator('body').getAttribute('data-theme'), 'twilight');

  // Every grid fits narrow and normal phones, with touch input and no horizontal overflow.
  for (const width of [320, 393, 480]) {
    await page.setViewportSize({ width, height: width === 320 ? 640 : 851 });
    for (const size of [3, 4, 5, 6, 7, 8]) {
      const b = Array.from({ length: size }, () => Array(size).fill(0)); b[0][0] = 2; b[0][1] = 2;
      await seed(b);
      await noOverflow();
      assert.equal(await page.locator('.cell').count(), size * size);
      const board = await page.locator('#board').boundingBox();
      const tilesFit = await page.locator('.tile').evaluateAll(nodes => nodes.every(el => el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight));
      assert.ok(tilesFit);
      await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: board.x + board.width * .2, y: board.y + board.height * .5 }] });
      await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: board.x + board.width * .8, y: board.y + board.height * .5 }] });
      assert.equal((await saved()).score, 4, 'move must register while the finger is still down');
      await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(260);
      assert.equal((await saved()).score, 4);
    }
  }

  await page.setViewportSize({ width: 393, height: 851 });
  await page.locator('.game-toolbar [data-action="home"]').click();
  await page.locator('#home-screen [data-action="leaderboard"]').click();
  assert.equal(await page.locator('#connect-button').isVisible(), false);
  assert.equal(await page.locator('.connection-link').isVisible(), false);
  assert.equal(await page.locator('#rankings li').count(), 0, 'never show fabricated scores');
  await page.locator('[data-action="nickname"]').click();
  await page.locator('#nickname-input').fill('Test Friend');
  await page.locator('#modal-actions button').click();
  await page.waitForFunction(() => document.querySelector('#nickname-button').textContent.includes('Test Friend'));
  assert.match(await page.locator('#nickname-button').textContent(), /Test Friend/);
  await page.screenshot({ path: resolve(root, 'build/previews/leaderboard.png') });
  // Fast input is serialized; closing and reopening preserves a valid board.
  await seed(base);
  for (const direction of ['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft']) await page.keyboard.press(direction);
  await page.waitForTimeout(600);
  assert.equal((await saved()).board.length, 4);
  assert.ok((await saved()).history.length <= 1);

  // The lower blank area accepts swipes, without waiting for release or repeating on hold.
  await seed(base);
  const below = await page.locator('#board').boundingBox();
  const y = below.y + below.height + 65;
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 70, y }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 180, y }] });
  assert.equal((await saved()).score, 4);
  const heldState = await saved();
  await page.waitForTimeout(250);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 280, y }] });
  assert.deepEqual(await saved(), heldState);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(150);
  assert.deepEqual(await saved(), heldState, 'release must not repeat the move');
  assert.equal(await page.evaluate(() => window.scrollY), 0);

  // Wide, short score boxes keep both score and best on one line at large values.
  for (const width of [320, 393, 480]) {
    await page.setViewportSize({ width, height: 851 });
    for (const score of [1000, 10000, 3430772, 2147483640]) {
      await seed(base, 'standard', score);
      for (const id of ['score', 'best']) {
        const metrics = await page.locator('#' + id).evaluate(el => ({ text: el.textContent, fits: el.scrollWidth <= el.clientWidth, height: el.getBoundingClientRect().height, box: el.parentElement.getBoundingClientRect().toJSON() }));
        assert.equal(metrics.text, score.toLocaleString('en-US'));
        assert.ok(metrics.fits, `${id} ${score} must fit at ${width}px`);
        assert.equal(metrics.height, 25);
        assert.equal(metrics.box.height, 48);
        assert.ok(metrics.box.width > metrics.box.height * 1.8);
      }
    }
  }
  await page.setViewportSize({ width: 393, height: 851 });
  await page.screenshot({ path: resolve(root, 'build/previews/large-score.png') });

  // Classic gives each high-tile tier its own colour instead of one shared charcoal.
  await seed([[4096,8192,16384,32768],[65536,131072,0,0],[0,0,0,0],[0,0,0,0]]);
  await page.evaluate(() => { document.body.dataset.theme = 'classic'; });
  const highTileColours = await page.locator('.tile.large').evaluateAll(nodes => nodes.map(el => ({ value: Number(el.dataset.value), colour: getComputedStyle(el).backgroundColor })));
  assert.deepEqual(highTileColours, [
    { value: 4096, colour: 'rgb(47, 113, 128)' },
    { value: 8192, colour: 'rgb(77, 95, 159)' },
    { value: 16384, colour: 'rgb(114, 82, 155)' },
    { value: 32768, colour: 'rgb(153, 79, 130)' },
    { value: 65536, colour: 'rgb(169, 87, 69)' },
    { value: 131072, colour: 'rgb(138, 103, 55)' }
  ]);

  // New-game settings are independent; assistance keeps the same record bucket.
  await page.locator('.game-toolbar [data-action="home"]').click();
  await page.locator('#start-button').click();
  await page.locator('#option-undo label').filter({ has: page.locator('input[value="unlimited"]') }).click();
  assert.equal(await page.locator('#option-assistance').count(), 0);
  await page.locator('#modal-actions button').click();
  await page.getByRole('button', { name: 'New game', exact: true }).click();
  await page.waitForTimeout(100);
  assert.equal((await saved()).assisted, false, 'new games start with assistance off');
  await page.locator('#assistance-button').click();
  assert.equal((await saved()).assisted, true);
  assert.equal((await saved()).mode, 'unlimited');
  await page.reload(); await ready(); await page.locator('#resume-button').click(); await page.waitForTimeout(80);
  assert.equal((await saved()).assisted, true);

  const corner = [[0,0,0,0],[0,0,0,0],[0,0,0,0],[4096,2048,4,2]];
  await seed(corner, 'standard', 10000, true);
  const beforeWarning = await saved();
  await key('ArrowUp');
  assert.equal(await page.locator('#modal-title').textContent(), 'Are you sure?');
  assert.match(await page.locator('#modal-body').textContent(), /button next to Home/);
  assert.deepEqual(await saved(), beforeWarning, 'warning itself must not mutate the game');
  await page.screenshot({ path: resolve(root, 'build/previews/corner-warning.png') });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.deepEqual(await saved(), beforeWarning);
  await key('ArrowUp');
  await page.getByRole('button', { name: 'Swipe anyway', exact: true }).click(); await page.waitForTimeout(150);
  assert.equal((await saved()).moves, beforeWarning.moves + 1);
  assert.equal((await saved()).history.length, 1);
  assert.equal(await page.locator('#modal').evaluate(el => el.open), false);
  await page.locator('#undo-button').click(); await page.waitForTimeout(220);
  assert.deepEqual((await saved()).board, corner);
  await page.reload(); await ready(); await page.locator('#resume-button').click(); await page.waitForTimeout(80);
  await key('ArrowUp'); assert.equal(await page.locator('#modal-title').textContent(), 'Are you sure?');
  await page.locator('#modal button[value="cancel"]').click();
  await seed(corner, 'standard', 10000, false);
  await key('ArrowUp');
  assert.equal(await page.locator('#modal').evaluate(el => el.open), false);
  assert.equal((await saved()).moves, 2);

  await seed([[0,0,0,0],[0,0,0,0],[0,0,0,0],[2048,1024,4,2]], 'standard', 4000, true);
  await key('ArrowUp');
  assert.equal(await page.locator('#modal').evaluate(el => el.open), true, 'moving 2048 now warns before the corner milestone');
  assert.match(await page.locator('#modal-body').textContent(), /without merging/);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();

  // Warning text must use the active grid's threshold, including after reload.
  for (const [size, threshold] of [[3,1024],[4,2048],[5,4096],[6,8192],[7,16384],[8,32768]]) {
    const board = Array.from({ length: size }, () => Array(size).fill(0));
    board[1][1] = threshold;
    await seed(board);
    const before = await saved();
    await key('ArrowLeft');
    assert.ok((await page.locator('#modal-body').textContent()).includes(`without merging any tiles of ${threshold.toLocaleString('en-US')} or higher`));
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.deepEqual(await saved(), before);
    await key('ArrowLeft');
    await page.getByRole('button', { name: 'Swipe anyway', exact: true }).click();
    await page.waitForTimeout(250);
    assert.equal((await saved()).moves, before.moves + 1);
  }

  // Reproduce the previously dropped undo: press within the same frame as a move.
  await seed(base);
  const beforeFastUndo = await saved();
  assert.equal(await page.evaluate(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    const b = document.querySelector('#undo-button');
    const enabled = !b.disabled; b.click(); b.click();
    return enabled;
  }), true, 'undo must accept a tap during a move animation');
  await page.waitForTimeout(420);
  const afterFastUndo = await saved();
  assert.deepEqual(afterFastUndo.board, beforeFastUndo.board);
  assert.equal(afterFastUndo.score, beforeFastUndo.score);
  assert.equal(afterFastUndo.moves, beforeFastUndo.moves);
  assert.equal(afterFastUndo.undoLocked, true);
  assert.equal(await page.locator('#undo-button').isDisabled(), true, 'standard mode still forbids consecutive undo');

  await seed(base, 'unlimited');
  for (const direction of ['ArrowLeft','ArrowDown','ArrowRight']) await key(direction);
  assert.equal((await saved()).history.length, 3);
  await page.evaluate(() => { const b = document.querySelector('#undo-button'); b.click(); b.click(); b.click(); });
  await page.waitForTimeout(700);
  assert.deepEqual((await saved()).board, base, 'rapid unlimited undo taps must all be retained');
  assert.equal((await saved()).history.length, 0);

  // The win treatment is a transparent, tappable board overlay, as in the reference.
  const nearWin = [[1024,1024,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]];
  await seed(nearWin, 'standard', 18000, false);
  await key('ArrowLeft'); await page.waitForTimeout(180);
  assert.equal(await page.locator('#win-overlay').getAttribute('aria-hidden'), 'false');
  assert.equal(await page.locator('#board-overlay').isVisible(), false);
  assert.equal(await page.locator('#win-overlay button').count(), 0);
  assert.equal(await page.locator('#win-overlay').evaluate(el => getComputedStyle(el).backdropFilter), 'none');
  assert.equal(await page.locator('#win-overlay').evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(12, 28, 26, 0.38)');
  const wonState = await saved();
  await page.screenshot({ path: resolve(root, 'build/previews/win-transition.png') });
  await page.locator('#win-overlay').click();
  const continued = await saved();
  assert.deepEqual(continued.board, wonState.board);
  assert.equal(continued.score, wonState.score);
  assert.equal(continued.history.length, wonState.history.length);
  assert.equal(continued.winAcknowledged, true);
  await key('ArrowDown');
  assert.equal((await saved()).moves, continued.moves + 1, 'play resumes during the fade-out');
  await page.reload(); await ready(); await page.locator('#resume-button').click(); await page.waitForTimeout(100);
  assert.equal(await page.locator('#win-overlay').getAttribute('aria-hidden'), 'true');

  // Safe-area insets reserve space for controls without shortening the background.
  await page.evaluate(() => { const s = document.documentElement.style; s.setProperty('--safe-top','30px'); s.setProperty('--safe-bottom','32px'); });
  await page.waitForTimeout(50);
  const safe = await page.evaluate(() => ({ body:document.body.getBoundingClientRect().toJSON(), board:document.querySelector('#board').getBoundingClientRect().toJSON(), title:document.querySelector('.score-header').getBoundingClientRect().toJSON(), height:innerHeight }));
  assert.equal(safe.body.bottom, safe.height);
  assert.ok(safe.title.top >= 30);
  assert.ok(safe.board.bottom <= safe.height - 32);
  for (const theme of ['classic','forest','ocean','twilight']) {
    await page.locator('.game-toolbar [data-action="home"]').click();
    await page.locator('[data-action="themes"]').click();
    await page.locator(`#modal [data-theme="${theme}"]`).click();
    await page.locator('#modal button[value="cancel"]').click();
    await page.locator('[data-action="options"]').click();
    assert.equal(await page.locator('#option-undo select,#option-assistance select').count(), 0);
    await page.locator('#option-undo label').filter({ has: page.locator('input[value="unlimited"]') }).click();
    assert.equal(await page.locator('#option-assistance').count(), 0);
    assert.equal(await page.locator('#option-undo input:checked').inputValue(), 'unlimited');
    await page.screenshot({ path: resolve(root, `build/previews/options-${theme}.png`) });
    await page.getByRole('button', { name:'Done', exact:true }).click();
    await page.locator('#resume-button').click(); await page.waitForTimeout(100);
    await page.screenshot({ path: resolve(root, `build/previews/edge-${theme}.png`) });
  }
  await page.evaluate(() => { const s = document.documentElement.style; s.removeProperty('--safe-top'); s.removeProperty('--safe-bottom'); });

  // Reduced motion still permits tap-to-continue without a blocking animation.
  await page.emulateMedia({ reducedMotion:'reduce' });
  await seed(nearWin, 'standard', 0, false); await key('ArrowLeft');
  assert.equal(await page.locator('#win-overlay').getAttribute('aria-hidden'), 'false');
  assert.equal(await page.locator('#win-overlay').evaluate(el => getComputedStyle(el).transitionDuration), '0s');
  await page.locator('#win-overlay').click();
  assert.equal((await saved()).winAcknowledged, true);

  assert.deepEqual(errors, []);
  console.log('UI checks passed: all themes/sizes, finger-down and below-board swipes, single-line scores, assistance/warnings, queued undo during slides, rapid unlimited undo, themed mode cards, edge-to-edge safe-area layout, translucent win/tap-to-continue, reduced motion, saves, and leaderboard.');
} finally { await browser.close(); }
