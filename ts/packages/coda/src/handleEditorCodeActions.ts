// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs/promises";
import {
    findMatchingFoldersByName,
    ActionResult,
    isCopilotEnabled,
    getIndentationString,
    resolveOrFallbackToFile,
    resolvePosition,
    showDocumentInEditor,
    triggerCopilotInlineCompletion,
} from "./helpers";
import {
    ensureFunctionDeclarationClosure,
    generateDocComment,
    getClosingBraceIfNeeded,
} from "./codeUtils";

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

export async function handleSaveCurrentFileAction(
    action: any,
): Promise<ActionResult> {
    const {
        showErrorIfNoActiveEditor = true,
        onlyDirty = false,
        excludeUntitled = false,
    } = action.parameters ?? {};

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        if (showErrorIfNoActiveEditor) {
            vscode.window.showErrorMessage("❌ No active editor to save.");
        }
        return {
            handled: false,
            message: "❌ No active editor to save.",
        };
    }

    const { document } = editor;
    if (excludeUntitled && document.isUntitled) {
        return {
            handled: false,
            message: "🚫 Current file is untitled and excluded from saving.",
        };
    }

    if (onlyDirty && !document.isDirty) {
        return {
            handled: false,
            message: "✅ Current file has no unsaved changes.",
        };
    }

    try {
        await document.save();
        return {
            handled: true,
            message: `💾 Saved current file: ${document.fileName}`,
        };
    } catch (err: any) {
        return {
            handled: false,
            message: `❌ Failed to save current file: ${err.message}`,
        };
    }
}

export async function handleSaveAllFilesAction(
    action: any,
): Promise<ActionResult> {
    const {
        onlyDirty = false,
        excludeUntitled = false,
        logResult = true,
    } = action.parameters ?? {};

    const textDocs = vscode.workspace.textDocuments;
    const docsToSave = textDocs.filter((doc) => {
        if (excludeUntitled && doc.isUntitled) return false;
        if (onlyDirty && !doc.isDirty) return false;
        return true;
    });

    const results: boolean[] = [];
    for (const doc of docsToSave) {
        try {
            const saved = await doc.save();
            results.push(saved);
        } catch {
            results.push(false);
        }
    }

    const allSuccess = results.every(Boolean);
    const message = allSuccess
        ? `💾 Saved ${docsToSave.length} file(s).`
        : `⚠️ Some files failed to save (${results.filter((r) => !r).length} of ${docsToSave.length}).`;

    if (logResult) {
        vscode.window.showInformationMessage(message);
    }

    return {
        handled: true,
        message,
    };
}

export async function handleCreateFunctionAction(
    action: any,
): Promise<ActionResult> {
    const {
        functionDeclaration,
        body,
        docstring,
        language,
        file,
        position = { type: "atCursor" },
    } = action.parameters;

    try {
        const doc = await resolveOrFallbackToFile(file);
        if (!doc) {
            return {
                handled: false,
                message: "❌ Could not resolve target file.",
            };
        }

        const editor = await showDocumentInEditor(doc);
        if (!editor) {
            return {
                handled: false,
                message: "❌ Could not open document in editor.",
            };
        }

        const insertPos = resolvePosition(editor, position);
        if (!insertPos) {
            return {
                handled: false,
                message: "❌ Could not resolve insertion position.",
            };
        }

        const indent = getIndentationString(doc);
        const decl = ensureFunctionDeclarationClosure(
            functionDeclaration,
            language,
        );

        let snippet = `${decl}\n`;
        snippet += generateDocComment(docstring, language, indent);

        const isBodyEmpty = body === undefined || body.trim() === "";
        if (!isBodyEmpty) {
            const indentedBody = body
                .split("\n")
                .map((line: string) => (line.trim() ? indent + line : line))
                .join("\n");

            snippet += `${indentedBody}\n`;
            snippet += getClosingBraceIfNeeded(language);
        }

        await editor.edit((editBuilder) => {
            editBuilder.insert(insertPos, snippet + "\n");
        });

        const lineOffset = snippet.split("\n").length - (isBodyEmpty ? 1 : 2);
        const bodyLine = insertPos.line + lineOffset;
        const bodyPos = new vscode.Position(bodyLine, indent.length);
        editor.selection = new vscode.Selection(bodyPos, bodyPos);

        if (isBodyEmpty && (await isCopilotEnabled())) {
            await triggerCopilotInlineCompletion(editor);
        }

        return {
            handled: true,
            message: `✅ Inserted function and ${
                isBodyEmpty ? "triggered Copilot." : "filled body."
            }`,
        };
    } catch (err: any) {
        return {
            handled: false,
            message: `❌ Error: ${err.message}`,
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

        case "saveCurrentFile":
            actionResult = await handleSaveCurrentFileAction(action);
            break;

        case "saveAllFiles":
            actionResult = await handleSaveAllFilesAction(action);
            break;

        case "createFunction":
            actionResult = await handleCreateFunctionAction(action);
            break;

        default:
            actionResult.handled = false;
            actionResult.message = `❌ Unknown action: ${actionName}`;
            break;
    }

    return actionResult;
}
