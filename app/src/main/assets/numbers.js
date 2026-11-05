// Keep ordinary saves numeric; promote large counters to exact decimal strings.
// Tile values remain exact powers of two in binary Number representation.
export const exact = value => BigInt(value);
export const compactInteger = value => value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value.toString();
export const addInteger = (a, b) => compactInteger(exact(a) + exact(b));
export const formatInteger = value => exact(value).toLocaleString('en-US');
export const validInteger = value => (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
  || (typeof value === 'string' && /^(0|[1-9][0-9]{0,23})$/.test(value));
export function maximumScore(size) {
  const cells = BigInt(size * size);
  // OEIS A244056: 4 (n² - 1) (2^(n²) - 1), including the necessary 4 spawns.
  return 4n * (cells - 1n) * ((1n << cells) - 1n);
}
export const maximumTile = size => 2 ** (size * size + 1);
export function maximumConfiguration(board) {
  const tiles = board.flat().sort((a, b) => a - b);
  // The final unmerged spawn may be 2 or 4: both have exhausted all merges.
  return [2, 4].includes(tiles[0]) && tiles.slice(1).every((v, i) => v === 2 ** (i + 3));
}
export function completionStats(size, score) {
  const max = maximumScore(size), value = exact(score);
  const gap = max > value ? max - value : 0n;
  // Truncate rather than round: a score short of perfection must not read 100%.
  const hundredths = (value > max ? max : value) * 10000n / max;
  return { max: compactInteger(max), gap: compactInteger(gap), percent: `${hundredths / 100n}.${String(hundredths % 100n).padStart(2, '0')}` };
}
// Firestore orders strings after numbers. Large fixed-width decimal strings
// therefore follow ordinary scores and retain exact descending order.
export function integerField(value) {
  const n = exact(value);
  return n <= BigInt(Number.MAX_SAFE_INTEGER)
    ? { integerValue: n.toString() }
    : { stringValue: n.toString().padStart(24, '0') };
}
export const fieldInteger = field => compactInteger(BigInt(field?.integerValue ?? field?.stringValue ?? 0));
