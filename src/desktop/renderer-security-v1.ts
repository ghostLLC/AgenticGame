export function assertTrustedRendererV1(input: {
  ownedWindow: boolean;
  mainFrame: boolean;
  frameUrl: string;
  expectedUrl: string;
}): void {
  if (!input.ownedWindow || !input.mainFrame || input.frameUrl !== input.expectedUrl) throw new Error('此窗口无权调用游戏操作。');
}

export function allowedExternalUrlV1(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'github.com' && !url.username && !url.password
      && (url.pathname === '/ghostLLC/AgenticGame' || url.pathname.startsWith('/ghostLLC/AgenticGame/releases'));
  } catch { return false; }
}
