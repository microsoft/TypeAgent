// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { parseActionSchemaSource } from "../src/parser.js";

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
