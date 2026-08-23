// 坦克竞技场 —— bot 沙盒 worker
//
// 每个 bot 在独立 worker 线程的受限 VM 上下文中运行：
//  - 只暴露白名单全局（Math/JSON/console 等），无 require/process/Date/timer/网络
//  - Math.random 被替换为抛错（请使用 ctx.rng()）
//  - console.log 被收集（限流），随 tick 响应带回主线程，写入回放供调试
//
// 注意：vm 不是硬安全边界，用于防止意外错误与限制资源；恶意逃逸由
// runner 的超时/终止机制兜底（卡死即判负）。比赛级安全隔离在路线图中。

import { parentPort } from 'node:worker_threads';
import vm from 'node:vm';

const LOG_PER_TICK = 5;
const LOG_TOTAL = 300;

const logState = { current: [], total: 0, capped: false, notified: false };

function fmtArg(v) {
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function pushLog(...args) {
  if (logState.total >= LOG_TOTAL) {
    logState.capped = true;
    return;
  }
  if (logState.current.length >= LOG_PER_TICK) return;
  logState.current.push(args.map(fmtArg).join(' '));
  logState.total++;
}

function takeLogs() {
  const out = logState.current;
  logState.current = [];
  if (logState.capped && !logState.notified) {
    logState.notified = true;
    out.push('[sandbox] 日志总量已达上限（300 行），后续输出被丢弃');
  }
  return out;
}

function makeConsole() {
  const fn = (...args) => pushLog(...args);
  return { log: fn, info: fn, warn: fn, error: fn, debug: fn };
}

/** mulberry32 —— 小而快的确定性 PRNG */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Math 的属性是不可枚举的（Object.keys(Math) 为空），不能直接 {...Math} 展开，
// 必须按属性名逐一拷贝，再覆盖 random。
function safeMath() {
  const m = {};
  for (const k of Object.getOwnPropertyNames(Math)) m[k] = Math[k];
  m.random = () => {
    throw new Error('沙盒禁止使用 Math.random() —— 请使用 init ctx 提供的 ctx.rng()');
  };
  return m;
}

function buildContext() {
  const sandbox = {
    Math: safeMath(),
    JSON,
    console: makeConsole(),
    isNaN,
    isFinite,
    parseInt,
    parseFloat,
    Number,
    String,
    Boolean,
    Symbol,
    BigInt,
    Array,
    Object,
    Map,
    Set,
    RegExp,
    Error,
    TypeError,
    RangeError,
    NaN,
    Infinity,
    undefined,
  };
  return vm.createContext(sandbox, { codeGeneration: { strings: false } });
}

let tank = null; // { onTick(view), ... }
let displayName = 'bot';

function loadFactory(code, context) {
  const moduleObj = { exports: {} };
  const fn = vm.compileFunction(code, ['module', 'exports', '__filename'], {
    parsingContext: context,
    filename: 'bot.js',
  });
  fn(moduleObj, moduleObj.exports, 'bot.js');
  const e = moduleObj.exports;
  if (typeof e === 'function') return e;
  if (e && typeof e === 'object') {
    if (typeof e.default === 'function') return e.default;
    if (typeof e.createTank === 'function') return e.createTank;
  }
  throw new Error(
    'bot 文件必须导出工厂函数：module.exports = function createTank(ctx) { ... return { onTick(view) { ... } }; }',
  );
}

function post(msg) {
  parentPort.postMessage(msg);
}

parentPort.on('message', (msg) => {
  if (msg.type === 'init') {
    try {
      const context = buildContext();
      const factory = loadFactory(msg.code, context);
      const ctx = {
        ...msg.ctx,
        rng: mulberry32(msg.seed),
      };
      const t = factory(ctx);
      if (!t || typeof t !== 'object' || typeof t.onTick !== 'function') {
        throw new Error('createTank(ctx) 必须返回一个包含 onTick(view) 函数的对象');
      }
      tank = t;
      displayName =
        (typeof t.name === 'string' && t.name.trim()) || factory.name || `bot-${msg.botIndex}`;
      post({ type: 'ready', name: displayName.slice(0, 40) });
    } catch (e) {
      post({ type: 'loadError', message: e && e.message ? `${e.message}` : String(e) });
    }
    return;
  }

  if (msg.type === 'tick') {
    if (!tank) {
      post({ type: 'error', tick: msg.tick, message: 'bot 未初始化', logs: [] });
      return;
    }
    try {
      const action = tank.onTick(msg.view);
      try {
        post({ type: 'action', tick: msg.tick, action, logs: takeLogs() });
      } catch {
        post({
          type: 'error',
          tick: msg.tick,
          message: 'onTick 返回值无法序列化 —— 请只返回普通对象 {throttle, bodyTurn, turretTurn, fire}',
          logs: takeLogs(),
        });
      }
    } catch (e) {
      post({
        type: 'error',
        tick: msg.tick,
        message: e && e.stack ? String(e.stack).slice(0, 600) : String(e),
        logs: takeLogs(),
      });
    }
  }
});
