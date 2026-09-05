import type { DesktopApiV1 } from '../desktop-api-v1.js';
import type { DesktopPageIdV1, PlayerProfileV1 } from '../player-profile-v1.js';

export interface DesktopAppShellSnapshotV1 {
  status: 'loading' | 'onboarding' | 'ready' | 'error';
  page: DesktopPageIdV1;
  profile?: PlayerProfileV1;
  error?: string;
  recoveryNotice?: string;
}

export class DesktopAppShellControllerV1 {
  private snapshot: DesktopAppShellSnapshotV1 = { status: 'loading', page: 'command-center' };
  private readonly enabledPages: ReadonlySet<DesktopPageIdV1>;

  constructor(private readonly api: DesktopApiV1, enabledPages: readonly DesktopPageIdV1[]) {
    this.enabledPages = new Set(enabledPages);
    if (!this.enabledPages.has('command-center')) throw new Error('指挥中心必须可用');
  }

  async bootstrap(): Promise<void> {
    this.snapshot = { status: 'loading', page: 'command-center' };
    try {
      const bootstrap = await this.api.app.bootstrap();
      if (!bootstrap.profile || bootstrap.needsOnboarding) {
        this.snapshot = {
          status: 'onboarding',
          page: 'command-center',
          ...(bootstrap.profile ? { profile: bootstrap.profile } : {}),
          ...(bootstrap.recoveryNotice ? { recoveryNotice: bootstrap.recoveryNotice } : {}),
        };
        return;
      }
      const requested = bootstrap.profile.recentPage;
      const page = this.enabledPages.has(requested) ? requested : 'command-center';
      const profile = page === requested
        ? bootstrap.profile
        : await this.api.navigation.remember('command-center');
      this.snapshot = { status: 'ready', page, profile, ...(bootstrap.recoveryNotice ? { recoveryNotice: bootstrap.recoveryNotice } : {}) };
    } catch (error) {
      this.snapshot = {
        status: 'error',
        page: 'command-center',
        error: error instanceof Error ? error.message : '游戏数据加载失败，请重试。',
      };
    }
  }

  async navigate(page: DesktopPageIdV1): Promise<void> {
    if (this.snapshot.status !== 'ready' || !this.snapshot.profile) throw new Error('游戏尚未准备完成');
    if (!this.enabledPages.has(page)) throw new Error('该区域尚未开放');
    const profile = await this.api.navigation.remember(page);
    this.snapshot = { status: 'ready', page, profile };
  }

  getSnapshot(): DesktopAppShellSnapshotV1 {
    return structuredClone(this.snapshot);
  }
}
