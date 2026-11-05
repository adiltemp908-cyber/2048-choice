import { mockFirebase } from './mock-firebase.mjs';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
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
  const file = new URL(route.request().url()).pathname.slice(1) || 'index.html';
  await route.fulfill({ status: 200, contentType: file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html', body: await readFile(resolve(root, 'app/src/main/assets', file)) });
});
const ready = () => page.waitForSelector('body[data-ready="true"]');
const base = [[2, 2, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
const saved = () => page.evaluate(async () => {
  const { Storage } = await import('./storage.js');
  const s = await new Storage().open(); const g = await s.loadGame(); s.db.close(); return g;
});
async function seed(mode = 'standard', moves = []) {
  await page.evaluate(async ({ board, mode, moves }) => {
    const { Storage } = await import('./storage.js'); const { Game } = await import('./engine.js');
    const s = await new Storage().open(); const g = new Game(4, mode, 2);
    g.board = board;
    await s.saveGame(g, true);
    for (const move of moves) { g.move(move); await s.saveGame(g); }
    s.db.close();
  }, { board: base, mode, moves });
  await page.reload(); await ready(); await page.locator('#resume-button').click();
  await page.waitForTimeout(80);
}
const send = (type, touchPoints) => touch.send('Input.dispatchTouchEvent', { type, touchPoints });
async function points() {
  const b = await page.locator('#board').boundingBox(); const u = await page.locator('#undo-button').boundingBox();
  return { start: { x: b.x + b.width * .8, y: b.y + b.height * .5, id: 1 }, end: { x: b.x + b.width * .2, y: b.y + b.height * .5, id: 1 }, undo: { x: u.x + u.width / 2, y: u.y + u.height / 2, id: 2 } };
}

try {
  await page.goto('https://game.test/'); await ready();
  // A second finger can tap Undo before the swiping finger lifts. Chromium delivers
  // pointer events for it, but no click: DOM .click() cannot reproduce this bug.
  for (const mode of ['standard', 'unlimited']) {
    for (const overlap of [true, false]) {
      await seed(mode);
      const p = await points();
      await send('touchStart', [p.start]); await send('touchMove', [p.end]);
      if (!overlap) await send('touchEnd', []);
      await send('touchStart', overlap ? [p.end, p.undo] : [p.undo]);
      await send('touchEnd', []);
      await page.waitForTimeout(400);
      assert.deepEqual((await saved()).board, base, `${mode}: immediate Undo must work with overlap=${overlap}`);
      assert.equal((await saved()).score, 0);
      assert.equal(await page.locator('#undo-button').isDisabled(), true);
    }
  }
  // One physical tap must undo exactly once, even when a compatibility click follows.
  await seed('unlimited', ['left', 'down', 'right']);
  const before = await saved(); const p = await points();
  await send('touchStart', [p.undo]); await send('touchEnd', []);
  await page.waitForTimeout(350);
  assert.equal((await saved()).history.length, before.history.length - 1);
  assert.deepEqual((await saved()).board, before.history.at(-1).board);
  // Keyboard activation and mouse activation must still work once per press.
  await page.locator('#undo-button').focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(350);
  assert.equal((await saved()).history.length, before.history.length - 2);
  await page.locator('#undo-button').click(); await page.waitForTimeout(350);
  assert.deepEqual((await saved()).board, base);
  assert.deepEqual(errors, []);
  console.log('Touch undo passed: overlapping touches, immediate taps, both modes, no double undo, keyboard and mouse.');
} finally { await browser.close(); }
