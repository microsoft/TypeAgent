// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Built-in Phrase Set Matchers
 *
 * Named phrase sets for common linguistic patterns (polite openers, greetings, etc.).
 * These replace the old built-in grammar category rules (Polite, Greeting, etc.).
 *
 * At match time, a phraseSet transition tries all phrases in the set at the current
 * token position, generating multiple NFA threads — one per matching phrase length.
 * This avoids exploding the NFA state count from repeated inlining of category rules.
 *
 * Grammar rules reference these as <Polite>, <Greeting>, etc. The grammar compiler
 * intercepts these names and creates PhraseSetPart nodes instead of RulesPart nodes.
 *
 * New phrases are added idempotently via addPhrase(). The LLM grammar generator can
 * request additions via the phrasesToAdd field in its output.
 */

/** Inline normalization — avoids circular import through nfaMatcher → nfaInterpreter */
function normalizePhrase(token: string): string {
    return token.toLowerCase().replace(/['".,!?;:]+$/g, "");
}

export interface PhraseSetMatcher {
    name: string;
    description: string;
    examples: string[];
    /** Tokenized phrases as arrays of lowercase normalized tokens */
    phrases: string[][];
    /** Quick-lookup set of phrase keys (space-joined) for deduplication */
    phraseKeys: Set<string>;
}

class PhraseSetRegistry {
    private readonly _matchers = new Map<string, PhraseSetMatcher>();

    register(
        name: string,
        description: string,
        examples: string[],
        initialPhrases: string[],
    ): void {
        const matcher: PhraseSetMatcher = {
            name,
            description,
            examples,
            phrases: [],
            phraseKeys: new Set(),
        };
        this._matchers.set(name, matcher);
        for (const phrase of initialPhrases) {
            this._addPhrase(matcher, phrase);
        }
    }

    private _addPhrase(matcher: PhraseSetMatcher, phrase: string): boolean {
        const tokens = phrase
            .split(/\s+/)
            .filter((t) => t.length > 0)
            .map(normalizePhrase)
            .filter((t) => t.length > 0);
        if (tokens.length === 0) return false;
        const key = tokens.join(" ");
        if (matcher.phraseKeys.has(key)) return false;
        matcher.phraseKeys.add(key);
        matcher.phrases.push(tokens);
        return true;
    }

    /** Add a phrase to a named matcher. Returns true if newly added, false if already present. */
    addPhrase(name: string, phrase: string): boolean {
        const matcher = this._matchers.get(name);
        if (!matcher) {
            // Unknown matcher — silently ignore (LLM might hallucinate a name)
            return false;
        }
        return this._addPhrase(matcher, phrase);
    }

    getMatcher(name: string): PhraseSetMatcher | undefined {
        return this._matchers.get(name);
    }

    isPhraseSetName(name: string): boolean {
        return this._matchers.has(name);
    }

    getMatcherNames(): string[] {
        return Array.from(this._matchers.keys());
    }

    /** Get a prompt-ready description of all phrase-set matchers */
    getDescriptions(): string {
        return Array.from(this._matchers.values())
            .map(
                (m) =>
                    `  <${m.name}> — ${m.description}\n    Current phrases: ${m.phrases.map((p) => p.join(" ")).join(", ")}`,
            )
            .join("\n");
    }
}

export const globalPhraseSetRegistry = new PhraseSetRegistry();

// ── Built-in phrase sets ─────────────────────────────────────────────────────
// Mirror the old BUILT_IN_GRAMMAR_CATEGORIES with the same names so that
// existing stored grammar rules (which reference <Polite> etc.) continue to work.

globalPhraseSetRegistry.register(
    "Polite",
    "Optional polite opener — courtesy phrases at the start of a request",
    ["please", "could you", "would you", "would you please", "can you"],
    [
        "please",
        "could you",
        "would you",
        "would you please",
        "can you",
        "kindly",
    ],
);

globalPhraseSetRegistry.register(
    "Greeting",
    "Optional greeting at the start of a request before the main command",
    ["hey", "hi", "ok", "okay", "alright", "yo", "hello"],
    ["hey", "hi", "ok", "okay", "alright", "hello", "yo"],
);

globalPhraseSetRegistry.register(
    "Acknowledgement",
    "Optional acknowledgement at the start (e.g., after completing a prior task)",
    ["thanks", "thank you", "great", "perfect", "good", "nice", "cool"],
    ["thanks", "thank you", "great", "perfect", "good", "nice", "cool"],
);

globalPhraseSetRegistry.register(
    "FillerWord",
    "Optional hesitation or filler word that can appear inline in a request",
    ["um", "uh", "like", "well", "so", "just", "basically"],
    ["um", "uh", "like", "well", "so", "just", "basically", "actually"],
);
