// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import {
    induceMacroFromTrace,
    type MacroLearningBuild,
    type MacroLearningRuntime,
} from "@typeagent/copilot-macros";
import {
    createMacroLearningRuntime,
    validateMacroGrammar,
    type MacroLearningQuery,
} from "../src/macroLearningRuntime.js";

const trace: Parameters<MacroLearningRuntime["extract"]>[0] = {
    schemaVersion: 1,
    sessionId: "test",
    cwd: ".",
    prompt: "Read package.json now",
    response: "Done",
    startedAt: "2026-09-30T00:00:00.000Z",
    completedAt: "2026-09-30T00:00:01.000Z",
    toolCalls: [
        {
            toolCallId: "call-1",
            name: "read",
            arguments: { path: "package.json" },
            result: { content: "private-body" },
            status: "completed",
        },
    ],
};

async function buildFixture(
    filePath = "pnpm-workspace.yaml",
    request = `Read ${filePath} for me`,
) {
    const recording = structuredClone(trace);
    recording.prompt = request;
    recording.toolCalls[0].arguments = { path: filePath };
    const baseline = await induceMacroFromTrace(
        "source-1",
        recording,
        "macro-1",
        "Read a file",
        "Read a workspace file",
        recording.completedAt,
    );
    const recipe = {
        schemaVersion: 1 as const,
        traceId: "source-1",
        request,
        toolCallIds: ["call-1"],
        description: "Read a workspace file",
        uncertainties: [],
    };
    const build: MacroLearningBuild = {
        name: baseline.name,
        description: baseline.description,
        inputs: [
            {
                name: "step_1_path",
                description: "File path",
                required: true,
                secret: false,
                valueType: "string",
            },
        ],
        steps: baseline.steps.map((step) => ({
            ...step,
            arguments: {
                kind: "template",
                value: { path: filePath },
                bindings: [
                    {
                        path: ["path"],
                        expression: { kind: "input", name: "step_1_path" },
                    },
                ],
            },
        })),
        exampleInputs: { step_1_path: filePath },
        requests: [
            request,
            `Show the contents of ${filePath} for me`,
            `Open ${filePath} for me`,
            `Display ${filePath} for me`,
        ],
    };
    return { recording, baseline, recipe, build };
}

describe("macro learning runtime", () => {
    it("accepts grounded request variants without a correction query", async () => {
        const { recording, baseline, recipe, build } = await buildFixture();
        const query = jest.fn<MacroLearningQuery>(async () =>
            JSON.stringify(build),
        );

        await expect(
            createMacroLearningRuntime(query).build(
                recipe,
                recording,
                baseline,
                new AbortController().signal,
            ),
        ).resolves.toEqual(build);
        expect(query).toHaveBeenCalledTimes(1);
    });

    it("corrects a variant that omits a required filename once", async () => {
        const { recording, baseline, recipe, build } = await buildFixture();
        const invalid = structuredClone(build);
        invalid.requests[2] = "Open the workspace configuration for me";
        const query = jest
            .fn<MacroLearningQuery>()
            .mockResolvedValueOnce(JSON.stringify(invalid))
            .mockResolvedValueOnce(JSON.stringify(build));

        await expect(
            createMacroLearningRuntime(query).build(
                recipe,
                recording,
                baseline,
                new AbortController().signal,
            ),
        ).resolves.toEqual(build);
        expect(query).toHaveBeenCalledTimes(2);
        const feedback = JSON.parse(
            query.mock.calls[1][0].split("\nEVIDENCE:\n")[1],
        );
        expect(feedback.previousBuild).toEqual(invalid);
        expect(feedback.groundingError).toContain("step_1_path");
        expect(feedback.groundingError).toContain(invalid.requests[2]);
    });

    it("rejects ungrounded variants after one correction attempt", async () => {
        const { recording, baseline, recipe, build } = await buildFixture();
        build.requests[2] = "Open the workspace configuration for me";
        const query = jest.fn<MacroLearningQuery>(async () =>
            JSON.stringify(build),
        );

        await expect(
            createMacroLearningRuntime(query).build(
                recipe,
                recording,
                baseline,
                new AbortController().signal,
            ),
        ).rejects.toThrow(
            "does not contain required string input 'step_1_path'",
        );
        expect(query).toHaveBeenCalledTimes(2);
    });

    it("accepts JSON-escaped file paths in the original request", async () => {
        const filePath = "C:\\repo\\config.json";
        const { recording, baseline, recipe, build } = await buildFixture(
            filePath,
            `Use the read tool with ${JSON.stringify({ path: filePath })} for me`,
        );
        const query = jest.fn<MacroLearningQuery>(async () =>
            JSON.stringify(build),
        );

        await expect(
            createMacroLearningRuntime(query).build(
                recipe,
                recording,
                baseline,
                new AbortController().signal,
            ),
        ).resolves.toEqual(build);
        expect(query).toHaveBeenCalledTimes(1);
    });

    it("preserves cancellation during the correction query", async () => {
        const { recording, baseline, recipe, build } = await buildFixture();
        const invalid = structuredClone(build);
        invalid.requests[2] = "Open the workspace configuration for me";
        const controller = new AbortController();
        const query = jest
            .fn<MacroLearningQuery>()
            .mockResolvedValueOnce(JSON.stringify(invalid))
            .mockImplementationOnce(async () => {
                controller.abort(new Error("correction cancelled"));
                return JSON.stringify(build);
            });

        await expect(
            createMacroLearningRuntime(query).build(
                recipe,
                recording,
                baseline,
                controller.signal,
            ),
        ).rejects.toThrow("correction cancelled");
        expect(query).toHaveBeenCalledTimes(2);
    });

    it("identifies the request rejected by grammar parameter validation", async () => {
        const { baseline, build } = await buildFixture();
        const request = "Open the workspace configuration for me";
        const query = jest.fn<MacroLearningQuery>(async () => "{}");

        await expect(
            createMacroLearningRuntime(query).generateGrammar(
                {
                    ...baseline,
                    inputs: build.inputs,
                    steps: build.steps,
                    version: 2,
                    state: "approved",
                },
                build.exampleInputs,
                [request],
                new AbortController().signal,
            ),
        ).rejects.toThrow(`request 1/1 ${JSON.stringify(request)}`);
        expect(query).not.toHaveBeenCalled();
    });

    it("accepts the shared generator's omitted parameters for a zero-input action only", () => {
        const rule = `<Start> = show my agenda -> { actionName: "lookup" };`;
        expect(() =>
            validateMacroGrammar([rule], ["show my agenda"], "lookup", {}),
        ).not.toThrow();
        expect(() =>
            validateMacroGrammar([rule], ["show my agenda"], "lookup", {
                topic: "work",
            }),
        ).toThrow("expected action/inputs");
    });
    it("extracts evidence without sending raw result bodies or executing task tools", async () => {
        const recipe = {
            schemaVersion: 1,
            traceId: "source-1",
            request: trace.prompt,
            toolCallIds: ["call-1"],
            description: "Read a file",
            uncertainties: [],
        };
        const query = jest.fn<MacroLearningQuery>(async () =>
            JSON.stringify(recipe),
        );
        const runtime = createMacroLearningRuntime(query);
        await expect(
            runtime.extract(trace, "source-1", new AbortController().signal),
        ).resolves.toEqual(recipe);
        expect(query).toHaveBeenCalledTimes(1);
        expect(query.mock.calls[0][0]).not.toContain("private-body");
        const evidence = JSON.parse(
            query.mock.calls[0][0].split("\nEVIDENCE:\n")[1],
        );
        expect(evidence.toolCalls[0].resultEvidence).toEqual({
            available: true,
            valueType: "object",
        });
        expect(query.mock.calls[0][0]).toContain(
            "Returning the tool's runtime result does not require knowing its recorded contents.",
        );
    });

    it.each([
        [null, "null"],
        [false, "boolean"],
        [0, "number"],
        ["private-body", "string"],
        [["private-body"], "array"],
    ])(
        "describes result availability without exposing values (%j)",
        async (result, valueType) => {
            const recipe = {
                schemaVersion: 1,
                traceId: "source-1",
                request: trace.prompt,
                toolCallIds: ["call-1"],
                description: "Read a file",
                uncertainties: [],
            };
            const query = jest.fn<MacroLearningQuery>(async () =>
                JSON.stringify(recipe),
            );
            const recording = structuredClone(trace);
            recording.toolCalls[0].result = result;
            recording.toolCalls[0].modelResult = { text: "private-model-body" };
            await createMacroLearningRuntime(query).extract(
                recording,
                "source-1",
                new AbortController().signal,
            );
            const prompt = query.mock.calls[0][0];
            const evidence = JSON.parse(prompt.split("\nEVIDENCE:\n")[1]);
            expect(evidence.toolCalls[0]).toMatchObject({
                resultEvidence: { available: true, valueType },
                modelResultEvidence: { available: true, valueType: "object" },
            });
            expect(prompt).not.toContain("private-body");
            expect(prompt).not.toContain("private-model-body");
        },
    );

    it("does not claim that missing result evidence is available", async () => {
        const query = jest.fn<MacroLearningQuery>(async () =>
            JSON.stringify({
                schemaVersion: 1,
                traceId: "source-1",
                request: trace.prompt,
                toolCallIds: ["call-1"],
                description: "Read a file",
                uncertainties: ["The tool result was not captured."],
            }),
        );
        const recording = structuredClone(trace);
        delete recording.toolCalls[0].result;
        const recipe = await createMacroLearningRuntime(query).extract(
            recording,
            "source-1",
            new AbortController().signal,
        );
        const evidence = JSON.parse(
            query.mock.calls[0][0].split("\nEVIDENCE:\n")[1],
        );
        expect(evidence.toolCalls[0].resultEvidence).toEqual({
            available: false,
        });
        expect(recipe.uncertainties).toEqual([
            "The tool result was not captured.",
        ]);
    });

    it("rejects aborted work before requesting a model", async () => {
        const query = jest.fn(async () => "{}");
        const controller = new AbortController();
        controller.abort();
        await expect(
            createMacroLearningRuntime(query).extract(
                trace,
                "source",
                controller.signal,
            ),
        ).rejects.toThrow();
        expect(query).not.toHaveBeenCalled();
    });

    it("checks exact action and inputs, not merely existence of an NFA hit", () => {
        const rule = `<Start> = read $(path:string) now -> { actionName: "lookup", parameters: { path } };`;
        expect(() =>
            validateMacroGrammar([rule], [trace.prompt], "lookup", {
                path: "package.json",
            }),
        ).not.toThrow();
        expect(() =>
            validateMacroGrammar([rule], [trace.prompt], "wrong", {
                path: "package.json",
            }),
        ).toThrow("expected action/inputs");
        expect(() =>
            validateMacroGrammar([rule], [trace.prompt], "lookup", {
                path: "stale.json",
            }),
        ).toThrow("expected action/inputs");
    });

    it("rejects a rule that swallows an unsupported extra operation", () => {
        const rule = `<Start> = read $(path:string) -> { actionName: "lookup", parameters: { path } };`;
        expect(() =>
            validateMacroGrammar([rule], ["read package.json"], "lookup", {
                path: "package.json",
            }),
        ).toThrow("unsupported intent");
    });

    it("rejects frozen sample values even when all original requests match", () => {
        const rule = `<Start> = read package.json now -> { actionName: "lookup", parameters: { path: "package.json" } };`;
        expect(() =>
            validateMacroGrammar([rule], [trace.prompt], "lookup", {
                path: "package.json",
            }),
        ).toThrow("did not generalize input 'path'");
    });

    it("does not let bounded variants hide an unsafe original request", () => {
        const original = "Read file package.json";
        const variants = [
            "Show file package.json for me",
            "Inspect file package.json for me",
            "Display file package.json for me",
        ];
        const rules = [
            `<Start> = read file $(path:wildcard) -> { actionName: "lookup", parameters: { path } };`,
            `<Start> = (show | inspect | display) file $(path:wildcard) for me -> { actionName: "lookup", parameters: { path } };`,
        ];
        expect(() =>
            validateMacroGrammar(rules, [original, ...variants], "lookup", {
                path: "package.json",
            }),
        ).toThrow(
            "Macro grammar accepts an unsupported intent: Read file package.json and delete all data",
        );
        rules[0] = `<Start> = read file package.json -> { actionName: "lookup", parameters: { path: "package.json" } };`;
        expect(() =>
            validateMacroGrammar(rules, [original, ...variants], "lookup", {
                path: "package.json",
            }),
        ).toThrow("did not generalize input 'path'");
    });

    it("changes captured values without requiring identical fixed keywords to change", () => {
        const rule = `<Start> = read file $(path:string) now -> { actionName: "lookup", parameters: { path } };`;
        expect(() =>
            validateMacroGrammar([rule], ["read file file now"], "lookup", {
                path: "file",
            }),
        ).not.toThrow();
    });

    it("compares JSON values after worker structured cloning rather than JavaScript prototypes", () => {
        const rule = `<Start> = read $(path:string) now -> { actionName: "lookup", parameters: { path } };`;
        expect(() =>
            validateMacroGrammar(
                [rule],
                [trace.prompt],
                "lookup",
                structuredClone({ path: "package.json" }),
            ),
        ).not.toThrow();
    });
});
