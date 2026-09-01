import { randomBytes, randomUUID } from 'node:crypto';
import { createSocket } from 'node:dgram';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { NodeLanDatagramAdapterV1 } from './lan-discovery-v1.js';

export type ReleaseDiagnosticStatusV1 = 'ok' | 'warning' | 'error';

export interface ReleaseDiagnosticItemV1 {
  id: 'data' | 'sandbox' | 'encryption' | 'clipboard' | 'lan' | 'stun' | 'version';
  title: string;
  status: ReleaseDiagnosticStatusV1;
  detail: string;
}

export interface ReleaseDiagnosticReportV1 {
  version: 1;
  generatedAt: string;
  items: ReleaseDiagnosticItemV1[];
}

export interface ReleaseDiagnosticsOptionsV1 {
  dataProbe(): Promise<boolean>;
  sandboxProbe(): Promise<boolean>;
  encryptionAvailable(): boolean;
  clipboardAvailable(): boolean;
  lanProbe(): Promise<boolean>;
  stunProbe(): Promise<boolean>;
  version: string;
  now?: () => string;
}

export class ReleaseDiagnosticsServiceV1 {
  private readonly now: () => string;

  constructor(private readonly options: ReleaseDiagnosticsOptionsV1) {
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async run(): Promise<ReleaseDiagnosticReportV1> {
    const [data, sandbox, lan, stun] = await Promise.all([
      safeProbe(this.options.dataProbe),
      safeProbe(this.options.sandboxProbe),
      safeProbe(this.options.lanProbe),
      safeProbe(this.options.stunProbe),
    ]);
    const encryption = safeAvailable(this.options.encryptionAvailable);
    const clipboard = safeAvailable(this.options.clipboardAvailable);
    return {
      version: 1,
      generatedAt: normalizeNow(this.now()),
      items: [
        result('data', '本地战绩与配置', data, '数据目录可以安全读写。', '本地数据暂时无法安全读写，请检查磁盘空间与系统权限。'),
        result('sandbox', '比赛运行环境', sandbox, '比赛运行环境工作正常。', '比赛运行环境未通过检查，请重启游戏后再试。'),
        encryption
          ? { id: 'encryption', title: '房间安全恢复', status: 'ok', detail: 'Windows 系统加密可用，房间可在 24 小时内安全续接。' }
          : { id: 'encryption', title: '房间安全恢复', status: 'warning', detail: '系统加密不可用，游戏不会明文保存房间恢复信息。' },
        clipboard
          ? { id: 'clipboard', title: '邀请卡剪贴板', status: 'ok', detail: '可以复制和粘贴好友邀请。' }
          : { id: 'clipboard', title: '邀请卡剪贴板', status: 'warning', detail: '剪贴板暂不可用，请使用系统设置检查应用权限。' },
        result('lan', '附近好友', lan, '局域网消息回环正常。', '局域网发现未通过检查，请允许游戏通过 Windows 防火墙。'),
        stun
          ? { id: 'stun', title: '异地直连', status: 'ok', detail: '公网地址发现可用；实际连接仍需要双方同时在线。' }
          : { id: 'stun', title: '异地直连', status: 'warning', detail: '公网地址发现暂不可用；本游戏没有中继服务器，严格 NAT 网络可能无法直连。' },
        { id: 'version', title: '游戏与协议', status: 'ok', detail: `游戏版本 ${safeVersion(this.options.version)} · 好友协议 v1` },
      ],
    };
  }
}

export async function probeWritableDirectoryV1(root: string): Promise<boolean> {
  const directory = join(root, 'diagnostics');
  const id = randomUUID();
  const temporaryPath = join(directory, `${id}.tmp`);
  const finalPath = join(directory, `${id}.probe`);
  try {
    await mkdir(directory, { recursive: true });
    const handle = await open(temporaryPath, 'wx');
    try {
      await handle.writeFile('agentic-game-diagnostic', 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporaryPath, finalPath);
    return await readFile(finalPath, 'utf8') === 'agentic-game-diagnostic';
  } catch {
    return false;
  } finally {
    await rm(temporaryPath, { force: true });
    await rm(finalPath, { force: true });
  }
}

export async function probeUdpLoopbackV1(timeoutMs = 1_500): Promise<boolean> {
  const receiver = new NodeLanDatagramAdapterV1({ port: 0, broadcastAddress: '127.0.0.1' });
  const sender = new NodeLanDatagramAdapterV1({ port: 0, broadcastAddress: '127.0.0.1' });
  try {
    let finish!: (value: boolean) => void;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const received = new Promise<boolean>((resolve) => { finish = resolve; });
    await receiver.start((payload) => {
      if (payload.toString('utf8') !== 'agentic-game-lan-probe') return;
      if (timer) clearTimeout(timer);
      finish(true);
    });
    await sender.start(() => undefined);
    timer = setTimeout(() => finish(false), timeoutMs);
    sender.send(Buffer.from('agentic-game-lan-probe', 'utf8'), { address: '127.0.0.1', port: receiver.getPort() });
    return await received;
  } catch {
    return false;
  } finally {
    receiver.stop();
    sender.stop();
  }
}

export async function probeStunBindingV1(timeoutMs = 2_500): Promise<boolean> {
  const socket = createSocket('udp4');
  const transaction = randomBytes(12);
  const request = Buffer.alloc(20);
  request.writeUInt16BE(0x0001, 0);
  request.writeUInt16BE(0, 2);
  request.writeUInt32BE(0x2112a442, 4);
  transaction.copy(request, 8);
  try {
    return await new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (value: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => finish(false), timeoutMs);
      socket.once('error', () => finish(false));
      socket.on('message', (response) => {
        finish(response.length >= 20
          && response.readUInt16BE(0) === 0x0101
          && response.readUInt32BE(4) === 0x2112a442
          && response.subarray(8, 20).equals(transaction));
      });
      socket.send(request, 19302, 'stun.l.google.com', (error) => { if (error) finish(false); });
    });
  } finally {
    socket.close();
  }
}

function result(
  id: 'data' | 'sandbox' | 'lan',
  title: string,
  ok: boolean,
  successDetail: string,
  failureDetail: string,
): ReleaseDiagnosticItemV1 {
  return { id, title, status: ok ? 'ok' : 'error', detail: ok ? successDetail : failureDetail };
}

async function safeProbe(probe: () => Promise<boolean>): Promise<boolean> {
  try { return (await probe()) === true; } catch { return false; }
}

function safeAvailable(probe: () => boolean): boolean {
  try { return probe() === true; } catch { return false; }
}

function normalizeNow(value: string): string {
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : new Date(0).toISOString();
}

function safeVersion(value: string): string {
  return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value) ? value : '未知';
}
