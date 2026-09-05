// Trusted process entry. Bot code only runs inside a separate QuickJS/WASM realm.
// No host functions or objects are exported to that realm, including console/rng.
import { newQuickJSWASMModuleFromVariant, newVariant, DefaultIntrinsics } from 'quickjs-emscripten-core';
import variant from '@jitl/quickjs-wasmfile-release-sync';

const MAX_SOURCE_BYTES = 256 * 1024;
const MAX_INPUT_BYTES = 1024 * 1024;
const MAX_OUTPUT_BYTES = 16 * 1024;
const wasmOptions = { wasmMemory: new WebAssembly.Memory({ initial: 256, maximum: 1024 }) };
if (typeof __AGENTIC_WASM_BASE64__ !== 'undefined') {
  const bytes = Uint8Array.from(Buffer.from(__AGENTIC_WASM_BASE64__, 'base64'));
  wasmOptions.wasmBinary = bytes.buffer;
}
let vm; let runtime; let api; let tickFunction;
let cpuStart; let cpuBudgetUs = 0; let deadline = 0;
function startExecutionBudget(milliseconds) {
  cpuStart = process.cpuUsage();
  cpuBudgetUs = milliseconds * 1000;
  deadline = performance.now() + milliseconds + 500;
}
function shouldInterrupt() {
  const usage = process.cpuUsage(cpuStart);
  // Charge the isolated process's CPU work, not time when Windows deschedules it.
  // A monotonic wall-clock ceiling and the parent watchdog remain independent.
  return usage.user + usage.system > cpuBudgetUs || performance.now() > deadline;
}
const quickJS = newQuickJSWASMModuleFromVariant(newVariant(variant, wasmOptions));

function post(message) {
  if (process.connected) process.send(message);
}
function readStringResult(result) {
  if (result.error) {
    result.error.dispose();
    throw new Error('战术执行失败：语法、受限 API、时间或内存超出限制');
  }
  try {
    if (vm.typeof(result.value) !== 'string') throw new Error('战术响应格式无效');
    const value = vm.getString(result.value);
    if (Buffer.byteLength(value) > MAX_OUTPUT_BYTES) throw new Error('战术响应超过大小限制');
    return JSON.parse(value);
  } finally { result.value.dispose(); }
}

async function initialize(msg) {
  if (vm) throw new Error('战术已初始化');
  if (typeof msg.code !== 'string' || Buffer.byteLength(msg.code) > MAX_SOURCE_BYTES) throw new Error('战术源码过大');
  const input = JSON.stringify(msg.ctx);
  if (!input || Buffer.byteLength(input) > MAX_INPUT_BYTES) throw new Error('战术上下文过大');
  const module = await quickJS;
  runtime = module.newRuntime();
  runtime.setMemoryLimit(32 * 1024 * 1024);
  runtime.setMaxStackSize(512 * 1024);
  startExecutionBudget(1000);
  runtime.setInterruptHandler(shouldInterrupt);
  vm = runtime.newContext({ intrinsics: { ...DefaultIntrinsics, Date: false, Promise: false } });
  const result = vm.evalCode(`(function() {
    'use strict';
    const stringify = JSON.stringify.bind(JSON), parse = JSON.parse.bind(JSON);
    const text = String, create = Object.create.bind(Object), freeze = Object.freeze.bind(Object);
    let logs = [], total = 0, seed = ${msg.seed >>> 0};
    const ctx = parse(${JSON.stringify(input)});
    ctx.rng = function() {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const log = (...args) => {
      if (logs.length >= 5 || total >= 300) return;
      const parts = [];
      for (let i = 0; i < Math.min(args.length, 5); i++) {
        let value; try { value = typeof args[i] === 'string' ? args[i] : stringify(args[i]); } catch { value = '[unserializable]'; }
        parts.push(text(value).slice(0, 1024));
      }
      logs.push(parts.join(' ').slice(0, 1024)); total++;
    };
    Object.defineProperty(globalThis, 'console', {value: freeze({log, info:log, warn:log, error:log, debug:log})});
    Object.defineProperty(Math, 'random', {value: () => {throw new Error('请使用 ctx.rng()');}, configurable:false, writable:false});
    const module = {exports:{}};
    (function(module, exports, __filename) { 'use strict';\n${msg.code}\n})(module, module.exports, 'bot.js');
    const exported = module.exports;
    const factory = typeof exported === 'function' ? exported : exported && (exported.default || exported.createTank);
    if (typeof factory !== 'function') throw new Error('Bot 必须导出工厂函数');
    const tank = factory(freeze(ctx));
    if (!tank || typeof tank.onTick !== 'function') throw new Error('Bot 必须提供 onTick');
    const name = (typeof tank.name === 'string' && tank.name.trim()) || factory.name || 'bot-${msg.botIndex === 1 ? 1 : 0}';
    return {
      name: text(name).slice(0,40),
      tick(viewJson) {
        logs = [];
        const response = create(null);
        try {
          const action = tank.onTick(parse(viewJson));
          const projected = create(null);
          if (action && typeof action === 'object' && !Array.isArray(action)) {
            for (const key of ['throttle','bodyTurn','turretTurn','fire']) {
              const value = action[key];
              projected[key] = typeof value === 'number' || typeof value === 'boolean' ? value : null;
            }
          }
          response.action = projected;
        } catch (error) { response.error = text(error).slice(0,400); }
        response.logs = logs;
        return stringify(response);
      }
    };
  })()`, 'bot.js');
  if (result.error) { result.error.dispose(); throw new Error('战术加载失败：请检查语法、受限 API 和资源限制'); }
  api = result.value;
  tickFunction = vm.getProp(api, 'tick');
  const name = vm.getProp(api, 'name');
  try { return vm.getString(name).slice(0, 40); } finally { name.dispose(); }
}

// Serialized IPC and a single outstanding request bound memory in the trusted host.
let busy = false;
if (!process.send) throw new Error('Bot entry requires a private process IPC channel');
process.on('message', async (msg) => {
  if (!msg || typeof msg !== 'object' || busy) return;
  busy = true;
  try {
    if (msg.type === 'init') {
      post({ type: 'ready', name: await initialize(msg) });
    } else if (msg.type === 'tick') {
      if (!vm || !api || !tickFunction) throw new Error('Bot 未初始化');
      const view = JSON.stringify(msg.view);
      if (!view || Buffer.byteLength(view) > MAX_INPUT_BYTES) throw new Error('战场视图过大');
      startExecutionBudget(Math.max(1, Math.min(Number(msg.budgetMs) || 30, 1000)));
      const argument = vm.newString(view);
      let response;
      try { response = readStringResult(vm.callFunction(tickFunction, api, argument)); } finally { argument.dispose(); }
      const logs = Array.isArray(response.logs) ? response.logs.slice(0,5).map(v => String(v).slice(0,1024)) : [];
      post(response.error
        ? {type:'error', tick:msg.tick, message:String(response.error).slice(0,400), logs}
        : {type:'action', tick:msg.tick, action:response.action, logs});
    }
  } catch (error) {
    post({type:msg.type === 'init' ? 'loadError' : 'error', fatal:true, tick:msg.tick, message:String(error.message).slice(0,400), logs:[]});
  } finally { busy = false; }
});
process.on('disconnect', () => process.exit(0));
