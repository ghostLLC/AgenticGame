import type { DesktopApplicationServiceV1 } from './application-service-v1.js';
import type { DesktopPageIdV1, PlayerDoctrineV1, TutorialStageV1 } from './player-profile-v1.js';
import type { GarageSaveInputV1, GarageTacticIdV1 } from './garage-service-v1.js';
import type { PracticeRunInputV1 } from './practice-match-service-v1.js';
import type { ReplayLibraryFilterV1, ReplaySourceV1 } from './replay-library-service-v1.js';
import type {
  AgentCenterRunInputV1,
  AgentCenterSaveInputV1,
} from './agent-center-service-v1.js';
import { assertAppSettingsV1 } from './app-settings-v1.js';

export type DesktopIpcHandlerV1 = (event: unknown, input?: unknown) => Promise<unknown>;

export interface DesktopIpcRegistrarV1 {
  handle(channel: string, handler: DesktopIpcHandlerV1): void;
}

const DOCTRINES = new Set<PlayerDoctrineV1>(['scout', 'medium', 'heavy']);
const STAGES = new Set<TutorialStageV1>(['battle', 'replay', 'complete']);
const PAGES = new Set<DesktopPageIdV1>([
  'command-center', 'garage', 'practice', 'friend-room', 'replays', 'agent-center', 'settings',
]);
const VEHICLES = new Set(['scout', 'medium', 'heavy']);
const WEAPONS = new Set(['light-cannon', 'medium-cannon', 'heavy-cannon']);
const TACTICS = new Set<GarageTacticIdV1>(['scout', 'medium', 'heavy']);
const COMPATIBLE_WEAPON = new Map([
  ['scout', 'light-cannon'],
  ['medium', 'medium-cannon'],
  ['heavy', 'heavy-cannon'],
]);

export function registerDesktopApplicationIpcV1(
  registrar: DesktopIpcRegistrarV1,
  service: DesktopApplicationServiceV1,
): void {
  registrar.handle('app:bootstrap', async () => service.bootstrap());
  registrar.handle('profile:create', async (_event, input) => {
    if (!isRecord(input)
      || typeof input.displayName !== 'string'
      || typeof input.doctrine !== 'string'
      || !DOCTRINES.has(input.doctrine as PlayerDoctrineV1)) {
      throw new Error('指挥官信息无效');
    }
    return service.createProfile({
      displayName: input.displayName,
      doctrine: input.doctrine as PlayerDoctrineV1,
    });
  });
  registrar.handle('profile:advance-tutorial', async (_event, input) => {
    if (typeof input !== 'string' || !STAGES.has(input as TutorialStageV1)) throw new Error('教程进度无效');
    return service.advanceTutorial(input as TutorialStageV1);
  });
  registrar.handle('navigation:remember', async (_event, input) => {
    if (typeof input !== 'string' || !PAGES.has(input as DesktopPageIdV1)) throw new Error('页面无效');
    return service.rememberPage(input as DesktopPageIdV1);
  });
  registrar.handle('tutorial:run', async () => service.runTutorial());
  registrar.handle('garage:get', async () => service.getGarage());
  registrar.handle('garage:save', async (_event, input) => service.saveGarageRevision(assertGarageInput(input)));
  registrar.handle('garage:quarantine', async () => service.quarantineGarageHistory());
  registrar.handle('garage:export-diagnostic', async () => service.exportGarageDiagnostic());
  registrar.handle('practice:run', async (_event, input) => service.runPractice(assertPracticeInput(input)));
  registrar.handle('replays:list', async (_event, input) => service.listReplays(assertReplayFilter(input)));
  registrar.handle('replays:open', async (_event, input) => {
    const action = assertReplayAction(input);
    return service.openReplay(action.replayId, action.source);
  });
  registrar.handle('replays:note', async (_event, input) => {
    if (!isRecord(input) || !hasExactKeys(input, ['replayId', 'source', 'note'])
      || typeof input.note !== 'string' || input.note.trim() !== input.note || [...input.note].length > 240) {
      throw new Error('回放操作无效');
    }
    const action = assertReplayAction({ replayId: input.replayId, source: input.source });
    return service.updateReplayNote(action.replayId, action.source, input.note);
  });
  registrar.handle('replays:export', async (_event, input) => {
    const action = assertReplayAction(input);
    return service.exportReplay(action.replayId, action.source);
  });
  registrar.handle('replays:move-to-trash', async (_event, input) => {
    const action = assertReplayAction(input);
    return service.moveReplayToTrash(action.replayId, action.source);
  });
  registrar.handle('replays:list-trash', async () => service.listReplayTrash());
  registrar.handle('replays:restore', async (_event, input) => {
    if (typeof input !== 'string' || !/^(practice|friend-public)-[0-9a-f]{64}$/.test(input)) throw new Error('回收站操作无效');
    return service.restoreReplay(input);
  });
  registrar.handle('replays:empty-trash', async (_event, input) => {
    if (input !== true) throw new Error('清空回收站需要明确确认');
    return service.emptyReplayTrash(true);
  });
  registrar.handle('replays:export-diagnostic', async () => service.exportReplayDiagnostic());
  registrar.handle('agent-center:get', async () => service.getAgentCenter());
  registrar.handle('agent-center:run', async (_event, input) => service.runAgentCenter(assertAgentRunInput(input)));
  registrar.handle('agent-center:cancel', async () => service.cancelAgentCenter());
  registrar.handle('agent-center:save', async (_event, input) => service.saveAgentCandidate(assertAgentSaveInput(input)));
  registrar.handle('settings:get', async () => service.getSettings());
  registrar.handle('settings:save', async (_event, input) => {
    try { return service.saveSettings(assertAppSettingsV1(input)); }
    catch { throw new Error('设置无效'); }
  });
  registrar.handle('settings:diagnostic-preview', async () => service.getDiagnosticPreview());
  registrar.handle('settings:run-diagnostics', async () => service.runReleaseDiagnostics());
  registrar.handle('settings:export-diagnostics', async () => service.exportReleaseDiagnostics());
  registrar.handle('settings:import-legacy', async () => service.importLegacyData());
  registrar.handle('settings:open-releases', async () => service.openReleases());
}

function assertAgentRunInput(input: unknown): AgentCenterRunInputV1 {
  if (!isRecord(input) || !hasExactKeys(input, ['revision', 'provider', 'goal', 'depth'])
    || !validRevision(input.revision)
    || (input.depth !== 'quick' && input.depth !== 'standard' && input.depth !== 'deep')
    || typeof input.goal !== 'string' || input.goal.trim() !== input.goal || [...input.goal].length < 1 || [...input.goal].length > 500
    || !isRecord(input.provider) || !hasExactKeys(input.provider, ['kind', 'baseUrl', 'model', 'apiKey'])
    || (input.provider.kind !== 'openai-compatible' && input.provider.kind !== 'anthropic')
    || !boundedTrimmed(input.provider.baseUrl, 1, 500)
    || !boundedTrimmed(input.provider.model, 1, 120)
    || !boundedTrimmed(input.provider.apiKey, 1, 4096)
    || !safeProviderUrl(input.provider.baseUrl as string)) {
    throw new Error('AI 战术调整参数无效');
  }
  return {
    revision: input.revision as number,
    provider: {
      kind: input.provider.kind as AgentCenterRunInputV1['provider']['kind'],
      baseUrl: input.provider.baseUrl as string,
      model: input.provider.model as string,
      apiKey: input.provider.apiKey as string,
    },
    goal: input.goal as string,
    depth: input.depth as AgentCenterRunInputV1['depth'],
  };
}

function assertAgentSaveInput(input: unknown): AgentCenterSaveInputV1 {
  if (!isRecord(input) || !hasExactKeys(input, ['candidateId', 'label', 'note', 'confirmed']) || input.confirmed !== true) {
    throw new Error('保存候选方案需要明确确认');
  }
  if (typeof input.candidateId !== 'string' || input.candidateId.length < 1 || input.candidateId.length > 64
    || !/^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/.test(input.candidateId)
    || !boundedTrimmed(input.label, 1, 80) || !boundedTrimmed(input.note, 0, 240)) {
    throw new Error('候选方案无效');
  }
  return {
    candidateId: input.candidateId,
    label: input.label as string,
    note: input.note as string,
    confirmed: true,
  };
}

function safeProviderUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    return (url.protocol === 'https:' || (url.protocol === 'http:' && loopback))
      && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}

function boundedTrimmed(value: unknown, minimum: number, maximum: number): value is string {
  return typeof value === 'string' && value.trim() === value
    && [...value].length >= minimum && [...value].length <= maximum;
}

function assertReplayAction(input: unknown): { replayId: string; source: ReplaySourceV1 } {
  if (!isRecord(input) || !hasExactKeys(input, ['replayId', 'source'])
    || typeof input.replayId !== 'string' || !/^[0-9a-f]{64}$/.test(input.replayId)
    || (input.source !== 'practice' && input.source !== 'friend-public')) throw new Error('回放操作无效');
  return { replayId: input.replayId, source: input.source };
}

function assertReplayFilter(input: unknown): ReplayLibraryFilterV1 {
  if (!isRecord(input) || !Object.keys(input).every((key) => [
    'source', 'modeId', 'outcome', 'buildRevision', 'query', 'dateFrom', 'dateTo',
  ].includes(key))) throw new Error('回放筛选条件无效');
  if (input.source !== undefined && input.source !== 'practice' && input.source !== 'friend-public') throw new Error('回放筛选条件无效');
  if (input.modeId !== undefined && input.modeId !== 'duel' && input.modeId !== 'capture') throw new Error('回放筛选条件无效');
  if (input.outcome !== undefined && input.outcome !== 'victory' && input.outcome !== 'defeat' && input.outcome !== 'draw') throw new Error('回放筛选条件无效');
  if (input.buildRevision !== undefined && !validRevision(input.buildRevision)) throw new Error('回放筛选条件无效');
  if (input.query !== undefined && (typeof input.query !== 'string' || input.query.trim() !== input.query || [...input.query].length > 80)) throw new Error('回放筛选条件无效');
  for (const date of [input.dateFrom, input.dateTo]) if (date !== undefined && (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date))) throw new Error('回放筛选条件无效');
  return structuredClone(input) as ReplayLibraryFilterV1;
}

function assertGarageInput(input: unknown): GarageSaveInputV1 {
  if (!isRecord(input) || !hasExactKeys(input, ['label', 'vehicleId', 'weaponId', 'tacticId', 'note'])) {
    throw new Error('车库配置无效');
  }
  const label = typeof input.label === 'string' ? input.label : '';
  const note = typeof input.note === 'string' ? input.note : '';
  const vehicleId = typeof input.vehicleId === 'string' ? input.vehicleId : '';
  const weaponId = typeof input.weaponId === 'string' ? input.weaponId : '';
  const tacticId = typeof input.tacticId === 'string' ? input.tacticId : '';
  if (label !== label.trim() || [...label].length < 1 || [...label].length > 80
    || note !== note.trim() || [...note].length > 240
    || !VEHICLES.has(vehicleId) || !WEAPONS.has(weaponId)
    || COMPATIBLE_WEAPON.get(vehicleId) !== weaponId
    || !TACTICS.has(tacticId as GarageTacticIdV1)) {
    throw new Error('车库配置无效');
  }
  return {
    label,
    vehicleId: vehicleId as GarageSaveInputV1['vehicleId'],
    weaponId: weaponId as GarageSaveInputV1['weaponId'],
    tacticId: tacticId as GarageTacticIdV1,
    note,
  };
}

function assertPracticeInput(input: unknown): PracticeRunInputV1 {
  if (!isRecord(input) || !hasOnlyKeys(input, ['currentRevision', 'opponentRevision', 'modeId', 'seed'])
    || !validRevision(input.currentRevision) || !validRevision(input.opponentRevision)
    || (input.modeId !== 'duel' && input.modeId !== 'capture')
    || (input.seed !== undefined && (!Number.isSafeInteger(input.seed) || (input.seed as number) < 0))) {
    throw new Error('练习赛配置无效');
  }
  return {
    currentRevision: input.currentRevision as number,
    opponentRevision: input.opponentRevision as number,
    modeId: input.modeId,
    ...(input.seed === undefined ? {} : { seed: input.seed as number }),
  };
}

function validRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

function hasExactKeys(input: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(input);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

function hasOnlyKeys(input: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(input);
  return keys.length >= 3 && keys.every((key) => expected.includes(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
