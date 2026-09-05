import type { DesktopApiV1 } from '../desktop-api-v1.js';
import type {
  AgentCenterRunInputV1,
  AgentCenterRunResultV1,
  AgentCenterSnapshotV1,
} from '../agent-center-service-v1.js';

export interface AgentCenterControllerSnapshotV1 {
  status: 'idle' | 'loading' | 'ready' | 'running' | 'cancelling' | 'result' | 'saving' | 'saved' | 'error';
  center?: AgentCenterSnapshotV1;
  result?: AgentCenterRunResultV1;
  saved?: { revision: number; label: string };
  error?: string;
  progress?: import('../agent-center-service-v1.js').AgentCenterProgressV1;
}

export class AgentCenterControllerV1 {
  private snapshot: AgentCenterControllerSnapshotV1 = { status: 'idle' };
  private readonly listeners = new Set<(snapshot: AgentCenterControllerSnapshotV1) => void>();

  constructor(private readonly api: DesktopApiV1['agentCenter']) {}

  subscribe(listener: (snapshot: AgentCenterControllerSnapshotV1) => void): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.listeners.delete(listener);
  }

  async load(): Promise<void> {
    if (['loading', 'running', 'cancelling', 'saving'].includes(this.snapshot.status)) return;
    const previous = this.snapshot;
    this.update({ ...previous, status: 'loading' });
    try {
      this.update({ ...previous, status: previous.saved ? 'saved' : previous.result ? 'result' : 'ready', center: await this.api.get(), error: undefined });
    } catch (error) {
      this.update({ status: 'error', error: playerError(error, 'AI 战术教练暂时无法进入，请重试。') });
    }
  }

  async run(input: AgentCenterRunInputV1): Promise<void> {
    if (!this.snapshot.center) throw new Error('AI 战术教练尚未准备完成');
    if (this.snapshot.status === 'running' || this.snapshot.status === 'cancelling') return;
    const center = this.snapshot.center;
    this.update({ status: 'running', center });
    let polling = false;
    const timer = setInterval(async () => {
      if (!this.api.progress || polling) return;
      polling = true;
      try {
        const progress = await this.api.progress();
        if (['running', 'cancelling'].includes(this.snapshot.status)) this.update({ ...this.snapshot, progress });
      } catch { /* the run response remains authoritative */ } finally { polling = false; }
    }, 500);
    try {
      const result = await this.api.run(input);
      this.update({ status: 'result', center, result });
    } catch (error) {
      this.update({ status: 'error', center, error: playerError(error, '本次战术调整没有完成，请检查连接后重试。') });
    } finally { clearInterval(timer); }
  }

  async cancel(): Promise<void> {
    if (this.snapshot.status !== 'running' || !this.snapshot.center) return;
    this.update({ status: 'cancelling', center: this.snapshot.center });
    try { await this.api.cancel(); } catch (error) {
      this.update({ ...this.snapshot, status: 'running', error: playerError(error, '取消请求没有送达，请重试。') });
    }
  }

  async save(input: { label: string; note: string }): Promise<void> {
    if (!this.snapshot.center || !this.snapshot.result) throw new Error('还没有可以保存的候选方案');
    const { center, result } = this.snapshot;
    this.update({ status: 'saving', center, result });
    try {
      const saved = await this.api.save({ candidateId: result.candidateId, label: input.label, note: input.note, confirmed: true });
      this.update({ status: 'saved', center, result, saved });
    } catch (error) {
      this.update({ status: 'error', center, result, error: playerError(error, '候选方案没有保存，请重试。') });
    }
  }

  getSnapshot(): AgentCenterControllerSnapshotV1 {
    return structuredClone(this.snapshot);
  }

  private update(snapshot: AgentCenterControllerSnapshotV1): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener(this.getSnapshot());
  }
}

function playerError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : fallback;
  return message.replace(/https?:\/\/\S+|sk-[A-Za-z0-9_-]+|ant-[A-Za-z0-9_-]+/g, '[已隐藏]')
    .replace(/\s+at\s+.*$/s, '').slice(0, 300);
}
