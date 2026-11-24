/**
 * 소화 기관 여행(packs/science/digestion-trial) 풀이 시험과 새 장치 시험.
 * 줄로 묶인 스테이지는 봇이 '확인 못 함'으로 넘기므로, 두 사람의 조작을 그대로 굴려 끝까지 깨지는지 본다.
 * 새 장치: 앞뒤로 미는 바닥(platform/behaviors/surge.ts), 크기 바꾸기(platform/size.ts 의 shrink · sieve).
 */
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readStage } from './pack-io';
import { createWorld, ropeLinks, setSmall, step, PH, type Pad, type World } from '../platform/sim';
import { T, parseStage } from '../platform/stage';
import { heldBy } from '../platform/things';
import { SMALL_H } from '../platform/size';
import { applyWire, readWire, toWire } from '../platform/sync';

const dir = fileURLToPath(new URL('../packs/science/digestion/', import.meta.url));
const load = (file: string, n = 2) => createWorld(readStage(dir, file).stage, Array.from({ length: n }, (_, i) => ({ color: i ? '#E0524F' : '#F4F7FF' })));
const idle: Pad = { m: 0, j: false };
const cx = (w: World, i: number) => w.players[i].x + w.players[i].w / 2;
const idOf = (w: World, i: number) => w.stage.things.kinds[w.stage.things.items[i].kind].id;
const items = (w: World, id: string) => w.stage.things.items.map((_, i) => i).filter(i => idOf(w, i) === id);

function walkAll(w: World, x: number, seconds = 12) {
  for (let f = 0; f < seconds * 60; f++) {
    const pads = w.players.map((_, i) => { const d = x - cx(w, i); return { m: (Math.abs(d) < 4 ? 0 : d > 0 ? 1 : -1) as -1 | 0 | 1, j: false }; });
    if (pads.every(p => p.m === 0)) return true;
    step(w, pads, 1 / 60);
  }
  return false;
}
function press(w: World, i: number) {
  step(w, w.players.map((_, k) => (k === i ? { m: 0, j: false, a: true } : idle)), 1 / 60);
  step(w, w.players.map(() => idle), 1 / 60);
}
function rest(w: World, seconds: number) { for (let f = 0; f < seconds * 60; f++) step(w, w.players.map(() => idle), 1 / 60); }
function finish(w: World) {
  walkAll(w, w.key.x + 16, 20);
  rest(w, 0.3);
  walkAll(w, w.stage.door!.x + T, 20);
  rest(w, 0.3);
  for (let f = 0; f < 120 && !w.won; f++) step(w, w.players.map(() => ({ m: 0, j: false, a: true })), 1 / 60);
}

describe('앞뒤로 미는 바닥(surge)', () => {
  // 지도: 멈춘 바닥 위 시작, 오른쪽에 미는 바닥 하나
  const map = [
    '..............................',
    '..............................',
    '..............................',
    '..............................',
    '..............................',
    '..............................',
    '..............................',
    '..............................',
    '..............................',
    '..............................',
    '.@............w.........K..D..',
    '##############################',
  ].join('\n');
  const kinds = readStage(dir, '03').stage.things.kinds;
  const k = Object.fromEntries(kinds.map(x => [x.id, x]));
  const stage = parseStage(map, { legend: { w: { type: 'thing', thing: 'wave' } } }, {}, k);
  it('앞으로 밀 때는 천천히, 뒤로 밀 때는 걷는 것보다 세게 민다', () => {
    const w = createWorld(stage, [{ color: '#F4F7FF' }]);
    rest(w, 0.3);
    const p = w.players[0];
    for (let f = 0; f < 400 && !(w.t % 4 > 2.05 && w.t % 4 < 2.1); f++) rest(w, 1 / 60);   // 뒤로 미는 때로
    p.x = 14 * T + 60;                              // 미는 바닥 가운데에 세운다
    const x0 = p.x;
    for (let f = 0; f < 30; f++) step(w, [{ m: 1, j: false }], 1 / 60);   // 오른쪽으로 걸어도
    expect(p.x).toBeLessThan(x0);                   // 뒤로 밀려난다
  });
});

describe('소화 여행 03 소장의 꿈틀 운동', () => {
  /** 멈춘 바닥(고리) 위에서 기다리다가, 앞으로 밀기가 막 시작하면 짝과 함께 구덩이를 뛰어넘어 다음 고리까지 달린다. */
  const holes = [14, 28, 42].map(c => c * T), rings = [24, 38, 52].map(c => c * T);
  it('앞으로 밀 때 함께 달리면 세 구간을 지나 문으로 들어간다', () => {
    const w = load('03');
    rest(w, 0.3);
    walkAll(w, 12 * T, 10);
    for (let seg = 0; seg < 3; seg++) {
      // 다음 앞으로 밀기가 시작될 때까지 기다린다
      for (let f = 0; f < 400 && !(w.t % 4 < 0.05); f++) rest(w, 1 / 60);
      const goalX = rings[seg] + 2 * T;
      for (let f = 0; f < 180; f++) {
        const pads = w.players.map((_, i) => { const d = goalX - cx(w, i); const hole = holes[seg] - 20 < cx(w, i) + 20 && cx(w, i) < holes[seg] + 10; return { m: (Math.abs(d) < 4 ? 0 : d > 0 ? 1 : -1) as -1 | 0 | 1, j: hole && w.players[i].on }; });
        step(w, pads, 1 / 60);
      }
      rest(w, 0.2);
      for (const p of w.players) expect(p.x + p.w / 2, `구간 ${seg + 1}`).toBeGreaterThan(rings[seg]);
    }
    finish(w);
    expect(w.won).toBe(true);
  });

  it('뒤로 밀 때 구간 한가운데에 있으면 구덩이 쪽으로 밀려난다', () => {
    const w = load('03');
    rest(w, 0.3);
    for (let f = 0; f < 400 && !(w.t % 4 > 2.0 && w.t % 4 < 2.05); f++) rest(w, 1 / 60);
    for (const p of w.players) { p.x = 19 * T + p.i * 30; }   // 첫 구간 가운데에 세운다
    const x0 = Math.max(cx(w, 0), cx(w, 1));
    for (let f = 0; f < 60; f++) step(w, w.players.map(() => ({ m: 1, j: false })), 1 / 60);
    expect(Math.max(cx(w, 0), cx(w, 1))).toBeLessThan(x0 - 60);
  });
});

describe('크기 바꾸기(shrink · sieve)', () => {
  const wallX = 7 * T, top = 6 * T;
  /** 짝의 머리를 딛고 벽 위로 올라가 작아지고, 먼저 오른 짝이 걸어가며 당겨 아래 짝도 올라와 작아진다. */
  function climbAndShrink(w: World) {
    rest(w, 0.3);
    // 0 이 벽에 붙어 서고, 1 은 그 오른쪽에서 뛰어 0 의 머리에 올라선다
    for (let f = 0; f < 600 && w.players[0].x > wallX + 0.5; f++) step(w, [{ m: -1, j: false }, idle], 1 / 60);
    for (let f = 0; f < 180; f++) step(w, [idle, { m: (cx(w, 1) > w.players[0].x + w.players[0].w + 30 ? -1 : cx(w, 1) < w.players[0].x + w.players[0].w + 22 ? 1 : 0) as -1 | 0 | 1, j: false }], 1 / 60);
    let onHead = false;
    for (let f = 0; f < 120 && !onHead; f++) {
      step(w, [idle, { m: -1, j: f < 20 }], 1 / 60);
      const p = w.players[1], q = w.players[0];
      onHead = p.on && Math.abs(p.y + p.h - q.y) < 2;
    }
    expect(onHead).toBe(true);
    // 머리 위에서 뛰어 벽 위로
    for (let f = 0; f < 90; f++) step(w, [idle, { m: -1, j: f < 20 }], 1 / 60);
    expect(w.players[1].y + w.players[1].h).toBeLessThanOrEqual(top + 0.5);
    // 1 이 왼쪽으로 걸어 작아지는 곳에 들어가며 당기는 동안 0 은 뛴다
    for (let f = 0; f < 400 && !w.players[0].small; f++) step(w, [{ m: -1, j: f % 40 < 20 }, { m: -1, j: false }], 1 / 60);
    expect(w.players[1].small).toBe(true);
    expect(w.players[0].small).toBe(true);
  }

  it('혼자 뛰어서는 네 칸 벽에 못 올라 작아지지 못한다', () => {
    const w = load('04');
    rest(w, 0.5);
    for (let f = 0; f < 600; f++) step(w, [{ m: -1, j: f % 30 < 15 }, { m: -1, j: f % 30 < 15 }], 1 / 60);
    for (const p of w.players) { expect(p.small).toBe(false); expect(p.y + p.h).toBeGreaterThan(top + 1); }
  });

  it('작아지면 요약으로도 작게 보이고, 떨어져 처음 자리로 가면 원래 크기로 돌아온다', () => {
    const w = load('04');
    climbAndShrink(w);
    expect(w.players.every(p => p.small && p.h === SMALL_H)).toBe(true);
    const copy = load('04');
    const wire = readWire(JSON.parse(JSON.stringify(toWire(w, [0, 1], 1, 1))));
    expect(wire).not.toBeNull();
    expect(applyWire(copy, wire!)).toBe(true);
    expect(copy.players.every(p => p.small && p.h === SMALL_H)).toBe(true);
    for (const p of w.players) p.y = 20 * T;
    rest(w, 0.2);
    expect(w.players[0].small).toBe(false);
    expect(w.players[0].h).toBe(PH);
  });

  it('원래 크기면 틈 위에 서고, 혼자만 작아지면 크게 남은 짝의 줄에 걸려 바닥에 닿지 못한다', () => {
    const w = load('04');
    rest(w, 0.3);
    const gap = 26 * T + T / 2;
    for (const p of w.players) { p.x = gap - p.w / 2 - (p.i ? 30 : 0); p.y = 10 * T - p.h - 1; }
    rest(w, 1);
    for (const p of w.players) expect(p.y + p.h).toBeLessThanOrEqual(10 * T + 0.5);   // 둘 다 틈 위에 서 있다
    const p0 = w.players[0];
    setSmall(p0, true); p0.x = gap - p0.w / 2;
    rest(w, 2);
    expect(p0.y + p0.h).toBeGreaterThan(10 * T);       // 틈으로 빨려 내려갔지만
    expect(p0.y + p0.h).toBeLessThan(15 * T - 2);      // 줄에 걸려 아래 방 바닥(15번째 줄)에 닿지 못한다
  });

  it('둘 다 작아져 틈으로 빨려 들어가면 열쇠를 들고 문으로 들어간다', () => {
    const w = load('04');
    climbAndShrink(w);
    walkAll(w, 26 * T + T / 2, 15);
    rest(w, 1.5);
    for (const p of w.players) expect(p.y + p.h).toBeGreaterThan(14 * T);   // 아래 방 바닥에 닿았다
    finish(w);
    expect(w.won).toBe(true);
  });

  it('30명이 작아지는 곳에 모두 들어가 작아지고, 다섯 틈으로 나눠 모두 아래 방에 닿는다', () => {
    const w = load('04', 30);
    rest(w, 0.5);
    // 벽 오르기는 위에서 2명으로 본다. 여기서는 작아지는 곳의 넓이와 틈의 수가 30명에게 모자라지 않은지만 본다.
    w.players.forEach((p, i) => { p.x = 1 * T + (i % 10) * 15; p.y = 6 * T - p.h - (Math.floor(i / 10)) * (p.h + 2) - 1; });
    rest(w, 1);
    expect(w.players.filter(p => p.small).length).toBe(30);
    const gaps = [26, 29, 32, 35, 38];
    for (let f = 0; f < 60 * 40; f++) {
      step(w, w.players.map(p => {
        const x = p.y > 10 * T ? 44 * T : gaps[Math.floor(p.i / 2) % 5] * T + T / 2, d = x - (p.x + p.w / 2);
        return { m: (Math.abs(d) < 3 ? 0 : d > 0 ? 1 : -1) as -1 | 0 | 1, j: false };
      }), 1 / 60);
    }
    expect(w.players.filter(p => p.y > 10 * T).length).toBe(30);   // 모두 아래 방에 들어왔다(문 앞에서 서로 머리 위에 선다)
  });
});
