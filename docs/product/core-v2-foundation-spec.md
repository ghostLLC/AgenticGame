# Core v2 Foundation Specification

**Status:** Approved for implementation  
**Date:** 2026-08-24  
**Owner:** AgenticGame

## 1. Goal

Establish the versioned, deterministic contracts that later gameplay, replay, practice-match, and Agent integrations can share without extending the current engine's hard-coded `0 | 1` assumptions.

This phase delivers runtime-validated `MatchConfigV2` values, reusable content-definition types, deterministic JSON hashing, and a self-contained `MatchBundleV2` contract. The existing v1 engine, runner, bots, CLI, UI, and replay format must continue to work unchanged.

## 2. Non-goals

- Do not migrate the v1 battle engine to multiple entities in this phase.
- Do not implement vision, terrain simulation, directional damage, ammunition consumption, capture mode, or new vehicles yet.
- Do not change the v1 bot API or v1 replay viewer.
- Do not add model-provider SDKs, API-key storage, or an Agent harness yet.
- Do not redesign or implement UI in code; UI work remains gated by Ardot.

## 3. Global invariants

- All v2 persisted contracts use `schemaVersion: 2` or `version: 2` exactly.
- Simulation-facing numeric values are finite integers. Seeds are unsigned 32-bit integers.
- Stable IDs use lowercase ASCII slugs matching `^[a-z0-9]+(?:[-_.][a-z0-9]+)*$` and are at most 64 characters.
- Ruleset and artifact versions use semantic versions matching `MAJOR.MINOR.PATCH` with an optional prerelease suffix.
- SHA-256 values are lowercase 64-character hexadecimal strings.
- Object key order never changes a fingerprint; array order remains significant.
- Validation is strict: unknown keys are rejected rather than silently ignored.
- v1 exports and behavior remain source-compatible.

## 4. Content definitions

`src/core/v2/content.ts` defines data-only contracts. It must not import the v1 engine.

- `VehicleDefinitionV2`: ID, display name, role, HP, front/side/rear armor, mobility limits, vision range, and compatible weapon/equipment IDs.
- `WeaponDefinitionV2`: ID, display name, damage, penetration, range, reload ticks, projectile speed, and ammunition capacity.
- `TerrainDefinitionV2`: ID, display name, movement cost in permille, visibility modifier in permille, and movement/vision/projectile blocking flags.
- `GameModeDefinitionV2`: ID, display name, minimum/maximum teams, and a data-only victory descriptor.
- `ContentSnapshotV2`: complete arrays of the definitions used by a match.
- `MapSnapshotV2`: immutable map ID/version, dimensions, terrain cells, and spawn points.
- `BotArtifactSnapshotV2`: artifact ID/version, SHA-256 source hash, language, entry point, and embedded source.

The definitions deliberately model future rules but are not consumed by the v1 engine in this phase.

## 5. MatchConfigV2

```ts
interface MatchConfigV2 {
  schemaVersion: 2;
  matchId: string;
  ruleset: { id: string; version: string };
  modeId: string;
  mapId: string;
  seed: number;
  maxTicks: number;
  teams: Array<{
    teamId: string;
    displayName: string;
    bot: { artifactId: string; version: string; codeHash: string };
    loadout: {
      vehicleId: string;
      weaponIds: string[];
      equipmentIds: string[];
    };
  }>;
}
```

Runtime validation requirements:

- The root and every nested object reject unknown keys.
- `matchId`, ruleset/mode/map/team/content IDs follow the stable-ID rule.
- `seed` is an integer from `0` through `4294967295`.
- `maxTicks` is a positive integer.
- There are at least two teams and no duplicate `teamId` values.
- `displayName` is already trimmed and contains 1–80 characters.
- Each loadout contains at least one weapon; weapon and equipment IDs are unique within the loadout.
- Artifact/ruleset versions are semantic versions and `codeHash` is a full SHA-256 value.

`validateMatchConfigV2(input)` returns either `{ ok: true, value }` or `{ ok: false, issues }`. Each issue has a stable `path`, `code`, and human-readable `message`. `assertMatchConfigV2(input)` returns the typed value or throws `MatchConfigValidationError` containing the issues.

`fingerprintMatchConfigV2(config)` returns the SHA-256 hash of the canonical JSON representation of the validated configuration.

## 6. MatchBundleV2

`MatchBundleV2` is the persisted Replay v2 / complete match bundle. It contains:

- Engine version and creation timestamp.
- The complete validated `MatchConfigV2`.
- Immutable map and content snapshots.
- Embedded Bot artifact snapshots.
- Per-tick submitted actions, emitted events, state checkpoints, and captured logs.
- Machine-readable result with winning team IDs, reason, and tick count.
- Integrity hashes for configuration, map, content, timeline, and the full bundle.

Actions and events use JSON payloads so future gameplay actions do not require changing the envelope format. Every timeline collection must be in non-decreasing tick order. Action actor IDs must be non-empty stable IDs. Checkpoint state hashes must match their canonical state snapshots.

`createMatchBundleV2(input)` validates the match config and timeline invariants, computes checkpoint hashes, and returns a bundle with all integrity fields populated. `verifyMatchBundleV2(bundle)` recomputes every integrity field and returns all mismatches without mutating the bundle.

The full-bundle hash covers every persisted field except `integrity.bundleHash` itself. Therefore any timestamp, snapshot, artifact, result, log, event, action, or checkpoint change is detectable.

## 7. Compatibility and rollout

- No v1 file is imported by v2 contracts except shared TypeScript/Node standard-library facilities.
- No v1 public type is widened in this phase.
- The v1 runner continues producing Replay v1.
- The next phase may add an adapter that converts a v1 match into a constrained v2 bundle; that adapter is not part of this phase.

## 8. Acceptance criteria

- Canonical JSON fingerprints are invariant to object key insertion order and sensitive to array order.
- Invalid JSON-domain values such as `undefined`, sparse arrays, and non-finite numbers are rejected.
- Match config validation catches unknown fields, malformed IDs/versions/hashes, numeric bounds, duplicate teams, and duplicate loadout IDs.
- A valid config produces a stable full-length SHA-256 fingerprint.
- A created bundle passes verification without changes.
- Changing any protected bundle content produces at least one verification issue.
- Timeline ordering and invalid checkpoint hashes cannot silently pass.
- Existing 20 v1 tests remain green; new tests, TypeScript typecheck, and production build pass.

