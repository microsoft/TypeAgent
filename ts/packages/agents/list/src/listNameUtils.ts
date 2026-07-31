// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Determiners / bare "list" / anaphora captured as listName by listSchema.agr
 * ("add ham to the list" → listName="the", "put cheese on the list" → "list",
 *  "add milk to a grocery list" → listName="a grocery",
 *  "add milk to it" → listName="it",
 *  "create a new list" → listName="new",
 *  "add eggs to grocery list" → listName="grocery list",
 *  "add milk to this one" → listName="this one" / "one",
 *  "clear the other list" → listName="other",
 *  "add milk to the first one" → listName="first one",
 *  "clear both lists" → listName="both",
 *  "add milk to mine" → listName="mine").
 *
 * Prefer normalize-then-validate:
 *  1. strip token-edge punctuation (LLM/STT artifacts: "list.", "the,")
 *     and English possessives ("list's") while preserving Unicode letters
 *  2. strip leading determiners/quantifiers only (NOT anaphoric pronouns
 *     me/us/it/you — those can be real multi-word names like "me time")
 *  3. strip all trailing generic "list"/"lists" tokens when a real name remains
 *  4. casefold so grammar/LLM casing does not split store keys
 *  5. map the salvage identity "recovered" → RECOVERED_LIST_NAME
 *  6. reject empty / bare-det / bare-"list(s)" / bare-"new" / bare pronoun /
 *     bare deictic (one/ones/other/same/another/current/…) / quantifiers /
 *     possessives / ordinal+one leftovers / all-closed-class leftovers /
 *     partial anaphora ("lots of them", "which of those")
 * so real names like "grocery" keep working while "the list" falls through.
 */

/** Closed-class determiners the grammar may glue onto a real list name. */
const DETERMINERS = new Set([
    "the",
    "a",
    "an",
    "this",
    "that",
    "these",
    "those",
    "my",
    "your",
    "our",
    "his",
    "her",
    "its",
    "their",
    // anaphoric / deictic determiners ("another list", "the other list", "the same list")
    "another",
    "other",
    "same",
    // interrogative determiner ("which list", "which one")
    "which",
]);

/**
 * Quantifiers that never name a list ("both lists", "every list", "any list",
 * "all lists", "some list", "each list", "either list", "none of them").
 * Stripped when leading a multi-word capture; rejected when bare.
 */
const QUANTIFIERS = new Set([
    "any",
    "all",
    "both",
    "every",
    "each",
    "some",
    "either",
    "neither",
    "none",
    // underspecified quantity words ("more lists", "many lists", …)
    "more",
    "many",
    "several",
    "few",
    "most",
]);

/**
 * Light closed-class glue that appears in anaphora leftovers after quantifier
 * strip ("all of them" → "of them"). Never a list identity alone or in an
 * all-closed-class phrase.
 */
const CLOSED_GLUE = new Set([
    "of",
    "for",
    "to",
    "with",
    "from",
    "on",
    "in",
    "at",
]);

/**
 * Anaphoric pronouns the grammar/LLM may bind as listName
 * ("add milk to it", "put cheese on them", "make me a list" → "me"/"me a",
 *  subject forms "they"/"we"/"she" from STT/LLM slips).
 * Rejected when bare (or all-closed-class), but NOT stripped from multi-word
 * names so real lists like "me time" / "us travel" / "it projects" stay intact.
 */
const ANAPHORIC_PRONOUNS = new Set([
    "it",
    "them",
    "me",
    "him",
    "us",
    "you",
    "they",
    "we",
    "she",
    "he",
]);

/**
 * Independent possessives ("add milk to mine", "what's on yours", "clear ours").
 * Never a list identity when bare.
 */
const INDEPENDENT_POSSESSIVES = new Set([
    "mine",
    "yours",
    "ours",
    "theirs",
    "hers",
    "his", // already a determiner; listed for clarity when bare
]);

/**
 * Ordinal / sequential words used in deictic phrases
 * ("first one", "last one", "next one", "the previous one").
 * Rejected when the whole name is closed-class; kept when paired with a real
 * noun ("first aid", "next week").
 */
const ORDINALS = new Set([
    "first",
    "second",
    "third",
    "fourth",
    "fifth",
    "last",
    "next",
    "previous",
    "former",
    "latter",
]);

/**
 * Small cardinals used deictically ("the two", "those three lists").
 * Rejected when bare / all-closed-class; kept inside real names ("two trees").
 */
const CARDINALS = new Set([
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
]);

/**
 * Deictic leftovers after det strip ("this one", "that one", "those ones",
 * "my own") — never a list id.
 */
const DEICTIC_PLACEHOLDERS = new Set(["one", "ones", "own"]);

/**
 * Session/selection deictics ("the current list", "my active list") — never a
 * list id when bare / all-closed-class. NOT leading-stripped: real names like
 * "whole foods", "active tasks", "current events" must stay intact.
 */
const SELECTION_DEICTICS = new Set([
    "current",
    "active",
    "default",
    "whole",
    "entire",
]);

/**
 * Underspecified content heads that only appear in partial anaphora
 * ("lots of them", "the rest of those") — never a list identity alone.
 */
const PARTIAL_ANAPHORA_HEADS = new Set(["lots", "rest"]);

/**
 * Tokens stripped from the front of multi-word names when a real name remains.
 * TRUE DETERMINERS ONLY. Quantifiers / selection deictics are rejected when
 * bare but never peeled off open-class compounds ("most wanted", "whole foods",
 * "active tasks", "many thanks").
 */
const LEADING_STRIP = new Set([...DETERMINERS]);

/**
 * Single-token values that are never a real list identity after normalize.
 * Includes bare "new" from CreateList's optional (new)? before the wildcard,
 * and bare "list"/"lists" from underspecified "show the lists" paths.
 * NOTE: "recovered" is intentionally NOT here — it is the user-facing alias
 * of the salvage store key (see normalizeListName).
 */
const PLACEHOLDER_TOKENS = new Set([
    ...DETERMINERS,
    ...QUANTIFIERS,
    ...ANAPHORIC_PRONOUNS,
    ...INDEPENDENT_POSSESSIVES,
    ...ORDINALS,
    ...CARDINALS,
    ...DEICTIC_PLACEHOLDERS,
    ...SELECTION_DEICTICS,
    ...PARTIAL_ANAPHORA_HEADS,
    ...CLOSED_GLUE,
    "list",
    "lists",
    "new",
]);

/**
 * Strip leading/trailing non-letter/non-number junk from a token (keep internal),
 * then an English possessive suffix. Unicode-aware so accented / non-Latin names
 * (café, résumé, 買い物) survive.
 */
function cleanToken(token: string): string {
    return (
        token
            .toLowerCase()
            .replace(/^[^\p{L}\p{N}]+/gu, "")
            .replace(/[^\p{L}\p{N}]+$/gu, "")
            // STT/LLM possessives: "list's", "grocery's", curly apostrophe
            .replace(/['\u2019]s$/u, "")
    );
}

function splitWords(listName: string): string[] {
    return listName
        .trim()
        .split(/\s+/)
        .map(cleanToken)
        .filter((w) => w.length > 0);
}

/**
 * Internal fallback store key when legacy lists.json only has placeholder keys
 * ("the", "list", "my", …) that still hold real items. Double-underscore form
 * so it cannot collide with a normal user-typed list name. Addressable via
 * normalize aliases "recovered" / "the recovered list" / "__recovered__".
 */
export const RECOVERED_LIST_NAME = "__recovered__";

/** User-facing / underscore-stripped form of the salvage key. */
const RECOVERED_ALIAS = "recovered";

/**
 * Normalize a captured/emitted listName into a stable store key:
 * strip edge punctuation + possessives, strip leading true determiners only,
 * strip all trailing generic "list"/"lists", casefold,
 * map salvage alias → RECOVERED_LIST_NAME.
 * Single-token input is not leading-stripped (placeholder check handles bare dets).
 * Quantifiers / selection deictics / anaphora are not leading-stripped
 * (preserve "whole foods", "active tasks", "most wanted", "me time").
 * Examples: "a grocery" → "grocery", "the grocery list" → "grocery",
 * "Grocery Lists" → "grocery", "the." → "the", "grocery list!" → "grocery",
 * "grocery list list" → "grocery", "both lists" → "both", "café list" → "café",
 * "Contoso grocery" → "contoso grocery", "me time" → "me time",
 * "whole foods list" → "whole foods",
 * "recovered" / "the recovered list" / "__recovered__" → "__recovered__".
 */
export function normalizeListName(listName: string): string {
    const words = splitWords(listName);
    let start = 0;
    // Only strip true determiners while a real name token would remain.
    while (start < words.length - 1 && LEADING_STRIP.has(words[start]!)) {
        start++;
    }
    let end = words.length;
    // Trailing generic "list"/"lists" from optional (list)? / LLM phrasing —
    // strip ALL of them so normalize is idempotent ("grocery list list").
    // Keep bare "list"/"lists" for the placeholder check.
    while (end - start > 1) {
        const last = words[end - 1]!;
        if (last === "list" || last === "lists") {
            end--;
        } else {
            break;
        }
    }
    const normalized = words.slice(start, end).join(" ");
    // Canonical salvage key (cleanToken strips underscores from "__recovered__").
    if (normalized === RECOVERED_ALIAS || normalized === RECOVERED_LIST_NAME) {
        return RECOVERED_LIST_NAME;
    }
    return normalized;
}

/**
 * True when the last two tokens are "of" + anaphora/demonstrative
 * ("of them", "of those", "of it").
 */
function endsWithOfAnaphora(words: string[]): boolean {
    if (words.length < 2) {
        return false;
    }
    const last = words[words.length - 1]!;
    const prev = words[words.length - 2]!;
    if (prev !== "of") {
        return false;
    }
    return (
        ANAPHORIC_PRONOUNS.has(last) ||
        last === "those" ||
        last === "these" ||
        last === "this" ||
        last === "that"
    );
}

/**
 * Partial anaphora like "all of them" / "lots of those" / "rest of it".
 * Rejects only when every token before "of + anaphor" is closed-class, so
 * real names like "photos of them" stay valid.
 */
function isClosedClassOfAnaphora(words: string[]): boolean {
    if (!endsWithOfAnaphora(words)) {
        return false;
    }
    const head = words.slice(0, -2);
    return head.every((w) => PLACEHOLDER_TOKENS.has(w));
}

/**
 * True when listName is not a usable list identity after normalization
 * (empty, bare determiner/pronoun/deictic/quantifier/possessive/ordinal,
 * bare "list(s)"/"new", all-closed-class phrases, glue-led leftovers like
 * "of grocery", or closed-class "… of them/those").
 * The salvage key RECOVERED_LIST_NAME is a real store identity (addressable).
 */
export function isPlaceholderListName(listName: string): boolean {
    const normalized = normalizeListName(listName);
    if (normalized.length === 0) {
        return true;
    }

    // Salvage key is a real, addressable store identity — not a placeholder.
    if (normalized === RECOVERED_LIST_NAME) {
        return false;
    }

    if (PLACEHOLDER_TOKENS.has(normalized)) {
        return true;
    }

    const words = normalized.split(/\s+/).filter((w) => w.length > 0);

    // "me a", "first one", "the other", "those ones", "of them" (all closed-class)
    if (words.length > 0 && words.every((w) => PLACEHOLDER_TOKENS.has(w))) {
        return true;
    }

    // Grammar/LLM junk that starts with "of" ("of grocery", "of them") after a
    // quantifier peel. Only "of" — not other prepositions ("to do", "on call").
    if (words.length > 0 && words[0] === "of") {
        return true;
    }

    // "lots of …" / "rest of …" are partial anaphora heads, not list titles
    // ("lots of groceries", "rest of the grocery").
    if (words.length > 0 && PARTIAL_ANAPHORA_HEADS.has(words[0]!)) {
        return true;
    }

    // "all of them", "none of it" — but NOT "photos of them"
    if (isClosedClassOfAnaphora(words)) {
        return true;
    }

    // Defense in depth: "X list(s)" where X is still a closed-class token
    // (should already have been reduced by normalize, but keep the check cheap).
    if (
        words.length === 2 &&
        (words[1] === "list" || words[1] === "lists") &&
        PLACEHOLDER_TOKENS.has(words[0]!)
    ) {
        return true;
    }

    return false;
}
