// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, expect, it } from "@jest/globals";
import type { SchemaType } from "@typeagent/action-schema";

import {
    listGoldParameterFields,
    rewriteJsonSchemaRequiredForGold,
    stripOptionalFalseGoldBooleans,
} from "../src/translationBench/synthesizer/goldSchema.js";

const montageParameters: SchemaType = {
    type: "object",
    fields: {
        title: { type: { type: "string" } },
        search_filters: {
            optional: true,
            type: { type: "array", elementType: { type: "string" } },
        },
        files: {
            optional: true,
            type: { type: "array", elementType: { type: "string" } },
        },
    },
};

const fileTarget: SchemaType = {
    type: "object",
    fields: {
        language: { type: { type: "string" } },
        file: {
            optional: true,
            type: {
                type: "object",
                fields: {
                    fileName: { optional: true, type: { type: "string" } },
                    createIfNotExists: {
                        optional: true,
                        type: { type: "boolean" },
                    },
                    fallbackToActiveFile: {
                        optional: true,
                        type: { type: "boolean" },
                    },
                },
            },
        },
        focus: { type: { type: "boolean" } },
    },
};

describe("gold schema optionality", () => {
    it("lists required vs optional TypeAgent parameter fields", () => {
        expect(listGoldParameterFields(montageParameters)).toEqual({
            required: ["title"],
            optional: ["search_filters", "files"],
        });
    });

    it("rewrites OpenAI all-required JSON schema to TypeAgent optionality", () => {
        const openaiStyle = {
            type: "object",
            properties: {
                title: { type: "string" },
                search_filters: { type: "array", items: { type: "string" } },
                files: { type: "array", items: { type: "string" } },
            },
            required: ["title", "search_filters", "files"],
            additionalProperties: false,
        };
        const rewritten = rewriteJsonSchemaRequiredForGold(
            openaiStyle,
            montageParameters,
        );
        expect(rewritten.required).toEqual(["title"]);
        expect(openaiStyle.required).toEqual([
            "title",
            "search_filters",
            "files",
        ]);
    });

    it("rewrites nested FileTarget required arrays", () => {
        const openaiStyle = {
            type: "object",
            properties: {
                language: { type: "string" },
                file: {
                    type: "object",
                    properties: {
                        fileName: { type: "string" },
                        createIfNotExists: { type: "boolean" },
                        fallbackToActiveFile: { type: "boolean" },
                    },
                    required: [
                        "fileName",
                        "createIfNotExists",
                        "fallbackToActiveFile",
                    ],
                },
                focus: { type: "boolean" },
            },
            required: ["language", "file", "focus"],
        };
        const rewritten = rewriteJsonSchemaRequiredForGold(
            openaiStyle,
            fileTarget,
        );
        expect(rewritten.required).toEqual(["language", "focus"]);
        const file = rewritten.properties as Record<string, unknown>;
        expect((file.file as { required: string[] }).required).toEqual([]);
    });

    it("strips optional false booleans and keeps required false / optional true", () => {
        const stripped = stripOptionalFalseGoldBooleans(
            {
                language: "python",
                file: {
                    fileName: "server.py",
                    createIfNotExists: false,
                    fallbackToActiveFile: false,
                },
                focus: false,
            },
            fileTarget,
        );
        expect(stripped.parameters).toEqual({
            language: "python",
            file: { fileName: "server.py" },
            focus: false,
        });
        expect(stripped.removed.sort()).toEqual([
            "file.createIfNotExists",
            "file.fallbackToActiveFile",
        ]);
    });

    it("drops a nested file object that only held optional false flags", () => {
        const stripped = stripOptionalFalseGoldBooleans(
            {
                language: "python",
                file: {
                    createIfNotExists: false,
                    fallbackToActiveFile: false,
                },
                focus: true,
            },
            fileTarget,
        );
        expect(stripped.parameters).toEqual({
            language: "python",
            focus: true,
        });
        expect(stripped.removed).toEqual(expect.arrayContaining(["file"]));
    });
});
