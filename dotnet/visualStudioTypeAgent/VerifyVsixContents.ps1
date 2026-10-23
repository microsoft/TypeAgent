# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

param(
    [Parameter(Mandatory = $true)]
    [string] $VsixPath
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.IO.Compression.FileSystem

$resolvedVsixPath = (Resolve-Path -LiteralPath $VsixPath).Path
$archive = [System.IO.Compression.ZipFile]::OpenRead($resolvedVsixPath)
try {
    $entries = @($archive.Entries)
    $index = $entries | Where-Object {
        $_.FullName.Replace("\", "/") -eq "webview-content/index.html"
    }
    if ($null -eq $index -or $index.Length -eq 0) {
        throw "VSIX is missing webview-content/index.html"
    }

    $javascript = @($entries | Where-Object {
        $name = $_.FullName.Replace("\", "/")
        $name.StartsWith("webview-content/assets/", [System.StringComparison]::Ordinal) -and
            $name.EndsWith(".js", [System.StringComparison]::OrdinalIgnoreCase) -and
            $_.Length -gt 0
    })
    if ($javascript.Count -eq 0) {
        throw "VSIX is missing a nonempty WebView JavaScript bundle"
    }

    Write-Output "Verified Visual Studio WebView assets in $resolvedVsixPath"
}
finally {
    $archive.Dispose()
}
