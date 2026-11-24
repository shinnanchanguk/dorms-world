/**
 * 도름스 월드 2D. 교과를 고르고, 스테이지 카드를 누르고, 도름이들이 힘을 합쳐 문으로 들어간다.
 * 지금은 한 기기에서 여러 도름이를 번갈아 움직이는 연습 방식까지다(방 서버 연결은 다음 단계).
 */
import '../platform/ui/arcade.css';
import '../platform/ui/world.css';
import '../platform/ui/app.css';
import { FAMILIES, PACKS, findPack, type Pack } from '../platform/packs';
import { icon } from '../platform/icons';
import { colorFor } from '../platform/identity';
import { PadInput } from '../platform/input';
import { VIEW_H, VIEW_W } from '../platform/look';
import { cameraFor, loadAssets, nearText, padLift, render, renderPreview, type Camera } from '../platform/render';
import { actionAt, createWorld, hostOf, step, NO_PAD, type World } from '../platform/sim';
import { orderDone, placeOrder } from '../platform/graph/model';
import { openPanel } from './graph-panel';
import { esc } from '../platform/text';
import { makeScreen } from './make';
import { headOf, loadDormsReview, loadReview, type Review } from './review';
import * as online from './online';
import { creatorLine, initProfiles } from './profile';
import { mountRanks } from './ranks';

const BASE = import.meta.env.BASE_URL;
const app = document.getElementById('app')!;
let stop: (() => void) | null = null;

const levelWord = (d: number) => (d <= 2 ? '쉬움' : d === 3 ? '보통' : '어려움');
const levelOf = (p: Pack) => { const ds = p.stages.map(s => s.difficulty); const lo = levelWord(Math.min(...ds)), hi = levelWord(Math.max(...ds)); return lo === hi ? lo : `${lo}~${hi}`; };   // 1·2 가 둘 다 '쉬움'이면 '쉬움~쉬움' 대신 '쉬움'
const peopleOf = (p: Pack) => `${p.players.min}~${p.players.max}명`;

/** 단추 약속: 화면마다 주 행동 하나만 노랑(mustard), 나머지는 테두리 단추(ghost). 고르기 단추는 ghost + aria-pressed. */
function shell(inner: string, status: string, right: string, back = '') {
  return `<main class="arcade-root w-root"><div class="ar-wrap"><div class="ar-cabinet">
    <div class="ar-bezel"><div class="ar-brand"><span class="ar-badge">DoRms</span> 도름스 월드</div><div class="ar-power"><span class="ar-mono">${right}</span> <span class="ar-led on"></span></div></div>
    <div class="ar-screen"><div class="ar-scanlines"></div><div class="ar-vignette"></div><div class="ar-screen-inner">
      <div class="ar-statusbar w-status">${back}<span>${status}</span></div>${inner}
    </div></div></div></div></main>`;
}

// ---------- 고르는 화면 ----------
function home(family = '전체') {
  stop?.(); stop = null;
  const list = family === '전체' ? PACKS : PACKS.filter(p => p.family === family);
  const count = (f: string) => PACKS.filter(p => p.family === f).length;
  // 스테이지가 올라온 교과만 단추로 둔다(빈 교과 열일곱 개를 늘어놓지 않는다). 순서는 오락실 교과 순서 그대로.
  const tabs = ['전체', ...FAMILIES.filter(f => count(f) > 0)].map(f => `<button class="ar-key ghost" data-family="${esc(f)}" aria-pressed="${f === family}">${esc(f)}${f !== '전체' && count(f) ? ` <span class="lab-num w-tabnum">${count(f)}</span>` : ''}</button>`).join('');
  const cards = list.map(p => `<article class="ar-card" data-pack="${esc(p.id)}">
      <div class="ar-card-shot"><canvas class="px" width="480" height="300" aria-label="${esc(p.name)} 맵 미리보기" role="img"></canvas></div>
      <div class="ar-card-body">
        <div class="ar-card-title">${esc(p.name)}</div>
        <div class="lab-card-meta-row"><span class="ar-tagpill">${esc(p.family)}</span><span class="ar-count">${levelOf(p)}</span><span class="ar-count">${peopleOf(p)}</span></div>
        <div class="ar-card-meta">${creatorLine(p)}</div>
        <button class="ar-key mustard" data-open="${esc(p.id)}">${icon('play', 17)}들어가기</button>
      </div></article>`).join('');
  app.innerHTML = shell(`
    <div class="ar-toolbar w-toolbar"><div class="ar-view-tabs w-families" role="group" aria-label="교과">${tabs}</div><button class="ar-key ghost w-makebtn" data-make>${icon('plus', 17)}게임 만들기</button></div>
    ${list.length ? `<div class="ar-grid">${cards}</div>` : `<p class="ar-empty w-empty">아직 이 교과의 스테이지가 없어요.</p>`}`,
    '교과를 고르고 스테이지에 들어가요', `STAGE ${PACKS.reduce((n, p) => n + p.stages.length, 0)}`);
  // 좁은 화면에서 교과 줄을 옆으로 밀 때, 고른 교과가 화면 밖에 숨지 않게 가운데로 당긴다.
  const famRow = app.querySelector<HTMLElement>('.w-families'), picked = famRow?.querySelector<HTMLElement>('[aria-pressed="true"]');
  if (famRow && picked && famRow.scrollWidth > famRow.clientWidth) famRow.scrollLeft = picked.offsetLeft - famRow.offsetLeft - (famRow.clientWidth - picked.offsetWidth) / 2;
  list.forEach(p => { const cv = app.querySelector<HTMLCanvasElement>(`[data-pack="${CSS.escape(p.id)}"] canvas`); if (cv) renderPreview(cv, p.stageData[0]); });
  app.querySelectorAll<HTMLButtonElement>('[data-family]').forEach(b => b.onclick = () => home(b.dataset.family!));
  app.querySelectorAll<HTMLButtonElement>('[data-open]').forEach(b => b.onclick = () => go(`g/${b.dataset.open}`));
  app.querySelector<HTMLButtonElement>('[data-make]')!.onclick = () => go('make');
  online.home();   // 방 서버 주소가 있을 때만: 방 만들기·방 코드·공개 방(방 안이면 방 줄)
}

// ---------- 팩 화면: 스테이지와 인원 고르기 ----------
function packScreen(p: Pack, people = 4, review: Review | null = null) {
  stop?.(); stop = null;
  const counts = [...new Set([p.players.min, 2, 4, 8, p.players.max])].filter(n => n >= p.players.min && n <= p.players.max).sort((a, b) => a - b);
  if (!counts.includes(people)) people = counts[0];
  const rows = p.stages.map((s, i) => `<button class="ar-row w-stage" data-stage="${i}"><span class="ar-count w-stageno">${String(i + 1).padStart(2, '0')}</span><span class="ar-label">${esc(s.name)}</span><span class="ar-count">${levelWord(s.difficulty)}</span></button>`).join('');
  const open = review?.state === 'open';
  const viaDorms = review?.source === 'dorms';
  const dormsLine: Record<string, string> = {
    submitted: '팩 자료만 들어 있는 요청이에요. 아래에서 직접 해 보고, 화면 맨 위 줄에서 승인하거나 돌려보내 주세요(그 줄은 운영자에게만 보여요).',
    approved: '승인된 요청이에요. 몇 분 안에 자동 검사를 거쳐 실려요.', publishing: '승인돼서 싣는 중이에요.', published: '이미 실린 요청이에요.',
    rejected: '돌려보낸 요청이에요. 선생님이 고쳐서 다시 보내면 새 판으로 바뀌어요.', failed: '싣다가 막힌 요청이에요. 까닭은 도름스 쪽지에 있어요.',
  };
  const autoLine = review?.auto && (review.status === 'approved' || review.status === 'publishing') ? '만든 선생님이 고친 판이라 운영자 승인 없이 자동 검사를 거쳐 바로 실려요.' : '';
  const stateLine = viaDorms ? `${autoLine || (dormsLine[review?.status ?? ''] ?? '요청 상태를 읽지 못했어요.')}${review?.others.length ? ` 판 코드가 함께 왔어요(${review.others.length}개). 새 코드는 실린 뒤에야 돌아서, 여기서는 지금 판으로 보여요. 코드는 작업 창에서 "요청 확인해"로 살펴봐 주세요.` : ''}`
    : review?.state === 'merged' ? '이미 실린 요청이에요.' : review?.state === 'closed' ? '닫힌 요청이에요.'
    : review?.others.length ? `이 요청에는 이 팩 말고 바뀐 파일이 ${review.others.length}개 있어요. 판을 고친 것은 여기서 돌지 않으니 작업 창에서 살펴봐 주세요.`
    : '팩 파일만 바뀐 요청이에요. 아래에서 직접 해 보고, 괜찮으면 승인하러 가서 병합 단추를 누르면 실려요.';
  const reviewBox = review ? `<div class="w-review" role="note">
      <p class="w-review-line"><strong>요청 ${review.number}번을 살펴보는 중이에요.</strong> ${viaDorms ? '보낸 선생님' : '올린 사람'} <span class="w-nick">@${esc(review.creator?.nickname ?? review.author)}</span> · 살펴보는 판 ${esc(review.sha.slice(0, 7))}</p>
      <p class="w-review-line">${esc(stateLine)}</p>
      ${review.update ? `<p class="w-review-line"><strong>이미 실려 있는 팩을 고친 판이에요.</strong> ${review.auto ? '실리면' : '승인하면'} 실려 있는 ${esc(p.id)} 가 이 내용으로 통째로 바뀌어요.</p>` : ''}
      ${review.note ? `<p class="w-review-line">선생님 한마디: ${esc(review.note)}</p>` : ''}
      ${review.decisionNote && review.status === 'rejected' ? `<p class="w-review-line">돌려보내며 남긴 말: ${esc(review.decisionNote)}</p>` : ''}
      ${open && review.others.length ? `<p class="w-review-files">${review.others.slice(0, 8).map(esc).join(', ')}${review.others.length > 8 ? ' 등' : ''}</p>` : ''}
      ${review.extraPacks.length ? `<p class="w-review-line">다른 팩도 함께 바뀌었어요: ${review.extraPacks.map(esc).join(', ')}</p>` : ''}
      <p class="w-review-line w-review-warn">${viaDorms && review.status !== 'submitted' && review.status !== 'rejected' ? '' : '도름스가 아직 확인하지 않은 요청이에요. '}여기 적힌 글은 ${viaDorms ? '보낸 선생님' : '요청을 올린 사람'}이 쓴 것이에요.</p>
      <div class="w-review-actions">${viaDorms ? '' : `<a class="ar-key mustard" data-approve href="${esc(review.url)}" target="_blank" rel="noopener noreferrer">${icon('right', 17)}<span>${open ? '승인하러 가기' : '요청 보러 가기'}</span></a>`}${review.design ? `<button class="ar-key ghost" data-design aria-expanded="false">설계서 보기</button>` : ''}</div>
      <p class="w-review-line w-review-moved" hidden>그새 요청이 바뀌었어요. 화면을 새로 열어 다시 살펴본 뒤 승인해 주세요.</p>
      ${review.design ? `<pre class="w-design" hidden>${esc(review.design)}</pre>` : ''}
    </div>` : '';
  app.innerHTML = shell(`${reviewBox}
    <div class="w-pack">
      <div class="w-pack-head">
        <div class="ar-title w-pack-title">${esc(p.name)}</div>
        <p class="ar-sub">${esc(p.tagline)}</p>
        <div class="ar-card-meta">${creatorLine(p, !!review, review?.creator ?? null)}<span class="ar-tagpill">${esc(p.family)}</span><span class="ar-count">${peopleOf(p)}</span></div>
        <p class="w-intent">${esc(p.educationalIntent)}</p>
      </div>
      <div>
        <p class="ar-kicker w-kicker">연습 인원</p>
        <div class="ar-view-tabs w-counts" role="group" aria-label="연습 인원">${counts.map(n => `<button class="ar-key ghost" data-people="${n}" aria-pressed="${n === people}">${n}명</button>`).join('')}</div>
        <p class="ar-kicker w-kicker">스테이지</p>
        <div class="lab-roster w-stages">${rows}</div>
        <p class="w-keys"><span>한 기기에서 도름이를 번갈아 움직여요.</span> <span>움직이기 왼쪽·오른쪽 방향키</span> · <span>뛰기 스페이스(또는 Z)</span> · <span>확인 엔터(문에 들어가기, 식 넣기, 손잡이 잡고 놓기)</span> · <span>도름이 바꾸기 Tab</span></p>
      </div>
    </div>`,
    '스테이지를 고르면 바로 시작해요', `STAGE ${p.stages.length}`,
    `<button class="ar-key ghost w-backbtn" data-back>${icon('back', 17)}처음으로</button>`);
  app.querySelectorAll<HTMLButtonElement>('[data-people]').forEach(b => b.onclick = () => packScreen(p, Number(b.dataset.people), review));
  app.querySelectorAll<HTMLButtonElement>('[data-stage]').forEach(b => b.onclick = () => (online.inRoom() && !review ? online.start(p, Number(b.dataset.stage)) : play(p, Number(b.dataset.stage), people, review)));
  // 승인하러 가기 전에 요청이 그새 바뀌지 않았는지 본다(살펴본 뒤에 다른 것을 밀어 넣으면 알 수 있게). 확인이 안 되면 그대로 보낸다.
  const approve = app.querySelector<HTMLAnchorElement>('[data-approve]'), moved = app.querySelector<HTMLElement>('.w-review-moved');
  if (review && approve && moved && review.state === 'open') approve.addEventListener('click', e => {
    if (approve.dataset.checked) return;   // 이미 확인했거나, 바뀐 것을 알린 뒤(그때는 이 화면을 새로 연다)
    e.preventDefault();
    // 새 창은 누른 그 순간에 열어 두고(나중에 열면 브라우저가 막는다), 확인이 끝나면 그 창을 요청 화면으로 보낸다
    const tab = window.open('', '_blank');
    const goOn = () => { approve.dataset.checked = '1'; if (tab) { tab.opener = null; tab.location.href = review.url; } else location.href = review.url; };
    headOf(review.number).then(sha => {
      if (sha && sha !== review.sha) { tab?.close(); moved.hidden = false; approve.querySelector('span')!.textContent = '새로 열어 다시 살펴보기'; approve.removeAttribute('target'); approve.href = location.href; approve.dataset.checked = '1'; }
      else goOn();
    }, goOn);
  });
  const designBtn = app.querySelector<HTMLButtonElement>('[data-design]'), designEl = app.querySelector<HTMLElement>('.w-design');
  if (designBtn && designEl) designBtn.onclick = () => { designEl.hidden = !designEl.hidden; designBtn.setAttribute('aria-expanded', String(!designEl.hidden)); designBtn.textContent = designEl.hidden ? '설계서 보기' : '설계서 접기'; };
  app.querySelector<HTMLButtonElement>('[data-back]')!.onclick = () => go('');
  if (!review) online.pack();   // 방 안이면: 연습 인원 대신 방 줄(살펴보는 중인 요청의 팩은 이 기기에만 있어 방에서 함께 열지 않는다)
  if (!review) mountRanks(app, p);   // 순위 줄(도름스가 답할 때만. 살펴보는 중인 요청의 팩에는 순위가 없다)
}

// ---------- 게임 화면 ----------
function play(p: Pack, si: number, people: number, review: Review | null = null) {
  const toPack = () => (review ? packScreen(p, people, review) : go(`g/${p.id}`));   // 검토 중인 팩은 주소가 없으니 화면으로 돌아간다
  stop?.(); stop = null;
  const stage = p.stageData[si];
  const colors = Array.from({ length: people }, (_, i) => colorFor(i));
  let world: World = createWorld(stage, colors.map(color => ({ color })), (Date.now() % 1000003) + 1);   // 공·벌이 오는 차례는 할 때마다 다르다
  let mine = 0, cam: Camera | undefined, raf = 0, last = performance.now(), acc = 0, hintUntil = last + 6000, shown = false, mathText = '', lift = 0, liftAt = -1e9;

  app.innerHTML = `<main class="arcade-root w-root w-play">
    <div class="w-stagebox"><canvas class="px w-canvas" width="${VIEW_W}" height="${VIEW_H}" aria-label="게임 화면"></canvas>
      <div class="lab-hud w-hud">
        <div class="w-hud-l"><span class="ar-count w-hide-s">연습</span><span class="ar-count">${icon('users', 14)}<span><span class="lab-num">${people}</span>명</span></span><span class="grow ar-kicker w-hudtitle"><span class="w-hide-s">${esc(p.name)} </span>${String(si + 1).padStart(2, '0')} ${esc(p.stages[si].name)}</span></div>
        <div class="w-hud-r"><button class="ar-key ghost" data-retry aria-label="처음부터 다시 하기">${icon('redo', 17)}<span class="w-hide-s">다시 하기</span></button><button class="ar-key ghost" data-swap aria-label="다음 도름이로 바꾸기">${icon('swap', 17)}<span class="w-hide-s">도름이 바꾸기</span></button><button class="ar-key ghost" data-all aria-pressed="false" aria-label="모든 도름이를 같이 움직이기">${icon('link', 17)}<span class="w-hide-s">다 같이</span></button><button class="ar-key ghost" data-exit aria-label="나가기">${icon('door', 17)}<span class="w-hide-s">나가기</span></button></div>
      </div>
      <p class="w-hint" role="status"></p>
      <p class="w-math" aria-live="polite" hidden></p>
      <div class="w-end" hidden></div>
    </div></main>`;
  const canvas = app.querySelector<HTMLCanvasElement>('canvas')!, c = canvas.getContext('2d')!;
  const box = app.querySelector<HTMLElement>('.w-stagebox')!, hintEl = app.querySelector<HTMLElement>('.w-hint')!, mathEl = app.querySelector<HTMLElement>('.w-math')!, endEl = app.querySelector<HTMLElement>('.w-end')!;
  const pad = new PadInput(); pad.mount(box);
  hintEl.textContent = stage.hint;
  const swap = () => { for (let k = 1; k <= people; k++) { const n = (mine + k) % people; if (!world.players[n].inDoor) { mine = n; break; } } };
  // 한 기기 연습에서는 한 번에 한 도름이만 움직인다. '다 같이'를 켜면 모두가 내 조작을 따라 해서, 여럿이 밀어야 하는 상자도 혼자 시험해 볼 수 있다
  let together = false;
  const allBtn = app.querySelector<HTMLButtonElement>('[data-all]')!;
  const toggleAll = () => { together = !together; allBtn.setAttribute('aria-pressed', String(together)); };
  allBtn.onclick = e => { toggleAll(); (e.currentTarget as HTMLElement).blur(); };
  const onKey = (e: KeyboardEvent) => { if (panel) return; if (e.code === 'Tab') { e.preventDefault(); swap(); } else if (e.code === 'KeyG' && !e.repeat) toggleAll(); };
  window.addEventListener('keydown', onKey);
  // 단추를 누른 뒤 초점이 남아 있으면 엔터(확인)·스페이스(뛰기)가 그 단추를 다시 누르게 되므로 초점을 뗀다
  app.querySelector<HTMLButtonElement>('[data-swap]')!.onclick = e => { swap(); (e.currentTarget as HTMLElement).blur(); };
  app.querySelector<HTMLButtonElement>('[data-exit]')!.onclick = toPack;
  app.querySelector<HTMLButtonElement>('[data-retry]')!.onclick = () => play(p, si, people, review);   // 누가 문에 먼저 들어가 버려 막혔을 때 모두 처음 자리로

  const finish = () => {
    shown = true;
    window.removeEventListener('keydown', onKey); pad.dispose();   // 끝 창에서는 Tab·스페이스가 단추로 가게 조작을 뗀다
    const sec = Math.round(world.t), time = `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
    const next = si + 1 < p.stages.length;
    endEl.hidden = false;
    endEl.innerHTML = `<div class="ar-cabinet lab-modal" role="dialog" aria-label="스테이지 끝"><div class="ar-bezel"><div class="ar-brand"><span class="ar-badge">CLEAR</span> 스테이지 끝</div></div><div class="ar-screen"><div class="ar-screen-inner">
      <div class="ar-title">다 함께 성공했어요</div><p class="ar-sub">${people}명이 모두 문으로 들어갔어요. 걸린 시간 <span class="ar-mono w-time">${time}</span></p>
      <div class="lab-actions">${next ? `<button class="ar-key mustard" data-next>${icon('right', 17)}다음 스테이지</button>` : `<button class="ar-key mustard" data-again>${icon('redo', 17)}한 번 더</button>`}${next ? `<button class="ar-key ghost" data-again>${icon('redo', 17)}한 번 더</button>` : ''}<button class="ar-key ghost" data-list>스테이지 고르기</button></div>
    </div></div></div>`;
    endEl.querySelector<HTMLButtonElement>('[data-next]')?.addEventListener('click', () => play(p, si + 1, people, review));
    endEl.querySelector<HTMLButtonElement>('[data-again]')!.onclick = () => play(p, si, people, review);
    endEl.querySelector<HTMLButtonElement>('[data-list]')!.onclick = toPack;
    endEl.querySelector<HTMLButtonElement>('button')!.focus();
  };

  // 그래프 공장: 찍는 방·손잡이 방 앞에서 확인을 누르면 창을 연다(창이 열린 동안 자판은 창으로 간다)
  let panel: (() => void) | null = null, prevA = false;
  const tryPanel = (a: boolean) => {
    const rose = a && !prevA; prevA = a;
    const me = world.players[mine];
    if (!rose || panel || !me) return false;
    const act = actionAt(world, me);
    if (!act || (act.do !== 'press' && act.do !== 'desk')) return false;
    pad.pause(true);
    const who = mine;
    panel = openPanel({
      host: box, kind: act.do, fac: act.fac, latex: () => world.g.factories[act.fac]?.latex ?? '',
      send: order => { const note = placeOrder(stage.graph, world.g, hostOf(world), who, order); return orderDone(note) ? '' : note; },
      onClose: () => { panel = null; pad.pause(false); prevA = true; canvas.focus?.(); },   // 닫은 뒤 확인을 한 번 떼야 다시 연다(엔터 자동 반복으로 다시 열리지 않게)
    });
    return true;
  };

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    acc = Math.min(acc + (now - last) / 1000, 0.1); last = now;
    while (acc >= 1 / 60) { const now = pad.read(), pads = world.players.map((_, i) => (together || i === mine ? now : NO_PAD)); if (tryPanel(!!now.a)) pads[mine] = NO_PAD; step(world, pads, 1 / 60); acc -= 1 / 60; }
    if (world.players[mine]?.inDoor && !world.won) swap();
    if (now - liftAt > 500) { liftAt = now; lift = padLift(canvas, stage); }   // 화면 단추가 판 아래를 덮는 만큼 판을 올려 그린다(화면을 돌리면 다시 잰다)
    cam = cameraFor(world, world.won ? null : mine, cam, lift);
    render(c, world, cam, now, mine);
    if (now > hintUntil && hintEl.textContent) hintEl.textContent = '';
    // 가까운 공장의 식과 지금 할 수 있는 일(좁은 세로 화면에서만 보인다. 첫 안내가 떠 있는 동안은 자리를 비켜 준다)
    const math = hintEl.textContent || world.won ? '' : nearText(world, mine);
    if (math !== mathText) {   // 한 줄씩 칸으로: 판 아래 자리가 모자란 짧은 화면에서는 위(오래된 식)부터 가려지고 지금 식과 할 일은 남는다
      mathText = math; mathEl.hidden = !math;
      mathEl.replaceChildren(...(math ? math.split('\n') : []).map(t => { const s = document.createElement('span'); s.textContent = t; return s; }));
    }
    if (world.won && !shown) finish();
  };
  raf = requestAnimationFrame(frame);
  stop = () => { cancelAnimationFrame(raf); window.removeEventListener('keydown', onKey); pad.dispose(); panel?.(); };
  // 시험 도구가 상태를 읽을 수 있게(개발 중에만).
  if (import.meta.env.DEV) Object.assign(window as unknown as object, { __world: () => world, __cam: () => cam });
}

// ---------- 주소 ----------
function go(path: string) { history.pushState(null, '', `${BASE}${path}${online.query()}`); route(); }
function route() {
  if (online.route()) return;   // 방에 들어가는 중이거나 손님이면 온라인 쪽이 화면을 그린다
  let path = '';
  try { path = decodeURIComponent(location.pathname.slice(BASE.length)).replace(/\/+$/, ''); } catch { /* 잘못된 주소는 첫 화면으로 */ }
  if (path === 'make') { stop?.(); stop = null; makeScreen(app, shell, () => go('')); return; }
  const rv = /^review\/(\d{1,5})$/.exec(path);
  if (rv) { reviewScreen(Number(rv[1])); return; }
  const dv = /^review\/r-([0-9a-f-]{36})$/.exec(path);   // 도름스로 들어온 요청(긴 번호가 열람 열쇠)
  if (dv) { reviewScreen(0, dv[1]); return; }
  const m = /^g\/([a-z0-9-]+\/[a-z0-9-]+)$/.exec(path);
  const pack = m ? findPack(m[1]) : null;
  if (pack) packScreen(pack); else home();
}
/** 요청(PR)의 팩을 읽어 와 팩 화면으로 보여 준다. 읽는 동안과 못 읽었을 때는 까닭을 글로 알린다. */
function reviewScreen(number: number, dormsId = '') {
  stop?.(); stop = null;
  const back = `<button class="ar-key ghost w-backbtn" data-back>${icon('back', 17)}처음으로</button>`;
  const say = (text: string) => { app.innerHTML = shell(`<p class="ar-empty w-empty">${esc(text)}</p>`, dormsId ? '도름스로 온 요청' : `요청 ${number}번`, 'REVIEW', back); app.querySelector<HTMLButtonElement>('[data-back]')!.onclick = () => go(''); };
  say('요청을 읽는 중이에요.');
  const here = location.pathname;
  (dormsId ? loadDormsReview(dormsId) : loadReview(number)).then(
    rv => { if (location.pathname === here) packScreen(rv.pack, 2, rv); },
    err => { if (location.pathname === here) say(err instanceof Error ? err.message : '요청을 읽지 못했어요.'); },
  );
}
window.addEventListener('popstate', route);
online.init({ app, shell, go, route, setStop: fn => { stop?.(); stop = fn; } });
initProfiles({ app, openPack: id => go(`g/${id}`) });   // 만든 사람 줄(단추)과 프로필 창

Promise.all([loadAssets(), document.fonts.load('12px Galmuri11').catch(() => undefined)]).then(route, err => {
  app.innerHTML = `<main class="arcade-root w-root"><p class="w-empty">${esc(err instanceof Error ? err.message : '화면을 준비하지 못했어요.')} 새로 고침해 주세요.</p></main>`;
});
