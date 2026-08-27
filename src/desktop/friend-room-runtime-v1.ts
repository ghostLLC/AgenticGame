import { createSavedBuildV2, type SavedBuildV2 } from '../config/saved-build-v2.js';
import {
  FriendRoomGuestSessionV1,
  FriendRoomHostSessionV1,
  type FriendRoomPeerV1,
  type FriendRoomSnapshotV1,
} from '../friend-room/session-v1.js';
import type { FriendRoomRoleV1 } from '../friend-room/browser-connection-v1.js';

export type FriendRoomPresetIdV1 = 'scout' | 'medium' | 'heavy';

export interface FriendRoomPresetOptionV1 {
  id: FriendRoomPresetIdV1;
  label: string;
  vehicle: string;
  style: string;
}

export interface DesktopFriendRoomEventV1 {
  kind: 'snapshot' | 'error';
  snapshot?: FriendRoomSnapshotV1;
  message?: string;
}

export interface DesktopFriendRoomRuntimeOptionsV1 {
  sendPeer(payload: string): void;
  onEvent(event: DesktopFriendRoomEventV1): void;
  createdAt?: () => string;
  maxTicks?: number;
}

export interface DesktopFriendRoomStartV1 {
  role: FriendRoomRoleV1;
  displayName: string;
  sessionId?: string;
}

const PRESETS: ReadonlyArray<FriendRoomPresetOptionV1> = [
  { id: 'scout', label: '游骑侦察队', vehicle: '侦察坦克', style: '机动侦察，主动寻找侧翼机会' },
  { id: 'medium', label: '中线突击队', vehicle: '中型坦克', style: '攻守均衡，持续向中心施压' },
  { id: 'heavy', label: '钢铁堡垒队', vehicle: '重型坦克', style: '正面推进，依靠装甲稳住阵线' },
];

export function friendRoomPresetOptionsV1(): FriendRoomPresetOptionV1[] {
  return PRESETS.map((item) => ({ ...item }));
}

export class DesktopFriendRoomRuntimeV1 {
  private readonly options: DesktopFriendRoomRuntimeOptionsV1;
  private readonly peerListeners = new Set<(payload: string) => void>();
  private readonly peer: FriendRoomPeerV1;
  private host?: FriendRoomHostSessionV1;
  private guest?: FriendRoomGuestSessionV1;
  private role?: FriendRoomRoleV1;
  private settlement?: Promise<void>;

  constructor(options: DesktopFriendRoomRuntimeOptionsV1) {
    this.options = options;
    this.peer = {
      send: (payload) => options.sendPeer(payload),
      subscribe: (listener) => {
        this.peerListeners.add(listener);
        return () => this.peerListeners.delete(listener);
      },
    };
  }

  start(input: DesktopFriendRoomStartV1): void {
    if (this.role) throw new Error('好友房间已经开始');
    this.role = input.role;
    if (input.role === 'host') {
      if (!input.sessionId) throw new Error('房主缺少房间编号');
      this.host = new FriendRoomHostSessionV1({
        peer: this.peer,
        sessionId: input.sessionId,
        displayName: input.displayName,
        createdAt: this.options.createdAt,
        maxTicks: this.options.maxTicks ?? 120,
        tickBudgetMs: 100,
      });
      this.emitSnapshot(this.host.getSnapshot());
      return;
    }
    this.guest = new FriendRoomGuestSessionV1({ peer: this.peer, displayName: input.displayName });
  }

  receivePeer(payload: string): void {
    try {
      this.peerListeners.forEach((listener) => listener(payload));
      this.emitCurrentSnapshot();
      this.trackSettlement();
    } catch {
      this.options.onEvent({ kind: 'error', message: '好友房间收到的内容无效，请重新创建房间。' });
    }
  }

  selectPreset(presetId: FriendRoomPresetIdV1): void {
    const build = createPresetBuild(presetId, this.options.createdAt?.() ?? new Date().toISOString());
    if (this.host) this.host.selectBuild(build);
    else if (this.guest) this.guest.selectBuild(build);
    else throw new Error('请先连接好友');
    this.emitCurrentSnapshot();
  }

  setReady(ready: boolean): void {
    if (this.host) this.host.setReady(ready);
    else if (this.guest) this.guest.setReady(ready);
    else throw new Error('请先连接好友');
    this.emitCurrentSnapshot();
    this.trackSettlement();
  }

  async waitForSettlement(): Promise<void> {
    this.trackSettlement();
    await this.settlement;
  }

  private emitCurrentSnapshot(): void {
    if (this.host) this.emitSnapshot(this.host.getSnapshot());
    else if (this.guest) {
      try {
        this.emitSnapshot(this.guest.getSnapshot());
      } catch {
        // The guest receives its first snapshot immediately after the host accepts hello.
      }
    }
  }

  private emitSnapshot(snapshot: FriendRoomSnapshotV1): void {
    this.options.onEvent({ kind: 'snapshot', snapshot });
  }

  private trackSettlement(): void {
    if (!this.host || this.host.getSnapshot().status !== 'running' || this.settlement) return;
    this.settlement = this.host.waitForSettlement().then((snapshot) => this.emitSnapshot(snapshot));
  }
}

function createPresetBuild(presetId: FriendRoomPresetIdV1, createdAt: string): SavedBuildV2 {
  const preset = PRESETS.find((item) => item.id === presetId);
  if (!preset) throw new Error('请选择一套战术配置');
  const loadout = preset.id === 'scout'
    ? { vehicleId: 'scout', weaponId: 'light-cannon', equipmentIds: [] as string[] }
    : preset.id === 'medium'
      ? { vehicleId: 'medium', weaponId: 'medium-cannon', equipmentIds: [] as string[] }
      : { vehicleId: 'heavy', weaponId: 'heavy-cannon', equipmentIds: [] as string[] };
  const behavior = preset.id === 'heavy'
    ? '{ throttle: 1, bodyTurn: 0, turretTurn: 0, fire: true }'
    : preset.id === 'medium'
      ? '{ throttle: 1, bodyTurn: 0, turretTurn: 1, fire: true }'
      : '{ throttle: 1, bodyTurn: 1, turretTurn: 0, fire: true }';
  return createSavedBuildV2({
    buildId: `friend-${preset.id}`,
    label: preset.label,
    bot: {
      artifactId: `friend-${preset.id}-bot`,
      version: '1.0.0',
      language: 'javascript',
      entryPoint: `${preset.id}.js`,
      source: `module.exports = () => ({ onTick() { return ${behavior}; } });`,
    },
    loadout,
  }, { revision: 1, parentFingerprint: null, createdAt });
}
