// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    parseGrammarRules,
    type GrammarParseResult,
    type RuleDefinition,
} from "action-grammar";
import type { Expr } from "action-grammar/rules";
import type {
    LoadedGrammar,
    SymbolIndex,
    SymbolInfo,
    SourceLocation,
    SourcePosition,
    RuleId,
    SourceFile,
} from "./types.js";
import { MissingSourceError } from "./types.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a symbol index for a loaded grammar from its source files.
 * Requires source files (throws MissingSourceError otherwise).
 */
export function getSymbolIndex(g: LoadedGrammar): SymbolIndex {
    if (!g.files || g.files.length === 0) {
        throw new MissingSourceError(g.source);
    }

    const definitions = new Map<RuleId, SymbolInfo>();
    const refs = new Map<RuleId, SourceLocation[]>();

    for (const file of g.files) {
        const parsed = parseGrammarRules(file.id, file.text);
        collectDefinitions(parsed, file, definitions);
        collectReferences(parsed, file, refs);
    }

    const symbols = Array.from(definitions.values());

    return {
        symbols,
        byId: definitions,
        references(ruleId: RuleId): readonly SourceLocation[] {
            return refs.get(ruleId) ?? [];
        },
    };
}

// ---------------------------------------------------------------------------
// Definition collection
// ---------------------------------------------------------------------------

function collectDefinitions(
    parsed: GrammarParseResult,
    file: SourceFile,
    out: Map<RuleId, SymbolInfo>,
): void {
    for (const def of parsed.definitions) {
        const name = def.definitionName.name;
        if (out.has(name)) continue; // first definition wins

        const location = defLocation(def, file);
        const signature = buildSignature(def);
        out.set(name, { id: name, location, kind: "rule", signature });
    }
}

function defLocation(def: RuleDefinition, file: SourceFile): SourceLocation {
    const startOffset = def.pos ?? 0;
    const nameLen = def.definitionName.name.length + 2; // <Name>
    const start = offsetToPosition(file.text, startOffset);
    const end = offsetToPosition(file.text, startOffset + nameLen);
    return {
        fileId: file.id,
        displayPath: file.id,
        range: { start, end },
    };
}

function buildSignature(def: RuleDefinition): string {
    const parts: string[] = [];
    if (def.exported) parts.push("export ");
    parts.push("<" + def.definitionName.name + ">");
    if (def.spacingMode) {
        parts.push(" [spacing=" + def.spacingMode + "]");
    }
    if (def.valueType && def.valueType.length > 0) {
        parts.push(": " + def.valueType.map((t) => t.name).join(" | "));
    }
    parts.push(
        " = ... (" +
            def.rules.length +
            " alternative" +
            (def.rules.length === 1 ? "" : "s") +
            ")",
    );
    return parts.join("");
}

// ---------------------------------------------------------------------------
// Reference collection
// ---------------------------------------------------------------------------

function collectReferences(
    parsed: GrammarParseResult,
    file: SourceFile,
    out: Map<RuleId, SourceLocation[]>,
): void {
    // Imports
    for (const imp of parsed.imports) {
        if (imp.names === "*") continue;
        for (const n of imp.names) {
            addRef(out, n.name, imp.pos ?? 0, n.name.length + 2, file);
        }
    }

    // Rule bodies
    for (const def of parsed.definitions) {
        for (const rule of def.rules) {
            collectExprRefs(rule.expressions, file, out);
        }
    }
}

function collectExprRefs(
    exprs: readonly Expr[],
    file: SourceFile,
    out: Map<RuleId, SourceLocation[]>,
): void {
    for (const expr of exprs) {
        switch (expr.type) {
            case "ruleReference":
                addRef(
                    out,
                    expr.refName.name,
                    expr.pos ?? 0,
                    expr.refName.name.length + 2, // <Name>
                    file,
                );
                break;
            case "variable":
                if (expr.ruleReference && expr.refName) {
                    addRef(
                        out,
                        expr.refName.name,
                        expr.refPos ?? expr.pos ?? 0,
                        expr.refName.name.length + 2,
                        file,
                    );
                }
                break;
            case "rules":
                for (const sub of expr.rules) {
                    collectExprRefs(sub.expressions, file, out);
                }
                break;
            // "string" - no references
        }
    }
}

function addRef(
    out: Map<RuleId, SourceLocation[]>,
    name: string,
    offset: number,
    length: number,
    file: SourceFile,
): void {
    const start = offsetToPosition(file.text, offset);
    const end = offsetToPosition(file.text, offset + length);
    const loc: SourceLocation = {
        fileId: file.id,
        displayPath: file.id,
        range: { start, end },
    };
    const list = out.get(name);
    if (list) {
        list.push(loc);
    } else {
        out.set(name, [loc]);
    }
}

// ---------------------------------------------------------------------------
// Position-based lookup
// ---------------------------------------------------------------------------

/**
 * Return the rule ID at a given (line, character) position in a file,
 * or `null` if the position does not fall on a definition or reference.
 */
export function symbolAtPosition(
    index: SymbolIndex,
    fileId: string,
    line: number,
    character: number,
): RuleId | null {
    // Check definitions
    for (const sym of index.symbols) {
        if (
            sym.location.fileId === fileId &&
            inRange(sym.location, line, character)
        ) {
            return sym.id;
        }
    }
    // Check references
    for (const sym of index.symbols) {
        for (const ref of index.references(sym.id)) {
            if (ref.fileId === fileId && inRange(ref, line, character)) {
                return sym.id;
            }
        }
    }
    return null;
}

function inRange(
    loc: SourceLocation,
    line: number,
    character: number,
): boolean {
    const { start, end } = loc.range;
    if (line < start.line || line > end.line) return false;
    if (line === start.line && character < start.character) return false;
    if (line === end.line && character >= end.character) return false;
    return true;
}

// ---------------------------------------------------------------------------
// Position utilities
// ---------------------------------------------------------------------------

export function offsetToPosition(text: string, offset: number): SourcePosition {
    let line = 0;
    let character = 0;
    const end = Math.min(offset, text.length);
    for (let i = 0; i < end; i++) {
        if (text[i] === "\n") {
            line++;
            character = 0;
        } else {
            character++;
        }
    }
    return { line, character, offset };
}
