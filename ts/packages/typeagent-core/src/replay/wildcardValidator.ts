// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Wildcard-match validation for the replay path.
 *
 * The dispatcher's only beyond-grammar determinism is a post-match step: for
 * each candidate match that captured a wildcard, it calls the agent's
 * `validateWildcardMatch(action, sessionContext)` and DROPS the match if the
 * agent returns `false` (then falls back to a lower-ranked match or the LLM).
 *
 * Grammar matching alone cannot reproduce this, so a `.agr` that still matches
 * an utterance can look unchanged in replay even though the real dispatcher
 * would reject the wildcard value. This module runs the agent's REAL validator
 * so that axis shows up in the Impact Report.
 *
 * Scope and guarantees:
 * - **Working-tree side only.** The caller never runs this for a git ref.
 * - **Built module.** {@link ReplayAppAgentLoader.loadAppAgent} returns the
 *   agent's BUILT module, so uncommitted validator `.ts` edits are reflected
 *   only after a rebuild (grammar edits are read from source by the grammar
 *   resolver).
 * - **Fail-OPEN.** Only an explicit `=== false` from the agent rejects a match.
 *   A missing method, load failure, or thrown validator all ACCEPT the match and
 *   record a diagnostic — replay must never fabricate a lost match from
 *   infrastructure noise.
 * - **Entity-wildcard validation is out of scope** (it needs conversation
 *   memory replay does not have).
 *
 * Which agents run here is decided by the host, not this module: the host only
 * builds a validator for agents that declare they are replay-safe. This module
 * always loads and runs the validator it is asked to build.
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

export interface CreateWildcardMatchValidatorOptions {
    loader: ReplayAppAgentLoader;
}

/**
 * A no-op `SessionContext`-shaped stub for replay validation. Deterministic
 * validators ignore the context entirely; the stub still exposes
 * `agentContext: {}` — NOT `undefined` — so that any in-process validator that
 * defensively reads `context.agentContext.<x>` degrades gracefully instead of
 * throwing. The interactive methods throw, since a validator that calls them is
 * out of the supported set and should fail-open via the wrapper's try/catch.
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
