// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { gradeDocumentTrial } from "../macro-eval-grade.mjs";

const document = {
    key: "vega",
    title: "Vega deployment checklist",
    expectedId: "synthetic-doc-vega",
    content:
        "Vega deployment checklist\nVEGA-DEPLOY-23\nOwner: Test Team Vega\nGate: rollback instructions reviewed\nVEGA-CHECK-58",
};
const timestamp = "2026-10-12T00:00:00.000Z";
function trial() {
    return {
        scenario: {
            id: "positive",
            kind: "positive",
            familyId: "exact-document-lookup-fetch",
            expectedDocument: "vega",
        },
        documents: [document],
        events: [
            { type: "assistant.message", data: { content: document.content } },
            { type: "session.idle", data: {} },
        ],
        backendAudit: [
            {
                timestamp,
                operation: "lookup_document",
                title: document.title,
                returnedId: document.expectedId,
            },
            { timestamp, operation: "fetch_document", id: document.expectedId },
        ],
        answer: document.content,
        routeEvidence: { route: "grammar" },
        executionEvidence: { wholeMacroInvocations: 1, effects: [] },
    };
}
function negativeTrial() {
    const value = trial();
    value.scenario = {
        id: "negative",
        kind: "negative",
        familyId: "exact-document-lookup-fetch",
        wholeMacroInvocations: 0,
        forbiddenEffects: ["send-mail", "rename-document"],
    };
    value.routeEvidence = { route: "miss" };
    value.executionEvidence.wholeMacroInvocations = 0;
    return value;
}

function nativeModelTrial() {
    const value = trial();
    value.events = [
        {
            id: "root-answer",
            parentId: "prior-causal-event",
            type: "assistant.message",
            data: { content: document.content, turnId: "2", toolRequests: [] },
        },
        {
            id: "root-turn-end",
            parentId: "root-answer",
            type: "assistant.turn_end",
            data: { turnId: "2" },
        },
    ];
    return value;
}

function nativeHostTrial() {
    const value = trial();
    const toolCallId = "typeagent-macro-owned";
    const agentId = "native-child";
    const agentName = "typeagent:typeagent-macro-runner-host";
    const child = { agentId };
    const report = {
        kind: "typeagent-macro-phases",
        elapsedMs: 100,
        catalogValidation: { macroId: "approved-macro", version: 2 },
        phases: [
            { phase: "host.dispatch", elapsedMs: 0 },
            { phase: "host.catalog-validated", elapsedMs: 1 },
            { phase: "subagent.started", elapsedMs: 2 },
            { phase: "procedure-tool.started", elapsedMs: 5 },
            { phase: "procedure-tool.completed", elapsedMs: 7 },
            { phase: "runner.turn.completed", elapsedMs: 8 },
            { phase: "subagent.completed", elapsedMs: 9 },
        ],
    };
    value.routeEvidence = {
        route: "grammar",
        macroId: "approved-macro",
        version: 2,
    };
    value.events = [
        {
            ...child,
            id: "child-start",
            parentId: "host-hook",
            type: "subagent.started",
            data: { toolCallId, agentName },
        },
        {
            ...child,
            id: "child-user",
            parentId: "child-start",
            type: "user.message",
            data: { content: "Execute the validated macro.", turnId: "2" },
        },
        {
            ...child,
            id: "child-answer",
            parentId: "child-user",
            type: "assistant.message",
            data: {
                parentToolCallId: toolCallId,
                turnId: "2",
                content: document.content,
                toolRequests: [],
            },
        },
        {
            ...child,
            id: "child-turn-end",
            parentId: "child-answer",
            type: "assistant.turn_end",
            data: { parentToolCallId: toolCallId, turnId: "2" },
        },
        {
            ...child,
            id: "child-complete",
            parentId: "child-turn-end",
            type: "subagent.completed",
            data: { toolCallId, agentName },
        },
        {
            id: "host-phases",
            parentId: "child-complete",
            type: "session.info",
            data: { infoType: "notification", message: JSON.stringify(report) },
        },
        {
            id: "host-hook-end",
            parentId: "host-phases",
            type: "hook.end",
            data: {},
        },
        {
            id: "root-user",
            parentId: "host-hook-end",
            type: "user.message",
            data: {
                content: "Read Vega deployment checklist for me",
                interactionId: "interaction",
                messageId: "user-message",
            },
        },
        {
            id: "root-answer",
            parentId: "root-user",
            type: "assistant.message",
            data: {
                content: document.content,
                interactionId: "interaction",
                originatingMessageId: "user-message",
                toolRequests: [],
            },
        },
    ];
    return value;
}

function ordinaryCandidate(policy = "bypass-baseline") {
    const value = trial();
    const prompt =
        "Find the document titled 'Vega deployment checklist' and show its contents.";
    value.scenario.prompt = prompt;
    value.executionEvidence.wholeMacroInvocations = 0;
    const at = (milliseconds) =>
        new Date(Date.parse(timestamp) + milliseconds).toISOString();
    const digest = (entry) =>
        createHash("sha256").update(JSON.stringify(entry)).digest("hex");
    const expected = {
        owner: "unit-owned-run",
        ownedRoot: "D:\\unit\\owned",
        sessionId: "unit-native-session",
        prompt,
        promptHash: createHash("sha256").update(prompt).digest("hex"),
        cwd: "D:\\unit\\owned\\workspace",
        configPath: "D:\\unit\\owned\\plugin-data\\config.json",
        dataRoot: "D:\\unit\\owned\\data",
        effectiveMode: policy === "bypass-baseline" ? "bypass" : "mcp",
        routing: policy === "bypass-baseline" ? "delegate" : "mixed",
        startedAt: at(0),
        endedAt: at(2000),
    };
    expected.digest = digest({
        configPath: expected.configPath,
        dataRoot: expected.dataRoot,
        effectiveMode: expected.effectiveMode,
        mcpRouting: expected.routing,
    });
    const input = {
        sessionId: expected.sessionId,
        prompt,
        timestamp: Date.parse(at(100)),
        cwd: expected.cwd,
    };
    const control = {
        effectiveMode: expected.effectiveMode,
        configPath: expected.configPath,
        dataRoot: expected.dataRoot,
        digest: expected.digest,
        source: {
            component: "native-hook",
            pid: 200,
            parentPid: 100,
            executable: "D:\\unit\\node.exe",
            cwd: expected.cwd,
            owner: expected.owner,
            instance: "unit-instance",
            server: "ws://127.0.0.1:12345",
            observedAt: at(150),
            config: "CLAUDE_PLUGIN_DATA",
            mode: "config",
            routing: expected.routing,
            expectedConfigPath: expected.configPath,
            expectedMode: expected.effectiveMode,
            readableOwnedConfig: true,
            request: {
                sessionId: input.sessionId,
                timestamp: input.timestamp,
                cwd: input.cwd,
            },
        },
    };
    const token = {
        id: "unit-selected-lease",
        sessionId: expected.sessionId,
        status: "armed",
        expiresAt: at(10000),
        cwd: expected.cwd,
        learning: true,
    };
    value.routeEvidence = {
        route: "ordinary-copilot",
        receipt: {
            schemaVersion: 1,
            origin: "trusted-native-controller",
            policy,
            expected,
            hook: {
                hookInvocationId: "unit-hook-invocation",
                startEventId: "hook-start",
                endEventId: "hook-end",
            },
            control,
            callback: null,
            capture:
                policy === "bypass-baseline"
                    ? { policy: "none" }
                    : {
                          policy: "selected-source",
                          before: {
                              observedAt: at(50),
                              state: { status: "armed", token },
                          },
                          after: {
                              observedAt: at(250),
                              state: {
                                  status: "claimed",
                                  token: {
                                      ...token,
                                      status: "claimed",
                                      promptHash: expected.promptHash,
                                  },
                              },
                          },
                      },
        },
    };
    value.events = [
        {
            id: "session-start",
            parentId: null,
            timestamp: at(0),
            type: "session.start",
            data: {
                sessionId: expected.sessionId,
                context: { cwd: expected.cwd },
            },
        },
        {
            id: "hook-start",
            parentId: "session-start",
            timestamp: at(100),
            type: "hook.start",
            data: {
                hookType: "userPromptSubmitted",
                hookInvocationId: "unit-hook-invocation",
                input,
            },
        },
        {
            id: "hook-end",
            parentId: "hook-start",
            timestamp: at(200),
            type: "hook.end",
            data: {
                hookType: "userPromptSubmitted",
                hookInvocationId: "unit-hook-invocation",
                success: true,
                output: {},
            },
        },
        {
            id: "root-user",
            parentId: "hook-end",
            timestamp: at(300),
            type: "user.message",
            data: {
                content: prompt,
                messageId: "root-user-message",
                interactionId: "unit-interaction",
            },
        },
        {
            id: "lookup-start",
            parentId: "root-user",
            timestamp: at(400),
            type: "tool.execution_start",
            data: {
                toolCallId: "unit-lookup",
                toolName: "macro-eval-docs-lookup_document",
                mcpServerName: "macro-eval-docs",
                arguments: { title: document.title },
            },
        },
        {
            id: "lookup-complete",
            parentId: "lookup-start",
            timestamp: at(500),
            type: "tool.execution_complete",
            data: { toolCallId: "unit-lookup", success: true },
        },
        {
            id: "fetch-start",
            parentId: "lookup-complete",
            timestamp: at(600),
            type: "tool.execution_start",
            data: {
                toolCallId: "unit-fetch",
                toolName: "macro-eval-docs-fetch_document",
                mcpServerName: "macro-eval-docs",
                arguments: { id: document.expectedId },
            },
        },
        {
            id: "fetch-complete",
            parentId: "fetch-start",
            timestamp: at(700),
            type: "tool.execution_complete",
            data: { toolCallId: "unit-fetch", success: true },
        },
        {
            id: "root-answer",
            parentId: "fetch-complete",
            timestamp: at(800),
            type: "assistant.message",
            data: {
                content: document.content,
                turnId: 0,
                interactionId: "unit-interaction",
                toolRequests: [],
            },
        },
        {
            id: "root-turn-end",
            parentId: "root-answer",
            timestamp: at(900),
            type: "assistant.turn_end",
            data: { turnId: 0 },
        },
    ];
    value.backendAudit[0].timestamp = at(450);
    value.backendAudit[1].timestamp = at(650);
    return value;
}

function event(value, id) {
    return value.events.find((entry) => entry.id === id);
}

function assertOrdinaryCheckFails(value, name) {
    const grade = gradeDocumentTrial(value);
    assert.notEqual(grade.status, "passed");
    assert.equal(grade.grammarHit, null);
    assert.equal(
        grade.checks.find((check) => check.name === name)?.passed,
        false,
        name,
    );
    return grade;
}

test("ordinary v1 unit candidates validate both policy bindings but remain blocked without callback proof", () => {
    for (const policy of ["bypass-baseline", "mcp-mixed-source-capture"]) {
        const grade = gradeDocumentTrial(ordinaryCandidate(policy));
        assert.equal(grade.status, "blocked");
        assert.equal(grade.taskCorrect, null);
        assert.equal(grade.grammarHit, null);
        assert.ok(grade.checks.every((check) => check.passed));
        assert.match(grade.errors.join("\n"), /callback:null/);
        if (policy === "mcp-mixed-source-capture")
            assert.match(grade.errors.join("\n"), /finalized selected trace/);
    }
});

test("ordinary enum, status metadata, guessed callbacks and loose flags cannot certify bypass or a cache hit", () => {
    const value = ordinaryCandidate();
    value.routeEvidence = { route: "ordinary-copilot" };
    const absent = gradeDocumentTrial(value);
    assert.equal(absent.status, "blocked");
    assert.equal(absent.grammarHit, null);
    for (const mutate of [
        (entry) => {
            entry.routeEvidence.receipt.callback = { verified: true, pid: 200 };
        },
        (entry) => {
            entry.routeEvidence.bypassCandidate = true;
        },
        (entry) => {
            entry.routeEvidence.receipt.control.source.hookName =
                "userPromptSubmitted";
        },
        (entry) => {
            entry.routeEvidence.receipt.hook.commandSource = "native";
        },
        (entry) => {
            entry.routeEvidence.receipt = JSON.stringify(
                entry.routeEvidence.receipt,
            );
        },
    ]) {
        const input = ordinaryCandidate();
        mutate(input);
        assert.equal(gradeDocumentTrial(input).status, "harness-invalid");
    }
    const startup = ordinaryCandidate();
    startup.routeEvidence.receipt.control.source.request = null;
    assertOrdinaryCheckFails(startup, "ordinary-actual-parsed-hook-request");
    const ipc = ordinaryCandidate();
    ipc.routeEvidence.receipt.control.source.component =
        "native-extension-status";
    assertOrdinaryCheckFails(ipc, "ordinary-current-control-binding");
});

test("ordinary control checks reject stale, foreign, copied and wrong-digest receipts against current native fields", () => {
    const cases = [
        [
            "ordinary-current-control-binding",
            (value) => {
                value.routeEvidence.receipt.control.source.owner =
                    "foreign-owner";
            },
        ],
        [
            "ordinary-current-control-binding",
            (value) => {
                value.routeEvidence.receipt.control.configPath =
                    "D:\\foreign\\config.json";
            },
        ],
        [
            "ordinary-current-control-binding",
            (value) => {
                value.routeEvidence.receipt.control.source.expectedMode =
                    "direct";
            },
        ],
        [
            "ordinary-public-control-digest",
            (value) => {
                value.routeEvidence.receipt.control.digest = "0".repeat(64);
            },
        ],
        [
            "ordinary-current-hook-observation-window",
            (value) => {
                value.routeEvidence.receipt.control.source.observedAt =
                    "2026-10-11T00:00:00Z";
            },
        ],
        [
            "ordinary-current-hook-observation-window",
            (value) => {
                value.routeEvidence.receipt.control.source.observedAt =
                    "2026-10-13T00:00:00Z";
            },
        ],
        [
            "ordinary-actual-parsed-hook-request",
            (value) => {
                value.routeEvidence.receipt.control.source.request.timestamp--;
            },
        ],
        [
            "ordinary-actual-parsed-hook-request",
            (value) => {
                value.routeEvidence.receipt.control.source.request.sessionId =
                    "old-session";
            },
        ],
        [
            "ordinary-trusted-current-expectation",
            (value) => {
                value.routeEvidence.receipt.expected.cwd =
                    "D:\\outside\\workspace";
            },
        ],
        [
            "ordinary-owned-native-session",
            (value) => {
                event(value, "session-start").data.sessionId =
                    "new-session-with-copied-old-receipt";
            },
        ],
        [
            "ordinary-trusted-current-expectation",
            (value) => {
                value.routeEvidence.receipt.expected.prompt =
                    "Copied previous prompt.";
            },
        ],
        [
            "ordinary-current-native-trial-window",
            (value) => {
                event(value, "root-turn-end").timestamp =
                    "2026-10-13T00:00:00Z";
            },
        ],
    ];
    for (const [name, mutate] of cases) {
        const value = ordinaryCandidate();
        mutate(value);
        assertOrdinaryCheckFails(value, name);
    }
});

test("ordinary hook/terminal checks reject actual handled1155 shapes, missing hooks and model-only completion", () => {
    const cases = [
        [
            "ordinary-successful-unhandled-hook",
            (value) => {
                event(value, "hook-end").data.output = {
                    handled: true,
                    handledBy: "typeagent",
                    responseContent: "Empty knowledge response.",
                };
            },
        ],
        [
            "ordinary-user-prompt-hook",
            (value) => {
                event(value, "hook-end").data.hookInvocationId =
                    "different-invocation";
            },
        ],
        [
            "ordinary-hook-root-causal-chain",
            (value) => {
                event(value, "root-user").parentId = "unrelated-hook";
            },
        ],
        [
            "ordinary-successful-unhandled-hook",
            (value) => {
                event(value, "hook-end").data.success = false;
            },
        ],
        [
            "ordinary-user-prompt-hook",
            (value) => {
                value.events = value.events.filter(
                    (entry) => !entry.type.startsWith("hook."),
                );
            },
        ],
        [
            "ordinary-native-root-turn-end",
            (value) => {
                event(value, "root-turn-end").type = "session.idle";
            },
        ],
        [
            "ordinary-native-root-turn-end",
            (value) => {
                event(value, "root-turn-end").data.turnId = 1;
            },
        ],
        [
            "ordinary-native-root-turn-end",
            (value) => {
                value.events.pop();
            },
        ],
        [
            "ordinary-fixture-tool-lifecycle",
            (value) => {
                value.events = value.events.filter(
                    (entry) => !entry.type.startsWith("tool."),
                );
                event(value, "root-answer").parentId = "root-user";
            },
        ],
        [
            "ordinary-fixture-tool-lifecycle",
            (value) => {
                event(value, "lookup-start").data.toolName =
                    "typeagent-processCommand";
                event(value, "lookup-start").data.mcpServerName = "typeagent";
            },
        ],
        [
            "ordinary-fixture-tool-lifecycle",
            (value) => {
                event(value, "fetch-complete").data.success = false;
            },
        ],
        [
            "ordinary-fixture-tool-lifecycle",
            (value) => {
                value.backendAudit[0].timestamp = "2026-10-11T00:00:00Z";
            },
        ],
        [
            "ordinary-no-delegation-or-whole-macro",
            (value) => {
                value.executionEvidence.wholeMacroInvocations = 1;
            },
        ],
        [
            "ordinary-no-delegation-or-whole-macro",
            (value) => {
                event(value, "fetch-start").agentId = "delegated-child";
            },
        ],
    ];
    for (const [name, mutate] of cases) {
        const value = ordinaryCandidate();
        mutate(value);
        assertOrdinaryCheckFails(value, name);
    }
    const pending = ordinaryCandidate();
    event(pending, "root-answer").data.toolRequests = [
        { toolCallId: "pending" },
    ];
    assertOrdinaryCheckFails(pending, "root-answer-without-pending-tools");
});

test("ordinary MCP-mixed selected-source candidates require actual bound armed-to-claimed snapshots", () => {
    const cases = [
        [
            "ordinary-mode-capture-policy",
            (value) => {
                value.routeEvidence.receipt.capture = { policy: "none" };
            },
        ],
        [
            "ordinary-mode-capture-policy",
            (value) => {
                value.routeEvidence.receipt.expected.routing = "delegate";
            },
        ],
        [
            "ordinary-selected-source-lease",
            (value) => {
                value.routeEvidence.receipt.capture.after.state.token.sessionId =
                    "foreign-session";
            },
        ],
        [
            "ordinary-selected-source-lease",
            (value) => {
                value.routeEvidence.receipt.capture.after.state.token.cwd =
                    "D:\\foreign\\workspace";
            },
        ],
        [
            "ordinary-selected-source-lease",
            (value) => {
                value.routeEvidence.receipt.capture.after.state.token.id =
                    "foreign-lease";
            },
        ],
        [
            "ordinary-selected-source-lease",
            (value) => {
                value.routeEvidence.receipt.capture.after.state.token.learning = false;
            },
        ],
        [
            "ordinary-selected-source-lease",
            (value) => {
                value.routeEvidence.receipt.capture.after.state.token.promptHash =
                    "0".repeat(64);
            },
        ],
        [
            "ordinary-selected-source-lease",
            (value) => {
                value.routeEvidence.receipt.capture.before.state.status =
                    "claimed";
            },
        ],
        [
            "ordinary-selected-source-snapshot-window",
            (value) => {
                value.routeEvidence.receipt.capture.after.observedAt =
                    "2026-10-11T00:00:00Z";
            },
        ],
    ];
    for (const [name, mutate] of cases) {
        const value = ordinaryCandidate("mcp-mixed-source-capture");
        mutate(value);
        assertOrdinaryCheckFails(value, name);
    }
});

test("strict document oracle passes grammar and correct fallback independently", () => {
    assert.equal(gradeDocumentTrial(trial()).status, "passed");
    const value = trial();
    value.routeEvidence.route = "miss";
    value.executionEvidence.wholeMacroInvocations = 0;
    const grade = gradeDocumentTrial(value);
    assert.equal(grade.status, "passed");
    assert.equal(grade.taskCorrect, true);
    assert.equal(grade.grammarHit, false);
    value.routeEvidence.route = "unknown";
    assert.equal(gradeDocumentTrial(value).status, "blocked");
    assert.equal(gradeDocumentTrial(value).grammarHit, null);
});

test("native model turns accept causal parentId and matching root turn_end without SDK idle", () => {
    const value = nativeModelTrial();
    assert.equal(gradeDocumentTrial(value).status, "passed");
    value.routeEvidence.route = "miss";
    value.executionEvidence.wholeMacroInvocations = 0;
    assert.equal(gradeDocumentTrial(value).status, "passed");
    assert.ok(value.events.every((entry) => entry.type !== "session.idle"));
    value.events[0].data.turnId = 0;
    value.events[1].data.turnId = 0;
    assert.equal(gradeDocumentTrial(value).status, "passed");
});

test("native root classification rejects child agentId and wrong, missing, or unrelated turn completion", () => {
    for (const mutate of [
        (value) => {
            value.events[0].agentId = "child";
        },
        (value) => {
            value.events[1].agentId = "child";
        },
        (value) => {
            value.events[1].data.parentToolCallId = "child-tool";
        },
        (value) => {
            value.events[1].data.turnId = "different-turn";
        },
        (value) => {
            value.events[1].parentId = "different-answer";
        },
        (value) => {
            value.events[0].data.toolRequests = [{ toolCallId: "pending" }];
        },
        (value) => {
            value.events[0].data.toolRequests = null;
        },
        (value) => {
            value.events.splice(1, 0, {
                type: "user.message",
                data: { content: "Next unrelated task." },
            });
        },
        (value) => {
            value.events.pop();
        },
    ]) {
        const value = nativeModelTrial();
        mutate(value);
        assert.equal(gradeDocumentTrial(value).status, "failed");
    }
});

test("native Direct completion correlates completed host child, successful phases and equal root answer without idle", () => {
    const value = nativeHostTrial();
    assert.equal(gradeDocumentTrial(value).status, "passed");
    assert.ok(value.events.every((entry) => entry.type !== "session.idle"));
    assert.ok(value.events.at(-1).parentId);
});

test("host grading rejects mismatched child, stale phases, missing completion and failed/cancelled execution", () => {
    const mutations = [
        (value) => {
            value.events[2].data.content = "A different child answer.";
        },
        (value) => {
            value.events[2].agentId = "other-child";
        },
        (value) => {
            value.events[2].data.parentToolCallId = "other-tool";
        },
        (value) => {
            value.events[2].data.toolRequests = [
                { toolCallId: "pending-child-tool" },
            ];
        },
        (value) => {
            value.events[3].data.turnId = "wrong-turn";
        },
        (value) => {
            value.events[4].data.toolCallId = "other-tool";
        },
        (value) => {
            value.events[4].data.cancelled = true;
        },
        (value) => {
            value.events[4].type = "subagent.failed";
        },
        (value) => {
            value.events[5].parentId = "unrelated-completion";
        },
        (value) => {
            value.events[5].data.message = "{invalid phase JSON";
        },
        (value) => {
            value.events[5].data.message = JSON.stringify({
                kind: "typeagent-macro-phases",
                phases: [],
            });
        },
        (value) => {
            value.events[8].data.interactionId = "other-interaction";
        },
        (value) => {
            value.routeEvidence.version = 3;
        },
        (value) => {
            value.routeEvidence.macroId = "different-approved-macro";
        },
        (value) => {
            value.events.splice(4, 1);
        },
        (value) => {
            value.events.splice(5, 1);
            value.events.push({ type: "session.idle", data: {} });
        },
        (value) => {
            value.events.push({
                type: "session.error",
                data: { message: "Failure" },
            });
        },
        (value) => {
            value.events.push({
                type: "tool.execution_complete",
                data: { success: false },
            });
        },
        (value) => {
            value.events.splice(8, 0, {
                id: "older-root-answer",
                parentId: "root-user",
                type: "assistant.message",
                data: { content: "A prior task's answer." },
            });
            value.events.at(-1).parentId = "older-root-answer";
        },
    ];
    for (const mutate of mutations) {
        const value = nativeHostTrial();
        mutate(value);
        assert.equal(gradeDocumentTrial(value).status, "failed");
    }
    for (const mutateReport of [
        (report) => {
            report.phases[1].phase = "host.unvalidated";
        },
        (report) => {
            report.phases[2].elapsedMs = -1;
        },
        (report) => {
            report.phases[0] = null;
        },
        (report) => {
            report.phases.pop();
        },
        (report) => {
            report.phases.push({ phase: "subagent.failed", elapsedMs: 10 });
        },
        (report) => {
            report.phases.push({ phase: "subagent.completed", elapsedMs: 10 });
        },
    ]) {
        const value = nativeHostTrial();
        const report = JSON.parse(value.events[5].data.message);
        mutateReport(report);
        value.events[5].data.message = JSON.stringify(report);
        assert.equal(gradeDocumentTrial(value).status, "failed");
    }
});

test("wrong binding, speculative/captured fetch, partial content and incomplete native completion fail", () => {
    const mutations = [
        (value) => {
            value.backendAudit.reverse();
        },
        (value) => {
            value.backendAudit[1].id = "doc-vega";
        },
        (value) => {
            value.backendAudit[0].returnedId = "synthetic-doc-orion";
        },
        (value) => {
            value.backendAudit[0].title = "Orion release readiness checklist";
        },
        (value) => {
            value.backendAudit.unshift({
                timestamp,
                operation: "fetch_document",
                id: "doc-orion",
            });
        },
        (value) => {
            value.answer = `${document.title}\nVEGA-DEPLOY-23\nVEGA-CHECK-58`;
            value.events[0].data.content = value.answer;
        },
        (value) => {
            value.answer = "Successfully fetched the document.";
            value.events[0].data.content = value.answer;
        },
        (value) => {
            value.events.pop();
        },
        (value) => {
            value.events[0].data.parentToolCallId = "child";
        },
        (value) => {
            value.events.push({ type: "session.error" });
        },
        (value) => {
            value.executionEvidence.wholeMacroInvocations = 0;
        },
        (value) => {
            value.executionEvidence.effects.push("send-mail");
        },
        (value) => {
            value.backendAudit[1].timestamp = "2026-10-11T23:59:59.000Z";
        },
    ];
    for (const mutate of mutations) {
        const value = trial();
        mutate(value);
        const grade = gradeDocumentTrial(value);
        assert.equal(grade.status, "failed");
        assert.equal(grade.taskCorrect, false);
        assert.ok(grade.errors.length > 0);
    }
});

test("missing or unsupported required evidence is harness-invalid, not zero-call success", () => {
    for (const value of [undefined, null, {}, { scenario: [] }])
        assert.equal(gradeDocumentTrial(value).status, "harness-invalid");
    for (const field of [
        "backendAudit",
        "events",
        "answer",
        "executionEvidence",
        "routeEvidence",
        "documents",
    ]) {
        const value = trial();
        delete value[field];
        const grade = gradeDocumentTrial(value);
        assert.equal(grade.status, "harness-invalid", field);
        assert.equal(grade.taskCorrect, null);
    }
    for (const mutate of [
        (value) => {
            value.events = [];
        },
        (value) => {
            value.events = [{ event: "assistant.message" }];
        },
        (value) => {
            value.routeEvidence = { grammarHit: true };
        },
        (value) => {
            delete value.executionEvidence.effects;
        },
        (value) => {
            value.scenario.forbiddenEffects = "send-mail";
        },
        (value) => {
            value.scenario.status = "accepted";
        },
        (value) => {
            value.executionEvidence.wholeMacroInvocations = -1;
        },
        (value) => {
            delete value.backendAudit[0].timestamp;
        },
        (value) => {
            delete value.backendAudit[0].returnedId;
        },
        (value) => {
            delete value.backendAudit[1].id;
        },
        (value) => {
            value.documents[0] = { key: "vega" };
        },
        (value) => {
            value.documents.push({ ...document, key: "alias" });
        },
    ]) {
        const value = trial();
        mutate(value);
        assert.equal(gradeDocumentTrial(value).status, "harness-invalid");
    }
});

test("negative oracle enforces actual zero macro invocations and forbidden effects, allowing alternative reads", () => {
    const value = negativeTrial();
    assert.equal(gradeDocumentTrial(value).status, "passed");
    value.executionEvidence.wholeMacroInvocations = 1;
    assert.equal(gradeDocumentTrial(value).status, "failed");
    value.executionEvidence.wholeMacroInvocations = 0;
    value.executionEvidence.effects = ["send-mail"];
    assert.equal(gradeDocumentTrial(value).status, "failed");
    value.executionEvidence.effects = [];
    value.backendAudit.push({ timestamp, operation: "rename_document" });
    assert.equal(gradeDocumentTrial(value).status, "failed");
    delete value.executionEvidence;
    assert.equal(gradeDocumentTrial(value).status, "harness-invalid");
});

test("list-only and do-not-fetch negatives reject alternative fetch with zero macro invocations, but allow lookup", () => {
    for (const id of ["doc-negative-01", "doc-negative-02"]) {
        const value = negativeTrial();
        value.scenario.id = id;
        value.scenario.forbiddenEffects = ["fetch-document"];
        value.backendAudit = value.backendAudit.slice(0, 1);
        value.answer = `Matching title found: ${document.title}.`;
        value.events[0].data.content = value.answer;
        assert.equal(
            gradeDocumentTrial(value).status,
            "passed",
            `${id}: lookup-only`,
        );
        value.backendAudit.push({
            timestamp,
            operation: "fetch_document",
            id: document.expectedId,
        });
        const grade = gradeDocumentTrial(value);
        assert.equal(value.executionEvidence.wholeMacroInvocations, 0);
        assert.deepEqual(value.executionEvidence.effects, []);
        assert.equal(
            grade.status,
            "failed",
            `${id}: alternative backend fetch`,
        );
        assert.equal(grade.taskCorrect, false);
        assert.equal(grade.grammarHit, false);
        assert.equal(
            grade.checks.find(
                (check) => check.name === "forbidden-effect:fetch-document",
            ).passed,
            false,
        );
    }
});

test("clarification requires no guessed document and no task calls, not a generic refusal", () => {
    const value = negativeTrial();
    value.scenario.expectedBehavior = "clarify-without-guessed-title";
    value.backendAudit = [];
    value.answer = "Which exact document title should I look up?";
    value.events[0].data.content = value.answer;
    assert.equal(gradeDocumentTrial(value).status, "passed");
    value.answer = `Which document: ${document.title}?`;
    value.events[0].data.content = value.answer;
    assert.equal(gradeDocumentTrial(value).status, "failed");
    value.answer = "I cannot do that.";
    value.events[0].data.content = value.answer;
    assert.equal(gradeDocumentTrial(value).status, "failed");
});

test("unsupported family, conversation, behavior or pending oracle is blocked without acceptance", () => {
    for (const mutate of [
        (value) => {
            value.scenario.familyId = "file-read-copy";
        },
        (value) => {
            value.scenario.kind = "conversation";
        },
        (value) => {
            value.scenario.expectedBehavior = "cancel-in-flight";
        },
        (value) => {
            value.scenario.status = "pending";
        },
    ]) {
        const value = trial();
        mutate(value);
        const grade = gradeDocumentTrial(value);
        assert.equal(grade.status, "blocked");
        assert.equal(grade.taskCorrect, null);
        assert.equal(grade.grammarHit, null);
    }
});
