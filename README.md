# AgenticGame · 坦克竞技场

**游戏优先、代码可选的 AI 原生坦克策略游戏。** 目标体验是让普通玩家从选车、装配和预设指挥官开始；
想深入的玩家再让 Codex、Claude Code 等外部 Agent 编写 Bot，或使用内置 BYOK Harness 描述战术并生成 Bot。

当前 v0.1 仍是 RoboCode / MIT Battlecode 风格的 1v1 编程坦克基线；v0.2 正在建立可扩展规则、
完整比赛资产和新用户体验所需的底层契约。

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
npm run test          # 自动化测试（55 项：v1 引擎/Runner + Core v2/Replay v2 运行链路）
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
src/core/       v1 确定性模拟内核 + v2 通用内容、配置和确定性 JSON 契约
src/runtime/    bot 沙盒（worker + VM 白名单上下文、时间预算、日志收集）
src/runner/     对局驱动（内核×沙盒×双格式回放；违规与崩溃判负）
src/cli/        arena 命令行（play / self / validate / serve / demo / maps）
src/replay/     Replay v1 + 完整 Match Bundle v2 契约与完整性校验
viewer/         单文件网页回放播放器（canvas 渲染、逐帧、调速、事件与日志）
bots/           内置基准 bot（也是给 AI 的参考实现）
docs/           v1 规则书、产品规格、治理规则和实施计划
tests/          引擎/Runner 测试 + Core v2/Replay v2 契约测试
```

## 设计原则

1. **游戏体验先于技术展示。** 默认路径服务普通玩家，代码、seed 和规则细节进入渐进式高级入口。
2. **Agent 是能力放大器，不是门票。** 外部 Agent 与内置 Harness 使用同一能力和评测边界。
3. **教练迭代循环是核心乐趣。** 战斗、复盘、保存配置、自我对战和再次迭代必须形成短闭环。
4. **确定性即公平。** 随机种子、配置、内容快照和完整比赛时间线都可哈希、回读和验证。

## 安全模型

沙盒（Node worker + `vm` 白名单上下文）用于**防止意外**（死循环、超时、误用危险 API），
不是防恶意攻击的安全边界——`vm` 存在已知的逃逸手段。朋友之间对战完全够用；
正式公开比赛计划改用进程级隔离或 WASM。

## 路线图

- [x] v0.1：本地对战闭环（引擎 / 沙盒 / CLI / 回放播放器 / 4 个基准 bot / 规则书）
- [x] Windows x64 单文件 `arena.exe`（双击启动网页控制台）
- [x] v0.2 基础契约：通用内容定义、严格 MatchConfigV2、完整 Match Bundle / Replay v2
- [x] Replay v2 运行时接入：Runner 同时返回兼容 Replay v1 与可校验 MatchBundleV2
- [ ] v0.2 首期玩法纵切：3 种车辆、视野、地形、方向装甲、弹药与机动差异
- [ ] 决斗 + 占领模式；保存配置、新配置对战旧配置
- [ ] 按 Ardot 实现指挥中心、车库、Agent 中心、战术实验室、战斗和回放工作室
- [ ] 外部 Agent 接入 + 内置 BYOK Harness
- [ ] 2v2、更多地图、更多比赛模式与赛季内容

## 常见问题

**为什么 bot 用 JavaScript？** AI 写 JS 最顺、Node 沙盒成熟、朋友对战只需互发单个 .js 文件，零门槛。

**平局太多怎么办？** 让你的 AI 更快建立直线火力优势；1500 tick 打满后按 HP 判定，拖时间没有收益。

**我的 AI 说"找不到 spec"？** 规则书在 `docs/tank-spec.md`，直接把整个文件内容发给它。

---

*AgenticGame 系列 #1 · 坦克竞技场 v0.1.0 · 2026-08*
