// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Shared completion utilities for consumers (shell, CLI, etc.) that
// import through the dispatcher.  Types and pure functions extracted
// from the shell's PartialCompletionSession so that any host can
// reuse the separator-level model, partition logic, and no-match
// policy without duplicating code.
//
// Architecture: docs/architecture/completion.md — §5 Shell — Completion Session
//               (shared subset)

import {
    AfterWildcard,
    CompletionGroup,
    SeparatorMode,
} from "@typeagent/agent-sdk";

// Re-export the lightweight action-grammar utility.
// Import for local use in toPartitions; also re-export for consumers.
import { needsSeparatorInAutoMode } from "action-grammar/completion";
export { needsSeparatorInAutoMode };

// ── NoMatchPolicy ────────────────────────────────────────────────────────
//
// Describes what the host should do when the local trie has no matches
// for the user's typed prefix.  Computed once from the backend's
// descriptive fields (closedSet, afterWildcard) when a result arrives,
// then used in session reuse decisions.
//
//   "accept"  — the completion set is exhaustive; no re-fetch can help.
//               (Derived from closedSet=true, afterWildcard="none".)
//   "refetch" — the set is open-ended; the backend may know more.
//               (Derived from closedSet=false, or afterWildcard="some".)
//   "slide"   — the anchor sits at a sliding wildcard boundary; slide
//               it forward instead of re-fetching or giving up.
//               (Derived from afterWildcard="all", any closedSet.)

export type NoMatchPolicy = "accept" | "refetch" | "slide";

export function computeNoMatchPolicy(
    closedSet: boolean,
    afterWildcard: AfterWildcard,
): NoMatchPolicy {
    if (afterWildcard === "all") return "slide";
    if (closedSet && afterWildcard === "none") return "accept";
    // Covers closedSet=false (open-ended set) and afterWildcard="some"
    // (mixed wildcard/literal rules — neither sliding nor accepting is safe).
    return "refetch";
}

// ── SepLevel: separator progression model ────────────────────────────────
//
// Three ordered levels describing what separator characters have been
// consumed between anchor and menuAnchorIndex.  Each level defines which
// SeparatorMode values are visible in the trie.
//
// Level 0 (none):      No separator consumed.
// Level 1 (space):     Whitespace consumed.
// Level 2 (spacePunctuation): Whitespace + punctuation consumed.

export type SepLevel = 0 | 1 | 2;

// SeparatorMode after "autoSpacePunctuation" has been resolved per-item
// and undefined has been defaulted to "space".  Partitions always use
// this type — no deferred or missing modes at the host level.
export type ResolvedSeparatorMode = Exclude<
    SeparatorMode,
    "autoSpacePunctuation"
>;

// Cached regexes for separator character classification.
const punctRe = /\p{P}/u;
const whitespaceRe = /\s/;

// Returns the SepLevel corresponding to a single character:
// 2 for Unicode punctuation, 1 for whitespace, undefined otherwise.
export function separatorCharLevel(ch: string): SepLevel | undefined {
    if (punctRe.test(ch)) return 2;
    if (whitespaceRe.test(ch)) return 1;
    return undefined;
}

const leadingSepRe = /^[\s\p{P}]+/u;

// Returns the length of the leading separator run in rawPrefix.
export function leadingSeparatorLength(rawPrefix: string): number {
    const m = rawPrefix.match(leadingSepRe);
    return m !== null ? m[0].length : 0;
}

export function computeSepLevel(rawPrefix: string): SepLevel {
    if (rawPrefix === "") return 0;
    // Check the leading separator portion for whitespace and punctuation.
    const leadingSep = rawPrefix.match(leadingSepRe);
    if (leadingSep === null) return 0;
    const sep = leadingSep[0];
    if (punctRe.test(sep)) return 2;
    // Only whitespace in the leading separator portion.
    return 1;
}

// Visibility matrix (non-cumulative, per-level):
//
//   ResolvedSeparatorMode       Lv0  Lv1  Lv2
//   "none"                       ✓    —    —
//   "optionalSpace"              ✓    ✓    —
//   "optionalSpacePunctuation"   ✓    ✓    ✓
//   "space"                      —    ✓    —
//   "spacePunctuation"           —    ✓    ✓
//
// Each level has its own set of items.  Loading a new level replaces
// the trie (not appends).

// Returns true when a partition's separatorMode belongs to the given
// level per the visibility matrix.  Non-cumulative.
export function isModeAtLevel(
    mode: ResolvedSeparatorMode,
    level: SepLevel,
): boolean {
    switch (level) {
        case 0:
            return (
                mode === "none" ||
                mode === "optionalSpace" ||
                mode === "optionalSpacePunctuation"
            );
        case 1:
            return (
                mode === "space" ||
                mode === "optionalSpace" ||
                mode === "optionalSpacePunctuation" ||
                mode === "spacePunctuation"
            );
        case 2:
            return (
                mode === "optionalSpacePunctuation" ||
                mode === "spacePunctuation"
            );
    }
}

// ── CompletionItem ───────────────────────────────────────────────────────
//
// Platform-agnostic completion item.  The shell extends this with
// UI-specific fields (e.g. SearchMenuItem), while the CLI can use it
// directly.

export type CompletionItem = {
    matchText: string;
    selectedText: string;
    sortIndex?: number;
    needQuotes?: boolean | undefined;
    emojiChar?: string | undefined;
};

// ── ItemPartition ────────────────────────────────────────────────────────
//
// An items-by-mode bucket.  Each partition holds the items from one or more
// CompletionGroups that share the same separatorMode.

export type ItemPartition<T extends CompletionItem = CompletionItem> = {
    mode: ResolvedSeparatorMode;
    items: T[];
};

// Returns items from partitions whose separatorMode belongs to the
// given level.  Non-cumulative — each level has its own item set.
export function itemsAtLevel<T extends CompletionItem>(
    partitions: ItemPartition<T>[],
    level: SepLevel,
): T[] {
    const result: T[] = [];
    for (const p of partitions) {
        if (isModeAtLevel(p.mode, level)) {
            for (const item of p.items) {
                result.push(item);
            }
        }
    }
    return result;
}

// ── LevelCounts ──────────────────────────────────────────────────────────
//
// Precomputed item counts per SepLevel.  Avoids rebuilding arrays
// on every keystroke for the many count-only checks.

export type LevelCounts = [number, number, number];

export function computeLevelCounts<T extends CompletionItem>(
    partitions: ItemPartition<T>[],
): LevelCounts {
    const counts: LevelCounts = [0, 0, 0];
    for (const p of partitions) {
        for (let level = 0; level <= 2; level++) {
            if (isModeAtLevel(p.mode, level as SepLevel)) {
                counts[level] += p.items.length;
            }
        }
    }
    return counts;
}

// Returns the lowest SepLevel that has items, or undefined when all
// counts are zero.
export function lowestLevelWithItems(
    counts: LevelCounts,
): SepLevel | undefined {
    for (let level = 0; level <= 2; level++) {
        if (counts[level] > 0) {
            return level as SepLevel;
        }
    }
    return undefined;
}

// Returns the highest SepLevel ≤ maxLevel that has items, falling back
// to lowestLevelWithItems when nothing exists at or below maxLevel
// (e.g. entities that only appear at level 1+).  Returns undefined when
// no level has items at all.
export function targetLevel(
    counts: LevelCounts,
    maxLevel: SepLevel,
): SepLevel | undefined {
    for (let l = maxLevel; l > 0; l--) {
        if (counts[l] > 0) {
            return l as SepLevel;
        }
    }
    return lowestLevelWithItems(counts);
}

// ── toPartitions ─────────────────────────────────────────────────────────
//
// Convert backend CompletionGroups into partitions keyed by separatorMode,
// preserving group order and sorting within each group.
//
// Groups with separatorMode="autoSpacePunctuation" are resolved per-item:
// each completion is assigned "spacePunctuation" or
// "optionalSpacePunctuation" based on the character pair
// (input[startIndex-1], completion[0]).  This preserves the agent's
// original ordering across the resulting partitions via sortIndex.
//
// The `createItem` callback lets hosts construct their own item type
// (e.g. the shell's SearchMenuItem with extra UI fields).  The default
// callback produces a plain CompletionItem.

function defaultCreateItem(
    choice: string,
    group: CompletionGroup,
    sortIndex: number,
): CompletionItem {
    return {
        matchText: choice,
        selectedText: choice,
        sortIndex,
        needQuotes: group.needQuotes,
        emojiChar: group.emojiChar,
    };
}

export function toPartitions<T extends CompletionItem = CompletionItem>(
    groups: CompletionGroup[],
    input: string,
    startIndex: number,
    // Cast required: TS cannot narrow CompletionItem → T at the default site.
    createItem: (
        choice: string,
        group: CompletionGroup,
        sortIndex: number,
    ) => T = defaultCreateItem as (
        choice: string,
        group: CompletionGroup,
        sortIndex: number,
    ) => T,
): ItemPartition<T>[] {
    const map = new Map<ResolvedSeparatorMode, T[]>();
    let sortIndex = 0;

    function addItem(
        mode: ResolvedSeparatorMode,
        choice: string,
        group: CompletionGroup,
    ): void {
        let bucket = map.get(mode);
        if (bucket === undefined) {
            bucket = [];
            map.set(mode, bucket);
        }
        bucket.push(createItem(choice, group, sortIndex++));
    }

    for (const group of groups) {
        const sorted = group.sorted
            ? group.completions
            : [...group.completions].sort();
        if (group.separatorMode === "autoSpacePunctuation") {
            // Resolve per-item: inspect character pair to determine
            // whether a separator is needed.
            for (const choice of sorted) {
                const needsSep =
                    startIndex > 0 &&
                    choice.length > 0 &&
                    needsSeparatorInAutoMode(input[startIndex - 1], choice[0]);
                addItem(
                    needsSep
                        ? "spacePunctuation"
                        : "optionalSpacePunctuation",
                    choice,
                    group,
                );
            }
        } else {
            // Resolve undefined → "space" (the default separatorMode).
            const mode: ResolvedSeparatorMode = group.separatorMode ?? "space";
            for (const choice of sorted) {
                addItem(mode, choice, group);
            }
        }
    }
    return Array.from(map, ([mode, items]) => ({ mode, items }));
}
