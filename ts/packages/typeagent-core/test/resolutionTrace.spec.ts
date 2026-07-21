// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    buildReplayRunDescriptor,
    buildTraceVersionPin,
} from "../src/replay/resolutionTrace.js";

describe("buildTraceVersionPin", () => {
    it("keeps the SHA and drops content hashes for a git ref", () => {
        const pin = buildTraceVersionPin({
            spec: { kind: "git", ref: "HEAD" },
            label: "HEAD (main)",
            sha: "3637bd663",
            contentHashes: { grammar: "abc" },
        });
        expect(pin.workingTree).toBe(false);
        expect(pin.sha).toBe("3637bd663");
        expect(pin.contentHashes).toBeUndefined();
    });

    it("keeps content hashes and drops the SHA for the working tree", () => {
        const pin = buildTraceVersionPin({
            spec: { kind: "workingTree" },
            label: "Working tree",
            sha: "should-be-ignored",
            contentHashes: { grammar: "abc", schema: "def" },
        });
        expect(pin.workingTree).toBe(true);
        expect(pin.sha).toBeUndefined();
        expect(pin.contentHashes).toEqual({ grammar: "abc", schema: "def" });
    });

    it("omits optional fields when not supplied", () => {
        const pin = buildTraceVersionPin({
            spec: { kind: "git", ref: "v1" },
            label: "v1",
        });
        expect(pin).toEqual({
            spec: { kind: "git", ref: "v1" },
            label: "v1",
            workingTree: false,
        });
    });
});

describe("buildReplayRunDescriptor", () => {
    const a = buildTraceVersionPin({
        spec: { kind: "git", ref: "HEAD" },
        label: "HEAD",
        sha: "aaa",
    });
    const b = buildTraceVersionPin({
        spec: { kind: "workingTree" },
        label: "Working tree",
        contentHashes: { grammar: "bbb" },
    });

    it("assembles a JSON-safe descriptor and stamps runAt from the clock", () => {
        const descriptor = buildReplayRunDescriptor(
            {
                runId: "run-1",
                agent: "player",
                a,
                b,
                mode: "nfa-grammar",
                missPolicy: "needs-explanation",
                validateWildcards: true,
                corpus: { sources: ["in-repo"] },
            },
            () => 12345,
        );
        expect(descriptor).toEqual({
            runId: "run-1",
            agent: "player",
            a,
            b,
            mode: "nfa-grammar",
            missPolicy: "needs-explanation",
            validateWildcards: true,
            corpus: { sources: ["in-repo"] },
            runAt: 12345,
        });
        expect(JSON.parse(JSON.stringify(descriptor))).toEqual(descriptor);
    });

    it("prefers an explicit runAt over the clock", () => {
        const descriptor = buildReplayRunDescriptor(
            {
                runId: "run-2",
                agent: "list",
                a,
                b,
                mode: "completionBased-cache",
                missPolicy: "strict-cache",
                validateWildcards: false,
                corpus: {},
                runAt: 999,
            },
            () => 12345,
        );
        expect(descriptor.runAt).toBe(999);
    });
});
