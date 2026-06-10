// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Shared Tier-1 (preference) / Tier-2 (clarify) decision logic for the
// `preference-clarify` collision strategy. Both runtime detection points —
// grammarMatch (matchCollision.ts) and llmSelect (translateRequest.ts) —
// adapt their own candidate types to `PreferenceMember[]` and call in here so
// the policy lives in one place.

import { CommandHandlerContext } from "./commandHandlerContext.js";
import { PreferenceContext, PreferenceMember } from "./collisionPreferences.js";
import { CollisionRegistry } from "./collisionRegistry.js";

/**
 * Build the `PreferenceContext` for the current request. Empty today — the
 * candidate set alone keys a preference. Reserved for future deterministic,
 * low-cardinality signals (time-of-day bucket, host device, location, active
 * app). Centralized here so adding a signal updates every call site at once.
 */
export function getPreferenceContext(
    _ctx: CommandHandlerContext,
): PreferenceContext {
    return {};
}

/**
 * Return the loaded registry for the current `collision.preference.registryPath`,
 * reloading when the configured path has changed since the last load.
 */
export function ensureCollisionRegistry(
    ctx: CommandHandlerContext,
): CollisionRegistry {
    const path = ctx.session.getConfig().collision.preference.registryPath;
    if (path !== ctx.collisionRegistryPath) {
        ctx.collisionRegistry = CollisionRegistry.load(path);
        ctx.collisionRegistryPath = path;
    }
    return ctx.collisionRegistry;
}

/** Sibling-enrich a member list using the registry, de-duplicated. */
function enrichWithSiblings(
    members: PreferenceMember[],
    registry: CollisionRegistry,
): PreferenceMember[] {
    const out = new Map<string, PreferenceMember>();
    for (const m of members) {
        out.set(`${m.schemaName}.${m.actionName}`, m);
    }
    for (const m of members) {
        for (const sib of registry.siblingsOf(m)) {
            out.set(`${sib.schemaName}.${sib.actionName}`, sib);
        }
    }
    return [...out.values()];
}

/**
 * Peek (without consuming) a pending one-shot pick that matches one of
 * `members`. A one-shot pick is stashed when the user resolves an interactive
 * clarify card so the re-run of the original request routes to their choice;
 * the registry-first detectors call this before building a (duplicate) clarify
 * card. Returns the matching member, or undefined when there's no pending pick.
 */
export function peekOneShotPick(
    members: PreferenceMember[],
    ctx: CommandHandlerContext,
): PreferenceMember | undefined {
    if (ctx.collisionOneShotPicks.size === 0) {
        return undefined;
    }
    return members.find((m) =>
        ctx.collisionOneShotPicks.has(`${m.schemaName}.${m.actionName}`),
    );
}

/** Consume (remove) a one-shot pick once it has been honored. */
export function consumeOneShotPick(
    member: PreferenceMember,
    ctx: CommandHandlerContext,
): void {
    ctx.collisionOneShotPicks.delete(
        `${member.schemaName}.${member.actionName}`,
    );
}

export type PreferenceClarifyDecision =
    /** Tier 1 hit — auto-resolve to `chosen` (which is in the executable set). */
    | { kind: "preferred"; chosen: PreferenceMember; key: string }
    /** Tier 2 — ask the user; `members` is the (possibly enriched) option list. */
    | { kind: "clarify"; members: PreferenceMember[] }
    /** Gate said don't escalate — caller should fall back to first-match. */
    | { kind: "first-match" };

/**
 * Decide what the `preference-clarify` strategy does for a detected collision
 * whose executable options are `executable` (the validated match set or the
 * ambiguous embedding cluster — every entry is something the dispatcher can
 * actually run).
 */
export function resolvePreferenceClarify(
    executable: PreferenceMember[],
    ctx: CommandHandlerContext,
): PreferenceClarifyDecision {
    const cfg = ctx.session.getConfig().collision.preference;
    const registry = ensureCollisionRegistry(ctx);
    const context = getPreferenceContext(ctx);

    // Tier 0: one-shot override. When the user resolves an interactive
    // clarify card, the chosen candidate's id is stashed here just before the
    // original request is re-run, so this re-translation resolves to it even
    // when "remember" was unchecked (no durable preference written). Keyed by
    // member id (not candidate-set) so registry enrichment of the displayed
    // options doesn't break the match. Consumed on first hit so it never
    // leaks into a later request.
    if (ctx.collisionOneShotPicks.size > 0) {
        const hit = executable.find((m) =>
            ctx.collisionOneShotPicks.has(`${m.schemaName}.${m.actionName}`),
        );
        if (hit !== undefined) {
            ctx.collisionOneShotPicks.delete(
                `${hit.schemaName}.${hit.actionName}`,
            );
            return {
                kind: "preferred",
                chosen: hit,
                key: `${hit.schemaName}.${hit.actionName}`,
            };
        }
    }

    // Gate: when the operator only trusts the persisted registry as the
    // ambiguity signal, a runtime-only collision is not enough to escalate.
    if (cfg.ambiguitySource === "registry") {
        const knownAmbiguous = executable.some((m) =>
            registry.isKnownAmbiguous(m),
        );
        if (!knownAmbiguous) {
            return { kind: "first-match" };
        }
    }

    // Tier 1: consult the preference store. `find` only returns a hit when the
    // preferred option is present in `executable`, so the result is runnable.
    if (cfg.enabled) {
        const pref = ctx.collisionPreferences.find(executable, context);
        if (pref !== undefined) {
            ctx.collisionPreferences.recordHit(pref.key);
            return { kind: "preferred", chosen: pref.chosen, key: pref.key };
        }
    }

    // Tier 2: clarify. Enrich the displayed options with registry siblings
    // when the registry is an active signal (the option list is informational
    // — the user's reply re-enters as a fresh request).
    let members = executable;
    if (cfg.ambiguitySource !== "runtime" && !registry.isEmpty) {
        members = enrichWithSiblings(executable, registry);
    }
    return { kind: "clarify", members };
}

/**
 * For a single confident match (no runtime collision cluster): decide whether
 * the registry alone marks it as "known to be ambiguous" and we should still
 * clarify. Returns the (sibling-enriched) option list to clarify with plus the
 * id(s) of the neighborhood that flagged it, or undefined to proceed with the
 * single match.
 *
 * Only fires when the registry is an active ambiguity source
 * (`registry` / `both`).
 */
export function escalateKnownAmbiguousMatch(
    member: PreferenceMember,
    ctx: CommandHandlerContext,
): RegistryAmbiguityMatch | undefined {
    const cfg = ctx.session.getConfig().collision.preference;
    if (cfg.ambiguitySource === "runtime") {
        return undefined;
    }
    const registry = ensureCollisionRegistry(ctx);
    if (!registry.isKnownAmbiguous(member)) {
        return undefined;
    }
    const members = enrichWithSiblings([member], registry);
    // Nothing to disambiguate if the registry yielded no siblings.
    if (members.length <= 1) {
        return undefined;
    }
    return { members, neighborhoodIds: registry.neighborhoodIdsFor(member) };
}

/**
 * The outcome of a registry-driven ambiguity detection: the clarify option
 * list (matched candidate plus its registry siblings) and the id(s) of the
 * neighborhood that flagged it (surfaced in the clarify card / telemetry for
 * traceability back to the source cluster).
 */
export interface RegistryAmbiguityMatch {
    members: PreferenceMember[];
    neighborhoodIds: string[];
}

/**
 * Registry-first detection mode: scan an ordered list of candidate matches
 * (e.g. the full embedding result set, highest score first) against the
 * persisted neighborhood registry, independent of any embedding score-delta.
 *
 * Returns the sibling-enriched option list (plus the flagging neighborhood
 * id(s)) for the highest-ranked candidate the registry marks as
 * known-ambiguous, or undefined when no candidate is a registry member (or the
 * matched neighborhood yields no siblings).
 *
 * Unlike `escalateKnownAmbiguousMatch` (which only consults the registry for
 * the single top-1 match), this scans the whole candidate set, so the registry
 * can drive a clarify even when the embedding's first pick is not itself a
 * registry member.
 */
export function detectRegistryAmbiguity(
    candidates: PreferenceMember[],
    ctx: CommandHandlerContext,
): RegistryAmbiguityMatch | undefined {
    const registry = ensureCollisionRegistry(ctx);
    if (registry.isEmpty) {
        return undefined;
    }
    for (const candidate of candidates) {
        if (!registry.isKnownAmbiguous(candidate)) {
            continue;
        }
        const members = enrichWithSiblings([candidate], registry);
        if (members.length > 1) {
            return {
                members,
                neighborhoodIds: registry.neighborhoodIdsFor(candidate),
            };
        }
    }
    return undefined;
}
