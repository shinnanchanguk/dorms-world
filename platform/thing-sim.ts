/**
 * 새 물건의 움직임(platform/things.ts 의 자료를 판의 물리에 잇는다).
 * sim.ts 의 걸음(tick) 안에서 세 번 불린다: 걸음 맨 앞(움직이는 발판에 탄 사람 옮기기), 단추 계산 앞(닿기·들고 놓기·떨어지기),
 * 다리 계산(놓는 곳이 연 다리).
 */
import { G, crateAt, hitsBridge, hitsTiles, overlap, respawn, type Player, type World } from './sim';
import { T, type Rect } from './stage';
import { VARS, heldBy, itemRect, itemShown, moveOffset, num, thingBlocks, type ThingAction } from './things';
import type { BehaviorCtx, BehaviorPlayer } from './behavior';
import { holdingPiece } from './graph/model';

const shown = (w: World, i: number) => itemShown(w.stage.things, w.h, i, w.active);
const rectAt = (w: World, i: number, t = w.t) => itemRect(w.stage.things, w.h, i, t);
const kindOf = (w: World, i: number) => w.stage.things.kinds[w.stage.things.items[i].kind];

/** 사람·상자가 단단한 물건에 막히는가(sim.ts 의 막힘 검사에 더해진다). */
export const thingSolidAt = (w: World, r: Rect, self?: Rect, fromBottom?: number) =>
  w.stage.things.items.length > 0 && thingBlocks(w.stage.things, w.h, w.active, w.t, r, self, fromBottom);

/** 걸음 맨 앞: 움직이는 단단한 물건·발판 위에 선 사람(과 그 위에 선 사람)을 물건과 함께 옮긴다. */
export function thingsBefore(w: World, dt: number) {
  const s = w.stage.things;
  for (let i = 0; i < s.items.length; i++) {
    const k = kindOf(w, i);
    if (!k.move || (k.body !== 'solid' && k.body !== 'ledge') || !shown(w, i)) continue;
    const a = rectAt(w, i, w.t - dt), b = rectAt(w, i);
    const dx = b.x - a.x, dy = b.y - a.y;
    if (!dx && !dy) continue;
    // 발판 위에 선 사람, 그 머리 위에 선 친구(층층이), 발판에 얹힌 물건을 함께 옮긴다
    const on = (r: Rect, top: Rect) => r.x + r.w > top.x && r.x < top.x + top.w && Math.abs(r.y + r.h - top.y) <= 2;
    const riders: Player[] = [];
    for (let grew = true, base: Rect[] = [a]; grew;) {
      grew = false;
      const next: Rect[] = [];
      for (const p of w.players) if (!p.inDoor && !riders.includes(p) && base.some(r => on(p, r))) { riders.push(p); next.push({ ...p }); grew = true; }
      base = next;
    }
    for (const p of riders) {
      const m = { x: p.x + dx, y: p.y + dy, w: p.w, h: p.h };
      if (!hitsTiles(w, m) && !hitsBridge(w, m)) { p.x = m.x; p.y = m.y; }
    }
    for (let j = 0; j < s.items.length; j++) {
      const st = w.h.items[j];
      if (j === i || st.at !== 0 || kindOf(w, j).body !== 'carry') continue;
      const r = rectAt(w, j);
      if (on(r, a)) { st.x += dx; st.y += dy; st.vy = 0; }
    }
    // 옆으로 미는 쪽에 선 사람은 밀려난다(단단한 물건 속에 묻히지 않게). 발판은 옆으로 지나가므로 밀지 않는다
    if (dx && k.body === 'solid') for (const p of w.players) {
      if (p.inDoor || !overlap(p, b) || overlap(p, a)) continue;
      const m = { x: dx > 0 ? b.x + b.w : b.x - p.w, y: p.y, w: p.w, h: p.h };
      if (!hitsTiles(w, m) && !hitsBridge(w, m)) p.x = m.x;
    }
  }
}

/** 든 물건을 내려놓을 자리: 발밑 가운데, 안 되면 몸 왼쪽·오른쪽 끝에 맞춘 자리. 땅·다리·상자·단단한 물건과 겹치면 다른 자리를 본다. */
function dropSpot(w: World, p: Player, i: number): { x: number; y: number } | null {
  const k = kindOf(w, i), y = p.y + p.h - k.h, maxX = w.stage.cols * T - k.w;
  for (const x0 of [p.x + p.w / 2 - k.w / 2, p.x, p.x + p.w - k.w]) {
    const x = Math.max(0, Math.min(maxX, x0)), r = { x, y, w: k.w, h: k.h };
    if (!hitsTiles(w, r) && !hitsBridge(w, r) && crateAt(w, r) < 0 && !thingSolidAt(w, r)) return { x, y };
  }
  return null;
}

/** 확인을 누르면 일어날 일. 화면의 안내 글과 실제 동작이 이 판단 하나를 쓴다. */
export function thingActionAt(w: World, p: Player): ThingAction | null {
  const s = w.stage.things;
  if (!s.items.length || p.inDoor) return null;
  const held = heldBy(w.h, p.i);
  if (held >= 0) {
    // 든 물건을 받는 장치(넣으면 바뀌어 나오는 위·맷돌 같은 움직임)가 가까이 있으면 그 장치를 먼저 쓴다. 장치가 아무것도 안 하면 아래 일을 한다
    const dev = nearestDevice(w, p);
    if (dev >= 0) {
      const k = kindOf(w, dev), id = kindOf(w, held).id;
      if (k.takes.includes(id)) {
        const rest = heldAction(w, p, held);
        return { do: 'use', item: dev, text: deviceText(w, dev, p), else: rest.do === 'no' ? undefined : rest };
      }
    }
    return heldAction(w, p, held);
  }
  return emptyAction(w, p);
}

/** 가장 가까운, 확인으로 쓰는 장치(움직임). 없으면 -1. */
function nearestDevice(w: World, p: Player) {
  const s = w.stage.things, reach = { x: p.x - 8, y: p.y - 6, w: p.w + 16, h: p.h + 10 };
  let use = -1, useNear = Infinity;
  for (let i = 0; i < s.items.length; i++) {
    const b = kindOf(w, i).behavior;
    if (!b?.use || w.h.items[i].at !== 0 || !shown(w, i)) continue;
    const r = rectAt(w, i);
    if (!overlap(reach, r)) continue;
    const d = Math.abs(r.x + r.w / 2 - p.x - p.w / 2);
    if (d < useNear) { useNear = d; use = i; }
  }
  return use;
}
function deviceText(w: World, i: number, p: Player) {
  let text = '';
  try { text = String(kindOf(w, i).behavior!.useText?.(readCtx(w, i), view(p)) ?? '').slice(0, 20); } catch { text = ''; }
  return text || `확인: ${kindOf(w, i).name}`;
}

/** 물건을 든 사람이 확인을 누르면: 놓는 곳에 넣거나 발밑에 내려놓는다. */
function heldAction(w: World, p: Player, held: number): ThingAction {
  const s = w.stage.things;
  {
    const ki = s.items[held].kind;
    for (let g = 0; g < s.goals.length; g++) {
      if (!overlap(p, s.goals[g])) continue;
      if (!s.goals[g].accepts.includes(ki)) return { do: 'no', why: '여기에는 놓을 수 없어요' };
      return { do: 'put', item: held, goal: g };
    }
    return dropSpot(w, p, held) ? { do: 'drop', item: held } : { do: 'no', why: '여기는 내려놓을 자리가 없어요' };
  }
}

/** 빈손인 사람이 확인을 누르면: 가까운 장치를 쓰거나 물건을 든다. */
function emptyAction(w: World, p: Player): ThingAction | null {
  const s = w.stage.things;
  // 그래프 조각·양동이를 들었거나 썰매에 탄 동안은 새 물건을 집거나 쓰지 않는다(두 개를 함께 들지 않게, 그 누름은 그래프 장치로 간다)
  const g = w.g;
  if (g && (holdingPiece(g, p.i) >= 0 || g.bucket?.holder === p.i || g.sled?.rider === p.i)) return null;
  const reach = { x: p.x - 8, y: p.y - 6, w: p.w + 16, h: p.h + 10 };
  // 선생님이 더한 움직임 가운데 확인으로 쓰는 것(가장 가까운 것 하나)
  const use = nearestDevice(w, p);
  // 발밑(몸과 겹치는 곳)에 내려놓은 물건이 있으면 장치보다 그 물건을 먼저 든다(장치 옆에 떨어뜨린 것도 다시 주울 수 있게)
  for (let i = 0; i < s.items.length; i++) {
    if (use < 0) break;
    if (kindOf(w, i).body !== 'carry' || w.h.items[i].at !== 0 || !shown(w, i)) continue;
    if (overlap(p, rectAt(w, i))) return { do: 'pick', item: i };
  }
  if (use >= 0) return { do: 'use', item: use, text: deviceText(w, use, p) };
  let best = -1, near = Infinity;
  for (let i = 0; i < s.items.length; i++) {
    if (kindOf(w, i).body !== 'carry' || w.h.items[i].at !== 0 || !shown(w, i)) continue;
    const r = rectAt(w, i);
    if (!overlap(reach, r)) continue;
    const d = Math.abs(r.x + r.w / 2 - p.x - p.w / 2);
    if (d < near) { near = d; best = i; }
  }
  return best >= 0 ? { do: 'pick', item: best } : null;
}

/** 확인 안내 글(내 화면에만). */
export function thingActionText(w: World, a: ThingAction) {
  if (a.do === 'no') return a.why;
  if (a.do === 'use') return a.text;
  const k = kindOf(w, a.item);
  if (a.do === 'pick') return `확인: ${k.name} 들기`;
  if (a.do === 'put') { const g = w.stage.things.goals[a.goal]; return g.label ? `확인: ${g.label}에 놓기` : '확인: 여기에 놓기'; }
  return '확인: 내려놓기';
}

/** 처음 자리로. 장치가 만들어 내는 물건(stock)은 다시 장치 안으로 돌아간다(안 보이고, 다시 give 로 나온다). */
const home = (w: World, i: number) => { const it = w.stage.things.items[i], st = w.h.items[i]; st.x = it.x; st.y = it.y; st.vy = 0; st.at = kindOf(w, i).stock ? 1 : 0; st.holder = -1; };

/** 든 물건을 처음 자리로 돌린다(떨어짐·문 들어감·방에서 나감). */
export function thingsRelease(w: World, pi: number) {
  const i = heldBy(w.h, pi);
  if (i >= 0) home(w, i);
}

/** 가운데 사람이 나갔다: 그 사람이 든 것은 돌려놓고, 뒤 번호를 하나씩 당긴다. */
export function thingsRemove(w: World, pi: number) {
  thingsRelease(w, pi);
  for (const st of w.h.items) if (st.at === 2 && st.holder > pi) st.holder--;
}

/** 움직임에 건네는 도름이 보기. 실제 도름이를 넘기지 않는다(움직임이 자리·문 상태를 바꿔 방 안 화면이 갈라지지 않게). 바꿀 수 있는 것은 vy 하나. */
function view(p: Player): BehaviorPlayer {
  return { x: p.x, y: p.y, w: p.w, h: p.h, get i() { return p.i; }, on: p.on, get vy() { return p.vy; }, set vy(v: number) { p.vy = Math.max(-1000, Math.min(1000, num(v))); } };
}

/** 움직임에 건네는 손잡이. 판의 상태는 이것으로만 바꾼다(움직임이 판을 망가뜨리지 않게). */
/** 움직임이 건넨 도름이를 판의 자리 번호로 바꾼다. 범위 밖이거나 정수가 아니면 -1(움직임이 판 배열의 다른 칸을 건드리지 못하게). */
const seatOf = (w: World, q: BehaviorPlayer | undefined) => { const k = q?.i; return typeof k === 'number' && Number.isInteger(k) && k >= 0 && k < w.players.length ? k : -1; };
const NO_OP = () => {};
/**
 * 그리기·안내 글용 손잡이: 읽기만 한다(useText·label·frame 은 화면마다 다른 때에 불리므로 판을 바꾸면 안 된다).
 * vars 는 사본이고, 바꾸는 손잡이는 아무 일도 하지 않는다.
 */
export function readCtx(w: World, i: number): BehaviorCtx {
  const c = ctxFor(w, i);
  return { ...c, vars: Object.freeze(w.h.items[i].v.slice()) as number[], respawn: NO_OP, launch: NO_OP, remove: NO_OP, place: NO_OP, shove: NO_OP, take: () => null, give: () => false };
}
export function ctxFor(w: World, i: number): BehaviorCtx {
  const st = w.h.items[i];
  return {
    vars: st.v, rect: rectAt(w, i), t: w.t, players: w.players.length, takes: kindOf(w, i).takes, gives: kindOf(w, i).gives,
    isOn: ch => w.active.has(ch),
    respawn: q => { const k = seatOf(w, q); if (k >= 0) respawn(w, w.players[k]); },
    launch: (q, cells) => { const k = seatOf(w, q); if (k < 0) return; const p = w.players[k]; p.vy = -Math.sqrt(2 * G * Math.max(2, Math.min(10, num(cells))) * T); p.on = false; p.coyote = 0; },
    remove: () => { st.at = 1; st.holder = -1; },
    place: (x, y) => {
      const k = kindOf(w, i);
      if (k.move) return;
      st.x = Math.max(0, Math.min(w.stage.cols * T - k.w, num(x)));
      st.y = Math.max(-2 * T, Math.min(w.stage.rows * T - k.h, num(y)));
    },
    shove: (q, px) => {
      const k = seatOf(w, q); if (k < 0) return; const p = w.players[k]; if (p.inDoor) return;
      const d = Math.max(-60, Math.min(60, num(px))), n = Math.ceil(Math.abs(d)), sx = d / Math.max(1, n);
      const free = (x: number) => { const r = { x, y: p.y, w: p.w, h: p.h }; return x >= 0 && x + p.w <= w.stage.cols * T && !hitsTiles(w, r) && !hitsBridge(w, r) && crateAt(w, r) < 0 && !thingSolidAt(w, r, p); };
      for (let k = 0; k < n && free(p.x + sx); k++) p.x += sx;
    },
    holding: q => { const k = seatOf(w, q); if (k < 0) return null; const h = heldBy(w.h, k); return h >= 0 ? kindOf(w, h).id : null; },
    take: q => {
      const k = seatOf(w, q); if (k < 0) return null;
      const h = heldBy(w.h, k); if (h < 0) return null;
      const hs = w.h.items[h]; hs.at = 1; hs.holder = -1; hs.vy = 0;
      return kindOf(w, h).id;
    },
    give: (q, thing) => {
      const k = seatOf(w, q); if (k < 0) return false;
      const p = w.players[k];
      if (p.inDoor || heldBy(w.h, k) >= 0 || typeof thing !== 'string') return false;
      if (holdingPiece(w.g, k) >= 0 || w.g.bucket?.holder === k || w.g.sled?.rider === k) return false;
      for (let j = 0; j < w.stage.things.items.length; j++) {
        const kj = kindOf(w, j), js = w.h.items[j];
        if (kj.id !== thing || !kj.stock || js.at !== 1) continue;
        js.at = 2; js.holder = k; js.vy = 0;
        js.x = p.x + p.w / 2 - kj.w / 2; js.y = p.y - kj.h - 3;
        return true;
      }
      return false;
    },
    peek: thing => {
      for (let j = 0; j < w.stage.things.items.length; j++) if (kindOf(w, j).id === thing) return w.h.items[j].v.slice();
      return null;
    },
  };
}
/** 움직임이 정한 이름표(없거나 오류면 things.json 의 label). 그리기에 쓴다. */
export function itemLabel(w: World, i: number): string {
  const k = kindOf(w, i);
  if (!k.behavior?.label) return k.label;
  try { const t = k.behavior.label(readCtx(w, i)); return t == null ? k.label : String(t).slice(0, 12); } catch { return k.label; }
}
const tidy = (v: number[]) => { v.length = VARS; for (let k = 0; k < VARS; k++) v[k] = num(v[k]); };
/** 움직임을 부른다. 움직임이 오류를 내도 판은 멈추지 않는다(그 걸음의 일만 건너뛴다). */
function call<T>(w: World, i: number, f: (ctx: BehaviorCtx) => T): T | undefined {
  try { return f(ctxFor(w, i)); } catch (err) {
    let seen = broken.get(w); if (!seen) broken.set(w, seen = new Set());
    if (!seen.has(i)) { seen.add(i); console.warn('새 움직임에서 오류가 났어요', err); }
    return undefined;
  } finally { tidy(w.h.items[i].v); }
}
const broken = new WeakMap<World, Set<number>>();   // 세계마다 물건별로 첫 오류만 알린다

const bump = (w: World, ki: number) => w.stage.things.goals.forEach((g, gi) => { if (g.accepts.includes(ki)) w.h.counts[gi]++; });

/** 놓기·내려놓기(장치가 아무것도 안 했을 때 대신 하는 일도 여기로 온다). */
function doAction(w: World, p: Player, act: ThingAction) {
  if (act.do === 'put') { const st = w.h.items[act.item]; st.at = 1; st.holder = -1; w.h.counts[act.goal]++; }
  else if (act.do === 'drop') {
    const st = w.h.items[act.item];
    const at = dropSpot(w, p, act.item);
    if (at) { st.at = 0; st.holder = -1; st.vy = 0; st.x = at.x; st.y = at.y; } else p.aNew = true;
  } else if (act.do === 'pick') { const st = w.h.items[act.item]; st.at = 2; st.holder = p.i; st.vy = 0; }
}

/** 단추 계산 앞: 닿기(모으기·처음 자리로·튕기기), 들고 놓기, 내려놓은 물건 떨어지기. */
export function thingTick(w: World, dt: number) {
  const s = w.stage.things;
  if (!s.items.length) return;
  // 들고 놓기(확인을 새로 누른 사람). 쓴 누름은 지워서 같은 누름으로 다른 장치가 또 움직이지 않게 한다
  for (const p of w.players) {
    if (!p.aNew || p.inDoor) continue;
    const act = thingActionAt(w, p);
    if (!act) continue;
    p.aNew = false;   // 쓴 누름은 지운다(움직임이 아무것도 안 했으면 아래에서 되살린다)
    if (act.do === 'pick') { const st = w.h.items[act.item]; st.at = 2; st.holder = p.i; st.vy = 0; }
    else if (act.do === 'use') {
      if (call(w, act.item, ctx => kindOf(w, act.item).behavior!.use!(ctx, view(p))) !== true) {
        if (act.else) doAction(w, p, act.else); else p.aNew = true;
      }
    }
    else doAction(w, p, act);
  }
  // 든 사람이 문에 들어가면 처음 자리로
  for (const p of w.players) if (p.inDoor) thingsRelease(w, p.i);

  for (let i = 0; i < s.items.length; i++) {
    const k = kindOf(w, i), st = w.h.items[i];
    if (st.at === 2) {   // 머리 위로 든다
      const p = w.players[st.holder];
      if (!p) { home(w, i); continue; }
      st.x = p.x + p.w / 2 - k.w / 2; st.y = p.y - k.h - 3;
      continue;
    }
    if (st.at === 1 || !shown(w, i)) continue;
    if (k.body === 'carry') {   // 내려놓은 물건은 떨어진다(땅·다리·상자·단단한 물건 위에 선다)
      const r = rectAt(w, i);
      const under = (q: Rect) => hitsTiles(w, q) || hitsBridge(w, q) || crateAt(w, q) >= 0 || thingSolidAt(w, q, undefined, r.y + r.h);
      if (!under({ x: r.x + 1, y: r.y + r.h, w: r.w - 2, h: 1 })) {
        st.vy = Math.min(st.vy + G * dt, 600);
        let ny = st.y + st.vy * dt;
        for (let y = st.y; y < ny; y += 1) if (under({ x: r.x + 1, y: y + 1, w: r.w - 2, h: r.h })) { ny = Math.ceil(y + r.h - 1e-6) - r.h; st.vy = 0; break; }
        st.y = ny;
        if (st.y > w.stage.rows * T + 60) home(w, i);
      } else st.vy = 0;
      continue;
    }
    if (k.behavior?.tick) {
      const r = rectAt(w, i);
      const touching = w.players.filter(p => !p.inDoor && (overlap(p, r) || (p.on && p.x + p.w > r.x && p.x < r.x + r.w && Math.abs(p.y + p.h - r.y) < 2)));
      call(w, i, ctx => k.behavior!.tick!(ctx, dt, touching.map(view)));
    }
    if (k.touch === 'none') continue;
    const r = rectAt(w, i);
    for (const p of w.players) {
      if (p.inDoor) continue;
      if (k.touch === 'collect') {
        if (overlap(p, r)) { st.at = 1; bump(w, s.items[i].kind); break; }
      } else if (k.touch === 'hurt') {
        if (overlap(p, { x: r.x + 3, y: r.y + 3, w: r.w - 6, h: r.h - 3 })) respawn(w, p);
      } else {   // 튕기기: 단단한 물건·발판은 윗면을 딛었을 때, 지나가는 물건은 닿았을 때(내려오는 중)
        const top = k.body === 'pass' ? overlap(p, r) && p.vy >= 0 : p.on && p.x + p.w > r.x && p.x < r.x + r.w && Math.abs(p.y + p.h - r.y) < 2;
        if (top) { p.vy = -Math.sqrt(2 * G * k.power * T); p.on = false; p.coyote = 0; }
      }
    }
  }
}

/** 놓는 곳이 다 차서 켜는 다리 글자(꺼지지 않는다). */
export function thingActive(w: World, add: (ch: string) => void) {
  w.stage.things.goals.forEach((g, gi) => { if (w.h.counts[gi] >= g.need) for (const ch of g.opens) add(ch); });
  w.stage.things.items.forEach((it, i) => { const k = w.stage.things.kinds[it.kind]; if (k.opens.length && w.h.items[i].at !== 1 && w.h.items[i].v[0]) for (const ch of k.opens) add(ch); });
}

/** 시작 자리를 고를 때 피할 자리(물건과 놓는 곳). */
export function thingAvoid(st: World['stage'], me: Rect) {
  const s = st.things;
  for (const it of s.items) { const k = s.kinds[it.kind]; if (overlap(me, { x: it.x - 3, y: it.y - 3, w: k.w + 6, h: k.h + 6 })) return true; }
  for (const g of s.goals) if (overlap(me, g)) return true;
  return false;
}

/** 그리기용: 움직이는 물건의 지금 어긋남(시간으로만 정해진다). */
export const thingOffset = moveOffset;
