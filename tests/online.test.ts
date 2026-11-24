/**
 * 온라인으로 함께 하기의 규칙을 화면도 방 서버도 없이 본다:
 * 가운데 사람이 나갈 때(removePlayer), 세계 요약 왕복(sync), 방의 규칙(room-rules), 연결(net)과 방의 규칙을 이어 붙인 흐름.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { colorFor } from '../platform/identity';
import { joinRoom, listPublic, type Down, type RoomLink } from '../platform/net';
import { CLOSE, HOST_QUIET_MS, IDLE_MS, LIMITS, MAX_SEATS, PublicList, RoomCore, cleanPad, cleanRoomInfo, originAllowed, readJoinQuery, type JoinQuery, type RoomInfo, type Saved } from '../platform/room-rules';
import { createWorld, removePlayer, step, type Pad, type World } from '../platform/sim';
import { RNOTE, RNOTE_LIST } from '../platform/graph/model';
import { parseStage, type StageJson } from '../platform/stage';
import { SNAP_EVERY, applyWire, blend, newTrack, pushWire, readWire, toWire, wireSeats, type Wire } from '../platform/sync';

const load = (pack: string, file: string) => {
  const dir = fileURLToPath(new URL(`../packs/${pack}/stages/`, import.meta.url));
  return parseStage(readFileSync(`${dir}${file}.map.txt`, 'utf8'), JSON.parse(readFileSync(`${dir}${file}.json`, 'utf8')) as StageJson);
};
const people = (n: number) => Array.from({ length: n }, (_, i) => ({ color: colorFor(i) }));
const idle = (w: World): Pad[] => w.players.map(() => ({ m: 0, j: false }));
const run = (w: World, pads: (f: number) => Pad[], frames: number) => { for (let f = 0; f < frames; f++) step(w, pads(f), 1 / 60); };

describe('가운데 사람이 나간다(removePlayer)', () => {
  it('그 도름이만 빠지고 뒤 번호가 당겨지며, 남은 도름이의 색과 자리는 그대로다', () => {
    const w = createWorld(load('etc/tutorial', '01'), people(4), 3);
    run(w, () => idle(w), 30);
    const before = w.players.map(p => ({ x: p.x, y: p.y, color: p.color }));
    removePlayer(w, 1);
    expect(w.players.map(p => p.i)).toEqual([0, 1, 2]);
    expect(w.players.map(p => p.color)).toEqual([before[0].color, before[2].color, before[3].color]);
    expect(w.players.map(p => p.x)).toEqual([before[0].x, before[2].x, before[3].x]);
    removePlayer(w, 9);                                   // 없는 번호는 아무 일도 없다
    expect(w.players.length).toBe(3);
  });

  it('필요 인원을 남은 사람 수로 다시 푼다', () => {
    const stage = load('etc/tutorial', '01');
    const w = createWorld(stage, people(6), 1), six = w.needs.slice();
    removePlayer(w, 2); removePlayer(w, 0);
    expect(w.needs).toEqual(createWorld(stage, people(4), 1).needs);
    expect(w.crates.map(c => c.need)).toEqual(createWorld(stage, people(4), 1).crates.map(c => c.need));
    expect(six.length).toBe(w.needs.length);
  });

  it('열쇠를 든 사람이 땅에 서 있다 나가면 열쇠는 그 발밑에 놓이고, 다른 사람이 주울 수 있다', () => {
    const w = createWorld(load('etc/tutorial', '01'), people(3), 1);
    run(w, () => idle(w), 20);
    const p = w.players[1];
    w.key.holder = 1;
    removePlayer(w, 1);
    expect(w.key.holder).toBeNull();
    expect(w.key.x).toBeCloseTo(p.x + p.w / 2 - 16, 5);
    expect(w.key.y).toBeCloseTo(p.y + p.h - 18, 5);
    // 남은 도름이를 그 자리에 세우면 줍는다
    w.players[0].x = w.key.x; w.players[0].y = p.y;
    run(w, () => idle(w), 3);
    expect(w.key.holder).toBe(0);
  });

  it('열쇠를 든 사람이 공중에서 나가면 열쇠는 처음 자리로 돌아간다', () => {
    const stage = load('etc/tutorial', '01');
    const w = createWorld(stage, people(2), 1);
    w.key.holder = 0; w.players[0].on = false;
    removePlayer(w, 0);
    expect(w.key).toMatchObject({ holder: null, x: stage.key!.x, y: stage.key!.y });
  });

  it('뒤 번호가 열쇠를 들고 있으면 든 사람 번호도 함께 당겨진다', () => {
    const w = createWorld(load('etc/tutorial', '01'), people(4), 1);
    w.key.holder = 3;
    removePlayer(w, 1);
    expect(w.key.holder).toBe(2);
    run(w, () => idle(w), 2);
    expect(w.key.holder).toBe(2);
  });

  it('나간 사람이 들고 있던 그래프는 떨어지고, 함께 들던 사람들의 번호는 당겨진다', () => {
    const w = createWorld(load('math/graph-factory', '02'), people(4), 4);
    w.g.pieces.push({ id: 1, fac: 0, spec: { latex: '0', a: 0, b: 3, x0: 0 }, shape: { runs: [[[0, -26], [90, -26]]], need: 1, arc: 3, box: { x: 0, y: -26, w: 90, h: 26 } }, x: 100, y: 200, vy: 0, state: 'held', holders: [1, 3], stand: -1, ignore: 0 });
    removePlayer(w, 2);
    expect(w.g.pieces[0].holders).toEqual([1, 2]);
    removePlayer(w, 1);
    expect(w.g.pieces[0].state).toBe('fall');
  });

  it('마지막 한 명이 나가도 무너지지 않고, 빈 세계는 끝난 것으로 치지 않는다', () => {
    const w = createWorld(load('etc/tutorial', '01'), people(1), 1);
    removePlayer(w, 0);
    w.doorOpen = true;
    run(w, () => [], 10);
    expect(w.players.length).toBe(0);
    expect(w.won).toBe(false);
  });
});

describe('세계 요약(sync)', () => {
  const seats = [0, 1, 2, 3];
  /** 방장 세계를 아무렇게나 굴린다: 걷고 뛰고 확인을 누른다. */
  function busy(pack: string, file: string, n: number, seed: number, frames: number) {
    const w = createWorld(load(pack, file), people(n), seed);
    let r = seed * 2654435761 % 4294967296;
    const rnd = () => (r = (r * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const pads: Pad[] = w.players.map(() => ({ m: 0, j: false, a: false }));
    run(w, f => { if (f % 20 === 0) w.players.forEach((_, i) => { pads[i] = { m: ([-1, 0, 1, 1] as const)[Math.floor(rnd() * 4)], j: rnd() < 0.3, a: rnd() < 0.4 }; }); return pads; }, frames);
    return w;
  }

  it.each([['etc/tutorial', '01'], ['etc/tutorial', '02'], ['math/graph-factory', '03'], ['math/graph-factory', '05']])('%s %s: 요약을 덮어쓴 손님 세계가 방장 세계와 같은 요약을 낸다', (pack, file) => {
    for (const seed of [1, 2, 3]) {
      const host = busy(pack, file, 4, seed, 60 * 12);
      const wire = readWire(JSON.parse(JSON.stringify(toWire(host, seats, 7, 99))));
      expect(wire, '방장이 만든 요약은 검사를 통과한다').not.toBeNull();
      const guest = createWorld(host.stage, people(4), seed);   // 같은 스테이지, 같은 씨앗
      expect(applyWire(guest, wire!)).toBe(true);
      expect(toWire(guest, seats, 7, 99)).toEqual(wire);
      // 화면에 그려지는 것들이 같다: 그래프 조각, 공·물방울, 판 알림, 다리, 문
      expect(guest.g.pieces.map(q => [q.id, q.state, q.holders])).toEqual(host.g.pieces.map(q => [q.id, q.state, q.holders]));
      expect(guest.g.bodies.map(b => b.k)).toEqual(host.g.bodies.map(b => b.k));
      expect([guest.g.round.on, guest.g.round.score, guest.g.round.noteT > 0 ? guest.g.round.note : '']).toEqual([host.g.round.on, host.g.round.score, host.g.round.noteT > 0 ? host.g.round.note : '']);
      expect([...guest.active].sort()).toEqual([...host.active].sort());
      expect([guest.doorOpen, guest.won, guest.key.holder, guest.key.used]).toEqual([host.doorOpen, host.won, host.key.holder, host.key.used]);
      guest.players.forEach((p, i) => { expect(Math.abs(p.x - host.players[i].x)).toBeLessThanOrEqual(0.05); expect(Math.abs(p.y - host.players[i].y)).toBeLessThanOrEqual(0.05); });
    }
  });

  it('방장이 바뀌어도 이어 간다: 요약을 받은 손님 세계를 그대로 굴리면 방장 세계와 같이 나아간다', () => {
    const host = busy('math/graph-factory', '03', 3, 5, 60 * 6);
    const guest = createWorld(host.stage, people(3), 5);
    applyWire(guest, toWire(host, [0, 1, 2], 1, 1));
    const pads = (f: number): Pad[] => [{ m: 1, j: f % 50 === 0, jn: Math.floor(f / 50) }, { m: -1, j: false }, { m: 0, j: false }];
    run(host, pads, 120); run(guest, pads, 120);
    guest.players.forEach((p, i) => { expect(Math.abs(p.x - host.players[i].x)).toBeLessThan(3); expect(Math.abs(p.y - host.players[i].y)).toBeLessThan(3); });
    expect(guest.g.round.score).toEqual(host.g.round.score);
    expect(guest.g.bodies.length).toEqual(host.g.bodies.length);
  });

  it('사람 수와 색은 요약의 자리 번호를 따른다(가운데 사람이 빠진 뒤에도)', () => {
    const host = createWorld(load('etc/tutorial', '01'), [0, 3, 7].map(s => ({ color: colorFor(s) })), 1);
    const guest = createWorld(host.stage, people(5), 1);
    const wire = toWire(host, [0, 3, 7], 1, 1);
    expect(wireSeats(wire)).toEqual([0, 3, 7]);
    expect(applyWire(guest, wire)).toBe(true);
    expect(guest.players.map(p => p.color)).toEqual([0, 3, 7].map(colorFor));
    expect(guest.needs).toEqual(host.needs);
  });

  it('다른 스테이지의 요약이나 모양이 어긋난 요약은 쓰지 않는다', () => {
    const a = createWorld(load('etc/tutorial', '01'), people(2), 1), b = createWorld(load('math/graph-factory', '05'), people(2), 1);
    const wire = toWire(b, [0, 1], 1, 1), keep = toWire(a, [0, 1], 1, 1);
    expect(applyWire(a, wire)).toBe(false);
    expect(toWire(a, [0, 1], 1, 1)).toEqual(keep);
    const bad: unknown[] = [null, 5, 'x', {}, { ...wire, p: [1, 2, 3] }, { ...wire, p: wire.p.map(() => 'a') }, { ...wire, f: 9 }, { ...wire, k: [1, 2] }, { ...wire, a: 'x'.repeat(100) },
      { ...wire, p: Array(31 * 9).fill(0) }, { ...wire, g: null }, { ...wire, g: { ...wire.g, b: [99, 0, 0, 0, 0, 0, 0] } }, { ...wire, g: { ...wire.g, r: ['방장이 지어낸 글', 0, 0, 0, 0] } }, { ...wire, t: Infinity }, { ...wire, c: [NaN, 0, 0, 0] }, { ...wire, p: [40, 0, 0, 0, 0, 0, 0, 0, 0] }];
    for (const x of bad) expect(readWire(x), JSON.stringify(x)?.slice(0, 60)).toBeNull();
    // 지도 밖의 자리는 지도 가장자리로 당겨진다(그리는 쪽이 터무니없는 자리를 그리지 않게)
    const far = { ...keep, p: keep.p.slice() }; far.p[1] = 1e9; far.p[2] = -1e9;
    expect(applyWire(a, readWire(far)!)).toBe(true);
    expect(a.players[0].x).toBeLessThan(a.stage.cols * 30 + 31);
    expect(a.players[0].y).toBeGreaterThan(-121);
  });

  it('판 알림은 글이 아니라 번호로 간다: 방장이 다른 화면에 아무 글이나 띄울 수 없다', () => {
    const host = createWorld(load('math/graph-factory', '05'), people(2), 3), guest = createWorld(host.stage, people(2), 3);
    for (const text of RNOTE_LIST) {
      host.g.round.note = text; host.g.round.noteT = 2;
      const wire = readWire(JSON.parse(JSON.stringify(toWire(host, [0, 1], 1, 1))))!;
      expect(typeof wire.g.r[3], text).toBe('number');
      expect(wire.g.r[3], text).toBeGreaterThan(0);
      applyWire(guest, wire);
      expect(guest.g.round.note).toBe(text);
    }
    expect(RNOTE_LIST).toContain(RNOTE.leak);
    host.g.round.note = '아무 글'; host.g.round.noteT = 2;
    const wire = toWire(host, [0, 1], 1, 2);
    expect(wire.g.r[3]).toBe(0);
    for (const code of [RNOTE_LIST.length + 1, 99]) {
      const forged = readWire({ ...wire, g: { ...wire.g, r: wire.g.r.map((v, i) => (i === 3 ? code : v)) } });
      if (!forged) continue;
      applyWire(guest, forged);
      expect(guest.g.round.note, String(code)).toBe('');
    }
    // 요약에서 글자로 오는 칸은 다리 글자 a 와 식(손님 기기가 다시 읽어 수식으로만 쓴다)뿐이다
    expect(Object.entries(JSON.parse(JSON.stringify(wire))).filter(([, v]) => typeof v === 'string').map(([k]) => k)).toEqual(['a']);
    expect(wire.g.r.every(v => typeof v === 'number')).toBe(true);
  });

  it('터무니없는 값은 받아도 범위 안으로 잘린다: 걷는 그림 번호, 속도, 시간', () => {
    const w = createWorld(load('etc/tutorial', '01'), people(2), 1);
    const wire = toWire(w, [0, 1], 1, 1), bad = { ...wire, t: 1e300, p: wire.p.slice(), c: wire.c.slice() };
    bad.p[3] = 1e300; bad.p[4] = -1e300; bad.p[6] = -0.5; bad.c[2] = -1e300;
    const guest = createWorld(w.stage, people(2), 1);
    expect(applyWire(guest, readWire(JSON.parse(JSON.stringify(bad)))!)).toBe(true);
    const p = guest.players[0];
    expect(p.walk).toBeGreaterThanOrEqual(0); expect(p.walk).toBeLessThan(4);
    expect([0, 1, 2, 1][Math.floor(p.walk) % 4]).toBeDefined();
    expect([p.vx, p.vy, guest.crates[0].vy, guest.t]).toEqual([1000, -1000, -1000, 86_400]);
    // 이 세계를 이어받아 굴려도(방장이 바뀜) 도름이와 상자가 지도 밖으로 영영 날아가지 않는다
    run(guest, () => idle(guest), 60 * 5);
    expect(guest.players[0].y).toBeGreaterThan(-200); expect(guest.crates[0].y).toBeGreaterThan(-2000);
    expect(guest.players[0].on).toBe(true);
  });

  it('요약 사이를 잇는다: 두 요약의 가운데 때에는 자리도 가운데쯤이고, 멀리 건너뛴 것은 잇지 않는다', () => {
    const w = createWorld(load('etc/tutorial', '01'), people(2), 1);
    const a = toWire(w, [0, 1], 1, 1);
    const b: Wire = { ...a, n: 2, p: a.p.slice() };
    b.p[1] = a.p[1] + 10;                 // 0번은 10px 걸었다
    b.p[9 + 1] = a.p[9 + 1] + 300;        // 1번은 되살아나 멀리 옮겨졌다
    const track = newTrack(); track.gap = 50;
    expect(pushWire(track, a, 1, 1000)).toBe(true);
    expect(pushWire(track, b, 1, 1050)).toBe(true);
    expect(pushWire(track, a, 1, 1060), '차례가 뒤로 간 요약은 버린다').toBe(false);
    expect(pushWire(track, { ...b, n: 3, r: 2 }, 1, 1060), '지난 판의 요약은 버린다').toBe(false);
    const guest = createWorld(w.stage, people(2), 1);
    blend(guest, track, 1075, 1 / 60);    // 그리는 때 = 1075 - 간격(50) = 1025: 두 요약의 한가운데
    expect(guest.players[0].x).toBeCloseTo(a.p[1] + 5, 0);
    expect(guest.players[1].x).toBeCloseTo(b.p[9 + 1], 5);
    blend(guest, track, 1200, 1 / 60);    // 다음 요약이 늦어도 마지막 자리에서 멈춘다
    expect(guest.players[0].x).toBeCloseTo(b.p[1], 5);
  });

  it('30명이 뛰어다니는 요약도 상한(32KB)에 한참 못 미친다', () => {
    const w = busy('math/graph-factory', '05', 30, 2, 60 * 5);
    const text = JSON.stringify({ t: 's', d: toWire(w, w.players.map((_, i) => i), 1, 1) });
    expect(text.length).toBeLessThan(LIMITS.snap / 8);
    expect(SNAP_EVERY).toBe(3);
  });
});

// ---------- 방의 규칙 ----------
type Sock = { name: string; got: string[]; closed: [number, string] | null; saved: Saved | null };
const sock = (name: string): Sock => ({ name, got: [], closed: null, saved: null });
const J = (o: Partial<JoinQuery> = {}): JoinQuery => ({ mode: 'join', view: 'auto', id: '', pub: false, big: false, ...o });
const CODE = 'ABCDEF';
function room() {
  const lobby: ([string, unknown])[] = [];
  const core = new RoomCore<Sock>({
    send: (s, t) => { if (!s.closed) s.got.push(t); },
    close: (s, code, reason) => { s.closed ??= [code, reason]; },
    save: (s, saved) => { s.saved = saved; },
    lobby: (code, r) => lobby.push([code, r]),
  });
  const enter = (name: string, q: Partial<JoinQuery> = {}, now = 0) => { const s = sock(name); core.join(s, CODE, J(q), now); return s; };
  const say = (s: Sock, msg: unknown, now = 0) => core.message(s.saved!.seat, s.saved!.key, typeof msg === 'string' ? msg : JSON.stringify(msg), now);
  const bye = (s: Sock) => core.leave(s.saved!.seat, s.saved!.key);
  const last = (s: Sock, t: string) => s.got.map(x => { try { return JSON.parse(x); } catch { return {}; } }).filter(m => m.t === t).pop();
  return { core, lobby, enter, say, bye, last };
}
const INFO: RoomInfo = { pack: 'math/graph-factory', stage: 1, seed: 77, run: 3, pub: true, big: false, order: [0, 1] };

describe('방의 규칙(room-rules)', () => {
  it('없는 방에는 못 들어가고, 이미 있는 코드로는 방을 만들지 못한다', () => {
    const r = room();
    const lost = r.enter('길 잃은 손님');
    expect(lost.closed).toEqual([CLOSE.none, 'none']);
    expect(JSON.parse(lost.got[0])).toEqual({ t: 'no', c: CLOSE.none });
    const host = r.enter('방장', { mode: 'create' });
    expect(host.closed).toBeNull();
    expect(r.enter('같은 코드', { mode: 'create' }).closed).toEqual([CLOSE.taken, 'taken']);
    const bad = sock('이상한 코드'); r.core.join(bad, 'abc', J({ mode: 'create' }), 0);
    expect(bad.closed?.[0]).toBe(CLOSE.bad);
  });

  it('자리는 빈 번호 가운데 가장 작은 수, 방장은 가장 먼저 들어온 연결이다', () => {
    const r = room();
    const a = r.enter('가', { mode: 'create', pub: true }), b = r.enter('나'), c = r.enter('다');
    expect([a, b, c].map(s => s.saved!.seat)).toEqual([0, 1, 2]);
    expect(r.last(c, 'hi')).toMatchObject({ me: 2, host: 0, seats: [[0, 0], [1, 0], [2, 0]], room: { pub: true, stage: -1 } });
    expect(r.last(a, 'who')).toMatchObject({ host: 0, seats: [[0, 0], [1, 0], [2, 0]] });
    r.bye(b);
    const d = r.enter('라');
    expect(d.saved!.seat).toBe(1);
    expect(r.core.hostSeat).toBe(0);
  });

  it('31번째 연결은 가득 찼다고 거절한다', () => {
    const r = room();
    r.enter('방장', { mode: 'create' });
    for (let i = 1; i < MAX_SEATS; i++) expect(r.enter(`손님 ${i}`).closed).toBeNull();
    expect(r.core.size).toBe(30);
    const over = r.enter('서른한 번째');
    expect(over.closed).toEqual([CLOSE.full, 'full']);
    expect(r.core.size).toBe(30);
  });

  it('방장이 나가면 그다음으로 오래된 연결이 방장이 되고 모두에게 알린다', () => {
    const r = room();
    const a = r.enter('가', { mode: 'create' }), b = r.enter('나'), c = r.enter('다');
    r.say(a, { t: 'room', room: INFO });
    r.bye(a);
    expect(r.core.hostSeat).toBe(1);
    expect(r.last(b, 'who')).toMatchObject({ host: 1, seats: [[1, 0], [2, 0]] });
    expect(r.last(c, 'who')).toMatchObject({ host: 1 });
    expect(b.saved).toMatchObject({ host: true, info: INFO });      // 방 정보는 새 방장의 연결에 붙어 다닌다
    // 새 방장만 방 정보를 바꿀 수 있다
    r.say(c, { t: 'room', room: { ...INFO, stage: 4 } });
    expect(r.core.info.stage).toBe(1);
    r.say(b, { t: 'room', room: { ...INFO, stage: 4, run: 4 } });
    expect(r.core.info.stage).toBe(4);
    expect(r.last(c, 'room').room.stage).toBe(4);
    r.bye(b); r.bye(c);
    expect(r.core.size).toBe(0);
    expect(r.lobby[r.lobby.length - 1]).toEqual([CODE, null]);      // 공개였던 방(INFO.pub)이 비면 목록에서 내린다
  });

  it('조작기만 쓰는 연결보다 게임 화면을 보는 연결이 먼저 방장이 된다. 조작기뿐이면 가장 오래된 조작기가 게임 화면으로 바뀌어 맡는다', () => {
    const r = room();
    const big = r.enter('큰 화면', { mode: 'create', big: true }), p1 = r.enter('조작기 1'), p2 = r.enter('조작기 2'), own = r.enter('각자 화면', { view: 'play' });
    expect([p1, p2, own].map(s => s.saved!.view)).toEqual(['pad', 'pad', 'play']);      // 함께 보기 방에 그냥 들어오면 조작기
    r.bye(big);
    expect(r.core.hostSeat).toBe(own.saved!.seat);
    r.bye(own);
    expect(r.core.hostSeat).toBe(p1.saved!.seat);
    expect(r.core.seats()).toEqual([[1, 0], [2, 1]]);
  });

  it('손님의 조작은 방장에게만, 검사한 값으로 다시 써서 전한다', () => {
    const r = room();
    const a = r.enter('방장', { mode: 'create' }), b = r.enter('나'), c = r.enter('다');
    const n = [a, b, c].map(s => s.got.length);
    r.say(b, { t: 'p', m: 1, j: 1, a: 0, n: 12, extra: '<img src=x onerror=alert(1)>', s: 0 });
    expect(a.got.slice(n[0])).toEqual(['{"t":"p","s":1,"m":1,"j":1,"a":0,"n":12}']);
    expect(c.got.length).toBe(n[2]);
    for (const bad of [{ t: 'p', m: 2, j: 0, a: 0, n: 0 }, { t: 'p', m: 1, j: true, a: 0, n: 0 }, { t: 'p', m: 0, j: 0, a: 0, n: -1 }, { t: 'p' }, { t: 'p', m: '1', j: 0, a: 0, n: 0 }]) r.say(b, bad);
    r.say(a, { t: 'p', m: 1, j: 0, a: 0, n: 1 });                   // 방장의 조작은 서버를 거치지 않는다
    expect(a.got.length).toBe(n[0] + 1);
    expect(cleanPad({ m: -1, j: 0, a: 1, n: 3, z: 1 })).toEqual({ m: -1, j: 0, a: 1, n: 3 });
  });

  it('세계 요약은 방장만 보내고, 게임 화면을 보는 손님만 받는다', () => {
    const r = room();
    const a = r.enter('방장', { mode: 'create' }), b = r.enter('게임 화면'), c = r.enter('조작기', { view: 'pad' });
    const snap = JSON.stringify({ t: 's', d: { n: 1 } });
    r.say(a, snap);
    expect(b.got[b.got.length - 1]).toBe(snap);
    expect(c.got.some(x => x === snap)).toBe(false);
    const before = [a.got.length, c.got.length];
    r.say(b, snap);                                                 // 손님이 보낸 요약은 버린다
    expect([a.got.length, c.got.length]).toEqual(before);
    r.say(c, { t: 'view', v: 'play' }, 2000);                       // 조작기에서 게임 화면으로 바꾸면 그때부터 받는다
    expect(r.last(a, 'who').seats).toEqual([[0, 0], [1, 0], [2, 0]]);
    r.say(a, snap);
    expect(c.got[c.got.length - 1]).toBe(snap);
  });

  it('방 정보는 모양을 검사한다: 팩 id, 스테이지 번호, 씨앗, 차례', () => {
    expect(cleanRoomInfo(INFO)).toEqual(INFO);
    expect(cleanRoomInfo({ ...INFO, pack: '' })).not.toBeNull();
    const bad: unknown[] = [null, 'x', { ...INFO, pack: '../etc/passwd' }, { ...INFO, pack: 'Math/Scale' }, { ...INFO, pack: 'a/b/c' }, { ...INFO, pack: '<b>/x' }, { ...INFO, pack: `${'a'.repeat(40)}/${'b'.repeat(40)}` },
      { ...INFO, stage: 1.5 }, { ...INFO, stage: -2 }, { ...INFO, stage: 100 }, { ...INFO, seed: 0 }, { ...INFO, seed: 2 ** 40 }, { ...INFO, run: -1 }, { ...INFO, pub: 1 }, { ...INFO, big: 'yes' },
      { ...INFO, order: [0, 0] }, { ...INFO, order: [30] }, { ...INFO, order: [-1] }, { ...INFO, order: 'x' }, { ...INFO, order: Array.from({ length: 31 }, (_, i) => i) }, { ...INFO, order: [1.5] }];
    for (const x of bad) expect(cleanRoomInfo(x), JSON.stringify(x)?.slice(0, 80)).toBeNull();
    const r = room();
    const a = r.enter('방장', { mode: 'create' }), b = r.enter('손님');
    const n = b.got.length;
    r.say(a, { t: 'room', room: { ...INFO, pack: '<script>' } });
    expect(b.got.length).toBe(n);
    expect(r.core.info.pack).toBe('');
    r.say(a, { t: 'room', room: { ...INFO, extra: 'x'.repeat(50) } });
    expect(JSON.parse(b.got[n])).toEqual({ t: 'room', room: INFO });   // 모르는 칸은 떼고 전한다
  });

  it('크기 상한: 손님 256바이트, 방장 32KB. 넘으면 끊는다', () => {
    const r = room();
    const a = r.enter('방장', { mode: 'create' }), b = r.enter('손님'), c = r.enter('한글 손님');
    r.say(b, JSON.stringify({ t: 'p', m: 0, j: 0, a: 0, n: 0, pad: 'x'.repeat(260) }));
    expect(b.closed).toEqual([CLOSE.tooBig, 'big']);
    expect(r.core.size).toBe(2);
    r.say(c, JSON.stringify({ t: 'p', m: 0, j: 0, a: 0, n: 0, pad: '가'.repeat(90) }));   // 글자 수는 적어도 바이트는 270
    expect(c.closed).toEqual([CLOSE.tooBig, 'big']);
    r.say(a, JSON.stringify({ t: 's', d: 'x'.repeat(31_000) }));
    expect(a.closed).toBeNull();
    r.say(a, JSON.stringify({ t: 's', d: 'x'.repeat(33_000) }));
    expect(a.closed).toEqual([CLOSE.tooBig, 'big']);
    expect(r.core.size).toBe(0);
  });

  it('빈도 상한: 초당 40통쯤. 오래 넘기면 끊고, 그 안이면 끊지 않는다', () => {
    const r = room();
    const a = r.enter('방장', { mode: 'create' }), b = r.enter('얌전한 손님'), c = r.enter('마구 보내는 손님');
    const pad = { t: 'p', m: 1, j: 0, a: 0, n: 0 };
    for (let ms = 0; ms < 10_000; ms += 25) { r.say(b, pad, ms); r.say(a, { t: 's', d: {} }, ms); }      // 초당 40통을 10초 동안
    expect([a.closed, b.closed]).toEqual([null, null]);
    let sent = 0;
    for (let ms = 0; ms < 3000 && !c.closed; ms += 5) { r.say(c, pad, ms); sent++; }                      // 초당 200통
    expect(c.closed).toEqual([CLOSE.tooFast, 'fast']);
    expect(sent).toBeLessThan(140);
    expect(r.core.size).toBe(2);
  });

  it('모르는 글과 망가진 글은 무시한다(끊지도 전하지도 않는다)', () => {
    const r = room();
    const a = r.enter('방장', { mode: 'create' }), b = r.enter('손님');
    const n = [a.got.length, b.got.length];
    for (const x of ['', 'garbage', '{', '[]', 'null', '42', '"s"', '{"t":"nope"}', '{"t":"hi","me":0}', '{"t":"who","host":1}', '{"t":"view","v":"big"}', '{"t":"yield"}', '{"t":"hb"}', '{"t":"room"}']) r.say(b, x);
    for (const x of ['{"t":"view","v":"pad"}', '{"t":"room","room":5}', '{"t":"x"}']) r.say(a, x);
    expect([a.got.length, b.got.length]).toEqual(n);
    expect([a.closed, b.closed, r.core.hostSeat]).toEqual([null, null, 0]);
  });

  it('방장이 화면을 내려 두면 게임 화면을 보는 다음 사람에게 방장을 넘긴다', () => {
    const r = room();
    const a = r.enter('방장', { mode: 'create' }), p = r.enter('조작기', { view: 'pad' }), b = r.enter('게임 화면');
    r.say(a, { t: 'room', room: INFO });
    r.say(a, { t: 'yield' });
    expect(r.core.hostSeat).toBe(b.saved!.seat);
    expect(r.last(p, 'who').host).toBe(2);
    expect(a.saved!.host).toBe(false);
    expect(b.saved).toMatchObject({ host: true, info: INFO });
    r.say(b, { t: 'yield' });                                       // 다시 넘기면 처음 방장에게(조작기는 건너뛴다)
    expect(r.core.hostSeat).toBe(0);
  });

  it('같은 창이 다시 붙으면 앉아 있던 자리와 방장을 그대로 잇고, 옛 연결이 늦게 끊겨도 자리를 잃지 않는다', () => {
    const r = room();
    const a1 = r.enter('방장', { mode: 'create', id: 'a'.repeat(16) }), b = r.enter('손님', { id: 'b'.repeat(16) });
    const old = a1.saved!;
    const a2 = r.enter('방장 다시', { id: 'a'.repeat(16) });
    expect(a1.closed).toEqual([CLOSE.replaced, 'replaced']);
    expect(a2.saved).toMatchObject({ seat: 0, host: true });
    r.core.leave(old.seat, old.key);                                // 옛 연결의 끊김이 뒤늦게 도착
    expect(r.core.size).toBe(2);
    expect(r.core.hostSeat).toBe(0);
    r.core.message(old.seat, old.key, JSON.stringify({ t: 's', d: {} }), 0);   // 옛 연결로 온 글은 버린다
    expect(b.got.some(x => x.startsWith('{"t":"s"'))).toBe(false);
  });

  it('잠들었다 깬 방은 연결에 붙여 둔 값으로 되살아난다', () => {
    const r = room();
    const a = r.enter('방장', { mode: 'create', pub: true }), b = r.enter('손님', { view: 'pad' });
    r.say(a, { t: 'room', room: INFO });
    const woke = room();
    for (const s of [b, a]) woke.core.restore(s, s.saved!);
    expect([woke.core.code, woke.core.size, woke.core.hostSeat, woke.core.info]).toEqual([CODE, 2, 0, INFO]);
    expect(woke.core.seats()).toEqual([[0, 0], [1, 1]]);
    const c = sock('새 손님'); woke.core.join(c, CODE, J(), 0);
    expect(c.saved).toMatchObject({ seat: 2, host: false });
    expect(c.saved!.key).toBeGreaterThan(Math.max(a.saved!.key, b.saved!.key));
  });

  it('공개 방만 목록에 알리고, 비공개로 바꾸면 내린다', () => {
    const r = room();
    const a = r.enter('방장', { mode: 'create', pub: true }, 0);
    expect(r.lobby.pop()).toEqual([CODE, { code: CODE, pack: '', stage: -1, count: 1 }]);
    r.enter('손님', {}, 2000);
    expect(r.lobby.pop()?.[1]).toMatchObject({ count: 2 });
    r.say(a, { t: 'room', room: INFO }, 4000);
    expect(r.lobby.pop()).toEqual([CODE, { code: CODE, pack: INFO.pack, stage: 1, count: 2 }]);
    r.say(a, { t: 'hb' }, 5000);
    expect(r.lobby.length, '달라진 것이 없으면 10초 안에는 다시 알리지 않는다').toBe(0);
    expect(a.got[a.got.length - 1]).toBe('{"t":"hb"}');
    r.say(a, { t: 'hb' }, 15_000);
    expect(r.lobby.pop()?.[1]).toMatchObject({ count: 2 });
    r.say(a, { t: 'room', room: { ...INFO, pub: false } }, 16_000);
    expect(r.lobby.pop()).toEqual([CODE, null]);
    r.say(a, { t: 'hb' }, 30_000);
    expect(r.lobby.length, '비공개 방은 내린 뒤로 목록을 두드리지 않는다').toBe(0);
  });

  it('공개와 비공개를 마구 번갈아 바꿔도 목록을 두드리는 것은 1초에 한 번까지고, 마지막 상태는 다음 살아 있음 알림 때 맞춰진다', () => {
    const r = room();
    const a = r.enter('방장', { mode: 'create', pub: true }, 0);
    r.lobby.length = 0;
    let n = 0;
    for (let ms = 1000; ms < 6000; ms += 25) r.say(a, { t: 'room', room: { ...INFO, pub: n++ % 2 === 0, run: n } }, ms);   // 초당 40번, 5초
    expect(a.closed).toBeNull();
    expect(r.lobby.length).toBeLessThanOrEqual(6);
    // 마지막으로 보낸 것은 비공개(pub: false)다. 밀려 있었더라도 다음 알림 때 목록에서 내려간다
    expect(r.core.info.pub).toBe(false);
    r.say(a, { t: 'hb' }, 7100);
    expect(r.lobby[r.lobby.length - 1]).toEqual([CODE, null]);
    const calls = r.lobby.length;
    r.say(a, { t: 'hb' }, 12_000); r.say(a, { t: 'hb' }, 30_000);
    expect(r.lobby.length).toBe(calls);
  });

  it('목록이 이 방을 어떻게 알고 있는지 모를 때는(방이 막 생겼거나 잠들었다 깼을 때) 비공개 방이 한 번은 내리라고 알린다', () => {
    // 새로 만든 비공개 방: 같은 코드의 옛 공개 방이 목록에 남아 있을 수 있으므로 한 번 내린다
    const fresh = room();
    const h = fresh.enter('비공개 방장', { mode: 'create' }, 0);
    expect(fresh.lobby).toEqual([[CODE, null]]);
    for (let ms = 1000; ms < 4000; ms += 25) fresh.say(h, { t: 'hb' }, ms);
    expect(fresh.lobby.length, '그 뒤로는 두드리지 않는다').toBe(1);
    // 공개였다가 비공개로 바뀐 방이 잠들었다 깼다: 목록에는 아직 공개로 남아 있을 수 있다
    const r = room();
    const a = r.enter('방장', { mode: 'create', pub: true }, 0);
    r.say(a, { t: 'room', room: { ...INFO, pub: false } }, 5000);
    const woke = room();
    woke.core.restore(a, a.saved!);
    expect(woke.core.info.pub).toBe(false);
    woke.core.message(a.saved!.seat, a.saved!.key, '{"t":"hb"}', 60_000);
    expect(woke.lobby).toEqual([[CODE, null]]);
    // 공개 방이 잠들었다 깨면 다음 알림 때 다시 올린다
    const pubRoom = room(), b = pubRoom.enter('공개 방장', { mode: 'create', pub: true }, 0), again = room();
    again.core.restore(b, b.saved!);
    again.core.message(b.saved!.seat, b.saved!.key, '{"t":"hb"}', 60_000);
    expect(again.lobby).toEqual([[CODE, { code: CODE, pack: '', stage: -1, count: 1 }]]);
  });

  it('한 방이 공개 방 목록을 두드리는 것은 1초에 한 번까지다(방장이 마구 보내도)', () => {
    const r = room();
    const a = r.enter('방장', { mode: 'create', pub: true }, 0);
    r.lobby.length = 0;
    for (let ms = 1000; ms < 6000; ms += 25) r.say(a, ms % 50 ? { t: 'hb' } : { t: 'room', room: { ...INFO, stage: (ms / 50) % 5, run: ms } }, ms);   // 초당 40통을 5초 동안
    expect(a.closed).toBeNull();
    expect(r.lobby.length).toBeLessThanOrEqual(6);
    expect(r.lobby.length).toBeGreaterThanOrEqual(4);
    const quiet = room(), b = quiet.enter('비공개 방장', { mode: 'create' }, 0);
    for (let ms = 1000; ms < 4000; ms += 25) quiet.say(b, { t: 'hb' }, ms);
    expect(quiet.lobby, '비공개 방은 처음 한 번 내리라고만 알린다').toEqual([[CODE, null]]);
  });

  it('게임 화면과 조작기를 바꾸는 것은 1초에 한 번까지만 모두에게 알린다', () => {
    const r = room();
    const a = r.enter('방장', { mode: 'create' }), b = r.enter('손님');
    const n = a.got.length;
    for (let ms = 5000; ms < 6000; ms += 25) r.say(b, { t: 'view', v: ms % 50 ? 'pad' : 'play' }, ms);
    expect(a.got.length - n).toBe(1);
    r.say(b, { t: 'view', v: b.saved!.view === 'pad' ? 'play' : 'pad' }, 7000);
    expect(a.got.length - n).toBe(2);
  });

  it('한참 소식이 없는 연결은 자리를 비운다(죽은 연결이 자리와 도름이를 붙잡고 있지 않게)', () => {
    const pings = new Map<Sock, number>();
    const lobby: unknown[] = [];
    const core = new RoomCore<Sock>({ send: (s, t) => { s.got.push(t); }, close: (s, c, why) => { s.closed ??= [c, why]; }, save: (s, v) => { s.saved = v; }, lobby: (...x) => lobby.push(x), pinged: s => pings.get(s) ?? 0 });
    const T = 1_000_000;
    const a = sock('방장'), b = sock('두드리기만 하는 손님'), c = sock('죽은 연결');
    core.join(a, CODE, J({ mode: 'create' }), T); core.join(b, CODE, J(), T); core.join(c, CODE, J(), T);
    for (let ms = 5000; ms <= IDLE_MS + 10_000; ms += 5000) { pings.set(b, T + ms); core.message(a.saved!.seat, a.saved!.key, '{"t":"hb"}', T + ms); }
    expect([a.closed, b.closed]).toEqual([null, null]);          // 방장은 글로, 손님은 연결 두드리기로 살아 있음을 알렸다
    expect(c.closed).toEqual([CLOSE.bad, 'idle']);
    expect(core.seats()).toEqual([[0, 0], [1, 0]]);
    // 새로 들어오는 사람이 있을 때도 죽은 연결부터 치운다: 가득 찬 방에 자리가 난다
    pings.set(a, T + IDLE_MS * 3 - 1000);                        // 방장은 그 뒤로도 연결을 두드리고 있었다
    const d = sock('새 손님'); core.join(d, CODE, J(), T + IDLE_MS * 3);
    expect(b.closed).toEqual([CLOSE.bad, 'idle']);
    expect(d.saved).toMatchObject({ seat: 1 });
  });

  it('소식이 끊긴 방장은 자리는 두고 방장만 살아 있는 다음 사람에게 넘긴다(아무 글이 오지 않아도 알람이 치운다)', () => {
    const pings = new Map<Sock, number>();
    const core = new RoomCore<Sock>({ send: (s, t) => { s.got.push(t); }, close: (s, c, why) => { s.closed ??= [c, why]; }, save: (s, v) => { s.saved = v; }, pinged: s => pings.get(s) ?? 0 });
    const T = 1_000_000;
    const a = sock('잠든 방장'), b = sock('손님'), c = sock('조작기만 쓰는 손님');
    core.join(a, CODE, J({ mode: 'create' }), T); core.join(b, CODE, J(), T); core.join(c, CODE, J({ view: 'pad' }), T);
    pings.set(b, T + HOST_QUIET_MS); pings.set(c, T + HOST_QUIET_MS);
    expect(core.tick(T + HOST_QUIET_MS)).toBe(true);
    expect(core.hostSeat).toBe(0);                                   // 아직 기다린다
    expect(core.tick(T + HOST_QUIET_MS + 1000)).toBe(true);
    expect(core.hostSeat).toBe(1);                                   // 게임 화면을 보는 손님이 이어받는다
    expect(a.closed).toBeNull();                                     // 자리는 IDLE_MS 까지 둔다
    expect(JSON.parse(c.got[c.got.length - 1])).toMatchObject({ t: 'who', host: 1 });
  });

  it('소식이 끊긴 방장이 혼자면 그대로 두고, 손님 글이 올 때도 가끔 치운다', () => {
    const pings = new Map<Sock, number>();
    const core = new RoomCore<Sock>({ send: (s, t) => { s.got.push(t); }, close: (s, c, why) => { s.closed ??= [c, why]; }, save: (s, v) => { s.saved = v; }, pinged: s => pings.get(s) ?? 0 });
    const T = 2_000_000;
    const a = sock('방장'); core.join(a, CODE, J({ mode: 'create' }), T);
    core.tick(T + HOST_QUIET_MS * 2);
    expect(core.hostSeat).toBe(0);                                   // 넘길 사람이 없다
    const b = sock('손님'); core.join(b, CODE, J(), T + HOST_QUIET_MS * 2);
    core.message(b.saved!.seat, b.saved!.key, JSON.stringify({ t: 'p', m: 1, j: 0, a: 0, n: 0 }), T + HOST_QUIET_MS * 2 + 6000);
    expect(core.hostSeat).toBe(1);
    expect(core.tick(T + HOST_QUIET_MS * 2 + IDLE_MS)).toBe(true);
    expect(a.closed).toEqual([CLOSE.bad, 'idle']);                   // 1분이 넘으면 자리도 비운다
  });

  it('들어올 수 있는지만 먼저 물어볼 수 있다(방 서버는 못 들어올 연결을 방에 붙이지 않는다)', () => {
    const r = room();
    expect(r.core.check(CODE, J(), 0)).toEqual([CLOSE.none, 'none']);
    expect(r.core.check('abc', J({ mode: 'create' }), 0)).toEqual([CLOSE.bad, 'code']);
    expect(r.core.check(CODE, J({ mode: 'create' }), 0)).toBeNull();
    r.enter('방장', { mode: 'create' });
    expect(r.core.check(CODE, J({ mode: 'create' }), 0)).toEqual([CLOSE.taken, 'taken']);
    expect(r.core.check(CODE, J(), 0)).toBeNull();
    expect(r.core.size).toBe(1);
  });

  it('공개 방 목록은 30초 넘게 소식 없는 방을 뺀다', () => {
    const list = new PublicList();
    list.report('ABCDEF', { code: 'ABCDEF', pack: 'math/graph-factory', stage: 0, count: 3 }, 0);
    list.report('GHJKMN', { code: 'GHJKMN', pack: '', stage: -1, count: 9 }, 20_000);
    list.report('nope', { code: 'nope', pack: '', stage: 0, count: 1 }, 20_000);
    expect(list.list(25_000).map(r => r.code)).toEqual(['GHJKMN', 'ABCDEF']);
    expect(list.list(31_000)).toEqual([{ code: 'GHJKMN', pack: '', stage: -1, count: 9 }]);
    list.report('GHJKMN', null, 32_000);
    expect(list.list(32_000)).toEqual([]);
  });

  it('쓸 수 있는 곳: 운영 두 주소와 이 컴퓨터뿐이다', () => {
    for (const ok of ['https://dorms-world.vercel.app', 'https://dorms.school', 'http://localhost:5320', 'http://127.0.0.1:5173', 'http://localhost']) expect(originAllowed(ok), ok).toBe(true);
    for (const no of [null, undefined, '', 'null', 'https://evil.example', 'https://dorms.school.evil.example', 'http://dorms.school', 'https://localhost:5320', 'http://localhost.evil.example', 'http://localhost:5320/x', 'https://dorms-world.vercel.app.evil.example', 'http://192.168.0.5:5320']) expect(originAllowed(no), String(no)).toBe(false);
    expect(originAllowed('http://192.168.0.5:5320', ['http://192.168.0.5:5320'])).toBe(true);
  });

  it('주소 뒤에 붙은 값은 모양이 맞는 것만 읽는다', () => {
    const q = (s: string) => readJoinQuery(new URLSearchParams(s));
    expect(q('mode=create&view=pad&id=0123456789abcdef&pub=1&big=1')).toEqual({ mode: 'create', view: 'pad', id: '0123456789abcdef', pub: true, big: true });
    expect(q('mode=destroy&view=god&id=<script>&pub=yes')).toEqual({ mode: 'join', view: 'auto', id: '', pub: false, big: false });
  });
});

// ---------- 연결과 방을 이어 붙인 흐름 ----------
/** 방의 규칙에 바로 이어진 가짜 연결. 브라우저의 WebSocket 처럼 굴지만 통신은 하지 않는다. */
function wired() {
  const rooms = new Map<string, RoomCore<Fake>>();
  let drop = false;
  class Fake {
    readyState = 0;
    onmessage: ((e: { data: string }) => void) | null = null;
    onclose: ((e: { code: number }) => void) | null = null;
    onerror: (() => void) | null = null;
    saved: Saved | null = null;
    core: RoomCore<Fake> | null = null;
    constructor(url: string) {
      const u = new URL(url), code = u.pathname.split('/').pop()!;
      queueMicrotask(() => {
        if (drop) return this.end(1006);
        let core = rooms.get(code);
        if (!core) rooms.set(code, core = new RoomCore<Fake>({
          send: (s, t) => queueMicrotask(() => { if (s.readyState === 1) s.onmessage?.({ data: t }); }),
          close: (s, c) => queueMicrotask(() => s.end(c)),
          save: (s, saved) => { s.saved = saved; },
        }));
        this.core = core; this.readyState = 1;
        core.join(this, code, readJoinQuery(u.searchParams));
      });
    }
    send(text: string) { if (this.readyState === 1 && this.saved && text !== 'ping') this.core!.message(this.saved.seat, this.saved.key, text, Date.now()); }
    close() { this.end(1000); }
    end(code: number) {
      if (this.readyState === 3) return;
      this.readyState = 3;
      if (this.saved) this.core?.leave(this.saved.seat, this.saved.key);
      queueMicrotask(() => this.onclose?.({ code }));
    }
  }
  return { Fake: Fake as unknown as typeof WebSocket, rooms, cut: (v: boolean) => { drop = v; } };
}
const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));

describe('연결(net)', () => {
  it('방을 만들고, 코드로 들어오고, 조작과 요약과 방 정보가 제 길로 간다', async () => {
    const net = wired();
    const pads: [number, Pad][] = [], snaps: Wire[] = [], rooms: RoomInfo[] = [];
    const host = joinRoom('http://room.test', CODE, { create: true, pub: true, socket: net.Fake }, { pad: (s, p) => pads.push([s, p]) });
    await tick();
    expect([host.open, host.isHost, host.me, host.room.pub]).toEqual([true, true, 0, true]);
    const guest = joinRoom('http://room.test/', CODE, { socket: net.Fake }, { snap: w => snaps.push(w), room: l => rooms.push(l.room) });
    await tick();
    expect([guest.me, guest.host, guest.isHost, host.count]).toEqual([1, 0, false, 2]);

    host.setRoom({ ...INFO, order: [0, 1] });
    guest.sendPad({ m: -1, j: true, a: false, jn: 4 });
    const world = createWorld(load('etc/tutorial', '01'), people(2), 1);
    host.sendSnap(toWire(world, [0, 1], 3, 1));
    guest.sendSnap(toWire(world, [0, 1], 3, 2));                    // 손님은 요약을 보낼 수 없다
    await tick();
    expect(rooms).toEqual([{ ...INFO, order: [0, 1] }]);
    expect(pads).toEqual([[1, { m: -1, j: true, a: false, jn: 4 }]]);
    expect(snaps.map(s => s.n)).toEqual([1]);

    const why: Down[] = [];
    const third = joinRoom('http://room.test', 'GHJKMN', { socket: net.Fake }, { down: w => why.push(w) });
    await tick();
    expect(why).toEqual(['none']);                                  // 그런 방이 없어요
    expect(third.open).toBe(false);
    host.leave(); await tick();
    expect([guest.isHost, guest.count]).toEqual([true, 1]);         // 방장이 나가면 손님이 방장
    guest.leave();
    expect(() => joinRoom('http://room.test', 'abc', {}, {})).toThrow();
  });

  it('연결이 끊기면 다시 붙고, 혼자 있던 방장은 같은 코드로 방을 다시 세워 고르던 스테이지를 되살린다', async () => {
    const net = wired();
    const log: string[] = [];
    let link: RoomLink | null = null;
    const host = joinRoom('http://room.test', CODE, { create: true, socket: net.Fake, id: 'c'.repeat(16) }, { retry: n => log.push(`retry ${n}`), down: w => log.push(`down ${w}`), hello: l => { link = l; } });
    await tick();
    host.setRoom(INFO);
    (net.rooms.get(CODE) as unknown as { conns: Map<number, { sock: { end(c: number): void } }> }).conns.get(0)!.sock.end(1006);   // 와이파이가 끊겼다
    await tick(600);
    expect(log).toEqual(['retry 1', 'retry 0']);
    expect([host.open, host.isHost, link === host]).toEqual([true, true, true]);
    expect(net.rooms.get(CODE)!.info).toEqual(INFO);
    host.leave();
    expect(log[log.length - 1]).toBe('down left');
  });

  it('다시 붙기를 기다리는 중에 와이파이가 돌아오면(nudge) 기다리지 않고 바로 붙는다', async () => {
    const net = wired();
    const log: string[] = [];
    const host = joinRoom('http://room.test', CODE, { create: true, socket: net.Fake, id: 'd'.repeat(16) }, { retry: n => log.push(`retry ${n}`) });
    await tick();
    (net.rooms.get(CODE) as unknown as { conns: Map<number, { sock: { end(c: number): void } }> }).conns.get(0)!.sock.end(1006);
    await tick();
    expect([host.open, log]).toEqual([false, ['retry 1']]);
    host.nudge();
    await tick(20);                                                  // 400ms 를 기다리지 않았다
    expect([host.open, log]).toEqual([true, ['retry 1', 'retry 0']]);
    host.nudge();                                                    // 붙어 있을 때는 아무 일도 없다
    host.leave();
  });

  it('끝내 못 붙으면 까닭을 알려 준다', async () => {
    const net = wired(); net.cut(true);
    const log: string[] = [];
    joinRoom('http://room.test', CODE, { create: true, socket: net.Fake, retries: 1 }, { retry: n => log.push(`retry ${n}`), down: w => log.push(`down ${w}`) });
    await tick(700);
    expect(log).toEqual(['retry 1', 'down lost']);
  });

  it('공개 방 목록은 모양이 맞는 것만 받고, 받아 오지 못하면 빈 목록이다', async () => {
    const ok = (async () => ({ ok: true, json: async () => [{ code: 'ABCDEF', pack: 'math/graph-factory', stage: 2, count: 3 }, { code: 'bad', pack: 'x/y', stage: 0, count: 1 }, { code: 'GHJKMN', pack: '<b>', stage: 'x', count: 99 }, null, 'x'] })) as unknown as typeof fetch;
    expect(await listPublic('http://room.test', ok)).toEqual([{ code: 'ABCDEF', pack: 'math/graph-factory', stage: 2, count: 3 }, { code: 'GHJKMN', pack: '', stage: -1, count: 30 }]);
    expect(await listPublic('http://room.test', (async () => { throw new Error('끊김'); }) as unknown as typeof fetch)).toEqual([]);
    expect(await listPublic('http://room.test', (async () => ({ ok: false })) as unknown as typeof fetch)).toEqual([]);
  });
});
