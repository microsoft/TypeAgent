// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    ActionContext,
    SessionContext,
    Storage,
    TokenCachePersistence,
} from "@typeagent/agent-sdk";
import { AppAgentEvent } from "@typeagent/agent-sdk";
import { jest } from "@jest/globals";
import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
    mkdir,
    mkdtemp,
    readFile,
    realpath,
    rm,
    writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { instantiate } from "../src/actionHandler.mjs";
import type { PowerShellFlowDefinition } from "../src/store/powerShellStore.mjs";
import {
    executeScript,
    executeReviewedStaticScript,
    type ScriptExecutionRequest,
} from "../src/execution/powershellRunner.mjs";
import {
    getRegisteredNamespaceActions,
    hasNamespaceAction,
} from "../src/namespaces/actionHandlerRegistry.mjs";
import { revokeScriptApprovals } from "../src/execution/scriptApproval.mjs";
import { copyBrokerWithTestHost } from "./sandboxCases.js";

const itOnWindows =
    process.platform === "win32" &&
    process.env.TYPEAGENT_SKIP_POWERSHELL_BROKER_TESTS !== "1"
        ? it
        : it.skip;

class MemoryStorage implements Storage {
    private readonly files = new Map<string, string>();
    private readonly writeFailures = new Map<
        string,
        { remainingWrites: number; error: Error }
    >();
    private readonly writeBlocks = new Map<
        string,
        {
            started: () => void;
            waitForRelease: Promise<void>;
        }
    >();
    private readonly afterWriteCallbacks = new Map<
        string,
        () => void | Promise<void>
    >();

    failWriteAfter(path: string, remainingWrites: number, error: Error): void {
        this.writeFailures.set(path, { remainingWrites, error });
    }

    blockNextWrite(path: string): {
        started: Promise<void>;
        release: () => void;
    } {
        let markStarted: () => void;
        let release: () => void;
        const started = new Promise<void>((resolve) => {
            markStarted = resolve;
        });
        const waitForRelease = new Promise<void>((resolve) => {
            release = resolve;
        });
        this.writeBlocks.set(path, {
            started: () => markStarted!(),
            waitForRelease,
        });
        return {
            started,
            release: () => release!(),
        };
    }

    afterNextWrite(path: string, callback: () => void | Promise<void>): void {
        this.afterWriteCallbacks.set(path, callback);
    }

    async read(path: string): Promise<Uint8Array>;
    async read(path: string, options: "utf8" | "base64"): Promise<string>;
    async read(
        path: string,
        options?: "utf8" | "base64",
    ): Promise<Uint8Array | string> {
        const value = this.files.get(path);
        if (value === undefined) {
            throw new Error(`File not found: ${path}`);
        }
        return options ? value : new TextEncoder().encode(value);
    }

    async write(path: string, data: string | Uint8Array): Promise<void> {
        const block = this.writeBlocks.get(path);
        if (block) {
            this.writeBlocks.delete(path);
            block.started();
            await block.waitForRelease;
        }
        const failure = this.writeFailures.get(path);
        if (failure) {
            if (failure.remainingWrites === 0) {
                this.writeFailures.delete(path);
                throw failure.error;
            }
            failure.remainingWrites--;
        }
        this.files.set(
            path,
            typeof data === "string" ? data : new TextDecoder().decode(data),
        );
        const afterWrite = this.afterWriteCallbacks.get(path);
        if (afterWrite) {
            this.afterWriteCallbacks.delete(path);
            await afterWrite();
        }
    }

    async delete(path: string): Promise<void> {
        this.files.delete(path);
    }

    async exists(path: string): Promise<boolean> {
        return (
            this.files.has(path) ||
            [...this.files.keys()].some((key) => key.startsWith(`${path}/`))
        );
    }

    async list(path: string): Promise<string[]> {
        const prefix = path.endsWith("/") ? path : `${path}/`;
        const entries = new Set<string>();
        for (const filePath of this.files.keys()) {
            if (!filePath.startsWith(prefix)) continue;
            const relative = filePath.slice(prefix.length);
            entries.add(relative.split("/")[0]);
        }
        return [...entries];
    }

    async getTokenCachePersistence(): Promise<TokenCachePersistence> {
        return {
            load: async () => null,
            save: async () => {},
            delete: async () => true,
        };
    }
}

function createSessionContext(
    storage: Storage,
    reloadAgentSchema: () => Promise<void> = jest.fn(async () => {}),
    popupQuestion: SessionContext["popupQuestion"] = async (
        _message,
        choices,
    ) => (choices?.[0] === "Run once" ? 0 : 1),
): SessionContext {
    return {
        agentContext: {},
        sessionStorage: storage,
        instanceStorage: storage,
        sessionContextId: randomUUID(),
        currentConnectionId: "powershell-test-client",
        notify: jest.fn(),
        beginAgentThread: jest.fn(),
        popupQuestion,
        requestSecurityApproval: ({
            message,
            choices,
            defaultId,
        }: import("@typeagent/agent-sdk").SecurityApprovalRequest) =>
            popupQuestion(message, choices, defaultId),
        toggleTransientAgent: jest.fn(),
        addDynamicAgent: jest.fn(),
        removeDynamicAgent: jest.fn(),
        forceCleanupDynamicAgent: jest.fn(),
        reloadAgentSchema,
        notifyReadinessChanged: jest.fn(),
        notifyClientCountChanged: jest.fn(),
        registerPort: jest.fn(),
        unregisterPort: jest.fn(),
        validateGrammarPatterns: jest.fn(),
    } as unknown as SessionContext;
}

function createActionContext(
    sessionContext: SessionContext,
    abortSignal?: AbortSignal,
): ActionContext<unknown> {
    return {
        streamingContext: undefined,
        activityContext: undefined,
        actionIO: {
            setDisplay: jest.fn(),
            appendDiagnosticData: jest.fn(),
            appendDisplay: jest.fn(),
            takeAction: jest.fn(),
        },
        sessionContext,
        abortSignal,
        isFromReasoningLoop: true,
        executionOrigin: "direct-user",
        queueToggleTransientAgent: async () => {},
    };
}

async function createAgentHarness(
    reloadAgentSchema?: () => Promise<void>,
    abortSignal?: AbortSignal,
    storage = new MemoryStorage(),
    popupQuestion?: SessionContext["popupQuestion"],
) {
    const sessionContext = createSessionContext(
        storage,
        reloadAgentSchema,
        popupQuestion,
    );
    const agent = instantiate();
    await agent.initializeAgentContext?.();
    await agent.updateAgentContext?.(true, sessionContext, "powershell");
    return {
        agent,
        storage,
        sessionContext,
        context: createActionContext(sessionContext, abortSignal),
    };
}

function expectPolicyDenied(result: unknown): void {
    expect(result).toMatchObject({
        errorCode: "powershell.policyDenied",
        retryable: false,
        fallbackToReasoning: false,
    });
}

async function createStoredFlow(
    agent: ReturnType<typeof instantiate>,
    context: ActionContext<unknown>,
    actionName: string,
): Promise<void> {
    const result = await agent.executeAction?.(
        {
            schemaName: "powershell",
            actionName: "createPowerShellFlow",
            parameters: {
                actionName,
                description: "A stored flow used by containment tests",
                script: "Write-Output 'stored'",
                allowedCmdlets: ["Write-Output"],
            },
        },
        context,
    );
    expect(result).not.toHaveProperty("error");
}

describe("createAndExecutePowerShellFlow", () => {
    const originalNoSamples = process.env.TYPEAGENT_NO_SAMPLES;
    const originalConfigDir = process.env.TYPEAGENT_CONFIG_DIR;
    let configDirectory: string;
    let localConfigPath: string;

    async function setDynamicExecution(enabled: boolean): Promise<void> {
        await writeFile(
            localConfigPath,
            `powershell:\n  dynamicExecution:\n    enabled: ${enabled}\n  brokerExecution:\n    enabled: ${enabled}\n`,
        );
    }

    async function withDynamicExecutionDisabled(
        action: () => Promise<void>,
    ): Promise<void> {
        await setDynamicExecution(false);
        try {
            await action();
        } finally {
            await setDynamicExecution(true);
        }
    }

    beforeAll(async () => {
        process.env.TYPEAGENT_NO_SAMPLES = "1";
        configDirectory = await mkdtemp(
            join(tmpdir(), "typeagent-powershell-config-"),
        );
        localConfigPath = join(configDirectory, "config.local.yaml");
        process.env.TYPEAGENT_CONFIG_DIR = configDirectory;
        await setDynamicExecution(true);
    });

    describe("static network actions", () => {
        it("does not intercept a root flow with the same action name", async () => {
            const { agent, context } = await createAgentHarness();

            const result = await agent.executeAction?.(
                {
                    schemaName: "powershell",
                    actionName: "portListeners",
                    parameters: {},
                },
                context,
            );

            expect(result).toMatchObject({
                error: expect.stringContaining(
                    "Unknown PowerShell flow 'portListeners'",
                ),
                errorCode: "powershell.unknownFlow",
                retryable: true,
            });
        });
    });

    describe("static namespace coverage", () => {
        it("does not fall back to ordinary questions when security approval is unavailable", async () => {
            const popup = jest.fn(async () => 0);
            const { agent, context } = await createAgentHarness(
                undefined,
                undefined,
                undefined,
                popup,
            );
            context.sessionContext.requestSecurityApproval = async () => {
                throw new Error("No trusted UI");
            };
            const result = await agent.executeAction?.(
                {
                    schemaName: "powershell.powershell-files",
                    actionName: "writeFile",
                    parameters: {
                        path: "C:\\must-not-write.txt",
                        content: "not authorized",
                    },
                },
                context,
            );
            expect(result).toMatchObject({
                errorCode: "powershell.policyDenied",
                retryable: false,
            });
            expect(popup).not.toHaveBeenCalled();
        });

        it("registers exactly the namespaces declared by the manifest", () => {
            const manifest = JSON.parse(
                readFileSync(
                    join(process.cwd(), "src", "manifest.json"),
                    "utf8",
                ),
            ) as { subActionManifests: Record<string, unknown> };
            const manifestSchemas = Object.keys(manifest.subActionManifests)
                .map((name) => `powershell.${name}`)
                .sort();
            const registeredSchemas = [
                ...getRegisteredNamespaceActions().keys(),
            ].sort();

            expect(registeredSchemas).toEqual(manifestSchemas);
            expect(
                hasNamespaceAction(
                    "powershell.powershell-network",
                    "portListeners",
                ),
            ).toBe(true);
        });

        itOnWindows("executes a read-only system action", async () => {
            const { agent, context } = await createAgentHarness();

            const result = await agent.executeAction?.(
                {
                    schemaName: "powershell.powershell-system",
                    actionName: "envVars",
                    parameters: { name: "TEMP" },
                },
                context,
            );

            expect(result).not.toHaveProperty("error");
        });

        itOnWindows.each([
            ["powershell.powershell-processes", "listProcesses", { topN: 1 }],
            ["powershell.powershell-services", "listServices", {}],
        ])(
            "executes a read-only %s action",
            async (schemaName, actionName, parameters) => {
                const { agent, context } = await createAgentHarness();

                const result = await agent.executeAction?.(
                    { schemaName, actionName, parameters },
                    context,
                );

                expect(result).not.toHaveProperty("error");
            },
        );

        itOnWindows("executes file, data, and archive actions", async () => {
            const directory = await mkdtemp(
                join(tmpdir(), "typeagent-powershell-static-"),
            );
            const textPath = join(directory, "sample.txt");
            const jsonPath = join(directory, "sample.json");
            const archivePath = join(directory, "sample.zip");
            const extractPath = join(directory, "extracted");
            try {
                await writeFile(textPath, "sample text");
                await writeFile(jsonPath, JSON.stringify({ value: "sample" }));
                const approve = jest.fn(async () => 0);
                const { agent, context } = await createAgentHarness(
                    undefined,
                    undefined,
                    undefined,
                    approve,
                );

                const readText = await agent.executeAction?.(
                    {
                        schemaName: "powershell.powershell-files",
                        actionName: "readFile",
                        parameters: { path: textPath },
                    },
                    context,
                );
                const readJson = await agent.executeAction?.(
                    {
                        schemaName: "powershell.powershell-data",
                        actionName: "readJson",
                        parameters: { path: jsonPath },
                    },
                    context,
                );
                const compress = await agent.executeAction?.(
                    {
                        schemaName: "powershell.powershell-archives",
                        actionName: "compress",
                        parameters: {
                            sourcePath: textPath,
                            destinationPath: archivePath,
                        },
                    },
                    context,
                );
                const expand = await agent.executeAction?.(
                    {
                        schemaName: "powershell.powershell-archives",
                        actionName: "expand",
                        parameters: {
                            archivePath,
                            destinationPath: extractPath,
                        },
                    },
                    context,
                );

                expect(readText).not.toHaveProperty("error");
                expect(readJson).not.toHaveProperty("error");
                expect(compress).not.toHaveProperty("error");
                expect(expand).not.toHaveProperty("error");
                expect((await readFile(archivePath)).length).toBeGreaterThan(0);
                expect(
                    await readFile(join(extractPath, "sample.txt"), "utf8"),
                ).toBe("sample text");
                expect(approve).toHaveBeenCalledTimes(2);
            } finally {
                await rm(directory, { recursive: true, force: true });
            }
        });

        it("denies mutating actions when confirmation is not approved", async () => {
            const directory = await mkdtemp(
                join(tmpdir(), "typeagent-powershell-denied-"),
            );
            const outputPath = join(directory, "denied.txt");
            try {
                const { agent, context } = await createAgentHarness();

                const result = await agent.executeAction?.(
                    {
                        schemaName: "powershell.powershell-files",
                        actionName: "writeFile",
                        parameters: {
                            path: outputPath,
                            content: "should not be written",
                        },
                    },
                    context,
                );

                expect(result).toMatchObject({
                    errorCode: "powershell.policyDenied",
                    retryable: false,
                });
                await expect(readFile(outputPath, "utf8")).rejects.toThrow();
            } finally {
                await rm(directory, { recursive: true, force: true });
            }
        });

        itOnWindows(
            "does not validate URL file content as a path",
            async () => {
                const directory = await mkdtemp(
                    join(tmpdir(), "typeagent-powershell-url-content-"),
                );
                const outputPath = join(directory, "url.txt");
                try {
                    const approve = jest.fn(async () => 0);
                    const { agent, context } = await createAgentHarness(
                        undefined,
                        undefined,
                        undefined,
                        approve,
                    );

                    const result = await agent.executeAction?.(
                        {
                            schemaName: "powershell.powershell-files",
                            actionName: "writeFile",
                            parameters: {
                                path: outputPath,
                                content: "https://example.test/api",
                            },
                        },
                        context,
                    );

                    expect(result).not.toHaveProperty("error");
                    expect(await readFile(outputPath, "utf8")).toContain(
                        "https://example.test/api",
                    );
                } finally {
                    await rm(directory, { recursive: true, force: true });
                }
            },
        );

        itOnWindows(
            "denies a bare executable resolved outside allowed paths",
            async () => {
                const approve = jest.fn(async () => 0);
                const { agent, context } = await createAgentHarness(
                    undefined,
                    undefined,
                    undefined,
                    approve,
                );

                const result = await agent.executeAction?.(
                    {
                        schemaName: "powershell.powershell-processes",
                        actionName: "startProcess",
                        parameters: {
                            path: "powershell.exe",
                            arguments: "-NoProfile -Command Get-Process",
                        },
                    },
                    context,
                );

                expect(result).toMatchObject({
                    errorCode: "powershell.policyDenied",
                    retryable: false,
                });
                expect(result?.error).toMatch(/Path access\s+denied/i);
            },
        );
    });

    describe("static network actions", () => {
        itOnWindows(
            "tests ICMP connectivity without wrapper cmdlets",
            async () => {
                const { agent, context } = await createAgentHarness();

                const result = await agent.executeAction?.(
                    {
                        schemaName: "powershell.powershell-network",
                        actionName: "testConnection",
                        parameters: { computerName: "127.0.0.1" },
                    },
                    context,
                );

                expect(result).not.toHaveProperty("error");
                expect(result).toMatchObject({
                    displayContent: expect.stringContaining("PingSucceeded"),
                });
            },
        );

        itOnWindows(
            "tests TCP connectivity without wrapper cmdlets",
            async () => {
                const { agent, context } = await createAgentHarness();

                const result = await agent.executeAction?.(
                    {
                        schemaName: "powershell.powershell-network",
                        actionName: "testConnection",
                        parameters: { computerName: "127.0.0.1", port: 1 },
                    },
                    context,
                );

                expect(result).not.toHaveProperty("error");
                expect(result).toMatchObject({
                    displayContent: expect.stringContaining("TcpTestSucceeded"),
                });
            },
        );

        itOnWindows(
            "shows local IP configuration without wrapper cmdlets",
            async () => {
                const { agent, context } = await createAgentHarness();

                const result = await agent.executeAction?.(
                    {
                        schemaName: "powershell.powershell-network",
                        actionName: "ipConfig",
                        parameters: {},
                    },
                    context,
                );

                expect(result).not.toHaveProperty("error");
                expect(result).toMatchObject({
                    displayContent: expect.stringContaining("InterfaceAlias"),
                });
                expect(result).toMatchObject({
                    displayContent: expect.stringContaining("IPv4Address"),
                });
            },
        );

        itOnWindows(
            "executes portListeners without requiring a dynamic flow",
            async () => {
                const { agent, context } = await createAgentHarness();

                const result = await agent.executeAction?.(
                    {
                        schemaName: "powershell.powershell-network",
                        actionName: "portListeners",
                        parameters: {},
                    },
                    context,
                );
                expect(result).not.toHaveProperty("error");
            },
        );
    });

    afterAll(async () => {
        if (originalNoSamples === undefined) {
            delete process.env.TYPEAGENT_NO_SAMPLES;
        } else {
            process.env.TYPEAGENT_NO_SAMPLES = originalNoSamples;
        }
        if (originalConfigDir === undefined) {
            delete process.env.TYPEAGENT_CONFIG_DIR;
        } else {
            process.env.TYPEAGENT_CONFIG_DIR = originalConfigDir;
        }
        await rm(configDirectory, { recursive: true, force: true });
    });

    describe("dynamic execution containment", () => {
        it.each(
            [false, true].flatMap((enabled) =>
                (["path", "string"] as const).flatMap((type) =>
                    [false, true].map((direct) => ({
                        enabled,
                        type,
                        direct,
                    })),
                ),
            ),
        )(
            "does not expand parent secrets (enabled=$enabled, type=$type, direct=$direct)",
            async ({ enabled, type, direct }) => {
                const variable = "TYPEAGENT_FLOW_TEST_SECRET";
                const previous = process.env[variable];
                const secret = "must-not-leak-parent-value";
                process.env[variable] = secret;
                await setDynamicExecution(enabled);
                try {
                    const { agent, context, storage } =
                        await createAgentHarness();
                    const created = await agent.executeAction?.(
                        {
                            schemaName: "powershell",
                            actionName: "createPowerShellFlow",
                            parameters: {
                                actionName: "secretExpansion",
                                description: "Verify safe parameter handling",
                                script: "param([string]$Value)\nWrite-Output $Value",
                                scriptParameters: [
                                    {
                                        name: "Value",
                                        type,
                                        required: true,
                                        description: "Input value",
                                        validation: {
                                            allowedValues: ["accepted"],
                                        },
                                    },
                                ],
                                allowedCmdlets: ["Write-Output"],
                            },
                        },
                        context,
                    );
                    expect(created).not.toHaveProperty("error");
                    const flowPath = "flows/secretExpansion.flow.json";
                    const flow = JSON.parse(
                        await storage.read(flowPath, "utf8"),
                    ) as PowerShellFlowDefinition;
                    flow.parameters[0].validation = {
                        allowedValues: ["accepted"],
                    };
                    await storage.write(flowPath, JSON.stringify(flow));
                    const parameters = { Value: `$env:${variable}` };
                    const result = await agent.executeAction?.(
                        {
                            schemaName: "powershell",
                            actionName: direct
                                ? "secretExpansion"
                                : "executePowerShellFlow",
                            parameters: direct
                                ? parameters
                                : {
                                      flowName: "secretExpansion",
                                      flowParametersJson:
                                          JSON.stringify(parameters),
                                  },
                        },
                        context,
                    );

                    expect(result).toHaveProperty("error");
                    expect(JSON.stringify(result)).not.toContain(secret);
                    if (enabled) {
                        expect(result).toMatchObject({
                            errorCode: "powershell.invalidParameters",
                        });
                    }
                } finally {
                    if (previous === undefined) {
                        delete process.env[variable];
                    } else {
                        process.env[variable] = previous;
                    }
                    await setDynamicExecution(true);
                }
            },
        );

        itOnWindows.each([
            ["USERPROFILE", homedir()],
            ["HOME", homedir()],
            ["TEMP", tmpdir()],
            ["TMP", tmpdir()],
            ["PWD", process.cwd()],
        ])("preserves the safe path alias %s", async (alias, expected) => {
            const { agent, context } = await createAgentHarness();
            const result = await agent.executeAction?.(
                {
                    schemaName: "powershell",
                    actionName: "createAndExecutePowerShellFlow",
                    parameters: {
                        actionName: "pathAlias",
                        description: "Print a path without accessing it",
                        script: "param([string]$Path)\nWrite-Output $Path",
                        scriptParameters: [
                            {
                                name: "Path",
                                type: "path",
                                required: true,
                                description: "Path to print",
                            },
                        ],
                        allowedCmdlets: ["Write-Output"],
                        executionParametersJson: JSON.stringify({
                            Path: `$env:${alias.toLowerCase()}`,
                        }),
                    },
                },
                context,
            );

            expect(result).not.toHaveProperty("error");
            expect(result).toMatchObject({
                displayContent: expect.stringContaining(expected),
            });
        });

        itOnWindows(
            "keeps environment references in string arguments literal",
            async () => {
                const { agent, context } = await createAgentHarness();
                const result = await agent.executeAction?.(
                    {
                        schemaName: "powershell",
                        actionName: "createAndExecutePowerShellFlow",
                        parameters: {
                            actionName: "literalArgument",
                            description: "Print a literal string",
                            script: "param([string]$Value)\nWrite-Output $Value",
                            scriptParameters: [
                                {
                                    name: "Value",
                                    type: "string",
                                    required: true,
                                    description: "Text to print",
                                },
                            ],
                            allowedCmdlets: ["Write-Output"],
                            executionParametersJson: JSON.stringify({
                                Value: "$env:USERPROFILE",
                            }),
                        },
                    },
                    context,
                );

                expect(result).not.toHaveProperty("error");
                expect(result).toMatchObject({
                    displayContent: expect.stringContaining("$env:USERPROFILE"),
                });
            },
        );

        itOnWindows.each([
            "testPowerShellFlow",
            "createAndExecutePowerShellFlow",
            "executePowerShellFlow",
            "ordinaryError",
            "repairAndExecutePowerShellFlow",
        ])(
            "does not route ordinary errors from %s to reasoning",
            async (actionName) => {
                const { agent, context } = await createAgentHarness();
                const script =
                    "ConvertFrom-Json -InputObject 'invalid json'\nWrite-Output 'continued'";
                const parameters = {
                    actionName: "ordinaryError",
                    description: "A script with a nonterminating error",
                    script,
                    allowedCmdlets: ["ConvertFrom-Json", "Write-Output"],
                };
                const created = await agent.executeAction?.(
                    {
                        schemaName: "powershell",
                        actionName: "createPowerShellFlow",
                        parameters,
                    },
                    context,
                );
                expect(created).not.toHaveProperty("error");
                const result = await agent.executeAction?.(
                    {
                        schemaName: "powershell",
                        actionName,
                        parameters: {
                            ...parameters,
                            actionName: "ordinaryErrorDraft",
                            flowName: "ordinaryError",
                            executionParametersJson: "{}",
                        },
                    },
                    context,
                );

                expect(result).toMatchObject({
                    errorCode: "powershell.scriptFailure",
                    retryable: false,
                    fallbackToReasoning: false,
                    mayHaveSideEffects: true,
                });
            },
        );

        it("denies create-and-execute without leaving artifacts", async () => {
            await withDynamicExecutionDisabled(async () => {
                const directory = await mkdtemp(
                    join(tmpdir(), "typeagent-powershell-containment-"),
                );
                const outputPath = join(directory, "output.txt");
                try {
                    const { agent, storage, context } =
                        await createAgentHarness();
                    const result = await agent.executeAction?.(
                        {
                            schemaName: "powershell",
                            actionName: "createAndExecutePowerShellFlow",
                            parameters: {
                                actionName: "containedDraft",
                                description: "Attempt a contained execution",
                                script: "param([string]$Path)\nSet-Content -LiteralPath $Path -Value 'run'",
                                scriptParameters: [
                                    {
                                        name: "Path",
                                        type: "path",
                                        required: true,
                                        description: "Output file",
                                    },
                                ],
                                allowedCmdlets: ["Set-Content"],
                                executionParametersJson: JSON.stringify({
                                    Path: outputPath,
                                }),
                            },
                        },
                        context,
                    );

                    expectPolicyDenied(result);
                    expect(await storage.list("pending")).toEqual([]);
                    expect(
                        await storage.exists("flows/containedDraft.flow.json"),
                    ).toBe(false);
                    await expect(
                        readFile(outputPath, "utf8"),
                    ).rejects.toThrow();
                } finally {
                    await rm(directory, { recursive: true, force: true });
                }
            });
        });

        it("denies testing a generated script", async () => {
            await withDynamicExecutionDisabled(async () => {
                const { agent, context } = await createAgentHarness();
                const result = await agent.executeAction?.(
                    {
                        schemaName: "powershell",
                        actionName: "testPowerShellFlow",
                        parameters: {
                            script: "Write-Output 'blocked'",
                            allowedCmdlets: ["Write-Output"],
                        },
                    },
                    context,
                );

                expectPolicyDenied(result);
            });
        });

        it("denies explicit and generated stored-flow execution", async () => {
            await withDynamicExecutionDisabled(async () => {
                const { agent, context } = await createAgentHarness();
                await createStoredFlow(agent, context, "storedFlow");

                const explicit = await agent.executeAction?.(
                    {
                        schemaName: "powershell",
                        actionName: "executePowerShellFlow",
                        parameters: { flowName: "storedFlow" },
                    },
                    context,
                );
                const generated = await agent.executeAction?.(
                    {
                        schemaName: "powershell",
                        actionName: "storedFlow",
                        parameters: {},
                    },
                    context,
                );

                expectPolicyDenied(explicit);
                expectPolicyDenied(generated);
            });
        });

        it("denies repair without changing the stored flow", async () => {
            await withDynamicExecutionDisabled(async () => {
                const directory = await mkdtemp(
                    join(tmpdir(), "typeagent-powershell-repair-containment-"),
                );
                const outputPath = join(directory, "repair.txt");
                try {
                    const { agent, storage, context } =
                        await createAgentHarness();
                    await createStoredFlow(agent, context, "repairableFlow");

                    const result = await agent.executeAction?.(
                        {
                            schemaName: "powershell",
                            actionName: "repairAndExecutePowerShellFlow",
                            parameters: {
                                flowName: "repairableFlow",
                                script: `param([string]$Path)
Set-Content -LiteralPath $Path -Value "repaired"`,
                                allowedCmdlets: ["Set-Content"],
                                executionParametersJson: JSON.stringify({
                                    Path: outputPath,
                                }),
                            },
                        },
                        context,
                    );

                    expectPolicyDenied(result);
                    await expect(
                        storage.read("scripts/repairableFlow.ps1", "utf8"),
                    ).resolves.toBe("Write-Output 'stored'");
                    await expect(
                        readFile(outputPath, "utf8"),
                    ).rejects.toThrow();
                } finally {
                    await rm(directory, { recursive: true, force: true });
                }
            });
        });

        it("denies @powershell run", async () => {
            await withDynamicExecutionDisabled(async () => {
                const { agent, context } = await createAgentHarness();
                await createStoredFlow(agent, context, "commandFlow");

                const result = await agent.executeCommand?.(
                    ["run"],
                    {
                        args: { flowName: "commandFlow" },
                        flags: {},
                    },
                    context,
                );

                expectPolicyDenied(result);
            });
        });
    });

    describe("approved-local execution", () => {
        it("does not initialize shared flow storage when enabling static namespaces", async () => {
            const storage = new MemoryStorage();
            const read = jest.spyOn(storage, "read");
            const write = jest.spyOn(storage, "write");
            const session = createSessionContext(storage);
            const agent = instantiate();
            await agent.initializeAgentContext?.();
            await Promise.all(
                [
                    "powershell-files",
                    "powershell-network",
                    "powershell-system",
                ].map((name) =>
                    agent.updateAgentContext?.(
                        true,
                        session,
                        `powershell.${name}`,
                    ),
                ),
            );
            expect(read).not.toHaveBeenCalled();
            expect(write).not.toHaveBeenCalled();
            await agent.updateAgentContext?.(true, session, "powershell");
            expect(write).toHaveBeenCalledWith(
                "grammar/dynamic.agr",
                expect.any(String),
            );
            await agent.closeAgentContext?.(session);
        });

        itOnWindows.each([
            "testPowerShellFlow",
            "createAndExecutePowerShellFlow",
            "executePowerShellFlow",
            "directoryFlow",
            "repairAndExecutePowerShellFlow",
            "@powershell run",
        ])(
            "uses the action directory for %s and its PWD alias",
            async (actionName) => {
                const directory = await realpath(
                    await mkdtemp(join(tmpdir(), "ta-cwd-")),
                );
                try {
                    await writeFile(
                        join(directory, "cwd-marker.txt"),
                        "project-marker",
                    );
                    const popup = jest.fn(async () => 0);
                    const { agent, context } = await createAgentHarness(
                        undefined,
                        undefined,
                        undefined,
                        popup,
                    );
                    const projectContext = {
                        ...context,
                        workingDirectory: directory,
                    };
                    expect(directory).not.toBe(process.cwd());
                    const definition = {
                        actionName: "directoryFlow",
                        description: "Read a project-relative fixture",
                        script: "param([string]$Path)\nGet-Content -LiteralPath '.\\cwd-marker.txt'\nWrite-Output (Get-Location).Path\nWrite-Output $Path",
                        scriptParameters: [
                            {
                                name: "Path",
                                type: "path",
                                required: true,
                                description: "Project directory",
                            },
                        ],
                    };
                    if (
                        actionName !== "testPowerShellFlow" &&
                        actionName !== "createAndExecutePowerShellFlow"
                    ) {
                        expect(
                            await agent.executeAction?.(
                                {
                                    schemaName: "powershell",
                                    actionName: "createPowerShellFlow",
                                    parameters: definition,
                                },
                                projectContext,
                            ),
                        ).not.toHaveProperty("error");
                    }
                    // Unsaved tests have no parameter-role metadata, so the alias
                    // applies only to flows with a declared path parameter.
                    const args = {
                        Path:
                            actionName === "testPowerShellFlow"
                                ? directory
                                : "$env:pWd",
                    };
                    if (actionName === "@powershell run") {
                        await agent.executeCommand?.(
                            ["run"],
                            {
                                args: { flowName: "directoryFlow" },
                                flags: {
                                    flowParametersJson: JSON.stringify(args),
                                },
                            },
                            projectContext,
                        );
                        expect(
                            context.actionIO.setDisplay,
                        ).toHaveBeenCalledWith(
                            expect.stringContaining(`project-marker`),
                        );
                        expect(
                            context.actionIO.setDisplay,
                        ).toHaveBeenCalledWith(
                            expect.stringContaining(
                                `${directory}\r\n${directory}`,
                            ),
                        );
                    } else {
                        const result = await agent.executeAction?.(
                            {
                                schemaName: "powershell",
                                actionName,
                                parameters:
                                    actionName === "directoryFlow"
                                        ? args
                                        : {
                                              ...definition,
                                              flowName: "directoryFlow",
                                              testParameters:
                                                  JSON.stringify(args),
                                              executionParametersJson:
                                                  JSON.stringify(args),
                                              flowParametersJson:
                                                  JSON.stringify(args),
                                          },
                            },
                            projectContext,
                        );
                        expect(result).not.toHaveProperty("error");
                        expect(result).toMatchObject({
                            displayContent:
                                expect.stringContaining("project-marker"),
                        });
                        expect(result).toMatchObject({
                            displayContent: expect.stringContaining(
                                `${directory}\r\n${directory}`,
                            ),
                        });
                    }
                    expect(popup).toHaveBeenCalledTimes(1);
                    expect(popup.mock.calls[0]).toEqual(
                        expect.arrayContaining([
                            expect.stringContaining(`Folder: ${directory}`),
                        ]),
                    );
                } finally {
                    await rm(directory, { recursive: true, force: true });
                }
            },
        );

        itOnWindows(
            "shows a remembered approval correctly for older module metadata",
            async () => {
                const popup = jest.fn(async () => 1);
                const { agent, context, storage } = await createAgentHarness(
                    undefined,
                    undefined,
                    undefined,
                    popup,
                );
                await createStoredFlow(agent, context, "legacyModules");
                const path = "flows/legacyModules.flow.json";
                const flow = JSON.parse(
                    await storage.read(path, "utf8"),
                ) as PowerShellFlowDefinition;
                delete flow.requiredModules;
                flow.sandbox.allowedModules = [];
                await storage.write(path, JSON.stringify(flow));
                await storage.delete("revisions/legacyModules.json");
                const directContext = {
                    ...context,
                    isFromReasoningLoop: false,
                };
                await agent.executeCommand?.(
                    ["run"],
                    { args: { flowName: "legacyModules" }, flags: {} },
                    directContext,
                );
                await agent.updateAgentContext?.(
                    false,
                    directContext.sessionContext,
                    "powershell.powershell-files",
                );
                await agent.executeCommand?.(
                    ["show"],
                    { args: { flowName: "legacyModules" }, flags: {} },
                    directContext,
                );
                expect(context.actionIO.setDisplay).toHaveBeenLastCalledWith(
                    expect.stringContaining("Version approved"),
                );
                expect(popup).toHaveBeenCalledTimes(1);
            },
        );

        it("rechecks revocation after an asynchronous stored-revision update", async () => {
            const { sessionContext } = await createAgentHarness();
            const result = await executeScript(
                {
                    script: "Write-Output 'must not execute'",
                    parameters: {},
                    provenance: "generated",
                    sandbox: { maxExecutionTime: 30 },
                    onAuthorized: async () =>
                        revokeScriptApprovals(sessionContext),
                },
                {
                    sessionContext,
                    definition: {
                        actionName: "revoked",
                        displayName: "Revoked",
                        description: "",
                        parameters: [],
                        grammarPatterns: [],
                    },
                },
            );
            expect(result.errorCode).toBe("powershell.policyDenied");
            expect(result.stderr).toContain("authorization was revoked");
            expect(result.stdout).toBe("");
        });

        let fixtureDirectory: string;
        let dataDirectory: string;
        let repository: string;
        let logPath: string;

        beforeAll(async () => {
            fixtureDirectory = await mkdtemp(
                join(tmpdir(), "typeagent-approved-"),
            );
            dataDirectory = join(fixtureDirectory, "data");
            repository = join(fixtureDirectory, "repository");
            await mkdir(dataDirectory);
            await mkdir(repository);
            await writeFile(
                join(dataDirectory, "duplicate-a.txt"),
                "duplicate-content",
            );
            await writeFile(
                join(dataDirectory, "duplicate-b.txt"),
                "duplicate-content",
            );
            await writeFile(
                join(dataDirectory, "largest.txt"),
                "x".repeat(2048),
            );
            logPath = join(dataDirectory, "sample.log");
            await writeFile(
                logPath,
                "first line\nERROR test fixture\nlast line\n",
            );
            const gitConfig = join(fixtureDirectory, "gitconfig");
            await writeFile(gitConfig, "");
            const git = (args: string[]) =>
                execFileSync("git", ["-C", repository, ...args], {
                    encoding: "utf8",
                    env: {
                        ...process.env,
                        GIT_CONFIG_NOSYSTEM: "1",
                        GIT_CONFIG_GLOBAL: gitConfig,
                        GIT_AUTHOR_NAME: "Approval Fixture",
                        GIT_AUTHOR_EMAIL: "fixture@example.invalid",
                        GIT_COMMITTER_NAME: "Approval Fixture",
                        GIT_COMMITTER_EMAIL: "fixture@example.invalid",
                        GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
                        GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
                    },
                });
            git(["init", "-q", "-b", "main", "--template="]);
            git([
                "config",
                "core.hooksPath",
                join(fixtureDirectory, "no-hooks"),
            ]);
            await writeFile(join(repository, "tracked.txt"), "before\n");
            git(["add", "tracked.txt"]);
            git([
                "-c",
                "commit.gpgsign=false",
                "commit",
                "-q",
                "-m",
                "initial fixture",
            ]);
            git(["branch", "old-feature"]);
            await writeFile(join(repository, "tracked.txt"), "after\n");
            await writeFile(join(repository, "untracked.txt"), "untracked");
        });

        beforeEach(async () => {
            await writeFile(
                localConfigPath,
                "powershell:\n  dynamicExecution:\n    enabled: true\n  brokerExecution:\n    enabled: true\n",
            );
        });

        afterEach(async () => {
            await setDynamicExecution(true);
        });

        afterAll(async () => {
            if (fixtureDirectory)
                await rm(fixtureDirectory, { recursive: true, force: true });
        });

        itOnWindows.each([
            "findDuplicates",
            "findLargeFiles",
            "listFiles",
            "logGrep",
            "tailLog",
            "gitStatus",
            "gitLog",
            "gitDiff",
            "gitBranches",
            "staleBranches",
        ])(
            "runs the actual saved sample %s only after approval",
            async (name) => {
                const popup = jest.fn(async () => 0);
                const previous = process.env.TYPEAGENT_NO_SAMPLES;
                delete process.env.TYPEAGENT_NO_SAMPLES;
                try {
                    const { agent, context } = await createAgentHarness(
                        undefined,
                        undefined,
                        new MemoryStorage(),
                        popup,
                    );
                    const parameters: Record<string, unknown> =
                        name.startsWith("git") || name === "staleBranches"
                            ? { repoPath: repository }
                            : name === "tailLog"
                              ? { logPath, lines: 1 }
                              : name === "logGrep"
                                ? { logPath, pattern: "ERROR" }
                                : {
                                      path: dataDirectory,
                                      minSizeMB: 0,
                                      topN: 1,
                                  };
                    await agent.executeCommand?.(
                        ["run"],
                        {
                            args: { flowName: name },
                            flags: {
                                flowParametersJson: JSON.stringify(parameters),
                            },
                        },
                        context,
                    );
                    expect(popup).toHaveBeenCalledTimes(1);
                    expect(popup).toHaveBeenCalledWith(
                        expect.stringContaining("NOT a sandbox"),
                        expect.any(Array),
                        expect.any(Number),
                    );
                    const expected: Record<string, string[]> = {
                        findDuplicates: ["duplicate-a.txt", "duplicate-b.txt"],
                        findLargeFiles: ["largest.txt"],
                        listFiles: ["largest.txt", "sample.log"],
                        logGrep: ["ERROR test fixture"],
                        tailLog: ["last line"],
                        gitStatus: ["tracked.txt", "untracked.txt"],
                        gitLog: ["initial fixture"],
                        gitDiff: ["-before", "+after"],
                        gitBranches: ["main", "old-feature"],
                        staleBranches: ["old-feature", "DaysOld"],
                    };
                    for (const text of expected[name]) {
                        expect(
                            context.actionIO.setDisplay,
                        ).toHaveBeenCalledWith(expect.stringContaining(text));
                    }
                } finally {
                    if (previous === undefined)
                        delete process.env.TYPEAGENT_NO_SAMPLES;
                    else process.env.TYPEAGENT_NO_SAMPLES = previous;
                }
            },
        );

        it.each([
            "testPowerShellFlow",
            "createAndExecutePowerShellFlow",
            "executePowerShellFlow",
            "unapprovedFlow",
            "repairAndExecutePowerShellFlow",
        ])(
            "does not execute a denied script through %s",
            async (actionName) => {
                const popup = jest.fn<SessionContext["popupQuestion"]>(
                    async (_message, _choices, defaultId) => defaultId ?? -1,
                );
                const { agent, context, storage } = await createAgentHarness(
                    undefined,
                    undefined,
                    new MemoryStorage(),
                    popup,
                );
                const marker = join(fixtureDirectory, `${actionName}.txt`);
                const script =
                    "param([string]$Path)\nSet-Content -LiteralPath $Path -Value 'unauthorized'";
                const definition = {
                    actionName: "unapprovedFlow",
                    description: "Authorization marker",
                    script,
                    allowedCmdlets: ["Set-Content"],
                    scriptParameters: [
                        {
                            name: "Path",
                            type: "path",
                            required: true,
                            description: "Marker file",
                        },
                    ],
                };
                await agent.executeAction?.(
                    {
                        schemaName: "powershell",
                        actionName: "createPowerShellFlow",
                        parameters: definition,
                    },
                    context,
                );
                const result = await agent.executeAction?.(
                    {
                        schemaName: "powershell",
                        actionName,
                        parameters: {
                            ...definition,
                            actionName: "unapprovedDraft",
                            flowName: "unapprovedFlow",
                            Path: marker,
                            flowParametersJson: JSON.stringify({
                                Path: marker,
                            }),
                            executionParametersJson: JSON.stringify({
                                Path: marker,
                            }),
                            testParameters: JSON.stringify({ Path: marker }),
                            approved: true,
                            approvedLocal: true,
                        },
                    },
                    context,
                );
                expectPolicyDenied(result);
                expect(popup).toHaveBeenCalledTimes(1);
                await expect(readFile(marker, "utf8")).rejects.toThrow();
                expect(await storage.list("pending")).toEqual([]);
            },
        );

        itOnWindows(
            "reviews the script without executing until the user chooses Run once",
            async () => {
                const marker = join(
                    fixtureDirectory,
                    "review-before-execution.txt",
                );
                const script =
                    "param([string]$Path)\nSet-Content -LiteralPath $Path -Value 'reviewed'";
                let prompts = 0;
                const popup = jest.fn<SessionContext["popupQuestion"]>(
                    async (_message, choices) => {
                        await expect(
                            readFile(marker, "utf8"),
                        ).rejects.toThrow();
                        if (!choices)
                            throw new Error("Expected approval choices");
                        return prompts++ === 0
                            ? choices.indexOf("Review script and details")
                            : 0;
                    },
                );
                const { agent, context } = await createAgentHarness(
                    undefined,
                    undefined,
                    new MemoryStorage(),
                    popup,
                );
                const result = await agent.executeAction?.(
                    {
                        schemaName: "powershell",
                        actionName: "testPowerShellFlow",
                        parameters: {
                            script,
                            allowedCmdlets: [],
                            testParameters: JSON.stringify({ Path: marker }),
                        },
                    },
                    context,
                );

                expect(result).not.toHaveProperty("error");
                expect(popup).toHaveBeenCalledTimes(2);
                expect(popup.mock.calls[0][0]).not.toContain(script);
                expect(popup.mock.calls[1][0]).toContain(script);
                await expect(readFile(marker, "utf8")).resolves.toMatch(
                    /reviewed/,
                );
            },
        );

        it("does not execute when the approval UI is unavailable", async () => {
            const { agent, context } = await createAgentHarness(
                undefined,
                undefined,
                new MemoryStorage(),
                async () => {
                    throw new Error("No interactive client");
                },
            );
            const result = await agent.executeAction?.(
                {
                    schemaName: "powershell",
                    actionName: "testPowerShellFlow",
                    parameters: {
                        script: "Write-Output 'must not run'",
                        allowedCmdlets: [],
                    },
                },
                context,
            );
            expectPolicyDenied(result);
            expect(result?.error).toContain("authorization was unavailable");
        });

        itOnWindows(
            "checks stored versions on every run and supports revocation",
            async () => {
                const popup = jest.fn(async () => 1);
                const { agent, context, storage } = await createAgentHarness(
                    undefined,
                    undefined,
                    new MemoryStorage(),
                    popup,
                );
                await createStoredFlow(agent, context, "versionedFlow");
                const directContext = {
                    ...context,
                    isFromReasoningLoop: false,
                };
                const run = () =>
                    agent.executeAction?.(
                        {
                            schemaName: "powershell",
                            actionName: "versionedFlow",
                            parameters: {},
                        },
                        directContext,
                    );
                expect(await run()).not.toHaveProperty("error");
                expect(await run()).not.toHaveProperty("error");
                expect(popup).toHaveBeenCalledTimes(1);
                await storage.write(
                    "scripts/versionedFlow.ps1",
                    "Write-Output 'changed'",
                );
                popup.mockResolvedValue(2);
                expectPolicyDenied(await run());
                expect(popup).toHaveBeenCalledTimes(2);
                await agent.executeCommand?.(
                    ["show"],
                    { args: { flowName: "versionedFlow" }, flags: {} },
                    context,
                );
                expect(context.actionIO.setDisplay).toHaveBeenCalledWith(
                    expect.stringContaining("Changed since approval"),
                );
                popup.mockResolvedValue(1);
                expect(await run()).not.toHaveProperty("error");
                await agent.executeCommand?.(["revoke"], undefined, context);
                expect(await run()).not.toHaveProperty("error");
                expect(popup).toHaveBeenCalledTimes(4);
            },
        );

        it("rechecks disablement after a pending approval", async () => {
            const { agent, context } = await createAgentHarness(
                undefined,
                undefined,
                new MemoryStorage(),
                async () => {
                    await setDynamicExecution(false);
                    return 0;
                },
            );
            const result = await agent.executeAction?.(
                {
                    schemaName: "powershell",
                    actionName: "testPowerShellFlow",
                    parameters: {
                        script: "Write-Output 'must not run'",
                        allowedCmdlets: [],
                    },
                },
                context,
            );
            expectPolicyDenied(result);
            expect(result?.error).toContain("disabled before execution");
        });

        itOnWindows.each([false, true])(
            "loads a user module without a product cmdlet catalogue (declared=%s)",
            async (declared) => {
                const modulePath = join(fixtureDirectory, "team-fixture.psm1");
                await writeFile(
                    modulePath,
                    "function Get-TeamFixture { 'team-module-marker' }\nExport-ModuleMember -Function Get-TeamFixture",
                );
                const { agent, context } = await createAgentHarness(
                    undefined,
                    undefined,
                    new MemoryStorage(),
                    async () => 0,
                );
                const result = await agent.executeAction?.(
                    {
                        schemaName: "powershell",
                        actionName: "testPowerShellFlow",
                        parameters: {
                            script: declared
                                ? "Get-TeamFixture"
                                : "param([string]$Module)\nImport-Module $Module\nGet-TeamFixture",
                            requiredModules: declared ? [modulePath] : [],
                            allowedCmdlets: [],
                            testParameters: JSON.stringify({
                                Module: modulePath,
                            }),
                        },
                    },
                    context,
                );
                expect(result).not.toHaveProperty("error");
                expect(result).toMatchObject({
                    displayContent:
                        expect.stringContaining("team-module-marker"),
                });
            },
        );

        itOnWindows(
            "does not run the script when a required module cannot load",
            async () => {
                const { agent, context } = await createAgentHarness();
                const result = await agent.executeAction?.(
                    {
                        schemaName: "powershell",
                        actionName: "testPowerShellFlow",
                        parameters: {
                            script: "Write-Output 'root-script-must-not-run'",
                            requiredModules: [
                                join(fixtureDirectory, "missing-module.psm1"),
                            ],
                        },
                    },
                    context,
                );
                expect(result).toHaveProperty("error");
                expect(JSON.stringify(result)).not.toContain(
                    "root-script-must-not-run",
                );
            },
        );

        itOnWindows(
            "keeps native stderr warnings visible without failing a successful command",
            async () => {
                const { agent, context } = await createAgentHarness(
                    undefined,
                    undefined,
                    new MemoryStorage(),
                    async () => 0,
                );
                const result = await agent.executeAction?.(
                    {
                        schemaName: "powershell",
                        actionName: "testPowerShellFlow",
                        parameters: {
                            script: '& "$env:SYSTEMROOT\\System32\\cmd.exe" /d /c "echo native-warning 1>&2 & exit /b 0"',
                            allowedCmdlets: [],
                        },
                    },
                    context,
                );
                expect(result).not.toHaveProperty("error");
                expect(result).toMatchObject({
                    displayContent: expect.stringContaining("native-warning"),
                });
            },
        );

        itOnWindows(
            "fails native nonzero exits even when stderr is empty",
            async () => {
                const { agent, context } = await createAgentHarness(
                    undefined,
                    undefined,
                    new MemoryStorage(),
                    async () => 0,
                );
                const result = await agent.executeAction?.(
                    {
                        schemaName: "powershell",
                        actionName: "testPowerShellFlow",
                        parameters: {
                            script: '& "$env:SYSTEMROOT\\System32\\cmd.exe" /d /c "exit /b 17"',
                            allowedCmdlets: [],
                        },
                    },
                    context,
                );
                expect(result).toMatchObject({
                    error: expect.stringContaining("exit code 17"),
                    retryable: false,
                    fallbackToReasoning: false,
                });
            },
        );

        itOnWindows.each([
            "$PSModuleAutoLoadingPreference = 'None'\n'expected-output'",
            "function Out-String { 'wrong-formatter' }\n'expected-output'",
        ])(
            "keeps host output formatting independent of approved-script state: %s",
            async (script) => {
                const { agent, context } = await createAgentHarness();
                const result = await agent.executeAction?.(
                    {
                        schemaName: "powershell",
                        actionName: "testPowerShellFlow",
                        parameters: { script },
                    },
                    context,
                );
                expect(result).not.toHaveProperty("error");
                expect(result).toMatchObject({
                    displayContent: expect.stringContaining("expected-output"),
                });
                expect(result).not.toMatchObject({
                    displayContent: expect.stringContaining("wrong-formatter"),
                });
            },
        );

        itOnWindows.each(["success", "timeout"])(
            "terminates owned native children after approved-script %s despite slow startup",
            async (mode) => {
                const { sessionContext } = await createAgentHarness(
                    undefined,
                    undefined,
                    new MemoryStorage(),
                    async () => 0,
                );
                const directory = await mkdtemp(
                    join(fixtureDirectory, "child-lifetime-"),
                );
                const marker = join(directory, "child-pid.txt");
                const release = join(directory, "release-script.txt");
                const host = await readFile(
                    new URL("../../scripts/scriptHost.ps1", import.meta.url),
                    "utf8",
                );
                const initialization = "$ErrorActionPreference = 'Stop'";
                expect(host).toContain(initialization);
                const originalBroker = process.env.TYPEAGENT_POWERSHELL_BROKER;
                // Exceed the old three-second budget before any user code runs.
                process.env.TYPEAGENT_POWERSHELL_BROKER =
                    await copyBrokerWithTestHost(
                        directory,
                        host.replace(
                            initialization,
                            `${initialization}\n[System.Threading.Thread]::Sleep(6000)`,
                        ),
                    );
                const controller = new AbortController();
                const started = Date.now();
                const execution = executeScript(
                    {
                        script: String.raw`param([string]$Marker, [string]$Release)
$child = Start-Process "$env:SYSTEMROOT\System32\WindowsPowerShell\v1.0\powershell.exe" -ArgumentList '-NoProfile -NonInteractive -Command Start-Sleep -Seconds 120' -PassThru -WindowStyle Hidden
[System.IO.File]::WriteAllText($Marker, [string]$child.Id)
while (-not [System.IO.File]::Exists($Release)) { Start-Sleep -Milliseconds 50 }`,
                        parameters: {
                            Marker: marker,
                            Release: release,
                        },
                        abortSignal: controller.signal,
                        provenance: "generated",
                        sandbox: {
                            maxExecutionTime: 30,
                        },
                    },
                    {
                        sessionContext,
                        definition: {
                            actionName: "childLifetime",
                            displayName: "Child lifetime",
                            description: "Verify owned-process cleanup",
                            parameters: [],
                            grammarPatterns: [],
                        },
                    },
                );
                try {
                    const deadline = Date.now() + 25_000;
                    let pid: number | undefined;
                    while (Date.now() < deadline) {
                        if (existsSync(marker)) {
                            const value = Number(
                                await readFile(marker, "utf8"),
                            );
                            if (Number.isInteger(value) && value > 0) {
                                pid = value;
                                break;
                            }
                        }
                        const finished = await Promise.race([
                            execution.then((result) => ({ result })),
                            delay(50).then(() => undefined),
                        ]);
                        if (finished) {
                            throw new Error(
                                `PowerShell ended before child readiness: ${JSON.stringify(finished.result)}`,
                            );
                        }
                    }
                    if (pid === undefined)
                        throw new Error(
                            "Child did not become ready within 25 seconds.",
                        );
                    const childPid = pid;
                    expect(Date.now() - started).toBeGreaterThanOrEqual(6000);
                    expect(() => process.kill(childPid, 0)).not.toThrow();
                    if (mode === "success") await writeFile(release, "");
                    const result = await execution;
                    expect(result).toMatchObject({
                        success: mode === "success",
                        cancelled: false,
                    });
                    if (mode === "timeout") {
                        expect(result.stderr).toMatch(/timed out/i);
                        expect(result.duration).toBeGreaterThanOrEqual(30_000);
                    } else {
                        expect(result.stderr).toBe("");
                    }
                    let running = true;
                    for (let attempt = 0; attempt < 50; attempt++) {
                        try {
                            process.kill(childPid, 0);
                        } catch (error) {
                            if (
                                typeof error !== "object" ||
                                error === null ||
                                !("code" in error) ||
                                error.code !== "ESRCH"
                            )
                                throw error;
                            running = false;
                            break;
                        }
                        await delay(100);
                    }
                    if (running) process.kill(childPid);
                    expect(running).toBe(false);
                } finally {
                    controller.abort();
                    try {
                        await execution;
                    } finally {
                        if (originalBroker === undefined)
                            delete process.env.TYPEAGENT_POWERSHELL_BROKER;
                        else
                            process.env.TYPEAGENT_POWERSHELL_BROKER =
                                originalBroker;
                        await rm(directory, { recursive: true, force: true });
                    }
                }
            },
        );
    });

    it("denies a stored flow with missing provenance", async () => {
        const { agent, storage, context } = await createAgentHarness();
        await createStoredFlow(agent, context, "unknownProvenanceFlow");
        const flow = JSON.parse(
            await storage.read("flows/unknownProvenanceFlow.flow.json", "utf8"),
        ) as Record<string, unknown>;
        delete flow.source;
        await storage.write(
            "flows/unknownProvenanceFlow.flow.json",
            JSON.stringify(flow),
        );

        const result = await agent.executeAction?.(
            {
                schemaName: "powershell",
                actionName: "executePowerShellFlow",
                parameters: { flowName: "unknownProvenanceFlow" },
            },
            context,
        );

        expectPolicyDenied(result);
    });

    it("marks edited flows while retaining generated provenance", async () => {
        const { agent, storage, context } = await createAgentHarness();
        await createStoredFlow(agent, context, "editedFlow");

        const result = await agent.executeAction?.(
            {
                schemaName: "powershell",
                actionName: "editPowerShellFlow",
                parameters: {
                    flowName: "editedFlow",
                    script: "Write-Output 'edited'",
                    allowedCmdlets: ["Write-Output"],
                },
            },
            context,
        );

        expect(result).not.toHaveProperty("error");
        await expect(
            storage.read("flows/editedFlow.flow.json", "utf8"),
        ).resolves.toContain('"originalType": "reasoning"');
        await expect(
            storage.read("flows/editedFlow.flow.json", "utf8"),
        ).resolves.toContain('"type": "edited"');
    });

    itOnWindows("removes the pending draft when execution fails", async () => {
        const { agent, storage, context } = await createAgentHarness();

        const result = await agent.executeAction?.(
            {
                schemaName: "powershell",
                actionName: "createAndExecutePowerShellFlow",
                parameters: {
                    actionName: "failingDraft",
                    description: "A flow that fails during its first execution",
                    script: "throw 'draft failed'",
                    executionParametersJson: "{}",
                },
            },
            context,
        );

        expect(result).toMatchObject({
            errorCode: "powershell.scriptFailure",
            retryable: false,
        });
        expect(await storage.list("pending")).toEqual([]);
        expect(await storage.exists("flows/failingDraft.flow.json")).toBe(
            false,
        );
    });

    itOnWindows(
        "executes once and promotes only after successful execution",
        async () => {
            const { agent, storage, context } = await createAgentHarness();

            const result = await agent.executeAction?.(
                {
                    schemaName: "powershell",
                    actionName: "createAndExecutePowerShellFlow",
                    parameters: {
                        actionName: "successfulDraft",
                        description: "Return one value",
                        script: "param([string]$Value)\nWrite-Output $Value",
                        scriptParameters: [
                            {
                                name: "Value",
                                type: "string",
                                required: true,
                                description: "Value to return",
                            },
                        ],
                        allowedCmdlets: ["Write-Output"],
                        executionParametersJson: JSON.stringify({
                            Value: "run",
                        }),
                    },
                },
                context,
            );

            expect(result).not.toHaveProperty("error");
            expect(JSON.stringify(result)).toContain("run");
            expect(await storage.list("pending")).toEqual([]);
            expect(
                await storage.exists("flows/successfulDraft.flow.json"),
            ).toBe(true);
        },
    );

    it("adds an alias without executing the existing flow again", async () => {
        const { agent, context } = await createAgentHarness();
        (
            context.sessionContext
                .validateGrammarPatterns as jest.MockedFunction<
                NonNullable<SessionContext["validateGrammarPatterns"]>
            >
        ).mockResolvedValue({
            approved: true,
            patterns: ["display every listening port"],
        });
        await agent.executeAction?.(
            {
                schemaName: "powershell",
                actionName: "createPowerShellFlow",
                parameters: {
                    actionName: "successfulAlias",
                    description: "Must not execute while adding an alias",
                    displayName: "Successful Alias",
                    script: "throw 'alias recording executed the flow'",
                    scriptParameters: [],
                    grammarPatterns: [],
                    allowedCmdlets: [],
                },
            },
            context,
        );

        const result = await agent.executeAction?.(
            {
                schemaName: "powershell",
                actionName: "addPowerShellFlowPatterns",
                parameters: {
                    flowName: "successfulAlias",
                    grammarPatterns: [
                        {
                            pattern: "display every listening port",
                            isAlias: true,
                        },
                    ],
                },
            },
            context,
        );

        expect(result).not.toHaveProperty("error");
        const schema = await agent.getDynamicGrammar?.(
            context.sessionContext,
            "powershell",
        );
        expect(schema?.content).toContain("display every listening port");
    });

    it("rolls back an alias when activation fails", async () => {
        const reloadAgentSchema = jest
            .fn<() => Promise<void>>()
            .mockResolvedValueOnce()
            .mockRejectedValueOnce(new Error("reload failed"))
            .mockResolvedValueOnce();
        const { agent, context } = await createAgentHarness(reloadAgentSchema);
        (
            context.sessionContext
                .validateGrammarPatterns as jest.MockedFunction<
                NonNullable<SessionContext["validateGrammarPatterns"]>
            >
        ).mockResolvedValue({
            approved: true,
            patterns: ["run the rollback flow"],
        });
        await agent.executeAction?.(
            {
                schemaName: "powershell",
                actionName: "createPowerShellFlow",
                parameters: {
                    actionName: "rollbackAlias",
                    description: "Show a value",
                    displayName: "Rollback Alias",
                    script: "Write-Output 'ok'",
                    scriptParameters: [],
                    grammarPatterns: [],
                    allowedCmdlets: ["Write-Output"],
                },
            },
            context,
        );

        const result = await agent.executeAction?.(
            {
                schemaName: "powershell",
                actionName: "addPowerShellFlowPatterns",
                parameters: {
                    flowName: "rollbackAlias",
                    grammarPatterns: [
                        {
                            pattern: "run the rollback flow",
                            isAlias: true,
                        },
                    ],
                },
            },
            context,
        );

        expect(result).toHaveProperty(
            "error",
            expect.stringContaining("No patterns were added"),
        );
        const grammar = await agent.getDynamicGrammar?.(
            context.sessionContext,
            "powershell",
        );
        expect(grammar?.content ?? "").not.toContain("run the rollback flow");
        expect(reloadAgentSchema).toHaveBeenCalledTimes(3);
    });

    itOnWindows(
        "removes the promoted flow when schema reload fails",
        async () => {
            const reloadAgentSchema = jest.fn(async () => {
                throw new Error("reload failed");
            });
            const { agent, storage, context } =
                await createAgentHarness(reloadAgentSchema);

            const result = await agent.executeAction?.(
                {
                    schemaName: "powershell",
                    actionName: "createAndExecutePowerShellFlow",
                    parameters: {
                        actionName: "reloadFailure",
                        description: "A flow that cannot be activated",
                        script: "Write-Output 'executed'",
                        allowedCmdlets: ["Write-Output"],
                        executionParametersJson: "{}",
                    },
                },
                context,
            );

            expect(reloadAgentSchema).toHaveBeenCalledTimes(1);
            expect(result).toMatchObject({
                error: expect.stringContaining("could not be activated"),
                errorCode: "powershell.partialSideEffects",
                mayHaveSideEffects: true,
            });
            expect(await storage.list("pending")).toEqual([]);
            expect(await storage.exists("flows/reloadFailure.flow.json")).toBe(
                false,
            );
        },
    );

    itOnWindows("cancels execution and removes the pending draft", async () => {
        const controller = new AbortController();
        const { agent, storage, context } = await createAgentHarness(
            undefined,
            controller.signal,
        );

        const execution = agent.executeAction?.(
            {
                schemaName: "powershell",
                actionName: "createAndExecutePowerShellFlow",
                parameters: {
                    actionName: "cancelledDraft",
                    description: "A flow cancelled during execution",
                    script: "Start-Sleep -Seconds 30",
                    allowedCmdlets: ["Start-Sleep"],
                    executionParametersJson: "{}",
                },
            },
            context,
        );
        setTimeout(() => controller.abort(), 250);

        await expect(execution).rejects.toMatchObject({
            name: "AbortError",
        });
        expect(await storage.list("pending")).toEqual([]);
        expect(await storage.exists("flows/cancelledDraft.flow.json")).toBe(
            false,
        );
    });

    itOnWindows(
        "deduplicates concurrent creation and reuses the winning flow",
        async () => {
            const { agent, storage, context } = await createAgentHarness();
            const create = (value: string) =>
                agent.executeAction?.(
                    {
                        schemaName: "powershell",
                        actionName: "createAndExecutePowerShellFlow",
                        parameters: {
                            actionName: "concurrentFlow",
                            description: "Return a concurrent value",
                            script: "param([string]$Value)\nWrite-Output $Value",
                            scriptParameters: [
                                {
                                    name: "Value",
                                    type: "string",
                                    required: true,
                                    description: "Value to return",
                                },
                            ],
                            allowedCmdlets: ["Write-Output"],
                            executionParametersJson: JSON.stringify({
                                Value: value,
                            }),
                        },
                    },
                    context,
                );

            const [first, second] = await Promise.all([
                create("first"),
                create("second"),
            ]);

            expect(first).not.toHaveProperty("error");
            expect(second).not.toHaveProperty("error");
            expect(await storage.list("pending")).toEqual([]);
            expect(await storage.exists("flows/concurrentFlow.flow.json")).toBe(
                true,
            );
        },
    );

    itOnWindows(
        "repairs a stale flow once and keeps the repaired script",
        async () => {
            const { agent, storage, context } = await createAgentHarness();
            await agent.executeAction?.(
                {
                    schemaName: "powershell",
                    actionName: "createAndExecutePowerShellFlow",
                    parameters: {
                        actionName: "repairableFlow",
                        description: "A repairable flow",
                        script: "Write-Output 'original'",
                        allowedCmdlets: ["Write-Output"],
                        executionParametersJson: "{}",
                    },
                },
                context,
            );

            const repaired = await agent.executeAction?.(
                {
                    schemaName: "powershell",
                    actionName: "repairAndExecutePowerShellFlow",
                    parameters: {
                        flowName: "repairableFlow",
                        script: "Write-Output 'repaired'",
                        allowedCmdlets: ["Write-Output"],
                        executionParametersJson: "{}",
                    },
                },
                context,
            );
            const secondRepair = await agent.executeAction?.(
                {
                    schemaName: "powershell",
                    actionName: "repairAndExecutePowerShellFlow",
                    parameters: {
                        flowName: "repairableFlow",
                        script: "throw 'second repair'",
                        allowedCmdlets: [],
                        executionParametersJson: "{}",
                    },
                },
                context,
            );

            expect(repaired).not.toHaveProperty("error");
            expect(JSON.stringify(repaired)).toContain("repaired");
            await expect(
                storage.read("flows/repairableFlow.flow.json", "utf8"),
            ).resolves.toContain('"originalType": "reasoning"');
            await expect(
                storage.read("flows/repairableFlow.flow.json", "utf8"),
            ).resolves.toContain('"type": "edited"');
            expect(secondRepair).toMatchObject({
                errorCode: "powershell.policyDenied",
                retryable: false,
            });
        },
    );

    itOnWindows("reloads a promoted flow in a new agent instance", async () => {
        const storage = new MemoryStorage();
        const first = await createAgentHarness(undefined, undefined, storage);
        const created = await first.agent.executeAction?.(
            {
                schemaName: "powershell",
                actionName: "createAndExecutePowerShellFlow",
                parameters: {
                    actionName: "persistentFlow",
                    description: "A flow persisted across agent instances",
                    script: "Write-Output 'persisted'",
                    allowedCmdlets: ["Write-Output"],
                    executionParametersJson: "{}",
                },
            },
            first.context,
        );
        expect(created).not.toHaveProperty("error");

        const second = await createAgentHarness(undefined, undefined, storage);
        const reused = await second.agent.executeAction?.(
            {
                schemaName: "powershell",
                actionName: "persistentFlow",
                parameters: {},
            },
            second.context,
        );

        expect(reused).not.toHaveProperty("error");
    });

    itOnWindows(
        "accepts a short path alias for an allowed long path",
        async () => {
            const result = await executeReviewedStaticScript({
                script: "param([string]$Path)\nGet-Item -LiteralPath $Path",
                parameters: { Path: "C:\\PROGRA~1" },
                parameterRoles: { Path: "path" },
                sandbox: {
                    allowedCmdlets: ["Get-Item"],
                    allowedPaths: ["C:\\Program Files"],
                    allowedModules: [],
                    maxExecutionTime: 10,
                    networkAccess: false,
                },
            });

            expect(result.success).toBe(true);
            expect(result.stderr).toBe("");
        },
    );

    it("denies an unknown script provenance", async () => {
        const request = {
            script: "Write-Output 'blocked'",
            parameters: {},
            provenance: "unknown",
            sandbox: {
                allowedCmdlets: ["Write-Output"],
                allowedPaths: [],
                allowedModules: [],
                maxExecutionTime: 10,
                networkAccess: false,
            },
        } as unknown as ScriptExecutionRequest;

        await expect(executeScript(request)).resolves.toMatchObject({
            success: false,
            stdout: "",
            stderr: expect.stringMatching(/provenance is missing or unknown/i),
        });
    });

    it("denies missing script provenance", async () => {
        const request: ScriptExecutionRequest = {
            script: "Write-Output 'blocked'",
            parameters: {},
            sandbox: {
                allowedCmdlets: ["Write-Output"],
                allowedPaths: [],
                allowedModules: [],
                maxExecutionTime: 10,
                networkAccess: false,
            },
        };

        await expect(executeScript(request)).resolves.toMatchObject({
            success: false,
            stdout: "",
            stderr: expect.stringMatching(/provenance is missing or unknown/i),
        });
    });

    itOnWindows(
        "blocks writes to non-existent paths outside the sandbox",
        async () => {
            const directory = await mkdtemp(
                join(tmpdir(), "typeagent-powershell-path-policy-"),
            );
            const allowedDirectory = join(directory, "allowed");
            const blockedPath = join(
                directory,
                "allowed-sibling",
                "blocked.txt",
            );
            try {
                await mkdir(allowedDirectory);

                const result = await executeReviewedStaticScript({
                    script: `param([string]$Path)
Set-Content -LiteralPath $Path -Value "blocked"`,
                    parameters: { Path: blockedPath },
                    parameterRoles: { Path: "path" },
                    sandbox: {
                        allowedCmdlets: ["Set-Content"],
                        allowedPaths: [allowedDirectory],
                        allowedModules: [],
                        maxExecutionTime: 10,
                        networkAccess: false,
                    },
                });

                expect(result.success).toBe(false);
                expect(result.stderr).toMatch(/Path access\s+denied/i);
                await expect(readFile(blockedPath, "utf8")).rejects.toThrow();
            } finally {
                await rm(directory, { recursive: true, force: true });
            }
        },
    );

    itOnWindows(
        "does not start a requested native program without authorization",
        async () => {
            const { agent, storage, context } = await createAgentHarness(
                undefined,
                undefined,
                new MemoryStorage(),
                async () => 1,
            );

            const result = await agent.executeAction?.(
                {
                    schemaName: "powershell",
                    actionName: "createAndExecutePowerShellFlow",
                    parameters: {
                        actionName: "startNamedExecutable",
                        description: "Start a named executable",
                        script: `param([string]$Path)
Start-Process -FilePath $Path`,
                        scriptParameters: [
                            {
                                name: "Path",
                                type: "executable",
                                required: true,
                                description: "Executable to start",
                            },
                        ],
                        allowedCmdlets: ["Start-Process"],
                        executionParametersJson: JSON.stringify({
                            Path: "powershell.exe",
                        }),
                    },
                },
                context,
            );

            expect(result).toMatchObject({
                errorCode: "powershell.policyDenied",
                retryable: false,
            });
            expect(result?.error).toMatch(/not authorized/i);
            expect(await storage.list("pending")).toEqual([]);
            expect(
                await storage.exists("flows/startNamedExecutable.flow.json"),
            ).toBe(false);
        },
    );

    itOnWindows(
        "returns partial side effects when repair persistence fails",
        async () => {
            const { agent, storage, context } = await createAgentHarness();
            await agent.executeAction?.(
                {
                    schemaName: "powershell",
                    actionName: "createAndExecutePowerShellFlow",
                    parameters: {
                        actionName: "updateFailureFlow",
                        description: "Test repair persistence failure",
                        script: "Write-Output 'original'",
                        allowedCmdlets: ["Write-Output"],
                        executionParametersJson: "{}",
                    },
                },
                context,
            );
            storage.failWriteAfter(
                "flows/updateFailureFlow.flow.json",
                0,
                new Error("flow definition update failed"),
            );

            const result = await agent.executeAction?.(
                {
                    schemaName: "powershell",
                    actionName: "repairAndExecutePowerShellFlow",
                    parameters: {
                        flowName: "updateFailureFlow",
                        script: "Write-Output 'repaired'",
                        allowedCmdlets: ["Write-Output"],
                        executionParametersJson: "{}",
                    },
                },
                context,
            );

            expect(result).toMatchObject({
                errorCode: "powershell.partialSideEffects",
                retryable: false,
                mayHaveSideEffects: true,
                error: expect.stringContaining("flow definition update failed"),
            });
            await expect(
                storage.read("scripts/updateFailureFlow.ps1", "utf8"),
            ).resolves.toBe("Write-Output 'original'");
        },
    );

    itOnWindows(
        "returns partial side effects when cancelled after repair execution",
        async () => {
            const controller = new AbortController();
            const { agent, storage, context } = await createAgentHarness(
                undefined,
                controller.signal,
            );
            await agent.executeAction?.(
                {
                    schemaName: "powershell",
                    actionName: "createAndExecutePowerShellFlow",
                    parameters: {
                        actionName: "postExecutionCancellation",
                        description: "Test post-execution cancellation",
                        script: "Write-Output 'original'",
                        allowedCmdlets: ["Write-Output"],
                        executionParametersJson: "{}",
                    },
                },
                context,
            );
            storage.afterNextWrite("index.json", () => controller.abort());

            const result = await agent.executeAction?.(
                {
                    schemaName: "powershell",
                    actionName: "repairAndExecutePowerShellFlow",
                    parameters: {
                        flowName: "postExecutionCancellation",
                        script: "Write-Output 'repaired'",
                        allowedCmdlets: ["Write-Output"],
                        executionParametersJson: "{}",
                    },
                },
                context,
            );

            expect(result).toMatchObject({
                errorCode: "powershell.partialSideEffects",
                retryable: false,
                mayHaveSideEffects: true,
                error: expect.stringContaining(
                    "before the repaired flow could be activated",
                ),
            });
            await expect(
                storage.read("scripts/postExecutionCancellation.ps1", "utf8"),
            ).resolves.toBe("Write-Output 'original'");
        },
    );

    itOnWindows("preserves success when usage accounting fails", async () => {
        const { agent, storage, sessionContext, context } =
            await createAgentHarness();
        await agent.executeAction?.(
            {
                schemaName: "powershell",
                actionName: "createAndExecutePowerShellFlow",
                parameters: {
                    actionName: "usageFailureFlow",
                    description: "Test usage accounting failure",
                    script: "Write-Output 'original'",
                    allowedCmdlets: ["Write-Output"],
                    executionParametersJson: "{}",
                },
            },
            context,
        );
        storage.failWriteAfter(
            "index.json",
            1,
            new Error("usage write failed"),
        );

        const result = await agent.executeAction?.(
            {
                schemaName: "powershell",
                actionName: "repairAndExecutePowerShellFlow",
                parameters: {
                    flowName: "usageFailureFlow",
                    script: "Write-Output 'repaired'",
                    allowedCmdlets: ["Write-Output"],
                    executionParametersJson: "{}",
                },
            },
            context,
        );

        expect(result).not.toHaveProperty("error");
        expect(sessionContext.notify).toHaveBeenCalledWith(
            AppAgentEvent.Warning,
            expect.stringContaining("usage accounting failed"),
        );
    });

    itOnWindows("serializes edits and repairs for the same flow", async () => {
        const { agent, storage, context } = await createAgentHarness();
        await agent.executeAction?.(
            {
                schemaName: "powershell",
                actionName: "createAndExecutePowerShellFlow",
                parameters: {
                    actionName: "serializedFlow",
                    description: "Test edit and repair serialization",
                    script: "Write-Output 'original'",
                    allowedCmdlets: ["Write-Output"],
                    executionParametersJson: "{}",
                },
            },
            context,
        );

        const blockedWrite = storage.blockNextWrite(
            "scripts/serializedFlow.ps1",
        );
        const edit = agent.executeAction?.(
            {
                schemaName: "powershell",
                actionName: "editPowerShellFlow",
                parameters: {
                    flowName: "serializedFlow",
                    script: "Write-Output 'edited'",
                    allowedCmdlets: ["Write-Output"],
                },
            },
            context,
        );
        await blockedWrite.started;

        const repair = agent.executeAction?.(
            {
                schemaName: "powershell",
                actionName: "repairAndExecutePowerShellFlow",
                parameters: {
                    flowName: "serializedFlow",
                    script: "Write-Output 'repaired'",
                    allowedCmdlets: ["Write-Output"],
                    executionParametersJson: "{}",
                },
            },
            context,
        );
        let repairCompleted = false;
        void repair?.then(() => {
            repairCompleted = true;
        });
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(repairCompleted).toBe(false);

        blockedWrite.release();
        expect(await edit).not.toHaveProperty("error");
        expect(await repair).not.toHaveProperty("error");
        await expect(
            storage.read("scripts/serializedFlow.ps1", "utf8"),
        ).resolves.toContain("repaired");
    });
});
