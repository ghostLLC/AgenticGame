import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { AsyncRoomServiceV1 } from './async-room-service-v1.js';

const BODY_LIMIT = 2 * 1024 * 1024;

export function createAsyncRoomHttpServerV1(service = new AsyncRoomServiceV1()): Server {
  return createServer((request, response) => {
    void handle(request, response, service);
  });
}

async function handle(request: IncomingMessage, response: ServerResponse, service: AsyncRoomServiceV1): Promise<void> {
  const method = request.method ?? 'GET';
  const path = new URL(request.url ?? '/', 'http://localhost').pathname;
  try {
    if (method === 'POST' && path === '/api/rooms') {
      const body = await readBody(request) as { displayName?: unknown };
      return json(response, 201, service.createRoom(String(body.displayName ?? '')));
    }

    const join = /^\/api\/rooms\/([^/]+)\/join$/.exec(path);
    if (method === 'POST' && join) {
      const body = await readBody(request) as { displayName?: unknown };
      return json(response, 200, service.joinRoom(join[1]!, String(body.displayName ?? '')));
    }

    const build = /^\/api\/rooms\/([^/]+)\/build$/.exec(path);
    if (method === 'PUT' && build) {
      const body = await readBody(request) as { build?: unknown };
      return json(response, 200, service.selectBuild(build[1]!, bearer(request), body.build));
    }

    const ready = /^\/api\/rooms\/([^/]+)\/ready$/.exec(path);
    if (method === 'PUT' && ready) {
      const body = await readBody(request) as { ready?: unknown };
      if (typeof body.ready !== 'boolean') throw new Error('ready must be a boolean');
      return json(response, 200, service.setReady(ready[1]!, bearer(request), body.ready));
    }

    const room = /^\/api\/rooms\/([^/]+)$/.exec(path);
    if (method === 'GET' && room) {
      return json(response, 200, service.getRoom(room[1]!, bearer(request)));
    }

    json(response, 404, { error: 'Not found' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Request failed';
    json(response, statusFor(message), { error: bounded(message) });
  }
}

function readBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        reject(new Error('Request body is too large'));
        request.destroy();
      } else {
        chunks.push(chunk);
      }
    });
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    request.on('error', reject);
  });
}

function bearer(request: IncomingMessage): string {
  const header = request.headers.authorization ?? '';
  return header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
}

function statusFor(message: string): number {
  if (message === 'Invalid participant token') return 401;
  if (message === 'Room not found') return 404;
  if (message === 'Room is full' || message === 'Room is not joinable' || message === 'Room is not configurable') return 409;
  return 400;
}

function bounded(message: string): string {
  return message.slice(0, 200);
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(JSON.stringify(value));
}

