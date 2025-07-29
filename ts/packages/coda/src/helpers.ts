// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "path";
import * as vscode from "vscode";
export interface ActionResult {
    handled: boolean;
    message: string;
}

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
