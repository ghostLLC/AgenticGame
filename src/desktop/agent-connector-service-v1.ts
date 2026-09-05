import { constants } from 'node:fs';
import { copyFile, mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { applyEdits, modify, parse as parseJsonc, type ParseError } from 'jsonc-parser';
import { parse as parseToml } from 'smol-toml';
import { createAgentHostConfigV1 } from '../agent/host-config-v1.js';
import { acquireWriteLease } from '../storage/write-lease.js';

export type ExternalAgentHostV1 = 'codex' | 'workbuddy' | 'qoder';
export type ExternalAgentConnectionStateV1 = 'not-found' | 'ready' | 'configured' | 'needs-attention';

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
  beforeCommit?: () => Promise<void>;
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
  private readonly beforeCommit?: () => Promise<void>;

  constructor(options: AgentConnectorServiceOptionsV1) {
    if (!isAbsolute(options.homeDirectory) || !isAbsolute(options.bridgePath)) {
      throw new Error('Agent 接入服务路径无效');
    }
    this.home = resolve(options.homeDirectory);
    this.bridge = resolve(options.bridgePath);
    this.environment = options.environment ?? process.env;
    this.beforeCommit = options.beforeCommit;
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
      privacy: '仅在本机解析连接配置并修改 AgenticGame 条目；原配置会备份，不上传配置内容。显示已配置后，仍需在客户端确认工具可用。',
    };
  }

  async connect(host: ExternalAgentHostV1): Promise<AgentConnectorResultV1> {
    if (!HOST_META[host]) throw new Error('请选择支持的 AI 队友');
    if (!await isFile(this.bridge)) throw new Error('游戏连接组件缺失，请重新安装或使用完整便携版');
    const config = await this.resolveConfig(host);
    if (!config.installed) throw new Error(`暂未发现 ${HOST_META[host].name}，安装后再来接入`);

    const release = await acquireWriteLease(`${config.path}.agenticgame.lock`);
    try {
    const current = await readOptional(config.path);
    let next: string;
    try {
      next = host === 'codex'
        ? mergeCodexConfig(current ?? '', this.bridge)
        : mergeJsonConfig(current ?? '{}\n', this.bridge);
    } catch {
      throw new Error(`${HOST_META[host].name} 的连接配置损坏或使用了暂不支持的写法；游戏没有改动原配置，请在客户端检查或手动添加连接`);
    }

    const changed = next !== current;
    let backupCreated = false;
    if (changed) {
      if (current !== undefined) {
        backupCreated = await createBackupOnce(config.path);
        if (!backupCreated) {
          await copyFile(config.path, `${config.path}.before-agenticgame-${randomUUID()}.bak`, constants.COPYFILE_EXCL);
          backupCreated = true;
        }
      }
      await writeAtomic(config.path, next, current, this.beforeCommit);
    }
    if (await inspectConfiguration(host, config.path, this.bridge) !== 'configured') throw new Error('连接配置写后校验失败，请在客户端检查。');
    return {
      host,
      configured: true,
      restartRequired: true,
      backupCreated,
      message: `已配置 ${HOST_META[host].name}。请重启它，在新对话中确认 AgenticGame 工具出现并能读取战术版本。`,
    };
    } finally { await release(); }
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
  const original = current.trim() ? parseToml(current) : {};
  const lines = current.replace(/\r\n/g, '\n').split('\n');
  const kept: string[] = [];
  let skipping = false;
  for (const line of lines) {
    const heading = /^\s*(\[.+\])\s*(?:#.*)?$/.exec(line)?.[1];
    if (heading) {
      try {
        const section = parseToml(heading) as Record<string, unknown>;
        skipping = isRecord(section.mcp_servers)
          && Object.keys(section.mcp_servers).some((key) => key === 'agentic_game' || key === 'agentic-game');
      } catch { /* a header-looking line inside a multiline string */ }
    }
    if (!skipping) kept.push(line);
  }
  while (kept.length && kept.at(-1)?.trim() === '') kept.pop();
  const merged = `${kept.length ? `${kept.join('\n')}\n\n` : ''}${createAgentHostConfigV1('codex', bridge)}`;
  const parsed = parseToml(merged);
  if (unownedConfig(original) !== unownedConfig(parsed)) throw new Error('unrelated TOML values changed');
  return merged;
}

function unownedConfig(value: unknown): string {
  const cloned = structuredClone(value) as Record<string, unknown>;
  if (isRecord(cloned.mcp_servers)) {
    delete cloned.mcp_servers.agentic_game; delete cloned.mcp_servers['agentic-game'];
    if (Object.keys(cloned.mcp_servers).length === 0) delete cloned.mcp_servers;
  }
  const sort = (item: unknown): unknown => Array.isArray(item) ? item.map(sort)
    : isRecord(item) && !(item instanceof Date) ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, sort(item[key])])) : item;
  return JSON.stringify(sort(cloned));
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
  try {
    const current = await readOptional(path);
    if (current === undefined) return 'ready';
    if (host === 'codex') {
      const parsed = parseToml(current) as Record<string, unknown>;
      const servers = isRecord(parsed.mcp_servers) ? parsed.mcp_servers : undefined;
      const entry = servers && isRecord(servers.agentic_game) ? servers.agentic_game : undefined;
      return matchesEntry(entry, bridge) ? 'configured' : 'ready';
    }
    const errors: ParseError[] = [];
    const parsed = parseJsonc(current, errors, { allowTrailingComma: true, disallowComments: false });
    if (errors.length || !isRecord(parsed)) return 'needs-attention';
    const servers = isRecord(parsed.mcpServers) ? parsed.mcpServers : undefined;
    const entry = servers && isRecord(servers['agentic-game']) ? servers['agentic-game'] : undefined;
    return matchesEntry(entry, bridge) ? 'configured' : 'ready';
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

async function writeAtomic(path: string, content: string, expected: string | undefined, beforeCommit?: () => Promise<void>): Promise<void> {
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
    await beforeCommit?.();
    if (await readOptional(path) !== expected) throw new Error('客户端配置刚刚发生变化，本次接入已停止，请重新检查后重试。');
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    if ((await stat(path)).size > 2 * 1024 * 1024) throw new Error('连接配置过大，请在客户端检查。');
    return await readFile(path, 'utf8');
  }
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
