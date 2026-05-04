// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    CollisionEvent,
    CollisionTelemetryHost,
    createCollisionRingBuffer,
    emitCollisionEvent,
    getRecentCollisionEvents,
} from "../src/context/collisionTelemetry.js";

function makeHost(
    emit: boolean,
    debugLog: boolean = false,
): CollisionTelemetryHost {
    const events = createCollisionRingBuffer();
    return {
        collisionEvents: events,
        session: {
            getConfig: () => ({
                collision: {
                    telemetry: { emit, debugLog },
                },
            }),
        },
    };
}

describe("collisionTelemetry", () => {
    it("does not record events when emit and debugLog are both false", () => {
        const host = makeHost(false, false);
        emitCollisionEvent(
            {
                kind: "grammarMatch",
                candidates: [],
                strategy: "first-match",
            },
            host,
        );
        expect(host.collisionEvents).toHaveLength(0);
    });

    it("records events when emit=true", () => {
        const host = makeHost(true);
        emitCollisionEvent(
            {
                kind: "grammarMatch",
                candidates: [{ schemaName: "a", actionName: "x" }],
                strategy: "first-match",
            },
            host,
        );
        expect(host.collisionEvents).toHaveLength(1);
        expect(host.collisionEvents[0].kind).toBe("grammarMatch");
    });

    it("ring-buffers to 50 entries", () => {
        const host = makeHost(true);
        for (let i = 0; i < 75; i++) {
            emitCollisionEvent(
                {
                    kind: "grammarMatch",
                    candidates: [{ schemaName: "a", actionName: `x${i}` }],
                    strategy: "first-match",
                },
                host,
            );
        }
        expect(host.collisionEvents).toHaveLength(50);
        // The oldest 25 entries should have been dropped.
        const first = host.collisionEvents[0];
        expect(first.candidates[0].actionName).toBe("x25");
    });

    it("getRecentCollisionEvents returns last N entries", () => {
        const host = makeHost(true);
        for (let i = 0; i < 10; i++) {
            emitCollisionEvent(
                {
                    kind: "grammarMatch",
                    candidates: [{ schemaName: "a", actionName: `x${i}` }],
                    strategy: "first-match",
                },
                host,
            );
        }
        const recent = getRecentCollisionEvents(host, 3);
        expect(recent).toHaveLength(3);
        expect(recent[2].candidates[0].actionName).toBe("x9");
    });

    it("stamps a timestamp", () => {
        const host = makeHost(true);
        const before = Date.now();
        emitCollisionEvent(
            {
                kind: "static",
                candidates: [],
                strategy: "warn",
            },
            host,
        );
        const after = Date.now();
        const event: CollisionEvent = host.collisionEvents[0];
        expect(event.timestamp).toBeGreaterThanOrEqual(before);
        expect(event.timestamp).toBeLessThanOrEqual(after);
    });
});
