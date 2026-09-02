import type { DesktopApiV1 } from '../desktop-api-v1.js';
import type { AgentConnectorSnapshotV1, ExternalAgentHostV1 } from '../agent-connector-service-v1.js';

export interface AgentConnectorControllerSnapshotV1 {
  status: 'idle' | 'loading' | 'ready' | 'connecting' | 'error';
  connector?: AgentConnectorSnapshotV1;
  activeHost?: ExternalAgentHostV1;
  notice?: string;
  error?: string;
}

export class AgentConnectorControllerV1 {
  private snapshot: AgentConnectorControllerSnapshotV1 = { status: 'idle' };
  private readonly listeners = new Set<(snapshot: AgentConnectorControllerSnapshotV1) => void>();

  constructor(private readonly api: DesktopApiV1['agentConnector']) {}

  subscribe(listener: (snapshot: AgentConnectorControllerSnapshotV1) => void): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.listeners.delete(listener);
  }

  async load(): Promise<void> {
    if (this.snapshot.status === 'loading' || this.snapshot.status === 'connecting') return;
    this.update({ status: 'loading', ...(this.snapshot.connector ? { connector: this.snapshot.connector } : {}) });
    try {
      this.update({ status: 'ready', connector: await this.api.inspect() });
    } catch (error) {
      this.update({
        status: 'error',
        ...(this.snapshot.connector ? { connector: this.snapshot.connector } : {}),
        error: playerError(error, '暂时无法检查 AI 队友，请稍后重试。'),
      });
    }
  }

  async connect(host: ExternalAgentHostV1): Promise<void> {
    if (this.snapshot.status === 'connecting') return;
    if (!this.snapshot.connector) throw new Error('AI 队友接入向导尚未准备完成');
    const connector = this.snapshot.connector;
    this.update({ status: 'connecting', connector, activeHost: host });
    try {
      const result = await this.api.connect(host);
      const refreshed = await this.api.inspect();
      this.update({ status: 'ready', connector: refreshed, notice: result.message });
    } catch (error) {
      this.update({ status: 'error', connector, error: playerError(error, '这次接入没有完成，请稍后重试。') });
    }
  }

  getSnapshot(): AgentConnectorControllerSnapshotV1 {
    return structuredClone(this.snapshot);
  }

  private update(snapshot: AgentConnectorControllerSnapshotV1): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener(this.getSnapshot());
  }
}

function playerError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : fallback;
  return message.replace(/[A-Za-z]:\\[^\r\n]+|\/(?:[^\s/]+\/)+[^\s]+/g, '[已隐藏]')
    .replace(/\s+at\s+.*$/s, '').slice(0, 300);
}
