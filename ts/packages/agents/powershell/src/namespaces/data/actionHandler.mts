// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { PowerShellDataActions } from "./dataActionsSchema.mjs";
import {
    createPowerShellNamespaceActionHandler,
    type NamespaceActionDefinitions,
} from "../namespaceActionHandler.mjs";

const allowedPaths = ["$env:USERPROFILE", "$PWD", "$env:TEMP"] as const;

const definitions = {
    readJson: {
        script: `param([string]$Path, [string]$PropertyPath)
$value = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
if ($PropertyPath) {
    foreach ($part in $PropertyPath.Split(".")) { $value = $value.$part }
}
$value`,
        allowedCmdlets: ["Get-Content", "ConvertFrom-Json"],
        allowedPaths,
    },
    writeJson: {
        script: `param([string]$Path, [string]$Data)
$Data | ConvertFrom-Json | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $Path`,
        allowedCmdlets: ["ConvertFrom-Json", "ConvertTo-Json", "Set-Content"],
        allowedPaths,
        confirmation: "Write JSON data to the requested file?",
    },
    readCsv: {
        script: `param([string]$Path, [string]$Delimiter)
if (-not $Delimiter) { $Delimiter = "," }
Import-Csv -LiteralPath $Path -Delimiter $Delimiter`,
        allowedCmdlets: ["Import-Csv"],
        allowedPaths,
    },
    writeCsv: {
        script: `param([string]$Path, [string]$Data)
$Data | ConvertFrom-Json | Export-Csv -LiteralPath $Path -NoTypeInformation`,
        allowedCmdlets: ["ConvertFrom-Json", "Export-Csv"],
        allowedPaths,
        confirmation: "Write CSV data to the requested file?",
    },
    filterCsv: {
        script: `param([string]$Path, [string]$Column, [string]$Pattern)
Import-Csv -LiteralPath $Path | Where-Object { $_.$Column -match $Pattern }`,
        allowedCmdlets: ["Import-Csv", "Where-Object"],
        allowedPaths,
    },
    convertFormat: {
        script: `param([string]$Input, [string]$Format)
$extension = [System.IO.Path]::GetExtension($Input).ToLowerInvariant()
$value = if ($extension -eq ".csv") {
    Import-Csv -LiteralPath $Input
} elseif ($extension -eq ".json") {
    Get-Content -LiteralPath $Input -Raw | ConvertFrom-Json
} else {
    Get-Content -LiteralPath $Input -Raw
}
if ($Format -eq "json") {
    $value | ConvertTo-Json -Depth 20
} elseif ($Format -eq "csv") {
    $value | ConvertTo-Csv -NoTypeInformation
} else {
    $value | ConvertTo-Xml -As String -Depth 20
}`,
        allowedCmdlets: [
            "Import-Csv",
            "Get-Content",
            "ConvertFrom-Json",
            "ConvertTo-Json",
            "ConvertTo-Csv",
            "ConvertTo-Xml",
        ],
        allowedPaths,
    },
} satisfies NamespaceActionDefinitions<PowerShellDataActions>;

export const dataActionHandler =
    createPowerShellNamespaceActionHandler<PowerShellDataActions>(
        "powershell.powershell-data",
        definitions,
    );
