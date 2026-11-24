// 도름스에서 운영자가 승인한 팩을 가져와 이 저장소에 싣는다(GitHub Actions 의 '승인된 팩 싣기'가 돌린다. 사람이 손으로 돌리지 않는다).
// 차례: 도름스에서 승인된 요청 받기 → 팩 파일(과 운영자가 살펴본 판 코드) 써넣기 → 가지에 올리고 요청(PR) 열기 → 자동 검사 → 병합 → 배포 확인 → 도름스에 결과 알리기.
// 팩의 글은 모두 남이 쓴 것이다. 정해진 경로에만 쓰고, 그 글을 명령으로 돌리지 않는다(셸을 거치지 않고 인자로만 넘긴다).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CODE_PREFIX, readCode } from './code-files.mjs';

// 비밀값이 가는 곳은 도름스 하나다. 시험할 때만(따로 켜서) 다른 주소를 쓴다
const ORIGIN = process.env.DORMS_ORIGIN && process.env.DORMS_ALLOW_CUSTOM_ORIGIN === '1' ? process.env.DORMS_ORIGIN.replace(/\/+$/, '') : 'https://dorms.school';
const SECRET = process.env.WORLD_PUBLISH_SECRET || '';
const REPO = process.env.GITHUB_REPOSITORY || 'shinnanchanguk/dorms-world';
const AUTHOR = process.env.PUBLISH_AUTHOR || '';   // "이름 <메일>". 배포가 막히지 않게 저장소 주인 이름으로 커밋하고, 만든 선생님은 커밋 글에 적는다
const ID_OK = /^[a-z0-9-]{1,40}\/[a-z0-9-]{1,40}$/, UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FILE_OK = /^(pack\.json|DESIGN\.md|things\.json|stages\/\d{2}\.(json|map\.txt)|sprites\/[a-z0-9-]{1,40}\.txt)$/;
const MAX_FILE = 100_000, MAX_TOTAL = 300_000, MAX_COUNT = 120;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
const tryly = (cmd, args) => { try { return sh(cmd, args); } catch { return ''; } };
const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').trim().slice(0, max);
// GitHub 글(커밋, 요청 본문)에 들어갈 남의 글: 멘션과 마크다운으로 읽힐 글자를 뺀다
const label = (v, max) => clean(v, max * 2).replace(/[@`\[\]<>|*_#!\\]/g, '').trim().slice(0, max);
export const shaOf = files => { const h = createHash('sha256'); for (const k of Object.keys(files).sort()) h.update(`${k}\0${files[k]}\0`); return h.digest('hex'); };

/** 받은 항목이 실어도 되는 모양인지 본다. 문제가 있으면 까닭을 돌려준다(없으면 빈 글). */
export function problemOf(item) {
  if (!item || typeof item !== 'object') return '항목 모양이 달라요';
  if (!UUID.test(String(item.id))) return '요청 번호 모양이 달라요';
  if (!ID_OK.test(String(item.packId))) return '팩 이름 모양이 달라요';
  if (!Number.isInteger(item.revision) || item.revision < 1) return '판 번호가 없어요';
  if (item.mode !== 'create' && item.mode !== 'update') return '새 팩인지 고친 판인지 알 수 없어요';
  const files = item.files;
  if (!files || typeof files !== 'object' || Array.isArray(files)) return '파일이 없어요';
  const names = Object.keys(files).filter(n => !n.startsWith(CODE_PREFIX));   // 판 코드는 아래 readCode 가 따로 본다
  if (!names.length || names.length > MAX_COUNT) return '파일 수가 맞지 않아요';
  let total = 0;
  for (const n of names) {
    if (!FILE_OK.test(n)) return `둘 수 없는 파일이에요: ${n.slice(0, 80)}`;
    const body = files[n];
    if (typeof body !== 'string' || body.includes('\0')) return `글 파일이 아니에요: ${n}`;
    const size = Buffer.byteLength(body);
    if (size > MAX_FILE) return `파일이 너무 커요: ${n}`;
    total += size;
  }
  if (total > MAX_TOTAL) return '팩이 너무 커요';
  const code = readCode(files);
  if (typeof code === 'string') return code;
  if (!files['pack.json'] || !files['DESIGN.md']) return 'pack.json 이나 DESIGN.md 가 없어요';
  if (shaOf(files) !== item.sha) return '운영자가 살펴본 판과 받은 파일이 달라요';
  let meta;
  try { meta = JSON.parse(files['pack.json']); } catch { return 'pack.json 을 읽지 못했어요'; }
  if (!meta || meta.id !== item.packId) return 'pack.json 의 id 가 팩 이름과 달라요';
  return '';
}

async function dorms(method, body) {
  const res = await fetch(`${ORIGIN}/api/world/outbox`, { method, redirect: 'error', headers: { authorization: `Bearer ${SECRET}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`도름스 응답 ${res.status}`);
  return res.json();
}
const report = async (item, rest) => {
  for (let i = 0; i < 4; i++) {
    try { await dorms('POST', { id: item.id, revision: item.revision, sha: item.sha, ...rest }); return true; } catch (err) { console.log(`  도름스에 알리지 못했어요(${err.message}). 다시 해 봐요.`); await sleep(5000 * (i + 1)); }
  }
  return false;
};

async function waitCheck(pr, head) {
  // 이 작업이 연 요청의 자동 검사는 GitHub 가 '승인 필요'로 잡아 둔다(자동 작업이 연 요청이라서). 그 실행을 승인해 돌리고, 요청이 병합할 수 있는 상태가 될 때까지 기다린다.
  const until = Date.now() + 32 * 60_000;   // 팩 검사 작업 한도(30분)보다 조금 길게. 스테이지가 많은 팩은 검사만 13분이 걸린다
  let approved = new Set(), last = '';
  while (Date.now() < until) {
    await sleep(8000);
    const held = tryly('gh', ['api', `repos/${REPO}/actions/runs?head_sha=${head}&status=action_required`, '--jq', '.workflow_runs[].id']).split('\n').filter(v => /^\d+$/.test(v));
    for (const id of held) if (!approved.has(id)) { approved.add(id); const ok = tryly('gh', ['api', '-X', 'POST', `repos/${REPO}/actions/runs/${id}/approve`]); console.log(`  잡혀 있던 검사 실행 ${id} 를 돌려요.`); void ok; }
    let view = {};
    try { view = JSON.parse(tryly('gh', ['pr', 'view', pr, '-R', REPO, '--json', 'mergeStateStatus,headRefOid,statusCheckRollup']) || '{}'); } catch { /* 잠깐 못 읽으면 다시 */ }
    if (view.headRefOid && view.headRefOid !== head) return { ok: false, why: '요청의 내용이 그새 바뀌었어요.' };
    const checks = (view.statusCheckRollup ?? []).filter(c => c.name === 'check');
    const state = `${view.mergeStateStatus} ${checks.map(c => `${c.status}:${c.conclusion}`).join(',')}`;
    if (state !== last) { console.log(`  요청 상태 ${state}`); last = state; }
    if (checks.some(c => c.status === 'COMPLETED' && !['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(c.conclusion))) return { ok: false, failed: true };
    if (view.mergeStateStatus === 'DIRTY') return { ok: false, dirty: true };   // 판 코드가 그새 바뀐 운영 판과 겹친다
    if (['CLEAN', 'UNSTABLE', 'HAS_HOOKS'].includes(view.mergeStateStatus) && checks.some(c => c.conclusion === 'SUCCESS')) return { ok: true };
  }
  return { ok: false, late: true };
}
async function waitDeploy(commit) {
  // 배포가 끝났는지 커밋에 붙는 상태로 본다. 6분 안에 안 보이면 그대로 알린다(배포는 따로 이어진다)
  const until = Date.now() + 6 * 60_000;
  while (Date.now() < until) {
    await sleep(10_000);
    const out = tryly('gh', ['api', `repos/${REPO}/commits/${commit}/status`, '--jq', '[.statuses[] | select(.context | test("vercel"; "i")) | .state] | first // ""']);
    if (out === 'success') return 'ready';
    if (out === 'failure' || out === 'error') return 'failed';
  }
  return 'unknown';
}

export async function publish(item) {
  const [subject, pack] = item.packId.split('/'), dir = join('packs', subject, pack), branch = `pack/${subject}--${pack}`;
  const code = readCode(item.files), codePaths = Object.keys(code.code), hasCode = codePaths.length + code.deleted.length > 0;
  const packFiles = Object.fromEntries(Object.entries(item.files).filter(([k]) => !k.startsWith(CODE_PREFIX)));
  const title = label(item.title, 60) || item.packId, who = label(item.author, 30) || '도름스 선생님', no = Number(item.number) | 0;
  sh('git', ['fetch', '-q', 'origin', 'main']);
  const exists = (() => { try { sh('git', ['cat-file', '-e', `origin/main:packs/${subject}/${pack}/pack.json`]); return true; } catch { return false; } })();
  if (hasCode) {
    // 판 코드는 선생님이 내려받은 판(base) 위에서 고친 것이다. 그 자리에서 가지를 내어 요청을 열면, 그사이 운영 판이 바뀐 곳은 GitHub 가 합치고 겹치면 알려 준다.
    const kind = tryly('git', ['cat-file', '-t', code.base]);
    if (kind !== 'commit') return { result: 'failed', reason: `판 코드가 고친 자리(${code.base.slice(0, 7)})를 저장소에서 찾지 못했어요. 선생님께 git pull 로 최신을 받은 뒤 다시 보내 달라고 알려 주세요.` };
    try { sh('git', ['merge-base', '--is-ancestor', code.base, 'origin/main']); } catch { return { result: 'failed', reason: `판 코드가 고친 자리(${code.base.slice(0, 7)})가 운영 판의 기록에 없어요. 선생님께 git pull 로 최신을 받은 뒤 다시 보내 달라고 알려 주세요.` }; }
    // 선생님이 고친 파일이 그사이 운영 판에서 하나도 안 바뀌었으면 운영 판 위에 바로 얹는다. 옛 자리에서 가지를 내면
    // 그 가지의 작업 설정(.github/workflows)이 운영 판과 달라져, 이 작업의 열쇠로는 밀 수 없다(GitHub 가 막는다).
    const touched0 = [...codePaths, ...code.deleted];
    const moved = tryly('git', ['diff', '--name-only', code.base, 'origin/main', '--', ...touched0]);
    sh('git', ['checkout', '-q', '-B', branch, moved ? code.base : 'origin/main']);
    if (moved && tryly('git', ['diff', '--name-only', code.base, 'origin/main', '--', '.github/workflows'])) {
      return { result: 'failed', reason: `선생님이 고친 판 파일이 그새 운영 판에서도 바뀌었고 작업 설정도 달라져 자동으로 얹지 못했어요. 운영자가 작업 창에서 맞춰 실어요(바뀐 파일: ${clean(moved.split('\n').join(', '), 200)}).` };
    }
  } else sh('git', ['checkout', '-q', '-B', branch, 'origin/main']);
  if (item.mode === 'update' && !exists) return { result: 'failed', reason: `${item.packId} 를 고친 판인데 실려 있는 팩이 없어요.` };
  rmSync(dir, { recursive: true, force: true });
  for (const [name, body] of Object.entries(packFiles)) { const to = join(dir, name); mkdirSync(dirname(to), { recursive: true }); writeFileSync(to, body); }
  // 판 코드: 약속한 자리(platform/ src/ tests/ kit/ public/)에만 쓴다. 가는 길에 링크가 있으면 쓰지 않는다(저장소 밖으로 새지 않게)
  const lst = p => { try { return lstatSync(p); } catch { return null; } };   // 깨진 링크도 잡는다(existsSync 는 링크를 따라가 없다고 한다)
  const safeTo = rel => {
    let cur = '.';
    for (const part of rel.split('/').slice(0, -1)) { cur = join(cur, part); const st = lst(cur); if (st && !st.isDirectory()) throw new Error(`판 파일 자리에 폴더가 아닌 것이 있어요: ${rel}`); }
    const st = lst(rel);
    if (st && !st.isFile()) throw new Error(`판 파일 자리가 보통 파일이 아니에요: ${rel}`);
    return rel;
  };
  // 모든 자리를 먼저 검사하고 나서 쓴다(중간에 막혀 반쯤 쓴 코드가 남지 않게)
  for (const path of [...codePaths, ...code.deleted]) safeTo(path);
  for (const path of codePaths) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, code.code[path]); }
  for (const path of code.deleted) rmSync(path, { force: true });
  // 만든 사람 사진은 팩에 넣지 않는다: 얼굴일 수 있는 사진을 공개 저장소 기록에 영영 남기지 않으려는 것이고, 운영자가 살펴본 판에도 들어 있지 않다
  // 오락실 카드와 공유 그림에 쓸 맵 미리보기를 함께 싣는다(우리 코드가 그린 그림이다. 안 되면 그림 없이 간다)
  const shot = join('public', 'previews', `${subject}--${pack}.png`);
  let preview = false;
  if (!hasCode) try {
    if (!existsSync('node_modules/.bin/vite')) sh('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { timeout: 180_000 });
    sh('node', ['scripts/render-previews.mjs', item.packId], { timeout: 120_000 });
    preview = existsSync(shot);
  } catch (err) { console.log(`  미리보기 그림을 뽑지 못했어요(${clean(String(err.stderr || err.message), 160)}). 그림 없이 실어요.`); }
  // 판 코드가 든 요청은 미리보기를 뽑지 않는다: 그림을 뽑으려면 받은 코드를 돌려야 하는데, 이 작업에는 비밀값과 쓰기 권한이 있다
  const touched = [dir, ...(preview ? [shot] : []), ...codePaths, ...code.deleted];
  sh('git', ['add', '-A', '--', ...touched]);
  if (!hasCode && !tryly('git', ['status', '--porcelain', '--', ...touched])) return { result: 'published', commit: sh('git', ['rev-parse', 'origin/main']), same: true, preview: existsSync(shot) };   // 이미 같은 내용이 실려 있다(지난번에 알리기만 실패)
  if (item.mode === 'create' && exists) { sh('git', ['reset', '-q', '--hard']); return { result: 'failed', reason: `${item.packId} 는 이미 있는 팩 이름이에요. 폴더 이름을 바꿔 다시 보내 달라고 알려 주세요.` }; }
  const message = `${item.mode === 'create' ? 'Add' : 'Update'} pack ${item.packId} (request ${no})\n\n${title}\n만든 사람: ${who} (도름스)\n도름스 요청 ${no}번, ${item.revision}번째 판. 운영자가 살펴보고 승인함.${hasCode ? `\n판 코드 ${codePaths.length + code.deleted.length}개 포함(선생님이 고친 자리 ${code.base.slice(0, 7)}).` : ''}`;
  sh('git', ['-c', 'user.name=dorms-world', '-c', 'user.email=dorms-world@users.noreply.github.com', 'commit', '-q', ...(AUTHOR ? ['--author', AUTHOR] : []), '-m', message]);
  const head = sh('git', ['rev-parse', 'HEAD']);
  sh('git', ['push', '-q', '--force', 'origin', `${branch}:${branch}`]);
  const body = `도름스에서 받은 요청 ${no}번이에요(${item.revision}번째 판).\n\n- 팩: \`${item.packId}\`\n- 만든 사람: ${who} (도름스)\n- 운영자가 도름스에서 직접 해 보고 승인했어요.${hasCode ? `\n- 판 코드가 함께 왔어요(운영자가 작업 창에서 코드를 읽고 승인함)${(() => { const flag = [...codePaths, ...code.deleted].filter(p => p.startsWith('tests/') || p.startsWith('kit/')); return flag.length ? `. 기존 시험이나 선생님 AI 안내(kit)를 바꾼 파일 ${flag.length}개 포함` : ''; })()}: ${[...codePaths, ...code.deleted.map(d => `${d}(지움)`)].slice(0, 20).map(p => '`' + label(p, 120) + '`').join(', ')}` : ''}\n\n이 요청은 '승인된 팩 싣기' 작업이 자동으로 열었고, 검사를 통과하면 자동으로 병합해요.`;
  // 우리 저장소의 가지에서 연 요청만 본다(남의 포크가 같은 가지 이름으로 연 요청에 속지 않게)
  const ours = () => tryly('gh', ['pr', 'list', '-R', REPO, '--head', branch, '--state', 'open', '--json', 'number,isCrossRepository', '--jq', '[.[] | select(.isCrossRepository == false)][0].number // ""']);
  let pr = ours();
  if (!pr) { sh('gh', ['pr', 'create', '-R', REPO, '--base', 'main', '--head', branch, '--title', `[팩] ${title} (${item.packId})`, '--body', body]); pr = ours(); }
  if (!/^\d+$/.test(pr)) return { result: 'failed', reason: '요청을 열었는데 번호를 찾지 못했어요. 저장소를 확인해 주세요.' };
  const check = await waitCheck(pr, head);
  if (!check.ok && hasCode && (check.dirty || check.failed)) {
    // 판 코드가 든 요청은 닫지 않는다: 운영자가 그 요청에서 맞춰 고친 뒤 병합한다
    const why = check.dirty ? `선생님이 고친 판 코드가 그새 바뀐 운영 판과 겹쳐요. 요청 #${pr} 을 운영자가 맞춰 실어요.` : `판 코드가 자동 검사에서 걸렸어요. 요청 #${pr} 을 운영자가 고쳐 실어요.`;
    tryly('gh', ['pr', 'comment', pr, '-R', REPO, '--body', why]);
    return { result: 'failed', reason: why.slice(0, 500) };
  }
  if (!check.ok) {
    const log = check.failed ? clean(tryly('gh', ['run', 'list', '-R', REPO, '--workflow', 'pack-check.yml', '--branch', branch, '--limit', '1', '--json', 'databaseId', '--jq', '.[0].databaseId']), 20) : '';
    const why = check.why ?? (check.late ? '자동 검사가 32분 안에 끝나지 않았어요.' : `자동 검사에서 걸렸어요(운영 판 기준). ${clean(tryly('gh', ['run', 'view', log, '-R', REPO, '--log-failed']).split('\n').filter(l => /✗|×|FAIL|걸렸|어요|Error/.test(l)).slice(0, 4).map(l => l.split('\t').pop()).join(' / '), 380)}`);
    tryly('gh', ['pr', 'close', pr, '-R', REPO, '--delete-branch', '--comment', why.slice(0, 500)]);
    return { result: 'failed', reason: why.slice(0, 500) };
  }
  sh('gh', ['pr', 'merge', pr, '-R', REPO, '--squash', '--match-head-commit', head, '--delete-branch']);
  let commit = '';
  for (let i = 0; i < 12 && !/^[0-9a-f]{40}$/.test(commit); i++) { await sleep(2500); commit = tryly('gh', ['pr', 'view', pr, '-R', REPO, '--json', 'mergeCommit', '--jq', '.mergeCommit.oid // ""']); }
  if (!/^[0-9a-f]{40}$/.test(commit)) return { result: 'failed', reason: '병합은 했는데 실린 커밋을 찾지 못했어요. 저장소를 확인해 주세요.' };
  const deploy = await waitDeploy(commit);
  console.log(`  병합 ${commit.slice(0, 7)}, 배포 ${deploy}`);
  if (deploy === 'failed') return { result: 'failed', reason: `병합(${commit.slice(0, 7)})은 됐는데 배포가 실패했어요. 배포 기록을 확인해 주세요.` };
  return { result: 'published', commit, pr: Number(pr), preview };
}

async function main() {
  if (!SECRET) { console.log('WORLD_PUBLISH_SECRET 이 없어 아무것도 하지 않아요.'); return; }
  let got;
  try { got = await dorms('GET'); }
  catch (err) { console.log(`도름스에서 목록을 받지 못했어요(${err.message}). 다음 차례에 다시 해요.`); return; }   // 도름스가 잠깐 안 될 때마다 실패 알림이 쌓이지 않게 조용히 끝낸다
  // 도름스는 가져간 것을 '싣는 중'으로 바꾸므로 받은 것은 차례로 싣는다. 다만 12분이 지나면 새로 시작하지 않는다(남은 것은 15분 뒤 도름스가 다시 내준다)
  const items = Array.isArray(got.items) ? got.items.slice(0, 5) : [], began = Date.now();
  if (!items.length) { console.log('승인돼 기다리는 팩이 없어요.'); return; }
  let bad = 0;
  for (const item of items) {
    if (Date.now() - began > 12 * 60_000) { console.log('  시간이 다 돼 남은 것은 다음 차례로 넘겨요.'); break; }
    console.log(`요청 ${Number(item?.number) || '?'}번 ${ID_OK.test(String(item?.packId)) ? item.packId : ''}`);
    const problem = problemOf(item);
    let out;
    if (problem) out = { result: 'failed', reason: `실을 수 없는 모양이에요: ${problem}` };
    else {
      try { out = await publish(item); }
      catch (err) { out = { result: 'failed', reason: `싣다가 막혔어요: ${clean(String(err.stderr || err.message), 300)}` }; }
    }
    console.log(`  결과 ${out.result}${out.reason ? `: ${out.reason}` : ''}`);
    if (UUID.test(String(item?.id))) { const { same, ...rest } = out; if (!(await report(item, rest))) bad++; }
    if (out.result !== 'published') bad++;
    // 한 항목이 끝나면 작업 폴더를 운영 판과 똑같이 되돌린다(받은 코드가 다음 항목의 미리보기 렌더에서 돌지 않게)
    tryly('git', ['checkout', '-q', '-f', '--detach', 'origin/main']);
    tryly('git', ['clean', '-fdq', '--', 'packs', 'platform', 'src', 'tests', 'kit', 'public']);
  }
  if (bad) process.exitCode = 1;
}
const same = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;   // 윈도우는 드라이브 글자 c:/C: 를 가리지 않는다
if (process.argv[1] && same(fileURLToPath(import.meta.url), resolve(process.argv[1]))) await main();
