// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CopilotClient, RuntimeConnection } from "@github/copilot-sdk";
import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// This probes the installed runtime, not a mocked transport or model provider.
const packageRoot = fileURLToPath(new URL("../..", import.meta.url));
const state = path.join(packageRoot, ".host-capability-probe-state");
const cliPath = process.argv[2];
const outputPath = process.argv[3];
if (!cliPath || !outputPath) {
    throw new Error(
        "Usage: node host-capability-probe.mjs <cli.exe> <report.json>",
    );
}
const sdk = JSON.parse(
    await readFile(
        path.join(packageRoot, "node_modules/@github/copilot-sdk/package.json"),
        "utf8",
    ),
);
await mkdir(state);
const pluginDirectory = path.join(state, "joined-probe-plugin");
const extensionDirectory = path.join(
    pluginDirectory,
    "extensions",
    "host-capability",
);
await mkdir(extensionDirectory, { recursive: true });
await writeFile(
    path.join(pluginDirectory, "plugin.json"),
    JSON.stringify({
        name: "host-capability-probe",
        version: "1.0.0",
        description: "Disposable local P0 host probe",
        extensions: "extensions/",
    }),
);
await writeFile(
    path.join(extensionDirectory, "extension.mjs"),
    `import { startJoinedProbe } from ${JSON.stringify(pathToFileURL(path.join(packageRoot, "scripts/test/host-capability-mcp.mjs")).href)};\nawait startJoinedProbe();\n`,
);
const environment = {};
for (const key of ["SystemRoot", "WINDIR", "COMSPEC", "PATH", "PATHEXT"]) {
    if (process.env[key]) environment[key] = process.env[key];
}
Object.assign(environment, {
    HOME: state,
    USERPROFILE: state,
    APPDATA: state,
    LOCALAPPDATA: state,
    TEMP: state,
    TMP: state,
    COPILOT_HOME: state,
    DO_NOT_TRACK: "1",
});
const client = new CopilotClient({
    connection: RuntimeConnection.forStdio({
        path: cliPath,
        env: environment,
    }),
    mode: "empty",
    baseDirectory: state,
    workingDirectory: state,
    useLoggedInUser: false,
    logLevel: "none",
    builtinPluginDirectories: [pluginDirectory],
});
const report = {
    evidence: "installed-runtime-no-auth-no-model",
    timestamp: new Date().toISOString(),
    node: process.version,
    cliPath,
    sdkVersion: sdk.version,
    sdkTargetCliVersion: sdk.copilotCliVersion,
    probes: [],
    counters: { toolHandler: 0, commandHandler: 0, permissions: 0 },
    events: [],
    hooks: [],
    checks: [],
};
let permissionDecision = "reject";
let hookDenial = false;
let toolStarted;
let signalAborted = false;
async function probe(name, action) {
    const started = performance.now();
    try {
        const value = await action();
        report.probes.push({
            name,
            status: "returned",
            elapsedMs: Math.round(performance.now() - started),
            value,
        });
        return value;
    } catch (error) {
        report.probes.push({
            name,
            status: "rejected",
            elapsedMs: Math.round(performance.now() - started),
            error: { code: error.code, message: error.message },
        });
    }
}
const watchdog = setTimeout(() => {
    report.deadlineExceeded = true;
    void client.forceStop();
}, 45_000);
let session;
try {
    await client.start();
    await probe("runtime.status", () => client.getStatus());
    await probe("server.tools.list", async () => {
        const result = await client.rpc.tools.list({});
        return { names: result.tools.map((tool) => tool.name) };
    });
    const readPath = path.join(state, "host-capability-read.txt");
    await writeFile(readPath, "HOST_CAPABILITY_NATIVE_FRESH_OUTPUT\n");
    session = await probe("session.create", () =>
        client.createSession({
            availableTools: [
                "view",
                "host_capability_echo",
                "host_capability_joined_probe",
                "mcp:*",
            ],
            requestExtensions: true,
            enableConfigDiscovery: false,
            enableSessionStore: false,
            enableFileHooks: false,
            enableSkills: false,
            enableHostGitOperations: false,
            mcpServers: {
                "host-capability": {
                    type: "local",
                    command: process.execPath,
                    args: [
                        path.join(
                            packageRoot,
                            "scripts/test/host-capability-mcp.mjs",
                        ),
                    ],
                    tools: ["*"],
                    env: environment,
                },
            },
            customAgents: [
                {
                    name: "host-capability-author",
                    prompt: "Inspect only explicitly supplied context.",
                    tools: ["host_capability_echo"],
                },
            ],
            tools: [
                {
                    name: "host_capability_echo",
                    description: "Pure local echo for host API probing.",
                    parameters: {
                        type: "object",
                        properties: { value: { type: "string" } },
                        required: ["value"],
                    },
                    handler: async ({ value }, invocation) => {
                        report.counters.toolHandler++;
                        if (value === "HOST_CAPABILITY_CANCEL") {
                            toolStarted?.();
                            await new Promise((resolve) => {
                                const timeout = setTimeout(resolve, 1500);
                                invocation.signal?.addEventListener(
                                    "abort",
                                    () => {
                                        signalAborted = true;
                                        clearTimeout(timeout);
                                        resolve();
                                    },
                                    { once: true },
                                );
                            });
                        }
                        return {
                            textResultForLlm: value,
                            resultType: "success",
                        };
                    },
                },
            ],
            commands: [
                {
                    name: "host-capability-output",
                    handler: async () => {
                        report.counters.commandHandler++;
                        await session.log("HOST_CAPABILITY_EXACT_OUTPUT");
                    },
                },
            ],
            onPermissionRequest: () => {
                report.counters.permissions++;
                return { kind: permissionDecision };
            },
            hooks: {
                onPreToolUse: (input) => {
                    report.hooks.push({ phase: "pre", name: input.toolName });
                    if (hookDenial) {
                        return {
                            permissionDecision: "deny",
                            permissionDecisionReason:
                                "HOST_CAPABILITY_HOOK_DENIED",
                        };
                    }
                },
                onPostToolUse: (input) => {
                    report.hooks.push({ phase: "post", name: input.toolName });
                },
                onPostToolUseFailure: (input) => {
                    report.hooks.push({
                        phase: "failure",
                        name: input.toolName,
                    });
                },
            },
        }),
    );
    // Do not serialize the SDK object, connection, or session context.
    const created = report.probes.find(
        (item) => item.name === "session.create",
    );
    if (session) created.value = { created: true };
    if (session) {
        session.on((event) => {
            if (
                event.type.startsWith("assistant.") ||
                event.type === "session.info" ||
                event.type === "session.shutdown"
            ) {
                report.events.push({ type: event.type, data: event.data });
            }
        });
        await probe("session.agent.list", () => session.rpc.agent.list());
        await probe("session.sandbox.getEnforcementStatus", () =>
            session.rpc.sandbox.getEnforcementStatus(),
        );
        await probe("session.extensions.list", () =>
            session.rpc.extensions.list(),
        );
        await probe("session.tools.initializeAndValidate", () =>
            session.rpc.tools.initializeAndValidate(),
        );
        await probe("session.tools.getCurrentMetadata", () =>
            session.rpc.tools.getCurrentMetadata(),
        );
        await probe("session.tools.execute.custom.denied", () =>
            session.rpc.tools.execute({
                name: "host_capability_echo",
                arguments: { value: "HOST_CAPABILITY_FRESH_VALUE" },
            }),
        );
        await probe("session.tools.execute.native.denied", () =>
            session.rpc.tools.execute({
                name: "view",
                arguments: { path: readPath },
            }),
        );
        const metadata = await session.rpc.tools.getCurrentMetadata();
        const mcp = metadata.tools.find(
            (tool) =>
                tool.mcpServerName === "host-capability" &&
                tool.mcpToolName === "echo",
        );
        assert.ok(mcp, "The host must connect the local MCP fixture.");
        await probe("session.tools.execute.mcp.permission-policy", () =>
            session.rpc.tools.execute({
                name: mcp.name,
                arguments: {
                    value: "HOST_CAPABILITY_MCP_READONLY_HOST_POLICY",
                },
            }),
        );
        permissionDecision = "approve-once";
        await probe("session.tools.execute.joined-extension", () =>
            session.rpc.tools.execute({
                name: "host_capability_joined_probe",
                arguments: { path: readPath },
            }),
        );
        await probe("session.tools.execute.native.allowed", () =>
            session.rpc.tools.execute({
                name: "view",
                arguments: { path: readPath },
            }),
        );
        await probe("session.tools.execute.custom.allowed", () =>
            session.rpc.tools.execute({
                name: "host_capability_echo",
                arguments: { value: "HOST_CAPABILITY_FRESH_VALUE" },
            }),
        );
        hookDenial = true;
        await probe("session.tools.execute.custom.hook-denied", () =>
            session.rpc.tools.execute({
                name: "host_capability_echo",
                arguments: { value: "HOST_CAPABILITY_MUST_NOT_EXECUTE" },
            }),
        );
        hookDenial = false;
        await probe("session.tools.execute.mcp.allowed", () =>
            session.rpc.tools.execute({
                name: mcp.name,
                arguments: { value: "HOST_CAPABILITY_MCP_FRESH_OUTPUT" },
            }),
        );
        hookDenial = true;
        await probe("session.tools.execute.mcp.hook-denied", () =>
            session.rpc.tools.execute({
                name: mcp.name,
                arguments: {
                    value: "HOST_CAPABILITY_MCP_HOOK_MUST_NOT_EXECUTE",
                },
            }),
        );
        hookDenial = false;
        const started = new Promise((resolve) => {
            toolStarted = resolve;
        });
        const cancellation = probe("session.tools.execute.custom.cancel", () =>
            session.rpc.tools.execute({
                name: "host_capability_echo",
                arguments: { value: "HOST_CAPABILITY_CANCEL" },
            }),
        );
        await Promise.race([
            started,
            new Promise((_, reject) => {
                const timer = setTimeout(
                    () => reject(new Error("Cancellation tool did not start.")),
                    3000,
                );
                timer.unref();
            }),
        ]);
        await probe("session.abort", () => session.abort());
        await cancellation;
        await new Promise((resolve) => setTimeout(resolve, 100));
        report.cancelSignalObserved = signalAborted;
        await probe("session.commands.invoke", () =>
            session.rpc.commands.invoke({ name: "host-capability-output" }),
        );
    }
} catch (error) {
    report.startupError = { code: error.code, message: error.message };
} finally {
    if (session) await session.disconnect().catch(() => {});
    const errors = await client.stop();
    report.shutdownErrors = errors.map((error) => error.message);
    clearTimeout(watchdog);
    await rm(state, { recursive: true, force: true });
    const result = (name) => {
        const entry = report.probes.find((item) => item.name === name);
        assert.equal(entry?.status, "returned", name);
        return entry.value;
    };
    const check = (name, action) => {
        try {
            action();
            report.checks.push({ name, passed: true });
        } catch (error) {
            report.checks.push({ name, passed: false, error: error.message });
            process.exitCode = 1;
        }
    };
    check("native exact output", () =>
        assert.equal(
            result("session.tools.execute.native.allowed").textResultForLlm,
            "HOST_CAPABILITY_NATIVE_FRESH_OUTPUT\n",
        ),
    );
    check("joined extension native and MCP parity", () => {
        const joined = result("session.tools.execute.joined-extension");
        assert.equal(joined.resultType, "success");
        const value = JSON.parse(joined.textResultForLlm);
        assert.equal(value.sessionMatches, true);
        assert.equal(value.native.resultType, "success");
        assert.equal(
            value.native.textResultForLlm,
            "HOST_CAPABILITY_NATIVE_FRESH_OUTPUT\n",
        );
        assert.equal(value.mcp.resultType, "success");
        assert.deepEqual(value.mcp.structuredContent, {
            value: "HOST_CAPABILITY_JOINED_MCP_OUTPUT",
        });
        report.joinedExtensionPid = value.pid;
        report.joinedExtensionParentPid = value.parentPid;
    });
    check("joined extension and parent process cleanup", () => {
        assert.ok(report.joinedExtensionPid);
        for (const pid of [
            report.joinedExtensionPid,
            report.joinedExtensionParentPid,
        ]) {
            assert.throws(
                () => process.kill(pid, 0),
                (error) => error.code === "ESRCH",
                `Owned process ${pid} must have exited`,
            );
        }
    });
    check("custom exact output", () =>
        assert.equal(
            result("session.tools.execute.custom.allowed").textResultForLlm,
            "HOST_CAPABILITY_FRESH_VALUE",
        ),
    );
    check("MCP structured output", () =>
        assert.deepEqual(
            result("session.tools.execute.mcp.allowed").structuredContent,
            { value: "HOST_CAPABILITY_MCP_FRESH_OUTPUT" },
        ),
    );
    check("native custom permission rejection", () => {
        for (const kind of ["native", "custom"]) {
            assert.equal(
                result(`session.tools.execute.${kind}.denied`).resultType,
                "rejected",
            );
        }
    });
    check("pre-tool hook denial", () => {
        assert.equal(
            result("session.tools.execute.custom.hook-denied").resultType,
            "denied",
        );
        assert.equal(report.counters.toolHandler, 2);
        assert.equal(
            result("session.tools.execute.mcp.hook-denied").resultType,
            "denied",
        );
    });
    check("direct invocation cancellation", () => {
        const cancelled = report.probes.find(
            (item) => item.name === "session.tools.execute.custom.cancel",
        );
        assert.equal(cancelled?.status, "rejected");
        assert.match(cancelled.error.message, /Tool execution was aborted/);
    });
    check("command exact notification and completion", () => {
        assert.equal(result("session.commands.invoke").kind, "completed");
        assert.equal(report.counters.commandHandler, 1);
        assert.ok(
            report.events.some(
                (event) =>
                    event.type === "session.info" &&
                    event.data.message === "HOST_CAPABILITY_EXACT_OUTPUT",
            ),
        );
    });
    check("shutdown zero model usage", () => {
        const shutdown = report.events.find(
            (event) => event.type === "session.shutdown",
        );
        assert.ok(shutdown);
        assert.deepEqual(shutdown.data.modelMetrics, {});
        assert.equal(shutdown.data.totalApiDurationMs, 0);
        assert.equal(shutdown.data.conversationTokens, 0);
        assert.equal(
            report.events.filter((event) => event.type.startsWith("assistant."))
                .length,
            0,
        );
        assert.deepEqual(report.shutdownErrors, []);
        assert.equal(report.deadlineExceeded, undefined);
    });
    await writeFile(outputPath, JSON.stringify(report, null, 2) + "\n");
    process.stdout.write(
        JSON.stringify({
            probes: report.probes.map(({ name, status, error }) => ({
                name,
                status,
                error,
            })),
            counters: report.counters,
            startupError: report.startupError,
            shutdownErrors: report.shutdownErrors,
            checks: report.checks,
        }) + "\n",
    );
}
