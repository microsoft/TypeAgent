// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Onboarding-only dispatcher for TypeAgent Studio's "onboarding channelization"
 * (DESIGN.md §3.1/§3.5). The Studio service stands one of these up lazily on
 * first wizard use — "just like another sandbox" — loading ONLY the
 * `onboarding-agent` so there is little chance of action collision with other
 * agents.
 *
 * This module lives in `default-agent-provider` because that package already
 * depends on `agent-dispatcher`, `dispatcher-node-providers`, and
 * `onboarding-agent`; the Studio service reaches it through the same lazy
 * external dynamic import it already uses for wildcard validation, so no new
 * dependency or build cycle is introduced.
 *
 * The returned {@link OnboardingDispatcherHandle} exposes only plain,
 * serializable data (`submitUtterance` / `submitAction` → executed action
 * names + an optional error). That keeps the Studio service decoupled from the
 * dispatcher's types: the onboarding-specific knowledge (which sub-schema each
 * action belongs to, how to phrase an `@action` command) stays here, next to
 * the onboarding dependency.
 */

import { awaitCommand, createDispatcher } from "agent-dispatcher";
import type { CommandResult, Dispatcher } from "agent-dispatcher";
import { createNpmAppAgentProvider } from "dispatcher-node-providers";
import { silentClientIO } from "./collisions/silentClientIO.js";
import { ensureServiceKeysLoaded } from "./serviceKeys.js";

/** One executed action reported by the dispatcher. */
export interface OnboardingExecutedAction {
    actionName: string;
    schemaName?: string;
}

/** Plain-data outcome of a single dispatched command. */
export interface OnboardingDispatchResult {
    /** Actions the dispatcher executed for this command (may be empty). */
    actions: OnboardingExecutedAction[];
    /** Set when the command failed. */
    error?: string;
}

export interface OnboardingDispatcherHandle {
    /**
     * Translate + execute a natural-language utterance. Used by Discovery to
     * turn the user's description into a source action (crawl docs / parse
     * OpenAPI / crawl CLI help).
     */
    submitUtterance(text: string): Promise<OnboardingDispatchResult>;
    /**
     * Execute a known, typed onboarding action directly (no LLM translation).
     * Used by the deterministic phases 2–7.
     */
    submitAction(
        actionName: string,
        parameters: Record<string, unknown>,
    ): Promise<OnboardingDispatchResult>;
    /** Tear down the underlying dispatcher. */
    close(): Promise<void>;
}

export interface OnboardingOnlyDispatcherOptions {
    /** Host name for the dispatcher (telemetry/logging only). */
    hostName?: string;
}

/**
 * Maps each onboarding action name to the dispatcher schema that owns it. The
 * dispatcher keys sub-schemas by their PARENT-QUALIFIED name
 * (`<parent>.<subName>`, see `convertToActionConfig` in the dispatcher), so the
 * `subActionManifests` entries of `onboardingManifest.json` resolve as
 * `onboarding.onboarding-<phase>` — NOT the bare `onboarding-<phase>`. Using the
 * bare name makes `@action` throw "Invalid schema name". Used to form
 * `@action <schema> <actionName>` commands.
 */
const ACTION_SCHEMA: Readonly<Record<string, string>> = {
    // Top-level onboarding coordination (schema "onboarding"): these create /
    // resume / inspect the integration workspace that every phase action below
    // operates on. Discovery must run `startOnboarding` first (the phase
    // handlers fail with "Integration <name> not found" otherwise).
    startOnboarding: "onboarding",
    resumeOnboarding: "onboarding",
    getOnboardingStatus: "onboarding",
    listIntegrations: "onboarding",
    // Phase 1 — discovery
    crawlDocUrl: "onboarding.onboarding-discovery",
    parseOpenApiSpec: "onboarding.onboarding-discovery",
    crawlCliHelp: "onboarding.onboarding-discovery",
    listDiscoveredActions: "onboarding.onboarding-discovery",
    approveApiSurface: "onboarding.onboarding-discovery",
    // Phase 2 — phrase generation
    generatePhrases: "onboarding.onboarding-phrasegen",
    addPhrase: "onboarding.onboarding-phrasegen",
    removePhrase: "onboarding.onboarding-phrasegen",
    approvePhrases: "onboarding.onboarding-phrasegen",
    // Phase 3 — schema generation
    generateSchema: "onboarding.onboarding-schemagen",
    refineSchema: "onboarding.onboarding-schemagen",
    approveSchema: "onboarding.onboarding-schemagen",
    // Phase 4 — grammar generation
    generateGrammar: "onboarding.onboarding-grammargen",
    compileGrammar: "onboarding.onboarding-grammargen",
    approveGrammar: "onboarding.onboarding-grammargen",
    // Phase 5 — scaffolder
    scaffoldAgent: "onboarding.onboarding-scaffolder",
    scaffoldPlugin: "onboarding.onboarding-scaffolder",
    listTemplates: "onboarding.onboarding-scaffolder",
    listPatterns: "onboarding.onboarding-scaffolder",
    // Phase 6 — testing
    generateTests: "onboarding.onboarding-testing",
    runTests: "onboarding.onboarding-testing",
    getTestResults: "onboarding.onboarding-testing",
    proposeRepair: "onboarding.onboarding-testing",
    approveRepair: "onboarding.onboarding-testing",
    // Phase 7 — packaging
    packageAgent: "onboarding.onboarding-packaging",
    validatePackage: "onboarding.onboarding-packaging",
    generateReadme: "onboarding.onboarding-packaging",
    generateDemo: "onboarding.onboarding-packaging",
};

function toResult(result: CommandResult): OnboardingDispatchResult {
    const actions: OnboardingExecutedAction[] = (result.actions ?? []).map(
        (a) => {
            const raw = a as { actionName?: string; schemaName?: string };
            const executed: OnboardingExecutedAction = {
                actionName: raw.actionName ?? "unknown",
            };
            if (raw.schemaName !== undefined) {
                executed.schemaName = raw.schemaName;
            }
            return executed;
        },
    );
    const out: OnboardingDispatchResult = { actions };
    if (result.lastError !== undefined) {
        out.error = result.lastError;
    }
    return out;
}

/**
 * Build an onboarding-only dispatcher and return a plain-data handle over it.
 * Actions run in-process (`execMode: "dispatcher"`); translation is enabled
 * (Discovery needs it), while cache and explanation are off. Action
 * confirmation is disabled by default (`confirmActions: false`), so each phase
 * executes without a UI prompt.
 */
export async function createOnboardingOnlyDispatcher(
    options: OnboardingOnlyDispatcherOptions = {},
): Promise<OnboardingDispatcherHandle> {
    // Ensure LLM keys are in process.env before any dispatcher LLM client is
    // built (Discovery's NL translation needs them).
    ensureServiceKeysLoaded();

    const provider = createNpmAppAgentProvider(
        { onboarding: { name: "onboarding-agent", execMode: "dispatcher" } },
        import.meta.url,
    );

    const dispatcher: Dispatcher = await createDispatcher(
        options.hostName ?? "studio-onboarding",
        {
            appAgentProviders: [provider],
            // Deliberately NO instanceDir: the dispatcher would then require a
            // storageProvider, and we don't need one — the ephemeral onboarding
            // session is in-memory (persistSession: false) and the onboarding
            // agent writes its artifacts to a fixed ~/.typeagent/onboarding/<name>
            // path of its own, not the dispatcher's instance dir. LLM keys come
            // from process.env (populated above), not instanceDir. This mirrors
            // the sibling collision runners, which also omit instanceDir.
            persistSession: false,
            translation: { enabled: true },
            explainer: { enabled: false },
            cache: { enabled: false },
            clientIO: silentClientIO(),
            metrics: false,
        },
    );

    async function submit(command: string): Promise<OnboardingDispatchResult> {
        const result = await awaitCommand(dispatcher, command);
        if (result === undefined) {
            return { actions: [], error: "Command was cancelled" };
        }
        return toResult(result);
    }

    return {
        submitUtterance(text: string) {
            return submit(text);
        },
        submitAction(actionName, parameters) {
            const schema = ACTION_SCHEMA[actionName];
            if (schema === undefined) {
                return Promise.resolve({
                    actions: [],
                    error: `Unknown onboarding action "${actionName}"`,
                });
            }
            // Single-quote the JSON so the command parser treats it as one arg.
            // Onboarding parameters (integration names, action names) never
            // contain single quotes.
            const params = JSON.stringify(parameters);
            return submit(
                `@action ${schema} ${actionName} --parameters '${params}'`,
            );
        },
        async close() {
            await dispatcher.close();
        },
    };
}
