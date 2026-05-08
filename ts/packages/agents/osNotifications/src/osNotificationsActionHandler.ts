// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    ActionResult,
    ActionResultSuccess,
    AppAgent,
    AppAgentEvent,
    DisplayContent,
    ParsedCommandParams,
    ReadinessReport,
    SessionContext,
    TypeAgentAction,
} from "@typeagent/agent-sdk";
import {
    ChoiceManager,
    createActionResultFromError,
    createActionResultFromTextDisplay,
    createYesNoChoiceResult,
} from "@typeagent/agent-sdk/helpers/action";
import {
    CommandHandler,
    CommandHandlerNoParams,
    CommandHandlerTable,
    getCommandInterface,
} from "@typeagent/agent-sdk/helpers/command";
import registerDebug from "debug";
import {
    OsNotificationsConfig,
    defaultOsNotificationsConfig,
} from "./osNotificationsConfig.js";
import {
    OsNotificationsActions,
    SyncOsNotificationsAction,
    TestOsNotificationAction,
} from "./osNotificationsSchema.js";
import {
    OsNotificationAdded,
    OsNotificationEvent,
    OsNotificationWatcher,
} from "./watcherProtocol.js";
import { startWatcher } from "./watchers/index.js";
import {
    HelperNotBuiltError,
    buildWindowsHelper,
    isWindowsHelperBuilt,
} from "./watchers/windowsWatcher.js";

const debug = registerDebug("typeagent:osNotifications");

// Notifications older than this when the agent first sees them are dropped.
// The watcher may emit events for currently-present notifications at startup
// on some platforms; the user asked for "new only", so we anchor on the
// agent-enable timestamp. Slightly fuzzy to tolerate clock skew.
const NEW_ONLY_GRACE_MS = 2_000;

// Exported for unit tests. The agent doesn't need this type elsewhere.
export type AgentContext = {
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
    // Manages yes/no choice callbacks (build prompt, etc.). Required for the
    // createYesNoChoiceResult / handleChoice pattern from autoShell.
    choiceManager: ChoiceManager;
    // Mutex on the heavy build/sign/register work. The dispatcher's setup
    // re-entrancy guard only covers the synchronous setup() call; the
    // actual work runs later via the choice card's callback, which is a
    // separate context. Two clients each clicking "Yes" on their own
    // build cards would otherwise run dotnet publish + signtool +
    // Add-AppxPackage in parallel, which corrupts the publish output.
    buildInProgress: boolean;
};

// Pure decision function for readiness — split out from the agent's
// checkReadiness hook so it can be unit-tested without mocking
// process.platform or the watcher module.
//   - non-Windows: ready (no helper needed; we can still test-inject and
//     use the linux watcher).
//   - Windows + helper present: ready.
//   - Windows + helper missing: setup-required, with a hint.
//
// Exported for unit tests.
export function evaluateReadiness(
    platform: NodeJS.Platform,
    helperBuilt: boolean,
): ReadinessReport {
    if (platform !== "win32") {
        return { state: "ready" };
    }
    if (helperBuilt) {
        return { state: "ready" };
    }
    return {
        state: "setup-required",
        message:
            "OS notification helper exe (OsNotificationListener.exe) hasn't been built yet.",
        details:
            "Setup runs `dotnet publish` + signs + registers a sparse WinAppSDK package; ~30–60 seconds first time.",
    };
}

// ============================================================================
// Action handlers — invoked via natural language ("sync os notifications" /
// "test notification with X"). Return ActionResult; the dispatcher renders
// the displayContent and wires pendingChoice into the in-chat yes/no card.
// ============================================================================

async function executeOsNotificationsAction(
    action: TypeAgentAction<OsNotificationsActions>,
    actionContext: ActionContext<AgentContext>,
): Promise<ActionResult | undefined> {
    switch (action.actionName) {
        case "syncOsNotifications":
            return performSync(action, actionContext);
        case "testOsNotification":
            return performTest(action, actionContext);
    }
}

async function performSync(
    _action: SyncOsNotificationsAction,
    actionContext: ActionContext<AgentContext>,
): Promise<ActionResult> {
    const ctx = actionContext.sessionContext.agentContext;
    if (ctx.watcher === undefined) {
        return createActionResultFromError(
            "Watcher is not running. Make sure the agent is enabled.",
        );
    }
    try {
        await ctx.watcher.syncNow();
        return createActionResultFromTextDisplay(
            "Sync requested. Existing notifications will be forwarded as toasts shortly.",
        );
    } catch (e: any) {
        // Defense-in-depth: with the readiness gate this branch
        // shouldn't fire (the dispatcher pre-flights checkReadiness),
        // but the cache could be stale if the exe was deleted under us.
        // Surface a plain error pointing the user at setup.
        if (e instanceof HelperNotBuiltError) {
            return createActionResultFromError(
                "OS notification helper exe not found. Run `@config agent setup osNotifications` to build it.",
            );
        }
        return createActionResultFromError(`Sync failed: ${e?.message ?? e}`);
    }
}

async function performTest(
    action: TestOsNotificationAction,
    actionContext: ActionContext<AgentContext>,
): Promise<ActionResult> {
    const sessionContext = actionContext.sessionContext;
    // Synthesize an OsNotificationAdded event and feed it into the same
    // path live events use. Unique id + current timestamp so it isn't
    // dropped by the dedup check or the new-only gate.
    const synthetic: OsNotificationAdded = {
        kind: "added",
        id: `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        app: action.parameters.app ?? "test",
        title: action.parameters.title ?? "Test",
        body: action.parameters.message,
        timestamp: Date.now(),
    };
    onWatcherEvent(synthetic, sessionContext);
    return createActionResultFromTextDisplay(
        `Injected test notification "${action.parameters.message}".`,
    );
}

// Returns an ActionResultSuccess with pendingChoice — the dispatcher will
// register the route and call clientIO.requestChoice to render the in-chat
// yes/no card. handleChoice routes the response back through ChoiceManager,
// which invokes the callback with the LIVE ActionContext the dispatcher
// creates for the response.
//
// IMPORTANT: the callback uses `liveActionContext`, NOT the `actionContext`
// captured from this enclosing scope. By the time the user clicks Yes/No, the
// original ActionContext has been closed by the agent-rpc client (its
// `actionContextId` is out of scope), so any actionIO call on it would error
// with "Invalid contextId N used out of scope".
function offerHelperBuild(
    actionContext: ActionContext<AgentContext>,
): ActionResultSuccess {
    const ctx = actionContext.sessionContext.agentContext;
    return createYesNoChoiceResult(
        ctx.choiceManager,
        "The OS notification helper exe (OsNotificationListener.exe) hasn't been built yet. Build it now? This runs `dotnet publish` and may take 30–60 seconds the first time.",
        async (confirmed, liveActionContext) => {
            if (!confirmed) {
                return createActionResultFromTextDisplay(
                    "Build skipped — sync cancelled.",
                );
            }
            return buildAndRetrySync(
                liveActionContext as ActionContext<AgentContext>,
            );
        },
    );
}

// Run after the user chooses "Yes" on the build prompt. Lives in
// handleChoice's callback path, so it runs in a fresh ActionContext (the
// dispatcher creates one when responding to a choice). Display goes via
// actionIO.appendDisplay; the final ActionResult is what the dispatcher
// renders as the closing message.
// Exported for unit tests — they verify the mutex early-return path
// without invoking the heavy build pipeline.
export async function buildAndRetrySync(
    actionContext: ActionContext<AgentContext>,
): Promise<ActionResult> {
    const sessionContext = actionContext.sessionContext;
    const ctx = sessionContext.agentContext;

    // See AgentContext.buildInProgress — the dispatcher's setup-window
    // mutex only covers the synchronous setup() call, not the deferred
    // work behind the yes/no choice card. This catches two clients each
    // confirming their own build prompt before either build completes.
    if (ctx.buildInProgress) {
        return createActionResultFromError(
            "Build is already in progress (another client is running it). Wait for it to finish, then re-run sync.",
        );
    }
    ctx.buildInProgress = true;

    actionContext.actionIO.appendDisplay(
        {
            type: "text",
            content: "Building OsNotificationListener…",
            kind: "status",
        },
        "block",
    );
    try {
        await buildWindowsHelper({
            // "inline" so each line stays visible as the build runs — handy
            // for diagnosing failures and for seeing that dotnet is making
            // progress on long restores. The transcript can get long; if
            // that's noisy in practice, switch back to "temporary".
            onProgress: (line) => {
                actionContext.actionIO.appendDisplay(
                    { type: "text", content: line, kind: "status" },
                    "inline",
                );
            },
        });
    } catch (e: any) {
        ctx.buildInProgress = false;
        return createActionResultFromError(`Build failed: ${e?.message ?? e}`);
    }
    ctx.buildInProgress = false;

    // Restart the watcher so the freshly-built exe is picked up. The current
    // watcher is the no-helper stub; stopping it is a no-op, but we tear it
    // down anyway for symmetry with the live-watcher case.
    debug("rebuilt helper; restarting watcher");
    const oldWatcher = ctx.watcher;
    ctx.watcher = undefined;
    if (oldWatcher) await oldWatcher.stop();
    ctx.watcher = await startWatcher(process.platform, (evt) =>
        onWatcherEvent(evt, sessionContext),
    );

    try {
        await ctx.watcher.syncNow();
        return createActionResultFromTextDisplay(
            "Build complete and sync requested. Existing notifications will be forwarded shortly.",
        );
    } catch (e: any) {
        return createActionResultFromError(
            `Build succeeded but sync still failed: ${e?.message ?? e}`,
        );
    }
}

// ============================================================================
// Command handlers — the @osNotifications command surface. Each command
// constructs the corresponding action object and returns the result of the
// same per-action helper the NL pipeline uses. The dispatcher's command
// pipeline runs the same post-execution processing as the action pipeline
// (display content, pendingChoice / yes-no card), so commands and NL
// invocations render identically.
// ============================================================================

class OsNotificationsSyncCommandHandler implements CommandHandlerNoParams {
    public readonly description =
        "Re-emit currently-present OS notifications through the agent pipeline. Windows only — Linux/macOS do not expose existing notifications.";
    public async run(
        actionContext: ActionContext<AgentContext>,
    ): Promise<ActionResult> {
        const action: SyncOsNotificationsAction = {
            actionName: "syncOsNotifications",
            parameters: {},
        };
        return performSync(action, actionContext);
    }
}

class OsNotificationsTestCommandHandler implements CommandHandler {
    public readonly description =
        "Inject a synthetic notification through the agent pipeline (filters, rate limit, dismiss tracking) — useful for verifying the agent end-to-end without an OS notification source.";
    public readonly parameters = {
        args: {
            message: {
                description:
                    "Notification body text (defaults to 'Hello World!')",
                implicitQuotes: true,
                optional: true,
            },
        },
        flags: {
            app: {
                description:
                    "App name to attach to the synthetic notification (matched against allowList/blockList)",
                default: "test",
            },
            title: {
                description: "Notification title (defaults to 'Test')",
                default: "Test",
            },
        },
    } as const;

    public async run(
        actionContext: ActionContext<AgentContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ): Promise<ActionResult> {
        const action: TestOsNotificationAction = {
            actionName: "testOsNotification",
            parameters: {
                message: params.args.message ?? "Hello World!",
                app: params.flags.app as string,
                title: params.flags.title as string,
            },
        };
        return performTest(action, actionContext);
    }
}

const commandHandlers: CommandHandlerTable = {
    description: "OS notifications agent commands",
    commands: {
        sync: new OsNotificationsSyncCommandHandler(),
        test: new OsNotificationsTestCommandHandler(),
    },
};

export function instantiate(): AppAgent {
    return {
        ...getCommandInterface(commandHandlers),

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
                choiceManager: new ChoiceManager(),
                buildInProgress: false,
            };
        },

        // Spins up the per-OS watcher. Called by appAgentManager once per
        // session, immediately after initializeAgentContext succeeds. This
        // is the right hook for our use case because the agent has no
        // updateAgentContext path that fires on enable — see
        // appAgentManager.setState() and our README.
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

        executeAction: executeOsNotificationsAction,

        // Routes user yes/no responses (from createYesNoChoiceResult) back
        // to the registered ChoiceManager callback. The callback returns a
        // new ActionResult which the dispatcher renders. The AppAgent
        // signature types context as ActionContext<unknown>; cast to our
        // agent context to access choiceManager.
        handleChoice: async (choiceId, response, context) => {
            const ctx = (context as ActionContext<AgentContext>).sessionContext
                .agentContext;
            return ctx.choiceManager.handleChoice(choiceId, response, context);
        },

        // Cheap probe: file existence + platform check. The dispatcher
        // calls this right after the agent is enabled, after setup, and
        // on @config agent refresh. The result is cached.
        async checkReadiness(): Promise<ReadinessReport> {
            return evaluateReadiness(process.platform, isWindowsHelperBuilt());
        },

        // Returns the same yes/no card the agent used to offer when
        // syncNow threw HelperNotBuiltError — promoted to a first-class
        // setup hook so it works through the standard
        // `@config agent setup` path. The user clicks Yes/No on the card;
        // the build runs (mutex-protected by AgentContext.buildInProgress)
        // in the choice callback.
        setup: async (actionContext) => {
            return offerHelperBuild(
                actionContext as ActionContext<AgentContext>,
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

    // Dedup before any other check — covers two cases:
    //   1. The platform watcher re-emits an event we already forwarded
    //      (e.g. a sync after a notification we already saw live).
    //   2. A user-triggered sync re-enumerates everything currently in the
    //      action center while the live subscription is also running.
    // Without this, multiple bubbles pile up for the same OS notification.
    if (ctx.activeIds.has(evt.id)) {
        debug("dedup: already forwarded id=%s", evt.id);
        return;
    }

    // The "new only" gate drops events older than the agent-enable timestamp,
    // since some platforms surface currently-present notifications on
    // subscription startup. fromSync events are explicit user requests to
    // see existing notifications, so they bypass this gate.
    if (
        evt.fromSync !== true &&
        evt.timestamp + NEW_ONLY_GRACE_MS < ctx.enabledAt
    ) {
        debug("dropping pre-enable notification id=%s", evt.id);
        return;
    }
    if (!passesAppFilters(evt.app, ctx.config)) {
        debug("dropping by app filter id=%s app=%s", evt.id, evt.app);
        return;
    }
    // Rate limit applies to live notification floods (a misbehaving app
    // could spam dozens of notifications/minute). Explicit user-initiated
    // sync is a one-shot — bypass the limiter so all currently-present
    // notifications come through.
    if (evt.fromSync !== true && !withinRateLimit(ctx)) {
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
