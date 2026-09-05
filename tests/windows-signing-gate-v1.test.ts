import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));

describe('Windows 正式签名门禁 v1', () => {
  it('没有证书时拒绝启动正式签名构建且不回显环境内容', () => {
    const secretMarker = 'must-not-appear-in-output';
    const result = spawnSync(process.execPath, ['scripts/pack-desktop-signed.mjs'], {
      cwd: projectRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        CSC_LINK: '',
        CSC_KEY_PASSWORD: secretMarker,
      },
    });

    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain('CSC_LINK');
    expect(`${result.stdout}${result.stderr}`).not.toContain(secretMarker);
  });

  it('对未签名文件返回失败而不是把完整性哈希当作签名', { timeout: 15_000 }, () => {
    const folder = mkdtempSync(join(tmpdir(), 'agenticgame-unsigned-'));
    const unsignedFile = join(folder, 'unsigned.exe');
    writeFileSync(unsignedFile, Buffer.from('not-a-signed-windows-executable'));

    const result = spawnSync(
      process.execPath,
      ['scripts/verify-windows-signature.mjs', unsignedFile],
      { cwd: projectRoot, encoding: 'utf8' },
    );

    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain('未通过可信签名验证');
    expect(`${result.stdout}${result.stderr}`).not.toContain('SHA-256');
  });

  it('能在构建进程环境中识别 Windows 自带的可信签名文件', { timeout: 15_000 }, () => {
    const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT;
    expect(systemRoot).toBeTruthy();
    const signedSystemFile = join(systemRoot!, 'System32', 'notepad.exe');
    const result = spawnSync(
      process.execPath,
      ['scripts/verify-windows-signature.mjs', signedSystemFile],
      { cwd: projectRoot, encoding: 'utf8' },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('可信签名有效: notepad.exe');
  });

  it('只从已签名目录刷新便携版并清除旧候选', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agenticgame-portable-release-'));
    const sourceDir = join(root, 'win-unpacked');
    const targetDir = join(root, 'AgenticGame-win-x64');
    const archivePath = join(root, 'AgenticGame-public-beta-b-win-x64.zip');
    mkdirSync(join(sourceDir, 'resources'), { recursive: true });
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(join(sourceDir, 'AgenticGame.exe'), 'signed-main');
    writeFileSync(join(sourceDir, 'AgenticGame-Agent.exe'), 'signed-bridge');
    writeFileSync(join(sourceDir, 'resources', 'app.asar'), 'signed-app');
    writeFileSync(join(targetDir, 'stale.exe'), 'must-disappear');
    writeFileSync(archivePath, 'stale-archive');

    const { refreshPortableRelease } = await import('../scripts/refresh-portable-release.mjs');
    const archiveCalls: Array<{ sourceDir: string; archivePath: string }> = [];
    refreshPortableRelease({
      sourceDir,
      targetDir,
      archivePath,
      archiveDirectory: ({ sourceDir: copiedSource, archivePath: copiedArchive }) => {
        archiveCalls.push({ sourceDir: copiedSource, archivePath: copiedArchive });
        writeFileSync(copiedArchive, 'fresh-archive');
      },
    });

    expect(existsSync(join(targetDir, 'stale.exe'))).toBe(false);
    expect(readFileSync(join(targetDir, 'AgenticGame.exe'), 'utf8')).toBe('signed-main');
    expect(readFileSync(join(targetDir, 'AgenticGame-Agent.exe'), 'utf8')).toBe('signed-bridge');
    expect(readFileSync(join(targetDir, 'resources', 'app.asar'), 'utf8')).toBe('signed-app');
    expect(readFileSync(archivePath, 'utf8')).toBe('fresh-archive');
    expect(archiveCalls).toEqual([{ sourceDir: targetDir, archivePath }]);
  });

  it('正式签名流程在刷新便携版后复验两个 EXE，最后才生成完整性清单', () => {
    const script = readFileSync(join(projectRoot, 'scripts', 'pack-desktop-signed.mjs'), 'utf8');
    const firstVerification = script.indexOf("join(projectRoot, 'release', 'win-unpacked', 'AgenticGame.exe')");
    const refresh = script.indexOf('    refreshPortableRelease({');
    const portableVerification = script.indexOf("join(portableDir, 'AgenticGame.exe')");
    const integrity = script.indexOf("'generate-release-integrity.mjs'");

    expect(firstVerification).toBeGreaterThan(0);
    expect(refresh).toBeGreaterThan(firstVerification);
    expect(portableVerification).toBeGreaterThan(refresh);
    expect(integrity).toBeGreaterThan(portableVerification);
  });
});
