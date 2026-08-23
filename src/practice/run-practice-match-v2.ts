import type { ContentSnapshotV2, MapSnapshotV2 } from '../core/v2/content.js';
import type { MatchConfigV2, MatchTeamConfigV2 } from '../core/v2/match-config.js';
import { assertSavedBuildV2, type SavedBuildV2 } from '../config/saved-build-v2.js';
import {
  runMatchV2,
  type GameplayMatchOutputV2,
} from '../runner/match-v2.js';

export interface PracticeMatchInputV2 {
  current: SavedBuildV2;
  opponent: SavedBuildV2;
  contentSnapshot: ContentSnapshotV2;
  mapSnapshot: MapSnapshotV2;
  seed: number;
  maxTicks: number;
  createdAt?: string;
  tickBudgetMs?: number;
  maxViolations?: number;
  collectLogs?: boolean;
}

export interface PracticeParticipantV2 {
  buildId: string;
  revision: number;
  fingerprint: string;
}

export interface PracticeMatchOutputV2 extends GameplayMatchOutputV2 {
  participants: {
    current: PracticeParticipantV2;
    opponent: PracticeParticipantV2;
  };
}

export async function runPracticeMatchV2(input: PracticeMatchInputV2): Promise<PracticeMatchOutputV2> {
  const current = assertSavedBuildV2(input.current);
  const opponent = assertSavedBuildV2(input.opponent);
  assertRunnableLanguage(current);
  assertRunnableLanguage(opponent);
  const matchConfig: MatchConfigV2 = {
    schemaVersion: 2,
    matchId: `practice-${current.fingerprint.slice(0, 12)}-${opponent.fingerprint.slice(0, 12)}`,
    ruleset: { id: 'gameplay-v2', version: '2.0.0' },
    modeId: 'duel',
    mapId: input.mapSnapshot.id,
    seed: input.seed >>> 0,
    maxTicks: input.maxTicks,
    teams: [
      teamFromBuild('current', current),
      teamFromBuild('historical', opponent),
    ],
  };
  const result = await runMatchV2({
    matchConfig,
    contentSnapshot: input.contentSnapshot,
    mapSnapshot: input.mapSnapshot,
    bots: [
      { path: current.botArtifact.entryPoint, code: current.botArtifact.source },
      { path: opponent.botArtifact.entryPoint, code: opponent.botArtifact.source },
    ],
    ...(input.createdAt !== undefined ? { createdAt: input.createdAt } : {}),
    ...(input.tickBudgetMs !== undefined ? { tickBudgetMs: input.tickBudgetMs } : {}),
    ...(input.maxViolations !== undefined ? { maxViolations: input.maxViolations } : {}),
    ...(input.collectLogs !== undefined ? { collectLogs: input.collectLogs } : {}),
  });
  return {
    participants: {
      current: participant(current),
      opponent: participant(opponent),
    },
    ...result,
  };
}

function teamFromBuild(teamId: string, build: SavedBuildV2): MatchTeamConfigV2 {
  return {
    teamId,
    displayName: `${build.label} r${build.revision}`.slice(0, 80),
    bot: {
      artifactId: build.botArtifact.artifactId,
      version: build.botArtifact.version,
      codeHash: build.botArtifact.codeHash,
    },
    loadout: {
      vehicleId: build.loadout.vehicleId,
      weaponIds: [build.loadout.weaponId],
      equipmentIds: [...build.loadout.equipmentIds],
    },
  };
}

function participant(build: SavedBuildV2): PracticeParticipantV2 {
  return { buildId: build.buildId, revision: build.revision, fingerprint: build.fingerprint };
}

function assertRunnableLanguage(build: SavedBuildV2): void {
  if (build.botArtifact.language !== 'javascript') {
    throw new Error(`Practice runner currently requires JavaScript: ${build.buildId}@${build.revision}`);
  }
}
