# AgenticGame · 坦克竞技场

**游戏优先、代码可选的 AI 原生坦克策略游戏。** 目标体验是让普通玩家从选车、装配和预设指挥官开始；
想深入的玩家再让 Codex、Claude Code 等外部 Agent 编写 Bot，或使用内置 BYOK Harness 描述战术并生成 Bot。

当前已有两条可运行入口：保留给开发者与 Agent 的 CLI，以及面向普通玩家的独立桌面游戏窗口。
桌面端首个纵切已完成压缩好友邀请、直连、战前准备、三套预设战术、双方准备、房主自动开赛、战报同步、双方确认再来一局和房间内断线恢复。

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

玩家测试版位于 `release/AgenticGame-win-x64/AgenticGame.exe`；如通过 ZIP 分发，解压完整目录后运行，
不要只复制其中的 EXE。开发环境需要 Node.js ≥ 20：

```bash
npm install

# 正常游戏窗口（好友房间）
npm run desktop

# 生成 Windows x64 可运行目录
npm run pack:desktop-folder

# 内置示例对战（Chaser vs Sniper）并自动打开网页回放
npm run arena -- demo

# 用你的 AI 写的 bot 作战（让 AI 读 docs/tank-spec.md）
npm run arena -- play my-tank.js bots/sniper.js

# 校验 / 镜像 / 地图 / 观看回放
npm run arena -- validate my-tank.js
npm run arena -- self my-tank.js
npm run arena -- maps
npm run arena -- serve replays/<文件>.json
npm run arena -- mcp  # 外部 Agent 的本地 MCP stdio 服务
npm run test          # 自动化测试（含好友房间 P2P、封存排位原型、Agent Harness / MCP / BYOK provider）
```

正式双人流程采用好友房间：双方在线并建立 P2P 连接 → 各自选择并锁定 SavedBuild → 客人 Build
由程序自动同步 → 房主设备运行比赛 → 双方查看同一结果。用户不再处理 `.js` 文件或上传流程。
好友模式基于互信，房主设备会收到并执行客人的策略源码；未来排位才使用云端权威执行。

## 默认 v1 游戏规则（30 秒版）

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
src/runner/     v1/v2 对局驱动（内核×沙盒×完整比赛包；违规与崩溃判负）
src/cli/        arena 命令行（play / self / validate / serve / demo / maps）
src/replay/     Replay v1 + Match Bundle v2 契约、持久化仓库与 Replay Studio 投影
src/agent/      统一游戏工具、受限 Agent 循环、MCP 服务与 BYOK provider
src/friend-room/ 好友房间 P2P 协议、房主权威会话与 DataChannel 分帧传输
src/desktop/    独立游戏窗口、玩家入口、战前准备、桌面比赛运行时与安全 IPC
src/online/     已封存的未来排位/云端权威房间原型（不属于好友房间运行路径）
viewer/         单文件网页回放播放器（canvas 渲染、逐帧、调速、事件与日志）
bots/           内置基准 bot（也是给 AI 的参考实现）
docs/           v1 规则书、产品规格、治理规则和实施计划
tests/          v1/v2 引擎、Runner、内容、配置和 Replay 契约测试
```

## Gameplay v2 开发者预览

`GameplayEngineV2` 与 `runMatchV2` 已经是真实运行路径，不是只用于展示的数据结构：

- 侦察、中型、重型三类车辆具有独立 HP、正/侧/后装甲、速度、加减速、转向节奏和视野。
- 轻/中/重型炮具有独立伤害、穿深、射程、装填、弹速和有限弹药。
- `frontier-v2` 包含开阔地、森林、泥地和墙体；森林降低目标可见距离，泥地提高移动消耗。
- Bot 只收到当前可见敌人和炮弹；真实动作、战斗事件、状态、日志和源码进入可校验 MatchBundleV2。
- `capture` 据点争夺要求单方连续控制中央区域 30 tick；双方争夺或离开会重置进度，歼灭仍可直接获胜。

目前通过 TypeScript API 使用 `runMatchV2`；尚未接入 CLI、网页控制台和播放器。精确规则与接口见
[Gameplay v2 纵切规格](docs/product/gameplay-v2-vertical-slice-spec.md) 和
[Bot 规则书的 v2 章节](docs/tank-spec.md#11-gameplay-v2-开发者预览)。

## 配置历史与新旧版本练习赛

`SavedBuildV2` 把一个 Bot 的完整源码与车辆/武器/装备装配保存为不可变 revision：

- 本地仓库按 Build ID 保存连续版本，父指纹形成可校验历史链；相同内容重复保存不会产生噪声版本。
- 每个文件同时校验完整源码哈希、内容指纹和记录指纹；损坏或篡改版本不会被静默跳过。
- `runPracticeMatchV2` 可让当前 revision 对战任意历史 revision，也支持同版本镜像自测。
- 练习赛仍走真实 worker 沙盒和 MatchBundleV2，不使用简化模拟器。

当前提供 TypeScript API；Build 历史与练习赛 Ardot 设计已在页面 `2:115` 重建并完成布局复检
（主屏节点 `3:299`、`3:399`，状态基线 `3:492`），下一步按该设计接入玩家界面。
契约见 [Build 历史与练习赛规格](docs/product/build-history-practice-spec.md)。

## 双人好友房间（P2P）

首个可玩的 P2P 纵切已经建立：桌面游戏窗口支持创建邀请、接受邀请和交换加入确认；连接成功后，
双方选择三套内置战术之一并准备，客人配置在后台同步到房主设备，仅房主启动一次真实 Gameplay v2
比赛，最终战报回传双方。默认玩家界面不显示源码、代码哈希、协议名或连接参数。

`FriendDataChannelPeerV1` 已支持大消息分帧与重组；`AGFR2` 使用 gzip + Base64URL 压缩手动邀请，
同时兼容旧 `AGFR1` 邀请。底层采用无需自有游戏服务器的手动邀请确认，
默认只使用公共 STUN 帮助发现公网地址，不使用中继。严格 NAT 下仍可能无法直连，这是无自有 TURN
时的明确边界。连接中断但双方游戏仍开着时，房主可为原 `sessionId` 生成新的会合邀请，客人回传确认后
用新 DataChannel 接管原房间；双方 Build 和已完成战报保留，未开赛的准备状态会安全清除。二维码仍待接入；
短房间码或完全自动重连若用于公网，需要一个只负责牵线的轻量信令服务，不是比赛服务器。
规格见 [好友房间 P2P 规格](docs/product/friend-room-p2p-v1-spec.md)。原服务器权威实现已
[封存为未来排位原型](docs/product/async-room-v1-spec.md)。

## Replay Studio v2 后端

- `runMatchV2` 可在比赛包生成后通过 `onBundle` 直接接入持久化；每局包含 tick 0 初始检查点。
- `ReplayRepositoryV2` 使用完整 bundle hash 作为不可变文件名，原子写入、重复保存去重，加载和列表时重新校验完整性。
- `createReplayStudioViewV2` 输出面向玩家的双方配置、胜负和关键时刻，不把源码与哈希暴露到默认界面。
- `seekReplayCheckpointV2` 支持定位到目标回合或之前最近的已验证状态。

接口与验收口径见 [Replay Studio v2 规格](docs/product/replay-studio-v2-spec.md)。

## AI 原生接入（首个可运行纵切）

- 外部 Agent：`npm run arena -- mcp` 启动本地 stdio 服务，Codex、Claude Code 等 MCP Host 可发现
  `get_game_context` 与 `evaluate_bot`，后者直接运行真实 v2 沙箱比赛并返回已验证摘要。
- 内置 BYOK：设置 `AGENTIC_GAME_API_KEY` 后运行
  `npm run arena -- agent <bot.js> --model <id> --base-url <兼容端点>`；密钥不写入参数、配置、日志或回放。
- Harness 采用工具白名单、模型轮次/工具调用预算、AbortSignal 和结果脱敏；外部与内置路径共享完全相同的游戏工具。

接入配置、安全边界与当前 provider 范围见
[AI-native Harness v1 规格](docs/product/ai-native-harness-v1-spec.md)。

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
- [x] v0.2 首期玩法纵切：3 种车辆、视野、地形、方向装甲、弹药与机动差异
- [x] SavedBuildV2 配置版本历史；新配置对战旧配置与同版本镜像练习赛 API
- [x] Replay v2 本地不可变仓库、真实 Runner 持久化钩子与玩家侧 Studio 投影
- [x] 据点争夺模式：公开目标区、连续占领、争夺/离开重置、歼灭或占领获胜
- [x] 好友房间 P2P 核心：房主权威会话、自动 Build 同步、真实比赛与 DataChannel 分帧
- [x] 好友房间无服务器 WebRTC 手动 offer/answer 邀请协议
- [x] 好友房间浏览器 WebRTC 建连控制器、直连/STUN/TURN 配置和通道生命周期状态
- [x] 好友房间独立桌面窗口、玩家入口、压缩邀请、战前准备、预设战术、战报同步与再来一局
- [x] 好友房间内断线恢复：新会合邀请接管旧房间，保留 Build 与战报
- [ ] 好友房间二维码、应用重启后的房间恢复与可选信令服务自动重连
- [ ] 排位模式（云端权威原型已封存，等待账号、匹配、安全沙盒与运营条件）
- [ ] 把 v2、配置历史、练习赛和 Replay Studio 接入玩家界面
- [ ] 按 Ardot 实现指挥中心、车库、Agent 中心、战术实验室、战斗和回放工作室
- [x] 外部 Agent MCP 接入 + 内置 OpenAI-compatible BYOK Harness 首个可运行纵切
- [ ] Agent Center UI、Anthropic 原生适配与多 seed 评测矩阵
- [ ] 2v2、更多地图、更多比赛模式与赛季内容

## 常见问题

**为什么 bot 用 JavaScript？** AI 写 JS 最顺、Node 沙盒成熟；好友房间会在 P2P 连接中自动同步
经过验证的 Build，玩家无需处理源码文件。

**平局太多怎么办？** 让你的 AI 更快建立直线火力优势；1500 tick 打满后按 HP 判定，拖时间没有收益。

**我的 AI 说"找不到 spec"？** 规则书在 `docs/tank-spec.md`，直接把整个文件内容发给它。

---

*AgenticGame 系列 #1 · 坦克竞技场 v0.1.0 · 2026-08*
