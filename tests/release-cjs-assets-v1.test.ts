import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

describe('CJS 发行资源定位', () => {
  it('构建两个 Windows 单文件程序时没有 import.meta 警告，且产物能读取内置资源', () => {
    const arenaBuild = runNode('scripts/pack.mjs');
    expect(arenaBuild.status, arenaBuild.output).toBe(0);
    expect(arenaBuild.output).not.toContain('"import.meta" is not available');

    const arena = spawnSync(join(root, 'arena.exe'), ['maps'], { cwd: root, encoding: 'utf8' });
    expect(arena.status, `${arena.stdout}\n${arena.stderr}`).toBe(0);
    expect(arena.stdout).toContain('standard');

    const bridgeBuild = runNode('scripts/build-agent-bridge.mjs');
    expect(bridgeBuild.status, bridgeBuild.output).toBe(0);
    expect(bridgeBuild.output).not.toContain('"import.meta" is not available');

    const bridge = join(root, 'dist', 'agent-bridge', 'AgenticGame-Agent.exe');
    const config = spawnSync(bridge, ['config', 'codex', bridge], { cwd: root, encoding: 'utf8' });
    expect(config.status, `${config.stdout}\n${config.stderr}`).toBe(0);
    expect(config.stdout).toContain('[mcp_servers.agentic_game]');
    expect(config.stdout).toContain('AgenticGame-Agent.exe');
  }, 60_000);
});

function runNode(script: string): { status: number | null; output: string } {
  const result = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' });
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}
