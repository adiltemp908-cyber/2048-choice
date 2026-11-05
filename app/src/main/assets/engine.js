import { addInteger, maximumConfiguration, maximumTile, validInteger } from './numbers.js';
export const RULES_VERSION = 1;
export const MODES = ['standard', 'unlimited'];
export const category = (size, mode) => `v${RULES_VERSION}_${size}_${mode}`;
const copy = board => board.map(row => row.slice());
export const largeTileThreshold = size => 2 ** (size + 7);

export function spawnCells(board, assisted = false) {
  const n = board.length;
  const empty = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (!board[r][c]) empty.push([r, c]);
  if (assisted && n === 4) {
    const protectedCells = new Set();
    for (const { edge } of cornerEdges(board)) {
      const pos = (depth, i) => edge === 'top' ? [depth, i] : edge === 'bottom' ? [n - 1 - depth, i] : edge === 'left' ? [i, depth] : [i, n - 1 - depth];
      const lines = [0, 1, 2].map(depth => Array.from({ length: n }, (_, i) => pos(depth, i)));
      if (lines[0].every(([r, c]) => board[r][c]) && lines[1].every(([r, c]) => board[r][c])
          && lines[2].filter(([r, c]) => board[r][c]).length === 3) {
        for (const [r, c] of lines[2]) if (!board[r][c]) protectedCells.add(`${r},${c}`);
      }
    }
    const allowed = empty.filter(([r, c]) => !protectedCells.has(`${r},${c}`));
    // A successful move must still spawn if the protected gap is the only space.
    if (allowed.length) return allowed;
  }
  return empty;
}

// Warn away from the edge shared by the corner maximum and its adjacent runner-up.
// Equal largest tiles count as the two largest physical tiles, not distinct values.
function cornerEdges(board) {
  const values = board.flat().filter(Boolean).sort((a, b) => b - a);
  if (values.length < 2) return [];
  const [highest, second] = values, last = board.length - 1;
  const edges = [];
  for (const [r, c] of [[0, 0], [0, last], [last, 0], [last, last]]) {
    if (board[r][c] !== highest) continue;
    const adjacentColumn = c === 0 ? 1 : last - 1;
    const adjacentRow = r === 0 ? 1 : last - 1;
    if (board[r][adjacentColumn] === second) edges.push({ highest, second, edge: r === 0 ? 'top' : 'bottom' });
    if (board[adjacentRow][c] === second) edges.push({ highest, second, edge: c === 0 ? 'left' : 'right' });
  }
  return edges;
}

export function cornerWarning(board, direction) {
  if (!moveBoard(board, direction).changed) return null;
  const away = { top: 'down', bottom: 'up', left: 'right', right: 'left' };
  return cornerEdges(board).find(({ edge }) => away[edge] === direction) ?? null;
}

export function moveBoard(board, direction) {
  if (!['left', 'right', 'up', 'down'].includes(direction)) throw new Error('Invalid direction');
  const n = board.length;
  const next = Array.from({ length: n }, () => Array(n).fill(0));
  const motions = [];
  let gained = 0;
  for (let line = 0; line < n; line++) {
    const pos = i => direction === 'left' ? [line, i] : direction === 'right' ? [line, n - 1 - i] : direction === 'up' ? [i, line] : [n - 1 - i, line];
    const tiles = [];
    for (let i = 0; i < n; i++) {
      const [r, c] = pos(i);
      if (board[r][c]) tiles.push({ value: board[r][c], from: [r, c] });
    }
    let dest = 0;
    for (let i = 0; i < tiles.length; i++) {
      const a = tiles[i];
      const to = pos(dest++);
      const merge = tiles[i + 1]?.value === a.value;
      const value = merge ? a.value * 2 : a.value;
      next[to[0]][to[1]] = value;
      motions.push({ from: a.from, to, value: a.value, merge });
      if (merge) {
        motions.push({ from: tiles[++i].from, to, value: a.value, merge: true });
        gained = addInteger(gained, value);
      }
    }
  }
  return { board: next, gained, motions, changed: board.some((row, r) => row.some((v, c) => v !== next[r][c])) };
}

export function isOver(board) {
  for (let r = 0; r < board.length; r++) for (let c = 0; c < board.length; c++) {
    if (!board[r][c] || (r + 1 < board.length && board[r][c] === board[r + 1][c]) || (c + 1 < board.length && board[r][c] === board[r][c + 1])) return false;
  }
  return true;
}

export class Game {
  constructor(size = 4, mode = 'standard', nextTile = 2, random = Math.random, assisted = false) {
    if (!Number.isInteger(size) || size < 3 || size > 8 || !MODES.includes(mode) || ![2, 4].includes(nextTile)) throw new Error('Invalid game settings');
    this.size = size;
    this.mode = mode;
    this.nextTile = nextTile;
    this.random = random;
    this.assisted = Boolean(assisted);
    this.reached4096 = false;
    this.fourWarningShown = false;
    this.board = Array.from({ length: size }, () => Array(size).fill(0));
    this.score = 0;
    this.moves = 0;
    this.history = [];
    this.undoLocked = false;
    this.won = false;
    this.winAcknowledged = false;
    this.spawn();
    this.spawn();
  }
  spawn() {
    const cells = spawnCells(this.board, this.assisted);
    if (!cells.length) return null;
    const [r, c] = cells[Math.min(cells.length - 1, Math.floor(this.random() * cells.length))];
    this.board[r][c] = this.nextTile;
    return { r, c, value: this.nextTile };
  }
  setNextTile(value) {
    if (![2, 4].includes(value)) throw new Error('Choose 2 or 4');
    this.nextTile = value;
  }
  get canUndo() { return this.history.length > 0 && (this.mode === 'unlimited' || !this.undoLocked); }
  get over() { return isOver(this.board); }
  get complete() { return maximumConfiguration(this.board); }
  get maxTile() { return Math.max(...this.board.flat()); }
  warningFor(direction) {
    if (!this.assisted) return null;
    const corner = (this.reached4096 || this.maxTile >= 4096) && cornerWarning(this.board, direction);
    if (corner) return { type: 'corner', ...corner };
    const result = moveBoard(this.board, direction);
    const threshold = largeTileThreshold(this.size);
    if (result.motions.some(m => m.value >= threshold && m.merge)) return null;
    const moved = result.motions.filter(m => m.value >= threshold && m.from.some((v, i) => v !== m.to[i]));
    return moved.length ? { type: 'large-tile', highest: Math.max(...moved.map(m => m.value)), threshold } : null;
  }
  snapshot() {
    return { board: copy(this.board), score: this.score, moves: this.moves, won: this.won, winAcknowledged: this.winAcknowledged };
  }
  move(direction) {
    const result = moveBoard(this.board, direction);
    if (!result.changed) return result;
    const before = this.snapshot();
    before.direction = direction;
    if (this.mode === 'standard') this.history = [before];
    else this.history.push(before);
    this.board = result.board;
    this.score = addInteger(this.score, result.gained);
    this.moves = addInteger(this.moves, 1);
    this.undoLocked = false;
    const spawned = this.spawn();
    this.won = this.maxTile >= 2048;
    this.reached4096 ||= this.maxTile >= 4096;
    return { ...result, board: copy(this.board), spawned, won: this.won && !this.winAcknowledged };
  }
  undo() {
    if (!this.canUndo) return false;
    const { direction, ...previous } = this.history.pop();
    Object.assign(this, previous);
    this.undoLocked = this.mode === 'standard';
    // Intentionally do not restore random state or the player's 2/4 switch.
    return true;
  }
  serialize() {
    return JSON.stringify({ version: RULES_VERSION, ...this.snapshot(), size: this.size, mode: this.mode, nextTile: this.nextTile, history: this.history, undoLocked: this.undoLocked, assisted: this.assisted, reached4096: this.reached4096, fourWarningShown: this.fourWarningShown });
  }
  static restore(raw, random = Math.random) {
    try {
      const d = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!d || d.version !== RULES_VERSION || !Number.isInteger(d.size) || d.size < 3 || d.size > 8 || !MODES.includes(d.mode) || ![2, 4].includes(d.nextTile)) return null;
      const validTile = v => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= maximumTile(d.size)
        && (v === 0 || (v >= 2 && (BigInt(v) & (BigInt(v) - 1n)) === 0n));
      const validBoard = b => Array.isArray(b) && b.length === d.size && b.every(row => Array.isArray(row) && row.length === d.size && row.every(validTile));
      const validSnapshot = s => s && validBoard(s.board) && validInteger(s.score) && validInteger(s.moves) && typeof s.won === 'boolean' && typeof s.winAcknowledged === 'boolean';
      if (!validSnapshot(d) || !Array.isArray(d.history) || !d.history.every(validSnapshot) || typeof d.undoLocked !== 'boolean' || (d.mode === 'standard' && d.history.length > 1)) return null;
      if (d.assisted !== undefined && typeof d.assisted !== 'boolean') return null;
      if (d.reached4096 !== undefined && typeof d.reached4096 !== 'boolean') return null;
      if (d.fourWarningShown !== undefined && typeof d.fourWarningShown !== 'boolean') return null;
      const game = Object.create(Game.prototype);
      // Version 1 saves used the spawning assistance unconditionally. Preserve that choice.
      const reached4096 = Boolean(d.reached4096) || [d, ...d.history].some(s => s.board.some(row => row.some(v => v >= 4096)));
      Object.assign(game, d, { random, assisted: d.assisted ?? true, reached4096, fourWarningShown: d.fourWarningShown ?? false });
      return game;
    } catch { return null; }
  }
}
