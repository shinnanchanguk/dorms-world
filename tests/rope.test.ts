import { describe, expect, it } from 'vitest';
import { parseStage, T } from '../platform/stage';
import { createWorld, ropeLinks, step, type Pad, type World } from '../platform/sim';

// 왼쪽은 높은 턱(위에 @), 오른쪽은 낮은 바닥. 턱 끝에서 떨어진 친구는 줄에 매달린다.
const CLIFF = [
  '..............................',
  '..............................',
  '..............................',
  '..............................',
  '..............................',
  '..............................',
  '..@...........................',
  '##########....................',
  '##########....................',
  '##########....................',
  '##########....................',
  '##########....................',
  '##########...........K.....D..',
  '##############################',
].join('\n');

const FLAT = [
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '.@............K.....D...',
  '########################',
  '########################',
].join('\n');

const run = (w: World, pads: (Pad | undefined)[], seconds: number) => { for (let i = 0; i < seconds * 60; i++) step(w, pads, 1 / 60); };
const stay: Pad = { m: 0, j: false }, right: Pad = { m: 1, j: false }, left: Pad = { m: -1, j: false };
const gap = (w: World, a: number, b: number) => {
  const p = w.players[a], q = w.players[b];
  return Math.hypot(p.x + p.w / 2 - q.x - q.w / 2, p.y + p.h / 2 - q.y - q.h / 2);
};

describe('줄 묶기 읽기', () => {
  it('rope 를 읽고, 모양이 틀리면 쉬운 말로 알린다', () => {
    expect(parseStage(FLAT, { rope: { length: 4 } }).rope).toEqual({ length: 4, link: 'pairs' });
    expect(parseStage(FLAT, { rope: { length: 6, link: 'chain' } }).rope).toEqual({ length: 6, link: 'chain' });
    expect(parseStage(FLAT).rope).toBeNull();
    expect(() => parseStage(FLAT, { rope: { length: 30 } })).toThrow(/2~12칸/);
    expect(() => parseStage(FLAT, { rope: { link: 'web' as 'chain' } })).toThrow(/pairs/);
    expect(() => parseStage(FLAT, { rope: { length: 4, stretch: 1 } as never })).toThrow(/모르는 칸/);
  });
  it('둘씩 묶고, 혼자 남은 사람은 바로 앞 사람과 묶는다. chain 은 모두 한 줄', () => {
    const w = createWorld(parseStage(FLAT, { rope: { length: 4 } }), Array.from({ length: 5 }, () => ({ color: '#F4F7FF' })));
    expect(ropeLinks(w).map(([a, b]) => [a.i, b.i])).toEqual([[0, 1], [2, 3], [3, 4]]);
    const c = createWorld(parseStage(FLAT, { rope: { length: 4, link: 'chain' } }), Array.from({ length: 4 }, () => ({ color: '#F4F7FF' })));
    expect(ropeLinks(c).map(([a, b]) => [a.i, b.i])).toEqual([[0, 1], [1, 2], [2, 3]]);
  });
});

describe('줄 묶기 움직임', () => {
  const two = (map: string, length = 4) => createWorld(parseStage(map, { rope: { length } }), [{ color: '#F4F7FF' }, { color: '#E0524F' }]);

  it('혼자 멀리 가려 하면 줄 길이에서 막히고, 친구를 끌고 간다', () => {
    const w = two(FLAT);
    run(w, [stay, stay], 0.5);
    const x1 = w.players[1].x;
    run(w, [left, right], 2);   // 0 은 왼쪽 벽 쪽, 1 은 오른쪽으로
    expect(gap(w, 0, 1)).toBeLessThanOrEqual(4 * T + 1);
    run(w, [right, right], 3);
    expect(w.players[1].x).toBeGreaterThan(x1 + 3 * T);   // 함께 걸으면 둘 다 오른쪽으로 간다
    const x0 = w.players[0].x;
    run(w, [stay, right], 1);
    expect(w.players[0].x - x0).toBeLessThan(T);          // 가만히 버티는 친구는 조금만 끌려간다
    expect(w.players[0].x - x0).toBeGreaterThan(0);
    expect(gap(w, 0, 1)).toBeLessThanOrEqual(4 * T + 1);
  });

  it('턱 끝에서 떨어진 친구는 줄에 매달리고, 위의 친구가 걸어가면 끌려 올라온다', () => {
    const w = two(CLIFF, 3);
    run(w, [stay, stay], 0.5);
    // 둘이 함께 턱 끝 쪽으로 가다가 0 은 멈춰 버티고, 1 은 그대로 걸어가 떨어진다
    for (let f = 0; f < 600 && w.players[1].x < 9 * T; f++) step(w, [right, right], 1 / 60);
    run(w, [stay, right], 1.2);
    const hang = w.players[1];
    expect(hang.on).toBe(false);
    expect(hang.y).toBeLessThan(12 * T);                  // 바닥까지 떨어지지 않고 매달려 있다
    expect(w.players[0].y + w.players[0].h).toBe(7 * T);   // 위 친구는 턱 위에 그대로 서 있다
    // 위 친구가 왼쪽으로 걸어가면 매달린 친구가 끌려 올라온다
    run(w, [left, stay], 2.5);
    expect(hang.y + hang.h).toBeLessThanOrEqual(7 * T + 0.5);
    expect(hang.x + hang.w).toBeLessThanOrEqual(10 * T + 1);
  });

  it('문에 들어간 도름이는 줄에서 풀린다', () => {
    const w = two(FLAT);
    w.players[0].inDoor = true;
    expect(ropeLinks(w)).toHaveLength(0);
  });

  it('줄이 없는 스테이지는 지금처럼 자유롭게 멀어진다', () => {
    const w = createWorld(parseStage(FLAT), [{ color: '#F4F7FF' }, { color: '#E0524F' }]);
    run(w, [left, right], 3);
    expect(gap(w, 0, 1)).toBeGreaterThan(8 * T);
  });
});
