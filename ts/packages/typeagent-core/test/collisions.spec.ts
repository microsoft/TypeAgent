// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { InProcessEventStream } from "../src/events/index.js";
import { InProcessCollisionService } from "../src/collisions/index.js";

describe("InProcessCollisionService", () => {
    it("report stores and emits collision.detected events", () => {
        const stream = new InProcessEventStream();
        const got: string[] = [];
        stream.subscribe((e) => got.push(e.type));

        const svc = new InProcessCollisionService({
            emitter: stream,
            now: () => 100,
        });
        const event = svc.report({
            schemaVersion: 1,
            type: "collision.detected",
            ts: 100,
            sandboxId: "s1",
            kind: "ambiguity",
            detectionPoint: "replay",
            participants: [
                {
                    agent: "calendar",
                    actionType: "calendar.scheduleEvent",
                    file: "x",
                    range: [1, 1],
                },
            ],
        });

        expect(event.type).toBe("collision.detected");
        expect(got).toEqual(["collision.detected"]);
        expect(svc.list()).toHaveLength(1);
    });

    it("maps dispatcher static collisions", () => {
        const svc = new InProcessCollisionService({ now: () => 200 });
        const e = svc.fromDispatcher({
            kind: "static",
            candidates: [
                { schemaName: "calendar", actionName: "scheduleEvent" },
                { schemaName: "email", actionName: "sendEmail" },
            ],
            requestId: "r1",
            experimentId: "E1",
        });

        expect(e.kind).toBe("overlap");
        expect(e.detectionPoint).toBe("load");
        expect(e.requestId).toBe("r1");
        expect(e.experimentId).toBe("E1");
        expect(e.participants).toHaveLength(2);
    });

    it("maps dispatcher fuzzy collisions to shadow/replay", () => {
        const svc = new InProcessCollisionService({ now: () => 200 });
        const e = svc.fromDispatcher({
            kind: "fuzzy",
            candidates: [{ schemaName: "player", actionName: "play" }],
        });

        expect(e.kind).toBe("shadow");
        expect(e.detectionPoint).toBe("replay");
    });

    it("maps grammar-tools collision records", () => {
        const svc = new InProcessCollisionService({ now: () => 300 });
        const e = svc.fromGrammarTools(
            {
                schemaA: "calendar",
                schemaB: "email",
                witnessText: "schedule a meeting",
                rulePatternA: "calendar rule",
                rulePatternB: "email rule",
            },
            { sandboxId: "sbx" },
        );

        expect(e.kind).toBe("overlap");
        expect(e.detectionPoint).toBe("grammar-edit");
        expect(e.exemplarUtterances).toEqual(["schedule a meeting"]);
        expect(e.sandboxId).toBe("sbx");
    });

    it("list filters by agent/kind/time", () => {
        const svc = new InProcessCollisionService({ now: () => 100 });
        svc.fromDispatcher({
            kind: "static",
            candidates: [{ schemaName: "calendar", actionName: "scheduleEvent" }],
            timestamp: 100,
        });
        svc.fromDispatcher({
            kind: "fuzzy",
            candidates: [{ schemaName: "email", actionName: "sendEmail" }],
            timestamp: 200,
        });

        expect(svc.list({ agent: "calendar" })).toHaveLength(1);
        expect(svc.list({ kind: "shadow" })).toHaveLength(1);
        expect(svc.list({ since: 150 })).toHaveLength(1);
    });

    it("clear removes matching events and returns count", () => {
        const svc = new InProcessCollisionService({ now: () => 100 });
        svc.fromDispatcher({
            kind: "static",
            candidates: [{ schemaName: "calendar", actionName: "scheduleEvent" }],
        });
        svc.fromDispatcher({
            kind: "fuzzy",
            candidates: [{ schemaName: "email", actionName: "sendEmail" }],
        });

        const removed = svc.clear({ kind: "shadow" });
        expect(removed).toBe(1);
        expect(svc.list()).toHaveLength(1);

        const removedAll = svc.clear();
        expect(removedAll).toBe(1);
        expect(svc.list()).toEqual([]);
    });
});
