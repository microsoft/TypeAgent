// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ActionContext, Storage } from "@typeagent/agent-sdk";
import path from "node:path";
import {
    configFromEnvRecord,
    getRuntimeConfig,
    setRuntimeConfig,
} from "@typeagent/aiclient";
import { instantiate } from "../src/agent/markdownActionHandler.js";
import { createMarkdownAgent } from "../src/agent/translator.js";

describe("markdown document actions", () => {
    test.each(["createDocument", "openDocument"] as const)(
        "%s works without model configuration",
        async (actionName) => {
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

            const checkedPaths: string[] = [];
            const writes: [string, string][] = [];
            const fullPath = path.resolve("storage", "notes.md");
            const storage = {
                exists: async (storagePath: string) => {
                    checkedPaths.push(storagePath);
                    return false;
                },
                write: async (storagePath: string, data: string) => {
                    writes.push([storagePath, data]);
                },
                list: async () => [fullPath],
            } as unknown as Storage;
            const context = {
                sessionContext: {
                    agentContext: { localHostPort: 0 },
                    sessionStorage: storage,
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
                expect(checkedPaths).toEqual(["notes.md"]);
                expect(writes).toEqual([["notes.md", ""]]);
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

    test("creates a document with initial markdown content", async () => {
        const fullPath = path.resolve("storage", "filled.md");
        const writes: [string, string][] = [];
        const storage = {
            exists: async () => false,
            write: async (storagePath: string, data: string) => {
                writes.push([storagePath, data]);
            },
            list: async () => [fullPath],
        } as unknown as Storage;
        const context = {
            sessionContext: {
                agentContext: { localHostPort: 0 },
                sessionStorage: storage,
            },
        } as unknown as ActionContext<{
            currentFileName?: string;
            localHostPort: number;
        }>;

        await instantiate().executeAction!(
            {
                schemaName: "markdown",
                actionName: "createDocument",
                parameters: {
                    name: "filled.md",
                    content: "# Filled\n\nLorem ipsum.",
                },
            },
            context,
        );

        expect(writes).toEqual([["filled.md", "# Filled\n\nLorem ipsum."]]);
    });
});
