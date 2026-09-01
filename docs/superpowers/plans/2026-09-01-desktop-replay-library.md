# Desktop Replay Library Slice 3 Implementation Plan

> **Execution note:** Follow the repository TDD rule task by task: add one focused failing test, run it and observe the capability failure, implement the smallest production change, then run the focused regression set. Execute inline; do not pause for intermediate user acceptance.

**Goal:** Deliver a normal-game Replay Studio where players can browse, filter, annotate, play, export, recover and intentionally delete verified local Replay v2 matches, while separately preserving privacy-safe friend-room public replays.

**Architecture:** Keep complete MatchBundleV2 files inside the main-process-only `ReplayRepositoryV2`. Add strict sidecar metadata, recoverable trash and a separate strict public-replay repository. A `ReplayLibraryServiceV1` verifies every input before creating a player projection or playable privacy-safe frame set. Application/IPC/controller layers expose only fixed actions and opaque replay IDs. The existing tactical-map player is generalized for both friend-room snapshots and local replay projections; the renderer never receives full bundles, sources, raw actions, debug logs or complete hashes.

**Tech Stack:** TypeScript, Node filesystem primitives, Electron IPC/preload, existing Gameplay/Replay v2 contracts, existing friend-room public replay format, Vitest, Playwright CLI, PowerShell packaging.

## Global Constraints

- Ranked code stays archived and untouched.
- No project server, account or cloud storage is introduced.
- Ardot is not a blocker for B and remains unchanged under the user's current instruction.
- Default UI uses player language; no source, hash, raw actions/logs, JSON, seed or filesystem paths.
- Complete local bundles never cross IPC. Only verified player projections and `FriendRoomReplayV1` frames do.
- Local replay delete is a recoverable move. Automatic purge happens only after seven full days; explicit empty-trash requires confirmation.
- Friend public replays are stored in a separate root and strict contract. They must never gain source, hash, actions or logs.
- Export writes only to the application-owned `exports/` root and returns a filename, never an arbitrary renderer path.
- Every persistence mutation is atomic or rollback-safe and covered by real temporary-directory tests.

### Task 1: Strict replay metadata, inspection and recoverable trash

**Files:**
- Create: `src/desktop/replay-metadata-repository-v1.ts`
- Create: `src/desktop/replay-trash-repository-v1.ts`
- Modify: `src/replay/repository-v2.ts`
- Create: `tests/replay-metadata-trash-v1.test.ts`
- Modify: `tests/replay-repository-v2.test.ts`

**Interfaces:**
- `ReplayMetadataV1 { version, replayId, note, createdAt, updatedAt }`
- `ReplayRepositoryV2.inspect()` returns healthy and corrupt files independently instead of letting one corrupt file hide the rest.
- Trash records preserve the original bytes, metadata, deletion time and source kind under an application-owned root.

- [x] **Step 1: Write failing strict metadata and inspection tests**

Cover exact fields, canonical time, 0–240 trimmed note, atomic overwrite, two valid replays plus one tampered replay, and no full bundle in inspection output.

- [x] **Step 2: Run focused tests and verify RED**

Run: `npm test -- tests/replay-metadata-trash-v1.test.ts tests/replay-repository-v2.test.ts`

- [x] **Step 3: Implement metadata and independent replay inspection**

Keep existing `list()` fail-closed behavior unchanged. Add a new inspection path used by the library.

- [x] **Step 4: Add failing move/restore/purge tests**

Assert exact-byte moves, rollback on partial failure, restore collision rejection, six-day retention, seven-day purge and explicit empty-trash.

- [x] **Step 5: Implement recoverable trash**

Use explicit replay IDs and validated roots. Never recursively delete an unresolved path.

- [x] **Step 6: Run GREEN, typecheck and commit**

Commit: `feat: add recoverable replay storage`

### Task 2: Player-facing replay library service

**Files:**
- Create: `src/desktop/replay-library-service-v1.ts`
- Create: `tests/desktop-replay-library-service-v1.test.ts`

**Interfaces:**

```ts
export type ReplaySourceV1 = 'practice' | 'friend-public';
export interface ReplayLibraryFilterV1 {
  modeId?: 'duel' | 'capture';
  outcome?: 'victory' | 'defeat' | 'draw';
  buildRevision?: number;
  query?: string;
}
export interface ReplayCardV1 {
  replayId: string;
  source: ReplaySourceV1;
  createdAt: string;
  modeName: string;
  participantNames: string[];
  outcome: 'victory' | 'defeat' | 'draw';
  ticks: number;
  note: string;
  integrity: 'verified' | 'damaged';
  playable: boolean;
}
```

The service produces cards, counts, filters, a privacy-safe playable replay, note updates, export filename, trash/restore/empty operations and sanitized diagnostics.

- [x] **Step 1: Write failing real-service tests**

Seed real duel/capture bundles and a corrupt file. Assert date/result/mode/revision/query filters, stable ordering, correct player outcome, at most player-safe data, public/local separation and healthy entries surviving corruption.

- [x] **Step 2: Run and verify RED**

Run: `npm test -- tests/desktop-replay-library-service-v1.test.ts`

- [x] **Step 3: Implement list/open/note/export projections**

For local bundles, call `createReplayStudioViewV2` and `createFriendRoomReplayV1` only after verification. Export a verified full local bundle or strict public replay into `exports/`; never return its path or content.

- [x] **Step 4: Implement recoverable delete and trash views**

Clean entries older than seven days on service bootstrap/list. Explicit empty-trash remains a separate method.

- [x] **Step 5: Run GREEN, privacy assertions and typecheck**

- [x] **Step 6: Commit**

Commit: `feat: add verified replay library`

### Task 3: Persist friend-room public replays without privacy regression

**Files:**
- Modify: `src/friend-room/replay-v1.ts`
- Create: `src/desktop/public-replay-repository-v1.ts`
- Modify: `src/desktop/friend-room-runtime-v1.ts`
- Modify: `src/desktop/main.ts`
- Create: `tests/public-replay-repository-v1.test.ts`
- Modify: `tests/desktop-friend-room-runtime-v1.test.ts`

**Interfaces:**
- Add `assertFriendRoomReplayV1` with exact keys, numeric/array bounds and canonical public content.
- Public replay ID is a deterministic digest internal to the main process; it is opaque in IPC.
- `DesktopFriendRoomRuntimeV1` invokes `onPublicReplay(snapshot)` once per completed room revision on both host and guest paths; repository save is idempotent.

- [x] **Step 1: Write failing strict public-replay tests**

Reject unknown fields, source/hash/action/log additions, invalid frames, oversized arrays and path tricks. Assert atomic save/load/list and dedupe.

- [x] **Step 2: Run and verify RED**

- [x] **Step 3: Implement strict public repository**

- [x] **Step 4: Write failing runtime persistence tests**

Assert complete snapshots persist once, rematches create a second entry, non-complete/repeated snapshots do not duplicate and persistence failure maps to a safe local error without corrupting the room result.

- [x] **Step 5: Implement runtime hook and production composition**

Use `userData/public-replays`; do not persist full friend bundles.

- [x] **Step 6: Run GREEN, existing friend-room regressions and commit**

Commit: `feat: preserve friend public replays`

### Task 4: Safe application APIs and replay library controllers

**Files:**
- Modify: `src/desktop/application-service-v1.ts`
- Modify: `src/desktop/application-ipc-v1.ts`
- Modify: `src/desktop/desktop-api-v1.ts`
- Modify: `src/desktop/desktop-preload-api-v1.ts`
- Modify: `src/desktop/main.ts`
- Create: `src/desktop/renderer/replay-library-controller-v1.ts`
- Create: `src/desktop/renderer/unified-replay-controller-v1.ts`
- Modify: `tests/desktop-application-service-v1.test.ts`
- Modify: `tests/desktop-application-ipc-v1.test.ts`
- Create: `tests/desktop-replay-library-controller-v1.test.ts`

**Interfaces:**
- Fixed APIs: `replays.list/open/note/export/moveToTrash/listTrash/restore/emptyTrash/exportDiagnostic`.
- No delete channel accepts a path. Exact replay-ID, note, filter and explicit-confirmation validators run before service execution.
- Library controller preserves last good cards on refresh failure and guards concurrent mutations.
- Unified replay controller consumes only `FriendRoomReplayV1`, supporting open/seek/play/pause/close.

- [x] **Step 1: Write failing service/IPC/preload tests**

- [x] **Step 2: Run and verify RED**

- [x] **Step 3: Implement application composition and fixed IPC**

- [x] **Step 4: Write failing controller tests**

- [x] **Step 5: Run and verify RED**

- [x] **Step 6: Implement pure controllers**

- [x] **Step 7: Run focused GREEN, typecheck and commit**

Commit: `feat: expose replay studio APIs`

### Task 5: Normal-game Replay Studio and unified tactical player

**Files:**
- Modify: `src/desktop/renderer/index.html`
- Modify: `src/desktop/renderer/styles.css`
- Modify: `src/desktop/renderer.ts`
- Modify: `src/desktop/renderer/app-shell-view-v1.ts`
- Create: `src/desktop/renderer/replay-library-view-v1.ts`
- Create: `src/desktop/renderer/unified-replay-view-v1.ts`
- Modify: `tests/desktop-shell-v1.test.ts`
- Modify: `tests/desktop-app-shell-v1.test.ts`

**Interfaces:**
- Enable “回放工作室” navigation and command-center entry.
- Cards show date, source, mode, participants, result, duration, note and integrity only.
- Filters are player controls, not query syntax.
- Opening either replay source uses the same tactical map, timeline, roster and moments.
- Delete uses a confirmation sheet and moves to trash. Trash has restore and explicit empty actions.

- [x] **Step 1: Add failing static player-flow and navigation assertions**

Assert loading/empty/damaged/library/player/trash states, filters, notes, export, recoverable delete, keyboard labels and absence of source/hash/JSON/seed/path copy.

- [x] **Step 2: Run and verify RED**

- [x] **Step 3: Add semantic page markup and shared player**

- [x] **Step 4: Implement DOM views and renderer wiring**

- [x] **Step 5: Style 1440×900 and 1100×700**

- [x] **Step 6: Run focused GREEN, typecheck and desktop build**

- [x] **Step 7: Commit**

Commit: `feat: add desktop replay studio`

### Task 6: Slice 3 release gate and synchronization

**Files:**
- Modify: `README.md`
- Modify: `HANDOFF.md`
- Modify: this plan
- Create: ignored browser evidence under `output/playwright/`
- Create: ignored `release/AgenticGame-0.1.0-slice3-win-x64.zip`

- [x] **Step 1: Run full automated gate**

Run: `npm test`, `npm run typecheck`, `npm audit --omit=dev`, `npm run build`, `npm run build:desktop`, `git diff --check`.

- [x] **Step 2: Run real-browser acceptance**

At both supported viewports: filter local/public cards, open/seek/play, edit note, export, move to trash, restore, empty with confirmation, damaged replay isolation, friend-room navigation and privacy copy. Record console and overflow results.

- [x] **Step 3: Build and smoke Slice 3 Windows candidate**

Package exact folder, ZIP it, start only its `AgenticGame.exe` hidden, verify `Responding=True`, stop its process tree, record bytes/hash and zero remaining candidate processes.

- [x] **Step 4: Update README/HANDOFF honestly**

Document roots, retention, public/local boundary, counts, candidate and remaining Slice 4–6 scope. Do not call B complete.

- [ ] **Step 5: Commit, push GitHub main and verify zero divergence**

- [ ] **Step 6: Sync Feishu and read back**

Update UX implementation state in place; append exactly one final-commit-keyed entry to technical architecture, development log and quality report; verify one occurrence per append-only page.

## Self-review

- Spec coverage: list/filter/integrity/note/open/export/recoverable delete/seven-day retention/public replay separation/unified player/page states/release gates are assigned.
- Privacy: full local bundles remain main-process-only; friend public replays have their own strict format and root.
- Destructive scope: normal delete is a move; recursive purge only targets resolved trash entries after validation or explicit confirmation.
- Execution mode: inline, autonomous and continuous under the user's standing unified-acceptance instruction.
