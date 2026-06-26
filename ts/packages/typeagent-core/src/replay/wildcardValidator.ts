// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Wildcard-match validation for the replay path (fidelity rung "L4a").
 *
 * The dispatcher's only beyond-grammar determinism is a post-match step: for
 * each candidate match that captured a wildcard, it calls the agent's
 * `validateWildcardMatch(action, sessionContext)` and DROPS the match if the
 * agent returns `false` (then falls back to a lower-ranked match or the LLM).
 * See `dispatcher/.../translation/matchRequest.ts` `getValidatedMatches`.
 *
 * Grammar matching alone cannot reproduce this, so a `.agr` that still matches
 * an utterance can look unchanged in replay even though the real dispatcher
 * would reject the wildcard value. This module runs the agent's REAL validator
 * so that fidelity axis shows up in the Impact Report.
 *
 * ## Scope & honesty (deliberate, see `files/replay-l4a-design.md`)
 * - **Working-tree side only.** Loading arbitrary git-ref agent code is L4b
 *   build machinery; the caller never runs this for a git ref.
 * - **Built module.** {@link ReplayAppAgentLoader.loadAppAgent} returns the
 *   agent's BUILT module, so uncommitted validator `.ts` edits are reflected
 *   only after a rebuild (grammar edits — the usual regression experiment — are
 *   already read from source by the grammar resolver).
 * - **Fail-OPEN.** Only an explicit `=== false` from the agent rejects a match.
 *   A missing method / load failure / thrown validator / non-allowlisted agent
 *   all ACCEPT the match and record a diagnostic — replay must never fabricate a
 *   lost match from infrastructure noise.
 * - **Allowlist.** Only validators known to be deterministic + side-effect-free
 *   run by default ({@link DEFAULT_WILDCARD_VALIDATION_ALLOWLIST}); e.g.
 *   `weather`'s validator does live network geocoding and is intentionally
 *   excluded.
 * - **Entity-wildcard validation is out of scope** (it needs conversation
 *   memory replay does not have).
 */

/**
 * Minimal structural view of an app agent for wildcard validation. Typed
 * structurally (rather than importing `@typeagent/agent-sdk`) so the
 * dependency-light core package does not take on the agent SDK; the real
 * `AppAgent.validateWildcardMatch` satisfies this shape.
 */
export interface ReplayValidatableAgent {
    validateWildcardMatch?(
        action: unknown,
        context: unknown,
    ): Promise<boolean> | boolean;
}

/**
 * Loads (and optionally unloads) a built app-agent module by name. The default
 * production implementation wraps the dispatcher's `getDefaultAppAgentProviders`
 * (which lives outside this dependency-light package), so the loader is injected
 * by the host. Tests inject a fake.
 */
export interface ReplayAppAgentLoader {
    loadAppAgent(agentName: string): Promise<ReplayValidatableAgent>;
    /** Best-effort cleanup; many agents default to `execMode: "separate"`. */
    unloadAppAgent?(agentName: string): Promise<void>;
}

/**
 * Why a match was accepted without a genuine `validateWildcardMatch === false`
 * verdict — recorded so the run can honestly report that validation degraded.
 */
export type WildcardValidationDiagnostic =
    | "agent-not-in-allowlist"
    | "no-validator"
    | "load-failed"
    | "errored";

export interface WildcardValidationOutcome {
    /** True ONLY when the agent's validator returned an explicit `false`. */
    rejected: boolean;
    /** Set when the verdict was fail-open rather than a real validator result. */
    diagnostic?: WildcardValidationDiagnostic;
}

export interface WildcardMatchValidator {
    /**
     * Run the agent's validator over every action in one candidate match,
     * mirroring the dispatcher's `validateWildcardMatch`: reject as soon as any
     * action's validator returns `false`; otherwise accept. Fail-open on any
     * error (records a diagnostic, returns `rejected: false`).
     */
    validateMatch(
        actions: readonly unknown[],
    ): Promise<WildcardValidationOutcome>;
    /** Whether the agent module was actually loaded (drives unload + reporting). */
    readonly loaded: boolean;
    /** All fail-open reasons seen this run (for the run-level summary/tooltip). */
    readonly diagnostics: ReadonlySet<WildcardValidationDiagnostic>;
    /** Best-effort `unloadAppAgent`; safe to call when nothing was loaded. */
    dispose(): Promise<void>;
}

/**
 * Agents whose `validateWildcardMatch` is a pure/deterministic function of the
 * action (no network, no external process, no live session state):
 * - `timer` — `tryParseWhen` on the action params; context ignored.
 * - `list` — `simpleNoun` heuristic over the action; context ignored.
 * - `player` — reads `context.agentContext.spotify`, but returns `true` when it
 *   is absent (our stub context has none), faithfully self-degrading like a
 *   dispatcher session with no Spotify login.
 *
 * `weather`/`markdown`/`photo`/`androidMobile`/`taskflow`/`powershell` are NOT
 * here: weather geocodes over the network, and the others are unverified.
 */
export const DEFAULT_WILDCARD_VALIDATION_ALLOWLIST: readonly string[] = [
    "timer",
    "list",
    "player",
];

export interface CreateWildcardMatchValidatorOptions {
    loader: ReplayAppAgentLoader;
    /** Defaults to {@link DEFAULT_WILDCARD_VALIDATION_ALLOWLIST}. */
    allowlist?: readonly string[];
}

/**
 * A no-op `SessionContext`-shaped stub for replay validation. The few validators
 * we allowlist either ignore the context (timer/list) or read only
 * `agentContext` (player, which self-degrades when its client is absent). The
 * object exposes `agentContext: {}` — NOT `undefined`, which would make
 * `player`'s `context.agentContext.spotify` throw before its fallback — and the
 * interactive methods throw, since a validator that calls them is out of the
 * supported set and should fail-open via the wrapper's try/catch.
 */
export function createReplaySessionContextStub(): Record<string, unknown> {
    const unsupported = (name: string) => () => {
        throw new Error(
            `SessionContext.${name} is not available during replay wildcard validation`,
        );
    };
    return {
        agentContext: {},
        sessionStorage: undefined,
        instanceStorage: undefined,
        sessionContextId: "studio-replay-validation",
        notify: () => {},
        beginAgentThread: unsupported("beginAgentThread"),
        popupQuestion: unsupported("popupQuestion"),
        toggleTransientAgent: unsupported("toggleTransientAgent"),
        addDynamicAgent: unsupported("addDynamicAgent"),
        removeDynamicAgent: unsupported("removeDynamicAgent"),
        forceCleanupDynamicAgent: unsupported("forceCleanupDynamicAgent"),
        reloadAgentSchema: unsupported("reloadAgentSchema"),
    };
}

/** Pull the `action` payloads out of a grammar match's `actions` array. */
export function matchActionPayloads(actions: readonly unknown[]): unknown[] {
    return actions.map((a) =>
        a !== null && typeof a === "object" && "action" in a
            ? (a as { action: unknown }).action
            : a,
    );
}

/**
 * Build a {@link WildcardMatchValidator} for one agent. The agent module is
 * loaded lazily on the first {@link WildcardMatchValidator.validateMatch} that
 * actually needs it (so a run that never hits a wildcard match never loads the
 * module), then cached for the rest of the run.
 */
export function createWildcardMatchValidator(
    agentName: string,
    options: CreateWildcardMatchValidatorOptions,
): WildcardMatchValidator {
    const { loader } = options;
    const allowlist =
        options.allowlist ?? DEFAULT_WILDCARD_VALIDATION_ALLOWLIST;
    const allowed = allowlist.includes(agentName);
    const diagnostics = new Set<WildcardValidationDiagnostic>();
    const stubContext = createReplaySessionContextStub();

    // null = not loaded yet; { agent } once a load attempt resolved (agent may
    // be undefined when the load failed, so we never retry a failed load).
    let loadState: { agent: ReplayValidatableAgent | undefined } | undefined;
    let didLoad = false;

    async function ensureAgent(): Promise<ReplayValidatableAgent | undefined> {
        if (loadState !== undefined) {
            return loadState.agent;
        }
        try {
            const agent = await loader.loadAppAgent(agentName);
            didLoad = true;
            loadState = { agent };
            return agent;
        } catch {
            diagnostics.add("load-failed");
            loadState = { agent: undefined };
            return undefined;
        }
    }

    function note(d: WildcardValidationDiagnostic): WildcardValidationOutcome {
        diagnostics.add(d);
        return { rejected: false, diagnostic: d };
    }

    return {
        get loaded(): boolean {
            return didLoad;
        },
        get diagnostics(): ReadonlySet<WildcardValidationDiagnostic> {
            return diagnostics;
        },

        async validateMatch(actions): Promise<WildcardValidationOutcome> {
            if (!allowed) {
                return note("agent-not-in-allowlist");
            }
            const agent = await ensureAgent();
            if (agent === undefined) {
                return { rejected: false, diagnostic: "load-failed" };
            }
            if (typeof agent.validateWildcardMatch !== "function") {
                return note("no-validator");
            }
            for (const action of matchActionPayloads(actions)) {
                let verdict: boolean;
                try {
                    verdict = await agent.validateWildcardMatch(
                        action,
                        stubContext,
                    );
                } catch {
                    // Fail-open: a throwing validator must never fabricate a
                    // lost match. Record it and accept.
                    diagnostics.add("errored");
                    continue;
                }
                if (verdict === false) {
                    return { rejected: true };
                }
            }
            return { rejected: false };
        },

        async dispose(): Promise<void> {
            if (!didLoad || loader.unloadAppAgent === undefined) {
                return;
            }
            try {
                await loader.unloadAppAgent(agentName);
            } catch {
                // Best-effort cleanup.
            }
        },
    };
}
