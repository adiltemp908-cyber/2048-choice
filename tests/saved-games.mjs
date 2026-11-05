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
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.route('https://game.test/**', async route => {
  const file = new URL(route.request().url()).pathname.slice(1) || 'index.html';
  if (file === 'legacy') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Migration fixture</title>' });
  await route.fulfill({ status: 200, contentType: file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html', body: await readFile(resolve(root, 'app/src/main/assets', file)) });
});
const ready = () => page.waitForSelector('body[data-ready="true"]');
const saved = size => page.evaluate(async size => {
  const { Storage } = await import('./storage.js'); const s = await new Storage().open();
  const result = await s.loadGame(size); s.db.close(); return result;
}, size);
const key = async name => { await page.keyboard.press(name); await page.waitForTimeout(220); };
async function select(size) {
  if (await page.locator('#game-screen').isVisible()) await page.locator('.game-toolbar [data-action="home"]').click();
  let current = Number((await page.locator('#board-size-label').textContent()).split(' ')[0]);
  while (current !== size) { await page.locator(`[data-action="${current < size ? 'larger' : 'smaller'}"]`).click(); current += current < size ? 1 : -1; }
}
async function resume(size) { await select(size); await page.locator('#resume-button').click(); await page.waitForTimeout(80); }
async function reload() { await page.reload(); await ready(); }

try {
  await mkdir(resolve(root, 'build/previews'), { recursive: true });
  // Recreate the previous released IndexedDB schema, including unlimited history.
  await page.goto('https://game.test/legacy');
  const legacy = await page.evaluate(async () => {
    const { Game } = await import('./engine.js');
    const g = new Game(4, 'unlimited', 4, () => .4, true);
    for (const d of ['left','down','right','up']) g.move(d);
    const raw = JSON.parse(g.serialize());
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open('2048-choice', 1);
      r.onupgradeneeded = () => { r.result.createObjectStore('data'); r.result.createObjectStore('history'); };
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
    const { history, ...meta } = raw;
    const tx = db.transaction(['data', 'history'], 'readwrite');
    tx.objectStore('data').put(meta, 'game');
    tx.objectStore('data').put({ nickname: 'Saved player', theme: 'forest', size: 4, assisted: true }, 'prefs');
    tx.objectStore('data').put({ v1_4_unlimited: { score: 777, maxTile: 16 } }, 'records');
    history.forEach((h, i) => tx.objectStore('history').put(h, i));
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
    db.close(); return raw;
  });
  await page.goto('https://game.test/'); await ready();
  assert.deepEqual(await saved(4), legacy, 'upgrade preserves every field and every undo snapshot');
  assert.equal(await saved(3), null);
  await resume(4);
  assert.equal(await page.locator('#best').textContent(), '777');
  assert.equal(await page.locator('#assistance-button').getAttribute('aria-pressed'), 'true');
  const snapshots = { 4: legacy };
  for (const size of [3, 5, 6, 7, 8]) {
    await select(size);
    assert.equal(await page.locator('#resume-button').isVisible(), true);
    assert.equal(await page.locator('#resume-button').isDisabled(), true);
    await page.locator('#start-button').click();
    await page.locator('#option-undo label').filter({ has: page.locator('input[value="unlimited"]') }).click();
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    assert.equal(await page.locator('#modal').evaluate(el => el.open), false, 'a new size never asks to overwrite another size');
    assert.equal((await saved(size)).assisted, false, 'new game ignores legacy assistance preference');
    await key('ArrowLeft'); await key('ArrowDown'); await key('ArrowRight');
    await page.locator('[data-spawn="4"]').click();
  if (await page.getByRole('button', { name: 'Use 4', exact: true }).isVisible()) await page.getByRole('button', { name: 'Use 4', exact: true }).click();
    if (size % 2) await page.locator('#assistance-button').click();
    snapshots[size] = await saved(size);
    assert.equal(snapshots[size].size, size);
    assert.ok(snapshots[size].history.length >= 2);
    assert.deepEqual(await saved(4), legacy, 'other sizes leave the migrated save untouched');
  }
  await reload();
  for (const size of [3,4,5,6,7,8]) {
    await resume(size);
    assert.equal(await page.locator('.cell').count(), size * size);
    assert.deepEqual(await saved(), snapshots[size]);
    assert.equal(await page.locator('#assistance-button').getAttribute('aria-pressed'), String(snapshots[size].assisted));
  }
  // An undo removes history only in the currently selected slot.
  await resume(4); await page.locator('#undo-button').tap(); await page.waitForTimeout(250);
  assert.equal((await saved(4)).history.length, legacy.history.length - 1);
  assert.deepEqual((await saved(4)).board, legacy.history.at(-1).board);
  snapshots[4] = await saved(4);
  await resume(3); await page.locator('#assistance-button').tap();
  const toggled = (await saved(3)).assisted;
  await page.locator('#undo-button').tap(); await page.waitForTimeout(250);
  assert.equal((await saved(3)).assisted, toggled, 'undo does not revert assistance toggle');
  await reload(); await resume(3);
  assert.equal(await page.locator('#assistance-button').getAttribute('aria-pressed'), String(toggled));
  if (!toggled) await page.locator('#assistance-button').click();
  // Restart clears only the selected board's history; every other save is unchanged.
  await page.locator('[data-action="restart"]').click();
  await page.getByRole('button', { name: 'New game', exact: true }).click();
  assert.equal((await saved(3)).history.length, 0);
  assert.equal((await saved(3)).assisted, false, 'restart also starts with assistance off');
  for (const size of [4,5,6,7,8]) assert.deepEqual(await saved(size), snapshots[size]);

  // The actual game-over button must work for physical touches, mouse and keyboard.
  for (const mode of ['standard','unlimited']) {
    for (const input of ['touch','mouse','keyboard']) {
      const previous = await page.evaluate(async mode => {
        const { Storage } = await import('./storage.js'); const { Game } = await import('./engine.js');
        const s = await new Storage().open(); const g = new Game(3, mode);
        g.board = [[2,4,2],[4,2,4],[2,4,0]];
        const previous = { ...g.snapshot(), direction: 'right' };
        g.history = [previous]; g.board[2][2] = 2; g.moves = 1;
        await s.saveGame(g, true); s.db.close(); return previous;
      }, mode);
      await reload(); await resume(3);
      assert.equal(await page.locator('#board-overlay').isVisible(), true);
      if (input === 'touch') await page.locator('#overlay-undo').tap();
      else if (input === 'mouse') await page.locator('#overlay-undo').click();
      else { await page.locator('#overlay-undo').focus(); await page.keyboard.press('Enter'); }
      await page.waitForTimeout(250);
      assert.deepEqual((await saved(3)).board, previous.board, `${mode}: game-over Undo via ${input}`);
      assert.equal((await saved(3)).history.length, 0);
      assert.equal(await page.locator('#board-overlay').isVisible(), false);
    }
  }
  // New warning, cancellation, confirmation and an in-game off switch.
  await page.evaluate(async () => {
    const { Storage } = await import('./storage.js'); const { Game } = await import('./engine.js');
    const s = await new Storage().open(); const g = new Game(4, 'standard', 2, Math.random, true);
    g.board = [[2048,0,0,0],[0,2,2,0],[0,0,0,0],[0,0,0,0]];
    g.won = true; g.winAcknowledged = true;
    await s.saveGame(g, true); s.db.close();
  });
  await reload(); await resume(4);
  const before = await saved(4);
  await key('ArrowRight');
  assert.match(await page.locator('#modal-body').textContent(), /without merging/);
  assert.match(await page.locator('#modal-body').textContent(), /button next to Home/);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.deepEqual(await saved(4), before);
  await key('ArrowRight'); await page.getByRole('button', { name: 'Swipe anyway', exact: true }).click();
  await page.waitForTimeout(250);
  assert.equal((await saved(4)).moves, before.moves + 1);
  await page.locator('#undo-button').tap(); await page.waitForTimeout(250);
  await page.locator('#assistance-button').tap(); await key('ArrowRight');
  assert.equal(await page.locator('#modal').evaluate(el => el.open), false);
  assert.equal((await saved(4)).moves, before.moves + 1);
  for (const width of [320,393,480]) {
    await page.setViewportSize({ width, height: 851 });
    const boxes = await page.locator('.game-toolbar > *').evaluateAll(nodes => nodes.map(n => n.getBoundingClientRect().toJSON()));
    for (let i = 1; i < boxes.length; i++) assert.ok(boxes[i].left >= boxes[i-1].right, 'toolbar must not overlap');
    const board = await page.locator('#board').boundingBox();
    assert.ok(boxes.at(-1).right <= board.x + board.width + 1, 'toolbar stays within the board width');
  }
  await page.setViewportSize({ width:393, height:851 });
  await page.screenshot({ path: resolve(root, 'build/previews/assistance-toggle.png') });
  assert.deepEqual(errors, []);
  console.log('Passed: legacy migration, six concurrent saves and histories, isolated restart/undo, assistance toggle and warning, game-over Undo by touch/mouse/keyboard, toolbar layout.');
} finally { await browser.close(); }
