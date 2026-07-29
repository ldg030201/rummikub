// 타일 생성 유틸
// 표준 룰: 1~13 숫자 x 4색 x 2벌 + 조커 2개 = 106개 (1세트)
// 5인 이상: 2세트(212개, 조커 4개)로 자동 확장

export const COLORS = ['red', 'blue', 'black', 'orange'];
export const MIN_NUM = 1;
export const MAX_NUM = 13;

// 한 벌(세트) 생성: 각 숫자/색 조합 2개씩 + 조커 2개.
// id는 내용 기반이라 한 풀 안에서 결정적으로 유일하다 (게임 간 구분은 gameTag가 담당).
function buildOneSet(setIndex, gameTag) {
  const tiles = [];
  for (let copy = 0; copy < 2; copy += 1) {
    for (const color of COLORS) {
      for (let num = MIN_NUM; num <= MAX_NUM; num += 1) {
        tiles.push({
          id: `${gameTag}t${setIndex}_${copy}_${color}_${num}`,
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
      id: `${gameTag}j${setIndex}_${j}`,
      color: null,
      num: null,
      joker: true,
    });
  }
  return tiles;
}

export function buildPool(setCount) {
  // 게임마다 고유 태그: 서버 재시작으로 카운터가 리셋돼도 이전 판과 타일 id가 안 겹치게.
  // (id가 겹치면 클라 localStorage의 옛 손패 배치가 새 게임 타일에 그대로 적용되는 버그)
  const gameTag = `g${Math.random().toString(36).slice(2, 6)}_`;
  const tiles = [];
  for (let s = 0; s < setCount; s += 1) {
    tiles.push(...buildOneSet(s, gameTag));
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

// 실제로 쓸 타일 세트 수. 5인 이상은 1세트(106장)로는 못 하므로 설정과 무관하게 2세트를 강제한다.
// 서버(game.start)와 클라(대기실 안내)가 같은 답을 내야 해서 여기 한 곳에만 둔다 —
// 따로 구현했더니 5인 방에서 대기실은 '1세트(106장)'라고 안내하는데 서버는 212장을 쓰고 있었다.
export function effectiveSetCount(seatCount, setting = 'auto') {
  if (seatCount >= 5) return 2;
  return setting === 'auto' ? 1 : setting;
}
