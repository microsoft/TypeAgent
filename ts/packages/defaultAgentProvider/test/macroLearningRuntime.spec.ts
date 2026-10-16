// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
    induceMacroFromTrace,
    PrivateResultStore,
    cloneVerifiedLearningTrace,
    type MacroLearningBuild,
    type MacroLearningRuntime,
} from "@typeagent/copilot-macros";
import {
    createMacroLearningRuntime,
    validateMacroGrammar,
    replayMacroGrammarDiagnostic,
    type MacroLearningQuery,
    type MacroVerifierCache,
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
    it("routes extraction, corrected builds, grammar and the supplied program author through an isolated override", async () => {
        const { recording, baseline, recipe, build } = await buildFixture(
            "package.json",
            "Read package.json now",
        );
        const invalid = structuredClone(build);
        invalid.requests[2] = "Open the workspace configuration for me";
        const original = jest.fn<MacroLearningQuery>(async () => {
            throw new Error("Original provider must not run");
        });
        const override = jest
            .fn<MacroLearningQuery>()
            .mockResolvedValueOnce(JSON.stringify(recipe))
            .mockResolvedValueOnce(JSON.stringify(invalid))
            .mockResolvedValueOnce(JSON.stringify(build))
            .mockResolvedValueOnce(
                JSON.stringify({
                    shouldGenerateGrammar: true,
                    requestAnalysis: { sentences: [] },
                    parameterMappings: [
                        {
                            parameterName: "step_1_path",
                            sourceText: "package.json",
                            targetValue: "package.json",
                            isWildcard: true,
                        },
                    ],
                    fixedPhrases: ["Read", "now"],
                    grammarPattern: {
                        matchPattern: "Read $(step_1_path:string) now",
                        actionParameters: [
                            {
                                parameterName: "step_1_path",
                                parameterValue: "step_1_path",
                            },
                        ],
                    },
                    reasoning: "Preserve fixed request boundaries.",
                }),
            );
        const programAuthor = jest.fn<MacroLearningRuntime["buildProgram"]>(
            async () => {
                throw new Error("program author reached");
            },
        );
        const loadApproved = jest.fn(async () => []);
        const assertSource = jest.fn(async () => undefined);
        const retainResponse = jest.fn(async () => undefined);
        const cacheVerifier = jest.fn<MacroVerifierCache>(
            async (_prompt, execute) => execute(),
        );
        const runtime = createMacroLearningRuntime(
            original,
            loadApproved,
            { buildResponseEvidence: { assertSource, retainResponse } },
            programAuthor,
        ).withAuthorQuery!(override, cacheVerifier);
        const signal = new AbortController().signal;
        await expect(
            runtime.extract(recording, recipe.traceId, signal),
        ).resolves.toEqual(recipe);
        await expect(
            runtime.build(recipe, recording, baseline, signal),
        ).resolves.toEqual(build);
        const macro = { ...baseline, inputs: build.inputs, steps: build.steps };
        await expect(
            runtime.generateGrammar(
                macro,
                build.exampleInputs,
                [recording.prompt],
                signal,
            ),
        ).resolves.toHaveLength(1);
        await expect(
            runtime.buildProgram(macro, recording, signal),
        ).rejects.toThrow("program author reached");
        expect(programAuthor).toHaveBeenCalledWith(
            macro,
            recording,
            signal,
            override,
            cacheVerifier,
        );
        expect(override).toHaveBeenCalledTimes(4);
        expect(original).not.toHaveBeenCalled();
        expect(loadApproved).toHaveBeenCalledTimes(1);
        expect(assertSource).toHaveBeenCalledTimes(2);
        expect(retainResponse).toHaveBeenCalledTimes(2);
        expect(override.mock.calls[0][1]).not.toBe(signal);
        expect(override.mock.calls[3][1].aborted).toBe(true);
        expect(override.mock.calls[0][0]).not.toContain("private-body");
    });

    it("does not mutate the original runtime or retain a previous author query when rebound", async () => {
        const { recording, recipe } = await buildFixture();
        const original = jest.fn<MacroLearningQuery>(async () =>
            JSON.stringify(recipe),
        );
        const first = jest.fn<MacroLearningQuery>(async () => "{}");
        const second = jest.fn<MacroLearningQuery>(async () =>
            JSON.stringify(recipe),
        );
        const programAuthor = jest.fn<MacroLearningRuntime["buildProgram"]>(
            async () => {
                throw new Error("program author reached");
            },
        );
        const runtime = createMacroLearningRuntime(
            original,
            undefined,
            undefined,
            programAuthor,
        );
        const rebound =
            runtime.withAuthorQuery!(first).withAuthorQuery!(second);
        const signal = new AbortController().signal;
        await runtime.extract(recording, recipe.traceId, signal);
        await rebound.extract(recording, recipe.traceId, signal);
        await expect(
            rebound.buildProgram(
                (await buildFixture()).baseline,
                recording,
                signal,
            ),
        ).rejects.toThrow("program author reached");
        expect(programAuthor.mock.calls[0][3]).toBe(second);
        expect(original).toHaveBeenCalledTimes(1);
        expect(second).toHaveBeenCalledTimes(1);
        expect(first).not.toHaveBeenCalled();
        expect(runtime.buildProgram).toBe(programAuthor);
    });

    it("validates external extraction and build responses without provider fallback", async () => {
        const { recording, recipe, baseline } = await buildFixture();
        const original = jest.fn<MacroLearningQuery>();
        const override = jest.fn<MacroLearningQuery>(async () => "{}");
        const runtime =
            createMacroLearningRuntime(original).withAuthorQuery!(override);
        const signal = new AbortController().signal;
        await expect(
            runtime.extract(recording, recipe.traceId, signal),
        ).rejects.toThrow();
        await expect(
            runtime.build(recipe, recording, baseline, signal),
        ).rejects.toThrow();
        expect(override).toHaveBeenCalledTimes(2);
        expect(original).not.toHaveBeenCalled();
    });

    it.each([
        ["invalid JSON", "not JSON", 3],
        [
            "shared grammar mutation",
            JSON.stringify({ phrasesToAdd: [{ name: "shared", phrases: [] }] }),
            1,
        ],
        [
            "foreign helper declarations",
            JSON.stringify({
                additionalRules: [
                    { name: "Shared", ruleText: "<Shared> = read;" },
                ],
            }),
            1,
        ],
    ])(
        "rejects external grammar %s without provider fallback",
        async (_name, response, attempts) => {
            const { baseline, build } = await buildFixture(
                "package.json",
                "Read package.json now",
            );
            const original = jest.fn<MacroLearningQuery>();
            const override = jest.fn<MacroLearningQuery>(async () => response);
            await expect(
                createMacroLearningRuntime(original).withAuthorQuery!(
                    override,
                ).generateGrammar(
                    { ...baseline, inputs: build.inputs, steps: build.steps },
                    build.exampleInputs,
                    ["Read package.json now"],
                    new AbortController().signal,
                ),
            ).rejects.toThrow();
            expect(override).toHaveBeenCalledTimes(attempts);
            expect(original).not.toHaveBeenCalled();
        },
    );

    it("preserves cancellation and grammar request bounds with external queries", async () => {
        const { recording, recipe, baseline, build } = await buildFixture();
        const original = jest.fn<MacroLearningQuery>();
        const controller = new AbortController();
        const override = jest.fn<MacroLearningQuery>(
            async (_prompt, signal) => {
                controller.abort(new Error("external author cancelled"));
                expect(signal.aborted).toBe(true);
                return JSON.stringify(recipe);
            },
        );
        const runtime =
            createMacroLearningRuntime(original).withAuthorQuery!(override);
        await expect(
            runtime.generateGrammar(
                baseline,
                build.exampleInputs,
                [],
                controller.signal,
            ),
        ).rejects.toThrow("1-6 grounded requests");
        expect(override).not.toHaveBeenCalled();
        await expect(
            runtime.extract(recording, recipe.traceId, controller.signal),
        ).rejects.toThrow("external author cancelled");
        await expect(
            runtime.extract(recording, recipe.traceId, controller.signal),
        ).rejects.toThrow("external author cancelled");
        expect(override).toHaveBeenCalledTimes(1);
        expect(original).not.toHaveBeenCalled();
    });

    it("preserves the original external pending-query error through grammar generation", async () => {
        const { baseline, build } = await buildFixture(
            "package.json",
            "Read package.json now",
        );
        const pending = new Error("external authoring pending");
        const original = jest.fn<MacroLearningQuery>();
        const override = jest.fn<MacroLearningQuery>(async () => {
            throw pending;
        });
        await expect(
            createMacroLearningRuntime(original).withAuthorQuery!(
                override,
            ).generateGrammar(
                { ...baseline, inputs: build.inputs, steps: build.steps },
                build.exampleInputs,
                ["Read package.json now"],
                new AbortController().signal,
            ),
        ).rejects.toBe(pending);
        expect(override).toHaveBeenCalledTimes(1);
        expect(original).not.toHaveBeenCalled();
    });

    it("transports only physically verified recording evidence through the extraction query", async () => {
        const root = path.resolve(".learning-input-tests", randomUUID());
        try {
            await mkdir(path.join(root, "traces"), { recursive: true });
            const source = structuredClone(trace);
            await writeFile(
                path.join(root, "traces", "source.json"),
                JSON.stringify(source),
            );
            await new PrivateResultStore(root).verifyLearningTrace(
                "source",
                source,
            );
            const captured: any[] = [];
            const query = jest.fn<MacroLearningQuery>(async (prompt) => {
                captured.push(JSON.parse(prompt.split("\nEVIDENCE:\n")[1]));
                return JSON.stringify({
                    schemaVersion: 1,
                    traceId: "source",
                    request: source.prompt,
                    toolCallIds: ["call-1"],
                    description: "Read the recorded file",
                    uncertainties: [],
                });
            });
            const runtime = createMacroLearningRuntime(query);
            await runtime.extract(
                cloneVerifiedLearningTrace(source, "source"),
                "source",
                new AbortController().signal,
            );
            expect(captured[0].verifiedRecordingEvidence).toEqual({
                schemaVersion: 1,
                traceId: "source",
                sessionId: "test",
                sourceTraceSha256: createHash("sha256")
                    .update(JSON.stringify(source))
                    .digest("hex"),
            });
            expect(captured[0].responseEvidence).toEqual({
                available: true,
                valueType: "string",
            });
            expect(JSON.stringify(captured[0])).not.toContain("private-body");
            await runtime.extract(
                Object.assign(structuredClone(source), {
                    verifiedRecordingEvidence: { workiqRead: { passed: true } },
                }),
                "source",
                new AbortController().signal,
            );
            expect(captured[1].verifiedRecordingEvidence).toBeUndefined();
            const changed = cloneVerifiedLearningTrace(source, "source");
            changed.sessionId = "foreign";
            await expect(
                runtime.extract(
                    changed,
                    "source",
                    new AbortController().signal,
                ),
            ).rejects.toThrow("identity or contents changed");
            expect(query).toHaveBeenCalledTimes(2);
        } finally {
            await rm(root, { recursive: true, force: true });
            await rm(path.dirname(root)).catch(() => undefined);
        }
    });

    it.each([
        { pattern: "different words", count: 0, expected: 0 },
        { pattern: "read $(path:string) now", count: 1, expected: 0 },
    ])(
        "reports body-free counterexample counts with strict replay",
        ({ pattern, count, expected }) => {
            const tuple = {
                rules: [
                    `<Start> = ${pattern} -> { actionName: "lookup", parameters: { path: "PRIVATE-WRONG" } };`,
                ],
                requests: ["read PRIVATE-REQUEST now"],
                actionName: "lookup",
                exampleInputs: { path: "PRIVATE-REQUEST" },
            };
            try {
                replayMacroGrammarDiagnostic(tuple);
                throw new Error("Expected rejection");
            } catch (error) {
                expect(String(error)).toContain(`"matchCount":${count}`);
                expect(String(error)).toContain(
                    `"expectedMatchCount":${expected}`,
                );
                expect(String(error)).toContain("keySha256");
                expect(String(error)).not.toContain("PRIVATE-REQUEST");
                expect(String(error)).not.toContain("PRIVATE-WRONG");
                expect(String(error)).not.toContain('"path"');
            }
        },
    );
    it("rejects the selected wrong-input match even when a less specific correct alternative exists", () => {
        const tuple = {
            rules: [
                `<Start> = <bad> | <good>;
<good> = read $(path:string) now -> { actionName: "lookup", parameters: { path } };
<bad> = read package.json now -> { actionName: "lookup", parameters: { path: "wrong" } };`,
            ],
            requests: [trace.prompt],
            actionName: "lookup",
            exampleInputs: { path: "package.json" },
        };
        expect(() => replayMacroGrammarDiagnostic(tuple)).toThrow(
            '"matchCount":1',
        );
        expect(() => replayMacroGrammarDiagnostic(tuple)).toThrow(
            '"expectedMatchCount":0',
        );
    });
    it.each([
        null,
        {},
        { rules: [], requests: [], actionName: "x", exampleInputs: {} },
        {
            rules: ["x"],
            requests: ["x"],
            actionName: "x",
            exampleInputs: {},
            extra: true,
        },
        {
            rules: ["x".repeat(262145)],
            requests: ["x"],
            actionName: "x",
            exampleInputs: {},
        },
    ])("rejects unsupported/unbounded replay tuple %p", (tuple) => {
        expect(() => replayMacroGrammarDiagnostic(tuple)).toThrow(
            "bounded grammar replay tuple",
        );
    });
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

    it.each([false, true])(
        "retains deferred obligations even when the builder omits them (correction: %s)",
        async (correction) => {
            const { recording, baseline, recipe, build } = await buildFixture();
            const requirement =
                "Classify the captured message by meaning and return its sentiment";
            const query = jest.fn<MacroLearningQuery>();
            if (correction) {
                const invalid = structuredClone(build);
                invalid.requests[2] = "Open the workspace configuration for me";
                query.mockResolvedValueOnce(JSON.stringify(invalid));
            }
            query.mockResolvedValueOnce(JSON.stringify(build));
            const result = await createMacroLearningRuntime(query).build(
                { ...recipe, programRequirements: [requirement] },
                recording,
                baseline,
                new AbortController().signal,
            );
            expect(result.unsupportedOutputs).toEqual([requirement]);
            expect(query).toHaveBeenCalledTimes(correction ? 2 : 1);
        },
    );

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
        ).rejects.toThrow("stage=generation; requestIndex=1/1");
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

    it("projects captured response presence for lookup/fetch/show without exposing any answer body", async () => {
        const recording = structuredClone(trace);
        recording.prompt =
            "Find the document titled 'Generated checklist' and show its contents.";
        recording.response = "private-answer-body";
        recording.toolCalls = [
            {
                ...recording.toolCalls[0],
                toolCallId: "lookup",
                name: "lookup_document",
                arguments: { title: "Generated checklist" },
                result: { id: "generated-doc" },
            },
            {
                ...recording.toolCalls[0],
                toolCallId: "fetch",
                name: "fetch_document",
                arguments: { id: "generated-doc" },
                result: { content: "private-body" },
                modelResult: { content: "private-model-body" },
            },
        ];
        const query = jest.fn<MacroLearningQuery>(async () => {
            throw new Error(
                "Extraction input captured; no model answer supplied.",
            );
        });
        await expect(
            createMacroLearningRuntime(query).extract(
                recording,
                "source-1",
                new AbortController().signal,
            ),
        ).rejects.toThrow("Extraction input captured");
        const prompt = query.mock.calls[0][0];
        const evidence = JSON.parse(prompt.split("\nEVIDENCE:\n")[1]);
        expect(evidence.responseEvidence).toEqual({
            available: true,
            valueType: "string",
        });
        expect(evidence.request).toBe(recording.prompt);
        expect(
            evidence.toolCalls.map(
                (call: { toolCallId: string }) => call.toolCallId,
            ),
        ).toEqual(["lookup", "fetch"]);
        expect(prompt).not.toContain(recording.response);
        expect(prompt).not.toContain("private-body");
        expect(prompt).not.toContain("private-model-body");
        expect(prompt).toContain("No separate display tool is");
        expect(prompt).toContain(
            "It does not prove physical display or content correctness.",
        );
        expect(prompt).toContain("unsupported");
        expect(evidence.argumentDependencies).toEqual([
            { toolCallId: "lookup", dependencies: [] },
            {
                toolCallId: "fetch",
                dependencies: [
                    {
                        argumentPath: ["id"],
                        sourceToolCallId: "lookup",
                        expressionKind: "stepResult",
                    },
                ],
            },
        ]);
        expect(prompt).toContain("Do not introduce unrequested uniqueness");
        expect(prompt).toContain("Actual ambiguity,");
    });
    it.each([
        "unique matching document",
        "latest version",
        "ranked by relevance",
    ])(
        "does not override content-dependent selection uncertainty (%s)",
        async (requirement) => {
            const recording = {
                ...structuredClone(trace),
                prompt: `Find the ${requirement} and read it.`,
            };
            const uncertainties = [
                `The ${requirement} selection is not established.`,
            ];
            const query = jest.fn<MacroLearningQuery>(async () =>
                JSON.stringify({
                    schemaVersion: 1,
                    traceId: "source-1",
                    request: recording.prompt,
                    toolCallIds: ["call-1"],
                    description: "Read the recorded file.",
                    uncertainties,
                }),
            );
            const recipe = await createMacroLearningRuntime(query).extract(
                recording,
                "source-1",
                new AbortController().signal,
            );
            expect(recipe.uncertainties).toEqual(uncertainties);
        },
    );
    it("reports multiple returned array entries without claiming a unique selection", async () => {
        const recording = structuredClone(trace);
        recording.toolCalls[0].result = [
            { id: "first", content: "private-first" },
            { id: "second", content: "private-second" },
        ];
        const query = jest.fn<MacroLearningQuery>(async () => {
            throw new Error("Projection only.");
        });
        await expect(
            createMacroLearningRuntime(query).extract(
                recording,
                "source-1",
                new AbortController().signal,
            ),
        ).rejects.toThrow("Projection only");
        const prompt = query.mock.calls[0][0],
            evidence = JSON.parse(prompt.split("\nEVIDENCE:\n")[1]);
        expect(evidence.toolCalls[0].resultEvidence).toEqual({
            available: true,
            valueType: "array",
            itemCount: 2,
        });
        expect(prompt).not.toContain("private-first");
        expect(prompt).not.toContain("private-second");
        expect(prompt).toContain("not its");
        expect(prompt).toContain("unique matches");
    });

    it.each(["", " \n\t "])(
        "projects an empty response as unavailable (%j)",
        async (response) => {
            const recording = { ...structuredClone(trace), response };
            const query = jest.fn<MacroLearningQuery>(async () => {
                throw new Error("Extraction input captured.");
            });
            await expect(
                createMacroLearningRuntime(query).extract(
                    recording,
                    "source-1",
                    new AbortController().signal,
                ),
            ).rejects.toThrow("Extraction input captured");
            const evidence = JSON.parse(
                query.mock.calls[0][0].split("\nEVIDENCE:\n")[1],
            );
            expect(evidence.responseEvidence).toEqual({
                available: false,
                valueType: "string",
            });
        },
    );

    it("does not clear output uncertainties even when a response and tool results were captured", async () => {
        const uncertainties = [
            "The requested ranking and report are not established.",
        ];
        const query = jest.fn<MacroLearningQuery>(async () =>
            JSON.stringify({
                schemaVersion: 1,
                traceId: "source-1",
                request: trace.prompt,
                toolCallIds: ["call-1"],
                description: "Read a file",
                uncertainties,
            }),
        );
        const recipe = await createMacroLearningRuntime(query).extract(
            trace,
            "source-1",
            new AbortController().signal,
        );
        expect(recipe.uncertainties).toEqual(uncertainties);
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
        ).toThrow("did not generalize input (stage=changed-input");
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
        ).toThrow("Macro grammar accepts an unsupported intent:");
        rules[0] = `<Start> = read file package.json -> { actionName: "lookup", parameters: { path: "package.json" } };`;
        expect(() =>
            validateMacroGrammar(rules, [original, ...variants], "lookup", {
                path: "package.json",
            }),
        ).toThrow("did not generalize input (stage=changed-input");
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
