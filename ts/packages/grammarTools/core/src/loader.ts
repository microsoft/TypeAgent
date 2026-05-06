// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { loadGrammarRules } from "action-grammar";
import type { Grammar } from "action-grammar";
import type {
    GrammarIdentifierIndex,
    GrammarSource,
    LoadedGrammar,
    LoadResult,
    GrammarSnapshot,
    SourceFile,
    Diagnostic,
} from "./types.js";

/**
 * Load a grammar from a file path on disk.
 */
export async function loadGrammarFromFile(path: string): Promise<LoadResult> {
    const fs = await import("fs");
    const text = fs.readFileSync(path, "utf-8");
    return loadFromText(text, { kind: "file", path });
}

/**
 * Load a grammar from an in-memory text buffer.
 */
export function loadGrammarFromBuffer(id: string, text: string): LoadResult {
    return loadFromText(text, { kind: "buffer", id });
}

/**
 * Load a grammar from an agent name. Resolves via
 * the agent grammar registry.
 */
export async function loadGrammarFromAgent(
    _agentName: string,
): Promise<LoadResult> {
    // TODO: Wire up agentGrammarRegistry discovery and merge
    throw new Error("loadGrammarFromAgent not yet implemented");
}

/**
 * Load a grammar from a dispatcher snapshot (per ADR 0003).
 */
export function loadGrammarFromSnapshot(
    _snapshot: GrammarSnapshot,
): LoadResult {
    // TODO: Deserialize grammar JSON + debugInfo JSON
    throw new Error("loadGrammarFromSnapshot not yet implemented");
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function loadFromText(text: string, source: GrammarSource): LoadResult {
    try {
        const grammar = loadGrammarRules(sourceId(source), text);
        const file: SourceFile = { id: sourceId(source), text };
        const identifiers = buildIdentifierIndex(grammar);
        const loaded: LoadedGrammar = {
            source,
            grammar,
            files: [file],
            identifiers,
        };
        return { ok: true, grammar: loaded };
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        const diag: Diagnostic = {
            range: {
                start: { line: 0, character: 0, offset: 0 },
                end: { line: 0, character: 0, offset: 0 },
            },
            severity: "error",
            message,
            source: "grammar-tools-core",
        };
        const file: SourceFile = { id: sourceId(source), text };
        return { ok: false, diagnostics: [diag], files: [file] };
    }
}

function sourceId(source: GrammarSource): string {
    switch (source.kind) {
        case "file":
            return source.path;
        case "buffer":
            return source.id;
        case "agent":
            return source.agentName;
        case "snapshot":
            return `snapshot:${source.sessionId ?? "default"}`;
        case "decompiled":
            return `decompiled:${sourceId(source.from)}`;
    }
}

function buildIdentifierIndex(grammar: Grammar): GrammarIdentifierIndex {
    const ruleIds: string[] = [];
    const partIds: number[] = [];
    const ruleIndex = new Map<string, number>();

    for (let i = 0; i < grammar.alternatives.length; i++) {
        const rule = grammar.alternatives[i];
        // Use rule index as the rule ID for now; named rules will use
        // their name once we have the parser AST available.
        const id = `rule_${i}`;
        ruleIds.push(id);
        ruleIndex.set(id, i);

        for (let p = 0; p < rule.parts.length; p++) {
            partIds.push(i * 1000 + p); // placeholder PartId scheme
        }
    }

    return { ruleIds, partIds, ruleIndex };
}
