// 浏览器控制台服务：免命令行的对战入口。
//
// 页面流程：选择/上传 bot → 点"开战" → POST /api/play 后台跑完整对局 →
// 返回比分与回放地址 → 页内展示 + 跳转 viewer 观看。

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { basename, join } from 'node:path';
import { MAPS } from '../core/maps.js';
import { runMatch } from '../runner/match.js';
import type { MatchSummary } from '../runner/match.js';
import { resolveAsset } from '../runtime/paths.js';

const MY_BOTS_DIR = join(process.cwd(), 'my-bots');
const REPLAYS_DIR = join(process.cwd(), 'replays');

function listMyBots(): string[] {
  if (!existsSync(MY_BOTS_DIR)) return [];
  return readdirSync(MY_BOTS_DIR).filter((f) => f.endsWith('.js'));
}

function safeBotFile(name: string): string | null {
  // 只接受纯文件名 + .js 后缀，防目录穿越
  const b = basename(name);
  if (!/^[\w.\- \u4e00-\u9fa5]+\.js$/.test(b)) return null;
  return b;
}

/** 解析 bot 标识：builtin:<file> | my:<file> | path:<绝对路径> */
function resolveBotRef(ref: string): { path: string } | { error: string } {
  const idx = ref.indexOf(':');
  const kind = idx > 0 ? ref.slice(0, idx) : '';
  const val = ref.slice(idx + 1);
  if (kind === 'builtin') {
    const f = safeBotFile(val);
    if (!f) return { error: `非法文件名: ${val}` };
    const p = join(resolveAsset('botsDir'), f);
    if (!existsSync(p)) return { error: `内置 bot 不存在: ${f}` };
    return { path: p };
  }
  if (kind === 'my') {
    const f = safeBotFile(val);
    if (!f) return { error: `非法文件名: ${val}` };
    const p = join(MY_BOTS_DIR, f);
    if (!existsSync(p)) return { error: `未找到上传的 bot: ${f}` };
    return { path: p };
  }
  if (kind === 'path') {
    if (!existsSync(val)) return { error: `文件不存在: ${val}` };
    return { path: val };
  }
  return { error: `无法识别的 bot 标识: ${ref}` };
}

function readJsonBody(req: IncomingMessage, limit = 8 * 1024 * 1024): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (e) {
        reject(new Error('JSON 解析失败: ' + (e as Error).message));
      }
    });
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, type: string, body: string | Buffer): void {
  res.writeHead(status, { 'content-type': type });
  res.end(body);
}

function json(res: ServerResponse, status: number, obj: unknown): void {
  send(res, status, 'application/json; charset=utf-8', JSON.stringify(obj));
}

function openBrowser(url: string): void {
  const child =
    process.platform === 'win32'
      ? spawn('cmd', ['/c', 'start', '', url], { shell: false, stdio: 'ignore' })
      : process.platform === 'darwin'
        ? spawn('open', [url], { shell: false, stdio: 'ignore' })
        : spawn('xdg-open', [url], { shell: false, stdio: 'ignore' });
  child.on('error', () => console.log(`  （请手动访问 ${url}）`));
}

let matchRunning = false;

async function handlePlay(body: { a?: string; b?: string; mapId?: string; seed?: number; maxTicks?: number }) {
  if (matchRunning) return { status: 409, payload: { error: '已有一场比赛在进行，请稍候' } };
  const aRef = body.a ?? '';
  const bRef = body.b ?? '';
  const a = resolveBotRef(aRef);
  if ('error' in a) return { status: 400, payload: { error: `蓝方: ${a.error}` } };
  const b = resolveBotRef(bRef);
  if ('error' in b) return { status: 400, payload: { error: `红方: ${b.error}` } };

  matchRunning = true;
  try {
    const loadCode = (p: string) => readFileSync(p, 'utf8');
    const { summary, replay } = await runMatch({
      botA: { path: basename(a.path), code: loadCode(a.path) },
      botB: { path: basename(b.path), code: loadCode(b.path) },
      mapId: body.mapId && MAPS[body.mapId] ? body.mapId : 'standard',
      seed: Number.isFinite(Number(body.seed)) ? Number(body.seed) : 42,
      maxTicks: Number.isFinite(Number(body.maxTicks)) && Number(body.maxTicks) > 0 ? Number(body.maxTicks) : undefined,
    });
    mkdirSync(REPLAYS_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const file = `${stamp}-${summary.botNames[0]}-vs-${summary.botNames[1]}.json`.replace(/[^\w.-]+/g, '_');
    writeFileSync(join(REPLAYS_DIR, file), JSON.stringify(replay), 'utf8');
    return { status: 200, payload: { summary, replayUrl: `/replay/${file}` } };
  } catch (e) {
    return { status: 500, payload: { error: (e as Error).message } };
  } finally {
    matchRunning = false;
  }
}

export function startUiServer(opts: { port?: number; open?: boolean } = {}): void {
  const preferred = opts.port ?? 8188;

  const server = createServer((req, res) => {
    void (async () => {
      const url = (req.url ?? '/').split('?')[0]!;
      try {
        if (req.method === 'GET' && url === '/favicon.ico') {
          res.writeHead(204);
          res.end();
        } else if (req.method === 'GET' && (url === '/' || url === '/index.html')) {
          send(res, 200, 'text/html; charset=utf-8', readFileSync(resolveAsset('console'), 'utf8'));
        } else if (req.method === 'GET' && url === '/viewer') {
          send(res, 200, 'text/html; charset=utf-8', readFileSync(resolveAsset('viewer'), 'utf8'));
        } else if (req.method === 'GET' && url === '/api/spec') {
          send(res, 200, 'text/markdown; charset=utf-8', readFileSync(resolveAsset('spec'), 'utf8'));
        } else if (req.method === 'GET' && url === '/api/bots') {
          const builtin = readdirSync(resolveAsset('botsDir'))
            .filter((f) => f.endsWith('.js'))
            .map((f) => ({ id: `builtin:${f}`, label: f.replace(/\.js$/, ''), group: '内置基准' }));
          const mine = listMyBots().map((f) => ({ id: `my:${f}`, label: f.replace(/\.js$/, ''), group: '我的 bot' }));
          json(res, 200, { bots: [...mine, ...builtin] });
        } else if (req.method === 'GET' && url === '/api/replays') {
          mkdirSync(REPLAYS_DIR, { recursive: true });
          const files = readdirSync(REPLAYS_DIR)
            .filter((f) => f.endsWith('.json'))
            .map((f) => ({ f, m: statSync(join(REPLAYS_DIR, f)).mtimeMs }))
            .sort((x, y) => y.m - x.m)
            .slice(0, 20)
            .map((x) => ({ file: x.f, url: `/replay/${x.f}` }));
          json(res, 200, { replays: files });
        } else if (req.method === 'GET' && url.startsWith('/replay/')) {
          const file = safeReplayName(url.slice('/replay/'.length));
          const p = file && join(REPLAYS_DIR, file);
          if (p && existsSync(p)) send(res, 200, 'application/json; charset=utf-8', readFileSync(p));
          else send(res, 404, 'text/plain', 'not found');
        } else if (req.method === 'POST' && url === '/api/upload') {
          const body = (await readJsonBody(req)) as { name?: string; code?: string };
          const raw = String(body.name ?? 'my-tank.js');
          const file = safeBotFile(raw.endsWith('.js') ? raw : raw + '.js');
          if (!file) return json(res, 400, { error: '文件名只允许中文/字母/数字/空格/._- 且以 .js 结尾' });
          const code = String(body.code ?? '');
          if (!code.trim()) return json(res, 400, { error: '文件内容为空' });
          mkdirSync(MY_BOTS_DIR, { recursive: true });
          writeFileSync(join(MY_BOTS_DIR, file), code, 'utf8');
          json(res, 200, { id: `my:${file}`, label: file.replace(/\.js$/, '') });
        } else if (req.method === 'POST' && url === '/api/play') {
          const body = (await readJsonBody(req)) as Parameters<typeof handlePlay>[0];
          const r = await handlePlay(body);
          json(res, r.status, r.payload);
        } else {
          send(res, 404, 'text/plain', 'not found');
        }
      } catch (e) {
        json(res, 500, { error: (e as Error).message });
      }
    })();
  });

  // 从偏好端口开始尝试，避免"端口被占"打扰
  let port = preferred;
  const tryListen = (p: number): void => {
    server.removeAllListeners('error');
    server.once('error', () => {
      if (p < preferred + 10) tryListen(p + 1);
      else {
        console.error('  无可用端口（8188-8197 都被占用）');
        process.exit(1);
      }
    });
    server.listen(p, () => {
      const url = `http://localhost:${p}`;
      console.log('');
      console.log('  ═══ 坦克竞技场 · 控制台 ═══');
      console.log(`  地址: ${url}   （Ctrl+C 退出）`);
      console.log(`  上传的 bot 保存于: ${MY_BOTS_DIR}`);
      console.log(`  回放保存于: ${REPLAYS_DIR}`);
      console.log('');
      if (opts.open !== false) openBrowser(url);
    });
  };
  tryListen(port);
}

function safeReplayName(seg: string): string | null {
  const b = basename(decodeURIComponent(seg));
  return /^[\w.\-]+\.json$/.test(b) ? b : null;
}

export type { MatchSummary };
