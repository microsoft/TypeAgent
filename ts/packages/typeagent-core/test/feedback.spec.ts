// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { InProcessEventStream } from "../src/events/index.js";
import {
    CoreFeedbackService,
    InMemoryFeedbackBackend,
    createFeedbackServiceFromDispatcher,
    type FeedbackBackend,
    type FeedbackFilter,
    type FeedbackRecordInput,
    type FeedbackRow,
} from "../src/feedback/index.js";

class TrackingBackend implements FeedbackBackend {
    public readonly calls: {
        record: FeedbackRecordInput[];
        hide: string[];
        restore: string[];
    } = {
        record: [],
        hide: [],
        restore: [],
    };

    private rows: FeedbackRow[] = [];

    async recordUserFeedback(input: FeedbackRecordInput): Promise<void> {
        this.calls.record.push(input);
        this.rows = this.rows.filter((r) => r.requestId !== input.requestId);
        const row: FeedbackRow = {
            requestId: input.requestId,
            rating: input.rating,
            includesContext: input.includeContext ?? false,
            recordedAt: input.recordedAt ?? 0,
            hidden: false,
            ...(input.category !== undefined ? { category: input.category } : {}),
            ...(input.comment !== undefined ? { comment: input.comment } : {}),
            ...(input.agent !== undefined ? { agent: input.agent } : {}),
            ...(input.utterance !== undefined ? { utterance: input.utterance } : {}),
            ...(input.expectedAction !== undefined
                ? { expectedAction: input.expectedAction }
                : {}),
            ...(input.tags !== undefined ? { tags: input.tags } : {}),
            ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
        };
        this.rows.push(row);
    }

    async recordUserHide(requestId: string): Promise<void> {
        this.calls.hide.push(requestId);
        this.rows = this.rows.map((r) =>
            r.requestId === requestId ? { ...r, hidden: true } : r,
        );
    }

    async restoreAllHidden(sessionId: string): Promise<void> {
        this.calls.restore.push(sessionId);
        this.rows = this.rows.map((r) =>
            r.sessionId === sessionId ? { ...r, hidden: false } : r,
        );
    }

    async listFeedbackRows(_filter: FeedbackFilter): Promise<FeedbackRow[]> {
        return this.rows;
    }
}

describe("CoreFeedbackService", () => {
    it("records via backend and returns rows from list/count", async () => {
        const backend = new TrackingBackend();
        const svc = new CoreFeedbackService({ backend, now: () => 100 });

        await svc.record({
            requestId: "r1",
            rating: "down",
            category: "wrong-agent",
            comment: "picked calendar",
            includeContext: true,
            agent: "player",
            sessionId: "s1",
        });

        expect(backend.calls.record).toHaveLength(1);
        expect(backend.calls.record[0].recordedAt).toBe(100);
        const rows = await svc.list();
        expect(rows).toHaveLength(1);
        expect(rows[0].requestId).toBe("r1");
        expect(rows[0].includesContext).toBe(true);
        expect(await svc.count()).toBe(1);
    });

    it("emits feedback.recorded event", async () => {
        const stream = new InProcessEventStream();
        const got: string[] = [];
        stream.subscribe((e) => got.push(e.type));

        const svc = new CoreFeedbackService({
            backend: new InMemoryFeedbackBackend(),
            emitter: stream,
            now: () => 200,
        });
        await svc.record({ requestId: "r1", rating: "up" });

        expect(got).toEqual(["feedback.recorded"]);
    });

    it("hide and restoreAllHidden update hidden state", async () => {
        const svc = new CoreFeedbackService({
            backend: new InMemoryFeedbackBackend(),
            now: () => 100,
        });
        await svc.record({ requestId: "r1", rating: "down", sessionId: "s1" });
        await svc.hide("r1");
        expect((await svc.list({ hidden: true })).map((r) => r.requestId)).toEqual([
            "r1",
        ]);

        await svc.restoreAllHidden("s1");
        expect((await svc.list({ hidden: true })).map((r) => r.requestId)).toEqual(
            [],
        );
    });

    it("top ranks by net down-vs-up score", async () => {
        const svc = new CoreFeedbackService({
            backend: new InMemoryFeedbackBackend(),
            now: () => 100,
        });
        await svc.record({ requestId: "a1", rating: "down", agent: "player" });
        await svc.record({ requestId: "a2", rating: "down", agent: "player" });
        await svc.record({ requestId: "a3", rating: "up", agent: "player" });
        await svc.record({ requestId: "b1", rating: "down", agent: "calendar" });

        const top = await svc.top({ limit: 2 });
        expect(top).toHaveLength(2);
        expect(top[0].agent).toBe("player");
        expect(top[1].agent).toBe("calendar");
    });

    it("exportJsonl serializes filtered rows", async () => {
        const svc = new CoreFeedbackService({
            backend: new InMemoryFeedbackBackend(),
            now: () => 100,
        });
        await svc.record({ requestId: "r1", rating: "down", agent: "player" });
        await svc.record({ requestId: "r2", rating: "up", agent: "calendar" });

        const chunks: string[] = [];
        let ended = false;
        const n = await svc.exportJsonl(
            { agent: "player" },
            {
                write: (c) => {
                    chunks.push(c);
                    return true;
                },
                end: () => {
                    ended = true;
                },
            },
        );
        expect(n).toBe(1);
        expect(ended).toBe(true);
        expect(chunks.join("\n")).toContain('"r1"');
        expect(chunks.join("\n")).not.toContain('"r2"');
    });

    it("projects rows to feedback corpus entries", async () => {
        const svc = new CoreFeedbackService({
            backend: new InMemoryFeedbackBackend(),
            now: () => 100,
        });
        await svc.record({
            requestId: "r1",
            rating: "down",
            agent: "player",
            utterance: "play jazz",
            expectedAction: { foo: 1 },
        });
        await svc.record({ requestId: "r2", rating: "up", agent: "player" });

        const rows = await svc.toCorpusEntries("player");
        expect(rows).toHaveLength(1);
        expect(rows[0].source).toBe("feedback");
        expect(rows[0].utterance).toBe("play jazz");
        expect(rows[0].feedback?.rating).toBe("down");
        expect(rows[0].provenance.requestId).toBe("r1");
    });
});

describe("createFeedbackServiceFromDispatcher", () => {
    it("forwards write operations to dispatcher rpc methods", async () => {
        const calls: string[] = [];
        const svc = createFeedbackServiceFromDispatcher({
            async recordUserFeedback(_input) {
                calls.push("record");
            },
            async recordUserHide(_requestId) {
                calls.push("hide");
            },
            async restoreAllHidden(_sessionId) {
                calls.push("restore");
            },
        });

        await svc.record({ requestId: "r1", rating: "up" });
        await svc.hide("r1");
        await svc.restoreAllHidden("s1");

        expect(calls).toEqual(["record", "hide", "restore"]);
    });
});
