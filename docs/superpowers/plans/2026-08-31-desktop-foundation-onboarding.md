# Desktop Foundation and Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the versioned local player foundation, safe desktop IPC, recoverable first-run flow, real tutorial match, command-center navigation, and a preserved entry into the existing friend-room experience.

**Architecture:** Keep Electron's main process as the authority for local files and matches. A strict profile contract and atomic repository feed a small application service; a narrow IPC registrar and preload facade expose player operations to a modular renderer shell. The tutorial runs the existing Gameplay v2 practice path and projects its verified bundle into the existing public tactical replay contract.

**Tech Stack:** TypeScript 5.5 strict mode, Electron 44, Node.js 22 filesystem APIs, esbuild, Vitest 4, existing Gameplay v2 / SavedBuild v2 / Replay v2 modules, vanilla HTML/CSS DOM renderer.

**Spec:** `docs/superpowers/specs/2026-08-31-public-beta-design.md`

## Global Constraints

- Keep `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true`.
- Persist ordinary player data below Electron `app.getPath('userData')`; never write an API key.
- Persisted contracts use exact version checks, reject unknown keys, and use atomic temporary-file replacement.
- Corrupted profile data is quarantined, not silently overwritten or deleted.
- Default player UI does not expose JSON, seed, tick, hash, WebRTC, Offer, Answer, STUN, TURN, DataChannel, or stack traces.
- Existing friend-room behavior remains reachable and regression-tested.
- Every production behavior starts with a focused failing test and an observed RED result.

---

### Task 1: Strict player-profile contract

**Files:**
- Create: `src/desktop/player-profile-v1.ts`
- Test: `tests/player-profile-v1.test.ts`

**Interfaces:**
- Produces: `PlayerDoctrineV1`, `TutorialStageV1`, `DesktopPageIdV1`, `PlayerProfileV1`, `createPlayerProfileV1(input)`, `assertPlayerProfileV1(input)`.
- Consumes: Node `crypto.randomUUID` only through the caller-provided `playerId`; the contract itself has no filesystem dependency.

- [x] **Step 1: Write the failing contract tests**

```ts
import { describe, expect, it } from 'vitest';
import { assertPlayerProfileV1, createPlayerProfileV1 } from '../src/desktop/player-profile-v1.js';

describe('PlayerProfileV1', () => {
  it('creates a strict first-run profile with a recoverable tutorial stage', () => {
    expect(createPlayerProfileV1({
      playerId: '11111111-1111-4111-8111-111111111111',
      displayName: '乐淳',
      doctrine: 'scout',
      now: '2026-08-31T10:00:00.000Z',
    })).toMatchObject({ version: 1, displayName: '乐淳', doctrine: 'scout', tutorialStage: 'battle' });
  });

  it('rejects unknown fields, invalid names, timestamps, pages and tutorial stages', () => {
    expect(() => assertPlayerProfileV1({ version: 1, unexpected: true })).toThrow('Invalid PlayerProfileV1');
  });
});
```

- [x] **Step 2: Run the focused test and verify RED**

Run: `npm test -- tests/player-profile-v1.test.ts`

Expected: FAIL because `src/desktop/player-profile-v1.ts` does not exist.

- [x] **Step 3: Implement the strict contract**

Implement exact persisted fields:

```ts
export interface PlayerProfileV1 {
  version: 1;
  playerId: string;
  displayName: string;
  doctrine: 'scout' | 'medium' | 'heavy';
  tutorialStage: 'battle' | 'replay' | 'complete';
  recentPage: 'command-center' | 'garage' | 'practice' | 'friend-room' | 'replays' | 'agent-center' | 'settings';
  createdAt: string;
  lastOpenedAt: string;
}
```

Validate a UUID, trimmed 1–24 character display name, exact enums, valid ISO instants, exact keys, and `lastOpenedAt >= createdAt`. `createPlayerProfileV1` starts at `tutorialStage: 'battle'` and `recentPage: 'command-center'`.

- [x] **Step 4: Run focused GREEN and typecheck**

Run: `npm test -- tests/player-profile-v1.test.ts && npm run typecheck`

Expected: focused tests PASS and TypeScript exits 0.

- [x] **Step 5: Commit the contract**

```bash
git add src/desktop/player-profile-v1.ts tests/player-profile-v1.test.ts
git commit -m "feat: define strict player profiles"
```

### Task 2: Atomic profile repository and corruption quarantine

**Files:**
- Create: `src/desktop/player-profile-repository-v1.ts`
- Test: `tests/player-profile-repository-v1.test.ts`

**Interfaces:**
- Consumes: `PlayerProfileV1`, `assertPlayerProfileV1`.
- Produces: `PlayerProfileRepositoryV1(root)`, `.load()`, `.save(profile)`, `.quarantineEntries()`.

- [x] **Step 1: Write failing real-filesystem tests**

Use `mkdtempSync(join(tmpdir(), 'agentic-game-profile-'))`. Assert that a missing profile returns `undefined`, `save` then `load` round-trips, the final JSON has no leftover `.tmp`, and invalid JSON is moved below `<root>/quarantine/` before `load` throws the player-safe error `玩家档案已损坏，已移入隔离区`.

- [x] **Step 2: Run and verify RED**

Run: `npm test -- tests/player-profile-repository-v1.test.ts`

Expected: FAIL because the repository module does not exist.

- [x] **Step 3: Implement atomic persistence**

Write to `<root>/profile/player-profile-v1.json.<uuid>.tmp`, open and `sync()` the file, close it, then rename over `player-profile-v1.json`. On parse or validation failure, create `<root>/quarantine`, rename the bad file to `player-profile-v1.<timestamp>.invalid.json`, and throw the player-safe error. Never create a replacement profile inside `load`.

- [x] **Step 4: Run focused GREEN and the contract suite**

Run: `npm test -- tests/player-profile-v1.test.ts tests/player-profile-repository-v1.test.ts`

Expected: both files PASS.

- [x] **Step 5: Commit the repository**

```bash
git add src/desktop/player-profile-repository-v1.ts tests/player-profile-repository-v1.test.ts
git commit -m "feat: persist player profiles atomically"
```

### Task 3: Real tutorial match service

**Files:**
- Create: `src/desktop/preset-builds-v1.ts`
- Create: `src/desktop/tutorial-match-service-v1.ts`
- Modify: `src/desktop/friend-room-runtime-v1.ts`
- Test: `tests/tutorial-match-service-v1.test.ts`
- Modify: `tests/desktop-friend-room-runtime-v1.test.ts`

**Interfaces:**
- Produces: `createPresetBuildV1(presetId, createdAt, displayName?)`, `runTutorialMatchV1({ doctrine, displayName, now? })`.
- Returns: `{ replay: FriendRoomReplayV1; winningTeamIds: string[]; lessons: { title: string; detail: string }[] }`.
- Consumes: existing `runPracticeMatchV2`, verified MatchBundle v2, `createFriendRoomReplayV1`.

- [x] **Step 1: Write the failing tutorial behavior test**

Test all three doctrines. Assert that each run returns a verified public replay with at least two frames, exactly two public participants, no source/hash/action/log material in serialized output, and 1–3 player-language lessons selected from movement, vision, armor, ammunition, hit, destruction, or objective moments.

- [x] **Step 2: Run and verify RED**

Run: `npm test -- tests/tutorial-match-service-v1.test.ts`

Expected: FAIL because the tutorial service does not exist.

- [x] **Step 3: Extract preset construction without changing friend-room behavior**

Move the existing private preset Build construction from `friend-room-runtime-v1.ts` into `preset-builds-v1.ts`. Keep preset IDs, loadouts, labels and Bot source byte-for-byte equivalent. Update the friend runtime to call the exported factory.

- [x] **Step 4: Run the friend-room regression before tutorial implementation**

Run: `npm test -- tests/desktop-friend-room-runtime-v1.test.ts`

Expected: existing friend-room runtime tests PASS after the behavior-preserving extraction.

- [x] **Step 5: Implement the tutorial service**

Create the chosen preset as team `current`; create a deterministic teaching opponent using an existing legal Bot artifact and a fixed Gameplay v2 map/mode configuration. Run the real practice service, verify the bundle, project it through `createFriendRoomReplayV1`, then derive at most three lessons from public moments. Do not return or persist either Bot source.

- [x] **Step 6: Run focused GREEN and privacy checks**

Run: `npm test -- tests/tutorial-match-service-v1.test.ts tests/desktop-friend-room-runtime-v1.test.ts`

Expected: both files PASS and serialized tutorial result contains no 64-character hash or `module.exports`.

- [x] **Step 7: Commit the tutorial service**

```bash
git add src/desktop/preset-builds-v1.ts src/desktop/tutorial-match-service-v1.ts src/desktop/friend-room-runtime-v1.ts tests/tutorial-match-service-v1.test.ts tests/desktop-friend-room-runtime-v1.test.ts
git commit -m "feat: run real onboarding battles"
```

### Task 4: Desktop application service and narrow IPC

**Files:**
- Create: `src/desktop/application-service-v1.ts`
- Create: `src/desktop/application-ipc-v1.ts`
- Create: `src/desktop/desktop-api-v1.ts`
- Modify: `src/desktop/main.ts`
- Modify: `src/desktop/preload.ts`
- Test: `tests/desktop-application-service-v1.test.ts`
- Modify: `tests/desktop-shell-v1.test.ts`

**Interfaces:**
- Produces: `DesktopBootstrapV1`, `DesktopApiV1`, `DesktopApplicationServiceV1`, `registerDesktopApplicationIpcV1(registrar, service)`.
- IPC channels: `app:bootstrap`, `profile:create`, `profile:advance-tutorial`, `navigation:remember`, `tutorial:run`.
- Consumes: `PlayerProfileRepositoryV1`, `runTutorialMatchV1`.

- [x] **Step 1: Write failing service tests**

Assert that bootstrap returns `{ needsOnboarding: true }` when no profile exists; creating a profile validates the name/doctrine and returns the persisted profile; advancing `battle -> replay -> complete` works while skipping backward or inventing a stage fails; remembering a page updates only `recentPage` and `lastOpenedAt`; tutorial run returns a public replay without modifying the stage until the renderer explicitly advances it.

- [x] **Step 2: Run service test and verify RED**

Run: `npm test -- tests/desktop-application-service-v1.test.ts`

Expected: FAIL because the application service is missing.

- [x] **Step 3: Implement the application service**

Inject the repository, clock, UUID factory and tutorial runner. Keep every mutation explicit; do not expose a generic profile patch. Return structured clones at the service boundary.

- [x] **Step 4: Add failing IPC registration assertions**

Use an in-memory registrar recording channel names and handlers. Assert exactly the five allowed channels, input size/type validation, and that thrown internal errors map to player-safe messages.

- [x] **Step 5: Implement versioned API types and IPC registrar**

Define `DesktopApiV1` in a renderer-safe module containing only data contracts. Register handlers in `main.ts` with the real `ipcMain`; initialize the service directly with `app.getPath('userData')` after `app.whenReady()` because Electron already returns an application-specific directory.

- [x] **Step 6: Extend preload and the isolation regression**

Expose `window.agenticGameDesktop.app.bootstrap`, `.profile.create`, `.profile.advanceTutorial`, `.navigation.remember`, and `.tutorial.run`. Update `desktop-shell-v1.test.ts` to assert those exact operations exist while `nodeIntegration`, sandbox and isolation remain unchanged.

- [x] **Step 7: Run focused GREEN and typecheck**

Run: `npm test -- tests/desktop-application-service-v1.test.ts tests/desktop-shell-v1.test.ts && npm run typecheck`

Expected: tests PASS and TypeScript exits 0.

- [x] **Step 8: Commit the desktop boundary**

```bash
git add src/desktop/application-service-v1.ts src/desktop/application-ipc-v1.ts src/desktop/desktop-api-v1.ts src/desktop/main.ts src/desktop/preload.ts tests/desktop-application-service-v1.test.ts tests/desktop-shell-v1.test.ts
git commit -m "feat: add desktop application services"
```

### Task 5: Modular app shell and recoverable onboarding controller

**Files:**
- Create: `src/desktop/renderer/app-shell-controller-v1.ts`
- Create: `src/desktop/renderer/onboarding-controller-v1.ts`
- Create: `src/desktop/renderer/desktop-api-client-v1.ts`
- Test: `tests/desktop-app-shell-v1.test.ts`

**Interfaces:**
- Produces: `DesktopAppShellControllerV1`, `OnboardingControllerV1`, `desktopApiClientV1(window)`.
- Consumes: `DesktopBootstrapV1`, `PlayerProfileV1`, `FriendRoomReplayV1`, `DesktopApiV1`.

- [x] **Step 1: Write failing controller tests**

Test these real transitions:

```text
no profile -> commander form -> doctrine selection -> create profile at battle
battle -> running -> replay -> complete -> command center
restart at battle -> resumes battle
restart at replay -> resumes replay without recreating profile
completed profile -> opens remembered page when valid
disabled future page -> falls back to command center
```

Also assert navigation never uses a technical page ID and errors leave the current stable state intact.

- [x] **Step 2: Run and verify RED**

Run: `npm test -- tests/desktop-app-shell-v1.test.ts`

Expected: FAIL because the controllers do not exist.

- [x] **Step 3: Implement pure controllers**

Controllers hold view state and call the injected `DesktopApiV1`; they do not touch `document`. Tutorial run exposes cancellable `running` state, public replay, lessons, retry and safe error text. Page IDs come only from the profile contract.

- [x] **Step 4: Run focused GREEN**

Run: `npm test -- tests/desktop-app-shell-v1.test.ts`

Expected: all shell/controller transitions PASS.

- [x] **Step 5: Commit the renderer controllers**

```bash
git add src/desktop/renderer/app-shell-controller-v1.ts src/desktop/renderer/onboarding-controller-v1.ts src/desktop/renderer/desktop-api-client-v1.ts tests/desktop-app-shell-v1.test.ts
git commit -m "feat: control onboarding and game navigation"
```

### Task 6: Player-facing shell, tutorial and command center UI

**Files:**
- Modify: `src/desktop/renderer/index.html`
- Modify: `src/desktop/renderer/styles.css`
- Modify: `src/desktop/renderer.ts`
- Create: `src/desktop/renderer/app-shell-view-v1.ts`
- Create: `src/desktop/renderer/onboarding-view-v1.ts`
- Modify: `tests/desktop-shell-v1.test.ts`

**Interfaces:**
- Consumes: shell/onboarding controllers, existing friend-room renderer behavior, existing tactical replay controller.
- Produces: a visible app shell with `command-center` and `friend-room` pages plus first-run overlay and tutorial replay.

- [x] **Step 1: Add failing player-copy and structure assertions**

Assert HTML contains `指挥中心`, `开始教学战斗`, `选择你的作战风格`, `继续好友房间`, `快速练习`, and a navigation entry for `好友房间`. Assert the default shell copy does not contain the banned networking and persistence jargon from Global Constraints.

- [x] **Step 2: Run and verify RED**

Run: `npm test -- tests/desktop-shell-v1.test.ts`

Expected: FAIL because the shell/onboarding markup does not exist.

- [x] **Step 3: Add the semantic shell and onboarding markup**

Wrap the current friend-room experience as the `friend-room` page without changing its existing element IDs. Add a command-center page, side navigation, player header, onboarding dialog, doctrine cards, tutorial battle progress, tutorial replay container, lesson cards and retry/continue controls. Future pages appear as disabled navigation entries labeled `开发中`, not dead clickable controls.

- [x] **Step 4: Implement modular DOM views**

`app-shell-view-v1.ts` owns navigation visibility and player header. `onboarding-view-v1.ts` maps controller state to commander, doctrine, running, replay and completion panels. `renderer.ts` composes the new modules before initializing the preserved friend-room handlers.

- [x] **Step 5: Style for 1440×900 and 1100×700**

Use the existing warm-black tactical visual language. Provide visible keyboard focus, reduced-motion handling, no horizontal overflow, responsive one-column onboarding below 1180px, and `[hidden]` behavior. Do not introduce a console/table dashboard appearance.

- [x] **Step 6: Run focused tests, full typecheck and desktop build**

Run: `npm test -- tests/desktop-shell-v1.test.ts tests/desktop-app-shell-v1.test.ts && npm run typecheck && npm run build:desktop`

Expected: tests PASS, TypeScript exits 0, and `dist/desktop/renderer` is produced.

- [ ] **Step 7: Commit the player-facing shell**

```bash
git add src/desktop/renderer.ts src/desktop/renderer/index.html src/desktop/renderer/styles.css src/desktop/renderer/app-shell-view-v1.ts src/desktop/renderer/onboarding-view-v1.ts tests/desktop-shell-v1.test.ts
git commit -m "feat: add command center onboarding"
```

### Task 7: Slice 1 verification, visual acceptance and documentation

**Files:**
- Modify: `README.md`
- Modify: `HANDOFF.md`
- Modify: `docs/superpowers/plans/2026-08-31-desktop-foundation-onboarding.md`
- Create: `output/playwright/public-beta-onboarding.png` (ignored artifact)
- Create: `output/playwright/public-beta-command-center.png` (ignored artifact)

**Interfaces:**
- Consumes: the complete Slice 1 application.
- Produces: fresh verification evidence, Windows candidate package, documentation state and knowledge-base sync input.

- [ ] **Step 1: Run the full automated gate**

Run in order:

```powershell
npm test
npm run typecheck
npm audit --omit=dev
npm run build
npm run build:desktop
git diff --check
```

Expected: every command exits 0, all test files pass, and audit reports 0 vulnerabilities.

- [ ] **Step 2: Run real-browser visual acceptance**

Serve `dist/desktop/renderer`, open at 1440×900, and capture first-run doctrine selection, tutorial replay and completed command center. Verify keyboard focus, no horizontal overflow, no console errors/warnings, and the existing friend-room page still opens.

- [ ] **Step 3: Build and smoke the Windows candidate**

Run `npm run pack:desktop-folder`, create the versioned ZIP from the exact release directory, start `AgenticGame.exe` hidden, confirm `Responding=true`, then stop only that process. Record ZIP bytes and SHA-256.

- [ ] **Step 4: Update documentation honestly**

Document completed Slice 1 behavior, current test count, candidate hash and remaining Slice 2–6 boundaries. Do not call B complete; call this a verified Slice 1 candidate.

- [ ] **Step 5: Commit and push the verified slice**

```bash
git add README.md HANDOFF.md docs/superpowers/plans/2026-08-31-desktop-foundation-onboarding.md
git commit -m "docs: record desktop foundation slice"
git push origin main
```

- [ ] **Step 6: Sync Feishu and read back**

Update the existing UX implementation-state block in place and append one stable-key entry each to technical architecture, development log and quality report. Use the final commit short hash as the stable key. Re-read all four pages and verify exactly one matching heading per append-only page.
