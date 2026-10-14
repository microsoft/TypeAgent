// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { after, test } from "node:test";
import { replaceFirstLineBreak } from "./line-break-fixture.mjs";
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
    verifyNativeFixtureCatalogs,
    completeNativeRestrictionReadiness,
    consoleConfiguration,
    nativeControlTimeout,
    nativeCatalogReady,
    nativeControlProof,
    nativeReadyObservation,
    nativeLoadOnlySelection,
    nativeLoadOnlyControl,
    configureNativeLoadOnly,
    verifyNativeLoadOnlyEvidence,
    observeTrial,
    verifyNativeFinalizedCapture,
    bindNativeFinalizedSourceReader,
    assertLiveAdmission,
    reviewNativePublicationBinding,
    mergeNativeSyntheticOriginals,
    nativePreparationState,
    nativeBuildResponsePolicy,
    cleanServiceEnvironment,
    assertNativeBuildObservability,
    nativeScoringDeclaration,
    resetNativeRestartAdmission,
} from "../macro-eval-native.mjs";
import { gradeDocumentTrial } from "../macro-eval-grade.mjs";
import { approvedSourceFixture } from "./approved-source-fixture.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const cliFixture =
    process.platform === "win32"
        ? undefined
        : fs.mkdtempSync(path.join(tmpdir(), "typeagent-native-cli-"));
const cliExecutable =
    cliFixture === undefined
        ? process.execPath
        : path.join(cliFixture, "copilot.exe");
if (cliFixture !== undefined) {
    fs.copyFileSync(process.execPath, cliExecutable);
    after(() => fs.rmSync(cliFixture, { recursive: true, force: true }));
}

function finalizedUnitSource(t) {
    const run = fs.mkdtempSync(path.join(directory, ".native-finalized-unit-"));
    t.after(() => fs.rmSync(run, { recursive: true, force: true }));
    const owner = "11111111-2222-4333-8444-555555555555";
    const layout = {
        run,
        owner,
        workspace: path.join(run, "workspace"),
        data: path.join(run, "data"),
        instance: `macro-eval-${owner.slice(0, 8)}`,
    };
    fs.writeFileSync(
        path.join(run, "evaluation-owner.json"),
        JSON.stringify({ owner }),
    );
    const timestamp = (index) =>
        new Date(Date.now() - 2000 + index * 100).toISOString();
    const calls = [
        {
            toolCallId: "lookup",
            name: "macro-eval-docs-lookup_document",
            mcpServerName: "macro-eval-docs",
            arguments: { title: "Alpha" },
            result: { content: '{"id":"synthetic-a"}' },
            modelResult: { id: "synthetic-a" },
            status: "completed",
        },
        {
            toolCallId: "fetch",
            name: "macro-eval-docs-fetch_document",
            mcpServerName: "macro-eval-docs",
            arguments: { id: "synthetic-a" },
            result: { content: "ALPHA FULL CONTENT" },
            modelResult: "ALPHA FULL CONTENT",
            status: "completed",
        },
    ];
    const eventData = [
        ["user.message", { content: "Read Alpha" }],
        ...calls.flatMap((call) => [
            [
                "tool.execution_start",
                {
                    toolCallId: call.toolCallId,
                    toolName: call.name,
                    mcpServerName: call.mcpServerName,
                    arguments: call.arguments,
                },
            ],
            [
                "tool.execution_complete",
                {
                    toolCallId: call.toolCallId,
                    success: true,
                    result: call.result,
                },
            ],
        ]),
        ["assistant.message", { content: "ALPHA FULL CONTENT", turnId: 0 }],
        ["assistant.turn_end", { turnId: 0 }],
    ];
    const events = eventData.map(([type, data], index) => ({
        id: `event-${index}`,
        ...(index ? { parentId: `event-${index - 1}` } : {}),
        timestamp: timestamp(index),
        type,
        data,
    }));
    const trace = {
        schemaVersion: 1,
        traceId: owner,
        createdAt: timestamp(8),
        sessionId: "unit-session",
        cwd: layout.workspace,
        prompt: "Read Alpha",
        response: "ALPHA FULL CONTENT",
        startedAt: events[0].timestamp,
        completedAt: events[5].timestamp,
        toolCalls: calls,
    };
    const state = {
        status: "completed",
        trace: {
            traceId: trace.traceId,
            sessionId: trace.sessionId,
            createdAt: trace.createdAt,
            toolCallCount: 2,
        },
    };
    const file = path.join(
        layout.data,
        "profiles",
        layout.instance,
        "copilot-macros",
        "traces",
        `${trace.traceId}.json`,
    );
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const persist = () => fs.writeFileSync(file, JSON.stringify(trace));
    persist();
    return {
        layout,
        state,
        trace,
        events,
        file,
        persist,
        scenario: { prompt: "Read Alpha" },
        sessionId: trace.sessionId,
    };
}

test("generated finalized synthetic source audit is explicitly not live admission", async (t) => {
    const fixture = finalizedUnitSource(t);
    const result = await verifyNativeFinalizedCapture(fixture);
    assert.equal(result.admission, false);
    assert.equal(result.traceFile, fixture.file);
    assert.equal(
        result.sha256,
        createHash("sha256")
            .update(fs.readFileSync(fixture.file))
            .digest("hex"),
    );
    assert.equal(result.native.terminalEventId, "event-6");
    assert.deepEqual(result.native.toolCallIds, ["lookup", "fetch"]);
});

test("SDK originals replace whole actual events only after exact actor/native projection correlation", (t) => {
    const f = finalizedUnitSource(t);
    const source = {
        component: "native-sdk-synthetic-tool-originals",
        pid: 123,
        parentPid: 12,
        executable: "unit-only",
        cwd: f.layout.workspace,
    };
    const binding = {
        owner: f.layout.owner,
        sessionId: f.sessionId,
        source,
        startedAt: new Date(Date.now() - 5000).toISOString(),
    };
    const rows = f.events
        .filter((event) =>
            ["tool.execution_start", "tool.execution_complete"].includes(
                event.type,
            ),
        )
        .map((event) => {
            const original = structuredClone(event);
            if (event.type === "tool.execution_complete") {
                original.data.result.detailedContent =
                    original.data.result.content;
                original.data.result.contents = [
                    { type: "text", text: original.data.result.content },
                ];
            }
            return {
                schemaVersion: 1,
                ...binding,
                observedAt: new Date().toISOString(),
                event: original,
            };
        });
    const merged = mergeNativeSyntheticOriginals(f.events, rows, binding);
    assert.equal(merged[2], rows[1].event);
    assert.equal(
        merged[2].data.result.detailedContent,
        f.events[2].data.result.content,
    );
    assert.equal(f.events[2].data.result.detailedContent, undefined);
    const skewed = structuredClone(rows);
    skewed[0].observedAt = new Date(
        Date.parse(skewed[0].event.timestamp) - 1,
    ).toISOString();
    assert.equal(
        mergeNativeSyntheticOriginals(f.events, skewed, binding)[1],
        skewed[0].event,
    );
    assert.throws(
        () => mergeNativeSyntheticOriginals(f.events, rows.slice(1), binding),
        /original event missing/,
    );
    for (const corrupt of [
        (row) => {
            row.owner = "foreign";
        },
        (row) => {
            row.source.pid++;
        },
        (row) => {
            row.observedAt = new Date(
                Date.parse(binding.startedAt) - 1,
            ).toISOString();
        },
        (row) => {
            row.event.parentId = "foreign";
        },
        (row) => {
            row.event.data.result.content = "forged";
        },
        (row) => {
            row.event.data.result.unknownField =
                "not a documented projection omission";
        },
    ]) {
        const copy = structuredClone(rows);
        corrupt(copy[1]);
        assert.throws(
            () => mergeNativeSyntheticOriginals(f.events, copy, binding),
            /actor\/session\/current native projection disagreement/,
        );
    }
});

for (const [name, corrupt] of [
    [
        "not finalized",
        (f) => {
            f.state.status = "claimed";
        },
    ],
    [
        "foreign session",
        (f) => {
            f.trace.sessionId = "foreign";
        },
    ],
    [
        "foreign workspace",
        (f) => {
            f.trace.cwd = f.layout.run;
        },
    ],
    [
        "different prompt",
        (f) => {
            f.trace.prompt = "Read Beta";
        },
    ],
    [
        "partial response",
        (f) => {
            f.trace.response = "ALPHA";
        },
    ],
    [
        "future completion",
        (f) => {
            f.trace.completedAt = new Date(Date.now() + 10000).toISOString();
        },
    ],
    [
        "unknown schema",
        (f) => {
            f.trace.schemaVersion = 2;
        },
    ],
    [
        "private artifact not supported by v1",
        (f) => {
            f.trace.toolCalls[0].resultArtifact = {};
        },
    ],
    [
        "original result mismatch",
        (f) => {
            f.trace.toolCalls[1].result = { content: "OTHER" };
        },
    ],
    [
        "source impersonation",
        (f) => {
            f.trace.toolCalls[0].mcpServerName = "foreign";
        },
    ],
    [
        "source arguments mismatch",
        (f) => {
            f.trace.toolCalls[0].arguments = { title: "Beta" };
        },
    ],
    [
        "failed backend tool",
        (f) => {
            f.events[2].data.success = false;
        },
    ],
    [
        "missing native terminal",
        (f) => {
            f.events.pop();
        },
    ],
    [
        "broken causality",
        (f) => {
            f.events[6].parentId = "foreign";
        },
    ],
    [
        "extra tool effect",
        (f) => {
            f.events.push({ ...f.events[1], id: "extra" });
        },
    ],
]) {
    test(`generated finalized source rejects ${name}`, async (t) => {
        const fixture = finalizedUnitSource(t);
        corrupt(fixture);
        fixture.persist();
        await assert.rejects(
            verifyNativeFinalizedCapture(fixture),
            /Finalized selected source/,
        );
    });
}

test("generated synchronous source reader binds only its selected lease and loses capability in JSON", (t) => {
    const f = finalizedUnitSource(t);
    const envelope = {
        state: f.state,
        trace: f.trace,
        observedAt: new Date().toISOString(),
        file: { path: f.file, sha256: "a".repeat(64) },
        source: {
            instanceDir: path.dirname(path.dirname(path.dirname(f.file))),
        },
    };
    const reader = bindNativeFinalizedSourceReader({
        sessionId: f.sessionId,
        tokenId: "unit-token",
        load: () => structuredClone(envelope),
    });
    const target = { sessionId: f.sessionId, tokenId: "unit-token" };
    assert.equal(reader(target).trace.traceId, f.trace.traceId);
    assert.throws(() => reader({ ...target, tokenId: "foreign" }), /lease/);
    assert.throws(() => reader({ ...target, root: "foreign" }), /lease/);
    assert.deepEqual(
        JSON.parse(JSON.stringify({ readFinalizedSource: reader })),
        {},
    );
    envelope.file.sha256 = "b".repeat(64);
    assert.throws(() => reader(target), /changed after verification/);
});

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
    cliExecutable,
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
    extensionMode: "load_only",
};

function assertPlatformAdmission(config, contracts) {
    const admit = () => assertLiveAdmission(config, undefined, contracts);
    if (process.platform === "win32") assert.doesNotThrow(admit);
    else assert.throws(admit, /Live native controller requires Windows/u);
}

test("registered learning status disclaimer is not a permission dialog; actual prompts still block", () => {
    const screen =
        "● Macro learning: prepare\n┃ (d:\\owned\\workspace). Approval ┃\n" +
        "  of a saved macro does not grant tool permissions. ┃\nSession: ready";
    assert.equal(
        classifyNativeScreen(screen, undefined, "d:\\owned\\workspace"),
        undefined,
    );
    for (const prompt of [
        "Authenticate to continue",
        "Would you like to grant permissions?",
        "1. Yes, allow all",
        "Do you want to use this tool?",
    ])
        assert.throws(
            () =>
                classifyNativeScreen(
                    `${screen}\n${prompt}`,
                    undefined,
                    "d:\\owned\\workspace",
                ),
            /Unknown native interaction|Execution permission requires exact/,
        );
    assert.throws(
        () =>
            classifyNativeScreen(
                "Unexpected tool permissions required",
                undefined,
                "d:\\owned\\workspace",
            ),
        /Unknown native interaction/,
    );
});

test("confirm infinitive in preserved assistant narration is not an interaction", () => {
    const narration =
        "metadata to confirm the same version and complete receipt.";
    for (const screen of [
        narration,
        `   ${narration}   ┃`,
        `I will use current metadata\n  to confirm the same version and complete receipt.`,
        `Approval of a saved macro does not grant tool permissions.\n${narration}`,
    ])
        assert.equal(
            classifyNativeScreen(screen, "D:\\owned\\workspace"),
            undefined,
        );
});

test("confirmation words without actionable dialog cues remain informational", () => {
    const narration =
        "I’m now checking the downloaded byte count and\n" +
        "confirming the item version remained unchanged.";
    for (const screen of [
        narration,
        replaceFirstLineBreak(narration, " "),
        "We are verifying the receipt and\n  confirming the same version.",
        "I’m completing the receipt and\n  confirming the same version.",
        "The metadata confirms the version and full byte count.",
        "I confirmed the original download and will report its receipt.",
        "Confirmation of the decoded byte count is complete.",
        "Someone is checking the bytes and\nconfirming the version.",
        "I’m considering whether to proceed and\nconfirming the version.",
        "The comparison required to confirm the version is done.",
        "I’ll bind the item, read its metadata, and re-read metadata to\n" +
            "  confirm the same version.",
        "The comparison reads the current source to\nconfirm its version.",
        "│ I’m now checking the downloaded byte count and ┃\n" +
            "│ confirming the item version remained unchang ┃",
    ])
        assert.equal(
            classifyNativeScreen(screen, "D:\\owned\\workspace"),
            undefined,
        );
    for (const prompt of [
        "Confirm unknown action",
        "Confirming unknown action?",
        "Confirmation required",
        "Confirmation pending",
        "Confirmation:",
        "Waiting for your confirmation",
        "I need you to confirm this operation",
        "You must confirm this operation",
        "You need to\nconfirm this operation",
        "You have to\nconfirm this operation",
        "Please provide a code to\nconfirm this operation",
        "To\nconfirm identity?",
        "https://example.invalid/to\nConfirm unknown action",
        "To confirm click Allow",
        "To confirm the operation\nPress Enter",
        "Version confirmation\nPlease supply a code",
        "Confirming identity?",
        "confirming the version: please click Allow",
        "Would you like to grant more permissions?",
        "Please authenticate",
        "Allow all permissions",
        "1. Yes",
        "Continue?",
        "Additional scope?",
        "Select a model",
    ])
        assert.throws(
            () =>
                classifyNativeScreen(
                    `${narration}\n${prompt}`,
                    "D:\\owned\\workspace",
                ),
            /Unknown native interaction/,
        );
    for (const screen of [
        "I’m now checking the bytes and\nconfirming the version?",
        "I’m now checking the bytes and\nconfirming the version: press Enter",
    ])
        assert.throws(
            () => classifyNativeScreen(screen, "D:\\owned\\workspace"),
            /Unknown native interaction/,
        );
});

test("confirm narration never hides actual confirmation, authentication or permission prompts", () => {
    const narration =
        "metadata to confirm the same version and complete receipt.";
    for (const prompt of [
        "Confirm unknown action",
        "Native dialog: confirm the requested operation",
        "Confirmation required",
        "Reconfirm unknown action",
        "Are you sure you want to confirm?",
        "Press Enter to confirm",
        "Type YES to confirm",
        "Use the key to confirm this action",
        "Provide a code to confirm this action",
        "Dialog: use metadata to confirm this request",
        "To confirm, click Allow",
        "Could you use metadata to confirm this request?",
        "Can you use metadata to confirm this request",
        "metadata to confirm identity?",
        "Would you like to grant more permissions?",
        "Do you want to proceed?",
        "Please authenticate",
        "Allow all permissions",
        "1. Yes",
    ])
        for (const screen of [prompt, `${narration}\n${prompt}`])
            assert.throws(
                () => classifyNativeScreen(screen, "D:\\owned\\workspace"),
                /Unknown native interaction/,
            );
    assert.throws(
        () =>
            classifyNativeScreen(
                `${narration}\nContinue?`,
                "D:\\owned\\workspace",
            ),
        /Unknown native interaction/,
    );
});

test("model selection detection cannot span echoed prose and unrelated SDK errors", () => {
    const screen = [
        '❯ Read metadata for the "selected document identity/location".',
        "Report its identity and receipt, not content.",
        "● I will choose metadata fields before reporting the receipt.",
        "✗ retrieve (MCP: workiq): MCP error -32602: workiqScopeMismatch",
        "● The request was rejected.",
        "Denied by preToolUse hook: WorkIQ native binary/model-input exposure boundary is not admitted.",
    ].join("\n");
    for (const frame of [
        screen,
        screen.replace("selected document", "select document"),
        screen.replace("selected document", "choose document"),
        screen.replaceAll("\n", "\n│ "),
        "● I will select the model used in the receipt.\nSession: ready",
        "● I will choose a model for the report.\nSession: ready",
        "Selected model: unchanged\nSession: ready",
        "Choose document fields\n\nMCP binary/model-input error",
        "Select document fields\n● Later output\nmodel-input error",
    ])
        assert.equal(
            classifyNativeScreen(frame, "D:\\owned\\workspace"),
            undefined,
        );
});

test("localized model choosers and unknown actionable dialogs remain fail closed", () => {
    const narration =
        "metadata to confirm the same version and complete receipt.";
    for (const dialog of [
        "Select a model",
        "Choose your preferred model",
        "Please select another model",
        "Could you select a model?",
        "Dialog: choose a model",
        "Model selection\n❯ default\n  other\nEsc cancel",
        "Model chooser:",
        "Model: please select one",
        "Which model should we use?",
        "Select\n  a model\n❯ default",
        "│ Please choose │\n│ your preferred model │",
        "Authenticate to continue",
        "Sign in to continue",
        "Unexpected tool permissions required",
        "Confirm unknown action",
        "Continue?",
        "Cancel this operation?",
        "Abort the request?",
        "What additional credential should I use?",
        "Ready?",
        "Additional scope?",
        "Unknown choice: option 2?",
    ])
        for (const frame of [dialog, `${narration}\n${dialog}`])
            assert.throws(
                () => classifyNativeScreen(frame, "D:\\owned\\workspace"),
                /Unknown native interaction/,
            );
});

test("confirmation narration cannot borrow an unrelated later question mark", () => {
    const screen = [
        "metadata to confirm the same version and complete receipt.",
        "● Processing command...",
        "MCP endpoint: https://example.invalid/tool?transport=http",
    ].join("\n");
    assert.equal(
        classifyNativeScreen(screen, "D:\\owned\\workspace"),
        undefined,
    );
    for (const dialog of [
        "Continue?",
        "Confirm unknown action",
        "Please authenticate",
        "Cancel this operation?",
        "Which model should we use?",
        "Additional scope?",
    ])
        assert.throws(
            () =>
                classifyNativeScreen(
                    `${screen}\n${dialog}`,
                    "D:\\owned\\workspace",
                ),
            /Unknown native interaction/,
        );
});

test("scrolled native status notice is informational without its heading", () => {
    const notice =
        "   Approval of a saved macro does not grant tool permissions.   ┃";
    const screen =
        "Current   Sessions   Issues   Pull requests   Gists\n" +
        "   (d:\\owned\\workspace). ┃\n" +
        `${notice}\n` +
        "● Macro learning armed for the next interaction. Recording token: owned\n" +
        "❯ Find the document titled 'Vega deployment checklist' and show its contents.\n" +
        "● Processing command...\n○ Working esc edit prompt";
    for (const frame of [
        screen,
        screen.replace(
            notice,
            "Approval ┃\n of a saved macro does not grant tool permissions. ┃",
        ),
    ]) {
        assert.equal(
            classifyNativeScreen(frame, "d:\\owned\\workspace"),
            undefined,
        );
        for (const prompt of [
            "Authenticate to continue",
            "Would you like to grant permissions?",
            "Confirm unknown interaction\n1. Yes",
            "Do you want to use this tool?",
        ])
            assert.throws(
                () =>
                    classifyNativeScreen(
                        `${frame}\n${prompt}`,
                        "d:\\owned\\workspace",
                    ),
                /Unknown native interaction|Execution permission requires exact/,
            );
    }
    for (const changed of [
        screen.replace("does not grant", "grants"),
        screen.replace(notice, `${notice} Would you like to continue?`),
        screen.replace(notice, `Confirm ${notice}`),
    ])
        assert.throws(
            () => classifyNativeScreen(changed, "d:\\owned\\workspace"),
            /Unknown native interaction/,
        );
});

function selectedUnitAdapter(f, stateFor, eventsFor = () => f.events) {
    let submitted = false;
    let reads = 0;
    return {
        read: () => ({
            sessionId: f.sessionId,
            screen: "Session: ready",
            events: submitted ? eventsFor(++reads) : [],
            backendAudit: [],
            routes: [],
        }),
        submit: () => {
            submitted = true;
        },
        recording: () => stateFor(reads),
    };
}

function selectedUnitContext(f) {
    return {
        ...f.layout,
        config,
        decisions: [],
        captureState: {
            before: {
                observedAt: new Date().toISOString(),
                state: {
                    status: "armed",
                    token: {
                        id: "unit-token",
                        sessionId: f.sessionId,
                        cwd: f.layout.workspace,
                        learning: true,
                        status: "armed",
                    },
                },
            },
        },
    };
}

test("completed recording cannot reconstruct a missed claimed lease", async (t) => {
    const f = finalizedUnitSource(t);
    const context = selectedUnitContext(f);
    const adapter = selectedUnitAdapter(f, () => f.state);
    await assert.rejects(
        observeTrial(
            adapter,
            createNativeBudget(config),
            corpus.training[0],
            corpus,
            "mcp",
            context,
        ),
        /claimed state was not observed before finalization/,
    );
    assert.equal(context.captureState.after, undefined);
});

test("native failed tool takes precedence over selected-source attribution", async (t) => {
    const f = finalizedUnitSource(t);
    f.events[2].data.success = false;
    let queries = 0;
    const adapter = selectedUnitAdapter(f, () => {
        queries++;
        return f.state;
    });
    await assert.rejects(
        observeTrial(
            adapter,
            createNativeBudget(config),
            corpus.training[0],
            corpus,
            "mcp",
            selectedUnitContext(f),
        ),
        (error) =>
            error.status === "failed" &&
            /Native task failed/.test(error.message),
    );
    assert.equal(queries, 0);
});

test("generated claimed/finalized source remains non-admitting and verification is outside terminal timing", async (t) => {
    const f = finalizedUnitSource(t);
    const context = selectedUnitContext(f);
    const claimed = {
        status: "claimed",
        token: {
            ...context.captureState.before.state.token,
            status: "claimed",
            promptHash: createHash("sha256").update("Read Alpha").digest("hex"),
        },
    };
    const adapter = selectedUnitAdapter(
        f,
        (reads) => (reads === 1 ? claimed : f.state),
        (reads) => (reads === 1 ? f.events.slice(0, -1) : f.events),
    );
    let sourceVerifiedAt;
    adapter.finalizedSourceReader = async () => {
        await new Promise((resolve) => setTimeout(resolve, 40));
        sourceVerifiedAt = Date.now();
        return () => {
            throw new Error("UNIT ONLY; no actual service loader");
        };
    };
    const trial = await observeTrial(
        adapter,
        createNativeBudget(config),
        corpus.training[0],
        corpus,
        "mcp",
        context,
    );
    assert.notEqual(trial.status, "passed");
    assert.equal(context.captureState.after.state, claimed);
    assert.equal(context.captureState.sourceAudit.admission, false);
    assert.ok(sourceVerifiedAt - trial.observedTerminalAt >= 30);
    assert.equal(trial.elapsedMs, trial.observedTerminalAt - trial.submittedAt);
});

test("bounded review binds the actual selected source, learning job and immutable draft version", async (t) => {
    const f = finalizedUnitSource(t);
    const audit = await verifyNativeFinalizedCapture(f);
    const d = draft();
    const cwd = path.resolve(f.layout.workspace).toLowerCase();
    const recording = {
        ...f.state,
        trace: { ...f.state.trace, learningJobId: "unit-job" },
        learningJob: {
            jobId: "unit-job",
            traceId: f.trace.traceId,
            sessionId: f.sessionId,
            cwd,
            mode: "prepare",
            status: "needsReview",
            macro: { macroId: d.macroId, version: d.version },
        },
    };
    d.sourceTraceId = f.trace.traceId;
    d.learning = { ...d.learning, jobId: "unit-job", cwd, mode: "prepare" };
    d.steps.forEach((step, index) => {
        step.sourceToolCallId = audit.native.toolCallIds[index];
    });
    assert.doesNotThrow(() =>
        reviewNativePublicationBinding(d, recording, audit, f.layout.workspace),
    );
    for (const corrupt of [
        (candidate) => {
            candidate.sourceTraceId = "foreign";
        },
        (candidate) => {
            candidate.version++;
        },
        (candidate) => {
            candidate.learning.cwd = f.layout.run;
        },
        (candidate) => {
            candidate.learning.jobId = "foreign";
        },
        (candidate) => {
            candidate.steps[1].sourceToolCallId = "foreign";
        },
    ]) {
        const candidate = structuredClone(d);
        corrupt(candidate);
        assert.throws(
            () =>
                reviewNativePublicationBinding(
                    candidate,
                    recording,
                    audit,
                    f.layout.workspace,
                ),
            /current selected source\/job\/immutable version/,
        );
    }
});

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
        "macro-eval-docs-lookup_document",
        "macro-eval-docs-fetch_document",
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
        assert.ok(args.includes("macro-eval-docs-lookup_document"));
        assert.equal(
            args.some((arg) => arg.startsWith("mcp:")),
            false,
        );
        assert.deepEqual(
            args.slice(
                args.indexOf("--available-tools") + 1,
                args.indexOf("--log-dir"),
            ),
            nativeToolFilters(),
        );
        assert.equal(args.includes("--excluded-tools"), false);
        assert.equal(args.includes("extensions_reload"), false);
        assert.equal(args.includes("extensions_manage"), false);
        assert.equal(
            JSON.parse(
                fs.readFileSync(
                    path.join(run, "home-0", "settings.json"),
                    "utf8",
                ),
            ).extensions.mode,
            "load_only",
        );
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
        /unresolved tool restriction/u,
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
        /unresolved tool restriction/u,
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

test("bare exact documented selectors retain five unfiltered actual MCP source/schema gates", () => {
    const tools = [
        { name: "task" },
        ...["lookup_document", "fetch_document"].map((name) => ({
            name: `macro-eval-docs-${name}`,
            namespacedName: `macro-eval-docs/${name}`,
            mcpServerName: "macro-eval-docs",
            mcpToolName: name,
        })),
    ];
    const diagnostic = () => ({
        initialTools: structuredClone(tools),
        tools: structuredClone(tools),
        transitions: Array.from({ length: 4 }, () => ({
            tools: structuredClone(tools),
        })),
        workflowGates: Array.from({ length: 5 }, () => ({ passed: true })),
    });
    assert.equal(verifyNativeFixtureCatalogs(diagnostic()).passed, true);
    const mutations = [
        (d) => {
            d.initialTools[1].mcpServerName = "impersonator";
        },
        (d) => {
            delete d.initialTools[1].mcpServerName;
        },
        (d) => {
            d.initialTools[1].mcpToolName = "other";
        },
        (d) => {
            d.initialTools[1].namespacedName = "other/lookup_document";
        },
        (d) => {
            delete d.initialTools[1].namespacedName;
        },
        (d) => {
            d.initialTools[0].mcpServerName = "custom";
        },
        (d) => {
            d.initialTools.push({ name: "extensions_manage" });
        },
        (d) => {
            d.initialTools[2] = d.initialTools[1];
        },
        (d) => {
            d.transitions[3].tools = d.transitions[3].tools.slice(1);
        },
        (d) => {
            d.transitions.pop();
        },
        (d) => {
            d.workflowGates[1].passed = false;
        },
    ];
    for (const mutate of mutations) {
        const changed = diagnostic();
        mutate(changed);
        assert.throws(
            () => verifyNativeFixtureCatalogs(changed),
            /Native|native/u,
        );
    }
});

test("unknown management exclusions fail closed independently of allowlist warnings", () => {
    for (const name of ["extensions_reload", "extensions_manage"]) {
        const screen = `Unknown tool name in the tool excludedlist: "${name}"\nMCP Servers reloaded: 5 servers connected`;
        assert.throws(
            () => validateNativeObservation({ screen, events: [] }),
            /unresolved tool restriction/u,
        );
        assert.throws(
            () =>
                validateNativeObservation(
                    { screen, events: [] },
                    { allowMetadataCatalogPending: true },
                ),
            /unresolved tool restriction/u,
        );
    }
});

test("generated readiness fixtures require real initializer shape and all source/owned controls before retained startup warnings cease blocking", () => {
    const tools = [
        { name: "task" },
        ...["lookup_document", "fetch_document"].map((name) => ({
            name: `macro-eval-docs-${name}`,
            namespacedName: `macro-eval-docs/${name}`,
            mcpServerName: "macro-eval-docs",
            mcpToolName: name,
        })),
    ];
    const fixture = () => ({
        state: {
            phase: "initializing",
            startedAt: "2026-10-13T00:00:00Z",
            selectors: nativeToolFilters().slice(0, 2),
            warnings: [],
        },
        diagnostic: {
            status: "blocked",
            error: "Read-only SDK inventory and pure controls collected; native restriction warnings remain unresolved",
            sessionId: "unit-only-session",
            toolInitialization: {
                method: "session.tools.initializeAndValidate",
                sessionId: "unit-only-session",
                startedAt: "2099-01-01T00:00:00Z",
                completedAt: "2099-01-01T00:00:01Z",
                returnedKeys: [],
            },
            initialTools: structuredClone(tools),
            transitions: Array.from({ length: 4 }, () => ({
                tools: structuredClone(tools),
            })),
            workflowGates: Array.from({ length: 5 }, () => ({ passed: true })),
        },
        controls: Array.from({ length: 4 }, () => ({ passed: true })),
    });
    const warning =
        'Unknown tool name in the tool allowlist: "macro-eval-docs-lookup_document"';
    const observe = (f) => {
        validateNativeObservation(
            { screen: warning, events: [] },
            { restrictionReadiness: f.state },
        );
        f.diagnostic.toolInitialization.startedAt = new Date().toISOString();
        f.diagnostic.toolInitialization.completedAt = new Date().toISOString();
    };
    const good = fixture();
    observe(good);
    assert.equal(good.state.warnings.length, 1);
    assert.equal(
        completeNativeRestrictionReadiness(
            good.state,
            good.diagnostic,
            good.controls,
            "unit-only-session",
        ).kind,
        "native-effective-tools-readiness-v1",
    );
    assert.doesNotThrow(() =>
        validateNativeObservation(
            {
                screen: `${warning}\nMCP Servers reloaded: 5 servers connected`,
                events: [],
            },
            { restrictionReadiness: good.state },
        ),
    );
    assert.throws(
        () =>
            validateNativeObservation(
                {
                    screen: `MCP Servers reloaded: 5 servers connected\n${warning}`,
                    events: [],
                },
                { restrictionReadiness: good.state },
            ),
        /unresolved/u,
    );
    const changes = [
        (f) => {
            delete f.diagnostic.toolInitialization;
        },
        (f) => {
            f.diagnostic.toolInitialization.sessionId = "other";
        },
        (f) => {
            f.diagnostic.toolInitialization.returnedKeys = ["failure"];
        },
        (f) => {
            f.diagnostic.toolInitialization.completedAt = "invalid";
        },
        (f) => {
            f.diagnostic.initialTools[1].mcpServerName = "impersonator";
        },
        (f) => {
            f.controls[0].passed = false;
        },
        (f) => {
            f.diagnostic.error = "actual runtime validation failure";
        },
    ];
    for (const change of changes) {
        const f = fixture();
        observe(f);
        change(f);
        assert.throws(
            () =>
                completeNativeRestrictionReadiness(
                    f.state,
                    f.diagnostic,
                    f.controls,
                    "unit-only-session",
                ),
            /unproved|source binding|failed/u,
        );
        assert.equal(f.state.phase, "initializing");
    }
    for (const selector of [
        "extensions_manage",
        "mcp:macro-eval-docs-lookup_document",
        "shell",
        "*",
    ]) {
        assert.throws(
            () =>
                validateNativeObservation(
                    {
                        screen: `Unknown tool name in the tool allowlist: "${selector}"`,
                        events: [],
                    },
                    { restrictionReadiness: fixture().state },
                ),
            /unresolved/u,
        );
    }
    assert.throws(
        () =>
            validateNativeObservation(
                {
                    screen: warning,
                    events: [{ type: "assistant.turn_start" }],
                },
                { restrictionReadiness: fixture().state },
            ),
        /before admission/u,
    );
});

test("superseded diagnostic capture cannot suppress any selector warning", () => {
    const observed = {
        screen: 'MCP Servers reloaded: 5 servers connected\nUnknown tool name in the tool excludedlist: "extensions_manage"',
        events: [],
    };
    assert.throws(
        () =>
            validateNativeObservation(observed, {
                restrictionMetadataCaptureOnly: true,
            }),
        /unresolved tool restriction/,
    );
    assert.throws(
        () => validateNativeObservation(observed),
        /unresolved tool restriction/,
    );
    for (const warning of [
        'Unknown tool name in the tool allowlist: "macro-eval-docs-lookup_document"',
        'Unknown tool name in the tool excludedlist: "shell"',
        "Unknown tool name in the tool excludedlist: malformed",
    ]) {
        assert.throws(
            () =>
                validateNativeObservation(
                    { ...observed, screen: `${observed.screen}\n${warning}` },
                    { restrictionMetadataCaptureOnly: true },
                ),
            /unresolved tool restriction/,
        );
    }
    const diagnostic = {
        ...config,
        diagnosticOnly: true,
        maxTargetModelTurns: 0,
        restart: false,
        extensionMode: "load_only",
        captureRestrictionMetadata: true,
    };
    assert.throws(
        () => validateNativeConfig(diagnostic, corpus),
        /Unsupported native option/,
    );
    assert.throws(
        () =>
            validateNativeConfig(
                { ...diagnostic, extensionMode: undefined },
                corpus,
            ),
        /Unsupported native option/,
    );
    assert.throws(
        () =>
            validateNativeConfig(
                { ...config, captureRestrictionMetadata: true },
                corpus,
            ),
        /Unsupported native option/,
    );
});

test("Load Only control selects only an exact three-choice documented mode dialog", () => {
    assert.equal(
        nativeLoadOnlySelection(
            "1. Load & Augment\n❯ 2. Load Only\n3. Disabled",
        ),
        "2",
    );
    for (const screen of [
        "1. Load & Augment\n2. Load Only",
        "1. Load Only\n1. Disabled\n3. Load & Augment",
        "1. Load Only\n2. Allow All\n3. Disabled",
        "Load & Augment\nLoad Only\nDisabled",
    ])
        assert.throws(
            () => nativeLoadOnlySelection(screen),
            /Unsupported extension mode dialog/,
        );
});

test("owned Load Only contract rejects other modes, wrong roots, missing captions and every selector warning", () => {
    for (const mode of [undefined, "load_and_augment", "disabled", "default"])
        assert.throws(
            () =>
                validateNativeConfig(
                    { ...config, extensionMode: mode },
                    corpus,
                ),
            /load_only/,
        );
    const run = workspace();
    const home = path.join(run, "home-0");
    fs.mkdirSync(home);
    const settings = path.join(home, "settings.json");
    const frame = {
        sessionId: "owned-mode",
        events: [],
        screen: "Session: owned-mode\nMCP Servers reloaded: 5 servers connected\nExtensions mode changed to Load Only - 1/1 extension running",
    };
    try {
        fs.writeFileSync(
            settings,
            '// actual CLI JSONC format\n{"extensions":{"mode":"load_only"}}',
        );
        assert.equal(
            verifyNativeLoadOnlyEvidence({ run }, home, frame).mode,
            "load_only",
        );
        assert.throws(
            () =>
                verifyNativeLoadOnlyEvidence({ run }, path.dirname(run), frame),
            /exact owned home/,
        );
        assert.throws(
            () =>
                verifyNativeLoadOnlyEvidence({ run }, home, {
                    ...frame,
                    screen: "Session: owned-mode\nMCP Servers reloaded: 5 servers connected",
                }),
            /native confirmation/,
        );
        for (const warning of [
            'Unknown tool name in the tool excludedlist: "extensions_manage"',
            'Unknown tool name in the tool allowlist: "shell"',
        ])
            assert.throws(
                () =>
                    verifyNativeLoadOnlyEvidence({ run }, home, {
                        ...frame,
                        screen: frame.screen + "\n" + warning,
                    }),
                /unresolved tool restriction/,
            );
        for (const mode of [undefined, "load_and_augment", "disabled"]) {
            fs.writeFileSync(
                settings,
                JSON.stringify({ extensions: { mode } }),
            );
            assert.throws(
                () => verifyNativeLoadOnlyEvidence({ run }, home, frame),
                /not Load Only/,
            );
        }
    } finally {
        fs.rmSync(run, { recursive: true, force: true });
    }
});

test("Load Only control observes model starts and cannot submit a rescue prompt", async () => {
    const submitted = [];
    await assert.rejects(
        configureNativeLoadOnly(
            {
                read: () => ({
                    screen: "",
                    events: [{ type: "model.turn_started" }],
                }),
                submit: (text) => submitted.push(text),
            },
            { check() {} },
            { extensionMode: "load_only" },
            { workspace: directory, decisions: [] },
        ),
        /observed model-start/,
    );
    assert.deepEqual(submitted, []);
});

test("documented Load Only setup never converts pending restriction warnings into admission", async () => {
    const ready = {
        sessionId: "owned-mode-session",
        events: [],
        screen: 'Session: owned-mode-session\nMCP Servers reloaded: 5 servers connected\nUnknown tool name in the tool excludedlist: "extensions_manage"',
    };
    const frames = [
        ready,
        {
            ...ready,
            screen: "1. Load & Augment\n2. Load Only\n3. Disabled",
        },
        ready,
    ];
    const submitted = [];
    await assert.rejects(
        configureNativeLoadOnly(
            {
                read: () => frames.shift() ?? ready,
                submit: (text) => submitted.push(text),
            },
            { check() {} },
            { extensionMode: "load_only" },
            { workspace: directory, decisions: [] },
        ),
        /unresolved tool restriction/,
    );
    assert.deepEqual(submitted, []);
    assert.throws(
        () => validateNativeObservation(ready),
        /unresolved tool restriction/,
    );
});

test("actual CLI radio mode layout requires exact choices and Load Only focus before Enter", () => {
    const screen =
        "│ Extensions Mode │\n│ ❯ ● Load & Augment │\n│   ○ Load Only │\n│   ○ Disabled │";
    assert.deepEqual(nativeLoadOnlyControl(screen), {
        kind: "key",
        value: "Down",
        complete: false,
    });
    const focused = screen
        .replace("❯ ●", "●")
        .replace("○ Load Only", "❯ ○ Load Only");
    assert.deepEqual(nativeLoadOnlyControl(focused, true), {
        kind: "key",
        value: "Enter",
        complete: true,
    });
    for (const invalid of [
        screen.replace("○ Disabled", "○ Allow All"),
        screen.replace("○ Load Only", "❯ ○ Load Only"),
        screen.replace("● Load & Augment", "○ Load & Augment"),
        screen.replace("❯ ●", "●").replace("○ Disabled", "❯ ○ Disabled"),
    ])
        assert.throws(() => nativeLoadOnlyControl(invalid), /extension radio/u);
    assert.throws(
        () => nativeLoadOnlyControl(screen, true),
        /Unexpected extension radio mode focus/,
    );
});

test("radio mode navigation uses only Down then verified Load Only Enter, never text approval", async () => {
    const ready = {
        sessionId: "mode-session",
        events: [],
        screen: "Session: mode-session\nMCP Servers reloaded: 5 servers connected",
    };
    const dialog =
        "│ Extensions Mode │\n│ ❯ ● Load & Augment │\n│ ○ Load Only │\n│ ○ Disabled │";
    const frames = [
        ready,
        { ...ready, screen: dialog },
        {
            ...ready,
            screen: dialog
                .replace("❯ ●", "●")
                .replace("○ Load Only", "❯ ○ Load Only"),
        },
        ready,
    ];
    const keys = [];
    const text = [];
    await configureNativeLoadOnly(
        {
            read: () => {
                const frame = frames.shift();
                assert.ok(frame, "Unexpected extra native radio observation");
                return frame;
            },
            submit: (value) => text.push(value),
            pressKey: (value) => keys.push(value),
        },
        { check() {} },
        { extensionMode: "load_only" },
        { workspace: directory, decisions: [] },
    );
    assert.deepEqual(text, ["/extensions mode"]);
    assert.deepEqual(keys, ["Down", "Enter"]);
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

function hostAnswer(
    document,
    reference = { macroId: "learned", version: 1 },
    prompt = "Read Beta",
) {
    const { events, append } = timeline();
    const child = { agentId: "child" };
    const data = { parentToolCallId: "host-call" };
    const content = document?.content ?? "Beta\nBETA FULL CONTENT";
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
            catalogValidation: reference,
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
        content: prompt,
        interactionId: "interaction",
    });
    append("assistant.message", {
        content,
        toolRequests: [],
        interactionId: "interaction",
    });
    return events;
}

function audit(key = "b", fixtureCorpus = corpus) {
    const document = fixtureCorpus.documents.find((item) => item.key === key);
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

test("execution evidence includes unexpected native tools, inspections and backend effects", async (t) => {
    const events = modelAnswer();
    events.push({
        id: "extra",
        type: "tool.execution_start",
        data: { toolName: "typeagent-macros-inspect_macro" },
    });

    await t.test(
        "host evidence rejects model drift and procedure execution outside the owned child",
        () => {
            const events = hostAnswer();
            events[0].data.model = "other";
            events.find(
                (entry) => entry.type === "tool.execution_start",
            ).agentId = "root-other";
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
        },
    );
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

test("read-only tool initialization has its own bound inside a longer task budget", () => {
    let now = 0;
    const budget = createNativeBudget(
        { ...config, maxDurationMs: 300000 },
        undefined,
        () => now,
    );
    budget.restrictionReadiness = { phase: "initializing", deadlineMs: 180000 };
    budget.check();
    now = 180000;
    assert.throws(
        () => budget.check(),
        /read-only tool initialization deadline/u,
    );
    budget.restrictionReadiness.phase = "verified";
    assert.doesNotThrow(() => budget.check());
});

function fakeAdapter(behavior = {}) {
    let events = [],
        index = 0,
        mode = "bypass",
        learned = Boolean(behavior.approvedMacro),
        learningMode = "prepare";
    const backendAudit = [];
    const routes = [];
    const operations = [];
    let ownedLayout,
        ownedConfig,
        extensionMenu = false,
        modeConfirmed = false;
    const add = (next) => {
        const prefix = `session-${index}-batch-${events.length}-`;
        events.push(
            ...next.map((event) => ({
                ...event,
                ...((behavior.formattedAnswer ||
                    behavior.fencedAnswer ||
                    behavior.blockquotedAnswer ||
                    behavior.fixtureAnswer) &&
                event.type === "assistant.message" &&
                !event.agentId &&
                [
                    "Alpha\nALPHA FULL CONTENT",
                    "Beta\nBETA FULL CONTENT",
                ].includes(event.data?.content)
                    ? {
                          data: {
                              ...event.data,
                              content: behavior.fixtureAnswer
                                  ? behavior.fixtureCorpus.documents.find(
                                        (document) =>
                                            document.title ===
                                            event.data.content.split("\n")[0],
                                    ).content
                                  : behavior.blockquotedAnswer
                                    ? event.data.content
                                          .split("\n")
                                          .map((line) => `> ${line}`)
                                          .join("\n")
                                    : behavior.fencedAnswer
                                      ? `# ${event.data.content.split("\n")[0]}\n\n\`\`\`text\n${event.data.content}\n\`\`\``
                                      : "# " +
                                        replaceFirstLineBreak(
                                            event.data.content,
                                            "\n\n",
                                        ) +
                                        "  ",
                          },
                      }
                    : {}),
                id: prefix + event.id,
                parentId: event.parentId ? prefix + event.parentId : null,
            })),
        );
    };
    return {
        bindLayout: (layout, config) => {
            ownedLayout = layout;
            ownedConfig = config;
        },
        operations,
        startService: async () => {
            operations.push("service-start");
            if (behavior.approvedMacro)
                return [
                    {
                        macroId: behavior.approvedMacro.macroId,
                        version:
                            behavior.catalogVersion ??
                            behavior.approvedMacro.version,
                        state: "approved",
                    },
                ];
            return learned
                ? [{ macroId: "learned", version: 1, state: "approved" }]
                : [];
        },
        openConsole: async () => {
            operations.push("console-open");
            consoleConfiguration(ownedLayout, ownedConfig, index);
            index++;
            events = [];
            extensionMenu = false;
            modeConfirmed = false;
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
                : extensionMenu
                  ? "Extensions Mode\n● Load & Augment\n❯ ○ Load Only\n○ Disabled"
                  : "Session: ready\nMCP Servers reloaded: 5 servers connected" +
                    (modeConfirmed
                        ? "\nExtensions mode changed to Load Only - 1/1 extension running"
                        : ""),
        }),
        pressKey: (key) => {
            assert.equal(key, "Enter");
            extensionMenu = false;
            modeConfirmed = true;
        },
        submit: (text) => {
            if (text === "/extensions mode") {
                extensionMenu = true;
                return;
            }
            operations.push(`submit:${text}`);
            if (behavior.approvedMacro) {
                const document = behavior.fixtureCorpus.documents.find(
                    (item) => text === `Read ${item.title}`,
                );
                const reference = {
                    macroId: behavior.approvedMacro.macroId,
                    version: behavior.approvedMacro.version,
                };
                add(
                    hostAnswer(
                        behavior.omitApprovedBody
                            ? { ...document, content: "Steps completed." }
                            : document,
                        reference,
                        text,
                    ),
                );
                backendAudit.push(
                    ...audit(document.key, behavior.fixtureCorpus),
                );
                routes.push({
                    ...route,
                    seq: routes.length + 1,
                    data: {
                        fromCache: "grammar",
                        detail: {
                            phrase: text,
                            action: `macros.run_${reference.macroId}_v${reference.version}`,
                        },
                    },
                });
                if (behavior.afterApprovedSubmit)
                    behavior.afterApprovedSubmit();
            } else if (text.startsWith("/")) {
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
                backendAudit.push(...audit("a", behavior.fixtureCorpus));
            } else {
                add(learned ? hostAnswer() : modelAnswer());
                backendAudit.push(...audit("b", behavior.fixtureCorpus));
                if (learned) routes.push({ ...route, seq: routes.length + 1 });
                if (behavior.taskError)
                    add([{ id: "failed", type: "session.error", data: {} }]);
                if (behavior.hookError)
                    add([
                        {
                            id: "failed-normal-hook",
                            type: "hook.end",
                            data: {
                                hookType: "userPromptSubmitted",
                                success: false,
                                error: {
                                    message: "Actual PowerShell ParserError",
                                },
                            },
                        },
                    ]);
            }
        },
        recording: async () => ({
            learningJob: {
                status: "needsReview",
                macro: { macroId: "learned", version: 1 },
            },
        }),
        inspect: async () => behavior.approvedMacro ?? draft(),
        validate: async () => ({ valid: true }),
        approve: async () => {
            learned = true;
            operations.push("approve");
            return { macroId: "learned", version: 1 };
        },
        runtime: () => [],
        learningPreference: async () => ({ mode: learningMode }),
        setLearningPreference: async (mode) => {
            operations.push(`learning:${mode}`);
            learningMode = mode;
            return { mode };
        },
    };
}

async function fakeRun(root, adapter, override = {}, fixtureCorpus = corpus) {
    const helpers = path.join(root, "helpers");
    fs.mkdirSync(helpers);
    for (const name of [
        "Launch-Demo.ps1",
        "Control-Demo.ps1",
        "console-bridge.mjs",
    ])
        fs.writeFileSync(path.join(helpers, name), "offline fake helper");
    return runNativeEvaluation({
        corpus: fixtureCorpus,
        config: { ...config, ...override },
        output: override.approvedCatalog
            ? path.join(override.approvedCatalog.artifactRoot, "current-phase")
            : path.join(root, "run"),
        helperDirectory: helpers,
        executeLive: true,
        adapterFactory: adapter
            ? (layout) => {
                  adapter.bindLayout(layout, { ...config, ...override });
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

test("diagnostic startup never submits a task/command, learns or publishes and remains blocked on native negative permission proof", async (t) => {
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

        await t.test(
            "late auxiliary model telemetry invalidates metadata-only startup despite zero target turns",
            async () => {
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
                        result.nativeModelTelemetry.counts[
                            "model.turn_started"
                        ],
                        1,
                    );
                    assert.match(
                        result.nativeModelTelemetry.serviceModelUsage,
                        /unknown/u,
                    );
                } finally {
                    fs.rmSync(root, { recursive: true, force: true });
                }
            },
        );

        await t.test(
            "real task entrypoint blocks unavailable finalized-source capability before any service or model launch",
            async () => {
                assert.throws(
                    () =>
                        assertLiveAdmission(config, undefined, {
                            nativeOrdinaryCallbackContract:
                                "native-normal-hook-callback-v1",
                        }),
                    /blocked before models.*finalized selected-source grader capability/u,
                );
            },
        );
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
    ["native hook errors", { hookError: true }, {}, "failed"],
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
            if (behavior.hookError) {
                assert.match(result.error, /Actual PowerShell ParserError/u);
                assert.ok(result.targetModelTurns > 0);
                assert.equal(result.trials.length, 0);
            }
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

const renderingContract = {
    protocolVersion: "synthetic-document-rendering-v2",
    fixtureShape: "synthetic-prose-lines-v1",
};
const fenceRenderingContract = {
    ...renderingContract,
    protocolVersion: "synthetic-document-rendering-v3",
};
const blockquoteRenderingContract = {
    ...renderingContract,
    protocolVersion: "synthetic-document-rendering-v4",
};
const renderingCorpus = {
    ...corpus,
    documents: corpus.documents.map((document) => ({
        ...document,
        expectedId: `synthetic-doc-${document.key}`,
        content: `${document.title}\n${document.content}`,
    })),
};
const similarityCorpus = {
    ...renderingCorpus,
    documents: renderingCorpus.documents.map((document) => ({
        ...document,
        content: [
            document.title,
            `${document.key.toUpperCase()}-READY-17`,
            `Owner: Test Team ${document.title}`,
            "Gate: staging smoke tests reviewed",
            `${document.key.toUpperCase()}-CHECK-42`,
        ].join("\n"),
    })),
};
const similarityRenderingContract = {
    protocolVersion: "synthetic-document-similarity-v5",
    fixtureShape: "synthetic-prose-lines-v1",
    fixtureId: "macro-eval-synthetic-prose-fixture-v1",
    algorithm: "ordered-levenshtein-codepoints-v1",
    threshold: 0.9,
    protectedDocuments: similarityCorpus.documents.map((document) => ({
        key: document.key,
        title: document.title,
        expectedId: document.expectedId,
        contentSha256: createHash("sha256")
            .update(document.content)
            .digest("hex"),
        markers: [
            document.content.split("\n")[1],
            document.content.split("\n").at(-1),
        ],
    })),
};

function approvedUnitCorpus() {
    const gamma = {
        key: "c",
        title: "Gamma",
        expectedId: "synthetic-doc-c",
        content:
            "Gamma\nC-READY-17\nOwner: Test Team Gamma\nGate: staging smoke tests reviewed\nC-CHECK-42",
    };
    return {
        ...similarityCorpus,
        documents: [...similarityCorpus.documents, gamma],
        heldOutPositive: [
            ...similarityCorpus.heldOutPositive,
            { id: "restart", prompt: "Read Gamma", expectedDocument: "c" },
        ],
    };
}

function approvedUnitConfig(source, corpus) {
    return {
        approvedCatalog: source.config,
        retainSyntheticLearningResponses: false,
        renderingContract: {
            ...similarityRenderingContract,
            protectedDocuments: corpus.documents.map((document) => ({
                key: document.key,
                title: document.title,
                expectedId: document.expectedId,
                contentSha256: createHash("sha256")
                    .update(document.content)
                    .digest("hex"),
                markers: [
                    document.content.split("\n")[1],
                    document.content.split("\n").at(-1),
                ],
            })),
        },
    };
}

test("restart clears only completed-session diagnostic admission after owned stop", () => {
    const root = workspace();
    try {
        const layout = {
            run: root,
            data: path.join(root, "data"),
            pluginData: path.join(root, "plugin-data"),
            owner: "unit-owner",
        };
        fs.mkdirSync(layout.data);
        fs.mkdirSync(layout.pluginData);
        const configFile = path.join(layout.pluginData, "config.json");
        const config = {
            mode: "bypass",
            mcpRouting: "mixed",
            powershell: { enabled: false },
        };
        fs.writeFileSync(configFile, JSON.stringify(config));
        const file = path.join(layout.data, "native-control-admission.json");
        const before = {
            owner: layout.owner,
            ownedRoot: root,
            configPath: path.join(layout.pluginData, "config.json"),
            expectedMode: "bypass",
            diagnosticTransitions: true,
            nativeSyntheticOriginals: true,
            diagnosticCatalogReady: true,
            diagnosticCatalogSessionId: "completed-session",
            diagnosticActorIdentities: [{ pid: 123 }],
            diagnosticRestrictionWarnings: [{ selector: "old" }],
        };
        fs.writeFileSync(file, JSON.stringify(before));
        resetNativeRestartAdmission(layout);
        const after = JSON.parse(fs.readFileSync(file, "utf8"));
        assert.deepEqual(after, {
            owner: layout.owner,
            ownedRoot: root,
            configPath: before.configPath,
            expectedMode: "bypass",
            diagnosticTransitions: true,
            nativeSyntheticOriginals: true,
        });
        assert.deepEqual(
            JSON.parse(
                fs.readFileSync(
                    path.join(root, "restart-admission-before.json"),
                    "utf8",
                ),
            ),
            { admission: before, config },
        );
        assert.deepEqual(JSON.parse(fs.readFileSync(configFile, "utf8")), {
            mode: "bypass",
            powershell: { enabled: false },
        });
        fs.writeFileSync(file, JSON.stringify({ ...before, owner: "foreign" }));
        assert.throws(
            () => resetNativeRestartAdmission(layout),
            /roots\/mode changed/u,
        );
        assert.equal(
            JSON.parse(fs.readFileSync(file, "utf8")).owner,
            "foreign",
        );
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

for (const [name, behavior, expected] of [
    ["genuine restart", {}, "passed"],
    ["stale active version", { catalogVersion: 3 }, "blocked"],
    ["unknown consent", { unknownScreen: true }, "blocked"],
    ["missing requested body", { omitApprovedBody: true }, "failed"],
    ["cleanup failure", { cleanupError: true }, "harness-invalid"],
])
    test(`approved-only offline phase preserves history and avoids learning: ${name}`, async () => {
        const root = workspace();
        try {
            const corpus = approvedUnitCorpus();
            const source = approvedSourceFixture(root, corpus, draft());
            const adapter = fakeAdapter({
                ...behavior,
                approvedMacro: source.macro,
                fixtureCorpus: corpus,
            });
            const before = fs.readFileSync(source.learningFile);
            const result = await fakeRun(
                root,
                adapter,
                approvedUnitConfig(source, corpus),
                corpus,
            );
            assert.equal(result.status, expected, result.error);
            assert.equal(result.scopedHistoryRestored, !behavior.cleanupError);
            assert.deepEqual(fs.readFileSync(source.learningFile), before);
            assert.equal(adapter.operations.includes("approve"), false);
            assert.equal(
                adapter.operations.some((operation) =>
                    /^submit:.*(?:record|prepare|capture)/u.test(operation),
                ),
                false,
            );
            assert.equal(
                fs.existsSync(path.join(source.root, ".approved-reuse.lock")),
                Boolean(behavior.cleanupError),
            );
            if (expected === "passed") {
                assert.equal(result.trials.length, 2);
                assert.notEqual(
                    result.trials[0].sessionId,
                    result.trials[1].sessionId,
                );
                assert.equal(
                    adapter.operations.filter(
                        (operation) => operation === "service-start",
                    ).length,
                    2,
                );
                assert.equal(result.operatorActions.length, 0);
                assert.equal(result.learningPreferenceDuring.mode, "off");
                for (const trial of result.trials) {
                    assert.equal(trial.grade.answerScoring.similarity, 1);
                    assert.equal(trial.grade.grammarHit, true);
                }
            } else
                assert.equal(
                    adapter.operations.filter(
                        (operation) => operation === "service-start",
                    ).length,
                    1,
                );
            for (const key of Object.keys(source.config.sourceHashes))
                assert.equal(
                    createHash("sha256")
                        .update(fs.readFileSync(source.files[key].file))
                        .digest("hex"),
                    source.config.sourceHashes[key],
                );
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

test("future similarity configuration requires explicit complete trusted-fixture metadata", () => {
    const future = {
        ...config,
        renderingContract: similarityRenderingContract,
    };
    assert.deepEqual(nativeScoringDeclaration(future), {
        protocol: "macro-native-rehearsal-v5",
        renderingContract: similarityRenderingContract,
    });
    assert.doesNotThrow(() => validateNativeConfig(future, similarityCorpus));
    for (const update of [
        { threshold: 0.89 },
        { fixtureId: "unknown" },
        {
            protectedDocuments:
                similarityRenderingContract.protectedDocuments.slice(1),
        },
        { normalize: true },
    ])
        assert.throws(() =>
            validateNativeConfig(
                {
                    ...future,
                    renderingContract: {
                        ...similarityRenderingContract,
                        ...update,
                    },
                },
                similarityCorpus,
            ),
        );
    const snapshot = nativeScoringDeclaration(future).renderingContract;
    assert.notEqual(
        snapshot.protectedDocuments,
        similarityRenderingContract.protectedDocuments,
    );
    assert.deepEqual(
        snapshot.protectedDocuments,
        similarityRenderingContract.protectedDocuments,
    );
});

test("future similarity pre-model admission requires only its own tested capability", () => {
    const future = {
        ...config,
        renderingContract: similarityRenderingContract,
    };
    const contracts = {
        nativeOrdinaryCallbackContract: "native-normal-hook-callback-v1",
        nativeSelectedSourceContract: "native-finalized-selected-source-v1",
        syntheticDocumentRenderingContract: renderingContract.protocolVersion,
        syntheticDocumentFenceRenderingContract:
            fenceRenderingContract.protocolVersion,
        syntheticDocumentBlockquoteRenderingContract:
            blockquoteRenderingContract.protocolVersion,
    };
    for (const unsupported of [
        contracts,
        {
            ...contracts,
            syntheticDocumentBlockquoteRenderingContract:
                similarityRenderingContract.protocolVersion,
        },
        { ...contracts, syntheticDocumentSimilarityContract: "unknown" },
    ])
        assert.throws(
            () => assertLiveAdmission(future, undefined, unsupported),
            /Rendered-content scoring blocked before models/u,
        );
    assertPlatformAdmission(future, {
        ...contracts,
        syntheticDocumentSimilarityContract:
            similarityRenderingContract.protocolVersion,
    });
});

test("future similarity rejects stale fixture IDs/hashes/markers before native trial submission", async () => {
    for (const update of [
        { expectedId: "synthetic-doc-changed" },
        {
            content: similarityCorpus.documents[0].content.replace(
                "reviewed",
                "changed",
            ),
        },
        {
            content: similarityCorpus.documents[0].content.replace(
                "READY-17",
                "READY-18",
            ),
        },
    ]) {
        let read = false;
        let submitted = false;
        const changed = {
            ...similarityCorpus,
            documents: similarityCorpus.documents.map((document, index) =>
                index === 0 ? { ...document, ...update } : document,
            ),
        };
        await assert.rejects(
            observeTrial(
                {
                    read: () => {
                        read = true;
                    },
                    submit: () => {
                        submitted = true;
                    },
                },
                undefined,
                {},
                changed,
                "bypass",
                {
                    config: {
                        ...config,
                        renderingContract: similarityRenderingContract,
                    },
                },
            ),
            (error) =>
                !(error instanceof ReferenceError) &&
                !(error instanceof TypeError),
        );
        assert.equal(read, false);
        assert.equal(submitted, false);
    }
});

test("future similarity persists the complete per-trial scoring contract without changing source metadata", async () => {
    const root = workspace();
    try {
        const contract = structuredClone(similarityRenderingContract);
        const result = await fakeRun(
            root,
            fakeAdapter({
                fixtureAnswer: true,
                fixtureCorpus: similarityCorpus,
            }),
            { renderingContract: contract },
            similarityCorpus,
        );
        const manifest = JSON.parse(
            fs.readFileSync(path.join(root, "run", "manifest.json"), "utf8"),
        );
        for (const record of [manifest, result]) {
            assert.equal(record.protocol, "macro-native-rehearsal-v5");
            assert.deepEqual(
                record.renderingContract,
                similarityRenderingContract,
            );
        }
        assert.deepEqual(
            manifest.config.renderingContract,
            similarityRenderingContract,
        );
        assert.deepEqual(
            result.trials[0].renderingContract,
            similarityRenderingContract,
        );
        assert.deepEqual(contract, similarityRenderingContract);
        assert.equal(result.trials[0].grade.taskCorrect, true);
        assert.equal(result.status, "blocked");
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test("future rendering scoring is explicit, versioned and default-verbatim", () => {
    assert.deepEqual(nativeScoringDeclaration(config), {
        protocol: "macro-native-rehearsal-v1",
    });
    assert.deepEqual(
        nativeScoringDeclaration({ ...config, renderingContract }),
        {
            protocol: "macro-native-rehearsal-v2",
            renderingContract,
        },
    );
    assert.doesNotThrow(() =>
        validateNativeConfig({ ...config, renderingContract }, corpus),
    );
    assert.deepEqual(
        nativeScoringDeclaration({
            ...config,
            renderingContract: fenceRenderingContract,
        }),
        {
            protocol: "macro-native-rehearsal-v3",
            renderingContract: fenceRenderingContract,
        },
    );
    assert.doesNotThrow(() =>
        validateNativeConfig(
            { ...config, renderingContract: fenceRenderingContract },
            corpus,
        ),
    );
    assert.deepEqual(
        nativeScoringDeclaration({
            ...config,
            renderingContract: blockquoteRenderingContract,
        }),
        {
            protocol: "macro-native-rehearsal-v4",
            renderingContract: blockquoteRenderingContract,
        },
    );
    assert.doesNotThrow(() =>
        validateNativeConfig(
            { ...config, renderingContract: blockquoteRenderingContract },
            corpus,
        ),
    );
    for (const value of [
        null,
        "synthetic-document-rendering-v2",
        {},
        { ...renderingContract, protocolVersion: "unknown" },
        {
            ...fenceRenderingContract,
            protocolVersion: "synthetic-document-rendering-v5",
        },
        { ...renderingContract, fixtureShape: "raw-code" },
        { ...renderingContract, normalize: true },
        { ...fenceRenderingContract, allowFences: true },
        { ...blockquoteRenderingContract, allowBlockquotes: true },
    ])
        assert.throws(
            () =>
                validateNativeConfig(
                    { ...config, renderingContract: value },
                    corpus,
                ),
            /Explicit exact synthetic-document-rendering-v2/u,
        );
});

test("future rendering scoring blocks before models when tested grader version is missing", () => {
    const oldContracts = {
        nativeOrdinaryCallbackContract: "native-normal-hook-callback-v1",
        nativeSelectedSourceContract: "native-finalized-selected-source-v1",
    };
    assert.throws(
        () =>
            assertLiveAdmission(
                { ...config, renderingContract },
                undefined,
                oldContracts,
            ),
        /Rendered-content scoring blocked before models/u,
    );
    assertPlatformAdmission(
        { ...config, renderingContract },
        {
            ...oldContracts,
            syntheticDocumentRenderingContract:
                renderingContract.protocolVersion,
        },
    );
});

test("future exact-fence scoring requires its own tested pre-model capability", () => {
    const contracts = {
        nativeOrdinaryCallbackContract: "native-normal-hook-callback-v1",
        nativeSelectedSourceContract: "native-finalized-selected-source-v1",
        syntheticDocumentRenderingContract: renderingContract.protocolVersion,
    };
    const future = {
        ...config,
        renderingContract: fenceRenderingContract,
    };
    assert.throws(
        () => assertLiveAdmission(future, undefined, contracts),
        /Rendered-content scoring blocked before models/u,
    );
    assert.throws(
        () =>
            assertLiveAdmission(future, undefined, {
                ...contracts,
                syntheticDocumentFenceRenderingContract: "unknown",
            }),
        /Rendered-content scoring blocked before models/u,
    );
    assertPlatformAdmission(future, {
        ...contracts,
        syntheticDocumentFenceRenderingContract:
            fenceRenderingContract.protocolVersion,
    });
});

test("future exact-blockquote scoring requires its own tested pre-model capability", () => {
    const contracts = {
        nativeOrdinaryCallbackContract: "native-normal-hook-callback-v1",
        nativeSelectedSourceContract: "native-finalized-selected-source-v1",
        syntheticDocumentRenderingContract: renderingContract.protocolVersion,
        syntheticDocumentFenceRenderingContract:
            fenceRenderingContract.protocolVersion,
    };
    const future = {
        ...config,
        renderingContract: blockquoteRenderingContract,
    };
    for (const unsupported of [
        contracts,
        {
            ...contracts,
            syntheticDocumentFenceRenderingContract:
                blockquoteRenderingContract.protocolVersion,
        },
        {
            ...contracts,
            syntheticDocumentBlockquoteRenderingContract: "unknown",
        },
    ])
        assert.throws(
            () => assertLiveAdmission(future, undefined, unsupported),
            /Rendered-content scoring blocked before models/u,
        );
    assertPlatformAdmission(future, {
        ...contracts,
        syntheticDocumentBlockquoteRenderingContract:
            blockquoteRenderingContract.protocolVersion,
    });
});

for (const [name, contract, protocol, taskCorrect] of [
    ["default v1", undefined, "macro-native-rehearsal-v1", true],
    ["frozen v2", renderingContract, "macro-native-rehearsal-v2", false],
    ["future v3", fenceRenderingContract, "macro-native-rehearsal-v3", true],
    [
        "future v4",
        blockquoteRenderingContract,
        "macro-native-rehearsal-v4",
        true,
    ],
])
    test(`${name} native exact-body fence keeps its explicitly selected scoring semantics`, async () => {
        const root = workspace();
        try {
            const result = await fakeRun(
                root,
                fakeAdapter({
                    fencedAnswer: true,
                    fixtureCorpus: renderingCorpus,
                }),
                contract ? { renderingContract: contract } : {},
                renderingCorpus,
            );
            const manifest = JSON.parse(
                fs.readFileSync(
                    path.join(root, "run", "manifest.json"),
                    "utf8",
                ),
            );
            for (const record of [result, manifest]) {
                assert.equal(record.protocol, protocol);
                assert.deepEqual(record.renderingContract, contract);
            }
            assert.equal(result.trials[0].grade.taskCorrect, taskCorrect);
            assert.equal(result.status, taskCorrect ? "blocked" : "failed");
            assert.equal(
                result.trials[0].evidence.answer,
                "# Beta\n\n```text\nBeta\nBETA FULL CONTENT\n```",
            );
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

for (const [name, contract, protocol, taskCorrect] of [
    ["frozen v1", undefined, "macro-native-rehearsal-v1", false],
    ["frozen v2", renderingContract, "macro-native-rehearsal-v2", false],
    ["frozen v3", fenceRenderingContract, "macro-native-rehearsal-v3", false],
    [
        "future v4",
        blockquoteRenderingContract,
        "macro-native-rehearsal-v4",
        true,
    ],
])
    test(`${name} native exact blockquote retains explicit manifest/result/grade semantics`, async () => {
        const root = workspace();
        try {
            const result = await fakeRun(
                root,
                fakeAdapter({
                    blockquotedAnswer: true,
                    fixtureCorpus: renderingCorpus,
                }),
                contract ? { renderingContract: contract } : {},
                renderingCorpus,
            );
            const manifest = JSON.parse(
                fs.readFileSync(
                    path.join(root, "run", "manifest.json"),
                    "utf8",
                ),
            );
            for (const record of [manifest, result]) {
                assert.equal(record.protocol, protocol);
                assert.deepEqual(record.renderingContract, contract);
            }
            assert.deepEqual(manifest.config.renderingContract, contract);
            assert.equal(result.trials[0].grade.taskCorrect, taskCorrect);
            assert.equal(result.status, taskCorrect ? "blocked" : "failed");
            assert.equal(
                result.trials[0].evidence.answer,
                "> Beta\n> BETA FULL CONTENT",
            );
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

test("fresh rendered run declares the exact scoring version in manifest/result and passes it to grade", async () => {
    const root = workspace();
    try {
        const result = await fakeRun(
            root,
            fakeAdapter({
                formattedAnswer: true,
                fixtureCorpus: renderingCorpus,
            }),
            {
                renderingContract,
            },
            renderingCorpus,
        );
        const manifest = JSON.parse(
            fs.readFileSync(path.join(root, "run", "manifest.json"), "utf8"),
        );
        for (const record of [result, manifest]) {
            assert.equal(record.protocol, "macro-native-rehearsal-v2");
            assert.deepEqual(record.renderingContract, renderingContract);
        }
        assert.deepEqual(manifest.config.renderingContract, renderingContract);
        assert.equal(
            result.trials[0].evidence.answer,
            "# Beta\n\nBETA FULL CONTENT  ",
        );
        assert.equal(result.trials[0].grade.taskCorrect, true);
        assert.equal(result.trials[0].status, "blocked");
        assert.ok(
            result.trials[0].grade.errors.includes(
                "Task oracle passed, but route attribution remains unknown",
            ),
        );
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test("default native scoring still rejects internal Markdown decoration under verbatim v1", async () => {
    const root = workspace();
    try {
        const result = await fakeRun(
            root,
            fakeAdapter({
                formattedAnswer: true,
                fixtureCorpus: renderingCorpus,
            }),
            {},
            renderingCorpus,
        );
        assert.equal(result.protocol, "macro-native-rehearsal-v1");
        assert.equal(Object.hasOwn(result, "renderingContract"), false);
        assert.equal(result.trials[0].grade.taskCorrect, false);
        assert.ok(
            result.trials[0].grade.errors.includes(
                "full-exact-document-content",
            ),
        );
        assert.equal(result.status, "failed");
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test("private build observer requires a compiled capability before boot without invoking its factory", async () => {
    let loads = 0;
    let calls = 0;
    const enabled = { retainSyntheticLearningResponses: true };
    const implementation = {
        nativeSyntheticBuildResponseDiagnosticContract:
            "native-synthetic-build-response-policy-v1",
        createSyntheticMacroLearningDiagnostics() {
            calls++;
        },
    };
    const load = async () => {
        loads++;
        return implementation;
    };
    await assertNativeBuildObservability({}, undefined, load);
    await assertNativeBuildObservability(enabled, () => {}, load);
    assert.equal(loads, 0);
    await assertNativeBuildObservability(enabled, undefined, load);
    assert.equal(loads, 1);
    assert.equal(calls, 0);
    for (const value of [
        {},
        {
            ...implementation,
            nativeSyntheticBuildResponseDiagnosticContract: "old",
        },
        { ...implementation, createSyntheticMacroLearningDiagnostics: null },
    ])
        await assert.rejects(
            assertNativeBuildObservability(
                enabled,
                undefined,
                async () => value,
            ),
            /blocked before boot/u,
        );
    await assert.rejects(
        assertNativeBuildObservability(enabled, undefined, async () => {
            throw new Error("missing compiled module");
        }),
        /blocked before boot/u,
    );
});

test("private build-response policy binds the exact source session and corpus arguments", () => {
    const run = path.join(directory, "unit-owned-policy");
    const layout = {
        run,
        owner: "11111111-2222-4333-8444-555555555555",
        data: path.join(run, "data"),
        pluginData: path.join(run, "plugin-data"),
        instance: "macro-eval-11111111",
    };
    const enabled = {
        ...config,
        restart: false,
        retainSyntheticLearningResponses: true,
    };
    const policy = nativeBuildResponsePolicy(
        layout,
        enabled,
        corpus,
        "actual-source-session",
    );
    assert.deepEqual(policy, {
        schemaVersion: 1,
        kind: "native-synthetic-build-response-policy-v1",
        owner: layout.owner,
        ownedRoot: run,
        dataRoot: layout.data,
        instanceName: layout.instance,
        configPath: path.join(layout.pluginData, "config.json"),
        expectedSessionId: "actual-source-session",
        expectedPrompt: "Read Alpha",
        expectedToolCalls: [
            {
                name: "macro-eval-docs-lookup_document",
                mcpServerName: "macro-eval-docs",
                arguments: { title: "Alpha" },
            },
            {
                name: "macro-eval-docs-fetch_document",
                mcpServerName: "macro-eval-docs",
                arguments: { id: "synthetic-a" },
            },
        ],
        maxResponseBytes: 262144,
        maxResponses: 2,
    });
    assert.equal(
        nativeBuildResponsePolicy(layout, config, corpus, ""),
        undefined,
    );
    assert.throws(
        () => nativeBuildResponsePolicy(layout, enabled, corpus, ""),
        /actual selected session/u,
    );
    assert.throws(
        () =>
            nativeBuildResponsePolicy(
                layout,
                enabled,
                { ...corpus, documents: [] },
                "actual-source-session",
            ),
        /documents|exact synthetic document/iu,
    );
    const inherited = {
        TYPEAGENT_MACRO_BUILD_RESPONSE_DIAGNOSTIC_POLICY: "foreign-policy",
        TYPEAGENT_UNRELATED: "foreign-value",
        COPILOT_ALLOW_ALL: "true",
        COPILOT_ASSISTED_APPROVAL: "true",
        NORMAL_AUTH: "unchanged-unit-marker",
    };
    assert.equal(
        cleanServiceEnvironment(inherited, layout, config)
            .TYPEAGENT_MACRO_BUILD_RESPONSE_DIAGNOSTIC_POLICY,
        undefined,
    );
    const environment = cleanServiceEnvironment(inherited, layout, enabled);
    assert.equal(
        environment.TYPEAGENT_MACRO_BUILD_RESPONSE_DIAGNOSTIC_POLICY,
        path.join(layout.data, "native-build-response-policy.json"),
    );
    assert.equal(environment.NORMAL_AUTH, inherited.NORMAL_AUTH);
    for (const key of [
        "TYPEAGENT_UNRELATED",
        "COPILOT_ALLOW_ALL",
        "COPILOT_ASSISTED_APPROVAL",
    ])
        assert.equal(environment[key], undefined);
});

test("private synthetic learning diagnostics require explicit bounded full-task opt-in", () => {
    const diagnostic = {
        ...config,
        restart: false,
        maxTargetModelTurns: 20,
        maxDurationMs: 300000,
        retainSyntheticLearningResponses: true,
    };
    assert.doesNotThrow(() => validateNativeConfig(diagnostic, corpus));
    for (const override of [
        { retainSyntheticLearningResponses: "true" },
        { restart: true },
        { maxTargetModelTurns: 21 },
        { maxDurationMs: 300001 },
        { attributionOnly: true },
        { diagnosticOnly: true, maxTargetModelTurns: 0 },
    ])
        assert.throws(
            () => validateNativeConfig({ ...diagnostic, ...override }, corpus),
            /diagnostic|rehearsal|boolean/iu,
        );
    assert.doesNotThrow(() =>
        validateNativeConfig(
            { ...config, retainSyntheticLearningResponses: false },
            corpus,
        ),
    );
});

test("preparation failure retains the actual failed job without promoting pending or failed output", () => {
    const report = {};
    const learningJob = {
        status: "failed",
        jobId: "unit-failed-job",
        traceId: "unit-selected-trace",
        attempts: { extract: 1 },
        error: "Actual recipe output uncertainty",
    };
    assert.throws(
        () => nativePreparationState({ learningJob }, report),
        /Macro preparation failed/u,
    );
    assert.deepEqual(report.learningFailure, learningJob);
    assert.equal(
        nativePreparationState({ learningJob: { status: "extracting" } }, {}),
        undefined,
    );
    assert.equal(nativePreparationState({}, {}), undefined);
    const review = { learningJob: { status: "needsReview" } };
    assert.equal(nativePreparationState(review, {}), review);
});

test("final accounting includes late persisted native turns without calling them service usage", async () => {
    const root = workspace();
    try {
        const adapter = fakeAdapter();
        adapter.finalEvents = () => [
            ...adapter.read().events,
            { id: "late-native-turn", type: "assistant.turn_start", data: {} },
        ];
        const result = await fakeRun(root, adapter);
        assert.equal(
            result.targetModelTurns,
            adapter
                .read()
                .events.filter((event) => event.type === "assistant.turn_start")
                .length + 1,
        );
        assert.match(
            result.nativeModelTelemetry.accounting,
            /reconciled after cleanup/u,
        );
        assert.match(result.nativeModelTelemetry.serviceModelUsage, /unknown/u);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test("pending native trial never asks for a callback and actual failed hook wins over absent receipt", async () => {
    let reads = 0;
    let callbackReads = 0;
    const adapter = {
        read() {
            reads++;
            return {
                events:
                    reads < 3
                        ? []
                        : [
                              {
                                  id: "native-parser-failure",
                                  type: "hook.end",
                                  data: {
                                      success: false,
                                      error: {
                                          message:
                                              "Actual PowerShell ParserError",
                                      },
                                  },
                              },
                          ],
                backendAudit: [],
                routes: [],
                screen: "",
            };
        },
        submit() {},
        normalHookCallback() {
            callbackReads++;
            throw new Error("Missing physical receipt");
        },
    };
    await assert.rejects(
        observeTrial(
            adapter,
            createNativeBudget(config),
            corpus.heldOutPositive[0],
            corpus,
            "bypass",
            {
                config,
                workspace: path.resolve(directory),
                decisions: [],
            },
        ),
        /Native hook failed: Actual PowerShell ParserError/u,
    );
    assert.equal(callbackReads, 0);
    assert.equal(reads, 3);
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
