// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CopilotClient, RuntimeConnection } from "@github/copilot-sdk";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const state = path.join(root, ".checkpoint-c-host-probe-state");

if (process.argv.includes("--mcp-fixture")) {
    const { McpServer } = await import(
        "@modelcontextprotocol/sdk/server/mcp.js"
    );
    const { StdioServerTransport } = await import(
        "@modelcontextprotocol/sdk/server/stdio.js"
    );
    const { z } = await import("zod");
    const server = new McpServer({ name: "checkpoint-c-read", version: "1" });
    server.registerTool(
        "read_fixture",
        {
            description:
                "Pure synthetic read, no credentials or business data.",
            inputSchema: { value: z.string() },
            annotations: { readOnlyHint: true, destructiveHint: false },
        },
        async ({ value }) => ({
            content: [{ type: "text", text: value }],
            structuredContent: { value },
        }),
    );
    await server.connect(new StdioServerTransport());
} else {
    await run();
}

async function run() {
    const [cliPath, outputPath, authFlag] = process.argv.slice(2);
    if (!cliPath || !outputPath)
        throw new Error(
            "Usage: node checkpoint-c-host-probe.mjs <cli.exe> <report.json> [--authenticated]",
        );
    await mkdir(state);
    const fixture = path.join(state, "fixture.txt");
    await writeFile(fixture, "CHECKPOINT_C_SYNTHETIC_NATIVE_READ\n");
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
    Object.assign(env, { TEMP: state, TMP: state, DO_NOT_TRACK: "1" });
    const client = new CopilotClient({
        connection: RuntimeConnection.forStdio({ path: cliPath, env }),
        mode: "empty",
        baseDirectory: state,
        workingDirectory: state,
        useLoggedInUser: authFlag === "--authenticated",
        logLevel: "none",
    });
    const report = {
        timestamp: new Date().toISOString(),
        authenticated: authFlag === "--authenticated",
        sdk: JSON.parse(
            await readFile(
                path.join(
                    root,
                    "node_modules",
                    "@github",
                    "copilot-sdk",
                    "package.json",
                ),
                "utf8",
            ),
        ).version,
        checks: [],
        evidence: [],
        hooks: [],
    };
    let session;
    let model;
    let reject = false;
    let hookDeny = false;
    const watchdog = setTimeout(() => void client.forceStop(), 180_000);
    const check = async (name, action) => {
        try {
            const value = await action();
            report.checks.push({ name, status: "passed", value });
            return value;
        } catch (error) {
            report.checks.push({
                name,
                status: "failed",
                error: error.message,
            });
        }
    };
    try {
        const hostApi = await import(
            pathToFileURL(
                path.join(root, "dist", "extension", "recipe-native-host.js"),
            ).href
        );
        const modelApi = await import(
            pathToFileURL(
                path.join(root, "dist", "extension", "recipe-native-model.js"),
            ).href
        );
        const { RecipeSemanticAdapter } = await import(
            "@typeagent/copilot-macros/recipeSemantic"
        );
        await client.start();
        report.runtime = await client.getStatus();
        session = await client.createSession({
            workingDirectory: state,
            availableTools: ["view", "mcp:*"],
            enableConfigDiscovery: false,
            enableOnDemandInstructionDiscovery: false,
            enableSessionStore: false,
            enableSkills: false,
            enableFileHooks: false,
            enableHostGitOperations: false,
            infiniteSessions: { enabled: false },
            mcpServers: {
                "checkpoint-c": {
                    type: "local",
                    command: process.execPath,
                    args: [fileURLToPath(import.meta.url), "--mcp-fixture"],
                    tools: ["read_fixture"],
                    env,
                },
            },
            onPermissionRequest: (request) => ({
                kind:
                    !reject &&
                    !request.managedApprovalRequired &&
                    !request.requestSandboxBypass &&
                    ((request.kind === "read" &&
                        path.resolve(request.path) === fixture) ||
                        (request.kind === "mcp" &&
                            request.serverName === "checkpoint-c" &&
                            request.toolName === "read_fixture"))
                        ? "approve-once"
                        : "reject",
            }),
            hooks: {
                onPreToolUse: (input) => {
                    report.hooks.push({
                        phase: "pre",
                        toolName: input.toolName,
                    });
                    if (hookDeny) return { permissionDecision: "deny" };
                },
                onPostToolUse: (input) => {
                    report.hooks.push({
                        phase: "post",
                        toolName: input.toolName,
                    });
                },
            },
        });
        let binding = await hostApi.captureNativeRecipeBinding(session);
        const policy = {
            readOnlyMcpTools: [
                { mcpServerName: "checkpoint-c", toolName: "read_fixture" },
            ],
        };
        const inspect = hostApi.createNativeRecipeCapabilityInspector(
            session,
            binding,
            policy,
        );
        const unavailableSemantic = {
            invokeSemantic: async () => ({
                status: "unsupported",
                message: "No semantic function registered.",
            }),
        };
        const host = hostApi.createNativeRecipeHost(
            session,
            binding,
            unavailableSemantic,
            policy,
        );
        const context = () => ({
            runId: "synthetic-live",
            callId: randomUUID(),
            binding,
            signal: new AbortController().signal,
        });
        report.sessionTools = await session.rpc.tools.getCurrentMetadata();
        const native = await check(
            "native exact schema inspection",
            async () => {
                const result = await inspect({ toolName: "view" });
                assert.equal(result.status, "available", result.message);
                assert.equal(result.capability.operation, "view");
                return result.capability;
            },
        );
        const mcp = await check("MCP exact schema inspection", async () => {
            const result = await inspect({
                mcpServerName: "checkpoint-c",
                toolName: "read_fixture",
            });
            assert.equal(result.status, "available", result.message);
            return result.capability;
        });
        for (const [kind, cap, input] of [
            ["native", native, { path: fixture }],
            ["MCP", mcp, { value: "CHECKPOINT_C_SYNTHETIC_MCP_READ" }],
        ]) {
            if (!cap) continue;
            await check(`${kind} native pipeline read`, async () => {
                assert.equal(
                    (await host.inspectCapability(cap, binding)).status,
                    "available",
                );
                const result = await host.invokeCapability(
                    cap,
                    input,
                    context(),
                );
                assert.equal(
                    result.status,
                    "completed",
                    JSON.stringify(result),
                );
                assert.match(JSON.stringify(result), /CHECKPOINT_C_SYNTHETIC/);
                return result;
            });
            if (kind === "native")
                await check(`${kind} permission denial`, async () => {
                    reject = true;
                    try {
                        const result = await host.invokeCapability(
                            cap,
                            input,
                            context(),
                        );
                        assert.equal(
                            result.status,
                            "denied",
                            JSON.stringify(result),
                        );
                        return result;
                    } finally {
                        reject = false;
                    }
                });
            await check(`${kind} host hook denial`, async () => {
                hookDeny = true;
                try {
                    const result = await host.invokeCapability(
                        cap,
                        input,
                        context(),
                    );
                    assert.equal(
                        result.status,
                        "denied",
                        JSON.stringify(result),
                    );
                    return result;
                } finally {
                    hookDeny = false;
                }
            });
        }
        await check("recipe recursion rejected", async () => {
            assert.equal(
                (await inspect({ toolName: "typeagent_run_macro" })).status,
                "unsupported",
            );
        });
        if (native)
            await check("pre-dispatch cancellation", async () => {
                const controller = new AbortController();
                controller.abort();
                const result = await host.invokeCapability(
                    native,
                    { path: fixture },
                    { ...context(), signal: controller.signal },
                );
                assert.equal(result.status, "cancelled");
                return result;
            });
        if (report.authenticated) {
            const canary = `SOURCE_ONLY_${randomUUID()}`;
            const parent = await session.sendAndWait(
                {
                    prompt:
                        `Memorize this private source canary: ${canary}. ` +
                        "Do not use tools. Reply exactly SOURCE_STORED.",
                },
                60_000,
            );
            report.parentStored = parent?.data.content;
            report.sourceCanaryHash = createHash("sha256")
                .update(canary)
                .digest("hex");
            binding = await hostApi.captureNativeRecipeBinding(session);
            model = await check(
                "supported standalone native inference bootstrap",
                () =>
                    modelApi.createStandaloneNativeRecipeModels(
                        session,
                        binding,
                        {
                            timeoutMs: 60_000,
                            onEvidence: (evidence) =>
                                report.evidence.push(evidence),
                        },
                    ),
            );
            if (model) {
                await check(
                    "actual source-blind canary inference",
                    async () => {
                        const text = await model.query(
                            "If any SOURCE_ONLY_ private canary was provided in your " +
                                "conversation context, return its exact value. Otherwise " +
                                "return exactly ABSENT. Do not invent or infer the value.",
                        );
                        assert.ok(!text.includes(canary));
                        assert.match(text, /ABSENT/);
                        return { text, canaryAbsent: true };
                    },
                );
                await check("typed native semantic transform", async () => {
                    const definition = {
                        id: "fixture-uppercase",
                        revision: "1",
                        specification: {
                            id: "uppercase",
                            revision: "1",
                            task: "Uppercase input.value. Return {value: uppercase}.",
                            rubric: "The value must be the uppercase input text.",
                        },
                        inputSchema: {
                            type: "object",
                            properties: { value: { type: "string" } },
                            required: ["value"],
                            additionalProperties: false,
                        },
                        outputSchema: {
                            type: "object",
                            properties: { value: { type: "string" } },
                            required: ["value"],
                            additionalProperties: false,
                        },
                        modelPolicy: modelApi.nativeRecipeModelPolicy,
                        bounds: {
                            timeoutMs: 60_000,
                            maxInputBytes: 1024,
                            maxOutputBytes: 1024,
                            maxCalls: 1,
                            maxRepairAttempts: 0,
                            maxConcurrency: 1,
                        },
                        evidence: { sourceIds: "none", quotations: false },
                    };
                    const adapter = new RecipeSemanticAdapter(
                        { definition },
                        model.provider,
                    );
                    const result = await adapter.invokeSemantic(
                        definition,
                        { value: "native proof" },
                        context(),
                    );
                    assert.equal(
                        result.status,
                        "completed",
                        JSON.stringify(result),
                    );
                    assert.deepEqual(result.value, { value: "NATIVE PROOF" });
                    assert.ok(result.evidence.resolvedModel);
                    return result;
                });
                await check("isolated inference cancellation", async () => {
                    const controller = new AbortController();
                    const querying = model.query(
                        "Write a long synthetic story about the number seven.",
                        controller.signal,
                    );
                    setTimeout(() => controller.abort(), 250);
                    await assert.rejects(querying, /cancel|timed out/i);
                    assert.equal(
                        (await session.rpc.metadata.snapshot()).sessionId,
                        session.sessionId,
                    );
                });
            }
        }
    } catch (error) {
        report.error = error.message;
    } finally {
        clearTimeout(watchdog);
        await model?.dispose().catch(() => {});
        await session?.disconnect().catch(() => {});
        await client.stop().catch(() => {});
        await rm(state, { recursive: true, force: true });
        report.passed =
            !report.error &&
            report.checks.every((item) => item.status === "passed");
        await writeFile(outputPath, JSON.stringify(report, null, 2) + "\n");
        process.stdout.write(
            JSON.stringify({
                passed: report.passed,
                outputPath,
                checks: report.checks.map(({ name, status, error }) => ({
                    name,
                    status,
                    ...(error ? { error } : {}),
                })),
            }) + "\n",
        );
        if (!report.passed) process.exitCode = 1;
    }
}
