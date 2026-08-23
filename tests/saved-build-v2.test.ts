import { describe, expect, it } from 'vitest';
import {
  assertSavedBuildV2,
  createSavedBuildV2,
  verifySavedBuildV2,
  type SavedBuildDraftV2,
} from '../src/config/saved-build-v2.js';
import { fullCodeHash } from '../src/runner/v2-adapter.js';

const source = `module.exports = () => ({ name: 'Revision', onTick() { return {}; } });`;

function draft(): SavedBuildDraftV2 {
  return {
    buildId: 'lechun-scout',
    label: 'Lechun Scout',
    bot: {
      artifactId: 'lechun-scout-bot',
      version: '1.0.0',
      language: 'javascript',
      entryPoint: 'lechun-scout.js',
      source,
    },
    loadout: { vehicleId: 'scout', weaponId: 'light-cannon', equipmentIds: [] },
  };
}

describe('SavedBuildV2', () => {
  it('creates a self-contained first revision with full source and stable fingerprints', () => {
    const record = createSavedBuildV2(draft(), {
      revision: 1,
      parentFingerprint: null,
      createdAt: '2026-08-24T00:00:00.000Z',
    });

    expect(record).toMatchObject({
      format: 'agentic-game-saved-build',
      schemaVersion: 2,
      buildId: 'lechun-scout',
      revision: 1,
      parentFingerprint: null,
      botArtifact: { codeHash: fullCodeHash(source), source },
      loadout: { vehicleId: 'scout', weaponId: 'light-cannon', equipmentIds: [] },
    });
    expect(record.contentFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(record.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(verifySavedBuildV2(record)).toEqual({ ok: true, issues: [] });
    expect(assertSavedBuildV2(structuredClone(record))).toEqual(record);
  });

  it('detects embedded source and loadout tampering', () => {
    const record = createSavedBuildV2(draft(), {
      revision: 1, parentFingerprint: null, createdAt: '2026-08-24T00:00:00.000Z',
    });
    const sourceTampered = structuredClone(record);
    sourceTampered.botArtifact.source += '\n// changed';
    const loadoutTampered = structuredClone(record);
    loadoutTampered.loadout.vehicleId = 'heavy';

    expect(verifySavedBuildV2(sourceTampered)).toMatchObject({ ok: false });
    expect(verifySavedBuildV2(sourceTampered).issues.map((issue) => issue.code))
      .toEqual(expect.arrayContaining(['source_hash_mismatch', 'content_fingerprint_mismatch', 'record_fingerprint_mismatch']));
    expect(verifySavedBuildV2(loadoutTampered).issues.map((issue) => issue.code))
      .toEqual(expect.arrayContaining(['content_fingerprint_mismatch', 'record_fingerprint_mismatch']));
  });

  it('rejects unknown fields and invalid identity, version, equipment, or timestamp values', () => {
    const invalid = {
      ...createSavedBuildV2(draft(), {
        revision: 1, parentFingerprint: null, createdAt: '2026-08-24T00:00:00.000Z',
      }),
      unexpected: true,
      buildId: '../escape',
      createdAt: 'not-a-date',
      botArtifact: {
        ...createSavedBuildV2(draft(), {
          revision: 1, parentFingerprint: null, createdAt: '2026-08-24T00:00:00.000Z',
        }).botArtifact,
        version: 'latest',
      },
      loadout: { vehicleId: 'scout', weaponId: 'light-cannon', equipmentIds: ['scope', 'scope'] },
    };

    const result = verifySavedBuildV2(invalid);
    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'unknown_key', 'invalid_id', 'invalid_timestamp', 'invalid_version', 'duplicate_id',
    ]));
  });

  it('requires revision one to have no parent and later revisions to have a full parent fingerprint', () => {
    expect(() => createSavedBuildV2(draft(), {
      revision: 1, parentFingerprint: 'a'.repeat(64), createdAt: '2026-08-24T00:00:00.000Z',
    })).toThrow('revision_parent_mismatch');
    expect(() => createSavedBuildV2(draft(), {
      revision: 2, parentFingerprint: null, createdAt: '2026-08-24T00:00:00.000Z',
    })).toThrow('revision_parent_mismatch');
  });

  it('returns a validation issue instead of throwing on non-JSON-domain nested values', () => {
    const malformed = createSavedBuildV2(draft(), {
      revision: 1, parentFingerprint: null, createdAt: '2026-08-24T00:00:00.000Z',
    });
    malformed.loadout.equipmentIds = new Array<string>(1);

    expect(() => verifySavedBuildV2(malformed)).not.toThrow();
    expect(verifySavedBuildV2(malformed).issues.map((issue) => issue.code))
      .toContain('invalid_json_domain');
  });
});
