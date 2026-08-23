import { describe, expect, it } from 'vitest';
import {
  assertMatchConfigV2,
  fingerprintMatchConfigV2,
  MatchConfigValidationError,
  validateMatchConfigV2,
  type MatchConfigV2,
  type ValidationIssue,
} from '../src/core/v2/match-config.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function validConfig(): MatchConfigV2 {
  return {
    schemaVersion: 2,
    matchId: 'practice-001',
    ruleset: { id: 'core-rules', version: '2.0.0-alpha.1' },
    modeId: 'duel',
    mapId: 'training-ground',
    seed: 42,
    maxTicks: 1500,
    teams: [
      {
        teamId: 'blue',
        displayName: '蓝队',
        bot: { artifactId: 'bot-blue', version: '1.0.0', codeHash: HASH_A },
        loadout: {
          vehicleId: 'medium-mk1',
          weaponIds: ['cannon-75'],
          equipmentIds: ['optics-basic'],
        },
      },
      {
        teamId: 'red',
        displayName: '红队',
        bot: { artifactId: 'bot-red', version: '1.1.0', codeHash: HASH_B },
        loadout: {
          vehicleId: 'light-mk1',
          weaponIds: ['cannon-50'],
          equipmentIds: [],
        },
      },
    ],
  };
}

function issuesOf(input: unknown): ValidationIssue[] {
  const result = validateMatchConfigV2(input);
  expect(result.ok).toBe(false);
  return result.ok ? [] : result.issues;
}

function expectIssue(input: unknown, path: string, code: string): void {
  expect(issuesOf(input)).toEqual(expect.arrayContaining([expect.objectContaining({ path, code })]));
}

describe('MatchConfigV2', () => {
  it('accepts a valid two-team match configuration', () => {
    const config = validConfig();
    expect(validateMatchConfigV2(config)).toEqual({ ok: true, value: config });
    expect(fingerprintMatchConfigV2(config)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('fingerprints object keys canonically while keeping team order significant', () => {
    const config = validConfig();
    const reorderedKeys: MatchConfigV2 = {
      teams: config.teams,
      maxTicks: config.maxTicks,
      seed: config.seed,
      mapId: config.mapId,
      modeId: config.modeId,
      ruleset: { version: config.ruleset.version, id: config.ruleset.id },
      matchId: config.matchId,
      schemaVersion: 2,
    };
    const reversedTeams: MatchConfigV2 = {
      ...config,
      teams: [...config.teams].reverse(),
    };

    expect(fingerprintMatchConfigV2(reorderedKeys)).toBe(fingerprintMatchConfigV2(config));
    expect(fingerprintMatchConfigV2(reversedTeams)).not.toBe(fingerprintMatchConfigV2(config));
  });

  it('rejects unknown keys at the root and in nested persisted objects', () => {
    expectIssue({ ...validConfig(), extra: true }, '$.extra', 'unknown_key');

    const nested = structuredClone(validConfig()) as MatchConfigV2 & {
      teams: Array<MatchConfigV2['teams'][number] & { bot: MatchConfigV2['teams'][number]['bot'] & { extra?: boolean } }>;
    };
    nested.teams[0]!.bot.extra = true;
    expectIssue(nested, '$.teams[0].bot.extra', 'unknown_key');
  });

  it.each([
    {
      name: 'schema version',
      path: '$.schemaVersion',
      code: 'invalid_literal',
      mutate: (config: Record<string, unknown>) => { config.schemaVersion = 1; },
    },
    {
      name: 'stable match id',
      path: '$.matchId',
      code: 'invalid_id',
      mutate: (config: Record<string, unknown>) => { config.matchId = 'Practice 001'; },
    },
    {
      name: 'semantic ruleset version',
      path: '$.ruleset.version',
      code: 'invalid_version',
      mutate: (config: Record<string, unknown>) => {
        (config.ruleset as Record<string, unknown>).version = 'v2';
      },
    },
    {
      name: 'semantic artifact prerelease version',
      path: '$.teams[0].bot.version',
      code: 'invalid_version',
      mutate: (config: Record<string, unknown>) => {
        const teams = config.teams as Array<Record<string, unknown>>;
        (teams[0]!.bot as Record<string, unknown>).version = '1.0.0-01';
      },
    },
    {
      name: 'uint32 seed',
      path: '$.seed',
      code: 'out_of_range',
      mutate: (config: Record<string, unknown>) => { config.seed = 4_294_967_296; },
    },
    {
      name: 'positive max ticks',
      path: '$.maxTicks',
      code: 'out_of_range',
      mutate: (config: Record<string, unknown>) => { config.maxTicks = 0; },
    },
    {
      name: 'at least two teams',
      path: '$.teams',
      code: 'too_short',
      mutate: (config: Record<string, unknown>) => {
        config.teams = (config.teams as unknown[]).slice(0, 1);
      },
    },
    {
      name: 'unique team ids',
      path: '$.teams[1].teamId',
      code: 'duplicate',
      mutate: (config: Record<string, unknown>) => {
        const teams = config.teams as Array<Record<string, unknown>>;
        teams[1]!.teamId = teams[0]!.teamId;
      },
    },
    {
      name: 'trimmed display name',
      path: '$.teams[0].displayName',
      code: 'invalid_string',
      mutate: (config: Record<string, unknown>) => {
        const teams = config.teams as Array<Record<string, unknown>>;
        teams[0]!.displayName = ' 蓝队';
      },
    },
    {
      name: 'full source hash',
      path: '$.teams[0].bot.codeHash',
      code: 'invalid_hash',
      mutate: (config: Record<string, unknown>) => {
        const teams = config.teams as Array<Record<string, unknown>>;
        (teams[0]!.bot as Record<string, unknown>).codeHash = 'abcd';
      },
    },
    {
      name: 'at least one weapon',
      path: '$.teams[0].loadout.weaponIds',
      code: 'too_short',
      mutate: (config: Record<string, unknown>) => {
        const teams = config.teams as Array<Record<string, unknown>>;
        (teams[0]!.loadout as Record<string, unknown>).weaponIds = [];
      },
    },
    {
      name: 'unique weapons',
      path: '$.teams[0].loadout.weaponIds[1]',
      code: 'duplicate',
      mutate: (config: Record<string, unknown>) => {
        const teams = config.teams as Array<Record<string, unknown>>;
        (teams[0]!.loadout as Record<string, unknown>).weaponIds = ['cannon-75', 'cannon-75'];
      },
    },
    {
      name: 'unique equipment',
      path: '$.teams[0].loadout.equipmentIds[1]',
      code: 'duplicate',
      mutate: (config: Record<string, unknown>) => {
        const teams = config.teams as Array<Record<string, unknown>>;
        (teams[0]!.loadout as Record<string, unknown>).equipmentIds = ['optics-basic', 'optics-basic'];
      },
    },
  ])('rejects an invalid $name', ({ path, code, mutate }) => {
    const config = structuredClone(validConfig()) as unknown as Record<string, unknown>;
    mutate(config);
    expectIssue(config, path, code);
  });

  it('throws a typed error containing issues when assertion fails', () => {
    const config = { ...validConfig(), maxTicks: 0 };
    expect(() => assertMatchConfigV2(config)).toThrow(MatchConfigValidationError);

    try {
      assertMatchConfigV2(config);
    } catch (error) {
      expect(error).toBeInstanceOf(MatchConfigValidationError);
      expect((error as MatchConfigValidationError).issues).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: '$.maxTicks', code: 'out_of_range' })]),
      );
    }
  });
});
