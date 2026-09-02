import type { SettingsControllerSnapshotV1 } from './settings-controller-v1.js';

export function renderSettingsV1(snapshot: SettingsControllerSnapshotV1): void {
  const loading = element<HTMLElement>('settings-loading');
  const workspace = element<HTMLElement>('settings-workspace');
  loading.hidden = snapshot.status !== 'loading' && snapshot.status !== 'idle';
  workspace.hidden = !snapshot.settings;
  if (snapshot.settings) {
    const settings = snapshot.settings;
    value<HTMLInputElement>('settings-master-volume', String(settings.masterVolume));
    value<HTMLInputElement>('settings-effects-volume', String(settings.effectsVolume));
    element<HTMLElement>('settings-master-value').textContent = `${settings.masterVolume}%`;
    element<HTMLElement>('settings-effects-value').textContent = `${settings.effectsVolume}%`;
    value<HTMLSelectElement>('settings-motion', settings.motion);
    value<HTMLSelectElement>('settings-friend-mode', settings.defaultFriendMode);
    element<HTMLInputElement>('settings-nearby').checked = settings.nearbyDiscovery;
  }
  const privacy = element<HTMLElement>('settings-diagnostic-privacy');
  privacy.textContent = snapshot.preview
    ? `报告包含：${snapshot.preview.includes.join('、')}。不会包含：${snapshot.preview.excludes.join('、')}。`
    : '正在读取诊断报告的隐私范围。';
  const results = element<HTMLElement>('settings-diagnostic-results');
  results.replaceChildren(...(snapshot.diagnostics?.items ?? []).map((item) => {
    const card = document.createElement('article');
    card.className = 'diagnostic-result';
    card.dataset.status = item.status;
    const title = document.createElement('b');
    title.textContent = item.title;
    const detail = document.createElement('span');
    detail.textContent = item.detail;
    card.append(title, detail);
    return card;
  }));
  results.hidden = !snapshot.diagnostics;
  const message = element<HTMLElement>('settings-message');
  message.hidden = !snapshot.notice && !snapshot.error;
  message.dataset.danger = String(Boolean(snapshot.error));
  message.textContent = snapshot.error ?? snapshot.notice ?? '';
  const busy = snapshot.status === 'working';
  for (const id of ['settings-save', 'settings-run-diagnostics', 'settings-export-diagnostics', 'settings-import-legacy', 'settings-open-releases']) {
    element<HTMLButtonElement>(id).disabled = busy;
  }
}

function value<T extends HTMLInputElement | HTMLSelectElement>(id: string, next: string): void {
  element<T>(id).value = next;
}

function element<T extends HTMLElement>(id: string): T {
  const result = document.getElementById(id);
  if (!result) throw new Error(`Missing settings element: ${id}`);
  return result as T;
}
