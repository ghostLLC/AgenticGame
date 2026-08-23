// 坦克竞技场 —— 主线程侧的 bot runner
//
// 职责：管理 worker 生命周期、分发 tick 请求、执行时间预算、上报违规。
//
// 超时模型：
//  - 每个 onTick 有预算（rules.tickBudgetMs）。超时 → 该 tick 判 idle + 违规计数。
//  - 超时不终止 worker；迟到的响应按 tick 号丢弃（防止错位），但仍视为存活信号。
//  - 若 worker 卡死（同步死循环），它不会再响应任何消息，由 match 层根据
//    lastResponsiveTick 连续落后判定 crash 并 terminate、判负。

import { Worker } from 'node:worker_threads';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { isPackaged, resolveAsset } from './paths.js';

/**
 * 定位 worker 入口脚本。
 * dev：直接用 src/runtime/bot-worker.mjs；
 * pkg exe：worker 代码嵌在虚拟 FS 里，worker_threads 加载虚拟路径不可靠，
 *          启动时把内容释放到临时目录的真实文件（内容 hash 命名，同版本只释放一次）。
 */
let workerPathCache: string | null = null;
export function getWorkerPath(): string {
  if (workerPathCache) return workerPathCache;
  const src = resolveAsset('worker');
  if (!isPackaged()) {
    workerPathCache = src;
    return src;
  }
  const content = readFileSync(src, 'utf8');
  const tag = createHash('sha256').update(content).digest('hex').slice(0, 12);
  const tmp = join(tmpdir(), `arena-bot-worker-${tag}.cjs`);
  if (!existsSync(tmp)) writeFileSync(tmp, content, 'utf8');
  workerPathCache = tmp;
  return tmp;
}

export type TickOutcome =
  | { kind: 'ok'; action: unknown; logs: string[] }
  | { kind: 'timeout' }
  | { kind: 'error'; message: string; logs: string[] };

export interface BotRunnerOptions {
  code: string;
  botIndex: 0 | 1;
  seed: number;
  /** 传给 createTank 的上下文（field/obstacles/rules/myId） */
  ctx: Omit<import('../core/types.js').BotInitContext, 'rng'>;
  workerUrl: URL;
}

interface PendingWait {
  tick: number;
  resolve: (o: TickOutcome) => void;
  timer: NodeJS.Timeout;
}

export class BotRunner {
  readonly botIndex: 0 | 1;
  private worker: Worker;
  private pending: PendingWait | null = null;
  private lastResponsiveTick = -1;
  private terminated = false;
  /** 最近一次 tick 的 debug 日志（由 match 写入回放） */
  lastLogs: string[] = [];

  private constructor(private opts: BotRunnerOptions) {
    this.botIndex = opts.botIndex;
    this.worker = new Worker(opts.workerUrl);
    this.worker.on('message', (msg: { type: string; tick?: number; action?: unknown; logs?: string[]; message?: string; name?: string }) => {
      if (msg.tick !== undefined) this.lastResponsiveTick = Math.max(this.lastResponsiveTick, msg.tick);
      if (this.pending && msg.tick === this.pending.tick) {
        clearTimeout(this.pending.timer);
        const p = this.pending;
        this.pending = null;
        if (msg.type === 'action') {
          this.lastLogs = msg.logs ?? [];
          p.resolve({ kind: 'ok', action: msg.action, logs: this.lastLogs });
        } else if (msg.type === 'error') {
          this.lastLogs = msg.logs ?? [];
          p.resolve({ kind: 'error', message: msg.message ?? 'unknown error', logs: this.lastLogs });
        }
      }
      // 迟到的响应：忽略内容，存活信号已在上面记录
    });
    this.worker.on('error', () => {
      // worker 崩溃：唤醒等待者
      if (this.pending) {
        clearTimeout(this.pending.timer);
        const p = this.pending;
        this.pending = null;
        p.resolve({ kind: 'error', message: 'worker 线程崩溃', logs: [] });
      }
    });
  }

  static create(opts: BotRunnerOptions): BotRunner {
    return new BotRunner(opts);
  }

  /**
   * 初始化 bot（加载代码 + 调用 createTank）。
   * 返回 bot 展示名；失败返回错误信息（此时调用方应 terminate 并判负）。
   */
  async init(timeoutMs = 5000): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ ok: false, error: `bot 初始化超时（>${timeoutMs}ms），可能存在死循环` }), timeoutMs);
      const onMsg = (msg: { type: string; name?: string; message?: string }) => {
        if (msg.type === 'ready') {
          clearTimeout(timer);
          this.worker.off('message', onMsg);
          resolve({ ok: true, name: msg.name ?? `bot-${this.botIndex}` });
        } else if (msg.type === 'loadError') {
          clearTimeout(timer);
          this.worker.off('message', onMsg);
          resolve({ ok: false, error: msg.message ?? '加载失败' });
        }
      };
      this.worker.on('message', onMsg);
      this.worker.postMessage({
        type: 'init',
        code: this.opts.code,
        botIndex: this.opts.botIndex,
        seed: this.opts.seed,
        ctx: this.opts.ctx,
      });
    });
  }

  /** 最新一次收到响应的 tick 号。match 层用它区分"慢"与"卡死"。 */
  get aliveTick(): number {
    return this.lastResponsiveTick;
  }

  get isTerminated(): boolean {
    return this.terminated;
  }

  /**
   * 发送一个 tick 请求并等待响应（带预算）。
   * 超时返回 {kind:'timeout'}，动作由调用方记 idle + 违规。
   */
  tick(tickNo: number, view: unknown, budgetMs: number): Promise<TickOutcome> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.pending && this.pending.tick === tickNo) {
          this.pending = null;
          resolve({ kind: 'timeout' });
        }
      }, budgetMs);
      this.pending = { tick: tickNo, resolve, timer };
      this.worker.postMessage({ type: 'tick', tick: tickNo, view });
    });
  }

  terminate(): void {
    if (this.terminated) return;
    this.terminated = true;
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending = null;
    }
    void this.worker.terminate();
  }
}
