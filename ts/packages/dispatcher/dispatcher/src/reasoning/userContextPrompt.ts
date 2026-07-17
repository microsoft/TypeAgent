// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { UserContext } from "@typeagent/dispatcher-types";

type EditorContext = NonNullable<UserContext["editor"]>;

/**
 * Pick a backtick fence longer than any backtick run in `text`, so a selection
 * that itself contains a ``` line can't prematurely close the block.
 */
function codeFence(text: string): string {
    const longestRun = (text.match(/`+/g) ?? []).reduce(
        (max, run) => Math.max(max, run.length),
        0,
    );
    return "`".repeat(Math.max(3, longestRun + 1));
}

function toEditorLine(line: number): number {
    return line + 1;
}

function toEditorColumn(column: number): number {
    return column + 1;
}

function selectionLineRange(startLine: number, endLine: number): string {
    return startLine === endLine ? `${startLine}` : `${startLine}-${endLine}`;
}

function selectionWhere(
    editor: EditorContext,
    startLine: number,
    endLine: number,
): string {
    const lineRange = selectionLineRange(startLine, endLine);
    return editor.activeFilePath
        ? `${editor.activeFilePath}:${lineRange}`
        : `lines ${lineRange}`;
}

function appendActiveFile(lines: string[], editor: EditorContext): void {
    if (!editor.activeFilePath) {
        return;
    }
    const lang = editor.languageId ? ` [${editor.languageId}]` : "";
    const dirty = editor.isDirty ? " (unsaved changes)" : "";
    lines.push(`Active file: ${editor.activeFilePath}${lang}${dirty}`);
}

function appendCursor(lines: string[], editor: EditorContext): void {
    if (!editor.cursor) {
        return;
    }
    lines.push(
        `Cursor: line ${toEditorLine(editor.cursor.line)}, col ${toEditorColumn(editor.cursor.character)}`,
    );
}

function appendSelectionText(lines: string[], editor: EditorContext): void {
    const selection = editor.selection;
    if (!selection?.text) {
        return;
    }

    const fence = codeFence(selection.text);
    const startLine = toEditorLine(selection.start.line);
    const endLine = toEditorLine(selection.end.line);
    const where = selectionWhere(editor, startLine, endLine);
    const truncated = selection.truncated ? ", truncated" : "";
    lines.push(
        `Selected text (${where}${truncated}):`,
        `${fence}${editor.languageId ?? ""}`,
        selection.text,
        fence,
    );

    if (selection.truncated) {
        lines.push(
            "[Selection truncated - only the first part is shown above; use the code agent's getSelection read action for the full selection.]",
        );
    }
}

function appendSelection(lines: string[], editor: EditorContext): void {
    const selection = editor.selection;
    if (!selection || selection.isEmpty) {
        return;
    }

    lines.push(
        `Selection: line ${toEditorLine(selection.start.line)} col ${toEditorColumn(selection.start.character)} to line ${toEditorLine(selection.end.line)} col ${toEditorColumn(selection.end.character)}`,
    );
    appendSelectionText(lines, editor);
}

function appendDiagnostics(lines: string[], editor: EditorContext): void {
    const diagnostics = editor.diagnostics;
    if (!diagnostics) {
        return;
    }

    const { errors, warnings, infos, hints, items, omitted } = diagnostics;
    if (!errors && !warnings && !infos && !hints) {
        return;
    }

    lines.push(
        `Diagnostics in file: ${errors} error(s), ${warnings} warning(s), ${infos} info, ${hints} hint(s)`,
    );
    for (const d of items ?? []) {
        const src = d.source ? ` (${d.source})` : "";
        lines.push(
            `  - [${d.severity}] line ${toEditorLine(d.line)}: ${d.message}${src}`,
        );
    }
    if (omitted) {
        lines.push(`  - ...and ${omitted} more`);
    }
}

function appendWorkspace(lines: string[], editor: EditorContext): void {
    if (!editor.workspaceFolders?.length) {
        return;
    }
    lines.push(`Workspace: ${editor.workspaceFolders.join(", ")}`);
}

function appendOpenEditors(lines: string[], editor: EditorContext): void {
    if (typeof editor.openEditorCount !== "number") {
        return;
    }

    lines.push(`Open editors: ${editor.openEditorCount}`);
    for (const openEditor of editor.openEditors ?? []) {
        const flags = [
            openEditor.active ? "active" : undefined,
            openEditor.dirty ? "unsaved" : undefined,
        ].filter(Boolean);
        const suffix = flags.length ? ` (${flags.join(", ")})` : "";
        lines.push(`  - ${openEditor.path}${suffix}`);
    }
    if (editor.openEditorsOmitted) {
        lines.push(`  - ...and ${editor.openEditorsOmitted} more`);
    }
}

/**
 * Render the coarse editor context into an "[Editor context]" prompt block for
 * the reasoning engines. Emits nothing unless structured editor detail is
 * present (the bare activeApp name alone isn't useful to the model). Includes
 * the active selection's text (bounded by the host) when present, but not full
 * file contents - it points the model at the code agent's read actions to fetch
 * fuller contents on demand. Line/column numbers are converted from the host's
 * 0-based indexing to 1-based for readability.
 */
export function formatUserContextForPrompt(
    userContext: UserContext | undefined,
): string {
    const editor = userContext?.editor;
    if (!editor) {
        return "";
    }

    const lines: string[] = ["[Editor context]"];
    appendActiveFile(lines, editor);
    appendCursor(lines, editor);
    appendSelection(lines, editor);
    appendDiagnostics(lines, editor);
    appendWorkspace(lines, editor);
    appendOpenEditors(lines, editor);

    lines.push(
        "Note: the selected text above (when shown) is included, but full file contents are NOT. Call get_user_context for a fresh snapshot, or the code agent's read actions (getSelection, getActiveEditor, getFileContent, getDiagnostics) to fetch fuller contents when needed.",
    );

    return lines.join("\n");
}
