import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Tile from './Tile.jsx';
import { isValidMeld, meldValue, INITIAL_MELD_MIN } from '../rules.js';
import { ls, ss } from '../storage.js';
import { useSheet, useGridSnap } from './SheetGrid.jsx';

// 유틸
const clone = (v) =>
  typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v));

let meldSeed = 0;
const newMeldId = () => `m_${(meldSeed += 1)}_${Math.floor(Math.random() * 1e6)}`;

const COLOR_ORDER = { red: 0, orange: 1, blue: 2, black: 3 };

// 탭별 식별자 (같은 브라우저의 다른 탭이 손패 배치를 서로 덮어쓰지 않게).
// sessionStorage라 새로고침엔 유지되고 탭이 다르면 분리됨.
const TAB_ID = (() => {
  let id = ss.get('rk_tab');
  if (!id) {
    id = Math.random().toString(36).slice(2, 8);
    ss.set('rk_tab', id);
  }
  return id || 'tab';
})();

// ---- 손패 슬롯 배치 ----
// rackPos = { [tileId]: { r, c } } — 클라이언트 로컬, localStorage에 저장돼 유지됨
// 열 수(cols)는 화면 폭에 맞춰 정하고, 넘치는 타일은 아랫줄로 이어진다(가로 스크롤 없음).
// 그리드는 행 우선 1차원 인덱스로 다룬다: 밀림이 줄 끝에서 다음 줄로 자연스럽게 넘어감.
const MAX_ROWS = 40; // 저장된 배치 검증용 상한
const keyOf = (r, c) => `${r},${c}`;
const posOf = (i, cols) => ({ r: Math.floor(i / cols), c: i % cols });
const idxOf = (p, cols) => p.r * cols + p.c;

function loadRackPos(storageKey) {
  try {
    const p = JSON.parse(ls.get(storageKey) || 'null');
    if (p && typeof p === 'object') return p;
  } catch {
    /* noop */
  }
  return {};
}

function saveRackPos(storageKey, pos) {
  ls.set(storageKey, JSON.stringify(pos));
}

// 손패의 모든 타일이 유일한 슬롯을 갖도록 보정: 기존 위치 유지, 새 타일은 빈 슬롯, 없는 타일 제거
function reconcilePos(pos, hand, cols) {
  const next = {};
  const used = new Set();
  for (const t of hand) {
    const p = pos[t.id];
    if (
      p &&
      Number.isInteger(p.r) &&
      Number.isInteger(p.c) &&
      p.r >= 0 &&
      p.r < MAX_ROWS &&
      p.c >= 0 &&
      p.c < cols &&
      !used.has(keyOf(p.r, p.c))
    ) {
      next[t.id] = { r: p.r, c: p.c };
      used.add(keyOf(p.r, p.c));
    }
  }
  // 새 타일(첫 배분/뽑기)은 기존 배치를 건드리지 않게 마지막 타일 바로 뒤에 이어붙인다.
  // (빈틈 없이 이어야 reflowIfAutoPacked가 '자동 배치'로 인식해 폭 변화 시 다시 편다)
  const newTiles = hand.filter((t) => !next[t.id]);
  if (newTiles.length) {
    let maxIdx = -1;
    for (const id in next) {
      const i = idxOf(next[id], cols);
      if (i > maxIdx) maxIdx = i;
    }
    let i = maxIdx + 1;
    for (const t of newTiles) {
      let p = posOf(i, cols);
      while (used.has(keyOf(p.r, p.c))) {
        i += 1;
        p = posOf(i, cols);
      }
      next[t.id] = p;
      used.add(keyOf(p.r, p.c));
      i += 1;
    }
  }
  return next;
}

// 손패가 '자동 배치된 블록'(사용자가 손대지 않아 top-left에 빈틈 없이 채워진 상태)이고
// 현재 열 수보다 좁게 뭉쳐 있으면, 넓은 열 수에 맞춰 다시 편다.
// (초기 렌더에서 열 수가 좁게 측정돼 소수 열로 박제되는 문제 자가 치유. 사용자가 빈칸을
//  두고 배치한 경우엔 '연속 아님'으로 판정돼 그대로 보존된다.)
function reflowIfAutoPacked(pos, cols) {
  const ids = Object.keys(pos);
  if (!ids.length) return pos;
  let maxC = 0;
  for (const id of ids) if (pos[id].c > maxC) maxC = pos[id].c;
  const packCols = maxC + 1;
  if (packCols >= cols) return pos; // 이미 현재 폭을 다 씀 → 그대로
  // packCols 기준 선형 인덱스가 0..n-1로 빈틈 없이 연속인지(=자동 배치인지) 확인
  const idxs = ids.map((id) => pos[id].r * packCols + pos[id].c).sort((a, b) => a - b);
  for (let i = 0; i < idxs.length; i += 1) if (idxs[i] !== i) return pos; // 빈칸 있음(사용자 배치) → 보존
  // 읽기 순서(행→열) 유지하며 넓은 cols로 재배치
  const ordered = ids.slice().sort((a, b) => pos[a].r - pos[b].r || pos[a].c - pos[b].c);
  const next = {};
  ordered.forEach((id, k) => {
    next[id] = posOf(k, cols);
  });
  return next;
}

// 단일 타일을 슬롯에 놓기. 자리에 타일이 있으면 뒤로 한 칸씩 민다 (줄 끝이면 다음 줄로).
function placeAt(pos, tileId, r, c, cols) {
  const occupied = new Map();
  for (const [id, p] of Object.entries(pos)) {
    if (id !== tileId) occupied.set(idxOf(p, cols), id);
  }
  const next = { ...pos };
  const target = r * cols + c;
  if (!occupied.has(target)) {
    next[tileId] = { r, c };
    return next;
  }
  let free = target + 1;
  while (occupied.has(free)) free += 1;
  for (let i = free - 1; i >= target; i -= 1) {
    const id = occupied.get(i);
    if (id) next[id] = posOf(i + 1, cols);
  }
  next[tileId] = { r, c };
  return next;
}

// 블럭(타일 여러 개)을 순서 유지한 채 (r,c)에 놓기.
// 삽입 지점 이후의 타일들을 블럭 길이만큼 뒤로 민다 (텍스트 삽입과 같은 규칙).
function placeBlockAt(pos, ids, r, c, cols) {
  const idSet = new Set(ids);
  const len = ids.length;
  const start = r * cols + c;
  const next = {};
  for (const [id, p] of Object.entries(pos)) {
    if (idSet.has(id)) continue;
    const i = idxOf(p, cols);
    next[id] = i >= start ? posOf(i + len, cols) : { r: p.r, c: p.c };
  }
  ids.forEach((id, k) => {
    next[id] = posOf(start + k, cols);
  });
  return next;
}

// 블럭 단위 정렬: 색깔순(런 준비) 또는 숫자순(그룹 준비). 블럭 사이 한 칸 띄움.
function buildSortedPos(hand, mode, cols) {
  const jokers = hand.filter((t) => t.joker);
  const reals = hand.filter((t) => !t.joker);
  const blocks = [];
  if (mode === 'color') {
    const byColor = new Map();
    for (const t of reals) {
      if (!byColor.has(t.color)) byColor.set(t.color, []);
      byColor.get(t.color).push(t);
    }
    const colors = [...byColor.keys()].sort((a, b) => COLOR_ORDER[a] - COLOR_ORDER[b]);
    for (const col of colors) blocks.push(byColor.get(col).sort((a, b) => a.num - b.num));
  } else {
    const byNum = new Map();
    for (const t of reals) {
      if (!byNum.has(t.num)) byNum.set(t.num, []);
      byNum.get(t.num).push(t);
    }
    const nums = [...byNum.keys()].sort((a, b) => a - b);
    for (const n of nums)
      blocks.push(byNum.get(n).sort((a, b) => COLOR_ORDER[a.color] - COLOR_ORDER[b.color]));
  }
  if (jokers.length) blocks.push(jokers);

  // 블럭이 이 줄에 안 들어가면 다음 줄로 (한 줄보다 긴 블럭은 그냥 이어붙여 줄바꿈)
  const pos = {};
  let i = 0;
  for (const b of blocks) {
    const col = i % cols;
    if (col > 0 && col + b.length > cols && b.length <= cols) i += cols - col;
    for (const t of b) {
      pos[t.id] = posOf(i, cols);
      i += 1;
    }
    i += 1; // 블럭 사이 한 칸
  }
  return pos;
}

// 모으기: 현재 순서(줄 우선) 유지한 채 빈 칸 없이 앞에서부터 채움
function buildCompactPos(hand, pos, cols) {
  const ordered = hand
    .slice()
    .sort((a, b) => {
      const pa = pos[a.id] || { r: 99, c: 9999 };
      const pb = pos[b.id] || { r: 99, c: 9999 };
      return pa.r - pb.r || pa.c - pb.c;
    });
  const next = {};
  ordered.forEach((t, i) => {
    next[t.id] = posOf(i, cols);
  });
  return next;
}

// 드롭 위치(anchor) 계산: 멜드 안에서 커서 X 기준 어느 타일 앞에 넣을지
function getDropAnchor(containerEl, clientX) {
  const els = [...containerEl.querySelectorAll('[data-tileid]')];
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (clientX < r.left + r.width / 2) return el.dataset.tileid;
  }
  return null;
}

// draft 보드에서 타일 빼기. 빈 멜드는 제거.
function extractFromBoard(board, tileId) {
  for (let mi = 0; mi < board.length; mi += 1) {
    const m = board[mi];
    const ti = m.tiles.findIndex((t) => t.id === tileId);
    if (ti >= 0) {
      const tile = m.tiles.splice(ti, 1)[0];
      if (m.tiles.length === 0) board.splice(mi, 1);
      return tile;
    }
  }
  return null;
}

// ---- 보드 멜드 고정 배치 (주차장 모델) ----
// 실제 테이블처럼 한 번 놓인 조합은 제자리를 지킨다.
// meldId → {row, x}를 기억해두고(없어진 멜드 것도 유지 — 되돌리기로 살아나면 제자리 복귀),
// 자기 자리에 못 들어가게 됐을 때만 그 멜드 하나를 가까운 빈 자리로 옮긴다.
// 레이아웃 값(패딩·보더·간격·타일 폭)은 styles.css의 CSS 변수가 원본이고,
// boardMetrics(m)가 getComputedStyle로 읽어와 여기로 전달된다.
const meldW = (len, m) =>
  m.pad * 2 + m.border * 2 + len * m.tw + Math.max(0, len - 1) * m.tileGap;

function layoutMelds(board, posMap, m) {
  const { width, meldGap } = m;
  const rows = []; // rows[r] = 점유 구간 [x0,x1][]
  const fits = (r, x, w) => {
    if (x < 0 || x + w > width) return false;
    const iv = rows[r];
    return !iv || iv.every(([a, b]) => x + w + meldGap <= a || x >= b + meldGap);
  };
  const occupy = (r, x, w) => {
    (rows[r] ||= []).push([x, x + w]);
  };
  const firstFit = (w) => {
    for (let r = 0; ; r += 1) {
      if (!rows[r]) return { row: r, x: 0 }; // 빈 줄 (폭보다 긴 멜드도 여기 강제 배치)
      const cands = [0, ...rows[r].map(([, b]) => b + meldGap)].sort((a, b) => a - b);
      for (const x of cands) if (fits(r, x, w)) return { row: r, x };
    }
  };

  const stored = board.filter((m) => posMap.has(m.id));
  const fresh = board.filter((m) => !posMap.has(m.id));
  // 왼쪽·위쪽에 있던 멜드가 자리 우선권을 가짐
  stored.sort((a, b) => {
    const pa = posMap.get(a.id);
    const pb = posMap.get(b.id);
    return pa.row - pb.row || pa.x - pb.x;
  });

  const placed = new Map();
  const bumped = [];
  const step = m.tw + m.tileGap;
  for (const meld of stored) {
    const p = posMap.get(meld.id);
    const w = meldW(meld.tiles.length, m);
    let x = null;
    // 제자리 → 안 되면 좌우로 한두 칸 밀어서라도 근처 유지
    for (const cand of [p.x, p.x - step, p.x + step, p.x - step * 2, p.x + step * 2]) {
      if (fits(p.row, cand, w)) {
        x = cand;
        break;
      }
    }
    if (x != null) {
      occupy(p.row, x, w);
      placed.set(meld.id, { row: p.row, x });
    } else bumped.push(meld);
  }
  for (const meld of [...bumped, ...fresh]) {
    const w = meldW(meld.tiles.length, m);
    const spot = firstFit(w);
    occupy(spot.row, spot.x, w);
    placed.set(meld.id, spot);
  }

  let maxRow = -1;
  for (const { row } of placed.values()) if (row > maxRow) maxRow = row;
  const newSpot = firstFit(meldW(3, m)); // "+ 새 조합" 놓일 자리 (점유는 안 함)
  return { placed, rowCount: maxRow + 1, newSpot };
}

// 타일 뒷면 하나를 from→to로 날린다 (상대가 더미에서 뽑는 연출)
function flyTileBack(from, to) {
  const el = document.createElement('div');
  el.className = 'tile-back-fly';
  const w = 26;
  const h = 34;
  el.style.cssText =
    `position:fixed;z-index:40;pointer-events:none;width:${w}px;height:${h}px;` +
    `left:${from.left + from.width / 2 - w / 2}px;top:${from.top + from.height / 2 - h / 2}px;` +
    'transition:none;transform:none';
  document.body.appendChild(el);
  void el.offsetWidth;
  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);
  el.style.transition = 'transform 0.35s cubic-bezier(0.2, 0.8, 0.3, 1), opacity 0.35s ease';
  el.style.transform = `translate(${dx}px, ${dy}px) scale(0.6)`;
  el.style.opacity = '0.6';
  setTimeout(() => el.remove(), 380);
}

// 요소 크기에 반응하는 측정 훅 — 크기 변화마다 compute(el) 결과를 반환.
// 첫 값도 ResizeObserver 콜백(레이아웃 확정 후)에서 받는다. 동기 측정은 flex 폭이
// 확정되기 전에 실행돼 잘못된 값(예: 손패 열 수가 좁게)을 잡는 경우가 있어 쓰지 않는다.
function useMeasured(ref, compute) {
  const [value, setValue] = useState(null);
  const computeRef = useRef(compute);
  computeRef.current = compute; // 최신 compute를 쓰되 옵저버는 재구성하지 않는다
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const run = () => setValue(computeRef.current(el));
    run(); // 즉시 1회 측정 (옵저버 초기 콜백이 늦거나 안 오는 컨텍스트 대비)
    const ro = new ResizeObserver(run);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return value;
}

// 서버 시계 기준 마감시각을 로컬 시계로 환산 (시계 오차 보정).
// serverNow는 deadline이 갱신된 그 메시지에서 한 번만 읽는다 — 의존성에 넣으면
// 매 브로드캐스트(상대 draft 스트림 포함)마다 값이 새로 나와 타이머가 재생성된다.
// 엑셀 모드에선 App의 수식 입력줄도 이 값을 쓰므로 훅으로 뺐다 (state=null 허용).
export function useDeadlineLocal(state) {
  const playing = state?.phase === 'playing';
  const turnDeadline = state?.turnDeadline;
  const serverNow = state?.serverNow;
  return useMemo(() => {
    if (!playing || !turnDeadline || !serverNow) return null;
    return Date.now() + (turnDeadline - serverNow);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, turnDeadline]);
}

// 턴 카운트다운 — 0.5초 tick 리렌더를 이 작은 컴포넌트 안에 가둔다.
// (Game 본체에 두면 tick마다 전체 리렌더 + FLIP 위치 측정이 같이 돌아 낭비)
export function TurnTimer({ deadline }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [deadline]);
  const remainSec = Math.max(0, Math.ceil((deadline - now) / 1000));
  return (
    <span className={`turn-timer ${remainSec <= 10 ? 'low' : ''}`}>
      ⏱ {Math.floor(remainSec / 60)}:{String(remainSec % 60).padStart(2, '0')}
    </span>
  );
}

export default function Game({ state, me, actions, reject, nudged, excel }) {
  const t = (a, b) => (excel ? b : a); // 엑셀 모드 위장 카피
  const sheet = useSheet(); // 엑셀 시트 프레임(열 수·셀 크기·셀 영역 ref)
  const playing = state.phase === 'playing';
  const ended = state.phase === 'ended';
  const isMyTurn = playing && state.isMyTurn;

  // ---- 턴 제한시간 카운트다운 ----
  const deadlineLocal = useDeadlineLocal(state);

  // ---- 타일 이동 애니메이션 (FLIP) ----
  // 렌더마다 타일들의 화면 위치를 기억하고, 위치가 바뀌면 이전 위치→새 위치로 날아가게 한다.
  // 처음 보는 타일은 출처를 추정: 손패에 생기면 뽑기 더미에서, 보드에 생기면 현재 턴 좌석에서.
  const rootRef = useRef(null);
  const prevRectsRef = useRef(new Map()); // tileId -> DOMRect
  const skipFlipRef = useRef(new Set()); // 내가 방금 드롭한 타일은 제자리 등장이 자연스러움
  const firstFlipRef = useRef(true);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    // 위치는 앵커(손패는 랙 그리드, 그 외는 루트) 상대좌표로 저장한다.
    // 창/랙 스크롤로 뷰포트 좌표가 통째로 밀려도 오탐 비행이 안 생기게.
    const rackGrid = root.querySelector('.rack-grid');
    const rootRect = root.getBoundingClientRect();
    const rackRect = rackGrid ? rackGrid.getBoundingClientRect() : null;
    const anchorRect = (ax) => (ax === 'rack' ? rackRect : rootRect);

    const prev = prevRectsRef.current;
    const skip = skipFlipRef.current;
    const firstRun = firstFlipRef.current;
    // 보드 멜드는 폭 측정 후(두 번째 렌더부터) 그려지므로, 멜드가 실제로 DOM에
    // 나타난 렌더까지를 "첫 렌더"로 취급한다 (재접속 시 보드 전체가 좌석에서 날아오는 것 방지)
    const boardReady = board.length === 0 || !!root.querySelector('.meld');
    if (boardReady) firstFlipRef.current = false;
    skipFlipRef.current = new Set();

    const next = new Map();
    const moves = [];
    for (const el of root.querySelectorAll('[data-tileid]')) {
      const id = el.dataset.tileid;
      if (el._flying) {
        if (prev.has(id)) next.set(id, prev.get(id)); // 비행 중엔 도착지 좌표 유지
        continue;
      }
      const r = el.getBoundingClientRect();
      const inRack = rackGrid ? rackGrid.contains(el) : false;
      const ax = inRack ? 'rack' : 'root';
      const aRect = anchorRect(ax);
      if (!aRect) continue;
      next.set(id, { ax, left: r.left - aRect.left, top: r.top - aRect.top });
      if (skip.has(id)) continue;

      let fromLeft = null;
      let fromTop = null;
      const p = prev.get(id);
      if (p) {
        const pa = anchorRect(p.ax);
        if (!pa) continue;
        fromLeft = pa.left + p.left;
        fromTop = pa.top + p.top;
      } else {
        // 처음 보는 타일: 손패에 생기면 뽑기 더미에서, 보드에 생기면 현재 턴 좌석에서
        if (firstRun && !inRack) continue; // 재접속 직후 보드 전체가 날아오는 건 과함
        const src = inRack
          ? root.querySelector('.pool-stack')
          : root.querySelector(`[data-seatid="${state.currentPlayerId}"] .mini-fan`);
        if (!src) continue;
        const s = src.getBoundingClientRect();
        fromLeft = s.left + s.width / 2 - r.width / 2;
        fromTop = s.top + s.height / 2 - r.height / 2;
      }
      const dx = fromLeft - r.left;
      const dy = fromTop - r.top;
      // 호버 시 translateY(-4px) 들림이 이동으로 오판되면 타일이 계속 요동친다.
      // 실제 이동(슬롯 한 칸 34px+)보다 훨씬 작은 8px 미만 변화는 무시.
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) continue;
      moves.push([el, dx, dy, r]);
    }
    prevRectsRef.current = next;

    // 비행은 body 위 fixed 클론으로 한다. 제자리 transform 방식은
    // 손패의 overflow 클리핑에 잘리고(뽑기 비행이 안 보임), 원소 스타일 복원이
    // tile-in 애니메이션을 재시작시켜 깜빡임을 만들었음.
    if (moves.length) {
      const flights = [];
      for (const [el, dx, dy, r] of moves) {
        el._flying = true;
        const c = el.cloneNode(true);
        c.style.cssText =
          `position:fixed;left:${r.left}px;top:${r.top}px;` +
          `width:${r.width}px;height:${r.height}px;margin:0;z-index:40;` +
          `pointer-events:none;transition:none;animation:none;` +
          `transform:translate(${dx}px,${dy}px)`;
        document.body.appendChild(c);
        el.style.visibility = 'hidden'; // 도착지 실물은 비행 동안 숨김
        flights.push([el, c]);
      }
      // 강제 리플로우로 시작 위치를 확정한 뒤 같은 틱에 전환 시작.
      // (rAF는 백그라운드 탭에서 멈춰 타일이 출발 위치에 굳을 수 있음)
      void document.body.offsetWidth;
      for (const [, c] of flights) {
        c.style.transition = 'transform 0.3s cubic-bezier(0.2, 0.8, 0.3, 1)';
        c.style.transform = '';
      }
      setTimeout(() => {
        for (const [el, c] of flights) {
          c.remove();
          el._flying = false;
          el.style.visibility = '';
        }
      }, 310);
    }
  });

  // 상대 손패가 늘면(뽑기·시간초과 자동 뽑기) 더미→그 좌석으로 타일 뒷면 비행 연출
  const prevHandCountsRef = useRef(null);
  useEffect(() => {
    if (!playing) {
      prevHandCountsRef.current = null;
      return;
    }
    const prev = prevHandCountsRef.current;
    const next = {};
    for (const p of state.players) next[p.id] = p.handCount;
    prevHandCountsRef.current = next;
    if (!prev) return; // 첫 상태(입장/재접속)엔 연출 없음
    const root = rootRef.current;
    const src = root?.querySelector('.pool-stack');
    if (!src) return;
    for (const p of state.players) {
      if (p.id === me.playerId) continue; // 내 뽑기는 손패 비행으로 이미 보임
      const before = prev[p.id];
      if (before != null && p.handCount > before) {
        const seat = root.querySelector(`[data-seatid="${p.id}"] .mini-fan`);
        if (seat) flyTileBack(src.getBoundingClientRect(), seat.getBoundingClientRect());
      }
    }
  }, [playing, state, me.playerId]);

  // 재촉받으면 화면 테두리 펄스 (서버가 턴 플레이어에게만 보냄)
  const [nudgeFx, setNudgeFx] = useState(null);
  useEffect(() => {
    // 리마운트 시 이전 게임의 낡은 재촉으로 번쩍이지 않게 3초 이내 것만
    if (!nudged || Date.now() - nudged.ts > 3000) return undefined;
    setNudgeFx(nudged.ts);
    const t = setTimeout(() => setNudgeFx(null), 1300);
    return () => clearTimeout(t);
  }, [nudged]);

  const [draftBoard, setDraftBoard] = useState(null);
  const [overTarget, setOverTarget] = useState(null); // 멜드 하이라이트
  const [overSlot, setOverSlot] = useState(null); // 슬롯 하이라이트
  const dragRef = useRef(null); // { ids: string[], from: 'rack'|'board' }

  const myHand = useMemo(
    () => (Array.isArray(state.myHand) ? state.myHand : []),
    [state.myHand]
  );

  // ---- 손패 슬롯 배치 (항상 편집 가능, localStorage 유지) ----
  const storageKey = `rk_rack_${state.roomId}_${me.name}_${TAB_ID}`;
  const [rackPos, setRackPos] = useState(() => loadRackPos(storageKey));
  const handKey = useMemo(() => myHand.map((t) => t.id).sort().join(','), [myHand]);

  // 열 수를 컨테이너 폭에 맞춘다 (가로 스크롤 대신 아랫줄로 넘김 + 세로 스크롤).
  // 간격·패딩은 .rack-grid의 계산된 스타일에서 직접 읽는다 — CSS가 유일한 원본.
  const rackScrollRef = useRef(null);
  const rackCols =
    useMeasured(rackScrollRef, (el) => {
      const slotW = parseFloat(getComputedStyle(el).getPropertyValue('--slot-w')) || 46;
      const grid = el.querySelector('.rack-grid');
      const gcs = grid ? getComputedStyle(grid) : null;
      const gap = gcs ? parseFloat(gcs.columnGap) || 0 : 5;
      const padX = gcs
        ? (parseFloat(gcs.paddingLeft) || 0) + (parseFloat(gcs.paddingRight) || 0)
        : 16;
      const inner = el.clientWidth - padX;
      // 폭이 아직 0/음수로 측정되면(초기 렌더 레이스) 좁은 4열로 뭉치지 않게 넉넉한 기본값.
      // 실제 폭이 잡히면 ResizeObserver가 재측정하고, reflowIfAutoPacked가 폭에 맞춰 다시 편다.
      if (inner <= slotW) return 14;
      return Math.max(4, Math.floor((inner + gap) / (slotW + gap)));
    }) ?? 14;

  // 엑셀 모드: 손패 셀을 시트 셀 영역(sheet-body) 격자에 스냅
  const rackSnap = useGridSnap(rackScrollRef, excel, sheet.bodyRef);
  // 액션 버튼(저장/실행취소)·정렬 버튼도 '병합된 셀'처럼 격자에 딱 맞게.
  // 측정은 바깥 껍데기, 이동은 안쪽 래퍼 (위 불변조건 참고).
  const actionColRef = useRef(null);
  const actionSnap = useGridSnap(actionColRef, excel, sheet.bodyRef);
  const sortBtnsRef = useRef(null);
  const sortSnap = useGridSnap(sortBtnsRef, excel, sheet.bodyRef);

  useEffect(() => {
    setRackPos((p) => reflowIfAutoPacked(reconcilePos(p, myHand, rackCols), rackCols));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handKey, rackCols]);

  useEffect(() => {
    saveRackPos(storageKey, rackPos);
  }, [storageKey, rackPos]);

  // 내 턴 진입 시 draft 초기화. "draft가 없다"는 사실 자체가 턴 진입 직후라는 뜻이라
  // 별도 플래그 없이 턴 중엔 유지되고, 턴이 끝나면 비운다.
  useEffect(() => {
    if (!playing || !isMyTurn) {
      setDraftBoard(null);
      return;
    }
    setDraftBoard((d) => d ?? clone(Array.isArray(state.board) ? state.board : []));
  }, [playing, isMyTurn, state]);

  // 렌더링할 보드 (방어적으로 형태 필터)
  const rawBoard = isMyTurn && draftBoard ? draftBoard : state.board;
  const board = Array.isArray(rawBoard) ? rawBoard.filter((m) => m && Array.isArray(m.tiles)) : [];

  // ---- 보드 고정 배치: 폭 측정 + 멜드 자리 계산 ----
  const meldsRef = useRef(null);
  const meldPosRef = useRef(new Map()); // meldId -> {row, x} (게임 내내 유지)
  const boardMetrics = useMeasured(meldsRef, (el) => {
    // 엑셀 모드: 멜드를 시트 셀 격자에 앉힌다 — 타일=1셀, 멜드 간격=1셀, 행 피치=2셀.
    // 그러면 layoutMelds가 셀 배수 좌표를 내고, 멜드가 배경 셀 위에 '범위 선택'처럼 포개진다.
    if (excel) {
      const cw = sheet.cellW || 48;
      const ch = sheet.cellH || 36;
      const usableCols = Math.max(3, Math.floor(el.clientWidth / cw) - 2); // 우측 2열은 뽑기 더미
      return {
        width: usableCols * cw,
        tw: cw,
        pad: 0,
        border: 1,
        tileGap: 0,
        meldGap: cw, // 멜드 사이 1셀
        meldH: ch,
        rowH: ch * 2, // 멜드 한 줄 = 2셀(값 셀 + 빈 셀)
      };
    }
    // 기본 테마: styles.css의 CSS 변수 그대로
    const cs = getComputedStyle(el);
    const cssPx = (name, fallback) => {
      const v = parseFloat(cs.getPropertyValue(name));
      return Number.isNaN(v) ? fallback : v;
    };
    const tw = cssPx('--btile-w', 36);
    const th = cssPx('--btile-h', 48);
    const pad = cssPx('--meld-pad', 6);
    const border = cssPx('--meld-border', 2);
    const tileGap = cssPx('--meld-tile-gap', 3);
    const meldGap = cssPx('--meld-gap', 10);
    const meldH = th + pad * 2 + border * 2;
    return {
      // 오른쪽 아래 뽑기 더미 자리만큼 빼고 씀
      width: Math.max(140, el.clientWidth - 70),
      tw,
      pad,
      border,
      tileGap,
      meldGap,
      meldH,
      rowH: meldH + meldGap,
    };
  });

  // 엑셀 모드: 보드(멜드 영역)도 시트 격자에 스냅
  // 측정은 .melds(제자리), 스냅 이동은 .melds-inner — 불변조건(SheetGrid.jsx) 준수
  const meldsSnap = useGridSnap(meldsRef, excel, sheet.bodyRef);
  const meldsInnerRef = useRef(null);

  const boardLayout = useMemo(() => {
    if (!boardMetrics) return null;
    return layoutMelds(board, meldPosRef.current, boardMetrics);
    // board는 매 렌더 새 배열이지만 layoutMelds가 결정적이라 재계산 비용만 있고 결과는 안정적
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawBoard, boardMetrics]);

  // 계산된 자리를 기억 (없어진 멜드 것도 남겨둠 — 되돌리기 시 제자리 복귀)
  useEffect(() => {
    if (!boardLayout) return;
    for (const [id, p] of boardLayout.placed) meldPosRef.current.set(id, p);
  }, [boardLayout]);

  // draft 보드에 올라간 내 손패 타일 (손패에서 숨김, 슬롯은 예약 유지)
  const hiddenIds = useMemo(() => {
    if (!isMyTurn || !draftBoard) return new Set();
    const handIds = new Set(myHand.map((t) => t.id));
    const s = new Set();
    for (const m of draftBoard) {
      for (const t of m.tiles || []) if (handIds.has(t.id)) s.add(t.id);
    }
    return s;
  }, [isMyTurn, draftBoard, myHand]);

  const visibleRack = useMemo(
    () => myHand.filter((t) => !hiddenIds.has(t.id)),
    [myHand, hiddenIds]
  );

  // 슬롯 그리드 (보이는 타일만)
  const grid = useMemo(() => {
    const m = new Map();
    for (const t of visibleRack) {
      const p = rackPos[t.id];
      if (p) m.set(keyOf(p.r, p.c), t);
    }
    return m;
  }, [visibleRack, rackPos]);

  // 표시할 줄 수: 타일이 들어있는 마지막 줄까지 (최소 2줄)
  const rackRows = useMemo(() => {
    let max = 2;
    for (const t of myHand) {
      const p = rackPos[t.id];
      if (p && p.r + 1 > max) max = p.r + 1;
    }
    return max;
  }, [myHand, rackPos]);

  // 손패 블럭 (줄에서 붙어있는 타일 묶음) — 블럭 드래그 + 유효 조합 하이라이트
  const rackBlocks = useMemo(() => {
    const blocks = [];
    for (let r = 0; r < rackRows; r += 1) {
      let run = [];
      for (let c = 0; c <= rackCols; c += 1) {
        const t = grid.get(keyOf(r, c));
        if (t) run.push(t);
        else {
          if (run.length) blocks.push(run);
          run = [];
        }
      }
      if (run.length) blocks.push(run);
    }
    return blocks;
  }, [grid, rackRows, rackCols]);

  const readyIds = useMemo(() => {
    const s = new Set();
    for (const b of rackBlocks) {
      if (b.length >= 3 && isValidMeld(b)) for (const t of b) s.add(t.id);
    }
    return s;
  }, [rackBlocks]);

  const blockOf = (tileId) => rackBlocks.find((b) => b.some((t) => t.id === tileId)) || null;

  // 첫 등록 진행 점수
  const turnStartIds = useMemo(
    () =>
      new Set(
        (state.turnStartBoard || []).flatMap((m) => (m.tiles || []).map((t) => t.id))
      ),
    [state.turnStartBoard]
  );
  const initialSum = useMemo(() => {
    if (state.brokeIn || !isMyTurn || !draftBoard) return null;
    let sum = 0;
    for (const m of draftBoard) {
      const allNew = m.tiles.every((t) => !turnStartIds.has(t.id));
      if (allNew && isValidMeld(m.tiles)) sum += meldValue(m.tiles);
    }
    return sum;
  }, [state.brokeIn, isMyTurn, draftBoard, turnStartIds]);

  // draft 갱신 + 관전자 브로드캐스트
  const applyDraft = (mutate) => {
    if (!isMyTurn || !draftBoard) return;
    const d = clone(draftBoard);
    if (mutate(d) === false) return;
    setDraftBoard(d);
    actions.sendDraft(d);
  };

  // ---- DnD ----
  const [dragGhostIds, setDragGhostIds] = useState(null); // 드래그 중인 타일들 (원자리 반투명)

  // 블럭 드래그 시 브라우저 기본 스냅샷(타일 1장) 대신 블럭 전체 모양의 드래그 이미지 사용
  const setBlockDragImage = (e, ids) => {
    const els = ids
      .map((id) => document.querySelector(`.rack-grid [data-tileid="${CSS.escape(id)}"]`))
      .filter(Boolean);
    if (els.length < 2) return;
    const rects = els.map((el) => el.getBoundingClientRect());
    const base = rects[0];
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;top:-500px;left:0;pointer-events:none;';
    wrap.style.width = `${rects[rects.length - 1].right - base.left}px`;
    wrap.style.height = `${base.height}px`;
    els.forEach((el, i) => {
      const c = el.cloneNode(true);
      c.style.position = 'absolute';
      c.style.left = `${rects[i].left - base.left}px`;
      c.style.top = `${rects[i].top - base.top}px`;
      c.style.margin = '0';
      c.style.animation = 'none'; // tile-in 첫 프레임(투명)으로 스냅샷 찍히는 것 방지
      wrap.appendChild(c);
    });
    document.body.appendChild(wrap);
    try {
      e.dataTransfer.setDragImage(wrap, e.clientX - base.left, e.clientY - base.top);
    } catch {
      /* noop */
    }
    setTimeout(() => wrap.remove(), 0); // 스냅샷은 dragstart 시점에 찍히므로 바로 제거 가능
  };

  // 드래그 시작 공통부 (dragRef 설정·드래그 데이터·원자리 반투명)
  const beginDrag = (e, ids, from) => {
    dragRef.current = { ids, from };
    e.dataTransfer.effectAllowed = 'move';
    try {
      e.dataTransfer.setData('text/plain', ids.join(','));
    } catch {
      /* noop */
    }
    setDragGhostIds(new Set(ids));
  };
  const onDragStartRack = (e, tile) => {
    let ids = [tile.id];
    if (e.shiftKey) {
      const b = blockOf(tile.id);
      if (b) ids = b.map((t) => t.id);
    }
    beginDrag(e, ids, 'rack');
    if (ids.length > 1) setBlockDragImage(e, ids);
  };
  const onDragStartBoard = (e, tile) => beginDrag(e, [tile.id], 'board');

  // 드래그 시각 효과 해제 (하이라이트·반투명)
  const clearDragFx = useCallback(() => {
    setOverTarget(null);
    setOverSlot(null);
    setDragGhostIds(null);
  }, []);

  // 드래그 상태를 원자적으로 소비·정리 — 모든 드롭 경로가 여기를 거친다.
  // (예전엔 핸들러마다 복붙이라 하이라이트 잔상 같은 누락 버그가 났음)
  const takeDrag = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    clearDragFx(); // 드롭으로 원본 노드가 사라지면 dragend가 안 와서 여기서 해제
    if (drag) skipFlipRef.current = new Set(drag.ids);
    return drag;
  };

  const onDragEnd = () => {
    dragRef.current = null;
    clearDragFx();
  };

  // 안전망: 드롭으로 원본 노드가 사라지면 dragend가 그 노드에 안 올 수 있다.
  // 어떤 경로로 드래그가 끝나든 창 수준에서 반투명·하이라이트를 확실히 해제.
  useEffect(() => {
    window.addEventListener('dragend', clearDragFx);
    window.addEventListener('drop', clearDragFx);
    return () => {
      window.removeEventListener('dragend', clearDragFx);
      window.removeEventListener('drop', clearDragFx);
    };
  }, [clearDragFx]);

  const handById = useMemo(() => new Map(myHand.map((t) => [t.id, t])), [myHand]);

  // 드래그 출처에서 실제 타일 목록을 꺼낸다 (board면 draft에서 빼내고, rack이면 손패 매핑)
  const tilesFromDrag = (d, drag) =>
    drag.from === 'board'
      ? [extractFromBoard(d, drag.ids[0])].filter(Boolean)
      : drag.ids.map((id) => handById.get(id)).filter(Boolean);

  // 슬롯에 드롭 (손패 안 이동 or 보드→손패 회수)
  const dropOnSlot = (e, r, c) => {
    e.preventDefault();
    e.stopPropagation();
    const drag = takeDrag();
    if (!drag) return;

    if (drag.from === 'board') {
      // 내 손패 타일만 회수 가능 (테이블 타일은 규칙상 불가)
      if (!isMyTurn || !draftBoard) return;
      const id = drag.ids[0];
      if (!handById.has(id)) return;
      applyDraft((d) => {
        const t = extractFromBoard(d, id);
        return t ? true : false;
      });
      setRackPos((p) => placeAt(p, id, r, c, rackCols));
    } else if (drag.ids.length > 1) {
      setRackPos((p) => placeBlockAt(p, drag.ids, r, c, rackCols));
    } else {
      setRackPos((p) => placeAt(p, drag.ids[0], r, c, rackCols));
    }
  };

  // 이 드래그가 손패 슬롯에 놓일 수 있는지 (테이블 타일은 손패로 회수 불가)
  const canDropOnRack = () => {
    const drag = dragRef.current;
    if (!drag) return false;
    if (drag.from === 'board') return isMyTurn && !!draftBoard && handById.has(drag.ids[0]);
    return true;
  };

  // 슬롯 밖(그리드 여백·틈·패딩)에 드롭되면 가장 가까운 슬롯으로 위임 (데드존 제거)
  const dropOnGrid = (e) => {
    if (!canDropOnRack()) return;
    const slots = [...e.currentTarget.querySelectorAll('.slot')];
    let best = null;
    let bestD = Infinity;
    for (const el of slots) {
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const d = (e.clientX - cx) ** 2 + (e.clientY - cy) ** 2;
      if (d < bestD) {
        bestD = d;
        best = el;
      }
    }
    if (best) dropOnSlot(e, Number(best.dataset.r), Number(best.dataset.c));
  };

  // 멜드에 드롭 (블럭이면 통째로)
  const dropIntoMeld = (e, meldId) => {
    e.preventDefault();
    e.stopPropagation(); // 펠트(새 조합 생성) 핸들러로 버블링 방지
    const drag = takeDrag();
    if (!drag || !isMyTurn || !draftBoard) return;
    const anchor = getDropAnchor(e.currentTarget, e.clientX);
    if (drag.ids.length === 1 && anchor === drag.ids[0]) return;
    // 1장짜리 멜드의 그 타일을 같은 멜드에 다시 놓는 건 제자리(멜드가 끝으로 점프하는 버그 방지)
    if (drag.from === 'board') {
      const src = draftBoard.find((m) => m.tiles.some((t) => t.id === drag.ids[0]));
      if (src && src.id === meldId && src.tiles.length === 1) return;
    }

    applyDraft((d) => {
      const tiles = tilesFromDrag(d, drag);
      if (!tiles.length) return false;
      const target = d.find((m) => m.id === meldId);
      if (!target) {
        d.push({ id: newMeldId(), tiles });
      } else {
        let idx = anchor ? target.tiles.findIndex((t) => t.id === anchor) : target.tiles.length;
        if (idx < 0) idx = target.tiles.length;
        target.tiles.splice(idx, 0, ...tiles);
      }
      return true;
    });
  };

  // 새 조합 만들기 (드래그한 타일들로). seedPos를 주면 그 자리(행·x)에 앉힌다.
  const createMeldFromDrag = (drag, seedPos) => {
    const id = newMeldId();
    if (seedPos) meldPosRef.current.set(id, seedPos);
    applyDraft((d) => {
      const tiles = tilesFromDrag(d, drag);
      if (!tiles.length) return false;
      d.push({ id, tiles });
      return true;
    });
  };

  const dropIntoNewMeld = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const drag = takeDrag();
    if (!drag || !isMyTurn || !draftBoard) return;
    createMeldFromDrag(drag, boardLayout ? boardLayout.newSpot : null);
  };

  // 빈 펠트에 드롭 → 떨어뜨린 그 자리에 새 조합 (멜드 위 드롭은 각 멜드가 stopPropagation)
  const dropOnFelt = (e) => {
    e.preventDefault();
    const drag = takeDrag();
    if (!drag || !isMyTurn || !draftBoard || !boardMetrics) return;
    // 멜드 좌표는 스냅으로 이동된 안쪽 기준 (바깥은 제자리라 스냅만큼 어긋난다)
    const anchor = meldsInnerRef.current || meldsRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const count = drag.from === 'board' ? 1 : drag.ids.length;
    const w = meldW(count, boardMetrics);
    const row = Math.max(0, Math.floor((e.clientY - rect.top) / boardMetrics.rowH));
    const x = Math.max(0, Math.min(e.clientX - rect.left - w / 2, boardMetrics.width - w));
    // 겹치면 layoutMelds의 근처 보정(±1~2칸)·첫 빈 자리 규칙이 알아서 정리
    createMeldFromDrag(drag, { row, x });
  };

  // ---- 버튼 ----
  const commit = () => draftBoard && actions.commit(draftBoard);
  const resetTurn = () => {
    const base = state.turnStartBoard || state.board || [];
    setDraftBoard(clone(base));
    actions.sendDraft(clone(base));
  };
  // 정렬/모으기는 보이는 타일만 배치 (보드에 올린 숨김 타일이 슬롯을 예약해 구멍 남는 것 방지)
  const sortRack = (mode) => setRackPos(buildSortedPos(visibleRack, mode, rackCols));
  const compactRack = () => setRackPos((p) => buildCompactPos(visibleRack, p, rackCols));

  const currentPlayer = state.players.find((p) => p.id === state.currentPlayerId);
  const winner = state.players.find((p) => p.id === state.winnerId);
  const rejectMeldId = reject && Date.now() - reject.ts < 3000 ? reject.invalidMeldId : null;

  // 상대 좌석: 내 다음 차례부터 시계방향
  const myIdx = state.players.findIndex((p) => p.id === me.playerId);
  const opponents =
    myIdx >= 0
      ? [...state.players.slice(myIdx + 1), ...state.players.slice(0, myIdx)]
      : state.players.filter((p) => p.id !== me.playerId);

  return (
    <div className="game" ref={rootRef}>
      {/* 엑셀 모드: 턴 상태·타이머는 App이 수식 입력줄에 표시한다(시트엔 격자만) → 여기선 합계 힌트만 */}
      <div className={`turn-banner ${isMyTurn ? 'mine' : ''}`}>
        {!excel &&
          (ended ? (
            <b>게임 종료</b>
          ) : isMyTurn ? (
            <b>내 차례!</b>
          ) : (
            <span>{currentPlayer ? `${currentPlayer.name} 님의 차례` : '대기 중'}</span>
          ))}
        {/* 30점을 채우면(등록 조건 완성) 숨김 — 회수해서 다시 모자라면 재표시 */}
        {!state.brokeIn && isMyTurn && (initialSum ?? 0) < INITIAL_MELD_MIN && (
          <span className="initial-hint">
            {t('첫 등록 필요: ', '필요 합계: ')}
            <b className="no">{initialSum ?? 0}</b> / {INITIAL_MELD_MIN}
          </span>
        )}
        {!excel && playing && deadlineLocal != null && <TurnTimer deadline={deadlineLocal} />}
      </div>

      {/* 테이블 (보드) */}
      <div className="table-area">
        <div className="seats">
          {opponents.map((p) => (
            <div
              key={p.id}
              data-seatid={p.id}
              className={[
                'seat',
                p.id === state.currentPlayerId ? 'turn' : '',
                p.connected ? '' : 'offline',
              ].join(' ')}
            >
              <div className="seat-name">
                {p.name}
                {p.brokeIn && <span className="mini-badge">{t('등록', '입력')}</span>}
                {!p.connected && <span className="seat-off">{t('연결 끊김', '오프라인')}</span>}
              </div>
              <div className="mini-hand">
                <div className="mini-fan">
                  {Array.from({ length: Math.min(p.handCount, 24) }, (_, i) => (
                    <span key={i} className="mini-tile-back" />
                  ))}
                  {p.handCount > 24 && <span className="mini-more">…</span>}
                </div>
                <span className="seat-count">{p.handCount}</span>
              </div>
            </div>
          ))}
        </div>

        {board.length === 0 && (
          <div className="empty-table">{t('아직 놓인 조합이 없어', '표시할 데이터가 없습니다')}</div>
        )}
        {/* 측정은 바깥(.melds), 격자 스냅 이동은 안쪽(.melds-inner).
            useGridSnap 불변조건: 측정 대상에 transform을 걸면 재측정 때 잔여 오프셋이 0이 나와
            스냅이 스스로 풀린다(그러면 보드가 튀고 가짜 FLIP까지 재생된다). */}
        <div
          className="melds"
          ref={meldsRef}
          style={
            boardLayout && boardMetrics
              ? { minHeight: Math.max(1, boardLayout.rowCount + 1) * boardMetrics.rowH }
              : undefined
          }
          onDragOver={isMyTurn ? (e) => e.preventDefault() : undefined}
          onDrop={isMyTurn ? dropOnFelt : undefined}
        >
        <div
          className="melds-inner"
          ref={meldsInnerRef}
          style={meldsSnap ? { transform: `translate(${meldsSnap.x}px, ${meldsSnap.y}px)` } : undefined}
        >
          {boardLayout &&
            boardMetrics &&
            board.map((m) => {
              const p = boardLayout.placed.get(m.id);
              if (!p) return null;
              const valid = m.tiles.length >= 3 && isValidMeld(m.tiles);
              return (
                <div
                  key={m.id}
                  style={{ left: p.x, top: p.row * boardMetrics.rowH }}
                  className={[
                    'meld',
                    valid ? 'valid' : 'invalid',
                    overTarget === m.id ? 'over' : '',
                    rejectMeldId === m.id ? 'reject' : '',
                  ].join(' ')}
                  onDragOver={
                    isMyTurn
                      ? (e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (overTarget !== m.id) setOverTarget(m.id);
                        }
                      : undefined
                  }
                  onDrop={isMyTurn ? (e) => dropIntoMeld(e, m.id) : undefined}
                >
                  {m.tiles.map((t) => (
                    <Tile
                      key={t.id}
                      tile={t}
                      draggable={isMyTurn}
                      onDragStart={onDragStartBoard}
                      onDragEnd={onDragEnd}
                      ghost={dragGhostIds?.has(t.id)}
                    />
                  ))}
                </div>
              );
            })}

          {isMyTurn && boardLayout && boardMetrics && (
            <div
              className={`meld new-meld ${overTarget === 'new' ? 'over' : ''}`}
              style={{
                left: boardLayout.newSpot.x,
                top: boardLayout.newSpot.row * boardMetrics.rowH,
                width: meldW(3, boardMetrics),
                height: boardMetrics.meldH,
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (overTarget !== 'new') setOverTarget('new');
              }}
              onDrop={dropIntoNewMeld}
            >
              {t('+ 새 조합', '+ 새 범위')}
            </div>
          )}
        </div>
        </div>

        {/* 뽑기 더미 — 내 턴엔 클릭으로 한 장 뽑기 */}
        {playing && (
          <button
            type="button"
            className={[
              'pool-pile',
              isMyTurn ? 'can-draw' : '',
              state.poolCount === 0 ? 'empty' : '',
            ].join(' ')}
            onClick={isMyTurn ? actions.draw : undefined}
            disabled={!isMyTurn}
            title={
              isMyTurn
                ? t('한 장 뽑기 (턴 넘김)', '데이터 가져오기')
                : `${t('남은 타일', '남은 행')} ${state.poolCount}`
            }
          >
            <span className="pool-stack">
              <span className="pool-tile" />
              <span className="pool-tile" />
              <span className="pool-tile" />
            </span>
            <span className="pool-count">{state.poolCount}</span>
            {isMyTurn && state.poolCount > 0 && (
              <span className="pool-hint">{t('타일 뽑기', '가져오기')}</span>
            )}
          </button>
        )}
      </div>

      {/* 내 손패 (2줄 슬롯 — 언제든 정렬 가능) */}
      <div className="rack-area">
        <div className="rack-header">
          <span>
            {t('내 손패', '선택 영역')} ({myHand.length})
            {hiddenIds.size > 0 && (
              <span className="muted">
                {' '}
                · {t('보드에', '시트에')} {hiddenIds.size}
                {t('장', '개')}
              </span>
            )}
          </span>
          <span className="rack-tip muted">
            {t('Shift+드래그 = 블럭 통째로 이동', 'Shift+드래그 = 범위 이동')}
          </span>
          {/* 측정용 껍데기(.sort-btns)는 제자리, 안쪽 래퍼만 격자로 이동 */}
          <div className="sort-btns" ref={sortBtnsRef}>
            <div
              className="sort-btns-inner"
              style={sortSnap ? { transform: `translate(${sortSnap.x}px, ${sortSnap.y}px)` } : undefined}
            >
            <button
              className="sort-btn"
              onClick={() => sortRack('num')}
              title={t('같은 숫자끼리 정렬 (777)', '값 기준 정렬')}
            >
              <span className="mini-t red">7</span>
              <span className="mini-t blue">7</span>
              <span className="mini-t black">7</span>
            </button>
            <button
              className="sort-btn"
              onClick={() => sortRack('color')}
              title={t('색깔별 연속 정렬 (789)', '색 기준 정렬')}
            >
              <span className="mini-t blue">7</span>
              <span className="mini-t blue">8</span>
              <span className="mini-t blue">9</span>
            </button>
            <button className="sort-btn" onClick={compactRack} title={t('빈 칸 없이 모으기', '빈 셀 제거')}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M3 12h5.5" />
                <path d="M6 9l3 3-3 3" />
                <path d="M21 12h-5.5" />
                <path d="M18 9l-3 3 3 3" />
                <path d="M12 5v14" />
              </svg>
            </button>
            </div>
          </div>
        </div>
        <div className="rack-row">
        <div className="rack-scroll" ref={rackScrollRef}>
          <div
            className="rack-grid"
            style={{
              gridTemplateColumns: `repeat(${rackCols}, var(--slot-w))`,
              gridTemplateRows: `repeat(${rackRows}, var(--slot-h))`,
              // 엑셀 모드: 배경 시트 격자 경계에 셀을 맞춘다
              ...(rackSnap ? { transform: `translate(${rackSnap.x}px, ${rackSnap.y}px)` } : null),
            }}
            onDragOver={(e) => {
              if (canDropOnRack()) e.preventDefault(); // 데드존에서도 드롭 허용(그리드가 위임)
            }}
            onDrop={dropOnGrid}
          >
            {Array.from({ length: rackRows }).map((_, r) =>
              Array.from({ length: rackCols }).map((_, c) => {
                const k = keyOf(r, c);
                const t = grid.get(k);
                return (
                  <div
                    key={k}
                    data-r={r}
                    data-c={c}
                    className={['slot', overSlot === k ? 'over' : ''].join(' ')}
                    onDragOver={(e) => {
                      if (!canDropOnRack()) return; // 테이블 타일 등 불가 → no-drop 커서
                      e.preventDefault();
                      e.stopPropagation();
                      if (overSlot !== k) setOverSlot(k);
                    }}
                    onDrop={(e) => dropOnSlot(e, r, c)}
                  >
                    {t && (
                      <Tile
                        tile={t}
                        draggable
                        onDragStart={onDragStartRack}
                        onDragEnd={onDragEnd}
                        ready={readyIds.has(t.id)}
                        ghost={dragGhostIds?.has(t.id)}
                      />
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* 턴 액션: 제출 / 되돌리기 (내 턴에만 활성) */}
        {playing && (
          <div className="action-col" ref={actionColRef}>
            {/* 안쪽 래퍼만 이동 — 측정 대상(.action-col)은 제자리에 둬야 스냅이 풀리지 않는다 */}
            <div
              className="action-col-inner"
              style={
                actionSnap ? { transform: `translate(${actionSnap.x}px, ${actionSnap.y}px)` } : undefined
              }
            >
              <button
                className="action-btn submit"
                onClick={commit}
                disabled={!isMyTurn}
                title={t('제출 — 이번 턴 확정', '저장 — 변경 내용 저장')}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M5 12.5l4.5 4.5L19 7" />
                </svg>
              </button>
              <button
                className="action-btn undo"
                onClick={resetTurn}
                disabled={!isMyTurn}
                title={t('되돌리기 — 턴 시작 상태로', '실행 취소 — 되돌리기')}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M8.5 13.5L4 9l4.5-4.5" />
                  <path d="M4 9h9.5a6.5 6.5 0 0 1 0 13H10" />
                </svg>
              </button>
            </div>
          </div>
        )}
        </div>
      </div>

      {/* 재촉받음: 화면 테두리 펄스 */}
      {nudgeFx && isMyTurn && <div key={nudgeFx} className="nudge-flash" />}

      {/* 종료 오버레이 */}
      {ended && (
        <div className="overlay">
          <div className="overlay-card">
            <h1>
              {winner
                ? `${winner.name} ${t('승리! 🎉', '결재 완료 ✅')}`
                : t('게임 종료', '문서 잠김')}
            </h1>
            <p className="muted">{t('모든 타일을 먼저 내려놓았어.', '모든 항목을 먼저 입력했어.')}</p>
            <button className="primary big" onClick={actions.newGame}>
              {t('새 게임 (대기실로)', '새 통합 문서')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
