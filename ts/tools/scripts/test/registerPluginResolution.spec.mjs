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

function resolve({
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
    const selected = resolveCopilotCli({
        copilotPath,
        env,
        platform: "win32",
        pathCopilot,
        logger,
        probe,
    });
    return { selected, probed, lines };
}

test("working PATH npm shim wins over a stale WinGet fallback", () => {
    const pathShim = String.raw`C:\.tools\.npm-global\copilot.cmd`;
    const localAppData = String.raw`C:\Users\test\AppData\Local`;
    const staleWinGet = path.win32.join(
        localAppData,
        "Microsoft",
        "WinGet",
        "Links",
        "copilot.exe",
    );
    const result = resolve({
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

test("later PATH candidate is tried when the first candidate fails", () => {
    const stale = String.raw`C:\stale\copilot.exe`;
    const working = String.raw`C:\.tools\.npm-global\copilot.cmd`;
    const result = resolve({
        pathCopilot: [stale, working],
        outcomes: new Map([
            [stale, { status: 1 }],
            [working, { status: 0 }],
        ]),
    });

    assert.equal(result.selected, working);
    assert.deepEqual(result.probed, [stale, working]);
});

test("PATH discovery probes a later working executable", (t) => {
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
    const selected = resolveCopilotCli({
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

test("extensionless COPILOT_CLI_PATH remains the highest-priority override", () => {
    const override = String.raw`C:\custom\copilot`;
    const pathCandidate = String.raw`C:\path\copilot.cmd`;
    const result = resolve({
        env: { COPILOT_CLI_PATH: override },
        pathCopilot: pathCandidate,
    });

    assert.equal(result.selected, override);
    assert.deepEqual(result.probed, [override]);
});

test("linked Windows executables are canonicalized before spawning", (t) => {
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
    const spawnSync = childProcess.spawnSync;
    const spawnMock = t.mock.method(childProcess, "spawnSync", (...args) => {
        spawned.push(args[0]);
        return spawnSync(...args);
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
        const selected = resolveCopilotCli({
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

test("VS Code Copilot shim is rejected before a working fallback", () => {
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
    const result = resolve({
        env: { APPDATA: appData },
        copilotPath: shim,
        pathCopilot: fallback,
    });

    assert.equal(result.selected, fallback);
    assert.deepEqual(result.probed, [fallback]);
    assert.match(result.lines.join("\n"), /Rejected VS Code Copilot shim/);
});

test("failed and timed out candidates are skipped for a working candidate", () => {
    const failed = String.raw`C:\failed\copilot.exe`;
    const timedOut = String.raw`C:\timed-out\copilot.cmd`;
    const working = String.raw`C:\working\copilot.cmd`;
    const result = resolve({
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

test("no usable candidate produces an explicit error", () => {
    const candidate = String.raw`C:\broken\copilot.exe`;
    assert.throws(
        () =>
            resolve({
                pathCopilot: candidate,
                outcomes: new Map([[candidate, { status: 1 }]]),
            }),
        /No working GitHub Copilot CLI was found/,
    );
});

test("synchronous probe failures are logged before trying fallbacks", () => {
    const broken = String.raw`C:\WinGet\Links\copilot.exe`;
    const timedOut = String.raw`C:\hung\copilot.cmd`;
    const working = String.raw`C:\npm\copilot.cmd`;
    const result = resolve({
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

test("a thrown probe failure does not replace the no-working-CLI error", () => {
    const candidate = String.raw`C:\broken\copilot.exe`;
    assert.throws(
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
