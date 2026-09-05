import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { refreshPortableRelease } from './refresh-portable-release.mjs';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const requiredSecrets = ['CSC_LINK', 'CSC_KEY_PASSWORD'];
const missing = requiredSecrets.filter((name) => !process.env[name]);

if (missing.length > 0) {
  console.error(`正式签名构建已拒绝：缺少 ${missing.join('、')}。请只在本机环境变量中配置证书，不要写入项目或命令参数。`);
  process.exitCode = 1;
} else {
  const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));
  const signedConfig = structuredClone(pkg.build);
  delete signedConfig.win.signExecutable;
  signedConfig.forceCodeSigning = true;

  const tempRoot = join(projectRoot, '.tmp');
  const configPath = join(tempRoot, `electron-builder-signed-${process.pid}.json`);
  const builderCache = join(projectRoot, '.cache', 'electron-builder');
  const builderCli = join(projectRoot, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js');
  const portableDir = join(projectRoot, 'release', 'AgenticGame-win-x64');
  const portableArchive = join(
    projectRoot,
    'release',
    `AgenticGame-${pkg.version}-public-beta-b-win-x64.zip`,
  );
  const run = (command, args, env = process.env) => {
    const result = spawnSync(command, args, {
      cwd: projectRoot,
      env,
      stdio: 'inherit',
      windowsHide: true,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`正式签名构建步骤失败，退出码 ${result.status ?? 1}`);
  };

  mkdirSync(tempRoot, { recursive: true });
  mkdirSync(builderCache, { recursive: true });
  try {
    writeFileSync(configPath, `${JSON.stringify(signedConfig, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build:desktop']);
    run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build:agent-bridge']);
    run(process.execPath, [builderCli, '--win', 'nsis', '--x64', '--config', configPath, '--publish', 'never'], {
      ...process.env,
      CSC_IDENTITY_AUTO_DISCOVERY: 'true',
      ELECTRON_BUILDER_CACHE: builderCache,
    });
    run(process.execPath, [
      join(projectRoot, 'scripts', 'verify-windows-signature.mjs'),
      join(projectRoot, 'release', 'win-unpacked', 'AgenticGame.exe'),
      join(projectRoot, 'release', 'win-unpacked', 'AgenticGame-Agent.exe'),
      join(projectRoot, 'release', `AgenticGame-${pkg.version}-win-x64-setup.exe`),
    ]);
    refreshPortableRelease({
      sourceDir: join(projectRoot, 'release', 'win-unpacked'),
      targetDir: portableDir,
      archivePath: portableArchive,
    });
    run(process.execPath, [
      join(projectRoot, 'scripts', 'verify-windows-signature.mjs'),
      join(portableDir, 'AgenticGame.exe'),
      join(portableDir, 'AgenticGame-Agent.exe'),
    ]);
    run(process.execPath, [join(projectRoot, 'scripts', 'generate-release-integrity.mjs')]);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    rmSync(configPath, { force: true });
  }
}
