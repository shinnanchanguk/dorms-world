// 표지 글의 옛한글(첫·가운데·끝소리 자모로 적은 음절)을 나누는 규칙. 옛한글 덩이만 기기의 한글 글꼴로 그려 한 음절로 모은다(platform/render.ts 의 bubble).
// 옛 글자는 손으로 치지 않고 코드로 적는다.
import { describe, expect, it } from 'vitest';
import { hasOldHangul, oldHangulRuns } from '../platform/text';

const ARAEA_RIEUL = 'ᄋᆞᆯ';             // 아래아가 든 목적격 조사(ㅇ+아래아+ㄹ)
const BARAM = 'ᄇᆞᄅᆞᆷ';       // 바람(ㅂ+아래아, ㄹ+아래아+ㅁ)
const NA_MOK = '나ᇚ';                         // 현대 음절 '나' 뒤에 옛 끝소리(ㅁㄱ)를 붙인 글자

describe('옛한글 나누기', () => {
  it('옛한글이 없으면 한 덩이(게임 글꼴)', () => {
    expect(hasOldHangul('을: 앞말에 받침이 있고 음성 모음일 때 써요.')).toBe(false);
    expect(oldHangulRuns('을: 받침')).toEqual([{ text: '을: 받침', old: false }]);
  });

  it('호환 자모로 풀어 쓴 글(ㅇㆍㄹ)은 옛한글로 보지 않는다(게임 글꼴로 이미 깨끗이 나온다)', () => {
    expect(hasOldHangul('ㅇㆍㄹ')).toBe(false);
  });

  it('옛한글 음절은 따로 한 덩이', () => {
    expect(hasOldHangul(ARAEA_RIEUL)).toBe(true);
    expect(oldHangulRuns(`${ARAEA_RIEUL}: 받침`)).toEqual([{ text: ARAEA_RIEUL, old: true }, { text: ': 받침', old: false }]);
  });

  it('글 가운데의 옛한글도 앞뒤를 나눈다', () => {
    expect(oldHangulRuns(`바람(${BARAM})에`)).toEqual([{ text: '바람(', old: false }, { text: BARAM, old: true }, { text: ')에', old: false }]);
  });

  it('옛 끝소리가 현대 음절에 붙으면 그 음절까지 옛한글 덩이로 가져간다', () => {
    expect(oldHangulRuns(`나모와 ${NA_MOK}`)).toEqual([{ text: '나모와 ', old: false }, { text: NA_MOK, old: true }]);
    expect(oldHangulRuns(NA_MOK)).toEqual([{ text: NA_MOK, old: true }]);
  });

  it('나눈 덩이를 이으면 원래 글이다', () => {
    for (const s of ['', '을', ARAEA_RIEUL, `${BARAM} ${ARAEA_RIEUL}`, `가${NA_MOK}나`, `Ø: ${ARAEA_RIEUL}과 을`]) {
      expect(oldHangulRuns(s).map(r => r.text).join('')).toBe(s);
    }
  });
});
