/**
 * 방의 규칙. 방 서버(room-server/)와 시험이 같은 코드를 쓴다. 화면도 Workers 기능도 쓰지 않는 순수한 계산이다.
 *
 * 방을 지나가는 것은 자리 번호, 조작 신호, 세계 요약, 방 정보(팩·스테이지·씨앗·공개 여부·차례)뿐이다. 어디에도 저장하지 않는다.
 * 누가 보낸 글이든 믿지 않는다: 모양과 크기를 검사하고, 모르는 것은 버리고, 조작 신호는 검사한 값으로 다시 써서 넘긴다.
 *
 * 교사 방: 방을 만든 연결이 도름스가 서명한 교사 출입증을 내면 그 방은 교사 방이 된다(방 제목, 닉네임 신청과 승인, 순위에 올리기).
 * 사람이 쓴 글자가 방을 지나가는 것은 교사가 정한 방 제목과 교사가 승인한 닉네임, 그래프 공장에 넣은 식(방장에게만 가고, 방장이 수식으로 다시 써서 나눈다)뿐이고, 모두 방이 있는 동안 메모리에만 있다.
 */
import { validRoomCode } from './room-code';
import { cleanOrder } from './graph/order';

export const MAX_SEATS = 30;
/** 메시지 크기 상한(바이트). 손님은 조작 신호뿐이라 작고, 방장만 세계 요약을 보낸다. */
export const LIMITS = { guest: 256, snap: 32 * 1024, host: 2048, pass: 1024, order: 640, perSec: 40, burst: 80 } as const;
/** 닉네임 10자, 방 제목 20자. 닉네임 신청은 연결마다 10초에 한 번, 출입증 내기는 3초에 한 번. */
/** 판 번호의 상한. 방장이 이 값을 넘겨 보내면 방 서버가 받지 않는다. 화면은 다음 판을 열 때 이 값에서 1 로 돌아간다. */
export const RUN_MAX = 1_000_000_000;
/** 다음 판 번호. 앞 방장이 상한까지 올려 둔 번호를 넘겨받아도 다음 판을 열 수 있게 1 로 돌아간다(그대로 1 을 더하면 방 서버가 받지 않아 방이 멎는다). */
export const nextRun = (run: number) => (Number.isInteger(run) && run >= 0 && run < RUN_MAX ? run + 1 : 1);
export const NICK_MAX = 10, TITLE_MAX = 20, ASK_GAP = 10_000, PASS_GAP = 3000, PASS_MAX = 800;
/**
 * 순위에 올리는 시간은 방장이 알린 값이 아니라 방 서버가 잰 값이다(판이 열린 때부터 깼다는 글이 온 때까지). 3초 이상 3시간 이하.
 * 방장이 알린 시간은 견주는 데만 쓴다: 방 서버가 잰 시간보다 1.5초 넘게 길거나 2초 넘게 짧으면 받지 않는다(멈춰 있던 판, 꾸민 시간).
 * 한 방이 올리는 것은 같은 (팩, 스테이지, 판)마다 한 번, 방 전체로 1분에 6번까지. 스테이지 번호는 0~29.
 */
export const RANK = { min: 3000, max: 3 * 3600 * 1000, slack: 1500, under: 2000, perMin: 6, stages: 30 } as const;
/** 연결을 끊을 때의 까닭 번호(브라우저가 읽을 수 있는 4000번대). */
export const CLOSE = { bad: 4000, full: 4003, none: 4004, tooBig: 4007, tooFast: 4008, taken: 4009, replaced: 4010 } as const;
export const PUBLIC_TTL = 30_000;
/** 공개 방 목록에는 방 하나가 1초에 한 번까지만 알린다. 달라진 것이 없으면 10초에 한 번(목록이 30초 뒤 지우므로). */
export const REPORT_GAP = 1000, REPORT_KEEP = 10_000;
/** 이만큼 아무 소식(글도, 연결 두드리기도)이 없는 연결은 죽은 것으로 보고 자리를 비운다. 화면은 10초마다 두드린다. */
export const IDLE_MS = 60_000;
/**
 * 방장은 5초마다 살아 있음을 알리고 10초마다 연결을 두드린다. 이만큼 아무 소식이 없으면 방장 자리만 다음 사람에게 넘긴다(자리는 IDLE_MS 까지 둔다).
 * 방장 휴대폰이 잠들거나 와이파이에서 떨어졌는데 닫힘 신호가 오지 않으면, 나머지가 스테이지 고르는 화면이나 멈춘 판에서 몇 분씩 기다리게 되던 것을 막는다.
 */
export const HOST_QUIET_MS = 15_000;
/** 손님 글이 올 때 죽은 연결을 치워 보는 간격. 방 서버의 알람도 이 간격으로 tick() 을 부른다. */
export const SWEEP_GAP = 5_000;

export const ORIGINS = ['https://dorms-world.vercel.app', 'https://dorms.school'];
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;
/** 방 서버를 쓸 수 있는 곳: 운영 두 주소와 이 컴퓨터(개발). extra 는 같은 와이파이의 휴대폰으로 시험할 때만 넣는다. */
export const originAllowed = (origin: string | null | undefined, extra: readonly string[] = []) =>
  !!origin && (ORIGINS.includes(origin) || LOCAL.test(origin) || extra.includes(origin));

export type View = 'play' | 'pad';
/**
 * 방 정보. pack 이 비었거나 stage 가 -1 이면 방장이 고르는 중이다.
 * run 은 판 번호(시작하거나 다시 할 때마다 는다), order 는 도름이 차례대로 적은 자리 번호, big 은 함께 보기 방.
 */
export type RoomInfo = { pack: string; stage: number; seed: number; run: number; pub: boolean; big: boolean; order: number[] };
export const emptyRoom = (pub = false, big = false): RoomInfo => ({ pack: '', stage: -1, seed: 1, run: 0, pub, big, order: [] });

export type PublicRoom = { code: string; pack: string; stage: number; count: number };

const int = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
const PACK_ID = /^[a-z0-9-]+\/[a-z0-9-]+$/;

/** 방장이 보낸 방 정보를 검사해 깨끗한 값으로 돌려준다. 하나라도 어긋나면 null(그 메시지는 버린다). */
export function cleanRoomInfo(x: unknown): RoomInfo | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const pack = o.pack;
  if (typeof pack !== 'string' || pack.length > 64 || (pack !== '' && !PACK_ID.test(pack))) return null;
  if (!int(o.stage, -1, 99) || !int(o.seed, 1, 2147483647) || !int(o.run, 0, RUN_MAX)) return null;
  if (typeof o.pub !== 'boolean' || typeof o.big !== 'boolean') return null;
  const order = o.order;
  if (!Array.isArray(order) || order.length > MAX_SEATS || !order.every(s => int(s, 0, MAX_SEATS - 1)) || new Set(order).size !== order.length) return null;
  return { pack, stage: o.stage, seed: o.seed, run: o.run, pub: o.pub, big: o.big, order: order.slice() as number[] };
}

/** 손님의 조작 신호. 검사한 값만 남긴다(m 좌우, j 뛰기, a 확인, n 뛰기를 누른 횟수). */
export type WirePad = { m: -1 | 0 | 1; j: 0 | 1; a: 0 | 1; n: number };
export function cleanPad(x: unknown): WirePad | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  if (o.m !== -1 && o.m !== 0 && o.m !== 1) return null;
  if ((o.j !== 0 && o.j !== 1) || (o.a !== 0 && o.a !== 1) || !int(o.n, 0, 1_000_000_000)) return null;
  return { m: o.m, j: o.j, a: o.a, n: o.n };
}

// ---------- 사람이 쓴 한 줄 글(닉네임 · 방 제목) ----------
/**
 * 한 줄 글로 다듬는다: 줄바꿈은 빈칸으로, 제어 문자 · 보이지 않는 글자(방향 바꿈 등)는 빼고, 빈칸은 하나로, 겹겹이 쌓은 결합 기호는 하나만 남긴다.
 * 비었거나 max 글자를 넘으면 빈 글(받지 않는다). 꺾쇠 같은 글자는 그대로 두고, 그리는 쪽이 이스케이프한다.
 */
export function cleanLine(x: unknown, max: number): string {
  if (typeof x !== 'string' || x.length > max * 8) return '';
  // 줄바꿈 · 탭은 빈칸으로(낱말이 붙지 않게), 그 밖의 제어 문자와 보이지 않는 글자는 뺀다
  const s = x.normalize('NFC').replace(/[\t\n\v\f\r\u0085\u2028\u2029]+/g, ' ').replace(/[\p{Cc}\p{Cf}\p{Co}\p{Cs}]/gu, '').replace(/(\p{M})\p{M}+/gu, '$1').replace(/\s+/gu, ' ').trim();
  return s && [...s].length <= max ? s : '';
}
export const cleanNick = (x: unknown) => cleanLine(x, NICK_MAX);
export const cleanTitle = (x: unknown) => cleanLine(x, TITLE_MAX);

// ---------- 교사 출입증 ----------
/**
 * 도름스가 교사 인증을 마친 회원에게 만들어 주는 출입증.
 *   v1.<base64url(JSON)>.<base64url(HMAC-SHA256(비밀값, "v1." + 앞의 base64url))>   (base64url 은 채움 글자 없이)
 *   JSON: { u 회원 번호, n 공개 닉네임, a 사진 있음 1 / 없음 0, iat 만든 때(초), exp 끝나는 때(초, iat + 12시간) }
 */
export type PassClaims = { u: string; n: string; a: 0 | 1; iat: number; exp: number; c: number };
/** 선생님 방 안내의 판 번호. 선생님 방을 처음 열 때 그 자리에서 무엇이 처리되는지 알리고 동의를 받는다(형 지시 2026-11-22). 안내 글이 바뀌면 올린다. */
export const NOTICE = 1;
const PASS_RE = /^v1\.([A-Za-z0-9_-]{16,700})\.([A-Za-z0-9_-]{43})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PASS_TTL = 12 * 3600;
function unb64(s: string): Uint8Array<ArrayBuffer> | null {
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch { return null; }
}
/**
 * 출입증의 가운데(JSON)를 읽는다. 서명은 보지 않으므로 이 값은 '이 화면에 누구라고 적혀 있나'까지만 쓴다(진짜 확인은 verifyPass).
 * 모양이 어긋났거나 기한이 지났으면 null.
 */
export function readPass(pass: unknown, nowSec: number): PassClaims | null {
  if (typeof pass !== 'string' || pass.length > PASS_MAX) return null;
  const m = PASS_RE.exec(pass), raw = m && unb64(m[1]);
  if (!raw) return null;
  let o: Record<string, unknown>;
  try { o = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(raw)); } catch { return null; }
  if (!o || typeof o !== 'object') return null;
  const n = typeof o.n === 'string' ? cleanLine(o.n.slice(0, 80), 80) : '';
  if (typeof o.u !== 'string' || !UUID.test(o.u) || !n) return null;
  if (!int(o.iat, 0, 4e9) || !int(o.exp, 0, 4e9) || o.exp <= nowSec || o.iat > nowSec + 300 || o.exp - o.iat > PASS_TTL + 600) return null;
  return { u: o.u, n: [...n].slice(0, 40).join(''), a: o.a === 1 ? 1 : 0, iat: o.iat, exp: o.exp, c: int(o.c, 0, 1000) ? (o.c as number) : 0 };
}
/** 출입증의 서명과 기한을 확인한다. 비밀값이 없거나 32자가 안 되면 어떤 출입증도 받지 않는다. */
export async function verifyPass(pass: unknown, secret: string | null | undefined, nowSec: number): Promise<PassClaims | null> {
  if (typeof secret !== 'string' || secret.length < 32) return null;
  const claims = readPass(pass, nowSec);
  if (!claims) return null;
  const [, body, sig] = PASS_RE.exec(pass as string)!, mac = unb64(sig);
  if (!mac || mac.length !== 32) return null;
  try {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    return (await crypto.subtle.verify('HMAC', key, mac, enc.encode(`v1.${body}`))) ? claims : null;
  } catch { return null; }
}

// ---------- 교사 방 ----------
/** 방에 있는 모두가 아는 교사 방 정보: 방 제목, 순위에 올리는지, 교사 연결의 자리 번호. */
export type ClassInfo = { title: string; rank: boolean; teachers: number[] };
/** 방 서버만 아는 교사 방 정보: u 교사의 회원 번호, n 교사의 닉네임, done 순위에 올린 마지막 판 번호, big 함께 보기 방으로 만들었는지(방을 만든 때의 값). */
export type Klass = { u: string; n: string; title: string; rank: boolean; done: number; big?: boolean };
export type NameList = [number, string][];
export type RankReport = { run: number; pack: string; stage: number; ms: number; players: number; title: string; teacher: string };
export type UseReport = { pack: string; teacher: string };
function cleanKlass(x: unknown): Klass | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  if (typeof o.u !== 'string' || !UUID.test(o.u) || typeof o.title !== 'string') return null;
  return { u: o.u, n: cleanLine(o.n, 40), title: o.title === '' ? '' : cleanTitle(o.title), rank: o.rank === true, done: int(o.done, -1, 1_000_000_000) ? o.done : -1, big: o.big === true };
}
/** 받은 교사 방 정보(화면 쪽에서 쓴다). 어긋나면 null. */
export function readClassInfo(x: unknown): ClassInfo | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>, t = o.t;
  if (typeof o.title !== 'string' || !Array.isArray(t) || t.length > MAX_SEATS || !t.every(s => int(s, 0, MAX_SEATS - 1))) return null;
  return { title: o.title === '' ? '' : cleanTitle(o.title), rank: o.rank === 1, teachers: t.slice() as number[] };
}
/** 받은 닉네임 목록 [[자리 번호, 닉네임]]. 모양이 맞는 것만 남긴다. */
export function readNames(x: unknown): NameList {
  if (!Array.isArray(x)) return [];
  const out: NameList = [], seen = new Set<number>();
  for (const r of x.slice(0, MAX_SEATS)) {
    if (!Array.isArray(r) || !int(r[0], 0, MAX_SEATS - 1) || seen.has(r[0])) continue;
    const v = cleanNick(r[1]);
    if (v) { seen.add(r[0]); out.push([r[0], v]); }
  }
  return out;
}
/** 도름스가 순위를 적고 돌려준 답. 등수를 못 받았으면 rank 0. */
export function readRankReply(x: unknown): { rank: number; best: boolean } {
  const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
  return o.ok === true && int(o.rank, 1, 1_000_000) ? { rank: o.rank, best: o.best === true } : { rank: 0, best: false };
}
/**
 * 방 서버가 도름스에 적는 주소. 환경 값으로 바꿀 수 있는 것은 이 컴퓨터의 주소뿐이다(로컬 시험의 흉내 서버).
 * 그 밖의 값은 무시하고 운영 주소를 쓴다: 잘못 넣은 환경 값 때문에 비밀값이 다른 곳으로 가지 않게.
 */
export function dormsUrl(kind: 'ranks' | 'uses' | 'consents', override?: string | null): string {
  return override && /^http:\/\/(localhost|127\.0\.0\.1):\d{2,5}\/[\w./-]*$/.test(override) ? override : `https://dorms.school/api/world/${kind}`;
}

export type JoinQuery = { mode: 'create' | 'join'; view: View | 'auto'; id: string; pub: boolean; big: boolean };
const TAB_ID = /^[0-9a-f]{16}$/;
/** 주소 뒤에 붙은 값(문자열)을 읽는다. 모양이 어긋난 값은 기본값으로 둔다. */
export function readJoinQuery(q: { get(name: string): string | null }): JoinQuery {
  const view = q.get('view'), id = q.get('id') ?? '';
  return { mode: q.get('mode') === 'create' ? 'create' : 'join', view: view === 'play' || view === 'pad' ? view : 'auto', id: TAB_ID.test(id) ? id : '', pub: q.get('pub') === '1', big: q.get('big') === '1' };
}

/** 연결 하나에 붙여 두는 값. 방이 잠들었다 깨어도 이 값으로 다시 세운다(방장의 것에만 방 정보가 함께 있다). */
export type Saved = {
  code: string; seat: number; key: number; rank: number; view: View; id: string; host: boolean; info?: RoomInfo;
  /** 교사 방에서만: 방을 만든 연결, 교사로 확인된 연결, 승인된 닉네임, 승인을 기다리는 닉네임, 교사 방 정보(방장과 교사의 것에), 판이 열린 때(방장의 것에). */
  maker?: boolean; teacher?: boolean; nick?: string; ask?: string; cls?: Klass; at?: number;
  /** 방장의 것에: 지금 판이 순위에 오를 수 있는가(교사의 기기가 열었고 그 뒤로 방장이 교사 아닌 기기로 넘어간 적이 없다). */
  ok?: boolean;
};

type Conn<S> = {
  sock: S; seat: number; key: number; rank: number; view: View; id: string; host: boolean; tokens: number; at: number; seen: number; viewAt: number;
  maker: boolean; teacher: boolean; nick: string; ask: string; askAt: number; passAt: number;
};

export type Out<S> = {
  send(sock: S, text: string): void;
  close(sock: S, code: number, reason: string): void;
  /** 연결에 붙여 둘 값이 바뀌었다(없어도 된다). */
  save?(sock: S, saved: Saved): void;
  /** 공개 방 목록에 올리거나(값), 내린다(null). */
  lobby?(code: string, room: PublicRoom | null): void;
  /** 연결 두드리기('ping')에 마지막으로 답한 때(밀리초). 모르면 0. 방을 깨우지 않고 오가는 것이라 방은 이 값으로만 안다. */
  pinged?(sock: S): number;
  /** 출입증을 받았다. 서명을 확인한 뒤 grant() 를 불러 준다(확인은 시간이 걸려 방 밖에서 한다). 없으면 어떤 출입증도 받지 않는다. */
  pass?(seat: number, key: number, pass: string, setup: { title: string; rank: boolean; agree: boolean }): void;
  /** 선생님이 선생님 방 안내에 동의했다(도름스에 적어 둔다). */
  agree?(report: { teacher: string; version: number }): void;
  /** 순위에 올릴 기록. 도름스에 적은 뒤 ranked() 를 불러 준다. */
  rank?(report: RankReport): void;
  /** 교사 방에서 어떤 팩이 처음 열렸다. */
  use?(report: UseReport): void;
};

const bytes = (s: string) => (s.length * 3 < 256 ? s.length : new TextEncoder().encode(s).length);

/**
 * 방 하나. 방장은 가장 먼저 들어온 연결이고, 방장이 나가면 그다음으로 오래된 연결이 방장이 된다
 * (게임 화면을 보고 있는 연결을 먼저 고른다. 조작기만 쓰는 연결은 세계를 갖고 있지 않아서다).
 */
export class RoomCore<S> {
  code = '';
  info: RoomInfo = emptyRoom();
  private conns = new Map<number, Conn<S>>();
  private nextKey = 1;
  private nextRank = 1;
  private told = '';          // 공개 방 목록에 마지막으로 알린 값
  private toldAt = 0;
  private clock = 0;          // 마지막으로 본 때(밀리초)
  private sweptAt = 0;        // 마지막으로 죽은 연결을 치운 때
  private cls: Klass | null = null;      // 교사 방이면 그 정보(보통 방은 null)
  private runAt = 0;                     // 지금 판이 열린 때(밀리초). 모르면 0
  private runOk = false;                 // 지금 판을 교사의 기기가 열었는가(그런 판만 순위에 오른다)
  private used = new Set<string>();      // 이 방에서 열어 본 팩(쓰임 알림은 팩마다 한 번, 한 방에서 열두 팩까지)
  private rankTimes: number[] = [];      // 지난 1분 동안 순위를 올린 때들
  private rankedIds = new Set<string>();    // 순위에 올린 (팩|스테이지|판)

  constructor(private out: Out<S>) {}

  get size() { return this.conns.size; }
  get hostSeat() { for (const c of this.conns.values()) if (c.host) return c.seat; return -1; }
  seats(): [number, 0 | 1][] { return [...this.conns.values()].sort((a, b) => a.seat - b.seat).map(c => [c.seat, c.view === 'pad' ? 1 : 0]); }
  /** 교사 방인가. */
  get isClass() { return !!this.cls; }
  private pubClass() { return this.cls ? { title: this.cls.title, rank: this.cls.rank ? 1 : 0, t: [...this.conns.values()].filter(c => c.teacher).map(c => c.seat).sort((a, b) => a - b) } : null; }
  private nameList(): NameList { return [...this.conns.values()].filter(c => c.nick).sort((a, b) => a.seat - b.seat).map(c => [c.seat, c.nick]); }
  /** 교사 방 정보와 승인된 닉네임을 모두에게. */
  private tellClass() { this.toAll(JSON.stringify({ t: 'class', cls: this.pubClass(), names: this.nameList() })); }
  /** 승인을 기다리는 닉네임을 교사 연결에게만(신청한 차례대로). */
  private tellAsks(only?: Conn<S>) {
    const list = [...this.conns.values()].filter(c => c.ask).sort((a, b) => a.askAt - b.askAt || a.seat - b.seat).map(c => [c.seat, c.ask]);
    const text = JSON.stringify({ t: 'asks', list });
    for (const c of this.conns.values()) if (c.teacher && (!only || c === only)) this.out.send(c.sock, text);
  }
  /** 교사 방에서 어떤 팩이 처음 열리면 한 번 알린다. */
  private useNow() {
    const pack = this.info.pack;
    // 방 정보의 팩 · 스테이지는 방장이 준 값이다: 바깥(도름스)에 알리기 전에 모양과 범위를 다시 본다
    if (!this.cls || !PACK_ID.test(pack) || !int(this.info.stage, 0, RANK.stages - 1) || this.used.has(pack) || this.used.size >= 12) return;
    this.used.add(pack);
    this.out.use?.({ pack, teacher: this.cls.u });
  }

  /** 잠들었다 깬 방을 연결에 붙여 둔 값으로 다시 세운다. */
  restore(sock: S, s: Saved) {
    if (!validRoomCode(s.code) || !int(s.seat, 0, MAX_SEATS - 1) || this.conns.has(s.seat)) return;
    this.code = s.code;
    if (!int(s.key, 1, Number.MAX_SAFE_INTEGER) || !int(s.rank, 1, Number.MAX_SAFE_INTEGER) || (s.view !== 'play' && s.view !== 'pad')) return;
    this.conns.set(s.seat, {
      sock, seat: s.seat, key: s.key, rank: s.rank, view: s.view, id: typeof s.id === 'string' && TAB_ID.test(s.id) ? s.id : '', host: s.host === true, tokens: LIMITS.burst, at: 0, seen: 0, viewAt: 0,
      maker: s.maker === true, teacher: s.teacher === true, nick: cleanNick(s.nick), ask: cleanNick(s.ask), askAt: 0, passAt: 0,
    });
    this.nextKey = Math.max(this.nextKey, s.key + 1); this.nextRank = Math.max(this.nextRank, s.rank + 1);
    if (s.host && s.info) { this.info = cleanRoomInfo(s.info) ?? this.info; this.runAt = int(s.at, 0, Number.MAX_SAFE_INTEGER) ? s.at : 0; this.runOk = s.ok === true && !!s.teacher; }
    if (s.cls && (!this.cls || s.host)) this.cls = cleanKlass(s.cls) ?? this.cls;
  }

  private save(c: Conn<S>) {
    this.out.save?.(c.sock, {
      code: this.code, seat: c.seat, key: c.key, rank: c.rank, view: c.view, id: c.id, host: c.host, ...(c.host ? { info: this.info } : {}),
      ...(c.maker ? { maker: true } : {}), ...(c.teacher ? { teacher: true } : {}), ...(c.nick ? { nick: c.nick } : {}), ...(c.ask ? { ask: c.ask } : {}),
      ...(this.cls && (c.host || c.teacher) ? { cls: this.cls, ...(c.host ? { at: this.runAt, ...(this.runOk ? { ok: true } : {}) } : {}) } : {}),
    });
  }
  /** 교사 방 정보가 바뀌었다: 그 값을 들고 있는 연결(방장과 교사)의 붙임값을 고친다. */
  private saveClass() { for (const c of this.conns.values()) if (c.host || c.teacher) this.save(c); }
  private toAll(text: string, but?: Conn<S>) { for (const c of this.conns.values()) if (c !== but) this.out.send(c.sock, text); }
  private who() { this.toAll(JSON.stringify({ t: 'who', host: this.hostSeat, seats: this.seats() })); }
  /**
   * 공개 방 목록에 지금 상태를 알린다: 공개 방이면 값, 비공개이거나 빈 방이면 내리기(null).
   * - 목록이 이 방을 어떻게 알고 있는지 모를 때(방이 막 생겼거나 잠들었다 깬 때, told 가 '')는 비공개여도 한 번 내린다.
   *   같은 코드의 옛 공개 방이나, 잠들기 전의 공개 상태가 목록에 남아 있을 수 있어서다.
   * - 달라진 것이 없으면 다시 알리지 않는다. 공개 방만 10초마다 살아 있음을 알린다(목록은 30초 뒤 지운다).
   * - 올리기든 내리기든, 한 방이 목록을 두드리는 것은 1초에 한 번까지다(공개와 비공개를 번갈아 바꿔도 같다).
   *   밀린 마지막 상태는 방장의 다음 살아 있음 알림 때 간다. 다만 마지막 사람이 나가 빈 방은 미루지 않고 바로 내린다(뒤에 알릴 사람이 없다).
   */
  private report() {
    if (!this.out.lobby || !this.code) return;
    const room = this.info.pub && this.conns.size > 0 ? { code: this.code, pack: this.info.pack, stage: this.info.stage, count: this.conns.size } : null;
    const now = JSON.stringify(room), since = this.clock - this.toldAt;
    if (this.told === now) { if (!room || since < REPORT_KEEP) return; }
    else if (this.told !== '' && since < REPORT_GAP && this.conns.size > 0) return;
    this.told = now; this.toldAt = this.clock;
    this.out.lobby(this.code, room);
  }
  /** 한참 소식이 없는 연결을 끊어 자리를 비운다(죽은 연결이 자리와 도름이를 붙잡고 있지 않게). */
  private sweep() {
    this.sweptAt = this.clock;
    const lastOf = (c: Conn<S>) => Math.max(c.seen, this.out.pinged?.(c.sock) ?? 0);
    for (const c of [...this.conns.values()]) {
      const last = lastOf(c);
      if (last > 0 && this.clock - last > IDLE_MS) this.kick(c, CLOSE.bad, 'idle');
    }
    // 소식이 끊긴 방장: 자리는 두고 방장만 살아 있는 다음 사람에게 넘긴다. 넘길 사람이 없으면 그대로 둔다
    const h = [...this.conns.values()].find(c => c.host), hl = h ? lastOf(h) : 0;
    if (h && hl > 0 && this.clock - hl > HOST_QUIET_MS) {
      const alive = (c: Conn<S>) => { const l = lastOf(c); return l > 0 && this.clock - l <= HOST_QUIET_MS; };
      const next = [...this.conns.values()].filter(c => c !== h && alive(c)).sort((a, b) => a.rank - b.rank);
      const pick = next.find(c => c.view === 'play') ?? next[0];
      if (pick) {
        h.host = false; pick.host = true; pick.view = 'play';
        if (!pick.teacher) this.runOk = false;
        this.save(h); this.save(pick); this.who();
      }
    }
  }
  /** 방 서버의 알람이 부른다: 아무 글이 오지 않아도 죽은 연결과 소식이 끊긴 방장을 치운다. 방이 비면 false(알람을 더 걸지 않는다). */
  tick(now: number): boolean {
    this.clock = Math.max(this.clock, now);
    if (this.conns.size) this.sweep();
    return this.conns.size > 0;
  }
  /** 방장이 없으면 새로 뽑는다. 뽑았으면 true. */
  private elect(skip?: Conn<S>): boolean {
    if (this.hostSeat >= 0) return false;
    const live = [...this.conns.values()].filter(c => c !== skip).sort((a, b) => a.rank - b.rank);
    const next = live.find(c => c.view === 'play') ?? live[0];
    if (!next) return false;
    next.host = true; next.view = 'play';
    if (!next.teacher) this.runOk = false;   // 방장이 교사 아닌 기기로 넘어간 판은 순위에 오르지 않는다(그 기기가 세계를 꾸며 돌려줄 수 있다. 보안 검토 2026-11-22)
    this.save(next);
    return true;
  }

  /** 들어오지 못한 연결에는 까닭 번호를 글로 먼저 알리고 끊는다(끊김 번호가 늦게 닿는 경우에도 까닭을 알 수 있게). */
  private refuse(sock: S, code: number, reason: string): null {
    this.out.send(sock, JSON.stringify({ t: 'no', c: code }));
    this.out.close(sock, code, reason);
    return null;
  }

  /** 들어올 수 있는지만 본다. 못 들어오면 [까닭 번호, 까닭]. now 는 밀리초. */
  check(code: string, q: JoinQuery, now = Date.now()): [number, string] | null {
    if (!validRoomCode(code)) return [CLOSE.bad, 'code'];
    this.clock = Math.max(this.clock, now);
    this.sweep();
    const same = q.id ? [...this.conns.values()].find(c => c.id === q.id) : undefined;
    if (q.mode === 'create' && this.conns.size > 0 && !same) return [CLOSE.taken, 'taken'];
    if (q.mode === 'join' && this.conns.size === 0) return [CLOSE.none, 'none'];
    if (!same && this.conns.size >= MAX_SEATS) return [CLOSE.full, 'full'];
    return null;
  }

  /** 새 연결. 들어오지 못하면 까닭을 알리고 끊은 뒤 null 을 돌려준다. */
  join(sock: S, code: string, q: JoinQuery, now = Date.now()): Saved | null {
    const no = this.check(code, q, now);
    if (no) return this.refuse(sock, no[0], no[1]);
    const same = q.id ? [...this.conns.values()].find(c => c.id === q.id) : undefined;
    const first = this.conns.size === 0;
    if (first) { this.code = code; this.info = emptyRoom(q.pub, q.big); this.told = ''; this.cls = null; this.runAt = 0; this.runOk = false; this.rankTimes = []; this.rankedIds.clear(); this.used.clear(); }

    let conn: Conn<S>;
    if (same) {
      // 같은 창이 다시 붙었다(와이파이가 잠깐 끊긴 경우). 앉아 있던 자리를 그대로 잇고 옛 연결은 끊는다.
      this.out.close(same.sock, CLOSE.replaced, 'replaced');
      // 교사 확인은 연결마다 다시 한다(화면이 들어올 때마다 출입증을 다시 낸다)
      conn = { ...same, sock, key: this.nextKey++, tokens: LIMITS.burst, at: 0, seen: now, teacher: false, passAt: 0 };
      if (!conn.host && q.view !== 'auto') conn.view = q.view;
    } else {
      let seat = 0; while (this.conns.has(seat)) seat++;
      const host = this.hostSeat < 0;
      const view: View = host ? 'play' : q.view === 'auto' ? (this.info.big ? 'pad' : 'play') : q.view;
      conn = { sock, seat, key: this.nextKey++, rank: this.nextRank++, view, id: q.id, host, tokens: LIMITS.burst, at: 0, seen: now, viewAt: 0, maker: first && q.mode === 'create', teacher: false, nick: '', ask: '', askAt: 0, passAt: 0 };
    }
    this.conns.set(conn.seat, conn);
    this.save(conn);
    // 교사 방이면 방 제목 · 승인된 닉네임 · 내가 신청해 둔 닉네임을 함께 알린다(보통 방의 인사는 그대로다)
    this.out.send(sock, JSON.stringify({ t: 'hi', me: conn.seat, host: this.hostSeat, seats: this.seats(), room: this.info, ...(this.cls ? { cls: this.pubClass(), names: this.nameList(), ask: conn.ask } : {}) }));
    this.toAll(JSON.stringify({ t: 'who', host: this.hostSeat, seats: this.seats() }), conn);
    if (same?.teacher && this.cls) this.toAll(JSON.stringify({ t: 'class', cls: this.pubClass(), names: this.nameList() }), conn);
    this.report();
    return { code: this.code, seat: conn.seat, key: conn.key, rank: conn.rank, view: conn.view, id: conn.id, host: conn.host };
  }

  /** 연결이 끊겼다. key 가 다르면 이미 다른 연결이 그 자리를 이은 것이라 아무것도 하지 않는다. */
  leave(seat: number, key: number) {
    const c = this.conns.get(seat);
    if (!c || c.key !== key) return;
    this.conns.delete(seat);
    if (c.host) this.elect();
    if (this.conns.size) {
      this.who();
      if (this.cls && (c.teacher || c.nick)) this.tellClass();
      if (this.cls && c.ask) this.tellAsks();
    }
    this.report();
  }

  /**
   * 출입증 확인이 끝났다(claims 가 null 이면 서명이나 기한이 틀렸다).
   * 방을 만든 연결의 출입증이면 이 방이 교사 방이 되고, 이미 교사 방이면 같은 교사의 출입증만 교사 연결로 받는다.
   * 출입증은 방에 묶이지 않는다: 한 교사가 여러 방을 열 수 있다. 다만 남이 연 방을 출입증으로 차지할 수는 없다.
   */
  grant(seat: number, key: number, claims: PassClaims | null, setup: { title: string; rank: boolean; agree?: boolean }, now = Date.now()) {
    const c = this.conns.get(seat);
    if (!c || c.key !== key) return;
    this.clock = Math.max(this.clock, now);
    let ok = false;
    // 선생님 방은 안내에 동의한 선생님만 연다(전에 동의해 출입증에 적혀 있거나, 지금 동의했거나). 아니면 보통 방으로 남는다
    const agreed = !!claims && (claims.c >= NOTICE || setup.agree === true);
    if (claims && !this.cls && c.maker && agreed) { if (claims.c < NOTICE) this.out.agree?.({ teacher: claims.u, version: NOTICE }); this.cls = { u: claims.u, n: claims.n, title: setup.title, rank: setup.rank && !!setup.title, done: -1, big: this.info.big }; ok = true; }
    else if (claims && this.cls && this.cls.u === claims.u) ok = true;
    this.out.send(c.sock, `{"t":"pass","ok":${ok ? 1 : 0}}`);
    if (!ok) return;
    c.teacher = true;
    this.saveClass();
    this.tellClass();
    this.tellAsks(c);
    this.useNow();
  }

  /** 도름스에 순위를 적고 왔다. rank 가 0 이면 적지 못했다. */
  ranked(run: number, ms: number, rank: number, best: boolean) {
    if (!this.cls || this.cls.done !== run || !this.conns.size) return;
    this.toAll(JSON.stringify({ t: 'rank', r: run, ms, rank: int(rank, 1, 1_000_000) ? rank : 0, best: best ? 1 : 0 }));
  }

  /** 받은 글 한 통. now 는 밀리초. */
  message(seat: number, key: number, text: string, now: number) {
    const c = this.conns.get(seat);
    if (!c || c.key !== key) return;
    this.clock = Math.max(this.clock, now); c.seen = now;
    if (this.clock - this.sweptAt >= SWEEP_GAP) { this.sweep(); if (this.conns.get(seat) !== c) return; }   // 손님 글이 올 때도 가끔 치운다(보낸 사람이 방금 방장을 넘겨받았을 수 있다)
    // 빈도: 초당 40통까지(잠깐 몰리는 것은 80통까지 봐준다). 넘으면 끊는다.
    c.tokens = Math.min(LIMITS.burst, c.tokens + (c.at ? (now - c.at) * LIMITS.perSec / 1000 : 0)); c.at = now;
    if (--c.tokens < 0) return this.kick(c, CLOSE.tooFast, 'fast');
    const size = bytes(text);
    // 손님 글은 256바이트까지. 출입증을 내는 글만 1KB 까지 받는다(방장이 아닌 교사도 낼 수 있게)
    if (size > (c.host ? LIMITS.snap : text.startsWith('{"t":"pass",') ? LIMITS.pass : text.startsWith('{"t":"g",') ? LIMITS.order : LIMITS.guest)) return this.kick(c, CLOSE.tooBig, 'big');
    let msg: unknown;
    try { msg = JSON.parse(text); } catch { return; }
    if (!msg || typeof msg !== 'object') return;
    const t = (msg as { t?: unknown }).t;

    if (t === 'p') {                                   // 조작 신호: 손님 → 방장에게만
      if (c.host) return;
      const pad = cleanPad(msg), host = this.conns.get(this.hostSeat);
      if (pad && host) this.out.send(host.sock, JSON.stringify({ t: 'p', s: c.seat, ...pad }));
    } else if (t === 'g') {                            // 그래프 공장 주문(식, 손잡이): 손님 → 방장에게만. 모양을 검사한 값으로 다시 써서 넘긴다
      if (c.host) return;
      const order = cleanOrder(msg), host = this.conns.get(this.hostSeat);
      if (order && host) this.out.send(host.sock, JSON.stringify({ t: 'g', s: c.seat, o: order }));
    } else if (t === 's') {                            // 세계 요약: 방장 → 게임 화면을 보는 손님에게
      if (!c.host) return;
      for (const o of this.conns.values()) if (o !== c && o.view === 'play') this.out.send(o.sock, text);
    } else if (t === 'room') {                         // 방 정보: 방장만 바꾼다
      if (!c.host || size > LIMITS.host) return;
      const info = cleanRoomInfo((msg as { room?: unknown }).room);
      if (!info) return;
      const was = this.info;
      this.info = info;
      if (info.stage >= 0 && (info.run !== was.run || info.pack !== was.pack || info.stage !== was.stage)) { this.runAt = now; this.runOk = !!c.teacher; }   // 새 판이 열렸다(교사의 기기가 연 판만 순위에 오른다)
      this.save(c);
      this.toAll(JSON.stringify({ t: 'room', room: info }), c);
      this.report();
      this.useNow();
    } else if (t === 'claim') {                        // 교사가 방장을 돌려받는다: 학생 기기가 방장일 때만. 순위는 교사의 기기가 방장일 때만 오르기 때문이다
      // 출입증을 확인하자마자 넘기지 않고 교사 화면이 청할 때 넘긴다: 게임 도중이면 그 판의 요약을 받은 뒤에 청해야 받은 데서 이어 굴릴 수 있다(바로 넘기면 판이 처음으로 돌아갔다)
      if (!this.cls || !c.teacher || c.host || c.view !== 'play') return;
      const hostNow = [...this.conns.values()].find(x => x.host);
      if (!hostNow || hostNow.teacher) return;
      hostNow.host = false; c.host = true;
      this.save(hostNow); this.save(c); this.who();
    } else if (t === 'view') {                         // 게임 화면으로 볼지, 조작기로만 쓸지
      const v = (msg as { v?: unknown }).v;
      if (c.host || (v !== 'play' && v !== 'pad') || v === c.view || now - c.viewAt < 1000) return;   // 바꿀 때마다 모두에게 알리므로 1초에 한 번만
      c.view = v; c.viewAt = now; this.save(c); this.who();
    } else if (t === 'yield') {                        // 방장이 자리를 비운다(화면을 내려 둠): 게임 화면을 보는 다음 사람에게 넘긴다
      if (!c.host) return;
      const next = [...this.conns.values()].filter(o => o !== c && o.view === 'play').sort((a, b) => a.rank - b.rank)[0];
      if (!next) return;
      c.host = false; next.host = true;
      if (!next.teacher) this.runOk = false;
      this.save(c); this.save(next); this.who();
    } else if (t === 'hb') {                           // 방장의 살아 있음 알림: 공개 방 목록을 새로 고친다
      if (!c.host) return;
      this.sweep();
      this.report();
      this.out.send(c.sock, '{"t":"hb"}');
    } else if (t === 'pass') {                         // 교사 출입증: 누구나 낼 수 있지만 3초에 한 번, 확인은 방 밖(서명)에서 하고 grant() 로 돌아온다
      const o = msg as { v?: unknown; title?: unknown; rank?: unknown };
      if (typeof o.v !== 'string' || o.v.length > PASS_MAX || (c.passAt && now - c.passAt < PASS_GAP)) return;
      c.passAt = now || 1;
      if (!this.out.pass) { this.out.send(c.sock, '{"t":"pass","ok":0}'); return; }
      this.out.pass(seat, key, o.v, { title: cleanTitle(o.title), rank: o.rank === 1, agree: (o as { agree?: unknown }).agree === NOTICE });
    } else if (t === 'name') {                         // 닉네임 신청: 교사 방에서만, 연결마다 10초에 한 번. 교사가 승인해야 보인다
      if (!this.cls) return;                           // 학생끼리 연 방에는 닉네임이 없다
      const v = cleanNick((msg as { v?: unknown }).v);
      if (!v) { this.out.send(c.sock, '{"t":"me","st":"bad"}'); return; }
      if (c.askAt && now - c.askAt < ASK_GAP) { this.out.send(c.sock, '{"t":"me","st":"slow"}'); return; }
      c.askAt = now || 1;
      const had = c.ask;
      c.ask = v === c.nick ? '' : v;                   // 이미 승인된 닉네임을 다시 보냈으면 기다릴 것이 없다
      this.save(c);
      this.out.send(c.sock, JSON.stringify({ t: 'me', st: c.ask ? 'wait' : 'ok', v }));
      if (c.ask || had) this.tellAsks();
    } else if (t === 'ok') {                           // 교사: 닉네임을 승인(y 1)하거나 반려(y 0)한다. v 는 교사가 본 그 닉네임(그새 바뀐 신청을 잘못 승인하지 않게)
      if (!this.cls || !c.teacher) return;
      const o = msg as { s?: unknown; y?: unknown; v?: unknown }, to = int(o.s, 0, MAX_SEATS - 1) ? this.conns.get(o.s) : undefined, v = cleanNick(o.v);
      if (!to || !v) return;
      if (o.y === 1 && to.ask === v) { to.nick = v; to.ask = ''; this.out.send(to.sock, JSON.stringify({ t: 'me', st: 'ok', v })); this.tellClass(); }
      else if (o.y === 0 && to.ask === v) { to.ask = ''; this.out.send(to.sock, '{"t":"me","st":"no"}'); }
      else if (o.y === 0 && to.nick === v) { to.nick = ''; this.out.send(to.sock, '{"t":"me","st":"no"}'); this.tellClass(); }   // 이미 승인한 닉네임을 지운다
      else return;
      if (o.y === 0) to.askAt = 0;                     // 반려받은 학생은 10초를 기다리지 않고 바로 다시 적을 수 있다(교사가 한 번 볼 때마다 한 번)
      this.save(to);
      this.tellAsks();
    } else if (t === 'won') {                          // 방장: 스테이지를 다 함께 깼다. 교사 방이고 순위에 올리기가 켜져 있을 때만 도름스에 적는다
      const k = this.cls, o = msg as { r?: unknown; ms?: unknown }, { pack, stage, run } = this.info;
      // 순위를 알릴 수 있는 것은 교사의 기기가 방장일 때뿐이다. 판이 열린 때도 걸린 시간도 방장의 글에 기대므로, 그 방장이 로그인한 교사 본인이어야 기록을 믿을 수 있다(보안 검토 2026-11-22). 교사 화면이 내려가 학생 기기가 방장을 넘겨받은 동안의 기록은 올리지 않는다
      if (!c.host || !c.teacher || !this.runOk || !k?.rank || !k.title || !this.out.rank) return;
      if (k.done === run) return;   // 같은 판은 한 번만. 이 값은 방이 잠들었다 깨도 남는다(메모리의 rankedIds 는 사라진다)
      // 지금 열려 있는 판만. 팩 · 스테이지는 방장이 준 값이라 모양과 범위를 다시 본다(실린 팩인지는 도름스가 본다)
      if (!int(o.r, 0, 1_000_000_000) || o.r !== run || !PACK_ID.test(pack) || !int(stage, 0, RANK.stages - 1)) return;
      // 걸린 시간은 방 서버가 잰다. 방장이 알린 시간은 그것과 양쪽으로 가까울 때만 받는다(실제보다 짧게 알려 순위를 꾸미지 못한다)
      const took = this.runAt ? now - this.runAt : -1;
      if (!int(took, RANK.min, RANK.max) || !int(o.ms, RANK.min, RANK.max) || o.ms > took + RANK.slack || o.ms < took - RANK.under) return;
      const id = `${pack}|${stage}|${run}`;
      this.rankTimes = this.rankTimes.filter(at => now - at < 60_000);
      if (this.rankedIds.has(id) || this.rankTimes.length >= RANK.perMin) return;   // 같은 판은 한 번, 방 전체로 1분에 여섯 번까지
      // 사람 수는 방 서버가 아는 자리 수다(방장이 준 차례를 쓰지 않는다). 함께 보기로 만든 방에서 방을 만든 기기가 방장이면 그 큰 화면 한 자리는 뺀다
      const players = Math.max(1, this.conns.size - (k.big && c.maker ? 1 : 0));
      if (this.rankedIds.size >= 500) this.rankedIds.clear();
      this.rankedIds.add(id); this.rankTimes.push(now);
      k.done = run;
      this.saveClass();
      this.out.rank({ run, pack, stage, ms: took, players, title: k.title, teacher: k.u });
    }
  }

  private kick(c: Conn<S>, code: number, reason: string) {
    this.out.close(c.sock, code, reason);
    this.leave(c.seat, c.key);
  }
}

/** 공개 방 목록. 30초 넘게 소식이 없는 방은 뺀다. */
export class PublicList {
  private rooms = new Map<string, PublicRoom & { at: number }>();
  report(code: string, room: PublicRoom | null, now: number) {
    if (!validRoomCode(code)) return;
    if (!room) { this.rooms.delete(code); return; }
    if (this.rooms.size >= 500 && !this.rooms.has(code)) this.list(now);          // 넘치면 묵은 것부터 치운다
    if (this.rooms.size >= 500 && !this.rooms.has(code)) return;
    this.rooms.set(code, { code, pack: String(room.pack).slice(0, 64), stage: room.stage | 0, count: Math.max(0, Math.min(MAX_SEATS, room.count | 0)), at: now });
  }
  list(now: number): PublicRoom[] {
    for (const [code, r] of this.rooms) if (now - r.at > PUBLIC_TTL) this.rooms.delete(code);
    return [...this.rooms.values()].sort((a, b) => b.count - a.count || a.code.localeCompare(b.code)).slice(0, 50).map(({ code, pack, stage, count }) => ({ code, pack, stage, count }));
  }
}

// ---------- 방 마구 만들기 · 방 코드 훑기 막기 ----------
/**
 * 같은 인터넷 주소에서: 방 만들기는 1분에 30번, 한 시간에 300번까지(학교는 모든 기기가 한 주소로 나가 컴퓨터실 여러 모둠이 한꺼번에 만든다). 서로 다른 틀린 방 코드를 1분에 30개 넘게 넣으면 그 주소의 들어오기를 1분 쉰다.
 * 맞는 코드로 들어오는 것은 세지 않는다(한 반 30명이 같은 주소에서 한꺼번에 들어와도 걸리지 않는다).
 * 틀린 코드는 '서로 다른 코드'로 센다: 방 서버가 새로 뜬 직후 한 반이 같은 코드를 여러 번 두드리는 것은 훑기가 아니다.
 */
export const GATE = { createPerMin: 30, createPerHour: 300, wrongCodes: 30, restMs: 60_000, keys: 5000 } as const;
export class Gate {
  private seen = new Map<string, { made: number[]; wrong: Map<string, number>; rest: number; at: number }>();
  private of(key: string, now: number) {
    let e = this.seen.get(key);
    if (!e) {
      if (this.seen.size >= GATE.keys) for (const [k, v] of this.seen) if (now - v.at > 3600_000 || this.seen.size >= GATE.keys) { this.seen.delete(k); if (this.seen.size < GATE.keys * 0.9) break; }
      this.seen.set(key, e = { made: [], wrong: new Map(), rest: 0, at: now });
    }
    e.at = now;
    e.made = e.made.filter(t => now - t < 3600_000);
    for (const [code, t] of e.wrong) if (now - t >= 60_000) e.wrong.delete(code);
    return e;
  }
  /** 방을 만들어도 되는가. 되면 한 번으로 센다. */
  create(key: string, now: number): boolean {
    const e = this.of(key, now);
    if (e.made.length >= GATE.createPerHour || e.made.filter(t => now - t < 60_000).length >= GATE.createPerMin) return false;
    e.made.push(now);
    return true;
  }
  /** 들어와도 되는가(쉬는 중이 아니면 된다). */
  join(key: string, now: number): boolean { return now >= this.of(key, now).rest; }
  /** 없는 방 코드를 넣었다. */
  miss(key: string, code: string, now: number) {
    const e = this.of(key, now);
    e.wrong.set(code, now);
    if (e.wrong.size > GATE.wrongCodes) { e.rest = now + GATE.restMs; e.wrong.clear(); }
  }
  get size() { return this.seen.size; }
}
/** 주소를 세는 단위로 줄인다: IPv4 는 그대로, IPv6 는 앞 64비트(한 집 · 한 학교가 받는 묶음). */
export function ipKey(ip: string | null | undefined): string {
  const s = (ip ?? '').trim().toLowerCase().slice(0, 64);
  if (!s.includes(':')) return s;
  const [head, tail = ''] = s.split('::'), a = head ? head.split(':') : [], b = tail ? tail.split(':') : [];
  const full = s.includes('::') ? [...a, ...Array(Math.max(0, 8 - a.length - b.length)).fill('0'), ...b] : a;
  return full.slice(0, 4).map(h => h.replace(/^0+(?=.)/, '')).join(':') + '::/64';
}
