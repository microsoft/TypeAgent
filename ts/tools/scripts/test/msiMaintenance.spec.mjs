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
    assert.match(wxs, /<MajorUpgrade Schedule="afterInstallInitialize"/);
    for (const [action, next] of [
        ["PrepareMaintenance", "RollbackMaintenance"],
        ["RollbackMaintenance", "BeginMaintenance"],
        ["BeginMaintenance", "RemoveExistingProducts"],
    ]) {
        assert.match(
            wxs,
            new RegExp(
                `<Custom Action="${action}" Before="${next}">NOT UPGRADINGPRODUCTCODE</Custom>`,
            ),
        );
    }
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
