import { existsSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const powershell = process.env.SystemRoot
  ? join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  : 'powershell.exe';

function verifyFile(file) {
  const target = resolve(file);
  const label = basename(target);
  if (!existsSync(target) || !statSync(target).isFile()) {
    throw new Error(`签名目标不存在: ${label}`);
  }

  const result = spawnSync(powershell, [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy', 'Bypass',
    '-File', join(scriptDir, 'verify-authenticode.ps1'),
    '-TargetPath', target,
  ], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`未通过可信签名验证: ${label} (Unreadable)`);
  }

  const signature = JSON.parse(result.stdout.trim());
  if (signature.status !== 'Valid' || !signature.subject || !signature.thumbprint) {
    throw new Error(`未通过可信签名验证: ${label} (${signature.status || 'Unknown'})`);
  }
  return { file: label, subject: signature.subject, thumbprint: signature.thumbprint };
}

try {
  if (process.platform !== 'win32') throw new Error('Windows 签名验证只能在 Windows 上运行');
  if (process.argv.length < 3) throw new Error('请提供至少一个待验证的 Windows 文件');
  const verified = process.argv.slice(2).map(verifyFile);
  for (const item of verified) {
    console.log(`可信签名有效: ${item.file} | ${item.subject} | ${item.thumbprint}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
