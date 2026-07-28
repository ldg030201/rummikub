// 방(Room) + 게임 상태 관리
import { randomUUID } from 'node:crypto';
import { buildPool, shuffle } from '../../shared/tiles.js';
import { validateCommit, isBoardShape } from '../../shared/rules.js';

const INITIAL_HAND = 14; // 시작 손패 수
// 턴 제한시간 기본값. 공식 룰은 1분이지만 온라인 드래그 조작이 실물보다 느려 90초로 완화.
export const TURN_TIME_MS = 90 * 1000;

// 대기실에서 방장이 고를 수 있는 설정값 (서버 검증용 화이트리스트)
export const TURN_TIME_OPTIONS = [0, 30000, 60000, 90000, 120000, 180000]; // 0 = 무제한
export const SET_COUNT_OPTIONS = ['auto', 1, 2];

export const MAX_SPECTATORS = 10; // 방당 관전자 상한 (메모리 방어)

// 방 공통 상태 — 수신자와 무관하게 동일한 부분 (브로드캐스트 시 1회만 생성)
export function serializeBase(room) {
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
    // 관전자 (좌석 없이 보기만 하는 사람들)
    spectators: [...room.spectators.values()]
      .filter((s) => s.connected)
      .map((s) => ({ id: s.id, name: s.name })),
    hostId: room.order[0] ?? null,
    settings: room.settings,
  };

  if (room.game) {
    const g = room.game;
    // 현재 턴 플레이어의 draft가 있으면 그걸 보여준다.
    // (관전자는 실시간 관전용, 현재 플레이어는 새로고침 후 미제출 배치 복원용)
    Object.assign(base, {
      board: g.draftBoard ? g.draftBoard : g.board,
      poolCount: g.pool.length,
      currentPlayerId: g.order[g.currentIndex],
      winnerId: g.winnerId ?? null,
      // 턴 마감시각 + 서버 현재시각 (클라가 시계 오차 보정해 카운트다운)
      turnDeadline: g.turnDeadline ?? null,
      serverNow: Date.now(),
    });
  }

  return base;
}

// 수신자별 개인화 — 내 손패만 전체 공개
export function personalizeState(room, base, forPlayerId) {
  // 좌석이 없으면 관전자 (손패 없음·조작 불가)
  const spectator = !room.players.has(forPlayerId);
  if (!room.game) return { ...base, spectator };
  const g = room.game;
  const isMyTurn = g.order[g.currentIndex] === forPlayerId;
  return {
    ...base,
    spectator,
    isMyTurn,
    myHand: g.racks[forPlayerId] ?? [],
    brokeIn: !!g.brokeIn[forPlayerId],
    turnStartBoard: isMyTurn ? g.turnStartBoard : undefined,
  };
}

export function serializeState(room, forPlayerId) {
  return personalizeState(room, serializeBase(room), forPlayerId);
}

export class Room {
  constructor(id) {
    this.id = id;
    this.players = new Map(); // playerId -> { id, name, connected, socket }
    // 관전자 — 진행 중인 방에 새로 들어온 사람. 좌석/손패가 없고 보드와 채팅만 본다.
    this.spectators = new Map(); // spectatorId -> { id, name, connected, socket, reconnectToken }
    this.order = []; // 좌석 순서 (playerId[])
    this.phase = 'lobby';
    this.game = null;
    this.chat = []; // { name, text, ts, system } 최근 200개
    // 방 설정 (대기실에서 방장이 변경)
    this.settings = { turnTimeMs: TURN_TIME_MS, maxPlayers: 6, setCount: 'auto' };
  }

  // 방장(첫 좌석)만 로비에서 설정 변경 가능. 알 수 없는 키/값은 무시·거부.
  updateSettings(playerId, patch) {
    if (this.phase !== 'lobby') return { ok: false, reason: '게임 중엔 설정을 바꿀 수 없어.' };
    if (this.order[0] !== playerId) return { ok: false, reason: '방장만 설정을 바꿀 수 있어.' };
    if (!patch || typeof patch !== 'object') return { ok: false, reason: '잘못된 설정이야.' };
    const next = { ...this.settings };
    if ('turnTimeMs' in patch) {
      if (!TURN_TIME_OPTIONS.includes(patch.turnTimeMs)) return { ok: false, reason: '잘못된 턴 시간이야.' };
      next.turnTimeMs = patch.turnTimeMs;
    }
    if ('maxPlayers' in patch) {
      const n = patch.maxPlayers;
      if (!Number.isInteger(n) || n < 2 || n > 6) return { ok: false, reason: '인원은 2~6명이야.' };
      next.maxPlayers = n;
    }
    if ('setCount' in patch) {
      if (!SET_COUNT_OPTIONS.includes(patch.setCount)) return { ok: false, reason: '잘못된 세트 수야.' };
      next.setCount = patch.setCount;
    }
    this.settings = next;
    return { ok: true };
  }

  // 현재 설정 기준 턴 마감시각 (무제한이면 null)
  nextDeadline() {
    return this.settings.turnTimeMs > 0 ? Date.now() + this.settings.turnTimeMs : null;
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

  // 관전자 추가 (좌석 없음). 정원 초과면 false.
  addSpectator(spectatorId, name, socket) {
    if (this.spectators.size >= MAX_SPECTATORS) return false;
    this.spectators.set(spectatorId, {
      id: spectatorId,
      name,
      connected: true,
      socket,
      reconnectToken: randomUUID(),
    });
    return true;
  }

  // 관전자 재접속 (새로고침 시 유령 관전자가 쌓이지 않게 토큰으로 같은 자리 복귀)
  reattachSpectatorByToken(token, socket) {
    if (!token) return null;
    for (const [sid, s] of this.spectators) {
      if (s.reconnectToken === token) {
        if (s.socket && s.socket !== socket) {
          try {
            s.socket.close();
          } catch {
            /* noop */
          }
        }
        s.connected = true;
        s.socket = socket;
        return sid;
      }
    }
    return null;
  }

  // 좌석/관전자 통합 조회 (채팅·연결 확인처럼 둘 다 되는 동작용)
  participant(id) {
    return this.players.get(id) ?? this.spectators.get(id);
  }

  // 관전자를 빈 좌석으로 승격 (새 게임으로 로비에 돌아올 때 다음 판에 참여시킨다).
  // 정원이 차거나 이름이 겹치면 관전 상태로 남는다. id/토큰을 그대로 물려받아 재접속이 안 깨진다.
  seatSpectators() {
    for (const [sid, s] of [...this.spectators]) {
      if (!s.connected) {
        this.spectators.delete(sid);
        continue;
      }
      if (this.players.size >= this.settings.maxPlayers) break;
      const nameTaken = [...this.players.values()].some((p) => p.name === s.name && p.connected);
      if (nameTaken) continue;
      this.spectators.delete(sid);
      this.players.set(sid, {
        id: sid,
        name: s.name,
        connected: true,
        socket: s.socket,
        reconnectToken: s.reconnectToken,
      });
      if (!this.order.includes(sid)) this.order.push(sid);
    }
  }

  removeSocket(playerId) {
    // 관전자는 좌석이 없으니 끊기면 그냥 제거
    const s = this.spectators.get(playerId);
    if (s) {
      this.spectators.delete(playerId);
      return;
    }
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

    // 세트 수: 5인 이상은 1세트가 모자라 무조건 2세트, 그 외엔 설정(자동=1세트)
    const setCount =
      seated.length >= 5 ? 2 : this.settings.setCount === 'auto' ? 1 : this.settings.setCount;
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
      turnDeadline: this.nextDeadline(), // 이 시각까지 제출/뽑기 안 하면 자동 뽑기+턴 넘김 (무제한이면 null)
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
    g.turnDeadline = this.nextDeadline();
  }

  // 풀에서 한 장 뽑아 손패에 추가 후 턴 넘김 (풀이 비면 그냥 패스). draw/timeoutTurn 공용.
  #drawAndAdvance(playerId) {
    const g = this.game;
    if (g.pool.length > 0) g.racks[playerId].push(g.pool.shift());
    this.advanceTurn(); // draftBoard도 여기서 null 처리됨
  }

  // 한 장 뽑기 (턴 종료)
  draw(playerId) {
    if (!this.game || this.phase !== 'playing' || this.currentPlayerId() !== playerId) {
      return { ok: false, reason: '네 턴이 아니야.' };
    }
    this.#drawAndAdvance(playerId);
    return { ok: true };
  }

  // 턴 시간 초과: 미제출 draft를 폐기하고 한 장 뽑아준 뒤 턴을 넘긴다 (서버 내부용)
  timeoutTurn() {
    if (!this.game || this.phase !== 'playing') return { ok: false };
    const pid = this.currentPlayerId();
    this.#drawAndAdvance(pid);
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

  // 로비로 리셋 (새 게임) — 기다리던 관전자를 빈 좌석으로 올린다
  resetToLobby() {
    this.phase = 'lobby';
    this.game = null;
    this.seatSpectators();
  }
}

function deepClone(v) {
  return JSON.parse(JSON.stringify(v));
}
