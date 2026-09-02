import { describe, expect, it, vi } from 'vitest';
import { defaultAppSettingsV1 } from '../src/desktop/app-settings-v1.js';
import { AudioFeedbackV1 } from '../src/desktop/renderer/audio-feedback-v1.js';

describe('AudioFeedbackV1', () => {
  it('覆盖 Beta 的八种声音反馈并按两级音量缩放', () => {
    const play = vi.fn();
    const audio = new AudioFeedbackV1({ play });
    audio.apply({ ...defaultAppSettingsV1(), masterVolume: 50, effectsVolume: 40 });
    for (const cue of ['button', 'ready', 'battle-start', 'hit', 'destroy', 'victory', 'defeat', 'disconnect'] as const) audio.cue(cue);
    expect(play).toHaveBeenCalledTimes(8);
    expect(play.mock.calls.every((call) => call[0].gain <= 0.2)).toBe(true);
  });

  it('任一级音量为零时静音', () => {
    const play = vi.fn();
    const audio = new AudioFeedbackV1({ play });
    audio.apply({ ...defaultAppSettingsV1(), masterVolume: 0 });
    audio.cue('victory');
    expect(play).not.toHaveBeenCalled();
  });
});
