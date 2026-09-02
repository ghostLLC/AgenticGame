import { describe, expect, it } from 'vitest';
import { createAgentHostConfigV1 } from '../src/agent/host-config-v1.js';

describe('Agent host configuration v1', () => {
  it('creates a Codex project configuration for the packaged stdio bridge', () => {
    expect(createAgentHostConfigV1('codex', 'C:\\Games\\AgenticGame-Agent.exe')).toBe([
      '[mcp_servers.agentic_game]',
      'command = "C:\\\\Games\\\\AgenticGame-Agent.exe"',
      'args = ["mcp"]',
      'startup_timeout_sec = 20',
      'tool_timeout_sec = 120',
      'default_tools_approval_mode = "writes"',
      '',
    ].join('\n'));
  });

  it('creates interoperable MCP JSON for Qoder and WorkBuddy', () => {
    const expected = {
      mcpServers: {
        'agentic-game': {
          type: 'stdio',
          command: 'C:\\Games\\AgenticGame-Agent.exe',
          args: ['mcp'],
          timeout: 120000,
        },
      },
    };
    expect(JSON.parse(createAgentHostConfigV1('qoder', 'C:\\Games\\AgenticGame-Agent.exe'))).toEqual(expected);
    expect(JSON.parse(createAgentHostConfigV1('workbuddy', 'C:\\Games\\AgenticGame-Agent.exe'))).toEqual(expected);
  });

  it('rejects unsupported hosts and relative executable paths', () => {
    expect(() => createAgentHostConfigV1('unknown' as 'codex', 'C:\\Games\\AgenticGame-Agent.exe'))
      .toThrow('不支持');
    expect(() => createAgentHostConfigV1('codex', '.\\AgenticGame-Agent.exe'))
      .toThrow('绝对路径');
  });
});
