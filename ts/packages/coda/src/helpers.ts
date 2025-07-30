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

        case "atEndOfFile":
            return new vscode.Position(doc.lineCount, 0);

        case "afterLine": {
            const line = Math.min(target.line + 1, doc.lineCount);
            return new vscode.Position(line, 0);
        }

        case "beforeLine": {
            const line = Math.max(0, target.line);
            return new vscode.Position(line, 0);
        }

        case "insideFunction":
            // This requires function parsing or symbol analysis, which you can implement later
            console.warn(
                "resolvePosition: 'insideFunction' is not yet supported.",
            );
            return undefined;

        default:
            console.warn(
                `resolvePosition: Unknown target type: ${(target as any).type}`,
            );
            return undefined;
    }
}
