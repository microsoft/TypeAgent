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
}

export interface ParamDecl {
    name: string;
    type: TypeExpr;
    loc: SourceLocation;
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
}

export interface DestructuringConst {
    kind: "DestructuringConst";
    names: string[];
    value: Expr;
    loc: SourceLocation;
    leadingComments?: Comment[];
}

export interface IfStatement {
    kind: "IfStatement";
    condition: Expr;
    then: Statement[];
    else_?: Statement[] | undefined;
    loc: SourceLocation;
    leadingComments?: Comment[];
}

export interface SwitchStatement {
    kind: "SwitchStatement";
    discriminant: Expr;
    arms: SwitchArm[];
    default_?: Statement[];
    loc: SourceLocation;
    leadingComments?: Comment[];
}

export interface SwitchArm {
    value: Expr;
    body: Statement[];
    loc: SourceLocation;
}

export interface ThrowStatement {
    kind: "ThrowStatement";
    value: Expr;
    loc: SourceLocation;
    leadingComments?: Comment[];
}

export interface ReturnStatement {
    kind: "ReturnStatement";
    value: Expr;
    loc: SourceLocation;
    leadingComments?: Comment[];
}

export interface BreakStatement {
    kind: "BreakStatement";
    loc: SourceLocation;
    leadingComments?: Comment[];
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
    fallback?: { param: string; body: Statement[] };
    loc: SourceLocation;
}

export interface MapNode {
    kind: "MapNode";
    collection: Expr;
    param: string;
    body: Statement[];
    loc: SourceLocation;
}

export interface FilterNode {
    kind: "FilterNode";
    collection: Expr;
    param: string;
    body: Statement[];
    loc: SourceLocation;
}

export interface ParallelNode {
    kind: "ParallelNode";
    bodies: { body: Statement[] }[];
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
}
