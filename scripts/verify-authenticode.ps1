param(
  [Parameter(Mandatory = $true)]
  [string] $TargetPath
)

$ErrorActionPreference = 'Stop'
$securityModule = Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1'
Import-Module -Name $securityModule -ErrorAction Stop
$resolved = (Resolve-Path -LiteralPath $TargetPath).Path
$signature = Get-AuthenticodeSignature -LiteralPath $resolved
$subject = if ($null -ne $signature.SignerCertificate) {
  $signature.SignerCertificate.Subject
} else {
  ''
}
$thumbprint = if ($null -ne $signature.SignerCertificate) {
  $signature.SignerCertificate.Thumbprint
} else {
  ''
}

[pscustomobject]@{
  status = [string] $signature.Status
  subject = $subject
  thumbprint = $thumbprint
} | ConvertTo-Json -Compress
