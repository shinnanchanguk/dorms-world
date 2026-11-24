/**
 * 선생님이 더하는 새 움직임(behavior). things.json 의 성질(몸·닿기·움직임)로 안 되는 아이디어가 있으면
 * platform/behaviors/<이름>.ts 파일 하나에 이 모양으로 적어 `npm run submit` 으로 팩과 함께 보낸다(GitHub 계정 필요 없음).
 * 자동 검사를 거쳐 실린다. 물리·그리기·온라인 동기화는 판이 맡는다:
 *   - 물건 하나마다 수 4칸(vars)이 있고 방 안 모두에게 저절로 맞춰진다. 상태는 여기에만 둔다(다른 곳에 두면 손님 화면과 갈라진다).
 *   - vars[0] 이 0 이 아니면 그 물건 종류의 opens 다리가 켜진다.
 *   - 그림은 그 물건의 글자 그림(frames) 가운데 몇째 장을 그릴지만 고른다(화풍이 하나로 유지된다).
 *   - 손잡이로 물건을 옮기고(place), 도름이를 밀고(shove), 든 물건을 받거나(take) 새로 쥐여 주고(give), 다른 장치의 수를 읽는다(peek).
 *   - 여기 없는 일이 필요하면 판(platform/, src/)을 직접 고친다. 손잡이에 갇혀 아이디어를 줄이지 않는다(kit/DEVICE_GUIDE.md '큰 장치').
 * 지킬 것: 바깥과 주고받는 코드(fetch, 저장소, 주소), 시간·난수(Date, Math.random), 끝없는 반복(while, for(;;)) 금지. 같은 입력이면 같은 결과여야 방장이 바뀌어도 이어진다.
 * 기계 검사는 tests/behaviors-rules.test.ts(문법 나무로 본다). 마지막 관문은 운영자가 병합할 때 한 줄씩 읽는 것이다.
 * 형식 설명은 kit/DEVICE_GUIDE.md '새 움직임'.
 */
import type { Rect } from './stage';

/** 도름이 한 명에 대해 움직임이 보는 것(사본이다). 바꿀 수 있는 것은 vy(위아래 속도) 하나. 자리를 옮기려면 respawn·launch 를 쓴다. */
export type BehaviorPlayer = Readonly<Rect> & { readonly i: number; readonly on: boolean; vy: number };

export type BehaviorCtx = {
  /** 이 물건의 수 4칸(방 안 모두에게 맞춰진다). 정수나 소수, -1e6~1e6. */
  vars: number[];
  /** 이 물건의 지금 자리(그림 크기). */
  rect: Readonly<Rect>;
  /** 지난 시간(초). 방장이 바뀌어도 이어진다. */
  t: number;
  /** 방 인원. */
  players: number;
  /** things.json 의 takes(이 장치가 받는 물건 이름들)와 gives(내주는 물건 이름, 없으면 ''). 같은 움직임을 여러 교과가 다른 물건으로 쓰게. */
  takes: readonly string[];
  gives: string;
  /** 켜진 다리 글자인가. */
  isOn: (ch: string) => boolean;
  /** 도름이를 처음 자리로 보낸다. */
  respawn: (p: BehaviorPlayer) => void;
  /** 도름이를 n 칸 높이로 튕겨 올린다(2~10). */
  launch: (p: BehaviorPlayer, cells: number) => void;
  /** 물건을 없앤다(다시 나타나지 않는다). */
  remove: () => void;
  /** 이 물건을 (x, y) 로 옮긴다(판 점, 그림의 왼쪽 위). 땅 밖이나 지도 밖으로는 못 간다. 왔다 갔다(move)를 적은 물건은 옮기지 않는다. */
  place: (x: number, y: number) => void;
  /** 도름이를 옆으로 px 만큼 민다(-60~60, 막히면 막힌 데까지). 바람·물살·컨베이어 같은 장치에. */
  shove: (p: BehaviorPlayer, px: number) => void;
  /** 그 도름이가 머리 위에 든 물건 이름(things.json 의 이름). 없으면 null. */
  holding: (p: BehaviorPlayer) => string | null;
  /** 그 도름이가 든 물건을 받아 없앤다. 받은 물건 이름을 돌려준다(안 들고 있었으면 null). 음식을 먹고, 재료를 넣는 장치에. */
  take: (p: BehaviorPlayer) => string | null;
  /** 그 도름이 손에 물건을 하나 쥐여 준다(things.json 에 "stock": true 로 적은 들 수 있는 물건, 지도에 미리 놓아 둔 것 가운데 아직 안 나온 것). 손이 비어 있고 남은 것이 있으면 true. 잘게 부순 음식, 만든 물건을 내주는 장치에. */
  give: (p: BehaviorPlayer, thing: string) => boolean;
  /** 다른 물건의 수 4칸을 읽는다(things.json 의 이름으로, 지도에서 가장 먼저 놓인 것). 없으면 null. 장치끼리 이어 붙일 때. */
  peek: (thing: string) => readonly number[] | null;
};

export type Behavior = {
  /** 무엇을 하는지 한 줄(검사와 안내에 쓴다). */
  about: string;
  /** 처음 vars(4칸까지). 안 적으면 0 넷. */
  init?: number[];
  /** 매 걸음(1/60초). touching: 지금 이 물건에 닿은 도름이들. */
  tick?: (ctx: BehaviorCtx, dt: number, touching: BehaviorPlayer[]) => void;
  /** 가까이에서 확인을 눌렀다. 무언가 했으면 true(그 누름은 다른 장치로 넘어가지 않는다). true 가 아니면 누름은 다른 장치로 넘어간다. */
  use?: (ctx: BehaviorCtx, p: BehaviorPlayer) => boolean;
  /** 확인을 누르면 무엇을 하는지 안내(12자 안팎, 없으면 안내하지 않음). p 는 안내를 볼 도름이(든 물건에 따라 글을 바꿀 때). */
  useText?: (ctx: BehaviorCtx, p: BehaviorPlayer) => string | null;
  /** 몇째 그림을 그릴지(frames 의 차례). 안 적으면 0.25초마다 넘긴다. */
  frame?: (ctx: BehaviorCtx) => number;
  /** 물건 위에 늘 보이는 글(8자 안팎, 없으면 things.json 의 label). 남은 횟수·단계처럼 바뀌는 이름표에. */
  label?: (ctx: BehaviorCtx) => string | null;
};

const files = import.meta.glob<{ default: Behavior }>('./behaviors/*.ts', { eager: true });
/** 이름 → 움직임. 파일 이름이 곧 이름이다(platform/behaviors/toggle.ts → "toggle"). */
export const BEHAVIORS: Record<string, Behavior> = Object.fromEntries(
  Object.entries(files)
    .map(([path, mod]) => [/\/([a-z0-9-]{1,40})\.ts$/.exec(path)?.[1], mod.default] as const)
    .filter((e): e is readonly [string, Behavior] => !!e[0] && !!e[1] && typeof e[1].about === 'string'),
);
