// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    deriveSideFidelity,
    type DeriveSideFidelityInput,
    type FidelityLayer,
    type FidelityLayerStatus,
} from "../src/runtime/studioRuntimeCore.js";

const workingTree = { kind: "workingTree" } as const;
const gitRef = { kind: "git", ref: "HEAD" } as const;

function baseInput(
    overrides: Partial<DeriveSideFidelityInput> = {},
): DeriveSideFidelityInput {
    return {
        versionA: workingTree,
        versionB: gitRef,
        methodA: "schema-grammar",
        methodB: "schema-grammar",
        mode: "nfa-grammar",
        validateWildcards: false,
        ...overrides,
    };
}

function statusOf(
    input: DeriveSideFidelityInput,
    side: "A" | "B",
    layer: FidelityLayer,
): FidelityLayerStatus {
    return deriveSideFidelity(input)[side].layers[layer].status;
}

describe("deriveSideFidelity", () => {
    it("marks realization by version kind", () => {
        const fidelity = deriveSideFidelity(baseInput());
        expect(fidelity.A.realization).toBe("built-live");
        expect(fidelity.B.realization).toBe("source");
    });

    it("every layer carries a non-empty reason", () => {
        const fidelity = deriveSideFidelity(baseInput());
        for (const side of [fidelity.A, fidelity.B]) {
            for (const report of Object.values(side.layers)) {
                expect(report.reason.length).toBeGreaterThan(0);
            }
        }
    });

    it("dispatch is always unavailable", () => {
        expect(statusOf(baseInput(), "A", "dispatch")).toBe("unavailable");
        expect(statusOf(baseInput(), "B", "dispatch")).toBe("unavailable");
    });

    it("grammar runs except for identity", () => {
        expect(statusOf(baseInput(), "A", "grammar")).toBe("ran");
        const identity = baseInput({ methodA: "identity" });
        expect(statusOf(identity, "A", "grammar")).toBe("skipped");
    });

    it("schema enrichment runs only for schema/cache methods", () => {
        expect(statusOf(baseInput(), "A", "schemaEnrichment")).toBe("ran");
        const cache = baseInput({ methodA: "construction-cache" });
        expect(statusOf(cache, "A", "schemaEnrichment")).toBe("ran");
        const bare = baseInput({ methodA: "static-grammar" });
        expect(statusOf(bare, "A", "schemaEnrichment")).toBe("skipped");
    });

    it("construction cache is unavailable at a git ref", () => {
        expect(statusOf(baseInput(), "B", "constructionCache")).toBe(
            "unavailable",
        );
    });

    it("construction cache runs only when the method used it", () => {
        const cache = baseInput({
            versionA: workingTree,
            methodA: "construction-cache",
        });
        expect(statusOf(cache, "A", "constructionCache")).toBe("ran");
    });

    it("construction cache is skipped in grammar mode on the working tree", () => {
        const grammar = baseInput({
            versionA: workingTree,
            methodA: "schema-grammar",
            mode: "nfa-grammar",
        });
        expect(statusOf(grammar, "A", "constructionCache")).toBe("skipped");
    });

    it("construction cache is skipped on a stale cache-mode working tree", () => {
        const stale = baseInput({
            versionA: workingTree,
            methodA: "schema-grammar",
            mode: "completionBased-cache",
        });
        expect(statusOf(stale, "A", "constructionCache")).toBe("skipped");
    });

    it("wildcard validation is unavailable at a git ref", () => {
        expect(statusOf(baseInput(), "B", "wildcardValidation")).toBe(
            "unavailable",
        );
    });

    it("wildcard validation is skipped when the toggle is off", () => {
        expect(
            statusOf(
                baseInput({ validateWildcards: false }),
                "A",
                "wildcardValidation",
            ),
        ).toBe("skipped");
    });

    it("wildcard validation runs when applied with no diagnostics", () => {
        const applied = baseInput({
            validateWildcards: true,
            wildcardValidation: { applied: true, diagnostics: [] },
        });
        expect(statusOf(applied, "A", "wildcardValidation")).toBe("ran");
    });

    it("wildcard validation maps load-failed to unavailable", () => {
        const degraded = baseInput({
            validateWildcards: true,
            wildcardValidation: {
                applied: true,
                diagnostics: ["load-failed"],
            },
        });
        expect(statusOf(degraded, "A", "wildcardValidation")).toBe(
            "unavailable",
        );
    });

    it("wildcard validation maps allowlist/no-validator to skipped", () => {
        for (const diagnostic of [
            "agent-not-in-allowlist",
            "no-validator",
        ] as const) {
            const skipped = baseInput({
                validateWildcards: true,
                wildcardValidation: {
                    applied: true,
                    diagnostics: [diagnostic],
                },
            });
            expect(statusOf(skipped, "A", "wildcardValidation")).toBe(
                "skipped",
            );
        }
    });

    it("wildcard validation maps errored to ran (fail-open)", () => {
        const errored = baseInput({
            validateWildcards: true,
            wildcardValidation: { applied: true, diagnostics: ["errored"] },
        });
        expect(statusOf(errored, "A", "wildcardValidation")).toBe("ran");
    });

    it("wildcard validation is skipped when enabled but never applied", () => {
        const enabled = baseInput({ validateWildcards: true });
        expect(statusOf(enabled, "A", "wildcardValidation")).toBe("skipped");
    });
});
