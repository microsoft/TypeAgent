// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { isRuntimeOnlySchema } from "../src/collect.js";
import type { ActionConfig } from "agent-dispatcher/internal";

function makeConfig(
    content: string,
    paths: {
        schemaFilePath?: string;
        originalSchemaFilePath?: string;
    } = {},
): ActionConfig {
    return {
        schemaName: "demo",
        schemaFile: { format: "ts", content },
        schemaFilePath: paths.schemaFilePath,
        originalSchemaFilePath: paths.originalSchemaFilePath,
    } as ActionConfig;
}

describe("isRuntimeOnlySchema", () => {
    it("recognizes an empty schema without authored paths", () => {
        expect(isRuntimeOnlySchema(makeConfig(""))).toBe(true);
    });

    it("keeps a nonempty inline schema in strict collection", () => {
        expect(
            isRuntimeOnlySchema(
                makeConfig('export type Demo = { actionName: "run" }'),
            ),
        ).toBe(false);
    });

    it("keeps an authored empty schema so strict parsing reports the defect", () => {
        expect(
            isRuntimeOnlySchema(
                makeConfig("", { schemaFilePath: "demoSchema.ts" }),
            ),
        ).toBe(false);
    });
});
