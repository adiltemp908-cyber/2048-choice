import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../app/src/main/assets/engine.js';
import { exact, compactInteger, maximumScore, maximumTile, maximumConfiguration, completionStats, formatInteger, integerField, fieldInteger } from '../app/src/main/assets/numbers.js';

const expected = ['16352','3932100','3221225376','9620726742900','108086391056891712','4648579506574807006980'];
const boardFor = n => Array.from({length:n},(_,r)=>Array.from({length:n},(_,c)=>2 ** (n*n+1-r*n-c)));
test('maximum configurations and exact score bounds for all six grids', () => {
  for(let n=3;n<=8;n++) {
    assert.equal(maximumScore(n).toString(),expected[n-3]);
    const board=boardFor(n);
    assert.equal(board[0][0],maximumTile(n));
    assert.equal(maximumConfiguration(board),true);
    board[n-1][n-1]=2; assert.equal(maximumConfiguration(board),true,'final unmerged 2 is equivalent');
    board[n-1][n-2]=4; assert.equal(maximumConfiguration(board),false,'missing intermediate tile is not complete');
    board[n-1][n-2]=8; board[n-1][n-1]=0; assert.equal(maximumConfiguration(board),false,'largest tile alone is insufficient');
  }
});
test('last merge, score, save, reload and undo stay exact through 8x8 completion', () => {
  for(let n=3;n<=8;n++) for(const mode of ['standard','unlimited']) {
    const g=new Game(n,mode,4,()=>0);
    g.board=boardFor(n); g.board[n-1][n-2]=4;
    g.score=compactInteger(maximumScore(n)-8n); g.winAcknowledged=true;
    const before=g.snapshot();
    assert.equal(g.complete,false); assert.equal(g.over,false);
    g.move('left');
    assert.equal(g.complete,true); assert.equal(g.over,true);
    assert.equal(exact(g.score),maximumScore(n));
    const restored=Game.restore(g.serialize());
    assert.ok(restored); assert.equal(restored.complete,true);
    assert.equal(exact(restored.score),maximumScore(n));
    assert.equal(restored.undo(),true); assert.deepEqual(restored.snapshot(),before);
  }
});
test('score comparison never rounds a near-perfect result to 100 percent', () => {
  for(let n=3;n<=8;n++) {
    const perfect=completionStats(n,compactInteger(maximumScore(n)));
    assert.equal(perfect.percent,'100.00'); assert.equal(perfect.gap,0);
    const near=completionStats(n,compactInteger(maximumScore(n)-4n));
    assert.equal(near.gap,4); assert.notEqual(near.percent,'100.00');
  }
  assert.equal(formatInteger(maximumTile(8)),'36,893,488,147,419,103,232');
  assert.equal(formatInteger(maximumScore(8)),'4,648,579,506,574,807,006,980');
});
test('cloud encoding preserves exact values and sort order across precision boundaries', () => {
  for(const n of [4n,9007199254740988n,9007199254740992n,maximumScore(7),maximumScore(8)]) {
    assert.equal(exact(fieldInteger(integerField(n))),n);
  }
  assert.ok(integerField(maximumScore(8)-4n).stringValue < integerField(maximumScore(8)).stringValue);
  assert.equal(integerField(128).integerValue,'128');
});
