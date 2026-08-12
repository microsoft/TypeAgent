// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    ActionContext,
    SessionContext,
    Storage,
    TokenCachePersistence,
} from "@typeagent/agent-sdk";
import { jest } from "@jest/globals";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { instantiate } from "../src/actionHandler.mjs";
import { executeScript } from "../src/execution/powershellRunner.mjs";
import {
    getRegisteredNamespaceActions,
    hasNamespaceAction,
} from "../src/namespaces/actionHandlerRegistry.mjs";

const itOnWindows = process.platform === "win32" ? it : it.skip;

class MemoryStorage implements Storage {
    private readonly files = new Map<string, string>();

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
        this.files.set(
            path,
            typeof data === "string" ? data : new TextDecoder().decode(data),
        );
    }

    async delete(path: string): Promise<void> {
        this.files.delete(path);
    }

    async exists(path: string): Promise<boolean> {
        return this.files.has(path);
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
    popupQuestion: SessionContext["popupQuestion"] = async () => 1,
): SessionContext {
    return {
        agentContext: {},
        sessionStorage: storage,
        instanceStorage: storage,
        sessionContextId: "powershell-action-handler-test",
        notify: jest.fn(),
        beginAgentThread: jest.fn(),
        popupQuestion,
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

describe("createAndExecutePowerShellFlow", () => {
    const originalNoSamples = process.env.TYPEAGENT_NO_SAMPLES;

    beforeAll(() => {
        process.env.TYPEAGENT_NO_SAMPLES = "1";
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
    });

    describe("static network actions", () => {
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

    afterAll(() => {
        if (originalNoSamples === undefined) {
            delete process.env.TYPEAGENT_NO_SAMPLES;
        } else {
            process.env.TYPEAGENT_NO_SAMPLES = originalNoSamples;
        }
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
            error: expect.stringContaining("draft failed"),
        });
        expect(await storage.list("pending")).toEqual([]);
        expect(await storage.exists("flows/failingDraft.flow.json")).toBe(
            false,
        );
    });

    itOnWindows(
        "executes once and promotes only after successful execution",
        async () => {
            const directory = await mkdtemp(
                join(tmpdir(), "typeagent-powershell-flow-"),
            );
            const outputPath = join(directory, "executions.txt");
            try {
                const { agent, storage, context } = await createAgentHarness();

                const result = await agent.executeAction?.(
                    {
                        schemaName: "powershell",
                        actionName: "createAndExecutePowerShellFlow",
                        parameters: {
                            actionName: "successfulDraft",
                            description: "Record one execution",
                            script: "param([string]$Path)\nAdd-Content -LiteralPath $Path -Value 'run'",
                            scriptParameters: [
                                {
                                    name: "Path",
                                    type: "path",
                                    required: true,
                                    description: "Output file",
                                },
                            ],
                            allowedCmdlets: ["Add-Content"],
                            executionParametersJson: JSON.stringify({
                                Path: outputPath,
                            }),
                        },
                    },
                    context,
                );

                expect(result).not.toHaveProperty("error");
                expect(await storage.list("pending")).toEqual([]);
                expect(
                    await storage.exists("flows/successfulDraft.flow.json"),
                ).toBe(true);
                expect(
                    (await readFile(outputPath, "utf8")).trim().split(/\r?\n/),
                ).toEqual(["run"]);
            } finally {
                await rm(directory, { recursive: true, force: true });
            }
        },
    );

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
            const directory = await mkdtemp(
                join(tmpdir(), "typeagent-powershell-concurrent-"),
            );
            const firstPath = join(directory, "first.txt");
            const secondPath = join(directory, "second.txt");
            try {
                const { agent, storage, context } = await createAgentHarness();
                const create = (outputPath: string) =>
                    agent.executeAction?.(
                        {
                            schemaName: "powershell",
                            actionName: "createAndExecutePowerShellFlow",
                            parameters: {
                                actionName: "concurrentFlow",
                                description: "Record a concurrent execution",
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

                const [first, second] = await Promise.all([
                    create(firstPath),
                    create(secondPath),
                ]);

                expect(first).not.toHaveProperty("error");
                expect(second).not.toHaveProperty("error");
                expect(await storage.list("pending")).toEqual([]);
                expect(
                    await storage.exists("flows/concurrentFlow.flow.json"),
                ).toBe(true);
                expect(await readFile(firstPath, "utf8")).toContain("run");
                expect(await readFile(secondPath, "utf8")).toContain("run");
            } finally {
                await rm(directory, { recursive: true, force: true });
            }
        },
    );

    itOnWindows(
        "repairs a stale flow once and keeps the repaired script",
        async () => {
            const directory = await mkdtemp(
                join(tmpdir(), "typeagent-powershell-repair-"),
            );
            const outputPath = join(directory, "repair.txt");
            try {
                const { agent, context } = await createAgentHarness();
                await agent.executeAction?.(
                    {
                        schemaName: "powershell",
                        actionName: "createAndExecutePowerShellFlow",
                        parameters: {
                            actionName: "repairableFlow",
                            description: "A repairable flow",
                            script: "param([string]$Path)\nSet-Content -LiteralPath $Path -Value 'original'",
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

                const repaired = await agent.executeAction?.(
                    {
                        schemaName: "powershell",
                        actionName: "repairAndExecutePowerShellFlow",
                        parameters: {
                            flowName: "repairableFlow",
                            script: "param([string]$Path)\nSet-Content -LiteralPath $Path -Value 'repaired'",
                            allowedCmdlets: ["Set-Content"],
                            executionParametersJson: JSON.stringify({
                                Path: outputPath,
                            }),
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
                            executionParametersJson: JSON.stringify({
                                Path: outputPath,
                            }),
                        },
                    },
                    context,
                );

                expect(repaired).not.toHaveProperty("error");
                expect((await readFile(outputPath, "utf8")).trim()).toBe(
                    "repaired",
                );
                expect(secondRepair).toMatchObject({
                    errorCode: "powershell.policyDenied",
                    retryable: false,
                });
            } finally {
                await rm(directory, { recursive: true, force: true });
            }
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
            const result = await executeScript({
                script: "param([string]$Path)\nGet-Item -LiteralPath $Path",
                parameters: { Path: "C:\\PROGRA~1" },
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

                const result = await executeScript({
                    script: `param([string]$Path)
Set-Content -LiteralPath $Path -Value "blocked"`,
                    parameters: { Path: blockedPath },
                    sandbox: {
                        allowedCmdlets: ["Set-Content"],
                        allowedPaths: [allowedDirectory],
                        allowedModules: [],
                        maxExecutionTime: 10,
                        networkAccess: false,
                    },
                });

                expect(result.success).toBe(false);
                expect(result.stderr).toMatch(/Path access denied/i);
                await expect(readFile(blockedPath, "utf8")).rejects.toThrow();
            } finally {
                await rm(directory, { recursive: true, force: true });
            }
        },
    );
});
