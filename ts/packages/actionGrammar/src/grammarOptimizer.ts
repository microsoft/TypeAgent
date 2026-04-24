// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import registerDebug from "debug";
import {
    CompiledObjectElement,
    CompiledSpacingMode,
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
     *
     * Also factors the top-level `Grammar.rules` array against itself,
     * which **destroys the 1:1 correspondence between top-level rule
     * indices and the original source**.  Downstream consumers that
     * depend on that mapping (e.g. for diagnostics that quote a source
     * rule by index) must capture it before this pass runs.
     */
    factorCommonPrefixes?: boolean;
};

/**
 * Recommended preset enabling all optimizations.  Use this when callers
 * want every safe pass on without naming each flag individually \u2014 future
 * passes added here will be picked up automatically.
 *
 * Caveat: enabling `factorCommonPrefixes` destroys the 1:1
 * correspondence between top-level rule indices and the original
 * source.  Callers that need that mapping for diagnostics must capture
 * it before optimization runs.
 */
export const recommendedOptimizations: GrammarOptimizationOptions = {
    inlineSingleAlternatives: true,
    factorCommonPrefixes: true,
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
            // Factoring never emits a single-alternative wrapper itself
            // (factorRulesPart only wraps when members.length >= 2), but
            // the suffix RulesParts it builds can contain inner
            // single-alternative RulesParts that were not visible to
            // Pass 1 in their pre-factored shape.  Re-run the inliner so
            // those collapse.
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
    // Single-pass: only allocate `next` once an element actually changes,
    // then back-fill prior unchanged entries.  Avoids the wasted map+some
    // walk when no rule in this array is rewritten.
    let next: GrammarRule[] | undefined;
    for (let i = 0; i < rules.length; i++) {
        const r = inlineRule(rules[i], counter, memo, refCounts);
        if (next !== undefined) {
            next.push(r);
        } else if (r !== rules[i]) {
            next = rules.slice(0, i);
            next.push(r);
        }
    }
    const result = next ?? rules;
    memo.set(rules, result);
    return result;
}

function inlineRule(
    rule: GrammarRule,
    counter: { inlined: number },
    memo: RulesArrayMemo,
    refCounts: Map<GrammarRule[], number>,
): GrammarRule {
    // Per-parent-rule counter for opaque α-rename names.  Shared
    // across every `tryInlineRulesPart` call for this rule so two
    // inlinings into the same parent never mint the same fresh name.
    const renameState: RenameState = { next: 0 };
    const { parts, changed, valueSubstitutions, valueAssignment } = inlineParts(
        rule.parts,
        rule,
        counter,
        memo,
        refCounts,
        renameState,
    );
    if (!changed) {
        return rule;
    }
    let value = rule.value;
    if (value === undefined && valueAssignment !== undefined) {
        value = valueAssignment;
    }
    if (valueSubstitutions.length > 0 && value !== undefined) {
        const subs = new Map<string, CompiledValueNode>();
        for (const sub of valueSubstitutions) {
            subs.set(sub.variable, sub.replacement);
        }
        value = substituteValueVariables(value, subs);
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
     * have computed via its default-value rule (i.e. the captured child
     * rule's value).  At most one assignment is possible per parent
     * rule: the matcher's default-value rule requires exactly one
     * variable on the parent, so two inlinings each producing a
     * valueAssignment would mean the parent originally had two
     * variables and `hasValue=false` — a grammar the compiler
     * rejects (or warns about).
     */
    valueAssignment?: CompiledValueNode;
};

/** Per-parent-rule fresh-name counter used by α-renaming. */
type RenameState = { next: number };

function inlineParts(
    parts: GrammarPart[],
    parentRule: GrammarRule,
    counter: { inlined: number },
    memo: RulesArrayMemo,
    refCounts: Map<GrammarRule[], number>,
    renameState: RenameState,
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
            : tryInlineRulesPart(rewritten, parentRule, renameState);
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
                // no value of its own and the matcher's default-value
                // rule would have used child.value as the parent's
                // result — see TryInlineResult.valueAssignment for why
                // this can fire at most once per parent rule.
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
    renameState: RenameState,
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
    // observable to the matcher in two ways; we handle each, and
    // otherwise the value is dead and can be dropped:
    //
    //   (Hoist)        parent has no value of its own and exactly one
    //                  part (this RulesPart).  Synthesize a value
    //                  assignment from child.value onto the parent —
    //                  this is what the matcher's single-part
    //                  default-value rule would have computed at
    //                  runtime.
    //
    //   (Substitute)   parent captures via `part.variable` AND has
    //                  its own value expression.  Substitute
    //                  child.value for the captured variable in
    //                  parent.value.
    //
    //   (Drop)         child.value is unobservable: inline child.parts
    //                  and forget the value.
    //
    // The Substitute and Drop cases share the same parts handling —
    // child's top-level bindings are α-renamed (so they can't collide
    // with parent's other parts) and the renamed child.value is
    // either folded into parent.value (Substitute) or discarded
    // (Drop).  child.value's references to child's own part bindings
    // remain in scope after inlining since those bindings move from
    // child.parts → parent.parts.
    if (child.value !== undefined) {
        // α-rename child's top-level bindings to fresh opaque names so
        // they can't collide with any other top-level bindings the
        // parent already has, and apply the same remap to child.value.
        // Skipped when parent has only this RulesPart as its single
        // part — there are no siblings to collide with.
        const { parts: renamedParts, value: renamedValue } =
            parentRule.parts.length === 1
                ? { parts: child.parts, value: child.value }
                : renameAllChildBindings(child.parts, child.value, renameState);

        // (Hoist) Parent has no value of its own and the matcher
        // would have computed the parent's value via its
        // default-value rule using `child.value` — either because
        // parent has a single part (this RulesPart) or because
        // parent's only variable is `part.variable` (which captured
        // child.value at runtime).  Synthesize that assignment
        // explicitly.
        if (
            parentRule.value === undefined &&
            (parentRule.parts.length === 1 || part.variable !== undefined)
        ) {
            return {
                parts: renamedParts,
                valueAssignment: renamedValue!,
            };
        }

        // (Substitute) parent captures via `part.variable` AND has
        // its own value expression — fold the renamed child.value
        // into it.  When parent.value doesn't reference
        // `part.variable` the substitution is a no-op walk and we
        // get the same result as the drop case.
        if (part.variable !== undefined && parentRule.value !== undefined) {
            return {
                parts: renamedParts,
                valueSubstitution: {
                    variable: part.variable,
                    replacement: renamedValue!,
                },
            };
        }

        // (Drop) child.value is unobservable at runtime; drop it and
        // inline only the renamed child.parts.
        return { parts: renamedParts };
    }

    // If the parent expects to capture this RulesPart into a variable, the
    // child rule must provide exactly one binding-friendly part to take
    // the variable name; otherwise we'd silently drop the binding.
    // Multiple variable-bearing parts would mean child relied on an
    // explicit value expression (which the no-value branch rules out)
    // or violated the matcher's default-value contract; either way we
    // can't safely re-target the parent's binding.  Other parts in
    // child (string / phraseSet literals) come along unchanged.
    if (part.variable !== undefined) {
        let bindingIdx = -1;
        let bindingCp:
            | Extract<GrammarPart, { type: "wildcard" | "number" | "rules" }>
            | undefined;
        for (let i = 0; i < child.parts.length; i++) {
            const cp = child.parts[i];
            if (
                cp.type === "wildcard" ||
                cp.type === "number" ||
                cp.type === "rules"
            ) {
                if (bindingIdx !== -1) {
                    return undefined;
                }
                bindingIdx = i;
                bindingCp = cp;
            }
        }
        if (bindingCp === undefined) {
            return undefined;
        }
        const newParts = child.parts.slice();
        newParts[bindingIdx] = { ...bindingCp, variable: part.variable };
        // No duplicate-name guard here: if the parent already had two
        // top-level parts bound to `part.variable` (the RulesPart and
        // some sibling), that collision predates inlining and the
        // matcher's behavior on it is unchanged when we replace the
        // RulesPart with a wildcard/number/rules part bound to the
        // same name.
        return { parts: newParts };
    }

    return { parts: child.parts };
}

// ─────────────────────────────────────────────────────────────────────────────
// Optimization #2: factor common prefixes across alternatives
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Walk all RulesParts and factor common leading parts shared by two or
 * more alternatives within the same RulesPart.  After nested factoring
 * completes, the top-level `Grammar.rules` array is also factored against
 * itself: the matcher treats top-level alternatives the same way it
 * treats inner `RulesPart` alternatives (each is queued as its own
 * `MatchState` and produces its own result), so factoring is semantically
 * safe.  This intentionally destroys the 1:1 correspondence between
 * top-level rule indices and the original source — that mapping must be
 * recovered via separate metadata if needed downstream.
 *
 * Uses an identity memo over `GrammarRule[]` arrays so shared named
 * rules (multiple `RulesPart`s pointing at the same array) still share
 * after the pass — see `inlineSingleAlternativeRules` for rationale.
 */
export function factorCommonPrefixes(rules: GrammarRule[]): GrammarRule[] {
    const counter = { factored: 0 };
    const memo: RulesArrayMemo = new Map();
    let result = factorRulesArray(rules, counter, memo);

    // Top-level factoring: the matcher treats top-level alternatives the
    // same way it treats inner `RulesPart` alternatives (each is queued
    // as its own `MatchState` and produces its own result), so the same
    // trie-based factoring applies.  Newly synthesized suffix
    // `RulesPart`s produced here are not themselves re-walked, matching
    // the existing behavior for nested factoring.
    result = factorRules(result, counter);

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
    // Single-pass: only allocate `next` once an element actually changes
    // (see inlineRulesArray for rationale).
    let next: GrammarRule[] | undefined;
    for (let i = 0; i < rules.length; i++) {
        const r = factorRule(rules[i], counter, memo);
        if (next !== undefined) {
            next.push(r);
        } else if (r !== rules[i]) {
            next = rules.slice(0, i);
            next.push(r);
        }
    }
    const result = next ?? rules;
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
    // Single-pass: only allocate `out` once an element actually changes
    // (mirrors `factorRulesArray` / `inlineRulesArray`).
    let out: GrammarPart[] | undefined;
    for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        if (p.type !== "rules") {
            if (out !== undefined) out.push(p);
            continue;
        }
        // Recurse into nested rules first, preserving shared-array
        // identity via memo.
        const recursedRules = factorRulesArray(p.rules, counter, memo);
        const recursed: RulesPart =
            recursedRules !== p.rules ? { ...p, rules: recursedRules } : p;

        const working = factorRulesPart(recursed, counter);
        if (out !== undefined) {
            out.push(working);
        } else if (working !== p) {
            out = parts.slice(0, i);
            out.push(working);
        }
    }
    return out !== undefined
        ? { parts: out, changed: true }
        : { parts, changed: false };
}

/**
 * Common-prefix factoring inside a single RulesPart.  Thin wrapper
 * around `factorRules` that respects the `RulesPart`'s repeat/optional
 * flags (which change matcher loop-back semantics and so block
 * factoring) and re-wraps the factored alternatives back into the
 * `RulesPart` shape on success.
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
    const factored = factorRules(part.rules, counter);
    if (factored === part.rules) return part;
    return { ...part, rules: factored };
}

/**
 * Common-prefix factoring over a flat list of alternatives, implemented
 * as a trie-build + post-order emission.  Used both for the
 * alternatives inside a single `RulesPart` (via `factorRulesPart`) and
 * for the top-level `Grammar.rules` array (which the matcher treats
 * the same way as inner alternatives).
 *
 * Each rule is inserted as a sequence of "atomic" steps:
 *   - StringPart explodes into one ("string", token) edge per token in
 *     `value[]` (so `["play", "song"]` and `["play", "album"]` share the
 *     "play" edge but branch at "song"/"album");
 *   - VarStringPart, VarNumberPart, RulesPart, PhraseSetPart each yield
 *     one edge.  RulesPart edges key by `rules` array identity so that
 *     two `<RuleName>` references share the same edge — preserving the
 *     dedup invariant `grammarSerializer.ts` relies on.
 *
 * Variables on wildcard/number/rules edges are carried by the first
 * inserter; later inserters with different names accumulate a per-rule
 * remap (local→canonical) that is applied to the terminal's `value` at
 * emission time.
 *
 * Emission walks the trie post-order: single-child / no-terminal chains
 * are path-compressed back into a flat parts array (with adjacent
 * StringParts re-merged), and multi-member nodes become wrapper
 * `RulesPart`s.  Per-fork eligibility checks are applied at each wrapper
 * site; failure causes a *local* bailout — the would-be members are
 * emitted as separate full rules with the canonical prefix prepended,
 * losing factoring at that fork only (factoring above and below the
 * fork still applies).
 *
 * Returns the same array if no factoring took place.
 */
function factorRules(
    rules: GrammarRule[],
    counter: { factored: number },
): GrammarRule[] {
    if (rules.length < 2) return rules;

    const buildState: BuildState = {
        nextCanonicalId: 0,
        rulesArrayIds: new WeakMap(),
        nextRulesArrayId: 0,
    };
    const root: TrieRoot = { children: new Map(), terminals: [] };
    for (let i = 0; i < rules.length; i++) {
        insertRuleIntoTrie(root, rules[i], i, buildState);
    }

    const state: EmitState = { didFactor: false };
    const items: { idx: number; rules: GrammarRule[] }[] = [];
    for (const c of root.children.values()) {
        items.push({
            idx: c.firstIdx,
            rules: emitFromNode(c, state, buildState),
        });
    }
    items.sort((a, b) => a.idx - b.idx);
    const newRules: GrammarRule[] = items.flatMap((it) => it.rules);

    if (!state.didFactor) return rules;
    counter.factored++;
    return newRules;
}

// ── Trie data structures ─────────────────────────────────────────────────

// Variable handling notes
// ------------------------
// Variable-bearing edges (wildcard/number, and bound rules) carry an
// **opaque canonical** name (`__opt_v_<n>`) allocated at insertion
// time, *not* the source's variable name.  This avoids two collision
// classes that any "first inserter wins" scheme is vulnerable to:
//
//   (a) A non-lead inserter's value expression references an outer-
//       scope variable whose name happens to match the lead's local
//       binding.  Renaming the local onto the lead would silently
//       shadow the outer name.
//
//   (b) A `rules` edge is bound on one inserter and unbound on
//       another; merging would either invent a binding the unbound
//       inserter never had or drop a binding the bound inserter
//       depends on.
//
// (a) is solved by canonicals being opaque: `__opt_v_<n>` cannot
// collide with any user-named variable.  (b) is solved by the parity
// check in `edgeKeyMatches` for the `rules` kind: bound and unbound
// references no longer merge into the same trie edge.
//
// `partsToEdgeSteps` yields *steps* describing the source (with
// `local` field), `insertRuleIntoTrie` matches steps against existing
// edges and either reuses an edge (recording `local → canonical` in
// the per-rule remap) or allocates a new edge with a fresh canonical.
// Every inserter — *including the lead* — records its remap; the lead
// is no longer an exception because its local also differs from the
// canonical.

type TrieStep =
    | { kind: "string"; token: string }
    | { kind: "wildcard"; typeName: string; optional: boolean; local: string }
    | { kind: "number"; optional: boolean; local: string }
    | {
          kind: "rules";
          rules: GrammarRule[];
          optional: boolean;
          repeat: boolean;
          name: string | undefined;
          local: string | undefined;
      }
    | { kind: "phraseSet"; matcherName: string };

type TrieEdge =
    | { kind: "string"; token: string }
    | {
          kind: "wildcard";
          typeName: string;
          optional: boolean;
          canonical: string;
      }
    | { kind: "number"; optional: boolean; canonical: string }
    | {
          kind: "rules";
          rules: GrammarRule[];
          optional: boolean;
          repeat: boolean;
          name: string | undefined;
          /** undefined iff every inserter at this edge was unbound. */
          canonical: string | undefined;
      }
    | { kind: "phraseSet"; matcherName: string };

type Terminal = {
    idx: number;
    value: CompiledValueNode | undefined;
    spacingMode: CompiledSpacingMode | undefined;
    /** local→canonical variable rename accumulated along the path. */
    remap: Map<string, string>;
};

/**
 * Per-`factorRulesPart`-invocation counter used to mint opaque canonical
 * variable names (`__opt_v_<n>` and `__opt_factor_<n>`) on
 * variable-bearing trie edges and on synthesized wrapper bindings,
 * plus an interner for `GrammarRule[]` array identities (used to build
 * a primitive-keyed children Map without losing array-identity merging
 * for `<RuleName>` references).
 *
 * Scope is one `RulesPart` because canonicals never escape the wrapper
 * rule we're about to emit — a fresh BuildState per invocation is
 * enough to guarantee within-RulesPart uniqueness.  Distinct from
 * `RenameState` (which scopes per-parent-rule and produces
 * `__opt_inline_<n>` names for the inliner pass).
 */
type BuildState = {
    nextCanonicalId: number;
    rulesArrayIds: WeakMap<GrammarRule[], number>;
    nextRulesArrayId: number;
};

function freshCanonical(state: BuildState): string {
    return `__opt_v_${state.nextCanonicalId++}`;
}

/**
 * Mint a fresh wrapper-binding name for `buildWrapperRule`.  Uses the
 * same counter as `freshCanonical` so the names are guaranteed unique
 * across the whole `factorRules` invocation; the distinct prefix makes
 * synthesized wrapper bindings easy to spot in serialized grammars.
 */
function freshWrapperBinding(state: BuildState): string {
    return `__opt_factor_${state.nextCanonicalId++}`;
}

function rulesArrayId(state: BuildState, rules: GrammarRule[]): number {
    let id = state.rulesArrayIds.get(rules);
    if (id === undefined) {
        id = state.nextRulesArrayId++;
        state.rulesArrayIds.set(rules, id);
    }
    return id;
}

/**
 * Compute a primitive merge key for a trie step.  Two steps with
 * the same key share a child node at insertion time — the same
 * pairing `edgeKeyMatches` performs by walking sibling edges, but
 * O(1) via a `Map<string, TrieNode>` lookup.  For variable-bearing
 * kinds the variable *name* is omitted (names are remapped); for
 * `rules` edges the binding presence (bound vs. unbound) is encoded
 * so they don't merge — mirrors the parity check in `edgeKeyMatches`.
 */
function stepMergeKey(step: TrieStep, state: BuildState): string {
    switch (step.kind) {
        case "string":
            return `s:${step.token}`;
        case "wildcard":
            return `w:${step.typeName}:${step.optional ? 1 : 0}`;
        case "number":
            return `n:${step.optional ? 1 : 0}`;
        case "rules": {
            const id = rulesArrayId(state, step.rules);
            return `r:${id}:${step.optional ? 1 : 0}:${step.repeat ? 1 : 0}:${step.local !== undefined ? 1 : 0}`;
        }
        case "phraseSet":
            return `p:${step.matcherName}`;
    }
}

/**
 * Root of the trie.  Distinct from `TrieNode` so that `edge` can be
 * required on every non-root node — eliminating non-null assertions in
 * the insertion and emission code.  Terminals on the root represent
 * empty-parts input rules (rare but legal).
 *
 * `children` is a `Map<mergeKey, TrieNode>` keyed by `stepMergeKey` so
 * insertion is O(1) per step rather than O(siblings); JS Maps preserve
 * insertion order, so emission still walks children in the order they
 * were first inserted.
 */
type TrieRoot = {
    children: Map<string, TrieNode>;
    terminals: Terminal[];
};

type TrieNode = {
    edge: TrieEdge;
    children: Map<string, TrieNode>;
    terminals: Terminal[];
    /** Lowest insertion index of any rule passing through this node. */
    firstIdx: number;
};

type EmitState = { didFactor: boolean };

/** A node is "linear" iff it has no terminals and exactly one child. */
function isLinearNode(n: TrieNode): boolean {
    return n.terminals.length === 0 && n.children.size === 1;
}

/** Return the sole child of a linear node (caller must guarantee linearity). */
function onlyChild(n: TrieNode): TrieNode {
    // Caller guarantees `n.children.size === 1` via `isLinearNode`.
    // Map iteration is insertion order; for size===1 there's one entry.
    const first = n.children.values().next().value;
    return first as TrieNode;
}

// ── Trie insertion ───────────────────────────────────────────────────────

function insertRuleIntoTrie(
    root: TrieRoot,
    rule: GrammarRule,
    idx: number,
    buildState: BuildState,
): void {
    let children = root.children;
    let terminals = root.terminals;
    const remap = new Map<string, string>();
    for (const step of partsToEdgeSteps(rule.parts)) {
        const key = stepMergeKey(step, buildState);
        let matched = children.get(key);
        if (matched === undefined) {
            matched = {
                edge: stepToEdge(step, buildState),
                children: new Map(),
                terminals: [],
                firstIdx: idx,
            };
            children.set(key, matched);
        }
        recordStepRemap(matched.edge, step, remap);
        children = matched.children;
        terminals = matched.terminals;
    }
    terminals.push({
        idx,
        value: rule.value,
        spacingMode: rule.spacingMode,
        remap,
    });
}

/** Yield each rule.parts as a sequence of trie steps (StringPart explodes). */
function* partsToEdgeSteps(parts: GrammarPart[]): Generator<TrieStep> {
    for (const p of parts) {
        switch (p.type) {
            case "string":
                for (const tok of p.value) yield { kind: "string", token: tok };
                break;
            case "wildcard":
                yield {
                    kind: "wildcard",
                    typeName: p.typeName,
                    optional: !!p.optional,
                    local: p.variable,
                };
                break;
            case "number":
                yield {
                    kind: "number",
                    optional: !!p.optional,
                    local: p.variable,
                };
                break;
            case "rules":
                yield {
                    kind: "rules",
                    rules: p.rules,
                    optional: !!p.optional,
                    repeat: !!p.repeat,
                    name: p.name,
                    local: p.variable,
                };
                break;
            case "phraseSet":
                yield { kind: "phraseSet", matcherName: p.matcherName };
                break;
        }
    }
}

/** Allocate a new trie edge from a step, minting a fresh canonical when needed. */
function stepToEdge(step: TrieStep, buildState: BuildState): TrieEdge {
    switch (step.kind) {
        case "string":
        case "phraseSet":
            return step;
        case "wildcard":
            return {
                kind: "wildcard",
                typeName: step.typeName,
                optional: step.optional,
                canonical: freshCanonical(buildState),
            };
        case "number":
            return {
                kind: "number",
                optional: step.optional,
                canonical: freshCanonical(buildState),
            };
        case "rules":
            return {
                kind: "rules",
                rules: step.rules,
                optional: step.optional,
                repeat: step.repeat,
                name: step.name,
                canonical:
                    step.local !== undefined
                        ? freshCanonical(buildState)
                        : undefined,
            };
    }
}

/**
 * Record the `local → canonical` rename for one inserter at one trie
 * step.  Throws on conflict (same local mapped to two canonicals on
 * the same path), which would indicate either a malformed source rule
 * with duplicate local names or a bug in the trie insertion logic.
 */
function recordStepRemap(
    edge: TrieEdge,
    step: TrieStep,
    remap: Map<string, string>,
): void {
    if (edge.kind === "string" || edge.kind === "phraseSet") return;
    const local = (step as { local: string | undefined }).local;
    const canonical = edge.canonical;
    if (local === undefined || canonical === undefined) return;
    const prior = remap.get(local);
    if (prior !== undefined && prior !== canonical) {
        throw new Error(
            `Internal optimizer error: variable '${local}' bound to multiple canonicals ('${prior}' then '${canonical}')`,
        );
    }
    remap.set(local, canonical);
}

// ── Trie emission ────────────────────────────────────────────────────────

function edgeToPart(edge: TrieEdge): GrammarPart {
    switch (edge.kind) {
        case "string":
            return { type: "string", value: [edge.token] };
        case "wildcard": {
            const out: GrammarPart = {
                type: "wildcard",
                typeName: edge.typeName,
                variable: edge.canonical,
            };
            if (edge.optional) out.optional = true;
            return out;
        }
        case "number": {
            const out: GrammarPart = {
                type: "number",
                variable: edge.canonical,
            };
            if (edge.optional) out.optional = true;
            return out;
        }
        case "rules": {
            const out: RulesPart = { type: "rules", rules: edge.rules };
            if (edge.canonical !== undefined) {
                out.variable = edge.canonical;
            }
            if (edge.optional) out.optional = true;
            if (edge.repeat) out.repeat = true;
            if (edge.name !== undefined) out.name = edge.name;
            return out;
        }
        case "phraseSet":
            return { type: "phraseSet", matcherName: edge.matcherName };
    }
}

/**
 * Append `part` to `prefix` in place, folding when both ends are
 * StringParts (i.e. merging `last.value` and `part.value` into one
 * `StringPart`).  Mutating in place keeps path-compression linear in
 * chain depth — returning a fresh array on every step would be
 * O(depth²).
 */
function appendPartInPlace(prefix: GrammarPart[], part: GrammarPart): void {
    if (prefix.length === 0) {
        prefix.push(part);
        return;
    }
    const last = prefix[prefix.length - 1];
    if (last.type === "string" && part.type === "string") {
        prefix[prefix.length - 1] = {
            type: "string",
            value: [...last.value, ...part.value],
        };
        return;
    }
    prefix.push(part);
}

/** Concatenate two parts arrays, folding at the seam if both ends are strings. */
function concatParts(a: GrammarPart[], b: GrammarPart[]): GrammarPart[] {
    if (a.length === 0) return b.slice();
    if (b.length === 0) return a.slice();
    const last = a[a.length - 1];
    const first = b[0];
    if (last.type === "string" && first.type === "string") {
        const merged: GrammarPart = {
            type: "string",
            value: [...last.value, ...first.value],
        };
        return [...a.slice(0, a.length - 1), merged, ...b.slice(1)];
    }
    return [...a, ...b];
}

function terminalToRule(t: Terminal): GrammarRule {
    let value = t.value;
    if (value !== undefined && t.remap.size > 0) {
        value = remapValueVariables(value, t.remap);
    }
    const out: GrammarRule = { parts: [] };
    if (value !== undefined) out.value = value;
    if (t.spacingMode !== undefined) out.spacingMode = t.spacingMode;
    return out;
}

/**
 * Emit the subtree rooted at `node` (whose edge becomes the first part).
 *   - Returns one rule when the subtree is a single linear path or
 *     factors cleanly at the first fork.
 *   - Returns multiple when a fork's eligibility check failed (bailout):
 *     each would-be member is emitted as a full rule with the canonical
 *     prefix prepended.
 */
function emitFromNode(
    node: TrieNode,
    state: EmitState,
    buildState: BuildState,
): GrammarRule[] {
    // Path-compress: walk down single-child / no-terminal chain, but
    // stop *before* entering a node that would itself be a fork — that
    // way the fork's edge becomes the first part of each emitted member
    // (avoiding empty-parts members at the fork, which would defeat
    // factoring via the wholeConsumed-with-value check below).
    const prefix: GrammarPart[] = [edgeToPart(node.edge)];
    let current = node;
    while (
        current.terminals.length === 0 &&
        current.children.size === 1 &&
        isLinearNode(onlyChild(current))
    ) {
        current = onlyChild(current);
        appendPartInPlace(prefix, edgeToPart(current.edge));
    }

    // Members at this fork = its terminals (each as an empty-parts rule)
    // plus each child's emitted subtree (in original insertion order).
    const items: { idx: number; rules: GrammarRule[] }[] = [];
    for (const t of current.terminals) {
        items.push({ idx: t.idx, rules: [terminalToRule(t)] });
    }
    for (const c of current.children.values()) {
        items.push({
            idx: c.firstIdx,
            rules: emitFromNode(c, state, buildState),
        });
    }
    items.sort((a, b) => a.idx - b.idx);
    const members: GrammarRule[] = items.flatMap((it) => it.rules);

    if (members.length === 0) {
        // Defensive: every reachable node has terminals or children.
        return [{ parts: prefix }];
    }
    if (members.length === 1) {
        const m = members[0];
        return [{ ...m, parts: concatParts(prefix, m.parts) }];
    }

    // Multi-member fork: try to wrap; bail out if any check fails.
    if (checkFactoringEligible(members) !== undefined) {
        return members.map((m) => ({
            ...m,
            parts: concatParts(prefix, m.parts),
        }));
    }
    state.didFactor = true;
    return [buildWrapperRule(prefix, members, buildState)];
}

/**
 * Per-fork eligibility checks (lifted from the previous implementation).
 * Returns `undefined` when factoring is safe, or a short reason string.
 */
function checkFactoringEligible(members: GrammarRule[]): string | undefined {
    // Empty-parts members never compose cleanly inside a wrapped
    // RulesPart: with a value, the matcher would have to treat
    // `{parts:[], value: V}` as a degenerate match (today's algorithm
    // refuses this); without a value, the matcher's default-value
    // resolver throws ("missing value for default") because the
    // empty-parts rule has nothing to default from.
    if (members.some((m) => m.parts.length === 0)) {
        return "whole-consumed";
    }
    const valuePresence = members.map((m) => m.value !== undefined);
    const allHaveValue = valuePresence.every((v) => v);
    const noneHaveValue = valuePresence.every((v) => !v);
    if (!allHaveValue && !noneHaveValue) {
        return "mixed-value-presence";
    }
    if (noneHaveValue) {
        // The matcher synthesizes an implicit text-concatenation
        // default value only for single-part rules whose sole part
        // is a StringPart (`matchStringPartWithoutWildcard` fast
        // path).  After factoring, the wrapper rule becomes
        // `[prefix..., suffixRulesPart]` with parts.length >= 2 and
        // no value expression — the implicit default no longer
        // fires and `createValue` throws "missing value for default"
        // at finalize time.  Without a wrapper variable to
        // synthesize a value into, factoring at this fork breaks
        // matcher behavior whenever the parent rule relied on the
        // implicit default.  Bail out unconditionally.
        return "no-value-implicit-default";
    }
    // Cross-scope-ref: nested rule scope is fresh at the matcher level
    // (entering a `RulesPart` resets `valueIds`).  When members are
    // lifted into a wrapper rule's `suffixRulesPart`, each member
    // becomes an isolated inner rule whose value can only see
    // variables bound in its own `parts` — bindings in the wrapper's
    // prefix, *or* in any ancestor's prefix that has already been
    // incorporated upstream, are no longer visible.
    //
    // We therefore require every variable referenced by a member's
    // value to appear in that member's own top-level part bindings.
    // This subsumes the simpler "member references prefix binding"
    // check, and additionally catches the case where a deeper bailout
    // dragged ancestor-prefix canonical references into a member that
    // doesn't bind them (the bailout-then-factor scenario in
    // playerSchema's `play <TrackPhrase> by <ArtistName> [...]`).
    //
    // Binding-shadow (a member's own binding colliding with a prefix
    // binding) is not reachable: canonicals are opaque `__opt_v_<n>`
    // names allocated globally per `factorRulesPart` call, so two
    // distinct edges always get distinct canonicals.
    for (const m of members) {
        if (m.value === undefined) continue;
        const memberBindings = collectVariableNames(m.parts);
        for (const v of collectVariableReferences(m.value)) {
            if (!memberBindings.has(v)) return "cross-scope-ref";
        }
    }
    return undefined;
}

function buildWrapperRule(
    prefix: GrammarPart[],
    members: GrammarRule[],
    buildState: BuildState,
): GrammarRule {
    const suffixRulesPart: RulesPart = { type: "rules", rules: members };
    const factoredAlt: GrammarRule = {
        parts: [...prefix, suffixRulesPart],
    };
    if (members.some((m) => m.value !== undefined)) {
        // Opaque counter-based name shares `BuildState.nextCanonicalId`
        // with `freshCanonical`, so it can never collide with any
        // canonical edge binding in this `factorRules` invocation — no
        // reserved-set scan needed.
        const gen = freshWrapperBinding(buildState);
        suffixRulesPart.variable = gen;
        factoredAlt.value = { type: "variable", name: gen };
    }
    const firstSpacing = members[0].spacingMode;
    if (
        firstSpacing !== undefined &&
        members.every((m) => m.spacingMode === firstSpacing)
    ) {
        factoredAlt.spacingMode = firstSpacing;
    }
    return factoredAlt;
}

// ── Variable name / value-expression utilities (shared with inliner) ─────

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

/**
 * α-rename every top-level binding in `parts` to a fresh opaque name
 * (`__opt_inline_<n>`), and apply the same remap to `value` if given.
 * Returns the original arrays/nodes when there are no top-level
 * bindings to rename.
 *
 * Only top-level bindings are touched: nested rule scopes are not
 * visible from outside their nested rule and therefore can't collide
 * with anything in the parent we're inlining into.
 */
function renameAllChildBindings(
    parts: GrammarPart[],
    value: CompiledValueNode | undefined,
    renameState: RenameState,
): { parts: GrammarPart[]; value: CompiledValueNode | undefined } {
    let remap: Map<string, string> | undefined;
    let outParts: GrammarPart[] | undefined;
    for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        if (
            (p.type !== "wildcard" &&
                p.type !== "number" &&
                p.type !== "rules") ||
            p.variable === undefined
        ) {
            if (outParts !== undefined) outParts.push(p);
            continue;
        }
        const fresh = `__opt_inline_${renameState.next++}`;
        if (remap === undefined) remap = new Map();
        remap.set(p.variable, fresh);
        if (outParts === undefined) outParts = parts.slice(0, i);
        outParts.push({ ...p, variable: fresh });
    }
    if (remap === undefined) {
        return { parts, value };
    }
    return {
        parts: outParts ?? parts,
        value: value !== undefined ? remapValueVariables(value, remap) : value,
    };
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

function remapValueVariables(
    node: CompiledValueNode,
    remap: Map<string, string>,
): CompiledValueNode {
    if (remap.size === 0) return node;
    // Renaming is just substitution where each replacement is a fresh
    // variable node carrying the new name.
    const subs = new Map<string, CompiledValueNode>();
    for (const [from, to] of remap) {
        subs.set(from, { type: "variable", name: to });
    }
    return substituteValueVariables(node, subs);
}

/**
 * Replace each reference to a variable in `node` with the matching
 * replacement node from `substitutions`.  Variables not present in the
 * map are left untouched.
 *
 * Used in two ways by the inliner / factorer:
 *   - α-rename (via `remapValueVariables`): replacements are fresh
 *     `{ type: "variable", name: <new> }` nodes.
 *   - Value-expression substitution: replacements are arbitrary value
 *     expressions copied from a child rule's `value`.
 *
 * Object shorthand `{ foo }` (which means `{ foo: foo }`) is expanded
 * to a full property `{ foo: <replacement> }` whenever the shorthand
 * key matches a substitution, so the field name on the resulting
 * object stays the same.
 */
function substituteValueVariables(
    node: CompiledValueNode,
    substitutions: Map<string, CompiledValueNode>,
): CompiledValueNode {
    if (substitutions.size === 0) return node;
    const sub = (n: CompiledValueNode): CompiledValueNode =>
        substituteValueVariables(n, substitutions);
    switch (node.type) {
        case "literal":
            return node;
        case "variable": {
            const r = substitutions.get(node.name);
            return r !== undefined ? r : node;
        }
        case "object": {
            const value: CompiledObjectElement[] = node.value.map((el) => {
                if (el.type === "spread") {
                    return { ...el, argument: sub(el.argument) };
                }
                if (el.value === null) {
                    const r = substitutions.get(el.key);
                    if (r !== undefined) {
                        return { ...el, value: r };
                    }
                    return el;
                }
                return { ...el, value: sub(el.value) };
            });
            return { ...node, value };
        }
        case "array":
            return { ...node, value: node.value.map(sub) };
        case "binaryExpression":
            return { ...node, left: sub(node.left), right: sub(node.right) };
        case "unaryExpression":
            return { ...node, operand: sub(node.operand) };
        case "conditionalExpression":
            return {
                ...node,
                test: sub(node.test),
                consequent: sub(node.consequent),
                alternate: sub(node.alternate),
            };
        case "memberExpression":
            return {
                ...node,
                object: sub(node.object),
                property:
                    typeof node.property === "string"
                        ? node.property
                        : sub(node.property),
            };
        case "callExpression":
            return {
                ...node,
                callee: sub(node.callee),
                arguments: node.arguments.map(sub),
            };
        case "spreadElement":
            return { ...node, argument: sub(node.argument) };
        case "templateLiteral":
            return { ...node, expressions: node.expressions.map(sub) };
    }
}
