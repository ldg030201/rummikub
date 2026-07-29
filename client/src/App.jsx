import { useEffect, useState } from 'react';
import { useRummikub } from './net.js';
import { ls } from './storage.js';
import JoinForm from './components/JoinForm.jsx';
import WaitingRoom from './components/WaitingRoom.jsx';
import Game, { TurnTimer, useDeadlineLocal } from './components/Game.jsx';
import Chat from './components/Chat.jsx';
import Toast from './components/Toast.jsx';
import {
  ExcelRibbon,
  ExcelFormulaBar,
  ExcelSheetTabs,
  ExcelStatusBar,
} from './components/ExcelFrame.jsx';
import { SheetGrid } from './components/SheetGrid.jsx';

// 선택 가능한 테마 (value, 라벨). 'excel' = 회사에서 몰래 하는 엑셀 위장 모드.
const THEMES = [
  ['default', '🀄 기본'],
  ['excel', '📊 엑셀 모드'],
];

// 엑셀 모드일 땐 셀렉트 라벨도 위장 어휘로 (화면에 '기본/엑셀 모드'라는 게임 티가 남지 않게)
const THEMES_EXCEL = [
  ['default', '표준 보기'],
  ['excel', '페이지 레이아웃'],
];

// 엑셀 파비콘 (초록 문서 + 흰 X) — 탭/작업표시줄 위장용
const EXCEL_FAVICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect x='4' y='2' width='24' height='28' rx='2' fill='%23107c41'/%3E%3Cpath d='M11 10l10 12M21 10L11 22' stroke='%23fff' stroke-width='3' stroke-linecap='round'/%3E%3C/svg%3E";

export default function App() {
  const { connected, me, state, error, reject, chat, nudged, actions } = useRummikub();
  const [toast, setToast] = useState(null);
  const [activeCell, setActiveCell] = useState('A1'); // 엑셀 이름 상자에 표시할 활성 셀 참조

  // 테마: html 루트에 data-theme로 건다 (FLIP 클론이 body에 붙어 .app 밖이라 반드시 :root 스코프)
  const [theme, setTheme] = useState(() => ls.get('rk_theme') || 'default');
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    ls.set('rk_theme', theme);
    // 위장은 화면 안에서 끝나지 않는다 — 탭 제목·파비콘·작업표시줄이 제일 먼저 보인다.
    const excelMode = theme === 'excel';
    document.title = excelMode ? '통합 문서1 - Excel' : '루미큐브';
    const icon = document.querySelector('link[rel="icon"]');
    if (icon) {
      if (!icon.dataset.original) icon.dataset.original = icon.getAttribute('href');
      icon.setAttribute('href', excelMode ? EXCEL_FAVICON : icon.dataset.original);
    }
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
  const t = (a, b) => (excel ? b : a); // 엑셀 모드 위장 카피
  // 상태바에 흘릴 게임값 (엑셀 모드 위장): 손패 수 = 개수, 내 턴 = '입력'
  const handCount = state && typeof state === 'object' ? state.myHand?.length : undefined;
  const statusMode = state?.isMyTurn ? '입력' : '준비';

  // 엑셀 모드: 턴 상태('OOO 님 편집 중')와 남은 시간을 수식 입력줄에 실어 보낸다.
  // 시트 안에는 격자와 타일만 남겨 배경과 분리된 배너가 생기지 않게 하려는 것.
  const deadlineLocal = useDeadlineLocal(state);
  const turnPlayer = joined ? state.players?.find((p) => p.id === state.currentPlayerId) : null;
  const formulaValue = !joined
    ? '=SUM(B2:B15)'
    : state.phase === 'lobby'
      ? '=WAIT("공유 참가자 대기 중")'
      : state.phase === 'ended'
        ? '=LOCK("문서 잠김 — 편집 종료")'
        : state.isMyTurn
          ? '=EDIT("입력 모드 — 내가 편집 중")'
          : `=WAIT("${turnPlayer?.name ?? '동료'} 님 편집 중")`;
  // 엑셀 모드에선 콘텐츠를 진짜 시트 프레임(열머리글·행번호·격자)으로 감싼다
  const wrapSheet = (node) => (excel ? <SheetGrid onSelect={setActiveCell}>{node}</SheetGrid> : node);

  const mainContent = joined ? (
    <>
      {state.phase === 'lobby' && (
        <WaitingRoom
          state={state}
          me={me}
          onStart={actions.start}
          onSettings={actions.sendSettings}
          excel={excel}
        />
      )}
      {(state.phase === 'playing' || state.phase === 'ended') && (
        <Game state={state} me={me} actions={actions} reject={reject} nudged={nudged} excel={excel} />
      )}
    </>
  ) : null;

  const chatEl = joined ? (
    <Chat
      messages={chat}
      onSend={actions.sendChat}
      myId={me.playerId}
      connected={connected}
      onNudge={actions.nudge}
      nudgeEnabled={state.phase === 'playing' && !state.isMyTurn && !state.spectator}
      excel={excel}
    />
  ) : null;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          {excel ? (
            <>
              <span className="brand-tile">X</span> 통합 문서1
              <span className="muted xl-suffix"> — Excel</span>
            </>
          ) : (
            <>
              <span className="brand-tile">13</span> 루미큐브
            </>
          )}
        </div>
        {/* 엑셀 모드에선 게임 단어를 전부 엑셀 어휘로 — 정지 화면에서 게임임을 알 수 있는 문자가 없어야 한다 */}
        <div className="conn">
          <span className={`dot ${connected ? 'on' : 'off'}`} />
          {connected ? t('연결됨', '저장됨') : t('연결 중...', '동기화 중...')}
          {joined && (
            <>
              <span className="sep">|</span>
              {t('방 ', '')}
              <b>{excel ? `${state.roomId}.xlsx` : state.roomId}</b>
              <span className="sep">|</span>
              {me.name}
              {state.spectator && (
                <span className="badge watch">{excel ? '읽기 전용' : '관전'}</span>
              )}
              <button className="link-btn" onClick={actions.leave}>
                {t('나가기', '닫기')}
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
            {(excel ? THEMES_EXCEL : THEMES).map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </header>

      {/* 엑셀 위장 크롬: 리본 + 수식 입력줄 (게임 화면을 스프레드시트로 감싼다) */}
      {excel && <ExcelRibbon />}
      {excel && (
        <ExcelFormulaBar
          cell={activeCell}
          value={formulaValue}
          right={deadlineLocal != null ? <TurnTimer deadline={deadlineLocal} /> : null}
        />
      )}

      <main className="main">
        {!joined && wrapSheet(<JoinForm onJoin={actions.join} connected={connected} excel={excel} />)}
        {/* 엑셀 모드: 게임+채팅을 '하나의 시트'(열 머리글·행번호 한 벌 공유)에 나란히. 기본 모드: 좌우 분리. */}
        {joined &&
          (excel ? (
            <SheetGrid onSelect={setActiveCell}>
              {/* 대기실 폼은 display:contents라 래퍼 없이 sheet-body 직속이어야 셀이 격자에 붙는다.
                  게임 보드는 왼쪽 열 범위·FLIP 앵커용 .sheet-game 래퍼가 필요. */}
              {state.phase === 'lobby' ? (
                mainContent
              ) : (
                <div className="sheet-game">{mainContent}</div>
              )}
              {chatEl}
            </SheetGrid>
          ) : (
            <div className="layout">
              <div className="content">{mainContent}</div>
              {chatEl}
            </div>
          ))}
      </main>

      {/* 엑셀 위장 크롬: 시트 탭 + 상태바 (하단) */}
      {excel && <ExcelSheetTabs active={joined && state.phase !== 'lobby' ? '실적요약' : 'Sheet1'} />}
      {excel && <ExcelStatusBar mode={joined ? statusMode : '준비'} count={handCount} />}

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
