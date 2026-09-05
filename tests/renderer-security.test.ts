import { expect, it } from 'vitest';
import { allowedExternalUrlV1, assertTrustedRendererV1 } from '../src/desktop/renderer-security-v1.js';

it('rejects foreign windows, subframes and navigated documents', () => {
  const valid = { ownedWindow: true, mainFrame: true, frameUrl: 'file:///app/index.html', expectedUrl: 'file:///app/index.html' };
  expect(() => assertTrustedRendererV1(valid)).not.toThrow();
  for (const changed of [{ ownedWindow: false }, { mainFrame: false }, { frameUrl: 'https://attacker.example' }, { frameUrl: 'file:///app/index.html?remote' }]) {
    expect(() => assertTrustedRendererV1({ ...valid, ...changed })).toThrow('无权');
  }
  expect(allowedExternalUrlV1('https://github.com/ghostLLC/AgenticGame/releases')).toBe(true);
  for (const value of ['https://github.com.evil.example/ghostLLC/AgenticGame', 'https://github.com/other/repo', 'file:///C:/Windows', 'https://evil@github.com/ghostLLC/AgenticGame']) expect(allowedExternalUrlV1(value)).toBe(false);
});
