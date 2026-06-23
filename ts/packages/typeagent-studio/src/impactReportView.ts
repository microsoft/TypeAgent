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
} from "./webviewKit/replayViewModel.js";
import {
    defaultGitExec,
    listVersionRefs,
    listRemoteRefs,
    resolveRef,
    resolveVersionProvenance,
} from "./gitRefProvider.js";
import { StudioServiceClient } from "./studioServiceClient.js";
import type { StudioReplayResult } from "@typeagent/core/runtime";

const VIEW_TYPE = "typeagentStudio.impactReport";

/**
 * Open (or reveal) the Impact Report webview — the first greenfield client of
 * the `studio` service channel. The webview never opens a socket: it asks the
 * extension host (here) to run a replay, and the host drives the agent's runtime
 * over the channel (`listCorpusAgents` / `replayCorpus`) and posts typed results
 * back. The channel client is owned per-panel and closed on dispose.
 */
export function openImpactReport(
    context: vscode.ExtensionContext,
    repoRoot: string | undefined,
    getTarget: () => { endpoint: string; token: string } | undefined,
): void {
    let client: StudioServiceClient | undefined;
    let connecting: Promise<StudioServiceClient | undefined> | undefined;
    // The last completed result + its request id. Re-posted whenever the webview
    // signals `ready` so a run that finished while the iframe was torn down (the
    // panel is `retainContextWhenHidden: false`, so hidden panels drop posts) is
    // recovered on reveal — the webview dedupes by request id.
    let lastResult:
        | {
              requestId: number;
              payload: StudioReplayResult;
              provenance?: RunProvenance;
          }
        | undefined;
    // Per-panel ref caches so re-opening a version picker is instant. The local
    // list is invalidated on each run (a commit or branch switch may have moved
    // HEAD); the remote-tracking list is enumerated on demand and kept for the
    // panel's lifetime (re-open the panel to refresh it).
    let localRefsCache: ResolvedVersion[] | undefined;
    let remoteRefsCache: ResolvedVersion[] | undefined;

    const panel = WebviewKitPanel.createOrReveal(context, {
        viewType: VIEW_TYPE,
        title: "Studio Impact Report",
        scriptPath: ["dist", "webview", "impactReport.js"],
        stylePath: ["media", "impactReport.css"],
        onMessage: (raw) => void handleMessage(raw),
        onDispose: () => {
            client?.close();
            client = undefined;
            connecting = undefined;
        },
    });

    const post = (message: HostToWebviewMessage) => panel.post(message);

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
            const target = getTarget();
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
            post({ type: "init", agents: [], connected: false });
            return;
        }
        let agents: string[] = [];
        try {
            agents = await c.listCorpusAgents();
        } catch {
            // Connected but listing failed; surface an empty agent list.
        }
        post({ type: "init", agents, connected: true });
        // Recover a result computed while the panel was hidden/reloaded.
        if (lastResult) {
            post({
                type: "result",
                requestId: lastResult.requestId,
                payload: lastResult.payload,
                ...(lastResult.provenance
                    ? { provenance: lastResult.provenance }
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
    const pickVersion = async (side: ReplaySide): Promise<void> => {
        const exec =
            repoRoot !== undefined ? defaultGitExec(repoRoot) : undefined;
        if (localRefsCache === undefined) {
            if (exec) {
                try {
                    localRefsCache = await listVersionRefs(exec);
                } catch {
                    localRefsCache = [WORKING_TREE_REF];
                }
            } else {
                localRefsCache = [WORKING_TREE_REF];
            }
        }

        const title = `Impact Report — ${side === "a" ? "base (A)" : "compare (B)"} version`;
        const toItems = (refs: ResolvedVersion[]): VersionItem[] =>
            refs.map((r) => ({
                label: r.label,
                description: r.tooltip,
                resolved: r,
            }));

        // Re-open loop: selecting the sentinel enumerates remotes and re-renders
        // with them appended; any other choice resolves (or Esc cancels).
        let showRemotes = remoteRefsCache !== undefined;
        for (;;) {
            const items: VersionItem[] = toItems(localRefsCache);
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
            if (choice === SHOW_REMOTES_ITEM) {
                if (remoteRefsCache === undefined && exec) {
                    try {
                        remoteRefsCache = await listRemoteRefs(exec);
                    } catch {
                        remoteRefsCache = [];
                    }
                }
                if (!remoteRefsCache || remoteRefsCache.length === 0) {
                    void vscode.window.showInformationMessage(
                        "No remote-tracking branches were found.",
                    );
                    showRemotes = false;
                    continue;
                }
                showRemotes = true;
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

    const pickAgent = async (): Promise<void> => {
        const c = await ensureClient();
        if (!c) {
            post({
                type: "error",
                message: "Not connected to the studio service.",
            });
            return;
        }
        let agents: string[] = [];
        try {
            agents = await c.listCorpusAgents();
        } catch {
            // Listing failed; nothing to pick.
        }
        if (agents.length === 0) {
            void vscode.window.showInformationMessage(
                "No corpus agents are available to replay.",
            );
            return;
        }
        const choice = await vscode.window.showQuickPick(agents, {
            title: "Impact Report — agent",
            placeHolder: "Select an agent corpus to replay",
        });
        if (!choice) {
            return;
        }
        post({ type: "agentPicked", agent: choice });
    };

    const handleMessage = async (raw: unknown): Promise<void> => {
        const msg = parseWebviewMessage(raw);
        if (!msg) {
            return;
        }
        if (msg.type === "ready" || msg.type === "reconnect") {
            if (msg.type === "reconnect") {
                client?.close();
                client = undefined;
            }
            await sendInit();
            return;
        }
        if (msg.type === "pickVersion") {
            await pickVersion(msg.side);
            return;
        }
        if (msg.type === "pickAgent") {
            await pickAgent();
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
                agent: msg.agent,
                // The launch controls choose the two versions to compare
                // (default: HEAD → working tree, the "find a regression"
                // journey). The static-grammar resolver builds each side and
                // the deterministic `needs-explanation` policy keeps the run
                // free of LLM calls.
                versionA: msg.versionA,
                versionB: msg.versionB,
                missPolicy: "needs-explanation",
            });
            post({
                type: "result",
                requestId: msg.requestId,
                payload,
                ...(provenance ? { provenance } : {}),
            });
            lastResult = {
                requestId: msg.requestId,
                payload,
                ...(provenance ? { provenance } : {}),
            };
        } catch (e) {
            post({
                type: "error",
                requestId: msg.requestId,
                message: e instanceof Error ? e.message : "Replay failed.",
            });
        }
    };
}
