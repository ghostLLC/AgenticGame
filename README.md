# AgenticGame · 坦克竞技场

用战术指挥战车，在真实比赛与回放中改进它。可以直接使用三套内置战术，也可以让 Codex、WorkBuddy、Qoder 经本地 Agent Bridge 编写和评测策略，或使用桌面内置的自带密钥 AI 教练。

当前版本 **0.1.1 · Public Beta B 修复候选**，面向 Windows x64。它修复了 0.1.0 安装后出现的 `Cannot find module './impl/format'` 主进程启动故障，并补齐数据恢复、比赛规则、回放交互与打包验收。候选仍未签名；清洁 Windows 安装/升级/卸载、真实双设备联机和新手体验验收尚待完成，未发布为稳定版。

## 开始游戏

- 安装版：`release/AgenticGame-0.1.1-win-x64-setup.exe`。
- 便携版：解压 `release/AgenticGame-0.1.1-public-beta-b-win-x64.zip` 的完整目录，运行其中的 `AgenticGame.exe`。
- 完整性清单与 SHA-256 位于同一 release 目录。候选文件由本地打包或 GitHub Actions 生成，源码仓库不提交 EXE/ZIP。

首次打开：填写昵称 → 选择侦察/中型/重型战术 → 完成教学战斗 → 查看复盘。游戏会建立首个可用版本；只有一个版本时也能运行镜像训练。

**0.1.0 无法启动时**，关闭旧程序，使用完整 0.1.1 候选安装包更新，或从完整便携目录启动。无需删除玩家资料。默认资料位于 `%APPDATA%\AgenticGame`；安装器配置保留卸载后的玩家数据，但跨版本安装流程仍需实际验收。不要只复制主 EXE，运行时、ASAR 与 Agent Bridge 都属于完整安装。

## 玩什么

| 入口 | 可以完成的事 |
|---|---|
| 指挥中心 | 查看真实当前战车、当前版本和最近战斗，进入下一场训练 |
| 我的车库 | 调整车辆与火炮，保存不可变版本、修改说明、查看历史战绩 |
| 战术实验室 | 新版本对旧版本或镜像训练，选择歼灭/据点模式，可取消 |
| 好友房间 | 邀请在线好友、选择自己的已保存版本或内置战术、双方准备、比赛与再来一局 |
| 回放工作室 | 筛选与分页、独立播放器、0.5/1/2/4 倍播放、逐帧、关键时刻、战车状态与复盘笔记 |
| AI 战术教练 | 接入外部 Agent；或使用自带密钥的内置教练进行 6/12/24 场配对评测 |
| 整备中心 | 玩家偏好、运行检查、脱敏诊断与旧资料迁移 |

车库默认保留外部 Agent 保存的自定义策略。勾选“替换为所选预设战术”才替换策略源码。外部 Agent 在你编辑期间保存了新版本时，游戏会保留草稿并提示重新对齐，避免覆盖新内容。只改版本说明也会保存，不必伪造一个新战术版本。

回放播放器支持左右键逐帧、空格播放/暂停、Esc 返回。小窗口和放大界面时仍保留可滚动导航；确认弹窗支持键盘焦点约束和退出后的焦点恢复。

## 分享与本机数据

“分享公开回放”使用原生另存为对话框，导出 `.agentic-replay`：不含策略源码、原始动作和运行日志。“完整备份（含代码）”导出 `.agentic-backup`，适合你自己保管。可通过“导入回放”导入这两类文件，校验损坏或篡改会拒绝，重复导入不产生副本。

正常回收站记录保留七天，支持恢复和明确确认后清空。搬移、恢复中途退出会在下次访问时续接；冲突或损坏记录保留现场并提示，不自动删除原文件。Build、复盘说明与档案使用独占写入和原子保存；档案可从最近有效副本恢复。

| 玩家目录 | 内容 |
|---|---|
| `profile/`、`builds/`、`build-metadata/` | 档案、不可变战术版本、版本说明 |
| `replays/`、`public-replays/`、`replay-metadata/` | 完整比赛包、公开回放、复盘笔记 |
| `replay-trash/`、`quarantine/` | 可恢复回收站与损坏历史隔离 |
| `evaluations/` | AI 配对评测的源码、地图、种子与逐场指标；属于私有资料 |
| `diagnostics/`、`exports/` | 脱敏诊断与默认导出 |

## 连接 AI 队友

安装包根目录包含 `AgenticGame-Agent.exe`。在“AI 战术教练 → 连接我的 AI 队友”选择 Codex、WorkBuddy 或 Qoder，按向导接入后重启对应工具。

“已配置”表示配置文件已写入且回读成功，**尚不能证明客户端完成握手**。需要在对应客户端确认能发现游戏工具。向导备份并保留其他配置；解析错误或检测到并发修改会中止写入。实际 Host 配置改写验收仍独立于隔离目录测试。

高级用户可生成配置后手动合并：

```powershell
& "C:\完整路径\AgenticGame-Agent.exe" config codex
& "C:\完整路径\AgenticGame-Agent.exe" config workbuddy
& "C:\完整路径\AgenticGame-Agent.exe" config qoder
```

接入后可说：“读取我的战术版本，改进据点争夺能力。先评测，等我确认后保存，再与旧版本打一场。”Bridge 提供六个工具：读取规则、评测策略、读取玩家工作区、保存战术版本、运行练习赛、读取战绩。它只通过本地 stdio 工作。

内置教练支持 OpenAI-compatible 与 Anthropic 接口。密钥只在当前任务内存中使用，不保存到档案；候选须经过不同出生方向、固定种子、两张地图与原版/侦察/重型对手的配对评测，玩家确认后才保存。评测是有限基准，不能保证策略全面更强。真实付费厂商调用尚未验收。

## 当前比赛规则与兼容性

桌面路径使用 Gameplay v2、**ruleset 2.1.0**：三类车辆、有限弹药、装填与射程、方向装甲、视野、墙体/森林/泥地，以及据点争夺。每回合双方提交移动、车体转向、炮塔转向和开火动作。

- 移动同时结算；同一目的地、交换位置、进入本回合开始时被占据的格子均阻止移动。
- 歼灭模式到时未分胜负则平局，不再比较不同车型的原始剩余 HP。
- 据点模式可通过连续占领获胜；到时只在存在单方有效占领进度时判定领先方获胜，否则平局。
- 历史 2.0.0 比赛继续按旧规则回放/运行；保存的旧策略源码不会被升级程序静默替换。

完整接口见 [Bot 规则书](docs/tank-spec.md)。`arena` CLI、旧网页控制台和 `viewer/` 是 **legacy v1** 教学/开发入口，采用不同规则；`src/online/` 为封存的云端排位原型，不在好友房间运行路径。

好友模式由房主设备执行，双方基于互信，房主会收到客人战术源码。公开回放省略源码不等于好友协议对房主保密。

## 执行安全

策略在独立子进程内由固定版本 QuickJS/WASM 解释执行，通过序列化数据交换；不暴露宿主对象、文件/网络 API 或真实时间。源码、输出、日志、堆栈、解释器内存和执行时间有上限，取消/超时会终止策略进程。

尚未实现 Windows Restricted Token、AppContainer 或 Job Object 整进程资源约束，不能称为操作系统级恶意代码隔离；公开对抗性服务上线前需要进一步加固。详见 [运行边界](docs/engineering/runtime-security.md)。

## 开发与验证

Node.js **22 或更高**；推荐使用锁文件安装：

```powershell
npm ci
npm run desktop
npm run typecheck
npm test
npm run build
npm audit --omit=dev
npm run pack:desktop-folder
node scripts/acceptance/desktop-smoke.mjs
node scripts/acceptance/agent-bridge-smoke.mjs release/AgenticGame-win-x64/AgenticGame-Agent.exe
npm run pack:desktop-installer
```

Windows CI 执行同一质量与候选链，生成未签名候选附件，不自动发布 Release。`desktop-smoke.mjs` 启动包内主进程、preload 和 renderer，验证可信 IPC 初始化，并由包内独立策略进程完成真实教学战斗。它不替代界面走查和安装流程。

本轮自动验证：**66 个文件 / 312 项测试**、类型检查、编译和生产依赖审计通过。规模实验在 1,000 场回放上测得热列表约 50ms，500 个版本加 1,000 场回放的车库读取约 360ms；首次冷校验仍约 3.6s，环境和口径见 [性能记录](docs/engineering/2026-09-05-performance.md)。

开发入口 `npm run arena -- demo` / `play` / `maps` / `mcp` 保留；legacy 打包输出到 `dist/legacy-cli/`，避免擦除桌面资源。候选隔离验收可用 `--agentic-data-dir=<绝对路径>`，避免改变实际玩家档案。

| 目录 | 职责 |
|---|---|
| `src/core/`、`src/runner/` | 确定性引擎、规则版本、对局驱动 |
| `src/runtime/` | QuickJS/WASM 子进程、预算与取消 |
| `src/storage/` | 写入互斥、原子文件、恢复记录与并发限流 |
| `src/config/`、`src/replay/` | 不可变版本与完整比赛包 |
| `src/desktop/` | Electron 主进程、严格 IPC、服务及界面 |
| `src/agent/`、`src/friend-room/` | 本地 MCP / AI 与好友协议 |
| `tests/`、`scripts/acceptance/` | 回归测试与产物验收 |

## 项目记录

- [0.1.1 修复与候选验收](docs/releases/0.1.1-quality-repair.md)
- [完整审查与改进方案（历史基线）](docs/audits/2026-09-05/审查与改进方案.md)
- [修复工作记录](docs/engineering/2026-09-05-quality-repair.md)
- [产品与治理](docs/product/product-governance.md)
- [Windows 可信签名流程](docs/releases/windows-signing.md)
- [飞书知识库](https://ccnhvg4zam5u.feishu.cn/wiki/space/7677277411628567488)
- Ardot 文件：`cocraft://localhost/file/718070578872647`
- [Ardot 0.1.1 待同步清单（连接阻断）](docs/product/0.1.1-ardot-handoff.md)

Public Beta B 的外部验收通过后再评估商业化 C 阶段。当前没有新增账号系统、云端排位或付费服务。
