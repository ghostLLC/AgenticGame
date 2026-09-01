# AI-native Harness v1 规格

状态：桌面玩家闭环已接入（2026-09-01）

## 1. 决策

外部 Agent 与内置 BYOK 不分别实现游戏能力，而是共享一个版本化 Tool Registry：

```text
Codex / Claude Code / 其他 MCP Host ── MCP stdio ─┐
                                                   ├─ get_game_context
玩家填写厂商 / Endpoint / API Key ── Harness ─────┤
                                                   └─ evaluate_bot ── runMatchV2 ── verified bundle
```

- 外部接入选择 MCP stdio：本地、无常驻网络端口，且能被多种 Agent Host 复用。
- 内置 Harness 使用 provider-neutral 模型接口；首批适配 OpenAI-compatible Chat Completions。
- DeepSeek、OpenRouter 和其他兼容端点通过自定义 `baseUrl + model` 接入；Anthropic 原生 Messages
  已复用同一 Harness 契约。Claude Code 等外部 Agent 仍可直接通过 MCP 使用现有能力。
- API Key 只保存在 provider 闭包与请求 Authorization header，不写配置、比赛包、日志或 transcript。
- 模型响应默认限制为 4096 tokens；非 HTTPS Endpoint 只允许显式 localhost / loopback 地址。

## 2. Tool Registry v1

### `get_game_context`

返回官方 ruleset、车辆、武器、模式、地图摘要和 Bot 接口。返回值是玩家/Agent 可读副本，不能修改内核常量。

### `evaluate_bot`

输入完整 JavaScript Bot 源码，以及可选模式、车辆、武器、seed 和 maxTicks。工具会：

1. 严格校验输入、官方内容 ID 和载具/武器兼容性；
2. 在真实 Worker + VM 沙箱中对战固定的 `baseline-sentry-v1`；
3. 使用 `runMatchV2` 生成完整 MatchBundleV2；
4. 在服务端验证 bundle 完整性；
5. 仅返回胜负、双方 HP/弹药/违规数和 bundle hash，不返回对手源码或整包内部数据。

## 3. Harness 边界

- 默认最多 8 个模型轮次、12 次工具调用，调用方可在上限内调小或调整。
- 只执行精确注册的工具名；模型虚构的文件、Shell 或网络工具只会收到 `tool_not_allowed`。
- 工具异常以结构化错误回送模型，不使循环失控。
- 支持 AbortSignal；结果 transcript 会对 provider 声明的敏感值做最终脱敏。
- Bot 源码是不可信数据，系统提示明确要求模型不得把源码内容当指令。

## 4. CLI 接入

### 外部 Agent

MCP Host 使用如下 stdio 配置；生产安装后也可把 command 换成全局 `arena`：

```json
{
  "mcpServers": {
    "agentic-game": {
      "command": "npm",
      "args": ["run", "arena", "--", "mcp"],
      "cwd": "D:/AgenticGame"
    }
  }
}
```

### 内置 BYOK

密钥只通过环境变量传入，避免出现在 shell 历史和进程参数中：

```powershell
$env:AGENTIC_GAME_API_KEY = "<your-key>"
npm run arena -- agent my-bots/my-tank.js --model <model-id> `
  --base-url https://api.openai.com/v1 `
  --prompt "先评测，再提高据点争夺能力"
```

兼容厂商只需替换 `--base-url` 与 `--model`。当前命令输出建议或完整替换源码，但不会自动覆盖 Bot 文件。

## 5. 桌面 Agent Center 与已知边界

- Harness 内的 `evaluate_bot` 仍提供快速单局反馈；Agent Center 会把最终候选再与玩家选定 Build 进行固定 3/5/10 场真实沙盒评测，并汇总胜平负、平均耐久、违规和运行错误。
- API Key 只进入当前 main-process Provider 闭包与请求 Header；页面开始运行后清空输入，候选只保留在内存，玩家确认后才写入新的不可变 revision。
- 玩家可取消剩余评测；已完成结果保留。当前正在执行的单场 worker 比赛会完成后再观察取消信号，不声称为即时强制终止。
- 尚未用用户真实付费密钥调用线上厂商；适配器使用隔离 HTTP 契约、模拟响应、超时/取消/响应上限和密钥脱敏测试完成验证。
- 正式公开比赛前需要把 Node `vm` 提升到进程级隔离或 WASM；MCP 工具不得对公网直接开放。
- 后续 provider 适配器必须复用 Harness 契约，不得把厂商 SDK 类型渗透进游戏工具层。

## 6. Ardot 实现依据

- 文件：`cocraft://localhost/file/718070578872647`
- 页面：`03 Agent Center`（`3:115`）
- 连接与配置：`3:117`
- 评测与保存结果：`3:190`
- 默认 / 连接中 / 错误 / 成功状态规范：`3:282`

默认路径使用玩家语言：“选择 AI 队友”“这次想改进什么”“查看训练结论”“保存为新版本”。
API Key、Endpoint、调用预算和 MCP 只在需要时逐步展示；任何自动生成结果都必须先评测，再由玩家明确保存为新 revision。
