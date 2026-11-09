// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    createLocalTelemetryState,
    expandTracePresets,
    LOCAL_TELEMETRY_PROFILES,
    TRACE_PRESETS,
    type LocalTelemetrySnapshot,
} from "../src/otel/localTelemetryState.js";

describe("localTelemetryState", () => {
    it("starts at focused by default", () => {
        const state = createLocalTelemetryState();
        const snap = state.getSnapshot();
        expect(snap.profile).toBe("focused");
        expect(snap.debugBridgeAvailable).toBe(false);
        expect(snap.localLogAvailable).toBe(false);
        expect(snap.revision).toBe(0);
        expect(Object.isFrozen(snap)).toBe(true);
    });

    it("honors initial values", () => {
        const state = createLocalTelemetryState({
            initialProfile: "diagnostic",
            debugBridgeAvailable: true,
            localLogAvailable: true,
        });
        const snap = state.getSnapshot();
        expect(snap.profile).toBe("diagnostic");
        expect(snap.debugBridgeAvailable).toBe(true);
        expect(snap.localLogAvailable).toBe(true);
        expect(snap.revision).toBe(0);
    });

    it("bumps revision atomically on each mutation", () => {
        const seen: LocalTelemetrySnapshot[] = [];
        const state = createLocalTelemetryState({
            onChange: (s) => seen.push(s),
        });
        state.setProfile("diagnostic");
        state.setProfile("verbose");
        state.setProfile("off");

        expect(seen.map((s) => s.revision)).toEqual([1, 2, 3]);
        expect(seen.map((s) => s.profile)).toEqual([
            "diagnostic",
            "verbose",
            "off",
        ]);
        for (const s of seen) {
            expect(Object.isFrozen(s)).toBe(true);
        }
    });

    it("no-ops when a set call does not change the value", () => {
        const seen: LocalTelemetrySnapshot[] = [];
        const state = createLocalTelemetryState({
            onChange: (s) => seen.push(s),
        });
        state.setProfile("focused"); // unchanged from default
        expect(seen).toHaveLength(0);
        expect(state.getSnapshot().revision).toBe(0);
    });

    it("clear resets to focused in a single revision", () => {
        const seen: LocalTelemetrySnapshot[] = [];
        const state = createLocalTelemetryState({
            initialProfile: "verbose",
            onChange: (s) => seen.push(s),
        });
        state.clear();
        expect(seen).toHaveLength(1);
        const snap = state.getSnapshot();
        expect(snap.profile).toBe("focused");
        expect(snap.revision).toBe(1);
    });

    it("clear no-ops when already at defaults", () => {
        const seen: LocalTelemetrySnapshot[] = [];
        const state = createLocalTelemetryState({
            onChange: (s) => seen.push(s),
        });
        state.clear();
        expect(seen).toHaveLength(0);
    });

    it("rejects unknown profile names", () => {
        const state = createLocalTelemetryState();
        expect(() => state.setProfile("chatty" as any)).toThrow(
            /Unknown local telemetry profile/,
        );
        expect(state.getSnapshot().revision).toBe(0);
    });

    it("survives an onChange throw without corrupting state", () => {
        const warnings: string[] = [];
        const originalWarning = process.emitWarning;
        (process as any).emitWarning = (msg: string) => warnings.push(msg);
        try {
            const state = createLocalTelemetryState({
                onChange: () => {
                    throw new Error("boom");
                },
            });
            state.setProfile("verbose");
            expect(state.getSnapshot().profile).toBe("verbose");
        } finally {
            process.emitWarning = originalWarning;
        }
        expect(warnings.some((w) => w.includes("boom"))).toBe(true);
    });

    it("exposes every declared profile", () => {
        expect(LOCAL_TELEMETRY_PROFILES).toEqual([
            "focused",
            "diagnostic",
            "verbose",
            "off",
        ]);
    });
});

describe("expandTracePresets", () => {
    it("expands known presets and dedupes patterns", () => {
        const { patterns, unknown } = expandTracePresets([
            "reasoning",
            "reasoning",
            "actions",
        ]);
        expect(unknown).toEqual([]);
        // 'agents:*' pattern appears in the actions preset; dedupe check.
        const uniq = new Set(patterns);
        expect(uniq.size).toBe(patterns.length);
        for (const p of TRACE_PRESETS.reasoning) {
            expect(patterns).toContain(p);
        }
        for (const p of TRACE_PRESETS.actions) {
            expect(patterns).toContain(p);
        }
    });

    it("reports unknown preset names separately", () => {
        const { patterns, unknown } = expandTracePresets([
            "reasoning",
            "bogus",
            "translation",
            "ghost",
        ]);
        expect(unknown).toEqual(["bogus", "ghost"]);
        expect(patterns.length).toBeGreaterThan(0);
    });

    it("accepts comma-separated preset names", () => {
        const { patterns, unknown } = expandTracePresets([
            "request,translation",
        ]);
        expect(unknown).toEqual([]);
        for (const pattern of TRACE_PRESETS.request) {
            expect(patterns).toContain(pattern);
        }
        for (const pattern of TRACE_PRESETS.translation) {
            expect(patterns).toContain(pattern);
        }
    });

    it("includes dynamically named agent RPC namespaces", () => {
        expect(TRACE_PRESETS.rpc).toContain("typeagent:*:rpc:*");
    });

    it("handles empty and whitespace input", () => {
        expect(expandTracePresets([])).toEqual({ patterns: [], unknown: [] });
        expect(expandTracePresets(["", "  "])).toEqual({
            patterns: [],
            unknown: [],
        });
    });
});
