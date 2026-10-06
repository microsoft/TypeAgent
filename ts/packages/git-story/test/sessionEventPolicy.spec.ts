// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { SessionEvent } from "@github/copilot-sdk";
import path from "node:path";
import { jest } from "@jest/globals";
import {
    sessionEventPolicies,
    sessionEventPolicy,
    type SessionEventPolicy,
} from "../src/sessionEventPolicy.js";
import {
    SessionWatcher,
    type CapturedSessionUpdates,
    type NormalizedSessionUpdate,
    type SessionWatchRequest,
} from "../src/sessionWatcher.js";

// Adding a type to the installed SDK union fails compilation until classified.
const sdkContract: Record<SessionEvent["type"], SessionEventPolicy> =
    sessionEventPolicies;
const transcriptOnly: Record<
    Exclude<keyof typeof sessionEventPolicies, SessionEvent["type"]>,
    true
> = { "skill.invoked_ref": true, "skill.context_delivered_ref": true };
const request: SessionWatchRequest = {
    projectPath: process.cwd(),
    sessionId: "synthetic-coverage",
    transcriptPath: path.resolve("synthetic-coverage.jsonl"),
    metadata: { clientName: "copilot-cli", models: [] },
};
const watcher = new SessionWatcher();

function captured(
    type: string,
    data: Record<string, unknown>,
): CapturedSessionUpdates {
    return {
        records: [
            {
                id: "native",
                sourceEventId: "native",
                source: {
                    sessionId: request.sessionId,
                    transcriptPath: request.transcriptPath,
                    generation: "g1",
                    sourceByteOffset: "0",
                },
                payload: {
                    type,
                    data,
                    id: "native",
                    parentId: "source-parent",
                    agentId: "agent",
                    timestamp: "2026-10-06T08:00:00Z",
                },
            },
        ],
        diagnostics: [],
        generation: "g1",
        nextCheckpoint: {
            sessionId: request.sessionId,
            transcriptPath: request.transcriptPath,
            sourceByteOffset: "100",
        },
    };
}

function normalize(type: string, data: Record<string, unknown>) {
    return watcher.normalizeEvents(request, captured(type, data));
}

test("every SDK type has an explicit policy; prototype names and future types are unknown", () => {
    expect(Object.keys(sdkContract)).toHaveLength(133);
    expect(Object.keys(transcriptOnly)).toHaveLength(2);
    for (const type of Object.keys(sdkContract))
        expect(sessionEventPolicy(type)).toBeDefined();
    expect(sessionEventPolicy("constructor")).toBeUndefined();
    const unknown = normalize("future.SECRET", { content: "SECRET" });
    expect(unknown.events).toEqual([]);
    expect(unknown.diagnostics).toEqual([
        {
            code: "unsupported-event",
            source: captured("", {}).records[0]!.source,
        },
    ]);
    expect(JSON.stringify(unknown.diagnostics)).not.toContain("SECRET");
});

test.each(
    Object.entries(sessionEventPolicies).filter(
        ([, policy]) => policy === "ignore",
    ),
)(
    "explicitly ignores %s without parsing or retaining private content",
    (type) => {
        const batch = normalize(type, {
            content: "SECRET",
            reasoningText: "SECRET",
            encryptedContent: "SECRET",
        });
        expect(batch.events).toEqual([]);
        expect(batch.diagnostics).toEqual([]);
        expect(batch.lastEventTimestamp).toBe("2026-10-06T08:00:00Z");
    },
);

test.each([
    [
        "hook.end",
        {
            success: false,
            error: { message: "failed" },
            hookInvocationId: "h",
            input: "PRIVATE",
            output: "PRIVATE",
        },
        { success: true },
        ["error"],
    ],
    [
        "permission.completed",
        {
            requestId: "r",
            result: {
                kind: "denied-interactively-by-user",
                feedback: "declined",
            },
        },
        { result: { kind: "approved" } },
        ["result"],
    ],
    [
        "model.call_finished",
        { outcome: "cancelled", turnId: "turn" },
        { outcome: "success" },
        ["outcome"],
    ],
    [
        "mcp.oauth_completed",
        { outcome: "cancelled", requestId: "r" },
        { outcome: "token" },
        ["outcome"],
    ],
    [
        "mcp.headers_refresh_completed",
        { outcome: "timeout", requestId: "r" },
        { outcome: "headers" },
        ["outcome"],
    ],
    [
        "session.mcp_server_status_changed",
        { status: "failed", error: "connection failed", serverName: "s" },
        { status: "connected" },
        ["error"],
    ],
] satisfies [
    string,
    Record<string, unknown>,
    Record<string, unknown>,
    string[],
][])(
    "%s retains schema-backed operational failure but ignores routine success",
    (type, failure, success, fields) => {
        const batch = normalize(type, failure);
        expect(batch.diagnostics).toEqual([]);
        expect(batch.events).toHaveLength(1);
        const event = batch.events[0]!;
        if (event.type !== "session")
            throw new Error("Expected projected details");
        const evidence: Record<string, unknown> = failure;
        for (const field of fields)
            expect(event.details[field]).toEqual(evidence[field]);
        expect(JSON.stringify(event)).not.toContain("PRIVATE");
        const ignored = normalize(type, success);
        expect(ignored.events).toEqual([]);
        expect(ignored.diagnostics).toEqual([]);
    },
);

test.each([
    ["permission.completed", { result: { kind: "cancelled" } }],
    [
        "permission.completed",
        {
            result: {
                kind: "denied-by-content-exclusion-policy",
                path: "synthetic",
            },
        },
    ],
    ["model.call_finished", { outcome: "error" }],
    ["model.call_finished", { outcome: "rejected" }],
    ["mcp.headers_refresh_completed", { outcome: "none" }],
    ["session.mcp_server_status_changed", { status: "needs-auth" }],
] satisfies [string, Record<string, unknown>][])(
    "retains %s alternative failure outcome",
    (type, data) => {
        expect(normalize(type, data).events).toHaveLength(1);
    },
);

test("external requests use native correlations and request-only receipts never invent results", () => {
    const external: Extract<
        SessionEvent,
        { type: "external_tool.requested" }
    >["data"] = {
        sessionId: request.sessionId,
        requestId: "r1",
        toolCallId: "tool1",
        toolName: "search",
        arguments: { query: "synthetic" },
        providerId: null,
        workingDirectory: request.projectPath,
    };
    const receipt: Extract<
        SessionEvent,
        { type: "external_tool.completed" }
    >["data"] = { requestId: "r1" };
    const start = normalize("external_tool.requested", { ...external })
        .events[0]!;
    expect(start).toMatchObject({
        type: "tool-start",
        eventType: "external_tool.requested",
        toolCallId: "tool1",
        requestId: "r1",
        arguments: external.arguments,
        providerId: null,
    });
    const complete = normalize("external_tool.completed", { ...receipt })
        .events[0]!;
    expect(complete).toMatchObject({
        type: "session",
        eventType: "external_tool.completed",
        requestId: "r1",
        details: { requestId: "r1" },
    });
    for (const key of ["success", "toolCallId", "result", "output"]) {
        expect(complete).not.toHaveProperty(key);
        if (complete.type === "session")
            expect(complete.details).not.toHaveProperty(key);
    }
    const result = normalize("tool.execution_complete", {
        toolCallId: "tool1",
        success: true,
        result: { content: "actual result", structuredContent: { rows: [1] } },
    });
    expect(result.events[0]).toMatchObject({
        toolCallId: "tool1",
        output: "actual result",
        structuredContent: { rows: [1] },
    });
});

const projectedFixtures: [string, Record<string, unknown>][] = [
    [
        "skill.invoked",
        {
            name: "test",
            path: "skill.md",
            content: "instructions",
            allowedTools: ["view"],
        },
    ],
    [
        "skill.invoked_ref",
        {
            name: "test",
            contentId: "c1",
            contentLength: 10,
            pluginName: null,
            invokedAtTurn: 3,
        },
    ],
    [
        "skill.context_delivered_ref",
        {
            contentId: "c1",
            interactionId: "i1",
            source: "skill",
            prefix: "prefix",
            suffix: "suffix",
        },
    ],
    [
        "subagent.started",
        {
            agentName: "worker",
            parentId: "parent",
            toolCallId: "t1",
            factoryRunId: "f1",
        },
    ],
    [
        "subagent.configured",
        {
            model: "m1",
            multiTurn: true,
            contextTier: "long_context",
            reasoningEffort: "high",
        },
    ],
    ["subagent.selected", { agentName: "worker", tools: ["view"] }],
    [
        "subagent.failed",
        { agentName: "worker", toolCallId: "t1", error: "failed" },
    ],
    [
        "system.notification",
        {
            content: "task completed",
            kind: {
                type: "agent_completed",
                agentId: "a1",
                agentType: "task",
                status: "completed",
            },
        },
    ],
    [
        "user_input.requested",
        {
            question: "which?",
            choices: ["one"],
            requestId: "r1",
            toolCallId: "t1",
        },
    ],
    [
        "user_input.completed",
        { requestId: "r1", answer: "one", wasFreeform: false },
    ],
    [
        "elicitation.requested",
        {
            requestId: "r1",
            message: "provide input",
            requestedSchema: {
                type: "object",
                properties: { name: { type: "string" } },
            },
        },
    ],
    [
        "elicitation.completed",
        { requestId: "r1", action: "accept", content: { name: "synthetic" } },
    ],
    [
        "exit_plan_mode.requested",
        {
            requestId: "r1",
            planContent: "plan",
            summary: "summary",
            actions: ["interactive"],
        },
    ],
    [
        "exit_plan_mode.completed",
        { requestId: "r1", approved: false, feedback: "revise" },
    ],
    [
        "command.execute",
        {
            requestId: "r1",
            commandName: "model",
            command: "/model m1",
            args: "m1",
        },
    ],
    [
        "session.context_cleared",
        { messagesCleared: 4, initialMessage: "new task" },
    ],
    [
        "session.compaction_complete",
        {
            success: true,
            summaryContent: "work summary",
            checkpointPath: "checkpoint",
        },
    ],
    [
        "session.task_complete",
        { success: false, summary: "blocked", reason: "missing dependency" },
    ],
    [
        "session.workspace_file_changed",
        { operation: "update", path: "file.ts" },
    ],
    [
        "session.schedule_created",
        { id: 1, prompt: "synthetic task", intervalMs: 1000 },
    ],
    ["session.snapshot_rewind", { eventsRemoved: 2, upToEventId: "prior" }],
    [
        "session.autopilot_objective_changed",
        { id: 1, operation: "update", status: "completed" },
    ],
    [
        "session.fusion_route_failed",
        { reason: "unavailable", fallbackModel: "m1" },
    ],
    [
        "assistant.fusion_phase_failed",
        { phaseId: "p1", reason: "failed", status: "failed" },
    ],
    [
        "model.call_failure",
        { errorMessage: "unavailable", failureKind: "error", model: "m1" },
    ],
    ["abort", { reason: "user" }],
    [
        "factory.run_settled",
        { runId: "f1", status: "failed", failureType: "timeout" },
    ],
    [
        "mcp_app.tool_call_complete",
        {
            toolName: "view",
            serverName: "server",
            success: false,
            arguments: { path: "x" },
            error: { message: "missing" },
            result: { structuredContent: { x: 1 } },
        },
    ],
    [
        "external_tool.completed",
        {
            requestId: "r1",
            success: false,
            result: { contents: [{ text: "evidence" }] },
            error: { message: "partial" },
        },
    ],
];

test.each(projectedFixtures)(
    "%s retains selected evidence, not private reasoning or unknown payload",
    (type, data) => {
        const batch = normalize(type, {
            ...data,
            reasoningText: "PRIVATE",
            responsesReasoning: { secret: "PRIVATE" },
            encryptedContent: "PRIVATE",
            unrecognized: "PRIVATE",
        });
        expect(batch.diagnostics).toEqual([]);
        expect(batch.events).toHaveLength(1);
        expect(batch.events[0]).toMatchObject({
            type: "session",
            eventType: type,
            details: data,
        });
        expect(JSON.stringify(batch.events)).not.toContain("PRIVATE");
    },
);

test("messages preserve reference attachments and tool relationships without reasoning or binary copies", () => {
    const data = {
        content: "answer",
        messageId: "m1",
        originatingMessageId: "m0",
        parentToolCallId: "t0",
        parentAgentTaskId: "a0",
        interactionId: "i1",
        turnId: "turn1",
        attachments: [
            { type: "file", path: "file.ts", lineRange: { start: 1, end: 2 } },
            {
                type: "blob",
                assetId: "asset",
                mimeType: "image/png",
                data: "PRIVATE",
            },
        ],
        toolRequests: [
            { toolCallId: "t1", name: "view", arguments: { path: "file.ts" } },
        ],
        citations: { entries: [{ url: "https://example.test" }] },
        reasoningText: "PRIVATE",
        reasoningBlocks: ["PRIVATE"],
        encryptedContent: "PRIVATE",
    };
    const batch = normalize("assistant.message", data);
    expect(batch.diagnostics).toEqual([]);
    expect(batch.events[0]).toMatchObject({
        type: "message",
        text: "answer",
        parentId: "source-parent",
        parentToolCallId: "t0",
        parentAgentTaskId: "a0",
        messageId: "m1",
        originatingMessageId: "m0",
        interactionId: "i1",
        turnId: "turn1",
        attachments: [
            data.attachments[0],
            { type: "blob", assetId: "asset", mimeType: "image/png" },
        ],
        toolRequests: data.toolRequests,
        citations: data.citations,
    });
    expect(JSON.stringify(batch.events)).not.toContain("PRIVATE");
    const tool = normalize("tool.execution_start", {
        toolCallId: "t1",
        toolName: "view",
        parentToolCallId: "t0",
        turnId: "turn1",
        mcpServerName: "server",
        mcpToolName: "view",
    }).events[0];
    expect(tool).toMatchObject({
        parentToolCallId: "t0",
        turnId: "turn1",
        mcpServerName: "server",
        mcpToolName: "view",
    });
});

test("opaque new evidence is independently cloned and the whole update is privacy gated", async () => {
    const cases: [string, Record<string, unknown>][] = [
        [
            "user.message",
            {
                content: "PRIVATE",
                attachments: [
                    {
                        type: "file",
                        path: "PRIVATE",
                        lineRange: { start: 1, end: 2 },
                    },
                ],
            },
        ],
        [
            "assistant.message",
            {
                content: "PRIVATE",
                toolRequests: [
                    { toolCallId: "PRIVATE", arguments: { secret: "PRIVATE" } },
                ],
                citations: { links: ["PRIVATE"] },
            },
        ],
        [
            "external_tool.requested",
            {
                requestId: "PRIVATE",
                toolCallId: "PRIVATE",
                toolName: "PRIVATE",
                arguments: { secret: "PRIVATE" },
            },
        ],
        [
            "tool.execution_complete",
            {
                toolCallId: "PRIVATE",
                success: true,
                mcpMeta: { data: ["PRIVATE"] },
                result: {
                    content: "PRIVATE",
                    citableSources: [{ id: "PRIVATE", content: "PRIVATE" }],
                    mcpMeta: { result: ["PRIVATE"] },
                },
            },
        ],
        ...projectedFixtures,
    ];
    const destination = jest.fn<(update: NormalizedSessionUpdate) => void>();
    for (const [type, original] of cases) {
        const data = structuredClone(original);
        const updates = captured(type, data);
        const batch = watcher.normalizeEvents(request, updates);
        const before = structuredClone(batch.events);
        // Mutate every nested source container, then every nested output container.
        function mutate(value: unknown): void {
            if (!value || typeof value !== "object") return;
            for (const child of Object.values(value)) mutate(child);
            Object.assign(value, { mutated: "PRIVATE MUTATION" });
        }
        mutate(data);
        expect(batch.events).toEqual(before);
        const mutatedSource = structuredClone(data);
        mutate(batch.events);
        expect(data).toEqual(mutatedSource);
        const filter = jest.fn((input: NormalizedSessionUpdate) => {
            expect(input.events).toEqual(before);
            return {
                projectPath: "redacted",
                sessionId: "redacted",
                metadata: { clientName: "redacted", models: [] },
                events: [],
            };
        });

        const gated = new SessionWatcher({
            privacyFilter: filter,
            approvedUpdateDestination: destination,
        });
        const approved = await gated.filterForPrivacy({
            projectPath: request.projectPath,
            sessionId: request.sessionId,
            metadata: request.metadata,
            events: before,
        });
        if (!approved) throw new Error("Expected approval");
        await gated.publishUpdate(approved);
        expect(filter).toHaveBeenCalledTimes(1);
    }
    expect(destination).toHaveBeenCalledTimes(cases.length);
    expect(JSON.stringify(destination.mock.calls)).not.toContain("PRIVATE");
});

test("retains distinct tool citation and MCP metadata without UI/binary payload copies", () => {
    const data = {
        toolCallId: "t1",
        success: true,
        mcpMeta: { data: [1] },
        result: {
            content: "answer",
            citableSources: [
                {
                    id: "c1",
                    content: "citation",
                    url: "https://example.test",
                },
            ],
            mcpMeta: { result: [2] },
            binaryResultsForLlm: [{ data: "OMIT" }],
            uiResource: { html: "OMIT" },
        },
    };
    const batch = normalize("tool.execution_complete", data);
    expect(batch.events[0]).toMatchObject({
        output: "answer",
        mcpMeta: data.mcpMeta,
        citableSources: data.result.citableSources,
        resultMcpMeta: data.result.mcpMeta,
    });
    expect(JSON.stringify(batch.events)).not.toContain("OMIT");
});

test.each([
    ["external_tool.requested", { toolCallId: "t", toolName: "x" }],
    [
        "external_tool.requested",
        {
            requestId: "r",
            toolCallId: "t",
            toolName: "x",
            providerId: 1,
        },
    ],
    ["external_tool.completed", {}],
    ["user.message", { content: "text", attachments: {} }],
    ["user.message", { content: "text", attachments: [{ type: 1 }] }],
    ["assistant.message", { content: "text", parentToolCallId: 1 }],
    [
        "tool.execution_start",
        { toolCallId: "t", toolName: "x", mcpServerName: 1 },
    ],
] satisfies [string, Record<string, unknown>][])(
    "%s diagnoses malformed consumed fields without leaking content",
    (type, data) => {
        const batch = normalize(type, data);
        expect(batch.events).toEqual([]);
        expect(batch.diagnostics).toEqual([
            {
                code: "malformed-event",
                source: captured("", {}).records[0]!.source,
            },
        ]);
    },
);

const outcomeSamples = {
    "hook.end": {
        keep: {
            hookInvocationId: "h1",
            hookType: "postToolUse",
            success: false,
            error: { message: "failed" },
        },
        ignore: {
            hookInvocationId: "h1",
            hookType: "postToolUse",
            success: true,
        },
    },
    "permission.completed": {
        keep: {
            requestId: "r1",
            result: {
                kind: "denied-by-permission-request-hook",
                message: "denied",
            },
        },
        ignore: { requestId: "r1", result: { kind: "approved" } },
    },
    "model.call_finished": {
        keep: {
            dispatchDurationMs: 100,
            editClassifierVersion: 1,
            outcome: "rejected",
            turnId: "t1",
        },
        ignore: {
            dispatchDurationMs: 100,
            editClassifierVersion: 1,
            outcome: "success",
            turnId: "t1",
        },
    },
    "mcp.oauth_completed": {
        keep: { requestId: "r1", outcome: "cancelled" },
        ignore: { requestId: "r1", outcome: "token" },
    },
    "mcp.headers_refresh_completed": {
        keep: { requestId: "r1", outcome: "timeout" },
        ignore: { requestId: "r1", outcome: "headers" },
    },
    "session.mcp_server_status_changed": {
        keep: {
            serverName: "server",
            status: "failed",
            error: "failed",
        },
        ignore: { serverName: "server", status: "connected" },
    },
} satisfies Partial<{
    [K in SessionEvent["type"]]: {
        keep: Extract<SessionEvent, { type: K }>["data"];
        ignore: Extract<SessionEvent, { type: K }>["data"];
    };
}>;

test.each(Object.entries(outcomeSamples))(
    "%s outcome samples follow the actual SDK schema",
    (type, samples) => {
        expect(normalize(type, samples.keep).events).toHaveLength(1);
        expect(normalize(type, samples.ignore).events).toHaveLength(0);
    },
);
test("observes explicit models without retaining usage or private reasoning", () => {
    const batch = normalize("assistant.usage", {
        model: "m1",
        inputTokens: 100,
        cost: 5,
        reasoningText: "PRIVATE",
    });
    expect(batch.events[0]).toMatchObject({
        type: "session",
        details: { model: "m1" },
    });
    expect(JSON.stringify(batch.events)).not.toMatch(
        /inputTokens|cost|PRIVATE/,
    );
    const state = watcher.collectMetadata(request, batch);
    for (const [type, data] of [
        ["session.auto_mode_resolved", { chosenModel: "m2" }],
        ["session.fusion_route_failed", { fallbackModel: "m3" }],
        ["session.shutdown", { currentModel: "m4" }],
    ] satisfies [string, Record<string, unknown>][]) {
        const next = watcher.collectMetadata(
            request,
            normalize(type, data),
            state,
        );
        expect(next.metadata.models).toEqual(["m1", ...Object.values(data)]);
    }
});
