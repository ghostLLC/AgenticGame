# Replay v2 Runtime Integration Plan

**Goal:** Make every `runMatch` result include a self-contained, integrity-checked `MatchBundleV2` while preserving the existing Replay v1 output and UI compatibility.

**Architecture:** Add a v1-runtime adapter under `src/runner` that snapshots the legacy rules, map, Bot sources, applied actions, events, checkpoints, logs, and result into the existing v2 contracts. `runMatch` remains the single orchestration point and returns both `replay` (v1) and `bundle` (v2). No UI behavior or v1 replay schema changes in this slice.

**Constraints:**

- Existing Replay v1 output remains byte-structure compatible.
- Full SHA-256 Bot hashes are embedded in v2; v1 keeps its 16-character display fingerprint.
- The adapter must not invent nondeterministic gameplay data.
- A supplied `createdAt` may pin artifact timestamps for deterministic tests; production defaults to the current time.
- Every new production behavior follows a witnessed RED → GREEN cycle.

## Task 1: Specify the runner's v2 output

- [x] Add focused integration tests asserting `runMatch(...).bundle` exists, has version 2, embeds both Bot sources, records applied actions/events/checkpoints, and passes `verifyMatchBundleV2`.
- [x] Add a deterministic test using a fixed `createdAt` and identical bots/seed; the two bundles must be deeply equal.
- [x] Run `npm test -- tests/match.test.ts` and observe the expected RED failure because `MatchOutput` has no `bundle`.

## Task 2: Build the legacy-to-v2 adapter

- [x] Add `src/runner/v2-adapter.ts` with deterministic builders for `MatchConfigV2`, content snapshot, map snapshot, Bot artifacts, timeline records, and result.
- [x] Represent v1's complete information, uniform vehicle, unlimited practical ammunition, obstacles, duel victory rule, and two teams explicitly in the snapshot.
- [x] Use stable lowercase IDs and full source hashes so `createMatchBundleV2` validates without weakening existing contracts.
- [x] Run the focused test and observe GREEN.

## Task 3: Capture the real runtime timeline

- [x] Record the validated/applied action for each team on every processed tick, including idle fallbacks for invalid/timeout/error outcomes.
- [x] Convert every Replay v1 frame into v2 events, checkpoints, and log records without mutating v1 frames.
- [x] Make early Bot-load failures also produce a valid bundle.
- [x] Run focused tests, then the full test suite and typecheck.

## Task 4: Document, verify, and integrate

- [x] Update README and HANDOFF to state the runner now returns Replay v1 plus MatchBundleV2, while CLI/UI still persist/view Replay v1 in this slice.
- [x] Run `npm test`, `npm run typecheck`, `npm run build`, and `git diff --check` with fresh output.
- [ ] Commit the isolated branch, merge it into `main`, push `origin/main`, and synchronize Feishu timeline/architecture/quality/risk records with the final commit hash.
