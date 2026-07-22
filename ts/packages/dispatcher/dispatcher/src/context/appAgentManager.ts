// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    ActionResult,
    AppAgent,
    SessionContext,
    AppAgentManifest,
    AppAgentInitSettings,
    ReadinessReport,
} from "@typeagent/agent-sdk";
import { createActionResultFromError } from "@typeagent/agent-sdk/helpers/action";
import { CommandHandlerContext } from "./commandHandlerContext.js";
import {
    convertToActionConfig,
    ActionConfig,
    getGrammarContent,
} from "../translation/actionConfig.js";
import {
    ActionConfigProvider,
    ActionSchemaFile,
} from "../translation/actionConfigProvider.js";
import { getAppAgentName } from "../translation/agentTranslators.js";
import { createSessionContext } from "../execute/sessionContext.js";
import { AppAgentProvider } from "../agentProvider/agentProvider.js";
import registerDebug from "debug";
import { DispatcherName } from "./dispatcher/dispatcherUtils.js";
import {
    ActionSchemaSemanticMap,
    EmbeddingCache,
} from "../translation/actionSchemaSemanticMap.js";
import { ActionSchemaFileCache } from "../translation/actionSchemaFileCache.js";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { callEnsureError } from "../utils/exceptions.js";
import {
    AppAgentStateConfig,
    appAgentStateKeys,
} from "./appAgentStateConfig.js";
import { GrammarStore } from "agent-cache";
import {
    Grammar,
    grammarFromJson,
    AgentGrammarRegistry,
    compileGrammarToNFA,
    enrichGrammarWithCheckedVariables,
    loadGrammarRulesNoThrow,
} from "@typeagent/action-grammar";
import fs from "node:fs";
import { FlowDefinition } from "../execute/flowInterpreter.js";
import {
    findFuzzyCollisions,
    selectFuzzyScorer,
    type ActionDescriptor,
    type FuzzyCollision,
} from "../translation/fuzzyCollision.js";
import {
    IPortRegistrar,
    DEFAULT_ROLE,
    RegistrationId,
} from "./portRegistrar.js";

/**
 * Role string used by agents that have migrated off the legacy
 * `setLocalHostPort` shim and onto explicit
 * `sessionContext.registerPort("view", port)` for their per-session
 * local view (browser views, montage gallery, markdown preview).
 *
 * The legacy "default" role and this "view" role coexist: lookups for
 * `getLocalHostPort` / `getSharedLocalHostPort` try "default" first
 * (back-compat) and fall back to "view" (new pattern). This lets
 * cross-agent site lookup keep working through the migration.
 */
const LOCAL_VIEW_ROLE = "view";

const debug = registerDebug("typeagent:dispatcher:agents");
const debugError = registerDebug("typeagent:dispatcher:agents:error");
const debugLoad = registerDebug("typeagent:dispatcher:agents:load");
const debugCollisionStatic = registerDebug(
    "typeagent:dispatcher:collision:static",
);

export type StaticCollision = {
    actionName: string;
    occurrences: { schemaName: string; agentName: string }[];
};

type AppAgentRecord = {
    name: string;
    provider?: AppAgentProvider | undefined;
    schemas: Set<string>;
    actions: Set<string>;
    commands: boolean;
    manifest: AppAgentManifest;
    appAgent?: AppAgent | undefined;
    sessionContext?: SessionContext | undefined;
    sessionContextP?: Promise<SessionContext> | undefined;
    schemaErrors: Map<string, Error>;
    /**
     * Fresh UUID generated on every call to {@link initializeSessionContext}
     * and cleared by {@link closeSessionContext}. Identifies the agent's
     * current session-context lifetime so the {@link PortRegistrar} can
     * release any forgotten allocations as a backstop when the session
     * context tears down.
     */
    sessionContextId?: string | undefined;
};

export type AppAgentStateSettings = Partial<AppAgentStateConfig>;

function computeStateChange(
    settings: AppAgentStateSettings | undefined,
    kind: keyof AppAgentStateConfig,
    name: string,
    defaultEnabled: boolean,
    failed: [string, boolean, Error][],
) {
    const alwaysEnabled = alwaysEnabledAgents[kind].includes(name);
    const effectiveEnabled = settings?.[kind]?.[name] ?? defaultEnabled;
    if (alwaysEnabled && !effectiveEnabled) {
        failed.push([
            name,
            effectiveEnabled,
            new Error(`Cannot disable ${kind} for '${name}'`),
        ]);
    }
    return alwaysEnabled || effectiveEnabled;
}

export type SetStateResult = {
    changed: {
        schemas: [string, boolean][];
        actions: [string, boolean][];
        commands: [string, boolean][];
    };
    failed: {
        schemas: [string, boolean, Error][];
        actions: [string, boolean, Error][];
        commands: [string, boolean, Error][];
    };
};

export const alwaysEnabledAgents = {
    schemas: [DispatcherName],
    actions: [DispatcherName],
    commands: ["system"],
};

function loadGrammar(actionConfig: ActionConfig): Grammar | undefined {
    const grammarContent = getGrammarContent(actionConfig);
    if (grammarContent === undefined) {
        return undefined;
    }

    if (grammarContent.format === "ag") {
        return grammarFromJson(JSON.parse(grammarContent.content));
    }
    if (grammarContent.format === "agr") {
        // Parse raw .agr at load time; throw on errors so bad syntax fails loudly.
        const errors: string[] = [];
        const grammar = loadGrammarRulesNoThrow(
            `${actionConfig.schemaName}.agr`,
            grammarContent.content,
            errors,
        );
        if (errors.length > 0) {
            throw new Error(
                `Failed to parse static grammar for ${actionConfig.schemaName}: ${errors.join(", ")}`,
            );
        }
        return grammar ?? undefined;
    }
    throw new Error(
        `Unsupported grammar format '${(grammarContent as { format: string }).format}' for ${actionConfig.schemaName}`,
    );
}

export class AppAgentManager implements ActionConfigProvider {
    // TODO: the per-agent routing artifacts below - action schemas
    // (`actionConfigs` / `actionSchemaFileCache`), grammars (built per record in
    // `agents`), and action embeddings (`actionSemanticMap`) - are built and
    // held PER DISPATCHER (one AppAgentManager per CommandHandlerContext). For
    // installed agents these are identical across dispatchers, so every
    // `connect()` rebuilds the same artifacts. Share them across dispatchers
    // (build once per agent version, reference from each manager) to avoid the
    // redundant rebuild on connect and on `@package update`.
    private readonly agents = new Map<string, AppAgentRecord>();
    private readonly actionConfigs = new Map<string, ActionConfig>();
    private readonly loadingSchemas = new Set<string>();
    private readonly flowRegistry = new Map<string, FlowDefinition>();
    private readonly transientAgents: Record<string, boolean | undefined> = {};
    private readyWaiters: Array<() => void> = [];
    private readonly actionSemanticMap?: ActionSchemaSemanticMap;
    private readonly actionSchemaFileCache: ActionSchemaFileCache;

    // Static collision diagnostics. Populated by scanActionNameCollisions on
    // every addProvider / onSchemaReady; readable for `@dispatcher debug collisions`-style commands.
    public lastStaticCollisions: StaticCollision[] = [];
    public lastFuzzyCollisions: FuzzyCollision[] = [];
    // Cached per-agent readiness state. Populated by checkReadiness() right
    // after the agent's session context is created. Agents that don't
    // implement checkReadiness have no entry, and getReadiness() returns
    // {state: "ready"} for them. Cleared on agent disable; re-populated by
    // setup() and explicit refresh().
    private readonly readiness = new Map<string, ReadinessReport>();
    // Set of agents observed to implement `checkReadiness` at any point
    // this session. Sticky on purpose: once we know an agent supports
    // readiness, we keep that fact even after the agent is disabled and
    // its session context torn down, so the `@config agent` table can
    // distinguish "agent supports readiness but isn't currently probed"
    // (❓ badge) from "agent doesn't implement readiness, assume ready"
    // (no badge). Cleared only on dispatcher shutdown.
    private readonly readinessImplementers = new Set<string>();
    // Persistent per-app-agent load failure cache. Populated in the failure
    // branches of setState (action/command init paths — provider load,
    // initializeAgentContext, etc.) and cleared on successful (re-)enable.
    // Surfaced as a red icon in `@config agent` so users can see at a
    // glance which agents failed to load and why (tooltip carries the
    // error message). Without this, a failure like an MCP server failing
    // to connect would only flash a one-time error and leave the agent
    // looking like a normally-disabled one in the table.
    private readonly loadErrors = new Map<string, Error>();
    // Re-entrancy guards. With multiple clients (CLI, shell, web) hitting
    // the same agent server, two callers can race into runSetup or
    // refreshReadiness for the same agent. We collapse concurrent setups
    // (the second caller gets a friendly "in progress" result — the
    // first one's yes/no card stays bound to its originating client) and
    // dedupe concurrent refreshes (one probe, all callers share the
    // result).
    private readonly setupInFlight = new Map<
        string,
        Promise<ActionResult | undefined>
    >();
    private readonly refreshInFlight = new Map<
        string,
        Promise<ReadinessReport>
    >();
    public constructor(
        cacheDir: string | undefined,
        public readonly portRegistrar: IPortRegistrar,
        private readonly allowSharedLocalView?: string[],
        private readonly agentInitOptions?: Record<string, unknown>,
    ) {
        this.actionSchemaFileCache = new ActionSchemaFileCache(
            cacheDir
                ? path.join(cacheDir, "actionSchemaFileCache.json")
                : undefined,
        );

        try {
            this.actionSemanticMap = new ActionSchemaSemanticMap();
        } catch (e) {
            if (process.env.NODE_ENV !== "test") {
                console.log("Failed to create action semantic map", e);
            }
        }
    }
    public getAppAgentNames(): string[] {
        return Array.from(this.agents.keys());
    }

    /**
     * Return the registration-order rank for an agent. Lower = registered earlier.
     * Used by collision resolution's "priority" strategy as the implicit default
     * when no explicit collision.priorityOrder is set. Unknown agent names get
     * MAX_SAFE_INTEGER so they sort to the end.
     */
    public getAgentRank(agentName: string): number {
        let i = 0;
        for (const name of this.agents.keys()) {
            if (name === agentName) {
                return i;
            }
            i++;
        }
        return Number.MAX_SAFE_INTEGER;
    }

    public isSchemaLoading(schemaName: string): boolean {
        return this.loadingSchemas.has(schemaName);
    }

    public getAppAgentDescription(appAgentName: string) {
        const record = this.getRecord(appAgentName);
        return record.manifest.description;
    }

    public getAppAgentEmoji(appAgentName: string) {
        const record = this.getRecord(appAgentName);
        return record.manifest.emojiChar;
    }

    // ===== Readiness =====
    // Agents that don't implement checkReadiness, or whose session context
    // hasn't been initialized yet, are reported as `ready`. This is the
    // safe default — only agents that explicitly opt in can block
    // execution.
    public getReadiness(appAgentName: string): ReadinessReport {
        return this.readiness.get(appAgentName) ?? { state: "ready" };
    }

    // True iff this agent has been observed to implement checkReadiness
    // at any point this session AND we currently don't have a cached
    // report for it. In practice this means: the agent was enabled at
    // some point in a previous process (we know from a persisted hint or
    // future extension), or the readiness entry was explicitly cleared.
    // Note that disabling an agent does NOT clear its cached entry, so a
    // previously-ready agent that's now disabled still reports its last
    // known state instead of "unknown" — we have no reason to forget
    // working information. UI surfaces use this to show an "unknown"
    // indicator only when it's actually meaningful.
    public hasUnknownReadiness(appAgentName: string): boolean {
        return (
            this.readinessImplementers.has(appAgentName) &&
            !this.readiness.has(appAgentName)
        );
    }

    // Returns the most recent load failure for this agent, or undefined if
    // it loaded cleanly. See `loadErrors` field comment for lifecycle.
    public getLoadError(appAgentName: string): Error | undefined {
        return this.loadErrors.get(appAgentName);
    }

    // True if the agent implements an in-chat setup hook. The dispatcher's
    // pre-flight gate uses this to phrase the "needs setup" error
    // correctly — for agents without a hook (typically manual-config
    // cases like missing env vars), pointing at @config agent setup
    // would be a dead end, so we point at refresh instead.
    public hasSetup(appAgentName: string): boolean {
        return this.agents.get(appAgentName)?.appAgent?.setup !== undefined;
    }

    // List enabled agents that aren't ready (state != "ready"). Used by
    // `@config agent` to surface a warning icon and by
    // `@config agent setup` (no-name form) to drive bulk setup.
    public getNotReadyAgents(): { name: string; report: ReadinessReport }[] {
        const out: { name: string; report: ReadinessReport }[] = [];
        for (const [name, report] of this.readiness) {
            if (report.state !== "ready") out.push({ name, report });
        }
        return out;
    }

    // Re-runs the agent's checkReadiness and updates the cache. Returns the
    // fresh report. No-op (returns {state: "ready"}) for agents that don't
    // implement checkReadiness or whose session context isn't initialized.
    // Concurrent callers for the same agent share the in-flight probe.
    public refreshReadiness(appAgentName: string): Promise<ReadinessReport> {
        const existing = this.refreshInFlight.get(appAgentName);
        if (existing !== undefined) {
            return existing;
        }
        const p = this.refreshReadinessImpl(appAgentName).finally(() => {
            this.refreshInFlight.delete(appAgentName);
        });
        this.refreshInFlight.set(appAgentName, p);
        return p;
    }

    private async refreshReadinessImpl(
        appAgentName: string,
    ): Promise<ReadinessReport> {
        const record = this.agents.get(appAgentName);
        if (
            record === undefined ||
            record.appAgent === undefined ||
            record.sessionContext === undefined ||
            record.appAgent.checkReadiness === undefined
        ) {
            // Nothing to refresh — preserve any existing entry (could be
            // stale, but we have no way to update it).
            return this.getReadiness(appAgentName);
        }
        try {
            const report = await record.appAgent.checkReadiness(
                record.sessionContext,
            );
            this.readiness.set(appAgentName, report);
            return report;
        } catch (e: any) {
            const report: ReadinessReport = {
                state: "setup-required",
                message: `checkReadiness threw: ${e?.message ?? String(e)}`,
            };
            this.readiness.set(appAgentName, report);
            return report;
        }
    }

    // Runs the agent's `setup` (if it implements one), then refreshes the
    // cached readiness so callers see the new state. The agent's setup is
    // responsible for the in-chat UX (yes/no card, progress, etc.) via the
    // returned ActionResult.
    //
    // Returns:
    //   - undefined if the agent doesn't implement setup (caller should
    //     surface the agent's readiness message instead).
    //   - The agent's ActionResult otherwise — the dispatcher's command
    //     pipeline runs the standard post-execution processing on it.
    //
    // Concurrency note — the in-flight guard below covers the synchronous
    // window of `agent.setup(...)`: if two clients call runSetup at the
    // same instant, the second gets a friendly "in progress" result and
    // does NOT re-trigger setup work. The guard does NOT cover the
    // common pattern where setup returns immediately with a pendingChoice
    // card and the heavy work runs later via handleChoice — at that point
    // the dispatcher has no signal that work is still pending. Agents
    // whose setup defers work to a choice callback are responsible for
    // making that work itself idempotent / mutex-protected.
    public async runSetup(
        appAgentName: string,
        actionContext: ActionContext<unknown>,
        context?: CommandHandlerContext,
    ): Promise<ActionResult | undefined> {
        const record = this.agents.get(appAgentName);
        if (record?.appAgent?.setup === undefined) {
            return undefined;
        }

        // Re-entrancy guard — only one setup runs at a time per agent.
        // The second concurrent caller does NOT replay the first setup's
        // ActionResult; that result (which may include a yes/no choice
        // card with a choiceId already routed to the originating client)
        // belongs to whoever started it. The runner-up gets a distinct
        // "in progress" message and is expected to re-run their original
        // request once setup completes.
        if (this.setupInFlight.has(appAgentName)) {
            return createActionResultFromError(
                `Setup for '${appAgentName}' is already in progress on another client. Wait for it to finish, then re-run your request.`,
            );
        }
        const p = (async () => {
            try {
                return await record.appAgent!.setup!(actionContext);
            } finally {
                // Always re-check readiness after setup, success or
                // failure — setup may have made partial progress (e.g.
                // cert installed but package register failed) and the
                // cache should reflect the current truth.
                await this.refreshReadiness(appAgentName);
                // If the agent had a stale load failure (likely the
                // very thing setup just resolved), clear it and retry
                // the enables that were blocked by it. Without this,
                // the user sees the load-error marker forever AND
                // their actions stay disabled even though readiness
                // now reports `ready` — they'd have to manually toggle
                // off+on to recover. Skipped when no context was
                // provided (older callers); they'll keep the legacy
                // behavior. See recoverFromLoadFailure for details.
                if (
                    context !== undefined &&
                    this.loadErrors.has(appAgentName) &&
                    this.getReadiness(appAgentName).state === "ready"
                ) {
                    await this.recoverFromLoadFailure(appAgentName, context);
                }
            }
        })();
        this.setupInFlight.set(appAgentName, p);
        try {
            return await p;
        } finally {
            this.setupInFlight.delete(appAgentName);
        }
    }

    // Cleans up after a successful setup that came on the heels of a
    // failed load:
    //   1. Resets cached load state. initializeSessionContext caches its
    //      promise on `record.sessionContextP`; if the original init
    //      threw (binary missing, etc.), that's a rejected promise that
    //      ensureSessionContext would happily return on the next call,
    //      forever. Clear it so the next access reattempts.
    //   2. Clears the loadErrors entry so the table marker disappears.
    //   3. Re-applies current session settings via setState — retries
    //      any enables that were blocked by the original failure.
    //      setState only mutates agents whose desired state differs
    //      from current, so other agents are unaffected.
    //
    // If the retry fails (still broken for some other reason), setState's
    // own catch path will repopulate loadErrors with the new error, so
    // we don't need a try/catch here for state correctness — but we
    // swallow throw so the original setup result still surfaces to the
    // user.
    private async recoverFromLoadFailure(
        appAgentName: string,
        context: CommandHandlerContext,
    ): Promise<void> {
        const record = this.agents.get(appAgentName);
        if (record === undefined) return;
        debug(
            `Recovering ${appAgentName} after successful setup (clearing stale load error + retrying enables)`,
        );
        record.sessionContextP = undefined;
        record.sessionContext = undefined;
        record.appAgent = undefined;
        this.loadErrors.delete(appAgentName);
        try {
            await this.setState(context, context.session.getConfig());
        } catch (e: any) {
            debugError(
                `Recovery setState for ${appAgentName} threw: ${e?.message ?? e}`,
            );
        }
    }

    public getLocalHostPort(appAgentName: string) {
        // Fall back to the "view" role for agents migrated off the
        // legacy `setLocalHostPort` shim (browser-views, montage,
        // markdown). Lookup order matches `getSharedLocalHostPort`.
        return (
            this.portRegistrar.lookup(appAgentName, DEFAULT_ROLE) ??
            this.portRegistrar.lookup(appAgentName, LOCAL_VIEW_ROLE)
        );
    }

    /**
     * Back-compat shim for the legacy `setLocalHostPort` SDK method.
     * Routes through {@link PortRegistrar.register} with `role="default"`
     * using the agent's current `sessionContextId`. Throws if the agent
     * has no live session context (i.e. nothing to scope the
     * registration to) — this matches the prior behavior, where calling
     * `setLocalHostPort` outside of an initialized agent context was a
     * programming error that would silently mutate `record.port`.
     *
     * @returns the {@link RegistrationId} so callers that want explicit
     * release control can use it; legacy callers ignore the return value
     * and rely on the {@link closeSessionContext} backstop instead.
     */
    public setLocalHostPort(
        appAgentName: string,
        port: number,
    ): RegistrationId {
        const record = this.getRecord(appAgentName);
        if (record.sessionContextId === undefined) {
            throw new Error(
                `Cannot register port for '${appAgentName}': no active session context`,
            );
        }
        return this.portRegistrar.register(
            appAgentName,
            DEFAULT_ROLE,
            port,
            record.sessionContextId,
        );
    }

    public getSharedLocalHostPort(requester: string, target: string) {
        const record = this.agents.get(target);

        // Denied access if it is not a valid agent name to avoid leaking information
        // about whether agent exists or not.
        if (
            record === undefined ||
            (!this.allowSharedLocalView?.includes(requester) && // host declare allowed agents to share
                record.manifest.sharedLocalView?.includes(requester) !== true) // agent declared allowed agents to share.
        ) {
            throw new Error(
                `Agent '${requester}' is not allowed to access '${target}' local view.`,
            );
        }

        if (record.appAgent === undefined) {
            throw new Error(
                `Agent '${target}' is not initialized. Local view not available.`,
            );
        }

        // Lookup order: "default" first for back-compat with legacy
        // `setLocalHostPort` callers, then "view" for agents that
        // migrated to the explicit `registerPort("view", ...)` pattern
        // (browser-views, montage, markdown).
        const port =
            this.portRegistrar.lookup(target, DEFAULT_ROLE) ??
            this.portRegistrar.lookup(target, LOCAL_VIEW_ROLE);
        if (port === undefined) {
            throw new Error(`Local view not available for agent '${target}'.`);
        }
        return port;
    }

    public isAppAgentName(appAgentName: string) {
        return this.agents.get(appAgentName) !== undefined;
    }

    public getFlow(
        schemaName: string,
        actionName: string,
    ): FlowDefinition | undefined {
        const appAgentName = getAppAgentName(schemaName);
        return this.flowRegistry.get(`${appAgentName}/${actionName}`);
    }

    // Throws if schemaName is invalid.
    public isSchemaEnabled(schemaName: string) {
        const appAgentName = getAppAgentName(schemaName);
        const record = this.getRecord(appAgentName);
        return record.schemas.has(schemaName);
    }

    // Throws if schemaName is invalid.
    public isSchemaActive(schemaName: string) {
        return (
            this.isSchemaEnabled(schemaName) &&
            this.transientAgents[schemaName] !== false
        );
    }

    public getActiveSchemas() {
        return this.getSchemaNames().filter((name) =>
            this.isSchemaActive(name),
        );
    }

    // Throws if schemaName is invalid.
    public isActionActive(schemaName: string) {
        return (
            this.isActionEnabled(schemaName) &&
            this.transientAgents[schemaName] !== false
        );
    }

    // Throws if schemaName is invalid.
    public isActionEnabled(schemaName: string) {
        const appAgentName = getAppAgentName(schemaName);
        const record = this.getRecord(appAgentName);
        return record.actions.has(schemaName);
    }

    // Throws if appAgentName is invalid.
    public isCommandEnabled(appAgentName: string) {
        const record = this.getRecord(appAgentName);
        return record.commands && record.appAgent?.executeCommand !== undefined;
    }

    // Return undefined if we don't know because the agent isn't loaded yet.
    // Return null if the agent doesn't support commands.
    // Throws if appAgentName is invalid.
    public getCommandEnabledState(appAgentName: string) {
        const record = this.getRecord(appAgentName);
        return record.appAgent !== undefined
            ? record.appAgent.executeCommand !== undefined
                ? record.commands
                : null
            : undefined;
    }

    /**
     * Walk the loaded actionConfigs and find action names that appear in more
     * than one schema. Caller decides whether to warn or throw.
     */
    public scanActionNameCollisions(): StaticCollision[] {
        const seen = new Map<
            string,
            { schemaName: string; agentName: string }[]
        >();
        for (const [schemaName, config] of this.actionConfigs) {
            const agentName = getAppAgentName(schemaName);
            let actionNames: string[];
            try {
                const file =
                    this.actionSchemaFileCache.getActionSchemaFile(config);
                actionNames = Array.from(
                    file.parsedActionSchema.actionSchemas.keys(),
                );
            } catch (e) {
                // Schema not loadable yet (e.g., agent failed to start). Skip.
                debugCollisionStatic(
                    `skip ${schemaName} (could not load schema): ${e}`,
                );
                continue;
            }
            for (const actionName of actionNames) {
                const list = seen.get(actionName) ?? [];
                list.push({ schemaName, agentName });
                seen.set(actionName, list);
            }
        }
        const collisions: StaticCollision[] = [];
        for (const [actionName, occurrences] of seen) {
            if (occurrences.length > 1) {
                collisions.push({ actionName, occurrences });
            }
        }
        this.lastStaticCollisions = collisions;
        return collisions;
    }

    /**
     * Build the descriptor list used by fuzzy scanning. Pulls action name +
     * (eventually) schema documentation. Returns [] if no schemas loaded.
     */
    public collectActionDescriptors(): ActionDescriptor[] {
        const out: ActionDescriptor[] = [];
        for (const [schemaName, config] of this.actionConfigs) {
            try {
                const file =
                    this.actionSchemaFileCache.getActionSchemaFile(config);
                for (const [actionName, def] of file.parsedActionSchema
                    .actionSchemas) {
                    out.push({
                        schemaName,
                        actionName,
                        // ActionSchemaTypeDefinition.comments is the schema doc;
                        // safe-fall back to no description if absent.
                        description:
                            (
                                def as unknown as { comments?: string[] }
                            ).comments?.join(" ") ?? undefined,
                    });
                }
            } catch {
                // Skip unloadable schema; descriptors only feed fuzzy scoring.
            }
        }
        return out;
    }

    public async runStaticFuzzyScan(
        scorerKind: "placeholder" | "actionEmbedding",
        threshold: number,
    ): Promise<FuzzyCollision[]> {
        const scorer = selectFuzzyScorer(scorerKind);
        const descriptors = this.collectActionDescriptors();
        const collisions = await findFuzzyCollisions(
            descriptors,
            scorer,
            threshold,
        );
        this.lastFuzzyCollisions = collisions;
        return collisions;
    }

    public async semanticSearchActionSchema(
        request: string,
        maxMatches: number = 1,
        filter: (schemaName: string) => boolean = (schemaName) =>
            this.isSchemaActive(schemaName),
    ) {
        return this.actionSemanticMap?.nearestNeighbors(
            request,
            maxMatches,
            filter,
        );
    }

    public async addProvider(
        provider: AppAgentProvider,
        actionGrammarStore: GrammarStore | undefined,
        actionEmbeddingCache?: EmbeddingCache,
        agentGrammarRegistry?: AgentGrammarRegistry,
        useNFAGrammar?: boolean,
        stateRefreshFn?: () => Promise<void>,
    ) {
        const agentNames = provider.getAppAgentNames();
        const semanticMapP: Promise<void>[] = [];
        for (const name of agentNames) {
            const manifest = await provider.getAppAgentManifest(name);
            this.addAgentManifest(
                name,
                manifest,
                semanticMapP,

                actionGrammarStore,
                provider,
                actionEmbeddingCache,
                agentGrammarRegistry,
                useNFAGrammar,
            );
        }
        debug("Waiting for action embeddings");
        await Promise.all(semanticMapP);
        debug("Finish action embeddings");

        if (provider.onSchemaReady && stateRefreshFn) {
            // Mark only the agents that are actually loading asynchronously (e.g.
            // serverCommand MCP agents with slow startup).  Agents that failed
            // synchronously should show ❌, not ⏳.
            const loadingNames = new Set(
                provider.getLoadingAgentNames?.() ?? [],
            );
            for (const name of agentNames) {
                if (!loadingNames.has(name)) {
                    continue;
                }
                const record = this.agents.get(name);
                if (record) {
                    for (const schemaName of Object.keys(
                        convertToActionConfig(name, record.manifest),
                    )) {
                        this.loadingSchemas.add(schemaName);
                    }
                }
            }

            provider.onSchemaReady(async (agentName, manifest) => {
                try {
                    const refreshSemanticMapP: Promise<void>[] = [];
                    this.refreshAgentSchema(
                        agentName,
                        manifest,
                        refreshSemanticMapP,
                        actionGrammarStore,
                        actionEmbeddingCache,
                        agentGrammarRegistry,
                        useNFAGrammar,
                    );
                    await Promise.all(refreshSemanticMapP);
                    await stateRefreshFn();
                } catch (e) {
                    debugError(
                        `Failed to refresh schema for agent '${agentName}': ${e}`,
                    );
                }
            });
        }
    }

    private refreshAgentSchema(
        appAgentName: string,
        manifest: AppAgentManifest,
        semanticMapP: Promise<void>[],
        actionGrammarStore: GrammarStore | undefined,
        actionEmbeddingCache?: EmbeddingCache,
        agentGrammarRegistry?: AgentGrammarRegistry,
        useNFAGrammar?: boolean,
    ) {
        const record = this.agents.get(appAgentName);
        if (record === undefined) {
            throw new Error(`Agent not found: ${appAgentName}`);
        }

        // Update the manifest (emoji, schema, etc.)
        record.manifest = manifest;

        const actionConfigs = convertToActionConfig(appAgentName, manifest);
        for (const [schemaName, config] of Object.entries(actionConfigs)) {
            debug(`Refreshing action config: ${schemaName}`);
            this.actionConfigs.set(schemaName, config);
            if (config.transient) {
                this.transientAgents[schemaName] = false;
            }
            try {
                const actionSchemaFile =
                    this.actionSchemaFileCache.getActionSchemaFile(config);
                if (this.actionSemanticMap) {
                    semanticMapP.push(
                        this.actionSemanticMap.addActionSchemaFile(
                            config,
                            actionSchemaFile,
                            actionEmbeddingCache,
                        ),
                    );
                }
                record.schemaErrors.delete(schemaName);
                this.loadingSchemas.delete(schemaName);
            } catch (e: any) {
                record.schemaErrors.set(schemaName, e);
                this.loadingSchemas.delete(schemaName);
            } finally {
                this.notifyReadyIfDone();
            }
        }
    }

    private addAgentManifest(
        appAgentName: string,
        manifest: AppAgentManifest,
        semanticMapP: Promise<void>[],
        actionGrammarStore: GrammarStore | undefined,
        provider?: AppAgentProvider,
        actionEmbeddingCache?: EmbeddingCache,
        agentGrammarRegistry?: AgentGrammarRegistry,
        useNFAGrammar?: boolean,
    ) {
        if (this.isAppAgentName(appAgentName)) {
            throw new Error(`Conflicting app agents name '${appAgentName}'`);
        }
        const actionConfigs = convertToActionConfig(appAgentName, manifest);

        const entries = Object.entries(actionConfigs);
        const schemaErrors = new Map<string, Error>();

        for (const [schemaName, config] of entries) {
            debug(`Adding action config: ${schemaName}`);
            this.actionConfigs.set(schemaName, config);
            if (config.transient) {
                this.transientAgents[schemaName] = false;
            }
            try {
                const actionSchemaFile =
                    this.actionSchemaFileCache.getActionSchemaFile(config);

                if (this.actionSemanticMap) {
                    semanticMapP.push(
                        this.actionSemanticMap.addActionSchemaFile(
                            config,
                            actionSchemaFile,
                            actionEmbeddingCache,
                        ),
                    );
                }

                if (actionGrammarStore) {
                    let g: Grammar | undefined = undefined;

                    try {
                        g = loadGrammar(config);
                    } catch (e) {
                        // Grammar file doesn't exist or failed to load
                        debugError(
                            `Failed to load grammar for schema: ${schemaName}\n${e}`,
                        );
                    }

                    // If no grammar file exists but we're using NFA system, create an empty grammar
                    // This allows dynamic grammar generation to work for agents without pre-existing grammars
                    if (!g && useNFAGrammar && agentGrammarRegistry) {
                        debug(
                            `No grammar file found for ${schemaName}, creating empty grammar for dynamic generation`,
                        );
                        g = { alternatives: [] };
                    }

                    if (g) {
                        // In NFA mode, only add to agentGrammarRegistry (not actionGrammarStore)
                        // The merged grammar will be synced to the store later via syncAgentGrammar
                        if (useNFAGrammar && agentGrammarRegistry) {
                            debug(
                                `Adding grammar to NFA registry for schema: ${schemaName}`,
                            );
                        } else {
                            // In non-NFA mode, add directly to grammar store
                            debug(`Adding grammar for schema: ${schemaName}`);
                            actionGrammarStore.addGrammar(schemaName, g);
                        }

                        // Add to NFA grammar registry if using NFA system
                        if (useNFAGrammar && agentGrammarRegistry) {
                            try {
                                // Enrich grammar with checked variables from parsed schema
                                try {
                                    enrichGrammarWithCheckedVariables(
                                        g,
                                        actionSchemaFile.parsedActionSchema,
                                    );
                                    debug(
                                        `Enriched grammar with checked variables for schema: ${schemaName}`,
                                    );
                                } catch (enrichError) {
                                    debug(
                                        `Could not enrich grammar with checked variables for ${schemaName}: ${enrichError}`,
                                    );
                                }

                                const nfa = compileGrammarToNFA(g, schemaName);
                                agentGrammarRegistry.registerAgent(
                                    schemaName,
                                    g,
                                    nfa,
                                );
                                debug(
                                    `Added NFA grammar for schema: ${schemaName} (${g.alternatives.length} rules)`,
                                );
                            } catch (nfaError) {
                                debugError(
                                    `Failed to compile NFA for schema: ${schemaName}\n${nfaError}`,
                                );
                            }
                        }
                    }
                }
            } catch (e: any) {
                schemaErrors.set(schemaName, e);
            }
        }

        const record: AppAgentRecord = {
            name: appAgentName,
            provider,
            actions: new Set(),
            schemas: new Set(),
            schemaErrors,
            commands: false,
            manifest,
        };

        this.agents.set(appAgentName, record);

        // Load registered flow definitions from manifest
        if (manifest.flows) {
            for (const [actionName, flowPath] of Object.entries(
                manifest.flows,
            ) as [string, string][]) {
                try {
                    const content = fs.readFileSync(flowPath, "utf-8");
                    const flowDef: FlowDefinition = JSON.parse(content);
                    this.flowRegistry.set(
                        `${appAgentName}/${actionName}`,
                        flowDef,
                    );
                    debug(`Loaded flow: ${appAgentName}.${actionName}`);
                } catch (e) {
                    debugError(
                        `Failed to load flow '${actionName}' from '${flowPath}': ${e}`,
                    );
                }
            }
        }

        return record;
    }

    public async addDynamicAgent(
        appAgentName: string,
        manifest: AppAgentManifest,
        appAgent: AppAgent,
        actionGrammarStore?: GrammarStore,
    ) {
        if (this.agents.has(appAgentName)) {
            throw new Error(`App agent '${appAgentName}' already exists`);
        }

        // REVIEW: action embedding is not cached.
        const semanticMapP: Promise<void>[] = [];
        const record = this.addAgentManifest(
            appAgentName,
            manifest,
            semanticMapP,
            actionGrammarStore,
        );
        record.appAgent = appAgent;

        debug("Waiting for action embeddings");
        await Promise.all(semanticMapP);
        debug("Finish action embeddings");
    }

    private cleanupAgent(appAgentName: string, grammarStore?: GrammarStore) {
        const schemasToRemove: string[] = [];

        for (const [schemaName, config] of this.actionConfigs) {
            if (getAppAgentName(schemaName) !== appAgentName) {
                continue;
            }

            schemasToRemove.push(schemaName);

            try {
                this.actionSchemaFileCache.unloadActionSchemaFile(schemaName);
            } catch (error) {
                console.warn(
                    `Failed to unload schema file ${schemaName}:`,
                    error,
                );
            }

            try {
                this.actionSemanticMap?.removeActionSchemaFile(schemaName);
            } catch (error) {
                console.warn(
                    `Failed to remove from semantic map ${schemaName}:`,
                    error,
                );
            }

            if (grammarStore) {
                try {
                    grammarStore.removeGrammar(schemaName);
                } catch (error) {
                    console.warn(
                        `Failed to remove grammar ${schemaName}:`,
                        error,
                    );
                }
            }

            if (config.transient) {
                delete this.transientAgents[schemaName];
            }
        }

        for (const schemaName of schemasToRemove) {
            this.actionConfigs.delete(schemaName);
        }
    }

    public async forceCleanupAgent(
        appAgentName: string,
        grammarStore?: GrammarStore,
    ): Promise<void> {
        console.warn(`Force cleanup for agent: ${appAgentName}`);

        const schemas = Array.from(this.actionConfigs.keys()).filter(
            (name) => getAppAgentName(name) === appAgentName,
        );

        for (const schemaName of schemas) {
            try {
                this.actionSchemaFileCache.unloadActionSchemaFile(schemaName);
            } catch (e) {
                console.warn(`Force cleanup schema file failed:`, e);
            }

            try {
                this.actionSemanticMap?.removeActionSchemaFile(schemaName);
            } catch (e) {
                console.warn(`Force cleanup semantic map failed:`, e);
            }

            if (grammarStore) {
                try {
                    grammarStore.removeGrammar(schemaName);
                } catch (e) {
                    console.warn(`Force cleanup grammar failed:`, e);
                }
            }

            try {
                const config = this.actionConfigs.get(schemaName);
                if (config?.transient) {
                    delete this.transientAgents[schemaName];
                }
            } catch (e) {
                console.warn(`Force cleanup transient failed:`, e);
            }

            try {
                this.actionConfigs.delete(schemaName);
            } catch (e) {
                console.warn(`Force cleanup config failed:`, e);
            }
        }

        try {
            this.agents.delete(appAgentName);
        } catch (e) {
            console.warn(`Force cleanup agent record failed:`, e);
        }

        console.warn(`Force cleanup complete for: ${appAgentName}`);
    }

    public async removeAgent(
        appAgentName: string,
        grammarStore?: GrammarStore,
    ) {
        // Check if agent exists before trying to remove it
        if (!this.isAppAgentName(appAgentName)) {
            debug(`Agent '${appAgentName}' does not exist, skipping removal`);
            return;
        }

        const record = this.getRecord(appAgentName);
        this.agents.delete(appAgentName);
        this.cleanupAgent(appAgentName, grammarStore);

        await this.closeSessionContext(record);
        if (record.appAgent !== undefined) {
            await record.provider?.unloadAppAgent(record.name);
        }
    }

    /**
     * Remove a whole provider by identity: derive the
     * provider's agent name(s) via {@link AppAgentProvider.getAppAgentNames} and
     * tear each one down through the existing name-based {@link removeAgent}
     * (schemas, grammars, embeddings, and any live `SessionContext` are dropped
     * there). A no-op for names this manager never registered (e.g. an unknown
     * provider) — `removeAgent` skips names it does not know.
     *
     * NEW work relative to `removeAgent`, which is name-only and neither tracks
     * nor drops a provider. Source-vended providers are single-agent (the host
     * asserts that invariant before add), but this loops defensively over every
     * vended name.
     */
    public async removeProvider(
        provider: AppAgentProvider,
        grammarStore?: GrammarStore,
    ) {
        for (const name of provider.getAppAgentNames()) {
            await this.removeAgent(name, grammarStore);
        }
    }

    public getActionEmbeddings() {
        return this.actionSemanticMap?.embeddings();
    }
    public tryGetActionConfig(mayBeSchemaName: string) {
        return this.actionConfigs.get(mayBeSchemaName);
    }
    public getActionConfig(schemaName: string) {
        const config = this.tryGetActionConfig(schemaName);
        if (config === undefined) {
            throw new Error(`Unknown schema name: ${schemaName}`);
        }
        return config;
    }

    public getSchemaNames() {
        return Array.from(this.actionConfigs.keys());
    }
    public getActionConfigs() {
        return Array.from(this.actionConfigs.values());
    }

    /** Resolves immediately if no schemas are loading, otherwise waits until all pending async schema loads complete. */
    public waitUntilReady(): Promise<void> {
        if (this.loadingSchemas.size === 0) {
            return Promise.resolve();
        }
        return new Promise((resolve) => {
            this.readyWaiters.push(resolve);
        });
    }

    private notifyReadyIfDone(): void {
        if (this.loadingSchemas.size === 0 && this.readyWaiters.length > 0) {
            const waiters = this.readyWaiters.splice(0);
            for (const resolve of waiters) {
                resolve();
            }
        }
    }

    public getAppAgent(appAgentName: string): AppAgent {
        const record = this.getRecord(appAgentName);
        if (record.appAgent === undefined) {
            throw new Error(`App agent '${appAgentName}' is not initialized`);
        }
        return record.appAgent;
    }

    public getSessionContext(appAgentName: string): SessionContext {
        const record = this.getRecord(appAgentName);
        if (record.sessionContext === undefined) {
            throw new Error(
                `Session context for '${appAgentName}' is not initialized`,
            );
        }
        return record.sessionContext;
    }

    public async setState(
        context: CommandHandlerContext,
        settings?: AppAgentStateSettings,
    ): Promise<SetStateResult> {
        const changedSchemas: [string, boolean][] = [];
        const failedSchemas: [string, boolean, Error][] = [];
        const changedActions: [string, boolean][] = [];
        const failedActions: [string, boolean, Error][] = [];
        const changedCommands: [string, boolean][] = [];
        const failedCommands: [string, boolean, Error][] = [];

        const p: Promise<void>[] = [];
        for (const [name, config] of this.actionConfigs) {
            const record = this.getRecord(getAppAgentName(name));

            const enableSchema = computeStateChange(
                settings,
                "schemas",
                name,
                config.schemaDefaultEnabled,
                failedSchemas,
            );
            if (enableSchema !== record.schemas.has(name)) {
                if (enableSchema) {
                    if (this.loadingSchemas.has(name)) {
                        // Schema is still loading (e.g. slow MCP server start).
                        // Skip for now; refreshAgentSchema will re-run setState once ready.
                        debug(
                            `Schema '${name}' is still loading, skipping enable`,
                        );
                    } else {
                        const e = record.schemaErrors.get(name);
                        if (e !== undefined) {
                            failedSchemas.push([name, enableSchema, e]);
                            debugError(
                                `Schema '${name}' is not enabled because of error: ${e.message}`,
                            );
                        } else {
                            record.schemas.add(name);
                            changedSchemas.push([name, enableSchema]);
                            debug(`Schema enabled ${name}`);
                        }
                    }
                } else {
                    record.schemas.delete(name);
                    changedSchemas.push([name, enableSchema]);
                    debug(`Schema disabled ${name}`);
                }
            }

            const enableAction = computeStateChange(
                settings,
                "actions",
                name,
                config.actionDefaultEnabled,
                failedActions,
            );
            if (enableAction !== record.actions.has(name)) {
                if (enableAction && this.loadingSchemas.has(name)) {
                    // Action agent is still loading — skip to avoid blocking on server startup.
                    debug(`Action '${name}' is still loading, skipping enable`);
                } else {
                    p.push(
                        (async () => {
                            try {
                                await this.updateAction(
                                    name,
                                    record,
                                    enableAction,
                                    context,
                                );
                                changedActions.push([name, enableAction]);
                                // Successful enable / disable — clear any
                                // stale load error for this agent. Keyed
                                // on appAgentName, not schema name.
                                if (enableAction) {
                                    this.loadErrors.delete(record.name);
                                }
                            } catch (e: any) {
                                failedActions.push([name, enableAction, e]);
                                if (enableAction) {
                                    this.loadErrors.set(record.name, e);
                                }
                            }
                        })(),
                    );
                }
            }
        }

        for (const record of this.agents.values()) {
            const enableCommands = computeStateChange(
                settings,
                "commands",
                record.name,
                record.manifest.commandDefaultEnabled ??
                    record.manifest.defaultEnabled ??
                    true,
                failedCommands,
            );

            if (enableCommands !== record.commands) {
                if (enableCommands) {
                    p.push(
                        (async () => {
                            try {
                                await this.ensureSessionContext(
                                    record,
                                    context,
                                );
                                record.commands = true;
                                changedCommands.push([
                                    record.name,
                                    enableCommands,
                                ]);
                                // Successful enable — clear any stale
                                // load error for this agent.
                                this.loadErrors.delete(record.name);
                                debug(`Command enabled ${record.name}`);
                            } catch (e: any) {
                                failedCommands.push([
                                    record.name,
                                    enableCommands,
                                    e,
                                ]);
                                // Persist for the table renderer; next
                                // successful enable will clear it.
                                this.loadErrors.set(record.name, e);
                            }
                        })(),
                    );
                } else {
                    debug(`Command disabled ${record.name}`);
                    record.commands = false;
                    changedCommands.push([record.name, enableCommands]);
                    await this.checkCloseSessionContext(record);
                }
            }
        }

        await Promise.all(p);
        return {
            changed: {
                schemas: changedSchemas,
                actions: changedActions,
                commands: changedCommands,
            },
            failed: {
                schemas: failedSchemas,
                actions: failedActions,
                commands: failedCommands,
            },
        };
    }

    public getTransientState(schemaName: string) {
        return this.transientAgents[schemaName];
    }

    public toggleTransient(schemaName: string, enable: boolean) {
        if (this.transientAgents[schemaName] === undefined) {
            throw new Error(`Transient sub agent not found: ${schemaName}`);
        }
        debug(
            `Toggle transient agent '${schemaName}' to ${enable ? "enabled" : "disabled"}`,
        );
        this.transientAgents[schemaName] = enable;
    }
    public async close() {
        const closeP: Promise<void>[] = [];
        for (const record of this.agents.values()) {
            closeP.push(
                (async () => {
                    await this.closeSessionContext(record);
                    record.actions.clear();
                    record.commands = false;
                    if (record.appAgent !== undefined) {
                        await record.provider?.unloadAppAgent(record.name);
                        record.appAgent = undefined;
                    }
                })(),
            );
        }
        await Promise.all(closeP);
    }

    private async loadDynamicGrammar(
        schemaName: string,
        appAgent: AppAgent,
        sessionContext: SessionContext,
        context: CommandHandlerContext,
    ): Promise<void> {
        let dynamicGrammar: Grammar | undefined;

        // Prefer the agent callback over file-based convention
        if (appAgent.getDynamicGrammar) {
            const grammarContent = await appAgent.getDynamicGrammar(
                sessionContext,
                schemaName,
            );
            if (grammarContent?.content?.trim()) {
                if (grammarContent.format === "ag") {
                    dynamicGrammar = grammarFromJson(
                        JSON.parse(grammarContent.content),
                    );
                } else {
                    // "agr" format — raw grammar rule text
                    const errors: string[] = [];
                    dynamicGrammar =
                        loadGrammarRulesNoThrow(
                            `${schemaName}-dynamic.agr`,
                            grammarContent.content,
                            errors,
                        ) ?? undefined;
                    if (errors.length > 0) {
                        debugError(
                            `Failed to parse dynamic grammar for ${schemaName}: ${errors.join(", ")}`,
                        );
                    }
                }
            }
        }

        // Fallback: read grammar/dynamic.agr from instance storage.
        //
        // Only for agents that do NOT implement getDynamicGrammar. An agent that
        // implements the callback is authoritative about which of its schemas
        // get dynamic grammar (e.g. PowerShell returns rules for the root
        // "powershell" schema but undefined for its sub-schemas). Without this
        // guard, the shared per-agent grammar/dynamic.agr would be loaded into
        // every sub-schema too, so a flow's grammar would match under a
        // sub-schema (e.g. powershell.powershell-files) where the flow's action
        // schema does not exist — producing "Action schema not found".
        if (
            dynamicGrammar === undefined &&
            appAgent.getDynamicGrammar === undefined
        ) {
            const instanceStorage = sessionContext.instanceStorage;
            if (instanceStorage) {
                try {
                    const agrText = await instanceStorage.read(
                        "grammar/dynamic.agr",
                        "utf8",
                    );
                    if (agrText?.trim()) {
                        const errors: string[] = [];
                        dynamicGrammar =
                            loadGrammarRulesNoThrow(
                                `${schemaName}-dynamic.agr`,
                                agrText,
                                errors,
                            ) ?? undefined;
                        if (errors.length > 0) {
                            debugError(
                                `Failed to parse dynamic grammar for ${schemaName}: ${errors.join(", ")}`,
                            );
                        }
                    }
                } catch {
                    // No dynamic grammar file
                }
            }
        }

        if (!dynamicGrammar || dynamicGrammar.alternatives.length === 0) return;

        const config = this.actionConfigs.get(schemaName);
        const staticGrammar = config ? loadGrammar(config) : undefined;

        const merged: Grammar = {
            alternatives: [
                ...(staticGrammar?.alternatives ?? []),
                ...dynamicGrammar.alternatives,
            ],
        };

        context.agentCache.grammarStore.addGrammar(schemaName, merged);
        debug(
            `Loaded dynamic grammar for ${schemaName} (${dynamicGrammar.alternatives.length} dynamic rules merged with ${staticGrammar?.alternatives.length ?? 0} static rules)`,
        );
    }

    private async loadDynamicSchema(
        schemaName: string,
        appAgent: AppAgent,
        sessionContext: SessionContext,
        context: CommandHandlerContext,
    ): Promise<void> {
        if (!appAgent.getDynamicSchema) return;

        const schemaContent = await appAgent.getDynamicSchema(
            sessionContext,
            schemaName,
        );
        if (!schemaContent?.content) return;

        const config = this.actionConfigs.get(schemaName);
        if (!config) return;

        // Replace the schema content with the dynamic version
        config.schemaFile = schemaContent;

        // Invalidate cached parsed schema so it gets re-parsed from new content
        this.actionSchemaFileCache.unloadActionSchemaFile(schemaName);

        // Clear translator cache so next translation uses the updated schema
        context.translatorCache.clear();

        debug(`Loaded dynamic schema for ${schemaName}`);
    }

    private async updateAction(
        schemaName: string,
        record: AppAgentRecord,
        enable: boolean,
        context: CommandHandlerContext,
    ) {
        if (enable) {
            if (record.actions.has(schemaName)) {
                return;
            }

            record.actions.add(schemaName);
            try {
                const sessionContext = await this.ensureSessionContext(
                    record,
                    context,
                );
                await callEnsureError(() =>
                    record.appAgent!.updateAgentContext?.(
                        enable,
                        sessionContext,
                        schemaName,
                    ),
                );
                // Load dynamic schema and grammar from agent callbacks
                await this.loadDynamicSchema(
                    schemaName,
                    record.appAgent!,
                    sessionContext,
                    context,
                );
                await this.loadDynamicGrammar(
                    schemaName,
                    record.appAgent!,
                    sessionContext,
                    context,
                );
            } catch (e) {
                // Rollback if there is a exception
                record.actions.delete(schemaName);
                throw e;
            }
            debug(`Action enabled ${schemaName}`);
        } else {
            if (!record.actions.has(schemaName)) {
                return;
            }
            record.actions.delete(schemaName);
            const sessionContext = await record.sessionContextP!;
            try {
                await callEnsureError(() =>
                    record.appAgent!.updateAgentContext?.(
                        enable,
                        sessionContext,
                        schemaName,
                    ),
                );
            } finally {
                // Assume that it is disabled even when there is an exception
                debug(`Action disabled ${schemaName}`);
                await this.checkCloseSessionContext(record);
            }
        }
    }

    private async ensureSessionContext(
        record: AppAgentRecord,
        context: CommandHandlerContext,
    ) {
        if (record.sessionContextP === undefined) {
            record.sessionContextP = this.initializeSessionContext(
                record,
                context,
            );
        }

        return record.sessionContextP;
    }
    private async initializeSessionContext(
        record: AppAgentRecord,
        context: CommandHandlerContext,
    ) {
        // Generate the session-context lifetime id BEFORE we call into
        // the agent's initializeAgentContext: the agent may call
        // sessionContext.setLocalHostPort / registerPort during init
        // (the existing localView pattern does exactly this), and those
        // registrations need a sessionContextId to scope to. If init
        // throws, the catch block below releases anything that was
        // registered so we don't leak.
        const sessionContextId = randomUUID();
        record.sessionContextId = sessionContextId;
        let appAgent: AppAgent | undefined;
        let sessionContext: SessionContext | undefined;
        try {
            const loadedAppAgent = await this.ensureAppAgent(record);
            appAgent = loadedAppAgent;
            let agentContext: unknown | undefined;
            if (loadedAppAgent.initializeAgentContext !== undefined) {
                const options = this.agentInitOptions?.[record.name];
                let settings: AppAgentInitSettings | undefined = record.manifest
                    .localView
                    ? {
                          // Tell the agent to bind on an OS-assigned
                          // port; the agent then reports the actual
                          // port back via sessionContext.setLocalHostPort
                          // (now: PortRegistrar.register).
                          localHostPort: 0,
                      }
                    : undefined;

                if (options !== undefined) {
                    if (settings === undefined) {
                        settings = {};
                    }
                    settings.options = options;
                }
                agentContext = await callEnsureError(() =>
                    loadedAppAgent.initializeAgentContext!(settings),
                );
            }
            sessionContext = createSessionContext(
                record.name,
                agentContext,
                context,
                record.manifest.allowDynamicAgents === true,
                sessionContextId,
            );
            record.sessionContext = sessionContext;

            debug(`Session context created for ${record.name}`);

            if (loadedAppAgent.startBackgroundTasks !== undefined) {
                await callEnsureError(() =>
                    loadedAppAgent.startBackgroundTasks!(sessionContext!),
                );
                debug(`Background tasks started for ${record.name}`);
            }

            // Initial readiness probe. Cheap if implemented; no-op if not.
            // Errors become a "setup-required" entry rather than crashing
            // the agent — a misbehaving checkReadiness shouldn't deny the
            // user the agent.
            if (loadedAppAgent.checkReadiness !== undefined) {
                this.readinessImplementers.add(record.name);
                try {
                    const report =
                        await loadedAppAgent.checkReadiness(sessionContext);
                    this.readiness.set(record.name, report);
                    debug(
                        `Readiness for ${record.name}: ${report.state}` +
                            (report.message ? ` (${report.message})` : ""),
                    );
                } catch (e: any) {
                    this.readiness.set(record.name, {
                        state: "setup-required",
                        message: `checkReadiness threw: ${e?.message ?? String(e)}`,
                    });
                }
            }
            return sessionContext;
        } catch (e) {
            // A newer initialization may already have replaced this attempt.
            // Clear shared state only while this lifetime still owns it.
            if (record.sessionContextId === sessionContextId) {
                record.sessionContext = undefined;
                if (sessionContext !== undefined) {
                    record.sessionContextP = undefined;
                }
                record.sessionContextId = undefined;
            }
            if (sessionContext !== undefined && appAgent !== undefined) {
                if (appAgent.stopBackgroundTasks !== undefined) {
                    try {
                        await appAgent.stopBackgroundTasks(sessionContext);
                    } catch (rollbackError) {
                        debugError(
                            `stopBackgroundTasks failed while rolling back ${record.name}. Error ignored`,
                            rollbackError,
                        );
                    }
                }
                try {
                    await appAgent.closeAgentContext?.(sessionContext);
                } catch (rollbackError) {
                    debugError(
                        `closeAgentContext failed while rolling back ${record.name}. Error ignored`,
                        rollbackError,
                    );
                }
            }
            try {
                this.portRegistrar.releaseAllForSession(sessionContextId);
            } catch (rollbackError) {
                debugError(
                    `Port cleanup failed while rolling back ${record.name}. Error ignored`,
                    rollbackError,
                );
            }
            throw e;
        }
    }

    private async checkCloseSessionContext(record: AppAgentRecord) {
        if (record.actions.size === 0 && !record.commands) {
            await this.closeSessionContext(record);
        }
    }
    private async closeSessionContext(record: AppAgentRecord) {
        if (record.sessionContextP === undefined) {
            return;
        }
        // Snapshot + clear up front so a re-entrant ensureSessionContext
        // call (e.g. from inside an agent's closeAgentContext) gets a
        // fresh init rather than racing with this teardown.
        const sessionContextP = record.sessionContextP;
        const sessionContextId = record.sessionContextId;
        record.sessionContext = undefined;
        record.sessionContextP = undefined;
        record.sessionContextId = undefined;
        // Preserve the cached readiness entry across disable/enable. The
        // last probe is the best information we have until the agent is
        // re-enabled and re-probed; dropping it would force every
        // disable cycle to show "(?)" in `@config agent` for a fact we
        // already know. The next initializeSessionContext overwrites the
        // entry with a fresh probe anyway, so staleness is bounded to
        // the disabled window.
        try {
            const sessionContext = await sessionContextP;
            // Since we have a session context, appAgent must be defined as well.
            const appAgent = record.appAgent!;
            // Stop background work first so it can't race against teardown
            // by emitting agent-initiated messages or touching state we're
            // about to dispose. Errors here are isolated from the rest of
            // the teardown path so a misbehaving agent can't block close.
            if (appAgent.stopBackgroundTasks !== undefined) {
                try {
                    await appAgent.stopBackgroundTasks(sessionContext);
                    debug(`Background tasks stopped for ${record.name}`);
                } catch (e) {
                    debugError(
                        `stopBackgroundTasks failed for ${record.name}. Error ignored`,
                        e,
                    );
                }
            }
            if (appAgent.updateAgentContext !== undefined) {
                // Disable all actions first.
                for (const action of record.actions) {
                    await appAgent.updateAgentContext(
                        false,
                        sessionContext,
                        action,
                    );
                }
            }
            await appAgent.closeAgentContext?.(sessionContext);
            // TODO: unload agent as well?
            debug(`Session context closed for ${record.name}`);
        } catch (e) {
            debugError(
                `Failed to close session context for ${record.name}. Error ignored`,
                e,
            );
            // Ignore error
        } finally {
            // Backstop: release any ports the agent registered but
            // forgot to release. Runs even if sessionContextP rejected
            // (partial init may have registered before throwing) and
            // even if closeAgentContext threw.
            if (sessionContextId !== undefined) {
                const released =
                    this.portRegistrar.releaseAllForSession(sessionContextId);
                if (released > 0) {
                    debug(
                        `Backstop released ${released} forgotten port allocation(s) for ${record.name}`,
                    );
                }
            }
        }
    }

    private async ensureAppAgent(record: AppAgentRecord) {
        if (record.appAgent === undefined) {
            if (record.provider === undefined) {
                throw new Error(
                    `Internal error: no provider to load the app agent: ${record.name}`,
                );
            }
            const start = performance.now();
            record.appAgent = await record.provider.loadAppAgent(record.name);
            debugLoad(
                `App agent loaded: ${record.name} (${(performance.now() - start).toFixed(0)}ms)`,
            );
        }
        return record.appAgent;
    }

    private getRecord(appAgentName: string) {
        const record = this.agents.get(appAgentName);
        if (record === undefined) {
            throw new Error(`Unknown app agent: ${appAgentName}`);
        }
        return record;
    }

    public tryGetActionSchemaFile(schemaName: string) {
        const config = this.tryGetActionConfig(schemaName);
        if (config === undefined) {
            return undefined;
        }
        return this.getActionSchemaFileForConfig(config);
    }

    public getActionSchemaFileForConfig(
        config: ActionConfig,
    ): ActionSchemaFile {
        return this.actionSchemaFileCache.getActionSchemaFile(config);
    }

    public async reloadAgentSchema(
        appAgentName: string,
        context: CommandHandlerContext,
    ): Promise<void> {
        const record = this.getRecord(appAgentName);
        if (record.provider === undefined) {
            return;
        }

        // Unload cached schema files and semantic map entries so they get reloaded
        for (const schemaName of this.actionConfigs.keys()) {
            if (getAppAgentName(schemaName) === appAgentName) {
                this.actionSchemaFileCache.unloadActionSchemaFile(schemaName);
                this.actionSemanticMap?.removeActionSchemaFile(schemaName);
            }
        }

        // Get fresh manifest from provider and refresh schemas
        const manifest =
            await record.provider.getAppAgentManifest(appAgentName);
        const semanticMapP: Promise<void>[] = [];
        this.refreshAgentSchema(
            appAgentName,
            manifest,
            semanticMapP,
            undefined,
        );
        await Promise.all(semanticMapP);

        // Reload dynamic schemas and grammars if agent is active
        if (record.appAgent && record.sessionContextP) {
            const sessionContext = await record.sessionContextP;
            for (const schemaName of record.actions) {
                await this.loadDynamicSchema(
                    schemaName,
                    record.appAgent,
                    sessionContext,
                    context,
                );
                await this.loadDynamicGrammar(
                    schemaName,
                    record.appAgent,
                    sessionContext,
                    context,
                );
            }
        }

        // Clear translator cache to force re-translation with new schema
        context.translatorCache.clear();
        // Drop cached derived keyword vectors for this agent's schemas so the
        // contextSelector re-extracts from the reloaded (possibly changed)
        // schema text instead of scoring against stale keywords.
        context.contextSelectorKeywords.invalidate(appAgentName);

        // Drop construction-cache entries whose schema hash no longer matches
        // the reloaded schema (e.g. constructions for a deleted or edited flow),
        // so a stale cached match can't resolve to a now-missing action.
        try {
            await context.agentCache.prune();
        } catch (e) {
            debugError(
                `Failed to prune construction cache after reloading ${appAgentName}: ${e}`,
            );
        }
    }

    public setTraceNamespaces(namespaces: string) {
        const providers = new Set<AppAgentProvider>();
        for (const { provider } of this.agents.values()) {
            if (provider === undefined || providers.has(provider)) {
                continue;
            }
            provider.setTraceNamespaces?.(namespaces);
            providers.add(provider);
        }
    }
}

export type AppAgentStateInitSettings =
    | string[]
    | boolean
    | undefined
    | {
          schemas?: string[] | boolean | undefined;
          actions?: string[] | boolean | undefined;
          commands?: string[] | boolean | undefined;
      };

export function getAppAgentStateSettings(
    settings: AppAgentStateInitSettings,
    agents: AppAgentManager,
): AppAgentStateSettings | undefined {
    if (settings === undefined) {
        return undefined;
    }
    const result: AppAgentStateSettings = {};
    if (typeof settings === "boolean" || Array.isArray(settings)) {
        for (const key of appAgentStateKeys) {
            const names =
                key === "commands"
                    ? agents.getAppAgentNames()
                    : agents.getSchemaNames();
            const entries = names.map((name) => [
                name,
                typeof settings === "boolean"
                    ? settings
                    : settings.includes(getAppAgentName(name)),
            ]);
            const state = Object.fromEntries(entries);
            for (const name of alwaysEnabledAgents[key]) {
                if (state[name] === false) {
                    state[name] = true;
                }
            }
            result[key] = state;
        }
        return result;
    }
    for (const key of appAgentStateKeys) {
        const state = settings[key];
        if (state === undefined) {
            continue;
        }
        const alwaysEnabled = alwaysEnabledAgents[key];
        const names =
            key === "commands"
                ? agents.getAppAgentNames()
                : agents.getSchemaNames();
        const entries = names.map((name) => [
            name,
            alwaysEnabled.includes(name)
                ? true
                : typeof state === "boolean"
                  ? state
                  : state.includes(name),
        ]);
        result[key] = Object.fromEntries(entries);
    }
    return Object.keys(result).length === 0 ? undefined : result;
}
