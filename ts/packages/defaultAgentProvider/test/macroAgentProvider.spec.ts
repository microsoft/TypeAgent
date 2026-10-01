// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
    GrammarStore,
    loadGrammarRules,
    compileGrammarToNFA,
    matchGrammarWithNFA,
    globalPhraseSetRegistry,
} from "@typeagent/action-grammar";
import type {
    ActionContext,
    AppAction,
    AppAgent,
    SessionContext,
} from "@typeagent/agent-sdk";
import { MacroManager, type CopilotToolMacro } from "@typeagent/copilot-macros";
import { createDispatcher } from "agent-dispatcher";
import { awaitCommand } from "@typeagent/dispatcher-types";
import {
    createMacroAppAgentProvider,
    getMacroActionName,
} from "../src/macroAgentProvider.js";
import {
    createMacroLearningRuntime,
    validateMacroGrammar,
} from "../src/macroLearningRuntime.js";

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
    const replayFlag = process.env.TYPEAGENT_MACRO_REPLAY_ENABLED;
    const handoffFlag = process.env.TYPEAGENT_MACRO_AGENT_HANDOFF_ENABLED;
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
        delete process.env.TYPEAGENT_MACRO_REPLAY_ENABLED;
        delete process.env.TYPEAGENT_MACRO_AGENT_HANDOFF_ENABLED;
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
    });

    afterEach(async () => {
        if (replayFlag === undefined)
            delete process.env.TYPEAGENT_MACRO_REPLAY_ENABLED;
        else process.env.TYPEAGENT_MACRO_REPLAY_ENABLED = replayFlag;
        if (handoffFlag === undefined)
            delete process.env.TYPEAGENT_MACRO_AGENT_HANDOFF_ENABLED;
        else process.env.TYPEAGENT_MACRO_AGENT_HANDOFF_ENABLED = handoffFlag;
        await rm(instanceDir, { recursive: true, force: true });
    });

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
        return manager.createMacroFromTrace({
            traceId: trace.traceId,
            name: "Read package",
            description: "Read the requested package file",
        });
    }

    async function approved(server = "test-mcp", secret = false) {
        return manager.inspectMacro(
            await manager.approveMacro(await draft(server, secret)),
        );
    }

    async function learned() {
        const prompt = "Read file package.json now";
        const requests = [
            prompt,
            "Open file package.json now",
            "Show file package.json now",
            "Display file package.json now",
        ];
        await manager.configureLearning({
            extract: async (_trace, traceId) => ({
                schemaVersion: 1,
                traceId,
                request: prompt,
                toolCallIds: ["read-1"],
                description: "Read a file",
                uncertainties: [],
            }),
            build: async (_recipe, _trace, baseline) => ({
                name: baseline.name,
                description: baseline.description,
                inputs: baseline.inputs,
                steps: baseline.steps,
                exampleInputs: { step_1_path: "package.json" },
                requests,
            }),
            generateGrammar: async (macro, inputs, examples) => {
                const actionName = getMacroActionName(macro);
                const rules = [
                    `<Start> = (read | open | show | display) file $(step_1_path:string) now -> { actionName: "${actionName}", parameters: { step_1_path } };`,
                ];
                validateMacroGrammar(rules, examples, actionName, inputs);
                return rules;
            },
        });
        await manager.setMacroLearningPreference({
            cwd: instanceDir,
            mode: "all",
        });
        const token = manager.armRecording({
            sessionId: "learning",
            cwd: instanceDir,
            learning: true,
        });
        manager.claimRecording({
            sessionId: "learning",
            cwd: instanceDir,
            promptHash: createHash("sha256").update(prompt).digest("hex"),
        });
        const summary = await manager.finalizeRecording({
            tokenId: token.id,
            trace: {
                schemaVersion: 1,
                sessionId: "learning",
                cwd: instanceDir,
                prompt,
                response: "Read it.",
                startedAt: "2026-09-30T10:00:00.000Z",
                completedAt: "2026-09-30T10:00:01.000Z",
                toolCalls: [
                    {
                        toolCallId: "read-1",
                        name: "read",
                        mcpServerName: "test-mcp",
                        arguments: { path: "package.json" },
                        result: { content: "test-content" },
                        modelResult: { content: "test-content" },
                        status: "completed",
                    },
                ],
            },
        });
        if (!summary.learningJobId)
            throw new Error("Learning job was not submitted.");
        const deadline = Date.now() + 5000;
        let job = await manager.getMacroLearningJob(summary.learningJobId);
        while (
            ["queued", "extracting", "building"].includes(job.status) &&
            Date.now() < deadline
        ) {
            await new Promise((resolve) => setTimeout(resolve, 10));
            job = await manager.getMacroLearningJob(job.jobId);
        }
        if (job.status !== "ready" || !job.macro)
            throw new Error(`Learning did not finish: ${JSON.stringify(job)}`);
        expect(job).toMatchObject({
            status: "ready",
            macro: expect.any(Object),
        });
        return manager.inspectMacro(job.macro);
    }

    it.each(["completionBased", "nfa"] as const)(
        "loads learned grammar after restart and routes changed inputs through %s to the live runner",
        async (grammarSystem) => {
            const macro = await learned();
            expect(calls).toHaveLength(0);
            const restarted = new MacroManager(instanceDir, {
                inspectTool: async (_server, toolName) => ({
                    toolName,
                    schemaFingerprint: "v1",
                }),
                callTool: async () => {
                    throw new Error(
                        "Learning must not bypass live permissions.",
                    );
                },
            });
            const provider = createMacroAppAgentProvider(restarted);
            const dispatcher = await createDispatcher("learned-macro-test", {
                appAgentProviders: [provider],
                agents: { schemas: ["macros"], actions: ["macros"] },
                cache: { enabled: true, grammarSystem },
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
                    "show file second-package.json now",
                );
                expect(result?.lastError).toBeUndefined();
                expect(result?.actions).toEqual([
                    expect.objectContaining({
                        actionName: getMacroActionName(macro),
                        parameters: { step_1_path: "second-package.json" },
                    }),
                ]);
                expect(result?.agentHandoff).toMatchObject({
                    agentName: "typeagent-macro-runner",
                    payload: { inputs: { step_1_path: "second-package.json" } },
                });
                expect(result?.tokenUsage?.total_tokens ?? 0).toBe(0);
                expect(calls).toHaveLength(0);
            } finally {
                await dispatcher.close();
            }
        },
    );

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

    it("matches a grammar with a changed input and replays the pinned macro", async () => {
        const macro = await approved();
        const provider = createMacroAppAgentProvider(manager);
        const agent = await provider.loadAppAgent("macros");
        const grammar = loadGrammarRules(
            "macro-test.agr",
            `<Start> = read package $(step_1_path:string) -> { actionName: "${getMacroActionName(macro)}", parameters: { step_1_path } };`,
        );
        const nfa = compileGrammarToNFA(grammar, "macros");
        const matches = matchGrammarWithNFA(
            grammar,
            nfa,
            "read package second-package.json",
        );
        expect(matches).toHaveLength(1);
        const action = matches[0].match as AppAction;
        const result = await execute(agent, action, context);
        expect(result.error).toBeUndefined();
        expect(result).toMatchObject({
            resultValue: {
                macroId: macro.macroId,
                version: macro.version,
                status: "completed",
            },
            tokenUsage: { total_tokens: 0 },
        });
        expect(calls).toEqual([{ path: "second-package.json" }]);
        expect(
            matchGrammarWithNFA(grammar, nfa, "show my calendar"),
        ).toHaveLength(0);
        await provider.unloadAppAgent("macros");
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
                if (server === "test-mcp") {
                    expect(calls).toEqual([{ path: "second-package.json" }]);
                    expect(result?.agentHandoff).toBeUndefined();
                } else {
                    expect(calls).toHaveLength(0);
                    expect(result?.agentHandoff).toMatchObject({
                        agentName: "typeagent-macro-runner",
                        payload: {
                            inputs: { step_1_path: "second-package.json" },
                        },
                    });
                }
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
        const manifest =
            await createMacroAppAgentProvider(restarted).getAppAgentManifest(
                "macros",
            );
        expect(JSON.stringify(manifest)).toContain(getMacroActionName(macro));
    });

    it("rejects a superseded pinned route while preserving explicit old-version runs", async () => {
        const macro = await approved();
        await manager.disableMacro({ macroId: macro.macroId });
        const request = {
            runId: randomUUID(),
            macroId: macro.macroId,
            version: macro.version,
            inputs: { step_1_path: "older-package.json" },
        };
        await expect(
            manager.runMacro(request, { requireLatestApproved: true }),
        ).rejects.toThrow("no longer the current approved version");
        expect(calls).toHaveLength(0);
        expect((await manager.runMacro(request)).status).toBe("completed");
        expect(calls).toEqual([{ path: "older-package.json" }]);
    });

    it("propagates action cancellation to replay and persists the cancelled run", async () => {
        const macro = await approved();
        const controller = new AbortController();
        const replayManager = new MacroManager(instanceDir, {
            inspectTool: async (_server, toolName) => ({
                toolName,
                schemaFingerprint: fingerprint,
            }),
            callTool: async (_server, _tool, args, signal) => {
                calls.push(args);
                controller.abort();
                signal.throwIfAborted();
                return { content: "test-content" };
            },
        });
        const agent =
            await createMacroAppAgentProvider(replayManager).loadAppAgent(
                "macros",
            );
        const result = await execute(
            agent,
            {
                actionName: getMacroActionName(macro),
                parameters: { step_1_path: "cancelled-package.json" },
            },
            { ...context, abortSignal: controller.signal },
        );
        expect(result.error).toContain("cancelled");
        expect(result.error).toContain("Do not repeat");
        expect(calls).toHaveLength(1);
        const runId = result.error!.match(/Macro run ([\w-]+) cancelled/)![1];
        expect(await replayManager.getMacroRun(runId)).toMatchObject({
            status: "cancelled",
            macroId: macro.macroId,
            version: macro.version,
        });
    });

    it("hands off Copilot-only tools without executing a replay prefix", async () => {
        const macro = await approved("copilot-only");
        const agent =
            await createMacroAppAgentProvider(manager).loadAppAgent("macros");
        const result = await execute(
            agent,
            {
                actionName: getMacroActionName(macro),
                parameters: { step_1_path: "other-package.json" },
            },
            context,
        );
        expect(result).toMatchObject({
            agentHandoff: {
                agentName: "typeagent-macro-runner",
                payload: {
                    macro: { macroId: macro.macroId, version: macro.version },
                    inputs: { step_1_path: "other-package.json" },
                },
            },
        });
        expect(calls).toHaveLength(0);
    });

    it("preflights schema drift without invoking tools", async () => {
        const macro = await approved();
        fingerprint = "changed";
        const agent =
            await createMacroAppAgentProvider(manager).loadAppAgent("macros");
        const result = await execute(
            agent,
            {
                actionName: getMacroActionName(macro),
                parameters: { step_1_path: "second-package.json" },
            },
            context,
        );
        expect(result.error).toContain("schema changed");
        expect(calls).toHaveLength(0);
    });

    it("rejects missing inputs before creating an agent handoff", async () => {
        const macro = await approved("copilot-only");
        const agent =
            await createMacroAppAgentProvider(manager).loadAppAgent("macros");
        const result = await execute(
            agent,
            { actionName: getMacroActionName(macro) },
            context,
        );
        expect(result.error).toContain("input is missing");
        expect(result).not.toHaveProperty("agentHandoff");
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

    it.each([
        ["test-mcp", "TYPEAGENT_MACRO_REPLAY_ENABLED"],
        ["copilot-only", "TYPEAGENT_MACRO_AGENT_HANDOFF_ENABLED"],
    ])("honors the execution flag for %s", async (server, flag) => {
        const macro = await approved(server);
        const provider = createMacroAppAgentProvider(manager);
        process.env[flag] = "off";
        const manifest = await provider.getAppAgentManifest("macros");
        expect(JSON.stringify(manifest)).not.toContain(
            getMacroActionName(macro),
        );
        const agent = await provider.loadAppAgent("macros");
        const result = await execute(
            agent,
            { actionName: getMacroActionName(macro) },
            context,
        );
        expect(result.error).toContain("no longer approved or enabled");
        expect(calls).toHaveLength(0);
        await provider.unloadAppAgent("macros");
    });
});
