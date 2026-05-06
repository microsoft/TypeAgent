// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
    COLLISION_EVENTS_FILE,
    CollisionEvent,
    CollisionLogger,
    CollisionTelemetryHost,
    createCollisionRingBuffer,
    emitCollisionEvent,
    getRecentCollisionEvents,
} from "../src/context/collisionTelemetry.js";

interface HostOptions {
    emit?: boolean;
    debugLog?: boolean;
    experimentId?: string;
    sessionDirPath?: string;
    currentRequestId?: unknown;
    logger?: CollisionLogger;
}

function makeHost(opts: HostOptions = {}): CollisionTelemetryHost {
    const events = createCollisionRingBuffer();
    return {
        collisionEvents: events,
        currentRequestId: opts.currentRequestId,
        logger: opts.logger,
        session: {
            sessionDirPath: opts.sessionDirPath,
            getConfig: () => ({
                collision: {
                    telemetry: {
                        emit: opts.emit ?? true,
                        debugLog: opts.debugLog ?? false,
                        experimentId: opts.experimentId,
                    },
                },
            }),
        },
    };
}

describe("collisionTelemetry", () => {
    it("does not record events when emit and debugLog are both false", () => {
        const host = makeHost({ emit: false, debugLog: false });
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
        const host = makeHost({ emit: true });
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
        const host = makeHost({ emit: true });
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
        const host = makeHost({ emit: true });
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
        const host = makeHost({ emit: true });
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

    describe("auto-filled correlation fields (M2)", () => {
        it("derives sessionId from sessionDirPath basename", () => {
            const host = makeHost({
                emit: true,
                sessionDirPath: path.join("/profiles/foo/sessions", "abc123"),
            });
            emitCollisionEvent(
                {
                    kind: "grammarMatch",
                    candidates: [{ schemaName: "a", actionName: "x" }],
                    strategy: "first-match",
                },
                host,
            );
            expect(host.collisionEvents[0].sessionId).toBe("abc123");
        });

        it("propagates experimentId from telemetry config when set", () => {
            const host = makeHost({
                emit: true,
                experimentId: "E1.2-2026-05-12",
            });
            emitCollisionEvent(
                {
                    kind: "grammarMatch",
                    candidates: [{ schemaName: "a", actionName: "x" }],
                    strategy: "first-match",
                },
                host,
            );
            expect(host.collisionEvents[0].experimentId).toBe(
                "E1.2-2026-05-12",
            );
        });

        it("treats empty-string experimentId as unset", () => {
            const host = makeHost({ emit: true, experimentId: "  " });
            emitCollisionEvent(
                {
                    kind: "grammarMatch",
                    candidates: [],
                    strategy: "first-match",
                },
                host,
            );
            expect(host.collisionEvents[0].experimentId).toBeUndefined();
        });

        it("stringifies RequestId-shaped objects from currentRequestId", () => {
            const host = makeHost({
                emit: true,
                currentRequestId: { connectionId: "c1", requestId: "r-42" },
            });
            emitCollisionEvent(
                {
                    kind: "grammarMatch",
                    candidates: [],
                    strategy: "first-match",
                },
                host,
            );
            expect(host.collisionEvents[0].requestId).toBe("r-42");
        });

        it("preserves explicit firstMatchCandidate and classifier", () => {
            const host = makeHost({ emit: true });
            emitCollisionEvent(
                {
                    kind: "grammarMatch",
                    candidates: [
                        {
                            schemaName: "a",
                            actionName: "x",
                            matchedCount: 3,
                            nonOptionalCount: 2,
                            wildcardCharCount: 1,
                            priorityRank: 0,
                        },
                        {
                            schemaName: "b",
                            actionName: "x",
                            matchedCount: 3,
                            nonOptionalCount: 2,
                            wildcardCharCount: 1,
                            priorityRank: 1,
                        },
                    ],
                    chosen: { schemaName: "b", actionName: "x" },
                    firstMatchCandidate: { schemaName: "a", actionName: "x" },
                    classifier: "tiedHeuristics",
                    strategy: "score-rank",
                },
                host,
            );
            const evt = host.collisionEvents[0];
            expect(evt.firstMatchCandidate?.schemaName).toBe("a");
            expect(evt.classifier).toBe("tiedHeuristics");
            expect(evt.candidates[0].matchedCount).toBe(3);
            expect(evt.candidates[1].priorityRank).toBe(1);
        });
    });

    describe("logger forward (M3)", () => {
        it("calls logger.logEvent with kind 'collision' when emit is on", () => {
            const calls: Array<{ name: string; entry: unknown }> = [];
            const logger: CollisionLogger = {
                logEvent: (name, entry) => calls.push({ name, entry }),
            };
            const host = makeHost({ emit: true, logger });
            emitCollisionEvent(
                {
                    kind: "grammarMatch",
                    candidates: [{ schemaName: "a", actionName: "x" }],
                    strategy: "first-match",
                },
                host,
            );
            expect(calls).toHaveLength(1);
            expect(calls[0].name).toBe("collision");
            const entry = calls[0].entry as CollisionEvent;
            expect(entry.kind).toBe("grammarMatch");
            expect(entry.candidates).toHaveLength(1);
        });

        it("does not call the logger when emit is off", () => {
            const calls: Array<unknown> = [];
            const logger: CollisionLogger = {
                logEvent: () => calls.push(1),
            };
            const host = makeHost({
                emit: false,
                debugLog: true, // debug log allowed; remote upload should not fire
                logger,
            });
            emitCollisionEvent(
                {
                    kind: "grammarMatch",
                    candidates: [],
                    strategy: "first-match",
                },
                host,
            );
            expect(calls).toHaveLength(0);
        });

        it("swallows logger.logEvent errors without breaking emit", () => {
            const logger: CollisionLogger = {
                logEvent: () => {
                    throw new Error("sink down");
                },
            };
            const host = makeHost({ emit: true, logger });
            expect(() =>
                emitCollisionEvent(
                    {
                        kind: "grammarMatch",
                        candidates: [],
                        strategy: "first-match",
                    },
                    host,
                ),
            ).not.toThrow();
            expect(host.collisionEvents).toHaveLength(1);
        });
    });

    describe("per-session JSONL append (M4)", () => {
        let tmpDir: string;
        beforeEach(() => {
            tmpDir = fs.mkdtempSync(
                path.join(os.tmpdir(), "collision-jsonl-"),
            );
        });
        afterEach(() => {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        });

        it("appends one JSON line per emitted event", () => {
            const host = makeHost({ emit: true, sessionDirPath: tmpDir });
            for (let i = 0; i < 3; i++) {
                emitCollisionEvent(
                    {
                        kind: "grammarMatch",
                        candidates: [
                            { schemaName: "a", actionName: `x${i}` },
                        ],
                        strategy: "first-match",
                    },
                    host,
                );
            }
            const filePath = path.join(tmpDir, COLLISION_EVENTS_FILE);
            expect(fs.existsSync(filePath)).toBe(true);
            const lines = fs
                .readFileSync(filePath, "utf8")
                .split("\n")
                .filter((l) => l.length > 0);
            expect(lines).toHaveLength(3);
            const first = JSON.parse(lines[0]) as CollisionEvent;
            expect(first.kind).toBe("grammarMatch");
            expect(first.candidates[0].actionName).toBe("x0");
        });

        it("does not write the file when emit is off", () => {
            const host = makeHost({
                emit: false,
                debugLog: true,
                sessionDirPath: tmpDir,
            });
            emitCollisionEvent(
                {
                    kind: "grammarMatch",
                    candidates: [],
                    strategy: "first-match",
                },
                host,
            );
            const filePath = path.join(tmpDir, COLLISION_EVENTS_FILE);
            expect(fs.existsSync(filePath)).toBe(false);
        });

        it("does not crash when sessionDirPath is missing", () => {
            const host = makeHost({ emit: true });
            expect(() =>
                emitCollisionEvent(
                    {
                        kind: "grammarMatch",
                        candidates: [],
                        strategy: "first-match",
                    },
                    host,
                ),
            ).not.toThrow();
            expect(host.collisionEvents).toHaveLength(1);
        });
    });
});
