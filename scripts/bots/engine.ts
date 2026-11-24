/**
 * '깰 수 있는지' 봇. 판(platform/sim.ts)을 그대로 굴려 스테이지를 2명·8명·30명으로 끝까지 깨 본다.
 * 팩에는 아무것도 더 적지 않아도 된다(팩은 자료만). 봇은 판이 아는 장치만 쓴다:
 *   단추에 필요한 만큼 서 있기 · 상자 밀기 · 친구 머리 딛기(한 명) · 열쇠 · 문.
 *   그래프 공장 장치가 있는 스테이지는 봇이 식을 모르므로 '확인 못 함'으로 알린다(그 스테이지는 tests/ 의 풀이 시험이 본다).
 * 할 일의 차례는 봇이 찾는다: 해 볼 수 있는 일을 하나씩 실제로 굴려 보고, 나아지면 그 뒤를 잇고 막히면 되돌아간다.
 * 회로판(접점에 서서 전구 켜기)이 여는 다리가 있는 스테이지에서 막히면 '확인 못 함'으로 알린다.
 * 친구 둘 이상을 쌓아야 닿는 자리처럼 봇이 못 하는 길만 남으면 '확인 못 함'으로 알린다(통과·실패로 꾸미지 않는다).
 * 브로콜리 검사(아무렇게나 누르는 봇이 깨면 안 된다)와는 목적이 다르다: 이것은 '풀 수 있게 만들어졌나'만 본다.
 */
import { createWorld, step, PW, PH, type Pad, type World } from '../../platform/sim';
import { T, type Rect, type Stage } from '../../platform/stage';
import { Nav, STAY, navSignature, padsOf, type NavEdge, type NavNode, type Seg } from './nav';

const DT = 1 / 60;
const DEBUG = typeof process !== 'undefined' && !!process.env.BOT_DEBUG;
const dbg = (...a: unknown[]) => { if (DEBUG) console.log('  ·', ...a); };
type Hold = { pi: number; x: number };
type State = { w: World; holds: Map<number, Hold[]>; depth: number; did: string[] };
/** soft: 길은 있는데 봇이 움직이다 못 한 것(사람이 붐비거나 시간이 모자람). 이런 실패가 남으면 '못 깸'으로 단정하지 않는다. */
type Outcome = { ok: boolean; why?: string; soft?: boolean };
type Job = Generator<Pad, boolean, void>;
type Director = Generator<void, Outcome, void>;

export type Verdict = 'pass' | 'stuck' | 'unknown';
export type StageRun = { people: number; verdict: Verdict; seconds: number; note: string; steps: string[]; ms: number };

const navCache = new WeakMap<Stage, Map<string, Nav>>();
function navOf(stage: Stage, active: Set<string>, crates: Rect[]) {
  let m = navCache.get(stage);
  if (!m) { m = new Map(); navCache.set(stage, m); }
  const sig = navSignature(active, crates);
  let nav = m.get(sig);
  if (!nav) { nav = new Nav(stage, active, crates); m.set(sig, nav); }
  return nav;
}

function cloneWorld(w: World): World {
  const { stage, ...rest } = w;
  return { ...(structuredClone(rest) as Omit<World, 'stage'>), stage } as World;
}
const cloneState = (s: State): State => ({ w: cloneWorld(s.w), holds: new Map([...s.holds].map(([k, v]) => [k, v.map(h => ({ ...h }))])), depth: s.depth, did: [...s.did] });

const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const bodyAt = (n: NavNode): Rect => ({ x: n.x, y: n.feet - PH, w: PW, h: PH });

// ---------- 이름(알림 글) ----------
const btnName = (st: Stage, bi: number) => `단추 '${st.buttons[bi].ch}'`;
const crateName = (st: Stage, ci: number) => `상자 '${st.crates[ci].ch}'`;

/**
 * 한 번 굴리기. 사람마다 맡은 일(Job)이 걸음마다 조작을 하나씩 내고, 감독(Director)이 일을 나눠 주고 끝을 본다.
 * 단추를 지키는 사람(holds)은 매번 '그 자리로 가서 서 있기'로 다시 맡긴다(굴리기를 나눠도 이어지게).
 */
class Run {
  jobs = new Map<number, { gen: Job; kind: 'hold' | 'move' }>();
  results = new Map<number, boolean>();
  frames = 0;
  constructor(public s: State, public deadline = Infinity) {
    for (const [bi, hs] of s.holds) for (const h of hs) this.spawn(h.pi, holdJob(this, h.pi, bi, h.x), 'hold');
  }
  get w() { return this.s.w; }
  spawn(i: number, gen: Job, kind: 'hold' | 'move' = 'move') { this.jobs.set(i, { gen, kind }); this.results.delete(i); }
  cancel(i: number) { this.jobs.delete(i); }
  busy(i: number) { return this.jobs.has(i); }
  holder(i: number) { for (const hs of this.s.holds.values()) if (hs.some(h => h.pi === i)) return true; return false; }

  /** 움직이지 않는 사람(맡은 일이 없거나 단추를 지키는 사람)이 밟고 있는 단추로 켜진 다리. exclude 는 빼고 센다. */
  sustained(exclude: number[] = []): Set<string> {
    const w = this.w, st = w.stage, act = new Set<string>();
    st.buttons.forEach((btn, bi) => {
      const n = w.players.filter(p => !exclude.includes(p.i) && !p.inDoor && p.on && (!this.jobs.has(p.i) || this.jobs.get(p.i)!.kind === 'hold') && overlap({ x: p.x, y: p.y + 2, w: p.w, h: p.h }, btn)).length;
      if (n >= w.needs[bi]) for (const ch of btn.opens) act.add(ch);
    });
    st.things.goals.forEach((g, gi) => { if (w.h.counts[gi] >= g.need) for (const ch of g.opens) act.add(ch); });
    return act;
  }
  nav(exclude: number[] = []) { return navOf(this.w.stage, this.sustained(exclude), this.w.crates); }
  nodeOf(i: number, nav: Nav) { const p = this.w.players[i]; return p.on ? nav.nodeAt(p.x, p.y + PH) : null; }

  /** 감독이 끝날 때까지 굴린다. limit 은 게임 속 초. */
  drive(dir: Director, limit: number): Outcome {
    const w = this.w;
    for (;;) {
      const r = dir.next();
      if (r.done) return r.value;
      if (this.frames++ > limit * 60 || (this.frames % 600 === 0 && performance.now() > this.deadline)) return { ok: false, soft: true, why: '시간 안에 끝나지 않았어요' };
      const pads = w.players.map(p => {
        const j = this.jobs.get(p.i);
        if (!j) return STAY;
        const r2 = j.gen.next();
        if (r2.done) { this.jobs.delete(p.i); this.results.set(p.i, r2.value); return STAY; }
        return r2.value;
      });
      step(w, pads, DT);
      if (w.won) return { ok: true };
    }
  }
}

function* wait(frames: number): Generator<void, void, void> { for (let f = 0; f < frames; f++) yield; }
function* until(cond: () => boolean, frames: number): Generator<void, boolean, void> { for (let f = 0; f < frames; f++) { if (cond()) return true; yield; } return cond(); }
/** 한 사람에게 일을 맡기고 끝날 때까지 기다린다. */
function* doJob(run: Run, i: number, gen: Job, frames = 60 * 60): Generator<void, boolean, void> {
  run.spawn(i, gen);
  for (let f = 0; f < frames && run.busy(i); f++) yield;
  if (run.busy(i)) { run.cancel(i); return false; }
  return run.results.get(i) ?? false;
}

// ---------- 몸 움직이기(Job) ----------

/** x 까지 걷는다. 친구에게 막히면 뛰어넘는다(hop=false 면 뛰지 않는다). */
function* walkX(run: Run, i: number, x: number, hop = true, frames = 240): Job {
  const p = run.w.players[i];
  let still = 0, px = p.x;
  for (let f = 0; f < frames; f++) {
    const dx = x - p.x;
    if (Math.abs(dx) <= 1.45 && p.on) return true;
    still = p.on && Math.abs(p.x - px) < 0.01 ? still + 1 : 0; px = p.x;
    const jump = hop && still >= 4 && !p.jumpHeld;
    if (jump) still = 0;
    yield { m: Math.abs(dx) <= 1.45 ? 0 : dx > 0 ? 1 : -1, j: jump };
  }
  return false;
}

/** 길 토막을 시작하기 전에 칸 한가운데로 선다. 친구에게 막혀 못 가도 반 칸 안이면 그 자리에서 시작한다(좁은 데서 서로 비켜 줄 수 없다). */
function* align(run: Run, i: number, x: number): Job {
  if (yield* walkX(run, i, x, false, 50)) return true;
  if (Math.abs(run.w.players[i].x - x) < T / 2) return run.w.players[i].on;
  return yield* walkX(run, i, x, true, 150);
}

function* settle(run: Run, i: number, frames = 150): Job {
  const p = run.w.players[i];
  for (let f = 0; f < frames; f++) { if (p.on && p.vy === 0 && !p.jumpHeld) return true; yield STAY; }
  return p.on;
}

/** 길 한 토막을 그대로 따라 한다. 걷다가 친구에게 막히면 뛰어넘는다. */
function* replay(run: Run, i: number, segs: Seg[]): Job {
  const p = run.w.players[i];
  if (p.jumpHeld) yield STAY;
  yield STAY;
  let px = p.x, still = 0;
  for (const pad of padsOf(segs)) {
    still = p.on && pad.m && Math.abs(p.x - px) < 0.01 ? still + 1 : 0; px = p.x;
    yield still >= 3 && !pad.j ? { m: pad.m, j: true } : pad;
  }
  return yield* settle(run, i);
}

/** goal 칸까지 간다. 길이 없으면 친구 한 명의 머리를 딛는 길을 찾는다(boost). */
function* goTo(run: Run, i: number, goal: (n: NavNode) => boolean, opts: { boost?: boolean; tries?: number } = {}): Job {
  const p = run.w.players[i];
  let fails = 0;
  for (let step = 0; step < 80; step++) {
    if (p.inDoor) return false;
    if (!(yield* settle(run, i, 240))) return false;
    const nav = run.nav([i]), cur = run.nodeOf(i, nav);
    if (cur && goal(cur)) return true;
    if (!cur) {   // 칸 사이(친구 머리 위 등): 가장 가까운 칸 쪽으로 조금 걷는다
      const near = nav.nodes.filter(n => Math.abs(n.feet - (p.y + PH)) < 3 * T).sort((a, b) => Math.abs(a.x - p.x) - Math.abs(b.x - p.x))[0];
      if (!near || !(yield* walkX(run, i, near.x, true, 60))) { if (++fails > (opts.tries ?? 6)) return false; }
      continue;
    }
    let path = nav.path(cur, goal, 0);
    if (!path && opts.boost) path = nav.path(cur, goal, 1, helperReach(run, i, nav));
    if (!path) { dbg('길 없음', i, cur.c, cur.feet); return false; }
    const e = path[0];
    const ok = e.boost ? yield* boostEdge(run, i, nav, e) : (yield* align(run, i, nav.nodes[e.from].x)) && (yield* replay(run, i, e.segs));
    const now = run.nodeOf(i, run.nav([i]));
    if (!ok || !now || now.id !== e.to) { dbg('어긋남', i, `${nav.nodes[e.from].c}/${nav.nodes[e.from].feet}->${nav.nodes[e.to].c}/${nav.nodes[e.to].feet}`, e.boost ? 'boost' : '', 'now', now && `${now.c}/${now.feet}`, Math.round(p.x), Math.round(p.y + PH)); if (++fails > (opts.tries ?? 6)) return false; }
  }
  return false;
}

/** 친구를 at 칸에 세우고, 그 머리 위로 올라가 뛴다. */
function* boostEdge(run: Run, i: number, nav: Nav, e: NavEdge): Job {
  const b = e.boost!, at = nav.nodes[b.at], p = run.w.players[i];
  const h = pickHelper(run, i, at);
  if (h == null) return false;
  const hp = run.w.players[h];
  let release = false;
  const help: Job = (function* () {
    if (hp.inDoor) { yield STAY; yield { m: 0, j: false, a: true }; yield STAY; }   // 문 안에 있던 친구가 나와서 돕는다
    if (!(yield* goTo(run, h, n => n.id === at.id))) return false;
    if (!(yield* walkX(run, h, at.x))) return false;
    while (!release) yield STAY;
    return true;
  })();
  run.spawn(h, help);
  // 받쳐 줄 친구가 자리에 설 때까지 기다린다(그동안 길을 비켜 서 있는다)
  for (let f = 0; f < 60 * 40; f++) {
    if (!run.busy(h)) return false;
    if (hp.on && Math.abs(hp.x - at.x) <= 1.5 && Math.abs(hp.y + PH - at.feet) < 0.5) break;
    yield STAY;
  }
  if (!(Math.abs(hp.x - at.x) <= 1.5)) { run.cancel(h); return false; }
  let ok = (yield* walkX(run, i, nav.nodes[e.from].x)) && (yield* replay(run, i, b.hop));
  ok = ok && p.on && Math.abs(p.y + PH - hp.y) < 0.5;
  if (ok) {
    // 친구 머리 한가운데로 한 걸음씩 맞춘 뒤(길을 잴 때와 같게) 뛴다
    for (let f = 0; f < 40 && Math.abs(hp.x - p.x) > 1.5; f++) { if (!p.on) break; yield { m: hp.x > p.x ? 1 : -1, j: false }; }
    ok = p.on && (yield* replay(run, i, e.segs));
  }
  release = true;
  yield STAY;
  run.cancel(h);
  return ok;
}

/** i 를 받쳐 줄 수 있는 친구들이 걸어서 닿는 칸(문이 열렸으면 문 안에서 나올 친구도 센다). */
function helperReach(run: Run, i: number, nav: Nav): (id: number) => boolean {
  const w = run.w, starts: NavNode[] = [];
  for (const q of w.players) {
    if (q.i === i || run.holder(q.i) || (run.busy(q.i) && run.jobs.get(q.i)!.kind !== 'move')) continue;
    if (q.inDoor) { if (w.doorOpen) starts.push(...nav.nodes.filter(doorInner(w))); continue; }
    const n = run.nodeOf(q.i, nav); if (n) starts.push(n);
  }
  const set = nav.reach(starts);
  return id => set.has(id);
}

/** 머리를 빌려줄 친구: 단추를 지키지 않는, 그 칸에 가장 빨리 닿는 사람. 밖에 없으면 문 안에서 불러낸다. */
function pickHelper(run: Run, i: number, at: NavNode): number | null {
  const w = run.w;
  let best: number | null = null, bestCost = Infinity;
  for (const q of w.players) {
    if (q.i === i || q.inDoor || run.holder(q.i) || run.busy(q.i)) continue;
    const nav = run.nav([i, q.i]), cur = run.nodeOf(q.i, nav);
    if (!cur) continue;
    const c = nav.cost(cur, n => n.id === at.id) + (covered(w, q.i) ? 3000 : 0);
    if (c < bestCost) { bestCost = c; best = q.i; }
  }
  if (best == null) best = w.players.find(q => q.i !== i && !q.inDoor && !run.holder(q.i) && !run.busy(q.i))?.i ?? null;
  if (best == null && w.doorOpen) best = w.players.find(q => q.inDoor)?.i ?? null;
  return best;
}

/** 단추 위 자리로 가서 계속 서 있는다. 밀려나면 다시 간다. */
function* holdJob(run: Run, i: number, bi: number, x: number): Job {
  const p = run.w.players[i], btn = run.w.stage.buttons[bi];
  const onBtn = () => p.on && overlap({ x: p.x, y: p.y + 2, w: p.w, h: p.h }, btn);
  for (;;) {
    if (p.inDoor) return false;
    if (!onBtn() || Math.abs(p.x - x) > 3) {
      const ok = (yield* goTo(run, i, n => Math.abs(n.feet - (btn.y + btn.h)) < 1 && n.x + PW > btn.x && n.x < btn.x + btn.w, { tries: 3 })) && (yield* walkX(run, i, x));
      if (!ok) { for (let f = 0; f < 120; f++) yield STAY; continue; }
    }
    yield STAY;
  }
}

// ---------- 할 일(Director) ----------

type Macro = { name: string; run: (r: Run) => Director; limit: number };

const keyGoal = (w: World) => (n: NavNode) => { const k = w.key; return overlap(bodyAt(n), { x: k.x, y: k.y, w: 32, h: 18 }); };
const doorGoal = (w: World) => (n: NavNode) => overlap(bodyAt(n), w.stage.door!);
const doorInner = (w: World) => (n: NavNode) => { const d = w.stage.door!; return overlap(bodyAt(n), { x: d.x + 6, y: d.y + 20, w: d.w - 12, h: d.h - 20 }); };

/** 일을 맡을 수 있는 사람(문 밖, 단추 안 지킴, 다른 일 없음)을 goal 까지 걸리는 시간 순으로. */
function freeBy(run: Run, goal: (n: NavNode) => boolean, opts: { boost?: boolean; skip?: number[]; avoidKey?: boolean } = {}) {
  const w = run.w, out: { i: number; cost: number; boost: boolean }[] = [];
  for (const p of w.players) {
    if (p.inDoor || run.holder(p.i) || run.busy(p.i) || opts.skip?.includes(p.i)) continue;
    const nav = run.nav([p.i]), cur = run.nodeOf(p.i, nav);
    if (!cur) continue;
    let c = nav.cost(cur, goal, 0);
    const boost = c === Infinity;
    if (boost && opts.boost) c = nav.cost(cur, goal, 1, helperReach(run, p.i, nav)) + 600;
    if (c === Infinity) continue;
    if (opts.avoidKey && w.key.holder === p.i) c += 5000;
    if (onAnyButton(w, p.i)) c += 300;
    if (covered(w, p.i)) c += 3000;
    c += (p.y / T) * 0.01;   // 같으면 위에 선(쌓인 줄 맨 위) 사람부터
    out.push({ i: p.i, cost: c, boost });
  }
  return out.sort((a, b) => a.cost - b.cost);
}
/** 머리 위에 친구가 서 있다(그러면 뛰지 못한다). */
const covered = (w: World, i: number) => { const p = w.players[i]; return w.players.some(q => q !== p && !q.inDoor && q.on && Math.abs(q.y + q.h - p.y) < 1 && q.x < p.x + p.w && q.x + q.w > p.x); };
const onAnyButton = (w: World, i: number) => { const p = w.players[i]; return w.stage.buttons.some(b => p.on && overlap({ x: p.x, y: p.y + 2, w: p.w, h: p.h }, b)); };

function fetchKey(): Macro {
  return {
    name: '열쇠 줍기', limit: 120,
    run: function* (run) {
      const w = run.w, goal = keyGoal(w);
      const who = freeBy(run, goal, { boost: true });
      if (!who.length) return { ok: false, why: '열쇠까지 가는 길을 못 찾았어요' };
      const i = who[0].i;
      run.spawn(i, goTo(run, i, goal, { boost: true }));
      const got = yield* until(() => w.key.holder != null, 120 * 60 - 10);
      run.cancel(i);
      return got ? { ok: true } : { ok: false, soft: true, why: '열쇠까지 가는 길을 못 찾았어요' };
    },
  };
}

function deliverKey(): Macro {
  return {
    name: '열쇠를 문으로', limit: 120,
    run: function* (run) {
      const w = run.w, i = w.key.holder!;
      { const nav = run.nav([i]), cur = run.nodeOf(i, nav); if (cur && nav.cost(cur, doorGoal(w), 1, helperReach(run, i, nav)) === Infinity && nav.cost(cur, doorGoal(w), 0) === Infinity) return { ok: false, why: '열쇠를 든 도름이가 문까지 가는 길이 없어요' }; }
      for (const [bi, hs] of run.s.holds) { const k = hs.findIndex(h => h.pi === i); if (k >= 0) { hs.splice(k, 1); if (!hs.length) run.s.holds.delete(bi); run.cancel(i); } }
      run.spawn(i, goTo(run, i, doorGoal(w), { boost: true }));
      const ok = yield* until(() => w.doorOpen, 120 * 60 - 10);
      run.cancel(i);
      return ok ? { ok: true } : { ok: false, soft: true, why: '열쇠를 든 도름이가 문까지 가다 막혔어요' };
    },
  };
}

/** 단추 위에 설 수 있는 자리들(가운데부터). 걸쳐 서도 눌린다. */
function buttonSpots(w: World, bi: number) {
  const btn = w.stage.buttons[bi], feet = btn.y + btn.h, out: number[] = [];
  for (let x = btn.x - PW + 3; x <= btn.x + btn.w - 3; x += 23) {
    const r = { x, y: feet - PH, w: PW, h: PH };
    const c0 = Math.floor(x / T), c1 = Math.floor((x + PW - 0.01) / T), row = Math.floor((feet - PH) / T);
    let ok = x >= 0 && x + PW <= w.stage.cols * T && !w.crates.some(c => overlap(r, c));
    for (let rr = row; ok && rr < feet / T; rr++) for (let c = c0; c <= c1; c++) if (w.stage.solid[rr * w.stage.cols + c]) ok = false;
    for (let c = c0; ok && c <= c1; c++) if (!w.stage.solid[(feet / T) * w.stage.cols + c]) ok = c >= Math.floor(btn.x / T) && c <= Math.floor((btn.x + btn.w) / T);
    if (ok) out.push(x);
  }
  const mid = btn.x + btn.w / 2 - PW / 2;
  return out.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid));
}

function holdButton(bi: number, skip: number[] = []): Macro {
  return {
    name: '', limit: 240,
    run: function* (run) {
      const w = run.w, btn = w.stage.buttons[bi], need = w.needs[bi];
      const goal = (n: NavNode) => Math.abs(n.feet - (btn.y + btn.h)) < 1 && n.x + PW > btn.x - 2 && n.x < btn.x + btn.w + 2;
      const spots = buttonSpots(w, bi);
      if (spots.length < need) return { ok: false, why: `${btnName(w.stage, bi)}: ${need}명이 서야 하는데 설 자리가 ${spots.length}곳뿐이에요` };
      const who = freeBy(run, goal, { avoidKey: true, skip });
      if (who.length < need) return { ok: false, why: who.length ? `${btnName(w.stage, bi)}: ${need}명이 서야 하는데 ${who.length}명만 갈 수 있어요` : `${btnName(w.stage, bi)}까지 가는 길이 없어요` };
      const mine = spots.slice(0, need);
      const fromLeft = w.players[who[0].i].x < btn.x;
      mine.sort((a, b) => (fromLeft ? b - a : a - b));   // 먼저 온 사람이 안쪽 깊은 자리로
      const holds: Hold[] = [];
      for (let k = 0; k < need; k++) {
        const i = who[k].i;
        const ok = yield* doJob(run, i, (function* () { return (yield* goTo(run, i, goal)) && (yield* walkX(run, i, mine[k])); })(), 60 * 60);
        if (!ok) return { ok: false, soft: true, why: `${btnName(w.stage, bi)}: 자리까지 가지 못했어요` };
        holds.push({ pi: i, x: mine[k] });
        run.s.holds.set(bi, holds.slice());
        run.spawn(i, holdJob(run, i, bi, mine[k]), 'hold');
      }
      const ok = yield* until(() => w.pressed[bi] >= need, 120);
      if (!ok) { run.s.holds.delete(bi); return { ok: false, soft: true, why: `${btnName(w.stage, bi)}: ${need}명이 서도 눌리지 않았어요` }; }
      yield* wait(20);
      return { ok: true };
    },
  };
}

/** 여러 단추를 함께 밟고 서 있는다(받침 다리가 여럿인 상자를 떨어뜨릴 때처럼, 하나씩 밟아서는 아무 일도 안 생길 때). */
function holdButtons(bis: number[]): Macro {
  return {
    name: '', limit: 360,
    run: function* (run) {
      for (const bi of bis) {
        if (run.s.holds.has(bi)) continue;
        const r = yield* holdButton(bi).run(run);
        if (!r.ok) return r;
      }
      return { ok: true };
    },
  };
}

function releaseButton(bi: number): Macro {
  return {
    name: '', limit: 5,
    run: function* (run) { for (const h of run.s.holds.get(bi) ?? []) run.cancel(h.pi); run.s.holds.delete(bi); yield* wait(30); return { ok: true }; },
  };
}

function pushCrate(ci: number, d: -1 | 1): Macro {
  return {
    name: '', limit: 150,
    run: function* (run) {
      const w = run.w, b = w.crates[ci], need = b.need, feet = b.y + b.h, x0 = b.x, name = `${crateName(w.stage, ci)}(${d > 0 ? '오른쪽' : '왼쪽'}으로)`;
      const face = d > 0 ? b.x : b.x + b.w, span = (need + 4) * 24 + T;
      const lane = (n: NavNode) => Math.abs(n.feet - feet) < 1 && (d > 0 ? n.x + PW <= face + 1 && n.x + PW > face - span : n.x >= face - 1 && n.x < face + span);
      // 미는 줄에 서 있는 단추 지킴이도 같이 민다(가만히 서 있으면 줄이 끊긴다)
      const inLane = [...run.s.holds.values()].flat().filter(h => { const p = w.players[h.pi]; return Math.abs(p.y + PH - feet) < 1 && (d > 0 ? p.x < face && p.x > face - span : p.x > face && p.x < face + span); }).map(h => h.pi);
      const who = freeBy(run, lane).map(o => o.i);
      if (who.length + inLane.length < need) return { ok: false, why: who.length + inLane.length ? `${name}: ${need}명이 밀어야 하는데 ${who.length + inLane.length}명만 상자 옆에 갈 수 있어요` : `${name}: 상자 옆으로 가는 길이 없어요` };
      const press = (i: number): Job => (function* () { for (;;) yield { m: d, j: false }; })();
      const pushers: number[] = [];
      for (const i of inLane) { pushers.push(i); run.spawn(i, press(i)); }
      let k = 0;
      const addOne = function* () {
        const i = who[k++];
        const ok = yield* doJob(run, i, goTo(run, i, lane), 40 * 60);
        if (ok) { pushers.push(i); run.spawn(i, press(i)); yield* wait(25); }
      };
      while (pushers.length < need && k < who.length) yield* addOne();
      // 상자가 멈출 때까지 민다. 안 움직이면 사람을 더 붙인다.
      let last = b.x, still = 0, moved = false;
      for (let f = 0; f < 120 * 60; f++) {
        yield;
        if (Math.abs(b.x - last) > 0.01 || b.vy !== 0) { still = 0; moved = moved || Math.abs(b.x - x0) > 1; last = b.x; continue; }
        if (++still < 90) continue;
        if (moved) break;
        if (k < who.length) { yield* addOne(); yield* addOne(); still = 0; continue; }
        break;
      }
      for (const i of pushers) run.cancel(i);
      for (const [bi, hs] of run.s.holds) for (const h of hs) if (inLane.includes(h.pi)) run.spawn(h.pi, holdJob(run, h.pi, bi, h.x), 'hold');
      yield* wait(30);
      if (Math.abs(b.x - x0) < T / 2) return { ok: false, soft: true, why: `${name}: ${pushers.length}명이 붙어 밀어도 움직이지 않았어요` };
      return { ok: true };
    },
  };
}

/** 문이 열렸다: 모두 들어간다. 단추를 지키는 사람은 맨 나중에, 떠나면 길이 끊기면 다른 사람이 건너편 단추를 대신 지킨다. */
function evacuate(): Macro {
  return {
    name: '모두 문으로', limit: 900,
    run: function* (run) {
      const w = run.w, st = w.stage, inner = doorInner(w);
      const enter = (i: number): Job => (function* () {
        const p = w.players[i];
        if (!(yield* goTo(run, i, inner, { boost: true }))) return false;
        for (let f = 0; f < 120 && !p.inDoor; f++) yield { m: 0, j: false, a: f % 2 === 0 };
        return p.inDoor;
      })();
      const failed = new Set<number>(), tries = new Map<number, number>();
      const reaches = (i: number, exclude: number[]) => { const nav = run.nav([i, ...exclude]), cur = run.nodeOf(i, nav); return !!cur && !!nav.path(cur, inner, 1, helperReach(run, i, nav)); };
      // 문 쪽에서 나와 도울 친구만 셀 때도 닿는가(같은 쪽 친구가 받쳐 주면 그 친구가 마지막에 남는다)
      const reachesFromDoor = (i: number) => {
        const nav = run.nav([i]), cur = run.nodeOf(i, nav);
        if (!cur) return false;
        const help = nav.reach(nav.nodes.filter(inner));
        return !!nav.path(cur, inner, 1, id => help.has(id));
      };
      let fewest = Infinity, flat = 0;
      for (let round = 0; round < w.players.length * 6 && !w.won; round++) {
        const out = w.players.filter(p => !p.inDoor);
        if (performance.now() > run.deadline) return { ok: false, soft: true, why: '시간 안에 끝나지 않았어요' };
        // 여러 차례 지나도 밖에 남은 사람이 줄지 않으면(나왔다 들어갔다만 되풀이) 그만한다
        if (out.length < fewest) { fewest = out.length; flat = 0; } else if (++flat > 8) return { ok: false, soft: true, why: `문은 열었지만 ${out.length}명이 문 앞에서 엉켜 끝까지 못 들어갔어요` };
        const free = freeBy(run, inner, { boost: true, skip: [...failed] });
        if (free.length) {
          // 걸리는 시간 순으로 조금씩 사이를 두고 함께 보낸다(한 번에 여섯 명까지)
          // 친구 머리를 딛어야 하는 사람은 혼자 간다(여럿이 한꺼번에 몰리면 탑처럼 쌓여 엉킨다)
          const queue = free.map(o => ({ i: o.i, boost: o.boost })), going: number[] = [];
          let gap = 0, entered = 0, solo = false;
          for (let f = 0; f < 240 * 60 && (queue.length || going.length); f++) {
            for (let k = going.length - 1; k >= 0; k--) if (!run.busy(going[k])) { const i = going[k]; going.splice(k, 1); if (run.results.get(i)) entered++; else { failed.add(i); tries.set(i, (tries.get(i) ?? 0) + 1); } }
            if (!going.length) solo = false;
            if (queue.length && !solo && going.length < 6 && --gap <= 0 && (!queue[0].boost || !going.length)) {
              const { i, boost } = queue.shift()!; run.spawn(i, enter(i)); going.push(i); gap = 20; solo = boost;
            }
            yield;
          }
          for (const i of going) { run.cancel(i); failed.add(i); }
          dbg(`문으로 한 차례: ${free.length}명 보내 ${entered}명 들어감, 밖에 ${w.players.filter(p => !p.inDoor).length}명 (게임 ${Math.round(w.t)}초)`);
          if (entered) failed.clear();   // 누가 들어가면 길이 비니 막혔던 사람도 다시 해 본다
          continue;
        }
        // 친구들에게 막혀 못 갔던 사람은 몇 번 더 해 본다
        const retry = [...failed].filter(i => (tries.get(i) ?? 0) < 3 && !run.holder(i) && !w.players[i].inDoor);
        if (retry.length) { for (const i of retry) failed.delete(i); continue; }
        // 단추 지킴이는 자기가 떠나도 남은 사람 모두가 갈 수 있을 때만 들어간다
        const waiting = out.filter(p => !run.holder(p.i)).map(p => p.i);
        let progressed = false;
        release: for (const [bi, hs] of [...run.s.holds]) for (const h of [...hs]) {
          if (!reaches(h.pi, []) || waiting.some(i => reaches(i, []) && !reaches(i, [h.pi]))) continue;
          hs.splice(hs.indexOf(h), 1); if (!hs.length) run.s.holds.delete(bi);
          run.cancel(h.pi); failed.delete(h.pi); tries.delete(h.pi); progressed = true;
          break release;
        }
        if (progressed) continue;
        // 길이 끊긴 사람이 있다: 그 길을 여는 단추를 문 안에서 불러낸 사람(모자라면 밖의 다른 사람)이 대신 지킨다
        const stranded = out.filter(p => !reaches(p.i, [])).map(p => p.i).concat([...run.s.holds.values()].flat().map(h => h.pi));
        for (let b2 = 0; b2 < st.buttons.length && !progressed; b2++) {
          if (run.s.holds.has(b2)) continue;
          const act = run.sustained(); for (const ch of st.buttons[b2].opens) act.add(ch);
          const nav2 = navOf(st, act, w.crates);
          const helps = stranded.some(i => { const cur = run.nodeOf(i, nav2); return !!cur && nav2.cost(cur, inner, 1, helperReach(run, i, nav2)) < Infinity; });
          if (!helps) continue;
          const need = w.needs[b2];
          const callOut = w.players.filter(p => p.inDoor).slice(0, need).map(p => p.i);
          for (const i of callOut) run.spawn(i, (function* () { yield STAY; yield { m: 0, j: false, a: true } as Pad; yield* settle(run, i); return true; })());
          yield* wait(12);
          const r = yield* holdButton(b2, stranded).run(run);
          dbg('대신 지키기', btnName(st, b2), r.ok ? '됨' : r.why);
          if (r.ok) { progressed = true; for (const i of stranded) { failed.delete(i); tries.delete(i); } }
        }
        if (!progressed) {
          dbg('못 들어간 사람', out.map(p => `${p.i}@${Math.round(p.x)},${Math.round(p.y + PH)}${run.holder(p.i) ? '(지킴)' : ''}${reaches(p.i, []) ? '(길 있음)' : ''}`).join(' '));
          const onBtn = out.map(p => w.stage.buttons.findIndex(b => p.on && overlap({ x: p.x, y: p.y + 2, w: p.w, h: p.h }, b))).filter(b => b >= 0);
          const tip = onBtn.length ? `(${btnName(st, onBtn[0])} 위의 도름이가 떠나면 길이 끊겨요. 건너편에도 같은 다리를 여는 단추가 있어야 마지막 사람이 건너와요)` : '';
          return { ok: false, soft: out.some(p => reachesFromDoor(p.i)), why: `문은 열었지만 ${out.length}명이 문까지 가는 길을 못 찾았어요${tip}` };
        }
      }
      return w.won ? { ok: true } : { ok: false, soft: true, why: '문은 열었지만 모두 들어가지 못했어요' };
    },
  };
}

// ---------- 차례 찾기 ----------

function signature(s: State) {
  const w = s.w;
  return [
    [...s.holds.keys()].sort().join(','), w.key.holder != null ? 1 : 0, w.doorOpen ? 1 : 0,
    w.crates.map(c => `${Math.round(c.x / 10)},${Math.round(c.y / 10)}`).join(';'),
  ].join('|');
}

function candidates(s: State): Macro[] {
  const w = s.w, st = w.stage, out: Macro[] = [];
  if (w.doorOpen) return [evacuate()];
  // 열쇠를 든 사람이 친구 머리를 딛어야만 문에 닿으면, 마지막 사람도 그 턱을 못 넘기 쉽다. 그럴 때는 상자·단추를 먼저 해 본다.
  let deliverLate = false;
  if (w.key.holder != null) {
    const r0 = new Run(cloneState(s)), nav = r0.nav([w.key.holder]), cur = r0.nodeOf(w.key.holder, nav);
    deliverLate = !cur || !nav.path(cur, doorGoal(w), 0);
    if (!deliverLate) out.push(deliverKey());
  } else out.push(fetchKey());
  const run = new Run(cloneState(s)), act = run.sustained();
  st.buttons.forEach((btn, bi) => {
    if (s.holds.has(bi)) return;
    const changes = btn.opens.some(ch => !act.has(ch));
    if (changes) out.push(Object.assign(holdButton(bi), { name: `${btnName(st, bi)} 밟고 서 있기` }));
  });
  // 상자를 받친 사라지는 다리가 서로 다른 단추에 이어져 있으면, 그 단추들을 함께 밟는 일을 하나로 해 본다
  w.crates.forEach((b, ci) => {
    const under = st.bridges.filter(br => br.mode === 'vanish' && br.cells.some(([c, r]) => r * T === b.y + b.h && (c + 1) * T > b.x && c * T < b.x + b.w));
    const bis = st.buttons.map((btn, bi) => (btn.opens.some(ch => under.some(br => br.ch === ch)) ? bi : -1)).filter(bi => bi >= 0 && !s.holds.has(bi));
    if (bis.length > 1) out.push(Object.assign(holdButtons(bis), { name: `${bis.map(bi => btnName(st, bi)).join('와 ')} 함께 밟기` }));
  });
  w.crates.forEach((b, ci) => {
    for (const d of [1, -1] as const) {
      const r = { x: b.x + d * 2, y: b.y, w: b.w, h: b.h - 1 };
      let wall = false;
      for (let rr = Math.floor(r.y / T); rr <= Math.floor((r.y + r.h) / T); rr++) for (let c = Math.floor(r.x / T); c <= Math.floor((r.x + r.w - 0.01) / T); c++) if (c < 0 || c >= st.cols || (rr >= 0 && rr < st.rows && st.solid[rr * st.cols + c])) wall = true;
      if (!wall) out.push(Object.assign(pushCrate(ci, d), { name: `${crateName(st, ci)} ${d > 0 ? '오른쪽' : '왼쪽'}으로 밀기` }));
    }
  });
  if (deliverLate) out.push(deliverKey());
  for (const bi of s.holds.keys()) out.push(Object.assign(releaseButton(bi), { name: `${btnName(st, bi)}에서 내려오기` }));
  return out;
}

function runMacro(s: State, m: Macro, deadline = Infinity): Outcome {
  const run = new Run(s, deadline);
  const r = run.drive(m.run(run), m.limit);
  for (const [i, j] of [...run.jobs]) if (j.kind !== 'hold') run.cancel(i);
  if (!s.w.won) run.drive((function* () { yield* wait(30); return { ok: true }; })(), 2);
  return r;
}

/** 단추를 지키는 사람이 없는 처음 상태에서 열쇠·문에 가는 길이 친구 여럿을 쌓아야만 생기는가(봇은 한 명만 딛는다). */
function needsTower(s: State): boolean {
  const run = new Run(cloneState(s)), w = run.w;
  const free = w.players.filter(p => !p.inDoor && !run.holder(p.i));
  if (free.length < 3) return false;
  const nav = run.nav(), goal = w.key.holder != null ? doorGoal(w) : keyGoal(w);
  const starts = free.map(p => run.nodeOf(p.i, nav)).filter((n): n is NavNode => !!n);
  for (const st of starts.slice(0, 3)) {
    if (nav.path(st, goal, 1)) return false;
    if (nav.path(st, goal, Math.min(3, free.length - 1))) return true;
  }
  return false;
}

/** 확인할 인원: 팩의 가장 적은 인원, 8명, 가장 많은 인원(30명까지). 겹치면 한 번만. */
export function peopleFor(players: { min: number; max: number }): number[] {
  const lo = Math.max(1, players.min), hi = Math.min(30, players.max);
  return [...new Set([lo, Math.min(hi, Math.max(lo, 8)), hi])];
}

const whereOf = (s: State) => (s.w.doorOpen ? '문은 열었지만 모두 들어가지 못했어요' : s.w.key.holder != null ? '열쇠는 주웠지만 문을 열지 못했어요' : s.did.length ? '열쇠를 줍지 못했어요' : '아무것도 못 했어요');

export type PlayOpts = { seed?: number; budgetMs?: number; maxTries?: number };

/** 스테이지 하나를 people 명으로 끝까지 깨 본다. */
export function playStage(stage: Stage, people: number, opts: PlayOpts = {}): StageRun {
  const t0 = performance.now(), budget = opts.budgetMs ?? 8000;
  if (stage.graph.factories.length) return { people, verdict: 'unknown', seconds: 0, note: `${people}명: 그래프 공장 스테이지는 봇이 식을 몰라 확인하지 못해요. 사람이 직접 깨 보고, 풀이 시험(tests/graph-factory.test.ts)이 끝까지 가는지 봐요.`, steps: [], ms: 0 };
  const w = createWorld(stage, Array.from({ length: people }, () => ({ color: '#F4F7FF' })), opts.seed ?? 1);
  for (let f = 0; f < 40; f++) step(w, [], DT);
  const start: State = { w, holds: new Map(), depth: 0, did: [] };
  const seen = new Set([signature(start)]);
  // 해 볼 일을 차례로 실제로 굴려 보고, 새 상태가 되면 그 뒤를 잇는다(깊이 먼저). 다 막히면 한 걸음 되돌아간다.
  type Frame = { s: State; cands: Macro[]; k: number; why: string[]; soft: number };
  const stack: Frame[] = [{ s: start, cands: candidates(start), k: 0, why: [], soft: 0 }];
  let best: Frame = stack[0], tries = 0;
  const score = (s: State) => (s.w.won ? 1e6 : 0) + (s.w.doorOpen ? 1e5 : 0) + (s.w.key.holder != null ? 1e4 : 0) + s.depth;
  const finish = (verdict: Verdict, note: string, s: State): StageRun => ({ people, verdict, seconds: Math.round(s.w.t), note, steps: s.did, ms: Math.round(performance.now() - t0) });
  while (stack.length) {
    if (performance.now() - t0 > budget || tries >= (opts.maxTries ?? 60)) return finish('unknown', `${people}명: 시간 안에 끝까지 확인하지 못했어요. 봇이 ${tries}가지를 해 봤고 가장 멀리 간 곳은 '${whereOf(best.s)}'예요. 이 인원은 사람이 직접 깨 보세요.`, best.s);
    const top = stack[stack.length - 1];
    if (top.k >= top.cands.length || top.s.depth >= 14) { stack.pop(); continue; }
    const m = top.cands[top.k++];
    const child = cloneState(top.s);
    tries++;
    const tm = performance.now();
    const r = runMacro(child, m, t0 + budget);
    dbg(`[${top.s.depth}] ${m.name}: ${r.ok ? '됨' : r.why} (${Math.round(performance.now() - tm)}ms, 게임 ${Math.round(child.w.t - top.s.w.t)}초)`);
    if (!r.ok) { if (r.soft) top.soft++; if (r.why && !top.why.includes(r.why)) top.why.push(r.why); continue; }
    child.depth++; child.did.push(m.name);
    if (child.w.won) return finish('pass', `${people}명: 끝까지 깼어요(게임 속 ${Math.round(child.w.t)}초).`, child);
    const sig = signature(child);
    if (seen.has(sig)) continue;
    seen.add(sig);
    const tc = performance.now();
    const f: Frame = { s: child, cands: candidates(child), k: 0, why: [], soft: 0 };
    dbg(`  다음 할 일 ${f.cands.length}가지 (${Math.round(performance.now() - tc)}ms)`);
    if (score(child) >= score(best.s)) best = f;
    stack.push(f);
  }
  const s = best.s;
  const where = whereOf(s);
  // 새 물건(things.json)은 봇이 아직 다루지 못한다: 놓는 곳을 채우거나, 튕기기·움직이는 발판·닿으면 처음 자리로 가는 길은 사람이 깨 본다
  const th = s.w.stage.things;
  if (th.kinds.some(k => k.body !== 'push')) {
    const open = th.goals.filter((g, gi) => s.w.h.counts[gi] < g.need).map(g => g.label || `'${g.ch}'`);
    return finish('unknown', `${people}명: ${where}. 새 물건이 있는 길(${th.kinds.filter(k => k.body !== 'push').map(k => k.name).join(', ')}${open.length ? `, 놓는 곳 ${open.join(', ')}` : ''})은 봇이 아직 다루지 못해요. 이 인원은 사람이 직접 깨 보세요.`, s);
  }
  // 회로판(접점에 서서 전구 켜기)도 봇이 아직 다루지 못한다: 전구가 여는 다리가 있는 스테이지에서 막히면 못 깬다고 단정하지 않는다
  const circ = s.w.stage.circuit;
  if (circ && circ.lamps.some(i => circ.parts[i].opens.length)) return finish('unknown', `${people}명: ${where}. 회로판(접점에 서서 전구 켜기)은 봇이 아직 다루지 못해요. 이 인원은 사람이 직접 깨 보세요.`, s);
  if (needsTower(s)) return finish('unknown', `${people}명: ${where}. 친구 둘 이상을 쌓아야 닿는 자리가 있는데, 봇은 친구 한 명만 딛을 수 있어요. 이 인원은 사람이 직접 깨 보세요.`, s);
  const did = s.did.length ? ` 봇이 한 일: ${s.did.join(', ')}.` : '';
  const why = best.why.length ? ` 막힌 곳: ${best.why.slice(0, 4).join(' / ')}.` : '';
  dbg('가장 멀리 간 상태', s.did.join(' > '), '막힘', best.why, 'soft', best.soft);
  // 가장 멀리 간 상태에서 해 본 일이 모두 '길이 없음'처럼 분명한 까닭으로 막혔을 때만 못 깬다고 한다
  if (best.soft || !best.why.length) return finish('unknown', `${people}명: ${where}.${did}${why} 길이 없어서인지 봇이 움직이다 막혀서인지 가리지 못했어요. 이 인원은 사람이 직접 깨 보세요.`, s);
  return finish('stuck', `${people}명: ${where}.${did}${why}`, s);
}
