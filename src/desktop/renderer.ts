import {
  FriendRoomBrowserConnectionV1,
  createDefaultFriendRoomIceProfileV1,
  type FriendRoomRoleV1,
} from '../friend-room/browser-connection-v1.js';
import {
  FriendRoomEntryControllerV1,
  type FriendRoomEntrySnapshotV1,
} from './friend-room-entry-controller-v1.js';
import type { FriendRoomSnapshotV1 } from '../friend-room/session-v1.js';
import type {
  DesktopFriendRoomEventV1,
  DesktopFriendRoomStartV1,
  FriendRoomPresetIdV1,
} from './friend-room-runtime-v1.js';

declare global {
  interface Window {
    agenticGameDesktop?: {
      copyText(text: string): void;
      friendRoom: {
        start(input: DesktopFriendRoomStartV1): Promise<void>;
        receivePeer(payload: string): void;
        selectPreset(presetId: FriendRoomPresetIdV1): Promise<void>;
        setReady(ready: boolean): Promise<void>;
        reset(): Promise<void>;
        onPeerPayload(listener: (payload: string) => void): void;
        onEvent(listener: (event: DesktopFriendRoomEventV1) => void): void;
      };
    };
  }
}

let activeConnection: FriendRoomBrowserConnectionV1 | undefined;
let activeSessionId: string | undefined;
let roomRuntimeStarted = false;
let unsubscribePeerMessages: (() => void) | undefined;
let lastRoomSnapshot: FriendRoomSnapshotV1 | undefined;

const controller = new FriendRoomEntryControllerV1({
  createConnection: (role: FriendRoomRoleV1) => {
    activeConnection = new FriendRoomBrowserConnectionV1({
      role,
      ice: createDefaultFriendRoomIceProfileV1(),
    });
    return activeConnection;
  },
  createSessionId: () => {
    activeSessionId = `friend-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
    return activeSessionId;
  },
});

const element = <T extends HTMLElement>(id: string): T => {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing desktop UI element: ${id}`);
  return value as T;
};

const hostName = element<HTMLInputElement>('host-name');
const guestName = element<HTMLInputElement>('guest-name');
const invitationInput = element<HTMLTextAreaElement>('invitation-input');
const confirmationInput = element<HTMLTextAreaElement>('confirmation-input');
const invitationResult = element<HTMLTextAreaElement>('invitation-result');
const confirmationResult = element<HTMLTextAreaElement>('confirmation-result');
const hostFollowup = element<HTMLElement>('host-followup');
const guestFollowup = element<HTMLElement>('guest-followup');
const statusCard = element<HTMLElement>('status-card');
const statusEyebrow = element<HTMLElement>('status-eyebrow');
const statusTitle = element<HTMLElement>('status-title');
const statusDetail = element<HTMLElement>('status-detail');
const toast = element<HTMLElement>('toast');
const roomColumns = element<HTMLElement>('room-columns');
const prepSection = element<HTMLElement>('prep-section');
const prepState = element<HTMLElement>('prep-state');
const presetSelect = element<HTMLSelectElement>('preset-select');
const readyMatch = element<HTMLButtonElement>('ready-match');
const resultPanel = element<HTMLElement>('result-panel');

let currentSnapshot: FriendRoomEntrySnapshotV1 = controller.getSnapshot();

controller.subscribe((snapshot) => {
  currentSnapshot = snapshot;
  statusCard.dataset.tone = snapshot.playerStatus.tone;
  statusEyebrow.textContent = snapshot.playerStatus.eyebrow;
  statusTitle.textContent = snapshot.playerStatus.title;
  statusDetail.textContent = snapshot.playerStatus.detail;
  hostFollowup.hidden = !snapshot.invitationCard;
  guestFollowup.hidden = !snapshot.joinConfirmation;
  if (snapshot.invitationCard) invitationResult.value = snapshot.invitationCard;
  if (snapshot.joinConfirmation) confirmationResult.value = snapshot.joinConfirmation;
  if (snapshot.playerStatus.tone === 'success') void enterBattlePreparation(snapshot);
});

window.agenticGameDesktop?.friendRoom.onPeerPayload((payload) => {
  const peer = activeConnection?.getPeer();
  if (peer?.getReadyState() === 'open') peer.send(payload);
});

window.agenticGameDesktop?.friendRoom.onEvent((event) => {
  if (event.kind === 'error') {
    showToast(event.message ?? '好友房间发生错误', true);
    return;
  }
  if (event.snapshot) renderRoomSnapshot(event.snapshot);
});

element<HTMLButtonElement>('create-room').addEventListener('click', () => {
  void runAction(() => controller.createRoom(hostName.value));
});

element<HTMLButtonElement>('join-room').addEventListener('click', () => {
  void runAction(() => controller.joinRoom(guestName.value, invitationInput.value));
});

element<HTMLButtonElement>('confirm-friend').addEventListener('click', () => {
  void runAction(() => controller.confirmFriend(confirmationInput.value));
});

element<HTMLButtonElement>('copy-invitation').addEventListener('click', () => {
  copyText(currentSnapshot.invitationCard ?? '', '邀请卡已复制');
});

element<HTMLButtonElement>('copy-confirmation').addEventListener('click', () => {
  copyText(currentSnapshot.joinConfirmation ?? '', '加入确认已复制');
});

element<HTMLButtonElement>('lock-preset').addEventListener('click', () => {
  void runAction(async () => {
    await window.agenticGameDesktop?.friendRoom.selectPreset(presetSelect.value as FriendRoomPresetIdV1);
    showToast('战术已锁定', false);
  });
});

readyMatch.addEventListener('click', () => {
  void runAction(async () => {
    const mine = lastRoomSnapshot?.participants.find((item) => item.seat === currentSnapshot.role);
    await window.agenticGameDesktop?.friendRoom.setReady(!mine?.ready);
  });
});

element<HTMLButtonElement>('reset-room').addEventListener('click', () => void resetRoom());

async function runAction(action: () => Promise<void>): Promise<void> {
  setBusy(true);
  try {
    await action();
  } catch (error) {
    showToast(error instanceof Error ? error.message : '操作失败，请重试', true);
  } finally {
    setBusy(false);
  }
}

function setBusy(busy: boolean): void {
  document.querySelectorAll<HTMLButtonElement>('button[data-action]').forEach((button) => {
    button.disabled = busy;
  });
}

function copyText(text: string, message: string): void {
  if (!text) return;
  if (window.agenticGameDesktop) window.agenticGameDesktop.copyText(text);
  else void navigator.clipboard.writeText(text);
  showToast(message, false);
}

function showToast(message: string, danger: boolean): void {
  toast.textContent = message;
  toast.dataset.danger = String(danger);
  toast.classList.add('visible');
  window.setTimeout(() => toast.classList.remove('visible'), 2600);
}

async function enterBattlePreparation(snapshot: FriendRoomEntrySnapshotV1): Promise<void> {
  if (roomRuntimeStarted || !snapshot.role || !window.agenticGameDesktop || !activeConnection) return;
  const peer = activeConnection.getPeer();
  if (!peer) return;
  roomRuntimeStarted = true;
  unsubscribePeerMessages = peer.subscribe((payload) => {
    window.agenticGameDesktop?.friendRoom.receivePeer(payload);
  });
  try {
    await window.agenticGameDesktop.friendRoom.start({
      role: snapshot.role,
      displayName: snapshot.nickname,
      ...(snapshot.role === 'host' ? { sessionId: activeSessionId } : {}),
    });
    roomColumns.hidden = true;
    prepSection.hidden = false;
  } catch (error) {
    roomRuntimeStarted = false;
    unsubscribePeerMessages?.();
    unsubscribePeerMessages = undefined;
    showToast(error instanceof Error ? error.message : '无法进入战前准备', true);
  }
}

function renderRoomSnapshot(snapshot: FriendRoomSnapshotV1): void {
  lastRoomSnapshot = snapshot;
  roomColumns.hidden = true;
  prepSection.hidden = false;
  const host = snapshot.participants.find((item) => item.seat === 'host');
  const guest = snapshot.participants.find((item) => item.seat === 'guest');
  renderParticipant('host', host);
  renderParticipant('guest', guest);

  const mine = snapshot.participants.find((item) => item.seat === currentSnapshot.role);
  readyMatch.textContent = mine?.ready ? '取消准备' : '准备出战';
  const locked = snapshot.status === 'running' || snapshot.status === 'complete' || snapshot.status === 'failed';
  presetSelect.disabled = locked || Boolean(mine?.ready);
  element<HTMLButtonElement>('lock-preset').disabled = locked || Boolean(mine?.ready);
  readyMatch.disabled = locked || !mine?.build;

  if (snapshot.status === 'running') {
    prepState.textContent = '战斗进行中';
    setPlayerStatus('比赛已经开始', '房主正在裁定本场战斗', '战报完成后会自动同步给双方。', 'waiting');
  } else if (snapshot.status === 'complete' && snapshot.result) {
    prepState.textContent = '比赛已结束';
    const winner = snapshot.result.winningSeats.length === 0
      ? '本场平局'
      : snapshot.result.winningSeats.includes(currentSnapshot.role ?? 'host') ? '你赢得了比赛' : '好友赢得了比赛';
    element<HTMLElement>('result-title').textContent = winner;
    element<HTMLElement>('result-detail').textContent = `战斗持续 ${snapshot.result.ticks} 回合 · 双方剩余耐久 ${snapshot.result.hp[0]} : ${snapshot.result.hp[1]}`;
    resultPanel.hidden = false;
    setPlayerStatus('本场战报', winner, '完整比赛结果已经同步到双方设备。', 'success');
  } else if (snapshot.status === 'failed') {
    prepState.textContent = '比赛未完成';
    setPlayerStatus('比赛未完成', '请重新创建好友房间', snapshot.error ?? '房主设备未能完成比赛。', 'danger');
  } else {
    const readyCount = snapshot.participants.filter((item) => item.ready).length;
    prepState.textContent = `${readyCount} / 2 已准备`;
    setPlayerStatus('战前准备', '选择战术并准备出战', '双方准备完成后，比赛会自动开始。', 'waiting');
  }
}

function renderParticipant(seat: 'host' | 'guest', participant: FriendRoomSnapshotV1['participants'][number] | undefined): void {
  element<HTMLElement>(`${seat}-player-name`).textContent = participant?.displayName ?? (seat === 'host' ? '等待房主' : '等待好友');
  element<HTMLElement>(`${seat}-player-build`).textContent = participant?.build?.label ?? '尚未选择战术';
  const readiness = element<HTMLElement>(`${seat}-player-ready`);
  readiness.textContent = participant?.ready ? '已准备' : '准备中';
  readiness.classList.toggle('ready', Boolean(participant?.ready));
}

function setPlayerStatus(eyebrow: string, title: string, detail: string, tone: string): void {
  statusCard.dataset.tone = tone;
  statusEyebrow.textContent = eyebrow;
  statusTitle.textContent = title;
  statusDetail.textContent = detail;
}

async function resetRoom(): Promise<void> {
  unsubscribePeerMessages?.();
  unsubscribePeerMessages = undefined;
  roomRuntimeStarted = false;
  activeSessionId = undefined;
  activeConnection = undefined;
  lastRoomSnapshot = undefined;
  await window.agenticGameDesktop?.friendRoom.reset();
  prepSection.hidden = true;
  resultPanel.hidden = true;
  roomColumns.hidden = false;
  controller.reset();
}
