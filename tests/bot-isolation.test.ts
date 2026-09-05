import { afterEach, describe, expect, it } from 'vitest';
import { pathToFileURL } from 'node:url';
import { BotRunner, getWorkerPath } from '../src/runtime/sandbox.js';

const runners: BotRunner[] = [];
afterEach(() => { for (const runner of runners.splice(0)) runner.terminate(); });
function create(code: string, seed = 7) {
  const runner = BotRunner.create({ code, seed, botIndex: 0, ctx: {}, workerUrl: pathToFileURL(getWorkerPath()) });
  runners.push(runner);
  return runner;
}

describe('untrusted Bot execution boundary', () => {
  it('cannot reach host process through a constructor', async () => {
    const runner = create('module.exports = () => ({ name: Object.constructor("return process.version")(), onTick() { return {}; } });');
    expect((await runner.init()).ok).toBe(false);
  });

  it('keeps CommonJS and seeded state without host globals', async () => {
    const source = `module.exports = ctx => ({ name: 'bounded bot', onTick() {
      console.log(typeof process, typeof require, typeof Date, typeof fetch, typeof setTimeout);
      return {throttle: ctx.rng() > 0.5 ? 1 : -1, bodyTurn: 0, turretTurn: 0, fire: false};
    }});`;
    const a = create(source); const b = create(source);
    expect(await a.init()).toEqual({ok:true,name:'bounded bot'});
    expect((await b.init()).ok).toBe(true);
    const first = await a.tick(0, {}, 200);
    expect(first.kind).toBe('ok');
    expect(first).toEqual(await b.tick(0, {}, 200));
    if (first.kind === 'ok') expect(first.logs[0]).toBe('undefined undefined undefined undefined undefined');
  });

  it('terminates an unresponsive script and settles pending work', async () => {
    const runner = create('module.exports = () => ({onTick() { while(true) {} }});');
    expect((await runner.init()).ok).toBe(true);
    const started = Date.now();
    expect((await runner.tick(0, {}, 80)).kind).not.toBe('ok');
    runner.terminate();
    expect(Date.now() - started).toBeLessThan(2000);
    expect((await runner.tick(1, {}, 80)).kind).toBe('error');
  });

  it('rejects excess source before launching work', async () => {
    expect(() => create(' '.repeat(300_000))).toThrow(/源码|source/i);
  });

  it('rejects guest allocations above the interpreter memory budget', async () => {
    const runner = create('module.exports = () => ({ onTick() { const memory = new ArrayBuffer(48 * 1024 * 1024); return {throttle: memory.byteLength}; } });');
    expect((await runner.init()).ok).toBe(true);
    expect((await runner.tick(0, {}, 1000)).kind).not.toBe('ok');
  });

  it('bounds logs and converts hostile return values inside the interpreter', async () => {
    const runner = create(`module.exports = () => ({onTick(){
      console.log('x'.repeat(100000));
      return { get throttle(){ while(true){} }, bodyTurn:0, turretTurn:0, fire:false };
    }});`);
    expect((await runner.init()).ok).toBe(true);
    expect((await runner.tick(0, {}, 100)).kind).not.toBe('ok');
  });
});
