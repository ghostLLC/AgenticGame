# Windows 正式代码签名

AgenticGame 的正式发布门禁只接受 Windows Authenticode 状态为 `Valid` 的可执行文件。SHA-256
完整性清单用于发现下载损坏或文件错配，不能替代发布者身份签名；自签名证书也不能作为公开发行完成标准。

## 前置条件

- 一张由受信任 CA 签发、允许 Windows 代码签名的 PFX/P12 证书。
- 证书位置和密码仅放在当前构建机环境变量 `CSC_LINK`、`CSC_KEY_PASSWORD` 中，不写入仓库、配置、
  命令参数或日志。
- Windows、Node.js 20+ 和已经安装的项目依赖。

## 生成正式候选

```powershell
$env:CSC_LINK = 'C:\安全位置\publisher-certificate.pfx'
$env:CSC_KEY_PASSWORD = '<只在本机输入的密码>'
npm run pack:desktop-signed
Remove-Item Env:CSC_LINK
Remove-Item Env:CSC_KEY_PASSWORD
```

该命令按固定顺序执行：

1. 构建桌面游戏与独立 Agent Bridge。
2. 让 electron-builder 对 `win-unpacked` 和 NSIS 安装包执行强制签名；无法签名立即失败。
3. 用 Windows Authenticode 复验目录中的 `AgenticGame.exe`、`AgenticGame-Agent.exe` 和安装包，
   三者必须全部为 `Valid`。
4. 只从已经通过验证的目录刷新 `AgenticGame-win-x64`，删除旧便携候选并重新压缩 ZIP。
5. 再次复验便携目录内两个 EXE，最后才从实际 ZIP 和安装包生成 SHA-256 与 JSON 清单。

可对任意候选单独执行门禁：

```powershell
npm run release:verify-signature -- `
  release\AgenticGame-win-x64\AgenticGame.exe `
  release\AgenticGame-win-x64\AgenticGame-Agent.exe `
  release\AgenticGame-0.1.0-win-x64-setup.exe
```

任何文件缺失、不可读取、未签名、签名无效或不受信任都会返回非零退出码。当前仓库内的 Public Beta B
候选仍是未签名候选；只有在受信任证书构建机上完整执行上述命令并通过后，才可以称为“正式签名产物”。
