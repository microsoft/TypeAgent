// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs/promises";
import {
    findMatchingFoldersByName,
    ActionResult,
    isCopilotEnabled,
    isCopilotChatAvailable,
    getIndentationString,
    generateDocPromptLine,
    //getIndentContext,
    //getLineIndentation,
    getIndentContextSmart,
    resolveOrFallbackToFile,
    resolvePosition,
    showDocumentInEditor,
    triggerAndMaybeAcceptInlineSuggestion,
    triggerCopilotThenRemovePromptComment,
    placeCursorAfterCurrentFunction,
    ensureSingleBlankLineAtCursor,
    pickProblemForFile,
    WorkspaceDiagnostic,
    requestCopilotFix,
} from "./helpers";
import {
    ensureFunctionDeclarationClosure,
    generateDocComment,
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

export async function handleCreateFunctionAction(
    action: any,
): Promise<ActionResult> {
    const {
        functionDeclaration,
        body,
        docstring,
        language,
        file,
        position: rawPosition,
    } = action.parameters;

    const position = rawPosition ?? { type: "atEndOfFile" };

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

export async function handleCreateCodeBlockActionAlt(
    action: any,
): Promise<ActionResult> {
    const {
        language,
        docstring,
        declaration,
        body,
        codeSnippet,
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
        const baseIndent = ""; // optional: extract from insertPos line
        const innerIndent = baseIndent + indent;
        const copilotAvailable = await isCopilotEnabled();

        if (docstring) {
            const comment = generateDocPromptLine(
                docstring,
                language,
                innerIndent,
            );
            const snippet = `${comment}\n${innerIndent}$0`;

            await editor.insertSnippet(
                new vscode.SnippetString(snippet),
                insertPos,
            );

            if (copilotAvailable) {
                await triggerCopilotThenRemovePromptComment(
                    editor,
                    insertPos.line,
                );
            }

            return {
                handled: true,
                message:
                    "🧠 Inserted comment prompt" +
                    (copilotAvailable ? " and triggered Copilot." : "."),
            };
        }

        if (codeSnippet) {
            const prompt = generateDocPromptLine(
                docstring,
                language,
                innerIndent,
            );
            const snippet = `${prompt}\n${innerIndent}${codeSnippet.trim()}\n`;

            await editor.insertSnippet(
                new vscode.SnippetString(snippet),
                insertPos,
            );

            if (copilotAvailable) {
                await triggerAndMaybeAcceptInlineSuggestion({
                    autoAccept: true,
                });
            }

            return {
                handled: true,
                message:
                    "✅ Inserted code snippet" +
                    (copilotAvailable ? " with Copilot." : "."),
            };
        }

        if (declaration) {
            const decl = declaration.trim();
            const docComment = docstring
                ? generateDocComment(docstring, language, innerIndent)
                : "";

            let fullSnippet = `${decl}\n`;
            if (docComment) fullSnippet += docComment;

            if (body) {
                const formattedBody = body
                    .split("\n")
                    .map((line: string) =>
                        line.trim() ? innerIndent + line : "",
                    )
                    .join("\n");
                fullSnippet += `${formattedBody}\n`;
            } else if (copilotAvailable) {
                fullSnippet += `${innerIndent}$0\n`;
            } else {
                fullSnippet += `${innerIndent}// TODO: implement\n`;
            }

            if (needsClosingBrace(language)) {
                fullSnippet += "}\n";
            }

            await editor.insertSnippet(
                new vscode.SnippetString(fullSnippet),
                insertPos,
            );

            if (!body && copilotAvailable) {
                await triggerAndMaybeAcceptInlineSuggestion({
                    autoAccept: true,
                });
            }

            return {
                handled: true,
                message: body
                    ? "✅ Inserted structured block with body."
                    : copilotAvailable
                      ? "✅ Inserted block and triggered Copilot."
                      : "✅ Inserted block with TODO placeholder.",
            };
        }

        return {
            handled: false,
            message:
                "❌ No usable codeSnippet, declaration, or docstring provided.",
        };
    } catch (err: any) {
        return {
            handled: false,
            message: `❌ Error inserting code block: ${err.message}`,
        };
    }
}

export async function handleCreateCodeBlockAction(
    action: any,
): Promise<ActionResult> {
    const {
        language,
        docstring,
        declaration,
        body,
        codeSnippet,
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

        const { baseIndent, innerIndent, atLineStart } = getIndentContextSmart(
            doc,
            insertPos,
            language,
        );

        // If cursor in mid-line, start on a new line:
        const prefixNewlineIfMidLine = atLineStart ? "" : "\n";

        // --- Spacing above the block (1 or 2 blank lines) ---
        let prefixSpacing = "";
        {
            // If we're starting on a fresh line (mid-line case), use that line index for "prev"
            const effectiveLine =
                insertPos.line + (prefixNewlineIfMidLine ? 1 : 0);
            if (effectiveLine > 0) {
                const prev = doc.lineAt(effectiveLine - 1).text.trim();
                if (prev !== "") {
                    const prevIsDecl =
                        /^(export\s+)?(async\s+)?(function|class)\b/.test(prev);
                    prefixSpacing = prevIsDecl ? "\n\n" : "\n";
                }
            }
        }

        const copilotAvailable = await isCopilotEnabled();

        // ===== 1) docstring-only → comment prompt + $0 + (optional) trigger copilot =====
        if (docstring && !declaration && !codeSnippet) {
            const comment = generateDocPromptLine(
                docstring,
                language,
                innerIndent,
            );
            const snippet =
                prefixNewlineIfMidLine + // new line if cursor mid-line
                prefixSpacing + // 1-2 blank lines above if needed
                `${comment}\n${innerIndent}$0`; // caret on its own indented line

            await editor.insertSnippet(
                new vscode.SnippetString(snippet),
                insertPos,
            );

            if (copilotAvailable) {
                await triggerCopilotThenRemovePromptComment(
                    editor,
                    insertPos.line,
                );
            }

            return {
                handled: true,
                message:
                    "🧠 Inserted comment prompt" +
                    (copilotAvailable ? " and triggered Copilot." : "."),
            };
        }

        // ===== 2) codeSnippet provided → insert snippet verbatim (indented), optionally trigger =====
        if (codeSnippet) {
            const prompt = docstring
                ? generateDocPromptLine(docstring, language, innerIndent)
                : "";
            const snippet =
                prefixNewlineIfMidLine +
                prefixSpacing +
                (prompt ? `${prompt}\n` : "") +
                innerIndent +
                codeSnippet.trim() +
                "\n";

            await editor.insertSnippet(
                new vscode.SnippetString(snippet),
                insertPos,
            );

            if (copilotAvailable) {
                await triggerAndMaybeAcceptInlineSuggestion({
                    autoAccept: true,
                });
            }

            return {
                handled: true,
                message:
                    "✅ Inserted code snippet" +
                    (copilotAvailable ? " with Copilot." : "."),
            };
        }

        // ===== 3) declaration (+ optional body) → structured block =====
        if (declaration) {
            const decl = declaration.trim();
            const docComment = docstring
                ? generateDocComment(docstring, language, innerIndent)
                : "";
            const hasBody = typeof body === "string" && body.trim().length > 0;

            let fullSnippet =
                prefixNewlineIfMidLine +
                prefixSpacing +
                `${baseIndent}${decl}\n` + // keep declaration aligned to baseIndent
                docComment; // already includes trailing \n if present

            if (hasBody) {
                const formattedBody = body!
                    .split("\n")
                    .map((line: string) =>
                        line.trim() ? innerIndent + line : "",
                    ) // empty lines remain empty
                    .join("\n");
                fullSnippet += `${formattedBody}\n`;
                if (needsClosingBrace(language)) {
                    // Closing brace aligned to baseIndent (not innerIndent)
                    fullSnippet += `${baseIndent}}\n`;
                }
            } else {
                // No body → keep caret inside block on its own line (snippet $0)
                if (language === "python") {
                    fullSnippet += `${innerIndent}$0\n`; // python has no closing brace
                } else {
                    fullSnippet += `${innerIndent}$0\n`; // TS/JS body line
                    // Do NOT add '}' here; let Copilot fill & possibly add it.
                }
            }

            await editor.insertSnippet(
                new vscode.SnippetString(fullSnippet),
                insertPos,
            );

            if (!hasBody && copilotAvailable) {
                await triggerAndMaybeAcceptInlineSuggestion({
                    autoAccept: true,
                });
            }

            return {
                handled: true,
                message: hasBody
                    ? "✅ Inserted structured block with body."
                    : copilotAvailable
                      ? "✅ Inserted block and triggered Copilot."
                      : "✅ Inserted block with TODO placeholder.",
            };
        }

        return {
            handled: false,
            message:
                "❌ No usable codeSnippet, declaration, or docstring provided.",
        };
    } catch (err: any) {
        return {
            handled: false,
            message: `❌ Error inserting code block: ${err.message}`,
        };
    }
}

export async function handleFixCodeProblemAction(
    action: any,
): Promise<ActionResult> {
    const { target, file } = action.parameters;

    try {
        // Resolve document
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

        const activeFileUri = doc.uri;

        // Collect diagnostics for this file
        const allDiagnostics: WorkspaceDiagnostic[] = vscode.languages
            .getDiagnostics(doc.uri)
            .map((d) => ({ uri: doc.uri, diagnostic: d }));

        if (allDiagnostics.length === 0) {
            return {
                handled: false,
                message: "✅ No problems found in this file.",
            };
        }

        // Pick the problem based on the target
        const problemToFix = pickProblemForFile(
            editor,
            allDiagnostics,
            target,
            activeFileUri,
        ) as WorkspaceDiagnostic | undefined;

        if (!problemToFix) {
            return {
                handled: false,
                message: `❌ No matching problem found for target "${JSON.stringify(target)}".`,
            };
        }

        // Apply Copilot fix
        const { diagnostic } = problemToFix;
        const accepted = await requestCopilotFix(editor, diagnostic);

        if (!accepted) {
            return {
                handled: false,
                message: "❌ Copilot did not provide a fix.",
            };
        }

        return {
            handled: true,
            message: `🔧 Fixed problem at ${activeFileUri.fsPath}:${diagnostic.range.start.line + 1}`,
        };
    } catch (err: any) {
        return {
            handled: false,
            message: `❌ Error handling fixProblem: ${err.message}`,
        };
    }
}

export async function handleMoveCursorInFileAction(
    action: any,
): Promise<ActionResult> {
    const { target, file, hint } = action.parameters;

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

        const pos = resolvePosition(editor, target);
        if (!pos) {
            return {
                handled: false,
                message: "❌ Could not resolve cursor position.",
            };
        }

        // move the cursor & reveal it ---
        const newSel = new vscode.Selection(pos, pos);
        editor.selection = newSel;
        editor.revealRange(new vscode.Range(pos, pos));

        return {
            handled: true,
            message: `✅ Cursor moved to ${pos.line + 1}:${pos.character + 1}${
                hint ? ` (hint: ${hint})` : ""
            }.`,
        };
    } catch (err: any) {
        return {
            handled: false,
            message: `❌ Error handling moveCursorInFile: ${err.message}`,
        };
    }
}

export async function handleUpsertLinesAction(
    action: any,
): Promise<ActionResult> {
    const {
        operation,
        count = 1,
        position = { type: "atCursor" },
        file,
        force = true,
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

        const pos = resolvePosition(editor, position);
        const targetLine = pos.line;

        await editor.edit((editBuilder) => {
            if (operation === "insert") {
                // Insert N empty lines
                const emptyLines = Array(count).fill("").join("\n") + "\n";
                editBuilder.insert(
                    new vscode.Position(targetLine, 0),
                    emptyLines,
                );
            } else if (operation === "delete") {
                // Delete N lines starting from target line
                const startLine = targetLine;
                const endLine = Math.min(startLine + count, doc.lineCount);

                for (let i = startLine; i < endLine; i++) {
                    if (i < doc.lineCount) {
                        const line = doc.lineAt(i);
                        if (force || line.isEmptyOrWhitespace) {
                            editBuilder.delete(line.rangeIncludingLineBreak);
                        }
                    }
                }
            }
        });

        return {
            handled: true,
            message:
                operation === "insert"
                    ? `➕ Inserted ${count} empty line(s).`
                    : force
                      ? `🗑️ Deleted ${count} line(s) (force).`
                      : `➖ Deleted up to ${count} empty line(s).`,
        };
    } catch (err: any) {
        return {
            handled: false,
            message: `❌ Error modifying empty lines: ${err.message}`,
        };
    }
}

// Build a fallback prompt for older VS Code builds that don't support inline
// file attachments: reference the attachment file paths inside the query text.
function buildFallbackCopilotQuery(
    query: string,
    attachFilePaths: string[],
): string {
    if (attachFilePaths.length === 0) {
        return query;
    }
    const list = attachFilePaths.map((p) => `- ${p}`).join("\n");
    return `${query}\n\nAttached context files:\n${list}`;
}

type LaunchCopilotChatAction = {
    parameters?: {
        query?: string;
        provider?: "copilot" | "claude" | "gpt" | "generic";
        mode?: "agent" | "ask";
        isPartialQuery?: boolean;
        attachScreenshot?: boolean;
        attachFiles?: string[];
        newSession?: boolean;
        newSessionLocation?: "view" | "editor" | "window";
    };
};

type ChatSessionLocation = "view" | "editor" | "window";

function resolveChatSessionLocation(value: unknown): ChatSessionLocation {
    if (value === "editor" || value === "window") {
        return value;
    }
    return "view";
}

function getChatOpenCommand(location: ChatSessionLocation): string {
    switch (location) {
        case "editor":
            return "workbench.action.openChat";
        case "window":
            return "workbench.action.newChatWindow";
        default:
            return "workbench.action.chat.newChat";
    }
}

function describeCopilotChatTarget(
    newSession: boolean,
    location: ChatSessionLocation,
): string {
    if (!newSession) {
        return "GitHub Copilot Chat";
    }
    if (location === "editor") {
        return "a new GitHub Copilot Chat editor";
    }
    if (location === "window") {
        return "a new GitHub Copilot Chat window";
    }
    return "a new GitHub Copilot Chat session";
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

// Hand the current TypeAgent conversation (+ optional dev-captures and a
// screenshot) to native GitHub Copilot Chat via `workbench.action.chat.open`.
// By default this starts a fresh chat session (in a new chat editor) and
// auto-submits the request, so the handoff doesn't append to — or wait on —
// whatever chat the user already had open.
// code-complexity-allow: command/compat flow is intentionally branch-heavy to preserve behavior across VS Code versions.
export async function handleLaunchCopilotChatAction(
    action: LaunchCopilotChatAction,
): Promise<ActionResult> {
    const params = action.parameters ?? {};
    const provider: "copilot" | "claude" | "gpt" | "generic" =
        params.provider === "claude" ||
        params.provider === "gpt" ||
        params.provider === "generic"
            ? params.provider
            : "copilot";

    // Route to provider-specific handler
    if (provider === "claude") {
        return handleClaudeChatAction(params);
    } else if (provider === "gpt") {
        return handleGPTChatAction(params);
    } else if (provider === "generic") {
        return handleGenericChatAction(params);
    } else {
        // Default: GitHub Copilot
        return handleCopilotChatAction(params);
    }
}

// GitHub Copilot Chat handler — uses native VS Code Copilot Chat integration
async function handleCopilotChatAction(
    params: Record<string, any>,
): Promise<ActionResult> {
    const query: string = typeof params.query === "string" ? params.query : "";
    const mode: string = params.mode === "ask" ? "ask" : "agent";
    const autoSend: boolean = params.isPartialQuery !== true;
    const attachScreenshot: boolean = params.attachScreenshot === true;
    const attachFilePaths: string[] = Array.isArray(params.attachFiles)
        ? params.attachFiles.filter((p: unknown) => typeof p === "string")
        : [];
    const newSession: boolean = params.newSession !== false;
    const newSessionLocation = resolveChatSessionLocation(
        params.newSessionLocation,
    );

    if (!(await isCopilotChatAvailable())) {
        return {
            handled: true,
            message:
                "❌ GitHub Copilot Chat is not available. Install and sign in to the GitHub Copilot Chat extension, then try again.",
        };
    }

    if (newSession) {
        const newSessionCommand = getChatOpenCommand(newSessionLocation);
        try {
            await vscode.commands.executeCommand(newSessionCommand);
        } catch {
            // Best-effort: older builds may lack the command
        }
    }

    const attachFiles = attachFilePaths.map((p) => vscode.Uri.file(p));

    const openedWhere = describeCopilotChatTarget(
        newSession,
        newSessionLocation,
    );

    let usedFallback = false;
    try {
        await vscode.commands.executeCommand("workbench.action.chat.open", {
            query,
            mode,
            isPartialQuery: true,
            attachScreenshot,
            attachFiles,
        });
    } catch {
        try {
            await vscode.commands.executeCommand("workbench.action.chat.open", {
                query: buildFallbackCopilotQuery(query, attachFilePaths),
                mode,
                isPartialQuery: true,
            });
            usedFallback = true;
        } catch (fallbackErr: unknown) {
            return {
                handled: true,
                message: `❌ Failed to open GitHub Copilot Chat: ${getErrorMessage(
                    fallbackErr,
                )}`,
            };
        }
    }

    let sent = false;
    if (autoSend) {
        try {
            await vscode.commands.executeCommand(
                "workbench.action.chat.submit",
            );
            sent = true;
        } catch {
            // Couldn't auto-submit; prompt stays pre-filled
        }
    }

    const attachNote = usedFallback
        ? " (attachments referenced by path - update VS Code for inline attachments)"
        : "";
    const tail = !autoSend
        ? ". Review the prompt, then send it to let Copilot diagnose and fix the problem."
        : sent
          ? " and sent the request to let Copilot diagnose and fix the problem."
          : ". The prompt is ready - press Enter in the chat to send it to Copilot.";
    return {
        handled: true,
        message: `✅ Opened ${openedWhere} with the conversation attached${attachNote}${tail}`,
    };
}

// Claude Chat handler — tries to open Claude extension if available
async function handleClaudeChatAction(
    params: Record<string, any>,
): Promise<ActionResult> {
    const query: string = typeof params.query === "string" ? params.query : "";
    const newSessionLocation = resolveChatSessionLocation(
        params.newSessionLocation,
    );

    // Try Anthropic Claude for VS Code extension command
    const claudeCommands = [
        "anthropic.claude.new-chat-window", // Possible Anthropic extension ID
        "claude.openInNewWindow", // Alternative command
        "continue.openChat", // Continue extension which often uses Claude
    ];

    for (const cmd of claudeCommands) {
        try {
            await vscode.commands.executeCommand(cmd, {
                query,
                location: newSessionLocation,
            });
            return {
                handled: true,
                message: `✅ Opened Claude chat${query ? " with your prompt" : ""}. If Claude extension is not installed, you can install it from the VS Code Extensions marketplace.`,
            };
        } catch {
            // Try next command
        }
    }

    // Fallback: open generic chat and mention Claude
    try {
        if (newSessionLocation === "window") {
            await vscode.commands.executeCommand(
                "workbench.action.chat.newChat",
            );
        } else if (newSessionLocation === "editor") {
            await vscode.commands.executeCommand("workbench.action.openChat");
        }
        return {
            handled: true,
            message: `⚠️ Opened a chat window, but Claude extension was not found. Install "Claude for VS Code" or "Anthropic" from the Extensions marketplace to use Claude.${query ? " Your prompt is ready to paste." : ""}`,
        };
    } catch {
        return {
            handled: true,
            message:
                "❌ Claude extension not found and fallback chat window failed. Install a Claude extension (e.g., 'Anthropic' or 'Claude for VS Code') from the VS Code Extensions marketplace.",
        };
    }
}

// ChatGPT/OpenAI handler — tries to open ChatGPT extension if available
async function handleGPTChatAction(
    params: Record<string, any>,
): Promise<ActionResult> {
    const query: string = typeof params.query === "string" ? params.query : "";
    const newSessionLocation = resolveChatSessionLocation(
        params.newSessionLocation,
    );

    // Try various GPT/OpenAI related extension commands
    const gptCommands = [
        "openai.chatgpt.new-chat-window",
        "gptChat.openInNewWindow",
        "gpt4all.openChat",
        "continue.openChat", // Continue also supports GPT models
    ];

    for (const cmd of gptCommands) {
        try {
            await vscode.commands.executeCommand(cmd, {
                query,
                location: newSessionLocation,
            });
            return {
                handled: true,
                message: `✅ Opened ChatGPT/GPT chat${query ? " with your prompt" : ""}. If GPT extension is not installed, install it from the VS Code Extensions marketplace.`,
            };
        } catch {
            // Try next command
        }
    }

    // Fallback: open generic chat
    try {
        if (newSessionLocation === "window") {
            await vscode.commands.executeCommand(
                "workbench.action.chat.newChat",
            );
        } else if (newSessionLocation === "editor") {
            await vscode.commands.executeCommand("workbench.action.openChat");
        }
        return {
            handled: true,
            message: `⚠️ Opened a chat window, but ChatGPT/GPT extension was not found. Install a ChatGPT extension (e.g., 'ChatGPT' or 'Continue') from the VS Code Extensions marketplace to use ChatGPT.${query ? " Your prompt is ready to paste." : ""}`,
        };
    } catch {
        return {
            handled: true,
            message:
                "❌ ChatGPT extension not found and fallback chat window failed. Install a ChatGPT extension from the VS Code Extensions marketplace.",
        };
    }
}

// Generic chat handler — opens the default VS Code chat in the requested location
async function handleGenericChatAction(
    params: Record<string, any>,
): Promise<ActionResult> {
    const query: string = typeof params.query === "string" ? params.query : "";
    const newSessionLocation = resolveChatSessionLocation(
        params.newSessionLocation,
    );

    try {
        await vscode.commands.executeCommand(
            getChatOpenCommand(newSessionLocation),
        );

        return {
            handled: true,
            message: `✅ Opened a new chat${query ? " with your prompt" : ""}. The available chat providers depend on your installed extensions (GitHub Copilot, Claude, ChatGPT, etc.).`,
        };
    } catch (err: unknown) {
        return {
            handled: true,
            message: `❌ Failed to open chat window: ${getErrorMessage(err)}`,
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

        case "createCodeBlock":
            actionResult = await handleCreateCodeBlockAction(action);
            break;

        case "fixCodeProblem":
            actionResult = await handleFixCodeProblemAction(action);
            break;

        case "moveCursorInFile":
            actionResult = await handleMoveCursorInFileAction(action);
            break;

        case "insertOrDeleteLines":
            actionResult = await handleUpsertLinesAction(action);
            break;

        case "launchCopilotChat":
            actionResult = await handleLaunchCopilotChatAction(action);
            break;

        default:
            actionResult.handled = false;
            actionResult.message = `❌ Unknown action: ${actionName}`;
            break;
    }

    return actionResult;
}
