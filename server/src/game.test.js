// game.js (Room) 통합 검증 — 결정적 시나리오
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Room, serializeState } from './game.js';

const T = (id, color, num) => ({ id, color, num, joker: false });
const sock = () => ({ readyState: 1, OPEN: 1, send() {} });

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
