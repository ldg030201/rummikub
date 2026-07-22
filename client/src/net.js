import { useCallback, useEffect, useRef, useState } from 'react';

function wsUrl() {
  if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL;
  const loc = window.location;
  // Vite 개발 서버(5173)에서 열었으면 → 백엔드는 8123
  if (loc.port === '5173') {
    return `ws://${loc.hostname}:8123/ws`;
  }
  // 프로덕션(Node 서버가 직접 서빙) → 같은 호스트
  const proto = loc.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${loc.host}/ws`;
}

// 세션 저장 (탭 단위 격리 — localStorage는 탭끼리 공유돼 세션이 꼬임)
const ss = {
  get: (k) => {
    try {
      return sessionStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k, v) => {
    try {
      sessionStorage.setItem(k, v);
    } catch {
      /* noop */
    }
  },
  del: (k) => {
    try {
      sessionStorage.removeItem(k);
    } catch {
      /* noop */
    }
  },
};

// 실시간 게임 연결 훅
export function useRummikub() {
  const wsRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [me, setMe] = useState(null); // { playerId, roomId, name }
  const [state, setState] = useState(null); // 서버가 보낸 {type:'state', ...}
  const [error, setError] = useState(null); // { message, ts }
  const [reject, setReject] = useState(null); // { reason, invalidMeldId, ts }

  const pending = useRef(null); // 연결 완료 전 보낼 join 정보 { roomId, name, token }
  const reconnectTimer = useRef(null);
  const shouldReconnect = useRef(true);
  const attempts = useRef(0); // 재연결 실패 횟수 (지수 백오프용)

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
      attempts.current = 0; // 성공 시 백오프 리셋
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
          // 재접속 토큰 저장 (다음 재연결/새로고침 때 좌석 복귀에 사용)
          if (msg.token) ss.set('rk_token', msg.token);
          pending.current = { roomId: msg.roomId, name: msg.name, token: msg.token };
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
        // 지수 백오프 + 지터 (동시 재연결 몰림 방지)
        const n = attempts.current;
        attempts.current = n + 1;
        const delay = Math.min(1000 * 2 ** n, 30000) + Math.floor(Math.random() * 1000);
        reconnectTimer.current = setTimeout(connect, delay);
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
    // 저장된 세션 있으면 자동 재입장 (같은 탭 새로고침 복구)
    const savedName = ss.get('rk_name');
    const savedRoom = ss.get('rk_room');
    const savedToken = ss.get('rk_token');
    const active = ss.get('rk_active') === '1';
    if (active && savedName && savedRoom) {
      pending.current = { roomId: savedRoom, name: savedName, token: savedToken };
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
      const token = ss.get('rk_token') || null; // 같은 좌석 복귀용(있으면)
      pending.current = { roomId: rid, name: nm, token };
      ss.set('rk_name', nm);
      ss.set('rk_room', rid);
      ss.set('rk_active', '1');
      attempts.current = 0;
      if (!rawSend({ type: 'join', roomId: rid, name: nm, token })) {
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
    ss.del('rk_active');
    ss.del('rk_token');
    pending.current = null;
    attempts.current = 0;
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
