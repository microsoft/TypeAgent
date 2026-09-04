// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from "vscode";
import * as path from "path";
import { ActionResult } from "./helpers";
import {
    type DiffSection,
    parseDiffBlock,
    parseUnifiedDiff,
    splitDiffBlocks,
} from "./gitDiffUtils";

// Read/introspection action names served here. Kept in sync with the read
// actions in packages/agents/code/src/codeActionsSchema.ts.
const READ_ACTIONS = new Set([
    "getActiveEditor",
    "getSelection",
    "getDiagnostics",
    "listOpenEditors",
    "getFileContent",
    "getWorkspaceChanges",
    "getGitDiff",
]);

type ReadActionParameters = {
    fileName?: string;
    startLine?: number;
    endLine?: number;
    base?: string;
    repository?: string;
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
    // Raw unified diff text for the whole repo: `cached=true` is the staged
    // diff (index vs HEAD, i.e. `git diff --cached`), `cached=false`/omitted
    // is the unstaged diff (working tree vs index, i.e. `git diff`).
    diff(cached?: boolean): Promise<string>;
    // Raw unified diff text for a path (or "." for the whole repo, which the
    // git extension passes straight through as `git diff <ref> -- .`, byte-
    // identical to a path-less `git diff <ref>` run from the repo root)
    // between the working tree and an arbitrary ref.
    diffWith(ref: string, path: string): Promise<string>;
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
            case "getGitDiff":
                return ok(await getGitDiff(params));
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

// Acquire the built-in git extension's API, activating it if needed. Shared
// by getWorkspaceChanges and getGitDiff so both report the same error for a
// missing/inactive extension.
async function getGitApi(): Promise<GitApi | { error: string }> {
    const gitExtension =
        vscode.extensions.getExtension<GitExtensionExports>("vscode.git");
    if (!gitExtension) {
        return { error: "The built-in git extension is not available." };
    }
    const exports = gitExtension.isActive
        ? gitExtension.exports
        : await gitExtension.activate();
    return exports.getAPI(1);
}

async function getWorkspaceChanges() {
    const api = await getGitApi();
    if ("error" in api) {
        return api;
    }
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

async function getGitDiff(params: ReadActionParameters) {
    const api = await getGitApi();
    if ("error" in api) {
        return api;
    }
    if (api.repositories.length === 0) {
        return { error: "No git repositories are open in this workspace." };
    }
    const selected = selectRepository(api.repositories, params.repository);
    if ("error" in selected) {
        return selected;
    }
    const repo = selected.repository;
    const root = vscode.workspace.asRelativePath(repo.rootUri, false);
    const branch = repo.state.HEAD?.name;
    const base = params.base?.trim();

    if (!base || base === "HEAD") {
        const [unstagedText, stagedText] = await Promise.all([
            repo.diff(false),
            repo.diff(true),
        ]);
        return {
            root,
            branch,
            base: "HEAD",
            unstaged: parseContainedDiff(unstagedText, repo),
            staged: parseContainedDiff(stagedText, repo),
        };
    }

    // A single repo-rooted diff (rather than one diffWith(base, path) call
    // per changed file) avoids N serial git spawns -- which for a large
    // changeset can exceed the action's timeout -- and reuses the same
    // parseUnifiedDiff bounding/binary-detection logic as the default (no
    // base) path above instead of duplicating it.
    let diffText: string;
    try {
        diffText = await repo.diffWith(base, ".");
    } catch (err) {
        return {
            error: `Failed to diff against "${base}": ${err instanceof Error ? err.message : String(err)}`,
        };
    }
    return {
        root,
        branch,
        base,
        diff: parseContainedDiff(diffText, repo),
    };
}

// Pick the repository to diff. With a single open repository, `repository`
// is ignored (nothing to disambiguate). With multiple, match by workspace-
// relative root, root folder name, or absolute fs path; report the available
// roots on an ambiguous/unmatched selector instead of guessing.
function selectRepository(
    repositories: GitRepository[],
    repository: string | undefined,
): { repository: GitRepository } | { error: string } {
    if (repositories.length === 1) {
        return { repository: repositories[0] };
    }
    const roots = repositories.map((repo) => ({
        repo,
        relative: vscode.workspace.asRelativePath(repo.rootUri, false),
    }));
    if (!repository) {
        return {
            error: `Multiple git repositories are open; specify "repository" as one of: ${roots.map((r) => r.relative).join(", ")}.`,
        };
    }
    const needle = repository.trim();
    const match = roots.find(
        (r) =>
            r.relative === needle ||
            path.basename(r.relative) === needle ||
            r.repo.rootUri.fsPath === needle,
    );
    if (!match) {
        return {
            error: `No open git repository matches "${repository}". Available: ${roots.map((r) => r.relative).join(", ")}.`,
        };
    }
    return { repository: match.repo };
}

// True if `candidateFsPath` is `rootFsPath` itself or nested under it.
function isWithinRoot(candidateFsPath: string, rootFsPath: string): boolean {
    const rootWithSep = rootFsPath.endsWith(path.sep)
        ? rootFsPath
        : rootFsPath + path.sep;
    return (
        candidateFsPath === rootFsPath ||
        candidateFsPath.startsWith(rootWithSep)
    );
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
        if (isWithinRoot(candidate.fsPath, folder.uri.fsPath)) {
            return candidate;
        }
    }
    return undefined;
}

// The git extension's repository root can sit above the open workspace
// folder(s) -- e.g. this very monorepo's "ts/" folder is opened as a
// workspace folder while its git repository root is the parent directory --
// so a diff can otherwise return patch content for files outside every
// folder the user actually opened. getFileContent/getDiagnostics both
// refuse such paths via resolveWorkspaceFile; do the same here for
// consistency by dropping out-of-workspace files from the result (recording
// how many were dropped) rather than silently including them. A rename/copy
// also checks `oldPath`: its destination can sit inside the workspace while
// its source (and the patch's old-side content) came from outside it, which
// would otherwise leak repo-root-relative paths and content the workspace
// boundary is meant to hide.
//
// Filtering happens on the raw diff blocks *before* parseUnifiedDiff applies
// MAX_DIFF_FILES/MAX_SECTION_PATCH_BYTES, so an out-of-workspace file never
// crowds an in-workspace one out of those caps. Skipped entirely when no
// workspace folder is open (nothing to contain to, and nothing meaningfully
// "outside" without one).
function parseContainedDiff(
    diffText: string,
    repo: GitRepository,
): DiffSection {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        return parseUnifiedDiff(diffText);
    }
    const isInsideWorkspace = (relativePath: string) => {
        const absolute = vscode.Uri.joinPath(repo.rootUri, relativePath);
        return folders.some((folder) =>
            isWithinRoot(absolute.fsPath, folder.uri.fsPath),
        );
    };
    let filesOutsideWorkspace = 0;
    const containedBlocks = splitDiffBlocks(diffText).filter((block) => {
        const entry = parseDiffBlock(block);
        if (!entry) {
            // Leave blocks that fail to parse for parseUnifiedDiff to count
            // as filesUnparsed rather than silently dropping them here too.
            return true;
        }
        const inside =
            isInsideWorkspace(entry.path) &&
            (entry.oldPath === undefined || isInsideWorkspace(entry.oldPath));
        if (!inside) {
            filesOutsideWorkspace++;
        }
        return inside;
    });
    const section = parseUnifiedDiff(containedBlocks.join(""));
    if (filesOutsideWorkspace === 0) {
        return section;
    }
    return { ...section, filesOutsideWorkspace };
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
