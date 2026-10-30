# Buduje release\KaraokeCaptionsPL-<wersja>.ccx (instalator panelu) i ZIP z całym projektem.
# Wersja pochodzi z packages\panel\manifest.json. Użycie: powershell -File scripts\package-ccx.ps1
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem

$project = Split-Path -Parent $PSScriptRoot
$version = (Get-Content (Join-Path $project "packages\panel\manifest.json") -Raw | ConvertFrom-Json).version

function New-Zip([string]$Out, [string]$Base, $Files) {
  if (Test-Path -LiteralPath $Out) { [IO.File]::Delete($Out) }
  $zip = [IO.Compression.ZipFile]::Open($Out, [IO.Compression.ZipArchiveMode]::Create)
  try {
    foreach ($file in $Files) {
      # UXP wymaga ukośników "/" w nazwach wpisów; Compress-Archive w PS 5.1 zapisuje "\".
      $name = $file.FullName.Substring($Base.Length + 1) -replace '\\', '/'
      [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $file.FullName, $name)
    }
  } finally { $zip.Dispose() }
}

$release = Join-Path $project "release"
New-Item -ItemType Directory -Force $release | Out-Null

$panel = Join-Path $project "packages\panel"
$panelFiles = Get-ChildItem -Recurse -File $panel | Where-Object { $_.FullName -notmatch '\\src\\' }
New-Zip (Join-Path $release "KaraokeCaptionsPL-$version.ccx") $panel $panelFiles

$allFiles = Get-ChildItem -Recurse -File $project | Where-Object { $_.FullName -notmatch '\\release\\|\\node_modules\\|\\__pycache__\\|\\\.venv\\' }
New-Zip (Join-Path $release "Premiere-Karaoke-UXP-$version.zip") (Split-Path $project) $allFiles

Get-ChildItem $release | ForEach-Object { "$($_.Name)  $($_.Length) B" }
