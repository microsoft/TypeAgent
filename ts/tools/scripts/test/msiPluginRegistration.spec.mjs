// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
    resolveCopilotCli,
    runCopilot,
} from "../../installers/common/register-plugin.mjs";

const wixDir = fileURLToPath(new URL("../../installers/wix/", import.meta.url));
const registrar = fileURLToPath(
    new URL("../../installers/common/register-plugin.mjs", import.meta.url),
);

function temporaryDirectory(t) {
    const root = fs.mkdtempSync(
        path.join(os.tmpdir(), "TypeAgent plugin repair "),
    );
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    return root;
}

function launcher(root, name, script) {
    const source = path.join(root, `${name}.mjs`);
    fs.writeFileSync(source, script);
    const command = path.join(root, `${name}.cmd`);
    fs.writeFileSync(command, `@"${process.execPath}" "${source}" %*\r\n`);
    return command;
}

test("direct executable arguments preserve shell metacharacters literally", async () => {
    const args = [
        "path with spaces",
        "value & echo injected",
        "value; echo injected",
        "$(echo injected)",
        "%PATH%",
        '"quoted"',
    ];
    const result = await runCopilot(
        process.execPath,
        [
            "-e",
            "console.log(JSON.stringify(process.argv.slice(1)))",
            "--",
            ...args,
        ],
        { write() {} },
    );
    assert.equal(result.failed, false);
    assert.deepEqual(JSON.parse(result.output), args);
});

test("registration commands time out and retain diagnostic output", async () => {
    const lines = [];
    const started = Date.now();
    await assert.rejects(
        runCopilot(
            process.execPath,
            ["-e", "console.log('started'); setInterval(() => {}, 1000)"],
            { write: (line) => lines.push(line) },
            false,
            1_000,
        ),
        /timed out after 1000 ms/,
    );
    assert.ok(Date.now() - started < 10_000);
    assert.match(lines.join("\n"), /copilot> started/);
    assert.match(lines.join("\n"), /Copilot invocation failed/);
});

test(
    "PowerShell launchers use File mode with literal paths and arguments",
    { skip: process.platform !== "win32" },
    async (t) => {
        const root = temporaryDirectory(t);
        const script = path.join(root, "copilot & literal.ps1");
        fs.writeFileSync(
            script,
            "ConvertTo-Json -InputObject @($args) -Compress\n",
        );
        const args = [
            "path with spaces",
            "value & echo injected",
            "$(Get-Date)",
            "%PATH%",
        ];
        const result = await runCopilot(script, args, { write() {} });
        assert.equal(result.failed, false);
        assert.deepEqual(JSON.parse(result.output), args);
    },
);

test("allowed command failures still report timeout rather than success", async () => {
    const result = await runCopilot(
        process.execPath,
        ["-e", "setInterval(() => {}, 1000)"],
        { write() {} },
        true,
        100,
    );
    assert.equal(result.failed, true);
    assert.equal(result.status, 1);
});

test(
    "Windows version probe kills a hung launcher tree and selects a fallback",
    {
        skip: process.platform !== "win32",
    },
    async (t) => {
        const root = temporaryDirectory(t);
        const pidFile = path.join(root, "pid");
        const hung = launcher(
            root,
            "hung",
            `
        import fs from 'node:fs';
        fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
        console.log('hung version probe');
        setInterval(() => {}, 1000);
    `,
        );
        const working = launcher(root, "working", "console.log('1.0.0');");
        const lines = [];
        const selected = await resolveCopilotCli({
            env: {},
            pathCopilot: [hung, working],
            logger: { write: (line) => lines.push(line) },
        });
        assert.equal(selected, working);
        assert.match(lines.join("\n"), /validation timed out after 10000 ms/);
        const pid = Number(fs.readFileSync(pidFile, "utf8"));
        assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
    },
);

function registrationFixture(t) {
    const root = temporaryDirectory(t);
    for (const file of ["register-plugin.ps1", "exit-dialog.vbs"]) {
        fs.copyFileSync(path.join(wixDir, file), path.join(root, file));
    }
    fs.copyFileSync(registrar, path.join(root, "register-plugin.mjs"));
    fs.writeFileSync(
        path.join(root, "resolve-node.ps1"),
        `function Resolve-NodeExe { return '${process.execPath.replaceAll("'", "''")}' }\n`,
    );
    const plugin = path.join(root, "copilot-plugin");
    fs.mkdirSync(path.join(plugin, "dist", "mcp"), { recursive: true });
    fs.writeFileSync(
        path.join(plugin, "plugin.json"),
        JSON.stringify({
            name: "typeagent",
            version: "0.0.1",
        }),
    );
    fs.writeFileSync(path.join(plugin, "dist", "mcp", "server.js"), "");
    fs.writeFileSync(
        path.join(plugin, ".mcp.json"),
        JSON.stringify({
            mcpServers: {
                typeagent: {},
                "typeagent-workspace": {},
                "typeagent-macros": {},
            },
        }),
    );
    const home = path.join(root, "copilot-home");
    const log = path.join(root, "TypeAgent", "logs", "msi-register-plugin.log");
    const state = path.join(root, "state.json");
    const fail = path.join(root, "fail");
    const cli = launcher(
        root,
        "copilot",
        `
        import fs from 'node:fs';
        const args = process.argv.slice(2).join(' ');
        const statePath = ${JSON.stringify(state)};
        const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath)) : {};
        if (args === '--version') console.log('1.0.0');
        else if (args === 'plugin marketplace list') {
            if (state.marketplace) console.log('typeagent-local (Local: ' + state.marketplace + ')');
        } else if (args.startsWith('plugin marketplace add ')) state.marketplace = process.argv[5];
        else if (args === 'plugin list') {
            if (state.installed) console.log('typeagent@typeagent-local (v0.0.1) (enabled)');
        } else if (/^plugin (install|update) /.test(args)) {
            if (fs.existsSync(${JSON.stringify(fail)})) {
                console.error('Failed to register fixture plugin');
                process.exit(1);
            }
            state.installed = true;
        }
        fs.writeFileSync(statePath, JSON.stringify(state));
    `,
    );
    const run = () =>
        spawnSync(
            "powershell.exe",
            [
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                path.join(root, "register-plugin.ps1"),
                "-InstallDir",
                root,
                "-LogPath",
                log,
            ],
            {
                encoding: "utf8",
                timeout: 30_000,
                env: {
                    ...process.env,
                    COPILOT_HOME: home,
                    COPILOT_CLI_PATH: cli,
                },
            },
        );
    return { root, home, log, state, fail, run };
}

test(
    "MSI registration failure is recoverable by rerunning the Repair action",
    {
        skip: process.platform !== "win32",
    },
    (t) => {
        const fixture = registrationFixture(t);
        fs.writeFileSync(fixture.fail, "");
        const failed = fixture.run();
        assert.equal(failed.status, 1, failed.stdout + failed.stderr);
        assert.equal(
            fs.readFileSync(`${fixture.log}.status`, "utf8").trim(),
            "incomplete",
        );
        assert.match(fs.readFileSync(fixture.log, "utf8"), /choose Repair/);
        assert.match(
            fs.readFileSync(fixture.log, "utf8"),
            /Registration failed/,
        );

        fs.unlinkSync(fixture.fail);
        const repaired = fixture.run();
        assert.equal(repaired.status, 0, repaired.stdout + repaired.stderr);
        assert.equal(
            fs.readFileSync(`${fixture.log}.status`, "utf8").trim(),
            "complete",
        );
        assert.equal(
            JSON.parse(fs.readFileSync(fixture.state)).installed,
            true,
        );
        const copied = JSON.parse(
            fs.readFileSync(
                path.join(
                    fixture.home,
                    "marketplaces",
                    "typeagent-local",
                    "plugins",
                    "typeagent",
                    ".mcp.json",
                ),
            ),
        );
        assert.deepEqual(Object.keys(copied.mcpServers), [
            "typeagent",
            "typeagent-workspace",
            "typeagent-macros",
        ]);

        // A failed repair must not retain the previous success receipt.
        fs.writeFileSync(fixture.fail, "");
        assert.equal(fixture.run().status, 1);
        assert.equal(
            fs.readFileSync(`${fixture.log}.status`, "utf8").trim(),
            "incomplete",
        );
    },
);

test(
    "MSI wrapper records failure before Node or the shared registrar is available",
    {
        skip: process.platform !== "win32",
    },
    (t) => {
        const fixture = registrationFixture(t);
        fs.writeFileSync(
            path.join(fixture.root, "resolve-node.ps1"),
            "function Resolve-NodeExe { return $null }\n",
        );
        const result = fixture.run();
        assert.equal(result.status, 1);
        assert.equal(
            fs.readFileSync(`${fixture.log}.status`, "utf8").trim(),
            "incomplete",
        );
        assert.match(
            fs.readFileSync(fixture.log, "utf8"),
            /Node.js was not found/,
        );
    },
);

test("MSI repair reruns registration and checks status after execution", () => {
    const wxs = fs.readFileSync(
        path.join(wixDir, "TypeAgent-AgentServer.wxs"),
        "utf8",
    );
    for (const action of ["RegisterCopilotPlugin", "InstallPrereqs"]) {
        assert.match(
            wxs,
            new RegExp(
                `<Custom Action="${action}"[^>]*>NOT REMOVE~="ALL"</Custom>`,
            ),
        );
    }
    assert.match(wxs, /Dialog="MaintenanceTypeDlg" Control="RepairButton"/);
    assert.match(
        wxs,
        /Action="ResetTypeAgentPluginStatus" Before="ExecuteAction">NOT REMOVE~="ALL"/,
    );
    assert.match(
        wxs,
        /Action="CheckTypeAgentPlugin" After="CheckTypeAgentConfig">NOT REMOVE~="ALL"/,
    );
    assert.match(wxs, /TYPEAGENTPLUGININCOMPLETE="1"/);
    assert.match(wxs, /Reopen this TypeAgent installer and choose Repair/);
});

test(
    "completion status handles success, missing status, stale status, and read errors",
    {
        skip: process.platform !== "win32",
    },
    (t) => {
        const root = temporaryDirectory(t);
        const statusDir = path.join(root, "TypeAgent", "logs");
        fs.mkdirSync(statusDir, { recursive: true });
        const status = path.join(statusDir, "msi-register-plugin.log.status");
        const script = fs.readFileSync(
            path.join(wixDir, "exit-dialog.vbs"),
            "utf8",
        );
        const harness = path.join(root, "check.vbs");
        fs.writeFileSync(
            harness,
            script +
                `
Class FakeSession
    Private values
    Private Sub Class_Initialize()
        Set values = CreateObject("Scripting.Dictionary")
    End Sub
    Public Property Get [Property](key)
        If values.Exists(key) Then [Property] = values(key) Else [Property] = ""
    End Property
    Public Property Let [Property](key, value)
        values(key) = value
    End Property
End Class
Dim Session
Set Session = New FakeSession
Session.Property("LocalAppDataFolder") = WScript.Arguments(0)
If WScript.Arguments(1) = "reset" Then
    ResetTypeAgentPluginStatus
Else
    Session.Property("TYPEAGENTPLUGINSTATUSRESET") = "1"
End If
CheckTypeAgentPlugin
WScript.Echo "incomplete=" & Session.Property("TYPEAGENTPLUGININCOMPLETE")
`,
        );
        const check = (mode = "check") => {
            const result = spawnSync(
                "cscript.exe",
                ["//nologo", harness, root, mode],
                {
                    encoding: "utf8",
                    timeout: 10_000,
                },
            );
            assert.equal(result.status, 0, result.stdout + result.stderr);
            return result.stdout.trim();
        };
        assert.equal(check(), "incomplete=1");
        fs.writeFileSync(status, "complete\r\n");
        assert.equal(check(), "incomplete=");
        assert.equal(check("reset"), "incomplete=1");
        assert.equal(fs.existsSync(status), false);
        fs.writeFileSync(status, "incomplete\r\n");
        assert.equal(check(), "incomplete=1");
        fs.unlinkSync(status);
        fs.mkdirSync(status);
        assert.equal(check(), "incomplete=1");
    },
);
