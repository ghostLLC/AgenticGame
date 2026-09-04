# AgenticGame · 坦克竞技场 —— 项目说明与交接文档

> 本文档面向**接手本项目的下一位 AI agent**（或协作者）。包含：
> 完整玩法逻辑、代码架构、当前进度、已验证项、已知问题、打包指引、以及下一步路线图。
> 所有内容截至 2026-09-04 实际完成与验证状态，请以此为准。

---

## 一、一句话定位

**游戏优先、代码可选的 AI 原生坦克策略游戏。** v0.1 是可玩的 1v1 编程坦克基线；v0.2 将普通玩家、
外部 Agent 和内置 BYOK Harness 放进同一个可版本化、可复现的规则世界。

第一作是 **坦克竞技场**（RoboCode 精神续作，但参赛选手从人类程序员换成了 coding agent）。

---

## 二、完整玩法逻辑（三件事怎么串起来）

### 1. 三方角色与数据流

```
┌──────────────┐  读 docs/tank-spec.md   ┌──────────────────┐
│ 你的 AI agent │ ─────────────────────> │  my-tank.js      │ ← 代码就此冻结，上场不许碰
└──────────────┘                          └────────┬─────────┘
                                                    │ 开赛前一次性加载
    教练（你）                                       ▼
      │  看回放 → 指出问题 → 让 AI 改    ┌────────────────────┐
      ▼                                  │   比赛驱动器 runner  │
┌──────────────┐                          │  ┌────────┐ ┌──────┐  │
│ 网页回放播放器 │ <── 回放 JSON（逐帧+事件+日志）──│ 沙盒A  │ │ 沙盒B │ │
└──────────────┘                          │  └───┬────┘ └──┬───┘  │
                                          │      │ 动作     │      │
                                          │  ┌───▼─────────▼───┐  │
                                          │  │   确定性引擎      │  │
                                          │  └─────────────────┘  │
                                          └────────────────────┘
```

三层职责**严格分离**，这是整个项目的地基：

- **引擎 `src/core/`**：纯函数战场模拟器。不碰网络、不碰文件、无随机数、无 IO。
  同样的输入永远算出同样的输出 → 回放可复现、比赛防作弊、不需要信任任何服务器。
- **沙盒 `src/runtime/`**：bot 的牢笼。每个 bot 跑在**独立 worker 线程的白名单 VM** 里，
  全局环境无 `require`/网络/文件/`Date`，`Math.random()` 被替换成抛错。
  主线程给多少、它算多少；算超时或算崩了，引擎照常推进（它那个 tick 就地"发呆"）。
- **驱动器 `src/runner/`**：裁判。每 tick 把战场快照同时发给两个沙盒，收双方动作
  （30ms 内没交卷记违规、判发呆），交给引擎结算，把每帧快照 + 事件写进回放。

> **"开局后不能改代码"是架构天然保证**：比赛只在开局加载一次 bot 文件，之后每 tick 只是调用，
> 没有任何热重载接口。回放里记录双方代码的 sha256 指纹，任何人可重跑验证。

### 2. 游戏逻辑：一个 tick 内发生什么

双方每 tick **同时**提交一个复合动作 `{throttle, bodyTurn, turretTurn, fire}`
（四项独立生效：可以边转车体、边转炮塔、边前进、边开火）。引擎按**固定顺序**结算：

```
0 冷却衰减 → 1 转向 → 2 移动 → 3 炮弹推进 → 4 开火 → 5 死亡清算 → 6 tick+1
```

**关键规则数值**（集中在 `src/core/constants.ts` 的 `DEFAULT_RULES`，改一处全局生效）：

| 数值 | 默认值 | 说明 |
|------|--------|------|
| `fieldWidth` / `fieldHeight` | 32 / 24 | 标准战场尺寸 |
| `maxHp` | 100 | 3 发炮弹击毁（34×3=102） |
| `bulletDamage` | 34 | 每次命中伤害 |
| `bulletSpeed` | 2 | 炮弹每 tick 前进 2 格，逐子步、逐格判定，**无限射程** |
| `fireCooldown` | 4 | 开火后间隔 4 tick 才能再开 |
| `maxTicks` | 1500 | 回合上限，打满按 HP 判定（HP 相同平局） |
| `tickBudgetMs` | 30 | 每次 `onTick` 的响应时限（超时计违规） |
| `maxViolations` | 30 | 累计违规上限，达到判负 |

从结算顺序推出的**三条核心博弈事实**（规则书专门强调，AI 必须理解才能真正变强）：

1. **直线法则**：炮弹只走八方向直线。双方必须处于 `dx=0`、`dy=0` 或 `|dx|==|dy|`
   的直线关系上才互相打得着。走位的本质 = 抢直线、断直线。
2. **移动打偏**：你的决策用的是移动前的坐标，炮弹却从**移动后**的位置发射（第 2 步移动在
   第 4 步开火之前）。所以边跑边打必然脱靶 → 想命中先站定。这是最反直觉、也最影响强度的一条。
3. **当 tick 闪避**：炮弹第 3 步才推进，你第 2 步已经动了。看见炮弹贴脸侧移一格是真实有效的。

**胜负判定**：击毁对手 / 打满 1500 tick 比 HP / 对方违规满 30 次（超时、抛错、返回非对象各一次）/
对方沙盒崩溃（死循环）。犯规不崩比赛，只惩罚犯规方——引擎永远能跑完一局。

### 3. AI 操作逻辑：一个 bot 的一生

```
局面：bot 是单文件 JavaScript（CommonJS），必须导出工厂函数
```

```js
module.exports = function createTank(ctx) {
  // ctx = { field:{width,height}, obstacles:[{x,y,w,h}], rules, myId:0|1, rng() }
  // 闭包里的变量跨 tick 保留 —— 这就是 bot 的"记忆"
  let lastFoe = null;

  return {
    name: 'My Tank',            // 展示名（可选）
    onTick(view) {              // 每 tick 引擎调一次，必须在 30ms 内返回动作对象
      // view = { tick, field, self: 我全状态, enemy: 敌人全状态（完全信息，互相可见）,
      //          bullets: 场上所有炮弹, rules }
      return {
        throttle: 1,    // 1 前进 / -1 后退 / 0 不动（沿车体朝向移动 1 格）
        bodyTurn: 0,    // +1 顺时针 45° / -1 逆时针 45° / 0
        turretTurn: 0,  // 炮塔独立转向，±1 转 45° / 0
        fire: false,    // 朝炮塔当前方向开火（冷却中自动忽略，不算错误）
      };
    },
  };
};
```

- **记忆 = 闭包**：`createTank` 里声明的变量跨 tick 保留（上例的 `lastFoe` 用来记敌人上帧位置估速度）。
- **调试通道**：bot 里的 `console.log` 被沙盒收集（每 tick 5 行、每局 300 行上限），写进回放，
  播放器里能直接看——"我为什么没开火"靠它诊断。
- **违规惩罚**：超时/抛错/返回非对象 → 该 tick 动作视为发呆 + 计一次违规；累计 30 次判负；
  死循环卡死沙盒直接判负。
- **坐标注意**：x 向右、y 向下（屏幕习惯）；方向 0~7 整数，每 +1 顺时针 45°；
  距离多用切比雪夫距离 `max(|dx|,|dy|)`。

---

## 三、代码架构（目录与关键文件）

```
src/
  config/
    saved-build-v2.ts             严格 SavedBuildV2 契约、内容/记录双指纹与篡改校验
    saved-build-repository-v2.ts  本地不可变 revision、父链验证、幂等保存与原子发布
  core/           确定性模拟内核（纯函数，无 IO）
    types.ts      全部类型（TankAction / TankState / BattleView / GameState / Rules / Replay…）
    constants.ts  DEFAULT_RULES 数值 + 方向表(DIRS) + 转向/角差工具
    maps.ts       官方地图（standard / pillars），中心点对称生成
    engine.ts     createGame / step（单 tick 结算）/ validateAction（钳制非法输入）
    v2/
      json.ts         确定性 JSON 与完整 SHA-256
      content.ts      车辆/武器/地形/模式/地图/Bot 内容定义
      match-config.ts 严格 MatchConfigV2 校验、断言与指纹
      gameplay-content.ts  三车辆/三武器/四地形与 frontier-v2 官方内容
      gameplay-engine.ts   真实 v2 结算：雾区、机动、方向装甲、弹药、射程和胜负
  runtime/        bot 沙盒与资源路径
    bot-worker.mjs   worker 侧：白名单 VM 环境、Math.random→抛错、console 收集、工厂加载
    sandbox.ts       主线程侧 BotRunner：worker 生命周期、30ms 超时、崩溃检测、代码提取(pkg)
    paths.ts         资源路径双模式解析（dev:tsx 用 import.meta / 打包:__dirname 用虚拟FS）
  runner/
    match.ts        对局驱动：内核×沙盒×回放记录；违规/崩溃判负；RNG 种子派生
    v2-adapter.ts   把真实 v1 对局映射为 MatchBundleV2（配置/地图/内容/源码/时间线/完整性）
    match-v2.ts     v2 引擎×沙盒 Runner：过滤视野、动作回退、权威时间线与 MatchBundleV2
  practice/
    run-practice-match-v2.ts  把两个 SavedBuild revision 组装为真实 Gameplay v2 练习赛
  friend-room/
    session-v1.ts             好友房间 P2P 协议、房主权威状态机、Build 同步与真实比赛
    replay-v1.ts              从已验证 Bundle 生成无源码/哈希的逐回合公开回放
    data-channel-peer-v1.ts   DataChannel 大消息分帧、重组与边界校验
    webrtc-handshake-v1.ts    无服务器 offer/answer 邀请串、ICE 等待与会话绑定
    browser-connection-v1.ts  浏览器 RTCPeerConnection 工厂、ICE 配置与连接状态机
  desktop/
    main.ts                   Electron 独立窗口、安全 IPC 与房间比赛运行时托管
    preload.ts                最小化剪贴板/好友房间桥接，不向页面开放 Node 权限
    renderer.ts               指挥中心、车库、练习赛、好友房间与战报交互
    garage-service-v1.ts      玩家车库投影、版本差异/战绩、损坏历史恢复入口
    practice-match-service-v1.ts  新旧/镜像真实练习赛、Replay v2 落盘和脱敏结果
    build-revision-note-repository-v1.ts  版本说明与预设战术的不可变原子仓库
    friend-room-runtime-v1.ts 三套预设战术、Build 同步和房主真实比赛接线
    friend-room-replay-controller-v1.ts  回放打开、跳转、播放与结束状态机
  online/
    async-room-service-v1.ts  已封存：未来排位的云端权威双席位房间原型
    async-room-http-v1.ts     已封存：未来排位 `/api/rooms` HTTP 原型
  replay/
    format.ts       回放自包含格式（地图+规则+代码指纹+逐帧快照+事件+日志）
    v2.ts           完整 Match Bundle v2 创建、时间线约束与篡改校验
    repository-v2.ts  MatchBundleV2 不可变原子落盘、幂等保存、回读校验与列表索引
    studio-v2.ts      玩家侧回放摘要、关键时刻与逐回合检查点定位
  agent/
    harness-v1.ts     provider-neutral 受限工具循环、白名单、预算与敏感值脱敏
    game-tools-v1.ts  共享游戏工具；真实 v2 沙箱评测并验证 MatchBundleV2
    mcp-server-v1.ts  外部 Agent MCP 工具服务
    providers/        内置 BYOK 模型适配器（首批 OpenAI-compatible）
  server/
    ui.ts           HTTP 控制台服务（页面 + /api/play /api/upload /api/bots /api/replays /api/spec）
    console.html    控制台前端页面（拖拽上传、选bot、开战、结果、历史）
  cli/
    index.ts        arena 命令行入口（play/self/validate/serve/demo/maps/ui，无参默认ui）

viewer/index.html        网页回放播放器（单文件、canvas 渲染、逐帧/调速/事件流/日志、支持 ?replay=）
bots/                    4 个内置基准 bot（也是给 AI 的教学示例）
docs/tank-spec.md        规则书（本项目核心资产，写给 AI 读的）
tests/engine.test.ts     引擎单元测试 17 项（含确定性复现、地图对称性、边界钳制）
tests/match.test.ts      Runner/沙盒集成测试 4 项（加载失败、双格式确定性、v2 时间线、死循环判负）
tests/core-v2-json.test.ts    确定性 JSON 测试 6 项
tests/core-v2-config.test.ts  MatchConfigV2 测试 17 项
tests/replay-v2.test.ts       Match Bundle v2 测试 11 项
tests/gameplay-v2-content.test.ts  官方玩法内容与完整地图测试 2 项
tests/gameplay-v2-engine.test.ts   v2 机动、地形、视野、装甲、弹药与胜负测试 10 项
tests/match-v2.test.ts             真实 v2 沙盒比赛与 Bundle 集成测试 2 项
tests/saved-build-v2.test.ts            SavedBuild 严格契约、篡改与非 JSON 输入检测 5 项
tests/saved-build-repository-v2.test.ts 本地 revision 仓库与父链/原子写入测试 4 项
tests/practice-match-v2.test.ts         新打旧、篡改拒绝与镜像自测 3 项
tests/replay-repository-v2.test.ts      真实比赛落盘、幂等、篡改与路径防护 3 项
tests/replay-studio-v2.test.ts          玩家摘要、回合定位与完整性拒绝 3 项
scripts/pack.mjs         打包脚本（esbuild + @yao-pkg/pkg → arena.exe）
```

---

## 四、当前进度（截至 2026-09-01）

### ✅ 已完成并验证
- **引擎**：确定性 tick 结算（移动/开火/炮弹逐子步判定/碰撞/死亡/平局/超时），17 项单元测试全过
- **Runner/沙盒集成**：3 项测试覆盖内联 Bot 加载失败、同 seed 对局确定性、死循环 Bot 崩溃判负
- **沙盒**：worker + VM 白名单、`Math.random`→抛错、时间预算、违规惩罚、卡死判负、日志收集
- **回放**：自包含 JSON（地图+规则+代码指纹+逐帧快照+事件+双方日志），确定性可复现
- **CLI**：`play / self / validate / serve / demo / maps`，其中 `validate` 会跑完整加载检查+120 tick
  靶机测试并给出"通过/存在问题"结论（问题项 exitCode=2）
- **GUI 控制台**（本次新增）：`npm run arena -- ui`（或无参数直接 `ui`）
  - 页面：选 bot（内置基准 + 用户上传）、选地图/种子/回合上限、一键开战
  - 支持**拖拽 .js 上传**、一键"复制规则书"、内置示例对决按钮
  - `/api/play` 后台跑完整对局返回比分 + 回放地址，页内跳转 `?replay=` 观看
  - 用户 bot 存 `./my-bots/`，回放存 `./replays/`（相对工作目录）
- **viewer**：已验证 `?replay=` 参数正确加载对局、显示比分/回合/代码指纹
- **强度阶梯**：实测 9 组对战矩阵确认 `sitting-duck < random < sniper < chaser`
- **多 seed 一致性**：chaser vs sniper 用 seed 7/42/99 结果稳定（Chaser 满血胜）
- **Windows 单文件 EXE**：`arena.exe` 已成功生成并实测；CLI、网页控制台、打包资源、临时 Worker
  释放、完整对战和回放读取均正常（Windows x64，约 57.6 MB）
- **Core v2 基础契约**：数据化车辆/武器/地形/模式/地图/Bot 快照；严格 `MatchConfigV2`；
  完整 `MatchBundleV2`，覆盖配置、内容、地图、源码、动作、事件、检查点、日志和结果的完整性哈希。
- **Replay v2 运行时接入**：`runMatch` 现在同时返回兼容 Replay v1 与真实 `MatchBundleV2`；v2 包嵌入双方完整源码并记录实际动作、事件、状态检查点和日志，可直接进行完整性校验。
- **Gameplay v2 首期玩法纵切**：新增独立 `GameplayEngineV2` 与 `runMatchV2`；侦察/中型/重型车辆、森林/泥地/墙体、过滤视野、方向装甲、有限弹药、装填、射程、加减速和转向节奏均进入真实确定性结算。
- **v2 沙盒比赛**：两个真实 worker Bot 接收过滤后的 `BattleViewV2`，比赛直接生成包含完整内容、地图、源码、动作、事件、检查点、日志和结果的可验证 MatchBundleV2。
- **SavedBuildV2 配置历史**：Bot 完整源码与装配保存为不可变 revision；内容/记录双指纹、连续父链、路径防穿越、幂等保存与同目录原子发布均已实现。
- **新旧版本练习赛**：`runPracticeMatchV2` 支持当前 revision 对战任意历史 revision，以及同版本镜像自测；比赛复用真实 Gameplay v2 沙盒与 Bundle 路径。
- **Replay Studio v2 后端**：真实 Runner 可通过 `onBundle` 原子保存不可变比赛包；仓库按 bundle hash 去重并在加载/列表时验证完整性；玩家侧投影提供配置、结果和关键时刻，默认不暴露源码与哈希。
- **据点争夺模式**：`capture` 模式与 `frontier-v2@2.1.0` 中央目标区已进入真实引擎；连续占领 30 tick、双方争夺/离开重置、歼灭优先、Bot 公开目标上下文与 Replay Studio 关键时刻均已实现。
- **外部 Agent 主入口**：Windows 发行包自带独立 `AgenticGame-Agent.exe` MCP stdio Bridge，无需源码、Node、端口或 API Key。Codex、WorkBuddy、Qoder 可读取规则与玩家工作区、真实评测、保存不可变 revision、运行新旧版本练习赛并读取脱敏战绩；默认与桌面游戏共享用户数据，Server instructions 和工具 annotations 明确工作流与读写边界。
- **一键接入向导**：桌面“AI 战术教练”会检查 Codex、WorkBuddy、Qoder 是否已安装及 AgenticGame 是否已接入；玩家点击对应按钮后才执行原位合并。Codex 的 TOML 和 Qoder/WorkBuddy 的 JSONC 均保留其他设置与注释，只替换 AgenticGame 自己的条目；既有文件首次修改前创建 `.before-agenticgame.bak`，写入采用同目录临时文件、同步落盘和原子替换，损坏配置保持不变。Renderer 只收到玩家化状态，不接收路径或配置正文。
- **内置 AI 闭环**：统一 Tool Registry 与外部 Agent 复用真实沙箱；桌面 BYOK 支持 OpenAI-compatible / Anthropic、严格工具白名单、轮次/调用预算和密钥脱敏。
- **好友房间 P2P 首期纵切**：`FriendRoomHostSessionV1` 由房主设备权威维护状态并执行真实 Gameplay v2；客人 Build 通过 `FriendRoomPeerV1` 自动同步，双方收到脱敏结果投影。`FriendDataChannelPeerV1` 已覆盖 Unicode 大消息分帧/重组、上限校验和通道生命周期；`webrtc-handshake-v1` 已覆盖无服务器手动 offer/answer、ICE 等待、方向与会话校验；`FriendRoomBrowserConnectionV1` 已接入真实浏览器 RTCPeerConnection、直连/STUN/TURN 配置与连接状态机。
- **好友房间桌面可玩纵切**：Electron `BrowserWindow` 已替代“启动本地服务再打开浏览器”的玩家路径；`AGFR2` 将邀请与加入确认压缩为 gzip + Base64URL，并兼容旧 `AGFR1`。玩家进入战前准备后选择游骑侦察、中线突击或钢铁堡垒战术，双方准备即由房主设备运行真实比赛并同步同一战报；赛后双方确认即可保留连接与战术再来一局。若 DataChannel 中断但应用仍在运行，房主可用同一 `sessionId` 生成新会合邀请，新连接接管原房间并保留双方 Build 和既有战报；未开赛的准备状态会清除。房主还会从已校验 Bundle 生成无源码/哈希的公开回放，向双方同步地图、每 tick 单位/炮弹/据点状态和关键时刻，桌面端以战术地图、时间轴和播放控件呈现。页面不开放 Node 权限，默认文案不暴露底层联机术语。
- **Public Beta Slice 1 桌面基础**：玩家档案保存到 Electron `userData`，采用临时文件、同步落盘、原子替换和损坏隔离；首次进入完成昵称、作战风格、真实 Gameplay v2 教学战斗、战后复盘后进入指挥中心，重启可从已保存阶段恢复。Renderer 仅使用五个白名单 IPC 能力，背景在引导期间设为 inert，1440×900 与 1100×700 无横向溢出。
- **Public Beta Slice 2 车库与练习赛**：桌面端已开放“我的车库”和“战术实验室”。每次配置保存形成不可变 revision，玩家可查看字面差异、说明和由已验证 Replay v2 反推的战绩；损坏尾部不会被读取或覆盖，可导出脱敏报告后移动到隔离区。新旧版本与镜像训练均走真实 Gameplay v2 worker 沙盒，可选歼灭/据点模式，比赛包原子保存，默认结果只含胜负、回合数和最多三个关键时刻。IPC 扩展为固定白名单，没有通用调用器或文件路径入口。
- **Public Beta Slice 3 回放工作室**：练习赛完整 Bundle 与好友房公开回放分根保存；好友房双方在完整比赛状态首次到达时各自幂等落盘，重赛形成新记录，保存失败不污染比赛结果。桌面回放库支持来源/模式/结果/版本/文字筛选、完整逐回合统一播放器、复盘笔记、应用内导出、损坏项独立呈现、七天可恢复删除与明确确认清空。Renderer 不接收完整比赛包，也没有路径型删除或导出入口。
- **Public Beta Slice 4 附近好友与安全恢复**：同一局域网内可在好友页面开启期间临时发现房主并交换 WebRTC 邀请/确认，比赛数据仍走 DataChannel；离开页面立即停止 UDP 广播。应用重启后可在 24 小时内从 Electron `safeStorage` 加密胶囊恢复原房间身份、自己的 Build 与公开状态，再由双方在线建立新连接；系统加密不可用时禁用恢复且不存明文。房主明确离开会通知对方房间关闭并清除恢复。七项连接检查仅返回玩家化结论，不暴露地址、邀请、密文、源码或路径。
- **Public Beta Slice 5 AI 战术教练**：桌面玩家选择已验证 Build、AI 厂商、本次密钥、目标与 3/5/10 场评测强度；Provider 支持 OpenAI-compatible Chat Completions 和 Anthropic Messages，并统一限制 HTTPS/精确 loopback、请求时长与响应大小。Harness 先生成并单局验证候选，再用真实 Gameplay v2 worker 让候选对战所选 Build；可停止剩余评测，候选只驻留内存，玩家明确确认后才保存为新 revision。Renderer 不接收源码、模型 transcript、工具调用、内部编号或密钥。
- **Public Beta Slice 6 发布面**：新增严格且原子保存的玩家设置、声音/动效与好友偏好、程序生成的界面/战斗音效、七项玩家化检查与脱敏 JSON 导出。旧版目录只能经系统目录选择器导入：有效 `my-bots/*.js` 成为不可变指挥官版本，已验证 Replay v1 转为不含源码/哈希/动作/日志的经典公开回放；超限、损坏和符号链接条目跳过。当前用户 NSIS 安装包与便携 ZIP 均已生成，更新入口只打开官方 GitHub Releases，不静默下载或安装。
- **桌面数据根**：均位于 Electron `userData`；`profile/`、`builds/`、`build-metadata/`、`replays/`、`public-replays/`、`replay-metadata/`、`replay-trash/`、`rooms/`、`quarantine/`、`diagnostics/`、`exports/` 分别保存档案、配置、版本说明、完整练习赛、好友公开回放、复盘笔记、七天回收站、系统加密房间恢复信息、隔离数据、脱敏检查报告和玩家主动导出文件。
- **排位模式封存**：原双席位令牌、`/api/rooms` 和云端权威执行保留在 `src/online`，继续跑回归测试但不接入好友房间；等账号、匹配、持久化、反作弊和公开沙盒条件具备后再恢复。
- **兼容性状态**：v1 引擎、Bot API、CLI、旧网页控制台和旧回放播放器行为保持不变；它们仍保存和展示 Replay v1，桌面练习赛则使用 Replay v2。
- **发布完整性清单与元数据**：安装包声明公开维护主体 `ghostLLC`、项目主页和 Git 仓库，打包器不再报缺少 author；`npm run release:integrity` 从当前 ZIP 与安装包读取真实字节数和 SHA-256，原子生成稳定排序的 JSON 清单与标准 `.sha256` 文件。缺失、空文件、路径越界和同版本重复刷新均有回归覆盖。清单用于发现下载损坏或发布错配，不冒充代码签名。
- **质量基线**：261 项自动化测试通过，覆盖 v1 兼容、Gameplay/Replay v2、配置历史检查/隔离、真实练习赛、好友房间 P2P、公开回放、加密恢复、局域网发现/真实 UDP 回环、脱敏连接诊断、外部 Agent 六工具工作流、一键接入的保留式配置合并/备份/幂等/损坏保护、Provider 请求边界、Anthropic 工具消息、多场 Agent 评测/取消/确认保存、回放工作室、玩家设置、旧版迁移、发布诊断、发布完整性清单、固定 IPC、桌面导航与两个 CJS 单文件发行程序的真实资源读取；TypeScript 类型检查、生产依赖 0 漏洞审计、通用构建与桌面构建通过。发行目录内的独立 Bridge 完成真实 stdio 保存/练习赛冒烟，桌面候选启动后保持响应。

### Public Beta B Windows 候选

- 可运行目录：`release/AgenticGame-win-x64/AgenticGame.exe`
- 便携 ZIP：`release/AgenticGame-0.1.0-public-beta-b-win-x64.zip`，184540616 字节，SHA-256 `D542A9168A48CA644F1B30AEA12B392EBD7145850FE3BDAD4DA8EBE42CDC513B`。
- NSIS：`release/AgenticGame-0.1.0-win-x64-setup.exe`，126736986 字节，SHA-256 `0D1FB07E84367B40FDA6F8B98B26514D579FA53B30E4CC444D785FF84109C739`。
- Agent Bridge：`release/AgenticGame-win-x64/AgenticGame-Agent.exe`，58437682 字节，SHA-256 `A8F2FAA914B7E50164E47FE8ACFD31A14CD00A07DE60E74C52740FA6E87C4667`。
- 完整性附件：`release/AgenticGame-0.1.0-public-beta-b.sha256` 与 `release/AgenticGame-0.1.0-public-beta-b-manifest.json`，由实际 ZIP/NSIS 候选生成；发布到 GitHub Releases 时应与二进制一同上传。
- 进程冒烟：2026-09-04 目录版以隔离用户目录启动，主进程 `Responding=True`，检查结束后只终止该候选进程。
- 浏览器验收：1440×900 与 1100×700 完成设置保存、七项检查、脱敏导出、旧版导入与异地好友偏好继承；0 个控制台错误/警告，页面无横向溢出，未发现实际密钥或路径载荷。
- 边界：代码与单机发布产物已达到统一验收候选。没有使用用户真实付费 API Key 做线上厂商调用；NSIS 尚未在全新 Windows 用户环境真实安装/卸载；两台真实 Windows 设备的局域网、异地网络与应用重启恢复仍待最终验收。无自有 TURN 时严格 NAT 可能失败。Ardot 同步按用户当前要求延后。

### ⚠️ 实测中发现并已修复的问题
1. **`Math` 不可枚举**：`{...Math}` 展开得空对象（`Math.random` 等全丢）。修复为按属性名拷贝 + 覆盖 random。
2. **炮弹能打到自己**：结算顺序让前进坦克撞进自己弹道。修复为"炮弹无视发射者"。
3. **chaser 最初全图零开火**：贪心寻路对中央墙震荡绕不过。改为 **BFS 距离场寻路**。
4. **sniper 对静止靶零开火**：初始预判解算用了错误的整除条件。修正为 `ceil(距离/弹速)` 命中模型。
5. **回放 viewer 日志重复注入**：同帧重渲染重复追加日志。加 `lastLoggedFrame` 去重。
6. **内联 Bot 加载失败二次崩溃**：`BotSpec.path` 可选却直接调用 `replace`。现已回退到名称 `inline`，
   并增加真实 Worker 回归测试。
7. **pkg 拒绝生成 EXE**：`--no-bytecode` 缺少公开源码参数。现已补充
   `--public --public-packages "*"` 并完成产物实测。
8. **CJS 打包出现 `import.meta` 警告**：两个单文件入口在 CJS 构建中显式把不可用的模块 URL
   定义为 `undefined`，继续由 `__dirname` 走虚拟文件系统；新增真实产物回归同时验证 `arena.exe`
   地图资源和 Agent Bridge 配置输出，不以隐藏日志代替运行验证。

### 🔶 已知问题 / 待办
- `console.html` 的"复制规则书"依赖 `Clipboard API`，部分老浏览器可能要用回退逻辑（已提供）。
- 打包版双击运行后会在 `exe 同目录`生成 `my-bots/` 和 `replays/`（可移植）。
- 既有 5 项依赖告警均追溯到开发期 `vitest@2` / `vite` 测试栈；已定向升级至 `vitest@4.1.11`
  并完成全量回归，当前 `npm audit` 为 0 项漏洞，未使用 `npm audit fix --force`。

---

## 五、如何运行

需要 Node.js ≥ 20。

```bash
npm install

# 1) 免命令行：浏览器控制台（推荐，无参数默认就是它）
npm run arena -- ui            # 或直接 npx tsx src/cli/index.ts
# 浏览器自动打开 http://localhost:8188

# 2) 命令行玩法
npm run arena -- play my-tank.js bots/sniper.js   # 对战，生成回放
npm run arena -- validate my-tank.js              # 校验你的 bot
npm run arena -- self my-tank.js                  # 镜像测试
npm run arena -- demo                             # 内置示例对决并打开回放
npm run arena -- serve replays/<文件>.json        # 只打开回放播放器
npm run arena -- maps                             # 列出官方地图
npm run arena -- mcp                              # 外部 Agent 的 MCP stdio 服务
# 设置 AGENTIC_GAME_API_KEY 后：
npm run arena -- agent my-bots/my-tank.js --model <id> --base-url <URL>

# 3) 开发 / 质量
npm run test          # 258 项自动化测试（含 v1/v2、好友房、回放、外部 Agent、一键接入、AI 教练与发布策略）
npm run typecheck     # tsc 严格检查
npm run build         # 编译 TypeScript 到 dist/
npm run desktop       # 构建并启动独立桌面游戏窗口
npm run pack:desktop-folder # 生成 release/AgenticGame-win-x64/AgenticGame.exe
npm run pack:desktop-installer # 生成当前用户 NSIS 安装包
npm run build:agent-bridge # 单独生成外部 Agent MCP Bridge
npm run build:exe     # 打包成 arena.exe（首次可能需联网下载 pkg 基座）
```

**Bot 文件在哪**：内置基准在 `bots/`；你上传/写的 bot 放到 `my-bots/`（GUI）或用绝对路径（CLI）。
规则书在 `docs/tank-spec.md`（喂给 AI 的核心文档）。

---

## 六、打包成 exe —— 已完成与验证状态

脚本 `scripts/pack.mjs` 已写好，逻辑：
1. `esbuild` 分别打包 `src/cli/index.ts` → `dist/cli.bundle.js`（CJS）和
   `src/runtime/bot-worker.mjs` → `dist/bot-worker.js`（CJS，独立单文件）
2. `cpSync` 复制 `viewer/`、`bots/`、`docs/`、`console.html` → `dist/assets/`
3. 写 `dist/package.json`（含 `pkg.assets` 清单）
4. `npx pkg` 使用 `--no-bytecode --public --public-packages "*"` 生成 `arena.exe`

**2026-08-24 实测结果：**
- 产物：项目根目录 `arena.exe`，Windows x64，约 57.6 MB。
- `arena.exe maps` 退出码 0，两张地图资源正常。
- EXE 网页控制台首页与 Bot API 正常，4 个内置 Bot 可读取。
- 打包内 Worker 成功释放到系统临时目录并加载。
- Chaser vs Sniper 完整对局正常结束（40 tick、双方 0 违规），回放可通过 HTTP 读取。
- 首次下载基座仍可能受网络影响；已缓存的环境后续打包不需要重复下载。

**为什么选 pkg**：单文件 exe、双击即用、内嵌 Node 运行时，符合"给非技术用户/朋友免环境部署"的目标。
代价是体积（约几十 MB）+ 首次基座下载。

---

## 七、下一步路线图（按优先级）

**$P0–P1 已完成：v0.1 稳定基线、Core/Replay v2、Runner 双格式输出与 Gameplay v2 首期玩法纵切。**
**$P2 中层体验（已完成 Beta B Slice 1–4、6）**：桌面基础、可恢复首次体验、不可变车库、新旧/镜像练习赛、Replay Studio、局域网好友发现、应用重启房间恢复、玩家设置、运行检查、旧版迁移和 Windows 发布产物均已进入玩家路径。云端权威房间继续封存为未来排位原型。
**$P3 AI 原生入口（Beta B 已完成）**：MCP、OpenAI-compatible / Anthropic BYOK、玩家化 Agent Center、取消、脱敏、多场评测与确认保存 revision 已进入真实路径。
**$P4 游戏化 UX**：严格按 Ardot 设计实现六大模块，隐藏默认路径中的开发术语并强化战斗因果反馈。
**$P5 模式与内容扩展**：2v2、更多地图、赛事/赛季模式和社区内容。
**$P6 安全加固**：正式公开比赛时，沙盒从 `vm` 升级到进程级隔离或 WASM（当前 `vm` 不是
防恶意逃逸的硬边界，仅用于防意外；朋友对战够用）。

---

## 八、给下一位 AI 的重要提醒

1. **改规则数值必须同步改 `docs/tank-spec.md`**。`engine.ts` 的结算顺序与 spec §4 一一对应，
   这里是项目的"契约"，改一处务必两处一起改。
2. **确定性第一**：不要引入任何依赖 `Date.now()`/`Math.random()`/进程状态的分支，
   否则回放无法复现、比赛可信度崩塌。bot 的随机一律用 `ctx.rng()`（引擎派发种子）。
3. **基准 bot 强度阶梯** duck < random < sniper < chaser 已稳；调规则前先跑 `npm run test`，
   再用 `npm run arena -- play` 跑矩阵确认阶梯没被破坏。
4. **资源路径只走 `resolveAsset()`**（`src/runtime/paths.ts`），不要直接 hardcode
   `../viewer/` 或 `../bots/`，否则打包版会炸。
5. **编码**：所有源码用 UTF-8；Windows 下 CLI 的中文输出在部分终端可能需 `--no-open`
   或 `chcp 65001`，但 GUI（控制台）无需关心。

---

*文档版本：v1.10（2026-09-04）／ v1 引擎 0.1.0 ／ Gameplay v2 引擎 0.2.0 ／ v2 契约 2*
