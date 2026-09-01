import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDefaultFriendRoomIceProfileV1 } from '../src/friend-room/browser-connection-v1.js';
import {
  createDesktopBrowserWindowOptionsV1,
  friendRoomPlayerStatusV1,
} from '../src/desktop/window-contract-v1.js';

describe('桌面游戏外壳 v1', () => {
  it('把联机凭据呈现成游戏邀请卡，而不是暴露成技术文本', () => {
    const html = readFileSync(
      fileURLToPath(new URL('../src/desktop/renderer/index.html', import.meta.url)),
      'utf8',
    );
    const css = readFileSync(
      fileURLToPath(new URL('../src/desktop/renderer/styles.css', import.meta.url)),
      'utf8',
    );

    expect(html).toContain('<link rel="icon" href="data:,">');
    expect(html.match(/class="signal-field"/g)).toHaveLength(8);
    expect(html).toContain('邀请卡已准备好');
    expect(html).toContain('点击后粘贴朋友发来的内容');
    expect(html).toContain('进入战前准备');
    expect(html).toContain('锁定战术');
    expect(html).toContain('准备出战');
    expect(html).toContain('本场战报');
    expect(html).toContain('重新与好友会合');
    expect(html).toContain('生成会合邀请');
    expect(html).toContain('接好友回来');
    expect(css).toContain('.signal-field textarea { color: transparent;');
    expect(css).toContain('.recovery-actions .signal-field textarea { color: transparent;');
    expect(css).toContain('[hidden] { display: none !important; }');
  });

  it('提供正常游戏风格的指挥中心与可恢复首次体验', () => {
    const html = readFileSync(
      fileURLToPath(new URL('../src/desktop/renderer/index.html', import.meta.url)),
      'utf8',
    );

    expect(html).toContain('id="page-command-center"');
    expect(html).toContain('id="page-friend-room"');
    expect(html).toContain('指挥中心');
    expect(html).toContain('开始教学战斗');
    expect(html).toContain('选择你的作战风格');
    expect(html).toContain('id="command-friend-title"');
    expect(html).toContain('快速练习');
    expect(html).toContain('完成教学，进入指挥中心');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).not.toMatch(/开发者控制台|developer console|调试终端/i);
  });

  it('提供完整的车库与战术实验室玩家流程，而不是技术控制台', () => {
    const html = readFileSync(
      fileURLToPath(new URL('../src/desktop/renderer/index.html', import.meta.url)),
      'utf8',
    );
    const css = readFileSync(
      fileURLToPath(new URL('../src/desktop/renderer/styles.css', import.meta.url)),
      'utf8',
    );

    expect(html).toContain('id="nav-garage"');
    expect(html).toContain('id="nav-practice"');
    expect(html).toContain('id="page-garage"');
    expect(html).toContain('id="page-practice"');
    expect(html).toContain('我的车库');
    expect(html).toContain('版本历史');
    expect(html).toContain('保存为新版本');
    expect(html).toContain('战术实验室');
    expect(html).toContain('新版本对战旧版本');
    expect(html).toContain('镜像训练');
    for (const id of [
      'garage-loading', 'garage-empty', 'garage-damaged', 'garage-content',
      'practice-empty', 'practice-running', 'practice-success',
    ]) expect(html).toContain(`id="${id}"`);
    expect(html).not.toMatch(/module\.exports|codeHash|bundleHash|随机种子|JSON/i);
    expect(css).toContain('.garage-layout');
    expect(css).toContain('.practice-arena');
  });

  it('提供正常游戏风格的回放工作室、统一播放器与可恢复回收站', () => {
    const html = readFileSync(
      fileURLToPath(new URL('../src/desktop/renderer/index.html', import.meta.url)),
      'utf8',
    );
    const css = readFileSync(
      fileURLToPath(new URL('../src/desktop/renderer/styles.css', import.meta.url)),
      'utf8',
    );
    for (const id of [
      'nav-replays', 'page-replays', 'replay-library-loading', 'replay-library-empty',
      'replay-library-damaged', 'replay-library-content', 'replay-library-cards',
      'replay-library-player', 'replay-library-battlefield', 'replay-library-timeline',
      'replay-trash-panel', 'replay-delete-sheet', 'replay-empty-trash-sheet',
    ]) expect(html).toContain(`id="${id}"`);
    expect(html).toContain('回放工作室');
    expect(html).toContain('完整战术回放');
    expect(html).toContain('移到回收站');
    expect(html).toContain('恢复回放');
    expect(html).toContain('保存回放文件');
    expect(html).toContain('保存复盘笔记');
    expect(html).not.toMatch(/复制路径|复制哈希|源代码|随机种子|JSON|module\.exports|codeHash|bundleHash/i);
    expect(css).toContain('.replay-library-layout');
    expect(css).toContain('.replay-card-grid');
  });

  it('把附近好友、重启续接和连接诊断做成正常游戏流程', () => {
    const html = readFileSync(
      fileURLToPath(new URL('../src/desktop/renderer/index.html', import.meta.url)),
      'utf8',
    );
    const css = readFileSync(
      fileURLToPath(new URL('../src/desktop/renderer/styles.css', import.meta.url)),
      'utf8',
    );
    const renderer = readFileSync(
      fileURLToPath(new URL('../src/desktop/renderer.ts', import.meta.url)),
      'utf8',
    );
    for (const id of [
      'command-friend-card', 'command-friend-title', 'pairing-nearby', 'pairing-remote',
      'nearby-panel', 'nearby-host-name', 'nearby-create-room', 'nearby-guest-name',
      'nearby-friend-list', 'remote-panel', 'friend-diagnostics-run', 'friend-diagnostics-results',
      'leave-room-sheet', 'confirm-leave-room', 'cancel-leave-room',
    ]) expect(html).toContain(`id="${id}"`);
    expect(html).toContain('同一网络的好友会自动出现');
    expect(html).toContain('异地邀请');
    expect(html).toContain('双方需要同时在线');
    expect(html).toContain('Windows 防火墙');
    expect(html).toContain('部分网络可能无法异地直连');
    expect(renderer).toContain('inspectRecovery()');
    expect(renderer).toContain('friendRoom.restore()');
    expect(renderer).toContain('friendRoom.stopNearby()');
    expect(renderer).toContain('friendRoom.leave(true)');
    expect(renderer).toContain('cancelLeaveButton.focus()');
    expect(renderer).toContain("event.key === 'Escape'");
    expect(html).not.toMatch(/UDP|WebRTC|DataChannel|AGFR|复制路径|恢复密文|源代码/i);
    expect(css).toContain('.pairing-mode-switch');
    expect(css).toContain('.nearby-friend-card');
    expect(css).toContain('.diagnostic-result-grid');
  });

  it('提供玩家化 AI 战术教练，不在默认界面保留密钥或暴露技术载荷', () => {
    const html = readFileSync(
      fileURLToPath(new URL('../src/desktop/renderer/index.html', import.meta.url)),
      'utf8',
    );
    const renderer = readFileSync(
      fileURLToPath(new URL('../src/desktop/renderer.ts', import.meta.url)),
      'utf8',
    );
    for (const id of [
      'nav-agent-center', 'page-agent-center', 'agent-build', 'agent-provider', 'agent-base-url',
      'agent-model', 'agent-api-key', 'agent-goal', 'agent-run', 'agent-cancel', 'agent-result',
      'agent-result-wins', 'agent-result-hp', 'agent-result-violations', 'agent-save-label',
      'agent-save-note', 'agent-save',
    ]) expect(html).toContain(`id="${id}"`);
    expect(html).toContain('AI 战术教练');
    expect(html).toContain('密钥仅用于本次运行');
    expect(html).toContain('保存为新版本');
    expect(html).toContain('3 场');
    expect(html).toContain('5 场');
    expect(html).toContain('10 场');
    expect(renderer).toContain("navigateApp('agent-center')");
    expect(html).not.toMatch(/module\.exports|codeHash|bundleHash|seed|transcript|toolCall|MCP|JSON/i);
  });

  it('桌面包携带比赛沙盒，好友准备完成后可以真正开赛', () => {
    const buildScript = readFileSync(
      fileURLToPath(new URL('../scripts/build-desktop.mjs', import.meta.url)),
      'utf8',
    );
    expect(buildScript).toContain("src/runtime/bot-worker.mjs");
    expect(buildScript).toContain("join(output, 'bot-worker.js')");
    const folderPackScript = readFileSync(
      fileURLToPath(new URL('../scripts/pack-desktop-folder.mjs', import.meta.url)),
      'utf8',
    );
    expect(folderPackScript).toContain("join(releaseRoot, 'AgenticGame-win-x64')");
    expect(folderPackScript).toContain("renameSync(join(target, 'electron.exe'), join(target, 'AgenticGame.exe'))");
  });

  it('用隔离的本地游戏窗口承载界面，而不是把 Node 权限交给渲染层', () => {
    expect(createDesktopBrowserWindowOptionsV1('D:/AgenticGame/dist/preload.cjs')).toEqual({
      width: 1440,
      height: 900,
      minWidth: 1100,
      minHeight: 700,
      show: false,
      backgroundColor: '#1a1614',
      autoHideMenuBar: true,
      title: 'AgenticGame · 坦克竞技场',
      webPreferences: {
        preload: 'D:/AgenticGame/dist/preload.cjs',
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
  });

  it('默认使用无需自有账号的公网地址发现，并且不悄悄依赖中继服务器', () => {
    expect(createDefaultFriendRoomIceProfileV1()).toEqual({
      mode: 'stun',
      urls: ['stun:stun.cloudflare.com:3478'],
    });
  });

  it('把底层连接状态翻译成正常游戏语言', () => {
    expect(friendRoomPlayerStatusV1('waiting-answer')).toEqual({
      eyebrow: '邀请卡已生成',
      title: '等待朋友回应',
      detail: '把邀请卡发给朋友，收到加入确认后粘贴回来。',
      tone: 'waiting',
    });
    expect(friendRoomPlayerStatusV1('connected')).toEqual({
      eyebrow: '好友已连接',
      title: '可以进入战前准备',
      detail: '双方的战术配置会在房间内自动同步。',
      tone: 'success',
    });
    expect(friendRoomPlayerStatusV1('failed')).toEqual({
      eyebrow: '未能连接',
      title: '请重新邀请好友',
      detail: '检查双方是否在线，然后重新创建好友房间。',
      tone: 'danger',
    });
    expect(friendRoomPlayerStatusV1('disconnected')).toEqual({
      eyebrow: '好友暂时离线',
      title: '重新与好友会合',
      detail: '房间仍然保留，房主可以生成新的会合邀请。',
      tone: 'danger',
    });

    const allPlayerCopy = JSON.stringify([
      friendRoomPlayerStatusV1('idle'),
      friendRoomPlayerStatusV1('gathering'),
      friendRoomPlayerStatusV1('waiting-answer'),
      friendRoomPlayerStatusV1('waiting-host'),
      friendRoomPlayerStatusV1('connecting'),
      friendRoomPlayerStatusV1('connected'),
      friendRoomPlayerStatusV1('disconnected'),
      friendRoomPlayerStatusV1('failed'),
    ]);
    expect(allPlayerCopy).not.toMatch(/P2P|WebRTC|offer|answer|STUN|TURN|DataChannel|AGFR/i);
  });
});
