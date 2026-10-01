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
} from "@typeagent/action-grammar";
import type {
    ActionContext,
    AppAction,
    AppAgent,
    SessionContext,
} from "@typeagent/agent-sdk";
import { MacroManager } from "@typeagent/copilot-macros";
import { createDispatcher } from "agent-dispatcher";
import { awaitCommand } from "@typeagent/dispatcher-types";
import {
    createMacroAppAgentProvider,
    getMacroActionName,
} from "../src/macroAgentProvider.js";

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
