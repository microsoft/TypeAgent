// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { captureGrammarMatchTrace } from "../src/replay/resolutionTraceCapture.js";
import { deserializeGrammarDebugInfo } from "../src/replay/resolutionTrace.js";

const GRAMMAR = [
    "<Start> = <Pause> | <Resume>;",
    '<Pause> = pause -> { actionName: "pause" };',
    '<Resume> = resume -> { actionName: "resume" };',
].join("\n");

const pauseAction = { schemaName: "demo", actionName: "pause" };
const resumeAction = { schemaName: "demo", actionName: "resume" };

describe("captureGrammarMatchTrace", () => {
    test("captures a matched trace with a resolvable source span", () => {
        const node = captureGrammarMatchTrace(
            "demo",
            "demo.agr",
            GRAMMAR,
            "pause",
            pauseAction,
        );

        expect(node.kind).toBe("grammar-match");
        expect(node.execution).toBe("ran");
        expect(node.outcome).toBe("hit");
        expect(node.trace?.result).toBe("matched");
        expect(node.trace?.events.length).toBeGreaterThan(0);
        expect(node.debugInfo).toBeDefined();
        // The headline span points at a real line of the grammar source.
        expect(node.source).toBeDefined();
        expect(node.source?.range.start.line).toBeGreaterThanOrEqual(0);
    });

    test("flags ranking parity as matched when the traced action agrees", () => {
        const node = captureGrammarMatchTrace(
            "demo",
            "demo.agr",
            GRAMMAR,
            "pause",
            pauseAction,
        );
        expect(node.rankingParity).toBe("matched");
    });

    test("flags ranking parity as diverged when the traced action differs", () => {
        // The resolver's ranked pick (resumeAction) disagrees with what the
        // recursive matcher produces for "pause" (a pause action).
        const node = captureGrammarMatchTrace(
            "demo",
            "demo.agr",
            GRAMMAR,
            "pause",
            resumeAction,
        );
        expect(node.rankingParity).toBe("diverged");
    });

    test("reports a miss with an unavailable parity when nothing resolved", () => {
        const node = captureGrammarMatchTrace(
            "demo",
            "demo.agr",
            GRAMMAR,
            "fizzbuzz",
            undefined,
        );
        expect(node.outcome).toBe("miss");
        expect(node.rankingParity).toBe("unavailable");
        expect(node.trace?.result).toBe("noMatch");
    });

    test("degrades cleanly when the grammar fails to load", () => {
        const node = captureGrammarMatchTrace(
            "demo",
            "demo.agr",
            "<Start> = <Missing;", // syntactically broken
            "pause",
            pauseAction,
        );
        expect(node.execution).toBe("ran");
        expect(node.trace).toBeUndefined();
        expect(node.rankingParity).toBe("unavailable");
        expect(node.detail).toMatch(/trace unavailable/);
    });

    test("the captured node survives a JSON round-trip", () => {
        const node = captureGrammarMatchTrace(
            "demo",
            "demo.agr",
            GRAMMAR,
            "pause",
            pauseAction,
        );
        const roundTripped = JSON.parse(JSON.stringify(node));
        expect(roundTripped).toEqual(node);
        // The serialized debug info rebuilds into real maps.
        const debugInfo = deserializeGrammarDebugInfo(roundTripped.debugInfo);
        expect(debugInfo.parts.size).toBeGreaterThan(0);
        expect(debugInfo.rules.size).toBeGreaterThan(0);
    });
});
