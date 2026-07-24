// 대기실: 참가자 목록 + 방 설정(방장) + 시작
import { useRef } from 'react';
import { useSheet, useGridSnap } from './SheetGrid.jsx';

const TURN_TIME_LABELS = [
  [30000, '30초'],
  [60000, '1분'],
  [90000, '1분 30초'],
  [120000, '2분'],
  [180000, '3분'],
  [0, '무제한'],
];
const SET_COUNT_LABELS = [
  ['auto', '자동 (5인↑ 2세트)'],
  [1, '1세트 (106장)'],
  [2, '2세트 (212장)'],
];

export default function WaitingRoom({ state, me, onStart, onSettings, excel }) {
  const canStart = state.players.length >= 2;
  const isHost = state.hostId === me.playerId;
  const s = state.settings || { turnTimeMs: 90000, maxPlayers: 6, setCount: 'auto' };
  const t = (a, b) => (excel ? b : a); // 엑셀 모드 위장 카피

  const labelOf = (pairs, v) => pairs.find(([val]) => val === v)?.[1] ?? String(v);
  const effectiveSets =
    s.setCount === 'auto' ? (state.players.length >= 5 ? 2 : 1) : s.setCount;
  const cardRef = useRef(null);
  const sheet = useSheet();
  const snap = useGridSnap(cardRef, excel, sheet.bodyRef); // 폼을 배경 격자에 스냅

  return (
    <div
      className="waiting card"
      ref={cardRef}
      style={snap ? { transform: `translate(${snap.x}px, ${snap.y}px)` } : undefined}
    >
      <h1>{t('대기실', '공유 통합 문서')}</h1>
      <div className="room-share">
        {t('방 코드', '문서 코드')} <span className="code">{state.roomId}</span>
        <span className="muted"> {t('— 이 코드와 접속 주소를 친구에게 공유해', '— 이 코드와 주소를 동료에게 공유해')}</span>
      </div>

      <ul className="player-list">
        {state.players.map((p) => (
          <li key={p.id} className={p.id === me.playerId ? 'me' : ''}>
            <span className={`dot ${p.connected ? 'on' : 'off'}`} />
            {p.name}
            {p.id === state.hostId && <span className="badge">{t('방장', '소유자')}</span>}
            {p.id === me.playerId && <span className="badge you">나</span>}
          </li>
        ))}
      </ul>

      {/* 방 설정 — 방장만 변경 가능, 나머지는 현재 값 표시 */}
      <div className="room-settings">
        <div className="setting-row">
          <span className="setting-label">{t('턴 시간', '자동 저장')}</span>
          {isHost ? (
            <select
              value={s.turnTimeMs}
              onChange={(e) => onSettings({ turnTimeMs: Number(e.target.value) })}
            >
              {TURN_TIME_LABELS.map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          ) : (
            <b>{labelOf(TURN_TIME_LABELS, s.turnTimeMs)}</b>
          )}
        </div>
        <div className="setting-row">
          <span className="setting-label">{t('최대 인원', '공유 인원')}</span>
          {isHost ? (
            <select
              value={s.maxPlayers}
              onChange={(e) => onSettings({ maxPlayers: Number(e.target.value) })}
            >
              {[2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>
                  {n}명
                </option>
              ))}
            </select>
          ) : (
            <b>{s.maxPlayers}명</b>
          )}
        </div>
        <div className="setting-row">
          <span className="setting-label">{t('타일 세트', '데이터 세트')}</span>
          {isHost ? (
            <select
              value={s.setCount}
              onChange={(e) => {
                const v = e.target.value;
                onSettings({ setCount: v === 'auto' ? 'auto' : Number(v) });
              }}
            >
              {SET_COUNT_LABELS.map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          ) : (
            <b>{labelOf(SET_COUNT_LABELS, s.setCount)}</b>
          )}
        </div>
        {!isHost && (
          <p className="hint muted">{t('설정은 방장만 바꿀 수 있어.', '설정은 소유자만 바꿀 수 있어.')}</p>
        )}
      </div>

      <p className="muted">
        {t('현재 ', '현재 ')}
        {state.players.length}
        {t('명 · 시작하면 ', '명 공유 중 · 편집 시작하면 ')}
        {effectiveSets}
        {t('세트(', '세트(')}
        {effectiveSets * 106}
        {t('장) 사용 · 각자 14장으로 시작', '행) · 각자 14행으로 시작')}
      </p>

      <button className="primary big" onClick={onStart} disabled={!canStart}>
        {canStart
          ? t('게임 시작 (아무나 눌러도 돼)', '편집 시작 (아무나 눌러도 돼)')
          : t('2명 이상 모여야 시작 가능', '2명 이상 있어야 편집 시작')}
      </button>
      <p className="hint muted">{t('최대 6명까지 함께 할 수 있어.', '최대 6명까지 공동 편집 가능.')}</p>
    </div>
  );
}
