import { describe, expect, it } from 'vitest';
// @ts-expect-error 발행 스크립트는 타입이 없는 .mjs 다
import { problemOf, shaOf } from '../scripts/publish-approved.mjs';

const files = { 'pack.json': JSON.stringify({ id: 'etc/sample' }), 'DESIGN.md': '# 설계', 'stages/01.map.txt': '@..D', 'stages/01.json': '{}' };
const item = (over: Record<string, unknown> = {}) => ({ id: '0f8fad5b-d9cb-469f-a165-70867728950e', packId: 'etc/sample', revision: 1, mode: 'create', files, sha: shaOf(files), ...over });

describe('승인된 팩 싣기: 받은 항목 검사', () => {
  it('제대로 된 항목은 통과한다', () => { expect(problemOf(item())).toBe(''); });
  it('지문은 파일 차례와 상관없이 같고, 내용이 바뀌면 달라진다', () => {
    const turned = Object.fromEntries(Object.entries(files).reverse());
    expect(shaOf(turned)).toBe(shaOf(files));
    expect(shaOf({ ...files, 'DESIGN.md': '# 설계 ' })).not.toBe(shaOf(files));
    expect(shaOf({ ab: 'c' })).not.toBe(shaOf({ a: 'bc' }));
  });
  it('팩 폴더 밖이나 코드, 엉뚱한 자리의 파일은 싣지 않는다', () => {
    for (const bad of ['../x.txt', 'stages/../../.github/workflows/a.yml', 'run.js', 'stages/1.json', 'sprites/A.txt', 'sprites/a/b.txt', '/etc/passwd', 'pack.json/../x', 'stages/01.map.txt ']) {
      const f = { ...files, [bad]: 'x' };
      expect(problemOf(item({ files: f, sha: shaOf(f) })), bad).toContain('둘 수 없는 파일');
    }
  });
  it('살펴본 판과 다른 파일은 싣지 않는다', () => { expect(problemOf(item({ sha: 'a'.repeat(64) }))).toContain('살펴본 판'); });
  it('팩 이름과 pack.json 의 id 가 다르면 싣지 않는다', () => { expect(problemOf(item({ packId: 'etc/other' }))).toContain('id'); });
  it('모양이 다른 값은 싣지 않는다', () => {
    expect(problemOf(null)).not.toBe('');
    expect(problemOf(item({ id: 'x' }))).not.toBe('');
    expect(problemOf(item({ packId: '../a/b' }))).not.toBe('');
    expect(problemOf(item({ mode: 'replace' }))).not.toBe('');
    expect(problemOf(item({ revision: 0 }))).not.toBe('');
    const big = { ...files, 'DESIGN.md': 'x'.repeat(100_001) };
    expect(problemOf(item({ files: big, sha: shaOf(big) }))).toContain('너무 커요');
    const nul = { ...files, 'DESIGN.md': 'a\0b' };
    expect(problemOf(item({ files: nul, sha: shaOf(nul) }))).toContain('글 파일이 아니에요');
    const noDesign = { 'pack.json': files['pack.json'] };
    expect(problemOf(item({ files: noDesign, sha: shaOf(noDesign) }))).toContain('DESIGN.md');
  });
});

describe('승인된 팩 싣기: 함께 온 판 코드', () => {
  const base = 'a'.repeat(40);
  const withCode = (extra: Record<string, string>) => { const f = { ...files, 'code/.base': base, ...extra }; return item({ files: f, sha: shaOf(f) }); };
  it('약속한 자리의 판 코드는 싣는다', () => {
    expect(problemOf(withCode({ 'code/platform/behaviors/order.ts': 'export default {}', 'code/src/main.ts': '//', 'code/kit/STAGE_FORMAT.md': '#' }))).toBe('');
    expect(problemOf(withCode({ 'code/.deleted': 'platform/old.ts', 'code/platform/new.ts': '//' }))).toBe('');
  });
  it('약속 밖의 자리, 숨김 파일, 실행될 수 있는 그림은 싣지 않는다', () => {
    for (const bad of ['code/.github/workflows/a.yml', 'code/scripts/publish-approved.mjs', 'code/package.json', 'code/platform/../scripts/x.mjs', 'code/platform/.env', 'code/public/x.svg', 'code/public/a.html', 'code/platform/-x.ts', 'code/vite.config.ts', 'code/room-server/src/index.ts', 'code/platform']) {
      expect(problemOf(withCode({ [bad]: 'x' })), bad).toContain('둘 수 없는 판 파일');
    }
  });
  it('어느 판에서 고쳤는지 모르면 싣지 않는다', () => {
    const f = { ...files, 'code/platform/a.ts': '//' };
    expect(problemOf(item({ files: f, sha: shaOf(f) }))).toContain('code/.base');
    expect(problemOf(withCode({ 'code/.base': 'main', 'code/platform/a.ts': '//' }))).toContain('code/.base');
  });
  it('지울 파일도 약속한 자리만', () => {
    expect(problemOf(withCode({ 'code/.deleted': '.github/workflows/pack-check.yml' }))).toContain('지울 수 없는');
    expect(problemOf(withCode({ 'code/.deleted': 'platform/a.ts', 'code/platform/a.ts': '//' }))).toContain('지울 수 없는');
  });
  it('코드만 고치고 내용이 없는 판은 싣지 않는다', () => { expect(problemOf(withCode({}))).toContain('비어'); });
});
