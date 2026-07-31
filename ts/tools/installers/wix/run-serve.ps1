# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

<#
.SYNOPSIS
  Runs `node typeagent-serve.mjs <args>` from an MSI deferred custom-action
  context, resolving node.exe robustly first.

.DESCRIPTION
  The agent-server lifecycle custom actions (provision / start / autostart)
  invoke the typeagent-serve.mjs launcher with node. Because those actions run
  under the Windows Installer service, a bare `node` is frequently unresolvable
  (see resolve-node.ps1). This wrapper locates node via Resolve-NodeExe, then
  runs the requested serve subcommand. It is intentionally non-fatal: if Node
  cannot be found the step is skipped with a warning (the ExitDialog and
  documentation tell the user to run it manually) rather than rolling back the
  agent-server install.

.PARAMETER ServePath
  Full path to typeagent-serve.mjs (the agent-server launcher).

.PARAMETER LogPath
  Optional log file; output is also written to stdout (captured by the MSI log).

.PARAMETER Rest
  The serve subcommand and its arguments, e.g. `start`, `provision`,
  `autostart enable`.
#>
param(
    [Parameter(Mandatory = $true)][string]$ServePath,
    [string]$LogPath,
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$Rest
)

# Health-check tuning for the 'start' subcommand (see below). Kept as script
# locals, not params, so the positional 'start' argument passed by the MSI
# custom action is not accidentally bound to them.
$ServerPort = 8999
$StartTimeoutSeconds = 45

$ErrorActionPreference = "Continue"

function Write-Log([string]$message) {
    $line = "{0} {1}" -f (Get-Date -Format "s"), $message
    Write-Host $line
    if ($LogPath) {
        try {
            $dir = Split-Path -Parent $LogPath
            if ($dir -and -not (Test-Path $dir)) {
                New-Item -ItemType Directory -Force -Path $dir | Out-Null
            }
            Add-Content -Path $LogPath -Value $line
        } catch {
            # Logging must never fail the install.
        }
    }
}

. (Join-Path $PSScriptRoot "resolve-node.ps1")

$serveArgs = @($Rest)
$label = ($serveArgs -join ' ')

if (-not (Test-Path $ServePath)) {
    Write-Log "WARNING: agent-server launcher not found: $ServePath. Skipping 'typeagent-serve $label'."
    exit 0
}

$node = Resolve-NodeExe
if (-not $node) {
    Write-Log "WARNING: Node.js was not found; cannot run 'typeagent-serve $label'. Install Node.js >= 22 and run it manually from '$ServePath'."
    exit 0
}

Write-Log "Using node: $node"
Write-Log "Running: typeagent-serve $label"

# The 'start' subcommand launches a DETACHED daemon that must outlive this
# custom action. The trap: any launch that redirects streams or shares our
# console (Start-Process -RedirectStandard*/-NoNewWindow, or a `| ForEach-Object`
# pipeline) is created with bInheritHandles=TRUE, so the daemon inherits THIS
# process's stdout handle -- which under WixQuietExec64 is the installer's
# capture pipe. The daemon then holds that pipe open forever, the custom action
# never sees EOF, and the MSI hangs (observed as "time remaining: 2 seconds"
# stuck for many minutes). Launch via ShellExecute instead (no redirection, no
# -NoNewWindow, no -Wait): that path uses bInheritHandles=FALSE and gives the
# daemon a fresh console, so nothing leaks. We then poll the health port to
# confirm startup rather than waiting on the (intentionally detached) process.
$isStart = ($serveArgs.Count -gt 0 -and $serveArgs[0] -eq 'start')
if ($isStart) {
    try {
        # Quote every argument so paths containing spaces survive.
        $argLine = (@($ServePath) + $serveArgs | ForEach-Object { '"' + $_ + '"' }) -join ' '
        # No -RedirectStandard*, no -NoNewWindow, no -Wait => ShellExecute launch
        # with a hidden window and NO handle inheritance.
        $proc = Start-Process -FilePath $node -ArgumentList $argLine -WindowStyle Hidden -PassThru
        $launchPid = if ($proc) { $proc.Id } else { "?" }
        Write-Log "Launched agent-server launcher (pid $launchPid); polling port $ServerPort for up to $StartTimeoutSeconds s..."

        $deadline = (Get-Date).AddSeconds($StartTimeoutSeconds)
        $listening = $false
        while ((Get-Date) -lt $deadline) {
            $client = $null
            try {
                $client = New-Object System.Net.Sockets.TcpClient
                $async = $client.BeginConnect('127.0.0.1', $ServerPort, $null, $null)
                if ($async.AsyncWaitHandle.WaitOne(1000) -and $client.Connected) {
                    $listening = $true
                }
            } catch {
                # Not up yet; keep polling.
            } finally {
                if ($client) { $client.Close() }
            }
            if ($listening) { break }
            Start-Sleep -Milliseconds 500
        }

        if ($listening) {
            Write-Log "Agent-server is listening on port $ServerPort."
        } else {
            Write-Log "WARNING: agent-server did not report listening on port $ServerPort within $StartTimeoutSeconds s. It may still be starting; autostart will also launch it at next sign-in."
        }
    } catch {
        Write-Log "WARNING: 'typeagent-serve $label' launch failed: $($_.Exception.Message)."
    }
} else {
    try {
        & $node $ServePath @serveArgs 2>&1 | ForEach-Object { Write-Log "  $_" }
        Write-Log "typeagent-serve $label exited with code $LASTEXITCODE."
    } catch {
        Write-Log "WARNING: 'typeagent-serve $label' failed: $($_.Exception.Message)."
    }
}

# Always succeed: lifecycle hiccups are surfaced as warnings, not install failures.
exit 0
