// 루미큐브 룰 검증 엔진
//
// 용어:
//  - meld(멜드): 테이블에 놓인 하나의 조합. tiles 배열을 가짐.
//  - group(그룹/세트): 같은 숫자 + 서로 다른 색, 3~4개.
//  - run(런/연속): 같은 색 + 연속된 숫자, 3개 이상. (13 다음 1로 이어지지 않음)
//  - joker(조커): 어떤 타일이든 대체. 값은 대체한 타일의 숫자.
//
// board = Meld[] , Meld = { id, tiles: Tile[] }
// Tile = { id, color, num, joker }

import { MIN_NUM, MAX_NUM } from './tiles.js';

const INITIAL_MELD_MIN = 30; // 첫 등록(브레이크인) 최소 점수

// ---- 단일 멜드 검증 ----

// 그룹인지: 같은 숫자, 서로 다른 색, 3~4개
export function isGroup(tiles) {
  if (!Array.isArray(tiles)) return false;
  if (tiles.length < 3 || tiles.length > 4) return false;
  const reals = tiles.filter((t) => !t.joker);
  if (reals.length === 0) return false; // 최소 1개의 실제 타일 필요
  const num = reals[0].num;
  if (reals.some((t) => t.num !== num)) return false; // 숫자 모두 동일
  const colors = reals.map((t) => t.color);
  if (new Set(colors).size !== colors.length) return false; // 색 중복 불가
  return true;
}

// 런의 시작값 추정: 첫 실제 타일 기준, index i 위치의 값은 start + i. 전부 조커면 null.
function runStart(tiles) {
  for (let i = 0; i < tiles.length; i += 1) {
    if (!tiles[i].joker) return tiles[i].num - i;
  }
  return null;
}

// 런인지: 같은 색, 주어진 순서대로 연속 증가, 3개 이상, 1~13 범위, wrap 불가
export function isRun(tiles) {
  if (!Array.isArray(tiles)) return false;
  if (tiles.length < 3) return false;
  const reals = tiles.filter((t) => !t.joker);
  if (reals.length === 0) return false;
  const color = reals[0].color;
  if (reals.some((t) => t.color !== color)) return false; // 색 모두 동일

  const start = runStart(tiles);
  if (start === null) return false;
  // 범위 검사
  if (start < MIN_NUM) return false;
  if (start + tiles.length - 1 > MAX_NUM) return false;
  // 모든 실제 타일이 위치에 맞는 값인지
  for (let i = 0; i < tiles.length; i += 1) {
    const t = tiles[i];
    if (!t.joker && t.num !== start + i) return false;
  }
  return true;
}

export function isValidMeld(tiles) {
  return isGroup(tiles) || isRun(tiles);
}

// 멜드의 점수 합 (조커는 대체한 타일 값으로 계산) — 첫 등록 30점 계산용.
// 그룹이자 런으로 동시에 유효한 조커 멜드(예: [빨강9,조커,조커])는 더 높은 해석을 택한다.
export function meldValue(tiles) {
  let best = 0;
  if (isGroup(tiles)) {
    const reals = tiles.filter((t) => !t.joker);
    best = Math.max(best, reals[0].num * tiles.length); // 그룹은 모두 같은 숫자
  }
  if (isRun(tiles)) {
    const start = runStart(tiles);
    let sum = 0;
    for (let i = 0; i < tiles.length; i += 1) sum += start + i;
    best = Math.max(best, sum);
  }
  return best;
}

// 보드 전체가 유효한지: 모든 멜드가 유효
export function validateBoard(board) {
  for (const meld of board) {
    if (!meld.tiles || meld.tiles.length < 3 || !isValidMeld(meld.tiles)) {
      return { ok: false, invalidMeldId: meld.id };
    }
  }
  return { ok: true };
}

// 클라이언트가 보낸 board가 안전한 형태인지 (크래시 방지용 스키마 검증)
export function isBoardShape(board) {
  if (!Array.isArray(board)) return false;
  for (const meld of board) {
    if (!meld || typeof meld !== 'object') return false;
    if (!Array.isArray(meld.tiles)) return false;
    for (const t of meld.tiles) {
      if (!t || typeof t !== 'object' || typeof t.id !== 'string') return false;
    }
  }
  return true;
}

// ---- 유틸: 보드/멜드의 타일 id 모으기 (서버가 만든 신뢰 보드에만 사용) ----
function boardTileIds(board) {
  const ids = [];
  for (const meld of board) {
    for (const t of meld.tiles) ids.push(t.id);
  }
  return ids;
}

function meldKey(meld) {
  return meld.tiles
    .map((t) => t.id)
    .slice()
    .sort()
    .join(',');
}

// ---- 턴 커밋 검증 ----
// turnStartBoard: 이 턴 시작 시점(내가 손대기 전)의 확정 보드
// proposedBoard: 플레이어가 제출한 새 보드
// rack: 플레이어의 손패 (Tile[])
// brokeIn: 이미 첫 등록을 마쳤는지
//
// 반환: { ok, reason?, newRack?, board? }
//  board: 서버 권위 타일로 재구성된 보드 (game.js가 이걸 저장)
export function validateCommit({ turnStartBoard, proposedBoard, rack, brokeIn }) {
  // 0) 형태 검증 (크래시 방지 — 이후 로직은 안전한 board만 다룬다)
  if (!isBoardShape(proposedBoard)) {
    return { ok: false, reason: '보드 형식이 올바르지 않아.' };
  }

  const startIdSet = new Set(boardTileIds(turnStartBoard));
  const rackById = new Map(rack.map((t) => [t.id, t]));

  // 권위 타일 맵: id -> 원본 타일 (기존 테이블 + 내 손패).
  // 클라이언트가 보낸 color/num/joker 값은 신뢰하지 않고, id로 원본을 조회해 재구성한다.
  const authMap = new Map();
  for (const meld of turnStartBoard) {
    for (const t of meld.tiles) authMap.set(t.id, t);
  }
  for (const t of rack) authMap.set(t.id, t);

  const authBoard = [];
  const seen = new Set();
  const playedTileIds = [];
  for (const meld of proposedBoard) {
    const tiles = [];
    for (const t of meld.tiles) {
      const auth = authMap.get(t.id);
      if (!auth) {
        return { ok: false, reason: '내 손패나 테이블에 없는 타일이 포함됐어.' };
      }
      if (seen.has(t.id)) {
        return { ok: false, reason: '같은 타일이 중복으로 놓였어.' };
      }
      seen.add(t.id);
      // 원본 속성으로 복제 (클라 위조 방지)
      tiles.push({ id: auth.id, color: auth.color, num: auth.num, joker: auth.joker });
      if (!startIdSet.has(t.id)) playedTileIds.push(t.id); // 손패에서 새로 낸 타일
    }
    authBoard.push({ id: meld.id, tiles });
  }

  // 3) 테이블에 있던 타일은 손패로 되돌릴 수 없음 (전부 그대로 테이블에 남아야 함)
  for (const id of startIdSet) {
    if (!seen.has(id)) {
      return { ok: false, reason: '테이블에 있던 타일을 손패로 가져올 수 없어.' };
    }
  }

  // 4) 최소 1개는 손패에서 냈어야 함 (아니면 "뽑기"를 해야 함)
  if (playedTileIds.length === 0) {
    return { ok: false, reason: '손패에서 최소 한 장은 내야 해. (아니면 한 장 뽑기)' };
  }

  // 5) 보드 전체 유효성 (권위 타일 기준)
  const boardCheck = validateBoard(authBoard);
  if (!boardCheck.ok) {
    return { ok: false, reason: '유효하지 않은 조합이 있어.', invalidMeldId: boardCheck.invalidMeldId };
  }

  // 6) 첫 등록(브레이크인) 규칙
  if (!brokeIn) {
    // 기존 멜드는 손대지 못하고, 새 멜드는 손패 타일로만 구성 + 합 30점 이상
    const startMeldKeys = new Set(turnStartBoard.map(meldKey));
    const matchedStartKeys = new Set();
    let newMeldsValue = 0;

    for (const meld of authBoard) {
      const ids = meld.tiles.map((t) => t.id);
      const allFromTable = ids.every((id) => startIdSet.has(id));
      const allFromRack = ids.every((id) => rackById.has(id));

      if (allFromTable) {
        const key = meldKey(meld);
        if (!startMeldKeys.has(key)) {
          return { ok: false, reason: '첫 등록 때는 이미 놓인 조합을 건드릴 수 없어.' };
        }
        matchedStartKeys.add(key);
      } else if (allFromRack) {
        newMeldsValue += meldValue(meld.tiles);
      } else {
        return { ok: false, reason: '첫 등록 때는 기존 타일과 손패를 섞을 수 없어.' };
      }
    }

    // 기존 멜드가 하나라도 바뀌었으면(=매칭 안 됨) 거부
    if (matchedStartKeys.size !== startMeldKeys.size) {
      return { ok: false, reason: '첫 등록 때는 이미 놓인 조합을 그대로 둬야 해.' };
    }

    if (newMeldsValue < INITIAL_MELD_MIN) {
      return {
        ok: false,
        reason: `첫 등록은 ${INITIAL_MELD_MIN}점 이상이어야 해. (현재 ${newMeldsValue}점)`,
      };
    }
  }

  // 통과: 새 손패 계산
  const playedSet = new Set(playedTileIds);
  const newRack = rack.filter((t) => !playedSet.has(t.id));

  return { ok: true, newRack, board: authBoard };
}

export { INITIAL_MELD_MIN };
