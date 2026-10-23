# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

param(
    [ValidateSet("Debug", "Release")]
    [string] $Configuration = "Debug"
)

$ErrorActionPreference = "Stop"
$repositoryRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$project = Join-Path $PSScriptRoot "VisualStudioTypeAgent.Tests.csproj"
$interopScript = Join-Path $repositoryRoot "ts\packages\agents\visualStudio\dist\test\visualStudioBridgeInterop.js"
$temporaryDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ("typeagent-vs-interop-" + [Guid]::NewGuid().ToString("N"))

New-Item -ItemType Directory -Path $temporaryDirectory | Out-Null
try {
    $request = Join-Path $temporaryDirectory "request.json"
    $response = Join-Path $temporaryDirectory "response.json"
    $final = Join-Path $temporaryDirectory "final.json"

    dotnet run --project $project --configuration $Configuration --no-build -- write-interop-request $request
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    node $interopScript respond $request $response
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    dotnet run --project $project --configuration $Configuration --no-build -- verify-interop-response $request $response $final
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    node $interopScript verify $request $response $final
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    Write-Output "Visual Studio bridge TypeScript/C# interoperability passed."
}
finally {
    if (Test-Path -LiteralPath $temporaryDirectory) {
        [System.IO.Directory]::Delete($temporaryDirectory, $true)
    }
}
