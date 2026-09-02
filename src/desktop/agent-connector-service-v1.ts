import { constants } from 'node:fs';
import { copyFile, mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { applyEdits, modify, parse as parseJsonc, type ParseError } from 'jsonc-parser';
import { parse as parseToml } from 'smol-toml';
import { createAgentHostConfigV1 } from '../agent/host-config-v1.js';

export type ExternalAgentHostV1 = 'codex' | 'workbuddy' | 'qoder';
export type ExternalAgentConnectionStateV1 = 'not-found' | 'ready' | 'connected' | 'needs-attention';

export interface ExternalAgentCardV1 {
  id: ExternalAgentHostV1;
  name: string;
  summary: string;
  state: ExternalAgentConnectionStateV1;
}

export interface AgentConnectorSnapshotV1 {
  bridgeReady: boolean;
  hosts: ExternalAgentCardV1[];
  privacy: string;
}

export interface AgentConnectorResultV1 {
  host: ExternalAgentHostV1;
  configured: true;
  restartRequired: true;
  backupCreated: boolean;
  message: string;
}

export interface AgentConnectorServiceOptionsV1 {
  homeDirectory: string;
  bridgePath: string;
  environment?: Record<string, string | undefined>;
}

const HOST_META: Record<ExternalAgentHostV1, Pick<ExternalAgentCardV1, 'name' | 'summary'>> = {
  codex: { name: 'Codex', summary: '适合持续改进战术并复盘每次变化' },
  workbuddy: { name: 'WorkBuddy', summary: '适合用自然语言组织长期训练任务' },
  qoder: { name: 'Qoder', summary: '适合在策略与实现之间快速迭代' },
};

export class AgentConnectorServiceV1 {
  private readonly home: string;
  private readonly bridge: string;
  private readonly environment: Record<string, string | undefined>;

  constructor(options: AgentConnectorServiceOptionsV1) {
    if (!isAbsolute(options.homeDirectory) || !isAbsolute(options.bridgePath)) {
      throw new Error('Agent 接入服务路径无效');
    }
    this.home = resolve(options.homeDirectory);
    this.bridge = resolve(options.bridgePath);
    this.environment = options.environment ?? process.env;
  }

  async inspect(): Promise<AgentConnectorSnapshotV1> {
    const bridgeReady = await isFile(this.bridge);
    const hosts = await Promise.all((['codex', 'workbuddy', 'qoder'] as const).map(async (host) => {
      const config = await this.resolveConfig(host);
      let state: ExternalAgentConnectionStateV1 = 'not-found';
      if (config.installed) {
        state = bridgeReady ? await inspectConfiguration(host, config.path, this.bridge) : 'needs-attention';
      }
      return { id: host, ...HOST_META[host], state };
    }));
    return {
      bridgeReady,
      hosts,
      privacy: '只会增加 AgenticGame 连接；不会读取账号、模型、对话或密钥，也不会改动其他连接。',
    };
  }

  async connect(host: ExternalAgentHostV1): Promise<AgentConnectorResultV1> {
    if (!HOST_META[host]) throw new Error('请选择支持的 AI 队友');
    if (!await isFile(this.bridge)) throw new Error('游戏连接组件缺失，请重新安装或使用完整便携版');
    const config = await this.resolveConfig(host);
    if (!config.installed) throw new Error(`暂未发现 ${HOST_META[host].name}，安装后再来接入`);

    const current = await readOptional(config.path);
    let next: string;
    try {
      next = host === 'codex'
        ? mergeCodexConfig(current ?? '', this.bridge)
        : mergeJsonConfig(current ?? '{}\n', this.bridge);
    } catch {
      throw new Error(`${HOST_META[host].name} 的连接配置需要先修复；游戏没有改动原配置`);
    }

    const backupCreated = current === undefined ? false : await createBackupOnce(config.path);
    await writeAtomic(config.path, next);
    return {
      host,
      configured: true,
      restartRequired: true,
      backupCreated,
      message: `已接入 ${HOST_META[host].name}。请重启它，然后在新对话中邀请 AgenticGame 战术搭档。`,
    };
  }

  private async resolveConfig(host: ExternalAgentHostV1): Promise<{ path: string; installed: boolean }> {
    if (host === 'codex') {
      const root = this.environment.CODEX_HOME?.trim() || join(this.home, '.codex');
      return { path: join(resolve(root), 'config.toml'), installed: await isDirectory(root) };
    }
    if (host === 'qoder') {
      const root = this.environment.QODER_CONFIG_DIR?.trim() || join(this.home, '.qoder');
      return { path: join(resolve(root), 'settings.json'), installed: await isDirectory(root) };
    }

    const workbuddyRoot = join(this.home, '.workbuddy');
    const codebuddyRoot = join(this.home, '.codebuddy');
    const candidates = [
      join(workbuddyRoot, 'mcp.json'),
      join(codebuddyRoot, '.mcp.json'),
      join(codebuddyRoot, 'mcp.json'),
    ];
    for (const path of candidates) if (await isFile(path)) return { path, installed: true };
    if (await isDirectory(workbuddyRoot)) return { path: candidates[0]!, installed: true };
    if (await isDirectory(codebuddyRoot)) return { path: candidates[1]!, installed: true };
    const localAppData = this.environment.LOCALAPPDATA?.trim();
    if (localAppData && await isDirectory(join(localAppData, 'Programs', 'WorkBuddy'))) {
      return { path: candidates[0]!, installed: true };
    }
    return { path: candidates[0]!, installed: false };
  }
}

function mergeCodexConfig(current: string, bridge: string): string {
  if (current.trim()) parseToml(current);
  const lines = current.replace(/\r\n/g, '\n').split('\n');
  const kept: string[] = [];
  let skipping = false;
  for (const line of lines) {
    const heading = /^\s*\[([^\]]+)]\s*(?:#.*)?$/.exec(line)?.[1]?.trim();
    if (heading) skipping = /^mcp_servers\.(?:agentic_game|"agentic_game"|"agentic-game")(?:\.|$)/.test(heading);
    if (!skipping) kept.push(line);
  }
  while (kept.length && kept.at(-1)?.trim() === '') kept.pop();
  const merged = `${kept.length ? `${kept.join('\n')}\n\n` : ''}${createAgentHostConfigV1('codex', bridge)}`;
  parseToml(merged);
  return merged;
}

function mergeJsonConfig(current: string, bridge: string): string {
  const errors: ParseError[] = [];
  const value = parseJsonc(current, errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length || !isRecord(value) || (value.mcpServers !== undefined && !isRecord(value.mcpServers))) {
    throw new Error('invalid JSONC');
  }
  const edits = modify(current, ['mcpServers', 'agentic-game'], {
    type: 'stdio', command: bridge, args: ['mcp'], timeout: 120_000,
  }, { formattingOptions: { insertSpaces: true, tabSize: 2, eol: '\n' } });
  const merged = applyEdits(current, edits);
  const validationErrors: ParseError[] = [];
  parseJsonc(merged, validationErrors, { allowTrailingComma: true, disallowComments: false });
  if (validationErrors.length) throw new Error('invalid generated JSONC');
  return merged.endsWith('\n') ? merged : `${merged}\n`;
}

async function inspectConfiguration(host: ExternalAgentHostV1, path: string, bridge: string): Promise<ExternalAgentConnectionStateV1> {
  const current = await readOptional(path);
  if (current === undefined) return 'ready';
  try {
    if (host === 'codex') {
      const parsed = parseToml(current) as Record<string, unknown>;
      const servers = isRecord(parsed.mcp_servers) ? parsed.mcp_servers : undefined;
      const entry = servers && isRecord(servers.agentic_game) ? servers.agentic_game : undefined;
      return matchesEntry(entry, bridge) ? 'connected' : 'ready';
    }
    const errors: ParseError[] = [];
    const parsed = parseJsonc(current, errors, { allowTrailingComma: true, disallowComments: false });
    if (errors.length || !isRecord(parsed)) return 'needs-attention';
    const servers = isRecord(parsed.mcpServers) ? parsed.mcpServers : undefined;
    const entry = servers && isRecord(servers['agentic-game']) ? servers['agentic-game'] : undefined;
    return matchesEntry(entry, bridge) ? 'connected' : 'ready';
  } catch {
    return 'needs-attention';
  }
}

function matchesEntry(entry: Record<string, unknown> | undefined, bridge: string): boolean {
  return Boolean(entry && typeof entry.command === 'string' && resolve(entry.command) === bridge
    && Array.isArray(entry.args) && entry.args.length === 1 && entry.args[0] === 'mcp');
}

async function createBackupOnce(path: string): Promise<boolean> {
  try {
    await copyFile(path, `${path}.before-agenticgame.bak`, constants.COPYFILE_EXCL);
    return true;
  } catch (error) {
    if (isNodeError(error, 'EEXIST')) return false;
    throw error;
  }
}

async function writeAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  try {
    const handle = await open(temporary, 'wx');
    try {
      await handle.writeFile(content, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

async function readOptional(path: string): Promise<string | undefined> {
  try { return await readFile(path, 'utf8'); }
  catch (error) { if (isNodeError(error, 'ENOENT')) return undefined; throw error; }
}

async function isFile(path: string): Promise<boolean> {
  try { return (await stat(path)).isFile(); } catch { return false; }
}

async function isDirectory(path: string): Promise<boolean> {
  try { return (await stat(path)).isDirectory(); } catch { return false; }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === code;
}
