// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// data/ sits at the package root; compiled code runs from dist/.
export const dataDir = path.resolve(__dirname, "../data");

export type Split = "train" | "valid" | "test";

/**
 * One SNIPS example in the Goo et al. BIO format.
 * `tokens` and `tags` are aligned 1:1 (same length).
 */
export interface SnipsExample {
    tokens: string[];
    tags: string[]; // BIO slot tags, e.g. "B-artist", "I-artist", "O"
    intent: string;
}

/** A labeled slot span recovered from a BIO tag sequence. */
export interface SlotSpan {
    label: string;
    start: number; // inclusive token index
    end: number; // exclusive token index
}

function readLines(file: string): string[] {
    // Trailing newline produces an empty final element; drop it.
    const raw = fs.readFileSync(file, "utf-8");
    const lines = raw.split("\n");
    if (lines.length > 0 && lines[lines.length - 1] === "") {
        lines.pop();
    }
    return lines;
}

/**
 * Load a SNIPS split. Each line of seq.in / seq.out / label is parsed into a
 * {@link SnipsExample}. Throws if the three files disagree on line count or if
 * any line's token/tag counts are misaligned.
 */
export function loadSplit(split: Split): SnipsExample[] {
    const dir = path.join(dataDir, split);
    const seqIn = readLines(path.join(dir, "seq.in"));
    const seqOut = readLines(path.join(dir, "seq.out"));
    const labels = readLines(path.join(dir, "label"));

    if (seqIn.length !== seqOut.length || seqIn.length !== labels.length) {
        throw new Error(
            `${split}: line-count mismatch (in=${seqIn.length}, out=${seqOut.length}, label=${labels.length})`,
        );
    }

    const examples: SnipsExample[] = [];
    for (let i = 0; i < seqIn.length; i++) {
        const tokens = seqIn[i].trim().split(/\s+/).filter(Boolean);
        const tags = seqOut[i].trim().split(/\s+/).filter(Boolean);
        if (tokens.length !== tags.length) {
            throw new Error(
                `${split} line ${i + 1}: ${tokens.length} tokens vs ${tags.length} tags`,
            );
        }
        examples.push({ tokens, tags, intent: labels[i].trim() });
    }
    return examples;
}

/**
 * Convert a BIO tag sequence into labeled slot spans. A span opens on `B-X`,
 * continues on `I-X`, and closes on `O`, end-of-sequence, another `B-`, or an
 * `I-` whose label differs from the open span (lenient: treated as a new span).
 */
export function tagsToSpans(tags: string[]): SlotSpan[] {
    const spans: SlotSpan[] = [];
    let cur: SlotSpan | undefined;
    const close = () => {
        if (cur) {
            spans.push(cur);
            cur = undefined;
        }
    };
    for (let i = 0; i < tags.length; i++) {
        const tag = tags[i];
        if (tag === "O" || tag === "") {
            close();
            continue;
        }
        const dash = tag.indexOf("-");
        const prefix = dash === -1 ? tag : tag.slice(0, dash);
        const label = dash === -1 ? tag : tag.slice(dash + 1);
        if (prefix === "B" || !cur || cur.label !== label) {
            close();
            cur = { label, start: i, end: i + 1 };
        } else {
            // "I-" continuing the current span.
            cur.end = i + 1;
        }
    }
    close();
    return spans;
}

/** Inverse of {@link tagsToSpans}: render spans back to a BIO tag sequence. */
export function spansToTags(spans: SlotSpan[], length: number): string[] {
    const tags: string[] = new Array(length).fill("O");
    for (const span of spans) {
        for (let i = span.start; i < span.end && i < length; i++) {
            tags[i] = (i === span.start ? "B-" : "I-") + span.label;
        }
    }
    return tags;
}
