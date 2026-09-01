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
import type { DesktopApiV1 } from './desktop-api-v1.js';
import { DesktopAppShellControllerV1 } from './renderer/app-shell-controller-v1.js';
import { OnboardingControllerV1 } from './renderer/onboarding-controller-v1.js';
import { desktopApiClientV1 } from './renderer/desktop-api-client-v1.js';
import { renderAppShellV1 } from './renderer/app-shell-view-v1.js';
import { renderOnboardingV1 } from './renderer/onboarding-view-v1.js';
import { GarageControllerV1 } from './renderer/garage-controller-v1.js';
import { PracticeLabControllerV1 } from './renderer/practice-lab-controller-v1.js';
import { renderGarageLoadoutPreviewV1, renderGarageViewV1 } from './renderer/garage-view-v1.js';
import { renderPracticeLabV1 } from './renderer/practice-lab-view-v1.js';
import type { GarageSaveInputV1 } from './garage-service-v1.js';
import type { PracticeRunInputV1 } from './practice-match-service-v1.js';
import { ReplayLibraryControllerV1 } from './renderer/replay-library-controller-v1.js';
import { UnifiedReplayControllerV1 } from './renderer/unified-replay-controller-v1.js';
import { renderReplayLibraryV1 } from './renderer/replay-library-view-v1.js';
import { buildUnifiedReplayViewV1, renderUnifiedReplayFrameV1 } from './renderer/unified-replay-view-v1.js';
import type { ReplayLibraryFilterV1, ReplaySourceV1 } from './replay-library-service-v1.js';

declare global {
  interface Window {
    agenticGameDesktop?: DesktopApiV1 & {
      copyText(text: string): void;
      friendRoom: {
        start(input: DesktopFriendRoomStartV1): Promise<void>;
        receivePeer(payload: string): void;
        selectPreset(presetId: FriendRoomPresetIdV1): Promise<void>;
        setReady(ready: boolean): Promise<void>;
        requestRematch(): Promise<void>;
        transportClosed(): Promise<void>;
        resumeTransport(): Promise<void>;
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
let recoveryActive = false;
let replayTimer: number | undefined;
const replayController = new UnifiedReplayControllerV1();
const libraryReplayController = new UnifiedReplayControllerV1();
let libraryReplayTimer: number | undefined;
let pendingReplayDelete: { replayId: string; source: ReplaySourceV1 } | undefined;

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
const connectionPill = element<HTMLElement>('connection-pill');
const connectionLabel = element<HTMLElement>('connection-label');
const toast = element<HTMLElement>('toast');
const roomColumns = element<HTMLElement>('room-columns');
const prepSection = element<HTMLElement>('prep-section');
const prepState = element<HTMLElement>('prep-state');
const presetSelect = element<HTMLSelectElement>('preset-select');
const readyMatch = element<HTMLButtonElement>('ready-match');
const resultPanel = element<HTMLElement>('result-panel');
const rematchButton = element<HTMLButtonElement>('rematch-button');
const viewReplayButton = element<HTMLButtonElement>('view-replay-button');
const prepLobby = element<HTMLElement>('prep-lobby');
const replayPanel = element<HTMLElement>('replay-panel');
const replayBattlefield = element<HTMLElement>('replay-battlefield');
const replayTimeline = element<HTMLInputElement>('replay-timeline');
const replayPlay = element<HTMLButtonElement>('replay-play');
const replayTick = element<HTMLElement>('replay-tick');
const replayRoster = element<HTMLElement>('replay-roster');
const replayObjective = element<HTMLElement>('replay-objective');
const replayMoments = element<HTMLElement>('replay-moments');
const recoveryPanel = element<HTMLElement>('recovery-panel');
const recoveryHost = element<HTMLElement>('recovery-host');
const recoveryGuest = element<HTMLElement>('recovery-guest');
const recoveryInvitationResult = element<HTMLTextAreaElement>('recovery-invitation-result');
const recoveryInvitationInput = element<HTMLTextAreaElement>('recovery-invitation-input');
const recoveryConfirmationResult = element<HTMLTextAreaElement>('recovery-confirmation-result');
const recoveryConfirmationInput = element<HTMLTextAreaElement>('recovery-confirmation-input');

const desktopApi = desktopApiClientV1(window);
const appShellController = new DesktopAppShellControllerV1(desktopApi, ['command-center', 'garage', 'practice', 'friend-room', 'replays']);
const onboardingController = new OnboardingControllerV1(desktopApi);
const garageController = new GarageControllerV1(desktopApi);
const practiceLabController = new PracticeLabControllerV1(desktopApi);
const replayLibraryController = new ReplayLibraryControllerV1(desktopApi.replays);

garageController.subscribe((snapshot) => {
  renderGarageViewV1(snapshot);
  if (snapshot.garage) practiceLabController.setGarage(snapshot.garage);
  renderPracticeLabV1(practiceLabController.getSnapshot(), snapshot.garage);
});
practiceLabController.subscribe((snapshot) => {
  renderPracticeLabV1(snapshot, garageController.getSnapshot().garage);
});

element<HTMLButtonElement>('nav-command-center').addEventListener('click', () => void navigateApp('command-center'));
element<HTMLButtonElement>('nav-garage').addEventListener('click', () => void navigateApp('garage'));
element<HTMLButtonElement>('nav-practice').addEventListener('click', () => void navigateApp('practice'));
element<HTMLButtonElement>('nav-friend-room').addEventListener('click', () => void navigateApp('friend-room'));
element<HTMLButtonElement>('nav-replays').addEventListener('click', () => void navigateApp('replays'));
element<HTMLButtonElement>('command-quick-practice').addEventListener('click', () => void navigateApp('practice'));
element<HTMLButtonElement>('command-open-garage').addEventListener('click', () => void navigateApp('garage'));
element<HTMLButtonElement>('command-open-friend-room').addEventListener('click', () => void navigateApp('friend-room'));
element<HTMLButtonElement>('command-open-replays').addEventListener('click', () => void navigateApp('replays'));
element<HTMLButtonElement>('practice-open-garage').addEventListener('click', () => void navigateApp('garage'));
element<HTMLSelectElement>('garage-vehicle').addEventListener('change', () => {
  const garage = garageController.getSnapshot().garage;
  if (garage) renderGarageLoadoutPreviewV1(garage);
});
element<HTMLButtonElement>('garage-save').addEventListener('click', () => {
  void runGarageAction(async () => {
    await garageController.save(readGarageInput());
    if (!garageController.getSnapshot().error) showToast('新版本已保存', false);
  });
});
element<HTMLButtonElement>('garage-quarantine').addEventListener('click', () => {
  void runGarageAction(async () => {
    await garageController.quarantine();
    if (!garageController.getSnapshot().error) showToast('损坏版本已安全隔离', false);
  });
});
element<HTMLButtonElement>('garage-export-diagnostic').addEventListener('click', () => {
  void runGarageAction(async () => {
    const fileName = await garageController.exportDiagnostic();
    if (fileName) showToast(`检查报告已保存：${fileName}`, false);
  });
});
element<HTMLButtonElement>('practice-run-versus').addEventListener('click', () => void runPracticeLab(false));
element<HTMLButtonElement>('practice-run-mirror').addEventListener('click', () => void runPracticeLab(true));
element<HTMLButtonElement>('practice-run-again').addEventListener('click', () => void runPracticeLab(false));
for (const id of ['replay-filter-source', 'replay-filter-mode', 'replay-filter-outcome']) {
  element<HTMLSelectElement>(id).addEventListener('change', () => void refreshReplayFilters());
}
element<HTMLInputElement>('replay-filter-query').addEventListener('change', () => void refreshReplayFilters());
element<HTMLButtonElement>('replay-empty-practice').addEventListener('click', () => void navigateApp('practice'));
element<HTMLButtonElement>('replay-export-diagnostic').addEventListener('click', () => void runReplayLibraryAction(async () => {
  const filename = await desktopApi.replays.exportDiagnostic();
  showToast(`检查报告已保存：${filename}`, false);
}));
element<HTMLElement>('replay-library-cards').addEventListener('click', (event) => void handleReplayCardAction(event));
element<HTMLElement>('replay-trash-list').addEventListener('click', (event) => void handleReplayTrashAction(event));
element<HTMLButtonElement>('replay-open-trash').addEventListener('click', () => showReplayTrash(true));
element<HTMLButtonElement>('replay-close-trash').addEventListener('click', () => showReplayTrash(false));
element<HTMLButtonElement>('replay-request-empty-trash').addEventListener('click', () => {
  element('replay-empty-trash-sheet').hidden = false;
});
element<HTMLButtonElement>('replay-cancel-empty-trash').addEventListener('click', () => {
  element('replay-empty-trash-sheet').hidden = true;
});
element<HTMLButtonElement>('replay-confirm-empty-trash').addEventListener('click', () => void runReplayLibraryAction(async () => {
  await replayLibraryController.emptyTrash();
  element('replay-empty-trash-sheet').hidden = true;
  showToast('回收站已清空', false);
}));
element<HTMLButtonElement>('replay-cancel-delete').addEventListener('click', () => closeReplayDeleteSheet());
element<HTMLButtonElement>('replay-confirm-delete').addEventListener('click', () => void confirmReplayDelete());
element<HTMLButtonElement>('replay-library-close-player').addEventListener('click', () => closeLibraryReplay());
element<HTMLButtonElement>('replay-library-previous').addEventListener('click', () => stepLibraryReplay(-1));
element<HTMLButtonElement>('replay-library-next').addEventListener('click', () => stepLibraryReplay(1));
element<HTMLButtonElement>('replay-library-play').addEventListener('click', () => toggleLibraryReplay());
element<HTMLInputElement>('replay-library-timeline').addEventListener('input', () => {
  stopLibraryReplayTimer();
  libraryReplayController.seek(Number(element<HTMLInputElement>('replay-library-timeline').value));
  renderUnifiedReplayFrameV1(libraryReplayController, 'replay-library');
});
element<HTMLButtonElement>('onboarding-name-next').addEventListener('click', () => {
  try {
    onboardingController.enterCommanderName(element<HTMLInputElement>('onboarding-name').value);
    renderOnboardingV1(onboardingController.getSnapshot(), true);
  } catch (error) {
    showToast(error instanceof Error ? error.message : '请输入指挥官昵称', true);
  }
});
document.querySelectorAll<HTMLButtonElement>('[data-doctrine]').forEach((button) => {
  button.addEventListener('click', () => void runOnboardingAction(async () => {
    await onboardingController.chooseDoctrine(button.dataset.doctrine as 'scout' | 'medium' | 'heavy');
  }));
});
element<HTMLButtonElement>('onboarding-run-battle').addEventListener('click', () => void runOnboardingBattle());
element<HTMLButtonElement>('onboarding-finish').addEventListener('click', () => void runOnboardingAction(async () => {
  await onboardingController.finishReplay();
  await appShellController.bootstrap();
}));

void initializeApplicationShell();

let currentSnapshot: FriendRoomEntrySnapshotV1 = controller.getSnapshot();

controller.subscribe((snapshot) => {
  currentSnapshot = snapshot;
  statusCard.dataset.tone = snapshot.playerStatus.tone;
  statusEyebrow.textContent = snapshot.playerStatus.eyebrow;
  statusTitle.textContent = snapshot.playerStatus.title;
  statusDetail.textContent = snapshot.playerStatus.detail;
  hostFollowup.hidden = !snapshot.invitationCard;
  guestFollowup.hidden = !snapshot.joinConfirmation;
  if (snapshot.invitationCard) {
    if (roomRuntimeStarted) recoveryInvitationResult.value = snapshot.invitationCard;
    else invitationResult.value = snapshot.invitationCard;
  }
  if (snapshot.joinConfirmation) {
    if (roomRuntimeStarted) recoveryConfirmationResult.value = snapshot.joinConfirmation;
    else confirmationResult.value = snapshot.joinConfirmation;
  }
  const connectionState = activeConnection?.getState();
  if (roomRuntimeStarted && !recoveryActive && (connectionState === 'disconnected' || connectionState === 'failed')) {
    recoveryActive = true;
    unsubscribePeerMessages?.();
    unsubscribePeerMessages = undefined;
    void window.agenticGameDesktop?.friendRoom.transportClosed();
  }
  renderRecoveryPanel();
  if (connectionState === 'connected' && (!roomRuntimeStarted || recoveryActive)) {
    void enterBattlePreparation(snapshot);
  }
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

rematchButton.addEventListener('click', () => {
  void runAction(async () => {
    await window.agenticGameDesktop?.friendRoom.requestRematch();
  });
});

viewReplayButton.addEventListener('click', () => {
  void runAction(async () => openReplay());
});

element<HTMLButtonElement>('close-replay-button').addEventListener('click', () => closeReplay());
element<HTMLButtonElement>('replay-previous').addEventListener('click', () => stepReplay(-1));
element<HTMLButtonElement>('replay-next').addEventListener('click', () => stepReplay(1));
replayPlay.addEventListener('click', () => toggleReplayPlayback());
replayTimeline.addEventListener('input', () => {
  stopReplayTimer();
  replayController.seek(Number(replayTimeline.value));
  renderReplayFrame();
});

element<HTMLButtonElement>('create-recovery-invite').addEventListener('click', () => {
  void runAction(async () => {
    const sessionId = requireCurrentRoom();
    detachPeerMessages();
    await controller.createRecoveryInvite(sessionId);
  });
});

element<HTMLButtonElement>('copy-recovery-invitation').addEventListener('click', () => {
  copyText(recoveryInvitationResult.value, '会合邀请已复制');
});

element<HTMLButtonElement>('confirm-recovery-friend').addEventListener('click', () => {
  void runAction(() => controller.confirmFriend(recoveryConfirmationInput.value));
});

element<HTMLButtonElement>('accept-recovery-invite').addEventListener('click', () => {
  void runAction(async () => {
    const sessionId = requireCurrentRoom();
    detachPeerMessages();
    await controller.acceptRecoveryInvite(recoveryInvitationInput.value, sessionId);
  });
});

element<HTMLButtonElement>('copy-recovery-confirmation').addEventListener('click', () => {
  copyText(recoveryConfirmationResult.value, '会合确认已复制');
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
  if (!snapshot.role || !window.agenticGameDesktop || !activeConnection) return;
  const peer = activeConnection.getPeer();
  if (!peer) return;
  const resuming = roomRuntimeStarted;
  detachPeerMessages();
  unsubscribePeerMessages = peer.subscribe((payload) => {
    window.agenticGameDesktop?.friendRoom.receivePeer(payload);
  });
  try {
    if (resuming) await window.agenticGameDesktop.friendRoom.resumeTransport();
    else {
      await window.agenticGameDesktop.friendRoom.start({
        role: snapshot.role,
        displayName: snapshot.nickname,
        ...(snapshot.role === 'host' ? { sessionId: activeSessionId } : {}),
      });
      roomRuntimeStarted = true;
    }
    recoveryActive = false;
    recoveryPanel.hidden = true;
    roomColumns.hidden = true;
    prepSection.hidden = false;
  } catch (error) {
    if (!resuming) roomRuntimeStarted = false;
    else recoveryActive = true;
    detachPeerMessages();
    showToast(error instanceof Error ? error.message : '无法进入战前准备', true);
  }
}

function renderRoomSnapshot(snapshot: FriendRoomSnapshotV1): void {
  lastRoomSnapshot = snapshot;
  if (snapshot.status !== 'complete' && replayController.getSnapshot().open) resetReplayView();
  roomColumns.hidden = true;
  prepSection.hidden = false;
  const host = snapshot.participants.find((item) => item.seat === 'host');
  const guest = snapshot.participants.find((item) => item.seat === 'guest');
  renderParticipant('host', host);
  renderParticipant('guest', guest);

  const mine = snapshot.participants.find((item) => item.seat === currentSnapshot.role);
  resultPanel.hidden = true;
  readyMatch.textContent = mine?.ready ? '取消准备' : '准备出战';
  const locked = recoveryActive || snapshot.status === 'running' || snapshot.status === 'complete' || snapshot.status === 'failed';
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
    rematchButton.textContent = mine?.rematchRequested ? '等待好友确认' : '再来一局';
    rematchButton.disabled = Boolean(mine?.rematchRequested);
    viewReplayButton.disabled = !snapshot.replay;
    resultPanel.hidden = false;
    const someoneWantsRematch = snapshot.participants.some((item) => item.rematchRequested);
    setPlayerStatus(
      '本场战报',
      winner,
      someoneWantsRematch ? '一方已经发起再来一局，等待另一方确认。' : '完整比赛结果已经同步到双方设备。',
      'success',
    );
  } else if (snapshot.status === 'failed') {
    prepState.textContent = '比赛未完成';
    setPlayerStatus('比赛未完成', '请重新创建好友房间', snapshot.error ?? '房主设备未能完成比赛。', 'danger');
  } else {
    const readyCount = snapshot.participants.filter((item) => item.ready).length;
    prepState.textContent = `${readyCount} / 2 已准备`;
    setPlayerStatus('战前准备', '选择战术并准备出战', '双方准备完成后，比赛会自动开始。', 'waiting');
  }
  renderRecoveryPanel();
}

function renderParticipant(seat: 'host' | 'guest', participant: FriendRoomSnapshotV1['participants'][number] | undefined): void {
  element<HTMLElement>(`${seat}-player-name`).textContent = participant?.displayName ?? (seat === 'host' ? '等待房主' : '等待好友');
  element<HTMLElement>(`${seat}-player-build`).textContent = participant?.build?.label ?? '尚未选择战术';
  const readiness = element<HTMLElement>(`${seat}-player-ready`);
  readiness.textContent = participant && !participant.connected ? '暂时离线' : participant?.ready ? '已准备' : '准备中';
  readiness.classList.toggle('ready', Boolean(participant?.ready));
}

function renderRecoveryPanel(): void {
  recoveryPanel.hidden = !recoveryActive;
  connectionPill.dataset.state = recoveryActive ? 'offline' : 'online';
  connectionLabel.textContent = recoveryActive ? '好友暂时离线' : '好友直连';
  recoveryHost.hidden = currentSnapshot.role !== 'host';
  recoveryGuest.hidden = currentSnapshot.role !== 'guest';
  if (!recoveryActive) return;
  setPlayerStatus(
    '好友暂时离线',
    '重新与好友会合',
    currentSnapshot.role === 'host'
      ? '生成新的会合邀请，好友确认后即可回到原房间。'
      : '等待房主发来新的会合邀请，原有战术和战报不会丢失。',
    'danger',
  );
  presetSelect.disabled = true;
  element<HTMLButtonElement>('lock-preset').disabled = true;
  readyMatch.disabled = true;
  rematchButton.disabled = true;
}

function openReplay(): void {
  const replay = lastRoomSnapshot?.replay;
  if (!replay) throw new Error('本场比赛还没有可用回放');
  replayController.open(replay);
  prepLobby.hidden = true;
  replayPanel.hidden = false;
  element<HTMLElement>('replay-title').textContent = replay.participants.map((item) => item.displayName).join(' vs ');
  element<HTMLElement>('replay-subtitle').textContent = `${replay.modeName} · ${replay.map.id} · 逐回合完整战术记录`;
  buildReplayMap();
  renderReplayFrame();
  setPlayerStatus('完整回放', `${replay.modeName} · ${replay.result.ticks} 回合`, '拖动时间轴或播放，逐回合查看双方战术执行。', 'success');
  replayPanel.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function closeReplay(): void {
  resetReplayView();
  if (lastRoomSnapshot) renderRoomSnapshot(lastRoomSnapshot);
}

function resetReplayView(): void {
  stopReplayTimer();
  replayController.close();
  replayPanel.hidden = true;
  prepLobby.hidden = false;
}

function buildReplayMap(): void {
  const snapshot = replayController.getSnapshot();
  const replay = snapshot.replay;
  if (!replay) return;
  replayBattlefield.replaceChildren();
  replayBattlefield.style.setProperty('--map-width', String(replay.map.width));
  replayBattlefield.style.aspectRatio = `${replay.map.width} / ${replay.map.height}`;
  for (const cell of replay.map.terrainCells) {
    const node = document.createElement('span');
    node.className = `replay-cell terrain-${cell.terrainId}`;
    if (replay.map.captureZones.some((zone) => (
      cell.x >= zone.x && cell.x < zone.x + zone.width && cell.y >= zone.y && cell.y < zone.y + zone.height
    ))) node.classList.add('capture-zone');
    node.style.gridColumn = String(cell.x + 1);
    node.style.gridRow = String(cell.y + 1);
    replayBattlefield.append(node);
  }
  replayTimeline.max = String(replay.frames.length - 1);
  replayRoster.replaceChildren(...replay.participants.map((participant) => {
    const node = document.createElement('article');
    node.className = `replay-player team-${participant.teamId}`;
    const name = document.createElement('b');
    name.textContent = participant.displayName;
    const loadout = document.createElement('span');
    loadout.textContent = `${participant.vehicleName} · ${participant.weaponName}`;
    node.append(name, loadout);
    return node;
  }));
  replayMoments.replaceChildren(...replay.moments.map((moment) => {
    const node = document.createElement('article');
    node.className = 'replay-moment';
    node.dataset.tick = String(moment.tick);
    const title = document.createElement('b');
    title.textContent = `${moment.tick} 回合 · ${moment.title}`;
    const summary = document.createElement('span');
    summary.textContent = moment.summary;
    node.append(title, summary);
    return node;
  }));
}

function renderReplayFrame(): void {
  const snapshot = replayController.getSnapshot();
  if (!snapshot.open || !snapshot.replay || !snapshot.frame) return;
  replayBattlefield.querySelectorAll('.replay-entity').forEach((node) => node.remove());
  for (const tank of snapshot.frame.tanks) {
    const node = document.createElement('span');
    node.className = `replay-entity replay-tank team-${tank.teamId}${tank.alive ? '' : ' destroyed'}`;
    node.style.gridColumn = String(tank.x + 1);
    node.style.gridRow = String(tank.y + 1);
    node.style.transform = `rotate(${tank.bodyDirection * 45}deg)`;
    node.title = `${tank.displayName} · ${tank.hp}/${tank.maxHp} 耐久`;
    const turret = document.createElement('i');
    turret.style.transform = `translateX(-50%) rotate(${(tank.turretDirection - tank.bodyDirection) * 45}deg)`;
    node.append(turret);
    replayBattlefield.append(node);
  }
  for (const projectile of snapshot.frame.projectiles) {
    const node = document.createElement('span');
    node.className = 'replay-entity replay-projectile';
    node.style.gridColumn = String(projectile.x + 1);
    node.style.gridRow = String(projectile.y + 1);
    replayBattlefield.append(node);
  }
  const tankByTeam = new Map(snapshot.frame.tanks.map((tank) => [tank.teamId, tank]));
  replayRoster.querySelectorAll<HTMLElement>('.replay-player').forEach((node) => {
    node.querySelector('meter')?.remove();
    const teamId = node.classList.contains('team-historical') ? 'historical' : 'current';
    const tank = tankByTeam.get(teamId);
    if (!tank) return;
    const meter = document.createElement('meter');
    meter.min = 0;
    meter.max = tank.maxHp;
    meter.value = Math.max(0, tank.hp);
    meter.title = `${tank.hp} / ${tank.maxHp} 耐久 · ${tank.ammunition} 发弹药`;
    node.append(meter);
  });
  replayTimeline.value = String(snapshot.frameIndex);
  replayTick.textContent = `第 ${snapshot.frame.tick} 回合`;
  replayPlay.textContent = snapshot.playing ? '暂停' : '播放';
  replayObjective.textContent = snapshot.frame.objective
    ? snapshot.frame.objective.contested
      ? '目标区域争夺中'
      : snapshot.frame.objective.capturingTeamId
        ? `占领进度 ${snapshot.frame.objective.progress} / ${snapshot.frame.objective.required}`
        : '目标区域无人占领'
    : '歼灭对方战车';
  replayMoments.querySelectorAll<HTMLElement>('.replay-moment').forEach((node) => {
    node.classList.toggle('active', Number(node.dataset.tick) === snapshot.frame!.tick);
  });
}

function stepReplay(delta: -1 | 1): void {
  stopReplayTimer();
  const snapshot = replayController.getSnapshot();
  if (!snapshot.open || !snapshot.replay) return;
  const target = Math.max(0, Math.min(snapshot.replay.frames.length - 1, snapshot.frameIndex + delta));
  replayController.seek(target);
  renderReplayFrame();
}

function toggleReplayPlayback(): void {
  const snapshot = replayController.getSnapshot();
  if (!snapshot.open) return;
  if (snapshot.playing) {
    replayController.pause();
    stopReplayTimer();
    renderReplayFrame();
    return;
  }
  replayController.play();
  stopReplayTimer();
  replayTimer = window.setInterval(() => {
    const stillPlaying = replayController.advance();
    renderReplayFrame();
    if (!stillPlaying) stopReplayTimer();
  }, 260);
  renderReplayFrame();
}

function stopReplayTimer(): void {
  if (replayTimer !== undefined) window.clearInterval(replayTimer);
  replayTimer = undefined;
}

function requireCurrentRoom(): string {
  const sessionId = lastRoomSnapshot?.sessionId;
  if (!sessionId) throw new Error('当前好友房间尚未准备好');
  return sessionId;
}

function detachPeerMessages(): void {
  unsubscribePeerMessages?.();
  unsubscribePeerMessages = undefined;
}

function setPlayerStatus(eyebrow: string, title: string, detail: string, tone: string): void {
  statusCard.dataset.tone = tone;
  statusEyebrow.textContent = eyebrow;
  statusTitle.textContent = title;
  statusDetail.textContent = detail;
}

async function resetRoom(): Promise<void> {
  detachPeerMessages();
  resetReplayView();
  roomRuntimeStarted = false;
  recoveryActive = false;
  activeSessionId = undefined;
  activeConnection = undefined;
  lastRoomSnapshot = undefined;
  await window.agenticGameDesktop?.friendRoom.reset();
  prepSection.hidden = true;
  resultPanel.hidden = true;
  recoveryPanel.hidden = true;
  roomColumns.hidden = false;
  controller.reset();
}

async function initializeApplicationShell(): Promise<void> {
  try {
    const bootstrap = await desktopApi.app.bootstrap();
    const onboarding = onboardingController.initialize(bootstrap);
    renderOnboardingV1(onboardingController.getSnapshot(), bootstrap.needsOnboarding);
    await onboarding;
    await appShellController.bootstrap();
    renderAppShellV1(appShellController.getSnapshot());
    await ensurePageData(appShellController.getSnapshot().page);
    renderOnboardingV1(onboardingController.getSnapshot(), bootstrap.needsOnboarding);
  } catch (error) {
    showToast(error instanceof Error ? error.message : '游戏启动失败，请重新打开。', true);
  }
}

async function navigateApp(page: 'command-center' | 'garage' | 'practice' | 'friend-room' | 'replays'): Promise<void> {
  try {
    await appShellController.navigate(page);
    renderAppShellV1(appShellController.getSnapshot());
    await ensurePageData(page);
  } catch (error) {
    showToast(error instanceof Error ? error.message : '暂时无法打开该区域', true);
  }
}

async function ensurePageData(page: 'command-center' | 'garage' | 'practice' | 'friend-room' | string): Promise<void> {
  if (page === 'replays') {
    await replayLibraryController.initialize();
    renderReplayLibraryV1(replayLibraryController.getSnapshot());
    return;
  }
  if (page !== 'garage' && page !== 'practice') return;
  if (!garageController.getSnapshot().garage && garageController.getSnapshot().status !== 'loading') {
    await garageController.load();
  }
}

function readReplayFilter(): ReplayLibraryFilterV1 {
  const source = element<HTMLSelectElement>('replay-filter-source').value;
  const modeId = element<HTMLSelectElement>('replay-filter-mode').value;
  const outcome = element<HTMLSelectElement>('replay-filter-outcome').value;
  const query = element<HTMLInputElement>('replay-filter-query').value.trim();
  return {
    ...(source ? { source: source as ReplaySourceV1 } : {}),
    ...(modeId ? { modeId: modeId as 'duel' | 'capture' } : {}),
    ...(outcome ? { outcome: outcome as 'victory' | 'defeat' | 'draw' } : {}),
    ...(query ? { query } : {}),
  };
}

async function refreshReplayFilters(): Promise<void> {
  await replayLibraryController.setFilter(readReplayFilter());
  renderReplayLibraryV1(replayLibraryController.getSnapshot());
}

async function handleReplayCardAction(event: Event): Promise<void> {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-replay-action]');
  const card = button?.closest<HTMLElement>('.replay-library-card');
  if (!button || !card?.dataset.replayId || !card.dataset.source) return;
  const replayId = card.dataset.replayId;
  const source = card.dataset.source as ReplaySourceV1;
  const action = button.dataset.replayAction;
  if (action === 'open') {
    await runReplayLibraryAction(async () => {
      const opened = await replayLibraryController.open(replayId, source);
      libraryReplayController.open(opened.replay);
      element('replay-library-player-title').textContent = opened.replay.participants.map((participant) => participant.displayName).join(' vs ');
      element('replay-library-content').hidden = true;
      element('replay-library-damaged').hidden = true;
      element('replay-library-player').hidden = false;
      buildUnifiedReplayViewV1(libraryReplayController, 'replay-library');
    });
    return;
  }
  if (action === 'note') {
    const note = card.querySelector<HTMLTextAreaElement>('.replay-note-input')?.value.trim() ?? '';
    await runReplayLibraryAction(async () => {
      await replayLibraryController.updateNote(replayId, source, note);
      showToast('复盘笔记已保存', false);
    });
    return;
  }
  if (action === 'export') {
    await runReplayLibraryAction(async () => {
      const filename = await replayLibraryController.export(replayId, source);
      showToast(`回放文件已保存：${filename}`, false);
    });
    return;
  }
  if (action === 'trash') {
    pendingReplayDelete = { replayId, source };
    element('replay-delete-sheet').hidden = false;
  }
}

async function handleReplayTrashAction(event: Event): Promise<void> {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-replay-action="restore"]');
  const row = button?.closest<HTMLElement>('.replay-trash-item');
  if (!button || !row?.dataset.entryId) return;
  await runReplayLibraryAction(async () => {
    await replayLibraryController.restore(row.dataset.entryId!);
    showToast('回放已恢复', false);
  });
}

async function confirmReplayDelete(): Promise<void> {
  if (!pendingReplayDelete) return;
  const target = pendingReplayDelete;
  await runReplayLibraryAction(async () => {
    await replayLibraryController.moveToTrash(target.replayId, target.source);
    closeReplayDeleteSheet();
    showToast('回放已移到回收站', false);
  });
}

function closeReplayDeleteSheet(): void {
  pendingReplayDelete = undefined;
  element('replay-delete-sheet').hidden = true;
}

function showReplayTrash(open: boolean): void {
  element('replay-library-content').hidden = open;
  element('replay-library-damaged').hidden = open || replayLibraryController.getSnapshot().counts.damaged === 0;
  element('replay-trash-panel').hidden = !open;
}

async function runReplayLibraryAction(action: () => Promise<void>): Promise<void> {
  try {
    await action();
    renderReplayLibraryV1(replayLibraryController.getSnapshot());
  } catch (error) {
    showToast(error instanceof Error ? error.message : '回放操作没有完成', true);
  }
}

function closeLibraryReplay(): void {
  stopLibraryReplayTimer();
  libraryReplayController.close();
  element('replay-library-player').hidden = true;
  element('replay-library-content').hidden = replayLibraryController.getSnapshot().counts.all === 0;
  element('replay-library-damaged').hidden = replayLibraryController.getSnapshot().counts.damaged === 0;
}

function stepLibraryReplay(delta: -1 | 1): void {
  stopLibraryReplayTimer();
  const snapshot = libraryReplayController.getSnapshot();
  if (!snapshot.replay) return;
  libraryReplayController.seek(Math.max(0, Math.min(snapshot.replay.frames.length - 1, snapshot.frameIndex + delta)));
  renderUnifiedReplayFrameV1(libraryReplayController, 'replay-library');
}

function toggleLibraryReplay(): void {
  const snapshot = libraryReplayController.getSnapshot();
  if (!snapshot.open) return;
  if (snapshot.playing) {
    libraryReplayController.pause();
    stopLibraryReplayTimer();
  } else {
    libraryReplayController.play();
    stopLibraryReplayTimer();
    libraryReplayTimer = window.setInterval(() => {
      const playing = libraryReplayController.advance();
      renderUnifiedReplayFrameV1(libraryReplayController, 'replay-library');
      if (!playing) stopLibraryReplayTimer();
    }, 260);
  }
  renderUnifiedReplayFrameV1(libraryReplayController, 'replay-library');
}

function stopLibraryReplayTimer(): void {
  if (libraryReplayTimer !== undefined) window.clearInterval(libraryReplayTimer);
  libraryReplayTimer = undefined;
}

function readGarageInput(): GarageSaveInputV1 {
  return {
    label: element<HTMLInputElement>('garage-label').value.trim(),
    vehicleId: element<HTMLSelectElement>('garage-vehicle').value as GarageSaveInputV1['vehicleId'],
    weaponId: element<HTMLSelectElement>('garage-weapon').value as GarageSaveInputV1['weaponId'],
    tacticId: element<HTMLSelectElement>('garage-tactic').value as GarageSaveInputV1['tacticId'],
    note: element<HTMLTextAreaElement>('garage-note').value.trim(),
  };
}

async function runGarageAction(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    showToast(error instanceof Error ? error.message : '车库操作没有完成', true);
  }
}

async function runPracticeLab(mirror: boolean): Promise<void> {
  try {
    const currentRevision = Number(element<HTMLSelectElement>('practice-current').value);
    const opponentRevision = mirror
      ? currentRevision
      : Number(element<HTMLSelectElement>('practice-opponent').value);
    const selectedMode = document.querySelector<HTMLInputElement>('input[name="practice-mode"]:checked')?.value;
    const input: PracticeRunInputV1 = {
      currentRevision,
      opponentRevision,
      modeId: selectedMode === 'capture' ? 'capture' : 'duel',
    };
    await practiceLabController.run(input);
    if (!practiceLabController.getSnapshot().error) await garageController.load();
  } catch (error) {
    showToast(error instanceof Error ? error.message : '训练赛没有完成', true);
  }
}

async function runOnboardingAction(action: () => Promise<void>): Promise<void> {
  try {
    await action();
    const onboarding = onboardingController.getSnapshot();
    renderOnboardingV1(onboarding, onboarding.phase !== 'complete');
    renderAppShellV1(appShellController.getSnapshot());
  } catch (error) {
    renderOnboardingV1(onboardingController.getSnapshot(), true);
    showToast(error instanceof Error ? error.message : '首次体验未能继续，请重试。', true);
  }
}

async function runOnboardingBattle(): Promise<void> {
  try {
    const running = onboardingController.runBattle();
    renderOnboardingV1(onboardingController.getSnapshot(), true);
    await running;
    renderOnboardingV1(onboardingController.getSnapshot(), true);
  } catch (error) {
    renderOnboardingV1(onboardingController.getSnapshot(), true);
    showToast(error instanceof Error ? error.message : '教学战斗未能完成，请重试。', true);
  }
}
