/**
 * 선생님이 더하는 새 움직임(behavior). things.json 의 성질(몸·닿기·움직임)로 안 되는 아이디어가 있으면
 * platform/behaviors/<이름>.ts 파일 하나에 이 모양으로 적어 `npm run submit` 으로 팩과 함께 보낸다(GitHub 계정 필요 없음).
 * 자동 검사를 거쳐 실린다. 물리·그리기·온라인 동기화는 판이 맡는다:
 *   - 물건 하나마다 수 4칸(vars)이 있고 방 안 모두에게 저절로 맞춰진다. 상태는 여기에만 둔다(다른 곳에 두면 손님 화면과 갈라진다).
 *   - vars[0] 이 0 이 아니면 그 물건 종류의 opens 다리가 켜진다.
 *   - 그림은 그 물건의 글자 그림(frames) 가운데 몇째 장을 그릴지만 고른다(화풍이 하나로 유지된다).
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
  /** 켜진 다리 글자인가. */
  isOn: (ch: string) => boolean;
  /** 도름이를 처음 자리로 보낸다. */
  respawn: (p: BehaviorPlayer) => void;
  /** 도름이를 n 칸 높이로 튕겨 올린다(2~10). */
  launch: (p: BehaviorPlayer, cells: number) => void;
  /** 물건을 없앤다(다시 나타나지 않는다). */
  remove: () => void;
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
  /** 확인을 누르면 무엇을 하는지 안내(12자 안팎, 없으면 안내하지 않음). */
  useText?: (ctx: BehaviorCtx) => string | null;
  /** 몇째 그림을 그릴지(frames 의 차례). 안 적으면 0.25초마다 넘긴다. */
  frame?: (ctx: BehaviorCtx) => number;
};

const files = import.meta.glob<{ default: Behavior }>('./behaviors/*.ts', { eager: true });
/** 이름 → 움직임. 파일 이름이 곧 이름이다(platform/behaviors/toggle.ts → "toggle"). */
export const BEHAVIORS: Record<string, Behavior> = Object.fromEntries(
  Object.entries(files)
    .map(([path, mod]) => [/\/([a-z0-9-]{1,40})\.ts$/.exec(path)?.[1], mod.default] as const)
    .filter((e): e is readonly [string, Behavior] => !!e[0] && !!e[1] && typeof e[1].about === 'string'),
);
