// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { UserContext } from "@typeagent/dispatcher-types";

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

    if (editor.activeFilePath) {
        const lang = editor.languageId ? ` [${editor.languageId}]` : "";
        const dirty = editor.isDirty ? " (unsaved changes)" : "";
        lines.push(`Active file: ${editor.activeFilePath}${lang}${dirty}`);
    }
    if (editor.cursor) {
        lines.push(
            `Cursor: line ${editor.cursor.line + 1}, col ${editor.cursor.character + 1}`,
        );
    }
    if (editor.selection && !editor.selection.isEmpty) {
        const { start, end } = editor.selection;
        lines.push(
            `Selection: line ${start.line + 1} col ${start.character + 1} to line ${end.line + 1} col ${end.character + 1}`,
        );
        if (editor.selection.text) {
            const fence = codeFence(editor.selection.text);
            // Label the block with its source location so the model ties the
            // snippet to its file + lines and doesn't treat it as pasted text
            // of unknown origin (e.g. "where does this code live?").
            const startLine = start.line + 1;
            const endLine = end.line + 1;
            const lineRange =
                startLine === endLine
                    ? `${startLine}`
                    : `${startLine}-${endLine}`;
            const where = editor.activeFilePath
                ? `${editor.activeFilePath}:${lineRange}`
                : `lines ${lineRange}`;
            const label = editor.selection.truncated
                ? `Selected text (${where}, truncated):`
                : `Selected text (${where}):`;
            lines.push(
                label,
                `${fence}${editor.languageId ?? ""}`,
                editor.selection.text,
                fence,
            );
            if (editor.selection.truncated) {
                lines.push(
                    "[Selection truncated - only the first part is shown above; use the code agent's getSelection read action for the full selection.]",
                );
            }
        }
    }
    if (editor.diagnostics) {
        const { errors, warnings, infos, hints, items, omitted } =
            editor.diagnostics;
        if (errors || warnings || infos || hints) {
            lines.push(
                `Diagnostics in file: ${errors} error(s), ${warnings} warning(s), ${infos} info, ${hints} hint(s)`,
            );
            for (const d of items ?? []) {
                const src = d.source ? ` (${d.source})` : "";
                lines.push(
                    `  - [${d.severity}] line ${d.line + 1}: ${d.message}${src}`,
                );
            }
            if (omitted) {
                lines.push(`  - ...and ${omitted} more`);
            }
        }
    }
    if (editor.workspaceFolders?.length) {
        lines.push(`Workspace: ${editor.workspaceFolders.join(", ")}`);
    }
    if (typeof editor.openEditorCount === "number") {
        lines.push(`Open editors: ${editor.openEditorCount}`);
        for (const e of editor.openEditors ?? []) {
            const flags = [
                e.active ? "active" : undefined,
                e.dirty ? "unsaved" : undefined,
            ].filter(Boolean);
            const suffix = flags.length ? ` (${flags.join(", ")})` : "";
            lines.push(`  - ${e.path}${suffix}`);
        }
        if (editor.openEditorsOmitted) {
            lines.push(`  - ...and ${editor.openEditorsOmitted} more`);
        }
    }

    lines.push(
        "Note: the selected text above (when shown) is included, but full file contents are NOT. Call get_user_context for a fresh snapshot, or the code agent's read actions (getSelection, getActiveEditor, getFileContent, getDiagnostics) to fetch fuller contents when needed.",
    );

    return lines.join("\n");
}
