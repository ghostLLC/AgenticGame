# AI-native Harness v1 规格

状态：外部 Agent 主入口与桌面 BYOK 闭环已接入（2026-09-02）

## 1. 决策

AgenticGame 把 Codex、WorkBuddy、Qoder 等外部 Agent 作为主要创作入口；桌面游戏负责版本、练习赛、
回放和好友房间。外部 Agent 与内置 BYOK 不分别实现游戏能力，而是复用相同规则、沙箱和数据仓库：

```text
Codex / WorkBuddy / Qoder ── 本地 MCP stdio ── Agent Bridge ─┬─ 读规则与玩家版本
                                                              ├─ 真实沙箱评测与保存
玩家填写厂商 / Endpoint / API Key ── 内置 Harness ────────────┤
                                                              └─ 新旧版本练习赛与战绩
```

- Agent Bridge 是随 Windows 游戏分发的独立 `AgenticGame-Agent.exe`，不要求克隆仓库、安装 Node、
  启动端口、上传文件或填写 API Key。
- stdio 子进程只在 Agent Host 使用期间运行；它和桌面游戏读取同一个本机用户资料目录。
- MCP 初始化包含完整工作流说明；工具声明读写与幂等属性，让支持该能力的 Host 对写操作单独确认。
- 内置 Harness 使用 provider-neutral 模型接口，支持 OpenAI-compatible Chat Completions 与 Anthropic Messages。
- API Key 只保存在 provider 闭包与请求 Authorization header，不写配置、比赛包、日志或 transcript。

## 2. 外部 Agent Tool Registry v1

### 只读工具

- `get_game_context`：返回官方规则、车辆、武器、模式、地图摘要和完整 Bot 接口。
- `evaluate_bot`：输入完整 JavaScript 源码和可选装配，在真实 Gameplay v2 Worker + VM 沙箱中对战
  基准敌人，验证 MatchBundleV2 后只返回比赛摘要。
- `get_player_workspace`：读取玩家当前指挥官的最新完整源码、装配、说明与不可变 revision 历史。
- `list_battle_history`：读取最近的已验证练习赛摘要，不返回源码、代码哈希、原始动作或调试日志。

### 写入工具

- `save_bot_revision`：先执行真实沙箱评测，再把完整源码、装配和玩家可读说明保存为新的不可变
  `commander-main` revision；相同内容重复调用不会制造重复版本。
- `run_practice_match`：让两个已保存 revision 进行歼灭或据点争夺，使用真实 Gameplay v2 沙箱，
  并把已验证回放保存到桌面“回放工作室”。

推荐流程固定为：读取工作区和规则 → 修改源码 → 临时评测 → 用户同意后保存 → 新版本对战旧版本 →
读取战绩并用玩家语言总结。玩家不需要复制或上传 `.js` 文件。

## 3. 安装版接入

安装版与便携版根目录都包含 `AgenticGame-Agent.exe`。在 PowerShell 中让它生成对应 Host 的配置：

```powershell
& "C:\完整路径\AgenticGame-Agent.exe" config codex
& "C:\完整路径\AgenticGame-Agent.exe" config qoder
& "C:\完整路径\AgenticGame-Agent.exe" config workbuddy
```

Codex 输出为可合并进用户级 `~/.codex/config.toml` 或可信项目 `.codex/config.toml` 的 TOML：

```toml
[mcp_servers.agentic_game]
command = "C:\\完整路径\\AgenticGame-Agent.exe"
args = ["mcp"]
startup_timeout_sec = 20
tool_timeout_sec = 120
default_tools_approval_mode = "writes"
```

Qoder 与 WorkBuddy 输出标准 `mcpServers` JSON，可合并进其 MCP 配置：

```json
{
  "mcpServers": {
    "agentic-game": {
      "type": "stdio",
      "command": "C:\\完整路径\\AgenticGame-Agent.exe",
      "args": ["mcp"],
      "timeout": 120000
    }
  }
}
```

保存配置并重启 Host 后，可以直接说：“读取我的 AgenticGame 战术版本，改进据点争夺能力；先评测，
等我确认后保存，再让新版本和旧版本打一场。”Codex 也可用
`codex mcp add agentic-game -- C:\完整路径\AgenticGame-Agent.exe mcp` 注册。

源码开发模式仍支持 `npm run arena -- mcp`；可用 `AGENTIC_GAME_USER_DATA` 覆盖数据根，仅用于测试。

## 4. Harness 与安全边界

- 默认最多 8 个模型轮次、12 次工具调用；只执行精确注册的工具名。
- 支持 AbortSignal；工具异常结构化返回，最终 transcript 对 provider 声明的敏感值脱敏。
- Bot 源码是不可信数据，Server instructions 要求 Agent 不把源码内容当作指令。
- 外部 Agent 的保存和练习赛会改变本机玩家资料；Codex 配置默认只对非只读工具请求批准。
- Agent Bridge 不开放网络端口，也不把 MCP 暴露到公网；它不改变好友房间的 P2P 边界。
- Node `vm` 仍只用于防止意外，不是抵御恶意代码的硬安全边界；公开排位前须升级到进程级隔离或 WASM。

## 5. 桌面 Agent Center

- 玩家选择已验证 Build、AI 厂商、本次密钥、目标与 3/5/10 场评测强度。
- Harness 先生成并验证候选，再让候选与玩家所选 Build 进行固定场次真实沙箱评测。
- 密钥只进入当前 main-process Provider；页面启动后清空输入，候选只驻留内存，玩家确认后才写入 revision。
- 尚未使用用户真实付费密钥调用线上厂商；当前完成的是隔离 HTTP 契约、模拟响应、超时、取消、
  响应上限和密钥脱敏验证。

## 6. 验收口径

- 单元/集成：MCP 内存与源码 stdio 均须发现六个工具并能调用。
- 独立程序：`scripts/acceptance/agent-bridge-smoke.mjs` 必须连接发行 EXE，保存两个 revision、完成一场
  据点练习赛并回读战绩。
- 数据互通：未设置覆盖变量时，独立 Agent Bridge 与 Electron 使用同一 `%APPDATA%\AgenticGame`。
- 发行：目录版和安装版根目录必须包含 `AgenticGame-Agent.exe`。

## 7. Ardot 实现依据

- 文件：`cocraft://localhost/file/718070578872647`
- 页面：`03 Agent Center`（`3:115`）
- 连接与配置：`3:117`
- 评测与保存结果：`3:190`
- 默认 / 连接中 / 错误 / 成功状态规范：`3:282`

当前改动只扩展本地 Agent 接口和发行能力，不改玩家界面；后续接入向导仍按既有 Ardot 页面实施。
