// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ActionContext, Storage } from "@typeagent/agent-sdk";
import { instantiate } from "../src/agent/markdownActionHandler.js";

describe("markdown document actions", () => {
    test.each(["createDocument", "openDocument"] as const)(
        "%s works without model configuration",
        async (actionName) => {
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

            const checkedPaths: string[] = [];
            const writes: [string, string][] = [];
            const storage = {
                exists: async (storagePath: string) => {
                    checkedPaths.push(storagePath);
                    return false;
                },
                write: async (storagePath: string, data: string) => {
                    writes.push([storagePath, data]);
                },
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
            } finally {
                for (const [key, value] of savedModelSettings) {
                    process.env[key] = value;
                }
            }
        },
    );
});
