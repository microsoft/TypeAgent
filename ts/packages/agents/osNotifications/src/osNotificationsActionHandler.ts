// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    AppAgent,
    AppAgentEvent,
    DisplayContent,
    SessionContext,
} from "@typeagent/agent-sdk";
import registerDebug from "debug";
import {
    OsNotificationsConfig,
    defaultOsNotificationsConfig,
} from "./osNotificationsConfig.js";
import {
    OsNotificationAdded,
    OsNotificationEvent,
    OsNotificationWatcher,
} from "./watcherProtocol.js";
import { startWatcher } from "./watchers/index.js";

const debug = registerDebug("typeagent:osNotifications");

// Notifications older than this when the agent first sees them are dropped.
// The watcher may emit events for currently-present notifications at startup
// on some platforms; the user asked for "new only", so we anchor on the
// agent-enable timestamp. Slightly fuzzy to tolerate clock skew.
const NEW_ONLY_GRACE_MS = 2_000;

type AgentContext = {
    config: OsNotificationsConfig;
    watcher: OsNotificationWatcher | undefined;
    enabledAt: number;
    // Tracks ids we've forwarded so we only emit dismiss events for
    // notifications the renderer actually has bubbles for.
    activeIds: Set<string>;
    // Sliding window of recent forward timestamps (ms) for rate limiting.
    recentEmits: number[];
    // Latch so we only surface a watcher error to the user once per session.
    errorReported: boolean;
};

export function instantiate(): AppAgent {
    return {
        // Sets up empty agent context. Returns synchronously — no I/O here.
        // Watcher startup is deferred to startBackgroundTasks so the dispatcher
        // can fully populate the SessionContext (in particular, sessionContext
        // is what the watcher callback uses to emit notify events) before
        // any platform code runs.
        async initializeAgentContext(): Promise<AgentContext> {
            return {
                config: { ...defaultOsNotificationsConfig },
                watcher: undefined,
                enabledAt: 0,
                activeIds: new Set(),
                recentEmits: [],
                errorReported: false,
            };
        },

        // Spins up the per-OS watcher. Called by appAgentManager once per
        // session, immediately after initializeAgentContext succeeds. This
        // is the right hook for our use case because the agent has no schema
        // and no actions, so updateAgentContext(true,...) is never called —
        // see appAgentManager.setState(). startBackgroundTasks fires from
        // ensureSessionContext, which the commands enable path triggers via
        // setState when the user runs @config agent enable osNotifications.
        async startBackgroundTasks(
            context: SessionContext<AgentContext>,
        ): Promise<void> {
            const ctx = context.agentContext;
            if (ctx.watcher !== undefined) return; // already running
            ctx.enabledAt = Date.now();
            ctx.errorReported = false;
            ctx.activeIds.clear();
            ctx.recentEmits.length = 0;

            debug("starting watcher on platform=%s", process.platform);
            ctx.watcher = await startWatcher(process.platform, (evt) =>
                onWatcherEvent(evt, context),
            );
        },

        // Stops the watcher before sessionContext teardown. appAgentManager
        // calls this first during closeSessionContext, ahead of any
        // updateAgentContext(false,...) calls and closeAgentContext, so we
        // can guarantee no notify() racing with disposal.
        async stopBackgroundTasks(
            context: SessionContext<AgentContext>,
        ): Promise<void> {
            const ctx = context.agentContext;
            debug("stopping watcher");
            const w = ctx.watcher;
            ctx.watcher = undefined;
            ctx.activeIds.clear();
            if (w) await w.stop();
        },

        // Agent has no actions — it's emit-only.
        async executeAction(): Promise<undefined> {
            throw new Error(
                "osNotifications has no actions; this agent only forwards OS-level notifications.",
            );
        },
    };
}

function onWatcherEvent(
    evt: OsNotificationEvent,
    context: SessionContext<AgentContext>,
): void {
    const ctx = context.agentContext;
    if (evt.kind === "error") {
        if (!ctx.errorReported) {
            ctx.errorReported = true;
            context.notify(
                AppAgentEvent.Warning,
                `OS notifications: ${evt.message}`,
            );
        }
        return;
    }

    if (evt.kind === "removed") {
        if (!ctx.activeIds.has(evt.id)) return;
        ctx.activeIds.delete(evt.id);
        // Special "osDismiss" event the shell renderer listens for. The
        // SessionContext.notify type restricts event to AppAgentEvent, but
        // the underlying ClientIO.notify accepts arbitrary event strings —
        // this agent is the producer, the renderer is the consumer, and
        // both agree on the "osDismiss" contract. We send the same prefixed
        // id used as the notificationId on the original "added" emit so the
        // renderer can locate the chat bubble without having to know our
        // prefixing convention.
        const dismissKey = `os:${evt.id}`;
        type LooseNotify = (
            event: string,
            message: any,
            notificationId?: string,
        ) => void;
        (context.notify as LooseNotify)("osDismiss", { id: dismissKey });
        return;
    }

    // kind === "added"
    if (evt.timestamp + NEW_ONLY_GRACE_MS < ctx.enabledAt) {
        debug("dropping pre-enable notification id=%s", evt.id);
        return;
    }
    if (!passesAppFilters(evt.app, ctx.config)) {
        debug("dropping by app filter id=%s app=%s", evt.id, evt.app);
        return;
    }
    if (!withinRateLimit(ctx)) {
        debug("dropping by rate limit id=%s", evt.id);
        return;
    }

    const display = formatForDisplay(evt, ctx.config);
    const event = mapModeToEvent(ctx.config.mode);

    // notificationId is the dismiss key. Pass as a string (broadcast
    // routing) — currentOnly is a v1 TODO; falls back to broadcast.
    const dismissKey = `os:${evt.id}`;
    context.notify(event, display, dismissKey);
    ctx.activeIds.add(evt.id);
}

function passesAppFilters(app: string, cfg: OsNotificationsConfig): boolean {
    const norm = app.trim().toLowerCase();
    if (cfg.allowList && cfg.allowList.length > 0) {
        return cfg.allowList.some((a) => a.trim().toLowerCase() === norm);
    }
    if (cfg.blockList && cfg.blockList.length > 0) {
        if (cfg.blockList.some((a) => a.trim().toLowerCase() === norm)) {
            return false;
        }
    }
    return true;
}

function withinRateLimit(ctx: AgentContext): boolean {
    const now = Date.now();
    const cutoff = now - 60_000;
    // Drop expired entries from the sliding window.
    while (ctx.recentEmits.length > 0 && ctx.recentEmits[0] < cutoff) {
        ctx.recentEmits.shift();
    }
    if (ctx.recentEmits.length >= ctx.config.maxPerMinute) return false;
    ctx.recentEmits.push(now);
    return true;
}

function formatForDisplay(
    evt: OsNotificationAdded,
    cfg: OsNotificationsConfig,
): DisplayContent {
    const title = evt.title.trim();
    let body = cfg.redactBody ? "" : evt.body.trim();
    if (body.length > cfg.bodyMaxChars) {
        body = body.slice(0, cfg.bodyMaxChars - 1) + "…";
    }

    const appLabel = evt.app.trim();
    // Plain text content. Renderers that support inline rendering will
    // wrap their own chrome around it; we deliberately don't ship HTML
    // so the CLI rendering stays clean.
    const lines: string[] = [];
    if (appLabel.length > 0) lines.push(`[${appLabel}] ${title}`);
    else lines.push(title);
    if (body.length > 0) lines.push(body);
    return lines.join("\n");
}

function mapModeToEvent(mode: OsNotificationsConfig["mode"]): AppAgentEvent {
    switch (mode) {
        case "toast":
            return AppAgentEvent.Toast;
        case "inline":
            return AppAgentEvent.Inline;
        case "info":
            return AppAgentEvent.Info;
    }
}
