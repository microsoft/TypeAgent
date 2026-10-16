// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import type {
    CopilotToolMacro,
    RecordedInteractionTrace,
} from "@typeagent/copilot-macros";
import {
    recipeSchemaDigest,
    validateRecipeArtifact,
    type RecipeCapability,
    type RecipeSemanticFunction,
    type RuntimeJsonSchema,
} from "@typeagent/copilot-macros/recipeCore";
import {
    createMacroProgramAuthor,
    type MacroProgramAuthorOptions,
    type MacroProgramFixturePlan,
} from "../src/macroProgramAuthoring.js";

const stringSchema: RuntimeJsonSchema = { type: "string" };
const querySchema: RuntimeJsonSchema = {
    type: "object",
    properties: { query: stringSchema },
    required: ["query"],
    additionalProperties: false,
};
const idSchema: RuntimeJsonSchema = {
    type: "object",
    properties: { id: stringSchema },
    required: ["id"],
    additionalProperties: false,
};
const outputSchema: RuntimeJsonSchema = {
    type: "object",
    properties: { body: stringSchema, revision: { type: "integer" } },
    required: ["body", "revision"],
    additionalProperties: false,
};

function capability(
    id: string,
    inputSchema: RuntimeJsonSchema,
    outputSchema: RuntimeJsonSchema,
): RecipeCapability {
    return {
        id,
        transport: "mcp",
        providerId: "files",
        operation: id,
        contractVersion: "1",
        inputSchema,
        outputSchema,
        schemaDigest: recipeSchemaDigest(inputSchema, outputSchema),
        compatibility: "exact",
        effect: "read",
    };
}

const source = `async function execute(api: RecipeApi, params: JsonValue): Promise<JsonValue> {
    const { query } = params as { query: string };
    const found = await api.tools.call("lookup", { query }) as { id: string };
    return await api.tools.call("read", { id: found.id });
}`;

function setup() {
    const trace: RecordedInteractionTrace = {
        schemaVersion: 1,
        sessionId: "session",
        cwd: "D:\\workspace",
        prompt: "read file alpha now",
        response: '{"body":"alpha contents","revision":1}',
        startedAt: "2026-10-15T00:00:00.000Z",
        completedAt: "2026-10-15T00:00:01.000Z",
        toolCalls: [
            {
                toolCallId: "lookup-call",
                name: "lookup",
                mcpServerName: "files",
                arguments: { query: "alpha" },
                result: { id: "recorded-id" },
                status: "completed",
            },
            {
                toolCallId: "read-call",
                name: "read",
                mcpServerName: "files",
                arguments: { id: "recorded-id" },
                result: { body: "alpha contents", revision: 1 },
                status: "completed",
            },
        ],
    };
    const macro: CopilotToolMacro = {
        schemaVersion: 1,
        macroId: "file-macro",
        version: 3,
        sourceTraceId: "trace-1",
        name: "Read file",
        description: "Look up and return current file contents",
        state: "draft",
        executionClass: "replayable",
        createdAt: trace.completedAt,
        inputs: [
            {
                name: "query",
                description: "File query",
                required: true,
                secret: false,
                valueType: "string",
            },
        ],
        steps: trace.toolCalls.map((call) => ({
            id: call.toolCallId,
            toolName: call.name,
            mcpServerName: "files",
            arguments: { kind: "literal", value: call.arguments },
            executionClass: "replayable",
            sourceToolCallId: call.toolCallId,
        })),
        warnings: [],
        learning: {
            jobId: "job-1",
            cwd: trace.cwd,
            mode: "prepare",
            requiresLivePermissions: true,
            grammarRules: [
                '<Start> = read file $(query:string) now -> { actionName: "run_file_macro_v4", parameters: { query } };',
            ],
            requests: [trace.prompt],
            exampleInputs: { query: "alpha" },
        },
    };
    const capabilities = [
        capability("lookup", querySchema, idSchema),
        capability("read", idSchema, outputSchema),
    ];
    const plan: MacroProgramFixturePlan = {
        inputSchema: querySchema,
        outputSchema,
        specification: {
            id: "read-file",
            revision: "1",
            intent: "Read current contents of the requested file",
            outputRequirements: [
                "Return the structured current file body and revision",
            ],
            rubric: "Resolve the requested query then read the returned identity",
            counterexamples: [
                "Do not use the old recorded file identity or contents",
            ],
        },
        semanticFunctions: [],
        applicability: {
            assumptions: ["Lookup returns exactly one file identity"],
            unsupported: ["Ambiguous file lookup"],
        },
        fixtures: [
            {
                id: "observed",
                origin: "observed",
                input: { query: "alpha" },
                calls: [
                    {
                        kind: "capability",
                        id: "lookup",
                        input: { query: "alpha" },
                        output: { id: "recorded-id" },
                    },
                    {
                        kind: "capability",
                        id: "read",
                        input: { id: "recorded-id" },
                        output: { body: "alpha contents", revision: 1 },
                    },
                ],
                expectedOutput: { body: "alpha contents", revision: 1 },
            },
            {
                id: "fresh-results",
                origin: "independent",
                input: { query: "beta" },
                calls: [
                    {
                        kind: "capability",
                        id: "lookup",
                        input: { query: "beta" },
                        output: { id: "fresh-unseen-id" },
                    },
                    {
                        kind: "capability",
                        id: "read",
                        input: { id: "fresh-unseen-id" },
                        output: {
                            body: "brand new beta contents",
                            revision: 42,
                        },
                    },
                ],
                expectedOutput: {
                    body: "brand new beta contents",
                    revision: 42,
                },
            },
        ],
    };
    const inspect = jest.fn<
        NonNullable<MacroProgramAuthorOptions["inspectCapability"]>
    >(async (step) =>
        capabilities.find((item) => item.operation === step.toolName),
    );
    const query = jest.fn<NonNullable<MacroProgramAuthorOptions["query"]>>(
        async () => JSON.stringify({ source }),
    );
    const createPlan = jest.fn<
        NonNullable<MacroProgramAuthorOptions["createFixturePlan"]>
    >(async () => structuredClone(plan));
    function author() {
        return createMacroProgramAuthor({
            inspectCapability: inspect,
            query,
            createFixturePlan: createPlan,
        })(macro, trace, new AbortController().signal);
    }
    return {
        macro,
        trace,
        plan,
        capabilities,
        inspect,
        query,
        createPlan,
        author,
    };
}

describe("recording-to-program authoring", () => {
    it("keeps source-blind verification hosted while routing only source generation to the child override", async () => {
        const test = setup();
        const previous = await test.author();
        test.macro.program = previous;
        test.query.mockClear().mockResolvedValue(JSON.stringify(test.plan));
        const override = jest
            .fn<NonNullable<MacroProgramAuthorOptions["query"]>>()
            .mockResolvedValueOnce(JSON.stringify({ source }));
        const artifact = await createMacroProgramAuthor({
            inspectCapability: test.inspect,
            query: test.query,
        })(test.macro, test.trace, new AbortController().signal, override);
        expect(validateRecipeArtifact(artifact)).toEqual([]);
        expect(artifact.fixtures).toHaveLength(2);
        expect(
            artifact.fixtures.every(
                (fixture) =>
                    fixture.result === "passed" && fixture.noLiveEffects,
            ),
        ).toBe(true);
        expect(override).toHaveBeenCalledTimes(1);
        expect(test.query).toHaveBeenCalledTimes(1);
        const verifier = JSON.parse(
            test.query.mock.calls[0][0].split("\nEVIDENCE:\n")[1],
        );
        const candidate = JSON.parse(
            override.mock.calls[0][0].split("\nEVIDENCE:\n")[1],
        );
        expect(verifier.macro).not.toHaveProperty("program");
        expect(test.query.mock.calls[0][0]).not.toContain(source);
        expect(candidate).not.toHaveProperty("fixtures");
        expect(override.mock.calls[0][0]).not.toContain("fresh-unseen-id");
        expect(test.query.mock.calls[0][1]).not.toBe(override.mock.calls[0][1]);
    });

    it.each([
        [
            "unsupported verifier",
            { unsupported: "Missing evidence" },
            undefined,
        ],
        ["invalid verifier schema", {}, undefined],
        ["invented observed evidence", "invented-evidence", undefined],
        ["candidate-supplied verdicts", "valid-plan", { source, fixtures: [] }],
        [
            "frozen recorded identity",
            "valid-plan",
            { source: source.replace("id: found.id", 'id: "recorded-id"') },
        ],
        [
            "ambient authority",
            "valid-plan",
            {
                source: "async function execute(api, params) { return process.env; }",
            },
        ],
    ])(
        "rejects %s without delegating independent verification to the child",
        async (_name, verifierResponse, candidateResponse) => {
            const test = setup();
            const plan = structuredClone(test.plan);
            if (verifierResponse === "invented-evidence")
                plan.fixtures[0].calls[0].output = { id: "invented" };
            test.query.mockResolvedValue(
                JSON.stringify(
                    typeof verifierResponse === "string"
                        ? plan
                        : verifierResponse,
                ),
            );
            const override =
                jest.fn<NonNullable<MacroProgramAuthorOptions["query"]>>();
            if (candidateResponse)
                override.mockResolvedValueOnce(
                    JSON.stringify(candidateResponse),
                );
            await expect(
                createMacroProgramAuthor({
                    inspectCapability: test.inspect,
                    query: test.query,
                })(
                    test.macro,
                    test.trace,
                    new AbortController().signal,
                    override,
                ),
            ).rejects.toThrow();
            expect(test.query).toHaveBeenCalledTimes(1);
            expect(override).toHaveBeenCalledTimes(candidateResponse ? 1 : 0);
        },
    );

    it("preserves cancellation during an external source query that ignores its signal", async () => {
        const test = setup();
        test.query.mockResolvedValue(JSON.stringify(test.plan));
        const controller = new AbortController();
        const override = jest.fn<
            NonNullable<MacroProgramAuthorOptions["query"]>
        >(async () => {
            controller.abort(new Error("stop external author"));
            return new Promise<string>(() => {});
        });
        await expect(
            createMacroProgramAuthor({
                inspectCapability: test.inspect,
                query: test.query,
            })(test.macro, test.trace, controller.signal, override),
        ).rejects.toThrow("stop external author");
        expect(test.query).toHaveBeenCalledTimes(1);
        expect(override).toHaveBeenCalledTimes(1);
        expect(override.mock.calls.at(-1)![1].aborted).toBe(true);
    });

    it("retains the response byte limit for an external source query", async () => {
        const test = setup();
        test.query.mockResolvedValue(JSON.stringify(test.plan));
        const override = jest.fn<
            NonNullable<MacroProgramAuthorOptions["query"]>
        >(async () => {
            return " ".repeat(1_048_577);
        });
        await expect(
            createMacroProgramAuthor({
                inspectCapability: test.inspect,
                query: test.query,
            })(test.macro, test.trace, new AbortController().signal, override),
        ).rejects.toThrow("exceeds the authoring limit");
        expect(test.query).toHaveBeenCalledTimes(1);
        expect(override).toHaveBeenCalledTimes(1);
    });

    it("runs submitted symbolic source with changed inputs and fresh results without live tools", async () => {
        const test = setup();
        const before = structuredClone(test.macro);
        const artifact = await test.author();
        expect(validateRecipeArtifact(artifact)).toEqual([]);
        expect(artifact.source.text).toBe(source);
        expect(artifact.executable.text).not.toContain("fresh-unseen-id");
        expect(artifact.recipeId).toBe(test.macro.macroId);
        expect(artifact.provenance.legacySource).toEqual({
            macroId: "file-macro",
            version: 3,
        });
        expect(artifact.provenance.captureId).toBe("trace-1");
        expect(artifact.provenance.taskId).toBe("job-1");
        expect(artifact.provenance.tokenId).toBe("legacy:trace-1");
        expect(artifact.matching.grammar).toEqual(
            test.macro.learning!.grammarRules,
        );
        expect(artifact.outputSchema).toEqual(outputSchema);
        expect(artifact.execution).toBe("symbolic");
        expect(artifact.fixtures.map((fixture) => fixture.origin)).toEqual([
            "observed",
            "independent",
        ]);
        expect(
            artifact.fixtures.every(
                (fixture) =>
                    fixture.result === "passed" && fixture.noLiveEffects,
            ),
        ).toBe(true);
        expect(test.inspect).toHaveBeenCalledTimes(2);
        expect(test.query).toHaveBeenCalledTimes(1);
        expect(test.macro).toEqual(before);
        expect(Object.isFrozen(artifact.executable)).toBe(true);
    });

    it("preserves contextual capture, selected task and token provenance with the source-IR mapping", async () => {
        const test = setup();
        test.macro.learning!.authoring = {
            captureId: "contextual-capture",
            taskId: "selected-task",
            tokenId: "selected-token",
            contextDigest: "context-digest",
        };
        const artifact = await test.author();
        expect(validateRecipeArtifact(artifact)).toEqual([]);
        expect(artifact.provenance).toMatchObject({
            captureId: "contextual-capture",
            taskId: "selected-task",
            tokenId: "selected-token",
            legacySource: { macroId: "file-macro", version: 3 },
        });
        expect(artifact.provenance.evidenceIds).toEqual(
            expect.arrayContaining([
                "trace-1",
                "context-digest",
                "lookup-call",
            ]),
        );
        expect(artifact.provenance.tokenId).not.toBe("legacy:trace-1");
    });

    it.each([
        ["captured input", source.replace("{ query })", '{ query: "alpha" })')],
        [
            "captured result identity",
            source.replace("id: found.id", 'id: "recorded-id"'),
        ],
        [
            "captured final output",
            source.replace(
                'return await api.tools.call("read", { id: found.id });',
                'await api.tools.call("read", { id: found.id }); return { body: "alpha contents", revision: 1 };',
            ),
        ],
        [
            "omitted effects",
            'async function execute(api: RecipeApi, params: JsonValue): Promise<JsonValue> { return { body: "alpha contents", revision: 1 }; }',
        ],
        [
            "structured output discarded",
            source.replace(
                'return await api.tools.call("read", { id: found.id });',
                'return JSON.stringify(await api.tools.call("read", { id: found.id }));',
            ),
        ],
        [
            "invalid TypeScript",
            "async function execute(api, params) { return notDeclared; }",
        ],
        [
            "ambient authority",
            "async function execute(api, params) { return process.env; }",
        ],
    ])(
        "rejects %s by compiling or executing the actual source",
        async (_name, badSource) => {
            const test = setup();
            test.query.mockResolvedValue(JSON.stringify({ source: badSource }));
            await expect(test.author()).rejects.toThrow();
        },
    );

    it("retains a fixture violation even when submitted code catches it", async () => {
        const test = setup();
        test.query.mockResolvedValue(
            JSON.stringify({
                source: `async function execute(api: RecipeApi, params: JsonValue): Promise<JsonValue> {
                const {query} = params as {query:string};
                try { await api.tools.call("lookup", {query:"incorrect"}); } catch {}
                await api.tools.call("read", {id:query === "alpha" ? "recorded-id" : "fresh-unseen-id"});
                return query === "alpha" ? {body:"alpha contents",revision:1} : {body:"brand new beta contents",revision:42};
            }`,
            }),
        );
        await expect(test.author()).rejects.toThrow();
    });

    it("rejects unsupported, missing or invented inspected contracts before asking a model", async () => {
        const test = setup();
        test.capabilities[0].schemaDigest = "invented-digest";
        await expect(test.author()).rejects.toThrow("inspected");
        expect(test.query).not.toHaveBeenCalled();
    });

    it("preserves optional tool output schema absence without inventing one", async () => {
        const test = setup();
        delete test.capabilities[0].outputSchema;
        test.capabilities[0].schemaDigest = recipeSchemaDigest(
            test.capabilities[0].inputSchema,
        );
        const artifact = await test.author();
        expect(artifact.capabilities[0]).not.toHaveProperty("outputSchema");
        expect(artifact.outputSchema).toEqual(outputSchema);
    });

    it("fails closed without a typed inspector", async () => {
        const test = setup();
        await expect(
            createMacroProgramAuthor({ query: test.query })(
                test.macro,
                test.trace,
                new AbortController().signal,
            ),
        ).rejects.toThrow("typed capability inspector");
        expect(test.query).not.toHaveBeenCalled();
    });

    it.each(["write", "unknown"] as const)(
        "rejects %s capabilities before requesting a model",
        async (effect) => {
            const test = setup();
            test.capabilities[0].effect = effect;
            await expect(test.author()).rejects.toThrow("read-only");
            expect(test.query).not.toHaveBeenCalled();
        },
    );

    it("rejects inspected metadata for a different MCP provider", async () => {
        const test = setup();
        test.capabilities[0].providerId = "different-provider";
        await expect(test.author()).rejects.toThrow("MCP provider identity");
        expect(test.query).not.toHaveBeenCalled();
    });

    it.each(["result", "arguments"] as const)(
        "rejects omitted recorded %s evidence",
        async (field) => {
            const test = setup();
            delete test.trace.toolCalls[0][field];
            await expect(test.author()).rejects.toThrow(
                "complete successful recording",
            );
            expect(test.query).not.toHaveBeenCalled();
        },
    );

    it("rejects observed fixtures that invent captured results", async () => {
        const test = setup();
        test.plan.fixtures[0].calls[0].output = { id: "not-observed" };
        await expect(test.author()).rejects.toThrow("actual recorded");
        expect(test.query).not.toHaveBeenCalled();
    });

    it("rejects a counterexample without changed fresh results", async () => {
        const test = setup();
        test.plan.fixtures[1].calls = structuredClone(
            test.plan.fixtures[0].calls,
        );
        await expect(test.author()).rejects.toThrow("Independent evidence");
    });

    it("rejects a fixture plan that silently changes the output contract", async () => {
        const test = setup();
        test.plan.outputSchema = stringSchema;
        await expect(test.author()).rejects.toThrow("schema");
    });

    it("rejects candidates attempting to supply their own fixture verdicts", async () => {
        const test = setup();
        test.query.mockResolvedValue(
            JSON.stringify({ source, fixtures: [{ result: "passed" }] }),
        );
        await expect(test.author()).rejects.toThrow();
    });

    it("rejects unresolved legacy output requirements missing from the retained specification", async () => {
        const test = setup();
        test.macro.warnings.push(
            "Program author must resolve: Produce a ranked structured summary",
        );
        await expect(test.author()).rejects.toThrow(
            "unresolved output requirement",
        );
        expect(test.query).not.toHaveBeenCalled();
    });

    it.each(["run_other_macro_v4", "run_file_macro_v3"])(
        "rejects grammar targeting %s rather than the anticipated approved revision",
        async (actionName) => {
            const test = setup();
            test.macro.learning!.grammarRules[0] =
                test.macro.learning!.grammarRules[0].replace(
                    "run_file_macro_v4",
                    actionName,
                );
            await expect(test.author()).rejects.toThrow();
            expect(test.query).not.toHaveBeenCalled();
        },
    );

    it("uses a source-blind verifier query by default, never showing it candidate source", async () => {
        const test = setup();
        const prompts: string[] = [];
        const author = createMacroProgramAuthor({
            inspectCapability: test.inspect,
            query: async (prompt) => {
                prompts.push(prompt);
                return JSON.stringify(
                    prompts.length === 1 ? test.plan : { source },
                );
            },
        });
        const artifact = await author(
            test.macro,
            test.trace,
            new AbortController().signal,
        );
        expect(prompts).toHaveLength(2);
        const verifierEvidence = JSON.parse(
            prompts[0].split("\nEVIDENCE:\n")[1],
        );
        const authorEvidence = JSON.parse(prompts[1].split("\nEVIDENCE:\n")[1]);
        expect(verifierEvidence).not.toHaveProperty("source");
        expect(verifierEvidence).not.toHaveProperty("program");
        expect(authorEvidence).not.toHaveProperty("fixtures");
        expect(artifact.fixtures).toHaveLength(2);
    });

    it("withholds previously authored source from source-blind review", async () => {
        const test = setup();
        test.macro.program = await test.author();
        const createPlan = jest.fn<
            NonNullable<MacroProgramAuthorOptions["createFixturePlan"]>
        >(async (context) => {
            expect(context.macro).not.toHaveProperty("program");
            expect(context.semanticModelPolicy).toEqual({
                id: "typeagent-default",
                revision: "1",
            });
            return test.plan;
        });
        await createMacroProgramAuthor({
            inspectCapability: test.inspect,
            query: test.query,
            createFixturePlan: createPlan,
        })(test.macro, test.trace, new AbortController().signal);
        expect(createPlan).toHaveBeenCalledTimes(1);
    });

    it("propagates unsupported verifier output instead of claiming authoring success", async () => {
        const test = setup();
        test.query.mockResolvedValue(
            JSON.stringify({ unsupported: "Final ranking evidence omitted" }),
        );
        await expect(
            createMacroProgramAuthor({
                inspectCapability: test.inspect,
                query: test.query,
            })(test.macro, test.trace, new AbortController().signal),
        ).rejects.toThrow();
        expect(test.query).toHaveBeenCalledTimes(1);
    });

    it("cancels even when an injected query ignores its signal", async () => {
        const test = setup();
        const controller = new AbortController();
        const author = createMacroProgramAuthor({
            inspectCapability: test.inspect,
            createFixturePlan: test.createPlan,
            query: async () => {
                controller.abort(new Error("stop authoring"));
                return new Promise<string>(() => {});
            },
        });
        await expect(
            author(test.macro, test.trace, controller.signal),
        ).rejects.toThrow("stop authoring");
    });
});

describe("bounded semantic program authoring", () => {
    function hybrid() {
        const test = setup();
        const candidatesSchema: RuntimeJsonSchema = {
            type: "array",
            items: {
                type: "object",
                properties: { id: stringSchema, title: stringSchema },
                required: ["id", "title"],
                additionalProperties: false,
            },
        };
        const semanticInput: RuntimeJsonSchema = {
            type: "object",
            properties: { query: stringSchema, candidates: candidatesSchema },
            required: ["query", "candidates"],
            additionalProperties: false,
        };
        const definition: RecipeSemanticFunction = {
            id: "select",
            revision: "1",
            inputSchema: semanticInput,
            outputSchema: idSchema,
            specification: {
                id: "select-file",
                revision: "1",
                task: "Select the file whose title best matches the query",
                rubric: "Choose only an actual candidate identity with matching intent",
            },
            modelPolicy: { id: "typeagent-default", revision: "1" },
            bounds: {
                timeoutMs: 1_000,
                maxInputBytes: 4_096,
                maxOutputBytes: 256,
                maxCalls: 1,
                maxRepairAttempts: 0,
                maxConcurrency: 1,
            },
            evidence: { sourceIds: "none", quotations: false },
        };
        const observed = [
            { id: "recorded-id", title: "alpha" },
            { id: "wrong-old-id", title: "irrelevant" },
        ];
        const fresh = [
            { id: "wrong-new-id", title: "irrelevant" },
            { id: "fresh-unseen-id", title: "beta" },
        ];
        test.capabilities[0] = capability(
            "lookup",
            querySchema,
            candidatesSchema,
        );
        test.trace.toolCalls[0].result = observed;
        test.plan.semanticFunctions = [definition];
        for (const [index, fixture] of test.plan.fixtures.entries()) {
            const candidates = index === 0 ? observed : fresh;
            fixture.calls[0].output = candidates;
            fixture.calls.splice(1, 0, {
                kind: "semantic",
                id: "select",
                input: { query: index === 0 ? "alpha" : "beta", candidates },
                output: { id: index === 0 ? "recorded-id" : "fresh-unseen-id" },
            });
        }
        test.query.mockResolvedValue(
            JSON.stringify({
                source: `async function execute(api: RecipeApi, params: JsonValue): Promise<JsonValue> {
                const {query} = params as {query:string};
                const candidates = await api.tools.call("lookup", {query});
                const selected = await api.semantic.call("select", {query,candidates}) as {id:string};
                return await api.tools.call("read", {id:selected.id});
            }`,
            }),
        );
        return test;
    }

    it("runs declared semantic calls over changed candidates and preserves structured output", async () => {
        const test = hybrid();
        const artifact = await test.author();
        expect(artifact.execution).toBe("hybrid");
        expect(artifact.semanticFunctions[0].id).toBe("select");
        expect(
            artifact.generalization.some((item) => item.kind === "semantic"),
        ).toBe(true);
        expect(
            artifact.fixtures.every((fixture) => fixture.result === "passed"),
        ).toBe(true);
    });

    it("rejects a program that substitutes fixed-position selection for a declared semantic call", async () => {
        const test = hybrid();
        test.query.mockResolvedValue(
            JSON.stringify({
                source: `async function execute(api: RecipeApi, params: JsonValue): Promise<JsonValue> {
                const {query} = params as {query:string};
                const candidates = await api.tools.call("lookup", {query}) as {id:string}[];
                return await api.tools.call("read", {id:candidates[0].id});
            }`,
            }),
        );
        await expect(test.author()).rejects.toThrow();
    });

    it("rejects declared semantics lacking independently retained output evidence", async () => {
        const test = hybrid();
        test.plan.fixtures[1].calls.splice(1, 1);
        await expect(test.author()).rejects.toThrow("semantic function");
        expect(test.query).not.toHaveBeenCalled();
    });

    it("rejects unbounded semantic declarations", async () => {
        const test = hybrid();
        test.plan.semanticFunctions[0].bounds.maxCalls = 1_000_000;
        await expect(test.author()).rejects.toThrow();
        expect(test.query).not.toHaveBeenCalled();
    });

    it("rejects a semantic declaration that substitutes an unapproved model policy", async () => {
        const test = hybrid();
        test.plan.semanticFunctions[0].modelPolicy.id =
            "candidate-chosen-model";
        await expect(test.author()).rejects.toThrow(
            "host-approved model policy",
        );
        expect(test.query).not.toHaveBeenCalled();
    });

    it.each([
        { sourceIds: "known" as const, quotations: false },
        { sourceIds: "complete" as const, quotations: false },
        { sourceIds: "none" as const, quotations: true },
    ])(
        "rejects unavailable provenance validators before publication: %j",
        async (evidence) => {
            const test = hybrid();
            test.plan.semanticFunctions[0].evidence = evidence;
            await expect(test.author()).rejects.toThrow("provenance validator");
            expect(test.query).not.toHaveBeenCalled();
        },
    );
});
