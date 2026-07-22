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

import { Room, serializeState } from './game.js';

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

function clearRoomGC(room) {
  if (room._gcTimer) {
    clearTimeout(room._gcTimer);
    room._gcTimer = null;
  }
}

// 빈 방 정리: 로비면 즉시 삭제, 진행/종료 중이면 재접속 유예(GC) 후 삭제.
// (진행 중 방을 즉시 지우면 잠깐 전원 끊길 때 게임/재접속이 영구 소실됨)
function cleanupIfEmpty(room) {
  if (!room.isEmpty()) {
    clearRoomGC(room);
    return;
  }
  clearTurnSkip(room);
  if (room.phase === 'lobby') {
    clearRoomGC(room);
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

function clearTurnSkip(room) {
  if (room._turnSkip) {
    clearTimeout(room._turnSkip);
    room._turnSkip = null;
  }
}

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
    clearTurnSkip(room);
  }
}

// 상태 전파 + 턴 넘김 타이머 동기화 (턴/접속이 바뀔 때마다 호출)
function pushState(room) {
  broadcastRoom(room);
  syncTurnSkip(room);
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

function serveStatic(req, res) {
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  let filePath = path.join(CLIENT_DIST, urlPath);

  // 경로 탈출 방지
  if (!filePath.startsWith(CLIENT_DIST)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA fallback: index.html
      const indexPath = path.join(CLIENT_DIST, 'index.html');
      fs.readFile(indexPath, (err2, indexData) => {
        if (err2) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end(
            '클라이언트가 아직 빌드되지 않았어. client 폴더에서 `npm run build` 를 먼저 실행해줘.\n' +
              '(개발 중이라면 Vite 개발 서버 http://localhost:5173 로 접속)'
          );
        } else {
          res.writeHead(200, { 'Content-Type': MIME['.html'] });
          res.end(indexData);
        }
      });
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(serveStatic);

// ---- WebSocket ----
const wss = new WebSocketServer({ server, path: '/ws' });

function send(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

function broadcastRoom(room) {
  for (const [pid, p] of room.players) {
    if (p.connected && p.socket) {
      send(p.socket, serializeState(room, pid));
    }
  }
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  // 이 소켓의 컨텍스트
  let ctx = { roomId: null, playerId: null };

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;

    // 어떤 메시지 처리도 서버 전체를 죽이지 못하게 방어
    try {
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
          const prevP = prev?.players.get(ctx.playerId);
          if (prev && prevP && prevP.socket === ws) {
            prev.removeSocket(ctx.playerId);
            if (prev.game && prev.currentPlayerId() === ctx.playerId) prev.advanceTurn();
            pushState(prev);
            cleanupIfEmpty(prev);
          }
        }

        const room = getOrCreateRoom(roomId);
        clearRoomGC(room); // 방이 다시 활성화됨

        // 재접속: 토큰 우선, 없으면 이름+방코드 일치로 끊긴 좌석 복귀
        let playerId = room.reattachByToken(token, ws);
        if (!playerId) playerId = room.reattachByName(name, ws);
        if (!playerId) {
          if (room.phase !== 'lobby') {
            send(ws, {
              type: 'error',
              message: '이미 게임이 진행 중인 방이야. (같은 이름으로 입장하면 재접속 돼)',
            });
            return;
          }
          // 이름 중복 방지
          const nameTaken = [...room.players.values()].some(
            (p) => p.name === name && p.connected
          );
          if (nameTaken) {
            send(ws, { type: 'error', message: '이미 같은 이름이 방에 있어.' });
            return;
          }
          playerId = randomUUID();
          room.addPlayer(playerId, name, ws);
        }

        const seat = room.players.get(playerId);
        ctx = { roomId, playerId };
        send(ws, {
          type: 'joined',
          playerId,
          roomId,
          name: seat.name,
          token: seat.reconnectToken,
        });
        pushState(room);
        break;
      }

      case 'start': {
        const room = rooms.get(ctx.roomId);
        if (!room) return;
        const r = room.start();
        if (!r.ok) {
          send(ws, { type: 'error', message: r.reason });
          return;
        }
        pushState(room);
        break;
      }

      case 'draw': {
        const room = rooms.get(ctx.roomId);
        if (!room) return;
        const r = room.draw(ctx.playerId);
        if (!r.ok) {
          send(ws, { type: 'error', message: r.reason });
          return;
        }
        pushState(room);
        break;
      }

      case 'draft': {
        const room = rooms.get(ctx.roomId);
        if (!room) return;
        const r = room.updateDraft(ctx.playerId, msg.board);
        if (r.ok) pushState(room);
        break;
      }

      case 'commit': {
        const room = rooms.get(ctx.roomId);
        if (!room) return;
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
        break;
      }

      case 'newGame': {
        const room = rooms.get(ctx.roomId);
        if (!room) return;
        // 진행 중인 게임을 아무나 날리지 못하게: 종료된 뒤에만 새 게임 허용
        if (room.phase === 'playing') {
          send(ws, { type: 'error', message: '게임 진행 중엔 새 게임을 시작할 수 없어.' });
          return;
        }
        room.resetToLobby();
        pushState(room);
        break;
      }

      case 'leave': {
        const room = rooms.get(ctx.roomId);
        if (!room) return;
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
    const p = room.players.get(ctx.playerId);
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
