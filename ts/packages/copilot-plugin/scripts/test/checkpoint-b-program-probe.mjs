// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CopilotClient, RuntimeConnection } from "@github/copilot-sdk";
import { joinSession } from "@github/copilot-sdk/extension";
import { MacroManager } from "@typeagent/copilot-macros";
import {
    recipeSchemaDigest,
    validateRecipeArtifact,
} from "@typeagent/copilot-macros/recipeCore";
import { executeRecipeProgram } from "@typeagent/copilot-macros/recipeExecutor";
import { createMacroLearningRuntime } from "../../../defaultAgentProvider/dist/macroLearningRuntime.js";
import { createMacroProgramAuthor } from "../../../defaultAgentProvider/dist/macroProgramAuthoring.js";
import {
    createMacroAuthorChildLauncher,
    macroAuthorChildAgent,
} from "../../dist/extension/macro-author-child.js";
import { MacroAuthoringWorker } from "../../dist/extension/macro-authoring.js";
import { createMacroTaskReceiptTool } from "../../dist/extension/macro-task-receipt.js";
import { SessionCapture } from "../../dist/extension/session-capture.js";

const packageRoot = fileURLToPath(new URL("../..", import.meta.url));
const readSchema = {
    type: "object",
    properties: { path: { type: "string" } },
    required: ["path"],
    additionalProperties: false,
};
const rootPrompt = (file) =>
    `Use only the checkpoint-b fixture MCP read tool to read ${file}. ` +
    "Return its complete current tool result unchanged. This is a simple read, not selection or synthesis. " +
    "After the read succeeds call typeagent_recorded_task_succeeded exactly once, then give your final answer. " +
    "Do not read any other files, call other tools, write files, or delegate.";

function schema(value) {
    if (value === null) return { type: "null" };
    if (Array.isArray(value))
        return { type: "array", items: schema(value[0] ?? null) };
    if (typeof value !== "object") return { type: typeof value };
    return {
        type: "object",
        properties: Object.fromEntries(
            Object.entries(value).map(([key, child]) => [key, schema(child)]),
        ),
        required: Object.keys(value),
        additionalProperties: false,
    };
}

function changed(value, replacement) {
    if (typeof value === "string")
        return value
            .replaceAll("alpha", replacement)
            .replaceAll("ALPHA", replacement.toUpperCase());
    if (Array.isArray(value))
        return value.map((item) => changed(item, replacement));
    if (value && typeof value === "object")
        return Object.fromEntries(
            Object.entries(value).map(([key, child]) => [
                key,
                changed(child, replacement),
            ]),
        );
    return value;
}

export async function joinedProbe() {
    const cwd = process.env.TYPEAGENT_B_PROGRAM_STATE;
    assert(cwd, "Synthetic probe directory is required.");
    const file = path.join(cwd, "alpha.txt");
    const reportFile = path.join(cwd, "joined-report.json");
    const report = {
        status: "initializing",
        verifier:
            "trusted deterministic source-blind fixture provider, not a child",
        transport:
            "MacroAuthoringWorker using in-process public MacroManager RPC method adapter",
        childCalls: [],
        errors: [],
        authoringBusinessCalls: 0,
    };
    const persist = () =>
        writeFile(reportFile, JSON.stringify(report, null, 2));
    let summary;
    let recorded;
    let worker;
    let capture;
    let launcher;
    let native;
    const manager = new MacroManager(path.join(cwd, "manager"), {
        inspectTool: async (_server, toolName) => ({
            toolName,
            schemaFingerprint: "synthetic-read-v1",
            readOnly: true,
        }),
        callTool: async () => {
            report.authoringBusinessCalls++;
            throw new Error("Business calls are forbidden during authoring.");
        },
    });
    const connection = {
        getMacroRecordingState: (id) => manager.getRecordingState(id),
        finalizeMacroRecording: async (request) => {
            recorded = request.trace;
            report.root = {
                sessionId: request.trace.sessionId,
                toolCalls: request.trace.toolCalls.map((call) => ({
                    name: call.name,
                    provider: call.mcpServerName,
                    status: call.status,
                })),
                contextualCapture: request.childAuthoring,
            };
            return manager.finalizeRecording(request);
        },
        failMacroRecording: (sessionId, tokenId, error) =>
            manager.failRecording(sessionId, tokenId, error),
        getMacroLearningPreference: (directory) =>
            manager.getMacroLearningPreference(directory),
        getMacroLearningJob: (jobId) => manager.getMacroLearningJob(jobId),
        claimMacroAuthoringRequest: (claim) =>
            manager.claimMacroAuthoringRequest(claim),
        submitMacroAuthoringResponse: (response) =>
            manager.submitMacroAuthoringResponse(response),
        close: async () => {},
    };
    try {
        native = await joinSession({
            customAgents: [macroAuthorChildAgent],
            tools: [
                createMacroTaskReceiptTool(() =>
                    manager.getRecordingState(native.sessionId),
                ),
            ],
            commands: [
                {
                    name: "checkpoint-b-program-run",
                    description:
                        "Run the bounded synthetic program publication proof.",
                    handler: async () => {
                        await capture.flush();
                        try {
                            assert(
                                summary?.learningJobId,
                                "No contextual successful root recording was finalized.",
                            );
                            report.status = "authoring";
                            await persist();
                            worker.kick();
                            const deadline = Date.now() + 180_000;
                            let job;
                            do {
                                job = await manager.getMacroLearningJob(
                                    summary.learningJobId,
                                );
                                if (job.status === "ready") break;
                                if (
                                    ["failed", "cancelled"].includes(job.status)
                                )
                                    throw new Error(
                                        `Production learning failed: ${job.error ?? JSON.stringify(job)}`,
                                    );
                                await new Promise((resolve) =>
                                    setTimeout(resolve, 250),
                                );
                            } while (Date.now() < deadline);
                            assert.equal(
                                job.status,
                                "ready",
                                `Bounded probe ended at ${job.status}`,
                            );
                            await worker.close();
                            const [macro] = await manager.getApprovedMacros();
                            assert(
                                macro?.program,
                                "No compiled program was published.",
                            );
                            const artifact = macro.program;
                            assert.deepEqual(
                                validateRecipeArtifact(artifact),
                                [],
                            );
                            assert.equal(
                                artifact.provenance.tokenId,
                                report.recordingTokenId,
                            );
                            assert.equal(
                                artifact.provenance.taskId,
                                report.root.contextualCapture.taskId,
                            );
                            assert(
                                artifact.provenance.evidenceIds.includes(
                                    macro.learning.authoring.contextDigest,
                                ),
                            );
                            let freshCalls = 0;
                            const freshResult = changed(
                                recorded.toolCalls[0].result,
                                "gamma",
                            );
                            const freshInput = changed(
                                macro.learning.exampleInputs,
                                "gamma",
                            );
                            const execution = await executeRecipeProgram(
                                artifact,
                                freshInput,
                                {
                                    runId: "native-program-fresh",
                                    signal: AbortSignal.timeout(10_000),
                                    binding: {
                                        workspaceId: cwd,
                                        profileId: "probe",
                                        providerId: "checkpoint-b",
                                        accountId: "synthetic",
                                        sessionId: native.sessionId,
                                        generation: "fresh",
                                    },
                                    host: {
                                        inspectCapability: async (
                                            capability,
                                        ) => ({
                                            status: "available",
                                            capability,
                                        }),
                                        invokeCapability: async (
                                            _capability,
                                            input,
                                        ) => {
                                            freshCalls++;
                                            assert.deepEqual(input, {
                                                path: path.join(
                                                    cwd,
                                                    "gamma.txt",
                                                ),
                                            });
                                            return {
                                                status: "completed",
                                                value: freshResult,
                                            };
                                        },
                                        invokeSemantic: async () => {
                                            throw new Error(
                                                "No semantic calls declared.",
                                            );
                                        },
                                    },
                                },
                            );
                            assert.equal(execution.status, "completed");
                            assert.deepEqual(execution.output, freshResult);
                            assert.equal(freshCalls, 1);
                            assert.equal(report.authoringBusinessCalls, 0);
                            report.publication = {
                                recipeId: artifact.recipeId,
                                revision: artifact.revision,
                                sourceDigest: artifact.source.digest,
                                provenance: artifact.provenance,
                                fixtures: artifact.fixtures,
                                freshExecution: execution.status,
                                freshCalls,
                            };
                            report.status = "passed";
                        } catch (error) {
                            report.status = "blocked";
                            report.errors.push(String(error));
                        } finally {
                            await worker.close();
                            await persist();
                        }
                        return { result: report.status };
                    },
                },
            ],
        });
        launcher = createMacroAuthorChildLauncher(native);
        worker = new MacroAuthoringWorker({
            sessionId: native.sessionId,
            cwd,
            connect: async () => connection,
            launch: async (prompt, signal) => {
                assert(
                    report.childCalls.length < 12,
                    "Bounded native child request budget exceeded.",
                );
                const phase = prompt.includes(
                    "AUTHORING_PHASE:\nExtract a procedural",
                )
                    ? "extract"
                    : prompt.includes("AUTHORING_PHASE:\nBuild a reusable")
                      ? "build"
                      : prompt.includes("AUTHORING_PHASE:\nAuthor a reusable")
                        ? "source"
                        : "grammar";
                const entry = { phase, status: "started" };
                report.childCalls.push(entry);
                await persist();
                const result = await launcher(prompt, signal);
                JSON.parse(result.text);
                Object.assign(entry, {
                    status: "completed",
                    childId: result.childId,
                    toolCallId: result.toolCallId,
                });
                await persist();
                return result;
            },
            report: (message) => {
                report.errors.push(message);
                void persist();
            },
        });
        capture = new SessionCapture(
            native.sessionId,
            cwd,
            (message) => {
                report.errors.push(message);
            },
            {
                connectAgentServer: async () => connection,
                insertToolHistory: async () => {},
                insertTurnHistory: async () => {},
            },
            async () => {},
            async (result) => {
                summary = result;
                report.summary = result;
                await persist();
            },
            true,
        );
        native.on((event) => {
            if (!launcher.isAuthoringEvent(event)) capture.enqueue(event);
        });
        const author = createMacroProgramAuthor({
            inspectCapability: async (step) => ({
                id: "fixture-read",
                transport: "mcp",
                providerId: step.mcpServerName,
                operation: step.toolName,
                contractVersion: "1",
                inputSchema: readSchema,
                schemaDigest: recipeSchemaDigest(readSchema),
                compatibility: "exact",
                effect: "read",
            }),
            createFixturePlan: async (context) => {
                assert.equal(context.trace.toolCalls.length, 1);
                assert.equal(context.macro.inputs.length, 1);
                assert(!context.macro.program);
                const call = context.trace.toolCalls[0];
                assert.equal(call.arguments.path, file);
                assert.equal(call.status, "completed");
                report.hostedVerifierCalls =
                    (report.hostedVerifierCalls ?? 0) + 1;
                const inputs = context.macro.learning.exampleInputs;
                return {
                    inputSchema: {
                        type: "object",
                        properties: {
                            [context.macro.inputs[0].name]: { type: "string" },
                        },
                        required: [context.macro.inputs[0].name],
                        additionalProperties: false,
                    },
                    outputSchema: schema(call.result),
                    specification: {
                        id: "synthetic-read",
                        revision: "1",
                        intent: "Return the complete current read result unchanged",
                        outputRequirements: [
                            "Return the complete structured current tool result unchanged",
                        ],
                        rubric: "Read the supplied current path and return its exact tool result",
                        counterexamples: [
                            "Never return the recorded path or recorded contents for another file",
                        ],
                    },
                    semanticFunctions: [],
                    applicability: {
                        assumptions: [],
                        unsupported: ["Writes and synthesis"],
                    },
                    fixtures: ["observed", "independent"].map((origin) => ({
                        id: origin,
                        origin,
                        input:
                            origin === "observed"
                                ? inputs
                                : changed(inputs, "beta"),
                        calls: [
                            {
                                kind: "capability",
                                id: "fixture-read",
                                input:
                                    origin === "observed"
                                        ? call.arguments
                                        : changed(call.arguments, "beta"),
                                output:
                                    origin === "observed"
                                        ? call.result
                                        : changed(call.result, "beta"),
                            },
                        ],
                        expectedOutput:
                            origin === "observed"
                                ? call.result
                                : changed(call.result, "beta"),
                    })),
                };
            },
        });
        await manager.configureLearning(
            createMacroLearningRuntime(
                async () => {
                    throw new Error(
                        "Default/fallback author query must never run.",
                    );
                },
                () => manager.getApprovedMacros(),
                undefined,
                author,
            ),
        );
        await manager.setMacroLearningPreference({ cwd, mode: "all" });
        const token = manager.armRecording({
            sessionId: native.sessionId,
            cwd,
            learning: true,
        });
        manager.claimRecording({
            sessionId: native.sessionId,
            cwd,
            promptHash: createHash("sha256")
                .update(rootPrompt(file))
                .digest("hex"),
        });
        report.recordingTokenId = token.id;
        report.status = "root-ready";
        await persist();
    } catch (error) {
        report.status = "blocked";
        report.errors.push(String(error));
        await persist();
    }
    process.once("SIGTERM", () => {
        void worker?.close().finally(() => native?.disconnect());
    });
}

async function mcpFixture() {
    const { McpServer } = await import(
        "@modelcontextprotocol/sdk/server/mcp.js"
    );
    const { StdioServerTransport } = await import(
        "@modelcontextprotocol/sdk/server/stdio.js"
    );
    const { z } = await import("zod");
    const cwd = process.env.TYPEAGENT_B_PROGRAM_STATE;
    const server = new McpServer({ name: "checkpoint-b", version: "1.0.0" });
    server.registerTool(
        "read",
        {
            description:
                "Read only the synthetic alpha fixture and return its structured result.",
            inputSchema: { path: z.string() },
            outputSchema: { body: z.string() },
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
        },
        async ({ path: file }) => {
            assert.equal(path.resolve(file), path.join(cwd, "alpha.txt"));
            const value = { body: await readFile(file, "utf8") };
            return {
                content: [{ type: "text", text: JSON.stringify(value) }],
                structuredContent: value,
            };
        },
    );
    await server.connect(new StdioServerTransport());
}

async function run() {
    const cliPath = process.argv[2];
    const output = path.resolve(
        process.argv[3] ??
            path.join(packageRoot, "checkpoint-b-program-report.json"),
    );
    assert(
        cliPath,
        "Usage: node checkpoint-b-program-probe.mjs <copilot.exe> <report.json>",
    );
    const cwd = path.join(
        packageRoot,
        ".checkpoint-b-program-probe",
        randomUUID(),
    );
    await mkdir(cwd, { recursive: true });
    const fixture = path.join(cwd, "alpha.txt");
    await writeFile(fixture, "Synthetic ALPHA contents\n");
    const plugin = path.join(cwd, "plugin");
    const extension = path.join(plugin, "extensions", "program-probe");
    await mkdir(extension, { recursive: true });
    await writeFile(
        path.join(plugin, "plugin.json"),
        JSON.stringify({
            name: "checkpoint-b-program-probe",
            version: "1.0.0",
            description: "Bounded synthetic native program publication proof",
            extensions: "extensions/",
        }),
    );
    await writeFile(
        path.join(extension, "extension.mjs"),
        `import { joinedProbe } from ${JSON.stringify(pathToFileURL(fileURLToPath(import.meta.url)).href)};\nawait joinedProbe();\n`,
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
        TEMP: cwd,
        TMP: cwd,
        TYPEAGENT_B_PROGRAM_STATE: cwd,
        DO_NOT_TRACK: "1",
    });
    const report = {
        status: "started",
        nativePermissions: [],
        evidence:
            "actual logged-in native runtime, synthetic fixture only, unpinned model",
    };
    const client = new CopilotClient({
        connection: RuntimeConnection.forStdio({ path: cliPath, env }),
        mode: "empty",
        baseDirectory: cwd,
        workingDirectory: cwd,
        useLoggedInUser: true,
        logLevel: "none",
        builtinPluginDirectories: [plugin],
    });
    let session;
    const watchdog = setTimeout(() => {
        void client.forceStop();
    }, 240_000);
    try {
        await client.start();
        session = await client.createSession({
            requestExtensions: true,
            enableConfigDiscovery: false,
            enableSessionStore: false,
            enableFileHooks: false,
            enableSkills: false,
            enableHostGitOperations: false,
            availableTools: [
                "task",
                "mcp:*",
                "typeagent_recorded_task_succeeded",
            ],
            customAgents: [macroAuthorChildAgent],
            mcpServers: {
                "checkpoint-b": {
                    type: "local",
                    command: process.execPath,
                    args: [fileURLToPath(import.meta.url), "--mcp"],
                    env,
                    tools: ["read"],
                },
            },
            onPermissionRequest: (request) => {
                const allowed =
                    !request.managedApprovalRequired &&
                    !request.requestSandboxBypass &&
                    ((request.kind === "read" &&
                        path.resolve(request.path ?? "") === fixture) ||
                        (request.kind === "custom-tool" &&
                            request.toolName ===
                                "typeagent_recorded_task_succeeded") ||
                        (request.kind === "mcp" &&
                            request.serverName === "checkpoint-b" &&
                            request.toolName === "read"));
                report.nativePermissions.push({
                    kind: request.kind,
                    toolName: request.toolName,
                    serverName: request.serverName,
                    allowed,
                });
                return { kind: allowed ? "approve-once" : "reject" };
            },
        });
        const readyDeadline = Date.now() + 20_000;
        let joined;
        do {
            joined = await readFile(
                path.join(cwd, "joined-report.json"),
                "utf8",
            )
                .then(JSON.parse)
                .catch(() => undefined);
            if (joined?.status === "root-ready" || joined?.status === "blocked")
                break;
            await new Promise((resolve) => setTimeout(resolve, 100));
        } while (Date.now() < readyDeadline);
        assert.equal(joined?.status, "root-ready", JSON.stringify(joined));
        await session.sendAndWait({ prompt: rootPrompt(fixture) }, 60_000);
        await session.rpc.commands.invoke({ name: "checkpoint-b-program-run" });
        report.joined = await readFile(
            path.join(cwd, "joined-report.json"),
            "utf8",
        ).then(JSON.parse);
        report.status = report.joined.status;
    } catch (error) {
        report.status = "blocked";
        report.error = String(error);
        report.joined = await readFile(
            path.join(cwd, "joined-report.json"),
            "utf8",
        )
            .then(JSON.parse)
            .catch(() => undefined);
    } finally {
        await session?.disconnect().catch(() => {});
        await client.stop().catch(() => {});
        clearTimeout(watchdog);
        await writeFile(output, JSON.stringify(report, null, 2));
        console.log(
            JSON.stringify({
                status: report.status,
                output,
                error: report.error,
                joined: report.joined?.status,
                errors: report.joined?.errors,
            }),
        );
        await rm(cwd, { recursive: true, force: true });
        await rmdir(path.dirname(cwd)).catch(() => {});
    }
}

if (process.argv[2] === "--mcp") await mcpFixture();
else if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url))
    await run();
