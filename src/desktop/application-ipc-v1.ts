import type { DesktopApplicationServiceV1 } from './application-service-v1.js';
import type { DesktopPageIdV1, PlayerDoctrineV1, TutorialStageV1 } from './player-profile-v1.js';
import type { GarageSaveInputV1, GarageTacticIdV1 } from './garage-service-v1.js';
import type { PracticeRunInputV1 } from './practice-match-service-v1.js';

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
