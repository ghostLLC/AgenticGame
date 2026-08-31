import type { DesktopApiV1 } from '../desktop-api-v1.js';
import type { DesktopBootstrapV1 } from '../application-service-v1.js';
import type { PlayerDoctrineV1, PlayerProfileV1 } from '../player-profile-v1.js';
import type { TutorialMatchResultV1 } from '../tutorial-match-service-v1.js';

export type OnboardingPhaseV1 = 'commander' | 'doctrine' | 'battle' | 'running' | 'replay' | 'complete';

export interface OnboardingSnapshotV1 {
  phase: OnboardingPhaseV1;
  displayName: string;
  profile?: PlayerProfileV1;
  result?: TutorialMatchResultV1;
  error?: string;
}

export class OnboardingControllerV1 {
  private snapshot: OnboardingSnapshotV1 = { phase: 'commander', displayName: '' };

  constructor(private readonly api: DesktopApiV1) {}

  async initialize(bootstrap: DesktopBootstrapV1): Promise<void> {
    if (!bootstrap.profile) {
      this.snapshot = { phase: 'commander', displayName: '' };
      return;
    }
    const profile = structuredClone(bootstrap.profile);
    if (profile.tutorialStage === 'complete') {
      this.snapshot = { phase: 'complete', displayName: profile.displayName, profile };
      return;
    }
    if (profile.tutorialStage === 'battle') {
      this.snapshot = { phase: 'battle', displayName: profile.displayName, profile };
      return;
    }
    this.snapshot = { phase: 'running', displayName: profile.displayName, profile };
    try {
      const result = await this.api.tutorial.run();
      this.snapshot = { phase: 'replay', displayName: profile.displayName, profile, result };
    } catch (error) {
      this.snapshot = { phase: 'replay', displayName: profile.displayName, profile, error: safeMessage(error) };
    }
  }

  enterCommanderName(input: string): void {
    if (this.snapshot.phase !== 'commander') throw new Error('当前不能修改指挥官昵称');
    const displayName = input.trim();
    if ([...displayName].length < 1 || [...displayName].length > 24) throw new Error('请输入 1–24 个字符的昵称');
    this.snapshot = { phase: 'doctrine', displayName };
  }

  async chooseDoctrine(doctrine: PlayerDoctrineV1): Promise<void> {
    if (this.snapshot.phase !== 'doctrine') throw new Error('当前不能选择作战风格');
    const profile = await this.api.profile.create({ displayName: this.snapshot.displayName, doctrine });
    this.snapshot = { phase: 'battle', displayName: profile.displayName, profile };
  }

  async runBattle(): Promise<void> {
    if (this.snapshot.phase !== 'battle' || !this.snapshot.profile) throw new Error('教学战斗尚未准备好');
    const profile = this.snapshot.profile;
    this.snapshot = { phase: 'running', displayName: profile.displayName, profile };
    try {
      const result = await this.api.tutorial.run();
      const advanced = await this.api.profile.advanceTutorial('replay');
      this.snapshot = { phase: 'replay', displayName: advanced.displayName, profile: advanced, result };
    } catch (error) {
      this.snapshot = { phase: 'battle', displayName: profile.displayName, profile, error: safeMessage(error) };
      throw error;
    }
  }

  async finishReplay(): Promise<void> {
    if (this.snapshot.phase !== 'replay' || !this.snapshot.profile) throw new Error('请先完成教学回放');
    const profile = await this.api.profile.advanceTutorial('complete');
    this.snapshot = { phase: 'complete', displayName: profile.displayName, profile };
  }

  getSnapshot(): OnboardingSnapshotV1 {
    return structuredClone(this.snapshot);
  }
}

function safeMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '教学战斗未能完成，请重试。';
}
