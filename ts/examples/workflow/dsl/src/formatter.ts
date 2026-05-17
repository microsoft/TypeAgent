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
}

interface ResolvedOptions {
    indent: number;
    eol: string;
}

/** Format a single workflow declaration as DSL source text. */
export function format(decl: WorkflowDecl, options?: FormatOptions): string {
    const opts: ResolvedOptions = {
        indent: options?.indent ?? 4,
        eol: options?.eol ?? "\n",
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

    private printLeadingComments(comments: Comment[] | undefined): void {
        if (!comments) return;
        for (const c of comments) {
            // Comment text already includes its delimiters. Block comments
            // may contain newlines; emit them verbatim then start a new line.
            if (c.text.includes("\n")) {
                const lines = c.text.split("\n");
                for (let i = 0; i < lines.length; i++) {
                    this.write(lines[i]);
                    if (i < lines.length - 1) this.newline();
                }
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
                const lines = c.text.split("\n");
                for (let i = 0; i < lines.length; i++) {
                    this.write(lines[i]);
                    if (i < lines.length - 1) this.newline();
                }
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
                const lines = c.text.split("\n");
                for (let i = 0; i < lines.length; i++) {
                    this.write(lines[i]);
                    if (i < lines.length - 1) this.newline();
                }
                this.newline();
            } else {
                this.line(c.text);
            }
        }
    }

    // ---- Workflow ----

    printWorkflow(decl: WorkflowDecl): void {
        this.printLeadingComments(decl.leadingComments);
        this.write(`workflow ${decl.name}(`);
        decl.params.forEach((p, i) => {
            if (i > 0) this.write(", ");
            this.printParam(p);
        });
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
                this.write("{ ");
                t.fields.forEach((f, i) => {
                    if (i > 0) this.write(", ");
                    this.write(f.name);
                    if (f.optional) this.write("?");
                    this.write(": ");
                    this.printType(f.type);
                });
                this.write(" }");
                return;
            }
        }
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
                });
                this.write("}");
                if (s.else_) {
                    // else-if chain
                    if (
                        s.else_.length === 1 &&
                        s.else_[0].kind === "IfStatement"
                    ) {
                        this.write(" else ");
                        this.printStatement(s.else_[0]);
                        // printStatement of an IfStatement already emits a newline
                        return;
                    }
                    this.write(" else {");
                    this.newline();
                    this.indent(() => {
                        for (const t of s.else_!) this.printStatement(t);
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
                    for (let i = 0; i <= s.arms.length; i++) {
                        if (i === defaultIdx) {
                            this.line("default:");
                            this.indent(() => {
                                for (const st of s.default_!)
                                    this.printStatement(st);
                            });
                        }
                        if (i < s.arms.length) {
                            const arm = s.arms[i];
                            this.write("case ");
                            this.printExpr(arm.value);
                            this.write(":");
                            this.newline();
                            this.indent(() => {
                                for (const st of arm.body)
                                    this.printStatement(st);
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

    private printBlockBody(body: Statement[]): void {
        this.write("{");
        this.newline();
        this.indent(() => {
            for (const s of body) this.printStatement(s);
        });
        // Caller is responsible for the closing context (it lives mid-expression).
        this.write("}");
    }

    private printAttempts(e: AttemptsNode): void {
        this.write("attempts(");
        this.printExpr(e.count);
        this.write(", () => ");
        this.printBlockBody(e.body);
        if (e.fallback) {
            this.write(`, (${e.fallback.param}) => `);
            this.printBlockBody(e.fallback.body);
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
        this.printBlockBody(e.body);
        this.write(")");
    }

    private printParallel(e: ParallelNode): void {
        this.write("parallel(");
        e.bodies.forEach((b, i) => {
            if (i > 0) this.write(", ");
            this.write("() => ");
            this.printBlockBody(b.body);
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
        this.printBlockBody(e.body);
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
