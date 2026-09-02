#!/usr/bin/env node
import { createAgentHostConfigV1, type AgentHostV1 } from './host-config-v1.js';
import { startAgenticGameMcpStdioV1 } from './mcp-stdio-v1.js';

const [command, ...args] = process.argv.slice(2);

if (command === 'mcp') {
  startAgenticGameMcpStdioV1();
} else if (command === 'config') {
  const candidate = args[0];
  if (!candidate || !['codex', 'qoder', 'workbuddy'].includes(candidate)) {
    fail('用法：AgenticGame-Agent.exe config <codex|qoder|workbuddy> [Agent Bridge 绝对路径]');
  }
  const host = candidate as AgentHostV1;
  const executablePath = args[1] ?? process.execPath;
  process.stdout.write(createAgentHostConfigV1(host, executablePath));
} else {
  process.stdout.write([
    'AgenticGame Agent Bridge',
    '',
    '这是供 Codex、WorkBuddy、Qoder 等 Agent 使用的本地 MCP 接口。',
    '不会启动服务器端口，也不需要 API Key。',
    '',
    '  AgenticGame-Agent.exe mcp',
    '  AgenticGame-Agent.exe config codex',
    '  AgenticGame-Agent.exe config qoder',
    '  AgenticGame-Agent.exe config workbuddy',
    '',
  ].join('\n'));
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}
