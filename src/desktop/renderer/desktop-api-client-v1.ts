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
  const replays = record(api?.replays);
  const agentCenter = record(api?.agentCenter);
  const settings = record(api?.settings);
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
    || typeof practice?.run !== 'function'
    || typeof replays?.list !== 'function'
    || typeof replays?.open !== 'function'
    || typeof replays?.note !== 'function'
    || typeof replays?.export !== 'function'
    || typeof replays?.moveToTrash !== 'function'
    || typeof replays?.listTrash !== 'function'
    || typeof replays?.restore !== 'function'
    || typeof replays?.emptyTrash !== 'function'
    || typeof replays?.exportDiagnostic !== 'function'
    || typeof agentCenter?.get !== 'function'
    || typeof agentCenter?.run !== 'function'
    || typeof agentCenter?.cancel !== 'function'
    || typeof agentCenter?.save !== 'function'
    || typeof settings?.get !== 'function'
    || typeof settings?.save !== 'function'
    || typeof settings?.diagnosticPreview !== 'function'
    || typeof settings?.runDiagnostics !== 'function'
    || typeof settings?.exportDiagnostics !== 'function'
    || typeof settings?.importLegacy !== 'function'
    || typeof settings?.openReleases !== 'function') {
    throw new Error('桌面游戏桥接未加载，请重新启动游戏。');
  }
  return api as unknown as DesktopApiV1;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
