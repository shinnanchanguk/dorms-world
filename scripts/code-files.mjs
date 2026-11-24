// 팩과 함께 보내는 판 코드의 약속. 보내기(submit-pack.mjs)와 싣기(publish-approved.mjs)가 같은 규칙을 쓴다.
// 도름스 쪽 짝: dorms 레포 src/lib/world/packRules.ts 의 WORLD_CODE_* (값을 바꾸면 둘을 함께 바꾼다).
//
// 보내는 모양: 팩 파일과 같은 files 안에 `code/<저장소 안 경로>` 열쇠로 넣는다.
//   code/.base     선생님이 내려받은 판의 커밋(40자). 싣는 쪽이 이 커밋에서 가지를 내어 요청(PR)을 연다.
//   code/.deleted  지운 파일의 저장소 안 경로(줄마다 하나).
// 판 지문(sha)은 팩 파일과 코드를 모두 덮으므로, 운영자가 살펴본 코드와 다른 코드는 실리지 않는다.

export const CODE_PREFIX = 'code/';
export const CODE_ROOTS = ['platform', 'src', 'tests', 'kit'];
// 경로 조각은 점이나 줄표로 시작할 수 없다(../ 와 숨김 파일이 못 들어온다). 여덟 겹까지.
export const CODE_PATH = /^(platform|src|tests|kit)(\/[A-Za-z0-9_][A-Za-z0-9._-]{0,79}){1,8}$/;
export const CODE_EXT = /\.(ts|tsx|js|mjs|css|md|json|txt)$/;
export const CODE_MAX_FILES = 80, CODE_MAX_FILE = 100_000, CODE_MAX_TOTAL = 600_000;
export const CODE_BASE = 'code/.base', CODE_DELETED = 'code/.deleted';

// 판을 지키는 검사기와 움직임 손잡이는 보내지 못한다(.github/workflows/pack-triage.yml 의 '실을 수 없는 파일' 목록과 같다). 자동 병합의 근거가 되는 검사를 보낸 사람이 약하게 만들지 못하게.
export const CODE_BLOCKED = /^(tests\/(packs|pack-files|behaviors-rules)\.test\.ts|tests\/pack-io\.ts|platform\/behavior\.ts)$/;
export const isCodePath = p => typeof p === 'string' && CODE_PATH.test(p) && CODE_EXT.test(p) && !p.includes('..') && !CODE_BLOCKED.test(p);

/** files 안의 코드 부분을 가려 검사한다. 문제가 있으면 까닭(글)을, 없으면 { code, deleted, base } 를 준다. */
export function readCode(files) {
  const code = {}, keys = Object.keys(files).filter(k => k.startsWith(CODE_PREFIX));
  if (!keys.length) return { code, deleted: [], base: '' };
  let total = 0, count = 0;
  for (const k of keys) {
    if (k === CODE_BASE || k === CODE_DELETED) continue;
    const path = k.slice(CODE_PREFIX.length), body = files[k];
    if (!isCodePath(path)) return `둘 수 없는 판 파일이에요: ${path.slice(0, 80)}`;
    if (typeof body !== 'string' || body.includes('\0')) return `글 파일이 아니에요: ${path}`;
    const size = Buffer.byteLength(body);
    if (size > CODE_MAX_FILE) return `판 파일이 너무 커요: ${path}`;
    total += size; count++;
    code[path] = body;
  }
  if (count > CODE_MAX_FILES) return `판 파일이 너무 많아요(${CODE_MAX_FILES}개까지)`;
  if (total > CODE_MAX_TOTAL) return '판 코드가 너무 커요';
  const base = String(files[CODE_BASE] ?? '').trim();
  if (!/^[0-9a-f]{40}$/.test(base)) return '판 코드가 어느 판에서 고친 것인지(code/.base) 알 수 없어요';
  const deleted = String(files[CODE_DELETED] ?? '').split('\n').map(s => s.trim()).filter(Boolean);
  if (deleted.length > CODE_MAX_FILES) return '지운 판 파일이 너무 많아요';
  for (const d of deleted) if (!isCodePath(d) || code[d] !== undefined) return `지울 수 없는 판 파일이에요: ${d.slice(0, 80)}`;
  if (!count && !deleted.length) return '판 코드가 비어 있어요';
  return { code, deleted, base };
}
