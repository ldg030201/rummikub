import { useState } from 'react';
import { ss } from '../storage.js';
import { useSheet } from './SheetGrid.jsx';

export default function JoinForm({ onJoin, connected, excel }) {
  const [name, setName] = useState(ss.get('rk_name') || '');
  const [room, setRoom] = useState(ss.get('rk_room') || 'DONG');
  const t = (a, b) => (excel ? b : a); // 엑셀 모드 위장 카피
  const sheet = useSheet(); // 엑셀 분기에서 폼을 시트 열 가운데에 놓을 때 사용

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

  // 엑셀 모드: '테이블(셀)을 먼저 짜고 그 셀 안에 기능을 넣는다'.
  // .xl-form은 display:contents라 각 셀이 곧 sheet-body 그리드의 셀. 시트 열/행에 직접 배치돼
  // 배경 격자와 완전히 하나가 된다. FW=폼 폭(셀 수), c0=가운데 정렬 시작 열.
  if (excel) {
    const FW = 11;
    const c0 = Math.max(1, Math.round((sheet.cols - FW) / 2) + 1);
    const col = (a, b) => ({ gridColumn: `${c0 + a} / ${c0 + b}` });
    return (
      <form className="xl-form" onSubmit={submit}>
        <div className="xf-cell xf-title" style={{ ...col(0, FW), gridRow: 2 }}>
          통합 문서 열기
        </div>
        <div className="xf-cell xf-desc" style={{ ...col(0, FW), gridRow: '3 / 5' }}>
          같은 문서 코드를 입력하면 공동 편집돼. 동료에게 코드와 접속 주소를 공유해.
        </div>
        <div className="xf-cell xf-label" style={{ ...col(0, 3), gridRow: 5 }}>
          사용자 이름
        </div>
        <div className="xf-cell xf-value" style={{ ...col(3, FW), gridRow: 5 }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="이름"
            maxLength={20}
            autoFocus
          />
        </div>
        <div className="xf-cell xf-label" style={{ ...col(0, 3), gridRow: 6 }}>
          문서 코드
        </div>
        <div className="xf-cell xf-value" style={{ ...col(3, 8), gridRow: 6 }}>
          <input
            value={room}
            onChange={(e) => setRoom(e.target.value.toUpperCase())}
            placeholder="예: SALES"
            maxLength={12}
          />
        </div>
        <button type="button" className="xf-cell xf-btn" style={{ ...col(8, FW), gridRow: 6 }} onClick={randomRoom}>
          새 문서
        </button>
        <button
          type="submit"
          className="xf-cell xf-submit"
          style={{ ...col(0, FW), gridRow: 7 }}
          disabled={!connected}
        >
          {connected ? '열기' : '연결 중…'}
        </button>
      </form>
    );
  }

  return (
    <div className="join card">
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
