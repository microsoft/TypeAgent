// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
    copilotCandidates,
    copilotVersionTimeoutMs,
    resolveCopilotCli,
} from "../../installers/common/register-plugin.mjs";

async function resolve({
    env = {},
    pathCopilot = "",
    copilotPath = "",
    outcomes = new Map(),
}) {
    const lines = [];
    const probed = [];
    const logger = { write: (line) => lines.push(line) };
    const probe = (candidate) => {
        probed.push(candidate);
        const outcome = outcomes.get(candidate) ?? { status: 0 };
        if (outcome instanceof Error) throw outcome;
        return outcome;
    };
    const selected = await resolveCopilotCli({
        copilotPath,
        env,
        platform: "win32",
        pathCopilot,
        logger,
        probe,
    });
    return { selected, probed, lines };
}

test("working PATH npm shim wins over a stale WinGet fallback", async () => {
    const pathShim = String.raw`C:\.tools\.npm-global\copilot.cmd`;
    const localAppData = String.raw`C:\Users\test\AppData\Local`;
    const staleWinGet = path.win32.join(
        localAppData,
        "Microsoft",
        "WinGet",
        "Links",
        "copilot.exe",
    );
    const result = await resolve({
        env: { LOCALAPPDATA: localAppData },
        pathCopilot: pathShim,
        outcomes: new Map([
            [pathShim, { status: 0 }],
            [staleWinGet, { status: 1 }],
        ]),
    });

    assert.equal(result.selected, pathShim);
    assert.deepEqual(result.probed, [pathShim]);
    assert.match(result.lines.join("\n"), /Selected Copilot CLI/);
});

test("later PATH candidate is tried when the first candidate fails", async () => {
    const stale = String.raw`C:\stale\copilot.exe`;
    const working = String.raw`C:\.tools\.npm-global\copilot.cmd`;
    const result = await resolve({
        pathCopilot: [stale, working],
        outcomes: new Map([
            [stale, { status: 1 }],
            [working, { status: 0 }],
        ]),
    });

    assert.equal(result.selected, working);
    assert.deepEqual(result.probed, [stale, working]);
});

test("PATH discovery probes a later working executable", async (t) => {
    const root = fs.mkdtempSync(
        path.join(os.tmpdir(), "typeagent-copilot-resolution-"),
    );
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));

    const staleDir = path.join(root, "stale");
    const workingDir = path.join(root, "working");
    fs.mkdirSync(staleDir);
    fs.mkdirSync(workingDir);

    const executableName =
        process.platform === "win32" ? "copilot.cmd" : "copilot";
    const stale = path.join(staleDir, executableName);
    const working = path.join(workingDir, executableName);
    if (process.platform === "win32") {
        fs.writeFileSync(stale, "@exit /b 1\r\n");
        fs.writeFileSync(working, "@echo 1.0.0\r\n@exit /b 0\r\n");
    } else {
        fs.writeFileSync(stale, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
        fs.writeFileSync(working, "#!/bin/sh\necho 1.0.0\n", {
            mode: 0o755,
        });
    }

    const lines = [];
    const selected = await resolveCopilotCli({
        env: {
            ...process.env,
            PATH: [staleDir, workingDir, process.env.PATH]
                .filter(Boolean)
                .join(path.delimiter),
        },
        logger: { write: (line) => lines.push(line) },
    });

    const selectedStat = fs.statSync(selected);
    const workingStat = fs.statSync(working);
    assert.equal(selectedStat.dev, workingStat.dev);
    assert.equal(selectedStat.ino, workingStat.ino);
    assert.match(lines.join("\n"), /validation failed/);
});

test("extensionless COPILOT_CLI_PATH remains the highest-priority override", async () => {
    const override = String.raw`C:\custom\copilot`;
    const pathCandidate = String.raw`C:\path\copilot.cmd`;
    const result = await resolve({
        env: { COPILOT_CLI_PATH: override },
        pathCopilot: pathCandidate,
    });

    assert.equal(result.selected, override);
    assert.deepEqual(result.probed, [override]);
});

test("linked Windows executables are canonicalized before spawning", async (t) => {
    const root = fs.mkdtempSync(
        path.join(os.tmpdir(), "typeagent-copilot-link-"),
    );
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const link = path.join(root, "WinGet Links");
    fs.symlinkSync(
        path.dirname(process.execPath),
        link,
        process.platform === "win32" ? "junction" : "dir",
    );
    const linkedExecutable = path.join(link, path.basename(process.execPath));
    const spawned = [];
    const spawn = childProcess.spawn;
    const spawnMock = t.mock.method(childProcess, "spawn", (...args) => {
        spawned.push(args[0]);
        return spawn(...args);
    });
    syncBuiltinESMExports();
    t.after(() => {
        spawnMock.mock.restore();
        syncBuiltinESMExports();
    });

    const candidates = [linkedExecutable];
    if (process.platform === "win32") {
        candidates.push(linkedExecutable.replace(/\.exe$/i, ""));
    }
    for (const candidate of candidates) {
        const selected = await resolveCopilotCli({
            env: { COPILOT_CLI_PATH: candidate },
            pathCopilot: [],
            logger: { write() {} },
        });
        assert.equal(selected, candidate);
    }
    assert.deepEqual(
        spawned,
        candidates.map(() =>
            process.platform === "win32"
                ? fs.realpathSync.native(process.execPath)
                : linkedExecutable,
        ),
    );
});

test("VS Code Copilot shim is rejected before a working fallback", async () => {
    const appData = String.raw`C:\Users\test\AppData\Roaming`;
    const shim = path.win32.join(
        appData,
        "Code",
        "User",
        "globalStorage",
        "github.copilot-chat",
        "COPILOTCLI",
        "copilot.exe",
    );
    const fallback = String.raw`C:\tools\copilot.cmd`;
    const result = await resolve({
        env: { APPDATA: appData },
        copilotPath: shim,
        pathCopilot: fallback,
    });

    assert.equal(result.selected, fallback);
    assert.deepEqual(result.probed, [fallback]);
    assert.match(result.lines.join("\n"), /Rejected VS Code Copilot shim/);
});

test(
    "WinGet package fallback bypasses a broken non-symlink launcher",
    {
        skip: process.platform !== "win32",
    },
    async (t) => {
        const root = fs.realpathSync.native(
            fs.mkdtempSync(path.join(os.tmpdir(), "typeagent-winget-")),
        );
        t.after(() => fs.rmSync(root, { recursive: true, force: true }));
        const localAppData = path.join(root, "Local");
        const packages = path.join(
            localAppData,
            "Microsoft",
            "WinGet",
            "Packages",
        );
        const packageDir = path.join(
            packages,
            "GitHub.Copilot_Microsoft.Winget.Source_test",
        );
        const link = path.join(
            localAppData,
            "Microsoft",
            "WinGet",
            "Links",
            "copilot.exe",
        );
        fs.mkdirSync(packageDir, { recursive: true });
        fs.mkdirSync(path.dirname(link), { recursive: true });
        fs.writeFileSync(link, "not a Windows executable");
        assert.equal(fs.lstatSync(link).isSymbolicLink(), false);
        assert.equal(fs.realpathSync.native(link), link);

        const executable = path.join(packageDir, "copilot.exe");
        fs.copyFileSync(process.execPath, executable);
        const lines = [];
        const selected = await resolveCopilotCli({
            env: {
                LOCALAPPDATA: localAppData,
                APPDATA: path.join(root, "Roaming"),
            },
            copilotPath: link,
            pathCopilot: [],
            logger: { write: (line) => lines.push(line) },
        });
        assert.equal(selected, executable);
        assert.match(lines.join("\n"), /validation failed for .*Links/);
        assert.match(lines.join("\n"), /WinGet package fallback/);
        assert.match(lines.join("\n"), /Selected Copilot CLI/);
    },
);

test(
    "WinGet discovery is lazy, scoped to Copilot, and tries machine packages",
    {
        skip: process.platform !== "win32",
    },
    async (t) => {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "typeagent-winget-scope-"),
        );
        t.after(() => fs.rmSync(root, { recursive: true, force: true }));
        const localAppData = path.join(root, "Local");
        const programFiles = path.join(root, "Program Files");
        const userPackages = path.join(
            localAppData,
            "Microsoft",
            "WinGet",
            "Packages",
        );
        const machinePackages = path.join(programFiles, "WinGet", "Packages");
        for (const name of [
            "GitHub.Copilot_a-stale",
            "GitHub.Copilot.Preview_source",
            "Other.Tool_source",
        ]) {
            fs.mkdirSync(path.join(userPackages, name), { recursive: true });
        }
        fs.mkdirSync(path.join(machinePackages, "GitHub.Copilot_source"), {
            recursive: true,
        });
        const stale = path.join(
            userPackages,
            "GitHub.Copilot_a-stale",
            "copilot.exe",
        );
        const working = path.join(
            machinePackages,
            "GitHub.Copilot_source",
            "copilot.exe",
        );
        const link = path.join(
            localAppData,
            "Microsoft",
            "WinGet",
            "Links",
            "copilot.exe",
        );
        const env = {
            LOCALAPPDATA: localAppData,
            ProgramFiles: programFiles,
            ProgramW6432: programFiles,
        };
        const result = await resolve({
            env,
            pathCopilot: [],
            outcomes: new Map([
                [link, { status: 1 }],
                [stale, { status: 1 }],
            ]),
        });
        assert.equal(result.selected, working);
        assert.deepEqual(result.probed, [link, stale, working]);

        const read = t.mock.method(fs, "readdirSync", () => {
            throw new Error(
                "Package discovery should not run for a working override",
            );
        });
        const override = await resolve({
            env: { ...env, COPILOT_CLI_PATH: working },
            pathCopilot: [],
        });
        assert.equal(override.selected, working);
        assert.equal(read.mock.callCount(), 0);
    },
);

test("WinGet enumeration errors are logged without hiding the final discovery failure", async (t) => {
    t.mock.method(fs, "readdirSync", () => {
        throw Object.assign(new Error("access denied"), { code: "EACCES" });
    });
    const lines = [];
    await assert.rejects(
        () =>
            resolveCopilotCli({
                env: { LOCALAPPDATA: String.raw`C:\Local` },
                platform: "win32",
                pathCopilot: [],
                logger: { write: (line) => lines.push(line) },
                probe: () => ({ status: 1 }),
            }),
        /No working GitHub Copilot CLI/,
    );
    assert.match(
        lines.join("\n"),
        /Cannot discover WinGet Copilot packages.*access denied/,
    );
});

test(
    "missing absolute Windows launchers fail before spawning a shell",
    {
        skip: process.platform !== "win32",
    },
    async (t) => {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "typeagent-missing-cli-"),
        );
        t.after(() => fs.rmSync(root, { recursive: true, force: true }));
        const spawnMock = t.mock.method(childProcess, "spawn", () => {
            throw new Error("Missing launchers must not be spawned");
        });
        syncBuiltinESMExports();
        t.after(() => {
            spawnMock.mock.restore();
            syncBuiltinESMExports();
        });
        const lines = [];
        await assert.rejects(
            () =>
                resolveCopilotCli({
                    env: { APPDATA: root },
                    pathCopilot: [],
                    logger: { write: (line) => lines.push(line) },
                }),
            /No working GitHub Copilot CLI/,
        );
        assert.equal(spawnMock.mock.callCount(), 0);
        assert.match(lines.join("\n"), /ENOENT/);
    },
);

test("failed and timed out candidates are skipped for a working candidate", async () => {
    const failed = String.raw`C:\failed\copilot.exe`;
    const timedOut = String.raw`C:\timed-out\copilot.cmd`;
    const working = String.raw`C:\working\copilot.cmd`;
    const result = await resolve({
        env: { COPILOT_CLI_PATH: failed },
        copilotPath: timedOut,
        pathCopilot: working,
        outcomes: new Map([
            [failed, { status: 1 }],
            [timedOut, { error: { code: "ETIMEDOUT" } }],
            [working, { status: 0 }],
        ]),
    });

    assert.equal(result.selected, working);
    assert.deepEqual(result.probed, [failed, timedOut, working]);
    assert.match(result.lines.join("\n"), /validation failed/);
    assert.match(
        result.lines.join("\n"),
        new RegExp(`timed out after ${copilotVersionTimeoutMs} ms`),
    );
});

test("no usable candidate produces an explicit error", async () => {
    const candidate = String.raw`C:\broken\copilot.exe`;
    await assert.rejects(
        () =>
            resolve({
                pathCopilot: candidate,
                outcomes: new Map([[candidate, { status: 1 }]]),
            }),
        /No working GitHub Copilot CLI was found/,
    );
});

test("synchronous probe failures are logged before trying fallbacks", async () => {
    const broken = String.raw`C:\WinGet\Links\copilot.exe`;
    const timedOut = String.raw`C:\hung\copilot.cmd`;
    const working = String.raw`C:\npm\copilot.cmd`;
    const result = await resolve({
        env: { COPILOT_CLI_PATH: broken },
        copilotPath: timedOut,
        pathCopilot: working,
        outcomes: new Map([
            [broken, new Error("spawn UNKNOWN")],
            [
                timedOut,
                Object.assign(new Error("spawn ETIMEDOUT"), {
                    code: "ETIMEDOUT",
                }),
            ],
        ]),
    });

    assert.equal(result.selected, working);
    assert.deepEqual(result.probed, [broken, timedOut, working]);
    assert.ok(
        result.lines.includes(
            `Copilot CLI validation failed for ${broken}: spawn UNKNOWN`,
        ),
    );
    assert.ok(
        result.lines.includes(
            `Copilot CLI validation timed out after ${copilotVersionTimeoutMs} ms: ${timedOut}`,
        ),
    );
});

test("a thrown probe failure does not replace the no-working-CLI error", async () => {
    const candidate = String.raw`C:\broken\copilot.exe`;
    await assert.rejects(
        () =>
            resolve({
                pathCopilot: candidate,
                outcomes: new Map([[candidate, new Error("spawn UNKNOWN")]]),
            }),
        /No working GitHub Copilot CLI was found/,
    );
});

test("candidate order puts PATH ahead of hardcoded Windows fallbacks", () => {
    const env = {
        APPDATA: String.raw`C:\Users\test\AppData\Roaming`,
        LOCALAPPDATA: String.raw`C:\Users\test\AppData\Local`,
    };
    const pathCandidate = String.raw`C:\active\copilot.cmd`;
    const candidates = copilotCandidates({
        env,
        platform: "win32",
        pathCopilot: pathCandidate,
    });

    assert.equal(candidates[0].path, pathCandidate);
    assert.equal(candidates[0].source, "current PATH");
    assert.equal(candidates.at(-1).source, "WinGet fallback");
});

test("non-Windows candidates preserve every PATH match without fallbacks", () => {
    const candidates = copilotCandidates({
        copilotPath: "/supplied/copilot",
        env: {
            COPILOT_CLI_PATH: "/override/copilot",
            APPDATA: "/not-used/npm",
            LOCALAPPDATA: "/not-used/winget",
        },
        platform: "linux",
        pathCopilot: ["/path/first/copilot", "/path/second/copilot"],
    });

    assert.deepEqual(
        candidates.map(({ source, path: candidate }) => [source, candidate]),
        [
            ["COPILOT_CLI_PATH", "/override/copilot"],
            ["supplied PATH candidate", "/supplied/copilot"],
            ["current PATH", "/path/first/copilot"],
            ["current PATH", "/path/second/copilot"],
        ],
    );
});

test("MSI wrapper refreshes PATH before discovering Copilot", () => {
    const wrapper = fs.readFileSync(
        new URL("../../installers/wix/register-plugin.ps1", import.meta.url),
        "utf8",
    );
    const refreshIndex = wrapper.indexOf("$nodeExe = Resolve-NodeExe");
    const discoveryIndex = wrapper.indexOf(
        "$pathCommand = Get-Command copilot",
    );

    assert.notEqual(refreshIndex, -1);
    assert.notEqual(discoveryIndex, -1);
    assert.ok(refreshIndex < discoveryIndex);
});
