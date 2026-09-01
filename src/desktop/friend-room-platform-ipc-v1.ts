import type { FriendRoomRoleV1 } from '../friend-room/browser-connection-v1.js';
import type { FriendRoomRecoveryPublicSnapshotV1 } from './friend-room-recovery-store-v1.js';
import type { NearbyFriendCardV1 } from './lan-discovery-v1.js';
import type { ReleaseDiagnosticReportV1 } from './release-diagnostics-service-v1.js';

export type FriendRoomRecoveryProjectionV1 =
  | { status: 'missing' | 'disabled' | 'expired' | 'invalid' }
  | {
    status: 'available';
    role: FriendRoomRoleV1;
    sessionId: string;
    displayName: string;
    revision: number;
    expiresAt: string;
    publicSnapshot: FriendRoomRecoveryPublicSnapshotV1;
  };

export interface FriendRoomNearbyPublishInputV1 {
  sessionId: string;
  displayName: string;
  invitationCard: string;
}

export interface FriendRoomNearbyConfirmationInputV1 {
  discoveryId: string;
  displayName: string;
  joinConfirmation: string;
}

export interface FriendRoomPlatformRendererApiV1 {
  inspectRecovery(): Promise<FriendRoomRecoveryProjectionV1>;
  restore(): Promise<void>;
  leave(confirmed: true): Promise<void>;
  runDiagnostics(): Promise<ReleaseDiagnosticReportV1>;
  startNearby(): Promise<void>;
  publishNearby(input: FriendRoomNearbyPublishInputV1): Promise<void>;
  sendNearbyConfirmation(input: FriendRoomNearbyConfirmationInputV1): Promise<void>;
  stopNearby(): Promise<void>;
}

export interface FriendRoomPlatformServiceBoundaryV1 {
  inspectRecovery(): Promise<FriendRoomRecoveryProjectionV1>;
  restoreRoom(senderId: number): Promise<void>;
  leaveRoom(senderId: number): Promise<void>;
  runDiagnostics(): Promise<ReleaseDiagnosticReportV1>;
  startNearby(senderId: number): Promise<void>;
  publishNearby(senderId: number, input: FriendRoomNearbyPublishInputV1): void;
  sendNearbyConfirmation(senderId: number, input: FriendRoomNearbyConfirmationInputV1): void;
  stopNearby(senderId: number): void;
}

export interface FriendRoomPlatformEventV1 {
  sender: { id: number };
}

export type FriendRoomPlatformHandlerV1 = (event: FriendRoomPlatformEventV1, input?: unknown) => unknown | Promise<unknown>;

export interface FriendRoomPlatformRegistrarV1 {
  handle(channel: string, handler: FriendRoomPlatformHandlerV1): void;
}

export function registerFriendRoomPlatformIpcV1(
  registrar: FriendRoomPlatformRegistrarV1,
  service: FriendRoomPlatformServiceBoundaryV1,
): void {
  registrar.handle('friend-room:recovery-inspect', async (_event, input) => {
    requireNoInput(input);
    return service.inspectRecovery();
  });
  registrar.handle('friend-room:restore', async (event, input) => {
    requireNoInput(input);
    return service.restoreRoom(senderId(event));
  });
  registrar.handle('friend-room:leave', async (event, input) => {
    if (input !== true) throw new Error('需要明确确认退出房间');
    return service.leaveRoom(senderId(event));
  });
  registrar.handle('friend-room:diagnostics', async (_event, input) => {
    requireNoInput(input);
    return service.runDiagnostics();
  });
  registrar.handle('friend-room:nearby-start', async (event, input) => {
    requireNoInput(input);
    return service.startNearby(senderId(event));
  });
  registrar.handle('friend-room:nearby-publish', async (event, input) => {
    return service.publishNearby(senderId(event), validatePublish(input));
  });
  registrar.handle('friend-room:nearby-confirm', async (event, input) => {
    return service.sendNearbyConfirmation(senderId(event), validateConfirmation(input));
  });
  registrar.handle('friend-room:nearby-stop', async (event, input) => {
    requireNoInput(input);
    return service.stopNearby(senderId(event));
  });
}

export type FriendRoomPlatformInvokeV1 = (channel: string, input?: unknown) => Promise<unknown>;

export function createFriendRoomPlatformPreloadApiV1(invoke: FriendRoomPlatformInvokeV1): FriendRoomPlatformRendererApiV1 {
  return {
    inspectRecovery: () => invoke('friend-room:recovery-inspect') as Promise<FriendRoomRecoveryProjectionV1>,
    restore: () => invoke('friend-room:restore') as Promise<void>,
    leave: (confirmed) => invoke('friend-room:leave', confirmed) as Promise<void>,
    runDiagnostics: () => invoke('friend-room:diagnostics') as Promise<ReleaseDiagnosticReportV1>,
    startNearby: () => invoke('friend-room:nearby-start') as Promise<void>,
    publishNearby: (input) => invoke('friend-room:nearby-publish', input) as Promise<void>,
    sendNearbyConfirmation: (input) => invoke('friend-room:nearby-confirm', input) as Promise<void>,
    stopNearby: () => invoke('friend-room:nearby-stop') as Promise<void>,
  };
}

export interface FriendRoomNearbyRendererEventsV1 {
  onNearbyChanged(listener: (cards: NearbyFriendCardV1[]) => void): void;
  onNearbyConfirmation(listener: (answer: { displayName: string; joinConfirmation: string }) => void): void;
}

function validatePublish(input: unknown): FriendRoomNearbyPublishInputV1 {
  if (!isRecord(input) || !hasExactKeys(input, ['sessionId', 'displayName', 'invitationCard'])) {
    throw new Error('附近好友邀请无效');
  }
  try {
    return {
      sessionId: stableId(input.sessionId),
      displayName: displayName(input.displayName),
      invitationCard: signal(input.invitationCard),
    };
  } catch {
    throw new Error('附近好友邀请无效');
  }
}

function validateConfirmation(input: unknown): FriendRoomNearbyConfirmationInputV1 {
  if (!isRecord(input) || !hasExactKeys(input, ['discoveryId', 'displayName', 'joinConfirmation'])) {
    throw new Error('附近好友确认无效');
  }
  try {
    return {
      discoveryId: stableId(input.discoveryId),
      displayName: displayName(input.displayName),
      joinConfirmation: signal(input.joinConfirmation),
    };
  } catch {
    throw new Error('附近好友确认无效');
  }
}

function senderId(event: FriendRoomPlatformEventV1): number {
  if (!Number.isSafeInteger(event?.sender?.id) || event.sender.id < 1) throw new Error('窗口身份无效');
  return event.sender.id;
}

function requireNoInput(input: unknown): void {
  if (input !== undefined) throw new Error('操作参数无效');
}

function stableId(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 64
    || !/^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/.test(value)) throw new Error('invalid stable id');
  return value;
}

function displayName(value: unknown): string {
  if (typeof value !== 'string') throw new Error('invalid display name');
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 32) throw new Error('invalid display name');
  return normalized;
}

function signal(value: unknown): string {
  if (typeof value !== 'string' || value.length > 50_000
    || (!value.startsWith('AGFR1.') && !value.startsWith('AGFR2.'))) throw new Error('invalid signal');
  return value;
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => actual.includes(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
