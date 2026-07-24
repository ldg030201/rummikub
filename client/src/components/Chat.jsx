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

const CHAT_COLS = 5; // 채팅 시트 데이터 열 수 (A~E)

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

  // ---- 엑셀 모드: 카카오톡-엑셀 위장 시트 ----
  if (excel) {
    const rows = toSheetRows(messages, myId);
    const nameBox = `E${rows.length + 2}`; // fx 이름상자에 표시할 그럴듯한 셀 좌표
    return (
      <aside className="chat chat-xl">
        <div className="chatx" ref={listRef} onScroll={onScroll}>
          {/* 열 머리글 + 좌상단 코너 (고정) */}
          <div className="chatx-corner" />
          {Array.from({ length: CHAT_COLS }, (_, c) => (
            <div key={`h${c}`} className="chatx-colh">
              {String.fromCharCode(65 + c)}
            </div>
          ))}
          {/* 데이터 행: 행마다 거터(행번호) + 5칸을 채우는 셀들 */}
          {rows.map((r, i) => {
            const rn = i + 1;
            const gutter = (
              <div key={`g${i}`} className="chatx-gutter">
                {rn}
              </div>
            );
            const fill = (key, span) => (
              <div key={key} className="chatx-fill" style={{ gridColumn: `span ${span}` }} />
            );
            if (r.kind === 'system') {
              return [
                gutter,
                <div key={`c${i}`} className="chatx-cell chatx-sys" style={{ gridColumn: 'span 5' }}>
                  {r.text}
                </div>,
              ];
            }
            if (r.kind === 'header') {
              return [
                gutter,
                <div key={`c${i}`} className="chatx-cell chatx-name" style={{ gridColumn: 'span 3' }}>
                  {r.name}:
                </div>,
                fill(`f${i}`, 2),
              ];
            }
            if (r.kind === 'time') {
              return r.mine
                ? [
                    gutter,
                    fill(`f${i}`, 2),
                    <div
                      key={`c${i}`}
                      className="chatx-cell chatx-time mine"
                      style={{ gridColumn: 'span 3' }}
                    >
                      {fmtTime(r.ts)}
                    </div>,
                  ]
                : [
                    gutter,
                    <div key={`c${i}`} className="chatx-cell chatx-time" style={{ gridColumn: 'span 3' }}>
                      {fmtTime(r.ts)}
                    </div>,
                    fill(`f${i}`, 2),
                  ];
            }
            // 일반 메시지
            return r.mine
              ? [
                  gutter,
                  fill(`f${i}`, 2),
                  <div key={`c${i}`} className="chatx-cell chatx-msg mine" style={{ gridColumn: 'span 3' }}>
                    {r.text}
                  </div>,
                ]
              : [
                  gutter,
                  <div key={`c${i}`} className="chatx-cell chatx-msg" style={{ gridColumn: 'span 3' }}>
                    {r.text}
                  </div>,
                  fill(`f${i}`, 2),
                ];
          })}
          {/* 아래 빈 셀 행들(진짜 시트처럼) */}
          {Array.from({ length: Math.max(0, 18 - rows.length) }, (_, k) => {
            const rn = rows.length + k + 1;
            return [
              <div key={`eg${k}`} className="chatx-gutter">
                {rn}
              </div>,
              <div key={`ef${k}`} className="chatx-fill" style={{ gridColumn: 'span 5' }} />,
            ];
          })}
        </div>
        {/* 입력 = 수식 입력줄(fx), 전송 = 셀 버튼 */}
        <form className="chatx-fx" onSubmit={submit}>
          <span className="chatx-namebox">{nameBox}</span>
          <span className="chatx-fxicon">fx</span>
          <input
            className="chatx-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={connected ? '' : '연결 중...'}
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
