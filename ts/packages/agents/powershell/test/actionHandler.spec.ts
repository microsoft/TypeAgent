import type {
    ActionContext,
    SessionContext,
    Storage,
    TokenCachePersistence,
} from "@typeagent/agent-sdk";
import { jest } from "@jest/globals";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { instantiate } from "../src/actionHandler.mjs";

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
): SessionContext {
    return {
        agentContext: {},
        sessionStorage: storage,
        instanceStorage: storage,
        sessionContextId: "powershell-action-handler-test",
        notify: jest.fn(),
        beginAgentThread: jest.fn(),
        popupQuestion: jest.fn(),
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
        isFromReasoningLoop: true,
        queueToggleTransientAgent: async () => {},
    };
}

async function createAgentHarness(reloadAgentSchema?: () => Promise<void>) {
    const storage = new MemoryStorage();
    const sessionContext = createSessionContext(storage, reloadAgentSchema);
    const agent = instantiate();
    await agent.initializeAgentContext?.();
    await agent.updateAgentContext?.(true, sessionContext, "powershell");
    return {
        agent,
        storage,
        sessionContext,
        context: createActionContext(sessionContext),
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
            });
        });

        it("executes portListeners without requiring a dynamic flow", async () => {
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
        });
    });

    afterAll(() => {
        if (originalNoSamples === undefined) {
            delete process.env.TYPEAGENT_NO_SAMPLES;
        } else {
            process.env.TYPEAGENT_NO_SAMPLES = originalNoSamples;
        }
    });

    it("removes the pending draft when execution fails", async () => {
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

    it("executes once and promotes only after successful execution", async () => {
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
    });

    it("removes the promoted flow when schema reload fails", async () => {
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
        });
        expect(await storage.list("pending")).toEqual([]);
        expect(await storage.exists("flows/reloadFailure.flow.json")).toBe(
            false,
        );
    });
});
