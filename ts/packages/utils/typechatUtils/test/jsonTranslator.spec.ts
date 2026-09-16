// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createJsonTranslatorCompletionSettings } from "../src/jsonTranslator.js";

describe("JSON translator completion settings", () => {
    it("omits reasoning effort when the translation config inherits defaults", () => {
        expect(createJsonTranslatorCompletionSettings(undefined)).toEqual({
            response_format: { type: "json_object" },
        });
    });

    it.each(["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const)(
        "passes reasoning effort %s to the chat model",
        (reasoningEffort) => {
            expect(
                createJsonTranslatorCompletionSettings(reasoningEffort),
            ).toEqual({
                response_format: { type: "json_object" },
                reasoning_effort: reasoningEffort,
            });
        },
    );
});
