// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:net";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import {
    checkPort,
    makeBuildCommand,
    makeConfiguration,
    parseArgs,
    runCommand,
    startProcess,
    startupFailure,
    stopProcess,
    testPrompt,
    waitForServer,
} from "../discovery-e2e.mjs";

test("builds selected packages and dependency tasks incrementally without selecting the whole workspace", () => {
    const root = path.resolve("workspace with spaces", "ts");
    const { command, args } = makeBuildCommand(root);
    assert.equal(command, process.execPath);
    assert.deepEqual(args, [
        path.join(
            root,
            "node_modules",
            "@fluidframework",
            "build-tools",
            "bin",
            "fluid-build",
        ),
        "^(@typeagent/copilot-plugin|agent-server)$",
        "-t",
        "build",
        "--dep",
    ]);
    const selector = new RegExp(args[1]);
    for (const name of ["@typeagent/copilot-plugin", "agent-server"])
        assert.ok(selector.test(name));
    for (const name of ["agent-shell", "agent-server-client", "other-package"])
        assert.ok(!selector.test(name));
    for (const flag of [".", "--all", "--force", "--rebuild", "--clean"])
        assert.ok(!args.includes(flag));
});

test("startup diagnostics explain missing configuration without echoing sensitive logs", () => {
    const folder = mkdtempSync(path.join(tmpdir(), "discovery-error-test-"));
    const log = path.join(folder, "stderr.log");
    try {
        writeFileSync(
            log,
            "secret=must-not-echo\nFatal startup error: Error: Missing ApiSetting: AZURE_OPENAI_ENDPOINT\n",
        );
        const error = startupFailure({ code: 1 }, log);
        assert.match(
            error.message,
            /Missing model configuration: AZURE_OPENAI_ENDPOINT/,
        );
        assert.match(error.message, /--config-dir/);
        assert.ok(error.message.includes(log));
        assert.doesNotMatch(error.message, /must-not-echo/);
        writeFileSync(log, "Another failure containing secret=must-not-echo\n");
        const other = startupFailure({ code: 2 }, log);
        assert.match(other.message, /before readiness: 2/);
        assert.doesNotMatch(
            other.message,
            /Missing model configuration|must-not-echo/,
        );
    } finally {
        rmSync(log, { force: true });
        rmSync(folder, { recursive: true });
    }
});

test("validates options without silently ignoring misspellings or unsafe ports", () => {
    assert.deepEqual(parseArgs([]), { port: 9024, startupTimeout: 120 });
    assert.deepEqual(
        parseArgs(["--port", "9321", "--skip-build", "--smoke-test"]),
        {
            port: 9321,
            startupTimeout: 120,
            skipBuild: true,
            smokeTest: true,
        },
    );
    for (const args of [
        ["--port", "0"],
        ["--port", "65536"],
        ["--port", "-2"],
        ["--port", "9024.5"],
        ["--port"],
        ["--model", "--help"],
        ["--startup-timeout", "0"],
        ["--unknown"],
    ])
        assert.throws(() => parseArgs(args));
});

test("isolates data, saved conversations and hook mode without copying credentials into MCP JSON", () => {
    const inherited = {
        TYPEAGENT_CONVERSATION_ID: "existing-owner",
        TYPEAGENT_PLUGIN_DATA: "existing-plugin-data",
        TYPEAGENT_HOST: "remote-server",
        TYPEAGENT_CONFIG_DIR: "existing-config",
        API_SECRET: "never-write-to-json",
    };
    const before = { ...inherited };
    const runDir = path.resolve("folder with spaces", "test-run");
    const { env, mcp } = makeConfiguration(
        runDir,
        9025,
        inherited,
        "explicit-config",
    );
    assert.deepEqual(inherited, before);
    assert.equal(env.TYPEAGENT_CONVERSATION_ID, undefined);
    assert.equal(env.TYPEAGENT_CONFIG_DIR, "explicit-config");
    assert.equal(env.TYPEAGENT_MODE, "bypass");
    assert.equal(env.TYPEAGENT_HOST, "127.0.0.1");
    assert.equal(env.TYPEAGENT_PLUGIN_DATA, path.join(runDir, "plugin-data"));
    assert.equal(env.TYPEAGENT_USER_DATA_DIR, path.join(runDir, "data"));
    const server = JSON.parse(JSON.stringify(mcp)).mcpServers["typeagent-e2e"];
    assert.equal(server.env.TYPEAGENT_MODE, "mcp");
    assert.equal(server.env.TYPEAGENT_PORT, "9025");
    assert.equal(server.command, process.execPath);
    assert.deepEqual(server.args, [
        path.join(runDir, "plugin", "dist", "mcp", "server.js"),
    ]);
    assert.ok(!JSON.stringify(mcp).includes("never-write-to-json"));
    assert.ok(!JSON.stringify(mcp).includes("existing-owner"));
    assert.match(testPrompt, /wait for my answer/);
    assert.equal(
        makeConfiguration(runDir, 9025, inherited).env.TYPEAGENT_CONFIG_DIR,
        "existing-config",
    );
});

test("refuses an occupied port without affecting its owner", async () => {
    const server = createServer();
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = server.address().port;
    try {
        await assert.rejects(checkPort(port), /unavailable/);
        assert.equal(server.listening, true);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
    await checkPort(port);
});

test("reports spawn failures and stops only the owned live process", async () => {
    const missing = startProcess(
        path.resolve("nonexistent-e2e-executable"),
        [],
        { stdio: "ignore" },
    );
    assert.ok((await missing.completion).error);
    await stopProcess(missing);
    const owned = startProcess(
        process.execPath,
        ["-e", "setInterval(() => {}, 1000)"],
        { stdio: "ignore" },
    );
    await once(owned.child, "spawn");
    await stopProcess(owned);
    assert.ok(owned.child.exitCode !== null || owned.child.signalCode !== null);
    await stopProcess(owned);
});

test("readiness reports early exit, timeout and interruption", async () => {
    const listener = createServer();
    listener.listen(0, "127.0.0.1");
    await once(listener, "listening");
    const port = listener.address().port;
    await new Promise((resolve) => listener.close(resolve));
    const signal = new AbortController().signal;
    await assert.rejects(
        waitForServer(
            { completion: Promise.resolve({ code: 17 }) },
            port,
            1,
            signal,
        ),
        /exited before readiness: 17/,
    );
    const pending = { completion: new Promise(() => {}) };
    await assert.rejects(
        waitForServer(pending, port, 0.01, signal),
        /timed out/,
    );
    await assert.rejects(
        waitForServer(
            pending,
            port,
            1,
            AbortSignal.abort(new Error("interrupted")),
        ),
        /interrupted/,
    );
});

test("interrupting a running command stops it and preserves the abort reason", async () => {
    const controller = new AbortController();
    const command = runCommand(
        process.execPath,
        ["-e", "setInterval(() => {}, 1000)"],
        process.env,
        controller.signal,
    );
    const rejected = assert.rejects(command, /test interruption/);
    await delay(100);
    controller.abort(new Error("test interruption"));
    await rejected;
});

test(
    "Windows cleanup terminates the owned descendant as well",
    { skip: process.platform !== "win32" },
    async () => {
        const owned = startProcess(
            process.execPath,
            [
                "-e",
                `
        const { spawn } = require("node:child_process");
        const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
        child.once("spawn", () => console.log(child.pid));
        setInterval(() => {}, 1000);
    `,
            ],
            { stdio: ["ignore", "pipe", "inherit"] },
        );
        try {
            const [chunk] = await once(owned.child.stdout, "data");
            const descendant = Number(chunk.toString().trim());
            assert.ok(Number.isInteger(descendant) && descendant > 0);
            await stopProcess(owned);
            assert.throws(() => process.kill(descendant, 0), { code: "ESRCH" });
        } finally {
            await stopProcess(owned);
        }
    },
);
