// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { parseActionSchemaSource } from "../src/parser.js";

describe("Action Schema with param specs", () => {
    it("basic", async () => {
        const schemaConfig = {
            paramSpec: {
                someAction: {
                    foo: "wildcard",
                },
            },
        } as const;

        const result = await parseActionSchemaSource(
            `export type AllActions = SomeAction;\ntype SomeAction = { actionName: "someAction", parameters: { foo: string } }`,
            "test",
            "AllActions",
            "",
            schemaConfig,
            false,
        );
        const def = result.actionSchemas.get("someAction");
        expect(def).toBeDefined();
        expect(def?.paramSpecs).toMatchObject(
            schemaConfig.paramSpec.someAction,
        );
    });
    it("array", async () => {
        const schemaConfig = {
            paramSpec: {
                someAction: {
                    "foo.*": "percentage",
                },
            },
        } as const;

        const result = await parseActionSchemaSource(
            `export type AllActions = SomeAction;\ntype SomeAction = { actionName: "someAction", parameters: { foo: number[] } }`,
            "test",
            "AllActions",
            "",
            schemaConfig,
            false,
        );
        const def = result.actionSchemas.get("someAction");
        expect(def).toBeDefined();
        expect(def?.paramSpecs).toMatchObject(
            schemaConfig.paramSpec.someAction,
        );
    });
    it("object", async () => {
        const schemaConfig = {
            paramSpec: {
                someAction: {
                    "foo.bar": "ordinal",
                },
            },
        } as const;

        const result = await parseActionSchemaSource(
            `export type AllActions = SomeAction;\ntype SomeAction = { actionName: "someAction", parameters: { foo: { bar: number } } }`,
            "test",
            "AllActions",
            "",
            schemaConfig,
            false,
        );
        const def = result.actionSchemas.get("someAction");
        expect(def).toBeDefined();
        expect(def?.paramSpecs).toMatchObject(
            schemaConfig.paramSpec.someAction,
        );
    });
    it("object reference", async () => {
        const schemaConfig = {
            paramSpec: {
                someAction: {
                    "foo.bar": "checked_wildcard",
                },
            },
        } as const;

        const result = await parseActionSchemaSource(
            `export type AllActions = SomeAction;\ntype T = { bar: string };\ntype SomeAction = { actionName: "someAction", parameters: { foo: T } }`,
            "test",
            "AllActions",
            "",
            schemaConfig,
            false,
        );
        const def = result.actionSchemas.get("someAction");
        expect(def).toBeDefined();
        expect(def?.paramSpecs).toMatchObject(
            schemaConfig.paramSpec.someAction,
        );
    });
    it("array reference", async () => {
        const schemaConfig = {
            paramSpec: {
                someAction: {
                    "foo.*.bar": "time",
                },
            },
        } as const;

        const result = await parseActionSchemaSource(
            `export type AllActions = SomeAction;\ntype T = { bar: string };\ntype SomeAction = { actionName: "someAction", parameters: { foo: T[] } }`,
            "test",
            "AllActions",
            "",
            schemaConfig,
            false,
        );
        const def = result.actionSchemas.get("someAction");
        expect(def).toBeDefined();
        expect(def?.paramSpecs).toMatchObject(
            schemaConfig.paramSpec.someAction,
        );
    });
    it.each(["__proto__", "constructor", "prototype"])(
        "Reject - illegal property %s",
        async (name) => {
            const schemaConfig = {
                paramSpec: {
                    someAction: {
                        [`foo.${name}`]: "wildcard",
                    },
                },
            } as const;

            expect(async () =>
                parseActionSchemaSource(
                    `export type AllActions = SomeAction;\ntype T = { bar: string };\ntype SomeAction = { actionName: "someAction", parameters: { foo: T } }`,
                    "test",
                    "AllActions",
                    "",
                    schemaConfig,
                    false,
                ),
            ).rejects.toThrow(
                `Error parsing schema 'test': Schema Config Error: Invalid parameter name 'foo.${name}' for action 'someAction': Illegal parameter property name '${name}'`,
            );
        },
    );
    it("Reject - index", async () => {
        const schemaConfig = {
            paramSpec: {
                someAction: {
                    "foo.0": "wildcard",
                },
            },
        } as const;

        expect(async () =>
            parseActionSchemaSource(
                `export type AllActions = SomeAction;\ntype SomeAction = { actionName: "someAction", parameters: { foo: string[] } }`,
                "test",
                "AllActions",
                "",
                schemaConfig,
                false,
            ),
        ).rejects.toThrow(
            "Error parsing schema 'test': Schema Config Error: Invalid parameter name 'foo.0' for action 'someAction': paramSpec cannot be applied to specific array index 0",
        );
    });

    it("Reject - field of non-object", async () => {
        const schemaConfig = {
            paramSpec: {
                someAction: {
                    "foo.other": "wildcard",
                },
            },
        } as const;

        expect(async () =>
            parseActionSchemaSource(
                `export type AllActions = SomeAction;\ntype SomeAction = { actionName: "someAction", parameters: { foo: string } }`,
                "test",
                "AllActions",
                "",
                schemaConfig,
                false,
            ),
        ).rejects.toThrow(
            "Error parsing schema 'test': Schema Config Error: Invalid parameter name 'foo.other' for action 'someAction': Access property 'other' of non-object",
        );
    });

    it("Reject - non-exist field", async () => {
        const schemaConfig = {
            paramSpec: {
                someAction: {
                    "foo.other": "wildcard",
                },
            },
        } as const;

        expect(async () =>
            parseActionSchemaSource(
                `export type AllActions = SomeAction;\ntype SomeAction = { actionName: "someAction", parameters: { foo: { bar: string } } }`,
                "test",
                "AllActions",
                "",
                schemaConfig,
                false,
            ),
        ).rejects.toThrow(
            "Error parsing schema 'test': Schema Config Error: Invalid parameter name 'foo.other' for action 'someAction': property 'other' does not exist",
        );
    });
});
