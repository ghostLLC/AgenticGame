import type {
  DesktopPageIdV1,
  PlayerDoctrineV1,
  PlayerProfileV1,
  TutorialStageV1,
} from './player-profile-v1.js';
import type { DesktopBootstrapV1 } from './application-service-v1.js';
import type { TutorialMatchResultV1 } from './tutorial-match-service-v1.js';
import type { GarageDiagnosticExportV1, GarageSaveInputV1, GarageSnapshotV1 } from './garage-service-v1.js';
import type { PracticeResultViewV1, PracticeRunInputV1 } from './practice-match-service-v1.js';
import type {
  ReplayLibraryFilterV1,
  ReplayLibrarySnapshotV1,
  ReplaySourceV1,
  ReplayTrashCardV1,
} from './replay-library-service-v1.js';
import type { FriendRoomReplayV1 } from '../friend-room/replay-v1.js';
import type {
  AgentCenterRunInputV1,
  AgentCenterRunResultV1,
  AgentCenterSaveInputV1,
  AgentCenterSnapshotV1,
} from './agent-center-service-v1.js';
import type { AppSettingsV1 } from './app-settings-v1.js';
import type { DiagnosticPrivacyPreviewV1, LegacyImportProjectionV1 } from './settings-service-v1.js';
import type { ReleaseDiagnosticReportV1 } from './release-diagnostics-service-v1.js';

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
  garage: {
    get(): Promise<GarageSnapshotV1>;
    save(input: GarageSaveInputV1): Promise<GarageSnapshotV1>;
    quarantine(): Promise<GarageSnapshotV1>;
    exportDiagnostic(): Promise<GarageDiagnosticExportV1>;
  };
  practice: {
    run(input: PracticeRunInputV1): Promise<PracticeResultViewV1>;
  };
  replays: {
    list(filter: ReplayLibraryFilterV1): Promise<ReplayLibrarySnapshotV1>;
    open(input: { replayId: string; source: ReplaySourceV1 }): Promise<{ replayId: string; source: ReplaySourceV1; replay: FriendRoomReplayV1 }>;
    note(input: { replayId: string; source: ReplaySourceV1; note: string }): Promise<void>;
    export(input: { replayId: string; source: ReplaySourceV1 }): Promise<string>;
    moveToTrash(input: { replayId: string; source: ReplaySourceV1 }): Promise<{ entryId: string }>;
    listTrash(): Promise<ReplayTrashCardV1[]>;
    restore(entryId: string): Promise<void>;
    emptyTrash(confirmed: true): Promise<string[]>;
    exportDiagnostic(): Promise<string>;
  };
  agentCenter: {
    get(): Promise<AgentCenterSnapshotV1>;
    run(input: AgentCenterRunInputV1): Promise<AgentCenterRunResultV1>;
    cancel(): Promise<boolean>;
    save(input: AgentCenterSaveInputV1): Promise<{ revision: number; label: string }>;
  };
  settings: {
    get(): Promise<AppSettingsV1>;
    save(input: AppSettingsV1): Promise<AppSettingsV1>;
    diagnosticPreview(): Promise<DiagnosticPrivacyPreviewV1>;
    runDiagnostics(): Promise<ReleaseDiagnosticReportV1>;
    exportDiagnostics(): Promise<{ fileName: string }>;
    importLegacy(): Promise<LegacyImportProjectionV1>;
    openReleases(): Promise<void>;
  };
}
