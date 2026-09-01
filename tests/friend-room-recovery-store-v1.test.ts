import { afterEach, describe, expect, it } from 'vitest';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPresetBuildV1 } from '../src/desktop/preset-builds-v1.js';
import {
  FriendRoomRecoveryStoreV1,
  assertFriendRoomRecoveryCapsuleV1,
  type FriendRoomRecoveryCipherV1,
  type FriendRoomRecoveryCapsuleV1,
} from '../src/desktop/friend-room-recovery-store-v1.js';

const roots: string[] = [];
const secret = Buffer.from('agentic-game-test-key', 'utf8');

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

class AuthenticatedTestCipher implements FriendRoomRecoveryCipherV1 {
  constructor(private readonly available = true) {}

  isAvailable(): boolean {
    return this.available;
  }

  encrypt(value: string): Buffer {
    const payload = Buffer.from(value, 'utf8');
    const encrypted = Buffer.from(payload.map((byte, index) => byte ^ secret[index % secret.length]!));
    const tag = createHmac('sha256', secret).update(encrypted).digest();
    return Buffer.concat([tag, encrypted]);
  }

  decrypt(value: Buffer): string {
    const tag = value.subarray(0, 32);
    const encrypted = value.subarray(32);
    const expected = createHmac('sha256', secret).update(encrypted).digest();
    if (tag.length !== expected.length || !timingSafeEqual(tag, expected)) throw new Error('tampered');
    return Buffer.from(encrypted.map((byte, index) => byte ^ secret[index % secret.length]!)).toString('utf8');
  }
}

async function fixture(available = true) {
  const root = await mkdtemp(join(tmpdir(), 'agentic-game-recovery-'));
  roots.push(root);
  return {
    root,
    path: join(root, 'rooms', 'active-room-v1.room'),
    store: new FriendRoomRecoveryStoreV1(root, new AuthenticatedTestCipher(available), {
      now: () => '2026-09-01T12:00:00.000Z',
    }),
  };
}

function capsule(overrides: Partial<FriendRoomRecoveryCapsuleV1> = {}): FriendRoomRecoveryCapsuleV1 {
  return {
    version: 1,
    role: 'host',
    sessionId: 'room-20260901',
    displayName: '乐淳',
    revision: 8,
    createdAt: '2026-09-01T10:00:00.000Z',
    expiresAt: '2026-09-02T10:00:00.000Z',
    ownBuild: createPresetBuildV1('scout', '2026-09-01T10:01:00.000Z'),
    publicSnapshot: {
      status: 'configuring',
      mapId: 'frontier-v2',
      participants: [
        { seat: 'host', displayName: '乐淳', connected: true, ready: false },
        { seat: 'guest', displayName: '朋友', connected: false, ready: false },
      ],
    },
    ...overrides,
  };
}

describe('FriendRoomRecoveryStoreV1', () => {
  it('原子保存系统密文，并且绝不把房间编号、昵称或 Build 明文写入文件', async () => {
    const { path, store } = await fixture();

    await expect(store.save(capsule())).resolves.toEqual({ status: 'saved' });
    await expect(store.inspect()).resolves.toEqual({ status: 'available', capsule: capsule() });

    const source = readFileSync(path);
    expect(source.toString('utf8')).not.toContain('room-20260901');
    expect(source.toString('utf8')).not.toContain('乐淳');
    expect(source.toString('utf8')).not.toContain('scout');
    expect(source.subarray(0, 8).toString('utf8')).toBe('AGFRREC1');
  });

  it('系统加密不可用时禁用恢复且不创建文件', async () => {
    const { path, store } = await fixture(false);

    await expect(store.save(capsule())).resolves.toEqual({ status: 'disabled' });
    await expect(store.inspect()).resolves.toEqual({ status: 'disabled' });
    expect(existsSync(path)).toBe(false);
  });

  it('拒绝超过 24 小时的胶囊、非法日期和未知字段', () => {
    expect(() => assertFriendRoomRecoveryCapsuleV1(capsule({ expiresAt: '2026-09-02T10:00:00.001Z' })))
      .toThrow('恢复胶囊有效期不能超过 24 小时');
    expect(() => assertFriendRoomRecoveryCapsuleV1(capsule({ expiresAt: 'not-a-date' })))
      .toThrow('恢复胶囊时间无效');
    expect(() => assertFriendRoomRecoveryCapsuleV1({ ...capsule(), ciphertext: 'secret' }))
      .toThrow('恢复胶囊结构无效');
  });

  it('过期后返回可行动状态并清除旧密文', async () => {
    const { path, store } = await fixture();
    await store.save(capsule({ expiresAt: '2026-09-01T11:59:59.999Z' }));

    await expect(store.inspect()).resolves.toEqual({ status: 'expired' });
    expect(existsSync(path)).toBe(false);
  });

  it('篡改、无法解密和非严格结构都被拒绝并清除，不回显密文', async () => {
    const { path, store } = await fixture();
    await store.save(capsule());
    const tampered = readFileSync(path);
    tampered[tampered.length - 1] ^= 1;
    writeFileSync(path, tampered);

    await expect(store.inspect()).resolves.toEqual({ status: 'invalid' });
    expect(existsSync(path)).toBe(false);

    await mkdir(join(path, '..'), { recursive: true });
    const cipher = new AuthenticatedTestCipher();
    const invalid = cipher.encrypt(JSON.stringify({ ...capsule(), unexpected: true }));
    writeFileSync(path, Buffer.concat([Buffer.from('AGFRREC1'), invalid]));
    await expect(store.inspect()).resolves.toEqual({ status: 'invalid' });
  });

  it('可以显式清除恢复胶囊，并把尚未创建视为 missing', async () => {
    const { path, store } = await fixture();
    await expect(store.inspect()).resolves.toEqual({ status: 'missing' });
    await store.save(capsule());

    await store.clear();

    expect(existsSync(path)).toBe(false);
    await expect(store.inspect()).resolves.toEqual({ status: 'missing' });
  });
});
