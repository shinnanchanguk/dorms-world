/**
 * 소화 여행(packs/science/digestion) 풀이 시험. 줄로 묶인 스테이지는 봇이 '확인 못 함'으로 넘기므로,
 * 여기서 두 사람의 조작을 그대로 굴려 끝까지 깨지는지 본다. 혼자서는 안 되는 자리도 함께 본다.
 */
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readStage } from './pack-io';
import { createWorld, ropeLinks, step, type Pad, type World } from '../platform/sim';
import { T } from '../platform/stage';
import { heldBy } from '../platform/things';

const dir = fileURLToPath(new URL('../packs/science/digestion/', import.meta.url));
const load = (file: string, n = 2) => createWorld(readStage(dir, file).stage, Array.from({ length: n }, (_, i) => ({ color: i ? '#E0524F' : '#F4F7FF' })));
const idle: Pad = { m: 0, j: false };
const cx = (w: World, i: number) => w.players[i].x + w.players[i].w / 2;

/** 모두 같은 x 를 향해 걷는다(줄에 묶여 있으니 함께 간다). 도착하면 멈춘다. */
function walkAll(w: World, x: number, seconds = 12) {
  for (let f = 0; f < seconds * 60; f++) {
    const pads = w.players.map((_, i) => { const d = x - cx(w, i); return { m: (Math.abs(d) < 4 ? 0 : d > 0 ? 1 : -1) as -1 | 0 | 1, j: false }; });
    if (pads.every(p => p.m === 0)) return true;
    step(w, pads, 1 / 60);
  }
  return false;
}
/** i 번째 도름이가 확인을 한 번 누른다. */
function press(w: World, i: number) {
  step(w, w.players.map((_, k) => (k === i ? { m: 0, j: false, a: true } : idle)), 1 / 60);
  step(w, w.players.map(() => idle), 1 / 60);
}
function rest(w: World, seconds: number) { for (let f = 0; f < seconds * 60; f++) step(w, w.players.map(() => idle), 1 / 60); }

/** 열쇠를 들고 문을 열고 모두 들어간다. */
function finish(w: World) {
  walkAll(w, w.key.x + 16, 20);
  rest(w, 0.3);
  walkAll(w, w.stage.door!.x + T, 20);
  rest(w, 0.3);
  for (let f = 0; f < 120 && !w.won; f++) step(w, w.players.map(() => ({ m: 0, j: false, a: true })), 1 / 60);
}

describe('소화 여행 01 위에서 잘게 부수기', () => {
  it('빵을 위에 넣고 짝과 번갈아 부숴 죽을 소장에 놓으면 다리가 놓이고, 둘이 문으로 들어간다', () => {
    const w = load('01');
    expect(ropeLinks(w)).toHaveLength(1);
    rest(w, 0.5);
    const bread = w.stage.things.items.findIndex(it => w.stage.things.kinds[it.kind].id === 'bread');
    const stomach = w.stage.things.items.findIndex(it => w.stage.things.kinds[it.kind].id === 'stomach');
    walkAll(w, w.stage.things.items[bread].x + 13);
    press(w, 0);
    expect(heldBy(w.h, 0)).toBe(bread);
    walkAll(w, w.stage.things.items[stomach].x + 24);
    press(w, 0);
    expect(w.h.items[stomach].v[1]).toBe(1);   // 위에 들어갔다
    // 같은 사람이 잇달아 누르면 부서지지 않는다
    press(w, 0); press(w, 0);
    expect(w.h.items[stomach].v[2]).toBe(1);
    press(w, 1); press(w, 0); press(w, 1);
    expect(w.h.items[stomach].v[1]).toBe(2);   // 다 부숴졌다
    press(w, 0);
    const held = heldBy(w.h, 0);
    expect(w.stage.things.kinds[w.stage.things.items[held].kind].id).toBe('mush');
    const goal = w.stage.things.goals[0];
    walkAll(w, goal.x + goal.w / 2);
    press(w, 0);
    expect(w.h.counts[0]).toBe(1);
    rest(w, 0.1);
    expect(w.active.has('x')).toBe(true);
    finish(w);
    expect(w.won).toBe(true);
  });

  it('줄에 묶인 짝은 줄 길이보다 멀어지지 않는다', () => {
    const w = load('01');
    rest(w, 0.5);
    for (let f = 0; f < 240; f++) step(w, [{ m: 1, j: false }, { m: -1, j: false }], 1 / 60);
    expect(Math.abs(cx(w, 0) - cx(w, 1))).toBeLessThanOrEqual(5 * T + 1);
  });

  it('30명이 들어와도 15쌍으로 묶인다', () => {
    const w = load('01', 30);
    expect(ropeLinks(w)).toHaveLength(15);
  });
});

describe('소화 여행 02 소장 벽 오르기', () => {
  const wallX = 14 * T, top = 8 * T;
  it('혼자 뛰어서는 네 칸 벽에 못 오른다', () => {
    const w = load('02');
    rest(w, 0.5);
    for (let f = 0; f < 600; f++) step(w, [{ m: 1, j: f % 30 < 15 }, { m: 1, j: f % 30 < 15 }], 1 / 60);
    for (const p of w.players) expect(p.y + p.h).toBeGreaterThan(top + 1);
  });

  it('짝의 머리를 딛고 먼저 오른 뒤, 걸어가며 당기면 아래 짝이 뛰어 올라온다', () => {
    const w = load('02');
    rest(w, 0.5);
    // 1 은 벽에 붙어 서고, 0 은 그 왼쪽에서 뛰어 1 의 머리에 올라선다
    for (let f = 0; f < 600 && w.players[1].x + w.players[1].w < wallX - 0.5; f++) step(w, [idle, { m: 1, j: false }], 1 / 60);
    for (let f = 0; f < 120; f++) step(w, [{ m: (cx(w, 0) < w.players[1].x - 30 ? 1 : cx(w, 0) > w.players[1].x - 22 ? -1 : 0) as -1 | 0 | 1, j: false }, idle], 1 / 60);
    let onHead = false;
    for (let f = 0; f < 120 && !onHead; f++) {
      step(w, [{ m: 1, j: f < 20 }, idle], 1 / 60);
      const p = w.players[0], q = w.players[1];
      onHead = p.on && Math.abs(p.y + p.h - q.y) < 2;
    }
    expect(onHead).toBe(true);
    // 머리 위에서 뛰어 벽 위로
    for (let f = 0; f < 90; f++) step(w, [{ m: 1, j: f < 20 }, idle], 1 / 60);
    expect(w.players[0].y + w.players[0].h).toBeLessThanOrEqual(top + 0.5);
    // 0 이 오른쪽으로 걸어 당기는 동안 1 은 뛴다
    for (let f = 0; f < 300 && w.players[1].y + w.players[1].h > top + 0.5; f++) step(w, [{ m: 1, j: false }, { m: 1, j: f % 40 < 20 }], 1 / 60);
    expect(w.players[1].y + w.players[1].h).toBeLessThanOrEqual(top + 0.5);
    finish(w);
    expect(w.won).toBe(true);
  });
});
