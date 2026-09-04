import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  generateReleaseIntegrityFiles,
} from '../scripts/generate-release-integrity.mjs';

describe('release integrity manifest v1', () => {
  it('为发布产物生成稳定排序的 JSON 清单与标准 SHA-256 文件', () => {
    const releaseDir = mkdtempSync(join(tmpdir(), 'agenticgame-release-integrity-'));
    writeFileSync(join(releaseDir, 'setup.exe'), Buffer.from('installer'));
    writeFileSync(join(releaseDir, 'portable.zip'), Buffer.from('portable'));

    const artifacts = [
      { file: 'setup.exe', purpose: 'installer' },
      { file: 'portable.zip', purpose: 'portable' },
    ];

    const result = generateReleaseIntegrityFiles({
      releaseDir,
      version: '0.1.0',
      channel: 'public-beta-b',
      artifacts,
    });

    expect(result.manifest.artifacts.map((artifact) => artifact.file)).toEqual([
      'portable.zip',
      'setup.exe',
    ]);
    expect(result.manifest.artifacts.every((artifact) => artifact.bytes > 0)).toBe(true);
    expect(result.manifest.artifacts.every((artifact) => /^[A-F0-9]{64}$/.test(artifact.sha256))).toBe(true);

    const manifestText = readFileSync(result.manifestPath, 'utf8');
    expect(manifestText).toBe(`${JSON.stringify(result.manifest, null, 2)}\n`);

    const checksumLines = readFileSync(result.checksumPath, 'utf8').trim().split('\n');
    expect(checksumLines).toHaveLength(2);
    expect(checksumLines[0]).toMatch(/^[A-F0-9]{64}  portable\.zip$/);
    expect(checksumLines[1]).toMatch(/^[A-F0-9]{64}  setup\.exe$/);
  });

  it('拒绝缺失、空文件和逃出发布目录的目标', () => {
    const releaseDir = mkdtempSync(join(tmpdir(), 'agenticgame-release-integrity-invalid-'));
    writeFileSync(join(releaseDir, 'empty.exe'), Buffer.alloc(0));

    expect(() => generateReleaseIntegrityFiles({
      releaseDir,
      version: '0.1.0',
      channel: 'public-beta-b',
      artifacts: [{ file: 'missing.exe', purpose: 'installer' }],
    })).toThrow(/不存在/);

    expect(() => generateReleaseIntegrityFiles({
      releaseDir,
      version: '0.1.0',
      channel: 'public-beta-b',
      artifacts: [{ file: 'empty.exe', purpose: 'installer' }],
    })).toThrow(/空文件/);

    expect(() => generateReleaseIntegrityFiles({
      releaseDir,
      version: '0.1.0',
      channel: 'public-beta-b',
      artifacts: [{ file: '../outside.exe', purpose: 'installer' }],
    })).toThrow(/发布目录/);
  });

  it('同一版本重复生成时原子替换旧清单且不遗留临时文件', () => {
    const releaseDir = mkdtempSync(join(tmpdir(), 'agenticgame-release-integrity-refresh-'));
    const artifactPath = join(releaseDir, 'portable.zip');
    const input = {
      releaseDir,
      version: '0.1.0',
      channel: 'public-beta-b',
      artifacts: [{ file: 'portable.zip', purpose: 'portable' }],
    };
    writeFileSync(artifactPath, Buffer.from('candidate-one'));
    const first = generateReleaseIntegrityFiles(input);

    writeFileSync(artifactPath, Buffer.from('candidate-two-is-newer'));
    const second = generateReleaseIntegrityFiles(input);

    expect(second.manifest.artifacts[0]?.sha256).not.toBe(first.manifest.artifacts[0]?.sha256);
    expect(JSON.parse(readFileSync(second.manifestPath, 'utf8'))).toEqual(second.manifest);
    expect(readdirSync(releaseDir).some((file) => file.endsWith('.tmp'))).toBe(false);
  });
});
