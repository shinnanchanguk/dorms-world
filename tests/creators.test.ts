/**
 * 만든 사람: 도름스가 주는 값(남이 주는 값)을 검사하는 함수, 같은 만든 사람의 팩 묶기, 화면에 넣는 글의 이스케이프.
 * 화면도 도름스 서버도 없이 본다.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LIMIT, cleanText, creatorKey, creatorOf, dormText, dormsUrl, onCreators, packsBy, parseCreator, parseCreators, refreshCreators, resetCreators, type Creator } from '../src/creators';
import { DEFAULT_AVATAR, creatorLine, faceOf, profileBody } from '../src/profile';
import type { Pack } from '../platform/packs';

const ID = '0b7f6c1e-2a4d-4e8b-9c3f-5d6a7b8c9d0e';
const good = {
  id: ID, nickname: '홍창욱', avatar: `https://dorms.school/api/world/avatar/${ID}`, profileUrl: `https://dorms.school/u/${ID}`,
  bio: '수학을 게임으로 가르쳐요', dorms: 1240, tags: ['중학교', '수학'],
};
const pack = (id: string, nickname: string, extra: Partial<Pack> = {}) => ({ id, name: `게임 ${id}`, family: '수학', creator: { nickname, avatar: null }, avatarUrl: null, ...extra }) as Pack;

describe('도름스 응답 검사(parseCreators)', () => {
  it('계약대로 온 값은 그대로 받는다', () => {
    const m = parseCreators({ creators: { 'math/graph-factory': good } });
    expect(m.get('math/graph-factory')).toEqual(good);
  });

  it('모양이 이상하면 빈 모음이다', () => {
    for (const raw of [null, undefined, 3, 'creators', [], {}, { creators: null }, { creators: [good] }, { creators: 'x' }, { list: { 'a/b': good } }]) {
      expect(parseCreators(raw).size).toBe(0);
    }
  });

  it('팩 번호가 약속과 다르면 그 줄만 뺀다', () => {
    const m = parseCreators({ creators: { 'math/ok': good, '../etc': good, 'MATH/Upper': good, 'a/b/c': good, __proto__x: good, '': good } });
    expect([...m.keys()]).toEqual(['math/ok']);
    const viaJson = parseCreators(JSON.parse(`{"creators":{"__proto__":${JSON.stringify(good)},"constructor":${JSON.stringify(good)},"math/ok":${JSON.stringify(good)}}}`));
    expect([...viaJson.keys()]).toEqual(['math/ok']);
  });

  it('회원 번호나 닉네임이 없으면 없는 사람으로 친다', () => {
    expect(parseCreator({ ...good, id: '' })).toBeNull();
    expect(parseCreator({ ...good, id: 12 })).toBeNull();
    expect(parseCreator({ ...good, id: 'a b' })).toBeNull();
    expect(parseCreator({ ...good, id: '<script>' })).toBeNull();
    expect(parseCreator({ ...good, nickname: '   ' })).toBeNull();
    expect(parseCreator({ ...good, nickname: { toString: () => '홍창욱' } })).toBeNull();
    expect(parseCreator([good])).toBeNull();
    expect(parseCreator('홍창욱')).toBeNull();
  });

  it('긴 글은 약속한 길이로 자른다(닉네임 30, 소개 120, 꼬리표 4개 · 각 12자)', () => {
    const c = parseCreator({ ...good, nickname: '가'.repeat(200), bio: '나'.repeat(5000), tags: Array.from({ length: 9 }, (_, i) => `${i}${'다'.repeat(40)}`) })!;
    expect([...c.nickname]).toHaveLength(LIMIT.nickname);
    expect([...c.bio]).toHaveLength(LIMIT.bio);
    expect(c.tags).toHaveLength(LIMIT.tags);
    for (const t of c.tags) expect([...t]).toHaveLength(LIMIT.tag);
    expect(c.tags.map(t => t[0])).toEqual(['0', '1', '2', '3']);
  });

  it('꼬리표에 글이 아닌 것이나 빈 글이 섞여 있으면 그것만 뺀다', () => {
    expect(parseCreator({ ...good, tags: ['중학교', 3, null, '', '  ', { a: 1 }, '수학'] })!.tags).toEqual(['중학교', '수학']);
    expect(parseCreator({ ...good, tags: '중학교' })!.tags).toEqual([]);
    expect(parseCreator({ ...good, tags: undefined })!.tags).toEqual([]);
  });

  it('도름은 0 이상 정수만 받는다(아니면 창에서 그 줄을 뺀다)', () => {
    expect(parseCreator({ ...good, dorms: 0 })!.dorms).toBe(0);
    expect(parseCreator({ ...good, dorms: 12 })!.dorms).toBe(12);
    for (const dorms of [-1, 1.5, '12', null, undefined, NaN, Infinity, 2 ** 60, {}]) expect(parseCreator({ ...good, dorms })!.dorms).toBeNull();
  });

  it('사진과 프로필 주소는 https://dorms.school/ 로 시작할 때만 받는다', () => {
    const bad = [
      'https://evil.example/a.png', 'http://dorms.school/a.png', 'https://dorms.school.evil.example/a.png', 'https://dorms.school@evil.example/a.png',
      'https://dorms.school', '//dorms.school/a.png', '/api/world/avatar/1', 'javascript:alert(1)', 'data:image/png;base64,AAAA',
      ' https://dorms.school/a.png', 'https://dorms.school/a b.png', 'https://dorms.school/"onerror="x', 'https://dorms.school/\\evil.example', 'https://dorms.school/<svg>',
      `https://dorms.school/${'a'.repeat(400)}`, 12, null, undefined, { href: 'https://dorms.school/a.png' },
    ];
    for (const v of bad) {
      expect(dormsUrl(v), String(v)).toBeNull();
      const c = parseCreator({ ...good, avatar: v, profileUrl: v })!;
      expect(c.avatar).toBeNull();
      expect(c.profileUrl).toBeNull();
      expect(c.nickname).toBe('홍창욱');   // 주소만 버리고 사람은 남긴다
    }
    expect(dormsUrl(`https://dorms.school/api/world/avatar/${ID}`)).toBe(`https://dorms.school/api/world/avatar/${ID}`);
    expect(dormsUrl(`https://dorms.school/u/${ID}?from=world`)).toBe(`https://dorms.school/u/${ID}?from=world`);
  });

  it('숨은 문자와 줄바꿈은 빈칸 하나로 바꾼다', () => {
    expect(cleanText('홍‮창\u0000욱\n\n선생님​', 30)).toBe('홍 창 욱 선생님');
    expect(cleanText('  앞뒤  빈칸  ', 30)).toBe('앞뒤 빈칸');
    expect(cleanText(12, 30)).toBe('');
    expect([...cleanText('😀'.repeat(50), 30)]).toHaveLength(30);   // 글자 수로 자른다(그림 글자가 반으로 갈리지 않게)
  });

  it('500명을 넘는 응답은 앞의 500명까지만 본다', () => {
    const creators = Object.fromEntries(Array.from({ length: 700 }, (_, i) => [`math/p${i}`, { ...good, id: `m${i}` }]));
    expect(parseCreators({ creators }).size).toBe(LIMIT.creators);
  });
});

describe('받은 도름 적기', () => {
  it('붙여 쓴다', () => {
    expect(dormText(0)).toBe('0도름');
    expect(dormText(12)).toBe('12도름');
    expect(dormText(1240)).toBe('1,240도름');
    expect(dormText(1234567)).toBe('1,234,567도름');
  });
});

describe('같은 만든 사람의 팩 묶기(packsBy)', () => {
  const A: Creator = { ...good, id: 'member-a', nickname: '가람' }, B: Creator = { ...good, id: 'member-b', nickname: '나래' };
  const packs = [pack('math/one', '가람'), pack('math/two', '옛 이름'), pack('sci/three', '나래'), pack('etc/four', '가람'), pack('etc/five', '도름스')];
  const known = new Map<string, Creator>([['math/one', A], ['math/two', A], ['sci/three', B]]);
  const of = (id: string) => known.get(id) ?? null;
  const none = () => null;

  it('도름스가 알려 준 팩은 회원 번호가 같은 것끼리 묶인다(pack.json 의 닉네임이 달라도)', () => {
    expect(packsBy(packs, packs[0], of).map(p => p.id)).toEqual(['math/one', 'math/two']);
    expect(packsBy(packs, packs[2], of).map(p => p.id)).toEqual(['sci/three']);
  });

  it('닉네임이 같다는 것만으로 도름스 회원의 게임에 끼지 않는다', () => {
    expect(packsBy(packs, packs[3], of).map(p => p.id)).toEqual(['etc/four']);          // 도름스가 모르는 '가람'
    expect(packsBy(packs, packs[0], of).map(p => p.id)).not.toContain('etc/four');
  });

  it('도름스가 답하지 않으면 pack.json 의 닉네임이 같은 것끼리 묶인다', () => {
    expect(packsBy(packs, packs[0], none).map(p => p.id)).toEqual(['math/one', 'etc/four']);
    expect(packsBy(packs, packs[4], none).map(p => p.id)).toEqual(['etc/five']);
  });

  it('살펴보는 중인 요청의 팩은 도름스 값 없이 본다(실린 팩 번호와 같아도 그 회원의 것으로 치지 않는다)', () => {
    const request = pack('math/one', '가람');
    expect(packsBy(packs, request, of, null).map(p => p.id)).toEqual(['etc/four']);
    expect(packsBy(packs, pack('new/pack', '처음 온 선생님'), of, null)).toEqual([]);
  });

  it('열쇠는 회원 번호와 닉네임을 섞지 않는다', () => {
    expect(creatorKey(pack('a/b', 'id:member-a'), null)).not.toBe(creatorKey(pack('a/c', '가람'), A));
  });
});

describe('화면에 넣는 글', () => {
  const evil: Creator = {
    id: 'member-x', nickname: '<img src=x onerror=alert(1)>', avatar: null, profileUrl: `https://dorms.school/u/${ID}`,
    bio: '"><script>alert(2)</script>', dorms: 1240, tags: ['<b>굵게</b>', '수학'],
  };
  const p = pack('math/one', '<svg onload=alert(3)>', { name: '<i>기울임</i> 게임', family: '수학' });

  it('스크립트 글이 든 닉네임은 검사를 지나도 글자로만 남는다', () => {
    const c = parseCreator({ ...good, nickname: evil.nickname, bio: evil.bio, tags: evil.tags })!;
    expect(c.nickname).toBe('<img src=x onerror=alert(1)>');
    const html = profileBody(p, c, [p]);
    expect(html).toContain('@&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&lt;script&gt;alert(2)&lt;/script&gt;');
    expect(html).toContain('&lt;b&gt;굵게&lt;/b&gt;');
    expect(html).toContain('&lt;i&gt;기울임&lt;/i&gt; 게임');
    expect(html).not.toMatch(/<img src=x|<script|<b>|<i>|<svg onload/);
    // 창에 실제로 생기는 꼬리표는 우리가 쓴 것뿐이고(사진 하나), 어느 것에도 on… 속성이 없다
    expect([...new Set([...html.matchAll(/<([a-z0-9]+)/g)].map(m => m[1]))].sort()).toEqual(['a', 'button', 'div', 'h2', 'img', 'li', 'p', 'path', 'span', 'svg', 'ul']);
    expect(html.match(/<img /g)).toHaveLength(1);
    expect(html).not.toMatch(/<[^>]*\son\w+=/);
  });

  it('검토 화면의 만든 사람 줄: 도름스가 실어 준 보낸 선생님의 닉네임과 사진을 쓰고, 없으면 pack.json 값', () => {
    const c = parseCreator(good)!;
    const line = creatorLine(pack('korean/josa', '옛 이름'), true, c);
    expect(line).toContain('@홍창욱');
    expect(line).toContain(`src="https://dorms.school/api/world/avatar/${ID}"`);
    expect(line).toContain('data-review');
    const plain = creatorLine(pack('korean/josa', '옛 이름'), true, null);
    expect(plain).toContain('@옛 이름');
    expect(plain).toContain(DEFAULT_AVATAR);
  });

  it('만든 사람 줄: pack.json 의 닉네임도 이스케이프하고, 속성 값을 깨고 나오지 못한다', () => {
    const line = creatorLine(pack('math/one', '"><img src=x onerror=alert(1)>'));
    expect(line).not.toMatch(/<img src=x/);
    expect(line).toContain('@&quot;&gt;&lt;img src=x onerror=alert(1)&gt;');
    expect(line.match(/<img /g)).toHaveLength(1);                     // 사진 하나뿐
    expect(line.startsWith('<button type="button" class="ar-creator w-creator" data-creator="math/one"')).toBe(true);
  });

  it('도름스 값이 없으면 닉네임과 기본 그림, 만든 게임만 보인다', () => {
    const html = profileBody(pack('math/one', '도름스'), null, [pack('math/one', '도름스')], 'math/one');
    expect(faceOf(pack('math/one', '도름스'), null)).toEqual({ nickname: '도름스', photo: DEFAULT_AVATAR, pixel: true });
    expect(html).toContain('@도름스');
    expect(html).toContain('이 선생님이 만든 게임');
    expect(html).toContain('aria-current="page"');
    expect(html).not.toContain('도름스 프로필 보기');
    expect(html).not.toContain('w-prof-bio');
    expect(html).not.toContain('받은 도름');
    expect(html).not.toContain('w-prof-tags');
  });

  it('도름스 값이 있으면 사진, 소개, 꼬리표, 받은 도름, 새 창으로 여는 프로필 단추가 있다', () => {
    const c = parseCreator(good)!;
    const html = profileBody(pack('math/one', '옛 이름'), c, []);
    expect(html).toContain(`src="https://dorms.school/api/world/avatar/${ID}"`);
    expect(html).toContain('@홍창욱');
    expect(html).toContain('수학을 게임으로 가르쳐요');
    expect(html).toContain('1,240도름');
    expect(html).toContain(`href="https://dorms.school/u/${ID}" target="_blank" rel="noopener noreferrer"`);
    expect(html).toContain('아직 월드에 실린 게임이 없어요.');
    expect(html).not.toMatch(/\d+\s*위|순위/);
  });

  it('소개가 비었으면 그 줄을 뺀다', () => {
    expect(profileBody(pack('math/one', '가람'), parseCreator({ ...good, bio: '' })!, [])).not.toContain('w-prof-bio');
  });
});

describe('받아 두기(5분)', () => {
  afterEach(() => { resetCreators(); vi.unstubAllGlobals(); });
  const reply = (body: unknown, ok = true) => vi.fn(async () => ({ ok, status: ok ? 200 : 404, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) }));

  it('한 번 받아 두고 5분 안에는 다시 묻지 않는다. 5분이 지나면 다시 받는다', async () => {
    const f = reply({ creators: { 'math/one': good } });
    vi.stubGlobal('fetch', f);
    let told = 0; onCreators(() => told++);
    await refreshCreators(1_000_000);
    expect(creatorOf('math/one')?.nickname).toBe('홍창욱');
    await refreshCreators(1_000_000 + 4 * 60_000);
    expect(f).toHaveBeenCalledTimes(1);
    await refreshCreators(1_000_000 + 5 * 60_000 + 1);
    expect(f).toHaveBeenCalledTimes(2);
    expect(told).toBe(2);
    expect(f.mock.calls[0][0]).toBe('https://dorms.school/api/world/creators');
    expect(f.mock.calls[0][1]).toMatchObject({ credentials: 'omit' });
  });

  it('404, 깨진 JSON, 끊긴 연결에도 던지지 않고 지난 값을 그대로 둔다', async () => {
    vi.stubGlobal('fetch', reply({ creators: { 'math/one': good } }));
    await refreshCreators(0);
    for (const [i, f] of [reply('없어요', false), reply('{"creators":'), vi.fn(async () => { throw new TypeError('Failed to fetch'); })].entries()) {
      vi.stubGlobal('fetch', f);
      await expect(refreshCreators((i + 1) * 6 * 60_000)).resolves.toBeUndefined();
      expect(f).toHaveBeenCalledTimes(1);
      expect(creatorOf('math/one')?.nickname).toBe('홍창욱');
    }
  });

  it('처음부터 받지 못하면 아는 사람이 없다(화면은 pack.json 값으로 그린다)', async () => {
    vi.stubGlobal('fetch', reply('', false));
    await refreshCreators(0);
    expect(creatorOf('math/one')).toBeNull();
  });

  it('너무 큰 응답은 읽지 않는다', async () => {
    const big = JSON.stringify({ creators: { 'math/one': { ...good, bio: '가'.repeat(LIMIT.bytes) } } });
    vi.stubGlobal('fetch', reply(big));
    await refreshCreators(0);
    expect(creatorOf('math/one')).toBeNull();
    resetCreators();
    const text = vi.fn(async () => JSON.stringify({ creators: { 'math/one': good } }));
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, headers: new Headers({ 'content-length': String(LIMIT.bytes + 1) }), text })));
    await refreshCreators(0);
    expect(text).not.toHaveBeenCalled();   // 길이를 먼저 보고 본문은 받지 않는다
    expect(creatorOf('math/one')).toBeNull();
  });

  it('동시에 여러 번 불러도 한 번만 묻는다', async () => {
    const f = reply({ creators: {} });
    vi.stubGlobal('fetch', f);
    await Promise.all([refreshCreators(0), refreshCreators(0), refreshCreators(1)]);
    expect(f).toHaveBeenCalledTimes(1);
  });
});
