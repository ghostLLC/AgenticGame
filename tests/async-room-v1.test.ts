import { describe, expect, it } from 'vitest';
import { createSavedBuildV2, type SavedBuildV2 } from '../src/config/saved-build-v2.js';
import { verifyMatchBundleV2 } from '../src/replay/v2.js';
import type { MatchBundleV2 } from '../src/replay/v2.js';
import { AsyncRoomServiceV1 } from '../src/online/async-room-service-v1.js';

const passiveSource = `module.exports = () => ({ onTick() { return { throttle: 0, bodyTurn: 0, turretTurn: 0, fire: false }; } });`;
const movingSource = `module.exports = () => ({ onTick() { return { throttle: 1, bodyTurn: 0, turretTurn: 0, fire: false }; } });`;

function build(buildId: string, label: string, source: string): SavedBuildV2 {
  return createSavedBuildV2({
    buildId,
    label,
    bot: {
      artifactId: `${buildId}-bot`,
      version: '1.0.0',
      language: 'javascript',
      entryPoint: `${buildId}.js`,
      source,
    },
    loadout: { vehicleId: 'scout', weaponId: 'light-cannon', equipmentIds: [] },
  }, {
    revision: 1,
    parentFingerprint: null,
    createdAt: '2026-08-24T00:00:00.000Z',
  });
}

describe('AsyncRoomServiceV1', () => {
  it('lets two players join with separate credentials while exposing no token or source', () => {
    const service = new AsyncRoomServiceV1({
      roomCode: () => 'A7K9MQ',
      participantToken: (seat) => `${seat}-secret`,
      maxTicks: 4,
      createdAt: () => '2026-08-24T00:01:00.000Z',
    });

    const host = service.createRoom('乐淳');
    const challenger = service.joinRoom('a7k9mq', 'Ghost');
    service.selectBuild(host.room.code, host.participantToken, build('host-build', '稳健侦察', passiveSource));
    const room = service.selectBuild(challenger.room.code, challenger.participantToken, build('guest-build', '重甲推进', movingSource));

    expect(host.participantToken).toBe('host-secret');
    expect(challenger.participantToken).toBe('challenger-secret');
    expect(room).toMatchObject({
      code: 'A7K9MQ',
      status: 'configuring',
      participants: [
        { seat: 'host', displayName: '乐淳', ready: false, build: { buildId: 'host-build', revision: 1, label: '稳健侦察' } },
        { seat: 'challenger', displayName: 'Ghost', ready: false, build: { buildId: 'guest-build', revision: 1, label: '重甲推进' } },
      ],
    });
    expect(JSON.stringify(room)).not.toContain('secret');
    expect(JSON.stringify(room)).not.toContain('module.exports');
    expect(JSON.stringify(room)).not.toContain('codeHash');
  });

  it('rejects a third participant, an invalid credential, and a tampered Build', () => {
    const service = new AsyncRoomServiceV1({ roomCode: () => 'A7K9MQ' });
    const host = service.createRoom('Host');
    service.joinRoom(host.room.code, 'Guest');

    expect(() => service.joinRoom(host.room.code, 'Third')).toThrow('Room is full');
    expect(() => service.selectBuild(host.room.code, 'wrong-token', build('host-build', 'Host', passiveSource))).toThrow('Invalid participant token');

    const tampered = structuredClone(build('host-build', 'Host', passiveSource));
    tampered.loadout.vehicleId = 'heavy';
    expect(() => service.selectBuild(host.room.code, host.participantToken, tampered)).toThrow('Invalid SavedBuildV2');
  });

  it('clears readiness after a Build change and starts exactly one authoritative match', async () => {
    let matchStarts = 0;
    let producedBundle: MatchBundleV2 | undefined;
    let releaseMatch!: () => void;
    const gate = new Promise<void>((resolve) => { releaseMatch = resolve; });
    const service = new AsyncRoomServiceV1({
      roomCode: () => 'A7K9MQ',
      participantToken: (seat) => `${seat}-secret`,
      runMatch: async (input) => {
        matchStarts += 1;
        await gate;
        return input.runDefault();
      },
      maxTicks: 4,
      tickBudgetMs: 100,
      createdAt: () => '2026-08-24T00:01:00.000Z',
      onBundle: (bundle) => { producedBundle = bundle; },
    });
    const host = service.createRoom('Host');
    const guest = service.joinRoom(host.room.code, 'Guest');
    service.selectBuild(host.room.code, host.participantToken, build('host-build', 'Host v1', passiveSource));
    service.selectBuild(host.room.code, guest.participantToken, build('guest-build', 'Guest v1', movingSource));
    service.setReady(host.room.code, host.participantToken, true);
    service.selectBuild(host.room.code, host.participantToken, build('host-build-2', 'Host v2', movingSource));
    expect(service.getRoom(host.room.code, host.participantToken).participants[0]!.ready).toBe(false);

    service.setReady(host.room.code, host.participantToken, true);
    const running = service.setReady(host.room.code, guest.participantToken, true);
    expect(running.status).toBe('running');
    expect(matchStarts).toBe(1);
    expect(() => service.setReady(host.room.code, guest.participantToken, true)).toThrow('Room is not configurable');

    releaseMatch();
    const complete = await service.waitForSettlement(host.room.code, host.participantToken);
    expect(matchStarts).toBe(1);
    expect(complete.status).toBe('complete');
    expect(complete.result).toMatchObject({ reason: 'time-limit-draw', ticks: 4 });
    expect(complete.result?.bundleHash).toMatch(/^[0-9a-f]{64}$/);
    expect(producedBundle).toBeDefined();
    expect(verifyMatchBundleV2(producedBundle!)).toEqual({ ok: true, issues: [] });
  });
});
