// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    computeEntryId,
    displayLogToCorpusEntries,
    type CaptureLogEntry,
    type CorpusEntry,
} from "../src/corpus/index.js";

const SOURCE = "/logs/displayLog.json";

function transform(
    entries: CaptureLogEntry[],
    opts: Partial<Parameters<typeof displayLogToCorpusEntries>[1]> = {},
): CorpusEntry[] {
    return displayLogToCorpusEntries(entries, {
        sourceUri: SOURCE,
        now: () => 1000,
        ...opts,
    });
}

function req(id: string) {
    return { requestId: id };
}

describe("displayLogToCorpusEntries", () => {
    test("maps a single request to one entry with utterance, agent, action", () => {
        const entries: CaptureLogEntry[] = [
            {
                type: "user-request",
                seq: 0,
                requestId: req("r1"),
                command: "play jazz",
            },
            {
                type: "set-display-info",
                seq: 1,
                requestId: req("r1"),
                source: "player",
                actionIndex: 0,
                action: { actionName: "play", parameters: { genre: "jazz" } },
            },
        ];
        const out = transform(entries);
        expect(out).toHaveLength(1);
        expect(out[0]).toMatchObject({
            id: computeEntryId("play jazz", "player"),
            utterance: "play jazz",
            agent: "player",
            source: "captures",
            expectedAction: {
                actionName: "play",
                parameters: { genre: "jazz" },
            },
        });
        expect(out[0].provenance).toMatchObject({
            sourceUri: SOURCE,
            capturedAt: 1000,
            requestId: "r1",
        });
        expect(out[0].feedback).toBeUndefined();
    });

    test("buckets a mixed session per agent", () => {
        const entries: CaptureLogEntry[] = [
            {
                type: "user-request",
                seq: 0,
                requestId: req("r1"),
                command: "play jazz",
            },
            {
                type: "set-display-info",
                seq: 1,
                requestId: req("r1"),
                source: "player",
                action: { actionName: "play" },
            },
            {
                type: "user-request",
                seq: 2,
                requestId: req("r2"),
                command: "add milk",
            },
            {
                type: "set-display-info",
                seq: 3,
                requestId: req("r2"),
                source: "list",
                action: { actionName: "addItem" },
            },
        ];
        const out = transform(entries);
        expect(out.map((e) => e.agent).sort()).toEqual(["list", "player"]);
    });

    test("captures a multi-action request as an ordered sequence", () => {
        const entries: CaptureLogEntry[] = [
            {
                type: "user-request",
                seq: 0,
                requestId: req("r1"),
                command: "do two things",
            },
            {
                type: "set-display-info",
                seq: 2,
                requestId: req("r1"),
                source: "player",
                actionIndex: 1,
                action: { actionName: "second" },
            },
            {
                type: "set-display-info",
                seq: 1,
                requestId: req("r1"),
                source: "player",
                actionIndex: 0,
                action: { actionName: "first" },
            },
        ];
        const out = transform(entries);
        expect(out).toHaveLength(1);
        expect(out[0].expectedAction).toEqual([
            { actionName: "first" },
            { actionName: "second" },
        ]);
    });

    test("orders multi-action by seq when actionIndex is absent", () => {
        const entries: CaptureLogEntry[] = [
            {
                type: "user-request",
                seq: 0,
                requestId: req("r1"),
                command: "two",
            },
            {
                type: "set-display-info",
                seq: 5,
                requestId: req("r1"),
                source: "player",
                action: { actionName: "b" },
            },
            {
                type: "set-display-info",
                seq: 3,
                requestId: req("r1"),
                source: "player",
                action: { actionName: "a" },
            },
        ];
        const out = transform(entries);
        expect(out[0].expectedAction).toEqual([
            { actionName: "a" },
            { actionName: "b" },
        ]);
    });

    test("skips set-display-info entries that carry no action", () => {
        const entries: CaptureLogEntry[] = [
            {
                type: "user-request",
                seq: 0,
                requestId: req("r1"),
                command: "one action",
            },
            {
                type: "set-display-info",
                seq: 1,
                requestId: req("r1"),
                source: "player",
                actionIndex: 0,
            },
            {
                type: "set-display-info",
                seq: 2,
                requestId: req("r1"),
                source: "player",
                actionIndex: 1,
                action: { actionName: "only" },
            },
        ];
        const out = transform(entries);
        expect(out).toHaveLength(1);
        expect(out[0].expectedAction).toEqual({ actionName: "only" });
    });

    test("drops a request with no resolved action", () => {
        const entries: CaptureLogEntry[] = [
            {
                type: "user-request",
                seq: 0,
                requestId: req("r1"),
                command: "no action ever",
            },
            {
                type: "set-display-info",
                seq: 1,
                requestId: req("r1"),
                source: "player",
            },
        ];
        expect(transform(entries)).toHaveLength(0);
    });

    test("drops a request with no utterance", () => {
        const entries: CaptureLogEntry[] = [
            {
                type: "set-display-info",
                seq: 0,
                requestId: req("r1"),
                source: "player",
                action: { actionName: "orphan" },
            },
        ];
        expect(transform(entries)).toHaveLength(0);
    });

    test("ignores entries without a requestId", () => {
        const entries: CaptureLogEntry[] = [
            { type: "user-request", seq: 0, command: "no request id" },
            {
                type: "set-display-info",
                seq: 1,
                source: "player",
                action: { actionName: "x" },
            },
        ];
        expect(transform(entries)).toHaveLength(0);
    });

    test("attaches the latest feedback", () => {
        const entries: CaptureLogEntry[] = [
            {
                type: "user-request",
                seq: 0,
                requestId: req("r1"),
                command: "rate me",
            },
            {
                type: "set-display-info",
                seq: 1,
                requestId: req("r1"),
                source: "player",
                action: { actionName: "go" },
            },
            {
                type: "user-feedback",
                seq: 2,
                requestId: req("r1"),
                rating: "up",
            },
            {
                type: "user-feedback",
                seq: 3,
                requestId: req("r1"),
                rating: "down",
                category: "bad-response",
                comment: "nope",
                timestamp: 4242,
            },
        ];
        const out = transform(entries);
        expect(out[0].feedback).toEqual({
            rating: "down",
            category: "bad-response",
            comment: "nope",
            recordedAt: 4242,
        });
    });

    test("omits feedback when the latest rating was cleared", () => {
        const entries: CaptureLogEntry[] = [
            {
                type: "user-request",
                seq: 0,
                requestId: req("r1"),
                command: "cleared",
            },
            {
                type: "set-display-info",
                seq: 1,
                requestId: req("r1"),
                source: "player",
                action: { actionName: "go" },
            },
            {
                type: "user-feedback",
                seq: 2,
                requestId: req("r1"),
                rating: "up",
            },
            {
                type: "user-feedback",
                seq: 3,
                requestId: req("r1"),
                rating: null,
            },
        ];
        const out = transform(entries);
        expect(out).toHaveLength(1);
        expect(out[0].feedback).toBeUndefined();
    });

    test("uses a logical id and dedupes the same utterance across requestIds", () => {
        const entries: CaptureLogEntry[] = [
            {
                type: "user-request",
                seq: 0,
                requestId: req("r1"),
                command: "same words",
            },
            {
                type: "set-display-info",
                seq: 1,
                requestId: req("r1"),
                source: "player",
                action: { actionName: "old" },
            },
            {
                type: "user-request",
                seq: 2,
                requestId: req("r2"),
                command: "same words",
            },
            {
                type: "set-display-info",
                seq: 3,
                requestId: req("r2"),
                source: "player",
                action: { actionName: "new" },
            },
        ];
        const out = transform(entries);
        expect(out).toHaveLength(1);
        expect(out[0].id).toBe(computeEntryId("same words", "player"));
        // latest wins on a logical-id collision
        expect(out[0].expectedAction).toEqual({ actionName: "new" });
    });

    test("honours an explicit agent allowlist", () => {
        const entries: CaptureLogEntry[] = [
            {
                type: "user-request",
                seq: 0,
                requestId: req("r1"),
                command: "keep",
            },
            {
                type: "set-display-info",
                seq: 1,
                requestId: req("r1"),
                source: "player",
                action: { actionName: "a" },
            },
            {
                type: "user-request",
                seq: 2,
                requestId: req("r2"),
                command: "drop",
            },
            {
                type: "set-display-info",
                seq: 3,
                requestId: req("r2"),
                source: "dispatcher",
                action: { actionName: "b" },
            },
        ];
        const out = transform(entries, {
            agentFilter: (agent) => agent === "player",
        });
        expect(out).toHaveLength(1);
        expect(out[0].agent).toBe("player");
    });

    test("records the provided sessionId in provenance", () => {
        const entries: CaptureLogEntry[] = [
            {
                type: "user-request",
                seq: 0,
                requestId: req("r1"),
                command: "hi",
            },
            {
                type: "set-display-info",
                seq: 1,
                requestId: req("r1"),
                source: "player",
                action: { actionName: "go" },
            },
        ];
        const out = transform(entries, { sessionId: "sess-7" });
        expect(out[0].provenance.sessionId).toBe("sess-7");
    });

    test("preserves first-seen order on output", () => {
        const entries: CaptureLogEntry[] = [
            {
                type: "user-request",
                seq: 0,
                requestId: req("rb"),
                command: "second agent",
            },
            {
                type: "set-display-info",
                seq: 1,
                requestId: req("rb"),
                source: "list",
                action: { actionName: "b" },
            },
            {
                type: "user-request",
                seq: 2,
                requestId: req("ra"),
                command: "first agent",
            },
            {
                type: "set-display-info",
                seq: 3,
                requestId: req("ra"),
                source: "player",
                action: { actionName: "a" },
            },
        ];
        const out = transform(entries);
        expect(out.map((e) => e.utterance)).toEqual([
            "second agent",
            "first agent",
        ]);
    });
});
