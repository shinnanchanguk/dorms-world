/**
 * 만든 사람 줄(사진 + @닉네임 단추)과, 누르면 뜨는 프로필 창.
 * 값은 src/creators.ts 가 도름스에서 받아 검사해 둔 것만 쓰고, 화면에 넣는 글은 모두 esc 를 거친다.
 * 도름스가 답하지 않으면 pack.json 의 닉네임과 기본 도름이 그림, 이 선생님이 만든 게임 목록만 보인다.
 *
 * 창의 틀은 온라인 쪽 창(src/online.ts 의 openDialog, platform/ui/online.css 의 .w-dialog)과 같은 부품이다.
 * online.ts 를 건드리지 않으려고 여닫는 도우미(openDialog)를 여기에 따로 두었다. 나중에 한 곳으로 합칠 수 있다.
 */
import { PACKS, findPack, type Pack } from '../platform/packs';
import { icon } from '../platform/icons';
import { esc } from '../platform/text';
import { creatorOf, dormText, onCreators, packsBy, refreshCreators, type Creator } from './creators';

const BASE = import.meta.env.BASE_URL;
export const DEFAULT_AVATAR = `${BASE}sprites/creator-default.png`;

/** 한 번 깨진 사진 주소. 다음에 그릴 때는 처음부터 기본 그림을 쓴다. */
const broken = new Set<string>();

type Face = { nickname: string; photo: string; pixel: boolean };
/** 화면에 보일 이름과 사진: 도름스 값이 있으면 그것, 없으면 pack.json 의 닉네임과 팩에 든 그림, 그것도 없으면 기본 도름이. */
export function faceOf(pack: Pack, creator: Creator | null): Face {
  const remote = creator?.avatar && !broken.has(creator.avatar) ? creator.avatar : null;
  const photo = remote ?? (pack.avatarUrl && !broken.has(pack.avatarUrl) ? pack.avatarUrl : DEFAULT_AVATAR);
  return { nickname: creator?.nickname ?? pack.creator.nickname, photo, pixel: !remote };   // 도트 그림만 또렷하게(사진은 부드럽게)
}

const photoHtml = (f: Face, size: number, extra = '') =>
  `<img class="ar-avatar${extra}${f.pixel ? ' px' : ''}" src="${esc(f.photo)}" alt="" width="${size}" height="${size}" decoding="async" data-avatar>`;
const lineLabel = (f: Face) => `만든 사람 @${f.nickname} 프로필 보기`;
const lineInner = (f: Face) => `${photoHtml(f, 30)}<span class="ar-creator-name">@${esc(f.nickname)}</span>`;
const lineSig = (f: Face) => `${f.photo}\n${f.nickname}`;

/** 살펴보는 중인 요청의 팩은 실린 팩 모음에 없어서 따로 기억해 둔다(만든 사람 단추가 눌렸을 때 찾으려고). */
let reviewPack: Pack | null = null;
/** 살펴보는 요청을 보낸 선생님(도름스가 검토 응답에 실어 준 공개 값). 없으면 pack.json 의 닉네임과 기본 그림. */
let reviewCreator: Creator | null = null;

/** 카드와 팩 화면의 만든 사람 줄. 이 줄이 단추다. review 는 아직 실리지 않은 요청의 팩(도름스가 확인한 값이 아니므로 pack.json 값만 쓴다). */
export function creatorLine(pack: Pack, review = false, reviewer: Creator | null = null): string {
  if (review) { reviewPack = pack; reviewCreator = reviewer; }
  const f = faceOf(pack, review ? reviewCreator : creatorOf(pack.id));
  return `<button type="button" class="ar-creator w-creator" data-creator="${esc(pack.id)}"${review ? ' data-review' : ''} data-sig="${esc(lineSig(f))}" aria-haspopup="dialog" aria-label="${esc(lineLabel(f))}">${lineInner(f)}</button>`;
}

/** 프로필 창의 속. games 는 같은 사람이 만든 팩, here 는 지금 보고 있는 팩 번호(그 줄은 '지금 여기'로 표시). */
export function profileBody(pack: Pack, creator: Creator | null, games: readonly Pack[], here = ''): string {
  const f = faceOf(pack, creator);
  const tags = creator?.tags.length ? `<ul class="lab-chips w-prof-tags" aria-label="꼬리표">${creator.tags.map(t => `<li class="ar-tagpill">${esc(t)}</li>`).join('')}</ul>` : '';
  const dorms = creator && creator.dorms !== null ? `<p class="w-prof-dorms"><span class="ar-kicker">받은 도름</span><span class="ar-count">${esc(dormText(creator.dorms))}</span></p>` : '';
  const rows = games.map(g => `<li><button type="button" class="ar-row w-prof-game" data-game="${esc(g.id)}"${g.id === here ? ' aria-current="page"' : ''}><span class="ar-label">${esc(g.name)}</span><span class="ar-tagpill">${esc(g.family)}</span></button></li>`).join('');
  return `<div class="w-prof">
      ${photoHtml(f, 96, ' w-prof-photo')}
      <div class="w-prof-id">
        <h2 class="ar-title w-prof-name">@${esc(f.nickname)}</h2>
        ${creator?.bio ? `<p class="ar-sub w-prof-bio">${esc(creator.bio)}</p>` : ''}
        ${tags}${dorms}
      </div>
    </div>
    <p class="ar-kicker w-kicker" id="w-prof-games-k">이 선생님이 만든 게임</p>
    ${games.length ? `<ul class="lab-roster w-prof-games" aria-labelledby="w-prof-games-k">${rows}</ul>` : `<p class="w-prof-none">아직 월드에 실린 게임이 없어요.</p>`}
    ${creator?.profileUrl ? `<div class="lab-actions"><a class="ar-key mustard" data-dorms-profile href="${esc(creator.profileUrl)}" target="_blank" rel="noopener noreferrer">${icon('right', 17)}<span>도름스 프로필 보기</span></a></div>` : ''}`;
}

// ---------- 창 (online.ts 의 openDialog 와 같은 틀 · 같은 동작) ----------
type Dialog = { el: HTMLElement; body: HTMLElement; opener: HTMLElement | null; close(): void };
let dialog: Dialog | null = null;
const focusableIn = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>('button, input, [href], [tabindex]:not([tabindex="-1"])')].filter(n => !n.hasAttribute('disabled') && n.offsetParent !== null);

/** 창을 띄운다. Esc, 바깥 누르기, 닫기 단추로 닫히고, 떠 있는 동안 Tab 은 창 안을 돌며, 닫으면 창을 연 단추로 초점이 돌아간다. */
function openDialog(title: string, badge: string, label: string, body: string, opener?: HTMLElement | null): Dialog {
  dialog?.close();
  const el = document.createElement('div');
  el.className = 'arcade-root w-root w-dialog';
  el.innerHTML = `<div class="ar-cabinet lab-modal" role="dialog" aria-modal="true" aria-label="${esc(label)}">
    <div class="ar-bezel"><div class="ar-brand"><span class="ar-badge">${esc(badge)}</span> ${esc(title)}</div><button type="button" class="ar-key ghost w-x" data-close aria-label="닫기">${icon('close', 17)}</button></div>
    <div class="ar-screen"><div class="ar-screen-inner">${body}</div></div></div>`;
  document.body.appendChild(el);
  const before = opener ?? (document.activeElement as HTMLElement | null);
  const onKey = (e: KeyboardEvent) => {
    e.stopPropagation();                                  // 창이 떠 있는 동안 누른 키가 뒤 화면으로 새지 않게
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key !== 'Tab') return;
    const f = focusableIn(el); if (!f.length) return;
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
  // 바깥(어두운 곳)을 누르면 닫힌다. 누르기 시작한 곳도 바깥일 때만(창 안에서 글을 끌다가 밖에서 놓은 것은 닫지 않는다).
  // pointerdown 에서 바로 닫으면 이어지는 누르기 기본 동작이 초점을 빼앗아, 연 단추로 돌려놓은 초점이 사라진다. 그래서 click 에서 닫는다.
  let pressedOutside = false;
  el.addEventListener('pointerdown', e => { pressedOutside = e.target === el; });
  el.addEventListener('click', e => { if (e.target === el && pressedOutside) close(); });
  el.addEventListener('error', onPhotoError, true);
  el.querySelector<HTMLButtonElement>('[data-close]')!.onclick = close;
  document.addEventListener('keydown', onKey, true);
  dialog = { el, body: el.querySelector<HTMLElement>('.ar-screen-inner')!, opener: before, close };
  const f = focusableIn(el);
  (el.querySelector<HTMLElement>('[data-first]') ?? f[1] ?? f[0])?.focus();
  return dialog;
}

// ---------- 프로필 창 ----------
let openPack: (id: string) => void = () => undefined;
const herePack = () => {
  try { return /^g\/([a-z0-9-]+\/[a-z0-9-]+)$/.exec(decodeURIComponent(location.pathname.slice(BASE.length)).replace(/\/+$/, ''))?.[1] ?? ''; } catch { return ''; }
};

function showProfile(pack: Pack, review: boolean, opener: HTMLElement) {
  const html = () => {
    const creator = review ? reviewCreator : creatorOf(pack.id);
    return { creator, body: profileBody(pack, creator, packsBy(PACKS, pack, creatorOf, creator), herePack()) };
  };
  const first = html();
  const d = openDialog('만든 사람', 'MAKER', `만든 사람 @${faceOf(pack, first.creator).nickname}`, first.body, opener);
  const wire = () => d.body.querySelectorAll<HTMLButtonElement>('[data-game]').forEach(b => b.onclick = () => {
    const id = b.dataset.game!, same = id === herePack();
    d.close();
    if (!same) openPack(id);                              // 지금 보고 있는 팩이면 창만 닫는다(고른 인원이 처음으로 돌아가지 않게)
  });
  wire();
  // 창이 떠 있는 동안 도름스 값이 도착하면 창 속만 새로 그린다
  let shown = first.body;
  repaintDialog = () => {
    if (dialog !== d) return;
    const next = html();
    if (next.body === shown) return;
    const hadFocus = d.body.contains(document.activeElement);
    shown = next.body; d.body.innerHTML = next.body; wire();
    d.el.querySelector('[role="dialog"]')?.setAttribute('aria-label', `만든 사람 @${faceOf(pack, next.creator).nickname}`);
    if (hadFocus) (focusableIn(d.el)[1] ?? focusableIn(d.el)[0])?.focus();
  };
}
let repaintDialog: () => void = () => undefined;

/** 사진을 받지 못하면 기본 도름이 그림으로 돌아간다(없는 사진, 막힌 주소). */
function onPhotoError(e: Event) {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.hasAttribute('data-avatar') || img.dataset.fell) return;
  const src = img.getAttribute('src') ?? '';
  if (src && src !== DEFAULT_AVATAR) broken.add(src);
  img.dataset.fell = '1'; img.classList.add('px'); img.src = DEFAULT_AVATAR;
}

/** 화면에 떠 있는 만든 사람 줄만 새 값으로 바꾼다(화면 전체를 다시 그리지 않아 스크롤과 고른 교과가 그대로다). */
function repaintLines(root: HTMLElement) {
  root.querySelectorAll<HTMLButtonElement>('button[data-creator]:not([data-review])').forEach(btn => {
    const pack = findPack(btn.dataset.creator ?? '');
    if (!pack) return;
    const f = faceOf(pack, creatorOf(pack.id)), sig = lineSig(f);
    if (btn.dataset.sig === sig) return;
    btn.dataset.sig = sig; btn.setAttribute('aria-label', lineLabel(f)); btn.innerHTML = lineInner(f);
  });
}

/** 한 번만 부른다. app 은 화면이 그려지는 곳, openPack 은 팩 화면으로 가는 함수. */
export function initProfiles(opts: { app: HTMLElement; openPack(id: string): void }) {
  const { app } = opts;
  openPack = opts.openPack;
  app.addEventListener('click', e => {
    const btn = (e.target as Element | null)?.closest?.<HTMLButtonElement>('button[data-creator]');
    if (!btn || !app.contains(btn)) return;
    const pack = btn.hasAttribute('data-review') ? reviewPack : findPack(btn.dataset.creator ?? '');
    if (pack && pack.id === btn.dataset.creator) showProfile(pack, btn.hasAttribute('data-review'), btn);
  });
  app.addEventListener('error', onPhotoError, true);     // 사진의 error 는 위로 올라오지 않아서 내려가는 길에서 잡는다
  onCreators(() => { repaintLines(app); repaintDialog(); });
  // 화면이 바뀔 때마다: 창을 연 단추가 사라졌으면 창을 닫고, 받은 지 5분이 지났으면 다시 받는다
  new MutationObserver(() => {
    if (dialog && dialog.opener && !dialog.opener.isConnected) dialog.close();
    void refreshCreators();
  }).observe(app, { childList: true });
  window.addEventListener('popstate', () => dialog?.close());
  void refreshCreators();
}
