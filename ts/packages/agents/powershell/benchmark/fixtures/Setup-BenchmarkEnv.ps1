param(
    [string]$TestRoot = "$env:TEMP\powershell-benchmark",
    [switch]$Force
)

if ($Force -and (Test-Path $TestRoot)) {
    Remove-Item -Path $TestRoot -Recurse -Force
}

if (Test-Path $TestRoot) {
    Write-Output "Benchmark environment already exists at $TestRoot"
    Write-Output "Use -Force to recreate."
    return
}

New-Item -Path $TestRoot -ItemType Directory -Force | Out-Null
Write-Output "Creating benchmark environment at $TestRoot..."

# --- files/ directory: known set of files for listFiles scenarios ---
$filesDir = Join-Path $TestRoot "files"
New-Item -Path $filesDir -ItemType Directory -Force | Out-Null

@("readme.txt", "config.json", "data.csv", "notes.md", "script.ps1") | ForEach-Object {
    $content = "Test file: $_ - created for powershell benchmark"
    Set-Content -Path (Join-Path $filesDir $_) -Value $content
}

# Create some subdirectories with files
$subDir = Join-Path $filesDir "subdir"
New-Item -Path $subDir -ItemType Directory -Force | Out-Null
@("nested1.txt", "nested2.log") | ForEach-Object {
    Set-Content -Path (Join-Path $subDir $_) -Value "Nested test file: $_"
}

Write-Output "  Created files/ with 7 test files"

# --- logs/ directory: log files with known error counts ---
$logsDir = Join-Path $TestRoot "logs"
New-Item -Path $logsDir -ItemType Directory -Force | Out-Null

$today = Get-Date -Format "yyyy-MM-dd"
$yesterday = (Get-Date).AddDays(-1).ToString("yyyy-MM-dd")

# Main log with known error/warning counts
$mainLogContent = @"
$today 08:00:01 [INFO] Application starting up...
$today 08:00:02 [INFO] Loading configuration from config.json
$today 08:00:03 [INFO] Database connection established
$today 08:01:00 [INFO] Health check: OK
$today 08:05:12 [ERROR] Payment processing timeout after 30s - OrderId: ORD-2024-1234
$today 08:05:13 [ERROR] System.TimeoutException: The operation has timed out
$today 08:05:13 [ERROR]    at PaymentService.ProcessPayment(Order order) in PaymentService.cs:line 142
$today 08:10:00 [WARN] Slow query detected: SELECT * FROM orders - 2340ms
$today 08:15:22 [INFO] Request processed: GET /api/users (200, 45ms)
$today 08:20:00 [INFO] Health check: OK
$today 08:25:33 [ERROR] Unhandled exception in request pipeline
$today 08:25:33 [ERROR] System.NullReferenceException: Object reference not set
$today 08:25:33 [ERROR]    at UserController.GetProfile(int userId) in UserController.cs:line 87
$today 08:30:15 [WARN] Rate limit approaching: 450/500 requests in window
$today 08:35:00 [INFO] Cache refreshed: 1234 entries
$today 08:40:01 [WARN] Certificate expires in 14 days: api.example.com
$today 08:45:22 [ERROR] Database connection timeout - retrying (attempt 1/3)
$today 08:45:25 [INFO] Database connection re-established
$today 08:50:00 [INFO] Health check: OK
$today 09:00:11 [FATAL] OutOfMemoryException: Insufficient memory to continue execution
$today 09:00:11 [FATAL]    at System.Runtime.MemoryManager.Allocate() in MemoryManager.cs:line 201
$today 09:00:15 [INFO] Application restarting after crash...
$today 09:00:20 [INFO] Application started successfully
$today 09:05:00 [WARN] Memory usage high: 85% of available
$today 09:10:33 [ERROR] SMTP delivery failed: Connection refused to mail.example.com:587
$today 09:15:00 [WARN] Deprecated API endpoint called: /api/v1/legacy
$today 09:20:00 [INFO] Batch job completed: processed 500 records
$today 09:25:44 [WARN] Message queue backlog: 1200 pending messages
"@

$mainLogPath = Join-Path $logsDir "AppServer_${today}.log"
Set-Content -Path $mainLogPath -Value $mainLogContent

# Worker log
$workerLogContent = @"
$today 08:00:05 [INFO] Worker starting...
$today 08:10:00 [INFO] Processing batch 1/10
$today 08:15:33 [ERROR] Failed to process item ID-5523: Invalid format
$today 08:20:00 [INFO] Processing batch 2/10
$today 08:25:00 [WARN] Retry queue growing: 45 items
$today 08:30:00 [INFO] Processing batch 3/10
$today 08:35:22 [ERROR] Connection to external API failed: HTTP 503
"@

$workerLogPath = Join-Path $logsDir "AppServer_${today}_worker.log"
Set-Content -Path $workerLogPath -Value $workerLogContent

# Yesterday's log (should NOT be picked up by default today filter)
$yesterdayLogPath = Join-Path $logsDir "AppServer_${yesterday}.log"
Set-Content -Path $yesterdayLogPath -Value "$yesterday 23:59:59 [ERROR] Old error from yesterday"

Write-Output "  Created logs/ with 3 log files (main: 8 ERROR, 6 WARN, 1 FATAL)"

# --- csv/ directory: test CSV data ---
$csvDir = Join-Path $TestRoot "csv"
New-Item -Path $csvDir -ItemType Directory -Force | Out-Null

# Copy from existing test data if available, otherwise create inline
$existingCsvDir = Join-Path $PSScriptRoot "..\..\..\test\import-scenarios\data\csv"
if (Test-Path (Join-Path $existingCsvDir "employees.csv")) {
    Copy-Item -Path (Join-Path $existingCsvDir "employees.csv") -Destination $csvDir
    Copy-Item -Path (Join-Path $existingCsvDir "sensor_readings.csv") -Destination $csvDir
    Write-Output "  Copied csv/ from existing test data"
} else {
    # Create employees.csv inline
    $employeesCsv = @"
Name,Department,Status,Location,Salary
Alice Johnson,Engineering,Active,Seattle,125000
Bob Smith,Engineering,Active,Seattle,118000
Carol Williams,Engineering,Active,Remote,130000
David Brown,Engineering,Terminated,Seattle,0
Eve Davis,Engineering,Active,Austin,122000
Frank Miller,Engineering,Active,Seattle,115000
Grace Wilson,Engineering,On Leave,Remote,120000
Henry Moore,Engineering,Active,Austin,128000
Iris Taylor,Engineering,Active,Seattle,117000
Jack Anderson,Engineering,Active,Remote,132000
Karen Thomas,Engineering,Active,Seattle,121000
Leo Jackson,Engineering,Active,Austin,119000
Mary White,Engineering,Active,Remote,126000
Noah Harris,Sales,Active,Chicago,95000
Olivia Martin,Sales,Active,New York,98000
Peter Garcia,Sales,Terminated,Chicago,0
Quinn Martinez,Sales,Active,New York,92000
Rachel Robinson,HR,Active,Seattle,88000
Sam Clark,HR,Active,Seattle,85000
Tina Rodriguez,HR,On Leave,Remote,90000
Uma Lewis,Finance,Active,New York,105000
Victor Lee,Finance,Active,New York,108000
Wendy Walker,Finance,Active,Remote,102000
Xavier Hall,Marketing,Active,Chicago,87000
Yolanda Allen,Marketing,Active,Remote,91000
"@
    Set-Content -Path (Join-Path $csvDir "employees.csv") -Value $employeesCsv

    $sensorCsv = @"
Timestamp,SensorId,Location,Temperature,Humidity,Status
2026-03-24T08:00:00,SENS-001,BuildingA-Floor1,22.1,45,OK
2026-03-24T08:00:00,SENS-002,BuildingA-Floor2,23.5,42,OK
2026-03-24T08:00:00,SENS-003,BuildingB-Floor1,21.8,48,OK
2026-03-24T08:05:00,SENS-001,BuildingA-Floor1,22.3,44,OK
2026-03-24T08:05:00,SENS-002,BuildingA-Floor2,25.1,40,WARN
2026-03-24T08:05:00,SENS-003,BuildingB-Floor1,21.9,47,OK
2026-03-24T08:10:00,SENS-001,BuildingA-Floor1,22.2,45,OK
2026-03-24T08:10:00,SENS-002,BuildingA-Floor2,28.7,38,ERROR
2026-03-24T08:10:00,SENS-003,BuildingB-Floor1,22.0,46,OK
2026-03-24T08:15:00,SENS-001,BuildingA-Floor1,22.4,44,OK
2026-03-24T08:15:00,SENS-002,BuildingA-Floor2,31.2,35,CRITICAL
"@
    Set-Content -Path (Join-Path $csvDir "sensor_readings.csv") -Value $sensorCsv
    Write-Output "  Created csv/ with employees.csv (25 rows) and sensor_readings.csv (11 rows)"
}

# --- Write manifest describing what was created ---
$manifest = @{
    testRoot = $TestRoot
    created = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ss")
    directories = @{
        files = @{ path = $filesDir; fileCount = 7 }
        logs = @{
            path = $logsDir
            todayDate = $today
            mainLog = @{ errors = 8; warnings = 6; fatals = 1 }
            workerLog = @{ errors = 2; warnings = 1 }
        }
        csv = @{
            path = $csvDir
            employees = @{ rows = 25; engineeringCount = 13 }
            sensors = @{ rows = 11 }
        }
    }
} | ConvertTo-Json -Depth 4

$manifestPath = Join-Path $TestRoot "fixtures-manifest.json"
Set-Content -Path $manifestPath -Value $manifest

Write-Output ""
Write-Output "Benchmark environment ready at $TestRoot"
Write-Output "Manifest: $manifestPath"
