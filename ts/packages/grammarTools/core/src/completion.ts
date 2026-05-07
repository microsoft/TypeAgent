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
} from "./types.js";

/**
 * Preview completions for a partial input against a loaded grammar.
 * Wraps the existing `matchGrammarCompletion` API with a UI-ready shape.
 */
export function previewCompletion(
    g: LoadedGrammar,
    input: string,
): CompletionPreview {
    const result = matchGrammarCompletion(g.grammar, input);

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
