// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Translation probe runner — replays an LLM-generated phrase corpus through
// the actual translation entry point (`translateRequest`) and records what
// `(schemaName, actionName)` the LLM picked per phrase. Distinct from
// `@collision corpus probe`, which only exercises the embedding ranker
// (`semanticSearchActionSchema`); this runner exercises the full LLM
// translator decision (schema picker + typed-action generation), which is
// closer to the runtime ground truth.
//
// Bypass scope (read-only against TypeAgent state):
//   - construction cache: caller wraps in `withReadOnlySession` (cache off)
//   - grammar match: not invoked — `translateRequest` is the LLM-only entry
//   - action execution: returned as a typed action; never dispatched
//   - fuzzy match: lives upstream of `translateRequest`; not invoked
//
// Strategy override: `pickInitialSchema` consults
// `collision.llmSelect.strategy`. To get the translator's pure verdict
// without `user-clarify` short-circuits, the runner forces
// `first-match` for the duration of the run and restores the prior value
// in a `finally`. The strategy actually used is reported back so future
// flag-driven sweeps (e.g. comparing `first-match` vs `score-rank` vs
// `user-clarify`) record the strategy alongside results.

import type { ActionContext } from "@typeagent/agent-sdk";
import type { CommandHandlerContext } from "../context/commandHandlerContext.js";
import { changeContextConfig } from "../context/commandHandlerContext.js";
import type { CollisionStrategy } from "../context/session.js";
import type { ActionConfigProvider } from "./actionConfigProvider.js";
import { translateRequest } from "./translateRequest.js";
import {
    resolveUserContextFromSchema,
    type UserContext,
} from "./userContext.js";

/** Predicate applied to each task before the LLM is called. Receives a
 *  structural subset of the internal Task type so callers can filter by
 *  expected schema/action or phrase text without depending on internal
 *  fields. Used by the optimizer to scope probes to a single
 *  neighborhood's phrases. */
export type TranslationProbePhraseFilter = (phrase: {
    expectedSchema: string;
    expectedAction: string;
    phraseText: string;
}) => boolean;

// =============================================================================
// Types
// =============================================================================

export type TranslationOutcome =
    | "CLEAN" // chosen action matches expected (strict equality on schema+action)
    | "MISROUTE" // chosen disagrees with expected
    | "CLARIFY" // pickInitialSchema returned `kind: "clarify"` (user-clarify hit)
    | "INVALID" // translator returned an action not in the loaded set
    | "ERROR"; // exception thrown (timeout, parse error, etc.)

export interface TranslationCorpusPhraseSource {
    model: string;
    style: string;
}

export interface TranslationCorpusPhrase {
    text: string;
    sources: TranslationCorpusPhraseSource[];
}

export interface TranslationCorpusAction {
    schemaName: string;
    actionName: string;
    phrases: TranslationCorpusPhrase[];
}

export interface TranslationCorpus {
    actions: TranslationCorpusAction[];
}

export interface TranslationProbeRow {
    /** Expected schema (from corpus.json — what the LLM was asked to write a phrase for). */
    expectedSchema: string;
    expectedAction: string;
    phraseText: string;
    phraseSources: TranslationCorpusPhraseSource[];
    /** Chosen by the translator. Undefined when outcome is ERROR/CLARIFY. */
    chosenSchema?: string | undefined;
    chosenAction?: string | undefined;
    chosenParameters?: unknown;
    /** True when the translator returned a multi-step plan; first action is reported. */
    multipleActions: boolean;
    /** Translator model used for this row (for future per-model sweeps). */
    model: string;
    outcome: TranslationOutcome;
    elapsedMs: number;
    error?: string | undefined;
    /** User-environment context attached to this phrase's prompt. Undefined when
     *  `userContextMode` was "none" or the schema could not be resolved. */
    userContext?: UserContext | undefined;
}

/** How userContext is attached to each phrase in the run.
 *  - `"none"` (default): no userContext is sent — matches pre-experiment behavior.
 *  - `"expected-schema"`: for each phrase, derive a UserContext from the
 *    expected schema's top-level app agent (via the manifest description).
 *    Models the case where the dispatcher knows which app the user is in
 *    because the user is acting on that app.
 *  - `"fixed"`: use `fixedUserContext` for every phrase. Models the case
 *    where the user is in a single fixed app across the whole session
 *    (e.g., "user is in VSCode") to measure biasing effects. */
export type UserContextMode = "none" | "expected-schema" | "fixed";

export interface TranslationProbeOpts {
    /** Concurrency for the LLM calls. Default 4 — chat completions are
     *  expensive; higher concurrency mostly hits rate limits. */
    concurrency?: number;
    /** Strategy to force during the run. Defaults to `first-match` so we
     *  always observe a translator decision; future sweeps will allow
     *  `user-clarify` etc. to measure policy effects. */
    strategy?: CollisionStrategy;
    /** Cap the run to N phrases (random subset, deterministic by index).
     *  Useful for smoke testing without paying for a full corpus. */
    maxPhrases?: number;
    /** Reported via the `model` field on each row. The runner does not pick
     *  the model; that's whatever the dispatcher's translator config
     *  resolves to today. Surfacing it for now so future multi-model sweeps
     *  can record provenance. */
    modelLabel?: string;
    /** Controls how userContext is attached to each phrase. Defaults to `"none"`. */
    userContextMode?: UserContextMode;
    /** Used only when `userContextMode === "fixed"`. Ignored otherwise. */
    fixedUserContext?: UserContext;
    /** Override the ActionConfigProvider used by the translator. When set,
     *  the LLM sees schemas/descriptions from this provider instead of the
     *  live `systemContext.agents`. Used by the optimize loop to probe
     *  sandbox edits. When undefined, falls back to the live agent
     *  manager. Schemas are also enumerated from the override (via
     *  `getActionConfigs()`) so the corpus's expected schemas are visible
     *  even when they aren't enabled in the current session. */
    actionConfigProvider?: ActionConfigProvider;
    /** Filter applied to the flattened task list before probing. Used by
     *  the optimize loop to scope a probe to a single neighborhood's
     *  phrases. Applied before `maxPhrases` slicing. */
    phraseFilter?: TranslationProbePhraseFilter;
}

export interface TranslationProbeSummary {
    scannedAt: string;
    elapsedMs: number;
    totalPhrases: number;
    counts: Record<TranslationOutcome, number>;
    /** The strategy active during the run (post-override). */
    strategyUsed: CollisionStrategy;
    /** The strategy that was active *before* this run, restored on exit. */
    strategyRestored: CollisionStrategy;
    /** Models that produced phrases in this corpus. */
    corpusModels: string[];
    /** Mode used to attach userContext to each phrase. */
    userContextMode: UserContextMode;
    /** Used only when mode is `"fixed"`. */
    fixedUserContext?: UserContext;
}

export interface TranslationProbeFile {
    summary: TranslationProbeSummary;
    results: TranslationProbeRow[];
}

// =============================================================================
// pmap — bounded-concurrency async map (matches the corpus probe's helper)
// =============================================================================

async function pmap<T, R>(
    items: T[],
    concurrency: number,
    runOne: (item: T, index: number) => Promise<R>,
    onProgress?: (done: number, total: number) => void,
): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let next = 0;
    let done = 0;
    async function worker() {
        for (;;) {
            const i = next++;
            if (i >= items.length) return;
            results[i] = await runOne(items[i]!, i);
            done++;
            onProgress?.(done, items.length);
        }
    }
    const workers = Array.from(
        { length: Math.max(1, concurrency) },
        worker,
    );
    await Promise.all(workers);
    return results;
}

// =============================================================================
// Helpers
// =============================================================================

function normalizeAction(name: string): string {
    return name.replace(/Action$/i, "").toLowerCase();
}

function strictMatch(
    s1: string,
    a1: string,
    s2: string,
    a2: string,
): boolean {
    return s1 === s2 && normalizeAction(a1) === normalizeAction(a2);
}

function isClarifyAction(schemaName: string, actionName: string): boolean {
    // The dispatcher synthesizes a clarify action when it can't proceed —
    // either ambiguous-agent-match or unresolved-reference. Both live under
    // the dispatcher's `clarify` schema namespace; we treat any action in
    // that namespace as a CLARIFY outcome regardless of the specific
    // actionName so future clarify variants Just Work.
    if (schemaName.startsWith("dispatcher.clarify")) return true;
    if (actionName === "clarifyMultipleAgentMatches") return true;
    return false;
}

// =============================================================================
// runTranslationProbe
// =============================================================================

export async function runTranslationProbe(
    corpus: TranslationCorpus,
    context: ActionContext<CommandHandlerContext>,
    opts: TranslationProbeOpts = {},
    onProgress?: (done: number, total: number) => void,
    onPartial?: (getFile: () => TranslationProbeFile) => void,
): Promise<TranslationProbeFile> {
    const concurrency = opts.concurrency ?? 4;
    const targetStrategy: CollisionStrategy = opts.strategy ?? "first-match";
    const userContextMode: UserContextMode = opts.userContextMode ?? "none";

    // Snapshot strategy so we can restore. We only override the
    // `llmSelect.strategy` because that's the one that controls
    // `pickInitialSchema`'s clarify short-circuit; the other strategy
    // points (`grammarMatch`, `fuzzy`) don't apply on this code path.
    const systemContext = context.sessionContext.agentContext;
    const session = systemContext.session;
    const priorStrategy: CollisionStrategy =
        session.getConfig().collision.llmSelect.strategy;

    interface Task {
        expectedSchema: string;
        expectedAction: string;
        phraseText: string;
        phraseSources: TranslationCorpusPhraseSource[];
        userContext: UserContext | undefined;
    }

    // Pre-resolve userContext per expected schema. For expected-schema mode
    // we walk the schema -> top-level app agent -> manifest description once
    // up front; for fixed mode we just reuse the provided context for every
    // phrase. None mode leaves userContext undefined throughout.
    const resolveContext = (
        expectedSchema: string,
    ): UserContext | undefined => {
        switch (userContextMode) {
            case "expected-schema":
                return resolveUserContextFromSchema(
                    expectedSchema,
                    systemContext.agents,
                );
            case "fixed":
                return opts.fixedUserContext;
            case "none":
            default:
                return undefined;
        }
    };

    const tasks: Task[] = [];
    for (const action of corpus.actions) {
        const userContext = resolveContext(action.schemaName);
        for (const phrase of action.phrases) {
            tasks.push({
                expectedSchema: action.schemaName,
                expectedAction: action.actionName,
                phraseText: phrase.text,
                phraseSources: phrase.sources,
                userContext,
            });
        }
    }
    const filtered = opts.phraseFilter
        ? tasks.filter((t) =>
              opts.phraseFilter!({
                  expectedSchema: t.expectedSchema,
                  expectedAction: t.expectedAction,
                  phraseText: t.phraseText,
              }),
          )
        : tasks;
    const limited =
        opts.maxPhrases && opts.maxPhrases < filtered.length
            ? filtered.slice(0, opts.maxPhrases)
            : filtered;

    // INVALID classification (translator emits a name not in any registered
    // schema) is reserved for a follow-up; enumerating loaded actions
    // requires going through actionSchemaFileCache and isn't worth the
    // ceremony for v1. Hallucinated outputs land in MISROUTE today.

    // Pass the full set of loaded schemas to translateRequest, not just the
    // session-active subset. The corpus was generated against every loaded
    // schema (corpus generate enumerates all of them); if we let
    // translateRequest fall back to `getActiveSchemas()`, it'll only pick
    // from whatever the current session has enabled — typically a smaller
    // subset — and the corpus's expected schemas may be invisible. Mirrors
    // the embedding probe's `() => true` filter.
    //
    // When an override provider is supplied (sandbox runs), enumerate
    // schemas from the override so optimizer-edited schemas show up even
    // if the live agent manager doesn't know about them.
    const allSchemas = opts.actionConfigProvider
        ? opts.actionConfigProvider
              .getActionConfigs()
              .map((c) => c.schemaName)
        : systemContext.agents.getSchemaNames();

    const t0 = Date.now();
    let strategyChanged = false;

    // Collect rows in completion order so partial snapshots reflect what's
    // actually landed so far. `pmap` separately returns results in task
    // order, which we use for the final return value.
    const corpusModels = new Set<string>();
    for (const action of corpus.actions) {
        for (const p of action.phrases) {
            for (const s of p.sources) corpusModels.add(s.model);
        }
    }
    const corpusModelsSorted = [...corpusModels].sort();
    const rowsSoFar: TranslationProbeRow[] = [];

    function snapshotFile(): TranslationProbeFile {
        const counts: Record<TranslationOutcome, number> = {
            CLEAN: 0,
            MISROUTE: 0,
            CLARIFY: 0,
            INVALID: 0,
            ERROR: 0,
        };
        for (const r of rowsSoFar) counts[r.outcome]++;
        return {
            summary: {
                scannedAt: new Date().toISOString(),
                elapsedMs: Date.now() - t0,
                totalPhrases: rowsSoFar.length,
                counts,
                strategyUsed: targetStrategy,
                strategyRestored: priorStrategy,
                corpusModels: corpusModelsSorted,
                userContextMode,
                ...(userContextMode === "fixed" && opts.fixedUserContext
                    ? { fixedUserContext: opts.fixedUserContext }
                    : {}),
            },
            results: rowsSoFar.slice(),
        };
    }

    async function computeRow(t: Task): Promise<TranslationProbeRow> {
        const startMs = Date.now();
        try {
            const out = await translateRequest(
                context,
                t.phraseText,
                undefined, // history
                undefined, // attachments
                undefined, // streamingActionIndex
                allSchemas,
                undefined, // usageCallback
                t.userContext,
                opts.actionConfigProvider,
            );
            const actions = out.requestAction.actions;
            const elapsedMs = Date.now() - startMs;
            if (!actions.length) {
                return {
                    expectedSchema: t.expectedSchema,
                    expectedAction: t.expectedAction,
                    phraseText: t.phraseText,
                    phraseSources: t.phraseSources,
                    multipleActions: false,
                    model: opts.modelLabel ?? "default",
                    outcome: "ERROR",
                    elapsedMs,
                    error: "translator returned 0 actions",
                    userContext: t.userContext,
                };
            }
            const first = actions[0]!.action;
            const schemaName = (first as any).schemaName as string;
            const actionName = (first as any).actionName as string;
            const parameters = (first as any).parameters;

            if (isClarifyAction(schemaName, actionName)) {
                return {
                    expectedSchema: t.expectedSchema,
                    expectedAction: t.expectedAction,
                    phraseText: t.phraseText,
                    phraseSources: t.phraseSources,
                    chosenSchema: schemaName,
                    chosenAction: actionName,
                    chosenParameters: parameters,
                    multipleActions: actions.length > 1,
                    model: opts.modelLabel ?? "default",
                    outcome: "CLARIFY",
                    elapsedMs,
                    userContext: t.userContext,
                };
            }

            const isMatch = strictMatch(
                schemaName,
                actionName,
                t.expectedSchema,
                t.expectedAction,
            );
            const outcome: TranslationOutcome = isMatch
                ? "CLEAN"
                : "MISROUTE";
            return {
                expectedSchema: t.expectedSchema,
                expectedAction: t.expectedAction,
                phraseText: t.phraseText,
                phraseSources: t.phraseSources,
                chosenSchema: schemaName,
                chosenAction: actionName,
                chosenParameters: parameters,
                multipleActions: actions.length > 1,
                model: opts.modelLabel ?? "default",
                outcome,
                elapsedMs,
                userContext: t.userContext,
            };
        } catch (err) {
            return {
                expectedSchema: t.expectedSchema,
                expectedAction: t.expectedAction,
                phraseText: t.phraseText,
                phraseSources: t.phraseSources,
                multipleActions: false,
                model: opts.modelLabel ?? "default",
                outcome: "ERROR",
                elapsedMs: Date.now() - startMs,
                error: err instanceof Error ? err.message : String(err),
                userContext: t.userContext,
            };
        }
    }

    try {
        if (priorStrategy !== targetStrategy) {
            await changeContextConfig(
                {
                    collision: {
                        llmSelect: { strategy: targetStrategy },
                    },
                },
                context,
            );
            strategyChanged = true;
        }

        const results = await pmap(
            limited,
            concurrency,
            async (t): Promise<TranslationProbeRow> => {
                const row = await computeRow(t);
                rowsSoFar.push(row);
                onPartial?.(snapshotFile);
                return row;
            },
            onProgress,
        );

        const elapsedMs = Date.now() - t0;
        const counts: Record<TranslationOutcome, number> = {
            CLEAN: 0,
            MISROUTE: 0,
            CLARIFY: 0,
            INVALID: 0,
            ERROR: 0,
        };
        for (const r of results) counts[r.outcome]++;

        return {
            summary: {
                scannedAt: new Date().toISOString(),
                elapsedMs,
                totalPhrases: results.length,
                counts,
                strategyUsed: targetStrategy,
                strategyRestored: priorStrategy,
                corpusModels: corpusModelsSorted,
                userContextMode,
                ...(userContextMode === "fixed" && opts.fixedUserContext
                    ? { fixedUserContext: opts.fixedUserContext }
                    : {}),
            },
            results,
        };
    } finally {
        if (strategyChanged) {
            await changeContextConfig(
                {
                    collision: {
                        llmSelect: { strategy: priorStrategy },
                    },
                },
                context,
            );
        }
    }
}
