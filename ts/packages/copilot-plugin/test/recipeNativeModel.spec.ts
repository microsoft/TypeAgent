// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
    CopilotClient,
    RuntimeConnection,
    type CopilotSession,
    type SessionConfig,
    type SessionEvent,
} from "@github/copilot-sdk";
import {
    createNativeRecipeModelAdapter,
    createStandaloneNativeRecipeModels,
    type NativeRecipeInferenceEvidence,
    type NativeRecipeModelAdapter,
} from "../src/extension/recipe-native-model.js";
import { captureNativeRecipeBinding } from "../src/extension/recipe-native-host.js";
import {
    deferred,
    nativeEvent,
    nativeFixture,
} from "./recipeNativeFixtures.js";

function modelFixture() {
    const parent = nativeFixture();
    const evidence: NativeRecipeInferenceEvidence[] = [];
    const children: ReturnType<typeof nativeFixture>[] = [];
    const configs: SessionConfig[] = [];
    const disconnect = jest.fn(async () => {});
    let history: SessionEvent[] = [];
    let offeredTools = false;
    let usageCount = 1;
    let toolCount = 0;
    let result = "candidate";
    let send: (
        child: ReturnType<typeof nativeFixture>,
    ) => Promise<unknown> = async (child) => {
        for (let i = 0; i < usageCount; i++)
            child.emit("assistant.usage", {
                model: "actual-host-selection",
                inputTokens: 20,
                outputTokens: 5,
            });
        for (let i = 0; i < toolCount; i++)
            child.emit("tool.execution_start", { toolName: "not-allowed" });
        return { data: { content: result } };
    };
    const sends = jest.fn(async (child: ReturnType<typeof nativeFixture>) =>
        send(child),
    );
    const createSession = jest.fn(async (config: SessionConfig) => {
        configs.push(config);
        const child = nativeFixture(config.sessionId);
        if (!offeredTools) child.tools.length = 0;
        children.push(child);
        return Object.assign(child.session, {
            getEvents: async () => history,
            sendAndWait: async () => sends(child),
            abort: child.abort,
            disconnect,
        }) as unknown as CopilotSession;
    });
    return {
        parent,
        evidence,
        children,
        configs,
        createSession,
        sends,
        disconnect,
        history: (value: SessionEvent[]) => {
            history = value;
        },
        offeredTools: () => {
            offeredTools = true;
        },
        usageCount: (value: number) => {
            usageCount = value;
        },
        toolCount: (value: number) => {
            toolCount = value;
        },
        result: (value: string) => {
            result = value;
        },
        send: (value: typeof send) => {
            send = value;
        },
        async adapter() {
            const binding = await captureNativeRecipeBinding(parent.session);
            return createNativeRecipeModelAdapter(parent.session, binding, {
                client: { createSession },
                timeoutMs: 100,
                onEvidence: (item) => evidence.push(item),
            });
        },
    };
}

async function withStandalone(
    f: ReturnType<typeof modelFixture>,
    action: (adapter: NativeRecipeModelAdapter) => Promise<void>,
) {
    const binding = await captureNativeRecipeBinding(f.parent.session);
    const start = jest
        .spyOn(CopilotClient.prototype, "start")
        .mockResolvedValue(undefined);
    const stop = jest
        .spyOn(CopilotClient.prototype, "stop")
        .mockResolvedValue([]);
    const create = jest
        .spyOn(CopilotClient.prototype, "createSession")
        .mockImplementation(f.createSession);
    let adapter: NativeRecipeModelAdapter | undefined;
    try {
        adapter = await createStandaloneNativeRecipeModels(
            f.parent.session,
            binding,
            {
                cliPath: process.execPath,
                timeoutMs: 100,
                onEvidence: (item) => f.evidence.push(item),
            },
        );
        await action(adapter);
    } finally {
        await adapter?.dispose();
        start.mockRestore();
        stop.mockRestore();
        create.mockRestore();
    }
}

describe("independent native inference", () => {
    it("refreshes stale startup and between-call generations only in the standalone facade", async () => {
        const f = modelFixture();
        await withStandalone(f, async (adapter) => {
            f.parent.emit("session.tools_updated");
            expect(await adapter.query("first")).toBe("candidate");
            f.parent.emit("session.mcp_server_status_changed");
            expect(await adapter.query("second")).toBe("candidate");
            expect(f.children).toHaveLength(2);
        });
    });

    it("refreshes standalone provider complete without changing the strict provider contract", async () => {
        const f = modelFixture();
        await withStandalone(f, async (adapter) => {
            f.parent.emit("session.tools_updated");
            const result = await adapter.provider.complete({
                definition: {
                    id: "semantic",
                    revision: "1",
                    modelPolicy: { id: "copilot-local", revision: "1" },
                    specification: {
                        id: "spec",
                        revision: "1",
                        task: "Return null.",
                        rubric: "null",
                    },
                    inputSchema: { type: "null" },
                    outputSchema: { type: "null" },
                    bounds: {
                        timeoutMs: 100,
                        maxInputBytes: 1000,
                        maxOutputBytes: 1000,
                        maxCalls: 1,
                        maxConcurrency: 1,
                        maxRepairAttempts: 0,
                    },
                    evidence: { sourceIds: "none", quotations: false },
                },
                input: null,
                attempt: 0,
                signal: new AbortController().signal,
            });
            expect(result).toMatchObject({ kind: "json", text: "candidate" });
        });
    });

    it("does not refresh a root generation changed during inference", async () => {
        const f = modelFixture();
        f.send(async (child) => {
            f.parent.emit("session.tools_updated");
            child.emit("assistant.usage", {
                model: "host-selected",
                inputTokens: 10,
                outputTokens: 2,
            });
            return { data: { content: "late" } };
        });
        await withStandalone(f, async (adapter) => {
            await expect(adapter.query("input")).rejects.toThrow(
                /binding changed during/,
            );
            expect(f.evidence).toHaveLength(0);
        });
    });

    it("ignores child lifecycle events without contaminating root generation", async () => {
        const f = modelFixture();
        f.send(async (child) => {
            f.parent.emit("session.tools_updated", {}, child.session.sessionId);
            child.emit("assistant.usage", {
                model: "host-selected",
                inputTokens: 10,
                outputTokens: 2,
            });
            return { data: { content: "isolated" } };
        });
        await withStandalone(f, async (adapter) => {
            expect(await adapter.query("input")).toBe("isolated");
        });
    });

    it.each(["account", "workspace"])(
        "never refreshes a changed standalone owner %s",
        async (kind) => {
            const f = modelFixture();
            await withStandalone(f, async (adapter) => {
                if (kind === "account") f.parent.auth.login = "switched";
                else f.parent.metadata.workingDirectory += "\\other";
                await expect(adapter.query("input")).rejects.toThrow(
                    /owner identity changed/,
                );
                expect(f.children).toHaveLength(0);
            });
        },
    );

    it("keeps the public static-bound adapter strict across between-call generation changes", async () => {
        const f = modelFixture();
        const adapter = await f.adapter();
        f.parent.emit("session.tools_updated");
        await expect(adapter.query("input")).rejects.toThrow(
            /parent binding changed/,
        );
        expect(f.children).toHaveLength(0);
    });

    it.each([undefined, path.resolve("native-cli", "copilot.exe")])(
        "passes an explicit installed executable to stdio (override: %s)",
        async (cliPath) => {
            const f = modelFixture();
            const binding = await captureNativeRecipeBinding(f.parent.session);
            const directory = path.join(
                process.cwd(),
                `.recipe-cli-test-${randomUUID()}`,
            );
            await mkdir(directory);
            const executable = path.join(
                directory,
                process.platform === "win32" ? "copilot.exe" : "copilot",
            );
            await writeFile(executable, "", { mode: 0o755 });
            const environment = jest.replaceProperty(process, "env", {
                ...process.env,
                PATH: directory,
            });
            const connection = jest.spyOn(RuntimeConnection, "forStdio");
            const start = jest
                .spyOn(CopilotClient.prototype, "start")
                .mockResolvedValue(undefined);
            const stop = jest
                .spyOn(CopilotClient.prototype, "stop")
                .mockResolvedValue([]);
            try {
                const adapter = await createStandaloneNativeRecipeModels(
                    f.parent.session,
                    binding,
                    cliPath ? { cliPath } : {},
                );
                expect(connection).toHaveBeenCalledWith(
                    expect.objectContaining({
                        path: cliPath ?? executable,
                    }),
                );
                expect(connection.mock.calls[0]?.[0]?.args).toBeUndefined();
                await adapter.dispose();
                expect(stop).toHaveBeenCalledTimes(1);
            } finally {
                connection.mockRestore();
                start.mockRestore();
                stop.mockRestore();
                environment.restore();
                await rm(directory, { recursive: true, force: true });
            }
        },
    );

    it("fails closed without an installed executable instead of trying SDK runtime packages", async () => {
        const f = modelFixture();
        const binding = await captureNativeRecipeBinding(f.parent.session);
        const environment = jest.replaceProperty(process, "env", {
            ...process.env,
            PATH: "",
        });
        const connection = jest.spyOn(RuntimeConnection, "forStdio");
        try {
            await expect(
                createStandaloneNativeRecipeModels(f.parent.session, binding),
            ).rejects.toThrow(/not found on PATH/);
            expect(connection).not.toHaveBeenCalled();
        } finally {
            environment.restore();
            connection.mockRestore();
        }
    });

    it("fails explicitly without a supported owning-client session factory", async () => {
        const f = modelFixture();
        const binding = await captureNativeRecipeBinding(f.parent.session);
        await expect(
            createNativeRecipeModelAdapter(f.parent.session, binding),
        ).rejects.toThrow(/unsupported-native-isolation/);
        expect(f.createSession).not.toHaveBeenCalled();
    });

    it("creates a fresh tools-disabled session per request without model pinning", async () => {
        const f = modelFixture();
        const adapter = await f.adapter();
        expect(await adapter.query("bounded input")).toBe("candidate");
        expect(await adapter.query("independent verifier input")).toBe(
            "candidate",
        );
        expect(f.configs).toHaveLength(2);
        expect(f.configs[0]?.sessionId).not.toBe(f.configs[1]?.sessionId);
        for (const config of f.configs) {
            expect(config.tools).toEqual([]);
            expect(config.availableTools).toEqual([]);
            expect(config.requestExtensions).toBe(false);
            expect(config.enableConfigDiscovery).toBe(false);
            expect(config.enableSkills).toBe(false);
            expect(config.enableSessionStore).toBe(false);
            expect(config.model).toBeUndefined();
            expect(config.provider).toBeUndefined();
            expect(config.gitHubToken).toBeUndefined();
        }
        expect(f.evidence[0]).toMatchObject({
            parentSessionId: "root",
            modelCalls: 1,
            toolCalls: 0,
            resolvedModel: "actual-host-selection",
            inputTokens: 20,
            outputTokens: 5,
            isolation: "fresh-tools-disabled-session",
        });
        expect(f.parent.abort).not.toHaveBeenCalled();
        await adapter.dispose();
    });

    it.each(["history", "tools"])(
        "rejects %s contamination before inference",
        async (kind) => {
            const f = modelFixture();
            if (kind === "history")
                f.history([
                    nativeEvent("user.message", {
                        content: "SOURCE_ONLY_CANARY",
                    }),
                ]);
            else f.offeredTools();
            const adapter = await f.adapter();
            await expect(adapter.query("source blind input")).rejects.toThrow(
                /tools or conversation/,
            );
            expect(f.sends).not.toHaveBeenCalled();
        },
    );

    it("never accepts missing or multiple model usage as a single inference", async () => {
        const f = modelFixture();
        const adapter = await f.adapter();
        f.usageCount(0);
        await expect(adapter.query("input")).rejects.toThrow(/exactly one/);
        f.usageCount(2);
        await expect(adapter.query("input")).rejects.toThrow(/exactly one/);
        expect(f.createSession).toHaveBeenCalledTimes(2);
    });

    it("rejects business tool use rather than claiming a tools-disabled inference", async () => {
        const f = modelFixture();
        f.toolCount(1);
        const adapter = await f.adapter();
        await expect(adapter.query("input")).rejects.toThrow(/zero tools/);
    });

    it("cancels only the exact adapter-created session and suppresses late text", async () => {
        const f = modelFixture();
        const started = deferred<void>();
        const late = deferred<unknown>();
        f.send(async () => {
            started.resolve();
            return late.promise;
        });
        const adapter = await f.adapter();
        const controller = new AbortController();
        const query = adapter.query("input", controller.signal);
        await started.promise;
        controller.abort();
        await expect(query).rejects.toThrow(/cancelled/);
        expect(f.children[0]?.abort).toHaveBeenCalledTimes(1);
        expect(f.parent.abort).not.toHaveBeenCalled();
        late.resolve({ data: { content: "late candidate" } });
        expect(f.evidence).toHaveLength(0);
    });

    it("bounds late session creation without leaking or cancelling the parent", async () => {
        const f = modelFixture();
        const created = deferred<CopilotSession>();
        const original = f.createSession.getMockImplementation()!;
        f.createSession.mockImplementation(async (config) => {
            await created.promise;
            return original(config);
        });
        const adapter = await f.adapter();
        const controller = new AbortController();
        const pending = adapter.query("input", controller.signal);
        await new Promise((resolve) => setTimeout(resolve, 5));
        controller.abort();
        await expect(pending).rejects.toThrow(/cancelled/);
        created.resolve({} as CopilotSession);
        await new Promise((resolve) => setTimeout(resolve, 5));
        expect(f.disconnect).toHaveBeenCalledTimes(1);
        expect(f.sends).not.toHaveBeenCalled();
        expect(f.parent.abort).not.toHaveBeenCalled();
    });

    it("rejects account and parent generation changes without retries", async () => {
        const f = modelFixture();
        const adapter = await f.adapter();
        f.parent.auth.login = "switched";
        await expect(adapter.query("input")).rejects.toThrow(/binding changed/);
        expect(f.createSession).not.toHaveBeenCalled();
    });

    it("never aborts or disconnects a factory result pointing at the parent session", async () => {
        const f = modelFixture();
        f.createSession.mockImplementation(
            async () => f.parent.session as unknown as CopilotSession,
        );
        const adapter = await f.adapter();
        await expect(adapter.query("input")).rejects.toThrow(
            /fresh session identity/,
        );
        expect(f.parent.abort).not.toHaveBeenCalled();
        expect(f.parent.shutdown).not.toHaveBeenCalled();
        expect(f.disconnect).not.toHaveBeenCalled();
    });

    it("refuses concurrent calls and disposal stops only its exact child", async () => {
        const f = modelFixture();
        const started = deferred<void>();
        const late = deferred<unknown>();
        f.send(async () => {
            started.resolve();
            return late.promise;
        });
        const adapter = await f.adapter();
        const pending = adapter.query("input");
        await started.promise;
        await expect(adapter.query("another")).rejects.toThrow(/busy/);
        await adapter.dispose();
        await expect(pending).rejects.toThrow(/cancelled/);
        expect(f.children[0]?.abort).toHaveBeenCalledTimes(1);
        expect(f.parent.abort).not.toHaveBeenCalled();
        late.resolve({ data: { content: "late" } });
    });
});
