/**
 * 회로판: 지도 읽기, 실제 회로 계산(한 줄 · 갈래 · 합선 · 끊긴 갈래), 도름이가 접점에 서면 이어지는 것.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BRIGHT, LIT, lampOn, solveCircuit } from '../platform/circuit';
import { createWorld, contactRect, step, PH, type Pad } from '../platform/sim';
import { parseStage, T, type StageJson } from '../platform/stage';

/** 위에서부터 적은 줄을 가로 24칸, 세로 12칸 지도에 놓는다. 맨 아래 줄은 땅, 그 위 줄 오른쪽에 시작 자리 · 열쇠 · 문. */
function map(top: string[]) {
  const rows: string[] = [];
  for (let r = 0; r < 11; r++) rows.push((top[r] ?? '').padEnd(24, '.'));
  rows[10] = rows[10].slice(0, 14) + '.@..K...D.';
  rows.push('#'.repeat(24));
  return rows.join('\n');
}
const LEG = (extra: StageJson['legend'] = {}): StageJson => ({ legend: { w: { type: 'wire' }, s: { type: 'source' }, l: { type: 'lamp', opens: ['x'] }, c: { type: 'contact' }, x: { type: 'bridge' }, ...extra } });
const stageOf = (top: string[], extra?: StageJson['legend']) => {
  const lines = map(top).split('\n');
  lines[3] = lines[3].slice(0, 18) + 'xxx' + lines[3].slice(21);   // 다리는 하늘 한쪽에(회로와 떨어져)
  return parseStage(lines.join('\n'), LEG(extra));
};

// 한 고리: 위에 전구 하나, 왼쪽에 전지, 아래(도름이가 걷는 줄)에 접점 하나
const ONE = [
  '', '', '', '', '', '',
  '..wwwwlwwww',
  '..w.......w',
  '..s.......w',
  '..w.......w',
  '..wwwwcwwww',
];

describe('회로판 계산', () => {
  it('접점이 끊겨 있으면 꺼지고, 이으면 전구 하나가 밝기 1로 켜진다', () => {
    const st = stageOf(ONE), def = st.circuit!;
    expect(def.lamps.length).toBe(1);
    expect(def.contacts.length).toBe(1);
    expect(solveCircuit(def, [false]).power[0]).toBe(0);
    const on = solveCircuit(def, [true]);
    expect(on.power[0]).toBeCloseTo(1, 2);
    expect(on.short[0]).toBe(false);
    expect(lampOn(def, on, def.lamps[0])).toBe(true);
  });

  it('한 줄로 이은 전구 둘은 하나마다 1/4 밝기(켜졌지만 밝지 않다)', () => {
    const st = stageOf([
      '', '', '', '', '', '',
      '..wwlwwwmww',
      '..w.......w',
      '..s.......w',
      '..w.......w',
      '..wwwwcwwww',
    ], { m: { type: 'lamp', opens: ['x'], when: 'on' } });
    const def = st.circuit!, on = solveCircuit(def, [true]);
    for (const p of on.power) { expect(p).toBeCloseTo(0.25, 3); expect(p).toBeGreaterThan(LIT); expect(p).toBeLessThan(BRIGHT); }
    const [l, m] = def.lamps;
    expect(lampOn(def, on, l)).toBe(false);            // 밝게 켜져야 여는 전구
    expect(lampOn(def, on, m)).toBe(true);             // 켜지기만 하면 여는 전구(when "on")
  });

  // 사다리: 왼쪽 · 오른쪽 기둥이 전지 양 끝, 가로대마다 전구 하나와 접점 하나. 위 가로대 접점은 작은 발판(#) 위에(2층)
  const LADDER = [
    '',
    '..wwwwwswwwww',
    '..w.........w',
    '..w.........w',
    '..w.........w',
    '..wwwlwwwcwww',
    '..w......#..w',
    '..w.........w',
    '..w.........w',
    '..w.........w',
    '..wwwmwwwdwww',
  ];
  const ladder = (extra: string[] = []) => stageOf(extra.length ? [...LADDER.slice(0, 7), ...extra, ...LADDER.slice(9)] : LADDER, { m: { type: 'lamp', opens: ['x'] }, d: { type: 'contact' }, ...(extra.length ? { k: { type: 'contact' as const } } : {}) });

  it('갈래(사다리)로 이은 전구 둘은 하나마다 밝기 1이고, 한 갈래를 끊어도 다른 갈래 전구는 밝게 남는다', () => {
    const def = ladder().circuit!;
    expect(def.contacts.length).toBe(2);
    const both = solveCircuit(def, [true, true]);
    expect(both.power[0]).toBeCloseTo(1, 2);
    expect(both.power[1]).toBeCloseTo(1, 2);
    const lower = def.contacts.findIndex(pi => def.parts[pi].ch === 'd');
    const cut = solveCircuit(def, def.contacts.map((_, i) => i !== lower));
    const lampOf = (ch: string) => def.lamps.findIndex(li => def.parts[li].ch === ch);
    expect(cut.power[lampOf('m')]).toBe(0);           // 끊긴 갈래의 전구는 꺼지고
    expect(cut.power[lampOf('l')]).toBeCloseTo(1, 2); // 다른 갈래는 그대로 밝다
  });

  it('끊긴 갈래의 전선은 기둥에 붙어 있어도 흐르지 않는다', () => {
    const def = ladder().circuit!;
    const lower = def.contacts.findIndex(pi => def.parts[pi].ch === 'd');
    const cut = solveCircuit(def, def.contacts.map((_, i) => i !== lower));
    const cellAt = (c: number, r: number) => def.cells.findIndex(x => x.c === c && x.r === r);
    expect(cut.flow[cellAt(7, 10)]).toBe(0);          // 꺼진 아래 갈래의 전선
    expect(cut.flow[cellAt(11, 10)]).toBe(0);         // 끊긴 접점 너머 막다른 전선
    expect(cut.flow[cellAt(7, 5)]).toBeGreaterThan(0.5);   // 켜진 위 갈래의 전선
    expect(cut.flow[cellAt(2, 9)]).toBe(0);           // 기둥이라도 위 갈래 아래쪽 토막은 흐르지 않는다
  });

  it('전구 없이 기둥끼리 잇는 가로대를 닫으면 합선: 그 회로의 전구가 모두 꺼진다', () => {
    const def = ladder(['..wwwwwwwkwww', '..w......#..w']).circuit!;
    const k = def.contacts.findIndex(pi => def.parts[pi].ch === 'k');
    const s = solveCircuit(def, def.contacts.map(() => true));
    expect(s.short[0]).toBe(true);
    expect(s.power).toEqual([0, 0]);
    const off = solveCircuit(def, def.contacts.map((_, i) => i !== k));
    expect(off.short[0]).toBe(false);
    expect(off.power[0]).toBeCloseTo(1, 2);           // 합선 길을 끊으면 다시 켜진다
  });
});

describe('회로판 지도 읽기', () => {
  it('부품에 전선이 두 곳에 붙지 않으면 알려 준다', () => {
    expect(() => stageOf(['', '', '', '', '', '', '..wwwwlwwww', '..w...w...w', '..s.......w', '..w.......w', '..wwwwcwwww'])).toThrow(/전선이 꼭 두 곳/);
  });
  it('접점 아래가 땅이 아니면 알려 준다', () => {
    expect(() => stageOf(['', '', '', '', '', '..wwwwlwwww', '..w.......w', '..s.......w', '..wwwwcwwww'])).toThrow(/접점 "c".*땅/);
  });
  it('회로 하나에 전지가 하나가 아니면 알려 준다', () => {
    expect(() => stageOf(['', '', '', '', '', '', '..wwwwlwwww', '..w.......s', '..s.......w', '..w.......w', '..wwwwcwwww'])).toThrow(/전지가 꼭 하나/);
  });
  it('부품끼리 바로 붙으면 알려 준다', () => {
    expect(() => stageOf(['', '', '', '', '', '', '..wwwlcwwww', '..w.......w', '..s.......w', '..w.......w', '..wwwwwwwww'], { c: { type: 'contact' } })).toThrow(/바로 붙어/);
  });
  it('전구가 여는 것은 다리여야 하고, when 은 bright 나 on 이다', () => {
    expect(() => stageOf(ONE, { l: { type: 'lamp', opens: ['w'] } })).toThrow(/bridge/);
    expect(() => stageOf(ONE, { l: { type: 'lamp', opens: ['x'], when: 'dim' as never } })).toThrow(/when/);
  });
});

describe('도름이가 접점에 서면 이어진다', () => {
  const stay: Pad = { m: 0, j: false };
  it('접점 칸에 서 있는 동안만 전구가 켜지고 다리가 놓인다', () => {
    const st = stageOf(ONE), w = createWorld(st, [{ color: '#F4F7FF' }, { color: '#FFB3C7' }]);
    for (let i = 0; i < 30; i++) step(w, [stay, stay], 1 / 60);
    expect(w.active.has('x')).toBe(false);
    const cell = st.circuit!.cells[st.circuit!.parts[st.circuit!.contacts[0]].cell], r = contactRect(cell.c, cell.r);
    const p = w.players[0]; p.x = r.x + r.w / 2 - p.w / 2; p.y = (cell.r + 1) * T - PH; p.vy = 0;
    for (let i = 0; i < 10; i++) step(w, [stay, stay], 1 / 60);
    expect(w.closed).toEqual([true]);
    expect(w.circuit!.power[0]).toBeCloseTo(1, 2);
    expect(w.active.has('x')).toBe(true);
    for (let i = 0; i < 60; i++) step(w, [{ m: 1, j: false }, stay], 1 / 60);   // 걸어 나가면 끊긴다
    expect(w.closed).toEqual([false]);
    expect(w.active.has('x')).toBe(false);
  });
});

describe('연습 스테이지(회로판 익히기)', () => {
  const load = (f: string) => readFileSync(new URL(`../packs/etc/tutorial/stages/04.${f}`, import.meta.url), 'utf8');
  const st = () => parseStage(load('map.txt'), JSON.parse(load('json')) as StageJson);
  /** who 를 col 칸으로 걸어가게 한다. 친구에게 막히면 뛰어넘는다. */
  const go = (w: ReturnType<typeof createWorld>, who: number, col: number, s = 8) => {
    let jn = 0, last = w.players[who].x, stuck = 0;
    for (let f = 0; f < s * 60; f++) {
      const p = w.players[who], dx = col * T + 4 - p.x;
      if (Math.abs(p.x - last) < 0.3 && p.on) { if (++stuck === 8) { jn++; stuck = 0; } } else stuck = 0;
      last = p.x;
      step(w, w.players.map((_, i) => (i === who && Math.abs(dx) > 3 ? { m: Math.sign(dx) as -1 | 1, j: false, jn } : { m: 0, j: false })), 1 / 60);
      if (Math.abs(col * T + 4 - w.players[who].x) <= 3 && w.players[who].on) return true;
    }
    return false;
  };
  it('한 명이 가까운 접점을 지키면 다리가 놓여 건너고, 건너간 친구가 건너편 접점을 밟아 주면 지킨 친구도 건넌다', () => {
    const w = createWorld(st(), [{ color: '#F4F7FF' }, { color: '#FFB3C7' }]);
    expect(go(w, 0, 17)).toBe(true);                     // 가까운 접점 c
    expect(w.active.has('x')).toBe(true);
    expect(go(w, 1, 33, 14)).toBe(true);                 // 다리를 건너 건너편 접점 d 로
    expect(w.closed).toEqual([true, true]);
    expect(go(w, 0, 31, 10)).toBe(true);                 // 지키던 친구가 떠나도 갈래로 이어진 d 가 다리를 붙잡는다
    expect(w.players[0].y + PH).toBe(16 * T);            // 떨어지지 않고 건너편 땅에 섰다
  });
  it('혼자서는 건너지 못한다: 접점에서 떠나면 다리가 사라져 떨어진다', () => {
    const w = createWorld(st(), [{ color: '#F4F7FF' }, { color: '#FFB3C7' }]);
    expect(go(w, 0, 17)).toBe(true);
    go(w, 0, 33, 6);
    expect(w.players[0].x).toBeLessThan(24 * T);         // 다리 앞에서 떨어져 시작 자리로 돌아갔다
  });
});
