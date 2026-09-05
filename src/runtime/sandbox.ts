// Host supervisor. Untrusted code executes only in QuickJS/WASM in a child process.
import { fork, spawn, type ChildProcess } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPackaged, resolveAsset } from './paths.js';

let workerPathCache: string | null = null;
export function getWorkerPath(): string {
  if (workerPathCache) return workerPathCache;
  const source = resolveAsset('worker');
  if (source.endsWith('.mjs')) return source;
  // A private, unique directory avoids predictable shared-temp script substitution.
  // Materialize ASAR/pkg resources before starting Electron in Node mode.
  const directory = mkdtempSync(join(tmpdir(), 'agentic-bot-'));
  const path = join(directory, 'worker.cjs');
  writeFileSync(path, readFileSync(source), {flag:'wx',mode:0o600});
  process.once('exit', () => { try { rmSync(directory, {recursive:true,force:true}); } catch { /* OS may still be releasing a child. */ } });
  workerPathCache = path;
  return path;
}

export type TickOutcome =
  | {kind:'ok';action:unknown;logs:string[]}
  | {kind:'timeout'}
  | {kind:'error';message:string;logs:string[]};
export interface BotRunnerOptions {
  code:string;
  botIndex:0|1;
  seed:number;
  ctx:Record<string,unknown>;
  workerUrl:URL;
}
type InitResult = {ok:true;name:string}|{ok:false;error:string};
interface PendingWait {tick:number;resolve:(value:TickOutcome)=>void;timer:NodeJS.Timeout;}

export class BotRunner {
  readonly botIndex:0|1;
  private child:ChildProcess;
  private pending:PendingWait|null = null;
  private initialization: {resolve:(value:InitResult)=>void;timer:NodeJS.Timeout}|null = null;
  private initialized = false;
  private lastResponsiveTick = -1;
  private terminated = false;
  lastLogs:string[] = [];

  private constructor(private opts:BotRunnerOptions) {
    if (typeof opts.code !== 'string' || Buffer.byteLength(opts.code)>256*1024) throw new Error('战术源码超过 256 KiB 限制');
    const context = JSON.stringify(opts.ctx);
    if (!context || Buffer.byteLength(context)>1024*1024) throw new Error('战术上下文过大');
    this.botIndex = opts.botIndex;
    // Never inherit API keys, user profiles, Node options or arbitrary environment values.
    const env:NodeJS.ProcessEnv = {};
    for (const key of ['SystemRoot','SYSTEMROOT','WINDIR','TEMP','TMP']) if (process.env[key]) env[key] = process.env[key];
    env.ELECTRON_RUN_AS_NODE = '1';
    const options = {env,windowsHide:true,stdio:['ignore','ignore','ignore','ipc'] as ['ignore','ignore','ignore','ipc'],serialization:'json' as const};
    this.child = isPackaged()
      ? spawn(process.execPath, ['--agentic-bot-child'], options)
      : fork(fileURLToPath(opts.workerUrl), [], {...options,execArgv:['--max-old-space-size=128','--stack-size=1024']});
    this.child.on('message', (raw) => {
      if (!raw || typeof raw !== 'object' || Buffer.byteLength(JSON.stringify(raw))>16*1024) {this.terminate();return;}
      const msg = raw as {type?:string;tick?:number;action?:unknown;logs?:unknown;message?:string;name?:string;fatal?:boolean};
      if (this.initialization && (msg.type==='ready'||msg.type==='loadError')) {
        const initialization = this.initialization; this.initialization = null;
        clearTimeout(initialization.timer);
        this.initialized = msg.type==='ready';
        initialization.resolve(this.initialized ? {ok:true,name:String(msg.name??`bot-${this.botIndex}`).slice(0,40)} : {ok:false,error:String(msg.message??'加载失败').slice(0,400)});
      }
      if (typeof msg.tick==='number') this.lastResponsiveTick = Math.max(this.lastResponsiveTick,msg.tick);
      if (this.pending && msg.tick===this.pending.tick && (msg.type==='action'||msg.type==='error')) {
        const pending = this.pending; this.pending = null; clearTimeout(pending.timer);
        this.lastLogs = Array.isArray(msg.logs) ? msg.logs.slice(0,5).map(v=>String(v).slice(0,1024)) : [];
        pending.resolve(msg.type==='action' ? {kind:'ok',action:msg.action,logs:this.lastLogs} : {kind:'error',message:String(msg.message??'执行失败').slice(0,400),logs:this.lastLogs});
        if (msg.fatal === true) this.terminate();
      }
    });
    this.child.on('error', () => this.terminate());
    this.child.on('exit', () => this.terminate());
  }
  static create(opts:BotRunnerOptions):BotRunner {return new BotRunner(opts);}
  init(timeoutMs=5000):Promise<InitResult> {
    if (this.terminated || this.initialization || this.initialized) return Promise.resolve({ok:false,error:'Bot 进程状态不可用'});
    return new Promise(resolve => {
      const timer = setTimeout(()=>this.terminate(),timeoutMs);
      this.initialization = {resolve,timer};
      this.send({type:'init',code:this.opts.code,botIndex:this.botIndex,seed:this.opts.seed,ctx:this.opts.ctx});
    });
  }
  get aliveTick():number {return this.lastResponsiveTick;}
  get isTerminated():boolean {return this.terminated;}
  tick(tickNo:number,view:unknown,budgetMs:number):Promise<TickOutcome> {
    if (this.terminated || !this.initialized || this.pending) return Promise.resolve({kind:'error',message:'Bot 进程不可用',logs:[]});
    const serialized = JSON.stringify(view);
    if (!serialized || Buffer.byteLength(serialized)>1024*1024) return Promise.resolve({kind:'error',message:'战场视图过大',logs:[]});
    const executionBudgetMs = Number.isFinite(budgetMs) ? Math.max(1,Math.min(budgetMs,1000)) : 30;
    // Guest execution has its own interrupt deadline. IPC scheduling/serialization
    // must not consume that budget; the supervisor still enforces a bounded wait.
    const responseTimeoutMs = executionBudgetMs + 500;
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        if (this.pending?.tick!==tickNo) return;
        this.pending = null;
        resolve({kind:'timeout'});
        this.terminate();
      },responseTimeoutMs);
      this.pending = {tick:tickNo,resolve,timer};
      this.send({type:'tick',tick:tickNo,view,budgetMs:executionBudgetMs});
    });
  }
  terminate():void {
    if (this.terminated) return;
    this.terminated = true;
    if (this.initialization) {
      clearTimeout(this.initialization.timer);
      this.initialization.resolve({ok:false,error:'战术进程已结束或初始化超时'});
      this.initialization = null;
    }
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.resolve({kind:'error',message:'战术进程已结束',logs:[]});
      this.pending = null;
    }
    if (!this.child.killed) this.child.kill('SIGKILL');
  }
  private send(value:unknown):void {
    if (!this.child.connected) {this.terminate();return;}
    this.child.send(value as object, error=>{if(error)this.terminate();});
  }
}
