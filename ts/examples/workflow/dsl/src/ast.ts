// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Workflow DSL abstract syntax tree types.
 *
 * The AST mirrors the DSL's surface syntax. The emitter (emitter.ts)
 * lowers AST nodes to IR nodes.
 */

export interface SourceLocation {
    line: number;
    col: number;
    offset: number;
}

export interface Comment {
    text: string;
    pos: SourceLocation;
}

/**
 * Default name bound for an `attempts(..., () => { ... }, () => { ... })`
 * fallback arrow that omits its parameter. Centralized so the emitter,
 * type checker, and formatter agree on the binding name.
 */
export const DEFAULT_FALLBACK_PARAM = "err";

// ---- Top-level ----

export interface WorkflowDecl {
    kind: "WorkflowDecl";
    name: string;
    description?: string;
    params: ParamDecl[];
    returnType: TypeExpr;
    body: Statement[];
    loc: SourceLocation;
    leadingComments?: Comment[];
    /**
     * Comments that appear inside the workflow body before the closing `}`
     * but cannot be attached as a `leadingComments` of any statement (e.g.,
     * the body is empty, or the comments appear after the last statement
     * and finalizeBlock chose to surface them at the workflow level). The
     * formatter emits these on their own lines at body indent.
     */
    innerComments?: Comment[];
    /**
     * Comments that appear inside `(` ... `)` when the parameter list is
     * empty (e.g. `workflow w(... block-comment ...)`). When the parameter
     * list is non-empty, comments before the first param attach as that
     * param's `leadingComments` and comments after the last param attach
     * as that param's `trailingComments`.
     */
    paramInnerComments?: Comment[];
    /**
     * True when the original source rendered the parameter list across
     * multiple lines (e.g. `(`, params, `)` were not all on the same
     * line). The formatter preserves this layout choice unless the
     * single-line projection fits within `FormatOptions.printWidth`.
     */
    paramListMultiLine?: boolean;
    /**
     * Comments that appear AFTER the workflow's closing `}` (between
     * the closing brace and EOF). The formatter emits these on their
     * own lines after the closing brace.
     */
    trailingComments?: Comment[];
}

export interface ParamDecl {
    name: string;
    type: TypeExpr;
    loc: SourceLocation;
    leadingComments?: Comment[];
    trailingComments?: Comment[];
    /** Line of the last token of this parameter, used to decide inline
     *  vs. own-line rendering of trailing comments (analogous to
     *  Statement.endLine). */
    endLine?: number;
}

// ---- Types ----

export type TypeExpr = NamedType | ArrayType | ObjectType;

export interface NamedType {
    kind: "NamedType";
    name: string; // "string", "number", "integer", "boolean", "unknown", "never"
    loc: SourceLocation;
}

export interface ArrayType {
    kind: "ArrayType";
    element: TypeExpr;
    loc: SourceLocation;
}

export interface ObjectType {
    kind: "ObjectType";
    fields: ObjectTypeField[];
    loc: SourceLocation;
    /** True when the original source rendered the object type across
     *  multiple lines. The formatter preserves this layout unless the
     *  single-line projection fits within `FormatOptions.printWidth`. */
    multiLine?: boolean;
    /** Comments that appear inside an empty `{ }` object type with no
     *  fields (no field has anywhere to host them). */
    innerComments?: Comment[];
}

export interface ObjectTypeField {
    name: string;
    type: TypeExpr;
    optional: boolean;
    loc: SourceLocation;
    leadingComments?: Comment[];
    trailingComments?: Comment[];
    /** Line of the field's last token (after the type) — used by the
     *  formatter to render inline vs. own-line trailing comments. */
    endLine?: number;
}

// ---- Statements ----

export type Statement =
    | ConstStatement
    | DestructuringConst
    | IfStatement
    | SwitchStatement
    | ThrowStatement
    | ReturnStatement
    | BreakStatement;

export interface ConstStatement {
    kind: "ConstStatement";
    name: string;
    typeAnnotation?: TypeExpr | undefined;
    value: Expr;
    loc: SourceLocation;
    leadingComments?: Comment[];
    trailingComments?: Comment[];
    /** Line of the last token of this statement (used by the formatter
     * to decide whether a trailing comment is inline or block-style). */
    endLine?: number;
    /**
     * True when the parser wrapped a bare statement-position task/workflow
     * call (e.g. `audit.log(x);`) in a ConstStatement with a synthetic
     * name of the form `__synthetic_<line>_<col>`. That prefix is
     * reserved (the parser rejects user `const` names that start with
     * `__synthetic_`) so the formatter can safely re-emit these as bare
     * expression statements without risk of round-tripping a real
     * user binding into a bare expression. Format -> parse -> format is
     * stable. See G9.
     */
    isSynthetic?: boolean;
}

export interface DestructuringConst {
    kind: "DestructuringConst";
    names: string[];
    value: Expr;
    loc: SourceLocation;
    leadingComments?: Comment[];
    trailingComments?: Comment[];
    endLine?: number;
}

export interface IfStatement {
    kind: "IfStatement";
    condition: Expr;
    then: Statement[];
    else_?: Statement[] | undefined;
    loc: SourceLocation;
    leadingComments?: Comment[];
    trailingComments?: Comment[];
    endLine?: number;
    /** Comments inside an empty `then` block. */
    thenInnerComments?: Comment[];
    /** Comments inside an empty `else` block. */
    elseInnerComments?: Comment[];
    /** Comments that appear between `}` of the then block and the `else`
     *  keyword (or before an `else if`). Preserved so source like
     *  `if (x) { ... } /* note *\/ else { ... }` round-trips faithfully. */
    elseLeadingComments?: Comment[];
    /**
     * True when the original source placed the `else` keyword on a
     * different line than the closing `}` of the then block (or when
     * `elseLeadingComments` contains a `//` line comment, which forces
     * a break). The formatter preserves this layout choice.
     */
    elseOnNewLine?: boolean;
}

export interface SwitchStatement {
    kind: "SwitchStatement";
    discriminant: Expr;
    arms: SwitchArm[];
    default_?: Statement[];
    /**
     * Index into the original source-order arm sequence at which the
     * `default:` arm appeared (0..arms.length). `undefined` when there
     * is no default arm. Used by the formatter to round-trip the source
     * ordering since the spec allows fallthrough and therefore order is
     * semantically significant.
     */
    defaultIndex?: number;
    loc: SourceLocation;
    leadingComments?: Comment[];
    trailingComments?: Comment[];
    endLine?: number;
    /** Comments inside an empty `default:` arm body. */
    defaultInnerComments?: Comment[];
    /** Comments that appear inside the switch body before any case/default
     *  (i.e. the switch body is fully empty or comments precede the first
     *  arm). Without this slot they would migrate to the next statement's
     *  leadingComments and lose attachment to the switch. */
    innerComments?: Comment[];
    /** Comments that appear immediately before the `default` keyword. */
    defaultLeadingComments?: Comment[];
}

export interface SwitchArm {
    value: Expr;
    body: Statement[];
    loc: SourceLocation;
    /** Comments that appear immediately before the `case` keyword. */
    leadingComments?: Comment[];
    /** Comments inside an empty `case X:` arm body. */
    innerComments?: Comment[];
}

export interface ThrowStatement {
    kind: "ThrowStatement";
    value: Expr;
    loc: SourceLocation;
    leadingComments?: Comment[];
    trailingComments?: Comment[];
    endLine?: number;
}

export interface ReturnStatement {
    kind: "ReturnStatement";
    value: Expr;
    loc: SourceLocation;
    leadingComments?: Comment[];
    trailingComments?: Comment[];
    endLine?: number;
}

export interface BreakStatement {
    kind: "BreakStatement";
    loc: SourceLocation;
    leadingComments?: Comment[];
    trailingComments?: Comment[];
    endLine?: number;
}

// ---- Expressions ----

export type Expr =
    | TaskCallExpr
    | WorkflowCallExpr
    | DottedNameExpr
    | StringLiteralExpr
    | TemplateLiteralExpr
    | NumberLiteralExpr
    | BooleanLiteralExpr
    | NullLiteralExpr
    | ArrayLiteralExpr
    | ObjectLiteralExpr
    | BinaryExpr
    | UnaryExpr
    | TernaryExpr
    | AttemptsNode
    | MapNode
    | FilterNode
    | ParallelNode
    | ParallelMapNode;

export interface TaskCallExpr {
    kind: "TaskCallExpr";
    task: string; // e.g. "text.template", "shell.exec"
    args: TaskArg[];
    loc: SourceLocation;
}

export interface WorkflowCallExpr {
    kind: "WorkflowCallExpr";
    name: string;
    args: TaskArg[];
    loc: SourceLocation;
}

export type TaskArg = PositionalArg | NamedArg;

export interface PositionalArg {
    kind: "PositionalArg";
    value: Expr;
}

export interface NamedArg {
    kind: "NamedArg";
    name: string;
    value: Expr;
}

export interface DottedNameExpr {
    kind: "DottedNameExpr";
    segments: string[];
    loc: SourceLocation;
}

export interface StringLiteralExpr {
    kind: "StringLiteralExpr";
    /**
     * Raw source text between the delimiters, exclusive. Escape
     * sequences are NOT processed. Consumers that need the cooked
     * (semantic) value call `decodeStringLiteral(raw, quote)` from
     * `./literal.js`.
     */
    raw: string;
    /**
     * Original delimiter character. Double-quote and single-quote are
     * produced for ordinary string literals. Backtick is produced for
     * NoSubstitution templates (e.g. `` `text` ``) which the parser
     * lowers to a StringLiteralExpr so the formatter can re-emit them
     * verbatim; templates that contain `${...}` interpolations parse
     * to TemplateLiteralExpr instead.
     */
    quote: '"' | "'" | "`";
    loc: SourceLocation;
}

export interface TemplateLiteralExpr {
    kind: "TemplateLiteralExpr";
    /**
     * Raw source text for each static span (between the opening backtick
     * and `${`, between `}` and `${`, between `}` and the closing
     * backtick). `rawParts.length === expressions.length + 1`. Escape
     * sequences are NOT processed; consumers that need cooked values
     * call `decodeTemplatePart(rawParts[i])` from `./literal.js`.
     */
    rawParts: string[];
    /** Interpolated expressions */
    expressions: Expr[];
    loc: SourceLocation;
}

export interface NumberLiteralExpr {
    kind: "NumberLiteralExpr";
    value: number;
    loc: SourceLocation;
}

export interface BooleanLiteralExpr {
    kind: "BooleanLiteralExpr";
    value: boolean;
    loc: SourceLocation;
}

export interface NullLiteralExpr {
    kind: "NullLiteralExpr";
    loc: SourceLocation;
}

export interface ArrayLiteralExpr {
    kind: "ArrayLiteralExpr";
    elements: Expr[];
    loc: SourceLocation;
}

export interface ObjectLiteralExpr {
    kind: "ObjectLiteralExpr";
    entries: ObjectEntry[];
    loc: SourceLocation;
}

export interface ObjectEntry {
    key: string;
    value: Expr;
    loc: SourceLocation;
}

// ---- Operators ----

export type BinaryOp =
    | "==="
    | "!=="
    | ">"
    | "<"
    | ">="
    | "<="
    | "&&"
    | "||"
    | "+"
    | "-"
    | "*"
    | "/"
    | "%";

export type UnaryOp = "!" | "-";

export interface BinaryExpr {
    kind: "BinaryExpr";
    op: BinaryOp;
    left: Expr;
    right: Expr;
    loc: SourceLocation;
}

export interface UnaryExpr {
    kind: "UnaryExpr";
    op: UnaryOp;
    operand: Expr;
    loc: SourceLocation;
}

export interface TernaryExpr {
    kind: "TernaryExpr";
    condition: Expr;
    consequent: Expr;
    alternate: Expr;
    loc: SourceLocation;
}

// ---- Built-in nodes ----

export interface AttemptsNode {
    kind: "AttemptsNode";
    count: Expr;
    body: Statement[];
    fallback?: {
        /**
         * Parameter name for the fallback callback, or `undefined` if
         * the source omitted the parameter (`() => { ... }`). Preserving
         * absence-vs-presence is necessary for content fidelity.
         */
        param: string | undefined;
        body: Statement[];
        /** Comments inside an empty fallback body. */
        bodyInnerComments?: Comment[];
    };
    loc: SourceLocation;
    /** Comments inside an empty attempts body. */
    bodyInnerComments?: Comment[];
}

export interface MapNode {
    kind: "MapNode";
    collection: Expr;
    param: string;
    body: Statement[];
    loc: SourceLocation;
    /** Comments inside an empty map body. */
    bodyInnerComments?: Comment[];
}

export interface FilterNode {
    kind: "FilterNode";
    collection: Expr;
    param: string;
    body: Statement[];
    loc: SourceLocation;
    /** Comments inside an empty filter body. */
    bodyInnerComments?: Comment[];
}

export interface ParallelNode {
    kind: "ParallelNode";
    bodies: {
        body: Statement[];
        /** Comments inside an empty parallel branch body. */
        bodyInnerComments?: Comment[];
    }[];
    maxConcurrency?: Expr;
    loc: SourceLocation;
}

export interface ParallelMapNode {
    kind: "ParallelMapNode";
    collection: Expr;
    param: string;
    body: Statement[];
    maxConcurrency?: Expr;
    loc: SourceLocation;
    /** Comments inside an empty parallelMap body. */
    bodyInnerComments?: Comment[];
}
