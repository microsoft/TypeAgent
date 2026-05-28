// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Trigger-phrase + default grammar pattern generation. Companion to
// generateGrammarRuleText: that function emits a single rule from a pattern;
// this one decides what patterns to emit when the user hasn't supplied any.
//
// Output shape matches GrammarPatternInput's object form
// (`{ pattern, isAlias }`) so the result composes naturally with the
// existing grammar builder.

import { tokenizeForTriggerPhrase } from "../naming.js";

// Pattern shape compatible with grammarBuilder.GrammarPatternInput.
export interface DefaultGrammarPattern {
    pattern: string;
    isAlias: boolean;
}

// Minimal parameter shape consumed by grammar generation. Agent-specific
// parameter types just need to expose `name`, `type`, and `required` — the
// rest of the agent's metadata is ignored here.
export interface GrammarParameterInput {
    name: string;
    type: string;
    required: boolean;
}

export interface GenerateDefaultGrammarPatternsOptions {
    // These types render the capture as optional (`$(name:wildcard)?`)
    // because the runtime can fill them from active context. Default: empty.
    autoResolvableTypes?: ReadonlySet<string>;
    // Trigger verbs included in the leading alternation. Default for canvas
    // / scripting agents: ["run", "execute", "apply"]. Browser agents may
    // prefer ["go to", "open", "find"].
    triggerVerbs?: readonly string[];
}

const DEFAULT_TRIGGER_VERBS: readonly string[] = ["run", "execute", "apply"];

// Pick the phrase the grammar will accept. Falls back from displayName
// tokens → actionName tokens → raw actionName so emoji/CJK names still work.
export function computeTriggerPhrase(
    displayName: string,
    actionName: string,
): string {
    const displayTokens = tokenizeForTriggerPhrase(displayName);
    if (displayTokens.length > 0) return displayTokens.join(" ");
    const actionTokens = tokenizeForTriggerPhrase(actionName);
    return actionTokens.length > 0
        ? actionTokens.join(" ")
        : actionName.toLowerCase();
}

// Generate default grammar patterns: up to 3 trigger forms (displayName
// tokens, raw actionName, actionName tokens), deduped. Auto-resolvable types
// and `required:false` params get a `?` so the runtime can fill them.
//
// Returns the object form `{pattern, isAlias}[]` for direct use with
// generateGrammarRuleText.
export function generateDefaultGrammarPatterns(
    displayName: string,
    actionName: string,
    parameters: readonly GrammarParameterInput[],
    options?: GenerateDefaultGrammarPatternsOptions,
): DefaultGrammarPattern[] {
    const autoResolvable = options?.autoResolvableTypes ?? new Set<string>();
    const triggerVerbs = options?.triggerVerbs ?? DEFAULT_TRIGGER_VERBS;
    const verbAlt = triggerVerbs.join(" | ");

    const triggerWords = computeTriggerPhrase(displayName, actionName);
    const actionTokens = tokenizeForTriggerPhrase(actionName);
    const aliasWords =
        actionTokens.length > 0 ? actionTokens.join(" ") : actionName;

    const capturesSuffix = (() => {
        if (parameters.length === 0) return "";
        const captures = parameters.map((p) => {
            const captureType =
                p.type === "number"
                    ? "number"
                    : p.type === "boolean"
                      ? "boolean"
                      : "wildcard";
            const optional = !p.required || autoResolvable.has(p.type);
            return optional
                ? `$(${p.name}:${captureType})?`
                : `$(${p.name}:${captureType})`;
        });
        return " " + captures.join(" ");
    })();

    const patterns: DefaultGrammarPattern[] = [
        {
            pattern: `(${verbAlt}) ${triggerWords}${capturesSuffix}`,
            isAlias: false,
        },
    ];

    if (actionName && actionName.toLowerCase() !== triggerWords) {
        patterns.push({
            pattern: `(${verbAlt}) ${actionName}${capturesSuffix}`,
            isAlias: true,
        });
    }
    if (
        aliasWords &&
        aliasWords !== triggerWords &&
        aliasWords !== actionName.toLowerCase()
    ) {
        patterns.push({
            pattern: `(${verbAlt}) ${aliasWords}${capturesSuffix}`,
            isAlias: true,
        });
    }

    return patterns;
}
