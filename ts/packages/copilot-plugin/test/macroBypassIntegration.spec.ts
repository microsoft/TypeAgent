// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
    induceMacroFromTrace,
    MacroManager,
    type RunMacroResponse,
} from "@typeagent/copilot-macros";
import { compileRecipeProgram } from "@typeagent/copilot-macros/recipeCompiler";
import {
    recipeDigest,
    sealRecipeArtifact,
    type RecipeCapability,
} from "@typeagent/copilot-macros/recipeCore";
import { RecipeExecutor } from "@typeagent/copilot-macros/recipeExecutor";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalRecipeService } from "../src/extension/local-recipe-service.js";
import { captureNativeRecipeBinding } from "../src/extension/recipe-native-host.js";
import { createNativeTypeAgentRecipeHost } from "../src/extension/recipe-typeagent-host.js";
import {
    localRecipeDirectory,
    localRecipeScope,
} from "../src/shared/recipe-local-paths.js";
import { writeConfig } from "../src/shared/plugin-config.js";
import { nativeFixture } from "./recipeNativeFixtures.js";

async function saveProgram(
    manager: MacroManager,
    cwd: string,
    capability: RecipeCapability,
) {
    const trace = {
        schemaVersion: 1 as const,
        sessionId: "fixture-capture",
        cwd,
        prompt: "read alpha.txt",
        response: "fixture-read",
        startedAt: "2026-10-23T00:00:00Z",
        completedAt: "2026-10-23T00:00:01Z",
        toolCalls: [
            {
                toolCallId: "read",
                name: "read",
                mcpServerName: "fixture",
                arguments: { path: "alpha.txt" },
                result: "fixture-read",
                status: "completed" as const,
            },
        ],
    };
    const macro = await induceMacroFromTrace(
        "procedure:bypass-integration",
        trace,
        "bypass-read",
        "Read file",
        "Read current file contents",
        trace.completedAt,
        {
            inspectTool: async () => ({
                toolName: "read",
                mcpServerName: "fixture",
                schemaFingerprint: capability.schemaDigest,
                readOnly: true,
                inputSchema: capability.inputSchema,
            }),
            callTool: async () => {
                throw new Error("The step replayer must not run.");
            },
        },
    );
    const source = `async function execute(api, params) {
        if (params === null || typeof params !== "object" || Array.isArray(params))
            throw new Error("Expected file inputs.");
        return await api.tools.call(${JSON.stringify(capability.id)}, { path: params.step_1_path });
    }`;
    macro.executionKind = "program";
    macro.program = sealRecipeArtifact({
        schemaVersion: 1,
        kind: "program",
        recipeId: macro.macroId,
        name: macro.name,
        description: macro.description,
        execution: "symbolic",
        authorization: "live_host",
        source: {
            language: "typescript",
            text: source,
            digest: recipeDigest(source),
        },
        executable: compileRecipeProgram(source),
        inputSchema: {
            type: "object",
            properties: { step_1_path: { type: "string" } },
            required: ["step_1_path"],
            additionalProperties: false,
        },
        outputSchema: { type: "string" },
        output: {
            kind: "value",
            requirements: ["Return the current read result"],
            identity: "current_run",
        },
        capabilities: [capability],
        semanticFunctions: [],
        applicability: { assumptions: [], unsupported: [] },
        generalization: [],
        specification: {
            id: "bypass-read-spec",
            revision: "1",
            intent: "Read file contents",
            outputRequirements: ["Return the current read result"],
            rubric: "Exact",
            counterexamples: ["Delete a file"],
        },
        matching: {
            grammar: [
                "<Start> = read $(step_1_path:string) -> { step_1_path };",
            ],
            examples: [
                {
                    request: trace.prompt,
                    input: { step_1_path: "alpha.txt" },
                    evidenceIds: ["fixture-evidence"],
                },
            ],
            negatives: ["delete file"],
            collisionEvidenceIds: [],
        },
        provenance: {
            captureId: macro.sourceTraceId,
            taskId: "fixture-task",
            tokenId: "fixture-token",
            evidenceIds: ["fixture-evidence"],
            legacySource: { macroId: macro.macroId, version: macro.version },
        },
        fixtures: [
            {
                id: "fixture",
                origin: "synthetic",
                result: "passed",
                specificationRevision: "1",
                noLiveEffects: true,
            },
        ],
        createdAt: trace.completedAt,
    });
    const draft = await manager.saveDraft(macro);
    const approved = await manager.approveMacro(draft);
    return {
        draft: { macroId: draft.macroId, version: draft.version },
        approved: { macroId: approved.macroId, version: approved.version },
    };
}

describe("bypass macros over the production stdio MCP server", () => {
    const originalData = process.env.TYPEAGENT_PLUGIN_DATA;
    const originalOwner = process.env.TYPEAGENT_RECIPE_OWNER;
    let directory: string;
    let fixture: ReturnType<typeof nativeFixture>;
    let executor: RecipeExecutor;
    let service: Awaited<ReturnType<typeof createLocalRecipeService>>;
    let client: Client | undefined;
    let refs: Awaited<ReturnType<typeof saveProgram>>;

    beforeEach(async () => {
        directory = await mkdtemp(join(tmpdir(), "bypass-macro-integration-"));
        process.env.TYPEAGENT_PLUGIN_DATA = directory;
        delete process.env.TYPEAGENT_RECIPE_OWNER;
        writeConfig({ mode: "bypass" });
        fixture = nativeFixture("bypass-program-session");
        fixture.metadata.workingDirectory = directory;
        const scope = localRecipeScope(directory);
        const binding = await captureNativeRecipeBinding(
            fixture.session,
            scope.profileId,
        );
        const bridge = createNativeTypeAgentRecipeHost(
            fixture.session,
            binding,
            {
                invokeSemantic: async () => {
                    throw new Error(
                        "A symbolic program must not call a model.",
                    );
                },
            },
            {
                readOnlyMcpTools: [
                    { mcpServerName: "fixture", toolName: "read" },
                ],
            },
        );
        const inspected = await bridge.inspectTool({
            mcpServerName: "fixture",
            toolName: "read",
        });
        if (inspected.status !== "available")
            throw new Error(inspected.message);
        const manager = new MacroManager(
            localRecipeDirectory(directory),
            undefined,
            scope.profileId,
        );
        try {
            refs = await saveProgram(manager, directory, inspected.capability);
        } finally {
            await manager.close();
        }
        executor = new RecipeExecutor();
        const noLearning = async (): Promise<never> => {
            throw new Error("Executing a fixture must not start learning.");
        };
        service = await createLocalRecipeService({
            cwd: directory,
            sessionId: fixture.session.sessionId,
            report: (message) => {
                throw new Error(message);
            },
            replayHost: {
                inspectTool: async () => {
                    throw new Error("Execution must use the program host.");
                },
                callTool: async () => {
                    throw new Error("Execution must not replay steps.");
                },
            },
            learning: () => ({
                withAuthorQuery: () => {
                    throw new Error("Execution must not start authorship.");
                },
                extract: noLearning,
                build: noLearning,
                generateGrammar: noLearning,
                validateGrammar: noLearning,
                buildProgram: noLearning,
            }),
            program: {
                execute: (artifact, input, context) =>
                    executor.execute(
                        artifact,
                        input,
                        {
                            runId: context.runId,
                            signal: context.signal,
                            binding,
                            host: bridge.host,
                        },
                        {
                            timeoutMs: context.timeoutMs,
                            onCheckpoint: context.onCheckpoint,
                        },
                    ),
            },
        });
    });

    afterEach(async () => {
        await client?.close();
        client = undefined;
        await service?.close();
        await executor?.close();
        if (originalData === undefined)
            delete process.env.TYPEAGENT_PLUGIN_DATA;
        else process.env.TYPEAGENT_PLUGIN_DATA = originalData;
        if (originalOwner === undefined)
            delete process.env.TYPEAGENT_RECIPE_OWNER;
        else process.env.TYPEAGENT_RECIPE_OWNER = originalOwner;
        await rm(directory, { recursive: true, force: true });
    });

    async function connect(flag?: string) {
        client = new Client({ name: "bypass-program-test", version: "1" });
        await client.connect(
            new StdioClientTransport({
                command: process.execPath,
                args: [
                    fileURLToPath(new URL("../mcp/server.js", import.meta.url)),
                    "--macros",
                ],
                cwd: directory,
                env: {
                    ...(process.env.SystemRoot
                        ? { SystemRoot: process.env.SystemRoot }
                        : {}),
                    TYPEAGENT_PLUGIN_DATA: directory,
                    TYPEAGENT_MODE: "bypass",
                    TYPEAGENT_RECIPE_PROFILE_ID:
                        localRecipeScope(directory).profileId,
                    COPILOT_AGENT_SESSION_ID: fixture.session.sessionId,
                    ...(flag === undefined
                        ? {}
                        : { TYPEAGENT_BYPASS_MACRO_TOOLS: flag }),
                },
                stderr: "pipe",
            }),
        );
    }

    async function call(name: string, args: Record<string, unknown> = {}) {
        if (!client) throw new Error("MCP client is not connected.");
        const response = await client.callTool({ name, arguments: args });
        if (
            !Array.isArray(response.content) ||
            response.content[0]?.type !== "text" ||
            typeof response.content[0].text !== "string"
        )
            throw new Error("Expected the macro server's text envelope.");
        const text: string = response.content[0].text;
        return { isError: response.isError === true, text };
    }

    it("discovers and executes an approved program, then reads its durable result", async () => {
        await connect("true");
        const search = await call("search_macros", { query: "Read file" });
        expect(search.isError).toBe(false);
        expect(search.text).toContain(refs.approved.macroId);
        const requirements = await call("get_macro_requirements", {
            macroId: refs.approved.macroId,
        });
        expect(requirements.isError).toBe(false);
        expect(requirements.text).toContain("step_1_path");
        expect(fixture.execute).not.toHaveBeenCalled();
        const response = await call("run_macro", {
            macroId: refs.approved.macroId,
            inputs: { step_1_path: "beta.txt" },
        });
        expect(response.isError).toBe(false);
        const result = JSON.parse(response.text) as RunMacroResponse;
        expect(result).toMatchObject({
            status: "completed",
            run: {
                ...refs.approved,
                result: "fixture-read",
                program: { status: "completed", fallback: "never" },
            },
        });
        expect(fixture.execute).toHaveBeenCalledTimes(1);
        expect(fixture.execute).toHaveBeenCalledWith(
            expect.objectContaining({
                name: "mcp_fixture_read",
                arguments: { path: "beta.txt" },
            }),
        );
        const persisted = await call("get_macro_run", {
            runId: result.run.runId,
        });
        expect(persisted.isError).toBe(false);
        expect(JSON.parse(persisted.text)).toMatchObject({
            runId: result.run.runId,
            status: "completed",
            result: "fixture-read",
        });
    });

    it.each([undefined, "false", "invalid"])(
        "blocks execution with opt-in %p before native dispatch",
        async (flag) => {
            await connect(flag);
            expect(
                (
                    await call("run_macro", {
                        ...refs.approved,
                        inputs: { step_1_path: "beta.txt" },
                    })
                ).isError,
            ).toBe(true);
            expect(fixture.execute).not.toHaveBeenCalled();
        },
    );

    it("honors the saved opt-in without an environment override", async () => {
        writeConfig({ mode: "bypass", bypassMacroTools: true });
        await connect();
        const response = await call("run_macro", {
            ...refs.approved,
            inputs: { step_1_path: "beta.txt" },
        });
        expect(response.isError).toBe(false);
        expect(JSON.parse(response.text).status).toBe("completed");
        expect(fixture.execute).toHaveBeenCalledTimes(1);
    });

    it("blocks lifecycle operations even with the opt-in", async () => {
        await connect("true");
        for (const name of [
            "validate_macro",
            "approve_macro",
            "disable_macro",
            "delete_macro",
        ]) {
            const response = await call(name, {
                macroId: refs.approved.macroId,
            });
            expect(response.isError).toBe(true);
            expect(response.text).toContain("management");
        }
        expect(
            await service.connection.inspectMacro(refs.approved),
        ).toMatchObject({ state: "approved" });
        expect(fixture.execute).not.toHaveBeenCalled();
    });

    it("rejects draft and disabled/stale versions without native dispatch", async () => {
        await connect("true");
        const inputs = { step_1_path: "beta.txt" };
        expect(
            (await call("run_macro", { ...refs.draft, inputs })).isError,
        ).toBe(true);
        await service.connection.disableMacro({
            macroId: refs.approved.macroId,
        });
        expect(
            (await call("run_macro", { ...refs.approved, inputs })).isError,
        ).toBe(true);
        expect(
            (
                await call("run_macro", {
                    macroId: refs.approved.macroId,
                    inputs,
                })
            ).isError,
        ).toBe(true);
        expect(fixture.execute).not.toHaveBeenCalled();
    });

    it("retains a backend permission denial without retrying", async () => {
        fixture.execute.mockResolvedValue({
            resultType: "denied",
            textResultForLlm: "Fixture backend permission denied",
        });
        await connect("true");
        const response = await call("run_macro", {
            ...refs.approved,
            inputs: { step_1_path: "beta.txt" },
        });
        expect(response.isError).toBe(false);
        expect(JSON.parse(response.text)).toMatchObject({
            status: "failed",
            run: {
                status: "failed",
                error: { code: "denied" },
                program: { status: "denied", fallback: "never" },
            },
        });
        expect(fixture.execute).toHaveBeenCalledTimes(1);
    });

    it("rejects invalid inputs and a disabled owner before native dispatch", async () => {
        await connect("true");
        expect(
            (
                await call("run_macro", {
                    ...refs.approved,
                    inputs: { step_1_path: 42 },
                })
            ).isError,
        ).toBe(true);
        process.env.TYPEAGENT_RECIPE_OWNER = "off";
        expect(
            (
                await call("run_macro", {
                    ...refs.approved,
                    inputs: { step_1_path: "beta.txt" },
                })
            ).isError,
        ).toBe(true);
        expect(fixture.execute).not.toHaveBeenCalled();
    });
});
