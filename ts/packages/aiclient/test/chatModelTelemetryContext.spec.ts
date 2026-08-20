// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    getChatModelTelemetryContext,
    withChatModelTelemetryContext,
    withChatModelTelemetryPurpose,
} from "../src/chatModelTelemetryContext.js";

describe("chat model telemetry context", () => {
    it("preserves classification across asynchronous work", async () => {
        const classification = {
            phase: "translation",
            purpose: "action-generation",
            scope: "foreground",
        } as const;

        const observed = await withChatModelTelemetryContext(
            classification,
            async () => {
                await Promise.resolve();
                return getChatModelTelemetryContext();
            },
        );

        expect(observed).toEqual(classification);
        expect(getChatModelTelemetryContext()).toBeUndefined();
    });

    it("overrides purpose without changing phase or scope", () => {
        const observed = withChatModelTelemetryContext(
            {
                phase: "translation",
                purpose: "action-generation",
                scope: "foreground",
            },
            () =>
                withChatModelTelemetryPurpose("schema-selection", () =>
                    getChatModelTelemetryContext(),
                ),
        );

        expect(observed).toEqual({
            phase: "translation",
            purpose: "schema-selection",
            scope: "foreground",
        });
    });

    it("does not invent phase or scope for a purpose-only operation", () => {
        const observed = withChatModelTelemetryPurpose("schema-selection", () =>
            getChatModelTelemetryContext(),
        );

        expect(observed).toBeUndefined();
    });
});
