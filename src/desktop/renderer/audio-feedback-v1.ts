import type { AppSettingsV1 } from '../app-settings-v1.js';

export type AudioCueV1 = 'button' | 'ready' | 'battle-start' | 'hit' | 'destroy' | 'victory' | 'defeat' | 'disconnect';

export interface ToneInstructionV1 { frequency: number; durationMs: number; gain: number; wave: OscillatorType }
export interface ToneSynthV1 { play(instruction: ToneInstructionV1): void }

const CUES: Record<AudioCueV1, Omit<ToneInstructionV1, 'gain'>> = {
  button: { frequency: 420, durationMs: 45, wave: 'sine' },
  ready: { frequency: 620, durationMs: 90, wave: 'triangle' },
  'battle-start': { frequency: 180, durationMs: 180, wave: 'sawtooth' },
  hit: { frequency: 120, durationMs: 80, wave: 'square' },
  destroy: { frequency: 76, durationMs: 260, wave: 'sawtooth' },
  victory: { frequency: 740, durationMs: 220, wave: 'triangle' },
  defeat: { frequency: 110, durationMs: 260, wave: 'triangle' },
  disconnect: { frequency: 150, durationMs: 140, wave: 'square' },
};

export class AudioFeedbackV1 {
  private gain = 0;
  constructor(private readonly synth: ToneSynthV1) {}
  apply(settings: AppSettingsV1): void { this.gain = (settings.masterVolume / 100) * (settings.effectsVolume / 100); }
  cue(cue: AudioCueV1): void {
    if (this.gain <= 0) return;
    this.synth.play({ ...CUES[cue], gain: Math.min(0.24, this.gain * 0.24) });
  }
}

export class BrowserToneSynthV1 implements ToneSynthV1 {
  private context?: AudioContext;
  play(instruction: ToneInstructionV1): void {
    try {
      this.context ??= new AudioContext();
      const now = this.context.currentTime;
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      oscillator.type = instruction.wave;
      oscillator.frequency.setValueAtTime(instruction.frequency, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, instruction.gain), now + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + instruction.durationMs / 1000);
      oscillator.connect(gain).connect(this.context.destination);
      oscillator.start(now);
      oscillator.stop(now + instruction.durationMs / 1000 + 0.01);
    } catch { /* Sound is optional; gameplay must continue when audio is unavailable. */ }
  }
}
