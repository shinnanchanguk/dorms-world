/** HTML 로 넣는 글자는 모두 이걸 거친다(방 친구의 이름처럼 밖에서 온 글자가 있으므로). */
export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
/**
 * 옛한글: 첫소리·가운뎃소리·끝소리 자모(U+1100~11FF, A960~A97F, D7B0~D7FF)를 이어 적어 한 음절을 이루는 글자(아래아가 든 음절 등).
 * 게임 글꼴(Galmuri11)은 이 자모를 한 음절로 모으지 못하고 낱글자로 흩어 그린다. 그래서 표지 글에서는 옛한글 덩이만 기기의 한글 글꼴로 그린다.
 */
const OLD_JAMO = /[ᄀ-ᇿꥠ-꥿ힰ-퟿]/;
const OLD_TAIL = /[ᅠ-ᇿힰ-퟿]/;   // 가운뎃소리·끝소리: 앞 음절에 붙는다
const SYLLABLE = /[가-힣]/;

export const hasOldHangul = (s: string) => OLD_JAMO.test(s);

/**
 * 글을 게임 글꼴로 그릴 덩이와 옛한글 덩이로 차례대로 나눈다(이어 붙이면 원래 글).
 * 옛한글 덩이가 가운뎃소리·끝소리로 시작하면(예: 현대 음절 뒤에 옛 끝소리를 붙인 글자) 바로 앞 음절까지 함께 옛한글 덩이로 가져간다.
 */
export function oldHangulRuns(s: string): { text: string; old: boolean }[] {
  const out: { text: string; old: boolean }[] = [];
  for (const ch of s) {
    const old = OLD_JAMO.test(ch), last = out[out.length - 1];
    if (last && last.old === old) { last.text += ch; continue; }
    if (old && OLD_TAIL.test(ch) && last && !last.old && SYLLABLE.test(last.text.slice(-1))) {
      const head = last.text.slice(-1);
      last.text = last.text.slice(0, -1);
      if (!last.text) out.pop();
      out.push({ text: head + ch, old: true });
      continue;
    }
    out.push({ text: ch, old });
  }
  return out;
}

/** 밀리초를 mm:ss 로(초는 반올림). */
export function mmss(ms: number): string {
  const sec = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
}
