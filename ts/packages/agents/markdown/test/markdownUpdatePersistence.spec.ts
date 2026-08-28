// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ActionContext, AppAgent } from "@typeagent/agent-sdk";
import { jest } from "@jest/globals";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const updateDocument = jest.fn(async (currentContent: string | undefined) => ({
    success: true as const,
    data: {
        operations: [
            {
                type: "insert" as const,
                position: currentContent?.length ?? 0,
                content: [{ type: "text" as const, text: " updated" }],
            },
        ],
        operationSummary: "Updated document",
    },
}));

jest.unstable_mockModule("../src/agent/translator.js", () => ({
    createMarkdownAgent: async () => ({
        updateDocument,
        tokenUsage: undefined,
    }),
}));

const { instantiate } = await import("../src/agent/markdownActionHandler.js");

describe("markdown update persistence without a view process", () => {
    let temporaryDirectory: string;
    let workspace: string;
    let filePath: string;
    let agent: AppAgent;

    beforeEach(() => {
        temporaryDirectory = fs.mkdtempSync(
            path.join(os.tmpdir(), "typeagent-markdown-update-"),
        );
        workspace = path.join(temporaryDirectory, "workspace");
        const documentDirectory = path.join(workspace, "notes");
        fs.mkdirSync(documentDirectory, { recursive: true });
        filePath = path.join(documentDirectory, "plan.md");
        fs.writeFileSync(filePath, "original", "utf-8");
        agent = instantiate();
        updateDocument.mockClear();
    });

    afterEach(() => {
        fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    });

    test.each(["updateDocument", "streamingUpdateDocument"] as const)(
        "%s persists operations to the workspace file",
        async (actionName) => {
            await agent.executeAction?.(
                {
                    schemaName: "markdown",
                    actionName,
                    parameters: {
                        originalRequest: "update it",
                    },
                },
                createActionContext(),
            );

            expect(updateDocument).toHaveBeenCalledWith(
                "original",
                "update it",
                undefined,
                undefined,
            );
            expect(fs.readFileSync(filePath, "utf-8")).toBe("original updated");
        },
    );

    test("rejects an update after the document directory escapes through a junction", async () => {
        const originalDocumentDirectory = path.dirname(filePath);
        const movedDocumentDirectory = path.join(workspace, "moved-notes");
        const outsideDirectory = path.join(temporaryDirectory, "outside");
        fs.mkdirSync(outsideDirectory);
        const outsideFile = path.join(outsideDirectory, "plan.md");
        fs.writeFileSync(outsideFile, "outside", "utf-8");
        fs.renameSync(originalDocumentDirectory, movedDocumentDirectory);
        fs.symlinkSync(outsideDirectory, originalDocumentDirectory, "junction");

        try {
            await expect(
                agent.executeAction?.(
                    {
                        schemaName: "markdown",
                        actionName: "updateDocument",
                        parameters: {
                            originalRequest: "update it",
                        },
                    },
                    createActionContext(),
                ),
            ).rejects.toThrow(/no longer accessible/);

            expect(updateDocument).not.toHaveBeenCalled();
            expect(fs.readFileSync(outsideFile, "utf-8")).toBe("outside");
        } finally {
            fs.unlinkSync(originalDocumentDirectory);
        }
    });

    function createActionContext(): ActionContext<{
        currentFileName: string;
        currentFilePath: string;
        currentWorkspaceRoot: string;
        localHostPort: number;
    }> {
        return {
            workingDirectory: workspace,
            sessionContext: {
                agentContext: {
                    currentFileName: path.join("notes", "plan.md"),
                    currentFilePath: filePath,
                    currentWorkspaceRoot: fs.realpathSync(workspace),
                    localHostPort: 0,
                },
            },
        } as ActionContext<{
            currentFileName: string;
            currentFilePath: string;
            currentWorkspaceRoot: string;
            localHostPort: number;
        }>;
    }
});
