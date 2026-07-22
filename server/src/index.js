// 루미큐브 실시간 서버
//  - HTTP: 빌드된 클라이언트(client/dist) 정적 서빙 (SPA fallback)
//  - WS  : /ws 에서 실시간 게임 동기화
//
// 실행: npm start  (기본 포트 8080, PORT 환경변수로 변경 가능)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';

import { Room, serializeState } from './game.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIST = path.resolve(__dirname, '../../client/dist');
const PORT = Number(process.env.PORT) || 8080;

const rooms = new Map(); // roomId -> Room

function getOrCreateRoom(roomId) {
  let room = rooms.get(roomId);
  if (!room) {
    room = new Room(roomId);
    rooms.set(roomId, room);
  }
  return room;
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

    switch (msg.type) {
      case 'join': {
        const roomId = String(msg.roomId || '').trim().toUpperCase();
        const name = String(msg.name || '').trim().slice(0, 20);
        if (!roomId || !name) {
          send(ws, { type: 'error', message: '방 코드와 이름을 입력해줘.' });
          return;
        }
        const room = getOrCreateRoom(roomId);

        // 진행 중인 게임이면 이름으로 재접속 시도
        let playerId = room.reattachByName(name, ws);
        if (!playerId) {
          if (room.phase !== 'lobby') {
            send(ws, {
              type: 'error',
              message: '이미 게임이 진행 중인 방이야. (같은 이름으로만 재접속 가능)',
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

        ctx = { roomId, playerId };
        send(ws, { type: 'joined', playerId, roomId, name });
        broadcastRoom(room);
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
        broadcastRoom(room);
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
        broadcastRoom(room);
        break;
      }

      case 'draft': {
        const room = rooms.get(ctx.roomId);
        if (!room) return;
        const r = room.updateDraft(ctx.playerId, msg.board);
        if (r.ok) broadcastRoom(room);
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
        broadcastRoom(room);
        break;
      }

      case 'newGame': {
        const room = rooms.get(ctx.roomId);
        if (!room) return;
        room.resetToLobby();
        broadcastRoom(room);
        break;
      }

      case 'leave': {
        const room = rooms.get(ctx.roomId);
        if (!room) return;
        room.removeSocket(ctx.playerId);
        broadcastRoom(room);
        if (room.isEmpty()) rooms.delete(room.id);
        ctx = { roomId: null, playerId: null };
        break;
      }

      default:
        break;
    }
  });

  ws.on('close', () => {
    const room = rooms.get(ctx.roomId);
    if (!room) return;
    const p = room.players.get(ctx.playerId);
    // 이미 새 소켓으로 교체됨(재접속) → 이 close는 옛 소켓 것이므로 무시
    if (!p || p.socket !== ws) return;
    room.removeSocket(ctx.playerId);
    // 진행 중이고 나간 사람이 현재 턴이면 턴을 넘긴다
    if (room.game && room.currentPlayerId() === ctx.playerId) {
      room.advanceTurn();
    }
    broadcastRoom(room);
    if (room.isEmpty()) rooms.delete(room.id);
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
