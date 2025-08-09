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
    triggerAndMaybeAcceptInlineSuggestion,
    placeCursorAfterCurrentFunction,
    ensureSingleBlankLineAtCursor,
} from "./helpers";
import {
    ensureFunctionDeclarationClosure,
    generateDocComment,
    getClosingBraceIfNeeded,
    needsClosingBrace,
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

export async function handleCreateFunctionActionAlt(
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

        // Compute spacing before insertion (unchanged)
        let prefixSpacing = "";
        if (insertPos.line > 0) {
            const prevLineText = doc.lineAt(insertPos.line - 1).text.trim();
            if (prevLineText !== "") {
                const prevLineIsBlockDecl =
                    /^(export\s+)?(async\s+)?(function|class)\b/.test(
                        prevLineText,
                    );
                prefixSpacing = prevLineIsBlockDecl ? "\n\n" : "\n";
            }
        }

        const isBodyEmpty = body === undefined || body.trim() === "";
        if (isBodyEmpty) {
            const docComment = generateDocComment(docstring, language, indent);

            const baseIndent = decl.match(/^\s*/)?.[0] ?? "";
            const closingBrace = language === "python" ? "" : `${baseIndent}}`;

            const snippetStr =
                language === "python"
                    ? // def ...:\n <doc>\n <indent>$0\n
                      `${prefixSpacing}${decl}\n${docComment}${indent}$0\n`
                    : // function ... {\n <doc>\n <indent>$0\n<closing brace>
                      `${prefixSpacing}${decl}\n${docComment}${indent}$0\n${closingBrace}\n`;

            await editor.insertSnippet(
                new vscode.SnippetString(snippetStr),
                insertPos,
            );

            if (await isCopilotEnabled()) {
                await triggerAndMaybeAcceptInlineSuggestion({
                    autoAccept: true,
                });
            }

            // After insertion + copilot trigger/accept flow:
            const anchorPos = insertPos; // where we started inserting

            // Pass the funnction name so symbol detection is more accurate
            await placeCursorAfterCurrentFunction(editor, anchorPos, {
                functionName: action.parameters.name,
            });

            return {
                handled: true,
                message: "✅ Inserted function and triggered Copilot.",
            };
        }

        // ---------- Non-empty body: keep original text-insert path ----------
        let snippet = `${decl}\n`;
        snippet += generateDocComment(docstring, language, indent);

        const indentedBody = body
            .split("\n")
            .map((line: string) => (line.trim() ? indent + line : line))
            .join("\n");
        snippet += `${indentedBody}\n`;

        // Only add closing brace when body is provided
        snippet += getClosingBraceIfNeeded(language);

        // Prepend spacing computed earlier
        snippet = prefixSpacing + snippet;

        await editor.edit((editBuilder) => {
            editBuilder.insert(insertPos, snippet + "\n");
        });

        // Place cursor at start of body (best-effort)
        const snippetLines = snippet.split("\n");
        const lineOffset = snippetLines.length - 2;
        const bodyLine = insertPos.line + lineOffset;
        const bodyPos = new vscode.Position(bodyLine, indent.length);
        editor.selection = new vscode.Selection(bodyPos, bodyPos);

        return {
            handled: true,
            message: "✅ Inserted function and filled body.",
        };
    } catch (err: any) {
        return { handled: false, message: `❌ Error: ${err.message}` };
    }
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

        // Indentation derived from the declaration
        const baseIndent = decl.match(/^\s*/)?.[0] ?? "";
        const innerIndent = baseIndent + indent;

        // Compute spacing before insertion
        let prefixSpacing = "";
        if (insertPos.line > 0) {
            const prevLineText = doc.lineAt(insertPos.line - 1).text.trim();
            if (prevLineText !== "") {
                const prevLineIsBlockDecl =
                    /^(export\s+)?(async\s+)?(function|class)\b/.test(
                        prevLineText,
                    );
                prefixSpacing = prevLineIsBlockDecl ? "\n\n" : "\n";
            }
        }

        // Prepare doc comment (already includes trailing \n if non-empty)
        const docComment = generateDocComment(docstring, language, innerIndent);

        // Always try to end with ONE blank line after the function.
        const trailingAfterFunction = "\n";

        // ---------- Empty body: use snippet + Copilot ----------
        const isBodyEmpty = body === undefined || body.trim() === "";
        if (isBodyEmpty) {
            const closingBrace = needsClosingBrace(language)
                ? `${baseIndent}}\n`
                : "";
            const docBlock = docComment || "";
            const snippetStr =
                language === "python"
                    ? // def ...:\n <doc>\n <innerIndent>$0\n\n
                      `${prefixSpacing}${decl}\n${docBlock}${innerIndent}$0\n${trailingAfterFunction}`
                    : // function ... {\n <doc>\n <innerIndent>$0\n}<\n>\n
                      `${prefixSpacing}${decl}\n${docBlock}${innerIndent}$0\n${closingBrace}${trailingAfterFunction}`;

            await editor.insertSnippet(
                new vscode.SnippetString(snippetStr),
                insertPos,
            );

            if (await isCopilotEnabled()) {
                await triggerAndMaybeAcceptInlineSuggestion({
                    autoAccept: true,
                });
            }

            // Prefer cursor AFTER the function. Also ensure there’s exactly one blank line there.
            await placeCursorAfterCurrentFunction(editor, insertPos, {
                functionName: action.parameters.name,
            });
            await ensureSingleBlankLineAtCursor(editor);

            return {
                handled: true,
                message: "✅ Inserted function and triggered Copilot.",
            };
        }

        // ---------- Non-empty body path ----------
        let snippet = `${decl}\n`;

        if (docComment) {
            snippet += docComment; // already newline-terminated
        }

        const indentedBody = body
            .split("\n")
            .map((line: string) => (line.trim() ? innerIndent + line : line))
            .join("\n");

        snippet += `${indentedBody}\n`;

        if (needsClosingBrace(language)) {
            snippet += `${baseIndent}}\n`;
        }

        // Make sure to always leave one blank line after the function
        snippet += trailingAfterFunction;

        // Prepend spacing computed earlier
        snippet = prefixSpacing + snippet;

        await editor.edit((editBuilder) => {
            editBuilder.insert(insertPos, snippet);
        });

        // Always move the cursor after the function end and ensure a single blank line
        await placeCursorAfterCurrentFunction(editor, insertPos, {
            functionName: action.parameters.name,
        });
        await ensureSingleBlankLineAtCursor(editor);

        return {
            handled: true,
            message: "✅ Inserted function and filled body.",
        };
    } catch (err: any) {
        return { handled: false, message: `❌ Error: ${err.message}` };
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
