import { hashJson, type JsonValue } from './json.js';

export interface MatchConfigV2 {
  schemaVersion: 2;
  matchId: string;
  ruleset: {
    id: string;
    version: string;
  };
  modeId: string;
  mapId: string;
  seed: number;
  maxTicks: number;
  teams: MatchTeamConfigV2[];
}

export interface MatchTeamConfigV2 {
  teamId: string;
  displayName: string;
  bot: {
    artifactId: string;
    version: string;
    codeHash: string;
  };
  loadout: {
    vehicleId: string;
    weaponIds: string[];
    equipmentIds: string[];
  };
}

export interface ValidationIssue {
  path: string;
  code: string;
  message: string;
}

export type MatchConfigValidationResult =
  | { ok: true; value: MatchConfigV2 }
  | { ok: false; issues: ValidationIssue[] };

const STABLE_ID = /^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/;
const SEMVER_IDENTIFIER = '(?:0|[1-9]\\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)';
const SEMVER = new RegExp(
  `^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-${SEMVER_IDENTIFIER}(?:\\.${SEMVER_IDENTIFIER})*)?$`,
);
const SHA256 = /^[0-9a-f]{64}$/;

type UnknownRecord = Record<string, unknown>;

export function validateMatchConfigV2(input: unknown): MatchConfigValidationResult {
  const issues: ValidationIssue[] = [];
  const root = validateRecord(
    input,
    '$',
    ['schemaVersion', 'matchId', 'ruleset', 'modeId', 'mapId', 'seed', 'maxTicks', 'teams'],
    issues,
  );
  if (!root) return { ok: false, issues };

  if (root.schemaVersion !== 2) {
    addIssue(issues, '$.schemaVersion', 'invalid_literal', 'schemaVersion must equal 2');
  }
  validateStableId(root.matchId, '$.matchId', issues);
  validateStableId(root.modeId, '$.modeId', issues);
  validateStableId(root.mapId, '$.mapId', issues);
  validateInteger(root.seed, '$.seed', 0, 0xffff_ffff, issues);
  validateInteger(root.maxTicks, '$.maxTicks', 1, Number.MAX_SAFE_INTEGER, issues);

  const ruleset = validateRecord(root.ruleset, '$.ruleset', ['id', 'version'], issues);
  if (ruleset) {
    validateStableId(ruleset.id, '$.ruleset.id', issues);
    validateVersion(ruleset.version, '$.ruleset.version', issues);
  }

  if (!Array.isArray(root.teams)) {
    addIssue(issues, '$.teams', 'invalid_type', 'teams must be an array');
  } else {
    if (root.teams.length < 2) {
      addIssue(issues, '$.teams', 'too_short', 'teams must contain at least two entries');
    }
    const teamIds = new Set<string>();
    root.teams.forEach((teamValue, index) => {
      const path = `$.teams[${index}]`;
      const team = validateRecord(teamValue, path, ['teamId', 'displayName', 'bot', 'loadout'], issues);
      if (!team) return;

      const teamIdValid = validateStableId(team.teamId, `${path}.teamId`, issues);
      if (teamIdValid) {
        const teamId = team.teamId as string;
        if (teamIds.has(teamId)) {
          addIssue(issues, `${path}.teamId`, 'duplicate', `Duplicate teamId: ${teamId}`);
        }
        teamIds.add(teamId);
      }

      validateDisplayName(team.displayName, `${path}.displayName`, issues);
      validateBot(team.bot, `${path}.bot`, issues);
      validateLoadout(team.loadout, `${path}.loadout`, issues);
    });
  }

  return issues.length > 0
    ? { ok: false, issues }
    : { ok: true, value: input as MatchConfigV2 };
}

export class MatchConfigValidationError extends Error {
  readonly issues: readonly ValidationIssue[];

  constructor(issues: readonly ValidationIssue[]) {
    super(`Invalid MatchConfigV2 (${issues.length} issue${issues.length === 1 ? '' : 's'})`);
    this.name = 'MatchConfigValidationError';
    this.issues = issues;
  }
}

export function assertMatchConfigV2(input: unknown): MatchConfigV2 {
  const validation = validateMatchConfigV2(input);
  if (!validation.ok) throw new MatchConfigValidationError(validation.issues);
  return validation.value;
}

export function fingerprintMatchConfigV2(config: MatchConfigV2): string {
  const validated = assertMatchConfigV2(config);
  return hashJson(validated as unknown as JsonValue);
}

function addIssue(issues: ValidationIssue[], path: string, code: string, message: string): void {
  issues.push({ path, code, message });
}

function validateRecord(
  value: unknown,
  path: string,
  allowedKeys: readonly string[],
  issues: ValidationIssue[],
): UnknownRecord | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    addIssue(issues, path, 'invalid_type', `${path} must be an object`);
    return null;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    addIssue(issues, path, 'invalid_type', `${path} must be a plain object`);
    return null;
  }
  const record = value as UnknownRecord;
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) addIssue(issues, `${path}.${key}`, 'unknown_key', `Unknown key: ${key}`);
  }
  return record;
}

function validateStableId(value: unknown, path: string, issues: ValidationIssue[]): boolean {
  if (typeof value !== 'string') {
    addIssue(issues, path, 'invalid_type', `${path} must be a string`);
    return false;
  }
  if (value.length === 0 || value.length > 64 || !STABLE_ID.test(value)) {
    addIssue(issues, path, 'invalid_id', `${path} must be a lowercase stable ID of at most 64 characters`);
    return false;
  }
  return true;
}

function validateVersion(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (typeof value !== 'string') {
    addIssue(issues, path, 'invalid_type', `${path} must be a string`);
  } else if (!SEMVER.test(value)) {
    addIssue(issues, path, 'invalid_version', `${path} must be a semantic version`);
  }
}

function validateInteger(
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
  issues: ValidationIssue[],
): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    addIssue(issues, path, 'invalid_integer', `${path} must be a finite integer`);
  } else if (value < minimum || value > maximum) {
    addIssue(issues, path, 'out_of_range', `${path} must be between ${minimum} and ${maximum}`);
  }
}

function validateDisplayName(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (typeof value !== 'string') {
    addIssue(issues, path, 'invalid_type', `${path} must be a string`);
  } else if (value.length < 1 || value.length > 80 || value.trim() !== value) {
    addIssue(issues, path, 'invalid_string', `${path} must be trimmed and contain 1-80 characters`);
  }
}

function validateBot(value: unknown, path: string, issues: ValidationIssue[]): void {
  const bot = validateRecord(value, path, ['artifactId', 'version', 'codeHash'], issues);
  if (!bot) return;
  validateStableId(bot.artifactId, `${path}.artifactId`, issues);
  validateVersion(bot.version, `${path}.version`, issues);
  if (typeof bot.codeHash !== 'string') {
    addIssue(issues, `${path}.codeHash`, 'invalid_type', `${path}.codeHash must be a string`);
  } else if (!SHA256.test(bot.codeHash)) {
    addIssue(issues, `${path}.codeHash`, 'invalid_hash', `${path}.codeHash must be a lowercase SHA-256 hash`);
  }
}

function validateLoadout(value: unknown, path: string, issues: ValidationIssue[]): void {
  const loadout = validateRecord(value, path, ['vehicleId', 'weaponIds', 'equipmentIds'], issues);
  if (!loadout) return;
  validateStableId(loadout.vehicleId, `${path}.vehicleId`, issues);
  validateIdArray(loadout.weaponIds, `${path}.weaponIds`, 1, issues);
  validateIdArray(loadout.equipmentIds, `${path}.equipmentIds`, 0, issues);
}

function validateIdArray(value: unknown, path: string, minimumLength: number, issues: ValidationIssue[]): void {
  if (!Array.isArray(value)) {
    addIssue(issues, path, 'invalid_type', `${path} must be an array`);
    return;
  }
  if (value.length < minimumLength) {
    addIssue(issues, path, 'too_short', `${path} must contain at least ${minimumLength} item(s)`);
  }
  const seen = new Set<string>();
  value.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    if (!validateStableId(item, itemPath, issues)) return;
    const id = item as string;
    if (seen.has(id)) addIssue(issues, itemPath, 'duplicate', `Duplicate ID: ${id}`);
    seen.add(id);
  });
}
