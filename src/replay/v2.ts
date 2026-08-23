import { createHash } from 'node:crypto';
import type {
  BotArtifactSnapshotV2,
  ContentSnapshotV2,
  MapSnapshotV2,
} from '../core/v2/content.js';
import { hashJson, type JsonObject, type JsonValue } from '../core/v2/json.js';
import {
  assertMatchConfigV2,
  validateMatchConfigV2,
  type MatchConfigV2,
} from '../core/v2/match-config.js';

export interface ActionRecordV2 {
  tick: number;
  actorId: string;
  action: JsonObject;
}

export interface EventRecordV2 {
  tick: number;
  type: string;
  payload: JsonObject;
}

export interface StateCheckpointV2 {
  tick: number;
  state: JsonObject;
  stateHash: string;
}

export interface StateCheckpointInputV2 {
  tick: number;
  state: JsonObject;
  stateHash?: string;
}

export interface LogRecordV2 {
  tick: number;
  sourceId: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
}

export interface MatchResultV2 {
  winningTeamIds: string[];
  reason: string;
  ticks: number;
}

export interface MatchBundleIntegrityV2 {
  configHash: string;
  mapHash: string;
  contentHash: string;
  timelineHash: string;
  bundleHash: string;
}

export interface MatchBundleV2 {
  format: 'agentic-game-match-bundle';
  version: 2;
  engineVersion: string;
  createdAt: string;
  config: MatchConfigV2;
  mapSnapshot: MapSnapshotV2;
  contentSnapshot: ContentSnapshotV2;
  botArtifacts: BotArtifactSnapshotV2[];
  actions: ActionRecordV2[];
  events: EventRecordV2[];
  checkpoints: StateCheckpointV2[];
  logs: LogRecordV2[];
  result: MatchResultV2;
  integrity: MatchBundleIntegrityV2;
}

export interface MatchBundleInputV2 {
  engineVersion: string;
  createdAt: string;
  config: MatchConfigV2;
  mapSnapshot: MapSnapshotV2;
  contentSnapshot: ContentSnapshotV2;
  botArtifacts: BotArtifactSnapshotV2[];
  actions: ActionRecordV2[];
  events: EventRecordV2[];
  checkpoints: StateCheckpointInputV2[];
  logs: LogRecordV2[];
  result: MatchResultV2;
}

export interface BundleVerificationIssue {
  code: string;
  path: string;
  message: string;
}

export type BundleVerificationResult =
  | { ok: true; issues: [] }
  | { ok: false; issues: BundleVerificationIssue[] };

type BundleBase = Omit<MatchBundleV2, 'integrity'>;
type IntegrityWithoutBundleHash = Omit<MatchBundleIntegrityV2, 'bundleHash'>;
const STABLE_ID = /^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/;
const SHA256 = /^[0-9a-f]{64}$/;

export function createMatchBundleV2(input: MatchBundleInputV2): MatchBundleV2 {
  assertMatchConfigV2(input.config);
  const cloned = structuredClone(input);
  const inputIssues: BundleVerificationIssue[] = [];
  const base: BundleBase = {
    format: 'agentic-game-match-bundle',
    version: 2,
    engineVersion: cloned.engineVersion,
    createdAt: cloned.createdAt,
    config: cloned.config,
    mapSnapshot: cloned.mapSnapshot,
    contentSnapshot: cloned.contentSnapshot,
    botArtifacts: cloned.botArtifacts,
    actions: cloned.actions,
    events: cloned.events,
    checkpoints: cloned.checkpoints.map((checkpoint, index) => {
      const stateHash = hashJson(checkpoint.state);
      if (checkpoint.stateHash !== undefined && checkpoint.stateHash !== stateHash) {
        inputIssues.push({
          path: `$.checkpoints[${index}].stateHash`,
          code: 'checkpoint_hash_mismatch',
          message: 'Supplied checkpoint stateHash does not match its state',
        });
      }
      return { tick: checkpoint.tick, state: checkpoint.state, stateHash };
    }),
    logs: cloned.logs,
    result: cloned.result,
  };
  const issues = [...inputIssues, ...collectInvariantIssues(base)];
  if (issues.length > 0) throw new MatchBundleValidationError(issues);
  const coreIntegrity = computeCoreIntegrity(base);
  const bundleHash = computeBundleHash(base, coreIntegrity);
  return { ...base, integrity: { ...coreIntegrity, bundleHash } };
}

export function verifyMatchBundleV2(bundle: MatchBundleV2): BundleVerificationResult {
  const { integrity, ...base } = bundle;
  const expectedCore = computeCoreIntegrity(base);
  const expectedBundleHash = computeBundleHash(base, expectedCore);
  const issues = collectInvariantIssues(base);
  compareHash(issues, integrity.configHash, expectedCore.configHash, '$.integrity.configHash', 'config_hash_mismatch');
  compareHash(issues, integrity.mapHash, expectedCore.mapHash, '$.integrity.mapHash', 'map_hash_mismatch');
  compareHash(issues, integrity.contentHash, expectedCore.contentHash, '$.integrity.contentHash', 'content_hash_mismatch');
  compareHash(issues, integrity.timelineHash, expectedCore.timelineHash, '$.integrity.timelineHash', 'timeline_hash_mismatch');
  compareHash(issues, integrity.bundleHash, expectedBundleHash, '$.integrity.bundleHash', 'bundle_hash_mismatch');
  return issues.length === 0 ? { ok: true, issues: [] } : { ok: false, issues };
}

function computeCoreIntegrity(base: BundleBase): IntegrityWithoutBundleHash {
  return {
    configHash: hashJson(base.config as unknown as JsonValue),
    mapHash: hashJson(base.mapSnapshot as unknown as JsonValue),
    contentHash: hashJson(base.contentSnapshot as unknown as JsonValue),
    timelineHash: hashJson({
      actions: base.actions,
      events: base.events,
      checkpoints: base.checkpoints,
      logs: base.logs,
    } as unknown as JsonValue),
  };
}

function computeBundleHash(base: BundleBase, integrity: IntegrityWithoutBundleHash): string {
  return hashJson({ ...base, integrity } as unknown as JsonValue);
}

function compareHash(
  issues: BundleVerificationIssue[],
  actual: string,
  expected: string,
  path: string,
  code: string,
): void {
  if (actual !== expected) issues.push({ path, code, message: `${path} does not match bundle content` });
}

export class MatchBundleValidationError extends Error {
  readonly issues: readonly BundleVerificationIssue[];

  constructor(issues: readonly BundleVerificationIssue[]) {
    super(`Invalid MatchBundleV2: ${issues.map((issue) => issue.code).join(', ')}`);
    this.name = 'MatchBundleValidationError';
    this.issues = issues;
  }
}

function collectInvariantIssues(base: BundleBase): BundleVerificationIssue[] {
  const issues: BundleVerificationIssue[] = [];
  if (base.format !== 'agentic-game-match-bundle') {
    addIssue(issues, '$.format', 'invalid_format', 'Unexpected match bundle format');
  }
  if (base.version !== 2) addIssue(issues, '$.version', 'invalid_version', 'Match bundle version must equal 2');
  if (typeof base.engineVersion !== 'string' || base.engineVersion.trim().length === 0) {
    addIssue(issues, '$.engineVersion', 'invalid_engine_version', 'engineVersion must be a non-empty string');
  }
  if (typeof base.createdAt !== 'string' || Number.isNaN(Date.parse(base.createdAt))) {
    addIssue(issues, '$.createdAt', 'invalid_created_at', 'createdAt must be a parseable timestamp');
  }

  const configValidation = validateMatchConfigV2(base.config);
  if (!configValidation.ok) {
    for (const issue of configValidation.issues) {
      addIssue(issues, `$.config${issue.path.slice(1)}`, 'config_invalid', `${issue.code}: ${issue.message}`);
    }
  }

  validateTimeline(base.actions, 'actions', issues, (record, path) => {
    if (!isStableId(record.actorId)) {
      addIssue(issues, `${path}.actorId`, 'invalid_actor_id', 'actorId must be a stable ID');
    }
  });
  validateTimeline(base.events, 'events', issues, (record, path) => {
    if (!isStableId(record.type)) {
      addIssue(issues, `${path}.type`, 'invalid_event_type', 'event type must be a stable ID');
    }
  });
  validateTimeline(base.checkpoints, 'checkpoints', issues, (record, path) => {
    const expected = hashJson(record.state);
    if (!SHA256.test(record.stateHash) || record.stateHash !== expected) {
      addIssue(issues, `${path}.stateHash`, 'checkpoint_hash_mismatch', 'Checkpoint hash does not match state');
    }
  });
  validateTimeline(base.logs, 'logs', issues, (record, path) => {
    if (!isStableId(record.sourceId)) {
      addIssue(issues, `${path}.sourceId`, 'invalid_log_source_id', 'sourceId must be a stable ID');
    }
    if (!['debug', 'info', 'warn', 'error'].includes(record.level)) {
      addIssue(issues, `${path}.level`, 'invalid_log_level', 'Unsupported log level');
    }
    if (typeof record.message !== 'string') {
      addIssue(issues, `${path}.message`, 'invalid_log_message', 'Log message must be a string');
    }
  });

  validateArtifacts(base, issues);
  validateResult(base, issues);
  return issues;
}

function validateTimeline<T extends { tick: number }>(
  records: readonly T[],
  collection: 'actions' | 'events' | 'checkpoints' | 'logs',
  issues: BundleVerificationIssue[],
  validateRecord: (record: T, path: string) => void,
): void {
  let previousTick = -1;
  records.forEach((record, index) => {
    const path = `$.${collection}[${index}]`;
    if (!Number.isInteger(record.tick) || record.tick < 0) {
      addIssue(issues, `${path}.tick`, 'invalid_tick', 'tick must be a non-negative integer');
    } else {
      if (record.tick < previousTick) {
        addIssue(issues, `${path}.tick`, `${collection}_tick_order`, `${collection} ticks must be non-decreasing`);
      }
      previousTick = record.tick;
    }
    validateRecord(record, path);
  });
}

function validateArtifacts(base: BundleBase, issues: BundleVerificationIssue[]): void {
  const artifacts = new Map<string, BotArtifactSnapshotV2>();
  base.botArtifacts.forEach((artifact, index) => {
    const path = `$.botArtifacts[${index}]`;
    const key = `${artifact.artifactId}@${artifact.version}`;
    if (!isStableId(artifact.artifactId)) {
      addIssue(issues, `${path}.artifactId`, 'invalid_artifact_id', 'artifactId must be a stable ID');
    }
    if (artifacts.has(key)) addIssue(issues, path, 'duplicate_artifact', `Duplicate artifact: ${key}`);
    artifacts.set(key, artifact);
    if (!SHA256.test(artifact.codeHash) || sha256Text(artifact.source) !== artifact.codeHash) {
      addIssue(issues, `${path}.codeHash`, 'artifact_hash_mismatch', 'Embedded source does not match codeHash');
    }
  });

  base.config.teams.forEach((team, index) => {
    const artifact = artifacts.get(`${team.bot.artifactId}@${team.bot.version}`);
    if (!artifact || artifact.codeHash !== team.bot.codeHash) {
      addIssue(
        issues,
        `$.config.teams[${index}].bot`,
        'artifact_reference_mismatch',
        'Team Bot reference does not resolve to an embedded artifact',
      );
    }
  });
}

function validateResult(base: BundleBase, issues: BundleVerificationIssue[]): void {
  if (!Number.isInteger(base.result.ticks) || base.result.ticks < 0) {
    addIssue(issues, '$.result.ticks', 'invalid_result_ticks', 'result ticks must be a non-negative integer');
  }
  if (typeof base.result.reason !== 'string' || base.result.reason.length === 0) {
    addIssue(issues, '$.result.reason', 'invalid_result_reason', 'result reason must be non-empty');
  }
  const knownTeams = new Set(base.config.teams.map((team) => team.teamId));
  base.result.winningTeamIds.forEach((teamId, index) => {
    if (!isStableId(teamId) || !knownTeams.has(teamId)) {
      addIssue(issues, `$.result.winningTeamIds[${index}]`, 'invalid_winning_team', 'Unknown winning team ID');
    }
  });
}

function addIssue(
  issues: BundleVerificationIssue[],
  path: string,
  code: string,
  message: string,
): void {
  issues.push({ path, code, message });
}

function isStableId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 && STABLE_ID.test(value);
}

function sha256Text(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
