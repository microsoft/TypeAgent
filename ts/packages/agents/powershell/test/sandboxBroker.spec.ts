// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import {
    access,
    copyFile,
    mkdtemp,
    readFile,
    rm,
    writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { executeBrokeredPowerShell } from "../src/execution/windowsSandboxBroker.mjs";
import {
    runDeniedFileReadCase,
    executeRestrictedScript as executeScript,
} from "./sandboxCases.js";

const describeOnWindows =
    process.platform === "win32" &&
    process.env.TYPEAGENT_SKIP_POWERSHELL_BROKER_TESTS !== "1"
        ? describe
        : describe.skip;
const BROKER_TEST_TIMEOUT_SECONDS = 30;

describeOnWindows("legacy restricted broker protocol compatibility", () => {
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

    it("rejects the original .NET read using the legacy host's AST policy", async () => {
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

    it.each(["Format-Table", "Format-List"])(
        "renders %s output rather than internal formatting records",
        async (format) => {
            const result = await executeScript({
                script: `ConvertFrom-Json '{"Name":"sample","Count":7}' | ${format}`,
                parameters: {},
                provenance: "generated",
                sandbox: {
                    allowedCmdlets: ["ConvertFrom-Json", format],
                    allowedPaths: [],
                    allowedModules: [],
                    maxExecutionTime: BROKER_TEST_TIMEOUT_SECONDS,
                    networkAccess: false,
                },
            });

            expect(result).toMatchObject({ success: true, stderr: "" });
            expect(result.stdout).toContain("Name");
            expect(result.stdout).toContain("Count");
            expect(result.stdout).toContain("sample");
            expect(result.stdout).toContain("7");
            expect(result.stdout).not.toMatch(
                /FormatEntryData|FormatStartData/,
            );
        },
    );

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
        "Invoke-WebRequest",
        "Import-Module",
        "Get-Content",
        "Start-Process",
    ])("retains protocol-v1 command rejection for %s", async (command) => {
        const result = await executeScript({
            script: "Write-Output 'blocked'",
            parameters: {},
            provenance: "generated",
            sandbox: {
                allowedCmdlets: [command],
                allowedPaths: [],
                allowedModules: [],
                maxExecutionTime: BROKER_TEST_TIMEOUT_SECONDS,
                networkAccess: false,
            },
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

    describe("OS containment independently of AST and language restrictions", () => {
        beforeEach(async () => {
            const architecture =
                process.arch === "arm64" ? "win-arm64" : "win-x64";
            const brokerName = "PowerShellSandboxBroker.exe";
            const testBroker = join(configDirectory, brokerName);
            await copyFile(
                fileURLToPath(
                    new URL(
                        `../../broker/${architecture}/${brokerName}`,
                        import.meta.url,
                    ),
                ),
                testBroker,
            );
            await copyFile(
                fileURLToPath(
                    new URL(
                        "../../test/fixtures/osIsolationHost.ps1",
                        import.meta.url,
                    ),
                ),
                join(configDirectory, "scriptHost.ps1"),
            );
            process.env.TYPEAGENT_POWERSHELL_BROKER = testBroker;
        });

        async function executeProbe(
            script: string,
            parameters: Record<string, unknown> = {},
        ) {
            const result = await executeBrokeredPowerShell({
                script,
                parameters,
                provenance: "generated",
                allowedCommands: [],
                maxExecutionTime: BROKER_TEST_TIMEOUT_SECONDS,
            });
            expect(result.stdout).toContain("OS probe started: FullLanguage");
            return result;
        }

        it("permits actual .NET reads and writes in private profile storage", async () => {
            const result = await executeProbe(String.raw`
$path = [System.IO.Path]::Combine($env:USERPROFILE, 'probe.txt')
[System.IO.File]::WriteAllText($path, 'private-marker')
[System.IO.File]::ReadAllText($path)
`);

            expect(result.success).toBe(true);
            expect(result.stdout).toContain("private-marker");
        });

        it.each([
            "[System.IO.File]::ReadAllText($Path)",
            "[System.IO.File]::WriteAllText($Path, 'changed')",
        ])(
            "denies an actual external file operation: %s",
            async (operation) => {
                const marker = join(configDirectory, "outside.txt");
                await writeFile(marker, "outside-marker");
                const result = await executeProbe(
                    `param([string]$Path)\n${operation}`,
                    { Path: marker },
                );

                expect(result.success).toBe(false);
                expect(result.stderr).toContain("UnauthorizedAccessException");
                expect(result.stdout).not.toContain("outside-marker");
                await expect(readFile(marker, "utf8")).resolves.toBe(
                    "outside-marker",
                );
            },
        );

        it.each([
            String.raw`
$start = [System.Diagnostics.ProcessStartInfo]::new()
$start.FileName = "$env:SYSTEMROOT\System32\cmd.exe"
$start.Arguments = '/c exit 42'
$start.UseShellExecute = $false
$child = [System.Diagnostics.Process]::Start($start)
$child.WaitForExit()
Write-Output "child exited: $($child.ExitCode)"
`,
            String.raw`
Import-Module Microsoft.PowerShell.Management
New-PSDrive -Name Private -PSProvider FileSystem -Root $env:USERPROFILE | Out-Null
Set-Location Private:\
$child = Start-Process cmd.exe -ArgumentList '/c exit 42' -Wait -PassThru
Write-Output "child exited: $($child.ExitCode)"
`,
        ])(
            "denies actual child creation through .NET or a reimported module",
            async (script) => {
                const result = await executeProbe(script);

                expect(result.success).toBe(false);
                expect(result.stderr).toMatch(
                    /Win32Exception|InvalidOperationException/,
                );
                expect(result.stdout).not.toContain("child exited:");
            },
        );

        it("blocks actual HTTP egress without receiving a request", async () => {
            let requests = 0;
            const server = createServer((_request, response) => {
                requests++;
                response.end("network-marker");
            });
            await new Promise<void>((resolve, reject) => {
                server.once("error", reject);
                server.listen(0, "127.0.0.1", resolve);
            });
            try {
                const address = server.address();
                if (address === null || typeof address === "string") {
                    throw new Error("Expected a TCP listener.");
                }
                const url = `http://127.0.0.1:${address.port}`;
                expect(await (await fetch(url)).text()).toBe("network-marker");
                expect(requests).toBe(1);
                requests = 0;

                const result = await executeProbe(
                    String.raw`param([string]$Url)
$request = [System.Net.WebRequest]::Create($Url)
$request.Timeout = 2000
$response = $request.GetResponse()
$response.Close()
Write-Output 'network succeeded'
`,
                    { Url: url },
                );

                expect(result.success).toBe(false);
                expect(result.stderr).toContain("WebException");
                expect(result.stdout).not.toContain("network succeeded");
                expect(requests).toBe(0);
            } finally {
                await new Promise<void>((resolve, reject) => {
                    server.close((error) =>
                        error ? reject(error) : resolve(),
                    );
                    server.closeAllConnections();
                });
            }
        });
    });
});
