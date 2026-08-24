# Build History and Practice Match Specification

**Status:** Approved for implementation  
**Date:** 2026-08-24  
**Owner:** AgenticGame

## 1. Goal

Let a player save an immutable version history of a reusable tank Build—Bot source plus vehicle loadout—and run any new revision against any previous revision through the real Gameplay v2 sandbox and MatchBundleV2 path.

## 2. SavedBuildV2 contract

Each JSON record contains:

- `format: "agentic-game-saved-build"` and `schemaVersion: 2`;
- stable lowercase `buildId`, positive integer `revision`, parseable `createdAt`, and trimmed 1–80 character `label`;
- `parentFingerprint`, which is `null` for revision 1 and the exact previous revision fingerprint thereafter;
- one complete Bot artifact: stable ID, semantic version, full SHA-256, language, entry point, and embedded source;
- one loadout: vehicle ID, weapon ID, and unique equipment IDs;
- `contentFingerprint` over label, Bot artifact, and loadout;
- `fingerprint` over every persisted field except itself.

Validation is strict and rejects unknown keys, malformed IDs/versions/hashes, invalid revision chains, source/hash mismatch, duplicate equipment IDs, or fingerprint mismatch.

## 3. Local repository

`SavedBuildRepositoryV2(root)` stores records at `<root>/<buildId>/<revision>.json`.

- `save(draft, createdAt?)` creates the next revision and links it to the current latest revision.
- Saving the same content as the latest revision returns that latest record with `created:false`; it does not create history noise.
- `list(buildId)` returns verified records in ascending revision order and verifies the complete parent chain.
- `load(buildId, revision | "latest")` returns a verified record or a clear not-found error.
- Writes use a sibling temporary file followed by atomic rename. Existing revision files are never overwritten and there is no delete operation in this phase.
- Stable-ID validation prevents path traversal. Corrupt or tampered JSON fails closed rather than being skipped.

## 4. Practice match

`runPracticeMatchV2` accepts two verified saved revisions, exact content/map snapshots, seed, max ticks, and optional fixed timestamp. It builds a strict two-team MatchConfigV2, preserves each revision's Bot artifact and loadout, and calls the real `runMatchV2` sandbox path.

The returned object names both participating revisions and contains the verified MatchBundleV2. The Bundle remains the authoritative match artifact; saved Builds remain reusable configuration artifacts.

## 5. Ardot design source

The player-facing flow is defined in the AgenticGame Ardot file
`cocraft://localhost/file/718070578872647`, page `01 Build 历史与练习赛` (`2:115`).

- Build history and version comparison: node `3:299`.
- New-versus-old practice setup: node `3:399`.
- Empty, corrupt-chain, running, and complete states: node `3:492`.

These nodes were rebuilt and checked with Ardot layout inspection and rendered screenshots on
2026-08-24 after the page was found to contain no canvas children. They are the implementation
baseline; this record supersedes the earlier unsupported statement that the empty page had already
been accepted.

## 6. Compatibility and UI boundary

- No existing v1/v2 engine, runner, CLI, server, or viewer behavior changes.
- Repository paths are caller supplied; a later application service will choose the player-data directory.
- Player-facing UI implementation must follow the Ardot nodes listed above. The design is now
  present and layout-verified; product acceptance remains a separate checkpoint.

## 7. Acceptance criteria

- Creating and verifying a record detects source or loadout tampering.
- Two successive different drafts become revisions 1 and 2 with a valid parent chain.
- Re-saving unchanged latest content is idempotent and creates no third file.
- Listing and loading fail closed on a corrupt/tampered revision.
- A revision-2-vs-revision-1 practice match embeds the exact two sources/loadouts, is deterministic under fixed inputs, and passes `verifyMatchBundleV2`.
- Existing 69 tests plus new contract/repository/practice tests, typecheck, build, and `git diff --check` pass.
