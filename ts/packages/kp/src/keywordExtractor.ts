// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Extract significant keywords from text without LLM calls.
 * Uses heuristics: tokenization, stopword removal, proper noun detection.
 *
 * Proper noun extraction inspired by baseExtract.py:
 * - Skip sentence-initial capitalization (not a proper noun signal)
 * - Prefer 2-word proper nouns over 1-word
 * - Handle quoted dialogue (quote-initial words aren't sentence-initial)
 * - Exclude "I" and its contractions
 * - Extract proper nouns first, exclude their words from regular extraction
 */

// Common English stopwords
const STOPWORDS = new Set([
    "a",
    "an",
    "the",
    "and",
    "or",
    "but",
    "in",
    "on",
    "at",
    "to",
    "for",
    "of",
    "with",
    "by",
    "from",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "being",
    "have",
    "has",
    "had",
    "do",
    "does",
    "did",
    "will",
    "would",
    "could",
    "should",
    "may",
    "might",
    "shall",
    "can",
    "this",
    "that",
    "these",
    "those",
    "it",
    "its",
    "i",
    "me",
    "my",
    "we",
    "us",
    "our",
    "you",
    "your",
    "he",
    "him",
    "his",
    "she",
    "her",
    "they",
    "them",
    "their",
    "what",
    "which",
    "who",
    "whom",
    "when",
    "where",
    "how",
    "not",
    "no",
    "nor",
    "if",
    "then",
    "else",
    "so",
    "as",
    "just",
    "about",
    "up",
    "out",
    "all",
    "also",
    "than",
    "too",
    "very",
    "each",
    "every",
    "both",
    "few",
    "more",
    "most",
    "other",
    "some",
    "such",
    "only",
    "own",
    "same",
    "into",
    "over",
    "after",
    "before",
    "between",
    "under",
    "again",
    "here",
    "there",
    "any",
    "once",
    "during",
    "through",
    "above",
    "below",
    "while",
    "am",
    "re",
    "ve",
    "ll",
    "don",
    "didn",
    "doesn",
    "won",
    "isn",
    "aren",
    "wasn",
    "weren",
    "hasn",
    "haven",
    "hadn",
    "wouldn",
    "couldn",
    "shouldn",
]);

/** Words excluded from proper noun detection */
const EXCLUDED_PROPER = new Set([
    "I",
    "I'd",
    "I'll",
    "I'm",
    "I've",
]);

export interface ExtractedKeyword {
    /** The keyword or phrase */
    text: string;
    /** Whether this looks like a proper noun */
    isProperNoun: boolean;
    /** Number of occurrences in the text */
    count: number;
}

/**
 * Extract significant keywords from a text chunk.
 * Proper nouns are extracted first (skipping sentence-initial capitalization),
 * then their component words are excluded from regular keyword extraction.
 * Returns deduplicated keywords sorted by frequency.
 */
export function extractKeywords(text: string): ExtractedKeyword[] {
    const keywordMap = new Map<string, ExtractedKeyword>();

    // Step 1: Extract proper nouns first (following baseExtract.py pattern)
    const properNouns = extractProperNouns(text);

    // Build set of words to exclude from regular extraction
    // (words that are part of a proper noun phrase)
    const wordsInProperNouns = new Set<string>();
    for (const phrase of properNouns) {
        for (const word of phrase.split(/\s+/)) {
            wordsInProperNouns.add(word.toLowerCase());
        }
    }

    // Add proper nouns to the keyword map
    for (const phrase of properNouns) {
        const lower = phrase.toLowerCase();
        const existing = keywordMap.get(lower);
        if (existing) {
            existing.count++;
        } else {
            keywordMap.set(lower, {
                text: lower,
                isProperNoun: true,
                count: 1,
            });
        }
    }

    // Step 2: Extract regular keywords (excluding proper noun words)
    const words = tokenize(text);
    for (const word of words) {
        const lower = word.toLowerCase();
        if (lower.length < 2) continue;
        if (STOPWORDS.has(lower)) continue;
        if (isNumericOnly(lower)) continue;
        if (wordsInProperNouns.has(lower)) continue;

        const existing = keywordMap.get(lower);
        if (existing) {
            existing.count++;
        } else {
            keywordMap.set(lower, {
                text: lower,
                isProperNoun: false,
                count: 1,
            });
        }
    }

    return Array.from(keywordMap.values()).sort((a, b) => b.count - a.count);
}

/**
 * Extract proper nouns from text.
 * Skips sentence-initial capitalization (not a proper noun signal).
 * Prefers 2-word proper nouns over 1-word.
 * Handles quoted dialogue (quote-initial words are like sentence-initial).
 * Excludes "I" and its contractions.
 *
 * Based on extract_proper_nouns() from baseExtract.py.
 */
function extractProperNouns(text: string): string[] {
    // Split into sentences
    const sentences = text.split(/[.!?]+\s+/);
    const properNouns: string[] = [];

    for (const sentence of sentences) {
        const words = sentence.split(/\s+/);
        let i = 1; // Start from index 1 to skip sentence-initial capitalization

        while (i < words.length) {
            // Clean word of leading/trailing punctuation
            const word1 = cleanWord(words[i]);

            // Check if previous word ends with a quote (indicating quoted sentence start)
            let isQuoteStart = false;
            if (i > 0) {
                const prev = words[i - 1];
                if (
                    prev &&
                    prev.length > 0 &&
                    isQuoteChar(prev[prev.length - 1])
                ) {
                    isQuoteStart = true;
                }
            }

            // Check if capitalized and not excluded
            if (
                word1 &&
                isCapitalized(word1) &&
                !EXCLUDED_PROPER.has(word1) &&
                !isQuoteStart
            ) {
                // Check for 2-word proper noun
                if (i + 1 < words.length) {
                    const word2 = cleanWord(words[i + 1]);
                    if (
                        word2 &&
                        isCapitalized(word2) &&
                        !EXCLUDED_PROPER.has(word2)
                    ) {
                        // Found 2-word proper noun
                        properNouns.push(`${word1} ${word2}`);
                        i += 2;
                        continue;
                    }
                }

                // Single-word proper noun
                properNouns.push(word1);
            }
            i++;
        }
    }

    return properNouns;
}

/**
 * Tokenize text into words.
 * Handles common punctuation, email addresses, URLs.
 */
function tokenize(text: string): string[] {
    // Preserve email addresses and URLs as tokens
    const emailPattern = /[\w.+-]+@[\w.-]+\.\w+/g;
    const emails: string[] = [];
    let stripped = text.replace(emailPattern, (match) => {
        emails.push(match);
        return " __EMAIL__ ";
    });

    // Split on whitespace and punctuation (keep apostrophes within words)
    const words = stripped
        .split(/[\s,;:!?()[\]{}"<>|/\\~`@#$%^&*+=]+/)
        .filter((w) => w.length > 0 && w !== "__EMAIL__");

    // Add back emails
    words.push(...emails);

    // Clean trailing periods and hyphens
    return words.map((w) => w.replace(/^[.-]+|[.-]+$/g, "")).filter(Boolean);
}

/** Clean leading/trailing punctuation from a word, preserving apostrophes */
function cleanWord(word: string): string {
    return word.replace(/^[^\w']+/, "").replace(/[^\w']+$/, "");
}

function isCapitalized(word: string): boolean {
    return word.length > 0 && word[0] >= "A" && word[0] <= "Z";
}

function isQuoteChar(ch: string): boolean {
    return ch === '"' || ch === "\u201C" || ch === "\u201D" || ch === "'";
}

function isNumericOnly(word: string): boolean {
    return /^\d+$/.test(word);
}
