// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    Comment,
    Expr,
    GrammarParseResult,
    isExpressionSpecialChar,
    isWhitespace,
    NameEntry,
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
    // Per-item trailing suffix emitted after "," in broken mode (and inline in
    // flat mode).  Each defined entry is a Part[] for the suffix content (e.g.
    // [" /* c */"]).  Line-comment suffixes include a ForceBrokenPart so that
    // measureParts(suffix) = Infinity → forces the block into broken mode.
    // Undefined entries have no effect.
    itemSuffixes?: (Part[] | undefined)[];
    // Comment lines written after a trailing "," on the last item (or directly
    // inside an empty container), before the closing delimiter.  Each entry is
    // a Part[] representing one comment line.
    //
    // A line-comment line contains a ForceBrokenPart → measureParts(line) = Infinity
    // → the whole footer forces broken mode.  Block-comment lines are finite.
    //
    // Forces broken mode unless ALL of the following hold:
    //   • items.length === 0 (empty container)
    //   • every line measures finite (all block comments)
    // When those hold, flat mode is tried:
    //   flatOpen + [" "] + lines joined by " " + [" "] + flatClose
    footer?: Part[][];
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
            // Line-style suffixes (contain ForceBrokenPart) and non-empty containers
            // with footer force broken mode.
            if (
                part.itemSuffixes?.some(
                    (s) => s !== undefined && measureParts(s) === Infinity,
                )
            )
                return Infinity;
            if (
                part.footer !== undefined &&
                (part.items.length > 0 ||
                    part.footer.some((line) => measureParts(line) === Infinity))
            )
                return Infinity;
            total += part.flatOpen.length + part.flatClose.length;
            for (let i = 0; i < part.items.length; i++) {
                const m = measureParts(part.items[i]);
                if (m === Infinity) return Infinity;
                total += m;
                const suffix = part.itemSuffixes?.[i];
                if (i < part.items.length - 1) {
                    // Separator to next item: use "," + suffix + " " if suffix, else flatSep.
                    total +=
                        suffix !== undefined
                            ? 1 + measureParts(suffix) + 1
                            : part.flatSep.length;
                } else if (suffix !== undefined) {
                    // Last item with block suffix: trailing ", suffix" before close.
                    total += 1 + measureParts(suffix);
                }
            }
            // Footer for EMPTY containers only (non-empty case is broken above).
            // All lines are finite here (line-comment lines were caught above).
            if (part.footer) {
                if (!part.flatOpen.endsWith(" ")) total += 1;
                for (let j = 0; j < part.footer.length; j++) {
                    if (j > 0) total += 1; // space between footer lines
                    total += measureParts(part.footer[j]);
                }
                if (!part.flatClose.startsWith(" ")) total += 1;
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
            const blockCol = col;
            const entryCol = col + indentSize;
            const flatLen = measureParts([part]);
            if (flatLen !== Infinity && col + flatLen <= maxLen) {
                // flat: flatOpen + items (with inline suffixes) + footer (empty only) + flatClose
                out += part.flatOpen;
                col += part.flatOpen.length;
                for (let i = 0; i < part.items.length; i++) {
                    // If the previous item had a block suffix, its "," was already emitted.
                    if (i > 0 && !part.itemSuffixes?.[i - 1]) {
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
                    const suffix = part.itemSuffixes?.[i];
                    if (suffix !== undefined) {
                        out += ",";
                        col += 1;
                        const sr = renderParts(suffix, col, maxLen, indentSize);
                        out += sr.out;
                        col = sr.col;
                        if (i < part.items.length - 1) {
                            // Non-last: space separates from next item
                            out += " ";
                            col += 1;
                        }
                    }
                }
                // Footer only for empty containers (measureParts ensures non-empty stays broken).
                if (part.footer) {
                    if (!part.flatOpen.endsWith(" ")) {
                        out += " ";
                        col += 1;
                    }
                    for (let j = 0; j < part.footer.length; j++) {
                        if (j > 0) {
                            out += " ";
                            col += 1;
                        }
                        const r = renderParts(
                            part.footer[j],
                            col,
                            maxLen,
                            indentSize,
                        );
                        out += r.out;
                        col = r.col;
                    }
                    if (!part.flatClose.startsWith(" ")) {
                        out += " ";
                        col += 1;
                    }
                }
                out += part.flatClose;
                col += part.flatClose.length;
            } else {
                // broken: open + newline, each entry at entryCol, close at blockCol
                out += part.open + "\n";
                for (let i = 0; i < part.items.length; i++) {
                    if (i > 0) {
                        out += ",";
                        col += 1;
                        // Inject per-item trailing suffix (e.g. " // comment")
                        // between the "," and the "\n".
                        const prevSuffix = part.itemSuffixes?.[i - 1];
                        if (prevSuffix) {
                            const sr = renderParts(
                                prevSuffix,
                                col,
                                maxLen,
                                indentSize,
                            );
                            out += sr.out;
                            col = sr.col;
                        }
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
                if (part.footer) {
                    // Trailing comma after last item (if any), then footer comment lines.
                    if (part.items.length > 0) {
                        out += ",";
                        col += 1;
                        const lastSuffix =
                            part.itemSuffixes?.[part.items.length - 1];
                        if (lastSuffix) {
                            const sr = renderParts(
                                lastSuffix,
                                col,
                                maxLen,
                                indentSize,
                            );
                            out += sr.out;
                            col = sr.col;
                        }
                        out += "\n";
                    }
                    for (const line of part.footer) {
                        out += " ".repeat(entryCol);
                        col = entryCol;
                        const r = renderParts(
                            line,
                            entryCol,
                            maxLen,
                            indentSize,
                        );
                        out += r.out;
                        col = r.col;
                        out += "\n";
                    }
                } else {
                    // No footer, but the last item may still have a trailing
                    // comma + suffix (e.g. "a", // comment).
                    const lastSuffix =
                        part.itemSuffixes?.[part.items.length - 1];
                    if (lastSuffix !== undefined) {
                        out += ",";
                        col += 1;
                        const sr = renderParts(
                            lastSuffix,
                            col,
                            maxLen,
                            indentSize,
                        );
                        out += sr.out;
                        col = sr.col;
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
    emitBlock<T>(
        items: T[],
        options: {
            flatOpen: string;
            flatClose: string;
            open: string;
            close: string;
            flatSep: string;
            emitItem: (item: T, index: number) => void;
            // Optional: return a suffix Part[] (e.g. [" // comment", {kind:"break"}])
            // emitted after the "," separator in broken mode for item[i].
            // A line-comment suffix (contains ForceBrokenPart) forces broken mode.
            getItemSuffix?: (item: T, index: number) => Part[] | undefined;
            // Optional comment lines after a trailing "," on the last item (or
            // directly inside an empty container), before the closing delimiter.
            // Each entry is a Part[] for one comment line.  See BlockPart.footer.
            footer?: Part[][];
        },
    ): void {
        const captured = items.map((item, i) =>
            this.capture(() => options.emitItem(item, i)),
        );
        const itemSuffixes = options.getItemSuffix
            ? items.map((item, i) => options.getItemSuffix!(item, i))
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
        if (itemSuffixes) blockPart.itemSuffixes = itemSuffixes;
        if (options.footer) blockPart.footer = options.footer;
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

// Writes leading comments, each on its own line, before a construct.
function writeLeadingComments(
    result: GrammarWriter,
    comments: Comment[] | undefined,
): void {
    if (!comments) return;
    for (const c of comments) {
        if (c.style === "line") {
            result.writeLine("//" + c.text);
        } else {
            result.writeLine("/*" + c.text + "*/");
        }
    }
}

// Writes trailing comments inline (no NewlinePart after line comments).
// The caller is responsible for adding a writeForceBroken() after any line
// comment so the enclosing list uses broken mode (preventing the | from being
// swallowed by the comment) without adding a blank line between alternatives.
function writeTrailingComments(
    result: GrammarWriter,
    comments: Comment[] | undefined,
): void {
    if (!comments) return;
    for (const c of comments) {
        if (c.style === "line") {
            result.write(" //" + c.text);
        } else {
            result.write(" /*" + c.text + "*/");
        }
    }
}

// Writes a trailing-comment array on the same line as the preceding token.
// (Formerly writeTrailingComment for a single Comment; now accepts the array
// directly to match the updated AST types.)

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
            result.write("//" + c.text);
            result.writeNewLine(indent);
        } else if (trailing) {
            result.write(" /*" + c.text + "*/");
        } else {
            result.write("/*" + c.text + "*/ ");
        }
    }
}

// Writes comments that appear inline between structural tokens (e.g. inside
// <Name>, [spacing=...], $(...)).  Block comments are written as-is; line
// comments force a newline so the following token starts on the next line
// (same logic as writeRuleHeaderComments).
function writeInlineComments(
    result: GrammarWriter,
    comments: Comment[] | undefined,
): void {
    if (!comments) return;
    for (const c of comments) {
        if (c.style === "line") {
            result.write("//" + c.text);
            result.writeLine();
        } else {
            result.write("/*" + c.text + "*/");
        }
    }
}

// ─── writeGrammarRules ────────────────────────────────────────────────────────

export function writeGrammarRules(
    grammar: GrammarParseResult,
    options?: GrammarWriterOptions,
): string {
    const result = new GrammarWriter(options);

    // File-level leading comments (e.g. copyright header)
    writeLeadingComments(result, grammar.leadingComments);

    // Entity declarations — use entityDeclarations if present (preserves comments),
    // fall back to flat entities array for backward compat with hand-crafted results.
    const entityDeclarations = grammar.entityDeclarations;
    if (entityDeclarations && entityDeclarations.length > 0) {
        for (const decl of entityDeclarations) {
            writeLeadingComments(result, decl.leadingComments);
            result.write("entity");
            for (let i = 0; i < decl.names.length; i++) {
                const entry: NameEntry = decl.names[i];
                if (i > 0) result.write(",");
                // leading comments before this name (with space prefix)
                if (entry.leadingComments) {
                    for (const c of entry.leadingComments) {
                        result.write(` /*${c.text}*/`);
                    }
                }
                result.write(` ${entry.name}`);
                // trailing comments after name, before "," or ";"
                if (entry.trailingComments) {
                    for (const tc of entry.trailingComments) {
                        result.write(
                            tc.style === "line"
                                ? ` //${tc.text}`
                                : ` /*${tc.text}*/`,
                        );
                    }
                }
            }
            result.write(";");
            writeTrailingComments(result, decl.trailingComments);
            result.writeLine();
        }
        result.writeLine();
    } else if (grammar.entities.length > 0) {
        result.writeLine(`entity ${grammar.entities.join(", ")};`);
        result.writeLine();
    }

    if (grammar.imports.length > 0) {
        for (const imp of grammar.imports) {
            writeLeadingComments(result, imp.leadingComments);
            result.write("import");
            writeRuleHeaderComments(result, imp.afterImportComments);
            if (imp.names === "*") {
                result.write(" *");
                writeRuleHeaderComments(result, imp.afterStarComments);
            } else {
                result.write(" {");
                for (let i = 0; i < imp.names.length; i++) {
                    const entry: NameEntry = imp.names[i];
                    if (i > 0) result.write(",");
                    // leading comments before this name (with space prefix)
                    if (entry.leadingComments) {
                        for (const c of entry.leadingComments) {
                            result.write(` /*${c.text}*/`);
                        }
                    }
                    result.write(` ${entry.name}`);
                    // trailing comments after name, before "," or "}"
                    if (entry.trailingComments) {
                        for (const tc of entry.trailingComments) {
                            result.write(
                                tc.style === "line"
                                    ? ` //${tc.text}`
                                    : ` /*${tc.text}*/`,
                            );
                        }
                    }
                }
                result.write(" }");
                writeRuleHeaderComments(result, imp.afterCloseBraceComments);
            }
            result.write(" from");
            writeRuleHeaderComments(result, imp.afterFromComments);
            result.write(` "${imp.source}";`);
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

// Writes comments that appear inline within a rule header (between <Name>, [annotation], and =).
// Block comments are written inline; line comments end the current line.
function writeRuleHeaderComments(
    result: GrammarWriter,
    comments: Comment[] | undefined,
): void {
    if (!comments) return;
    for (const c of comments) {
        if (c.style === "line") {
            result.write(" //" + c.text);
            result.writeLine();
        } else {
            result.write(" /*" + c.text + "*/");
        }
    }
}

function writeRuleDefinition(result: GrammarWriter, def: RuleDefinition) {
    writeLeadingComments(result, def.leadingComments);
    result.write("<");
    writeInlineComments(result, def.bracketedName.leadingComments);
    result.write(def.bracketedName.name);
    writeInlineComments(result, def.bracketedName.trailingComments);
    result.write(">");
    writeRuleHeaderComments(result, def.beforeAnnotationComments);
    if (def.spacingMode !== undefined) {
        result.write(" [");
        writeInlineComments(result, def.annotationAfterBracketComments);
        result.write("spacing");
        writeInlineComments(result, def.annotationAfterKeyComments);
        result.write("=");
        writeInlineComments(result, def.annotationAfterEqualsComments);
        result.write(def.spacingMode);
        writeInlineComments(result, def.annotationAfterValueComments);
        result.write("]");
    }
    writeRuleHeaderComments(result, def.beforeEqualsComments);
    result.write(` = `);
    const col = result.column - 2;
    writeRules(result, def.rules, col);
    result.write(";");
    writeTrailingComments(result, def.trailingComments);
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

// Writes rule.trailingComments (comments after expressions, before | or ;).
// Line comments: write text + ForceBrokenPart — forces the enclosing alternatives
// list into broken mode without emitting a NewlinePart, so the list's own
// "\n" + prefix produces exactly one newline (no blank line between alts).
// Block comments: write inline.
function writeRuleTrailingComments(
    result: GrammarWriter,
    comments: Comment[] | undefined,
): void {
    if (!comments) return;
    for (const c of comments) {
        if (c.style === "line") {
            result.write(" //" + c.text);
            result.writeForceBroken();
        } else {
            result.write(" /*" + c.text + "*/");
        }
    }
}

function writeRule(result: GrammarWriter, rule: Rule, col: number) {
    if (rule.value === undefined) {
        writeExpression(result, rule.expressions, col);
        writeRuleTrailingComments(result, rule.trailingComments);
        return;
    }
    // The arrow indent is computed at build time from the known alt-col value.
    const arrowIndent = " ".repeat(col + result.indentSize) + "-> ";
    // Indent for continuation after a // comment that sits between -> and value.
    const valueIndent = " ".repeat(col + result.indentSize + 3);
    const hasLineTrailing = rule.trailingComments?.some(
        (c) => c.style === "line",
    );
    result.emitGroup(
        // flat: expr [trailingComments] -> [leading] value [valueTrailing]
        // A line trailingComment or leading value comment makes measureParts
        // return Infinity → broken is chosen automatically.
        () => {
            writeExpression(result, rule.expressions, col);
            writeTrailingComments(result, rule.trailingComments);
            if (hasLineTrailing) result.writeForceBroken(); // force Infinity in flat
            result.write(" -> ");
            writeValueComments(result, rule.valueLeadingComments, valueIndent);
            writeValueNode(result, rule.value!, col);
            writeTrailingComments(result, rule.valueTrailingComments);
        },
        // broken: expr [trailingComments] (newline) -> [leading] value [valueTrailing]
        () => {
            writeExpression(result, rule.expressions, col);
            writeTrailingComments(result, rule.trailingComments);
            result.writeNewLine(arrowIndent);
            writeValueComments(result, rule.valueLeadingComments, valueIndent);
            writeValueNode(result, rule.value!, col + result.indentSize + 3);
            writeTrailingComments(result, rule.valueTrailingComments);
        },
    );
    // If any valueTrailing comment is a line comment, add a ForceBrokenPart so the
    // enclosing alternatives list uses broken mode (preventing | from being
    // swallowed by the comment), while rendering as empty string (no blank line).
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
            result.write("<");
            writeInlineComments(result, expr.bracketedName.leadingComments);
            result.write(expr.bracketedName.name);
            writeInlineComments(result, expr.bracketedName.trailingComments);
            result.write(">");
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
            writeInlineComments(result, expr.dollarParenComments);
            result.write(expr.name);
            // Emit ": type" if type is not the implicit default "string", OR if
            // colonComments are present (must preserve them for round-trip fidelity).
            if (
                (expr.bracketedRefName?.name ?? "string") !== "string" ||
                expr.colonComments
            ) {
                result.write(":");
                writeInlineComments(result, expr.colonComments);
                if (expr.ruleReference) {
                    result.write("<");
                    writeInlineComments(
                        result,
                        expr.bracketedRefName?.leadingComments,
                    );
                    result.write(expr.bracketedRefName!.name);
                    writeInlineComments(
                        result,
                        expr.bracketedRefName?.trailingComments,
                    );
                    result.write(">");
                } else {
                    result.write(expr.bracketedRefName!.name);
                    writeInlineComments(
                        result,
                        expr.bracketedRefName?.trailingComments,
                    );
                }
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
            result.write("//" + c.text);
            result.writeNewLine(" ".repeat(indent + 2));
        } else {
            result.write("/*" + c.text + "*/ ");
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

function writeValueNode(result: GrammarWriter, value: ValueNode, col: number) {
    const indent = " ".repeat(col);
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
            const objFooter: Part[][] | undefined = value.closingComments?.map(
                (c): Part[] =>
                    c.style === "line"
                        ? ["//" + c.text, { kind: "force-broken" }]
                        : ["/*" + c.text + "*/"],
            );
            if (entries.length === 0 && !objFooter) {
                result.write("{}");
                break;
            }
            const entryIndent = " ".repeat(col + result.indentSize);
            result.emitBlock(entries, {
                flatOpen: "{ ",
                flatClose: " }",
                open: "{",
                close: "}",
                flatSep: ", ",
                emitItem: (prop) => {
                    writeValueComments(
                        result,
                        prop.leadingComments,
                        entryIndent,
                    );
                    if (prop.value === null) {
                        result.write(prop.key);
                    } else {
                        result.write(`${prop.key}: `);
                        writeValueNode(
                            result,
                            prop.value,
                            col + result.indentSize,
                        );
                    }
                },
                getItemSuffix: (prop): Part[] | undefined => {
                    if (!prop.trailingComments) return undefined;
                    const parts: Part[] = [];
                    for (const c of prop.trailingComments) {
                        if (c.style === "line") {
                            parts.push(" //" + c.text, {
                                kind: "force-broken",
                            });
                        } else {
                            parts.push(" /*" + c.text + "*/");
                        }
                    }
                    return parts;
                },
                ...(objFooter ? { footer: objFooter } : {}),
            });
            break;
        }
        case "array": {
            const arrFooter: Part[][] | undefined = value.closingComments?.map(
                (c): Part[] =>
                    c.style === "line"
                        ? ["//" + c.text, { kind: "force-broken" }]
                        : ["/*" + c.text + "*/"],
            );
            if (value.value.length === 0 && !arrFooter) {
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
                    writeValueNode(result, item.value, col + result.indentSize),
                getItemSuffix: (item): Part[] | undefined => {
                    if (!item.trailingComments) return undefined;
                    const parts: Part[] = [];
                    for (const c of item.trailingComments) {
                        if (c.style === "line") {
                            parts.push(" //" + c.text, {
                                kind: "force-broken",
                            });
                        } else {
                            parts.push(" /*" + c.text + "*/");
                        }
                    }
                    return parts;
                },
                ...(arrFooter ? { footer: arrFooter } : {}),
            });
            break;
        }
    }
    writeValueComments(result, value.trailingComments, indent, true);
}
