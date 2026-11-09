// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, expect, it } from "@jest/globals";
import type {
    ActionSchemaTypeDefinition,
    SchemaObjectFields,
} from "@typeagent/action-schema";

import {
    translationBenchActionValidationPayload,
    validateTranslationBenchGoldAction,
} from "../src/translationBench/synthesizer/actionValidation.js";

function makeDefinition(
    fields: SchemaObjectFields,
): ActionSchemaTypeDefinition {
    // Runtime action schemas may carry extra required literals (e.g. settings `id`)
    // beyond the narrowed ActionSchemaObject field map.
    return {
        alias: false,
        name: "TestAction",
        type: {
            type: "object",
            fields,
        },
    } as ActionSchemaTypeDefinition;
}

describe("translationBench action validation payload", () => {
    it("injects required inline single-literal string-union fields", () => {
        const definition = makeDefinition({
            actionName: {
                type: {
                    type: "string-union",
                    typeEnum: ["dimBrightNessAction"],
                },
            },
            id: {
                type: {
                    type: "string-union",
                    typeEnum: ["settings/dimBrightness"],
                },
            },
            parameters: {
                type: {
                    type: "object",
                    fields: {
                        originalRequest: { type: { type: "string" } },
                    },
                },
            },
        });
        const payload = translationBenchActionValidationPayload(definition, {
            actionName: "dimBrightNessAction",
            parameters: { originalRequest: "dim the screen" },
        });
        expect(payload).toEqual({
            actionName: "dimBrightNessAction",
            id: "settings/dimBrightness",
            parameters: { originalRequest: "dim the screen" },
        });
    });

    it("resolves type-reference aliases before injecting single literals", () => {
        const definition = makeDefinition({
            actionName: {
                type: {
                    type: "string-union",
                    typeEnum: ["adjustMultiMonitorLayoutAction"],
                },
            },
            id: {
                type: {
                    type: "type-reference",
                    name: "AdjustMultiMonitorLayoutId",
                    definition: {
                        alias: true,
                        name: "AdjustMultiMonitorLayoutId",
                        type: {
                            type: "string-union",
                            typeEnum: ["settings/adjustMultiMonitorLayout"],
                        },
                    },
                },
            },
            parameters: {
                type: {
                    type: "object",
                    fields: {
                        originalRequest: { type: { type: "string" } },
                    },
                },
            },
        });
        const payload = translationBenchActionValidationPayload(definition, {
            actionName: "adjustMultiMonitorLayoutAction",
            parameters: { originalRequest: "arrange monitors" },
        });
        expect(payload.id).toBe("settings/adjustMultiMonitorLayout");
    });

    it("restores required empty parameters when gold dropped them", () => {
        const definition = makeDefinition({
            actionName: {
                type: { type: "string-union", typeEnum: ["noopAction"] },
            },
            parameters: {
                type: { type: "object", fields: {} },
            },
        });
        const payload = translationBenchActionValidationPayload(definition, {
            actionName: "noopAction",
        });
        expect(payload).toEqual({
            actionName: "noopAction",
            parameters: {},
        });
    });

    it("does not inject optional single-literal fields", () => {
        const definition = makeDefinition({
            actionName: {
                type: { type: "string-union", typeEnum: ["demoAction"] },
            },
            tag: {
                optional: true,
                type: { type: "string-union", typeEnum: ["only"] },
            },
        });
        const payload = translationBenchActionValidationPayload(definition, {
            actionName: "demoAction",
        });
        expect(payload).toEqual({ actionName: "demoAction" });
        expect(payload).not.toHaveProperty("tag");
    });

    it("validateTranslationBenchGoldAction accepts restored empty parameters", () => {
        const definition = makeDefinition({
            actionName: {
                type: { type: "string-union", typeEnum: ["noopAction"] },
            },
            parameters: {
                type: { type: "object", fields: {} },
            },
        });
        expect(() =>
            validateTranslationBenchGoldAction(definition, {
                actionName: "noopAction",
            }),
        ).not.toThrow();
    });
});
