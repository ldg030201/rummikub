// 루미큐브 실시간 서버
//  - HTTP: 빌드된 클라이언트(client/dist) 정적 서빙 (SPA fallback)
//  - WS  : /ws 에서 실시간 게임 동기화
//
// 실행: npm start  (기본 포트 8123, PORT 환경변수로 변경 가능)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';

import { Room, serializeBase, personalizeState } from './game.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIST = path.resolve(__dirname, '../../client/dist');
const PORT = Number(process.env.PORT) || 8123;

const rooms = new Map(); // roomId -> Room

function getOrCreateRoom(roomId) {
  let room = rooms.get(roomId);
  if (!room) {
    room = new Room(roomId);
    rooms.set(roomId, room);
  }
  return room;
}

const ROOM_GC_MS = 5 * 60 * 1000; // 진행 중이던 빈 방은 5분 재접속 유예 후 정리

// 방에 걸린 타이머 해제 (키: '_gcTimer' | '_turnSkip' | '_turnTimer')
function clearRoomTimer(room, key) {
  if (room[key]) {
    clearTimeout(room[key]);
    room[key] = null;
  }
}

// 빈 방 정리: 로비면 즉시 삭제, 진행/종료 중이면 재접속 유예(GC) 후 삭제.
// (진행 중 방을 즉시 지우면 잠깐 전원 끊길 때 게임/재접속이 영구 소실됨)
function cleanupIfEmpty(room) {
  if (!room.isEmpty()) {
    clearRoomTimer(room, '_gcTimer');
    return;
  }
  clearRoomTimer(room, '_turnSkip');
  clearRoomTimer(room, '_turnTimer'); // 빈 방에서 타이머 회전 방지 (deadline은 유지돼 재접속 시 이어감)
  if (room.phase === 'lobby') {
    clearRoomTimer(room, '_gcTimer');
    rooms.delete(room.id);
    return;
  }
  if (!room._gcTimer) {
    room._gcTimer = setTimeout(() => {
      room._gcTimer = null;
      if (room.isEmpty()) rooms.delete(room.id);
    }, ROOM_GC_MS);
    room._gcTimer.unref?.();
  }
}

const TURN_GRACE_MS = 45 * 1000; // 현재 턴 플레이어가 끊겨도 이 시간 안에 재접속하면 턴 유지

// 현재 턴 플레이어가 끊긴 상태면 유예 후 턴을 넘긴다 (새로고침으로 턴을 뺏기지 않게).
// 현재 턴 플레이어가 접속돼 있으면 예약된 넘김을 취소한다.
function syncTurnSkip(room) {
  const cur = room.game && room.phase === 'playing' ? room.currentPlayerId() : null;
  const p = cur ? room.players.get(cur) : null;
  if (p && !p.connected) {
    if (!room._turnSkip) {
      room._turnSkip = setTimeout(() => {
        room._turnSkip = null;
        const c = room.currentPlayerId();
        const cp = c ? room.players.get(c) : null;
        if (room.game && room.phase === 'playing' && cp && !cp.connected) {
          room.advanceTurn();
          broadcastRoom(room);
          syncTurnSkip(room);
        }
      }, TURN_GRACE_MS);
      room._turnSkip.unref?.();
    }
  } else {
    clearRoomTimer(room, '_turnSkip');
  }
}

// ---- 턴 제한시간 ----
// game.turnDeadline(마감시각) 기준으로 만료 타이머를 건다. deadline이 안 바뀌었으면
// 기존 타이머 유지(draft 갱신마다 리셋되지 않게). 만료 시 자동 한 장 뽑기 + 턴 넘김.
function syncTurnTimer(room) {
  const g = room.game;
  if (!g || room.phase !== 'playing' || !g.turnDeadline) {
    clearRoomTimer(room, '_turnTimer');
    return;
  }
  if (room._turnTimer && room._turnTimerDeadline === g.turnDeadline) return;
  clearRoomTimer(room, '_turnTimer');
  room._turnTimerDeadline = g.turnDeadline;
  room._turnTimer = setTimeout(() => {
    room._turnTimer = null;
    const g2 = room.game;
    if (!g2 || room.phase !== 'playing') return;
    if (Date.now() < g2.turnDeadline) {
      // 그 사이 턴이 바뀌어 deadline이 갱신됨 → 새 deadline으로 재예약
      syncTurnTimer(room);
      return;
    }
    const pid = room.currentPlayerId();
    const name = room.players.get(pid)?.name ?? '누군가';
    room.timeoutTurn();
    sysChat(room, `⏰ ${name}님 시간 초과! 한 장 뽑고 턴이 넘어갔어`);
    pushState(room);
  }, Math.max(0, g.turnDeadline - Date.now()) + 50);
  room._turnTimer.unref?.();
}

// 상태 전파 + 턴 넘김/제한시간 타이머 동기화 (턴/접속이 바뀔 때마다 호출)
function pushState(room) {
  broadcastRoom(room);
  syncTurnSkip(room);
  syncTurnTimer(room);
}

// 접속 중인 참가자(좌석 + 관전자) 순회 (브로드캐스트 공통 — 접속자 판정을 한 곳으로)
function eachConnected(room, fn) {
  for (const [pid, p] of room.players) {
    if (p.connected && p.socket) fn(pid, p);
  }
  for (const [sid, s] of room.spectators) {
    if (s.connected && s.socket) fn(sid, s);
  }
}

// 슬라이딩 윈도우 속도 제한: state의 `<prefix>Win/<prefix>Cnt` 필드로 windowMs당 max건 검사
function rateLimited(state, prefix, windowMs, max) {
  const now = Date.now();
  const winKey = `${prefix}Win`;
  const cntKey = `${prefix}Cnt`;
  if (!state[winKey] || now - state[winKey] > windowMs) {
    state[winKey] = now;
    state[cntKey] = 0;
  }
  state[cntKey] += 1;
  return state[cntKey] > max;
}

// 채팅 한 건을 방 전체에 전송
function broadcastChat(room, entry) {
  if (!entry) return;
  eachConnected(room, (_, p) => send(p.socket, { type: 'chat', ...entry }));
}

// 시스템 메시지 (게임 시작/승리 등)
function sysChat(room, text) {
  broadcastChat(room, room.addChat('', text, true));
}

// ---- 정적 파일 서빙 ----
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

// 모든 응답에 붙는 보안 헤더 (클릭재킹·MIME 스니핑·정보유출 방어)
const SECURITY_HEADERS = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  // 자체 완결형 SPA + 같은 호스트 WebSocket. 인라인 스타일(속성)만 허용, 스크립트는 self만.
  'Content-Security-Policy':
    "default-src 'self'; " +
    "script-src 'self'; " +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data:; " +
    "connect-src 'self' ws: wss:; " +
    "base-uri 'self'; " +
    "form-action 'self'; " +
    "frame-ancestors 'none'",
};

function writeHead(res, status, extra) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...extra });
}

function serveStatic(req, res) {
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  let filePath = path.join(CLIENT_DIST, urlPath);

  // 경로 탈출 방지
  if (!filePath.startsWith(CLIENT_DIST)) {
    writeHead(res, 403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA fallback: index.html
      const indexPath = path.join(CLIENT_DIST, 'index.html');
      fs.readFile(indexPath, (err2, indexData) => {
        if (err2) {
          writeHead(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end(
            '클라이언트가 아직 빌드되지 않았어. client 폴더에서 `npm run build` 를 먼저 실행해줘.\n' +
              '(개발 중이라면 Vite 개발 서버 http://localhost:5173 로 접속)'
          );
        } else {
          writeHead(res, 200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
          res.end(indexData);
        }
      });
      return;
    }
    const ext = path.extname(filePath);
    // 캐시 정책: 해시 붙은 Vite 에셋(/assets/)은 영구 캐시, 그 외(index.html 등)는 매번 재검증.
    // (헤더가 없으면 브라우저가 휴리스틱 캐시를 써서 새 빌드가 반영 안 되는 문제가 있었음)
    const cache = urlPath.startsWith('/assets/')
      ? 'public, max-age=31536000, immutable'
      : 'no-cache';
    writeHead(res, 200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': cache,
    });
    res.end(data);
  });
}

const server = http.createServer(serveStatic);

// ---- 리소스 제한 (인증 없는 LAN 게임 서버 하드닝) ----
const MAX_ROOMS = 300; // 방 총개수 상한
const MAX_CONNS_PER_IP = 40; // IP당 동시 연결 상한
const MSG_WINDOW_MS = 2000; // 메시지 속도 제한 윈도우
const MSG_PER_WINDOW = 80; // 윈도우당 최대 메시지 (drag/draft 고려해 넉넉히)
const connsByIp = new Map();

// 좌석이 있어야만 보낼 수 있는 메시지 (관전자 차단). chat/leave는 관전자도 허용.
const PLAYER_ONLY = new Set(['settings', 'start', 'draw', 'draft', 'commit', 'nudge', 'newGame']);

// ---- WebSocket ---- (payload 상한으로 대용량 프레임 거부; 정상 board 커밋도 수십 KB면 충분)
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });

function send(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

function broadcastRoom(room) {
  // 공통 부분(players·board 등)은 1회만 직렬화하고 수신자별 개인화 필드만 얹는다
  const base = serializeBase(room);
  eachConnected(room, (pid, p) => send(p.socket, personalizeState(room, base, pid)));
}

wss.on('connection', (ws, req) => {
  // CSWSH 방어: Origin이 있으면 호스트명이 Host와 일치해야 함 (교차도메인 소켓 차단).
  // 포트는 비교 안 함 → 개발 모드(Vite 5173 → 백엔드 8123, 같은 호스트)는 허용.
  // Origin이 없으면(비브라우저 도구) 허용.
  const origin = req.headers.origin;
  if (origin) {
    let ok = false;
    try {
      const originHost = new URL(origin).hostname;
      const serverHost = String(req.headers.host || '').split(':')[0];
      ok = !!originHost && originHost === serverHost;
    } catch {
      ok = false;
    }
    if (!ok) {
      ws.close(1008, 'forbidden origin');
      return;
    }
  }

  // IP당 동시 연결 수 제한 (DoS 완화)
  const ip = req.socket.remoteAddress || 'unknown';
  const nConns = (connsByIp.get(ip) || 0) + 1;
  connsByIp.set(ip, nConns);
  if (nConns > MAX_CONNS_PER_IP) {
    connsByIp.set(ip, nConns - 1);
    ws.close(1013, 'too many connections');
    return;
  }
  ws.on('close', () => {
    const c = (connsByIp.get(ip) || 1) - 1;
    if (c <= 0) connsByIp.delete(ip);
    else connsByIp.set(ip, c);
  });

  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  const msgRate = {}; // 메시지 속도 제한 상태 (rateLimited가 사용)

  // 이 소켓의 컨텍스트
  let ctx = { roomId: null, playerId: null };

  ws.on('message', (raw) => {
    // 속도 제한: 윈도우당 상한 초과분은 무시 (플러딩 완화)
    if (rateLimited(msgRate, 'msg', MSG_WINDOW_MS, MSG_PER_WINDOW)) return;

    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;

    // 어떤 메시지 처리도 서버 전체를 죽이지 못하게 방어
    try {
      // join 외 모든 메시지는 참여 중인 방이 전제 — 방 조회를 한 곳으로
      const room = msg.type === 'join' ? null : rooms.get(ctx.roomId);
      if (msg.type !== 'join' && !room) return;

      // 관전자는 보기·채팅만 가능 — 게임을 움직이는 조작은 좌석이 있어야 한다
      if (PLAYER_ONLY.has(msg.type) && !room.players.has(ctx.playerId)) {
        send(ws, { type: 'error', message: '관전 중이라 조작할 수 없어. 다음 판부터 참여돼!' });
        return;
      }

      switch (msg.type) {
      case 'join': {
        const roomId = String(msg.roomId || '').trim().toUpperCase().slice(0, 12);
        const name = String(msg.name || '').trim().slice(0, 20);
        const token = typeof msg.token === 'string' ? msg.token : null;
        if (!roomId || !name) {
          send(ws, { type: 'error', message: '방 코드와 이름을 입력해줘.' });
          return;
        }

        // 같은 소켓이 다른 방으로 재-join하면 이전 방을 먼저 정리 (유령 방/좌석 누수 방지)
        if (ctx.roomId && ctx.roomId !== roomId) {
          const prev = rooms.get(ctx.roomId);
          const prevP = prev?.participant(ctx.playerId);
          if (prev && prevP && prevP.socket === ws) {
            prev.removeSocket(ctx.playerId);
            if (prev.game && prev.currentPlayerId() === ctx.playerId) prev.advanceTurn();
            pushState(prev);
            cleanupIfEmpty(prev);
          }
        }

        // 방 총개수 상한 (인증 없는 무제한 방 생성 완화)
        if (!rooms.has(roomId) && rooms.size >= MAX_ROOMS) {
          send(ws, { type: 'error', message: '서버가 붐벼서 새 방을 만들 수 없어. 잠시 후 다시 시도해줘.' });
          return;
        }

        const room = getOrCreateRoom(roomId);
        clearRoomTimer(room, '_gcTimer'); // 방이 다시 활성화됨

        // 재접속: 토큰 우선(좌석 → 관전자), 없으면 이름+방코드 일치로 끊긴 좌석 복귀
        let newSpectator = false;
        let playerId = room.reattachByToken(token, ws);
        if (!playerId) playerId = room.reattachSpectatorByToken(token, ws);
        if (!playerId) playerId = room.reattachByName(name, ws);
        if (!playerId) playerId = room.reattachSpectatorByName(name, ws);
        if (!playerId) {
          // 이름 중복 방지 (좌석·관전자 통틀어)
          const nameTaken = [...room.players.values(), ...room.spectators.values()].some(
            (p) => p.name === name && p.connected
          );
          if (nameTaken) {
            send(ws, { type: 'error', message: '이미 같은 이름이 방에 있어.' });
            return;
          }
          // 진행 중이거나 정원이 찼으면 좌석 대신 관전자로 입장.
          // (게임이 끝나고 새 게임을 시작하면 빈 좌석으로 자동 승격 — Room.seatSpectators)
          const seatAvailable =
            room.phase === 'lobby' && room.players.size < room.settings.maxPlayers;
          playerId = randomUUID();
          if (seatAvailable) {
            room.addPlayer(playerId, name, ws);
          } else if (room.addSpectator(playerId, name, ws)) {
            newSpectator = true;
          } else {
            send(ws, { type: 'error', message: '관전자도 꽉 찼어. 잠시 후 다시 시도해줘.' });
            return;
          }
        }

        const seat = room.participant(playerId);
        ctx = { roomId, playerId };
        send(ws, {
          type: 'joined',
          playerId,
          roomId,
          name: seat.name,
          token: seat.reconnectToken,
        });
        pushState(room);
        // 채팅 기록 전달 (입장/재접속 시)
        send(ws, { type: 'chatHistory', messages: room.chat });
        if (newSpectator) sysChat(room, `👀 ${seat.name}님이 관전을 시작했어`);
        break;
      }

      case 'settings': {
        const r = room.updateSettings(ctx.playerId, msg.settings);
        if (!r.ok) {
          send(ws, { type: 'error', message: r.reason });
          return;
        }
        pushState(room);
        break;
      }

      case 'start': {
        const r = room.start();
        if (!r.ok) {
          send(ws, { type: 'error', message: r.reason });
          return;
        }
        pushState(room);
        sysChat(room, '🎮 게임 시작!');
        break;
      }

      case 'draw': {
        const r = room.draw(ctx.playerId);
        if (!r.ok) {
          send(ws, { type: 'error', message: r.reason });
          return;
        }
        pushState(room);
        break;
      }

      case 'draft': {
        const r = room.updateDraft(ctx.playerId, msg.board);
        if (r.ok) pushState(room);
        break;
      }

      case 'commit': {
        const r = room.commit(ctx.playerId, msg.board);
        if (!r.ok) {
          send(ws, {
            type: 'commitRejected',
            reason: r.reason,
            invalidMeldId: r.invalidMeldId ?? null,
          });
          return;
        }
        pushState(room);
        if (r.ended) {
          const winName = room.players.get(ctx.playerId)?.name ?? '누군가';
          sysChat(room, `🎉 ${winName} 승리!`);
        }
        break;
      }

      case 'chat': {
        const seat = room.participant(ctx.playerId); // 관전자도 채팅은 가능
        if (!seat) return;
        // 채팅 속도 제한 (3초당 8건 초과분 드롭 — 스팸 방지)
        if (rateLimited(seat, '_chat', 3000, 8)) return;
        broadcastChat(room, room.addChat(seat.name, msg.text, false, ctx.playerId));
        break;
      }

      case 'nudge': {
        if (room.phase !== 'playing' || !room.game) return;
        const seat = room.players.get(ctx.playerId);
        if (!seat) return;
        const curId = room.currentPlayerId();
        if (curId === ctx.playerId) return; // 자기 턴엔 재촉 불가
        // 5초 쿨타임 (플레이어별)
        const now = Date.now();
        if (seat._nudgeTs && now - seat._nudgeTs < 5000) return;
        seat._nudgeTs = now;
        const target = room.players.get(curId);
        sysChat(room, `👉 ${seat.name}님이 ${target?.name ?? '현재 턴'}님을 재촉했어!`);
        // 턴 플레이어에게만 화면 테두리 알림 이벤트
        if (target?.connected && target.socket) {
          send(target.socket, { type: 'nudged', from: seat.name, ts: now });
        }
        break;
      }

      case 'newGame': {
        // 진행 중인 게임을 아무나 날리지 못하게: 종료된 뒤에만 새 게임 허용
        if (room.phase === 'playing') {
          send(ws, { type: 'error', message: '게임 진행 중엔 새 게임을 시작할 수 없어.' });
          return;
        }
        const wasWatching = [...room.spectators.values()].filter((s) => s.connected).length;
        room.resetToLobby();
        const seated = wasWatching - [...room.spectators.values()].filter((s) => s.connected).length;
        pushState(room);
        if (seated > 0) sysChat(room, `🪑 관전자 ${seated}명이 이번 판에 참여해!`);
        break;
      }

      case 'leave': {
        room.removeSocket(ctx.playerId);
        // 명시적으로 나간 경우엔 즉시 턴을 넘긴다 (데드락 방지)
        if (room.game && room.currentPlayerId() === ctx.playerId) {
          room.advanceTurn();
        }
        pushState(room);
        cleanupIfEmpty(room);
        ctx = { roomId: null, playerId: null };
        break;
      }

      default:
        break;
      }
    } catch (err) {
      console.error('메시지 처리 오류:', err?.message);
    }
  });

  ws.on('close', () => {
    const room = rooms.get(ctx.roomId);
    if (!room) return;
    const p = room.participant(ctx.playerId);
    // 이미 새 소켓으로 교체됨(재접속) → 이 close는 옛 소켓 것이므로 무시
    if (!p || p.socket !== ws) return;
    room.removeSocket(ctx.playerId);
    // 즉시 턴을 넘기지 않는다. 현재 턴 플레이어면 pushState→syncTurnSkip가 유예 타이머를 건다.
    // (새로고침 등 순간 끊김에 턴을 뺏기지 않게. 유예 시간 안에 재접속하면 턴 유지)
    pushState(room);
    cleanupIfEmpty(room);
  });
});

// 죽은 연결 정리 (30초 핑)
const interval = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);
wss.on('close', () => clearInterval(interval));

// 최후의 방어선: 예기치 못한 예외로 프로세스가 죽어 모든 방이 날아가는 걸 막는다
process.on('uncaughtException', (err) => {
  console.error('uncaughtException:', err?.stack || err);
});
process.on('unhandledRejection', (reason) => {
  console.error('unhandledRejection:', reason);
});

server.listen(PORT, () => {
  console.log('');
  console.log('  🀄  루미큐브 서버 실행 중');
  console.log(`      로컬:   http://localhost:${PORT}`);
  console.log(`      LAN:    http://<이-컴퓨터-IP>:${PORT}  (같은 WiFi에서 접속)`);
  console.log(`      WS:     ws://localhost:${PORT}/ws`);
  console.log('');
  console.log('  * 개발 중에는 client 폴더에서 `npm run dev` (Vite, 5173) 를 쓰면 편해.');
  console.log('  * 외부 공유는 README 의 ngrok 안내 참고.');
  console.log('');
});
