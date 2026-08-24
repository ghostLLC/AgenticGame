# AgenticGame · 坦克竞技场 —— 项目说明与交接文档

> 本文档面向**接手本项目的下一位 AI agent**（或协作者）。包含：
> 完整玩法逻辑、代码架构、当前进度、已验证项、已知问题、打包指引、以及下一步路线图。
> 所有内容截至 2026-08-24 实际完成与验证状态，请以此为准。

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
  replay/
    format.ts       回放自包含格式（地图+规则+代码指纹+逐帧快照+事件+日志）
    v2.ts           完整 Match Bundle v2 创建、时间线约束与篡改校验
    repository-v2.ts  MatchBundleV2 不可变原子落盘、幂等保存、回读校验与列表索引
    studio-v2.ts      玩家侧回放摘要、关键时刻与逐回合检查点定位
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

## 四、当前进度（截至 2026-08-24）

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
- **兼容性状态**：v1 引擎、Bot API、CLI、网页控制台和回放播放器行为保持不变；CLI/UI 本阶段仍保存和展示 Replay v1，尚未增加 v2 文件入口。
- **质量基线**：92 项自动化测试通过，覆盖 v1 兼容、Gameplay/Replay v2、配置历史、练习赛、回放仓库、Studio 投影和占领模式；TypeScript 类型检查与构建通过。

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

### 🔶 已知问题 / 待办
- `esbuild` 打 CJS bundle 时会提示 `import.meta` 为空；打包分支实际使用 `__dirname`，EXE 已实测正常，
  但后续可重构 `paths.ts` 或调整构建配置以消除警告。
- `console.html` 的"复制规则书"依赖 `Clipboard API`，部分老浏览器可能要用回退逻辑（已提供）。
- 打包版双击运行后会在 `exe 同目录`生成 `my-bots/` 和 `replays/`（可移植）。
- `npm install` 当前报告 5 个既有依赖漏洞（3 moderate、1 high、1 critical）；尚未执行可能包含破坏性升级的
  `npm audit fix --force`，需要单独审计依赖来源与兼容性。

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

# 3) 开发 / 质量
npm run test          # 81 项自动化测试（69 项既有基线 + 12 项配置历史/练习赛）
npm run typecheck     # tsc 严格检查
npm run build         # 编译 TypeScript 到 dist/
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
**$P2 中层体验（进行中）**：配置版本化、新旧版本练习赛、Replay v2 持久化/Studio 投影和据点争夺已完成；Build 历史、练习赛与 Replay Studio Ardot 流程已验收，下一步接入玩家入口。
**$P3 AI 原生入口**：外部 Agent 适配器与内置 TypeScript BYOK Harness，共享能力、预算、沙箱和评测。
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

*文档版本：v1.4（2026-08-24）／ v1 引擎 0.1.0 ／ Gameplay v2 引擎 0.2.0 ／ v2 契约 2*
