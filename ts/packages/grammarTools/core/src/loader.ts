// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { loadGrammarRulesNoThrow } from "action-grammar";
import type { Grammar, DebugInfoCollector, FileLoader } from "action-grammar";
import type {
    GrammarIdentifierIndex,
    GrammarDebugInfo,
    GrammarSource,
    LoadedGrammar,
    LoadResult,
    GrammarSnapshot,
    SourceFile,
    SourceLocation,
    Diagnostic,
    SourceRange,
} from "./types.js";

/**
 * Load a grammar from a file path on disk.
 * Supports .agr file imports (import ... from "./other.agr").
 */
export async function loadGrammarFromFile(
    filePath: string,
): Promise<LoadResult> {
    const nodePath = await import("path");
    const nodeFs = await import("fs");
    const { readFile } = await import("fs/promises");

    const resolvedPath = nodePath.resolve(filePath);
    const text = await readFile(resolvedPath, "utf-8");
    const displayPath = nodePath.relative(process.cwd(), resolvedPath);

    const fileLoader: FileLoader = {
        resolvePath: (name: string, ref?: string) =>
            ref
                ? nodePath.resolve(nodePath.dirname(ref), name)
                : nodePath.resolve(name),
        readContent: (fullPath: string) => {
            if (!nodeFs.existsSync(fullPath)) {
                throw new Error(`File not found: ${fullPath}`);
            }
            return nodeFs.readFileSync(fullPath, "utf-8");
        },
        displayPath: (fullPath: string) =>
            nodePath.relative(process.cwd(), fullPath),
    };

    return loadFromFileLoader(resolvedPath, text, displayPath, fileLoader, {
        kind: "file",
        path: filePath,
    });
}

/**
 * Load a grammar from an in-memory text buffer.
 * If a `fileLoader` is provided, `import ... from "./other.agr"` statements
 * in the buffer will be resolved via the loader.  The `id` is used as the
 * file identity for import path resolution.
 */
export function loadGrammarFromBuffer(
    id: string,
    text: string,
    fileLoader?: FileLoader,
): LoadResult {
    if (fileLoader) {
        return loadFromFileLoader(id, text, id, fileLoader, {
            kind: "buffer",
            id,
        });
    }
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

function makeCollector(fileId: string, text: string): DebugInfoCollector {
    return {
        partPositions: new Map(),
        rulePositions: new Map(),
        partRules: new Map(),
        partLabels: new Map(),
        fileContents: new Map([[fileId, text]]),
        filePaths: new Map(),
    };
}

function buildLoadResult(
    grammar: Grammar | undefined,
    errors: string[],
    warnings: string[],
    collector: DebugInfoCollector,
    source: GrammarSource,
    file: SourceFile,
    text: string,
): LoadResult {
    if (grammar && errors.length === 0) {
        const identifiers = buildIdentifierIndex(grammar);
        const debugInfo = buildDebugInfo(collector);

        // Build file list: root file + any imported files from the collector
        const rootId = file.id;
        const files: SourceFile[] = [file];
        for (const [fileId, fileText] of collector.fileContents) {
            if (fileId !== rootId) {
                files.push({ id: fileId, text: fileText, imported: true });
            }
        }

        const loaded: LoadedGrammar = {
            source,
            grammar,
            debugInfo,
            files,
            identifiers,
        };
        const diagnostics: Diagnostic[] | undefined =
            warnings.length > 0
                ? warnings.map((message) => ({
                      range: extractRange(message, text),
                      severity: "warning" as const,
                      message,
                      source: "grammar-tools-core" as const,
                  }))
                : undefined;
        if (diagnostics) {
            return { ok: true, grammar: loaded, diagnostics };
        }
        return { ok: true, grammar: loaded };
    }

    const diagnostics: Diagnostic[] = [
        ...errors.map((message) => ({
            range: extractRange(message, text),
            severity: "error" as const,
            message,
            source: "grammar-tools-core" as const,
        })),
        ...warnings.map((message) => ({
            range: extractRange(message, text),
            severity: "warning" as const,
            message,
            source: "grammar-tools-core" as const,
        })),
    ];
    return { ok: false, diagnostics, files: [file] };
}

function loadFromText(text: string, source: GrammarSource): LoadResult {
    const file: SourceFile = { id: sourceId(source), text };
    const errors: string[] = [];
    const warnings: string[] = [];
    const collector = makeCollector(sourceId(source), text);
    const grammar = loadGrammarRulesNoThrow(
        sourceId(source),
        text,
        errors,
        warnings,
        { debugCollector: collector },
    );

    return buildLoadResult(
        grammar,
        errors,
        warnings,
        collector,
        source,
        file,
        text,
    );
}

/**
 * Load a grammar using a FileLoader so the compiler can resolve
 * `import ... from "./other.agr"` statements.
 */
function loadFromFileLoader(
    fullPath: string,
    text: string,
    displayPath: string,
    fileLoader: FileLoader,
    source: GrammarSource,
): LoadResult {
    const file: SourceFile = { id: sourceId(source), text };
    const errors: string[] = [];
    const warnings: string[] = [];
    const collector = makeCollector(displayPath, text);
    const grammar = loadGrammarRulesNoThrow(
        fullPath,
        fileLoader,
        errors,
        warnings,
        { debugCollector: collector },
    );

    return buildLoadResult(
        grammar,
        errors,
        warnings,
        collector,
        source,
        file,
        text,
    );
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
    let nextPartId = 0;

    for (let i = 0; i < grammar.alternatives.length; i++) {
        const rule = grammar.alternatives[i];
        // Use rule index as the rule ID for now; named rules will use
        // their name once we have the parser AST available.
        const id = `rule_${i}`;
        ruleIds.push(id);
        ruleIndex.set(id, i);

        for (let p = 0; p < rule.parts.length; p++) {
            partIds.push(nextPartId++);
        }
    }

    return { ruleIds, partIds, ruleIndex };
}

function extractRange(message: string, text: string): SourceRange {
    // Match compiler/parser format: file(line,col): ...
    const match = message.match(/\((\d+),(\d+)\)/);
    if (match) {
        const line = parseInt(match[1], 10) - 1; // 0-based
        const character = parseInt(match[2], 10) - 1;
        const offset = positionToOffset(text, line, character);
        return {
            start: { line, character, offset },
            end: { line, character: character + 1, offset: offset + 1 },
        };
    }
    // Fallback: span the first line so the diagnostic is still visible
    const firstNewline = text.indexOf("\n");
    const endChar = firstNewline >= 0 ? firstNewline : text.length;
    return {
        start: { line: 0, character: 0, offset: 0 },
        end: { line: 0, character: endChar, offset: endChar },
    };
}

function positionToOffset(
    text: string,
    line: number,
    character: number,
): number {
    let currentLine = 0;
    let offset = 0;
    while (currentLine < line && offset < text.length) {
        if (text[offset] === "\r" && text[offset + 1] === "\n") {
            offset++; // skip \r, the \n is handled below
        }
        if (text[offset] === "\n") {
            currentLine++;
        }
        offset++;
    }
    return offset + character;
}

/**
 * Convert a character offset in `text` to a line/character position.
 */
function offsetToPosition(
    text: string,
    offset: number,
): { line: number; character: number } {
    let line = 0;
    let lineStart = 0;
    for (let i = 0; i < offset && i < text.length; i++) {
        if (text[i] === "\n") {
            line++;
            lineStart = i + 1;
        } else if (text[i] === "\r") {
            line++;
            if (i + 1 < text.length && text[i + 1] === "\n") {
                i++; // skip \n in \r\n
            }
            lineStart = i + 1;
        }
    }
    return { line, character: offset - lineStart };
}

/**
 * Build a `GrammarDebugInfo` from the raw positions collected during compilation.
 * Each position entry carries its own fileId, so multi-file grammars resolve correctly.
 */
function buildDebugInfo(collector: DebugInfoCollector): GrammarDebugInfo {
    const rules = new Map<string, SourceLocation>();
    for (const [ruleId, pos] of collector.rulePositions) {
        const text = collector.fileContents.get(pos.fileId) ?? "";
        const start = offsetToPosition(text, pos.offset);
        rules.set(ruleId, {
            fileId: pos.fileId,
            displayPath: pos.fileId,
            range: {
                start: { ...start, offset: pos.offset },
                end: { ...start, offset: pos.offset },
            },
        });
    }

    const parts = new Map<number, SourceLocation>();
    for (const [partId, pos] of collector.partPositions) {
        const text = collector.fileContents.get(pos.fileId) ?? "";
        const start = offsetToPosition(text, pos.offset);
        parts.set(partId, {
            fileId: pos.fileId,
            displayPath: pos.fileId,
            range: {
                start: { ...start, offset: pos.offset },
                end: { ...start, offset: pos.offset },
            },
        });
    }

    // Hash incorporating file names, total length, and part/rule counts
    const fileKeys = Array.from(collector.fileContents.keys()).sort().join("|");
    const totalLen = [...collector.fileContents.values()].reduce(
        (sum, t) => sum + t.length,
        0,
    );
    const grammarHash = `${totalLen}:${fileKeys}:${collector.partPositions.size}:${collector.rulePositions.size}`;

    return {
        grammarHash,
        rules,
        parts,
        partRules: collector.partRules,
        partLabels: collector.partLabels,
        filePaths: collector.filePaths,
    };
}
