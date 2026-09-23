// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
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
        return outcomes.get(candidate) ?? { status: 0 };
    };
    const selected = resolveCopilotCli({
        copilotPath,
        env,
        platform: "win32",
        pathCopilot,
        exists: () => true,
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

test("COPILOT_CLI_PATH remains the highest-priority override", () => {
    const override = String.raw`C:\custom\copilot.cmd`;
    const pathCandidate = String.raw`C:\path\copilot.cmd`;
    const result = resolve({
        env: { COPILOT_CLI_PATH: override },
        pathCopilot: pathCandidate,
    });

    assert.equal(result.selected, override);
    assert.deepEqual(result.probed, [override]);
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
