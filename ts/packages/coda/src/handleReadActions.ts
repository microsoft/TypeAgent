// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from "vscode";
import * as path from "path";
import { ActionResult } from "./helpers";

// Read/introspection action names served here. Kept in sync with the read
// actions in packages/agents/code/src/codeActionsSchema.ts.
const READ_ACTIONS = new Set([
    "getActiveEditor",
    "getSelection",
    "getDiagnostics",
    "listOpenEditors",
    "getFileContent",
    "getWorkspaceChanges",
]);

type ReadActionParameters = {
    fileName?: string;
    startLine?: number;
    endLine?: number;
};

type ReadAction = {
    actionName?: string;
    fullActionName?: string;
    parameters?: ReadActionParameters;
};

type GitChange = {
    uri: vscode.Uri;
    status: number;
};

type GitRepository = {
    rootUri: vscode.Uri;
    state: {
        HEAD?: {
            name?: string;
            ahead?: number;
            behind?: number;
        };
        workingTreeChanges: GitChange[];
        indexChanges: GitChange[];
    };
};

type GitApi = {
    repositories: GitRepository[];
};

type GitExtensionExports = {
    getAPI(version: number): GitApi;
};

/**
 * Handle the code agent's read/introspection actions. Each returns the current
 * VS Code editor state as JSON in the ActionResult message (which the code
 * agent relays back and the reasoning agent captures). Returns handled:false
 * for any other action so the parallel-dispatch in handleVSCodeActions moves on.
 */
export async function handleReadActions(
    action: ReadAction,
): Promise<ActionResult> {
    const actionName: string | undefined =
        action.actionName ?? action.fullActionName?.split(".").at(-1);
    if (!actionName || !READ_ACTIONS.has(actionName)) {
        return { handled: false, message: "" };
    }
    const params = action.parameters ?? {};
    try {
        switch (actionName) {
            case "getActiveEditor":
                return ok(getActiveEditor());
            case "getSelection":
                return ok(getSelection());
            case "getDiagnostics":
                return ok(getDiagnostics(params.fileName));
            case "listOpenEditors":
                return ok(listOpenEditors());
            case "getFileContent":
                return ok(await getFileContent(params));
            case "getWorkspaceChanges":
                return ok(await getWorkspaceChanges());
            default:
                return { handled: false, message: "" };
        }
    } catch (err) {
        return ok({
            error: err instanceof Error ? err.message : String(err),
        });
    }
}

function ok(data: unknown): ActionResult {
    return { handled: true, message: JSON.stringify(data, null, 2) };
}

function positionOf(p: vscode.Position) {
    return { line: p.line, character: p.character };
}

function severityName(s: vscode.DiagnosticSeverity): string {
    switch (s) {
        case vscode.DiagnosticSeverity.Error:
            return "error";
        case vscode.DiagnosticSeverity.Warning:
            return "warning";
        case vscode.DiagnosticSeverity.Information:
            return "info";
        case vscode.DiagnosticSeverity.Hint:
            return "hint";
        default:
            return "unknown";
    }
}

function countDiagnostics(uri: vscode.Uri) {
    const counts = { errors: 0, warnings: 0, infos: 0, hints: 0 };
    for (const d of vscode.languages.getDiagnostics(uri)) {
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
    return counts;
}

function getActiveEditor() {
    const editor = vscode.window.activeTextEditor;
    const workspaceFolders = vscode.workspace.workspaceFolders?.map(
        (f) => f.name,
    );
    const openEditorCount = vscode.window.tabGroups.all.reduce(
        (sum, g) => sum + g.tabs.length,
        0,
    );
    if (!editor) {
        return { activeEditor: null, workspaceFolders, openEditorCount };
    }
    const doc = editor.document;
    const visible = editor.visibleRanges[0];
    return {
        activeFilePath: vscode.workspace.asRelativePath(doc.uri, false),
        languageId: doc.languageId,
        isUntitled: doc.isUntitled,
        isDirty: doc.isDirty,
        lineCount: doc.lineCount,
        cursor: positionOf(editor.selection.active),
        selection: {
            isEmpty: editor.selection.isEmpty,
            start: positionOf(editor.selection.start),
            end: positionOf(editor.selection.end),
        },
        visibleRange: visible
            ? { startLine: visible.start.line, endLine: visible.end.line }
            : undefined,
        workspaceFolders,
        diagnostics: countDiagnostics(doc.uri),
        openEditorCount,
    };
}

function getSelection() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        return { selection: null, reason: "No active editor" };
    }
    const sel = editor.selection;
    return {
        filePath: vscode.workspace.asRelativePath(editor.document.uri, false),
        isEmpty: sel.isEmpty,
        start: positionOf(sel.start),
        end: positionOf(sel.end),
        text: editor.document.getText(sel),
    };
}

function getDiagnostics(fileName?: string) {
    let uri: vscode.Uri | undefined;
    if (typeof fileName === "string" && fileName.trim().length > 0) {
        uri = resolveWorkspaceFile(fileName);
        if (!uri) {
            return {
                error: `File path is not inside an open workspace folder: ${fileName}`,
            };
        }
    } else {
        uri = vscode.window.activeTextEditor?.document.uri;
    }
    if (!uri) {
        return { diagnostics: [], reason: "No active editor" };
    }
    const diagnostics = vscode.languages.getDiagnostics(uri).map((d) => ({
        severity: severityName(d.severity),
        message: d.message,
        source: d.source,
        code:
            d.code && typeof d.code === "object"
                ? String((d.code as { value: string | number }).value)
                : d.code,
        start: positionOf(d.range.start),
        end: positionOf(d.range.end),
    }));
    return {
        filePath: vscode.workspace.asRelativePath(uri, false),
        diagnostics,
    };
}

function listOpenEditors() {
    const editors = vscode.window.tabGroups.all.flatMap((group, groupIndex) =>
        group.tabs.map((tab) => {
            const input = tab.input;
            const uri =
                input instanceof vscode.TabInputText
                    ? input.uri
                    : input instanceof vscode.TabInputTextDiff
                      ? input.modified
                      : undefined;
            return {
                group: groupIndex,
                label: tab.label,
                active: tab.isActive,
                dirty: tab.isDirty,
                path: uri
                    ? vscode.workspace.asRelativePath(uri, false)
                    : undefined,
            };
        }),
    );
    return { openEditors: editors };
}

async function getFileContent(params: {
    fileName?: string;
    startLine?: number;
    endLine?: number;
}) {
    const fileName = params.fileName;
    if (typeof fileName !== "string" || fileName.trim().length === 0) {
        return { error: "getFileContent requires a fileName." };
    }
    const uri = resolveWorkspaceFile(fileName);
    if (!uri) {
        return {
            error: `File path is not inside an open workspace folder: ${fileName}`,
        };
    }
    const doc = await vscode.workspace.openTextDocument(uri);
    let content: string;
    if (typeof params.startLine === "number") {
        const startLine = Math.max(0, params.startLine);
        const endLine = Math.min(
            doc.lineCount - 1,
            typeof params.endLine === "number" ? params.endLine : startLine,
        );
        content = doc.getText(
            new vscode.Range(
                new vscode.Position(startLine, 0),
                new vscode.Position(endLine, Number.MAX_SAFE_INTEGER),
            ),
        );
    } else {
        content = doc.getText();
    }
    return {
        filePath: vscode.workspace.asRelativePath(uri, false),
        languageId: doc.languageId,
        lineCount: doc.lineCount,
        content,
    };
}

async function getWorkspaceChanges() {
    const gitExtension =
        vscode.extensions.getExtension<GitExtensionExports>("vscode.git");
    if (!gitExtension) {
        return { error: "The built-in git extension is not available." };
    }
    const exports = gitExtension.isActive
        ? gitExtension.exports
        : await gitExtension.activate();
    const api = exports.getAPI(1);
    const repositories = api.repositories.map((repo) => ({
        root: vscode.workspace.asRelativePath(repo.rootUri, false),
        branch: repo.state.HEAD?.name,
        ahead: repo.state.HEAD?.ahead,
        behind: repo.state.HEAD?.behind,
        workingTreeChanges: repo.state.workingTreeChanges.map((c) => ({
            path: vscode.workspace.asRelativePath(c.uri, false),
            status: gitStatusName(c.status),
        })),
        indexChanges: repo.state.indexChanges.map((c) => ({
            path: vscode.workspace.asRelativePath(c.uri, false),
            status: gitStatusName(c.status),
        })),
    }));
    return { repositories };
}

// Resolve a workspace-relative path or bare file name to a Uri inside an open
// workspace folder. Rejects paths that escape the workspace root via `..` or
// absolute components (matching the containment check used when creating files).
function resolveWorkspaceFile(fileName: string): vscode.Uri | undefined {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        return undefined;
    }
    const trimmed = fileName.trim();
    for (const folder of folders) {
        const candidate = vscode.Uri.joinPath(folder.uri, trimmed);
        const root = folder.uri.fsPath;
        const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
        const target = candidate.fsPath;
        if (target === root || target.startsWith(rootWithSep)) {
            return candidate;
        }
    }
    return undefined;
}

// Map the VS Code git API Status enum (numeric) to a readable name.
function gitStatusName(status: number): string {
    const names: Record<number, string> = {
        0: "index_modified",
        1: "index_added",
        2: "index_deleted",
        3: "index_renamed",
        4: "index_copied",
        5: "modified",
        6: "deleted",
        7: "untracked",
        8: "ignored",
        9: "intent_to_add",
    };
    return names[status] ?? `status_${status}`;
}
