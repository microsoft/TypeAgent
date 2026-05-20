// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Symbol resolver for the workflow DSL.
 *
 * The DSL's `TypeChecker` keeps its scope information private and
 * doesn't survive past `check()`, so the LSP can't rely on it for
 * go-to-def / references / rename. This pass walks the AST and
 * produces a `SymbolTable` keyed by identifier reference position.
 *
 * Tracked symbols:
 *  - workflow parameters
 *  - `const` bindings (including destructuring entries)
 *  - lambda parameters (map / filter / parallelMap / attempts fallback)
 *
 * The first segment of a `DottedNameExpr` is the reference candidate;
 * subsequent segments are property accesses we don't try to resolve.
 *
 * Scopes are nested following block structure. Symbols declared in
 * inner scopes shadow outer ones.
 */

import type {
    WorkflowDecl,
    ParamDecl,
    Statement,
    Expr,
    SourceLocation,
} from "workflow-dsl";

export type SymbolKind = "param" | "const" | "lambdaParam";

export interface SymbolDef {
    name: string;
    kind: SymbolKind;
    loc: SourceLocation;
}

export interface SymbolReference {
    name: string;
    loc: SourceLocation;
    def?: SymbolDef;
}

export interface TaskReference {
    /** Fully-qualified task name as written (e.g. "shell.exec"). */
    name: string;
    loc: SourceLocation;
}

export interface SymbolTable {
    defs: SymbolDef[];
    refs: SymbolReference[];
    taskRefs: TaskReference[];
}

class Scope {
    constructor(public readonly parent?: Scope) {}
    private readonly map = new Map<string, SymbolDef>();
    define(def: SymbolDef): void {
        this.map.set(def.name, def);
    }
    resolve(name: string): SymbolDef | undefined {
        return this.map.get(name) ?? this.parent?.resolve(name);
    }
}

class Resolver {
    readonly defs: SymbolDef[] = [];
    readonly refs: SymbolReference[] = [];
    readonly taskRefs: TaskReference[] = [];

    visit(wf: WorkflowDecl): void {
        const root = new Scope();
        for (const p of wf.params) this.defineParam(p, root);
        this.visitStatements(wf.body, root);
    }

    private defineParam(p: ParamDecl, scope: Scope): void {
        const def: SymbolDef = { name: p.name, kind: "param", loc: p.loc };
        scope.define(def);
        this.defs.push(def);
    }

    private defineLambdaParam(
        name: string,
        loc: SourceLocation,
        scope: Scope,
    ): void {
        const def: SymbolDef = { name, kind: "lambdaParam", loc };
        scope.define(def);
        this.defs.push(def);
    }

    private visitStatements(stmts: Statement[], scope: Scope): void {
        for (const s of stmts) this.visitStatement(s, scope);
    }

    private visitStatement(stmt: Statement, scope: Scope): void {
        switch (stmt.kind) {
            case "ConstStatement": {
                this.visitExpr(stmt.value, scope);
                if (!stmt.isSynthetic) {
                    const def: SymbolDef = {
                        name: stmt.name,
                        kind: "const",
                        loc: stmt.nameLoc,
                    };
                    scope.define(def);
                    this.defs.push(def);
                }
                return;
            }
            case "DestructuringConst": {
                this.visitExpr(stmt.value, scope);
                for (let i = 0; i < stmt.names.length; i++) {
                    const name = stmt.names[i]!;
                    const nameLoc = stmt.nameLocs[i] ?? stmt.loc;
                    const def: SymbolDef = {
                        name,
                        kind: "const",
                        loc: nameLoc,
                    };
                    scope.define(def);
                    this.defs.push(def);
                }
                return;
            }
            case "IfStatement": {
                this.visitExpr(stmt.condition, scope);
                this.visitStatements(stmt.then, new Scope(scope));
                if (stmt.else_)
                    this.visitStatements(stmt.else_, new Scope(scope));
                return;
            }
            case "SwitchStatement": {
                this.visitExpr(stmt.discriminant, scope);
                for (const arm of stmt.arms) {
                    this.visitExpr(arm.value, scope);
                    this.visitStatements(arm.body, new Scope(scope));
                }
                if (stmt.default_)
                    this.visitStatements(stmt.default_, new Scope(scope));
                return;
            }
            case "ThrowStatement":
            case "ReturnStatement": {
                this.visitExpr(stmt.value, scope);
                return;
            }
            case "BreakStatement":
                return;
        }
    }

    private visitExpr(expr: Expr, scope: Scope): void {
        switch (expr.kind) {
            case "DottedNameExpr": {
                const head = expr.segments[0]!;
                const def = scope.resolve(head);
                const ref: SymbolReference = { name: head, loc: expr.loc };
                if (def) ref.def = def;
                this.refs.push(ref);
                return;
            }
            case "TaskCallExpr": {
                this.taskRefs.push({ name: expr.task, loc: expr.loc });
                for (const arg of expr.args) this.visitExpr(arg.value, scope);
                return;
            }
            case "WorkflowCallExpr": {
                for (const arg of expr.args) this.visitExpr(arg.value, scope);
                return;
            }
            case "TemplateLiteralExpr": {
                for (const e of expr.expressions) this.visitExpr(e, scope);
                return;
            }
            case "ArrayLiteralExpr": {
                for (const e of expr.elements) this.visitExpr(e, scope);
                return;
            }
            case "ObjectLiteralExpr": {
                for (const entry of expr.entries)
                    this.visitExpr(entry.value, scope);
                return;
            }
            case "BinaryExpr": {
                this.visitExpr(expr.left, scope);
                this.visitExpr(expr.right, scope);
                return;
            }
            case "UnaryExpr":
                this.visitExpr(expr.operand, scope);
                return;
            case "TernaryExpr": {
                this.visitExpr(expr.condition, scope);
                this.visitExpr(expr.consequent, scope);
                this.visitExpr(expr.alternate, scope);
                return;
            }
            case "AttemptsNode": {
                this.visitExpr(expr.count, scope);
                this.visitStatements(expr.body, new Scope(scope));
                if (expr.fallback) {
                    const inner = new Scope(scope);
                    if (expr.fallback.param) {
                        this.defineLambdaParam(
                            expr.fallback.param,
                            expr.loc,
                            inner,
                        );
                    }
                    this.visitStatements(expr.fallback.body, inner);
                }
                return;
            }
            case "MapNode":
            case "FilterNode":
            case "ParallelMapNode": {
                this.visitExpr(expr.collection, scope);
                const inner = new Scope(scope);
                this.defineLambdaParam(expr.param, expr.loc, inner);
                this.visitStatements(expr.body, inner);
                if (expr.kind === "ParallelMapNode" && expr.maxConcurrency) {
                    this.visitExpr(expr.maxConcurrency, scope);
                }
                return;
            }
            case "ParallelNode": {
                for (const branch of expr.bodies) {
                    this.visitStatements(branch.body, new Scope(scope));
                }
                if (expr.maxConcurrency)
                    this.visitExpr(expr.maxConcurrency, scope);
                return;
            }
            case "StringLiteralExpr":
            case "NumberLiteralExpr":
            case "BooleanLiteralExpr":
            case "NullLiteralExpr":
                return;
        }
    }
}

export function buildSymbolTable(wf: WorkflowDecl): SymbolTable {
    const r = new Resolver();
    r.visit(wf);
    return { defs: r.defs, refs: r.refs, taskRefs: r.taskRefs };
}

/** Returns the reference whose identifier covers `(line, col)`, both 1-based. */
export function findReferenceAt(
    table: SymbolTable,
    line: number,
    col: number,
): SymbolReference | undefined {
    for (const r of table.refs) {
        if (
            r.loc.line === line &&
            col >= r.loc.col &&
            col <= r.loc.col + r.name.length
        ) {
            return r;
        }
    }
    return undefined;
}

/** Returns the task reference covering `(line, col)`. */
export function findTaskReferenceAt(
    table: SymbolTable,
    line: number,
    col: number,
): TaskReference | undefined {
    for (const t of table.taskRefs) {
        if (
            t.loc.line === line &&
            col >= t.loc.col &&
            col <= t.loc.col + t.name.length
        ) {
            return t;
        }
    }
    return undefined;
}
