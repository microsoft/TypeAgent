// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    OVERVIEW_HARD_CAP_WORDS,
    OVERVIEW_TARGET_WORDS_MAX,
    OVERVIEW_TARGET_WORDS_MIN,
} from "./lengthCaps.js";

export interface OverviewValidation {
    valid: boolean;
    /** Hard violations — invalid=true means the model must retry. */
    violations: string[];
    /** Soft warnings — informational, do not fail. */
    warnings: string[];
    wordCount: number;
}

const MARKETING_WORDS = [
    "powerful",
    "seamless",
    "robust",
    "cutting-edge",
    "cutting edge",
    "best-in-class",
    "best in class",
    "blazing",
    "blazingly",
    "elegant",
    "world-class",
    "world class",
    "revolutionary",
    "game-changing",
    "game changing",
    "next-generation",
    "next generation",
];

/** Count whitespace-separated tokens, ignoring code fences. */
export function countOverviewWords(markdown: string): number {
    const stripped = markdown.replace(/```[\s\S]*?```/gu, " ");
    const tokens = stripped.trim().split(/\s+/u).filter(Boolean);
    return tokens.length;
}

/**
 * Validate an Overview body returned by the LLM. The body should NOT
 * include the `## Overview` heading itself.
 *
 * Hard rules (any failure → retry):
 *   - Must not contain heading lines (no `## ...` or `### ...` etc.).
 *   - Must not exceed OVERVIEW_HARD_CAP_WORDS.
 *   - Must not contain marketing words.
 *   - Must not contain Mermaid fences (```mermaid).
 *   - Must not contain absolute https:// URLs.
 *   - Code fences must declare a language.
 *
 * Soft warnings:
 *   - Word count outside the target band.
 */
export function validateOverview(body: string): OverviewValidation {
    const violations: string[] = [];
    const warnings: string[] = [];

    if (/^\s{0,3}#{1,6}\s/mu.test(body)) {
        violations.push(
            "Overview must not include any markdown headings; emit prose only.",
        );
    }

    const wordCount = countOverviewWords(body);
    if (wordCount > OVERVIEW_HARD_CAP_WORDS) {
        violations.push(
            `Overview is ${wordCount} words; hard cap is ${OVERVIEW_HARD_CAP_WORDS}.`,
        );
    } else if (
        wordCount < OVERVIEW_TARGET_WORDS_MIN ||
        wordCount > OVERVIEW_TARGET_WORDS_MAX
    ) {
        warnings.push(
            `Overview is ${wordCount} words; target band is ${OVERVIEW_TARGET_WORDS_MIN}–${OVERVIEW_TARGET_WORDS_MAX}.`,
        );
    }

    const lower = body.toLowerCase();
    const marketingHits = MARKETING_WORDS.filter((w) => lower.includes(w));
    if (marketingHits.length > 0) {
        violations.push(
            `Overview uses banned marketing words: ${marketingHits.join(", ")}.`,
        );
    }

    if (/```\s*mermaid/iu.test(body)) {
        violations.push("Overview must not contain Mermaid diagrams.");
    }

    if (/https?:\/\//iu.test(body)) {
        violations.push(
            "Overview must not contain absolute URLs; use repo-relative ./ or ../ paths instead.",
        );
    }

    // Code fences must declare a language. A fence opens with ``` and
    // optional language; pair them up and check the opener.
    const fenceLines = body
        .split(/\r?\n/u)
        .map((line, idx) => ({ line, idx }))
        .filter(({ line }) => /^\s*```/u.test(line));
    for (let i = 0; i < fenceLines.length; i += 2) {
        const opener = fenceLines[i];
        if (!opener) continue;
        const trimmed = opener.line.trim();
        const lang = trimmed.slice(3).trim();
        if (!lang) {
            violations.push(
                `Code fence at line ${opener.idx + 1} is missing a language tag.`,
            );
        }
    }

    return {
        valid: violations.length === 0,
        violations,
        warnings,
        wordCount,
    };
}
