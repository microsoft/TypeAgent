// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { cmdStart } from "../typeagent-serve.mjs";

const installerDir = fileURLToPath(
    new URL("../../installers/wix/", import.meta.url),
);
const wxs = fs.readFileSync(
    path.join(installerDir, "TypeAgent-AgentServer.wxs"),
    "utf8",
);

test("MSI begins maintenance transactionally before removing older versions", () => {
    assert.match(wxs, /<MajorUpgrade Schedule="afterInstallExecute"/);
    assert.match(wxs, /Action="PrepareMaintenance" After="InstallInitialize"/);
    assert.match(wxs, /Action="RollbackMaintenance" Before="BeginMaintenance"/);
    assert.match(wxs, /Action="BeginMaintenance" After="PrepareMaintenance"/);
    assert.match(wxs, /Id="BeginMaintenance"[^>]*Execute="deferred"/);
    assert.match(wxs, /<InstallExecute After="CommitMaintenance"\s*\/>/);
    assert.match(wxs, /Id="RollbackMaintenance"[^>]*Execute="rollback"/);
    assert.match(wxs, /Id="CommitMaintenance"[^>]*Execute="commit"/);
    assert.match(
        wxs,
        /Action="StartAgentServer"\s+After="CompleteMaintenance"/,
    );
    assert.match(wxs, /Binary Id="MaintainServerPs1"/);
});

test("maintenance blocks startup before checking ports or launching a child", async (t) => {
    const root = fs.mkdtempSync(
        path.join(os.tmpdir(), "typeagent-maintenance-"),
    );
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.writeFileSync(path.join(root, ".msi-maintenance"), "transaction");
    const messages = [];
    t.mock.method(console, "error", (message) => messages.push(message));
    const result = await cmdStart({
        serverPath: path.join(root, "agent-server", "dist", "server.js"),
        isListening: () =>
            assert.fail("must not check the server during maintenance"),
        spawnImpl: () => assert.fail("must not launch during maintenance"),
    });
    assert.equal(result, 1);
    assert.match(messages.join("\n"), /setup is in progress/);
});

if (process.platform === "win32") {
    test("restored server does not hold the installer's output pipe open", (t) => {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "typeagent-restore-"),
        );
        const ready = path.join(root, "ready.json");
        const server = path.join(root, "server.cjs");
        const psQuote = (value) => `'${value.replaceAll("'", "''")}'`;
        t.after(() => {
            if (fs.existsSync(ready)) {
                const { pid } = JSON.parse(fs.readFileSync(ready, "utf8"));
                try {
                    process.kill(pid);
                } catch (error) {
                    if (error.code !== "ESRCH") throw error;
                }
            }
            fs.rmSync(root, { recursive: true, force: true, maxRetries: 10 });
        });
        fs.writeFileSync(
            server,
            `require("node:fs").writeFileSync(${JSON.stringify(ready)}, JSON.stringify({pid:process.pid})); setInterval(() => console.log("alive"), 100);`,
        );
        const script = `
. ${psQuote(path.join(installerDir, "maintain-server.ps1"))}
$Root = ${psQuote(root)}
$snapshot = Get-CimInstance Win32_Process -Filter "ProcessId=$PID"
$command = @{
    Executable = ${psQuote(process.execPath)}
    Arguments = ${psQuote(`"${server}"`)}
    LaunchContext = Get-LaunchContext $snapshot
}
Start-RestoredServer $command
Write-Output "RECOVERY_CALLER_EXITED"
`;
        const result = spawnSync(
            "powershell.exe",
            ["-NoProfile", "-NonInteractive", "-Command", script],
            { encoding: "utf8", timeout: 15000 },
        );
        assert.ifError(result.error);
        assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
        assert.match(result.stdout, /RECOVERY_CALLER_EXITED/);
        const { pid } = JSON.parse(fs.readFileSync(ready, "utf8"));
        assert.equal(process.kill(pid, 0), true);
        assert.match(
            fs.readFileSync(
                path.join(root, "logs", "msi-restored-server.log"),
                "utf8",
            ),
            /alive/,
        );
    });

    test("Windows maintenance preserves payloads and scopes shutdown safely", () => {
        const result = spawnSync(
            "powershell.exe",
            [
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                fileURLToPath(
                    new URL("./msiMaintenance.tests.ps1", import.meta.url),
                ),
                "-MaintenanceScript",
                path.join(installerDir, "maintain-server.ps1"),
            ],
            { encoding: "utf8", timeout: 60000 },
        );
        assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
        assert.match(result.stdout, /All maintenance scenarios passed/);
    });
}
