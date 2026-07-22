import { useCallback, useEffect, useRef, useState } from 'react';

function wsUrl() {
  if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL;
  const loc = window.location;
  // Vite 개발 서버(5173)에서 열었으면 → 백엔드는 8080
  if (loc.port === '5173') {
    return `ws://${loc.hostname}:8080/ws`;
  }
  // 프로덕션(Node 서버가 직접 서빙) → 같은 호스트
  const proto = loc.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${loc.host}/ws`;
}

// 실시간 게임 연결 훅
export function useRummikub() {
  const wsRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [me, setMe] = useState(null); // { playerId, roomId, name }
  const [state, setState] = useState(null); // 서버가 보낸 {type:'state', ...}
  const [error, setError] = useState(null); // { message, ts }
  const [reject, setReject] = useState(null); // { reason, invalidMeldId, ts }

  const pending = useRef(null); // 연결 완료 전 보낼 join 정보
  const reconnectTimer = useRef(null);
  const shouldReconnect = useRef(true);

  const rawSend = useCallback((obj) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
      return true;
    }
    return false;
  }, []);

  const connect = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState <= WebSocket.OPEN) return;
    const ws = new WebSocket(wsUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      // 재접속/최초접속 시 join 재전송
      if (pending.current) {
        ws.send(JSON.stringify({ type: 'join', ...pending.current }));
      }
    };

    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      switch (msg.type) {
        case 'joined':
          setMe({ playerId: msg.playerId, roomId: msg.roomId, name: msg.name });
          break;
        case 'state':
          setState(msg);
          break;
        case 'error':
          setError({ message: msg.message, ts: Date.now() });
          break;
        case 'commitRejected':
          setReject({ reason: msg.reason, invalidMeldId: msg.invalidMeldId, ts: Date.now() });
          break;
        default:
          break;
      }
    };

    ws.onclose = () => {
      setConnected(false);
      wsRef.current = null;
      if (shouldReconnect.current && pending.current) {
        reconnectTimer.current = setTimeout(connect, 1200);
      }
    };

    ws.onerror = () => {
      try {
        ws.close();
      } catch {
        /* noop */
      }
    };
  }, []);

  useEffect(() => {
    shouldReconnect.current = true;
    connect();
    // 저장된 세션 있으면 자동 재입장
    const savedName = localStorage.getItem('rk_name');
    const savedRoom = localStorage.getItem('rk_room');
    const active = localStorage.getItem('rk_active') === '1';
    if (active && savedName && savedRoom) {
      pending.current = { roomId: savedRoom, name: savedName };
    }
    return () => {
      shouldReconnect.current = false;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, [connect]);

  const join = useCallback(
    (roomId, name) => {
      const rid = roomId.trim().toUpperCase();
      const nm = name.trim();
      pending.current = { roomId: rid, name: nm };
      localStorage.setItem('rk_name', nm);
      localStorage.setItem('rk_room', rid);
      localStorage.setItem('rk_active', '1');
      if (!rawSend({ type: 'join', roomId: rid, name: nm })) {
        connect();
      }
    },
    [rawSend, connect]
  );

  const start = useCallback(() => rawSend({ type: 'start' }), [rawSend]);
  const draw = useCallback(() => rawSend({ type: 'draw' }), [rawSend]);
  const sendDraft = useCallback((board) => rawSend({ type: 'draft', board }), [rawSend]);
  const commit = useCallback((board) => rawSend({ type: 'commit', board }), [rawSend]);
  const newGame = useCallback(() => rawSend({ type: 'newGame' }), [rawSend]);
  const leave = useCallback(() => {
    rawSend({ type: 'leave' });
    localStorage.removeItem('rk_active');
    pending.current = null;
    setMe(null);
    setState(null);
  }, [rawSend]);

  return {
    connected,
    me,
    state,
    error,
    reject,
    actions: { join, start, draw, sendDraft, commit, newGame, leave },
  };
}
