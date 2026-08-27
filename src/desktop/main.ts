import { app, BrowserWindow, ipcMain, shell, type WebContents } from 'electron';
import { join } from 'node:path';
import {
  DesktopFriendRoomRuntimeV1,
  type DesktopFriendRoomStartV1,
  type FriendRoomPresetIdV1,
} from './friend-room-runtime-v1.js';
import { createDesktopBrowserWindowOptionsV1 } from './window-contract-v1.js';

const roomRuntimes = new Map<number, DesktopFriendRoomRuntimeV1>();

function installFriendRoomIpc(): void {
  ipcMain.handle('friend-room:start', (event, input: DesktopFriendRoomStartV1) => {
    assertRoomStart(input);
    const sender = event.sender;
    const runtime = new DesktopFriendRoomRuntimeV1({
      sendPeer: (payload) => sendIfAlive(sender, 'friend-room:peer-outbound', payload),
      onEvent: (roomEvent) => sendIfAlive(sender, 'friend-room:event', roomEvent),
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
  installFriendRoomIpc();
  createGameWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createGameWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
