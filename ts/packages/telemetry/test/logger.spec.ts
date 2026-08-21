// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ChildLogger,
    MultiSinkLogger,
    type LogEvent,
    type LogEventSeverity,
    type Logger,
    type LoggerSink,
} from "../src/logger/logger.js";

/**
 * Minimal recording sink so the tests can assert on the actual
 * `LogEvent` values that reached the fan-out edge, including severity.
 */
class RecordingSink implements LoggerSink {
    public events: LogEvent[] = [];
    public logEvent(event: LogEvent): void {
        this.events.push(event);
    }
}

class RecordingLogger implements Logger {
    public calls: Array<{
        eventName: string;
        entry: Record<string, unknown>;
        severity: LogEventSeverity | undefined;
    }> = [];
    public logEvent<T extends Record<string, unknown>>(
        eventName: string,
        entry: T,
        severity?: LogEventSeverity,
    ): void {
        this.calls.push({ eventName, entry, severity });
    }
}

describe("MultiSinkLogger", () => {
    it("fans out to every sink with the caller's severity", () => {
        const a = new RecordingSink();
        const b = new RecordingSink();
        const logger = new MultiSinkLogger([a, b]);

        logger.logEvent("boot", { ready: true }, "warning");

        for (const sink of [a, b]) {
            expect(sink.events).toHaveLength(1);
            const [event] = sink.events;
            expect(event.eventName).toBe("boot");
            expect(event.event).toEqual({ ready: true });
            expect(event.severity).toBe("warning");
            expect(typeof event.timestamp).toBe("string");
        }
    });

    it("gives each sink an independent LogEvent wrapper", () => {
        const observed: LogEvent[] = [];
        const mutatingSink: LoggerSink = {
            logEvent(event) {
                event.eventName = "mutated";
                event.severity = "error";
            },
        };
        const recordingSink: LoggerSink = {
            logEvent(event) {
                observed.push(event);
            },
        };
        const logger = new MultiSinkLogger([mutatingSink, recordingSink]);

        logger.logEvent("original", { ready: true }, "warning");

        expect(observed).toHaveLength(1);
        expect(observed[0]!.eventName).toBe("original");
        expect(observed[0]!.severity).toBe("warning");
    });

    it("defaults severity to info when the caller doesn't pass one", () => {
        const sink = new RecordingSink();
        const logger = new MultiSinkLogger([sink]);
        logger.logEvent("boot", { ready: true });

        expect(sink.events).toHaveLength(1);
        expect(sink.events[0]!.severity).toBe("info");
    });

    it("addSink adds a sink that receives subsequent events", () => {
        const initial = new RecordingSink();
        const later = new RecordingSink();
        const logger = new MultiSinkLogger([initial]);
        logger.logEvent("first", { n: 1 }, "info");
        logger.addSink(later);
        logger.logEvent("second", { n: 2 }, "error");

        expect(initial.events.map((event) => event.eventName)).toEqual([
            "first",
            "second",
        ]);
        expect(later.events.map((event) => event.eventName)).toEqual([
            "second",
        ]);
        expect(later.events[0]!.severity).toBe("error");
    });
});

describe("ChildLogger", () => {
    it("forwards severity to the parent logger", () => {
        const parent = new RecordingLogger();
        const child = new ChildLogger(parent, "child");

        child.logEvent("hit", { count: 1 }, "error");

        expect(parent.calls).toHaveLength(1);
        const [call] = parent.calls;
        expect(call.eventName).toBe("child:hit");
        expect(call.entry).toEqual({ count: 1 });
        expect(call.severity).toBe("error");
    });

    it("defaults severity to info before forwarding to the parent", () => {
        const parent = new RecordingLogger();
        const child = new ChildLogger(parent, "child");

        child.logEvent("hit", { count: 1 });

        expect(parent.calls).toHaveLength(1);
        expect(parent.calls[0]!.severity).toBe("info");
    });

    it("merges common properties without dropping severity", () => {
        const parent = new RecordingLogger();
        const child = new ChildLogger(parent, undefined, {
            host: "test-host",
            build: () => "v1",
        });

        child.logEvent("hit", { count: 2 }, "warning");

        expect(parent.calls).toHaveLength(1);
        const [call] = parent.calls;
        expect(call.eventName).toBe("hit");
        expect(call.entry).toEqual({
            host: "test-host",
            build: "v1",
            count: 2,
        });
        expect(call.severity).toBe("warning");
    });
});
