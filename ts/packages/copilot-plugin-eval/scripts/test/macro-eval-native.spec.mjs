// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
    classifyNativeScreen,
    createNativeBudget,
    extractNativeEvidence,
    readNativeJsonl,
    reviewNativeDraft,
    runNativeEvaluation,
    validateNativeConfig,
    validateNativeCliVersion,
    freezeNativeExecutable,
    verifyNativeExecutable,
    nativeFailureStatus,
    validateOwnedServiceListener,
    probeWindowsServiceListeners,
    processTree,
    verifyNativeWorkspace,
    verifyNativeHookRegistrationContext,
    validateNativeStagedEntries,
    validateNativeObservation,
    nativeToolFilters,
    consoleConfiguration,
    nativeControlTimeout,
    nativeCatalogReady,
    nativeControlProof,
    nativeReadyObservation,
} from "../macro-eval-native.mjs";
import { gradeDocumentTrial } from "../macro-eval-grade.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const corpus = {
    protocolVersion: "macro-user-e2e-v1",
    status: "ready-for-rehearsal-unexecuted",
    familyId: "exact-document-lookup-fetch",
    documents: [
        {
            key: "a",
            title: "Alpha",
            expectedId: "synthetic-a",
            content: "ALPHA FULL CONTENT",
        },
        {
            key: "b",
            title: "Beta",
            expectedId: "synthetic-b",
            content: "BETA FULL CONTENT",
        },
    ],
    training: [{ id: "learn", prompt: "Read Alpha", expectedDocument: "a" }],
    heldOutPositive: [
        { id: "reuse", prompt: "Read Beta", expectedDocument: "b" },
    ],
    negativeOrAmbiguous: [],
    contextualConversations: [],
};
const config = {
    cliExecutable: process.execPath,
    cliVersion: "1.0.89",
    configDirectory: path.resolve(directory, "..", "..", "..", ".."),
    port: 19001,
    rootModel: "gpt-5.6-sol",
    runnerModel: "gpt-6-luna",
    maxTargetModelTurns: 20,
    maxDurationMs: 10000,
    trainingCase: "learn",
    reuseCase: "reuse",
    restart: true,
    approveSyntheticReadsOnce: false,
    reviewSyntheticDraft: true,
};

test("readiness returns the exact observed native frame/session, never a boolean admission", () => {
    const observation = {
        sessionId: "native-current-session",
        screen: "Session: ready\nMCP Servers reloaded: 5 servers connected",
    };
    assert.equal(nativeReadyObservation(observation), observation);
    assert.equal(
        nativeReadyObservation(observation).sessionId,
        "native-current-session",
    );
    assert.equal(
        nativeReadyObservation({ ...observation, sessionId: undefined }),
        undefined,
    );
    assert.equal(
        nativeReadyObservation({ ...observation, screen: "Session: loading" }),
        undefined,
    );
});

test("zero-model diagnostic is bounded and exact source-qualified selection does not grant approval", () => {
    const diagnostic = {
        ...config,
        diagnosticOnly: true,
        maxTargetModelTurns: 0,
        restart: false,
    };
    validateNativeConfig(diagnostic, corpus);
    assert.throws(
        () =>
            validateNativeConfig(
                { ...diagnostic, maxTargetModelTurns: 1 },
                corpus,
            ),
        /zero model/,
    );
    assert.throws(
        () =>
            validateNativeConfig(
                { ...diagnostic, maxDurationMs: 180001 },
                corpus,
            ),
        /180000/,
    );
    assert.throws(
        () => validateNativeConfig({ ...diagnostic, restart: true }, corpus),
        /no restart/,
    );
    assert.throws(
        () =>
            validateNativeConfig({ ...config, maxTargetModelTurns: 0 }, corpus),
        /integer/,
    );
    assert.deepEqual(nativeToolFilters(), [
        "mcp:macro-eval-docs-lookup_document",
        "mcp:macro-eval-docs-fetch_document",
        "builtin:task",
    ]);
    const run = workspace();
    try {
        const args = consoleConfiguration(
            {
                workspace: directory,
                run,
                plugin: directory,
                pluginData: directory,
                data: directory,
            },
            diagnostic,
            0,
        ).args;
        assert.ok(args.includes("mcp:macro-eval-docs-lookup_document"));
        assert.equal(
            args.some((value) =>
                /--(?:allow-tool|allow-all|deny-tool)/u.test(value),
            ),
            false,
        );
    } finally {
        fs.rmSync(run, { recursive: true, force: true });
    }
});

test("cleanup Close retains an independent finite allowance after task deadline", () => {
    assert.equal(nativeControlTimeout("Close", 1), 30000);
    assert.equal(nativeControlTimeout("Read", 1), 1);
    assert.equal(nativeControlTimeout("Type", 20000), 15000);
    assert.equal(
        nativeCatalogReady("MCP Servers reloaded: 1 server connected", 1),
        true,
    );
    assert.equal(
        nativeCatalogReady("MCP Servers reloaded: 5 servers connected", 5),
        true,
    );
    assert.equal(
        nativeCatalogReady(
            "MCP Servers reloaded: 1 server connected, 4 failed",
            5,
        ),
        false,
    );
    assert.equal(nativeCatalogReady("Session: ready", 5), false);
    assert.throws(
        () =>
            validateNativeObservation({
                screen: "MCP Servers reloaded: 1 server connected, 4 failed",
                events: [],
            }),
        /MCP catalog startup failed/,
    );
});

test("control proof rejects requested-only JSON, wrong mode/path/root and missing native actors", () => {
    const root = workspace();
    try {
        const layout = {
            data: path.join(root, "data"),
            pluginData: path.join(root, "plugin-data"),
            owner: "owner",
            controlStartedAt: new Date(Date.now() - 1000).toISOString(),
        };
        const dir = path.join(layout.data, "native-control");
        fs.mkdirSync(dir, { recursive: true });
        assert.equal(nativeControlProof(layout).passed, false);
        const actors = [
            "mcp-agent",
            "mcp-workspace",
            "mcp-macros",
            "mcp-skills",
            "native-extension-status",
            "native-hook",
        ];
        const identities = [];
        for (const [index, component] of actors.entries()) {
            const parentPid = component === "native-hook" ? 5 : 10;
            identities.push({
                ProcessId: index + 1,
                ParentProcessId: parentPid,
                ExecutablePath: process.execPath,
                StartedMs: Date.now() - 2000,
            });
            fs.writeFileSync(
                path.join(dir, `${index}.json`),
                JSON.stringify({
                    effectiveMode: "bypass",
                    configPath: path.join(layout.pluginData, "config.json"),
                    dataRoot: layout.data,
                    digest: "a".repeat(64),
                    source: {
                        owner: "owner",
                        component,
                        pid: index + 1,
                        parentPid,
                        executable: process.execPath,
                        observedAt: new Date().toISOString(),
                        readableOwnedConfig: true,
                    },
                }),
            );
        }
        assert.equal(nativeControlProof(layout).passed, false);
        assert.equal(
            nativeControlProof(layout, "bypass", identities).passed,
            true,
        );
        const record = JSON.parse(
            fs.readFileSync(path.join(dir, "0.json"), "utf8"),
        );
        for (const patch of [
            { configPath: path.join(root, "other", "config.json") },
            { effectiveMode: "direct" },
            { dataRoot: root },
            { digest: "bad" },
            { source: { ...record.source, parentPid: 999 } },
            {
                source: {
                    ...record.source,
                    observedAt: new Date(0).toISOString(),
                },
            },
        ]) {
            fs.writeFileSync(
                path.join(dir, "0.json"),
                JSON.stringify({ ...record, ...patch }),
            );
            assert.equal(
                nativeControlProof(layout, "bypass", identities).passed,
                false,
            );
        }
        fs.writeFileSync(
            path.join(dir, "0.json"),
            JSON.stringify({ ...record, digest: "b".repeat(64) }),
        );
        assert.equal(
            nativeControlProof(layout, "bypass", identities).consistentDigest,
            false,
        );
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test("explicit bypass is never relabeled a grammar miss", () => {
    const evidence = extractNativeEvidence(
        modelAnswer(),
        audit(),
        [],
        "bypass",
    );
    assert.equal(evidence.routeEvidence.route, "unknown");
    assert.equal(evidence.routeEvidence.bypassCandidate, true);
    assert.equal(
        extractNativeEvidence(modelAnswer(), audit(), [], "direct")
            .routeEvidence.route,
        "miss",
    );
});

test("metadata catalog deferral never admits warnings after complete catalog or hides MCP failure", () => {
    const screen =
        'Unknown tool name in the tool allowlist: "mcp:macro-eval-docs-lookup_document"';
    assert.throws(
        () => validateNativeObservation({ screen, events: [] }),
        /unresolved tool allowlist/u,
    );
    assert.doesNotThrow(() =>
        validateNativeObservation(
            { screen, events: [] },
            { allowMetadataCatalogPending: true },
        ),
    );
    assert.throws(
        () =>
            validateNativeObservation(
                {
                    screen: `${screen}\nMCP Servers reloaded: 5 servers connected`,
                    events: [],
                },
                { allowMetadataCatalogPending: true },
            ),
        /unresolved tool allowlist/u,
    );
    assert.throws(
        () =>
            validateNativeObservation(
                {
                    screen: `${screen}\nFailed to connect to MCP server`,
                    events: [],
                },
                { allowMetadataCatalogPending: true },
            ),
        /MCP catalog startup failed/u,
    );
});

function workspace() {
    return fs.mkdtempSync(path.join(directory, ".native-controller-test-"));
}

test("owned folder trust requires unchanged generated workspace content and owner identity", () => {
    const run = workspace();
    try {
        const generated = path.join(run, "workspace");
        fs.mkdirSync(generated);
        fs.writeFileSync(
            path.join(run, "evaluation-owner.json"),
            JSON.stringify({ owner: "owned" }),
        );
        fs.writeFileSync(path.join(generated, "AGENTS.md"), "synthetic only");
        const expected = [
            {
                file: "AGENTS.md",
                sha256: createHash("sha256")
                    .update("synthetic only")
                    .digest("hex"),
            },
        ];
        const layout = { run, workspace: generated, owner: "owned" };
        verifyNativeWorkspace(layout, expected);
        assert.throws(
            () =>
                verifyNativeWorkspace({ ...layout, owner: "other" }, expected),
            /ownership/,
        );
        fs.writeFileSync(path.join(generated, "AGENTS.md"), "modified");
        assert.throws(
            () => verifyNativeWorkspace(layout, expected),
            /content changed/,
        );
    } finally {
        fs.rmSync(run, { recursive: true, force: true });
    }
});

test("hook consent requires unchanged hashed extension, owned profile and verified workspace", () => {
    const run = workspace();
    try {
        const generated = path.join(run, "workspace");
        const plugin = path.join(run, "plugin");
        const home = path.join(run, "home-0");
        const extension = path.join(
            plugin,
            "extensions",
            "typeagent",
            "extension.mjs",
        );
        fs.mkdirSync(generated);
        fs.mkdirSync(home);
        fs.mkdirSync(path.dirname(extension), { recursive: true });
        fs.writeFileSync(
            path.join(run, "evaluation-owner.json"),
            JSON.stringify({ owner: "owned" }),
        );
        fs.writeFileSync(extension, "expected extension bytes");
        const digest = createHash("sha256")
            .update("expected extension bytes")
            .digest("hex");
        const layout = { run, workspace: generated, plugin, owner: "owned" };
        verifyNativeHookRegistrationContext(layout, [], digest, home);
        assert.throws(
            () =>
                verifyNativeHookRegistrationContext(
                    layout,
                    [],
                    digest,
                    generated,
                ),
            /owned profile/,
        );
        fs.writeFileSync(extension, "changed extension bytes");
        assert.throws(
            () => verifyNativeHookRegistrationContext(layout, [], digest, home),
            /hashed extension/,
        );
    } finally {
        fs.rmSync(run, { recursive: true, force: true });
    }
});

test("staging rejects tsc-relative runtime imports rather than allowing hook fallback", () => {
    const run = workspace();
    try {
        const hook = path.join(run, "dist", "hooks", "hook-router.js");
        const mcp = path.join(run, "dist", "mcp", "server.js");
        fs.mkdirSync(path.dirname(hook), { recursive: true });
        fs.mkdirSync(path.dirname(mcp), { recursive: true });
        fs.writeFileSync(
            hook,
            'import fs from "node:fs";\nconst text = "from \\"./not-an-import.js\\"";',
        );
        fs.writeFileSync(mcp, 'import {createRequire} from "module";');
        validateNativeStagedEntries(run);
        for (const code of [
            'import {handleDirect} from "./hook-direct.js";',
            'export {x} from "../shared/x.js";',
            'await import("./missing.js");',
        ]) {
            fs.writeFileSync(hook, code);
            assert.throws(
                () => validateNativeStagedEntries(run),
                /not a self-contained bundle/,
            );
        }
    } finally {
        fs.rmSync(run, { recursive: true, force: true });
    }
});

test("native failed hooks and unresolved tool restriction warnings stop without fallback or rescue", () => {
    validateNativeObservation({
        screen: "Session: ready",
        events: [{ type: "hook.end", data: { success: true } }],
    });
    assert.throws(
        () =>
            validateNativeObservation({
                screen: "Session: ready",
                events: [
                    {
                        type: "hook.end",
                        data: {
                            success: false,
                            error: {
                                message: "ERR_MODULE_NOT_FOUND hook-direct.js",
                            },
                        },
                    },
                ],
            }),
        (error) =>
            error.status === "failed" &&
            /ERR_MODULE_NOT_FOUND/.test(error.message),
    );
    assert.throws(
        () =>
            validateNativeObservation({
                screen: 'Unknown tool name in the tool allowlist: "macro-eval-docs-fetch_document"',
                events: [],
            }),
        /restriction readiness is unproved/,
    );
});

test("version admission reads the actual CLI header, never a directory name or incidental pinned version", () => {
    assert.equal(
        validateNativeCliVersion(
            "GitHub Copilot CLI 1.0.89.\nRun 'copilot update' to check for updates.\n",
            "1.0.89",
        ),
        "1.0.89",
    );
    assert.throws(
        () =>
            validateNativeCliVersion(
                "GitHub Copilot CLI 1.0.95.\nPreviously installed 1.0.89\n",
                "1.0.89",
            ),
        /required 1\.0\.89; observed 1\.0\.95/,
    );
    assert.throws(
        () => validateNativeCliVersion("v24.13.0\n", "1.0.89"),
        /observed unrecognized/,
    );
});

test("installed CLI 1.0.95 requires explicit matching configuration and preserves all other gates", () => {
    validateNativeConfig({ ...config, cliVersion: "1.0.95" }, corpus);
    assert.equal(
        validateNativeCliVersion("GitHub Copilot CLI 1.0.95.\n", "1.0.95"),
        "1.0.95",
    );
    assert.throws(
        () => validateNativeConfig({ ...config, cliVersion: "1.0.96" }, corpus),
        /explicitly configured/,
    );
    assert.throws(
        () =>
            validateNativeConfig(
                { ...config, cliVersion: "1.0.95", executionPath: "caller" },
                corpus,
            ),
        /Caller\/MCP/,
    );
    assert.throws(
        () =>
            validateNativeCliVersion("GitHub Copilot CLI 1.0.89.\n", "1.0.95"),
        /required 1\.0\.95/,
    );
});

test("native admission freezes the final executable bytes and refuses post-probe drift", () => {
    const run = workspace();
    try {
        const file = path.join(run, "launcher.exe");
        fs.writeFileSync(file, "fixture binary bytes");
        const frozen = freezeNativeExecutable(file);
        assert.equal(frozen.resolvedExecutable, fs.realpathSync(file));
        assert.equal(
            frozen.sha256,
            createHash("sha256").update("fixture binary bytes").digest("hex"),
        );
        verifyNativeExecutable(frozen);
        fs.writeFileSync(file, "changed bytes");
        assert.throws(
            () => verifyNativeExecutable(frozen),
            /changed after version admission/,
        );
    } finally {
        fs.rmSync(run, { recursive: true, force: true });
    }
});

test("service readiness accepts an owned supervisor worker but not unrelated or reused process identities", () => {
    const supervisor = {
        ProcessId: 10,
        StartedMs: 100,
        ExecutablePath: "D:\\node.exe",
        ParentProcessId: 1,
    };
    const worker = {
        ProcessId: 11,
        StartedMs: 101,
        ExecutablePath: "D:\\node.exe",
        ParentProcessId: 10,
    };
    const listener = {
        LocalPort: 19985,
        OwningProcess: 11,
        LocalAddress: "127.0.0.1",
        ListenerTable: "TCP_TABLE_OWNER_PID_LISTENER",
    };
    assert.equal(
        validateOwnedServiceListener(
            supervisor,
            [supervisor, worker],
            [listener],
            19985,
        ),
        true,
    );
    assert.equal(
        validateOwnedServiceListener(
            supervisor,
            [supervisor, worker],
            [],
            19985,
        ),
        false,
    );
    assert.throws(
        () =>
            validateOwnedServiceListener(
                supervisor,
                [supervisor, { ...worker, ParentProcessId: 99 }],
                [listener],
                19985,
            ),
        /not the owned/,
    );
    assert.throws(
        () =>
            validateOwnedServiceListener(
                supervisor,
                [{ ...supervisor, StartedMs: 999 }, worker],
                [listener],
                19985,
            ),
        /identity changed/,
    );
    assert.throws(
        () =>
            validateOwnedServiceListener(
                supervisor,
                [supervisor, worker],
                [listener, listener],
                19985,
            ),
        /exactly one/,
    );
    assert.throws(
        () =>
            validateOwnedServiceListener(
                supervisor,
                [supervisor, worker],
                [{ ...listener, LocalPort: 1234 }],
                19985,
            ),
        /explicit-port/,
    );
    for (const LocalAddress of ["0.0.0.0", "::", "::1", "192.0.2.1"])
        assert.throws(
            () =>
                validateOwnedServiceListener(
                    supervisor,
                    [supervisor, worker],
                    [{ ...listener, LocalAddress }],
                    19985,
                ),
            /exact loopback/,
        );
    assert.throws(
        () =>
            validateOwnedServiceListener(
                supervisor,
                [supervisor, worker],
                [{ ...listener, ListenerTable: undefined }],
                19985,
            ),
        /OS-classified/,
    );
    for (const changed of [
        { ...worker, StartedMs: 99 },
        { ...worker, ExecutablePath: "" },
        { ...worker, StartedMs: 102 },
        { ...worker, ExecutablePath: "D:\\other.exe" },
    ]) {
        assert.throws(
            () =>
                validateOwnedServiceListener(
                    supervisor,
                    [supervisor, changed],
                    [listener],
                    19985,
                    [supervisor, worker],
                ),
            /ancestry/,
        );
    }
    assert.throws(
        () =>
            validateOwnedServiceListener(
                supervisor,
                [supervisor, { ...worker, StartedMs: 99 }],
                [listener],
                19985,
            ),
        /predates/,
    );
});

test(
    "Windows OS proof failures explicitly block rather than falling back to TCP or banners",
    { skip: process.platform !== "win32" },
    () => {
        const run = workspace();
        try {
            assert.throws(
                () =>
                    probeWindowsServiceListeners(19986, run, 10000, () => {
                        throw Object.assign(new Error("probe failed"), {
                            stderr: Buffer.from("Access is denied (5)"),
                        });
                    }),
                (error) =>
                    error.status === "blocked" &&
                    /OS listener ownership proof unavailable: Access is denied/.test(
                        error.message,
                    ),
            );
            assert.throws(
                () => probeWindowsServiceListeners(0, run),
                /explicit valid port/,
            );
        } finally {
            fs.rmSync(run, { recursive: true, force: true });
        }
    },
);

test(
    "real Windows listener-only API proves supervisor/wrapper/worker ownership despite missing CIM Listen rows",
    { skip: process.platform !== "win32", timeout: 60000 },
    async () => {
        const run = workspace();
        const fixture = path.join(run, "owned-listener.mjs");
        fs.writeFileSync(
            fixture,
            `
import net from "node:net";
import {spawn} from "node:child_process";
import {fileURLToPath} from "node:url";
if (process.argv[2] === "worker") {
    const sockets = new Set();
    const server = net.createServer(socket => sockets.add(socket));
    await new Promise(resolve => server.listen({host:"127.0.0.1",port:0}, resolve));
    const client = net.createConnection({host:"127.0.0.1",port:server.address().port});
    await new Promise(resolve => client.once("connect", resolve));
    console.log(JSON.stringify({pid:process.pid, port:server.address().port}));
    process.stdin.once("data", () => {
        client.destroy();
        for (const socket of sockets) socket.destroy();
        server.close(() => process.exit(0));
    });
} else {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "worker"], {shell:true, stdio:["pipe","pipe","pipe"]});
    child.stdout.pipe(process.stdout);
    process.stdin.once("data", () => child.stdin.end("close\\\\n"));
    child.once("exit", code => process.exit(code ?? 1));
}
`,
        );
        const child = spawn(process.execPath, [fixture], {
            stdio: ["pipe", "pipe", "pipe"],
        });
        const exit = once(child, "exit");
        let owned, observed;
        try {
            const [chunk] = await once(child.stdout, "data", {
                signal: AbortSignal.timeout(10000),
            });
            owned = JSON.parse(chunk.toString());
            const before = processTree(child.pid);
            const root = before.find((item) => item.ProcessId === child.pid);
            observed = probeWindowsServiceListeners(owned.port, run, 15000);
            const after = processTree(child.pid);
            assert.equal(
                observed.length,
                1,
                "Established same-port connections must not enter the listener-only table",
            );
            assert.equal(observed[0].OwningProcess, owned.pid);
            assert.equal(observed[0].LocalAddress, "127.0.0.1");
            const cim = spawnSync(
                "powershell.exe",
                [
                    "-NoProfile",
                    "-Command",
                    `$ErrorActionPreference='Stop'; $rows=@(Get-NetTCPConnection -LocalPort ${owned.port}); ` +
                        `$raw=@($rows | ForEach-Object {[pscustomobject]@{OwningProcess=$_.OwningProcess;State=$_.CimInstanceProperties['State'].Value}}); ` +
                        `$filtered=@(Get-NetTCPConnection -LocalPort ${owned.port} -State Listen -ErrorAction SilentlyContinue); ` +
                        `[pscustomobject]@{Raw=$raw;Filtered=@($filtered | Select-Object OwningProcess)} | ConvertTo-Json -Depth 4 -Compress`,
                ],
                { encoding: "utf8", timeout: 15000 },
            );
            assert.equal(cim.status, 0, cim.stderr);
            const provider = JSON.parse(cim.stdout);
            if (
                provider.Raw.some(
                    (row) => row.OwningProcess === owned.pid && row.State === 0,
                )
            )
                assert.equal(
                    provider.Filtered.some(
                        (row) => row.OwningProcess === owned.pid,
                    ),
                    false,
                    "Reproduce the missing State=Listen CIM ownership proof without guessing a state",
                );
            assert.ok(
                after.length >= 3,
                "Exercise actual Windows command wrapper ancestry",
            );
            assert.equal(
                validateOwnedServiceListener(
                    root,
                    after,
                    observed,
                    owned.port,
                    before,
                ),
                true,
            );
            const stale = before.map((item) =>
                item.ProcessId === owned.pid
                    ? { ...item, StartedMs: item.StartedMs - 1 }
                    : item,
            );
            assert.throws(
                () =>
                    validateOwnedServiceListener(
                        root,
                        after,
                        observed,
                        owned.port,
                        stale,
                    ),
                /ancestry identity/,
            );
        } finally {
            child.stdin.end("close\n");
            const [code] = await exit;
            assert.equal(code, 0);
            if (owned) {
                assert.deepEqual(
                    probeWindowsServiceListeners(owned.port, run, 15000),
                    [],
                );
                assert.equal(
                    processTree(owned.pid).some(
                        (item) => item.ProcessId === owned.pid,
                    ),
                    false,
                );
            }
            fs.rmSync(run, { recursive: true, force: true });
        }
    },
);

test(
    "real Windows listener table excludes a bound-only socket, not just established connections",
    { skip: process.platform !== "win32", timeout: 30000 },
    async () => {
        const run = workspace();
        const child = spawn(
            "powershell.exe",
            [
                "-NoProfile",
                "-Command",
                `$ErrorActionPreference='Stop'; $socket=New-Object System.Net.Sockets.Socket([System.Net.Sockets.AddressFamily]::InterNetwork,[System.Net.Sockets.SocketType]::Stream,[System.Net.Sockets.ProtocolType]::Tcp); ` +
                    `$socket.Bind([System.Net.IPEndPoint]::new([System.Net.IPAddress]::Loopback,0)); ` +
                    `[pscustomobject]@{Pid=$PID;Port=$socket.LocalEndPoint.Port} | ConvertTo-Json -Compress; ` +
                    `[Console]::In.ReadLine() | Out-Null; $socket.Dispose()`,
            ],
            { stdio: ["pipe", "pipe", "pipe"] },
        );
        const exit = once(child, "exit");
        try {
            const [chunk] = await once(child.stdout, "data", {
                signal: AbortSignal.timeout(10000),
            });
            const owned = JSON.parse(chunk.toString());
            assert.equal(owned.Pid, child.pid);
            assert.deepEqual(
                probeWindowsServiceListeners(owned.Port, run, 15000),
                [],
            );
        } finally {
            child.stdin.end("\n");
            const [code] = await exit;
            assert.equal(code, 0);
            assert.deepEqual(processTree(child.pid), []);
            fs.rmSync(run, { recursive: true, force: true });
        }
    },
);

test("native process exit status cannot become a numeric or successful evaluation verdict", () => {
    for (const status of [0, 1, 42, "passed", "unknown", undefined])
        assert.equal(nativeFailureStatus({ status }), "harness-invalid");
    for (const status of ["failed", "blocked", "harness-invalid"])
        assert.equal(nativeFailureStatus({ status }), status);
});

function draft() {
    return {
        macroId: "learned",
        version: 1,
        state: "draft",
        inputs: [
            {
                name: "title",
                required: true,
                secret: false,
                valueType: "string",
            },
        ],
        learning: {
            requiresLivePermissions: true,
            grammarRules: ["Read $(title)"],
        },
        steps: [
            {
                id: "lookup",
                mcpServerName: "macro-eval-docs",
                toolName: "macro-eval-docs-lookup_document",
                arguments: {
                    bindings: [
                        {
                            path: ["title"],
                            expression: { kind: "input", name: "title" },
                        },
                    ],
                },
                postconditions: [{ kind: "resultPathExists", path: ["id"] }],
            },
            {
                id: "fetch",
                mcpServerName: "macro-eval-docs",
                toolName: "macro-eval-docs-fetch_document",
                arguments: {
                    bindings: [
                        {
                            path: ["id"],
                            expression: {
                                kind: "stepResult",
                                stepId: "lookup",
                                path: ["id"],
                            },
                        },
                    ],
                },
                postconditions: [
                    { kind: "resultPathExists", path: ["content"] },
                ],
            },
        ],
    };
}

function timeline() {
    const events = [];
    const append = (type, data, child = {}) => {
        const event = {
            id: `event-${events.length}`,
            parentId: events.at(-1)?.id ?? null,
            type,
            timestamp: new Date().toISOString(),
            data,
            ...child,
        };
        events.push(event);
        return event;
    };
    return { events, append };
}

function modelAnswer(
    prompt = "Read Beta",
    content = "Beta\nBETA FULL CONTENT",
) {
    const { events, append } = timeline();
    append("hook.end", {
        hookType: "userPromptSubmitted",
        success: true,
        output: {},
    });
    append("user.message", { content: prompt, interactionId: "interaction" });
    append("assistant.turn_start", { turnId: "turn" });
    append("assistant.message", {
        content,
        turnId: "turn",
        toolRequests: [],
        interactionId: "interaction",
    });
    append("assistant.turn_end", { turnId: "turn" });
    return events;
}

function hostAnswer() {
    const { events, append } = timeline();
    const child = { agentId: "child" };
    const data = { parentToolCallId: "host-call" };
    const content = "Beta\nBETA FULL CONTENT";
    append(
        "subagent.started",
        {
            agentName: "typeagent:typeagent-macro-runner-host",
            model: "gpt-6-luna",
            toolCallId: "host-call",
        },
        child,
    );
    append("assistant.turn_start", { ...data, turnId: "child-turn" }, child);
    for (const name of ["lookup_document", "fetch_document"])
        append(
            "tool.execution_start",
            { ...data, toolName: `macro-eval-docs-${name}`, toolCallId: name },
            child,
        );
    append(
        "assistant.message",
        { ...data, turnId: "child-turn", content, toolRequests: [] },
        child,
    );
    append("assistant.turn_end", { ...data, turnId: "child-turn" }, child);
    append(
        "subagent.completed",
        {
            agentName: "typeagent:typeagent-macro-runner-host",
            toolCallId: "host-call",
        },
        child,
    );
    append("session.info", {
        message: JSON.stringify({
            kind: "typeagent-macro-phases",
            catalogValidation: { macroId: "learned", version: 1 },
            elapsedMs: 10,
            phases: [
                "host.dispatch",
                "host.catalog-validated",
                "subagent.started",
                "procedure-tool.started",
                "procedure-tool.completed",
                "runner.turn.completed",
                "subagent.completed",
            ].map((phase, elapsedMs) => ({ phase, elapsedMs })),
        }),
    });
    append("hook.end", {
        hookType: "userPromptSubmitted",
        success: true,
        output: { handled: true, responseContent: content },
    });
    append("user.message", {
        content: "Read Beta",
        interactionId: "interaction",
    });
    append("assistant.message", {
        content,
        toolRequests: [],
        interactionId: "interaction",
    });
    return events;
}

function audit(key = "b") {
    const document = corpus.documents.find((item) => item.key === key);
    return [
        {
            operation: "lookup_document",
            title: document.title,
            returnedId: document.expectedId,
            timestamp: new Date().toISOString(),
        },
        {
            operation: "fetch_document",
            id: document.expectedId,
            timestamp: new Date().toISOString(),
        },
    ];
}
const route = {
    conversationId: "owned",
    seq: 1,
    event: "explained",
    data: {
        fromCache: "grammar",
        detail: { phrase: "Read Beta", action: "macros.run_learned_v1" },
    },
};
const scenario = {
    ...corpus.heldOutPositive[0],
    kind: "positive",
    familyId: corpus.familyId,
};

test("extracts actual ordinary completion and hook-proven grammar miss without adding idle", () => {
    const events = modelAnswer();
    const evidence = extractNativeEvidence(events, audit(), [], "direct");
    assert.equal(evidence.terminal, "root-turn");
    assert.equal(evidence.routeEvidence.route, "miss");
    assert.equal(evidence.modelTurns, 1);
    assert.equal(evidence.answer, "Beta\nBETA FULL CONTENT");
    assert.equal(
        gradeDocumentTrial({
            ...evidence,
            scenario,
            documents: corpus.documents,
        }).status,
        "passed",
    );
    assert.equal(
        events.some((entry) => entry.type === "session.idle"),
        false,
    );
    assert.equal(
        extractNativeEvidence(events.slice(1), audit(), [], "bypass")
            .routeEvidence.route,
        "unknown",
    );
});

test("Direct child execution before root user message retains independent host completion proof", () => {
    const events = hostAnswer();
    const evidence = extractNativeEvidence(events, audit(), [route]);
    assert.equal(evidence.executionEvidence.wholeMacroInvocations, 1);
    assert.equal(evidence.routeEvidence.route, "grammar");
    assert.equal(evidence.routeEvidence.macroId, "learned");
    assert.equal(evidence.routeEvidence.version, 1);
    assert.equal(
        gradeDocumentTrial({
            ...evidence,
            scenario,
            documents: corpus.documents,
        }).status,
        "passed",
    );
    assert.equal(
        extractNativeEvidence(events, audit(), [route, route]).routeEvidence
            .route,
        "unknown",
    );
});

test("nonmacro literal handled responses remain blocked by the existing strict grader", () => {
    const { events, append } = timeline();
    const answer = "Beta\nBETA FULL CONTENT";
    append("hook.end", {
        hookType: "userPromptSubmitted",
        success: true,
        output: { handled: true, responseContent: answer },
    });
    append("user.message", { content: "Read Beta", interactionId: "i" });
    append("assistant.message", {
        content: answer,
        toolRequests: [],
        interactionId: "i",
    });
    const evidence = extractNativeEvidence(events, audit());
    assert.equal(evidence.terminal, "handled-hook");
    assert.equal(evidence.literalHookId, "event-0");
    const grade = gradeDocumentTrial({
        ...evidence,
        scenario,
        documents: corpus.documents,
    });
    assert.equal(grade.status, "failed");
    assert.equal(
        grade.checks.find(
            (check) => check.name === "terminal-native-completion",
        ).passed,
        false,
    );
    events[2].parentId = "unrelated";
    assert.equal(extractNativeEvidence(events, audit()).terminal, "pending");
});

test("does not confuse causal parentId, child answers, pending tools or wrong turns with completion", () => {
    const events = modelAnswer();
    events.at(-1).data.turnId = "other";
    assert.equal(extractNativeEvidence(events, []).terminal, "pending");
    events.at(-1).data.turnId = "turn";
    events.at(-2).agentId = "child";
    assert.equal(extractNativeEvidence(events, []).answer, "");
    delete events.at(-2).agentId;
    events.at(-2).data.toolRequests = [{ toolCallId: "pending" }];
    assert.equal(extractNativeEvidence(events, []).answer, "");
});

test("execution evidence includes unexpected native tools, inspections and backend effects", () => {
    const events = modelAnswer();
    events.push({
        id: "extra",
        type: "tool.execution_start",
        data: { toolName: "typeagent-macros-inspect_macro" },
    });

    test("host evidence rejects model drift and procedure execution outside the owned child", () => {
        const events = hostAnswer();
        events[0].data.model = "other";
        events.find((entry) => entry.type === "tool.execution_start").agentId =
            "root-other";
        const evidence = extractNativeEvidence(events, audit(), [route]);
        assert.ok(
            evidence.executionEvidence.effects.includes(
                "unexpected-host-runner-model",
            ),
        );
        assert.ok(
            evidence.executionEvidence.effects.includes(
                "procedure-outside-host-child",
            ),
        );
        assert.equal(
            gradeDocumentTrial({
                ...evidence,
                scenario,
                documents: corpus.documents,
            }).status,
            "failed",
        );
    });
    const evidence = extractNativeEvidence(events, [
        { operation: "rejected_tool_call" },
    ]);
    assert.deepEqual(evidence.executionEvidence.effects, [
        "typeagent-macros-inspect_macro",
        "rejected_tool_call",
    ]);
});

test("audit/event reader waits for complete records and fails invalid complete JSONL", () => {
    const root = workspace();
    try {
        const file = path.join(root, "audit.jsonl");
        fs.writeFileSync(file, '{"type":"one"}\n{"partial":');
        assert.deepEqual(readNativeJsonl(file), [{ type: "one" }]);
        fs.writeFileSync(file, "invalid\n");
        assert.throws(() => readNativeJsonl(file), SyntaxError);
        assert.deepEqual(readNativeJsonl(path.join(root, "absent")), []);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test("startup admission is exact and never authorizes blanket or unknown permissions", () => {
    const owned = "D:\\owned\\workspace";
    assert.equal(
        classifyNativeScreen(`Confirm folder trust\n${owned}\n1. Yes`, owned)
            .text,
        "1",
    );
    assert.throws(
        () =>
            classifyNativeScreen(
                "Confirm folder trust\nD:\\other\n1. Yes",
                owned,
            ),
        /Unverified/,
    );
    assert.equal(
        classifyNativeScreen(
            'Extension "plugin:typeagent:typeagent" wants elevated permissions\nThis extension wants to: register hooks.\n1. Yes',
            owned,
        ).reason,
        "register hooks once",
    );
    assert.throws(
        () =>
            classifyNativeScreen(
                'Extension "other" wants elevated permissions\n1. Yes',
                owned,
            ),
        /Unexpected/,
    );
    assert.equal(
        classifyNativeScreen("Install it now?\nNo, thanks", owned).text,
        "n",
    );
    assert.throws(
        () =>
            classifyNativeScreen("Confirm unknown interaction\n1. Yes", owned),
        /Unknown/,
    );
    assert.throws(
        () => classifyNativeScreen("Allow all permissions?", owned),
        /Unknown/,
    );
});

test("boxed native register-hooks consent ignores only presentation borders and rejects multiline extra scopes", () => {
    const owned = "D:\\owned\\synthetic";
    const screen = [
        '│ Extension "plugin:typeagent:typeagent" wants elevated permissions          │',
        "│ This extension wants to: register hooks.                                  │",
        "│ Denying will prevent this extension from loading.                         │",
        "│ ❯ 1. Yes                                                                 │",
        '│   2. Yes, and always allow "plugin:typeagent:typeagent" in this repo        │',
        "│   3. No (Esc)                                                            │",
    ].join("\n");
    assert.deepEqual(classifyNativeScreen(screen, owned), {
        text: "1",
        reason: "register hooks once",
    });
    for (const changed of [
        screen.replace("register hooks.", "register hooks, run tools."),
        screen.replace("│ Denying", "│ run tools. │\n│ Denying"),
        screen.replace("plugin:typeagent:typeagent", "plugin:other:typeagent"),
    ])
        assert.throws(
            () => classifyNativeScreen(changed, owned),
            /Unexpected extension permission scope/,
        );
});

test("read consent is one-shot exact tool and arguments; inspection is not an execution step", () => {
    const consent = {
        approve: true,
        tools: [
            {
                name: "macro-eval-docs-fetch_document",
                arguments: { id: "synthetic-b" },
            },
        ],
    };
    const screen =
        'Do you want to use this tool?\nmacro-eval-docs-fetch_document\n{"id":"synthetic-b"}\n1. Yes\n3. No';
    assert.equal(classifyNativeScreen(screen, "D:\\owned", consent).text, "1");
    for (const changed of [
        screen.replace("synthetic-b", "other"),
        screen.replace("fetch_document", "inspect_macro"),
        screen.replace(
            '{"id":"synthetic-b"}',
            '{"id":"synthetic-b","extra":"danger"}',
        ),
    ])
        assert.throws(
            () => classifyNativeScreen(changed, "D:\\owned", consent),
            /exact admitted/,
        );
    assert.throws(
        () =>
            classifyNativeScreen(screen, "D:\\owned", {
                ...consent,
                approve: false,
            }),
        /exact admitted/,
    );
});

test("strict review verifies guards, exact identities and fresh dependent bindings", () => {
    reviewNativeDraft(draft(), { valid: true });
    for (const mutate of [
        (value) => {
            value.inputs[0].secret = true;
        },
        (value) => {
            value.steps[1].arguments.bindings[0].expression.stepId = "wrong";
        },
        (value) => {
            value.steps[0].toolName = "shell";
        },
        (value) => {
            value.learning.requiresLivePermissions = false;
        },
        (value) => {
            value.steps[1].postconditions = [];
        },
    ]) {
        const value = draft();
        mutate(value);
        assert.throws(() => reviewNativeDraft(value, { valid: true }));
    }
    assert.throws(() => reviewNativeDraft(draft(), { valid: false }));
});

test("config blocks unsupported paths, implicit bounds, inherited permissions and reused bindings", () => {
    validateNativeConfig(config, corpus);
    for (const patch of [
        { runnerModel: "other" },
        { rootModel: "--allow-all" },
        { port: 0 },
        { maxDurationMs: NaN },
        { maxTargetModelTurns: 0 },
        { cliVersion: "other" },
        { executionPath: "caller" },
        { allowAll: true },
        { approveSyntheticReadsOnce: undefined },
        { trainingCase: "reuse" },
    ])
        assert.throws(() =>
            validateNativeConfig({ ...config, ...patch }, corpus),
        );
});

test("budget counts unique root and child native turns and enforces cancellation/deadline", () => {
    let now = 0;
    const budget = createNativeBudget(
        { maxDurationMs: 10, maxTargetModelTurns: 1 },
        undefined,
        () => now,
    );
    const events = [
        { id: "turn-one", type: "assistant.turn_start", agentId: "child" },
    ];
    budget.check(events);
    budget.check(events);
    assert.throws(
        () =>
            budget.check([
                ...events,
                { id: "two", type: "assistant.turn_start" },
            ]),
        /turn bound/,
    );
    now = 10;
    assert.throws(() => budget.check(), /deadline/);
    const abort = new AbortController();
    abort.abort();
    assert.throws(
        () => createNativeBudget(config, abort.signal).check(),
        /cancelled/,
    );
});

test("cancellation interrupts a pending operation instead of waiting for its deadline", async () => {
    const abort = new AbortController();
    const budget = createNativeBudget(config, abort.signal);
    const pending = budget.run(new Promise(() => {}));
    abort.abort();
    await assert.rejects(pending, /cancelled/);
});

function fakeAdapter(behavior = {}) {
    let events = [],
        index = 0,
        mode = "bypass",
        learned = false;
    const backendAudit = [];
    const routes = [];
    const operations = [];
    const add = (next) => {
        const prefix = `session-${index}-batch-${events.length}-`;
        events.push(
            ...next.map((event) => ({
                ...event,
                id: prefix + event.id,
                parentId: event.parentId ? prefix + event.parentId : null,
            })),
        );
    };
    return {
        operations,
        startService: async () => {
            operations.push("service-start");
            return learned
                ? [{ macroId: "learned", version: 1, state: "approved" }]
                : [];
        },
        openConsole: async () => {
            operations.push("console-open");
            index++;
            events = [];
        },
        closeConsole: async () => {
            operations.push("console-close");
            if (behavior.cleanupError) throw new Error("close failure");
        },
        stopService: async () => {
            operations.push("service-stop");
        },
        setMode: (value) => {
            mode = value;
            operations.push(`mode:${mode}`);
        },
        read: () => ({
            events: [...events],
            backendAudit: [...backendAudit],
            routes: [...routes],
            sessionId: `owned-session-${index}`,
            screen: behavior.unknownScreen
                ? "Do you want an unknown install?"
                : "Session: ready\nMCP Servers reloaded: 5 servers connected",
        }),
        submit: (text) => {
            operations.push(`submit:${text}`);
            if (text.startsWith("/")) {
                const { events: next, append } = timeline();
                const content = text.includes("record")
                    ? "Recording token: token"
                    : "prepare";
                append("hook.end", {
                    hookType: "userPromptSubmitted",
                    success: true,
                    output: { handled: true, responseContent: content },
                });
                append("user.message", {
                    content: text,
                    interactionId: "command",
                });
                append("assistant.message", {
                    content,
                    interactionId: "command",
                    toolRequests: [],
                });
                add(next);
            } else if (text === "Read Alpha") {
                add(modelAnswer("Read Alpha", "Alpha\nALPHA FULL CONTENT"));
                backendAudit.push(...audit("a"));
            } else {
                add(learned ? hostAnswer() : modelAnswer());
                backendAudit.push(...audit());
                if (learned) routes.push({ ...route, seq: routes.length + 1 });
                if (behavior.taskError)
                    add([{ id: "failed", type: "session.error", data: {} }]);
            }
        },
        recording: async () => ({
            learningJob: {
                status: "needsReview",
                macro: { macroId: "learned", version: 1 },
            },
        }),
        inspect: async () => draft(),
        validate: async () => ({ valid: true }),
        approve: async () => {
            learned = true;
            operations.push("approve");
            return { macroId: "learned", version: 1 };
        },
        runtime: () => [],
    };
}

async function fakeRun(root, adapter, override = {}) {
    const helpers = path.join(root, "helpers");
    fs.mkdirSync(helpers);
    for (const name of [
        "Launch-Demo.ps1",
        "Control-Demo.ps1",
        "console-bridge.mjs",
    ])
        fs.writeFileSync(path.join(helpers, name), "offline fake helper");
    return runNativeEvaluation({
        corpus,
        config: { ...config, ...override },
        output: path.join(root, "run"),
        helperDirectory: helpers,
        executeLive: true,
        adapterFactory: adapter
            ? (layout) => {
                  if (override.diagnosticOnly)
                      fs.writeFileSync(
                          path.join(
                              layout.data,
                              "native-control-diagnostic-result.json",
                          ),
                          JSON.stringify({
                              status: "blocked",
                              error: "Offline adapter has no native transition proof",
                              transitions: [],
                          }),
                      );
                  return adapter;
              }
            : undefined,
    });
}

test("diagnostic startup never submits a task/command, learns or publishes and remains blocked on native negative permission proof", async () => {
    const root = workspace();
    try {
        const adapter = fakeAdapter();
        const result = await fakeRun(root, adapter, {
            diagnosticOnly: true,
            maxTargetModelTurns: 0,
            restart: false,
        });
        const admission = JSON.parse(
            fs.readFileSync(
                path.join(root, "run", "data", "native-control-admission.json"),
                "utf8",
            ),
        );
        assert.equal(
            admission.diagnosticCatalogSessionId,
            adapter.read().sessionId,
        );

        test("late auxiliary model telemetry invalidates metadata-only startup despite zero target turns", async () => {
            const root = workspace();
            try {
                const adapter = fakeAdapter();
                adapter.finalEvents = () => [
                    {
                        type: "model.turn_started",
                        data: { model: "gpt-4o-mini" },
                    },
                ];
                const result = await fakeRun(root, adapter, {
                    diagnosticOnly: true,
                    maxTargetModelTurns: 0,
                    restart: false,
                });
                assert.equal(result.status, "harness-invalid");
                assert.equal(result.targetModelTurns, 0);
                assert.equal(
                    result.nativeModelTelemetry.counts["model.turn_started"],
                    1,
                );
                assert.match(
                    result.nativeModelTelemetry.serviceModelUsage,
                    /unknown/u,
                );
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        });

        test("real task entrypoint blocks the unsupported bypass/control contract before any service or model launch", async () => {
            const root = workspace();
            try {
                const result = await fakeRun(root, undefined);
                assert.equal(result.status, "blocked");
                assert.match(
                    result.error,
                    /blocked before models.*explicit Copilot bypass/u,
                );
                assert.equal(result.targetModelTurns, 0);
                assert.deepEqual(result.trials, []);
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        });
        assert.equal(result.status, "blocked", JSON.stringify(result));
        assert.equal(result.targetModelTurns, 0);
        assert.deepEqual(result.trials, []);
        assert.deepEqual(adapter.operations, [
            "service-start",
            "console-open",
            "console-close",
            "service-stop",
        ]);
        assert.equal(result.diagnostic.nativeCommandSubmitted, false);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test("offline adapter blocks an explicit bypass baseline without an admitted grader route contract", async () => {
    const root = workspace();
    try {
        const adapter = fakeAdapter();
        const result = await fakeRun(root, adapter);
        assert.equal(result.status, "blocked", JSON.stringify(result));
        assert.deepEqual(
            result.trials.map((trial) => trial.candidate),
            ["baseline"],
        );
        assert.equal(
            result.trials[0].evidence.routeEvidence.bypassCandidate,
            true,
        );
        assert.equal(result.trials[0].grade.taskCorrect, true);
        assert.equal(result.trials[0].grade.grammarHit, null);
        assert.ok(result.trials.every((trial) => trial.elapsedMs >= 0));
        assert.deepEqual(
            adapter.operations.filter((operation) =>
                operation.startsWith("service-"),
            ),
            ["service-start", "service-stop"],
        );
        assert.equal(
            fs.readFileSync(path.join(root, "run", "backend.jsonl"), "utf8"),
            "",
        );
        assert.equal(
            JSON.parse(
                fs.readFileSync(path.join(root, "run", "result.json"), "utf8"),
            ).status,
            "blocked",
        );
        const fixtureConfig = JSON.parse(
            fs.readFileSync(
                path.join(root, "run", "workspace", ".mcp.json"),
                "utf8",
            ),
        );
        assert.ok(
            fixtureConfig.mcpServers["macro-eval-docs"].args.includes(
                "--append-audit",
            ),
        );
        const manifest = JSON.parse(
            fs.readFileSync(path.join(root, "run", "manifest.json"), "utf8"),
        );
        assert.equal(manifest.acceptance, "unexecuted");
        assert.equal(manifest.usage, null);
        for (const name of [
            "copilot-macros",
            "defaultAgentProvider",
            "copilot-plugin",
        ])
            for (const directory of ["src", "dist"])
                assert.ok(
                    manifest.coupledProduct[name][directory].every((entry) =>
                        /^[a-f0-9]{64}$/u.test(entry.sha256),
                    ) && manifest.coupledProduct[name][directory].length > 0,
                );
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

for (const [name, behavior, override, expected] of [
    ["unknown interactions", { unknownScreen: true }, {}, "blocked"],
    ["native errors", { taskError: true }, {}, "failed"],
    ["unapproved publication", {}, { reviewSyntheticDraft: false }, "blocked"],
    ["cleanup failures", { cleanupError: true }, {}, "harness-invalid"],
    ["turn bound", {}, { maxTargetModelTurns: 1 }, "blocked"],
    ["deadline", {}, { maxDurationMs: 1 }, "blocked"],
])
    test(`offline lifecycle persists ${name} and attempts only owned cleanup`, async () => {
        const root = workspace();
        try {
            const adapter = fakeAdapter(behavior);
            const result = await fakeRun(root, adapter, override);
            assert.equal(result.status, expected, JSON.stringify(result));
            if (behavior.taskError) {
                assert.ok(
                    result.incompleteTrial.evidence.events.some(
                        (event) => event.type === "session.error",
                    ),
                );
                assert.equal(
                    result.incompleteTrial.evidence.backendAudit.length,
                    2,
                );
            }
            if (adapter.operations.includes("service-start"))
                assert.ok(adapter.operations.includes("service-stop"));
            assert.equal(
                JSON.parse(
                    fs.readFileSync(
                        path.join(root, "run", "result.json"),
                        "utf8",
                    ),
                ).status,
                expected,
            );
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

test("entrypoint native preflight works from external cwd without invoking CLI/helpers/services", () => {
    const root = workspace();
    try {
        const helpers = path.join(root, "helpers");
        fs.mkdirSync(helpers);
        for (const name of [
            "Launch-Demo.ps1",
            "Control-Demo.ps1",
            "console-bridge.mjs",
        ])
            fs.writeFileSync(path.join(helpers, name), "throw 'must not run'");
        const input = path.join(root, "config.json");
        const corpusPath = path.join(root, "corpus.json");
        fs.writeFileSync(input, JSON.stringify(config));
        fs.writeFileSync(corpusPath, JSON.stringify(corpus));
        const output = path.join(root, "owned");
        const args = [
            path.resolve(directory, "..", "macro-eval.mjs"),
            "native",
            "--corpus",
            corpusPath,
            "--input",
            input,
            "--console-helper-dir",
            helpers,
            "--output",
            output,
        ];
        const result = spawnSync(process.execPath, args, {
            cwd: root,
            encoding: "utf8",
            timeout: 30000,
        });
        assert.equal(result.status, 0, result.stderr);
        assert.equal(
            JSON.parse(
                fs.readFileSync(path.join(output, "result.json"), "utf8"),
            ).status,
            "unexecuted",
        );
        assert.equal(
            fs.existsSync(path.join(output, "console-0.private.json")),
            false,
        );
        const owner = fs.readFileSync(
            path.join(output, "evaluation-owner.json"),
            "utf8",
        );
        const second = spawnSync(process.execPath, args, {
            cwd: root,
            encoding: "utf8",
            timeout: 30000,
        });
        assert.equal(second.status, 1);
        assert.match(second.stderr, /must not already exist/);
        assert.equal(
            fs.readFileSync(path.join(output, "evaluation-owner.json"), "utf8"),
            owner,
        );
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
