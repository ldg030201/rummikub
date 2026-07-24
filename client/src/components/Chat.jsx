import { memo, useEffect, useRef, useState } from 'react';

// 이름 → 고정 색 (기본 테마용 말풍선 이름색)
function nameColor(name) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)) % 360;
  return `hsl(${h} 70% 68%)`;
}

// epoch(ms) → "오후 3:50"
function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ap = h < 12 ? '오전' : '오후';
  h = h % 12 || 12;
  return `${ap} ${h}:${m}`;
}

// 메시지 배열 → 스프레드시트 행 목록으로 번역 (표현 계층).
// 상대=왼쪽 열, 나=오른쪽 열(선택 셀 하이라이트), 발신자=헤더 셀, 시간=그룹 끝 회색 셀,
// 시스템=가로 병합 회색 셀. 긴 메시지는 셀이 세로로 자라며(wrap&grow) 격자는 유지.
function toSheetRows(messages, myId) {
  const rows = [];
  let last = null; // { mine, name }
  messages.forEach((m, i) => {
    if (m.system) {
      rows.push({ kind: 'system', text: m.text });
      last = null;
      return;
    }
    const mine = !!(m.senderId && m.senderId === myId);
    if (!mine && (!last || last.mine || last.name !== m.name)) {
      rows.push({ kind: 'header', name: m.name });
    }
    rows.push({ kind: 'msg', mine, text: m.text });
    const next = messages[i + 1];
    const nextMine = !!(next && next.senderId && next.senderId === myId);
    const groupEnd =
      !next || next.system || nextMine !== mine || (!mine && next.name !== m.name);
    if (groupEnd) rows.push({ kind: 'time', mine, ts: m.ts });
    last = { mine, name: m.name };
  });
  return rows;
}

// memo: 서버 state 브로드캐스트마다 채팅이 재렌더되지 않게.
function Chat({ messages, onSend, myId, connected, onNudge, nudgeEnabled, excel }) {
  const [text, setText] = useState('');
  const [coolLeft, setCoolLeft] = useState(0);
  const listRef = useRef(null);
  const atBottomRef = useRef(true);

  useEffect(() => {
    if (coolLeft <= 0) return undefined;
    const t = setTimeout(() => setCoolLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [coolLeft]);

  const nudge = () => {
    if (coolLeft > 0) return;
    if (onNudge?.() !== false) setCoolLeft(5);
  };

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
    if (onSend(t) !== false) {
      setText('');
      atBottomRef.current = true;
    }
  };

  // ---- 엑셀 모드: 프레임 없이 '하나의 시트'의 오른쪽 열 셀로만 렌더 ----
  // (자기 열머리글·행번호·테두리 없음 — SheetGrid의 공용 머리글/거터를 쓴다)
  if (excel) {
    const rows = toSheetRows(messages, myId);
    return (
      <aside className="chat chat-xl">
        <div className="chatx" ref={listRef} onScroll={onScroll}>
          {rows.map((r, i) => {
            if (r.kind === 'system')
              return (
                <div key={i} className="chatx-line sys">
                  {r.text}
                </div>
              );
            if (r.kind === 'header')
              return (
                <div key={i} className="chatx-line name">
                  {r.name}:
                </div>
              );
            if (r.kind === 'time')
              return (
                <div key={i} className={`chatx-line time ${r.mine ? 'mine' : ''}`}>
                  {fmtTime(r.ts)}
                </div>
              );
            return (
              <div key={i} className={`chatx-line msg ${r.mine ? 'mine' : ''}`}>
                {r.text}
              </div>
            );
          })}
        </div>
        {/* 입력·전송 = 하단 셀 행 */}
        <form className="chatx-composer" onSubmit={submit}>
          <input
            className="chatx-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={connected ? '메모…' : '연결 중…'}
            maxLength={200}
            disabled={!connected}
          />
          {nudgeEnabled && (
            <button
              type="button"
              className="chatx-tool"
              onClick={nudge}
              disabled={!connected || coolLeft > 0}
              title="현재 편집자에게 알림"
            >
              🔔{coolLeft > 0 ? coolLeft : ''}
            </button>
          )}
          <button type="submit" className="chatx-send" disabled={!connected}>
            입력
          </button>
        </form>
      </aside>
    );
  }

  // ---- 기본 테마: 말풍선 채팅 ----
  return (
    <aside className="chat">
      <div className="chat-title">
        <span>💬 채팅</span>
        {nudgeEnabled && (
          <button
            className="nudge-btn"
            onClick={nudge}
            disabled={!connected || coolLeft > 0}
            title="현재 턴 플레이어 재촉하기"
          >
            👉 재촉{coolLeft > 0 ? ` (${coolLeft})` : ''}
          </button>
        )}
      </div>
      <div className="chat-list" ref={listRef} onScroll={onScroll}>
        {messages.length === 0 && <div className="chat-empty muted">아직 메시지가 없어</div>}
        {messages.map((m, i) =>
          m.system ? (
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
          )
        )}
      </div>
      <form className="chat-form" onSubmit={submit}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={connected ? '메시지 입력...' : '연결 중...'}
          maxLength={200}
          disabled={!connected}
        />
        <button type="submit" className="primary sm" disabled={!connected}>
          전송
        </button>
      </form>
    </aside>
  );
}

export default memo(Chat);
