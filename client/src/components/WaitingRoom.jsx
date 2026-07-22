export default function WaitingRoom({ state, me, onStart }) {
  const canStart = state.players.length >= 2;
  const setInfo = state.players.length >= 5 ? '2세트(212타일)' : '1세트(106타일)';

  return (
    <div className="waiting card">
      <h1>대기실</h1>
      <div className="room-share">
        방 코드 <span className="code">{state.roomId}</span>
        <span className="muted"> — 이 코드와 접속 주소를 친구에게 공유해</span>
      </div>

      <ul className="player-list">
        {state.players.map((p) => (
          <li key={p.id} className={p.id === me.playerId ? 'me' : ''}>
            <span className={`dot ${p.connected ? 'on' : 'off'}`} />
            {p.name}
            {p.id === state.hostId && <span className="badge">방장</span>}
            {p.id === me.playerId && <span className="badge you">나</span>}
          </li>
        ))}
      </ul>

      <p className="muted">
        현재 {state.players.length}명 · 시작하면 {setInfo} 사용 · 각자 14장으로 시작
      </p>

      <button className="primary big" onClick={onStart} disabled={!canStart}>
        {canStart ? '게임 시작 (아무나 눌러도 돼)' : '2명 이상 모여야 시작 가능'}
      </button>
      <p className="hint muted">최대 6명까지 함께 할 수 있어.</p>
    </div>
  );
}
