/**
 * 팩 검사(`npm run check:packs`, 빌드 때도 돈다). 모든 팩의 형식과 약속을 본다.
 * 막는 것: 형식 오류, 코드 파일, 바깥 주소, "정답/오답" 문구, 아무렇게나 누르는 봇이 깨 버리는 스테이지,
 * 가장 적은 인원·8명·30명 가운데 봇이 판을 그대로 굴려도 끝까지 못 깨는 스테이지(scripts/bots).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { resolveNeed, type StageJson } from '../platform/stage';
import { readJson, readSprites, readStage } from './pack-io';
import { createWorld, step, type Pad } from '../platform/sim';
import { peopleFor, playStage } from '../scripts/bots/engine';

const breathe = () => new Promise<void>(r => setTimeout(r, 20));
const root = fileURLToPath(new URL('../packs/', import.meta.url));
const FAMILIES = ['국어', '영어', '수학', '사회', '역사', '도덕·윤리', '과학', '정보', '기술·가정', '음악', '미술', '연극', '체육', '한문·외국어', '교양', '통합교과', '창의적 체험활동', '기타'];
const dirs = (p: string) => readdirSync(p).filter(n => statSync(join(p, n)).isDirectory());
const packs = dirs(root).flatMap(f => dirs(join(root, f)).map(n => ({ id: `${f}/${n}`, dir: join(root, f, n) })));
const walk = (p: string): string[] => readdirSync(p).flatMap(n => (statSync(join(p, n)).isDirectory() ? walk(join(p, n)) : [join(p, n)]));

describe('팩이 하나 이상 있다', () => { it('packs/', () => expect(packs.length).toBeGreaterThan(0)); });

describe.each(packs)('팩 $id', ({ id, dir }) => {
  const meta = readJson(join(dir, 'pack.json'));
  const files = walk(dir);

  it('팩 정보가 약속대로다', () => {
    expect(id).toMatch(/^[a-z0-9-]+\/[a-z0-9-]+$/);
    expect(meta.id, 'pack.json 의 id 는 폴더 이름과 같아야 해요').toBe(id);
    expect(meta.name.length, '이름은 40자까지').toBeLessThanOrEqual(40);
    expect(meta.name.length).toBeGreaterThan(0);
    expect(meta.tagline.length, '한 줄 설명은 30자까지').toBeLessThanOrEqual(30);
    expect(FAMILIES, `family 는 오락실 교과 묶음 이름이어야 해요: ${meta.family}`).toContain(meta.family);
    expect(String(meta.educationalIntent ?? '').length, '교육적 의도를 적어 주세요').toBeGreaterThan(0);
    expect(String(meta.creator?.nickname ?? '').length, '만든 사람 닉네임이 필요해요').toBeGreaterThan(0);
    expect(meta.players.min).toBeGreaterThanOrEqual(1);
    expect(meta.players.max).toBeLessThanOrEqual(30);
    expect(meta.players.min).toBeLessThanOrEqual(meta.players.max);
    expect(meta.stages.length).toBeGreaterThan(0);
    for (const s of meta.stages) { expect(s.difficulty).toBeGreaterThanOrEqual(1); expect(s.difficulty).toBeLessThanOrEqual(5); expect(String(s.name).length).toBeGreaterThan(0); }
    if (meta.creator.avatar) expect(existsSync(join(dir, meta.creator.avatar)), '프로필 그림 파일이 없어요').toBe(true);
    expect(existsSync(join(dir, 'DESIGN.md')), '설계서(DESIGN.md)가 필요해요').toBe(true);
    for (const k of ['name', 'tagline', 'description', 'educationalIntent']) { expect(typeof meta[k], `${k} 는 글자여야 해요`).toBe('string'); expect(meta[k], `${k} 에 판정 문구는 쓸 수 없어요`).not.toMatch(/정답|오답/); }
    for (const s of meta.stages) expect(String(s.name)).not.toMatch(/정답|오답/);
  });

  it('지도와 설정만 있다(코드 파일, 바깥 주소 없음)', () => {
    for (const f of files) {
      expect(f, '팩 폴더에는 코드 파일을 둘 수 없어요').not.toMatch(/\.(ts|tsx|js|mjs|cjs|html|wasm)$/);
      if (/\.(json|txt)$/.test(f)) expect(readFileSync(f, 'utf8'), `바깥 주소는 넣을 수 없어요: ${f}`).not.toMatch(/https?:\/\/|\/\/[a-z0-9.-]+\.[a-z]{2,}/i);
    }
  });

  it('글자 그림이 화풍 약속대로다(정해진 물감, 크기, 남색 윤곽)', () => { expect(() => readSprites(dir)).not.toThrow(); });

  describe.each(meta.stages as { file: string; name: string }[])('스테이지 $file', ({ file }) => {
    const def: StageJson = readJson(join(dir, 'stages', `${file}.json`));
    const load = () => readStage(dir, file).stage;

    it('지도를 읽을 수 있다', () => { expect(() => load()).not.toThrow(); });

    it('판정 문구가 없다("정답", "오답")', () => {
      const words = [def.hint ?? '', ...Object.values(def.legend ?? {}).flatMap(l => (l.type === 'sign' ? l.texts ?? [] : []))].join(' ');
      expect(words).not.toMatch(/정답|오답|맞았|틀렸/);
    });

    it('시작하면 모든 도름이가 움직일 수 있다(끼인 채 시작하지 않는다)', () => {
      for (const people of [2, 8, 30]) {
        const w = createWorld(load(), Array.from({ length: people }, () => ({ color: '#F4F7FF' })));
        for (let f = 0; f < 30; f++) step(w, [], 1 / 60);                       // 내려설 시간
        const x0 = w.players.map(p => p.x);
        const moved = w.players.map(() => false);
        for (const m of [1, -1] as const) for (let f = 0; f < 30; f++) { step(w, w.players.map(() => ({ m, j: false })), 1 / 60); w.players.forEach((p, i) => { if (Math.abs(p.x - x0[i]) > 1) moved[i] = true; }); }
        expect(moved.every(Boolean), `${people}명 가운데 시작부터 못 움직이는 도름이가 있어요`).toBe(true);
      }
    });

    it('열쇠와 문이 벽 안에 갇혀 있지 않다(시작 자리에서 빈 칸으로 이어진다)', () => {
      const st = load(), T = 30, at = (c: number, r: number) => r * st.cols + c;
      const open = (c: number, r: number) => c >= 0 && r >= 0 && c < st.cols && r < st.rows && !st.solid[at(c, r)];
      const seen = new Uint8Array(st.cols * st.rows), todo: [number, number][] = [];
      const start: [number, number] = [Math.floor(st.spawn.x / T), Math.max(0, Math.floor((st.spawn.y - 1) / T))];
      if (open(...start)) { seen[at(...start)] = 1; todo.push(start); }
      while (todo.length) { const [c, r] = todo.pop()!; for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) { const nc = c + dc, nr = r + dr; if (open(nc, nr) && !seen[at(nc, nr)]) { seen[at(nc, nr)] = 1; todo.push([nc, nr]); } } }
      const reach = (x: number, y: number) => { const c = Math.floor(x / T), r = Math.floor(y / T); return open(c, r) && !!seen[at(c, r)]; };
      if (st.key) expect(reach(st.key.x + 1, st.key.y + 1), '열쇠가 벽으로 막힌 곳에 있어요').toBe(true);
      if (st.door) expect(reach(st.door.x + st.door.w / 2, st.door.y + st.door.h / 2), '문이 벽으로 막힌 곳에 있어요').toBe(true);
    });

    it('30명일 때 단추에 설 자리가 모자라지 않는다', () => {
      const st = load();
      for (const b of st.buttons) {
        const need = resolveNeed(b.need, 30), room = Math.floor((b.w + 44) / 23);   // 걸쳐 선 사람까지 센 자리 수(재 본 값: 일곱 칸에 10명, 여섯 칸에 9명)
        expect(need <= room, `단추 '${b.ch}': 30명일 때 ${need}명이 서야 하는데 ${room}명까지만 설 수 있어요. 단추를 옆으로 더 넓혀 주세요`).toBe(true);
      }
    });

    // 깰 수 있게 만들어졌는지: 봇이 단추 지키기·상자 밀기·저울 풀기·친구 머리 딛기로 끝까지 가 본다.
    // 봇이 못 하는 길(친구 둘 이상 쌓기 등)만 남으면 통과도 실패도 아닌 '확인 못 함'(건너뜀)으로 남기고 까닭을 적는다.
    let shared: ReturnType<typeof load> | undefined;   // 인원마다 같은 지도를 써서 봇이 잰 길을 다시 쓴다
    it.for(peopleFor(meta.players))('%i명이 끝까지 깰 수 있다(봇이 판을 그대로 굴려 본다)', async (people, ctx) => {
      await breathe();   // 봇은 몇 초씩 쉬지 않고 돈다. 그사이 시험 도구와 주고받는 연락이 밀려 'Timeout calling onTaskUpdate' 로 검사 전체가 떨어지지 않게 틈을 준다
      const r = playStage(shared ??= load(), people);
      await breathe();
      if (r.verdict === 'unknown') { console.warn(`[확인 못 함] ${id} 스테이지 ${file} ${r.note}`); ctx.skip(); }
      expect(r.verdict, `스테이지 ${file} ${r.note}`).toBe('pass');
    }, 90_000);

    it('아무렇게나 누르는 봇은 깨지 못한다', () => {
      let seed = 11; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
      for (const people of [2, 8]) for (let trial = 0; trial < 3; trial++) {
        const w = createWorld(load(), Array.from({ length: people }, () => ({ color: '#F4F7FF' })));
        let pads: Pad[] = [];
        for (let f = 0; f < 45 * 60 && !w.won; f++) {
          if (f % 20 === 0) pads = w.players.map(() => ({ m: ([-1, 0, 1, 1] as const)[Math.floor(rnd() * 4)], j: rnd() < 0.4, a: rnd() < 0.5 }));
          step(w, pads, 1 / 60);
        }
        expect(w.won, `${people}명이 아무렇게나 눌러도 깨졌어요`).toBe(false);
      }
    });
  });
});
