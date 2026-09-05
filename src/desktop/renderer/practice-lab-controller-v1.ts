import type { DesktopApiV1 } from '../desktop-api-v1.js';
import type { GarageSnapshotV1 } from '../garage-service-v1.js';
import type { PracticeResultViewV1, PracticeRunInputV1 } from '../practice-match-service-v1.js';

export interface PracticeLabSnapshotV1 {
  status: 'idle' | 'running' | 'complete';
  availableRevisions: number[];
  result?: PracticeResultViewV1;
  error?: string;
}

export class PracticeLabControllerV1 {
  private readonly api: DesktopApiV1;
  private snapshot: PracticeLabSnapshotV1 = { status: 'idle', availableRevisions: [] };
  private readonly listeners = new Set<(snapshot: PracticeLabSnapshotV1) => void>();

  constructor(api: DesktopApiV1) {
    this.api = api;
  }

  getSnapshot(): PracticeLabSnapshotV1 {
    return structuredClone(this.snapshot);
  }

  subscribe(listener: (snapshot: PracticeLabSnapshotV1) => void): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.listeners.delete(listener);
  }

  setGarage(garage: GarageSnapshotV1): void {
    const availableRevisions = garage.revisions
      .filter((revision) => revision.state === 'healthy' && revision.selectable)
      .map((revision) => revision.revision)
      .sort((a, b) => a - b);
    this.update({ ...this.snapshot, availableRevisions });
  }

  async run(input: PracticeRunInputV1): Promise<void> {
    if (this.snapshot.status === 'running') throw new Error('比赛正在进行中');
    if (this.snapshot.availableRevisions.length < 1) throw new Error('需要一个可用版本才能开始练习');
    if (!this.snapshot.availableRevisions.includes(input.currentRevision)
      || !this.snapshot.availableRevisions.includes(input.opponentRevision)) {
      throw new Error('请选择可用的战术版本');
    }
    const previous = this.snapshot.result;
    this.update({ ...this.snapshot, status: 'running', error: undefined });
    try {
      const result = await this.api.practice.run(input);
      this.update({ ...this.snapshot, status: 'complete', result, error: undefined });
    } catch (error) {
      this.update({
        ...this.snapshot,
        status: previous ? 'complete' : 'idle',
        ...(previous ? { result: previous } : { result: undefined }),
        error: playerMessage(error),
      });
    }
  }

  private update(snapshot: PracticeLabSnapshotV1): void {
    this.snapshot = structuredClone(snapshot);
    const current = this.getSnapshot();
    this.listeners.forEach((listener) => listener(current));
  }
}

function playerMessage(error: unknown): string {
  return error instanceof Error && error.message.trim() ? error.message : '比赛没有完成，请稍后重试。';
}
