/**
 * 세계 요약. 방장만 물리를 돌리고, 손님은 방장이 초당 스무 번 보내는 요약을 받아 같은 그림을 그린다.
 * 요약은 화면에 보이는 것 전부와, 방장이 바뀌었을 때 새 방장이 그대로 이어 갈 수 있는 값(속도·그래프 장치의 시간들)을 담는다.
 * 여기는 순수한 계산뿐이다(화면도 연결도 모른다). 받은 요약은 남이 보낸 글이므로 모양을 검사하고 나서 쓴다.
 */
import { applyGraphWire, graphToWire, readGWire, type GWire } from './graph/wire';
import { colorFor } from './identity';
import { MAX_SEATS } from './room-rules';
import { NO_PAD, setPlayerCount, setSmall, type Pad, type World } from './sim';
import { T } from './stage';
import { VARS, num as clampNum } from './things';

/** 방장이 요약을 보내는 간격(물리 걸음 수). 60 / 3 = 초당 20번. */
export const SNAP_EVERY = 3;
const H = 4 + VARS;   // 새 물건 하나가 차지하는 칸 수
const P = 9, C = 4;   // 도름이·상자 하나가 차지하는 칸 수

export type Wire = {
  r: number;                              // 판 번호(방 정보의 run). 지난 판의 요약은 버린다
  n: number;                              // 보낸 차례
  t: number;                              // 지난 시간(초)
  f: number;                              // 1 문이 열림, 2 모두 들어가 끝남
  k: [number, number, number, number];    // 열쇠: x, y, 든 사람(-1 없음), 문을 여는 데 씀
  a: string;                              // 켜진 다리 글자들
  b: number[];                            // 단추마다 밟은 사람 수
  c: number[];                            // 상자마다 4칸: x, y, 떨어지는 속도, 미는 사람 수
  p: number[];                            // 도름이마다 9칸: 자리 번호, x, y, vx, vy, 상태, 걷기, 멈춤 시간, 그래프 위
  g: GWire;                               // 그래프 공장 장치
  h?: number[];                           // 새 물건: 놓는 곳마다 센 수, 그리고 물건마다 8칸(0 제자리 1 없어짐 2+n n번째 도름이가 듦, x, y, 떨어지는 속도, 움직임의 수 4칸)
};

const r1 = (v: number) => Math.round(v * 10) / 10, r2 = (v: number) => Math.round(v * 100) / 100;
const ON = 1, IN_DOOR = 2, LEFT = 4, RIGHT = 8, TURN = 16, LOCK = 32, A_HELD = 64, J_HELD = 128, SMALL = 256;

/** 방장: 지금 세계를 요약으로. seats 는 도름이 차례대로의 자리 번호(방 정보의 order). */
export function toWire(w: World, seats: readonly number[], run: number, n: number): Wire {
  const p: number[] = [];
  w.players.forEach((q, i) => {
    const bits = (q.on ? ON : 0) | (q.inDoor ? IN_DOOR : 0) | (q.side === 'left' ? LEFT : q.side === 'right' ? RIGHT : 0) | (q.turnT > 0 ? TURN : 0) | (q.doorLock ? LOCK : 0) | (q.aHeld ? A_HELD : 0) | (q.jumpHeld ? J_HELD : 0) | (q.small ? SMALL : 0);
    p.push(seats[i] ?? i, r1(q.x), r1(q.y), Math.round(q.vx), Math.round(q.vy), bits, r1(q.walk % 4), r2(Math.max(0, q.stun)), q.onCurve ? 1 : 0);
  });
  return {
    r: run, n, t: r2(w.t), f: (w.doorOpen ? 1 : 0) | (w.won ? 2 : 0),
    k: [Math.round(w.key.x), Math.round(w.key.y), w.key.holder ?? -1, w.key.used ? 1 : 0],
    a: [...w.active].join(''),
    b: w.pressed.slice(),
    c: w.crates.flatMap(c => [r1(c.x), r1(c.y), Math.round(c.vy), c.pushers]),
    p,
    g: graphToWire(w.g),
    h: [...w.h.counts, ...w.h.items.flatMap(it => [it.at === 2 ? 2 + it.holder : it.at, r1(it.x), r1(it.y), Math.round(it.vy), ...it.v.map(r2)])],
  };
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const whole = (v: unknown, lo: number, hi: number): v is number => num(v) && Number.isInteger(v) && v >= lo && v <= hi;
const nums = (v: unknown, max: number): v is number[] => Array.isArray(v) && v.length <= max && v.every(num);

/** 받은 요약의 모양을 검사한다. 어긋나면 null(그 요약은 버린다). 세계에 맞는지는 applyWire 가 다시 본다. */
export function readWire(x: unknown): Wire | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  if (!whole(o.r, 0, 1e9) || !whole(o.n, 0, 1e12) || !num(o.t) || o.t < 0 || !whole(o.f, 0, 3)) return null;
  if (!nums(o.k, 4) || o.k.length !== 4 || typeof o.a !== 'string' || o.a.length > 64) return null;
  if (!nums(o.b, 200) || !nums(o.c, 200 * C) || o.c.length % C || !nums(o.p, MAX_SEATS * P) || o.p.length % P) return null;
  for (let i = 0; i < o.p.length; i += P) if (!whole(o.p[i], 0, MAX_SEATS - 1) || !whole(o.p[i + 5], 0, 511) || !whole(o.p[i + 8], 0, 1)) return null;
  const g = readGWire(o.g);
  if (!g) return null;
  if (o.h != null && !nums(o.h, 12 + 80 * H)) return null;
  return o as unknown as Wire;
}

/** 요약에 적힌 도름이들의 자리 번호. */
export const wireSeats = (wire: Wire) => { const out: number[] = []; for (let i = 0; i < wire.p.length; i += P) out.push(wire.p[i]); return out; };

/**
 * 손님: 요약을 세계에 덮어쓴다. 세계는 같은 스테이지·같은 씨앗으로 만들어 둔 것이어야 한다.
 * 스테이지와 맞지 않는 요약(상자·단추·그래프 장치 수가 다름)은 쓰지 않고 false 를 돌려준다.
 */
export function applyWire(w: World, wire: Wire): boolean {
  const st = w.stage;
  const th = st.things, hw = wire.h ?? [];
  if (wire.b.length !== st.buttons.length || wire.c.length !== st.crates.length * C || hw.length !== th.goals.length + th.items.length * H) return false;
  const seats = wireSeats(wire);
  if (w.players.length !== seats.length || w.players.some((q, i) => q.color !== colorFor(seats[i]))) setPlayerCount(w, seats.map(colorFor));
  const sw = st.cols * T, sh = st.rows * T, inX = (v: number) => Math.max(-T, Math.min(sw + T, v)), inY = (v: number) => Math.max(-4 * T, Math.min(sh + 4 * T, v));

  w.t = Math.min(wire.t, 86_400); w.doorOpen = !!(wire.f & 1); w.won = !!(wire.f & 2);
  const holder = wire.k[2];
  w.key = { x: inX(wire.k[0]), y: inY(wire.k[1]), holder: Number.isInteger(holder) && holder >= 0 && holder < seats.length ? holder : null, used: !!wire.k[3] };
  w.active = new Set(wire.a);
  w.pressed = wire.b.map(v => Math.max(0, Math.min(MAX_SEATS, v | 0)));
  w.crates.forEach((c, i) => { c.x = inX(wire.c[i * C]); c.y = inY(wire.c[i * C + 1]); c.vy = fast(wire.c[i * C + 2]); c.pushers = Math.max(0, Math.min(MAX_SEATS, wire.c[i * C + 3] | 0)); });
  w.players.forEach((q, i) => {
    const o = i * P, bits = wire.p[o + 5];
    setSmall(q, !!(bits & SMALL));
    q.x = inX(wire.p[o + 1]); q.y = inY(wire.p[o + 2]); q.vx = fast(wire.p[o + 3]); q.vy = fast(wire.p[o + 4]);
    q.on = !!(bits & ON); q.inDoor = !!(bits & IN_DOOR);
    q.side = bits & LEFT ? 'left' : bits & RIGHT ? 'right' : null;
    q.turnT = bits & TURN ? 0.1 : 0; q.doorLock = !!(bits & LOCK);
    q.aHeld = !!(bits & A_HELD); q.aNew = false; q.jumpHeld = !!(bits & J_HELD); q.jn = null; q.jumpBuf = 0;
    q.walk = ((wire.p[o + 6] % 4) + 4) % 4;              // 걷는 그림 번호가 음수가 되지 않게
    q.stun = Math.max(0, Math.min(3, wire.p[o + 7])); q.onCurve = !!wire.p[o + 8]; q.jumpNew = false;
  });
  if (!applyGraphWire(st.graph, w.g, wire.g, seats.length, sw, sh)) return false;
  th.goals.forEach((g, i) => { w.h.counts[i] = Math.max(0, Math.min(g.need + 80, hw[i] | 0)); });
  w.h.items.forEach((it, i) => {
    const o = th.goals.length + i * H, v = hw[o] | 0;
    it.at = v >= 2 && v - 2 < seats.length ? 2 : v === 1 ? 1 : 0; it.holder = it.at === 2 ? v - 2 : -1;
    it.x = inX(hw[o + 1]); it.y = inY(hw[o + 2]); it.vy = fast(hw[o + 3]);
    for (let k = 0; k < VARS; k++) it.v[k] = clampNum(hw[o + 4 + k]);
  });
  return true;
}
/** 속도는 물리가 내는 범위 안으로 자른다(방장이 바뀌어 이 세계를 이어 굴릴 때 터무니없는 속도가 남지 않게). */
const fast = (v: number) => Math.max(-1000, Math.min(1000, v));

// ---------- 요약 사이를 부드럽게 잇기 ----------

/** 받은 요약 가운데 마지막 둘과 받은 때(밀리초). */
export type Track = { a: Wire | null; b: Wire | null; ta: number; tb: number; gap: number };
export const newTrack = (): Track => ({ a: null, b: null, ta: 0, tb: 0, gap: 1000 * SNAP_EVERY / 60 });

/** 새 요약을 받았다. 지난 판의 것이거나 차례가 뒤로 간 것은 버린다(false). */
export function pushWire(track: Track, wire: Wire, run: number, now: number): boolean {
  if (wire.r !== run) return false;
  if (track.b && track.b.r === wire.r && wire.n <= track.b.n) return false;
  if (track.b) track.gap += (Math.max(16, Math.min(250, now - track.tb)) - track.gap) * 0.2;   // 요약이 오는 간격을 느리게 따라간다
  track.a = track.b; track.ta = track.tb; track.b = wire; track.tb = now;
  return true;
}

/**
 * 그릴 때마다: 마지막 요약을 세계에 덮어쓴 뒤, 도름이·상자의 자리만 앞 요약과 마지막 요약 사이로 되돌려 잇는다.
 * 요약 한 번 간격만큼 늦게 그려서 그 사이를 고르게 채운다. 멀리 건너뛴 것(되살아남·문에서 나옴)은 잇지 않는다.
 */
export function blend(w: World, track: Track, now: number, dt: number): boolean {
  const b = track.b;
  if (!b || !applyWire(w, b)) return false;
  const a = track.a;
  void dt;
  if (!a || a.r !== b.r || a.p.length !== b.p.length || a.c.length !== b.c.length) return true;
  const k = Math.max(0, Math.min(1, (now - track.gap - track.ta) / Math.max(1, track.tb - track.ta)));
  if (k >= 1) return true;
  const mix = (from: number, to: number, far: number) => (Math.abs(to - from) > far ? to : from + (to - from) * k);
  w.players.forEach((q, i) => {
    const o = i * P;
    if (a.p[o] !== b.p[o] || ((a.p[o + 5] ^ b.p[o + 5]) & IN_DOOR)) return;
    q.x = mix(a.p[o + 1], b.p[o + 1], 48); q.y = mix(a.p[o + 2], b.p[o + 2], 90);
  });
  w.crates.forEach((c, i) => { c.x = mix(a.c[i * C], b.c[i * C], 48); c.y = mix(a.c[i * C + 1], b.c[i * C + 1], 90); });
  const h = w.key.holder != null ? w.players[w.key.holder] : null;
  if (h && !w.key.used) { w.key.x = h.x + h.w / 2 - 16; w.key.y = h.y - 26; }
  // 든 조각·양동이는 섞은 도름이 자리를 따라간다
  for (const pc of w.g.pieces) { const lead = pc.state === 'held' ? w.players[pc.holders[0]] : null; if (lead) { pc.x = lead.x + lead.w / 2; pc.y = lead.y - 3; } }
  const bk = w.g.bucket, bh = bk && bk.holder >= 0 ? w.players[bk.holder] : null;
  if (bk && bh) { bk.x = bh.x + bh.w / 2; bk.y = bh.y - 2; }
  return true;
}

// ---------- 손님의 조작: 보내는 쪽과 받는 쪽 ----------
/** 조작은 바뀌면 바로 보낸다(초당 서른 번까지). 안 바뀌어도 1초마다 다시 보내고, 방장은 3.5초 넘게 소식이 없는 조작을 놓은 것으로 본다. */
export const PAD_MIN_MS = 33, PAD_REPEAT_MS = 1000, PAD_STALE_MS = 3500;

/**
 * 손님: 내 조작을 방장에게 보낸다. 짧게 누른 확인도 빠지지 않게 모아 둔다.
 * 되풀이 보내기는 1초에 한 번뿐이라(방 서버를 지나가는 글 수를 줄인다), 받는 방장이 바뀌면 again() 을 불러 바로 다시 보낸다.
 */
export function padSender(send: (p: Pad) => void) {
  let at = -1e12, key = '', held = false;
  const push = (p: Pad, now: number) => {
    held ||= !!p.a;
    if (now - at < PAD_MIN_MS) return;
    const out: Pad = { m: p.m, j: p.j, a: held, jn: p.jn };
    const k = `${out.m}${out.j ? 1 : 0}${held ? 1 : 0}${out.jn}`;
    if (k !== key || now - at >= PAD_REPEAT_MS) { send(out); key = k; at = now; }
    held = false;
  };
  /** 받는 쪽이 바뀌었다(방장이 바뀌었거나 다시 붙었다): 바뀐 것이 없어도 다음 번에 바로 보낸다. */
  push.again = () => { key = ''; };
  return push;
}

/** 방장: 손님들의 마지막 조작. 새 조작이 올 때까지 마지막 것을 그대로 이어 쓴다(누르고 있는 동안 글이 오지 않아도 계속 걷는다). */
export class GuestPads {
  private pads = new Map<number, { pad: Pad; at: number; tap: boolean }>();   // tap: 아직 걸음에 쓰이지 않은 짧은 확인 누름
  set(seat: number, pad: Pad, now: number) { this.pads.set(seat, { pad, at: now, tap: !!pad.a || !!this.pads.get(seat)?.tap }); }
  /** 이번 걸음에 쓸 조작. 한참(3.5초) 소식이 없으면 손을 뗀 것으로 본다(연결이 죽은 사람의 도름이가 혼자 걷지 않게). */
  get(seat: number, now: number): Pad {
    const g = this.pads.get(seat);
    if (!g || now - g.at >= PAD_STALE_MS) return NO_PAD;
    return g.tap && !g.pad.a ? { ...g.pad, a: true } : g.pad;
  }
  /** 걸음이 한 번 돌았다: 짧은 확인(누름과 뗌이 걸음 한 번 사이에 함께 온 것)도 한 걸음은 쓰였다. */
  stepped() { for (const g of this.pads.values()) g.tap = false; }
  clear() { this.pads.clear(); }
}
