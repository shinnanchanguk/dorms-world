/**
 * 크기 바꾸기 장치(큰 장치). 소화 단원에서 "도름이가 영양소처럼 작게 줄어 융털 사이 좁은 틈으로 빨려 들어간다"를 담으려고 더했다.
 * 다른 교과에서도 쓰게 이름을 일반으로 지었다:
 *   - shrink(작아지는 곳): 이 칸에 몸이 닿은 도름이는 작아진다. when 에 다리 글자를 적으면 그 다리가 켜진 동안만 작게 만든다.
 *     작아진 도름이는 떨어져 처음 자리로 돌아가면 원래 크기로 돌아온다.
 *   - sieve(작은 것만 지나는 틈): 원래 크기 도름이·상자에게는 땅처럼 막히고, 작아진 도름이는 지나간다.
 *     작은 도름이가 이 칸에 들어오면 pull 쪽(기본 아래)으로 빨려 들어간다.
 * 상태(작아졌는가)는 도름이마다 한 비트라서 방장의 요약(sync.ts)에 함께 실린다.
 */
import { T, type Rect } from './stage';

/** 작아진 도름이 크기(px). 한 칸(30px) 높이 굴도 지나간다. 원래는 22 × 38. */
export const SMALL_W = 12, SMALL_H = 18;

export type Pull = 'down' | 'up' | 'left' | 'right';
export type ShrinkZone = { ch: string; when: string | null; cells: [number, number][] };
export type Sieve = { ch: string; pull: Pull; cells: [number, number][] };
export type SizeStage = { shrinks: ShrinkZone[]; sieves: Sieve[] };

export const NO_SIZE: SizeStage = { shrinks: [], sieves: [] };
export const SIZE_KEYS: Record<string, string[]> = { shrink: ['type', 'when'], sieve: ['type', 'pull'] };
export type SizeLegend = { type: 'shrink'; when?: string } | { type: 'sieve'; pull?: Pull };

/** legend 의 shrink · sieve 한 항목을 읽는다. 잘못 적으면 쉬운 한국어로 알려 준다. */
export function parseSizeLegend(size: SizeStage, ch: string, def: Record<string, unknown>, cells: [number, number][], isBridge: (ch: string) => boolean) {
  if (def.type === 'shrink') {
    const when = def.when ?? null;
    if (when !== null && (typeof when !== 'string' || !isBridge(when))) throw new Error(`작아지는 곳 "${ch}" 의 when 은 다리(bridge) 글자 하나예요. 언제나 작게 만들려면 when 을 지워요.`);
    size.shrinks.push({ ch, when: when as string | null, cells });
  } else {
    const pull = def.pull ?? 'down';
    if (pull !== 'down' && pull !== 'up' && pull !== 'left' && pull !== 'right') throw new Error(`틈 "${ch}" 의 pull 은 "down", "up", "left", "right" 가운데 하나예요(빨려 가는 쪽).`);
    size.sieves.push({ ch, pull, cells });
  }
  if (size.sieves.reduce((n, s) => n + s.cells.length, 0) + size.shrinks.reduce((n, s) => n + s.cells.length, 0) > 400) throw new Error('작아지는 곳과 틈은 한 스테이지에 모두 400칸까지예요.');
}

const cellRect = ([c, r]: [number, number]): Rect => ({ x: c * T, y: r * T, w: T, h: T });
const hit = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** 틈 칸이 이 몸을 막는가(작아진 도름이는 지나간다). */
export function sieveBlocks(size: SizeStage, r: Rect, small: boolean) {
  if (small || !size.sieves.length) return false;
  for (const s of size.sieves) for (const cell of s.cells) if (hit(r, cellRect(cell))) return true;
  return false;
}

/** 이 몸이 닿은 틈의 빨려 가는 쪽(닿지 않았으면 null). */
export function sievePull(size: SizeStage, r: Rect): Pull | null {
  for (const s of size.sieves) for (const cell of s.cells) if (hit(r, cellRect(cell))) return s.pull;
  return null;
}

/** 지금 작게 만드는 곳에 닿았는가. */
export function inShrink(size: SizeStage, r: Rect, isOn: (ch: string) => boolean) {
  for (const z of size.shrinks) {
    if (z.when && !isOn(z.when)) continue;
    for (const cell of z.cells) if (hit(r, cellRect(cell))) return true;
  }
  return false;
}
