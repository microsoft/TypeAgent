# ScriptFlow Import — Test Scenario Guide

## Setup

Run the setup script to create the test environment:

```powershell
cd C:\src\TypeAgent\ts\packages\agents\scriptflow\test\import-scenarios
.\Setup-TestEnvironment.ps1
```

Default location: `$env:TEMP\scriptflow-test`. Override with `-TestRoot D:\my\path`.

After setup, all paths below use `$T` as shorthand for the test root.

```powershell
$T = "$env:TEMP\scriptflow-test"
```

---

## Scenario 1: Stale Branch Cleanup (fully documented, param block + switch)

**Import:**

```
@scriptflow import $T\scripts\staleBranches.ps1
```

**Verify recipe:** actionName should be something like `staleBranches` or `findStaleBranches`. Three parameters (RepoPath: path, DaysStale: number, Delete: boolean). Description pulled from .SYNOPSIS.

**Test execution:**

```
find stale branches in $T\git-repo
```

**Expected output:** Table showing 3-4 stale branches (bugfix/legacy-fix at ~90 days, spike/abandoned-prototype at ~180 days, feature/old-experiment at ~45 days, feature/last-month at ~35 days). feature/active-work should NOT appear.

**Test with non-default threshold:**

```
# Should show only branches older than 60 days (2 branches)
```

Use flowParametersJson: `{"RepoPath":"$T\\git-repo","DaysStale":60}`

---

## Scenario 2: Large File Finder (param block, no comments)

This scenario uses live filesystem data — no test data setup needed.

**Import:**

```
@scriptflow import $T\scripts\findLargeFiles.ps1
```

**Verify recipe:** Three parameters (Directory: path, MinSizeMB: number, TopN: number). Descriptions inferred from names.

**Test execution — scan a real directory:**

```
find large files in C:\Windows
```

**Expected output:** Table of the largest files under C:\Windows (typically .dll, .exe, .mum files). Results vary by machine.

**Test with lower threshold (scan user profile):**

```
find large files in $env:USERPROFILE
```

With flowParametersJson: `{"Directory":"$env:USERPROFILE","MinSizeMB":50}` — shows files over 50MB in your profile.

**Suggested directories to try:**

- `C:\Windows` — always has large system files
- `$env:USERPROFILE\Downloads` — often has large downloads
- `$env:TEMP` — may have accumulated large temp files
- `C:\src\TypeAgent` — the repo itself (node_modules, .git objects)

---

## Scenario 3: Log Error Grep (no params, hardcoded values)

**Import:**

The script hardcodes `C:\Logs\AppServer`. Before importing, you have two options:

**Option A** — Edit the script to point at the test data:

```powershell
(Get-Content $T\scripts\logErrorGrep.ps1) -replace 'C:\\Logs\\AppServer', "$T\logs" |
    Set-Content $T\scripts\logErrorGrep.ps1
```

**Option B** — Symlink or copy logs to the hardcoded path:

```powershell
New-Item -Path C:\Logs\AppServer -ItemType Junction -Target $T\logs
```

Then import:

```
@scriptflow import $T\scripts\logErrorGrep.ps1
```

**Verify recipe:** Analyzer should infer parameters for logDir, date pattern, and error regex. Description should mention scanning logs for errors/warnings.

**Test execution:**

```
scan the logs for errors
```

**Expected output:**

- Summary by severity: ~11 ERROR, ~9 WARN, ~1 FATAL across both files
- Top files section showing the main log with more hits than the worker log
- Total match count

**Key verification:** Yesterday's log file should NOT be included in results.

---

## Scenario 4: Service Health Dashboard (inline comments, ValidateSet)

**Import:**

```
@scriptflow import $T\scripts\serviceHealth.ps1
```

**Verify recipe:** Two parameters (ServiceList: string, OutputFormat: string). ValidateSet values (table/list/summary) should appear in description or parameter metadata.

**Test execution (default services):**

```
check service health
```

**Expected output:** Table of 8 Windows services with Name, Display, Status, StartType columns. Most should show "Running".

**Test with custom services:**

```
service status for WinRM, BITS, FakeService123
```

**Expected output:** WinRM and BITS with real status, FakeService123 as "MISSING".

**Test summary format** (via flowParametersJson `{"OutputFormat":"summary"}`):

Should show "Services: 3 checked | 2 running | 0 stopped | 1 missing" plus attention section.

---

## Scenario 5: Port Listener Check (terse, single param)

**Import:**

```
@scriptflow import $T\scripts\portListeners.ps1
```

**Verify recipe:** Single parameter (Ports: string). networkAccess should be false.

**Test execution:**

```
what's listening on port 80
```

**Expected output:** If a web server is running, shows its PID and process name. Otherwise "No listeners found on port(s): 80".

**Test with multiple ports:**

```
check ports 135,445,3389
```

**Expected output:** On a typical Windows machine, should find listeners on 135 (RPC) and possibly 445 (SMB) and 3389 (RDP).

---

## Scenario 6: Disk Space Alert (no comments, no param block, hardcoded thresholds)

**Import:**

```
@scriptflow import $T\scripts\diskSpaceAlert.ps1
```

**Verify recipe:** Analyzer should infer parameters for thresholdGB (number, default 10) and thresholdPct (number, default 15). actionName like `checkDiskSpace` or `diskSpaceAlert`.

**Test execution:**

```
check disk space
```

**Expected output:** Table of all fixed drives with DeviceID, SizeGB, FreeGB, FreePct, UsedGB, Status columns. Status is "OK" or "LOW" based on thresholds. Summary line at the bottom.

**Note:** Output varies by machine. On most dev machines all drives show "OK".

---

## Scenario 7: CSV Transform Pipeline (param block, brief comments)

**Import:**

```
@scriptflow import $T\scripts\csvTransform.ps1
```

**Verify recipe:** Six parameters (InputFile: path, OutputFile: path, FilterColumn: string, FilterPattern: string, SelectColumns: string, NoHeader: boolean).

**Test execution — filter employees by department:**

```
filter the csv file $T\csv\employees.csv
```

With flowParametersJson: `{"InputFile":"$T\\csv\\employees.csv","FilterColumn":"Department","FilterPattern":"Engineering"}`

**Expected output:** "Processed: 25 rows -> 13 rows", preview table showing only Engineering employees, output file created at `employees_filtered.csv`.

**Test execution — filter sensors by status:**

```
filter the csv file $T\csv\sensor_readings.csv
```

With flowParametersJson: `{"InputFile":"$T\\csv\\sensor_readings.csv","FilterColumn":"Status","FilterPattern":"ERROR|CRITICAL","SelectColumns":"Timestamp,SensorId,Location,Status"}`

**Expected output:** "Processed: 30 rows -> 4 rows" (2 ERROR + 2 CRITICAL), preview showing only the selected columns.

**Verify:** Output CSV file is valid and can be re-imported.

---

## Quick Smoke Test

Run all 7 imports in sequence to verify the full pipeline:

```
@scriptflow import $T\scripts\staleBranches.ps1
@scriptflow import $T\scripts\findLargeFiles.ps1
@scriptflow import $T\scripts\logErrorGrep.ps1
@scriptflow import $T\scripts\serviceHealth.ps1
@scriptflow import $T\scripts\portListeners.ps1
@scriptflow import $T\scripts\diskSpaceAlert.ps1
@scriptflow import $T\scripts\csvTransform.ps1
```

Then verify all are registered:

```
list script flows
```

Should show 7 newly imported flows plus any existing seed flows.
