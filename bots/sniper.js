// 狙击手 —— 强力参考 bot。演示四个进阶技巧：
//   1. 站定射击：移动会导致"决策坐标 ≠ 发射坐标"（结算顺序），站定才能打准
//   2. 预判射击：用敌人上 tick 位置估计速度，解算提前量（弹速 2 格/tick）
//   3. 切线步：主动横移进入与敌人的八方向直线关系，创造射击窗口
//   4. 危险感知：敌方炮口指向我且视线无遮挡时，侧移脱离弹道
// 把它当作你要击败的基准。

module.exports = function createTank(ctx) {
  const W = ctx.field.width;
  const H = ctx.field.height;
  const obstacles = ctx.obstacles;
  const BULLET_SPEED = ctx.rules.bulletSpeed;

  const DIRS = [
    [0, -1], [1, -1], [1, 0], [1, 1],
    [0, 1], [-1, 1], [-1, 0], [-1, -1],
  ];

  function blocked(x, y) {
    if (x < 0 || y < 0 || x >= W || y >= H) return true;
    return obstacles.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
  }

  function dirDiff(from, to) {
    let d = (to - from) % 8;
    if (d > 4) d -= 8;
    if (d < -4) d += 8;
    return d;
  }

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

  function turnToward(from, to) {
    const diff = dirDiff(from, to);
    return diff === 0 ? 0 : diff > 0 ? 1 : -1;
  }

  // 记忆：敌人上 tick 位置（估计速度用）
  let lastFoe = null; // {tick, x, y}

  // 预判解算：找方向 d，使"敌人按当前速度外推 t tick 后的位置"恰好落在
  // 我沿 d 的射击直线上，且炮弹到达时间（每 tick 前进 2 个子步、逐格判定，
  // 因此 ceil(dist/2) tick 到达）恰好等于 t，弹道无遮挡。
  function solveShot(me, foe, vx, vy) {
    for (let t = 1; t <= 14; t++) {
      const px = foe.x + vx * t;
      const py = foe.y + vy * t;
      if (px < 0 || py < 0 || px >= W || py >= H) break;
      const d = lineDir(me.x, me.y, px, py);
      if (d < 0) continue;
      const dist = Math.max(Math.abs(px - me.x), Math.abs(py - me.y));
      if (dist === 0) continue;
      if (Math.ceil(dist / BULLET_SPEED) !== t) continue;
      if (pathClear(me.x, me.y, d, px, py)) return d;
    }
    return -1;
  }

  // 切线步：返回一个正交方向，走一步后与敌人形成八方向直线（或显著更接近）。
  // 已在直线上返回 -1。
  function strafeStep(me, foe) {
    const dx = foe.x - me.x;
    const dy = foe.y - me.y;
    if (dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy)) return -1;
    let best = -1;
    let bestOff = Infinity;
    for (const d of [0, 2, 4, 6]) {
      const nx = me.x + DIRS[d][0];
      const ny = me.y + DIRS[d][1];
      if (blocked(nx, ny)) continue;
      const ndx = foe.x - nx;
      const ndy = foe.y - ny;
      // 离最近直线关系的距离：要么逼近坐标轴(dx=0 或 dy=0)，要么逼近对角线
      const off = Math.min(
        Math.min(Math.abs(ndx), Math.abs(ndy)),
        Math.abs(Math.abs(ndx) - Math.abs(ndy)),
      );
      if (off < bestOff) {
        bestOff = off;
        best = d;
      }
    }
    return bestOff < Math.max(Math.abs(dx), Math.abs(dy)) ? best : -1;
  }

  // BFS 距离场：从 (tx,ty) 扩散到全图（目标格视为可通行）。
  // 逼近 = 走向距离更小的邻格；拉开 = 走向距离更大的邻格。
  // 沿距离场走遇墙自动绕行，不会震荡。
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

  // 逼近目标的一步方向（沿距离场下坡）；无法更近返回 -1
  function stepToward(me, tx, ty, tick) {
    const D = fieldTo(tx, ty, tick);
    const here = D[me.y * W + me.x];
    let best = -1;
    let bestD = here;
    for (let d = 0; d < 8; d++) {
      const nx = me.x + DIRS[d][0];
      const ny = me.y + DIRS[d][1];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      if (blocked(nx, ny)) continue;
      const nd = D[ny * W + nx];
      if (nd >= 0 && (here < 0 || nd < bestD)) {
        bestD = nd;
        best = d;
      }
    }
    return best;
  }

  // 远离目标的一步方向（沿距离场上坡）；无法更远返回 -1
  function stepAway(me, tx, ty, tick) {
    const D = fieldTo(tx, ty, tick);
    const here = D[me.y * W + me.x];
    let best = -1;
    let bestD = here;
    for (let d = 0; d < 8; d++) {
      const nx = me.x + DIRS[d][0];
      const ny = me.y + DIRS[d][1];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      if (blocked(nx, ny)) continue;
      const nd = D[ny * W + nx];
      if (nd >= 0 && nd > bestD) {
        bestD = nd;
        best = d;
      }
    }
    return best;
  }

  // 按方向 d 执行移动；车体未对准则转向，能走就边转边走。
  function stepMove(me, d) {
    if (d === undefined || d < 0) return { throttle: 0, bodyTurn: 0 };
    if (me.dirBody === d) return { throttle: 1, bodyTurn: 0 };
    const nx = me.x + DIRS[me.dirBody][0];
    const ny = me.y + DIRS[me.dirBody][1];
    return { throttle: blocked(nx, ny) ? 0 : 1, bodyTurn: turnToward(me.dirBody, d) };
  }

  return {
    name: 'Sniper',

    onTick(view) {
      const me = view.self;
      const foe = view.enemy;

      if (!foe.alive) {
        lastFoe = null;
        return { throttle: 0, bodyTurn: 0, turretTurn: 0, fire: false };
      }

      // 敌人速度估计（-1/0/1；不连续则视为 0）
      let vx = 0;
      let vy = 0;
      if (lastFoe && view.tick - lastFoe.tick === 1) {
        vx = Math.max(-1, Math.min(1, foe.x - lastFoe.x));
        vy = Math.max(-1, Math.min(1, foe.y - lastFoe.y));
      }
      lastFoe = { tick: view.tick, x: foe.x, y: foe.y };

      const dist = Math.max(Math.abs(foe.x - me.x), Math.abs(foe.y - me.y));

      // ---- 1) 有解算射击方案：站定，转炮塔，对准即开 ----
      const shotDir = solveShot(me, foe, vx, vy);
      if (shotDir >= 0) {
        const turretTurn = turnToward(me.dirTurret, shotDir);
        return {
          throttle: 0, // 站定射击：移动会让解算失准
          bodyTurn: 0,
          turretTurn,
          fire: turretTurn === 0,
        };
      }

      // ---- 2) 危险躲避：敌炮口指向我 + 视线通 + 即将开火，或炮弹逼近 ----
      const threatLine = lineDir(foe.x, foe.y, me.x, me.y);
      const aimedAtMe =
        threatLine >= 0 &&
        dirDiff(foe.dirTurret, (threatLine + 4) % 8) === 0 &&
        pathClear(foe.x, foe.y, threatLine, me.x, me.y);
      const incoming = view.bullets.some(
        (b) => b.ownerId !== me.id && Math.abs(b.x - me.x) <= 3 && Math.abs(b.y - me.y) <= 3,
      );
      if ((aimedAtMe && (foe.cooldown <= 2 || dist >= 6)) || incoming) {
        const perp = incoming ? (dirTo(me.x - foe.x, me.y - foe.y) + 2) % 8 : (threatLine + 2) % 8;
        const side = ((perp % 8) + 8) % 8;
        const mv = stepMove(me, side);
        const aimTurret0 = lineDir(me.x, me.y, foe.x, foe.y);
        const t0 = aimTurret0 >= 0 ? aimTurret0 : dirTo(foe.x - me.x, foe.y - me.y);
        return { ...mv, turretTurn: turnToward(me.dirTurret, t0), fire: false };
      }

      // ---- 3) 机动：视线优先，其次距离管理与切线 ----
      //     有效视线 = 在八方向直线上且弹道无遮挡
      const line = lineDir(me.x, me.y, foe.x, foe.y);
      const sightClear = line >= 0 && pathClear(me.x, me.y, line, foe.x, foe.y);

      let step = -1;
      if (dist < 7 && sightClear) {
        // 贴脸且对方打得着我：拉开
        step = stepAway(me, foe.x, foe.y, view.tick);
      } else if (dist > 13 || !sightClear) {
        // 太远，或暂时打不着（非直线 / 被墙挡）→ 逼近创造战机；
        // 中距离且非直线时优先横切一步入线
        step = stepToward(me, foe.x, foe.y, view.tick);
        if (dist <= 13 && line < 0) {
          const s = strafeStep(me, foe);
          if (s >= 0) step = s;
        }
      }
      // 其余情况（7~13 格 + 有视线）：站桩等射击窗口
      const mv = stepMove(me, step);

      // ---- 4) 炮塔持续指向直线方向（进入射界的瞬间即可开火） ----
      const aimTurret = line >= 0 ? line : dirTo(foe.x - me.x, foe.y - me.y);
      return { ...mv, turretTurn: turnToward(me.dirTurret, aimTurret), fire: false };
    },
  };
};
