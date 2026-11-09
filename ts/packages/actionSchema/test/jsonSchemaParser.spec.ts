// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { parseToolsJsonSchema } from "../src/jsonSchemaParser.js";

function getParameters(tool: {
    name: string;
    inputSchema: Record<string, unknown>;
}) {
    const parsed = parseToolsJsonSchema([tool]);
    const action = parsed.actionSchemas.get(tool.name);
    if (action === undefined || action.type.type !== "object") {
        throw new Error("Expected parsed action object");
    }
    const parameters = action.type.fields.parameters?.type;
    if (parameters?.type !== "object") {
        throw new Error("Expected parsed parameters object");
    }
    return parameters;
}

describe("tool JSON Schema parsing", () => {
    it("supports nullable type arrays and oneOf", () => {
        const parameters = getParameters({
            name: "search",
            inputSchema: {
                type: "object",
                properties: {
                    query: { type: ["string", "null"] },
                    limit: {
                        oneOf: [{ type: "integer" }, { type: "null" }],
                    },
                },
            },
        });

        expect(parameters.fields.query.type).toMatchObject({
            type: "type-union",
            types: [{ type: "string" }, { type: "undefined" }],
        });
        expect(parameters.fields.limit.type).toMatchObject({
            type: "type-union",
            types: [{ type: "number" }, { type: "undefined" }],
        });
    });

    it("supports unconstrained values, maps, and arrays", () => {
        const parameters = getParameters({
            name: "invoke",
            inputSchema: {
                type: "object",
                required: ["arguments"],
                properties: {
                    arguments: {
                        type: "object",
                        additionalProperties: true,
                    },
                    metadata: {},
                    values: { type: "array" },
                },
            },
        });

        expect(parameters.fields.arguments.type).toEqual({ type: "any" });
        expect(parameters.fields.metadata.type).toEqual({ type: "any" });
        expect(parameters.fields.values.type).toEqual({
            type: "array",
            elementType: { type: "any" },
        });
    });

    it("supports a fully open parameters object", () => {
        const parsed = parseToolsJsonSchema([
            {
                name: "invoke",
                inputSchema: {
                    type: "object",
                    additionalProperties: true,
                },
            },
        ]);

        const action = parsed.actionSchemas.get("invoke");
        expect(action?.type.type).toBe("object");
        expect(
            action?.type.type === "object"
                ? action.type.fields.parameters?.type
                : undefined,
        ).toEqual({ type: "object", fields: {} });
    });

    it("resolves local references and rejects unresolved references precisely", () => {
        const parameters = getParameters({
            name: "lookup",
            inputSchema: {
                type: "object",
                properties: {
                    filter: { $ref: "#/$defs/filter" },
                },
                $defs: {
                    filter: {
                        type: "object",
                        required: ["name"],
                        properties: { name: { type: "string" } },
                    },
                },
            },
        });

        expect(parameters.fields.filter.type).toMatchObject({
            type: "object",
            fields: {
                name: { type: { type: "string" } },
            },
        });
        expect(() =>
            getParameters({
                name: "broken",
                inputSchema: {
                    type: "object",
                    properties: {
                        value: { $ref: "#/$defs/missing" },
                    },
                },
            }),
        ).toThrow("reference '#/$defs/missing' cannot be resolved");
    });

    it("merges non-overlapping object allOf branches", () => {
        const parameters = getParameters({
            name: "create",
            inputSchema: {
                type: "object",
                properties: {
                    item: {
                        allOf: [
                            {
                                type: "object",
                                required: ["name"],
                                properties: { name: { type: "string" } },
                            },
                            {
                                type: "object",
                                properties: { count: { type: "integer" } },
                            },
                        ],
                    },
                },
            },
        });

        expect(parameters.fields.item.type).toMatchObject({
            type: "object",
            fields: {
                name: { type: { type: "string" } },
                count: { type: { type: "number" }, optional: true },
            },
        });
    });

    it("reports the unsupported schema path", () => {
        expect(() =>
            getParameters({
                name: "broken",
                inputSchema: {
                    type: "object",
                    properties: {
                        filters: {
                            type: "array",
                            items: { type: "unsupported" },
                        },
                    },
                },
            }),
        ).toThrow(
            "broken.inputSchema.filters.items.type: unsupported type 'unsupported'",
        );
    });
});
