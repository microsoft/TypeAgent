// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { allBuiltinTasks } from "../src/builtinTasks.js";
import { getBuiltinTaskSchemas } from "../src/builtinTaskSchemas.js";

describe("builtinTaskSchemas (LSP-facing export)", () => {
    test("contains a schema entry for every built-in task", () => {
        const schemaNames = new Set(getBuiltinTaskSchemas().map((s) => s.name));
        const taskNames = new Set(allBuiltinTasks.map((t) => t.name));
        expect([...schemaNames].sort()).toEqual([...taskNames].sort());
    });

    test("each schema entry matches the corresponding TaskDefinition's input/output schema", () => {
        const byName = new Map(getBuiltinTaskSchemas().map((s) => [s.name, s]));
        for (const task of allBuiltinTasks) {
            const schema = byName.get(task.name);
            expect(schema).toBeDefined();
            expect(schema!.inputSchema).toEqual(task.inputSchema);
            expect(schema!.outputSchema).toEqual(task.outputSchema);
        }
    });

    test("returns a fresh array each call (callers may mutate)", () => {
        const a = getBuiltinTaskSchemas();
        const b = getBuiltinTaskSchemas();
        expect(a).not.toBe(b);
        expect(a).toEqual(b);
    });
});
