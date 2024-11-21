// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as sc from "../src/creator.js";
import { SchemaType } from "../src/type.js";
import { validateSchema } from "../src/validate.js";

const fields: sc.FieldSpec = { a: sc.string(), b: sc.optional(sc.number()) };
const obj = sc.obj(fields);

const invalidStrings = [1, true, undefined, null, {}, []];
const validObjects = [{ a: "a" }, { a: "a2", b: 1 }, { a: "a3", b: undefined }];
const invalidObjects = [
    1,
    true,
    undefined,
    null,
    {},
    [],
    { b: "b" }, // wrong type
    { c: "c" }, // extra field
    ...invalidStrings.map((a) => ({ a })),
];

const invalidArrayOfObjects = invalidObjects.map((a) => [...validObjects, a]);
const tests: {
    name: string;
    schema: SchemaType;
    valid: any[];
    invalid: any[];
}[] = [
    {
        name: "string",
        schema: sc.string(),
        valid: ["a", ""],
        invalid: invalidStrings,
    },
    {
        name: "number",
        schema: sc.number(),
        valid: [1, 0, 2.3, -0, -1, -2.3, Infinity, -Infinity, NaN],
        invalid: ["a", true, undefined, null, {}, []],
    },
    {
        name: "boolean",
        schema: sc.boolean(),
        valid: [true, false],
        invalid: [1, "a", undefined, null, {}, []],
    },
    {
        name: "object",
        schema: sc.obj(fields),
        valid: validObjects,
        invalid: invalidObjects,
    },
    {
        name: "string union",
        schema: sc.string("a", "b"),
        valid: ["a", "b"],
        invalid: [...invalidStrings, "c"],
    },
    {
        name: "object with type ref",
        schema: sc.obj({
            ...fields,
            ref: sc.ref(sc.intf("ref", obj)),
        }),
        valid: validObjects.map((a) => ({ ...a, ref: a })),
        invalid: validObjects.flatMap((a) =>
            invalidObjects.map((b) => ({ ...a, ref: b })),
        ),
    },
    {
        name: "array of strings",
        schema: sc.array(sc.string()),
        valid: [[], ["a"], ["a", "b"]],
        invalid: invalidStrings.map((a) => [a, a]),
    },
    {
        name: "array of objects",
        schema: sc.array(obj),
        valid: [[], validObjects],
        invalid: invalidArrayOfObjects,
    },
    {
        name: "primitive union type",
        schema: sc.union(sc.string(), sc.number()),
        valid: ["a", 1],
        invalid: [true, undefined, null, {}, []],
    },
    {
        name: "complex union type",
        schema: sc.union(obj, sc.array(obj)),
        valid: [[], validObjects, ...validObjects],
        invalid: [
            ...invalidObjects.filter((a) => !Array.isArray(a)),
            ...invalidArrayOfObjects,
        ],
    },
];

describe("Action Schema Creator", () => {
    describe.each(tests)("$name", ({ name, schema, valid, invalid }) => {
        it.each(valid.map((a) => [a]))("valid: %p", (value) => {
            validateSchema(name, schema, value);
        });
        it.each(invalid.map((a) => [a]))("invalid: %p", (value) => {
            expect(() => validateSchema(name, schema, value)).toThrow();
        });
    });
});
