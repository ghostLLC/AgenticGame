import type { FriendRoomReplayFrameV1, FriendRoomReplayV1 } from '../friend-room/replay-v1.js';
import type { ReplayStudioMomentV2 } from '../replay/studio-v2.js';

/** Engine events describe the transition at tick N; its outcome is checkpoint N + 1. */
export function replayMomentTickV1(replay: FriendRoomReplayV1, moment: ReplayStudioMomentV2): number {
  if (moment.kind === 'start') return replay.frames[0]?.tick ?? 0;
  if (moment.kind === 'result') return replay.frames.at(-1)?.tick ?? 0;
  return (replay.frames.find((frame) => frame.tick > moment.tick) ?? replay.frames.at(-1))?.tick ?? 0;
}

export interface FriendRoomReplayControllerSnapshotV1 {
  open: boolean;
  playing: boolean;
  frameIndex: number;
  replay?: FriendRoomReplayV1;
  frame?: FriendRoomReplayFrameV1;
}

export class FriendRoomReplayControllerV1 {
  private replay?: FriendRoomReplayV1;
  private frameIndex = 0;
  private playing = false;

  open(replay: FriendRoomReplayV1): void {
    if (!replay.frames.length) throw new Error('回放没有可播放的战斗帧');
    this.replay = structuredClone(replay);
    this.frameIndex = 0;
    this.playing = false;
  }

  close(): void {
    this.replay = undefined;
    this.frameIndex = 0;
    this.playing = false;
  }

  seek(frameIndex: number): void {
    const replay = this.requireReplay();
    if (!Number.isSafeInteger(frameIndex) || frameIndex < 0 || frameIndex >= replay.frames.length) {
      throw new Error('回放位置无效');
    }
    this.frameIndex = frameIndex;
    this.playing = false;
  }

  play(): void {
    const replay = this.requireReplay();
    if (this.frameIndex === replay.frames.length - 1) this.frameIndex = 0;
    this.playing = true;
  }

  pause(): void {
    this.playing = false;
  }

  advance(): boolean {
    const replay = this.requireReplay();
    if (!this.playing) return false;
    if (this.frameIndex < replay.frames.length - 1) this.frameIndex += 1;
    if (this.frameIndex === replay.frames.length - 1) this.playing = false;
    return this.playing;
  }

  getSnapshot(): FriendRoomReplayControllerSnapshotV1 {
    if (!this.replay) return { open: false, playing: false, frameIndex: 0 };
    return {
      open: true,
      playing: this.playing,
      frameIndex: this.frameIndex,
      replay: this.replay,
      frame: structuredClone(this.replay.frames[this.frameIndex]!),
    };
  }

  private requireReplay(): FriendRoomReplayV1 {
    if (!this.replay) throw new Error('请先打开一场回放');
    return this.replay;
  }
}
