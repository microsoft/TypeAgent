// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    Expr,
    GrammarParseResult,
    isExpressionSpecialChar,
    isWhitespace,
    Rule,
    RuleDefinition,
    ValueNode,
} from "./grammarRuleParser.js";

export type GrammarWriterOptions = {
    maxLineLength?: number; // Maximum line length before breaking (default: 80)
    indentSize?: number; // Number of spaces to indent when breaking lines (default: 2)
};

// ─── Design: 2-pass compact-first formatter ───────────────────────────────────
//
// GrammarWriter uses a two-pass approach to produce compact output that fits
// within maxLineLength while gracefully expanding when it doesn't.
//
// PASS 1 — BUILD: write* and emit* calls accumulate an intermediate
//   representation (IR) in parts[].  No layout decisions are made here.
//   Each emitItem callback runs exactly once (captured into a sub-buffer).
//
// PASS 2 — RENDER: toString() calls renderParts(), which traverses the IR
//   left-to-right, tracking the actual column position.  At each flexible
//   node it measures the flat (single-line) length and decides:
//     • flat   — if currentColumn + flatLength ≤ maxLineLength
//     • broken — otherwise
//
// Flexible nodes nest naturally: the renderer recurses into whichever form
// it chose, so inner nodes independently decide their own flat/broken form
// based on the column they actually start at.
//
// FORMATTING RULES (compact-first, coarsest to finest):
//
//   1. Rule definition — try all alternatives on one line:
//        <Name> = alt1 | alt2 | alt3;
//      If it doesn't fit, break at each | with | aligned to the = column:
//        <Name> = alt1
//               | alt2
//               | alt3;
//
//   2. Alternative arrow (->)  — try expression + " -> " + value flat:
//        pattern -> { actionName: "foo", parameters: { x } }
//      If it doesn't fit, -> moves to a new line indented one level:
//        long pattern here
//          -> { actionName: "foo", parameters: { x } }
//      If the value is itself too long, it expands (see rule 3).
//
//   3. Objects and arrays — try flat:
//        { key: val, key2: val2 }    [a, b, c]
//      If flat doesn't fit from the current column, expand:
//        {                           [
//          key: val,                   a,
//          key2: val2                  b,
//        }                           ]
//      Nested objects/arrays apply the same rule recursively.
//
//   4. Inline expression groups (...)  — try flat: (a | b | c)?
//      If flat doesn't fit, break with | aligned to the ( column:
//        (a
//        | b
//        | c)?
//
//   5. Expression sequence wrapping — when a sequence of expression tokens
//      in a single alternative would overflow, tokens wrap to a continuation
//      line indented one level beyond the alt content column, visually
//      distinguishing continuation from a new alternative's | prefix.
//      This applies at two levels:
//        a. Between distinct Expr elements (variables, rule refs, groups,
//           and multi-word string tokens treated as units).
//        b. Within a single multi-word string token: individual words are
//           also wrapped at the same continuation column when needed.
//
// IR NODE TYPES:
//   string      — literal text, never contains "\n"
//   NewlinePart — mandatory newline + indent prefix (from writeNewLine/writeLine)
//   ListPart    — flat-or-broken list; "prefix" style puts the separator before
//                 each non-first item (alternatives with "| "); "suffix" style
//                 appends "," after each non-last item (comma-separated values)
//   BlockPart   — flat-or-broken delimited block ({ } or [ ]); block column is
//                 the actual render-time column, so entries indent correctly
//                 regardless of how deep the block appears in the output
//   GroupPart   — general flat-or-broken pair, used for the -> placement
//
// ─────────────────────────────────────────────────────────────────────────────

type NewlinePart = {
    kind: "newline";
    indent: string; // text written after \n (indent spaces + any prefix)
};

type ListPart = {
    kind: "list";
    items: Part[][]; // each item's captured sub-parts
    flatSep: string; // separator in flat mode (e.g. " | " or ", ")
    // brokenCol: column for continuation newlines in broken mode.
    // Negative value = relative to the render-time column at list start
    // (e.g. -1 means "one column before the list starts", used for inline groups
    //  so that | aligns with the opening parenthesis).
    brokenCol: number;
    linePrefix: string; // text after newline before each non-first item ("| " or "")
    style: "prefix" | "suffix"; // prefix: sep before item; suffix: "," after non-last item
};

type BlockPart = {
    kind: "block";
    items: Part[][]; // each item's captured sub-parts
    flatOpen: string; // "{ " or "[" — delimiter in flat mode
    flatClose: string; // " }" or "]" — delimiter in flat mode
    open: string; // "{" or "[" — delimiter in broken mode (followed by newline)
    close: string; // "}" or "]" — delimiter in broken mode (on its own line)
    flatSep: string; // ", " — separator in flat mode
    // In broken mode: entries at (blockCol + indentSize), close at blockCol.
    // blockCol is determined by the renderer (actual column when block is encountered).
};

type GroupPart = {
    kind: "group";
    flat: Part[]; // rendered when flat form fits within maxLineLength
    broken: Part[]; // rendered when it doesn't
};

type Part = string | NewlinePart | ListPart | BlockPart | GroupPart;

// ─── measureParts ─────────────────────────────────────────────────────────────
// Returns the flat (single-line) character length of a Part array.
// Returns Infinity if the parts contain any mandatory newline (NewlinePart),
// signalling that this construct cannot be rendered flat.

function measureParts(parts: Part[]): number {
    let total = 0;
    for (const part of parts) {
        if (typeof part === "string") {
            total += part.length;
        } else if (part.kind === "newline") {
            return Infinity;
        } else if (part.kind === "group") {
            const m = measureParts(part.flat);
            if (m === Infinity) return Infinity;
            total += m;
        } else if (part.kind === "list") {
            for (let i = 0; i < part.items.length; i++) {
                if (i > 0) total += part.flatSep.length;
                const m = measureParts(part.items[i]);
                if (m === Infinity) return Infinity;
                total += m;
            }
        } else {
            // block
            total += part.flatOpen.length + part.flatClose.length;
            for (let i = 0; i < part.items.length; i++) {
                if (i > 0) total += part.flatSep.length;
                const m = measureParts(part.items[i]);
                if (m === Infinity) return Infinity;
                total += m;
            }
        }
    }
    return total;
}

// ─── renderParts ──────────────────────────────────────────────────────────────
// Traverses the Part IR, tracking the current column, and emits the final string.
// For GroupPart/ListPart/BlockPart it measures the flat form and decides whether
// to render flat or broken based on col + flatLen <= maxLen.

function renderParts(
    parts: Part[],
    col: number,
    maxLen: number,
    indentSize: number,
): { out: string; col: number } {
    let out = "";
    for (const part of parts) {
        if (typeof part === "string") {
            out += part;
            col += part.length;
        } else if (part.kind === "newline") {
            out += "\n" + part.indent;
            col = part.indent.length;
        } else if (part.kind === "group") {
            const flatLen = measureParts(part.flat);
            const chosen =
                flatLen !== Infinity && col + flatLen <= maxLen
                    ? part.flat
                    : part.broken;
            const r = renderParts(chosen, col, maxLen, indentSize);
            out += r.out;
            col = r.col;
        } else if (part.kind === "list") {
            const flatLen = part.items.reduce((n, item, i) => {
                if (n === Infinity) return Infinity;
                const m = measureParts(item);
                return m === Infinity
                    ? Infinity
                    : n + (i > 0 ? part.flatSep.length : 0) + m;
            }, 0);
            if (flatLen !== Infinity && col + flatLen <= maxLen) {
                // flat: items joined by flatSep
                for (let i = 0; i < part.items.length; i++) {
                    if (i > 0) {
                        out += part.flatSep;
                        col += part.flatSep.length;
                    }
                    const r = renderParts(
                        part.items[i],
                        col,
                        maxLen,
                        indentSize,
                    );
                    out += r.out;
                    col = r.col;
                }
            } else {
                // broken
                const brokenCol =
                    part.brokenCol >= 0 ? part.brokenCol : col + part.brokenCol;
                for (let i = 0; i < part.items.length; i++) {
                    if (i > 0 && part.style === "prefix") {
                        const prefix = " ".repeat(brokenCol) + part.linePrefix;
                        out += "\n" + prefix;
                        col = prefix.length;
                    }
                    const r = renderParts(
                        part.items[i],
                        col,
                        maxLen,
                        indentSize,
                    );
                    out += r.out;
                    col = r.col;
                    if (part.style === "suffix" && i < part.items.length - 1) {
                        out += ",\n" + " ".repeat(brokenCol);
                        col = brokenCol;
                    }
                }
            }
        } else {
            // block
            const blockCol = col;
            const entryCol = col + indentSize;
            const flatLen = part.items.reduce((n, item, i) => {
                if (n === Infinity) return Infinity;
                const m = measureParts(item);
                return m === Infinity
                    ? Infinity
                    : n + (i > 0 ? part.flatSep.length : 0) + m;
            }, part.flatOpen.length + part.flatClose.length);
            if (flatLen !== Infinity && col + flatLen <= maxLen) {
                // flat: flatOpen + items joined by flatSep + flatClose
                out += part.flatOpen;
                col += part.flatOpen.length;
                for (let i = 0; i < part.items.length; i++) {
                    if (i > 0) {
                        out += part.flatSep;
                        col += part.flatSep.length;
                    }
                    const r = renderParts(
                        part.items[i],
                        col,
                        maxLen,
                        indentSize,
                    );
                    out += r.out;
                    col = r.col;
                }
                out += part.flatClose;
                col += part.flatClose.length;
            } else {
                // broken: open + newline, each entry at entryCol, close at blockCol
                out += part.open + "\n";
                for (let i = 0; i < part.items.length; i++) {
                    if (i > 0) {
                        out += ",\n";
                    }
                    out += " ".repeat(entryCol);
                    col = entryCol;
                    const r = renderParts(
                        part.items[i],
                        entryCol,
                        maxLen,
                        indentSize,
                    );
                    out += r.out;
                    col = r.col;
                }
                out += "\n" + " ".repeat(blockCol) + part.close;
                col = blockCol + part.close.length;
            }
        }
    }
    return { out, col };
}

// ─── GrammarWriter ────────────────────────────────────────────────────────────

class GrammarWriter {
    private parts: Part[] = [];
    private _column: number = 0;

    constructor(private readonly options?: GrammarWriterOptions) {}

    get column(): number {
        return this._column;
    }

    get maxLineLength(): number {
        return this.options?.maxLineLength ?? 80;
    }

    get indentSize(): number {
        return this.options?.indentSize ?? 2;
    }

    write(text: string): void {
        this.parts.push(text);
        this._column += text.length;
    }

    writeAtColumn(text: string, column: number): void {
        if (this._column > column) {
            this.writeNewLine(" ".repeat(column));
        } else {
            this.write(" ".repeat(column - this._column));
        }
        this.write(text);
    }

    writeNewLine(indent: string): void {
        this.parts.push({ kind: "newline", indent });
        this._column = indent.length;
    }

    writeLine(text?: string): void {
        if (text) {
            this.write(text);
        }
        this.parts.push({ kind: "newline", indent: "" });
        this._column = 0;
    }

    // Runs fn against a temporary parts buffer and returns the captured parts.
    // The caller's parts array and provisional column are unchanged.
    capture(fn: () => void): Part[] {
        const savedParts = this.parts;
        const savedCol = this._column;
        this.parts = [];
        fn();
        const captured = this.parts;
        this.parts = savedParts;
        this._column = savedCol;
        return captured;
    }

    // Appends previously captured parts directly to the current buffer.
    emitParts(parts: Part[]): void {
        for (const p of parts) {
            this.parts.push(p);
        }
        const len = measureParts(parts);
        if (len !== Infinity) {
            this._column += len;
        }
    }

    // Emits a list of items with flat and broken forms.
    //
    // style "prefix": flat → items joined by flatSep; broken → newline +
    //   " ".repeat(brokenCol) + linePrefix before each non-first item.
    //   Used for alternatives (flatSep: " | ", linePrefix: "| ").
    //
    // style "suffix": flat → items joined by flatSep; broken → "," after
    //   each non-last item + newline + " ".repeat(brokenCol) before next.
    //   Used for comma-separated sequences.
    emitList<T>(
        items: T[],
        options: {
            flatSep: string;
            brokenCol: number;
            linePrefix: string;
            style?: "prefix" | "suffix";
            emitItem: (item: T, index: number) => void;
        },
    ): void {
        const captured = items.map((item, i) =>
            this.capture(() => options.emitItem(item, i)),
        );
        this.parts.push({
            kind: "list",
            items: captured,
            flatSep: options.flatSep,
            brokenCol: options.brokenCol,
            linePrefix: options.linePrefix,
            style: options.style ?? "prefix",
        });
        // Update provisional column with flat-length estimate.
        const flatLen = captured.reduce((n, item, i) => {
            if (n === Infinity) return Infinity;
            const m = measureParts(item);
            return m === Infinity
                ? Infinity
                : n + (i > 0 ? options.flatSep.length : 0) + m;
        }, 0);
        if (flatLen !== Infinity) {
            this._column += flatLen;
        }
    }

    // Emits a delimited block (object or array) with flat and broken forms.
    // In flat mode: flatOpen + items joined by flatSep + flatClose.
    // In broken mode: open + newline, each item at (renderCol + indentSize),
    //   "," between items, newline + close at renderCol.
    emitBlock<T>(
        items: T[],
        options: {
            flatOpen: string;
            flatClose: string;
            open: string;
            close: string;
            flatSep: string;
            emitItem: (item: T, index: number) => void;
        },
    ): void {
        const captured = items.map((item, i) =>
            this.capture(() => options.emitItem(item, i)),
        );
        this.parts.push({ kind: "block", items: captured, ...options });
        // Update provisional column with flat-length estimate.
        const flatLen = captured.reduce((n, item, i) => {
            if (n === Infinity) return Infinity;
            const m = measureParts(item);
            return m === Infinity
                ? Infinity
                : n + (i > 0 ? options.flatSep.length : 0) + m;
        }, options.flatOpen.length + options.flatClose.length);
        if (flatLen !== Infinity) {
            this._column += flatLen;
        }
    }

    // Emits a group that tries the flat form first; falls back to broken if
    // the flat form's length would exceed maxLineLength from the current column.
    emitGroup(emitFlat: () => void, emitBroken: () => void): void {
        const flat = this.capture(emitFlat);
        const broken = this.capture(emitBroken);
        this.parts.push({ kind: "group", flat, broken });
        // Update provisional column with flat-length estimate.
        const flatLen = measureParts(flat);
        if (flatLen !== Infinity) {
            this._column += flatLen;
        }
    }

    toString(): string {
        return renderParts(this.parts, 0, this.maxLineLength, this.indentSize)
            .out;
    }
}

// ─── writeGrammarRules ────────────────────────────────────────────────────────

export function writeGrammarRules(
    grammar: GrammarParseResult,
    options?: GrammarWriterOptions,
): string {
    const result = new GrammarWriter(options);
    if (grammar.entities.length > 0) {
        result.writeLine(`entity ${grammar.entities.join(", ")};`);
        result.writeLine();
    }

    if (grammar.imports.length > 0) {
        for (const imp of grammar.imports) {
            const names =
                imp.names === "*" ? "*" : `{ ${imp.names.join(", ")} }`;
            result.writeLine(`import ${names} from "${imp.source}";`);
        }
        result.writeLine();
    }

    for (const def of grammar.definitions) {
        writeRuleDefinition(result, def);
    }

    return result.toString();
}

function writeRuleDefinition(result: GrammarWriter, def: RuleDefinition) {
    result.write(`<${def.name}>`);
    if (def.spacingMode !== undefined) {
        result.write(` [spacing=${def.spacingMode}]`);
    }
    result.write(` = `);
    const col = result.column - 2;
    writeRules(result, def.rules, col);
    result.write(";");
    result.writeLine();
}

function writeRules(result: GrammarWriter, rules: Rule[], col: number) {
    result.emitList(rules, {
        flatSep: " | ",
        brokenCol: col,
        linePrefix: "| ",
        style: "prefix",
        emitItem: (rule) => writeRule(result, rule, col),
    });
}

function writeRule(result: GrammarWriter, rule: Rule, col: number) {
    if (rule.value === undefined) {
        writeExpression(result, rule.expressions, col);
        return;
    }
    // The arrow indent is computed at build time from the known alt-col value.
    const arrowIndent = " ".repeat(col + result.indentSize) + "-> ";
    result.emitGroup(
        // flat: expr -> value  (all on one line)
        () => {
            writeExpression(result, rule.expressions, col);
            result.write(" -> ");
            writeValueNode(result, rule.value!, col);
        },
        // broken: expr (newline at col+indentSize) -> value
        () => {
            writeExpression(result, rule.expressions, col);
            result.writeNewLine(arrowIndent);
            writeValueNode(result, rule.value!, col + result.indentSize + 3);
        },
    );
}

function escapeExpressionString(str: string): string {
    const ret: string[] = [];
    for (const c of str) {
        switch (c) {
            case "\0":
                ret.push("\\0");
                break;
            case "\n":
                ret.push("\\n");
                break;
            case "\r":
                ret.push("\\r");
                break;
            case "\v":
                ret.push("\\v");
                break;
            case "\t":
                ret.push("\\t");
                break;
            case "\b":
                ret.push("\\b");
                break;
            case "\f":
                ret.push("\\f");
                break;
            case "\\":
                ret.push("\\\\");
                break;
            default:
                if (c === " " || isExpressionSpecialChar(c)) {
                    ret.push(`\\${c}`);
                    break;
                }
                // Use unicode escape for other whitespace characters
                if (isWhitespace(c)) {
                    ret.push(`\\u{${c.codePointAt(0)!.toString(16)}}`);
                    break;
                }
                // Note don't need to escape quotes for expressions
                ret.push(c);
                break;
        }
    }
    return ret.join("");
}

// Writes a single Expr item (without the surrounding space logic).
function writeSingleExpr(
    result: GrammarWriter,
    expr: Expr,
    indent: number,
): void {
    switch (expr.type) {
        case "string": {
            // Write words one at a time so long string tokens can wrap at word
            // boundaries, just like writeExpression wraps between Expr elements.
            const continuationCol = indent + 2 + result.indentSize;
            const words = expr.value.map(escapeExpressionString);
            result.write(words[0]);
            for (let i = 1; i < words.length; i++) {
                const word = words[i];
                if (result.column + 1 + word.length > result.maxLineLength) {
                    result.writeNewLine(" ".repeat(continuationCol));
                } else {
                    result.write(" ");
                }
                result.write(word);
            }
            break;
        }
        case "ruleReference":
            result.write(`<${expr.name}>`);
            break;
        case "rules": {
            result.write("(");
            // brokenCol = -1: in broken mode, | aligns with ( which is one column
            // before the list start (render-time col - 1).
            // indent is passed as ruleCol so that -> inside a group aligns
            // consistently with the surrounding alternative's indent level.
            writeRulesAt(result, expr.rules, -1, indent);
            const suffix = expr.repeat
                ? expr.optional
                    ? ")*"
                    : ")+"
                : expr.optional
                  ? ")?"
                  : ")";
            result.write(suffix);
            break;
        }
        case "variable":
            result.write("$(");
            result.write(expr.name);
            if (expr.refName !== "string") {
                result.write(":");
                result.write(
                    expr.ruleReference ? `<${expr.refName}>` : expr.refName,
                );
            }
            result.write(expr.optional ? ")?" : ")");
            break;
    }
}

// Like writeRules but accepts a brokenCol that may be negative (relative to
// render-time column). Used for inline groups so | aligns with (.
// ruleCol is passed to writeRule for -> alignment (distinct from brokenCol).
function writeRulesAt(
    result: GrammarWriter,
    rules: Rule[],
    brokenCol: number,
    ruleCol: number,
) {
    result.emitList(rules, {
        flatSep: " | ",
        brokenCol,
        linePrefix: "| ",
        style: "prefix",
        emitItem: (rule) => writeRule(result, rule, ruleCol),
    });
}

function writeExpression(
    result: GrammarWriter,
    expressions: Expr[],
    indent: number,
): void {
    // Continuation lines for a long expression sequence indent to the same
    // column as the alt content (indent + 2) plus one indentSize, visually
    // separating continuation from the next alternative's | prefix.
    const continuationCol = indent + 2 + result.indentSize;
    let first = true;
    for (const expr of expressions) {
        if (first) {
            writeSingleExpr(result, expr, indent);
            first = false;
        } else {
            // Measure the next expression to decide whether to wrap.
            const nextParts = result.capture(() =>
                writeSingleExpr(result, expr, indent),
            );
            const nextLen = measureParts(nextParts);
            if (
                nextLen !== Infinity &&
                result.column + 1 + nextLen > result.maxLineLength
            ) {
                result.writeNewLine(" ".repeat(continuationCol));
            } else {
                result.write(" ");
            }
            result.emitParts(nextParts);
        }
    }
}

function writeValueNode(result: GrammarWriter, value: ValueNode, col: number) {
    switch (value.type) {
        case "literal":
            result.write(JSON.stringify(value.value));
            break;
        case "variable":
            result.write(value.name);
            break;
        case "object": {
            const entries = Object.entries(value.value);
            if (entries.length === 0) {
                result.write("{}");
                break;
            }
            result.emitBlock(entries, {
                flatOpen: "{ ",
                flatClose: " }",
                open: "{",
                close: "}",
                flatSep: ", ",
                emitItem: ([key, val]) => {
                    if (val === null) {
                        result.write(key);
                    } else {
                        result.write(`${key}: `);
                        writeValueNode(result, val, col + result.indentSize);
                    }
                },
            });
            break;
        }
        case "array": {
            if (value.value.length === 0) {
                result.write("[]");
                break;
            }
            result.emitBlock(value.value, {
                flatOpen: "[",
                flatClose: "]",
                open: "[",
                close: "]",
                flatSep: ", ",
                emitItem: (item) =>
                    writeValueNode(result, item, col + result.indentSize),
            });
            break;
        }
    }
}
