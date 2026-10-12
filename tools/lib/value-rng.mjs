// Mulberry32: isolated from CLI worker entry points for import-safe data tools.
export function seededRng(seed) {
  let state = seed >>> 0;
  return { next() {
    state = (state + 0x6D2B79F5) >>> 0;
    let n = Math.imul(state ^ state >>> 15, 1 | state);
    n ^= n + Math.imul(n ^ n >>> 7, 61 | n);
    return ((n ^ n >>> 14) >>> 0) / 4294967296;
  } };
}
