// 방(Room) + 게임 상태 관리
import { randomUUID } from 'node:crypto';
import { buildPool, shuffle, setCountForPlayers } from './tiles.js';
import { validateCommit, isBoardShape } from './rules.js';

const INITIAL_HAND = 14; // 시작 손패 수
// 턴 제한시간. 공식 룰은 1분이지만 온라인 드래그 조작이 실물보다 느려 90초로 완화.
export const TURN_TIME_MS = 90 * 1000;

// 개인화된 상태를 만든다 (요청한 플레이어 기준: 내 손패만 전체 공개)
export function serializeState(room, forPlayerId) {
  const players = room.order.map((pid) => {
    const p = room.players.get(pid);
    return {
      id: pid,
      name: p.name,
      connected: p.connected,
      handCount: room.game ? room.game.racks[pid]?.length ?? 0 : 0,
      brokeIn: room.game ? !!room.game.brokeIn[pid] : false,
    };
  });

  const base = {
    type: 'state',
    roomId: room.id,
    phase: room.phase, // 'lobby' | 'playing' | 'ended'
    players,
    hostId: room.order[0] ?? null,
    you: forPlayerId,
  };

  if (room.game) {
    const g = room.game;
    const isMyTurn = g.order[g.currentIndex] === forPlayerId;
    // 현재 턴 플레이어의 draft가 있으면 그걸 보여준다.
    // (관전자는 실시간 관전용, 현재 플레이어는 새로고침 후 미제출 배치 복원용)
    const board = g.draftBoard ? g.draftBoard : g.board;
    Object.assign(base, {
      board,
      poolCount: g.pool.length,
      currentPlayerId: g.order[g.currentIndex],
      isMyTurn,
      myHand: g.racks[forPlayerId] ?? [],
      brokeIn: !!g.brokeIn[forPlayerId],
      winnerId: g.winnerId ?? null,
      turnStartBoard: isMyTurn ? g.turnStartBoard : undefined,
      // 턴 마감시각 + 서버 현재시각 (클라가 시계 오차 보정해 카운트다운)
      turnDeadline: g.turnDeadline ?? null,
      serverNow: Date.now(),
    });
  }

  return base;
}

export class Room {
  constructor(id) {
    this.id = id;
    this.players = new Map(); // playerId -> { id, name, connected, socket }
    this.order = []; // 좌석 순서 (playerId[])
    this.phase = 'lobby';
    this.game = null;
    this.chat = []; // { name, text, ts, system } 최근 200개
  }

  // 채팅 추가 (트림·200자 제한·최대 200개 유지). 빈 메시지는 null.
  addChat(name, text, system = false, senderId = null) {
    const t = String(text ?? '').trim().slice(0, 200);
    if (!t) return null;
    const entry = {
      name: String(name ?? '').slice(0, 20),
      text: t,
      ts: Date.now(),
      system,
      senderId,
    };
    this.chat.push(entry);
    if (this.chat.length > 200) this.chat.shift();
    return entry;
  }

  isEmpty() {
    return [...this.players.values()].every((p) => !p.connected);
  }

  addPlayer(playerId, name, socket) {
    this.players.set(playerId, {
      id: playerId,
      name,
      connected: true,
      socket,
      reconnectToken: randomUUID(), // 재접속용 비밀 토큰 (좌석 탈취 방지)
    });
    if (!this.order.includes(playerId)) this.order.push(playerId);
  }

  // 이름으로 끊긴 좌석 복귀 (토큰이 없을 때 폴백 — 탭 닫고 다시 들어온 경우).
  // 접속 중인 좌석은 탈취 못 하게 끊긴 좌석만 허용.
  reattachByName(name, socket) {
    for (const [pid, p] of this.players) {
      if (p.name === name && !p.connected) {
        p.connected = true;
        p.socket = socket;
        return pid;
      }
    }
    return null;
  }

  // 재접속 토큰으로 좌석 복귀. 성공하면 기존 playerId 반환.
  // 토큰이 일치하면 같은 사용자이므로, 옛 소켓이 남아있어도 새 소켓으로 교체(새로고침 대응).
  reattachByToken(token, socket) {
    if (!token) return null;
    for (const [pid, p] of this.players) {
      if (p.reconnectToken === token) {
        if (p.socket && p.socket !== socket) {
          try {
            p.socket.close();
          } catch {
            /* noop */
          }
        }
        p.connected = true;
        p.socket = socket;
        return pid;
      }
    }
    return null;
  }

  removeSocket(playerId) {
    const p = this.players.get(playerId);
    if (!p) return;
    p.connected = false;
    p.socket = null;
    // 로비 단계면 좌석에서 완전히 제거
    if (this.phase === 'lobby') {
      this.players.delete(playerId);
      this.order = this.order.filter((id) => id !== playerId);
    }
  }

  connectedCount() {
    return [...this.players.values()].filter((p) => p.connected).length;
  }

  // 게임 시작 (로비에 있는 아무나 호출 가능)
  start() {
    if (this.phase !== 'lobby') {
      return { ok: false, reason: '이미 시작된 게임이야.' };
    }
    const seated = this.order.filter((pid) => this.players.get(pid)?.connected);
    if (seated.length < 2) {
      return { ok: false, reason: '최소 2명이 있어야 시작할 수 있어.' };
    }
    if (seated.length > 6) {
      return { ok: false, reason: '최대 6명까지만 가능해.' };
    }

    const setCount = setCountForPlayers(seated.length);
    let pool = shuffle(buildPool(setCount));

    const racks = {};
    for (const pid of seated) {
      racks[pid] = pool.slice(0, INITIAL_HAND);
      pool = pool.slice(INITIAL_HAND);
    }

    const brokeIn = {};
    for (const pid of seated) brokeIn[pid] = false;

    this.phase = 'playing';
    this.game = {
      order: seated,
      currentIndex: 0,
      board: [], // Meld[]
      pool,
      racks,
      brokeIn,
      setCount,
      draftBoard: null, // 현재 턴 플레이어의 실시간 draft
      turnStartBoard: [], // 현재 턴 시작 시점 보드 (되돌리기 기준)
      turnDeadline: Date.now() + TURN_TIME_MS, // 이 시각까지 제출/뽑기 안 하면 자동 뽑기+턴 넘김
      winnerId: null,
    };
    return { ok: true };
  }

  currentPlayerId() {
    if (!this.game) return null;
    return this.game.order[this.game.currentIndex];
  }

  advanceTurn() {
    const g = this.game;
    g.draftBoard = null;
    // 다음으로 접속돼 있는 플레이어를 찾는다 (없으면 그냥 다음)
    for (let step = 1; step <= g.order.length; step += 1) {
      const idx = (g.currentIndex + step) % g.order.length;
      const pid = g.order[idx];
      if (this.players.get(pid)?.connected) {
        g.currentIndex = idx;
        break;
      }
    }
    g.turnStartBoard = deepClone(g.board);
    g.turnDeadline = Date.now() + TURN_TIME_MS;
  }

  // 한 장 뽑기 (턴 종료). 풀이 비면 그냥 패스.
  draw(playerId) {
    const g = this.game;
    if (!g || this.phase !== 'playing' || this.currentPlayerId() !== playerId) {
      return { ok: false, reason: '네 턴이 아니야.' };
    }
    if (g.pool.length > 0) {
      const tile = g.pool.shift();
      g.racks[playerId].push(tile);
    }
    this.advanceTurn();
    return { ok: true };
  }

  // 턴 시간 초과: 미제출 draft를 폐기하고 한 장 뽑아준 뒤 턴을 넘긴다 (서버 내부용)
  timeoutTurn() {
    const g = this.game;
    if (!g || this.phase !== 'playing') return { ok: false };
    const pid = this.currentPlayerId();
    if (g.pool.length > 0) g.racks[pid].push(g.pool.shift());
    this.advanceTurn(); // draftBoard도 여기서 null 처리됨
    return { ok: true, playerId: pid };
  }

  // 실시간 draft 갱신 (룰 검증은 X지만, 형식은 검증해서 관전자 크래시 방지)
  updateDraft(playerId, board) {
    const g = this.game;
    if (!g || this.phase !== 'playing' || this.currentPlayerId() !== playerId) return { ok: false };
    if (!isBoardShape(board)) return { ok: false };
    g.draftBoard = board;
    return { ok: true };
  }

  // 턴 커밋 (제출)
  commit(playerId, proposedBoard) {
    const g = this.game;
    if (!g || this.phase !== 'playing' || this.currentPlayerId() !== playerId) {
      return { ok: false, reason: '네 턴이 아니야.' };
    }
    const result = validateCommit({
      turnStartBoard: g.turnStartBoard,
      proposedBoard,
      rack: g.racks[playerId],
      brokeIn: g.brokeIn[playerId],
    });
    if (!result.ok) return result;

    // 적용 (서버 권위 타일로 재구성된 보드를 저장)
    g.board = result.board;
    g.racks[playerId] = result.newRack;
    g.brokeIn[playerId] = true;
    g.draftBoard = null;

    // 승리 판정
    if (result.newRack.length === 0) {
      g.winnerId = playerId;
      this.phase = 'ended';
      return { ok: true, ended: true };
    }

    this.advanceTurn();
    return { ok: true };
  }

  // 로비로 리셋 (새 게임)
  resetToLobby() {
    this.phase = 'lobby';
    this.game = null;
  }
}

function deepClone(v) {
  return JSON.parse(JSON.stringify(v));
}
