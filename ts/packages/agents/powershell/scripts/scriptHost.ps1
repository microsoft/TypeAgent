# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

# scriptHost.ps1 - PowerShell execution host for PowerShell agent
# Creates a runspace with cmdlet whitelisting, module loading, and timeout enforcement.
# Untrusted requests are additionally isolated by the Windows broker.

param(
    [string]$ScriptBody = '',

    [string]$ParametersJson = '{}',

    [string]$ParameterRolesJson = '{}',

    [string]$AllowedCmdletsJson = '[]',

    [string]$AllowedPathsJson = '[]',

    [string]$AllowedModulesJson = '[]',

    [string]$NetworkAccess = "false",

    [int]$TimeoutSeconds = 30,

    [string]$RequestPath
)

$ErrorActionPreference = 'Stop'
$UntrustedMode = $false
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $utf8NoBom
$OutputEncoding = $utf8NoBom

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

function Test-UntrustedScript {
    param(
        [string]$Source,
        [string[]]$AllowedCommands
    )

    $tokens = $null
    $parseErrors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseInput(
        $Source,
        [ref]$tokens,
        [ref]$parseErrors
    )
    if ($parseErrors.Count -gt 0) {
        throw "PowerShell policy denied execution (AST_PARSE_ERROR)."
    }

    $safeTypeNames = @(
        'array',
        'bool',
        'boolean',
        'byte',
        'char',
        'datetime',
        'decimal',
        'double',
        'float',
        'guid',
        'hashtable',
        'int',
        'int16',
        'int32',
        'int64',
        'long',
        'object',
        'pscustomobject',
        'psobject',
        'regex',
        'sbyte',
        'short',
        'single',
        'string',
        'switch',
        'timespan',
        'uint',
        'uint16',
        'uint32',
        'uint64',
        'ulong',
        'uri',
        'ushort',
        'version'
    )
    $allowedForEachParameters = @(
        'Begin',
        'Confirm',
        'End',
        'InputObject',
        'Process',
        'RemainingScripts',
        'WhatIf'
    )
    $violations = [System.Collections.Generic.HashSet[string]]::new(
        [System.StringComparer]::OrdinalIgnoreCase
    )
    [void]$ast.FindAll({
        param($node)

        if ($node -is [System.Management.Automation.Language.TypeExpressionAst]) {
            [void]$violations.Add("AST_TYPE_EXPRESSION")
            return $false
        }
        if ($node -is [System.Management.Automation.Language.TypeConstraintAst]) {
            $typeName = $node.TypeName.FullName
            if ($typeName -notin $safeTypeNames) {
                [void]$violations.Add("AST_TYPE_CONSTRAINT")
                return $false
            }
        }
        if ($node -is [System.Management.Automation.Language.InvokeMemberExpressionAst]) {
            [void]$violations.Add("AST_MEMBER_INVOCATION")
            return $false
        }
        if ($node -is [System.Management.Automation.Language.RedirectionAst]) {
            [void]$violations.Add("AST_REDIRECTION")
            return $false
        }
        if ($node -is [System.Management.Automation.Language.UsingExpressionAst]) {
            [void]$violations.Add("AST_USING_EXPRESSION")
            return $false
        }
        if ($node -is [System.Management.Automation.Language.UsingStatementAst]) {
            [void]$violations.Add("AST_USING_STATEMENT")
            return $false
        }
        if ($node -is [System.Management.Automation.Language.ConfigurationDefinitionAst]) {
            [void]$violations.Add("AST_CONFIGURATION")
            return $false
        }
        if ($node -is [System.Management.Automation.Language.CommandAst]) {
            if (
                $node.InvocationOperator -eq [System.Management.Automation.Language.TokenKind]::Ampersand -or
                $node.InvocationOperator -eq [System.Management.Automation.Language.TokenKind]::Dot
            ) {
                [void]$violations.Add("AST_INVOCATION_OPERATOR")
                return $false
            }
            $commandName = $node.GetCommandName()
            if ([string]::IsNullOrWhiteSpace($commandName)) {
                [void]$violations.Add("AST_DYNAMIC_COMMAND")
                return $false
            }
            if ($commandName -notin $AllowedCommands) {
                [void]$violations.Add("AST_COMMAND_NOT_ALLOWED")
                return $false
            }
            if ($commandName -ieq 'ForEach-Object') {
                $hasProcessScriptBlock = $false
                foreach ($element in @($node.CommandElements | Select-Object -Skip 1)) {
                    if ($element -is [System.Management.Automation.Language.ScriptBlockExpressionAst]) {
                        $hasProcessScriptBlock = $true
                        continue
                    }
                    if (
                        $element -is [System.Management.Automation.Language.CommandParameterAst] -and
                        $element.ParameterName -notin $allowedForEachParameters
                    ) {
                        [void]$violations.Add("AST_FOREACH_PARAMETER")
                        return $false
                    }
                }
                if (-not $hasProcessScriptBlock) {
                    [void]$violations.Add("AST_FOREACH_MEMBER_MODE")
                    return $false
                }
            }
        }
        return $false
    }, $true)

    $requirements = $ast.ScriptRequirements
    if ($null -ne $requirements) {
        if (@($requirements.RequiredModules).Count -gt 0) {
            [void]$violations.Add("AST_REQUIRED_MODULE")
        }
        if (@($requirements.RequiredPSSnapIns).Count -gt 0) {
            [void]$violations.Add("AST_REQUIRED_SNAPIN")
        }
        if ($requirements.IsElevationRequired) {
            [void]$violations.Add("AST_REQUIRES_ELEVATION")
        }
    }

    if ($violations.Count -gt 0) {
        $ruleIds = @($violations) | Sort-Object
        throw "PowerShell policy denied execution ($($ruleIds -join ','))."
    }
}

try {
    if ($RequestPath) {
        $request = Get-Content -LiteralPath $RequestPath -Raw | ConvertFrom-Json
        if ($request.protocolVersion -ne 1) {
            Write-Error "Unsupported PowerShell broker protocol."
            exit 1
        }
        $ScriptBody = [string]$request.script
        $ParametersJson = [string]$request.parametersJson
        $AllowedCmdletsJson = ConvertTo-Json -InputObject @($request.allowedCommands) -Compress
        $ParameterRolesJson = '{}'
        $AllowedPathsJson = '[]'
        $AllowedModulesJson = '[]'
        $NetworkAccess = 'false'
        $TimeoutSeconds = [int]$request.timeoutSeconds
        $UntrustedMode = $true
    }

    $allowedCmdlets = $AllowedCmdletsJson | ConvertFrom-Json
    $allowedCmdlets = @($allowedCmdlets)
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

    if ($UntrustedMode) {
        $safeUntrustedCommands = @(
            'ConvertFrom-Csv',
            'ConvertFrom-Json',
            'ConvertTo-Csv',
            'ConvertTo-Json',
            'ForEach-Object',
            'Format-List',
            'Format-Table',
            'Get-Date',
            'Group-Object',
            'Measure-Object',
            'Out-String',
            'Select-Object',
            'Sort-Object',
            'Start-Sleep',
            'Where-Object',
            'Write-Output'
        )
        $unsupportedCommands = @(
            $allowedCmdlets |
                Where-Object { $_ -notin $safeUntrustedCommands }
        )
        if ($unsupportedCommands.Count -gt 0) {
            Write-Error "PowerShell policy denied unsupported commands."
            exit 1
        }
        Test-UntrustedScript $ScriptBody $allowedCmdlets
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

    # Microsoft.PowerShell.Core cmdlets are never stripped for reviewed scripts. CDXML commands (the
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
        $removeCommand = if ($UntrustedMode) {
            $cmd.CommandType -in @('Alias', 'Cmdlet', 'Filter', 'Function') -and
                $cmd.Name -notin $allowedCmdlets
        } else {
            $cmd.CommandType -eq 'Cmdlet' -and
                $cmd.Name -notin $allowedCmdlets -and
                $cmd.Name -notin $coreCmdletNames
        }
        if ($removeCommand) {
            $commandsToRemove += $cmd
        }
    }
    foreach ($cmd in $commandsToRemove) {
        $iss.Commands.Remove($cmd.Name, $cmd)
    }

    if ($UntrustedMode) {
        $iss.LanguageMode = [System.Management.Automation.PSLanguageMode]::ConstrainedLanguage
    }

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
