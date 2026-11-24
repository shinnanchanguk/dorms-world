/**
 * 새 물건. 선생님(과 AI)이 팩의 things.json 에 '물건 종류'를 자료로 적으면, 판이 그 성질대로 움직이게 한다.
 * 팩에는 여전히 코드가 없다: 그림은 글자 그림(화풍이 하나로 유지된다), 움직임은 판이 아는 성질의 조합이다.
 *   몸(body): 지나감 · 단단함 · 발판(위에서만 딛음) · 밀림 · 들 수 있음
 *   닿으면(touch): 없음 · 모으기 · 처음 자리로 · 튕겨 올림
 *   그 밖에: 왔다 갔다 움직임 · 늘 보이는 이름표 · 다리 글자가 켜진 동안만 나타남/사라짐 · 여러 장 그림(움직이는 그림)
 * 놓는 곳(goal)은 들고 온 물건이나 모은 물건을 세어 다 차면 다리를 연다.
 * 형식 설명은 kit/STAGE_FORMAT.md '새 물건 만들기'.
 */
import { T, type Rect } from './stage';
import type { Sprite } from './sprite';
import { BEHAVIORS, type Behavior } from './behavior';

export type ThingBody = 'pass' | 'solid' | 'ledge' | 'push' | 'carry';
export type ThingTouch = 'none' | 'collect' | 'hurt' | 'bounce';
type NeedLike = number | 'half' | 'third' | 'all';

export type ThingKind = {
  id: string; name: string;
  frames: Sprite[];               // 한 장이면 멈춘 그림, 여러 장이면 0.25초마다 넘긴다
  cell: number;                   // 한 점의 크기(px). 1~3
  w: number; h: number;           // 그림의 크기(px)
  body: ThingBody; touch: ThingTouch;
  power: number;                  // 튕겨 올리는 높이(칸)
  move: { dx: number; dy: number; speed: number } | null;   // 왔다 갔다(칸, 칸/초)
  label: string;                  // 늘 보이는 이름표(없으면 '')
  need: NeedLike;                 // 밀림: 미는 데 필요한 사람 수
  with: string; without: string;  // 이 다리 글자가 켜진 동안만 있다 / 켜진 동안 사라진다
  behavior: Behavior | null;      // 선생님이 더한 새 움직임(platform/behaviors)
  opens: string[];                // 새 움직임이 켠 동안(vars[0] 이 0 이 아님) 켜지는 다리 글자
  stock: boolean;                 // 들 수 있는 물건: 처음에는 안 보이고, 움직임의 give 로만 나온다(장치가 만들어 내는 물건)
  takes: string[];                // 움직임이 받는 물건 이름들(ctx.takes)
  gives: string;                  // 움직임이 내주는 물건 이름(ctx.gives, 없으면 '')
};

/** 지도에 놓인 물건 하나(밀림 물건은 상자로 바뀌어 stage.crates 에 들어간다). x, y 는 처음 자리(그림의 왼쪽 위). */
export type ThingDef = { kind: number; x: number; y: number };
/** 놓는 곳. 받는 물건 종류(accepts)가 들어오거나 모이면 센다. need 개가 차면 opens 다리가 켜지고 꺼지지 않는다. */
export type GoalDef = Rect & { ch: string; accepts: number[]; need: number; opens: string[]; label: string; sprite: Sprite | null };
export type ThingStage = { kinds: ThingKind[]; items: ThingDef[]; goals: GoalDef[] };
export const NO_THINGS: ThingStage = { kinds: [], items: [], goals: [] };

/** 물건 하나의 지금 모습. at: 0 제자리(또는 내려놓은 자리), 1 없어짐(모았거나 놓는 곳에 넣음), 2 누가 들고 있음. */
export type ItemState = { x: number; y: number; vy: number; at: 0 | 1 | 2; holder: number; v: number[] };
export const VARS = 4;
export type ThingWorld = { items: ItemState[]; counts: number[] };

export const THING_KEYS: Record<string, string[]> = {
  thing: ['type', 'thing'],
  goal: ['type', 'accepts', 'need', 'opens', 'label', 'sprite'],
};
const KIND_KEYS = ['name', 'sprite', 'frames', 'size', 'body', 'touch', 'power', 'move', 'label', 'need', 'with', 'without', 'behavior', 'opens', 'stock', 'takes', 'gives'];
export const MAX_KINDS = 30, MAX_ITEMS = 80, MAX_GOALS = 12;

const pick = (sprites: Record<string, Sprite>, name: unknown) =>
  (typeof name === 'string' && /^[a-z0-9-]{1,40}$/.test(name) && Object.hasOwn(sprites, name) ? sprites[name] : undefined);
const isNeed = (v: unknown): v is NeedLike => v === 'half' || v === 'third' || v === 'all' || (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 30);

/** things.json 을 읽는다(팩 하나에 하나). 잘못된 곳은 쉬운 말로 알려 준다. */
export function parseKinds(json: unknown, sprites: Record<string, Sprite>): Record<string, ThingKind> {
  if (json == null) return {};
  if (typeof json !== 'object' || Array.isArray(json)) throw new Error('things.json 은 { "물건이름": { "name": "...", "sprite": "..." } } 모양이어야 해요.');
  const ids = Object.keys(json);
  if (ids.length > MAX_KINDS) throw new Error(`새 물건은 팩 하나에 ${MAX_KINDS}가지까지예요.`);
  const out: Record<string, ThingKind> = {};
  for (const id of ids) {
    if (!/^[a-z0-9-]{1,40}$/.test(id)) throw new Error(`물건 이름 "${id.slice(0, 40)}" 은 영문 소문자, 숫자, 줄표로 40자까지예요.`);
    const d = (json as Record<string, unknown>)[id] as Record<string, unknown>;
    const where = `물건 "${id}"`;
    if (!d || typeof d !== 'object' || Array.isArray(d)) throw new Error(`${where} 는 { "name": "...", "sprite": "..." } 모양이어야 해요.`);
    for (const k of Object.keys(d)) if (!KIND_KEYS.includes(k)) throw new Error(`${where} 의 "${k}" 는 모르는 칸이에요. 쓸 수 있는 칸: ${KIND_KEYS.join(', ')}.`);
    if (typeof d.name !== 'string' || !d.name.trim() || d.name.length > 10) throw new Error(`${where} 의 name 은 화면에 쓰는 이름이에요(1~10자). 예: "씨앗"`);
    const names = d.frames != null ? d.frames : [d.sprite];
    if (!Array.isArray(names) || !names.length || names.length > 4) throw new Error(`${where} 의 frames 는 그림 이름 1~4개 목록이에요.`);
    if (d.frames != null && d.sprite != null) throw new Error(`${where} 는 sprite 와 frames 가운데 하나만 적어요.`);
    const frames = names.map(n => { const sp = pick(sprites, n); if (!sp) throw new Error(`${where} 의 그림 "${String(n)}" 이 팩의 sprites 폴더에 없어요.`); return sp; });
    if (frames.some(f => f.w !== frames[0].w || f.h !== frames[0].h)) throw new Error(`${where} 의 frames 그림은 크기가 모두 같아야 해요.`);
    const cell = d.size ?? 2;
    if (cell !== 1 && cell !== 2 && cell !== 3) throw new Error(`${where} 의 size 는 한 점의 크기예요: 1, 2(기본), 3 가운데 하나.`);
    const body = (d.body ?? 'pass') as ThingBody;
    if (!['pass', 'solid', 'ledge', 'push', 'carry'].includes(body)) throw new Error(`${where} 의 body 는 "pass", "solid", "ledge", "push", "carry" 가운데 하나예요.`);
    const touch = (d.touch ?? 'none') as ThingTouch;
    if (!['none', 'collect', 'hurt', 'bounce'].includes(touch)) throw new Error(`${where} 의 touch 는 "none", "collect", "hurt", "bounce" 가운데 하나예요.`);
    if (touch !== 'none' && (body === 'push' || body === 'carry')) throw new Error(`${where}: 밀거나 드는 물건(body "${body}")에는 touch 를 적지 않아요.`);
    if (touch === 'collect' && body !== 'pass') throw new Error(`${where}: 모으는 물건(touch "collect")은 body 를 "pass" 로 둬요(닿으면 사라지니까요).`);
    const power = d.power ?? 5;
    if (touch !== 'bounce' && d.power != null) throw new Error(`${where} 의 power 는 튕기는 물건(touch "bounce")에만 적어요.`);
    if (typeof power !== 'number' || power < 2 || power > 10) throw new Error(`${where} 의 power 는 튕겨 오르는 높이(2~10칸)예요.`);
    let move: ThingKind['move'] = null;
    if (d.move != null) {
      const m = d.move as Record<string, unknown>;
      if (!m || typeof m !== 'object' || Array.isArray(m)) throw new Error(`${where} 의 move 는 { "dx": 6, "dy": 0, "speed": 2 } 모양이에요.`);
      for (const k of Object.keys(m)) if (!['dx', 'dy', 'speed'].includes(k)) throw new Error(`${where} 의 move 에는 dx, dy, speed 만 적어요.`);
      const dx = m.dx ?? 0, dy = m.dy ?? 0, speed = m.speed ?? 2;
      if (typeof dx !== 'number' || typeof dy !== 'number' || Math.abs(dx) > 20 || Math.abs(dy) > 10 || (!dx && !dy)) throw new Error(`${where} 의 move 는 가로 dx(-20~20칸), 세로 dy(-10~10칸, 아래가 +) 가운데 하나 이상을 적어요.`);
      if (typeof speed !== 'number' || speed < 0.5 || speed > 6) throw new Error(`${where} 의 move.speed 는 1초에 가는 칸 수예요(0.5~6).`);
      if (body === 'push' || body === 'carry') throw new Error(`${where}: 밀거나 드는 물건은 스스로 움직이지 않아요(move 를 빼 주세요).`);
      move = { dx, dy, speed };
    }
    const label = d.label ?? '';
    if (typeof label !== 'string' || label.length > 8) throw new Error(`${where} 의 label 은 늘 보이는 이름표예요(8자까지).`);
    const need = d.need ?? 2;
    if (d.need != null && body !== 'push') throw new Error(`${where} 의 need 는 밀리는 물건(body "push")에만 적어요.`);
    if (!isNeed(need)) throw new Error(`${where} 의 need 는 1~30 숫자나 "half", "third", "all" 이에요.`);
    for (const k of ['with', 'without'] as const) if (d[k] != null && (typeof d[k] !== 'string' || !/^[a-z0-9]$/.test(d[k] as string))) throw new Error(`${where} 의 ${k} 는 다리 글자 하나예요. 예: "x"`);
    if (d.with != null && d.without != null) throw new Error(`${where} 는 with 와 without 가운데 하나만 적어요.`);
    if ((d.with != null || d.without != null) && body === 'push') throw new Error(`${where}: 밀리는 물건은 나타났다 사라질 수 없어요(with, without 을 빼 주세요).`);
    let behavior: Behavior | null = null;
    if (d.behavior != null) {
      const name = d.behavior;
      if (typeof name !== 'string' || !/^[a-z0-9-]{1,40}$/.test(name) || !Object.hasOwn(BEHAVIORS, name)) throw new Error(`${where} 의 behavior "${String(name).slice(0, 40)}" 는 판에 없는 움직임이에요. 있는 움직임: ${Object.keys(BEHAVIORS).join(', ') || '없음'}. 새로 만들려면 kit/DEVICE_GUIDE.md '새 움직임'을 따라요.`);
      if (body === 'push' || body === 'carry') throw new Error(`${where}: 밀거나 드는 물건에는 behavior 를 붙이지 않아요.`);
      if (touch !== 'none') throw new Error(`${where}: behavior 를 붙인 물건은 touch 를 적지 않아요(닿았을 때 할 일은 움직임이 정해요).`);
      behavior = BEHAVIORS[name];
    }
    const opens = d.opens ?? [];
    if (!Array.isArray(opens) || opens.length > 8 || opens.some(o => typeof o !== 'string' || !/^[a-z0-9]$/.test(o))) throw new Error(`${where} 의 opens 는 다리 글자 목록이에요(8개까지). 예: ["x"]`);
    if (opens.length && !behavior) throw new Error(`${where} 의 opens 는 behavior 를 붙인 물건에만 적어요(다리를 켜는 때를 움직임이 정해요).`);
    if (d.stock != null && typeof d.stock !== 'boolean') throw new Error(`${where} 의 stock 은 true 나 false 예요.`);
    if (d.stock && body !== 'carry') throw new Error(`${where}: stock(장치가 만들어 내는 물건)은 들 수 있는 물건(body "carry")에만 적어요.`);
    const takes = d.takes ?? [];
    if (!Array.isArray(takes) || takes.length > 8 || takes.some(t => typeof t !== 'string' || !/^[a-z0-9-]{1,40}$/.test(t))) throw new Error(`${where} 의 takes 는 받을 물건 이름 목록이에요(8개까지). 예: ["bread"]`);
    if (d.gives != null && (typeof d.gives !== 'string' || !/^[a-z0-9-]{1,40}$/.test(d.gives))) throw new Error(`${where} 의 gives 는 내줄 물건 이름 하나예요. 예: "mush"`);
    if ((takes.length || d.gives != null) && !behavior) throw new Error(`${where} 의 takes, gives 는 behavior 를 붙인 물건에만 적어요(받고 내주는 때를 움직임이 정해요).`);
    out[id] = {
      id, name: d.name.trim(), frames, cell, w: frames[0].w * cell, h: frames[0].h * cell, body, touch, power, move, label, need,
      with: (d.with as string) ?? '', without: (d.without as string) ?? '', behavior, opens: opens as string[], stock: d.stock === true,
      takes: Object.freeze([...takes]) as string[], gives: (d.gives as string) ?? '',
    };
  }
  for (const k of Object.values(out)) {
    for (const t of k.takes) if (!Object.hasOwn(out, t) || out[t].body !== 'carry') throw new Error(`물건 "${k.id}" 의 takes "${t}" 는 things.json 의 들 수 있는 물건(body "carry")이어야 해요.`);
    if (k.gives && (!Object.hasOwn(out, k.gives) || !out[k.gives].stock)) throw new Error(`물건 "${k.id}" 의 gives "${k.gives}" 는 things.json 에 "stock": true 로 적은 들 수 있는 물건이어야 해요.`);
  }
  return out;
}

type Cells = [number, number][];
/** 지도에 놓인 thing / goal 글자를 읽는다. crates 에는 밀림 물건이 상자로 들어간다. */
export function parseThingLegend(
  ch: string, def: Record<string, unknown>, cells: Cells, at: (c: number, r: number) => string,
  kinds: Record<string, ThingKind>, sprites: Record<string, Sprite>, groups: (c: Cells) => Cells[],
  out: ThingStage, crates: { ch: string; need: NeedLike; x: number; y: number; w: number; h: number; skin?: ThingKind }[],
) {
  if (def.type === 'thing') {
    const id = def.thing;
    const kind = typeof id === 'string' && Object.hasOwn(kinds, id) ? kinds[id] : null;
    if (!kind) throw new Error(`"${ch}" 의 thing 에 things.json 의 물건 이름을 적어 주세요(있는 물건: ${Object.keys(kinds).join(', ') || '없음'}).`);
    let ki = out.kinds.indexOf(kind);
    if (ki < 0) { out.kinds.push(kind); ki = out.kinds.length - 1; }
    for (const [c, r] of cells) {
      if (kind.body === 'push') {
        // 밀리는 물건은 칸에 맞춘 상자가 된다(그림 크기를 칸으로 반올림)
        const w = Math.max(1, Math.round(kind.w / T)) * T, h = Math.max(1, Math.round(kind.h / T)) * T;
        const x = c * T, y = (r + 1) * T - h;
        for (let cc = c; cc < c + w / T; cc++) for (let rr = r - h / T + 1; rr <= r; rr++) if (at(cc, rr) === '#') throw new Error(`물건 "${kind.id}"("${ch}", 지도 ${r + 1}번째 줄 ${c + 1}번째 칸)이 땅과 겹쳐요. 그림이 오른쪽 위로 ${w / T}×${h / T}칸을 차지해요.`);
        crates.push({ ch, need: kind.need, x, y, w, h, skin: kind });
        continue;
      }
      const x = c * T, y = (r + 1) * T - kind.h;
      if (kind.body !== 'pass') {
        for (let cc = c; cc * T < x + kind.w; cc++) for (let rr = Math.floor(y / T); rr <= r; rr++) if (at(cc, rr) === '#') throw new Error(`물건 "${kind.id}"("${ch}", 지도 ${r + 1}번째 줄 ${c + 1}번째 칸)의 그림이 땅과 겹쳐요. 그림의 왼쪽 아래가 그 칸의 왼쪽 아래에 맞아요.`);
      }
      out.items.push({ kind: ki, x, y });
    }
    if (out.items.length > MAX_ITEMS) throw new Error(`새 물건은 한 스테이지에 ${MAX_ITEMS}개까지예요.`);
    return;
  }
  // goal
  const accepts = def.accepts;
  if (!Array.isArray(accepts) || !accepts.length || accepts.length > 8) throw new Error(`놓는 곳 "${ch}" 의 accepts 에 받을 물건 이름을 목록으로 적어 주세요. 예: ["seed"]`);
  const ids = accepts.map(a => {
    const k = typeof a === 'string' && Object.hasOwn(kinds, a) ? kinds[a] : null;
    if (!k) throw new Error(`놓는 곳 "${ch}" 의 accepts "${String(a)}" 는 things.json 에 없는 물건이에요.`);
    if (k.body !== 'carry' && k.touch !== 'collect') throw new Error(`놓는 곳 "${ch}" 는 들 수 있는 물건(body "carry")이나 모으는 물건(touch "collect")만 받아요("${k.id}" 는 아니에요).`);
    return k;
  });
  const opens = def.opens;
  if (!Array.isArray(opens) || !opens.length || opens.length > 8 || opens.some(o => typeof o !== 'string')) throw new Error(`놓는 곳 "${ch}" 의 opens 에 여는 다리 글자를 목록으로 적어 주세요. 예: ["x"]`);
  if (def.need != null && def.need !== 'all' && !(typeof def.need === 'number' && Number.isInteger(def.need) && def.need >= 1 && def.need <= MAX_ITEMS)) throw new Error(`놓는 곳 "${ch}" 의 need 는 채워야 하는 개수(1~${MAX_ITEMS})나 "all"(스테이지에 있는 그 물건 모두)이에요.`);
  const label = def.label ?? '';
  if (typeof label !== 'string' || label.length > 8) throw new Error(`놓는 곳 "${ch}" 의 label 은 8자까지예요.`);
  let sprite: Sprite | null = null;
  if (def.sprite != null) { sprite = pick(sprites, def.sprite) ?? null; if (!sprite) throw new Error(`놓는 곳 "${ch}" 의 sprite "${String(def.sprite)}" 그림이 팩의 sprites 폴더에 없어요.`); }
  for (const g of groups(cells)) {
    const cs = g.map(x => x[0]), rs = g.map(x => x[1]);
    const c0 = Math.min(...cs), c1 = Math.max(...cs), r0 = Math.min(...rs), r1 = Math.max(...rs);
    if (g.length !== (c1 - c0 + 1) * (r1 - r0 + 1)) throw new Error(`놓는 곳 "${ch}" 는 빈틈없는 네모로 놓아 주세요.`);
    const ki = ids.map(k => { let i = out.kinds.indexOf(k); if (i < 0) { out.kinds.push(k); i = out.kinds.length - 1; } return i; });
    out.goals.push({ ch, accepts: ki, need: def.need === 'all' || def.need == null ? -1 : def.need as number, opens: opens as string[], label, sprite, x: c0 * T, y: r0 * T, w: (c1 - c0 + 1) * T, h: (r1 - r0 + 1) * T });
  }
  if (out.goals.length > MAX_GOALS) throw new Error(`놓는 곳은 한 스테이지에 ${MAX_GOALS}개까지예요.`);
}

/** 지도를 다 읽은 뒤: need "all" 을 개수로 풀고, 여는 글자와 나타나는 글자가 다리인지 본다. */
export function finishThings(out: ThingStage, isBridge: (ch: string) => boolean) {
  for (const g of out.goals) {
    const total = out.items.filter(it => g.accepts.includes(it.kind)).length;
    if (!total) throw new Error(`놓는 곳 "${g.ch}" 가 받는 물건이 지도에 하나도 없어요.`);
    if (g.need < 0) g.need = total;
    if (g.need > total) throw new Error(`놓는 곳 "${g.ch}" 의 need(${g.need})가 지도에 놓인 그 물건 수(${total})보다 커요.`);
    for (const o of g.opens) if (!isBridge(o)) throw new Error(`놓는 곳 "${g.ch}" 가 여는 "${o}" 는 bridge 여야 해요.`);
  }
  for (const k of out.kinds) for (const o of k.opens) if (!isBridge(o)) throw new Error(`물건 "${k.id}" 가 여는 "${o}" 는 이 스테이지의 다리(bridge) 글자여야 해요.`);
  for (const k of out.kinds) for (const ch of [k.with, k.without]) if (ch && !isBridge(ch)) throw new Error(`물건 "${k.id}" 의 with/without "${ch}" 는 이 스테이지의 다리(bridge) 글자여야 해요.`);
}
/** 놓는 곳이 여는 다리 글자들(다리를 여는 것이 있는지 볼 때). */
export const thingOpens = (s: ThingStage) => new Set([...s.goals.flatMap(g => g.opens), ...s.kinds.flatMap(k => k.opens)]);

// ---------- 움직임 ----------

/** 움직임이 남긴 수는 범위 안의 유한한 수로 다듬는다(잘못 쓴 움직임이 판이나 요약을 망가뜨리지 않게). */
export const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(-1e6, Math.min(1e6, v)) : 0);

export const createThingWorld = (s: ThingStage): ThingWorld => ({
  items: s.items.map(it => { const b = s.kinds[it.kind].behavior; return { x: it.x, y: it.y, vy: 0, at: s.kinds[it.kind].stock ? 1 : 0, holder: -1, v: Array.from({ length: VARS }, (_, k) => num(b?.init?.[k])) }; }),
  counts: s.goals.map(() => 0),
});

/** 왔다 갔다 하는 물건이 t 초에 처음 자리에서 얼마나 떨어져 있나(px). 시간만으로 정해져서 모든 기기가 같은 자리를 그린다. */
export function moveOffset(k: ThingKind, t: number): [number, number] {
  if (!k.move) return [0, 0];
  const dist = Math.hypot(k.move.dx, k.move.dy);
  const phase = (t * k.move.speed / dist) % 2, f = phase < 1 ? phase : 2 - phase;
  return [Math.round(k.move.dx * T * f * 10) / 10, Math.round(k.move.dy * T * f * 10) / 10];
}

export function itemRect(s: ThingStage, tw: ThingWorld, i: number, t: number): Rect {
  const it = s.items[i], k = s.kinds[it.kind], st = tw.items[i];
  if (k.body === 'carry') return { x: st.x, y: st.y, w: k.w, h: k.h };
  if (k.behavior && !k.move) return { x: st.x, y: st.y, w: k.w, h: k.h };   // 움직임이 place 로 옮길 수 있다
  const [dx, dy] = moveOffset(k, t);
  return { x: it.x + dx, y: it.y + dy, w: k.w, h: k.h };
}

/** 지금 화면에 있는가(없어지지 않았고, 다리 글자 조건에 맞는다). */
export function itemShown(s: ThingStage, tw: ThingWorld, i: number, active: Set<string>) {
  const k = s.kinds[s.items[i].kind];
  if (tw.items[i].at === 1) return false;
  if (k.with && !active.has(k.with)) return false;
  if (k.without && active.has(k.without)) return false;
  return true;
}

const ov = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/**
 * r 이 단단한 물건에 막히는가. self 와 이미 겹친 물건은 빼서 빠져나올 수 있게 한다.
 * 발판(ledge)은 위에서 내려올 때만 막는다: fromBottom 에 움직이기 전 발바닥 높이를 주면 그보다 아래에 있는 발판 윗면만 딛는다.
 */
export function thingBlocks(s: ThingStage, tw: ThingWorld, active: Set<string>, t: number, r: Rect, self?: Rect, fromBottom?: number) {
  for (let i = 0; i < s.items.length; i++) {
    const k = s.kinds[s.items[i].kind];
    if (k.body !== 'solid' && k.body !== 'ledge') continue;
    if (!itemShown(s, tw, i, active)) continue;
    const b = itemRect(s, tw, i, t);
    if (!ov(r, b) || (self && ov(self, b))) continue;
    if (k.body === 'ledge' && (fromBottom == null || fromBottom > b.y + 0.5)) continue;
    return true;
  }
  return false;
}

/** 확인을 누르면 일어날 일(든 물건). 화면 안내와 실제 동작이 같은 판단을 쓴다. */
export type ThingAction =
  | { do: 'pick'; item: number }
  | { do: 'put'; item: number; goal: number }
  | { do: 'drop'; item: number }
  | { do: 'use'; item: number; text: string; else?: ThingAction }   // else: 움직임이 아무것도 안 했을 때 대신 할 일(든 물건 내려놓기 등)
  | { do: 'no'; why: string };

export const heldBy = (tw: ThingWorld, pi: number) => tw.items.findIndex(it => it.at === 2 && it.holder === pi);
