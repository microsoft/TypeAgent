// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    typeExprToSchema,
    resolveTypeParams,
    resolveGenericSchemas,
    TypeParamDef,
    ResolvedTaskSchemas,
} from "../src/typeParamUtils.js";
import { SchemaTemplate } from "workflow-model";
import { TypeExpr, NamedType, ArrayType, ObjectType } from "../src/ast.js";

const loc = { offset: 0, line: 1, col: 1 };

function named(name: string): NamedType {
    return { kind: "NamedType", name, loc };
}

function array(element: TypeExpr): ArrayType {
    return { kind: "ArrayType", element, loc };
}

function obj(
    fields: { name: string; type: TypeExpr; optional?: boolean }[],
): ObjectType {
    return {
        kind: "ObjectType",
        fields: fields.map((f) => ({
            name: f.name,
            type: f.type,
            optional: f.optional ?? false,
            loc,
        })),
        loc,
    };
}

describe("typeExprToSchema", () => {
    test("string", () => {
        expect(typeExprToSchema(named("string"))).toEqual({ type: "string" });
    });

    test("number", () => {
        expect(typeExprToSchema(named("number"))).toEqual({ type: "number" });
    });

    test("integer", () => {
        expect(typeExprToSchema(named("integer"))).toEqual({ type: "integer" });
    });

    test("boolean", () => {
        expect(typeExprToSchema(named("boolean"))).toEqual({
            type: "boolean",
        });
    });

    test("never", () => {
        expect(typeExprToSchema(named("never"))).toEqual({ not: {} });
    });

    test("unknown", () => {
        expect(typeExprToSchema(named("unknown"))).toEqual({});
    });

    test("unrecognized named type falls back to empty schema", () => {
        expect(typeExprToSchema(named("SomeCustomType"))).toEqual({});
    });

    test("array of string", () => {
        expect(typeExprToSchema(array(named("string")))).toEqual({
            type: "array",
            items: { type: "string" },
        });
    });

    test("nested array", () => {
        expect(typeExprToSchema(array(array(named("number"))))).toEqual({
            type: "array",
            items: { type: "array", items: { type: "number" } },
        });
    });

    test("object with required fields", () => {
        const te = obj([
            { name: "name", type: named("string") },
            { name: "age", type: named("number") },
        ]);
        expect(typeExprToSchema(te)).toEqual({
            type: "object",
            required: ["name", "age"],
            properties: {
                name: { type: "string" },
                age: { type: "number" },
            },
        });
    });

    test("object with optional fields", () => {
        const te = obj([
            { name: "label", type: named("string"), optional: true },
            { name: "count", type: named("number") },
        ]);
        expect(typeExprToSchema(te)).toEqual({
            type: "object",
            required: ["count"],
            properties: {
                label: { type: "string" },
                count: { type: "number" },
            },
        });
    });

    test("object with nested object field", () => {
        const te = obj([
            {
                name: "inner",
                type: obj([{ name: "x", type: named("number") }]),
            },
        ]);
        expect(typeExprToSchema(te)).toEqual({
            type: "object",
            required: ["inner"],
            properties: {
                inner: {
                    type: "object",
                    required: ["x"],
                    properties: { x: { type: "number" } },
                },
            },
        });
    });

    test("array of objects", () => {
        const te = array(obj([{ name: "id", type: named("integer") }]));
        expect(typeExprToSchema(te)).toEqual({
            type: "array",
            items: {
                type: "object",
                required: ["id"],
                properties: { id: { type: "integer" } },
            },
        });
    });
});

describe("resolveTypeParams", () => {
    const params: TypeParamDef[] = [{ name: "T" }];

    test("replaces $typeParam marker with bound schema", () => {
        const schema = { $typeParam: "T" };
        const result = resolveTypeParams(schema, params, [{ type: "string" }]);
        expect(result).toEqual({ type: "string" });
    });

    test("replaces nested $typeParam in properties", () => {
        const schema: SchemaTemplate = {
            type: "object",
            required: ["value"],
            properties: { value: { $typeParam: "T" } },
        };
        const result = resolveTypeParams(schema, params, [{ type: "number" }]);
        expect(result).toEqual({
            type: "object",
            required: ["value"],
            properties: { value: { type: "number" } },
        });
    });

    test("replaces $typeParam in items", () => {
        const schema: SchemaTemplate = {
            type: "array",
            items: { $typeParam: "T" },
        };
        const result = resolveTypeParams(schema, params, [{ type: "boolean" }]);
        expect(result).toEqual({
            type: "array",
            items: { type: "boolean" },
        });
    });

    test("leaves unresolved markers when no binding exists", () => {
        const schema = { $typeParam: "U" };
        const result = resolveTypeParams(schema, params, [{ type: "string" }]);
        expect(result).toEqual({ $typeParam: "U" });
    });

    test("multiple type params", () => {
        const multiParams: TypeParamDef[] = [{ name: "T" }, { name: "U" }];
        const schema: SchemaTemplate = {
            type: "object",
            properties: {
                input: { $typeParam: "T" },
                output: { $typeParam: "U" },
            },
        };
        const result = resolveTypeParams(schema, multiParams, [
            { type: "string" },
            { type: "number" },
        ]);
        expect(result).toEqual({
            type: "object",
            properties: {
                input: { type: "string" },
                output: { type: "number" },
            },
        });
    });

    test("no-op when no bindings match", () => {
        const schema: SchemaTemplate = { type: "string" };
        const result = resolveTypeParams(schema, [], []);
        expect(result).toEqual({ type: "string" });
    });
});

describe("resolveGenericSchemas", () => {
    test("resolves output schema with explicit type arg", () => {
        const schema = {
            typeParameters: [{ name: "T" }] as TypeParamDef[],
            inputSchema: {
                type: "object" as const,
                required: ["prompt"],
                properties: { prompt: { type: "string" as const } },
            },
            outputSchema: { $typeParam: "T" },
        };
        const result: ResolvedTaskSchemas = resolveGenericSchemas(schema, [
            { type: "object", properties: { name: { type: "string" } } },
        ]);
        expect(result.outputSchema).toEqual({
            type: "object",
            properties: { name: { type: "string" } },
        });
        expect(result.inputSchema).toEqual({
            type: "object",
            required: ["prompt"],
            properties: { prompt: { type: "string" } },
        });
    });

    test("uses default when no explicit arg provided", () => {
        const schema = {
            typeParameters: [
                { name: "T", default: { type: "string" } },
            ] as TypeParamDef[],
            inputSchema: { type: "object" as const, properties: {} },
            outputSchema: { $typeParam: "T" },
        };
        const result = resolveGenericSchemas(schema, []);
        expect(result.outputSchema).toEqual({ type: "string" });
    });

    test("falls back to empty schema when no default and no arg", () => {
        const schema = {
            typeParameters: [{ name: "T" }] as TypeParamDef[],
            inputSchema: { type: "object" as const, properties: {} },
            outputSchema: { $typeParam: "T" },
        };
        const result = resolveGenericSchemas(schema, []);
        expect(result.outputSchema).toEqual({});
    });

    test("resolves both input and output with same type param", () => {
        const schema = {
            typeParameters: [{ name: "T" }] as TypeParamDef[],
            inputSchema: {
                type: "object" as const,
                properties: { data: { $typeParam: "T" } },
            },
            outputSchema: { $typeParam: "T" },
        };
        const result = resolveGenericSchemas(schema, [
            { type: "array", items: { type: "number" } },
        ]);
        expect(result.inputSchema).toEqual({
            type: "object",
            properties: {
                data: { type: "array", items: { type: "number" } },
            },
        });
        expect(result.outputSchema).toEqual({
            type: "array",
            items: { type: "number" },
        });
    });
});
