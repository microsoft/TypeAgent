// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { parseFenceLine, walkLinesWithFences } from "./fenceWalker.js";
import {
    DOCUMENTATION_HARD_CAP_WORDS,
    DOCUMENTATION_TARGET_WORDS_MAX,
    DOCUMENTATION_TARGET_WORDS_MIN,
} from "./lengthCaps.js";

export interface DocumentationValidation {
    valid: boolean;
    /** Hard violations — invalid=true means the model must retry. */
    violations: string[];
    /** Soft warnings — informational, do not fail. */
    warnings: string[];
    wordCount: number;
    /** H2 section headings the validator detected, in source order. */
    sectionHeadings: string[];
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

/**
 * H2 sections we expect a complete documentation body to contain.
 * Missing required sections raise a hard violation; extra sections
 * are allowed (the LLM may add e.g. "Configuration" when relevant).
 */
const REQUIRED_SECTIONS = ["Overview"] as const;

/**
 * H1 must never appear (the file's H1 is part of the deterministic
 * header). H4+ are allowed because nested call-outs are useful.
 */
const FORBIDDEN_H1 = /^\s*#\s+\S/mu;

/** Count whitespace-separated tokens, ignoring code fences. */
export function countDocumentationWords(markdown: string): number {
    const stripped = stripFencedCode(markdown);
    const tokens = stripped.trim().split(/\s+/u).filter(Boolean);
    return tokens.length;
}

/**
 * Validate a documentation body returned by the LLM. The body is
 * expected to be a multi-section markdown document using `##` for
 * top-level section headings (e.g. `## Overview`, `## What it does`).
 *
 * Hard rules (any failure → retry):
 *   - Must NOT contain an H1 — that belongs to the deterministic
 *     file header.
 *   - Must contain every section in `REQUIRED_SECTIONS`.
 *   - Must NOT exceed DOCUMENTATION_HARD_CAP_WORDS.
 *   - Must NOT contain marketing words.
 *   - Must NOT contain Mermaid fences (```mermaid).
 *   - Must NOT contain absolute https:// URLs.
 *   - Code fences must declare a language.
 *
 * Soft warnings:
 *   - Word count outside the target band.
 *   - Section count outside the typical range (3–8).
 */
export function validateDocumentation(body: string): DocumentationValidation {
    const violations: string[] = [];
    const warnings: string[] = [];

    if (FORBIDDEN_H1.test(body)) {
        violations.push(
            "Documentation must not include an H1 — emit `## Section` headings only.",
        );
    }

    const sectionHeadings = collectH2Headings(body);
    for (const required of REQUIRED_SECTIONS) {
        const found = sectionHeadings.some(
            (h) => h.toLowerCase() === required.toLowerCase(),
        );
        if (!found) {
            violations.push(
                `Documentation is missing required section "## ${required}".`,
            );
        }
    }
    if (sectionHeadings.length === 0) {
        violations.push(
            "Documentation must contain at least one `## Section` heading.",
        );
    } else if (sectionHeadings.length > 10) {
        warnings.push(
            `Documentation has ${sectionHeadings.length} top-level sections; consider consolidating below 10.`,
        );
    }

    const wordCount = countDocumentationWords(body);
    if (wordCount > DOCUMENTATION_HARD_CAP_WORDS) {
        violations.push(
            `Documentation is ${wordCount} words; hard cap is ${DOCUMENTATION_HARD_CAP_WORDS}.`,
        );
    } else if (
        wordCount < DOCUMENTATION_TARGET_WORDS_MIN ||
        wordCount > DOCUMENTATION_TARGET_WORDS_MAX
    ) {
        warnings.push(
            `Documentation is ${wordCount} words; target band is ${DOCUMENTATION_TARGET_WORDS_MIN}–${DOCUMENTATION_TARGET_WORDS_MAX}.`,
        );
    }

    const lower = body.toLowerCase();
    const marketingHits = MARKETING_WORDS.filter((w) => lower.includes(w));
    if (marketingHits.length > 0) {
        violations.push(
            `Documentation uses banned marketing words: ${marketingHits.join(", ")}.`,
        );
    }

    if (/(?:^|\n)\s*(?:`{3,}|~{3,})\s*mermaid/iu.test(body)) {
        violations.push("Documentation must not contain Mermaid diagrams.");
    }

    // Only flag absolute URLs that appear as clickable markdown
    // links — `[text](https://...)` or autolinks `<https://...>`.
    // Plain prose mentions of a URL and inline-code references like
    // `\`https://aka.ms/foo\`` are allowed because legitimate setup
    // documentation needs to point at external portals.
    const codeStripped = stripFencedCode(body);
    if (/\[[^\]]+\]\(https?:\/\/[^)\s]+\)/iu.test(codeStripped)) {
        violations.push(
            "Documentation must not contain absolute URLs in markdown link syntax `[text](https://…)`; use repo-relative ./ or ../ paths or move the URL into prose / inline code.",
        );
    }
    if (/<https?:\/\/[^>\s]+>/iu.test(codeStripped)) {
        violations.push(
            "Documentation must not contain `<https://…>` autolinks; wrap the URL in inline code (`` `https://…` ``) or rephrase as prose.",
        );
    }

    // Walk fences with shared state machine so opener/closer pairing
    // is correct for both ``` and ~~~ fences and odd-numbered fences
    // (e.g. an unterminated opener) don't trigger false-positive
    // "missing language tag" violations on what is actually a closer.
    walkLinesWithFences(body, (line, idx, state) => {
        if (!state.isFence) return;
        // Only check opener boundaries (not closers).
        if (state.inFence) return;
        const fence = parseFenceLine(line);
        if (!fence) return;
        if (fence.info.length === 0) {
            violations.push(
                `Code fence at line ${idx + 1} is missing a language tag.`,
            );
        }
    });

    return {
        valid: violations.length === 0,
        violations,
        warnings,
        wordCount,
        sectionHeadings,
    };
}

function collectH2Headings(body: string): string[] {
    const out: string[] = [];
    walkLinesWithFences(body, (line, _idx, state) => {
        if (state.isFence || state.inFence) return;
        const m = /^##\s+(.+?)\s*$/u.exec(line);
        if (m) out.push(m[1]!.trim());
    });
    return out;
}

/**
 * Replace fenced code blocks (both ``` and ~~~) with a single space
 * so URL/link checks don't accidentally flag content inside example
 * code blocks. Uses the shared fence walker for consistent pairing.
 */
function stripFencedCode(body: string): string {
    const out: string[] = [];
    walkLinesWithFences(body, (line, _idx, state) => {
        if (state.isFence || state.inFence) {
            out.push(" ");
            return;
        }
        out.push(line);
    });
    return out.join("\n");
}
