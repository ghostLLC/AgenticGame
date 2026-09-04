import {
  closeSync,
  existsSync,
  fstatSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HASH_BUFFER_BYTES = 1024 * 1024;
const SAFE_LABEL = /^[0-9A-Za-z][0-9A-Za-z.-]*$/;

function assertLabel(value, label) {
  if (typeof value !== 'string' || !SAFE_LABEL.test(value)) {
    throw new Error(`${label} 格式无效`);
  }
}

function resolveArtifactPath(releaseDir, file) {
  if (typeof file !== 'string' || file.length === 0 || isAbsolute(file)) {
    throw new Error('发布产物必须位于发布目录内');
  }

  const releaseRoot = resolve(releaseDir);
  const artifactPath = resolve(releaseRoot, file);
  const artifactRelative = relative(releaseRoot, artifactPath);
  if (
    artifactRelative.length === 0
    || artifactRelative === '..'
    || artifactRelative.startsWith(`..${sep}`)
    || isAbsolute(artifactRelative)
  ) {
    throw new Error('发布产物必须位于发布目录内');
  }
  return { artifactPath, normalizedFile: artifactRelative.replaceAll('\\', '/') };
}

function sha256File(file) {
  const descriptor = openSync(file, 'r');
  const buffer = Buffer.allocUnsafe(HASH_BUFFER_BYTES);
  const hash = createHash('sha256');
  try {
    while (true) {
      const bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    closeSync(descriptor);
  }
  return hash.digest('hex').toUpperCase();
}

function atomicWriteText(targetPath, content) {
  const temporaryPath = `${targetPath}.${process.pid}.tmp`;
  try {
    writeFileSync(temporaryPath, content, { encoding: 'utf8', flag: 'wx' });
    renameSync(temporaryPath, targetPath);
  } finally {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
}

/**
 * @param {{
 *   releaseDir: string,
 *   version: string,
 *   channel: string,
 *   artifacts: Array<{file: string, purpose: string}>
 * }} input
 */
export function generateReleaseIntegrityFiles(input) {
  assertLabel(input.version, '版本号');
  assertLabel(input.channel, '发布通道');
  if (!Array.isArray(input.artifacts) || input.artifacts.length === 0) {
    throw new Error('至少需要一个发布产物');
  }

  const seen = new Set();
  const artifacts = input.artifacts.map((definition) => {
    if (typeof definition.purpose !== 'string' || definition.purpose.length === 0) {
      throw new Error('发布产物用途不能为空');
    }
    const { artifactPath, normalizedFile } = resolveArtifactPath(input.releaseDir, definition.file);
    if (seen.has(normalizedFile)) throw new Error(`发布产物重复: ${normalizedFile}`);
    seen.add(normalizedFile);

    if (!existsSync(artifactPath)) throw new Error(`发布产物不存在: ${normalizedFile}`);
    const stats = statSync(artifactPath);
    if (!stats.isFile()) throw new Error(`发布产物不是文件: ${normalizedFile}`);
    if (stats.size === 0) throw new Error(`发布产物是空文件: ${normalizedFile}`);

    return {
      file: normalizedFile,
      purpose: definition.purpose,
      bytes: stats.size,
      sha256: sha256File(artifactPath),
    };
  }).sort((left, right) => left.file.localeCompare(right.file, 'en'));

  const manifest = {
    schemaVersion: 1,
    product: 'AgenticGame',
    version: input.version,
    channel: input.channel,
    artifacts,
  };
  const prefix = `AgenticGame-${input.version}-${input.channel}`;
  const manifestPath = resolve(input.releaseDir, `${prefix}-manifest.json`);
  const checksumPath = resolve(input.releaseDir, `${prefix}.sha256`);
  atomicWriteText(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  atomicWriteText(
    checksumPath,
    `${artifacts.map((artifact) => `${artifact.sha256}  ${artifact.file}`).join('\n')}\n`,
  );

  return { manifest, manifestPath, checksumPath };
}

function runCli() {
  const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const pkg = JSON.parse(readFileSync(resolve(projectRoot, 'package.json'), 'utf8'));
  const result = generateReleaseIntegrityFiles({
    releaseDir: resolve(projectRoot, 'release'),
    version: pkg.version,
    channel: 'public-beta-b',
    artifacts: [
      {
        file: `AgenticGame-${pkg.version}-public-beta-b-win-x64.zip`,
        purpose: 'portable-windows-x64',
      },
      {
        file: `AgenticGame-${pkg.version}-win-x64-setup.exe`,
        purpose: 'installer-windows-x64',
      },
    ],
  });
  console.log(`发布清单已生成: ${result.manifestPath}`);
  console.log(`SHA-256 校验文件已生成: ${result.checksumPath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
