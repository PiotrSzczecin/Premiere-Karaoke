$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

function Test-Command([string]$Name) {
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Invoke-NativeProcess {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [string[]]$Arguments = @(),
        [switch]$Quiet
    )
    $previousPreference = $ErrorActionPreference
    try {
        # Windows PowerShell zamienia stderr programu w NativeCommandError.
        # Kod wyjścia procesu sprawdzamy sami, więc stderr nie może przerwać launchera.
        $ErrorActionPreference = if ($Quiet) { "SilentlyContinue" } else { "Continue" }
        if ($Quiet) { & $FilePath @Arguments 2>$null } else { & $FilePath @Arguments }
        $script:NativeExitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousPreference
    }
}

function Enable-FFmpeg {
    if (Test-Command "ffmpeg") { return $true }
    $wingetLinks = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Links"
    if (Test-Path -LiteralPath $wingetLinks) { $env:Path = "$wingetLinks;$env:Path" }
    if (Test-Command "ffmpeg") { return $true }
    $wingetPackages = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages"
    if (Test-Path -LiteralPath $wingetPackages) {
        $ffmpeg = Get-ChildItem -LiteralPath $wingetPackages -Filter "ffmpeg.exe" -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($ffmpeg) { $env:Path = "$($ffmpeg.DirectoryName);$env:Path" }
    }
    return (Test-Command "ffmpeg")
}

function Get-Python311 {
    if (Test-Command "py") {
        try {
            & py -3.11 -c "import sys; assert sys.version_info[:2] == (3, 11)" 2>$null
            if ($LASTEXITCODE -eq 0) { return [pscustomobject]@{ Exe = "py"; Args = @("-3.11") } }
        } catch {}
    }

    if (Test-Command "python") {
        try {
            $version = & python -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>$null
            if ($version -eq "3.11") { return [pscustomobject]@{ Exe = "python"; Args = @() } }
        } catch {}
    }

    $localPython = Join-Path $env:LOCALAPPDATA "Programs\Python\Python311\python.exe"
    if (Test-Path -LiteralPath $localPython) { return [pscustomobject]@{ Exe = $localPython; Args = @() } }
    return $null
}

Write-Host ""
Write-Host "Premiere Karaoke - automatyczny helper" -ForegroundColor Cyan
Write-Host "Pierwsze uruchomienie instaluje Python 3.11, FFmpeg i WhisperX." -ForegroundColor DarkGray
Write-Host "Moze to potrwac kilkanascie minut i zajac kilka GB." -ForegroundColor DarkGray
Write-Host ""

$pythonCommand = Get-Python311
if (-not $pythonCommand) {
    Write-Host "Brak Python 3.11. Probuje zainstalowac..." -ForegroundColor Yellow
    if (Test-Command "py") {
        try { Invoke-NativeProcess -FilePath "py" -Arguments @("install", "3.11") } catch {}
    }
    $pythonCommand = Get-Python311
}

if (-not $pythonCommand) {
    if (-not (Test-Command "winget")) {
        throw "Nie znaleziono Python 3.11 ani winget. Zainstaluj Python 3.11 z python.org, zaznacz 'Add Python to PATH', a potem uruchom ten plik ponownie."
    }
    Invoke-NativeProcess -FilePath "winget" -Arguments @("install", "--exact", "--id", "Python.Python.3.11", "--scope", "user", "--accept-package-agreements", "--accept-source-agreements")
    if ($script:NativeExitCode -ne 0) { throw "Instalacja Python 3.11 przez winget nie powiodla sie." }
    $pythonCommand = Get-Python311
}

if (-not $pythonCommand) { throw "Python 3.11 zostal zainstalowany, ale nie mozna go odnalezc. Zamknij to okno i uruchom plik ponownie." }

if (-not (Enable-FFmpeg)) {
    if (-not (Test-Command "winget")) { throw "Dla MPG/MPEG-2 wymagany jest FFmpeg. Zainstaluj go i uruchom skrypt ponownie." }
    Write-Host "Instaluje FFmpeg potrzebny do MPG/MPEG-2..." -ForegroundColor Yellow
    Invoke-NativeProcess -FilePath "winget" -Arguments @("install", "--exact", "--id", "Gyan.FFmpeg.Essentials", "--accept-package-agreements", "--accept-source-agreements")
    if ($script:NativeExitCode -ne 0) { throw "Instalacja FFmpeg przez winget nie powiodla sie." }
    if (-not (Enable-FFmpeg)) { throw "FFmpeg zostal zainstalowany, ale nie mozna go odnalezc. Zamknij to okno i uruchom plik ponownie." }
}

$venvPython = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $venvPython)) {
    Write-Host "Tworze lokalne srodowisko Python..." -ForegroundColor Yellow
    $pythonExe = $pythonCommand.Exe
    $pythonArgs = $pythonCommand.Args
    Invoke-NativeProcess -FilePath $pythonExe -Arguments (@($pythonArgs) + @("-m", "venv", ".venv"))
    if ($script:NativeExitCode -ne 0) { throw "Nie udalo sie utworzyc folderu .venv." }
}

Write-Host "Sprawdzam biblioteki trybu dokladnego..." -ForegroundColor Yellow
Invoke-NativeProcess -FilePath $venvPython -Arguments @("-c", "import whisperx") -Quiet
if ($script:NativeExitCode -ne 0) {
    Write-Host "Instaluje WhisperX (pierwsze uruchomienie moze potrwac kilkanascie minut)..." -ForegroundColor Yellow
    Invoke-NativeProcess -FilePath $venvPython -Arguments @("-m", "pip", "install", "--upgrade", "pip")
    if ($script:NativeExitCode -ne 0) { throw "Aktualizacja pip nie powiodla sie." }
    Invoke-NativeProcess -FilePath $venvPython -Arguments @("-m", "pip", "install", "-e", ".[exact]")
    if ($script:NativeExitCode -ne 0) { throw "Instalacja WhisperX nie powiodla sie." }
}

Write-Host ""
Write-Host "Helper dziala pod adresem http://127.0.0.1:8765" -ForegroundColor Green
Write-Host "Zostaw to okno otwarte podczas pracy. Zatrzymanie: Ctrl+C." -ForegroundColor Green
Write-Host ""
Invoke-NativeProcess -FilePath $venvPython -Arguments @("-m", "karaoke_sync")
if ($script:NativeExitCode -ne 0) { throw "Helper zakonczyl dzialanie z bledem." }
