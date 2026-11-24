/**
 * 도름스 월드 방 서버 (Cloudflare Workers + Durable Objects).
 *
 * 방 하나가 Durable Object 하나다(방 코드로 찾는다). 공개 방 목록을 맡는 Durable Object 가 하나 더 있다.
 * 저장하지 않는다: 자리 번호, 조작 신호, 세계 요약, 방 정보만 지나간다. 연결이 모두 끊기면 방은 사라진다.
 * 규칙(자리 배정, 방장 넘기기, 크기·빈도 상한, 글 검사, 교사 방, 주소마다의 횟수 제한)은 platform/room-rules.ts 에 있고 여기는 그것을 Workers 에 잇기만 한다.
 *
 *   GET /room/<방 코드>?mode=create|join&view=play|pad|auto&id=<창 번호>&pub=1&big=1   (WebSocket)
 *   GET /public                                                                      (열려 있는 공개 방 목록)
 *
 * 교사 방: 연결된 뒤 첫 글로 온 출입증의 서명을 WORLD_ROOM_SECRET 으로 확인한다(주소에도 머리글에도 싣지 않는다).
 * 교사 방의 순위 기록과 팩 쓰임은 도름스(dorms.school)에 적는다. 그 밖에는 어디에도 적지 않는다.
 */
import { DurableObject } from 'cloudflare:workers';
import { validRoomCode } from '../../platform/room-code';
import { CLOSE, Gate, LIMITS, PublicList, SWEEP_GAP, RoomCore, dormsUrl, ipKey, originAllowed, readJoinQuery, readRankReply, verifyPass, type PublicRoom, type RankReport, type Saved } from '../../platform/room-rules';

export interface Env {
  ROOM: DurableObjectNamespace<Room>;
  LOBBY: DurableObjectNamespace<Lobby>;
  /** 같은 와이파이의 휴대폰으로 시험할 때만: 쉼표로 나눈 주소들(예: http://192.168.0.5:5320). 운영에서는 비워 둔다. */
  EXTRA_ORIGINS?: string;
  /** 도름스와 함께 아는 비밀값(32자 이상, wrangler secret). 없으면 어떤 출입증도 받지 않고 도름스에 아무것도 적지 않는다. */
  WORLD_ROOM_SECRET?: string;
  /** 로컬 시험에서만: 순위 · 쓰임을 적을 흉내 서버 주소(이 컴퓨터의 주소만 받는다). 운영에서는 비워 둔다. */
  RANKS_URL?: string;
  USES_URL?: string;
  CONSENTS_URL?: string;
  /** 로컬 시험에서만: '1' 이면 주소마다의 횟수 제한을 끈다(시험이 방을 잇달아 만든다). 운영에서는 넣지 않는다. */
  GATE_OFF?: string;
}

const extraOrigins = (env: Env) => (env.EXTRA_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean);
const text = (body: string, status: number, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', ...headers } });
/** 들어오지 못하는 연결: 방에 붙이지 않고 까닭 번호를 글로 알린 뒤 바로 끊는다. */
function refuse(code: number, reason: string): Response {
  const [client, server] = Object.values(new WebSocketPair());
  server.accept();
  server.send(JSON.stringify({ t: 'no', c: code }));
  server.close(code, reason);
  return new Response(null, { status: 101, webSocket: client });
}
const gateOn = (env: Env) => env.GATE_OFF !== '1';
const clientIp = (request: Request) => request.headers.get('CF-Connecting-IP') ?? '';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url), origin = request.headers.get('Origin');
    const allowed = originAllowed(origin, extraOrigins(env));

    if (url.pathname === '/public') {
      const cors: Record<string, string> = allowed ? { 'Access-Control-Allow-Origin': origin!, Vary: 'Origin' } : { Vary: 'Origin' };
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Max-Age': '600' } });
      if (request.method !== 'GET') return text('GET 만 받아요', 405, cors);
      if (origin && !allowed) return text('이 주소에서는 쓸 수 없어요', 403, cors);
      const list = await env.LOBBY.getByName('lobby').list();
      return new Response(JSON.stringify(list), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', ...cors } });
    }

    const m = /^\/room\/([A-Z0-9]{6})$/.exec(url.pathname);
    if (m) {
      if (!validRoomCode(m[1])) return text('방 코드를 확인해 주세요', 400);
      if (request.method !== 'GET' || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return text('WebSocket 으로 연결해 주세요', 426);
      if (!allowed) return text('이 주소에서는 쓸 수 없어요', 403);
      // 같은 인터넷 주소에서 방을 마구 만들거나 방 코드를 훑는 것을 막는다(세는 곳은 Lobby 하나, 메모리에만). 세는 곳이 답하지 않으면 그대로 들여보낸다
      if (gateOn(env)) {
        const mode = url.searchParams.get('mode') === 'create' ? 'create' : 'join';
        const ok = await env.LOBBY.getByName('lobby').enter(mode, clientIp(request)).catch(() => true);
        if (!ok) return refuse(CLOSE.tooFast, 'fast');
      }
      return env.ROOM.getByName(m[1]).fetch(request);
    }
    return text('도름스 월드 방 서버', url.pathname === '/' ? 200 : 404);
  },
} satisfies ExportedHandler<Env>;

export class Room extends DurableObject<Env> {
  private core: RoomCore<WebSocket>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.core = new RoomCore<WebSocket>({
      send: (ws, body) => { try { ws.send(body); } catch { /* 이미 끊긴 연결 */ } },
      close: (ws, code, reason) => { try { ws.close(code, reason); } catch { /* 이미 끊긴 연결 */ } },
      save: (ws, saved) => { try { ws.serializeAttachment(saved); } catch { /* 이미 끊긴 연결 */ } },
      lobby: (code, room) => { this.ctx.waitUntil(this.env.LOBBY.getByName('lobby').report(code, room).catch(() => undefined)); },
      pinged: ws => this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? 0,
      // 출입증: 서명과 기한을 확인하고 방에 알린다. 비밀값이 없으면 verifyPass 가 늘 null 을 준다
      pass: (seat, key, pass, setup) => {
        this.ctx.waitUntil(verifyPass(pass, this.env.WORLD_ROOM_SECRET, Math.floor(Date.now() / 1000)).catch(() => null).then(claims => this.core.grant(seat, key, claims, setup)));
      },
      // 순위와 쓰임은 동의를 적은 뒤에 보낸다(도름스는 동의 줄이 있는 선생님 것만 적는다. 먼저 닿으면 버려진다)
      rank: report => { this.ctx.waitUntil(this.consent.then(() => this.postRank(report))); },
      agree: a => { this.consent = this.post('consents', this.env.CONSENTS_URL, { teacher: a.teacher, version: a.version }).catch(() => null); this.ctx.waitUntil(this.consent); },
      use: use => { this.ctx.waitUntil(this.consent.then(() => this.post('uses', this.env.USES_URL, { packId: use.pack, teacher: use.teacher }))); },
    });
    // 잠들었다 깬 방: 살아 있는 연결에 붙여 둔 값으로 자리와 방 정보를 되살린다
    for (const ws of this.ctx.getWebSockets()) {
      const saved = ws.deserializeAttachment() as Saved | null;
      if (saved) this.core.restore(ws, saved);
    }
    // 연결을 두드려 보는 글('ping')에는 방을 깨우지 않고 답한다
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url), code = url.pathname.split('/').pop() ?? '', q = readJoinQuery(url.searchParams);
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const no = this.core.check(code, q);
    if (no) {
      // 없는 방 코드를 넣었다: 그 주소의 틀린 코드로 센다(방 코드 훑기 막기)
      if (no[0] === CLOSE.none && gateOn(this.env)) this.ctx.waitUntil(this.env.LOBBY.getByName('lobby').miss(clientIp(request), code).catch(() => undefined));
      // 들어오지 못하는 연결은 방에 붙이지 않는다: 까닭 번호를 글로 알리고 바로 끊는다(방에는 아무것도 남지 않는다)
      server.accept();
      server.send(JSON.stringify({ t: 'no', c: no[0] }));
      server.close(no[0], no[1]);
      return new Response(null, { status: 101, webSocket: client });
    }
    this.ctx.acceptWebSocket(server);
    this.core.join(server, code, q);
    await this.keepAlarm();
    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * 사람이 있는 동안 몇 초마다 깨어 죽은 연결과 소식이 끊긴 방장을 치운다. 닫힘 신호 없이 사라진 기기(잠든 휴대폰, 끊긴 와이파이)는
   * 아무 글도 오지 않으면 방이 알아챌 길이 없어서다. 방이 비면 알람을 더 걸지 않는다.
   */
  async alarm() { if (this.core.tick(Date.now())) await this.ctx.storage.setAlarm(Date.now() + SWEEP_GAP); }
  private async keepAlarm() { if ((await this.ctx.storage.getAlarm()) == null) await this.ctx.storage.setAlarm(Date.now() + SWEEP_GAP); }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    // 글이 아닌 것(바이너리)도 빈도와 크기 검사는 똑같이 거친다. 같은 크기의 빈 글로 바꿔 넘기면 세어지고, 크면 끊기고, 읽히지는 않는다
    const text = typeof message === 'string' ? message : ' '.repeat(Math.min(message.byteLength, LIMITS.snap + 1));
    const saved = ws.deserializeAttachment() as Saved | null;
    if (saved) this.core.message(saved.seat, saved.key, text, Date.now());
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    this.gone(ws);
    try { ws.close(code === 1005 || code === 1006 ? 1000 : code, reason); } catch { /* 이미 닫힘 */ }
  }

  async webSocketError(ws: WebSocket) { this.gone(ws); }

  private gone(ws: WebSocket) {
    const saved = ws.deserializeAttachment() as Saved | null;
    if (saved) this.core.leave(saved.seat, saved.key);
  }

  /** 도름스에 적는다. 실패해도 방은 그대로 간다(한 번만 더 해 본다). 받은 답(JSON)이나 null 을 돌려준다. */
  private async post(kind: 'ranks' | 'uses' | 'consents', override: string | undefined, body: unknown): Promise<unknown> {
    const secret = this.env.WORLD_ROOM_SECRET;
    if (!secret || secret.length < 32) return null;
    for (let i = 0; i < 2; i++) {
      try {
        const res = await fetch(dormsUrl(kind, override), {
          method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(5000),
          headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        if (res.ok) return await res.json().catch(() => null);
        if (res.status < 500) return null;                // 받는 쪽이 거절했다(아직 없는 주소 404 포함): 다시 해 봐도 같다
      } catch { /* 닿지 못했다 */ }
      if (i === 0) await new Promise(r => setTimeout(r, 1200));
    }
    return null;
  }
  /** 이 방에서 보낸 동의 적기(없으면 이미 끝난 것). */
  private consent: Promise<unknown> = Promise.resolve();
  private async postRank(r: RankReport) {
    const reply = readRankReply(await this.post('ranks', this.env.RANKS_URL, { packId: r.pack, stage: r.stage, ms: r.ms, players: r.players, title: r.title, teacher: r.teacher }));
    this.core.ranked(r.run, r.ms, reply.rank, reply.best);
  }
}

export class Lobby extends DurableObject<Env> {
  private rooms = new PublicList();
  private gate = new Gate();
  /** 주소는 그대로 두지 않는다: 이 자리에서만 쓰고, 세는 표에는 그때그때 뽑은 값과 섞어 갈아 낸 값만 둔다(로그에도 남기지 않는다). */
  private salt = crypto.randomUUID();
  private async keyOf(ip: string) {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${this.salt}|${ipKey(ip)}`));
    return [...new Uint8Array(hash).slice(0, 12)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  /** 방을 만들거나 들어와도 되는가. */
  async enter(mode: 'create' | 'join', ip: string): Promise<boolean> {
    const key = await this.keyOf(ip), now = Date.now();
    return mode === 'create' ? this.gate.create(key, now) : this.gate.join(key, now);
  }
  /** 없는 방 코드를 넣었다. */
  async miss(ip: string, code: string) { this.gate.miss(await this.keyOf(ip), code.slice(0, 6), Date.now()); }
  /** 방이 스스로 알린다: 공개 방이면 값, 닫혔거나 비공개가 되면 null. */
  async report(code: string, room: PublicRoom | null) { this.rooms.report(code, room, Date.now()); }
  async list(): Promise<PublicRoom[]> { return this.rooms.list(Date.now()); }
}
