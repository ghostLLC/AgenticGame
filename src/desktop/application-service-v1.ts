import type { PlayerProfileRepositoryV1 } from './player-profile-repository-v1.js';
import {
  createPlayerProfileV1,
  type DesktopPageIdV1,
  type PlayerDoctrineV1,
  type PlayerProfileV1,
  type TutorialStageV1,
} from './player-profile-v1.js';
import { runTutorialMatchV1, type TutorialMatchResultV1 } from './tutorial-match-service-v1.js';
import type { GarageSaveInputV1, GarageServiceV1, GarageSnapshotV1, GarageDiagnosticExportV1 } from './garage-service-v1.js';
import type { PracticeMatchServiceV1, PracticeResultViewV1, PracticeRunInputV1 } from './practice-match-service-v1.js';

export interface DesktopBootstrapV1 {
  needsOnboarding: boolean;
  profile?: PlayerProfileV1;
}

export interface DesktopApplicationServiceOptionsV1 {
  profileRepository: PlayerProfileRepositoryV1;
  now?: () => string;
  createPlayerId?: () => string;
  tutorialRunner?: typeof runTutorialMatchV1;
  garageService?: GarageServiceV1;
  practiceService?: PracticeMatchServiceV1;
}

export class DesktopApplicationServiceV1 {
  private readonly repository: PlayerProfileRepositoryV1;
  private readonly now: () => string;
  private readonly createPlayerId: () => string;
  private readonly tutorialRunner: typeof runTutorialMatchV1;
  private readonly garageService?: GarageServiceV1;
  private readonly practiceService?: PracticeMatchServiceV1;

  constructor(options: DesktopApplicationServiceOptionsV1) {
    this.repository = options.profileRepository;
    this.now = options.now ?? (() => new Date().toISOString());
    this.createPlayerId = options.createPlayerId ?? (() => crypto.randomUUID());
    this.tutorialRunner = options.tutorialRunner ?? runTutorialMatchV1;
    this.garageService = options.garageService;
    this.practiceService = options.practiceService;
  }

  async bootstrap(): Promise<DesktopBootstrapV1> {
    const profile = await this.repository.load();
    if (!profile) return { needsOnboarding: true };
    return { needsOnboarding: profile.tutorialStage !== 'complete', profile };
  }

  async createProfile(input: { displayName: string; doctrine: PlayerDoctrineV1 }): Promise<PlayerProfileV1> {
    if (await this.repository.load()) throw new Error('玩家档案已经存在');
    const profile = createPlayerProfileV1({
      playerId: this.createPlayerId(),
      displayName: input.displayName,
      doctrine: input.doctrine,
      now: this.now(),
    });
    await this.repository.save(profile);
    return structuredClone(profile);
  }

  async runTutorial(): Promise<TutorialMatchResultV1> {
    const profile = await this.requireProfile();
    return this.tutorialRunner({
      doctrine: profile.doctrine,
      displayName: profile.displayName,
      now: this.now(),
    });
  }

  async advanceTutorial(stage: TutorialStageV1): Promise<PlayerProfileV1> {
    const profile = await this.requireProfile();
    const expected = profile.tutorialStage === 'battle'
      ? 'replay'
      : profile.tutorialStage === 'replay'
        ? 'complete'
        : null;
    if (stage !== expected) throw new Error('教程进度无效');
    return this.saveUpdated({ ...profile, tutorialStage: stage, lastOpenedAt: this.now() });
  }

  async rememberPage(page: DesktopPageIdV1): Promise<PlayerProfileV1> {
    const profile = await this.requireProfile();
    return this.saveUpdated({ ...profile, recentPage: page, lastOpenedAt: this.now() });
  }

  async getGarage(): Promise<GarageSnapshotV1> {
    const profile = await this.requireCompletedProfile();
    return this.requireGarageService().getSnapshot(profile);
  }

  async saveGarageRevision(input: GarageSaveInputV1): Promise<GarageSnapshotV1> {
    const profile = await this.requireCompletedProfile();
    return this.requireGarageService().saveRevision(profile, input);
  }

  async quarantineGarageHistory(): Promise<GarageSnapshotV1> {
    const profile = await this.requireCompletedProfile();
    return this.requireGarageService().quarantineDamagedHistory(profile);
  }

  async exportGarageDiagnostic(): Promise<GarageDiagnosticExportV1> {
    const profile = await this.requireCompletedProfile();
    return this.requireGarageService().exportDiagnostic(profile);
  }

  async runPractice(input: PracticeRunInputV1): Promise<PracticeResultViewV1> {
    await this.requireCompletedProfile();
    return this.requirePracticeService().run(input);
  }

  private async requireProfile(): Promise<PlayerProfileV1> {
    const profile = await this.repository.load();
    if (!profile) throw new Error('请先建立指挥官档案');
    return profile;
  }

  private async requireCompletedProfile(): Promise<PlayerProfileV1> {
    const profile = await this.requireProfile();
    if (profile.tutorialStage !== 'complete') throw new Error('请先完成新手教程');
    return profile;
  }

  private requireGarageService(): GarageServiceV1 {
    if (!this.garageService) throw new Error('车库服务暂不可用');
    return this.garageService;
  }

  private requirePracticeService(): PracticeMatchServiceV1 {
    if (!this.practiceService) throw new Error('练习赛服务暂不可用');
    return this.practiceService;
  }

  private async saveUpdated(profile: PlayerProfileV1): Promise<PlayerProfileV1> {
    await this.repository.save(profile);
    return structuredClone(profile);
  }
}
