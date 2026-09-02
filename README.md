# AgenticGame · 坦克竞技场

**游戏优先、代码可选的 AI 原生坦克策略游戏。** 玩家在 Codex、WorkBuddy、Qoder 等熟悉的 Agent
里描述战术，游戏负责可信评测、版本、回放与好友竞技；也可只使用桌面内置战术和 BYOK 教练。

当前的主要创作入口是 Codex、WorkBuddy、Qoder 等外部 Agent：安装包自带独立 Agent Bridge，
Agent 可直接读取玩家版本、修改和真实评测战术、保存新版本并发起新旧版本练习赛。桌面游戏负责
版本查看、回放、好友房间和不使用外部 Agent 时的内置 AI 战术教练。
桌面端已具备本地玩家档案、可恢复首次体验、真实教学战斗、战后复盘、指挥中心、不可变版本车库、
新旧版本/镜像练习赛，以及压缩好友邀请、直连、战前准备、三套预设战术、双方准备、房主自动开赛、
战报同步、再来一局、房间内断线恢复和双方可看的逐回合战术回放。
独立“回放工作室”现已统一收录练习赛与好友赛，支持玩家筛选、完整播放、复盘笔记、应用内导出、
损坏回放隔离，以及保留七天的可恢复回收站。
“整备中心”现已提供声音/动效与好友偏好、七项玩家化运行检查、脱敏报告导出和旧版战术/回放迁移；
Public Beta B 同时提供 Windows x64 便携 ZIP 与当前用户 NSIS 安装包。

## 玩法闭环

```
你 ──> 在 Codex / WorkBuddy / Qoder 里描述想要的战术
     ──> Agent Bridge 自动提供规则、当前版本和真实沙箱评测
     ──> 你确认后，Agent 保存不可变新版本并让它挑战旧版本
     ──> 在游戏的回放工作室查看结果，再告诉 Agent 哪里需要改进
     ──> Agent 继续迭代 …… 直到你认为它够强
     ──> 进入好友房间，配置由游戏自动同步，双方查看同一战报
```

“开局后 AI 不能碰代码”由引擎天然保证：比赛时只在开局加载一次 bot 文件，之后每 tick 只是调用，
不存在热重载通道。回放记录双方代码的 sha256 指纹 + 确定性引擎，任何人都能复现验证比赛真实性。

## 快速开始

当前 Public Beta B Windows 候选位于 `release/AgenticGame-win-x64/AgenticGame.exe`；可直接使用
`release/AgenticGame-0.1.0-win-x64-setup.exe` 安装，或解压
`release/AgenticGame-0.1.0-public-beta-b-win-x64.zip` 的完整目录后运行。安装包未签名，Windows
可能显示 SmartScreen 提示。

安装版和便携版根目录均包含 `AgenticGame-Agent.exe`。先在 PowerShell 生成对应 Agent 的配置，
把输出合并到该 Agent 的 MCP 配置后重启：

```powershell
& "C:\完整路径\AgenticGame-Agent.exe" config codex
& "C:\完整路径\AgenticGame-Agent.exe" config qoder
& "C:\完整路径\AgenticGame-Agent.exe" config workbuddy
```

接入后可直接说：“读取我的 AgenticGame 战术版本，改进据点争夺能力；先评测，等我确认后保存，
再让新版本和旧版本打一场。”不需要把规则书、源码文件或比赛日志手工传给 Agent。

开发环境需要 Node.js ≥ 20：

```bash
npm install

# 正常游戏窗口（好友房间）
npm run desktop

# 生成 Windows x64 可运行目录
npm run pack:desktop-folder

# 生成当前用户 NSIS 安装包
npm run pack:desktop-installer

# 单独生成外部 Agent 使用的 Windows MCP Bridge
npm run build:agent-bridge

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

两台真实 Windows 设备的最终联机验收使用
`scripts/acceptance/friend-room-two-device.ps1`，分别记录局域网、异地邀请和应用重启恢复；脚本不会把
未执行步骤自动写成通过。完整发布说明见 [Public Beta B](docs/releases/0.1.0-public-beta-b.md)。

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

目前桌面车库/练习赛与 TypeScript API 均使用 `runMatchV2`；CLI、旧网页控制台和旧播放器仍是 v1 路径。精确规则与接口见
[Gameplay v2 纵切规格](docs/product/gameplay-v2-vertical-slice-spec.md) 和
[Bot 规则书的 v2 章节](docs/tank-spec.md#11-gameplay-v2-开发者预览)。

## 配置历史与新旧版本练习赛

`SavedBuildV2` 把一个 Bot 的完整源码与车辆/武器/装备装配保存为不可变 revision：

- 本地仓库按 Build ID 保存连续版本，父指纹形成可校验历史链；相同内容重复保存不会产生噪声版本。
- 每个文件同时校验完整源码哈希、内容指纹和记录指纹；损坏或篡改版本不会被静默跳过。
- `runPracticeMatchV2` 可让当前 revision 对战任意历史 revision，也支持同版本镜像自测。
- 练习赛仍走真实 worker 沙盒和 MatchBundleV2，不使用简化模拟器。

桌面端现在提供“我的车库”与“战术实验室”：玩家可调整战车、兼容主炮与预设作战风格，为每次调整
填写名称和说明并保存为不可变版本；版本历史展示字面差异和由已验证回放反推的胜/负/平。练习赛支持
新版本对战旧版本和镜像训练，可选歼灭或据点模式，真实经过 worker 沙盒并保存 Replay v2，只向默认
界面投影胜负、回合数和最多三个关键时刻。损坏历史会停止新保存，但健康版本仍可用；玩家可先导出
脱敏检查报告，再把损坏尾部移动到可恢复隔离区。契约见
[Build 历史与练习赛规格](docs/product/build-history-practice-spec.md)。

这些桌面数据全部位于 Electron `userData`：`profile/` 保存玩家档案，`builds/` 保存不可变配置，
`build-metadata/` 保存玩家说明，`replays/` 保存完整且已验证的练习赛，`public-replays/` 单独保存
不含源码/哈希/动作/日志的好友赛公开回放，`replay-metadata/` 保存复盘笔记，`replay-trash/` 保存
七天可恢复删除，`rooms/` 保存由 Windows 系统加密保护的短期房间恢复信息，`quarantine/` 保存配置隔离数据，
`diagnostics/` 与 `exports/` 保存玩家主动生成的脱敏报告和回放文件。默认页面不显示源码、代码指纹、
原始动作、日志、比赛种子、邀请载荷或文件路径；系统加密不可用时不会退回明文保存房间。

## 双人好友房间（P2P）

首个可玩的 P2P 纵切已经建立：桌面游戏窗口支持创建邀请、接受邀请和交换加入确认；连接成功后，
双方选择三套内置战术之一并准备，客人配置在后台同步到房主设备，仅房主启动一次真实 Gameplay v2
比赛，最终战报和公开回放回传双方。公开回放包含地图、每回合坦克/炮弹/据点状态和关键时刻，
不包含 Bot 源码、代码哈希、原始动作或调试日志。默认玩家界面不显示协议名或连接参数。

`FriendDataChannelPeerV1` 已支持大消息分帧与重组；`AGFR2` 使用 gzip + Base64URL 压缩手动邀请，
同时兼容旧 `AGFR1` 邀请。底层采用无需自有游戏服务器的手动邀请确认，
默认只使用公共 STUN 帮助发现公网地址，不使用中继。严格 NAT 下仍可能无法直连，这是无自有 TURN
时的明确边界。同一局域网内，“附近好友”会在页面开启期间使用临时 UDP 广播发现房主并交换 WebRTC
邀请/确认；实际比赛数据仍只走双方 DataChannel，离开页面立即停止广播。连接中断或应用重启后，
24 小时内可从 Windows 加密恢复信息回到原房间，再建立一条新的连接；双方必须同时在线，恢复不会
伪装成自动联网。双方 Build 和已完成战报保留，未开赛的准备状态会安全清除。房主明确离开会通知好友
房间已关闭并清除恢复信息。页面还提供不泄露邀请、地址或密文的一键连接检查。二维码仍待接入；
短房间码或完全自动重连若用于公网，需要一个只负责牵线的轻量信令服务，不是比赛服务器。
规格见 [好友房间 P2P 规格](docs/product/friend-room-p2p-v1-spec.md)。原服务器权威实现已
[封存为未来排位原型](docs/product/async-room-v1-spec.md)。

## 回放工作室

- `runMatchV2` 可在比赛包生成后通过 `onBundle` 直接接入持久化；每局包含 tick 0 初始检查点。
- `ReplayRepositoryV2` 使用完整 bundle hash 作为不可变文件名，原子写入、重复保存去重，加载和列表时重新校验完整性。
- `createReplayStudioViewV2` 输出面向玩家的双方配置、胜负和关键时刻，不把源码与哈希暴露到默认界面。
- `seekReplayCheckpointV2` 支持定位到目标回合或之前最近的已验证状态。
- 桌面端把练习赛与好友赛投影成同一种玩家回放；来源、模式、结果、版本和文字搜索均可筛选。
- 损坏文件只影响自己的卡片，不会隐藏其他健康战报；完整比赛包始终留在主进程，Renderer 只收到
  公开战场帧、参战者、结果与关键时刻。
- 玩家可保存复盘笔记、导出应用自有目录中的回放文件，把回放移到七天回收站并恢复；清空操作
  需要再次确认，所有删除目标均由回放编号解析而不是由页面传入路径。

接口与验收口径见 [Replay Studio v2 规格](docs/product/replay-studio-v2-spec.md)。

## AI 原生接入

- 外部 Agent：发行包内 `AgenticGame-Agent.exe mcp` 启动本地 stdio 服务，不监听网络端口、不依赖
  Node 或项目源码。Codex、WorkBuddy、Qoder 等 MCP Host 可发现六个工具：读取游戏规则、临时评测、
  读取玩家工作区、保存不可变版本、运行新旧版本练习赛、读取已验证战绩。
- Agent Bridge 默认和桌面游戏共享 `%APPDATA%\AgenticGame`，Agent 保存的版本与练习赛会直接出现在
  游戏车库和回放工作室；源码开发时仍可使用 `npm run arena -- mcp`。
- 内置 BYOK：设置 `AGENTIC_GAME_API_KEY` 后运行
  `npm run arena -- agent <bot.js> --model <id> --base-url <兼容端点>`；密钥不写入参数、配置、日志或回放。
- Harness 采用工具白名单、模型轮次/工具调用预算、AbortSignal 和结果脱敏；外部与内置路径共享完全相同的游戏工具。
- 桌面“AI 战术教练”支持 OpenAI-compatible 与 Anthropic Messages：选择现有版本、填写本次密钥和玩家目标，
  先完成固定 3/5/10 场真实沙盒评测，再由玩家明确保存为新的不可变 revision。密钥只驻留当前运行内存，
  Renderer 状态、档案、战报、诊断和候选结果均不保存密钥、源码、原始 transcript 或 provider 响应。

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
- [x] 好友赛完整公开回放：逐回合地图、单位、炮弹、目标状态与关键时刻，双方同步且不泄露源码
- [x] 桌面基础与首次体验：本地档案、真实教学战斗、可恢复进度、战后复盘、指挥中心与键盘模态焦点
- [x] 好友房间局域网临时发现、应用重启后的加密恢复、显式关闭与脱敏连接诊断
- [ ] 好友房间二维码与可选信令服务自动重连
- [ ] 排位模式（云端权威原型已封存，等待账号、匹配、安全沙盒与运营条件）
- [x] 把 v2 配置历史、新旧/镜像练习赛和关键时刻投影接入玩家界面
- [x] Replay Studio 回放库、好友赛公开回放持久化与完整逐回合桌面入口
- [x] Agent Center：OpenAI-compatible / Anthropic BYOK、取消、脱敏、3/5/10 场评测与确认保存
- [x] 外部 Agent MCP 主入口：独立 EXE、六工具版本/评测/练习赛闭环与 Codex/Qoder/WorkBuddy 配置生成
- [ ] 桌面内一键接入向导与更多评测对手/模式
- [ ] 2v2、更多地图、更多比赛模式与赛季内容

## 常见问题

**为什么 bot 用 JavaScript？** AI 写 JS 最顺、Node 沙盒成熟；好友房间会在 P2P 连接中自动同步
经过验证的 Build，玩家无需处理源码文件。

**平局太多怎么办？** 让你的 AI 更快建立直线火力优势；1500 tick 打满后按 HP 判定，拖时间没有收益。

**我的 AI 说"找不到 spec"？** 规则书在 `docs/tank-spec.md`，直接把整个文件内容发给它。

---

*AgenticGame 系列 #1 · 坦克竞技场 v0.1.0 · 2026-08*
