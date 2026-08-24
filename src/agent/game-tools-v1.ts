import { GAMEPLAY_CONTENT_V2, GAMEPLAY_MAP_FRONTIER_V2 } from '../core/v2/gameplay-content.js';
import type { MatchConfigV2 } from '../core/v2/match-config.js';
import { verifyMatchBundleV2 } from '../replay/v2.js';
import { runMatchV2 } from '../runner/match-v2.js';
import { fullCodeHash } from '../runner/v2-adapter.js';
import type { AgentToolV1 } from './harness-v1.js';

const BASELINE_BOT_SOURCE = `
module.exports = function createTank() {
  return {
    name: 'Baseline Sentry',
    onTick(view) {
      const target = view.visibleEnemies && view.visibleEnemies[0];
      return { throttle: 0, bodyTurn: 0, turretTurn: target ? 1 : 0, fire: Boolean(target) };
    }
  };
};`;

export interface GameToolsOptionsV1 {
  createdAt?: () => string;
}

export function createGameToolsV1(options: GameToolsOptionsV1 = {}): AgentToolV1[] {
  return [
    {
      name: 'get_game_context',
      description: 'Get the current official Tank Arena vehicles, weapons, modes, map and bot interface summary.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      async execute() {
        return {
          schemaVersion: 1,
          game: 'AgenticGame: Tank Arena',
          ruleset: { id: 'gameplay-v2', version: '2.0.0' },
          vehicles: GAMEPLAY_CONTENT_V2.vehicles.map((vehicle) => ({
            id: vehicle.id, name: vehicle.displayName, role: vehicle.role,
            hp: vehicle.maxHp, armor: { ...vehicle.armor }, mobility: { ...vehicle.mobility },
            visionRange: vehicle.vision.rangeCells, compatibleWeaponIds: [...vehicle.compatibleWeaponIds],
          })),
          weapons: GAMEPLAY_CONTENT_V2.weapons.map((weapon) => ({ ...weapon })),
          modes: GAMEPLAY_CONTENT_V2.modes.map((mode) => ({ ...mode, victory: { ...mode.victory } })),
          map: {
            id: GAMEPLAY_MAP_FRONTIER_V2.id,
            version: GAMEPLAY_MAP_FRONTIER_V2.version,
            width: GAMEPLAY_MAP_FRONTIER_V2.width,
            height: GAMEPLAY_MAP_FRONTIER_V2.height,
            captureZones: GAMEPLAY_MAP_FRONTIER_V2.captureZones?.length ?? 0,
          },
          botInterface: {
            language: 'javascript', module: 'CommonJS factory', entry: 'module.exports = function createTank(ctx)',
            tickMethod: 'onTick(view)', actionFields: ['throttle', 'bodyTurn', 'turretTurn', 'fire'],
          },
        };
      },
    },
    {
      name: 'evaluate_bot',
      description: 'Run JavaScript bot source against the deterministic official baseline in the real v2 sandbox.',
      inputSchema: {
        type: 'object',
        properties: {
          source: { type: 'string', description: 'Complete CommonJS bot source, at most 100000 characters.' },
          modeId: { type: 'string', enum: GAMEPLAY_CONTENT_V2.modes.map((mode) => mode.id) },
          vehicleId: { type: 'string', enum: GAMEPLAY_CONTENT_V2.vehicles.map((vehicle) => vehicle.id) },
          weaponId: { type: 'string', enum: GAMEPLAY_CONTENT_V2.weapons.map((weapon) => weapon.id) },
          seed: { type: 'integer', minimum: 0, maximum: 4294967295 },
          maxTicks: { type: 'integer', minimum: 1, maximum: 1000 },
        },
        required: ['source'],
        additionalProperties: false,
      },
      async execute(rawInput) {
        const input = parseEvaluationInput(rawInput);
        const candidateHash = fullCodeHash(input.source);
        const baselineHash = fullCodeHash(BASELINE_BOT_SOURCE);
        const config: MatchConfigV2 = {
          schemaVersion: 2,
          matchId: `agent-eval-${candidateHash.slice(0, 12)}`,
          ruleset: { id: 'gameplay-v2', version: '2.0.0' },
          modeId: input.modeId,
          mapId: GAMEPLAY_MAP_FRONTIER_V2.id,
          seed: input.seed,
          maxTicks: input.maxTicks,
          teams: [
            {
              teamId: 'candidate', displayName: 'Candidate',
              bot: { artifactId: 'candidate-bot', version: '1.0.0', codeHash: candidateHash },
              loadout: { vehicleId: input.vehicleId, weaponIds: [input.weaponId], equipmentIds: [] },
            },
            {
              teamId: 'baseline', displayName: 'Baseline Sentry',
              bot: { artifactId: 'baseline-sentry-v1', version: '1.0.0', codeHash: baselineHash },
              loadout: { vehicleId: 'medium', weaponIds: ['medium-cannon'], equipmentIds: [] },
            },
          ],
        };
        const output = await runMatchV2({
          matchConfig: config,
          contentSnapshot: GAMEPLAY_CONTENT_V2,
          mapSnapshot: GAMEPLAY_MAP_FRONTIER_V2,
          bots: [{ path: 'candidate.js', code: input.source }, { path: 'baseline-sentry-v1.js', code: BASELINE_BOT_SOURCE }],
          createdAt: options.createdAt?.() ?? new Date().toISOString(),
          tickBudgetMs: 100,
          collectLogs: false,
        });
        const verification = verifyMatchBundleV2(output.bundle);
        if (!verification.ok) throw new Error('Generated match bundle failed integrity verification');
        const winner = output.summary.winningTeamIds;
        return {
          schemaVersion: 1,
          verified: true,
          bundleHash: output.bundle.integrity.bundleHash,
          opponent: 'baseline-sentry-v1',
          outcome: winner.includes('candidate') ? 'win' : winner.includes('baseline') ? 'loss' : 'draw',
          result: { reason: output.summary.reason, ticks: output.summary.ticks },
          candidate: {
            hp: output.summary.hp[0], ammunition: output.summary.ammunition[0], violations: output.summary.violations[0],
          },
          baseline: {
            hp: output.summary.hp[1], ammunition: output.summary.ammunition[1], violations: output.summary.violations[1],
          },
        };
      },
    },
  ];
}

function parseEvaluationInput(input: Record<string, unknown>): {
  source: string; modeId: string; vehicleId: string; weaponId: string; seed: number; maxTicks: number;
} {
  const source = input.source;
  if (typeof source !== 'string' || source.length < 1 || source.length > 100_000) {
    throw new Error('source must be a non-empty string of at most 100000 characters');
  }
  const modeId = stringWithDefault(input.modeId, 'duel');
  const vehicleId = stringWithDefault(input.vehicleId, 'medium');
  const weaponId = stringWithDefault(input.weaponId, 'medium-cannon');
  const mode = GAMEPLAY_CONTENT_V2.modes.find((item) => item.id === modeId);
  const vehicle = GAMEPLAY_CONTENT_V2.vehicles.find((item) => item.id === vehicleId);
  const weapon = GAMEPLAY_CONTENT_V2.weapons.find((item) => item.id === weaponId);
  if (!mode) throw new Error(`Unknown modeId: ${modeId}`);
  if (!vehicle) throw new Error(`Unknown vehicleId: ${vehicleId}`);
  if (!weapon) throw new Error(`Unknown weaponId: ${weaponId}`);
  if (!vehicle.compatibleWeaponIds.includes(weapon.id)) {
    throw new Error(`Weapon ${weaponId} is not compatible with vehicle ${vehicleId}`);
  }
  return {
    source,
    modeId,
    vehicleId,
    weaponId,
    seed: integerWithDefault(input.seed, 42, 0, 0xffff_ffff, 'seed'),
    maxTicks: integerWithDefault(input.maxTicks, 240, 1, 1000, 'maxTicks'),
  };
}

function stringWithDefault(value: unknown, fallback: string): string {
  if (value === undefined) return fallback;
  if (typeof value !== 'string') throw new Error('Expected a string value');
  return value;
}

function integerWithDefault(value: unknown, fallback: number, minimum: number, maximum: number, name: string): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value as number;
}
