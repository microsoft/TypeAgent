<#
.SYNOPSIS
    Sets up the test environment for ScriptFlow import scenario testing.

.DESCRIPTION
    Creates all necessary test data at a target root directory:
      - Git repo with stale branches (Scenario 1)
      - Log files with today's date and mixed severity entries (Scenario 3)
      - CSV files copied to a data directory (Scenario 7)

    Scenarios 2, 4, 5, 6 query live system state and need no test data.

    Also copies the 7 test .ps1 scripts to a scripts/ directory for easy
    import with @scriptflow import <path>.

.PARAMETER TestRoot
    Root directory for all test data. Default: $env:TEMP\scriptflow-test

.PARAMETER Force
    If set, deletes any existing test environment at TestRoot before setup.

.EXAMPLE
    .\Setup-TestEnvironment.ps1
    .\Setup-TestEnvironment.ps1 -TestRoot D:\test\scriptflow -Force
#>
param(
    [string]$TestRoot = "$env:TEMP\scriptflow-test",
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# ── Helpers ──────────────────────────────────────────────────────────────────

function Write-Step($msg) { Write-Host "  [+] $msg" -ForegroundColor Cyan }
function Write-Section($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Green }

# ── Clean slate ──────────────────────────────────────────────────────────────

if ($Force -and (Test-Path $TestRoot)) {
    Write-Host "Removing existing test environment at $TestRoot..."
    Remove-Item -Path $TestRoot -Recurse -Force
}

if (Test-Path $TestRoot) {
    Write-Host "Test environment already exists at $TestRoot"
    Write-Host "Use -Force to recreate, or specify a different -TestRoot"
    return
}

New-Item -Path $TestRoot -ItemType Directory -Force | Out-Null
Write-Host "Setting up test environment at: $TestRoot"

# ── 1. Copy test scripts ────────────────────────────────────────────────────

Write-Section "Test Scripts"
$scriptsOut = Join-Path $TestRoot "scripts"
New-Item -Path $scriptsOut -ItemType Directory -Force | Out-Null
$sourceScripts = Join-Path $ScriptDir "scripts"
Get-ChildItem -Path $sourceScripts -Filter "*.ps1" | ForEach-Object {
    Copy-Item $_.FullName -Destination $scriptsOut
    Write-Step "Copied $($_.Name)"
}

# ── 2. Scenario 1: Git repo with stale branches ─────────────────────────────

Write-Section "Scenario 1: Git Repo with Stale Branches"
$gitRepo = Join-Path $TestRoot "git-repo"
New-Item -Path $gitRepo -ItemType Directory -Force | Out-Null

Push-Location $gitRepo
try {
    git init --quiet
    git config user.email "test@example.com"
    git config user.name "Test User"

    "# Test Project" | Set-Content "README.md"
    git add README.md
    git commit --quiet -m "Initial commit"

    # Detect the default branch name (main or master depending on git config)
    $defaultBranch = (git branch --show-current).Trim()

    # Active branch (1 day old) — recent work
    git checkout --quiet -b "feature/active-work"
    "active work" | Set-Content "feature.ts"
    git add feature.ts
    $recentDate = (Get-Date).AddDays(-1).ToString("yyyy-MM-ddTHH:mm:ss")
    $env:GIT_COMMITTER_DATE = $recentDate
    $env:GIT_AUTHOR_DATE = $recentDate
    git commit --quiet -m "Add feature work"

    # Stale branch (45 days old)
    git checkout --quiet $defaultBranch
    git checkout --quiet -b "feature/old-experiment"
    "experiment" | Set-Content "experiment.ts"
    git add experiment.ts
    $staleDate1 = (Get-Date).AddDays(-45).ToString("yyyy-MM-ddTHH:mm:ss")
    $env:GIT_COMMITTER_DATE = $staleDate1
    $env:GIT_AUTHOR_DATE = $staleDate1
    git commit --quiet -m "Start experiment"

    # Very stale branch (90 days old)
    git checkout --quiet $defaultBranch
    git checkout --quiet -b "bugfix/legacy-fix"
    "legacy fix" | Set-Content "legacy.ts"
    git add legacy.ts
    $staleDate2 = (Get-Date).AddDays(-90).ToString("yyyy-MM-ddTHH:mm:ss")
    $env:GIT_COMMITTER_DATE = $staleDate2
    $env:GIT_AUTHOR_DATE = $staleDate2
    git commit --quiet -m "Fix legacy issue"

    # Borderline stale (35 days old)
    git checkout --quiet $defaultBranch
    git checkout --quiet -b "feature/last-month"
    "last month work" | Set-Content "recent.ts"
    git add recent.ts
    $staleDate3 = (Get-Date).AddDays(-35).ToString("yyyy-MM-ddTHH:mm:ss")
    $env:GIT_COMMITTER_DATE = $staleDate3
    $env:GIT_AUTHOR_DATE = $staleDate3
    git commit --quiet -m "Work from last month"

    # Ancient branch (180 days old)
    git checkout --quiet $defaultBranch
    git checkout --quiet -b "spike/abandoned-prototype"
    "prototype" | Set-Content "proto.ts"
    git add proto.ts
    $staleDate4 = (Get-Date).AddDays(-180).ToString("yyyy-MM-ddTHH:mm:ss")
    $env:GIT_COMMITTER_DATE = $staleDate4
    $env:GIT_AUTHOR_DATE = $staleDate4
    git commit --quiet -m "Abandoned prototype"

    # Return to main
    git checkout --quiet $defaultBranch
    Remove-Item Env:\GIT_COMMITTER_DATE -ErrorAction SilentlyContinue
    Remove-Item Env:\GIT_AUTHOR_DATE -ErrorAction SilentlyContinue

    $branchCount = (git branch | Measure-Object).Count
    Write-Step "Created git repo with $branchCount branches (3 stale at 30-day threshold)"
} finally {
    Pop-Location
}

# ── 3. Scenario 3: Log files with today's date ──────────────────────────────

Write-Section "Scenario 3: Application Log Files"
$logDir = Join-Path $TestRoot "logs"
New-Item -Path $logDir -ItemType Directory -Force | Out-Null

$today = Get-Date -Format "yyyy-MM-dd"
$templateDir = Join-Path $ScriptDir "data\logs"

# Process main log template
$mainTemplate = Get-Content (Join-Path $templateDir "appserver-main.log.template") -Raw
$mainLog = $mainTemplate -replace '\{DATE\}', $today
$mainLog | Set-Content (Join-Path $logDir "AppServer_${today}.log")
Write-Step "AppServer_${today}.log (main — 52 entries, 8 ERROR, 6 WARN, 1 FATAL)"

# Process worker log template
$workerTemplate = Get-Content (Join-Path $templateDir "appserver-worker.log.template") -Raw
$workerLog = $workerTemplate -replace '\{DATE\}', $today
$workerLog | Set-Content (Join-Path $logDir "AppServer_${today}_worker.log")
Write-Step "AppServer_${today}_worker.log (worker — 18 entries, 3 ERROR, 3 WARN)"

# Also create a yesterday log (should NOT be picked up by today's scan)
$yesterday = (Get-Date).AddDays(-1).ToString("yyyy-MM-dd")
"$yesterday 12:00:00.001 [ERROR] Old error from yesterday" |
    Set-Content (Join-Path $logDir "AppServer_${yesterday}.log")
Write-Step "AppServer_${yesterday}.log (yesterday — should be excluded from today's scan)"

# ── 4. Scenario 7: CSV files ─────────────────────────────────────────────────

Write-Section "Scenario 7: CSV Data Files"
$csvSrc = Join-Path $ScriptDir "data\csv"
$csvDst = Join-Path $TestRoot "csv"
New-Item -Path $csvDst -ItemType Directory -Force | Out-Null
Copy-Item -Path "$csvSrc\*.csv" -Destination $csvDst
Write-Step "employees.csv (25 rows — departments, statuses, locations)"
Write-Step "sensor_readings.csv (30 rows — time series with OK/WARN/ERROR/CRITICAL status)"

# ── Summary ──────────────────────────────────────────────────────────────────

Write-Host "`n" -NoNewline
Write-Host "========================================" -ForegroundColor Yellow
Write-Host " Test environment ready!" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow
Write-Host ""
Write-Host "Root: $TestRoot" -ForegroundColor White
Write-Host ""
Write-Host "Directory layout:" -ForegroundColor White
Write-Host "  scripts/            7 test .ps1 files for import"
Write-Host "  git-repo/           Git repo with stale branches (Scenario 1)"
Write-Host "  logs/               Application logs with today's date (Scenario 3)"
Write-Host "  csv/                Employee + sensor CSV files (Scenario 7)"
Write-Host ""
Write-Host "Scenarios using live system data (no setup needed):" -ForegroundColor White
Write-Host "  Scenario 2: Large Files    — run against any real directory"
Write-Host "  Scenario 4: Service Health — uses real Windows services"
Write-Host "  Scenario 5: Port Listeners — uses real TCP connections"
Write-Host "  Scenario 6: Disk Space     — uses real disk volumes"
Write-Host ""
Write-Host "Quick start:" -ForegroundColor White
Write-Host "  # In TypeAgent shell or CLI:" -ForegroundColor DarkGray
Write-Host "  @scriptflow import $TestRoot\scripts\findLargeFiles.ps1" -ForegroundColor DarkGray
Write-Host "  find large files in C:\Windows" -ForegroundColor DarkGray
Write-Host ""
