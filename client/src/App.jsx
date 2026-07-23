import { useEffect, useState } from 'react';
import { useRummikub } from './net.js';
import { ls } from './storage.js';
import JoinForm from './components/JoinForm.jsx';
import WaitingRoom from './components/WaitingRoom.jsx';
import Game from './components/Game.jsx';
import Chat from './components/Chat.jsx';
import Toast from './components/Toast.jsx';
import {
  ExcelRibbon,
  ExcelFormulaBar,
  ExcelSheetTabs,
  ExcelStatusBar,
} from './components/ExcelFrame.jsx';

// 선택 가능한 테마 (value, 라벨). 'excel' = 회사에서 몰래 하는 엑셀 위장 모드.
const THEMES = [
  ['default', '🀄 기본'],
  ['excel', '📊 엑셀 모드'],
];

export default function App() {
  const { connected, me, state, error, reject, chat, nudged, actions } = useRummikub();
  const [toast, setToast] = useState(null);

  // 테마: html 루트에 data-theme로 건다 (FLIP 클론이 body에 붙어 .app 밖이라 반드시 :root 스코프)
  const [theme, setTheme] = useState(() => ls.get('rk_theme') || 'default');
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    ls.set('rk_theme', theme);
  }, [theme]);

  // 서버 에러/거부 메시지를 토스트로
  useEffect(() => {
    if (error) setToast({ kind: 'error', text: error.message, ts: error.ts });
  }, [error]);
  useEffect(() => {
    if (reject) setToast({ kind: 'error', text: reject.reason, ts: reject.ts });
  }, [reject]);

  const joined = me && state;
  const excel = theme === 'excel';
  // 상태바에 흘릴 게임값 (엑셀 모드 위장): 손패 수 = 개수, 내 턴 = '입력'
  const handCount = state && typeof state === 'object' ? state.myHand?.length : undefined;
  const statusMode = state?.isMyTurn ? '입력' : '준비';

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          {excel ? (
            <>
              <span className="brand-tile">X</span> 2024_4분기_실적_보고_최종.xlsx
              <span className="muted xl-suffix"> — Excel</span>
            </>
          ) : (
            <>
              <span className="brand-tile">13</span> 루미큐브
            </>
          )}
        </div>
        <div className="conn">
          <span className={`dot ${connected ? 'on' : 'off'}`} />
          {connected ? '연결됨' : '연결 중...'}
          {joined && (
            <>
              <span className="sep">|</span>방 <b>{state.roomId}</b>
              <span className="sep">|</span>
              {me.name}
              <button className="link-btn" onClick={actions.leave}>
                나가기
              </button>
            </>
          )}
          <span className="sep">|</span>
          <select
            className="theme-select"
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            title="테마 바꾸기"
            aria-label="테마 선택"
          >
            {THEMES.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </header>

      {/* 엑셀 위장 크롬: 리본 + 수식 입력줄 (게임 화면을 스프레드시트로 감싼다) */}
      {excel && <ExcelRibbon />}
      {excel && <ExcelFormulaBar cell={joined ? 'A1' : ''} value="=SUM(B2:B15)" />}

      <main className="main">
        {!joined && <JoinForm onJoin={actions.join} connected={connected} />}
        {joined && (
          <div className="layout">
            <div className="content">
              {state.phase === 'lobby' && (
                <WaitingRoom
                  state={state}
                  me={me}
                  onStart={actions.start}
                  onSettings={actions.sendSettings}
                />
              )}
              {(state.phase === 'playing' || state.phase === 'ended') && (
                <Game state={state} me={me} actions={actions} reject={reject} nudged={nudged} />
              )}
            </div>
            <Chat
              messages={chat}
              onSend={actions.sendChat}
              myId={me.playerId}
              connected={connected}
              onNudge={actions.nudge}
              nudgeEnabled={state.phase === 'playing' && !state.isMyTurn}
            />
          </div>
        )}
      </main>

      {/* 엑셀 위장 크롬: 시트 탭 + 상태바 (하단) */}
      {excel && <ExcelSheetTabs active={joined && state.phase !== 'lobby' ? '실적요약' : 'Sheet1'} />}
      {excel && <ExcelStatusBar mode={joined ? statusMode : '준비'} count={handCount} />}

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
