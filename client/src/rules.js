// 클라이언트용 룰 미러 (실시간 UI 피드백 전용 — 최종 판정은 서버가 함)
// 서버 server/src/rules.js 와 동일한 로직

const MIN_NUM = 1;
const MAX_NUM = 13;

export function isGroup(tiles) {
  if (tiles.length < 3 || tiles.length > 4) return false;
  const reals = tiles.filter((t) => !t.joker);
  if (reals.length === 0) return false;
  const num = reals[0].num;
  if (reals.some((t) => t.num !== num)) return false;
  const colors = reals.map((t) => t.color);
  if (new Set(colors).size !== colors.length) return false;
  return true;
}

export function isRun(tiles) {
  if (tiles.length < 3) return false;
  const reals = tiles.filter((t) => !t.joker);
  if (reals.length === 0) return false;
  const color = reals[0].color;
  if (reals.some((t) => t.color !== color)) return false;
  let start = null;
  for (let i = 0; i < tiles.length; i += 1) {
    if (!tiles[i].joker) {
      start = tiles[i].num - i;
      break;
    }
  }
  if (start === null) return false;
  if (start < MIN_NUM) return false;
  if (start + tiles.length - 1 > MAX_NUM) return false;
  for (let i = 0; i < tiles.length; i += 1) {
    const t = tiles[i];
    if (!t.joker && t.num !== start + i) return false;
  }
  return true;
}

export function isValidMeld(tiles) {
  return isGroup(tiles) || isRun(tiles);
}

export function meldValue(tiles) {
  let best = 0;
  if (isGroup(tiles)) {
    const reals = tiles.filter((t) => !t.joker);
    best = Math.max(best, reals[0].num * tiles.length);
  }
  if (isRun(tiles)) {
    let start = null;
    for (let i = 0; i < tiles.length; i += 1) {
      if (!tiles[i].joker) {
        start = tiles[i].num - i;
        break;
      }
    }
    let sum = 0;
    for (let i = 0; i < tiles.length; i += 1) sum += start + i;
    best = Math.max(best, sum);
  }
  return best;
}
