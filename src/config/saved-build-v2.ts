import { createHash } from 'node:crypto';
import { hashJson, type JsonValue } from '../core/v2/json.js';

export interface SavedBuildDraftV2 {
  buildId: string;
  label: string;
  bot: {
    artifactId: string;
    version: string;
    language: 'javascript' | 'typescript';
    entryPoint: string;
    source: string;
  };
  loadout: {
    vehicleId: string;
    weaponId: string;
    equipmentIds: string[];
  };
}

export interface SavedBuildV2 {
  format: 'agentic-game-saved-build';
  schemaVersion: 2;
  buildId: string;
  revision: number;
  createdAt: string;
  label: string;
  parentFingerprint: string | null;
  botArtifact: {
    artifactId: string;
    version: string;
    codeHash: string;
    language: 'javascript' | 'typescript';
    entryPoint: string;
    source: string;
  };
  loadout: {
    vehicleId: string;
    weaponId: string;
    equipmentIds: string[];
  };
  contentFingerprint: string;
  fingerprint: string;
}

export interface SavedBuildIssueV2 {
  path: string;
  code: string;
  message: string;
}

export interface SavedBuildVerificationV2 {
  ok: boolean;
  issues: SavedBuildIssueV2[];
}

export interface SavedBuildRevisionInputV2 {
  revision: number;
  parentFingerprint: string | null;
  createdAt: string;
}

const STABLE_ID = /^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/;
const SHA256 = /^[0-9a-f]{64}$/;
const SEMVER_PART = '(?:0|[1-9]\\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)';
const SEMVER = new RegExp(`^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-${SEMVER_PART}(?:\\.${SEMVER_PART})*)?$`);
type UnknownRecord = Record<string, unknown>;

export function createSavedBuildV2(
  draft: SavedBuildDraftV2,
  revisionInput: SavedBuildRevisionInputV2,
): SavedBuildV2 {
  const botArtifact: SavedBuildV2['botArtifact'] = {
    ...structuredClone(draft.bot),
    codeHash: sha256Text(draft.bot.source),
  };
  const base = {
    format: 'agentic-game-saved-build' as const,
    schemaVersion: 2 as const,
    buildId: draft.buildId,
    revision: revisionInput.revision,
    createdAt: revisionInput.createdAt,
    label: draft.label,
    parentFingerprint: revisionInput.parentFingerprint,
    botArtifact,
    loadout: structuredClone(draft.loadout),
    contentFingerprint: fingerprintSavedBuildContentV2({
      label: draft.label,
      botArtifact,
      loadout: draft.loadout,
    }),
  };
  const record: SavedBuildV2 = {
    ...base,
    fingerprint: hashJson(base as unknown as JsonValue),
  };
  return assertSavedBuildV2(record);
}

export function fingerprintSavedBuildContentV2(
  value: Pick<SavedBuildV2, 'label' | 'botArtifact' | 'loadout'>,
): string {
  return hashJson({
    label: value.label,
    botArtifact: value.botArtifact,
    loadout: value.loadout,
  } as unknown as JsonValue);
}

export function verifySavedBuildV2(input: unknown): SavedBuildVerificationV2 {
  const issues: SavedBuildIssueV2[] = [];
  const root = record(input, '$', [
    'format', 'schemaVersion', 'buildId', 'revision', 'createdAt', 'label', 'parentFingerprint',
    'botArtifact', 'loadout', 'contentFingerprint', 'fingerprint',
  ], issues);
  if (!root) return { ok: false, issues };

  if (root.format !== 'agentic-game-saved-build') issue(issues, '$.format', 'invalid_format', 'Unexpected saved build format');
  if (root.schemaVersion !== 2) issue(issues, '$.schemaVersion', 'invalid_version', 'schemaVersion must equal 2');
  stableId(root.buildId, '$.buildId', issues);
  positiveInteger(root.revision, '$.revision', issues);
  if (typeof root.createdAt !== 'string' || Number.isNaN(Date.parse(root.createdAt))) {
    issue(issues, '$.createdAt', 'invalid_timestamp', 'createdAt must be a parseable timestamp');
  }
  if (typeof root.label !== 'string' || root.label.trim() !== root.label || root.label.length < 1 || root.label.length > 80) {
    issue(issues, '$.label', 'invalid_label', 'label must be trimmed and contain 1-80 characters');
  }
  validateParent(root.revision, root.parentFingerprint, issues);
  validateHash(root.contentFingerprint, '$.contentFingerprint', issues);
  validateHash(root.fingerprint, '$.fingerprint', issues);

  const bot = record(root.botArtifact, '$.botArtifact', [
    'artifactId', 'version', 'codeHash', 'language', 'entryPoint', 'source',
  ], issues);
  if (bot) {
    stableId(bot.artifactId, '$.botArtifact.artifactId', issues);
    if (typeof bot.version !== 'string' || !SEMVER.test(bot.version)) {
      issue(issues, '$.botArtifact.version', 'invalid_version', 'Bot version must be semantic version');
    }
    validateHash(bot.codeHash, '$.botArtifact.codeHash', issues);
    if (bot.language !== 'javascript' && bot.language !== 'typescript') {
      issue(issues, '$.botArtifact.language', 'invalid_language', 'Unsupported Bot language');
    }
    if (typeof bot.entryPoint !== 'string' || bot.entryPoint.length < 1 || bot.entryPoint.length > 260) {
      issue(issues, '$.botArtifact.entryPoint', 'invalid_entry_point', 'entryPoint must contain 1-260 characters');
    }
    if (typeof bot.source !== 'string') {
      issue(issues, '$.botArtifact.source', 'invalid_source', 'source must be a string');
    } else if (typeof bot.codeHash === 'string' && sha256Text(bot.source) !== bot.codeHash) {
      issue(issues, '$.botArtifact.codeHash', 'source_hash_mismatch', 'Embedded source does not match codeHash');
    }
  }

  const loadout = record(root.loadout, '$.loadout', ['vehicleId', 'weaponId', 'equipmentIds'], issues);
  if (loadout) {
    stableId(loadout.vehicleId, '$.loadout.vehicleId', issues);
    stableId(loadout.weaponId, '$.loadout.weaponId', issues);
    idArray(loadout.equipmentIds, '$.loadout.equipmentIds', issues);
  }

  if (bot && loadout && typeof root.label === 'string' && typeof root.contentFingerprint === 'string') {
    const expectedContent = safeHashJson({
      label: root.label,
      botArtifact: root.botArtifact,
      loadout: root.loadout,
    }, '$.contentFingerprint', issues);
    if (expectedContent !== null && root.contentFingerprint !== expectedContent) {
      issue(issues, '$.contentFingerprint', 'content_fingerprint_mismatch', 'contentFingerprint does not match content');
    }
  }

  if (typeof root.fingerprint === 'string') {
    const { fingerprint: _ignored, ...base } = root;
    const expectedRecord = safeHashJson(base, '$.fingerprint', issues);
    if (expectedRecord !== null && root.fingerprint !== expectedRecord) {
      issue(issues, '$.fingerprint', 'record_fingerprint_mismatch', 'fingerprint does not match record');
    }
  }

  return { ok: issues.length === 0, issues };
}

export class SavedBuildValidationErrorV2 extends Error {
  constructor(readonly issues: readonly SavedBuildIssueV2[]) {
    super(`Invalid SavedBuildV2: ${issues.map((item) => item.code).join(', ')}`);
    this.name = 'SavedBuildValidationErrorV2';
  }
}

export function assertSavedBuildV2(input: unknown): SavedBuildV2 {
  const result = verifySavedBuildV2(input);
  if (!result.ok) throw new SavedBuildValidationErrorV2(result.issues);
  return input as SavedBuildV2;
}

function validateParent(revision: unknown, parent: unknown, issues: SavedBuildIssueV2[]): void {
  if (revision === 1 && parent !== null) {
    issue(issues, '$.parentFingerprint', 'revision_parent_mismatch', 'Revision 1 must have no parent');
    return;
  }
  if (typeof revision === 'number' && revision > 1 && (typeof parent !== 'string' || !SHA256.test(parent))) {
    issue(issues, '$.parentFingerprint', 'revision_parent_mismatch', 'Later revisions require a full parent fingerprint');
  }
}

function record(value: unknown, path: string, keys: readonly string[], issues: SavedBuildIssueV2[]): UnknownRecord | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    issue(issues, path, 'invalid_type', `${path} must be an object`);
    return null;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    issue(issues, path, 'invalid_type', `${path} must be a plain object`);
    return null;
  }
  const output = value as UnknownRecord;
  const allowed = new Set(keys);
  for (const key of Object.keys(output)) if (!allowed.has(key)) issue(issues, `${path}.${key}`, 'unknown_key', `Unknown key: ${key}`);
  return output;
}

function stableId(value: unknown, path: string, issues: SavedBuildIssueV2[]): void {
  if (typeof value !== 'string' || value.length < 1 || value.length > 64 || !STABLE_ID.test(value)) {
    issue(issues, path, 'invalid_id', `${path} must be a lowercase stable ID`);
  }
}

function positiveInteger(value: unknown, path: string, issues: SavedBuildIssueV2[]): void {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    issue(issues, path, 'invalid_revision', 'revision must be a positive safe integer');
  }
}

function validateHash(value: unknown, path: string, issues: SavedBuildIssueV2[]): void {
  if (typeof value !== 'string' || !SHA256.test(value)) issue(issues, path, 'invalid_hash', `${path} must be SHA-256`);
}

function idArray(value: unknown, path: string, issues: SavedBuildIssueV2[]): void {
  if (!Array.isArray(value)) {
    issue(issues, path, 'invalid_type', `${path} must be an array`);
    return;
  }
  const seen = new Set<string>();
  value.forEach((item, index) => {
    stableId(item, `${path}[${index}]`, issues);
    if (typeof item === 'string') {
      if (seen.has(item)) issue(issues, `${path}[${index}]`, 'duplicate_id', `Duplicate ID: ${item}`);
      seen.add(item);
    }
  });
}

function issue(issues: SavedBuildIssueV2[], path: string, code: string, message: string): void {
  issues.push({ path, code, message });
}

function safeHashJson(value: unknown, path: string, issues: SavedBuildIssueV2[]): string | null {
  try {
    return hashJson(value as JsonValue);
  } catch (error) {
    issue(
      issues,
      path,
      'invalid_json_domain',
      error instanceof Error ? error.message : 'Value is outside the deterministic JSON domain',
    );
    return null;
  }
}

function sha256Text(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
