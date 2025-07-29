// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs/promises";
import { findMatchingFoldersByName, ActionResult } from "./helpers";

export async function handleCreateFileAction(
    action: any,
): Promise<ActionResult> {
    const params = action?.parameters;
    if (!params) {
        return {
            handled: false,
            message: "❌ Missing parameters for createFile.",
        };
    }

    const {
        fileName,
        folderName,
        folderRelativeTo,
        language,
        untitled,
        openInEditor = true,
        content = "",
        overwriteIfExists = false,
        focusExistingIfOpen = true,
    } = params;

    try {
        let baseDir: string | undefined;

        if (folderName) {
            const matches = await findMatchingFoldersByName(
                folderName,
                folderRelativeTo,
            );
            if (matches.length === 0) {
                return {
                    handled: false,
                    message:
                        `❌ Could not find folder "${folderName}"` +
                        (folderRelativeTo
                            ? ` under "${folderRelativeTo}".`
                            : "."),
                };
            }
            baseDir = matches[0].fsPath;
        } else if (vscode.workspace.workspaceFolders?.length) {
            baseDir = vscode.workspace.workspaceFolders[0].uri.fsPath;
        } else {
            baseDir = process.cwd(); // fallback
        }

        if (untitled) {
            const doc = await vscode.workspace.openTextDocument({
                content,
                language,
            });
            if (openInEditor) {
                await vscode.window.showTextDocument(doc, { preview: false });
            }
            return {
                handled: true,
                message: `📄 Created untitled ${language ?? ""} file: ${doc.fileName}`,
            };
        }

        if (!fileName) {
            return {
                handled: false,
                message:
                    "❌ 'fileName' is required for disk-based file creation.",
            };
        }

        const fullPath = path.join(baseDir, fileName);
        const uri = vscode.Uri.file(fullPath);

        let fileExists = false;
        try {
            await fs.access(uri.fsPath);
            fileExists = true;
        } catch {}

        if (fileExists && !overwriteIfExists) {
            if (focusExistingIfOpen) {
                const doc = await vscode.workspace.openTextDocument(uri);
                if (openInEditor)
                    await vscode.window.showTextDocument(doc, {
                        preview: false,
                    });
                return {
                    handled: true,
                    message: `📄 File already exists. Opened: ${uri.fsPath}`,
                };
            }
            return {
                handled: false,
                message: `⚠️ File already exists and overwrite is disabled: ${uri.fsPath}`,
            };
        }

        await fs.mkdir(path.dirname(uri.fsPath), { recursive: true });
        await fs.writeFile(uri.fsPath, content, { encoding: "utf8" });

        const doc = await vscode.workspace.openTextDocument(uri);
        if (openInEditor)
            await vscode.window.showTextDocument(doc, { preview: false });

        return {
            handled: true,
            message: `✅ Created file: ${uri.fsPath}`,
        };
    } catch (err: any) {
        return {
            handled: false,
            message: `❌ Error creating file: ${err.message}`,
        };
    }
}

export async function handleEditorCodeActions(
    action: any,
): Promise<ActionResult> {
    let actionResult: ActionResult = {
        handled: true,
        message: "Ok",
    };

    const actionName =
        action.actionName ?? action.fullActionName.split(".").at(-1);

    switch (actionName) {
        case "createFile":
            actionResult = await handleCreateFileAction(action);
            break;

        // Add more cases for other actions as needed
        default:
            actionResult.handled = false;
            actionResult.message = `❌ Unknown action: ${actionName}`;
            break;
    }

    return actionResult;
}
