// 타일 생성 유틸
// 표준 룰: 1~13 숫자 x 4색 x 2벌 + 조커 2개 = 106개 (1세트)
// 5인 이상: 2세트(212개, 조커 4개)로 자동 확장

export const COLORS = ['red', 'blue', 'black', 'orange'];
export const MIN_NUM = 1;
export const MAX_NUM = 13;

let _idCounter = 0;
function nextId(prefix) {
  _idCounter += 1;
  return `${prefix}${_idCounter}`;
}

// 한 벌(세트) 생성: 각 숫자/색 조합 2개씩 + 조커 2개
function buildOneSet(setIndex) {
  const tiles = [];
  for (let copy = 0; copy < 2; copy += 1) {
    for (const color of COLORS) {
      for (let num = MIN_NUM; num <= MAX_NUM; num += 1) {
        tiles.push({
          id: nextId(`t${setIndex}_`),
          color,
          num,
          joker: false,
        });
      }
    }
  }
  // 조커 2개
  for (let j = 0; j < 2; j += 1) {
    tiles.push({
      id: nextId(`j${setIndex}_`),
      color: null,
      num: null,
      joker: true,
    });
  }
  return tiles;
}

// playerCount 에 따라 세트 수 결정 (<=4: 1세트, 5~6: 2세트)
export function setCountForPlayers(playerCount) {
  return playerCount >= 5 ? 2 : 1;
}

export function buildPool(setCount) {
  const tiles = [];
  for (let s = 0; s < setCount; s += 1) {
    tiles.push(...buildOneSet(s));
  }
  return tiles;
}

// Fisher-Yates 셔플 (rng 주입 가능 — 테스트용)
export function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
