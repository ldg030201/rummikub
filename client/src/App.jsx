import { useEffect, useState } from 'react';
import { useRummikub } from './net.js';
import JoinForm from './components/JoinForm.jsx';
import WaitingRoom from './components/WaitingRoom.jsx';
import Game from './components/Game.jsx';
import Chat from './components/Chat.jsx';
import Toast from './components/Toast.jsx';

export default function App() {
  const { connected, me, state, error, reject, chat, nudged, actions } = useRummikub();
  const [toast, setToast] = useState(null);

  // 서버 에러/거부 메시지를 토스트로
  useEffect(() => {
    if (error) setToast({ kind: 'error', text: error.message, ts: error.ts });
  }, [error]);
  useEffect(() => {
    if (reject) setToast({ kind: 'error', text: reject.reason, ts: reject.ts });
  }, [reject]);

  const joined = me && state;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-tile">13</span> 루미큐브
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
        </div>
      </header>

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

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
