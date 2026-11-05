import { mockFirebase } from './mock-firebase.mjs';
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { maximumScore, formatInteger } from '../app/src/main/assets/numbers.js';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
let playwright;
try {playwright=await import('playwright');}
catch {playwright=createRequire(resolve(process.env.CODEX_NODE_MODULES||'C:/Users/LENOVO/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json'))('playwright');}
const browser=await playwright.chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const context=await browser.newContext({viewport:{width:393,height:851},isMobile:true,hasTouch:true});
const page=await context.newPage(); await mockFirebase(page);
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('https://game.test/**',async route=>{
 const f=new URL(route.request().url()).pathname.slice(1)||'index.html';
 await route.fulfill({contentType:f.endsWith('.js')?'application/javascript':f.endsWith('.css')?'text/css':'text/html',body:await readFile(resolve(root,'app/src/main/assets',f))});
});
const ready=()=>page.waitForSelector('body[data-ready="true"]');
const saved=()=>page.evaluate(async()=>{const {Storage}=await import('./storage.js');const s=await new Storage().open();const g=await s.loadGame();s.db.close();return g;});
async function seed(n, gap=0, near=true) {
 await page.evaluate(async({n,gap,near})=>{
  const {Game}=await import('./engine.js');const {Storage}=await import('./storage.js');const {maximumScore,compactInteger}=await import('./numbers.js');
  const g=new Game(n,'unlimited',4,()=>0);
  g.board=Array.from({length:n},(_,r)=>Array.from({length:n},(_,c)=>2**(n*n+1-r*n-c)));
  if(near)g.board[n-1][n-2]=4;
  g.score=compactInteger(maximumScore(n)-BigInt(gap)-(near?8n:0n));g.moves=100;g.winAcknowledged=true;
  const s=await new Storage().open();await s.saveGame(g,true);await s.write('prefs',{size:n,mode:'unlimited',theme:'forest'});s.db.close();
 },{n,gap,near});
 await page.reload();await ready();await page.locator('#resume-button').click();await page.waitForTimeout(80);
}
try {
 await mkdir(resolve(root,'build/previews'),{recursive:true});
 await page.goto('https://game.test/');await ready();
 await seed(4);
 await page.locator('.game-toolbar [data-action="home"]').click();await page.locator('#start-button').click();
 assert.equal(await page.locator('#option-undo input:checked').inputValue(),'standard','new game defaults to Standard even after Unlimited');
 await page.locator('#modal button[value="cancel"]').click();
 assert.equal((await saved()).mode,'unlimited','opening defaults must not alter the saved game');
 await page.locator('[data-action="leaderboard"]').click();
 assert.equal(await page.locator('#ranking-mode').inputValue(),'standard');
 await page.locator('#ranking-mode').selectOption('unlimited');await page.locator('[data-action="back"]').click();
 await page.locator('[data-action="leaderboard"]').click();assert.equal(await page.locator('#ranking-mode').inputValue(),'standard');
 for(const n of [3,4,5,6,7,8]) {
  await seed(n,20);
  const before=await saved();
  await page.keyboard.press('ArrowLeft');await page.waitForTimeout(300);
  assert.equal(await page.locator('#completion-overlay').isVisible(),true,`${n}: completion appears`);
  assert.equal(await page.locator('#board-overlay').isVisible(),false,`${n}: no game-over overlay`);
  assert.equal(await page.locator('#win-overlay').getAttribute('aria-hidden'),'true');
  assert.equal(await page.locator('#completion-max').textContent(),formatInteger(maximumScore(n)));
  assert.equal(await page.locator('#completion-score').textContent(),formatInteger(maximumScore(n)-20n));
  assert.equal(await page.locator('#completion-gap').textContent(),'20 points from perfect');
  for(const width of [320,393]) {
   await page.setViewportSize({width,height:851});await page.waitForTimeout(40);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   assert.equal(await page.locator('#completion-overlay').evaluate(e=>e.scrollHeight>e.clientHeight),false,'celebration fits the board');
   assert.equal(await page.locator('#score').evaluate(e=>e.scrollWidth>e.clientWidth),false,'large score header fits');
  }
  await page.screenshot({path:resolve(root,`build/previews/complete-${n}.png`)});
  const final=await saved();
  await page.getByRole('button',{name:'View board',exact:true}).click();
  assert.equal(await page.locator('#completion-overlay').isVisible(),false);
  assert.equal(await page.locator('.tile').evaluateAll(nodes=>nodes.every(e=>e.scrollWidth<=e.clientWidth)),true,'large tile labels fit');
  await page.keyboard.press('ArrowRight');assert.deepEqual(await saved(),final,'completed board cannot move');
  await page.reload();await ready();await page.locator('#resume-button').click();await page.waitForTimeout(80);
  assert.equal(await page.locator('#completion-overlay').isVisible(),true,'completed save remains viewable');
  assert.deepEqual(await saved(),final,'completed score and history survive reload');
  await page.locator('#undo-button').tap();await page.waitForTimeout(250);
  assert.equal(await page.locator('#completion-overlay').isVisible(),false);
  assert.deepEqual((await saved()).board,before.board);
  assert.equal((await saved()).score,before.score);
 }
 await page.emulateMedia({reducedMotion:'reduce'});await seed(8,0,false);
 assert.equal(await page.locator('#completion-gap').textContent(),'A perfect score!');
 assert.equal(await page.locator('#completion-percent').textContent(),'100.00% of the maximum');
 assert.equal(await page.locator('#completion-confetti').evaluate(e=>getComputedStyle(e).display),'none');
 assert.equal(await page.locator('#completion-overlay').evaluate(e=>getComputedStyle(e).animationName),'none');
 assert.deepEqual(errors,[]);
 console.log('Completion UI passed: Standard defaults, every size, exact scores and gaps, animation, reduced motion, narrow layouts, board viewing, save/reload and undo.');
}finally{await browser.close();}
