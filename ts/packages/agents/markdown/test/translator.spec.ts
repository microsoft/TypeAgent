// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import {
    configFromEnvRecord,
    getActiveModelProvider,
    getRuntimeConfig,
    setActiveModelProvider,
    setRuntimeConfig,
} from "@typeagent/aiclient";
import { createMarkdownAgent } from "../src/agent/translator.js";
import { applyDocumentOperations } from "../src/agent/documentOperations.js";
import { instantiate } from "../src/agent/markdownActionHandler.js";
import { MarkdownAgent } from "../src/agent/translator.js";
import type { ActionContext } from "@typeagent/agent-sdk";

describe("markdown editor model responses", () => {
    const savedConfig = getRuntimeConfig();
    const savedProvider = getActiveModelProvider();
    let agent: Awaited<ReturnType<typeof createMarkdownAgent>>;

    beforeAll(() => {
        setRuntimeConfig(
            configFromEnvRecord({
                AZURE_OPENAI_ENDPOINT_GPT_5_MINI_EASTUS:
                    "https://markdown-editor-test.invalid/chat/completions",
                AZURE_OPENAI_API_KEY_GPT_5_MINI_EASTUS: "test-key",
            }),
        );
        setActiveModelProvider("azure");
    });

    beforeEach(async () => {
        agent = await createMarkdownAgent();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    afterAll(() => {
        setRuntimeConfig(savedConfig);
        setActiveModelProvider(savedProvider);
    });

    test("streams the model's returned text instead of placeholder content", async () => {
        const content = "Lorem ipsum dolor sit amet.";
        jest.spyOn(agent.model, "complete").mockResolvedValue({
            success: true,
            data: content,
        });
        const chunks: string[] = [];
        const result = await agent.updateDocumentWithStreaming(
            "# Notes\n",
            "Add a paragraph",
            (chunk) => chunks.push(chunk),
            8,
        );

        expect(chunks.join("")).toBe(content);
        if (!result.success) {
            throw new Error(result.message);
        }
        expect(
            applyDocumentOperations("# Notes\n", result.data.operations),
        ).toContain(content);
        expect(result.data.operations[0]).toMatchObject({
            type: "insert",
            position: 8,
        });
    });

    test("preserves model failures without streaming or generating operations", async () => {
        const failure = {
            success: false as const,
            message: "PermissionDenied: Principal does not have access",
        };
        jest.spyOn(agent.model, "complete").mockResolvedValue(failure);
        const onChunk = jest.fn<(chunk: string) => void>();

        await expect(
            agent.updateDocumentWithStreaming("", "Add a paragraph", onChunk),
        ).resolves.toEqual(failure);
        expect(onChunk).not.toHaveBeenCalled();
    });

    test("propagates thrown model errors instead of fabricating content", async () => {
        const failure = new Error("Model connection failed");
        jest.spyOn(agent.model, "complete").mockRejectedValue(failure);
        const onChunk = jest.fn<(chunk: string) => void>();

        await expect(
            agent.updateDocumentWithStreaming("", "Add a paragraph", onChunk),
        ).rejects.toBe(failure);
        expect(onChunk).not.toHaveBeenCalled();
    });

    test("provides exact raw Markdown offsets for appending content", () => {
        const content = "# Notes\n\nOriginal content.\n";
        const prompts = agent.getMarkdownUpdatePrompts(
            content,
            "Add a paragraph",
        );
        expect(prompts.map((prompt) => prompt.text).join("\n")).toContain(
            `append content at position ${content.length}`,
        );
        expect(prompts.map((prompt) => prompt.text).join("\n")).toContain(
            JSON.stringify(content),
        );
    });

    test("reports no changes instead of repeating an empty update's success claim", async () => {
        jest.spyOn(MarkdownAgent.prototype, "updateDocument").mockResolvedValue(
            {
                success: true,
                data: {
                    operations: [],
                    operationSummary: "Added a paragraph",
                },
            },
        );
        const write = jest.fn();
        const context = {
            sessionContext: {
                agentContext: {
                    localHostPort: 0,
                    currentDocument: {
                        source: "session",
                        storageKey: "notes.md",
                    },
                },
                sessionStorage: {
                    exists: async () => true,
                    read: async () => "Original content.",
                    write,
                },
            },
        } as unknown as ActionContext;

        const result = await instantiate().executeAction!(
            {
                schemaName: "markdown",
                actionName: "updateDocument",
                parameters: { originalRequest: "Add a paragraph" },
            },
            context,
        );
        expect(result).toMatchObject({
            displayContent: "No changes made to notes.md",
        });
        expect(write).not.toHaveBeenCalled();
    });
});
