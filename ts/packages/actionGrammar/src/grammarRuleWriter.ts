// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    Comment,
    CommentedName,
    Expr,
    GrammarParseResult,
    isExpressionSpecialChar,
    isObjectSpread,
    isWhitespace,
    Rule,
    RuleDefinition,
    SpacingAnnotationComments,
    ValueNode,
} from "./grammarRuleParser.js";
import { writeValueExprNode } from "./grammarValueExprWriter.js";

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
//                 regardless of how deep the block appears in the output.
//                 If any item has trailing comment text or closing comment lines
//                 are present, the block is forced into broken mode.
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
    // Per-item trailing comment text emitted after "," in broken mode
    // (e.g. " // note" or " /* c */").  When any entry is defined the block
    // is forced into broken mode.
    itemTrailingText?: (string | undefined)[];
    // Comment lines before the closing delimiter (e.g. ["// footer"]).
    // Forces broken mode when present.
    closingLines?: string[];
    flatOpen: string; // "{ " or "[" — delimiter in flat mode
    flatClose: string; // " }" or "]" — delimiter in flat mode
    open: string; // "{" or "[" — delimiter in broken mode (followed by newline)
    close: string; // "}" or "]" — delimiter in broken mode (on its own line)
    flatSep: string; // ", " — separator in flat mode
    // In broken mode: entries at (blockCol + indentSize), close at blockCol.
    // blockCol is determined by the renderer (actual column when block is encountered)
    // unless brokenBaseCol is set, in which case it overrides the render-time column.
    // This lets nested value blocks (e.g. arrays inside object properties) indent
    // relative to the property key column rather than the opening delimiter column.
    brokenBaseCol?: number;
};

type GroupPart = {
    kind: "group";
    flat: Part[]; // rendered when flat form fits within maxLineLength
    broken: Part[]; // rendered when it doesn't
};

// ForceBrokenPart signals Infinity to measureParts (forcing parent list into broken mode)
// but renders as empty string — no extra newline is emitted.
// Used after a rule with a trailing line comment so the list breaks at | without
// adding a blank line between alternatives.
type ForceBrokenPart = { kind: "force-broken" };

type Part =
    | string
    | NewlinePart
    | ListPart
    | BlockPart
    | GroupPart
    | ForceBrokenPart;

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
        } else if (part.kind === "force-broken") {
            return Infinity;
        } else if (part.kind === "list") {
            for (let i = 0; i < part.items.length; i++) {
                if (i > 0) total += part.flatSep.length;
                const m = measureParts(part.items[i]);
                if (m === Infinity) return Infinity;
                total += m;
            }
        } else if (part.kind === "block") {
            // Any comment in a block forces broken mode.
            if (
                part.itemTrailingText?.some((t) => t !== undefined) ||
                part.closingLines?.length
            )
                return Infinity;
            total += part.flatOpen.length + part.flatClose.length;
            for (let i = 0; i < part.items.length; i++) {
                const m = measureParts(part.items[i]);
                if (m === Infinity) return Infinity;
                total += m;
                if (i < part.items.length - 1) total += part.flatSep.length;
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
        } else if (part.kind === "force-broken") {
            // renders as empty string; only exists to force Infinity in measureParts
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
        } else if (part.kind === "block") {
            const blockCol = part.brokenBaseCol ?? col;
            const entryCol = blockCol + indentSize;
            const flatLen = measureParts([part]);
            if (flatLen !== Infinity && col + flatLen <= maxLen) {
                // flat: flatOpen + items + flatClose (no comments in flat mode)
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
                        out += ",";
                        const prevComment = part.itemTrailingText?.[i - 1];
                        if (prevComment) out += prevComment;
                        out += "\n";
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
                if (part.closingLines?.length) {
                    // Trailing comma after last item, then comment lines.
                    if (part.items.length > 0) {
                        out += ",";
                        const lastComment =
                            part.itemTrailingText?.[part.items.length - 1];
                        if (lastComment) out += lastComment;
                        out += "\n";
                    }
                    for (const line of part.closingLines) {
                        out += " ".repeat(entryCol) + line + "\n";
                    }
                } else {
                    const lastComment =
                        part.itemTrailingText?.[part.items.length - 1];
                    if (lastComment) {
                        out += "," + lastComment;
                    }
                    out += "\n";
                }
                out += " ".repeat(blockCol) + part.close;
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

    // Adds a ForceBrokenPart: signals Infinity to measureParts (forcing the enclosing
    // list into broken mode) but renders as empty string (no extra newline).
    writeForceBroken(): void {
        this.parts.push({ kind: "force-broken" });
        // _column unchanged — break renders as empty
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
    // If any item has trailing comment text or closingLines are present,
    // the block is forced into broken mode.
    emitBlock<T>(
        items: T[],
        options: {
            flatOpen: string;
            flatClose: string;
            open: string;
            close: string;
            flatSep: string;
            emitItem: (item: T, index: number) => void;
            getItemTrailingText?: (
                item: T,
                index: number,
            ) => string | undefined;
            closingLines?: string[];
            brokenBaseCol?: number;
        },
    ): void {
        const captured = items.map((item, i) =>
            this.capture(() => options.emitItem(item, i)),
        );
        const itemTrailingText = options.getItemTrailingText
            ? items.map((item, i) => options.getItemTrailingText!(item, i))
            : undefined;
        const blockPart: BlockPart = {
            kind: "block",
            items: captured,
            flatOpen: options.flatOpen,
            flatClose: options.flatClose,
            open: options.open,
            close: options.close,
            flatSep: options.flatSep,
        };
        if (options.brokenBaseCol !== undefined)
            blockPart.brokenBaseCol = options.brokenBaseCol;
        if (itemTrailingText?.some((t) => t !== undefined))
            blockPart.itemTrailingText = itemTrailingText;
        if (options.closingLines?.length)
            blockPart.closingLines = options.closingLines;
        this.parts.push(blockPart);
        // Update provisional column with flat-length estimate.
        const flatLen = measureParts([blockPart]);
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

// ─── Comment helpers ──────────────────────────────────────────────────────────

// Formats a single comment as its canonical text (no surrounding spaces).
function commentText(c: Comment): string {
    return c.style === "line" ? "//" + c.text : "/*" + c.text + "*/";
}

// Writes leading comments, each on its own line, before a construct.
function writeLeadingComments(
    result: GrammarWriter,
    comments: Comment[] | undefined,
): void {
    if (!comments) return;
    for (const c of comments) {
        result.writeLine(commentText(c));
    }
}

// Writes trailing comments inline (no NewlinePart after line comments).
// When forceBroken is true, a ForceBrokenPart is emitted after each line
// comment so that the enclosing list uses broken mode (preventing the |
// from being swallowed by the comment) without adding a blank line.
function writeTrailingComments(
    result: GrammarWriter,
    comments: Comment[] | undefined,
    forceBroken: boolean = false,
): void {
    if (!comments) return;
    for (const c of comments) {
        result.write(" " + commentText(c));
        if (forceBroken && c.style === "line") result.writeForceBroken();
    }
}

// Writes value-adjacent comments (valueLeadingComments / valueTrailingComments).
// Block comments are written inline.  Line comments are written as "// text"
// followed by a mandatory newline at the given indent — causing measureParts to
// return Infinity for the flat form, which forces emitGroup into broken mode.
//
// trailing=false (default, leading position): block comment written as "/* c */ "
//   (trailing space separates from the value that follows).
// trailing=true (trailing position): block comment written as " /* c */"
//   (leading space separates from the preceding value; no trailing space to
//   avoid a double space before the "}" or "," that follows).
function writeValueComments(
    result: GrammarWriter,
    comments: Comment[] | undefined,
    indent: string,
    trailing: boolean = false,
): void {
    if (!comments) return;
    for (const c of comments) {
        if (c.style === "line") {
            result.write(commentText(c));
            result.writeNewLine(indent);
        } else if (trailing) {
            result.write(" " + commentText(c));
        } else {
            result.write(commentText(c) + " ");
        }
    }
}

// Writes comments that appear inline between structural tokens (e.g. inside
// <Name>, [spacing=...], $(...)).  Block comments are written as-is; line
// comments force a newline so the following token starts on the next line.
// When spaced is true, each comment is preceded by a space (for comments
// between rule header tokens like <Name>, [annotation], and =).
function writeInlineComments(
    result: GrammarWriter,
    comments: Comment[] | undefined,
    spaced: boolean = false,
): void {
    if (!comments) return;
    const prefix = spaced ? " " : "";
    for (const c of comments) {
        result.write(prefix + commentText(c));
        if (c.style === "line") result.writeLine();
    }
}

// Writes a [spacing=<mode>] annotation with its interleaved comments.
// When leadingSpace is true, an extra space is written before the opening "[".
function writeSpacingAnnotation(
    result: GrammarWriter,
    spacingMode: string,
    comments: SpacingAnnotationComments | undefined,
    leadingSpace: boolean = false,
): void {
    writeInlineComments(result, comments?.beforeAnnotation, true);
    result.write(leadingSpace ? " [" : "[");
    writeInlineComments(result, comments?.afterBracket);
    result.write("spacing");
    writeInlineComments(result, comments?.afterKey);
    result.write("=");
    writeInlineComments(result, comments?.afterEquals);
    result.write(spacingMode);
    writeInlineComments(result, comments?.afterValue);
    result.write("]");
}

// Formats trailing comments as a single string for use as item trailing text
// in blocks (e.g. " // note" or " /* c */").
function trailingCommentText(
    comments: Comment[] | undefined,
): string | undefined {
    if (!comments?.length) return undefined;
    return comments.map((c) => " " + commentText(c)).join("");
}

// Formats closing comments as an array of lines for use as block closing lines
// (e.g. ["// footer", "/* note */"]).
function closingCommentLines(
    comments: Comment[] | undefined,
): string[] | undefined {
    if (!comments?.length) return undefined;
    return comments.map((c) => commentText(c));
}

// Writes a bracketed name reference: <Name> with inline comments
// around the name for round-trip fidelity.
function writeBracketedName(result: GrammarWriter, name: CommentedName): void {
    result.write("<");
    writeInlineComments(result, name.leadingComments);
    result.write(name.name);
    writeInlineComments(result, name.trailingComments);
    result.write(">");
}

// Writes a single CommentedName with its leading/trailing comments.
// Block comments are written inline; line comments force a newline using the
// given indent (which also forces the enclosing flat form to Infinity, selecting
// the broken layout automatically).
function writeCommentedNameItem(
    result: GrammarWriter,
    n: CommentedName,
    indent: string,
): void {
    writeValueComments(result, n.leadingComments, indent);
    result.write(n.name);
    writeValueComments(result, n.trailingComments, indent, true);
}

// Writes the { Name1, Name2, ... } portion of an import statement using
// emitBlock for flat/broken layout.
// Flat:   import { Name1, Name2 } from "file";
// Broken: import {
//           Name1,
//           Name2,
//         } from "file";
function writeImportNameBlock(
    result: GrammarWriter,
    names: CommentedName[],
): void {
    const entryIndent = " ".repeat(result.indentSize);
    result.emitBlock(names, {
        flatOpen: " { ",
        flatClose: " }",
        open: " {",
        close: "}",
        flatSep: ", ",
        brokenBaseCol: 0,
        emitItem: (n) => {
            writeCommentedNameItem(result, n, entryIndent);
        },
    });
}

// ─── writeGrammarRules ────────────────────────────────────────────────────────

export function writeGrammarRules(
    grammar: GrammarParseResult,
    options?: GrammarWriterOptions,
): string {
    const result = new GrammarWriter(options);

    // File-level leading comments (e.g. copyright header)
    writeLeadingComments(result, grammar.leadingComments);

    if (grammar.imports.length > 0) {
        for (const imp of grammar.imports) {
            writeLeadingComments(result, imp.leadingComments);
            result.write("import");
            writeInlineComments(result, imp.afterImportComments, true);
            if (imp.names === "*") {
                result.write(" *");
                writeInlineComments(result, imp.afterStarComments, true);
            } else {
                writeImportNameBlock(result, imp.names);
                writeInlineComments(result, imp.afterCloseBraceComments, true);
            }
            if (imp.source !== undefined) {
                result.write(" from");
                writeInlineComments(result, imp.afterFromComments, true);
                result.write(` "${imp.source}"`);
            }
            result.write(";");
            writeTrailingComments(result, imp.trailingComments);
            result.writeLine();
        }
        result.writeLine();
    }

    for (const def of grammar.definitions) {
        writeRuleDefinition(result, def);
    }

    // Comments after the last definition (end of file).
    writeLeadingComments(result, grammar.trailingComments);

    return result.toString();
}

function writeRuleDefinition(result: GrammarWriter, def: RuleDefinition) {
    writeLeadingComments(result, def.leadingComments);
    if (def.exported) {
        result.write("export");
        writeInlineComments(result, def.afterExportComments, true);
        result.write(" ");
    }
    writeBracketedName(result, def.definitionName);
    if (def.spacingMode !== undefined) {
        writeSpacingAnnotation(
            result,
            def.spacingMode,
            def.spacingAnnotationComments,
            true,
        );
    }
    if (def.valueType !== undefined) {
        writeInlineComments(result, def.beforeValueTypeComments, true);
        result.write(" :");
        for (let i = 0; i < def.valueType.length; i++) {
            if (i > 0) {
                result.write(" |");
            }
            const vt = def.valueType[i];
            writeInlineComments(result, vt.leadingComments, true);
            result.write(` ${vt.name}`);
            writeInlineComments(result, vt.trailingComments);
        }
    }
    writeInlineComments(result, def.beforeEqualsComments, true);
    result.write(` = `);
    const col = result.column - 2;
    writeRulesAt(result, def.rules, col);
    result.write(";");
    writeTrailingComments(result, def.trailingComments);
    result.writeLine();
}

function writeRule(result: GrammarWriter, rule: Rule, col: number) {
    // Per-alternate spacing annotation: [spacing=mode]
    if (rule.spacingMode !== undefined) {
        writeSpacingAnnotation(
            result,
            rule.spacingMode,
            rule.spacingAnnotationComments,
        );
        result.write(" ");
    }
    if (rule.value === undefined) {
        writeExpression(result, rule.expressions, col);
        writeTrailingComments(result, rule.trailingComments, true);
        return;
    }
    // The arrow indent is computed at build time from the known alt-col value.
    const arrowIndent = " ".repeat(col + result.indentSize) + "-> ";
    // Indent for continuation after a // comment that sits between -> and value.
    const valueIndent = " ".repeat(col + result.indentSize + 3);
    // Write expression + trailing comments before the arrow.
    // forceBroken=true in the flat callback causes measureParts to return
    // Infinity when a trailing line comment is present, selecting broken mode.
    const writeExprPart = (forceBroken: boolean) => {
        writeExpression(result, rule.expressions, col);
        writeTrailingComments(result, rule.trailingComments, forceBroken);
    };
    // Write value leading comments + value node + value trailing comments.
    const writeValuePart = (valueCol: number, forceBroken: boolean) => {
        writeValueComments(result, rule.valueLeadingComments, valueIndent);
        writeValueNode(result, rule.value!, valueCol);
        writeTrailingComments(result, rule.valueTrailingComments, forceBroken);
    };
    result.emitGroup(
        // flat: expr [trailingComments] -> [leading] value [valueTrailing]
        // Line comments in trailing positions make measureParts return Infinity
        // via forceBroken, so the broken form is chosen automatically.
        () => {
            writeExprPart(true);
            result.write(" -> ");
            writeValuePart(col, false);
        },
        // broken: expr [trailingComments] (newline) -> [leading] value [valueTrailing]
        () => {
            writeExprPart(false);
            result.writeNewLine(arrowIndent);
            writeValuePart(col + result.indentSize + 3, false);
        },
    );
    // If any valueTrailing comment is a line comment, force the enclosing
    // alternatives list into broken mode (preventing | from being swallowed
    // by the comment), while rendering as empty string (no blank line).
    if (rule.valueTrailingComments?.some((c) => c.style === "line")) {
        result.writeForceBroken();
    }
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
            writeBracketedName(result, expr.refName);
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
            writeInlineComments(result, expr.variableName.leadingComments);
            result.write(expr.variableName.name);
            writeInlineComments(result, expr.variableName.trailingComments);
            // Emit ": type" if type is not the implicit default "string", OR if
            // colonComments are present (must preserve them for round-trip fidelity).
            if (
                (expr.refName?.name ?? "string") !== "string" ||
                expr.colonComments
            ) {
                result.write(":");
                writeInlineComments(result, expr.colonComments);
                if (expr.ruleReference) {
                    writeBracketedName(result, expr.refName!);
                } else {
                    result.write(expr.refName!.name);
                    writeInlineComments(result, expr.refName?.trailingComments);
                }
            }
            result.write(expr.optional ? ")?" : ")");
            break;
    }
}

// Emits a list of rules (alternatives) with | separators.
// brokenCol controls where | aligns in broken mode (negative = relative to
// render-time column, used for inline groups so | aligns with parenthesis).
// ruleCol (defaults to brokenCol when positive) is passed to writeRule for
// -> alignment, which may differ from brokenCol in inline groups.
function writeRulesAt(
    result: GrammarWriter,
    rules: Rule[],
    brokenCol: number,
    ruleCol: number = brokenCol,
) {
    result.emitList(rules, {
        flatSep: " | ",
        brokenCol,
        linePrefix: "| ",
        style: "prefix",
        emitItem: (rule) => writeRule(result, rule, ruleCol),
    });
}

// Writes an expr's leadingComments (if any) before the expr itself.
// Line comments: write text then a NewlinePart with (indent + 2) spaces so the
// next token lands at the alt content column (indent + 2).  The space that
// writeExpression prepends to non-first exprs lands before the "//" text, not
// after the newline, so (indent + 2) is correct for both first and non-first.
// Block comments: write inline with a trailing space.
function writeExprLeadingComments(
    result: GrammarWriter,
    expr: Expr,
    indent: number,
): void {
    if (!expr.leadingComments) return;
    for (const c of expr.leadingComments) {
        if (c.style === "line") {
            result.write(commentText(c));
            result.writeNewLine(" ".repeat(indent + 2));
        } else {
            result.write(commentText(c) + " ");
        }
    }
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
            writeExprLeadingComments(result, expr, indent);
            writeSingleExpr(result, expr, indent);
            first = false;
        } else {
            // Measure the next expression to decide whether to wrap.
            const nextParts = result.capture(() => {
                writeExprLeadingComments(result, expr, indent);
                writeSingleExpr(result, expr, indent);
            });
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

function writeValueNode(
    result: GrammarWriter,
    value: ValueNode,
    baseCol: number,
) {
    const indent = " ".repeat(baseCol);
    writeValueComments(result, value.leadingComments, indent);
    switch (value.type) {
        case "literal":
            result.write(JSON.stringify(value.value));
            break;
        case "variable":
            result.write(value.name);
            break;
        case "object": {
            const entries = value.value;
            const objClosing = closingCommentLines(value.closingComments);
            if (entries.length === 0 && !objClosing) {
                result.write("{}");
                break;
            }
            const entryIndent = " ".repeat(baseCol + result.indentSize);
            result.emitBlock(entries, {
                flatOpen: "{ ",
                flatClose: " }",
                open: "{",
                close: "}",
                flatSep: ", ",
                brokenBaseCol: baseCol,
                emitItem: (elem) => {
                    writeValueComments(
                        result,
                        elem.leadingComments,
                        entryIndent,
                    );
                    if (isObjectSpread(elem)) {
                        result.write("...");
                        writeValueNode(
                            result,
                            elem.argument,
                            baseCol + result.indentSize,
                        );
                    } else if (elem.value === null) {
                        result.write(elem.key);
                    } else {
                        result.write(`${elem.key}: `);
                        writeValueNode(
                            result,
                            elem.value,
                            baseCol + result.indentSize,
                        );
                    }
                },
                getItemTrailingText: (elem) =>
                    trailingCommentText(elem.trailingComments),
                ...(objClosing ? { closingLines: objClosing } : {}),
            });
            break;
        }
        case "array": {
            const arrClosing = closingCommentLines(value.closingComments);
            if (value.value.length === 0 && !arrClosing) {
                result.write("[]");
                break;
            }
            result.emitBlock(value.value, {
                flatOpen: "[",
                flatClose: "]",
                open: "[",
                close: "]",
                flatSep: ", ",
                brokenBaseCol: baseCol,
                emitItem: (item) =>
                    writeValueNode(
                        result,
                        item.value,
                        baseCol + result.indentSize,
                    ),
                getItemTrailingText: (item) =>
                    trailingCommentText(item.trailingComments),
                ...(arrClosing ? { closingLines: arrClosing } : {}),
            });
            break;
        }
        default:
            // Value expression node — delegate to the expression writer.
            writeValueExprNode(
                {
                    write: (text: string) => result.write(text),
                    writeBase: (node) => writeValueNode(result, node, baseCol),
                },
                value,
            );
            break;
    }
    writeValueComments(result, value.trailingComments, indent, true);
}
