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
import type {
  ReplayLibraryFilterV1,
  ReplayLibraryServiceV1,
  ReplayLibrarySnapshotV1,
  ReplaySourceV1,
  ReplayTrashCardV1,
} from './replay-library-service-v1.js';
import type {
  AgentCenterRunInputV1,
  AgentCenterRunResultV1,
  AgentCenterSaveInputV1,
  AgentCenterServiceV1,
  AgentCenterSnapshotV1,
} from './agent-center-service-v1.js';

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
  replayService?: ReplayLibraryServiceV1;
  agentCenterService?: AgentCenterServiceV1;
}

export class DesktopApplicationServiceV1 {
  private readonly repository: PlayerProfileRepositoryV1;
  private readonly now: () => string;
  private readonly createPlayerId: () => string;
  private readonly tutorialRunner: typeof runTutorialMatchV1;
  private readonly garageService?: GarageServiceV1;
  private readonly practiceService?: PracticeMatchServiceV1;
  private readonly replayService?: ReplayLibraryServiceV1;
  private readonly agentCenterService?: AgentCenterServiceV1;

  constructor(options: DesktopApplicationServiceOptionsV1) {
    this.repository = options.profileRepository;
    this.now = options.now ?? (() => new Date().toISOString());
    this.createPlayerId = options.createPlayerId ?? (() => crypto.randomUUID());
    this.tutorialRunner = options.tutorialRunner ?? runTutorialMatchV1;
    this.garageService = options.garageService;
    this.practiceService = options.practiceService;
    this.replayService = options.replayService;
    this.agentCenterService = options.agentCenterService;
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

  async listReplays(filter: ReplayLibraryFilterV1): Promise<ReplayLibrarySnapshotV1> {
    await this.requireCompletedProfile();
    return this.requireReplayService().list(filter);
  }

  async openReplay(replayId: string, source: ReplaySourceV1) {
    await this.requireCompletedProfile();
    return this.requireReplayService().open(replayId, source);
  }

  async updateReplayNote(replayId: string, source: ReplaySourceV1, note: string): Promise<void> {
    await this.requireCompletedProfile();
    return this.requireReplayService().updateNote(replayId, source, note);
  }

  async exportReplay(replayId: string, source: ReplaySourceV1): Promise<string> {
    await this.requireCompletedProfile();
    return this.requireReplayService().export(replayId, source);
  }

  async moveReplayToTrash(replayId: string, source: ReplaySourceV1) {
    await this.requireCompletedProfile();
    return this.requireReplayService().moveToTrash(replayId, source);
  }

  async listReplayTrash(): Promise<ReplayTrashCardV1[]> {
    await this.requireCompletedProfile();
    return this.requireReplayService().listTrash();
  }

  async restoreReplay(entryId: string): Promise<void> {
    await this.requireCompletedProfile();
    return this.requireReplayService().restore(entryId);
  }

  async emptyReplayTrash(confirmed: boolean): Promise<string[]> {
    await this.requireCompletedProfile();
    return this.requireReplayService().emptyTrash(confirmed);
  }

  async exportReplayDiagnostic(): Promise<string> {
    await this.requireCompletedProfile();
    return this.requireReplayService().exportDiagnostic();
  }

  async getAgentCenter(): Promise<AgentCenterSnapshotV1> {
    await this.requireCompletedProfile();
    return this.requireAgentCenterService().getSnapshot();
  }

  async runAgentCenter(input: AgentCenterRunInputV1): Promise<AgentCenterRunResultV1> {
    await this.requireCompletedProfile();
    return this.requireAgentCenterService().run(input);
  }

  async cancelAgentCenter(): Promise<boolean> {
    await this.requireCompletedProfile();
    return this.requireAgentCenterService().cancel();
  }

  async saveAgentCandidate(input: AgentCenterSaveInputV1): Promise<{ revision: number; label: string }> {
    await this.requireCompletedProfile();
    return this.requireAgentCenterService().saveCandidate(input);
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

  private requireReplayService(): ReplayLibraryServiceV1 {
    if (!this.replayService) throw new Error('回放工作室暂不可用');
    return this.replayService;
  }

  private requireAgentCenterService(): AgentCenterServiceV1 {
    if (!this.agentCenterService) throw new Error('AI 队友中心暂不可用');
    return this.agentCenterService;
  }

  private async saveUpdated(profile: PlayerProfileV1): Promise<PlayerProfileV1> {
    await this.repository.save(profile);
    return structuredClone(profile);
  }
}
