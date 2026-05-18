// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Workflow DSL formatter (AST -> source).
 *
 * Round-trips a parsed `WorkflowDecl` back to canonical DSL text. Preserves
 * `leadingComments` attached to AST nodes (see G8 in dsl-v0.1-gap.md and
 * dsl-v0.1.md section 6).
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

export interface FormatOptions {
    /** Number of spaces per indent level. Default 4. */
    indent?: number;
    /** Line ending. Default "\n". */
    eol?: string;
    /** Soft column limit used by layout heuristics. When the AST does
     *  not constrain a layout choice (e.g. no comments forcing a break
     *  and the original source used inline), the formatter will use
     *  inline iff the projected single-line width is <= printWidth.
     *  Default 100. Set to Infinity to never wrap based on width.
     *  Set to 0 to always wrap when an alternative multi-line layout
     *  exists. */
    printWidth?: number;
}

interface ResolvedOptions {
    indent: number;
    eol: string;
    printWidth: number;
}

/** Format a single workflow declaration as DSL source text. */
export function format(decl: WorkflowDecl, options?: FormatOptions): string {
    const opts: ResolvedOptions = {
        indent: options?.indent ?? 4,
        eol: options?.eol ?? "\n",
        printWidth: options?.printWidth ?? 100,
    };
    const p = new Printer(opts);
    p.printWorkflow(decl);
    return p.toString();
}

class Printer {
    private parts: string[] = [];
    private depth = 0;
    private atLineStart = true;

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
            this.parts.push(" ".repeat(this.depth * this.opts.indent));
            this.atLineStart = false;
        }
        this.parts.push(s);
    }

    private newline(): void {
        this.parts.push(this.opts.eol);
        this.atLineStart = true;
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
     * Walks the parts array backward to the last newline, summing lengths.
     * If we're at line start, returns the implicit indent that the next
     * `write` would produce.
     */
    private currentColumn(): number {
        if (this.atLineStart) return this.depth * this.opts.indent;
        let total = 0;
        const eol = this.opts.eol;
        for (let i = this.parts.length - 1; i >= 0; i--) {
            const p = this.parts[i];
            const idx = p.lastIndexOf(eol);
            if (idx >= 0) {
                total += p.length - idx - eol.length;
                return total;
            }
            total += p.length;
        }
        return total;
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
        const startCol = this.currentColumn();
        this.parts = [];
        try {
            fn();
        } finally {
            const out = this.parts.join("");
            this.parts = savedParts;
            this.depth = savedDepth;
            this.atLineStart = savedAtLineStart;
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
     * spaces on every reformat (see G8-round-2 bug).
     */
    private writeMultilineCommentText(text: string): void {
        const lines = text.split("\n");
        this.write(lines[0]);
        for (let i = 1; i < lines.length; i++) {
            this.parts.push(this.opts.eol);
            this.atLineStart = false;
            this.parts.push(lines[i]);
        }
    }

    private printLeadingComments(comments: Comment[] | undefined): void {
        if (!comments) return;
        for (const c of comments) {
            // Comment text already includes its delimiters. Block comments
            // may contain newlines; emit them so the original internal
            // alignment is preserved.
            if (c.text.includes("\n")) {
                this.writeMultilineCommentText(c.text);
                this.newline();
            } else {
                this.line(c.text);
            }
        }
    }

    /**
     * End a statement: write the terminator (e.g. `;` or `}`), then any
     * inline trailing comments on the same physical source line as the
     * statement, then a newline, then any trailing comments that landed
     * on subsequent lines (each on its own indented line).
     */
    private endStmt(s: Statement, terminator: string): void {
        this.write(terminator);
        const trailing = s.trailingComments;
        if (!trailing || trailing.length === 0) {
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
        for (const c of inline) {
            this.write(" ");
            this.write(c.text);
        }
        this.newline();
        for (const c of after) {
            if (c.text.includes("\n")) {
                this.writeMultilineCommentText(c.text);
                this.newline();
            } else {
                this.line(c.text);
            }
        }
    }

    /** Emit a list of comments each on its own line at the current indent. */
    private printOwnLineComments(comments: Comment[] | undefined): void {
        if (!comments) return;
        for (const c of comments) {
            if (c.text.includes("\n")) {
                this.writeMultilineCommentText(c.text);
                this.newline();
            } else {
                this.line(c.text);
            }
        }
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
        if (!comments || comments.length === 0) {
            if (forceNewLine) {
                this.newline();
            } else {
                this.write(" ");
            }
            return;
        }
        const hasLineComment = comments.some((c) => c.text.startsWith("//"));
        if (!hasLineComment && !forceNewLine) {
            for (const c of comments) {
                this.write(" ");
                if (c.text.includes("\n")) {
                    this.writeMultilineCommentText(c.text);
                } else {
                    this.write(c.text);
                }
            }
            this.write(" ");
            return;
        }
        // Break before each comment, then drop `else` on a fresh line
        // at the current indent.
        for (const c of comments) {
            this.write(" ");
            if (c.text.includes("\n")) {
                this.writeMultilineCommentText(c.text);
            } else {
                this.write(c.text);
            }
            this.newline();
        }
        // If there were no comments at all (handled above) we wouldn't
        // reach here; if there were comments + forceNewLine but only
        // block comments, the final newline above already positions us.
    }

    // ---- Workflow ----

    printWorkflow(decl: WorkflowDecl): void {
        this.printLeadingComments(decl.leadingComments);
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
            (p) =>
                (p.leadingComments && p.leadingComments.length > 0) ||
                (p.trailingComments && p.trailingComments.length > 0),
        );
        const hasInner = !!(paramInner && paramInner.length > 0);
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
            params.forEach((p) => {
                this.printOwnLineComments(p.leadingComments);
                this.printParam(p);
                // Emit inline trailing comments AFTER the comma (and
                // separated by a space). Two reasons:
                //   1. Line comments (`// ...`) extend to end-of-line,
                //      so they can never legally precede the comma on
                //      the same line — they must come after it.
                //   2. The parser scoops same-line comments both
                //      before AND after the comma into the prev param's
                //      trailingComments, so either side round-trips,
                //      but emitting after the comma is the only form
                //      that works uniformly for // and /* */ kinds.
                this.write(",");
                this.emitInlineTrailing(p.trailingComments, p.endLine);
                this.newline();
                this.emitAfterLineTrailing(p.trailingComments, p.endLine);
            });
            this.printOwnLineComments(paramInner);
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
        if (!trailing) return;
        for (const c of trailing) {
            if (endLine !== undefined && c.pos.line === endLine) {
                this.write(" ");
                this.write(c.text);
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
        if (!trailing) return;
        for (const c of trailing) {
            if (endLine === undefined || c.pos.line !== endLine) {
                if (c.text.includes("\n")) {
                    this.writeMultilineCommentText(c.text);
                    this.newline();
                } else {
                    this.line(c.text);
                }
            }
        }
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
            (f) =>
                (f.leadingComments && f.leadingComments.length > 0) ||
                (f.trailingComments && f.trailingComments.length > 0),
        );
        const hasInner = !!(t.innerComments && t.innerComments.length > 0);
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
            t.fields.forEach((f) => {
                this.printOwnLineComments(f.leadingComments);
                this.write(f.name);
                if (f.optional) this.write("?");
                this.write(": ");
                this.printType(f.type);
                this.write(",");
                this.emitInlineTrailing(f.trailingComments, f.endLine);
                this.newline();
                this.emitAfterLineTrailing(f.trailingComments, f.endLine);
            });
            this.printOwnLineComments(t.innerComments);
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
                    this.endStmt(s, ";");
                    return;
                }
                this.write(`const ${s.name}`);
                if (s.typeAnnotation) {
                    this.write(": ");
                    this.printType(s.typeAnnotation);
                }
                this.write(" = ");
                this.printExpr(s.value);
                this.endStmt(s, ";");
                return;
            }
            case "DestructuringConst": {
                this.write(`const [${s.names.join(", ")}] = `);
                this.printExpr(s.value);
                this.endStmt(s, ";");
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
                    const hasLineComment = !!s.elseLeadingComments?.some(
                        (c) => c.text.startsWith("//"),
                    );
                    let forceNewLine =
                        hasLineComment || s.elseOnNewLine === true;
                    // Width override: if the inline projection (current
                    // column through `else {`) would exceed printWidth,
                    // break.
                    if (!forceNewLine) {
                        const projected = this.measure(() => {
                            this.writeElseLeading(
                                s.elseLeadingComments,
                                false,
                            );
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
                    this.endStmt(s, "}");
                } else {
                    this.endStmt(s, "");
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
                this.endStmt(s, "}");
                return;
            }
            case "ReturnStatement": {
                this.write("return ");
                this.printExpr(s.value);
                this.endStmt(s, ";");
                return;
            }
            case "BreakStatement": {
                this.write("break;");
                this.endStmt(s, "");
                return;
            }
            case "ThrowStatement": {
                this.write("throw ");
                this.printExpr(s.value);
                this.endStmt(s, ";");
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
                this.write(quoteString(e.value));
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
                for (let i = 0; i < e.parts.length; i++) {
                    this.write(escapeTemplateText(e.parts[i]));
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
            this.write(`, (${e.fallback.param}) => `);
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
    // Prefer double quotes; escape \, ", newline, tab.
    const escaped = s
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\n/g, "\\n")
        .replace(/\r/g, "\\r")
        .replace(/\t/g, "\\t");
    return `"${escaped}"`;
}

function escapeTemplateText(s: string): string {
    // Inside backticks, escape backticks, backslashes, and `${` sequences.
    return s
        .replace(/\\/g, "\\\\")
        .replace(/`/g, "\\`")
        .replace(/\$\{/g, "\\${");
}
