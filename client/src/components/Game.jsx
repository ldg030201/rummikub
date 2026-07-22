import { useEffect, useMemo, useRef, useState } from 'react';
import Tile from './Tile.jsx';
import { isValidMeld, meldValue } from '../rules.js';

// 유틸
const clone = (v) =>
  typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v));

let meldSeed = 0;
const newMeldId = () => `m_${(meldSeed += 1)}_${Math.floor(Math.random() * 1e6)}`;

const COLOR_ORDER = { red: 0, orange: 1, blue: 2, black: 3 };

// 드롭 위치(anchor) 계산: 컨테이너 안에서 커서 X 기준 어느 타일 앞에 넣을지
function getDropAnchor(containerEl, clientX) {
  const els = [...containerEl.querySelectorAll('[data-tileid]')];
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (clientX < r.left + r.width / 2) return el.dataset.tileid;
  }
  return null; // 맨 뒤에 붙이기
}

// draft에서 타일 뽑아내기 (rack 또는 board). 빈 멜드는 제거.
function extractTile(d, tileId) {
  const ri = d.rack.findIndex((t) => t.id === tileId);
  if (ri >= 0) return d.rack.splice(ri, 1)[0];
  for (let mi = 0; mi < d.board.length; mi += 1) {
    const m = d.board[mi];
    const ti = m.tiles.findIndex((t) => t.id === tileId);
    if (ti >= 0) {
      const tile = m.tiles.splice(ti, 1)[0];
      if (m.tiles.length === 0) d.board.splice(mi, 1);
      return tile;
    }
  }
  return null;
}

export default function Game({ state, me, actions, reject }) {
  const playing = state.phase === 'playing';
  const ended = state.phase === 'ended';
  const isMyTurn = playing && state.isMyTurn;

  const [draft, setDraft] = useState(null); // { board, rack }
  const [overTarget, setOverTarget] = useState(null); // 하이라이트용
  const dragRef = useRef(null); // 현재 드래그 중인 tileId
  const initedRef = useRef(false);

  // 내 턴 진입 시 draft 초기화 (턴 중엔 유지)
  useEffect(() => {
    if (!playing) {
      setDraft(null);
      initedRef.current = false;
      return;
    }
    if (isMyTurn) {
      if (!initedRef.current) {
        // 서버 board(=미제출 draft 포함)에 이미 올라간 손패 타일은 rack에서 제외.
        // (새로고침해도 내가 배치하던 상태가 복원됨. 평소엔 board에 손패 타일이 없어 rack=전체)
        const boardIds = new Set(
          (state.board || []).flatMap((m) => (m.tiles || []).map((t) => t.id))
        );
        setDraft({
          board: clone(state.board),
          rack: clone(state.myHand).filter((t) => !boardIds.has(t.id)),
        });
        initedRef.current = true;
      }
    } else {
      initedRef.current = false;
      setDraft(null);
    }
  }, [playing, isMyTurn, state]);

  // 렌더링할 보드: 내 턴이면 draft, 아니면 서버 보드(현재 플레이어의 실시간 draft 포함).
  // 혹시 모를 잘못된 형태는 걸러서 렌더 중 크래시를 막는다 (방어적).
  const rawBoard = isMyTurn && draft ? draft.board : state.board;
  const board = Array.isArray(rawBoard)
    ? rawBoard.filter((m) => m && Array.isArray(m.tiles))
    : [];
  const rawRack = isMyTurn && draft ? draft.rack : state.myHand;
  const rack = Array.isArray(rawRack) ? rawRack : [];

  const turnStartIds = useMemo(
    () => new Set((state.turnStartBoard || []).flatMap((m) => m.tiles.map((t) => t.id))),
    [state.turnStartBoard]
  );

  // 첫 등록 진행 점수 (새로 만든 유효 멜드 합)
  const initialSum = useMemo(() => {
    if (state.brokeIn || !isMyTurn || !draft) return null;
    let sum = 0;
    for (const m of draft.board) {
      const allNew = m.tiles.every((t) => !turnStartIds.has(t.id));
      if (allNew && isValidMeld(m.tiles)) sum += meldValue(m.tiles);
    }
    return sum;
  }, [state.brokeIn, isMyTurn, draft, turnStartIds]);

  // draft 변경 헬퍼: 현재 draft를 복제 → mutate → 상태 반영 + 브로드캐스트 1회.
  // (setState 업데이터 안에서 부수효과를 내면 StrictMode에서 2번 전송되므로 밖에서 처리)
  const applyDraft = (mutate) => {
    if (!draft) return;
    const d = clone(draft);
    if (mutate(d) === false) return;
    setDraft(d);
    actions.sendDraft(d.board); // 관전자 실시간 동기화
  };

  // ---- DnD 핸들러 ----
  const onDragStart = (e, tile) => {
    dragRef.current = tile.id;
    e.dataTransfer.effectAllowed = 'move';
    try {
      e.dataTransfer.setData('text/plain', tile.id);
    } catch {
      /* noop */
    }
  };
  const onDragEnd = () => {
    dragRef.current = null;
    setOverTarget(null);
  };

  const dropIntoMeld = (e, meldId) => {
    e.preventDefault();
    setOverTarget(null);
    const tileId = dragRef.current;
    dragRef.current = null;
    if (!tileId || !draft) return;
    const anchor = getDropAnchor(e.currentTarget, e.clientX);
    if (anchor === tileId) return; // 제자리
    applyDraft((d) => {
      const tile = extractTile(d, tileId);
      if (!tile) return false;
      const meld = d.board.find((m) => m.id === meldId);
      if (!meld) {
        d.board.push({ id: newMeldId(), tiles: [tile] });
      } else {
        let idx = anchor ? meld.tiles.findIndex((t) => t.id === anchor) : meld.tiles.length;
        if (idx < 0) idx = meld.tiles.length;
        meld.tiles.splice(idx, 0, tile);
      }
      return true;
    });
  };

  const dropIntoRack = (e) => {
    e.preventDefault();
    setOverTarget(null);
    const tileId = dragRef.current;
    dragRef.current = null;
    if (!tileId || !draft) return;
    const anchor = getDropAnchor(e.currentTarget, e.clientX);
    if (anchor === tileId) return;
    applyDraft((d) => {
      const tile = extractTile(d, tileId);
      if (!tile) return false;
      let idx = anchor ? d.rack.findIndex((t) => t.id === anchor) : d.rack.length;
      if (idx < 0) idx = d.rack.length;
      d.rack.splice(idx, 0, tile);
      return true;
    });
  };

  const dropIntoNewMeld = (e) => {
    e.preventDefault();
    setOverTarget(null);
    const tileId = dragRef.current;
    dragRef.current = null;
    if (!tileId || !draft) return;
    applyDraft((d) => {
      const tile = extractTile(d, tileId);
      if (!tile) return false;
      d.board.push({ id: newMeldId(), tiles: [tile] });
      return true;
    });
  };

  // ---- 버튼 ----
  const commit = () => draft && actions.commit(draft.board);
  const resetTurn = () => {
    const base = state.turnStartBoard || state.board;
    setDraft({ board: clone(base), rack: clone(state.myHand) });
    actions.sendDraft(clone(base)); // 관전자 화면도 되돌림
  };
  const sortRack = (mode) => {
    if (!draft) return;
    setDraft((prev) => {
      const d = clone(prev);
      d.rack.sort((a, b) => {
        if (a.joker) return 1;
        if (b.joker) return -1;
        if (mode === 'num') {
          return a.num - b.num || COLOR_ORDER[a.color] - COLOR_ORDER[b.color];
        }
        return COLOR_ORDER[a.color] - COLOR_ORDER[b.color] || a.num - b.num;
      });
      return d;
    });
  };

  const currentPlayer = state.players.find((p) => p.id === state.currentPlayerId);
  const winner = state.players.find((p) => p.id === state.winnerId);
  const rejectMeldId = reject && Date.now() - reject.ts < 3000 ? reject.invalidMeldId : null;

  return (
    <div className="game">
      {/* 상단: 상태 바 */}
      <div className="status-bar">
        <div className="players">
          {state.players.map((p) => (
            <div
              key={p.id}
              className={[
                'pchip',
                p.id === state.currentPlayerId ? 'turn' : '',
                p.id === me.playerId ? 'me' : '',
                p.connected ? '' : 'offline',
              ].join(' ')}
            >
              <span className="pname">{p.name}</span>
              <span className="pcount">🀫 {p.handCount}</span>
              {p.brokeIn && <span className="mini-badge">등록</span>}
            </div>
          ))}
        </div>
        <div className="pool">남은 타일 {state.poolCount}</div>
      </div>

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
      </div>

      {/* 테이블 (보드) */}
      <div className="table-area">
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
                    onDragStart={onDragStart}
                    onDragEnd={onDragEnd}
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
      </div>

      {/* 내 손패 */}
      <div className="rack-area">
        <div className="rack-header">
          <span>내 손패 ({rack.length})</span>
          {isMyTurn && (
            <div className="sort-btns">
              <button className="ghost sm" onClick={() => sortRack('num')}>
                숫자순
              </button>
              <button className="ghost sm" onClick={() => sortRack('color')}>
                색깔순
              </button>
            </div>
          )}
        </div>
        <div
          className={`rack ${overTarget === 'rack' ? 'over' : ''}`}
          onDragOver={
            isMyTurn
              ? (e) => {
                  e.preventDefault();
                  if (overTarget !== 'rack') setOverTarget('rack');
                }
              : undefined
          }
          onDrop={isMyTurn ? dropIntoRack : undefined}
        >
          {rack.map((t) => (
            <Tile
              key={t.id}
              tile={t}
              draggable={isMyTurn}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
            />
          ))}
          {rack.length === 0 && <span className="muted">손패 없음</span>}
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
