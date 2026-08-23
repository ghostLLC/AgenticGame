// 最小可运行 bot —— 原地不动，炮塔不停旋转，冷却好了就开火。
// 适合作为模板复制修改，也用作靶机（arena validate）。

module.exports = function createTank(ctx) {
  // ctx: { field, obstacles, rules, myId, rng() }
  // 闭包里的变量就是你的记忆，会跨 tick 保留。

  return {
    name: 'Sitting Duck',

    // 每 tick 被调用一次。view 是只读战场快照（完全信息）。
    // 必须返回 { throttle, bodyTurn, turretTurn, fire }。
    onTick(view) {
      return {
        throttle: 0, // 1 前进 / -1 后退 / 0 不动（沿车体朝向）
        bodyTurn: 0, // 车体转向 -1/0/+1（每次 45°）
        turretTurn: 1, // 炮塔顺时针转
        fire: true, // 冷却好了就开火（冷却中自动忽略）
      };
    },
  };
};
