// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    parseMacroExecutionRecipe,
    parseMacroLearningBuild,
} from "@typeagent/copilot-macros";

function recipeValue() {
    return {
        schemaVersion: 1,
        traceId: "trace-1",
        request: "Read package.json",
        toolCallIds: ["call-1"],
        description: "Read the recorded package.",
        uncertainties: [],
    };
}

function buildValue() {
    return {
        name: "Read package",
        description: "Read a package file.",
        inputs: [
            {
                name: "path",
                description: "Package path",
                required: true,
                secret: false,
                valueType: "string",
            },
        ],
        steps: [
            {
                id: "step-1",
                toolName: "read",
                executionClass: "agentRequired",
                sourceToolCallId: "call-1",
                arguments: {
                    kind: "template",
                    value: { path: "package.json" },
                    bindings: [
                        {
                            path: ["path"],
                            expression: { kind: "input", name: "path" },
                        },
                    ],
                },
                postconditions: [{ kind: "resultType", valueType: "object" }],
            },
        ],
        exampleInputs: { path: "package.json" },
        requests: [
            "Read package.json",
            "Show package.json",
            "Inspect package.json",
            "Display package.json",
        ],
        unsupportedOutputs: [],
    };
}

describe("model learning JSON parsers", () => {
    it("exports safe recipe and build ingestion without caller casts", () => {
        const recipe: unknown = JSON.parse(JSON.stringify(recipeValue()));
        const build: unknown = JSON.parse(JSON.stringify(buildValue()));
        expect(parseMacroExecutionRecipe(recipe)).toEqual(recipeValue());
        expect(parseMacroLearningBuild(build)).toEqual(buildValue());
    });

    it("preserves canonical text and explicit unsupported-output reports", () => {
        const request = "  Read package.json with EXACT punctuation!  ";
        expect(
            parseMacroExecutionRecipe({ ...recipeValue(), request }).request,
        ).toBe(request);
        expect(
            parseMacroExecutionRecipe({
                ...recipeValue(),
                uncertainties: ["Requested synthesis is not observed."],
            }).uncertainties,
        ).toEqual(["Requested synthesis is not observed."]);
        expect(
            parseMacroLearningBuild({
                ...buildValue(),
                requests: [request, ...buildValue().requests.slice(1)],
                unsupportedOutputs: [
                    "Full requested synthesis cannot be represented.",
                ],
            }).unsupportedOutputs,
        ).toEqual(["Full requested synthesis cannot be represented."]);
    });

    it.each([null, [], "not an object", 1, true])(
        "rejects non-object JSON %p",
        (value) => {
            expect(() => parseMacroExecutionRecipe(value)).toThrow();
            expect(() => parseMacroLearningBuild(value)).toThrow();
        },
    );

    it.each([
        { ...recipeValue(), schemaVersion: 2 },
        { ...recipeValue(), traceId: 1 },
        { ...recipeValue(), request: "" },
        { ...recipeValue(), toolCallIds: ["call-1", "call-1"] },
        { ...recipeValue(), uncertainties: [false] },
        { ...recipeValue(), proposedTask: "Execute an invented task" },
    ])("rejects malformed or extended recipes %p", (value) => {
        expect(() => parseMacroExecutionRecipe(value)).toThrow();
    });

    it.each(["inputs", "steps", "requests"])(
        "rejects malformed %s",
        (field) => {
            expect(() =>
                parseMacroLearningBuild({
                    ...buildValue(),
                    [field]: "not an array",
                }),
            ).toThrow();
        },
    );

    it("rejects invalid schemas, expressions, paths, guards, and example shapes", () => {
        const build = buildValue();
        const invalidValues: unknown[] = [
            { ...build, inputs: [{ ...build.inputs[0], required: "yes" }] },
            { ...build, inputs: [{ ...build.inputs[0], secret: true }] },
            {
                ...build,
                inputs: [{ ...build.inputs[0], valueType: "function" }],
            },
            { ...build, inputs: [build.inputs[0], build.inputs[0]] },
            {
                ...build,
                steps: [{ ...build.steps[0], executionClass: "script" }],
            },
            {
                ...build,
                steps: [
                    {
                        ...build.steps[0],
                        arguments: { kind: "execute", command: "invented" },
                    },
                ],
            },
            {
                ...build,
                steps: [
                    {
                        ...build.steps[0],
                        arguments: {
                            kind: "literal",
                            value: {},
                            command: "invented",
                        },
                    },
                ],
            },
            {
                ...build,
                steps: [
                    {
                        ...build.steps[0],
                        arguments: {
                            kind: "stepResult",
                            stepId: "step-0",
                            path: ["__proto__"],
                        },
                    },
                ],
            },
            {
                ...build,
                steps: [
                    {
                        ...build.steps[0],
                        postconditions: [
                            { kind: "resultPathExists", path: [] },
                        ],
                    },
                ],
            },
            {
                ...build,
                steps: [
                    {
                        ...build.steps[0],
                        postconditions: [
                            { kind: "script", script: "invented" },
                        ],
                    },
                ],
            },
            { ...build, steps: [{ ...build.steps[0], postconditions: [] }] },
            { ...build, exampleInputs: [] },
            { ...build, script: "Unsupported executable output" },
        ];
        for (const value of invalidValues) {
            expect(() => parseMacroLearningBuild(value)).toThrow();
        }
    });

    it.each([4, 5, 6])(
        "accepts the original plus 3-5 variants (%i total)",
        (count) => {
            const requests = Array.from(
                { length: count },
                (_, index) => `Read package variant ${index}`,
            );
            expect(
                parseMacroLearningBuild({ ...buildValue(), requests }).requests,
            ).toEqual(requests);
        },
    );

    it.each([0, 1, 3, 7])("rejects %i total requests", (count) => {
        const requests = Array.from(
            { length: count },
            (_, index) => `Read package variant ${index}`,
        );
        expect(() =>
            parseMacroLearningBuild({ ...buildValue(), requests }),
        ).toThrow();
    });

    it("rejects case/whitespace-only duplicate variants", () => {
        expect(() =>
            parseMacroLearningBuild({
                ...buildValue(),
                requests: [
                    "Read package.json",
                    " read   PACKAGE.JSON ",
                    "Inspect package.json",
                    "Display package.json",
                ],
            }),
        ).toThrow("distinct");
    });

    it("parses all supported expression and guard variants", () => {
        const build = buildValue();
        const parsed = parseMacroLearningBuild({
            ...build,
            steps: [
                {
                    ...build.steps[0],
                    arguments: { kind: "literal", value: null },
                },
                {
                    ...build.steps[0],
                    id: "step-2",
                    arguments: {
                        kind: "stepResult",
                        stepId: "step-1",
                        path: [],
                    },
                    postconditions: [
                        { kind: "resultType", valueType: "object" },
                        { kind: "resultPathExists", path: ["content"] },
                    ],
                },
                {
                    ...build.steps[0],
                    id: "step-3",
                    mcpServerName: "workspace",
                    schemaFingerprint: "schema-v1",
                    arguments: { kind: "input", name: "path" },
                },
            ],
        });
        expect(parsed.steps[0].arguments).toEqual({
            kind: "literal",
            value: null,
        });
        expect(parsed.steps[1].postconditions?.[1]).toEqual({
            kind: "resultPathExists",
            path: ["content"],
        });
        expect(parsed.steps[2].mcpServerName).toBe("workspace");
    });

    it("rejects secret-bearing, non-finite, deeply nested, and oversized values", () => {
        expect(() =>
            parseMacroLearningBuild({
                ...buildValue(),
                exampleInputs: { password: "sensitive" },
            }),
        ).toThrow("Secret-bearing");
        expect(() =>
            parseMacroLearningBuild({
                ...buildValue(),
                exampleInputs: { path: Number.POSITIVE_INFINITY },
            }),
        ).toThrow("finite JSON");
        expect(() =>
            parseMacroExecutionRecipe({
                ...recipeValue(),
                description: "x".repeat(256 * 1024),
            }),
        ).toThrow("256 KiB");
        let nested: unknown = null;
        for (let depth = 0; depth < 35; depth++) nested = { child: nested };
        expect(() =>
            parseMacroLearningBuild({
                ...buildValue(),
                exampleInputs: { path: nested },
            }),
        ).toThrow("structural limits");
    });

    it("returns independent build data", () => {
        const value = buildValue();
        const parsed = parseMacroLearningBuild(value);
        value.exampleInputs.path = "changed";
        value.requests.push("Another request");
        expect(parsed.exampleInputs.path).toBe("package.json");
        expect(parsed.requests).toHaveLength(4);
    });

    it("rejects non-JSON containers and accessors without invoking getters", () => {
        expect(() =>
            parseMacroLearningBuild({
                ...buildValue(),
                exampleInputs: new Map(),
            }),
        ).toThrow("plain JSON");
        expect(() =>
            parseMacroLearningBuild({
                ...buildValue(),
                exampleInputs: { path: new Date() },
            }),
        ).toThrow("plain JSON");
        expect(() =>
            parseMacroLearningBuild({
                ...buildValue(),
                requests: new Array(4),
            }),
        ).toThrow("dense JSON");
        let reads = 0;
        const exampleInputs = Object.defineProperty({}, "path", {
            enumerable: true,
            get: () => {
                reads++;
                return "package.json";
            },
        });
        expect(() =>
            parseMacroLearningBuild({ ...buildValue(), exampleInputs }),
        ).toThrow("accessors");
        expect(reads).toBe(0);
    });
});
