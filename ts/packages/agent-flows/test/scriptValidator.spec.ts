// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, expect, it } from "@jest/globals";
import { createScriptExecutor } from "../src/execution/scriptExecutor.js";
import { createScriptValidator } from "../src/validation/scriptValidator.js";

describe("script validator", () => {
    const validator = createScriptValidator({
        apiParamName: "repo",
        getSandboxDeclarations: () => "",
    });

    it("allows ordinary literal and variable-indexed element access", () => {
        const validation = validator.validate(
            `async function execute(repo, params) {
    const values = ["safe"];
    const record = { safe: "value" };
    const index = 0;
    const key = "safe";
    return { success: true, data: values[index] + record[key] };
}`,
            [],
        );

        expect(validation.valid).toBe(true);
    });

    it("continues to reject dangerous literal element access", () => {
        const validation = validator.validate(
            `async function execute(repo, params) {
    return { success: true, data: ({} as any)["__proto__"] };
}`,
            [],
        );

        expect(validation.valid).toBe(false);
        expect(validation.errors).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    message: "Computed access to '__proto__' is not allowed",
                }),
            ]),
        );
    });

    it.each([
        {
            name: "computed __proto__",
            body: `
    ({} as any)["__" + "proto__"][params.marker] = true;`,
        },
        {
            name: "computed constructor",
            body: `
    const FunctionConstructor = ({} as any)["con" + "structor"]["con" + "structor"];
    FunctionConstructor("marker", "Object.prototype[marker] = true")(params.marker);`,
        },
    ])("rejects $name before it can mutate the host", async ({ body }) => {
        const marker = "__typeagentScriptValidatorEscape__";
        const hostPrototype = Object.prototype as Record<string, unknown>;
        delete hostPrototype[marker];
        const source = `async function execute(repo, params) {${body}
    return { success: true };
}`;
        try {
            const validation = validator.validate(source, []);
            const execution = validation.valid
                ? await createScriptExecutor({
                      apiParamName: "repo",
                  }).execute(source, {}, { marker })
                : undefined;

            expect(validation.valid).toBe(false);
            expect(validation.errors).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        message: expect.stringMatching(
                            /Computed access to '(?:__proto__|constructor)' is not allowed/,
                        ),
                    }),
                ]),
            );
            expect(execution).toBeUndefined();
            expect(hostPrototype[marker]).toBeUndefined();
        } finally {
            delete hostPrototype[marker];
        }
    });
});
