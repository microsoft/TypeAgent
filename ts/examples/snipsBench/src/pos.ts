// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Coarse, cheap POS layer.
 *
 * The whole point of this module is the *free* signal: English closed-class
 * (function) words are a fixed, finite list — no training, no labeled data.
 * Knowing which tokens are function words (glue / boundaries) vs. content words
 * (slot-filler material) is most of what flat slot filling needs from "parsing".
 *
 * Open-class tokens get a coarse tag from suffix heuristics (Brill-style),
 * which is enough to distinguish noun-ish slot material from lead verbs.
 */

export type CoarseTag =
    | "DET" // determiners, demonstratives, possessive determiners
    | "ADP" // prepositions
    | "CONJ" // coordinating/subordinating conjunctions
    | "PRON" // pronouns
    | "AUX" // auxiliaries / copula / modals
    | "PART" // particles (to, 's, not)
    | "WH" // wh-words
    | "ADV" // closed-class adverbs (degree/negation)
    | "NUM" // numerals (word or digit)
    | "VERB" // open-class verb (suffix-inferred)
    | "ADJ" // open-class adjective (suffix-inferred)
    | "NOUN"; // open-class default

/** Function (closed-class) tags — these delimit slots. */
const FUNCTION_TAGS: ReadonlySet<CoarseTag> = new Set<CoarseTag>([
    "DET",
    "ADP",
    "CONJ",
    "PRON",
    "AUX",
    "PART",
    "WH",
    "ADV",
]);

/**
 * The closed-class lexicon. Hand-listed, finite, zero-training. This is the
 * "free" signal. Tags are the most-frequent reading; English function words are
 * overwhelmingly unambiguous in this coarse scheme.
 */
const LEXICON: ReadonlyMap<string, CoarseTag> = new Map<string, CoarseTag>(
    Object.entries({
        // determiners / demonstratives / possessive determiners / quantifiers
        a: "DET",
        an: "DET",
        the: "DET",
        this: "DET",
        that: "DET",
        these: "DET",
        those: "DET",
        my: "DET",
        your: "DET",
        his: "DET",
        her: "DET",
        its: "DET",
        our: "DET",
        their: "DET",
        some: "DET",
        any: "DET",
        no: "DET",
        every: "DET",
        each: "DET",
        all: "DET",
        both: "DET",
        either: "DET",
        neither: "DET",
        another: "DET",
        // prepositions
        in: "ADP",
        on: "ADP",
        at: "ADP",
        by: "ADP",
        for: "ADP",
        from: "ADP",
        to: "ADP",
        of: "ADP",
        with: "ADP",
        about: "ADP",
        into: "ADP",
        over: "ADP",
        under: "ADP",
        near: "ADP",
        around: "ADP",
        between: "ADP",
        through: "ADP",
        during: "ADP",
        before: "ADP",
        after: "ADP",
        within: "ADP",
        without: "ADP",
        against: "ADP",
        toward: "ADP",
        towards: "ADP",
        upon: "ADP",
        across: "ADP",
        behind: "ADP",
        beside: "ADP",
        besides: "ADP",
        per: "ADP",
        via: "ADP",
        // conjunctions
        and: "CONJ",
        or: "CONJ",
        but: "CONJ",
        nor: "CONJ",
        so: "CONJ",
        because: "CONJ",
        although: "CONJ",
        though: "CONJ",
        while: "CONJ",
        if: "CONJ",
        unless: "CONJ",
        whereas: "CONJ",
        than: "CONJ",
        // pronouns
        i: "PRON",
        you: "PRON",
        he: "PRON",
        she: "PRON",
        it: "PRON",
        we: "PRON",
        they: "PRON",
        me: "PRON",
        him: "PRON",
        us: "PRON",
        them: "PRON",
        mine: "PRON",
        yours: "PRON",
        hers: "PRON",
        ours: "PRON",
        theirs: "PRON",
        myself: "PRON",
        yourself: "PRON",
        itself: "PRON",
        something: "PRON",
        anything: "PRON",
        everything: "PRON",
        nothing: "PRON",
        someone: "PRON",
        anyone: "PRON",
        everyone: "PRON",
        // auxiliaries / copula / modals
        am: "AUX",
        is: "AUX",
        are: "AUX",
        was: "AUX",
        were: "AUX",
        be: "AUX",
        been: "AUX",
        being: "AUX",
        do: "AUX",
        does: "AUX",
        did: "AUX",
        have: "AUX",
        has: "AUX",
        had: "AUX",
        will: "AUX",
        would: "AUX",
        shall: "AUX",
        should: "AUX",
        can: "AUX",
        could: "AUX",
        may: "AUX",
        might: "AUX",
        must: "AUX",
        // particles / negation
        not: "ADV",
        "n't": "ADV",
        "'s": "PART",
        // wh-words
        what: "WH",
        which: "WH",
        who: "WH",
        whom: "WH",
        whose: "WH",
        where: "WH",
        when: "WH",
        why: "WH",
        how: "WH",
        // closed-class adverbs (degree / focus) that act as glue
        very: "ADV",
        really: "ADV",
        quite: "ADV",
        just: "ADV",
        also: "ADV",
        too: "ADV",
        only: "ADV",
        even: "ADV",
        please: "ADV",
        now: "ADV",
        then: "ADV",
        here: "ADV",
        there: "ADV",
    }) as [string, CoarseTag][],
);

const DIGITS = /^[+-]?\d+([.,]\d+)?$/;

/**
 * Tag a single token in isolation. Lexicon first (closed class), then numeric,
 * then open-class suffix heuristics defaulting to NOUN. Case-insensitive.
 */
export function tagToken(token: string): CoarseTag {
    const t = token.toLowerCase();
    const lex = LEXICON.get(t);
    if (lex) return lex;
    if (DIGITS.test(t)) return "NUM";

    // Open-class suffix heuristics (Brill-style).
    if (/(ing|ed)$/.test(t) && t.length > 4) return "VERB";
    if (/ly$/.test(t) && t.length > 3) return "ADV";
    if (/(ous|ful|ive|able|ible|al|ic|ish|less|est)$/.test(t) && t.length > 4)
        return "ADJ";
    return "NOUN";
}

/** A function (closed-class) word — these delimit slots. */
export function isFunctionWord(token: string): boolean {
    return FUNCTION_TAGS.has(tagToken(token));
}

/** A content (open-class) word — candidate slot-filler material. */
export function isContentWord(token: string): boolean {
    return !isFunctionWord(token);
}

/** Tag a whole token sequence (currently context-free; per-token). */
export function tagSequence(tokens: string[]): CoarseTag[] {
    return tokens.map(tagToken);
}
