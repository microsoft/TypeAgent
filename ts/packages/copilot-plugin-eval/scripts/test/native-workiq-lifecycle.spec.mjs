// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import vm from "node:vm";
import { execFileSync, spawn } from "node:child_process";
import tseslint from "typescript-eslint";
import {
    assertNativeWorkiqProjection,
    assertNativeWorkiqCompletedRecording,
    selectNativeWorkiqGetterControls,
    createNativeWorkiqEvidenceBoundary,
    createNativeWorkiqHostAssertions,
    validateWorkiqNativeRuntimeConfig,
    verifyWorkiqSdkToolInventory,
    assertNativeWorkiqSelectedToolOutcomes,
    resolveNativeWorkiqSignal,
    snapshotNativeWorkiqRuntimeConfig,
    nativeWorkiqConsoleEnvironment,
    nativeWorkiqControlAdmission,
    verifyNativeWorkiqExecutablePin,
    readNativeWorkiqSessionEvents,
    verifyNativeWorkiqBootstrapArtifacts,
    awaitNativeWorkiqLauncher,
    matchesPartialConsoleBridge,
    selectNativeWorkiqCurrentMcpControls,
    createNativeWorkiqHookTarget,
    validateNativeWorkiqHookTarget,
} from "../native-workiq-lifecycle.mjs";
import { verifyNativeWorkiqProjectionSources } from "../native-workiq-projection.mjs";
import {
    runNativeWorkiqPilot,
    awaitNativeWorkiqWithUi,
    runNativeWorkiqLookupDiagnostic,
    nativeWorkiqLookupOutcome,
    verifyNativeWorkiqLookupDiagnosticEvidence,
    awaitNativeWorkiqLookupOutcome,
    assertNativeWorkiqLookupRecordingArm,
} from "../native-workiq-pilot.mjs";
import {
    createNativeBudget,
    classifyNativeScreen,
    processTree,
} from "../macro-eval-native.mjs";
import {
    awaitWorkiqNativeSession,
    awaitWorkiqFinalizedCapture,
} from "../macro-eval-workiq-native.mjs";
import {
    workiqMacroCorrectnessContract,
    workiqRequestMatches,
} from "../macro-eval-workiq-evidence.mjs";
import { workiqPendingConsentArguments } from "../macro-eval-workiq-controller.mjs";

const config = {
    cliExecutable: path.resolve("copilot.exe"),
    configDirectory: path.resolve("config"),
    helperDirectory: path.resolve("helpers"),
    port: 20165,
    maxTargetModelTurns: 20,
    maxDurationMs: 300000,
    extensionMode: "load_only",
    exposureOverride: "user-authorized-unverified-model-exposure",
    rootModel: "test-model",
    cliVersion: "1.0.95",
};

function getterControlFixture() {
    const now = Date.now();
    const layout = {
        owner: "owned",
        pluginData: path.resolve("owned", "plugin-data"),
        data: path.resolve("owned", "data"),
        workspace: path.resolve("owned", "workspace"),
        plugin: path.resolve("owned", "plugin"),
        controlStartedAt: new Date(now - 1000).toISOString(),
    };
    const record = (component, pid, parentPid, time = now - 100) => ({
        effectiveMode: "direct",
        digest: "a".repeat(64),
        dataRoot: layout.data,
        configPath: path.join(layout.pluginData, "config.json"),
        source: {
            component,
            pid,
            parentPid,
            owner: layout.owner,
            cwd: layout.workspace,
            executable: process.execPath,
            readableOwnedConfig: true,
            expectedConfigPath: path.join(layout.pluginData, "config.json"),
            expectedMode: "direct",
            observedAt: new Date(time).toISOString(),
            request: null,
        },
    });
    const extension = record("native-extension-status", 100, 10);
    const current = record("native-hook", 200, 100);
    const old = record("native-hook", 199, 100, now - 200);
    old.effectiveMode = old.source.expectedMode = "bypass";
    old.digest = "b".repeat(64);
    const normal = record("native-hook", 300, 400, now - 50);
    normal.source.cwd = layout.plugin;
    normal.source.request = { sessionId: "current", cwd: layout.workspace };
    const router = {
        file: path.join(layout.plugin, "dist", "hooks", "hook-router.js"),
        sha256: "c".repeat(64),
    };
    const getter = {
        ProcessId: 200,
        ParentProcessId: 100,
        ExecutablePath: process.execPath,
        script: router.file,
        scriptHash: router.sha256,
        observedAt: new Date(now - 90).toISOString(),
        provenance: "registered-status-public-spawnSync-result",
    };
    return {
        layout,
        records: [extension, old, current, normal],
        getter,
        router,
    };
}

test("only the actual latest compiled getter joins stock controls, without rewriting other observations", () => {
    const { layout, records, getter, router } = getterControlFixture();
    const before = structuredClone(records);
    const selected = selectNativeWorkiqGetterControls(
        layout,
        records,
        getter,
        router,
        "current",
    );
    assert.deepEqual(selected, [records[0], records[2]]);
    assert.equal(selected[1], records[2]);
    assert.deepEqual(records, before);
    assert.throws(() => assertNativeWorkiqProjection(selected));
});

test("getter role, actual spawn tuple, staged source, chronology and foreign observations reject", () => {
    const mutations = [
        (f) => (f.getter.ProcessId = 999),
        (f) => (f.getter.ParentProcessId = 999),
        (f) => (f.getter.script = "other"),
        (f) => (f.getter.scriptHash = "d".repeat(64)),
        (f) => (f.getter.provenance = "caller"),
        (f) => (f.getter.ExecutablePath = "other"),
        (f) => (f.getter.observedAt = "invalid"),
        (f) =>
            (f.getter.observedAt = new Date(Date.now() + 10000).toISOString()),
        (f) => (f.records[2].source.request = {}),
        (f) => (f.records[1].source.parentPid = 999),
        (f) => (f.records[1].source.owner = "foreign"),
        (f) => (f.records[1].configPath = "foreign"),
        (f) => (f.records[1].source.expectedMode = "direct"),
        (f) =>
            (f.records[1].source.observedAt = new Date(
                Date.parse(f.getter.observedAt) + 1,
            ).toISOString()),
        (f) =>
            (f.records[1].effectiveMode = f.records[1].source.expectedMode =
                "direct"),
        (f) => (f.records[3].source.request.sessionId = "foreign"),
        (f) => (f.records[3].source.request.cwd = "foreign"),
        (f) => (f.records[3].source.cwd = "foreign"),
        (f) => (f.records[3].digest = "d".repeat(64)),
        (f) => f.records.push(structuredClone(f.records[2])),
        (f) => f.records.push(structuredClone(f.records[0])),
    ];
    for (const mutate of mutations) {
        const f = getterControlFixture();
        mutate(f);
        assert.throws(() =>
            selectNativeWorkiqGetterControls(
                f.layout,
                f.records,
                f.getter,
                f.router,
                "current",
            ),
        );
    }
});

test("completed recording joins the current finalized trace without requiring an expired active token", () => {
    const sessionId = randomUUID();
    const summary = {
        traceId: randomUUID(),
        sessionId,
        createdAt: new Date().toISOString(),
        toolCallCount: 4,
    };
    const recording = {
        status: "completed",
        trace: structuredClone(summary),
    };
    assert.equal(
        assertNativeWorkiqCompletedRecording(recording, summary, sessionId),
        undefined,
    );
    assert.throws(() => assertNativeWorkiqProjection(recording));
    for (const key of ["traceId", "sessionId", "createdAt", "toolCallCount"]) {
        const changed = structuredClone(recording);
        changed.trace[key] = key === "toolCallCount" ? 5 : "other";
        assert.throws(
            () =>
                assertNativeWorkiqCompletedRecording(
                    changed,
                    summary,
                    sessionId,
                ),
            /not the actual current recording lease/,
        );
    }
    for (const invalid of [
        { ...recording, status: "armed", token: { sessionId } },
        { ...recording, status: "claimed", token: { sessionId } },
        { ...recording, trace: undefined },
        { ...recording, token: { sessionId: randomUUID() } },
    ])
        assert.throws(
            () =>
                assertNativeWorkiqCompletedRecording(
                    invalid,
                    summary,
                    sessionId,
                ),
            /not the actual current recording lease/,
        );
    const foreign = { ...summary, sessionId: randomUUID() };
    assert.throws(
        () =>
            assertNativeWorkiqCompletedRecording(
                { status: "completed", trace: foreign },
                foreign,
                sessionId,
            ),
        /not the actual current recording lease/,
    );
    assert.throws(
        () =>
            assertNativeWorkiqCompletedRecording(
                { status: "completed", trace: { sessionId } },
                { sessionId },
                sessionId,
            ),
        /not the actual current recording lease/,
    );
});
const tools = ["retrieve", "fetch", "fetch_blob"].map((name) => ({
    advertisedName: name,
    callableName: `workiq-${name}`,
    mcpServerName: "workiq",
    inputSchema: { type: "object", properties: {} },
}));
const inventory = tools.map((tool) => ({
    name: tool.callableName,
    mcpServerName: tool.mcpServerName,
    mcpToolName: tool.advertisedName,
    namespacedName: `${tool.mcpServerName}/${tool.advertisedName}`,
    input_schema: tool.inputSchema,
}));
inventory.push({ name: "task" });

test("actual selected SDK failure stops capture waiting without accepting fixtures as authority", () => {
    const start = {
        id: randomUUID(),
        type: "tool.execution_start",
        data: {
            toolCallId: "selected-call",
            toolName: "workiq-retrieve",
            mcpServerName: "workiq",
            mcpToolName: "retrieve",
        },
    };
    const completion = {
        id: randomUUID(),
        type: "tool.execution_complete",
        data: {
            toolCallId: "selected-call",
            success: false,
            error: {
                code: "failure",
                message: "MCP error -32602: workiqScopeMismatch",
            },
        },
    };
    assert.doesNotThrow(() =>
        assertNativeWorkiqSelectedToolOutcomes([start], tools),
    );
    assert.doesNotThrow(() =>
        assertNativeWorkiqSelectedToolOutcomes(
            [
                start,
                { ...completion, data: { ...completion.data, success: true } },
            ],
            tools,
        ),
    );
    assert.throws(
        () =>
            assertNativeWorkiqSelectedToolOutcomes([start, completion], tools),
        (error) =>
            error.status === "blocked" &&
            error.sdkToolName === "workiq-retrieve" &&
            error.sdkErrorCode === "failure" &&
            error.sdkReasonCode === "workiqScopeMismatch" &&
            error.sdkEventId === completion.id,
    );
    assert.throws(
        () =>
            assertNativeWorkiqSelectedToolOutcomes(
                [
                    {
                        ...start,
                        data: { ...start.data, mcpServerName: "foreign" },
                    },
                    completion,
                ],
                tools,
            ),
        /alias identity drift/,
    );
    assert.doesNotThrow(() =>
        assertNativeWorkiqSelectedToolOutcomes(
            [
                { ...start, data: { ...start.data, toolName: "task" } },
                completion,
            ],
            tools,
        ),
    );
});

test("capture UI wait propagates selected-tool failure instead of waiting for source timeout", async () => {
    let uiChecks = 0;
    const events = [
        {
            type: "tool.execution_start",
            data: {
                toolCallId: "selected-call",
                toolName: "workiq-retrieve",
                mcpServerName: "workiq",
                mcpToolName: "retrieve",
            },
        },
        {
            type: "tool.execution_complete",
            data: { toolCallId: "selected-call", success: false },
        },
    ];
    const runtime = {
        budget: createNativeBudget(config),
        events() {
            assertNativeWorkiqSelectedToolOutcomes(events, tools);
            return events;
        },
        async handleInteraction() {
            uiChecks++;
        },
    };
    await assert.rejects(
        awaitNativeWorkiqWithUi(runtime, {}, new Promise(() => {})),
        /Actual selected WorkIQ SDK tool completion failed/,
    );
    assert.equal(uiChecks, 0);
    assert.doesNotThrow(() => runtime.budget.check());
});

test("pilot source binds the existing phase entity to its gateway before SDK bootstrap", () => {
    const source = fs.readFileSync(
        new URL("../native-workiq-pilot.mjs", import.meta.url),
        "utf8",
    );
    const { ast } = tseslint.parser.parseForESLint(source, {
        sourceType: "module",
        range: true,
    });
    const binding = ast.body.find(
        (node) =>
            node.type === "FunctionDeclaration" &&
            node.id.name === "bindSession",
    );
    assert.ok(binding);
    const gateway =
        binding.body.body[0].declarations[0].init.argument.arguments[0];
    assert.equal(gateway.type, "CallExpression");
    assert.equal(gateway.callee.object.name, "controller");
    assert.equal(gateway.callee.property.name, "startGateway");
    assert.equal(gateway.arguments.length, 1);
    assert.equal(gateway.arguments[0].type, "Identifier");
    assert.equal(gateway.arguments[0].name, "entityKey");
    const body = source.slice(...binding.range);
    const bootstrap = source.indexOf("runtime.openConsole(", binding.range[0]);
    assert.ok(gateway.range[0] < bootstrap && bootstrap < binding.range[1]);
    const guidance = binding.body.body.find((statement) =>
        source
            .slice(...statement.range)
            .includes("controller.assertModelGuidance()"),
    );
    assert.ok(guidance);
    assert.equal(guidance.expression.type, "AwaitExpression");
    const wait = guidance.expression.argument;
    assert.equal(wait.callee.name, "withUi");
    assert.equal(wait.arguments[0].name, "runtime");
    assert.equal(wait.arguments[1].name, "controller");
    assert.equal(wait.arguments[2].callee.property.name, "assertModelGuidance");
    assert.ok(
        guidance.range[0] <
            source.indexOf("runtime.sessionEvents()", binding.range[0]),
    );
    assert.match(body, /controller\.bindTrial\(\s*scope,\s*entityKey,/u);
    assert.doesNotMatch(body, /controller\.startGateway\(\s*\)/u);
});

function startupFixture(t) {
    const home = path.resolve(`.native-workiq-startup-fixture-${randomUUID()}`);
    const sessionId = randomUUID();
    const directory = path.join(home, "session-state", sessionId);
    fs.mkdirSync(directory, { recursive: true });
    fs.mkdirSync(path.join(home, "session-state", ".session-operation-locks"));
    t.after(() => fs.rmSync(home, { recursive: true, force: true }));
    const file = path.join(directory, "events.jsonl");
    const start = (sid = sessionId) => ({
        id: randomUUID(),
        type: "session.start",
        timestamp: new Date().toISOString(),
        data: { sessionId: sid },
    });
    return { home, directory, sessionId, file, start };
}

test("actual startup filesystem waits for missing or partially written events without guessing SID", (t) => {
    const f = startupFixture(t);
    assert.deepEqual(readNativeWorkiqSessionEvents(f.home), []);
    assert.deepEqual(
        readNativeWorkiqSessionEvents(f.home, { sessionId: f.sessionId }),
        [],
    );
    assert.throws(() =>
        readNativeWorkiqSessionEvents(f.home, {
            sessionId: f.sessionId,
            required: true,
        }),
    );
    const start = f.start();
    fs.writeFileSync(f.file, JSON.stringify(start));
    assert.deepEqual(
        readNativeWorkiqSessionEvents(f.home, { sessionId: f.sessionId }),
        [],
    );
    fs.appendFileSync(f.file, "\n");
    assert.deepEqual(readNativeWorkiqSessionEvents(f.home), []);
    assert.throws(() =>
        readNativeWorkiqSessionEvents(f.home, { required: true }),
    );
    assert.deepEqual(
        readNativeWorkiqSessionEvents(f.home, {
            sessionId: f.sessionId,
            required: true,
        }),
        [start],
    );
});

test("bootstrap consent source checker requires current canonical staged and compiled bytes", (t) => {
    const f = startupFixture(t);
    const layout = {
        workspace: path.join(f.home, "workspace"),
        plugin: path.join(f.home, "plugin"),
    };
    fs.mkdirSync(layout.workspace);
    fs.mkdirSync(layout.plugin);
    const file = path.join(layout.plugin, "extension.mjs");
    const compiled = path.join(f.home, "compiled.mjs");
    fs.writeFileSync(file, "current staged bytes");
    fs.writeFileSync(compiled, "current compiled bytes");
    const hash = (value) => createHash("sha256").update(value).digest("hex");
    const staged = [{ file, sha256: hash(fs.readFileSync(file)) }];
    const source = { file: compiled, sha256: hash(fs.readFileSync(compiled)) };
    verifyNativeWorkiqBootstrapArtifacts(layout, staged, source);
    assert.throws(() =>
        verifyNativeWorkiqBootstrapArtifacts(layout, undefined, source),
    );
    fs.writeFileSync(file, "changed staged bytes");
    assert.throws(() =>
        verifyNativeWorkiqBootstrapArtifacts(layout, staged, source),
    );
    fs.writeFileSync(file, "current staged bytes");
    fs.writeFileSync(compiled, "changed compiled bytes");
    assert.throws(() =>
        verifyNativeWorkiqBootstrapArtifacts(layout, staged, source),
    );
});

test("current events still reject ambiguity, foreign source SID and missing final session start", (t) => {
    const f = startupFixture(t);
    fs.writeFileSync(f.file, "");
    assert.throws(
        () =>
            readNativeWorkiqSessionEvents(f.home, {
                sessionId: f.sessionId,
                required: true,
            }),
        /session start is not ready/u,
    );
    fs.writeFileSync(f.file, JSON.stringify(f.start(randomUUID())) + "\n");
    assert.throws(() =>
        readNativeWorkiqSessionEvents(f.home, { sessionId: f.sessionId }),
    );
    fs.writeFileSync(
        f.file,
        [f.start(), f.start()]
            .map((event) => JSON.stringify(event))
            .join("\n") + "\n",
    );
    assert.throws(() =>
        readNativeWorkiqSessionEvents(f.home, { sessionId: f.sessionId }),
    );
    fs.writeFileSync(f.file, JSON.stringify(f.start()) + "\n");
    assert.throws(() =>
        readNativeWorkiqSessionEvents(f.home, { sessionId: randomUUID() }),
    );
    const other = path.join(f.home, "session-state", randomUUID());
    fs.mkdirSync(other);
    fs.writeFileSync(
        path.join(other, "events.jsonl"),
        JSON.stringify(f.start()) + "\n",
    );
    assert.throws(() => readNativeWorkiqSessionEvents(f.home), /ambiguous/u);
});

test("UI polling handles bootstrap consent before deferred metadata/policy/event readiness", async (t) => {
    const f = startupFixture(t);
    const order = [];
    let sourceSid;
    let publishKnown;
    const known = new Promise((resolve) => {
        publishKnown = resolve;
    });
    let initialize;
    const observing = new Promise((resolve) => {
        initialize = resolve;
    });
    const runtime = {
        budget: createNativeBudget({ ...config, maxDurationMs: 3000 }),
        events: () =>
            readNativeWorkiqSessionEvents(f.home, { sessionId: sourceSid }),
        async handleInteraction() {
            if (!sourceSid) {
                const decision = classifyNativeScreen(
                    `Confirm folder trust\n${f.home}\n1. Yes`,
                    f.home,
                    { approve: false, tools: [] },
                );
                assert.equal(decision.reason, "trust owned workspace once");
                assert.equal(fs.existsSync(f.file), false);
                order.push("bootstrap-ui", "source-known");
                sourceSid = f.sessionId;
                publishKnown(sourceSid);
            } else {
                assert.ok(order.includes("policy-bound"));
                assert.deepEqual(runtime.events(), []);
                order.push("observing");
                fs.writeFileSync(f.file, JSON.stringify(f.start()) + "\n");
                initialize();
            }
        },
    };
    assert.equal(
        await awaitNativeWorkiqWithUi(runtime, {}, known),
        f.sessionId,
    );
    assert.equal(fs.existsSync(f.file), false);
    order.push("policy-bound");
    await awaitNativeWorkiqWithUi(runtime, {}, observing);
    assert.equal(
        readNativeWorkiqSessionEvents(f.home, {
            sessionId: sourceSid,
            required: true,
        })[0].data.sessionId,
        f.sessionId,
    );
    assert.deepEqual(order, [
        "bootstrap-ui",
        "source-known",
        "policy-bound",
        "observing",
    ]);
});

test("deferred startup polling propagates actual cancellation and explicit deadline", async (t) => {
    const f = startupFixture(t);
    for (const kind of ["cancel", "deadline"]) {
        const abort = new AbortController();
        let clock = 0;
        const runtime = {
            budget: createNativeBudget(
                { ...config, maxDurationMs: 1000 },
                abort.signal,
                () => clock,
            ),
            events: () => readNativeWorkiqSessionEvents(f.home),
            async handleInteraction() {
                if (kind === "cancel") abort.abort();
                else clock = 1001;
            },
        };
        await assert.rejects(
            awaitNativeWorkiqWithUi(runtime, {}, new Promise(() => {})),
            kind === "cancel" ? /cancelled/u : /deadline exceeded/u,
        );
    }
});

test("native caller cancellation stops both actual source readers without cancelling a future console budget", async (t) => {
    const f = startupFixture(t);
    const dataRoot = path.join(f.home, "data");
    fs.mkdirSync(dataRoot);
    const owner = randomUUID();
    fs.writeFileSync(
        path.join(f.home, "evaluation-owner.json"),
        JSON.stringify({ owner }),
    );
    for (const reader of [
        awaitWorkiqNativeSession,
        awaitWorkiqFinalizedCapture,
    ]) {
        const caller = new AbortController();
        const consoleAbort = new AbortController();
        const context = {
            ownedRoot: f.home,
            dataRoot,
            owner,
            configPath: path.join(f.home, "plugin-data", "config.json"),
            deadlineMs: Date.now() + 3000,
            sessionId: f.sessionId,
            runId: randomUUID(),
            signal: AbortSignal.any([caller.signal, consoleAbort.signal]),
        };
        const runtime = {
            budget: createNativeBudget(
                { ...config, maxDurationMs: 3000 },
                caller.signal,
            ),
            events: () => readNativeWorkiqSessionEvents(f.home),
            async handleInteraction() {
                consoleAbort.abort(new Error("owned console closed"));
            },
        };
        await assert.rejects(
            awaitNativeWorkiqWithUi(runtime, {}, reader(context)),
            { name: "AbortError" },
        );
        assert.equal(caller.signal.aborted, false);
        assert.equal(consoleAbort.signal.aborted, true);
        assert.doesNotThrow(() => runtime.budget.check());
    }
});

test("not-ready startup cannot approve MCP reads, authentication or appended unknown questions", async (t) => {
    const f = startupFixture(t);
    for (const screen of [
        "Do you want to use this tool?\nworkiq-fetch {}\n1. Yes\n3. No",
        "Please authenticate",
        "Approval of a saved macro does not grant tool permissions.\nWould you like to permit an unknown tool?",
    ]) {
        const runtime = {
            budget: createNativeBudget({ ...config, maxDurationMs: 1000 }),
            events: () => readNativeWorkiqSessionEvents(f.home),
            async handleInteraction() {
                classifyNativeScreen(screen, f.home, {
                    approve: false,
                    tools: [],
                });
            },
        };
        await assert.rejects(
            awaitNativeWorkiqWithUi(runtime, {}, new Promise(() => {})),
        );
    }
});

test("console uses exactly the complete documented overlay, not service or inherited variables", () => {
    const layout = {
        pluginData: path.resolve("private-plugin"),
        data: path.resolve("private-data"),
        instance: "macro-eval-owned",
    };
    const home = path.resolve("private-home");
    assert.deepEqual(nativeWorkiqConsoleEnvironment(layout, config, home), {
        TYPEAGENT_HOST: "127.0.0.1",
        TYPEAGENT_PORT: String(config.port),
        CLAUDE_PLUGIN_DATA: layout.pluginData,
        TYPEAGENT_USER_DATA_DIR: layout.data,
        COPILOT_HOME: home,
        INSTANCE_NAME: layout.instance,
        TYPEAGENT_MACRO_RECORDING_ENABLED: "true",
        TYPEAGENT_MACRO_INDUCTION_ENABLED: "true",
        TYPEAGENT_MACRO_REPLAY_ENABLED: "true",
        TYPEAGENT_MACRO_AGENT_HANDOFF_ENABLED: "true",
    });
});

test("optional signal resolves to the actual AbortSignal required by service bootstrap", () => {
    const signal = resolveNativeWorkiqSignal();
    assert.ok(signal instanceof AbortSignal);
    assert.doesNotThrow(() => signal.throwIfAborted());
    const controller = new AbortController();
    assert.equal(
        resolveNativeWorkiqSignal(controller.signal),
        controller.signal,
    );
    controller.abort(new Error("owned cancellation"));
    assert.throws(
        () => resolveNativeWorkiqSignal(controller.signal).throwIfAborted(),
        /owned cancellation/u,
    );
    assert.throws(() => resolveNativeWorkiqSignal({ aborted: false }));
});

test("initial and reset control admission bind the exact private WorkIQ opt-in without granting tools", () => {
    const layout = {
        owner: "actual-owned-native-run",
        run: path.resolve("private-run"),
    };
    const configPath = path.resolve(
        "private-run",
        "plugin-data",
        "config.json",
    );
    const expected = {
        owner: layout.owner,
        ownedRoot: layout.run,
        configPath,
        expectedMode: "bypass",
        diagnosticTransitions: true,
        workiqOriginals: {
            schemaVersion: 1,
            kind: "workiq-native-capture-opt-in-v1",
            exposureOverride: "user-authorized-unverified-model-exposure",
        },
    };
    const first = nativeWorkiqControlAdmission(layout, configPath);
    assert.deepEqual(first, expected);
    first.workiqOriginals.exposureOverride = "unowned";
    assert.deepEqual(
        nativeWorkiqControlAdmission(layout, configPath),
        expected,
    );
});

test("native WorkIQ bounds remain explicit and fail closed", () => {
    validateWorkiqNativeRuntimeConfig(config);
    for (const patch of [
        { maxTargetModelTurns: 21 },
        { maxDurationMs: 300001 },
        { exposureOverride: true },
        { extensionMode: "all" },
        { port: 0 },
        { cliExecutable: "copilot" },
        { cliExecutableSha256: "not-a-sha256" },
    ])
        assert.throws(() =>
            validateWorkiqNativeRuntimeConfig({ ...config, ...patch }),
        );
});

test("cached runtime recovery retains exact admitted executable bytes rather than repinning by version", () => {
    const pinned = { ...config, cliExecutableSha256: "3".repeat(64) };
    validateWorkiqNativeRuntimeConfig(pinned);
    const frozen = {
        executable: pinned.cliExecutable,
        resolvedExecutable: pinned.cliExecutable,
        sha256: pinned.cliExecutableSha256,
    };
    verifyNativeWorkiqExecutablePin(pinned, frozen);
    assert.throws(() =>
        verifyNativeWorkiqExecutablePin(pinned, {
            ...frozen,
            sha256: "6".repeat(64),
        }),
    );
    assert.throws(() =>
        verifyNativeWorkiqExecutablePin(pinned, {
            ...frozen,
            executable: path.resolve("different-cache-companion"),
        }),
    );
});

test("native constructor configuration cannot be mutated through caller aliases", () => {
    const caller = structuredClone(config);
    const snapshot = snapshotNativeWorkiqRuntimeConfig(caller);
    caller.port = 9999;
    caller.maxDurationMs = 9999999;
    caller.exposureOverride = "allow-everything";
    assert.equal(snapshot.port, config.port);
    assert.equal(snapshot.maxDurationMs, 300000);
    assert.equal(snapshot.exposureOverride, config.exposureOverride);
    assert.ok(Object.isFrozen(snapshot));
    assert.throws(() => {
        snapshot.maxTargetModelTurns = 999;
    });
});

test("current exact three WorkIQ schemas plus builtin task are required", () => {
    verifyWorkiqSdkToolInventory(inventory, { tools });
    for (const mutate of [
        (items) => items.push({ name: "shell" }),
        (items) => {
            items[0].mcpToolName = "fetch";
        },
        (items) => {
            items[0].input_schema = { type: "string" };
        },
        (items) => {
            items[3].mcpServerName = "forged";
        },
    ]) {
        const changed = structuredClone(inventory);
        mutate(changed);
        assert.throws(() => verifyWorkiqSdkToolInventory(changed, { tools }));
    }
});

test("public objects cannot mint runtime, evidence or projection authority", () => {
    assert.throws(() => createNativeWorkiqHostAssertions({}, null));
    assert.throws(() => createNativeWorkiqHostAssertions({}, {}));
    assert.throws(() => createNativeWorkiqEvidenceBoundary({}, {}));
    assert.throws(() =>
        assertNativeWorkiqProjection(
            Object.freeze({
                admission: true,
                sessionId: "actual-looking",
                runIdentityKind: "controller-trial-lease",
            }),
        ),
    );
});

test("live entry rejects admission drift before creating a native runtime or launching", async () => {
    for (const run of [runNativeWorkiqPilot, runNativeWorkiqLookupDiagnostic])
        await assert.rejects(
            run({
                output: path.resolve("unused-native-output"),
                config,
                admissionFile: fileURLToPath(import.meta.url),
                admissionSha256: "0".repeat(64),
            }),
            /Frozen WorkIQ admission bytes changed/u,
        );
});

test("hash-pinned invalid admission cannot create runtime files or launch before contract validation", async (t) => {
    const file = path.resolve(
        `.native-workiq-invalid-admission-${randomUUID()}.json`,
    );
    const output = path.resolve(`.native-workiq-unlaunched-${randomUUID()}`);
    const bytes = Buffer.from(
        JSON.stringify({
            schemaVersion: 2,
            evaluationContract: { kind: "workiq-macro-correctness-v2" },
        }),
    );
    fs.writeFileSync(file, bytes);
    t.after(() => fs.rmSync(file, { force: true }));
    for (const run of [runNativeWorkiqPilot, runNativeWorkiqLookupDiagnostic])
        await assert.rejects(
            run({
                output,
                config,
                admissionFile: file,
                admissionSha256: createHash("sha256")
                    .update(bytes)
                    .digest("hex"),
            }),
            { name: "WorkiqEvidenceError" },
        );
    assert.equal(fs.existsSync(output), false);
});

test("lookup-only scheduling retains the one actual SDK request/outcome without granting authority", () => {
    const start = {
        type: "tool.execution_start",
        data: {
            toolName: "workiq-retrieve",
            toolCallId: "first",
            arguments: {},
        },
    };
    const completion = {
        type: "tool.execution_complete",
        data: { toolCallId: "first", success: true },
    };
    assert.equal(nativeWorkiqLookupOutcome([], "workiq-retrieve"), undefined);
    assert.equal(
        nativeWorkiqLookupOutcome([start], "workiq-retrieve"),
        undefined,
    );
    const outcome = nativeWorkiqLookupOutcome(
        [start, completion],
        "workiq-retrieve",
    );
    assert.equal(outcome.start, start);
    assert.equal(outcome.completion, completion);
    assert.throws(() => assertNativeWorkiqProjection(outcome));
    completion.data.success = false;
    assert.equal(
        nativeWorkiqLookupOutcome([start, completion], "workiq-retrieve")
            .completion.data.success,
        false,
    );
});

test("lookup-only scheduling rejects additional, delegated, malformed or unjoined SDK observations", () => {
    const start = {
        type: "tool.execution_start",
        data: { toolName: "workiq-retrieve", toolCallId: "first" },
    };
    const completion = {
        type: "tool.execution_complete",
        data: { toolCallId: "first", success: true },
    };
    for (const events of [
        [completion],
        [completion, start],
        [start, start],
        [start, completion, completion],
        [start, { type: "subagent.started", data: {} }],
        [{ ...start, data: { ...start.data, toolName: "task" } }],
        [{ ...start, data: { ...start.data, toolName: "workiq-fetch" } }],
        [{ ...start, data: { ...start.data, toolCallId: "" } }],
        [start, { ...completion, data: { toolCallId: "first" } }],
        [
            start,
            {
                ...completion,
                data: { ...completion.data, toolCallId: "other" },
            },
        ],
    ])
        assert.throws(() =>
            nativeWorkiqLookupOutcome(events, "workiq-retrieve"),
        );
});

test("lookup diagnostic observation cancels immediately without leaving a polling loop after stop", async () => {
    const controller = new AbortController();
    let observations = 0;
    const pending = awaitNativeWorkiqLookupOutcome(
        {
            events: () => {
                observations++;
                return [];
            },
        },
        "workiq-retrieve",
        0,
        controller.signal,
    );
    controller.abort();
    await assert.rejects(pending, { name: "AbortError" });
    assert.equal(observations, 1);
});

test("lookup diagnostic quota and physical source audits never mint admission and reject tampering", (t) => {
    const fixture = path.resolve(
        `.native-lookup-audit-negative-${randomUUID()}`,
    );
    const root = path.join(fixture, "owned");
    fs.mkdirSync(root, { recursive: true });
    t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
    const auditPath = path.join(root, "call-0.json");
    const outside = path.join(fixture, "outside.json");
    const bytes = Buffer.from('{"status":"completed"}\n');
    fs.writeFileSync(auditPath, bytes);
    fs.writeFileSync(outside, bytes);
    const scope = {
        ownerId: "owned",
        sessionId: "current",
        runId: "one",
        phase: "capture-a",
    };
    const evidence = {
        kind: "workiq-identical-frozen-lookup-diagnostic-evidence-v1",
        scope,
        maxUpstreamReads: 1,
        upstreamReadsStarted: 1,
        firstRead: {
            auditPath,
            auditSha256: createHash("sha256").update(bytes).digest("hex"),
        },
        rejections: [],
        admission: false,
        nativeAuthority: false,
    };
    assert.equal(
        verifyNativeWorkiqLookupDiagnosticEvidence(root, scope, evidence),
        undefined,
    );
    assert.throws(() => assertNativeWorkiqProjection(evidence));
    for (const mutate of [
        (e) => (e.kind = "caller"),
        (e) => (e.admission = true),
        (e) => (e.nativeAuthority = true),
        (e) => (e.scope.sessionId = "foreign"),
        (e) => (e.maxUpstreamReads = 2),
        (e) => (e.upstreamReadsStarted = 2),
        (e) => (e.upstreamReadsStarted = -1),
        (e) => (e.upstreamReadsStarted = 0.5),
        (e) => (e.firstRead = undefined),
        (e) => (e.firstRead.auditSha256 = "0".repeat(64)),
        (e) => (e.firstRead.auditPath = outside),
        (e) =>
            (e.rejections = [
                { auditPath: outside, auditSha256: e.firstRead.auditSha256 },
            ]),
    ]) {
        const changed = structuredClone(evidence);
        mutate(changed);
        assert.throws(() =>
            verifyNativeWorkiqLookupDiagnosticEvidence(root, scope, changed),
        );
    }
});

test("lookup-only driver retains normal source binding and strict failure, without full-pilot operations", () => {
    const source = fs.readFileSync(
        new URL("../native-workiq-pilot.mjs", import.meta.url),
        "utf8",
    );
    const ast = tseslint.parser.parseForESLint(source, {
        sourceType: "module",
        range: true,
    }).ast;
    const declaration = ast.body.find(
        (node) =>
            node.type === "ExportNamedDeclaration" &&
            node.declaration?.id?.name === "runNativeWorkiqLookupDiagnostic",
    ).declaration;
    const body = source.slice(...declaration.range);
    assert.match(body, /createNativeWorkiqRuntime/u);
    assert.match(body, /lookupOnlyDiagnostic:\s*true/u);
    assert.match(body, /await bindSession\(/u);
    assert.match(body, /runtime\.submit\(entity\.prompt\)/u);
    assert.match(body, /runtime\.learningPreference\("off"\)/u);
    assert.match(body, /runtime\.armRecording\("off"\)/u);
    assert.match(body, /assertNativeWorkiqLookupRecordingArm\(/u);
    assert.match(body, /runtime\.cancelRecording\(\)/u);
    assert.match(body, /runtime\.sessionSource\(true\)/u);
    assert.match(body, /controller\.lookupDiagnosticEvidence\(\)/u);
    assert.match(body, /runtime\.verifyCleanup\(\)/u);
    assert.match(body, /observationAbort\.abort\(\)/u);
    assert.doesNotMatch(
        body,
        /finalizedCapture|documentTrial|reviewPublication|verifyCompletedTrial|\.approve\(|\.prepare\(/u,
    );
});

test("lookup diagnostic rejects foreign, expired, claimed or learning-enabled arm tokens", () => {
    const now = Date.now();
    const token = {
        id: "actual-api-token",
        sessionId: "current-sid",
        status: "armed",
        expiresAt: new Date(now + 10000).toISOString(),
    };
    assertNativeWorkiqLookupRecordingArm(token, "current-sid", now);
    assertNativeWorkiqLookupRecordingArm(
        { ...token, learning: false },
        "current-sid",
        now,
    );
    for (const change of [
        { id: "" },
        { sessionId: "foreign" },
        { status: "claimed" },
        { learning: true },
        { learning: "off" },
        { expiresAt: new Date(now).toISOString() },
        { expiresAt: "invalid" },
    ])
        assert.throws(() =>
            assertNativeWorkiqLookupRecordingArm(
                { ...token, ...change },
                "current-sid",
                now,
            ),
        );
    assert.throws(() =>
        createNativeWorkiqHostAssertions(token, { sessionId: "current-sid" }),
    );
});

function lifecycleSourceFunction(
    name,
    context,
    url = new URL("../native-workiq-lifecycle.mjs", import.meta.url),
) {
    const source = fs.readFileSync(url, "utf8");
    const ast = tseslint.parser.parseForESLint(source, {
        sourceType: "module",
        range: true,
    }).ast;
    let found;
    function visit(node) {
        if (!node || typeof node !== "object") return;
        if (node.type === "FunctionDeclaration" && node.id?.name === name)
            found = node;
        if (
            node.type === "Property" &&
            node.key?.name === name &&
            ["ArrowFunctionExpression", "FunctionExpression"].includes(
                node.value?.type,
            )
        )
            found = node.value;
        for (const value of Object.values(node))
            if (Array.isArray(value)) value.forEach(visit);
            else if (value && typeof value === "object") visit(value);
    }
    visit(ast);
    assert.ok(found);
    return vm.runInNewContext(`(${source.slice(...found.range)})`, context);
}

function recordingArmFixture(mode = "prepare") {
    const layout = {
        workspace: path.resolve("owned", "workspace"),
        run: "owned",
    };
    const preference = { mode, cwd: layout.workspace.toLowerCase() };
    const state = {
        lease: { sessionId: "owned-current" },
        consoleAllocations: [{ index: 0 }],
        connection: {},
    };
    const calls = [];
    const requireNative = (condition, message) => assert.ok(condition, message);
    const context = {
        state,
        layout,
        path,
        budget: { run: async (value) => value, remaining: () => 123456 },
        requireNative,
        write: (_file, value) => calls.push({ receipt: value }),
    };
    context.assertNativeWorkiqRecordingToken = lifecycleSourceFunction(
        "assertNativeWorkiqRecordingToken",
        { requireNative },
    );
    state.connection.getMacroLearningPreference = async (cwd) => {
        calls.push({ preferenceCwd: cwd });
        return preference;
    };
    state.connection.armMacroRecording = async (request) => {
        calls.push({ request });
        return {
            status: "armed",
            sessionId: request.sessionId,
            ...(request.learning === true
                ? { learning: true, cwd: request.cwd }
                : {}),
        };
    };
    return { context, state, layout, preference, calls };
}

test("native prepare caller sends the actual boolean API contract and verifies the returned retained token before prompt", async () => {
    const f = recordingArmFixture();
    const token = await lifecycleSourceFunction(
        "armRecording",
        f.context,
    )("prepare");
    const request = f.calls.find((call) => call.request).request;
    assert.equal(request.learning, true);
    assert.equal(token.learning, true);
    assert.equal(token.cwd, f.layout.workspace);
    assert.equal(request.ttlMs, 123456);
    assert.equal(f.state.recordingLearning, "prepare");
    assert.equal(f.calls[0].preferenceCwd, f.layout.workspace);
    assert.equal(f.calls.at(-1).receipt.token, token);
    const source = fs.readFileSync(
        path.resolve(
            path.dirname(fileURLToPath(import.meta.url)),
            "..",
            "..",
            "..",
            "copilot-macros",
            "src",
            "macroManager.ts",
        ),
        "utf8",
    );
    const ast = tseslint.parser.parseForESLint(source, {
        range: true,
        sourceType: "module",
    }).ast;
    const declaration = ast.body.find(
        (node) =>
            node.type === "ExportNamedDeclaration" &&
            node.declaration?.type === "ClassDeclaration" &&
            node.declaration.id.name === "MacroManager",
    ).declaration;
    const method = declaration.body.body.find(
        (node) => node.key?.name === "armRecording",
    );
    const annotations = [];
    function collect(node) {
        if (!node || typeof node !== "object") return;
        if (node.type === "TSTypeAnnotation") annotations.push(node.range);
        for (const value of Object.values(node))
            if (Array.isArray(value)) value.forEach(collect);
            else if (value && typeof value === "object") collect(value);
    }
    collect(method.value);
    let body = source.slice(...method.value.range);
    for (const [start, end] of annotations.sort((a, b) => b[0] - a[0]))
        body =
            body.slice(0, start - method.value.range[0]) +
            body.slice(end - method.value.range[0]);
    body = "function actualArm" + body;
    const arm = vm.runInNewContext(body + "\nactualArm", { randomUUID });
    let selected = 0;
    const manager = {
        learning: {
            assertSelected: (cwd) => {
                assert.equal(cwd, request.cwd);
                selected++;
            },
        },
        removeExpired: () => {},
        recordings: new Map(),
        completed: new Map(),
        failures: new Map(),
    };
    const actual = arm.call(manager, request);
    assert.equal(actual.learning, true);
    assert.equal(actual.cwd, request.cwd);
    assert.equal(selected, 1);
    manager.recordings.clear();
    const historical = arm.call(manager, { ...request, learning: "prepare" });
    assert.equal(historical.learning, undefined);
    assert.equal(historical.cwd, undefined);
    assert.equal(selected, 1);
});

test("normal B and diagnostic off use boolean false; unknown inputs and preference conflicts fail before arm", async () => {
    const f = recordingArmFixture("off");
    const arm = lifecycleSourceFunction("armRecording", f.context);
    const token = await arm("off");
    assert.equal(f.calls.find((call) => call.request).request.learning, false);
    assert.equal(token.learning, undefined);
    for (const invalid of [
        undefined,
        null,
        false,
        true,
        "",
        "true",
        "read-only",
        "all",
    ]) {
        const before = f.calls.length;
        await assert.rejects(arm(invalid), /prepare or off/u);
        assert.equal(f.calls.length, before);
    }
    for (const mutation of [
        { mode: "prepare" },
        { cwd: "foreign" },
        { mode: undefined },
    ]) {
        const bad = recordingArmFixture("off");
        Object.assign(bad.preference, mutation);
        await assert.rejects(
            lifecycleSourceFunction("armRecording", bad.context)("off"),
            /preference\/workspace disagrees/u,
        );
        assert.equal(
            bad.calls.some((call) => call.request),
            false,
        );
    }
});

test("prepare/off returned missing, string, contradictory or foreign tokens never admit a live prompt", async () => {
    for (const [mode, mutations] of [
        [
            "prepare",
            [
                undefined,
                { learning: undefined },
                { learning: false },
                { learning: "prepare" },
                { cwd: undefined },
                { cwd: "foreign" },
                { sessionId: "foreign" },
                { status: "completed" },
            ],
        ],
        ["off", [{ learning: true }, { learning: "off" }, { learning: null }]],
    ])
        for (const mutation of mutations) {
            const f = recordingArmFixture(mode);
            f.state.connection.armMacroRecording = async (request) =>
                mutation === undefined
                    ? undefined
                    : {
                          status: "armed",
                          sessionId: request.sessionId,
                          ...(mode === "prepare"
                              ? { learning: true, cwd: request.cwd }
                              : {}),
                          ...mutation,
                      };
            await assert.rejects(
                lifecycleSourceFunction("armRecording", f.context)(mode),
                /boolean learning\/workspace contract/u,
            );
            assert.equal(f.state.recordingLearning, undefined);
            assert.equal(
                f.calls.some((call) => call.receipt),
                false,
            );
        }
});

test("missing finalized Prepare linkage fails immediately; foreign or contradictory jobs cannot be rescued", () => {
    const check = lifecycleSourceFunction(
        "assertNativeWorkiqPrepareRecording",
        {
            path,
            requireNative: (condition, message) =>
                assert.ok(condition, message),
        },
    );
    const completedSummary = {
        traceId: "source-trace",
        sessionId: "source-session",
        createdAt: "2026-01-01T00:00:00.000Z",
        toolCallCount: 4,
    };
    assert.throws(
        () =>
            check(
                { status: "completed", trace: completedSummary },
                completedSummary,
                "owned",
            ),
        /no matching source learning job/u,
    );
    const workspace = path.resolve("owned", "workspace");
    const summary = { ...completedSummary, learningJobId: "source-job" };
    const job = {
        jobId: "source-job",
        traceId: summary.traceId,
        sessionId: summary.sessionId,
        mode: "prepare",
        cwd: workspace.toLowerCase(),
    };
    check({ learningJob: job }, summary, workspace);
    for (const mutation of [
        { jobId: "foreign" },
        { traceId: "foreign" },
        { sessionId: "foreign" },
        { mode: "off" },
        { cwd: "foreign" },
    ])
        assert.throws(
            () =>
                check(
                    { learningJob: { ...job, ...mutation } },
                    summary,
                    workspace,
                ),
            /no matching source learning job/u,
        );
    const source = fs.readFileSync(
        path.resolve(
            path.dirname(fileURLToPath(import.meta.url)),
            "..",
            "native-workiq-lifecycle.mjs",
        ),
        "utf8",
    );
    assert.match(
        source,
        /if \(state\.recordingLearning === "prepare"\)\s+assertNativeWorkiqPrepareRecording/u,
    );
});

test("owned shutdown retains only explicit absence-race receipts and rejects invalid or surviving identities", () => {
    const actor = {
        ProcessId: 123,
        StartedMs: 456,
        ExecutablePath: "owned.exe",
    };
    const context = {
        requireNative: (condition, message) => assert.ok(condition, message),
        identityMatches: (left, right) =>
            left.ProcessId === right.ProcessId &&
            left.StartedMs === right.StartedMs &&
            left.ExecutablePath === right.ExecutablePath,
        processTree: () => [],
        execFileSync: (_exe, argv) => {
            const command = argv.at(-1);
            assert.match(command, /\$handle=\$held\.Handle/u);
            assert.match(command, /NoProcessFoundForGivenId/u);
            assert.match(command, /if\(\$after\)\{throw\}/u);
            assert.match(command, /held process identity changed/u);
            assert.match(
                command,
                /Stop-Process -Id 123 -Force -ErrorAction Stop/u,
            );
            return JSON.stringify({
                ...actor,
                status: "exitedBeforeStop",
                originalErrorId:
                    "NoProcessFoundForGivenId,Microsoft.PowerShell.Commands.StopProcessCommand",
            });
        },
    };
    const stop = () =>
        lifecycleSourceFunction("stopOwnedIdentities", context)([actor]);
    assert.equal(stop()[0].status, "exitedBeforeStop");
    context.processTree = () => [actor];
    assert.throws(stop, /survived shutdown/u);
    context.processTree = () => [];
    for (const mutation of [
        { StartedMs: 457 },
        { ExecutablePath: "foreign" },
        { status: "unknown" },
    ]) {
        context.execFileSync = () =>
            JSON.stringify({ ...actor, status: "stopped", ...mutation });
        assert.throws(stop, /disposition is invalid/u);
    }
    const genuine = new Error("Access denied");
    context.execFileSync = () => {
        throw genuine;
    };
    assert.throws(stop, (error) => error === genuine);
});

test(
    "actual owned OS shutdown rejects PID reuse and preserves exact exited-before-stop errors without touching foreign actors",
    { skip: process.platform !== "win32" },
    async (t) => {
        const child = spawn(
            process.execPath,
            ["-e", "setInterval(()=>{},1000)"],
            { windowsHide: true, stdio: "ignore" },
        );
        t.after(() => child.kill());
        const actor = processTree(child.pid).find(
            (row) => row.ProcessId === child.pid,
        );
        assert.ok(actor);
        const context = {
            requireNative: (condition, message) =>
                assert.ok(condition, message),
            identityMatches: (left, right) =>
                left?.ProcessId === right.ProcessId &&
                left.StartedMs === right.StartedMs &&
                left.ExecutablePath === right.ExecutablePath,
            processTree,
            execFileSync,
        };
        const stop = lifecycleSourceFunction("stopOwnedIdentities", context);
        assert.throws(
            () => stop([{ ...actor, StartedMs: actor.StartedMs - 1 }]),
            /Command failed/u,
        );
        assert.ok(
            processTree(child.pid).some(
                (row) => row.StartedMs === actor.StartedMs,
            ),
        );
        context.execFileSync = (exe, args, options) =>
            execFileSync(
                exe,
                args.map((arg) =>
                    arg.replace(
                        `$held=Get-Process -Id ${actor.ProcessId} -ErrorAction Stop;`,
                        `Stop-Process -Id ${actor.ProcessId} -Force -ErrorAction Stop; ` +
                            `$until=[DateTimeOffset]::Now.AddSeconds(5); do { Start-Sleep -Milliseconds 20; ` +
                            `$pending=Get-CimInstance Win32_Process -Filter $filter -ErrorAction Stop } ` +
                            `while($pending -and [DateTimeOffset]::Now -lt $until); ` +
                            `$held=Get-Process -Id ${actor.ProcessId} -ErrorAction Stop;`,
                    ),
                ),
                options,
            );
        const raced = lifecycleSourceFunction(
            "stopOwnedIdentities",
            context,
        )([actor])[0];
        assert.equal(raced.status, "exitedBeforeStop");
        assert.match(raced.originalErrorId, /^NoProcessFoundForGivenId,/u);
        assert.ok(raced.originalError);
        assert.equal(
            processTree(child.pid).some((row) => row.ProcessId === child.pid),
            false,
        );
        context.execFileSync = execFileSync;
        assert.equal(
            lifecycleSourceFunction("stopOwnedIdentities", context)([actor])[0]
                .status,
            "alreadyAbsent",
        );
    },
);

test(
    "actual owned PowerShell receiver role uses its own exact executable/lifetime and stops without the protected reader race",
    { skip: process.platform !== "win32" },
    async (t) => {
        const child = spawn(
            "powershell.exe",
            ["-NoProfile", "-Command", ". $PROFILE; Start-Sleep -Seconds 60"],
            { windowsHide: true, stdio: "ignore" },
        );
        t.after(() => child.kill());
        const actor = processTree(child.pid).find(
            (row) => row.ProcessId === child.pid,
        );
        assert.ok(actor);
        assert.match(
            actor.ExecutablePath,
            /\\WindowsPowerShell\\v1\.0\\powershell\.exe$/iu,
        );
        const stop = lifecycleSourceFunction("stopOwnedIdentities", {
            requireNative: (condition, message) =>
                assert.ok(condition, message),
            identityMatches: (left, right) =>
                left?.ProcessId === right.ProcessId &&
                left.StartedMs === right.StartedMs &&
                left.ExecutablePath === right.ExecutablePath,
            processTree,
            execFileSync,
        });
        assert.equal(stop([actor])[0].status, "stopped");
        assert.equal(
            processTree(child.pid).some((row) => row.ProcessId === child.pid),
            false,
        );
    },
);

function mcpActorSelectionFixture() {
    const f = getterControlFixture();
    f.layout.instance = "macro-eval-owned";
    f.layout.port = 20497;
    const now = Date.now();
    const cli = {
        ProcessId: 10,
        ParentProcessId: 9,
        StartedMs: now - 900,
        ExecutablePath: "copilot.exe",
    };
    const roles = {
        "mcp-agent": [],
        "mcp-workspace": ["--workspace"],
        "mcp-macros": ["--macros"],
        "mcp-skills": ["--skills"],
    };
    const script = path.join(f.layout.plugin, "dist", "mcp", "server.js");
    const records = [],
        actors = [];
    Object.entries(roles).forEach(([component, flags], index) => {
        const base = {
            effectiveMode: "direct",
            configPath: path.join(f.layout.pluginData, "config.json"),
            dataRoot: f.layout.data,
            source: {
                component,
                pid: 1000 + index,
                parentPid: cli.ProcessId,
                executable: process.execPath,
                owner: f.layout.owner,
                config: "CLAUDE_PLUGIN_DATA",
                mode: "config",
                cwd: f.layout.plugin,
                instance: f.layout.instance,
                server: `ws://127.0.0.1:${f.layout.port}`,
                readableOwnedConfig: true,
                expectedConfigPath: path.join(
                    f.layout.pluginData,
                    "config.json",
                ),
                expectedMode: "direct",
                routing: "delegate",
                request: null,
                observedAt: new Date(now - 100).toISOString(),
            },
        };
        const digest = (r) =>
            createHash("sha256")
                .update(
                    JSON.stringify({
                        configPath: r.configPath,
                        dataRoot: r.dataRoot,
                        effectiveMode: r.effectiveMode,
                        mcpRouting: r.source.routing,
                    }),
                )
                .digest("hex");
        base.digest = digest(base);
        const old = structuredClone(base);
        old.source.pid += 100;
        old.effectiveMode = old.source.expectedMode = "bypass";
        old.source.observedAt = new Date(now - 600).toISOString();
        old.digest = digest(old);
        records.push(old, base);
        actors.push({
            ProcessId: base.source.pid,
            ParentProcessId: cli.ProcessId,
            StartedMs: now - 300,
            ExecutablePath: process.execPath,
            CommandLine: [process.execPath, script, ...flags]
                .map((arg) => `"${arg}"`)
                .join(" "),
        });
    });
    const snapshot = {
        cli,
        actors,
        tree: [cli, ...actors],
        observedAtMs: now,
        serverScript: script,
        nodeExecutable: process.execPath,
        roleArgs: Object.fromEntries(
            Object.entries(roles).map(([role, flags]) => [
                role,
                [script, ...flags],
            ]),
        ),
        configDigest: records[1].digest,
        effectiveMode: "direct",
    };
    return { layout: f.layout, records, snapshot, roles };
}

function isolatedMcpSelector(f) {
    const authority = new WeakSet([f.snapshot]);
    const context = {
        path,
        hash: (bytes) => createHash("sha256").update(bytes).digest("hex"),
        requireNative: (condition, message) => assert.ok(condition, message),
        nativeMcpRoles: f.roles,
        nativeControlActorSnapshots: authority,
        identityMatches: (left, right) =>
            left?.ProcessId === right?.ProcessId &&
            left?.StartedMs === right?.StartedMs &&
            left?.ExecutablePath === right?.ExecutablePath,
    };
    context.matchesNativeCommandLine = lifecycleSourceFunction(
        "matchesNativeCommandLine",
        context,
    );
    context.matchesCurrentMcpControlSource = lifecycleSourceFunction(
        "matchesCurrentMcpControlSource",
        context,
    );
    context.validateMcpControlObservation = lifecycleSourceFunction(
        "validateMcpControlObservation",
        context,
    );
    return lifecycleSourceFunction(
        "selectNativeWorkiqCurrentMcpControls",
        context,
    );
}

test("current MCP selection uses each actual actor tuple/argv, retains old observations and cannot mint serialized authority", () => {
    const f = mcpActorSelectionFixture(),
        before = structuredClone(f.records);
    const result = isolatedMcpSelector(f)(
        f.layout,
        f.records.toReversed(),
        f.snapshot,
    );
    assert.equal(result.selected.length, 4);
    assert.equal(result.historical.length, 4);
    assert.ok(
        result.selected.every((r) =>
            f.snapshot.actors.some((a) => a.ProcessId === r.source.pid),
        ),
    );
    assert.deepEqual(f.records, before);
    assert.throws(
        () =>
            selectNativeWorkiqCurrentMcpControls(
                f.layout,
                f.records,
                f.snapshot,
            ),
        /private source-owned OS\/SDK authority/u,
    );
    assert.throws(() =>
        selectNativeWorkiqCurrentMcpControls(
            f.layout,
            f.records,
            JSON.parse(JSON.stringify(f.snapshot)),
        ),
    );
    assert.throws(() => assertNativeWorkiqProjection(result));
    const opposite = mcpActorSelectionFixture();
    for (const r of opposite.records) {
        r.effectiveMode = r.source.expectedMode =
            r.effectiveMode === "direct" ? "bypass" : "direct";
        r.digest = createHash("sha256")
            .update(
                JSON.stringify({
                    configPath: r.configPath,
                    dataRoot: r.dataRoot,
                    effectiveMode: r.effectiveMode,
                    mcpRouting: r.source.routing,
                }),
            )
            .digest("hex");
    }
    opposite.snapshot.effectiveMode = "bypass";
    opposite.snapshot.configDigest = opposite.records[1].digest;
    assert.ok(
        isolatedMcpSelector(opposite)(
            opposite.layout,
            opposite.records,
            opposite.snapshot,
        ).selected.every((r) => r.effectiveMode === "bypass"),
    );
});

test("MCP current missing/ambiguous actors, role argv, PID reuse, conflicts and forged chronology fail closed", () => {
    const mutations = [
        (f) => f.snapshot.actors.pop(),
        (f) => f.records.push(structuredClone(f.records[1])),
        (f) => f.snapshot.tree.splice(1, 1),
        (f) => (f.snapshot.actors[0].StartedMs = Date.now() + 1),
        (f) => (f.snapshot.actors[0].StartedMs = f.snapshot.cli.StartedMs - 1),
        (f) => (f.snapshot.actors[0].ParentProcessId = 999),
        (f) => (f.snapshot.actors[0].ExecutablePath = "foreign.exe"),
        (f) => (f.snapshot.actors[0].CommandLine += " --workspace"),
        (f) =>
            (f.snapshot.actors[0].CommandLine =
                f.snapshot.actors[0].CommandLine.replace(
                    "server.js",
                    "foreign.js",
                )),
        (f) =>
            (f.snapshot.actors[1].CommandLine =
                f.snapshot.actors[1].CommandLine.replace(
                    "--workspace",
                    "--WORKSPACE",
                )),
        (f) =>
            (f.records[1].source.observedAt = new Date(
                Date.now() + 10000,
            ).toISOString()),
        (f) => (f.records[1].source.observedAt = "invalid"),
        (f) =>
            (f.records[0].source.observedAt = f.records[1].source.observedAt),
        (f) => (f.records[1].source.owner = "foreign"),
        (f) => (f.records[0].source.owner = "foreign"),
        (f) => (f.records[1].source.instance = "foreign"),
        (f) => (f.records[1].source.server = "ws://127.0.0.1:1"),
        (f) => (f.records[1].source.cwd = "foreign"),
        (f) => (f.records[1].configPath = "foreign"),
        (f) => (f.records[1].source.config = "default"),
        (f) => (f.records[1].source.mode = "TYPEAGENT_MODE"),
        (f) => (f.records[1].source.expectedMode = "bypass"),
        (f) => (f.records[1].digest = "f".repeat(64)),
        (f) => (f.snapshot.configDigest = "f".repeat(64)),
        (f) => (f.records[1].source.component = "mcp-unknown"),
        (f) => {
            const reused = {
                ...f.snapshot.actors[0],
                ProcessId: f.records[0].source.pid,
                StartedMs: Date.now(),
            };
            f.snapshot.actors.push(reused);
            f.snapshot.tree.push(reused);
        },
    ];
    for (const mutate of mutations) {
        const f = mcpActorSelectionFixture();
        mutate(f);
        assert.throws(() =>
            isolatedMcpSelector(f)(f.layout, f.records, f.snapshot),
        );
    }
});

test("physical MCP snapshot collection rejects serialized SDK authority and replaced native roots before any OS probe", () => {
    const knownSource = { source: { control: {} } };
    const sourceRecords = new WeakSet();
    const state = {
        sourceRecords,
        knownSource,
        console: "owned",
        consoleIdentities: [
            { ProcessId: 1, StartedMs: 10, ExecutablePath: "bridge.exe" },
            { ProcessId: 2, StartedMs: 11, ExecutablePath: "copilot.exe" },
        ],
    };
    const sdk = {
        ProcessId: 3,
        StartedMs: 12,
        ExecutablePath: process.execPath,
    };
    const context = {
        state,
        path,
        budget: { check: () => {} },
        requireNative: (condition, message) => assert.ok(condition, message),
        assertCurrentActor: () => sdk,
        read: () => ({ bridgePid: 1, cliPid: 2 }),
        identityMatches: (left, right) =>
            left?.ProcessId === right?.ProcessId &&
            left?.StartedMs === right?.StartedMs &&
            left?.ExecutablePath === right?.ExecutablePath,
        processTree: () => [
            { ...state.consoleIdentities[0], StartedMs: 99 },
            state.consoleIdentities[1],
            sdk,
        ],
        execFileSync: () => {
            throw new Error(
                "OS probe must not execute without actual SDK/root authority",
            );
        },
    };
    const probe = lifecycleSourceFunction("currentControlActors", context);
    assert.throws(() => probe([], {}), /source-loaded current SDK authority/u);
    sourceRecords.add(knownSource);
    assert.throws(
        () => probe([], {}),
        /exact native bridge\/CLI\/SDK ancestry/u,
    );
    state.knownSource = JSON.parse(JSON.stringify(knownSource));
    assert.throws(() => probe([], {}), /source-loaded current SDK authority/u);
});

test("normal hook caller binds the independently proved workspace/mode/digest and original lease/submission target", () => {
    const digest = "a".repeat(64),
        callback = {};
    const layout = {
        workspace: "D:\\owned\\workspace",
        pluginData: path.resolve("owned", "plugin-data"),
    };
    const submission = {
        prompt: "unchanged admitted prompt",
        submittedAtMs: 100,
        deadlineMs: 200,
        cwd: "foreign",
        mode: "bypass",
        configDigest: "foreign",
    };
    const state = {
        lease: { sessionId: "owned-current" },
        submission,
        reader: {
            bind: (mode, actualDigest) => {
                assert.equal(mode, "direct");
                assert.equal(actualDigest, digest);
                return {
                    read: (target, actualEvents) => {
                        assert.deepEqual(
                            { ...target },
                            {
                                sessionId: "owned-current",
                                prompt: submission.prompt,
                                cwd: layout.workspace,
                                mode: "direct",
                                configDigest: digest,
                                submittedAtMs: 100,
                                deadlineMs: 200,
                            },
                        );
                        assert.equal(actualEvents, events);
                        return callback;
                    },
                };
            },
        },
    };
    state.hookTarget = createNativeWorkiqHookTarget({
        sessionId: state.lease.sessionId,
        prompt: submission.prompt,
        workspace: layout.workspace,
        submittedAtMs: submission.submittedAtMs,
        deadlineMs: submission.deadlineMs,
        mode: "direct",
        configDigest: digest,
    });
    const events = [];
    const context = {
        state,
        layout,
        path,
        read: () => ({ mode: "direct" }),
        stockControlProof: (mode) => {
            assert.equal(mode, "direct");
            return { records: [{ digest }] };
        },
        events: () => events,
        isTrustedNormalHookCallback: (value) => value === callback,
        createNativeWorkiqHookTarget,
        validateNativeWorkiqHookTarget,
        requireNative: (condition, message) => assert.ok(condition, message),
    };
    assert.equal(
        lifecycleSourceFunction("normalHookCallback", context)(),
        callback,
    );
    assert.equal(state.callback, callback);
    state.callback = undefined;
    context.stockControlProof = () => {
        throw new Error("physical controls disagree");
    };
    assert.throws(
        () => lifecycleSourceFunction("normalHookCallback", context)(),
        /physical controls disagree/u,
    );
});

test("complete hook target construction rejects every missing field and foreign context without native branding", () => {
    const context = {
        sessionId: "owned-sid",
        prompt: "original prompt",
        workspace: "D:\\owned\\workspace",
        mode: "direct",
        configDigest: "a".repeat(64),
        submittedAtMs: 100,
        deadlineMs: 200,
    };
    const target = createNativeWorkiqHookTarget(context);
    assert.equal(Object.isFrozen(target), true);
    assert.throws(() => assertNativeWorkiqProjection(target));
    for (const key of Object.keys(target)) {
        const incomplete = { ...target };
        delete incomplete[key];
        assert.throws(() => validateNativeWorkiqHookTarget(incomplete));
        assert.throws(() =>
            validateNativeWorkiqHookTarget({ ...target, [key]: undefined }),
        );
    }
    for (const mutation of [
        { cwd: "D:\\foreign" },
        { cwd: "D:\\owned" },
        { sessionId: "foreign" },
        { prompt: "rewritten" },
        { mode: "bypass" },
        { configDigest: "f".repeat(64) },
        { submittedAtMs: 101 },
        { deadlineMs: 201 },
    ])
        assert.throws(() =>
            validateNativeWorkiqHookTarget({ ...target, ...mutation }, target),
        );
    for (const mutation of [
        { workspace: undefined },
        { workspace: "relative" },
        { mode: "unknown" },
        { configDigest: "bad" },
        { submittedAtMs: 0 },
        { deadlineMs: 100 },
    ])
        assert.throws(() =>
            createNativeWorkiqHookTarget({ ...context, ...mutation }),
        );
});

test("native submit validates its source-bound hook target before typing any live prompt", () => {
    const calls = [],
        digest = "a".repeat(64);
    const state = {
        lease: { sessionId: "owned-sid" },
        initialized: { source: { sessionId: "owned-sid" } },
        eventSessionId: "owned-sid",
        knownSource: { source: { control: {} } },
        histories: [{}],
    };
    const context = {
        state,
        path,
        layout: {
            workspace: "D:\\owned\\workspace",
            pluginData: "D:\\owned\\plugin-data",
            run: "D:\\owned",
        },
        requireNative: (condition, message) => assert.ok(condition, message),
        budget: { check: () => {}, remaining: () => 1000 },
        events: () => [],
        assertCurrentActor: () => {},
        proveCurrentServiceModules: (sessionId) => {
            assert.equal(sessionId, "owned-sid");
            calls.push("modules");
        },
        read: () => ({ mode: "direct" }),
        stockControlProof: () => {
            calls.push("proof");
            return { records: [{ digest }] };
        },
        createNativeWorkiqHookTarget: (facts) => {
            calls.push("validate");
            return createNativeWorkiqHookTarget(facts);
        },
        hash: () => digest,
        write: () => calls.push("write"),
        control: () => calls.push("type"),
    };
    lifecycleSourceFunction("submit", context)("original prompt");
    assert.equal(state.hookTarget.cwd, context.layout.workspace);
    assert.equal(state.hookTarget.configDigest, digest);
    assert.deepEqual(calls.slice(0, 5), [
        "modules",
        "proof",
        "validate",
        "write",
        "type",
    ]);
    state.submission = undefined;
    state.hookTarget = undefined;
    calls.length = 0;
    context.createNativeWorkiqHookTarget = () => {
        calls.push("validate");
        throw new Error("missing caller context");
    };
    assert.throws(
        () => lifecycleSourceFunction("submit", context)("original prompt"),
        /missing caller context/u,
    );
    assert.deepEqual(calls, ["modules", "proof", "validate"]);
    assert.equal(state.submission, undefined);
});

test("actual compiled Direct router requires a normal claim to enter native SDK pass-through", async () => {
    const route = lifecycleSourceFunction(
        "routePrompt",
        { isMacroRunnerSession: () => false },
        new URL(
            "../../../copilot-plugin/dist/hooks/hook-router.js",
            import.meta.url,
        ),
    );
    const calls = [];
    const dependencies = {
        recipeOwner: () => "typeagent",
        claimRecording: async () => false,
        direct: async () => {
            calls.push("direct");
            return { handled: true };
        },
    };
    await route(
        { sessionId: "sid" },
        "direct",
        new AbortController().signal,
        dependencies,
    );
    assert.deepEqual(calls, ["direct"]);
    calls.length = 0;
    const result = await route(
        { sessionId: "sid" },
        "direct",
        new AbortController().signal,
        { ...dependencies, claimRecording: async () => true },
    );
    assert.equal(Object.keys(result).length, 0);
    assert.deepEqual(calls, []);
});

test("expired reader errors cannot skip owned console/session cleanup and all failures remain retained", async () => {
    const calls = [];
    const actor = { ProcessId: 11, StartedMs: 20, ExecutablePath: "owned.exe" };
    const readerActor = {
        ProcessId: 12,
        StartedMs: 21,
        ExecutablePath: "reader.exe",
    };
    const state = {
        console: "owned-console",
        consoleAbort: { abort: () => calls.push("abort") },
        reader: { server: readerActor },
        consoleAllocations: [{ index: 0 }],
        consoleIdentities: [actor],
        ownedIdentities: [],
        lease: { sessionId: "owned-sid" },
    };
    const cleanup = lifecycleSourceFunction("closeConsole", {
        state,
        path,
        layout: { run: "owned-run" },
        write: () => {},
        fs: { existsSync: () => true },
        consoleAllocationTitles: () => [],
        read: () => ({ bridgePid: 11 }),
        processTree: () => [actor],
        identityMatches: (left, right) =>
            left.ProcessId === right?.ProcessId &&
            left.StartedMs === right?.StartedMs &&
            left.ExecutablePath === right?.ExecutablePath,
        control: () => {
            calls.push("close");
            throw new Error("window close error");
        },
        stopOwnedIdentities: (actors) => {
            if (actors[0] === readerActor) throw new Error("reader expired");
            calls.push("exact-stop");
            assert.equal(actors[0], actor);
        },
        retireSessionArtifacts: () => calls.push("retire"),
    });
    await assert.rejects(cleanup(), (error) => {
        assert.deepEqual(
            Array.from(error.errors, (item) => item.message),
            ["reader expired", "window close error"],
        );
        return true;
    });
    assert.deepEqual(calls, ["abort", "close", "exact-stop", "retire"]);
    assert.equal(state.lease, undefined);
    assert.equal(state.console, undefined);
});

test("console cleanup never adopts a PID-reused foreign process tree", async () => {
    const actor = { ProcessId: 11, StartedMs: 20, ExecutablePath: "owned.exe" };
    const foreign = { ...actor, StartedMs: 21 };
    const state = {
        console: "owned-console",
        consoleAllocations: [{ index: 0 }],
        consoleIdentities: [actor],
        ownedIdentities: [],
    };
    const originalOwned = state.consoleIdentities;
    let stopped;
    const cleanup = lifecycleSourceFunction("closeConsole", {
        state,
        path,
        layout: { run: "owned-run" },
        write: () => {},
        fs: { existsSync: (file) => file.endsWith("console-state.json") },
        read: () => ({ bridgePid: 11 }),
        processTree: () => [foreign],
        identityMatches: (left, right) =>
            left.ProcessId === right?.ProcessId &&
            left.StartedMs === right?.StartedMs &&
            left.ExecutablePath === right?.ExecutablePath,
        control: () => {},
        stopOwnedIdentities: (actors) => {
            stopped = actors;
        },
        retireSessionArtifacts: () => {},
    });
    await cleanup();
    assert.equal(stopped, originalOwned);
    assert.equal(stopped[0], actor);
    assert.ok(!stopped.includes(foreign));
});

test("failed allocation cleanup selects a delayed exact-owned window outside an expired budget before closing", async () => {
    const calls = [];
    let selected = false;
    const state = {
        console: "partial-console",
        consoleIdentities: [],
        ownedIdentities: [],
        consoleAllocations: [
            { console: "partial-console", index: 0, admitted: false },
        ],
    };
    const cleanup = lifecycleSourceFunction("closeConsole", {
        state,
        path,
        layout: { run: "owned-run" },
        write: () => {},
        fs: { existsSync: (file) => !file.endsWith("window.json") || selected },
        read: () => ({ bridgePid: 55 }),
        processTree: () => {
            throw new Error(
                "unproved partial PID must not be probed or adopted",
            );
        },
        consoleAllocationTitles: (allocations) => {
            assert.equal(allocations, state.consoleAllocations);
            calls.push("owned-titles");
        },
        control: (action, text, cleanupBound) => {
            assert.equal(text, undefined);
            assert.equal(cleanupBound, true);
            calls.push(action);
            if (action === "Select") selected = true;
        },
        stopOwnedIdentities: (actors) => {
            assert.equal(actors.length, 0);
            calls.push("stop-empty");
        },
        retireSessionArtifacts: () => calls.push("retire"),
    });
    await cleanup();
    assert.deepEqual(calls, [
        "owned-titles",
        "Select",
        "Close",
        "stop-empty",
        "retire",
    ]);
    assert.equal(state.console, undefined);
});

test("missing partial state and failed bounded Select retain the error and still retire the exact allocation", async () => {
    const calls = [];
    const cleanup = lifecycleSourceFunction("closeConsole", {
        state: {
            console: "partial",
            consoleIdentities: [],
            ownedIdentities: [],
            consoleAllocations: [{ index: 0 }],
        },
        path,
        layout: { run: "owned-run" },
        write: () => {},
        fs: { existsSync: (file) => file.endsWith("owner.json") },
        consoleAllocationTitles: () => [],
        control: (action) => {
            calls.push(action);
            throw new Error("exact window selection deadline");
        },
        stopOwnedIdentities: () => calls.push("stop"),
        retireSessionArtifacts: () => calls.push("retire"),
    });
    await assert.rejects(cleanup(), /exact window selection deadline/u);
    assert.deepEqual(calls, ["Select", "stop", "retire"]);
});

test("all failed allocations retain their title without entering the SDK history and title mutation rejects", () => {
    const allocations = [
        { console: "failed", admitted: false },
        { console: "running", admitted: true },
    ];
    const titles = { failed: "unique-failed", running: "unique-running" };
    const collect = lifecycleSourceFunction("consoleAllocationTitles", {
        path,
        fs: { existsSync: () => true },
        read: (file) => ({ title: titles[path.dirname(file)] }),
        requireNative: (condition, message) => assert.ok(condition, message),
    });
    assert.deepEqual(Array.from(collect(allocations)), [
        "unique-failed",
        "unique-running",
    ]);
    assert.equal(allocations[0].admitted, false);
    titles.failed = "foreign-title";
    assert.throws(() => collect(allocations), /title changed/u);
});

test("bootstrap receipt preserves original private helper output and exact failed state bytes", () => {
    const source = '{"phase":"starting","bridgePid":55}\n';
    const outcome = {
        status: 1,
        stdout: "original stdout\n",
        stderr: "original stderr\n",
        message: "original launch failure",
    };
    const receipt = lifecycleSourceFunction("bootstrapReceipt", {
        path,
        fs: {
            existsSync: (file) => file.endsWith("console-state.json"),
            readFileSync: () => Buffer.from(source),
        },
        hash: (bytes) => createHash("sha256").update(bytes).digest("hex"),
    })("partial", "launch.private.json", outcome);
    assert.equal(receipt.admission, false);
    assert.equal(receipt.outcome, outcome);
    assert.equal(receipt.files.at(-1).utf8, source);
    assert.equal(
        receipt.files.at(-1).sha256,
        createHash("sha256").update(source).digest("hex"),
    );
});

test("async owned launcher retains failure exit/output and terminates on cancellation and deadline", async () => {
    await assert.rejects(
        awaitNativeWorkiqLauncher(
            process.execPath,
            [
                "-e",
                "process.stdout.write('out');process.stderr.write('err');process.exit(7)",
            ],
            { timeout: 5000 },
        ),
        (error) =>
            error.status === 7 &&
            error.stdout === "out" &&
            error.stderr === "err",
    );
    const cancellation = new AbortController();
    const pending = awaitNativeWorkiqLauncher(
        process.execPath,
        ["-e", "setTimeout(()=>{},10000)"],
        { timeout: 5000, signal: cancellation.signal },
    );
    cancellation.abort(new Error("cancel before prompt"));
    await assert.rejects(pending, (error) => error.name === "AbortError");
    await assert.rejects(
        awaitNativeWorkiqLauncher(
            process.execPath,
            ["-e", "setTimeout(()=>{},10000)"],
            { timeout: 100 },
        ),
        (error) => error.status !== 0 && error.signal !== null,
    );
});

test("partial bridge cleanup requires exact source argv/lifetime/executable and rejects PID reuse or foreign trees", () => {
    const now = Date.now();
    const allocation = {
        console: path.resolve("owned", "console-0"),
        launchFile: path.resolve("owned", "console-0.private.json"),
        allocatedAt: new Date(now - 100).toISOString(),
    };
    const helpers = path.resolve("helpers");
    const saved = {
        bridgePid: 55,
        startedAt: new Date(now + 100).toISOString(),
    };
    const actor = {
        ProcessId: 55,
        StartedMs: now,
        ExecutablePath: process.execPath,
        CommandLine: [
            process.execPath,
            path.join(helpers, "console-bridge.mjs"),
            allocation.launchFile,
            allocation.console,
        ]
            .map((arg) => `"${arg}"`)
            .join(" "),
    };
    assert.equal(
        matchesPartialConsoleBridge(actor, allocation, saved, helpers),
        true,
    );
    for (const mutation of [
        { StartedMs: now + 200 },
        { StartedMs: now - 200 },
        { ExecutablePath: "foreign.exe" },
        { ProcessId: 56 },
        {
            CommandLine: actor.CommandLine.replace(
                "console-0",
                "foreign-console",
            ),
        },
        { CommandLine: `${actor.CommandLine} --foreign` },
        { CommandLine: `foreign ${actor.CommandLine}` },
    ])
        assert.equal(
            matchesPartialConsoleBridge(
                { ...actor, ...mutation },
                allocation,
                saved,
                helpers,
            ),
            false,
        );
});

test("claim cleanup uses only the actual owned SID and still cancels after a snapshot failure", async () => {
    const calls = [];
    let reads = 0;
    const release = lifecycleSourceFunction("cancelRecording", {
        state: {
            lease: { sessionId: "owned-sid" },
            connection: {
                getMacroRecordingState: async (sid) => {
                    calls.push(["get", sid]);
                    if (reads++ === 0) throw new Error("snapshot error");
                    return { status: "idle" };
                },
                cancelMacroRecording: async (sid) =>
                    calls.push(["cancel", sid]),
            },
        },
        requireNative: (condition, message) => {
            if (!condition) throw new Error(message);
        },
    });
    await assert.rejects(release(), /snapshot error/u);
    assert.deepEqual(calls, [
        ["get", "owned-sid"],
        ["cancel", "owned-sid"],
        ["get", "owned-sid"],
    ]);
});

function fixture(reuse = false) {
    const events = [];
    function add(type, data, agentId) {
        const event = {
            id: `event-${events.length}`,
            parentId: events.at(-1)?.id,
            timestamp: new Date(
                1700000000000 + events.length * 10,
            ).toISOString(),
            type,
            data,
            ...(agentId ? { agentId } : {}),
        };
        events.push(event);
        return event;
    }
    const user = add("user.message", { content: "read frozen document" });
    const core = "a".repeat(64);
    const taskId = `typeagent-macro-${core}`;
    const calls = [];
    if (reuse) {
        add("tool.execution_start", { toolCallId: taskId, toolName: "task" });
        add(
            "subagent.started",
            {
                toolCallId: taskId,
                agentName: "typeagent-macro-runner-host",
            },
            "child",
        );
        calls.push({ toolCallId: taskId, name: "task", status: "completed" });
    }
    for (const [index, name] of [
        "retrieve",
        "fetch",
        "fetch_blob",
        "fetch",
    ].entries()) {
        const tool = tools.find((item) => item.advertisedName === name);
        const id = `read-${index}`;
        add(
            "tool.execution_start",
            {
                toolCallId: id,
                toolName: tool.callableName,
                mcpServerName: "workiq",
                ...(reuse ? { parentToolCallId: taskId } : {}),
            },
            reuse ? "child" : undefined,
        );
        add(
            "tool.execution_complete",
            { toolCallId: id, success: true },
            reuse ? "child" : undefined,
        );
        calls.push({
            toolCallId: id,
            name: tool.callableName,
            mcpServerName: "workiq",
            status: "completed",
        });
    }
    if (reuse) {
        add("subagent.completed", { toolCallId: taskId }, "child");
        add("tool.execution_complete", { toolCallId: taskId, success: true });
    }
    const terminal = add("assistant.turn_end", { turnId: "turn" });
    const publication = {
        macroId: "b".repeat(64),
        version: 2,
        state: "approved",
    };
    return {
        events,
        trace: { toolCalls: calls, ...(reuse ? { handoffRunId: core } : {}) },
        discovery: { tools },
        callback: {
            handled: reuse,
            native: { rootUserEventId: user.id, terminalEventId: terminal.id },
        },
        phase: reuse ? "reuse-b" : "capture-a",
        publication,
        audit: { runId: core, ...publication, status: "agentRequired" },
        routes: [
            {
                event: "explained",
                data: {
                    fromCache: "grammar",
                    detail: {
                        phrase: user.data.content,
                        action: `macros.run_${publication.macroId}_v2`,
                    },
                },
            },
        ],
    };
}

test("pure verifier retains four source calls and never brands a fixture", () => {
    const source = fixture();
    const result = verifyNativeWorkiqProjectionSources(source);
    assert.equal(result.document.length, 4);
    assert.equal(result.controls.length, 0);
    assert.equal(result.handoffRunId, null);
    assert.throws(() => assertNativeWorkiqProjection(result));
});

test("capture cannot admit a builtin task beside the four selected reads", () => {
    const source = fixture();
    const terminal = source.events.pop();
    const user = source.events.find((event) => event.type === "user.message");
    source.events.push(
        {
            id: "unexpected-task",
            type: "tool.execution_start",
            timestamp: terminal.timestamp,
            data: {
                toolCallId: "task-outside-capture",
                toolName: "task",
                arguments: { prompt: "synthetic local verification" },
            },
        },
        terminal,
    );
    assert.ok(Date.parse(user.timestamp) <= Date.parse(terminal.timestamp));
    assert.throws(
        () => verifyNativeWorkiqProjectionSources(source),
        /unrecorded\/extra native tool calls/,
    );
    const withSubagent = fixture();
    withSubagent.events.push({
        id: "unexpected-subagent",
        type: "subagent.started",
        timestamp: terminal.timestamp,
        data: { toolCallId: "task-outside-capture" },
    });
    assert.throws(
        () => verifyNativeWorkiqProjectionSources(withSubagent),
        /capture cannot hide tasks/,
    );
});

test("native projection preserves optional diagnostic booleans in exact raw SDK joins", () => {
    for (const phase of ["capture-a", "reuse-b", "restart-b"]) {
        for (const diagnostic of [undefined, true, false]) {
            const source = fixture(phase !== "capture-a");
            source.phase = phase;
            const call = source.trace.toolCalls.find(
                (entry) => entry.name === "workiq-retrieve",
            );
            const start = source.events.find(
                (event) =>
                    event.type === "tool.execution_start" &&
                    event.data.toolCallId === call.toolCallId,
            );
            const raw = {
                query: "synthetic scoped document",
                strategy: "grounding",
                capabilities: [
                    {
                        name: "OneDriveAndSharePoint",
                        items_by_url: [
                            { url: "https://example.invalid/document-a" },
                        ],
                    },
                ],
                ...(diagnostic === undefined
                    ? {}
                    : { includeDeveloperCard: diagnostic }),
            };
            call.arguments = structuredClone(raw);
            start.data.arguments = structuredClone(raw);
            const projection = verifyNativeWorkiqProjectionSources(source);
            assert.deepEqual(projection.document[0].arguments, raw);
            assert.throws(() => assertNativeWorkiqProjection(projection));
            for (const change of [
                (args) => {
                    args.includeDeveloperCard = diagnostic !== true;
                },
                (args) => {
                    args.query = "different document";
                },
                ...(diagnostic === undefined
                    ? []
                    : [
                          (args) => {
                              delete args.includeDeveloperCard;
                          },
                      ]),
            ]) {
                const tampered = structuredClone(source);
                const recorded = tampered.trace.toolCalls.find(
                    (entry) => entry.name === "workiq-retrieve",
                );
                change(recorded.arguments);
                assert.throws(
                    () => verifyNativeWorkiqProjectionSources(tampered),
                    /missing\/ambiguous\/noncausal current tool/,
                );
            }
        }
    }
});

test("v2 semantic diagnostic acceptance still uses one complete raw pending request for UI consent", () => {
    const admission = {
        evaluationContract: {
            schemaVersion: 2,
            kind: "workiq-macro-correctness-v2",
        },
        runtime: {
            mcpServer: "workiq",
            advertisedToolSchemas: [
                {
                    advertisedName: "retrieve",
                    inputSchema: {
                        type: "object",
                        properties: {
                            includeDeveloperCard: { type: "boolean" },
                        },
                        required: ["query"],
                    },
                },
            ],
        },
    };
    assert.equal(workiqMacroCorrectnessContract(admission), true);
    const expected = {
        query: "synthetic scoped document",
        strategy: "grounding",
        capabilities: [
            {
                name: "OneDriveAndSharePoint",
                items_by_url: [{ url: "https://example.invalid/document-a" }],
            },
        ],
    };
    const start = (argumentsValue) => ({
        type: "tool.execution_start",
        data: {
            toolCallId: "pending-call",
            toolName: inventory[0].name,
            mcpServerName: "workiq",
            arguments: structuredClone(argumentsValue),
        },
    });
    const next = { name: "retrieve", arguments: expected };
    for (const diagnostic of [undefined, true, false]) {
        const raw = {
            ...structuredClone(expected),
            ...(diagnostic === undefined
                ? {}
                : { includeDeveloperCard: diagnostic }),
        };
        assert.equal(workiqRequestMatches(raw, expected, admission, 0), true);
        assert.equal(
            workiqRequestMatches(
                raw,
                expected,
                { runtime: admission.runtime },
                0,
            ),
            diagnostic === undefined,
        );
        assert.equal(workiqRequestMatches(raw, expected, admission, 1), false);
        const pending = workiqPendingConsentArguments(
            [start(raw)],
            inventory[0],
            next,
            admission,
        );
        assert.deepEqual(pending, raw);
        const screen =
            `Do you want to use this tool?\n${inventory[0].name}\n` +
            `${JSON.stringify(raw)}\n1. Yes\n3. No`;
        assert.equal(
            classifyNativeScreen(screen, "D:\\owned\\workspace", {
                approve: true,
                tools: [{ name: inventory[0].name, arguments: pending }],
            }).text,
            "1",
        );
    }
    for (const patch of [
        { includeDeveloperCard: "true" },
        { includeDeveloperCard: null },
        { includeDeveloperCard: 1 },
        { unauthorized: true },
        { query: "other document" },
        { capabilities: [] },
    ])
        assert.throws(
            () =>
                workiqPendingConsentArguments(
                    [start({ ...expected, ...patch })],
                    inventory[0],
                    next,
                    admission,
                ),
            /workiqConsentRequestMismatch/,
        );
    assert.equal(
        workiqPendingConsentArguments(
            [
                start(expected),
                {
                    type: "tool.execution_complete",
                    data: { toolCallId: "pending-call", success: true },
                },
            ],
            inventory[0],
            next,
            admission,
        ),
        undefined,
    );
    assert.throws(
        () =>
            workiqPendingConsentArguments(
                [start(expected), start(expected)],
                inventory[0],
                next,
                admission,
            ),
        /workiqConsentRequestMismatch/,
    );
    const foreign = start(expected);
    foreign.data.mcpServerName = "other-server";
    assert.equal(
        workiqPendingConsentArguments([foreign], inventory[0], next, admission),
        undefined,
    );
    for (const schema of [
        { properties: {} },
        { properties: { includeDeveloperCard: { type: "string" } } },
        {
            properties: { includeDeveloperCard: { type: "boolean" } },
            required: ["includeDeveloperCard"],
        },
    ]) {
        const invalidSchema = structuredClone(admission);
        invalidSchema.runtime.advertisedToolSchemas[0].inputSchema = schema;
        assert.equal(
            workiqRequestMatches(
                { ...expected, includeDeveloperCard: true },
                expected,
                invalidSchema,
                0,
            ),
            false,
        );
    }
});

test("v2 metadata selection order remains exact in native raw provenance and consent", () => {
    const admission = {
        evaluationContract: {
            schemaVersion: 2,
            kind: "workiq-macro-correctness-v2",
        },
        runtime: { mcpServer: "workiq" },
    };
    const base = "https://example.invalid/drives/drive-a/items/item-a";
    const expected = {
        entityUrls: [
            `${base}?$select=id,name,size,eTag,cTag,lastModifiedDateTime,file,parentReference,webUrl,sharepointIds`,
        ],
    };
    const actual = {
        entityUrls: [
            `${base}?$select=id,name,size,eTag,cTag,lastModifiedDateTime,webUrl,parentReference,file,sharepointIds`,
        ],
    };
    for (const index of [1, 3]) {
        assert.equal(
            workiqRequestMatches(actual, expected, admission, index),
            true,
        );
        const pending = workiqPendingConsentArguments(
            [
                {
                    type: "tool.execution_start",
                    data: {
                        toolCallId: `metadata-${index}`,
                        toolName: inventory[1].name,
                        mcpServerName: "workiq",
                        arguments: actual,
                    },
                },
            ],
            inventory[1],
            { name: "fetch", arguments: expected },
            admission,
        );
        assert.deepEqual(pending, actual);
        const screen =
            `Do you want to use this tool?\n${inventory[1].name}\n` +
            `${JSON.stringify(actual)}\n1. Yes\n3. No`;
        assert.equal(
            classifyNativeScreen(screen, "D:\\owned\\workspace", {
                approve: true,
                tools: [{ name: inventory[1].name, arguments: pending }],
            }).text,
            "1",
        );
        assert.throws(
            () =>
                classifyNativeScreen(screen, "D:\\owned\\workspace", {
                    approve: true,
                    tools: [{ name: inventory[1].name, arguments: expected }],
                }),
            /Execution permission requires exact admitted synthetic arguments/,
        );
        for (const phase of ["capture-a", "reuse-b", "restart-b"]) {
            const source = fixture(phase !== "capture-a");
            source.phase = phase;
            const call = source.trace.toolCalls.filter(
                (entry) => entry.mcpServerName === "workiq",
            )[index];
            const start = source.events.find(
                (event) =>
                    event.type === "tool.execution_start" &&
                    event.data.toolCallId === call.toolCallId,
            );
            call.arguments = structuredClone(actual);
            start.data.arguments = structuredClone(actual);
            const projection = verifyNativeWorkiqProjectionSources(source);
            assert.deepEqual(projection.document[index].arguments, actual);
            assert.throws(() => assertNativeWorkiqProjection(projection));
            call.arguments = structuredClone(expected);
            assert.throws(
                () => verifyNativeWorkiqProjectionSources(source),
                /missing\/ambiguous\/noncausal current tool/,
            );
        }
    }
});

test("reuse excludes only actual source-qualified parent task, retaining full trace", () => {
    const source = fixture(true);
    const result = verifyNativeWorkiqProjectionSources(source);
    assert.equal(result.controls.length, 1);
    assert.equal(result.handoffRunId, source.audit.runId);
    assert.equal(source.trace.toolCalls.length, 5);
    assert.equal(result.pairs.get(result.controls[0]).length, 2);
});

test("actual core identity may be independently proved without inventing a trace field", () => {
    const source = fixture(true);
    delete source.trace.handoffRunId;
    const result = verifyNativeWorkiqProjectionSources(source);
    assert.equal(result.handoffRunId, source.audit.runId);
    assert.equal(Object.hasOwn(source.trace, "handoffRunId"), false);
});

test("unknown controls, wrong core/version/route, cancellation and child drift reject", () => {
    for (const change of [
        (source) => {
            source.trace.toolCalls[0].name = "shell";
        },
        (source) => {
            source.audit.runId = "controller-lease";
        },
        (source) => {
            source.audit.version = 3;
        },
        (source) => {
            source.routes[0].data.fromCache = "model";
        },
        (source) => {
            source.callback.handled = false;
        },
        (source) => {
            source.events.find(
                (event) => event.type === "subagent.completed",
            ).data.cancelled = true;
        },
        (source) => {
            source.events.find(
                (event) => event.data.toolCallId === "read-0",
            ).agentId = "foreign";
        },
    ]) {
        const source = fixture(true);
        change(source);
        assert.throws(() => verifyNativeWorkiqProjectionSources(source));
    }
});

test("additional current SDK calls cannot disappear behind a trace projection", () => {
    const source = fixture();
    const terminal = source.events.at(-1);
    source.events.splice(-1, 0, {
        id: "extra",
        parentId: terminal.parentId,
        timestamp: source.events.at(-2).timestamp,
        type: "tool.execution_start",
        data: { toolCallId: "extra", toolName: "shell" },
    });
    terminal.parentId = "extra";
    assert.throws(
        () => verifyNativeWorkiqProjectionSources(source),
        /extra native tool/u,
    );
});
