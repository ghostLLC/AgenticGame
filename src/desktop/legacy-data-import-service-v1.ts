import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import type { SavedBuildRepositoryV2 } from '../config/saved-build-repository-v2.js';
import { assertFriendRoomReplayV1, type FriendRoomReplayV1 } from '../friend-room/replay-v1.js';
import type { PublicReplayRepositoryV1 } from './public-replay-repository-v1.js';

const MAX_FILES = 50;
const MAX_BOT_BYTES = 1_000_000;
const MAX_REPLAY_BYTES = 20_000_000;

export interface LegacyImportResultV1 {
  buildsImported: number;
  replaysImported: number;
  skipped: number;
}

export interface LegacyDataImportOptionsV1 {
  buildRepository: SavedBuildRepositoryV2;
  publicReplayRepository: PublicReplayRepositoryV1;
}

export class LegacyDataImportServiceV1 {
  constructor(private readonly options: LegacyDataImportOptionsV1) {}

  async importFrom(selectedRoot: string): Promise<LegacyImportResultV1> {
    if (typeof selectedRoot !== 'string' || !selectedRoot.trim()) throw new Error('没有选择旧版数据目录');
    const root = resolve(selectedRoot);
    const result: LegacyImportResultV1 = { buildsImported: 0, replaysImported: 0, skipped: 0 };
    const existing = await this.options.buildRepository.list('commander-main').catch(() => []);
    const knownSourceHashes = new Set(existing.map((item) => item.botArtifact.codeHash));

    for (const path of await directFiles(join(root, 'my-bots'), '.js', result)) {
      try {
        const stat = await lstat(path);
        if (!stat.isFile() || stat.size < 1 || stat.size > MAX_BOT_BYTES) throw new Error('invalid bot');
        const source = await readFile(path, 'utf8');
        const sourceHash = sha256(source);
        if (knownSourceHashes.has(sourceHash)) throw new Error('duplicate bot');
        const stem = safeLabel(basename(path, '.js'));
        const save = await this.options.buildRepository.save({
          buildId: 'commander-main',
          label: `导入 · ${stem}`.slice(0, 80),
          bot: {
            artifactId: `legacy-${sha256(basename(path)).slice(0, 16)}`,
            version: '1.0.0', language: 'javascript', entryPoint: `${stem}.js`, source,
          },
          loadout: { vehicleId: 'medium', weaponId: 'medium-cannon', equipmentIds: [] },
        });
        if (!save.created) throw new Error('duplicate bot');
        knownSourceHashes.add(sourceHash);
        result.buildsImported += 1;
      } catch { result.skipped += 1; }
    }

    for (const path of await directFiles(join(root, 'replays'), '.json', result)) {
      try {
        const stat = await lstat(path);
        if (!stat.isFile() || stat.size < 2 || stat.size > MAX_REPLAY_BYTES) throw new Error('invalid replay');
        const source = await readFile(path, 'utf8');
        const legacy = JSON.parse(source) as unknown;
        const converted = convertLegacyReplayV1(legacy);
        const save = await this.options.publicReplayRepository.save({
          replay: converted,
          createdAt: canonicalInstant(record(legacy).createdAt),
          localTeamId: 'legacy-a',
          completionKey: sha256(source),
        });
        if (!save.created) throw new Error('duplicate replay');
        result.replaysImported += 1;
      } catch { result.skipped += 1; }
    }
    return result;
  }
}

async function directFiles(directory: string, extension: string, result: LegacyImportResultV1): Promise<string[]> {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  const matches = entries
    .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === extension)
    .sort((a, b) => a.name.localeCompare(b.name));
  if (matches.length > MAX_FILES) result.skipped += matches.length - MAX_FILES;
  return matches.slice(0, MAX_FILES).map((entry) => join(directory, entry.name));
}

export function convertLegacyReplayV1(value: unknown): FriendRoomReplayV1 {
  const root = record(value);
  if (root.format !== 'tank-arena-replay' || root.version !== 1) invalid();
  const createdAt = canonicalInstant(root.createdAt);
  void createdAt;
  const rules = record(root.rules);
  const width = boundedInteger(rules.fieldWidth, 1, 512);
  const height = boundedInteger(rules.fieldHeight, 1, 512);
  const maxHp = boundedInteger(rules.maxHp, 1, 1_000_000);
  const bots = boundedArray(root.bots, 2, 2).map((value, index) => {
    const bot = record(value);
    return { teamId: index === 0 ? 'legacy-a' : 'legacy-b', displayName: boundedText(bot.name, 1, 80) };
  });
  const rawFrames = boundedArray(root.frames, 1, 20_000);
  const byTick = new Map<number, FriendRoomReplayV1['frames'][number]>();
  for (const rawFrame of rawFrames) {
    const frame = record(rawFrame);
    const tick = boundedInteger(frame.tick, 0, 1_000_000);
    const tanks = boundedArray(frame.tanks, 2, 2).map((value) => {
      const tank = record(value);
      const id = boundedInteger(tank.id, 0, 1);
      return {
        teamId: id === 0 ? 'legacy-a' : 'legacy-b',
        displayName: bots[id]!.displayName,
        vehicleName: '经典战车',
        x: boundedInteger(tank.x, 0, width - 1), y: boundedInteger(tank.y, 0, height - 1),
        hp: Math.max(0, Math.min(maxHp, boundedInteger(tank.hp, -1_000_000, 1_000_000))), maxHp,
        bodyDirection: boundedInteger(tank.dirBody, 0, 7), turretDirection: boundedInteger(tank.dirTurret, 0, 7),
        ammunition: 0, alive: tank.alive === true,
      };
    });
    const projectiles = boundedArray(frame.bullets, 0, 4_096).flatMap((value) => {
      const shot = record(value);
      const owner = boundedInteger(shot.ownerId, 0, 1);
      const x = boundedInteger(shot.x, -1_024, 1_024);
      const y = boundedInteger(shot.y, -1_024, 1_024);
      if (x < 0 || x >= width || y < 0 || y >= height) return [];
      return [{
        id: boundedInteger(shot.id, 0, Number.MAX_SAFE_INTEGER), ownerTeamId: owner === 0 ? 'legacy-a' : 'legacy-b',
        x, y, direction: boundedInteger(shot.dir, 0, 7),
      }];
    });
    byTick.set(tick, { tick, tanks, projectiles, objective: null });
  }
  const frames = [...byTick.values()].sort((a, b) => a.tick - b.tick);
  const ticks = frames.at(-1)!.tick;
  const result = record(root.result);
  const winner = result.winner;
  const winningTeamIds = winner === 0 ? ['legacy-a'] : winner === 1 ? ['legacy-b'] : [];
  const reason = safeStableReason(result.reason);
  return assertFriendRoomReplayV1({
    version: 1,
    modeName: '经典对决',
    map: { id: safeStableId(root.mapId, 'legacy-map'), width, height, terrainCells: [], captureZones: [] },
    participants: bots.map((bot) => ({ ...bot, vehicleName: '经典战车', weaponName: '经典主炮' })),
    result: { winningTeamIds, reason, ticks },
    moments: [
      { tick: frames[0]!.tick, kind: 'start', title: '经典对局开始', summary: '从旧版 AgenticGame 导入。', teamIds: [] },
      { tick: ticks, kind: 'result', title: winningTeamIds.length ? '经典对局结束' : '经典对局平局', summary: '旧版战报已转换为安全回放。', teamIds: winningTeamIds },
    ],
    frames,
  });
}

function safeLabel(value: string): string {
  const trimmed = value.trim().replace(/[\u0000-\u001f]/g, '');
  return trimmed ? [...trimmed].slice(0, 60).join('') : '旧版战术';
}

function safeStableId(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/.test(value) && value.length <= 64 ? value : fallback;
}

function safeStableReason(value: unknown): string {
  return typeof value === 'string' && /^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/.test(value) && value.length <= 80 ? value : 'legacy-result';
}

function canonicalInstant(value: unknown): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) invalid();
  return value;
}

function boundedText(value: unknown, minimum: number, maximum: number): string {
  if (typeof value !== 'string' || value.trim() !== value || [...value].length < minimum || [...value].length > maximum) invalid();
  return value;
}

function boundedArray(value: unknown, minimum: number, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) invalid();
  return value;
}

function boundedInteger(value: unknown, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) invalid();
  return value as number;
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}

function sha256(value: string): string { return createHash('sha256').update(value, 'utf8').digest('hex'); }
function invalid(): never { throw new Error('旧版数据未通过安全检查'); }
function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
