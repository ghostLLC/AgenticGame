// 追击者 —— 中等强度参考 bot。
// 策略：BFS 寻路逼近敌人（遇墙自动绕行）；炮塔始终指向"当前直线方向"，
// 与敌人构成八方向直线且视线无遮挡时开火；能打到就不停，贴脸停是对轰。
// 演示：方向计算、直线判定、视线检查、BFS 距离场寻路。

module.exports = function createTank(ctx) {
  const W = ctx.field.width;
  const H = ctx.field.height;
  const obstacles = ctx.obstacles; // [{x,y,w,h}, ...]

  // 与规则一致的八方向表（索引 = 方向，y 向下）
  const DIRS = [
    [0, -1], [1, -1], [1, 0], [1, 1],
    [0, 1], [-1, 1], [-1, 0], [-1, -1],
  ];

  function blocked(x, y) {
    if (x < 0 || y < 0 || x >= W || y >= H) return true;
    return obstacles.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
  }

  // 最接近目标向量 (dx,dy) 的方向
  function dirTo(dx, dy) {
    if (dx === 0 && dy === 0) return 2;
    let best = 0;
    let bestScore = -Infinity;
    for (let d = 0; d < 8; d++) {
      const [ux, uy] = DIRS[d];
      const score = (dx * ux + dy * uy) / Math.hypot(ux, uy);
      if (score > bestScore) {
        bestScore = score;
        best = d;
      }
    }
    return best;
  }

  // from→to 的最短角差（-4..4，正数 = 顺时针）
  function dirDiff(from, to) {
    let d = (to - from) % 8;
    if (d > 4) d -= 8;
    if (d < -4) d += 8;
    return d;
  }

  // 若目标恰好在 (x,y) 的八方向直线上，返回该方向；否则返回 -1
  function lineDir(x, y, ex, ey) {
    const dx = ex - x;
    const dy = ey - y;
    if (!(dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy))) return -1;
    const sx = Math.sign(dx);
    const sy = Math.sign(dy);
    for (let d = 0; d < 8; d++) {
      if (DIRS[d][0] === sx && DIRS[d][1] === sy) return d;
    }
    return -1;
  }

  // 沿 dir 方向从 (x,y) 到 (ex,ey) 的格子是否无障碍
  function pathClear(x, y, dir, ex, ey) {
    let cx = x;
    let cy = y;
    while (cx !== ex || cy !== ey) {
      cx += DIRS[dir][0];
      cy += DIRS[dir][1];
      if (cx === ex && cy === ey) return true;
      if (blocked(cx, cy)) return false;
    }
    return true;
  }

  // BFS 距离场：从 (tx,ty) 扩散到全图（目标格视为可通行）。
  // 之后每步走向"距离更小"的相邻格即可，遇墙自动绕行，不会震荡。
  let cachedFieldTick = -1;
  let cachedField = null;
  function fieldTo(tx, ty, tick) {
    if (cachedFieldTick === tick) return cachedField;
    const D = new Int16Array(W * H).fill(-1);
    const q = [ty * W + tx];
    D[ty * W + tx] = 0;
    let head = 0;
    while (head < q.length) {
      const k = q[head++];
      const x = k % W;
      const y = (k - x) / W;
      for (let d = 0; d < 8; d++) {
        const nx = x + DIRS[d][0];
        const ny = y + DIRS[d][1];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const nk = ny * W + nx;
        if (D[nk] !== -1) continue;
        if (blocked(nx, ny) && !(nx === tx && ny === ty)) continue;
        D[nk] = D[k] + 1;
        q.push(nk);
      }
    }
    cachedFieldTick = tick;
    cachedField = D;
    return D;
  }

  return {
    name: 'Chaser',

    onTick(view) {
      const me = view.self;
      const foe = view.enemy;
      const idle = { throttle: 0, bodyTurn: 0, turretTurn: 0, fire: false };
      if (!foe.alive) return idle;

      // ---- 炮塔：永远指向"当前直线方向"（若有），否则指向敌人方向。
      //      直线时机出现的瞬间，炮塔通常已经就位，立即开火。 ----
      const aim = lineDir(me.x, me.y, foe.x, foe.y);
      const desiredTurret = aim >= 0 ? aim : dirTo(foe.x - me.x, foe.y - me.y);
      const tdiff = dirDiff(me.dirTurret, desiredTurret);
      const turretTurn = tdiff === 0 ? 0 : tdiff > 0 ? 1 : -1;
      let fire = false;
      if (turretTurn === 0 && aim >= 0 && pathClear(me.x, me.y, aim, foe.x, foe.y)) {
        fire = true;
      }

      // ---- 躲弹优先：附近有敌方炮弹朝我飞来时，侧移脱离弹道 ----
      const incoming = view.bullets.find(
        (b) => b.ownerId !== me.id && Math.abs(b.x - me.x) <= 3 && Math.abs(b.y - me.y) <= 3,
      );
      if (incoming) {
        // 垂直于弹道方向的两侧，选车体转过去更快的一侧
        const sides = [(incoming.dir + 2) % 8, (incoming.dir + 6) % 8];
        const side = Math.abs(dirDiff(me.dirBody, sides[0])) <= Math.abs(dirDiff(me.dirBody, sides[1])) ? sides[0] : sides[1];
        if (me.dirBody === side) {
          return { throttle: 1, bodyTurn: 0, turretTurn, fire: false }; // 闪避时不盲目开火
        }
        const nx = me.x + DIRS[me.dirBody][0];
        const ny = me.y + DIRS[me.dirBody][1];
        return { throttle: blocked(nx, ny) ? 0 : 1, bodyTurn: dirDiff(me.dirBody, side) > 0 ? 1 : -1, turretTurn, fire: false };
      }

      // ---- 车体：BFS 逼近敌人（自动绕障碍）；
      //      距离 3 格内且"真的打得着"（直线+无遮挡）才停下对轰 ----
      const dist = Math.max(Math.abs(foe.x - me.x), Math.abs(foe.y - me.y));
      const canHit = aim >= 0 && pathClear(me.x, me.y, aim, foe.x, foe.y);
      let throttle = 0;
      let bodyTurn = 0;

      if (dist > 3 || !canHit) {
        const D = fieldTo(foe.x, foe.y, view.tick);
        let best = -1;
        let bestD = D[me.y * W + me.x];
        for (let d = 0; d < 8; d++) {
          const nx = me.x + DIRS[d][0];
          const ny = me.y + DIRS[d][1];
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          if (blocked(nx, ny)) continue;
          const nd = D[ny * W + nx];
          if (nd >= 0 && nd < bestD) {
            bestD = nd;
            best = d;
          }
        }
        if (best >= 0) {
          if (me.dirBody === best) {
            throttle = 1;
          } else {
            const bdiff = dirDiff(me.dirBody, best);
            bodyTurn = bdiff > 0 ? 1 : -1;
            // 当前朝向能走就边转边走（别浪费 tick）
            const nx = me.x + DIRS[me.dirBody][0];
            const ny = me.y + DIRS[me.dirBody][1];
            if (!blocked(nx, ny)) throttle = 1;
          }
        }
      }

      return { throttle, bodyTurn, turretTurn, fire };
    },
  };
};
