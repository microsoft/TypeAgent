# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

# Test-only host: exercise Windows containment without production AST/CLM checks.
param([string]$RequestPath)

$ErrorActionPreference = 'Stop'
[void][System.Reflection.Assembly]::Load(
    'System.Web.Extensions, Version=4.0.0.0, Culture=neutral, PublicKeyToken=31BF3856AD364E35'
)
$serializer = [System.Web.Script.Serialization.JavaScriptSerializer]::new()
$request = $serializer.DeserializeObject([System.IO.File]::ReadAllText($RequestPath))
$parameters = $serializer.DeserializeObject([string]$request['parametersJson'])
[Console]::Out.WriteLine("OS probe started: $($ExecutionContext.SessionState.LanguageMode)")
try {
    & ([scriptblock]::Create([string]$request['script'])) @parameters
} catch {
    [Console]::Error.WriteLine($_.Exception.GetBaseException().GetType().FullName)
    exit 1
}
