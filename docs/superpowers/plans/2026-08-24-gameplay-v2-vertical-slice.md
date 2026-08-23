# Gameplay v2 Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and run a deterministic v2 tank duel where vehicle, weapon, terrain, vision, armor, ammunition, and mobility definitions materially change play.

**Architecture:** Keep v1 untouched and add a focused v2 content catalog, pure deterministic engine, and sandboxed runner. `GameplayEngineV2` owns compiled lookup tables plus serializable authoritative state; `runMatchV2` orchestrates two existing `BotRunner` workers and writes the real timeline directly into `MatchBundleV2`.

**Tech Stack:** TypeScript 5.5+, Node.js 20+, worker_threads/vm sandbox, Vitest 2.1, existing Core v2 and Replay v2 contracts.

**Spec:** `docs/product/gameplay-v2-vertical-slice-spec.md`

## Global Constraints

- Preserve all v1 exports and runtime behavior.
- The slice supports exactly two teams, one vehicle, and one weapon per team.
- Simulation values remain finite integers; no floating-point position state.
- Every random source comes from the existing seeded Bot context; the engine itself has no randomness.
- No UI code changes without an accepted Ardot design.
- Every behavior change follows witnessed RED → GREEN.

---

### Task 1: Official gameplay content and map

**Files:**
- Create: `src/core/v2/gameplay-content.ts`
- Create: `tests/gameplay-v2-content.test.ts`

**Interfaces:**
- Produces: `GAMEPLAY_CONTENT_V2`, `GAMEPLAY_MAP_FRONTIER_V2`, `getVehicleV2(id)`, `getWeaponV2(id)`, `getTerrainV2(id)`.

- [x] **Step 1: Write failing content tests**

Assert the three exact vehicle/weapon pairs, full 32×24 terrain coverage, symmetric spawns, and that every loadout reference resolves. The production break caught is a missing/incorrect official definition or incomplete map snapshot.

- [x] **Step 2: Run RED**

Run `npm test -- tests/gameplay-v2-content.test.ts`. Expected failure: module `gameplay-content.js` does not exist.

- [x] **Step 3: Implement the immutable catalog**

Create literal data matching the approved spec. Generate cells deterministically by painting symmetric forest/mud regions and the existing symmetric walls, then freeze exported snapshots deeply enough that callers cannot mutate official arrays or nested definitions.

- [x] **Step 4: Run GREEN and commit**

Run the focused test and commit `feat: add gameplay v2 content catalog`.

### Task 2: Deterministic gameplay engine

**Files:**
- Create: `src/core/v2/gameplay-engine.ts`
- Create: `tests/gameplay-v2-engine.test.ts`

**Interfaces:**
- Produces: `GameplayEngineV2`, `GameplayStateV2`, `BattleViewV2`, `GameplayEventV2`, `GameplaySnapshotV2`, `ImpactZoneV2`.
- Constructor: `new GameplayEngineV2(config, contentSnapshot, mapSnapshot)`.
- Methods: `step(actions)`, `viewFor(teamIndex)`, `forceFinish(winnerTeamIds, reason)`, `snapshot()`.

- [x] **Step 1: Write failing creation and mobility tests**

Use literal fixture configs and maps. Assert invalid references throw, scout moves sooner than heavy under identical throttle, mud delays an otherwise identical medium, and heavy turns only on its defined cadence. Expected RED: engine module missing.

- [x] **Step 2: Implement creation, lookup validation, turns, velocity, and terrain movement**

Initialize HP/ammo from loadouts and spawn order. Keep signed velocity and movement progress in permille. Apply the tick order and blocked-movement reset from the spec.

- [x] **Step 3: Run focused GREEN**

Run `npm test -- tests/gameplay-v2-engine.test.ts` and keep existing tests green.

- [x] **Step 4: Write failing vision tests**

Assert a scout sees an open target at distance 8, does not see the same target in forest, and cannot see through a wall. The production break caught is leaking hidden authoritative state or ignoring terrain visibility.

- [x] **Step 5: Implement deterministic line of sight and filtered views**

Use Chebyshev distance, target terrain modifier, and an integer supercover/Bresenham traversal that excludes observer and target cells from intermediate blockers. `viewFor` returns copied self plus only visible enemies/projectiles.

- [x] **Step 6: Write failing combat tests**

Drive real projectiles into the same heavy target from front, side, and rear fixtures; assert damage 1/10/24 for the light cannon. Assert reload, ammo depletion, `dry-fire`, projectile range expiry, and death/result behavior.

- [x] **Step 7: Implement projectiles, directional armor, ammo, reload, and results**

Persist projectile weapon/range data, classify impact from source direction, emit explanatory hit events, and compare HP at max ticks.

- [x] **Step 8: Run GREEN, refactor, and commit**

Run focused engine tests plus `tests/engine.test.ts`, then commit `feat: implement deterministic gameplay v2 engine`.

### Task 3: Sandboxed v2 match runner and bundle

**Files:**
- Modify: `src/runtime/sandbox.ts`
- Create: `src/runner/match-v2.ts`
- Create: `tests/match-v2.test.ts`

**Interfaces:**
- Produces: `runMatchV2(config): Promise<GameplayMatchOutputV2>` and `GameplayMatchConfigV2`.
- Consumes: `GameplayEngineV2`, existing `BotRunner`, `createMatchBundleV2`, and full source hashes.

- [ ] **Step 1: Write failing runner integration tests**

Run two real inline sandbox Bots against `frontier-v2`. Assert the exact content/loadouts are used, views never expose an invisible opponent, applied actions/events/checkpoints/logs exist, bundle verification succeeds, and fixed inputs produce deeply equal bundles. Expected RED: `runMatchV2` missing.

- [ ] **Step 2: Generalize sandbox init context type without changing runtime behavior**

Change `BotRunnerOptions.ctx` from the v1-specific omit type to a structured-clone-safe record so v1 and v2 contexts are accepted by the same worker.

- [ ] **Step 3: Implement the runner loop**

Validate that Bot source hashes match config artifacts, initialize both workers, provide filtered views, apply validation/timeout/error idle fallbacks, terminate repeated non-responsive workers, and collect the authoritative timeline.

- [ ] **Step 4: Build and verify MatchBundleV2**

Use the exact caller snapshots and artifacts; convert engine events to stable event records and `engine.snapshot()` to checkpoints. Verify result IDs and reason are machine-readable stable strings.

- [ ] **Step 5: Run GREEN and commit**

Run `npm test -- tests/match-v2.test.ts tests/match.test.ts`, then commit `feat: run sandboxed gameplay v2 matches`.

### Task 4: Documentation, verification, and rollout

**Files:**
- Modify: `README.md`
- Modify: `HANDOFF.md`
- Modify: `docs/tank-spec.md`
- Modify: this plan

**Interfaces:**
- Documents the v1/v2 compatibility boundary, v2 Bot view, exact mechanics, verification evidence, and next UI/config work.

- [ ] **Step 1: Update developer and Bot documentation**

Document all official stats, fog-of-war semantics, tick order, v2 action/view examples, and the fact that no UI entry exists until Ardot design is accepted.

- [ ] **Step 2: Run completion verification**

Run `npm test`, `npm run typecheck`, `npm run build`, and `git diff --check`; record exact counts in README/HANDOFF.

- [ ] **Step 3: Integrate and synchronize facts**

Commit the branch, merge to local `main`, verify the merged tree, push `origin/main`, then update Feishu pages `00`, `05`, `06`, `07`, and `09` with an idempotent date/title/commit key and read them back.
