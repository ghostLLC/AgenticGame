# Build History and Practice Match Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist immutable Bot/loadout revisions locally and run any new revision against an older revision using Gameplay v2.

**Architecture:** A strict pure contract creates/verifies `SavedBuildV2`; a filesystem repository owns revision chains and atomic persistence; a practice service converts two records into MatchConfigV2 and delegates to `runMatchV2`. UI remains out of scope until Ardot acceptance.

**Tech Stack:** TypeScript, Node.js fs/path/crypto, existing deterministic JSON, MatchConfigV2, Gameplay v2 runner, Vitest.

**Spec:** `docs/product/build-history-practice-spec.md`

## Global Constraints

- Saved records are strict, self-contained, versioned, and full-SHA-256 protected.
- No overwrite or delete operation is introduced.
- Repository path segments come only from validated stable IDs and positive integer revisions.
- Practice matches use the real worker sandbox and MatchBundleV2 path.
- Existing v1/v2 behavior remains compatible; no UI code changes.

---

### Task 1: Saved build contract

**Files:**
- Create: `src/config/saved-build-v2.ts`
- Create: `tests/saved-build-v2.test.ts`

**Interfaces:**
- Produces: `SavedBuildDraftV2`, `SavedBuildV2`, `createSavedBuildV2`, `verifySavedBuildV2`, `assertSavedBuildV2`, `fingerprintSavedBuildContentV2`.

- [x] Write tests for exact creation, strict validation, source/loadout tamper detection, stable IDs, versions, timestamps, revisions, equipment uniqueness, and parent fingerprints.
- [x] Run focused RED and confirm the module is missing.
- [x] Implement canonical content and record fingerprints plus issue-based verification.
- [x] Run focused GREEN, typecheck, and commit `feat: define saved build v2 contract`.

### Task 2: Atomic local revision repository

**Files:**
- Create: `src/config/saved-build-repository-v2.ts`
- Create: `tests/saved-build-repository-v2.test.ts`

**Interfaces:**
- Produces: `SavedBuildRepositoryV2.save`, `.list`, and `.load`.

- [ ] Write real-temporary-directory tests for revision 1→2 parent linkage, unchanged-content idempotency, ascending list/latest load, no overwrite, and fail-closed corruption.
- [ ] Run focused RED and confirm the repository is missing.
- [ ] Implement stable path resolution, verified reads, chain validation, exclusive temporary writes, and atomic rename.
- [ ] Run focused GREEN and commit `feat: persist saved build revision history`.

### Task 3: New-versus-old practice service

**Files:**
- Create: `src/practice/run-practice-match-v2.ts`
- Create: `tests/practice-match-v2.test.ts`

**Interfaces:**
- Produces: `runPracticeMatchV2(input): Promise<PracticeMatchOutputV2>`.

- [ ] Write an integration RED that saves two revisions and runs revision 2 against revision 1 with two real sandbox Bots.
- [ ] Assert exact artifact/loadout mapping, participant metadata, deterministic equality, timeline presence, and Bundle verification.
- [ ] Implement strict MatchConfig assembly and delegation to `runMatchV2`.
- [ ] Run focused GREEN and commit `feat: run new builds against saved history`.

### Task 4: Documentation and rollout

**Files:**
- Modify: `README.md`
- Modify: `HANDOFF.md`
- Modify: `docs/tank-spec.md`
- Modify: this plan

- [ ] Document the saved Build/revision model, local storage boundary, practice API, UI limitation, and exact test count.
- [ ] Run `npm test`, `npm run typecheck`, `npm run build`, and `git diff --check` twice around review fixes.
- [ ] Merge to local main, verify merged result, push GitHub main, and synchronize Feishu timeline/architecture/ADR/quality/risk with write-after-read verification.
