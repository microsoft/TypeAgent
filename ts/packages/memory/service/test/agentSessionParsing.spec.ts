// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    agentSessionEventDigest,
    buildAgentSessionEpisodes,
    parseAgentSessionChunk,
} from "../src/agentSessionParsing.js";
import type {
    AgentSessionEvent,
    AgentSessionImportRequest,
} from "../src/agentSessionTypes.js";

function event(overrides: Partial<AgentSessionEvent> = {}): AgentSessionEvent {
    return {
        schemaVersion: 1,
        id: "event-1",
        sessionId: "session-1",
        kind: "message",
        text: "Read the evidence.",
        ...overrides,
    };
}

function request(
    jsonl: string,
    overrides: Partial<AgentSessionImportRequest> = {},
): AgentSessionImportRequest {
    return {
        corpusId: "corpus-1",
        sessionId: "session-1",
        importType: "agent-session-jsonl",
        idempotencyKey: "chunk-1",
        expectedCursor: 0,
        jsonl,
        ...overrides,
    };
}

function sdk(
    type: string,
    data: Record<string, unknown>,
    overrides: Record<string, unknown> = {},
) {
    return {
        id: "sdk-1",
        type,
        timestamp: "2026-10-20T00:00:00.000Z",
        parentId: null,
        data,
        ...overrides,
    };
}

function parseSdk(...events: unknown[]) {
    return parseAgentSessionChunk(
        request(events.map((value) => JSON.stringify(value)).join("\n"), {
            importType: "copilot-session-jsonl",
        }),
    );
}

describe("bounded agent session parsing", () => {
    it("accepts exact canonical events, CRLF, Unicode, and complete final records without LF", () => {
        const input = event({
            text: "Read 日本語 🧭\nThen verify.",
            agentId: "child",
            parentAgentId: "root",
            taskId: "task",
            parentTaskId: "parent",
            turnId: "turn",
            callId: "call",
            role: "assistant",
            timestamp: "2026-10-20T14:00:00+02:00",
        });
        const result = parseAgentSessionChunk(
            request(`\r\n${JSON.stringify(input)}\r\n`),
        );
        expect(result).toEqual({
            events: [{ ...input, outcome: "unknown" }],
            records: 1,
            duplicates: 0,
            losses: [],
        });
    });

    it.each([
        { importType: "text" },
        { expectedCursor: -1 },
        { expectedCursor: Number.MAX_SAFE_INTEGER + 1 },
        { expectedCursor: 1.5 },
        { idempotencyKey: "" },
        { idempotencyKey: " " },
        { idempotencyKey: "x".repeat(201) },
        { corpusId: "../corpus" },
        { sessionId: "bad/session" },
        { final: "yes" },
    ])("rejects invalid request gating %j", (overrides) => {
        expect(() =>
            parseAgentSessionChunk(
                request(
                    JSON.stringify(event()),
                    overrides as Partial<AgentSessionImportRequest>,
                ),
            ),
        ).toThrow();
    });

    it("bounds raw UTF-8 bytes and record count before parsing", () => {
        expect(() =>
            parseAgentSessionChunk(request("🌍".repeat(131_073))),
        ).toThrow("512 KiB");
        expect(() =>
            parseAgentSessionChunk(request(Array(1001).fill("{}").join("\n"))),
        ).toThrow("1000 records");
        const result = parseAgentSessionChunk(
            request(`"${"🌍".repeat(16_384)}"`),
        );
        expect(result.losses).toEqual([
            { line: 1, reason: "JSONL record exceeds 64 KiB" },
        ]);
    });

    it("permits empty chunks only for finalization", () => {
        expect(() => parseAgentSessionChunk(request("\n \r\n"))).toThrow(
            "final",
        );
        expect(
            parseAgentSessionChunk(request("\n \r\n", { final: true })),
        ).toEqual({
            events: [],
            records: 0,
            duplicates: 0,
            losses: [],
        });
    });

    it("receipts malformed and trailing partial records without echoing secret bytes", () => {
        const result = parseAgentSessionChunk(
            request(
                `\n${JSON.stringify(event())}\n{"password":"DO-NOT-RETAIN"\nnot-json`,
            ),
        );
        expect(result.events).toHaveLength(1);
        expect(result.records).toBe(3);
        expect(result.losses.map((loss) => loss.line)).toEqual([3, 4]);
        expect(JSON.stringify(result)).not.toContain("DO-NOT-RETAIN");
        expect(
            result.losses.every((loss) => loss.reason.includes("partial")),
        ).toBe(true);
    });

    it.each([
        { schemaVersion: 2 },
        { sessionId: "other" },
        { kind: "unknown" },
        { role: "developer" },
        { outcome: "completed" },
        { timestamp: "2026-02-30T00:00:00Z" },
        { timestamp: "yesterday" },
        { id: "bad\nidentity" },
        { id: "a".repeat(201) },
        { text: "\u0000" },
        { text: "\ud800" },
        { text: "a".repeat(12_001) },
        { unexpected: "password=PRIVATE" },
    ])("receipts invalid canonical shape %j", (overrides) => {
        const result = parseAgentSessionChunk(
            request(JSON.stringify({ ...event(), ...overrides })),
        );
        expect(result.events).toEqual([]);
        expect(result.records).toBe(1);
        expect(result.losses).toHaveLength(1);
        expect(JSON.stringify(result.losses)).not.toContain("PRIVATE");
    });

    it("counts identical duplicates and rejects changed duplicate content", () => {
        const first = event();
        const equivalent = { ...first, outcome: "unknown" };
        const result = parseAgentSessionChunk(
            request(
                [first, equivalent]
                    .map((value) => JSON.stringify(value))
                    .join("\n"),
            ),
        );
        expect(result.events).toHaveLength(1);
        expect(result.duplicates).toBe(1);
        expect(result.records).toBe(2);
        expect(() =>
            parseAgentSessionChunk(
                request(
                    [first, event({ text: "Changed" })]
                        .map((value) => JSON.stringify(value))
                        .join("\n"),
                ),
            ),
        ).toThrow("Conflicting duplicate");
        expect(() =>
            parseAgentSessionChunk(
                request(
                    [first, event({ taskId: "different" })]
                        .map((value) => JSON.stringify(value))
                        .join("\n"),
                ),
            ),
        ).toThrow("Conflicting duplicate");
    });

    it("redacts identifiers and text before retention and deterministic digests", () => {
        const unsafe = event({
            id: "ghp_abcdefghijklmnop",
            taskId: "token=PRIVATE",
            text: '{"token":"PRIVATE","visible":"日本語","nested":"{\\"password\\":\\"OTHER\\"}"}',
        });
        const safe = parseAgentSessionChunk(request(JSON.stringify(unsafe)))
            .events[0];
        expect(safe.id).toBe("[REDACTED]");
        expect(safe.taskId).toBe("[REDACTED]");
        expect(safe.text).toContain("日本語");
        expect(JSON.stringify(safe)).not.toMatch(/PRIVATE|OTHER|ghp_/);
        expect(agentSessionEventDigest(unsafe)).toBe(
            agentSessionEventDigest(safe),
        );
        expect(agentSessionEventDigest(safe)).toMatch(/^[a-f0-9]{64}$/);
        expect(agentSessionEventDigest(event({ text: "token=one" }))).toBe(
            agentSessionEventDigest(event({ text: "token=two" })),
        );
    });

    it("does not fall back to raw JSON text when redaction nesting is exceeded", () => {
        let text = '{"password":"PRIVATE"}';
        for (let i = 0; i < 35; i++) text = `{"child":${text}}`;
        const result = parseAgentSessionChunk(
            request(JSON.stringify(event({ text }))),
        );
        expect(result.events).toHaveLength(0);
        expect(result.losses).toHaveLength(1);
        expect(JSON.stringify(result)).not.toContain("PRIVATE");
    });
});

describe("explicit Copilot SDK event normalization", () => {
    it("gates formats, versions, unknown types, session mismatches, and timestamps", () => {
        const result = parseSdk(
            event(),
            sdk("unknown", {}),
            sdk("session.start", { version: 2 }),
            sdk("session.start", {}, { version: 2 }),
            sdk("session.start", { sessionId: "other" }),
            sdk("session.start", {}, { timestamp: "not-a-time" }),
            sdk("session.start", {}, { unexpected: true }),
        );
        expect(result.events).toHaveLength(0);
        expect(result.losses).toHaveLength(7);
        expect(
            parseAgentSessionChunk(
                request(JSON.stringify(sdk("user.message", { content: "Hi" }))),
            ).losses,
        ).toHaveLength(1);
    });

    it("keeps explicit summaries but never retains hidden opaque reasoning", () => {
        const result = parseSdk(
            sdk("assistant.reasoning", {
                content: "PRIVATE CHAIN",
                reasoningId: "r",
            }),
            sdk(
                "assistant.reasoning",
                { summary: "Compared two options", content: "PRIVATE CHAIN" },
                { id: "summary" },
            ),
            sdk(
                "assistant.message",
                {
                    content: "Public answer",
                    reasoningOpaque: "OPAQUE",
                    encryptedContent: "CIPHER",
                    reasoningText: "PRIVATE CHAIN",
                },
                { id: "answer" },
            ),
        );
        expect(result.events.map((value) => value.kind)).toEqual([
            "reasoning-summary",
            "message",
        ]);
        expect(result.losses).toHaveLength(3);
        expect(JSON.stringify(result)).not.toMatch(
            /PRIVATE CHAIN|OPAQUE|CIPHER/,
        );
        expect(result.events[0].text).toContain("Compared two options");
    });

    it("preserves tool arguments, model-visible results, call and parent IDs, and failure", () => {
        const result = parseSdk(
            sdk(
                "tool.execution_start",
                {
                    toolCallId: "call-1",
                    toolName: "read",
                    arguments: { path: "file", token: "PRIVATE" },
                    turnId: "turn",
                    parentToolCallId: "outer",
                },
                { id: "start", agentId: "child", parentId: "prior-event" },
            ),
            sdk(
                "tool.execution_complete",
                {
                    toolCallId: "call-1",
                    success: false,
                    result: {
                        content: '{"password":"PRIVATE","answer":false}',
                        detailedContent: "UI",
                    },
                    error: { message: "Read failed" },
                },
                { id: "end", agentId: "child" },
            ),
        );
        expect(result.losses).toEqual([]);
        expect(result.events[0]).toMatchObject({
            kind: "tool-call",
            callId: "call-1",
            turnId: "turn",
            agentId: "child",
            outcome: "unknown",
        });
        expect(result.events[1]).toMatchObject({
            kind: "tool-result",
            callId: "call-1",
            outcome: "failure",
        });
        const start = JSON.parse(result.events[0].text);
        const end = JSON.parse(result.events[1].text);
        expect(start.parentId).toBe("prior-event");
        expect(start.data.parentToolCallId).toBe("outer");
        expect(start.data.arguments).toEqual({
            path: "file",
            token: "[REDACTED]",
        });
        expect(JSON.parse(end.data.result.content)).toEqual({
            password: "[REDACTED]",
            answer: false,
        });
        expect(end.data.arguments).toBeUndefined();
        expect(JSON.stringify(result)).not.toContain("PRIVATE");
    });

    it("does not invent task success from a successful tool, completed subagent, idle, or turn end", () => {
        const result = parseSdk(
            sdk(
                "tool.execution_complete",
                { toolCallId: "call", success: true },
                { id: "tool" },
            ),
            sdk(
                "tool.execution_complete",
                { toolCallId: "call-2" },
                { id: "missing" },
            ),
            sdk("subagent.completed", { toolCallId: "spawn" }, { id: "child" }),
            sdk("session.idle", {}, { id: "idle" }),
            sdk("assistant.turn_end", { turnId: "turn" }, { id: "turn" }),
        );
        expect(result.events.map((value) => value.outcome)).toEqual([
            "success",
            "unknown",
            "unknown",
            "unknown",
            "unknown",
        ]);
        expect(
            result.events.some(
                (value) =>
                    value.kind === "outcome" || value.kind === "verification",
            ),
        ).toBe(false);
    });

    it("maps hierarchy, lifecycle failures, explicit status, cancellation, and compaction", () => {
        const result = parseSdk(
            sdk(
                "subagent.started",
                {
                    toolCallId: "spawn",
                    parentId: "parent-task",
                    taskId: "child-task",
                    parentAgentId: "parent-agent",
                },
                { id: "child", agentId: "child-agent" },
            ),
            sdk(
                "subagent.completed",
                { toolCallId: "spawn", cancelled: true },
                { id: "cancel" },
            ),
            sdk("session.error", { message: "Failed" }, { id: "error" }),
            sdk("abort", { reason: "user_initiated" }, { id: "abort" }),
            sdk(
                "session.shutdown",
                { shutdownType: "error" },
                { id: "shutdown" },
            ),
            sdk(
                "session.compaction_complete",
                { success: true, summaryContent: "Retained summary" },
                { id: "compact" },
            ),
            sdk(
                "tool.execution_complete",
                { toolCallId: "call", status: "failed" },
                { id: "failed" },
            ),
        );
        expect(result.events[0]).toMatchObject({
            agentId: "child-agent",
            parentAgentId: "parent-agent",
            taskId: "child-task",
            parentTaskId: "parent-task",
            callId: "spawn",
            kind: "delegation",
        });
        expect(
            result.events
                .slice(1, 5)
                .every((value) => value.outcome === "failure"),
        ).toBe(true);
        expect(result.events[5]).toMatchObject({
            kind: "compaction",
            outcome: "success",
        });
        expect(result.events[6].outcome).toBe("failure");
        expect(result.losses).toEqual([]);
    });
});

describe("bounded causal agent session episodes", () => {
    it("does not mix interleaved tasks, agents, or sessions and preserves order within each", () => {
        const input = [
            event({
                id: "a1",
                taskId: "a",
                agentId: "child",
                parentAgentId: "root",
                parentTaskId: "parent",
            }),
            event({ id: "b1", taskId: "b", agentId: "child" }),
            event({ id: "a2", taskId: "a", agentId: "child" }),
            event({ id: "root", taskId: "a", agentId: "root" }),
            event({
                id: "session",
                sessionId: "other",
                taskId: "a",
                agentId: "child",
            }),
        ];
        const episodes = buildAgentSessionEpisodes(input);
        expect(
            episodes.map((episode) => episode.events.map((value) => value.id)),
        ).toEqual([["a1", "a2"], ["b1"], ["root"], ["session"]]);
        expect(episodes[0].events[0]).toMatchObject({
            parentAgentId: "root",
            parentTaskId: "parent",
        });
        expect(episodes).toEqual(buildAgentSessionEpisodes(input));
        for (const episode of episodes) {
            expect(episode.episodeId).toMatch(/^[a-f0-9]{64}$/);
            for (const [index, span] of episode.spans.entries()) {
                expect(episode.text.slice(span.start, span.end)).toBe(
                    episode.events[index].text,
                );
            }
        }
    });

    it("packs bounded passages across event boundaries without truncation, including Unicode", () => {
        const input = Array.from({ length: 5 }, (_, index) =>
            event({
                id: `event-${index}`,
                text: `日本語 🧭 ${index}\n${"x".repeat(7000)}`,
            }),
        );
        const episodes = buildAgentSessionEpisodes(input);
        expect(episodes).toHaveLength(3);
        expect(episodes.every((episode) => episode.text.length <= 16_000)).toBe(
            true,
        );
        expect(
            episodes.flatMap((episode) =>
                episode.events.map((value) => value.text),
            ),
        ).toEqual(input.map((value) => value.text));
        expect(new Set(episodes.map((episode) => episode.episodeId)).size).toBe(
            3,
        );
        const changed = buildAgentSessionEpisodes([event({ text: "Changed" })]);
        expect(changed[0].episodeId).not.toBe(
            buildAgentSessionEpisodes([event()])[0].episodeId,
        );
    });

    it("rejects oversized individual events instead of silently splitting or dropping evidence", () => {
        const result = parseAgentSessionChunk(
            request(JSON.stringify(event({ text: "x".repeat(12_001) }))),
        );
        expect(result.events).toEqual([]);
        expect(result.losses).toHaveLength(1);
        expect(() =>
            buildAgentSessionEpisodes([event({ text: "x".repeat(12_001) })]),
        ).toThrow();
        expect(
            buildAgentSessionEpisodes([event({ text: "x".repeat(12_000) })])[0]
                .events[0].text,
        ).toHaveLength(12_000);
    });

    it("redacts independently supplied events and rejects conflicting duplicates", () => {
        const unsafe = event({ text: "password=PRIVATE" });
        const episodes = buildAgentSessionEpisodes([unsafe, { ...unsafe }]);
        expect(episodes[0].events).toHaveLength(1);
        expect(JSON.stringify(episodes)).not.toContain("PRIVATE");
        expect(unsafe.text).toContain("PRIVATE");
        expect(() =>
            buildAgentSessionEpisodes([event(), event({ text: "Changed" })]),
        ).toThrow("Conflicting duplicate");
        expect(buildAgentSessionEpisodes([])).toEqual([]);
    });
});
