export type PlayerDoctrineV1 = 'scout' | 'medium' | 'heavy';

export type TutorialStageV1 = 'battle' | 'replay' | 'complete';

export type DesktopPageIdV1 =
  | 'command-center'
  | 'garage'
  | 'practice'
  | 'friend-room'
  | 'replays'
  | 'agent-center'
  | 'settings';

export interface PlayerProfileV1 {
  version: 1;
  playerId: string;
  displayName: string;
  doctrine: PlayerDoctrineV1;
  tutorialStage: TutorialStageV1;
  recentPage: DesktopPageIdV1;
  createdAt: string;
  lastOpenedAt: string;
}

export interface CreatePlayerProfileInputV1 {
  playerId: string;
  displayName: string;
  doctrine: PlayerDoctrineV1;
  now: string;
}

const PROFILE_KEYS = [
  'version',
  'playerId',
  'displayName',
  'doctrine',
  'tutorialStage',
  'recentPage',
  'createdAt',
  'lastOpenedAt',
] as const;

const DOCTRINES = new Set<PlayerDoctrineV1>(['scout', 'medium', 'heavy']);
const TUTORIAL_STAGES = new Set<TutorialStageV1>(['battle', 'replay', 'complete']);
const PAGE_IDS = new Set<DesktopPageIdV1>([
  'command-center',
  'garage',
  'practice',
  'friend-room',
  'replays',
  'agent-center',
  'settings',
]);
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createPlayerProfileV1(input: CreatePlayerProfileInputV1): PlayerProfileV1 {
  return assertPlayerProfileV1({
    version: 1,
    playerId: input.playerId,
    displayName: input.displayName.trim(),
    doctrine: input.doctrine,
    tutorialStage: 'battle',
    recentPage: 'command-center',
    createdAt: input.now,
    lastOpenedAt: input.now,
  });
}

export function assertPlayerProfileV1(input: unknown): PlayerProfileV1 {
  const issues: string[] = [];
  if (!isRecord(input)) throw invalid(['profile must be an object']);

  const keys = Object.keys(input);
  if (keys.length !== PROFILE_KEYS.length || keys.some((key) => !PROFILE_KEYS.includes(key as typeof PROFILE_KEYS[number]))) {
    issues.push('fields');
  }
  if (input.version !== 1) issues.push('version');
  if (typeof input.playerId !== 'string' || !UUID_V4.test(input.playerId)) issues.push('playerId');
  if (!validDisplayName(input.displayName)) issues.push('displayName');
  if (typeof input.doctrine !== 'string' || !DOCTRINES.has(input.doctrine as PlayerDoctrineV1)) issues.push('doctrine');
  if (typeof input.tutorialStage !== 'string' || !TUTORIAL_STAGES.has(input.tutorialStage as TutorialStageV1)) issues.push('tutorialStage');
  if (typeof input.recentPage !== 'string' || !PAGE_IDS.has(input.recentPage as DesktopPageIdV1)) issues.push('recentPage');

  const createdAt = canonicalInstant(input.createdAt);
  const lastOpenedAt = canonicalInstant(input.lastOpenedAt);
  if (!createdAt) issues.push('createdAt');
  if (!lastOpenedAt) issues.push('lastOpenedAt');
  if (createdAt && lastOpenedAt && lastOpenedAt < createdAt) issues.push('timeOrder');
  if (issues.length) throw invalid(issues);

  return structuredClone({
    version: 1,
    playerId: input.playerId as string,
    displayName: input.displayName as string,
    doctrine: input.doctrine as PlayerDoctrineV1,
    tutorialStage: input.tutorialStage as TutorialStageV1,
    recentPage: input.recentPage as DesktopPageIdV1,
    createdAt: input.createdAt as string,
    lastOpenedAt: input.lastOpenedAt as string,
  });
}

function validDisplayName(value: unknown): boolean {
  if (typeof value !== 'string' || value !== value.trim()) return false;
  const length = [...value].length;
  return length >= 1 && length <= 24;
}

function canonicalInstant(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  return new Date(time).toISOString() === value ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(issues: string[]): Error {
  return new Error(`Invalid PlayerProfileV1: ${issues.join(', ')}`);
}
