/**
 * 회로판. 지도에 그린 전선 · 전지 · 전구 · 접점을 읽어 두고(stage.ts), 접점마다 이어졌는지에 따라 전구 밝기를 계산한다.
 * 화면도 도름이도 모르는 순수한 계산이다. 같은 지도와 같은 접점 상태면 언제나 같은 답을 낸다(방장과 손님이 따로 계산해도 같다).
 *
 * 계산은 실제 회로와 같다(옴의 법칙, 키르히호프 법칙). 전지는 전압 1, 전구는 저항 1, 전선 한 칸과 닫힌 접점은 아주 작은 저항이다.
 * 그래서 전구 하나만 이으면 밝기 1, 한 줄로 둘을 이으면 하나마다 1/4(어둡게), 갈래로 둘을 이으면 하나마다 1(밝게)이다.
 * 전선 칸마다 흐르는 양도 따로 구한다: 갈래 끝이 끊긴 전선은 갈림길에 붙어 있어도 흐르지 않는 것으로 보인다.
 * 전지 양 끝이 전구를 거치지 않고 이어지면 합선이다. 그 회로의 전구는 모두 꺼진다.
 */

export type PartKind = 'source' | 'lamp' | 'contact';
/** 회로의 칸 하나. links 는 붙은 회로 칸 방향(1 오른쪽, 2 왼쪽, 4 아래, 8 위). part 는 전선이면 -1. */
export type CircuitCell = { c: number; r: number; kind: 'wire' | PartKind; part: number; links: number };
/** 전지 · 전구 · 접점 하나. ends 는 양쪽에 붙은 전선 칸의 번호(cells 의 차례). net 은 속한 회로(전지 하나에 회로 하나). */
export type CircuitPart = { kind: PartKind; ch: string; cell: number; ends: [number, number]; net: number; opens: string[]; when: 'bright' | 'on' };
export type CircuitDef = {
  cells: CircuitCell[];
  parts: CircuitPart[];
  /** 전선끼리 붙은 곳(cells 의 번호 둘). */
  joins: [number, number][];
  /** 회로마다 그 회로의 전지(parts 의 번호). */
  sources: number[];
  lamps: number[];
  contacts: number[];
};
export type CircuitState = {
  /** 전구마다 밝기(전구 하나만 이었을 때가 1). */
  power: number[];
  /** 칸마다 흐르는 양(0 이면 흐르지 않음). */
  flow: Float32Array;
  /** 회로마다 합선인가. */
  short: boolean[];
};

/** 켜졌다고 보는 밝기, 밝게 켜졌다고 보는 밝기. 한 줄로 이은 전구 둘(1/4)은 켜졌지만 밝지 않다. */
export const LIT = 0.04, BRIGHT = 0.7;
export const lampOn = (def: CircuitDef, st: CircuitState, lamp: number) => {
  const p = st.power[def.lamps.indexOf(lamp)] ?? 0;
  return def.parts[lamp].when === 'on' ? p >= LIT : p >= BRIGHT;
};

const G_WIRE = 1e5;          // 전선 한 칸, 닫힌 접점(저항 0.00001)
const SHORT_CURRENT = 100;   // 전지에서 나가는 양이 이보다 크면 합선(전구 열두 개를 모두 갈래로 이어도 12)

const cache = new WeakMap<CircuitDef, Map<string, CircuitState>>();

/** closed: 접점마다 이어졌는가(def.contacts 차례). */
export function solveCircuit(def: CircuitDef, closed: readonly boolean[]): CircuitState {
  const key = def.contacts.map((_, i) => (closed[i] ? '1' : '0')).join('');
  let m = cache.get(def);
  if (!m) { m = new Map(); cache.set(def, m); }
  const hit = m.get(key);
  if (hit) return hit;
  const out = solve(def, closed);
  if (m.size > 512) m.clear();
  m.set(key, out);
  return out;
}

type Edge = { a: number; b: number; g: number; part: number };

function solve(def: CircuitDef, closed: readonly boolean[]): CircuitState {
  const n = def.cells.length;
  const power = def.lamps.map(() => 0), flow = new Float32Array(n), short = def.sources.map(() => false);
  // 이음(전도도 g): 전선끼리, 전구(1), 닫힌 접점(전선과 같음). 전지는 양 끝의 전압으로 넣는다.
  const edges: Edge[] = def.joins.map(([a, b]) => ({ a, b, g: G_WIRE, part: -1 }));
  def.parts.forEach((p, pi) => {
    if (p.kind === 'lamp') edges.push({ a: p.ends[0], b: p.ends[1], g: 1, part: pi });
    else if (p.kind === 'contact' && closed[def.contacts.indexOf(pi)]) edges.push({ a: p.ends[0], b: p.ends[1], g: G_WIRE, part: pi });
  });
  const adj: Edge[][] = Array.from({ length: n }, () => []);
  for (const e of edges) { adj[e.a].push(e); adj[e.b].push(e); }

  def.sources.forEach((si, net) => {
    const src = def.parts[si], hi = src.ends[0], lo = src.ends[1];
    // 전지 양 끝에서 이어진 칸만 푼다(어디에도 안 이어진 조각은 흐르지 않는다)
    const seen = new Map<number, number>(), order: number[] = [];
    for (const s of [hi, lo]) {
      if (seen.has(s)) continue;
      const q = [s]; seen.set(s, order.length); order.push(s);
      while (q.length) { const v = q.pop()!; for (const e of adj[v]) { const u = e.a === v ? e.b : e.a; if (!seen.has(u)) { seen.set(u, order.length); order.push(u); q.push(u); } } }
    }
    const V = new Float64Array(n);
    V[hi] = 1; V[lo] = 0;
    const unknown = order.filter(v => v !== hi && v !== lo), idx = new Map(unknown.map((v, i) => [v, i]));
    const k = unknown.length;
    if (k) {
      // 칸마다 들고 나는 양의 합이 0(키르히호프). A V = rhs 를 가우스 소거로 푼다
      const A = Array.from({ length: k }, () => new Float64Array(k)), rhs = new Float64Array(k);
      unknown.forEach((v, i) => {
        for (const e of adj[v]) {
          const u = e.a === v ? e.b : e.a;
          A[i][i] += e.g;
          const j = idx.get(u);
          if (j != null) A[i][j] -= e.g; else rhs[i] += e.g * V[u];
        }
      });
      const x = gauss(A, rhs);
      unknown.forEach((v, i) => { V[v] = x[i]; });
    }
    let current = 0;
    for (const e of adj[hi]) current += e.g * (V[hi] - V[e.a === hi ? e.b : e.a]);
    if (current > SHORT_CURRENT) { short[net] = true; return; }   // 합선: 이 회로는 아무것도 켜지지 않는다
    for (const v of order) for (const e of adj[v]) {
      if (e.a !== v) continue;                                       // 이음마다 한 번만
      const i = Math.abs(e.g * (V[e.a] - V[e.b]));
      if (i < 1e-6) continue;
      if (e.part >= 0) flow[def.parts[e.part].cell] = Math.max(flow[def.parts[e.part].cell], i);
      flow[e.a] = Math.max(flow[e.a], i); flow[e.b] = Math.max(flow[e.b], i);
      if (e.part >= 0 && def.parts[e.part].kind === 'lamp') { const p = (V[e.a] - V[e.b]) ** 2; power[def.lamps.indexOf(e.part)] = p < 1e-6 ? 0 : p; }
    }
    if (current > 1e-6) flow[src.cell] = current;
  });
  return { power, flow, short };
}

/** 가우스 소거(부분 피벗). 줄 수가 작아(수백 칸) 그대로 푼다. */
function gauss(A: Float64Array[], b: Float64Array): Float64Array {
  const k = b.length;
  for (let col = 0; col < k; col++) {
    let piv = col;
    for (let r = col + 1; r < k; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    if (Math.abs(A[piv][col]) < 1e-12) continue;                    // 어디에도 안 이어진 칸(일어나지 않지만 멈추지 않게)
    if (piv !== col) { [A[piv], A[col]] = [A[col], A[piv]]; [b[piv], b[col]] = [b[col], b[piv]]; }
    for (let r = col + 1; r < k; r++) {
      const f = A[r][col] / A[col][col];
      if (!f) continue;
      for (let c = col; c < k; c++) A[r][c] -= f * A[col][c];
      b[r] -= f * b[col];
    }
  }
  const x = new Float64Array(k);
  for (let r = k - 1; r >= 0; r--) {
    if (Math.abs(A[r][r]) < 1e-12) { x[r] = 0; continue; }
    let s = b[r];
    for (let c = r + 1; c < k; c++) s -= A[r][c] * x[c];
    x[r] = s / A[r][r];
  }
  return x;
}

/** 지도에서 회로를 읽는다. at(c, r) 는 그 칸의 글자, kindOf(ch) 는 회로 글자이면 종류. 어긋나면 쉬운 한국어로 알린다. */
export function buildCircuit(
  found: { ch: string; kind: 'wire' | PartKind; cells: [number, number][]; opens: string[]; when: 'bright' | 'on' }[],
  ground: (c: number, r: number) => boolean,
): CircuitDef | null {
  const cells: CircuitCell[] = [], parts: CircuitPart[] = [], at = new Map<string, number>();
  const k = (c: number, r: number) => `${c},${r}`;
  for (const f of found) for (const [c, r] of f.cells) {
    at.set(k(c, r), cells.length);
    cells.push({ c, r, kind: f.kind, part: -1, links: 0 });
    if (f.kind !== 'wire') { cells[cells.length - 1].part = parts.length; parts.push({ kind: f.kind, ch: f.ch, cell: cells.length - 1, ends: [-1, -1], net: -1, opens: f.opens, when: f.when }); }
  }
  if (!cells.length) return null;
  if (cells.length > 600) throw new Error('회로 칸(전선, 전지, 전구, 접점)은 한 스테이지에 600칸까지예요.');
  const NAME: Record<PartKind, string> = { source: '전지', lamp: '전구', contact: '접점' };
  const DIRS: [number, number, number][] = [[1, 0, 1], [-1, 0, 2], [0, 1, 4], [0, -1, 8]];
  const joins: [number, number][] = [];
  cells.forEach((cell, i) => {
    const near: number[] = [];
    for (const [dc, dr, bit] of DIRS) {
      const j = at.get(k(cell.c + dc, cell.r + dr));
      if (j == null) continue;
      const other = cells[j];
      // 부품끼리는 바로 붙지 않는다(사이에 전선 한 칸이 있어야 어느 쪽 끝인지 알 수 있다)
      if (cell.kind !== 'wire' && other.kind !== 'wire') throw new Error(`${NAME[cell.kind]} "${parts[cell.part].ch}"(지도 ${cell.r + 1}번째 줄 ${cell.c + 1}번째 칸)이 ${NAME[other.kind as PartKind]}에 바로 붙어 있어요. 사이에 전선을 한 칸 넣어 주세요.`);
      cell.links |= bit; near.push(j);
      if (cell.kind === 'wire' && other.kind === 'wire' && i < j) joins.push([i, j]);
    }
    if (cell.kind !== 'wire') {
      const p = parts[cell.part];
      if (near.length !== 2) throw new Error(`${NAME[cell.kind]} "${p.ch}"(지도 ${cell.r + 1}번째 줄 ${cell.c + 1}번째 칸)에는 전선이 꼭 두 곳에 붙어야 해요(지금 ${near.length}곳). 양쪽 끝이 하나씩이에요.`);
      p.ends = [near[0], near[1]];
      if (cell.kind === 'contact' && !ground(cell.c, cell.r + 1)) throw new Error(`접점 "${p.ch}"(지도 ${cell.r + 1}번째 줄 ${cell.c + 1}번째 칸) 바로 아래는 땅(#)이어야 해요. 도름이가 그 칸에 서서 잇는 자리예요.`);
    }
  });
  // 붙어 있는 회로 칸끼리 한 회로. 회로마다 전지가 꼭 하나
  const net = new Array<number>(cells.length).fill(-1), sources: number[] = [];
  let nets = 0;
  cells.forEach((_, s) => {
    if (net[s] >= 0) return;
    const q = [s]; net[s] = nets; const mine: number[] = [s];
    while (q.length) { const v = q.pop()!; for (const [dc, dr] of DIRS) { const j = at.get(k(cells[v].c + dc, cells[v].r + dr)); if (j != null && net[j] < 0) { net[j] = nets; q.push(j); mine.push(j); } } }
    const srcs = mine.filter(i => cells[i].kind === 'source').map(i => cells[i].part);
    const first = cells[mine[0]];
    if (srcs.length !== 1) throw new Error(`이어진 회로 하나에는 전지가 꼭 하나 있어야 해요(지도 ${first.r + 1}번째 줄 ${first.c + 1}번째 칸 쪽 회로에는 ${srcs.length}개). 회로를 둘로 나누려면 전선을 떼어 놓아요.`);
    if (mine.filter(i => cells[i].kind === 'wire').length > 300) throw new Error('회로 하나의 전선은 300칸까지예요.');
    sources.push(srcs[0]);
    nets++;
  });
  if (nets > 6) throw new Error('회로(전지)는 한 스테이지에 6개까지예요.');
  parts.forEach(p => { p.net = net[p.cell]; });
  const lamps = parts.map((p, i) => (p.kind === 'lamp' ? i : -1)).filter(i => i >= 0);
  const contacts = parts.map((p, i) => (p.kind === 'contact' ? i : -1)).filter(i => i >= 0);
  if (lamps.length > 12) throw new Error('전구는 한 스테이지에 12개까지예요.');
  if (contacts.length > 16) throw new Error('접점은 한 스테이지에 16개까지예요.');
  return { cells, parts, joins, sources, lamps, contacts };
}
