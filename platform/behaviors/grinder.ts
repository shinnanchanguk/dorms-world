import type { Behavior } from '../behavior';

/**
 * 잘게 부수는 통. 받는 물건(things.json 의 takes)을 들고 확인하면 넣고, 서로 다른 친구가 번갈아 확인을 눌러 네 번 부수면
 * 내주는 물건(gives)을 꺼낼 수 있다. 꺼내면 통이 비어 다음 것을 받는다. 위(음식 → 잘게 부순 음식), 맷돌(곡식 → 가루), 공장(재료 → 부품)에.
 * vars: [0] 지금까지 꺼낸 수(0 이 아니면 opens 다리가 켜진다), [1] 0 빔 · 1 부수는 중 · 2 다 됨, [2] 부순 횟수, [3] 마지막으로 부순 도름이 차례 + 1
 * 혼자 있는 방이 아니면 같은 도름이가 잇달아 부술 수 없다(여럿이 번갈아야 한다).
 */
const NEED = 4;

const grinder: Behavior = {
  about: '받은 물건을 여럿이 번갈아 네 번 눌러 부수면 다른 물건으로 내준다',
  use: (ctx, p) => {
    if (ctx.vars[1] === 0) {
      const held = ctx.holding(p);
      if (held == null || !ctx.takes.includes(held)) return false;
      ctx.take(p);
      ctx.vars[1] = 1; ctx.vars[2] = 0; ctx.vars[3] = 0;
      return true;
    }
    if (ctx.vars[1] === 1) {
      if (ctx.players > 1 && ctx.vars[3] === p.i + 1) return false;
      ctx.vars[2] += 1; ctx.vars[3] = p.i + 1;
      if (ctx.vars[2] >= NEED) ctx.vars[1] = 2;
      return true;
    }
    if (ctx.holding(p) != null || !ctx.gives) return false;
    if (!ctx.give(p, ctx.gives)) return false;
    ctx.vars[0] += 1; ctx.vars[1] = 0; ctx.vars[2] = 0; ctx.vars[3] = 0;
    return true;
  },
  useText: (ctx, p) => {
    const held = ctx.holding(p);
    if (ctx.vars[1] === 0) return held != null && ctx.takes.includes(held) ? '확인: 넣기' : '넣을 것을 들고 와요';
    if (ctx.vars[1] === 1) return ctx.players > 1 && ctx.vars[3] === p.i + 1 ? '친구가 부술 차례예요' : `확인: 부수기 ${ctx.vars[2]}/${NEED}`;
    return held == null ? '확인: 꺼내기' : '손을 비우고 와요';
  },
  label: ctx => (ctx.vars[1] === 1 ? `${ctx.vars[2]}/${NEED}` : ctx.vars[1] === 2 ? '다 됐어요' : null),
  frame: ctx => (ctx.vars[1] === 0 ? 0 : ctx.vars[1] === 1 ? 1 + (ctx.vars[2] % 2) : 3),
};
export default grinder;
