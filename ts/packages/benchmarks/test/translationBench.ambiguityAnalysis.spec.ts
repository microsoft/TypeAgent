// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, expect, it } from "@jest/globals";

import {
    classifyTranslationBenchAmbiguityAgreement,
    probeTranslationBenchAmbiguityCases,
} from "../src/translationBench/synthesizer/ambiguityProbe.js";

describe("translation bench ambiguity analysis", () => {
    it("reports disagreement between routes", () => {
        const result = classifyTranslationBenchAmbiguityAgreement(
            [{ schemaName: "calendar", actionName: "addEvent" }],
            [
                {
                    model: "one",
                    actions: [
                        { schemaName: "calendar", actionName: "addEvent" },
                    ],
                },
                {
                    model: "two",
                    actions: [
                        { schemaName: "calendar", actionName: "findEvents" },
                    ],
                },
            ],
        );

        expect(result.agreement).toBe("split");
        expect(result.routes).toHaveLength(2);
    });

    it("records a rejected model translation", async () => {
        const cases = await probeTranslationBenchAmbiguityCases({
            candidate: {
                seed: {
                    utterance: "add a meeting",
                    expectedActions: [
                        { schemaName: "calendar", actionName: "addEvent" },
                    ],
                    order: "strict",
                },
                genCases: [],
            },
            activeSchemas: ["calendar"],
            translator: {
                models: ["one", "two"],
                translate: async ({ model }) => {
                    if (model === "two") throw new Error("unavailable");
                    return {
                        model,
                        actions: [
                            { schemaName: "calendar", actionName: "addEvent" },
                        ],
                    };
                },
            },
        });

        expect(cases[0]!.observations[1]).toEqual({
            model: "two",
            actions: [],
            error: "unavailable",
        });
    });
});
