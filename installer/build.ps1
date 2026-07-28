#Requires -Version 5.1
<#
.SYNOPSIS
  Build standalone WeighingSystem.exe and optional Windows installer.

.DESCRIPTION
  1. Builds frontend (npm run build)
  2. Packages Python backend + frontend with PyInstaller
  3. Creates setup EXE with Inno Setup (if installed)

.PARAMETER SkipFrontend
  Skip npm run build when dist/ is already prepared.

.PARAMETER SkipInstaller
  Build only dist/WeighingSystem/WeighingSystem.exe without Inno Setup.

.EXAMPLE
  .\installer\build.ps1
  .\installer\build.ps1 -SkipFrontend
#>
param(
    [switch]$SkipFrontend,
    [switch]$SkipInstaller
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot

function Find-InnoSetup {
    $candidates = @(
        "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
        "${env:ProgramFiles}\Inno Setup 6\ISCC.exe"
    )
    foreach ($path in $candidates) {
        if (Test-Path $path) { return $path }
    }
    return $null
}

Write-Host "==> Project root: $Root"

$pythonVersion = (py -3.11 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>$null)
if (-not $pythonVersion) {
    $pythonVersion = python -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"
    Write-Warning "Python 3.11 not found, using $pythonVersion"
} else {
    Write-Host "==> Using Python $pythonVersion for packaging"
}
if ($pythonVersion -notin @('3.11', '3.12')) {
    Write-Warning "Recommended Python 3.11 or 3.12 for Vescom (fdb). Current: $pythonVersion"
}

if (-not $SkipFrontend) {
    Write-Host "==> Building frontend..."
    Push-Location $Root
    npm run build
    Pop-Location
}

if (-not (Test-Path (Join-Path $Root 'dist\index.html'))) {
    throw 'Frontend build not found. Run "npm run build" first.'
}

Write-Host "==> Installing Python build dependencies..."
py -3.11 -m pip install -r (Join-Path $Root 'server\requirements.txt') -r (Join-Path $Root 'server\requirements-build.txt')

Write-Host "==> Packaging with PyInstaller (Python 3.11)..."
Remove-Item -Recurse -Force (Join-Path $Root 'build'), (Join-Path $Root 'dist\WeighingSystem') -ErrorAction SilentlyContinue
Push-Location $Root
py -3.11 -m PyInstaller --noconfirm --clean (Join-Path $Root 'installer\weighing-system.spec')
Pop-Location

$exePath = Join-Path $Root 'dist\WeighingSystem\WeighingSystem.exe'
if (-not (Test-Path $exePath)) {
    throw "PyInstaller output not found: $exePath"
}

Write-Host "==> Standalone app ready: $exePath"
Write-Host "    Copy dist\WeighingSystem\ to any PC and run WeighingSystem.exe"

if ($SkipInstaller) {
    exit 0
}

$iscc = Find-InnoSetup
if (-not $iscc) {
    Write-Warning @"
Inno Setup 6 not found.
Install from https://jrsoftware.org/isinfo.php
Then rerun: .\installer\build.ps1 -SkipFrontend
"@
    exit 0
}

Write-Host "==> Building installer with Inno Setup..."
& $iscc (Join-Path $Root 'installer\weighing-system.iss')

$setupPath = Join-Path $Root 'release\WeighingSystem-Setup.exe'
if (Test-Path $setupPath) {
    Write-Host "==> Installer ready: $setupPath"
} else {
    throw 'Installer build failed.'
}
