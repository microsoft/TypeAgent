// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "path";
import * as vscode from "vscode";
import * as fs from "fs/promises";
export interface ActionResult {
    handled: boolean;
    message: string;
}

export type FileTarget = {
    // Name of the file to create or open or edit (e.g., "utils.ts")
    fileName?: string;
    // Name of the folder to the file is contained in (e.g., "src")
    folderName?: string;
    // Optional: restrict to folders under this path or name
    folderRelativeTo?: string;
    // Optional: if file doesn't exist, should it be created?, default: false
    createIfNotExists?: boolean;
    // Optional: fallback to currently active file if not open, default: true
    fallbackToActiveFile?: boolean;
};

export function normalize(text: string): string {
    return text.toLowerCase().replace(/[\s\-_.]+/g, "");
}

export function fuzzyMatchScore(query: string, text: string): number {
    if (text.includes(query)) return 1.0;
    let score = 0;
    const parts = query.split(/\s+/);
    for (const part of parts) {
        if (text.includes(part)) score += 1;
    }
    return score / parts.length;
}

export async function findMatchingFiles(
    fileName: string,
    options: {
        maxResults?: number | undefined;
        extensions?: string[] | undefined;
        matchStrategy?: "exact" | "fuzzy" | undefined;
        includeGenerated?: boolean | undefined;
    },
): Promise<vscode.Uri[]> {
    const {
        maxResults = 10,
        extensions,
        matchStrategy = "exact",
        includeGenerated = false,
    } = options;

    const excludeGlobs = includeGenerated
        ? []
        : [
              "**/node_modules/**",
              "**/dist/**",
              "**/build/**",
              "**/out/**",
              "**/.git/**",
              "**/.next/**",
              "**/.turbo/**",
              "**/.cache/**",
              "**/coverage/**",
              "**/.venv/**",
              "**/__pycache__/**",
          ];

    const excludePattern =
        excludeGlobs.length > 0 ? `{${excludeGlobs.join(",")}}` : undefined;

    // Search all files first; we'll filter based on match strategy and extension
    const allFiles = await vscode.workspace.findFiles("**/*", excludePattern);

    const lowercaseTarget = fileName.toLowerCase();

    const filtered = allFiles.filter((uri) => {
        const base = path.basename(uri.fsPath).toLowerCase();

        // Match strategy: exact or fuzzy
        const nameMatches =
            matchStrategy === "fuzzy"
                ? base.includes(lowercaseTarget)
                : base === lowercaseTarget;

        // Extension filtering (if any)
        const extMatches =
            !extensions || extensions.length === 0
                ? true
                : extensions.some((ext) => base.endsWith(ext.toLowerCase()));

        return nameMatches && extMatches;
    });

    return filtered.slice(0, maxResults);
}

export async function findMatchingFolders(
    relativeFolderName: string,
    includeGenerated: boolean = false,
): Promise<vscode.Uri[]> {
    const excludeGlobs = includeGenerated
        ? []
        : [
              "node_modules",
              "dist",
              "build",
              "out",
              ".git",
              ".next",
              ".turbo",
              ".cache",
              "coverage",
              ".venv",
              "__pycache__",
          ];

    const foundFolders: vscode.Uri[] = [];

    async function scanDirectory(uri: vscode.Uri) {
        const entries = await vscode.workspace.fs.readDirectory(uri);
        for (const [name, type] of entries) {
            const childUri = vscode.Uri.joinPath(uri, name);

            // Skip excluded folders
            if (
                type === vscode.FileType.Directory &&
                excludeGlobs.includes(name)
            ) {
                continue;
            }

            if (type === vscode.FileType.Directory) {
                if (
                    name.localeCompare(relativeFolderName, undefined, {
                        sensitivity: "accent",
                    }) === 0
                ) {
                    foundFolders.push(childUri);
                }
                // Recurse into subdirectory
                await scanDirectory(childUri);
            }
        }
    }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        console.error("❌ No workspace folders open.");
        return [];
    }

    for (const folder of workspaceFolders) {
        console.log(`🔍 Scanning workspace folder: ${folder.uri.fsPath}`);
        await scanDirectory(folder.uri);
    }

    console.log(
        `✅ Found folders: ${foundFolders.map((f) => f.fsPath).join(", ")}`,
    );
    return foundFolders;
}

export async function findMatchingFoldersByName(
    folderName: string,
    folderRelativeTo?: string,
    includeGenerated: boolean = false,
): Promise<vscode.Uri[]> {
    const excludeGlobs = includeGenerated
        ? []
        : [
              "node_modules",
              "dist",
              "build",
              "out",
              ".git",
              ".next",
              ".turbo",
              ".cache",
              "coverage",
              ".venv",
              "__pycache__",
          ];

    const foundFolders: vscode.Uri[] = [];

    async function scanDirectory(uri: vscode.Uri) {
        const entries = await vscode.workspace.fs.readDirectory(uri);
        for (const [name, type] of entries) {
            const childUri = vscode.Uri.joinPath(uri, name);

            if (type === vscode.FileType.Directory) {
                if (excludeGlobs.includes(name)) continue;

                if (
                    name.localeCompare(folderName, undefined, {
                        sensitivity: "accent",
                    }) === 0
                ) {
                    foundFolders.push(childUri);
                }

                await scanDirectory(childUri);
            }
        }
    }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        console.error("❌ No workspace folders open.");
        return [];
    }

    for (const rootFolder of workspaceFolders) {
        let baseUri = rootFolder.uri;

        if (folderRelativeTo) {
            const matches = await findMatchingFoldersByName(
                folderRelativeTo,
                undefined,
                includeGenerated,
            );
            if (matches.length === 0) continue;
            baseUri = matches[0]; // only use first match
        }

        console.log(`🔍 Scanning from: ${baseUri.fsPath}`);
        await scanDirectory(baseUri);
    }

    console.log(
        `✅ Found folders: ${foundFolders.map((f) => f.fsPath).join(", ")}`,
    );
    return foundFolders;
}

export async function resolveFileTarget(
    file: FileTarget,
): Promise<vscode.TextDocument | undefined> {
    // Fallback to current editor
    if (file !== undefined && file.fallbackToActiveFile) {
        const active = vscode.window.activeTextEditor?.document;
        if (active) return active;
    }

    // Search for matching folder
    if (file.fileName === undefined) {
        return undefined; // Must specify fileName
    }
    const candidates = await findMatchingFoldersByName(
        file.folderName!,
        file.folderRelativeTo,
    );
    if (!candidates.length) return undefined;

    const folderPath = candidates[0].fsPath;
    const filePath = path.join(folderPath, file.fileName!);
    const fileUri = vscode.Uri.file(filePath);

    try {
        return await vscode.workspace.openTextDocument(fileUri);
    } catch {
        if (file.createIfNotExists) {
            await fs.mkdir(path.dirname(filePath), { recursive: true });
            await fs.writeFile(filePath, "", "utf8");
            return await vscode.workspace.openTextDocument(fileUri);
        }
    }

    return undefined;
}

export async function resolveOrFallbackToFile(
    file: FileTarget | undefined,
): Promise<vscode.TextDocument | undefined> {
    if (!file || file.fallbackToActiveFile) {
        const active = vscode.window.activeTextEditor?.document;
        if (active) return active;
    }

    if (!file?.fileName || !file?.folderName) return undefined;
    const folders = await findMatchingFoldersByName(
        file.folderName,
        file.folderRelativeTo,
    );
    if (!folders.length) return undefined;

    const folderPath = folders[0].fsPath;
    const filePath = path.join(folderPath, file.fileName);
    const fileUri = vscode.Uri.file(filePath);

    try {
        return await vscode.workspace.openTextDocument(fileUri);
    } catch {
        if (file.createIfNotExists) {
            await fs.mkdir(path.dirname(filePath), { recursive: true });
            await fs.writeFile(filePath, "", "utf8");
            return await vscode.workspace.openTextDocument(fileUri);
        }
    }

    return undefined;
}

export async function showDocumentInEditor(
    doc: vscode.TextDocument,
): Promise<vscode.TextEditor | undefined> {
    const editor = await vscode.window.showTextDocument(doc, {
        preview: false,
        preserveFocus: false,
    });
    return editor;
}

export async function isCopilotEnabled(): Promise<boolean> {
    const copilot = vscode.extensions.getExtension("GitHub.copilot");
    if (!copilot) return false;

    if (!copilot.isActive) {
        try {
            await copilot.activate(); // Activates the extension if not already
        } catch {
            return false;
        }
    }

    return true;
}

//Triggers inline suggestion (e.g., Copilot inline completion) at the current cursor.
export async function triggerCopilotInlineCompletion(
    editor: vscode.TextEditor,
): Promise<void> {
    await vscode.commands.executeCommand("editor.action.inlineSuggest.trigger");
}

export async function triggerAndMaybeAcceptInlineSuggestion(
    opts: {
        autoAccept?: boolean; // if true, try to accept immediately
        navigate?: "next" | "prev"; // optional cycling
    } = {},
) {
    // show suggestion
    await vscode.commands.executeCommand("editor.action.inlineSuggest.trigger");

    if (opts.navigate === "next") {
        await vscode.commands.executeCommand(
            "editor.action.inlineSuggest.showNext",
        );
    } else if (opts.navigate === "prev") {
        await vscode.commands.executeCommand(
            "editor.action.inlineSuggest.showPrevious",
        );
    }

    if (opts.autoAccept) {
        try {
            // Accept the visible inline suggestion (equivalent to pressing Tab)
            await vscode.commands.executeCommand(
                "editor.action.inlineSuggest.commit",
            );
        } catch {
            // Fallback: prompt the user if the command isn't available on their build
            vscode.window.setStatusBarMessage(
                "Press Tab to accept Copilot suggestion",
                3000,
            );
        }
    }
}

export async function triggerCopilotThenRemovePromptComment(
    editor: vscode.TextEditor,
    commentLine: number,
): Promise<void> {
    // Trigger Copilot suggestion
    await triggerAndMaybeAcceptInlineSuggestion({ autoAccept: true });
    await new Promise((resolve) => setTimeout(resolve, 150));

    const doc = editor.document;

    // Delete the comment line
    if (commentLine < doc.lineCount) {
        const lineRange = doc.lineAt(commentLine).range;
        await editor.edit((editBuilder) => {
            editBuilder.delete(lineRange);
        });
    }

    // Move the cursor to the next non-empty line after Copilot suggestion
    let newLine = Math.max(0, commentLine); // Account for shifted lines
    while (newLine < doc.lineCount && doc.lineAt(newLine).isEmptyOrWhitespace) {
        newLine++;
    }

    const newPos = new vscode.Position(newLine, 0);
    editor.selection = new vscode.Selection(newPos, newPos);
    editor.revealRange(new vscode.Range(newPos, newPos));
}

export function getIndentationString(doc: vscode.TextDocument): string {
    const editor = vscode.window.visibleTextEditors.find(
        (e) => e.document === doc,
    );
    const opts = editor?.options;
    if (opts && opts.insertSpaces && typeof opts.tabSize === "number") {
        return " ".repeat(Number(opts.tabSize));
    }
    return "\t";
}

export type CursorTarget =
    | { type: "atCursor" }
    | { type: "insideFunction"; name: string }
    | { type: "afterLine"; line: number }
    | { type: "beforeLine"; line: number }
    | { type: "inSelection" }
    | { type: "atStartOfFile" }
    | { type: "atEndOfFile" }
    | { type: "insideClass"; name: string }
    | { type: "insideBlockComment"; containingText?: string }
    | { type: "inFile"; filePath: string; fallback?: CursorTarget }; // Optional fallback if file is not open

export function resolvePosition(
    editor: vscode.TextEditor,
    target: CursorTarget,
): vscode.Position | undefined {
    const doc = editor.document;

    switch (target.type) {
        case "atCursor":
            return editor.selection.active;

        case "atStartOfFile":
            return new vscode.Position(0, 0);

        case "atEndOfFile":
            return new vscode.Position(doc.lineCount, 0);

        case "afterLine": {
            const line = Math.min(target.line + 1, doc.lineCount);
            return new vscode.Position(line, 0);
        }

        case "beforeLine": {
            const line = Math.max(0, target.line - 1);
            return new vscode.Position(line, 0);
        }

        case "inSelection":
            return editor.selection.start;

        case "insideBlockComment": {
            const text = doc.getText();
            const lines = text.split("\n");

            let startLine = -1;
            let endLine = -1;

            for (let i = 0; i < lines.length; i++) {
                if (lines[i].includes("/*")) startLine = i;
                if (lines[i].includes("*/") && startLine >= 0) {
                    endLine = i;
                    const commentBlock = lines
                        .slice(startLine, endLine + 1)
                        .join("\n");

                    if (
                        !target.containingText ||
                        commentBlock.includes(target.containingText)
                    ) {
                        return new vscode.Position(endLine + 1, 0);
                    }

                    // Reset search
                    startLine = -1;
                    endLine = -1;
                }
            }

            // Fallback: insert at cursor
            return editor.selection.active;
        }

        case "insideFunction": {
            const regex = buildFunctionRegex(target.name);
            const text = doc.getText();
            const match = regex.exec(text);

            if (match) {
                const matchOffset = match.index + match[0].length;
                const pos = doc.positionAt(matchOffset);

                // insert just after function declaration line
                const functionLine = doc.lineAt(pos.line);
                return new vscode.Position(functionLine.lineNumber + 1, 0);
            }

            // fallback: insert at cursor
            return editor.selection.active;
        }

        case "insideClass": {
            const classRegex = new RegExp(`\\bclass\\s+${target.name}\\b`);
            const text = doc.getText();
            const match = classRegex.exec(text);

            if (match) {
                const matchOffset = match.index + match[0].length;
                const pos = doc.positionAt(matchOffset);
                const classLine = doc.lineAt(pos.line);
                return new vscode.Position(classLine.lineNumber + 1, 0);
            }

            return editor.selection.active;
        }

        case "inFile": {
            // This is handled outside via resolveOrFallbackToFile
            return resolvePosition(
                editor,
                target.fallback ?? { type: "atEndOfFile" },
            );
        }

        default:
            return editor.selection.active;
    }
}

type ActiveFileMeta = {
    filePath: string;
    languageId: string;
    isUntitled: boolean;
    isDirty: boolean;
};

function buildFunctionRegex(name: string): RegExp {
    return new RegExp(
        [
            `\\bfunction\\s+${name}\\b`, // JS/TS
            `\\b${name}\\s*\\([^)]*\\)\\s*{`, // JS/TS inline
            `\\bdef\\s+${name}\\s*\\(`, // Python
            `\\b${name}\\s*:\\s*function\\b`, // JS object-style
        ].join("|"),
        "i",
    );
}

export function getActiveFileMetadata(): ActiveFileMeta | null {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return null;

    const { document } = editor;
    return {
        filePath: document.uri.fsPath || document.uri.toString(true),
        languageId: document.languageId,
        isUntitled: document.isUntitled,
        isDirty: document.isDirty,
    };
}

function wait(ms: number) {
    return new Promise((res) => setTimeout(res, ms));
}

/**
 * Moves the caret to a new blank line immediately after the function
 * that begins at or near `startAnchor` (where we inserted).
 * Uses document symbols for reliability across edits and Copilot changes.
 */
export async function placeCursorAfterCurrentFunction(
    editor: vscode.TextEditor,
    startAnchor: vscode.Position,
    opts: { functionName?: string; retries?: number; delayMs?: number } = {},
) {
    const { functionName, retries = 6, delayMs = 120 } = opts;
    const { document } = editor;

    // Tiny retry loop to let Copilot or snippet finish applying edits.
    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            const symbols = (await vscode.commands.executeCommand(
                "vscode.executeDocumentSymbolProvider",
                document.uri,
            )) as vscode.DocumentSymbol[] | undefined;

            if (!symbols || !symbols.length) {
                await wait(delayMs);
                continue;
            }

            // Flatten symbol tree for easy scanning
            const flat: vscode.DocumentSymbol[] = [];
            const collect = (arr: vscode.DocumentSymbol[]) => {
                for (const s of arr) {
                    flat.push(s);
                    if (s.children?.length) collect(s.children);
                }
            };
            collect(symbols);

            // Filter to functions-like symbols
            const functionKinds = new Set([
                vscode.SymbolKind.Function,
                vscode.SymbolKind.Method,
                vscode.SymbolKind.Constructor,
            ]);

            let candidate: vscode.DocumentSymbol | undefined;

            if (functionName) {
                candidate = flat.find(
                    (s) => functionKinds.has(s.kind) && s.name === functionName,
                );
            }

            // If no name or not found, pick the function whose range contains startAnchor
            if (!candidate) {
                candidate = flat
                    .filter((s) => functionKinds.has(s.kind))
                    .find(
                        (s) =>
                            s.range.contains(startAnchor) ||
                            s.range.start.line === startAnchor.line,
                    );
            }

            // As a fallback, pick the nearest function starting at/after the anchor
            if (!candidate) {
                candidate = flat
                    .filter((s) => functionKinds.has(s.kind))
                    .sort((a, b) => a.range.start.compareTo(b.range.start))
                    .find((s) => s.range.start.isAfterOrEqual(startAnchor));
            }

            if (!candidate) {
                await wait(delayMs);
                continue;
            }

            // End of function block
            let end = candidate.range.end;

            // Ensure there's a blank line after the block
            const lastLineIndex = document.lineCount - 1;
            const afterLineIndex = Math.min(end.line + 1, lastLineIndex);
            const afterLine = document.lineAt(afterLineIndex);

            if (afterLineIndex === end.line) {
                // Symbol ended mid-line (rare) – move to line end first
                end = new vscode.Position(
                    end.line,
                    document.lineAt(end.line).text.length,
                );
            }

            if (afterLine.text.trim().length !== 0) {
                // Insert a newline after the function so we’re always on a blank line
                await editor.edit((eb) => {
                    eb.insert(new vscode.Position(end.line + 1, 0), "\n");
                });
            }

            // Place caret at the start of the line after the function
            const target = new vscode.Position(end.line + 1, 0);
            editor.selection = new vscode.Selection(target, target);
            editor.revealRange(
                new vscode.Range(target, target),
                vscode.TextEditorRevealType.InCenter,
            );
            return;
        } catch {
            // keep retrying
        }

        await wait(delayMs);
    }
}

export async function ensureSingleBlankLineAtCursor(editor: vscode.TextEditor) {
    const pos = editor.selection.active;
    const line = editor.document.lineAt(pos.line);

    // If current line has text, add a newline and move
    if (line.text.trim() !== "") {
        await editor.edit((eb) =>
            eb.insert(new vscode.Position(pos.line + 1, 0), "\n"),
        );
        const next = new vscode.Position(pos.line + 1, 0);
        editor.selection = new vscode.Selection(next, next);
        return;
    }

    // Collapse any extra blank lines to a single one
    let endLine = pos.line;
    const lastLine = editor.document.lineCount - 1;
    while (
        endLine + 1 <= lastLine &&
        editor.document.lineAt(endLine + 1).text.trim() === ""
    ) {
        endLine++;
    }
    if (endLine > pos.line) {
        await editor.edit((eb) =>
            eb.delete(
                new vscode.Range(
                    new vscode.Position(pos.line + 1, 0),
                    new vscode.Position(endLine + 1, 0),
                ),
            ),
        );
    }
}
