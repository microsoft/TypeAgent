# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

# scriptHost.ps1 — Sandboxed PowerShell execution host for PowerShell agent
# Creates a runspace with cmdlet whitelisting, module loading, and timeout enforcement.
# Security: Path restrictions, network controls, cmdlet whitelisting.
# Language: FullLanguage mode (allows [PSCustomObject], [math]::Round, etc.)

param(
    [Parameter(Mandatory=$true)]
    [string]$ScriptBody,

    [Parameter(Mandatory=$true)]
    [string]$ParametersJson,

    [string]$ParameterRolesJson = '{}',

    [Parameter(Mandatory=$true)]
    [string]$AllowedCmdletsJson,

    [string]$AllowedPathsJson = '[]',

    [string]$AllowedModulesJson = '[]',

    [string]$NetworkAccess = "false",

    [int]$TimeoutSeconds = 30
)

$ErrorActionPreference = 'Stop'

function Remove-TrailingDirectorySeparator {
    param([string]$Path)

    $root = [System.IO.Path]::GetPathRoot($Path)
    if ($Path.Equals($root, [System.StringComparison]::OrdinalIgnoreCase)) {
        return $root
    }
    return $Path.TrimEnd('\', '/')
}

function Get-CanonicalFileSystemPath {
    param([string]$Path)

    $fullPath = [System.IO.Path]::GetFullPath($Path)
    if (Test-Path -LiteralPath $fullPath) {
        $item = Get-Item -LiteralPath $fullPath -Force
        return Remove-TrailingDirectorySeparator $item.FullName
    }

    $missingSegments = [System.Collections.Generic.List[string]]::new()
    $existingPath = $fullPath
    while (-not (Test-Path -LiteralPath $existingPath)) {
        $leaf = Split-Path -Leaf $existingPath
        $parent = Split-Path -Parent $existingPath
        if (-not $leaf -or -not $parent -or $parent -eq $existingPath) {
            throw "Unable to resolve path '$Path'."
        }
        $missingSegments.Insert(0, $leaf)
        $existingPath = $parent
    }

    $canonicalPath = (Get-Item -LiteralPath $existingPath -Force).FullName
    foreach ($segment in $missingSegments) {
        $canonicalPath = Join-Path $canonicalPath $segment
    }
    return Remove-TrailingDirectorySeparator ([System.IO.Path]::GetFullPath($canonicalPath))
}

function Get-CanonicalExecutablePath {
    param([string]$Path)

    if (
        [System.IO.Path]::IsPathRooted($Path) -or
        $Path.Contains('\') -or
        $Path.Contains('/') -or
        $Path.StartsWith('.')
    ) {
        return Get-CanonicalFileSystemPath $Path
    }

    $commands = @(Get-Command -Name $Path -CommandType Application -ErrorAction Stop)
    if ($commands.Count -ne 1 -or -not $commands[0].Path) {
        throw "Unable to resolve executable '$Path' to one application."
    }
    return Get-CanonicalFileSystemPath $commands[0].Path
}

function Test-AllowedFileSystemPath {
    param(
        [string]$Path,
        [string[]]$AllowedPaths
    )

    foreach ($allowedPath in $AllowedPaths) {
        if (
            $Path.Equals($allowedPath, [System.StringComparison]::OrdinalIgnoreCase) -or
            $Path.StartsWith("$allowedPath\", [System.StringComparison]::OrdinalIgnoreCase) -or
            $Path.StartsWith("$allowedPath/", [System.StringComparison]::OrdinalIgnoreCase)
        ) {
            return $true
        }
    }
    return $false
}

try {
    $allowedCmdlets = $AllowedCmdletsJson | ConvertFrom-Json
    $params = $ParametersJson | ConvertFrom-Json
    $parameterRoles = $ParameterRolesJson | ConvertFrom-Json
    if ($null -eq $parameterRoles -or $parameterRoles -isnot [pscustomobject]) {
        Write-Error "Parameter roles must be a JSON object."
        exit 1
    }
    # Parse allowed paths - must handle array properly to avoid PowerShell array unwrapping issues
    $parsedPaths = $AllowedPathsJson | ConvertFrom-Json
    if ($parsedPaths -is [array]) {
        $AllowedPaths = $parsedPaths
    } else {
        $AllowedPaths = @($parsedPaths)
    }
    $parsedModules = $AllowedModulesJson | ConvertFrom-Json
    if ($parsedModules -is [array]) {
        $AllowedModules = $parsedModules
    } else {
        $AllowedModules = @($parsedModules)
    }

    # Expand environment variable references in allowed paths
    # (e.g. "$env:USERPROFILE" → "C:\Users\name")
    # Done outside constrained runspace where method invocation is allowed.
    $expandedAllowedPaths = @()
    foreach ($ap in $AllowedPaths) {
        try {
            $expandedPath = $ExecutionContext.InvokeCommand.ExpandString($ap)
            $expandedAllowedPaths += Get-CanonicalFileSystemPath $expandedPath
        } catch {
            Write-Error "Invalid allowed path '$ap': $_"
            exit 1
        }
    }

    $roleProperties = @($parameterRoles.PSObject.Properties)
    if ($roleProperties.Count -gt 0 -and $expandedAllowedPaths.Count -eq 0) {
        Write-Error "Path parameter roles require at least one allowed path."
        exit 1
    }

    foreach ($roleProperty in $roleProperties) {
        $role = [string]$roleProperty.Value
        if ($role -ne 'path' -and $role -ne 'executable') {
            Write-Error "Unsupported parameter role '$role' for '$($roleProperty.Name)'."
            exit 1
        }

        $parameterProperty = @(
            $params.PSObject.Properties |
                Where-Object { $_.Name -ieq $roleProperty.Name }
        ) | Select-Object -First 1
        if ($null -eq $parameterProperty) {
            continue
        }

        $value = $parameterProperty.Value
        if ($null -eq $value -or $value -eq '') {
            continue
        }
        if ($value -isnot [string]) {
            Write-Error "Parameter '$($parameterProperty.Name)' with role '$role' must be a string."
            exit 1
        }
        if ([System.Management.Automation.WildcardPattern]::ContainsWildcardCharacters($value)) {
            Write-Error "Parameter '$($parameterProperty.Name)' with role '$role' cannot contain wildcard characters."
            exit 1
        }
        if ($value -match '^[a-zA-Z][a-zA-Z0-9-]*:' -and $value -notmatch '^[a-zA-Z]:[\\/]') {
            Write-Error "Parameter '$($parameterProperty.Name)' uses an unsupported provider or URI path."
            exit 1
        }

        try {
            $resolvedPath = if ($role -eq 'executable') {
                Get-CanonicalExecutablePath $value
            } else {
                Get-CanonicalFileSystemPath $value
            }
        } catch {
            Write-Error "Invalid $role parameter '$($parameterProperty.Name)': $_"
            exit 1
        }
        if (-not (Test-AllowedFileSystemPath $resolvedPath $expandedAllowedPaths)) {
            Write-Error "Path access denied: '$resolvedPath' is not in allowedPaths. Allowed paths: $($expandedAllowedPaths -join ', ')"
            exit 1
        }
    }

    # Convert NetworkAccess string to boolean (handles "true"/"false"/"1"/"0"/"$true"/"$false")
    $networkAccessBool = $NetworkAccess -match '^(true|1|\$true)$'

    # Network access enforcement
    if (-not $networkAccessBool) {
        # Define network-capable cmdlets that require networkAccess=true
        $NetworkCmdlets = @(
            'Invoke-WebRequest',
            'Invoke-RestMethod',
            'Test-NetConnection',
            'Test-Connection',
            'Resolve-DnsName',
            'Send-MailMessage',
            'Start-BitsTransfer',
            'Get-NetAdapter',
            'Get-NetIPAddress',
            'Get-NetRoute',
            'New-NetFirewallRule',
            'Set-NetFirewallRule'
        )

        foreach ($networkCmdlet in $NetworkCmdlets) {
            if ($allowedCmdlets -contains $networkCmdlet) {
                Write-Error "Network cmdlet '$networkCmdlet' requires networkAccess=true in sandbox policy"
                exit 1
            }
        }
    }

    # Module enforcement - check for unauthorized Import-Module in script body
    if ($ScriptBody -match 'Import-Module\s+([^\s;]+)') {
        $requestedModule = $Matches[1] -replace '"','' -replace "'",''
        if ($AllowedModules.Count -gt 0 -and $requestedModule -notin $AllowedModules) {
            Write-Error "Module import denied: '$requestedModule' is not in allowedModules. Allowed modules: $($AllowedModules -join ', ')"
            exit 1
        }
    }

    # Auto-resolve the source module for each allowed cmdlet and ensure it is imported.
    $resolvedModules = [System.Collections.Generic.List[string]]::new()
    foreach ($m in $AllowedModules) {
        if ($m -and -not $resolvedModules.Contains($m)) {
            $resolvedModules.Add($m)
        }
    }
    foreach ($cmdletName in $allowedCmdlets) {
        try {
            # Include Function so CDXML-backed commands resolve too — many
            # built-in networking/storage "cmdlets" (Get-NetTCPConnection in
            # NetTCPIP, Get-NetAdapter, etc.) are CDXML functions, not compiled
            # cmdlets, and would otherwise resolve to nothing and skip their module.
            $resolvedCmd = Get-Command $cmdletName -CommandType Cmdlet, Function -ErrorAction SilentlyContinue |
                Select-Object -First 1
            if ($resolvedCmd -and $resolvedCmd.ModuleName -and
                -not $resolvedModules.Contains($resolvedCmd.ModuleName)) {
                $resolvedModules.Add($resolvedCmd.ModuleName)
            }
        } catch {
            # Cmdlet not resolvable in the host; the removal/whitelist step will
            # surface it as unavailable at execution time.
        }
    }
    $AllowedModules = $resolvedModules.ToArray()

    # Create session state with default cmdlets
    $iss = [System.Management.Automation.Runspaces.InitialSessionState]::CreateDefault()

    # Disable module auto-loading. With auto-loading off, only explicitly imported modules
    # (allowedModules + auto-resolved) are available, so the whitelist holds.
    # Explicit ImportPSModule calls are unaffected, so CDXML flows still work.
    $iss.Variables.Add(
        (New-Object System.Management.Automation.Runspaces.SessionStateVariableEntry(
            'PSModuleAutoLoadingPreference', 'None', 'Disable implicit module auto-loading in the sandbox'))
    )

    # Import allowed modules into the session state
    # This makes module cmdlets (like Get-NetTCPConnection from NetTCPIP) available
    if ($AllowedModules.Count -gt 0) {
        foreach ($moduleName in $AllowedModules) {
            try {
                $iss.ImportPSModule($moduleName)
            } catch {
                Write-Warning "Could not import module '$moduleName': $_"
            }
        }
    }

    # Microsoft.PowerShell.Core cmdlets are never stripped. CDXML commands (the
    # Net*/Storage*/Defender* families, e.g. Get-NetTCPConnection) invoke CIM
    # operations through Core cmdlets at runtime; removing Core makes them
    # silently return empty results instead of erroring.
    $coreCmdletNames = @(
        Get-Command -Module 'Microsoft.PowerShell.Core' -CommandType Cmdlet -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty Name
    )

    # Remove cmdlets not in the allowed list (after module import so we can whitelist module cmdlets)
    $commandsToRemove = @()
    foreach ($cmd in $iss.Commands) {
        if ($cmd.CommandType -eq 'Cmdlet' -and
            $cmd.Name -notin $allowedCmdlets -and
            $cmd.Name -notin $coreCmdletNames) {
            $commandsToRemove += $cmd
        }
    }
    foreach ($cmd in $commandsToRemove) {
        $iss.Commands.Remove($cmd.Name, $cmd)
    }

    # FullLanguage mode (default) - allows [PSCustomObject], [math]::Round(), etc.
    # Security is provided by: cmdlet whitelisting, path restrictions, network controls
    # Note: If stricter lockdown is needed, uncomment the line below:
    # $iss.LanguageMode = [System.Management.Automation.PSLanguageMode]::ConstrainedLanguage

    # Create runspace
    $runspace = [System.Management.Automation.Runspaces.RunspaceFactory]::CreateRunspace($iss)
    $runspace.Open()

    # Build the script with injected parameters
    $ps = [System.Management.Automation.PowerShell]::Create()
    $ps.Runspace = $runspace

    [void]$ps.AddScript($ScriptBody)

    # Pass parameters to the script's param() block
    foreach ($prop in $params.PSObject.Properties) {
        [void]$ps.AddParameter($prop.Name, $prop.Value)
    }

    # Execute with timeout
    $asyncResult = $ps.BeginInvoke()
    $completed = $asyncResult.AsyncWaitHandle.WaitOne([TimeSpan]::FromSeconds($TimeoutSeconds))

    if (-not $completed) {
        $ps.Stop()
        Write-Error "Script execution timed out after $TimeoutSeconds seconds"
        exit 1
    }

    $output = $ps.EndInvoke($asyncResult)

    # Render output — Out-String handles both plain objects and Format-* objects
    if ($output.Count -gt 0) {
        $output | Out-String -Width 200 | Write-Output
    }

    # Report errors
    if ($ps.HadErrors) {
        foreach ($err in $ps.Streams.Error) {
            Write-Error $err
        }
        exit 1
    }

    $runspace.Close()
    $runspace.Dispose()
    $ps.Dispose()

} catch {
    Write-Error "ScriptHost error: $_"
    exit 1
}
