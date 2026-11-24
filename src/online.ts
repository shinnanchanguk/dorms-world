/**
 * 온라인으로 함께 하기. 방을 만들고(공개 여부·방식), QR·방 코드·공개 방 목록으로 들어오고,
 * 방에 함께 있는 채로 방장이 고르는 스테이지를 모두 따라간다. 가입도 이름 입력도 없다: 들어온 차례대로 색과 번호가 정해진다.
 *
 * 방식은 둘이고 한 방에 섞여도 된다.
 *  - 각자 화면: 자기 기기에서 게임 화면을 보며 움직인다.
 *  - 함께 보기: 방을 연 큰 화면에 모두가 보이고, 다른 사람은 휴대폰을 조작기로만 쓴다(좌우·뛰기·확인, 내 색과 번호).
 *
 * 물리는 방장 기기만 돌린다. 손님은 조작만 보내고 방장이 보내는 세계 요약을 받아 그린다(platform/sync.ts).
 * 방 서버 주소(VITE_ROOM_URL)가 비어 있으면 이 파일은 화면에 아무것도 그리지 않는다.
 *
 * 교사 방: 도름스에 로그인한 선생님(주소의 #pass 로 받은 출입증)이 연 방. 방 제목, 닉네임 신청과 승인, 순위에 올리기가 있다.
 * 선생님 화면은 게임 화면 옆에 방 코드 · QR · 명단 · 닉네임 신청 줄을 함께 둔다. 학생끼리 연 방에는 이 가운데 아무것도 없다.
 * 다른 기기가 보낸 글자를 그리는 것은 선생님이 정한 방 제목과 선생님이 승인한 닉네임뿐이다(둘 다 esc 를 거치거나 글자로만 넣는다).
 */
import '../platform/ui/online.css';
import '../platform/ui/teacher.css';
import qrcode from 'qrcode-generator';
import { icon } from '../platform/icons';
import { colorFor, swatchFor } from '../platform/identity';
import { PadInput } from '../platform/input';
import { VIEW_H, VIEW_W } from '../platform/look';
import { joinRoom, listPublic, type Down, type NickState, type RankNews, type RoomLink } from '../platform/net';
import { findPack, type Pack } from '../platform/packs';
import { cameraFor, nearText, padLift, render, type Camera } from '../platform/render';
import { cleanRoomCode, newRoomCode, validRoomCode } from '../platform/room-code';
import { MAX_SEATS, NOTICE, nextRun, NICK_MAX, TITLE_MAX, cleanNick, cleanTitle, readPass, type PassClaims, type PublicRoom, type RoomInfo } from '../platform/room-rules';
import { actionAt, createWorld, hostOf, removePlayer, setPlayerCount, step, type Pad, type World } from '../platform/sim';
import { orderDone, orderProblem, placeOrder } from '../platform/graph/model';
import type { Order } from '../platform/graph/order';
import { openPanel } from './graph-panel';
import { GuestPads, SNAP_EVERY, applyWire, blend, newTrack, padSender, pushWire, toWire, wireSeats, type Track, type Wire } from '../platform/sync';
import { esc, mmss } from '../platform/text';

/** main.ts 가 빌려주는 것들. */
export type Host = {
  app: HTMLElement;
  shell(inner: string, status: string, right: string, back?: string): string;
  /** 주소를 바꾸고 그 화면을 그린다(방에 있으면 방 코드가 주소에 따라붙는다). */
  go(path: string): void;
  /** 지금 주소의 화면을 다시 그린다. */
  route(): void;
  /** 앞 화면을 멈추고, 새 화면을 멈출 함수를 건다. */
  setStop(fn: (() => void) | null): void;
};

const BASE = import.meta.env.BASE_URL;
const ROOM_URL = (import.meta.env.VITE_ROOM_URL ?? '').trim().replace(/\/+$/, '');
/** 방 서버 주소가 있어야 온라인 들머리를 그린다. */
export const available = () => /^https?:\/\//.test(ROOM_URL);

let host: Host;
let link: RoomLink | null = null;
let game: Game | null = null;
let shown = '';                       // 지금 온라인이 그린 화면(같은 화면을 다시 그리지 않으려고)
let notice = '';                      // 처음 화면 안내 줄에 한 번 보여 줄 글
let joinIn = false;                   // 함께 보기 방의 방장: 이 화면에서도 도름이를 움직인다
let pendingInvite = false;            // 방을 막 만들었다: 들어오면 초대 창을 띄운다
let remade = 0;                       // 방 코드가 겹쳐 새로 뽑은 횟수
let role: 'none' | 'guest' | 'host' = 'none';

export function init(h: Host) {
  host = h;
  takePass();                           // 주소에 붙어 온 출입증은 방 서버 주소가 없어도 주소에서 지운다
  if (!available()) return;
  // 방장이 화면을 내려 두면(다른 앱으로 감) 게임이 멈춘다. 게임 화면을 보고 있는 다음 사람에게 방장을 넘긴다.
  document.addEventListener('visibilitychange', () => { if (document.hidden && game && link?.isHost) link.yieldHost(); else if (!document.hidden) { link?.nudge(); tryClaim(false); } });
  // 와이파이가 돌아오면 다시 붙기를 기다리지 않고 바로 붙어 본다(잠들었던 휴대폰, 공유기를 옮겨 탄 노트북)
  window.addEventListener('online', () => link?.nudge());
  // 화면을 떠나면(닫기 · 새로 고침) 연결만 조용히 끊는다. 주소의 방 코드는 그대로 두어 새로 고치면 같은 방으로 돌아온다.
  window.addEventListener('pagehide', () => { const l = link; if (!l) return; link = null; l.leave(); });
  // 뒤로 가기로 되살아난 화면은 연결이 끊긴 채다: 주소를 보고 다시 들어간다
  window.addEventListener('pageshow', e => { if (e.persisted) { shown = ''; host.route(); } });
}

export const inRoom = () => !!link;

// ---------- 선생님 출입증 ----------
/**
 * 도름스(dorms.school/world)가 로그인한 선생님에게 주소 끝 #pass=… 로 건네는 출입증.
 * 받자마자 주소에서 지우고 이 창의 세션 저장소에만 둔다. 가운데 적힌 닉네임은 화면에 보이기만 하고, 진짜 확인은 방 서버가 서명으로 한다.
 */
const PASS_KEY = 'dorms-world.pass';
let passMem = '';
function takePass() {
  const m = /(?:^#|&)pass=([^&]*)/.exec(location.hash);
  if (!m) return;
  let v = '';
  try { v = decodeURIComponent(m[1]); } catch { /* 망가진 값은 버린다 */ }
  history.replaceState(history.state, '', location.pathname + location.search);   // 주소 기록에 남지 않게
  if (!readPass(v, Date.now() / 1000)) return;
  passMem = v;
  try { sessionStorage.setItem(PASS_KEY, v); } catch { /* 저장이 막힌 기기는 이 화면이 떠 있는 동안만 */ }
}
/** 지금 쓸 수 있는 출입증. 기한이 지났으면 버린다. */
function myPass(): { pass: string; claims: PassClaims } | null {
  let v = passMem;
  if (!v) { try { v = sessionStorage.getItem(PASS_KEY) ?? ''; } catch { /* 저장이 막힌 기기 */ } }
  const claims = v ? readPass(v, Date.now() / 1000) : null;
  if (!claims) { passMem = ''; if (v) { try { sessionStorage.removeItem(PASS_KEY); } catch { /* 무시 */ } } return null; }
  passMem = v;
  return { pass: v, claims };
}
const LOGIN_URL = 'https://dorms.school/login?next=/world';
const TEACHING_KEY = 'dorms-world.teaching', PASS_OLD = '선생님 확인 시간이 지났어요. dorms.school/world 를 다시 열고 이 방 코드로 들어와 주세요.';
/** 이 기기가 그 방에서 선생님으로 확인된 적이 있는가(이 탭이 떠 있는 동안). */
const taughtHere = (code: string) => { try { return sessionStorage.getItem(TEACHING_KEY) === code; } catch { return false; } };
const CLAIM_WAIT = 2500;
let claimWait = 0;   // 요약을 기다리기 시작한 때(0 이면 기다리지 않는 중)
let claimAt = -1e9;   // 화면이 막 떴을 때(시계가 2초도 안 됐을 때)도 첫 청은 바로 나가야 한다
/**
 * 내 선생님 방인데 학생 기기가 방장이면 방장을 돌려받는다(순위는 선생님 기기가 방장일 때만 오른다).
 * 게임이 열려 있으면 그 판의 요약을 한 번 받은 뒤에(ready) 청한다: 받은 데서 이어 굴려야 판이 처음으로 돌아가지 않는다.
 * 화면이 내려가 있으면 청하지 않는다(내려간 화면은 게임을 굴리지 못한다).
 */
function tryClaim(ready: boolean) {
  const l = link, now = performance.now();
  if (!l || !l.teacher || !l.cls || l.isHost || l.host < 0 || l.cls.teachers.includes(l.host) || document.hidden || l.viewOf(l.me) !== 'play') { claimWait = 0; return; }
  // 게임이 열려 있으면 요약을 기다리되 2.5초까지만: 방장을 맡은 기기가 요약을 보내지 않아도(멎었거나 일부러) 선생님은 방장을 돌려받는다. 그때는 스테이지를 처음부터 다시 연다
  // (내 화면에 게임이 아직 안 열렸어도 기다린다: 팩을 불러오는 사이에 청하면 요약 없이 방장이 되어 판이 처음으로 돌아간다)
  if (l.room.stage >= 0 && !ready) {
    if (!claimWait) { claimWait = now; setTimeout(() => tryClaim(false), CLAIM_WAIT + 60); return; }
    if (now - claimWait < CLAIM_WAIT) return;
  }
  if (now - claimAt < 2000) return;
  claimAt = now; claimWait = 0; l.claimHost();
}
// 선생님 방 안내에 동의했는지: 출입증에 적혀 있거나(도름스에 남은 기록), 이 기기에서 방금 동의했거나
const NOTICE_KEY = 'dorms-world.notice';
function noticeAgreed(claims: PassClaims) {
  if (claims.c >= NOTICE) return true;
  try { return localStorage.getItem(NOTICE_KEY) === `${claims.u}:${NOTICE}`; } catch { return false; }
}
function rememberNotice(claims: PassClaims) { try { localStorage.setItem(NOTICE_KEY, `${claims.u}:${NOTICE}`); } catch { /* 저장이 막힌 기기는 다음에 다시 묻는다 */ } }
/** 방에 있는 동안 주소 뒤에 붙는 값. */
export const query = () => (link ? `?room=${link.code}` : '');

// ---------- 이 창을 가리는 번호 ----------
/** 연결이 잠깐 끊겼다 다시 붙을 때 앉아 있던 자리를 잇는 데만 쓴다. 창을 닫으면 사라지고, 사람을 알아볼 수 있는 값이 아니다. */
function tabId() {
  const KEY = 'dorms-world.tab';
  try { const v = sessionStorage.getItem(KEY); if (v && /^[0-9a-f]{16}$/.test(v)) return v; } catch { /* 저장이 막힌 기기 */ }
  const a = new Uint8Array(8); crypto.getRandomValues(a);
  const id = [...a].map(b => b.toString(16).padStart(2, '0')).join('');
  try { sessionStorage.setItem(KEY, id); } catch { /* 무시 */ }
  return id;
}

// ---------- 알림(화면 위에 잠깐 뜨는 글) ----------
let toastEl: HTMLElement | null = null, toastTimer = 0;
function toast(text: string, ms = 4500) {
  if (!toastEl) { toastEl = document.createElement('p'); toastEl.className = 'w-toast'; toastEl.setAttribute('role', 'status'); document.body.appendChild(toastEl); }
  toastEl.textContent = text; toastEl.hidden = !text;
  clearTimeout(toastTimer);
  if (text && ms > 0) toastTimer = window.setTimeout(() => { if (toastEl) toastEl.hidden = true; }, ms);
}

const WHY: Record<Down, string> = {
  full: '방이 가득 찼어요. 한 방에는 30명까지 들어갈 수 있어요.',
  none: '그런 방이 없어요. 방 코드를 다시 확인해 주세요.',
  taken: '방을 만들지 못했어요. 다시 만들어 주세요.',
  fast: '연결이 고르지 않아 방에서 나왔어요. 다시 들어와 주세요.',
  lost: '연결이 끊겨 방에서 나왔어요. 와이파이를 확인하고 다시 들어와 주세요.',
  left: '',
};

// ---------- 방에 들어가고 나오기 ----------
function enter(code: string, o: { create?: boolean; pub?: boolean; big?: boolean; title?: string; rank?: boolean } = {}) {
  joinIn = false; role = 'none'; teachOpen = false; askCount = 0;
  /** 방장인지 손님인지가 바뀌었는지 본다. 손님으로 있다가 방장이 됐으면 true. */
  const turned = (l: RoomLink) => {
    const now = l.isHost ? 'host' : 'guest', promoted = role === 'guest' && now === 'host';
    if (promoted) joinIn = l.room.order.includes(l.me);    // 뛰던 사람이 방장이 되면 계속 뛴다
    role = now;
    return promoted;
  };
  const changed = (l: RoomLink) => {
    if (l !== link) return;
    const promoted = turned(l);
    if (l.isHost) reconcile();
    if (promoted) toast(l.teacher && l.cls ? '선생님 기기가 다시 방장이 됐어요.' : '앞 방장이 나가서 이제 내가 방장이에요.');
    tryClaim(false);
    refresh();
    paintTeach();
  };
  /** 교사 방 정보 · 닉네임이 바뀌었다: 그것이 보이는 곳을 모두 다시 그린다. */
  const classChanged = (l: RoomLink) => {
    if (l !== link) return;
    if (l.teacher && l.asks.length > askCount && !teachWide() && !teachOpen) toast('닉네임 신청이 왔어요. 우리 반을 눌러 확인해 주세요.');
    askCount = l.asks.length;
    if (host.app.querySelector('.w-strip')) mountStrip();
    refresh();
    paintTeach();
  };
  // 출입증이 있으면 들어올 때마다 낸다: 내가 연 방이면 선생님 방이 되고, 내 선생님 방에 다시 들어온 것이면 선생님 화면이 돌아온다
  const teacherNow = myPass(), agreedNow = !!teacherNow && noticeAgreed(teacherNow.claims);
  const mine = joinRoom(ROOM_URL, code, { ...o, view: 'auto', id: tabId(), pass: teacherNow?.pass, agree: agreedNow }, {
    hello: l => {
      if (l !== link) return;
      remade = 0; toast(''); changed(l);
      if (pendingInvite && l.isHost) { pendingInvite = false; inviteDialog(true); }
      // 새로 고쳐 들어왔으면 승인받았던 닉네임을 다시 신청한다(닉네임은 연결에 붙어 있어 새 연결에는 없다)
      // 내가 선생님으로 있던 방인데 출입증 기한이 지나 버려졌다: 선생님 화면이 왜 없는지 알린다
      if (l.cls && taughtHere(l.code) && !teacherNow) toast(PASS_OLD, 12000);
      const kept = keptNick(l.code);
      if (l.cls && kept && !l.nickOf(l.me) && !l.myAsk) l.askName(kept);
    },
    who: changed,
    klass: classChanged,
    pass: ok => {
      if (mine !== link) return;
      if (ok) { try { sessionStorage.setItem(TEACHING_KEY, mine.code); } catch { /* 저장이 막힌 기기 */ } }
      // 스스로 동의하지 않고 연 보통 방에는 알리지 않는다(로그인 문제로 오해한다). 이미 선생님 방인데 출입증을 받지 못한 것은 기한이 지난 것이다
      else if (mine.cls && taughtHere(mine.code)) toast(PASS_OLD, 12000);
      else if (o.create && agreedNow) toast('선생님 확인을 하지 못해 보통 방으로 열었어요. 도름스에 다시 로그인한 뒤 방을 새로 만들어 주세요.', 9000);
      classChanged(mine);
      tryClaim(false);
    },
    nick: nickNews,
    rank: news => { lastRank = news; game?.onRank(); },
    room: l => { if (l === link) { refresh(); tryClaim(false); } },
    pad: (seat, pad) => game?.onPad(seat, pad),
    order: (seat, order) => game?.onOrder(seat, order),
    snap: wire => game?.onSnap(wire),
    retry: n => { if (mine === link) toast(n ? '연결이 끊겼어요. 다시 잇고 있어요.' : '', 0); },
    down: why => {
      if (mine !== link) return;
      link = null; toast(''); paintTeach();
      if (why === 'taken' && o.create && remade++ < 3) { enter(newRoomCode(), o); return; }   // 방 코드가 겹쳤다: 새로 뽑는다
      pendingInvite = false; closeDialog();
      // 한 번도 붙지 못했으면 '나왔어요'가 아니라 '못 했어요'로 알린다
      notice = why === 'lost' && mine.me < 0 ? (o.create ? '방을 만들지 못했어요. 연결을 확인하고 다시 해 주세요.' : '방에 들어가지 못했어요. 연결을 확인하고 다시 해 주세요.')
        : why === 'fast' && mine.me < 0 ? (o.create ? '방을 너무 자주 만들었어요. 1분쯤 뒤에 다시 해 주세요.' : '지금은 방에 들어갈 수 없어요. 1분쯤 뒤에 다시 해 주세요.')   // 같은 인터넷 주소에서 방을 잇달아 만들었거나 틀린 방 코드가 너무 많이 들어왔다
        : WHY[why];
      shown = '';
      history.replaceState(null, '', location.pathname);   // 주소에서 방 코드를 뗀다
      host.route();
    },
  });
  link = mine;
}

function leaveRoom() {
  const l = link; if (!l) return;
  link = null; l.leave();                                 // 내가 나간 것이라 안내 글은 없다
  toast(''); shown = ''; notice = ''; paintTeach(); closeDialog();
  history.replaceState(null, '', location.pathname);
  host.go('');
}

/**
 * 주소를 보고 방 상태를 맞춘다. main.ts 의 route() 가 맨 먼저 부른다.
 * true 를 돌려주면 온라인이 화면을 그렸다(들어가는 중, 손님의 대기·게임·조작기 화면).
 */
export function route(): boolean {
  if (!available()) return false;
  const raw = new URLSearchParams(location.search).get('room'), want = cleanRoomCode(raw ?? '');
  if (link && want !== link.code) { const l = link; link = null; l.leave(); toast(''); paintTeach(); }        // 뒤로 가기로 방 주소를 벗어났다
  if (!link && raw != null) {
    if (validRoomCode(want)) enter(want);
    else { notice = WHY.none; history.replaceState(null, '', location.pathname); }
  }
  if (!link) { shown = ''; return false; }
  if (link.me < 0) { drawJoining(); return true; }
  if (link.isHost) { shown = 'host'; return false; }      // 방장은 고르는 화면(처음 화면·팩 화면)을 그대로 쓴다
  shown = ''; refresh();
  return true;
}

/** 방 상태가 바뀔 때마다: 지금 보여야 할 화면을 맞춘다. */
function refresh() {
  const l = link; if (!l || l.me < 0) return;
  const pack = l.room.stage >= 0 ? findPack(l.room.pack) : null;
  const playing = !!pack && l.room.stage < pack.stageData.length;
  if (l.isHost) {
    if (game) { game.sync(); return; }
    if (shown !== 'host') {
      // 막 방을 만들었거나, 손님 화면(기다리기·조작기)에 있다가 방장이 됐다
      if (playing) { start(pack!, l.room.stage); return; }   // 조작기만 쓰던 기기는 세계를 갖고 있지 않아 그 스테이지를 처음부터 연다
      shown = 'host'; host.route(); return;
    }
    updateStrip();
    return;
  }
  if (l.viewOf(l.me) === 'pad') { game?.stop(); drawPad(); return; }
  if (playing) { openGame(pack!, l.room.stage); return; }
  game?.stop();
  drawWait(l.room.stage >= 0 && !playing ? '이 기기에는 그 스테이지가 아직 없어요. 새로 고침한 뒤 다시 들어와 주세요.' : '');
}

/** 방장: 들고 난 사람에 맞춰 도름이 차례(자리 번호 목록)를 고쳐 모두에게 알린다. 새로 온 사람은 뒤에 붙는다. */
function reconcile() {
  const l = link; if (!l?.isHost) return;
  const here = new Set(l.seats.map(s => s.seat));
  const order = l.room.order.filter(s => here.has(s) && (s !== l.me || !l.room.big || joinIn));
  for (const s of l.seats) if (!order.includes(s.seat) && (s.seat !== l.me || !l.room.big || joinIn)) order.push(s.seat);
  if (order.length === l.room.order.length && order.every((s, i) => s === l.room.order[i])) return;
  game?.reorder(l.room.order, order);
  l.setRoom({ ...l.room, order });
}

/** 방장: 스테이지를 고르는 화면으로 돌아왔다(손님은 기다리는 화면으로). */
function idleRoom() {
  const l = link;
  if (l?.isHost && l.room.stage >= 0) l.setRoom({ ...l.room, stage: -1 });
}

/** 방장: 스테이지를 연다. 방에 있는 모두가 따라온다. */
export function start(p: Pack, si: number) {
  const l = link; if (!l?.isHost) return;
  reconcile();
  l.setRoom({ ...l.room, pack: p.id, stage: si, seed: 1 + Math.floor(Math.random() * 2147483000), run: nextRun(l.room.run) });
  openGame(p, si);
}

// ---------- 처음 화면 · 팩 화면에 얹는 것 ----------
/** 처음 화면이 그려진 뒤: 방 밖이면 들머리(방 만들기·코드 입력·공개 방), 방 안이면 방 줄. */
export function home() {
  if (!available()) return;
  if (link) { idleRoom(); mountStrip(); return; }
  const at = host.app.querySelector('.ar-toolbar') ?? host.app.querySelector('.ar-screen-inner > :last-child');
  if (!at) return;
  const el = document.createElement('section');
  el.className = 'w-online'; el.setAttribute('aria-label', '함께 하기');
  el.innerHTML = `
    <div class="w-online-row">
      <button class="ar-key ghost" data-room-new>${icon('users', 17)}방 만들기</button>
      <div class="w-codebox">
        <label class="ar-kicker" for="w-code">방 코드</label>
        <input id="w-code" class="ar-input w-codeinput" maxlength="6" autocomplete="off" autocapitalize="characters" spellcheck="false" enterkeyhint="go" placeholder="여섯 글자">
        <button class="ar-key ghost" data-room-join>들어가기</button>
      </div>
    </div>
    <p class="lab-note w-online-note" role="status">${esc(notice)}</p>
    ${teacherLine()}
    <div class="w-public"><p class="ar-kicker w-kicker">공개 방</p><div class="lab-roster w-publist"><p class="w-public-none">공개 방을 찾고 있어요.</p></div></div>`;
  notice = '';
  at.before(el);
  const input = el.querySelector<HTMLInputElement>('input')!, note = el.querySelector<HTMLElement>('.w-online-note')!;
  const join = () => {
    const code = cleanRoomCode(input.value);
    if (!validRoomCode(code)) { note.textContent = '방 코드는 여섯 글자예요. 숫자 0과 1, 알파벳 O, I, L 은 쓰지 않아요.'; input.focus(); return; }
    enter(code); host.go('');
  };
  input.oninput = () => { input.value = cleanRoomCode(input.value); note.textContent = ''; };
  input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); join(); } };
  el.querySelector<HTMLButtonElement>('[data-room-join]')!.onclick = join;
  el.querySelector<HTMLButtonElement>('[data-room-new]')!.onclick = e => createDialog(e.currentTarget as HTMLElement);

  const listEl = el.querySelector<HTMLElement>('.w-publist')!;
  let alive = true;
  const load = async () => {
    const rooms = await listPublic(ROOM_URL);
    if (!alive || !listEl.isConnected) return;
    listEl.innerHTML = rooms.length ? rooms.map(pubRow).join('') : '<p class="w-public-none">지금 열린 공개 방이 없어요.</p>';
    listEl.querySelectorAll<HTMLButtonElement>('[data-pub]').forEach(b => b.onclick = () => { enter(b.dataset.pub!); host.go(''); });
  };
  void load();
  const timer = window.setInterval(load, 8000);
  host.setStop(() => { alive = false; clearInterval(timer); });
}

/** 처음 화면의 선생님 줄: 출입증이 있으면 누구로 들어왔는지, 없으면 도름스 로그인 안내. */
function teacherLine() {
  const t = myPass();
  return t
    ? `<p class="w-teacher-line"><span class="ar-count w-teacher-tag">선생님</span><b class="w-teacher-nick">@${esc(t.claims.n)}</b><span>방을 만들 때 방 제목과 순위에 올릴지를 정할 수 있어요.</span></p>`
    : `<p class="w-teacher-line"><span>선생님은 도름스에 로그인한 뒤 dorms.school/world 에서 열어 주세요.</span> <a class="w-teacher-login" href="${LOGIN_URL}" target="_blank" rel="noopener noreferrer">도름스 로그인</a></p>`;
}

function pubRow(r: PublicRoom) {
  const p = findPack(r.pack), where = p && r.stage >= 0 && r.stage < p.stages.length ? `${p.name} ${String(r.stage + 1).padStart(2, '0')}` : '스테이지 고르는 중';
  return `<button class="ar-row w-pubrow" data-pub="${esc(r.code)}" aria-label="공개 방 ${esc(r.code)} 들어가기, ${esc(where)}, ${r.count}명"><span class="ar-count ar-mono w-pubcode">${esc(r.code)}</span><span class="ar-label">${esc(where)}</span><span class="ar-count w-people">${icon('users', 14)}<span><span class="lab-num">${r.count}</span>명</span></span></button>`;
}

/** 팩 화면이 그려진 뒤: 방 안이면 연습 인원 고르기를 걷고 방 줄을 단다. */
export function pack() {
  if (!link) return;
  idleRoom(); mountStrip();
  const counts = host.app.querySelector('.w-counts');
  counts?.previousElementSibling?.remove(); counts?.remove();
  const keys = host.app.querySelector('.w-keys');
  if (keys) keys.innerHTML = '<span>스테이지를 고르면 방에 있는 모두가 함께 시작해요.</span> <span>움직이기 왼쪽·오른쪽 방향키</span> · <span>뛰기 스페이스(또는 Z)</span> · <span>확인 엔터(문에 들어가기, 들고 놓기, 레버 당기기)</span>';
}

/** 방 줄: 방 코드, 사람 수, 친구 부르기, 방 나가기. 상태 줄 오른쪽에 붙는다. */
function mountStrip() {
  const bar = host.app.querySelector('.w-status');
  if (!bar || !link) return;
  bar.querySelector('.w-strip')?.remove();
  const el = document.createElement('div');
  el.className = 'w-strip';
  el.innerHTML = `${roomTags()}${teachButton()}<button class="ar-key ghost" data-invite aria-label="친구 부르기">${icon('plus', 17)}<span class="w-hide-s">친구 부르기</span></button><button class="ar-key ghost" data-leave aria-label="방 나가기">${icon('door', 17)}<span class="w-hide-s">방 나가기</span></button>`;
  bar.appendChild(el);
  el.querySelector<HTMLButtonElement>('[data-teach]')?.addEventListener('click', openTeach);
  el.querySelector<HTMLButtonElement>('[data-invite]')!.onclick = e => inviteDialog(false, e.currentTarget as HTMLElement);
  el.querySelector<HTMLButtonElement>('[data-leave]')!.onclick = leaveRoom;
  shown = 'host';
}
/** 방에서 뛰는 사람 수(도름이 수). 함께 보기 방의 큰 화면은 세지 않는다. 방장이 차례를 알리기 전이면 연결 수. */
const people = () => (link ? link.room.order.length || link.count : 0);
function updateStrip() { for (const el of document.querySelectorAll<HTMLElement>('[data-count]')) el.textContent = String(people()); }
const roomTags = () => `<span class="ar-count w-roomtag"><span class="w-hide-s">방</span><b class="ar-mono">${esc(link?.code ?? '')}</b></span><span class="ar-count w-people">${icon('users', 14)}<span><span class="lab-num" data-count>${people()}</span>명</span></span>`;

// ---------- 창 ----------
let dialog: { el: HTMLElement; close(): void } | null = null;
function closeDialog() { dialog?.close(); }
/** 창을 띄운다. Esc 나 바깥을 누르면 닫히고, 닫으면 창을 연 단추로 초점이 돌아간다. */
function openDialog(label: string, badge: string, body: string, opener?: HTMLElement | null) {
  closeDialog();
  const el = document.createElement('div');
  el.className = 'arcade-root w-root w-dialog';
  el.innerHTML = `<div class="ar-cabinet lab-modal" role="dialog" aria-modal="true" aria-label="${esc(label)}">
    <div class="ar-bezel"><div class="ar-brand"><span class="ar-badge">${esc(badge)}</span> ${esc(label)}</div><button class="ar-key ghost w-x" data-close aria-label="닫기">${icon('close', 17)}</button></div>
    <div class="ar-screen"><div class="ar-screen-inner">${body}</div></div></div>`;
  document.body.appendChild(el);
  const before = opener ?? (document.activeElement as HTMLElement | null);
  const focusable = () => [...el.querySelectorAll<HTMLElement>('button, input, [href], [tabindex]:not([tabindex="-1"])')].filter(n => !n.hasAttribute('disabled') && n.offsetParent !== null);
  const onKey = (e: KeyboardEvent) => {
    e.stopPropagation();                                  // 창이 떠 있는 동안 누른 키가 뒤의 게임(뛰기 · 확인)으로 새지 않게
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key !== 'Tab') return;
    const f = focusable(); if (!f.length) return;
    const first = f[0], last = f[f.length - 1], cur = document.activeElement;
    if (!el.contains(cur)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && cur === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && cur === last) { e.preventDefault(); first.focus(); }
  };
  const close = () => {
    if (dialog?.el !== el) return;
    dialog = null;
    document.removeEventListener('keydown', onKey, true);
    el.remove();
    if (before?.isConnected) before.focus();
  };
  el.addEventListener('pointerdown', e => { if (e.target === el) close(); });
  el.querySelector<HTMLButtonElement>('[data-close]')!.onclick = close;
  document.addEventListener('keydown', onKey, true);
  dialog = { el, close };
  (el.querySelector<HTMLElement>('[data-first]') ?? focusable()[1] ?? focusable()[0])?.focus();
  return el;
}

/** 방 만들기 창: 공개 여부와 방식을 고른다. */
function createDialog(opener: HTMLElement) {
  let pub = false, big = false, rank = false;
  const teacher = myPass();
  const ask = !!teacher && !noticeAgreed(teacher.claims);   // 선생님 방을 처음 여는 선생님께는 그 자리에서 알리고 동의를 받는다
  // 선생님이 여는 방: 방 제목과 순위에 올릴지를 여기서 정한다(학생끼리 여는 방에는 이 칸이 없다)
  const noticePart = ask ? `<div class="w-notice" role="group" aria-labelledby="w-notice-k">
    <p class="ar-kicker w-kicker" id="w-notice-k">선생님 방을 열기 전에 확인해 주세요</p>
    <ul class="w-notes w-notice-list">
      <li>선생님 방을 열면 선생님의 도름스 회원 번호와 닉네임이 방을 이어 주는 곳(Cloudflare)으로 전달돼요. 방이 닫히면 지워져요.</li>
      <li>어느 게임을 어느 날 여셨는지가 도름스에 남아요. 게임을 만든 선생님께 몇 개 반에서 쓰였는지 알려 드리는 데만 쓰고, 누가 썼는지는 알리지 않아요.</li>
      <li>순위에 올리면 방 제목, 걸린 시간, 인원, 선생님 닉네임이 누구에게나 보여요.</li>
      <li>학생은 가입 없이 들어오고 학생 정보는 저장하지 않아요. 학생이 닉네임에 이름, 학번, 연락처 같은 개인정보를 적지 않게 살펴봐 주세요. 닉네임은 선생님이 승인해야 보여요.</li>
    </ul>
    <label class="w-agree"><input type="checkbox" id="w-agree"><span>확인했고 동의해요</span></label>
    <p class="ar-sub w-pick-note w-agree-note">동의하지 않으면 선생님 기능(방 제목, 닉네임 승인, 순위) 없이 보통 방으로 열려요.</p></div>` : '';
  const teacherPart = teacher ? `<div class="w-make-teacher">
    <p class="w-teacher-line w-teacher-inline"><span class="ar-count w-teacher-tag">선생님</span><b class="w-teacher-nick">@${esc(teacher.claims.n)}</b><span>선생님 방으로 열려요. 학생이 닉네임을 신청하면 선생님이 승인해요.</span></p>
    <label class="ar-kicker w-kicker" for="w-title">방 제목</label>
    <input id="w-title" class="ar-input w-titleinput" maxlength="${TITLE_MAX}" autocomplete="off" spellcheck="false" placeholder="스무 글자까지. 비워 둘 수 있어요">
    <p class="ar-sub w-pick-note w-title-note">방 제목에는 학생 이름을 넣지 마세요. 순위에 올리면 방 제목이 누구에게나 보여요.</p>
    <p class="ar-kicker w-kicker" id="w-rank-k">순위에 올릴까요</p>
    <div class="ar-view-tabs" role="group" aria-labelledby="w-rank-k"><button class="ar-key ghost" data-rank="0">올리지 않기</button><button class="ar-key ghost" data-rank="1">순위에 올리기</button></div>
    <p class="ar-sub w-pick-note" data-rank-note></p></div>` : '';
  const el = openDialog('방 만들기', 'ROOM', `${noticePart}<div class="w-make-cols">${teacherPart}<div class="w-make-room">
    <p class="ar-kicker w-kicker" id="w-pub-k">누가 들어올 수 있나요</p>
    <div class="ar-view-tabs" role="group" aria-labelledby="w-pub-k"><button class="ar-key ghost" data-pub="0" data-first>코드를 아는 친구만</button><button class="ar-key ghost" data-pub="1">누구나</button></div>
    <p class="ar-sub w-pick-note" data-pub-note></p>
    <p class="ar-kicker w-kicker" id="w-big-k">어떻게 함께 할까요</p>
    <div class="ar-view-tabs" role="group" aria-labelledby="w-big-k"><button class="ar-key ghost" data-big="0">각자 화면</button><button class="ar-key ghost" data-big="1">함께 보기</button></div>
    <p class="ar-sub w-pick-note" data-big-note></p></div></div>
    <p class="lab-note w-make-note" role="status"></p>
    <div class="lab-actions"><button class="ar-key mustard" data-make>${icon('users', 17)}방 만들기</button></div>`, opener);
  const titleEl = el.querySelector<HTMLInputElement>('#w-title'), makeNote = el.querySelector<HTMLElement>('.w-make-note')!;
  const agreeEl = el.querySelector<HTMLInputElement>('#w-agree');
  const asTeacher = () => !!teacher && (!ask || !!agreeEl?.checked);
  // 동의하기 전에는 선생님 칸(방 제목, 순위)을 쓸 수 없다
  const lock = () => { const off = !asTeacher(); el.querySelector('.w-make-teacher')?.classList.toggle('is-off', off); if (titleEl) titleEl.disabled = off; el.querySelectorAll<HTMLButtonElement>('[data-rank]').forEach(b => { b.disabled = off; }); if (off) rank = false; };
  if (agreeEl) {
    agreeEl.onchange = () => { lock(); paint(); };
    // 안내가 먼저 보이게: 창을 맨 위로 두고 동의 칸에 초점을 둔다(긴 창에서 아래쪽 단추로 초점이 가면 안내가 화면 밖으로 밀린다)
    requestAnimationFrame(() => { agreeEl.focus({ preventScroll: true }); const box = agreeEl.closest<HTMLElement>('.w-dialog'); if (box) box.scrollTop = 0; });
  }
  const paint = () => {
    el.querySelectorAll<HTMLElement>('[data-rank]').forEach(b => b.setAttribute('aria-pressed', String((b.dataset.rank === '1') === rank)));
    const rankNote = el.querySelector('[data-rank-note]');
    if (rankNote) rankNote.textContent = rank ? '스테이지를 다 함께 깨면 걸린 시간이 방 제목으로 순위에 올라가요.' : '기록을 순위에 올리지 않아요.';
    el.querySelectorAll<HTMLElement>('[data-pub]').forEach(b => b.setAttribute('aria-pressed', String((b.dataset.pub === '1') === pub)));
    el.querySelectorAll<HTMLElement>('[data-big]').forEach(b => b.setAttribute('aria-pressed', String((b.dataset.big === '1') === big)));
    el.querySelector('[data-pub-note]')!.textContent = pub ? '처음 화면의 공개 방 목록에 떠서 누구나 들어올 수 있어요.' : '방 코드나 QR 을 받은 친구만 들어와요.';
    el.querySelector('[data-big-note]')!.textContent = big ? '이 화면에 모두가 보이고, 친구들은 휴대폰을 조작기로 써요.' : '저마다 자기 기기에서 게임 화면을 보며 움직여요.';
  };
  el.querySelectorAll<HTMLButtonElement>('[data-pub]').forEach(b => b.onclick = () => { pub = b.dataset.pub === '1'; paint(); });
  el.querySelectorAll<HTMLButtonElement>('[data-big]').forEach(b => b.onclick = () => { big = b.dataset.big === '1'; paint(); });
  el.querySelectorAll<HTMLButtonElement>('[data-rank]').forEach(b => b.onclick = () => { rank = b.dataset.rank === '1'; makeNote.textContent = ''; paint(); });
  if (titleEl) titleEl.oninput = () => { makeNote.textContent = ''; };
  el.querySelector<HTMLButtonElement>('[data-make]')!.onclick = e => {
    const title = titleEl && asTeacher() ? cleanTitle(titleEl.value) : '';
    if (asTeacher() && titleEl && titleEl.value.trim() && !title) { makeNote.textContent = '방 제목은 스무 글자까지 한 줄로 적어 주세요.'; titleEl.focus(); return; }
    if (rank && !title) { makeNote.textContent = '순위에 올리려면 방 제목을 적어 주세요.'; titleEl?.focus(); return; }
    (e.currentTarget as HTMLButtonElement).disabled = true;
    pendingInvite = true; remade = 0;
    if (teacher && ask && agreeEl?.checked) rememberNotice(teacher.claims);
    enter(newRoomCode(), { create: true, pub, big, ...(asTeacher() ? { title, rank } : {}) });
    host.go(location.pathname.slice(BASE.length));       // 주소에 방 코드를 붙이고 화면에 방 줄을 단다
  };
  lock(); paint();
}

const inviteUrl = () => `${(import.meta.env.VITE_PUBLIC_URL ?? '').trim().replace(/\/+$/, '') || location.origin}${BASE}?room=${link?.code ?? ''}`;

/** QR 을 SVG 로 그린다(주소를 바깥으로 보내지 않고 이 기기에서 만든다). */
function qrSvg(text: string) {
  const q = qrcode(0, 'M'); q.addData(text); q.make();
  const n = q.getModuleCount(), pad = 4;
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
  return `<svg class="w-qr-svg" viewBox="${-pad} ${-pad} ${n + pad * 2} ${n + pad * 2}" shape-rendering="crispEdges" role="img" aria-label="방 주소가 담긴 QR"><rect x="${-pad}" y="${-pad}" width="${n + pad * 2}" height="${n + pad * 2}" fill="#F4F7FF"/><path d="${d}" fill="#14285F"/></svg>`;
}

let qrKept = ['', ''];
/** 같은 주소의 QR 은 한 번만 만든다(선생님 화면은 명단이 바뀔 때마다 다시 그려진다). */
function qrFor(url: string) { if (qrKept[0] !== url) qrKept = [url, qrSvg(url)]; return qrKept[1]; }

// ---------- 닉네임(선생님 방에서만) ----------
const NICK_KEY = 'dorms-world.nick';
/** 이 방에서 승인받은 내 닉네임(새로 고친 뒤 다시 신청하는 데만 쓴다. 창을 닫으면 사라진다). */
function keptNick(code: string) {
  try { const o = JSON.parse(sessionStorage.getItem(NICK_KEY) ?? 'null') as { code?: unknown; v?: unknown } | null; return o && o.code === code ? cleanNick(o.v) : ''; } catch { return ''; }
}
function keepNick(code: string, v: string) { try { if (v) sessionStorage.setItem(NICK_KEY, JSON.stringify({ code, v })); else sessionStorage.removeItem(NICK_KEY); } catch { /* 저장이 막힌 기기 */ } }
/** 그 자리의 이름: 선생님이 승인한 닉네임이 있으면 그것, 없으면 색 이름과 번호. n 은 도름이 차례(없으면 0). */
function seatName(l: RoomLink, seat: number, n: number) { return l.nickOf(seat) || `${swatchFor(seat).name} 도름이${n ? ` ${n}` : ''}`; }
/** 머리 위에 적을 글(도름이 차례대로): 승인된 닉네임, 선생님의 도름이는 '선생님', 그 밖에는 빈 글(번호가 보인다). */
const headNames = (l: RoomLink) => (l.cls ? l.room.order.map(seat => l.nickOf(seat) || (l.cls!.teachers.includes(seat) ? '선생님' : '')) : undefined);
/** 닉네임 단추: 선생님 방의 학생에게만 보인다. */
function nickButton(small = true) {
  const l = link;
  if (!l?.cls || l.teacher) return '';
  const label = l.myAsk ? '닉네임 확인 중' : l.nickOf(l.me) ? '닉네임 바꾸기' : '닉네임 정하기';
  return `<button class="ar-key ghost" data-nick aria-label="${label}">${icon('pen', 17)}<span${small ? ' class="w-hide-s"' : ''}>${label}</span></button>`;
}
let nickNote: ((text: string) => void) | null = null;
/** 닉네임 창. say 는 창을 열 때 보여 줄 글(반려됐을 때). */
function nickDialog(say = '', opener?: HTMLElement) {
  const l = link; if (!l?.cls) return;
  const el = openDialog('닉네임 정하기', 'NAME', `
    <p class="ar-sub w-pick-note w-nick-how">이름 대신 별명을 적어 주세요. 선생님이 확인하면 내 도름이 위에 보여요.</p>
    <label class="ar-kicker w-kicker" for="w-nick">닉네임</label>
    <input id="w-nick" class="ar-input w-nickinput" maxlength="${NICK_MAX}" autocomplete="off" spellcheck="false" enterkeyhint="send" placeholder="열 글자까지" data-first>
    <p class="lab-note w-nick-note" role="status"></p>
    <div class="lab-actions"><button class="ar-key mustard" data-send>${icon('check', 17)}선생님께 보내기</button></div>`, opener);
  const input = el.querySelector<HTMLInputElement>('#w-nick')!, note = el.querySelector<HTMLElement>('.w-nick-note')!, btn = el.querySelector<HTMLButtonElement>('[data-send]')!;
  note.textContent = say;
  const send = () => {
    const v = cleanNick(input.value);
    if (!v) { note.textContent = '닉네임은 한 글자부터 열 글자까지 한 줄로 적어 주세요.'; input.focus(); return; }
    if (!link?.askName(v)) return;
    btn.disabled = true; note.textContent = '보내고 있어요.';
    window.setTimeout(() => { if (btn.isConnected && btn.disabled) { btn.disabled = false; note.textContent = '보내지 못했어요. 다시 보내 주세요.'; } }, 4000);
  };
  input.oninput = () => { note.textContent = ''; };
  input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); send(); } };
  btn.onclick = send;
  nickNote = text => { if (!note.isConnected) return; btn.disabled = false; note.textContent = text; input.focus(); };
}
/** 방 서버가 알려 준 내 닉네임 소식. */
function nickNews(state: NickState, v: string) {
  const l = link; if (!l) return;
  const open = !!dialog?.el.querySelector('#w-nick');
  if (state === 'wait') { if (open) closeDialog(); toast('선생님이 닉네임을 보고 있어요.'); }
  else if (state === 'ok') { keepNick(l.code, v); if (open) closeDialog(); toast(`닉네임이 정해졌어요: ${v}`); }
  else if (state === 'no') { keepNick(l.code, ''); toast(''); nickDialog('선생님이 다른 닉네임을 써 달라고 했어요. 다시 적어 주세요.'); }
  else if (state === 'slow') { if (open) nickNote?.('닉네임은 10초에 한 번 보낼 수 있어요. 조금 뒤에 다시 보내 주세요.'); }
  else if (open) nickNote?.('쓸 수 없는 글자가 있어요. 다른 닉네임을 적어 주세요.');
  refresh();
}

// ---------- 선생님 화면: 방 코드 · QR · 닉네임 신청 · 명단 ----------
let teachEl: HTMLElement | null = null, teachOpen = false, askCount = 0;
/** 넓은 화면에서는 게임 화면 옆에 늘 붙어 있고, 좁은 화면에서는 '우리 반' 단추로 연다. */
const teachWide = () => window.matchMedia('(min-width: 1100px)').matches;
function teachButton() {
  const l = link;
  if (!l?.teacher || !l.cls) return '';
  const n = l.asks.length;
  return `<button class="ar-key ghost w-teach-btn" data-teach aria-label="우리 반 보기${n ? `, 닉네임 신청 ${n}건` : ''}">${icon('roster', 17)}<span class="w-hide-s">우리 반</span>${n ? `<b class="w-teach-badge">${n}</b>` : ''}</button>`;
}
function openTeach() { teachOpen = true; paintTeach(); teachEl?.querySelector<HTMLElement>('[data-teach-close]')?.focus(); }
function paintTeach() {
  const l = link, on = !!l && l.me >= 0 && l.teacher && !!l.cls;
  document.body.classList.toggle('w-teaching', on);
  if (!on || !l || !l.cls) { teachEl?.remove(); teachEl = null; teachOpen = false; return; }
  if (!teachEl) {
    teachEl = document.createElement('aside');
    teachEl.className = 'arcade-root w-root w-teach'; teachEl.setAttribute('aria-label', '선생님 화면');
    document.body.appendChild(teachEl);
    teachEl.addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('button'); if (!b) return;
      b.blur();                                           // 초점이 남으면 게임의 엔터 · 스페이스가 이 단추를 다시 누른다
      if (b.hasAttribute('data-teach-close')) { teachOpen = false; paintTeach(); return; }
      const seat = Number(b.dataset.seat), v = b.dataset.v ?? '';
      if (b.dataset.judge && Number.isInteger(seat) && v) link?.judge(seat, b.dataset.judge === 'yes', v);
    });
    teachEl.addEventListener('keydown', e => { if (e.key === 'Escape' && teachOpen) { teachOpen = false; paintTeach(); } e.stopPropagation(); });
  }
  teachEl.classList.toggle('open', teachOpen);
  const who = myPass()?.claims.n ?? '';
  const order = l.room.order;
  const asks = l.asks.map(([seat, v]) => `<div class="ar-row w-ask"><span class="w-swatch" data-color="${swatchFor(seat).hex}"></span><span class="ar-label w-ask-text"><b class="w-ask-nick">${esc(v)}</b><span class="w-ask-who">${esc(seatName(l, seat, order.indexOf(seat) + 1))}</span></span><span class="w-ask-keys"><button class="ar-key ghost" data-judge="yes" data-seat="${seat}" data-v="${esc(v)}">${icon('check', 17)}승인</button><button class="ar-key ghost" data-judge="no" data-seat="${seat}" data-v="${esc(v)}">${icon('close', 17)}반려</button></span></div>`).join('');
  const rows = l.seats.map(s => {
    const n = order.indexOf(s.seat) + 1, nick = l.nickOf(s.seat), screenOnly = s.seat === l.host && l.room.big && !n;
    const tag = [s.seat === l.me ? '나' : '', l.cls!.teachers.includes(s.seat) ? '선생님' : s.seat === l.host ? '방장' : ''].filter(Boolean).join(' · ');
    // 윗줄은 이름(닉네임이 있으면 닉네임), 아랫줄은 색 이름과 지금 하는 일. 닉네임이 열 글자여도 잘리지 않게 두 줄로 쓴다
    const sub = [nick ? `${swatchFor(s.seat).name} 도름이${n ? ` ${n}` : ''}` : '', tag || (l.viewOf(s.seat) === 'pad' ? '조작기' : '각자 화면')].filter(Boolean).join(' · ');
    return `<div class="ar-row w-person w-teach-row"><span class="w-swatch" data-color="${screenOnly ? '#14285F' : swatchFor(s.seat).hex}"></span><span class="ar-label w-ask-text"><b class="w-ask-nick">${screenOnly ? '큰 화면' : esc(seatName(l, s.seat, n))}</b><span class="w-ask-who">${esc(sub)}</span></span>${nick ? `<button class="ar-key ghost w-unname" data-judge="no" data-seat="${s.seat}" data-v="${esc(nick)}" aria-label="${esc(nick)} 닉네임 지우기">${icon('close', 17)}</button>` : '<span class="w-unname-gap"></span>'}</div>`;
  }).join('');
  teachEl.innerHTML = `
    <div class="w-teach-head"><span class="ar-count w-teacher-tag">선생님</span><b class="w-teacher-nick">${who ? `@${esc(who)}` : ''}</b><button class="ar-key ghost w-x" data-teach-close aria-label="닫기">${icon('close', 17)}</button></div>
    ${l.cls.title ? `<p class="w-room-title">${esc(l.cls.title)}</p>` : ''}
    <div class="w-teach-code"><p class="ar-kicker w-kicker">방 코드</p><div class="lab-code w-bigcode">${esc(l.code)}</div><div class="w-qr">${qrFor(inviteUrl())}</div><p class="ar-sub w-teach-how">QR 을 찍거나 방 코드를 넣으면 바로 들어와요. ${l.cls.rank ? '깬 시간은 순위에 올라가요.' : '순위에는 올리지 않아요.'}</p></div>
    <p class="ar-kicker w-kicker w-teach-k">닉네임 신청 <span class="lab-num">${l.asks.length}</span>건</p>
    ${asks ? `<p class="ar-sub w-asks-care">이름, 학번, 연락처 같은 개인정보가 든 닉네임은 반려해 주세요.</p><div class="lab-roster w-asks">${asks}</div>` : '<p class="w-public-none w-asks-none">기다리는 신청이 없어요. 학생이 닉네임을 보내면 여기에 떠요.</p>'}
    <p class="ar-kicker w-kicker w-teach-k">명단 <span class="lab-num">${l.seats.length}</span>명</p>
    <div class="lab-roster w-teach-list">${rows}</div>`;
  paintSwatches(teachEl);
}

/** 친구 부르기 창: 방 코드를 크게, QR, 주소 복사. */
function inviteDialog(fresh: boolean, opener?: HTMLElement) {
  if (!link) return;
  const url = inviteUrl();
  const el = openDialog('친구 부르기', 'ROOM', `
    <p class="ar-kicker w-kicker">방 코드</p>
    <div class="lab-code w-bigcode" data-code>${esc(link.code)}</div>
    <div class="w-qr">${qrSvg(url)}</div>
    <p class="ar-sub w-invite-how">QR 을 찍거나, 도름스 월드 처음 화면에서 방 코드를 넣으면 바로 들어와요.</p>
    <p class="lab-note w-invite-note" role="status"></p>
    <div class="lab-actions">${fresh ? `<button class="ar-key mustard" data-done data-first>${icon('play', 17)}스테이지 고르러 가기</button>` : ''}<button class="ar-key ghost" data-copy ${fresh ? '' : 'data-first'}>${icon('copy', 17)}주소 복사</button></div>`, opener);
  el.querySelector<HTMLButtonElement>('[data-done]')?.addEventListener('click', closeDialog);
  el.querySelector<HTMLButtonElement>('[data-copy]')!.onclick = async () => {
    const note = el.querySelector<HTMLElement>('.w-invite-note')!;
    try { await navigator.clipboard.writeText(url); note.textContent = '주소를 복사했어요.'; }
    catch { note.textContent = url; }                    // 복사가 막힌 기기에서는 주소를 그대로 보여 준다
  };
}

// ---------- 손님 화면: 들어가는 중 · 기다리기 ----------
function drawJoining() {
  if (shown === 'join') return;
  game?.stop();
  host.setStop(null);
  host.app.innerHTML = host.shell(`<div class="w-wait"><p class="ar-kicker w-kicker">방 코드</p><div class="lab-code w-bigcode">${esc(link?.code ?? '')}</div><p class="ar-sub" role="status">방에 들어가고 있어요.</p><div class="lab-actions"><button class="ar-key ghost" data-leave>${icon('back', 17)}처음으로</button></div></div>`, '방에 들어가고 있어요', 'ROOM');
  host.app.querySelector<HTMLButtonElement>('[data-leave]')!.onclick = leaveRoom;
  shown = 'join';
}

const personRow = (seat: number, n: number, l: RoomLink) => {
  const sw = swatchFor(seat), tags = [seat === l.me ? '나' : '', l.cls?.teachers.includes(seat) ? '선생님' : seat === l.host ? '방장' : ''].filter(Boolean).join(' · ');
  const screenOnly = seat === l.host && l.room.big && !n;   // 함께 보기 방의 큰 화면(도름이 없이 보여 주기만 한다)
  return `<div class="ar-row w-person"><span class="w-swatch" data-color="${screenOnly ? '#14285F' : sw.hex}"></span><span class="ar-label">${screenOnly ? '큰 화면' : esc(seatName(l, seat, n))}</span><span class="ar-count">${esc(tags || (l.viewOf(seat) === 'pad' ? '조작기' : '각자 화면'))}</span></div>`;
};
const paintSwatches = (root: ParentNode) => root.querySelectorAll<HTMLElement>('[data-color]').forEach(el => { el.style.background = el.dataset.color!; });

function drawWait(problem = '') {
  const l = link; if (!l) return;
  game?.stop();
  if (shown !== 'wait') {
    host.setStop(null);
    host.app.innerHTML = host.shell(`<div class="w-wait">
        <p class="w-room-title" hidden></p>
        <p class="ar-kicker w-kicker">방 코드</p><div class="lab-code w-bigcode">${esc(l.code)}</div>
        <p class="ar-sub w-wait-say" role="status"></p>
        <div class="lab-roster w-people-list"></div>
        <div class="lab-actions w-wait-actions"><span class="w-nick-slot"></span><button class="ar-key ghost" data-leave>${icon('door', 17)}방 나가기</button></div>
      </div>`, '방에 들어왔어요', 'ROOM');
    host.app.querySelector<HTMLButtonElement>('[data-leave]')!.onclick = leaveRoom;
    shown = 'wait';
  }
  // 선생님 방이면: 방 제목과 닉네임 단추
  const titleEl = host.app.querySelector<HTMLElement>('.w-room-title')!, slot = host.app.querySelector<HTMLElement>('.w-nick-slot')!;
  titleEl.textContent = l.cls?.title ?? ''; titleEl.hidden = !l.cls?.title;
  const nb = nickButton(false);
  if (slot.dataset.key !== nb) { slot.dataset.key = nb; slot.innerHTML = nb; slot.hidden = !nb; slot.querySelector<HTMLButtonElement>('[data-nick]')?.addEventListener('click', e => nickDialog('', e.currentTarget as HTMLElement)); }
  host.app.querySelector('.w-wait-say')!.textContent = problem || '방장이 스테이지를 고르고 있어요. 고르면 바로 함께 시작해요.';
  const list = host.app.querySelector<HTMLElement>('.w-people-list')!;
  list.innerHTML = l.seats.map(s => personRow(s.seat, l.room.order.indexOf(s.seat) + 1, l)).join('');
  paintSwatches(list);
}

// ---------- 조작기 화면 ----------
let padScreen: { paint(): void } | null = null;
function drawPad() {
  const l = link; if (!l) return;
  if (shown === 'pad' && padScreen) { padScreen.paint(); return; }
  host.setStop(null);
  host.app.innerHTML = `<main class="arcade-root w-root w-ctl">
    <div class="w-ctl-top">${roomTags()}<span class="w-ctl-gap"></span><span class="w-nick-slot"></span><button class="ar-key ghost" data-own aria-label="내 화면으로 보기">${icon('screen', 17)}<span class="w-hide-s">내 화면으로 보기</span></button><button class="ar-key ghost" data-leave aria-label="방 나가기">${icon('door', 17)}<span class="w-hide-s">방 나가기</span></button></div>
    <div class="w-ctl-me"><div class="w-ctl-tile" aria-hidden="true"><b class="w-ctl-num"></b></div><p class="w-ctl-name"></p><p class="w-ctl-say" role="status"></p>
      <div class="w-ctl-graph" hidden><button class="ar-key ghost" data-gkind="press">${icon('plus', 17)}<span>식 넣기</span></button><button class="ar-key ghost" data-gkind="desk">${icon('target', 17)}<span>손잡이 달기</span></button></div></div>
    <div class="w-ctl-pad"></div>
  </main>`;
  const root = host.app.querySelector<HTMLElement>('.w-ctl')!;
  const input = new PadInput(); input.mount(root.querySelector<HTMLElement>('.w-ctl-pad')!);
  root.querySelector<HTMLButtonElement>('[data-leave]')!.onclick = leaveRoom;
  root.querySelector<HTMLButtonElement>('[data-own]')!.onclick = () => { link?.setView('play'); refresh(); };
  const send = padSender(p => link?.sendPad(p));
  let raf = 0, padHost = l.host, gpanel: (() => void) | null = null;
  // 그래프 공장 스테이지: 조작기에서도 식과 손잡이를 넣는다. 그 방 앞에 서서 누르면 큰 화면(방장)이 받아 찍는다
  root.querySelectorAll<HTMLButtonElement>('[data-gkind]').forEach(b => b.addEventListener('click', () => {
    if (gpanel) return;
    input.pause(true);
    gpanel = openPanel({
      host: root, kind: b.dataset.gkind === 'desk' ? 'desk' : 'press', fac: 0, latex: () => '', blind: true,
      send: order => { if (!link?.open) return '방과 연결이 끊겼어요'; link.sendOrder(order); return ''; },
      onClose: () => { gpanel = null; input.pause(false); },
    });
  }));
  const frame = (now: number) => { raf = requestAnimationFrame(frame); const p = input.read(); if (link?.open && !link.isHost) send(p, now); };
  raf = requestAnimationFrame(frame);
  const paint = () => {
    const k = link; if (!k) return;
    if (k.host !== padHost) { padHost = k.host; send.again(); }   // 방장이 바뀌었다: 누르고 있던 조작을 새 방장에게 바로 다시 보낸다
    const sw = swatchFor(k.me), n = k.room.order.indexOf(k.me) + 1, nick = k.nickOf(k.me);
    root.querySelector<HTMLElement>('.w-ctl-tile')!.style.background = sw.hex;
    root.querySelector('.w-ctl-num')!.textContent = n ? String(n) : '';
    root.querySelector('.w-ctl-name')!.textContent = nick ? `나는 ${nick}` : n ? `나는 ${sw.name} 도름이 ${n}번` : `나는 ${sw.name} 도름이`;
    const slot = root.querySelector<HTMLElement>('.w-nick-slot')!, nb = nickButton();
    if (slot.dataset.key !== nb) { slot.dataset.key = nb; slot.innerHTML = nb; slot.hidden = !nb; slot.querySelector<HTMLButtonElement>('[data-nick]')?.addEventListener('click', e => nickDialog('', e.currentTarget as HTMLElement)); }
    const p = k.room.stage >= 0 ? findPack(k.room.pack) : null, st = p?.stages[k.room.stage];
    root.querySelector('.w-ctl-say')!.textContent = st ? `${p!.name} ${String(k.room.stage + 1).padStart(2, '0')} ${st.name}. 큰 화면을 보며 움직여요.` : '방장이 스테이지를 고르고 있어요.';
    const hasGraph = !!(p && st && p.stageData[k.room.stage]?.graph.factories.length);
    root.querySelector<HTMLElement>('.w-ctl-graph')!.hidden = !hasGraph;
    updateStrip();
  };
  padScreen = { paint };
  paint();
  shown = 'pad';
  host.setStop(() => { cancelAnimationFrame(raf); input.dispose(); gpanel?.(); padScreen = null; if (shown === 'pad') shown = ''; });
}

// ---------- 게임 화면 ----------
type Game = { key: string; stop(): void; sync(): void; onPad(seat: number, pad: Pad): void; onOrder(seat: number, order: Order): void; onSnap(wire: Wire): void; reorder(before: number[], after: number[]): void; onRank(): void };
/** 방 서버가 마지막으로 알려 준 순위 소식(어느 판의 것인지는 run 으로 가린다). */
let lastRank: RankNews | null = null;
const netStats = { snapBytes: 0, snaps: 0, stepMs: 0, steps: 0, frameMs: 0, frames: 0, got: 0, since: 0 };

function openGame(p: Pack, si: number) {
  const l = link; if (!l) return;
  const key = `${l.room.run}|${p.id}|${si}`;
  if (game?.key === key) { game.sync(); return; }
  game?.stop();
  host.setStop(null);
  const stage = p.stageData[si];
  const world: World = createWorld(stage, l.room.order.map(seat => ({ color: colorFor(seat) })), l.room.seed);
  const pads = new GuestPads();
  let track: Track = newTrack();
  let cam: Camera | undefined, raf = 0, last = performance.now(), acc = 0, ticks = 0, sent = 0, alive = true;
  let hintUntil = last + 6000, ended = false, mathText = '', wasHost = l.isHost, hudKey = '', hostSeat = l.host, myA = false, lift = 0, liftAt = -1e9;

  host.app.innerHTML = `<main class="arcade-root w-root w-play">
    <div class="w-stagebox"><canvas class="px w-canvas" width="${VIEW_W}" height="${VIEW_H}" aria-label="게임 화면"></canvas>
      <div class="lab-hud w-hud"><div class="w-hud-l">${roomTags()}<span class="grow ar-kicker w-hudtitle"><span class="w-hide-s">${esc(p.name)} </span>${String(si + 1).padStart(2, '0')} ${esc(p.stages[si].name)}</span></div><div class="w-hud-r"></div></div>
      <p class="w-hint" role="status"></p>
      <p class="w-math" aria-live="polite" hidden></p>
      <div class="w-end" hidden></div>
    </div></main>`;
  const app = host.app, canvas = app.querySelector<HTMLCanvasElement>('canvas')!, c = canvas.getContext('2d')!;
  const box = app.querySelector<HTMLElement>('.w-stagebox')!, hintEl = app.querySelector<HTMLElement>('.w-hint')!, mathEl = app.querySelector<HTMLElement>('.w-math')!, endEl = app.querySelector<HTMLElement>('.w-end')!, tools = app.querySelector<HTMLElement>('.w-hud-r')!;
  const input = new PadInput(); input.mount(box);
  hintEl.textContent = stage.hint;
  const send = padSender(pad => link?.sendPad(pad));
  const meIdx = () => (link ? link.room.order.indexOf(link.me) : -1);
  const blur = (e: Event) => (e.currentTarget as HTMLElement).blur();   // 단추에 초점이 남으면 엔터·스페이스가 그 단추를 다시 누른다

  /** 위쪽 줄의 단추: 방장과 손님이 다르고, 방장이 바뀌면 다시 그린다. */
  const hud = () => {
    const k = link; if (!k) return;
    const now = `${k.isHost}|${k.room.big}|${joinIn}|${ended}|${teachButton()}|${nickButton()}`;
    updateStrip();
    box.classList.toggle('w-nopad', meIdx() < 0);
    if (now === hudKey) return; hudKey = now;
    tools.innerHTML = k.isHost
      ? `${k.room.big ? `<button class="ar-key ghost" data-joinin aria-pressed="${joinIn}" aria-label="이 화면에서도 도름이 움직이기">${icon('up', 17)}<span class="w-hide-s">나도 뛰기</span></button>` : ''}${teachButton()}<button class="ar-key ghost" data-retry aria-label="처음부터 다시 하기">${icon('redo', 17)}<span class="w-hide-s">다시 하기</span></button><button class="ar-key ghost" data-invite aria-label="친구 부르기">${icon('plus', 17)}<span class="w-hide-s">친구 부르기</span></button><button class="ar-key ghost" data-pick aria-label="스테이지 고르러 나가기">${icon('door', 17)}<span class="w-hide-s">나가기</span></button>`
      : `${k.room.big ? `<button class="ar-key ghost" data-padonly aria-label="조작기로 쓰기">${icon('pad', 17)}<span class="w-hide-s">조작기로 쓰기</span></button>` : ''}${teachButton()}${nickButton()}<button class="ar-key ghost" data-leave aria-label="방 나가기">${icon('door', 17)}<span class="w-hide-s">방 나가기</span></button>`;
    tools.querySelector<HTMLButtonElement>('[data-joinin]')?.addEventListener('click', e => { joinIn = !joinIn; blur(e); reconcile(); hud(); });
    tools.querySelector<HTMLButtonElement>('[data-retry]')?.addEventListener('click', () => start(p, si));
    tools.querySelector<HTMLButtonElement>('[data-invite]')?.addEventListener('click', e => { blur(e); inviteDialog(false); });
    tools.querySelector<HTMLButtonElement>('[data-pick]')?.addEventListener('click', () => host.go(`g/${p.id}`));
    tools.querySelector<HTMLButtonElement>('[data-padonly]')?.addEventListener('click', () => { link?.setView('pad'); refresh(); });
    tools.querySelector<HTMLButtonElement>('[data-leave]')?.addEventListener('click', leaveRoom);
    tools.querySelector<HTMLButtonElement>('[data-teach]')?.addEventListener('click', e => { blur(e); openTeach(); });
    tools.querySelector<HTMLButtonElement>('[data-nick]')?.addEventListener('click', e => { blur(e); nickDialog(); });
  };

  /** 끝 창의 순위 줄: 선생님 방이고 순위에 올리기가 켜져 있을 때만. 등수는 도름스에 적힌 뒤에 온다. */
  const rankLine = () => {
    const el = endEl.querySelector<HTMLElement>('.w-rankline'), k = link;
    if (!el || !k) return;
    const news = lastRank && lastRank.run === k.room.run ? lastRank : null;
    el.hidden = !k.cls?.rank;
    const time = mmss(news ? news.ms : world.t * 1000);
    el.textContent = !news ? `우리 방 기록 ${time}` : news.rank > 0 ? `우리 방 기록 ${time}, ${news.rank}번째로 빨라요.${news.best ? ' 우리 방에서 가장 빠른 기록이에요.' : ''}` : `우리 방 기록 ${time}. 이번 기록은 순위에 올리지 못했어요.`;
  };

  const finish = () => {
    ended = true; hud();
    const k = link; if (!k) return;
    if (k.isHost) k.sendWon(world.t * 1000);              // 선생님 방이고 순위에 올리기가 켜져 있으면 방 서버가 확인해 도름스에 적는다(판마다 한 번)
    const time = mmss(world.t * 1000);
    const next = si + 1 < p.stages.length, n = world.players.length;
    endEl.hidden = false;
    endEl.innerHTML = `<div class="ar-cabinet lab-modal" role="dialog" aria-label="스테이지 끝"><div class="ar-bezel"><div class="ar-brand"><span class="ar-badge">CLEAR</span> 스테이지 끝</div></div><div class="ar-screen"><div class="ar-screen-inner">
      <div class="ar-title">다 함께 성공했어요</div><p class="ar-sub">${n}명이 모두 문으로 들어갔어요. 걸린 시간 <span class="ar-mono w-time">${time}</span></p>
      <p class="ar-sub w-rankline" role="status" hidden></p>
      ${k.isHost
        ? `<div class="lab-actions">${next ? `<button class="ar-key mustard" data-next>${icon('right', 17)}다음 스테이지</button>` : `<button class="ar-key mustard" data-again>${icon('redo', 17)}한 번 더</button>`}${next ? `<button class="ar-key ghost" data-again>${icon('redo', 17)}한 번 더</button>` : ''}<button class="ar-key ghost" data-list>스테이지 고르기</button></div>`
        : '<p class="ar-sub w-end-wait" role="status">방장이 다음 스테이지를 고르고 있어요.</p>'}
    </div></div></div>`;
    endEl.querySelector<HTMLButtonElement>('[data-next]')?.addEventListener('click', () => start(p, si + 1));
    endEl.querySelector<HTMLButtonElement>('[data-again]')?.addEventListener('click', () => start(p, si));
    endEl.querySelector<HTMLButtonElement>('[data-list]')?.addEventListener('click', () => host.go(`g/${p.id}`));
    endEl.querySelector<HTMLButtonElement>('button')?.focus();
    rankLine();
  };

  // 그래프 공장: 찍는 방·손잡이 방 앞에서 확인을 누르면 이 기기에서 창을 연다. 방장은 바로 넣고, 손님은 방장에게 보낸다
  let panel: (() => void) | null = null, prevA = false;
  const orderAt = new Map<number, number>();   // 자리마다 마지막으로 받은 식 주문 시각
  const tryPanel = (a: boolean) => {
    const rose = a && !prevA; prevA = a;
    const mi = meIdx(), me = world.players[mi];
    if (!rose || panel || !me || world.won) return false;
    const act = actionAt(world, me);
    if (!act || (act.do !== 'press' && act.do !== 'desk')) return false;
    input.pause(true);
    panel = openPanel({
      host: box, kind: act.do, fac: act.fac, latex: () => world.g.factories[act.fac]?.latex ?? '',
      send: order => {
        const k = link; if (!k) return '방과 연결이 끊겼어요';
        const at = meIdx();
        if (k.isHost) { const note = placeOrder(stage.graph, world.g, hostOf(world), at, order); return orderDone(note) ? '' : note; }
        const bad = orderProblem(stage.graph, world.g, hostOf(world), at, order);
        if (bad) return bad;
        k.sendOrder(order); return '';
      },
      onClose: () => { panel = null; input.pause(false); prevA = true; },   // 닫은 뒤 확인을 한 번 떼야 다시 연다
    });
    return true;
  };

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const k = link; if (!k) return;
    const t0 = performance.now(), dt = Math.min((now - last) / 1000, 0.1); last = now;
    let myPad = input.read();
    if (tryPanel(!!myPad.a)) myPad = { ...myPad, a: false };
    if (k.isHost !== wasHost) {
      wasHost = k.isHost;
      // 방장이 됐다: 마지막 요약에서 이어서 굴린다. 그 요약에 남아 있는 나간 사람의 도름이는 지금 차례에 맞춰 뺀다
      if (k.isHost) {
        // 요약을 한 번도 받지 못한 채 방장이 됐다(앞 방장이 보내지 않았다): 이어 굴릴 상태가 없으니 이 스테이지를 모두 함께 처음부터 다시 연다
        if (!track.b) { start(p, si); return; }
        if (applyWire(world, track.b)) mine.reorder(wireSeats(track.b), k.room.order);
        sent = Math.min(Math.max(sent, track.b.n), 1e9);   // 요약의 차례 번호는 앞 방장의 것에 이어서 센다(터무니없이 큰 번호는 잇지 않는다)
        reconcile(); acc = 0;
      }
      track = newTrack();                                 // 손님들의 조작은 방장이 바뀐 것을 안 그때(sync) 비웠다: 여기서 또 비우면 그새 다시 온 조작을 잃는다
      if (ended) { ended = false; finishIfWon(); }
      hud();
    }
    if (k.isHost) {
      acc = Math.min(acc + dt, 0.1);
      // 짧게 누른 확인은 걸음이 한 번도 돌지 않은 프레임에 읽히면 사라진다: 걸음이 돌 때까지 들고 있는다
      myA ||= !!myPad.a;
      const hostPad: Pad = { ...myPad, a: myA };
      const ran = acc >= 1 / 60;
      while (acc >= 1 / 60) {
        const order = k.room.order, s0 = performance.now();
        step(world, order.map(seat => (seat === k.me ? hostPad : pads.get(seat, now))), 1 / 60);   // 손님은 마지막으로 보낸 조작을 그대로 이어 쓴다
        pads.stepped();
        acc -= 1 / 60; ticks++;
        if (ticks % (world.won ? 30 : SNAP_EVERY) === 0) { netStats.snapBytes = k.sendSnap(toWire(world, order, k.room.run, ++sent)); netStats.snaps++; }
        netStats.stepMs += performance.now() - s0; netStats.steps++;
      }
      if (ran) myA = false;
    } else {
      send(myPad, now);
      blend(world, track, now, dt);
    }
    const me = meIdx();
    if (now - liftAt > 500) { liftAt = now; lift = padLift(canvas, stage); }   // 화면 단추가 판 아래를 덮는 만큼 판을 올려 그린다(단추가 없는 큰 화면은 0)
    cam = cameraFor(world, world.won || (k.isHost && k.room.big) || me < 0 ? null : me, cam, lift);
    render(c, world, cam, now, me >= 0 ? me : null, headNames(k));
    if (now > hintUntil && hintEl.textContent) hintEl.textContent = '';
    const math = hintEl.textContent || world.won ? '' : nearText(world, me >= 0 ? me : null);
    if (math !== mathText) {
      mathText = math; mathEl.hidden = !math;
      mathEl.replaceChildren(...(math ? math.split('\n') : []).map(t => { const s = document.createElement('span'); s.textContent = t; return s; }));
    }
    finishIfWon();
    netStats.frameMs += performance.now() - t0; netStats.frames++;
  };
  const finishIfWon = () => { if (world.won && !ended) finish(); };

  const mine: Game = {
    key,
    stop() {
      if (!alive) return; alive = false;
      cancelAnimationFrame(raf); input.dispose(); panel?.();
      if (game === mine) game = null;
      if (shown === 'game') shown = '';
    },
    sync() {
      // 방장이 바뀌었으면 손님은 앞 방장의 요약 차례를 잊는다(새 방장의 첫 요약부터 받는다)
      // 손님은 누르고 있던 조작을 새 방장에게 바로 다시 보낸다(되풀이 보내기는 1초에 한 번뿐이라 기다리면 그동안 도름이가 선다)
      if (link && link.host !== hostSeat) { hostSeat = link.host; pads.clear(); send.again(); if (!link.isHost) track = newTrack(); }
      hud();
      if (ended) rankLine();
    },
    onRank() { if (ended) rankLine(); },
    onPad(seat, pad) { pads.set(seat, pad, performance.now()); },
    onOrder(seat, order) {
      const k = link; if (!k?.isHost) return;
      const at = k.room.order.indexOf(seat);
      if (at < 0) return;
      // 사람마다 식 주문은 0.3초에 한 번만 받는다(사람이 누르는 속도로는 충분하고, 주문을 퍼부어 방장 판을 멈추지 못한다)
      const now = performance.now();
      if (now - (orderAt.get(seat) ?? -1e9) < 300) return;
      orderAt.set(seat, now);
      placeOrder(stage.graph, world.g, hostOf(world), at, order);
    },
    onSnap(wire) { if (link && !link.isHost && pushWire(track, wire, link.room.run, performance.now())) { netStats.got++; tryClaim(true); } },
    reorder(before, after) {
      for (let i = before.length - 1; i >= 0; i--) if (!after.includes(before[i])) removePlayer(world, i);
      if (world.players.length !== after.length || world.players.some((q, i) => q.color !== colorFor(after[i]))) setPlayerCount(world, after.slice(0, MAX_SEATS).map(colorFor));
    },
  };
  game = mine; shown = 'game';
  hud();
  raf = requestAnimationFrame(frame);
  host.setStop(mine.stop);
  // 시험 도구가 상태를 읽을 수 있게(개발 중에만).
  if (import.meta.env.DEV) {
    const w = window as unknown as Record<string, unknown>;
    w.__world = () => world;
    netStats.since = performance.now(); netStats.snaps = netStats.steps = netStats.frames = netStats.got = 0; netStats.stepMs = netStats.frameMs = 0;
    w.__net = () => ({ code: link?.code, me: link?.me, host: link?.host, isHost: link?.isHost, room: link?.room, seats: link?.seats, myIndex: meIdx(), held: link?.room.order.map(seat => pads.get(seat, performance.now()).m), heads: link ? headNames(link) : undefined, ...netStats, seconds: (performance.now() - netStats.since) / 1000 });
  }
}

if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__room = () => (link ? { code: link.code, me: link.me, host: link.host, isHost: link.isHost, open: link.open, room: link.room, seats: link.seats, shown, cls: link.cls, teacher: link.teacher, names: [...link.names], asks: link.asks, myAsk: link.myAsk } : null);
