// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    Grammar,
    GrammarRule,
    GrammarPart,
    StringPart,
    VarStringPart,
    VarNumberPart,
    RulesPart,
} from "./grammarTypes.js";
import { NFA, NFABuilder } from "./nfa.js";
import {
    parseValueExpression,
    compileValueExpression,
    ValueExpression,
} from "./environment.js";

/**
 * Context for compiling a rule, including slot information
 */
interface RuleCompilationContext {
    /** Map from variable name to slot index */
    slotMap: Map<string, number>;
    /** Next available slot index */
    nextSlotIndex: number;
    /** Checked variables set from grammar */
    checkedVariables: Set<string> | undefined;
    /** Parent slot index (for nested rule results) */
    parentSlotIndex: number | undefined;
}

/**
 * Check if a rule is a passthrough rule (single RulesPart without variable or value)
 * Passthrough rules need normalization: @ <S> = <C> becomes @ <S> = $(v:<C>) -> $(v)
 */
function isPassthroughRule(rule: GrammarRule): boolean {
    // A passthrough rule has:
    // 1. No explicit value expression
    // 2. A single part that is a rules reference without a variable
    if (rule.value) {
        return false; // Has explicit value, not a passthrough
    }
    if (rule.parts.length !== 1) {
        return false; // Multiple parts, not a simple passthrough
    }
    const part = rule.parts[0];
    if (part.type !== "rules") {
        return false; // Not a rules reference
    }
    if (part.variable) {
        return false; // Already has a variable binding
    }
    return true;
}

/**
 * Check if a rule is a single-literal rule (e.g., @ <KnownProgram> = chrome)
 * Such rules should implicitly produce the matched literal as their value: -> "chrome"
 */
function isSingleLiteralRule(rule: GrammarRule): { literal: string } | false {
    // A single-literal rule has:
    // 1. No explicit value expression
    // 2. Single part that is a string literal (not a variable or rules reference)
    if (rule.value) {
        return false; // Has explicit value
    }
    if (rule.parts.length !== 1) {
        return false; // Multiple parts
    }
    const part = rule.parts[0];
    if (part.type !== "string") {
        return false; // Not a literal
    }
    if (part.value.length === 0) {
        return false; // Empty string, nothing to capture
    }
    // Return the literal value (joined tokens)
    return { literal: part.value.join(" ") };
}

/**
 * Normalize a grammar for matching.
 * This converts:
 * - Passthrough rules: @ <S> = <C> becomes @ <S> = $(_result:<C>) -> $(_result)
 * - Single-literal rules: @ <S> = chrome becomes @ <S> = chrome -> "chrome"
 *
 * Normalization is done as a preprocessing step so matchers don't need special handling.
 * Both completion-based and NFA-based matchers benefit from this normalization.
 *
 * @param grammar The grammar to normalize
 * @returns A new grammar with normalized rules (original is not modified)
 */
export function normalizeGrammar(grammar: Grammar): Grammar {
    // Cache to avoid re-normalizing shared rule arrays (handles recursive grammars)
    const rulesCache = new Map<GrammarRule[], GrammarRule[]>();
    return {
        ...grammar,
        rules: normalizeRulesArray(grammar.rules, rulesCache),
    };
}

/**
 * Normalize an array of rules, using cache to handle circular references.
 */
function normalizeRulesArray(
    rules: GrammarRule[],
    cache: Map<GrammarRule[], GrammarRule[]>,
): GrammarRule[] {
    // Check cache first to handle recursive rule references
    const cached = cache.get(rules);
    if (cached !== undefined) {
        return cached;
    }

    // Create the result array and cache it BEFORE normalizing
    // This handles recursive references: when we encounter the same rules array
    // during normalization, we return the (partially filled) cached array
    const result: GrammarRule[] = [];
    cache.set(rules, result);

    // Now normalize each rule
    for (const rule of rules) {
        result.push(normalizeRule(rule, cache));
    }

    return result;
}

/**
 * Normalize a single rule, recursively normalizing any nested rules.
 */
function normalizeRule(
    rule: GrammarRule,
    cache: Map<GrammarRule[], GrammarRule[]>,
): GrammarRule {
    // First, normalize all nested RulesParts
    const normalizedParts = rule.parts.map((part) =>
        normalizePart(part, cache),
    );

    // Check if this is a passthrough rule that needs transformation
    if (isPassthroughRule(rule)) {
        // Transform: @ <S> = <C> becomes @ <S> = $(_result:<C>) -> $(_result)
        const rulesPart = normalizedParts[0] as RulesPart;
        return {
            parts: [
                {
                    ...rulesPart,
                    variable: "_result", // Add capture variable
                },
            ],
            value: { type: "variable", name: "_result" }, // Add value expression
        };
    }

    // Check if this is a single-literal rule that needs transformation
    const singleLiteral = isSingleLiteralRule(rule);
    if (singleLiteral) {
        // Transform: @ <S> = chrome becomes @ <S> = chrome -> "chrome"
        return {
            parts: normalizedParts,
            value: { type: "literal", value: singleLiteral.literal },
        };
    }

    // Not a passthrough or single-literal - return with normalized parts
    return {
        ...rule,
        parts: normalizedParts,
    };
}

/**
 * Normalize a grammar part, recursively normalizing nested rules.
 */
function normalizePart(
    part: GrammarPart,
    cache: Map<GrammarRule[], GrammarRule[]>,
): GrammarPart {
    if (part.type !== "rules") {
        return part; // Only RulesParts need normalization
    }

    // Normalize all nested rules within this RulesPart (using cache)
    return {
        ...part,
        rules: normalizeRulesArray(part.rules, cache),
    };
}

/**
 * Check if a rule is a single-variable rule (e.g., @ <ArtistName> = $(x:wildcard))
 * Such rules should implicitly produce their variable's value: -> $(x)
 */
function isSingleVariableRule(rule: GrammarRule): { variable: string } | false {
    // A single-variable rule has:
    // 1. No explicit value expression
    // 2. Single part that is a wildcard or number with a variable
    if (rule.value) {
        return false; // Has explicit value
    }
    if (rule.parts.length !== 1) {
        return false; // Multiple parts
    }
    const part = rule.parts[0];
    if (part.type === "wildcard" || part.type === "number") {
        if (part.variable) {
            return { variable: part.variable };
        }
    }
    return false;
}

/**
 * Collect all variable names from a rule's parts
 * Returns them in order of appearance
 *
 * For passthrough rules (single RulesPart without variable), adds an implicit "_result" variable
 */
function collectVariables(rule: GrammarRule): string[] {
    const variables: string[] = [];
    const seen = new Set<string>();

    // Check for passthrough rule normalization
    if (isPassthroughRule(rule)) {
        // Add implicit variable for passthrough
        variables.push("_result");
        return variables;
    }

    function collectFromPart(part: GrammarPart): void {
        switch (part.type) {
            case "wildcard":
            case "number":
                if (part.variable && !seen.has(part.variable)) {
                    seen.add(part.variable);
                    variables.push(part.variable);
                }
                break;
            case "rules":
                // For nested rules, if the RulesPart has a variable, that's what gets captured
                if (part.variable && !seen.has(part.variable)) {
                    seen.add(part.variable);
                    variables.push(part.variable);
                }
                // Don't recurse into nested rule's inner variables - they use their own slots
                break;
            case "string":
                // No variables in string parts
                break;
        }
    }

    for (const part of rule.parts) {
        collectFromPart(part);
    }

    return variables;
}

/**
 * Create a slot map for a rule's variables
 */
function createRuleSlotMap(rule: GrammarRule): Map<string, number> {
    const variables = collectVariables(rule);
    const slotMap = new Map<string, number>();
    for (let i = 0; i < variables.length; i++) {
        slotMap.set(variables[i], i);
    }
    return slotMap;
}

/**
 * Create a type map for a rule's variables (variable name -> typeName)
 * Used for type conversion during value expression evaluation
 */
function createRuleTypeMap(rule: GrammarRule): Map<string, string> {
    const typeMap = new Map<string, string>();

    function collectFromPart(part: GrammarPart): void {
        switch (part.type) {
            case "wildcard":
                // VarStringPart has variable and typeName
                if (part.variable && part.typeName) {
                    typeMap.set(part.variable, part.typeName);
                }
                break;
            case "number":
                // VarNumberPart has variable, typeName is implicitly "number"
                if (part.variable) {
                    typeMap.set(part.variable, "number");
                }
                break;
            case "rules":
                // RulesPart has nested rules
                if (part.rules) {
                    for (const nestedRule of part.rules) {
                        for (const nestedPart of nestedRule.parts) {
                            collectFromPart(nestedPart);
                        }
                    }
                }
                break;
            case "string":
                // StringPart has no variables
                break;
        }
    }

    for (const part of rule.parts) {
        collectFromPart(part);
    }

    return typeMap;
}

/**
 * Compile a Grammar to an NFA
 *
 * This compiler converts token-based grammar rules into an NFA that can be:
 * 1. Interpreted directly for matching (debugging)
 * 2. Converted to a DFA for faster matching
 * 3. Combined with other NFAs for incremental grammar extension
 */

/**
 * Compile a grammar to an NFA
 * @param grammar The grammar to compile
 * @param name Optional name for debugging
 * @returns An NFA representing the grammar
 */
export function compileGrammarToNFA(grammar: Grammar, name?: string): NFA {
    // Normalize grammar first: convert passthrough rules to explicit form
    // @ <S> = <C> becomes @ <S> = $(_result:<C>) -> $(_result)
    const normalizedGrammar = normalizeGrammar(grammar);

    const builder = new NFABuilder();

    // Create start state
    const startState = builder.createState(false);

    // Create an accepting state that all rules will lead to
    const acceptState = builder.createState(true);

    // Compile each rule as an alternative path from start to accept
    for (
        let ruleIndex = 0;
        ruleIndex < normalizedGrammar.rules.length;
        ruleIndex++
    ) {
        const rule = normalizedGrammar.rules[ruleIndex];

        // VALIDATION: Multi-term rules MUST have value expressions
        // Single-term rules can omit value expressions (they inherit from the term)
        if (rule.parts.length > 1 && !rule.value) {
            throw new Error(
                `Grammar rule at index ${ruleIndex} has ${rule.parts.length} terms but no value expression. ` +
                    `Multi-term rules must have an explicit value expression (using ->).`,
            );
        }

        // Check for single-variable rules like @ <ArtistName> = $(x:wildcard)
        // These should implicitly produce their variable's value: -> $(x)
        let effectiveValue = rule.value;
        if (!effectiveValue) {
            const singleVar = isSingleVariableRule(rule);
            if (singleVar) {
                effectiveValue = { type: "variable", name: singleVar.variable };
            }
        }

        const ruleEntry = builder.createState(false);

        // Mark the rule entry state with the rule index
        builder.getState(ruleEntry).ruleIndex = ruleIndex;

        // Create slot map for this rule FIRST (needed to compile value expression)
        const slotMap = createRuleSlotMap(rule);
        if (slotMap.size > 0) {
            builder.setStateSlotInfo(ruleEntry, slotMap.size, slotMap);
        }

        // Create type map for type conversion during evaluation
        const typeMap = createRuleTypeMap(rule);

        // Compile and set the effective value expression on the state
        // Parse the raw value node, then compile with slot indices
        if (effectiveValue) {
            const parsedExpr = parseValueExpression(effectiveValue);
            const compiledExpr = compileValueExpression(
                parsedExpr,
                slotMap,
                typeMap,
            );
            builder.getState(ruleEntry).actionValue = compiledExpr;
            // Also store in actionValues array for priority tracking
            builder.setActionValue(ruleIndex, compiledExpr);
        }

        builder.addEpsilonTransition(startState, ruleEntry);

        // Create compilation context with slot information
        const context: RuleCompilationContext = {
            slotMap,
            nextSlotIndex: slotMap.size,
            checkedVariables: normalizedGrammar.checkedVariables,
            parentSlotIndex: undefined,
        };

        const ruleEnd = compileRuleFromStateWithSlots(
            builder,
            normalizedGrammar,
            rule,
            ruleEntry,
            acceptState,
            context,
        );

        // If rule didn't connect to accept state, add epsilon transition
        if (ruleEnd !== acceptState) {
            builder.addEpsilonTransition(ruleEnd, acceptState);
        }
    }

    return builder.build(startState, name);
}

/**
 * Compile a single grammar rule starting from a specific state
 * @returns The final state of this rule
 * @deprecated Use compileRuleFromStateWithSlots for new code
 */
function compileRuleFromState(
    builder: NFABuilder,
    grammar: Grammar,
    rule: GrammarRule,
    startState: number,
    finalState: number,
    checkedVariables?: Set<string>,
    overrideVariableName?: string,
): number {
    let currentState = startState;

    // Process each part of the rule sequentially
    for (let i = 0; i < rule.parts.length; i++) {
        const part = rule.parts[i];
        const isLast = i === rule.parts.length - 1;
        const nextState = isLast ? finalState : builder.createState(false);

        currentState = compilePart(
            builder,
            grammar,
            part,
            currentState,
            nextState,
            checkedVariables,
            overrideVariableName,
        );
    }

    return currentState;
}

/**
 * Compile a single grammar rule with slot tracking
 * @returns The final state of this rule
 */
function compileRuleFromStateWithSlots(
    builder: NFABuilder,
    grammar: Grammar,
    rule: GrammarRule,
    startState: number,
    finalState: number,
    context: RuleCompilationContext,
): number {
    let currentState = startState;

    // Process each part of the rule sequentially
    for (let i = 0; i < rule.parts.length; i++) {
        const part = rule.parts[i];
        const isLast = i === rule.parts.length - 1;
        const nextState = isLast ? finalState : builder.createState(false);

        currentState = compilePartWithSlots(
            builder,
            grammar,
            part,
            currentState,
            nextState,
            context,
        );
    }

    return currentState;
}

/**
 * Compile a single grammar part
 * @returns The state after this part
 * @deprecated Use compilePartWithSlots for new code
 */
function compilePart(
    builder: NFABuilder,
    grammar: Grammar,
    part: GrammarPart,
    fromState: number,
    toState: number,
    checkedVariables?: Set<string>,
    overrideVariableName?: string,
): number {
    switch (part.type) {
        case "string":
            return compileStringPart(builder, part, fromState, toState);

        case "wildcard":
            return compileWildcardPart(
                builder,
                part,
                fromState,
                toState,
                checkedVariables,
                overrideVariableName,
            );

        case "number":
            return compileNumberPart(builder, part, fromState, toState);

        case "rules":
            return compileRulesPart(
                builder,
                grammar,
                part,
                fromState,
                toState,
                checkedVariables,
                overrideVariableName,
            );

        default:
            throw new Error(`Unknown part type: ${(part as any).type}`);
    }
}

/**
 * Compile a single grammar part with slot tracking
 * @returns The state after this part
 */
function compilePartWithSlots(
    builder: NFABuilder,
    grammar: Grammar,
    part: GrammarPart,
    fromState: number,
    toState: number,
    context: RuleCompilationContext,
): number {
    switch (part.type) {
        case "string":
            return compileStringPart(builder, part, fromState, toState);

        case "wildcard":
            return compileWildcardPartWithSlots(
                builder,
                part,
                fromState,
                toState,
                context,
            );

        case "number":
            return compileNumberPartWithSlots(
                builder,
                part,
                fromState,
                toState,
                context,
            );

        case "rules":
            return compileRulesPartWithSlots(
                builder,
                grammar,
                part,
                fromState,
                toState,
                context,
            );

        default:
            throw new Error(`Unknown part type: ${(part as any).type}`);
    }
}

/**
 * Compile a string part (matches specific tokens)
 */
function compileStringPart(
    builder: NFABuilder,
    part: StringPart,
    fromState: number,
    toState: number,
): number {
    if (part.value.length === 0) {
        // Empty string - epsilon transition
        builder.addEpsilonTransition(fromState, toState);
        return toState;
    }

    // For single token, direct transition
    if (part.value.length === 1) {
        builder.addTokenTransition(fromState, toState, part.value);
        return toState;
    }

    // For multiple tokens, create a sequence chain
    // Each token must match in order: state1 --token1--> state2 --token2--> ... --> toState
    let currentState = fromState;
    for (let i = 0; i < part.value.length; i++) {
        const token = part.value[i];
        const isLast = i === part.value.length - 1;
        const nextState = isLast ? toState : builder.createState(false);
        builder.addTokenTransition(currentState, nextState, [token]);
        currentState = nextState;
    }
    return toState;
}

/**
 * Compile a wildcard part (matches any token, captures to variable)
 * @deprecated Use compileWildcardPartWithSlots for new code
 */
function compileWildcardPart(
    builder: NFABuilder,
    part: VarStringPart,
    fromState: number,
    toState: number,
    checkedVariables?: Set<string>,
    overrideVariableName?: string,
): number {
    // Use override variable name if provided, otherwise use the part's variable name
    // This allows outer rules to override inner rule variable names for proper capture
    const variableName = overrideVariableName ?? part.variable;

    // Determine if this wildcard is checked
    // A wildcard is checked if:
    // 1. It has a non-string typeName (entity type like MusicDevice, Ordinal, etc.)
    // 2. It's in the checkedVariables set (has checked_wildcard paramSpec)
    const hasEntityType = part.typeName && part.typeName !== "string";
    const hasCheckedParamSpec = checkedVariables?.has(variableName) ?? false;
    const isChecked = hasEntityType || hasCheckedParamSpec;

    if (part.optional) {
        // Optional wildcard: can skip via epsilon or match one or more tokens
        // fromState --epsilon--> toState (skip)
        // fromState --wildcard--> loopState --wildcard--> loopState (consume 1+ tokens)
        //                         loopState --epsilon--> toState (exit)
        builder.addEpsilonTransition(fromState, toState); // Skip option

        const loopState = builder.createState(false);

        // First token: fromState -> loopState
        builder.addWildcardTransition(
            fromState,
            loopState,
            variableName,
            part.typeName,
            isChecked,
        );

        // Loop: loopState -> loopState (consume more tokens)
        builder.addWildcardTransition(
            loopState,
            loopState,
            variableName,
            part.typeName,
            isChecked,
        );

        // Exit: loopState -> toState
        builder.addEpsilonTransition(loopState, toState);

        return toState;
    }

    // Required wildcard - matches one or more tokens
    // Create a loop structure:
    // fromState --wildcard--> loopState --wildcard--> loopState (loop for more tokens)
    //                         loopState --epsilon--> toState (exit after consuming tokens)
    const loopState = builder.createState(false);

    // First token: fromState -> loopState
    builder.addWildcardTransition(
        fromState,
        loopState,
        variableName,
        part.typeName,
        isChecked,
    );

    // Loop: loopState -> loopState (consume more tokens)
    builder.addWildcardTransition(
        loopState,
        loopState,
        variableName,
        part.typeName,
        isChecked,
    );

    // Exit: loopState -> toState
    builder.addEpsilonTransition(loopState, toState);

    return toState;
}

/**
 * Compile a number part (matches numeric tokens)
 * @deprecated Use compileNumberPartWithSlots for new code
 */
function compileNumberPart(
    builder: NFABuilder,
    part: VarNumberPart,
    fromState: number,
    toState: number,
): number {
    // For now, treat numbers as wildcards with type constraint
    // A more sophisticated version could have a "number" transition type
    if (part.optional) {
        builder.addEpsilonTransition(fromState, toState);
        builder.addWildcardTransition(
            fromState,
            toState,
            part.variable,
            "number",
        );
        return toState;
    }

    builder.addWildcardTransition(fromState, toState, part.variable, "number");
    return toState;
}

/**
 * Compile a wildcard part with slot tracking
 */
function compileWildcardPartWithSlots(
    builder: NFABuilder,
    part: VarStringPart,
    fromState: number,
    toState: number,
    context: RuleCompilationContext,
): number {
    // Use the part's variable name directly (passthrough normalization handles overrides)
    const variableName = part.variable;

    // Get slot index for this variable
    const slotIndex = context.slotMap.get(variableName);

    // Determine if this wildcard is checked
    const hasEntityType =
        part.typeName &&
        part.typeName !== "string" &&
        part.typeName !== "wildcard";
    const hasCheckedParamSpec =
        context.checkedVariables?.has(variableName) ?? false;
    const isChecked = hasEntityType || hasCheckedParamSpec;

    if (part.optional) {
        // Optional wildcard: can skip via epsilon or match one or more tokens
        builder.addEpsilonTransition(fromState, toState);

        const loopState = builder.createState(false);

        // First token: fromState -> loopState (not appending)
        builder.addWildcardTransition(
            fromState,
            loopState,
            variableName,
            part.typeName,
            isChecked,
            slotIndex,
            false, // First token, don't append
        );

        // Loop: loopState -> loopState (append to slot)
        builder.addWildcardTransition(
            loopState,
            loopState,
            variableName,
            part.typeName,
            isChecked,
            slotIndex,
            true, // Subsequent tokens, append
        );

        builder.addEpsilonTransition(loopState, toState);

        return toState;
    }

    // Required wildcard - matches one or more tokens
    const loopState = builder.createState(false);

    // First token: fromState -> loopState (not appending)
    builder.addWildcardTransition(
        fromState,
        loopState,
        variableName,
        part.typeName,
        isChecked,
        slotIndex,
        false, // First token, don't append
    );

    // Loop: loopState -> loopState (append to slot)
    builder.addWildcardTransition(
        loopState,
        loopState,
        variableName,
        part.typeName,
        isChecked,
        slotIndex,
        true, // Subsequent tokens, append
    );

    builder.addEpsilonTransition(loopState, toState);

    return toState;
}

/**
 * Compile a number part with slot tracking
 */
function compileNumberPartWithSlots(
    builder: NFABuilder,
    part: VarNumberPart,
    fromState: number,
    toState: number,
    context: RuleCompilationContext,
): number {
    // Get slot index for this variable
    const slotIndex = context.slotMap.get(part.variable);

    if (part.optional) {
        builder.addEpsilonTransition(fromState, toState);
        builder.addWildcardTransition(
            fromState,
            toState,
            part.variable,
            "number",
            false, // Numbers are not "checked" in the same way
            slotIndex,
            false,
        );
        return toState;
    }

    builder.addWildcardTransition(
        fromState,
        toState,
        part.variable,
        "number",
        false,
        slotIndex,
        false,
    );
    return toState;
}

/**
 * Compile a rules part (nested grammar rules)
 * @deprecated Use compileRulesPartWithSlots for new code
 */
function compileRulesPart(
    builder: NFABuilder,
    grammar: Grammar,
    part: RulesPart,
    fromState: number,
    toState: number,
    checkedVariables?: Set<string>,
    overrideVariableName?: string,
): number {
    if (part.rules.length === 0) {
        // Empty rules - epsilon transition
        builder.addEpsilonTransition(fromState, toState);
        return toState;
    }

    // Create entry and exit states for the nested rules
    const nestedEntry = builder.createState(false);
    const nestedExit = builder.createState(false);

    // Connect entry
    builder.addEpsilonTransition(fromState, nestedEntry);

    // If this RulesPart has a variable name (e.g., $(trackName:<TrackPhrase>)),
    // use it to override variable names in nested wildcards.
    // This ensures captures use the outer variable name instead of inner ones.
    const nestedOverride = part.variable ?? overrideVariableName;

    // Compile each nested rule as an alternative
    for (const rule of part.rules) {
        const ruleEntry = builder.createState(false);

        // Try to find this nested rule in the main grammar to get its rule index
        // Match based on whether the rule has an action value
        if (rule.value) {
            const ruleIndex = findRuleIndex(grammar, rule);
            if (ruleIndex !== -1) {
                builder.getState(ruleEntry).ruleIndex = ruleIndex;
            }
            // Always store the action value on the entry state for nested rules
            // This ensures we can return the correct action even if ruleIndex matching fails
            builder.getState(ruleEntry).actionValue = rule.value;
        }

        builder.addEpsilonTransition(nestedEntry, ruleEntry);
        compileRuleFromState(
            builder,
            grammar,
            rule,
            ruleEntry,
            nestedExit,
            checkedVariables,
            nestedOverride,
        );
    }

    // Connect exit
    if (part.optional) {
        // Optional: can skip the entire nested section
        builder.addEpsilonTransition(fromState, toState);
    }
    builder.addEpsilonTransition(nestedExit, toState);

    return toState;
}

/**
 * Compile a rules part with slot tracking
 * Each nested rule gets its own slot map and environment
 */
function compileRulesPartWithSlots(
    builder: NFABuilder,
    grammar: Grammar,
    part: RulesPart,
    fromState: number,
    toState: number,
    context: RuleCompilationContext,
): number {
    if (part.rules.length === 0) {
        // Empty rules - epsilon transition
        builder.addEpsilonTransition(fromState, toState);
        return toState;
    }

    // Create entry and exit states for the nested rules
    const nestedEntry = builder.createState(false);
    const nestedExit = builder.createState(false);

    // Connect entry
    builder.addEpsilonTransition(fromState, nestedEntry);

    // Determine the variable name for this nested rule's result
    // Only use the explicit variable from the part - no implicit override inheritance
    // (Passthrough normalization is done upfront, so we don't need overrideVariableName)
    const effectiveVariable = part.variable;

    // If we have a variable, find its slot in the parent environment
    const parentSlotIndex = effectiveVariable
        ? context.slotMap.get(effectiveVariable)
        : undefined;

    // Track whether any rule in this RulesPart created an environment
    // (needed to decide whether to pop environment on exit)
    let anyRuleCreatedEnvironment = false;

    // Compile each nested rule as an alternative
    for (const rule of part.rules) {
        const ruleEntry = builder.createState(false);

        // Create a new slot map for the nested rule FIRST (needed for compilation)
        const nestedSlotMap = createRuleSlotMap(rule);

        // Compile and store the action value on the entry state FIRST
        // We need to know if there's a value before deciding about environments
        // Passthrough normalization is done upfront, so rules already have explicit values
        // Just check for single-variable rules like @ <ArtistName> = $(x:wildcard)
        let effectiveValue = rule.value;
        if (!effectiveValue) {
            const singleVar = isSingleVariableRule(rule);
            if (singleVar) {
                effectiveValue = { type: "variable", name: singleVar.variable };
            }
        }

        let compiledValue: ValueExpression | undefined;
        if (effectiveValue) {
            const ruleIndex = findRuleIndex(grammar, rule);
            if (ruleIndex !== -1) {
                builder.getState(ruleEntry).ruleIndex = ruleIndex;
            }
            // Create type map for type conversion during evaluation
            const nestedTypeMap = createRuleTypeMap(rule);
            // Parse and compile the value expression with slot indices
            const parsedExpr = parseValueExpression(effectiveValue);
            compiledValue = compileValueExpression(
                parsedExpr,
                nestedSlotMap,
                nestedTypeMap,
            );
            builder.getState(ruleEntry).actionValue = compiledValue;
        }

        // Set slot info on the entry state if either:
        // 1. The nested rule has variables (nestedSlotMap.size > 0)
        // 2. We need to write to parent AND have a value to write
        // Only create an environment when actually needed
        const needsEnvironment =
            nestedSlotMap.size > 0 ||
            (parentSlotIndex !== undefined && compiledValue !== undefined);
        if (needsEnvironment) {
            builder.setStateSlotInfo(
                ruleEntry,
                nestedSlotMap.size,
                nestedSlotMap,
            );
            anyRuleCreatedEnvironment = true;
        }

        // Only set parentSlotIndex if this rule has a value to write to parent
        // Rules without values (like string literals) should not set this
        if (parentSlotIndex !== undefined && compiledValue !== undefined) {
            builder.setStateParentSlotIndex(ruleEntry, parentSlotIndex);
        }

        builder.addEpsilonTransition(nestedEntry, ruleEntry);

        // Create new context for the nested rule
        // IMPORTANT: Don't propagate parentSlotIndex - each rule level computes its own
        // based on its variable capture. This prevents deeper rules from incorrectly
        // inheriting parent slot indices.
        const nestedContext: RuleCompilationContext = {
            slotMap: nestedSlotMap,
            nextSlotIndex: nestedSlotMap.size,
            checkedVariables: context.checkedVariables,
            parentSlotIndex: undefined, // Each level computes its own from part.variable
        };

        // If we need to write to parent, create a per-rule exit state
        // and add a writeToParent epsilon from there to the shared exit
        if (parentSlotIndex !== undefined && compiledValue) {
            const ruleExit = builder.createState(false);
            compileRuleFromStateWithSlots(
                builder,
                grammar,
                rule,
                ruleEntry,
                ruleExit,
                nestedContext,
            );
            // Add epsilon with writeToParent - pass the COMPILED value expression
            builder.addEpsilonWithWriteToParent(
                ruleExit,
                nestedExit,
                compiledValue,
            );
        } else {
            compileRuleFromStateWithSlots(
                builder,
                grammar,
                rule,
                ruleEntry,
                nestedExit,
                nestedContext,
            );
        }
    }

    // Connect exit
    if (part.optional) {
        // Optional: can skip the entire nested section
        builder.addEpsilonTransition(fromState, toState);
    }

    // If no parent slot index (nested rule doesn't write to parent), we need to
    // pop the environment when exiting. This handles cases like (<Item>)? where
    // the parent doesn't capture the result but nested rules still create environments.
    // IMPORTANT: Only pop if at least one rule actually created an environment.
    // Rules like (the)? don't create environments and shouldn't trigger a pop.
    if (parentSlotIndex === undefined && anyRuleCreatedEnvironment) {
        builder.addEpsilonWithPopEnvironment(nestedExit, toState);
    } else {
        builder.addEpsilonTransition(nestedExit, toState);
    }

    return toState;
}

/**
 * Find the index of a rule in the grammar's rules array
 * Returns -1 if not found
 */
function findRuleIndex(grammar: Grammar, rule: GrammarRule): number {
    // Match based on rule value (action object)
    // This is a simple comparison - we could make it more sophisticated
    for (let i = 0; i < grammar.rules.length; i++) {
        const grammarRule = grammar.rules[i];
        if (grammarRule.value && rulesMatch(grammarRule, rule)) {
            return i;
        }
    }
    return -1;
}

/**
 * Check if two rules match (simplified comparison based on value)
 */
function rulesMatch(rule1: GrammarRule, rule2: GrammarRule): boolean {
    // For now, use a simple identity check
    // In practice, nested rules are often the same object references
    return rule1 === rule2;
}

/**
 * Compile a single grammar rule to a standalone NFA
 * Useful for incremental grammar building
 */
export function compileRuleToNFA(rule: GrammarRule, name?: string): NFA {
    const builder = new NFABuilder();
    const startState = builder.createState(false);
    const acceptState = builder.createState(true);

    // Create a minimal grammar for this single rule
    const grammar: Grammar = {
        rules: [rule],
    };

    compileRuleFromState(builder, grammar, rule, startState, acceptState);

    return builder.build(startState, name);
}
