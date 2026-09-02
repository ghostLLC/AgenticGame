[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('host', 'guest')]
  [string]$Role,

  [Parameter(Mandatory = $true)]
  [string]$ArtifactPath,

  [string]$ExpectedSha256 = '',

  [ValidateSet('prepare', 'record')]
  [string]$Phase = 'prepare',

  [ValidateSet('pass', 'fail', 'pending')]
  [string]$LanResult = 'pending',

  [ValidateSet('pass', 'fail', 'pending')]
  [string]$RemoteResult = 'pending',

  [ValidateSet('pass', 'fail', 'pending')]
  [string]$RecoveryResult = 'pending',

  [string]$NatNote = '',
  [string]$OutputDirectory = '.\acceptance-results'
)

$ErrorActionPreference = 'Stop'
$artifact = (Resolve-Path -LiteralPath $ArtifactPath).Path
$artifactItem = Get-Item -LiteralPath $artifact
if (-not $artifactItem.PSIsContainer -and $artifactItem.Length -le 0) {
  throw '候选文件为空。'
}

$hash = if ($artifactItem.PSIsContainer) { '' } else { (Get-FileHash -LiteralPath $artifact -Algorithm SHA256).Hash.ToUpperInvariant() }
if ($ExpectedSha256 -and $hash -ne $ExpectedSha256.ToUpperInvariant()) {
  throw "SHA-256 不一致。实际值：$hash"
}

if ($Phase -eq 'prepare') {
  Write-Host "角色：$Role"
  Write-Host "候选：$artifact"
  if ($hash) { Write-Host "SHA-256：$hash" }
  Write-Host '请在两台真实 Windows 设备上使用同一候选，依次完成：'
  Write-Host '1. 同一局域网：附近好友出现、加入、双方准备、完成比赛、双方均可打开公开回放。'
  Write-Host '2. 异地网络：交换邀请与确认；若失败，运行七项连接检查并记录 NAT/网络说明。'
  Write-Host '3. 重启恢复：比赛前关闭双方应用，24 小时内重开并重新会合原房间。'
  Write-Host '完成后使用 -Phase record 显式记录 pass/fail/pending；脚本不会自动把项目写成通过。'
  exit 0
}

New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$resolvedOutput = (Resolve-Path -LiteralPath $OutputDirectory).Path
$record = [ordered]@{
  schemaVersion = 1
  role = $Role
  recordedAt = (Get-Date).ToUniversalTime().ToString('o')
  artifactName = $artifactItem.Name
  artifactSha256 = $hash
  lanResult = $LanResult
  remoteResult = $RemoteResult
  recoveryResult = $RecoveryResult
  natNote = $NatNote
}
$target = Join-Path $resolvedOutput "friend-room-$Role.json"
$record | ConvertTo-Json | Set-Content -LiteralPath $target -Encoding UTF8
Write-Host "验收记录已保存：$target"
