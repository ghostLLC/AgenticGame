# Desktop Garage and Practice Lab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a normal-game desktop garage where one local commander can save immutable tank revisions, inspect or isolate damaged history, and run current-versus-old or mirror practice matches that persist verified Replay v2 bundles.

**Architecture:** Extend the existing SavedBuild repository with non-throwing inspection and recoverable quarantine, while retaining its fail-closed `list` and `load` contracts. A dedicated `GarageServiceV1` owns the single local `commander-main` Build, revision metadata and player-facing projections; `PracticeMatchServiceV1` owns real sandbox execution and replay persistence. Versioned IPC and pure renderer controllers keep filesystem, source and hashes out of the default UI.

**Tech Stack:** Electron 44, TypeScript 5.5, Vitest 4, existing Gameplay v2/SavedBuildV2/ReplayRepositoryV2, browser DOM/CSS without a new UI runtime.

**Spec:** `docs/superpowers/specs/2026-08-31-public-beta-design.md` (Slice 2 and sections 4–5), plus `docs/product/build-history-practice-spec.md`.

## Global Constraints

- Keep Electron + TypeScript and do not add React, Vue or a new renderer runtime.
- Keep ranked code in `src/online` sealed and outside all player navigation.
- Store data under Electron `app.getPath('userData')`; all new JSON writes are strict and atomic.
- Default player views must not expose source, full hashes, raw configuration, seed or protocol terms.
- Practice always uses the real Gameplay v2 worker sandbox and saves a verified Replay v2 bundle.
- Corrupt revisions never run; healthy revisions before the first damaged chain link remain usable.
- Use TDD for every behavior change, with an observed RED before implementation.
- Every task ends with focused tests, typecheck where relevant, `git diff --check`, and a focused commit.

---

### Task 1: Recoverable SavedBuild inspection and quarantine

**Files:**
- Modify: `src/config/saved-build-repository-v2.ts`
- Modify: `tests/saved-build-repository-v2.test.ts`

**Interfaces:**
- Consumes: existing `SavedBuildRepositoryV2(root)` and strict `assertSavedBuildV2`.
- Produces: constructor option `{ quarantineRoot?: string; now?: () => string }`, `inspect(buildId): Promise<SavedBuildInspectionV2>`, and `quarantineFrom(buildId, revision): Promise<SavedBuildQuarantineResultV2>`.

- [x] **Step 1: Write failing real-filesystem inspection tests**

Add literal assertions that a tampered revision is reported as `corrupt`, all later files are `untrusted`, and the latest healthy record remains revision 1:

```ts
const inspection = await repo.inspect('history-scout');
expect(inspection.revisions.map(({ revision, state }) => ({ revision, state }))).toEqual([
  { revision: 1, state: 'healthy' },
  { revision: 2, state: 'corrupt' },
  { revision: 3, state: 'untrusted' },
]);
expect(inspection.latestHealthy?.revision).toBe(1);
```

Add a second test that `quarantineFrom('history-scout', 2)` moves revisions 2 and 3 beneath the configured quarantine root, leaves revision 1 loadable, and permits a replacement revision 2 save. Existing `list` must still fail closed before quarantine.

- [x] **Step 2: Run the focused repository test and verify RED**

Run: `npm test -- tests/saved-build-repository-v2.test.ts`

Expected: FAIL because `inspect`, the constructor options and `quarantineFrom` do not exist.

- [x] **Step 3: Implement inspection without weakening existing reads**

Add these public types:

```ts
export type SavedBuildRevisionInspectionV2 =
  | { revision: number; state: 'healthy'; record: SavedBuildV2 }
  | { revision: number; state: 'corrupt' | 'untrusted'; message: string };

export interface SavedBuildInspectionV2 {
  buildId: string;
  revisions: SavedBuildRevisionInspectionV2[];
  latestHealthy?: SavedBuildV2;
}
```

`inspect` parses every numeric revision in order. It verifies exact path/revision and parent linkage until the first failure; that item is `corrupt` and all subsequent items are `untrusted`. It returns player-safe messages and never returns unverified records. Keep `list` and `load` behavior unchanged.

- [x] **Step 4: Implement recoverable quarantine**

Under the existing save lock, move every numeric revision file at or after the requested revision into `<quarantineRoot>/builds/<buildId>/<UTC-id>/`. Reject missing configuration, healthy-only revision requests, traversal and concurrent saves. Preserve every byte; do not delete files. Return:

```ts
export interface SavedBuildQuarantineResultV2 {
  buildId: string;
  fromRevision: number;
  movedRevisions: number[];
  quarantineId: string;
}
```

- [x] **Step 5: Run focused GREEN and existing repository regressions**

Run: `npm test -- tests/saved-build-repository-v2.test.ts tests/saved-build-v2.test.ts`

Expected: all tests PASS and the original corruption test still throws from `list`.

- [x] **Step 6: Commit the repository recovery boundary**

```bash
git add src/config/saved-build-repository-v2.ts tests/saved-build-repository-v2.test.ts
git commit -m "feat: inspect and quarantine build history"
```

### Task 2: Strict revision notes and player-facing garage service

**Files:**
- Create: `src/desktop/build-revision-note-repository-v1.ts`
- Create: `src/desktop/garage-service-v1.ts`
- Create: `tests/build-revision-note-repository-v1.test.ts`
- Create: `tests/desktop-garage-service-v1.test.ts`

**Interfaces:**
- Consumes: `PlayerProfileV1`, `SavedBuildRepositoryV2`, `ReplayRepositoryV2`, `GAMEPLAY_CONTENT_V2`, and the preset doctrine behavior.
- Produces: `BuildRevisionNoteRepositoryV1`, `GarageServiceV1.getSnapshot(profile)`, `saveRevision(profile, input)`, `quarantineDamagedHistory(profile)`, and `exportDiagnostic(profile)`.

- [x] **Step 1: Write failing note-repository tests**

Use a real temporary root. Assert strict `{ version: 1, buildId, revision, tacticId, note, createdAt }`, atomic persistence, exact load, trimmed 0–240 character note, unknown-key rejection and path traversal rejection.

- [x] **Step 2: Run note tests and verify RED**

Run: `npm test -- tests/build-revision-note-repository-v1.test.ts`

Expected: FAIL because the repository module does not exist.

- [x] **Step 3: Implement the note repository**

Store notes at `<root>/<buildId>/<revision>.json` using sibling temporary write, file sync and rename. Export:

```ts
export type GarageTacticIdV1 = 'scout' | 'medium' | 'heavy';
export interface BuildRevisionNoteV1 {
  version: 1;
  buildId: string;
  revision: number;
  tacticId: GarageTacticIdV1;
  note: string;
  createdAt: string;
}
```

- [x] **Step 4: Write failing garage behavior tests**

With real repositories, assert:

1. the first `getSnapshot` seeds one `commander-main` revision from the profile doctrine;
2. saving a changed vehicle/tactic creates revision 2 and a literal player diff;
3. saving unchanged content is idempotent and creates no note or revision 3;
4. replay-derived win/loss/draw counts attach to the matching healthy revision;
5. corruption returns a damaged history state with revision 1 still selectable;
6. quarantine moves the damaged tail and a subsequent save replaces the broken revision number;
7. exported diagnostics contain issue codes and revision numbers but no Bot source or full fingerprint.

- [x] **Step 5: Run garage tests and verify RED**

Run: `npm test -- tests/desktop-garage-service-v1.test.ts`

Expected: FAIL because `GarageServiceV1` does not exist.

- [x] **Step 6: Implement `GarageServiceV1` projections**

Use the stable local Build ID `commander-main`. Export these player contracts:

```ts
export interface GarageSaveInputV1 {
  label: string;
  vehicleId: 'scout' | 'medium' | 'heavy';
  weaponId: 'light-cannon' | 'medium-cannon' | 'heavy-cannon';
  tacticId: GarageTacticIdV1;
  note: string;
}

export interface GarageRevisionViewV1 {
  revision: number;
  state: 'healthy' | 'corrupt' | 'untrusted';
  label: string;
  createdAt: string;
  vehicleName: string;
  weaponName: string;
  tacticName: string;
  note: string;
  changes: string[];
  record: { wins: number; losses: number; draws: number };
  selectable: boolean;
}
```

The snapshot also exposes literal vehicle/compatible-weapon stats, the current healthy revision, save state and a sanitized issue summary. Keep source and fingerprints out of all view types. Generate the Bot source internally from the three tactic IDs.

- [x] **Step 7: Run GREEN, typecheck and privacy assertions**

Run: `npm test -- tests/build-revision-note-repository-v1.test.ts tests/desktop-garage-service-v1.test.ts tests/saved-build-repository-v2.test.ts && npm run typecheck`

Expected: all tests PASS; serialized garage snapshots and diagnostics do not contain `module.exports` or 64-character hashes.

- [x] **Step 8: Commit the garage domain service**

```bash
git add src/desktop/build-revision-note-repository-v1.ts src/desktop/garage-service-v1.ts tests/build-revision-note-repository-v1.test.ts tests/desktop-garage-service-v1.test.ts
git commit -m "feat: add immutable player garage"
```

### Task 3: Practice service and Replay v2 persistence

**Files:**
- Modify: `src/practice/run-practice-match-v2.ts`
- Create: `src/desktop/practice-match-service-v1.ts`
- Modify: `tests/practice-match-v2.test.ts`
- Create: `tests/desktop-practice-match-service-v1.test.ts`

**Interfaces:**
- Consumes: healthy `commander-main` revisions, `runPracticeMatchV2`, `ReplayRepositoryV2`, and `createReplayStudioViewV2`.
- Produces: selectable duel/capture mode and `PracticeMatchServiceV1.run(input): Promise<PracticeResultViewV1>`.

- [x] **Step 1: Add a failing capture-mode runner test**

Pass `modeId: 'capture'` to `runPracticeMatchV2` and assert the verified output bundle contains `config.modeId === 'capture'`.

- [x] **Step 2: Run the practice runner test and verify RED**

Run: `npm test -- tests/practice-match-v2.test.ts`

Expected: TypeScript/test failure because `PracticeMatchInputV2` has no `modeId` and the runner hardcodes `duel`.

- [x] **Step 3: Implement strict optional mode selection**

Add `modeId?: 'duel' | 'capture'`, default to `duel`, reject unsupported modes before worker startup, and use the chosen ID in `MatchConfigV2`.

- [x] **Step 4: Write failing desktop practice-service tests**

Use two real saved revisions, real worker execution and a real replay repository. Assert current-vs-old and mirror runs; literal seed normalization; verified bundle persistence; player result containing revision labels, outcome, mode name, ticks, at most three moments and replay hash; invalid/corrupt revisions reject before a replay file appears.

- [x] **Step 5: Run service tests and verify RED**

Run: `npm test -- tests/desktop-practice-match-service-v1.test.ts`

Expected: FAIL because the desktop practice service does not exist.

- [x] **Step 6: Implement and persist real practice matches**

Export:

```ts
export interface PracticeRunInputV1 {
  currentRevision: number;
  opponentRevision: number;
  modeId: 'duel' | 'capture';
  seed?: number;
}

export interface PracticeResultViewV1 {
  replayHash: string;
  currentRevision: number;
  opponentRevision: number;
  outcome: 'victory' | 'defeat' | 'draw';
  modeName: string;
  ticks: number;
  moments: Array<{ tick: number; title: string; summary: string }>;
}
```

Run verified revisions with the official content/map, `maxTicks: 120`, `tickBudgetMs: 100`, save `output.bundle`, then derive the player view from `createReplayStudioViewV2`. Do not return bundle, source, logs, actions, seed or hashes other than the opaque replay ID.

- [x] **Step 7: Run focused GREEN and repository regressions**

Run: `npm test -- tests/practice-match-v2.test.ts tests/desktop-practice-match-service-v1.test.ts tests/replay-repository-v2.test.ts && npm run typecheck`

Expected: all tests PASS.

- [x] **Step 8: Commit practice persistence**

```bash
git add src/practice/run-practice-match-v2.ts src/desktop/practice-match-service-v1.ts tests/practice-match-v2.test.ts tests/desktop-practice-match-service-v1.test.ts
git commit -m "feat: persist desktop practice matches"
```

### Task 4: Application service, safe IPC and renderer controllers

**Files:**
- Modify: `src/desktop/application-service-v1.ts`
- Modify: `src/desktop/application-ipc-v1.ts`
- Modify: `src/desktop/desktop-api-v1.ts`
- Modify: `src/desktop/desktop-preload-api-v1.ts`
- Modify: `src/desktop/main.ts`
- Create: `src/desktop/renderer/garage-controller-v1.ts`
- Create: `src/desktop/renderer/practice-lab-controller-v1.ts`
- Modify: `tests/desktop-application-service-v1.test.ts`
- Modify: `tests/desktop-application-ipc-v1.test.ts`
- Create: `tests/desktop-garage-practice-controller-v1.test.ts`

**Interfaces:**
- Consumes: Task 2 and 3 services.
- Produces: whitelisted `garage.get/save/quarantine/exportDiagnostic` and `practice.run` APIs plus pure loading/running/success/error UI state machines.

- [x] **Step 1: Write failing application and IPC contract tests**

Assert the application service requires a completed profile before garage/practice operations. Assert exact new channel order and malformed label, incompatible loadout, revision, mode and seed inputs are rejected by IPC before service execution. Assert preload maps every method to a fixed channel and still has no generic `invoke`.

- [x] **Step 2: Run and verify RED**

Run: `npm test -- tests/desktop-application-service-v1.test.ts tests/desktop-application-ipc-v1.test.ts`

Expected: FAIL because the new methods and channels are missing.

- [x] **Step 3: Wire services into the application composition root**

Extend `DesktopApplicationServiceV1` with explicit garage/practice dependencies and methods. In `main.ts`, construct roots under `app.getPath('userData')`: `builds`, `build-metadata`, `replays`, `quarantine`, and `diagnostics`. Register only typed channels; do not expose a path or file picker.

- [x] **Step 4: Write failing controller behavior tests**

Assert garage load/save/quarantine states preserve the last healthy snapshot on errors. Assert practice cannot run without two selectable revisions, transitions `idle → running → complete`, prevents a second concurrent run, and keeps a completed result if a later run fails.

- [x] **Step 5: Run controller tests and verify RED**

Run: `npm test -- tests/desktop-garage-practice-controller-v1.test.ts`

Expected: FAIL because the controller modules do not exist.

- [x] **Step 6: Implement minimal pure controllers**

Controllers depend only on `DesktopApiV1`, return structured-cloned snapshots and map unknown exceptions to player-actionable Chinese text. They do not touch DOM, Node, repositories or raw replay bundles.

- [x] **Step 7: Run focused GREEN and typecheck**

Run: `npm test -- tests/desktop-application-service-v1.test.ts tests/desktop-application-ipc-v1.test.ts tests/desktop-garage-practice-controller-v1.test.ts && npm run typecheck`

Expected: all tests PASS.

- [x] **Step 8: Commit the desktop boundary**

```bash
git add src/desktop/application-service-v1.ts src/desktop/application-ipc-v1.ts src/desktop/desktop-api-v1.ts src/desktop/desktop-preload-api-v1.ts src/desktop/main.ts src/desktop/renderer/garage-controller-v1.ts src/desktop/renderer/practice-lab-controller-v1.ts tests/desktop-application-service-v1.test.ts tests/desktop-application-ipc-v1.test.ts tests/desktop-garage-practice-controller-v1.test.ts
git commit -m "feat: expose garage and practice APIs"
```

### Task 5: Normal-game garage and practice pages

**Files:**
- Modify: `src/desktop/renderer/index.html`
- Modify: `src/desktop/renderer/styles.css`
- Modify: `src/desktop/renderer.ts`
- Modify: `src/desktop/renderer/app-shell-view-v1.ts`
- Create: `src/desktop/renderer/garage-view-v1.ts`
- Create: `src/desktop/renderer/practice-lab-view-v1.ts`
- Modify: `tests/desktop-shell-v1.test.ts`
- Modify: `tests/desktop-app-shell-v1.test.ts`

**Interfaces:**
- Consumes: Task 4 controllers and `DesktopApiV1`.
- Produces: keyboard-operable `page-garage` and `page-practice`, enabled navigation and command-center entry points.

- [x] **Step 1: Add failing player-flow assertions**

Assert the real HTML exposes “我的车库”, “版本历史”, “保存为新版本”, “战术实验室”, “新版本对战旧版本”, “镜像训练”, loading/empty/damaged/running/success regions, and no source/hash/JSON/seed copy in default cards. Extend shell controller tests so garage and practice are enabled and remembered.

- [x] **Step 2: Run and verify RED**

Run: `npm test -- tests/desktop-shell-v1.test.ts tests/desktop-app-shell-v1.test.ts`

Expected: FAIL because pages are disabled or missing.

- [x] **Step 3: Add semantic page markup and navigation**

Add real forms with labels, compatible weapon selection, three tactic cards, revision label and change note. Add a revision timeline with health badge, configuration diff and record. Add practice selectors, mode cards, mirror shortcut, run progress, cancellability copy and result summary. Keep advanced data absent.

- [x] **Step 4: Implement focused DOM views and renderer wiring**

`garage-view-v1.ts` renders content via `textContent`, never `innerHTML` for repository data. `practice-lab-view-v1.ts` renders only `PracticeResultViewV1`. Renderer navigation lazy-loads garage, refreshes practice revisions after saves/quarantine, and disables duplicate submissions while running.

- [x] **Step 5: Style both pages at 1440×900 and 1100×700**

Use the existing warm military palette, large vehicle cards, horizontal revision timeline and clear primary action hierarchy. At 1100×700, collapse cards without horizontal page overflow. Preserve focus-visible and reduced-motion behavior.

- [x] **Step 6: Run focused GREEN, typecheck and desktop build**

Run:

```powershell
npm test -- tests/desktop-shell-v1.test.ts tests/desktop-app-shell-v1.test.ts tests/desktop-garage-practice-controller-v1.test.ts
npm run typecheck
npm run build:desktop
git diff --check
```

Expected: all commands exit 0.

- [x] **Step 7: Commit the player pages**

```bash
git add src/desktop/renderer/index.html src/desktop/renderer/styles.css src/desktop/renderer.ts src/desktop/renderer/app-shell-view-v1.ts src/desktop/renderer/garage-view-v1.ts src/desktop/renderer/practice-lab-view-v1.ts tests/desktop-shell-v1.test.ts tests/desktop-app-shell-v1.test.ts
git commit -m "feat: add garage and practice lab pages"
```

### Task 6: Slice 2 verification, candidate and project synchronization

**Files:**
- Modify: `README.md`
- Modify: `HANDOFF.md`
- Modify: `docs/superpowers/plans/2026-09-01-desktop-garage-practice.md`
- Create: ignored Playwright screenshots under `output/playwright/`
- Create: ignored versioned Windows ZIP under `release/`

**Interfaces:**
- Consumes: complete Slice 2.
- Produces: fresh automated, browser, Windows package, GitHub and Feishu evidence.

- [x] **Step 1: Run the full automated gate**

Run in order: `npm test`, `npm run typecheck`, `npm audit --omit=dev`, `npm run build`, `npm run build:desktop`, and `git diff --check`. Record exact test counts.

- [x] **Step 2: Run real-browser acceptance**

At 1440×900 and 1100×700, complete: garage initial state, changed revision save, timeline comparison, mirror practice, revision-2-vs-revision-1 practice, damaged-history view and recovery. Verify focus, no horizontal overflow, zero console errors/warnings, and friend-room navigation remains intact.

- [x] **Step 3: Build and smoke the Windows Slice 2 candidate**

Run `npm run pack:desktop-folder`, ZIP the exact output directory, start only that `AgenticGame.exe` hidden, verify `Responding=True`, stop its process tree, and record bytes/SHA-256.

- [x] **Step 4: Update README and HANDOFF honestly**

Document shipped UI behavior, data roots, test count, candidate hash and remaining Slice 3–6 scope. Do not call Public Beta B complete.

- [x] **Step 5: Commit and push GitHub main**

Commit documentation and plan state, push `main`, and verify `main...origin/main` is clean.

- [ ] **Step 6: Sync Feishu and read back**

Update the UX implementation-state block in place and append one entry keyed by the final short commit to technical architecture, development log and quality report. Re-read all four pages and verify exactly one matching occurrence per append-only page.

## Self-review

- Spec coverage: immutable history, health inspection, recoverable isolation, version label/note/diff/record, current-vs-old, mirror, mode selection, real sandbox, replay persistence, page states, safe IPC, normal-game UI and per-slice release gates are assigned to Tasks 1–6.
- Placeholder scan: no implementation step uses TBD/TODO or delegates unspecified handling.
- Type consistency: `GarageTacticIdV1`, `GarageSaveInputV1`, `GarageRevisionViewV1`, `PracticeRunInputV1` and `PracticeResultViewV1` are defined once and consumed by later tasks under the same names.
- Execution mode: inline execution is selected by the user's standing instruction to complete all work autonomously before unified acceptance.
