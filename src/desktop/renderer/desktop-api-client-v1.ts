import type { DesktopApiV1 } from '../desktop-api-v1.js';

export function desktopApiClientV1(host: unknown): DesktopApiV1 {
  const root = record(host);
  const api = record(root?.agenticGameDesktop);
  const app = record(api?.app);
  const profile = record(api?.profile);
  const navigation = record(api?.navigation);
  const tutorial = record(api?.tutorial);
  const garage = record(api?.garage);
  const practice = record(api?.practice);
  if (!api
    || typeof app?.bootstrap !== 'function'
    || typeof profile?.create !== 'function'
    || typeof profile?.advanceTutorial !== 'function'
    || typeof navigation?.remember !== 'function'
    || typeof tutorial?.run !== 'function'
    || typeof garage?.get !== 'function'
    || typeof garage?.save !== 'function'
    || typeof garage?.quarantine !== 'function'
    || typeof garage?.exportDiagnostic !== 'function'
    || typeof practice?.run !== 'function') {
    throw new Error('桌面游戏桥接未加载，请重新启动游戏。');
  }
  return api as unknown as DesktopApiV1;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
