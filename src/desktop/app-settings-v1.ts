export type AppMotionV1 = 'full' | 'reduced';
export type DefaultFriendModeV1 = 'nearby' | 'remote';
export type RecentProviderKindV1 = 'openai-compatible' | 'anthropic';

export interface RecentProviderV1 {
  kind: RecentProviderKindV1;
  baseUrl: string;
  model: string;
}

export interface AppSettingsV1 {
  version: 1;
  language: 'zh-CN';
  masterVolume: number;
  effectsVolume: number;
  motion: AppMotionV1;
  nearbyDiscovery: boolean;
  defaultFriendMode: DefaultFriendModeV1;
  recentProvider: RecentProviderV1 | null;
  advancedOpen: boolean;
}

const KEYS = [
  'version', 'language', 'masterVolume', 'effectsVolume', 'motion', 'nearbyDiscovery',
  'defaultFriendMode', 'recentProvider', 'advancedOpen',
] as const;

export function defaultAppSettingsV1(): AppSettingsV1 {
  return {
    version: 1,
    language: 'zh-CN',
    masterVolume: 80,
    effectsVolume: 75,
    motion: 'full',
    nearbyDiscovery: true,
    defaultFriendMode: 'nearby',
    recentProvider: null,
    advancedOpen: false,
  };
}

export function assertAppSettingsV1(value: unknown): AppSettingsV1 {
  if (!isRecord(value) || !exactKeys(value, KEYS)
    || value.version !== 1 || value.language !== 'zh-CN'
    || !volume(value.masterVolume) || !volume(value.effectsVolume)
    || (value.motion !== 'full' && value.motion !== 'reduced')
    || typeof value.nearbyDiscovery !== 'boolean'
    || (value.defaultFriendMode !== 'nearby' && value.defaultFriendMode !== 'remote')
    || typeof value.advancedOpen !== 'boolean') invalid();
  const recentProvider = value.recentProvider === null ? null : assertRecentProvider(value.recentProvider);
  return structuredClone({ ...value, recentProvider }) as AppSettingsV1;
}

function assertRecentProvider(value: unknown): RecentProviderV1 {
  if (!isRecord(value) || !exactKeys(value, ['kind', 'baseUrl', 'model'])
    || (value.kind !== 'openai-compatible' && value.kind !== 'anthropic')
    || !bounded(value.baseUrl, 1, 500) || !bounded(value.model, 1, 120)
    || !safeUrl(value.baseUrl)) invalid();
  return { kind: value.kind, baseUrl: value.baseUrl, model: value.model };
}

function safeUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    return (url.protocol === 'https:' || (url.protocol === 'http:' && loopback))
      && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}

function volume(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 100;
}

function bounded(value: unknown, minimum: number, maximum: number): value is string {
  return typeof value === 'string' && value.trim() === value
    && [...value].length >= minimum && [...value].length <= maximum;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
}

function invalid(): never { throw new Error('Invalid AppSettingsV1'); }
