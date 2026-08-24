// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Loads the bundled conceptual/setup docs (the docs/overview markdown plus the
// workspace README) and turns a user question into a compact grounding for the
// explainTypeAgent handler. The docs are copied into dist at build time (see
// scripts/copyCatalog.mjs); nothing is fetched at runtime. Unlike the catalog
// (typed commands/actions), these are prose, so we chunk by heading and select
// the chunks whose text best overlaps the question - always including the
// overview intro so "what is TypeAgent" is answered even when no keyword matches.

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { queryTokens, score } from "./text.js";

export type DocChunk = {
    // File the chunk came from, e.g. "index.md" or "getting-started.md".
    source: string;
    // The heading that introduces the chunk (without the leading '#'s).
    heading: string;
    // The chunk text (heading line included), trimmed.
    text: string;
    // Always-included overview intro, kept even when nothing else matches.
    pinned: boolean;
};

// The overview page whose intro we always include for conceptual questions.
const PINNED_SOURCE = "index.md";
// How many leading chunks of the overview to pin (intro + "What is TypeAgent?").
const PINNED_CHUNKS = 2;

const MAX_DOC_CHUNKS = 6;
const MAX_CHUNK_CHARS = 1400;

// Split markdown into heading-delimited chunks at H1/H2 boundaries. H3+ stay
// inside their parent H2 so a section reads as one coherent chunk. Exported for
// unit testing the chunking contract.
const HEADING_RE = /^(#{1,2})\s+(.*\S)\s*$/;

export function chunkMarkdown(source: string, markdown: string): DocChunk[] {
    const lines = markdown.split(/\r?\n/);
    const chunks: DocChunk[] = [];
    let heading = "";
    let buffer: string[] = [];

    const flush = () => {
        const text = buffer.join("\n").trim();
        if (text.length > 0) {
            chunks.push({ source, heading, text, pinned: false });
        }
        buffer = [];
    };

    for (const line of lines) {
        const match = HEADING_RE.exec(line);
        if (match) {
            flush();
            heading = match[2];
        }
        buffer.push(line);
    }
    flush();
    return chunks;
}

let loaded = false;
let cachedChunks: DocChunk[] | undefined;

// Reads and chunks every bundled doc once. Returns an empty array when the docs
// directory is missing or empty; the handler surfaces a friendly message then.
export function loadDocChunks(): DocChunk[] {
    if (loaded) {
        return cachedChunks ?? [];
    }
    loaded = true;
    try {
        const dir = fileURLToPath(new URL("./docs/", import.meta.url));
        const files = readdirSync(dir)
            .filter((f) => f.endsWith(".md"))
            .sort();
        const all: DocChunk[] = [];
        for (const file of files) {
            const markdown = readFileSync(
                fileURLToPath(new URL(`./docs/${file}`, import.meta.url)),
                "utf8",
            );
            const chunks = chunkMarkdown(file, markdown);
            if (file === PINNED_SOURCE) {
                for (let i = 0; i < chunks.length && i < PINNED_CHUNKS; i++) {
                    chunks[i].pinned = true;
                }
            }
            all.push(...chunks);
        }
        cachedChunks = all;
    } catch {
        cachedChunks = [];
    }
    return cachedChunks ?? [];
}

// Selects the chunks to ground the model on: the pinned overview intro first,
// then the highest-overlap chunks for the question, up to MAX_DOC_CHUNKS total.
export function selectDocChunks(
    chunks: DocChunk[],
    question: string,
    max: number = MAX_DOC_CHUNKS,
): DocChunk[] {
    const pinned = chunks.filter((c) => c.pinned);
    const selected: DocChunk[] = [...pinned];
    const seen = new Set(selected);

    const qTokens = queryTokens(question);
    if (qTokens.length > 0) {
        const scored = chunks
            .filter((c) => !seen.has(c))
            .map((c) => ({ c, s: score(qTokens, c.text.toLowerCase()) }))
            .filter((x) => x.s > 0)
            .sort((a, b) => b.s - a.s);
        for (const { c } of scored) {
            if (selected.length >= max) {
                break;
            }
            selected.push(c);
            seen.add(c);
        }
    }
    return selected;
}

function truncate(text: string): string {
    if (text.length <= MAX_CHUNK_CHARS) {
        return text;
    }
    return `${text.slice(0, MAX_CHUNK_CHARS).trimEnd()}…`;
}

// Renders the selected doc chunks as the grounding text handed to the model.
export function formatDocsGrounding(chunks: DocChunk[]): string {
    const lines: string[] = [
        "TypeAgent documentation excerpts. Answer ONLY from these; do not invent features or settings.",
    ];
    for (const chunk of chunks) {
        lines.push("");
        lines.push(`### source: ${chunk.source}`);
        lines.push(truncate(chunk.text));
    }
    return lines.join("\n");
}
