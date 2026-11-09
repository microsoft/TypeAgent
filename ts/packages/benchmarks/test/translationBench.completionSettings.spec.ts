// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    translationBenchModelConfigurationSchema,
    translationBenchCompletionSettingsSchema,
} from "../src/translationBench/synthesizer/synthesizerPrompts.js";

test.each(["max_tokens", "max_completion_tokens", "max_output_tokens"])(
    "prompt pack settings reject removed optional generation limit %s",
    (key) => {
        const result = translationBenchModelConfigurationSchema.safeParse({
            temperature: 1,
            [key]: 2000,
        });
        expect(result.success).toBe(false);
        if (!result.success)
            expect(result.error.issues[0].message).toContain(key);
    },
);

test("prompt pack completion settings preserve supported controls without generation caps", () => {
    expect(
        translationBenchCompletionSettingsSchema.parse({
            temperature: 1,
            top_p: 0.9,
            seed: 42,
            n: 1,
            reasoning_effort: "high",
            verbosity: "low",
        }),
    ).toEqual({
        temperature: 1,
        top_p: 0.9,
        seed: 42,
        n: 1,
        reasoning_effort: "high",
        verbosity: "low",
    });
});
