import { cpSync, existsSync, rmSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function archiveWithPowerShell({ sourceDir, archivePath }) {
  const result = spawnSync(
    join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      join(projectRoot, 'scripts', 'compress-portable-release.ps1'),
      '-SourceDirectory',
      sourceDir,
      '-ArchivePath',
      archivePath,
    ],
    { cwd: projectRoot, stdio: 'inherit', windowsHide: true },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`便携版 ZIP 生成失败，退出码 ${result.status ?? 1}`);
}
/**
 * Replace a portable release only from the directory that has already passed
 * Authenticode verification. The injectable archiver keeps this operation
 * independently testable without weakening the production path.
 */
export function refreshPortableRelease({
  sourceDir,
  targetDir,
  archivePath,
  archiveDirectory = archiveWithPowerShell,
}) {
  const source = resolve(sourceDir);
  const target = resolve(targetDir);
  const archive = resolve(archivePath);
  if (!existsSync(source) || !statSync(source).isDirectory()) {
    throw new Error(`已签名目录不存在: ${source}`);
  }
  if (source === target) throw new Error('便携版来源与目标目录不能相同');

  rmSync(target, { recursive: true, force: true });
  cpSync(source, target, { recursive: true, force: false, errorOnExist: true });
  rmSync(archive, { force: true });
  archiveDirectory({ sourceDir: target, archivePath: archive });

  if (!existsSync(archive) || !statSync(archive).isFile() || statSync(archive).size === 0) {
    throw new Error(`便携版 ZIP 未正确生成: ${archive}`);
  }
  return { portableDir: target, archivePath: archive };
}
