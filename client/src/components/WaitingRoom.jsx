// 대기실: 참가자 목록 + 방 설정(방장) + 시작
import { useSheet } from './SheetGrid.jsx';

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
  const spectator = !!state.spectator; // 정원이 차서 좌석을 못 받은 관전자
  const canStart = state.players.length >= 2 && !spectator;
  const isHost = state.hostId === me.playerId;
  const spectators = state.spectators || [];
  const s = state.settings || {
    turnTimeMs: 90000,
    maxPlayers: 6,
    setCount: 'auto',
    revealHands: false,
  };
  const t = (a, b) => (excel ? b : a); // 엑셀 모드 위장 카피

  const labelOf = (pairs, v) => pairs.find(([val]) => val === v)?.[1] ?? String(v);
  const effectiveSets =
    s.setCount === 'auto' ? (state.players.length >= 5 ? 2 : 1) : s.setCount;
  const sheet = useSheet(); // 엑셀 분기에서 폼을 시트 열 가운데에 놓을 때 사용

  // 엑셀 모드: display:contents로 각 셀을 sheet-body 그리드의 실제 셀에 직접 배치
  if (excel) {
    const FW = 11;
    const c0 = Math.max(1, Math.round((sheet.cols - FW) / 2) + 1);
    const col = (a, b) => ({ gridColumn: `${c0 + a} / ${c0 + b}` });
    let r = 2;
    const cells = [];
    cells.push(
      <div key="t" className="xf-cell xf-title" style={{ ...col(0, FW), gridRow: r++ }}>
        공유 통합 문서
      </div>
    );
    cells.push(
      <div key="s" className="xf-cell xf-desc" style={{ ...col(0, FW), gridRow: r++ }}>
        문서 코드 <b className="xf-code">{state.roomId}</b> — 이 코드와 주소를 동료에게 공유해
      </div>
    );
    state.players.forEach((p) => {
      cells.push(
        <div
          key={p.id}
          className={`xf-cell xf-player ${p.id === me.playerId ? 'me' : ''}`}
          style={{ ...col(0, FW), gridRow: r++ }}
        >
          <span className={`dot ${p.connected ? 'on' : 'off'}`} />
          {p.name}
          {p.id === state.hostId && <span className="badge">소유자</span>}
          {p.id === me.playerId && <span className="badge you">나</span>}
        </div>
      );
    });
    // 관전자 — 좌석이 없어 기다리는 사람들 (엑셀에선 '읽기 전용으로 보는 중')
    spectators.forEach((sp) => {
      cells.push(
        <div
          key={`sp-${sp.id}`}
          className={`xf-cell xf-player watch ${sp.id === me.playerId ? 'me' : ''}`}
          style={{ ...col(0, FW), gridRow: r++ }}
        >
          <span className="dot watch">👀</span>
          {sp.name}
          <span className="badge watch">읽기 전용</span>
          {sp.id === me.playerId && <span className="badge you">나</span>}
        </div>
      );
    });
    const setRow = (label, control) => {
      const rr = r++;
      cells.push(
        <div key={`${label}l`} className="xf-cell xf-label" style={{ ...col(0, 4), gridRow: rr }}>
          {label}
        </div>
      );
      cells.push(
        <div key={`${label}v`} className="xf-cell xf-value" style={{ ...col(4, FW), gridRow: rr }}>
          {control}
        </div>
      );
    };
    setRow(
      '자동 저장',
      isHost ? (
        <select value={s.turnTimeMs} onChange={(e) => onSettings({ turnTimeMs: Number(e.target.value) })}>
          {TURN_TIME_LABELS.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
      ) : (
        <b>{labelOf(TURN_TIME_LABELS, s.turnTimeMs)}</b>
      )
    );
    setRow(
      '공유 인원',
      isHost ? (
        <select value={s.maxPlayers} onChange={(e) => onSettings({ maxPlayers: Number(e.target.value) })}>
          {[2, 3, 4, 5, 6].map((n) => (
            <option key={n} value={n}>
              {n}명
            </option>
          ))}
        </select>
      ) : (
        <b>{s.maxPlayers}명</b>
      )
    );
    setRow(
      '데이터 세트',
      isHost ? (
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
      )
    );
    // 패 공개(디버그) — 위장 어휘로 감추더라도 토글 자체는 엑셀 모드에도 있어야 한다.
    // 없으면 방장이 엑셀 모드에서 이 방이 패 공개 중인지 확인하거나 끌 방법이 사라진다.
    setRow(
      '전체 범위 표시',
      isHost ? (
        <select
          value={s.revealHands ? 'on' : 'off'}
          onChange={(e) => onSettings({ revealHands: e.target.value === 'on' })}
        >
          <option value="off">숨김</option>
          <option value="on">표시</option>
        </select>
      ) : (
        <b>{s.revealHands ? '표시' : '숨김'}</b>
      )
    );
    if (s.revealHands) {
      cells.push(
        <div key="warn" className="xf-cell xf-warn" style={{ ...col(0, FW), gridRow: r++ }}>
          ⚠️ 이 문서는 전체 범위가 공개돼 있어 — 공유 인원 누구나 서로의 행을 볼 수 있어
        </div>
      );
    }
    if (!isHost) {
      cells.push(
        <div key="nothost" className="xf-cell xf-desc" style={{ ...col(0, FW), gridRow: r++ }}>
          설정은 소유자만 바꿀 수 있어
        </div>
      );
    }
    cells.push(
      <div key="info" className="xf-cell xf-desc" style={{ ...col(0, FW), gridRow: r++ }}>
        현재 {state.players.length}명 공유 중
        {spectators.length > 0 && ` · 읽기 전용 ${spectators.length}명`} · 편집 시작하면{' '}
        {effectiveSets}세트({effectiveSets * 106}행) · 각자 14행
      </div>
    );
    cells.push(
      <button
        key="start"
        type="button"
        className="xf-cell xf-submit"
        style={{ ...col(0, FW), gridRow: r++ }}
        onClick={onStart}
        disabled={!canStart}
      >
        {spectator
          ? '읽기 전용 — 다음 편집부터 참여돼'
          : canStart
            ? '편집 시작 (아무나 눌러도 돼)'
            : '2명 이상 있어야 시작'}
      </button>
    );
    return <div className="xl-form">{cells}</div>;
  }

  return (
    <div className="waiting card">
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

      {/* 관전자 — 좌석이 없어 기다리는 사람들 */}
      {spectators.length > 0 && (
        <ul className="player-list spectator-list">
          {spectators.map((s) => (
            <li key={s.id} className={s.id === me.playerId ? 'me' : ''}>
              <span className="dot watch">👀</span>
              {s.name}
              <span className="badge watch">{t('관전', '읽기 전용')}</span>
              {s.id === me.playerId && <span className="badge you">나</span>}
            </li>
          ))}
        </ul>
      )}

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
        {/* 패 공개(디버그) — 켜면 방 전원이 게임 화면의 버튼으로 서로의 패를 볼 수 있다 */}
        <div className="setting-row">
          <span className="setting-label">{t('패 공개 (디버그)', '전체 범위 표시')}</span>
          {isHost ? (
            <select
              value={s.revealHands ? 'on' : 'off'}
              onChange={(e) => onSettings({ revealHands: e.target.value === 'on' })}
            >
              <option value="off">끔</option>
              <option value="on">켬</option>
            </select>
          ) : (
            <b>{s.revealHands ? '켬' : '끔'}</b>
          )}
        </div>
        {s.revealHands && (
          <p className="hint warn">
            {t(
              '⚠️ 이 방은 패 공개 모드야 — 참가자 누구나 게임 화면의 「패 보기」 버튼으로 서로의 손패를 볼 수 있어.',
              '⚠️ 이 문서는 전체 범위가 공개돼 있어.'
            )}
          </p>
        )}
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
        {spectator
          ? t('👀 관전 중 — 자리가 나면 참여돼', '👀 읽기 전용 — 자리가 나면 편집 참여')
          : canStart
            ? t('게임 시작 (아무나 눌러도 돼)', '편집 시작 (아무나 눌러도 돼)')
            : t('2명 이상 모여야 시작 가능', '2명 이상 있어야 편집 시작')}
      </button>
      <p className="hint muted">{t('최대 6명까지 함께 할 수 있어.', '최대 6명까지 공동 편집 가능.')}</p>
    </div>
  );
}
