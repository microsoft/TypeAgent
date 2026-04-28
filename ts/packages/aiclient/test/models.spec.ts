// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    JsonSchemaType,
    StructuredOutputJsonSchema,
    FunctionCallingJsonSchema,
} from "../src/models.js";

describe("models.JsonSchemaType", () => {
    test("JsonSchemaType accepts a plain object schema", () => {
        const schema: JsonSchemaType = {
            type: "object",
            properties: { name: { type: "string" } },
            required: ["name"],
            additionalProperties: false,
        };
        expect(schema["type"]).toBe("object");
    });

    test("StructuredOutputJsonSchema holds a schema object", () => {
        const schema: JsonSchemaType = { type: "object", properties: {} };
        const structured: StructuredOutputJsonSchema = {
            name: "MyAction",
            strict: true,
            schema,
        };
        expect(structured.name).toBe("MyAction");
        expect(structured.schema["type"]).toBe("object");
    });

    test("FunctionCallingJsonSchema holds optional parameters schema", () => {
        const fn: FunctionCallingJsonSchema = {
            type: "function",
            function: {
                name: "doSomething",
                description: "Does something",
                parameters: { type: "object", properties: {} },
                strict: true,
            },
        };
        expect(fn.function.name).toBe("doSomething");
        expect(fn.function.parameters?.["type"]).toBe("object");
    });

    test("FunctionCallingJsonSchema allows omitting parameters", () => {
        const fn: FunctionCallingJsonSchema = {
            type: "function",
            function: { name: "noArgs" },
        };
        expect(fn.function.parameters).toBeUndefined();
    });
});
