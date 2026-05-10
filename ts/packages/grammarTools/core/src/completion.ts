// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    matchGrammarCompletion,
    type GrammarCompletionGroup,
    type GrammarCompletionProperty as AGCompletionProperty,
} from "action-grammar";
import type {
    LoadedGrammar,
    CompletionPreview,
    CompletionGroup,
    CompletionProperty,
    AfterWildcard,
    CompletionOptions,
} from "./types.js";

/**
 * Preview completions for a partial input against a loaded grammar.
 * Wraps the existing `matchGrammarCompletion` API with a UI-ready shape.
 */
export function previewCompletion(
    g: LoadedGrammar,
    input: string,
    options?: CompletionOptions,
): CompletionPreview {
    const { direction, ...matchOpts } = options ?? {};
    const hasMatchOpts = Object.keys(matchOpts).length > 0;
    const result = matchGrammarCompletion(
        g.grammar,
        input,
        undefined,
        direction,
        hasMatchOpts ? matchOpts : undefined,
    );

    const groups: CompletionGroup[] = result.groups.map(
        (group: GrammarCompletionGroup) => ({
            completions: group.completions,
            separatorMode: group.separatorMode,
        }),
    );

    const properties: CompletionProperty[] | undefined = result.properties?.map(
        (prop: AGCompletionProperty) => ({
            propertyNames: prop.propertyNames,
            separatorMode: prop.separatorMode,
        }),
    );

    return {
        groups,
        properties: properties ?? [],
        matchedPrefixLength: result.matchedPrefixLength ?? 0,
        afterWildcard: result.afterWildcard as AfterWildcard,
        directionSensitive: result.directionSensitive,
    };
}
