// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
    cmdStart,
    inspectLocalConfig,
    normalizeEntryPath,
    openDaemonLog,
    rotateDaemonLog,
    spawnDaemon,
} from "../typeagent-serve.mjs";

const privateFatalDetail = "SIMULATED_PRIVATE_FATAL_DETAIL";

function makeFixture(serverSource) {
    const root = fs.mkdtempSync(
        path.join(os.tmpdir(), "typeagent-serve-test-"),
    );
    const serverPath = path.join(root, "fake server.mjs");
    const configPath = path.join(root, "config.local.yaml");
    const logPath = path.join(root, "agent-server.log");
    fs.writeFileSync(serverPath, serverSource);
    return { root, serverPath, configPath, logPath };
}

async function captureConsole(run) {
    const stdout = [];
    const stderr = [];
    const originalLog = console.log;
    const originalError = console.error;
    console.log = (...values) => stdout.push(values.join(" "));
    console.error = (...values) => stderr.push(values.join(" "));
    try {
        const result = await run();
        return {
            result,
            stdout: stdout.join("\n"),
            stderr: stderr.join("\n"),
        };
    } finally {
        console.log = originalLog;
        console.error = originalError;
    }
}

async function reservePort() {
    const server = net.createServer();
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    assert.notEqual(address, null);
    assert.equal(typeof address, "object");
    const port = address.port;
    await new Promise((resolve) => server.close(resolve));
    return port;
}

async function stopChild(child) {
    if (
        child === undefined ||
        child.exitCode !== null ||
        child.signalCode !== null
    ) {
        return;
    }
    child.ref();
    const exited = once(child, "exit");
    child.kill();
    await exited;
}

function trackedSpawner(target) {
    return (...args) => {
        const child = spawn(...args);
        target.child = child;
        return child;
    };
}

test("reports an early daemon exit without recommending provisioning", async () => {
    const fixture = makeFixture(
        `console.error(${JSON.stringify(privateFatalDetail)});\nprocess.exit(17);\n`,
    );
    const spawned = {};
    try {
        const port = await reservePort();
        const startedAt = Date.now();
        const output = await captureConsole(async () =>
            cmdStart({
                port,
                timeoutMs: 5000,
                intervalMs: 20,
                serverPath: fixture.serverPath,
                configPath: fixture.configPath,
                logPath: fixture.logPath,
                spawnImpl: trackedSpawner(spawned),
                inspectConfig: async () => ({
                    status: "valid",
                    path: fixture.configPath,
                }),
            }),
        );

        assert.equal(output.result, 1);
        assert.ok(Date.now() - startedAt < 3000);
        assert.match(output.stderr, /exit code 17/);
        assert.match(output.stderr, /structurally valid local configuration/);
        assert.match(output.stderr, /Daemon log:/);
        assert.doesNotMatch(output.stderr, /provision --provider/);
        assert.doesNotMatch(output.stderr, new RegExp(privateFatalDetail));
        assert.match(fs.readFileSync(fixture.logPath, "utf8"), /port=/);
        assert.match(
            fs.readFileSync(fixture.logPath, "utf8"),
            new RegExp(privateFatalDetail),
        );
    } finally {
        await stopChild(spawned.child);
        fs.rmSync(fixture.root, { recursive: true, force: true });
    }
});

test("inspects the requested config through the deployed config API", async () => {
    const fixture = makeFixture("process.exit(0);\n");
    try {
        fs.writeFileSync(fixture.configPath, "{}\n");
        assert.deepEqual(await inspectLocalConfig(fixture.configPath), {
            status: "valid",
            path: path.resolve(fixture.configPath),
        });
    } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
    }
});

test("recommends provisioning only when local config is missing", async () => {
    const fixture = makeFixture("process.exit(17);\n");
    try {
        const output = await captureConsole(async () =>
            cmdStart({
                port: await reservePort(),
                timeoutMs: 5000,
                intervalMs: 20,
                serverPath: fixture.serverPath,
                configPath: fixture.configPath,
                logPath: fixture.logPath,
                inspectConfig: async () => ({
                    status: "missing",
                    path: fixture.configPath,
                }),
            }),
        );

        assert.equal(output.result, 1);
        assert.match(output.stderr, /No local configuration file was found/);
        assert.match(output.stderr, /provision --provider copilot/);
    } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
    }
});

test("reports invalid config without exposing parser details", async () => {
    const fixture = makeFixture("process.exit(17);\n");
    const parserDetail = "private YAML parser detail";
    try {
        const output = await captureConsole(async () =>
            cmdStart({
                port: await reservePort(),
                timeoutMs: 5000,
                intervalMs: 20,
                serverPath: fixture.serverPath,
                configPath: fixture.configPath,
                logPath: fixture.logPath,
                inspectConfig: async () => ({
                    status: "invalid",
                    path: fixture.configPath,
                    error: new Error(parserDetail),
                }),
            }),
        );

        assert.match(output.stderr, /could not be parsed or validated/);
        assert.doesNotMatch(output.stderr, new RegExp(parserDetail));
        assert.doesNotMatch(output.stderr, /provision --provider/);
    } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
    }
});

test("keeps the lifecycle failure primary when config inspection fails", async () => {
    const fixture = makeFixture("process.exit(17);\n");
    try {
        const output = await captureConsole(async () =>
            cmdStart({
                port: await reservePort(),
                timeoutMs: 5000,
                intervalMs: 20,
                serverPath: fixture.serverPath,
                configPath: fixture.configPath,
                logPath: fixture.logPath,
                inspectConfig: async () => {
                    throw Object.assign(new Error("private import detail"), {
                        code: "MODULE_NOT_FOUND",
                    });
                },
            }),
        );

        assert.match(output.stderr, /^Agent server exited during startup/);
        assert.match(output.stderr, /system error: MODULE_NOT_FOUND/);
        assert.doesNotMatch(output.stderr, /private import detail/);
    } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
    }
});

test("returns success when the daemon begins listening", async () => {
    const fixture = makeFixture(
        [
            'import net from "node:net";',
            'const port = Number(process.argv[process.argv.indexOf("--port") + 1]);',
            'net.createServer().listen(port, "127.0.0.1");',
        ].join("\n"),
    );
    const spawned = {};
    try {
        const port = await reservePort();
        const output = await captureConsole(async () =>
            cmdStart({
                port,
                timeoutMs: 5000,
                intervalMs: 20,
                serverPath: fixture.serverPath,
                logPath: fixture.logPath,
                spawnImpl: trackedSpawner(spawned),
            }),
        );

        assert.equal(output.result, 0);
        assert.match(output.stdout, /Agent server is up/);
    } finally {
        await stopChild(spawned.child);
        fs.rmSync(fixture.root, { recursive: true, force: true });
    }
});

test("reports a live daemon readiness timeout", async () => {
    const fixture = makeFixture("setInterval(() => {}, 1000);\n");
    const spawned = {};
    try {
        const output = await captureConsole(async () =>
            cmdStart({
                port: await reservePort(),
                timeoutMs: 150,
                intervalMs: 20,
                serverPath: fixture.serverPath,
                configPath: fixture.configPath,
                logPath: fixture.logPath,
                spawnImpl: trackedSpawner(spawned),
                inspectConfig: async () => ({
                    status: "valid",
                    path: fixture.configPath,
                }),
            }),
        );

        assert.equal(output.result, 1);
        assert.match(output.stderr, /did not begin listening/);
        assert.match(
            output.stderr,
            /had not reported an exit and was left running/,
        );
        assert.doesNotMatch(output.stderr, /provision --provider/);
    } finally {
        await stopChild(spawned.child);
        fs.rmSync(fixture.root, { recursive: true, force: true });
    }
});

test("reports synchronous and asynchronous spawn errors safely", async () => {
    const fixture = makeFixture("process.exit(0);\n");
    try {
        const synchronous = await captureConsole(async () =>
            cmdStart({
                port: await reservePort(),
                serverPath: fixture.serverPath,
                configPath: fixture.configPath,
                logPath: fixture.logPath,
                spawnImpl: () => {
                    throw Object.assign(new Error("private spawn detail"), {
                        code: "EACCES",
                    });
                },
                inspectConfig: async () => ({
                    status: "valid",
                    path: fixture.configPath,
                }),
            }),
        );
        assert.match(synchronous.stderr, /system error: EACCES/);
        assert.doesNotMatch(synchronous.stderr, /private spawn detail/);

        const asynchronous = await captureConsole(async () =>
            cmdStart({
                port: await reservePort(),
                serverPath: fixture.serverPath,
                configPath: fixture.configPath,
                logPath: fixture.logPath,
                spawnImpl: () => {
                    const child = new EventEmitter();
                    setImmediate(() =>
                        child.emit(
                            "error",
                            Object.assign(new Error("private async detail"), {
                                code: "ENOENT",
                            }),
                        ),
                    );
                    return child;
                },
                inspectConfig: async () => ({
                    status: "valid",
                    path: fixture.configPath,
                }),
            }),
        );
        assert.match(asynchronous.stderr, /system error: ENOENT/);
        assert.doesNotMatch(asynchronous.stderr, /private async detail/);
    } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
    }
});

test("preserves idempotent success for an existing listener", async () => {
    const fixture = makeFixture("process.exit(99);\n");
    const server = net.createServer();
    let spawnCalled = false;
    let inspectCalled = false;
    try {
        await new Promise((resolve, reject) => {
            server.once("error", reject);
            server.listen(0, "127.0.0.1", resolve);
        });
        const address = server.address();
        assert.notEqual(address, null);
        assert.equal(typeof address, "object");
        const output = await captureConsole(async () =>
            cmdStart({
                port: address.port,
                serverPath: fixture.serverPath,
                logPath: fixture.logPath,
                spawnImpl: () => {
                    spawnCalled = true;
                    throw new Error("not reached");
                },
                inspectConfig: async () => {
                    inspectCalled = true;
                    throw new Error("not reached");
                },
            }),
        );

        assert.equal(output.result, 0);
        assert.match(output.stdout, /A process is already listening/);
        assert.match(output.stdout, /possibly an existing TypeAgent/);
        assert.equal(spawnCalled, false);
        assert.equal(inspectCalled, false);
        assert.equal(fs.existsSync(fixture.logPath), false);
    } finally {
        await new Promise((resolve) => server.close(resolve));
        fs.rmSync(fixture.root, { recursive: true, force: true });
    }
});

test("continues startup diagnosis when the daemon log cannot be opened", async () => {
    const fixture = makeFixture("process.exit(17);\n");
    const blockingFile = path.join(fixture.root, "not-a-directory");
    fs.writeFileSync(blockingFile, "");
    try {
        const output = await captureConsole(async () =>
            cmdStart({
                port: await reservePort(),
                timeoutMs: 5000,
                intervalMs: 20,
                serverPath: fixture.serverPath,
                configPath: fixture.configPath,
                logPath: path.join(blockingFile, "agent-server.log"),
                inspectConfig: async () => ({
                    status: "valid",
                    path: fixture.configPath,
                }),
            }),
        );

        assert.equal(output.result, 1);
        assert.match(output.stderr, /exit code 17/);
        assert.match(output.stderr, /Daemon logging was unavailable/);
        assert.match(output.stderr, /system error:/);
    } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
    }
});

test("logging failure does not prevent a healthy daemon from starting", async () => {
    const fixture = makeFixture(
        [
            'import net from "node:net";',
            'const port = Number(process.argv[process.argv.indexOf("--port") + 1]);',
            'net.createServer().listen(port, "127.0.0.1");',
        ].join("\n"),
    );
    const blockingFile = path.join(fixture.root, "not-a-directory");
    const spawned = {};
    fs.writeFileSync(blockingFile, "");
    try {
        const output = await captureConsole(async () =>
            cmdStart({
                port: await reservePort(),
                timeoutMs: 5000,
                intervalMs: 20,
                serverPath: fixture.serverPath,
                logPath: path.join(blockingFile, "agent-server.log"),
                spawnImpl: trackedSpawner(spawned),
            }),
        );

        assert.equal(output.result, 0);
        assert.match(output.stdout, /Agent server is up/);
        assert.equal(output.stderr, "");
    } finally {
        await stopChild(spawned.child);
        fs.rmSync(fixture.root, { recursive: true, force: true });
    }
});

test("rotates oversized daemon logs and retains only one previous log", () => {
    const fixture = makeFixture("process.exit(0);\n");
    const previousPath = path.join(fixture.root, "agent-server.previous.log");
    try {
        fs.writeFileSync(fixture.logPath, "a".repeat(1024 * 1024 + 1));
        fs.writeFileSync(previousPath, "old");
        const first = openDaemonLog(fixture.logPath, 1234);
        assert.equal(first.opened, true);
        assert.equal(first.rotationErrorCode, undefined);
        assert.notEqual(first.fd, undefined);
        fs.closeSync(first.fd);
        assert.equal(fs.statSync(previousPath).size, 1024 * 1024 + 1);
        assert.match(
            fs.readFileSync(fixture.logPath, "utf8"),
            /typeagent-serve startup .* port=1234/,
        );

        fs.writeFileSync(fixture.logPath, "b".repeat(1024 * 1024 + 1));
        const second = openDaemonLog(fixture.logPath, 5678);
        assert.equal(second.opened, true);
        assert.notEqual(second.fd, undefined);
        fs.closeSync(second.fd);
        assert.equal(fs.readFileSync(previousPath, "utf8")[0], "b");
        assert.deepEqual(
            fs
                .readdirSync(fixture.root)
                .filter((name) => name.includes("agent-server"))
                .sort(),
            ["agent-server.log", "agent-server.previous.log"],
        );
    } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
    }
});

test("records stable rotation and permission-hardening error codes", () => {
    const rotationError = Object.assign(new Error("private rotation detail"), {
        code: "EACCES",
    });
    assert.equal(
        rotateDaemonLog("unused.log", {
            fileSystem: {
                existsSync: () => true,
                statSync: () => ({ size: Number.MAX_SAFE_INTEGER }),
                rmSync: () => {
                    throw rotationError;
                },
            },
        }),
        "EACCES",
    );

    const fixture = makeFixture("process.exit(0);\n");
    const permissionFileSystem = {
        existsSync: fs.existsSync,
        statSync: fs.statSync,
        rmSync: fs.rmSync,
        renameSync: fs.renameSync,
        mkdirSync: fs.mkdirSync,
        openSync: fs.openSync,
        writeSync: fs.writeSync,
        closeSync: fs.closeSync,
        chmodSync: () => {
            throw Object.assign(new Error("private permission detail"), {
                code: "EPERM",
            });
        },
    };
    try {
        const state = openDaemonLog(fixture.logPath, 8999, {
            fileSystem: permissionFileSystem,
            platform: "linux",
        });
        assert.equal(state.opened, true);
        assert.equal(state.permissionErrorCode, "EPERM");
        assert.notEqual(state.fd, undefined);
        fs.closeSync(state.fd);
    } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
    }
});

test("spawns Node directly with hidden detached Windows options", () => {
    const fixture = makeFixture("process.exit(0);\n");
    const child = new EventEmitter();
    let invocation;
    try {
        spawnDaemon(8999, {
            serverPath: fixture.serverPath,
            logPath: fixture.logPath,
            platform: "win32",
            spawnImpl: (command, args, options) => {
                invocation = { command, args, options };
                return child;
            },
        });

        assert.notEqual(invocation, undefined);
        assert.equal(invocation.command, process.execPath);
        assert.deepEqual(invocation.args, [
            fixture.serverPath,
            "--port",
            "8999",
        ]);
        assert.equal(invocation.options.detached, true);
        assert.equal(invocation.options.windowsHide, true);
        assert.equal(invocation.options.stdio[0], "ignore");
        assert.equal(typeof invocation.options.stdio[1], "number");
        assert.equal(invocation.options.stdio[2], invocation.options.stdio[1]);
    } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
    }
});

test("normalizes Windows entry paths without case sensitivity", () => {
    assert.equal(
        normalizeEntryPath(
            "C:\\Program Files\\TypeAgent\\TYPEAGENT-SERVE.MJS",
            "win32",
        ),
        normalizeEntryPath(
            "c:\\program files\\typeagent\\typeagent-serve.mjs",
            "win32",
        ),
    );
});
