// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from "vscode";
import type {
    DiagnosticItem,
    EditorContext,
    OpenEditorInfo,
    UserContext,
} from "@typeagent/dispatcher-types";

// Cap on how much selected text we attach. A selection is normally a line or a
// few (an import, a signature, a small block); this keeps the reasoning prompt
// lean and truncates anything larger. Full contents remain available via the
// CODA read actions.
const MAX_SELECTION_TEXT_CHARS = 500;

// Caps on the diagnostics + open-editor samples we inline. Errors are kept
// first, so the cap drops the least actionable entries. Fuller detail (all
// diagnostics, every tab) is still available via the CODA read actions.
const MAX_DIAGNOSTIC_ITEMS = 10;
const MAX_DIAGNOSTIC_MESSAGE_CHARS = 200;
const MAX_OPEN_EDITORS = 20;

/**
 * Gather a coarse snapshot of the current VS Code editor state. Carries
 * lightweight metadata (paths, ranges, counts) plus a bounded copy of the
 * active selection's text - the thing the user is directly pointing at. Full
 * file contents are still pulled on demand via the CODA read actions, so
 * nothing large is attached by default.
 *
 * Called at send time (attached to every request as
 * ProcessCommandOptions.userContext) and again, live, for the
 * `get_user_context` reasoning tool.
 */
export function gatherUserContext(): UserContext {
    const activeEditor = vscode.window.activeTextEditor;
    const workspaceFolders = vscode.workspace.workspaceFolders?.map(
        (f) => f.name,
    );

    let activeAppDescription: string | undefined;
    let editor: EditorContext | undefined;

    if (activeEditor) {
        const doc = activeEditor.document;
        const languageId = doc.languageId;
        const fileName = doc.fileName.split(/[\\/]/).pop() ?? "file";
        activeAppDescription = `${fileName} (${languageId})`;
        editor = {
            activeFilePath: vscode.workspace.asRelativePath(doc.uri, false),
            languageId,
            isDirty: doc.isDirty,
            cursor: {
                line: activeEditor.selection.active.line,
                character: activeEditor.selection.active.character,
            },
            selection: {
                isEmpty: activeEditor.selection.isEmpty,
                start: {
                    line: activeEditor.selection.start.line,
                    character: activeEditor.selection.start.character,
                },
                end: {
                    line: activeEditor.selection.end.line,
                    character: activeEditor.selection.end.character,
                },
                ...gatherSelectionText(doc, activeEditor.selection),
            },
            ...(workspaceFolders?.length ? { workspaceFolders } : {}),
            diagnostics: gatherDiagnostics(doc.uri),
            ...gatherOpenEditors(),
        };
    } else if (workspaceFolders?.length) {
        activeAppDescription = `Project: ${workspaceFolders[0]}`;
        editor = {
            workspaceFolders,
            ...gatherOpenEditors(),
        };
    }

    return {
        activeApp: "vscode",
        ...(activeAppDescription ? { activeAppDescription } : {}),
        ...(editor ? { editor } : {}),
    };
}

/**
 * Copy the selected text into the editor context, bounded to
 * MAX_SELECTION_TEXT_CHARS. Returns an empty object for an empty selection
 * (just the caret) so the `text`/`truncated` fields stay absent.
 */
function gatherSelectionText(
    doc: vscode.TextDocument,
    selection: vscode.Selection,
): { text?: string; truncated?: boolean } {
    if (selection.isEmpty) {
        return {};
    }
    const full = doc.getText(selection);
    if (full.length <= MAX_SELECTION_TEXT_CHARS) {
        return { text: full };
    }
    return { text: full.slice(0, MAX_SELECTION_TEXT_CHARS), truncated: true };
}

function clip(text: string, max: number): string {
    return text.length > max ? `${text.slice(0, max)}…` : text;
}

function severityName(
    severity: vscode.DiagnosticSeverity,
): DiagnosticItem["severity"] {
    switch (severity) {
        case vscode.DiagnosticSeverity.Error:
            return "error";
        case vscode.DiagnosticSeverity.Warning:
            return "warning";
        case vscode.DiagnosticSeverity.Information:
            return "info";
        default:
            return "hint";
    }
}

/**
 * Severity counts for the active file plus a bounded, errors-first sample of
 * the actual diagnostic messages, so the reasoning agent can act on "fix the
 * error" without a separate CODA pull. `omitted` counts anything past the cap.
 */
function gatherDiagnostics(uri: vscode.Uri): EditorContext["diagnostics"] {
    const counts = { errors: 0, warnings: 0, infos: 0, hints: 0 };
    const all = vscode.languages.getDiagnostics(uri);
    for (const d of all) {
        switch (d.severity) {
            case vscode.DiagnosticSeverity.Error:
                counts.errors++;
                break;
            case vscode.DiagnosticSeverity.Warning:
                counts.warnings++;
                break;
            case vscode.DiagnosticSeverity.Information:
                counts.infos++;
                break;
            case vscode.DiagnosticSeverity.Hint:
                counts.hints++;
                break;
        }
    }
    // Errors (severity 0) first, then by line, so the cap keeps the most
    // actionable messages.
    const items: DiagnosticItem[] = [...all]
        .sort(
            (a, b) =>
                a.severity - b.severity ||
                a.range.start.line - b.range.start.line,
        )
        .slice(0, MAX_DIAGNOSTIC_ITEMS)
        .map((d) => ({
            severity: severityName(d.severity),
            line: d.range.start.line,
            message: clip(d.message, MAX_DIAGNOSTIC_MESSAGE_CHARS),
            ...(d.source ? { source: d.source } : {}),
        }));
    const omitted = all.length - items.length;
    return {
        ...counts,
        ...(items.length ? { items } : {}),
        ...(omitted > 0 ? { omitted } : {}),
    };
}

/**
 * The open file editors (tabs backed by a text/diff document), as a bounded
 * list plus the total tab count, so the model can resolve references like "the
 * other file" without a pull. Non-file tabs (terminals, previews) are counted
 * but not listed.
 */
function gatherOpenEditors(): Pick<
    EditorContext,
    "openEditorCount" | "openEditors" | "openEditorsOmitted"
> {
    const tabs = vscode.window.tabGroups.all.flatMap((group) => group.tabs);
    const files: OpenEditorInfo[] = [];
    for (const tab of tabs) {
        const input = tab.input;
        const uri =
            input instanceof vscode.TabInputText
                ? input.uri
                : input instanceof vscode.TabInputTextDiff
                  ? input.modified
                  : undefined;
        if (uri) {
            files.push({
                path: vscode.workspace.asRelativePath(uri, false),
                active: tab.isActive,
                dirty: tab.isDirty,
            });
        }
    }
    return {
        openEditorCount: tabs.length,
        ...(files.length
            ? { openEditors: files.slice(0, MAX_OPEN_EDITORS) }
            : {}),
        ...(files.length > MAX_OPEN_EDITORS
            ? { openEditorsOmitted: files.length - MAX_OPEN_EDITORS }
            : {}),
    };
}
