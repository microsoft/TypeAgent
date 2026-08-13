// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Deterministic utterance ↔ action disambiguation for translation-bench.
 *
 * Goal: reject "double meaning" positives where a natural reading of the
 * utterance could equally select a sibling TypeAgent tool (e.g.
 * followLinkByText vs openWebPage for "Open the Apple stock quote in a new tab").
 *
 * Used by:
 *   - synthesizer prompt context (list confusable siblings)
 *   - format_checker (hard reject before semantic LLM)
 *   - semantic_checker payload (judge sees the same sibling list)
 */

import type {
    TranslationBenchBenchmarkSchema,
    TranslationBenchTargetAction,
} from "./benchmark.js";
import type {
    TranslationBenchGeneratedCandidate,
    TranslationBenchReviewIssue,
} from "./generationCandidate.js";

export interface TranslationBenchActionRef {
    schemaName: string;
    actionName: string;
    description?: string;
}

export interface TranslationBenchConfusableSibling
    extends TranslationBenchActionRef {
    reason: string;
}

/** Hand-curated pairs seen to collide in 1k eval (bidirectional). */
const KNOWN_CONFUSABLE_PAIRS: ReadonlyArray<
    readonly [TranslationBenchActionRef, TranslationBenchActionRef, string]
> = [
    [
        { schemaName: "browser", actionName: "followLinkByText" },
        { schemaName: "browser", actionName: "openWebPage" },
        "open X vs click link whose text is X",
    ],
    [
        { schemaName: "browser", actionName: "followLinkByPosition" },
        { schemaName: "browser", actionName: "openSearchResult" },
        "nth result / position open collisions",
    ],
    [
        { schemaName: "browser", actionName: "followLinkByText" },
        { schemaName: "browser", actionName: "openSearchResult" },
        "result/link open collisions",
    ],
    [
        { schemaName: "browser.external", actionName: "closeTab" },
        { schemaName: "browser", actionName: "closeWebPage" },
        "close tab vs close page",
    ],
    [
        { schemaName: "browser.actionDiscovery", actionName: "getAllWebFlows" },
        {
            schemaName: "browser.actionDiscovery",
            actionName: "detectPageActions",
        },
        "page capabilities / flows discovery",
    ],
    [
        { schemaName: "browser.actionDiscovery", actionName: "inferActions" },
        {
            schemaName: "browser.actionDiscovery",
            actionName: "detectPageActions",
        },
        "infer vs detect page actions",
    ],
    [
        { schemaName: "browser.actionDiscovery", actionName: "getAllWebFlows" },
        { schemaName: "browser.actionDiscovery", actionName: "inferActions" },
        "flows vs inferred actions",
    ],
    [
        {
            schemaName: "browser.actionDiscovery",
            actionName: "registerPageDynamicAgent",
        },
        {
            schemaName: "browser.actionDiscovery",
            actionName: "detectPageActions",
        },
        "register page agent vs detect page actions (registerAgent:true)",
    ],
    [
        {
            schemaName: "browser.actionDiscovery",
            actionName: "getWebFlowsForDomain",
        },
        {
            schemaName: "browser.actionDiscovery",
            actionName: "detectPageActions",
        },
        "domain web-flows lookup vs inspect/detect page actions",
    ],
    [
        {
            schemaName: "browser.actionDiscovery",
            actionName: "getWebFlowsForDomain",
        },
        { schemaName: "browser", actionName: "openWebPage" },
        "list flows for domain hostname vs navigate to that hostname",
    ],
    [
        { schemaName: "github-cli", actionName: "browseIssue" },
        { schemaName: "browser", actionName: "openWebPage" },
        "GitHub issue via gh/browseIssue vs generic browser open of a URL/page; prefer 'GitHub issue #N', 'gh browse issue', 'in this repo' — avoid bare 'open in the browser' / 'web page'",
    ],
    [
        { schemaName: "github-cli", actionName: "browsePr" },
        { schemaName: "browser", actionName: "openWebPage" },
        "GitHub PR via gh/browsePr vs generic browser open; prefer 'pull request #N', 'gh browse pr', 'in this repo'",
    ],
    [
        { schemaName: "github-cli", actionName: "browseRepo" },
        { schemaName: "browser", actionName: "openWebPage" },
        "GitHub repo via gh/browseRepo vs generic browser open; prefer 'this GitHub repo', 'gh browse', owner/name",
    ],
    [
        { schemaName: "browser.external", actionName: "openTab" },
        { schemaName: "browser", actionName: "openWebPage" },
        "external/system browser tab vs in-app openWebPage; prefer 'external browser', 'system browser', 'outside the app', 'default browser app' — avoid bare 'new tab' / 'in my browser'",
    ],
];

/**
 * Lexical cues that uniquely favor a target action family.
 * Matched case-insensitively as substrings of the utterance.
 */
const ACTION_DISAMBIGUATION_CUES: Readonly<Record<string, readonly string[]>> =
    {
        "browser.followLinkByText": [
            "link that",
            "link titled",
            "link named",
            "link labeled",
            "link saying",
            "link which says",
            "hyperlink",
            "click the link",
            "click link",
            "anchor text",
            "the link",
            "link titled",
            "link named",
            "link labeled",
            "link in a",
            "link in the",
            "link that says",
            "link which",
        ],
        "browser.followLinkByPosition": [
            "link number",
            "nth link",
            "link at position",
            "link in position",
            "the first link",
            "the second link",
            "the third link",
            "follow the",
            "first link",
            "second link",
            "third link",
            "link #",
        ],
        "browser.openSearchResult": [
            "search result",
            "from the results",
            "from search results",
            "result number",
            "results list",
            "hit number",
            "first result",
            "second result",
            "the result",
            "open the result",
        ],
        "browser.openWebPage": [
            "go to",
            "navigate to",
            "visit",
            "open the website",
            "open website",
            "open the site",
            "open url",
            "open the url",
            "browse to",
            "open http",
            "open www",
            "take me to",
        ],
        "browser.closeWebPage": [
            "this page",
            "current page",
            "close the page",
            "close page",
            "close this webpage",
        ],
        "browser.external.closeTab": [
            "tab titled",
            "tab named",
            "tab called",
            "browser tab",
            "close the tab",
            "close tab",
        ],
        "browser.actionDiscovery.getAllWebFlows": [
            // Avoid bare "web flow(s)" — those also fit getWebFlowsForDomain.
            "all web flows",
            "every web flow",
            "flows on this page",
            "available flows across",
            "list all flows",
            "every saved flow",
            "all saved web flows",
        ],
        "browser.actionDiscovery.getWebFlowsForDomain": [
            "web flows for",
            "web flow for",
            "flows for the domain",
            "flows for domain",
            "flows for this domain",
            "list web flows for",
            "get web flows for",
            "web flows on the domain",
            "domain web flows",
            "web flows registered for",
            "saved web flows for",
        ],
        "browser.actionDiscovery.detectPageActions": [
            "detect",
            "discover actions",
            "scan the page for actions",
            "what actions can i take",
            "what can i do on this page",
            "available actions",
            "show me the actions",
            "page actions",
            "inspect",
            "lets me do",
            "what this page",
            "detect and register",
            "scan and register",
            "register agent and find",
        ],
        "browser.actionDiscovery.registerPageDynamicAgent": [
            "register page dynamic agent",
            "register site schema only",
            "dynamic agent without scanning",
            "just register the page agent",
        ],
        "browser.actionDiscovery.inferActions": [
            "infer actions",
            "infer what i can do",
            "guess the actions",
            "unfamiliar",
        ],
    };

function keyOf(ref: TranslationBenchActionRef): string {
    return `${ref.schemaName}.${ref.actionName}`;
}

function sameAction(
    a: TranslationBenchActionRef,
    b: TranslationBenchActionRef,
): boolean {
    return a.schemaName === b.schemaName && a.actionName === b.actionName;
}

function splitCamel(name: string): string[] {
    return name
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/[_\-.]+/g, " ")
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean);
}

const STOP_TOKENS = new Set([
    "a",
    "an",
    "the",
    "by",
    "to",
    "of",
    "for",
    "and",
    "or",
    "with",
    "from",
    "in",
    "on",
    "at",
    "action",
    "actions",
]);

function significantTokens(name: string): Set<string> {
    const out = new Set<string>();
    for (const token of splitCamel(name)) {
        if (token.length < 3 || STOP_TOKENS.has(token)) continue;
        out.add(token);
    }
    return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 || b.size === 0) return 0;
    let inter = 0;
    for (const t of a) if (b.has(t)) inter += 1;
    return inter / (a.size + b.size - inter);
}

function listCatalogActions(
    catalog: readonly TranslationBenchBenchmarkSchema[],
): TranslationBenchActionRef[] {
    const out: TranslationBenchActionRef[] = [];
    for (const schema of catalog) {
        for (const tool of schema.tools) {
            if (tool.type !== "function") continue;
            out.push({
                schemaName: schema.schemaName,
                actionName: tool.function.name,
                ...(tool.function.description !== undefined
                    ? { description: tool.function.description }
                    : {}),
            });
        }
    }
    return out;
}

/**
 * Confusable siblings for a target action given the live catalog.
 * Combines curated pairs with same-schema name-similarity.
 */
export function findTranslationBenchConfusableSiblings(
    target: TranslationBenchTargetAction,
    catalog: readonly TranslationBenchBenchmarkSchema[],
): TranslationBenchConfusableSibling[] {
    const all = listCatalogActions(catalog);
    const byKey = new Map(all.map((a) => [keyOf(a), a]));
    const found = new Map<string, TranslationBenchConfusableSibling>();

    const add = (sibling: TranslationBenchActionRef, reason: string) => {
        if (sameAction(sibling, target)) return;
        if (!byKey.has(keyOf(sibling))) return;
        const existing = found.get(keyOf(sibling));
        if (existing !== undefined) return;
        const live = byKey.get(keyOf(sibling))!;
        found.set(keyOf(sibling), {
            schemaName: live.schemaName,
            actionName: live.actionName,
            ...(live.description !== undefined
                ? { description: live.description }
                : {}),
            reason,
        });
    };

    for (const [left, right, reason] of KNOWN_CONFUSABLE_PAIRS) {
        if (sameAction(left, target)) add(right, reason);
        if (sameAction(right, target)) add(left, reason);
    }

    // Same-schema near-duplicates by action-name token overlap.
    const targetTokens = significantTokens(target.actionName);
    for (const action of all) {
        if (action.schemaName !== target.schemaName) continue;
        if (sameAction(action, target)) continue;
        const overlap = jaccard(
            targetTokens,
            significantTokens(action.actionName),
        );
        if (overlap >= 0.34) {
            add(
                action,
                `same-schema action-name overlap (${overlap.toFixed(2)})`,
            );
        }
    }

    return [...found.values()].sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
}

function normalizeUtterance(text: string): string {
    return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function cuesFor(ref: TranslationBenchActionRef): readonly string[] {
    return ACTION_DISAMBIGUATION_CUES[keyOf(ref)] ?? [];
}

function matchedCues(utterance: string, cues: readonly string[]): string[] {
    const norm = normalizeUtterance(utterance);
    return cues.filter((cue) => norm.includes(cue.toLowerCase()));
}

export interface TranslationBenchUtteranceDisambiguationResult {
    ok: boolean;
    path: string;
    utterance: string;
    targetCuesMatched: string[];
    siblingHits: Array<{
        sibling: string;
        cuesMatched: string[];
    }>;
    message?: string;
    suggestedFix?: string;
}

/**
 * Deterministic check: when confusable siblings exist, a positive utterance
 * must carry at least one target-specific cue and must not only match sibling cues.
 */
export function checkTranslationBenchUtteranceDisambiguation(
    utterance: string,
    target: TranslationBenchTargetAction,
    siblings: readonly TranslationBenchConfusableSibling[],
    path: string,
): TranslationBenchUtteranceDisambiguationResult {
    if (siblings.length === 0) {
        return {
            ok: true,
            path,
            utterance,
            targetCuesMatched: [],
            siblingHits: [],
        };
    }

    const targetCues = cuesFor(target);
    const targetCuesMatched = matchedCues(utterance, targetCues);
    const siblingHits = siblings
        .map((sibling) => ({
            sibling: keyOf(sibling),
            cuesMatched: matchedCues(utterance, cuesFor(sibling)),
        }))
        .filter((hit) => hit.cuesMatched.length > 0);

    // No curated cues for this target family: only fail when a sibling's
    // distinctive cue fires and the target has none of its own.
    if (targetCues.length === 0) {
        if (siblingHits.length === 0) {
            return {
                ok: true,
                path,
                utterance,
                targetCuesMatched,
                siblingHits,
            };
        }
        return {
            ok: false,
            path,
            utterance,
            targetCuesMatched,
            siblingHits,
            message:
                `Utterance is confusable with sibling action(s) ` +
                `${siblingHits.map((h) => h.sibling).join(", ")} ` +
                `(matched sibling cues) and has no target-specific disambiguator for ` +
                `${keyOf(target)}.`,
            suggestedFix:
                `Rewrite the utterance so it can only mean ${keyOf(target)}, ` +
                `not ${siblingHits.map((h) => h.sibling).join(" or ")}. ` +
                `Add explicit target cues and remove sibling-only phrasing.`,
        };
    }

    if (targetCuesMatched.length === 0) {
        const siblingNames = siblings.map((s) => keyOf(s)).join(", ");
        return {
            ok: false,
            path,
            utterance,
            targetCuesMatched,
            siblingHits,
            message:
                `Positive utterance for ${keyOf(target)} lacks disambiguating cues ` +
                `required when confusable siblings exist (${siblingNames}). ` +
                `Expected at least one of: ${targetCues.slice(0, 6).join(" | ")}.`,
            suggestedFix:
                `Rewrite so a careful reader would only pick ${keyOf(target)}. ` +
                `Example cues: ${targetCues.slice(0, 4).join("; ")}.`,
        };
    }

    // Target cue present but a sibling has strictly more distinctive hits and
    // shares no overlap with target matches → still ambiguous leaning sibling.
    for (const hit of siblingHits) {
        const exclusiveSibling = hit.cuesMatched.filter(
            (c) => !targetCuesMatched.includes(c),
        );
        if (
            exclusiveSibling.length > 0 &&
            exclusiveSibling.length >= targetCuesMatched.length
        ) {
            return {
                ok: false,
                path,
                utterance,
                targetCuesMatched,
                siblingHits,
                message:
                    `Utterance for ${keyOf(target)} also strongly matches sibling ` +
                    `${hit.sibling} (cues: ${exclusiveSibling.join(", ")}).`,
                suggestedFix:
                    `Remove phrasing that fits ${hit.sibling} and strengthen ` +
                    `${keyOf(target)}-only cues (${targetCues.slice(0, 4).join("; ")}).`,
            };
        }
    }

    return {
        ok: true,
        path,
        utterance,
        targetCuesMatched,
        siblingHits,
    };
}

/**
 * Run disambiguation over seed + every positive genCase.
 * Negatives are skipped (they intentionally explore adjacent intents).
 */
export function checkTranslationBenchCandidateDisambiguation(
    candidate: TranslationBenchGeneratedCandidate,
    target: TranslationBenchTargetAction,
    catalog: readonly TranslationBenchBenchmarkSchema[],
): TranslationBenchReviewIssue[] {
    const siblings = findTranslationBenchConfusableSiblings(target, catalog);
    if (siblings.length === 0) return [];

    const issues: TranslationBenchReviewIssue[] = [];
    const seedCheck = checkTranslationBenchUtteranceDisambiguation(
        candidate.seed.utterance,
        target,
        siblings,
        "$.seed.utterance",
    );
    if (!seedCheck.ok) {
        issues.push({
            code: "AMBIGUOUS_INTENT",
            path: seedCheck.path,
            message: seedCheck.message!,
            suggestedFix: seedCheck.suggestedFix!,
        });
    }

    for (const [index, genCase] of candidate.genCases.entries()) {
        if (genCase.role !== "positive") continue;
        const check = checkTranslationBenchUtteranceDisambiguation(
            genCase.utterance,
            target,
            siblings,
            `$.genCases[${index}].utterance`,
        );
        if (!check.ok) {
            issues.push({
                code: "AMBIGUOUS_INTENT",
                path: check.path,
                message: check.message!,
                suggestedFix: check.suggestedFix!,
            });
        }
    }
    return issues;
}

/** Compact sibling list for prompt injection. */
export function summarizeTranslationBenchConfusableSiblings(
    target: TranslationBenchTargetAction,
    siblings: readonly TranslationBenchConfusableSibling[],
): Array<{
    action: string;
    reason: string;
    avoidCuesThatMeanSibling?: string[];
    preferTargetCues?: string[];
}> {
    const targetCues = cuesFor(target);
    return siblings.map((sibling) => {
        const cues = cuesFor(sibling);
        return {
            action: keyOf(sibling),
            reason: sibling.reason,
            ...(cues.length > 0
                ? { avoidCuesThatMeanSibling: [...cues].slice(0, 6) }
                : {}),
            ...(targetCues.length > 0
                ? { preferTargetCues: [...targetCues].slice(0, 6) }
                : {}),
        };
    });
}
