// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    GrammarStore,
    compileGrammarToNFA,
    globalPhraseSetRegistry,
    loadGrammarRules,
    matchGrammarWithNFA,
} from "@typeagent/action-grammar";
import { parseToolsJsonSchema, validateAction } from "@typeagent/action-schema";
import type {
    ActionContext,
    AppAction,
    AppAgent,
    SessionContext,
} from "@typeagent/agent-sdk";
import {
    MacroManager,
    induceMacroFromTrace,
    type CopilotToolMacro,
} from "@typeagent/copilot-macros";
import { awaitCommand } from "@typeagent/dispatcher-types";
import { createDispatcher } from "agent-dispatcher";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
    createMacroAppAgentProvider,
    getMacroActionName,
    getMacroInputSchema,
} from "../src/macroAgentProvider.js";
import { createMacroLearningRuntime } from "../src/macroLearningRuntime.js";
import { macroProgramFixture } from "./macroProgramFixture.js";

function grammarModelResponse(overrides: Record<string, unknown> = {}): string {
    return JSON.stringify({
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
        fixedPhrases: ["file", "now"],
        grammarPattern: {
            matchPattern:
                "(read | open | inspect) file $(step_1_path:string) now",
            actionParameters: [
                { parameterName: "step_1_path", parameterValue: "step_1_path" },
            ],
        },
        reasoning:
            "Generalize the evidenced filename with fixed request boundaries.",
        ...overrides,
    });
}

describe("approved macro action provider", () => {
    let instanceDir: string;
    let manager: MacroManager;
    let calls: unknown[];
    let fingerprint: string;
    const context = { sessionContext: {} } as ActionContext;

    async function execute(
        agent: AppAgent,
        action: AppAction,
        actionContext: ActionContext,
    ) {
        const result = await agent.executeAction!(
            { ...action, schemaName: "macros" },
            actionContext,
        );
        if (!result) throw new Error("Macro agent returned no result.");
        return result;
    }

    beforeEach(async () => {
        instanceDir = await mkdtemp(path.join(os.tmpdir(), "macro-routing-"));
        calls = [];
        fingerprint = "v1";
        manager = new MacroManager(instanceDir, {
            inspectTool: async (server, toolName) =>
                server === "test-mcp"
                    ? { toolName, schemaFingerprint: fingerprint }
                    : undefined,
            callTool: async (_server, _tool, args) => {
                calls.push(args);
                return { content: "test-content" };
            },
        });
        configureRuntime(manager);
    });

    afterEach(async () => {
        await rm(instanceDir, { recursive: true, force: true });
    });

    function configureRuntime(target: MacroManager) {
        target.configureProgramRuntime({
            execute: async (artifact, input, run) => ({
                runId: run.runId,
                recipeId: artifact.recipeId,
                revision: artifact.revision,
                accepted: true,
                status: "completed",
                output: input,
                checkpoints: [],
                completedCallIds: [],
                semanticEvidence: [],
                fallback: "never",
            }),
        });
    }

    async function draft(server = "test-mcp", secret = false) {
        const prompt = "Read package.json";
        const token = manager.armRecording({ sessionId: "recording" });
        manager.claimRecording({
            sessionId: "recording",
            cwd: instanceDir,
            promptHash: createHash("sha256").update(prompt).digest("hex"),
        });
        const trace = await manager.finalizeRecording({
            tokenId: token.id,
            trace: {
                schemaVersion: 1,
                sessionId: "recording",
                cwd: instanceDir,
                prompt,
                response: "Read it.",
                startedAt: "2026-09-30T10:00:00.000Z",
                completedAt: "2026-09-30T10:00:01.000Z",
                toolCalls: [
                    {
                        toolCallId: "read-1",
                        name: "read",
                        mcpServerName: server,
                        arguments: {
                            path: "package.json",
                            ...(secret ? { token: "[REDACTED]" } : {}),
                        },
                        result: { content: "test-content" },
                        modelResult: { content: "test-content" },
                        status: "completed",
                    },
                ],
            },
        });
        const macro = await induceMacroFromTrace(
            trace.traceId,
            {
                schemaVersion: 1,
                sessionId: "fixture",
                cwd: instanceDir,
                prompt,
                response: "Read it.",
                startedAt: "2026-09-30T10:00:00Z",
                completedAt: "2026-09-30T10:00:01Z",
                toolCalls: [
                    {
                        toolCallId: "read-1",
                        name: "read",
                        mcpServerName: server,
                        arguments: {
                            path: "package.json",
                            ...(secret ? { token: "[REDACTED]" } : {}),
                        },
                        result: { content: "test-content" },
                        status: "completed",
                    },
                ],
            },
            randomUUID(),
            "Read package",
            "Read the requested package file",
            new Date().toISOString(),
        );
        macro.executionKind = "program";
        macro.program = macroProgramFixture(macro);
        return manager.saveDraft(macro);
    }

    async function approved(server = "test-mcp", secret = false) {
        return manager.inspectMacro(
            await manager.approveMacro(await draft(server, secret)),
        );
    }

    it("publishes only approved versions with typed inputs and stable binding", async () => {
        const provider = createMacroAppAgentProvider(manager);
        const candidate = await draft();
        let manifest = await provider.getAppAgentManifest("macros");
        expect(JSON.stringify(manifest)).not.toContain(candidate.macroId);
        const macro = await manager.inspectMacro(
            await manager.approveMacro(candidate),
        );
        manifest = await provider.getAppAgentManifest("macros");
        const content = manifest.schema!.schemaFile;
        expect(typeof content).not.toBe("string");
        expect(JSON.stringify(content)).toContain(getMacroActionName(macro));
        expect(JSON.stringify(content)).toContain("step_1_path");
        expect(typeof content === "object" && content.cacheBinding).toEqual({
            sourceId: "typeagent:approved-macros",
            actionFingerprints: {
                listApprovedMacros: "list-approved-macros-v1",
                [getMacroActionName(macro)]: expect.any(String),
            },
        });
        expect(manifest.schema!.cacheBinding).toEqual(
            typeof content === "object" && content.cacheBinding,
        );
    });

    it("builds executable request grammars through the injected model and shared generator", async () => {
        const macro = await approved();
        let queries = 0;
        let active = 0;
        let peak = 0;
        const runtime = createMacroLearningRuntime(async () => {
            queries++;
            active++;
            peak = Math.max(peak, active);
            await new Promise((resolve) => setTimeout(resolve, 10));
            active--;
            return grammarModelResponse();
        });
        const rules = await runtime.generateGrammar(
            macro,
            { step_1_path: "package.json" },
            ["read file package.json now", "open file package.json now"],
            new AbortController().signal,
        );
        expect(queries).toBe(2);
        expect(peak).toBe(2);
        const grammar = loadGrammarRules("generated.agr", rules.join("\n"));
        expect(
            matchGrammarWithNFA(
                grammar,
                compileGrammarToNFA(grammar),
                "inspect file other.json now",
            ).map((match) => match.match),
        ).toEqual([
            {
                actionName: getMacroActionName(macro),
                parameters: { step_1_path: "other.json" },
            },
        ]);
        expect(calls).toHaveLength(0);
    });

    it("learns the exact workspace-tool request with escaped JSON and bounded variants", async () => {
        const macro = await manager.inspectMacro(await draft());
        const original =
            'Use the typeagent-workspace read tool with {"path":"package.json"}. Do not use typeagent-processCommand.';
        const requests = [
            original,
            "Read package.json for me",
            "Open package.json for me",
            "Show package.json for me",
        ];
        const runtime = createMacroLearningRuntime(async (prompt) => {
            expect(prompt).toContain(
                "Escape literal AGR special characters in matchPattern",
            );
            expect(prompt).toContain("typeagent\\\\-workspace");
            expect(prompt).toContain(
                "Preserve all fixed trailing text after captured inputs",
            );
            return grammarModelResponse({
                grammarPattern: {
                    matchPattern: prompt.includes(`Request: "${original}"`)
                        ? String.raw`Use the typeagent\-workspace read tool with \{"path":"$(step_1_path:wildcard)"\}. Do not use typeagent\-processCommand.`
                        : "(read | open | show) $(step_1_path:wildcard) for me",
                    actionParameters: [
                        {
                            parameterName: "step_1_path",
                            parameterValue: "step_1_path",
                        },
                    ],
                },
            });
        });
        const rules = await runtime.generateGrammar(
            macro,
            { step_1_path: "package.json" },
            requests,
            new AbortController().signal,
        );
        expect(rules).toHaveLength(4);
        const grammar = loadGrammarRules("workspace.agr", rules.join("\n"));
        const nfa = compileGrammarToNFA(grammar);
        for (const request of requests) {
            expect(
                matchGrammarWithNFA(
                    grammar,
                    nfa,
                    request.replace(
                        "package.json",
                        "packages\\copilot-macros\\package.json",
                    ),
                ).map((match) => match.match),
            ).toEqual([
                {
                    actionName: getMacroActionName(macro),
                    parameters: {
                        step_1_path: "packages\\copilot-macros\\package.json",
                    },
                },
            ]);
            for (const unsupported of [
                `Don't ${request}`,
                `${request} and delete all data`,
            ]) {
                expect(
                    matchGrammarWithNFA(grammar, nfa, unsupported),
                ).toHaveLength(0);
            }
        }
        expect(calls).toHaveLength(0);
        expect(await manager.getApprovedMacros()).toEqual([]);
    });

    it.each([true, false])(
        "does not mutate existing routes when a staged analysis requests shared phrases (generate=%s)",
        async (shouldGenerateGrammar) => {
            const macro = await approved();
            const matcher = globalPhraseSetRegistry.getMatcher("Polite")!;
            const before = [...matcher.phraseKeys];
            const existing = loadGrammarRules(
                "existing.agr",
                `<Start> = (<Polite>)? read file $(step_1_path:string) now -> { actionName: "existing", parameters: { step_1_path } };`,
            );
            const nfa = compileGrammarToNFA(existing);
            const negative = "Don't read file package.json now";
            expect(matchGrammarWithNFA(existing, nfa, negative)).toHaveLength(
                0,
            );
            const runtime = createMacroLearningRuntime(async () =>
                grammarModelResponse({
                    shouldGenerateGrammar,
                    phrasesToAdd: [{ matcherName: "Polite", phrase: "Don't" }],
                }),
            );
            await expect(
                runtime.generateGrammar(
                    macro,
                    { step_1_path: "package.json" },
                    ["read file package.json now"],
                    new AbortController().signal,
                ),
            ).rejects.toThrow("cannot modify shared phrase sets");
            expect([...matcher.phraseKeys]).toEqual(before);
            expect(matchGrammarWithNFA(existing, nfa, negative)).toHaveLength(
                0,
            );
            expect(calls).toHaveLength(0);
        },
    );

    it.each([
        "unscoped",
        "mismatched",
        "extra-declaration",
        "import",
        "export",
    ])("rejects a helper with %s declarations before staging", async (kind) => {
        const macro = await approved();
        const privateName = `${getMacroActionName(macro)}_example0_verb`;
        const name = kind === "unscoped" ? "SharedVerb" : privateName;
        const ruleText =
            kind === "import"
                ? `import * from "other.agr"; <${name}> = read;`
                : kind === "mismatched"
                  ? "<SharedVerb> = read;"
                  : `${kind === "export" ? "export " : ""}<${name}> = read;${kind === "extra-declaration" ? " <SharedVerb> = delete;" : ""}`;
        const runtime = createMacroLearningRuntime(async () =>
            grammarModelResponse({
                additionalRules: [{ name, ruleText }],
            }),
        );
        await expect(
            runtime.generateGrammar(
                macro,
                { step_1_path: "package.json" },
                ["read file package.json now"],
                new AbortController().signal,
            ),
        ).rejects.toThrow("private");
    });

    it("accepts private helper declarations without shared phrase changes", async () => {
        const macro = await approved();
        const name = `${getMacroActionName(macro)}_example0_verb`;
        const runtime = createMacroLearningRuntime(async () =>
            grammarModelResponse({
                phrasesToAdd: [],
                additionalRules: [
                    { name, ruleText: `<${name}> = read | open | inspect;` },
                ],
                grammarPattern: {
                    matchPattern: `<${name}> file $(step_1_path:string) now`,
                    actionParameters: [
                        {
                            parameterName: "step_1_path",
                            parameterValue: "step_1_path",
                        },
                    ],
                },
            }),
        );
        await expect(
            runtime.generateGrammar(
                macro,
                { step_1_path: "package.json" },
                ["read file package.json now"],
                new AbortController().signal,
            ),
        ).resolves.toHaveLength(1);
        expect(calls).toHaveLength(0);
    });

    it("rejects shared declarations injected through the match pattern", async () => {
        const macro = await approved();
        const actionName = getMacroActionName(macro);
        const runtime = createMacroLearningRuntime(async () =>
            grammarModelResponse({
                grammarPattern: {
                    matchPattern: `read file $(step_1_path:string) now -> { actionName: "${actionName}", parameters: { step_1_path } }; <SharedVerb> = ignore; <${actionName}_example0_ignored> = ignored $(step_1_path:string)`,
                    actionParameters: [
                        {
                            parameterName: "step_1_path",
                            parameterValue: "step_1_path",
                        },
                    ],
                },
            }),
        );
        await expect(
            runtime.generateGrammar(
                macro,
                { step_1_path: "package.json" },
                ["read file package.json now"],
                new AbortController().signal,
            ),
        ).rejects.toThrow("shared or unexpected declarations");
        expect(calls).toHaveLength(0);
    });

    it.each([
        [
            "object",
            { owner: "contoso", repo: "demo", nested: { enabled: true } },
        ],
        ["array", [{ owner: "contoso", repo: "demo" }]],
        ["string", "demo"],
        ["number", 42],
        ["boolean", true],
    ] as const)(
        "routes and validates %s macro inputs",
        async (valueType, value) => {
            const source = await approved();
            const candidate: CopilotToolMacro = {
                ...source,
                state: "draft",
                version: source.version + 1,
                inputs: [
                    {
                        name: "options",
                        description: "Tool options",
                        required: true,
                        secret: false,
                        valueType,
                    },
                ],
                steps: source.steps.map((step) => ({
                    ...step,
                    arguments: { kind: "input", name: "options" },
                })),
            };
            candidate.program = macroProgramFixture(candidate, {
                options: JSON.parse(JSON.stringify(value)),
            });
            const ref = await manager.saveDraft(candidate);
            const macro = await manager.inspectMacro(
                await manager.approveMacro(ref),
            );
            const actionName = getMacroActionName(macro);
            const schema = parseToolsJsonSchema([
                { name: actionName, inputSchema: getMacroInputSchema(macro) },
            ]).actionSchemas.get(actionName)!;
            const action = { actionName, parameters: { options: value } };
            expect(() => validateAction(schema, action)).not.toThrow();
            expect(() =>
                validateAction(schema, {
                    ...action,
                    parameters: { options: value, extra: true },
                }),
            ).toThrow("Extraneous property");
            const agent =
                await createMacroAppAgentProvider(manager).loadAppAgent(
                    "macros",
                );
            const result = await execute(agent, action, context);
            expect(result.error).toBeUndefined();
            expect(calls).toEqual([]);
            expect(
                "resultValue" in result ? result.resultValue : undefined,
            ).toEqual({ options: value });
            const invalid = await execute(
                agent,
                { actionName, parameters: {} },
                context,
            );
            expect(invalid.error).toBeDefined();
            const wrongType = await execute(
                agent,
                {
                    actionName,
                    parameters: { options: valueType === "object" ? [] : {} },
                },
                context,
            );
            expect(wrongType.error).toBeDefined();
            expect(calls).toHaveLength(0);
        },
    );

    it("rejects a staged route that conflicts with a macro approved after generation", async () => {
        const snapshots: number[] = [];
        let queries = 0;
        const runtime = createMacroLearningRuntime(
            async () => {
                queries++;
                return grammarModelResponse({
                    parameterMappings: [],
                    fixedPhrases: ["my", "tasks"],
                    grammarPattern: {
                        matchPattern: "(show | list | display | get) my tasks",
                        actionParameters: [],
                    },
                });
            },
            async () => {
                const approved = await manager.getApprovedMacros();
                snapshots.push(approved.length);
                return approved;
            },
        );
        const requests = [
            "Show my tasks",
            "List my tasks",
            "Display my tasks",
            "Get my tasks",
        ];
        await manager.configureLearning({
            ...runtime,
            buildProgram: async (macro) => macroProgramFixture(macro, {}),
            extract: async (trace, traceId) => ({
                schemaVersion: 1,
                traceId,
                request: trace.prompt,
                toolCallIds: trace.toolCalls.map((call) => call.toolCallId),
                description: "List tasks in the recorded account",
                uncertainties: [],
            }),
            build: async (_recipe, _trace, baseline) => ({
                name: baseline.name,
                description: baseline.description,
                inputs: baseline.inputs,
                steps: baseline.steps,
                exampleInputs: {},
                requests,
            }),
        });
        await manager.setMacroLearningPreference({
            cwd: instanceDir,
            mode: "prepare",
        });
        const drafts: CopilotToolMacro[] = [];
        for (const account of ["personal", "work"]) {
            const token = manager.armRecording({
                sessionId: account,
                cwd: instanceDir,
                learning: true,
            });
            manager.claimRecording({
                sessionId: account,
                cwd: instanceDir,
                promptHash: createHash("sha256")
                    .update(requests[0])
                    .digest("hex"),
            });
            const summary = await manager.finalizeRecording({
                tokenId: token.id,
                trace: {
                    schemaVersion: 1,
                    sessionId: account,
                    cwd: instanceDir,
                    prompt: requests[0],
                    response: "Listed tasks",
                    startedAt: "2026-09-30T10:00:00.000Z",
                    completedAt: "2026-09-30T10:00:01.000Z",
                    toolCalls: [
                        {
                            toolCallId: "tasks-1",
                            name: "tasks",
                            mcpServerName: "test-mcp",
                            arguments: { account },
                            result: {},
                            status: "completed",
                        },
                    ],
                },
            });
            let job = await manager.getMacroLearningJob(summary.learningJobId!);
            for (
                let attempt = 0;
                attempt < 500 &&
                ["queued", "extracting", "building"].includes(job.status);
                attempt++
            ) {
                await new Promise((resolve) => setTimeout(resolve, 5));
                job = await manager.getMacroLearningJob(job.jobId);
            }
            expect(job.error).toBeUndefined();
            expect(job.status).toBe("needsReview");
            drafts.push(await manager.inspectMacro(job.macro!));
        }
        expect(snapshots).toEqual([0, 0]);
        const first = await manager.approveMacro(drafts[0]);
        await expect(manager.approveMacro(drafts[1])).rejects.toThrow(
            "conflicts with the approved catalog",
        );
        expect(
            (await manager.getApprovedMacros()).map((macro) => macro.macroId),
        ).toEqual([first.macroId]);
        await expect(
            manager.inspectMacro({ macroId: drafts[1].macroId, version: 2 }),
        ).rejects.toThrow("not found");
        expect(queries).toBe(8);
        expect(calls).toHaveLength(0);
        const replacement = {
            ...(await manager.inspectMacro(first)),
            version: 4,
        };
        replacement.learning!.grammarRules =
            replacement.learning!.grammarRules.map((rule) =>
                rule.replaceAll(
                    getMacroActionName({ ...replacement, version: 2 }),
                    getMacroActionName(replacement),
                ),
            );
        const current = await manager.getApprovedMacros();
        expect(() =>
            runtime.validateGrammar(replacement, current),
        ).not.toThrow();
    });

    it("rejects grammar that would shadow another approved learned macro", async () => {
        const macro = await approved();
        const macroId = randomUUID();
        const existing: CopilotToolMacro = {
            ...macro,
            macroId,
            learning: {
                jobId: "previous-job",
                cwd: instanceDir,
                mode: "all",
                requiresLivePermissions: true,
                grammarRules: [
                    `<Start> = read file $(step_1_path:string) now -> { actionName: "${getMacroActionName({ ...macro, macroId })}", parameters: { step_1_path } };`,
                ],
                exampleInputs: { step_1_path: "package.json" },
                requests: ["read file package.json now"],
            },
        };
        const runtime = createMacroLearningRuntime(
            async () => grammarModelResponse(),
            async () => [existing],
        );
        await expect(
            runtime.generateGrammar(
                macro,
                { step_1_path: "package.json" },
                ["read file package.json now"],
                new AbortController().signal,
            ),
        ).rejects.toThrow("conflicts with the approved catalog");
        expect(calls).toHaveLength(0);
    });

    it("checks existing negative intents in the combined catalog", async () => {
        const macro = await approved();
        const existing = { ...macro, macroId: randomUUID() };
        existing.learning = {
            jobId: "previous-job",
            cwd: instanceDir,
            mode: "all",
            requiresLivePermissions: true,
            grammarRules: [
                `<Start> = (Don't)? browse file $(step_1_path:string) now -> { actionName: "${getMacroActionName(existing)}", parameters: { step_1_path } };`,
            ],
            exampleInputs: { step_1_path: "package.json" },
            requests: ["browse file package.json now"],
        };
        const runtime = createMacroLearningRuntime(
            async () => grammarModelResponse(),
            async () => [existing],
        );
        await expect(
            runtime.generateGrammar(
                macro,
                { step_1_path: "package.json" },
                ["read file package.json now"],
                new AbortController().signal,
            ),
        ).rejects.toThrow("catalog's unsupported intent");
    });

    it("allows a distinct action at another macro's negative request", async () => {
        const macro = await approved();
        const existing = { ...macro, macroId: randomUUID() };
        existing.learning = {
            jobId: "previous-job",
            cwd: instanceDir,
            mode: "all",
            requiresLivePermissions: true,
            grammarRules: [
                `<Start> = read file $(step_1_path:string) now -> { actionName: "${getMacroActionName(existing)}", parameters: { step_1_path } };`,
            ],
            exampleInputs: { step_1_path: "package.json" },
            requests: ["read file package.json now"],
        };
        const runtime = createMacroLearningRuntime(
            async () =>
                grammarModelResponse({
                    grammarPattern: {
                        matchPattern:
                            "read file $(step_1_path:string) now and delete all data",
                        actionParameters: [
                            {
                                parameterName: "step_1_path",
                                parameterValue: "step_1_path",
                            },
                        ],
                    },
                }),
            async () => [existing],
        );
        await expect(
            runtime.generateGrammar(
                macro,
                { step_1_path: "package.json" },
                ["read file package.json now and delete all data"],
                new AbortController().signal,
            ),
        ).resolves.toHaveLength(1);
        expect(calls).toHaveLength(0);
    });

    it.each(["test-mcp", "copilot-only"])(
        "routes a root prompt through completion grammar for %s without translation",
        async (server) => {
            const macro = await approved(server);
            const provider = createMacroAppAgentProvider(manager);
            const dispatcher = await createDispatcher("macro-routing-test", {
                appAgentProviders: [
                    {
                        ...provider,
                        async getAppAgentManifest(name) {
                            const manifest =
                                await provider.getAppAgentManifest(name);
                            return {
                                ...manifest,
                                schema: {
                                    ...manifest.schema!,
                                    grammarFile: {
                                        format: "agr",
                                        content: `<Start> = read package $(step_1_path:string) -> { actionName: "${getMacroActionName(macro)}", parameters: { step_1_path } };`,
                                    },
                                },
                            };
                        },
                    },
                ],
                agents: { schemas: ["macros"], actions: ["macros"] },
                cache: { enabled: true, grammarSystem: "completionBased" },
                explainer: { enabled: false },
                execution: { reasoning: "none" },
                collectCommandResult: true,
                conversationMemorySettings: {
                    requestKnowledgeExtraction: false,
                    actionResultEntityStorage: false,
                    actionResultKnowledgeExtraction: false,
                },
            });
            try {
                const result = await awaitCommand(
                    dispatcher,
                    "read package second-package.json",
                );
                expect(result?.lastError).toBeUndefined();
                expect(result?.actions).toEqual([
                    expect.objectContaining({
                        schemaName: "macros",
                        actionName: getMacroActionName(macro),
                        parameters: { step_1_path: "second-package.json" },
                    }),
                ]);
                expect(result?.tokenUsage?.total_tokens ?? 0).toBe(0);
                expect(calls).toHaveLength(0);
                expect(result?.agentHandoff).toBeUndefined();
            } finally {
                await dispatcher.close();
            }
        },
    );

    it("refreshes sessions and suspends stored routes on disable and delete", async () => {
        const macro = await approved();
        const provider = createMacroAppAgentProvider(manager);
        const agent = await provider.loadAppAgent("macros");
        const store = new GrammarStore();
        const before = await agent.getDynamicSchema!(
            {} as SessionContext,
            "macros",
        );
        await store.addRule({
            schemaName: "macros",
            actionName: getMacroActionName(macro),
            grammarText: `<Start> = read package -> { actionName: "${getMacroActionName(macro)}" };`,
            schemaHash: "initial",
            actionBinding: {
                sourceId: before!.cacheBinding!.sourceId,
                actionFingerprint:
                    before!.cacheBinding!.actionFingerprints[
                        getMacroActionName(macro)
                    ],
            },
        });
        let reloads = 0;
        const session = {
            reloadAgentSchema: async () => {
                reloads++;
                const updated = await agent.getDynamicSchema!(
                    session,
                    "macros",
                );
                await store.reconcileSchema("macros", {
                    schemaHash: "updated",
                    sourceId: updated!.cacheBinding!.sourceId,
                    actionFingerprints:
                        updated!.cacheBinding!.actionFingerprints,
                });
            },
        } as SessionContext;
        await agent.updateAgentContext!(true, session, "macros");
        await manager.disableMacro({ macroId: macro.macroId });
        expect(reloads).toBe(1);
        expect(store.getAllActiveRules()).toHaveLength(0);
        const result = await execute(
            agent,
            { actionName: getMacroActionName(macro) },
            context,
        );
        expect(result.error).toContain("no longer approved");
        expect(calls).toHaveLength(0);
        await manager.deleteMacro({ macroId: macro.macroId });
        expect(reloads).toBe(2);
        await agent.closeAgentContext!(session);
        await provider.unloadAppAgent("macros");
    });

    it("reloads approved routes after a manager restart", async () => {
        const macro = await approved();
        const restarted = new MacroManager(instanceDir);
        configureRuntime(restarted);
        const manifest =
            await createMacroAppAgentProvider(restarted).getAppAgentManifest(
                "macros",
            );
        expect(JSON.stringify(manifest)).toContain(getMacroActionName(macro));
    });

    it("keeps secret-input macros off the grammar surface", async () => {
        const macro = await approved("test-mcp", true);
        const manifest =
            await createMacroAppAgentProvider(manager).getAppAgentManifest(
                "macros",
            );
        expect(JSON.stringify(manifest)).not.toContain(
            getMacroActionName(macro),
        );
    });
});
