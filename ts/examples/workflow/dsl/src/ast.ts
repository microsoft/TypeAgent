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

// ---- Top-level ----

export interface WorkflowDecl {
    kind: "WorkflowDecl";
    name: string;
    description?: string;
    params: ParamDecl[];
    returnType: TypeExpr;
    body: Statement[];
    loc: SourceLocation;
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
    name: string; // "string", "number", "integer", "boolean", "any"
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
    | LetStatement
    | ConstStatement
    | AssignmentStatement
    | ForOfStatement
    | WhileStatement
    | IfStatement
    | MatchStatement
    | TryStatement
    | ReturnStatement
    | BreakStatement
    | ContinueStatement;

export interface LetStatement {
    kind: "LetStatement";
    name: string;
    typeAnnotation?: TypeExpr | undefined;
    value?: Expr | undefined;
    loc: SourceLocation;
}

export interface ConstStatement {
    kind: "ConstStatement";
    name: string;
    typeAnnotation?: TypeExpr | undefined;
    value: Expr;
    loc: SourceLocation;
}

export interface AssignmentStatement {
    kind: "AssignmentStatement";
    name: string;
    value: Expr;
    loc: SourceLocation;
}

export interface ForOfStatement {
    kind: "ForOfStatement";
    variable: string;
    iterable: Expr;
    body: Statement[];
    loc: SourceLocation;
}

export interface IfStatement {
    kind: "IfStatement";
    condition: Expr;
    then: Statement[];
    else_?: Statement[] | undefined;
    loc: SourceLocation;
}

export interface WhileStatement {
    kind: "WhileStatement";
    condition: Expr;
    body: Statement[];
    loc: SourceLocation;
}

export interface TryStatement {
    kind: "TryStatement";
    tryBody: Statement[];
    catchBody: Statement[];
    loc: SourceLocation;
}

export interface BreakStatement {
    kind: "BreakStatement";
    loc: SourceLocation;
}

export interface ContinueStatement {
    kind: "ContinueStatement";
    loc: SourceLocation;
}

export interface MatchStatement {
    kind: "MatchStatement";
    selector: Expr;
    cases: MatchCase[];
    default_?: Statement[] | undefined;
    loc: SourceLocation;
}

export interface MatchCase {
    pattern: string; // literal string or number
    body: Statement[];
    loc: SourceLocation;
}

export interface ReturnStatement {
    kind: "ReturnStatement";
    value: Expr;
    loc: SourceLocation;
}

// ---- Expressions ----

export type Expr =
    | TaskCallExpr
    | DottedNameExpr
    | StringLiteralExpr
    | TemplateLiteralExpr
    | NumberLiteralExpr
    | BooleanLiteralExpr
    | NullLiteralExpr
    | ArrayLiteralExpr
    | ObjectLiteralExpr;

export interface TaskCallExpr {
    kind: "TaskCallExpr";
    task: string; // e.g. "text.template", "shell.exec"
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
