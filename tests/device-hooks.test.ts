/** 움직임 손잡이(take·give·holding·shove·place·peek)와 장치 앞 확인 누름의 약속. */
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readStage } from './pack-io';
import { createWorld, step, type Pad, type World } from '../platform/sim';
import { ctxFor, readCtx, thingActionAt, thingActionText } from '../platform/thing-sim';
import { heldBy } from '../platform/things';

const dir = fileURLToPath(new URL('../packs/science/digestion/', import.meta.url));
const load = () => createWorld(readStage(dir, '01').stage, [{ color: '#F4F7FF' }, { color: '#E0524F' }]);
const idle: Pad = { m: 0, j: false };
const idOf = (w: World, i: number) => w.stage.things.kinds[w.stage.things.items[i].kind].id;
const find = (w: World, id: string) => w.stage.things.items.findIndex((_, i) => idOf(w, i) === id);
const press = (w: World, i: number) => { step(w, w.players.map((_, k) => (k === i ? { m: 0, j: false, a: true } : idle)), 1 / 60); step(w, w.players.map(() => idle), 1 / 60); };
const stand = (w: World, i: number, x: number) => { const p = w.players[i]; p.x = x; p.y = 322; p.vy = 0; p.on = true; };

describe('움직임 손잡이', () => {
  it('give 는 stock 물건만, 빈손에만 쥐여 주고 take 는 든 것을 받아 이름을 돌려준다', () => {
    const w = load(); const s = find(w, 'stomach'), c = ctxFor(w, s), me = { ...w.players[0], vy: 0 };
    expect(c.give(me, 'bread')).toBe(false);          // stock 이 아니다
    expect(c.give(me, 'mush')).toBe(true);
    expect(c.holding(me)).toBe('mush');
    expect(c.give(me, 'mush')).toBe(false);           // 손이 차 있다
    expect(c.take(me)).toBe('mush');
    expect(c.holding(me)).toBeNull();
    expect(c.peek('stomach')).toEqual([0, 0, 0, 0]);
  });

  it('범위 밖·이상한 도름이 번호로는 아무것도 못 한다(판 배열을 건드리지 못한다)', () => {
    const w = load(); const c = ctxFor(w, find(w, 'stomach'));
    for (const i of ['__proto__', 'map', -1, 1.5, 99] as unknown as number[]) {
      const q = { x: 0, y: 0, w: 1, h: 1, i, on: true, vy: 0 };
      expect(c.give(q, 'mush')).toBe(false);
      expect(c.take(q)).toBeNull();
      expect(c.holding(q)).toBeNull();
      c.respawn(q); c.launch(q, 5); c.shove(q, 30);
    }
    expect(Object.keys(Array.prototype)).toEqual([]);
    expect(w.h.items.every(it => typeof it.holder === 'number')).toBe(true);
  });

  it('그리기용 손잡이는 읽기만 한다', () => {
    const w = load(); const s = find(w, 'stomach'), c = readCtx(w, s), me = { ...w.players[0], vy: 0 };
    expect(c.give(me, 'mush')).toBe(false);
    expect(() => { c.vars[1] = 5; }).toThrow();
    expect(w.h.items[s].v[1]).toBe(0);
  });

  it('things.json 의 takes 는 움직임이 바꿀 수 없다', () => {
    const w = load(); const c = ctxFor(w, find(w, 'stomach'));
    expect(() => (c.takes as string[]).push('mush')).toThrow();
  });
});

describe('장치 앞 확인 누름', () => {
  it('안내 글과 누름이 같다: 친구 차례에 누르면 아무 일도 없고 든 것을 떨어뜨리지 않는다', () => {
    const w = load(); const s = find(w, 'stomach'), sx = w.stage.things.items[s].x;
    const breads = w.stage.things.items.map((_, i) => i).filter(i => idOf(w, i) === 'bread');
    stand(w, 0, sx + 10); stand(w, 1, sx + 30);
    w.h.items[breads[0]].at = 2; w.h.items[breads[0]].holder = 0;
    press(w, 0);                                     // 넣기
    press(w, 0);                                     // 부수기 1
    w.h.items[breads[1]].at = 2; w.h.items[breads[1]].holder = 0;
    const act = thingActionAt(w, w.players[0])!;
    expect(thingActionText(w, act)).toBe('친구가 부술 차례예요');
    press(w, 0);
    expect(heldBy(w.h, 0)).toBe(breads[1]);         // 여전히 들고 있다
    expect(w.h.items[s].v[2]).toBe(1);
  });

  it('장치 옆에 떨어뜨린 물건도 발밑이면 다시 줍는다', () => {
    const w = load(); const s = find(w, 'stomach'), sx = w.stage.things.items[s].x;
    const bread = find(w, 'bread');
    stand(w, 0, sx - 6);
    const st = w.h.items[bread]; st.x = sx - 8; st.y = 360 - 21;
    expect(thingActionAt(w, w.players[0])).toEqual({ do: 'pick', item: bread });
  });
});

describe('줄이 새로 묶일 때', () => {
  it('멀리 떨어진 짝도 한 걸음에 9px 넘게 끌려가지 않는다', () => {
    const w = load();
    for (let f = 0; f < 30; f++) step(w, [idle, idle], 1 / 60);
    w.players[1].x = w.players[0].x + 300;
    const before = w.players.map(p => p.x);
    step(w, [idle, idle], 1 / 60);
    const moved = w.players.map((p, i) => Math.abs(p.x - before[i]));
    expect(moved[0] + moved[1]).toBeLessThanOrEqual(9.01);
  });
});
