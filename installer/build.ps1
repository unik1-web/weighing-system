#Requires -Version 5.1
<#
.SYNOPSIS
  Build standalone WeighingSystem.exe and optional Windows installer.

.DESCRIPTION
  1. Builds frontend (npm run build)
  2. Packages Python backend + frontend with PyInstaller
  3. Prepares smoke checklist for unattended EXE verification
  4. Creates setup EXE with Inno Setup (if installed)

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
$SmokeDir = Join-Path $Root 'dist\WeighingSystem\smoke'
$SpecPath = Join-Path $Root 'installer\weighing-system.spec'
$RequirementsPath = Join-Path $Root 'server\requirements.txt'

function Assert-RequiredPackagingTokens {
    param(
        [string]$SpecPath,
        [string]$RequirementsPath
    )

    if (-not (Test-Path $SpecPath)) {
        throw "PyInstaller spec not found: $SpecPath"
    }
    if (-not (Test-Path $RequirementsPath)) {
        throw "Runtime requirements not found: $RequirementsPath"
    }

    $requirementsText = Get-Content -Path $RequirementsPath -Raw
    if ($requirementsText -notmatch '(?m)^pyserial([<>=!~].*)?$') {
        throw 'pyserial is missing in server/requirements.txt'
    }

    $specText = Get-Content -Path $SpecPath -Raw
    $requiredTokens = @(
        "'scale_api'",
        "'scale_api_guard'",
        "'scale_runtime'",
        "'scale_registry'",
        "'scale_registry_contract'",
        "'scale_integrity'",
        "'scale_transports.serial_backend'",
        "'serial'"
    )
    foreach ($token in $requiredTokens) {
        if ($specText -notmatch [regex]::Escape($token)) {
            throw "PyInstaller spec missing required hidden import token: $token"
        }
    }
}

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
Write-Host "==> Validating runtime dependencies for packaging..."
Assert-RequiredPackagingTokens -SpecPath $SpecPath -RequirementsPath $RequirementsPath

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

Write-Host "==> Preparing smoke instructions..."
New-Item -ItemType Directory -Path $SmokeDir -Force | Out-Null
$smokeGuidePath = Join-Path $SmokeDir 'README-smoke.txt'
$smokeGuide = @"
Scale adapters smoke (non-interactive checklist)

1) Start dist\WeighingSystem\WeighingSystem.exe
2) Open http://127.0.0.1:5001 in browser
3) Run runtime smoke:
   py -3.11 scripts\smoke_scale_api.py --base-url http://127.0.0.1:5001 --origin http://127.0.0.1:5001 --expected-site-id default-site --expected-scale-id scale-primary --expected-scale-role primary
4) Validate connect -> status -> read -> disconnect for serial_backend path
5) Save evidence in docs\implementation\reports\scale-adapters-smoke.md and scale-adapters-exe-checklist.md
"@
$smokeGuide | Set-Content -Path $smokeGuidePath -Encoding UTF8
Write-Host "==> Smoke guide ready: $smokeGuidePath"

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
