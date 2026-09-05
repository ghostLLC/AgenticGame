import { clipboard, contextBridge, ipcRenderer } from 'electron';
import { createDesktopPreloadApiV1 } from './desktop-preload-api-v1.js';
import { createFriendRoomPlatformPreloadApiV1 } from './friend-room-platform-ipc-v1.js';

const platformApi = createFriendRoomPlatformPreloadApiV1((channel, input) => ipcRenderer.invoke(channel, input));

contextBridge.exposeInMainWorld('agenticGameDesktop', {
  ...createDesktopPreloadApiV1((channel, input) => ipcRenderer.invoke(channel, input)),
  copyText(text: string): void {
    clipboard.writeText(text);
  },
  friendRoom: {
    ...platformApi,
    start(input: unknown): Promise<void> {
      return ipcRenderer.invoke('friend-room:start', input);
    },
    receivePeer(payload: string): void {
      ipcRenderer.send('friend-room:peer-inbound', payload);
    },
    selectPreset(presetId: string): Promise<void> {
      return ipcRenderer.invoke('friend-room:select-preset', presetId);
    },
    selectRevision(revision: number): Promise<void> {
      return ipcRenderer.invoke('friend-room:select-revision', revision);
    },
    setReady(ready: boolean): Promise<void> {
      return ipcRenderer.invoke('friend-room:set-ready', ready);
    },
    requestRematch(): Promise<void> {
      return ipcRenderer.invoke('friend-room:request-rematch');
    },
    transportClosed(): Promise<void> {
      return ipcRenderer.invoke('friend-room:transport-closed');
    },
    resumeTransport(): Promise<void> {
      return ipcRenderer.invoke('friend-room:resume-transport');
    },
    reset(): Promise<void> {
      return ipcRenderer.invoke('friend-room:reset');
    },
    onPeerPayload(listener: (payload: string) => void): void {
      ipcRenderer.on('friend-room:peer-outbound', (_event, payload: string) => listener(payload));
    },
    onEvent(listener: (event: unknown) => void): void {
      ipcRenderer.on('friend-room:event', (_ipcEvent, roomEvent: unknown) => listener(roomEvent));
    },
    onNearbyChanged(listener: (cards: unknown) => void): void {
      ipcRenderer.on('friend-room:nearby-changed', (_event, cards: unknown) => listener(cards));
    },
    onNearbyConfirmation(listener: (answer: unknown) => void): void {
      ipcRenderer.on('friend-room:nearby-confirmation', (_event, answer: unknown) => listener(answer));
    },
  },
});
