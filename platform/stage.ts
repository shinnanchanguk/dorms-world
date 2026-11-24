/**
 * 스테이지 읽기. 글자 지도(NN.map.txt)와 장치 값(NN.json)을 판이 쓰는 모양으로 바꾼다.
 * 형식 설명은 kit/STAGE_FORMAT.md. 잘못된 곳은 쉬운 한국어로 알려 준다.
 */
import { buildCircuit, type CircuitDef, type PartKind } from './circuit';
import { emptyGraphStage, type GraphStage } from './graph/model';
import { GRAPH_KEYS, finishGraph, parseGraphLegend, type GraphLegend } from './graph/legend';
import type { Sprite } from './sprite';
import { NO_THINGS, THING_KEYS, finishThings, parseThingLegend, thingOpens, type ThingKind, type ThingStage } from './things';

export const T = 30;

export type Need = number | 'half' | 'third' | 'all';
export type Rect = { x: number; y: number; w: number; h: number };

export type LegendEntry =
  | { type: 'button'; need?: Need; opens?: string[] }
  | { type: 'bridge'; mode?: 'appear' | 'vanish' }
  | { type: 'crate'; need?: Need }
  | { type: 'sign'; texts?: string[] }
  | { type: 'deco'; sprite?: string }
  | { type: 'thing'; thing?: string }
  | { type: 'goal'; accepts?: string[]; need?: number | 'all'; opens?: string[]; label?: string; sprite?: string }
  | GraphLegend
  | { type: 'wire' }
  | { type: 'source' }
  | { type: 'lamp'; opens?: string[]; when?: 'bright' | 'on' }
  | { type: 'contact' };

export type StageJson = { legend?: Record<string, LegendEntry>; hint?: string };

export type Button = Rect & { ch: string; need: Need; opens: string[] };
export type Bridge = { ch: string; mode: 'appear' | 'vanish'; cells: [number, number][] };
export type CrateDef = Rect & { ch: string; need: Need; skin?: ThingKind };   // skin: things.json 의 밀리는 물건(그림·이름)
export type Sign = { x: number; y: number; texts: string[] };
/** 꾸밈 그림. 부딪히지 않고 도름이 뒤에 그려진다. x, y 는 그림의 왼쪽 위. */
export type Deco = { x: number; y: number; sprite: Sprite };

export type Stage = {
  cols: number; rows: number;
  solid: Uint8Array;
  spawn: { x: number; y: number };
  key: { x: number; y: number } | null;
  door: Rect | null;
  buttons: Button[];
  bridges: Bridge[];
  crates: CrateDef[];
  signs: Sign[];
  decos: Deco[];
  graph: GraphStage;
  things: ThingStage;   // things.json 으로 만든 새 물건과 놓는 곳
  /** 회로판(전선 · 전지 · 전구 · 접점). 없으면 null. */
  circuit: CircuitDef | null;
  hint: string;
};

export function resolveNeed(need: Need, players: number): number {
  const n = Math.max(1, players);
  if (need === 'all') return n;
  if (need === 'half') return Math.max(1, Math.ceil(n / 2));
  if (need === 'third') return Math.max(1, Math.ceil(n / 3));
  return Math.max(1, Math.min(n, Math.floor(need)));
}

const validNeed = (v: unknown): v is Need => v === 'half' || v === 'third' || v === 'all' || (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 30);

/** 옆·위아래로 붙은 같은 글자 칸을 한 덩어리로 묶는다. */
function groups(cells: [number, number][]): [number, number][][] {
  const key = (c: number, r: number) => `${c},${r}`;
  const left = new Map(cells.map(([c, r]) => [key(c, r), [c, r] as [number, number]]));
  const out: [number, number][][] = [];
  while (left.size) {
    const first = left.values().next().value as [number, number];
    left.delete(key(first[0], first[1]));
    const g = [first]; const q = [first];
    while (q.length) {
      const [c, r] = q.pop()!;
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const k = key(c + dc, r + dr); const n = left.get(k);
        if (n) { left.delete(k); g.push(n); q.push(n); }
      }
    }
    out.push(g);
  }
  return out;
}

/** 이름으로 그림을 찾는다. 팩이 적은 이름은 남이 쓴 글이라 모양을 보고, 그림 목록이 직접 가진 이름만 받는다(constructor 같은 이름으로 엉뚱한 값을 꺼내지 못하게). */
const pickSprite = (sprites: Record<string, Sprite>, name: unknown): Sprite | undefined =>
  (typeof name === 'string' && /^[a-z0-9-]{1,40}$/.test(name) && Object.hasOwn(sprites, name) ? sprites[name] : undefined);

/** sprites: 그 팩의 글자 그림(이름 → 그림). 스테이지가 그림을 쓰면 여기서 찾는다. */
export function parseStage(mapText: string, json: StageJson = {}, sprites: Record<string, Sprite> = {}, kinds: Record<string, ThingKind> = {}): Stage {
  const lines = mapText.replace(/^\uFEFF/, '').replace(/\r/g, '').split('\n').filter((l, i, a) => l.length > 0 || (i > 0 && i < a.length - 1));
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (!lines.length) throw new Error('지도가 비어 있어요.');
  const cols = lines[0].length, rows = lines.length;
  if (cols < 20 || cols > 80) throw new Error(`지도 가로는 20~80칸이어야 해요(지금 ${cols}칸).`);
  if (rows < 12 || rows > 18) throw new Error(`지도 세로는 12~18칸이어야 해요(지금 ${rows}칸).`);
  lines.forEach((l, i) => { if (l.length !== cols) throw new Error(`지도 ${i + 1}번째 줄 길이가 달라요(${l.length}칸, 첫 줄은 ${cols}칸).`); });

  if (json === null || typeof json !== 'object' || Array.isArray(json)) throw new Error('NN.json 은 { "legend": { ... } } 모양이어야 해요.');
  for (const k of Object.keys(json)) if (k !== 'legend' && k !== 'hint') throw new Error(`NN.json 의 "${k}" 는 모르는 칸이에요. legend, hint 만 쓸 수 있어요.`);
  if (json.hint != null && (typeof json.hint !== 'string' || json.hint.length > 60)) throw new Error('hint 는 60자까지의 한 줄이에요.');
  const legend = json.legend ?? {};
  if (legend === null || typeof legend !== 'object' || Array.isArray(legend)) throw new Error('legend 는 { "a": { "type": ... } } 모양이어야 해요.');
  const KEYS: Record<string, string[]> = { button: ['type', 'need', 'opens'], bridge: ['type', 'mode'], crate: ['type', 'need'], sign: ['type', 'texts'], deco: ['type', 'sprite'], wire: ['type'], source: ['type'], lamp: ['type', 'opens', 'when'], contact: ['type'], ...GRAPH_KEYS, ...THING_KEYS };
  const TYPES = Object.keys(KEYS).join(', ');
  for (const [ch, def] of Object.entries(legend) as [string, unknown][]) {
    if (def === null || typeof def !== 'object' || Array.isArray(def)) throw new Error(`legend 의 "${ch}" 는 { "type": "button" } 같은 모양이어야 해요.`);
    const type = (def as { type?: unknown }).type;
    if (typeof type !== 'string' || !Object.hasOwn(KEYS, type)) throw new Error(`"${ch}" 의 type 을 모르겠어요. ${TYPES} 가운데 하나예요.`);
    for (const k of Object.keys(def)) if (!KEYS[type].includes(k)) throw new Error(`"${ch}"(${type})의 "${k}" 는 모르는 칸이에요. 쓸 수 있는 칸: ${KEYS[type].join(', ')}.`);
  }
  for (const ch of Object.keys(legend)) if (!/^[a-z0-9]$/.test(ch)) throw new Error(`장치 글자는 영문 소문자나 숫자 한 글자여야 해요: "${ch}"`);

  const solid = new Uint8Array(cols * rows);
  let spawn: Stage['spawn'] | null = null, key: Stage['key'] = null, door: Stage['door'] = null;
  const found = new Map<string, [number, number][]>();
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const ch = lines[r][c];
    if (ch === '#') solid[r * cols + c] = 1;
    else if (ch === '.' || ch === ' ') continue;
    else if (ch === '@') { if (spawn) throw new Error('시작 자리(@)는 한 곳만 둘 수 있어요.'); spawn = { x: c * T, y: (r + 1) * T }; }
    else if (ch === 'K') { if (key) throw new Error('열쇠(K)는 하나만 둘 수 있어요.'); key = { x: c * T - 1, y: r * T + 10 }; }
    else if (ch === 'D') { if (door) throw new Error('문(D)은 하나만 둘 수 있어요.'); door = { x: c * T, y: (r - 2) * T, w: 2 * T, h: 3 * T }; if (r < 2 || c + 1 >= cols) throw new Error('문(D)은 가로 2칸, 세로 3칸 자리가 필요해요. D 는 문의 왼쪽 아래 칸이에요.'); }
    else if (legend[ch]) { if (!found.has(ch)) found.set(ch, []); found.get(ch)!.push([c, r]); }
    else throw new Error(`지도 ${r + 1}번째 줄 ${c + 1}번째 칸의 "${ch}" 는 뜻을 모르는 글자예요. NN.json 의 legend 에 적어 주세요.`);
  }
  if (!spawn) throw new Error('시작 자리(@)가 없어요.');
  if (!key) throw new Error('열쇠(K)가 없어요.');
  if (!door) throw new Error('문(D)이 없어요.');

  const at = (c: number, r: number) => (c < 0 || c >= cols || r < 0 ? '#' : r >= rows ? '.' : lines[r][c]);
  const sc = spawn.x / T, sr = spawn.y / T - 1;
  if (at(sc, sr - 1) === '#') throw new Error('시작 자리(@) 바로 위가 땅이에요. 도름이 키가 한 칸보다 커서 위 칸이 비어 있어야 해요.');
  if (at(sc, sr + 1) !== '#') throw new Error('시작 자리(@) 바로 아래는 땅(#)이어야 해요.');
  const dc = door.x / T, dr = door.y / T;
  for (let r = dr; r < dr + 3; r++) for (let c = dc; c < dc + 2; c++) if (at(c, r) !== '.' && at(c, r) !== 'D' && at(c, r) !== ' ') throw new Error('문(D)이 놓일 가로 2칸, 세로 3칸은 빈칸이어야 해요(D 는 왼쪽 아래 칸).');
  if (at(dc, dr + 3) !== '#' || at(dc + 1, dr + 3) !== '#') throw new Error('문(D) 바로 아래 두 칸은 땅(#)이어야 해요.');

  const buttons: Button[] = [], bridges: Bridge[] = [], crates: CrateDef[] = [], signs: Sign[] = [];
  const decos: Deco[] = [];
  const graph = emptyGraphStage();
  const things: ThingStage = { kinds: [], items: [], goals: [] };
  const wiring: { ch: string; kind: 'wire' | PartKind; cells: [number, number][]; opens: string[]; when: 'bright' | 'on' }[] = [];
  for (const [ch, def] of Object.entries(legend)) {
    const cells = found.get(ch);
    if (!cells) throw new Error(`legend 의 "${ch}" 가 지도에 없어요.`);
    if (def.type === 'button') {
      const need = def.need ?? 1;
      if (!validNeed(need)) throw new Error(`단추 "${ch}" 의 need 는 1~30 숫자나 "half", "third", "all" 이어야 해요.`);
      const opens = def.opens ?? [];
      if (!Array.isArray(opens) || !opens.length || opens.length > 8 || opens.some(o => typeof o !== 'string')) throw new Error(`단추 "${ch}" 의 opens 에 여는 다리 글자를 목록으로 적어 주세요(8개까지). 예: ["x"]`);
      for (const o of opens) if (legend[o]?.type !== 'bridge') throw new Error(`단추 "${ch}" 가 여는 "${o}" 는 bridge 여야 해요.`);
      for (const g of groups(cells)) {
        const cs = g.map(x => x[0]), r = g[0][1];
        if (g.some(x => x[1] !== r)) throw new Error(`단추 "${ch}" 는 옆으로만 이어 놓을 수 있어요.`);
        for (const [bc] of g) if (at(bc, r + 1) !== '#') throw new Error(`단추 "${ch}" 바로 아래는 땅(#)이어야 해요(지도 ${r + 1}번째 줄 ${bc + 1}번째 칸).`);
        const c0 = Math.min(...cs), c1 = Math.max(...cs);
        buttons.push({ ch, need, opens, x: c0 * T + 3, y: (r + 1) * T - 8, w: (c1 - c0 + 1) * T - 6, h: 8 });
      }
    } else if (def.type === 'bridge') {
      if (def.mode != null && def.mode !== 'appear' && def.mode !== 'vanish') throw new Error(`다리 "${ch}" 의 mode 는 "appear" 나 "vanish" 예요.`);
      bridges.push({ ch, mode: def.mode === 'vanish' ? 'vanish' : 'appear', cells });
    } else if (def.type === 'crate') {
      const need = def.need ?? 2;
      if (!validNeed(need)) throw new Error(`상자 "${ch}" 의 need 는 1~30 숫자나 "half", "third", "all" 이어야 해요.`);
      for (const g of groups(cells)) {
        const cs = g.map(x => x[0]), rs = g.map(x => x[1]);
        const c0 = Math.min(...cs), c1 = Math.max(...cs), r0 = Math.min(...rs), r1 = Math.max(...rs);
        if (g.length !== (c1 - c0 + 1) * (r1 - r0 + 1)) throw new Error(`상자 "${ch}" 는 빈틈없는 네모여야 해요.`);
        crates.push({ ch, need, x: c0 * T, y: r0 * T, w: (c1 - c0 + 1) * T, h: (r1 - r0 + 1) * T });
      }
    } else if (def.type === 'sign') {
      if (!Array.isArray(def.texts)) throw new Error(`표지 "${ch}" 의 texts 는 글 목록이어야 해요. 예: ["첫째 글", "둘째 글"]`);
      const texts = def.texts.map(String);
      if (!texts.length) throw new Error(`표지 "${ch}" 에 글(texts)이 없어요.`);
      if (texts.length > 10) throw new Error(`표지 "${ch}" 의 글은 10개까지예요.`);
      for (const t of texts) if (t.length > 40) throw new Error(`표지 "${ch}" 의 글은 40자까지예요: "${t.slice(0, 12)}…"`);
      for (const [c, r] of cells) signs.push({ x: c * T, y: r * T, texts });
    } else if (def.type === 'deco') {
      const sp = pickSprite(sprites, def.sprite);
      if (!sp) throw new Error(`꾸밈 "${ch}" 의 sprite "${String(def.sprite)}" 그림이 팩의 sprites 폴더에 없어요.`);
      // 글자를 놓은 칸의 왼쪽 아래에 그림의 왼쪽 아래를 맞춘다(한 점이 2px)
      for (const [c, r] of cells) decos.push({ x: c * T, y: (r + 1) * T - sp.h * 2, sprite: sp });
      if (decos.length > 60) throw new Error('꾸밈 그림은 한 스테이지에 60개까지예요.');
    } else if (def.type === 'wire' || def.type === 'source' || def.type === 'contact') {
      wiring.push({ ch, kind: def.type, cells, opens: [], when: 'bright' });
    } else if (def.type === 'lamp') {
      const opens = def.opens ?? [];
      if (!Array.isArray(opens) || opens.length > 8 || opens.some(o => typeof o !== 'string')) throw new Error(`전구 "${ch}" 의 opens 는 다리 글자 목록이에요(8개까지). 예: ["x"]`);
      for (const o of opens) if (legend[o]?.type !== 'bridge') throw new Error(`전구 "${ch}" 가 여는 "${o}" 는 bridge 여야 해요.`);
      if (def.when != null && def.when !== 'bright' && def.when !== 'on') throw new Error(`전구 "${ch}" 의 when 은 "bright"(밝게 켜지면 연다, 기본)나 "on"(어둡게라도 켜지면 연다)이에요.`);
      wiring.push({ ch, kind: 'lamp', cells, opens, when: def.when === 'on' ? 'on' : 'bright' });
    } else if (def.type === 'thing' || def.type === 'goal') {
      parseThingLegend(ch, def as Record<string, unknown>, cells, at, kinds, sprites, groups, things, crates);
    } else if (Object.hasOwn(GRAPH_KEYS, def.type)) {
      parseGraphLegend(graph, ch, def as GraphLegend, cells, at, groups, legend);
    } else {
      throw new Error(`"${ch}" 의 type 을 모르겠어요. ${TYPES} 가운데 하나예요.`);
    }
  }
  finishGraph(graph, legend);
  const graphOpens = new Set([...graph.goals.flatMap(x => x.opens), ...graph.slots.flatMap(x => x.opens), ...(graph.sled?.opens ?? [])]);
  if (crates.length > 200) throw new Error('상자와 밀리는 물건은 한 스테이지에 200개까지예요.');
  finishThings(things, ch => legend[ch]?.type === 'bridge');
  for (const ch of thingOpens(things)) graphOpens.add(ch);
  const circuit = buildCircuit(wiring, (c, r) => at(c, r) === '#');
  if (circuit) for (const li of circuit.lamps) for (const ch of circuit.parts[li].opens) graphOpens.add(ch);
  for (const b of bridges) if (!buttons.some(x => x.opens.includes(b.ch)) && !graphOpens.has(b.ch)) throw new Error(`다리 "${b.ch}" 를 여는 단추나 장치가 없어요.`);
  const hint = json.hint ?? '';
  return { cols, rows, solid, spawn, key, door, buttons, bridges, crates, signs, decos, graph, things: things.kinds.length ? things : NO_THINGS, circuit, hint };
}
