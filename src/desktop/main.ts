import { app, BrowserWindow, clipboard, dialog, ipcMain, safeStorage, shell, webContents, type WebContents } from 'electron';
import { dirname, isAbsolute, join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { allowedExternalUrlV1, assertTrustedRendererV1 } from './renderer-security-v1.js';
import {
  DesktopFriendRoomRuntimeV1,
  type DesktopFriendRoomStartV1,
  type FriendRoomPresetIdV1,
} from './friend-room-runtime-v1.js';
import { createDesktopBrowserWindowOptionsV1 } from './window-contract-v1.js';
import { DesktopApplicationServiceV1 } from './application-service-v1.js';
import { registerDesktopApplicationIpcV1 } from './application-ipc-v1.js';
import { PlayerProfileRepositoryV1 } from './player-profile-repository-v1.js';
import { SavedBuildRepositoryV2 } from '../config/saved-build-repository-v2.js';
import { ReplayRepositoryV2 } from '../replay/repository-v2.js';
import { BuildRevisionNoteRepositoryV1 } from './build-revision-note-repository-v1.js';
import { GarageServiceV1 } from './garage-service-v1.js';
import { PracticeMatchServiceV1 } from './practice-match-service-v1.js';
import { PublicReplayRepositoryV1 } from './public-replay-repository-v1.js';
import { ReplayMetadataRepositoryV1 } from './replay-metadata-repository-v1.js';
import { ReplayTrashRepositoryV1 } from './replay-trash-repository-v1.js';
import { ReplayLibraryServiceV1 } from './replay-library-service-v1.js';
import { FriendRoomRecoveryStoreV1, type FriendRoomRecoveryCipherV1 } from './friend-room-recovery-store-v1.js';
import { LanDiscoveryServiceV1, NodeLanDatagramAdapterV1 } from './lan-discovery-v1.js';
import {
  registerFriendRoomPlatformIpcV1,
  type FriendRoomRecoveryProjectionV1,
} from './friend-room-platform-ipc-v1.js';
import {
  ReleaseDiagnosticsServiceV1,
  probeStunBindingV1,
  probeUdpLoopbackV1,
  probeWritableDirectoryV1,
} from './release-diagnostics-service-v1.js';
import { runTutorialMatchV1 } from './tutorial-match-service-v1.js';
import { AgentCenterServiceV1 } from './agent-center-service-v1.js';
import { AppSettingsRepositoryV1 } from './app-settings-repository-v1.js';
import { LegacyDataImportServiceV1 } from './legacy-data-import-service-v1.js';
import { SettingsServiceV1 } from './settings-service-v1.js';
import { AgentConnectorServiceV1 } from './agent-connector-service-v1.js';
import { writeAtomicJson } from '../storage/atomic-json.js';

const roomRuntimes = new Map<number, DesktopFriendRoomRuntimeV1>();
const ownedWindows = new Set<number>();
const rendererUrl = pathToFileURL(join(__dirname, 'renderer', 'index.html')).href;
// A launch-only profile override makes candidate validation independent of a player's data.
const dataOverride = process.argv.find((argument) => argument.startsWith('--agentic-data-dir='))?.slice('--agentic-data-dir='.length);
const acceptanceSmoke = process.argv.includes('--agentic-acceptance-smoke');
if (acceptanceSmoke && !dataOverride) throw new Error('Acceptance smoke requires an isolated data directory');
if (dataOverride) {
  if (!isAbsolute(dataOverride)) throw new Error('The data directory must be an absolute path');
  mkdirSync(dataOverride, { recursive: true });
  app.setPath('userData', dataOverride);
}

function checkSender(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): void {
  assertTrustedRendererV1({ ownedWindow: ownedWindows.has(event.sender.id) && !event.sender.isDestroyed(),
    mainFrame: Boolean(event.senderFrame && event.senderFrame === event.sender.mainFrame),
    frameUrl: event.senderFrame?.url ?? '', expectedUrl: rendererUrl });
}
function secureHandle(channel: string, handler: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => unknown): void {
  ipcMain.handle(channel, async (event, ...args) => {
    checkSender(event);
    const result = await handler(event, ...args);
    if (acceptanceSmoke && channel === 'app:bootstrap') {
      const tutorial = await runTutorialMatchV1({ doctrine: 'medium', displayName: '包内运行验收' });
      if (tutorial.replay.frames.length < 2) throw new Error('Packaged worker did not produce a replay');
      await writeAtomicJson(join(app.getPath('userData'), 'acceptance-smoke.json'), {
        version: app.getVersion(), packaged: app.isPackaged, trustedRendererBootstrap: true,
        tutorialFrames: tutorial.replay.frames.length,
      });
      setTimeout(() => app.exit(0), 150);
    }
    return result;
  });
}
function secureOn(channel: string, handler: (event: Electron.IpcMainEvent, payload: unknown) => void): void {
  ipcMain.on(channel, (event, payload) => { try { checkSender(event); handler(event, payload); } catch { /* ignore unauthorized fire-and-forget input */ } });
}

function installFriendRoomIpc(
  publicReplayRepository: PublicReplayRepositoryV1,
  recoveryStore: FriendRoomRecoveryStoreV1,
  diagnosticsService: ReleaseDiagnosticsServiceV1,
  buildRepository: SavedBuildRepositoryV2,
): void {
  const nearbyServices = new Map<number, LanDiscoveryServiceV1>();
  const createRuntime = (sender: WebContents) => new DesktopFriendRoomRuntimeV1({
    sendPeer: (payload) => sendIfAlive(sender, 'friend-room:peer-outbound', payload),
    onEvent: (roomEvent) => sendIfAlive(sender, 'friend-room:event', roomEvent),
    onPublicReplay: async (input) => { await publicReplayRepository.save(input); },
    onRecovery: async (capsule) => {
      if (capsule) await recoveryStore.save(capsule);
      else await recoveryStore.clear();
    },
  });
  secureHandle('friend-room:start', (event, input: DesktopFriendRoomStartV1) => {
    assertRoomStart(input);
    const sender = event.sender;
    const runtime = createRuntime(sender);
    roomRuntimes.set(sender.id, runtime);
    runtime.start(input);
  });
  secureOn('friend-room:peer-inbound', (event, payload: unknown) => {
    if (typeof payload !== 'string' || payload.length > 1_100_000) return;
    roomRuntimes.get(event.sender.id)?.receivePeer(payload);
  });
  secureHandle('friend-room:select-preset', (event, presetId: FriendRoomPresetIdV1) => {
    if (!['scout', 'medium', 'heavy'].includes(presetId)) throw new Error('请选择一套战术配置');
    roomRuntimes.get(event.sender.id)?.selectPreset(presetId);
  });
  secureHandle('friend-room:select-revision', async (event, revision: unknown) => {
    if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 1) throw new Error('请选择可用的战术版本');
    const runtime = roomRuntimes.get(event.sender.id);
    if (!runtime) throw new Error('请先连接好友');
    const inspection = await buildRepository.inspect('commander-main');
    const selected = inspection.revisions.find((item) => item.revision === revision);
    if (!selected || selected.state !== 'healthy') throw new Error('所选版本已不可用，请刷新整备中心');
    runtime.selectBuild(selected.record);
  });
  secureHandle('friend-room:set-ready', (event, ready: unknown) => {
    if (typeof ready !== 'boolean') throw new Error('准备状态无效');
    roomRuntimes.get(event.sender.id)?.setReady(ready);
  });
  secureHandle('friend-room:request-rematch', (event) => {
    const runtime = roomRuntimes.get(event.sender.id);
    if (!runtime) throw new Error('请先连接好友');
    runtime.requestRematch();
  });
  secureHandle('friend-room:transport-closed', (event) => {
    roomRuntimes.get(event.sender.id)?.transportClosed();
  });
  secureHandle('friend-room:resume-transport', (event) => {
    const runtime = roomRuntimes.get(event.sender.id);
    if (!runtime) throw new Error('请先进入好友房间');
    runtime.resumeTransport();
  });
  secureHandle('friend-room:reset', (event) => roomRuntimes.delete(event.sender.id));

  registerFriendRoomPlatformIpcV1({
    handle: (channel, handler) => secureHandle(channel, (event, input) => handler(event, input)),
  }, {
    inspectRecovery: async () => projectRecovery(await recoveryStore.inspect()),
    restoreRoom: async (senderId) => {
      const inspection = await recoveryStore.inspect();
      if (inspection.status !== 'available') throw new Error(recoveryUnavailableMessage(inspection.status));
      const sender = webContents.fromId(senderId);
      if (!sender || sender.isDestroyed()) throw new Error('游戏窗口已经关闭');
      const runtime = createRuntime(sender);
      roomRuntimes.set(senderId, runtime);
      runtime.restore(inspection.capsule);
    },
    leaveRoom: async (senderId) => {
      const runtime = roomRuntimes.get(senderId);
      runtime?.closeRoom();
      roomRuntimes.delete(senderId);
      nearbyServices.get(senderId)?.stop();
      nearbyServices.delete(senderId);
      await recoveryStore.clear();
    },
    runDiagnostics: () => diagnosticsService.run(),
    startNearby: async (senderId) => {
      nearbyServices.get(senderId)?.stop();
      const sender = webContents.fromId(senderId);
      if (!sender || sender.isDestroyed()) throw new Error('游戏窗口已经关闭');
      const service = new LanDiscoveryServiceV1(new NodeLanDatagramAdapterV1());
      nearbyServices.set(senderId, service);
      sender.once('destroyed', () => {
        service.stop();
        nearbyServices.delete(senderId);
        roomRuntimes.delete(senderId);
      });
      await service.start({
        onNearbyChanged: (cards) => sendIfAlive(sender, 'friend-room:nearby-changed', cards),
        onConfirmation: (answer) => sendIfAlive(sender, 'friend-room:nearby-confirmation', answer),
      });
    },
    publishNearby: (senderId, input) => requireNearby(nearbyServices, senderId).publishHost(input),
    sendNearbyConfirmation: (senderId, input) => requireNearby(nearbyServices, senderId).sendJoinConfirmation(input),
    stopNearby: (senderId) => {
      nearbyServices.get(senderId)?.stop();
      nearbyServices.delete(senderId);
    },
  });
}

function requireNearby(services: Map<number, LanDiscoveryServiceV1>, senderId: number): LanDiscoveryServiceV1 {
  const service = services.get(senderId);
  if (!service) throw new Error('请先打开附近好友页面');
  return service;
}

function projectRecovery(inspection: Awaited<ReturnType<FriendRoomRecoveryStoreV1['inspect']>>): FriendRoomRecoveryProjectionV1 {
  if (inspection.status !== 'available') return { status: inspection.status };
  const { capsule } = inspection;
  return {
    status: 'available',
    role: capsule.role,
    sessionId: capsule.sessionId,
    displayName: capsule.displayName,
    revision: capsule.revision,
    expiresAt: capsule.expiresAt,
    publicSnapshot: structuredClone(capsule.publicSnapshot),
  };
}

function recoveryUnavailableMessage(status: 'missing' | 'disabled' | 'expired' | 'invalid'): string {
  if (status === 'disabled') return '系统加密不可用，无法安全恢复好友房间';
  if (status === 'expired') return '好友房间的恢复时间已结束，请创建新房间';
  if (status === 'invalid') return '好友房间恢复信息无效，请创建新房间';
  return '没有可以继续的好友房间';
}

function assertRoomStart(input: DesktopFriendRoomStartV1): void {
  if (!input || (input.role !== 'host' && input.role !== 'guest')) throw new Error('好友房间身份无效');
  if (typeof input.displayName !== 'string') throw new Error('好友昵称无效');
  if (input.sessionId !== undefined && typeof input.sessionId !== 'string') throw new Error('房间编号无效');
}

function sendIfAlive(sender: WebContents, channel: string, payload: unknown): void {
  if (!sender.isDestroyed()) sender.send(channel, payload);
}

function createGameWindow(): BrowserWindow {
  const window = new BrowserWindow(createDesktopBrowserWindowOptionsV1(
    join(__dirname, 'preload.cjs'),
    join(__dirname, 'renderer', 'app-icon.png'),
  ));
  window.setMenuBarVisibility(false);
  const ownedWebContentsId = window.webContents.id;
  ownedWindows.add(ownedWebContentsId);
  window.webContents.once('destroyed', () => ownedWindows.delete(ownedWebContentsId));
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (allowedExternalUrlV1(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => { if (url !== rendererUrl) event.preventDefault(); });
  window.webContents.on('will-frame-navigate', (event) => { if (event.url !== rendererUrl) event.preventDefault(); });
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  let showingRecovery = false;
  const recover = async () => {
    if (showingRecovery || window.isDestroyed()) return;
    showingRecovery = true;
    try {
      const result = await dialog.showMessageBox(window, { type: 'error', title: '游戏窗口需要恢复',
        message: '游戏画面未能加载，已有战术与回放仍保存在本机。', buttons: ['重新加载', '关闭游戏'], defaultId: 0, cancelId: 1 });
      if (window.isDestroyed()) return;
      if (result.response === 0) void window.loadFile(join(__dirname, 'renderer', 'index.html')).catch(() => undefined);
      else window.close();
    } finally { showingRecovery = false; }
  };
  window.webContents.on('render-process-gone', () => { void recover(); });
  window.webContents.on('did-fail-load', (_event, code, _description, _url, mainFrame) => { if (mainFrame && code !== -3) void recover(); });
  void window.loadFile(join(__dirname, 'renderer', 'index.html')).catch(() => recover());
  window.once('ready-to-show', () => { if (!acceptanceSmoke) window.show(); });
  return window;
}

if (!app.requestSingleInstanceLock()) app.quit();
else app.whenReady().then(() => {
  const userDataRoot = app.getPath('userData');
  const quarantineRoot = join(userDataRoot, 'quarantine');
  const buildRepository = new SavedBuildRepositoryV2(join(userDataRoot, 'builds'), { quarantineRoot });
  const replayRepository = new ReplayRepositoryV2(join(userDataRoot, 'replays'));
  const publicReplayRepository = new PublicReplayRepositoryV1(join(userDataRoot, 'public-replays'));
  const replayMetadataRepository = new ReplayMetadataRepositoryV1(join(userDataRoot, 'replay-metadata'));
  const replayTrashRepository = new ReplayTrashRepositoryV1(join(userDataRoot, 'replay-trash'));
  const noteRepository = new BuildRevisionNoteRepositoryV1(join(userDataRoot, 'build-metadata'), { quarantineRoot });
  const diagnosticsService = new ReleaseDiagnosticsServiceV1({
    dataProbe: () => probeWritableDirectoryV1(userDataRoot),
    sandboxProbe: async () => {
      const result = await runTutorialMatchV1({ doctrine: 'scout', displayName: '诊断战车' });
      return result.replay.frames.length > 0;
    },
    encryptionAvailable: () => safeStorage.isEncryptionAvailable(),
    clipboardAvailable: () => typeof clipboard.readText === 'function' && typeof clipboard.writeText === 'function',
    lanProbe: () => probeUdpLoopbackV1(),
    stunProbe: () => probeStunBindingV1(),
    version: app.getVersion(),
  });
  const settingsService = new SettingsServiceV1({
    settingsRepository: new AppSettingsRepositoryV1(userDataRoot),
    diagnostics: diagnosticsService,
    legacyImporter: new LegacyDataImportServiceV1({ buildRepository, publicReplayRepository }),
    chooseLegacyRoot: async () => {
      const selection = await dialog.showOpenDialog({
        title: '选择旧版 AgenticGame 数据目录',
        properties: ['openDirectory', 'dontAddToRecent'],
      });
      return selection.canceled ? null : selection.filePaths[0] ?? null;
    },
    exportsRoot: join(userDataRoot, 'exports'),
    openReleases: async () => { await shell.openExternal('https://github.com/ghostLLC/AgenticGame/releases'); },
    appVersion: app.getVersion(),
  });
  const applicationService = new DesktopApplicationServiceV1({
    profileRepository: new PlayerProfileRepositoryV1(userDataRoot),
    garageService: new GarageServiceV1({
      buildRepository,
      noteRepository,
      replayRepository,
      diagnosticsRoot: join(userDataRoot, 'diagnostics'),
    }),
    practiceService: new PracticeMatchServiceV1({ buildRepository, replayRepository }),
    replayService: new ReplayLibraryServiceV1({
      replayRepository,
      publicRepository: publicReplayRepository,
      metadataRepository: replayMetadataRepository,
      trashRepository: replayTrashRepository,
      exportsRoot: join(userDataRoot, 'exports'),
      chooseExportPath: async (filename, privateBackup) => {
        const selected = await dialog.showSaveDialog({
          title: privateBackup ? '完整备份包含战术代码和运行记录，请妥善保管' : '分享公开回放 · 不包含战术代码',
          defaultPath: join(app.getPath('documents'), filename),
          filters: [{ name: privateBackup ? 'AgenticGame 完整备份' : 'AgenticGame 公开回放', extensions: [privateBackup ? 'agentic-backup' : 'agentic-replay'] }],
        });
        return selected.canceled ? undefined : selected.filePath;
      },
      chooseImportPath: async () => {
        const selected = await dialog.showOpenDialog({ title: '导入回放或完整备份', properties: ['openFile', 'dontAddToRecent'],
          filters: [{ name: 'AgenticGame 回放', extensions: ['agentic-replay', 'agentic-backup', 'json'] }] });
        return selected.canceled ? undefined : selected.filePaths[0];
      },
      revealExport: (path) => {
        if (path === join(userDataRoot, 'exports')) void shell.openPath(path);
        else shell.showItemInFolder(path);
      },
    }),
    agentCenterService: new AgentCenterServiceV1({ buildRepository, noteRepository }),
    agentConnectorService: new AgentConnectorServiceV1({
      homeDirectory: homedir(),
      bridgePath: app.isPackaged
        ? join(dirname(process.execPath), 'AgenticGame-Agent.exe')
        : join(app.getAppPath(), 'dist', 'agent-bridge', 'AgenticGame-Agent.exe'),
    }),
    settingsService,
  });
  registerDesktopApplicationIpcV1({
    handle: (channel, handler) => secureHandle(channel, handler),
  }, applicationService);
  const recoveryCipher: FriendRoomRecoveryCipherV1 = {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: (value) => safeStorage.encryptString(value),
    decrypt: (value) => safeStorage.decryptString(value),
  };
  const recoveryStore = new FriendRoomRecoveryStoreV1(userDataRoot, recoveryCipher);
  installFriendRoomIpc(publicReplayRepository, recoveryStore, diagnosticsService, buildRepository);
  createGameWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createGameWindow();
  });
}).catch(() => {
  dialog.showErrorBox('AgenticGame 启动失败', '游戏组件未能初始化。请使用完整安装包重新安装；本机战术与回放会保留。');
  app.quit();
});

app.on('second-instance', () => {
  const window = BrowserWindow.getAllWindows()[0];
  if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
