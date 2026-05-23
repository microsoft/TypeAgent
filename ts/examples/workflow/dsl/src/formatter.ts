// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Workflow DSL formatter (AST -> source).
 *
 * Round-trips a parsed `WorkflowDecl` back to canonical DSL text. Preserves
 * `leadingComments` attached to AST nodes (see "Comments not preserved in
 * AST" in docs/design/workflowSystem/dsl/dsl-v0.1-gap.md and dsl-v0.1.md
 * section 6).
 *
 * Goals:
 * - Output is parseable: `parse(format(parse(src))) === parse(src)` for
 *   ASTs that don't depend on lost trivia (whitespace between tokens).
 * - Stable: formatting is deterministic and does not depend on input
 *   whitespace.
 * - Comments preserved in their attached positions.
 *
 * Non-goals:
 * - Byte-for-byte preservation of the input (whitespace and comment
 *   column positions may change).
 * - Configurable formatting beyond a small set of options.
 */

import {
    WorkflowDecl,
    Module,
    ImportDecl,
    ParamDecl,
    TypeExpr,
    Statement,
    Expr,
    TaskArg,
    ObjectEntry,
    BinaryOp,
    Comment,
    AttemptsNode,
    MapNode,
    FilterNode,
    ParallelNode,
    ParallelMapNode,
} from "./ast.js";
import { quoteStringLiteral } from "./literal.js";

export interface FormatOptions {
    /** Number of spaces per indent level. Non-negative integer. Default 4. */
    indent?: number;
    /** Line ending. Must be `"\n"`, `"\r\n"`, or `"\r"`. Default `"\n"`. */
    eol?: string;
    /** Soft column limit used by layout heuristics. When the AST does
     *  not constrain a layout choice (e.g. no comments forcing a break
     *  and the original source used inline), the formatter will use
     *  inline iff the projected single-line width is <= printWidth.
     *  Must be a non-negative integer or `Infinity`. Default 100. Set
     *  to `Infinity` to never wrap based on width; set to `0` to
     *  always wrap when an alternative multi-line layout exists. */
    printWidth?: number;
    /** When `true`, a single blank line is emitted before any statement
     *  that had at least one blank line before it in the original source.
     *  Multiple consecutive blank lines are collapsed to one. Default `true`.
     *  Set to `false` to strip blank lines for compact deterministic output. */
    keepBlankLines?: boolean;
}

interface ResolvedOptions {
    indent: number;
    eol: string;
    printWidth: number;
    keepBlankLines: boolean;
}

/**
 * Format a parsed `Module` (imports plus one or more workflow
 * declarations) back to DSL source text. This is the canonical
 * formatter entry point.
 */
export function formatModule(module: Module, options?: FormatOptions): string {
    const opts: ResolvedOptions = {
        indent: options?.indent ?? 4,
        eol: options?.eol ?? "\n",
        printWidth: options?.printWidth ?? 100,
        keepBlankLines: options?.keepBlankLines ?? true,
    };
    validateFormatOptions(opts);
    const p = new Printer(opts);
    p.printModule(module);
    return p.toString();
}

/**
 * Validate resolved FormatOptions. Throws RangeError / TypeError with a
 * clear message rather than letting downstream `String.prototype.repeat`
 * or arithmetic failures bubble up as opaque exceptions.
 *
 * Contract:
 * - `indent`: finite integer, >= 0.
 * - `eol`: string containing only line-terminator characters
 *   (`"\n"`, `"\r\n"`, or `"\r"`). Must be non-empty — an empty `eol`
 *   would collapse every statement onto one line and break round-trip.
 * - `printWidth`: number > 0 (Infinity is allowed; finite values must
 *   be a positive integer).
 */
function validateFormatOptions(opts: ResolvedOptions): void {
    if (
        typeof opts.indent !== "number" ||
        !Number.isFinite(opts.indent) ||
        !Number.isInteger(opts.indent) ||
        opts.indent < 0
    ) {
        throw new RangeError(
            `FormatOptions.indent must be a non-negative integer, got ${String(opts.indent)}`,
        );
    }
    if (typeof opts.eol !== "string") {
        throw new TypeError(
            `FormatOptions.eol must be a string, got ${typeof opts.eol}`,
        );
    }
    if (opts.eol.length === 0) {
        throw new RangeError(
            `FormatOptions.eol must be non-empty (use "\\n", "\\r\\n", or "\\r")`,
        );
    }
    if (!/^(\r\n|\n|\r)$/.test(opts.eol)) {
        throw new RangeError(
            `FormatOptions.eol must be "\\n", "\\r\\n", or "\\r", got ${JSON.stringify(opts.eol)}`,
        );
    }
    if (typeof opts.printWidth !== "number" || Number.isNaN(opts.printWidth)) {
        throw new TypeError(
            `FormatOptions.printWidth must be a number, got ${String(opts.printWidth)}`,
        );
    }
    if (opts.printWidth < 0) {
        throw new RangeError(
            `FormatOptions.printWidth must be >= 0, got ${opts.printWidth}`,
        );
    }
    if (
        Number.isFinite(opts.printWidth) &&
        !Number.isInteger(opts.printWidth)
    ) {
        throw new RangeError(
            `FormatOptions.printWidth must be an integer (or Infinity), got ${opts.printWidth}`,
        );
    }
}

class Printer {
    private parts: string[] = [];
    private depth = 0;
    private atLineStart = true;
    /** Tracked column position of the cursor (0-based). Maintained
     *  incrementally by `write()` / `newline()` so `currentColumn()` is
     *  O(1) and `measure()` doesn't pay an O(parts) scan per call. */
    private col = 0;

    constructor(private opts: ResolvedOptions) {}

    toString(): string {
        // Ensure trailing newline.
        const text = this.parts.join("");
        return text.endsWith(this.opts.eol) ? text : text + this.opts.eol;
    }

    // ---- Low-level emit ----

    private write(s: string): void {
        if (s.length === 0) return;
        if (this.atLineStart) {
            const pad = this.depth * this.opts.indent;
            this.parts.push(" ".repeat(pad));
            this.col = pad;
            this.atLineStart = false;
        }
        this.parts.push(s);
        // Update column to position after the last newline in `s`, if any.
        const eol = this.opts.eol;
        const idx = s.lastIndexOf(eol);
        if (idx >= 0) {
            this.col = s.length - idx - eol.length;
        } else {
            this.col += s.length;
        }
    }

    private newline(): void {
        this.parts.push(this.opts.eol);
        this.atLineStart = true;
        this.col = 0;
    }

    private line(s: string): void {
        this.write(s);
        this.newline();
    }

    private indent<T>(fn: () => T): T {
        this.depth++;
        try {
            return fn();
        } finally {
            this.depth--;
        }
    }

    /**
     * Return the current column position on the line being built (0-based).
     * If we're at line start, returns the implicit indent that the next
     * `write` would produce. O(1): the column is tracked incrementally.
     */
    private currentColumn(): number {
        if (this.atLineStart) return this.depth * this.opts.indent;
        return this.col;
    }

    /**
     * Run `fn` against a temporary copy of the printer state and return
     * the maximum line length of the produced text (relative to the
     * column where `fn` was invoked). Caller's state is restored.
     * Used by layout heuristics to decide between inline and multi-line
     * renderings.
     */
    private measure(fn: () => void): number {
        const savedParts = this.parts;
        const savedDepth = this.depth;
        const savedAtLineStart = this.atLineStart;
        const savedCol = this.col;
        const startCol = this.currentColumn();
        this.parts = [];
        try {
            fn();
        } finally {
            const out = this.parts.join("");
            this.parts = savedParts;
            this.depth = savedDepth;
            this.atLineStart = savedAtLineStart;
            this.col = savedCol;
            const lines = out.split(this.opts.eol);
            let max = 0;
            for (let i = 0; i < lines.length; i++) {
                const len = (i === 0 ? startCol : 0) + lines[i].length;
                if (len > max) max = len;
            }
            return max;
        }
    }

    /**
     * Emit a multi-line comment whose text contains embedded newlines.
     * The first line is written through `write()` so the current indent
     * is applied; subsequent lines are pushed verbatim (preserving the
     * comment's own internal alignment) without prepending another
     * indent. Failing to do this would accumulate `depth * indent`
     * spaces on the comment's continuation lines on every reformat.
     */
    private writeMultilineCommentText(text: string): void {
        const lines = text.split("\n");
        this.write(lines[0]);
        for (let i = 1; i < lines.length; i++) {
            this.parts.push(this.opts.eol);
            this.parts.push(lines[i]);
            this.atLineStart = false;
            this.col = lines[i].length;
        }
    }

    /**
     * Emit a single comment, inline (one space gap, no surrounding
     * newlines) or on its own line at the current indent. Multi-line
     * block comments preserve their internal alignment.
     */
    private writeCommentInline(c: Comment): void {
        this.write(" ");
        if (c.text.includes("\n")) {
            this.writeMultilineCommentText(c.text);
        } else {
            this.write(c.text);
        }
    }

    private writeCommentOwnLine(c: Comment): void {
        if (c.text.includes("\n")) {
            this.writeMultilineCommentText(c.text);
            this.newline();
        } else {
            this.line(c.text);
        }
    }

    private printLeadingComments(comments: Comment[] | undefined): void {
        if (!comments?.length) return;
        for (const c of comments) this.writeCommentOwnLine(c);
    }

    /**
     * Emit any inline trailing comments for `s`, then a newline, then any
     * subsequent-line trailing comments. Used after writing the
     * statement's terminator text.
     */
    private endStmtTrailers(s: Statement): void {
        const trailing = s.trailingComments;
        if (!trailing?.length) {
            this.newline();
            return;
        }
        const endLine = s.endLine;
        const inline: Comment[] = [];
        const after: Comment[] = [];
        for (const c of trailing) {
            if (endLine !== undefined && c.pos.line === endLine) {
                inline.push(c);
            } else {
                after.push(c);
            }
        }
        for (const c of inline) this.writeCommentInline(c);
        this.newline();
        for (const c of after) this.writeCommentOwnLine(c);
    }

    /**
     * End a statement: write the terminator (e.g. `;` or `}`), then any
     * trailing comments + closing newline via `endStmtTrailers`.
     */
    private endStmtWith(s: Statement, terminator: string): void {
        this.write(terminator);
        this.endStmtTrailers(s);
    }

    /**
     * End a statement that has already emitted its own terminator (for
     * example `break;` or an `if`-without-else). Just emits trailing
     * comments + newline.
     */
    private endStmtAfter(s: Statement): void {
        this.endStmtTrailers(s);
    }

    /** Emit a list of comments each on its own line at the current indent. */
    private printOwnLineComments(comments: Comment[] | undefined): void {
        if (!comments?.length) return;
        for (const c of comments) this.writeCommentOwnLine(c);
    }

    /**
     * Emit comments that sit between the `}` of the then-branch and the
     * `else` keyword, then either a separator space or a newline so the
     * caller can write `"else "`.
     *
     * Rules:
     *   - If any captured comment is a `//` line comment, we MUST break
     *     before `else` (line comments terminate at EOL by definition).
     *   - Else if the caller's `forceNewLine` is true (set when the AST
     *     records `elseOnNewLine` or the inline projection won't fit
     *     printWidth), emit each block comment on its own line and
     *     break before `else`.
     *   - Else emit the block comments inline (` /* x *\/ ` style),
     *     space-separated, and let `else` follow on the same line.
     */
    private writeElseLeading(
        comments: Comment[] | undefined,
        forceNewLine: boolean,
    ): void {
        if (!comments?.length) {
            if (forceNewLine) {
                this.newline();
            } else {
                this.write(" ");
            }
            return;
        }
        const hasLineComment = comments.some((c) => c.text.startsWith("//"));
        if (!hasLineComment && !forceNewLine) {
            for (const c of comments) this.writeCommentInline(c);
            this.write(" ");
            return;
        }
        // Break before each comment, then drop `else` on a fresh line
        // at the current indent.
        for (const c of comments) {
            this.writeCommentInline(c);
            this.newline();
        }
    }

    // ---- Module / imports ----

    /**
     * Emit a complete module: any imports first, then each workflow
     * declaration separated by a blank line. A blank line also
     * separates the imports block from the first workflow when both
     * are present.
     */
    printModule(module: Module): void {
        for (const imp of module.imports) {
            this.printImport(imp);
        }
        if (module.imports.length > 0 && module.workflows.length > 0) {
            this.newline();
        }
        module.workflows.forEach((wf, i) => {
            if (i > 0) this.newline();
            this.printWorkflow(wf);
        });
    }

    /**
     * Emit a single `import { name, other as alias } from "./path";`
     * declaration. Leading comments attached to the import are emitted
     * on their own lines above the statement.
     */
    private printImport(decl: ImportDecl): void {
        this.printLeadingComments(decl.leadingComments);
        this.write("import { ");
        decl.names.forEach((s, i) => {
            if (i > 0) this.write(", ");
            this.write(s.name);
            if (s.alias !== undefined) this.write(` as ${s.alias}`);
        });
        this.write(" } from ");
        this.write(quoteStringLiteral(decl.source));
        this.line(";");
    }

    // ---- Workflow ----

    printWorkflow(decl: WorkflowDecl): void {
        this.printLeadingComments(decl.leadingComments);
        if (decl.exported) this.write("export ");
        this.write(`workflow ${decl.name}(`);
        this.printParamList(decl, decl.params, decl.paramInnerComments);
        this.write("): ");
        this.printType(decl.returnType);
        this.write(" {");
        this.newline();
        this.indent(() => {
            for (const s of decl.body) this.printStatement(s);
            this.printOwnLineComments(decl.innerComments);
        });
        this.line("}");
        // Trailing comments after the closing `}` (between `}` and EOF).
        if (decl.trailingComments?.length) {
            for (const c of decl.trailingComments) this.writeCommentOwnLine(c);
        }
    }

    /**
     * Print the parameter list. Layout rules (in priority order):
     *   1. If any param has comments or `paramInnerComments` is set, must
     *      be multi-line (the comments need linebreaks to live on).
     *   2. Else if the AST records `paramListMultiLine` (the original
     *      source used multi-line), preserve that layout — UNLESS the
     *      projected single-line width comfortably fits in `printWidth`,
     *      in which case collapse to inline. (We collapse only when the
     *      single-line form is strictly shorter, to avoid oscillation.)
     *   3. Else if the projected inline width exceeds `printWidth`,
     *      switch to multi-line.
     *   4. Otherwise, inline.
     */
    private printParamList(
        decl: WorkflowDecl,
        params: ParamDecl[],
        paramInner: Comment[] | undefined,
    ): void {
        const hasParamComments = params.some(
            (p) => p.leadingComments?.length || p.trailingComments?.length,
        );
        const hasInner = !!paramInner?.length;
        const forcedMultiLine = hasParamComments || hasInner;

        // Measure the inline-projected width if we might choose inline.
        // The projection covers `p1: T, p2: T): RT {` (closing-paren
        // through brace) so we accurately decide whether the full first
        // line fits.
        let inlineFits = true;
        if (!forcedMultiLine) {
            const projected = this.measure(() => {
                params.forEach((p, i) => {
                    if (i > 0) this.write(", ");
                    this.printParam(p);
                });
                this.write("): ");
                this.printType(decl.returnType);
                this.write(" {");
            });
            inlineFits = projected <= this.opts.printWidth;
        }

        const useMultiLine =
            forcedMultiLine || decl.paramListMultiLine === true || !inlineFits;

        if (!useMultiLine) {
            params.forEach((p, i) => {
                if (i > 0) this.write(", ");
                this.printParam(p);
            });
            return;
        }
        this.newline();
        this.indent(() => {
            this.printCommentedCommaList(params, paramInner, (p) =>
                this.printParam(p),
            );
        });
    }

    /**
     * Emit only the trailing comments that originated on the same source
     * line as the host node, prefixed by a space. Caller is responsible
     * for the newline.
     */
    private emitInlineTrailing(
        trailing: Comment[] | undefined,
        endLine: number | undefined,
    ): void {
        if (!trailing?.length) return;
        for (const c of trailing) {
            if (endLine !== undefined && c.pos.line === endLine) {
                this.writeCommentInline(c);
            }
        }
    }

    /**
     * Emit the trailing comments that originated on subsequent source
     * lines, each on its own line at the current indent.
     */
    private emitAfterLineTrailing(
        trailing: Comment[] | undefined,
        endLine: number | undefined,
    ): void {
        if (!trailing?.length) return;
        for (const c of trailing) {
            if (endLine === undefined || c.pos.line !== endLine) {
                this.writeCommentOwnLine(c);
            }
        }
    }

    /**
     * Print a multi-line, comma-terminated list (params, object-type
     * fields, ...) with the standard comment placement policy: leading
     * comments on their own line at the current indent, trailing
     * comments inline after the comma (or on subsequent lines for
     * comments that originated below the item), and any container-level
     * `innerComments` flushed at the end.
     *
     * Caller is responsible for emitting the opening delimiter +
     * newline + `indent(() => ...)` wrapper and the closing delimiter;
     * this helper just owns the per-item lines.
     */
    private printCommentedCommaList<
        T extends {
            leadingComments?: Comment[];
            trailingComments?: Comment[];
            endLine?: number;
        },
    >(
        items: T[],
        innerComments: Comment[] | undefined,
        printItem: (item: T) => void,
    ): void {
        // Comma placement is consistent with `printParamList`'s old
        // body: comma immediately after the item, THEN inline trailing
        // comments, THEN newline, THEN any after-line trailings. This
        // matches what the parser scoops into `trailingComments` for
        // both pre-comma and post-comma same-line comments.
        items.forEach((it) => {
            this.printOwnLineComments(it.leadingComments);
            printItem(it);
            this.write(",");
            this.emitInlineTrailing(it.trailingComments, it.endLine);
            this.newline();
            this.emitAfterLineTrailing(it.trailingComments, it.endLine);
        });
        this.printOwnLineComments(innerComments);
    }

    private printParam(p: ParamDecl): void {
        this.write(`${p.name}: `);
        this.printType(p.type);
    }

    // ---- Types ----

    private printType(t: TypeExpr): void {
        switch (t.kind) {
            case "NamedType":
                this.write(t.name);
                return;
            case "ArrayType":
                this.printType(t.element);
                this.write("[]");
                return;
            case "ObjectType": {
                this.printObjectType(t);
                return;
            }
        }
    }

    /**
     * Print an object type literal. Layout follows the same priority as
     * param lists: comments force multi-line; otherwise preserve the
     * source layout unless overflow forces a switch.
     */
    private printObjectType(t: import("./ast.js").ObjectType): void {
        const hasFieldComments = t.fields.some(
            (f) => f.leadingComments?.length || f.trailingComments?.length,
        );
        const hasInner = !!t.innerComments?.length;
        const forcedMultiLine = hasFieldComments || hasInner;

        let inlineFits = true;
        if (!forcedMultiLine) {
            const projected = this.measure(() => {
                this.writeObjectTypeInline(t);
            });
            inlineFits = projected <= this.opts.printWidth;
        }
        const useMultiLine =
            forcedMultiLine || t.multiLine === true || !inlineFits;
        if (!useMultiLine) {
            this.writeObjectTypeInline(t);
            return;
        }
        this.write("{");
        this.newline();
        this.indent(() => {
            this.printCommentedCommaList(t.fields, t.innerComments, (f) => {
                this.write(f.name);
                if (f.optional) this.write("?");
                this.write(": ");
                this.printType(f.type);
            });
        });
        this.write("}");
    }

    private writeObjectTypeInline(t: import("./ast.js").ObjectType): void {
        if (t.fields.length === 0) {
            this.write("{}");
            return;
        }
        this.write("{ ");
        t.fields.forEach((f, i) => {
            if (i > 0) this.write(", ");
            this.write(f.name);
            if (f.optional) this.write("?");
            this.write(": ");
            this.printType(f.type);
        });
        this.write(" }");
    }

    // ---- Statements ----

    private printStatement(s: Statement): void {
        if (s.blankLineBefore && this.opts.keepBlankLines) this.newline();
        this.printLeadingComments(s.leadingComments);
        switch (s.kind) {
            case "ConstStatement": {
                // Bare expression statements are represented as ConstStatement
                // with `isSynthetic: true` (the parser wraps them in a const
                // with a synthetic name; see G9). Emit them as bare expressions
                // so format -> parse -> format is stable, and so legitimate
                // user variables that happen to match the synthetic name
                // pattern are not silently rewritten.
                if (s.isSynthetic) {
                    this.printExpr(s.value);
                    this.endStmtWith(s, ";");
                    return;
                }
                this.write(`const ${s.name}`);
                if (s.typeAnnotation) {
                    this.write(": ");
                    this.printType(s.typeAnnotation);
                }
                this.write(" = ");
                this.printExpr(s.value);
                this.endStmtWith(s, ";");
                return;
            }
            case "DestructuringConst": {
                this.write(`const [${s.names.join(", ")}] = `);
                this.printExpr(s.value);
                this.endStmtWith(s, ";");
                return;
            }
            case "IfStatement": {
                this.write("if (");
                this.printExpr(s.condition);
                this.write(") {");
                this.newline();
                this.indent(() => {
                    for (const t of s.then) this.printStatement(t);
                    if (s.then.length === 0) {
                        this.printOwnLineComments(s.thenInnerComments);
                    }
                });
                this.write("}");
                if (s.else_) {
                    // Decide whether `else` goes on the same line as `}`
                    // (inline) or on a new line. The AST flag preserves
                    // source layout; we also force a new line if the
                    // projected `} else { ... ` would not fit the width
                    // budget. Block-only comments may still render inline
                    // even when the flag is set, IF the projected width
                    // fits — keeps idiomatic `} /* x */ else` for short
                    // comments.
                    const hasLineComment = !!s.elseLeadingComments?.some((c) =>
                        c.text.startsWith("//"),
                    );
                    let forceNewLine =
                        hasLineComment || s.elseOnNewLine === true;
                    // Width override: if the inline projection (current
                    // column through `else {`) would exceed printWidth,
                    // break.
                    if (!forceNewLine) {
                        const projected = this.measure(() => {
                            this.writeElseLeading(s.elseLeadingComments, false);
                            this.write("else {");
                        });
                        if (projected > this.opts.printWidth) {
                            forceNewLine = true;
                        }
                    }
                    this.writeElseLeading(s.elseLeadingComments, forceNewLine);
                    // else-if chain
                    if (
                        s.else_.length === 1 &&
                        s.else_[0].kind === "IfStatement"
                    ) {
                        this.write("else ");
                        this.printStatement(s.else_[0]);
                        // printStatement of an IfStatement already emits a newline
                        return;
                    }
                    this.write("else {");
                    this.newline();
                    this.indent(() => {
                        for (const t of s.else_!) this.printStatement(t);
                        if (s.else_!.length === 0) {
                            this.printOwnLineComments(s.elseInnerComments);
                        }
                    });
                    this.endStmtWith(s, "}");
                } else {
                    this.endStmtAfter(s);
                }
                return;
            }
            case "SwitchStatement": {
                this.write("switch (");
                this.printExpr(s.discriminant);
                this.write(") {");
                this.newline();
                const defaultIdx =
                    s.default_ === undefined
                        ? -1
                        : s.defaultIndex !== undefined
                          ? s.defaultIndex
                          : s.arms.length;
                this.indent(() => {
                    // Comments that appeared before the first arm (or
                    // before `default` when default is first).
                    this.printOwnLineComments(s.innerComments);
                    for (let i = 0; i <= s.arms.length; i++) {
                        if (i === defaultIdx) {
                            this.printOwnLineComments(s.defaultLeadingComments);
                            this.line("default:");
                            this.indent(() => {
                                for (const st of s.default_!)
                                    this.printStatement(st);
                                if (s.default_!.length === 0) {
                                    this.printOwnLineComments(
                                        s.defaultInnerComments,
                                    );
                                }
                            });
                        }
                        if (i < s.arms.length) {
                            const arm = s.arms[i];
                            this.printOwnLineComments(arm.leadingComments);
                            this.write("case ");
                            this.printExpr(arm.value);
                            this.write(":");
                            this.newline();
                            this.indent(() => {
                                for (const st of arm.body)
                                    this.printStatement(st);
                                if (arm.body.length === 0) {
                                    this.printOwnLineComments(
                                        arm.innerComments,
                                    );
                                }
                            });
                        }
                    }
                });
                this.endStmtWith(s, "}");
                return;
            }
            case "ReturnStatement": {
                this.write("return ");
                this.printExpr(s.value);
                this.endStmtWith(s, ";");
                return;
            }
            case "BreakStatement": {
                this.write("break;");
                this.endStmtAfter(s);
                return;
            }
            case "ThrowStatement": {
                this.write("throw ");
                this.printExpr(s.value);
                this.endStmtWith(s, ";");
                return;
            }
        }
    }

    // ---- Expressions ----

    private printExpr(e: Expr): void {
        this.printExprPrec(e, 0);
    }

    private printExprPrec(e: Expr, parentPrec: number): void {
        switch (e.kind) {
            case "StringLiteralExpr":
                this.write(e.quote + e.raw + e.quote);
                return;
            case "NumberLiteralExpr":
                this.write(String(e.value));
                return;
            case "BooleanLiteralExpr":
                this.write(e.value ? "true" : "false");
                return;
            case "NullLiteralExpr":
                this.write("null");
                return;
            case "DottedNameExpr":
                this.write(e.segments.join("."));
                return;
            case "TemplateLiteralExpr": {
                this.write("`");
                for (let i = 0; i < e.rawParts.length; i++) {
                    this.write(e.rawParts[i]);
                    if (i < e.expressions.length) {
                        this.write("${");
                        this.printExpr(e.expressions[i]);
                        this.write("}");
                    }
                }
                this.write("`");
                return;
            }
            case "ArrayLiteralExpr": {
                this.write("[");
                e.elements.forEach((el, i) => {
                    if (i > 0) this.write(", ");
                    this.printExpr(el);
                });
                this.write("]");
                return;
            }
            case "ObjectLiteralExpr": {
                if (e.entries.length === 0) {
                    this.write("{}");
                    return;
                }
                this.write("{ ");
                e.entries.forEach((entry, i) => {
                    if (i > 0) this.write(", ");
                    this.printObjectEntry(entry);
                });
                this.write(" }");
                return;
            }
            case "TaskCallExpr": {
                this.write(`${e.task}(`);
                this.printArgs(e.args);
                this.write(")");
                return;
            }
            case "WorkflowCallExpr": {
                this.write(`${e.name}(`);
                this.printArgs(e.args);
                this.write(")");
                return;
            }
            case "UnaryExpr": {
                const myPrec = UNARY_PREC;
                const wrap = myPrec < parentPrec;
                if (wrap) this.write("(");
                this.write(e.op);
                this.printExprPrec(e.operand, myPrec);
                if (wrap) this.write(")");
                return;
            }
            case "BinaryExpr": {
                const myPrec = BINARY_PREC[e.op];
                const wrap = myPrec < parentPrec;
                if (wrap) this.write("(");
                // Left-associative: right side uses myPrec+1 to force parens
                // when right is same-precedence.
                this.printExprPrec(e.left, myPrec);
                this.write(` ${e.op} `);
                this.printExprPrec(e.right, myPrec + 1);
                if (wrap) this.write(")");
                return;
            }
            case "TernaryExpr": {
                const myPrec = TERNARY_PREC;
                const wrap = myPrec < parentPrec;
                if (wrap) this.write("(");
                this.printExprPrec(e.condition, myPrec + 1);
                this.write(" ? ");
                this.printExprPrec(e.consequent, myPrec);
                this.write(" : ");
                this.printExprPrec(e.alternate, myPrec);
                if (wrap) this.write(")");
                return;
            }
            case "AttemptsNode":
                this.printAttempts(e);
                return;
            case "MapNode":
                this.printMapOrFilter("map", e);
                return;
            case "FilterNode":
                this.printMapOrFilter("filter", e);
                return;
            case "ParallelNode":
                this.printParallel(e);
                return;
            case "ParallelMapNode":
                this.printParallelMap(e);
                return;
        }
    }

    private printObjectEntry(entry: ObjectEntry): void {
        this.write(
            needsKeyQuotes(entry.key) ? quoteString(entry.key) : entry.key,
        );
        this.write(": ");
        this.printExpr(entry.value);
    }

    private printArgs(args: TaskArg[]): void {
        args.forEach((a, i) => {
            if (i > 0) this.write(", ");
            if (a.kind === "NamedArg") {
                this.write(`${a.name}: `);
            }
            this.printExpr(a.value);
        });
    }

    // ---- Built-in node printers ----

    private printBlockBody(body: Statement[], innerComments?: Comment[]): void {
        this.write("{");
        this.newline();
        this.indent(() => {
            for (const s of body) this.printStatement(s);
            if (body.length === 0) {
                this.printOwnLineComments(innerComments);
            }
        });
        // Caller is responsible for the closing context (it lives mid-expression).
        this.write("}");
    }

    private printAttempts(e: AttemptsNode): void {
        this.write("attempts(");
        this.printExpr(e.count);
        this.write(", () => ");
        this.printBlockBody(e.body, e.bodyInnerComments);
        if (e.fallback) {
            // When the source omitted the fallback parameter, preserve
            // that absence: emit `()` rather than introducing the
            // emitter/typechecker default binding name.
            const fbParam = e.fallback.param ?? "";
            this.write(`, (${fbParam}) => `);
            this.printBlockBody(e.fallback.body, e.fallback.bodyInnerComments);
        }
        this.write(")");
    }

    private printMapOrFilter(
        name: "map" | "filter",
        e: MapNode | FilterNode,
    ): void {
        this.write(`${name}(`);
        this.printExpr(e.collection);
        this.write(`, (${e.param}) => `);
        this.printBlockBody(e.body, e.bodyInnerComments);
        this.write(")");
    }

    private printParallel(e: ParallelNode): void {
        this.write("parallel(");
        e.bodies.forEach((b, i) => {
            if (i > 0) this.write(", ");
            this.write("() => ");
            this.printBlockBody(b.body, b.bodyInnerComments);
        });
        if (e.maxConcurrency) {
            this.write(", { maxConcurrency: ");
            this.printExpr(e.maxConcurrency);
            this.write(" }");
        }
        this.write(")");
    }

    private printParallelMap(e: ParallelMapNode): void {
        this.write("parallelMap(");
        this.printExpr(e.collection);
        this.write(`, (${e.param}) => `);
        this.printBlockBody(e.body, e.bodyInnerComments);
        if (e.maxConcurrency) {
            this.write(", { maxConcurrency: ");
            this.printExpr(e.maxConcurrency);
            this.write(" }");
        }
        this.write(")");
    }
}

// ---- Helpers ----

const UNARY_PREC = 12;
const TERNARY_PREC = 2;
const BINARY_PREC: Record<BinaryOp, number> = {
    "||": 3,
    "&&": 4,
    "===": 7,
    "!==": 7,
    "<": 8,
    ">": 8,
    "<=": 8,
    ">=": 8,
    "+": 10,
    "-": 10,
    "*": 11,
    "/": 11,
    "%": 11,
};

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function needsKeyQuotes(key: string): boolean {
    return !IDENT_RE.test(key);
}

function quoteString(s: string): string {
    // Re-use the shared encoder so the formatter's escape set stays in
    // lockstep with the lexer / decoder.
    return quoteStringLiteral(s, '"');
}
