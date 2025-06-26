// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionResult } from "./helpers";
import * as path from "path";
import * as vscode from "vscode";

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
    const allFiles = await vscode.workspace.findFiles(
        "**/*",
        excludePattern,
        maxResults * 10,
    );

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

export async function handleOpenFileAction(action: any) {
    let actionResult: ActionResult = {
        handled: true,
        message: "Ok",
    };

    const parameters = action?.parameters;
    if (!parameters || typeof parameters.fileName !== "string") {
        vscode.window.showErrorMessage(
            "Invalid action: 'fileName' is required.",
        );
        return;
    }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage(
            "No workspace or folder is currently open.",
        );
        return;
    }

    const {
        fileName,
        matchStrategy = "exact",
        extensions,
        includeGenerated = false,
    }: {
        fileName: string;
        matchStrategy?: "exact" | "fuzzy";
        extensions?: string[];
        includeGenerated?: boolean;
    } = parameters;

    const matches = await findMatchingFiles(fileName, {
        matchStrategy,
        extensions,
        includeGenerated,
        maxResults: 5,
    });

    if (matches.length === 0) {
        vscode.window.showWarningMessage(
            `No matching file found for "${fileName}".`,
        );
        return;
    }

    const targetUri = matches[0];
    try {
        const doc = await vscode.workspace.openTextDocument(targetUri);
        await vscode.window.showTextDocument(doc);
    } catch (err) {
        //vscode.window.showErrorMessage(`Failed to open file: ${err}`);
    }

    return actionResult;
}
