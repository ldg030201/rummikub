import { useRef, useState } from 'react';
import { ss } from '../storage.js';
import { useSheet, useGridSnap } from './SheetGrid.jsx';

export default function JoinForm({ onJoin, connected, excel }) {
  const [name, setName] = useState(ss.get('rk_name') || '');
  const [room, setRoom] = useState(ss.get('rk_room') || 'DONG');
  const t = (a, b) => (excel ? b : a); // 엑셀 모드 위장 카피
  const cardRef = useRef(null);
  const sheet = useSheet();
  const snap = useGridSnap(cardRef, excel, sheet.bodyRef); // 폼을 배경 격자에 스냅

  const submit = (e) => {
    e.preventDefault();
    if (!name.trim() || !room.trim()) return;
    onJoin(room, name);
  };

  const randomRoom = () => {
    // 6자 영숫자(혼동 문자 제외) — 무차별 열거 비용 ↑
    const code = Array.from({ length: 6 }, () =>
      'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]
    ).join('');
    setRoom(code);
  };

  return (
    <div
      className="join card"
      ref={cardRef}
      style={snap ? { transform: `translate(${snap.x}px, ${snap.y}px)` } : undefined}
    >
      <h1>{t('루미큐브 입장', '통합 문서 열기')}</h1>
      <p className="muted">
        {t('같은 ', '같은 ')}
        <b>{t('방 코드', '문서 코드')}</b>
        {t(
          '를 입력하면 함께 플레이해. 친구에게 방 코드와 접속 주소를 공유하면 돼.',
          '를 입력하면 공동 편집돼. 동료에게 코드와 접속 주소를 공유하면 돼.'
        )}
      </p>
      <form onSubmit={submit}>
        <label>
          {t('이름', '사용자 이름')}
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('닉네임', '이름')}
            maxLength={20}
            autoFocus
          />
        </label>
        <label>
          {t('방 코드', '문서 코드')}
          <div className="row">
            <input
              value={room}
              onChange={(e) => setRoom(e.target.value.toUpperCase())}
              placeholder={t('예: ABCD', '예: SALES')}
              maxLength={12}
            />
            <button type="button" className="ghost" onClick={randomRoom}>
              {t('랜덤', '새 문서')}
            </button>
          </div>
        </label>
        <button type="submit" className="primary" disabled={!connected}>
          {connected ? t('입장', '열기') : t('서버 연결 중...', '연결 중...')}
        </button>
      </form>
    </div>
  );
}
