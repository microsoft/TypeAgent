// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from "vscode";
import * as path from "node:path";
import { WebviewKitPanel } from "./webviewKit/host.js";
import {
    parseTraceMessage,
    type HostToTraceMessage,
    type TraceProvenanceSummary,
    type TraceVersionSummary,
    type TraceSide,
    type TraceSourceNode,
} from "./webviewKit/traceProtocol.js";
import type { ImpactReportConnection } from "./impactReportView.js";
import { StudioServiceClient } from "./studioServiceClient.js";
import type { StudioConnectionState } from "./studioServiceConnection.js";
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

/** The panel title truncates the utterance to keep the tab readable. */
const TITLE_UTTERANCE_MAX = 40;

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

function panelTitle(utterance: string): string {
    const trimmed = utterance.trim();
    const clipped =
        trimmed.length > TITLE_UTTERANCE_MAX
            ? `${trimmed.slice(0, TITLE_UTTERANCE_MAX - 1)}…`
            : trimmed;
    return `Trace — ${clipped}`;
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
 *  drifted) working tree. */
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
            return await git(["show", `${sha}:${relPath}`]);
        } catch {
            return `// Unable to read ${relPath} at ${sha}.`;
        }
    }
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

/** Open a document beside the viewer and, when a span is known, select and
 *  reveal it. The selection is best-effort: a document shorter than the recorded
 *  span (e.g. drifted working-tree content) still opens without throwing. */
async function revealSource(
    uri: vscode.Uri,
    range: TraceSourceRange | undefined,
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
        viewColumn: vscode.ViewColumn.Beside,
        preview: true,
        ...(selection !== undefined ? { selection } : {}),
    });
}

/**
 * Open (or reveal) the Trace Viewer for one red row of a run, side-by-side with
 * the Impact Report it drills in from. The panel is keyed by
 * `${runId}::${utteranceId}` so each row opens its own tab, and it sits beside
 * the report rather than stealing its column.
 *
 * The stored trace and its run descriptor are the source of truth: the viewer
 * shows the exact resolution the row was produced from, and a "Replay" recompute
 * runs the same pinned inputs through the live service to reveal working-tree
 * drift. When the run's traces have been rotated out of the durable store, the
 * viewer shows an explicit evicted/missing state instead of a blank panel.
 */
export function openTraceViewer(
    context: vscode.ExtensionContext,
    repoRoot: string | undefined,
    connection: ImpactReportConnection,
    runId: string,
    utteranceId: string,
): void {
    let client: StudioServiceClient | undefined;
    let connecting: Promise<StudioServiceClient | undefined> | undefined;
    let webviewReady = false;
    let stateSub: { dispose(): void } | undefined;

    ensureSourceProvider(context);

    // Seed the title from the stored trace when it's still present; a lookup
    // miss (evicted/missing) still opens the panel, which then explains itself.
    const seeded = loadResolutionTrace(
        context.workspaceState,
        runId,
        utteranceId,
    );
    const title = seeded ? panelTitle(seeded.trace.utterance) : "Trace";

    const panel = WebviewKitPanel.createOrReveal(context, {
        viewType: VIEW_TYPE,
        instanceKey: `${runId}::${utteranceId}`,
        title,
        // Sit next to the originating Impact Report instead of taking its column.
        viewColumn: vscode.ViewColumn.Beside,
        scriptPath: ["dist", "webview", "traceViewer.js"],
        stylePath: ["media", "traceViewer.css"],
        // The panel holds a live service connection (for Replay) and a rendered
        // trace re-pushed only via the reveal `ready` handshake; retain context
        // so navigating away and back keeps that state.
        retainContextWhenHidden: true,
        onMessage: (raw) => void handleMessage(raw),
        onDispose: () => {
            stateSub?.dispose();
            stateSub = undefined;
            client?.close();
            client = undefined;
            connecting = undefined;
        },
    });

    const post = (message: HostToTraceMessage) => panel.post(message);

    // Single-flight connect so a concurrent ready/replay doesn't open multiple
    // sockets; failures aren't cached (a later reconnect/replay retries).
    const ensureClient = (): Promise<StudioServiceClient | undefined> => {
        if (client) {
            return Promise.resolve(client);
        }
        if (!connecting) {
            const target = connection.getTarget();
            connecting = StudioServiceClient.connect({
                ...(repoRoot !== undefined ? { repoRoot } : {}),
                ...(target !== undefined
                    ? { endpoint: target.endpoint, token: target.token }
                    : {}),
            })
                .then((c) => {
                    client = c;
                    return c;
                })
                .finally(() => {
                    connecting = undefined;
                });
        }
        return connecting;
    };

    // Read the stored trace and push it, or explain why it can't be shown. The
    // per-row lookup answers "present"; a miss is disambiguated at the run level
    // into evicted (rotated out) vs missing (never captured).
    const pushTrace = (): void => {
        const found = loadResolutionTrace(
            context.workspaceState,
            runId,
            utteranceId,
        );
        if (found) {
            post({
                type: "trace",
                recorded: found.trace,
                provenance: toProvenance(found.descriptor),
            });
            return;
        }
        const run = loadTraceRun(context.workspaceState, runId);
        post({
            type: "trace-state",
            state: run.status === "evicted" ? "evicted" : "missing",
        });
    };

    // Recompute a fresh trace for this row from the run's pinned inputs, so the
    // viewer can contrast the recorded resolution with what the same versions
    // produce now (revealing working-tree drift). Needs the descriptor, which
    // rides with the stored trace; if that's gone, report unavailable.
    const runReplay = async (requestId: number): Promise<void> => {
        const found = loadResolutionTrace(
            context.workspaceState,
            runId,
            utteranceId,
        );
        if (!found) {
            post({
                type: "replay-result",
                requestId,
                status: "unavailable",
                message: "The recorded run is no longer available to replay.",
            });
            return;
        }
        const c = await ensureClient();
        if (!c) {
            post({
                type: "replay-result",
                requestId,
                status: "unavailable",
                message: "Couldn't reach the studio service.",
            });
            return;
        }
        try {
            const result = await c.replayResolutionTrace({
                descriptor: found.descriptor,
                utteranceId,
            });
            if (result.status === "recomputed") {
                post({
                    type: "replay-result",
                    requestId,
                    status: "recomputed",
                    fresh: result.trace,
                });
            } else {
                post({
                    type: "replay-result",
                    requestId,
                    status: result.status,
                });
            }
        } catch {
            post({
                type: "replay-result",
                requestId,
                status: "unavailable",
                message: "Replay failed. The recorded trace is still shown.",
            });
        }
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
            runId,
            utteranceId,
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
        const pin = side === "a" ? found.descriptor.a : found.descriptor.b;
        try {
            if (pin.workingTree) {
                await revealSource(
                    vscode.Uri.file(target.absPath),
                    target.range,
                );
            } else if (pin.sha !== undefined) {
                if (repoRoot === undefined) {
                    unavailable("The workspace root is unknown.");
                    return;
                }
                const relPath = path
                    .relative(repoRoot, target.absPath)
                    .split(path.sep)
                    .join("/");
                if (relPath.startsWith("..") || path.isAbsolute(relPath)) {
                    unavailable("The source file is outside the workspace.");
                    return;
                }
                await revealSource(
                    traceSourceUri(repoRoot, pin.sha, relPath),
                    target.range,
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

    const handleMessage = async (raw: unknown): Promise<void> => {
        const message = parseTraceMessage(raw);
        if (!message) {
            return;
        }
        switch (message.type) {
            case "ready":
                webviewReady = true;
                post({
                    type: "connection",
                    state: connection.currentState,
                });
                pushTrace();
                break;
            case "replay":
                await runReplay(message.requestId);
                break;
            case "open-source":
                await openSource(message.requestId, message.side, message.node);
                break;
        }
    };

    // Mirror the shared connection so the viewer shows one indicator and the
    // next replay dials a fresh socket after a reconnect. The immediate fire on
    // subscribe can land before the webview is ready (guarded); the `ready` pull
    // seeds the first state.
    stateSub = connection.onStateChanged((state: StudioConnectionState) => {
        if (!webviewReady) {
            return;
        }
        post({ type: "connection", state });
        if (state === "connected") {
            client?.close();
            client = undefined;
            connecting = undefined;
        }
    });
}
