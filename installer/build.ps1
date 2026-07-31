#Requires -Version 5.1
<#
.SYNOPSIS
  Build standalone WeighingSystem.exe and optional Windows installer.

.DESCRIPTION
  1. Builds frontend (npm run build)
  2. Packages Python backend + frontend with PyInstaller
  3. Prepares smoke checklist for unattended EXE verification
  4. Creates setup EXE with Inno Setup (if installed)

  Dual packaging (UC-07 / stage 7):
  - Default (basic): server/requirements.txt without OpenCV; weighing-system.spec
    excludes cv2; OutputBaseFilename=WeighingSystem-Setup
  - -Full: server/requirements-full.txt (+ opencv-python-headless); weighing-system-full.spec;
    OutputBaseFilename=WeighingSystem-Full-Setup. Full without OpenCV deps fails the build.

.PARAMETER SkipFrontend
  Skip npm run build when dist/ is already prepared.

.PARAMETER SkipInstaller
  Build only dist/WeighingSystem/WeighingSystem.exe without Inno Setup.

.PARAMETER Full
  Build the full delivery (cameras + OpenCV). Default is basic.

.EXAMPLE
  .\installer\build.ps1
  .\installer\build.ps1 -SkipFrontend
  .\installer\build.ps1 -Full
  .\installer\build.ps1 -Full -SkipInstaller
#>
param(
    [switch]$SkipFrontend,
    [switch]$SkipInstaller,
    [switch]$Full
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$SmokeDir = Join-Path $Root 'dist\WeighingSystem\smoke'

if ($Full) {
    $PackagingMode = 'full'
    $SpecPath = Join-Path $Root 'installer\weighing-system-full.spec'
    $RequirementsPath = Join-Path $Root 'server\requirements-full.txt'
    $IssPath = Join-Path $Root 'installer\weighing-system-full.iss'
    $SetupFileName = 'WeighingSystem-Full-Setup.exe'
} else {
    $PackagingMode = 'basic'
    $SpecPath = Join-Path $Root 'installer\weighing-system.spec'
    $RequirementsPath = Join-Path $Root 'server\requirements.txt'
    $IssPath = Join-Path $Root 'installer\weighing-system.iss'
    $SetupFileName = 'WeighingSystem-Setup.exe'
}

$BasicRequirementsPath = Join-Path $Root 'server\requirements.txt'
$FullRequirementsPath = Join-Path $Root 'server\requirements-full.txt'

function Assert-RequiredPackagingTokens {
    param(
        [string]$SpecPath,
        [string]$RequirementsPath,
        [string]$PackagingMode
    )

    if (-not (Test-Path $SpecPath)) {
        throw "PyInstaller spec not found: $SpecPath"
    }
    if (-not (Test-Path $RequirementsPath)) {
        throw "Runtime requirements not found: $RequirementsPath"
    }

    $requirementsText = Get-Content -Path $RequirementsPath -Raw
    if ($requirementsText -notmatch '(?m)^pyserial([<>=!~].*)?$') {
        # Full requirements may include pyserial only via -r requirements.txt
        if ($PackagingMode -eq 'full') {
            $basicText = Get-Content -Path $BasicRequirementsPath -Raw
            if ($basicText -notmatch '(?m)^pyserial([<>=!~].*)?$') {
                throw 'pyserial is missing in server/requirements.txt (referenced by requirements-full.txt)'
            }
        } else {
            throw 'pyserial is missing in server/requirements.txt'
        }
    }

    if ($PackagingMode -eq 'basic') {
        if ($requirementsText -match '(?im)opencv') {
            throw 'Basic server/requirements.txt must not contain opencv (EC-06 documented exclude)'
        }
    } else {
        if ($requirementsText -notmatch '(?im)opencv-python-headless') {
            throw 'Full server/requirements-full.txt must contain opencv-python-headless'
        }
        if (-not (Test-Path $BasicRequirementsPath)) {
            throw 'Basic server/requirements.txt missing (required by requirements-full.txt)'
        }
        $basicText = Get-Content -Path $BasicRequirementsPath -Raw
        if ($basicText -match '(?im)opencv') {
            throw 'Basic server/requirements.txt must not contain opencv'
        }
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
        "'serial'",
        "'cameras'",
        "'photo_storage'",
        "'ticket_photos'"
    )
    foreach ($token in $requiredTokens) {
        if ($specText -notmatch [regex]::Escape($token)) {
            throw "PyInstaller spec missing required hidden import token: $token"
        }
    }

    if ($PackagingMode -eq 'basic') {
        if ($specText -notmatch [regex]::Escape("excludes=['cv2', 'opencv']") -and
            $specText -notmatch [regex]::Escape('excludes=["cv2", "opencv"]') -and
            $specText -notmatch "excludes=\[[^\]]*cv2[^\]]*\]") {
            throw 'Basic PyInstaller spec must exclude cv2/opencv (documented build exclude)'
        }
    } else {
        if ($specText -notmatch [regex]::Escape("'cv2'") -and $specText -notmatch [regex]::Escape('"cv2"')) {
            throw 'Full PyInstaller spec must include cv2 hidden import / opencv hooks'
        }
        if ($specText -match "excludes=\[[^\]]*cv2[^\]]*\]") {
            throw 'Full PyInstaller spec must not exclude cv2'
        }
    }
}

function Assert-StorageLayoutDirectories {
    param(
        [string]$IssPath,
        [string]$ExpectedOutputBaseFilename
    )

    if (-not (Test-Path $IssPath)) {
        throw "Inno Setup script not found: $IssPath"
    }

    $issText = Get-Content -Path $IssPath -Raw
    $requiredDirs = @(
        '{app}\BD',
        '{app}\backup',
        '{app}\logs',
        '{app}\Photo'
    )
    foreach ($dirToken in $requiredDirs) {
        if ($issText -notmatch [regex]::Escape($dirToken)) {
            throw "Inno Setup [Dirs] missing storage layout directory: $dirToken"
        }
    }

    # Storage must stay next to the executable, never inside PyInstaller _MEIPASS.
    if ($issText -match '_MEIPASS') {
        throw 'Inno Setup must not place persistent storage under _MEIPASS'
    }

    if ($ExpectedOutputBaseFilename) {
        $expectedToken = "OutputBaseFilename=$ExpectedOutputBaseFilename"
        if ($issText -notmatch [regex]::Escape($expectedToken)) {
            throw "Inno Setup missing $expectedToken"
        }
    }
}

function Assert-FullOpenCvAvailable {
    <#
    .SYNOPSIS
      Fail the full build when OpenCV is not importable (no silent basic).
    #>
    Write-Host "==> Asserting OpenCV (cv2) is available for full packaging..."
    $probeFile = Join-Path ([System.IO.Path]::GetTempPath()) ("opencv_probe_{0}.py" -f [guid]::NewGuid().ToString('N'))
    @'
import sys
try:
    import cv2
except ImportError as exc:
    print(f"FULL_BUILD_FAIL: opencv missing: {exc}", file=sys.stderr)
    raise SystemExit(2)
print(getattr(cv2, "__version__", "unknown"))
'@ | Set-Content -Path $probeFile -Encoding UTF8
    try {
        $probeResult = & py -3.11 $probeFile 2>&1
        if ($LASTEXITCODE -ne 0) {
            throw @"
Full packaging requires opencv-python-headless (cv2).
Install: py -3.11 -m pip install -r server\requirements-full.txt
Probe output: $probeResult
"@
        }
        Write-Host "==> OpenCV available: $probeResult"
    } finally {
        Remove-Item -Force $probeFile -ErrorAction SilentlyContinue
    }
}

function Invoke-ImportSmoke {
    param(
        [string]$PackagingMode
    )

    $smokeScript = Join-Path $Root 'scripts\smoke_photo_capture.py'
    if (-not (Test-Path $smokeScript)) {
        throw "Import smoke script not found: $smokeScript"
    }

    if ($PackagingMode -eq 'basic') {
        $mode = 'basic-import'
    } else {
        $mode = 'full-import'
    }

    Write-Host "==> Post-build import-smoke (--mode $mode)..."
    & py -3.11 $smokeScript --mode $mode
    if ($LASTEXITCODE -ne 0) {
        throw "Import-smoke failed for packaging mode '$PackagingMode' (mode=$mode). Full without OpenCV must not silently become basic."
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
Write-Host "==> Packaging mode: $PackagingMode"
Write-Host "==> Spec: $SpecPath"
Write-Host "==> Requirements: $RequirementsPath"
Write-Host "==> Validating runtime dependencies for packaging..."
Assert-RequiredPackagingTokens -SpecPath $SpecPath -RequirementsPath $RequirementsPath -PackagingMode $PackagingMode

$expectedIssBase = if ($Full) { 'WeighingSystem-Full-Setup' } else { 'WeighingSystem-Setup' }
Write-Host "==> Validating storage layout directories (BD/, backup/, logs/, Photo/)..."
Assert-StorageLayoutDirectories -IssPath $IssPath -ExpectedOutputBaseFilename $expectedIssBase

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

Write-Host "==> Installing Python build dependencies ($PackagingMode)..."
py -3.11 -m pip install -r $RequirementsPath -r (Join-Path $Root 'server\requirements-build.txt')

if ($Full) {
    Assert-FullOpenCvAvailable
}

Write-Host "==> Packaging with PyInstaller (Python 3.11, mode=$PackagingMode)..."
Remove-Item -Recurse -Force (Join-Path $Root 'build'), (Join-Path $Root 'dist\WeighingSystem') -ErrorAction SilentlyContinue
Push-Location $Root
py -3.11 -m PyInstaller --noconfirm --clean $SpecPath
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
WeighingSystem packaged smoke (non-interactive checklist)
Packaging mode: $PackagingMode

Storage next to WeighingSystem.exe (not _MEIPASS):
- config.ini with [settings].active_year
- BD\weighing-YYYY.db
- BD\.year_rotation.lock (created at runtime during year rotation)
- backup\
- logs\
- Photo\ (ticket JPEG + etalons; also created lazily at runtime)

1) Start dist\WeighingSystem\WeighingSystem.exe
2) Open http://127.0.0.1:5001 in browser
3) Stage 6 yearly archive smoke:
   py -3.11 scripts\smoke_yearly_archive.py --scenario active --base-url http://127.0.0.1:5001 --origin http://127.0.0.1:5001
   py -3.11 scripts\smoke_yearly_archive.py --scenario archive --base-url http://127.0.0.1:5001 --origin http://127.0.0.1:5001
4) Scale adapters runtime smoke:
   py -3.11 scripts\smoke_scale_api.py --base-url http://127.0.0.1:5001 --origin http://127.0.0.1:5001 --expected-site-id default-site --expected-scale-id scale-primary --expected-scale-role primary
5) Photo / capability smoke (stage 7):
   py -3.11 scripts\smoke_photo_capture.py --mode capability --base-url http://127.0.0.1:5001 --origin http://127.0.0.1:5001
   py -3.11 scripts\smoke_photo_capture.py --mode basic-import
   py -3.11 scripts\smoke_photo_capture.py --mode full-import
6) Validate connect -> status -> read -> disconnect for serial_backend path
7) Save evidence in docs\reports\yearly-db-archive\ and docs\implementation\reports\
"@
$smokeGuide | Set-Content -Path $smokeGuidePath -Encoding UTF8
Write-Host "==> Smoke guide ready: $smokeGuidePath"

Invoke-ImportSmoke -PackagingMode $PackagingMode

if ($SkipInstaller) {
    exit 0
}

$iscc = Find-InnoSetup
if (-not $iscc) {
    Write-Warning @"
Inno Setup 6 not found.
Install from https://jrsoftware.org/isinfo.php
Then rerun: .\installer\build.ps1 -SkipFrontend$(if ($Full) { ' -Full' } else { '' })
"@
    exit 0
}

Write-Host "==> Building installer with Inno Setup ($SetupFileName)..."
& $iscc $IssPath

$setupPath = Join-Path $Root "release\$SetupFileName"
if (Test-Path $setupPath) {
    Write-Host "==> Installer ready: $setupPath"
} else {
    throw "Installer build failed (expected $setupPath)."
}
