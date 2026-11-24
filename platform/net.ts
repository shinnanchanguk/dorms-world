/**
 * 방 연결. 화면(DOM)을 쓰지 않는다: 브라우저에서도, 시험 스크립트(Node)에서도 그대로 돈다.
 * 연결이 끊기면 몇 번 다시 붙어 보고, 그래도 안 되면 까닭을 알려 준다.
 * 받은 글은 모두 남이 보낸 것이라 모양을 검사하고 나서 넘긴다.
 */
import { CLOSE, cleanNick, cleanPad, cleanRoomInfo, cleanTitle, emptyRoom, MAX_SEATS, RANK, readClassInfo, readNames, type ClassInfo, type NameList, type PublicRoom, type RoomInfo, type View, type WirePad, NOTICE } from './room-rules';
import { validRoomCode } from './room-code';
import { readWire, type Wire } from './sync';
import type { Pad } from './sim';
import { cleanOrder, type Order } from './graph/order';

export type Seat = { seat: number; view: View };
/** 방에서 나오게 된 까닭. */
export type Down = 'full' | 'none' | 'taken' | 'fast' | 'lost' | 'left';

/** 내가 신청한 닉네임이 어떻게 됐는지: wait 선생님이 보는 중, ok 승인, no 반려, bad 쓸 수 없는 글, slow 너무 자주 보냄. */
export type NickState = 'wait' | 'ok' | 'no' | 'bad' | 'slow';
/** 순위에 올린 기록. rank 가 0 이면 올리지 못했다. */
export type RankNews = { run: number; ms: number; rank: number; best: boolean };

export type RoomEvents = {
  /** 방에 들어왔다(다시 붙었을 때도 온다). */
  hello?(link: RoomLink): void;
  /** 사람이 들고 났거나 방장이 바뀌었다. */
  who?(link: RoomLink): void;
  /** 방 정보가 바뀌었다(방장이 스테이지를 고름). */
  room?(link: RoomLink, before: RoomInfo): void;
  /** 방장에게만: 손님의 조작 신호. */
  pad?(seat: number, pad: Pad): void;
  /** 방장: 손님이 그래프 공장에 넣은 주문. */
  order?(seat: number, order: Order): void;
  /** 손님에게만: 방장이 보낸 세계 요약. */
  snap?(wire: Wire): void;
  /** 연결이 끊겨 다시 붙는 중이다(몇 번째인지). 0 이면 다시 붙었다. */
  retry?(attempt: number): void;
  /** 방에서 나왔다(더는 다시 붙지 않는다). */
  down?(why: Down): void;
  /** 교사 방 정보 · 승인된 닉네임 · (교사에게만) 승인을 기다리는 닉네임이 바뀌었다. */
  klass?(link: RoomLink): void;
  /** 내가 낸 출입증을 방 서버가 확인했다(true) 또는 받지 않았다(false: 서명 · 기한이 틀렸거나, 답이 없다). */
  pass?(ok: boolean): void;
  /** 내가 신청한 닉네임의 결과. */
  nick?(state: NickState, nick: string): void;
  /** 순위에 올린 기록의 등수가 왔다. */
  rank?(news: RankNews): void;
};

/** pass 를 주면 들어올 때마다(다시 붙을 때도) 출입증을 낸다. title · rank 는 방을 만들 때만 쓰인다. */
export type JoinOptions = { create?: boolean; view?: View | 'auto'; pub?: boolean; big?: boolean; id?: string; retries?: number; socket?: typeof WebSocket; pass?: string; title?: string; rank?: boolean; agree?: boolean };

const RETRY_MS = [400, 900, 1800, 3500, 5000];
/**
 * 이미 자리를 받았던 사람은 더 오래 다시 붙어 본다(5초 간격으로, 모두 합쳐 1분 조금 못 되게).
 * 휴대폰이 잠깐 잠들거나 와이파이 공유기가 바뀌면 12초로는 모자라다. 방 서버는 자리를 IDLE_MS(1분) 동안 두니 그 안에 돌아오면 같은 자리를 잇는다.
 */
const SEATED_TRIES = 15;
const QUIET_MS = 25_000, PING_MS = 10_000, HB_MS = 5_000, PASS_WAIT_MS = 5_000;

export const wsBase = (base: string) => base.replace(/\/+$/, '').replace(/^http/, 'ws');

export class RoomLink {
  me = -1;
  host = -1;
  seats: Seat[] = [];
  room: RoomInfo = emptyRoom();
  open = false;
  private ws: WebSocket | null = null;
  private done = false;
  private tries = 0;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private beat: ReturnType<typeof setInterval> | null = null;
  private heard = 0;
  private wasHost = false;
  private remake = false;
  /** 교사 방이면 그 정보(방 제목 · 순위에 올리는지 · 교사 자리). 보통 방은 null. */
  cls: ClassInfo | null = null;
  /** 교사가 승인한 닉네임(자리 번호 → 닉네임). */
  names = new Map<number, string>();
  /** 교사에게만: 승인을 기다리는 닉네임 [[자리 번호, 닉네임]]. */
  asks: NameList = [];
  /** 이 연결이 교사로 확인됐다. */
  teacher = false;
  /** 내가 신청해 두고 기다리는 닉네임. */
  myAsk = '';
  private passTimer: ReturnType<typeof setTimeout> | null = null;
  /** 다시 붙기를 기다리는 중(타이머가 걸려 있다). */
  private waiting = false;

  constructor(private base: string, readonly code: string, private opts: JoinOptions, private ev: RoomEvents) { this.connect(!!opts.create); }

  get isHost() { return this.me >= 0 && this.me === this.host; }
  get count() { return this.seats.length; }
  viewOf(seat: number): View { return this.seats.find(s => s.seat === seat)?.view ?? 'play'; }

  private connect(create: boolean) {
    const o = this.opts, WS = o.socket ?? WebSocket;
    const q = new URLSearchParams({ mode: create ? 'create' : 'join', view: o.view ?? 'auto' });
    if (o.id) q.set('id', o.id);
    if (create && (o.pub ?? this.room.pub)) q.set('pub', '1');
    if (create && (o.big ?? this.room.big)) q.set('big', '1');
    let ws: WebSocket;
    try { ws = new WS(`${wsBase(this.base)}/room/${this.code}?${q}`); } catch { this.fail('lost'); return; }
    this.ws = ws;
    ws.onmessage = e => { if (ws === this.ws && typeof e.data === 'string') this.read(e.data); };
    ws.onclose = e => { if (ws === this.ws) this.closed(e.code); };
    // 보통은 닫힘 사건이 뒤따라 오지만, 붙지도 못한 연결에는 오지 않는 곳도 있어 잠깐 기다렸다 닫힌 것으로 친다
    ws.onerror = () => { this.later(() => { if (ws === this.ws && ws.readyState !== 1) this.closed(1006); }, 80); };
  }

  private read(text: string) {
    this.heard = Date.now();
    if (text === 'pong') return;
    let m: Record<string, unknown>;
    try { m = JSON.parse(text); } catch { return; }
    if (!m || typeof m !== 'object') return;
    if (m.t === 'no') {                               // 들어가지 못했다: 까닭 번호를 받았으니 끊김을 기다리지 않는다
      const ws = this.ws, code = typeof m.c === 'number' ? m.c : CLOSE.bad;
      this.closed(code);
      try { ws?.close(1000); } catch { /* 이미 닫힘 */ }
    } else if (m.t === 'hi') {
      const room = cleanRoomInfo(m.room);
      if (!this.readSeats(m) || !room || !this.seats.some(s => s.seat === m.me)) return;
      this.me = m.me as number;
      const again = this.tries > 0 || this.open;
      this.room = this.remake ? this.room : room;
      this.open = true; this.tries = 0; this.wasHost = this.isHost;
      this.readClass(m); this.teacher = false; this.asks = []; this.myAsk = this.cls ? cleanNick(m.ask) : '';
      this.beatStart();
      this.sendPass();
      if (this.remake) { this.remake = false; if (this.isHost) this.setRoom(this.room); }   // 혼자 있던 방을 다시 세웠다: 고르던 스테이지를 되살린다
      if (again) this.ev.retry?.(0);
      this.ev.hello?.(this);
    } else if (m.t === 'who') {
      if (!this.open || !this.readSeats(m)) return;
      this.wasHost = this.isHost;
      this.ev.who?.(this);
    } else if (m.t === 'room') {
      const room = cleanRoomInfo(m.room);
      if (!this.open || !room || this.isHost) return;
      const before = this.room; this.room = room;
      this.ev.room?.(this, before);
    } else if (m.t === 'p') {
      const pad = cleanPad(m);
      if (!this.isHost || !pad || typeof m.s !== 'number' || !Number.isInteger(m.s) || m.s < 0 || m.s >= MAX_SEATS) return;
      this.ev.pad?.(m.s, { m: pad.m, j: !!pad.j, a: !!pad.a, jn: pad.n });
    } else if (m.t === 'g') {
      const order = cleanOrder(m.o);
      if (!this.isHost || !order || typeof m.s !== 'number' || !Number.isInteger(m.s) || m.s < 0 || m.s >= MAX_SEATS) return;
      this.ev.order?.(m.s, order);
    } else if (m.t === 's') {
      if (this.isHost) return;
      const wire = readWire(m.d);
      if (wire) this.ev.snap?.(wire);
    } else if (m.t === 'class') {
      if (!this.open) return;
      this.readClass(m);
      this.ev.klass?.(this);
    } else if (m.t === 'asks') {
      if (!this.open || !this.teacher) return;
      this.asks = readNames(m.list);
      this.ev.klass?.(this);
    } else if (m.t === 'pass') {
      if (!this.open || !this.opts.pass) return;
      if (this.passTimer) { clearTimeout(this.passTimer); this.passTimer = null; }
      this.teacher = m.ok === 1;
      this.ev.pass?.(this.teacher);
    } else if (m.t === 'me') {
      const st = m.st, v = cleanNick(m.v);
      if (!this.open || (st !== 'wait' && st !== 'ok' && st !== 'no' && st !== 'bad' && st !== 'slow')) return;
      if (st === 'wait') this.myAsk = v; else if (st === 'ok' || st === 'no') this.myAsk = '';
      this.ev.nick?.(st, v);
    } else if (m.t === 'rank') {
      const ok = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
      if (!this.open || !ok(m.r, 0, 1e9) || !ok(m.ms, RANK.min, RANK.max) || !ok(m.rank, 0, 1e6)) return;
      this.ev.rank?.({ run: m.r, ms: m.ms, rank: m.rank, best: m.best === 1 });
    }
  }

  private readClass(m: Record<string, unknown>) {
    this.cls = readClassInfo(m.cls);
    this.names = new Map(this.cls ? readNames(m.names) : []);
    if (!this.cls) { this.asks = []; this.myAsk = ''; }
  }
  /** 출입증을 낸다(들어올 때마다). 답이 한참 없으면 받지 않은 것으로 친다(교사 방을 모르는 옛 방 서버). */
  private sendPass() {
    const o = this.opts;
    if (!o.pass) return;
    this.raw(JSON.stringify({ t: 'pass', v: o.pass, title: cleanTitle(o.title), rank: o.rank ? 1 : 0, agree: o.agree ? NOTICE : 0 }));
    if (this.passTimer) clearTimeout(this.passTimer);
    this.passTimer = setTimeout(() => { this.passTimer = null; if (!this.done && this.open && !this.teacher) this.ev.pass?.(false); }, PASS_WAIT_MS);
  }

  private readSeats(m: Record<string, unknown>) {
    const raw = m.seats, host = m.host;
    if (!Array.isArray(raw) || raw.length > MAX_SEATS || typeof host !== 'number') return false;
    const seats: Seat[] = [];
    for (const r of raw) {
      if (!Array.isArray(r) || !Number.isInteger(r[0]) || r[0] < 0 || r[0] >= MAX_SEATS) return false;
      seats.push({ seat: r[0], view: r[1] ? 'pad' : 'play' });
    }
    this.seats = seats; this.host = host;
    return true;
  }

  private beatStart() {
    if (this.beat) clearInterval(this.beat);
    let n = 0;
    this.heard = Date.now();
    // 2.5초마다 본다: 방장은 5초마다 살아 있음을 알리고(공개 방 목록이 이 소식으로 유지된다), 모두 10초마다 연결을 두드려 본다
    this.beat = setInterval(() => {
      n++;
      // 한참 조용하면 죽은 연결로 보고 다시 붙는다. 죽은 연결의 닫힘 확인은 한참 걸리니 기다리지 않고 바로 끊긴 것으로 친다
      if (Date.now() - this.heard > QUIET_MS) { const ws = this.ws; this.closed(1006); try { ws?.close(); } catch { /* 이미 닫힘 */ } return; }
      if (this.isHost && n % Math.round(HB_MS / 2500) === 0) this.raw('{"t":"hb"}');
      if (n % Math.round(PING_MS / 2500) === 0) this.raw('ping');
    }, 2500);
  }

  private closed(code: number) {
    this.ws = null; this.open = false;
    if (this.beat) { clearInterval(this.beat); this.beat = null; }
    if (this.done) return;
    if (code === CLOSE.full) return this.fail('full');
    if (code === CLOSE.tooFast || code === CLOSE.tooBig) return this.fail('fast');
    if (code === CLOSE.replaced) return this.fail('lost');
    if (code === CLOSE.taken) {
      if (this.remake) { this.remake = false; this.connect(false); return; }    // 그새 누가 남아 있었다: 손님으로 다시 들어간다
      return this.fail('taken');
    }
    if (code === CLOSE.none) {
      if (this.me < 0) return this.fail('none');                                 // 처음부터 없는 방
      // 다시 붙는 중인데 방이 사라졌다(방 서버가 새로 떴다): 방장이었으면 같은 코드로 다시 세운다
      if (this.wasHost && !this.remake) { this.remake = true; this.connect(true); return; }
      // 손님이었으면 방장이 방을 다시 세울 때까지 몇 번 더 두드려 본다(아래로 이어진다)
    }
    const max = this.opts.retries ?? (this.me >= 0 ? SEATED_TRIES : RETRY_MS.length);
    if (this.me < 0 && code === CLOSE.bad) return this.fail('none');
    if (this.tries >= max) return this.fail(code === CLOSE.none ? 'none' : 'lost');
    const wait = RETRY_MS[Math.min(this.tries, RETRY_MS.length - 1)];
    this.tries++;
    this.remake = false;
    this.ev.retry?.(this.tries);
    this.waiting = true;
    this.later(() => { if (!this.done && this.waiting) { this.waiting = false; this.connect(this.me < 0 && !!this.opts.create); } }, wait);
  }

  /** 와이파이가 돌아왔거나 화면이 다시 보인다: 다시 붙기를 기다리는 중이면 기다리지 않고 바로 붙어 본다. */
  nudge() {
    if (this.done || !this.waiting) return;
    this.waiting = false;
    this.connect(this.me < 0 && !!this.opts.create);
  }

  /** 잠깐 뒤에 할 일. 끝난 타이머는 목록에서 빼서, 오래 끊겼다 붙었다 해도 목록이 쌓이지 않게 한다. */
  private later(fn: () => void, ms: number) {
    const t = setTimeout(() => { this.timers = this.timers.filter(x => x !== t); fn(); }, ms);
    this.timers.push(t);
  }

  private fail(why: Down) {
    if (this.done) return;
    this.stop();
    this.ev.down?.(why);
  }
  private stop() {
    this.done = true; this.open = false; this.waiting = false;
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    if (this.passTimer) { clearTimeout(this.passTimer); this.passTimer = null; }
    if (this.beat) { clearInterval(this.beat); this.beat = null; }
    const ws = this.ws; this.ws = null;
    try { ws?.close(1000); } catch { /* 이미 닫힘 */ }
  }

  private raw(text: string) { if (this.open && this.ws?.readyState === 1) this.ws.send(text); }

  /** 손님: 내 조작을 방장에게. */
  /** 그래프 공장 주문을 방장에게(손님만). */
  sendOrder(o: Order) { if (!this.isHost) this.raw(JSON.stringify({ t: 'g', ...o })); }
  sendPad(p: Pad) { const w: WirePad = { m: p.m, j: p.j ? 1 : 0, a: p.a ? 1 : 0, n: p.jn ?? 0 }; this.raw(JSON.stringify({ t: 'p', ...w })); }
  /** 방장: 세계 요약을 모두에게. 보낸 글자 수를 돌려준다(재 보려고). */
  sendSnap(wire: Wire) { const text = JSON.stringify({ t: 's', d: wire }); if (this.isHost) this.raw(text); return text.length; }
  /** 방장: 방 정보를 바꾼다(내 쪽에는 바로 반영된다). */
  setRoom(room: RoomInfo) { if (!this.isHost) return; this.room = room; this.raw(JSON.stringify({ t: 'room', room })); }
  /** 손님: 게임 화면으로 볼지 조작기로만 쓸지. */
  setView(v: View) { if (this.isHost) return; this.opts.view = v; const s = this.seats.find(x => x.seat === this.me); if (s) s.view = v; this.raw(JSON.stringify({ t: 'view', v })); }
  /** 방장: 화면을 내려 두게 됐다. 게임 화면을 보는 다음 사람에게 방장을 넘긴다(없으면 그대로). */
  yieldHost() { if (this.isHost) this.raw('{"t":"yield"}'); }
  /** 교사: 학생 기기가 방장을 맡고 있으면 돌려받는다(방 서버가 교사인지 확인한다). */
  claimHost() { if (this.teacher && !this.isHost) this.raw('{"t":"claim"}'); }
  /** 닉네임을 신청한다(교사 방에서만. 교사가 승인해야 보인다). */
  askName(nick: string) { const v = cleanNick(nick); if (v && this.cls) this.raw(JSON.stringify({ t: 'name', v })); return !!v; }
  /** 교사: 그 자리의 닉네임을 승인하거나(yes) 반려한다. nick 은 내가 본 그 닉네임. */
  judge(seat: number, yes: boolean, nick: string) { if (this.teacher) this.raw(JSON.stringify({ t: 'ok', s: seat, y: yes ? 1 : 0, v: nick })); }
  /** 방장: 스테이지를 다 함께 깼다(내가 잰 시간, 밀리초). 교사 방이고 순위에 올리기가 켜져 있을 때만 방 서버가 받는다. 순위에 적히는 시간은 방 서버가 잰 값이다. */
  sendWon(ms: number) { if (this.isHost && this.cls?.rank) this.raw(JSON.stringify({ t: 'won', r: this.room.run, ms: Math.round(ms) })); }
  /** 그 자리에 보일 닉네임(없으면 빈 글). */
  nickOf(seat: number) { return this.names.get(seat) ?? ''; }
  /** 방에서 나간다. */
  leave() { if (this.done) return; this.stop(); this.ev.down?.('left'); }
}

export function joinRoom(base: string, code: string, opts: JoinOptions, ev: RoomEvents): RoomLink {
  if (!validRoomCode(code)) throw new Error('방 코드는 여섯 글자예요.');
  return new RoomLink(base, code, opts, ev);
}

/** 지금 열려 있는 공개 방. 받아 오지 못하면 빈 목록. */
export async function listPublic(base: string, fetcher: typeof fetch = fetch): Promise<PublicRoom[]> {
  try {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 4000);
    const res = await fetcher(`${base.replace(/\/+$/, '')}/public`, { signal: ctl.signal, cache: 'no-store' });
    clearTimeout(timer);
    if (!res.ok) return [];
    const list: unknown = await res.json();
    if (!Array.isArray(list)) return [];
    return list.flatMap((r): PublicRoom[] => {
      if (!r || typeof r !== 'object' || !validRoomCode(String(r.code))) return [];
      const pack = typeof r.pack === 'string' && /^([a-z0-9-]+\/[a-z0-9-]+)?$/.test(r.pack) ? r.pack : '';
      const stage = Number.isInteger(r.stage) ? r.stage : -1, count = Number.isInteger(r.count) ? Math.max(0, Math.min(MAX_SEATS, r.count)) : 0;
      return [{ code: r.code, pack, stage, count }];
    }).slice(0, 50);
  } catch { return []; }
}
