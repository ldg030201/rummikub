// game.js (Room) 통합 검증 — 결정적 시나리오
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Room, serializeState, TURN_TIME_MS, MAX_SPECTATORS } from './game.js';
import { T, sock } from '../../shared/test-helpers.js';

function twoPlayerRoom() {
  const room = new Room('R1');
  room.addPlayer('p1', '앨리스', sock());
  room.addPlayer('p2', '밥', sock());
  return room;
}

test('start: 2인 시작 시 각자 14장, 풀 78장, 1세트', () => {
  const room = twoPlayerRoom();
  const r = room.start();
  assert.equal(r.ok, true);
  assert.equal(room.phase, 'playing');
  assert.equal(room.game.racks.p1.length, 14);
  assert.equal(room.game.racks.p2.length, 14);
  assert.equal(room.game.pool.length, 106 - 28);
  assert.equal(room.game.setCount, 1);
});

test('start: 1명이면 시작 불가', () => {
  const room = new Room('R2');
  room.addPlayer('solo', '혼자', sock());
  assert.equal(room.start().ok, false);
});

test('commit: 손패 전부 내면 승리 + 게임 종료', () => {
  const room = twoPlayerRoom();
  room.start();
  const cur = room.currentPlayerId();
  // 결정적 시나리오 주입: 현재 플레이어 손패 = 30점 그룹 하나
  const rack = [T('a', 'red', 10), T('b', 'blue', 10), T('c', 'black', 10)];
  room.game.racks[cur] = rack;
  room.game.board = [];
  room.game.turnStartBoard = [];
  room.game.brokeIn[cur] = false;

  const proposed = [{ id: 'm1', tiles: rack }];
  const r = room.commit(cur, proposed);
  assert.equal(r.ok, true);
  assert.equal(r.ended, true);
  assert.equal(room.phase, 'ended');
  assert.equal(room.game.winnerId, cur);

  // 직렬화에 승자 반영
  const s = serializeState(room, cur);
  assert.equal(s.winnerId, cur);
});

test('commit: 첫 등록 후 턴이 다음 사람에게 넘어감', () => {
  const room = twoPlayerRoom();
  room.start();
  const first = room.currentPlayerId();
  // 30점 등록하되 손패는 남겨둠
  const rack = [
    T('a', 'red', 10), T('b', 'blue', 10), T('c', 'black', 10),
    T('d', 'red', 1), T('e', 'red', 2), T('f', 'red', 3),
  ];
  room.game.racks[first] = rack;
  room.game.board = [];
  room.game.turnStartBoard = [];
  room.game.brokeIn[first] = false;

  const proposed = [{ id: 'm1', tiles: rack.slice(0, 3) }];
  const r = room.commit(first, proposed);
  assert.equal(r.ok, true);
  assert.equal(room.phase, 'playing');
  assert.notEqual(room.currentPlayerId(), first); // 턴 넘어감
  assert.equal(room.game.brokeIn[first], true);
  assert.equal(room.game.racks[first].length, 3); // 3장 냄
});

test('draw: 한 장 뽑으면 손패 +1, 턴 넘어감', () => {
  const room = twoPlayerRoom();
  room.start();
  const first = room.currentPlayerId();
  const before = room.game.racks[first].length;
  const poolBefore = room.game.pool.length;
  const r = room.draw(first);
  assert.equal(r.ok, true);
  assert.equal(room.game.racks[first].length, before + 1);
  assert.equal(room.game.pool.length, poolBefore - 1);
  assert.notEqual(room.currentPlayerId(), first);
});

test('draw: 남의 턴에 뽑기 시도하면 거부', () => {
  const room = twoPlayerRoom();
  room.start();
  const first = room.currentPlayerId();
  const other = first === 'p1' ? 'p2' : 'p1';
  assert.equal(room.draw(other).ok, false);
});

test('serializeState: 내 손패만 공개, 남은 개수만 노출', () => {
  const room = twoPlayerRoom();
  room.start();
  const s = serializeState(room, 'p1');
  assert.ok(Array.isArray(s.myHand));
  assert.equal(s.myHand.length, 14);
  const p2 = s.players.find((p) => p.id === 'p2');
  assert.equal(p2.handCount, 14);
  assert.equal(p2.tiles, undefined); // 남의 실제 타일은 안 보냄
});

test('5인이면 2세트(212장) 사용', () => {
  const room = new Room('R5');
  for (let i = 0; i < 5; i += 1) room.addPlayer(`p${i}`, `P${i}`, sock());
  room.start();
  assert.equal(room.game.setCount, 2);
  assert.equal(room.game.pool.length, 212 - 5 * 14);
});

// ---- 견고성/가드 ----
test('start: 이미 진행 중이면 재시작 거부 (게임 리셋 방지)', () => {
  const room = twoPlayerRoom();
  assert.equal(room.start().ok, true);
  assert.equal(room.start().ok, false); // 두 번째는 거부
});

test('draw/commit: 게임 종료 후에는 거부', () => {
  const room = twoPlayerRoom();
  room.start();
  const cur = room.currentPlayerId();
  const rack = [T('a', 'red', 10), T('b', 'blue', 10), T('c', 'black', 10)];
  room.game.racks[cur] = rack;
  room.game.board = [];
  room.game.turnStartBoard = [];
  room.game.brokeIn[cur] = false;
  room.commit(cur, [{ id: 'm1', tiles: rack }]); // 승리 → ended
  assert.equal(room.phase, 'ended');
  assert.equal(room.draw(cur).ok, false);
  assert.equal(room.commit(cur, []).ok, false);
});

test('reattachByToken: 토큰으로 좌석 복귀', () => {
  const room = twoPlayerRoom();
  const p = room.players.get('p1');
  p.connected = false; // 끊긴 상태
  assert.equal(room.reattachByToken('wrong-token', sock()), null);
  assert.equal(room.reattachByToken(p.reconnectToken, sock()), 'p1');
  assert.equal(room.players.get('p1').connected, true);
});

test('reattachByName: 이름으로 끊긴 좌석만 복귀 (접속 중 좌석은 탈취 불가)', () => {
  const room = twoPlayerRoom();
  // 접속 중인 좌석은 이름이 같아도 복귀 불가
  assert.equal(room.reattachByName('앨리스', sock()), null);
  // 끊긴 뒤에는 이름으로 복귀 가능
  room.players.get('p1').connected = false;
  assert.equal(room.reattachByName('앨리스', sock()), 'p1');
  assert.equal(room.players.get('p1').connected, true);
  // 없는 이름은 불가
  assert.equal(room.reattachByName('없는사람', sock()), null);
});

test('addChat: 트림·200자 제한·최대 200개 유지', () => {
  const room = twoPlayerRoom();
  assert.equal(room.addChat('앨리스', '   '), null);
  assert.equal(room.addChat('앨리스', null), null);
  const e = room.addChat('앨리스', '  안녕  ');
  assert.equal(e.text, '안녕');
  assert.equal(e.system, false);
  const long = room.addChat('앨리스', 'a'.repeat(300));
  assert.equal(long.text.length, 200);
  const sys = room.addChat('', '게임 시작', true);
  assert.equal(sys.system, true);
  for (let i = 0; i < 250; i += 1) room.addChat('밥', `m${i}`);
  assert.ok(room.chat.length <= 200);
});

test('updateDraft: 잘못된 board는 무시 (관전자 크래시 방지)', () => {
  const room = twoPlayerRoom();
  room.start();
  const cur = room.currentPlayerId();
  assert.equal(room.updateDraft(cur, [null]).ok, false);
  assert.equal(room.updateDraft(cur, 'x').ok, false);
  assert.equal(room.game.draftBoard, null);
  const good = [{ id: 'm1', tiles: [T('a', 'red', 3), T('b', 'red', 4), T('c', 'red', 5)] }];
  assert.equal(room.updateDraft(cur, good).ok, true);
});

test('턴 제한시간: 시작/턴 넘김 시 deadline 갱신, 직렬화에 포함', () => {
  const room = twoPlayerRoom();
  const before = Date.now();
  room.start();
  const g = room.game;
  assert.ok(g.turnDeadline >= before + TURN_TIME_MS);

  const s = serializeState(room, room.currentPlayerId());
  assert.equal(s.turnDeadline, g.turnDeadline);
  assert.ok(typeof s.serverNow === 'number');

  // 턴을 넘기면 deadline이 다시 미래로 갱신됨
  g.turnDeadline = 1; // 과거로 조작
  room.draw(room.currentPlayerId());
  assert.ok(room.game.turnDeadline >= Date.now());
});

test('timeoutTurn: 한 장 뽑아주고 턴 넘김 + draft 폐기', () => {
  const room = twoPlayerRoom();
  room.start();
  const cur = room.currentPlayerId();
  const handBefore = room.game.racks[cur].length;
  const poolBefore = room.game.pool.length;
  room.game.draftBoard = [{ id: 'm1', tiles: [T('a', 'red', 3)] }];

  const r = room.timeoutTurn();
  assert.equal(r.ok, true);
  assert.equal(r.playerId, cur);
  assert.equal(room.game.racks[cur].length, handBefore + 1);
  assert.equal(room.game.pool.length, poolBefore - 1);
  assert.equal(room.game.draftBoard, null);
  assert.notEqual(room.currentPlayerId(), cur);

  // playing이 아니면 무시
  room.phase = 'ended';
  assert.equal(room.timeoutTurn().ok, false);
});

test('settings: 방장만 로비에서 변경 + 화이트리스트 검증', () => {
  const room = twoPlayerRoom();
  assert.equal(room.updateSettings('p2', { turnTimeMs: 60000 }).ok, false); // 방장 아님
  const r = room.updateSettings('p1', { turnTimeMs: 60000, maxPlayers: 4, setCount: 2 });
  assert.equal(r.ok, true);
  assert.deepEqual(room.settings, {
    turnTimeMs: 60000,
    maxPlayers: 4,
    setCount: 2,
    revealHands: false,
  });
  assert.equal(room.updateSettings('p1', { turnTimeMs: 12345 }).ok, false);
  assert.equal(room.updateSettings('p1', { maxPlayers: 9 }).ok, false);
  assert.equal(room.updateSettings('p1', { setCount: 3 }).ok, false);
  room.start();
  assert.equal(room.updateSettings('p1', { turnTimeMs: 30000 }).ok, false); // 게임 중
});

test('settings: 2세트 강제 반영 + 무제한 턴은 deadline 없음', () => {
  const room = twoPlayerRoom();
  room.updateSettings('p1', { setCount: 2, turnTimeMs: 0 });
  room.start();
  assert.equal(room.game.setCount, 2);
  assert.equal(room.game.pool.length, 212 - 28);
  assert.equal(room.game.turnDeadline, null);
  room.draw(room.currentPlayerId());
  assert.equal(room.game.turnDeadline, null); // 턴 넘어가도 무제한 유지
});

// ---- 관전자 ----

test('관전자: 좌석 없이 보드만 보고 손패는 비어 있음', () => {
  const room = twoPlayerRoom();
  room.start();
  assert.equal(room.addSpectator('s1', '구경꾼', sock()), true);

  const st = serializeState(room, 's1');
  assert.equal(st.spectator, true);
  assert.equal(st.isMyTurn, false);
  assert.deepEqual(st.myHand, []);
  assert.deepEqual(st.spectators, [{ id: 's1', name: '구경꾼' }]);
  // 좌석 플레이어에겐 관전 플래그가 안 붙는다
  assert.equal(serializeState(room, 'p1').spectator, false);
  // 관전자가 좌석 목록을 오염시키지 않음
  assert.equal(st.players.length, 2);
});

test('관전자: 로비 상태에서도 관전 플래그가 내려감', () => {
  const room = twoPlayerRoom();
  room.addSpectator('s1', '구경꾼', sock());
  assert.equal(serializeState(room, 's1').spectator, true);
  assert.equal(serializeState(room, 'p1').spectator, false);
});

test('관전자: 새 게임(로비 복귀) 때 빈 좌석으로 승격 — id·토큰 유지', () => {
  const room = twoPlayerRoom();
  room.start();
  room.addSpectator('s1', '구경꾼', sock());
  const token = room.spectators.get('s1').reconnectToken;

  room.resetToLobby();
  assert.equal(room.spectators.size, 0);
  assert.equal(room.players.get('s1').name, '구경꾼');
  assert.equal(room.players.get('s1').reconnectToken, token); // 재접속 안 깨짐
  assert.equal(room.order.includes('s1'), true);
  assert.equal(serializeState(room, 's1').spectator, false);
});

test('관전자: 정원이 차 있으면 승격 없이 관전 유지', () => {
  const room = twoPlayerRoom();
  room.updateSettings('p1', { maxPlayers: 2 });
  room.start();
  room.addSpectator('s1', '구경꾼', sock());
  room.resetToLobby();
  assert.equal(room.spectators.size, 1);
  assert.equal(room.players.has('s1'), false);
});

test('관전자: 이름이 겹치면 승격하지 않음', () => {
  const room = twoPlayerRoom();
  room.start();
  room.addSpectator('s1', '앨리스', sock());
  room.resetToLobby();
  assert.equal(room.spectators.has('s1'), true);
  assert.equal(room.players.size, 2);
});

test('관전자: 새로고침(끊김→토큰/이름 재접속)해도 같은 자리로 복귀', () => {
  const room = twoPlayerRoom();
  room.start();
  room.addSpectator('s1', '구경꾼', sock());
  const token = room.spectators.get('s1').reconnectToken;

  // 소켓이 살아있는 채로 새 소켓이 와도 교체
  const ws2 = sock();
  assert.equal(room.reattachSpectatorByToken(token, ws2), 's1');
  assert.equal(room.spectators.size, 1);
  assert.equal(room.spectators.get('s1').socket, ws2);

  // 먼저 끊긴 뒤 돌아오는 경우(브라우저 새로고침)에도 자리가 남아있어야 한다
  room.removeSocket('s1');
  assert.equal(room.spectators.get('s1').connected, false);
  assert.deepEqual(serializeState(room, 'p1').spectators, []); // 끊긴 관전자는 목록에서 숨김
  assert.equal(room.reattachSpectatorByToken(token, sock()), 's1');
  assert.equal(room.spectators.size, 1); // 유령 관전자가 안 쌓임

  // 토큰이 없으면 이름으로 폴백 (탭 닫고 재입장)
  room.removeSocket('s1');
  assert.equal(room.reattachSpectatorByName('없는사람', sock()), null);
  assert.equal(room.reattachSpectatorByName('구경꾼', sock()), 's1');
  assert.equal(room.spectators.get('s1').connected, true);
});

test('관전자: 끊긴 자리는 새 관전자가 들어올 때 정리 (상한 계산 오염 방지)', () => {
  const room = twoPlayerRoom();
  room.start();
  for (let i = 0; i < MAX_SPECTATORS; i += 1) room.addSpectator(`s${i}`, `구경꾼${i}`, sock());
  for (let i = 0; i < MAX_SPECTATORS; i += 1) room.removeSocket(`s${i}`);
  assert.equal(room.spectators.size, MAX_SPECTATORS); // 아직은 재접속 대기
  assert.equal(room.addSpectator('new', '새구경꾼', sock()), true); // 쓸어담고 자리 확보
  assert.equal(room.spectators.size, 1);
});

test('관전자: 상한(MAX_SPECTATORS) 초과 거부', () => {
  const room = twoPlayerRoom();
  room.start();
  for (let i = 0; i < MAX_SPECTATORS; i += 1) {
    assert.equal(room.addSpectator(`s${i}`, `구경꾼${i}`, sock()), true);
  }
  assert.equal(room.addSpectator('over', '늦둥이', sock()), false);
});

test('participant: 좌석·관전자 통합 조회', () => {
  const room = twoPlayerRoom();
  room.addSpectator('s1', '구경꾼', sock());
  assert.equal(room.participant('p1').name, '앨리스');
  assert.equal(room.participant('s1').name, '구경꾼');
  assert.equal(room.participant('없음'), undefined);
});

// ---- 패 공개(디버그) ----

test('패 공개: 기본은 꺼짐 — 남의 손패는 장수만 나간다', () => {
  const room = twoPlayerRoom();
  room.start();
  assert.equal(room.settings.revealHands, false);
  const s = serializeState(room, 'p1');
  assert.equal(s.hands, undefined);
  assert.equal(s.players.find((p) => p.id === 'p2').handCount, 14);
});

test('패 공개: 켜면 모두의 손패가 실리고, 설정은 방 전체에 보인다', () => {
  const room = twoPlayerRoom();
  assert.equal(room.updateSettings('p1', { revealHands: true }).ok, true);
  room.start();
  const s = serializeState(room, 'p1');
  assert.equal(s.settings.revealHands, true); // 몰래 켤 수 없음 — 모두가 설정을 본다
  assert.equal(s.hands.p2.length, 14);
  assert.deepEqual(s.hands.p2, room.game.racks.p2);
  // 관전자에게도 동일하게 보인다
  room.addSpectator('s1', '구경꾼', sock());
  assert.equal(serializeState(room, 's1').hands.p1.length, 14);
});

test('패 공개: 방장만·로비에서만·불리언만', () => {
  const room = twoPlayerRoom();
  assert.equal(room.updateSettings('p2', { revealHands: true }).ok, false); // 방장 아님
  assert.equal(room.updateSettings('p1', { revealHands: 'yes' }).ok, false); // 타입 검증
  assert.equal(room.settings.revealHands, false);
  room.start();
  assert.equal(room.updateSettings('p1', { revealHands: true }).ok, false); // 게임 중
});
