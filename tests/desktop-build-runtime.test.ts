import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';
import { BotRunner } from '../src/runtime/sandbox.js';

it('loads the production desktop bundle and its standalone Bot outside the source tree', async () => {
  mkdirSync('.tmp', {recursive:true});
  const output = mkdtempSync(resolve('.tmp/desktop-build-'));
  const standalone = mkdtempSync(join(tmpdir(), 'agentic-runtime-test-'));
  let runner:BotRunner|undefined;
  try {
    const built = spawnSync(process.execPath, ['scripts/build-desktop.mjs', '--output', output], {encoding:'utf8'});
    expect(built.status, built.stderr).toBe(0);
    const main = join(output, 'main.cjs');
    const require = createRequire(main);
    const electron = {app:{on(){},requestSingleInstanceLock(){return true;},whenReady(){return new Promise(()=>{});}}, dialog:{showErrorBox(){throw new Error('Desktop bootstrap failed');}}};
    const module = {exports:{}};
    expect(() => new Function('require','module','exports','__filename','__dirname',readFileSync(main,'utf8'))(
      (id:string) => id==='electron' ? electron : require(id), module, module.exports, main, dirname(main),
    )).not.toThrow();
    const worker = join(standalone, 'worker.cjs');
    copyFileSync(join(output,'bot-worker.js'),worker);
    runner = BotRunner.create({code:'module.exports=()=>({name:"packaged bot",onTick(){return {throttle:0,bodyTurn:0,turretTurn:0,fire:true};}});',botIndex:0,seed:1,ctx:{},workerUrl:pathToFileURL(worker)});
    expect(await runner.init()).toEqual({ok:true,name:'packaged bot'});
    expect((await runner.tick(0,{},200)).kind).toBe('ok');
  } finally {
    runner?.terminate();
    rmSync(output,{recursive:true,force:true});
    rmSync(standalone,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  }
}, 30_000);
