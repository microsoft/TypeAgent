// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeScript } from "../src/execution/powershellRunner.mjs";
import { runDeniedFileReadCase } from "./sandboxCases.js";

const describeOnWindows =
    process.platform === "win32" &&
    process.env.TYPEAGENT_SKIP_POWERSHELL_BROKER_TESTS !== "1"
        ? describe
        : describe.skip;
const BROKER_TEST_TIMEOUT_SECONDS = 30;

describeOnWindows("PowerShell sandbox broker", () => {
    const originalConfigDir = process.env.TYPEAGENT_CONFIG_DIR;
    const originalBrokerPath = process.env.TYPEAGENT_POWERSHELL_BROKER;
    let configDirectory: string;

    beforeEach(async () => {
        configDirectory = await mkdtemp(
            join(tmpdir(), "typeagent-powershell-broker-config-"),
        );
        process.env.TYPEAGENT_CONFIG_DIR = configDirectory;
        await writeFile(
            join(configDirectory, "config.local.yaml"),
            "powershell:\n  dynamicExecution:\n    enabled: true\n  brokerExecution:\n    enabled: true\n",
        );
    });

    afterEach(async () => {
        if (originalConfigDir === undefined) {
            delete process.env.TYPEAGENT_CONFIG_DIR;
        } else {
            process.env.TYPEAGENT_CONFIG_DIR = originalConfigDir;
        }
        if (originalBrokerPath === undefined) {
            delete process.env.TYPEAGENT_POWERSHELL_BROKER;
        } else {
            process.env.TYPEAGENT_POWERSHELL_BROKER = originalBrokerPath;
        }
        await rm(configDirectory, { recursive: true, force: true });
    });

    it("denies the original out-of-policy .NET file read", async () => {
        const result = await runDeniedFileReadCase();

        expect(result).toMatchObject({
            success: false,
            stdout: "",
        });
        expect(result.stderr).toMatch(/policy denied/i);
        expect(result.stdout).not.toContain("outside-marker");
    });

    it("denies .NET file writes without creating a marker", async () => {
        const directory = await mkdtemp(
            join(tmpdir(), "typeagent-powershell-process-denial-"),
        );
        const marker = join(directory, "marker.txt");
        try {
            const result = await executeScript({
                script: `[System.IO.File]::WriteAllText("${marker.replaceAll("\\", "\\\\")}", "created")`,
                parameters: {},
                provenance: "generated",
                sandbox: {
                    allowedCmdlets: ["Write-Output"],
                    allowedPaths: [],
                    allowedModules: [],
                    maxExecutionTime: BROKER_TEST_TIMEOUT_SECONDS,
                    networkAccess: false,
                },
            });

            expect(result.success).toBe(false);
            expect(result.stderr).toMatch(/policy denied/i);
            await expect(access(marker)).rejects.toThrow();
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });

    it("denies .NET process creation without creating a marker", async () => {
        const directory = await mkdtemp(
            join(tmpdir(), "typeagent-powershell-child-denial-"),
        );
        const marker = join(directory, "marker.txt");
        try {
            const escapedMarker = marker.replaceAll("\\", "\\\\");
            const result = await executeScript({
                script: `$process = [System.Diagnostics.Process]::Start("cmd.exe", "/c echo created > \\"${escapedMarker}\\"")
$process.WaitForExit()`,
                parameters: {},
                provenance: "generated",
                sandbox: {
                    allowedCmdlets: ["Write-Output"],
                    allowedPaths: [],
                    allowedModules: [],
                    maxExecutionTime: BROKER_TEST_TIMEOUT_SECONDS,
                    networkAccess: false,
                },
            });

            expect(result.success).toBe(false);
            expect(result.stderr).toMatch(/policy denied/i);
            await expect(access(marker)).rejects.toThrow();
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });

    it("denies indirect method invocation through ForEach-Object", async () => {
        const result = await executeScript({
            script: `$xml = [xml]'<root/>'
$xml | ForEach-Object -MemberName Load -ArgumentList 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\types.ps1xml'
Write-Output $xml.DocumentElement.Name`,
            parameters: {},
            provenance: "generated",
            sandbox: {
                allowedCmdlets: ["ForEach-Object", "Write-Output"],
                allowedPaths: [],
                allowedModules: [],
                maxExecutionTime: BROKER_TEST_TIMEOUT_SECONDS,
                networkAccess: false,
            },
        });

        expect(result.success).toBe(false);
        expect(result.stdout).not.toContain("Types");
        expect(result.stderr).toMatch(/policy denied/i);
    });

    it("denies positional ForEach-Object member invocation", async () => {
        const result = await executeScript({
            script: "Write-Output 'value' | ForEach-Object ToUpper",
            parameters: {},
            provenance: "generated",
            sandbox: {
                allowedCmdlets: ["ForEach-Object", "Write-Output"],
                allowedPaths: [],
                allowedModules: [],
                maxExecutionTime: BROKER_TEST_TIMEOUT_SECONDS,
                networkAccess: false,
            },
        });

        expect(result.success).toBe(false);
        expect(result.stderr).toMatch(/policy denied/i);
    });

    it.each([
        "function Write-Output { Get-Content C:\\Windows\\win.ini }\nWrite-Output",
        "class UnsafeType { [string] Read() { return [System.IO.File]::ReadAllText('C:\\Windows\\win.ini') } }",
    ])("denies user-defined command and type shadowing", async (script) => {
        const result = await executeScript({
            script,
            parameters: {},
            provenance: "generated",
            sandbox: {
                allowedCmdlets: ["Write-Output"],
                allowedPaths: [],
                allowedModules: [],
                maxExecutionTime: BROKER_TEST_TIMEOUT_SECONDS,
                networkAccess: false,
            },
        });

        expect(result.success).toBe(false);
        expect(result.stderr).toMatch(/policy denied/i);
    });

    it.each([
        "using module Microsoft.PowerShell.Management\nWrite-Output 'blocked'",
        "#requires -Modules Microsoft.PowerShell.Management\nWrite-Output 'blocked'",
    ])("denies module loading syntax", async (script) => {
        const result = await executeScript({
            script,
            parameters: {},
            provenance: "generated",
            sandbox: {
                allowedCmdlets: ["Write-Output"],
                allowedPaths: [],
                allowedModules: [],
                maxExecutionTime: BROKER_TEST_TIMEOUT_SECONDS,
                networkAccess: false,
            },
        });

        expect(result.success).toBe(false);
        expect(result.stderr).toMatch(/policy denied/i);
    });

    it("does not pass parent-process secrets into the AppContainer", async () => {
        const originalSecret = process.env.TYPEAGENT_BROKER_TEST_SECRET;
        process.env.TYPEAGENT_BROKER_TEST_SECRET = "parent-secret";
        try {
            const result = await executeScript({
                script: "Write-Output $env:TYPEAGENT_BROKER_TEST_SECRET",
                parameters: {},
                provenance: "generated",
                sandbox: {
                    allowedCmdlets: ["Write-Output"],
                    allowedPaths: [],
                    allowedModules: [],
                    maxExecutionTime: BROKER_TEST_TIMEOUT_SECONDS,
                    networkAccess: false,
                },
            });

            expect(result.success).toBe(true);
            expect(result.stdout).not.toContain("parent-secret");
        } finally {
            if (originalSecret === undefined) {
                delete process.env.TYPEAGENT_BROKER_TEST_SECRET;
            } else {
                process.env.TYPEAGENT_BROKER_TEST_SECRET = originalSecret;
            }
        }
    });

    it("preserves Unicode output through the broker protocol", async () => {
        const result = await executeScript({
            script: "Write-Output 'héllo 世界'",
            parameters: {},
            provenance: "generated",
            sandbox: {
                allowedCmdlets: ["Write-Output"],
                allowedPaths: [],
                allowedModules: [],
                maxExecutionTime: BROKER_TEST_TIMEOUT_SECONDS,
                networkAccess: false,
            },
        });

        expect(result.success).toBe(true);
        expect(result.stdout.trim()).toBe("héllo 世界");
    });

    it("isolates concurrent dynamic executions", async () => {
        const execute = (value: string) =>
            executeScript({
                script: "param([string]$Value)\nWrite-Output $Value",
                parameters: { Value: value },
                provenance: "generated",
                sandbox: {
                    allowedCmdlets: ["Write-Output"],
                    allowedPaths: [],
                    allowedModules: [],
                    maxExecutionTime: BROKER_TEST_TIMEOUT_SECONDS,
                    networkAccess: false,
                },
            });

        const [first, second] = await Promise.all([
            execute("first"),
            execute("second"),
        ]);

        expect(first).toMatchObject({ success: true });
        expect(first.stdout.trim()).toBe("first");
        expect(second).toMatchObject({ success: true });
        expect(second.stdout.trim()).toBe("second");
    });

    it("terminates the sandbox job when execution times out", async () => {
        const started = Date.now();
        const result = await executeScript({
            script: "Start-Sleep -Seconds 30",
            parameters: {},
            provenance: "generated",
            sandbox: {
                allowedCmdlets: ["Start-Sleep"],
                allowedPaths: [],
                allowedModules: [],
                maxExecutionTime: 1,
                networkAccess: false,
            },
        });

        expect(result).toMatchObject({
            success: false,
            cancelled: false,
        });
        expect(result.stderr).toMatch(/timed out/i);
        expect(Date.now() - started).toBeLessThan(10_000);
    });

    it.each([
        {
            label: "network capability",
            sandbox: {
                allowedCmdlets: ["Write-Output"],
                allowedPaths: [],
                allowedModules: [],
                maxExecutionTime: BROKER_TEST_TIMEOUT_SECONDS,
                networkAccess: true,
            },
        },
        {
            label: "module capability",
            sandbox: {
                allowedCmdlets: ["Write-Output"],
                allowedPaths: [],
                allowedModules: ["Microsoft.PowerShell.Management"],
                maxExecutionTime: BROKER_TEST_TIMEOUT_SECONDS,
                networkAccess: false,
            },
        },
        {
            label: "filesystem capability",
            sandbox: {
                allowedCmdlets: ["Write-Output"],
                allowedPaths: ["$env:USERPROFILE"],
                allowedModules: [],
                maxExecutionTime: BROKER_TEST_TIMEOUT_SECONDS,
                networkAccess: false,
            },
        },
        {
            label: "process command",
            sandbox: {
                allowedCmdlets: ["Start-Process"],
                allowedPaths: [],
                allowedModules: [],
                maxExecutionTime: BROKER_TEST_TIMEOUT_SECONDS,
                networkAccess: false,
            },
        },
    ])("denies requested $label", async ({ sandbox }) => {
        const result = await executeScript({
            script: "Write-Output 'blocked'",
            parameters: {},
            provenance: "generated",
            sandbox,
        });

        expect(result.success).toBe(false);
        expect(result.stderr).toMatch(/policy denied/i);
    });

    it("fails closed when the broker cannot start", async () => {
        process.env.TYPEAGENT_POWERSHELL_BROKER = join(
            configDirectory,
            "missing-broker.exe",
        );

        const result = await executeScript({
            script: "Write-Output 'must not run'",
            parameters: {},
            provenance: "generated",
            sandbox: {
                allowedCmdlets: ["Write-Output"],
                allowedPaths: [],
                allowedModules: [],
                maxExecutionTime: 10,
                networkAccess: false,
            },
        });

        expect(result).toMatchObject({
            success: false,
            stdout: "",
        });
        expect(result.stderr).toMatch(/broker failed to start/i);
    });
});
