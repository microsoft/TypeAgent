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

export type WorkspaceDiagnostic = {
    uri: vscode.Uri;
    diagnostic: vscode.Diagnostic;
};

/**
 * Collect all diagnostics across the workspace (all open files).
 */
export function collectWorkspaceDiagnostics(): WorkspaceDiagnostic[] {
    const diagnostics: WorkspaceDiagnostic[] = [];

    // `vscode.languages.getDiagnostics()` returns [uri, Diagnostic[]][]
    for (const [uri, diags] of vscode.languages.getDiagnostics()) {
        for (const diag of diags) {
            diagnostics.push({ uri, diagnostic: diag });
        }
    }

    return diagnostics;
}

// --- Global history store ---
export const editWorkspaceHistory: vscode.WorkspaceEdit[] = [];

// --- Global history store ---
type EditRecord = {
    uri: vscode.Uri;
    range: vscode.Range;
    originalText?: string; // optional: store original text for undo
};

export const editHistory: EditRecord[] = [];

/**
 * Push a simple edit record to history.
 */
export function pushEditHistory(
    record: { uri: vscode.Uri; range: vscode.Range; originalText?: string },
    limit: number = 50,
) {
    editHistory.push(record);

    if (editHistory.length > limit) {
        editHistory.shift();
    }
}

/**
 * Push a WorkspaceEdit to the global history stack.
 * Optional: limit the history size.
 */
export function pushWorkspaceEditHistory(
    edit: vscode.WorkspaceEdit,
    limit: number = 50,
) {
    if (!edit) return;

    editWorkspaceHistory.push(edit);

    // Enforce limit
    if (editWorkspaceHistory.length > limit) {
        editWorkspaceHistory.shift();
    }
}

/**
 * Optionally: pop the last edit to undo.
 */
export function popEditHistory(): vscode.WorkspaceEdit | undefined {
    return editHistory.pop();
}

/**
 * Pick a diagnostic (problem) from the current document based on a selector.
 */
export function pickProblem(
    diagnostics: WorkspaceDiagnostic[],
    selector: "first" | "next" | "all" = "first",
    lastIndex: number = -1,
): WorkspaceDiagnostic | WorkspaceDiagnostic[] | undefined {
    if (diagnostics.length === 0) return undefined;

    switch (selector) {
        case "first":
            return diagnostics[0];

        case "next": {
            const nextIndex = (lastIndex + 1) % diagnostics.length;
            return diagnostics[nextIndex];
        }

        case "all":
            return diagnostics;

        default:
            return undefined;
    }
}

export type ProblemTarget =
    | { type: "first" }
    | { type: "next" }
    | { type: "all" }
    | { type: "cursor"; position: CursorTarget }
    | { type: "indexInFile"; index: number; file?: FileTarget };

export function pickProblemForFile(
    editor: vscode.TextEditor,
    diagnostics: WorkspaceDiagnostic[],
    target: ProblemTarget | "first" | "next" | "all" | CursorTarget,
    activeFileUri: vscode.Uri,
    lastIndex: number = -1,
): WorkspaceDiagnostic | WorkspaceDiagnostic[] | undefined {
    if (diagnostics.length === 0) return undefined;

    // Legacy strings for backwards compatibility
    if (typeof target === "string") {
        switch (target) {
            case "first":
                return diagnostics[0];
            case "next": {
                const nextIndex = (lastIndex + 1) % diagnostics.length;
                return diagnostics[nextIndex];
            }
            case "all":
                return diagnostics;
            default:
                return undefined;
        }
    }

    // Legacy CursorTarget (not wrapped)
    if ((target as CursorTarget)?.type) {
        const pos = resolvePosition(editor, target as CursorTarget);
        return diagnostics.find(
            (d) =>
                d.uri.toString() === activeFileUri.toString() &&
                d.diagnostic.range.contains(pos),
        );
    }

    // New ProblemTarget
    switch (target.type) {
        case "first":
            return diagnostics[0];

        case "next": {
            const nextIndex = (lastIndex + 1) % diagnostics.length;
            return diagnostics[nextIndex];
        }

        case "all":
            return diagnostics;

        case "cursor": {
            const pos = resolvePosition(editor, target.position);
            return diagnostics.find(
                (d) =>
                    d.uri.toString() === activeFileUri.toString() &&
                    d.diagnostic.range.contains(pos),
            );
        }

        case "indexInFile": {
            const fileUri = target.file?.uri ?? activeFileUri; // fallback to active editor file
            const fileDiags = diagnostics.filter(
                (d) => d.uri.toString() === fileUri.toString(),
            );
            return fileDiags[target.index]; // may be undefined if out of bounds
        }

        default:
            return undefined;
    }
}

/**
 * Insert a temporary prompt comment, ask Copilot to fix, then remove the prompt.
 * Returns true if a suggestion was accepted.
 */
export async function requestCopilotFixAlt(
    editor: vscode.TextEditor,
    diagnostic: vscode.Diagnostic,
): Promise<boolean> {
    const line = diagnostic.range.start.line;
    const comment = `// Copilot: fix this ${diagnostic.severity === vscode.DiagnosticSeverity.Error ? "error" : "diagnostic"} → ${diagnostic.message}`;

    // Insert comment line above the problem
    await editor.edit((editBuilder) => {
        editBuilder.insert(new vscode.Position(line, 0), comment + "\n");
    });

    // Trigger Copilot and remove the prompt afterwards
    await triggerCopilotThenRemovePromptComment(editor, line);

    return true;
}

// Ask Copilot for a fix at the given diagnostic (optionally guided by hint)
export async function requestCopilotFix(
    editor: vscode.TextEditor,
    diagnostic: vscode.Diagnostic,
    hint?: string,
): Promise<boolean> {
    try {
        // Move cursor to diagnostic
        editor.selection = new vscode.Selection(
            diagnostic.range.start,
            diagnostic.range.end,
        );
        editor.revealRange(
            diagnostic.range,
            vscode.TextEditorRevealType.InCenter,
        );

        // Optionally insert a comment prompt for Copilot
        if (hint) {
            await editor.edit((edit) =>
                edit.insert(diagnostic.range.start, `// Fix: ${hint}\n`),
            );
        }

        // Trigger Copilot suggestion & auto-accept
        await triggerAndMaybeAcceptInlineSuggestion({ autoAccept: true });

        // If we added a prompt comment, remove it after suggestion
        if (hint) {
            const line = diagnostic.range.start.line;
            await triggerCopilotThenRemovePromptComment(editor, line);
        }

        return true;
    } catch {
        return false;
    }
}

export async function applyFixProblem(target: "first" | "next" | "all") {
    const history: vscode.WorkspaceEdit[] = [];

    // Flatten diagnostics across workspace into a single WorkspaceDiagnostic[] so pickProblem accepts it.
    const diagnosticsArr = vscode.languages
        .getDiagnostics()
        .flatMap(([uri, diags]) => diags.map((d) => ({ uri, diagnostic: d })));

    const picked = pickProblem(diagnosticsArr, target);
    if (!picked) return;

    const problems = Array.isArray(picked) ? picked : [picked];

    for (const p of problems) {
        const { uri, diagnostic: problem } = p;
        // Open the document for the diagnostic and show it in the editor
        let doc: vscode.TextDocument;
        try {
            doc = await vscode.workspace.openTextDocument(uri);
        } catch {
            continue;
        }

        const editor = await showDocumentInEditor(doc);
        if (!editor) continue;

        // Capture original text for the diagnostic range so we can detect changes
        const originalText = doc.getText(problem.range);

        // Insert prompt and let Copilot attempt a fix
        const accepted = await requestCopilotFix(editor, problem);
        if (!accepted) continue;

        // If the text in the diagnostic range changed, record the change as a WorkspaceEdit
        const newText = editor.document.getText(problem.range);
        if (newText !== originalText) {
            const edit = new vscode.WorkspaceEdit();
            edit.replace(uri, problem.range, newText);
            await vscode.workspace.applyEdit(edit);
            history.push(edit);
        }
    }

    return history;
}

export async function applyFixProblemAlt(
    problem: { uri: vscode.Uri; diagnostic: vscode.Diagnostic },
    opts: { hint?: string; file?: FileTarget },
): Promise<boolean> {
    const doc = await resolveOrFallbackToFile(opts.file ?? undefined);
    if (!doc) return false;

    const editor = await showDocumentInEditor(doc);
    if (!editor) return false;

    return requestCopilotFix(editor, problem.diagnostic, opts.hint);
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

export function getIndentUnit(doc: vscode.TextDocument): string {
    const editor = vscode.window.visibleTextEditors.find(
        (e) => e.document === doc,
    );
    const opts = editor?.options;
    if (opts && opts.insertSpaces && typeof opts.tabSize === "number") {
        return " ".repeat(Number(opts.tabSize));
    }
    return "\t";
}

export function getLineIndentation(
    doc: vscode.TextDocument,
    line: number,
): string {
    const safe = Math.max(0, Math.min(line, doc.lineCount - 1));
    const text = doc.lineAt(safe).text;
    const m = text.match(/^(\s*)/);
    return m ? m[1] : "";
}

/** First non-empty line above `line`, returns { index, text, indent } or null. */
export function getPrevNonEmptyLineInfo(
    doc: vscode.TextDocument,
    line: number,
) {
    for (let i = line - 1; i >= 0; i--) {
        const text = doc.lineAt(i).text;
        if (text.trim().length > 0) {
            return { index: i, text, indent: getLineIndentation(doc, i) };
        }
    }
    return null;
}

export function getNearestIndentAbove(
    doc: vscode.TextDocument,
    line: number,
    lookback = 8,
): string {
    for (let i = line; i >= 0 && i > line - lookback; i--) {
        const text = doc.lineAt(i).text;
        if (text.trim().length === 0) continue; // skip blank lines
        return getLineIndentation(doc, i);
    }
    return "";
}

/**
 * Get the configured indent unit for this document (respects per-file/language settings).
 * If insertSpaces === true -> N spaces; if false -> tab; if "auto" -> fallback to surrounding style.
 */
export function getConfiguredIndentUnit(
    doc: vscode.TextDocument,
    pos?: vscode.Position, // optional: if cursor is at line start
): string {
    // Prefer the actual active editor options if available
    const ed = vscode.window.visibleTextEditors.find((e) => e.document === doc);
    let insertSpaces = ed?.options.insertSpaces as boolean | string | undefined;
    let tabSize = ed?.options.tabSize as number | string | undefined;

    // VS Code config fallback
    const cfg = vscode.workspace.getConfiguration("editor", doc.uri);
    if (insertSpaces === undefined || insertSpaces === "auto") {
        insertSpaces = cfg.get<boolean | string>("insertSpaces");
    }
    if (tabSize === undefined || typeof tabSize === "string") {
        tabSize = cfg.get<number>("tabSize");
    }

    // Normalize
    const size = typeof tabSize === "number" && tabSize > 0 ? tabSize : 4;

    // If at the start of a line, let caller decide → return ""
    if (pos) {
        const currentLine = doc.lineAt(pos.line);
        const currentIndent = currentLine.text.match(/^\s*/)?.[0] ?? "";
        const atLineStart = pos.character <= currentIndent.length;
        if (atLineStart) {
            return "";
        }
    }

    if (insertSpaces === true) return " ".repeat(size);
    if (insertSpaces === false) return "\t";

    // insertSpaces === "auto" or unresolved -> return empty to signal "use local detection"
    return "";
}

/**
 * Determine indentation context at insertion:
 * - baseIndent: indentation of the line where the block should start
 * - unit: one indent level to use for inner lines
 * Strategy:
 *   1) Look at nearest non-empty line above to detect tabs vs spaces.
 *   2) If ambiguous, fall back to document-scoped config.
 */
export function getIndentContext(
    doc: vscode.TextDocument,
    insertPos: vscode.Position,
): { baseIndent: string; unit: string } {
    // What the current line looks like
    const currentLineIndent = getLineIndentation(doc, insertPos.line);

    // Try to detect from nearby content
    const nearest = getNearestIndentAbove(doc, insertPos.line);
    if (nearest.includes("\t")) {
        return { baseIndent: currentLineIndent, unit: "\t" };
    }
    if (nearest.replace(/\t/g, "").length > 0) {
        // nearest contains spaces (and no tabs)
        const cfgUnit = getConfiguredIndentUnit(doc);
        const size = cfgUnit && cfgUnit !== "\t" ? cfgUnit.length : 4;
        return { baseIndent: currentLineIndent, unit: " ".repeat(size) };
    }

    // Fall back to configuration
    const cfgUnit = getConfiguredIndentUnit(doc);
    if (cfgUnit) {
        return { baseIndent: currentLineIndent, unit: cfgUnit };
    }

    // Last resort
    return { baseIndent: currentLineIndent, unit: "    " };
}

/**
 * Compute semantic indentation at an insertion point.
 * - baseIndent: where the declaration line should start.
 * - innerIndent: one level deeper (for the first body line).
 *
 * Rules:
 * - If cursor is mid-line, don't change baseIndent (caller can prepend "\n").
 * - If cursor is at column 0 on an empty/whitespace line:
 *     • Use nearest non-empty line's indent as base
 *     • If that line ends with "{" (TS/JS) or ":" (Py), increase one level
 *     • If the current or prev line starts with "}", decrease one level (TS/JS)
 * - If we can't infer unit from content, fallback to configured unit (spaces or tab).
 */
export function getIndentContextSmart(
    doc: vscode.TextDocument,
    pos: vscode.Position,
    language: string,
): { baseIndent: string; innerIndent: string; atLineStart: boolean } {
    const currentLine = doc.lineAt(pos.line);
    const currentIndent = getLineIndentation(doc, pos.line);
    const atLineStart = pos.character <= currentIndent.length;

    let unit = getConfiguredIndentUnit(doc, pos);
    if (!unit && pos.character > 0) {
        for (let i = pos.line; i >= 0; i--) {
            const text = doc.lineAt(i).text;
            const indentMatch = text.match(/^\s+/);
            if (indentMatch) {
                const indent = indentMatch[0];
                if (indent.includes("\t")) {
                    unit = "\t"; // tabs detected
                } else {
                    // assume a run of spaces = one indent level
                    const size = Math.min(indent.length, 8);
                    unit = " ".repeat(size || 4);
                }
                break;
            }
        }
    }

    if (unit === undefined && pos.character > 0) {
        unit = "\t"; // or " ".repeat(4)
    }

    // Start from the current line's indent.
    let baseIndent = currentIndent;

    // Heuristics only if we're at line start
    if (atLineStart) {
        const prev = getPrevNonEmptyLineInfo(doc, pos.line);
        if (prev) {
            const prevTrim = prev.text.trimEnd();
            baseIndent = prev.indent;

            const isJsTs =
                language.toLowerCase().includes("typescript") ||
                language.toLowerCase().includes("javascript");
            const isPy = language.toLowerCase().includes("python");

            // Increase indent after block open
            let increaseIndent = false;
            if (
                (isJsTs && /\{\s*$/.test(prevTrim)) ||
                (isPy && /:\s*$/.test(prevTrim))
            ) {
                increaseIndent = true;
            }

            // If the current line starts with a closing brace, dedent one (TS/JS)
            const currTrim = currentLine.text.trimLeft();
            if (isJsTs && /^\}/.test(currTrim)) {
                // remove one unit from base if present
                baseIndent = baseIndent.endsWith(unit)
                    ? baseIndent.slice(0, baseIndent.length - unit.length)
                    : baseIndent;
            }

            if (increaseIndent) {
                baseIndent += unit !== "" ? unit : "\t";
            }
        } else {
            // Top of file: use whatever indent the line has (likely "")
            baseIndent = currentIndent;
        }
    }

    //const innerIndent = baseIndent + unit; // content line sits one level deeper
    const innerIndent =
        unit !== undefined && unit !== "" ? baseIndent + unit : baseIndent;
    return { baseIndent, innerIndent, atLineStart };
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
): vscode.Position {
    const doc = editor.document;
    switch (target.type) {
        case "atCursor":
            return editor.selection.active;

        case "atStartOfFile":
            return new vscode.Position(0, 0);

        case "atEndOfFile": {
            //return new vscode.Position(doc.lineCount, 0);
            const lastLine = Math.max(0, doc.lineCount - 1);
            return new vscode.Position(lastLine, Number.MAX_SAFE_INTEGER);
        }

        case "afterLine": {
            const line = Math.min(target.line + 1, doc.lineCount - 1);
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
                        const line = Math.min(endLine + 1, doc.lineCount - 1);
                        return new vscode.Position(line, 0);
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

export function generateCopilotPrompt(
    docstring: string | undefined,
    language: string,
    functionName?: string,
): string {
    if (docstring && functionName) {
        return `Create a ${language} function called ${functionName} that ${docstring}`;
    }

    return docstring?.trim() || "Add code here";
}

export function generateDocPromptLine(
    docstring: string | undefined,
    language: string,
    indent = "",
): string {
    const trimmed = (docstring ?? "Add code here").trim();
    if (language === "python") return `${indent}# ${trimmed}`;
    return `${indent}// ${trimmed}`;
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
