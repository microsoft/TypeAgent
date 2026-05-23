// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import type { QueueSnapshot } from "@typeagent/dispatcher-types";
import { createSnapshotCoalescer } from "../../src/queue/snapshotCoalescer.js";

const snap = (version: number): QueueSnapshot => ({
    running: null,
    queued: [],
    paused: false,
    version,
});

describe("createSnapshotCoalescer", () => {
    it("emits at most one snapshot per window — last one wins", () => {
        jest.useFakeTimers();
        try {
            const emitted: QueueSnapshot[] = [];
            const c = createSnapshotCoalescer((s) => emitted.push(s), 100);

            // Burst of 20 schedules inside a 100ms window.
            for (let i = 1; i <= 20; i++) c.schedule(snap(i));

            // Nothing has fired yet.
            expect(emitted).toEqual([]);

            jest.advanceTimersByTime(100);
            // Exactly one snapshot fired — the LAST one in the window.
            expect(emitted.length).toBe(1);
            expect(emitted[0].version).toBe(20);
        } finally {
            jest.useRealTimers();
        }
    });

    it("opens a new window for snapshots scheduled after the prior fire", () => {
        jest.useFakeTimers();
        try {
            const emitted: QueueSnapshot[] = [];
            const c = createSnapshotCoalescer((s) => emitted.push(s), 100);

            c.schedule(snap(1));
            c.schedule(snap(2));
            jest.advanceTimersByTime(100);
            expect(emitted.map((s) => s.version)).toEqual([2]);

            c.schedule(snap(3));
            c.schedule(snap(4));
            jest.advanceTimersByTime(100);
            expect(emitted.map((s) => s.version)).toEqual([2, 4]);
        } finally {
            jest.useRealTimers();
        }
    });

    it("flush() delivers the pending snapshot immediately", () => {
        jest.useFakeTimers();
        try {
            const emitted: QueueSnapshot[] = [];
            const c = createSnapshotCoalescer((s) => emitted.push(s), 100);

            c.schedule(snap(1));
            c.schedule(snap(2));
            c.flush();
            expect(emitted.map((s) => s.version)).toEqual([2]);

            // The cancelled timer must not fire after flush.
            jest.advanceTimersByTime(200);
            expect(emitted.length).toBe(1);
        } finally {
            jest.useRealTimers();
        }
    });

    it("flush() is a no-op when nothing is pending", () => {
        jest.useFakeTimers();
        try {
            const emitted: QueueSnapshot[] = [];
            const c = createSnapshotCoalescer((s) => emitted.push(s), 100);
            c.flush();
            expect(emitted).toEqual([]);
        } finally {
            jest.useRealTimers();
        }
    });

    it("schedule after flush opens a fresh window", () => {
        jest.useFakeTimers();
        try {
            const emitted: QueueSnapshot[] = [];
            const c = createSnapshotCoalescer((s) => emitted.push(s), 100);
            c.schedule(snap(1));
            c.flush();
            c.schedule(snap(2));
            jest.advanceTimersByTime(100);
            expect(emitted.map((s) => s.version)).toEqual([1, 2]);
        } finally {
            jest.useRealTimers();
        }
    });
});
