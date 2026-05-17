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

import { WorkflowDecl, Statement, Expr, TypeExpr, TaskArg } from "./ast.js";
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

    constructor(taskSchemas: TaskSchemaInfo[], workflows: WorkflowDecl[] = []) {
        this.taskSchemaMap = new Map(taskSchemas.map((s) => [s.name, s]));
        this.workflowMap = new Map(workflows.map((w) => [w.name, w]));
    }

    check(wf: WorkflowDecl): TypeError[] {
        this.errors = [];
        const scope = new Scope();
        for (const p of wf.params) {
            scope.set(p.name, this.resolveTypeExpr(p.type));
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
        return this.errors;
    }

    private addError(msg: string, line: number, col: number): void {
        this.errors.push({ message: msg, line, col });
    }

    private resolveTypeExpr(te: TypeExpr): TypeInfo {
        return typeExprToInfo(te, (unknownType) => {
            this.addError(
                `Unknown type: '${unknownType.name}'`,
                unknownType.loc.line,
                unknownType.loc.col,
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
                scope.set(
                    s.name,
                    s.typeAnnotation
                        ? this.resolveTypeExpr(s.typeAnnotation)
                        : valueType,
                );
                return UNRESOLVED;
            }
            case "DestructuringConst": {
                const valueType = this.inferExpr(s.value, scope);
                if (valueType.kind === "tuple") {
                    for (let i = 0; i < s.names.length; i++) {
                        scope.set(
                            s.names[i],
                            i < valueType.elements.length
                                ? valueType.elements[i]
                                : UNRESOLVED,
                        );
                    }
                } else if (valueType.kind === "array") {
                    for (const name of s.names) {
                        scope.set(name, valueType.element);
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
                        );
                        return UNRESOLVED;
                    }
                    if (current.kind !== "object") {
                        this.addError(
                            `Cannot access property '${e.segments[i]}' on type '${typeName(current)}'`,
                            e.loc.line,
                            e.loc.col,
                        );
                        return UNRESOLVED;
                    }
                    const field = current.fields.get(e.segments[i]);
                    if (!field) {
                        this.addError(
                            `Property '${e.segments[i]}' does not exist on type '${typeName(current)}'`,
                            e.loc.line,
                            e.loc.col,
                        );
                        return UNRESOLVED;
                    }
                    current = field.type;
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
                    );
                    return UNRESOLVED;
                }
                this.checkArgs(e.args, scope);
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
                    fbScope.set(e.fallback.param, UNKNOWN);
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
}
