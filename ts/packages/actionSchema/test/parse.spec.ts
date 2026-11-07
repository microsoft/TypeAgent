// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    generateActionActionFunctionJsonSchemas,
    generateActionJsonSchema,
    parseActionSchemaSource,
    parseSchemaSource,
    validateAction,
    validateType,
} from "../src/index.js";

describe("Action Schema Strict Checks", () => {
    it("Error on action entry type not found", async () =>
        expect(async () =>
            parseActionSchemaSource(
                `type SomeAction = { actionName: "someAction" }`,
                "test",
                "SomeOtherAction",
                "",
                undefined,
                true,
            ),
        ).rejects.toThrow(
            "Error parsing schema 'test': Action type 'SomeOtherAction' not found",
        ));
    it("Error on activity entry type not found", async () =>
        expect(async () =>
            parseActionSchemaSource(
                `type SomeAction = { actionName: "someAction" }`,
                "test",
                {
                    action: "SomeAction",
                    activity: "SomeOtherAction",
                },
                "",
                undefined,
                true,
            ),
        ).rejects.toThrow(
            "Error parsing schema 'test': Activity type 'SomeOtherAction' not found",
        ));
    it("Error on action entry type not exported", async () =>
        expect(async () =>
            parseActionSchemaSource(
                `type SomeAction = { actionName: "someAction" }`,
                "test",
                "SomeAction",
                "",
                undefined,
                true,
            ),
        ).rejects.toThrow(
            "Error parsing schema 'test': Schema Error: Action entry type 'SomeAction' must be exported",
        ));

    it("Error on action entry type comment", async () =>
        expect(async () =>
            parseActionSchemaSource(
                `// comments\nexport type AllActions = SomeAction;\ntype SomeAction = { actionName: "someAction" }`,
                "test",
                "AllActions",
                "",
                undefined,
                true,
            ),
        ).rejects.toThrow(
            "Error parsing schema 'test': Schema Error: entry type comments for 'AllActions' are not used for prompts. Remove from the action schema file.",
        ));

    it("Error on duplicate action name", async () =>
        expect(async () =>
            parseActionSchemaSource(
                `export type AllActions = SomeAction | SomeAction2;\ntype SomeAction = { actionName: "someAction" }\ntype SomeAction2 = { actionName: "someAction" }`,
                "test",
                "AllActions",
                "",
                undefined,
                true,
            ),
        ).rejects.toThrow(
            "Error parsing schema 'test': Schema Error: Duplicate action name 'someAction'",
        ));

    it("Error on anonymous types", async () =>
        expect(async () =>
            parseActionSchemaSource(
                `export type AllActions = SomeAction | { actionName: "someAction2" };\ntype SomeAction = { actionName: "someAction" }`,
                "test",
                "AllActions",
                "",
                undefined,
                true,
            ),
        ).rejects.toThrow(
            "Error parsing schema 'test': Schema Error: expected type reference in the entry type union",
        ));
});

describe.each([true, false])("boolean literal %s", (literal) => {
    const parsed = parseActionSchemaSource(
        `export type LiteralAction = {
            actionName: "literal";
            parameters: { value: ${literal} };
        };`,
        "literal",
        "LiteralAction",
    );
    const action = parsed.actionSchemas.get("literal")!;
    const group = { entry: action, actionSchemas: parsed.actionSchemas };
    const types = parseSchemaSource(`
        type Flag = ${literal};
        type Flags = {
            values: Flag[];
            optional?: Flag;
            choice: Flag | "other";
        };
    `);
    const flag = types.get("Flag")!.type;
    const flags = types.get("Flags")!.type;
    const expectedJsonSchema = { type: "boolean", enum: [literal] };

    it("validates matching action values and rejects the opposite literal", () => {
        expect(() =>
            validateAction(action, {
                actionName: "literal",
                parameters: { value: literal },
            }),
        ).not.toThrow();
        expect(() =>
            validateAction(action, {
                actionName: "literal",
                parameters: { value: !literal },
            }),
        ).toThrow(
            `Field 'parameters.value' is not ${literal}, got boolean instead`,
        );
    });

    it("validates standalone values without accepting other primitive types", () => {
        expect(() => validateType(flag, literal)).not.toThrow();
        expect(() => validateType(flag, !literal)).toThrow(
            `Input is not ${literal}, got boolean instead`,
        );
        for (const value of [String(literal), 0, 1, undefined, null]) {
            expect(() => validateType(flag, value)).toThrow();
        }
    });

    it("validates aliases in arrays, optional fields and unions", () => {
        expect(() =>
            validateType(flags, { values: [literal], choice: "other" }),
        ).not.toThrow();
        expect(() =>
            validateType(flags, {
                values: [],
                optional: literal,
                choice: literal,
            }),
        ).not.toThrow();
        expect(() =>
            validateType(flags, { values: [!literal], choice: "other" }),
        ).toThrow(`Field 'values.0' is not ${literal}, got boolean instead`);
        expect(() =>
            validateType(flags, {
                values: [],
                optional: !literal,
                choice: "other",
            }),
        ).toThrow(`Field 'optional' is not ${literal}, got boolean instead`);
        expect(() =>
            validateType(flags, { values: [], choice: !literal }),
        ).toThrow("Field 'choice' does not match any union type");
    });

    it("only coerces a string matching the literal when requested", () => {
        const value = {
            actionName: "literal",
            parameters: { value: String(literal) },
        };
        validateAction(action, value, true);
        expect(value.parameters.value).toBe(literal);
        expect(() =>
            validateAction(
                action,
                {
                    actionName: "literal",
                    parameters: { value: String(!literal) },
                },
                true,
            ),
        ).toThrow(
            `Field 'parameters.value' is not ${literal}, got string instead`,
        );
    });

    it("generates a constrained boolean in the response JSON schema", () => {
        expect(generateActionJsonSchema(group).schema).toMatchObject({
            properties: {
                response: {
                    properties: {
                        parameters: {
                            properties: { value: expectedJsonSchema },
                        },
                    },
                },
            },
        });
    });

    it("generates a constrained boolean in the function JSON schema", () => {
        expect(generateActionActionFunctionJsonSchemas(group)).toMatchObject([
            {
                type: "function",
                function: {
                    name: "literal",
                    strict: true,
                    parameters: {
                        properties: { value: expectedJsonSchema },
                    },
                },
            },
        ]);
    });
});
