// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { test } from "node:test";
import { CopilotSession } from "@github/copilot-sdk";
import {
    candidateToolBoundary,
    pendingInteractionGate,
    callCorrelation,
    toolEvidenceViews,
    executionRouteViolation,
} from "../ghcp-eval-boundary.mjs";
import {
    isClarificationQuestion,
    fileConsentContext,
} from "../ghcp-eval-corpus.mjs";

const metadata = (tools) => ({
    rpc: {
        tools: {
            initializeAndValidate: async () => {},
            getCurrentMetadata: async () => ({ tools }),
        },
    },
});
const nl = { id: 1, tools: ["typeagent-processCommand"] };
const inventory = [
    { name: "ask_user" },
    {
        name: "typeagent-e2e-typeagent-processCommand",
        namespacedName: "functions.typeagent-e2e-typeagent-processCommand",
        mcpServerName: "typeagent-e2e",
        mcpToolName: "typeagent-processCommand",
    },
];
const structured = {
    id: 3,
    tools: [
        "typeagent-searchActions",
        "typeagent-executeAction",
        "typeagent-continueAction",
        "typeagent-cancelAction",
    ],
};

test("terminal stops and C4 phase routing never imply replay or renewed discovery", () => {
    const c4 = { ...structured, id: 4 };
    assert.equal(
        executionRouteViolation(
            "typeagent-e2e-typeagent-executeAction",
            c4,
            true,
            false,
        ),
        "reuse_preparation_contract",
    );
    assert.equal(
        executionRouteViolation(
            "typeagent-e2e-typeagent-searchActions",
            c4,
            false,
            false,
        ),
        "reuse_preparation_contract",
    );
    assert.equal(
        executionRouteViolation(
            "typeagent-e2e-typeagent-searchActions",
            structured,
            false,
            false,
        ),
        undefined,
    );
    assert.equal(
        executionRouteViolation(
            "typeagent-e2e-typeagent-executeAction",
            c4,
            false,
            true,
        ),
        "terminal_execution_stop",
    );
    assert.equal(
        executionRouteViolation(
            "typeagent-e2e-typeagent-cancelAction",
            c4,
            false,
            true,
        ),
        undefined,
    );
});

test("A5 accepts measured filename questions but never consents or unrelated questions", () => {
    for (const question of [
        "Which filename inside `workspace` should I read?",
        "What is the exact filename in that `workspace` directory that you want me to read?",
        "Which file name do you mean?",
        "Which file should I read?",
    ])
        assert.equal(isClarificationQuestion("A5", question), true, question);
    for (const question of [
        "Confirm which filename to read?",
        "Approve reading that file?",
        "Run or Cancel?",
        "What is your name?",
        "Which profile should I load?",
        "Read trip.txt?",
        "Allow access to that filename?",
    ])
        assert.equal(isClarificationQuestion("A5", question), false, question);
});

test("every candidate has a closed source-qualified allowlist, never wildcard MCP", async () => {
    for (const candidate of [
        nl,
        { ...nl, id: 2 },
        structured,
        { ...structured, id: 4 },
        { id: 5, tools: [...nl.tools, ...structured.tools] },
        { id: 6, tools: [...nl.tools, ...structured.tools] },
        { id: 7 },
    ]) {
        const boundary = candidateToolBoundary(candidate, [
            "builtin:ask_user",
            "builtin:view",
        ]);
        assert.equal(
            boundary.availableTools.some((name) => name.includes("*")),
            false,
        );
        const tools = [
            { name: "ask_user" },
            ...(candidate.id >= 5 ? [{ name: "view" }] : []),
            ...(candidate.tools ?? []).map((tool) => ({
                name: `typeagent-e2e-${tool}`,
                mcpServerName: "typeagent-e2e",
                mcpToolName: tool,
            })),
        ];
        assert.equal(boundary.check("ask_user"), false);
        await boundary.initialize(metadata(tools));
        assert.equal(boundary.check("ask_user"), true);
        for (const offRoute of [
            "web_search",
            "github-mcp-server-get_file_contents",
            "unknown-typeagent-processCommand",
            "task",
            "evil_ask_user",
            "typeagent-e2e-typeagent-deleteEverything",
        ])
            assert.equal(boundary.check(offRoute), false);
        assert.equal(boundary.check("view"), candidate.id >= 5);
    }
    for (const tools of [
        null,
        [],
        [...inventory, { name: "web_search" }],
        [{ name: "ask_user" }],
        [
            ...inventory,
            {
                name: "view",
                mcpServerName: "github-mcp-server",
                mcpToolName: "get_file_contents",
            },
        ],
    ])
        await assert.rejects(() =>
            candidateToolBoundary(nl, []).initialize(metadata(tools)),
        );
    await assert.rejects(() =>
        candidateToolBoundary(nl, []).initialize({ rpc: {} }),
    );
});

test("installed SDK pre-tool hook returns denial before mocked effects and audit requires matching evidence", async () => {
    const boundary = candidateToolBoundary(nl, []);
    await boundary.initialize(metadata(inventory));
    const session = new CopilotSession("offline", {
        sendRequest: () => {
            throw new Error("No runtime calls permitted");
        },
    });
    session.registerHooks({
        onPreToolUse: (input) => {
            const allowed = boundary.check(input.toolName);
            boundary.recordDecision(input.toolName, input.toolArgs, allowed);
            return { permissionDecision: allowed ? "allow" : "deny" };
        },
    });
    let effects = 0;
    for (const toolName of [
        "web_search",
        "github-mcp-server-get_file_contents",
        inventory[1].name,
    ]) {
        const answer = await session._handleHooksInvoke("preToolUse", {
            sessionId: "offline",
            timestamp: new Date().toISOString(),
            workingDirectory: "fixture",
            toolName,
            toolArgs: { query: "synthetic" },
        });
        if (answer.permissionDecision !== "deny") effects++;
        assert.equal(
            boundary.audit(toolName, { query: "synthetic" }),
            toolName === inventory[1].name,
        );
    }
    assert.equal(effects, 1);
    assert.throws(() => boundary.audit("web_search", {}), /Missing pre-tool/);
    boundary.recordDecision(inventory[1].name, { a: 1, b: 2 }, true);
    assert.equal(boundary.hasActiveDomainCall(), true);
    assert.throws(
        () => boundary.audit(inventory[1].name, { a: 2 }),
        /Missing pre-tool/,
    );
    assert.equal(boundary.audit(inventory[1].name, { b: 2, a: 1 }), true);
    assert.equal(boundary.hasActiveDomainCall(), false);
    boundary.recordDecision(inventory[1].namespacedName, {}, true);
    assert.equal(boundary.audit(inventory[1].name, {}), true);
    session._markDisconnected();
});

test("pending contract prohibits a second execute, stale/wrong handles and unfinished final answer", () => {
    const gate = pendingInteractionGate();
    const handles = {
        scopeId: "scope",
        operationId: "operation",
        interactionId: "interaction",
    };
    gate.observe({
        structuredContent: { status: "requires_interaction", ...handles },
    });
    assert.match(
        gate.reason("typeagent-e2e-typeagent-executeAction", {}),
        /pending interaction/,
    );
    assert.equal(gate.reason("ask_user", {}), undefined);
    for (const key of Object.keys(handles))
        assert.match(
            gate.reason("typeagent-e2e-typeagent-continueAction", {
                ...handles,
                [key]: "wrong",
            }),
            /handles/,
        );
    assert.equal(
        gate.reason("typeagent-e2e-typeagent-continueAction", handles),
        undefined,
    );
    assert.equal(
        gate.reason("typeagent-e2e-typeagent-cancelAction", handles),
        undefined,
    );
    assert.throws(() => gate.assertSettled(), /unresolved/);
    gate.observe({ structuredContent: { status: "completed" } });
    assert.doesNotThrow(() => gate.assertSettled());
    assert.throws(
        () =>
            gate.observe({
                structuredContent: { status: "requires_interaction" },
            }),
        /missing/,
    );
    gate.clear();
});

test("private evidence redaction cannot erase active confirmation context", () => {
    const action = {
        schemaName: "powershell.powershell-files",
        actionName: "readFile",
        parameters: { path: "private-artifact" },
    };
    const event = {
        toolCallId: "call",
        success: true,
        result: {
            structuredContent: {
                status: "requires_interaction",
                scopeId: "s",
                operationId: "o",
                interactionId: "i",
                prompt: { type: "confirmation", action },
                output: ["private-network-value"],
            },
        },
    };
    const views = toolEvidenceViews(event, true);
    assert.doesNotMatch(
        JSON.stringify(views.persisted),
        /private-network-value|private-artifact/,
    );
    const tools = [
        {
            toolCallId: "call",
            name: "typeagent-e2e-typeagent-executeAction",
            endMs: 1,
        },
    ];
    assert.equal(
        fileConsentContext(tools, [views.persisted], [], {}).action,
        undefined,
    );
    assert.deepEqual(
        fileConsentContext(tools, [views.consent], [], {}).action,
        action,
    );
    const correlation = callCorrelation(
        { caseId: "S5", candidate: 3, sessionId: "private-session" },
        {
            toolCallId: "private-call",
            arguments: {
                scopeId: "private-scope",
                operationId: "private-operation",
                interactionId: "private-interaction",
                content: "private-text",
            },
        },
        4,
    );
    assert.doesNotMatch(JSON.stringify(correlation), /private-/);
    assert.equal(correlation.scopeSha256.length, 64);
    assert.equal(correlation.callSequence, 4);
});

test("SDK backend-only output or empty final presentation never becomes a successful answer", async () => {
    for (const emptyMessage of [false, true]) {
        let session;
        session = new CopilotSession("offline", {
            sendRequest: async () => {
                session._dispatchEvent({
                    type: "tool.execution_complete",
                    data: { result: { content: "complete backend result" } },
                });
                if (emptyMessage)
                    session._dispatchEvent({
                        type: "assistant.message",
                        data: { content: "" },
                    });
                session._dispatchEvent({ type: "session.idle", data: {} });
                return {};
            },
        });
        const answer = await session.sendAndWait("synthetic", 1000);
        assert.equal(answer?.data.content ?? "", "");
        session._markDisconnected();
    }
});

test("SDK final-message delivery preserves content without promoting backend output to a final answer", async () => {
    let session;
    const connection = {
        sendRequest: async (method) => {
            assert.equal(method, "session.send");
            session._dispatchEvent({
                type: "assistant.message",
                data: { content: "Intermediate" },
            });
            session._dispatchEvent({
                type: "tool.execution_complete",
                data: { result: { content: "backend output" } },
            });
            session._dispatchEvent({
                type: "assistant.message",
                data: { content: "Faithful final presentation" },
            });
            session._dispatchEvent({ type: "session.idle", data: {} });
            return {};
        },
    };
    session = new CopilotSession("offline", connection);
    const result = await session.sendAndWait({ prompt: "synthetic" }, 1000);
    assert.equal(result.data.content, "Faithful final presentation");
    session._markDisconnected();
});
