import { describe, expect, it } from 'vitest';
import { parseStage, resolveNeed, T } from '../platform/stage';
import { createWorld, step, PH, type Pad, type World } from '../platform/sim';

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
  '.@.....a.....K.....D....',
  '########xxx#############',
  '########...#############',
].join('\n');
const LEGEND = { a: { type: 'button' as const, need: 1 as const, opens: ['x'] }, x: { type: 'bridge' as const } };

const run = (w: World, pads: Pad[], seconds: number) => { for (let i = 0; i < seconds * 60; i++) step(w, pads, 1 / 60); };
const stay: Pad = { m: 0, j: false }, right: Pad = { m: 1, j: false, a: true };   // 오른쪽으로 가며 확인 단추도 누른다

describe('필요 인원', () => {
  it('비율은 방 인원에 맞춰 풀린다', () => {
    expect(resolveNeed('half', 2)).toBe(1);
    expect(resolveNeed('half', 30)).toBe(15);
    expect(resolveNeed('half', 7)).toBe(4);
    expect(resolveNeed('all', 30)).toBe(30);
    expect(resolveNeed('third', 30)).toBe(10);
    expect(resolveNeed(5, 2)).toBe(2);
  });
});

describe('지도 읽기', () => {
  it('열쇠·문·단추·다리를 찾는다', () => {
    const s = parseStage(FLAT, { legend: LEGEND });
    expect(s.cols).toBe(24);
    expect(s.buttons).toHaveLength(1);
    expect(s.bridges[0].cells).toHaveLength(3);
    expect(s.door).toEqual({ x: 19 * T, y: 7 * T, w: 2 * T, h: 3 * T });
  });
  it('뜻 모르는 글자는 어디인지 알려 준다', () => {
    expect(() => parseStage(FLAT.replace('K', 'Z'), { legend: LEGEND })).toThrow(/뜻을 모르는 글자/);
  });
  it('단추 없는 다리는 받지 않는다', () => {
    expect(() => parseStage(FLAT, { legend: { a: { type: 'button' }, x: { type: 'bridge' } } })).toThrow(/opens/);
    expect(() => parseStage(FLAT.replace('a', '.'), { legend: { x: { type: 'bridge' } } })).toThrow(/여는 단추나 장치가 없어요/);
  });
  it('줄 길이가 다르면 받지 않는다', () => {
    expect(() => parseStage(FLAT + '\n###', { legend: LEGEND })).toThrow(/줄 길이/);
  });
});

describe('움직임', () => {
  it('땅에 내려선다', () => {
    const w = createWorld(parseStage(FLAT, { legend: LEGEND }), [{ color: '#fff' }]);
    run(w, [stay], 0.5);
    expect(w.players[0].on).toBe(true);
    expect(w.players[0].y + PH).toBeCloseTo(10 * T, 0);
  });
  it('혼자서는 구덩이를 못 건넌다(단추를 밟아 줄 사람이 없다)', () => {
    const w = createWorld(parseStage(FLAT, { legend: LEGEND }), [{ color: '#fff' }]);
    run(w, [right], 6);
    expect(w.doorOpen).toBe(false);
    expect(w.won).toBe(false);
  });
  it('한 명이 단추를 밟아 주면 다리가 놓인다', () => {
    const w = createWorld(parseStage(FLAT, { legend: LEGEND }), [{ color: '#fff' }, { color: '#fff' }]);
    // 1번이 단추(7번째 칸)까지 걸어가 선다
    for (let i = 0; i < 600 && w.players[1].x < 7 * T + 4; i++) step(w, [stay, right], 1 / 60);
    run(w, [stay, stay], 0.2);
    expect(w.active.has('x')).toBe(true);
  });
  it('한 명이 다리를 붙잡아 주면 다른 한 명이 열쇠를 들고 건너 문을 연다. 모두 들어가기 전에는 끝나지 않는다', () => {
    const w = createWorld(parseStage(FLAT, { legend: LEGEND }), [{ color: '#fff' }, { color: '#fff' }]);
    for (let i = 0; i < 600 && w.players[1].x < 7 * T + 4; i++) step(w, [stay, right], 1 / 60);
    // 0번이 다리를 건너 열쇠를 줍고 문으로
    // 단추 위에 선 친구에게 막히면 뛰어넘는다
    let prev = -1;
    for (let i = 0; i < 1200 && !w.doorOpen; i++) {
      const stuck = w.players[0].x === prev && w.players[0].on;
      prev = w.players[0].x;
      step(w, [{ m: 1, j: stuck && !w.players[0].jumpHeld }, stay], 1 / 60);
    }
    expect(w.doorOpen).toBe(true);
    run(w, [right, stay], 0.5); // 열린 문 앞에서 확인을 눌러 들어간다
    expect(w.players[0].inDoor).toBe(true);
    expect(w.won).toBe(false); // 한 명은 아직 단추 위. 모두 들어가야 끝난다
  });
});

describe('상자', () => {
  const CRATE = [
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '......cc................',
    '.@..K.cc...........D....',
    '##########..############',
    '##########..############',
    '########################',
  ].join('\n');
  it('혼자 들어온 방에서는 필요 인원이 1로 낮아져 혼자 밀 수 있다', () => {
    const w = createWorld(parseStage(CRATE, { legend: { c: { type: 'crate', need: 2 } } }), [{ color: '#fff' }]);
    const x0 = w.crates[0].x;
    run(w, [right], 3);
    expect(w.crates[0].need).toBe(1); // 혼자 들어오면 필요 인원도 1로 낮아진다
    expect(w.crates[0].x).toBeGreaterThan(x0);
  });
  it('30명 방에서 절반이 필요하면 15명이 밀어야 움직인다', () => {
    const stage = parseStage(CRATE, { legend: { c: { type: 'crate', need: 'half' } } });
    const w = createWorld(stage, Array.from({ length: 30 }, () => ({ color: '#fff' })));
    expect(w.crates[0].need).toBe(15);
    const x0 = w.crates[0].x;
    const pads = (n: number) => w.players.map((_, i) => (i < n ? right : stay));
    run(w, pads(14), 4);
    expect(w.crates[0].x).toBe(x0);
    run(w, pads(30), 4);                       // 모두 붙어 밀면 움직인다(뒤에 줄 서서 미는 사람도 센다)
    expect(w.crates[0].x).toBeGreaterThan(x0);
  });
  it('구멍 위에 오면 떨어져 길이 된다(상자 윗면이 땅과 같은 높이)', () => {
    const w = createWorld(parseStage(CRATE, { legend: { c: { type: 'crate', need: 2 } } }), [{ color: '#fff' }, { color: '#fff' }]);
    run(w, [right, right], 12);
    expect(w.crates[0].x).toBe(10 * T);
    expect(w.crates[0].y).toBe(10 * T);
  });
});

describe('끼임 막기', () => {
  const HOLE = [
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '......cc................',
    '.@..K.cc...........D....',
    '##########..############',
    '##########..############',
    '########################',
  ].join('\n');
  it('구멍 속에 서 있던 친구 위로 상자가 떨어지면 그 친구는 상자 위로 올라온다(묻히지 않는다)', () => {
    const w = createWorld(parseStage(HOLE, { legend: { c: { type: 'crate', need: 1 } } }), [{ color: '#fff' }, { color: '#fff' }]);
    const [pusher, inHole] = w.players;
    inHole.x = 10 * T + 4; inHole.y = 12 * T - PH;      // 구멍 바닥
    for (let i = 0; i < 12 * 60; i++) step(w, [right, stay], 1 / 60);
    expect(w.crates[0].x).toBe(10 * T);
    const c = w.crates[0];
    const buried = inHole.x < c.x + c.w && inHole.x + inHole.w > c.x && inHole.y < c.y + c.h && inHole.y + inHole.h > c.y;
    expect(buried).toBe(false);
    const x0 = inHole.x;
    for (let i = 0; i < 60; i++) step(w, [stay, right], 1 / 60);
    expect(inHole.x).toBeGreaterThan(x0);              // 다시 움직일 수 있다
    void pusher;
  });
  it('상자 앞에 선 친구가 벽에 막히면 상자도 멈춘다', () => {
    const WALL = HOLE.replace('##########..############\n##########..############', '########################\n########################').replace('.@..K.cc...........D....', '.@..K.cc.#.........D....').replace('......cc................', '......cc.#..............');
    const w = createWorld(parseStage(WALL, { legend: { c: { type: 'crate', need: 1 } } }), [{ color: '#fff' }, { color: '#fff' }]);
    const front = w.players[1];
    front.x = 8 * T + 4; front.y = 10 * T - PH;         // 상자(6~7칸)와 벽(9칸) 사이
    for (let i = 0; i < 6 * 60; i++) step(w, [right, stay], 1 / 60);
    const c = w.crates[0];
    expect(front.x + front.w).toBeLessThanOrEqual(9 * T + 0.01);
    expect(c.x + c.w).toBeLessThanOrEqual(front.x + 0.01);
  });
  it('양쪽에서 같은 수로 밀면 움직이지 않는다', () => {
    const w = createWorld(parseStage(HOLE, { legend: { c: { type: 'crate', need: 1 } } }), [{ color: '#fff' }, { color: '#fff' }]);
    w.players[1].x = 9 * T; w.players[1].y = 10 * T - PH;
    const push = () => step(w, [right, { m: -1, j: false }], 1 / 60);
    for (let i = 0; i < 90; i++) push();                   // 둘 다 상자에 닿을 때까지
    const x0 = w.crates[0].x;
    for (let i = 0; i < 180; i++) push();
    expect(w.crates[0].x).toBe(x0);
  });
  it('한 번에 긴 시간을 건너뛰어도 바닥을 뚫지 않는다', () => {
    const w = createWorld(parseStage(FLAT, { legend: LEGEND }), [{ color: '#fff' }]);
    step(w, [stay], 0.5); step(w, [stay], 2);
    expect(w.players[0].y + PH).toBeCloseTo(10 * T, 0);
  });
});

describe('시작 자리', () => {
  it('오른쪽 끝 칸이어도 모두 지도 안에 서고 움직일 수 있다', () => {
    const edge = FLAT.replace('.@.', '...').split('\n').map((l, i) => (i === 9 ? l.slice(0, 23) + '@' : l)).join('\n');
    const w = createWorld(parseStage(edge, { legend: LEGEND }), Array.from({ length: 30 }, () => ({ color: '#fff' })));
    for (const p of w.players) { expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x + p.w).toBeLessThanOrEqual(24 * T); }
    const x0 = w.players.map(p => p.x);
    for (let i = 0; i < 60; i++) step(w, w.players.map(() => ({ m: -1 as const, j: false })), 1 / 60);
    w.players.forEach((p, i) => expect(p.x).toBeLessThan(x0[i]));
  });
  it('시작 자리 위가 땅이면 지도를 받지 않는다', () => {
    const lines = FLAT.split('\n'); lines[8] = '.#' + lines[8].slice(2);
    expect(() => parseStage(lines.join('\n'), { legend: LEGEND })).toThrow(/바로 위가 땅/);
  });
  it('문이 공중에 뜨거나 단추가 공중이면 받지 않는다', () => {
    const lines = FLAT.split('\n'); lines[9] = lines[9].replace('D', '.'); lines[5] = lines[5].slice(0, 19) + 'D' + lines[5].slice(20);
    expect(() => parseStage(lines.join('\n'), { legend: LEGEND })).toThrow(/문\(D\) 바로 아래/);
    const l2 = FLAT.split('\n'); l2[9] = l2[9].replace('a', '.'); l2[6] = l2[6].slice(0, 7) + 'a' + l2[6].slice(8);
    expect(() => parseStage(l2.join('\n'), { legend: LEGEND })).toThrow(/바로 아래는 땅/);
  });
  it('모르는 칸 이름은 알려 준다', () => {
    expect(() => parseStage(FLAT, { legend: { a: { type: 'button', opens: ['x'], nead: 1 } as never, x: { type: 'bridge' } } })).toThrow(/모르는 칸/);
    expect(() => parseStage(FLAT, { legend: LEGEND, legned: {} } as never)).toThrow(/모르는 칸/);
  });
});

describe('서로 막히기와 확인 단추', () => {
  it('서 있는 친구를 옆으로 지나가지 못한다', () => {
    const w = createWorld(parseStage(FLAT, { legend: LEGEND }), [{ color: '#fff' }, { color: '#fff' }]);
    run(w, [stay, stay], 0.3);
    const [a, b] = w.players;                       // a 가 왼쪽, b 가 바로 오른쪽에 선다
    run(w, [{ m: 1, j: false }, stay], 1);
    expect(a.x + a.w).toBeLessThanOrEqual(b.x + 0.01);
  });
  it('뛰어서 친구 머리 위에 설 수 있다', () => {
    const w = createWorld(parseStage(FLAT, { legend: LEGEND }), [{ color: '#fff' }, { color: '#fff' }]);
    run(w, [stay, stay], 0.3);
    const [a, b] = w.players;
    for (let i = 0; i < 90; i++) step(w, [{ m: a.x < b.x - 1 ? 1 : 0, j: i < 20 }, stay], 1 / 60);
    expect(a.on).toBe(true);
    expect(Math.abs(a.y + a.h - b.y)).toBeLessThanOrEqual(2);
  });
  it('열린 문에 닿기만 해서는 들어가지 않고, 확인을 눌러야 들어간다', () => {
    const w = createWorld(parseStage(FLAT, { legend: LEGEND }), [{ color: '#fff' }]);
    const p = w.players[0];
    p.x = 19 * T + 10; p.y = 10 * T - PH; w.doorOpen = true; w.key.used = true;
    run(w, [stay], 0.5);
    expect(p.inDoor).toBe(false);
    run(w, [{ m: 0, j: false, a: true }], 0.1);
    expect(p.inDoor).toBe(true);
    expect(w.won).toBe(true);
  });
  it('문 앞이 아니면 확인을 눌러도 아무 일도 없다', () => {
    const w = createWorld(parseStage(FLAT, { legend: LEGEND }), [{ color: '#fff' }]);
    w.doorOpen = true;
    run(w, [{ m: 0, j: false, a: true }], 0.5);
    expect(w.players[0].inDoor).toBe(false);
  });
  it('서른 명이 시작해도 단추는 눌리지 않고, 열쇠도 줍지 않고, 모두 지도 안에 선다', () => {
    const stage = parseStage(FLAT, { legend: LEGEND });
    const w = createWorld(stage, Array.from({ length: 30 }, () => ({ color: '#fff' })));
    run(w, w.players.map(() => stay), 0.5);
    expect(w.pressed[0]).toBe(0);
    expect(w.key.holder).toBe(null);
    for (const p of w.players) { expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x + p.w).toBeLessThanOrEqual(stage.cols * T); }
    expect(new Set(w.players.map(p => Math.round(p.y))).size).toBeGreaterThan(1);   // 자리가 모자라면 머리 위로 줄을 더 선다
  });
});

describe('줄 서서 밀기', () => {
  const LONG = Array.from({ length: 13 }, (_, r) => (r >= 10 ? '#'.repeat(60) : r === 9 ? '.@' + '.'.repeat(28) + 'cc' + '.'.repeat(24) + 'K.D.' : r === 8 ? '.'.repeat(30) + 'cc' + '.'.repeat(28) : '.'.repeat(60))).join('\n');
  const lineUp = (n: number, need: number, reverse: boolean) => {
    const w = createWorld(parseStage(LONG, { legend: { c: { type: 'crate', need } } }), Array.from({ length: n }, () => ({ color: '#fff' })));
    w.crates[0].need = need;
    const order = w.players.map((_, i) => i); if (reverse) order.reverse();
    order.forEach((pi, k) => { const p = w.players[pi]; p.x = 30 * T - (k + 1) * 23; p.y = 10 * T - PH; });   // 상자 왼쪽에 한 줄
    return w;
  };
  it.each([[1, 1, false], [3, 3, false], [3, 3, true], [15, 15, false], [15, 15, true]])('%i명이 필요 %i인 상자를 밀면 세는 수가 흔들리지 않고 제 빠르기로 간다(번호 거꾸로=%s)', (n, need, reverse) => {
    const w = lineUp(n, need, reverse);
    const x0 = w.crates[0].x;
    for (let i = 0; i < 30; i++) step(w, w.players.map(() => right), 1 / 60);      // 모두 맞닿을 때까지
    const seen = new Set<number>();
    for (let i = 0; i < 180; i++) { step(w, w.players.map(() => right), 1 / 60); seen.add(w.crates[0].pushers); }
    expect([...seen]).toEqual([n]);
    expect(w.crates[0].x - x0).toBeGreaterThan(55 * 3 * 0.95);                     // 3초에 165px 가까이
  });
  it('줄 가운데 한 명이 안 밀면 그 뒤는 세지 않는다', () => {
    const w = lineUp(4, 3, false);
    const x0 = w.crates[0].x;
    for (let i = 0; i < 120; i++) step(w, w.players.map((p) => (p.i === 1 ? stay : right)), 1 / 60);
    expect(w.crates[0].x).toBe(x0);
  });
});

describe('머리 위 친구와 문', () => {
  it('머리 위에 친구가 서 있으면 뛰어올라 뚫지 못한다', () => {
    const w = createWorld(parseStage(FLAT, { legend: LEGEND }), [{ color: '#fff' }, { color: '#fff' }]);
    const [low, top] = w.players;
    run(w, [stay, stay], 0.3);
    top.x = low.x; top.y = low.y - PH - 1; top.vy = 0;
    run(w, [stay, stay], 0.2);
    const y0 = low.y;
    for (let i = 0; i < 40; i++) step(w, [{ m: 0, j: i < 5 }, stay], 1 / 60);
    expect(low.y).toBeCloseTo(y0, 0);
    expect(top.y + top.h).toBeLessThanOrEqual(low.y + 2);
  });
  it('문 안에서 확인을 새로 누르면 다시 나오고, 손을 떼기 전에는 도로 들어가지 않는다', () => {
    const w = createWorld(parseStage(FLAT, { legend: LEGEND }), [{ color: '#fff' }, { color: '#fff' }]);
    const p = w.players[0];
    p.x = 19 * T + 10; p.y = 10 * T - PH; w.doorOpen = true; w.key.used = true;
    const press: Pad = { m: 0, j: false, a: true };
    run(w, [press, stay], 0.1); expect(p.inDoor).toBe(true);
    run(w, [stay, stay], 0.1);
    run(w, [press, stay], 0.3); expect(p.inDoor).toBe(false);       // 나온 뒤 계속 누르고 있어도 밖에 있다
    run(w, [stay, stay], 0.1);
    run(w, [press, stay], 0.1); expect(p.inDoor).toBe(true);
    expect(w.won).toBe(false);                                        // 한 명은 아직 밖
  });
  it('겹쳐 선 도름이끼리는 조금씩 떨어진다', () => {
    const w = createWorld(parseStage(FLAT, { legend: LEGEND }), [{ color: '#fff' }, { color: '#fff' }]);
    const [a, b] = w.players;
    a.x = 4 * T; b.x = a.x; b.y = a.y;
    run(w, [stay, stay], 1.5);
    expect(Math.abs(a.x - b.x)).toBeGreaterThanOrEqual(a.w - 1);
  });
});

describe('뛰기 누름이 버려지지 않는다', () => {
  const rows = Array.from({ length: 13 }, (_, r) => (r >= 10 ? '#'.repeat(40) : '.'.repeat(40)).split(''));
  rows[9][1] = '@'; rows[9][34] = 'K'; rows[9][36] = 'D';
  rows[9][10] = '#';                                   // 한 칸 턱
  for (const r of [6, 7, 8, 9]) rows[r][20] = '#';     // 네 칸 벽(뛰어도 못 넘는다)
  for (const r of [10, 11, 12]) for (const c of [24, 25, 26, 27, 28, 29]) rows[r][c] = '.';   // 구덩이(턱 끝 시험)
  const MAP = rows.map(r => r.join('')).join('\n');
  const FLOOR = 10 * T - PH;
  const make = (x: number) => { const w = createWorld(parseStage(MAP, {}), [{ color: '#fff' }]); const p = w.players[0]; p.x = x; p.y = FLOOR - 0.47; return { w, p }; };
  const go = (w: World, pad: Pad, frames: number) => { for (let i = 0; i < frames; i++) step(w, [pad], 1 / 60); };
  const R: Pad = { m: 1, j: false }, RJ: Pad = { m: 1, j: true };

  it.each([1, 2, 3, 4, 5, 6])('착지 %i프레임 전에 눌러도 착지하면 다시 뛴다', lead => {
    const landing = () => { const { w, p } = make(12 * T); go(w, R, 5); go(w, RJ, 2); go(w, R, 1); let f = 0; while (!p.on && f < 200) { go(w, R, 1); f++; } return f; };
    const landF = landing();
    const { w, p } = make(12 * T); go(w, R, 5); go(w, RJ, 2); go(w, R, 1);
    go(w, R, landF - lead);
    go(w, RJ, 3);                                       // 아직 공중일 때 누른다
    let top = p.y; for (let i = 0; i < 25; i++) { go(w, R, 1); top = Math.min(top, p.y); }
    expect(FLOOR - top).toBeGreaterThan(60);
  });

  it('공중에서 한참 전에 누른 것은 기억하지 않는다(착지해도 저절로 뛰지 않는다)', () => {
    const { w, p } = make(12 * T); go(w, R, 5); go(w, RJ, 2); go(w, R, 3);
    go(w, RJ, 2); go(w, R, 1);                          // 뜬 직후 한 번 더 누름(착지까지 0.5초 넘게 남음)
    let f = 0; while (!p.on && f < 200) { go(w, R, 1); f++; }
    let top = p.y; for (let i = 0; i < 20; i++) { go(w, R, 1); top = Math.min(top, p.y); }
    expect(FLOOR - top).toBeLessThan(3);
  });

  it('누르고 있기만 해서는 착지할 때마다 다시 뛰지 않는다', () => {
    const { w, p } = make(12 * T);
    go(w, RJ, 120);                                     // 2초 동안 계속 누름
    let jumps = 0, prevOn = true;
    const { w: w2, p: q } = make(12 * T);
    for (let i = 0; i < 180; i++) { go(w2, RJ, 1); if (prevOn && !q.on && q.vy < -300) jumps++; prevOn = q.on; }
    expect(jumps).toBe(1);
    void p; void w;
  });

  it.each([[8 * T, '한 칸 턱'], [18 * T, '네 칸 벽']])('앞으로 가다 지형에 막혀도 제자리에서 뛴다(%s 앞)', (x) => {
    for (let phase = 0; phase < 30; phase++) {
      const { w, p } = make(x as number);
      go(w, R, 30 + phase);                             // 막힐 때까지 밀고
      const y0 = p.y; let top = y0;
      go(w, RJ, 1);                                     // 한 프레임만 누름
      for (let i = 0; i < 40; i++) { go(w, R, 1); top = Math.min(top, p.y); }
      expect(y0 - top).toBeGreaterThan(25);
    }
  });

  it.each([39, 41, 43, 47])('막힌 채 %i프레임마다 연달아 눌러도 누를 때마다 뛴다(착지 직전에 누른 것도)', period => {
    // 한 번 뛰면 40프레임쯤 떠 있다. 39는 착지 직전에 누르게 되는 박자다. 이보다 빠르게 누르면 공중 한가운데서 누르는 셈이라 버려지는 것이 맞다.
    const { w, p } = make(18 * T);
    go(w, R, 40);
    let jumps = 0, presses = 0, prevVy = 0;
    for (let i = 0; i < period * 8; i++) {
      const press = i % period < 2;
      if (i % period === 0) presses++;
      go(w, { m: 1, j: press }, 1);
      if (prevVy >= 0 && p.vy < -300) jumps++;
      prevVy = p.vy;
    }
    expect(jumps).toBe(presses);
  });

  it('턱 끝에서 발이 떨어진 직후에 눌러도 뛴다', () => {
    const { w, p } = make(23 * T);
    let f = 0; while (p.on && f < 200) { go(w, R, 1); f++; }   // 구덩이로 걸어 나감
    go(w, R, 2);                                        // 발이 떨어지고 2프레임 뒤
    go(w, RJ, 1);
    expect(p.vy).toBeLessThan(-300);
  });
});

describe('상자와 다리가 겹칠 때', () => {
  const MAP = [
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '...........y............',
    '.........cc.............',
    '.@.a.....cc..xx.....K.D.',
    '########################',
  ].join('\n');
  const LEG = { a: { type: 'button' as const, need: 1 as const, opens: ['x', 'y'] }, x: { type: 'bridge' as const }, y: { type: 'bridge' as const }, c: { type: 'crate' as const, need: 1 as const } };
  const two = [{ color: '#111111' }, { color: '#222222' }];
  const onButton = (w: World) => { const b = w.stage.buttons[0], p = w.players[1]; p.x = b.x; p.y = b.y + b.h - PH; p.vy = 0; };
  const floor = 11 * T;

  it('단추로 생긴 다리가 상자 자리에 나타나도 상자를 밀어 빼낼 수 있다', () => {
    const w = createWorld(parseStage(MAP, { legend: LEG }), two);
    run(w, [stay, stay], 0.3);
    const c = w.crates[0];
    c.x = 12 * T; c.y = floor - c.h;                          // 다리 칸(13열)에 걸친 자리
    const p = w.players[0]; p.x = c.x - p.w; p.y = floor - PH; p.vy = 0;
    onButton(w);
    run(w, [stay, stay], 0.2);
    expect(w.active.has('x')).toBe(true);
    const before = c.x;
    for (let i = 0; i < 60; i++) { onButton(w); step(w, [{ m: 1, j: false }, stay], 1 / 60); }
    expect(c.x).toBeGreaterThan(before + 20);
  });

  it('상자에 탄 사람은 다리에 막히면 제자리에 남고 다리와 겹치지 않는다', () => {
    const w = createWorld(parseStage(MAP, { legend: LEG }), [...two, { color: '#333333' }]);
    run(w, [stay, stay, stay], 0.3);
    const c = w.crates[0], rider = w.players[2], pusher = w.players[0];
    rider.x = c.x + c.w - rider.w - 1; rider.y = c.y - PH; rider.vy = 0;
    pusher.x = c.x - pusher.w; pusher.y = floor - PH; pusher.vy = 0;
    const cell = w.stage.bridges.find(b => b.ch === 'y')!.cells[0], wall = { x: cell[0] * T, y: cell[1] * T, w: T, h: T };
    let hit = false;
    for (let i = 0; i < 90; i++) {
      onButton(w); step(w, [{ m: 1, j: false }, stay, stay], 1 / 60);
      hit ||= rider.x < wall.x + wall.w && rider.x + rider.w > wall.x && rider.y < wall.y + wall.h && rider.y + rider.h > wall.y;   // 다리를 뚫고 지나가지도 않는다
    }
    expect(w.active.has('y')).toBe(true);
    expect(w.crates[0].x).toBeGreaterThan(c.x - 1);
    expect(hit).toBe(false);
  });
});
