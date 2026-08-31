import type { DesktopApplicationServiceV1 } from './application-service-v1.js';
import type { DesktopPageIdV1, PlayerDoctrineV1, TutorialStageV1 } from './player-profile-v1.js';

export type DesktopIpcHandlerV1 = (event: unknown, input?: unknown) => Promise<unknown>;

export interface DesktopIpcRegistrarV1 {
  handle(channel: string, handler: DesktopIpcHandlerV1): void;
}

const DOCTRINES = new Set<PlayerDoctrineV1>(['scout', 'medium', 'heavy']);
const STAGES = new Set<TutorialStageV1>(['battle', 'replay', 'complete']);
const PAGES = new Set<DesktopPageIdV1>([
  'command-center', 'garage', 'practice', 'friend-room', 'replays', 'agent-center', 'settings',
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
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
