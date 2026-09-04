param(
  [Parameter(Mandatory = $true)]
  [string]$SourceDirectory,

  [Parameter(Mandatory = $true)]
  [string]$ArchivePath
)

$ErrorActionPreference = 'Stop'
$source = [System.IO.Path]::GetFullPath($SourceDirectory)
$archive = [System.IO.Path]::GetFullPath($ArchivePath)

if (-not (Test-Path -LiteralPath $source -PathType Container)) {
  throw "便携版目录不存在: $source"
}

$items = @(Get-ChildItem -LiteralPath $source -Force)
if ($items.Count -eq 0) {
  throw "便携版目录为空: $source"
}

if (Test-Path -LiteralPath $archive) {
  Remove-Item -LiteralPath $archive -Force
}

Compress-Archive -LiteralPath $items.FullName -DestinationPath $archive -CompressionLevel Optimal
