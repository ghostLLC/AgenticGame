import type { ExternalAgentConnectionStateV1, ExternalAgentHostV1 } from '../agent-connector-service-v1.js';
import type { AgentConnectorControllerSnapshotV1 } from './agent-connector-controller-v1.js';

const HOSTS: ExternalAgentHostV1[] = ['codex', 'workbuddy', 'qoder'];
const STATE_COPY: Record<ExternalAgentConnectionStateV1, { status: string; action: string; disabled: boolean }> = {
  'not-found': { status: '暂未发现', action: '安装后再试', disabled: true },
  ready: { status: '可以接入', action: '一键接入', disabled: false },
  connected: { status: '已经接入', action: '已完成', disabled: true },
  'needs-attention': { status: '需要先整理', action: '先修复原配置', disabled: true },
};

export function renderAgentConnectorV1(snapshot: AgentConnectorControllerSnapshotV1): void {
  const panel = element('agent-connector-panel');
  panel.hidden = snapshot.status === 'idle' || (snapshot.status === 'loading' && !snapshot.connector);
  if (!snapshot.connector) return;

  element('agent-connector-privacy').textContent = snapshot.connector.privacy;
  const busy = snapshot.status === 'connecting';
  for (const host of HOSTS) {
    const card = snapshot.connector.hosts.find((item) => item.id === host);
    if (!card) continue;
    const copy = STATE_COPY[card.state];
    const status = element(`agent-connector-status-${host}`);
    const button = element<HTMLButtonElement>(`agent-connect-${host}`);
    status.textContent = copy.status;
    status.dataset.state = card.state;
    button.textContent = busy && snapshot.activeHost === host ? '正在接入…' : copy.action;
    button.disabled = busy || copy.disabled || !snapshot.connector.bridgeReady;
  }

  const notice = element('agent-connector-notice');
  notice.hidden = !snapshot.notice && !snapshot.error;
  notice.classList.toggle('is-error', Boolean(snapshot.error));
  notice.textContent = snapshot.error ?? snapshot.notice ?? '';
  const refresh = element<HTMLButtonElement>('agent-connector-refresh');
  refresh.disabled = busy;
  refresh.textContent = snapshot.status === 'loading' ? '正在检查…' : '重新检查';
}

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing agent connector element: ${id}`);
  return value as T;
}
