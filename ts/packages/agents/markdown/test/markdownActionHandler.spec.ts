// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ActionContext } from "@typeagent/agent-sdk";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    configFromEnvRecord,
    getRuntimeConfig,
    setRuntimeConfig,
} from "@typeagent/aiclient";
import {
    instantiate,
    reconcileViewBinding,
} from "../src/agent/markdownActionHandler.js";
import { createMarkdownAgent } from "../src/agent/translator.js";

describe("markdown document actions", () => {
    test.each(["createDocument", "openDocument"] as const)(
        "%s works without model configuration",
        async (actionName) => {
            const workspace = fs.mkdtempSync(
                path.join(os.tmpdir(), "typeagent-markdown-model-free-"),
            );
            const savedModelSettings = Object.entries(process.env).filter(
                ([key]) =>
                    key.startsWith("AZURE_OPENAI_") ||
                    key.startsWith("OPENAI_") ||
                    key.startsWith("OLLAMA_") ||
                    key === "TYPEAGENT_MODEL_PROVIDER",
            );
            for (const [key] of savedModelSettings) {
                delete process.env[key];
            }

            const fullPath = path.join(fs.realpathSync(workspace), "notes.md");
            const context = {
                workingDirectory: workspace,
                sessionContext: {
                    agentContext: { localHostPort: 0 },
                    sessionStorage: undefined,
                },
            } as unknown as ActionContext<{
                currentFileName?: string;
                localHostPort: number;
            }>;

            try {
                const result = await instantiate().executeAction!(
                    {
                        schemaName: "markdown",
                        actionName,
                        parameters: { name: "notes" },
                    },
                    context,
                );

                if (result === undefined) {
                    throw new Error("Expected a document creation result");
                }
                if ("error" in result) {
                    throw new Error(result.error);
                }
                expect(fs.readFileSync(fullPath, "utf-8")).toBe("");
                expect(result.tokenUsage).toEqual({
                    prompt_tokens: 0,
                    completion_tokens: 0,
                    total_tokens: 0,
                });
                expect(result.resultEntity).toEqual({
                    name: "notes.md",
                    type: ["file", "markdown"],
                });
                expect(result.historyText).toBe(
                    `Document created at ${fullPath}`,
                );
            } finally {
                for (const [key, value] of savedModelSettings) {
                    process.env[key] = value;
                }
                fs.rmSync(workspace, { recursive: true, force: true });
            }
        },
    );

    test("constructs its update model from typed configuration", async () => {
        const originalConfig = getRuntimeConfig();
        const openAIKey = process.env.OPENAI_API_KEY;
        delete process.env.OPENAI_API_KEY;
        setRuntimeConfig(
            configFromEnvRecord({
                AZURE_OPENAI_ENDPOINT_GPT_4_O_EASTUS:
                    "https://markdown-model.example",
                AZURE_OPENAI_API_KEY_GPT_4_O_EASTUS: "identity",
            }),
        );

        try {
            const agent = await createMarkdownAgent("GPT_4_O");
            expect(agent.model).toBeDefined();
        } finally {
            setRuntimeConfig(originalConfig);
            if (openAIKey === undefined) {
                delete process.env.OPENAI_API_KEY;
            } else {
                process.env.OPENAI_API_KEY = openAIKey;
            }
        }
    });

    describe("with a host-authorized workingDirectory", () => {
        type WorkspaceAgentContext = {
            currentFileName?: string | undefined;
            currentFilePath?: string | undefined;
            currentWorkspaceRoot?: string | undefined;
            viewProcess?: unknown;
            localHostPort: number;
        };

        let workspace: string;

        beforeEach(() => {
            workspace = fs.mkdtempSync(
                path.join(os.tmpdir(), "typeagent-markdown-agent-"),
            );
        });

        afterEach(() => {
            fs.rmSync(workspace, { recursive: true, force: true });
        });

        function buildContext(overrides?: {
            viewProcess?: unknown;
            localHostPort?: number;
        }): {
            context: ActionContext<WorkspaceAgentContext>;
            agentContext: WorkspaceAgentContext;
        } {
            const agentContext: WorkspaceAgentContext = {
                localHostPort: overrides?.localHostPort ?? 0,
                viewProcess: overrides?.viewProcess,
            };
            const context = {
                workingDirectory: workspace,
                sessionContext: {
                    agentContext,
                    sessionStorage: undefined,
                },
            } as unknown as ActionContext<WorkspaceAgentContext>;
            return { context, agentContext };
        }

        test("creates a document under the workspace root with initial content", async () => {
            const { context, agentContext } = buildContext();
            const result = await instantiate().executeAction!(
                {
                    schemaName: "markdown",
                    actionName: "createDocument",
                    parameters: {
                        name: "hello",
                        content: "# Hello",
                    },
                },
                context,
            );
            if (result === undefined || "error" in result) {
                throw new Error("Expected success result");
            }
            const expectedPath = path.join(
                fs.realpathSync(workspace),
                "hello.md",
            );
            expect(fs.readFileSync(expectedPath, "utf-8")).toBe("# Hello");
            expect(agentContext.currentFilePath).toBe(expectedPath);
            expect(agentContext.currentFileName).toBe("hello.md");
            expect(agentContext.currentWorkspaceRoot).toBe(
                fs.realpathSync(workspace),
            );
            expect(result.historyText).toBe(
                `Document created at ${expectedPath}`,
            );
        });

        test("creates the document under a relative subdirectory", async () => {
            const sent: unknown[] = [];
            const { context } = buildContext({
                viewProcess: {
                    send: (message: unknown) => sent.push(message),
                },
            });
            await instantiate().executeAction!(
                {
                    schemaName: "markdown",
                    actionName: "createDocument",
                    parameters: {
                        name: "notes/subdir/plan",
                        content: "body",
                    },
                },
                context,
            );
            const target = path.join(
                fs.realpathSync(workspace),
                "notes",
                "subdir",
                "plan.md",
            );
            expect(fs.readFileSync(target, "utf-8")).toBe("body");
            expect(sent).toEqual([
                {
                    type: "setFile",
                    workspaceRoot: fs.realpathSync(workspace),
                    relativePath: "notes/subdir/plan.md",
                },
            ]);
        });

        test.each([
            ["traversal segment", "../escape"],
            ["absolute path", "/tmp/escape"],
            ["windows drive", "C:evil"],
        ])("rejects %s", async (_label, badName) => {
            const { context } = buildContext();
            await expect(
                instantiate().executeAction!(
                    {
                        schemaName: "markdown",
                        actionName: "createDocument",
                        parameters: { name: badName },
                    },
                    context,
                ),
            ).rejects.toThrow(/safe relative path/);
        });

        test("refuses to overwrite an existing non-empty file", async () => {
            const target = path.join(fs.realpathSync(workspace), "keep.md");
            fs.writeFileSync(target, "already here");
            const { context } = buildContext();
            await expect(
                instantiate().executeAction!(
                    {
                        schemaName: "markdown",
                        actionName: "createDocument",
                        parameters: {
                            name: "keep",
                            content: "overwrite me",
                        },
                    },
                    context,
                ),
            ).rejects.toThrow(/already contains content/);
            expect(fs.readFileSync(target, "utf-8")).toBe("already here");
        });

        test("emits a loopback link and absolute path when a view port is registered", async () => {
            const sent: unknown[] = [];
            const viewProcess = {
                send: (message: unknown) => sent.push(message),
            };
            const { context } = buildContext({
                viewProcess,
                localHostPort: 54321,
            });
            const result = await instantiate().executeAction!(
                {
                    schemaName: "markdown",
                    actionName: "createDocument",
                    parameters: { name: "loopy" },
                },
                context,
            );
            if (result === undefined || "error" in result) {
                throw new Error("Expected success result");
            }
            const display = result.displayContent as
                | { type: "markdown"; content: string }
                | undefined;
            expect(display?.type).toBe("markdown");
            expect(display?.content).toContain(
                "http://127.0.0.1:54321/document/loopy",
            );
            expect(display?.content).toContain(
                path.join(fs.realpathSync(workspace), "loopy.md"),
            );
            expect(sent).toEqual([
                {
                    type: "setFile",
                    workspaceRoot: fs.realpathSync(workspace),
                    relativePath: "loopy.md",
                },
            ]);
        });

        test("emits a nested loopback link built from the full user-relative path", async () => {
            // The loopback link must preserve nested directories from the
            // user-relative path (per-segment encoded), not flatten to
            // basename. This is what lets the SPA route directly to a
            // nested document via /document/team/2025/plan.
            const sent: unknown[] = [];
            const viewProcess = {
                send: (message: unknown) => sent.push(message),
            };
            const { context } = buildContext({
                viewProcess,
                localHostPort: 54321,
            });
            const result = await instantiate().executeAction!(
                {
                    schemaName: "markdown",
                    actionName: "createDocument",
                    parameters: { name: "team/2025/plan" },
                },
                context,
            );
            if (result === undefined || "error" in result) {
                throw new Error("Expected success result");
            }
            const display = result.displayContent as
                | { type: "markdown"; content: string }
                | undefined;
            expect(display?.type).toBe("markdown");
            expect(display?.content).toContain(
                "http://127.0.0.1:54321/document/team/2025/plan",
            );
            // The last setFile the handler emitted (there may be more
            // than one during instantiate; only the create leg matters)
            // must carry the full user-relative path.
            const setFileMessages = sent.filter(
                (message): message is { type: string; relativePath: string } =>
                    typeof message === "object" &&
                    message !== null &&
                    (message as any).type === "setFile",
            );
            expect(setFileMessages.length).toBeGreaterThan(0);
            expect(
                setFileMessages[setFileMessages.length - 1].relativePath,
            ).toBe("team/2025/plan.md");
        });

        test("omits the loopback link when no view port is registered", async () => {
            const { context } = buildContext();
            const result = await instantiate().executeAction!(
                {
                    schemaName: "markdown",
                    actionName: "createDocument",
                    parameters: { name: "portless" },
                },
                context,
            );
            if (result === undefined || "error" in result) {
                throw new Error("Expected success result");
            }
            const display = result.displayContent as
                | { type: "markdown"; content: string }
                | undefined;
            expect(display?.content).not.toContain("http://");
        });

        test("reconcileViewBinding actually sends setFile with the full nested user-relative path when a view forks late", async () => {
            // Delayed-startup case: create runs before the view is attached.
            // A caller that later hands the agent a viewProcess (mirroring
            // the post-fork reconcile path) must call reconcileViewBinding
            // and observe a setFile IPC that carries workspaceRoot and the
            // full nested relativePath - not a dirname/basename split, and
            // not just a synthetic object built by the test.
            const { context, agentContext } = buildContext();
            const result = await instantiate().executeAction!(
                {
                    schemaName: "markdown",
                    actionName: "createDocument",
                    parameters: {
                        name: "team/2025/plan",
                        content: "body",
                    },
                },
                context,
            );
            if (result === undefined || "error" in result) {
                throw new Error("Expected success result");
            }
            expect(agentContext.currentFileName).toBe("team/2025/plan.md");
            expect(agentContext.currentWorkspaceRoot).toBe(
                fs.realpathSync(workspace),
            );

            // Mock the child_process handle. Only .send is exercised by
            // reconcileViewBinding; everything else stays undefined so an
            // accidental read of connected/pid would surface as a failure.
            const sent: unknown[] = [];
            const fakeViewProcess = {
                send: (message: unknown) => {
                    sent.push(message);
                    return true;
                },
            } as unknown as import("node:child_process").ChildProcess;

            reconcileViewBinding(
                agentContext as unknown as Parameters<
                    typeof reconcileViewBinding
                >[0],
                fakeViewProcess,
            );

            expect(sent).toEqual([
                {
                    type: "setFile",
                    workspaceRoot: fs.realpathSync(workspace),
                    relativePath: "team/2025/plan.md",
                },
            ]);
        });

        test("reconcileViewBinding is a no-op when no file is bound yet", () => {
            // The reconcile path must silently skip when create/open has
            // not yet populated the binding; otherwise a freshly-forked
            // view would receive setFile with undefined fields and the
            // service would reject the message.
            const { agentContext } = buildContext();
            agentContext.currentFileName = undefined;
            agentContext.currentWorkspaceRoot = undefined;
            const sent: unknown[] = [];
            const fakeViewProcess = {
                send: (message: unknown) => {
                    sent.push(message);
                    return true;
                },
            } as unknown as import("node:child_process").ChildProcess;

            reconcileViewBinding(
                agentContext as unknown as Parameters<
                    typeof reconcileViewBinding
                >[0],
                fakeViewProcess,
            );

            expect(sent).toEqual([]);
        });
    });
});
