// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AppAction, ActionResult, TypeAgentAction } from "./action.js";
import { AppAgentCommandInterface } from "./command.js";
import {
    ActionIO,
    DisplayType,
    DynamicDisplay,
    DisplayContent,
    DisplayAppendMode,
} from "./display.js";
import { Entity } from "./memory.js";
import { Profiler } from "./profiler.js";
import { TemplateSchema } from "./templateInput.js";

//==============================================================================
// Indexing Service Types
//==============================================================================
export type IndexingServiceConfig = {
    serviceScript: string;
    description?: string;
};

export type IndexingServicesManifest = Record<string, IndexingServiceConfig>;

// if "separate", each activity is cache separately, or if "shared", it will share the cache with as if no activity is active.
// If true, default to "separate".
// If false, cache is disabled.
export type ActivityCacheSpec = "separate" | "shared" | boolean;

//==============================================================================
// Manifest
//==============================================================================
export type AppAgentManifest = {
    emojiChar: string;
    description: string;
    commandDefaultEnabled?: boolean;
    localView?: boolean; // whether the agent serve a local view, default is false
    sharedLocalView?: string[]; // list of agents to share the local view with, default is none
    indexingServices?: IndexingServicesManifest;
    cachedActivities?: Record<string, ActivityCacheSpec>; // Key is activity name, default (if not specified) is false
    // Registered flow programs: actionName → path to .flow.json (relative to manifest file)
    flows?: Record<string, string>;
    allowDynamicAgents?: boolean; // whether this agent can add/remove dynamic sub-agents at runtime, default is false
} & ActionManifest;

export type SchemaTypeNames = {
    action?: string;
    activity?: string;
    entities?: string;
};

export type SchemaFormat = "ts" | "pas";
export type GrammarFormat = "ag" | "agr";

export type SchemaContent = {
    format: SchemaFormat;
    // TODO: enable non-stringify pas content.
    content: string;
    config?: string | undefined; // for "ts" only
};
export type GrammarContent = { format: GrammarFormat; content: string };

export type SchemaManifest = {
    description: string;
    schemaType: string | SchemaTypeNames; // string if there are only action schemas
    schemaFile: string | SchemaContent; // path relative to the manifest file (resolved to absolute at load time)
    originalSchemaFile?: string; // path to the original .ts schema source for code paths not yet converted to use .pas format (relative to the manifest file)
    grammarFile?: string | GrammarContent; // path relative to the manifest file (resolved to absolute at load time)
    injected?: boolean; // whether the translator is injected into other domains, default is false
    cached?: boolean; // whether the translator's action should be cached, default is true
    streamingActions?: string[];
};

export type ActionManifest = {
    defaultEnabled?: boolean;
    schemaDefaultEnabled?: boolean;
    actionDefaultEnabled?: boolean;
    transient?: boolean; // whether the translator is transient, default is false
    errorReasoning?: boolean; // invoke reasoning on action error, default is false

    schema?: SchemaManifest;
    subActionManifests?: { [key: string]: ActionManifest };
};

//==============================================================================
// App Agent
//==============================================================================

export type AppAgentInitSettings = {
    localHostPort?: number; // the assigned port to use to serve the view if localHostPort is true in the manifest
    options?: unknown; // additional options specific for the agent initialization
};

export type ResolveEntityResult = {
    match: "exact" | "fuzzy";
    entities: Entity[];
};

// Reports whether an agent is set up and able to execute actions/commands.
// Cached by the dispatcher; refreshed on enable, after `setup` runs, and on
// explicit `@config agent refresh`. Agents that don't implement
// `checkReadiness` are treated as `ready`.
//
// State semantics:
//   "ready"          — actions/commands can run normally
//   "setup-required" — actions/commands are blocked; pre-flight either
//                      surfaces the message or (when setupOnFirstUse is on)
//                      offers to run `setup`
//   "unsupported"    — actions/commands are permanently blocked on this
//                      machine (e.g. macOS for osNotifications). `setup` is
//                      not offered.
export type ReadinessState = "ready" | "setup-required" | "unsupported";

export type ReadinessReport = {
    state: ReadinessState;
    // One-line reason. Shown next to the agent in `@config agent` listings
    // and in pre-flight error messages. Required when state is anything
    // other than "ready".
    message?: string;
    // Optional longer explanation (markdown OK). Shown in per-agent detail
    // views and could include hyperlinks to relevant docs / portals.
    details?: string;
};

export interface AppAgent extends Partial<AppAgentCommandInterface> {
    // Setup
    initializeAgentContext?(settings?: AppAgentInitSettings): Promise<unknown>;
    updateAgentContext?(
        enable: boolean,
        context: SessionContext,
        schemaName: string, // for sub-action schemas
    ): Promise<void>;
    closeAgentContext?(context: SessionContext): Promise<void>;

    // Readiness — the agent reports whether it's set up and ready to execute
    // actions/commands. The dispatcher pre-flights this immediately before
    // calling executeAction / executeCommand. Agents that don't implement
    // are treated as `ready`. See ReadinessReport for state semantics.
    //
    // checkReadiness should be CHEAP (file-existence / env-var read level).
    // Expensive probes (network, child processes) belong in `setup`.
    checkReadiness?(context: SessionContext<unknown>): Promise<ReadinessReport>;

    // Idempotent setup that brings the agent from `setup-required` to `ready`.
    // Returns ActionResult so it can use the in-chat yes/no card pattern
    // (createYesNoChoiceResult) for confirmation, progress display, etc.
    // After setup runs (success or failure), the dispatcher re-calls
    // checkReadiness to update the cached state — agents don't get to
    // self-report readiness.
    setup?(context: ActionContext<unknown>): Promise<ActionResult | undefined>;

    // Background lifecycle for agent-initiated work (timers, watchers,
    // external-event subscriptions). startBackgroundTasks runs once per
    // session, after initializeAgentContext succeeds and before the first
    // updateAgentContext call. stopBackgroundTasks runs once at session
    // teardown, before any updateAgentContext(false, ...) calls and before
    // closeAgentContext.
    startBackgroundTasks?(context: SessionContext): Promise<void>;
    stopBackgroundTasks?(context: SessionContext): Promise<void>;

    // Actions
    streamPartialAction?(
        actionName: string,
        name: string,
        value: string,
        delta: string | undefined,
        context: ActionContext<unknown>,
    ): void;
    executeAction?(
        action: TypeAgentAction,
        context: ActionContext<unknown>,
    ): Promise<ActionResult | undefined>;

    // Choice (yes/no confirmation or multi-select)
    handleChoice?(
        choiceId: string,
        response: boolean | number[],
        context: ActionContext<unknown>,
    ): Promise<ActionResult | undefined>;

    // Cache extensions
    validateWildcardMatch?(
        action: AppAction,
        context: SessionContext,
    ): Promise<boolean>;

    // Input
    resolveEntity?(
        type: string,
        name: string,
        context: SessionContext,
    ): Promise<ResolveEntityResult | undefined>;
    getTemplateSchema?(
        templateName: string,
        data: unknown,
        context: SessionContext,
    ): Promise<TemplateSchema>;
    getTemplateCompletion?(
        templateName: string,
        data: unknown,
        propertyName: string,
        context: SessionContext,
    ): Promise<string[] | undefined>;
    // For action completion (template, request/action command  completion)
    getActionCompletion?(
        context: SessionContext,
        partialAction: AppAction, // action schemaName and actionName are validated by the dispatcher.
        propertyName: string,
        entityTypeName?: string, // the type of the entity if the property is an entity
    ): Promise<string[] | undefined>;
    // Output
    getDynamicDisplay?(
        type: DisplayType,
        dynamicDisplayId: string,
        context: SessionContext,
    ): Promise<DynamicDisplay>;

    // Dynamic schema/grammar — allows agents to modify their schema and grammar at runtime.
    // Called by the dispatcher during updateAgentContext and when the agent calls reloadAgentSchema().
    getDynamicSchema?(
        context: SessionContext,
        schemaName: string,
    ): Promise<SchemaContent | undefined>;
    getDynamicGrammar?(
        context: SessionContext,
        schemaName: string,
    ): Promise<GrammarContent | undefined>;
}

//==============================================================================
// Context
//==============================================================================
export enum AppAgentEvent {
    Error = "error",
    Warning = "warning",
    Info = "info",
    Debug = "debug",

    // Display-focused events
    Toast = "toast",
    Inline = "inline",
}

// Render style for agent-initiated messages (messages not paired with a user
// request). Selected per-message via SessionContext.beginAgentThread().
export type AgentMessageKind = "bubble" | "toast" | "inline";

// Handle returned by SessionContext.beginAgentThread(). Lets an agent push
// display content into the UI without a preceding user request.
//
// Lifetime: setDisplay/appendDisplay can be called any number of times. After
// complete() the handle is finished — call beginAgentThread() again to start
// a new thread.
export interface AgentThreadHandle {
    readonly kind: AgentMessageKind;
    setDisplay(content: DisplayContent): void;
    appendDisplay(content: DisplayContent, mode?: DisplayAppendMode): void;
    complete(): void;
}

export interface SessionContext<T = unknown> {
    readonly agentContext: T;
    readonly sessionStorage: Storage | undefined;
    readonly instanceStorage: Storage | undefined; // storage that are preserved across sessions

    notify(
        event: AppAgentEvent,
        message: string | DisplayContent,
        notificationId?: string,
    ): void;

    // Begin an agent-initiated message thread. The returned handle can push
    // display content (setDisplay/appendDisplay) into the UI without a
    // preceding user request. Each call mints a fresh clientRequestId of the
    // form "agent-<agentName>-<uuid>".
    beginAgentThread(kind: AgentMessageKind): AgentThreadHandle;

    // choices default to ["Yes", "No"]
    popupQuestion(
        message: string,
        choices?: string[],
        defaultId?: number,
    ): Promise<number>;

    // can only toggle the sub agent of the current agent
    toggleTransientAgent(agentName: string, active: boolean): Promise<void>;

    // Only for selected agents (browser) can dynamically add agent. Throw if not permitted.
    addDynamicAgent(
        agentName: string,
        manifest: AppAgentManifest,
        appAgent: AppAgent,
    ): Promise<void>;

    removeDynamicAgent(agentName: string): Promise<void>;

    forceCleanupDynamicAgent(agentName: string): Promise<void>;

    // Notify the dispatcher that this agent's schema and/or grammar has changed.
    // The dispatcher will call getDynamicSchema/getDynamicGrammar to get the updated content.
    reloadAgentSchema(): Promise<void>;

    // Experimental: get the shared local host port
    getSharedLocalHostPort(agentName: string): Promise<number>;

    // Experimental: update this agent's bound local host port (used after OS port assignment)
    setLocalHostPort(port: number): void;

    // Experimental: get the available indexes
    indexes(type: "image" | "email" | "website" | "all"): Promise<any[]>;

    // Validate grammar patterns before creating a workflow.
    // Tests patterns for quality and collisions against all registered agents.
    validateGrammarPatterns?(
        request: GrammarValidationRequest,
    ): Promise<GrammarValidationResult>;
}

// TODO: only utf8 & base64 is supported for now.
export type StorageEncoding = "utf8" | "base64";

export type StorageListOptions = {
    dirs?: boolean;
    fullPath?: boolean;
};

export interface TokenCachePersistence {
    load(): Promise<string | null>;
    save(token: string): Promise<void>;
    delete(): Promise<boolean>;
}

export interface Storage {
    read(storagePath: string): Promise<Uint8Array>;
    read(storagePath: string, options: StorageEncoding): Promise<string>;
    write(
        storagePath: string,
        data: string,
        options?: StorageEncoding, // default is utf8
    ): Promise<void>;
    write(storagePath: string, data: Uint8Array): Promise<void>;
    list(storagePath: string, options?: StorageListOptions): Promise<string[]>;
    exists(storagePath: string): Promise<boolean>;
    delete(storagePath: string): Promise<void>;

    getTokenCachePersistence(): Promise<TokenCachePersistence>;
}

export type ActivityContext<T = Record<string, unknown>> = {
    appAgentName: string;
    activityName: string;
    description: string;
    state: T;
    openLocalView?: boolean | undefined;
    activityEndAction?: AppAction | undefined;
    restricted?: boolean | undefined; // restrict the actions to this specific agent, default is false
};

export interface ActionContext<T = void> {
    profiler?: Profiler | undefined;
    streamingContext: unknown;
    readonly activityContext: ActivityContext | undefined;
    readonly actionIO: ActionIO;
    readonly sessionContext: SessionContext<T>;
    readonly abortSignal?: AbortSignal | undefined;

    // true when this action was dispatched from within the reasoning loop (via MCP execute_action),
    // false when dispatched directly from the translator. Agents can use this to decide whether
    // to execute immediately or redirect back to the reasoning loop.
    readonly isFromReasoningLoop: boolean;

    // queue up toggle transient agent to be executed at the end of the commands
    queueToggleTransientAgent(
        agentName: string,
        active: boolean,
    ): Promise<void>;
}

//==============================================================================
// Grammar Validation Types
//==============================================================================

/**
 * Request for grammar pattern validation before creating a workflow.
 */
export type GrammarValidationRequest = {
    /** Name of the action being created */
    actionName: string;
    /** Description of what the action does */
    description: string;
    /** Grammar patterns to validate (AGR format patterns) */
    patterns: string[];
    /** Optional: Parameter definitions for context */
    parameters?: Record<
        string,
        {
            type: string;
            required: boolean;
            description: string;
            default?: unknown;
        }
    >;
};

/**
 * Result of grammar pattern validation.
 */
export type GrammarValidationResult = {
    /** Whether patterns are approved for use */
    approved: boolean;
    /** Refined/improved patterns (use these if provided) */
    patterns?: string[];
    /** Non-blocking warnings */
    warnings?: string[];
    /** Blocking errors (why approval failed) */
    errors?: string[];
    /** Suggestions for improvement */
    suggestions?: string[];
    /** Pattern quality scores */
    qualityScores?: Array<{
        pattern: string;
        score: number; // 1-5
        reasoning: string;
    }>;
    /** Detected collisions */
    collisions?: Array<{
        pattern: string;
        collidingAgent: string;
        collidingAction: string;
        testUtterance: string;
        severity: "critical" | "warning" | "info";
    }>;
};
