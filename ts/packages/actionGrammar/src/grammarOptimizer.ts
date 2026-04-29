// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import registerDebug from "debug";
import {
    CompiledObjectElement,
    CompiledSpacingMode,
    CompiledValueNode,
    DispatchModeBucket,
    getCapturedVariableName,
    Grammar,
    GrammarPart,
    GrammarRule,
    isCaptureBearingPart,
    PhraseSetPart,
    RulesPart,
    StringPart,
} from "./grammarTypes.js";
import { leadingWordBoundaryScriptPrefix } from "./spacingScripts.js";
import { leadingNonSeparatorRun } from "./grammarMatcher.js";
import { getDispatchEffectiveMembers } from "./dispatchHelpers.js";

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

    /**
     * Behavior when the inliner reaches an internal invariant violation
     * (a bound `RulesPart` whose child has no binding-friendly part -
     * see `tryInlineRulesPart`).  This indicates either a compiler bug
     * upstream or a future change to `hasValue` semantics.
     *
     * - `"debug"` (default): log via `debug` and refuse the inlining
     *   (returns `undefined`, leaving the AST unchanged at this site).
     *   Safe for production.
     * - `"throw"`: throw an `Error`.  Useful in tests / CI to surface
     *   regressions immediately.
     */
    onInvariantViolation?: "debug" | "throw";

    /**
     * Opt-in: when factoring a common prefix, emit the suffix
     * `RulesPart` as a *tail* call wherever structurally possible
     * (skip parent-frame push; member's value flows up directly as
     * the wrapper rule's value).  Tail wrappers are observably
     * identical to the unfactored shape, produce a smaller AST (no
     * synthesized wrapper-binding variable, no `factoredAlt.value`
     * indirection), and save one matcher frame push per fork - so
     * tail is preferred whenever it can be emitted.
     *
     * Forks whose member value expressions reference prefix-bound
     * canonicals can *only* be factored as tail; with this flag off
     * the factorer bails out at such forks (`cross-scope-ref`) and
     * emits each member as a separate full rule.
     *
     * Without this flag set, the factorer never emits tail RulesParts
     * - preserving today's matcher semantics for every consumer.
     *
     * Currently only the NFA-interpreter matcher (`grammarMatcher.ts`)
     * understands tail RulesParts.  The NFA compiler / DFA path does
     * not, and will throw if it encounters one.
     */
    tailFactoring?: boolean;

    /**
     * Attach a first-token dispatch index to eligible `RulesPart`
     * alternation forks.  At match time the matcher peeks one
     * token, looks it up across the per-mode bucket maps, and tries
     * only the listed alternatives before falling back to the
     * non-bucketed `rules` subset.  Dispatch is a filter only - the
     * peeked token is not consumed and each dispatched rule
     * re-matches it via its normal leading `StringPart` (preserving
     * implicit-default behavior).
     *
     * Eligibility (per spacing-mode partition):
     *   - `required`  - always eligible.
     *   - `undefined` (auto) - eligible iff every dispatch key is
     *     composed entirely of word-boundary-script characters
     *     (Latin / Cyrillic / Greek / etc.) so the matcher's
     *     peek-by-separator aligns with the partition's boundary
     *     semantics.
     *   - `optional` / `none` - never eligible (peek-by-separator
     *     would falsely segment unseparated input).
     *
     * Members whose first part is not a statically-known token
     * (wildcard / number / phraseSet / nested RulesPart, bound
     * first-StringPart, recursive or empty members) land in the
     * fallback `rules` subset and are tried as ordinary
     * alternatives after the bucket hits.
     *
     * The pass is observably equivalent to the unoptimized form -
     * the matcher tries the same set of alternatives in the same
     * order on a hit, plus all fallback rules.  The NFA/DFA
     * compile path walks the union of buckets and `rules` to
     * recover the full effective member list (the NFA already does
     * global first-token dispatch via `buildFirstTokenIndex`, so
     * the dispatch index is redundant there).
     */
    dispatchifyAlternations?: boolean;

    /**
     * Promote a rule's trailing `RulesPart` to a tail call when the
     * structural contract permits it.  Unlike `tailFactoring` (which
     * builds new wrapper rules from shared-prefix alternatives), this
     * pass operates on rules whose last part is *already* a
     * `RulesPart` and converts that part in place.  Two shapes are
     * handled:
     *
     *   - **Pure forwarding.**  Parent rule has `value === undefined`
     *     and its trailing `RulesPart`'s captured value is what the
     *     matcher's implicit-default rule would forward.  The
     *     conversion just sets `tailCall: true` and drops the
     *     wrapper variable - members keep their existing
     *     values/implicit defaults, which now flow up directly via
     *     the tail-entry mechanism (saving one frame push per
     *     match).
     *
     *   - **Value substitution.**  Parent rule has its own `value`
     *     expression that references the trailing `RulesPart`'s
     *     bound variable `v`.  For each member the pass materializes
     *     the member's effective value (its own `value` expr or its
     *     implicit default), substitutes that for `v` in the
     *     parent's value expression, and writes the result as the
     *     member's new `value`.  Parent's value is dropped, the
     *     wrapper variable is dropped, and `tailCall: true` is set.
     *
     * Forks where any member's effective value can't be expressed
     * (e.g. an unbound `phraseSet` first part with no implicit
     * default we can reify) cause a *local* bailout - the rule
     * stays unchanged.
     *
     * Like `tailFactoring`, only the AST-walking matcher
     * (`grammarMatcher.ts`) understands `tailCall`; callers that
     * route through the NFA compiler / DFA path must leave this
     * flag off.
     */
    promoteTailRulesParts?: boolean;
};

/**
 * Recommended preset enabling all optimizations.  Use this when callers
 * want every safe pass on without naming each flag individually - future
 * passes added here will be picked up automatically.
 *
 * Caveats:
 *   - Enabling `factorCommonPrefixes` destroys the 1:1 correspondence
 *     between top-level rule indices and the original source.  Callers
 *     that need that mapping for diagnostics must capture it before
 *     optimization runs.
 *   - Enabling `tailFactoring` or `promoteTailRulesParts` produces
 *     `RulesPart.tailCall` nodes that only the AST-walking matcher
 *     (`grammarMatcher.ts`) understands.  Callers that route the
 *     compiled grammar through the NFA compiler / DFA path must not
 *     use this preset (or must override both to `false`).
 */
export const recommendedOptimizations: GrammarOptimizationOptions = {
    inlineSingleAlternatives: true,
    factorCommonPrefixes: true,
    tailFactoring: true,
    dispatchifyAlternations: true,
    promoteTailRulesParts: true,
};

/**
 * Run enabled optimization passes against the compiled grammar AST.
 * The returned grammar is semantically equivalent to the input - only the
 * shape of the parts/rules tree changes.
 *
 * The optimizer is intentionally conservative: when in doubt about an
 * eligibility check, it leaves the AST unchanged.
 */
export function optimizeGrammar(
    grammar: Grammar,
    options: GrammarOptimizationOptions | undefined,
    warnings?: string[],
): Grammar {
    if (!options) {
        return grammar;
    }
    let rules = grammar.alternatives;
    const inlineConfig: InlineConfig = {
        onInvariantViolation: options.onInvariantViolation ?? "debug",
    };
    if (options.tailFactoring && !options.factorCommonPrefixes) {
        // tailFactoring is a sub-mode of the prefix-factoring pass;
        // setting it without enabling the parent pass is almost
        // certainly a configuration mistake.  Surface via the caller's
        // warnings array (and log via debug) so it doesn't silently
        // become a no-op.
        const msg =
            "tailFactoring is set but factorCommonPrefixes is not - tailFactoring has no effect";
        debug(msg);
        warnings?.push(msg);
    }
    if (options.inlineSingleAlternatives) {
        rules = inlineSingleAlternativeRules(rules, inlineConfig);
    }
    if (options.factorCommonPrefixes) {
        rules = factorCommonPrefixes(rules, !!options.tailFactoring);
        if (options.inlineSingleAlternatives) {
            // Factoring never emits a single-alternative wrapper itself
            // (factorRulesPart only wraps when members.length >= 2), but
            // the suffix RulesParts it builds can contain inner
            // single-alternative RulesParts that were not visible to
            // Pass 1 in their pre-factored shape.  Re-run the inliner so
            // those collapse.
            rules = inlineSingleAlternativeRules(rules, inlineConfig);
        }
        if (options.tailFactoring) {
            // Self-validate: any tail RulesPart the factorer emitted
            // must satisfy the structural contract.  Catches
            // regressions in the wrapper builders at the offending
            // site rather than as confusing match failures or
            // runtime throws deep in `enterTailRulesPart`.  On
            // failure, discard the optimized output and return the
            // input grammar unchanged so callers get a known-good
            // AST.
            if (
                !validateTailPassOutput(
                    "factorCommonPrefixes",
                    rules,
                    undefined,
                    inlineConfig,
                    warnings,
                )
            ) {
                return grammar;
            }
        }
    }
    let topLevelDispatch: DispatchModeBucket[] | undefined;
    if (options.dispatchifyAlternations) {
        const result = dispatchifyAlternations(rules);
        rules = result.alternatives;
        topLevelDispatch = result.dispatch;
    }
    if (options.promoteTailRulesParts) {
        // Run after dispatchify so we can also promote trailing parts
        // inside member rules of the (top-level or nested) dispatch
        // buckets.  Computed into locals first; only committed if the
        // post-pass tail validation passes - so on failure we leave
        // `rules` / `topLevelDispatch` at their pre-promote values
        // and downstream still gets a valid AST.
        const counter = { promoted: 0 };
        const memo: RulesArrayMemo = new Map();
        const promotedRules = promoteRulesArray(rules, counter, memo);
        const promotedDispatch =
            topLevelDispatch === undefined
                ? topLevelDispatch
                : mapDispatchBuckets(topLevelDispatch, (bucket) =>
                      promoteRulesArray(bucket, counter, memo),
                  );
        if (
            validateTailPassOutput(
                "promoteTailRulesParts",
                promotedRules,
                promotedDispatch,
                inlineConfig,
                warnings,
            )
        ) {
            // Log only after validation accepts the candidate so the
            // count reflects what's actually committed to the
            // returned grammar.  A discarded candidate logs nothing
            // beyond the validator's own discard message.
            if (counter.promoted > 0) {
                debug(
                    `promoted ${counter.promoted} trailing RulesParts to tail calls`,
                );
            }
            rules = promotedRules;
            topLevelDispatch = promotedDispatch;
        }
    }
    if (rules === grammar.alternatives && topLevelDispatch === undefined) {
        return grammar;
    }
    const out: Grammar = { ...grammar, alternatives: rules };
    if (topLevelDispatch !== undefined) {
        out.dispatch = topLevelDispatch;
    }
    return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers used across passes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Apply `transform` to every bucket array in every per-mode entry of
 * a dispatched `RulesPart`'s `dispatch` table.  Returns the same
 * `dispatch` array identity when no bucket changed (preserving the
 * serializer's identity-based dedup invariant); otherwise returns a
 * new outer array with per-mode entries also reused-by-identity
 * unless their `tokenMap` had at least one bucket replacement.
 *
 * Used by passes that walk-and-rewrite dispatched shapes
 * (`dispatchifyAlternations` recursion, `promoteTailRulesParts`).
 * Not used by `validateTailRulesParts`, which only needs read-only
 * traversal of the same shape.
 */
function mapDispatchBuckets(
    dispatch: DispatchModeBucket[],
    transform: (bucket: GrammarRule[]) => GrammarRule[],
): DispatchModeBucket[] {
    let outerDirty = false;
    const out = dispatch.map((m) => {
        let bucketDirty = false;
        const newMap = new Map<string, GrammarRule[]>();
        for (const [tok, bucket] of m.tokenMap) {
            const replaced = transform(bucket);
            if (replaced !== bucket) bucketDirty = true;
            newMap.set(tok, replaced);
        }
        if (!bucketDirty) return m;
        outerDirty = true;
        return { ...m, tokenMap: newMap };
    });
    return outerDirty ? out : dispatch;
}

/**
 * Run `validateTailRulesParts` on a (rules, dispatch) pair and
 * return whether the candidate AST passed.  On failure, honors
 * `config.onInvariantViolation`: throws on the strict path,
 * otherwise logs via `debug`, pushes a warning, and returns
 * `false` so the caller can discard the candidate AST and fall
 * back to its pre-pass state.  Used by both the
 * `factorCommonPrefixes` (with `tailFactoring`) and
 * `promoteTailRulesParts` blocks.
 */
function validateTailPassOutput(
    passName: string,
    rules: GrammarRule[],
    dispatch: DispatchModeBucket[] | undefined,
    config: InlineConfig,
    warnings: string[] | undefined,
): boolean {
    try {
        validateTailRulesParts(rules, dispatch);
    } catch (e) {
        const msg = `Optimizer self-check failed (${passName}): ${(e as Error).message}`;
        if (config.onInvariantViolation === "throw") {
            throw new Error(msg);
        }
        debug(`${msg} - discarding ${passName} output`);
        warnings?.push(msg);
        return false;
    }
    return true;
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
/** Configuration for a single inline pass. */
type InlineConfig = {
    onInvariantViolation: "debug" | "throw";
};

function inlineSingleAlternativeRules(
    rules: GrammarRule[],
    config: InlineConfig = { onInvariantViolation: "debug" },
): GrammarRule[] {
    const counter = { inlined: 0 };
    const memo: RulesArrayMemo = new Map();
    // Reference count over the input AST: how many `RulesPart`s point at
    // each `GrammarRule[]` array.  Used to refuse inlining a shared
    // array, which would otherwise duplicate the child's parts at every
    // call site and bloat the serialized grammar (the serializer dedups
    // by array identity).
    const refCounts = countRulesArrayRefs(rules);
    const result = inlineRulesArray(rules, counter, memo, refCounts, config);
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
                if (p.type === "rules") walk(p.alternatives);
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
    config: InlineConfig,
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
        const r = inlineRule(rules[i], counter, memo, refCounts, config);
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
    config: InlineConfig,
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
        config,
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
     * this inlining synthesizes one - copying what the matcher would
     * have computed via its default-value rule (i.e. the captured child
     * rule's value).  At most one assignment is possible per parent
     * rule: the matcher's default-value rule requires exactly one
     * variable on the parent, so two inlinings each producing a
     * valueAssignment would mean the parent originally had two
     * variables and `hasValue=false` - a grammar the compiler
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
    config: InlineConfig,
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
            p.alternatives,
            counter,
            memo,
            refCounts,
            config,
        );
        const rewritten: RulesPart =
            inlinedRules !== p.alternatives
                ? { ...p, alternatives: inlinedRules }
                : p;

        // Refuse to inline a RulesPart whose body is shared by more than
        // one reference: inlining duplicates the child's parts at the
        // call site, but the original array is still referenced from the
        // other call sites - net effect is N copies in the serialized
        // grammar instead of 1 dedup'd entry.  Reference counts come
        // from the *input* AST; the rewritten array shares identity with
        // it via the memo when no nested change occurred, and otherwise
        // is unique to this site (so inlining is safe).
        const shared = (refCounts.get(p.alternatives) ?? 1) > 1;
        const replacement = shared
            ? undefined
            : tryInlineRulesPart(rewritten, parentRule, renameState, config);
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
                // result - see TryInlineResult.valueAssignment for why
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
    config: InlineConfig,
): TryInlineResult | undefined {
    if (part.repeat || part.optional) {
        return undefined;
    }
    if (part.alternatives.length !== 1) {
        return undefined;
    }
    // Past this point, `part.rules.length === 1`.  Tail RulesParts have
    // a structural contract requiring `rules.length >= 2` (see
    // `RulesPart.tailCall` doc), so the factorer never produces a
    // single-member tail RulesPart - today this branch is dead and
    // serves only as a future-proofing assertion.  It would become
    // reachable if a future change relaxed the >=2 invariant
    // (e.g. allowed a single-member tail wrapper as a structural
    // marker).  Honor the configured policy: throw on the strict
    // path, log + bail on the permissive path.
    /* istanbul ignore if -- @preserve: dead-by-construction defense */
    if (part.tailCall) {
        const msg = `Internal: single-member tail RulesPart violates the rules.length>=2 contract (variable='${part.variable ?? "<none>"}')`;
        if (config.onInvariantViolation === "throw") {
            throw new Error(msg);
        }
        debug(`${msg} - refusing to inline (onInvariantViolation=debug)`);
        return undefined;
    }
    const child = part.alternatives[0];
    if (child.parts.length === 0) {
        return undefined;
    }

    // Spacing mode: the child rule's spacing mode governs the boundaries
    // *between* its own parts.  When inlined, those boundaries are
    // governed by the parent's spacing mode.  Require exact equality:
    // `undefined` (auto) is a distinct mode at the matcher level, not
    // a synonym for "inherit from parent" - inlining a child with
    // `undefined` into a parent with `"required"` would change boundary
    // behavior at e.g. digit↔Latin transitions where auto resolves to
    // `optionalSpacePunctuation` but required is always
    // `spacePunctuation`.
    if (child.spacingMode !== parentRule.spacingMode) {
        return undefined;
    }

    // Variable-leakage guard: when the parent doesn't capture this
    // RulesPart via a `part.variable` binding, has no explicit value
    // expression of its own, and has other parts beyond this one, the
    // matcher enters the child with `valueIds=null` (not tracking).
    // After inlining, child's variable-bearing parts become direct
    // parts of the parent and contribute to the parent's value
    // tracking, changing semantics ("missing/multiple values for
    // default" errors appear or disappear).  Refuse to inline in this
    // case.  When the parent HAS an explicit value, `createValue` uses
    // that expression (not the implicit-default path), so the extra
    // bindings are harmless.
    //
    // When `parts.length === 1` this guard is not needed: the matcher's
    // single-part implicit-default rule forwards the child's result
    // directly, so inlining preserves those semantics.
    if (
        part.variable === undefined &&
        parentRule.value === undefined &&
        parentRule.parts.length > 1
    ) {
        const hasVarBearingParts = child.parts.some(
            (cp) =>
                cp.type === "wildcard" ||
                cp.type === "number" ||
                cp.variable !== undefined,
        );
        if (hasVarBearingParts) {
            return undefined;
        }
    }

    // The child rule may carry its own value expression.  After
    // inlining, child.parts move into the parent and the explicit
    // child.value can no longer fire on its own.  child.value is
    // observable to the matcher in two ways; we handle each, and
    // otherwise the value is dead and can be dropped:
    //
    //   (Hoist)        parent has no value of its own and exactly one
    //                  part (this RulesPart).  Synthesize a value
    //                  assignment from child.value onto the parent -
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
    // The Substitute and Drop cases share the same parts handling -
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
        // part - there are no siblings to collide with.
        const { parts: renamedParts, value: renamedValue } =
            parentRule.parts.length === 1
                ? { parts: child.parts, value: child.value }
                : renameAllChildBindings(child.parts, child.value, renameState);

        // (Hoist) Parent has no value of its own and the matcher
        // would have computed the parent's value via its
        // default-value rule using `child.value` - either because
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
        // its own value expression - fold the renamed child.value
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
    // child must expose exactly one binding-friendly top-level part to take
    // the parent's variable name; otherwise we'd silently drop the binding.
    //
    // "Binding-friendly" mirrors the matcher's implicit-default rule for
    // a child with no explicit value:
    //
    //   - Single-part child: the lone part contributes the value (any
    //     type - string / phraseSet via implicit text, wildcard /
    //     number / rules via their captured value).  All five types
    //     qualify.
    //
    //   - Multi-part child: the matcher requires exactly *one*
    //     variable-bearing part (else its createValue throws
    //     "missing/multiple values for default" at finalize time).
    //     wildcard and number always carry a variable; rules /
    //     string / phraseSet qualify only when bound (`cp.variable !==
    //     undefined`).  An unbound rules / string / phraseSet
    //     contributes nothing to the value at runtime, so it isn't a
    //     binding target - and counting it would produce false
    //     ambiguity rejections (e.g. child = `<X> $(n:string)` with
    //     `<X>` unbound: only the wildcard is the real contributor).
    //
    // Multiple binding-friendly parts in the same child means child
    // relied on an explicit value expression (which the no-value
    // branch already rules out) or violated the matcher's
    // default-value contract; either way we can't safely re-target
    // the parent's binding.
    if (part.variable !== undefined) {
        const isSinglePart = child.parts.length === 1;
        let bindingIdx = -1;
        for (let i = 0; i < child.parts.length; i++) {
            const cp = child.parts[i];
            const friendly =
                cp.type === "wildcard" ||
                cp.type === "number" ||
                ((cp.type === "rules" ||
                    cp.type === "string" ||
                    cp.type === "phraseSet") &&
                    (isSinglePart || cp.variable !== undefined));
            if (!friendly) continue;
            if (bindingIdx !== -1) {
                return undefined;
            }
            bindingIdx = i;
        }
        if (bindingIdx === -1) {
            // Invariant: we're past the `child.value !== undefined`
            // branch, so child has no explicit value, and parent binds
            // it via `part.variable`.  The compiler enforces
            // `child.hasValue === true` at any bound rule reference
            // (grammarCompiler "Referenced rule does not produce a
            // value for variable" check); for a value-less child,
            // hasValue=true requires either `variableCount === 1`
            // (some top-level part is variable-bearing → friendly in
            // the multi-part branch) or `parts.length === 1 &&
            // defaultValue` (single-part → any type is friendly).
            // Either way at least one friendly part exists.  If a
            // future compiler change ever loosens hasValue and reaches
            // this point, the configured policy decides whether to
            // throw (tests / CI) or just bail out and log (production).
            const msg = `Internal: bound RulesPart child has no binding-friendly part (variable='${part.variable}')`;
            if (config.onInvariantViolation === "throw") {
                throw new Error(msg);
            }
            debug(`${msg} - refusing to inline (onInvariantViolation=debug)`);
            return undefined;
        }
        const bindingCp = child.parts[bindingIdx];
        const newParts = child.parts.slice();
        newParts[bindingIdx] = { ...bindingCp, variable: part.variable };
        // No duplicate-name guard here: if the parent already had two
        // top-level parts bound to `part.variable` (the RulesPart and
        // some sibling), that collision predates inlining and the
        // matcher's behavior on it is unchanged when we replace the
        // RulesPart with a wildcard/number/rules/string/phraseSet part
        // bound to the same name.
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
 * top-level rule indices and the original source - that mapping must be
 * recovered via separate metadata if needed downstream.
 *
 * Uses an identity memo over `GrammarRule[]` arrays so shared named
 * rules (multiple `RulesPart`s pointing at the same array) still share
 * after the pass - see `inlineSingleAlternativeRules` for rationale.
 */
/** Per-invocation configuration for `factorCommonPrefixes`. */
function factorCommonPrefixes(
    rules: GrammarRule[],
    tailFactoring: boolean = false,
): GrammarRule[] {
    const counter = { factored: 0 };
    const memo: RulesArrayMemo = new Map();
    // Cache `factorRules` per input `GrammarRule[]` identity so that two
    // `RulesPart`s pointing at the same alternatives array (compiler
    // named-rule sharing) emit the same factored array - preserving the
    // serializer's array-identity dedup invariant.  The transformation
    // is a pure function of the input alternatives (the wrapping
    // `RulesPart`'s flags only get re-stamped onto the output by
    // `factorRulesPart` and never feed into the trie build).
    const factorMemo: FactorMemo = new Map();
    let result = factorRulesArray(
        rules,
        counter,
        memo,
        factorMemo,
        tailFactoring,
    );

    // Top-level factoring: the matcher treats top-level alternatives the
    // same way it treats inner `RulesPart` alternatives (each is queued
    // as its own `MatchState` and produces its own result), so the same
    // trie-based factoring applies.  Newly synthesized suffix
    // `RulesPart`s produced here are not themselves re-walked, matching
    // the existing behavior for nested factoring.
    result = factorRulesCached(result, counter, factorMemo, tailFactoring);

    if (counter.factored > 0) {
        debug(`factored ${counter.factored} common prefix groups`);
    }
    return result;
}

/**
 * Per-invocation memo over `factorRules` keyed on the input
 * `GrammarRule[]` identity.  Ensures two `RulesPart`s sharing the
 * same alternatives array (named-rule dedup from the compiler) share
 * the same factored output array, so the serializer's identity-based
 * dedup still collapses them to a single JSON slot.
 */
type FactorMemo = Map<GrammarRule[], GrammarRule[]>;

/**
 * `factorRules` with input-identity memoization.  Always returns the
 * cached result for a previously-seen input array; otherwise computes,
 * caches, and returns.  Note: the cached output array is also stored
 * under its own identity (mapped to itself) so that a second pass that
 * happens to receive the post-factored array as input doesn't refactor
 * it.
 */
function factorRulesCached(
    rules: GrammarRule[],
    counter: { factored: number },
    factorMemo: FactorMemo,
    tailFactoring: boolean,
): GrammarRule[] {
    const cached = factorMemo.get(rules);
    if (cached !== undefined) return cached;
    const result = factorRules(rules, counter, tailFactoring);
    factorMemo.set(rules, result);
    if (result !== rules) factorMemo.set(result, result);
    return result;
}

function factorRulesArray(
    rules: GrammarRule[],
    counter: { factored: number },
    memo: RulesArrayMemo,
    factorMemo: FactorMemo,
    tailFactoring: boolean,
): GrammarRule[] {
    const cached = memo.get(rules);
    if (cached !== undefined) return cached;
    memo.set(rules, rules);
    // Single-pass: only allocate `next` once an element actually changes
    // (see inlineRulesArray for rationale).
    let next: GrammarRule[] | undefined;
    for (let i = 0; i < rules.length; i++) {
        const r = factorRule(
            rules[i],
            counter,
            memo,
            factorMemo,
            tailFactoring,
        );
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
    factorMemo: FactorMemo,
    tailFactoring: boolean,
): GrammarRule {
    const { parts, changed } = factorParts(
        rule.parts,
        counter,
        memo,
        factorMemo,
        tailFactoring,
    );
    if (!changed) return rule;
    return { ...rule, parts };
}

function factorParts(
    parts: GrammarPart[],
    counter: { factored: number },
    memo: RulesArrayMemo,
    factorMemo: FactorMemo,
    tailFactoring: boolean,
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
        const recursedRules = factorRulesArray(
            p.alternatives,
            counter,
            memo,
            factorMemo,
            tailFactoring,
        );
        const recursed: RulesPart =
            recursedRules !== p.alternatives
                ? { ...p, alternatives: recursedRules }
                : p;

        const working = factorRulesPart(
            recursed,
            counter,
            factorMemo,
            tailFactoring,
        );
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
 * `RulesPart` shape on success.  Routes through `factorRulesCached`
 * so two `RulesPart`s sharing the same `alternatives` identity emit
 * the same factored array (preserves the serializer dedup invariant).
 */
function factorRulesPart(
    part: RulesPart,
    counter: { factored: number },
    factorMemo: FactorMemo,
    tailFactoring: boolean,
): RulesPart {
    if (part.repeat || part.optional) {
        // Repeat/optional change the matcher's loop-back semantics; leave
        // such groups untouched to stay safe.
        return part;
    }
    const factored = factorRulesCached(
        part.alternatives,
        counter,
        factorMemo,
        tailFactoring,
    );
    if (factored === part.alternatives) return part;
    return { ...part, alternatives: factored };
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
 *     two `<RuleName>` references share the same edge - preserving the
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
 * site; failure causes a *local* bailout - the would-be members are
 * emitted as separate full rules with the canonical prefix prepended,
 * losing factoring at that fork only (factoring above and below the
 * fork still applies).
 *
 * Returns the same array if no factoring took place.
 */
function factorRules(
    rules: GrammarRule[],
    counter: { factored: number },
    tailFactoring: boolean,
): GrammarRule[] {
    if (rules.length < 2) return rules;

    // Partition by `spacingMode`.  A wrapper rule has a single
    // `spacingMode` that governs prefix-boundary semantics, so two
    // members with different spacingModes can never share a wrapper.
    // Rather than bail out at every mixed-spacing fork (which would
    // miss legitimate factoring opportunities within each spacing
    // group), build a separate trie per spacingMode and concatenate
    // the per-partition output back in original-index order.
    //
    // Map iteration is insertion order; partitions are visited in
    // first-occurrence order, but the final flatten sorts by `idx`
    // so source ordering is preserved across partitions.
    const partitions = new Map<
        CompiledSpacingMode,
        { idx: number; rule: GrammarRule }[]
    >();
    for (let i = 0; i < rules.length; i++) {
        const r = rules[i];
        let p = partitions.get(r.spacingMode);
        if (p === undefined) {
            p = [];
            partitions.set(r.spacingMode, p);
        }
        p.push({ idx: i, rule: r });
    }

    const buildState: BuildState = {
        nextCanonicalId: 0,
        rulesArrayIds: new WeakMap(),
        nextRulesArrayId: 0,
        tailFactoring,
    };
    const state: EmitState = { didFactor: false };
    const items: { idx: number; rules: GrammarRule[] }[] = [];

    for (const [partitionSpacing, partition] of partitions) {
        if (partition.length === 1) {
            // Solo partition - nothing to factor against; pass the
            // rule through at its original index.
            items.push({ idx: partition[0].idx, rules: [partition[0].rule] });
            continue;
        }
        const root: TrieRoot = { children: new Map(), terminals: [] };
        for (const { idx, rule } of partition) {
            insertRuleIntoTrie(root, rule, idx, buildState);
        }
        for (const c of root.children.values()) {
            items.push({
                idx: c.firstIdx,
                rules: emitFromNode(c, state, buildState, partitionSpacing),
            });
        }
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
// Every inserter - *including the lead* - records its remap; the lead
// is no longer an exception because its local also differs from the
// canonical.

type TrieStep =
    | {
          kind: "string";
          /** Single token for unbound (per-token explosion); full token
           * sequence for bound (atomic, never split). */
          tokens: string[];
          local: string | undefined;
      }
    | { kind: "wildcard"; typeName: string; optional: boolean; local: string }
    | { kind: "number"; optional: boolean; local: string }
    | {
          kind: "rules";
          rules: GrammarRule[];
          optional: boolean;
          repeat: boolean;
          name: string | undefined;
          local: string | undefined;
          tailCall: boolean;
      }
    | {
          kind: "phraseSet";
          matcherName: string;
          local: string | undefined;
      };

type TrieEdge =
    | {
          kind: "string";
          tokens: string[];
          /** undefined iff every inserter at this edge was unbound. */
          canonical: string | undefined;
      }
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
          tailCall: boolean;
      }
    | {
          kind: "phraseSet";
          matcherName: string;
          /** undefined iff every inserter at this edge was unbound. */
          canonical: string | undefined;
      };

type Terminal = {
    idx: number;
    value: CompiledValueNode | undefined;
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
 * rule we're about to emit - a fresh BuildState per invocation is
 * enough to guarantee within-RulesPart uniqueness.  Distinct from
 * `RenameState` (which scopes per-parent-rule and produces
 * `__opt_inline_<n>` names for the inliner pass).
 */
type BuildState = {
    nextCanonicalId: number;
    rulesArrayIds: WeakMap<GrammarRule[], number>;
    nextRulesArrayId: number;
    tailFactoring: boolean;
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
 * the same key share a child node at insertion time - the same
 * pairing `edgeKeyMatches` performs by walking sibling edges, but
 * O(1) via a `Map<string, TrieNode>` lookup.  For variable-bearing
 * kinds the variable *name* is omitted (names are remapped); for
 * `rules` edges the binding presence (bound vs. unbound) is encoded
 * so they don't merge - mirrors the parity check in `edgeKeyMatches`.
 */
function stepMergeKey(step: TrieStep, state: BuildState): string {
    // Use JSON.stringify for any field that could contain unrestricted text
    // (token values, matcher names) so that delimiters / colons / quotes
    // inside the field can't collide with the key's structural separators.
    //
    // Note: tokens are encoded as a JSON array, so atomic-bound vs.
    // exploded-unbound StringPart encodings stay on separate edges by
    // construction - `JSON.stringify(["foo"])` ≠ `JSON.stringify(["fo","o"])`,
    // and the `local` parity bit further guarantees bound and unbound
    // single-token forms also never collide.
    switch (step.kind) {
        case "string":
            return `s:${JSON.stringify(step.tokens)}:${step.local !== undefined ? 1 : 0}`;
        case "wildcard":
            return `w:${JSON.stringify(step.typeName)}:${step.optional ? 1 : 0}`;
        case "number":
            return `n:${step.optional ? 1 : 0}`;
        case "rules": {
            // Two otherwise-identical edges with different `tailCall`
            // must NOT merge: their matcher entry semantics differ
            // (tail call skips parent-frame push, see RulesPart.tailCall).
            const id = rulesArrayId(state, step.rules);
            return `r:${id}:${step.optional ? 1 : 0}:${step.repeat ? 1 : 0}:${step.local !== undefined ? 1 : 0}:${step.tailCall ? 1 : 0}`;
        }
        case "phraseSet":
            return `p:${JSON.stringify(step.matcherName)}:${step.local !== undefined ? 1 : 0}`;
    }
}

/**
 * Root of the trie.  Distinct from `TrieNode` so that `edge` can be
 * required on every non-root node - eliminating non-null assertions in
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
        remap,
    });
}

/**
 * Yield each rule.parts as a sequence of trie steps.
 *
 * Unbound StringParts explode into one step per token so that adjacent
 * alternatives can factor on a shared prefix substring.  Bound
 * StringParts emit a single atomic step containing the full token
 * sequence - splitting would break the binding parity (the matcher
 * captures the whole joined text into the slot, so the binding can't
 * be moved to the last token alone without changing semantics) and
 * would also leak the binding-presence bit into intermediate edges,
 * preventing legitimate factoring with unbound prefix tokens.
 *
 * TODO: bound StringParts that share a token prefix (e.g.
 * `[good, morning]` and `[good, evening]`, both bound) currently
 * cannot factor.  The same trick `compileStringPart` uses - emit
 * sub-token transitions for the shared prefix and write the slot
 * only on the final transition - would let the trie share the
 * `good` edge if we tracked "binding emitted on last sub-step
 * only" parity.  Not yet worth the complexity.
 */
function* partsToEdgeSteps(parts: GrammarPart[]): Generator<TrieStep> {
    for (const p of parts) {
        switch (p.type) {
            case "string":
                if (p.variable !== undefined) {
                    yield {
                        kind: "string",
                        tokens: p.value,
                        local: p.variable,
                    };
                } else {
                    for (const tok of p.value) {
                        yield {
                            kind: "string",
                            tokens: [tok],
                            local: undefined,
                        };
                    }
                }
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
                    rules: p.alternatives,
                    optional: !!p.optional,
                    repeat: !!p.repeat,
                    name: p.name,
                    local: p.variable,
                    tailCall: !!p.tailCall,
                };
                break;
            case "phraseSet":
                yield {
                    kind: "phraseSet",
                    matcherName: p.matcherName,
                    local: p.variable,
                };
                break;
        }
    }
}

/** Allocate a new trie edge from a step, minting a fresh canonical when needed. */
function stepToEdge(step: TrieStep, buildState: BuildState): TrieEdge {
    switch (step.kind) {
        case "string":
            return {
                kind: "string",
                tokens: step.tokens,
                canonical:
                    step.local !== undefined
                        ? freshCanonical(buildState)
                        : undefined,
            };
        case "phraseSet":
            return {
                kind: "phraseSet",
                matcherName: step.matcherName,
                canonical:
                    step.local !== undefined
                        ? freshCanonical(buildState)
                        : undefined,
            };
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
                tailCall: step.tailCall,
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
        case "string": {
            const out: StringPart = { type: "string", value: edge.tokens };
            if (edge.canonical !== undefined) out.variable = edge.canonical;
            return out;
        }
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
            const out: RulesPart = { type: "rules", alternatives: edge.rules };
            if (edge.canonical !== undefined) {
                out.variable = edge.canonical;
            }
            if (edge.optional) out.optional = true;
            if (edge.repeat) out.repeat = true;
            if (edge.name !== undefined) out.name = edge.name;
            if (edge.tailCall) out.tailCall = true;
            return out;
        }
        case "phraseSet": {
            const out: PhraseSetPart = {
                type: "phraseSet",
                matcherName: edge.matcherName,
            };
            if (edge.canonical !== undefined) out.variable = edge.canonical;
            return out;
        }
    }
}

/**
 * Append `part` to `prefix` in place, folding when both ends are
 * StringParts (i.e. merging `last.value` and `part.value` into one
 * `StringPart`).  Mutating in place keeps path-compression linear in
 * chain depth - returning a fresh array on every step would be
 * O(depth²).
 */
function appendPartInPlace(prefix: GrammarPart[], part: GrammarPart): void {
    if (prefix.length === 0) {
        prefix.push(part);
        return;
    }
    const last = prefix[prefix.length - 1];
    if (
        last.type === "string" &&
        part.type === "string" &&
        last.variable === undefined &&
        part.variable === undefined
    ) {
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
    if (
        last.type === "string" &&
        first.type === "string" &&
        last.variable === undefined &&
        first.variable === undefined
    ) {
        const merged: GrammarPart = {
            type: "string",
            value: [...last.value, ...first.value],
        };
        return [...a.slice(0, a.length - 1), merged, ...b.slice(1)];
    }
    return [...a, ...b];
}

function terminalToRule(
    t: Terminal,
    partitionSpacing: CompiledSpacingMode | undefined,
): GrammarRule {
    let value = t.value;
    if (value !== undefined && t.remap.size > 0) {
        value = remapValueVariables(value, t.remap);
    }
    const out: GrammarRule = { parts: [] };
    if (value !== undefined) out.value = value;
    if (partitionSpacing !== undefined) out.spacingMode = partitionSpacing;
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
    partitionSpacing: CompiledSpacingMode | undefined,
): GrammarRule[] {
    // Path-compress: walk down single-child / no-terminal chain, but
    // stop *before* entering a node that would itself be a fork - that
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
        items.push({
            idx: t.idx,
            rules: [terminalToRule(t, partitionSpacing)],
        });
    }
    for (const c of current.children.values()) {
        items.push({
            idx: c.firstIdx,
            rules: emitFromNode(c, state, buildState, partitionSpacing),
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
    const eligibility = checkFactoringEligible(
        members,
        buildState.tailFactoring,
    );
    if (!eligibility.ok) {
        debug(
            `factor bailout (${eligibility.reason}) at fork with ${members.length} members; emitting unfactored`,
        );
        return members.map((m) => ({
            ...m,
            parts: concatParts(prefix, m.parts),
        }));
    }
    state.didFactor = true;
    return [
        eligibility.tail
            ? buildTailWrapper(prefix, members, partitionSpacing)
            : buildNonTailWrapper(
                  prefix,
                  members,
                  buildState,
                  partitionSpacing,
              ),
    ];
}

/**
 * Per-fork eligibility result.  When `ok` is `false` the caller must
 * bail out (emit each member as a separate full rule).  When `ok` is
 * `true`, `tail` indicates whether the wrapper's suffix `RulesPart`
 * should be emitted as a tail call (skipping parent-frame push so
 * member value-exprs can resolve prefix-bound canonicals).
 *
 * Modeled as a discriminated union so callers cannot read `tail`
 * without first checking `ok` - the wrapper builders only run on the
 * `ok: true` branch by construction.
 */
type FactorEligibility =
    | { ok: false; reason: string }
    | { ok: true; tail: boolean };

/**
 * Per-fork eligibility checks (lifted from the previous implementation).
 */
function checkFactoringEligible(
    members: GrammarRule[],
    tailFactoringEnabled: boolean,
): FactorEligibility {
    // Empty-parts members never compose cleanly inside a wrapped
    // RulesPart: with a value, the matcher would have to treat
    // `{parts:[], value: V}` as a degenerate match (today's algorithm
    // refuses this); without a value, the matcher's default-value
    // resolver throws ("missing value for default") because the
    // empty-parts rule has nothing to default from.
    if (members.some((m) => m.parts.length === 0)) {
        return { ok: false, reason: "whole-consumed" };
    }
    const valuePresence = members.map((m) => m.value !== undefined);
    const allHaveValue = valuePresence.every((v) => v);
    const noneHaveValue = valuePresence.every((v) => !v);
    if (!allHaveValue && !noneHaveValue) {
        return { ok: false, reason: "mixed-value-presence" };
    }
    if (noneHaveValue) {
        // The matcher synthesizes an implicit text-concatenation
        // default value only for single-part rules whose sole part
        // is a StringPart (`matchStringPartWithoutWildcard` fast
        // path).  After factoring, the wrapper rule becomes
        // `[prefix..., suffixRulesPart]` with parts.length >= 2 and
        // no value expression - the implicit default no longer
        // fires and `createValue` throws "missing value for default"
        // at finalize time.
        //
        // Synthesizing an explicit value here is possible (e.g.
        // template-literal joining the prefix tokens with the
        // suffix wrapper-binding) but not worth doing: the implicit
        // default fires only for unbound-StringPart-only rules,
        // where the matcher's `matchStringPartWithoutWildcard` fast
        // path is itself very cheap.  The wrapper would add a frame
        // push, a wrapper-binding entry on the `valueIds` chain, and
        // a template-literal evaluation per match - costs that
        // typically exceed the prefix-match savings.  Bail out
        // unconditionally; the implicit-default rules stay
        // unfactored and keep their fast path.
        return { ok: false, reason: "no-value-implicit-default" };
    }

    // Policy: prefer tail when enabled.  Tail wrapper is observably
    // identical to the unfactored shape for both needsTail and
    // !needsTail forks (the inherited `valueIds` chain is unread when
    // !needsTail), produces a smaller AST (no synthesized
    // `__opt_factor_<n>` binding, no `factoredAlt.value` indirection),
    // and saves one matcher frame push per fork.  Decided up-front so
    // we can skip the cross-scope-ref scan below entirely - that scan
    // only governs the non-tail bailout.
    if (tailFactoringEnabled) {
        return { ok: true, tail: true };
    }

    // Cross-scope-ref classification.  Nested rule scope is normally
    // fresh at the matcher level (entering a `RulesPart` resets
    // `valueIds`).  When members are lifted into a wrapper rule's
    // (non-tail) `suffixRulesPart`, each member's value can only see
    // variables bound in its own `parts` - bindings in the wrapper's
    // prefix are not visible.  Tail-RulesPart entry skips the parent-
    // frame push and inherits the parent's `valueIds` chain, so member
    // value-exprs *can* resolve prefix-bound canonicals; with tail
    // disabled we have to bail out at any such fork.
    if (referencesPrefixBoundCanonical(members)) {
        return { ok: false, reason: "cross-scope-ref" };
    }
    return { ok: true, tail: false };
}

/**
 * True iff any member's value expression references a variable that
 * isn't bound by that member's own `parts` - i.e. it relies on a
 * binding from the surrounding scope (typically a prefix-bound
 * canonical when called from `checkFactoringEligible`).  Non-tail
 * factoring at such a fork would silently change scope resolution.
 */
function referencesPrefixBoundCanonical(members: GrammarRule[]): boolean {
    for (const m of members) {
        if (m.value === undefined) continue;
        const memberBindings = collectVariableNames(m.parts);
        for (const v of collectVariableReferences(m.value)) {
            if (!memberBindings.has(v)) return true;
        }
    }
    return false;
}

/**
 * Build a tail-call wrapper rule: the suffix `RulesPart` runs in the
 * wrapper rule's own scope (no parent-frame push), so the member's
 * value flows up directly as the wrapper rule's value - no
 * synthesized wrapper-binding variable, no `factoredAlt.value`.
 *
 * Invariant - `members.length >= 2`.  `emitFromNode` short-circuits
 * the single-member case before reaching the wrapper builders
 * (`if (members.length === 1) return [...]`), so this builder is
 * only ever called at multi-member forks.  This upholds the
 * `RulesPart.tailCall` `rules.length >= 2` contract by construction;
 * `validateTailRulesParts` re-checks it post-emit.
 */
function buildTailWrapper(
    prefix: GrammarPart[],
    members: GrammarRule[],
    partitionSpacing: CompiledSpacingMode | undefined,
): GrammarRule {
    const suffixRulesPart: RulesPart = {
        type: "rules",
        alternatives: members,
        tailCall: true,
    };
    const factoredAlt: GrammarRule = {
        parts: [...prefix, suffixRulesPart],
    };
    if (partitionSpacing !== undefined) {
        factoredAlt.spacingMode = partitionSpacing;
    }
    return factoredAlt;
}

/**
 * Build a non-tail wrapper rule: each member's value is captured into
 * a synthesized opaque wrapper-binding variable, and the wrapper rule
 * forwards that binding as its own value.
 *
 * **Reachability:** today this builder is only reached when
 * `tailFactoring` is OFF.  When `tailFactoring` is on, the
 * eligibility check unconditionally returns `tail: true` for every
 * passing fork (the tail wrapper is observably identical to the
 * non-tail wrapper for both `needsTail` and `!needsTail` shapes,
 * produces a smaller AST, and saves a frame push), so this branch
 * is dead on the tail-factoring path.  Kept as the legacy emit
 * path: callers that route through the NFA/DFA matcher must leave
 * `tailFactoring` off, and they still benefit from prefix factoring
 * via this builder for the `!needsTail` case.
 */
function buildNonTailWrapper(
    prefix: GrammarPart[],
    members: GrammarRule[],
    buildState: BuildState,
    partitionSpacing: CompiledSpacingMode | undefined,
): GrammarRule {
    const suffixRulesPart: RulesPart = { type: "rules", alternatives: members };
    const factoredAlt: GrammarRule = {
        parts: [...prefix, suffixRulesPart],
    };
    if (members.some((m) => m.value !== undefined)) {
        // Opaque counter-based name shares `BuildState.nextCanonicalId`
        // with `freshCanonical`, so it can never collide with any
        // canonical edge binding in this `factorRules` invocation - no
        // reserved-set scan needed.
        const gen = freshWrapperBinding(buildState);
        suffixRulesPart.variable = gen;
        factoredAlt.value = { type: "variable", name: gen };
    }
    if (partitionSpacing !== undefined) {
        factoredAlt.spacingMode = partitionSpacing;
    }
    return factoredAlt;
}

// ── Variable name / value-expression utilities (shared with inliner) ─────

function collectVariableNames(parts: GrammarPart[]): Set<string> {
    const out = new Set<string>();
    for (const p of parts) {
        const v = getCapturedVariableName(p);
        if (v !== undefined) {
            out.add(v);
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
        if (!isCaptureBearingPart(p) || p.variable === undefined) {
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

// ─────────────────────────────────────────────────────────────────────────────
// Optimization: dispatchify alternations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Shared frozen empty-rules sentinel used as the `rules` (fallback)
 * subset on dispatched `RulesPart`s with no fallback members.  Using
 * a single identity across every empty-fallback dispatched part
 * lets `grammarSerializer.ts`'s identity-keyed `indexFor` dedup
 * them into one JSON slot instead of one slot per part.
 */
const EMPTY_FALLBACK_RULES: GrammarRule[] = Object.freeze(
    [] as GrammarRule[],
) as GrammarRule[];

/**
 * Classify a single rule's first part for dispatch eligibility,
 * deriving the bucket key for an `auto`/`required`-mode partition:
 *   - { kind: "token", token } - rule goes into `tokenMap[token]`.
 *   - { kind: "fallback" } - rule is not dispatch-eligible; goes
 *     to the dispatch part's `fallback` list.
 *
 * Bucket-key derivation depends on the partition's spacing mode:
 *   - `required`: a separator is mandated after every token, so peek
 *     returns the full first non-separator run.  Bucket key = the
 *     full lowercased first literal token.
 *   - `auto` (`undefined`): the matcher's StringPart regex implicitly
 *     splits at the first script transition (Latin↔CJK, Latin↔digit
 *     etc.); peek mirrors that via `leadingWordBoundaryScriptPrefix`.
 *     Bucket key = the lowercased leading word-boundary-script prefix
 *     of the first literal token, OR (when the WB-prefix is empty -
 *     the literal starts with CJK, digit, punctuation, ...) the
 *     literal's leading code point.  This first-code-point fallback
 *     keeps CJK / Hiragana / Katakana / digit-leading rules dispatch-
 *     eligible (one bucket per leading character).  `peekNextToken`
 *     applies the same rule on the input side so the buckets line
 *     up.  A literal that is empty stays in `fallback`.
 *
 * `optional` / `none` modes never reach this function (members in
 * those modes are routed to `fallback` directly by
 * `tryDispatchifyRulesPart` without classification).
 */
function classifyDispatchMember(
    rule: GrammarRule,
    mode: CompiledSpacingMode,
): { kind: "token"; token: string } | { kind: "fallback" } {
    const first = rule.parts[0];
    if (first === undefined) {
        return { kind: "fallback" };
    }
    if (first.type !== "string") {
        return { kind: "fallback" };
    }
    // Bound first-StringPart is fine: dispatch is filter-only and
    // each rule retains its full leading `StringPart` (including its
    // binding), so the matcher binds the captured tokens via the
    // rule's own `StringPart` regex on the dispatch hit - no
    // suffix-binding injection required.  Bucket key is still derived
    // from the literal's first token below.
    if (first.value.length === 0) {
        return { kind: "fallback" };
    }
    const literal = first.value[0].toLowerCase();
    if (literal.length === 0) {
        return { kind: "fallback" };
    }
    if (mode === "required") {
        // Bucket on the leading non-separator run, mirroring what
        // `peekNextToken` returns for required / optional / none
        // modes.  Two consequences worth being explicit about:
        //   1. Key alignment: using the full `literal` would cause
        //      a key mismatch when the literal embeds a separator
        //      char (e.g. `"d?"` buckets under `"d"` since peek
        //      returns `"d"` for input `"d? ..."`).
        //   2. Bucket collapse: literals like `"d?"`, `"d!"`,
        //      `"d."` all share bucket key `"d"`, so dispatch
        //      fan-out can be smaller than the number of distinct
        //      first-token literals.  This is correct - peek will
        //      route all such inputs to the same bucket, and the
        //      member rules' StringPart regexes discriminate
        //      among them.
        // If the literal starts with a separator, the prefix is
        // empty and we can't dispatch this member - send it to
        // fallback.
        const pref = leadingNonSeparatorRun(literal);
        if (pref.length === 0) {
            return { kind: "fallback" };
        }
        return { kind: "token", token: pref };
    }
    // auto: bucket on the leading word-boundary-script run.  When
    // the literal starts with a non-WB-script char (CJK, digit,
    // punctuation), fall back to bucketing on the leading code
    // point - matches `peekNextToken`'s first-code-point fallback
    // for inputs whose nonSeparatorRun starts with such a char.
    const pref = leadingWordBoundaryScriptPrefix(literal);
    if (pref.length > 0) {
        return { kind: "token", token: pref };
    }
    const cp = literal.codePointAt(0)!;
    return { kind: "token", token: String.fromCodePoint(cp) };
}

/**
 * Try to attach a first-token dispatch index to a `RulesPart`.
 * Returns the same part unchanged if not eligible.  When eligible,
 * returns a new `RulesPart` whose `rules` is the *fallback subset*
 * (members not assigned to any bucket) and whose `dispatch` is the
 * per-mode bucket array (see `RulesPart.dispatch`).
 *
 * `repeat` / `optional` / `tailCall` are all preserved on the
 * returned part.  The matcher's optional-fork block fires before
 * the rules entry arm; `repeat` re-enters via the standard
 * `repeatPartIndex` / `repeatStartIndex` mechanism (which re-runs
 * the dispatch peek per iteration); `tailCall` routes the rules
 * entry arm through the tail-entry helper instead of the normal
 * alternation entry (no parent frame, inherits `valueIds`).  See
 * `RulesPart.tailCall` for the structural contract that the
 * effective member list must satisfy; `validateTailRulesParts`
 * enforces it.  (Note: the tail contract requires every member's
 * spacingMode to match the parent rule's, so a tail-eligible
 * partition is naturally uniform-mode here - no special handling
 * is needed for mixed-mode tail.)
 *
 * Mixed-mode partitions: members are partitioned by their own
 * `rule.spacingMode` and a separate `tokenMap` is built for each
 * dispatch-eligible mode (`required` and/or `undefined`/auto).  The
 * matcher peeks once per `dispatch` entry and unions the hits.
 * Members with `spacingMode === "optional"` or `"none"` are not
 * peek-dispatchable (peek-by-separator would mismatch keys against
 * unseparated input) and land in the fallback `rules` subset.
 *
 * Skip conditions (return original part unchanged):
 *   - Single-rule "alternation" - nothing to dispatch.
 *   - No member is dispatch-eligible (every member is
 *     `optional`/`none` mode, or every dispatch-eligible member's
 *     first part is wildcard / number / phraseSet / nested rule
 *     etc.): every rule lands in `fallback`, dispatch adds a
 *     useless peek + hash miss.
 *   - Total bucket count == 1 with no fallback: the dispatch
 *     always picks the same bucket, no filtering benefit over
 *     the non-dispatched form.
 */
/**
 * Pure-input payload produced by the dispatch transformation.  Two
 * `RulesPart`s sharing the same input `alternatives` identity must
 * produce the same payload (and the same array identities for the
 * trimmed fallback and per-mode bucket arrays), so the serializer's
 * identity-based dedup still collapses them to single JSON slots.
 */
type DispatchPayload = {
    alternatives: GrammarRule[];
    dispatch: DispatchModeBucket[];
};

/**
 * Per-invocation memo over `computeDispatchPayload` keyed on the
 * input `GrammarRule[]` identity.  Stores `null` for ineligible
 * inputs so the bail-out is also cached.  Shared across the whole
 * `dispatchifyAlternations` invocation including the top-level
 * dispatch hoist.
 */
type DispatchMemo = Map<GrammarRule[], DispatchPayload | null>;

function tryDispatchifyRulesPart(
    part: RulesPart,
    memo?: DispatchMemo,
): RulesPart | undefined {
    let payload: DispatchPayload | null | undefined = memo?.get(
        part.alternatives,
    );
    if (payload === undefined) {
        payload = computeDispatchPayload(part.alternatives, part.name) ?? null;
        memo?.set(part.alternatives, payload);
    }
    if (payload === null) return undefined;

    const out: RulesPart = {
        type: "rules",
        alternatives: payload.alternatives,
        dispatch: payload.dispatch,
    };
    if (part.name !== undefined) out.name = part.name;
    if (part.variable !== undefined) out.variable = part.variable;
    if (part.optional) out.optional = true;
    if (part.repeat) out.repeat = true;
    if (part.tailCall) out.tailCall = true;
    return out;
}

/**
 * Pure-of-input dispatch computation.  Depends only on the input
 * `alternatives` array (and the per-rule `spacingMode`s within it);
 * outer wrapper flags do not affect the partition.  `name` is
 * threaded in only for diagnostic logging on the bail-out paths.
 */
function computeDispatchPayload(
    alternatives: GrammarRule[],
    name: string | undefined,
): DispatchPayload | undefined {
    if (alternatives.length < 2) {
        // Single-rule "alternation" - nothing to dispatch.
        debug(`dispatch skip (single-rule) name='${name ?? "<unnamed>"}'`);
        return undefined;
    }

    // Partition members by their own spacing mode.  Build per-mode
    // tokenMaps in member-source order of first appearance: the
    // first member's mode seeds perMode[0], a later member with a
    // different eligible mode appends a new perMode entry, and so
    // on.  Members in `optional`/`none` mode are not peek-eligible
    // and go to fallback unconditionally.
    type ModeBucket = {
        spacingMode: CompiledSpacingMode;
        tokenMap: Map<string, GrammarRule[]>;
    };
    const perMode: ModeBucket[] = [];
    const fallback: GrammarRule[] = [];
    const findMode = (mode: CompiledSpacingMode): ModeBucket | undefined => {
        for (const m of perMode) {
            if (m.spacingMode === mode) return m;
        }
        return undefined;
    };
    for (const rule of alternatives) {
        const mode = rule.spacingMode;
        if (mode === "optional" || mode === "none") {
            // Not peek-eligible - peek's separator handling
            // doesn't agree with what the StringPart regex would
            // consume in these modes.
            fallback.push(rule);
            continue;
        }
        const cls = classifyDispatchMember(rule, mode);
        if (cls.kind === "fallback") {
            fallback.push(rule);
            continue;
        }
        let bucket = findMode(mode);
        if (bucket === undefined) {
            bucket = { spacingMode: mode, tokenMap: new Map() };
            perMode.push(bucket);
        }
        const existing = bucket.tokenMap.get(cls.token);
        if (existing !== undefined) {
            existing.push(rule);
        } else {
            bucket.tokenMap.set(cls.token, [rule]);
        }
    }

    if (perMode.length === 0) {
        debug(`dispatch skip (all-fallback) name='${name ?? "<unnamed>"}'`);
        return undefined;
    }
    // Total token-key count: sum of `tokenMap.size` across every
    // perMode entry.  A single token key (with no fallback) means the
    // dispatch always picks the same single rule list, offering no
    // filtering benefit over the original `RulesPart`.
    let totalTokenKeys = 0;
    for (const m of perMode) totalTokenKeys += m.tokenMap.size;
    if (totalTokenKeys === 1 && fallback.length === 0) {
        debug(
            `dispatch skip (single-bucket-no-fallback) name='${name ?? "<unnamed>"}'`,
        );
        return undefined;
    }

    return {
        // Canonicalize empty fallback to a shared frozen sentinel so
        // the serializer can dedup empty-rules slots across every
        // dispatched part: each fallback `[]` would otherwise be a
        // fresh array identity and `indexFor([])` would mint a fresh
        // JSON slot per dispatched part.
        alternatives: fallback.length === 0 ? EMPTY_FALLBACK_RULES : fallback,
        dispatch: perMode,
    };
}

/**
 * Walk every rule array in `rules` post-order, attempting to
 * attach a first-token dispatch index to each `RulesPart` whose
 * alternatives can be partitioned by first input token.  The
 * top-level alternation is also dispatched when eligible - the
 * result rides on the returned `dispatch` field, sitting next to
 * the trimmed `rules` (the fallback subset).  No wrapper rule is
 * synthesized: hoisting dispatch onto the grammar shape lets each
 * surviving top-level alternative remain a true top-level frame
 * with its own `spacingMode`, restoring per-rule leading-spacing
 * semantics in mixed-mode grammars (a wrapper would impose a
 * single uniform mode on every member).
 *
 * Identity-sharing of `GrammarRule[]` arrays (the dedup invariant
 * the serializer relies on) is preserved via memoization.
 *
 * **Match-order note (deliberate, observable change).**  The
 * unoptimized `RulesPart` tries members in source order.  After
 * dispatch, on a peek-hit only the bucket members (a *subset*) are
 * tried first, then `fallback`.  When the original source order
 * interleaved a fallback member (e.g. wildcard-first) *before* a
 * token-first member, that fallback is now tried after the bucket
 * - so on input both alternatives accept, the bucket member wins
 * where the source-order fallback would have won previously.  This
 * is accepted as part of the dispatch optimization (the source-order
 * promise is a casualty of first-token bucketing).
 *
 * Future: a `preserveSourceOrder` opt-in could bail out of
 * dispatchification at any fork where a fallback rule appears
 * before any token-bucket rule in source order (or, more
 * permissively, only when the fallback's first part could overlap
 * with a tokenMap key).  Not yet wired up - no measured need.
 */
function dispatchifyAlternations(rules: GrammarRule[]): {
    alternatives: GrammarRule[];
    dispatch?: DispatchModeBucket[];
} {
    const counter = { dispatched: 0 };
    const memo = new Map<GrammarRule[], GrammarRule[]>();
    // Cache the dispatch transformation per input `alternatives`
    // identity so two `RulesPart`s sharing the same alternatives
    // array (compiler named-rule sharing) emit the same trimmed
    // fallback array and the same `DispatchModeBucket[]` - preserving
    // the serializer's identity-based dedup invariant.  Shared
    // across the whole pass including the top-level hoist below.
    const dispatchMemo: DispatchMemo = new Map();

    const result = visitRulesArray(rules, counter, memo, dispatchMemo);

    // Top-level dispatch: build a transient `RulesPart` over the
    // top-level alternatives and try to dispatch it.  On success,
    // hoist the dispatch index and the trimmed fallback subset
    // onto the grammar shape directly - no wrapper rule synthesized.
    const out: {
        alternatives: GrammarRule[];
        dispatch?: DispatchModeBucket[];
    } = {
        alternatives: result,
    };
    if (result.length >= 2) {
        const dispatched = tryDispatchifyRulesPart(
            {
                type: "rules",
                alternatives: result,
            },
            dispatchMemo,
        );
        if (dispatched?.dispatch !== undefined) {
            counter.dispatched++;
            out.alternatives = dispatched.alternatives;
            out.dispatch = dispatched.dispatch;
        }
    }
    if (counter.dispatched > 0) {
        debug(
            `dispatched ${counter.dispatched} alternations into token tables`,
        );
    }
    return out;
}

function visitRulesArray(
    rules: GrammarRule[],
    counter: { dispatched: number },
    memo: Map<GrammarRule[], GrammarRule[]>,
    dispatchMemo: DispatchMemo,
): GrammarRule[] {
    const cached = memo.get(rules);
    if (cached !== undefined) return cached;
    memo.set(rules, rules);
    let next: GrammarRule[] | undefined;
    for (let i = 0; i < rules.length; i++) {
        const r = visitRule(rules[i], counter, memo, dispatchMemo);
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

function visitRule(
    rule: GrammarRule,
    counter: { dispatched: number },
    memo: Map<GrammarRule[], GrammarRule[]>,
    dispatchMemo: DispatchMemo,
): GrammarRule {
    let outParts: GrammarPart[] | undefined;
    for (let i = 0; i < rule.parts.length; i++) {
        const p = rule.parts[i];
        const visited = visitPart(p, counter, memo, dispatchMemo);
        if (outParts !== undefined) {
            outParts.push(visited);
        } else if (visited !== p) {
            outParts = rule.parts.slice(0, i);
            outParts.push(visited);
        }
    }
    if (outParts === undefined) return rule;
    return { ...rule, parts: outParts };
}

function visitPart(
    part: GrammarPart,
    counter: { dispatched: number },
    memo: Map<GrammarRule[], GrammarRule[]>,
    dispatchMemo: DispatchMemo,
): GrammarPart {
    if (part.type !== "rules") {
        return part;
    }
    // Already-dispatched parts: recurse into bucket members and the
    // fallback subset, then return.  We never re-dispatch (would
    // partition only the fallback subset, which is wrong).
    if (part.dispatch !== undefined) {
        const newPerMode = mapDispatchBuckets(part.dispatch, (bucket) =>
            visitRulesArray(bucket, counter, memo, dispatchMemo),
        );
        const innerRules = visitRulesArray(
            part.alternatives,
            counter,
            memo,
            dispatchMemo,
        );
        if (innerRules === part.alternatives && newPerMode === part.dispatch) {
            return part;
        }
        return {
            ...part,
            alternatives: innerRules,
            dispatch: newPerMode,
        };
    }
    // Recurse first (post-order) so nested dispatch attempts run
    // before the outer one decides classification.
    const innerRules = visitRulesArray(
        part.alternatives,
        counter,
        memo,
        dispatchMemo,
    );
    const innerPart: RulesPart =
        innerRules !== part.alternatives
            ? { ...part, alternatives: innerRules }
            : part;
    const dispatched = tryDispatchifyRulesPart(innerPart, dispatchMemo);
    if (dispatched !== undefined) {
        counter.dispatched++;
        return dispatched;
    }
    return innerPart;
}

// ─────────────────────────────────────────────────────────────────────────────
// Optimization: promote trailing RulesPart to tail call
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Walk every rule in `rules` and convert each rule's trailing
 * `RulesPart` into a tail call when the structural contract permits
 * it.  Recurses through nested `RulesPart` alternatives and dispatch
 * buckets so trailing parts inside member rules are promoted too.
 *
 * Two shapes are supported by `tryPromoteTrailing`:
 *   - Pure forwarding (parent has no value): just sets `tailCall` and
 *     drops the wrapper variable; member values flow up directly.
 *   - Value substitution (parent value references the trailing
 *     wrapper variable): materializes each member's effective value
 *     and substitutes it into parent.value, written back as the
 *     member's new value.
 *
 * Identity-shared `GrammarRule[]` arrays are visited at most once via
 * `memo` so post-pass identity matches input identity wherever
 * possible (preserves the serializer dedup invariant for unchanged
 * arrays).
 */
function promoteRulesArray(
    rules: GrammarRule[],
    counter: { promoted: number },
    memo: RulesArrayMemo,
): GrammarRule[] {
    const cached = memo.get(rules);
    if (cached !== undefined) return cached;
    memo.set(rules, rules);
    let next: GrammarRule[] | undefined;
    for (let i = 0; i < rules.length; i++) {
        const r = promoteRule(rules[i], counter, memo);
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

function promoteRule(
    rule: GrammarRule,
    counter: { promoted: number },
    memo: RulesArrayMemo,
): GrammarRule {
    // Recurse into nested `RulesPart`s within this rule's parts
    // first so inner trailing RulesParts are promoted before we
    // consider this rule's own trailing part.
    let parts = rule.parts;
    let outParts: GrammarPart[] | undefined;
    for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        if (p.type !== "rules") {
            if (outParts !== undefined) outParts.push(p);
            continue;
        }
        const recursed = promoteInsideRulesPart(p, counter, memo);
        if (outParts !== undefined) {
            outParts.push(recursed);
        } else if (recursed !== p) {
            outParts = parts.slice(0, i);
            outParts.push(recursed);
        }
    }
    if (outParts !== undefined) parts = outParts;

    const promoted = tryPromoteTrailing(rule, parts);
    if (promoted !== undefined) {
        counter.promoted++;
        return promoted;
    }
    if (outParts !== undefined) return { ...rule, parts };
    return rule;
}

function promoteInsideRulesPart(
    part: RulesPart,
    counter: { promoted: number },
    memo: RulesArrayMemo,
): RulesPart {
    const newAlts = promoteRulesArray(part.alternatives, counter, memo);
    const newDispatch =
        part.dispatch === undefined
            ? part.dispatch
            : mapDispatchBuckets(part.dispatch, (bucket) =>
                  promoteRulesArray(bucket, counter, memo),
              );
    if (newAlts === part.alternatives && newDispatch === part.dispatch) {
        return part;
    }
    const out: RulesPart = { ...part, alternatives: newAlts };
    if (newDispatch !== undefined) out.dispatch = newDispatch;
    return out;
}

/**
 * Attempt to convert `rule`'s trailing `RulesPart` into a tail call.
 * Returns the rewritten rule on success or `undefined` if the rule
 * doesn't match either supported shape.
 *
 * Preconditions checked here mirror the `RulesPart.tailCall`
 * structural contract so the result will pass `validateTailRulesParts`:
 *   - last part is a `RulesPart`
 *   - that part has no `repeat` / `optional` / existing `tailCall`
 *   - effective member count >= 2
 *   - every member's `spacingMode` matches the parent rule's
 *
 * On success delegates per-shape work to `checkForwardingPromotable`
 * (no member rewrite needed) or `trySubstituteMembers` (members
 * rewritten via direct dispatch+fallback walk - no implicit
 * ordering contract with `getDispatchEffectiveMembers`).
 */
function tryPromoteTrailing(
    rule: GrammarRule,
    parts: GrammarPart[],
): GrammarRule | undefined {
    if (parts.length === 0) return undefined;
    const last = parts[parts.length - 1];
    if (last.type !== "rules") return undefined;
    if (last.tailCall) return undefined;
    if (last.repeat || last.optional) return undefined;
    // Read-only spacing/effective-count check via the shared helper.
    // No write-back contract: rewrites below walk the dispatch shape
    // directly so member ordering between read and write paths is
    // not an implicit invariant.
    const members = getDispatchEffectiveMembers(last);
    if (members.length < 2) return undefined;
    for (const m of members) {
        if (m.spacingMode !== rule.spacingMode) return undefined;
    }

    let newDispatch: DispatchModeBucket[] | undefined;
    let newAlternatives: GrammarRule[];
    if (rule.value === undefined) {
        if (!checkForwardingPromotable(parts, last)) return undefined;
        // Members are unchanged: their existing values / implicit
        // defaults flow up directly via tail entry.
        newDispatch = last.dispatch;
        newAlternatives = last.alternatives;
    } else {
        const subbed = trySubstituteMembers(rule.value, last);
        if (subbed === undefined) return undefined;
        newDispatch = subbed.dispatch;
        newAlternatives = subbed.alternatives;
    }

    // Build the rewritten last part: drop variable / repeat /
    // optional (already verified absent), set tailCall.
    const newLast: RulesPart = {
        type: "rules",
        alternatives: newAlternatives,
        tailCall: true,
    };
    if (last.name !== undefined) newLast.name = last.name;
    if (newDispatch !== undefined) newLast.dispatch = newDispatch;

    const newParts = parts.slice();
    newParts[newParts.length - 1] = newLast;
    const out: GrammarRule = { parts: newParts };
    if (rule.spacingMode !== undefined) out.spacingMode = rule.spacingMode;
    // Parent.value is intentionally dropped: pure-forwarding case
    // never had one; substitution case folded it into each member.
    return out;
}

/**
 * Forwarding-mode (parent has no `value`) precondition check.  The
 * matcher's implicit-default rule fires for the parent, so we only
 * promote when the trailing `RulesPart` is *exactly* the part that
 * would have contributed under that rule:
 *
 *   - Single-part rule (`parts.length === 1`): the lone part is the
 *     trailing `RulesPart`, which contributes its captured value
 *     regardless of binding.  Always safe.
 *   - Multi-part rule: the matcher requires exactly one
 *     implicit-default-contributing part (else `createValue` throws
 *     "missing/multiple values for default" at finalize time).
 *     Promoting masks that error - the tail-entry mechanism bypasses
 *     the parent's `createValue` entirely.  Require the trailing
 *     `RulesPart` to be that sole contributor (which means it must
 *     be bound: `last.variable !== undefined`); bail out at any
 *     other shape so baseline-throw paths stay observable on the
 *     optimized AST.
 */
function checkForwardingPromotable(
    parts: GrammarPart[],
    last: RulesPart,
): boolean {
    if (parts.length <= 1) return true;
    if (last.variable === undefined) return false;
    // Multi-part rule: matcher's implicit-default rule requires
    // exactly one variable-bearing contributor (wildcard / number
    // always; rules / string / phraseSet only when bound; every
    // `GrammarPart` carries an optional `variable` field, so a
    // single `p.variable !== undefined` test covers the union).
    // Promoting masks the baseline missing/multiple-default throws
    // at finalize time, so bail out unless the trailing RulesPart
    // is the sole contributor.
    for (let i = 0; i < parts.length - 1; i++) {
        if (parts[i].variable !== undefined) return false;
    }
    return true;
}

/**
 * Substitution-mode rewrite.  For each member of `last`'s dispatch
 * buckets and fallback alternatives, α-rename top-level bindings
 * (to avoid shadowing prefix-bound names referenced from
 * `parentValue`), materialize the member's effective value, then
 * substitute that into a copy of `parentValue` and write the result
 * as the member's new `value`.  Returns the rewritten `dispatch` /
 * `alternatives` pair, or `undefined` if any member can't be
 * rewritten (signals a local bailout).
 *
 * Walks the dispatch + fallback shape directly so the rewritten AST
 * shape mirrors the source shape without any implicit ordering
 * contract with `getDispatchEffectiveMembers`.
 */
function trySubstituteMembers(
    parentValue: CompiledValueNode,
    last: RulesPart,
):
    | {
          dispatch: DispatchModeBucket[] | undefined;
          alternatives: GrammarRule[];
      }
    | undefined {
    const v = last.variable;
    if (v === undefined) return undefined;
    const refs = collectVariableReferences(parentValue);
    if (!refs.has(v)) return undefined;
    // One `RenameState` per promotion site so all members of this
    // fork draw fresh names from the same counter; renames within
    // this tail-RulesPart never repeat.  Names are opaque
    // (`__opt_inline_<n>`) and cannot collide with any user-named
    // outer binding, so a substituted reference intended for the
    // prefix can't be shadowed by a member's own binding.
    const renameState: RenameState = { next: 0 };
    let bailed = false;
    const rewriteOne = (m: GrammarRule): GrammarRule => {
        const renamed = renameAllChildBindings(m.parts, m.value, renameState);
        const effective =
            renamed.value !== undefined
                ? renamed.value
                : getImplicitDefaultValue({
                      ...m,
                      parts: renamed.parts,
                      value: renamed.value,
                  });
        if (effective === undefined) {
            // Member has no explicit value and we can't synthesize
            // one to substitute (e.g. unbound single-part
            // string / phraseSet).  Signal a local bailout.
            bailed = true;
            return m;
        }
        const subs = new Map<string, CompiledValueNode>();
        subs.set(v, effective);
        const newValue = substituteValueVariables(parentValue, subs);
        return { ...m, parts: renamed.parts, value: newValue };
    };
    const rewriteBucket = (bucket: GrammarRule[]): GrammarRule[] => {
        // Empty bucket (most commonly the `EMPTY_FALLBACK_RULES`
        // sentinel from `dispatchifyAlternations`) has nothing to
        // rewrite; return the input identity so the sentinel keeps
        // sharing across promotions.
        if (bucket.length === 0) return bucket;
        const out: GrammarRule[] = [];
        for (const r of bucket) {
            out.push(rewriteOne(r));
            if (bailed) return bucket;
        }
        return out;
    };

    const newAlts: GrammarRule[] = rewriteBucket(last.alternatives);
    if (bailed) return undefined;
    let newDispatch: DispatchModeBucket[] | undefined;
    if (last.dispatch !== undefined) {
        newDispatch = last.dispatch.map((m) => {
            const newMap = new Map<string, GrammarRule[]>();
            for (const [tok, bucket] of m.tokenMap) {
                newMap.set(tok, rewriteBucket(bucket));
            }
            return { ...m, tokenMap: newMap };
        });
        if (bailed) return undefined;
    }
    // EMPTY_FALLBACK_RULES is a frozen sentinel used elsewhere in
    // the optimizer (see `dispatchifyAlternations`) to mark "no
    // fallback".  `validateTailRulesParts` accepts it (the contract
    // checks effective-member count, which counts dispatched
    // buckets); the matcher's tail-entry path never indexes into
    // an empty fallback.  Reuse the same sentinel here so the
    // serializer's identity-based dedup keeps working.
    const fallback =
        last.dispatch !== undefined && newAlts.length === 0
            ? EMPTY_FALLBACK_RULES
            : newAlts;
    return { dispatch: newDispatch, alternatives: fallback };
}

/**
 * Compute a value expression equivalent to what the matcher's
 * implicit-default rule would produce for `rule` if it were matched
 * standalone.  Returns `undefined` if the rule doesn't have a
 * structurally-expressible default (e.g. an unbound single-part
 * `phraseSet` / `string` whose value depends on the matched text).
 *
 * Used by the value-substitution branch of `tryPromoteTrailing` to
 * fold each member's effective value into the parent's value
 * expression.
 */
function getImplicitDefaultValue(
    rule: GrammarRule,
): CompiledValueNode | undefined {
    if (rule.value !== undefined) return rule.value;
    const parts = rule.parts;
    if (parts.length === 0) return undefined;
    if (parts.length === 1) {
        // Single-part rule: matcher forwards the part's value.  For
        // var-bearing parts we can express that as a variable
        // reference; for unbound `string` / `phraseSet` (whose
        // matcher value derives from the matched text) and unbound
        // `rules` (whose value derives from the inner match) we
        // can't reify the result without changing the AST, so bail.
        const name = parts[0].variable;
        return name !== undefined ? { type: "variable", name } : undefined;
    }
    // Multi-part: implicit default requires exactly one
    // var-bearing part.  Same predicate as the inliner's
    // binding-friendly check for multi-part children.
    let theVar: string | undefined;
    for (const p of parts) {
        const name = p.variable;
        if (name === undefined) continue;
        if (theVar !== undefined) return undefined;
        theVar = name;
    }
    return theVar !== undefined
        ? { type: "variable", name: theVar }
        : undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Structural validation: RulesPart.tailCall contract
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Walk every rule in `rules` and verify that any `RulesPart`
 * carrying `tailCall: true` satisfies the contract documented on
 * `RulesPart.tailCall`:
 *
 *   - last entry in its parent rule's `parts`
 *   - parent rule has no `value` of its own
 *   - `repeat` / `optional` / `variable` all unset
 *   - effective member count >= 2.  For a non-dispatched part this
 *     is just `rules.length`; for a dispatched part it is the
 *     *static* sum of bucket sizes across every `dispatch` entry
 *     plus the fallback `rules.length`.  Note this is a structural
 *     check on the AST shape, not a runtime guarantee: at match
 *     time the dispatch entry peeks one input token and selects a
 *     *single* bucket (plus fallback) to form the effective
 *     alternation list, so the runtime list size for a given
 *     dispatch entry can be 1.  `enterTailAlternation` has its own
 *     `rules.length > 1` guard for that case (matching
 *     `enterRulesAlternation`'s behavior); the check here only
 *     ensures the dispatch could ever pick more than one member.
 *   - every member's `spacingMode` matches the parent rule's
 *
 * Throws on the first violation with a message identifying the
 * offending rule.  Cheap to run; intended to be called after loading
 * a serialized grammar from JSON (where the bytes are not produced by
 * a trusted in-process compiler) and from tests.
 *
 * Members are recursed into so that nested tail parts are also
 * validated.
 */
export function validateTailRulesParts(
    rules: GrammarRule[],
    dispatch?: DispatchModeBucket[] | undefined,
): void {
    const visited = new WeakSet<GrammarRule[]>();
    const visitRules = (rs: GrammarRule[]): void => {
        if (visited.has(rs)) return;
        visited.add(rs);
        for (const r of rs) visitRule(r);
    };
    const visitRule = (rule: GrammarRule): void => {
        const parts = rule.parts;
        for (let i = 0; i < parts.length; i++) {
            const p = parts[i];
            if (p.type !== "rules") continue;
            if (p.tailCall) {
                const members = getDispatchEffectiveMembers(p);
                checkTailContract(rule, p, i, parts.length, {
                    members,
                    effectiveCount: members.length,
                });
            }
            if (p.dispatch !== undefined) {
                for (const m of p.dispatch) {
                    for (const bucket of m.tokenMap.values()) {
                        visitRules(bucket);
                    }
                }
            }
            visitRules(p.alternatives);
        }
    };
    visitRules(rules);
    // Top-level dispatch buckets (Phase 2): walk member rules
    // hoisted onto `grammar.dispatch` so nested tail parts inside
    // them are also validated.  The grammar level itself cannot
    // carry `tailCall` (only RulesPart can), so no contract check
    // applies here - just walk the rule contents.
    if (dispatch !== undefined) {
        for (const m of dispatch) {
            for (const bucket of m.tokenMap.values()) {
                visitRules(bucket);
            }
        }
    }
}

/**
 * Shared contract checker for tail `RulesPart` (with or without a
 * `dispatch` index).  The five clauses (last-part, no parent value,
 * no repeat/optional/variable, effective member count >= 2, member
 * spacingMode equality) are identical across both shapes.
 */
function checkTailContract(
    rule: GrammarRule,
    p: {
        name?: string | undefined;
        repeat?: boolean | undefined;
        optional?: boolean | undefined;
        variable?: string | undefined;
    },
    index: number,
    partsLength: number,
    effective: { members: Iterable<GrammarRule>; effectiveCount: number },
): void {
    const where = `(name='${p.name ?? "<unnamed>"}')`;
    const label = `Invalid tail RulesPart`;
    if (index !== partsLength - 1) {
        throw new Error(
            `${label}: must be the last part of its parent rule ${where}`,
        );
    }
    if (rule.value !== undefined) {
        throw new Error(
            `${label}: parent rule must have no value of its own ${where}`,
        );
    }
    if (p.repeat || p.optional || p.variable !== undefined) {
        throw new Error(
            `${label}: repeat/optional/variable are forbidden ${where}`,
        );
    }
    if (effective.effectiveCount < 2) {
        throw new Error(
            `${label}: requires effective member count >= 2 (got ${effective.effectiveCount}) ${where}`,
        );
    }
    for (const m of effective.members) {
        if (m.spacingMode !== rule.spacingMode) {
            throw new Error(
                `${label}: every member's spacingMode must match the parent rule's ${where}`,
            );
        }
    }
}
