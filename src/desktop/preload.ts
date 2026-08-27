import { clipboard, contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('agenticGameDesktop', {
  copyText(text: string): void {
    clipboard.writeText(text);
  },
  friendRoom: {
    start(input: unknown): Promise<void> {
      return ipcRenderer.invoke('friend-room:start', input);
    },
    receivePeer(payload: string): void {
      ipcRenderer.send('friend-room:peer-inbound', payload);
    },
    selectPreset(presetId: string): Promise<void> {
      return ipcRenderer.invoke('friend-room:select-preset', presetId);
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
  },
});
