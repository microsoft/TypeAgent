// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    executeScript,
    type ScriptExecutionResult,
} from "../src/execution/powershellRunner.mjs";

export async function runDeniedFileReadCase(): Promise<ScriptExecutionResult> {
    const directory = await mkdtemp(
        join(tmpdir(), "typeagent-powershell-dotnet-path-policy-"),
    );
    const allowedDirectory = join(directory, "allowed");
    const deniedDirectory = join(directory, "denied");
    const deniedPath = join(deniedDirectory, "marker.txt");
    try {
        await mkdir(allowedDirectory);
        await mkdir(deniedDirectory);
        await writeFile(deniedPath, "outside-marker");

        return await executeScript({
            script: String.raw`param([string]$AllowedRoot)
$deniedPath = [System.IO.Path]::GetFullPath(
    [System.IO.Path]::Combine($AllowedRoot, "..\denied\marker.txt")
)
[System.IO.File]::ReadAllText($deniedPath)`,
            parameters: { AllowedRoot: allowedDirectory },
            provenance: "generated",
            parameterRoles: { AllowedRoot: "path" },
            sandbox: {
                allowedCmdlets: [],
                allowedPaths: [allowedDirectory],
                allowedModules: [],
                maxExecutionTime: 10,
                networkAccess: false,
            },
        });
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}
