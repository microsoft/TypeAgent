// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ActionContext } from "@typeagent/agent-sdk";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { instantiate } from "../src/agent/markdownActionHandler.js";

type TestAgentContext = {
    currentFileName?: string;
    currentFilePath?: string;
    currentWorkspaceRoot?: string;
    localHostPort: number;
};

describe("markdown document creation", () => {
    let workspace: string;

    beforeEach(() => {
        workspace = fs.mkdtempSync(
            path.join(os.tmpdir(), "typeagent-markdown-create-"),
        );
    });

    afterEach(() => {
        fs.rmSync(workspace, { recursive: true, force: true });
    });

    function createContext(): {
        context: ActionContext<TestAgentContext>;
        agentContext: TestAgentContext;
    } {
        const agentContext = { localHostPort: 0 };
        const context = {
            workingDirectory: workspace,
            sessionContext: {
                agentContext,
                sessionStorage: undefined,
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
        const { context, agentContext } = createContext();

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
                currentFileName: "notes/nested/plan.md",
                currentFilePath: expectedPath,
                currentWorkspaceRoot: fs.realpathSync(workspace),
            });
            expect(result?.tokenUsage).toEqual({
                prompt_tokens: 0,
                completion_tokens: 0,
                total_tokens: 0,
            });
        } finally {
            for (const [key, value] of savedModelSettings) {
                process.env[key] = value;
            }
        }
    });

    test.each([
        ["traversal", "../escape"],
        ["nested traversal", "notes/../../escape"],
        ["absolute", path.resolve(workspace, "..", "escape")],
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
            ).rejects.toThrow(/escapes workingDirectory/);
            expect(fs.existsSync(path.join(outside, "escape.md"))).toBe(false);
        } finally {
            fs.rmSync(outside, { recursive: true, force: true });
        }
    });

    test("requires a host-authorized working directory", async () => {
        const { context } = createContext();
        Object.defineProperty(context, "workingDirectory", {
            value: undefined,
        });

        await expect(
            instantiate().executeAction!(
                {
                    schemaName: "markdown",
                    actionName: "createDocument",
                    parameters: { name: "notes" },
                },
                context,
            ),
        ).rejects.toThrow(/host-authorized working directory/);
    });
});
