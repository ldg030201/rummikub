import { memo, useEffect, useRef, useState } from 'react';

// 이름 → 고정 색 (해시 기반). 기본 테마용 (엑셀 모드는 셀 안 검정 텍스트).
function nameColor(name) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)) % 360;
  return `hsl(${h} 70% 68%)`;
}

// memo: 서버 state 브로드캐스트(상대 드래그 draft 스트림 포함)마다 채팅 200행이
// 재렌더되지 않게 — props는 채팅 수신·턴 전환 때만 바뀐다.
function Chat({ messages, onSend, myId, connected, onNudge, nudgeEnabled, excel }) {
  const [text, setText] = useState('');
  const [coolLeft, setCoolLeft] = useState(0); // 재촉 쿨타임 남은 초 (서버도 5초 검증)
  const listRef = useRef(null);
  const atBottomRef = useRef(true); // 사용자가 맨 아래를 보고 있는지

  useEffect(() => {
    if (coolLeft <= 0) return undefined;
    const t = setTimeout(() => setCoolLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [coolLeft]);

  const nudge = () => {
    if (coolLeft > 0) return;
    if (onNudge?.() !== false) setCoolLeft(5);
  };

  // 새 메시지: 맨 아래 근처에 있을 때만 자동 스크롤 (스크롤백 읽는 중엔 방해 X)
  useEffect(() => {
    const el = listRef.current;
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };

  const submit = (e) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    // 전송 성공(소켓 OPEN)일 때만 입력창 비움 — 끊김 중이면 내용 보존
    if (onSend(t) !== false) {
      setText('');
      atBottomRef.current = true;
    }
  };

  return (
    <aside className="chat">
      <div className="chat-title">
        <span>{excel ? '📝 메모' : '💬 채팅'}</span>
        {nudgeEnabled && (
          <button
            className="nudge-btn"
            onClick={nudge}
            disabled={!connected || coolLeft > 0}
            title={excel ? '현재 편집자에게 알림' : '현재 턴 플레이어 재촉하기'}
          >
            {excel ? '🔔 알림' : '👉 재촉'}
            {coolLeft > 0 ? ` (${coolLeft})` : ''}
          </button>
        )}
      </div>
      <div className={`chat-list ${excel ? 'xl-chat' : ''}`} ref={listRef} onScroll={onScroll}>
        {messages.length === 0 && (
          <div className="chat-empty muted">
            {excel ? '표시할 메모가 없습니다' : '아직 메시지가 없어'}
          </div>
        )}
        {/* 엑셀 모드: 카카오톡 엑셀 위장처럼 각 메시지를 스프레드시트 행(셀)으로 */}
        {excel && messages.length > 0 && (
          <div className="xl-chat-head">
            <span className="xl-chat-rownum" />
            <span>이름</span>
            <span>내용</span>
          </div>
        )}
        {messages.map((m, i) => {
          if (excel) {
            return m.system ? (
              <div key={i} className="xl-chat-row sys">
                <span className="xl-chat-rownum">{i + 1}</span>
                <span className="xl-chat-merged">{m.text}</span>
              </div>
            ) : (
              <div key={i} className={`xl-chat-row ${m.senderId === myId ? 'mine' : ''}`}>
                <span className="xl-chat-rownum">{i + 1}</span>
                <span className="xl-chat-cell name">{m.name}</span>
                <span className="xl-chat-cell text">{m.text}</span>
              </div>
            );
          }
          return m.system ? (
            <div key={i} className="chat-sys">
              {m.text}
            </div>
          ) : (
            <div key={i} className={`chat-msg ${m.senderId && m.senderId === myId ? 'mine' : ''}`}>
              <span className="chat-name" style={{ color: nameColor(m.name) }}>
                {m.name}
              </span>
              <span className="chat-text">{m.text}</span>
            </div>
          );
        })}
      </div>
      <form className="chat-form" onSubmit={submit}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={connected ? (excel ? '메모 입력...' : '메시지 입력...') : '연결 중...'}
          maxLength={200}
          disabled={!connected}
        />
        <button type="submit" className="primary sm" disabled={!connected}>
          {excel ? '입력' : '전송'}
        </button>
      </form>
    </aside>
  );
}

export default memo(Chat);
