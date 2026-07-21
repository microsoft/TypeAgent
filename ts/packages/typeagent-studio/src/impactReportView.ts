// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from "vscode";
import { WebviewKitPanel } from "./webviewKit/host.js";
import {
    parseWebviewMessage,
    type HostToWebviewMessage,
    type ReplaySide,
} from "./webviewKit/protocol.js";
import type {
    ResolvedVersion,
    RunProvenance,
    VersionProvenance,
} from "./webviewKit/replayViewModel.js";
import {
    defaultGitExec,
    listVersionRefs,
    listRemoteRefs,
    resolveRef,
    resolveVersionProvenance,
} from "./gitRefProvider.js";
import { StudioServiceClient } from "./studioServiceClient.js";
import type { StudioConnectionState } from "./studioServiceConnection.js";
import { loadPersistedRun, savePersistedRun } from "./impactReportStore.js";
import { saveTraceRun } from "./traceStore.js";
import { openTraceViewer, focusTraceViewer } from "./traceViewerView.js";
import {
    buildReplayRunDescriptor,
    buildTraceVersionPin,
    type ReplayTraceMode,
    type TraceVersionPin,
    type VersionSpec,
} from "@typeagent/core/replay";
import type { StudioReplayResult } from "@typeagent/core/runtime";

const VIEW_TYPE = "typeagentStudio.impactReport";

/** The slice of the shared {@link StudioServiceConnection} the report needs: the
 *  service target for its dedicated replay client, plus the live connection
 *  state so the webview can show one connection indicator and auto-reconnect. */
export interface ImpactReportConnection {
    getTarget(): { endpoint: string; token: string } | undefined;
    readonly currentState: StudioConnectionState;
    onStateChanged(listener: (state: StudioConnectionState) => void): {
        dispose(): void;
    };
}

/**
 * A completed replay pushed into an already-open Impact Report from outside the
 * panel (a Replay launched from the Corpora view), so the open report refreshes
 * in place instead of only updating on the next reopen.
 */
export interface ImpactReportLiveUpdate {
    payload: StudioReplayResult;
    runAt: number;
    provenance?: RunProvenance;
    versionA: ResolvedVersion;
    versionB: ResolvedVersion;
}

/** Live refreshers for open report panels, keyed by agent. Registered while a
 *  panel is open and removed on dispose, so an external Replay can find and
 *  update the matching open report. */
const openReportRefreshers = new Map<
    string,
    (update: ImpactReportLiveUpdate) => void
>();

/**
 * Push a freshly computed replay into the open Impact Report for `agent`, if one
 * is open, so it re-renders in place. Returns true when a panel was updated.
 * A no-op (returns false) when no report is open — the caller still persists the
 * run to the durable store so the next reopen shows it.
 */
export function refreshOpenImpactReport(
    agent: string,
    update: ImpactReportLiveUpdate,
): boolean {
    const refresh = openReportRefreshers.get(agent);
    if (!refresh) {
        return false;
    }
    refresh(update);
    return true;
}

/**
 * Open (or reveal) the Impact Report webview for a single `agent` — the first
 * greenfield client of the `studio` service channel. One panel exists per agent
 * (keyed by `instanceKey`), so reports for different agents open as separate
 * tabs the user can place side-by-side. The webview never opens a socket: it
 * asks the extension host (here) to run a replay, and the host drives the
 * agent's runtime over the channel (`replayCorpus`) and posts typed results
 * back. The channel client is owned per-panel and closed on dispose.
 */
export function openImpactReport(
    context: vscode.ExtensionContext,
    repoRoot: string | undefined,
    connection: ImpactReportConnection,
    agent: string,
): void {
    let client: StudioServiceClient | undefined;
    let connecting: Promise<StudioServiceClient | undefined> | undefined;
    // Set once the webview has loaded and asked for state; until then, posts are
    // dropped (the iframe isn't listening yet) so we defer to the `ready` pull.
    let webviewReady = false;
    // Subscription to the shared connection's state, disposed with the panel.
    let stateSub: { dispose(): void } | undefined;
    // Re-posted whenever the webview signals `ready` so a run whose result
    // arrived before the webview was listening (e.g. the first load, or a full
    // extension reload) is recovered on the next `ready` — the webview dedupes by
    // request id. With the panel retaining context while hidden, navigate-away/back
    // no longer reloads it, so this mainly guards the initial-load and
    // extension-reload cases. When seeded from the durable per-agent store on
    // open, `runAt` carries the original run time so the report labels it.
    let lastResult:
        | {
              requestId: number;
              payload: StudioReplayResult;
              provenance?: RunProvenance;
              runAt?: number;
              versionA?: ResolvedVersion;
              versionB?: ResolvedVersion;
          }
        | undefined;
    // Per-panel ref caches so re-opening a version picker is instant. The local
    // list is invalidated on each run (a commit or branch switch may have moved
    // HEAD); the remote-tracking list is enumerated on demand and kept for the
    // panel's lifetime (re-open the panel to refresh it).
    let localRefsCache: ResolvedVersion[] | undefined;
    let remoteRefsCache: ResolvedVersion[] | undefined;
    // The live utterance-filter input box, tracked so it can be torn down if the
    // panel is disposed while it is still open.
    let searchInputBox: vscode.InputBox | undefined;

    const panel = WebviewKitPanel.createOrReveal(context, {
        viewType: VIEW_TYPE,
        instanceKey: agent,
        title: `Impact Report — ${agent}`,
        scriptPath: ["dist", "webview", "impactReport.js"],
        stylePath: ["media", "impactReport.css"],
        // The panel holds a live service connection and a rendered result, and
        // the agent/connection context is re-pushed only via a single reveal
        // `ready` handshake. Retain the context so navigating away and back
        // keeps that state instead of tearing the webview down and reloading.
        retainContextWhenHidden: true,
        onMessage: (raw) => void handleMessage(raw),
        onDispose: () => {
            openReportRefreshers.delete(agent);
            stateSub?.dispose();
            stateSub = undefined;
            searchInputBox?.dispose();
            searchInputBox = undefined;
            client?.close();
            client = undefined;
            connecting = undefined;
        },
    });

    const post = (message: HostToWebviewMessage) => panel.post(message);

    // The webview only needs the set of traced utterances (carried by
    // `tracedUtteranceIds`) to offer the "Open trace" affordance; the full
    // traces are large (per-red-row grammar debug info) and are persisted
    // separately for the Trace Viewer. Strip them from anything sent to the
    // webview so a big changed set doesn't inflate the host→webview message.
    const forWebview = (result: StudioReplayResult): StudioReplayResult => {
        if (result.resolutionTraces === undefined) {
            return result;
        }
        const { resolutionTraces, ...slim } = result;
        return {
            ...slim,
            tracedUtteranceIds:
                result.tracedUtteranceIds ??
                resolutionTraces.map((t) => t.utteranceId),
        };
    };

    // Let an external Replay (launched from the Corpora view) refresh this open
    // report in place: adopt its result as this panel's last result (so a later
    // reload/ready re-push shows it) and, when the webview is listening, post it
    // as an external result the client accepts regardless of its own request-id
    // sequence.
    openReportRefreshers.set(agent, (update) => {
        const slim = forWebview(update.payload);
        lastResult = {
            requestId: 0,
            payload: slim,
            runAt: update.runAt,
            versionA: update.versionA,
            versionB: update.versionB,
            ...(update.provenance ? { provenance: update.provenance } : {}),
        };
        if (webviewReady) {
            post({
                type: "result",
                requestId: 0,
                external: true,
                payload: slim,
                runAt: update.runAt,
                versionA: update.versionA,
                versionB: update.versionB,
                ...(update.provenance ? { provenance: update.provenance } : {}),
            });
        }
    });

    // Single-flight connect so concurrent ready/run don't open multiple sockets;
    // failures aren't cached (a later reconnect/run retries).
    const ensureClient = (): Promise<StudioServiceClient | undefined> => {
        if (client) {
            return Promise.resolve(client);
        }
        if (!connecting) {
            // Reach the same standalone service the shared connection uses (the
            // agent no longer serves the runtime, so there is no discovery
            // fallback); a dedicated client keeps heavy replay off the shared one.
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

    const sendInit = async (): Promise<void> => {
        post({ type: "status", text: "Connecting to the studio service…" });
        const c = await ensureClient();
        if (!c) {
            post({
                type: "init",
                agent,
                connected: false,
                available: false,
                canValidateWildcards: false,
            });
            return;
        }
        // Confirm this agent still has a corpus to replay so the webview can
        // explain an empty/unavailable state rather than failing a run blindly.
        let available = false;
        try {
            const agents = await c.listCorpusAgents();
            available = agents.includes(agent);
        } catch {
            // Connected but listing failed; treat as unavailable for now.
        }
        // Check whether wildcard validation can actually run for this agent (it
        // has a validator), so the webview can disable the toggle when there is
        // nothing to run. A lookup failure stays conservative (toggle disabled).
        let canValidateWildcards = false;
        try {
            canValidateWildcards = await c.canValidateWildcards(agent);
        } catch {
            // Leave the toggle disabled rather than offering a no-op.
        }
        post({
            type: "init",
            agent,
            connected: true,
            available,
            canValidateWildcards,
        });
        // Recover a result computed while the panel was hidden/reloaded (this
        // session), or restore the last persisted run from a previous session so
        // reopening the report shows it (clearly labelled with its timestamp).
        if (!lastResult) {
            const persisted = loadPersistedRun(context.workspaceState, agent);
            if (persisted) {
                lastResult = {
                    requestId: 0,
                    payload: persisted.payload,
                    runAt: persisted.runAt,
                    ...(persisted.provenance
                        ? { provenance: persisted.provenance }
                        : {}),
                    ...(persisted.versionA
                        ? { versionA: persisted.versionA }
                        : {}),
                    ...(persisted.versionB
                        ? { versionB: persisted.versionB }
                        : {}),
                };
            }
        }
        if (lastResult) {
            post({
                type: "result",
                requestId: lastResult.requestId,
                payload: lastResult.payload,
                ...(lastResult.runAt !== undefined
                    ? { runAt: lastResult.runAt }
                    : {}),
                ...(lastResult.provenance
                    ? { provenance: lastResult.provenance }
                    : {}),
                ...(lastResult.versionA
                    ? { versionA: lastResult.versionA }
                    : {}),
                ...(lastResult.versionB
                    ? { versionB: lastResult.versionB }
                    : {}),
            });
        }
    };

    const WORKING_TREE_REF: ResolvedVersion = {
        spec: { kind: "workingTree" },
        label: "working tree",
        tooltip: "Your uncommitted edits in the working tree.",
    };

    // Sentinel for the "show remote branches" affordance. It carries no resolved
    // version; selecting it enumerates remote-tracking refs and re-opens the pick.
    type VersionItem = vscode.QuickPickItem & { resolved?: ResolvedVersion };
    const SHOW_REMOTES_ITEM: VersionItem = {
        label: "$(cloud) Show remote branches…",
        description: "List remote-tracking branches (no fetch)",
        alwaysShow: true,
    };
    // Sentinel for free-form entry of a commit SHA or any other ref (e.g.
    // HEAD~3). Selecting it opens an InputBox validated against git on the host.
    const ENTER_REF_ITEM: VersionItem = {
        label: "$(edit) Enter a commit or ref…",
        description: "Type a commit SHA, tag, or branch",
        alwaysShow: true,
    };

    // Prompt for a free-form ref and validate it against git. Loops on an
    // unresolvable ref so a typo doesn't drop the user back to the start; an
    // empty input (Esc) cancels and returns undefined.
    const promptForRef = async (
        exec: ReturnType<typeof defaultGitExec> | undefined,
    ): Promise<ResolvedVersion | undefined> => {
        if (!exec) {
            return undefined;
        }
        let prefill = "";
        for (;;) {
            const input = await vscode.window.showInputBox({
                title: "Impact Report — enter a commit or ref",
                prompt: "Commit SHA, tag, branch, or relative ref (e.g. HEAD~3)",
                placeHolder: "e.g. a1b2c3d or v1.2 or HEAD~3",
                value: prefill,
                ignoreFocusOut: true,
            });
            if (input === undefined || input.trim().length === 0) {
                return undefined;
            }
            const resolved = await resolveRef(exec, input);
            if (resolved) {
                return resolved;
            }
            prefill = input;
            void vscode.window.showWarningMessage(
                `Git couldn't resolve "${input.trim()}" to a commit. Try again.`,
            );
        }
    };

    // The webview can't shell out to git (the security boundary), so version
    // selection runs as a native QuickPick here. Local refs are cached per panel
    // (invalidated on each run); remote-tracking refs are enumerated lazily and
    // appended only when the user asks for them. An empty selection (Esc) leaves
    // the webview's current choice untouched — no message is posted.
    const ensureLocalRefs = async (
        exec: ReturnType<typeof defaultGitExec> | undefined,
    ): Promise<ResolvedVersion[]> => {
        if (localRefsCache !== undefined) {
            return localRefsCache;
        }
        if (!exec) {
            localRefsCache = [WORKING_TREE_REF];
            return localRefsCache;
        }
        try {
            localRefsCache = await listVersionRefs(exec);
        } catch {
            localRefsCache = [WORKING_TREE_REF];
        }
        return localRefsCache;
    };

    // Enumerate remote-tracking refs on first request; returns whether any exist.
    const loadRemoteRefs = async (
        exec: ReturnType<typeof defaultGitExec>,
    ): Promise<boolean> => {
        if (remoteRefsCache === undefined) {
            try {
                remoteRefsCache = await listRemoteRefs(exec);
            } catch {
                remoteRefsCache = [];
            }
        }
        return remoteRefsCache.length > 0;
    };

    // The QuickPick item list: local refs, then the enter-ref and show-remotes
    // affordances (only with a git exec), then remotes once the user reveals them.
    const buildVersionItems = (
        refs: ResolvedVersion[],
        exec: ReturnType<typeof defaultGitExec> | undefined,
        showRemotes: boolean,
    ): VersionItem[] => {
        const toItems = (rs: ResolvedVersion[]): VersionItem[] =>
            rs.map((r) => ({
                label: r.label,
                description: r.tooltip,
                resolved: r,
            }));
        const items: VersionItem[] = toItems(refs);
        if (exec) {
            items.push(ENTER_REF_ITEM);
        }
        if (!showRemotes && exec) {
            items.push(SHOW_REMOTES_ITEM);
        }
        if (showRemotes && remoteRefsCache && remoteRefsCache.length > 0) {
            items.push({
                label: "remote branches",
                kind: vscode.QuickPickItemKind.Separator,
            });
            items.push(...toItems(remoteRefsCache));
        }
        return items;
    };

    const pickVersion = async (side: ReplaySide): Promise<void> => {
        const exec =
            repoRoot !== undefined ? defaultGitExec(repoRoot) : undefined;
        const refs = await ensureLocalRefs(exec);
        const title = `Impact Report — ${side === "a" ? "base (A)" : "compare (B)"} version`;

        // Re-open loop: selecting the sentinel enumerates remotes and re-renders
        // with them appended; any other choice resolves (or Esc cancels).
        let showRemotes = remoteRefsCache !== undefined;
        for (;;) {
            const items = buildVersionItems(refs, exec, showRemotes);
            const choice = await vscode.window.showQuickPick(items, {
                title,
                placeHolder: "Select a version to compare",
                matchOnDescription: true,
            });
            if (!choice) {
                return;
            }
            if (choice === ENTER_REF_ITEM) {
                const resolved = await promptForRef(exec);
                if (resolved) {
                    post({ type: "versionPicked", side, resolved });
                    return;
                }
                // Cancelled the input box — fall back to the version list.
                continue;
            }
            if (choice === SHOW_REMOTES_ITEM && exec) {
                if (await loadRemoteRefs(exec)) {
                    showRemotes = true;
                } else {
                    void vscode.window.showInformationMessage(
                        "No remote-tracking branches were found.",
                    );
                    showRemotes = false;
                }
                continue;
            }
            if (choice.resolved) {
                post({
                    type: "versionPicked",
                    side,
                    resolved: choice.resolved,
                });
            }
            return;
        }
    };

    const handleMessage = async (raw: unknown): Promise<void> => {
        const msg = parseWebviewMessage(raw);
        if (!msg) {
            return;
        }
        if (msg.type === "ready") {
            // The webview is now listening: report the live connection state and,
            // when connected, dial a fresh client and push init. Disconnected /
            // connecting states leave the controls off — the shared connection's
            // auto-reconnect drives the next init (no manual button).
            webviewReady = true;
            postConnection(connection.currentState);
            if (connection.currentState === "connected") {
                client?.close();
                client = undefined;
                connecting = undefined;
                await sendInit();
            }
            return;
        }
        if (msg.type === "pickVersion") {
            await pickVersion(msg.side);
            return;
        }
        if (msg.type === "openTrace") {
            // Drill into the full resolution trace behind one red row, side-by-
            // side with this report. The viewer reads the exact trace this run
            // persisted, so it always reflects what produced the row.
            openTraceViewer(context, repoRoot, msg.runId, msg.utteranceId);
            return;
        }
        if (msg.type === "focusTrace") {
            // The selected row changed: follow it into an already-open Trace
            // Viewer, but don't open one if none is showing.
            focusTraceViewer(msg.runId, msg.utteranceId);
            return;
        }
        if (msg.type === "searchUtterances") {
            // A live input box: each keystroke posts the current text back so the
            // report filters as the user types. Closing it (accept or Esc) keeps
            // whatever is currently shown — no revert, since it was applied live.
            // Only one is open at a time; opening a fresh one hides the previous.
            searchInputBox?.dispose();
            const input = vscode.window.createInputBox();
            searchInputBox = input;
            input.title = "Impact Report — filter utterances";
            input.prompt = "Show only rows whose utterance contains this text";
            input.placeholder = "Filter by utterance text";
            input.value = msg.current;
            input.onDidChangeValue((value) => {
                post({ type: "utteranceSearch", query: value });
            });
            input.onDidAccept(() => input.hide());
            input.onDidHide(() => {
                input.dispose();
                if (searchInputBox === input) {
                    searchInputBox = undefined;
                }
            });
            input.show();
            return;
        }
        // msg.type === "run"
        // A run may follow a commit or branch switch, so the cached local refs
        // could be stale — drop them so the next picker re-enumerates HEAD.
        localRefsCache = undefined;
        try {
            const c = await ensureClient();
            if (!c) {
                post({
                    type: "error",
                    requestId: msg.requestId,
                    message: "Not connected to the studio service.",
                });
                return;
            }
            // Pin each side to the concrete commit it ran against (a bare
            // HEAD/branch label goes stale when the branch moves), captured now
            // so the report stays self-describing.
            const exec =
                repoRoot !== undefined ? defaultGitExec(repoRoot) : undefined;
            let provenance: RunProvenance | undefined;
            if (exec) {
                const [a, b] = await Promise.all([
                    resolveVersionProvenance(msg.versionA, exec),
                    resolveVersionProvenance(msg.versionB, exec),
                ]);
                provenance = { a, b, runAt: Date.now() };
            }
            const payload = await c.replayCorpus({
                // The panel is scoped to a single agent; use that authoritative
                // agent rather than trusting the webview's echoed value.
                agent,
                // The launch controls choose the two versions to compare
                // (default: HEAD → working tree). The static-grammar resolver
                // builds each side and the deterministic `needs-explanation`
                // policy keeps the run free of LLM calls.
                versionA: msg.versionA,
                versionB: msg.versionB,
                // The webview's mode toggle selects which deterministic dispatch
                // path to model (grammar-only vs construction-cache-first); the
                // runtime defaults unknown/missing to the cache-free baseline.
                mode: msg.mode,
                // Opt-in wildcard validation: the runtime only acts on it when a
                // `resolveWildcardValidator` is wired and the agent's manifest
                // declares it replay-safe; otherwise it is a no-op.
                validateWildcards: msg.validateWildcards,
                missPolicy: "needs-explanation",
            });
            const completedAt = Date.now();
            const slim = forWebview(payload);
            post({
                type: "result",
                requestId: msg.requestId,
                payload: slim,
                runAt: completedAt,
                versionA: msg.resolvedA,
                versionB: msg.resolvedB,
                ...(provenance ? { provenance } : {}),
            });
            lastResult = {
                requestId: msg.requestId,
                payload: slim,
                runAt: completedAt,
                versionA: msg.resolvedA,
                versionB: msg.resolvedB,
                ...(provenance ? { provenance } : {}),
            };
            await savePersistedRun(
                context.workspaceState,
                agent,
                payload,
                completedAt,
                provenance,
                msg.resolvedA,
                msg.resolvedB,
            );
            // Persist the captured per-red-row traces + the run descriptor so the
            // Trace Viewer can reopen the exact resolution behind a row and
            // recompute a fresh one from the same pinned inputs.
            if (
                payload.resolutionTraces &&
                payload.resolutionTraces.length > 0
            ) {
                const pinFor = (
                    spec: VersionSpec,
                    prov: VersionProvenance | undefined,
                ): TraceVersionPin =>
                    buildTraceVersionPin({
                        spec,
                        label:
                            prov?.label ??
                            (spec.kind === "git" ? spec.ref : "working tree"),
                        ...(prov?.sha !== undefined ? { sha: prov.sha } : {}),
                    });
                const descriptor = buildReplayRunDescriptor({
                    runId: payload.runId,
                    agent,
                    a: pinFor(msg.versionA, provenance?.a),
                    b: pinFor(msg.versionB, provenance?.b),
                    mode: (msg.mode ?? "nfa-grammar") as ReplayTraceMode,
                    missPolicy: "needs-explanation",
                    validateWildcards: msg.validateWildcards === true,
                    corpus: {},
                    runAt: completedAt,
                });
                await saveTraceRun(
                    context.workspaceState,
                    descriptor,
                    payload.resolutionTraces,
                    vscode.workspace
                        .getConfiguration("typeagentStudio.traceViewer")
                        .get<number>("maxRetainedRuns", 8),
                );
            }
        } catch (e) {
            post({
                type: "error",
                requestId: msg.requestId,
                message: e instanceof Error ? e.message : "Replay failed.",
            });
        }
    };

    const postConnection = (state: StudioConnectionState): void => {
        post({ type: "connection", state });
    };

    // Mirror the shared connection so the webview shows a single connection
    // indicator and reconnects without a button. On each (re)connect, drop the
    // dedicated replay client so the next init/run dials a fresh socket to the
    // live service. The immediate fire on subscribe lands before the webview is
    // ready (guarded), so the `ready` pull seeds the first state.
    stateSub = connection.onStateChanged((state) => {
        if (!webviewReady) {
            return;
        }
        postConnection(state);
        if (state === "connected") {
            client?.close();
            client = undefined;
            connecting = undefined;
            void sendInit();
        }
    });
}
