// 随机游走 bot —— 每 5 tick 随机决定一次动作。演示 ctx.rng() 的用法。
// 注意：Math.random() 在沙盒中被禁用（会抛错），必须用 ctx.rng()。

module.exports = function createTank(ctx) {
  const rng = ctx.rng;
  let current = { throttle: 0, bodyTurn: 0, turretTurn: 0, fire: false };

  return {
    name: 'Random Walker',

    onTick(view) {
      if (view.tick % 5 === 0) {
        current = {
          throttle: rng() < 0.75 ? 1 : 0,
          bodyTurn: Math.floor(rng() * 3) - 1, // -1/0/+1
          turretTurn: Math.floor(rng() * 3) - 1,
          fire: rng() < 0.5,
        };
      }
      return current;
    },
  };
};
