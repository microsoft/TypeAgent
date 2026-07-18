// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, it, expect } from "@jest/globals";
import type { UserContext } from "@typeagent/dispatcher-types";
import { formatUserContextForPrompt } from "../src/reasoning/userContextPrompt.js";

// formatUserContextForPrompt renders the coarse editor snapshot into the
// "[Editor context]" prompt block shared by the copilot/claude reasoning
// engines. It must: emit nothing without editor detail, convert the host's
// 0-based positions to 1-based for display, omit an empty selection, include
// the active selection's text (bounded) when present, and never carry full file
// contents (only metadata + a pointer to the code agent for those).

describe("formatUserContextForPrompt", () => {
    it("returns empty string when userContext is undefined", () => {
        expect(formatUserContextForPrompt(undefined)).toBe("");
    });

    it("returns empty string when there is no editor detail", () => {
        const ctx: UserContext = { activeApp: "vscode" };
        expect(formatUserContextForPrompt(ctx)).toBe("");
    });

    it("renders the active file with language and dirty marker", () => {
        const ctx: UserContext = {
            activeApp: "vscode",
            editor: {
                activeFilePath: "src/foo.ts",
                languageId: "typescript",
                isDirty: true,
            },
        };
        const block = formatUserContextForPrompt(ctx);
        expect(block).toContain("[Editor context]");
        expect(block).toContain("Active file: src/foo.ts [typescript]");
        expect(block).toContain("(unsaved changes)");
    });

    it("converts 0-based cursor and selection to 1-based", () => {
        const ctx: UserContext = {
            activeApp: "vscode",
            editor: {
                cursor: { line: 0, character: 4 },
                selection: {
                    isEmpty: false,
                    start: { line: 9, character: 0 },
                    end: { line: 11, character: 2 },
                },
            },
        };
        const block = formatUserContextForPrompt(ctx);
        expect(block).toContain("Cursor: line 1, col 5");
        expect(block).toContain("Selection: line 10 col 1 to line 12 col 3");
    });

    it("omits the selection line when the selection is empty", () => {
        const ctx: UserContext = {
            activeApp: "vscode",
            editor: {
                activeFilePath: "a.ts",
                selection: {
                    isEmpty: true,
                    start: { line: 3, character: 0 },
                    end: { line: 3, character: 0 },
                },
            },
        };
        expect(formatUserContextForPrompt(ctx)).not.toContain("Selection:");
    });

    it("shows diagnostics only when there are any", () => {
        const none: UserContext = {
            activeApp: "vscode",
            editor: {
                activeFilePath: "a.ts",
                diagnostics: { errors: 0, warnings: 0, infos: 0, hints: 0 },
            },
        };
        expect(formatUserContextForPrompt(none)).not.toContain(
            "Diagnostics in file",
        );

        const some: UserContext = {
            activeApp: "vscode",
            editor: {
                activeFilePath: "a.ts",
                diagnostics: { errors: 2, warnings: 1, infos: 0, hints: 0 },
            },
        };
        expect(formatUserContextForPrompt(some)).toContain(
            "Diagnostics in file: 2 error(s), 1 warning(s)",
        );
    });

    it("inlines diagnostic messages (1-based line) with an omitted count", () => {
        const ctx: UserContext = {
            activeApp: "vscode",
            editor: {
                activeFilePath: "a.ts",
                diagnostics: {
                    errors: 1,
                    warnings: 1,
                    infos: 0,
                    hints: 0,
                    items: [
                        {
                            severity: "error",
                            line: 11,
                            message: "Cannot find name 'foo'.",
                            source: "ts",
                        },
                        {
                            severity: "warning",
                            line: 3,
                            message: "'x' is declared but never used.",
                        },
                    ],
                    omitted: 4,
                },
            },
        };
        const block = formatUserContextForPrompt(ctx);
        expect(block).toContain(
            "  - [error] line 12: Cannot find name 'foo'. (ts)",
        );
        expect(block).toContain(
            "  - [warning] line 4: 'x' is declared but never used.",
        );
        expect(block).toContain("  - ...and 4 more");
    });

    it("lists workspace folders and open editor count", () => {
        const ctx: UserContext = {
            activeApp: "vscode",
            editor: {
                workspaceFolders: ["TypeAgent", "docs"],
                openEditorCount: 3,
            },
        };
        const block = formatUserContextForPrompt(ctx);
        expect(block).toContain("Workspace: TypeAgent, docs");
        expect(block).toContain("Open editors: 3");
    });

    it("lists open editors with active/unsaved flags and an omitted count", () => {
        const ctx: UserContext = {
            activeApp: "vscode",
            editor: {
                openEditorCount: 25,
                openEditors: [
                    { path: "src/a.ts", active: true, dirty: false },
                    { path: "src/b.ts", active: false, dirty: true },
                    { path: "src/c.ts", active: false, dirty: false },
                ],
                openEditorsOmitted: 2,
            },
        };
        const block = formatUserContextForPrompt(ctx);
        expect(block).toContain("Open editors: 25");
        expect(block).toContain("  - src/a.ts (active)");
        expect(block).toContain("  - src/b.ts (unsaved)");
        expect(block).toContain("  - src/c.ts");
        expect(block).toContain("  - ...and 2 more");
    });

    it("points the model at the code agent for fuller contents", () => {
        const ctx: UserContext = {
            activeApp: "vscode",
            editor: { activeFilePath: "a.ts" },
        };
        const block = formatUserContextForPrompt(ctx);
        expect(block).toContain("full file contents are NOT");
        expect(block).toContain("getSelection");
    });

    it("includes the selected text in a fenced block with the language", () => {
        const ctx: UserContext = {
            activeApp: "vscode",
            editor: {
                activeFilePath: "src/foo.ts",
                languageId: "typescript",
                selection: {
                    isEmpty: false,
                    start: { line: 14, character: 0 },
                    end: { line: 14, character: 67 },
                    text: 'import * as speechSDK from "microsoft-cognitiveservices-speech-sdk";',
                },
            },
        };
        const block = formatUserContextForPrompt(ctx);
        expect(block).toContain("Selected text (src/foo.ts:15):");
        expect(block).toContain("```typescript");
        expect(block).toContain(
            'import * as speechSDK from "microsoft-cognitiveservices-speech-sdk";',
        );
    });

    it("labels the selected text with its file path and line range", () => {
        const ctx: UserContext = {
            activeApp: "vscode",
            editor: {
                activeFilePath:
                    "packages/vscode-shell/src/webview/cameraView.ts",
                languageId: "typescript",
                selection: {
                    isEmpty: false,
                    start: { line: 78, character: 8 },
                    end: { line: 82, character: 10 },
                    text: "this.acceptButton.onclick = () => {};",
                },
            },
        };
        expect(formatUserContextForPrompt(ctx)).toContain(
            "Selected text (packages/vscode-shell/src/webview/cameraView.ts:79-83):",
        );
    });

    it("marks truncated selection text with an explicit notice", () => {
        const ctx: UserContext = {
            activeApp: "vscode",
            editor: {
                selection: {
                    isEmpty: false,
                    start: { line: 0, character: 0 },
                    end: { line: 99, character: 0 },
                    text: "const x = 1;",
                    truncated: true,
                },
            },
        };
        const block = formatUserContextForPrompt(ctx);
        expect(block).toMatch(/Selected text \([^)]*truncated\):/);
        expect(block).toContain("Selection truncated");
        expect(block).toContain("only the first part is shown");
    });

    it("does not add a truncation notice for a complete selection", () => {
        const ctx: UserContext = {
            activeApp: "vscode",
            editor: {
                selection: {
                    isEmpty: false,
                    start: { line: 0, character: 0 },
                    end: { line: 0, character: 12 },
                    text: "const x = 1;",
                },
            },
        };
        const block = formatUserContextForPrompt(ctx);
        expect(block).toContain("Selected text (lines 1):");
        expect(block).not.toContain("truncated");
    });

    it("renders the range but no text block when text is absent", () => {
        const ctx: UserContext = {
            activeApp: "vscode",
            editor: {
                selection: {
                    isEmpty: false,
                    start: { line: 0, character: 0 },
                    end: { line: 0, character: 3 },
                },
            },
        };
        const block = formatUserContextForPrompt(ctx);
        expect(block).toContain("Selection: line 1 col 1 to line 1 col 4");
        expect(block).not.toContain("Selected text");
    });

    it("uses a longer fence when the selection contains a backtick run", () => {
        const ctx: UserContext = {
            activeApp: "vscode",
            editor: {
                languageId: "markdown",
                selection: {
                    isEmpty: false,
                    start: { line: 0, character: 0 },
                    end: { line: 2, character: 3 },
                    text: "```ts\nconst x = 1;\n```",
                },
            },
        };
        const block = formatUserContextForPrompt(ctx);
        // Fence must be longer than the ``` inside the selection so it does not
        // close early.
        expect(block).toContain("````markdown");
        expect(block).toContain("```ts\nconst x = 1;\n```");
    });
});
