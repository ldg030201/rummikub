import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Tile from './Tile.jsx';
import { isValidMeld, meldValue } from '../rules.js';

// 유틸
const clone = (v) =>
  typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v));

let meldSeed = 0;
const newMeldId = () => `m_${(meldSeed += 1)}_${Math.floor(Math.random() * 1e6)}`;

const COLOR_ORDER = { red: 0, orange: 1, blue: 2, black: 3 };

// 탭별 식별자 (같은 브라우저의 다른 탭이 손패 배치를 서로 덮어쓰지 않게).
// sessionStorage라 새로고침엔 유지되고 탭이 다르면 분리됨.
const TAB_ID = (() => {
  try {
    let id = sessionStorage.getItem('rk_tab');
    if (!id) {
      id = Math.random().toString(36).slice(2, 8);
      sessionStorage.setItem('rk_tab', id);
    }
    return id;
  } catch {
    return 'tab';
  }
})();

// ---- 손패 슬롯(2줄) 배치 ----
// rackPos = { [tileId]: { r, c } } — 클라이언트 로컬, localStorage에 저장돼 유지됨
const RACK_ROWS = 2;
const MIN_COLS = 14;
const keyOf = (r, c) => `${r},${c}`;

function loadRackPos(storageKey) {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const p = JSON.parse(raw);
      if (p && typeof p === 'object') return p;
    }
  } catch {
    /* noop */
  }
  return {};
}

function saveRackPos(storageKey, pos) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(pos));
  } catch {
    /* noop */
  }
}

// 손패의 모든 타일이 유일한 슬롯을 갖도록 보정: 기존 위치 유지, 새 타일은 빈 슬롯, 없는 타일 제거
function reconcilePos(pos, hand) {
  const next = {};
  const used = new Set();
  for (const t of hand) {
    const p = pos[t.id];
    if (
      p &&
      Number.isInteger(p.r) &&
      Number.isInteger(p.c) &&
      p.r >= 0 &&
      p.r < RACK_ROWS &&
      p.c >= 0 &&
      !used.has(keyOf(p.r, p.c))
    ) {
      next[t.id] = { r: p.r, c: p.c };
      used.add(keyOf(p.r, p.c));
    }
  }
  // 새 타일(첫 배분/뽑기)은 기존 배치를 건드리지 않게 처리한다.
  // 기존 배치가 있으면 최대 열 + 한 칸 띄우고 뒤에 이어붙이고(정렬 블럭 오염 방지),
  // 아무 배치도 없으면(첫 배분) 앞에서부터 촘촘히 채운다.
  const newTiles = hand.filter((t) => !next[t.id]);
  if (newTiles.length) {
    const hasExisting = Object.keys(next).length > 0;
    let maxC = -1;
    for (const id in next) if (next[id].c > maxC) maxC = next[id].c;
    let c = hasExisting ? maxC + 2 : 0;
    let r = 0;
    for (const t of newTiles) {
      while (used.has(keyOf(r, c))) {
        r += 1;
        if (r >= RACK_ROWS) {
          r = 0;
          c += 1;
        }
      }
      next[t.id] = { r, c };
      used.add(keyOf(r, c));
      r += 1;
      if (r >= RACK_ROWS) {
        r = 0;
        c += 1;
      }
    }
  }
  return next;
}

// 단일 타일을 슬롯에 놓기. 자리에 타일이 있으면 그 줄 오른쪽으로 한 칸씩 민다.
function placeAt(pos, tileId, r, c) {
  const occupied = new Map();
  for (const [id, p] of Object.entries(pos)) {
    if (id !== tileId) occupied.set(keyOf(p.r, p.c), id);
  }
  const next = { ...pos };
  if (!occupied.has(keyOf(r, c))) {
    next[tileId] = { r, c };
    return next;
  }
  let free = c + 1;
  while (occupied.has(keyOf(r, free))) free += 1;
  for (let cc = free - 1; cc >= c; cc -= 1) {
    const id = occupied.get(keyOf(r, cc));
    if (id) next[id] = { r, c: cc + 1 };
  }
  next[tileId] = { r, c };
  return next;
}

// 블럭(타일 여러 개)을 순서 유지한 채 (r,c)에 놓기.
// placeAt과 동일하게, 그 줄에서 c 이상에 있던 다른 타일들을 블럭 길이만큼 오른쪽으로 민다.
function placeBlockAt(pos, ids, r, c) {
  const idSet = new Set(ids);
  const len = ids.length;
  const next = {};
  for (const [id, p] of Object.entries(pos)) {
    if (idSet.has(id)) continue;
    if (p.r === r && p.c >= c) next[id] = { r, c: p.c + len };
    else next[id] = { r: p.r, c: p.c };
  }
  ids.forEach((id, i) => {
    next[id] = { r, c: c + i };
  });
  return next;
}

// 블럭 단위 정렬: 색깔순(런 준비) 또는 숫자순(그룹 준비). 블럭 사이 한 칸 띄움.
function buildSortedPos(hand, mode) {
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

  // 2줄에 배치: 블럭이 줄 끝에 안 들어가면 다음 줄로 (사이 한 칸 띄움)
  const totalUnits = blocks.reduce((s, b) => s + b.length + 1, 0);
  let cols = Math.max(MIN_COLS, Math.ceil(totalUnits / RACK_ROWS));
  for (const b of blocks) if (b.length > cols) cols = b.length;

  const pos = {};
  let r = 0;
  let c = 0;
  for (const b of blocks) {
    if (c > 0 && c + b.length > cols && r < RACK_ROWS - 1) {
      r += 1;
      c = 0;
    }
    for (const t of b) {
      pos[t.id] = { r, c };
      c += 1;
    }
    c += 1; // 블럭 사이 한 칸
  }
  return pos;
}

// 모으기: 현재 순서(줄 우선) 유지한 채 빈 칸 없이 두 줄에 균등 배치
function buildCompactPos(hand, pos) {
  const ordered = hand
    .slice()
    .sort((a, b) => {
      const pa = pos[a.id] || { r: 9, c: 9999 };
      const pb = pos[b.id] || { r: 9, c: 9999 };
      return pa.r - pb.r || pa.c - pb.c;
    });
  const cols = Math.max(MIN_COLS, Math.ceil(ordered.length / RACK_ROWS));
  const next = {};
  ordered.forEach((t, i) => {
    next[t.id] = { r: Math.floor(i / cols), c: i % cols };
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

export default function Game({ state, me, actions, reject, nudged }) {
  const playing = state.phase === 'playing';
  const ended = state.phase === 'ended';
  const isMyTurn = playing && state.isMyTurn;

  // ---- 턴 제한시간 카운트다운 ----
  // 서버 시계 기준 마감시각을 로컬 시계로 환산 (시계 오차 보정)
  const deadlineLocal = useMemo(() => {
    if (!playing || !state.turnDeadline || !state.serverNow) return null;
    return Date.now() + (state.turnDeadline - state.serverNow);
  }, [playing, state.turnDeadline, state.serverNow]);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!deadlineLocal) return undefined;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [deadlineLocal]);
  const remainSec = deadlineLocal ? Math.max(0, Math.ceil((deadlineLocal - now) / 1000)) : null;

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
    firstFlipRef.current = false;
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
  const initedRef = useRef(false);

  const myHand = useMemo(
    () => (Array.isArray(state.myHand) ? state.myHand : []),
    [state.myHand]
  );

  // ---- 손패 슬롯 배치 (항상 편집 가능, localStorage 유지) ----
  const storageKey = `rk_rack_${state.roomId}_${me.name}_${TAB_ID}`;
  const [rackPos, setRackPos] = useState(() => loadRackPos(storageKey));
  const handKey = useMemo(() => myHand.map((t) => t.id).sort().join(','), [myHand]);

  useEffect(() => {
    setRackPos((p) => reconcilePos(p, myHand));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handKey]);

  useEffect(() => {
    saveRackPos(storageKey, rackPos);
  }, [storageKey, rackPos]);

  // 내 턴 진입 시 draft 초기화 (턴 중엔 유지)
  useEffect(() => {
    if (!playing) {
      setDraftBoard(null);
      initedRef.current = false;
      return;
    }
    if (isMyTurn) {
      if (!initedRef.current) {
        setDraftBoard(clone(Array.isArray(state.board) ? state.board : []));
        initedRef.current = true;
      }
    } else {
      initedRef.current = false;
      setDraftBoard(null);
    }
  }, [playing, isMyTurn, state]);

  // 렌더링할 보드 (방어적으로 형태 필터)
  const rawBoard = isMyTurn && draftBoard ? draftBoard : state.board;
  const board = Array.isArray(rawBoard) ? rawBoard.filter((m) => m && Array.isArray(m.tiles)) : [];

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

  const colsRendered = useMemo(() => {
    let max = MIN_COLS;
    for (const t of myHand) {
      const p = rackPos[t.id];
      if (p && p.c + 2 > max) max = p.c + 2;
    }
    return max;
  }, [myHand, rackPos]);

  // 손패 블럭 (줄에서 붙어있는 타일 묶음) — 블럭 드래그 + 유효 조합 하이라이트
  const rackBlocks = useMemo(() => {
    const blocks = [];
    for (let r = 0; r < RACK_ROWS; r += 1) {
      let run = [];
      for (let c = 0; c <= colsRendered; c += 1) {
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
  }, [grid, colsRendered]);

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

  const onDragStartRack = (e, tile) => {
    let ids = [tile.id];
    if (e.shiftKey) {
      const b = blockOf(tile.id);
      if (b) ids = b.map((t) => t.id);
    }
    dragRef.current = { ids, from: 'rack' };
    e.dataTransfer.effectAllowed = 'move';
    try {
      e.dataTransfer.setData('text/plain', ids.join(','));
    } catch {
      /* noop */
    }
    if (ids.length > 1) setBlockDragImage(e, ids);
    setDragGhostIds(new Set(ids));
  };
  const onDragStartBoard = (e, tile) => {
    dragRef.current = { ids: [tile.id], from: 'board' };
    e.dataTransfer.effectAllowed = 'move';
    try {
      e.dataTransfer.setData('text/plain', tile.id);
    } catch {
      /* noop */
    }
    setDragGhostIds(new Set([tile.id]));
  };
  const onDragEnd = () => {
    dragRef.current = null;
    setOverTarget(null);
    setOverSlot(null);
    setDragGhostIds(null);
  };

  // 안전망: 드롭으로 원본 노드가 사라지면 dragend가 그 노드에 안 올 수 있다.
  // 어떤 경로로 드래그가 끝나든 창 수준에서 반투명을 확실히 해제.
  useEffect(() => {
    const clearGhost = () => setDragGhostIds(null);
    window.addEventListener('dragend', clearGhost);
    window.addEventListener('drop', clearGhost);
    return () => {
      window.removeEventListener('dragend', clearGhost);
      window.removeEventListener('drop', clearGhost);
    };
  }, []);

  const handById = useMemo(() => new Map(myHand.map((t) => [t.id, t])), [myHand]);

  // 슬롯에 드롭 (손패 안 이동 or 보드→손패 회수)
  const dropOnSlot = (e, r, c) => {
    e.preventDefault();
    e.stopPropagation();
    setOverSlot(null);
    setOverTarget(null);
    const drag = dragRef.current;
    dragRef.current = null;
    setDragGhostIds(null); // 드롭으로 원본 노드가 사라지면 dragend가 안 와서 여기서 해제
    if (!drag) return;
    skipFlipRef.current = new Set(drag.ids);

    if (drag.from === 'board') {
      // 내 손패 타일만 회수 가능 (테이블 타일은 규칙상 불가)
      if (!isMyTurn || !draftBoard) return;
      const id = drag.ids[0];
      if (!handById.has(id)) return;
      applyDraft((d) => {
        const t = extractFromBoard(d, id);
        return t ? true : false;
      });
      setRackPos((p) => placeAt(p, id, r, c));
    } else if (drag.ids.length > 1) {
      setRackPos((p) => placeBlockAt(p, drag.ids, r, c));
    } else {
      setRackPos((p) => placeAt(p, drag.ids[0], r, c));
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
    setOverTarget(null);
    const drag = dragRef.current;
    dragRef.current = null;
    setDragGhostIds(null);
    if (!drag || !isMyTurn || !draftBoard) return;
    skipFlipRef.current = new Set(drag.ids);
    const anchor = getDropAnchor(e.currentTarget, e.clientX);
    if (drag.ids.length === 1 && anchor === drag.ids[0]) return;
    // 1장짜리 멜드의 그 타일을 같은 멜드에 다시 놓는 건 제자리(멜드가 끝으로 점프하는 버그 방지)
    if (drag.from === 'board') {
      const src = draftBoard.find((m) => m.tiles.some((t) => t.id === drag.ids[0]));
      if (src && src.id === meldId && src.tiles.length === 1) return;
    }

    applyDraft((d) => {
      let tiles = [];
      if (drag.from === 'board') {
        const t = extractFromBoard(d, drag.ids[0]);
        if (!t) return false;
        tiles = [t];
      } else {
        tiles = drag.ids.map((id) => handById.get(id)).filter(Boolean);
        if (!tiles.length) return false;
      }
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

  const dropIntoNewMeld = (e) => {
    e.preventDefault();
    setOverTarget(null);
    const drag = dragRef.current;
    dragRef.current = null;
    setDragGhostIds(null);
    if (!drag || !isMyTurn || !draftBoard) return;
    skipFlipRef.current = new Set(drag.ids);
    applyDraft((d) => {
      let tiles = [];
      if (drag.from === 'board') {
        const t = extractFromBoard(d, drag.ids[0]);
        if (!t) return false;
        tiles = [t];
      } else {
        tiles = drag.ids.map((id) => handById.get(id)).filter(Boolean);
        if (!tiles.length) return false;
      }
      d.push({ id: newMeldId(), tiles });
      return true;
    });
  };

  // ---- 버튼 ----
  const commit = () => draftBoard && actions.commit(draftBoard);
  const resetTurn = () => {
    const base = state.turnStartBoard || state.board || [];
    setDraftBoard(clone(base));
    actions.sendDraft(clone(base));
  };
  // 정렬/모으기는 보이는 타일만 배치 (보드에 올린 숨김 타일이 슬롯을 예약해 구멍 남는 것 방지)
  const sortRack = (mode) => setRackPos(buildSortedPos(visibleRack, mode));
  const compactRack = () => setRackPos((p) => buildCompactPos(visibleRack, p));

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
      <div className={`turn-banner ${isMyTurn ? 'mine' : ''}`}>
        {ended ? (
          <b>게임 종료</b>
        ) : isMyTurn ? (
          <b>내 차례!</b>
        ) : (
          <span>{currentPlayer ? `${currentPlayer.name} 님의 차례` : '대기 중'}</span>
        )}
        {!state.brokeIn && isMyTurn && (
          <span className="initial-hint">
            첫 등록 필요:{' '}
            <b className={initialSum >= 30 ? 'ok' : 'no'}>{initialSum ?? 0}</b> / 30
          </span>
        )}
        {playing && remainSec != null && (
          <span className={`turn-timer ${remainSec <= 10 ? 'low' : ''}`}>
            ⏱ {Math.floor(remainSec / 60)}:{String(remainSec % 60).padStart(2, '0')}
          </span>
        )}
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
                {p.brokeIn && <span className="mini-badge">등록</span>}
                {!p.connected && <span className="seat-off">연결 끊김</span>}
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

        {board.length === 0 && <div className="empty-table">아직 놓인 조합이 없어</div>}
        <div className="melds">
          {board.map((m) => {
            const valid = m.tiles.length >= 3 && isValidMeld(m.tiles);
            return (
              <div
                key={m.id}
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

          {isMyTurn && (
            <div
              className={`meld new-meld ${overTarget === 'new' ? 'over' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                if (overTarget !== 'new') setOverTarget('new');
              }}
              onDrop={dropIntoNewMeld}
            >
              + 새 조합
            </div>
          )}
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
            title={isMyTurn ? '한 장 뽑기 (턴 넘김)' : `남은 타일 ${state.poolCount}`}
          >
            <span className="pool-stack">
              <span className="pool-tile" />
              <span className="pool-tile" />
              <span className="pool-tile" />
            </span>
            <span className="pool-count">{state.poolCount}</span>
          </button>
        )}
      </div>

      {/* 내 손패 (2줄 슬롯 — 언제든 정렬 가능) */}
      <div className="rack-area">
        <div className="rack-header">
          <span>
            내 손패 ({myHand.length})
            {hiddenIds.size > 0 && <span className="muted"> · 보드에 {hiddenIds.size}장</span>}
          </span>
          <span className="rack-tip muted">Shift+드래그 = 블럭 통째로 이동</span>
          <div className="sort-btns">
            <button className="ghost sm" onClick={() => sortRack('num')}>
              777 숫자순
            </button>
            <button className="ghost sm" onClick={() => sortRack('color')}>
              789 색깔순
            </button>
            <button className="ghost sm" onClick={compactRack}>
              모으기
            </button>
          </div>
        </div>
        <div className="rack-scroll">
          <div
            className="rack-grid"
            style={{ gridTemplateColumns: `repeat(${colsRendered}, var(--slot-w))` }}
            onDragOver={(e) => {
              if (canDropOnRack()) e.preventDefault(); // 데드존에서도 드롭 허용(그리드가 위임)
            }}
            onDrop={dropOnGrid}
          >
            {Array.from({ length: RACK_ROWS }).map((_, r) =>
              Array.from({ length: colsRendered }).map((_, c) => {
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
      </div>

      {/* 컨트롤 */}
      <div className="controls">
        {isMyTurn ? (
          <>
            <button className="primary" onClick={commit}>
              제출
            </button>
            <button className="ghost" onClick={resetTurn}>
              되돌리기
            </button>
            <button className="warn" onClick={actions.draw}>
              한 장 뽑기 (턴 넘김)
            </button>
          </>
        ) : (
          !ended && <div className="muted wait-msg">다른 사람 차례를 기다리는 중...</div>
        )}
      </div>

      {/* 재촉받음: 화면 테두리 펄스 */}
      {nudgeFx && isMyTurn && <div key={nudgeFx} className="nudge-flash" />}

      {/* 종료 오버레이 */}
      {ended && (
        <div className="overlay">
          <div className="overlay-card">
            <h1>🎉 {winner ? `${winner.name} 승리!` : '게임 종료'}</h1>
            <p className="muted">모든 타일을 먼저 내려놓았어.</p>
            <button className="primary big" onClick={actions.newGame}>
              새 게임 (대기실로)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
