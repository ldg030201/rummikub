// 간단한 룰 엔진 검증 (node --test)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isGroup,
  isRun,
  isValidMeld,
  meldValue,
  validateBoard,
  validateCommit,
} from './rules.js';

const T = (id, color, num) => ({ id, color, num, joker: false });
const J = (id) => ({ id, color: null, num: null, joker: true });

test('그룹: 같은 숫자 다른 색 3개', () => {
  assert.equal(isGroup([T('a', 'red', 7), T('b', 'blue', 7), T('c', 'black', 7)]), true);
});
test('그룹: 색 중복 불가', () => {
  assert.equal(isGroup([T('a', 'red', 7), T('b', 'red', 7), T('c', 'black', 7)]), false);
});
test('그룹: 4개까지, 5개 불가', () => {
  assert.equal(
    isGroup([T('a', 'red', 7), T('b', 'blue', 7), T('c', 'black', 7), T('d', 'orange', 7)]),
    true
  );
  assert.equal(
    isGroup([
      T('a', 'red', 7), T('b', 'blue', 7), T('c', 'black', 7), T('d', 'orange', 7), J('e'),
    ]),
    false
  );
});
test('그룹: 조커 포함', () => {
  assert.equal(isGroup([T('a', 'red', 7), J('j'), T('c', 'black', 7)]), true);
});

test('런: 같은 색 연속', () => {
  assert.equal(isRun([T('a', 'red', 4), T('b', 'red', 5), T('c', 'red', 6)]), true);
});
test('런: 색 다르면 불가', () => {
  assert.equal(isRun([T('a', 'red', 4), T('b', 'blue', 5), T('c', 'red', 6)]), false);
});
test('런: 순서 안 맞으면 불가', () => {
  assert.equal(isRun([T('a', 'red', 4), T('b', 'red', 6), T('c', 'red', 5)]), false);
});
test('런: 13 다음 wrap 불가', () => {
  assert.equal(isRun([T('a', 'red', 12), T('b', 'red', 13), J('j')]), false);
});
test('런: 조커로 갭 채우기', () => {
  // red 5, joker(6), red 7
  assert.equal(isRun([T('a', 'red', 5), J('j'), T('c', 'red', 7)]), true);
});
test('런: 1 아래로 못 감', () => {
  // joker(0?), red1, red2 -> start=0 이면 invalid
  assert.equal(isRun([J('j'), T('a', 'red', 1), T('b', 'red', 2)]), false);
});
test('런: 1,2,3 맨앞 조커 대신 정상', () => {
  assert.equal(isRun([T('a', 'red', 1), T('b', 'red', 2), J('j')]), true); // 1,2,3
});

test('meldValue: 그룹', () => {
  assert.equal(meldValue([T('a', 'red', 7), T('b', 'blue', 7), T('c', 'black', 7)]), 21);
});
test('meldValue: 런(조커 포함)', () => {
  // red 5,6(joker),7 => 18
  assert.equal(meldValue([T('a', 'red', 5), J('j'), T('c', 'red', 7)]), 18);
});

test('validateBoard: 유효/무효', () => {
  const good = [{ id: 'm1', tiles: [T('a', 'red', 7), T('b', 'blue', 7), T('c', 'black', 7)] }];
  assert.equal(validateBoard(good).ok, true);
  const bad = [{ id: 'm1', tiles: [T('a', 'red', 7), T('b', 'red', 8)] }];
  assert.equal(validateBoard(bad).ok, false);
});

test('validateCommit: 첫 등록 30점 미만 거부', () => {
  const rack = [T('a', 'red', 3), T('b', 'blue', 3), T('c', 'black', 3)]; // 9점
  const proposed = [{ id: 'm1', tiles: rack }];
  const r = validateCommit({ turnStartBoard: [], proposedBoard: proposed, rack, brokeIn: false });
  assert.equal(r.ok, false);
});

test('validateCommit: 첫 등록 30점 이상 통과', () => {
  const rack = [T('a', 'red', 10), T('b', 'blue', 10), T('c', 'black', 10)]; // 30점
  const proposed = [{ id: 'm1', tiles: rack }];
  const r = validateCommit({ turnStartBoard: [], proposedBoard: proposed, rack, brokeIn: false });
  assert.equal(r.ok, true);
  assert.equal(r.newRack.length, 0);
});

test('validateCommit: 첫 등록 때 기존 조합 건드리면 거부', () => {
  const startBoard = [
    { id: 'm1', tiles: [T('x', 'red', 5), T('y', 'blue', 5), T('z', 'black', 5)] },
  ];
  const rack = [T('a', 'red', 10), T('b', 'blue', 10), T('c', 'black', 10)];
  // 기존 멜드에 손패를 섞음
  const proposed = [
    { id: 'm1', tiles: [T('x', 'red', 5), T('y', 'blue', 5), T('z', 'black', 5), T('a', 'red', 10)] },
  ];
  const r = validateCommit({ turnStartBoard: startBoard, proposedBoard: proposed, rack, brokeIn: false });
  assert.equal(r.ok, false);
});

test('validateCommit: 최소 1장은 내야 함', () => {
  const startBoard = [
    { id: 'm1', tiles: [T('x', 'red', 5), T('y', 'blue', 5), T('z', 'black', 5)] },
  ];
  const rack = [T('a', 'red', 10)];
  // 손패에서 낸 게 없음 (그대로 제출)
  const proposed = [{ id: 'm1', tiles: [T('x', 'red', 5), T('y', 'blue', 5), T('z', 'black', 5)] }];
  const r = validateCommit({ turnStartBoard: startBoard, proposedBoard: proposed, rack, brokeIn: true });
  assert.equal(r.ok, false);
});

test('validateCommit: 테이블 타일을 손패로 못 가져감', () => {
  const startBoard = [
    { id: 'm1', tiles: [T('x', 'red', 5), T('y', 'blue', 5), T('z', 'black', 5)] },
  ];
  const rack = [T('a', 'red', 10), T('b', 'blue', 10), T('c', 'black', 10)];
  // z를 테이블에서 빼버림
  const proposed = [
    { id: 'm1', tiles: [T('x', 'red', 5), T('y', 'blue', 5)] },
    { id: 'm2', tiles: [T('a', 'red', 10), T('b', 'blue', 10), T('c', 'black', 10)] },
  ];
  const r = validateCommit({ turnStartBoard: startBoard, proposedBoard: proposed, rack, brokeIn: true });
  assert.equal(r.ok, false);
});

test('validateCommit: 브레이크인 후 재배열 허용', () => {
  // 테이블: red 4,5,6 런 + 손패 red 7 을 이어붙이기
  const startBoard = [
    { id: 'm1', tiles: [T('x', 'red', 4), T('y', 'red', 5), T('z', 'red', 6)] },
  ];
  const rack = [T('a', 'red', 7)];
  const proposed = [
    { id: 'm1', tiles: [T('x', 'red', 4), T('y', 'red', 5), T('z', 'red', 6), T('a', 'red', 7)] },
  ];
  const r = validateCommit({ turnStartBoard: startBoard, proposedBoard: proposed, rack, brokeIn: true });
  assert.equal(r.ok, true);
  assert.equal(r.newRack.length, 0);
});
