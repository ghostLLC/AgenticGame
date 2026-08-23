# AgenticGame · 坦克竞技场

**给 AI agent 玩的编程竞技游戏。** 你（人类）扮演教练：指挥你的 AI agent 阅读规则书、编写坦克
bot 代码；比赛中代码被冻结，在确定性沙盒引擎里与其他 AI 写的 bot 对战。谁的 AI 写得强，谁赢。

类似 RoboCode / MIT Battlecode 的玩法，但参赛选手从人类程序员换成了 coding agent——
2026 年了，该轮到 AI 上场了。

## 玩法闭环

```
你 ──> 把 docs/tank-spec.md 喂给你的 AI agent
     ──> AI 产出 my-tank.js
     ──> arena validate / self / play 挑战基准 bot
     ──> 观看回放，告诉 AI 哪里打得蠢
     ──> AI 迭代代码 …… 直到你认为它够强
     ──> 和朋友交换 bot 文件，本地对战，分享回放定胜负
```

“开局后 AI 不能碰代码”由引擎天然保证：比赛时只在开局加载一次 bot 文件，之后每 tick 只是调用，
不存在热重载通道。回放记录双方代码的 sha256 指纹 + 确定性引擎，任何人都能复现验证比赛真实性。

## 快速开始

需要 Node.js ≥ 20。

```bash
npm install

# 内置示例对战（Chaser vs Sniper）并自动打开网页回放
npm run arena -- demo

# 用你的 AI 写的 bot 作战（让 AI 读 docs/tank-spec.md）
npm run arena -- play my-tank.js bots/sniper.js

# 校验 / 镜像 / 地图 / 观看回放
npm run arena -- validate my-tank.js
npm run arena -- self my-tank.js
npm run arena -- maps
npm run arena -- serve replays/<文件>.json
npm run test          # 自动化测试（20 项：17 项引擎 + 3 项 Runner/沙盒集成）
```

和朋友的约战流程：把 `docs/tank-spec.md` 发给对方 → 对方的 AI 写 bot → 互发 `.js` 文件 →
任意一方本地 `arena play` → 把回放 JSON 发给对方验证（或直接让对方重跑确认结果一致）。

## 游戏规则（30 秒版）

- 32×24 网格战场（官方对称地图），1v1，完全信息，离散 tick 同步回合制
- 每 tick 双方同时提交 `{throttle, bodyTurn, turretTurn, fire}`：八方向移动/车体炮塔独立转向/开火
- 炮弹沿八方向直线每 tick 飞 2 格、逐格判定，命中 -34 HP（100 HP 三发死），开火冷却 4 tick
- 命中的核心是"直线关系"博弈：只有处在对方八方向直线上才互相打得着——走位、预判、掩体、躲弹
- Bot 是单文件 JS（CommonJS 工厂函数），跑在 worker + VM 沙盒里：无网络/文件/真实时间，
  每 tick 30ms 预算，超时/异常计违规，累计 30 次判负
- 完整规则书（写给 AI 读的）：**[docs/tank-spec.md](docs/tank-spec.md)**

## 内置基准 bot（`bots/`，由弱到强）

`sitting-duck` ★ → `random` ★★ → `sniper` ★★★（预判提前量 + 距离管理）→ `chaser` ★★★★
（BFS 寻路 + 直线射击 + 见弹侧移）。它们同时是教学示例：让 AI 读 chaser.js 学进阶写法。

## 项目结构

```
src/core/       确定性模拟内核（types / 规则常量 / 地图 / tick 结算）
src/runtime/    bot 沙盒（worker + VM 白名单上下文、时间预算、日志收集）
src/runner/     对局驱动（内核×沙盒×回放记录；违规与崩溃判负）
src/cli/        arena 命令行（play / self / validate / serve / demo / maps）
src/replay/     回放格式（自包含：地图+规则+代码指纹+逐帧快照）
viewer/         单文件网页回放播放器（canvas 渲染、逐帧、调速、事件与日志）
bots/           内置基准 bot（也是给 AI 的参考实现）
docs/           tank-spec.md —— 规则书，本项目的核心资产
tests/          引擎单元测试 + Runner/沙盒集成测试
```

## 设计原则

1. **规则书是给 LLM 读的。** API 设计、错误信息、示例代码都为"AI 一次写对"优化。
   这份 spec 的质量就是游戏平衡的一部分。
2. **教练迭代循环是核心乐趣。** 一条命令出回放、回放可逐帧观看、bot 的 console.log
   会进回放——让"人看回放 → 指出问题 → AI 改代码"转得飞快。
3. **确定性即公平。** 引擎无随机（bot 用引擎派发的种子 RNG）、结算顺序固定、
   回放可复现验证，不需要信任任何服务器。

## 安全模型

沙盒（Node worker + `vm` 白名单上下文）用于**防止意外**（死循环、超时、误用危险 API），
不是防恶意攻击的安全边界——`vm` 存在已知的逃逸手段。朋友之间对战完全够用；
正式公开比赛计划改用进程级隔离或 WASM。

## 路线图

- [x] v0.1：本地对战闭环（引擎 / 沙盒 / CLI / 回放播放器 / 4 个基准 bot / 规则书）
- [x] Windows x64 单文件 `arena.exe`（双击启动网页控制台）
- [ ] **P2P 联机约战**（无需服务器）：WebRTC 数据通道互传 bot 文件与回放 hash，
      双方各自本地跑引擎、交换结果互验——对战本身是离线确定性模拟，"联机"只需要交换文件
- [ ] 2v2 团队战（一个 bot 控制两台坦克）
- [ ] 更多地图与赛季轮换；社区地图投稿
- [ ] 信息不完全模式（雷达扫描 / 战争迷雾）
- [ ] 轻量 Elo 天梯（可托管在静态空间）
- [ ] 第二个游戏题材（引擎与管线已按可扩展结构组织）

## 常见问题

**为什么 bot 用 JavaScript？** AI 写 JS 最顺、Node 沙盒成熟、朋友对战只需互发单个 .js 文件，零门槛。

**平局太多怎么办？** 让你的 AI 更快建立直线火力优势；1500 tick 打满后按 HP 判定，拖时间没有收益。

**我的 AI 说"找不到 spec"？** 规则书在 `docs/tank-spec.md`，直接把整个文件内容发给它。

---

*AgenticGame 系列 #1 · 坦克竞技场 v0.1.0 · 2026-08*
