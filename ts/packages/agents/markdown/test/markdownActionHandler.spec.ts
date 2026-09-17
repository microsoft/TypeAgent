// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ActionContext, Storage } from "@typeagent/agent-sdk";
import {
    configFromEnvRecord,
    getActiveModelProvider,
    getRuntimeConfig,
    setActiveModelProvider,
    setRuntimeConfig,
} from "@typeagent/aiclient";
import { jest } from "@jest/globals";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { instantiate } from "../src/agent/markdownActionHandler.js";

type TestAgentContext = {
    currentDocument?:
        | {
              source: "session";
              storageKey: string;
          }
        | {
              source: "workspace";
              filePath: string;
              workspaceRoot: string;
          };
    viewProcess?: { send: (message: unknown) => void } | undefined;
    localHostPort: number;
};

describe("markdown document creation", () => {
    let workspace = "";

    beforeEach(() => {
        workspace = fs.mkdtempSync(
            path.join(os.tmpdir(), "typeagent-markdown-create-"),
        );
    });

    afterEach(() => {
        fs.rmSync(workspace, { recursive: true, force: true });
    });

    function createContext(options?: {
        workingDirectory?: string | undefined;
        storage?: Storage | undefined;
        viewProcess?: { send: (message: unknown) => void } | undefined;
    }): {
        context: ActionContext<TestAgentContext>;
        agentContext: TestAgentContext;
    } {
        const agentContext = {
            localHostPort: 0,
            viewProcess: options?.viewProcess,
        };
        const workingDirectory =
            options !== undefined && "workingDirectory" in options
                ? options.workingDirectory
                : workspace;
        const context = {
            workingDirectory,
            sessionContext: {
                agentContext,
                sessionStorage: options?.storage,
            },
        } as unknown as ActionContext<TestAgentContext>;
        return { context, agentContext };
    }

    test("creates a nested document with the requested content without model setup", async () => {
        const savedModelSettings = Object.entries(process.env).filter(
            ([key]) =>
                key.startsWith("AZURE_OPENAI_") ||
                key.startsWith("OPENAI_") ||
                key.startsWith("OLLAMA_") ||
                key === "MODEL_PROVIDER",
        );
        for (const [key] of savedModelSettings) {
            delete process.env[key];
        }
        const viewMessages: unknown[] = [];
        const { context, agentContext } = createContext({
            viewProcess: {
                send: (message) => {
                    viewMessages.push(message);
                },
            },
        });

        try {
            const result = await instantiate().executeAction!(
                {
                    schemaName: "markdown",
                    actionName: "createDocument",
                    parameters: {
                        name: "notes/nested/plan",
                        content: "# Plan\n\nInitial content.",
                    },
                },
                context,
            );
            if (result === undefined || "error" in result) {
                throw new Error("Expected successful document creation");
            }

            const expectedPath = path.join(
                fs.realpathSync(workspace),
                "notes",
                "nested",
                "plan.md",
            );
            expect(fs.readFileSync(expectedPath, "utf-8")).toBe(
                "# Plan\n\nInitial content.",
            );
            expect(agentContext).toMatchObject({
                currentDocument: {
                    source: "workspace",
                    filePath: expectedPath,
                    workspaceRoot: fs.realpathSync(workspace),
                },
            });
            expect(result.tokenUsage).toEqual({
                prompt_tokens: 0,
                completion_tokens: 0,
                total_tokens: 0,
            });
            expect(result.activityContext?.openLocalView).toBe(false);
            expect(viewMessages).toHaveLength(0);
        } finally {
            for (const [key, value] of savedModelSettings) {
                process.env[key] = value;
            }
        }
    });

    test.each(
        ["updateDocument", "streamingUpdateDocument"].flatMap((actionName) =>
            [200, 401].flatMap((status) =>
                ["current", "relative", "absolute"].map((target) => ({
                    actionName,
                    status,
                    target,
                })),
            ),
        ),
    )(
        "$actionName handles HTTP $status with the configured model and $target target",
        async ({ actionName, status, target }) => {
            const savedConfig = getRuntimeConfig();
            const savedProvider = getActiveModelProvider();
            const initialContent = "# Notes\n\nInitial content.";
            const paragraph = "\n\nLorem ipsum dolor sit amet.";
            const endpoint = "https://markdown-test.invalid/chat/completions";
            const usage = {
                prompt_tokens: 100,
                completion_tokens: 20,
                total_tokens: 120,
            };
            const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue(
                new Response(
                    JSON.stringify({
                        choices: [
                            {
                                message: {
                                    content: JSON.stringify({
                                        operations: [
                                            {
                                                type: "insert",
                                                position: initialContent.length,
                                                content: [
                                                    {
                                                        type: "text",
                                                        text: paragraph,
                                                    },
                                                ],
                                            },
                                        ],
                                        operationSummary: "Added a paragraph",
                                    }),
                                },
                            },
                        ],
                        usage,
                    }),
                    {
                        status,
                        headers: { "content-type": "application/json" },
                    },
                ),
            );
            const env = { ...process.env };
            for (const key of Object.keys(env)) {
                if (
                    key.startsWith("AZURE_OPENAI_") ||
                    key.startsWith("OPENAI_") ||
                    key === "TYPEAGENT_MODEL_PROVIDER"
                ) {
                    delete env[key];
                }
            }
            const envMock = jest.replaceProperty(process, "env", env);

            try {
                setRuntimeConfig(
                    configFromEnvRecord({
                        AZURE_OPENAI_ENDPOINT_GPT_4_O_EASTUS: endpoint,
                        AZURE_OPENAI_API_KEY_GPT_4_O_EASTUS: "test-key",
                    }),
                );
                setActiveModelProvider(undefined);
                const sessionFiles = new Map([["live.md", "Session content"]]);
                const storage = {
                    exists: async (name: string) => sessionFiles.has(name),
                    read: async (name: string) => sessionFiles.get(name) ?? "",
                    write: async (name: string, content: string) => {
                        sessionFiles.set(name, content);
                    },
                } as unknown as Storage;
                const { context, agentContext } = createContext({ storage });
                const agent = instantiate();
                await agent.executeAction!(
                    {
                        schemaName: "markdown",
                        actionName: "createDocument",
                        parameters: { name: "notes", content: initialContent },
                    },
                    context,
                );
                expect(fetchMock).not.toHaveBeenCalled();
                if (target !== "current") {
                    // A restarted agent selects its default session document.
                    agentContext.currentDocument = {
                        source: "session",
                        storageKey: "live.md",
                    };
                }

                const result = await agent.executeAction!(
                    {
                        schemaName: "markdown",
                        actionName,
                        parameters: {
                            originalRequest: "Add a paragraph of lorem ipsum",
                            ...(target === "current"
                                ? {}
                                : {
                                      documentPath:
                                          target === "absolute"
                                              ? path.join(workspace, "notes.md")
                                              : "notes.md",
                                  }),
                        },
                    },
                    context,
                );

                expect(result).toBeDefined();
                expect(fetchMock).toHaveBeenCalledTimes(1);
                expect(fetchMock.mock.calls[0][0]).toBe(endpoint);
                if (status === 200) {
                    expect(result).not.toHaveProperty("error");
                    expect(result).toMatchObject({ tokenUsage: usage });
                } else {
                    expect(result).toMatchObject({
                        error: expect.stringContaining("401"),
                    });
                }
                expect(
                    fs.readFileSync(path.join(workspace, "notes.md"), "utf8"),
                ).toBe(
                    status === 200
                        ? initialContent + paragraph
                        : initialContent,
                );
                expect(sessionFiles.get("live.md")).toBe("Session content");
            } finally {
                fetchMock.mockRestore();
                envMock.restore();
                setRuntimeConfig(savedConfig);
                setActiveModelProvider(savedProvider);
            }
        },
    );

    test.each(["updateDocument", "streamingUpdateDocument"])(
        "%s refuses an invalid explicit target instead of editing the current document",
        async (actionName) => {
            const { context, agentContext } = createContext();
            const filePath = path.join(workspace, "notes.md");
            fs.writeFileSync(filePath, "original");
            agentContext.currentDocument = {
                source: "workspace",
                filePath,
                workspaceRoot: workspace,
            };
            for (const documentPath of [
                "missing.md",
                "../outside.md",
                path.join(workspace, "..", "outside.md"),
            ]) {
                await expect(
                    instantiate().executeAction!(
                        {
                            schemaName: "markdown",
                            actionName,
                            parameters: {
                                documentPath,
                                originalRequest: "Add text",
                            },
                        },
                        context,
                    ),
                ).rejects.toThrow(
                    /within the working directory|safe relative path/,
                );
                expect(fs.readFileSync(filePath, "utf8")).toBe("original");
                expect(agentContext.currentDocument.filePath).toBe(filePath);
            }
        },
    );

    test.each([
        ["traversal", "../escape"],
        ["nested traversal", "notes/../../escape"],
        ["absolute", path.resolve("escape")],
        ["drive-qualified", "C:escape"],
    ])("rejects %s paths", async (_label, name) => {
        const { context } = createContext();
        await expect(
            instantiate().executeAction!(
                {
                    schemaName: "markdown",
                    actionName: "createDocument",
                    parameters: { name },
                },
                context,
            ),
        ).rejects.toThrow(/safe relative path/);
    });

    test("rejects a nested symlink escape", async () => {
        const outside = fs.mkdtempSync(
            path.join(os.tmpdir(), "typeagent-markdown-outside-"),
        );
        fs.symlinkSync(outside, path.join(workspace, "linked"), "junction");
        const { context } = createContext();

        try {
            await expect(
                instantiate().executeAction!(
                    {
                        schemaName: "markdown",
                        actionName: "createDocument",
                        parameters: {
                            name: "linked/escape",
                            content: "must stay inside",
                        },
                    },
                    context,
                ),
            ).rejects.toThrow(/not writable within the working directory/);
            expect(fs.existsSync(path.join(outside, "escape.md"))).toBe(false);
        } finally {
            fs.rmSync(outside, { recursive: true, force: true });
        }
    });

    test("falls back to session storage without a working directory", async () => {
        const files = new Map<string, string>();
        const storage = {
            exists: async (name: string) => files.has(name),
            read: async (name: string) => files.get(name) ?? "",
            write: async (name: string, content: string) => {
                files.set(name, content);
            },
        } as unknown as Storage;
        const { context, agentContext } = createContext({
            workingDirectory: undefined,
            storage,
        });

        const result = await instantiate().executeAction!(
            {
                schemaName: "markdown",
                actionName: "createDocument",
                parameters: {
                    name: "notes",
                    content: "# Stored note",
                },
            },
            context,
        );
        if (result === undefined || "error" in result) {
            throw new Error("Expected successful document creation");
        }

        expect(files.get("notes.md")).toBe("# Stored note");
        expect(agentContext).toMatchObject({
            currentDocument: {
                source: "session",
                storageKey: "notes.md",
            },
        });
        expect(result.activityContext?.openLocalView).toBe(true);
    });

    test("opens an existing workspace document without opening the session-rooted view", async () => {
        const documentPath = path.join(workspace, "notes.md");
        fs.writeFileSync(documentPath, "# Existing");
        const viewMessages: unknown[] = [];
        const { context, agentContext } = createContext({
            viewProcess: {
                send: (message) => {
                    viewMessages.push(message);
                },
            },
        });

        const result = await instantiate().executeAction!(
            {
                schemaName: "markdown",
                actionName: "openDocument",
                parameters: { name: "notes" },
            },
            context,
        );
        if (result === undefined || "error" in result) {
            throw new Error("Expected successful document open");
        }

        expect(agentContext.currentDocument).toEqual({
            source: "workspace",
            filePath: fs.realpathSync(documentPath),
            workspaceRoot: fs.realpathSync(workspace),
        });
        expect(result.activityContext?.openLocalView).toBe(false);
        expect(viewMessages).toHaveLength(0);
    });

    test("does not create a missing document when opening it", async () => {
        const { context } = createContext();

        await expect(
            instantiate().executeAction!(
                {
                    schemaName: "markdown",
                    actionName: "openDocument",
                    parameters: { name: "missing" },
                },
                context,
            ),
        ).rejects.toThrow(/does not exist within the working directory/);
        expect(fs.existsSync(path.join(workspace, "missing.md"))).toBe(false);
    });

    test("requires a working directory or session storage", async () => {
        const { context } = createContext({ workingDirectory: undefined });

        await expect(
            instantiate().executeAction!(
                {
                    schemaName: "markdown",
                    actionName: "createDocument",
                    parameters: { name: "notes" },
                },
                context,
            ),
        ).rejects.toThrow(/working directory or session storage/);
    });
});
