import type { DesktopApiV1 } from '../desktop-api-v1.js';
import type {
  ReplayCardV1,
  ReplayLibraryFilterV1,
  ReplayLibrarySnapshotV1,
  ReplaySourceV1,
  ReplayTrashCardV1,
} from '../replay-library-service-v1.js';

type ReplayApiV1 = DesktopApiV1['replays'];

export interface ReplayLibraryControllerSnapshotV1 {
  status: 'idle' | 'loading' | 'ready' | 'error';
  busy: boolean;
  filter: ReplayLibraryFilterV1;
  cards: ReplayCardV1[];
  counts: ReplayLibrarySnapshotV1['counts'];
  trash: ReplayTrashCardV1[];
  message?: string;
}

const EMPTY_COUNTS = { all: 0, practice: 0, friendPublic: 0, damaged: 0, trash: 0 };

export class ReplayLibraryControllerV1 {
  private readonly api: ReplayApiV1;
  private snapshot: ReplayLibraryControllerSnapshotV1 = {
    status: 'idle', busy: false, filter: {}, cards: [], counts: EMPTY_COUNTS, trash: [],
  };

  constructor(api: ReplayApiV1) {
    this.api = api;
  }

  async initialize(): Promise<void> {
    this.snapshot.status = 'loading';
    await this.refresh();
  }

  async refresh(): Promise<void> {
    try {
      const [library, trash] = await Promise.all([this.api.list(this.snapshot.filter), this.api.listTrash()]);
      this.snapshot = { ...this.snapshot, status: 'ready', cards: library.cards, counts: library.counts, trash, message: undefined };
    } catch {
      this.snapshot = { ...this.snapshot, status: 'error', message: '回放列表暂时无法刷新。' };
    }
  }

  async setFilter(filter: ReplayLibraryFilterV1): Promise<void> {
    this.snapshot.filter = structuredClone(filter);
    await this.refresh();
  }

  async open(replayId: string, source: ReplaySourceV1) {
    return this.api.open({ replayId, source });
  }

  async updateNote(replayId: string, source: ReplaySourceV1, note: string): Promise<void> {
    await this.mutate(async () => { await this.api.note({ replayId, source, note }); });
  }

  async export(replayId: string, source: ReplaySourceV1): Promise<string> {
    let filename = '';
    await this.mutate(async () => { filename = await this.api.export({ replayId, source }); });
    return filename;
  }

  async moveToTrash(replayId: string, source: ReplaySourceV1): Promise<void> {
    await this.mutate(async () => { await this.api.moveToTrash({ replayId, source }); });
  }

  async restore(entryId: string): Promise<void> {
    await this.mutate(async () => { await this.api.restore(entryId); });
  }

  async emptyTrash(): Promise<void> {
    await this.mutate(async () => { await this.api.emptyTrash(true); });
  }

  getSnapshot(): ReplayLibraryControllerSnapshotV1 {
    return structuredClone(this.snapshot);
  }

  private async mutate(action: () => Promise<void>): Promise<void> {
    if (this.snapshot.busy) throw new Error('请等待当前操作完成');
    this.snapshot.busy = true;
    try {
      await action();
      await this.refresh();
    } finally {
      this.snapshot.busy = false;
    }
  }
}
