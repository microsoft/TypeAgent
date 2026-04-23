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

    // Top-level factoring: wrap the (already nested-factored) top-level
    // rules in a synthetic `RulesPart` so we can reuse `factorRulesPart`
    // unchanged.  Newly synthesized suffix `RulesPart`s produced here are
    // not themselves re-walked, matching the existing behavior for nested
    // factoring.
    const wrapper: RulesPart = { type: "rules", rules: result };
    result = factorRulesPart(wrapper, counter).rules;

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
        const recursed: RulesPart =
            recursedRules !== p.rules ? { ...p, rules: recursedRules } : p;

        const working = factorRulesPart(recursed, counter);
        if (working !== p) changed = true;
        out.push(working);
    }
    return { parts: changed ? out : parts, changed };
}

/**
 * Common-prefix factoring inside a single RulesPart, implemented as a
 * trie-build + post-order emission.
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
 * Returns the same object if no factoring took place.
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
    if (part.rules.length < 2) return part;

    const root: TrieRoot = { children: [], terminals: [] };
    for (let i = 0; i < part.rules.length; i++) {
        insertRuleIntoTrie(root, part.rules[i], i);
    }

    const state: EmitState = { didFactor: false };
    const items: { idx: number; rules: GrammarRule[] }[] = [];
    for (const c of root.children) {
        items.push({ idx: c.firstIdx, rules: emitFromNode(c, state) });
    }
    items.sort((a, b) => a.idx - b.idx);
    const newRules: GrammarRule[] = items.flatMap((it) => it.rules);

    if (!state.didFactor) return part;
    counter.factored++;
    return { ...part, rules: newRules };
}

// ── Trie data structures ─────────────────────────────────────────────────

type TrieEdge =
    | { kind: "string"; token: string }
    | {
          kind: "wildcard";
          typeName: string;
          optional: boolean;
          canonicalVariable: string;
      }
    | { kind: "number"; optional: boolean; canonicalVariable: string }
    | {
          kind: "rules";
          rules: GrammarRule[];
          optional: boolean;
          repeat: boolean;
          name: string | undefined;
          canonicalVariable: string | undefined;
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
 * Root of the trie.  Distinct from `TrieNode` so that `edge` can be
 * required on every non-root node — eliminating non-null assertions in
 * the insertion and emission code.  Terminals on the root represent
 * empty-parts input rules (rare but legal).
 */
type TrieRoot = {
    children: TrieNode[];
    terminals: Terminal[];
};

type TrieNode = {
    edge: TrieEdge;
    children: TrieNode[];
    terminals: Terminal[];
    /** Lowest insertion index of any rule passing through this node. */
    firstIdx: number;
};

type EmitState = { didFactor: boolean };

/** A node is "linear" iff it has no terminals and exactly one child. */
function isLinearNode(n: TrieNode): boolean {
    return n.terminals.length === 0 && n.children.length === 1;
}

// ── Trie insertion ───────────────────────────────────────────────────────

function insertRuleIntoTrie(
    root: TrieRoot,
    rule: GrammarRule,
    idx: number,
): void {
    let children = root.children;
    let terminals = root.terminals;
    const remap = new Map<string, string>();
    for (const stepEdge of partsToEdgeSteps(rule.parts)) {
        let matched: TrieNode | undefined;
        for (const c of children) {
            if (edgeKeyMatches(c.edge, stepEdge)) {
                matched = c;
                break;
            }
        }
        if (matched !== undefined) {
            collectStepRemap(matched.edge, stepEdge, remap);
        } else {
            matched = {
                edge: stepEdge,
                children: [],
                terminals: [],
                firstIdx: idx,
            };
            children.push(matched);
        }
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

/** Yield each rule.parts as a sequence of trie edges (StringPart explodes). */
function* partsToEdgeSteps(parts: GrammarPart[]): Generator<TrieEdge> {
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
                    canonicalVariable: p.variable,
                };
                break;
            case "number":
                yield {
                    kind: "number",
                    optional: !!p.optional,
                    canonicalVariable: p.variable,
                };
                break;
            case "rules":
                yield {
                    kind: "rules",
                    rules: p.rules,
                    optional: !!p.optional,
                    repeat: !!p.repeat,
                    name: p.name,
                    canonicalVariable: p.variable,
                };
                break;
            case "phraseSet":
                yield { kind: "phraseSet", matcherName: p.matcherName };
                break;
        }
    }
}

/** True if step's key fields match the existing edge (ignoring variable). */
function edgeKeyMatches(edge: TrieEdge, step: TrieEdge): boolean {
    if (edge.kind !== step.kind) return false;
    // After the kind check, `step` has the same variant as `edge`; the
    // cast inside each branch narrows it accordingly.
    switch (edge.kind) {
        case "string":
            return edge.token === (step as typeof edge).token;
        case "wildcard": {
            const s = step as typeof edge;
            return edge.typeName === s.typeName && edge.optional === s.optional;
        }
        case "number":
            return edge.optional === (step as typeof edge).optional;
        case "rules": {
            const s = step as typeof edge;
            return (
                edge.rules === s.rules &&
                edge.optional === s.optional &&
                edge.repeat === s.repeat
            );
        }
        case "phraseSet":
            return edge.matcherName === (step as typeof edge).matcherName;
    }
}

function collectStepRemap(
    canonicalEdge: TrieEdge,
    stepEdge: TrieEdge,
    remap: Map<string, string>,
): void {
    if (canonicalEdge.kind === "string" || canonicalEdge.kind === "phraseSet") {
        return;
    }
    const canonical = canonicalEdge.canonicalVariable;
    const local = (stepEdge as typeof canonicalEdge).canonicalVariable;
    if (canonical !== undefined && local !== undefined && canonical !== local) {
        remap.set(local, canonical);
    }
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
                variable: edge.canonicalVariable,
            };
            if (edge.optional) out.optional = true;
            return out;
        }
        case "number": {
            const out: GrammarPart = {
                type: "number",
                variable: edge.canonicalVariable,
            };
            if (edge.optional) out.optional = true;
            return out;
        }
        case "rules": {
            const out: RulesPart = { type: "rules", rules: edge.rules };
            if (edge.canonicalVariable !== undefined) {
                out.variable = edge.canonicalVariable;
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

/** Append `part` to `prefix`, folding when both ends are StringParts. */
function appendPart(prefix: GrammarPart[], part: GrammarPart): GrammarPart[] {
    if (prefix.length === 0) return [part];
    const last = prefix[prefix.length - 1];
    if (last.type === "string" && part.type === "string") {
        const merged: GrammarPart = {
            type: "string",
            value: [...last.value, ...part.value],
        };
        return [...prefix.slice(0, prefix.length - 1), merged];
    }
    return [...prefix, part];
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
function emitFromNode(node: TrieNode, state: EmitState): GrammarRule[] {
    // Path-compress: walk down single-child / no-terminal chain, but
    // stop *before* entering a node that would itself be a fork — that
    // way the fork's edge becomes the first part of each emitted member
    // (avoiding empty-parts members at the fork, which would defeat
    // factoring via the wholeConsumed-with-value check below).
    let prefix: GrammarPart[] = [edgeToPart(node.edge)];
    let current = node;
    while (
        current.terminals.length === 0 &&
        current.children.length === 1 &&
        isLinearNode(current.children[0])
    ) {
        current = current.children[0];
        prefix = appendPart(prefix, edgeToPart(current.edge));
    }

    // Members at this fork = its terminals (each as an empty-parts rule)
    // plus each child's emitted subtree (in original insertion order).
    const items: { idx: number; rules: GrammarRule[] }[] = [];
    for (const t of current.terminals) {
        items.push({ idx: t.idx, rules: [terminalToRule(t)] });
    }
    for (const c of current.children) {
        items.push({ idx: c.firstIdx, rules: emitFromNode(c, state) });
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
    if (checkFactoringEligible(prefix, members) !== undefined) {
        return members.map((m) => ({
            ...m,
            parts: concatParts(prefix, m.parts),
        }));
    }
    state.didFactor = true;
    return [buildWrapperRule(prefix, members)];
}

/**
 * Per-fork eligibility checks (lifted from the previous implementation).
 * Returns `undefined` when factoring is safe, or a short reason string.
 */
function checkFactoringEligible(
    prefix: GrammarPart[],
    members: GrammarRule[],
): string | undefined {
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
    if (noneHaveValue && members.some((m) => m.parts.length > 1)) {
        return "implicit-default-multipart";
    }
    const canonicalNames = collectVariableNames(prefix);
    if (canonicalNames.size > 0) {
        for (const m of members) {
            if (m.value !== undefined) {
                for (const v of collectVariableReferences(m.value)) {
                    if (canonicalNames.has(v)) return "cross-scope-ref";
                }
            }
            for (const v of collectVariableNames(m.parts)) {
                if (canonicalNames.has(v)) return "binding-shadow";
            }
        }
    }
    return undefined;
}

function buildWrapperRule(
    prefix: GrammarPart[],
    members: GrammarRule[],
): GrammarRule {
    const suffixRulesPart: RulesPart = { type: "rules", rules: members };
    const factoredAlt: GrammarRule = {
        parts: [...prefix, suffixRulesPart],
    };
    if (members.some((m) => m.value !== undefined)) {
        const reserved = new Set<string>(collectVariableNames(prefix));
        for (const m of members) {
            for (const v of collectVariableNames(m.parts)) reserved.add(v);
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
