import { app, BrowserWindow, ipcMain, shell, type WebContents } from 'electron';
import { join } from 'node:path';
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

const roomRuntimes = new Map<number, DesktopFriendRoomRuntimeV1>();

function installFriendRoomIpc(publicReplayRepository: PublicReplayRepositoryV1): void {
  ipcMain.handle('friend-room:start', (event, input: DesktopFriendRoomStartV1) => {
    assertRoomStart(input);
    const sender = event.sender;
    const runtime = new DesktopFriendRoomRuntimeV1({
      sendPeer: (payload) => sendIfAlive(sender, 'friend-room:peer-outbound', payload),
      onEvent: (roomEvent) => sendIfAlive(sender, 'friend-room:event', roomEvent),
      onPublicReplay: async (input) => { await publicReplayRepository.save(input); },
    });
    roomRuntimes.set(sender.id, runtime);
    runtime.start(input);
  });
  ipcMain.on('friend-room:peer-inbound', (event, payload: unknown) => {
    if (typeof payload !== 'string' || payload.length > 1_100_000) return;
    roomRuntimes.get(event.sender.id)?.receivePeer(payload);
  });
  ipcMain.handle('friend-room:select-preset', (event, presetId: FriendRoomPresetIdV1) => {
    if (!['scout', 'medium', 'heavy'].includes(presetId)) throw new Error('请选择一套战术配置');
    roomRuntimes.get(event.sender.id)?.selectPreset(presetId);
  });
  ipcMain.handle('friend-room:set-ready', (event, ready: unknown) => {
    if (typeof ready !== 'boolean') throw new Error('准备状态无效');
    roomRuntimes.get(event.sender.id)?.setReady(ready);
  });
  ipcMain.handle('friend-room:request-rematch', (event) => {
    const runtime = roomRuntimes.get(event.sender.id);
    if (!runtime) throw new Error('请先连接好友');
    runtime.requestRematch();
  });
  ipcMain.handle('friend-room:transport-closed', (event) => {
    roomRuntimes.get(event.sender.id)?.transportClosed();
  });
  ipcMain.handle('friend-room:resume-transport', (event) => {
    const runtime = roomRuntimes.get(event.sender.id);
    if (!runtime) throw new Error('请先进入好友房间');
    runtime.resumeTransport();
  });
  ipcMain.handle('friend-room:reset', (event) => roomRuntimes.delete(event.sender.id));
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
  const window = new BrowserWindow(createDesktopBrowserWindowOptionsV1(join(__dirname, 'preload.cjs')));
  window.setMenuBarVisibility(false);
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  void window.loadFile(join(__dirname, 'renderer', 'index.html'));
  window.once('ready-to-show', () => window.show());
  return window;
}

app.whenReady().then(() => {
  const userDataRoot = app.getPath('userData');
  const quarantineRoot = join(userDataRoot, 'quarantine');
  const buildRepository = new SavedBuildRepositoryV2(join(userDataRoot, 'builds'), { quarantineRoot });
  const replayRepository = new ReplayRepositoryV2(join(userDataRoot, 'replays'));
  const publicReplayRepository = new PublicReplayRepositoryV1(join(userDataRoot, 'public-replays'));
  const replayMetadataRepository = new ReplayMetadataRepositoryV1(join(userDataRoot, 'replay-metadata'));
  const replayTrashRepository = new ReplayTrashRepositoryV1(join(userDataRoot, 'replay-trash'));
  const applicationService = new DesktopApplicationServiceV1({
    profileRepository: new PlayerProfileRepositoryV1(userDataRoot),
    garageService: new GarageServiceV1({
      buildRepository,
      noteRepository: new BuildRevisionNoteRepositoryV1(join(userDataRoot, 'build-metadata'), { quarantineRoot }),
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
    }),
  });
  registerDesktopApplicationIpcV1({
    handle: (channel, handler) => ipcMain.handle(channel, handler),
  }, applicationService);
  installFriendRoomIpc(publicReplayRepository);
  createGameWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createGameWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
