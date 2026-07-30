// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Utterance-proof adapter: prove the generated agent answers an utterance.
 *
 * After a generated agent is installed, the wizard's "Try it" affordance
 * takes one of the example phrases produced by the PhraseGen phase and confirms
 * the just-built agent actually understands it: the phrase is run through a
 * dispatcher that has ONLY the generated agent loaded, and we check that the
 * translator resolves it to one of that agent's typed actions (ideally the very
 * action the phrase was generated for).
 *
 * Like {@link ./phaseRunner}, this module is the pure orchestration half: the
 * heavy machinery — a dispatcher that loads the generated agent and translates
 * an utterance WITHOUT executing it (no real API call / side effect) — is
 * injected as a plain {@link UtteranceTranslate} function, and the example
 * phrases are read through an injected {@link PhrasesReader}. So it unit-tests
 * with stubs: no LLM, network, or dispatcher required. The production wiring
 * (a lazily-built generated-agent dispatcher) lives in
 * {@link ./dispatcherGateway}.
 *
 * The proof is deliberately translation-only: resolving the utterance to the
 * generated agent's action is sufficient evidence the agent "answers" it, and
 * it avoids executing an action that would need real credentials or cause a
 * side effect. Execution is a separate concern handled by the sandbox.
 */

/** One action the translator resolved an utterance to (no execution). */
export interface ResolvedAction {
    /** The schema (agent) the translator picked, when reported. */
    schemaName?: string;
    /** The typed action within that schema, when reported. */
    actionName?: string;
}

/** The translator's report for a single utterance. */
export interface UtteranceTranslateOutcome {
    /** Actions the translator resolved the utterance to (empty if none). */
    actions: ResolvedAction[];
    /** Set when translation failed or was cancelled/clarified. */
    error?: string;
}

/**
 * Translate a single utterance against a dispatcher that has the generated
 * agent loaded, returning the resolved typed action(s) WITHOUT executing them.
 */
export type UtteranceTranslate = (
    utterance: string,
) => Promise<UtteranceTranslateOutcome>;

/**
 * Read the PhraseGen artifact (`phraseGen/phrases.json`) for an integration and
 * return its `phrases` map (action name → example utterances), or undefined
 * when no phrases have been generated yet.
 */
export type PhrasesReader = (
    integrationName: string,
) => Promise<Record<string, string[]> | undefined>;

export interface UtteranceProverDeps {
    translate: UtteranceTranslate;
    readPhrases: PhrasesReader;
}

export interface ProveUtteranceOptions {
    /**
     * Explicit utterance to try. When given, phrase selection is skipped (but
     * {@link ProveUtteranceOptions.expectedAction} is still honored for the
     * match check).
     */
    utterance?: string;
    /**
     * Restrict example-phrase selection to this action's phrases, and treat it
     * as the expected target action for the match check.
     */
    expectedAction?: string;
    /**
     * Schema names that belong to the generated agent. When provided, the
     * "answered" verdict additionally requires the resolved schema to be one of
     * these, so an utterance that happens to resolve to a built-in/system schema
     * does not count as the agent answering. When omitted, any resolved typed
     * action counts (the try-it dispatcher loads only the generated agent, so
     * that is normally safe).
     */
    agentSchemaNames?: string[];
}

/** The verdict of a single utterance proof. */
export interface UtteranceProofResult {
    /** The integration/agent under test. */
    integrationName: string;
    /** The utterance that was tried. */
    utterance: string;
    /** The action the phrase was generated for (the expected target), if known. */
    expectedAction?: string;
    /** Whether the generated agent answered (resolved to one of its actions). */
    answered: boolean;
    /** The schema the translator resolved to, when it answered. */
    resolvedSchema?: string;
    /** The action the translator resolved to, when it answered. */
    resolvedAction?: string;
    /**
     * True when the resolved action equals {@link expectedAction} — the
     * strongest signal (the agent understood the phrase as its author intended).
     */
    matchedExpectedAction: boolean;
    /** The translator's error, when it failed to resolve the utterance. */
    error?: string;
}

/**
 * Pick a deterministic example phrase from the PhraseGen `phrases` map. When
 * `action` is given, the first phrase for that action is used; otherwise the
 * actions are visited in sorted order and the first non-empty one wins. Returns
 * the phrase text plus the action it belongs to, or undefined when the map has
 * no usable phrase.
 */
export function selectExamplePhrase(
    phrases: Record<string, string[]>,
    action?: string,
): { utterance: string; action: string } | undefined {
    if (action !== undefined) {
        const list = phrases[action];
        const first = list?.find((p) => p.trim().length > 0);
        return first !== undefined ? { utterance: first, action } : undefined;
    }
    for (const name of Object.keys(phrases).sort((a, b) =>
        a.localeCompare(b),
    )) {
        const first = phrases[name]?.find((p) => p.trim().length > 0);
        if (first !== undefined) {
            return { utterance: first, action: name };
        }
    }
    return undefined;
}

function noPhrasesError(integrationName: string): Error {
    return new Error(
        `No example phrases found for "${integrationName}". Complete the ` +
            `PhraseGen phase before trying the agent.`,
    );
}

/**
 * Build the utterance prover. The returned function takes the generated agent's
 * name and proves that a PhraseGen example phrase resolves to one of the
 * agent's typed actions.
 */
export function createUtteranceProver(
    deps: UtteranceProverDeps,
): (
    integrationName: string,
    options?: ProveUtteranceOptions,
) => Promise<UtteranceProofResult> {
    return async (integrationName, options = {}) => {
        // 1. Choose the utterance: an explicit one, or a deterministic example
        // phrase from the PhraseGen artifact.
        let utterance = options.utterance?.trim();
        let expectedAction = options.expectedAction;
        if (utterance === undefined || utterance.length === 0) {
            const phrases = await deps.readPhrases(integrationName);
            if (phrases === undefined || Object.keys(phrases).length === 0) {
                throw noPhrasesError(integrationName);
            }
            const selected = selectExamplePhrase(
                phrases,
                options.expectedAction,
            );
            if (selected === undefined) {
                throw noPhrasesError(integrationName);
            }
            utterance = selected.utterance;
            expectedAction = selected.action;
        }

        // 2. Translate it against the generated-agent dispatcher (no execution).
        const outcome = await deps.translate(utterance);

        const base: Omit<UtteranceProofResult, "answered"> = {
            integrationName,
            utterance,
            matchedExpectedAction: false,
            ...(expectedAction !== undefined ? { expectedAction } : {}),
        };

        // 3. Interpret the resolution. A benign translator error (clarify /
        // cancelled / unknown) means the agent did not answer — surface it, but
        // do not throw: "did not answer" is a valid, reportable verdict.
        const resolved = firstTypedAction(
            outcome.actions,
            options.agentSchemaNames,
        );
        if (resolved === undefined) {
            return {
                ...base,
                answered: false,
                ...(outcome.error !== undefined
                    ? { error: outcome.error }
                    : {}),
            };
        }

        return {
            ...base,
            answered: true,
            ...(resolved.schemaName !== undefined
                ? { resolvedSchema: resolved.schemaName }
                : {}),
            ...(resolved.actionName !== undefined
                ? { resolvedAction: resolved.actionName }
                : {}),
            matchedExpectedAction:
                expectedAction !== undefined &&
                resolved.actionName === expectedAction,
        };
    };
}

/**
 * The first resolved action that represents a genuine typed action from the
 * generated agent: it must carry an actionName that is not the translator's
 * "unknown"/no-op marker, and — when the caller told us the agent's schema
 * names — belong to one of them.
 */
function firstTypedAction(
    actions: ResolvedAction[],
    agentSchemaNames?: string[],
): ResolvedAction | undefined {
    const allowed =
        agentSchemaNames !== undefined && agentSchemaNames.length > 0
            ? new Set(agentSchemaNames)
            : undefined;
    return actions.find((a) => {
        const name = a.actionName?.trim();
        if (name === undefined || name.length === 0 || name === "unknown") {
            return false;
        }
        if (allowed !== undefined) {
            return a.schemaName !== undefined && allowed.has(a.schemaName);
        }
        return true;
    });
}
