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
}

export interface ObjectTypeField {
    name: string;
    type: TypeExpr;
    optional: boolean;
    loc: SourceLocation;
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
     * name. Round-trip serialization re-emits these as bare expression
     * statements so format -> parse -> format is stable. See G9.
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
}

export interface SwitchArm {
    value: Expr;
    body: Statement[];
    loc: SourceLocation;
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
    value: string;
    loc: SourceLocation;
}

export interface TemplateLiteralExpr {
    kind: "TemplateLiteralExpr";
    /** Static text parts: parts.length === expressions.length + 1 */
    parts: string[];
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
        param: string;
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
