import { afterEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createSavedBuildV2 } from '../src/config/saved-build-v2.js';
import { AsyncRoomServiceV1 } from '../src/online/async-room-service-v1.js';
import { createAsyncRoomHttpServerV1 } from '../src/online/async-room-http-v1.js';

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
});

function savedBuild(buildId: string) {
  return createSavedBuildV2({
    buildId,
    label: buildId,
    bot: {
      artifactId: `${buildId}-bot`,
      version: '1.0.0',
      language: 'javascript',
      entryPoint: `${buildId}.js`,
      source: `module.exports = () => ({ onTick() { return { throttle: 0, bodyTurn: 0, turretTurn: 0, fire: false }; } });`,
    },
    loadout: { vehicleId: 'scout', weaponId: 'light-cannon', equipmentIds: [] },
  }, { revision: 1, parentFingerprint: null, createdAt: '2026-08-24T00:00:00.000Z' });
}

async function start() {
  const service = new AsyncRoomServiceV1({
    roomCode: () => 'A7K9MQ',
    participantToken: (seat) => `${seat}-secret`,
    maxTicks: 2,
    tickBudgetMs: 100,
    createdAt: () => '2026-08-24T00:01:00.000Z',
  });
  const server = createAsyncRoomHttpServerV1(service);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${address.port}` };
}

async function json(response: Response) {
  return await response.json() as Record<string, any>;
}

describe('async room HTTP v1', () => {
  it('creates, joins, configures, and completes a two-player room without file endpoints', async () => {
    const { baseUrl } = await start();
    const createdResponse = await fetch(`${baseUrl}/api/rooms`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ displayName: 'Host' }),
    });
    expect(createdResponse.status).toBe(201);
    const created = await json(createdResponse);
    expect(created.participantToken).toBe('host-secret');
    expect(created.room.status).toBe('waiting-for-opponent');

    const joinedResponse = await fetch(`${baseUrl}/api/rooms/a7k9mq/join`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ displayName: 'Guest' }),
    });
    expect(joinedResponse.status).toBe(200);
    const joined = await json(joinedResponse);

    for (const [token, build] of [[created.participantToken, savedBuild('host-build')], [joined.participantToken, savedBuild('guest-build')]] as const) {
      const response = await fetch(`${baseUrl}/api/rooms/A7K9MQ/build`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ build }),
      });
      expect(response.status).toBe(200);
      expect(JSON.stringify(await json(response))).not.toContain('module.exports');
    }

    for (const token of [created.participantToken, joined.participantToken]) {
      const response = await fetch(`${baseUrl}/api/rooms/A7K9MQ/ready`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ ready: true }),
      });
      expect(response.status).toBe(200);
    }

    let room: Record<string, any> | undefined;
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const response = await fetch(`${baseUrl}/api/rooms/A7K9MQ`, { headers: { authorization: 'Bearer host-secret' } });
      room = await json(response);
      if (room.status === 'complete') break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(room).toMatchObject({ status: 'complete', result: { ticks: 2 } });
  });

  it('maps missing credentials and room conflicts to bounded HTTP errors', async () => {
    const { baseUrl } = await start();
    await fetch(`${baseUrl}/api/rooms`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ displayName: 'Host' }),
    });
    await fetch(`${baseUrl}/api/rooms/A7K9MQ/join`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ displayName: 'Guest' }),
    });

    const unauthorized = await fetch(`${baseUrl}/api/rooms/A7K9MQ`);
    expect(unauthorized.status).toBe(401);
    expect(await json(unauthorized)).toEqual({ error: 'Invalid participant token' });

    const full = await fetch(`${baseUrl}/api/rooms/A7K9MQ/join`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ displayName: 'Third' }),
    });
    expect(full.status).toBe(409);
    expect(await json(full)).toEqual({ error: 'Room is full' });
  });
});
