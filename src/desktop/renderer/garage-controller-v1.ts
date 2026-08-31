import type { DesktopApiV1 } from '../desktop-api-v1.js';
import type { GarageSaveInputV1, GarageSnapshotV1 } from '../garage-service-v1.js';

export interface GarageControllerSnapshotV1 {
  status: 'idle' | 'loading' | 'ready' | 'saving' | 'quarantining';
  garage?: GarageSnapshotV1;
  error?: string;
}

export class GarageControllerV1 {
  private readonly api: DesktopApiV1;
  private snapshot: GarageControllerSnapshotV1 = { status: 'idle' };
  private readonly listeners = new Set<(snapshot: GarageControllerSnapshotV1) => void>();

  constructor(api: DesktopApiV1) {
    this.api = api;
  }

  getSnapshot(): GarageControllerSnapshotV1 {
    return structuredClone(this.snapshot);
  }

  subscribe(listener: (snapshot: GarageControllerSnapshotV1) => void): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.listeners.delete(listener);
  }

  async load(): Promise<void> {
    if (this.busy()) throw new Error('车库正在处理中');
    this.update({ ...this.snapshot, status: 'loading', error: undefined });
    await this.perform(() => this.api.garage.get());
  }

  async save(input: GarageSaveInputV1): Promise<void> {
    if (this.busy()) throw new Error('车库正在处理中');
    this.update({ ...this.snapshot, status: 'saving', error: undefined });
    await this.perform(() => this.api.garage.save(input));
  }

  async quarantine(): Promise<void> {
    if (this.busy()) throw new Error('车库正在处理中');
    this.update({ ...this.snapshot, status: 'quarantining', error: undefined });
    await this.perform(() => this.api.garage.quarantine());
  }

  async exportDiagnostic(): Promise<string | undefined> {
    try {
      return (await this.api.garage.exportDiagnostic()).fileName;
    } catch (error) {
      this.update({ ...this.snapshot, error: playerMessage(error) });
      return undefined;
    }
  }

  private async perform(operation: () => Promise<GarageSnapshotV1>): Promise<void> {
    try {
      const garage = await operation();
      this.update({ status: 'ready', garage, error: undefined });
    } catch (error) {
      this.update({
        status: this.snapshot.garage ? 'ready' : 'idle',
        ...(this.snapshot.garage ? { garage: this.snapshot.garage } : {}),
        error: playerMessage(error),
      });
    }
  }

  private busy(): boolean {
    return ['loading', 'saving', 'quarantining'].includes(this.snapshot.status);
  }

  private update(snapshot: GarageControllerSnapshotV1): void {
    this.snapshot = structuredClone(snapshot);
    const current = this.getSnapshot();
    this.listeners.forEach((listener) => listener(current));
  }
}

function playerMessage(error: unknown): string {
  return error instanceof Error && error.message.trim() ? error.message : '操作没有完成，请稍后重试。';
}
