import type {
  DesktopPageIdV1,
  PlayerDoctrineV1,
  PlayerProfileV1,
  TutorialStageV1,
} from './player-profile-v1.js';
import type { DesktopBootstrapV1 } from './application-service-v1.js';
import type { TutorialMatchResultV1 } from './tutorial-match-service-v1.js';

export interface DesktopApiV1 {
  app: {
    bootstrap(): Promise<DesktopBootstrapV1>;
  };
  profile: {
    create(input: { displayName: string; doctrine: PlayerDoctrineV1 }): Promise<PlayerProfileV1>;
    advanceTutorial(stage: TutorialStageV1): Promise<PlayerProfileV1>;
  };
  navigation: {
    remember(page: DesktopPageIdV1): Promise<PlayerProfileV1>;
  };
  tutorial: {
    run(): Promise<TutorialMatchResultV1>;
  };
}
