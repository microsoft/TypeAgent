// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionResult } from "./helpers";
import * as path from "path";
import * as vscode from "vscode";
import * as fs from "fs/promises";

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
                if (name === relativeFolderName) {
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

async function handleOpenFileAction(action: any): Promise<ActionResult> {
    let actionResult: ActionResult = {
        handled: true,
        message: "Ok",
    };

    const parameters = action?.parameters;
    if (!parameters || typeof parameters.fileName !== "string") {
        vscode.window.showErrorMessage(
            "Invalid action: 'fileName' is required.",
        );
        actionResult.handled = false;
        actionResult.message = "Invalid action: 'fileName' is required.";
        return actionResult;
    }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage(
            "No workspace or folder is currently open.",
        );
        actionResult.handled = false;
        actionResult.message;
        return actionResult;
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
        actionResult.handled = false;
        actionResult.message = `No matching file found for "${fileName}".`;
        return actionResult;
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

export async function handleCreateFolderFromExplorer1(
    action: any,
): Promise<ActionResult> {
    let actionResult: ActionResult = {
        handled: true,
        message: "Ok",
    };

    const parameters = action?.parameters;
    if (!parameters || typeof parameters.folderName !== "string") {
        vscode.window.showErrorMessage(
            "Missing or invalid 'folderName' parameter.",
        );
        actionResult.handled = false;
        actionResult.message = "Missing or invalid 'folderName' parameter.";
        return actionResult;
    }

    const { folderName, relativeTo, resolutionHint } = parameters;
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
        vscode.window.showErrorMessage("No workspace folder is open.");
        actionResult.handled = false;
        actionResult.message = "No workspace folder is open.";
        return actionResult;
    }

    let baseDir: string | undefined;

    if (relativeTo) {
        // Attempt to resolve relativeTo
        const searchPattern = `**/${relativeTo}`;
        const matches = await vscode.workspace.findFiles(
            searchPattern,
            "**/node_modules/**",
            1,
        );

        if (matches.length > 0) {
            const matchPath = matches[0].fsPath;
            const stats = await fs.stat(matchPath);
            baseDir = stats.isDirectory() ? matchPath : path.dirname(matchPath);
        } else if (resolutionHint === "workspaceRoot") {
            baseDir = workspaceRoot;
        } else {
            vscode.window.showErrorMessage(
                `Could not find folder or file matching '${relativeTo}'.`,
            );
            actionResult.handled = false;
            actionResult.message = `Could not find folder or file matching '${relativeTo}'.`;
            return actionResult;
        }
    }

    // Fallback to workspace root if baseDir still undefined
    if (!baseDir) {
        baseDir = workspaceRoot;
    }

    const targetPath = path.join(baseDir, folderName);

    try {
        await fs.mkdir(targetPath, { recursive: true });
        vscode.window.showInformationMessage(
            `✅ Folder created: ${vscode.workspace.asRelativePath(targetPath)}`,
        );
        actionResult.message = `✅ Folder created: ${vscode.workspace.asRelativePath(targetPath)}`;
    } catch (err) {
        vscode.window.showErrorMessage(`❌ Failed to create folder: ${err}`);
        actionResult.handled = false;
        actionResult.message = `❌ Failed to create folder: ${err}`;
    }
    return actionResult;
}

async function handleCreateFolderFromExplorer(
    action: any,
): Promise<ActionResult> {
    const parameters = action?.parameters;
    if (!parameters || typeof parameters.folderName !== "string") {
        const msg = "❌ Missing or invalid 'folderName' parameter.";
        vscode.window.showErrorMessage(msg);
        return { handled: false, message: msg };
    }

    const { folderName, relativeTo } = parameters;
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
        const msg = "❌ No workspace folder is open.";
        vscode.window.showErrorMessage(msg);
        return { handled: false, message: msg };
    }

    let parentDir: vscode.Uri;

    if (relativeTo) {
        const matches = await findMatchingFolders(relativeTo);

        if (matches.length === 0) {
            const msg = `❌ No folders named '${relativeTo}' found.`;
            vscode.window.showErrorMessage(msg);
            return { handled: false, message: msg };
        } else if (matches.length === 1) {
            parentDir = matches[0];
        } else {
            const pick = await vscode.window.showQuickPick(
                matches.map((uri) => ({
                    label: vscode.workspace.asRelativePath(uri),
                    uri,
                })),
                {
                    placeHolder: `Multiple folders named '${relativeTo}' found. Select where to create '${folderName}':`,
                },
            );
            if (!pick) {
                const msg = "⚠️ Folder creation cancelled by user.";
                vscode.window.showInformationMessage(msg);
                return { handled: false, message: msg };
            }
            parentDir = pick.uri;
        }
    } else {
        parentDir = vscode.Uri.file(workspaceRoot);
    }

    const targetPath = path.join(parentDir.fsPath, folderName);

    try {
        await fs.access(targetPath);
        const msg = `⚠️ Folder already exists: ${vscode.workspace.asRelativePath(targetPath)}`;
        vscode.window.showWarningMessage(msg);
        return { handled: true, message: msg };
    } catch {
        try {
            await fs.mkdir(targetPath, { recursive: true });
            const msg = `✅ Folder created: ${vscode.workspace.asRelativePath(targetPath)}`;
            vscode.window.showInformationMessage(msg);
            return { handled: true, message: msg };
        } catch (err) {
            const msg = `❌ Failed to create folder: ${err}`;
            vscode.window.showErrorMessage(msg);
            return { handled: false, message: msg };
        }
    }
}

export async function handleWorkbenchActions(
    action: any,
): Promise<ActionResult> {
    let actionResult: ActionResult = {
        handled: true,
        message: "Ok",
    };

    const actionName =
        action.actionName ?? action.fullActionName.split(".").at(-1);

    switch (actionName) {
        case "WorkbenchOpenFile":
            actionResult = await handleOpenFileAction(action);
            break;
        case "WorkbenchCreateFolderFromExplorer":
            actionResult = await handleCreateFolderFromExplorer(action);
            break;
        default: {
            actionResult.message = `Did not understand the request for action: "${actionName}"`;
            actionResult.handled = false;
        }
    }

    return actionResult;
}
