// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { createHash, randomUUID } from "node:crypto";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
    nativeInputIdentity,
    authenticateNormalHookReceipt,
    correlateNormalHook,
    createTrustedNormalHookReader,
    isTrustedNormalHookCallback,
} from "../macro-eval-native-callback.mjs";
import { stageNativeNormalHook } from "../macro-eval-native-bridge.mjs";

const scripts = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
);
const hash = (file) =>
    createHash("sha256").update(fs.readFileSync(file)).digest("hex");
function fixture() {
    const root = fs.mkdtempSync(path.join(scripts, "test", ".normal-hook-"));
    const wrapper = path.join(root, "plugin", "macro-eval-native-hook.mjs");
    const router = path.join(root, "plugin", "dist", "hooks", "hook-router.js");
    fs.mkdirSync(path.dirname(router), { recursive: true });
    fs.writeFileSync(wrapper, "staged wrapper");
    fs.writeFileSync(router, "staged router");
    const cli = {
        ProcessId: 100,
        ParentProcessId: 50,
        StartedMs: 1000,
        ExecutablePath: process.execPath,
        sha256: hash(process.execPath),
    };
    const peer = {
        ProcessId: 200,
        ParentProcessId: 100,
        StartedMs: 1200,
        ExecutablePath: process.execPath,
        Arguments: [process.execPath, wrapper],
    };
    const server = {
        ProcessId: 300,
        ParentProcessId: 10,
        StartedMs: 900,
        ExecutablePath: process.execPath,
    };
    const input = {
        sessionId: "actual-session",
        cwd: root,
        prompt: "Read synthetic Alpha",
        timestamp: 1300,
    };
    const target = {
        ...input,
        submittedAtMs: 1250,
        deadlineMs: 2000,
        mode: "bypass",
        configDigest: "a".repeat(64),
    };
    const binding = {
        owner: "owned-nonce",
        ownedRoot: root,
        pipe: `typeagent-native-${randomUUID()}`,
        cli,
        server,
        node: { executable: process.execPath, sha256: hash(process.execPath) },
        wrapper: { file: wrapper, sha256: hash(wrapper) },
        router: { file: router, sha256: hash(router) },
        serverSource: {
            file: path.join(scripts, "macro-eval-native-pipe.ps1"),
            sha256: hash(path.join(scripts, "macro-eval-native-pipe.ps1")),
        },
        mode: target.mode,
        configDigest: target.configDigest,
    };
    const receipt = {
        protocol: "native-hook-os-association-v1",
        osApi: "GetNamedPipeClientProcessId/SafePipeHandle",
        serverPid: 300,
        pipe: binding.pipe,
        observedAtMs: 1500,
        peer,
        peerAfter: structuredClone(peer),
        ancestry: [peer, cli],
        children: [
            {
                ProcessId: 201,
                ParentProcessId: 200,
                StartedMs: 1250,
                ExecutablePath: process.execPath,
                Arguments: [process.execPath, router],
            },
        ],
        packet: {
            protocol: "native-hook-stdin-v1",
            stdin: JSON.stringify(input),
        },
    };
    const events = [
        {
            id: "start",
            parentId: null,
            type: "hook.start",
            data: {
                hookType: "userPromptSubmitted",
                hookInvocationId: "invocation",
                input,
            },
        },
        {
            id: "end",
            parentId: "start",
            type: "hook.end",
            data: {
                hookType: "userPromptSubmitted",
                hookInvocationId: "invocation",
                success: true,
                output: { handled: false },
            },
        },
        {
            id: "user",
            parentId: "end",
            type: "user.message",
            data: { content: input.prompt },
        },
        {
            id: "answer",
            parentId: "user",
            type: "assistant.message",
            data: {
                content: "Full synthetic content",
                turnId: 0,
                toolRequests: [],
            },
        },
        {
            id: "terminal",
            parentId: "answer",
            type: "assistant.turn_end",
            data: { turnId: 0 },
        },
    ];
    return { root, binding, receipt, target, events };
}

test("OS-associated ordinary callback correlates real native field names and numeric turn0", () => {
    const f = fixture();
    try {
        const callback = authenticateNormalHookReceipt(
            f.receipt,
            f.binding,
            f.target,
        );
        const seen = new Set();
        const result = correlateNormalHook(callback, f.events, seen);
        assert.equal(result.native.turnId, 0);
        assert.equal(result.handled, false);
        assert.equal(
            result.input.inputHash,
            nativeInputIdentity(JSON.parse(f.receipt.packet.stdin)).inputHash,
        );
        assert.throws(
            () => correlateNormalHook(callback, f.events, seen),
            /Duplicate/,
        );
    } finally {
        fs.rmSync(f.root, { recursive: true, force: true });
    }
});

for (const [name, change, pattern] of [
    [
        "self-reported PID",
        (f) => {
            f.receipt.packet.pid = 200;
        },
        /identity claim/,
    ],
    [
        "reused PID",
        (f) => {
            f.receipt.peerAfter.StartedMs++;
        },
        /reused/,
    ],
    [
        "wrong executable",
        (f) => {
            f.receipt.peer.ExecutablePath = "C:\\wrong.exe";
        },
        /reused|executable/,
    ],
    [
        "wrong argv",
        (f) => {
            f.receipt.peer.Arguments.push("--manual");
        },
        /argv/,
    ],
    [
        "unowned CLI ancestry",
        (f) => {
            f.receipt.ancestry[1] = {
                ...f.receipt.ancestry[1],
                StartedMs: 9999,
            };
        },
        /owned CLI/,
    ],
    [
        "wrong reader",
        (f) => {
            f.receipt.serverPid++;
        },
        /reader/,
    ],
    [
        "cross-session",
        (f) => {
            f.target.sessionId = "other";
        },
        /Cross-session/,
    ],
    [
        "cross-root",
        (f) => {
            f.target.cwd = "C:\\unrelated";
        },
        /Cross-session/,
    ],
    [
        "wrong prompt",
        (f) => {
            f.target.prompt = "Read another";
        },
        /prompt/,
    ],
    [
        "stale input",
        (f) => {
            f.target.submittedAtMs = 1400;
        },
        /Stale/,
    ],
    [
        "mode drift",
        (f) => {
            f.target.mode = "direct";
        },
        /mode/,
    ],
    [
        "digest drift",
        (f) => {
            f.target.configDigest = "b".repeat(64);
        },
        /digest/,
    ],
    [
        "wrapper drift",
        (f) => {
            fs.appendFileSync(f.binding.wrapper.file, "changed");
        },
        /source drift/,
    ],
    [
        "router drift",
        (f) => {
            fs.appendFileSync(f.binding.router.file, "changed");
        },
        /source drift/,
    ],
    [
        "wrong staged root",
        (f) => {
            f.binding.wrapper.file = f.binding.router.file;
        },
        /physical staged/,
    ],
])
    test(`normal callback rejects ${name}`, () => {
        const f = fixture();
        try {
            change(f);
            assert.throws(
                () =>
                    authenticateNormalHookReceipt(
                        f.receipt,
                        f.binding,
                        f.target,
                    ),
                pattern,
            );
        } finally {
            fs.rmSync(f.root, { recursive: true, force: true });
        }
    });

for (const prompt of [
    "/typeagent-record",
    "@typeagent status",
    "@typeagent mode direct",
    "",
])
    test(`control/getter input excluded: ${prompt || "startup"}`, () => {
        assert.throws(
            () =>
                nativeInputIdentity({
                    sessionId: "s",
                    cwd: "C:\\owned",
                    timestamp: 1,
                    prompt,
                }),
            /ordinary/,
        );
    });

for (const [name, change] of [
    [
        "duplicate hook",
        (events) => events.push({ ...events[0], id: "duplicate" }),
    ],
    [
        "failed hook",
        (events) => {
            events[1].data.success = false;
        },
    ],
    [
        "wrong invocation",
        (events) => {
            events[1].data.hookInvocationId = "other";
        },
    ],
    [
        "child hook",
        (events) => {
            events[0].agentId = "child";
        },
    ],
    [
        "child answer",
        (events) => {
            events[3].data.parentToolCallId = "child";
        },
    ],
    [
        "cross causal root",
        (events) => {
            events[2].parentId = "other";
        },
    ],
    ["missing terminal", (events) => events.pop()],
    [
        "literal without turnId",
        (events) => {
            delete events[3].data.turnId;
        },
    ],
    [
        "ambiguous terminal",
        (events) => events.push({ ...events[4], id: "other" }),
    ],
])
    test(`native callback correlation blocks ${name}`, () => {
        const f = fixture();
        try {
            const callback = authenticateNormalHookReceipt(
                f.receipt,
                f.binding,
                f.target,
            );
            change(f.events);
            assert.throws(() => correlateNormalHook(callback, f.events));
        } finally {
            fs.rmSync(f.root, { recursive: true, force: true });
        }
    });

test("trusted reader checks current server lifetime and rejects duplicate receipts", () => {
    const f = fixture();
    try {
        const directory = path.join(f.root, "normal-hook");
        fs.mkdirSync(directory);
        fs.writeFileSync(
            path.join(directory, "receipt-0000.json"),
            JSON.stringify(f.receipt),
        );
        const reader = createTrustedNormalHookReader({
            directory,
            binding: f.binding,
            probe: (pid) =>
                pid === f.binding.cli.ProcessId
                    ? f.binding.cli
                    : f.binding.server,
        });
        const callback = reader.read(f.target, f.events);
        assert.equal(callback.native.hookInvocationId, "invocation");
        assert.equal(isTrustedNormalHookCallback(callback), true);
        assert.equal(
            isTrustedNormalHookCallback(JSON.parse(JSON.stringify(callback))),
            false,
        );
        assert.equal(
            isTrustedNormalHookCallback(structuredClone(callback)),
            false,
        );
        assert.throws(() => {
            callback.input.prompt = "tampered";
        }, TypeError);
        assert.throws(() => reader.read(f.target, f.events), /Reused/);
        const stale = createTrustedNormalHookReader({
            directory,
            binding: f.binding,
            probe: () => ({ ...f.binding.server, StartedMs: 9999 }),
        });
        assert.throws(() => stale.read(f.target, f.events), /lifetime/);
        fs.writeFileSync(
            path.join(directory, "receipt-0001.json"),
            JSON.stringify(f.receipt),
        );
        assert.throws(
            () =>
                createTrustedNormalHookReader({
                    directory,
                    binding: f.binding,
                    probe: (pid) =>
                        pid === f.binding.cli.ProcessId
                            ? f.binding.cli
                            : f.binding.server,
                }).read(f.target, f.events),
            /ambiguous/,
        );
    } finally {
        fs.rmSync(f.root, { recursive: true, force: true });
    }
});

test("compiled router requires a unique actual OS child of the pipe-authenticated wrapper", () => {
    const f = fixture();
    try {
        f.receipt.children.push({ ...f.receipt.children[0], ProcessId: 202 });
        assert.throws(
            () => authenticateNormalHookReceipt(f.receipt, f.binding, f.target),
            /ambiguous actual compiled-router/,
        );
        f.receipt.children = [];
        assert.throws(
            () => authenticateNormalHookReceipt(f.receipt, f.binding, f.target),
            /compiled-router OS child/,
        );
    } finally {
        fs.rmSync(f.root, { recursive: true, force: true });
    }
});

test(
    "actual staged wrapper holds real compiled-router OS child until stdin association",
    { skip: process.platform !== "win32" },
    async () => {
        const root = fs.mkdtempSync(
            path.join(scripts, "test", ".normal-hook-wrapper-"),
        );
        const plugin = path.join(root, "plugin");
        const directory = path.join(root, "normal-hook");
        const pluginData = path.join(root, "plugin-data");
        const data = path.join(root, "data");
        const workspace = path.join(root, "workspace");
        const nativeData = path.join(
            root,
            "home-0",
            "plugin-data",
            "_direct",
            "actual-native-owned-location",
        );
        for (const file of [pluginData, data, workspace, nativeData])
            fs.mkdirSync(file, { recursive: true });
        fs.writeFileSync(
            path.join(root, "evaluation-owner.json"),
            JSON.stringify({ owner: "offline-test" }),
        );
        fs.mkdirSync(path.join(plugin, "dist", "hooks"), { recursive: true });
        fs.mkdirSync(directory);
        fs.writeFileSync(
            path.join(plugin, "hooks.json"),
            JSON.stringify({
                hooks: {
                    userPromptSubmitted: [
                        {
                            type: "command",
                            command:
                                "node ${PLUGIN_ROOT}/dist/hooks/hook-router.js",
                        },
                    ],
                },
            }),
        );
        fs.writeFileSync(
            path.join(plugin, "dist", "hooks", "hook-router.js"),
            "let input='';for await(const c of process.stdin)input+=c;JSON.parse(input);process.stdout.write(JSON.stringify({handled:false,config:process.env.CLAUDE_PLUGIN_DATA,cwd:process.cwd(),permissionMarker:process.env.NATIVE_OFFLINE_PERMISSION_MARKER}));",
        );
        const staged = stageNativeNormalHook(
            {
                run: root,
                plugin,
                pluginData,
                data,
                workspace,
                owner: "offline-test",
            },
            Date.now() + 30000,
        );
        assert.ok(staged.command.includes(process.execPath));
        const policy = JSON.parse(fs.readFileSync(staged.policy.file, "utf8"));
        assert.equal(policy.pipe, staged.pipe);
        assert.equal(policy.protocol, "native-normal-hook-owned-launch-v1");
        const server = spawn(
            "powershell.exe",
            [
                "-NoProfile",
                "-File",
                staged.serverSource.file,
                "-Directory",
                directory,
                "-PipeName",
                staged.pipe,
                "-DeadlineMs",
                String(Date.now() + 30000),
            ],
            { stdio: ["ignore", "pipe", "pipe"] },
        );
        let stderr = "";
        server.stderr.on("data", (value) => {
            stderr += value;
        });

        let wrapper;
        try {
            const until = Date.now() + 15000;
            while (
                !fs.existsSync(path.join(directory, "ready.json")) &&
                Date.now() < until &&
                server.exitCode === null
            )
                await delay(50);
            assert.ok(
                fs.existsSync(path.join(directory, "ready.json")),
                stderr,
            );
            const command = staged.command.replace("${PLUGIN_ROOT}", plugin);
            wrapper = spawn(
                "powershell.exe",
                ["-NoProfile", "-Command", command],
                {
                    stdio: ["pipe", "pipe", "pipe"],
                    cwd: plugin,
                    env: {
                        ...process.env,
                        CLAUDE_PLUGIN_DATA: nativeData,
                        TYPEAGENT_USER_DATA_DIR: data,
                        NATIVE_OFFLINE_PERMISSION_MARKER: "unchanged",
                    },
                },
            );
            const input = {
                sessionId: "actual-wrapper-offline",
                prompt: "Read synthetic Ω",
                cwd: workspace,
                timestamp: Date.now(),
            };
            wrapper.stdin.end(JSON.stringify(input));
            let output = "",
                error = "";
            wrapper.stdout.on("data", (value) => {
                output += value;
            });
            wrapper.stderr.on("data", (value) => {
                error += value;
            });
            const exit = await new Promise((resolve) =>
                wrapper.once("exit", resolve),
            );
            assert.equal(exit, 0, error);
            assert.deepEqual(JSON.parse(output), {
                handled: false,
                config: pluginData,
                cwd: plugin,
                permissionMarker: "unchanged",
            });
            const receipt = JSON.parse(
                fs
                    .readFileSync(
                        path.join(directory, "receipt-0000.json"),
                        "utf8",
                    )
                    .replace(/^\uFEFF/u, ""),
            );
            assert.equal(receipt.peer.ParentProcessId, wrapper.pid);
            assert.equal(
                path.normalize(receipt.peer.Arguments[1]),
                staged.wrapper.file,
            );
            const routers = receipt.children.filter(
                (actor) => actor.Arguments[1] === staged.router.file,
            );
            assert.equal(routers.length, 1);
            assert.equal(routers[0].ParentProcessId, receipt.peer.ProcessId);
            const invalid = spawnSync(
                "powershell.exe",
                ["-NoProfile", "-Command", command],
                {
                    cwd: plugin,
                    env: {
                        ...process.env,
                        CLAUDE_PLUGIN_DATA: nativeData,
                        TYPEAGENT_USER_DATA_DIR: workspace,
                    },
                    input: JSON.stringify(input),
                    encoding: "utf8",
                    timeout: 15000,
                },
            );
            assert.notEqual(invalid.status, 0);
            assert.match(invalid.stderr, /physical owned input\/config roots/u);
            assert.equal(
                fs
                    .readdirSync(directory)
                    .filter((file) => /^receipt-.*json$/u.test(file)).length,
                1,
            );
            assert.deepEqual(JSON.parse(receipt.packet.stdin), input);
        } finally {
            for (const process of [wrapper, server])
                if (process?.exitCode === null && process.signalCode === null)
                    execFileSync(
                        "powershell.exe",
                        [
                            "-NoProfile",
                            "-Command",
                            `Stop-Process -Id ${process.pid} -Force`,
                        ],
                        { stdio: "ignore" },
                    );
            fs.rmSync(root, { recursive: true, force: true });
        }
    },
);

test(
    "actual Windows safe pipe handle reports connecting Node PID, not packet identity",
    { skip: process.platform !== "win32" },
    async () => {
        const root = fs.mkdtempSync(
            path.join(scripts, "test", ".normal-hook-os-"),
        );
        const pipe = `typeagent-native-${randomUUID()}`;
        const child = spawn(
            "powershell.exe",
            [
                "-NoProfile",
                "-File",
                path.join(scripts, "macro-eval-native-pipe.ps1"),
                "-Directory",
                root,
                "-PipeName",
                pipe,
                "-DeadlineMs",
                String(Date.now() + 30000),
            ],
            { stdio: ["ignore", "pipe", "pipe"] },
        );
        let stderr = "";
        child.stderr.on("data", (value) => {
            stderr += value;
        });
        try {
            const until = Date.now() + 15000;
            while (
                !fs.existsSync(path.join(root, "ready.json")) &&
                Date.now() < until &&
                child.exitCode === null
            )
                await delay(50);
            assert.ok(fs.existsSync(path.join(root, "ready.json")), stderr);
            await new Promise((resolve, reject) => {
                const client = net.createConnection(`\\\\.\\pipe\\${pipe}`);
                client.on("error", reject);
                client.on("connect", () =>
                    client.write(
                        JSON.stringify({
                            protocol: "native-hook-stdin-v1",
                            stdin: "synthetic",
                            pid: 999999,
                        }) + "\n",
                    ),
                );
                client.on("data", (reply) => {
                    assert.equal(reply.toString(), "associated\n");
                    client.end();
                    resolve();
                });
            });
            const receipt = JSON.parse(
                fs
                    .readFileSync(path.join(root, "receipt-0000.json"), "utf8")
                    .replace(/^\uFEFF/u, ""),
            );
            assert.equal(receipt.peer.ProcessId, process.pid);
            assert.equal(receipt.peerAfter.ProcessId, process.pid);
            assert.equal(receipt.packet.pid, 999999);
            assert.equal(receipt.serverPid, child.pid);
            assert.equal(
                receipt.osApi,
                "GetNamedPipeClientProcessId/SafePipeHandle",
            );
        } finally {
            if (child.exitCode === null)
                execFileSync(
                    "powershell.exe",
                    [
                        "-NoProfile",
                        "-Command",
                        `Stop-Process -Id ${child.pid} -Force`,
                    ],
                    { stdio: "ignore" },
                );
            fs.rmSync(root, { recursive: true, force: true });
        }
    },
);
