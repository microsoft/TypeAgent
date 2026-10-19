// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { spawnSync } from "node:child_process";
import {
    createMacroLearningRuntime,
    matchMacroGrammarInputs,
    type MacroLearningQuery,
} from "@typeagent/copilot-macros/macroAuthoringRuntime";
import {
    createMacroProgramAuthor,
    type MacroProgramAuthorOptions,
    type MacroProgramFixturePlan,
} from "@typeagent/copilot-macros/macroProgramAuthoring";
import type {
    CopilotToolMacro,
    RecordedInteractionTrace,
} from "@typeagent/copilot-macros";
import { induceMacroFromTrace } from "@typeagent/copilot-macros";
import {
    recipeSchemaDigest,
    validateRecipeArtifact,
    type RecipeCapability,
    type RuntimeJsonSchema,
} from "@typeagent/copilot-macros/recipeCore";

const signal = () => new AbortController().signal;
const jest = (import.meta as ImportMeta & { jest: typeof globalThis.jest })
    .jest;

describe("portable authoring boundary", () => {
    it("imports without loading TypeAgent configuration or model backends", () => {
        const loader = `export async function resolve(specifier, context, next) {
            if (/^@typeagent\\/(config|aiclient)(\\/|$)/.test(specifier))
                throw new Error("Forbidden backend import: " + specifier);
            return next(specifier, context);
        }`;
        const child = spawnSync(
            process.execPath,
            [
                "--no-warnings",
                "--experimental-loader",
                `data:text/javascript,${encodeURIComponent(loader)}`,
                "--input-type=module",
                "-e",
                `await import(${JSON.stringify(new URL("../macroAuthoringRuntime.js", import.meta.url).href)});
                 await import(${JSON.stringify(new URL("../macroProgramAuthoring.js", import.meta.url).href)});`,
            ],
            { encoding: "utf8" },
        );
        expect(child.stderr).toBe("");
        expect(child.status).toBe(0);
    });

    it("requires explicit queries and inspector rather than a default backend", () => {
        expect(() =>
            createMacroLearningRuntime(
                undefined as unknown as MacroLearningQuery,
            ),
        ).toThrow("explicit query");
        expect(() =>
            createMacroProgramAuthor({} as MacroProgramAuthorOptions),
        ).toThrow("explicit source and verifier queries");
    });

    it.each(["native", "mcp"] as const)(
        "compiles and validates %s traces with source-blind independent fixtures",
        async (transport) => {
            const schema: RuntimeJsonSchema = {
                type: "object",
                properties: { path: { type: "string" } },
                required: ["path"],
                additionalProperties: false,
            };
            const outputSchema: RuntimeJsonSchema = { type: "string" };
            const capability: RecipeCapability = {
                id: "read",
                transport,
                providerId: transport === "mcp" ? "files" : "copilot",
                operation: "read",
                contractVersion: "1",
                inputSchema: schema,
                outputSchema,
                schemaDigest: recipeSchemaDigest(schema, outputSchema),
                compatibility: "exact",
                effect: "read",
            };
            const trace: RecordedInteractionTrace = {
                schemaVersion: 1,
                sessionId: "recording",
                cwd: "D:\\workspace",
                prompt: "read alpha now",
                response: "alpha body",
                startedAt: "2026-10-15T00:00:00.000Z",
                completedAt: "2026-10-15T00:00:01.000Z",
                toolCalls: [
                    {
                        toolCallId: "call",
                        name: "read",
                        ...(transport === "mcp"
                            ? { mcpServerName: "files" }
                            : {}),
                        arguments: { path: "alpha" },
                        result: "alpha body",
                        status: "completed",
                    },
                ],
            };
            if (transport === "native") {
                const inspectTool = jest.fn(async () => ({
                    toolName: "read",
                    schemaFingerprint: "native-descriptor",
                    readOnly: true,
                }));
                const host = {
                    inspectTool,
                    callTool: async () => {
                        throw new Error("Induction must not execute tools");
                    },
                };
                const denied = await induceMacroFromTrace(
                    "trace",
                    trace,
                    "portable",
                    "Read",
                    "Read current contents",
                    trace.completedAt,
                    host,
                );
                expect(denied.steps[0].executionClass).toBe("agentRequired");
                expect(inspectTool).not.toHaveBeenCalled();
                const admitted = await induceMacroFromTrace(
                    "trace",
                    trace,
                    "portable",
                    "Read",
                    "Read current contents",
                    trace.completedAt,
                    { ...host, supportsNativeTools: true },
                );
                expect(admitted.steps[0].executionClass).toBe("replayable");
                expect(inspectTool).toHaveBeenCalledWith(undefined, "read", {
                    cwd: trace.cwd,
                });
            }
            const macro: CopilotToolMacro = {
                schemaVersion: 1,
                macroId: "portable",
                version: 1,
                sourceTraceId: "trace",
                name: "Read",
                description: "Read current contents",
                state: "draft",
                executionClass: "replayable",
                createdAt: trace.completedAt,
                inputs: [
                    {
                        name: "path",
                        description: "Path",
                        required: true,
                        secret: false,
                        valueType: "string",
                    },
                ],
                steps: [
                    {
                        id: "step",
                        sourceToolCallId: "call",
                        toolName: "read",
                        ...(transport === "mcp"
                            ? { mcpServerName: "files" }
                            : {}),
                        arguments: {
                            kind: "literal",
                            value: { path: "alpha" },
                        },
                        executionClass: "replayable",
                    },
                ],
                warnings: [],
                learning: {
                    jobId: "job",
                    cwd: trace.cwd,
                    mode: "prepare",
                    requiresLivePermissions: true,
                    grammarRules: [
                        '<Start> = read $(path:string) now -> { actionName: "run_portable_v2", parameters: { path } };',
                    ],
                    requests: [trace.prompt],
                    exampleInputs: { path: "alpha" },
                },
            };
            const plan: MacroProgramFixturePlan = {
                inputSchema: schema,
                outputSchema,
                specification: {
                    id: "read",
                    revision: "1",
                    intent: "Return current file contents",
                    outputRequirements: ["Return the current tool result"],
                    rubric: "Read the requested path",
                    counterexamples: [
                        "Do not freeze the captured path or result",
                    ],
                },
                semanticFunctions: [],
                applicability: { assumptions: [], unsupported: [] },
                fixtures: [
                    {
                        id: "observed",
                        origin: "observed",
                        input: { path: "alpha" },
                        calls: [
                            {
                                kind: "capability",
                                id: "read",
                                input: { path: "alpha" },
                                output: "alpha body",
                            },
                        ],
                        expectedOutput: "alpha body",
                    },
                    {
                        id: "independent",
                        origin: "independent",
                        input: { path: "beta" },
                        calls: [
                            {
                                kind: "capability",
                                id: "read",
                                input: { path: "beta" },
                                output: "fresh beta body",
                            },
                        ],
                        expectedOutput: "fresh beta body",
                    },
                ],
            };
            const source =
                'async function execute(api: RecipeApi, params: JsonValue): Promise<JsonValue> { if (Reflect.has(globalThis, "privateFixture")) throw Error("Leaked private fixture"); Reflect.set(globalThis, "privateFixture", params); return await api.tools.call("read", params); }';
            const sourceQuery = jest.fn(
                async (_prompt: string, _signal: AbortSignal) =>
                    JSON.stringify({ source }),
            );
            const verifierQuery = jest.fn(
                async (_prompt: string, _signal: AbortSignal) =>
                    JSON.stringify(plan),
            );
            const unusedQuery = jest.fn(
                async (
                    _prompt: string,
                    _signal: AbortSignal,
                ): Promise<string> => {
                    throw new Error("Unexpected default source query");
                },
            );
            const cache = jest.fn(
                async (_prompt: string, execute: () => Promise<string>) =>
                    execute(),
            );
            const author = createMacroProgramAuthor({
                query: unusedQuery,
                verifierQuery,
                inspectCapability: async () => capability,
                semanticModelPolicy: { id: "host-approved", revision: "1" },
            });
            const runtime = createMacroLearningRuntime(
                unusedQuery,
                undefined,
                undefined,
                author,
            ).withAuthorQuery!(sourceQuery, cache);
            const artifact = await runtime.buildProgram(macro, trace, signal());
            expect(validateRecipeArtifact(artifact)).toEqual([]);
            expect(artifact.fixtures).toHaveLength(2);
            expect(artifact.fixtures.every((item) => item.noLiveEffects)).toBe(
                true,
            );
            expect(unusedQuery).not.toHaveBeenCalled();
            expect(cache).toHaveBeenCalledTimes(1);
            expect(verifierQuery).toHaveBeenCalledTimes(1);
            expect(sourceQuery).toHaveBeenCalledTimes(1);
            expect(verifierQuery.mock.calls[0][0]).not.toContain(source);
            expect(sourceQuery.mock.calls[0][0]).not.toContain(
                "fresh beta body",
            );
            const approved = { ...macro, version: 2, program: artifact };
            expect(matchMacroGrammarInputs(approved, "read beta now")).toEqual([
                { path: "beta" },
            ]);
            expect(matchMacroGrammarInputs(approved, "read gamma now")).toEqual(
                [{ path: "gamma" }],
            );
            expect(matchMacroGrammarInputs(approved, "read beta now")).toEqual([
                { path: "beta" },
            ]);
            expect(matchMacroGrammarInputs(macro, "read beta now")).toEqual([]);
            expect(
                matchMacroGrammarInputs(approved, "delete beta now"),
            ).toEqual([]);
            expect(
                matchMacroGrammarInputs(
                    {
                        ...approved,
                        inputs: approved.inputs.map((input) => ({
                            ...input,
                            secret: true,
                        })),
                    },
                    "read beta now",
                ),
            ).toEqual([]);
            const numeric = structuredClone(macro);
            numeric.version = 2;
            numeric.inputs = [
                { ...numeric.inputs[0], name: "count", valueType: "number" },
            ];
            numeric.learning!.grammarRules = [
                'import { Cardinal }; <Start> = read $(count:Cardinal) files now -> { actionName: "run_portable_v2", parameters: { count } };',
            ];
            expect(
                matchMacroGrammarInputs(numeric, "read three files now"),
            ).toEqual([{ count: 3 }]);
            numeric.learning!.grammarRules = [
                '<Start> = read $(count:string) files now -> { actionName: "run_portable_v2", parameters: { count } };',
            ];
            expect(
                matchMacroGrammarInputs(numeric, "read three files now"),
            ).toEqual([]);
            numeric.learning!.grammarRules = ["invalid grammar"];
            expect(
                matchMacroGrammarInputs(numeric, "read three files now"),
            ).toEqual([]);
        },
    );
});
