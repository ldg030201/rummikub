import { useState } from 'react';

export default function JoinForm({ onJoin, connected }) {
  const [name, setName] = useState(sessionStorage.getItem('rk_name') || '');
  const [room, setRoom] = useState(sessionStorage.getItem('rk_room') || '');

  const submit = (e) => {
    e.preventDefault();
    if (!name.trim() || !room.trim()) return;
    onJoin(room, name);
  };

  const randomRoom = () => {
    const code = Array.from({ length: 4 }, () =>
      'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]
    ).join('');
    setRoom(code);
  };

  return (
    <div className="join card">
      <h1>루미큐브 입장</h1>
      <p className="muted">
        같은 <b>방 코드</b>를 입력하면 함께 플레이해. 친구에게 방 코드와 접속 주소를 공유하면 돼.
      </p>
      <form onSubmit={submit}>
        <label>
          이름
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="닉네임"
            maxLength={20}
            autoFocus
          />
        </label>
        <label>
          방 코드
          <div className="row">
            <input
              value={room}
              onChange={(e) => setRoom(e.target.value.toUpperCase())}
              placeholder="예: ABCD"
              maxLength={12}
            />
            <button type="button" className="ghost" onClick={randomRoom}>
              랜덤
            </button>
          </div>
        </label>
        <button type="submit" className="primary" disabled={!connected}>
          {connected ? '입장' : '서버 연결 중...'}
        </button>
      </form>
    </div>
  );
}
