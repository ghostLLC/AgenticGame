import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = (path: string) => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8');

describe('Public Beta B release policy', () => {
  it('生成当前用户 NSIS 安装包且卸载默认保留玩家数据', () => {
    const pkg = JSON.parse(root('package.json')) as Record<string, any>;
    expect(pkg.scripts['pack:desktop-installer']).toContain('electron-builder --win nsis --x64');
    expect(pkg.build.win.target).toContain('nsis');
    expect(pkg.build.win.signAndEditExecutable).toBe(false);
    expect(pkg.build.nsis).toMatchObject({
      oneClick: false,
      perMachine: false,
      deleteAppDataOnUninstall: false,
      allowToChangeInstallationDirectory: false,
    });
    expect(pkg.build.nsis.artifactName).toContain('setup');
  });

  it('发布说明如实写明未签名、无 TURN、沙盒和实机验收边界', () => {
    const notes = root('docs/releases/0.1.0-public-beta-b.md');
    for (const phrase of ['未签名', 'SmartScreen', '没有中继服务器', '严格 NAT', 'Worker/VM', '两台真实 Windows 设备']) {
      expect(notes).toContain(phrase);
    }
    expect(notes).toContain('不会在卸载时默认删除玩家数据');
  });

  it('提供双机角色化验收脚本与不伪造通过结论的记录模板', () => {
    const script = root('scripts/acceptance/friend-room-two-device.ps1');
    expect(script).toContain("ValidateSet('host', 'guest')");
    expect(script).toContain('Get-FileHash');
    expect(script).toContain("ValidateSet('pass', 'fail', 'pending')");
    expect(script).toContain('lanResult');
    expect(script).toContain('remoteResult');
    expect(script).toContain('recoveryResult');
    expect(script).not.toContain('result = \'pass\'');
  });
});
