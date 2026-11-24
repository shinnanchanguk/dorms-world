import type { Behavior } from '../behavior';

/**
 * 앞뒤로 번갈아 미는 바닥. 위에 서거나 안에 든 도름이를 한동안 앞(오른쪽)으로 천천히 밀고, 잠깐 멈췄다가,
 * 한동안 뒤(왼쪽)로 세게 밀고, 다시 잠깐 멈춘다(4초 한 바퀴). 뒤로 미는 힘이 걷는 빠르기보다 세서 혼자 버티지 못한다.
 * 줄로 묶인 짝이 멈춘 바닥에 버티고 서 있으면 밀려나는 친구를 붙잡아 준다.
 * 소장의 꿈틀 운동(음식을 앞뒤로 밀어 섞고 보낸다), 물살, 바람, 컨베이어에.
 * 모든 같은 물건이 같은 박자로 움직인다(지난 시간 ctx.t 로만 정해서 모든 화면이 같다).
 * vars: [0] 지금 미는 쪽(1 앞, -1 뒤, 0 멈춤). 0 이 아니면 opens 다리가 켜진다.
 */
const CYCLE = 4, FWD_END = 1.6, BACK_START = 2, BACK_END = 3.6;
const FWD_SPEED = 90, BACK_SPEED = 300;   // px/초. 걷기는 175

const phase = (t: number) => t - Math.floor(t / CYCLE) * CYCLE;
const dirAt = (t: number) => { const s = phase(t); return s < FWD_END ? 1 : s >= BACK_START && s < BACK_END ? -1 : 0; };

const surge: Behavior = {
  about: '위의 도름이를 앞으로 천천히, 뒤로 세게 번갈아 민다(4초 한 바퀴)',
  tick: (ctx, dt, touching) => {
    const d = dirAt(ctx.t);
    ctx.vars[0] = d;
    if (!d) return;
    const px = d > 0 ? FWD_SPEED * dt : -BACK_SPEED * dt;
    for (const p of touching) ctx.shove(p, px);
  },
  frame: ctx => (ctx.vars[0] > 0 ? 1 : ctx.vars[0] < 0 ? 2 : 0),
  label: ctx => (ctx.vars[0] > 0 ? '앞으로 밀어요' : ctx.vars[0] < 0 ? '뒤로 밀어요' : null),
};
export default surge;
