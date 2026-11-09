// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { runNativeEvaluation } from "../macro-eval-native.mjs";
import {
    admitPluginNativeCampaign,
    checkNativeCreditLedger,
    createWindowsPluginAdapter,
    nativeConsentAction,
    nativeModelAccounting,
    nativeProcessIdentityMatches,
    reviewSyntheticProgram,
} from "../macro-eval-native-driver.mjs";
import { createNativeBudget } from "../macro-eval-native.mjs";
import { macroProtocolVersion } from "../macro-eval-plan.mjs";
import { programFixture } from "./program-fixture.mjs";

const sourceDocument = {
    key: "source",
    title: "Source",
    expectedId: "synthetic-doc-source",
    content: "Source\nSOURCE-CURRENT-CONTENT",
};
const reuseDocument = {
    key: "reuse",
    title: "Reuse",
    expectedId: "synthetic-doc-reuse",
    content: "Reuse\nREUSE-CURRENT-CONTENT",
};
const corpus = {
    protocolVersion: "macro-user-e2e-v1",
    status: "ready-for-rehearsal-unexecuted",
    familyId: "exact-document-lookup-fetch",
    documents: [sourceDocument, reuseDocument],
    training: [
        { id: "capture", prompt: "Read Source", expectedDocument: "source" },
    ],
    heldOutPositive: [
        { id: "reuse", prompt: "Read Reuse", expectedDocument: "reuse" },
    ],
    negativeOrAmbiguous: [],
    contextualConversations: [],
};
const ledger = {
    version: 1,
    model: "selected-root",
    capNanoAiu: 1000,
    openingNanoAiu: 0,
    headroomNanoAiu: 0,
    requestMaximumNanoAiu: 100,
    reservations: [],
};
const authorization = {
    scope: "synthetic-only",
    approvedBy: "offline-test-reviewer",
    approvedAt: "2026-10-01T00:00:00.000Z",
    expiresAt: "2099-01-01T00:00:00.000Z",
    approveSyntheticReads: true,
    approveSyntheticPublication: true,
    corpusSha256: createHash("sha256")
        .update(JSON.stringify(corpus))
        .digest("hex"),
};

function configuration(output, route = "grammar", restart = false) {
    return {
        protocolVersion: macroProtocolVersion,
        scope: "synthetic-only",
        workspace: path.join(output, "workspace"),
        profileId: "synthetic-profile",
        rootModel: ledger.model,
        maxTargetModelTurns: 20,
        maxDurationMs: 2000,
        executionPath: route,
        recipeOwner: "plugin",
        cliExecutable: path.resolve("owned-copilot.exe"),
        cliSha256: "a".repeat(64),
        helperDirectory: path.resolve("owned-console-helpers"),
        creditLedger: path.resolve("owned-credit-ledger.json"),
        trainingCase: "capture",
        reuseCase: "reuse",
        restart,
        authorization,
    };
}

function audit(document, timestamp) {
    return [
        {
            timestamp,
            operation: "lookup_document",
            title: document.title,
            returnedId: document.expectedId,
        },
        { timestamp, operation: "fetch_document", id: document.expectedId },
    ];
}

function adapterFixture(layout, config, options = {}) {
    let events = [],
        backendAudit = [],
        opens = 0,
        submits = 0,
        closed = 0,
        state = "idle";
    const methods = [];
    const fixture = programFixture(reuseDocument, new Date().toISOString());
    const authoring = {
        captureId: "real-selected-trace",
        taskId: "real-selected-child",
        tokenId: "real-selected-token",
        contextDigest: "d".repeat(64),
    };
    const macro = {
        ...fixture.evidence.macro,
        state: "draft",
        learning: { authoring },
        inputs: [{ name: "title", secret: false }],
        program: {
            ...fixture.evidence.macro.program,
            provenance: {
                captureId: authoring.captureId,
                taskId: authoring.taskId,
                tokenId: authoring.tokenId,
            },
            semanticFunctions: [],
        },
    };
    const scope = () => ({
        workspaceId:
            process.platform === "win32"
                ? path.resolve(config.workspace).toLowerCase()
                : path.resolve(config.workspace),
        profileId: config.profileId,
        sessionId: `actual-session-${opens}`,
        catalogDirectory: path.join(
            layout.pluginData,
            "recipes",
            "current-scope-digest",
        ),
    });
    const adapter = {
        methods,
        creditAdmission: async () =>
            checkNativeCreditLedger(ledger, config.rootModel),
        open: async () => {
            opens++;
            events = [];
        },
        close: async () => {
            closed++;
        },
        wait: async () => {},
        read: async () => ({
            sessionId: `actual-session-${opens}`,
            events: [...events],
            backendAudit: [...backendAudit],
            screen: options.permission
                ? "Permission confirmation required?"
                : "",
            creditLedger: ledger,
        }),
        call: async (_sessionId, method, args) => {
            methods.push(method);
            if (method === "scope") return scope();
            if (method === "setMacroLearningPreference") return;
            if (method === "armMacroRecording")
                return { status: "armed", id: "real-selected-token" };
            if (method === "getMacroRecordingState")
                return {
                    status: state,
                    trace: { traceId: "real-selected-trace" },
                    learningJob: { jobId: "real-child-job" },
                };
            if (method === "getMacroLearningJob")
                return {
                    jobId: "real-child-job",
                    sessionId: _sessionId,
                    cwd: config.workspace,
                    status: options.failedJob ? "failed" : "needsReview",
                    macro: { macroId: macro.macroId, version: macro.version },
                    authoring: {
                        captureId: "real-selected-trace",
                        taskId: "real-selected-child",
                        tokenId: options.badToken
                            ? "foreign-token"
                            : "real-selected-token",
                        contextDigest: "d".repeat(64),
                    },
                };
            if (method === "inspectMacro") return structuredClone(macro);
            if (method === "validateMacro")
                return { valid: !options.invalidProgram };
            if (method === "approveMacro") {
                macro.state = "approved";
                return;
            }
            if (method === "getMacroRun") {
                assert.equal(args[0], adapter.currentRun.runId);
                return structuredClone(adapter.currentRun);
            }
            throw new Error(`Unexpected owner method ${method}`);
        },
        submit: async (prompt) => {
            submits++;
            const timestamp = new Date().toISOString();
            if (submits === 1) {
                assert.equal(prompt, "Read Source");
                events.push(
                    {
                        id: "source-answer",
                        timestamp,
                        type: "assistant.message",
                        data: { content: sourceDocument.content, turnId: 0 },
                    },
                    {
                        id: "source-terminal",
                        parentId: "source-answer",
                        timestamp,
                        type: "assistant.turn_end",
                        data: { turnId: 0 },
                    },
                );
                backendAudit.push(...audit(sourceDocument, timestamp));
                state = "completed";
                return;
            }
            const current = programFixture(reuseDocument, timestamp);
            current.run.runId = `current-native-run-${submits}`;
            current.run.program.runId = current.run.runId;
            current.run.program.output = options.staleOutput
                ? sourceDocument.content
                : reuseDocument.content;
            const response = { status: "completed", run: current.run };
            current.event.data.output.responseContent =
                JSON.stringify(response);
            current.event.id = `current-invocation-${submits}`;
            if (config.executionPath === "explicit-mcp") {
                assert.match(prompt, /explicit run_macro MCP/u);
                events.push({
                    id: `mcp-start-${submits}`,
                    timestamp,
                    type: "tool.execution_start",
                    data: {
                        toolCallId: `explicit-call-${submits}`,
                        toolName: "typeagent-macros-run_macro",
                        arguments: {
                            macroId: macro.macroId,
                            version: macro.version,
                        },
                    },
                });
                current.event.type = "tool.execution_complete";
                current.event.data = {
                    toolCallId: `explicit-call-${submits}`,
                    success: true,
                    result: {
                        content: [
                            { type: "text", text: JSON.stringify(response) },
                        ],
                    },
                };
            }
            events.push(
                current.event,
                {
                    id: `reuse-answer-${submits}`,
                    parentId: current.event.id,
                    timestamp,
                    type: "assistant.message",
                    data: { content: reuseDocument.content, turnId: submits },
                },
                {
                    id: `reuse-terminal-${submits}`,
                    parentId: `reuse-answer-${submits}`,
                    timestamp,
                    type: "assistant.turn_end",
                    data: { turnId: submits },
                },
            );
            backendAudit.push(...audit(reuseDocument, timestamp));
            adapter.currentRun = current.run;
        },
        stats: () => ({ opens, submits, closed }),
    };
    return adapter;
}

test("current native controller captures, requires real child context, reviews, publishes, reuses and restarts via plugin owner", async (t) => {
    const directory = fs.mkdtempSync(path.resolve("eval-native-controller-"));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    for (const route of ["grammar", "explicit-mcp"]) {
        const output = path.join(directory, route);
        const config = configuration(output, route, true);
        let adapter;
        const result = await runNativeEvaluation({
            corpus,
            config,
            output,
            executeLive: true,
            adapterFactory: async (layout) => {
                adapter = adapterFixture(layout, config);
                return adapter;
            },
        });
        assert.equal(result.status, "passed", JSON.stringify(result));
        assert.equal(result.execution, "injected-offline-controller-fixture");
        assert.equal(result.capture.grade.status, "passed");
        assert.equal(result.trials.length, 2);
        assert.notEqual(result.trials[0].sessionId, result.trials[1].sessionId);
        assert.equal(result.trials[0].grade.grammarHit, route === "grammar");
        assert.deepEqual(adapter.stats(), { opens: 2, submits: 3, closed: 2 });
        assert.ok(adapter.methods.includes("armMacroRecording"));
        assert.ok(adapter.methods.includes("getMacroRun"));
        assert.equal(adapter.methods.includes("prepareMacroLearning"), false);
        assert.deepEqual(
            JSON.parse(
                fs.readFileSync(path.join(output, "report.json"), "utf8"),
            ),
            result,
        );
    }
});

test("production Windows adapter stages and launches only the current plugin/fixture with owned identities (all process execution mocked)", async (t) => {
    const run = fs.mkdtempSync(
        path.resolve("eval-native-production-envelope-"),
    );
    t.after(() => fs.rmSync(run, { recursive: true, force: true }));
    const layout = {
        run,
        owner: "offline-owner",
        workspace: path.join(run, "workspace"),
        plugin: path.join(run, "plugin"),
        pluginData: path.join(run, "plugin-data"),
        data: path.join(run, "data"),
        audit: path.join(run, "backend.jsonl"),
    };
    for (const directory of [layout.workspace, layout.pluginData, layout.data])
        fs.mkdirSync(directory);
    const config = configuration(run);
    config.maxDurationMs = 60000;
    config.cliExecutable = path.join(run, "owned-copilot.exe");
    fs.writeFileSync(config.cliExecutable, "offline-native-binary-fixture");
    config.cliSha256 = createHash("sha256")
        .update(fs.readFileSync(config.cliExecutable))
        .digest("hex");
    config.helperDirectory = path.join(run, "helpers");
    fs.mkdirSync(config.helperDirectory);
    for (const name of [
        "Launch-Demo.ps1",
        "Control-Demo.ps1",
        "console-bridge.mjs",
    ])
        fs.writeFileSync(
            path.join(config.helperDirectory, name),
            "offline-helper-fixture",
        );
    config.creditLedger = path.join(run, "credits.json");
    fs.writeFileSync(config.creditLedger, JSON.stringify(ledger));
    const commands = [];
    const identities = [
        {
            ProcessId: 800001,
            ParentProcessId: 800000,
            StartedAt: "owned-start",
            ExecutablePath: process.execPath,
        },
        {
            ProcessId: 800002,
            ParentProcessId: 800001,
            StartedAt: "owned-child-start",
            ExecutablePath: config.cliExecutable,
        },
    ];
    const execute = (command, args, options) => {
        commands.push({ command, args, options });
        if (args.includes("-Command")) {
            if (args.some((arg) => arg.startsWith("Stop-Process"))) return "";
            return JSON.stringify(identities);
        }
        const file = args[args.indexOf("-File") + 1];
        if (file?.endsWith("Launch-Demo.ps1")) {
            const directory = args[args.indexOf("-RunDirectory") + 1];
            fs.mkdirSync(directory);
            fs.writeFileSync(
                path.join(directory, "console-state.json"),
                JSON.stringify({
                    phase: "running",
                    bridgePid: 800001,
                    cliPid: 800002,
                }),
            );
        }
        return "";
    };
    const adapter = await createWindowsPluginAdapter(
        layout,
        config,
        corpus,
        createNativeBudget(config),
        execute,
    );
    await adapter.creditAdmission();
    await adapter.open();
    await adapter.submit("Read Source");
    await adapter.close();
    const launch = JSON.parse(
        fs.readFileSync(path.join(run, "launch-1.json"), "utf8"),
    );
    assert.equal(launch.command, config.cliExecutable);
    assert.equal(launch.environment.TYPEAGENT_RECIPE_OWNER, "plugin");
    assert.equal(
        Object.hasOwn(launch.environment, "TYPEAGENT_MACRO_REPLAY_ENABLED"),
        false,
    );
    assert.equal(
        Object.hasOwn(
            launch.environment,
            "TYPEAGENT_MACRO_AGENT_HANDOFF_ENABLED",
        ),
        false,
    );
    assert.equal(Object.hasOwn(launch.environment, "TYPEAGENT_PORT"), false);
    assert.ok(launch.args.includes("--available-tools"));
    assert.ok(launch.args.includes("--model"));
    assert.deepEqual(
        Object.keys(
            JSON.parse(
                fs.readFileSync(path.join(layout.plugin, ".mcp.json"), "utf8"),
            ).mcpServers,
        ),
        ["typeagent-macros"],
    );
    assert.ok(
        commands.some(
            (item) =>
                item.args.includes("Launch-Demo.ps1") ||
                item.args.some((arg) => arg.endsWith("Launch-Demo.ps1")),
        ),
    );
    assert.ok(
        commands.some((item) =>
            item.args.some((arg) => arg.startsWith("Stop-Process -Id ")),
        ),
    );
    assert.equal(
        nativeProcessIdentityMatches(
            identities,
            identities.map((item) => ({ ...item, StartedAt: "reused-pid" })),
        ),
        false,
    );
});

test("permission, absent child identity, author failure, unsafe program and stale current output stop without replay", async (t) => {
    const directory = fs.mkdtempSync(path.resolve("eval-native-denial-"));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    for (const [index, option] of [
        { permission: true },
        { badToken: true },
        { failedJob: true },
        { invalidProgram: true },
        { staleOutput: true },
    ].entries()) {
        const output = path.join(directory, `case-${index}`);
        const config = configuration(output);
        let adapter;
        const result = await runNativeEvaluation({
            corpus,
            config,
            output,
            executeLive: true,
            adapterFactory: async (layout) => {
                adapter = adapterFixture(layout, config, option);
                return adapter;
            },
        });
        assert.notEqual(result.status, "passed");
        assert.ok(adapter.stats().submits <= 2);
        assert.equal(adapter.stats().closed, 1);
        assert.ok(fs.existsSync(path.join(output, "report.json")));
    }
});

test("authorization binds exact synthetic corpus, expiry, publication and selected training/reuse pair", () => {
    const config = configuration(path.resolve("not-launched"));
    assert.equal(admitPluginNativeCampaign(config, corpus).reuse.id, "reuse");
    for (const changed of [
        { recipeOwner: "off" },
        { reuseCase: "capture" },
        { authorization: { ...authorization, corpusSha256: "b".repeat(64) } },
        {
            authorization: {
                ...authorization,
                expiresAt: "2000-01-01T00:00:00.000Z",
            },
        },
        {
            authorization: {
                ...authorization,
                approveSyntheticPublication: false,
            },
        },
        { authorization: undefined },
        { cliSha256: "unpin" },
        { restart: undefined },
    ])
        assert.throws(() =>
            admitPluginNativeCampaign({ ...config, ...changed }, corpus),
        );
});

test("credit admission rejects wrong model, exhausted/blocked ledger and unknown limits", () => {
    assert.equal(
        checkNativeCreditLedger(ledger, ledger.model).accountedNanoAiu,
        0,
    );
    for (const value of [
        { ...ledger, model: "other-model" },
        { ...ledger, blockedReason: "unsettled" },
        { ...ledger, capNanoAiu: 99 },
        { ...ledger, requestMaximumNanoAiu: undefined },
    ])
        assert.throws(() => checkNativeCreditLedger(value, ledger.model));
});

test("consent never authorizes unrelated workspace, extension, tool, writes or blanket approval", () => {
    const layout = {
        workspace: "D:\\owned\\workspace",
        plugin: "D:\\owned\\plugin",
    };
    const approved = {
        ...authorization,
        approveOwnedWorkspaceTrust: true,
        approveOwnedExtension: true,
    };
    assert.equal(
        nativeConsentAction(
            `Confirm folder trust ${layout.workspace}\n1. Yes, trust`,
            layout,
            approved,
        ),
        "1",
    );
    assert.equal(
        nativeConsentAction(
            `permission eval-docs-lookup_document\n1. Allow once`,
            layout,
            approved,
        ),
        "1",
    );
    for (const screen of [
        "Confirm folder trust D:\\foreign\\workspace\n1. Yes, trust",
        "permission shell\n1. Allow once",
        "permission eval-docs-fetch_document write\n1. Allow once",
        "permission eval-docs-fetch_document\n1. Always allow",
    ])
        assert.equal(nativeConsentAction(screen, layout, approved), undefined);
});

test("program review and native accounting distinguish author/verifier roles without inventing credits", () => {
    const fixture = programFixture(reuseDocument, new Date().toISOString());
    const macro = {
        ...fixture.evidence.macro,
        inputs: [{ name: "title", secret: false }],
        program: { ...fixture.evidence.macro.program, semanticFunctions: [] },
    };
    assert.doesNotThrow(() => reviewSyntheticProgram(macro, { valid: true }));
    macro.program.capabilities[0].effect = "write";
    assert.throws(() => reviewSyntheticProgram(macro, { valid: true }));
    const accounting = nativeModelAccounting([
        {
            type: "subagent.started",
            agentId: "a",
            data: { agentName: "restricted-author" },
        },
        {
            type: "subagent.started",
            agentId: "v",
            data: { agentName: "independent-verifier" },
        },
        { type: "assistant.turn_start", data: {} },
        { type: "assistant.turn_start", agentId: "a", data: {} },
        { type: "assistant.turn_start", agentId: "v", data: {} },
    ]);
    assert.deepEqual(accounting.turns, {
        root: 1,
        author: 1,
        verifier: 1,
        otherChild: 0,
    });
    assert.equal(accounting.credits, null);
});
