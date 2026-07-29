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
  // 모바일에선 채팅을 접어 게임에 화면을 내준다 (토글 버튼은 좁은 폭에서만 보임)
  const [collapsed, setCollapsed] = useState(true);
  const listRef = useRef(null);
  const atBottomRef = useRef(true);
  const stickingRef = useRef(false); // 프로그램이 스크롤을 옮기는 중인지
  // 접힌 동안 쌓인 안 읽은 메시지 수 (모바일에서 놓치지 않게)
  const [seenCount, setSeenCount] = useState(messages.length);
  const unread = collapsed ? Math.max(0, messages.length - seenCount) : 0;
  const toggle = () => {
    setCollapsed((c) => {
      if (c) setSeenCount(messages.length);
      return !c;
    });
  };

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
    if (!el) return undefined;
    const rafs = [];
    const toBottom = () => {
      if (!atBottomRef.current || !el.clientHeight) return;
      stickingRef.current = true; // 내가 옮긴 스크롤 — 아래 onScroll이 사용자 조작으로 오인하지 않게
      el.scrollTop = el.scrollHeight;
      rafs.push(
        requestAnimationFrame(() => {
          stickingRef.current = false;
        })
      );
    };
    toBottom();
    // 입장 시 히스토리처럼 내용이 이 시점 이후에 더 그려지는 경우가 있어 다음 프레임에 한 번 더.
    rafs.push(requestAnimationFrame(toBottom));
    // 숨은 탭 등으로 레이아웃이 늦게 잡히면 mount 시점엔 높이가 0이라 스크롤이 안 먹는다.
    // 높이가 잡히는 순간(창 크기 변경 포함) 다시 맨 아래로 붙인다.
    const ro = new ResizeObserver(toBottom);
    ro.observe(el);
    return () => {
      ro.disconnect();
      rafs.forEach(cancelAnimationFrame);
    };
  }, [messages]);

  const onScroll = () => {
    const el = listRef.current;
    // 레이아웃 전(높이 0)이거나 내가 옮긴 스크롤이면 판정하지 않는다 —
    // 그 순간 계산하면 항상 '아래 아님'이 돼 자동 따라가기가 영구히 꺼진다.
    if (!el || !el.clientHeight || stickingRef.current) return;
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
    <aside className={`chat ${collapsed ? 'collapsed' : ''}`}>
      <div className="chat-title">
        <span>💬 채팅</span>
        {/* 모바일 전용 접기/펼치기 (CSS로 좁은 폭에서만 노출) */}
        <button
          type="button"
          className="chat-toggle"
          onClick={toggle}
          aria-expanded={!collapsed}
          title={collapsed ? '채팅 펼치기' : '채팅 접기'}
        >
          {unread > 0 && <span className="chat-unread">{unread > 99 ? '99+' : unread}</span>}
          {collapsed ? '▲ 펼치기' : '▼ 접기'}
        </button>
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
