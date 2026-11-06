import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, moveBoard, spawnCells, isOver, category, largeTileThreshold } from '../app/src/main/assets/engine.js';

const empty = n => Array.from({ length: n }, () => Array(n).fill(0));
function fixture(board, mode = 'standard', random = () => 0) {
  const g = new Game(board.length, mode, 2, random, true);
  g.board = board.map(r => r.slice()); g.score = 0; g.history = []; return g;
}

test('merges only once per move, from the leading edge, with correct score', () => {
  for (const [input, output, gained] of [
    [[2, 2, 2, 2], [4, 4, 0, 0], 8],
    [[2, 2, 4, 0], [4, 4, 0, 0], 4],
    [[4, 4, 4, 0], [8, 4, 0, 0], 8],
    [[0, 2, 0, 2], [4, 0, 0, 0], 4],
    [[2, 4, 8, 16], [2, 4, 8, 16], 0]
  ]) {
    const b = empty(4); b[0] = input;
    const actual = moveBoard(b, 'left');
    assert.deepEqual(actual.board[0], output); assert.equal(actual.gained, gained);
    assert.deepEqual(b[0], input, 'input board must not be mutated');
  }
});
test('all four directions preserve leading-edge merge order', () => {
  const b = [[2, 0, 0], [2, 0, 0], [4, 0, 0]];
  assert.deepEqual(moveBoard(b, 'up').board, [[4, 0, 0], [4, 0, 0], [0, 0, 0]]);
  assert.deepEqual(moveBoard(b, 'down').board, [[0, 0, 0], [4, 0, 0], [4, 0, 0]]);
  assert.deepEqual(moveBoard([[2, 2, 4], [0, 0, 0], [0, 0, 0]], 'right').board[0], [0, 4, 4]);
});
test('4x4 restriction selects only empty opposite-row cells when that row is fully empty', () => {
  const b = [[0, 0, 0, 0], [2, 4, 8, 0], [4, 8, 16, 32], [64, 32, 16, 8]];
  assert.deepEqual(spawnCells(b, true), [[0, 0], [0, 1], [0, 2], [0, 3]]);
  for (let i = 0; i < 100; i++) {
    const g = fixture(b, 'standard', () => i / 100);
    assert.equal(g.spawn().r, 0);
  }
});
test('4x4 restriction is checked after movement and merging', () => {
  const g = fixture([[0, 0, 0, 0], [2, 4, 0, 8], [2, 4, 8, 16], [4, 8, 16, 32]], 'standard', () => .999);
  const r = g.move('left');
  assert.equal(r.changed, true); assert.equal(r.spawned.r, 0);
  assert.equal(g.board[1][3], 0);
});
test('full top row falls back to the single second-row empty cell', () => {
  assert.deepEqual(spawnCells([[2, 4, 8, 16], [4, 8, 16, 0], [8, 16, 32, 64], [16, 32, 64, 128]], true), [[1, 3]]);
});
test('no top-row restriction on other sizes or other occupancy patterns', () => {
  for (const n of [3, 5, 6, 7, 8]) {
    const b = Array.from({ length: n }, () => Array(n).fill(2)); b[0][0] = 0; b[1][n - 1] = 0;
    assert.deepEqual(spawnCells(b, true), [[0, 0], [1, n - 1]]);
  }
  const b = [[0, 2, 0, 4], [0, 4, 8, 0], [4, 8, 16, 32], [8, 16, 32, 64]];
  assert.equal(spawnCells(b, true).length, 4);
});

test('smart spawning follows all four edges and both corner orientations', () => {
  const rotate = b => b[0].map((_, c) => b.map(row => row[c]).reverse());
  for (const mirror of [false, true]) {
    let board = [[0, 0, 0, 0], [2, 4, 8, 0], [4, 8, 16, 32], [128, 64, 32, 16]];
    if (mirror) board = board.map(row => row.slice().reverse());
    for (let turn = 0; turn < 4; turn++) {
      const before = JSON.stringify(board);
      const expected = [];
      for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
        // Opposite edge rotates from top to right to bottom to left.
        const opposite = turn === 0 ? r === 0 : turn === 1 ? c === 3 : turn === 2 ? r === 3 : c === 0;
        if (opposite && !board[r][c]) expected.push([r, c]);
      }
      assert.deepEqual(spawnCells(board, true), expected, `mirror=${mirror}, rotation=${turn}`);
      for (const value of [2, 4]) for (const random of [0, .5, .999]) {
        const g = fixture(board, 'standard', () => random); g.setNextTile(value);
        const spawned = g.spawn();
        assert.ok(expected.some(([r, c]) => r === spawned.r && c === spawned.c));
        assert.equal(spawned.value, value);
      }
      assert.equal(spawnCells(board, false).length, 5);
      assert.equal(JSON.stringify(board), before);
      board = rotate(board);
    }
  }
});

test('smart spawning requires the corner pair and exact occupancy, but no milestone', () => {
  const base = [[0, 0, 0, 0], [2, 4, 8, 0], [4, 8, 16, 32], [128, 64, 32, 16]];
  assert.equal(spawnCells(base, true).length, 4, 'works below 4096');
  const noCorner = base.map(row => row.slice()); noCorner[2][1] = 256;
  assert.equal(spawnCells(noCorner, true).length, 5);
  const noPair = base.map(row => row.slice()); noPair[2][1] = 128; noPair[3][0] = 256;
  assert.equal(spawnCells(noPair, true).length, 5, 'runner-up must be adjacent');
  const incomplete = base.map(row => row.slice()); incomplete[2][1] = 0;
  assert.equal(spawnCells(incomplete, true).length, 6);
  const tied = base.map(row => row.slice()); tied[3][1] = 128;
  assert.equal(spawnCells(tied, true).length, 4, 'equal maxima count');
  const occupiedOpposite = base.map(row => row.slice()); occupiedOpposite[0][0] = 2;
  assert.equal(spawnCells(occupiedOpposite, true).length, 4, 'the opposite fourth row must be completely empty');
});
test('toggle controls every new tile and does not change existing tiles', () => {
  const g = fixture([[2, 2, 0], [0, 0, 0], [0, 0, 0]]);
  g.setNextTile(4); const r = g.move('right'); assert.equal(r.spawned.value, 4);
  const before = JSON.stringify(g.board); g.setNextTile(2); assert.equal(JSON.stringify(g.board), before);
  assert.equal(g.move('down').spawned.value, 2);
});
test('standard undo cannot be consecutive, no-op does not unlock it', () => {
  const g = fixture([[2, 2, 0], [0, 0, 0], [0, 0, 0]]);
  const before = g.board.map(r => r.slice());
  g.move('right'); assert.equal(g.score, 4); assert.equal(g.canUndo, true);
  assert.equal(g.undo(), true); assert.equal(g.score, 0); assert.deepEqual(g.board, before);
  assert.equal(g.undo(), false);
  assert.equal(g.move('up').changed, false); assert.equal(g.canUndo, false); assert.equal(g.history.length, 0);
  g.move('down'); assert.equal(g.canUndo, true);
});
test('unlimited undo restores every successful move through the opening board', () => {
  const g = new Game(8, 'unlimited', 2, () => .6); const opening = g.snapshot();
  for (let i = 0; i < 120; i++) g.move(['left', 'down', 'right', 'up'][i % 4]);
  const count = g.history.length; assert.ok(count > 100);
  for (let i = 0; i < count; i++) assert.equal(g.undo(), true);
  assert.deepEqual(g.snapshot(), opening); assert.equal(g.canUndo, false);
});
test('undo retains the switch and replay samples fresh randomness', () => {
  let next = 0;
  const g = fixture([[2, 2, 0], [0, 0, 0], [0, 0, 0]], 'standard', () => next);
  const first = g.move('right'); g.setNextTile(4); g.undo(); next = .99;
  const second = g.move('right');
  assert.equal(second.spawned.value, 4);
  assert.notDeepEqual([first.spawned.r, first.spawned.c], [second.spawned.r, second.spawned.c]);
});
test('invalid moves neither spawn nor change score or history', () => {
  const g = fixture([[2, 0, 0], [0, 0, 0], [0, 0, 0]]);
  const before = g.serialize(); assert.equal(g.move('left').changed, false); assert.equal(g.serialize(), before);
});
test('winning is detected and play can continue beyond 2048', () => {
  const g = fixture([[1024, 1024, 0], [0, 0, 0], [0, 0, 0]]);
  assert.equal(g.move('left').won, true); assert.equal(g.score, 2048);
  g.winAcknowledged = true; assert.equal(g.move('down').won, false);
});
test('game over requires no empty cells and no adjacent equal tiles', () => {
  assert.equal(isOver([[2, 4, 2], [4, 2, 4], [2, 4, 2]]), true);
  assert.equal(isOver([[2, 4, 2], [4, 2, 4], [2, 4, 4]]), false);
  assert.equal(isOver([[2, 4, 2], [4, 2, 4], [2, 4, 0]]), false);
});
test('saves preserve complete history, mode, switch and undo lock', () => {
  for (const mode of ['standard', 'unlimited']) {
    const g = fixture([[2, 2, 0], [0, 0, 0], [0, 0, 0]], mode);
    g.move('right'); g.move('down'); g.setNextTile(4); g.undo();
    const restored = Game.restore(g.serialize());
    assert.ok(restored); assert.equal(restored.serialize(), g.serialize());
    assert.equal(restored.canUndo, g.canUndo);
  }
  assert.equal(Game.restore('{invalid'), null);
  const bad = JSON.parse(new Game().serialize()); bad.board[0][0] = 3;
  assert.equal(Game.restore(bad), null);
});
test('all 12 score categories are distinct', () => {
  assert.equal(new Set([3, 4, 5, 6, 7, 8].flatMap(n => ['standard', 'unlimited'].map(m => category(n, m)))).size, 12);
});
test('random play preserves tile sum and score accounting on every size', () => {
  for (let size = 3; size <= 8; size++) {
    const g = new Game(size, 'unlimited');
    for (let i = 0; i < 300 && !g.over; i++) {
      const before = g.board.flat().reduce((a, b) => a + b, 0), score = g.score;
      g.setNextTile(i % 2 ? 4 : 2);
      const r = g.move(['left', 'down', 'right', 'up'][i % 4]);
      assert.equal(g.board.flat().reduce((a, b) => a + b, 0), before + (r.changed ? g.nextTile : 0));
      assert.equal(g.score, score + r.gained);
    }
  }
});

test('assistance is optional and does not change score category', () => {
  const board = [[0, 2, 0, 4], [2, 4, 8, 0], [4, 8, 16, 32], [8, 16, 32, 64]];
  assert.deepEqual(spawnCells(board, false), [[0, 0], [0, 2], [1, 3]]);
  const standard = new Game(4), assisted = new Game(4, 'standard', 2, Math.random, true);
  standard.board = board.map(r => r.slice()); standard.random = () => .999;
  assert.equal(standard.spawn().r, 1);
  assert.equal(standard.assisted, false);
  assert.equal(category(standard.size, standard.mode), category(assisted.size, assisted.mode));
});
test('corner warnings cover all corners and both adjacent orientations on all sizes', () => {
  for (const n of [3, 4, 5, 6, 7, 8]) {
    const last = n - 1;
    for (const [r, c] of [[0, 0], [0, last], [last, 0], [last, last]]) {
      for (const horizontal of [true, false]) {
        const g = new Game(n, 'standard', 2, Math.random, true);
        g.board = empty(n); g.board[r][c] = 4096;
        if (horizontal) g.board[r][c === 0 ? 1 : last - 1] = 2048;
        else g.board[r === 0 ? 1 : last - 1][c] = 2048;
        const dangerous = horizontal ? (r === 0 ? 'down' : 'up') : (c === 0 ? 'right' : 'left');
        for (const direction of ['up', 'down', 'left', 'right']) assert.equal(g.warningFor(direction)?.type === 'corner', direction === dangerous, `${n} ${r},${c} horizontal=${horizontal} ${direction}`);
      }
    }
  }
});
test('warning requires assistance, 4096 milestone, corner maximum and adjacent runner-up', () => {
  const g = fixture([[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [2048, 1024, 0, 0]]);
  assert.equal(g.warningFor('up').type, 'large-tile');
  g.board[3][0] = 4096; assert.ok(g.warningFor('up'));
  g.assisted = false; assert.equal(g.warningFor('up'), null);
  g.assisted = true; g.board[1][2] = 2048; assert.equal(g.warningFor('up').type, 'large-tile', 'adjacent tile is not the runner-up, but large tiles move');
  g.board[3][1] = 2048; assert.ok(g.warningFor('up'), 'ties for runner-up count');
  g.board[3][1] = 4096; assert.ok(g.warningFor('up'), 'two equal maxima count as the largest two tiles');
  g.board = [[2, 4, 8, 16], [4, 8, 16, 32], [8, 16, 32, 64], [4096, 2048, 64, 128]];
  assert.equal(g.warningFor('up'), null, 'no-op swipes do not prompt');
});
test('milestone and selected assistance survive undo and restore; old saves remain playable', () => {
  const g = fixture([[2048, 2048, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
  g.move('left'); assert.equal(g.reached4096, true); g.undo(); assert.equal(g.reached4096, true);
  const restored = Game.restore(g.serialize()); assert.equal(restored.reached4096, true); assert.equal(restored.assisted, true);
  const off = new Game(4, 'unlimited'); assert.equal(Game.restore(off.serialize()).assisted, false);
  const legacy = JSON.parse(g.serialize()); delete legacy.assisted; delete legacy.reached4096;
  const migrated = Game.restore(legacy); assert.ok(migrated); assert.equal(migrated.assisted, true); assert.deepEqual(migrated.board, g.board);
});

test('large-tile assistance uses size-dependent thresholds and input merge values', () => {
  for (const n of [3, 4, 5, 6, 7, 8]) {
    const threshold = [1024, 2048, 4096, 8192, 16384, 32768][n - 3];
    assert.equal(largeTileThreshold(n), threshold);
    for (const value of [threshold, threshold * 2, threshold * 4]) {
      const g = new Game(n, 'standard', 2, Math.random, true);
      g.board = empty(n); g.board[1][1] = value;
      for (const direction of ['left', 'right', 'up', 'down']) {
        const before = g.serialize();
        assert.equal(g.warningFor(direction)?.type, 'large-tile');
        assert.equal(g.warningFor(direction)?.threshold, threshold);
        assert.equal(g.serialize(), before, 'preview must not mutate game or history');
      }
      g.assisted = false; assert.equal(g.warningFor('left'), null);
    }
    const g = new Game(n, 'standard', 2, Math.random, true);
    g.board = empty(n); g.board[1][1] = threshold / 2;
    assert.equal(g.warningFor('left'), null, 'below threshold');
    g.board[1][1] = threshold;
    g.board[2][0] = threshold / 2; g.board[2][1] = threshold / 2;
    assert.equal(g.warningFor('left')?.type, 'large-tile', 'creating threshold does not exempt movement');
    g.board[2][0] = threshold; g.board[2][1] = threshold;
    assert.equal(g.warningFor('left'), null, 'merging threshold inputs exempts movement');
    g.board = empty(n); g.board[1][0] = threshold;
    assert.equal(g.warningFor('left'), null, 'stationary tile');
    assert.equal(Game.restore(g.serialize()).warningFor('right')?.threshold, threshold);
  }
  const g = fixture([[2048,0,0,0],[0,2,2,0],[0,0,0,0],[0,0,0,0]]);
  assert.equal(g.warningFor('left'), null, 'small tiles may move/merge while 2048 stays put');
  assert.equal(g.warningFor('up'), null, 'large tile stays in place');
  assert.equal(g.warningFor('right').type, 'large-tile', 'a small merge does not exempt a large move');
  g.board = [[0,2048,0,0],[1024,1024,0,0],[0,0,0,0],[0,0,0,0]];
  assert.equal(g.warningFor('left').type, 'large-tile', 'creating 2048 is not merging an existing 2048');
  g.board = [[0,8192,0,0],[2048,2048,0,0],[0,0,0,0],[0,0,0,0]];
  assert.equal(g.warningFor('left'), null, 'a large merge exempts other large tiles moving');
  g.board = [[2048,2048,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]];
  assert.equal(g.warningFor('left'), null);
  assert.equal(g.warningFor('up'), null, 'ineffective swipes never warn');
});

test('spawn warning is per game, persists on restore and is not rewound by undo', () => {
  const g = fixture([[2,2,0],[0,0,0],[0,0,0]], 'unlimited');
  assert.equal(g.fourWarningShown, false);
  g.move('right'); g.fourWarningShown = true; g.undo();
  assert.equal(g.fourWarningShown, true);
  assert.equal(Game.restore(g.serialize()).fourWarningShown, true);
  const legacy = JSON.parse(g.serialize()); delete legacy.fourWarningShown;
  assert.equal(Game.restore(legacy).fourWarningShown, false);
  assert.equal(new Game().fourWarningShown, false);
});
