// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    JsonValue,
    RecipeCallContext,
    RecipeSemanticFunction,
} from "../src/recipeCore.js";
import {
    RecipeSemanticAdapter,
    type RecipeSemanticProviderRequest,
} from "../src/recipeSemantic.js";
import {
    createRecipeRelevanceDefinition,
    createRecipeRelevanceRegistration,
} from "../src/recipeSemanticReference.js";
import {
    FakeRecipeSemanticProvider,
    recipeSemanticJsonFixture,
} from "../src/recipeSemanticTesting.js";
import { FakeRecipeHost } from "../src/recipeTesting.js";

const jest = (import.meta as ImportMeta & { jest: typeof globalThis.jest })
    .jest;

const input: JsonValue = {
    topic: "TypeScript",
    candidates: [
        {
            id: "a",
            title: "Language",
            body: "TypeScript has structural types.",
        },
        { id: "b", title: "Garden", body: "Growing carrots in spring." },
    ],
};
const output = {
    decisions: [
        { id: "a", relevant: true, evidenceQuote: "structural types" },
        { id: "b", relevant: false },
    ],
};

function context(signal = new AbortController().signal): RecipeCallContext {
    return {
        runId: "offline-run",
        callId: "classification",
        binding: {
            workspaceId: "w",
            profileId: "p",
            providerId: "fixture",
            accountId: "offline",
            sessionId: "test",
            generation: "1",
        },
        signal,
    };
}

function setup(
    fixture: (
        request: RecipeSemanticProviderRequest,
    ) => unknown | Promise<unknown> = () => recipeSemanticJsonFixture(output),
    change?: (definition: RecipeSemanticFunction) => void,
) {
    const definition = createRecipeRelevanceDefinition();
    change?.(definition);
    const provider = new FakeRecipeSemanticProvider(fixture);
    const adapter = new RecipeSemanticAdapter(
        createRecipeRelevanceRegistration(definition),
        provider,
    );
    return {
        provider,
        definition,
        adapter,
        invoke: (value = input, signal?: AbortSignal) =>
            adapter.invokeSemantic(definition, value, context(signal)),
    };
}

describe("host-independent typed semantic boundary (synthetic provider only)", () => {
    it("composes with frozen P1 FakeRecipeHost using one semantic call and no capability/planner calls", async () => {
        const fixture = setup();
        const host = new FakeRecipeHost();
        host.registerSemantic(fixture.definition, (value, callContext) =>
            fixture.adapter.invokeSemantic(
                fixture.definition,
                value,
                callContext,
            ),
        );
        expect(
            await host.invokeSemantic(fixture.definition, input, context()),
        ).toMatchObject({ status: "completed", value: output });
        expect(host.calls).toHaveLength(1);
        expect(host.calls[0]).toMatchObject({
            kind: "semantic",
            id: "classify-relevance",
        });
        expect(fixture.provider.calls).toHaveLength(1);
    });

    it("classifies supported nonempty input in exactly one declared call without a planner", async () => {
        const fixture = setup();
        const result = await fixture.invoke();
        expect(result.status).toBe("completed");
        expect(fixture.provider.calls).toHaveLength(1);
        expect(fixture.provider.calls[0]).toMatchObject({
            attempt: 0,
            definition: {
                specification: { id: "reference-relevance", revision: "1" },
                modelPolicy: {
                    id: "host-approved-bounded-classification",
                    revision: "1",
                },
                bounds: { maxCalls: 1, maxRepairAttempts: 0 },
            },
        });
        expect(result).toMatchObject({
            value: output,
            evidence: {
                sourceIds: ["a", "b"],
                resolvedModel: "synthetic:relevance-fixture-v1",
                inputTokens: 12,
                outputTokens: 8,
                validation: "passed",
            },
            attempts: [
                {
                    providerId: "offline-semantic-fixture",
                    evidenceKind: "synthetic",
                    cost: 0,
                    currency: "synthetic",
                    validation: "passed",
                },
            ],
        });
        expect(result.attempts[0].latencyMs).toBeGreaterThanOrEqual(0);
    });

    it("reports the blocked approved-provider seam without configuring a client", async () => {
        const definition = createRecipeRelevanceDefinition();
        const adapter = new RecipeSemanticAdapter(
            createRecipeRelevanceRegistration(),
        );
        expect(
            await adapter.invokeSemantic(definition, input, context()),
        ).toEqual({
            status: "unsupported",
            message:
                "P0 blocked: no approved host inference provider has been injected.",
            attempts: [],
        });
    });

    it.each([
        null,
        { topic: "TypeScript", candidates: [] },
        { topic: "TypeScript", candidates: [{ id: "x", title: "x" }] },
        { topic: "TypeScript", candidates: [], unexpected: true },
        { topic: " ", candidates: [{ id: "a", title: "", body: "" }] },
        { topic: "x", candidates: [{ id: " ", title: "", body: "" }] },
        {
            topic: "x",
            candidates: [
                { id: "a", title: "", body: "" },
                { id: "a", title: "", body: "" },
            ],
        },
    ])("rejects actual invalid input before inference: %j", async (value) => {
        const fixture = setup();
        expect((await fixture.invoke(value as JsonValue)).status).toBe(
            "invalid_input",
        );
        expect(fixture.provider.calls).toHaveLength(0);
    });

    it.each([
        ["text", "not JSON"],
        ["fenced JSON", "```json\n{}\n```"],
        ["wrong shape", JSON.stringify({ decisions: "yes" })],
        ["empty success", JSON.stringify({ decisions: [] })],
        ["extra property", JSON.stringify({ ...output, url: "invented" })],
        [
            "unknown source",
            JSON.stringify({ decisions: [{ id: "x", relevant: false }] }),
        ],
        [
            "duplicate source",
            JSON.stringify({
                decisions: [
                    { id: "a", relevant: false },
                    { id: "a", relevant: false },
                ],
            }),
        ],
        [
            "missing source",
            JSON.stringify({ decisions: [{ id: "a", relevant: false }] }),
        ],
        [
            "missing quotation",
            JSON.stringify({
                decisions: [
                    { id: "a", relevant: true },
                    { id: "b", relevant: false },
                ],
            }),
        ],
        [
            "fabricated quotation",
            JSON.stringify({
                decisions: [
                    { id: "a", relevant: true, evidenceQuote: "carrots" },
                    { id: "b", relevant: false },
                ],
            }),
        ],
        [
            "bad irrelevant quotation",
            JSON.stringify({
                decisions: [
                    { id: "a", relevant: false, evidenceQuote: "invented" },
                    { id: "b", relevant: false },
                ],
            }),
        ],
    ])("rejects malformed/provenance failure: %s", async (_name, text) => {
        const fixture = setup(() =>
            recipeSemanticJsonFixture(output, { text }),
        );
        const result = await fixture.invoke();
        expect(result.status).toBe("invalid_output");
        expect(result.attempts[0]).toMatchObject({
            validation: "failed",
            resolvedModel: "synthetic:relevance-fixture-v1",
            inputTokens: 12,
        });
        expect(fixture.provider.calls).toHaveLength(1);
    });

    it.each([
        { resolvedModel: "" },
        { resolvedModel: " " },
        { inputTokens: -1 },
        { outputTokens: undefined },
        { cost: Infinity },
        { currency: undefined },
        { extra: true },
    ])("requires valid actual model/usage metadata: %j", async (overrides) => {
        const fixture = setup(() =>
            recipeSemanticJsonFixture(output, overrides),
        );
        expect((await fixture.invoke()).status).toBe("invalid_output");
    });

    it("permits an evidenced negative classification, not an invented empty result", async () => {
        const fixture = setup(() =>
            recipeSemanticJsonFixture({
                decisions: [
                    { id: "a", relevant: false },
                    { id: "b", relevant: false },
                ],
            }),
        );
        expect((await fixture.invoke()).status).toBe("completed");
    });

    it("distinguishes explicit abstention from malformed output", async () => {
        const fixture = setup(() => ({
            kind: "abstained",
            reason: "Ambiguous topic.",
            resolvedModel: "synthetic:abstention",
            inputTokens: 2,
            outputTokens: 1,
        }));
        expect(await fixture.invoke()).toMatchObject({
            status: "abstained",
            reason: "Ambiguous topic.",
            attempts: [
                { resolvedModel: "synthetic:abstention", validation: "passed" },
            ],
        });
    });

    it("rejects a blank abstention reason instead of returning empty success", async () => {
        const fixture = setup(() => ({
            kind: "abstained",
            reason: " ",
            resolvedModel: "synthetic:abstention",
            inputTokens: 2,
            outputTokens: 1,
        }));
        expect((await fixture.invoke()).status).toBe("invalid_output");
    });

    it("reports provider failures without exposing provider exception content or retrying", async () => {
        const fixture = setup(() => {
            throw new Error("private transport detail");
        });
        expect(await fixture.invoke()).toMatchObject({
            status: "provider_error",
            message: "Approved semantic provider failed.",
            attempts: [{ validation: "not_returned" }],
        });
        expect(fixture.provider.calls).toHaveLength(1);
    });

    it("applies UTF-8 input bytes rather than character counts", async () => {
        const fixture = setup(undefined, (definition) => {
            definition.bounds.maxInputBytes = 160;
        });
        const value = {
            topic: "x",
            candidates: [{ id: "a", title: "", body: "漢".repeat(60) }],
        };
        expect(JSON.stringify(value).length).toBeLessThan(160);
        expect((await fixture.invoke(value)).status).toBe("limit_exceeded");
        expect(fixture.provider.calls).toHaveLength(0);
    });

    it("bounds provider output bytes", async () => {
        const fixture = setup(undefined, (definition) => {
            definition.bounds.maxOutputBytes = 20;
        });
        expect((await fixture.invoke()).status).toBe("limit_exceeded");
    });

    it("does not accept mutation of a registered specification or policy", async () => {
        const fixture = setup();
        fixture.definition.specification.rubric = "Changed";
        expect((await fixture.invoke()).status).toBe("unsupported");
        expect(fixture.provider.calls).toHaveLength(0);
    });

    it("repairs only invalid output within explicit total-call and repair bounds", async () => {
        const fixture = setup(
            ({ attempt }) =>
                attempt === 0
                    ? recipeSemanticJsonFixture(output, { text: "broken" })
                    : recipeSemanticJsonFixture(output),
            (definition) => {
                definition.revision = "repair-fixture";
                definition.bounds.maxCalls = 2;
                definition.bounds.maxRepairAttempts = 1;
            },
        );
        expect((await fixture.invoke()).status).toBe("completed");
        expect(fixture.provider.calls).toHaveLength(2);
        expect(fixture.provider.calls[1].repair).toEqual({
            diagnostics: "Semantic output is not strict JSON.",
        });
    });

    it("does not silently exceed calls when repair remains", async () => {
        const fixture = setup(
            () => recipeSemanticJsonFixture(output, { text: "broken" }),
            (definition) => {
                definition.bounds.maxRepairAttempts = 1;
            },
        );
        expect((await fixture.invoke()).status).toBe("limit_exceeded");
        expect(fixture.provider.calls).toHaveLength(1);
    });

    it("keeps malformed output distinct when the declared repair depth is exhausted", async () => {
        const fixture = setup(
            () => recipeSemanticJsonFixture(output, { text: "broken" }),
            (definition) => {
                definition.bounds.maxRepairAttempts = 1;
                definition.bounds.maxCalls = 2;
            },
        );
        const result = await fixture.invoke();
        expect(result.status).toBe("invalid_output");
        expect(result.attempts).toHaveLength(2);
    });

    it("rejects pre-cancelled work without calling the provider", async () => {
        const controller = new AbortController();
        controller.abort();
        const fixture = setup();
        expect((await fixture.invoke(input, controller.signal)).status).toBe(
            "cancelled",
        );
        expect(fixture.provider.calls).toHaveLength(0);
    });

    it.each(["resolve", "reject"] as const)(
        "suppresses late %s after timeout and retains real concurrency",
        async (late) => {
            jest.useFakeTimers();
            let resolve!: (value: unknown) => void;
            let reject!: (error: Error) => void;
            const fixture = setup(
                () =>
                    new Promise((yes, no) => {
                        resolve = yes;
                        reject = no;
                    }),
                (definition) => {
                    definition.bounds.timeoutMs = 20;
                },
            );
            try {
                const pending = fixture.invoke();
                expect((await fixture.invoke()).status).toBe("limit_exceeded");
                await jest.advanceTimersByTimeAsync(21);
                const result = await pending;
                expect(result.status).toBe("limit_exceeded");
                expect(fixture.provider.calls[0].signal.aborted).toBe(true);
                expect((await fixture.invoke()).status).toBe("limit_exceeded");
                if (late === "resolve")
                    resolve(recipeSemanticJsonFixture(output));
                else reject(new Error("late failure"));
                await Promise.resolve();
                await Promise.resolve();
                expect(result).toMatchObject({
                    attempts: [{ validation: "not_returned" }],
                });
                expect(fixture.provider.calls).toHaveLength(1);
            } finally {
                jest.useRealTimers();
            }
        },
    );

    it("cancels pending inference immediately and prevents late repair", async () => {
        let release!: (value: unknown) => void;
        const fixture = setup(
            () =>
                new Promise((resolve) => {
                    release = resolve;
                }),
            (definition) => {
                definition.bounds.maxCalls = 2;
                definition.bounds.maxRepairAttempts = 1;
            },
        );
        const controller = new AbortController();
        const pending = fixture.invoke(input, controller.signal);
        controller.abort();
        const result = await pending;
        expect(result.status).toBe("cancelled");
        expect(fixture.provider.calls[0].signal.aborted).toBe(true);
        release(recipeSemanticJsonFixture(output, { text: "broken" }));
        await Promise.resolve();
        await Promise.resolve();
        expect(result).toMatchObject({
            attempts: [{ validation: "not_returned" }],
        });
        expect(fixture.provider.calls).toHaveLength(1);
    });

    it("releases a cancelled inference slot only when its provider settles", async () => {
        let release!: (value: unknown) => void;
        let calls = 0;
        const fixture = setup(() => {
            if (++calls > 1) return recipeSemanticJsonFixture(output);
            return new Promise((resolve) => {
                release = resolve;
            });
        });
        const controller = new AbortController();
        const pending = fixture.invoke(input, controller.signal);
        controller.abort();
        expect((await pending).status).toBe("cancelled");
        expect((await fixture.invoke()).status).toBe("limit_exceeded");
        release(recipeSemanticJsonFixture(output));
        await Promise.resolve();
        await Promise.resolve();
        expect((await fixture.invoke()).status).toBe("completed");
        expect(fixture.provider.calls).toHaveLength(2);
    });

    it("isolates provider mutations from the caller and registration", async () => {
        const fixture = setup((request) => {
            request.definition.specification.rubric = "Mutated";
            (request.input as Record<string, JsonValue>).topic = "Mutated";
            return recipeSemanticJsonFixture(output);
        });
        expect((await fixture.invoke()).status).toBe("completed");
        expect((await fixture.invoke()).status).toBe("completed");
        expect(input).toMatchObject({ topic: "TypeScript" });
        expect(fixture.definition.specification.rubric).not.toBe("Mutated");
    });

    it.each([0, -1, Infinity, 1.5])("rejects invalid bounds: %s", (bound) => {
        expect(() =>
            setup(undefined, (definition) => {
                definition.bounds.maxCalls = bound;
            }),
        ).toThrow("Semantic bounds must be finite supported integers.");
    });
});
