// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32") {
    process.exit(0);
}

const packageDirectory = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
);
const repositoryDirectory = path.resolve(
    packageDirectory,
    "..",
    "..",
    "..",
    "..",
);
const project = path.join(
    repositoryDirectory,
    "dotnet",
    "powerShellSandboxBroker",
    "PowerShellSandboxBroker.csproj",
);
for (const architecture of ["win-x64", "win-arm64"]) {
    const output = path.join(packageDirectory, "broker", architecture);
    fs.rmSync(output, { recursive: true, force: true });

    const result = spawnSync(
        "dotnet",
        [
            "publish",
            project,
            "-c",
            "Release",
            "-r",
            architecture,
            "--self-contained",
            "true",
            "-o",
            output,
        ],
        {
            cwd: repositoryDirectory,
            stdio: "inherit",
            shell: true,
        },
    );
    if (result.status !== 0) {
        throw new Error(
            `PowerShell sandbox broker publish failed for ${architecture} with exit code ${result.status}.`,
        );
    }

    for (const file of fs.readdirSync(output)) {
        if (file.endsWith(".pdb")) {
            fs.rmSync(path.join(output, file));
        }
    }
}
