// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { promises as fs } from "node:fs";

import type { CorpusEntry } from "./types.js";

/**
 * Parse JSONL text into corpus entries. Empty / whitespace-only lines are
 * ignored. Any line that fails to parse or doesn't shape-check as a corpus
 * entry triggers `JsonlParseError` — keep parsing trivial (no comment
 * support) so corruption is caught early and not silently swallowed.
 */
export function parseJsonl(text: string, sourceUri?: string): CorpusEntry[] {
    const out: CorpusEntry[] = [];
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.length === 0) {
            continue;
        }
        let parsed: unknown;
        try {
            parsed = JSON.parse(line);
        } catch (err) {
            throw new JsonlParseError(sourceUri, i + 1, (err as Error).message);
        }
        if (!isCorpusEntry(parsed)) {
            throw new JsonlParseError(
                sourceUri,
                i + 1,
                "line did not shape-check as a CorpusEntry",
            );
        }
        out.push(parsed);
    }
    return out;
}

export function formatJsonl(entries: CorpusEntry[]): string {
    if (entries.length === 0) {
        return "";
    }
    return entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
}

export async function readJsonlFile(
    path: string,
): Promise<CorpusEntry[]> {
    try {
        const text = await fs.readFile(path, "utf8");
        return parseJsonl(text, path);
    } catch (err) {
        if (
            (err as NodeJS.ErrnoException).code === "ENOENT" ||
            (err as NodeJS.ErrnoException).code === "EISDIR"
        ) {
            return [];
        }
        throw err;
    }
}

export async function writeJsonlFile(
    path: string,
    entries: CorpusEntry[],
): Promise<void> {
    await fs.writeFile(path, formatJsonl(entries), "utf8");
}

export async function appendJsonlFile(
    path: string,
    entries: CorpusEntry[],
): Promise<void> {
    if (entries.length === 0) {
        return;
    }
    await fs.appendFile(path, formatJsonl(entries), "utf8");
}

function isCorpusEntry(value: unknown): value is CorpusEntry {
    if (value === null || typeof value !== "object") {
        return false;
    }
    const v = value as Partial<CorpusEntry>;
    if (typeof v.id !== "string" || v.id.length === 0) return false;
    if (typeof v.utterance !== "string") return false;
    if (typeof v.agent !== "string") return false;
    if (
        v.source !== "in-repo" &&
        v.source !== "captures" &&
        v.source !== "external" &&
        v.source !== "feedback"
    ) {
        return false;
    }
    if (
        v.provenance === undefined ||
        v.provenance === null ||
        typeof v.provenance !== "object"
    ) {
        return false;
    }
    if (typeof (v.provenance as { sourceUri?: unknown }).sourceUri !== "string") {
        return false;
    }
    return true;
}

export class JsonlParseError extends Error {
    constructor(
        public readonly sourceUri: string | undefined,
        public readonly line: number,
        message: string,
    ) {
        super(
            `JSONL parse error at ${sourceUri ?? "<input>"}:${line}: ${message}`,
        );
        this.name = "JsonlParseError";
    }
}
