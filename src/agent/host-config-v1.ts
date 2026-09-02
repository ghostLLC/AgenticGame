import { isAbsolute, resolve } from 'node:path';

export type AgentHostV1 = 'codex' | 'qoder' | 'workbuddy';

export function createAgentHostConfigV1(host: AgentHostV1, executablePath: string): string {
  if (!['codex', 'qoder', 'workbuddy'].includes(host)) throw new Error(`不支持的 Agent Host：${String(host)}`);
  if (typeof executablePath !== 'string' || !isAbsolute(executablePath)) {
    throw new Error('Agent Bridge 必须使用绝对路径。');
  }
  const command = resolve(executablePath);
  if (host === 'codex') {
    return [
      '[mcp_servers.agentic_game]',
      `command = "${escapeToml(command)}"`,
      'args = ["mcp"]',
      'startup_timeout_sec = 20',
      'tool_timeout_sec = 120',
      'default_tools_approval_mode = "writes"',
      '',
    ].join('\n');
  }
  return `${JSON.stringify({
    mcpServers: {
      'agentic-game': {
        type: 'stdio',
        command,
        args: ['mcp'],
        timeout: 120_000,
      },
    },
  }, null, 2)}\n`;
}

function escapeToml(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}
