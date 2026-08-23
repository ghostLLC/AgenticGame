# Core v2 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deterministic, runtime-validated MatchConfigV2 and self-contained MatchBundleV2 contracts without changing v1 behavior.

**Architecture:** Keep v2 as a parallel contract layer under `src/core/v2` and `src/replay/v2.ts`. A small canonical-JSON module owns deterministic serialization and SHA-256 hashing; strict config validation owns persisted match inputs; the replay module composes content snapshots and timelines and verifies integrity without calling the v1 engine.

**Tech Stack:** TypeScript 5.5+, Node.js 20+ `node:crypto`, Vitest 2.1.

**Spec:** `docs/product/core-v2-foundation-spec.md`

## Global Constraints

- Existing v1 engine, runner, bot API, CLI, UI, and Replay v1 behavior remain unchanged.
- All v2 persisted contracts use schema/version 2 exactly.
- Stable IDs match `^[a-z0-9]+(?:[-_.][a-z0-9]+)*$` and are at most 64 characters.
- Numeric simulation values are finite integers; seeds are unsigned 32-bit integers.
- SHA-256 values are lowercase 64-character hexadecimal strings.
- Unknown persisted keys are rejected.
- No new runtime dependencies are added.
- Every production behavior follows a witnessed RED → GREEN cycle.

---

### Task 1: Deterministic JSON and content contracts

**Files:**
- Create: `src/core/v2/json.ts`
- Create: `src/core/v2/content.ts`
- Create: `tests/core-v2-json.test.ts`

**Interfaces:**
- Produces: `JsonPrimitive`, `JsonValue`, `JsonObject`, `canonicalJson(value)`, and `hashJson(value)`.
- Produces: `VehicleDefinitionV2`, `WeaponDefinitionV2`, `TerrainDefinitionV2`, `GameModeDefinitionV2`, `ContentSnapshotV2`, `MapSnapshotV2`, and `BotArtifactSnapshotV2`.

- [x] **Step 1: Write the failing canonical JSON tests**

```ts
import { describe, expect, it } from 'vitest';
import { canonicalJson, hashJson } from '../src/core/v2/json.js';

describe('canonicalJson', () => {
  it('gives objects with different key insertion order the same representation', () => {
    expect(canonicalJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    expect(hashJson({ b: 2, a: 1 })).toBe(hashJson({ a: 1, b: 2 }));
  });

  it('keeps array order significant', () => {
    expect(hashJson(['a', 'b'])).not.toBe(hashJson(['b', 'a']));
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, undefined])(
    'rejects a non-JSON value: %s',
    (value) => expect(() => canonicalJson(value as never)).toThrow(),
  );

  it('rejects sparse arrays instead of converting holes to null', () => {
    const sparse = Array(2) as never;
    expect(() => canonicalJson(sparse)).toThrow('sparse');
  });
});
```

- [x] **Step 2: Run the focused test and verify RED**

Run: `npm test -- tests/core-v2-json.test.ts`  
Expected: FAIL because `src/core/v2/json.ts` does not exist.

- [x] **Step 3: Implement minimal canonical JSON and hash functions**

```ts
import { createHash } from 'node:crypto';

export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject { [key: string]: JsonValue }

export function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('JSON numbers must be finite');
    return JSON.stringify(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      if (!(i in value)) throw new TypeError('canonicalJson rejects sparse arrays');
    }
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  if (typeof value !== 'object') throw new TypeError(`Unsupported JSON value: ${typeof value}`);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key]!)}`).join(',')}}`;
}

export function hashJson(value: JsonValue): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}
```

- [x] **Step 4: Add the data-only content types from the spec**

Implement `content.ts` with integer-valued armor, mobility, weapon, terrain, map, spawn, content-snapshot, and embedded Bot artifact interfaces. Import `JsonObject` only where a mode victory descriptor needs generic persisted data.

- [x] **Step 5: Run focused and full verification**

Run: `npm test -- tests/core-v2-json.test.ts && npm run typecheck`  
Expected: JSON tests PASS and TypeScript exits 0.

- [x] **Step 6: Commit**

```bash
git add src/core/v2/json.ts src/core/v2/content.ts tests/core-v2-json.test.ts
git commit -m "feat: add deterministic v2 content contracts"
```

### Task 2: Strict MatchConfigV2 validation and fingerprinting

**Files:**
- Create: `src/core/v2/match-config.ts`
- Create: `tests/core-v2-config.test.ts`

**Interfaces:**
- Consumes: `JsonObject`, `hashJson`.
- Produces: `MatchConfigV2`, `MatchTeamConfigV2`, `ValidationIssue`, `MatchConfigValidationError`, `validateMatchConfigV2(input)`, `assertMatchConfigV2(input)`, and `fingerprintMatchConfigV2(config)`.

- [x] **Step 1: Write valid-config and fingerprint tests**

Create a literal two-team fixture. Assert that validation succeeds, the fingerprint matches `/^[0-9a-f]{64}$/`, object key insertion order does not change the fingerprint, and reversing `teams` does change it.

- [x] **Step 2: Run the focused test and verify RED**

Run: `npm test -- tests/core-v2-config.test.ts`  
Expected: FAIL because `match-config.ts` does not exist.

- [x] **Step 3: Implement types, strict object-key checks, and successful validation**

Implement path-aware helpers for records, arrays, strings, stable IDs, semantic versions, hashes, and integers. Return the original typed value only when no issues exist.

- [x] **Step 4: Run the focused test and verify GREEN**

Run: `npm test -- tests/core-v2-config.test.ts`  
Expected: the valid-config tests PASS.

- [x] **Step 5: Add failing table-driven invalid-config tests**

Use literal mutations and assert issue codes and paths for: unknown root key, schema version other than 2, malformed ID, non-semver ruleset version, seed above `4294967295`, zero `maxTicks`, fewer than two teams, duplicate team IDs, untrimmed display name, malformed code hash, empty weapons, duplicate weapons, and duplicate equipment.

- [x] **Step 6: Run the invalid tests and verify RED**

Run: `npm test -- tests/core-v2-config.test.ts`  
Expected: FAIL on the first validation behavior not yet enforced.

- [x] **Step 7: Implement all specified validation branches and assertion error**

`MatchConfigValidationError` stores `readonly issues: readonly ValidationIssue[]`; `assertMatchConfigV2` throws it on failure. `fingerprintMatchConfigV2` calls `assertMatchConfigV2` before hashing.

- [x] **Step 8: Run focused, full test, and type verification**

Run: `npm test -- tests/core-v2-config.test.ts && npm test && npm run typecheck`  
Expected: all tests PASS and TypeScript exits 0.

- [x] **Step 9: Commit**

```bash
git add src/core/v2/match-config.ts tests/core-v2-config.test.ts
git commit -m "feat: validate versioned match configs"
```

### Task 3: MatchBundleV2 creation and integrity verification

**Files:**
- Create: `src/replay/v2.ts`
- Create: `tests/replay-v2.test.ts`

**Interfaces:**
- Consumes: `JsonObject`, `hashJson`, content snapshot types, Bot artifact types, `MatchConfigV2`, `assertMatchConfigV2`, and `fingerprintMatchConfigV2`.
- Produces: `ActionRecordV2`, `EventRecordV2`, `StateCheckpointV2`, `LogRecordV2`, `MatchResultV2`, `MatchBundleV2`, `createMatchBundleV2(input)`, and `verifyMatchBundleV2(bundle)`.

- [x] **Step 1: Write a failing creation test with literal snapshots**

Build a minimal valid config, one vehicle/weapon/terrain/mode, a 2×1 map, two embedded Bot artifacts, ordered actions/events/checkpoints/logs, and a result. Assert that the returned bundle has version 2, preserves all snapshots, stores a correct checkpoint state hash, emits five 64-character integrity hashes, and passes `verifyMatchBundleV2` with no issues.

- [x] **Step 2: Run the focused test and verify RED**

Run: `npm test -- tests/replay-v2.test.ts`  
Expected: FAIL because `src/replay/v2.ts` does not exist.

- [x] **Step 3: Implement bundle creation and integrity hashing**

Use canonical JSON hashes for config, map, content, timeline, and bundle. Compute `bundleHash` from a copy containing the first four hashes but omitting `bundleHash`. Do not mutate caller inputs.

- [x] **Step 4: Run the focused test and verify GREEN**

Run: `npm test -- tests/replay-v2.test.ts`  
Expected: creation test PASS.

- [x] **Step 5: Add failing tamper and ordering tests**

Assert that changing an action after creation yields `timeline_hash_mismatch` and `bundle_hash_mismatch`; changing the map yields `map_hash_mismatch`; a decreasing action/event/checkpoint/log tick throws during creation; a checkpoint whose supplied hash does not match its state throws; and an artifact whose source hash does not match its embedded source throws.

- [x] **Step 6: Run the focused test and verify RED**

Run: `npm test -- tests/replay-v2.test.ts`  
Expected: FAIL on missing tamper/order validation.

- [x] **Step 7: Implement verification issue collection and input invariant checks**

Return all integrity mismatches as `{ code, path, message }` without mutating the bundle. Validate timestamp parseability, non-negative integer ticks, monotonic ordering, stable actor/source IDs, artifact source hashes, and checkpoint state hashes.

- [x] **Step 8: Run focused, full test, typecheck, and build**

Run: `npm test -- tests/replay-v2.test.ts && npm test && npm run typecheck && npm run build`  
Expected: all tests PASS and both TypeScript commands exit 0.

- [x] **Step 9: Commit**

```bash
git add src/replay/v2.ts tests/replay-v2.test.ts
git commit -m "feat: add replay v2 match bundles"
```

### Task 4: Governance documentation and final verification

**Files:**
- Create: `docs/product/product-governance.md`
- Modify: `README.md`
- Modify: `HANDOFF.md`
- Modify: `docs/superpowers/plans/2026-08-24-core-v2-foundation.md`

**Interfaces:**
- Consumes: the completed v2 modules and their verification commands.
- Produces: durable Git/Feishu/Ardot ownership rules and a handoff that distinguishes implemented foundation work from future engine integration.

- [x] **Step 1: Document source-of-truth ownership and UI gate**

State that Git owns executable truth, Feishu owns decisions/status/quality, Ardot owns user-facing design, and user-facing code changes require an approved Ardot source page.

- [x] **Step 2: Update README and HANDOFF with v2 scope and non-goals**

List the new files and commands. Explicitly state that the v1 runner still emits Replay v1 and gameplay mechanics are not migrated yet.

- [x] **Step 3: Mark plan checkboxes from actual evidence**

Only check steps whose commands were run and whose expected outcome was observed.

- [x] **Step 4: Run fresh final verification**

Run: `npm test && npm run typecheck && npm run build && git diff --check`  
Expected: all tests PASS, typecheck/build exit 0, and `git diff --check` prints nothing.

- [x] **Step 5: Review repository state and commit**

```bash
git status --short
git diff --stat HEAD
git add README.md HANDOFF.md docs/product docs/superpowers/plans/2026-08-24-core-v2-foundation.md
git commit -m "docs: record core v2 foundation"
```

- [x] **Step 6: Synchronize external project records**

Append a dated item to Feishu `00｜开发时间线`, add the architectural contract to `05｜技术架构与开发环境`, add RED/GREEN and final verification evidence to `07｜测试、平衡与质量`, and update `09｜风险、技术债与待办`. Re-read each modified document and verify the new heading exists exactly once.
