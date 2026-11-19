/**
 * 팩 모음. packs/<교과>/<팩>/ 아래 파일을 빌드 때 모두 읽어 들인다.
 * 이 파일은 일부러 packs/ 밖에 둔다: packs/ 안에는 남이 보낸 자료만 있고 코드는 하나도 없어야 한다.
 */
import { parseStage, type Stage, type StageJson } from './stage';
import { parseSprite, type Sprite } from './sprite';

export type PackJson = {
  id: string; name: string; tagline: string; family: string; schoolLevels: string[];
  units: { band: string; subject: string; unit: string }[];
  educationalIntent: string; description: string;
  creator: { nickname: string; avatar: string | null };
  players: { min: number; max: number };
  stages: { file: string; name: string; difficulty: number }[];
};

export type Pack = PackJson & { avatarUrl: string | null; stageData: Stage[] };

const metas = import.meta.glob<PackJson>('../packs/*/*/pack.json', { eager: true, import: 'default' });
const maps = import.meta.glob<string>('../packs/*/*/stages/*.map.txt', { eager: true, query: '?raw', import: 'default' });
const defs = import.meta.glob<StageJson>('../packs/*/*/stages/*.json', { eager: true, import: 'default' });
const arts = import.meta.glob<string>('../packs/*/*/sprites/*.txt', { eager: true, query: '?raw', import: 'default' });
const pics = import.meta.glob<string>('../packs/*/*/*.{png,webp}', { eager: true, query: '?url', import: 'default' });

/** 도름스 오락실 "교과별" 보기와 같은 이름, 같은 순서. */
export const FAMILIES = ['국어', '영어', '수학', '사회', '역사', '도덕·윤리', '과학', '정보', '기술·가정', '음악', '미술', '연극', '체육', '한문·외국어', '교양', '통합교과', '창의적 체험활동', '기타'] as const;

/** 읽어 온 파일들로 팩 하나를 만든다(수와 글자는 약속 범위로 다듬는다). 잘못된 곳이 있으면 쉬운 말로 던진다. */
export function buildPack(meta: PackJson, file: (path: string) => string | undefined, avatarUrl: string | null, spriteNames: string[] = []): Pack {
  if (!meta || typeof meta !== 'object' || !Array.isArray(meta.stages) || !meta.stages.length || meta.stages.length > 30) throw new Error('pack.json 의 stages 를 읽을 수 없어요(1~30개).');
  const sprites: Record<string, Sprite> = {};
  for (const name of spriteNames.slice(0, 40)) sprites[name] = parseSprite(file(`sprites/${name}.txt`) ?? '', name);
  const stageData = meta.stages.map(s => {
    if (!/^\d{2}$/.test(String(s.file))) throw new Error('스테이지 파일 이름은 "01" 같은 두 자리 숫자여야 해요.');
    let def: StageJson = {};
    try { def = JSON.parse(file(`stages/${s.file}.json`) ?? '{}'); } catch { throw new Error(`stages/${s.file}.json 을 읽을 수 없어요(JSON 형식 확인).`); }
    return parseStage(file(`stages/${s.file}.map.txt`) ?? '', def, sprites);
  });
  const players = { min: Math.max(2, Math.floor(Number(meta.players?.min)) || 2), max: Math.min(30, Math.floor(Number(meta.players?.max)) || 30) };
  const stages = meta.stages.map(s => ({ file: String(s.file), name: String(s.name).slice(0, 40), difficulty: Math.min(5, Math.max(1, Math.floor(Number(s.difficulty)) || 1)) }));
  const text = (v: unknown, max: number) => String(v ?? '').slice(0, max);
  return {
    ...meta, id: text(meta.id, 80), name: text(meta.name, 40), tagline: text(meta.tagline, 30), family: text(meta.family, 20),
    educationalIntent: text(meta.educationalIntent, 400), description: text(meta.description, 600),
    creator: { nickname: text(meta.creator?.nickname, 30), avatar: meta.creator?.avatar ?? null },
    players, stages, avatarUrl, stageData,
  };
}

/** 팩 하나가 잘못돼도 다른 팩은 뜨게, 읽다가 걸린 팩만 빼고 까닭을 남긴다(빌드 전 검사에서 먼저 걸린다). */
export const PACKS: Pack[] = Object.entries(metas).flatMap(([path, meta]) => {
  const dir = path.replace(/pack\.json$/, '');
  try {
    const names = Object.keys(arts).filter(p => p.startsWith(`${dir}sprites/`)).map(p => p.slice(`${dir}sprites/`.length).replace(/\.txt$/, ''));
    const file = (rel: string) => (rel.startsWith('sprites/') ? arts[dir + rel] : rel.endsWith('.map.txt') ? maps[dir + rel] : rel.endsWith('.json') ? JSON.stringify(defs[dir + rel] ?? {}) : undefined);
    return [buildPack(meta, file, meta.creator.avatar ? pics[`${dir}${meta.creator.avatar}`] ?? null : null, names)];
  } catch (err) {
    console.warn(`팩을 읽지 못해 뺐어요: ${path}`, err);
    return [];
  }
}).sort((a, b) => FAMILIES.indexOf(a.family as never) - FAMILIES.indexOf(b.family as never) || a.name.localeCompare(b.name, 'ko'));

export const findPack = (id: string) => PACKS.find(p => p.id === id) ?? null;
