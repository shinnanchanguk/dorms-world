/**
 * 요청(PR) 검토 화면에 쓸 팩 읽기. 요청에 든 팩 파일을 GitHub 에서 글로 읽어 운영 판으로 돌린다.
 * 팩은 자료뿐이라(코드 없음) 읽어서 돌려도 안전하다. 요청에 판을 고친 파일이 들어 있어도 그 코드는 여기서 돌지 않는다.
 * 읽은 글은 모두 남이 쓴 것이다: 이름과 크기를 검사하고, 화면에는 글자로만 넣는다.
 */
import { buildPack, type Pack, type PackJson } from '../platform/packs';
import { parseCreator, type Creator } from './creators';

export const REPO = 'shinnanchanguk/dorms-world';
const API = 'https://api.github.com/repos/';
const RAW = 'https://raw.githubusercontent.com/';
const MAX_FILE = 300 * 1024, MAX_FILES = 120;
const ALLOWED = /^(pack\.json|DESIGN\.md|things\.json|stages\/\d{2}\.(json|map\.txt)|sprites\/[a-z0-9-]+\.txt|[a-z0-9-]+\.(png|webp))$/;

export type Review = {
  number: number; title: string; author: string; url: string; state: 'open' | 'merged' | 'closed';
  sha: string;               // 살펴본 판(요청의 그 시점). 승인 직전에 요청이 그새 바뀌지 않았는지 이 값으로 다시 본다
  pack: Pack; design: string;
  others: string[];          // 팩 폴더 밖에서 바뀐 파일(있으면 판 변경이 들어 있다)
  extraPacks: string[];      // 함께 바뀐 다른 팩
  source: 'github' | 'dorms'; // 어디로 들어온 요청인가. 도름스로 온 것은 팩 자료만 들어 있고 승인도 도름스에서 한다
  status?: string;           // 도름스 요청의 지금 상태(submitted, approved, publishing, published, rejected, failed)
  note?: string;             // 보낸 선생님이 운영자에게 남긴 한마디
  decisionNote?: string;     // 운영자가 돌려보내며 남긴 한마디
  update?: boolean;          // 이미 실려 있는 팩을 고친 판인가(승인하면 실린 팩이 통째로 바뀐다)
  creator?: Creator | null;  // 보낸 선생님의 공개 프로필(도름스 검토 응답). 만든 사람 줄과 프로필 창이 쓴다
  auto?: boolean;            // 만든 선생님이 고친 판이라 운영자 승인 없이 바로 올라가는 판
};

async function json(url: string): Promise<unknown> {
  const r = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
  if (r.status === 404) throw new Error('그런 요청이 없어요.');
  if (r.status === 403 || r.status === 429) {
    // 로그인 없이 읽는 한도(한 시간에 60번, 같은 인터넷을 쓰는 사람과 함께 센다)를 넘었다. 언제 풀리는지 알려 준다
    const reset = Number(r.headers.get('x-ratelimit-reset')), at = reset > 0 ? new Date(reset * 1000) : null;
    const when = at ? `${at.getHours()}시 ${String(at.getMinutes()).padStart(2, '0')}분쯤` : '조금 뒤에';
    throw new Error(`GitHub 가 잠깐 막았어요(같은 인터넷에서 짧은 시간에 너무 많이 열었어요). ${when} 다시 열어 주세요.`);
  }
  if (!r.ok) throw new Error(`요청을 읽지 못했어요(${r.status}).`);
  return r.json();
}
async function text(url: string): Promise<string> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`파일을 읽지 못했어요(${r.status}).`);
  const len = Number(r.headers.get('content-length') ?? 0);
  if (len > MAX_FILE) throw new Error('파일이 너무 커요(300KB까지).');
  const body = await r.text();
  if (body.length > MAX_FILE) throw new Error('파일이 너무 커요(300KB까지).');
  return body;
}
const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');

export async function loadReview(number: number): Promise<Review> {
  if (!Number.isInteger(number) || number < 1 || number > 99999) throw new Error('요청 번호를 확인해 주세요.');
  const pr = await json(`${API}${REPO}/pulls/${number}`) as { changed_files?: unknown; title?: unknown; html_url?: unknown; state?: unknown; merged?: unknown; user?: { login?: unknown }; head?: { sha?: unknown; repo?: { full_name?: unknown } | null } };
  const sha = str(pr.head?.sha, 40), source = str(pr.head?.repo?.full_name, 140);
  if (!/^[0-9a-f]{40}$/.test(sha) || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(source)) throw new Error('요청의 원본 저장소를 찾지 못했어요(지워졌을 수 있어요).');
  const files = await json(`${API}${REPO}/pulls/${number}/files?per_page=100`) as { filename?: unknown; previous_filename?: unknown; status?: unknown }[];
  const list = Array.isArray(files) ? files : [];
  // 지우거나 이름을 바꾼 파일도 '바뀐 파일'로 센다(판 파일을 지우는 요청이 팩만 바꾼 것처럼 보이지 않게)
  const touched = list.flatMap(f => [str(f.filename, 300), str(f.previous_filename, 300)]).filter(Boolean);
  const names = list.filter(f => f.status !== 'removed').map(f => str(f.filename, 300));
  // 바뀐 파일을 다 읽지 못했으면(100개 넘음) '팩만'이라고 말하지 않는다
  const total = Number(pr.changed_files);
  const unread = !Number.isInteger(total) || total !== list.length;
  const ids = [...new Set(names.map(n => /^packs\/([a-z0-9-]+\/[a-z0-9-]+)\//.exec(n)?.[1]).filter((v): v is string => !!v))];
  if (!ids.length) throw new Error('이 요청에는 팩이 없어요. 판만 고친 요청은 세션에서 내려받아 확인해 주세요.');
  // 보여 줄 팩: 연습 팩(etc/tutorial)은 새 장치를 더한 요청에 딸려 오는 것이라 뒤로 돌린다
  const id = ids.find(v => v !== 'etc/tutorial') ?? ids[0], dir = `packs/${id}/`;
  // 그 팩의 모든 파일(바뀌지 않은 파일 포함)을 요청의 그 시점에서 읽는다
  const tree = await json(`${API}${source}/git/trees/${sha}?recursive=1`) as { tree?: { path?: unknown; type?: unknown; size?: unknown }[] };
  const inPack = (tree.tree ?? []).filter(t => t.type === 'blob' && str(t.path, 300).startsWith(dir)).map(t => ({ rel: str(t.path, 300).slice(dir.length), size: Number(t.size) || 0 }));
  if (inPack.length > MAX_FILES) throw new Error('팩에 파일이 너무 많아요.');
  // 바뀐 파일 가운데 '팩 폴더 안의 허락된 파일'이 아닌 것은 모두 판 변경으로 센다(packs/ 아래라도 코드나 엉뚱한 자리의 파일은 팩이 아니다)
  const isPackFile = (n: string) => { const m = /^packs\/[a-z0-9-]+\/[a-z0-9-]+\/(.+)$/.exec(n); return !!m && ALLOWED.test(m[1]); };
  const stray = inPack.filter(f => !ALLOWED.test(f.rel)).map(f => f.rel);
  if (stray.length) throw new Error(`팩에 둘 수 없는 파일이 있어요: ${stray.slice(0, 3).join(', ')}`);
  const raw = (rel: string) => `${RAW}${source}/${sha}/${dir}${rel}`;
  const store = new Map<string, string>();
  await Promise.all(inPack.filter(f => /\.(json|txt|md)$/.test(f.rel)).map(async f => { if (f.size > MAX_FILE) throw new Error(`${f.rel}: 파일이 너무 커요.`); store.set(f.rel, await text(raw(f.rel))); }));
  let meta: PackJson;
  try { meta = JSON.parse(store.get('pack.json') ?? ''); } catch { throw new Error('pack.json 을 읽을 수 없어요.'); }
  const avatar = typeof meta?.creator?.avatar === 'string' && /^[a-z0-9-]+\.(png|webp)$/.test(meta.creator.avatar) && inPack.some(f => f.rel === meta.creator.avatar && f.size > 0 && f.size <= MAX_FILE) ? raw(meta.creator.avatar) : null;
  const sprites = inPack.map(f => /^sprites\/([a-z0-9-]+)\.txt$/.exec(f.rel)?.[1]).filter((v): v is string => !!v);
  if (sprites.length > 40) throw new Error('그림은 40개까지예요.');
  const pack = buildPack(meta, rel => store.get(rel), avatar, sprites);
  return {
    number, title: str(pr.title, 120), author: str(pr.user?.login, 40), url: `https://github.com/${REPO}/pull/${number}`,
    state: pr.merged === true ? 'merged' : pr.state === 'open' ? 'open' : 'closed', sha,
    pack: { ...pack, id }, design: (store.get('DESIGN.md') ?? '').slice(0, 20000),
    others: [...(unread ? ['(바뀐 파일이 많아 다 읽지 못했어요. 세션에서 내려받아 확인해 주세요)'] : []), ...new Set(touched.filter(n => !isPackFile(n) || !n.startsWith(dir)))].slice(0, 40),   // 이 팩의 허락된 파일이 아니면 모두 센다(다른 팩을 고치거나 지우는 것 포함)
    extraPacks: [...new Set(touched.map(n => /^packs\/([a-z0-9-]+\/[a-z0-9-]+)\//.exec(n)?.[1]).filter((v): v is string => !!v && v !== id))],
    source: 'github',
  };
}

const DORMS = 'https://dorms.school';
const TEXT_OK = /^(pack\.json|DESIGN\.md|things\.json|stages\/\d{2}\.(json|map\.txt)|sprites\/[a-z0-9-]{1,40}\.txt)$/;
/** 도름스로 들어온 요청을 읽는다. 주소의 긴 번호가 곧 열람 열쇠다. 받은 글은 모두 보낸 사람이 쓴 것이라 자료로만 다룬다. */
export async function loadDormsReview(id: string): Promise<Review> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) throw new Error('요청 주소를 확인해 주세요.');
  let r: Response;
  try { r = await fetch(`${DORMS}/api/world/requests/${id}`, { cache: 'no-store' }); } catch { throw new Error('도름스에서 요청을 읽지 못했어요. 인터넷을 확인하고 다시 열어 주세요.'); }
  if (r.status === 404) throw new Error('그런 요청이 없어요.');
  if (!r.ok) throw new Error(`요청을 읽지 못했어요(${r.status}).`);
  let got: unknown;
  try { got = await r.json(); } catch { throw new Error('요청 내용을 읽지 못했어요. 잠시 뒤 다시 열어 주세요.'); }
  if (!got || typeof got !== 'object') throw new Error('요청 내용을 읽지 못했어요. 잠시 뒤 다시 열어 주세요.');
  const d = got as { mode?: unknown; number?: unknown; packId?: unknown; sha?: unknown; status?: unknown; title?: unknown; note?: unknown; decisionNote?: unknown; author?: { nickname?: unknown }; creator?: unknown; auto?: unknown; files?: unknown };
  const packId = str(d.packId, 90);
  if (!/^[a-z0-9-]{1,40}\/[a-z0-9-]{1,40}$/.test(packId)) throw new Error('요청의 팩 이름을 읽지 못했어요.');
  const files = d.files && typeof d.files === 'object' && !Array.isArray(d.files) ? d.files as Record<string, unknown> : {};
  // 판 코드(code/…)는 이 화면에서 돌리지 않는다. 무엇이 왔는지 이름만 보여 준다
  const code = Object.keys(files).filter(n => n.startsWith('code/') && n !== 'code/.base' && n !== 'code/.deleted').map(n => n.slice(5).slice(0, 120)).sort();
  const gone = typeof files['code/.deleted'] === 'string' ? (files['code/.deleted'] as string).split('\n').map(v => v.trim()).filter(Boolean).slice(0, 80).map(v => `${v.slice(0, 120)}(지움)`) : [];
  const names = Object.keys(files).filter(n => !n.startsWith('code/'));
  if (!names.length || names.length > MAX_FILES) throw new Error('팩 파일 수가 맞지 않아요.');
  const store = new Map<string, string>();
  for (const n of names) {
    const body = files[n];
    if (!TEXT_OK.test(n) || typeof body !== 'string') throw new Error(`팩에 둘 수 없는 파일이 있어요: ${n.slice(0, 60)}`);
    if (body.length > MAX_FILE) throw new Error(`${n}: 파일이 너무 커요.`);
    store.set(n, body);
  }
  let meta: PackJson;
  try { meta = JSON.parse(store.get('pack.json') ?? ''); } catch { throw new Error('pack.json 을 읽을 수 없어요.'); }
  const sprites = names.map(n => /^sprites\/([a-z0-9-]+)\.txt$/.exec(n)?.[1]).filter((v): v is string => !!v);
  if (sprites.length > 40) throw new Error('그림은 40개까지예요.');
  let pack: ReturnType<typeof buildPack>;
  try { pack = buildPack(meta, rel => store.get(rel), null, sprites); }
  catch (err) {
    if (!code.length && !gone.length) throw err;
    throw new Error(`이 팩은 함께 온 판 코드(${[...code, ...gone].slice(0, 6).join(', ')}${code.length + gone.length > 6 ? ' 등' : ''})가 있어야 돌아서, 실린 판에서는 아직 열 수 없어요. 작업 창에서 "요청 확인해"로 살펴봐 주세요. (${(err as Error).message})`);
  }
  const status = str(d.status, 20);
  return {
    number: Number(d.number) || 0, title: str(d.title, 120), author: str(d.author?.nickname, 40), url: '',
    state: status === 'published' ? 'merged' : status === 'rejected' ? 'closed' : 'open', sha: str(d.sha, 64),
    pack: { ...pack, id: packId }, design: (store.get('DESIGN.md') ?? '').slice(0, 20000),
    others: [...code, ...gone], extraPacks: [], source: 'dorms', status, note: str(d.note, 500), decisionNote: str(d.decisionNote, 500), update: d.mode === 'update', creator: parseCreator(d.creator), auto: d.auto === true,
  };
}

/** 요청의 지금 머리. 승인하러 가기 직전에 살펴본 판과 같은지 본다(살펴본 뒤에 다른 것을 밀어 넣지 못하게). */
export async function headOf(number: number): Promise<string> {
  const pr = await json(`${API}${REPO}/pulls/${number}`) as { head?: { sha?: unknown } };
  return str(pr.head?.sha, 40);
}
