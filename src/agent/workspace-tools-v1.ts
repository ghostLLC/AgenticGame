import { join, resolve } from 'node:path';
import type { SavedBuildDraftV2 } from '../config/saved-build-v2.js';
import { SavedBuildRepositoryV2 } from '../config/saved-build-repository-v2.js';
import { GAMEPLAY_CONTENT_V2 } from '../core/v2/gameplay-content.js';
import { BuildRevisionNoteRepositoryV1, type GarageTacticIdV1 } from '../desktop/build-revision-note-repository-v1.js';
import { COMMANDER_BUILD_ID_V1 } from '../desktop/garage-service-v1.js';
import { PracticeMatchServiceV1 } from '../desktop/practice-match-service-v1.js';
import { ReplayRepositoryV2 } from '../replay/repository-v2.js';
import { createReplayStudioViewV2 } from '../replay/studio-v2.js';
import type { AgentToolV1 } from './harness-v1.js';
import { createGameToolsV1 } from './game-tools-v1.js';
import { mapLimited } from '../storage/map-limited.js';

export interface AgentWorkspaceToolsOptionsV1 {
  dataRoot: string;
  now?: () => string;
}

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const WRITE_IDEMPOTENT = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const WRITE_NEW_RECORD = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;

export function createAgentWorkspaceToolsV1(options: AgentWorkspaceToolsOptionsV1): AgentToolV1[] {
  const dataRoot = resolve(options.dataRoot);
  const now = options.now ?? (() => new Date().toISOString());
  const quarantineRoot = join(dataRoot, 'quarantine');
  const builds = new SavedBuildRepositoryV2(join(dataRoot, 'builds'), { quarantineRoot, now });
  const notes = new BuildRevisionNoteRepositoryV1(join(dataRoot, 'build-metadata'), { quarantineRoot, now });
  const replays = new ReplayRepositoryV2(join(dataRoot, 'replays'));
  const practice = new PracticeMatchServiceV1({ buildRepository: builds, replayRepository: replays, now });
  const evaluate = createGameToolsV1({ createdAt: now }).find((tool) => tool.name === 'evaluate_bot');
  if (!evaluate) throw new Error('evaluate_bot is unavailable');

  return [
    {
      name: 'get_player_workspace',
      description: 'Read the player commander, immutable revision history and latest editable JavaScript source from local AgenticGame data.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: READ_ONLY,
      async execute() {
        const inspection = await builds.inspect(COMMANDER_BUILD_ID_V1);
        const revisionNotes = await notes.list(COMMANDER_BUILD_ID_V1).catch(() => []);
        const noteByRevision = new Map(revisionNotes.map((note) => [note.revision, note]));
        const revisions = inspection.revisions.map((item) => item.state === 'healthy' ? {
          revision: item.revision,
          state: item.state,
          label: item.record.label,
          createdAt: item.record.createdAt,
          vehicleId: item.record.loadout.vehicleId,
          weaponId: item.record.loadout.weaponId,
          doctrine: noteByRevision.get(item.revision)?.tacticId ?? 'medium',
          note: noteByRevision.get(item.revision)?.note ?? '',
        } : {
          revision: item.revision,
          state: item.state,
          issue: item.message,
        });
        const current = inspection.latestHealthy;
        return {
          schemaVersion: 1,
          status: inspection.revisions.length === 0 ? 'empty'
            : inspection.revisions.some((item) => item.state !== 'healthy') ? 'damaged' : 'ready',
          revisions,
          ...(current ? { current: {
            revision: current.revision,
            label: current.label,
            vehicleId: current.loadout.vehicleId,
            weaponId: current.loadout.weaponId,
            doctrine: noteByRevision.get(current.revision)?.tacticId ?? 'medium',
            note: noteByRevision.get(current.revision)?.note ?? '',
            source: current.botArtifact.source,
          } } : {}),
          guidance: current
            ? 'Modify current.source, call evaluate_bot, then save_bot_revision. Use run_practice_match against an older revision before reporting completion.'
            : 'Create a complete CommonJS JavaScript bot and save the first revision with save_bot_revision.',
        };
      },
    },
    {
      name: 'save_bot_revision',
      description: 'Evaluate and save complete JavaScript bot source as a new immutable player revision. Repeating identical content does not create duplicates.',
      inputSchema: {
        type: 'object',
        properties: {
          label: { type: 'string', minLength: 1, maxLength: 80 },
          note: { type: 'string', maxLength: 240 },
          doctrine: { type: 'string', enum: ['scout', 'medium', 'heavy'] },
          vehicleId: { type: 'string', enum: GAMEPLAY_CONTENT_V2.vehicles.map((item) => item.id) },
          weaponId: { type: 'string', enum: GAMEPLAY_CONTENT_V2.weapons.map((item) => item.id) },
          source: { type: 'string', minLength: 1, maxLength: 100000 },
        },
        required: ['label', 'note', 'doctrine', 'vehicleId', 'weaponId', 'source'],
        additionalProperties: false,
      },
      annotations: WRITE_IDEMPOTENT,
      async execute(rawInput, context) {
        const input = parseSaveInput(rawInput);
        const inspection = await builds.inspect(COMMANDER_BUILD_ID_V1);
        if (inspection.revisions.some((revision) => revision.state !== 'healthy')) {
          throw new Error('战术版本历史已损坏，请先在游戏整备中心完成隔离。');
        }
        const evaluation = await evaluate.execute({
          source: input.source,
          vehicleId: input.vehicleId,
          weaponId: input.weaponId,
          modeId: 'duel',
          seed: 42,
          maxTicks: 240,
        }, context) as Record<string, unknown>;
        if (evaluation.verified !== true) throw new Error('候选未通过真实沙盒验证。');
        const latest = inspection.latestHealthy;
        const draft: SavedBuildDraftV2 = {
          buildId: COMMANDER_BUILD_ID_V1,
          label: input.label,
          bot: {
            artifactId: 'commander-main-bot',
            version: latest ? `1.0.${latest.revision}` : '1.0.0',
            language: 'javascript',
            entryPoint: 'commander-main.js',
            source: input.source,
          },
          loadout: { vehicleId: input.vehicleId, weaponId: input.weaponId, equipmentIds: [] },
        };
        const createdAt = now();
        context?.signal?.throwIfAborted();
        const saved = await builds.save(draft, createdAt, {
          expectedRevision: latest?.revision ?? 0,
          beforePublish: async (record) => { await notes.save({
            version: 1,
            buildId: COMMANDER_BUILD_ID_V1,
            revision: record.revision,
            tacticId: input.doctrine,
            note: input.note,
            createdAt: record.createdAt,
          }, { replace: true }); },
        });
        return {
          schemaVersion: 1,
          created: saved.created,
          revision: saved.record.revision,
          label: saved.record.label,
          evaluation,
          next: 'Run run_practice_match against an older revision, then inspect list_battle_history.',
        };
      },
    },
    {
      name: 'run_practice_match',
      description: 'Run two saved player revisions through the real Gameplay v2 worker sandbox and persist the verified replay in the game library.',
      inputSchema: {
        type: 'object',
        properties: {
          currentRevision: { type: 'integer', minimum: 1 },
          opponentRevision: { type: 'integer', minimum: 1 },
          modeId: { type: 'string', enum: ['duel', 'capture'] },
          seed: { type: 'integer', minimum: 0, maximum: 4294967295 },
        },
        required: ['currentRevision', 'opponentRevision', 'modeId'],
        additionalProperties: false,
      },
      annotations: WRITE_NEW_RECORD,
      async execute(input, context) {
        return await practice.run(input as unknown as Parameters<PracticeMatchServiceV1['run']>[0], context?.signal) as unknown as Record<string, unknown>;
      },
    },
    {
      name: 'list_battle_history',
      description: 'List recent verified practice battles created by the game or an external agent without exposing bot source, raw actions or debug logs.',
      inputSchema: {
        type: 'object',
        properties: { limit: { type: 'integer', minimum: 1, maximum: 50 } },
        additionalProperties: false,
      },
      annotations: READ_ONLY,
      async execute(input) {
        const limit = input.limit === undefined ? 10 : input.limit;
        if (!Number.isSafeInteger(limit) || (limit as number) < 1 || (limit as number) > 50) {
          throw new Error('limit 必须是 1 到 50 的整数。');
        }
        const inspections = await replays.inspect();
        const selected = inspections.filter((inspection) => inspection.state === 'healthy').slice(0, limit as number);
        const battles = await mapLimited(selected, 4, (inspection) => toBattleCard(replays, inspection.bundleHash));
        return { schemaVersion: 1, count: battles.length, battles };
      },
    },
  ];
}

async function toBattleCard(replays: ReplayRepositoryV2, bundleHash: string) {
  const studio = createReplayStudioViewV2(await replays.load(bundleHash));
  const player = studio.participants.find((item) => item.teamId === 'current');
  return {
    source: 'practice',
    createdAt: studio.createdAt,
    modeName: studio.modeName,
    outcome: player?.outcome === 'winner' ? 'victory' : player?.outcome === 'defeated' ? 'defeat' : 'draw',
    ticks: studio.result.ticks,
    participants: studio.participants.map((item) => item.displayName),
    moments: studio.moments.slice(0, 5).map(({ tick, title, summary }) => ({ tick, title, summary })),
    integrity: 'verified',
  };
}

function parseSaveInput(input: Record<string, unknown>): {
  label: string; note: string; doctrine: GarageTacticIdV1; vehicleId: string; weaponId: string; source: string;
} {
  if (!input || typeof input !== 'object') throw new Error('战术版本输入无效。');
  const label = text(input.label, 'label', 1, 80);
  const note = text(input.note, 'note', 0, 240);
  const source = text(input.source, 'source', 1, 100_000);
  if (!['scout', 'medium', 'heavy'].includes(String(input.doctrine))) throw new Error('doctrine 无效。');
  const vehicle = GAMEPLAY_CONTENT_V2.vehicles.find((item) => item.id === input.vehicleId);
  const weapon = GAMEPLAY_CONTENT_V2.weapons.find((item) => item.id === input.weaponId);
  if (!vehicle) throw new Error('vehicleId 无效。');
  if (!weapon) throw new Error('weaponId 无效。');
  if (!vehicle.compatibleWeaponIds.includes(weapon.id)) throw new Error('所选主炮与战车不兼容。');
  return { label, note, source, doctrine: input.doctrine as GarageTacticIdV1, vehicleId: vehicle.id, weaponId: weapon.id };
}

function text(value: unknown, name: string, minimum: number, maximum: number): string {
  if (typeof value !== 'string' || value.trim() !== value || [...value].length < minimum || [...value].length > maximum) {
    throw new Error(`${name} 必须是长度 ${minimum}-${maximum} 的已整理文本。`);
  }
  return value;
}
