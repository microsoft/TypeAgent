// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, expect, it } from "@jest/globals";

import { classifyTranslationBenchAmbiguityAgreement } from "../src/translationBench/synthesizer/ambiguityProbe.js";

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
});
