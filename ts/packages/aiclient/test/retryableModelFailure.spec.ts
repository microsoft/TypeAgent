// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { otel } from "@typeagent/telemetry";
import { isRetryableModelFailure } from "../src/models.js";

describe("explicit retryable model failures", () => {
    test.each([
        [429, true],
        [503, true],
        [401, false],
        [400, false],
    ])(
        "preserves transport classification for HTTP %i",
        (status, retryable) => {
            const classification = otel.classifyTelemetryHttpStatus(status);
            if (!classification) throw new Error("Missing HTTP classification");
            const failure = otel.attachTelemetryErrorClassification(
                { success: false, message: "offline transport fixture" },
                classification,
            );
            expect(isRetryableModelFailure(failure)).toBe(retryable);
        },
    );

    test("messages and arbitrary retryable properties cannot authorize fallback", () => {
        expect(isRetryableModelFailure(new Error("503 unavailable"))).toBe(
            false,
        );
        expect(isRetryableModelFailure({ retryable: true })).toBe(false);
        expect(
            isRetryableModelFailure(
                new DOMException("cancelled", "AbortError"),
            ),
        ).toBe(false);
        expect(isRetryableModelFailure(undefined)).toBe(false);
    });
});
