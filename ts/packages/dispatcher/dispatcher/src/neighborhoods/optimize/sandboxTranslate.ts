// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Run the translator probe over a corpus using a sandbox `ActionConfigProvider`
// (instead of the live `systemContext.agents`). Thin wrapper around
// `runTranslationProbe` that sets the `actionConfigProvider` opt; defined
// here so Phase 2+ levers can probe sandbox edits without re-implementing
// the probe loop.

import type { ActionContext } from "@typeagent/agent-sdk";
import type { CommandHandlerContext } from "../../context/commandHandlerContext.js";
import type { ActionConfigProvider } from "../../translation/actionConfigProvider.js";
import {
    runTranslationProbe,
    type TranslationCorpus,
    type TranslationProbeFile,
    type TranslationProbeOpts,
    type TranslationProbePhraseFilter,
} from "../../translation/translationProbeRunner.js";

export interface SandboxTranslateOpts
    extends Omit<TranslationProbeOpts, "actionConfigProvider"> {
    /** Optional filter applied before probing — used by the optimize loop
     *  to scope a probe to a single neighborhood's phrases. */
    phraseFilter?: TranslationProbePhraseFilter;
}

/**
 * Run the translator over `corpus` against `provider`. The translator's
 * action-config lookups are routed through `provider` for the duration of
 * the run; everything else (active schemas enumeration, semantic search,
 * session config) continues to use the live `systemContext.agents`.
 *
 * Callers should wrap this in `withReadOnlySession` so the construction
 * cache is disabled during the probe.
 */
export async function translateCorpusWithProvider(
    provider: ActionConfigProvider,
    corpus: TranslationCorpus,
    context: ActionContext<CommandHandlerContext>,
    opts: SandboxTranslateOpts = {},
    onProgress?: (done: number, total: number) => void,
): Promise<TranslationProbeFile> {
    return runTranslationProbe(
        corpus,
        context,
        {
            ...opts,
            actionConfigProvider: provider,
        },
        onProgress,
    );
}
