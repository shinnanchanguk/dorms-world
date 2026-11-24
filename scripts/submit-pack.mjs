// 만든 팩을 도름스로 보낸다: npm run submit -- <교과>/<팩>      내 요청이 어떻게 됐는지: npm run submit -- --status
// 하는 일: 검사 → 팩 파일 모으기 → (처음 한 번) 브라우저에서 도름스 로그인으로 이 컴퓨터를 허락 → 도름스에 보내기.
// GitHub 계정은 필요 없다. 도름스가 받아 운영자에게 쪽지를 보내고, 운영자가 해 본 뒤 승인하면 도름스 월드와 오락실에 실린다.
// 팩 폴더의 자료와, 새 장치를 만들려고 고친 판 코드(platform/, src/, tests/, kit/)를 함께 보낸다.
// 판 코드는 운영자가 살펴본 뒤 저장소에 요청(PR)으로 들어가 실린다(scripts/code-files.mjs).
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CODE_BASE, CODE_DELETED, CODE_PREFIX, CODE_ROOTS, isCodePath, readCode } from './code-files.mjs';

const args = process.argv.slice(2);
const say = msg => console.log(msg);
const stop = (msg, code = 1) => { console.error('\n' + msg); process.exit(code); };
const win = process.platform === 'win32';

// 보내는 곳. 시험할 때만 다른 주소를 쓴다(열쇠가 엉뚱한 곳으로 가지 않게 따로 켜야 한다)
const ORIGIN = (() => {
  const custom = process.env.DORMS_ORIGIN;
  if (!custom || custom === 'https://dorms.school') return 'https://dorms.school';
  if (process.env.DORMS_ALLOW_CUSTOM_ORIGIN !== '1') stop('DORMS_ORIGIN 이 도름스 주소가 아니에요. 시험용이라면 DORMS_ALLOW_CUSTOM_ORIGIN=1 을 함께 주세요.');
  return custom.replace(/\/+$/, '');
})();
const KEY_DIR = join(win ? (process.env.APPDATA || join(homedir(), 'AppData', 'Roaming')) : join(homedir(), '.config'), 'dorms-world');
const KEY_FILE = join(KEY_DIR, ORIGIN === 'https://dorms.school' ? 'key' : 'key-test');
const FILE_OK = /^(pack\.json|DESIGN\.md|things\.json|stages\/\d{2}\.(json|map\.txt)|sprites\/[a-z0-9-]{1,40}\.txt)$/;
const MAX_FILE = 100_000, MAX_TOTAL = 300_000, MAX_COUNT = 120;
const WORDS = { submitted: '운영자가 살펴보기를 기다리는 중', approved: '승인됨, 곧 실려요', publishing: '싣는 중', published: '실렸어요', rejected: '돌려보냄', failed: '싣다가 막힘(운영자가 보고 있어요)' };

// 도름스 화면에 보일 이 컴퓨터의 이름. 컴퓨터 이름에는 실명이 들기 쉬워 운영체제 종류만 보낸다
const DEVICE = win ? '윈도우 컴퓨터' : process.platform === 'darwin' ? '맥 컴퓨터' : '리눅스 컴퓨터';
const sleep = ms => new Promise(r => setTimeout(r, ms));
// 서버가 준 글을 터미널에 찍기 전에 제어 문자를 지운다(화면을 속이는 글자가 섞이지 않게)
const plain = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').trim().slice(0, max);
async function call(path, { method = 'GET', key, body } = {}) {
  let res;
  try {
    res = await fetch(ORIGIN + path, { method, redirect: 'error', headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000) });
  } catch (err) { stop(`도름스에 닿지 못했어요(${err.name === 'TimeoutError' ? '30초 동안 답이 없어요' : '연결 안 됨'}). 인터넷을 확인하고 다시 해 주세요.`); }
  let data = null;
  try { data = await res.json(); } catch { /* 글이 아닌 답 */ }
  return { status: res.status, data: data && typeof data === 'object' ? data : {} };
}
const readKey = () => { try { const k = readFileSync(KEY_FILE, 'utf8').trim(); return /^dorms_pat_[A-Za-z0-9_-]{20,80}$/.test(k) ? k : null; } catch { return null; } };

// 이 컴퓨터를 도름스 계정에 잇는다. 열쇠는 여기서 만들고 도름스에는 그 지문(해시)만 보낸다. 허락은 선생님이 브라우저에서 한다
async function link() {
  const key = 'dorms_pat_' + randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(key).digest('hex');
  const made = await call('/api/world/link', { method: 'POST', body: { tokenHash, device: DEVICE } });
  if (made.status === 429) stop('연결을 너무 자주 시도했어요. 10분쯤 뒤에 다시 해 주세요.');
  const code = String(made.data.code ?? ''), url = `${ORIGIN}/world/link`;   // 여는 주소는 서버가 준 것을 쓰지 않고 여기서 정한다
  if (made.status !== 200 || !/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)) stop(`도름스가 연결을 받지 못했어요(${made.status}). 잠시 뒤 다시 해 주세요.`);
  say(`\n처음 한 번, 이 컴퓨터가 선생님 이름으로 보내도 되는지 도름스에서 허락해 주세요.\n  1. 브라우저에 열리는 화면에서 도름스에 로그인해요(안 열리면 이 주소를 직접 열어요).\n     ${url}\n  2. 그 화면에 아래 확인 글자를 적고 '허락'을 눌러요.\n\n     확인 글자:  ${code}\n\n  (이 글자는 방금 이 컴퓨터에서 보내기를 실행한 선생님만 알아요. 다른 사람이 알려 준 글자는 적지 마세요.)\n기다리는 중이에요(10분 안에).`);
  const opener = win ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawnSync(opener[0], opener[1], { stdio: 'ignore', timeout: 5000 }); } catch { /* 못 열면 주소를 직접 연다 */ }
  const until = Date.now() + 10 * 60_000;
  while (Date.now() < until) {
    await sleep(3000);
    const seen = await call(`/api/world/link?code=${encodeURIComponent(code)}&tokenHash=${tokenHash}`);
    if (seen.data.status === 'approved') {
      mkdirSync(KEY_DIR, { recursive: true, mode: 0o700 });
      try { chmodSync(KEY_DIR, 0o700); } catch { /* 윈도우 */ }
      writeFileSync(KEY_FILE, key + '\n', { mode: 0o600 });
      try { chmodSync(KEY_FILE, 0o600); } catch { /* 윈도우 */ }
      say('허락됐어요. 다음부터는 이 과정 없이 바로 보내요.');
      return key;
    }
    if (seen.data.status === 'denied') stop('도름스 화면에서 거절하셨어요. 보내려면 다시 실행해 주세요.');
    if (seen.data.status === 'expired') stop('시간이 지나 연결이 끝났어요. 다시 실행해 주세요.');
  }
  stop('10분 동안 허락이 없어 멈췄어요. 다시 실행해 주세요.');
}
async function withKey(fn) {
  let key = readKey() ?? await link();
  let res = await fn(key);
  if (res.status === 401) {   // 열쇠가 끝났거나 도름스에서 끊었다. 한 번만 다시 잇는다
    try { rmSync(KEY_FILE, { force: true }); } catch { /* 없으면 그만 */ }
    say('전에 받은 허락이 끝났어요. 다시 허락을 받을게요.');
    key = await link();
    res = await fn(key);
  }
  return res;
}

// ---------- 내 요청 보기 ----------
if (args[0] === '--status') {
  const res = await withKey(key => call('/api/world/packs', { key }));
  if (res.status !== 200) stop(`요청 목록을 읽지 못했어요(${res.status}). ${res.data.message ?? ''}`);
  const list = Array.isArray(res.data.requests) ? res.data.requests : [];
  if (!list.length) { say('아직 보낸 요청이 없어요.'); process.exit(0); }
  for (const r of list) {
    say(`요청 ${Number(r.number) || '?'}번  ${plain(r.packId, 90)}  「${plain(r.title, 40)}」  ${WORDS[r.status] ?? plain(r.status, 20)}`);
    if (r.note) say(`   운영자 한마디: ${plain(r.note, 500)}`);
    if (r.status === 'published' && r.playUrl) say(`   게임 주소: ${plain(r.playUrl, 200)}`);
  }
  process.exit(0);
}

// ---------- 보내기 ----------
const id = args.find(a => !a.startsWith('--')) ?? '';
const noteAt = args.indexOf('--note'), note = noteAt >= 0 ? String(args[noteAt + 1] ?? '').slice(0, 500) : '';
if (/^[a-z0-9-]+\/[a-z0-9-]+$/.test(id) && id.split('/').some(part => part.length > 40)) stop('교과와 팩 폴더 이름은 각각 40자까지예요. 폴더 이름(과 pack.json 의 id)을 줄여 주세요.');
if (!/^[a-z0-9-]{1,40}\/[a-z0-9-]{1,40}$/.test(id)) stop('어느 팩을 보낼지 적어 주세요. 예: npm run submit -- science/digestion\n(운영자에게 한마디를 붙이려면 뒤에 --note "한마디", 보내지 않고 무엇이 갈지만 보려면 --dry-run)');
const dir = join('packs', ...id.split('/'));
if (!existsSync(join(dir, 'pack.json'))) stop(`${dir}/pack.json 이 없어요. 팩 폴더 이름을 확인해 주세요.`);
let meta;
try { meta = JSON.parse(readFileSync(join(dir, 'pack.json'), 'utf8').replace(/^\uFEFF/, '')); } catch { stop(`${dir}/pack.json 을 읽지 못했어요. 쉼표와 따옴표를 확인해 주세요.`); }
if (meta.id !== id) stop(`pack.json 의 id("${meta.id}")가 폴더 이름(${id})과 달라요.`);

say('1/3 검사하는 중이에요(팩 검사, 전체 시험, 빌드, 도름스체크 보안 점검).');
for (const [label, a] of [['팩 검사', ['run', 'check:packs']], ['전체 시험', ['test']], ['빌드', ['run', 'build']], ['도름스체크 보안 점검', ['run', 'check:security']]]) {
  const r = spawnSync(win ? 'npm.cmd' : 'npm', a, { encoding: 'utf8', shell: win });   // 윈도우의 npm 은 npm.cmd 라 셸을 거쳐야 돈다
  if (r.error) stop(`npm 을 실행하지 못했어요(${r.error.message}). Node.js 가 설치돼 있는지 확인해 주세요.`);
  if (r.status !== 0) {
    const lines = ((r.stdout ?? '') + (r.stderr ?? '')).split('\n').map(l => l.trimEnd()).filter(Boolean);
    const picked = lines.filter(l => /✗|×|FAIL|error|걸렸|어요|→/i.test(l)).slice(0, 25);
    stop(`${label}에서 걸렸어요. 아래를 고친 뒤 다시 보내 주세요.\n\n${(picked.length ? picked : lines.slice(-15)).join('\n')}`);   // 걸러서 남는 줄이 없으면 끝부분을 그대로 보여 준다
  }
}

say('2/3 팩 파일을 모으는 중이에요.');
const files = {}, skipped = [];
const walk = rel => {
  for (const name of readdirSync(join(dir, rel)).sort()) {
    const path = rel ? `${rel}/${name}` : name, full = join(dir, path);
    const st = lstatSync(full);   // 링크는 따라가지 않는다(팩 밖의 파일이 딸려 가지 않게)
    if (st.isDirectory()) { walk(path); continue; }
    if (!FILE_OK.test(path)) { if (/^(stages|sprites)\//.test(path)) stop(`${path} 는 보낼 수 없는 이름이에요(이름은 영문 소문자, 숫자, 줄표로 40자까지). 빠진 채로 가면 게임이 깨지니 이름을 고쳐 주세요.`); skipped.push(path); continue; }
    if (!st.isFile() || st.nlink > 1) stop(`${path} 가 보통 파일이 아니에요(다른 파일로 이어진 링크). 팩에는 파일을 직접 넣어 주세요.`);
    // 윈도우 편집기가 붙이는 BOM 과 CRLF 줄 끝을 걷어 맥에서 만든 팩과 같은 글로 보낸다
    const body = readFileSync(full, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    if (Buffer.byteLength(body) > MAX_FILE) stop(`${path} 가 너무 커요(파일 하나는 100KB까지).`);
    if (body.includes('\0') || body.includes('�')) stop(`${path} 가 글 파일이 아니에요. 팩에는 글 파일만 넣어요.`);
    files[path] = body;
  }
};
walk('');
const names = Object.keys(files), total = names.reduce((n, k) => n + Buffer.byteLength(files[k]), 0);
if (!files['DESIGN.md']) stop('설계서(DESIGN.md)가 없어요. 설계서를 먼저 쓰고 선생님 확인을 받은 뒤 보내요.');
if (!names.some(n => n.endsWith('.map.txt'))) stop('스테이지가 하나도 없어요.');
if (names.length > MAX_COUNT) stop(`파일이 너무 많아요(${names.length}개, 120개까지).`);
if (total > MAX_TOTAL) stop(`팩이 너무 커요(${Math.round(total / 1000)}KB, 300KB까지).`);
// 판 코드: 내려받은 판(운영 저장소와 갈라진 자리)에서 바뀐 판 파일을 모은다. 팩만 보내려면 --pack-only.
const git = (...a) => { const r = spawnSync('git', a, { encoding: 'utf8' }); return r.status === 0 ? (r.stdout ?? '').trim() : null; };
const norm = t => t.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
let codeCount = 0, codeBytes = 0;
const inGit = git('rev-parse', '--is-inside-work-tree') === 'true';
if (!inGit && !args.includes('--pack-only')) say('  이 폴더는 git 으로 내려받은 것이 아니라 고친 판 코드를 가려내지 못해요. 팩 파일만 보내요(판 코드도 보내려면 git clone 으로 다시 내려받아 주세요).');
if (!args.includes('--pack-only') && inGit) {
  const remote = (git('remote') ?? '').split('\n').find(r => /shinnanchanguk\/dorms-world(\.git)?$/.test(git('remote', 'get-url', r) ?? '')) ?? 'origin';
  git('fetch', '-q', remote, 'main');   // 인터넷이 안 되면 가진 것으로 견준다
  const base = git('merge-base', 'HEAD', `${remote}/main`) ?? git('rev-parse', 'HEAD');
  const tracked = (git('diff', '--no-renames', '--name-only', base, '--', ...CODE_ROOTS) ?? '').split('\n');
  const untracked = (git('ls-files', '--others', '--exclude-standard', '--', ...CODE_ROOTS) ?? '').split('\n');
  const changed = [...new Set([...tracked, ...untracked])].filter(Boolean).sort();
  const sendCode = {}, deleted = [], cannot = [];
  for (const path of changed) {
    if (!existsSync(path)) { if (isCodePath(path)) deleted.push(path); continue; }
    if (!isCodePath(path)) { cannot.push(path); continue; }
    const st = lstatSync(path);
    if (!st.isFile() || st.nlink > 1) { cannot.push(path); continue; }
    const body = norm(readFileSync(path, 'utf8'));
    const was = git('show', `${base}:${path}`);
    if (was !== null && norm(was).trimEnd() === body.trimEnd()) continue;   // 윈도우 줄 끝만 바뀐 파일은 보내지 않는다
    if (body.includes('\0') || body.includes('�')) { cannot.push(path); continue; }
    sendCode[path] = body;
  }
  const others = (git('status', '--porcelain') ?? '').split('\n').map(l => l.replace(/^\s?\S{1,2}\s+/, '').trim().replace(/^"|"$/g, '')).filter(f => f && !f.startsWith('packs/') && !CODE_ROOTS.some(r => f === r || f.startsWith(r + '/')) && !f.startsWith('.claude/'));
  if (Object.keys(sendCode).length || deleted.length) {
    for (const [path, body] of Object.entries(sendCode)) files[CODE_PREFIX + path] = body;
    files[CODE_BASE] = base;
    if (deleted.length) files[CODE_DELETED] = deleted.join('\n');
    const checked = readCode(files);
    if (typeof checked === 'string') stop(`판 코드를 보낼 수 없어요: ${checked}`);
    codeCount = Object.keys(sendCode).length + deleted.length;
    codeBytes = Object.values(sendCode).reduce((n, b) => n + Buffer.byteLength(b), 0);
    say(`  판 코드도 함께 보내요(바뀐 파일 ${Object.keys(sendCode).length}개${deleted.length ? `, 지운 파일 ${deleted.length}개` : ''}). 운영자가 코드를 살펴본 뒤 실려요.`);
    for (const p of Object.keys(sendCode).slice(0, 12)) say(`    ${p}`);
  }
  if (cannot.length) say(`  판 파일 가운데 보내지 않는 것(글 파일이 아니거나 둘 수 없는 이름): ${cannot.slice(0, 6).join(', ')}${cannot.length > 6 ? ' 등' : ''}`);
  if (others.length) say(`  보내지 않는 파일(팩도 판 코드도 아닌 것, 예: scripts·package.json·설정): ${others.slice(0, 6).join(', ')}${others.length > 6 ? ' 등' : ''}\n  여기에 꼭 필요한 바뀜이 있으면 설계서(DESIGN.md)의 '의견'에 적어 주세요. 운영자가 맞춰 넣어요.`);
}
if (skipped.length) say(`  보내지 않는 파일: ${skipped.slice(0, 6).join(', ')}${skipped.length > 6 ? ' 등' : ''}${skipped.some(s => /\.(png|webp)$/.test(s)) ? '\n  (만든 사람 그림은 기본 도름이로 보여요. 사진은 싣지 않아요)' : ''}`);

if (args.includes('--dry-run')) {   // 보내지 않고 무엇이 갈지만 본다(검사는 모두 돌린다)
  say(`보내지 않고 여기서 멈춰요(--dry-run). 보낼 팩 파일 ${names.length}개, ${Math.max(1, Math.round(total / 1000))}KB${codeCount ? `, 판 코드 ${codeCount}개 ${Math.max(1, Math.round(codeBytes / 1000))}KB` : ''}:\n${Object.keys(files).filter(n => n !== CODE_BASE).map(n => '  ' + n).join('\n')}`);
  process.exit(0);
}
say(`3/3 도름스로 보내는 중이에요(팩 파일 ${names.length}개, ${Math.max(1, Math.round(total / 1000))}KB${codeCount ? `, 판 코드 ${codeCount}개` : ''}).`);
const sent = await withKey(key => call('/api/world/packs', { method: 'POST', key, body: { id, files, ...(note ? { note } : {}) } }));
const d = sent.data, msg = typeof d.message === 'string' ? plain(d.message, 600) : '';
if (sent.status === 200 && d.number) {
  say(`\n보냈어요. 요청 ${Number(d.number)}번이에요${Number(d.revision) > 1 ? `(${Number(d.revision)}번째로 고쳐 보냄)` : ''}.\n운영자가 직접 해 본 뒤 승인하면 도름스 월드와 오락실에 선생님 이름으로 실려요. 결과는 도름스 쪽지로 와요.\n어떻게 됐는지 보려면: npm run submit -- --status`);
  process.exit(0);
}
if (sent.status === 422 && d.error === 'unit') stop(`${msg || '단원 이름을 도름스 오락실의 단원에서 찾지 못했어요.'}\n${Array.isArray(d.candidates) && d.candidates.length ? `이 가운데에서 골라 pack.json 의 units 에 그대로 적어 주세요:\n  ${d.candidates.slice(0, 40).map(c => plain(c, 80)).join('\n  ')}` : '쓸 수 있는 이름은 npm run units 로 볼 수 있어요.'}`);
if (sent.status === 409 && d.error === 'taken') stop(msg || `${id} 는 다른 선생님이 이미 쓰는 이름이에요. 팩 폴더 이름(과 pack.json 의 id)을 바꿔 다시 보내 주세요.`);
if (sent.status === 409 && d.error === 'busy') stop(msg || '이 팩은 이미 승인돼서 싣는 중이에요. 실린 뒤에 고친 판을 다시 보내 주세요.');
if (sent.status === 429) stop(msg || '오늘 보낼 수 있는 횟수를 다 썼어요. 내일 다시 보내 주세요.');
if (sent.status === 403) stop(msg || '보낼 수 있는 조건이 아직 안 됐어요. 도름스에서 교사 인증과 도름스 약속 동의를 확인해 주세요.');
if (sent.status === 423) stop(msg || '도름스가 잠깐 글 올리기를 멈춰 두었어요. 조금 뒤에 다시 보내 주세요.');
stop(`도름스가 받지 못했어요(${sent.status}). ${msg}${msg ? ' ' : ''}잠시 뒤 다시 보내 주세요. 계속 안 되면 도름스 운영자에게 알려 주세요.`);
