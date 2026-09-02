import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentConnectorServiceV1 } from '../src/desktop/agent-connector-service-v1.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'agentic-game-connectors-'));
  roots.push(root);
  const home = join(root, 'player');
  const bridge = join(root, 'game', 'AgenticGame-Agent.exe');
  await mkdir(join(root, 'game'), { recursive: true });
  await writeFile(bridge, 'bridge', 'utf8');
  return { root, home, bridge, service: new AgentConnectorServiceV1({ homeDirectory: home, bridgePath: bridge }) };
}

describe('AgentConnectorServiceV1', () => {
  it('原子接入 Codex，保留其他配置并幂等更新旧的 AgenticGame 段', async () => {
    const { home, bridge, service } = await fixture();
    const directory = join(home, '.codex');
    const path = join(directory, 'config.toml');
    await mkdir(directory, { recursive: true });
    await writeFile(path, [
      'model = "gpt-current"',
      '',
      '[mcp_servers.keep_me]',
      'command = "keep.exe"',
      '',
      '[mcp_servers.agentic_game]',
      'command = "C:\\\\Old\\\\AgenticGame-Agent.exe"',
      'args = ["mcp"]',
      '',
      '[features]',
      'voice = true',
      '',
    ].join('\n'), 'utf8');

    const first = await service.connect('codex');
    const second = await service.connect('codex');
    const text = await readFile(path, 'utf8');

    expect(first).toMatchObject({ host: 'codex', configured: true, restartRequired: true, backupCreated: true });
    expect(second).toMatchObject({ host: 'codex', configured: true, restartRequired: true, backupCreated: false });
    expect(text).toContain('model = "gpt-current"');
    expect(text).toContain('[mcp_servers.keep_me]');
    expect(text).toContain('[features]');
    expect(text.match(/\[mcp_servers\.agentic_game\]/g)).toHaveLength(1);
    expect(text).toContain(`command = "${bridge.replaceAll('\\', '\\\\')}"`);
    expect(await readFile(`${path}.before-agenticgame.bak`, 'utf8')).toContain('Old');
  });

  it('接入 Qoder 时保留设置和其他 MCP Server', async () => {
    const { home, bridge, service } = await fixture();
    const directory = join(home, '.qoder');
    const path = join(directory, 'settings.json');
    await mkdir(directory, { recursive: true });
    await writeFile(path, JSON.stringify({ theme: 'night', mcpServers: { docs: { command: 'docs.exe' } } }, null, 2), 'utf8');

    await service.connect('qoder');
    const value = JSON.parse(await readFile(path, 'utf8'));

    expect(value.theme).toBe('night');
    expect(value.mcpServers.docs).toEqual({ command: 'docs.exe' });
    expect(value.mcpServers['agentic-game']).toEqual({ type: 'stdio', command: bridge, args: ['mcp'], timeout: 120000 });
  });

  it('优先写入已存在的 WorkBuddy 配置并保留 JSONC 注释', async () => {
    const { home, bridge, service } = await fixture();
    const directory = join(home, '.workbuddy');
    const path = join(directory, 'mcp.json');
    await mkdir(directory, { recursive: true });
    await writeFile(path, '{\n  // 玩家已有连接\n  "mcpServers": {\n    "docs": { "command": "docs.exe" },\n  },\n}\n', 'utf8');

    const result = await service.connect('workbuddy');
    const text = await readFile(path, 'utf8');

    expect(result).toMatchObject({ host: 'workbuddy', configured: true });
    expect(text).toContain('// 玩家已有连接');
    expect(text).toContain('"docs"');
    expect(text).toContain('"agentic-game"');
    expect(text).toContain(bridge.replaceAll('\\', '\\\\'));
  });

  it('WorkBuddy 已安装但尚未生成配置时也可以直接接入', async () => {
    const { root, home, bridge } = await fixture();
    const localAppData = join(root, 'local-app-data');
    await mkdir(join(localAppData, 'Programs', 'WorkBuddy'), { recursive: true });
    const service = new AgentConnectorServiceV1({
      homeDirectory: home,
      bridgePath: bridge,
      environment: { LOCALAPPDATA: localAppData },
    });

    expect(await service.inspect()).toMatchObject({
      hosts: expect.arrayContaining([expect.objectContaining({ id: 'workbuddy', state: 'ready' })]),
    });
    await service.connect('workbuddy');
    const value = JSON.parse(await readFile(join(home, '.workbuddy', 'mcp.json'), 'utf8'));
    expect(value.mcpServers['agentic-game']).toMatchObject({ command: bridge, args: ['mcp'] });
  });

  it('配置损坏时不覆盖原文件，并在状态中给出玩家化阻断', async () => {
    const { home, service } = await fixture();
    const directory = join(home, '.qoder');
    const path = join(directory, 'settings.json');
    await mkdir(directory, { recursive: true });
    await writeFile(path, '{ broken', 'utf8');

    await expect(service.connect('qoder')).rejects.toThrow('没有改动原配置');
    expect(await readFile(path, 'utf8')).toBe('{ broken');
    expect(await service.inspect()).toMatchObject({
      bridgeReady: true,
      hosts: expect.arrayContaining([expect.objectContaining({ id: 'qoder', state: 'needs-attention' })]),
    });
  });

  it('状态投影不向页面暴露用户目录或 Bridge 路径', async () => {
    const { home, bridge, service } = await fixture();
    await mkdir(join(home, '.codex'), { recursive: true });
    const snapshot = await service.inspect();
    const serialized = JSON.stringify(snapshot);
    expect(snapshot.hosts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'codex', name: 'Codex', state: 'ready' }),
      expect.objectContaining({ id: 'qoder', state: 'not-found' }),
    ]));
    expect(serialized).not.toContain(home);
    expect(serialized).not.toContain(bridge);
  });
});
