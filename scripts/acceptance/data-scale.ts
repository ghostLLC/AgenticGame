import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createSavedBuildV2 } from '../../src/config/saved-build-v2.js';
import { SavedBuildRepositoryV2 } from '../../src/config/saved-build-repository-v2.js';
import { createMatchBundleV2 } from '../../src/replay/v2.js';
import { ReplayRepositoryV2 } from '../../src/replay/repository-v2.js';
import { PublicReplayRepositoryV1 } from '../../src/desktop/public-replay-repository-v1.js';
import { ReplayLibraryServiceV1 } from '../../src/desktop/replay-library-service-v1.js';
import { ReplayMetadataRepositoryV1 } from '../../src/desktop/replay-metadata-repository-v1.js';
import { ReplayTrashRepositoryV1 } from '../../src/desktop/replay-trash-repository-v1.js';
import { BuildRevisionNoteRepositoryV1 } from '../../src/desktop/build-revision-note-repository-v1.js';
import { GarageServiceV1 } from '../../src/desktop/garage-service-v1.js';
import { createPresetBuildV1 } from '../../src/desktop/preset-builds-v1.js';
import { runPracticeMatchV2 } from '../../src/practice/run-practice-match-v2.js';
import { GAMEPLAY_CONTENT_V2, GAMEPLAY_MAP_FRONTIER_V2 } from '../../src/core/v2/gameplay-content.js';

const root = resolve('.tmp/data-scale-quality');
const now = '2026-09-05T00:00:00.000Z';
const current = createPresetBuildV1('medium', now);
await mkdir(root, { recursive: true });
const marker = join(root, 'fixture-ready.json');
const reuse = await readFile(marker).then(() => true, () => false);
if (!reuse) {
  const base = (await runPracticeMatchV2({ current, opponent: current, contentSnapshot: GAMEPLAY_CONTENT_V2,
    mapSnapshot: GAMEPLAY_MAP_FRONTIER_V2, seed: 11, maxTicks: 120, tickBudgetMs: 100, collectLogs: false, createdAt: now })).bundle;
  let parent: string | null = null;
  const buildRoot = join(root, 'builds', 'commander-main'); await mkdir(buildRoot, { recursive: true });
  for (let revision = 1; revision <= 500; revision++) {
    const saved = createSavedBuildV2({ buildId: 'commander-main', label: `规模测试 ${revision}`, bot: current.botArtifact, loadout: current.loadout },
      { revision, parentFingerprint: parent, createdAt: now });
    parent = saved.fingerprint;
    await writeFile(join(buildRoot, `${revision}.json`), JSON.stringify(saved));
  }
  for (const count of [100, 1000]) {
    const replayRoot = join(root, `replays-${count}`); await mkdir(replayRoot, { recursive: true });
    for (let index = 0; index < count; index++) {
      const bundle = createMatchBundleV2({ ...base, config: { ...base.config, matchId: `scale-${index}` }, createdAt: new Date(Date.parse(now) + index * 1000).toISOString() });
      await writeFile(join(replayRoot, `${bundle.integrity.bundleHash}.json`), JSON.stringify(bundle));
      if (index % 100 === 99) process.stdout.write(`fixture ${count}: ${index + 1}\n`);
    }
  }
  await writeFile(marker, JSON.stringify({ version: 1, replays: [100, 1000], revisions: 500 }));
}
const results: Array<Record<string, unknown>> = [];
async function measure(name: string, count: number, operation: () => Promise<unknown>) {
  const started = performance.now(); await operation();
  const result = { name, count, milliseconds: Math.round(performance.now() - started), rssMiB: Math.round(process.memoryUsage().rss / 1024 / 1024) };
  results.push(result); process.stdout.write(`${JSON.stringify(result)}\n`);
}
for (const count of [100, 1000]) {
  const replays = new ReplayRepositoryV2(join(root, `replays-${count}`));
  const library = new ReplayLibraryServiceV1({ replayRepository: replays, publicRepository: new PublicReplayRepositoryV1(join(root, 'public')),
    metadataRepository: new ReplayMetadataRepositoryV1(join(root, 'notes')), trashRepository: new ReplayTrashRepositoryV1(join(root, 'trash')), exportsRoot: join(root, 'exports') });
  await measure('replay-inspect-cold', count, () => replays.inspect());
  await measure('replay-inspect-warm', count, () => replays.inspect());
  await measure('library-list', count, () => library.list({}));
  if (count === 1000) {
    const garage = new GarageServiceV1({ buildRepository: new SavedBuildRepositoryV2(join(root, 'builds')),
      noteRepository: new BuildRevisionNoteRepositoryV1(join(root, 'build-notes')), replayRepository: replays, diagnosticsRoot: join(root, 'diagnostics') });
    await measure('garage-500-revisions-1000-replays', 500, () => garage.getSnapshot({ version: 1,
      playerId: '11111111-1111-4111-8111-111111111111', displayName: '规模测试', doctrine: 'medium', tutorialStage: 'complete', recentPage: 'garage', createdAt: now, lastOpenedAt: now }));
  }
}
await writeFile(join(root, `measurement-${Date.now()}.json`), JSON.stringify({ createdAt: new Date().toISOString(), results }, null, 2));
