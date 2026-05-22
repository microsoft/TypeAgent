// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Workflow DSL type checker.
 *
 * Runs between parse and emit. Walks the AST, infers types for
 * expressions, validates operator usage, and reports type errors.
 *
 * The type system is simple: primitives (string, number, integer,
 * boolean), objects with typed fields, arrays with typed elements,
 * tuples (from parallel destructuring), never (bottom), and
 * unknown (from untyped JSON Schema `{}` properties).
 */

import {
    WorkflowDecl,
    Statement,
    Expr,
    TypeExpr,
    TaskArg,
    DEFAULT_FALLBACK_PARAM,
} from "./ast.js";
import { TaskSchemaInfo } from "./emitter.js";

// ---- Type representation ----

export type TypeInfo =
    | PrimitiveType
    | ObjectTypeInfo
    | ArrayTypeInfo
    | TupleTypeInfo
    | NeverType
    | UnknownType
    | UnresolvedType;

export interface PrimitiveType {
    kind: "primitive";
    name: "string" | "number" | "integer" | "boolean";
}

export interface ObjectTypeInfo {
    kind: "object";
    fields: Map<string, { type: TypeInfo; optional: boolean }>;
}

export interface ArrayTypeInfo {
    kind: "array";
    element: TypeInfo;
}

export interface TupleTypeInfo {
    kind: "tuple";
    elements: TypeInfo[];
}

export interface UnknownType {
    kind: "unknown";
}

export interface NeverType {
    kind: "never";
}

/** Internal error-recovery type. Compatible with everything to prevent cascading errors. */
export interface UnresolvedType {
    kind: "unresolved";
}

export interface TypeError {
    message: string;
    line: number;
    col: number;
    length: number;
}

/** Source location of a successfully resolved property access segment (e.g. `.stdout`). */
export interface PropertyRef {
    line: number;
    col: number;
    length: number;
}

// ---- Helpers ----

const STRING: PrimitiveType = { kind: "primitive", name: "string" };
const NUMBER: PrimitiveType = { kind: "primitive", name: "number" };
const BOOLEAN: PrimitiveType = { kind: "primitive", name: "boolean" };
const UNKNOWN: UnknownType = { kind: "unknown" };
const NEVER: NeverType = { kind: "never" };
const UNRESOLVED: UnresolvedType = { kind: "unresolved" };

function isNumeric(t: TypeInfo): boolean {
    return (
        t.kind === "primitive" && (t.name === "number" || t.name === "integer")
    );
}

function isBoolean(t: TypeInfo): boolean {
    return t.kind === "primitive" && t.name === "boolean";
}

function isUnresolved(t: TypeInfo): boolean {
    return t.kind === "unresolved";
}

function typeEq(a: TypeInfo, b: TypeInfo): boolean {
    // Unresolved (error recovery): compatible with everything.
    if (a.kind === "unresolved" || b.kind === "unresolved") return true;
    // never is the bottom type: source=never assignable to any target,
    // only never assignable to target=never.
    if (b.kind === "never") return true;
    if (a.kind === "never") return false;
    // unknown is the top type: anything assignable to target=unknown,
    // source=unknown not assignable to concrete.
    if (a.kind === "unknown") return true;
    if (b.kind === "unknown") return false;
    if (a.kind !== b.kind) return false;
    if (a.kind === "primitive" && b.kind === "primitive") {
        // integer is compatible with number
        if (
            (a.name === "integer" && b.name === "number") ||
            (a.name === "number" && b.name === "integer")
        )
            return true;
        return a.name === b.name;
    }
    return true; // structural comparison not needed for operator checks
}

function typeName(t: TypeInfo): string {
    switch (t.kind) {
        case "primitive":
            return t.name;
        case "object":
            return "object";
        case "array":
            return `${typeName(t.element)}[]`;
        case "tuple":
            return `[${t.elements.map(typeName).join(", ")}]`;
        case "unknown":
            return "unknown";
        case "never":
            return "never";
        case "unresolved":
            return "unresolved";
    }
}

/** Format a TypeInfo as a TypeScript-style type string suitable for display in hover text. */
export function formatType(t: TypeInfo): string {
    switch (t.kind) {
        case "primitive":
            return t.name;
        case "object": {
            if (t.fields.size === 0) return "{}";
            const parts: string[] = [];
            for (const [name, { type, optional }] of t.fields) {
                parts.push(
                    `${name}${optional ? "?" : ""}: ${formatType(type)}`,
                );
            }
            return `{ ${parts.join("; ")} }`;
        }
        case "array":
            return `${formatType(t.element)}[]`;
        case "tuple":
            return `[${t.elements.map(formatType).join(", ")}]`;
        case "unknown":
            return "unknown";
        case "never":
            return "never";
        case "unresolved":
            return "unknown";
    }
}

// ---- Scope ----

class Scope {
    private bindings = new Map<string, TypeInfo>();
    constructor(private parent?: Scope) {}

    get(name: string): TypeInfo | undefined {
        return this.bindings.get(name) ?? this.parent?.get(name);
    }

    set(name: string, type: TypeInfo): void {
        this.bindings.set(name, type);
    }

    child(): Scope {
        return new Scope(this);
    }
}

// ---- Converter: AST TypeExpr -> TypeInfo ----

function typeExprToInfo(
    te: TypeExpr,
    onUnknownType?: (te: Extract<TypeExpr, { kind: "NamedType" }>) => void,
): TypeInfo {
    switch (te.kind) {
        case "NamedType":
            switch (te.name) {
                case "string":
                    return STRING;
                case "number":
                    return NUMBER;
                case "integer":
                    return { kind: "primitive", name: "integer" };
                case "boolean":
                    return BOOLEAN;
                case "never":
                    return NEVER;
                case "unknown":
                    return UNKNOWN;
                default:
                    onUnknownType?.(te);
                    return UNRESOLVED;
            }
        case "ArrayType":
            return {
                kind: "array",
                element: typeExprToInfo(te.element, onUnknownType),
            };
        case "ObjectType": {
            const fields = new Map<
                string,
                { type: TypeInfo; optional: boolean }
            >();
            for (const f of te.fields) {
                fields.set(f.name, {
                    type: typeExprToInfo(f.type, onUnknownType),
                    optional: f.optional,
                });
            }
            return { kind: "object", fields };
        }
    }
}

// ---- Converter: JSON Schema -> TypeInfo ----

function jsonSchemaToTypeInfo(schema: Record<string, unknown>): TypeInfo {
    const type = schema["type"];
    if (type === "string") return STRING;
    if (type === "number") return NUMBER;
    if (type === "integer") return { kind: "primitive", name: "integer" };
    if (type === "boolean") return BOOLEAN;
    if (type === "array") {
        const items = schema["items"] as Record<string, unknown> | undefined;
        return {
            kind: "array",
            element: items ? jsonSchemaToTypeInfo(items) : UNKNOWN,
        };
    }
    if (type === "object") {
        const props = schema["properties"] as
            | Record<string, Record<string, unknown>>
            | undefined;
        const required = new Set((schema["required"] as string[]) ?? []);
        if (!props) return { kind: "object", fields: new Map() };
        const fields = new Map<string, { type: TypeInfo; optional: boolean }>();
        for (const [k, v] of Object.entries(props)) {
            fields.set(k, {
                type: jsonSchemaToTypeInfo(v),
                optional: !required.has(k),
            });
        }
        return { kind: "object", fields };
    }
    // { "not": {} } is the JSON Schema equivalent of never
    if (
        "not" in schema &&
        typeof schema["not"] === "object" &&
        schema["not"] !== null &&
        Object.keys(schema["not"] as object).length === 0
    ) {
        return NEVER;
    }
    return UNKNOWN;
}

// ---- Type checker ----

export class TypeChecker {
    private errors: TypeError[] = [];
    private taskSchemaMap: Map<string, TaskSchemaInfo>;
    private workflowMap: Map<string, WorkflowDecl>;
    private _propertyRefs: PropertyRef[] | null = null;
    private _symbolTypes: Map<number, TypeInfo> | null = null;

    constructor(taskSchemas: TaskSchemaInfo[], workflows: WorkflowDecl[] = []) {
        this.taskSchemaMap = new Map(taskSchemas.map((s) => [s.name, s]));
        this.workflowMap = new Map(workflows.map((w) => [w.name, w]));
    }

    /**
     * Type-check a single workflow body. Internal: invoked per workflow
     * by {@link checkAll}. Appends to {@link errors} rather than
     * replacing it, so multi-workflow checks accumulate diagnostics
     * across all bodies.
     */
    private checkOne(wf: WorkflowDecl): void {
        const scope = new Scope();
        const seenParams = new Set<string>();
        for (const p of wf.params) {
            if (seenParams.has(p.name)) {
                this.addError(
                    `Duplicate parameter '${p.name}' in workflow '${wf.name}'`,
                    p.loc.line,
                    p.loc.col,
                );
            }
            seenParams.add(p.name);
            const paramType = this.resolveTypeExpr(p.type);
            if (p.default) {
                // Defaults may reference earlier parameters of the same
                // workflow (§4.3); type-check in the partial scope built
                // so far, before binding this parameter.
                const defaultType = this.inferExpr(p.default, scope);
                if (
                    !isUnresolved(defaultType) &&
                    defaultType.kind !== "unknown" &&
                    !typeEq(paramType, defaultType)
                ) {
                    this.addError(
                        `Default value of type '${typeName(defaultType)}' is not assignable to parameter '${p.name}' of type '${typeName(paramType)}'`,
                        p.default.loc.line,
                        p.default.loc.col,
                    );
                }
            }
            scope.set(p.name, paramType);
        }
        const returnType = this.checkStatements(wf.body, scope);
        // Validate return type matches declaration
        const declared = this.resolveTypeExpr(wf.returnType);
        if (returnType.kind !== "unresolved" && !typeEq(declared, returnType)) {
            this.addError(
                `Workflow return type '${typeName(returnType)}' is not assignable to declared type '${typeName(declared)}'`,
                wf.loc.line,
                wf.loc.col,
            );
        }
    }

    /**
     * Type-check a whole module of workflows (Phase 3).
     *
     * Performs:
     *  - Task/workflow name-shadow ambiguity detection (a name declared as
     *    both a task and a workflow in the same file is an error).
     *  - Per-workflow type checking with the full workflow map in scope.
     *  - Static recursion detection across the workflow-call graph
     *    (direct or mutual cycles are an error; §2.4 of the design).
     */
    checkAll(workflows: WorkflowDecl[]): TypeError[] {
        this.errors = [];
        this.workflowMap = new Map(workflows.map((w) => [w.name, w]));

        // Ambiguous shadow: same name registered as both a task and a
        // workflow in the same translation unit.
        for (const w of workflows) {
            if (this.taskSchemaMap.has(w.name)) {
                this.addError(
                    `Workflow '${w.name}' shadows a task of the same name; rename one of them`,
                    w.loc.line,
                    w.loc.col,
                );
            }
        }

        // Duplicate workflow names: the parser does not enforce
        // uniqueness, so the type checker is the first place we catch
        // them.
        const seen = new Set<string>();
        for (const w of workflows) {
            if (seen.has(w.name)) {
                this.addError(
                    `Duplicate workflow declaration '${w.name}'`,
                    w.loc.line,
                    w.loc.col,
                );
            }
            seen.add(w.name);
        }

        // Per-workflow type check. `checkOne` appends to `this.errors`,
        // so diagnostics from every workflow accumulate naturally.
        for (const w of workflows) {
            this.checkOne(w);
        }

        // Static recursion check across the call graph.
        this.checkRecursion(workflows);

        return this.errors;
    }

    /**
     * DFS the workflow call graph and report any cycle (direct or
     * mutual recursion). Each WorkflowDecl is a node; its edges are
     * the targets of every `WorkflowCallExpr` found anywhere in its
     * body (including inside builtins / nested control flow). Each
     * edge carries the source location of the offending call so the
     * diagnostic is pinned at the user-visible call site (not the
     * callee declaration).
     */
    private checkRecursion(workflows: WorkflowDecl[]): void {
        interface Edge {
            target: string;
            line: number;
            col: number;
        }
        const edges = new Map<string, Edge[]>();
        for (const w of workflows) {
            const targets: Edge[] = [];
            collectWorkflowCalls(w.body, targets);
            edges.set(w.name, targets);
        }
        const WHITE = 0,
            GRAY = 1,
            BLACK = 2;
        const color = new Map<string, number>();
        for (const w of workflows) color.set(w.name, WHITE);
        const reported = new Set<string>();

        const visit = (name: string, stack: string[]): void => {
            color.set(name, GRAY);
            stack.push(name);
            for (const edge of edges.get(name) ?? []) {
                const tgt = edge.target;
                if (!edges.has(tgt)) continue;
                const c = color.get(tgt) ?? WHITE;
                if (c === GRAY) {
                    // Cycle closes at `edge` (call from `name` -> `tgt`).
                    const idx = stack.indexOf(tgt);
                    const cycle = stack.slice(idx).concat(tgt);
                    // Dedup by the canonical rotation of the cycle:
                    // two distinct cycles sharing members must not
                    // collapse together (only true rotations of the
                    // same cycle should).
                    const key = canonicalRotation(cycle.slice(0, -1));
                    if (!reported.has(key)) {
                        reported.add(key);
                        this.addError(
                            `Recursive workflow call detected: ${cycle.join(" -> ")} (workflow recursion is not supported; see design §2.4)`,
                            edge.line,
                            edge.col,
                        );
                    }
                } else if (c === WHITE) {
                    visit(tgt, stack);
                }
            }
            stack.pop();
            color.set(name, BLACK);
        };
        for (const w of workflows) {
            if ((color.get(w.name) ?? WHITE) === WHITE) visit(w.name, []);
        }
    }

    /**
     * Walk every workflow and return source locations of all
     * successfully resolved property-access segments
     * (segments[1..n] of a DottedNameExpr). Used by the LSP to emit
     * `property` semantic tokens for `.stdout` etc. across an entire
     * module.
     */
    collectPropertyRefs(workflows: WorkflowDecl[]): PropertyRef[] {
        const all: PropertyRef[] = [];
        for (const wf of workflows) {
            this._propertyRefs = [];
            const scope = new Scope();
            for (const p of wf.params) {
                scope.set(p.name, this.resolveTypeExpr(p.type));
            }
            this.checkStatements(wf.body, scope);
            all.push(...this._propertyRefs);
            this._propertyRefs = null;
        }
        return all;
    }

    /**
     * Walk every workflow and return a single map from declaration
     * offset to inferred TypeInfo. Keys are `def.loc.offset` values
     * from the symbol table, so hover and inlay hints can look up the
     * type of any symbol in any workflow without re-traversing the
     * AST. Offsets are file-wide unique, so merging per-workflow maps
     * is collision-free.
     *
     * Covers: workflow params, const bindings, destructuring bindings,
     * and lambda parameters (map/filter/parallelMap/attempts-fallback).
     */
    collectSymbolTypes(workflows: WorkflowDecl[]): Map<number, TypeInfo> {
        const merged = new Map<number, TypeInfo>();
        for (const wf of workflows) {
            this._symbolTypes = new Map();
            const scope = new Scope();
            // Params have explicit type annotations - store them before walking body.
            for (const p of wf.params) {
                const t = this.resolveTypeExpr(p.type);
                scope.set(p.name, t);
                if (p.loc.offset !== undefined) {
                    this._symbolTypes.set(p.loc.offset, t);
                }
            }
            this.checkStatements(wf.body, scope);
            for (const [k, v] of this._symbolTypes) {
                merged.set(k, v);
            }
            this._symbolTypes = null;
        }
        return merged;
    }

    private addError(
        msg: string,
        line: number,
        col: number,
        length: number = 1,
    ): void {
        this.errors.push({ message: msg, line, col, length });
    }

    private resolveTypeExpr(te: TypeExpr): TypeInfo {
        return typeExprToInfo(te, (unknownType) => {
            this.addError(
                `Unknown type: '${unknownType.name}'`,
                unknownType.loc.line,
                unknownType.loc.col,
                unknownType.name.length,
            );
        });
    }

    /** Check statements and return the inferred type of the first return found. */
    private checkStatements(stmts: Statement[], scope: Scope): TypeInfo {
        let returnType: TypeInfo = UNRESOLVED;
        for (const s of stmts) {
            const t = this.checkStatement(s, scope);
            if (returnType.kind === "unresolved" && t.kind !== "unresolved") {
                returnType = t;
            }
        }
        return returnType;
    }

    /** Check a statement. Returns the inferred return type if this is a return statement. */
    private checkStatement(s: Statement, scope: Scope): TypeInfo {
        switch (s.kind) {
            case "ConstStatement": {
                const valueType = this.inferExpr(s.value, scope);
                if (s.typeAnnotation) {
                    const declared = this.resolveTypeExpr(s.typeAnnotation);
                    if (
                        !isUnresolved(valueType) &&
                        !typeEq(declared, valueType)
                    ) {
                        this.addError(
                            `Type '${typeName(valueType)}' is not assignable to type '${typeName(declared)}'`,
                            s.loc.line,
                            s.loc.col,
                        );
                    }
                }
                const constType = s.typeAnnotation
                    ? this.resolveTypeExpr(s.typeAnnotation)
                    : valueType;
                scope.set(s.name, constType);
                if (this._symbolTypes && s.nameLoc.offset !== undefined) {
                    this._symbolTypes.set(s.nameLoc.offset, constType);
                }
                return UNRESOLVED;
            }
            case "DestructuringConst": {
                const valueType = this.inferExpr(s.value, scope);
                if (valueType.kind === "tuple") {
                    for (let i = 0; i < s.names.length; i++) {
                        const elemType =
                            i < valueType.elements.length
                                ? valueType.elements[i]!
                                : UNRESOLVED;
                        scope.set(s.names[i]!, elemType);
                        if (
                            this._symbolTypes &&
                            s.nameLocs[i] &&
                            s.nameLocs[i]!.offset !== undefined
                        ) {
                            this._symbolTypes.set(
                                s.nameLocs[i]!.offset!,
                                elemType,
                            );
                        }
                    }
                } else if (valueType.kind === "array") {
                    for (let i = 0; i < s.names.length; i++) {
                        scope.set(s.names[i]!, valueType.element);
                        if (
                            this._symbolTypes &&
                            s.nameLocs[i] &&
                            s.nameLocs[i]!.offset !== undefined
                        ) {
                            this._symbolTypes.set(
                                s.nameLocs[i]!.offset!,
                                valueType.element,
                            );
                        }
                    }
                } else if (
                    !isUnresolved(valueType) &&
                    valueType.kind !== "unknown"
                ) {
                    this.addError(
                        `Cannot destructure type '${typeName(valueType)}'; expected array or tuple`,
                        s.loc.line,
                        s.loc.col,
                    );
                    for (const name of s.names) {
                        scope.set(name, UNRESOLVED);
                    }
                } else {
                    for (const name of s.names) {
                        scope.set(name, UNRESOLVED);
                    }
                }
                return UNRESOLVED;
            }
            case "IfStatement": {
                const condType = this.inferExpr(s.condition, scope);
                if (
                    !isBoolean(condType) &&
                    !isUnresolved(condType) &&
                    condType.kind !== "unknown"
                ) {
                    this.addError(
                        `Condition must be boolean, got '${typeName(condType)}'`,
                        s.condition.loc.line,
                        s.condition.loc.col,
                    );
                }
                const thenType = this.checkStatements(s.then, scope.child());
                if (s.else_) {
                    this.checkStatements(s.else_, scope.child());
                }
                return thenType;
            }
            case "SwitchStatement": {
                this.inferExpr(s.discriminant, scope);
                let retType: TypeInfo = UNRESOLVED;
                for (const arm of s.arms) {
                    this.inferExpr(arm.value, scope);
                    const t = this.checkStatements(arm.body, scope.child());
                    if (retType.kind === "unresolved") retType = t;
                }
                if (s.default_) {
                    this.checkStatements(s.default_, scope.child());
                }
                return retType;
            }
            case "ThrowStatement":
                this.inferExpr(s.value, scope);
                return NEVER;
            case "ReturnStatement":
                return this.inferExpr(s.value, scope);
            case "BreakStatement":
                return UNRESOLVED;
        }
    }

    // ---- Expression type inference ----

    private inferExpr(e: Expr, scope: Scope): TypeInfo {
        switch (e.kind) {
            case "StringLiteralExpr":
                return STRING;
            case "NumberLiteralExpr":
                return Number.isInteger(e.value)
                    ? { kind: "primitive", name: "integer" }
                    : NUMBER;
            case "BooleanLiteralExpr":
                return BOOLEAN;
            case "NullLiteralExpr":
                return UNKNOWN;
            case "TemplateLiteralExpr":
                for (const expr of e.expressions) {
                    this.inferExpr(expr, scope);
                }
                return STRING;
            case "ArrayLiteralExpr": {
                if (e.elements.length === 0)
                    return { kind: "array", element: UNKNOWN };
                const elemType = this.inferExpr(e.elements[0], scope);
                for (let i = 1; i < e.elements.length; i++) {
                    this.inferExpr(e.elements[i], scope);
                }
                return { kind: "array", element: elemType };
            }
            case "ObjectLiteralExpr": {
                const fields = new Map<
                    string,
                    { type: TypeInfo; optional: boolean }
                >();
                for (const entry of e.entries) {
                    fields.set(entry.key, {
                        type: this.inferExpr(entry.value, scope),
                        optional: false,
                    });
                }
                return { kind: "object", fields };
            }
            case "DottedNameExpr": {
                if (e.segments.length === 1) {
                    const t = scope.get(e.segments[0]);
                    if (!t) {
                        this.addError(
                            `Unknown reference: '${e.segments[0]}'`,
                            e.loc.line,
                            e.loc.col,
                            e.segments[0].length,
                        );
                        return UNRESOLVED;
                    }
                    return t;
                }
                // Multi-segment: resolve first, then field access
                let current = scope.get(e.segments[0]);
                if (!current) {
                    this.addError(
                        `Unknown reference: '${e.segments[0]}'`,
                        e.loc.line,
                        e.loc.col,
                        e.segments[0].length,
                    );
                    return UNRESOLVED;
                }
                for (let i = 1; i < e.segments.length; i++) {
                    if (isUnresolved(current)) {
                        return UNRESOLVED;
                    }
                    if (current.kind === "unknown") {
                        this.addError(
                            `Cannot access property '${e.segments[i]}' on unknown type`,
                            e.loc.line,
                            e.loc.col,
                            e.segments[i].length,
                        );
                        return UNRESOLVED;
                    }
                    if (current.kind !== "object") {
                        this.addError(
                            `Cannot access property '${e.segments[i]}' on type '${typeName(current)}'`,
                            e.loc.line,
                            e.loc.col,
                            e.segments[i].length,
                        );
                        return UNRESOLVED;
                    }
                    const field = current.fields.get(e.segments[i]);
                    if (!field) {
                        this.addError(
                            `Property '${e.segments[i]}' does not exist on type '${typeName(current)}'`,
                            e.loc.line,
                            e.loc.col,
                            e.segments[i].length,
                        );
                        return UNRESOLVED;
                    }
                    current = field.type;
                    // Record this segment as a successfully resolved property.
                    if (this._propertyRefs && e.segmentLocs?.[i]) {
                        const loc = e.segmentLocs[i]!;
                        this._propertyRefs.push({
                            line: loc.line,
                            col: loc.col,
                            length: e.segments[i].length,
                        });
                    }
                }
                return current;
            }
            case "TaskCallExpr": {
                const schema = this.taskSchemaMap.get(e.task);
                if (!schema) {
                    this.addError(
                        `Unknown task: '${e.task}'`,
                        e.loc.line,
                        e.loc.col,
                        e.task.length,
                    );
                    return UNRESOLVED;
                }
                this.checkArgs(e.args, scope);
                return jsonSchemaToTypeInfo(
                    schema.outputSchema as Record<string, unknown>,
                );
            }
            case "WorkflowCallExpr": {
                const wf = this.workflowMap.get(e.name);
                if (!wf) {
                    this.addError(
                        `Unknown workflow: '${e.name}'`,
                        e.loc.line,
                        e.loc.col,
                        e.name.length,
                    );
                    return UNRESOLVED;
                }
                this.checkWorkflowCallArgs(wf, e.args, scope, e.loc);
                return this.resolveTypeExpr(wf.returnType);
            }
            case "BinaryExpr":
                return this.inferBinaryExpr(e, scope);
            case "UnaryExpr":
                return this.inferUnaryExpr(e, scope);
            case "TernaryExpr": {
                const condType = this.inferExpr(e.condition, scope);
                if (
                    !isBoolean(condType) &&
                    !isUnresolved(condType) &&
                    condType.kind !== "unknown"
                ) {
                    this.addError(
                        `Ternary condition must be boolean, got '${typeName(condType)}'`,
                        e.condition.loc.line,
                        e.condition.loc.col,
                    );
                }
                const consType = this.inferExpr(e.consequent, scope);
                const altType = this.inferExpr(e.alternate, scope);
                // never is the bottom type: if one arm is never, the
                // result is the other arm's type (matches TypeScript).
                if (consType.kind === "never") return altType;
                if (altType.kind === "never") return consType;
                if (!typeEq(consType, altType)) {
                    this.addError(
                        `Ternary arms must have the same type: '${typeName(consType)}' vs '${typeName(altType)}'`,
                        e.loc.line,
                        e.loc.col,
                    );
                }
                return consType;
            }
            case "AttemptsNode": {
                const countType = this.inferExpr(e.count, scope);
                if (
                    !isNumeric(countType) &&
                    !isUnresolved(countType) &&
                    countType.kind !== "unknown"
                ) {
                    this.addError(
                        `attempts() count must be numeric, got '${typeName(countType)}'`,
                        e.count.loc.line,
                        e.count.loc.col,
                    );
                }
                const bodyReturnType = this.checkStatements(
                    e.body,
                    scope.child(),
                );
                if (e.fallback) {
                    const fbScope = scope.child();
                    const fbParam = e.fallback.param ?? DEFAULT_FALLBACK_PARAM;
                    fbScope.set(fbParam, UNKNOWN);
                    if (
                        this._symbolTypes &&
                        e.fallback.param &&
                        e.fallback.paramLoc &&
                        e.fallback.paramLoc.offset !== undefined
                    ) {
                        this._symbolTypes.set(
                            e.fallback.paramLoc.offset,
                            UNKNOWN,
                        );
                    }
                    this.checkStatements(e.fallback.body, fbScope);
                }
                return bodyReturnType;
            }
            case "MapNode": {
                const colType = this.inferExpr(e.collection, scope);
                const bodyScope = scope.child();
                if (colType.kind === "array") {
                    bodyScope.set(e.param, colType.element);
                } else if (
                    isUnresolved(colType) ||
                    colType.kind === "unknown"
                ) {
                    bodyScope.set(e.param, UNKNOWN);
                } else {
                    this.addError(
                        `map() collection must be an array, got '${typeName(colType)}'`,
                        e.collection.loc.line,
                        e.collection.loc.col,
                    );
                    bodyScope.set(e.param, UNKNOWN);
                }
                if (
                    this._symbolTypes &&
                    e.paramLoc &&
                    e.paramLoc.offset !== undefined
                ) {
                    this._symbolTypes.set(
                        e.paramLoc.offset,
                        bodyScope.get(e.param) ?? UNKNOWN,
                    );
                }
                const mapReturnType = this.checkStatements(e.body, bodyScope);
                return { kind: "array", element: mapReturnType };
            }
            case "FilterNode": {
                const colType = this.inferExpr(e.collection, scope);
                const bodyScope = scope.child();
                if (colType.kind === "array") {
                    bodyScope.set(e.param, colType.element);
                } else if (
                    isUnresolved(colType) ||
                    colType.kind === "unknown"
                ) {
                    bodyScope.set(e.param, UNKNOWN);
                } else {
                    this.addError(
                        `filter() collection must be an array, got '${typeName(colType)}'`,
                        e.collection.loc.line,
                        e.collection.loc.col,
                    );
                    bodyScope.set(e.param, UNKNOWN);
                }
                if (
                    this._symbolTypes &&
                    e.paramLoc &&
                    e.paramLoc.offset !== undefined
                ) {
                    this._symbolTypes.set(
                        e.paramLoc.offset,
                        bodyScope.get(e.param) ?? UNKNOWN,
                    );
                }
                this.checkStatements(e.body, bodyScope);
                return colType;
            }
            case "ParallelNode": {
                const elemTypes: TypeInfo[] = [];
                for (const branch of e.bodies) {
                    const branchScope = scope.child();
                    const branchType = this.checkStatements(
                        branch.body,
                        branchScope,
                    );
                    elemTypes.push(branchType);
                }
                if (e.maxConcurrency) {
                    const mcType = this.inferExpr(e.maxConcurrency, scope);
                    if (
                        !isNumeric(mcType) &&
                        !isUnresolved(mcType) &&
                        mcType.kind !== "unknown"
                    ) {
                        this.addError(
                            `maxConcurrency must be numeric, got '${typeName(mcType)}'`,
                            e.loc.line,
                            e.loc.col,
                        );
                    }
                }
                return { kind: "tuple", elements: elemTypes };
            }
            case "ParallelMapNode": {
                const colType = this.inferExpr(e.collection, scope);
                const bodyScope = scope.child();
                if (colType.kind === "array") {
                    bodyScope.set(e.param, colType.element);
                } else if (
                    isUnresolved(colType) ||
                    colType.kind === "unknown"
                ) {
                    bodyScope.set(e.param, UNKNOWN);
                } else {
                    this.addError(
                        `parallelMap() collection must be an array, got '${typeName(colType)}'`,
                        e.collection.loc.line,
                        e.collection.loc.col,
                    );
                    bodyScope.set(e.param, UNKNOWN);
                }
                if (
                    this._symbolTypes &&
                    e.paramLoc &&
                    e.paramLoc.offset !== undefined
                ) {
                    this._symbolTypes.set(
                        e.paramLoc.offset,
                        bodyScope.get(e.param) ?? UNKNOWN,
                    );
                }
                const pmReturnType = this.checkStatements(e.body, bodyScope);
                if (e.maxConcurrency) {
                    const mcType = this.inferExpr(e.maxConcurrency, scope);
                    if (
                        !isNumeric(mcType) &&
                        !isUnresolved(mcType) &&
                        mcType.kind !== "unknown"
                    ) {
                        this.addError(
                            `maxConcurrency must be numeric, got '${typeName(mcType)}'`,
                            e.loc.line,
                            e.loc.col,
                        );
                    }
                }
                return { kind: "array", element: pmReturnType };
            }
        }
    }

    private inferBinaryExpr(
        e: Extract<Expr, { kind: "BinaryExpr" }>,
        scope: Scope,
    ): TypeInfo {
        const left = this.inferExpr(e.left, scope);
        const right = this.inferExpr(e.right, scope);

        switch (e.op) {
            case "+":
            case "-":
            case "*":
            case "/":
            case "%":
                if (!isNumeric(left)) {
                    this.addError(
                        `Left operand of '${e.op}' must be numeric, got '${typeName(left)}'`,
                        e.left.loc.line,
                        e.left.loc.col,
                    );
                }
                if (!isNumeric(right)) {
                    this.addError(
                        `Right operand of '${e.op}' must be numeric, got '${typeName(right)}'`,
                        e.right.loc.line,
                        e.right.loc.col,
                    );
                }
                return NUMBER;

            case "===":
            case "!==":
                if (
                    left.kind !== "never" &&
                    right.kind !== "never" &&
                    left.kind !== "unknown" &&
                    right.kind !== "unknown" &&
                    !typeEq(left, right)
                ) {
                    this.addError(
                        `Operator '${e.op}' requires same types on both sides: '${typeName(left)}' vs '${typeName(right)}'`,
                        e.loc.line,
                        e.loc.col,
                    );
                }
                return BOOLEAN;

            case ">":
            case "<":
            case ">=":
            case "<=":
                if (!isNumeric(left)) {
                    this.addError(
                        `Left operand of '${e.op}' must be numeric, got '${typeName(left)}'`,
                        e.left.loc.line,
                        e.left.loc.col,
                    );
                }
                if (!isNumeric(right)) {
                    this.addError(
                        `Right operand of '${e.op}' must be numeric, got '${typeName(right)}'`,
                        e.right.loc.line,
                        e.right.loc.col,
                    );
                }
                return BOOLEAN;

            case "&&":
            case "||":
                if (!isBoolean(left)) {
                    this.addError(
                        `Left operand of '${e.op}' must be boolean, got '${typeName(left)}'`,
                        e.left.loc.line,
                        e.left.loc.col,
                    );
                }
                if (!isBoolean(right)) {
                    this.addError(
                        `Right operand of '${e.op}' must be boolean, got '${typeName(right)}'`,
                        e.right.loc.line,
                        e.right.loc.col,
                    );
                }
                return BOOLEAN;
        }
    }

    private inferUnaryExpr(
        e: Extract<Expr, { kind: "UnaryExpr" }>,
        scope: Scope,
    ): TypeInfo {
        const operand = this.inferExpr(e.operand, scope);
        switch (e.op) {
            case "!":
                if (
                    !isBoolean(operand) &&
                    !isUnresolved(operand) &&
                    operand.kind !== "unknown"
                ) {
                    this.addError(
                        `Operand of '!' must be boolean, got '${typeName(operand)}'`,
                        e.operand.loc.line,
                        e.operand.loc.col,
                    );
                }
                return BOOLEAN;
            case "-":
                if (
                    !isNumeric(operand) &&
                    !isUnresolved(operand) &&
                    operand.kind !== "unknown"
                ) {
                    this.addError(
                        `Operand of unary '-' must be numeric, got '${typeName(operand)}'`,
                        e.operand.loc.line,
                        e.operand.loc.col,
                    );
                }
                return NUMBER;
        }
    }

    private checkArgs(args: TaskArg[], scope: Scope): void {
        for (const arg of args) {
            this.inferExpr(arg.value, scope);
        }
    }

    /**
     * Check arguments for a workflow call against the callee's parameters.
     *
     * Accepts three surface forms (P3):
     *   - Positional only: arguments map by index.
     *   - Mixed positional + named: positional must come first; the
     *     first named arg marks the end of positional binding.
     *   - Single object-literal argument (named-record): destructures
     *     against parameter names.
     *
     * Reports type errors for arity mismatch (after defaults), unknown
     * named keys, duplicate bindings, and per-argument type mismatch.
     */
    private checkWorkflowCallArgs(
        wf: WorkflowDecl,
        args: TaskArg[],
        scope: Scope,
        loc: SourceLocationLike,
    ): void {
        // Detect named-record form: single positional argument that is
        // an object literal expression.
        const recordForm =
            args.length === 1 &&
            args[0].kind === "PositionalArg" &&
            args[0].value.kind === "ObjectLiteralExpr";

        type Binding = { value: Expr; from: "positional" | "named" | "record" };
        const bound = new Map<string, Binding>();
        if (recordForm) {
            const obj = args[0].value as Extract<
                Expr,
                { kind: "ObjectLiteralExpr" }
            >;
            const paramNames = new Set(wf.params.map((p) => p.name));
            for (const entry of obj.entries) {
                if (!paramNames.has(entry.key)) {
                    this.addError(
                        `Unknown parameter '${entry.key}' in call to workflow '${wf.name}'`,
                        entry.loc.line,
                        entry.loc.col,
                    );
                    continue;
                }
                if (bound.has(entry.key)) {
                    this.addError(
                        `Parameter '${entry.key}' is bound more than once in call to '${wf.name}'`,
                        entry.loc.line,
                        entry.loc.col,
                    );
                    continue;
                }
                bound.set(entry.key, { value: entry.value, from: "record" });
            }
        } else {
            // Positional and named mix; positional must come first.
            let seenNamed = false;
            let posIdx = 0;
            for (const arg of args) {
                if (arg.kind === "NamedArg") {
                    seenNamed = true;
                    const param = wf.params.find((p) => p.name === arg.name);
                    if (!param) {
                        this.addError(
                            `Unknown parameter '${arg.name}' in call to workflow '${wf.name}'`,
                            arg.value.loc.line,
                            arg.value.loc.col,
                        );
                        continue;
                    }
                    if (bound.has(arg.name)) {
                        this.addError(
                            `Parameter '${arg.name}' is bound more than once in call to '${wf.name}'`,
                            arg.value.loc.line,
                            arg.value.loc.col,
                        );
                        continue;
                    }
                    bound.set(arg.name, { value: arg.value, from: "named" });
                } else {
                    if (seenNamed) {
                        this.addError(
                            `Positional argument follows named argument in call to '${wf.name}'`,
                            arg.value.loc.line,
                            arg.value.loc.col,
                        );
                        continue;
                    }
                    if (posIdx >= wf.params.length) {
                        this.addError(
                            `Too many arguments in call to workflow '${wf.name}' (expected at most ${wf.params.length})`,
                            arg.value.loc.line,
                            arg.value.loc.col,
                        );
                        continue;
                    }
                    const param = wf.params[posIdx++];
                    bound.set(param.name, {
                        value: arg.value,
                        from: "positional",
                    });
                }
            }
        }

        // Missing parameters: ones with no binding and no default.
        for (const p of wf.params) {
            if (!bound.has(p.name) && !p.default) {
                this.addError(
                    `Missing required parameter '${p.name}' in call to workflow '${wf.name}'`,
                    loc.line,
                    loc.col,
                );
            }
        }

        // Per-argument type check.
        for (const p of wf.params) {
            const b = bound.get(p.name);
            if (!b) continue;
            const declared = this.resolveTypeExpr(p.type);
            const actual = this.inferExpr(b.value, scope);
            if (
                !isUnresolved(actual) &&
                actual.kind !== "unknown" &&
                !typeEq(declared, actual)
            ) {
                this.addError(
                    `Argument of type '${typeName(actual)}' is not assignable to parameter '${p.name}' of type '${typeName(declared)}'`,
                    b.value.loc.line,
                    b.value.loc.col,
                );
            }
        }
    }
}

interface SourceLocationLike {
    line: number;
    col: number;
}

/**
 * Walk a statement list and collect every workflow call expression
 * encountered (used for the static recursion check). Each entry
 * carries the call's source location so the diagnostic can point at
 * the call site rather than the callee declaration. The traversal
 * descends into nested control flow and builtin nodes.
 */
interface CallEdge {
    target: string;
    line: number;
    col: number;
}

function collectWorkflowCalls(stmts: Statement[], out: CallEdge[]): void {
    for (const s of stmts) {
        walkStmt(s, out);
    }
}

function walkStmt(s: Statement, out: CallEdge[]): void {
    switch (s.kind) {
        case "ConstStatement":
        case "DestructuringConst":
            walkExpr(s.value, out);
            return;
        case "ReturnStatement":
            if (s.value) walkExpr(s.value, out);
            return;
        case "ThrowStatement":
            walkExpr(s.value, out);
            return;
        case "IfStatement":
            walkExpr(s.condition, out);
            collectWorkflowCalls(s.then, out);
            if (s.else_) collectWorkflowCalls(s.else_, out);
            return;
        case "SwitchStatement":
            walkExpr(s.discriminant, out);
            for (const arm of s.arms) collectWorkflowCalls(arm.body, out);
            if (s.default_) collectWorkflowCalls(s.default_, out);
            return;
        case "BreakStatement":
            return;
    }
}

function walkExpr(e: Expr, out: CallEdge[]): void {
    switch (e.kind) {
        case "WorkflowCallExpr":
            out.push({ target: e.name, line: e.loc.line, col: e.loc.col });
            for (const a of e.args) walkExpr(a.value, out);
            return;
        case "TaskCallExpr":
            for (const a of e.args) walkExpr(a.value, out);
            return;
        case "BinaryExpr":
            walkExpr(e.left, out);
            walkExpr(e.right, out);
            return;
        case "UnaryExpr":
            walkExpr(e.operand, out);
            return;
        case "TernaryExpr":
            walkExpr(e.condition, out);
            walkExpr(e.consequent, out);
            walkExpr(e.alternate, out);
            return;
        case "DottedNameExpr":
        case "StringLiteralExpr":
        case "NumberLiteralExpr":
        case "BooleanLiteralExpr":
        case "NullLiteralExpr":
            return;
        case "TemplateLiteralExpr":
            for (const part of e.expressions) walkExpr(part, out);
            return;
        case "ArrayLiteralExpr":
            for (const el of e.elements) walkExpr(el, out);
            return;
        case "ObjectLiteralExpr":
            for (const en of e.entries) walkExpr(en.value, out);
            return;
        case "AttemptsNode":
            walkExpr(e.count, out);
            collectWorkflowCalls(e.body, out);
            if (e.fallback) collectWorkflowCalls(e.fallback.body, out);
            return;
        case "MapNode":
        case "FilterNode":
            walkExpr(e.collection, out);
            collectWorkflowCalls(e.body, out);
            return;
        case "ParallelNode":
            for (const br of e.bodies) collectWorkflowCalls(br.body, out);
            return;
        case "ParallelMapNode":
            walkExpr(e.collection, out);
            collectWorkflowCalls(e.body, out);
            return;
    }
}

/**
 * Returns a stable key for a cycle that is invariant under rotation
 * but distinguishes cycles that merely share members. Pick the
 * lexicographically smallest rotation of the cycle's node sequence.
 */
function canonicalRotation(cycle: string[]): string {
    if (cycle.length === 0) return "";
    let best = cycle.join("|");
    for (let i = 1; i < cycle.length; i++) {
        const rot = cycle.slice(i).concat(cycle.slice(0, i)).join("|");
        if (rot < best) best = rot;
    }
    return best;
}
