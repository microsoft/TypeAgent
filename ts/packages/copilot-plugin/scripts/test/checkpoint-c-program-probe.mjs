// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { CopilotClient, RuntimeConnection } from "@github/copilot-sdk";
import { randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { callLocalRecipe } from "../../dist/shared/recipe-transport.js";
import { localRecipeDirectory } from "../../dist/shared/recipe-local-paths.js";

const packageRoot = fileURLToPath(new URL("../..", import.meta.url));
if (process.argv[2] === "--mcp") await fixtureServer();
else await run();

async function fixtureServer() {
    const { McpServer } = await import(
        "@modelcontextprotocol/sdk/server/mcp.js"
    );
    const { StdioServerTransport } = await import(
        "@modelcontextprotocol/sdk/server/stdio.js"
    );
    const { z } = await import("zod");
    const server = new McpServer({ name: "checkpoint-c", version: "1" });
    server.registerTool(
        "read",
        {
            description:
                "Return the current synthetic value for the requested name. Pure read.",
            inputSchema: { name: z.string() },
            annotations: { readOnlyHint: true, destructiveHint: false },
        },
        async ({ name }) => ({
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        value: `SYNTHETIC_${name.toUpperCase()}`,
                    }),
                },
            ],
            structuredContent: { value: `SYNTHETIC_${name.toUpperCase()}` },
        }),
    );
    server.registerTool(
        "read_sentiment",
        {
            description: "Read the current synthetic customer message by name.",
            inputSchema: { name: z.string() },
            annotations: { readOnlyHint: true, destructiveHint: false },
        },
        async ({ name }) => {
            const value = {
                message:
                    name === "alpha"
                        ? "I absolutely love this wonderful product and am delighted with it."
                        : "I deeply regret buying this terrible product and am extremely unhappy.",
            };
            return {
                content: [{ type: "text", text: JSON.stringify(value) }],
                structuredContent: value,
            };
        },
    );
    await server.connect(new StdioServerTransport());
}

async function invokeMacroMcp(plugin, env, workspace, sessionId, request) {
    const { Client } = await import(
        "@modelcontextprotocol/sdk/client/index.js"
    );
    const { StdioClientTransport } = await import(
        "@modelcontextprotocol/sdk/client/stdio.js"
    );
    const client = new Client({ name: "checkpoint-c-proof", version: "1" });
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [path.join(plugin, "dist", "mcp", "server.js"), "--macros"],
        env: { ...env, COPILOT_AGENT_SESSION_ID: sessionId },
        cwd: workspace,
        stderr: "pipe",
    });
    try {
        await client.connect(transport);
        const response = await client.callTool({
            name: "run_macro",
            arguments: request,
        });
        assert.notEqual(response.isError, true, JSON.stringify(response));
        return JSON.parse(
            response.content.find((item) => item.type === "text").text,
        );
    } finally {
        await client.close();
    }
}

function hook(plugin, env, input) {
    return new Promise((resolve, reject) => {
        const child = spawn(
            process.execPath,
            [path.join(plugin, "dist", "hooks", "hook-router.js")],
            { env, cwd: input.cwd, stdio: ["pipe", "pipe", "pipe"] },
        );
        let output = "";
        let diagnostic = "";
        const timer = setTimeout(() => {
            child.kill();
            reject(
                new Error(
                    "Copied hook exceeded its deadline; do not retry accepted work.",
                ),
            );
        }, 80_000);
        child.stdout.on("data", (chunk) => {
            output += String(chunk);
        });
        child.stderr.on("data", (chunk) => {
            diagnostic += String(chunk);
        });
        child.on("error", reject);
        child.on("exit", (code) => {
            clearTimeout(timer);
            if (code !== 0)
                reject(
                    new Error(
                        `Copied hook failed (${code}): ${diagnostic.slice(-4096)}`,
                    ),
                );
            else {
                try {
                    resolve(JSON.parse(output));
                } catch (error) {
                    reject(
                        new Error(
                            `Invalid copied hook output: ${String(error)}`,
                        ),
                    );
                }
            }
        });
        child.stdin.end(JSON.stringify(input));
    });
}

async function run() {
    const [cliPath, reportPath] = process.argv.slice(2);
    assert(
        cliPath && reportPath,
        "Usage: node checkpoint-c-program-probe.mjs <copilot.exe> <report.json>",
    );
    const directory = await mkdtemp(
        path.join(tmpdir(), "typeagent-checkpoint-c-"),
    );
    const workspace = path.join(directory, "workspace");
    const plugin = path.join(directory, "plugin");
    const data = path.join(directory, "data");
    await mkdir(workspace);
    await mkdir(plugin);
    await mkdir(data);
    for (const name of ["dist", "extensions", "agents", "skills"])
        await cp(path.join(packageRoot, name), path.join(plugin, name), {
            recursive: true,
        });
    for (const name of ["plugin.json", "hooks.json", ".mcp.json"])
        await cp(path.join(packageRoot, name), path.join(plugin, name));
    await writeFile(
        path.join(plugin, "extensions", "typeagent", "extension.mjs"),
        'import {writeFile} from "node:fs/promises"; import {join} from "node:path";\ntry { await import("../../dist/extensions/typeagent/extension.mjs"); } catch(error) { await writeFile(join(process.env.TYPEAGENT_PLUGIN_DATA, "startup-error.json"), JSON.stringify({message:String(error),stack:error?.stack})); throw error; }\n',
    );
    await writeFile(
        path.join(data, "config.json"),
        JSON.stringify({
            mode: "direct",
            recipeOwner: "plugin",
            recipeReadOnlyMcpTools: [
                { mcpServerName: "checkpoint-c", toolName: "read" },
                { mcpServerName: "checkpoint-c", toolName: "read_sentiment" },
            ],
        }),
    );
    const env = {};
    for (const key of [
        "SystemRoot",
        "WINDIR",
        "COMSPEC",
        "PATH",
        "PATHEXT",
        "HOME",
        "USERPROFILE",
        "APPDATA",
        "LOCALAPPDATA",
    ])
        if (process.env[key]) env[key] = process.env[key];
    Object.assign(env, {
        TEMP: directory,
        TMP: directory,
        TYPEAGENT_PLUGIN_DATA: data,
        TYPEAGENT_RECIPE_OWNER: "plugin",
        TYPEAGENT_RECIPE_PROFILE_ID: "checkpoint-c-proof",
        TYPEAGENT_HOST: "127.0.0.1",
        TYPEAGENT_PORT: "1",
        DO_NOT_TRACK: "1",
    });
    const originalData = process.env.TYPEAGENT_PLUGIN_DATA;
    const originalProfile = process.env.TYPEAGENT_RECIPE_PROFILE_ID;
    process.env.TYPEAGENT_PLUGIN_DATA = data;
    process.env.TYPEAGENT_RECIPE_PROFILE_ID = "checkpoint-c-proof";
    const report = {
        status: "starting",
        evidence:
            "Actual copied production extension, actual source children and independent native verifier, synthetic MCP read only.",
        permissions: [],
        logs: [],
        modelCalls: 0,
        tools: [],
    };
    const createClient = () =>
        new CopilotClient({
            connection: RuntimeConnection.forStdio({ path: cliPath, env }),
            mode: "empty",
            baseDirectory: path.join(directory, "native"),
            workingDirectory: workspace,
            useLoggedInUser: true,
            logLevel: "none",
            builtinPluginDirectories: [plugin],
        });
    let client = createClient();
    let session;
    const watchdog = setTimeout(() => void client.forceStop(), 600_000);
    const persist = () =>
        writeFile(path.resolve(reportPath), JSON.stringify(report, null, 2));
    try {
        await client.start();
        const sessionOptions = {
            workingDirectory: workspace,
            requestExtensions: true,
            enableConfigDiscovery: false,
            enableSessionStore: false,
            enableFileHooks: false,
            enableSkills: false,
            enableHostGitOperations: false,
            systemMessage: {
                mode: "append",
                content:
                    "For this selected recording, after the user's read task succeeds, call typeagent_recorded_task_succeeded once before the final answer. This is recording metadata, not part of the user's task. Do not delegate or call unrelated tools.",
            },
            availableTools: [
                "task",
                "mcp:*",
                "typeagent_recorded_task_succeeded",
            ],
            mcpServers: {
                "checkpoint-c": {
                    type: "local",
                    command: process.execPath,
                    args: [fileURLToPath(import.meta.url), "--mcp"],
                    env,
                    tools: ["read", "read_sentiment"],
                },
            },
            onPermissionRequest: (request) => {
                const allowed =
                    !request.managedApprovalRequired &&
                    !request.requestSandboxBypass &&
                    ((request.kind === "mcp" &&
                        request.serverName === "checkpoint-c" &&
                        ["read", "read_sentiment"].includes(
                            request.toolName,
                        )) ||
                        (request.kind === "custom-tool" &&
                            request.toolName ===
                                "typeagent_recorded_task_succeeded"));
                report.permissions.push({
                    kind: request.kind,
                    toolName: request.toolName,
                    serverName: request.serverName,
                    ...(request.kind === "extension-permission-access"
                        ? {
                              extensionName: request.extensionName,
                              capabilities: request.capabilities,
                          }
                        : {}),
                    allowed,
                });
                return { kind: allowed ? "approve-once" : "reject" };
            },
        };
        session = await client.createSession(sessionOptions);
        const observe = (event) => {
            if (event.type === "assistant.usage") report.modelCalls++;
            if (event.type === "session.error") report.logs.push(event.data);
            if (event.type === "tool.execution_start")
                report.tools.push({
                    name: event.data.toolName,
                    agentId: event.agentId,
                    mcpServerName: event.data.mcpServerName,
                    mcpToolName: event.data.mcpToolName,
                });
        };
        session.on(observe);
        const call = (method, ...args) =>
            callLocalRecipe(workspace, session.sessionId, method, args);
        const deadline = Date.now() + 30_000;
        while (true) {
            try {
                await call("getMacroRecordingState", session.sessionId);
                break;
            } catch (error) {
                if (Date.now() >= deadline) throw error;
                await new Promise((resolve) => setTimeout(resolve, 150));
            }
        }
        report.status = "owner-ready";
        await call("setMacroLearningPreference", {
            cwd: workspace,
            mode: "read-only",
        });
        const token = await call("armMacroRecording", {
            sessionId: session.sessionId,
            cwd: workspace,
            learning: true,
        });
        const prompt =
            "Read the checkpoint-c MCP value named alpha and return its complete current result unchanged.";
        const input = {
            cwd: workspace,
            sessionId: session.sessionId,
            timestamp: Date.now(),
            prompt,
        };
        const selected = await hook(plugin, env, input);
        assert.match(
            selected.additionalContext,
            /typeagent_recorded_task_succeeded/,
        );
        assert.equal(
            (await call("getMacroRecordingState", session.sessionId)).token.id,
            token.id,
        );
        const selectedStarted = Date.now();
        await session.sendAndWait({ prompt }, 70_000);
        report.timings = { selectedAnswerMs: Date.now() - selectedStarted };
        const learningDeadline = Date.now() + 240_000;
        let state;
        do {
            state = await call("getMacroRecordingState", session.sessionId);
            report.learning = state.learningJob ?? { status: state.status };
            await persist();
            if (state.learningJob?.status === "ready") break;
            if (
                ["failed", "cancelled", "needsReview"].includes(
                    state.learningJob?.status,
                )
            )
                throw new Error(`Learning stopped: ${state.learningJob.error}`);
            await new Promise((resolve) => setTimeout(resolve, 300));
        } while (Date.now() < learningDeadline);
        assert.equal(state.learningJob?.status, "ready", JSON.stringify(state));
        report.timings.selectedReadyMs = Date.now() - selectedStarted;
        const [summary] = await call("listMacros", { state: "approved" });
        const macro = await call("inspectMacro", { macroId: summary.macroId });
        assert.equal(macro.program.execution, "symbolic");
        const before = report.modelCalls;
        const freshInputs = Object.fromEntries(
            Object.entries(macro.learning.exampleInputs).map(
                ([name, value]) => [
                    name,
                    typeof value === "string"
                        ? value.replaceAll("alpha", "gamma")
                        : value,
                ],
            ),
        );
        const explicit = await call("runMacro", {
            macroId: macro.macroId,
            version: macro.version,
            runId: `explicit-${randomUUID()}`,
            inputs: freshInputs,
        });
        assert.equal(explicit.status, "completed", JSON.stringify(explicit));
        const repeated = await hook(plugin, env, {
            ...input,
            timestamp: Date.now(),
            prompt: macro.learning.requests[0].replaceAll("alpha", "gamma"),
        });
        assert.equal(repeated.handled, true, JSON.stringify(repeated));
        const nl = JSON.parse(repeated.responseContent);
        assert.equal(nl.status, "completed", JSON.stringify(nl));
        assert.match(JSON.stringify(nl.run.result), /SYNTHETIC_GAMMA/);
        assert.deepEqual(nl.run.program.semanticEvidence, []);
        assert.equal(report.modelCalls, before);
        report.publication = {
            macroId: macro.macroId,
            version: macro.version,
            sourceDigest: macro.program.source.digest,
            fixtures: macro.program.fixtures,
            explicit: explicit.status,
            naturalLanguage: nl.status,
            repeatModelCalls: report.modelCalls - before,
        };
        const reused = await invokeMacroMcp(
            plugin,
            env,
            workspace,
            session.sessionId,
            {
                macroId: macro.macroId,
                version: macro.version,
                inputs: freshInputs,
            },
        );
        assert.equal(reused.status, "completed", JSON.stringify(reused));
        assert.deepEqual(reused.run.result, { value: "SYNTHETIC_GAMMA" });
        report.agentCallableMcp = {
            status: reused.status,
            result: reused.run.result,
        };

        const previousJobId = state.learningJob.jobId;
        const hybridPrompt =
            "Read the checkpoint-c MCP customer message named alpha using read_sentiment. Classify its sentiment by meaning as positive, negative or neutral. Return only a JSON object with one property sentiment containing that label.";
        await call("armMacroRecording", {
            sessionId: session.sessionId,
            cwd: workspace,
            learning: true,
        });
        await hook(plugin, env, {
            ...input,
            timestamp: Date.now(),
            prompt: hybridPrompt,
        });
        await session.sendAndWait({ prompt: hybridPrompt }, 70_000);
        const hybridDeadline = Date.now() + 240_000;
        do {
            state = await call("getMacroRecordingState", session.sessionId);
            report.learning = state.learningJob ?? { status: state.status };
            await persist();
            if (
                state.learningJob?.jobId !== previousJobId &&
                state.learningJob?.status === "ready"
            )
                break;
            if (
                ["failed", "cancelled", "needsReview"].includes(
                    state.learningJob?.status,
                )
            )
                throw new Error(
                    `Hybrid learning stopped: ${state.learningJob.error}`,
                );
            await new Promise((resolve) => setTimeout(resolve, 300));
        } while (Date.now() < hybridDeadline);
        assert.equal(state.learningJob?.status, "ready", JSON.stringify(state));
        assert.notEqual(state.learningJob.jobId, previousJobId);
        const definitions = await call("listMacros", { state: "approved" });
        const hybridSummary = definitions.find(
            (item) => item.macroId !== macro.macroId,
        );
        assert(
            hybridSummary,
            "The semantic recording did not publish a distinct program.",
        );
        const hybrid = await call("inspectMacro", {
            macroId: hybridSummary.macroId,
        });
        assert.equal(hybrid.program.execution, "hybrid");
        const hybridInputs = Object.fromEntries(
            Object.entries(hybrid.learning.exampleInputs).map(
                ([name, value]) => [
                    name,
                    typeof value === "string"
                        ? value.replaceAll("alpha", "gamma")
                        : value,
                ],
            ),
        );
        const hybridRun = await call("runMacro", {
            macroId: hybrid.macroId,
            version: hybrid.version,
            runId: `hybrid-${randomUUID()}`,
            inputs: hybridInputs,
        });
        assert.equal(hybridRun.status, "completed", JSON.stringify(hybridRun));
        assert.deepEqual(hybridRun.run.result, { sentiment: "negative" });
        assert.equal(hybridRun.run.program.semanticEvidence.length, 1);
        report.hybrid = {
            macroId: hybrid.macroId,
            sourceDigest: hybrid.program.source.digest,
            status: hybridRun.status,
            result: hybridRun.run.result,
            semanticEvidence: hybridRun.run.program.semanticEvidence,
        };

        await session.disconnect();
        await client.stop();
        client = createClient();
        await client.start();
        session = await client.createSession(sessionOptions);
        session.on(observe);
        const restartDeadline = Date.now() + 30_000;
        while (true) {
            try {
                await call("getMacroRecordingState", session.sessionId);
                break;
            } catch (error) {
                if (Date.now() >= restartDeadline) throw error;
                await new Promise((resolve) => setTimeout(resolve, 150));
            }
        }
        const restored = await call("inspectMacro", { macroId: macro.macroId });
        assert.equal(
            restored.program.source.digest,
            macro.program.source.digest,
        );
        const recovered = await call("runMacro", {
            macroId: macro.macroId,
            version: macro.version,
            runId: `restart-${randomUUID()}`,
            inputs: freshInputs,
        });
        assert.equal(recovered.status, "completed", JSON.stringify(recovered));
        assert.deepEqual(recovered.run.result, { value: "SYNTHETIC_GAMMA" });
        report.restart = {
            status: recovered.status,
            sourceDigest: restored.program.source.digest,
        };
        report.status = "passed";
    } catch (error) {
        report.status = "blocked";
        report.error = String(error);
        report.extensions = await session?.rpc.extensions.list();
        try {
            const stored = JSON.parse(
                await readFile(
                    path.join(
                        localRecipeDirectory(workspace),
                        "copilot-macros",
                        "learning.json",
                    ),
                    "utf8",
                ),
            );
            report.verifierAnswers = stored.jobs.flatMap((job) =>
                Object.values(job.verifierAnswers ?? {}),
            );
            report.recordedTrace = JSON.parse(
                await readFile(
                    path.join(
                        localRecipeDirectory(workspace),
                        "copilot-macros",
                        "traces",
                        `${report.learning.traceId}.json`,
                    ),
                    "utf8",
                ),
            );
            const requests = JSON.parse(
                await readFile(
                    path.join(
                        localRecipeDirectory(workspace),
                        "copilot-macros",
                        "child-authoring.json",
                    ),
                    "utf8",
                ),
            );
            report.authoring = requests.map(({ prompt, outcome }) => ({
                prompt,
                outcome,
            }));
        } catch (diagnosticError) {
            if (diagnosticError.code !== "ENOENT") throw diagnosticError;
        }
        try {
            report.startupError = JSON.parse(
                await readFile(path.join(data, "startup-error.json"), "utf8"),
            );
        } catch (diagnosticError) {
            if (diagnosticError.code !== "ENOENT") throw diagnosticError;
        }
    } finally {
        await session?.disconnect().catch((error) => {
            report.shutdownError = String(error);
        });
        await client.stop().catch(() => client.forceStop());
        clearTimeout(watchdog);
        await persist();
        if (originalData === undefined)
            delete process.env.TYPEAGENT_PLUGIN_DATA;
        else process.env.TYPEAGENT_PLUGIN_DATA = originalData;
        if (originalProfile === undefined)
            delete process.env.TYPEAGENT_RECIPE_PROFILE_ID;
        else process.env.TYPEAGENT_RECIPE_PROFILE_ID = originalProfile;
        await rm(directory, { recursive: true, force: true });
        console.log(
            JSON.stringify({
                status: report.status,
                error: report.error,
                report: path.resolve(reportPath),
            }),
        );
    }
    if (report.status !== "passed") process.exitCode = 1;
}
