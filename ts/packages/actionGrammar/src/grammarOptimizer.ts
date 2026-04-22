// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import registerDebug from "debug";
import {
    CompiledObjectElement,
    CompiledValueNode,
    Grammar,
    GrammarPart,
    GrammarRule,
    RulesPart,
} from "./grammarTypes.js";

const debug = registerDebug("typeagent:grammar:opt");

export type GrammarOptimizationOptions = {
    /**
     * Inline single-alternative RulesPart when the nesting carries no
     * additional semantics (no repeat, no optional, no conflicting value
     * binding).  Removes a layer of backtracking nesting in the matcher.
     */
    inlineSingleAlternatives?: boolean;

    /**
     * Factor common leading parts shared across alternatives in a RulesPart.
     * Avoids re-matching the shared prefix while exploring each alternative.
     */
    factorCommonPrefixes?: boolean;
};

/**
 * Run enabled optimization passes against the compiled grammar AST.
 * The returned grammar is semantically equivalent to the input — only the
 * shape of the parts/rules tree changes.
 *
 * The optimizer is intentionally conservative: when in doubt about an
 * eligibility check, it leaves the AST unchanged.
 */
export function optimizeGrammar(
    grammar: Grammar,
    options: GrammarOptimizationOptions | undefined,
): Grammar {
    if (!options) {
        return grammar;
    }
    let rules = grammar.rules;
    if (options.inlineSingleAlternatives) {
        rules = inlineSingleAlternativeRules(rules);
    }
    if (options.factorCommonPrefixes) {
        rules = factorCommonPrefixes(rules);
        if (options.inlineSingleAlternatives) {
            // Factoring can produce new single-alternative wrapper rules;
            // run the inliner once more so they collapse.
            rules = inlineSingleAlternativeRules(rules);
        }
    }
    if (rules === grammar.rules) {
        return grammar;
    }
    return { ...grammar, rules };
}

// ─────────────────────────────────────────────────────────────────────────────
// Optimization #1: inline single-alternative RulesPart
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Walk all rule alternatives post-order and replace each eligible
 * RulesPart with the spread of its child rule's parts.
 *
 * Uses an identity memo over `GrammarRule[]` arrays so that two
 * `RulesPart`s that originally pointed to the same array (named-rule
 * sharing established by the compiler) still point to the same array
 * after the pass.  Preserves the dedup invariant that
 * `grammarSerializer.ts` relies on (`rulesToIndex.get(p.rules)`).
 */
export function inlineSingleAlternativeRules(
    rules: GrammarRule[],
): GrammarRule[] {
    const counter = { inlined: 0 };
    const memo: RulesArrayMemo = new Map();
    // Reference count over the input AST: how many `RulesPart`s point at
    // each `GrammarRule[]` array.  Used to refuse inlining a shared
    // array, which would otherwise duplicate the child's parts at every
    // call site and bloat the serialized grammar (the serializer dedups
    // by array identity).
    const refCounts = countRulesArrayRefs(rules);
    const result = inlineRulesArray(rules, counter, memo, refCounts);
    if (counter.inlined > 0) {
        debug(`inlined ${counter.inlined} single-alternative RulesParts`);
    }
    return result;
}

type RulesArrayMemo = Map<GrammarRule[], GrammarRule[]>;

/**
 * Count how many `RulesPart` references each `GrammarRule[]` array has
 * across the AST reachable from `rules`.  The top-level array itself is
 * counted as 1 (treated as if held by an implicit root reference) so
 * single-alternative top-level rules are also protected from inlining
 * if shared.  Recurses each unique array exactly once via `visited`.
 */
function countRulesArrayRefs(rules: GrammarRule[]): Map<GrammarRule[], number> {
    const counts = new Map<GrammarRule[], number>();
    const visited = new Set<GrammarRule[]>();
    function walk(arr: GrammarRule[]) {
        counts.set(arr, (counts.get(arr) ?? 0) + 1);
        if (visited.has(arr)) return;
        visited.add(arr);
        for (const r of arr) {
            for (const p of r.parts) {
                if (p.type === "rules") walk(p.rules);
            }
        }
    }
    walk(rules);
    return counts;
}

function inlineRulesArray(
    rules: GrammarRule[],
    counter: { inlined: number },
    memo: RulesArrayMemo,
    refCounts: Map<GrammarRule[], number>,
): GrammarRule[] {
    const cached = memo.get(rules);
    if (cached !== undefined) return cached;
    // Reserve the slot before recursing so cycles (if any) terminate.
    memo.set(rules, rules);
    const next = rules.map((r) => inlineRule(r, counter, memo, refCounts));
    const changed = next.some((r, i) => r !== rules[i]);
    const result = changed ? next : rules;
    memo.set(rules, result);
    return result;
}

function inlineRule(
    rule: GrammarRule,
    counter: { inlined: number },
    memo: RulesArrayMemo,
    refCounts: Map<GrammarRule[], number>,
): GrammarRule {
    const { parts, changed, valueSubstitutions, valueAssignment } = inlineParts(
        rule.parts,
        rule,
        counter,
        memo,
        refCounts,
    );
    if (!changed) {
        return rule;
    }
    let value = rule.value;
    if (value === undefined && valueAssignment !== undefined) {
        value = valueAssignment;
    }
    if (valueSubstitutions.length > 0 && value !== undefined) {
        for (const sub of valueSubstitutions) {
            value = substituteValueVariable(
                value,
                sub.variable,
                sub.replacement,
            );
        }
    }
    if (value === rule.value) {
        return { ...rule, parts };
    }
    return { ...rule, parts, value };
}

type InlineValueSubstitution = {
    variable: string;
    replacement: CompiledValueNode;
};

type TryInlineResult = {
    parts: GrammarPart[];
    valueSubstitution?: InlineValueSubstitution;
    /**
     * When set, the parent rule had no value expression of its own and
     * this inlining synthesizes one — copying what the matcher would
     * have computed via the single-part default-value rule (i.e. the
     * captured child rule's value).  Only valid when the parent had a
     * single part and no `value`; in that situation no other inlining
     * decision in the same parent can collide.
     */
    valueAssignment?: CompiledValueNode;
};

function inlineParts(
    parts: GrammarPart[],
    parentRule: GrammarRule,
    counter: { inlined: number },
    memo: RulesArrayMemo,
    refCounts: Map<GrammarRule[], number>,
): {
    parts: GrammarPart[];
    changed: boolean;
    valueSubstitutions: InlineValueSubstitution[];
    valueAssignment: CompiledValueNode | undefined;
} {
    let changed = false;
    const out: GrammarPart[] = [];
    const valueSubstitutions: InlineValueSubstitution[] = [];
    let valueAssignment: CompiledValueNode | undefined;
    for (const p of parts) {
        if (p.type !== "rules") {
            out.push(p);
            continue;
        }
        // Recurse into nested rules first (post-order), preserving
        // shared-array identity via memo.
        const inlinedRules = inlineRulesArray(
            p.rules,
            counter,
            memo,
            refCounts,
        );
        const rewritten: RulesPart =
            inlinedRules !== p.rules ? { ...p, rules: inlinedRules } : p;

        // Refuse to inline a RulesPart whose body is shared by more than
        // one reference: inlining duplicates the child's parts at the
        // call site, but the original array is still referenced from the
        // other call sites — net effect is N copies in the serialized
        // grammar instead of 1 dedup'd entry.  Reference counts come
        // from the *input* AST; the rewritten array shares identity with
        // it via the memo when no nested change occurred, and otherwise
        // is unique to this site (so inlining is safe).
        const shared = (refCounts.get(p.rules) ?? 1) > 1;
        const replacement = shared
            ? undefined
            : tryInlineRulesPart(rewritten, parentRule);
        if (replacement !== undefined) {
            counter.inlined++;
            changed = true;
            for (const np of replacement.parts) {
                out.push(np);
            }
            if (replacement.valueSubstitution !== undefined) {
                valueSubstitutions.push(replacement.valueSubstitution);
            }
            if (replacement.valueAssignment !== undefined) {
                // valueAssignment is only produced when the parent had
                // exactly one part (this RulesPart) and no value of its
                // own — so at most one assignment is possible per
                // parent rule.
                valueAssignment = replacement.valueAssignment;
            }
        } else {
            if (rewritten !== p) {
                changed = true;
            }
            out.push(rewritten);
        }
    }
    return {
        parts: changed ? out : parts,
        changed,
        valueSubstitutions,
        valueAssignment,
    };
}

/**
 * Decide whether `part` can be replaced by the spread of its single child
 * rule's parts.  Returns the replacement parts (and an optional value
 * substitution to apply to the parent rule's value expression) on
 * success, or `undefined` if the part must stay nested.
 */
function tryInlineRulesPart(
    part: RulesPart,
    parentRule: GrammarRule,
): TryInlineResult | undefined {
    if (part.repeat || part.optional) {
        return undefined;
    }
    if (part.rules.length !== 1) {
        return undefined;
    }
    const child = part.rules[0];
    if (child.parts.length === 0) {
        return undefined;
    }

    // Spacing mode: the child rule's spacing mode governs the boundaries
    // *between* its own parts.  When inlined, those boundaries are
    // governed by the parent's spacing mode.  Require exact equality:
    // `undefined` (auto) is a distinct mode at the matcher level, not
    // a synonym for "inherit from parent" — inlining a child with
    // `undefined` into a parent with `"required"` would change boundary
    // behavior at e.g. digit↔Latin transitions where auto resolves to
    // `optionalSpacePunctuation` but required is always
    // `spacePunctuation`.
    if (child.spacingMode !== parentRule.spacingMode) {
        return undefined;
    }

    // The child rule may carry its own value expression.  After
    // inlining, child.parts move into the parent and the explicit
    // child.value can no longer fire on its own.  child.value is
    // observable to the matcher in exactly two ways — handle each,
    // otherwise the value is dead and can be dropped:
    //
    //   (1) Substitute: parent captures via `part.variable` AND
    //       parent.value references that variable.  Substitute
    //       child.value for the variable in parent.value.
    //
    //   (2) Hoist: parent has no value of its own and exactly one
    //       part (this RulesPart).  The matcher's single-part
    //       default-value rule would have promoted the captured
    //       child.value into the parent's value at runtime.
    //       Synthesize that assignment explicitly on the parent.
    //
    //   (3) Drop: child.value is unobservable; inline child.parts
    //       and forget the value.
    //
    // child.value's references to child's own part bindings remain
    // in scope after inlining since those bindings move from
    // child.parts → parent.parts.  Only case (1) needs an additional
    // collision check against the parent's *other* parts.
    if (child.value !== undefined) {
        // (1) Substitution.
        if (part.variable !== undefined && parentRule.value !== undefined) {
            const parentRefs = collectVariableReferences(parentRule.value);
            if (parentRefs.has(part.variable)) {
                // Refuse if child's top-level bindings would collide
                // with bindings already in parent's other parts.
                const childBindings = collectVariableNames(child.parts);
                for (const otherPart of parentRule.parts) {
                    if (otherPart === part) continue;
                    const v = bindingName(otherPart);
                    if (v !== undefined && childBindings.has(v)) {
                        return undefined;
                    }
                }
                return {
                    parts: child.parts,
                    valueSubstitution: {
                        variable: part.variable,
                        replacement: child.value,
                    },
                };
            }
            // Parent has its own value and doesn't reference the
            // captured variable — fall through to drop.
        }

        // (2) Hoist onto a single-part parent without its own value.
        // No collision check needed: parent has no other parts.
        if (parentRule.value === undefined && parentRule.parts.length === 1) {
            return {
                parts: child.parts,
                valueAssignment: child.value,
            };
        }

        // (3) Drop: child.value is unobservable at runtime.
        return { parts: child.parts };
    }

    // If the parent expects to capture this RulesPart into a variable, the
    // child rule must provide a single binding-friendly part to take the
    // variable name; otherwise we'd silently drop the binding.
    if (part.variable !== undefined) {
        if (child.parts.length !== 1) {
            return undefined;
        }
        const only = child.parts[0];
        const bound = withPropagatedVariable(only, part.variable);
        if (bound === undefined) {
            return undefined;
        }
        // Guard against duplicate variable names being introduced into the
        // parent's parts list.
        if (findExistingVariable(parentRule.parts, part.variable, part)) {
            return undefined;
        }
        return { parts: [bound] };
    }

    return { parts: child.parts };
}

/**
 * Return a clone of `part` with `variable` set, or undefined if the part
 * cannot safely carry a variable binding via inlining.
 *
 * We only propagate onto direct-capture parts (wildcard/number).  Pushing
 * a variable onto a nested RulesPart is unsafe in the general case: the
 * inner rule may compute its value via an expression that references
 * names not reachable from the new parent scope, or it may provide no
 * structural value at all, causing the parent's binding to miss.
 */
function withPropagatedVariable(
    part: GrammarPart,
    variable: string,
): GrammarPart | undefined {
    switch (part.type) {
        case "wildcard":
        case "number":
            return { ...part, variable };
        case "rules":
        case "string":
        case "phraseSet":
            return undefined;
    }
}

function findExistingVariable(
    parts: GrammarPart[],
    name: string,
    skip: GrammarPart,
): boolean {
    for (const p of parts) {
        if (p === skip) continue;
        if (
            (p.type === "wildcard" ||
                p.type === "number" ||
                p.type === "rules") &&
            p.variable === name
        ) {
            return true;
        }
    }
    return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Optimization #2: factor common prefixes across alternatives
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Walk all RulesParts and factor common leading parts shared by two or
 * more alternatives within the same RulesPart.  The top-level
 * Grammar.rules array is not factored because each top-level alternative
 * is reported separately by the matcher.
 *
 * Uses an identity memo over `GrammarRule[]` arrays so shared named
 * rules (multiple `RulesPart`s pointing at the same array) still share
 * after the pass — see `inlineSingleAlternativeRules` for rationale.
 */
export function factorCommonPrefixes(rules: GrammarRule[]): GrammarRule[] {
    const counter = { factored: 0 };
    const memo: RulesArrayMemo = new Map();
    const result = factorRulesArray(rules, counter, memo);
    if (counter.factored > 0) {
        debug(`factored ${counter.factored} common prefix groups`);
    }
    return result;
}

function factorRulesArray(
    rules: GrammarRule[],
    counter: { factored: number },
    memo: RulesArrayMemo,
): GrammarRule[] {
    const cached = memo.get(rules);
    if (cached !== undefined) return cached;
    memo.set(rules, rules);
    const next = rules.map((r) => factorRule(r, counter, memo));
    const changed = next.some((r, i) => r !== rules[i]);
    const result = changed ? next : rules;
    memo.set(rules, result);
    return result;
}

function factorRule(
    rule: GrammarRule,
    counter: { factored: number },
    memo: RulesArrayMemo,
): GrammarRule {
    const { parts, changed } = factorParts(rule.parts, counter, memo);
    if (!changed) return rule;
    return { ...rule, parts };
}

function factorParts(
    parts: GrammarPart[],
    counter: { factored: number },
    memo: RulesArrayMemo,
): { parts: GrammarPart[]; changed: boolean } {
    let changed = false;
    const out: GrammarPart[] = [];
    for (const p of parts) {
        if (p.type !== "rules") {
            out.push(p);
            continue;
        }
        // Recurse into nested rules first, preserving shared-array
        // identity via memo.
        const recursedRules = factorRulesArray(p.rules, counter, memo);
        let working: RulesPart =
            recursedRules !== p.rules ? { ...p, rules: recursedRules } : p;

        // Factor with bounded iteration to fixed point.  Newly produced
        // suffix `RulesPart`s are not shared by construction, so they
        // don't need memo entries.
        for (let i = 0; i < 8; i++) {
            const next = factorRulesPart(working, counter);
            if (next === working) break;
            working = next;
        }
        if (working !== p) changed = true;
        out.push(working);
    }
    return { parts: changed ? out : parts, changed };
}

/**
 * One pass of common-prefix factoring inside a single RulesPart.
 * Returns the same object if nothing changed.
 */
function factorRulesPart(
    part: RulesPart,
    counter: { factored: number },
): RulesPart {
    if (part.repeat || part.optional) {
        // Repeat/optional change the matcher's loop-back semantics; leave
        // such groups untouched to stay safe.
        return part;
    }
    const rules = part.rules;
    if (rules.length < 2) return part;

    // Group alternatives that share at least one leading part (or at
    // least one leading string token) with the group's lead alternative.
    // Preserve original ordering.
    const groups: { members: number[] }[] = [];
    const consumed = new Set<number>();
    for (let i = 0; i < rules.length; i++) {
        if (consumed.has(i)) continue;
        const group: { members: number[] } = { members: [i] };
        consumed.add(i);
        for (let j = i + 1; j < rules.length; j++) {
            if (consumed.has(j)) continue;
            const sp = sharedPrefixShape(rules[i], rules[j]);
            if (sp.fullParts > 0 || sp.stringTokens > 0) {
                group.members.push(j);
                consumed.add(j);
            }
        }
        groups.push(group);
    }

    if (groups.every((g) => g.members.length < 2)) return part;

    const newRules: GrammarRule[] = [];
    let didFactor = false;
    for (const g of groups) {
        if (g.members.length < 2) {
            newRules.push(rules[g.members[0]]);
            continue;
        }
        const members = g.members.map((i) => rules[i]);
        // Intersect prefix shapes across all members (using member[0] as
        // canonical reference).
        let shape: PrefixShape = {
            fullParts: members[0].parts.length,
            stringTokens: 0,
        };
        for (let mi = 1; mi < members.length; mi++) {
            const s = sharedPrefixShape(members[0], members[mi]);
            if (s.fullParts < shape.fullParts) {
                shape = {
                    fullParts: s.fullParts,
                    stringTokens: s.stringTokens,
                };
            } else if (
                s.fullParts === shape.fullParts &&
                s.stringTokens < shape.stringTokens
            ) {
                shape = {
                    fullParts: s.fullParts,
                    stringTokens: s.stringTokens,
                };
            }
        }
        if (shape.fullParts === 0 && shape.stringTokens === 0) {
            for (const m of members) newRules.push(m);
            continue;
        }

        // Refuse to factor if any alternative would be wholly consumed by
        // the shared prefix AND has a value expression — the suffix
        // alternative would become empty-parts.
        const wholeConsumed = (m: GrammarRule): boolean => {
            if (
                m.parts.length !==
                shape.fullParts + (shape.stringTokens > 0 ? 1 : 0)
            ) {
                return false;
            }
            if (shape.stringTokens === 0) {
                return m.parts.length === shape.fullParts;
            }
            const last = m.parts[shape.fullParts];
            return (
                last.type === "string" &&
                last.value.length === shape.stringTokens
            );
        };
        if (members.some((m) => wholeConsumed(m) && m.value !== undefined)) {
            for (const m of members) newRules.push(m);
            continue;
        }

        // Build canonical prefix parts.
        const canonicalParts: GrammarPart[] = members[0].parts.slice(
            0,
            shape.fullParts,
        );
        if (shape.stringTokens > 0) {
            const lead = members[0].parts[shape.fullParts];
            if (lead.type !== "string") {
                // Shouldn't happen (shape guarantees string), bail safely.
                for (const m of members) newRules.push(m);
                continue;
            }
            canonicalParts.push({
                type: "string",
                value: lead.value.slice(0, shape.stringTokens),
            });
        }
        const canonicalNames = collectVariableNames(canonicalParts);

        // Build per-member variable remap from member-local prefix names
        // to canonical names taken from the lead alternative.  Only the
        // full-parts range carries variables (partial string tokens have
        // no variable bindings).
        const memberRemaps: Map<string, string>[] = members.map((m) =>
            buildPrefixRemap(canonicalParts, m.parts, shape.fullParts),
        );

        // Compute per-member suffix parts, splitting the partial
        // StringPart if needed.
        const memberSuffixParts: GrammarPart[][] = members.map((m) => {
            if (shape.stringTokens === 0) {
                return m.parts.slice(shape.fullParts);
            }
            const lead = m.parts[shape.fullParts];
            if (lead.type !== "string") {
                return m.parts.slice(shape.fullParts); // defensive
            }
            const remaining = lead.value.slice(shape.stringTokens);
            const rest = m.parts.slice(shape.fullParts + 1);
            if (remaining.length === 0) {
                return rest;
            }
            return [
                { type: "string", value: remaining } as GrammarPart,
                ...rest,
            ];
        });

        // Verify suffix bindings won't shadow shared canonical names.
        let collision = false;
        for (let mi = 0; mi < members.length && !collision; mi++) {
            const suffixVars = collectVariableNames(memberSuffixParts[mi]);
            const remap = memberRemaps[mi];
            for (const v of suffixVars) {
                const renamed = remap.get(v) ?? v;
                if (canonicalNames.has(renamed)) {
                    collision = true;
                    break;
                }
            }
        }
        if (collision) {
            for (const m of members) newRules.push(m);
            continue;
        }

        // Refuse to factor when any member's value expression references
        // a variable bound in the shared prefix.  The matcher scopes
        // value variables per nested rule, so the suffix's value cannot
        // see canonical-prefix bindings — factoring would break match
        // results.
        let crossScopeRef = false;
        for (let mi = 0; mi < members.length && !crossScopeRef; mi++) {
            const m = members[mi];
            if (m.value === undefined) continue;
            const remap = memberRemaps[mi];
            const referenced = collectVariableReferences(m.value);
            for (const v of referenced) {
                const renamed = remap.get(v) ?? v;
                if (canonicalNames.has(renamed)) {
                    crossScopeRef = true;
                    break;
                }
            }
        }
        if (crossScopeRef) {
            for (const m of members) newRules.push(m);
            continue;
        }

        // Refuse to factor when value-presence pattern is mixed across
        // members.  Mixing explicit-value and implicit-default alternatives
        // inside a new wrapper rule changes the matcher's default-value
        // semantics for the implicit cases.
        const valuePresence = members.map((m) => m.value !== undefined);
        const allHaveValue = valuePresence.every((v) => v);
        const noneHaveValue = valuePresence.every((v) => !v);
        if (!allHaveValue && !noneHaveValue) {
            for (const m of members) newRules.push(m);
            continue;
        }

        // Refuse to factor when (no member has explicit value) and any
        // suffix would end up with a multi-part shape: the matcher's
        // single-part default-value rule no longer applies, silently
        // turning a valid default into `undefined`.
        if (noneHaveValue) {
            const anySuffixMultipart = members.some((m) => {
                const suffixLen =
                    m.parts.length -
                    shape.fullParts -
                    (shape.stringTokens > 0 &&
                    m.parts[shape.fullParts]?.type === "string" &&
                    (m.parts[shape.fullParts] as any).value.length ===
                        shape.stringTokens
                        ? 1
                        : 0);
                return suffixLen > 1;
            });
            if (anySuffixMultipart) {
                for (const m of members) newRules.push(m);
                continue;
            }
        }

        const suffixRules: GrammarRule[] = members.map((m, mi) => {
            const remap = memberRemaps[mi];
            const suffixParts = memberSuffixParts[mi].map((p) =>
                remapPartVariables(p, remap),
            );
            const suffixValue =
                m.value !== undefined
                    ? remapValueVariables(m.value, remap)
                    : undefined;
            const out: GrammarRule = { parts: suffixParts };
            if (suffixValue !== undefined) out.value = suffixValue;
            if (m.spacingMode !== undefined) out.spacingMode = m.spacingMode;
            return out;
        });

        // If any suffix carries a value expression, the factored wrapper
        // rule must capture it — otherwise the matcher's value-tracking
        // policy would drop the nested value (parent has > 1 part with no
        // explicit value).  Generate a fresh variable name that does not
        // collide with the shared prefix or any suffix.
        const anySuffixHasValue = suffixRules.some(
            (r) => r.value !== undefined,
        );
        const suffixRulesPart: RulesPart = {
            type: "rules",
            rules: suffixRules,
        };
        const factoredAlt: GrammarRule = {
            parts: [...canonicalParts, suffixRulesPart],
        };
        if (anySuffixHasValue) {
            const reserved = new Set<string>(canonicalNames);
            for (const r of suffixRules) {
                for (const v of collectVariableNames(r.parts)) reserved.add(v);
            }
            let gen = "__opt_factor";
            let i = 0;
            while (reserved.has(gen)) {
                i++;
                gen = `__opt_factor_${i}`;
            }
            suffixRulesPart.variable = gen;
            factoredAlt.value = { type: "variable", name: gen };
        }
        const firstSpacing = members[0].spacingMode;
        if (
            members.every((m) => m.spacingMode === firstSpacing) &&
            firstSpacing !== undefined
        ) {
            factoredAlt.spacingMode = firstSpacing;
        }

        newRules.push(factoredAlt);
        didFactor = true;
        counter.factored++;
    }

    if (!didFactor) return part;
    return { ...part, rules: newRules };
}

// Compare two parts for "structurally equal modulo variable name".
function partsEqualForFactoring(a: GrammarPart, b: GrammarPart): boolean {
    if (a.type !== b.type) return false;
    switch (a.type) {
        case "string": {
            const bs = b as typeof a;
            if (a.value.length !== bs.value.length) return false;
            for (let i = 0; i < a.value.length; i++) {
                if (a.value[i] !== bs.value[i]) return false;
            }
            return true;
        }
        case "phraseSet":
            return a.matcherName === (b as typeof a).matcherName;
        case "wildcard": {
            const bw = b as typeof a;
            return (
                a.typeName === bw.typeName &&
                (a.optional ?? false) === (bw.optional ?? false)
            );
        }
        case "number": {
            const bn = b as typeof a;
            return (a.optional ?? false) === (bn.optional ?? false);
        }
        case "rules": {
            const br = b as typeof a;
            return (
                a.rules === br.rules &&
                (a.optional ?? false) === (br.optional ?? false) &&
                (a.repeat ?? false) === (br.repeat ?? false)
            );
        }
    }
}

function sharedPrefixLength(a: GrammarRule, b: GrammarRule): number {
    const max = Math.min(a.parts.length, b.parts.length);
    let i = 0;
    while (i < max && partsEqualForFactoring(a.parts[i], b.parts[i])) i++;
    return i;
}

type PrefixShape = {
    // Number of leading parts where both rules match via
    // partsEqualForFactoring.
    fullParts: number;
    // If the next part on both sides is a StringPart with a non-empty
    // common leading token sequence, this records its length.
    stringTokens: number;
};

function sharedPrefixShape(a: GrammarRule, b: GrammarRule): PrefixShape {
    const full = sharedPrefixLength(a, b);
    let stringTokens = 0;
    if (full < a.parts.length && full < b.parts.length) {
        const pa = a.parts[full];
        const pb = b.parts[full];
        if (pa.type === "string" && pb.type === "string") {
            const max = Math.min(pa.value.length, pb.value.length);
            while (
                stringTokens < max &&
                pa.value[stringTokens] === pb.value[stringTokens]
            ) {
                stringTokens++;
            }
        }
    }
    return { fullParts: full, stringTokens };
}

function collectVariableNames(parts: GrammarPart[]): Set<string> {
    const out = new Set<string>();
    for (const p of parts) {
        if (
            (p.type === "wildcard" ||
                p.type === "number" ||
                p.type === "rules") &&
            p.variable !== undefined
        ) {
            out.add(p.variable);
        }
    }
    return out;
}

function bindingName(p: GrammarPart): string | undefined {
    if (p.type === "wildcard" || p.type === "number" || p.type === "rules") {
        return p.variable;
    }
    return undefined;
}

function collectVariableReferences(node: CompiledValueNode): Set<string> {
    const out = new Set<string>();
    const walk = (n: CompiledValueNode) => {
        switch (n.type) {
            case "literal":
                return;
            case "variable":
                out.add(n.name);
                return;
            case "object":
                for (const el of n.value) {
                    if (el.type === "spread") {
                        walk(el.argument);
                    } else if (el.value === null) {
                        // Shorthand { foo } = { foo: foo }
                        out.add(el.key);
                    } else {
                        walk(el.value);
                    }
                }
                return;
            case "array":
                for (const v of n.value) walk(v);
                return;
            case "binaryExpression":
                walk(n.left);
                walk(n.right);
                return;
            case "unaryExpression":
                walk(n.operand);
                return;
            case "conditionalExpression":
                walk(n.test);
                walk(n.consequent);
                walk(n.alternate);
                return;
            case "memberExpression":
                walk(n.object);
                if (typeof n.property !== "string") walk(n.property);
                return;
            case "callExpression":
                walk(n.callee);
                for (const a of n.arguments) walk(a);
                return;
            case "spreadElement":
                walk(n.argument);
                return;
            case "templateLiteral":
                for (const e of n.expressions) walk(e);
                return;
        }
    };
    walk(node);
    return out;
}

function buildPrefixRemap(
    canonicalParts: GrammarPart[],
    memberParts: GrammarPart[],
    sharedLen: number,
): Map<string, string> {
    const remap = new Map<string, string>();
    for (let i = 0; i < sharedLen; i++) {
        const cv = bindingName(canonicalParts[i]);
        const mv = bindingName(memberParts[i]);
        if (cv !== undefined && mv !== undefined && cv !== mv) {
            remap.set(mv, cv);
        }
    }
    return remap;
}

function remapPartVariables(
    part: GrammarPart,
    remap: Map<string, string>,
): GrammarPart {
    if (remap.size === 0) return part;
    switch (part.type) {
        case "wildcard":
        case "number":
            if (part.variable && remap.has(part.variable)) {
                return { ...part, variable: remap.get(part.variable)! };
            }
            return part;
        case "rules":
            // Rename this part's own variable; do NOT recurse into nested
            // rules — those have their own scope.
            if (part.variable && remap.has(part.variable)) {
                return { ...part, variable: remap.get(part.variable)! };
            }
            return part;
        case "string":
        case "phraseSet":
            return part;
    }
}

function remapValueVariables(
    node: CompiledValueNode,
    remap: Map<string, string>,
): CompiledValueNode {
    if (remap.size === 0) return node;
    switch (node.type) {
        case "literal":
            return node;
        case "variable":
            if (remap.has(node.name)) {
                return { ...node, name: remap.get(node.name)! };
            }
            return node;
        case "object": {
            const value: CompiledObjectElement[] = node.value.map((el) => {
                if (el.type === "spread") {
                    return {
                        ...el,
                        argument: remapValueVariables(el.argument, remap),
                    };
                }
                if (el.value === null) {
                    // Shorthand { foo } = { foo: foo }.  If the key is
                    // being remapped, expand to a full property so the
                    // key (object field name) stays the same while the
                    // value references the new variable name.
                    if (remap.has(el.key)) {
                        return {
                            ...el,
                            value: {
                                type: "variable" as const,
                                name: remap.get(el.key)!,
                            },
                        };
                    }
                    return el;
                }
                return {
                    ...el,
                    value: remapValueVariables(el.value, remap),
                };
            });
            return { ...node, value };
        }
        case "array":
            return {
                ...node,
                value: node.value.map((v) => remapValueVariables(v, remap)),
            };
        case "binaryExpression":
            return {
                ...node,
                left: remapValueVariables(node.left, remap),
                right: remapValueVariables(node.right, remap),
            };
        case "unaryExpression":
            return {
                ...node,
                operand: remapValueVariables(node.operand, remap),
            };
        case "conditionalExpression":
            return {
                ...node,
                test: remapValueVariables(node.test, remap),
                consequent: remapValueVariables(node.consequent, remap),
                alternate: remapValueVariables(node.alternate, remap),
            };
        case "memberExpression":
            return {
                ...node,
                object: remapValueVariables(node.object, remap),
                property:
                    typeof node.property === "string"
                        ? node.property
                        : remapValueVariables(node.property, remap),
            };
        case "callExpression":
            return {
                ...node,
                callee: remapValueVariables(node.callee, remap),
                arguments: node.arguments.map((a) =>
                    remapValueVariables(a, remap),
                ),
            };
        case "spreadElement":
            return {
                ...node,
                argument: remapValueVariables(node.argument, remap),
            };
        case "templateLiteral":
            return {
                ...node,
                expressions: node.expressions.map((e) =>
                    remapValueVariables(e, remap),
                ),
            };
    }
}

/**
 * Replace every reference to the variable `name` in `node` with a deep
 * copy of `replacement`.  Used by the inliner when a child rule with an
 * explicit value expression is folded into its parent: the parent's
 * value expression's reference to the captured variable is substituted
 * with the child's own value expression.
 */
function substituteValueVariable(
    node: CompiledValueNode,
    name: string,
    replacement: CompiledValueNode,
): CompiledValueNode {
    switch (node.type) {
        case "literal":
            return node;
        case "variable":
            return node.name === name ? replacement : node;
        case "object": {
            const value: CompiledObjectElement[] = node.value.map((el) => {
                if (el.type === "spread") {
                    return {
                        ...el,
                        argument: substituteValueVariable(
                            el.argument,
                            name,
                            replacement,
                        ),
                    };
                }
                if (el.value === null) {
                    // Shorthand { foo } = { foo: foo }.  If the key is
                    // the variable being substituted, expand to the
                    // full property form { foo: <replacement> }.
                    if (el.key === name) {
                        return { ...el, value: replacement };
                    }
                    return el;
                }
                return {
                    ...el,
                    value: substituteValueVariable(el.value, name, replacement),
                };
            });
            return { ...node, value };
        }
        case "array":
            return {
                ...node,
                value: node.value.map((v) =>
                    substituteValueVariable(v, name, replacement),
                ),
            };
        case "binaryExpression":
            return {
                ...node,
                left: substituteValueVariable(node.left, name, replacement),
                right: substituteValueVariable(node.right, name, replacement),
            };
        case "unaryExpression":
            return {
                ...node,
                operand: substituteValueVariable(
                    node.operand,
                    name,
                    replacement,
                ),
            };
        case "conditionalExpression":
            return {
                ...node,
                test: substituteValueVariable(node.test, name, replacement),
                consequent: substituteValueVariable(
                    node.consequent,
                    name,
                    replacement,
                ),
                alternate: substituteValueVariable(
                    node.alternate,
                    name,
                    replacement,
                ),
            };
        case "memberExpression":
            return {
                ...node,
                object: substituteValueVariable(node.object, name, replacement),
                property:
                    typeof node.property === "string"
                        ? node.property
                        : substituteValueVariable(
                              node.property,
                              name,
                              replacement,
                          ),
            };
        case "callExpression":
            return {
                ...node,
                callee: substituteValueVariable(node.callee, name, replacement),
                arguments: node.arguments.map((a) =>
                    substituteValueVariable(a, name, replacement),
                ),
            };
        case "spreadElement":
            return {
                ...node,
                argument: substituteValueVariable(
                    node.argument,
                    name,
                    replacement,
                ),
            };
        case "templateLiteral":
            return {
                ...node,
                expressions: node.expressions.map((e) =>
                    substituteValueVariable(e, name, replacement),
                ),
            };
    }
}
