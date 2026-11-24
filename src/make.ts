/**
 * '게임 만들기' 화면: 선생님이 자기 AI 에게 붙여 넣을 안내문과 순서.
 * 안내문은 kit/COPY_PROMPT.md 의 첫 코드 칸을 그대로 쓴다(글이 두 곳에서 갈라지지 않게).
 */
import copyMd from '../kit/COPY_PROMPT.md?raw';
import { icon } from '../platform/icons';
import { esc } from '../platform/text';

export const PROMPT = (/```\n([\s\S]*?)\n```/.exec(copyMd)?.[1] ?? '').trim();
const REPO_URL = 'https://github.com/shinnanchanguk/dorms-world';

const STEPS: [string, string][] = [
  ['안내문 복사', '아래 안내문을 복사해요.'],
  ['내 AI 에 붙여 넣기', '내 컴퓨터에서 도는 코딩 AI(Claude Code, Codex 등)에 붙여 넣어요. AI 가 필요한 것을 내려받고 게임을 내 컴퓨터에 띄워요.'],
  ['함께 아이디어 내기', 'AI 가 수업 자료를 묻고, 아이디어를 몇 가지 내놓아요. 고르거나 섞거나 내 생각을 얹어 설계를 같이 정해요.'],
  ['직접 해 보기', 'AI 가 만든 스테이지를 내 컴퓨터 화면에서 바로 해 봐요. 고칠 곳을 말하면 그 자리에서 고쳐요.'],
  ['도름스로 보내기', '마음에 들면 AI 에게 보내 달라고 해요. 처음 한 번은 열리는 도름스 화면에 AI 가 알려 주는 확인 글자를 적고 허락하면 돼요. 운영자가 직접 해 보고 승인하면 여기와 오락실에 내 이름으로 실려요.'],
];

async function copyText(text: string, button: HTMLButtonElement, done: string) {
  const label = button.querySelector('span')!;
  button.dataset.label ??= label.textContent ?? '';   // 원래 글은 한 번만 기억한다(빨리 두 번 눌러도 '복사했어요'로 굳지 않게)
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch {
    // 권한이 막힌 화면(액자 안 등)에서는 글 칸을 골라 복사한다
    const area = document.createElement('textarea'); area.value = text; area.setAttribute('readonly', ''); area.style.position = 'fixed'; area.style.opacity = '0';
    document.body.appendChild(area); area.select();
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    area.remove();
  }
  label.textContent = ok ? done : '복사하지 못했어요';
  // 못 했으면 안내문을 골라 둔다(바로 Ctrl+C 나 길게 눌러 복사할 수 있게)
  if (!ok) { const pre = document.querySelector('.w-prompt'); if (pre) { const range = document.createRange(); range.selectNodeContents(pre); const sel = window.getSelection(); sel?.removeAllRanges(); sel?.addRange(range); } }
  window.clearTimeout(Number(button.dataset.timer));
  button.dataset.timer = String(window.setTimeout(() => { label.textContent = button.dataset.label ?? ''; }, 2400));
}

export function makeScreen(app: HTMLElement, shell: (inner: string, status: string, right: string, back?: string) => string, goHome: () => void) {
  const steps = STEPS.map(([title, body], i) => `<li class="ar-row w-step"><span class="ar-count w-stageno">${i + 1}</span><span class="w-step-text"><strong class="ar-label">${esc(title)}</strong><span class="w-step-body">${esc(body)}</span></span></li>`).join('');
  app.innerHTML = shell(`
    <div class="w-pack w-make">
      <div>
        <div class="ar-title w-pack-title">게임 만들기</div>
        <p class="ar-sub">내 수업 내용으로 협력 게임을 만들어 올려요</p>
        <ol class="w-steps">${steps}</ol>
      </div>
      <div>
        <p class="ar-kicker w-kicker">내 AI 에 붙여 넣을 안내문</p>
        <pre class="w-prompt" tabindex="0" aria-label="안내문">${esc(PROMPT).replace(/https?:\/\/\S+/g, u => `<span class="w-url">${u}</span>`)}</pre>
        <div class="w-make-actions"><button class="ar-key mustard" data-copy>${icon('copy', 17)}<span>안내문 복사</span></button><button class="ar-key ghost" data-copy-url>${icon('copy', 17)}<span>내려받는 주소 복사</span></button></div>
        <p class="ar-kicker w-kicker">필요한 것</p>
        <ul class="w-notes"><li>윈도우 컴퓨터나 맥(어느 쪽이든 똑같이 돼요)</li><li>내 컴퓨터에서 도는 코딩 AI</li><li>Node.js 와 Git(없으면 AI 가 설치를 도와줘요)</li><li>도름스 계정(교사 인증을 마친 계정)</li></ul>
        <p class="ar-kicker w-kicker">알아 둘 것</p>
        <ul class="w-notes"><li>수업 자료는 내 컴퓨터에서 내 AI 가 읽어요. 도름스로 올라가지 않아요.</li><li>내가 쓰는 AI 서비스에는 내용이 전달돼요. 학생 이름, 성적, 연락처가 든 파일은 빼고 주세요.</li><li>가는 것은 팩 폴더의 글 파일(설계서, 지도, 그림)이고, 실릴 때 도름스 닉네임이 함께 보여요. 누구나 볼 수 있으니 학생 이름과 사진은 넣지 마세요.</li><li>그림과 화면 부품은 정해진 물감과 모양으로만 만들어져서, 누가 만들어도 한 게임처럼 보여요.</li></ul>
      </div>
    </div>`,
    '복사해서 내 AI 에 붙여 넣으면 시작돼요', 'MAKE',
    `<button class="ar-key ghost w-backbtn" data-back>${icon('back', 17)}처음으로</button>`);
  app.querySelector<HTMLButtonElement>('[data-back]')!.onclick = goHome;
  app.querySelector<HTMLButtonElement>('[data-copy]')!.onclick = e => copyText(PROMPT, e.currentTarget as HTMLButtonElement, '복사했어요');
  app.querySelector<HTMLButtonElement>('[data-copy-url]')!.onclick = e => copyText(REPO_URL, e.currentTarget as HTMLButtonElement, '주소를 복사했어요');
}
