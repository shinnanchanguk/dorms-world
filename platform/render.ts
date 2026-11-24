/** 그리기. 캔버스 2D, 점 그림이 뭉개지지 않게 늘 정수 자리에 그린다. */
import { ATLAS, BODY_SHADES, MOTION, PALETTE, SPRITES, VIEW_H, VIEW_W, type SpriteName } from './look';
import { T, type Stage } from './stage';
import { actionAt, atDoor, bridgeSolid, createWorld, type Action, type Player, type World } from './sim';
import { INKS, type Sprite } from './sprite';
import { BRIGHT, LIT } from './circuit';
import { itemRect, itemShown } from './things';
import { ctxFor, thingActionAt, thingActionText } from './thing-sim';
import { drawGraphBack, drawGraphFront, graphHud, latexText } from './graph/draw';

const BASE = import.meta.env.BASE_URL;
const images = new Map<string, HTMLImageElement>();
let ready: Promise<void> | null = null;

function load(name: string, file: string) {
  return new Promise<void>((resolve, reject) => {
    const img = new Image();
    img.onload = () => { images.set(name, img); resolve(); };
    img.onerror = () => reject(new Error(`그림을 불러오지 못했어요: ${file}`));
    img.src = `${BASE}sprites/${file}`;
  });
}

export function loadAssets() {
  ready ??= Promise.all([load('atlas', 'doreumi-atlas.png'), ...SPRITES.map(n => load(n, `hf_${n}.png`))]).then(() => undefined);
  return ready;
}
const spr = (n: SpriteName | 'atlas') => images.get(n)!;

const hexToRgb = (hex: string) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const tintCache = new Map<string, HTMLCanvasElement | HTMLImageElement>();
/** 몸 색만 갈아입힌다: 흰 몸은 플레이어 색으로, 그늘과 테두리는 같은 색을 어둡게. */
function tinted(color: string) {
  const key = color.toLowerCase();
  const hit = tintCache.get(key); if (hit) return hit;
  const atlas = spr('atlas');
  if (key === '#f4f7ff') { tintCache.set(key, atlas); return atlas; }
  const cv = document.createElement('canvas'); cv.width = atlas.naturalWidth; cv.height = atlas.naturalHeight;
  const g = cv.getContext('2d')!; g.drawImage(atlas, 0, 0);
  const d = g.getImageData(0, 0, cv.width, cv.height), a = d.data, base = hexToRgb(key);
  const map = new Map(BODY_SHADES.map(([from, k]) => [from, base.map(v => Math.round(v * k))]));
  for (let i = 0; i < a.length; i += 4) {
    if (!a[i + 3]) continue;
    const to = map.get(((a[i] << 16) | (a[i + 1] << 8) | a[i + 2]).toString(16).padStart(6, '0'));
    if (to) { a[i] = to[0]; a[i + 1] = to[1]; a[i + 2] = to[2]; }
  }
  g.putImageData(d, 0, 0); tintCache.set(key, cv); return cv;
}

function drawDoreumi(c: CanvasRenderingContext2D, p: Player, now: number) {
  const moving = p.on && Math.abs(p.vx) > 0;
  const frame = [0, 1, 2, 1][Math.floor(p.walk) % 4];
  let name: string;
  if (p.turnT > 0 || !p.side) name = moving && !p.turnT ? `front_${frame}` : 'front_1';
  else if (!p.on) name = `${p.side}_1`;
  else name = moving ? `${p.side}_${frame}` : `${p.side}_1`;
  const [sx, sy, sw, sh] = ATLAS[name] ?? ATLAS.front_1;   // 모르는 그림 이름이어도 그리기가 멈추지 않게
  const bob = moving ? (Math.floor(now / MOTION.walkBobMs) % 2 ? -1 : 0) : (Math.sin(now / MOTION.idleBreathMs * Math.PI * 2 + p.i) > 0.3 ? -1 : 0);
  c.drawImage(tinted(p.color), sx, sy, sw, sh, Math.round(p.x + p.w / 2 - sw / 2), Math.round(p.y + p.h - sh + 1 + bob), sw, sh);
}

/** lift: 판을 위로 올려 그린 만큼(캔버스 점, 배율과 무관). 휴대폰 가로에서 화면 단추 밑에 바닥 장치가 깔리지 않게 그 아래 흙을 더 보여 준다. */
export type Camera = { x: number; y: number; scale: number; lift?: number };

/** 바닥 장치가 서는 가장 낮은 땅의 윗면(판 점). 칸마다 맨 위 땅을 찾아 그중 가장 낮은 것(구덩이 칸은 건너뜀). */
function floorTop(s: Stage) {
  let low = -1;
  for (let cc = 0; cc < s.cols; cc++) for (let r = 0; r < s.rows; r++) if (s.solid[r * s.cols + cc]) { low = Math.max(low, r); break; }
  return (low < 0 ? s.rows : low) * T;
}

/**
 * 화면 단추가 판 아래쪽을 덮을 때(휴대폰 가로) 판을 얼마나 올려 그릴지(캔버스 점, 배율 1 로 따라가는 내 화면 기준).
 * 땅 위 장치와 발밑 알림 글(땅 아래 50점까지)이 단추 윗변보다 6px 위에 오게 한다. 단추가 안 보이면 0.
 */
export function padLift(canvas: HTMLCanvasElement, stage: Stage): number {
  const pad = canvas.parentElement?.querySelector<HTMLElement>('.w-pad');
  if (!pad || getComputedStyle(pad).display === 'none') return 0;
  const tops = [...pad.querySelectorAll('button')].map(b => b.getBoundingClientRect()).filter(q => q.width > 0).map(q => q.top);
  const r = canvas.getBoundingClientRect();
  if (!tops.length || !r.width) return 0;
  const top = Math.min(...tops);
  if (top >= r.bottom) return 0;
  const f = r.width / VIEW_W;
  const need = floorTop(stage) + 50 - (stage.rows * T - VIEW_H);   // 올리지 않았을 때 화면 안에서 지켜야 할 가장 낮은 자리
  const room = (top - r.top - 6) / f;
  return Math.max(0, Math.min(VIEW_H / 2, Math.ceil(need - room)));
}

/** 화면이 따라갈 자리. me 가 있으면 내 도름이를, 없으면(함께 보는 큰 화면) 모두가 담기게. */
export function cameraFor(w: World, me: number | null, prev?: Camera, lift = 0): Camera {
  const sw = w.stage.cols * T, sh = w.stage.rows * T;
  const alive = w.players.filter(p => !p.inDoor);
  let scale = 1, cx = sw / 2;
  if (me != null && w.players[me] && !w.players[me].inDoor) cx = w.players[me].x + w.players[me].w / 2;
  else if (alive.length) {
    const xs = alive.map(p => p.x);
    const lo = Math.min(...xs), hi = Math.max(...xs) + 22;
    cx = (lo + hi) / 2;
    scale = Math.min(1, Math.max(VIEW_W / sw, 0.5, VIEW_W / (hi - lo + 240)));
  } else if (!w.players.length) cx = w.stage.spawn.x;   // 아직 아무도 없는 큰 화면은 시작 자리를 비춘다
  else if (w.stage.door) cx = w.stage.door.x + T;
  const vw = VIEW_W / scale;
  let x = Math.max(0, Math.min(sw - vw, cx - vw / 2));
  if (sw < vw) x = (sw - vw) / 2;
  if (prev) { x = prev.x + (x - prev.x) * 0.15; scale = prev.scale + (scale - prev.scale) * 0.1; }
  return { x, y: sh - (VIEW_H - lift) / scale, scale, lift };
}

function drawStage(c: CanvasRenderingContext2D, w: World, now: number, me: number | null, names?: readonly string[]) {
  const s = w.stage;
  for (const b of s.bridges) {
    if (!bridgeSolid(w, b.ch, b.mode)) continue;
    const has = new Set(b.cells.map(([cc, r]) => `${cc},${r}`));
    for (const [cc, r] of b.cells) {
      if (has.has(`${cc},${r - 1}`)) { c.fillStyle = PALETTE.crate; c.fillRect(cc * T + 9, r * T, 12, T); c.fillStyle = PALETTE.outline; c.fillRect(cc * T + 9, r * T, 3, T); c.fillRect(cc * T + 18, r * T, 3, T); }
      else c.drawImage(spr('plank'), 0, 0, 30, 15, cc * T, r * T - 2, T, 15);
    }
  }
  for (let r = 0; r < s.rows; r++) for (let cc = 0; cc < s.cols; cc++) {
    if (!s.solid[r * s.cols + cc]) continue;
    const top = r === 0 || !s.solid[(r - 1) * s.cols + cc];
    c.drawImage(spr(top ? 'tile' : 'soil'), cc * T, r * T, T, T);
  }
  for (const d of s.decos) drawSprite(c, d.sprite, d.x, d.y, 2);
  drawCircuit(c, w, now);
  drawThings(c, w, now);
  drawGraphBack(c, s.graph, w.g, s.cols, s.rows, now);
  s.buttons.forEach((b, i) => {
    const down = w.pressed[i] >= w.needs[i], h = down ? 16 : 26;
    for (let x = b.x - 3; x < b.x + b.w; x += T) c.drawImage(spr('button'), x, b.y + 8 - h, 30, h);
    if (w.needs[i] > 1) label(c, `${Math.min(w.pressed[i], w.needs[i])}/${w.needs[i]}`, b.x + b.w / 2, b.y - 26);
  });
  if (s.door) { const img = spr(w.doorOpen ? 'door_open' : 'door'); c.drawImage(img, s.door.x + s.door.w / 2 - 33, s.door.y + s.door.h - 86, w.doorOpen ? 82 : 66, 86); }
  w.crates.forEach((b, ci) => {
    const skin = s.crates[ci].skin;
    if (skin) drawThingSprite(c, skin.frames, now, Math.round(b.x), Math.round(b.y), b.w, b.h);   // 팩의 밀리는 물건
    else c.drawImage(spr('crate'), Math.round(b.x), Math.round(b.y), b.w, b.h);
    const counting = b.need > 1 && b.pushers > 0 && b.pushers < b.need;
    if (skin?.label) label(c, skin.label, b.x + b.w / 2, b.y - (counting ? 26 : 8));
    if (counting) label(c, `${b.pushers}/${b.need}`, b.x + b.w / 2, b.y - 8);
  });
  for (const g of s.signs) drawSign(c, g.x, g.y);
  const order = w.players.filter(p => !p.inDoor).sort((a, b) => Number(a.i === me) - Number(b.i === me));
  for (const p of order) drawDoreumi(c, p, now);
  drawGraphFront(c, s.graph, w.g, now, (x, y) => { const cc = Math.floor(x / T), r = Math.floor(y / T); return cc >= 0 && cc < s.cols && r >= 0 && r < s.rows && !!s.solid[r * s.cols + cc]; });
  // 머리 위에 무언가를 든 도름이는 번호표를 옆으로 비켜 적는다(손잡이를 가리지 않게)
  const held = new Map<number, number>();   // 도름이 차례 → 든 새 물건
  w.h.items.forEach((it, i) => { if (it.at === 2) held.set(it.holder, i); });
  for (const p of order) {   // 든 새 물건은 머리 위에(손님 화면은 요약 사이를 잇느라 도름이가 움직이니, 그릴 때 그 자리에서 잡는다)
    const i = held.get(p.i); if (i == null) continue;
    const k = s.things.kinds[s.things.items[i].kind];
    drawThingSprite(c, k.frames, now, Math.round(p.x + p.w / 2 - k.w / 2), Math.round(p.y - k.h - 3), k.w, k.h);
  }
  const busy = (p: Player) => w.g.pieces.some(pc => pc.state === 'held' && pc.holders[0] === p.i) || w.g.bucket?.holder === p.i;
  // 새 물건은 작아서 번호표를 물건 위에 올린다(발밑으로 내리면 땅 속 놓는 곳 이름표와 겹친다)
  const above = (p: Player) => { const i = held.get(p.i); return i == null ? 0 : s.things.kinds[s.things.items[i].kind].h + 2; };
  for (const p of order) tag(c, p, p.i === me, busy(p) ? -p.h - 26 : above(p), names?.[p.i]);
  if (!w.key.used) c.drawImage(spr('key'), Math.round(w.key.x), Math.round(w.key.y), 32, 18);
  if (me != null && w.players[me] && !w.players[me].inDoor) {
    const p = w.players[me];
    if (s.door && atDoor(w, p)) label(c, '확인을 눌러 들어가요', Math.max(84, Math.min(s.cols * T - 84, s.door.x + s.door.w / 2)), s.door.y - 6);   // 지도 끝에 선 문에서도 글이 잘리지 않게
    const tact = thingActionAt(w, p), act = tact ? null : actionAt(w, p);
    // 발밑 둘째 줄에 적는다(발밑 첫 줄은 장치 이름표와 겹친다)
    const say = tact ? thingActionText(w, tact) : act ? actionText(w, act) : '';
    if (say) label(c, say, Math.max(70, Math.min(s.cols * T - 70, p.x + p.w / 2)), p.y + p.h + 46);
    for (const g of s.signs) if (Math.abs(g.x + T / 2 - (p.x + p.w / 2)) < 50 && Math.abs(g.y - p.y) < 70) bubble(c, g.texts[me % g.texts.length], g.x + T / 2, g.y - 10);
  }
}

// ---------- 회로판 ----------
/**
 * 전선은 칸 가운데를 지나는 굵은 선(남색 테두리, 안은 파랑). 흐르는 칸은 노랗게 빛나고 물결처럼 밝기가 오르내린다.
 * 흐르는 방향은 그리지 않는다(전류 방향을 잘못 보여 주지 않게). 전구는 밝기만큼 빛무리가 커지고, 합선된 전지에는 불꽃이 튄다.
 * 접점 바닥에는 '여기 서요' 발판을 깐다.
 */
function drawCircuit(c: CanvasRenderingContext2D, w: World, now: number) {
  const def = w.stage.circuit, st = w.circuit;
  if (!def) return;
  const H = 15;
  const seg = (x: number, y: number, links: number, width: number, color: string) => {
    const h = Math.floor(width / 2);
    c.fillStyle = color;
    c.fillRect(x + H - h, y + H - h, width, width);
    if (links & 1) c.fillRect(x + H - h, y + H - h, T - H + h, width);
    if (links & 2) c.fillRect(x, y + H - h, H + h, width);
    if (links & 4) c.fillRect(x + H - h, y + H - h, width, T - H + h);
    if (links & 8) c.fillRect(x + H - h, y, width, H + h);
  };
  // 전선(부품 칸도 양쪽 끝까지 선을 잇는다)
  def.cells.forEach((cell, i) => {
    const x = cell.c * T, y = cell.r * T, on = !!st && st.flow[i] > 1e-3;
    seg(x, y, cell.links, 6, PALETTE.navy);
    if (on) {
      const wave = 0.55 + 0.45 * Math.sin(now / 140 - (cell.c + cell.r) * 0.8);
      seg(x, y, cell.links, 2, PALETTE.key);
      c.globalAlpha = wave; seg(x, y, cell.links, 4, PALETTE.key); c.globalAlpha = 1;
    } else seg(x, y, cell.links, 2, PALETTE.outline);
  });
  def.parts.forEach((p, pi) => {
    const cell = def.cells[p.cell], x = cell.c * T, y = cell.r * T, cx = x + H, cy = y + H;
    const across = cell.links & 3 ? 'h' : 'v';   // 양 끝이 옆이면 가로로 놓인 부품
    if (p.kind === 'source') {
      // 전지: 긴 판(+)과 짧고 굵은 판. 선과 직각으로 선다
      c.fillStyle = PALETTE.sky;
      if (across === 'h') c.fillRect(cx - 5, y + 3, 10, T - 6); else c.fillRect(x + 3, cy - 5, T - 6, 10);
      c.fillStyle = PALETTE.navy;
      if (across === 'h') { c.fillRect(cx - 5, y + 3, 3, T - 6); c.fillRect(cx + 2, y + 9, 4, T - 18); c.fillRect(cx - 12, y + 4, 5, 1); c.fillRect(cx - 10, y + 2, 1, 5); }
      else { c.fillRect(x + 3, cy - 5, T - 6, 3); c.fillRect(x + 9, cy + 2, T - 18, 4); c.fillRect(x + 4, cy - 10, 5, 1); c.fillRect(x + 6, cy - 12, 1, 5); }
      if (st?.short[p.net] && Math.floor(now / 90) % 2) {
        // 합선: 전지 둘레에 불꽃
        c.fillStyle = PALETTE.button;
        for (let k = 0; k < 6; k++) { const a = k * 1.05 + now / 200; c.fillRect(Math.round(cx + Math.cos(a) * 14) - 2, Math.round(cy + Math.sin(a) * 14) - 2, 4, 4); }
        c.fillStyle = PALETTE.key;
        for (let k = 0; k < 6; k++) { const a = k * 1.05 + 0.5 - now / 170; c.fillRect(Math.round(cx + Math.cos(a) * 9) - 1, Math.round(cy + Math.sin(a) * 9) - 1, 3, 3); }
      }
    } else if (p.kind === 'lamp') {
      const li = def.lamps.indexOf(pi), pw = st ? st.power[li] : 0, lit = pw >= LIT, bright = pw >= BRIGHT;
      if (lit) {
        // 빛무리: 밝을수록 크고 진하다
        const k = Math.min(1, pw);
        c.fillStyle = PALETTE.key;
        for (const [rad, a] of [[12 + 16 * k, 0.12 + 0.12 * k], [10 + 8 * k, 0.2 + 0.2 * k]] as const) { c.globalAlpha = a; c.beginPath(); c.arc(cx, cy, rad, 0, Math.PI * 2); c.fill(); }
        c.globalAlpha = 1;
      }
      c.fillStyle = PALETTE.navy; c.beginPath(); c.arc(cx, cy, 11, 0, Math.PI * 2); c.fill();
      c.fillStyle = bright ? PALETTE.key : PALETTE.paper; c.beginPath(); c.arc(cx, cy, 9, 0, Math.PI * 2); c.fill();
      if (lit && !bright) { c.fillStyle = PALETTE.key; c.globalAlpha = 0.25 + 0.6 * pw / BRIGHT; c.beginPath(); c.arc(cx, cy, 9, 0, Math.PI * 2); c.fill(); c.globalAlpha = 1; }
      // 필라멘트
      c.fillStyle = lit ? PALETTE.button : PALETTE.outline;
      c.fillRect(cx - 5, cy - 1, 3, 3); c.fillRect(cx - 2, cy - 4, 4, 3); c.fillRect(cx + 2, cy - 1, 3, 3);
    } else {
      // 접점: 끊긴 두 끝과, 바닥의 '여기 서요' 발판. 도름이가 서면 두 끝이 이어진다
      const k = def.contacts.indexOf(pi), shut = !!w.closed[k];
      c.fillStyle = PALETTE.sky;
      if (across === 'h') c.fillRect(cx - 6, y + H - 4, 12, 8); else c.fillRect(x + H - 4, cy - 6, 8, 12);
      c.fillStyle = PALETTE.navy;
      if (across === 'h') { c.fillRect(cx - 9, cy - 4, 5, 8); c.fillRect(cx + 4, cy - 4, 5, 8); }
      else { c.fillRect(cx - 4, cy - 9, 8, 5); c.fillRect(cx - 4, cy + 4, 8, 5); }
      if (shut) { c.fillStyle = PALETTE.key; if (across === 'h') c.fillRect(cx - 4, cy - 2, 8, 4); else c.fillRect(cx - 2, cy - 4, 4, 8); }
      c.fillStyle = PALETTE.navy; c.fillRect(x + 3, y + T - 5, T - 6, 5);
      c.fillStyle = shut ? PALETTE.key : PALETTE.grass; c.fillRect(x + 5, y + T - 4, T - 10, 3);
    }
  });
}

// ---------- 판 아래 글(좁은 화면) ----------
/**
 * 좁은 화면용: 휴대폰 세로에서는 판이 작게 줄어 캔버스 안 글자를 읽을 수 없어서,
 * 가까운 공장의 지금 식과 지금 할 수 있는 일, 판 알림을 판 아래에 함께 적는다.
 */
export function nearText(w: World, me: number | null): string {
  const p = me != null ? w.players[me] : null;
  const gs = w.stage.graph;
  if (!p || p.inDoor) return '';
  const tact = thingActionAt(w, p);
  if (tact && !gs.factories.length) return thingActionText(w, tact);
  if (!gs.factories.length) return '';
  let best = -1, far = 600;
  gs.factories.forEach((f, i) => { const r = f.press[0]; const d = Math.abs(r.x - p.x); if (d < far) { far = d; best = i; } });
  const lat = best >= 0 ? w.g.factories[best]?.latex : '';
  const act = actionAt(w, p);
  if (tact) return [lat ? `지금 식  y = ${latexText(lat)}` : '', graphHud(gs, w.g), thingActionText(w, tact)].filter(Boolean).join('\n');
  return [lat ? `지금 식  y = ${latexText(lat)}` : '', graphHud(gs, w.g), act ? actionText(w, act) : ''].filter(Boolean).join('\n');
}

/** 확인을 누르면 일어날 일을 쉬운 말로. */
function actionText(w: World, a: Action) {
  switch (a.do) {
    case 'press': return '확인: 식 넣기';
    case 'desk': return '확인: 손잡이 달기';
    case 'grab': return w.g.pieces[a.piece]?.state === 'held' ? '확인: 함께 들기' : '확인: 손잡이 잡기';
    case 'drop': return w.g.pieces[a.piece]?.holders[0] === undefined ? '확인: 내려놓기' : '확인: 내려놓기';
    case 'plant': return '확인: 거치대에 꽂기';
    case 'pour': return '확인: 바구니에 쏟기';
    case 'bucket-take': return '확인: 양동이 들기';
    case 'bucket-drop': return '확인: 양동이 내려놓기';
    case 'bucket-empty': return '확인: 물 버리기';
    case 'bell': return '확인: 종 치기';
    case 'sled': return '확인: 썰매 출발';
    case 'nothing': return a.why;
  }
}

const spriteCache = new WeakMap<Sprite, HTMLCanvasElement>();
/** 글자 그림을 그린다. cell 은 한 점의 크기(px). 한 번 그려 둔 것을 다시 쓴다. */
function spriteCanvas(sp: Sprite) {
  let cv = spriteCache.get(sp);
  if (!cv) {
    cv = document.createElement('canvas'); cv.width = sp.w; cv.height = sp.h;
    const g = cv.getContext('2d')!;
    sp.rows.forEach((row, r) => { for (let k = 0; k < sp.w; k++) if (row[k] !== '.') { g.fillStyle = INKS[row[k]]; g.fillRect(k, r, 1, 1); } });
    spriteCache.set(sp, cv);
  }
  return cv;
}
function drawSprite(c: CanvasRenderingContext2D, sp: Sprite, x: number, y: number, cell: number) {
  c.drawImage(spriteCanvas(sp), Math.round(x), Math.round(y), sp.w * cell, sp.h * cell);
}

// ---------- 새 물건(things.json) ----------

/** 여러 장 그림은 0.25초마다 넘긴다. 그림을 칸(w×h)에 맞춰 그린다(점 크기가 정수배라 뭉개지지 않는다). */
function drawThingSprite(c: CanvasRenderingContext2D, frames: Sprite[], now: number, x: number, y: number, w: number, h: number) {
  c.drawImage(spriteCanvas(frames[Math.floor(now / 250) % frames.length]), x, y, w, h);
}

/** 움직임이 고른 그림 차례(잘못된 값이면 첫 장). */
function frameOf(w: World, i: number) {
  const k = w.stage.things.kinds[w.stage.things.items[i].kind];
  let f = 0;
  try { f = Math.floor(Number(k.behavior!.frame!(ctxFor(w, i)))); } catch { f = 0; }
  return Number.isInteger(f) && f >= 0 && f < k.frames.length ? f : 0;
}

/** 놓는 곳과 제자리·내려놓은 새 물건(든 것은 도름이와 함께 그린다). */
function drawThings(c: CanvasRenderingContext2D, w: World, now: number) {
  const s = w.stage.things;
  s.goals.forEach((g, gi) => {
    // 모으기만 받는 곳(어디서 닿아도 센다)은 가져다 놓는 자리처럼 보이지 않게 테두리를 그리지 않는다
    const collectOnly = g.accepts.every(ki => s.kinds[ki].touch === 'collect');
    if (g.sprite) drawSprite(c, g.sprite, g.x + Math.round((g.w - g.sprite.w * 2) / 2), g.y + g.h - g.sprite.h * 2, 2);
    else if (!collectOnly) {   // 그림이 없으면 점선 테두리로 자리를 보인다
      c.fillStyle = PALETTE.outline;
      for (let x = g.x; x < g.x + g.w; x += 8) { c.fillRect(x, g.y, 4, 2); c.fillRect(x, g.y + g.h - 2, 4, 2); }
      for (let y = g.y; y < g.y + g.h; y += 8) { c.fillRect(g.x, y, 2, 4); c.fillRect(g.x + g.w - 2, y, 2, 4); }
    }
    // 이름표는 받침 아래 땅에(머리 높이에 두면 그 자리에 선 도름이의 번호표·든 물건과 겹친다). 다 차면 노란 바탕
    const n = Math.min(w.h.counts[gi], g.need), done = w.h.counts[gi] >= g.need;
    const text = `${g.label ? g.label + ' ' : ''}${n}/${g.need}`, ly = g.y + g.h + 20;
    if (done) { c.font = '700 12px Galmuri11, monospace'; const wd = Math.ceil(c.measureText(text).width) + 12; c.fillStyle = PALETTE.key; c.fillRect(Math.round(g.x + g.w / 2 - wd / 2), ly - 14, wd, 20); }
    label(c, text, g.x + g.w / 2, ly);
  });
  for (let i = 0; i < s.items.length; i++) {
    if (w.h.items[i].at === 2 || !itemShown(s, w.h, i, w.active)) continue;
    const k = s.kinds[s.items[i].kind], r = itemRect(s, w.h, i, w.t);
    const f = k.behavior?.frame ? frameOf(w, i) : -1;
    if (f >= 0) c.drawImage(spriteCanvas(k.frames[f]), Math.round(r.x), Math.round(r.y), k.w, k.h);
    else drawThingSprite(c, k.frames, now + i * 90, Math.round(r.x), Math.round(r.y), k.w, k.h);
    if (k.label) label(c, k.label, r.x + r.w / 2, r.y - 4);
  }
}

function label(c: CanvasRenderingContext2D, text: string, x: number, y: number) {
  c.font = '700 12px Galmuri11, monospace'; c.textAlign = 'center'; c.textBaseline = 'alphabetic';
  const wd = Math.ceil(c.measureText(text).width) + 8;
  c.fillStyle = PALETTE.navy; c.fillRect(Math.round(x - wd / 2), Math.round(y - 12), wd, 16);
  c.fillStyle = PALETTE.paper; c.fillText(text, Math.round(x), Math.round(y));
}

/** 머리 위 표: 보통은 차례 번호, 교사가 승인한 닉네임이 있으면 그 닉네임(남이 쓴 글자라 열 글자로 자르고 글자로만 그린다). */
function tag(c: CanvasRenderingContext2D, p: Player, mine: boolean, lift = 0, name = '') {
  const x = Math.round(p.x + p.w / 2), y = Math.round(p.y - 8 - lift);
  const text = name ? [...name].slice(0, 10).join('') : String(p.i + 1), big = name ? 2 : 0;
  c.font = `700 ${10 + big}px Galmuri11, monospace`; c.textAlign = 'center'; c.textBaseline = 'alphabetic';
  const wd = Math.ceil(c.measureText(text).width) + 6;
  c.fillStyle = mine ? PALETTE.key : PALETTE.paper; c.fillRect(Math.round(x - wd / 2), y - 10 - big, wd, 12 + big + (name ? 1 : 0));
  c.fillStyle = PALETTE.navy; c.fillText(text, x, y);
}

// 표지 그림은 임시(점으로 직접 그림). 화풍에 맞는 그림으로 바꿀 자리.
function drawSign(c: CanvasRenderingContext2D, x: number, y: number) {
  c.fillStyle = PALETTE.door; c.fillRect(x + 13, y + 12, 4, 18);
  c.fillStyle = PALETTE.outline; c.fillRect(x + 3, y + 1, 24, 15);
  c.fillStyle = PALETTE.paper; c.fillRect(x + 5, y + 3, 20, 11);
  c.fillStyle = PALETTE.navy; c.fillRect(x + 8, y + 6, 14, 2); c.fillRect(x + 8, y + 10, 9, 2);
}

function bubble(c: CanvasRenderingContext2D, text: string, x: number, y: number) {
  c.font = '14px Galmuri11, monospace'; c.textAlign = 'center'; c.textBaseline = 'alphabetic';
  const wd = Math.ceil(c.measureText(text).width) + 16;
  c.fillStyle = PALETTE.navy; c.fillRect(Math.round(x - wd / 2) - 2, Math.round(y - 26) - 2, wd + 4, 28);
  c.fillStyle = PALETTE.paper; c.fillRect(Math.round(x - wd / 2), Math.round(y - 26), wd, 24);
  c.fillStyle = PALETTE.navy; c.fillText(text, Math.round(x), Math.round(y - 9));
}

export function render(c: CanvasRenderingContext2D, w: World, cam: Camera, now: number, me: number | null, names?: readonly string[]) {
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.imageSmoothingEnabled = false;
  const lift = Math.round(cam.lift ?? 0);
  if (lift > 0) { c.fillStyle = PALETTE.navy; c.fillRect(0, VIEW_H - lift, VIEW_W, lift); }   // 올려 그린 판의 아래(구덩이 밑)
  c.drawImage(spr('bg'), 0, -lift, VIEW_W, VIEW_H);   // 하늘·언덕도 판과 함께 올린다
  c.setTransform(cam.scale, 0, 0, cam.scale, -Math.round(cam.x * cam.scale), -Math.round(cam.y * cam.scale));
  drawStage(c, w, now, me, names);
  if (lift > 0) drawUnderground(c, w.stage, cam);
  c.setTransform(1, 0, 0, 1, 0, 0);
  const hud = graphHud(w.stage.graph, w.g);
  if (hud) label(c, hud, VIEW_W / 2, 26);
}

/** 올려 그려 드러난 지도 아래: 맨 아래 줄이 땅인 칸은 흙을 이어 그린다(구덩이 칸은 비워 둔다). */
function drawUnderground(c: CanvasRenderingContext2D, s: Stage, cam: Camera) {
  const bottom = cam.y + VIEW_H / cam.scale, last = (s.rows - 1) * s.cols;
  if (bottom <= s.rows * T) return;
  const c0 = Math.max(0, Math.floor(cam.x / T)), c1 = Math.min(s.cols - 1, Math.ceil((cam.x + VIEW_W / cam.scale) / T));
  for (let cc = c0; cc <= c1; cc++) if (s.solid[last + cc]) for (let y = s.rows * T; y < bottom; y += T) c.drawImage(spr('soil'), cc * T, y, T, T);
}

/** 카드의 맵 미리보기. 같은 그리기 코드로 스테이지 전체를 작게 그린다. */
export function renderPreview(canvas: HTMLCanvasElement, stage: Stage) {
  const c = canvas.getContext('2d')!;
  const sw = stage.cols * T, sh = stage.rows * T;
  const scale = Math.max(canvas.width / sw, canvas.height / sh);   // 카드 칸을 채운다(넘치는 쪽은 가운데 기준으로 자름)
  c.imageSmoothingEnabled = false;
  c.drawImage(spr('bg'), 0, 0, canvas.width, canvas.height);
  c.setTransform(scale, 0, 0, scale, Math.round((canvas.width - sw * scale) / 2), Math.round(canvas.height - sh * scale));
  const w = createWorld(stage, [{ color: '#F4F7FF' }, { color: '#FFB3C7' }, { color: '#A8DDF5' }]);
  w.players.forEach((p, i) => { p.x = stage.spawn.x + i * 26; p.y = stage.spawn.y - p.h; p.on = true; });
  drawStage(c, w, 0, null);
  c.setTransform(1, 0, 0, 1, 0, 0);
}
