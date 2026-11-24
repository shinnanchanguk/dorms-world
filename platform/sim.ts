/**
 * 2D 협력 물리. 화면과 떼어 놓아 시험과 방장 계산에 그대로 쓴다.
 * 시안(design-lab/game.js)에서 형이 직접 해 본 움직임(속도·점프·서로 비켜 가기·머리 위 올라타기)을 옮겼다.
 */
import { T, resolveNeed, type Rect, type Stage } from './stage';
import { createThingWorld, type ThingWorld } from './things';
import { thingActive, thingAvoid, thingSolidAt, thingTick, thingsBefore, thingsRelease, thingsRemove } from './thing-sim';
import { SMALL_H, SMALL_W, inShrink, sieveBlocks, sievePull } from './size';
import { createGraph, graphActionAt, graphTick, holdingPiece, riderSpot, surfaceBelow, type GAction, type GraphWorld, type Host } from './graph/model';

export const G = 1900, SPEED = 175, JUMP = Math.sqrt(2 * G * 108), CRATE_SPEED = 55;
export const PW = 22, PH = 38;
export const JUMP_BUFFER = 0.2, COYOTE = 0.09;

/**
 * m 좌우, j 뛰기(누르고 있는 중), a 확인(열린 문에 들어가기).
 * jn 은 뛰기를 새로 누른 횟수(늘어나기만 한다). 뛰기 키 하나를 누른 채 다른 뛰기 키를 눌러도,
 * 한 프레임 안에 뗐다 다시 눌러도 '새로 누름'이 빠지지 않게 조작 쪽에서 세어 보낸다. 없으면 j 가 바뀌는 순간으로 본다.
 * 한 사람의 조작은 jn 을 늘 넣거나 늘 빼거나 한 가지로 보낸다(섞어 보내지 않는다).
 */
export type Pad = { m: -1 | 0 | 1; j: boolean; a?: boolean; jn?: number };
export const NO_PAD: Pad = { m: 0, j: false };

export type Player = Rect & {
  i: number;              // 들어온 차례(0부터). 표지 글과 번호표에 쓴다
  color: string;
  vx: number; vy: number;
  on: boolean;            // 무언가를 딛고 있다
  side: 'left' | 'right' | null;
  turnT: number;          // 방향을 바꾼 직후 정면을 보여 주는 남은 시간
  walk: number;
  pressing: -1 | 0 | 1;   // 상자를 미는 방향
  pressCrate: number;
  jumpHeld: boolean;
  jn: number | null;       // 마지막으로 본 뛰기 누름 횟수
  jumpBuf: number;         // 뛰기를 누른 뒤 기억하는 남은 시간(착지 직전에 눌러도 착지하면 뛴다)
  coyote: number;          // 발이 떨어진 뒤에도 뛸 수 있는 남은 시간(턱 끝에서 살짝 늦게 눌러도 뛴다)
  aHeld: boolean;          // 확인 단추를 누르고 있는 중
  aNew: boolean;           // 이번 걸음에 확인을 새로 눌렀다
  stun: number;            // 빨간 공·벌에 맞아 멈춰 선 남은 시간
  onCurve: boolean;        // 그래프 조각 위를 딛고 있다
  jumpNew: boolean;        // 이번 걸음에 뛰기를 새로 눌렀다(썰매에 탄 도름이)
  doorLock: boolean;       // 문을 막 드나든 뒤, 확인에서 손을 뗄 때까지 다시 드나들지 않는다
  want: -1 | 0 | 1;        // 이번 걸음에 가려던 방향
  inDoor: boolean;
  small: boolean;          // 작아지는 곳(shrink)에 닿아 작아졌다. 처음 자리로 돌아가면 원래 크기로
};

export type Crate = Rect & { vy: number; need: number; pushers: number };

export type World = {
  stage: Stage;
  players: Player[];
  crates: Crate[];
  needs: number[];                 // 단추별 필요 인원(방 인원으로 풀어 둔 값)
  pressed: number[];               // 단추별 지금 밟은 사람 수
  active: Set<string>;             // 켜진 다리 글자
  key: { x: number; y: number; holder: number | null; used: boolean };
  g: GraphWorld;                   // 그래프 공장 장치(조각·공·벌·썰매·목표)
  h: ThingWorld;                   // 새 물건(things.json)의 지금 모습
  doorOpen: boolean;
  won: boolean;
  t: number;
};

export const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** seed 는 공·벌이 오는 차례를 정하는 씨앗이다. */
export function createWorld(stage: Stage, players: { color: string }[], seed = 1): World {
  const n = players.length;
  return {
    stage,
    players: players.map((p, i) => spawnPlayer(stage, i, p.color)),
    crates: stage.crates.map(c => ({ x: c.x, y: c.y, w: c.w, h: c.h, vy: 0, need: resolveNeed(c.need, n), pushers: 0 })),
    needs: stage.buttons.map(b => resolveNeed(b.need, n)),
    pressed: stage.buttons.map(() => 0),
    active: new Set(),
    key: { x: stage.key!.x, y: stage.key!.y, holder: null, used: false },
    g: createGraph(stage.graph, seed),
    h: createThingWorld(stage.things),
    doorOpen: false, won: false, t: 0,
  };
}

const cellSolid = (stage: Stage, c: number, r: number) => c < 0 || c >= stage.cols || r < 0 || (r < stage.rows && !!stage.solid[r * stage.cols + c]);

/** 그 자리에 설 수 있는가: 지도 안이고, 몸이 땅과 안 겹치고, 발밑에 땅이 있다. */
function standable(stage: Stage, x: number, y: number) {
  if (x < 0 || x + PW > stage.cols * T || y < 0) return false;
  const me = { x, y, w: PW, h: PH };
  for (const b of stage.crates) if (overlap(me, b)) return false;                                   // 상자 자리에는 세우지 않는다
  // 단추·다리·열쇠·문 자리에도 세우지 않는다(시작하자마자 단추가 눌리거나 열쇠를 줍지 않게)
  for (const b of stage.buttons) if (overlap(me, { x: b.x - 3, y: b.y - T, w: b.w + 6, h: T + 8 })) return false;
  for (const b of stage.bridges) for (const [c, r] of b.cells) if (overlap(me, { x: c * T, y: r * T, w: T, h: T })) return false;
  if (stage.key && overlap(me, { x: stage.key.x, y: stage.key.y, w: 32, h: 18 })) return false;
  if (stage.door && overlap(me, stage.door)) return false;
  if (thingAvoid(stage, me)) return false;   // 새 물건 자리도 피한다
  const c0 = Math.floor(x / T), c1 = Math.floor((x + PW - 0.01) / T), r0 = Math.floor(y / T), r1 = Math.floor((y + PH - 0.01) / T);
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (cellSolid(stage, c, r)) return false;
  const fr = Math.floor((y + PH + 1) / T);
  for (let c = c0; c <= c1; c++) if (fr < stage.rows && stage.solid[fr * stage.cols + c]) return true;
  return false;
}

const slotCache = new WeakMap<Stage, { x: number; y: number }[]>();

/**
 * 시작 자리 목록. @ 에서 오른쪽으로 설 수 있는 데까지 한 줄(열 명), 그 머리 위로 두 줄,
 * 그래도 모자라면 바닥 줄을 오른쪽으로 더 잇는다. 벽·구덩이·상자를 만나면 거기서 줄이 끝난다.
 */
function slots(stage: Stage) {
  const hit = slotCache.get(stage); if (hit) return hit;
  const bx = stage.spawn.x + 4, by = stage.spawn.y - PH - 1;
  const ground: number[] = [];
  for (let k = 0; k < 30; k++) { const x = bx + k * 24; if (k > 0 && !standable(stage, x, by)) break; ground.push(x); }
  for (let k = 1; ground.length < 30; k++) { const x = bx - k * 24; if (!standable(stage, x, by)) break; ground.push(x); }   // 오른쪽이 막히면 왼쪽으로도 잇는다
  const out = ground.slice(0, 10).map(x => ({ x, y: by }));
  for (let row = 1; row <= 2; row++) for (const x of ground.slice(0, 10)) {
    const y = by - row * (PH + 1);
    const c0 = Math.floor(x / T), c1 = Math.floor((x + PW - 0.01) / T);
    let free = y >= 0;
    for (let r = Math.floor(y / T); free && r <= Math.floor((y + PH - 0.01) / T); r++) for (let c = c0; c <= c1; c++) if (cellSolid(stage, c, r)) free = false;
    // 아래 줄에 그 칸이 있어야 딛고 선다
    if (free && out.some(sl => sl.x === x && sl.y === y + PH + 1)) out.push({ x, y });
  }
  for (const x of ground.slice(10)) out.push({ x, y: by });
  slotCache.set(stage, out);
  return out;
}

/** i 번째 도름이가 설 자리. 자리가 모자라면 시작 칸 안에 겹쳐 서고, 겹친 사람끼리는 조금씩 떨어진다. */
export function spawnAt(stage: Stage, i: number) {
  const list = slots(stage);
  return list[i] ?? { x: stage.spawn.x + (i % 3) * 4, y: stage.spawn.y - PH - 1 };
}

function spawnPlayer(stage: Stage, i: number, color: string): Player {
  const at = spawnAt(stage, i);
  return {
    i, color, x: at.x, y: at.y, w: PW, h: PH,
    vx: 0, vy: 0, on: false, side: null, turnT: 0, walk: 0, pressing: 0, pressCrate: -1, jumpHeld: false, jn: null, jumpBuf: 0, coyote: 0, aHeld: false, aNew: false, stun: 0, onCurve: false, jumpNew: false, doorLock: false, want: 0, inDoor: false, small: false,
  };
}

/** 사람이 늘거나 줄면 필요 인원을 다시 푼다(늦게 들어온 사람, 나간 사람). */
export function setPlayerCount(w: World, colors: string[]) {
  while (w.players.length < colors.length) w.players.push(spawnPlayer(w.stage, w.players.length, colors[w.players.length]));
  if (w.players.length > colors.length) {
    if (w.key.holder != null && w.key.holder >= colors.length) dropKey(w);
    for (let i = w.players.length - 1; i >= colors.length; i--) graphRemove(w, i);
    w.players.length = colors.length;
  }
  w.players.forEach((p, i) => { p.color = colors[i]; });
  const n = w.players.length;
  w.stage.crates.forEach((c, i) => { w.crates[i].need = resolveNeed(c.need, n); });
  w.needs = w.stage.buttons.map(b => resolveNeed(b.need, n));
}

/**
 * 가운데 사람이 나갔다: 그 도름이만 빼고 뒤 번호를 하나씩 당긴다(남은 도름이의 색과 자리는 그대로).
 * 열쇠를 들고 있었으면 내려놓는다(땅을 딛고 있었으면 그 발밑에, 공중이었으면 처음 자리로).
 * 든 그래프 조각·양동이는 내려놓는다.
 */
export function removePlayer(w: World, i: number) {
  const p = w.players[i];
  if (!p) return;
  if (w.key.holder === i) {
    if (p.on && !p.inDoor) { w.key.holder = null; w.key.x = p.x + p.w / 2 - 16; w.key.y = p.y + p.h - 18; }
    else dropKey(w);
  } else if (w.key.holder != null && w.key.holder > i) w.key.holder--;
  graphRemove(w, i);
  w.players.splice(i, 1);
  w.players.forEach((q, k) => { q.i = k; });
  const n = w.players.length;
  w.stage.crates.forEach((c, k) => { w.crates[k].need = resolveNeed(c.need, n); });
  w.needs = w.stage.buttons.map(b => resolveNeed(b.need, n));
}

/** 그 도름이가 든 것을 내려놓는다(조각은 떨어지고, 양동이는 놓이고, 썰매에서 내린다). */
function release(w: World, i: number) {
  thingsRelease(w, i);   // 든 새 물건은 처음 자리로
  const g = w.g;
  for (const pc of g.pieces) if (pc.state === 'held' && pc.holders.includes(i)) {
    if (pc.holders[0] === i) { pc.state = 'fall'; pc.holders = []; pc.vy = 0; } else pc.holders = pc.holders.filter(k => k !== i);
  }
  if (g.bucket?.holder === i) g.bucket.holder = -1;
  if (g.sled?.rider === i) g.sled.rider = -1;
}
/** i 번째 도름이가 나갔다: 든 것을 내려놓고 뒤 번호를 하나씩 당긴다. */
function graphRemove(w: World, i: number) {
  release(w, i);
  thingsRemove(w, i);
  const g = w.g, sh = (k: number) => (k > i ? k - 1 : k);
  for (const pc of g.pieces) pc.holders = pc.holders.map(sh);
  if (g.bucket && g.bucket.holder > i) g.bucket.holder--;
  if (g.sled && g.sled.rider > i) g.sled.rider--;
}

function dropKey(w: World) { w.key.holder = null; w.key.x = w.stage.key!.x; w.key.y = w.stage.key!.y; }

export function bridgeSolid(w: World, ch: string, mode: 'appear' | 'vanish') {
  return mode === 'appear' ? w.active.has(ch) : !w.active.has(ch);
}

function tileSolid(w: World, c: number, r: number) {
  const s = w.stage;
  if (c < 0 || c >= s.cols || r < 0) return true;
  if (r >= s.rows) return false;
  return !!s.solid[r * s.cols + c];
}

/** 다리 칸 가운데 지금 막힌 칸과 겹치는가. */
export function hitsBridge(w: World, r: Rect) {
  for (const b of w.stage.bridges) {
    if (!bridgeSolid(w, b.ch, b.mode)) continue;
    for (const [c, rr] of b.cells) if (overlap(r, { x: c * T, y: rr * T, w: T, h: T })) return true;
  }
  return false;
}

export function hitsTiles(w: World, r: Rect) {
  const c0 = Math.floor(r.x / T), c1 = Math.floor((r.x + r.w - 0.01) / T);
  const r0 = Math.floor(r.y / T), r1 = Math.floor((r.y + r.h - 0.01) / T);
  for (let rr = r0; rr <= r1; rr++) for (let cc = c0; cc <= c1; cc++) if (tileSolid(w, cc, rr)) return true;
  return false;
}

export function crateAt(w: World, r: Rect, skip = -1) {
  for (let i = 0; i < w.crates.length; i++) if (i !== skip && overlap(r, w.crates[i])) return i;
  return -1;
}

/** 사람이 막히는가. 다리가 갑자기 생긴 자리에 이미 들어가 있던 사람은 빠져나올 수 있게 한다. */
function blocked(w: World, r: Rect, insideBridge: boolean, self?: Rect, fromBottom?: number) {
  return hitsTiles(w, r) || sieveBlocks(w.stage.size, r, !!(self as Player | undefined)?.small) || crateAt(w, r) >= 0 || (!insideBridge && hitsBridge(w, r)) || thingSolidAt(w, r, self, fromBottom);
}

/** 처음 자리로 되돌린다(떨어짐·깔림·닿으면 처음 자리로 가는 물건). 든 열쇠는 처음 자리로, 든 것은 내려놓는다. */
export function respawn(w: World, p: Player) {
  setSmall(p, false);
  const at = spawnAt(w.stage, p.i);
  p.x = at.x; p.y = at.y; p.vx = 0; p.vy = 0; p.jumpBuf = 0;   // 누른 채 떨어졌어도 되살아난 자리에서 저절로 뛰지 않는다
  if (w.key.holder === p.i) dropKey(w);
  release(w, p.i);
}

/**
 * 도름이끼리는 서로 막힌다(옆으로 못 지나가고, 머리는 딛고 설 수 있다). 지나가려면 뛰어넘는다.
 * 이미 겹쳐 있는 친구(같은 칸에서 시작했거나 상자에 밀려 겹친 경우)에게서는 빠져나올 수 있다.
 */
function otherAt(w: World, p: Player, r: Rect): Player | null {
  for (const q of w.players) {
    if (q === p || q.inDoor || !overlap(r, q) || overlap(p, q)) continue;
    return q;
  }
  return null;
}

/** 한 번에 1/60초보다 길게 건너뛰지 않는다(긴 걸음 한 번에 바닥을 뚫지 않게 잘게 나눈다). */
export function step(w: World, pads: (Pad | undefined)[], dt: number) {
  for (let left = Math.min(dt, 0.25); left > 1e-6; left -= 1 / 60) tick(w, pads, Math.min(left, 1 / 60));
}

function tick(w: World, pads: (Pad | undefined)[], dt: number) {
  if (w.won) return;
  w.t += dt;
  thingsBefore(w, dt);
  const stage = w.stage;
  for (const p of w.players) { const a = !!pads[p.i]?.a; p.aNew = a && !p.aHeld; p.aHeld = a; }
  for (const p of w.players) {
    if (p.inDoor) continue;
    const pad = pads[p.i] ?? NO_PAD;
    if (p.stun > 0) p.stun -= dt;
    const stunned = p.stun > 0, m = stunned ? 0 : pad.m, j = stunned ? false : pad.j, jn = pad.jn;
    // 무거운 그래프는 손이 모자라면 천천히 옮긴다(혼자서도 들 수는 있다)
    const hp = holdingPiece(w.g, p.i), heavy = hp >= 0 ? Math.min(1, w.g.pieces[hp].holders.length / w.g.pieces[hp].shape.need) : 1;
    p.vx = m * SPEED * (hp >= 0 ? 0.45 + 0.55 * heavy : 1);
    if (m) { const side = m > 0 ? 'right' : 'left'; if (side !== p.side) { p.side = side; p.turnT = 0.18; } }
    if (p.turnT > 0) p.turnT -= dt;
    p.pressing = 0; p.pressCrate = -1; p.want = m;
    // 뛰기: 누른 순간을 잠깐 기억하고(JUMP_BUFFER), 발이 막 떨어진 직후에도 받아 준다(COYOTE).
    // 착지 몇 프레임 전에 누르거나 턱에 막혀 연달아 뛸 때 누름이 버려지지 않게 한다.
    // 공중에서 미리 눌러 그대로 누르고 있으면 착지하자마자 뛴다(기억은 손을 뗀 뒤부터 줄어든다).
    // 한 번 누름에 한 번만 뛴다: 누르고 있는 동안 저절로 다시 뛰지는 않는다.
    const pressed = jn != null && p.jn != null ? jn !== p.jn : j && !p.jumpHeld;
    p.jn = jn ?? null;   // 조작이 끊긴 동안(다른 도름이를 움직이는 중, 신호가 빠진 걸음)에는 기준을 지운다. 돌아온 첫 걸음은 횟수 대신 '누르고 있나'가 바뀐 것으로 본다
    p.jumpNew = pressed && !stunned;
    if (pressed && !stunned) p.jumpBuf = JUMP_BUFFER;
    p.jumpHeld = j;
    p.coyote = p.on ? COYOTE : p.coyote - dt;
    if (p.jumpBuf > 0 && p.coyote > 0) { p.vy = -JUMP; p.on = false; p.jumpBuf = 0; p.coyote = 0; }
    else if (p.jumpBuf > 0 && !j) p.jumpBuf -= dt;
    p.vy = Math.min(p.vy + G * dt, 900);
    const inside = hitsBridge(w, p);

    // 가로: 막히면 제자리에 서지 않고 맞닿는 자리까지 다가간다(틈이 남으면 밀기 판정이 흔들린다)
    const nx = p.x + p.vx * dt;
    const free = (x: number) => { const r = { x, y: p.y, w: p.w, h: p.h }; return !blocked(w, r, inside, p) && !otherAt(w, p, r); };
    if (!m || free(nx)) p.x = nx;
    else { let x = p.x; while (Math.abs(x + m - p.x) <= Math.abs(nx - p.x) + 1 && free(x + m)) x += m; if (free(x)) p.x = x; }

    // 세로
    const ny = p.y + p.vy * dt;
    const ry = { x: p.x, y: ny, w: p.w, h: p.h };
    const touch = otherAt(w, p, ry);
    const under = p.vy > 0 ? touch : null;
    const onHead = !!under && p.y + p.h <= under.y + 2;
    const bonk = p.vy < 0 && !!touch && touch.y + touch.h <= p.y + 2;   // 머리 위에 친구가 서 있으면 못 뛰어오른다
    // 그래프 조각 위: 내려오다가 곡선에 닿으면 선다(밑에서 뛰어오를 때는 지나간다). 걷다가 발목 높이(9px)의 곡선은 계단처럼 올라선다
    const curve = p.vy >= 0 ? surfaceBelow(w.g, p.x + 3, p.x + p.w - 3, p.y + p.h - (p.onCurve || p.on ? 9 : 1), ny + p.h + (p.onCurve ? 9 : 0)) : null;
    const feet = p.vy > 0 ? p.y + p.h : undefined;                      // 발판(ledge)은 위에서 내려올 때만 딛는다
    if (curve != null && !onHead && !blocked(w, { x: p.x, y: curve - p.h, w: p.w, h: p.h }, inside, p, feet)) {
      p.y = curve - p.h; p.vy = 0; p.on = true; p.onCurve = true;
    } else if (blocked(w, ry, inside, p, feet) || onHead || bonk) {
      p.onCurve = false;
      if (p.vy > 0) {
        p.on = true;
        let y = p.y;
        while (y < ny && !blocked(w, { x: p.x, y: y + 1, w: p.w, h: p.h }, inside, p, feet) && !(onHead && y + 1 + p.h > under!.y)) y += 1;
        // 1px 걸음으로 다가가면 1px 안쪽 틈이 남는다. 땅·다리·상자 윗면은 정수 자리라 발을 그 면에, 친구 머리 위면 머리에 딱 붙인다.
        // 떠 있는 틈이 사람마다 달라서 머리 위 친구가 옆에서 다가오는 사람과 '겹친다'고 잘못 판정되던 것을 막는다.
        const snap = onHead ? under!.y - p.h : Math.ceil(y + p.h - 1e-6) - p.h;
        if (snap > y && snap - y < 1 + 1e-6 && !blocked(w, { x: p.x, y: snap, w: p.w, h: p.h }, inside, p, feet) && !(onHead ? false : otherAt(w, p, { x: p.x, y: snap, w: p.w, h: p.h }))) y = snap;
        p.y = y;
      }
      p.vy = 0;
    } else { p.y = ny; p.on = false; p.onCurve = false; }
    if (Math.abs(p.vx) > 0 && p.on) p.walk += dt * 10; else p.walk *= 0.8;

    if (p.y > stage.rows * T + 60) respawn(w, p);   // 떨어지면 시작 자리로
  }

  sizeTick(w);   // 크기 바꾸기: 작아지는 곳에 닿으면 작아지고, 작은 도름이는 틈으로 빨려 들어간다
  ropeTick(w);   // 줄 묶기: 줄보다 멀어진 친구끼리 당긴다

  // 상자: 한쪽에서 미는 사람이 맞은편보다 필요 인원만큼 많아야 움직인다(같은 수로 맞서면 멈춘다)
  w.crates.forEach((b, ci) => {
    const r = pushers(w, ci, 1), l = pushers(w, ci, -1);
    const dir: -1 | 0 | 1 = r.length > l.length ? 1 : l.length > r.length ? -1 : 0, count = Math.abs(r.length - l.length);
    for (const p of dir > 0 ? r : dir < 0 ? l : []) { p.pressing = dir as -1 | 1; p.pressCrate = ci; }
    b.pushers = count;
    const solidUnder = (rect: Rect) => hitsTiles(w, rect) || sieveBlocks(w.stage.size, rect, false) || hitsBridge(w, rect) || crateAt(w, rect, ci) >= 0 || thingSolidAt(w, rect, undefined, b.y + b.h);
    if (solidUnder({ x: b.x + 1, y: b.y + b.h, w: b.w - 2, h: 1 }) && dir && count >= b.need) {
      const dx = dir * CRATE_SPEED * dt;
      const nb = { x: b.x + dx, y: b.y, w: b.w, h: b.h };
      // 상자 앞에 선 사람은 같이 밀려 간다. 그 사람이 벽에 막혀 더 못 가면 상자도 멈춘다(사람이 상자에 묻히지 않게).
      const ahead = w.players.filter(p => !p.inDoor && overlap(p, nb) && !overlap(p, b));
      const squeezed = ahead.some(p => { const m = { x: p.x + dx, y: p.y, w: p.w, h: p.h }; const q = otherAt(w, p, m); return hitsTiles(w, m) || hitsBridge(w, m) || crateAt(w, m, ci) >= 0 || (!!q && !ahead.includes(q)); });
      if (!hitsTiles(w, nb) && !sieveBlocks(w.stage.size, nb, false) && !hitsBridge(w, nb) && crateAt(w, nb, ci) < 0 && !thingSolidAt(w, nb, b) && !squeezed) {
        const riders = w.players.filter(p => !p.inDoor && p.on && p.x + p.w > b.x && p.x < b.x + b.w && Math.abs(p.y + p.h - b.y) < 2);
        for (const p of [...ahead, ...riders]) { const m = { x: p.x + dx, y: p.y, w: p.w, h: p.h }; if (!hitsTiles(w, m)) p.x += dx; }
        b.x = nb.x;
      }
    }
    // 아래가 비면 떨어진다. 구멍 폭이 상자와 같을 때 쏙 들어가도록 칸에 맞춘다
    const below = { x: b.x + 5, y: b.y + b.h, w: b.w - 10, h: 2 };
    if (!solidUnder(below)) {
      if (b.vy === 0) b.x = Math.round(b.x / T) * T;
      b.vy = Math.min(b.vy + G * dt, 600);
      let ny = b.y + b.vy * dt;
      if (solidUnder({ x: b.x, y: ny, w: b.w, h: b.h })) { ny = Math.floor((ny + b.h) / T) * T - b.h; b.vy = 0; }
      b.y = ny;
      if (b.y > stage.rows * T + 60) { const home = stage.crates[ci]; b.x = home.x; b.y = home.y; b.vy = 0; }   // 지도 아래로 빠진 상자는 처음 자리로
    } else b.vy = 0;
  });

  // 안전망: 그래도 상자와 겹친 사람(떨어진 상자에 깔림 등)은 그 상자 위 빈 자리로 올려 준다
  for (const p of w.players) {
    if (p.inDoor) continue;
    const ci = crateAt(w, p);
    if (ci < 0) continue;
    const b = w.crates[ci];
    const okAt = (x: number) => { const r = { x, y: b.y - p.h, w: p.w, h: p.h }; return !hitsTiles(w, r) && crateAt(w, r) < 0 && !w.players.some(q => q !== p && !q.inDoor && overlap(r, q)); };
    const near = Math.max(b.x, Math.min(b.x + b.w - p.w, p.x));
    let spot: number | null = null;
    for (let d = 0; d <= b.w && spot == null; d += 4) for (const x of [near + d, near - d]) if (x >= b.x - p.w / 2 && x <= b.x + b.w - p.w / 2 && okAt(x)) { spot = x; break; }
    if (spot != null) { p.x = spot; p.y = b.y - p.h; p.vy = 0; }
    else respawn(w, p);
  }

  // 겹친 도름이끼리는 조금씩 떨어진다(같은 칸에서 시작했거나 되살아난 자리에 친구가 있던 경우). 갈 곳이 막혀 있으면 그대로 둔다.
  for (let a = 0; a < w.players.length; a++) for (let c = a + 1; c < w.players.length; c++) {
    const p = w.players[a], q = w.players[c];
    if (p.inDoor || q.inDoor || !overlap(p, q)) continue;
    if (Math.abs(p.y - q.y) > p.h - 4) continue;                       // 머리 위에 막 올라서는 중이면 건드리지 않는다
    const [left, right] = p.x < q.x || (p.x === q.x && p.i < q.i) ? [p, q] : [q, p];
    const mv = (o: Player, d: number) => { const r = { x: o.x + d, y: o.y, w: o.w, h: o.h }; if (!hitsTiles(w, r) && !hitsBridge(w, r) && crateAt(w, r) < 0) o.x += d; };
    mv(left, -0.5); mv(right, 0.5);
  }

  // 그래프 공장: 확인 누름 · 조각 · 공 · 벌 · 썰매 · 목표
  const opened = new Set<string>();
  thingTick(w, dt);   // 새 물건이 쓴 확인 누름은 지워져 그래프 장치로 넘어가지 않는다
  graphTick(stage.graph, w.g, hostOf(w), dt, opened, () => 1);
  const sled = w.g.sled;
  if (sled?.run && sled.rider >= 0) { const p = w.players[sled.rider], at = riderSpot(sled); if (p) { p.x = at.x; p.y = at.y; p.vx = 0; p.vy = 0; p.on = true; } }

  // 단추와 다리
  thingActive(w, ch => opened.add(ch));
  w.active = opened;
  stage.buttons.forEach((btn, bi) => {
    const n = w.players.filter(p => !p.inDoor && p.on && overlap({ x: p.x, y: p.y + 2, w: p.w, h: p.h }, btn)).length;
    w.pressed[bi] = n;
    if (n >= w.needs[bi]) for (const ch of btn.opens) w.active.add(ch);
  });

  // 열쇠와 문
  const k = w.key, door = stage.door!;
  if (!k.used) {
    if (k.holder == null) {
      for (const p of w.players) if (!p.inDoor && overlap(p, { x: k.x, y: k.y, w: 32, h: 18 })) { k.holder = p.i; break; }
    } else {
      const p = w.players[k.holder];
      if (!p) dropKey(w);
      else {
        k.x = p.x + p.w / 2 - 16; k.y = p.y - 26;
        if (overlap(p, door)) { w.doorOpen = true; k.used = true; k.holder = null; }
      }
    }
  }
  if (w.doorOpen) {
    for (const p of w.players) {
      const a = p.aHeld, pressed = p.aNew;
      if (!a) p.doorLock = false;
      // 확인을 누른 채 문 앞에 서면 들어간다. 문 안에서 확인을 새로 누르면 다시 나온다(먼저 들어간 친구가 도우러 나올 수 있다).
      if (!p.inDoor && a && !p.doorLock && atDoor(w, p)) { release(w, p.i); p.inDoor = true; p.doorLock = true; p.vx = 0; p.vy = 0; }
      else if (p.inDoor && pressed) { p.inDoor = false; p.doorLock = true; p.x = door.x + door.w / 2 - p.w / 2; p.y = door.y + door.h - p.h; p.vx = 0; p.vy = 0; }
    }
    if (w.players.length > 0 && w.players.every(p => p.inDoor)) w.won = true;
  }
}

// ---------- 크기 바꾸기 (legend 의 shrink · sieve, platform/size.ts) ----------
/** 크기를 바꾼다. 발과 몸 가운데는 그 자리에 둔다. */
export function setSmall(p: Player, small: boolean) {
  if (p.small === small) return;
  const cx = p.x + p.w / 2, feet = p.y + p.h;
  p.small = small; p.w = small ? SMALL_W : PW; p.h = small ? SMALL_H : PH;
  p.x = cx - p.w / 2; p.y = feet - p.h;
}

const SUCK = 240;   // 틈으로 빨려 드는 빠르기(px/초)
function sizeTick(w: World) {
  const size = w.stage.size;
  if (!size.shrinks.length && !size.sieves.length) return;
  for (const p of w.players) {
    if (p.inDoor) continue;
    if (!p.small && inShrink(size, p, ch => w.active.has(ch))) setSmall(p, true);
    if (!p.small) continue;
    const pull = sievePull(size, p);
    if (pull === 'down') { p.vy = Math.max(p.vy, SUCK); p.on = false; }
    else if (pull === 'up') { p.vy = Math.min(p.vy, -SUCK); p.on = false; }
    else if (pull) {
      const d = (pull === 'right' ? 1 : -1) * SUCK / 60, inside = hitsBridge(w, p), r = { x: p.x + d, y: p.y, w: p.w, h: p.h };
      if (!blocked(w, r, inside, p) && r.x >= 0 && r.x + p.w <= w.stage.cols * T) p.x = r.x;
    }
  }
}

// ---------- 줄 묶기 (NN.json 의 rope) ----------
/**
 * 줄로 묶인 도름이 짝. pairs: 들어온 차례로 둘씩(0-1, 2-3 …, 혼자 남은 사람은 바로 앞 사람과 묶는다). chain: 모두 한 줄로.
 * 문에 들어간 도름이는 줄에서 풀린다(먼저 들어가도 남은 친구를 붙잡지 않는다).
 */
export function ropeLinks(w: World): [Player, Player][] {
  const r = w.stage.rope, ps = w.players;
  if (!r || ps.length < 2) return [];
  const out: [Player, Player][] = [];
  if (r.link === 'chain') for (let i = 1; i < ps.length; i++) out.push([ps[i - 1], ps[i]]);
  else {
    for (let i = 0; i + 1 < ps.length; i += 2) out.push([ps[i], ps[i + 1]]);
    if (ps.length % 2 === 1) out.push([ps[ps.length - 2], ps[ps.length - 1]]);
  }
  return out.filter(([a, b]) => !a.inDoor && !b.inDoor);
}

/** p 를 (dx, dy) 만큼 옮겨 본다. 땅·다리·상자·단단한 물건에 막히면 가로와 세로를 따로 막힌 데까지만 옮긴다. */
function ropeShift(w: World, p: Player, dx: number, dy: number) {
  if (p.on && dy > 0) dy = 0;   // 딛고 선 사람을 땅 속으로 당기지 않는다
  const inside = hitsBridge(w, p);
  const free = (x: number, y: number) => !blocked(w, { x, y, w: p.w, h: p.h }, inside, p) && x >= 0 && x + p.w <= w.stage.cols * T;
  for (const [ax, ay] of [[dx, 0], [0, dy]] as const) {
    if (!ax && !ay) continue;
    if (free(p.x + ax, p.y + ay)) { p.x += ax; p.y += ay; continue; }
    const n = Math.ceil(Math.abs(ax + ay)), sx = ax / n, sy = ay / n;
    let k = 0;
    for (; k < n && free(p.x + sx, p.y + sy); k++) { p.x += sx; p.y += sy; }
    // 공중에 매달려 벽 쪽으로 끌리면 벽을 타고 조금씩 올라간다(턱 끝으로 끌어 올려지게)
    if (ax && k < n && !p.on && ay === 0) for (let up = 0; up < 2 && free(p.x, p.y - 1); up++) { p.y -= 1; p.vy = Math.min(p.vy, 0); }
  }
}

/**
 * 줄보다 멀어진 짝을 서로 당긴다. 땅을 딛고 가만히 선 쪽은 거의 끌려가지 않아서(버팀) 매달린 친구를 붙잡아 주고,
 * 걸어서 멀어지면 매달린 친구를 끌어 올린다. 되살아나 멀리 떨어진 짝(줄 길이의 세 배 넘게)은 걸어서 다가올 때까지 당기지 않는다.
 */
function ropeTick(w: World) {
  const r = w.stage.rope;
  if (!r) return;
  const max = r.length * T, links = ropeLinks(w);
  const mid = (p: Player) => [p.x + p.w / 2, p.y + p.h / 2] as const;
  for (let it = 0; it < 3; it++) for (const [a, b] of links) {
    let [ax, ay] = mid(a), [bx, by] = mid(b);
    let d = Math.hypot(bx - ax, by - ay);
    if (d <= max || d > max * 3) continue;
    // 끌려가는 정도: 공중 1, 걸어가는 중 0.3, 땅에 버티고 선 사람 0.05
    const grip = (p: Player) => (!p.on ? 1 : p.want ? 0.3 : 0.05);
    const wa = grip(a), wb = grip(b), sum = wa + wb;
    // 한 번 맞출 때 3px, 한 걸음(세 번)에 9px 까지만 당긴다(짝이 새로 묶이거나 문에서 나온 순간 한 번에 휙 끌려가지 않게)
    const ux = (bx - ax) / d, uy = (by - ay) / d, ex = Math.min(3, d - max);
    ropeShift(w, a, ux * ex * wa / sum, uy * ex * wa / sum);
    ropeShift(w, b, -ux * ex * wb / sum, -uy * ex * wb / sum);
    // 한쪽이 벽에 막혀 덜 갔으면 남은 만큼 다른 쪽이 끌려간다
    const target = d - ex;   // 이번 걸음에 닿을 거리
    for (const q of [b, a]) {
      [ax, ay] = mid(a); [bx, by] = mid(b);
      d = Math.hypot(bx - ax, by - ay);
      if (d <= target + 0.01) break;
      const e = d - target, vx = (bx - ax) / d, vy = (by - ay) / d;
      if (q === b) ropeShift(w, b, -vx * e, -vy * e); else ropeShift(w, a, vx * e, vy * e);
    }
    // 서로 멀어지는 세로 속도는 줄이 받아 낸다(매달린 친구가 계속 빨라지며 떨어지지 않게)
    const rel = (b.vy - a.vy) * uy;
    if (rel > 0) { a.vy += uy * rel * wa / sum; b.vy -= uy * rel * wb / sum; }
  }
}

/**
 * 상자를 d 쪽으로 미는 사람들. 처리 순서와 상관없이 맞닿음으로만 센다:
 * 상자 면에 붙어 그쪽을 누르는 사람, 그리고 그 사람 등에 붙어 같은 쪽을 누르는 사람(줄 서서 밀기).
 * 줄 가운데 누군가 누르지 않으면 그 뒤는 세지 않는다.
 */
function pushers(w: World, ci: number, d: -1 | 1): Player[] {
  const b = w.crates[ci], GAP = 1.6;
  const cand = w.players.filter(p => !p.inDoor && p.want === d);
  const vert = (a: Rect, c: Rect) => a.y + a.h > c.y + 2 && a.y < c.y + c.h - 2;
  const front = (p: Player) => (d > 0 ? p.x + p.w : p.x), back = (p: Player) => (d > 0 ? p.x : p.x + p.w);
  const edge = d > 0 ? b.x : b.x + b.w;
  // 상자 위에 선 친구가 미는 쪽 끝으로 걸쳐 있으면 그 친구의 몸이 상자 면 앞을 막는다. 그 친구 등에 붙어 누르는 사람도 상자를 미는 것으로 센다.
  const riders = w.players.filter(p => !p.inDoor && p.on && Math.abs(p.y + p.h - b.y) < 2 && (d > 0 ? p.x < b.x && p.x + p.w > b.x : p.x + p.w > b.x + b.w && p.x < b.x + b.w));
  const chain = cand.filter(p => !riders.includes(p) && (vert(p, b) && Math.abs(front(p) - edge) <= GAP || riders.some(r => vert(p, r) && Math.abs(front(p) - back(r)) <= GAP)));
  for (let grew = true; grew;) {
    grew = false;
    for (const q of cand) if (!chain.includes(q) && !riders.includes(q) && chain.some(s => vert(q, s) && Math.abs(front(q) - back(s)) <= GAP)) { chain.push(q); grew = true; }
  }
  return chain;
}

// ---------- 그래프 장치에 넘기는 판의 모습 ----------
/** 판 점(x, y)이 땅이나 켜진 다리 안인가. */
function solidPoint(w: World, x: number, y: number) {
  const c = Math.floor(x / T), r = Math.floor(y / T);
  if (tileSolid(w, c, r)) return true;
  for (const b of w.stage.bridges) if (bridgeSolid(w, b.ch, b.mode) && b.cells.some(([bc, br]) => bc === c && br === r)) return true;
  return false;
}
export function hostOf(w: World): Host {
  const n = w.players.length;
  return { stageW: w.stage.cols * T, stageH: w.stage.rows * T, solidAt: (x, y) => solidPoint(w, x, y), players: w.players, need: (k: number) => resolveNeed(k, n) };
}

export type Action = GAction;
/** 지금 자리에서 확인을 누르면 일어날 일(화면의 안내 글과 실제 동작이 같은 판단을 쓴다). */
export function actionAt(w: World, p: Player): Action | null {
  if (p.inDoor || atDoor(w, p)) return null;
  return graphActionAt(w.stage.graph, w.g, hostOf(w), p.i);
}

/** 열린 문 앞에 서 있는가(확인을 누르면 들어갈 수 있는 자리). */
export function atDoor(w: World, p: Player) {
  const d = w.stage.door!;
  return w.doorOpen && !p.inDoor && overlap(p, { x: d.x + 6, y: d.y + 20, w: d.w - 12, h: d.h - 20 });
}

/** 방장이 내보내고 나머지가 받아 그리는 세계 요약(작게). */
export type Snapshot = {
  t: number; open: boolean; won: boolean; act: string[]; pr: number[];
  key: [number, number, number, number];           // x, y, 든 사람(-1 없음), 쓴 여부
  cr: [number, number, number][];                  // x, y, 미는 사람 수
  pl: [number, number, number, number, number][];  // x, y, vx, 상태 비트, 걷기
};

export function snapshot(w: World): Snapshot {
  return {
    t: +w.t.toFixed(2), open: w.doorOpen, won: w.won, act: [...w.active], pr: w.pressed.slice(),
    key: [Math.round(w.key.x), Math.round(w.key.y), w.key.holder ?? -1, w.key.used ? 1 : 0],
    cr: w.crates.map(c => [Math.round(c.x * 10) / 10, Math.round(c.y), c.pushers]),
    pl: w.players.map(p => [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10, Math.round(p.vx), (p.on ? 1 : 0) | (p.inDoor ? 2 : 0) | (p.side === 'left' ? 4 : p.side === 'right' ? 8 : 0) | (p.turnT > 0 ? 16 : 0) | (p.small ? 32 : 0), Math.round(p.walk * 10) / 10]),
  };
}
