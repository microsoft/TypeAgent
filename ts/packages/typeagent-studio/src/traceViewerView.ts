// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from "vscode";
import * as path from "node:path";
import { realpath } from "node:fs/promises";
import { WebviewKitPanel } from "./webviewKit/host.js";
import {
    parseTraceMessage,
    type HostToTraceMessage,
    type TraceProvenanceSummary,
    type TraceVersionSummary,
    type TraceSide,
    type TraceSourceNode,
} from "./webviewKit/traceProtocol.js";
import { loadResolutionTrace, loadTraceRun } from "./traceStore.js";
import {
    sourceTargetFor,
    type TraceSourceRange,
} from "./traceSourceResolver.js";
import { defaultGitExec } from "./gitRefProvider.js";
import type {
    ReplayRunDescriptor,
    TraceVersionPin,
} from "@typeagent/core/replay";

const VIEW_TYPE = "typeagentStudio.traceViewer";

/** URI scheme for the read-only virtual documents that show a grammar/schema
 *  file at a pinned git ref (the exact content the ref side resolved against). */
const TRACE_SOURCE_SCHEME = "typeagent-trace-src";

/** The tab title is static: one viewer follows the selected row, and the
 *  utterance it currently shows is in the panel header. */
const PANEL_TITLE = "Trace Viewer";

function toVersionSummary(pin: TraceVersionPin): TraceVersionSummary {
    return {
        label: pin.label,
        workingTree: pin.workingTree,
        ...(pin.sha !== undefined ? { sha: pin.sha } : {}),
    };
}

function toProvenance(descriptor: ReplayRunDescriptor): TraceProvenanceSummary {
    return {
        agent: descriptor.agent,
        a: toVersionSummary(descriptor.a),
        b: toVersionSummary(descriptor.b),
        runAt: descriptor.runAt,
    };
}

/** Encode a git-pinned file into a virtual-document URI the content provider can
 *  re-open: the ref content is fetched lazily via `git show <sha>:<relPath>`. */
function traceSourceUri(
    repoRoot: string,
    sha: string,
    relPath: string,
): vscode.Uri {
    const query = new URLSearchParams({ repo: repoRoot, sha, path: relPath });
    return vscode.Uri.from({
        scheme: TRACE_SOURCE_SCHEME,
        // A leading-slash path gives the tab a readable file name and lets the
        // editor pick a language mode from the extension.
        path: `/${relPath}`,
        query: query.toString(),
    });
}

/** Read-only view of a grammar/schema file at a pinned ref, so the ref side of a
 *  trace jumps to the exact bytes it resolved against rather than the (possibly
 *  drifted) working tree. A file absent at the ref reads as empty so a compare
 *  shows it as a clean addition/removal rather than an error line. */
class TraceSourceContentProvider implements vscode.TextDocumentContentProvider {
    async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
        const query = new URLSearchParams(uri.query);
        const repoRoot = query.get("repo");
        const sha = query.get("sha");
        const relPath = query.get("path");
        if (!repoRoot || !sha || !relPath) {
            return "";
        }
        try {
            const git = defaultGitExec(repoRoot);
            return await git(["show", "--end-of-options", `${sha}:${relPath}`]);
        } catch {
            // The URI is only minted after the repo is validated, so the sole
            // realistic failure here is "this path didn't exist at that ref".
            // Return empty so a one-sided file reads as an add/remove in a diff.
            return "";
        }
    }
}

/** Resolve a captured absolute source path to its git top-level and the path
 *  relative to that top-level, so `git show <sha>:<relPath>` reads it from the
 *  right tree even when the workspace root is a subdirectory of the repo. The
 *  path is canonicalized (best-effort realpath) the same way the resolver
 *  recorded refs, so symlinked temp/working dirs resolve consistently. */
async function gitRefRelPath(
    absPath: string,
): Promise<{ gitRoot: string; relPath: string } | undefined> {
    let real = absPath;
    try {
        real = await realpath(absPath);
    } catch {
        // The file may not exist in the working tree (only at the ref); the raw
        // path's directory still locates the repository.
    }
    let gitRoot: string;
    try {
        gitRoot = (
            await defaultGitExec(path.dirname(real))([
                "rev-parse",
                "--show-toplevel",
            ])
        ).trim();
    } catch {
        return undefined;
    }
    if (gitRoot.length === 0) {
        return undefined;
    }
    const relPath = path.relative(gitRoot, real).split(path.sep).join("/");
    if (relPath.startsWith("..") || path.isAbsolute(relPath)) {
        return undefined;
    }
    return { gitRoot, relPath };
}

let sourceProviderRegistered = false;

/** Register the virtual-document provider once per extension activation. */
function ensureSourceProvider(context: vscode.ExtensionContext): void {
    if (sourceProviderRegistered) {
        return;
    }
    sourceProviderRegistered = true;
    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider(
            TRACE_SOURCE_SCHEME,
            new TraceSourceContentProvider(),
        ),
    );
}

/** Open a document in `viewColumn` and, when a span is known, select and reveal
 *  it. The selection is best-effort: a document shorter than the recorded span
 *  (e.g. drifted working-tree content) still opens without throwing. */
async function revealSource(
    uri: vscode.Uri,
    range: TraceSourceRange | undefined,
    viewColumn: vscode.ViewColumn,
): Promise<void> {
    const doc = await vscode.workspace.openTextDocument(uri);
    const selection =
        range !== undefined
            ? new vscode.Range(
                  new vscode.Position(range.start.line, range.start.character),
                  new vscode.Position(range.end.line, range.end.character),
              )
            : undefined;
    await vscode.window.showTextDocument(doc, {
        viewColumn,
        preview: true,
        ...(selection !== undefined ? { selection } : {}),
    });
}

/** The editor column to open a source file or diff in: the group immediately
 *  past the Trace Viewer's own, so opened sources land in a stable side panel
 *  beside the viewer — reused across opens — rather than ever replacing the
 *  webview in its own column. Falls back to `Beside` when the viewer's column
 *  isn't currently known (e.g. while it's hidden). */
function sourceColumnBeside(panel: WebviewKitPanel): vscode.ViewColumn {
    const col = panel.panel.viewColumn;
    return col === undefined
        ? vscode.ViewColumn.Beside
        : (Math.min(col + 1, 9) as vscode.ViewColumn);
}

/** Handle to the one live Trace Viewer: bring it forward, or point it at a
 *  different row. */
interface TraceViewerHandle {
    reveal(): void;
    retarget(runId: string, utteranceId: string): void;
}

/** The single live Trace Viewer, or undefined when none is open. One viewer
 *  follows the selected row rather than opening a tab per row. */
let liveViewer: TraceViewerHandle | undefined;

/**
 * Open (or reveal) the Trace Viewer for one red row of a run, side-by-side with
 * the Impact Report it drills in from. A single viewer follows the selection:
 * opening it for another row re-targets the existing panel instead of stacking
 * up a tab per row.
 *
 * The stored trace and its run descriptor are the source of truth: the viewer
 * shows the exact resolution the row was produced from, and can diff a node's
 * source across the two versions. When the run's traces have been rotated out of
 * the durable store, the viewer shows an explicit evicted/missing state instead
 * of a blank panel.
 */
export function openTraceViewer(
    context: vscode.ExtensionContext,
    repoRoot: string | undefined,
    runId: string,
    utteranceId: string,
): void {
    if (liveViewer) {
        liveViewer.retarget(runId, utteranceId);
        liveViewer.reveal();
        return;
    }
    liveViewer = createTraceViewer(context, repoRoot, runId, utteranceId);
}

/**
 * Point an already-open Trace Viewer at a different row. A no-op when no viewer
 * is open, so switching the selected row in the report follows into an existing
 * viewer without ever opening a new one.
 */
export function focusTraceViewer(runId: string, utteranceId: string): void {
    liveViewer?.retarget(runId, utteranceId);
}

function createTraceViewer(
    context: vscode.ExtensionContext,
    repoRoot: string | undefined,
    runId: string,
    utteranceId: string,
): TraceViewerHandle {
    // The row the viewer currently shows; retargeting swaps these so the reused
    // panel re-pushes a different row's trace.
    let currentRunId = runId;
    let currentUtteranceId = utteranceId;

    let webviewReady = false;

    ensureSourceProvider(context);

    const panel = WebviewKitPanel.createOrReveal(context, {
        viewType: VIEW_TYPE,
        title: PANEL_TITLE,
        // Sit next to the originating Impact Report instead of taking its column.
        viewColumn: vscode.ViewColumn.Beside,
        scriptPath: ["dist", "webview", "traceViewer.js"],
        stylePath: ["media", "traceViewer.css"],
        // The rendered trace is re-pushed only via the reveal `ready` handshake;
        // retain context so navigating away and back keeps that state.
        retainContextWhenHidden: true,
        onMessage: (raw) => void handleMessage(raw),
        onDispose: () => {
            liveViewer = undefined;
        },
    });

    const post = (message: HostToTraceMessage) => panel.post(message);

    // Read the stored trace and push it, or explain why it can't be shown. The
    // per-row lookup answers "present"; a miss is disambiguated at the run level
    // into evicted (rotated out) vs missing (never captured).
    const pushTrace = (): void => {
        const found = loadResolutionTrace(
            context.workspaceState,
            currentRunId,
            currentUtteranceId,
        );
        if (found) {
            post({
                type: "trace",
                recorded: found.trace,
                provenance: toProvenance(found.descriptor),
            });
            return;
        }
        const run = loadTraceRun(context.workspaceState, currentRunId);
        post({
            type: "trace-state",
            state: run.status === "evicted" ? "evicted" : "missing",
        });
    };

    // Build the URI that shows one node's source at a given side's version: the
    // live working-tree file, or a read-only virtual document at the pinned git
    // ref. Returns undefined when the side has no openable version.
    const uriForSide = (
        pin: TraceVersionPin,
        gitRoot: string,
        relPath: string,
    ): vscode.Uri | undefined => {
        if (pin.workingTree) {
            return vscode.Uri.file(path.join(gitRoot, relPath));
        }
        if (pin.sha !== undefined) {
            return traceSourceUri(gitRoot, pin.sha, relPath);
        }
        return undefined;
    };

    // Jump to the source the row resolved against: the winning grammar rule's
    // span, or the produced action's schema file. The webview names only the
    // side and node; the host rederives the location from the stored trace and
    // opens it against that side's pinned version — the live working-tree file,
    // or a read-only virtual document at the pinned git ref.
    const openSource = async (
        requestId: number,
        side: TraceSide,
        node: TraceSourceNode,
    ): Promise<void> => {
        const unavailable = (message: string): void =>
            post({
                type: "source-result",
                requestId,
                status: "unavailable",
                message,
            });

        const found = loadResolutionTrace(
            context.workspaceState,
            currentRunId,
            currentUtteranceId,
        );
        if (!found) {
            unavailable("The recorded trace is no longer available.");
            return;
        }
        const target = sourceTargetFor(found.trace, side, node);
        if (!target) {
            unavailable("This step didn't record a source location.");
            return;
        }
        if (!path.isAbsolute(target.absPath)) {
            // A relative or synthetic path (e.g. built-in entity grammar) can't
            // be located on disk; the webview normally hides such links, but a
            // stale one still lands here.
            unavailable("This step's source file isn't available to open.");
            return;
        }
        const pin = side === "a" ? found.descriptor.a : found.descriptor.b;
        const column = sourceColumnBeside(panel);
        try {
            if (pin.workingTree) {
                await revealSource(
                    vscode.Uri.file(target.absPath),
                    target.range,
                    column,
                );
            } else if (pin.sha !== undefined) {
                const resolved = await gitRefRelPath(target.absPath);
                if (resolved === undefined) {
                    unavailable("The source file is outside the repository.");
                    return;
                }
                await revealSource(
                    traceSourceUri(resolved.gitRoot, pin.sha, resolved.relPath),
                    target.range,
                    column,
                );
            } else {
                unavailable("This version has no source to open.");
                return;
            }
            post({ type: "source-result", requestId, status: "opened" });
        } catch {
            unavailable("Couldn't open the source file.");
        }
    };

    // Open a native side-by-side diff of one node's source file across the A and
    // B versions. The same repo-relative path is diffed on both sides (each side
    // resolved against its own pinned version), so a grammar/schema change shows
    // as a concrete source delta rather than two separate file jumps.
    const compareSource = async (
        requestId: number,
        node: TraceSourceNode,
    ): Promise<void> => {
        const unavailable = (message: string): void =>
            post({
                type: "source-result",
                requestId,
                status: "unavailable",
                message,
            });

        const found = loadResolutionTrace(
            context.workspaceState,
            currentRunId,
            currentUtteranceId,
        );
        if (!found) {
            unavailable("The recorded trace is no longer available.");
            return;
        }
        // Either side may have recorded the span; use whichever resolves to a
        // real file to name the path to diff across both versions.
        const target =
            sourceTargetFor(found.trace, "b", node) ??
            sourceTargetFor(found.trace, "a", node);
        if (!target || !path.isAbsolute(target.absPath)) {
            unavailable("This step's source file isn't available to compare.");
            return;
        }
        const resolved = await gitRefRelPath(target.absPath);
        if (resolved === undefined) {
            unavailable("The source file is outside the repository.");
            return;
        }
        const { gitRoot, relPath } = resolved;
        const left = uriForSide(found.descriptor.a, gitRoot, relPath);
        const right = uriForSide(found.descriptor.b, gitRoot, relPath);
        if (!left || !right) {
            unavailable("One version has no source to compare.");
            return;
        }
        // When both versions pin the same working-tree file, the two sides of the
        // diff would be byte-identical — VS Code renders that as a single pane,
        // which reads as "the compare is broken". Say plainly that this file is
        // shared, so the divergence lives in another stage.
        if (left.toString() === right.toString()) {
            unavailable(
                "Both versions resolve to the same working-tree file, so there's no cross-version diff to show here.",
            );
            return;
        }
        const name = relPath.split("/").pop() ?? relPath;
        const title = `${name} — ${found.descriptor.a.label} ↔ ${found.descriptor.b.label}`;
        try {
            await vscode.commands.executeCommand(
                "vscode.diff",
                left,
                right,
                title,
                { viewColumn: sourceColumnBeside(panel), preview: true },
            );
            post({ type: "source-result", requestId, status: "opened" });
        } catch {
            unavailable("Couldn't open the source comparison.");
        }
    };

    const handleMessage = async (raw: unknown): Promise<void> => {
        const message = parseTraceMessage(raw);
        if (!message) {
            return;
        }
        switch (message.type) {
            case "ready":
                webviewReady = true;
                pushTrace();
                break;
            case "open-source":
                await openSource(message.requestId, message.side, message.node);
                break;
            case "compare-source":
                await compareSource(message.requestId, message.node);
                break;
        }
    };

    // Swap the viewer to a different row and re-push its trace. Skips redundant
    // work when the row is already showing (e.g. re-clicking the open row, or the
    // button for the shown row). The tab title is static, so only the content
    // changes.
    const retarget = (nextRunId: string, nextUtteranceId: string): void => {
        if (
            nextRunId === currentRunId &&
            nextUtteranceId === currentUtteranceId
        ) {
            return;
        }
        currentRunId = nextRunId;
        currentUtteranceId = nextUtteranceId;
        if (webviewReady) {
            pushTrace();
        }
    };

    return {
        reveal: () => panel.panel.reveal(),
        retarget,
    };
}
