// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Workflow DSL emitter: AST -> WorkflowIR.
 *
 * Walks the AST and produces the flat IR JSON consumed by the engine.
 * Key responsibilities:
 *
 * - Scope-based name resolution (params, const bindings, node outputs)
 * - Conditional `bind`: only emit when a binding is referenced downstream
 * - Thread `next` edges from statement order
 * - Lower built-in expressions (attempts, map, filter, parallel, parallelMap)
 *   to LoopNode / ForkNode / ForkMapNode IR
 * - Lower operators to task node calls
 * - Lower if/switch to BranchNode IR
 * - Lower ternary to inline branch node
 * - Lower throw to error.fail task node
 * - Lower sub-workflow calls (inline expansion)
 */

import {
    WorkflowIR,
    WorkflowBody,
    WorkflowNode,
    TaskNode,
    BranchNode,
    BranchArm,
    LoopNode,
    ForkNode,
    ForkMapNode,
    WorkflowCallNode,
    LoopStateVar,
    Template,
    JSONSchema,
    SchemaTemplate,
    WorkflowScope,
} from "workflow-model";
import {
    WorkflowDecl,
    Statement,
    Expr,
    TypeExpr,
    TaskCallExpr,
    TemplateLiteralExpr,
    BinaryExpr,
    UnaryExpr,
    TernaryExpr,
    AttemptsNode,
    MapNode,
    FilterNode,
    ParallelNode,
    ParallelMapNode,
    DEFAULT_FALLBACK_PARAM,
} from "./ast.js";
import { decodeStringLiteral, decodeTemplatePart } from "./literal.js";
import { ResolvedTaskSchemas, typeExprToSchema } from "./typeParamUtils.js";
import { TypeInfo, typeInfoToSchema } from "./typeChecker.js";

export interface TaskSchemaTypeParam {
    name: string;
    default?: JSONSchema;
}

/** A non-generic task schema: fixed JSON Schema for input/output. */
export interface ConcreteTaskSchemaInfo {
    name: string;
    inputSchema: JSONSchema;
    outputSchema: JSONSchema;
}

/** A generic task schema with type parameters and schema templates. */
export interface GenericTaskSchemaInfo {
    name: string;
    inputSchema: SchemaTemplate;
    outputSchema: SchemaTemplate;
    typeParameters: TaskSchemaTypeParam[];
}

export type TaskSchemaInfo = ConcreteTaskSchemaInfo | GenericTaskSchemaInfo;

/** Type guard: narrows a TaskSchemaInfo to its generic variant. */
export function isGenericSchema(
    schema: TaskSchemaInfo,
): schema is GenericTaskSchemaInfo {
    return "typeParameters" in schema;
}

export interface EmitError {
    message: string;
    line: number;
    col: number;
    length: number;
}

// ---- Binding: how a name resolves in scope ----

type BindingKind =
    | "node"
    | "param"
    | "constant"
    | "loopInput"
    | "recoveryInput"
    | "literal";

interface Binding {
    kind: BindingKind;
    /** For "node": the node ID. For "loopInput": the input name. */
    nodeId?: string | undefined;
    /** For "literal": the literal value. */
    value?: Template | undefined;
    /** Explicit path to project through when resolving this binding. */
    path?: string[] | undefined;
}

interface ScopeContext {
    nodes: Record<string, WorkflowNode>;
    nodeOrder: string[];
    bindings: Map<string, Binding>;
    parent?: ScopeContext | undefined;
}

function inferCommonType(
    values: ReadonlyArray<unknown>,
): "string" | "number" | "integer" | "boolean" | undefined {
    if (values.length === 0) return undefined;
    let inferred: "string" | "number" | "integer" | "boolean" | undefined;
    for (const v of values) {
        let t: "string" | "number" | "integer" | "boolean" | undefined;
        if (typeof v === "string") t = "string";
        else if (typeof v === "boolean") t = "boolean";
        else if (typeof v === "number")
            t = Number.isInteger(v) ? "integer" : "number";
        else return undefined;
        if (inferred === undefined) {
            inferred = t;
        } else if (inferred !== t) {
            // Allow integer/number mixing as "number".
            if (
                (inferred === "integer" && t === "number") ||
                (inferred === "number" && t === "integer")
            ) {
                inferred = "number";
            } else {
                return undefined;
            }
        }
    }
    return inferred;
}

export class Emitter {
    private errors: EmitError[] = [];
    private taskSchemas: Map<string, TaskSchemaInfo>;
    private resolvedSchemas: ReadonlyMap<number, ResolvedTaskSchemas>;
    private symbolTypes: ReadonlyMap<number, TypeInfo>;
    private nodeCounter = 0;
    private constants: Record<string, { schema: JSONSchema; value: unknown }> =
        {};
    /** Set of node IDs that are referenced by expressions */
    private referencedNodes = new Set<string>();
    /**
     * Map of workflow name -> declaration, populated by `emitAll` so
     * `emitWorkflowCall` can look up callee parameters / schemas for
     * argument lowering. Empty when a single-workflow `emit(ast)` is
     * called directly (legacy path; workflow calls are not allowed in
     * that mode because the callee is unreachable).
     */
    private workflowMap: Map<string, WorkflowDecl> = new Map();
    /** Cached (input,output) schemas per workflow, used by WorkflowCallNode. */
    private workflowSchemas: Map<
        string,
        { input: JSONSchema; output: JSONSchema }
    > = new Map();

    constructor(
        taskSchemas: TaskSchemaInfo[],
        resolvedSchemas: ReadonlyMap<number, ResolvedTaskSchemas>,
        symbolTypes?: ReadonlyMap<number, TypeInfo>,
    ) {
        this.taskSchemas = new Map(taskSchemas.map((t) => [t.name, t]));
        this.resolvedSchemas = resolvedSchemas;
        this.symbolTypes = symbolTypes ?? new Map();
    }

    /**
     * Look up pre-resolved schemas by source offset. Emits an error and
     * returns undefined if the entry is missing (indicates a type checker
     * bug or a missing resolution pass).
     */
    private getResolvedSchemas(
        offset: number,
        loc: { line: number; col: number },
        desc: string,
    ): ResolvedTaskSchemas | undefined {
        const cached = this.resolvedSchemas.get(offset);
        if (!cached) {
            this.emitError(
                `Missing resolved schemas for ${desc}`,
                loc.line,
                loc.col,
            );
            return undefined;
        }
        return cached;
    }

    /**
     * Emit a multi-workflow IR. The `entryName` selects which workflow's
     * inputs/outputs become the artifact's top-level surface; every
     * workflow in the input list is emitted into the IR's `workflows`
     * table so it can be invoked as a sub-workflow.
     */
    emitAll(
        workflows: WorkflowDecl[],
        entryName: string,
    ): { ir: WorkflowIR | undefined; errors: EmitError[] } {
        this.errors = [];
        this.nodeCounter = 0;
        this.constants = {};
        this.referencedNodes = new Set();

        if (workflows.length === 0) {
            this.emitError("No workflows to emit", 0, 0);
            return { ir: undefined, errors: this.errors };
        }
        const entryDecl = workflows.find((w) => w.name === entryName);
        if (!entryDecl) {
            this.emitError(
                `Entry workflow '${entryName}' not found in input`,
                workflows[0].loc.line,
                workflows[0].loc.col,
            );
            return { ir: undefined, errors: this.errors };
        }

        this.workflowMap = new Map(workflows.map((w) => [w.name, w]));
        this.workflowSchemas = new Map();
        for (const w of workflows) {
            this.workflowSchemas.set(w.name, {
                input: this.paramsToSchema(w.params),
                output: typeExprToSchema(w.returnType),
            });
        }

        const bodies: Record<string, WorkflowBody> = {};
        for (const w of workflows) {
            const body = this.emitWorkflowBody(w);
            if (!body) continue;
            bodies[w.name] = body;
        }
        if (this.errors.length > 0) {
            return { ir: undefined, errors: this.errors };
        }

        const ir: WorkflowIR = {
            kind: "workflow",
            version: "1",
            ...(entryDecl.description
                ? { description: entryDecl.description }
                : {}),
            ...(Object.keys(this.constants).length > 0
                ? { constants: this.constants }
                : {}),
            entry: entryName,
            workflows: bodies,
        };
        return { ir, errors: this.errors };
    }

    /**
     * Emit a single workflow into a WorkflowBody (the value stored in
     * `WorkflowIR.workflows[name]`). Called per workflow by emitAll.
     */
    private emitWorkflowBody(ast: WorkflowDecl): WorkflowBody | undefined {
        const inputSchema = this.paramsToSchema(ast.params);
        const outputSchema = typeExprToSchema(ast.returnType);

        const rootScope: ScopeContext = {
            nodes: {},
            nodeOrder: [],
            bindings: new Map(),
        };
        for (const p of ast.params) {
            rootScope.bindings.set(p.name, { kind: "param" });
        }

        let outputTemplate: Template | undefined;

        for (const stmt of ast.body) {
            const result = this.emitStatement(stmt, rootScope);
            if (result?.output !== undefined) {
                outputTemplate = result.output;
            }
        }

        this.threadNext(rootScope);

        // If the workflow has an output but no nodes (pure-literal return),
        // wrap the return value in an identity node so the engine has an
        // entry point.
        if (outputTemplate !== undefined && rootScope.nodeOrder.length === 0) {
            const wrapId = this.freshId("return");
            const wrapNode: TaskNode = {
                kind: "task",
                task: "identity",
                inputSchema: {
                    type: "object",
                    required: ["value"],
                    properties: { value: {} },
                },
                outputSchema: outputSchema,
                inputs: { value: outputTemplate },
                bind: wrapId,
            };
            rootScope.nodes[wrapId] = wrapNode;
            rootScope.nodeOrder.push(wrapId);
            this.referencedNodes.add(wrapId);
            outputTemplate = {
                $from: "scope",
                name: wrapId,
            } as unknown as Template;
        }

        this.stripUnreferencedBinds(rootScope);

        return {
            inputSchema,
            outputSchema,
            nodes: rootScope.nodes,
            entry: rootScope.nodeOrder.length > 0 ? rootScope.nodeOrder[0] : "",
            output:
                outputTemplate ??
                ({ $from: "input", name: "" } as unknown as Template),
        };
    }

    // ---- Statement emission ----

    private emitStatement(
        stmt: Statement,
        scope: ScopeContext,
    ): { output?: Template } | undefined {
        switch (stmt.kind) {
            case "ConstStatement":
                this.emitConst(stmt, scope);
                return undefined;
            case "DestructuringConst":
                this.emitDestructuring(stmt, scope);
                return undefined;
            case "IfStatement":
                return this.emitIf(stmt, scope);
            case "SwitchStatement":
                return this.emitSwitch(stmt, scope);
            case "ThrowStatement":
                this.emitThrow(stmt, scope);
                return undefined;
            case "ReturnStatement":
                return {
                    output: this.emitExpr(stmt.value, scope),
                };
            case "BreakStatement":
                // break inside a loop body is handled by the loop emitter
                return undefined;
            default:
                this.emitError(
                    `Unsupported statement kind: ${(stmt as Statement).kind}`,
                    (stmt as Statement).loc.line,
                    (stmt as Statement).loc.col,
                );
                return undefined;
        }
    }

    // ---- Const binding ----

    private emitConst(
        stmt: import("./ast.js").ConstStatement,
        scope: ScopeContext,
    ): void {
        const expr = stmt.value;

        // Check if the RHS is a pure literal (no task calls, no refs)
        if (this.isPureLiteral(expr)) {
            const value = this.constExprToValue(expr);
            const schema = stmt.typeAnnotation
                ? typeExprToSchema(stmt.typeAnnotation)
                : this.inferLiteralSchema(expr);
            this.constants[stmt.name] = { schema, value };
            scope.bindings.set(stmt.name, { kind: "constant" });
            return;
        }

        // Expression that produces a node (task call, built-in, operator, etc.)
        if (this.producesNode(expr)) {
            if (expr.kind === "TaskCallExpr") {
                // Direct task call: use the const name as the node ID
                const nodeId = stmt.name;
                const node = this.emitTaskCall(expr, scope, nodeId);
                if (node) {
                    scope.nodes[nodeId] = node;
                    scope.nodeOrder.push(nodeId);
                    scope.bindings.set(stmt.name, {
                        kind: "node",
                        nodeId,
                    });
                }
            } else if (expr.kind === "TemplateLiteralExpr") {
                const nodeId = stmt.name;
                const node = this.emitTemplateLiteral(expr, scope, nodeId);
                if (node) {
                    scope.nodes[nodeId] = node;
                    scope.nodeOrder.push(nodeId);
                    scope.bindings.set(stmt.name, {
                        kind: "node",
                        nodeId,
                    });
                }
            } else {
                // Complex expressions (built-ins, operators, workflow calls):
                // emit into scope and bind the result template
                const template = this.emitExpr(expr, scope);
                scope.bindings.set(stmt.name, {
                    kind: "literal",
                    value: template,
                });
            }
            return;
        }

        // Otherwise, resolve as a template (inline value)
        const value = this.emitExpr(expr, scope);
        scope.bindings.set(stmt.name, { kind: "literal", value });
    }

    private emitDestructuring(
        stmt: import("./ast.js").DestructuringConst,
        scope: ScopeContext,
    ): void {
        // The RHS should produce a node whose output is a tuple/array.
        // We bind each name to a path on that node's output.
        if (this.producesNode(stmt.value)) {
            const nodeId = this.freshId("destructure");
            const node = this.emitExprAsNode(stmt.value, scope, nodeId);
            if (node) {
                scope.nodes[nodeId] = node;
                scope.nodeOrder.push(nodeId);
            }
            // emitExprAsNode may return undefined for complex expressions
            // (parallel, map, etc.) but still rebind the last emitted node
            // to nodeId within scope. Check that we have a result to
            // destructure from.
            const hasResult =
                node !== undefined ||
                Object.values(scope.nodes).some(
                    (n) => "bind" in n && (n as TaskNode).bind === nodeId,
                );
            if (hasResult) {
                // Each destructured name gets a binding that projects into the output
                for (let i = 0; i < stmt.names.length; i++) {
                    // Create a pick node for each element
                    const pickId = this.freshId(`pick_${stmt.names[i]}`);
                    // Resolve element type from the type checker's symbol map
                    const nameLoc = stmt.nameLocs[i];
                    const elemType =
                        nameLoc !== undefined
                            ? this.symbolTypes.get(nameLoc.offset)
                            : undefined;
                    const elemSchema =
                        elemType !== undefined
                            ? typeInfoToSchema(elemType)
                            : {};
                    const pickNode: TaskNode = {
                        kind: "task",
                        task: "list.elementAt",
                        inputSchema: {
                            type: "object",
                            required: ["list", "index"],
                            properties: {
                                list: { type: "array" },
                                index: { type: "integer" },
                            },
                        },
                        outputSchema: elemSchema,
                        inputs: {
                            list: {
                                $from: "scope",
                                name: nodeId,
                            } as unknown as Template,
                            index: i,
                        },
                        bind: stmt.names[i],
                    };
                    scope.nodes[pickId] = pickNode;
                    scope.nodeOrder.push(pickId);
                    scope.bindings.set(stmt.names[i], {
                        kind: "node",
                        nodeId: pickId,
                    });
                }
            }
        } else {
            // Literal array
            const value = this.emitExpr(stmt.value, scope);
            if (Array.isArray(value)) {
                for (let i = 0; i < stmt.names.length; i++) {
                    scope.bindings.set(stmt.names[i], {
                        kind: "literal",
                        value: i < value.length ? value[i] : null,
                    });
                }
            } else {
                this.emitError(
                    "Destructuring requires an array or tuple value",
                    stmt.loc.line,
                    stmt.loc.col,
                );
            }
        }
    }

    // ---- If statement ----

    private emitIf(
        stmt: import("./ast.js").IfStatement,
        scope: ScopeContext,
    ): { output?: Template } | undefined {
        // Emit condition - may produce a node
        const condTemplate = this.emitExpr(stmt.condition, scope);

        // G29 Q3: read result type stored by type checker.
        const ifResolved = this.resolvedSchemas.get(stmt.loc.offset);
        const resultSchema: JSONSchema = ifResolved?.outputSchema ?? {};

        const branchId = this.freshId("branch");
        const mergeId = this.freshId("merge");

        // Create child scopes for then/else, capturing return values.
        // Each arm is a BranchArm sub-scope; nodes are NOT merged into the
        // parent scope.
        const thenScope = this.childScope(scope);
        let thenOutput: Template | undefined;
        for (const s of stmt.then) {
            const r = this.emitStatement(s, thenScope);
            if (r?.output !== undefined) thenOutput = r.output;
        }

        let elseScope: ScopeContext | undefined;
        let elseOutput: Template | undefined;
        if (stmt.else_ && stmt.else_.length > 0) {
            elseScope = this.childScope(scope);
            for (const s of stmt.else_) {
                const r = this.emitStatement(s, elseScope);
                if (r?.output !== undefined) elseOutput = r.output;
            }
        }

        // When ANY branch returns a value, publish through branch.bind so
        // consumers in the parent scope can read it (arm-scope names are
        // not visible to the parent). When only one branch returns, the
        // other arm's output is `null` (declared null-typed scope output).
        let resultBind: string | undefined;
        if (thenOutput !== undefined || elseOutput !== undefined) {
            resultBind = this.freshId("if_result");
            this.referencedNodes.add(resultBind);
        }

        // Build BranchArm objects from child scopes.
        // buildArmScope calls threadNext + captureOuterRefs internally.
        const thenArm =
            thenScope.nodeOrder.length > 0
                ? this.buildArmScope(
                      thenScope,
                      resultBind !== undefined
                          ? (thenOutput ?? null)
                          : undefined,
                      resultBind !== undefined ? resultSchema : undefined,
                  )
                : resultBind !== undefined && thenOutput !== undefined
                  ? this.buildOutputOnlyArm(thenScope, thenOutput, resultSchema)
                  : this.makeNoopArm();

        const falseArm =
            elseScope && elseScope.nodeOrder.length > 0
                ? this.buildArmScope(
                      elseScope,
                      resultBind !== undefined
                          ? (elseOutput ?? null)
                          : undefined,
                      resultBind !== undefined ? resultSchema : undefined,
                  )
                : resultBind !== undefined &&
                    elseOutput !== undefined &&
                    elseScope
                  ? this.buildOutputOnlyArm(elseScope, elseOutput, resultSchema)
                  : this.makeNoopArm();

        // Boolean if-else is always exhaustive: { type: "boolean" } is
        // treated as an implicit enum [true, false] by the validator,
        // so both cases live under `cases` (no default needed).
        const branchNode: BranchNode = {
            kind: "branch",
            selector: condTemplate,
            selectorSchema: { type: "boolean" },
            cases: { true: thenArm, false: falseArm },
            next: mergeId,
            ...(resultBind
                ? { bind: resultBind, outputSchema: resultSchema }
                : {}),
        };

        // Merge is a noop task that serves as the continuation point
        const mergeNode: TaskNode = {
            kind: "task",
            task: "noop",
            inputSchema: {},
            outputSchema: {},
            inputs: {},
        };

        scope.nodes[branchId] = branchNode;
        scope.nodeOrder.push(branchId);
        scope.nodes[mergeId] = mergeNode;
        scope.nodeOrder.push(mergeId);

        // Propagate return value from branches via branch.bind.
        if (resultBind) {
            return {
                output: {
                    $from: "scope",
                    name: resultBind,
                } as unknown as Template,
            };
        }
        return undefined;
    }

    // ---- Switch statement ----

    private emitSwitch(
        stmt: import("./ast.js").SwitchStatement,
        scope: ScopeContext,
    ): { output?: Template } | undefined {
        const discTemplate = this.emitExpr(stmt.discriminant, scope);
        const branchId = this.freshId("switch");
        const mergeId = this.freshId("merge");

        // G29 Q3: read result type stored by type checker.
        const switchResolved = this.resolvedSchemas.get(stmt.loc.offset);
        const resultSchema: JSONSchema = switchResolved?.outputSchema ?? {};

        // Cases map to BranchArm sub-scopes; per-arm outputs are exposed to
        // the parent via branch.bind. The arm's `output` is set on its
        // sub-scope; the branch publishes that arm output under `bind` (a
        // fresh `switch_result_N` name).
        const cases: Record<string, BranchArm> = {};
        let defaultArm: BranchArm | undefined;
        const armOutputs: (Template | undefined)[] = [];
        const armScopes: {
            scope: ScopeContext;
            output: Template | undefined;
        }[] = [];
        const caseValues: unknown[] = [];

        for (let i = 0; i < stmt.arms.length; i++) {
            const arm = stmt.arms[i];
            const armScope = this.childScope(scope);
            let armOutput: Template | undefined;
            for (const s of arm.body) {
                const r = this.emitStatement(s, armScope);
                if (r?.output !== undefined) armOutput = r.output;
            }
            armOutputs.push(armOutput);
            armScopes.push({ scope: armScope, output: armOutput });
            caseValues.push(this.constExprToValue(arm.value));
        }

        const hasSourceDefault = !!(stmt.default_ && stmt.default_.length > 0);
        let defScope: ScopeContext | undefined;
        let defOutput: Template | undefined;
        if (hasSourceDefault) {
            defScope = this.childScope(scope);
            for (const s of stmt.default_!) {
                const r = this.emitStatement(s, defScope);
                if (r?.output !== undefined) defOutput = r.output;
            }
        }

        // If any arm produced an output, we must publish through branch.bind
        // so consumers in the parent scope can read it. (Arm-scope names are
        // not visible to the parent.)
        const anyOutput =
            armOutputs.some((o) => o !== undefined) || defOutput !== undefined;
        const resultBind = anyOutput
            ? this.freshId("switch_result")
            : undefined;
        if (resultBind) this.referencedNodes.add(resultBind);

        for (let i = 0; i < armScopes.length; i++) {
            const { scope: armScope, output: armOutput } = armScopes[i];
            const caseKey = String(caseValues[i]);
            cases[caseKey] =
                armScope.nodeOrder.length > 0
                    ? this.buildArmScope(
                          armScope,
                          resultBind !== undefined ? armOutput : undefined,
                          resultBind !== undefined ? resultSchema : undefined,
                      )
                    : this.makeNoopArm();
        }
        if (hasSourceDefault) {
            defaultArm =
                defScope!.nodeOrder.length > 0
                    ? this.buildArmScope(
                          defScope!,
                          resultBind !== undefined ? defOutput : undefined,
                          resultBind !== undefined ? resultSchema : undefined,
                      )
                    : this.makeNoopArm();
        }

        const inferredType = inferCommonType(caseValues);
        let selectorSchema: JSONSchema;
        if (!hasSourceDefault && inferredType) {
            selectorSchema = { type: inferredType, enum: caseValues as any };
        } else if (inferredType) {
            selectorSchema = { type: inferredType };
        } else {
            selectorSchema = {};
        }

        const branchNode: BranchNode = {
            kind: "branch",
            selector: discTemplate,
            selectorSchema,
            cases,
            ...(defaultArm !== undefined ? { default: defaultArm } : {}),
            next: mergeId,
            ...(resultBind
                ? { bind: resultBind, outputSchema: resultSchema }
                : {}),
        };

        const mergeNode: TaskNode = {
            kind: "task",
            task: "noop",
            inputSchema: {},
            outputSchema: {},
            inputs: {},
        };

        scope.nodes[branchId] = branchNode;
        scope.nodeOrder.push(branchId);
        scope.nodes[mergeId] = mergeNode;
        scope.nodeOrder.push(mergeId);

        if (resultBind) {
            return {
                output: {
                    $from: "scope",
                    name: resultBind,
                } as unknown as Template,
            };
        }
        return undefined;
    }

    // ---- Throw statement ----

    private emitThrow(
        stmt: import("./ast.js").ThrowStatement,
        scope: ScopeContext,
    ): void {
        const valueTemplate = this.emitExpr(stmt.value, scope);
        const nodeId = this.freshId("throw");
        const node: TaskNode = {
            kind: "task",
            task: "error.fail",
            inputSchema: {
                type: "object",
                required: ["message"],
                properties: { message: {} },
            },
            outputSchema: { not: {} },
            inputs: { message: valueTemplate },
        };
        scope.nodes[nodeId] = node;
        scope.nodeOrder.push(nodeId);
    }

    // ---- Expression emission ----

    /**
     * Emit an expression as a Template value. If the expression requires
     * generating IR nodes (task calls, built-ins, operators), those nodes
     * are added to the scope and a $from reference is returned.
     */
    private emitExpr(expr: Expr, scope: ScopeContext): Template {
        switch (expr.kind) {
            case "StringLiteralExpr":
                return decodeStringLiteral(expr.raw, expr.quote).value;
            case "NumberLiteralExpr":
                return expr.value;
            case "BooleanLiteralExpr":
                return expr.value;
            case "NullLiteralExpr":
                return null;
            case "ArrayLiteralExpr":
                return expr.elements.map((e) => this.emitExpr(e, scope));
            case "ObjectLiteralExpr": {
                const obj: Record<string, Template> = {};
                for (const entry of expr.entries) {
                    obj[entry.key] = this.emitExpr(entry.value, scope);
                }
                return obj;
            }
            case "DottedNameExpr":
                return this.resolveDottedName(expr.segments, scope, expr);
            case "TemplateLiteralExpr": {
                const nodeId = this.freshId("template");
                const node = this.emitTemplateLiteral(expr, scope, nodeId);
                if (node) {
                    scope.nodes[nodeId] = node;
                    scope.nodeOrder.push(nodeId);
                    return this.scopeRef(nodeId, scope);
                }
                return null;
            }
            case "TaskCallExpr": {
                const nodeId = this.freshId(expr.task.replace(/\./g, "_"));
                const node = this.emitTaskCall(expr, scope, nodeId);
                if (node) {
                    scope.nodes[nodeId] = node;
                    scope.nodeOrder.push(nodeId);
                    return this.scopeRef(nodeId, scope);
                }
                return null;
            }
            case "WorkflowCallExpr": {
                // For now, emit as a task call (sub-workflow inlining is a future optimization)
                const nodeId = this.freshId(`call_${expr.name}`);
                const node = this.emitWorkflowCall(expr, scope, nodeId);
                if (node) {
                    scope.nodes[nodeId] = node;
                    scope.nodeOrder.push(nodeId);
                    return this.scopeRef(nodeId, scope);
                }
                return null;
            }
            case "BinaryExpr":
                return this.emitBinaryExpr(expr, scope);
            case "UnaryExpr":
                return this.emitUnaryExpr(expr, scope);
            case "TernaryExpr":
                return this.emitTernaryExpr(expr, scope);
            case "AttemptsNode":
                return this.emitAttempts(expr, scope);
            case "MapNode":
                return this.emitMap(expr, scope);
            case "FilterNode":
                return this.emitFilter(expr, scope);
            case "ParallelNode":
                return this.emitParallel(expr, scope);
            case "ParallelMapNode":
                return this.emitParallelMap(expr, scope);
        }
    }

    /**
     * Emit an expression that must produce a node. Returns the node
     * (caller is responsible for adding to scope).
     */
    private emitExprAsNode(
        expr: Expr,
        scope: ScopeContext,
        bindName: string,
    ): WorkflowNode | undefined {
        switch (expr.kind) {
            case "TaskCallExpr":
                return this.emitTaskCall(expr, scope, bindName);
            case "TemplateLiteralExpr":
                return this.emitTemplateLiteral(expr, scope, bindName);
            case "BinaryExpr":
            case "UnaryExpr":
            case "TernaryExpr":
            case "AttemptsNode":
            case "MapNode":
            case "FilterNode":
            case "ParallelNode":
            case "ParallelMapNode":
            case "WorkflowCallExpr": {
                // Emit into scope, then extract the last node and re-bind it
                const tempScope = this.childScope(scope);
                const template = this.emitExpr(expr, tempScope);
                // Move all generated nodes into the parent scope
                for (const [id, node] of Object.entries(tempScope.nodes)) {
                    scope.nodes[id] = node;
                    scope.nodeOrder.push(id);
                }
                // The last node in tempScope is the result node - rebind it
                if (tempScope.nodeOrder.length > 0) {
                    const lastId =
                        tempScope.nodeOrder[tempScope.nodeOrder.length - 1];
                    const lastNode = scope.nodes[lastId];
                    if (lastNode && "bind" in lastNode) {
                        (lastNode as TaskNode).bind = bindName;
                    }
                    return undefined; // nodes already added
                }
                // No nodes generated, treat as literal
                scope.bindings.set(bindName, {
                    kind: "literal",
                    value: template,
                });
                return undefined;
            }
            default:
                return undefined;
        }
    }

    // ---- Task call ----

    private emitTaskCall(
        expr: TaskCallExpr,
        scope: ScopeContext,
        bindName: string,
    ): TaskNode | undefined {
        const schema = this.taskSchemas.get(expr.task);
        if (!schema) {
            this.emitError(
                `Unknown task: ${expr.task}`,
                expr.loc.line,
                expr.loc.col,
                expr.task.length,
            );
            return undefined;
        }

        const inputs = this.resolveTaskArgs(expr.args, schema, scope);

        // Resolve effective input/output schemas.
        let outputSchema: JSONSchema;
        let inputSchema: JSONSchema;
        if (isGenericSchema(schema)) {
            const cached = this.getResolvedSchemas(
                expr.loc.offset,
                expr.loc,
                `generic task '${expr.task}'`,
            );
            if (!cached) return undefined;
            ({ inputSchema, outputSchema } = cached);
        } else {
            outputSchema = schema.outputSchema;
            inputSchema = schema.inputSchema;
        }

        return {
            kind: "task",
            task: expr.task,
            inputSchema,
            outputSchema,
            inputs,
            bind: bindName,
        };
    }

    private emitWorkflowCall(
        expr: import("./ast.js").WorkflowCallExpr,
        scope: ScopeContext,
        bindName: string,
    ): WorkflowCallNode | undefined {
        const callee = this.workflowMap.get(expr.name);
        if (!callee) {
            this.emitError(
                `Unknown workflow '${expr.name}'`,
                expr.loc.line,
                expr.loc.col,
            );
            return undefined;
        }
        const schemas = this.workflowSchemas.get(expr.name);
        if (!schemas) {
            this.emitError(
                `Missing schema cache for workflow '${expr.name}'`,
                expr.loc.line,
                expr.loc.col,
            );
            return undefined;
        }
        const inputs = this.resolveWorkflowCallInputs(callee, expr.args, scope);
        return {
            kind: "workflowCall",
            workflowRef: { name: expr.name },
            inputSchema: schemas.input,
            outputSchema: schemas.output,
            inputs,
            bind: bindName,
        };
    }

    /**
     * Resolve workflow-call arguments into the inputs map keyed by the
     * callee's parameter names, applying defaults for any omitted param.
     *
     * Default-expression inlining: defaults are emitted in a synthetic
     * sub-scope where earlier callee param names are bound to the
     * caller-resolved templates (kind "literal"). This means a default
     * like `b = a` becomes `inputs[b] = <whatever the caller passed for a>`,
     * with all literal substitution performed at compile time (§4.3).
     *
     * The same default expression is re-expanded at every call site
     * (duplication intentional in P4; see
     * `ir/future/workflow-default-arguments.md`).
     */
    private resolveWorkflowCallInputs(
        callee: WorkflowDecl,
        args: import("./ast.js").TaskArg[],
        scope: ScopeContext,
    ): Record<string, Template> {
        const recordForm =
            args.length === 1 &&
            args[0].kind === "PositionalArg" &&
            args[0].value.kind === "ObjectLiteralExpr";

        const inputs: Record<string, Template> = {};

        if (recordForm) {
            const obj = args[0].value as Extract<
                Expr,
                { kind: "ObjectLiteralExpr" }
            >;
            for (const entry of obj.entries) {
                inputs[entry.key] = this.emitExpr(entry.value, scope);
            }
        } else {
            let posIdx = 0;
            for (const arg of args) {
                if (arg.kind === "NamedArg") {
                    inputs[arg.name] = this.emitExpr(arg.value, scope);
                } else {
                    if (posIdx < callee.params.length) {
                        const paramName = callee.params[posIdx].name;
                        inputs[paramName] = this.emitExpr(arg.value, scope);
                        posIdx++;
                    } else {
                        // Type checker already reports too-many-args; skip
                        // silently here to avoid duplicate errors.
                    }
                }
            }
        }

        // Apply defaults in declaration order so a default referencing
        // an earlier param sees the already-resolved template.
        const defaultScope: ScopeContext = {
            nodes: {},
            nodeOrder: [],
            bindings: new Map(),
        };
        for (const p of callee.params) {
            if (inputs[p.name] !== undefined) {
                defaultScope.bindings.set(p.name, {
                    kind: "literal",
                    value: inputs[p.name],
                });
                continue;
            }
            if (!p.default) continue;
            // Emit the default expression in the synthetic scope. Any
            // node-producing expression in a default is emitted into
            // the calling scope; the default's result template is what
            // we record for the input.
            const inheritedScope: ScopeContext = {
                ...defaultScope,
                nodes: scope.nodes,
                nodeOrder: scope.nodeOrder,
                parent: scope,
            };
            const template = this.emitExpr(p.default, inheritedScope);
            inputs[p.name] = template;
            defaultScope.bindings.set(p.name, {
                kind: "literal",
                value: template,
            });
        }

        return inputs;
    }

    private emitTemplateLiteral(
        expr: TemplateLiteralExpr,
        scope: ScopeContext,
        bindName: string,
    ): TaskNode | undefined {
        const schema = this.taskSchemas.get("text.template");
        if (!schema || isGenericSchema(schema)) {
            this.emitError(
                "Task schema for text.template not found",
                expr.loc.line,
                expr.loc.col,
            );
            return undefined;
        }

        let templateStr = decodeTemplatePart(expr.rawParts[0]).value;
        const vars: Record<string, Template> = {};
        for (let i = 0; i < expr.expressions.length; i++) {
            const innerExpr = expr.expressions[i];
            const varName = this.templateVarName(innerExpr, i);
            templateStr += `{{${varName}}}`;
            templateStr += decodeTemplatePart(expr.rawParts[i + 1]).value;
            vars[varName] = this.emitExpr(innerExpr, scope);
        }

        return {
            kind: "task",
            task: "text.template",
            inputSchema: schema.inputSchema,
            outputSchema: schema.outputSchema,
            inputs: { template: templateStr, vars },
            bind: bindName,
        };
    }

    // ---- Binary / Unary / Ternary expressions ----

    private emitBinaryExpr(expr: BinaryExpr, scope: ScopeContext): Template {
        // Short-circuit: && and || lower to branch nodes so the second
        // operand is only evaluated when needed.
        if (expr.op === "&&" || expr.op === "||") {
            return this.emitShortCircuit(expr, scope);
        }

        const left = this.emitExpr(expr.left, scope);
        const right = this.emitExpr(expr.right, scope);

        const taskName = this.binaryOpToTask(expr.op);
        const nodeId = this.freshId(taskName.replace(/\./g, "_"));

        const schema = this.taskSchemas.get(taskName);
        const concreteSchema =
            schema && !isGenericSchema(schema) ? schema : undefined;
        const node: TaskNode = {
            kind: "task",
            task: taskName,
            inputSchema: concreteSchema?.inputSchema ?? {
                type: "object",
                required: ["left", "right"],
                properties: { left: {}, right: {} },
            },
            outputSchema:
                concreteSchema?.outputSchema ??
                this.binaryOpOutputSchema(expr.op),
            inputs: { left, right },
            bind: nodeId,
        };

        scope.nodes[nodeId] = node;
        scope.nodeOrder.push(nodeId);
        return this.scopeRef(nodeId, scope);
    }

    private binaryOpToTask(op: import("./ast.js").BinaryOp): string {
        switch (op) {
            case "===":
                return "compare.equals";
            case "!==":
                return "compare.notEquals";
            case ">":
                return "compare.greaterThan";
            case "<":
                return "compare.lessThan";
            case ">=":
                return "compare.greaterOrEqual";
            case "<=":
                return "compare.lessOrEqual";
            case "+":
                return "math.add";
            case "-":
                return "math.subtract";
            case "*":
                return "math.multiply";
            case "/":
                return "math.divide";
            case "%":
                return "math.modulo";
            default:
                // &&/|| are handled by emitShortCircuit before reaching here
                throw new Error(`Unexpected binary op: ${op}`);
        }
    }

    private binaryOpOutputSchema(op: import("./ast.js").BinaryOp): JSONSchema {
        switch (op) {
            case "===":
            case "!==":
            case ">":
            case "<":
            case ">=":
            case "<=":
                return { type: "boolean" };
            case "+":
            case "-":
            case "*":
            case "/":
            case "%":
                return { type: "number" };
            default:
                throw new Error(`Unexpected binary op: ${op}`);
        }
    }

    private emitUnaryExpr(expr: UnaryExpr, scope: ScopeContext): Template {
        const operand = this.emitExpr(expr.operand, scope);

        const taskName = expr.op === "!" ? "bool.not" : "math.negate";
        const nodeId = this.freshId(taskName.replace(/\./g, "_"));

        const schema = this.taskSchemas.get(taskName);
        const concreteSchema =
            schema && !isGenericSchema(schema) ? schema : undefined;
        const node: TaskNode = {
            kind: "task",
            task: taskName,
            inputSchema: concreteSchema?.inputSchema ?? {
                type: "object",
                required: ["value"],
                properties: { value: {} },
            },
            outputSchema:
                concreteSchema?.outputSchema ??
                (expr.op === "!" ? { type: "boolean" } : { type: "number" }),
            inputs: { value: operand },
            bind: nodeId,
        };

        scope.nodes[nodeId] = node;
        scope.nodeOrder.push(nodeId);
        return this.scopeRef(nodeId, scope);
    }

    /**
     * Lower `&&` / `||` to short-circuit branch nodes.
     *
     * `a && b` -> branch on a: true -> evaluate b; false -> return false
     * `a || b` -> branch on a: true -> return true;  false -> evaluate b
     *
     * Each arm is a BranchArm sub-scope.
     */
    private emitShortCircuit(expr: BinaryExpr, scope: ScopeContext): Template {
        const isAnd = expr.op === "&&";
        const condTemplate = this.emitExpr(expr.left, scope);

        const branchId = this.freshId(isAnd ? "and" : "or");
        const mergeId = this.freshId(isAnd ? "and_merge" : "or_merge");
        const resultBind = this.freshId(isAnd ? "and_result" : "or_result");

        // The "evaluate" arm: evaluate the right operand in its own scope.
        const evalScope = this.childScope(scope);
        const evalResult = this.emitExpr(expr.right, evalScope);
        let evalArm: BranchArm;
        if (evalScope.nodeOrder.length > 0) {
            evalArm = this.buildArmScope(evalScope, evalResult, {
                type: "boolean",
            });
        } else {
            // Right operand is a simple value; use a single identity node.
            const passId = this.freshId(isAnd ? "and_rhs" : "or_rhs");
            const passScope = this.childScope(scope);
            passScope.nodes[passId] = {
                kind: "task",
                task: "identity",
                inputSchema: {
                    type: "object",
                    required: ["value"],
                    properties: { value: {} },
                },
                outputSchema: { type: "boolean" },
                inputs: { value: evalResult },
                bind: passId,
            } as TaskNode;
            passScope.nodeOrder.push(passId);
            evalArm = this.buildArmScope(
                passScope,
                {
                    $from: "scope",
                    name: passId,
                } as unknown as Template,
                { type: "boolean" },
            );
        }

        // The "short-circuit" arm: return the known boolean literal.
        const shortScope = this.childScope(scope);
        const shortPassId = this.freshId(isAnd ? "and_short" : "or_short");
        shortScope.nodes[shortPassId] = {
            kind: "task",
            task: "identity",
            inputSchema: {
                type: "object",
                required: ["value"],
                properties: { value: {} },
            },
            outputSchema: { type: "boolean" },
            // &&: short-circuit on false; ||: short-circuit on true
            inputs: { value: !isAnd },
            bind: shortPassId,
        } as TaskNode;
        shortScope.nodeOrder.push(shortPassId);
        const shortArm = this.buildArmScope(
            shortScope,
            {
                $from: "scope",
                name: shortPassId,
            } as unknown as Template,
            { type: "boolean" },
        );

        // &&: true -> evaluate rhs, false (default) -> short-circuit
        // ||: true -> short-circuit, false (default) -> evaluate rhs
        const branchNode: BranchNode = {
            kind: "branch",
            selector: condTemplate,
            selectorSchema: { type: "boolean" },
            cases: { true: isAnd ? evalArm : shortArm },
            default: isAnd ? shortArm : evalArm,
            bind: resultBind,
            outputSchema: { type: "boolean" },
            next: mergeId,
        };

        const mergeNode: TaskNode = {
            kind: "task",
            task: "noop",
            inputSchema: {},
            outputSchema: {},
            inputs: {},
        };

        scope.nodes[branchId] = branchNode;
        scope.nodeOrder.push(branchId);
        scope.nodes[mergeId] = mergeNode;
        scope.nodeOrder.push(mergeId);
        this.referencedNodes.add(resultBind);
        return {
            $from: "scope",
            name: resultBind,
        } as unknown as Template;
    }

    private emitTernaryExpr(expr: TernaryExpr, scope: ScopeContext): Template {
        const condTemplate = this.emitExpr(expr.condition, scope);

        // G29 Q3: read result type stored by type checker.
        const ternaryResolved = this.getResolvedSchemas(
            expr.loc.offset,
            expr.loc,
            `ternary result type`,
        );
        const resultSchema: JSONSchema = ternaryResolved?.outputSchema ?? {};

        const branchId = this.freshId("ternary");
        const mergeId = this.freshId("merge");
        const resultBind = this.freshId("ternary_result");

        // Emit consequent and alternate as BranchArm sub-scopes.
        // Nodes stay in their arm scopes, not the parent.
        const thenScope = this.childScope(scope);
        const thenResult = this.emitExpr(expr.consequent, thenScope);
        let thenArm: BranchArm;
        if (thenScope.nodeOrder.length > 0) {
            thenArm = this.buildArmScope(thenScope, thenResult, resultSchema);
        } else {
            // Literal consequent: wrap in a single identity node.
            const passId = this.freshId("ternary_then");
            const passScope = this.childScope(scope);
            passScope.nodes[passId] = {
                kind: "task",
                task: "identity",
                inputSchema: {
                    type: "object",
                    required: ["value"],
                    properties: { value: resultSchema },
                },
                outputSchema: resultSchema,
                inputs: { value: thenResult },
                bind: passId,
            } as TaskNode;
            passScope.nodeOrder.push(passId);
            thenArm = this.buildArmScope(
                passScope,
                {
                    $from: "scope",
                    name: passId,
                } as unknown as Template,
                resultSchema,
            );
        }

        const elseScope = this.childScope(scope);
        const elseResult = this.emitExpr(expr.alternate, elseScope);
        let elseArm: BranchArm;
        if (elseScope.nodeOrder.length > 0) {
            elseArm = this.buildArmScope(elseScope, elseResult, resultSchema);
        } else {
            const passId = this.freshId("ternary_else");
            const passScope = this.childScope(scope);
            passScope.nodes[passId] = {
                kind: "task",
                task: "identity",
                inputSchema: {
                    type: "object",
                    required: ["value"],
                    properties: { value: resultSchema },
                },
                outputSchema: resultSchema,
                inputs: { value: elseResult },
                bind: passId,
            } as TaskNode;
            passScope.nodeOrder.push(passId);
            elseArm = this.buildArmScope(
                passScope,
                {
                    $from: "scope",
                    name: passId,
                } as unknown as Template,
                resultSchema,
            );
        }

        const branchNode: BranchNode = {
            kind: "branch",
            selector: condTemplate,
            selectorSchema: { type: "boolean" },
            cases: { true: thenArm },
            default: elseArm,
            bind: resultBind,
            outputSchema: resultSchema,
            next: mergeId,
        };

        const mergeNode: TaskNode = {
            kind: "task",
            task: "noop",
            inputSchema: {},
            outputSchema: {},
            inputs: {},
        };

        scope.nodes[branchId] = branchNode;
        scope.nodeOrder.push(branchId);
        scope.nodes[mergeId] = mergeNode;
        scope.nodeOrder.push(mergeId);
        this.referencedNodes.add(resultBind);
        return {
            $from: "scope",
            name: resultBind,
        } as unknown as Template;
    }

    // ---- Built-in nodes ----

    private emitAttempts(expr: AttemptsNode, scope: ScopeContext): Template {
        const countTemplate = this.emitExpr(expr.count, scope);
        const loopId = this.freshId("attempts");

        // Build body scope
        const bodyScope = this.childScope(scope);
        let outputTemplate: Template = null;
        for (const s of expr.body) {
            const result = this.emitStatement(s, bodyScope);
            if (result?.output !== undefined) {
                outputTemplate = result.output;
            }
        }

        // State: attempt counter
        const state: Record<string, LoopStateVar> = {
            attempt: { schema: { type: "number" }, initial: 0 },
        };

        // --- Success path: set _should_retry = false so the loop exits.
        const setDoneId = this.freshId("attempts_done");
        bodyScope.nodes[setDoneId] = {
            kind: "task",
            task: "identity",
            inputSchema: {
                type: "object",
                required: ["value"],
                properties: { value: {} },
            },
            outputSchema: { type: "boolean" },
            inputs: { value: false },
            bind: "_should_retry",
        } as TaskNode;
        bodyScope.nodeOrder.push(setDoneId);

        // Wire body task nodes to enter error path on failure.
        // set_done is intentionally excluded (added after this loop).
        for (const id of bodyScope.nodeOrder.slice(0, -1)) {
            const node = bodyScope.nodes[id];
            if (node && node.kind === "task") {
                node.onError = "@@attempts_step";
            }
        }

        this.threadNext(bodyScope);

        // --- Error-path infrastructure (only reached via onError) ---
        // On failure: step_attempt -> check_done -> checkBranch
        //   exhausted: arm scope with error.fail (throws)
        //   retry:     arm scope with noop, output true -> _should_retry

        const stepId = this.freshId("step_attempt");
        bodyScope.nodes[stepId] = {
            kind: "task",
            task: "math.add",
            inputSchema: {
                type: "object",
                required: ["left", "right"],
                properties: {
                    left: { type: "number" },
                    right: { type: "number" },
                },
            },
            outputSchema: { type: "number" },
            inputs: {
                left: {
                    $from: "state",
                    name: "attempt",
                } as unknown as Template,
                right: 1,
            },
            bind: stepId,
        } as TaskNode;
        // NOT pushed to nodeOrder — reachable only via onError

        const compareId = this.freshId("check_done");
        bodyScope.nodes[compareId] = {
            kind: "task",
            task: "compare.greaterOrEqual",
            inputSchema: {
                type: "object",
                required: ["left", "right"],
                properties: { left: { type: "number" }, right: {} },
            },
            outputSchema: { type: "boolean" },
            inputs: {
                left: {
                    $from: "scope",
                    name: stepId,
                } as unknown as Template,
                right: countTemplate,
            },
            bind: compareId,
        } as TaskNode;
        (bodyScope.nodes[stepId] as TaskNode).next = compareId;

        // Build arm scopes for the checkBranch.
        // Exhausted arm: throw so the loop's onError handler fires.
        const exhaustScope = this.childScope(bodyScope);
        const exhaustNodeId = this.freshId("attempts_exhaust");
        exhaustScope.nodes[exhaustNodeId] = {
            kind: "task",
            task: "error.fail",
            inputSchema: {
                type: "object",
                required: ["message"],
                properties: { message: {} },
            },
            outputSchema: { not: {} },
            inputs: { message: "Attempts exhausted" },
        } as TaskNode;
        exhaustScope.nodeOrder.push(exhaustNodeId);
        const exhaustedArm = this.buildArmScope(
            exhaustScope,
            false as unknown as Template,
            { type: "boolean" },
        );

        // Retry arm: noop, output true → loop continues.
        const retryScope = this.childScope(bodyScope);
        const retryNoopId = this.freshId("attempts_retry");
        retryScope.nodes[retryNoopId] = {
            kind: "task",
            task: "noop",
            inputSchema: {},
            outputSchema: {},
            inputs: {},
            bind: retryNoopId,
        } as TaskNode;
        retryScope.nodeOrder.push(retryNoopId);
        const retryArm = this.buildArmScope(
            retryScope,
            true as unknown as Template,
            { type: "boolean" },
        );

        const checkBranchId = this.freshId("attempts_check");
        bodyScope.nodes[checkBranchId] = {
            kind: "branch",
            selector: {
                $from: "scope",
                name: compareId,
            } as unknown as Template,
            selectorSchema: { type: "boolean" },
            cases: { true: exhaustedArm },
            default: retryArm,
            bind: "_should_retry",
            outputSchema: { type: "boolean" },
        } as BranchNode;
        (bodyScope.nodes[compareId] as TaskNode).next = checkBranchId;

        // Now fix up the placeholder onError targets set above
        for (const id of bodyScope.nodeOrder.slice(0, -1)) {
            const node = bodyScope.nodes[id];
            if (
                node &&
                node.kind === "task" &&
                node.onError === "@@attempts_step"
            ) {
                node.onError = stepId;
            }
        }

        // Handle fallback (loop-level onError, for exhaustion propagation)
        let onError: string | undefined;
        if (expr.fallback) {
            const fbScope = this.childScope(scope);
            fbScope.bindings.set(
                expr.fallback.param ?? DEFAULT_FALLBACK_PARAM,
                {
                    kind: "recoveryInput",
                    nodeId: "error",
                },
            );
            for (const s of expr.fallback.body) {
                this.emitStatement(s, fbScope);
            }
            this.threadNext(fbScope);

            // Merge fallback nodes into parent scope
            const fbPrefix = "fallback_";
            for (const [id, node] of Object.entries(fbScope.nodes)) {
                scope.nodes[`${fbPrefix}${id}`] = this.prefixNodeRefs(
                    node,
                    fbPrefix,
                );
            }
            if (fbScope.nodeOrder.length > 0) {
                onError = `${fbPrefix}${fbScope.nodeOrder[0]}`;
            }
        }

        // Capture outer-scope references used in attempts body
        const outer = this.captureOuterRefs(bodyScope, new Set<string>(), {
            hasState: true,
        });

        // Resolve the body return type stored by the type checker (Gap 8).
        const attemptsResolved = this.getResolvedSchemas(
            expr.loc.offset,
            expr.loc,
            `attempts body type`,
        );
        const attemptsBodyOutputSchema = attemptsResolved?.outputSchema ?? {};

        // The body output references a name bound only on the success path
        // (the user task's bind). On the error path the branch arms throw or
        // iterate, so the output is never evaluated. Mark optional so the
        // dominator coverage check passes.
        const bodyOutput = this.markTemplateOptional(outputTemplate ?? null);

        const loopNode: LoopNode = {
            kind: "loop",
            inputs: { ...outer.inputs },
            body: {
                inputSchema: {
                    type: "object",
                    required: [...outer.required],
                    properties: { ...outer.properties },
                },
                entry: bodyScope.nodeOrder[0] ?? "",
                nodes: bodyScope.nodes,
                output: bodyOutput,
                outputSchema: attemptsBodyOutputSchema,
            },
            state,
            continueWhen: {
                $from: "scope",
                name: "_should_retry",
            } as unknown as Template,
            iterateState: {
                attempt: {
                    $from: "scope",
                    name: stepId,
                } as unknown as Template,
            },
            ...(onError ? { onError } : {}),
            bind: loopId,
        };

        scope.nodes[loopId] = loopNode;
        scope.nodeOrder.push(loopId);
        return this.scopeRef(loopId, scope);
    }

    private emitMap(expr: MapNode, scope: ScopeContext): Template {
        const collectionTemplate = this.emitExpr(expr.collection, scope);
        const loopId = this.freshId("map");

        const resolved = this.getResolvedSchemas(
            expr.loc.offset,
            expr.loc,
            `map element type`,
        );
        const elementSchema = resolved?.outputSchema ?? {};

        // Body scope: only loop-control nodes live here.
        // The per-iteration work lives in the checkBranch's true arm scope.
        const bodyScope = this.childScope(scope);

        // --- Loop condition check ---
        const lengthId = this.freshId("length");
        bodyScope.nodes[lengthId] = {
            kind: "task",
            task: "list.length",
            inputSchema: {
                type: "object",
                required: ["list"],
                properties: { list: { type: "array" } },
            },
            outputSchema: { type: "integer" },
            inputs: {
                list: { $from: "input", name: "items" } as unknown as Template,
            },
            bind: lengthId,
        } as TaskNode;
        bodyScope.nodeOrder.push(lengthId);

        const compareId = this.freshId("compare");
        bodyScope.nodes[compareId] = {
            kind: "task",
            task: "compare.lessThan",
            inputSchema: {
                type: "object",
                required: ["left", "right"],
                properties: {
                    left: { type: "number" },
                    right: { type: "number" },
                },
            },
            outputSchema: { type: "boolean" },
            inputs: {
                left: {
                    $from: "state",
                    name: "i",
                } as unknown as Template,
                right: {
                    $from: "scope",
                    name: lengthId,
                } as unknown as Template,
            },
            bind: compareId,
        } as TaskNode;
        bodyScope.nodeOrder.push(compareId);

        // --- True arm scope: pick element, run user body, append, step ---
        const workScope = this.childScope(bodyScope);
        const pickId = expr.param;
        workScope.nodes[pickId] = {
            kind: "task",
            task: "list.elementAt",
            inputSchema: {
                type: "object",
                required: ["list", "index"],
                properties: {
                    list: { type: "array", items: elementSchema },
                    index: { type: "integer" },
                },
            },
            outputSchema: elementSchema,
            inputs: {
                list: { $from: "input", name: "items" } as unknown as Template,
                index: { $from: "state", name: "i" } as unknown as Template,
            },
            bind: pickId,
        } as TaskNode;
        workScope.nodeOrder.push(pickId);
        workScope.bindings.set(expr.param, { kind: "node", nodeId: pickId });

        let outputTemplate: Template = null;
        for (const s of expr.body) {
            const result = this.emitStatement(s, workScope);
            if (result?.output !== undefined) {
                outputTemplate = result.output;
            }
        }

        const appendId = this.freshId("append");
        workScope.nodes[appendId] = {
            kind: "task",
            task: "list.append",
            inputSchema: {
                type: "object",
                required: ["list", "item"],
                properties: { list: { type: "array" }, item: {} },
            },
            outputSchema: { type: "array" },
            inputs: {
                list: {
                    $from: "state",
                    name: "results",
                } as unknown as Template,
                item: outputTemplate ?? null,
            },
            bind: appendId,
        } as TaskNode;
        workScope.nodeOrder.push(appendId);

        const stepId = this.freshId("step_i");
        workScope.nodes[stepId] = {
            kind: "task",
            task: "math.add",
            inputSchema: {
                type: "object",
                required: ["left", "right"],
                properties: {
                    left: { type: "number" },
                    right: { type: "number" },
                },
            },
            outputSchema: { type: "number" },
            inputs: {
                left: { $from: "state", name: "i" } as unknown as Template,
                right: 1,
            },
            bind: stepId,
        } as TaskNode;
        workScope.nodeOrder.push(stepId);

        // True arm output: pair (newI, newResults) so iterateState can pick.
        const workArm = this.buildArmScope(
            workScope,
            {
                newI: {
                    $from: "scope",
                    name: stepId,
                } as unknown as Template,
                newResults: {
                    $from: "scope",
                    name: appendId,
                } as unknown as Template,
            } as unknown as Template,
            {
                type: "object",
                required: ["newI", "newResults"],
                properties: {
                    newI: { type: "integer" },
                    newResults: { type: "array" },
                },
            },
        );

        // False arm: no-op (loop exits next turn because continueWhen=false).
        const falseArm = this.makeNoopArm();

        // checkBranch binds `_iter_out` which iterateState projects on.
        const checkId = this.freshId("check_done");
        bodyScope.nodes[checkId] = {
            kind: "branch",
            selector: {
                $from: "scope",
                name: compareId,
            } as unknown as Template,
            selectorSchema: { type: "boolean" },
            cases: { true: workArm },
            default: falseArm,
            bind: "_iter_out",
            outputSchema: {
                type: "object",
                properties: {
                    newI: { type: "integer" },
                    newResults: { type: "array" },
                },
            },
        } as BranchNode;
        bodyScope.nodeOrder.push(checkId);

        this.threadNext(bodyScope);

        const state: Record<string, LoopStateVar> = {
            i: { schema: { type: "integer" }, initial: 0 },
            results: { schema: { type: "array" }, initial: [] as Template[] },
        };

        // Capture outer-scope references used in body + work arm scopes.
        const outer = this.captureOuterRefs(bodyScope, new Set(["items"]), {
            hasState: true,
        });

        const loopNode: LoopNode = {
            kind: "loop",
            inputs: { items: collectionTemplate, ...outer.inputs },
            body: {
                inputSchema: {
                    type: "object",
                    required: ["items", ...outer.required],
                    properties: {
                        items: { type: "array" },
                        ...outer.properties,
                    },
                },
                entry: bodyScope.nodeOrder[0] ?? "",
                nodes: bodyScope.nodes,
                output: {
                    $from: "state",
                    name: "results",
                } as unknown as Template,
                outputSchema: { type: "array" },
            },
            state,
            continueWhen: {
                $from: "scope",
                name: compareId,
            } as unknown as Template,
            // iterateState evaluated only when continueWhen=true (work arm
            // ran), so `_iter_out` is guaranteed to exist with the path
            // fields below.
            iterateState: {
                i: {
                    $from: "scope",
                    name: "_iter_out",
                    path: ["newI"],
                } as unknown as Template,
                results: {
                    $from: "scope",
                    name: "_iter_out",
                    path: ["newResults"],
                } as unknown as Template,
            },
            bind: loopId,
        };

        scope.nodes[loopId] = loopNode;
        scope.nodeOrder.push(loopId);
        return this.scopeRef(loopId, scope);
    }

    private emitFilter(expr: FilterNode, scope: ScopeContext): Template {
        const collectionTemplate = this.emitExpr(expr.collection, scope);
        const loopId = this.freshId("filter");

        const filterResolved = this.getResolvedSchemas(
            expr.loc.offset,
            expr.loc,
            `filter element type`,
        );
        const filterElemSchema = filterResolved?.outputSchema ?? {};

        const bodyScope = this.childScope(scope);

        // --- Loop condition check ---
        const lengthId = this.freshId("length");
        bodyScope.nodes[lengthId] = {
            kind: "task",
            task: "list.length",
            inputSchema: {
                type: "object",
                required: ["list"],
                properties: { list: { type: "array" } },
            },
            outputSchema: { type: "integer" },
            inputs: {
                list: { $from: "input", name: "items" } as unknown as Template,
            },
            bind: lengthId,
        } as TaskNode;
        bodyScope.nodeOrder.push(lengthId);

        const compareId = this.freshId("compare");
        bodyScope.nodes[compareId] = {
            kind: "task",
            task: "compare.lessThan",
            inputSchema: {
                type: "object",
                required: ["left", "right"],
                properties: {
                    left: { type: "number" },
                    right: { type: "number" },
                },
            },
            outputSchema: { type: "boolean" },
            inputs: {
                left: { $from: "state", name: "i" } as unknown as Template,
                right: {
                    $from: "scope",
                    name: lengthId,
                } as unknown as Template,
            },
            bind: compareId,
        } as TaskNode;
        bodyScope.nodeOrder.push(compareId);

        // --- True arm: pick element, evaluate predicate, conditional append, step ---
        const workScope = this.childScope(bodyScope);
        const pickId = expr.param;
        workScope.nodes[pickId] = {
            kind: "task",
            task: "list.elementAt",
            inputSchema: {
                type: "object",
                required: ["list", "index"],
                properties: {
                    list: { type: "array", items: filterElemSchema },
                    index: { type: "integer" },
                },
            },
            outputSchema: filterElemSchema,
            inputs: {
                list: { $from: "input", name: "items" } as unknown as Template,
                index: { $from: "state", name: "i" } as unknown as Template,
            },
            bind: pickId,
        } as TaskNode;
        workScope.nodeOrder.push(pickId);
        workScope.bindings.set(expr.param, { kind: "node", nodeId: pickId });

        // User predicate (returns boolean)
        let condTemplate: Template = null;
        for (const s of expr.body) {
            const result = this.emitStatement(s, workScope);
            if (result?.output !== undefined) {
                condTemplate = result.output;
            }
        }

        // Inner branch: condTemplate ? append : keep, bind unified result.
        const appendScope = this.childScope(workScope);
        const appendNodeId = this.freshId("append");
        appendScope.nodes[appendNodeId] = {
            kind: "task",
            task: "list.append",
            inputSchema: {
                type: "object",
                required: ["list", "item"],
                properties: { list: { type: "array" }, item: {} },
            },
            outputSchema: { type: "array" },
            inputs: {
                list: {
                    $from: "state",
                    name: "results",
                } as unknown as Template,
                item: {
                    $from: "scope",
                    name: pickId,
                } as unknown as Template,
            },
            bind: appendNodeId,
        } as TaskNode;
        appendScope.nodeOrder.push(appendNodeId);
        const appendArm = this.buildArmScope(
            appendScope,
            { $from: "scope", name: appendNodeId } as unknown as Template,
            { type: "array" },
        );

        const keepScope = this.childScope(workScope);
        const keepId = this.freshId("keep_results");
        keepScope.nodes[keepId] = {
            kind: "task",
            task: "identity",
            inputSchema: {
                type: "object",
                required: ["value"],
                properties: { value: {} },
            },
            outputSchema: { type: "array" },
            inputs: {
                value: {
                    $from: "state",
                    name: "results",
                } as unknown as Template,
            },
            bind: keepId,
        } as TaskNode;
        keepScope.nodeOrder.push(keepId);
        const keepArm = this.buildArmScope(
            keepScope,
            { $from: "scope", name: keepId } as unknown as Template,
            { type: "array" },
        );

        const filterBranchId = this.freshId("filter_check");
        workScope.nodes[filterBranchId] = {
            kind: "branch",
            selector: condTemplate ?? false,
            selectorSchema: { type: "boolean" },
            cases: { true: appendArm },
            default: keepArm,
            bind: "updated_results",
            outputSchema: { type: "array" },
        } as BranchNode;
        workScope.nodeOrder.push(filterBranchId);

        const stepId = this.freshId("step_i");
        // threadNext does not auto-link branch nodes; wire filter_check -> step_i.
        (workScope.nodes[filterBranchId] as BranchNode).next = stepId;
        workScope.nodes[stepId] = {
            kind: "task",
            task: "math.add",
            inputSchema: {
                type: "object",
                required: ["left", "right"],
                properties: {
                    left: { type: "number" },
                    right: { type: "number" },
                },
            },
            outputSchema: { type: "number" },
            inputs: {
                left: { $from: "state", name: "i" } as unknown as Template,
                right: 1,
            },
            bind: stepId,
        } as TaskNode;
        workScope.nodeOrder.push(stepId);

        // Work-arm output: (newI, newResults) for iterateState path projection.
        const workArm = this.buildArmScope(
            workScope,
            {
                newI: {
                    $from: "scope",
                    name: stepId,
                } as unknown as Template,
                newResults: {
                    $from: "scope",
                    name: "updated_results",
                } as unknown as Template,
            } as unknown as Template,
            {
                type: "object",
                required: ["newI", "newResults"],
                properties: {
                    newI: { type: "integer" },
                    newResults: { type: "array" },
                },
            },
        );

        const falseArm = this.makeNoopArm();

        const checkId = this.freshId("check_done");
        bodyScope.nodes[checkId] = {
            kind: "branch",
            selector: {
                $from: "scope",
                name: compareId,
            } as unknown as Template,
            selectorSchema: { type: "boolean" },
            cases: { true: workArm },
            default: falseArm,
            bind: "_iter_out",
            outputSchema: {
                type: "object",
                properties: {
                    newI: { type: "integer" },
                    newResults: { type: "array" },
                },
            },
        } as BranchNode;
        bodyScope.nodeOrder.push(checkId);

        this.threadNext(bodyScope);

        const state: Record<string, LoopStateVar> = {
            i: { schema: { type: "integer" }, initial: 0 },
            results: { schema: { type: "array" }, initial: [] as Template[] },
        };

        const outer = this.captureOuterRefs(bodyScope, new Set(["items"]), {
            hasState: true,
        });

        const loopNode: LoopNode = {
            kind: "loop",
            inputs: { items: collectionTemplate, ...outer.inputs },
            body: {
                inputSchema: {
                    type: "object",
                    required: ["items", ...outer.required],
                    properties: {
                        items: { type: "array" },
                        ...outer.properties,
                    },
                },
                entry: bodyScope.nodeOrder[0] ?? "",
                nodes: bodyScope.nodes,
                output: {
                    $from: "state",
                    name: "results",
                } as unknown as Template,
                outputSchema: { type: "array" },
            },
            state,
            continueWhen: {
                $from: "scope",
                name: compareId,
            } as unknown as Template,
            iterateState: {
                i: {
                    $from: "scope",
                    name: "_iter_out",
                    path: ["newI"],
                } as unknown as Template,
                results: {
                    $from: "scope",
                    name: "_iter_out",
                    path: ["newResults"],
                } as unknown as Template,
            },
            bind: loopId,
        };

        scope.nodes[loopId] = loopNode;
        scope.nodeOrder.push(loopId);
        return this.scopeRef(loopId, scope);
    }

    private emitParallel(expr: ParallelNode, scope: ScopeContext): Template {
        const forkId = this.freshId("parallel");

        const parallelResolved = this.getResolvedSchemas(
            expr.loc.offset,
            expr.loc,
            `parallel branch types`,
        );

        const branches: ForkNode["branches"] = {};

        for (let i = 0; i < expr.bodies.length; i++) {
            const branchScope = this.childScope(scope);
            let returnOutput: Template | undefined;
            for (const s of expr.bodies[i].body) {
                const result = this.emitStatement(s, branchScope);
                if (result?.output !== undefined) {
                    returnOutput = result.output;
                }
            }
            this.threadNext(branchScope);

            // Use the explicit return template (which may include a path),
            // falling back to last node's bind.
            let branchOutput: Template | null;
            if (returnOutput !== undefined) {
                branchOutput = returnOutput;
            } else {
                const lastNodeId =
                    branchScope.nodeOrder[branchScope.nodeOrder.length - 1];
                const lastNode = lastNodeId
                    ? branchScope.nodes[lastNodeId]
                    : undefined;
                const outputBind =
                    lastNode &&
                    (lastNode.kind === "task" ||
                        lastNode.kind === "loop" ||
                        lastNode.kind === "fork" ||
                        lastNode.kind === "forkMap" ||
                        lastNode.kind === "branch" ||
                        lastNode.kind === "workflowCall") &&
                    lastNode.bind
                        ? lastNode.bind
                        : undefined;
                branchOutput = outputBind
                    ? ({
                          $from: "scope",
                          name: outputBind,
                      } as unknown as Template)
                    : null;
            }

            const outer = this.captureOuterRefs(branchScope, new Set(), {
                extraVisit: branchOutput !== null ? [branchOutput] : [],
            });

            branches[`branch_${i}`] = {
                inputs: outer.inputs,
                scope: {
                    inputSchema: {
                        type: "object",
                        ...(outer.required.length > 0
                            ? {
                                  required: outer.required,
                                  properties: outer.properties,
                              }
                            : {}),
                    },
                    entry: branchScope.nodeOrder[0] ?? "",
                    nodes: branchScope.nodes,
                    output: branchOutput,
                    outputSchema:
                        parallelResolved?.branchOutputSchemas?.[i] ?? {},
                },
            };
        }

        let maxConcurrency: number | undefined;
        if (expr.maxConcurrency) {
            const mc = this.constExprToValue(expr.maxConcurrency);
            if (typeof mc === "number") {
                maxConcurrency = mc;
            }
        }

        const forkNode: ForkNode = {
            kind: "fork",
            branches,
            outputSchema: { type: "array" },
            ...(maxConcurrency !== undefined ? { maxConcurrency } : {}),
            bind: forkId,
        };

        scope.nodes[forkId] = forkNode;
        scope.nodeOrder.push(forkId);
        return this.scopeRef(forkId, scope);
    }

    private emitParallelMap(
        expr: ParallelMapNode,
        scope: ScopeContext,
    ): Template {
        const collectionTemplate = this.emitExpr(expr.collection, scope);
        const forkMapId = this.freshId("parallelMap");

        // Resolve element type from type checker (stored at the expr offset).
        const resolved = this.getResolvedSchemas(
            expr.loc.offset,
            expr.loc,
            `parallelMap element type`,
        );
        const elementSchema: JSONSchema = resolved?.outputSchema ?? {};

        const bodyScope = this.childScope(scope);
        bodyScope.bindings.set(expr.param, {
            kind: "loopInput",
            nodeId: expr.param,
        });

        let bodyReturnOutput: Template | undefined;
        for (const s of expr.body) {
            const result = this.emitStatement(s, bodyScope);
            if (result?.output !== undefined) {
                bodyReturnOutput = result.output;
            }
        }
        this.threadNext(bodyScope);

        let maxConcurrency: number | undefined;
        if (expr.maxConcurrency) {
            const mc = this.constExprToValue(expr.maxConcurrency);
            if (typeof mc === "number") {
                maxConcurrency = mc;
            }
        }

        // Capture outer-scope references used in body
        const outer = this.captureOuterRefs(bodyScope, new Set([expr.param]), {
            hasState: true,
        });

        // Use the explicit return template (which may include a path),
        // falling back to last node's bind.
        let bodyOutput: Template | null;
        if (bodyReturnOutput !== undefined) {
            bodyOutput = bodyReturnOutput;
        } else {
            const lastNodeId =
                bodyScope.nodeOrder[bodyScope.nodeOrder.length - 1];
            const lastNode = lastNodeId
                ? bodyScope.nodes[lastNodeId]
                : undefined;
            const outputBind =
                lastNode &&
                (lastNode.kind === "task" ||
                    lastNode.kind === "loop" ||
                    lastNode.kind === "fork" ||
                    lastNode.kind === "forkMap" ||
                    lastNode.kind === "branch" ||
                    lastNode.kind === "workflowCall") &&
                lastNode.bind
                    ? lastNode.bind
                    : undefined;
            bodyOutput = outputBind
                ? ({
                      $from: "scope",
                      name: outputBind,
                  } as unknown as Template)
                : null;
        }

        const forkMapNode: ForkMapNode = {
            kind: "forkMap",
            collection: collectionTemplate,
            collectionSchema: { type: "array", items: elementSchema },
            elementParam: expr.param,
            ...(Object.keys(outer.inputs).length > 0
                ? { inputs: outer.inputs }
                : {}),
            body: {
                inputSchema: {
                    type: "object",
                    required: [expr.param, ...outer.required],
                    properties: {
                        [expr.param]: elementSchema,
                        ...outer.properties,
                    },
                },
                entry: bodyScope.nodeOrder[0] ?? "",
                nodes: bodyScope.nodes,
                output: bodyOutput,
                outputSchema: resolved?.bodyOutputSchema ?? {},
            },
            outputSchema: { type: "array" },
            ...(maxConcurrency !== undefined ? { maxConcurrency } : {}),
            bind: forkMapId,
        };

        scope.nodes[forkMapId] = forkMapNode;
        scope.nodeOrder.push(forkMapId);
        return this.scopeRef(forkMapId, scope);
    }

    // ---- Task argument resolution ----

    private resolveTaskArgs(
        args: import("./ast.js").TaskArg[],
        schema: TaskSchemaInfo | undefined,
        scope: ScopeContext,
    ): Record<string, Template> {
        const inputs: Record<string, Template> = {};
        const paramNames = schema
            ? Object.keys(
                  ((schema.inputSchema as Record<string, unknown>)
                      .properties as Record<string, unknown>) ?? {},
              )
            : [];

        // Single object-literal arg: unwrap entries into named inputs
        if (
            args.length === 1 &&
            args[0].kind === "PositionalArg" &&
            args[0].value.kind === "ObjectLiteralExpr"
        ) {
            const objExpr = args[0].value;
            for (const entry of objExpr.entries) {
                inputs[entry.key] = this.emitExpr(entry.value, scope);
            }
            return inputs;
        }

        let positionalIndex = 0;
        for (const arg of args) {
            if (arg.kind === "NamedArg") {
                inputs[arg.name] = this.emitExpr(arg.value, scope);
            } else {
                if (positionalIndex < paramNames.length) {
                    inputs[paramNames[positionalIndex]] = this.emitExpr(
                        arg.value,
                        scope,
                    );
                    positionalIndex++;
                } else {
                    // Use positional index as key when no schema
                    inputs[`arg${positionalIndex}`] = this.emitExpr(
                        arg.value,
                        scope,
                    );
                    positionalIndex++;
                }
            }
        }
        return inputs;
    }

    // ---- Name resolution ----

    private resolveDottedName(
        segments: string[],
        scope: ScopeContext,
        expr: Expr,
    ): Template {
        const first = segments[0];
        const rest = segments.slice(1);

        let current: ScopeContext | undefined = scope;
        while (current) {
            const binding = current.bindings.get(first);
            if (binding) {
                this.referencedNodes.add(first);
                switch (binding.kind) {
                    case "node": {
                        const nodeId = binding.nodeId!;
                        this.referencedNodes.add(nodeId);
                        return {
                            $from: "scope",
                            name: nodeId,
                            path: rest.length > 0 ? rest : undefined,
                        } as unknown as Template;
                    }
                    case "param":
                        return {
                            $from: "input",
                            name: first,
                            path: rest.length > 0 ? rest : undefined,
                        } as unknown as Template;
                    case "constant":
                        return {
                            $from: "constant",
                            name: first,
                            path: rest.length > 0 ? rest : undefined,
                        } as unknown as Template;
                    case "loopInput": {
                        const inputName = binding.nodeId ?? first;
                        return {
                            $from: "input",
                            name: inputName,
                            path: rest.length > 0 ? rest : undefined,
                        } as unknown as Template;
                    }
                    case "recoveryInput": {
                        const recoveryName = binding.nodeId ?? first;
                        return {
                            $from: "recovery",
                            name: recoveryName,
                            path: rest.length > 0 ? rest : undefined,
                        } as unknown as Template;
                    }
                    case "literal":
                        if (rest.length > 0) {
                            // Forward the path onto the resolved template so
                            // that default expressions like `b = a.foo` work
                            // when `a` was inlined as a caller-resolved ref.
                            const base = binding.value as Record<
                                string,
                                unknown
                            >;
                            const existingPath = Array.isArray(base.path)
                                ? (base.path as string[])
                                : [];
                            return {
                                ...base,
                                path: [...existingPath, ...rest],
                            } as unknown as Template;
                        }
                        return binding.value!;
                }
            }
            current = current.parent;
        }

        this.emitError(
            `Unknown reference: ${segments.join(".")}`,
            expr.loc.line,
            expr.loc.col,
            segments.join(".").length,
        );
        return segments.join(".");
    }

    // ---- Scope helpers ----

    /**
     * Scan all nodes in bodyScope for `$from: "scope"` references that
     * point to nodes not in bodyScope. Promote those to loop inputs so
     * the IR validator accepts them.
     *
     * Returns the additional inputs and inputSchema properties to merge
     * into the loop node.
     */
    private captureOuterRefs(
        bodyScope: ScopeContext,
        existingInputNames: Set<string>,
        options: { hasState?: boolean; extraVisit?: unknown[] } = {},
    ): {
        inputs: Record<string, Template>;
        properties: Record<string, JSONSchema>;
        required: string[];
    } {
        // hasState=true: this scope has a state namespace (loop body).
        //                State refs are local; do NOT rewrite them.
        // hasState=false: arm sub-scope without state. State refs must
        //                be hoisted into arm.inputs (evaluated in the
        //                parent loop body scope which DOES have state).
        const hasState = !!options.hasState;
        const bodyNodeIds = new Set(Object.keys(bodyScope.nodes));
        // Branch nodes bind through `node.bind`, which is the name consumers
        // use to read the unified arm result. Treat those bind names as
        // locally-available so they aren't hoisted as outer refs.
        for (const node of Object.values(bodyScope.nodes)) {
            const bn = node as { bind?: string };
            if (typeof bn.bind === "string") bodyNodeIds.add(bn.bind);
        }
        const captured = new Map<string, Template>();

        const visit = (value: unknown): void => {
            if (value === null || value === undefined) return;
            if (typeof value !== "object") return;
            if (Array.isArray(value)) {
                for (const el of value) visit(el);
                return;
            }
            const obj = value as Record<string, unknown>;
            if (
                obj.$from === "scope" &&
                typeof obj.name === "string" &&
                !bodyNodeIds.has(obj.name) &&
                !existingInputNames.has(obj.name)
            ) {
                // This is an outer-scope reference: rewrite to input ref
                const outerName = obj.name as string;
                if (!captured.has(outerName)) {
                    const parentRef = {
                        $from: "scope",
                        name: outerName,
                        ...(obj.path ? { path: obj.path } : {}),
                    } as unknown as Template;
                    captured.set(outerName, parentRef);
                }
                // Rewrite in-place to reference the loop input
                obj.$from = "input";
            } else if (
                obj.$from === "state" &&
                typeof obj.name === "string" &&
                !hasState
            ) {
                // Arm sub-scopes have no state namespace.
                // Capture state refs as arm inputs (evaluated in the outer
                // loop body scope that DOES have state), then rewrite the
                // in-arm reference to $from:"input".
                const stateName = obj.name as string;
                if (!captured.has(stateName)) {
                    captured.set(stateName, {
                        $from: "state",
                        name: stateName,
                    } as unknown as Template);
                }
                obj.$from = "input";
            } else if (
                obj.$from === "input" &&
                typeof obj.name === "string" &&
                !existingInputNames.has(obj.name)
            ) {
                // Workflow-level input param referenced inside a loop body:
                // thread it through the loop's input map so it's available.
                const outerName = obj.name as string;
                if (!captured.has(outerName)) {
                    const parentRef = {
                        $from: "input",
                        name: outerName,
                    } as unknown as Template;
                    captured.set(outerName, parentRef);
                }
                // $from stays "input" - no rewrite needed since we're
                // adding it to the loop's inputs under the same name.
            } else {
                for (const val of Object.values(obj)) {
                    visit(val);
                }
            }
        };

        for (const node of Object.values(bodyScope.nodes)) {
            // Branch nodes have BranchArm children with self-contained
            // sub-scopes. Their arm.scope internals already had
            // captureOuterRefs run on them when the arm was built; the
            // surviving outer refs were promoted to arm.inputs (evaluated
            // in THIS scope). So visit only `selector`, arm `inputs`, and
            // top-level `next`/`onError` - skip `cases.*.scope` and
            // `default.scope`.
            if ((node as WorkflowNode).kind === "branch") {
                const bn = node as BranchNode;
                visit(bn.selector);
                for (const arm of Object.values(bn.cases)) {
                    visit(arm.inputs);
                }
                if (bn.default) visit(bn.default.inputs);
                continue;
            }
            visit(node);
        }
        if (options.extraVisit) {
            for (const t of options.extraVisit) visit(t);
        }

        const inputs: Record<string, Template> = {};
        const properties: Record<string, JSONSchema> = {};
        const required: string[] = [];
        for (const [name, tmpl] of captured) {
            inputs[name] = tmpl;
            properties[name] = {};
            required.push(name);
        }

        return { inputs, properties, required };
    }

    /**
     * Build a BranchArm from a child scope. Calls captureOuterRefs to
     * rewrite outer/$state refs to arm input refs, threads next within the
     * scope, and returns the arm object.
     *
     * @param childScope   Scope whose nodes become the arm scope.
     * @param output       Template for the arm's scope output (optional).
     * @param outputSchema Schema for the arm's scope output (optional).
     * @param existingInputNames Names already available as $from:"input"
     *                     in the parent scope — not re-captured.
     */
    private buildArmScope(
        childScope: ScopeContext,
        output?: Template,
        outputSchema?: JSONSchema,
        existingInputNames: Set<string> = new Set(),
    ): BranchArm {
        this.threadNext(childScope);
        // captureOuterRefs also rewrites refs in the output template,
        // so e.g. `return x` in an else arm correctly threads `x` through
        // arm.inputs as $from:"input".
        //
        // MAINTENANCE NOTE: if any future template is added to a scope object
        // (e.g. annotations, guards, preconditions) it must also be passed
        // through extraVisit here. Omitting it produces an unresolvable ref
        // at runtime with no validator error.
        const outer = this.captureOuterRefs(childScope, existingInputNames, {
            extraVisit: output !== undefined ? [output] : [],
        });
        const scope: WorkflowScope = {
            inputSchema: {
                type: "object",
                ...(outer.required.length > 0
                    ? {
                          required: outer.required,
                          properties: outer.properties,
                      }
                    : {}),
            },
            entry: childScope.nodeOrder[0] ?? "",
            nodes: childScope.nodes,
            output: output !== undefined ? output : null,
            outputSchema: outputSchema !== undefined ? outputSchema : {},
        };
        return { inputs: outer.inputs, scope };
    }

    /** Minimal no-op arm for branches that need a placeholder. */
    private makeNoopArm(): BranchArm {
        const noopId = this.freshId("arm_noop");
        return {
            inputs: {},
            scope: {
                inputSchema: { type: "object" },
                entry: noopId,
                nodes: {
                    [noopId]: {
                        kind: "task",
                        task: "noop",
                        inputSchema: {},
                        outputSchema: {},
                        inputs: {},
                    } as TaskNode,
                },
                output: null,
                outputSchema: {},
            },
        };
    }

    /**
     * Build a BranchArm from a scope that may have no statements of its own
     * but produces an output template (e.g. an `if` arm whose body is just
     * `return x`). Adds a noop node so the arm has a real entry, then runs
     * the normal buildArmScope path so captureOuterRefs hoists references
     * in the output template into arm.inputs.
     */
    private buildOutputOnlyArm(
        scope: ScopeContext,
        output: Template,
        outputSchema: JSONSchema = {},
    ): BranchArm {
        const noopId = this.freshId("arm_noop");
        scope.nodes[noopId] = {
            kind: "task",
            task: "noop",
            inputSchema: {},
            outputSchema: {},
            inputs: {},
        } as TaskNode;
        scope.nodeOrder.push(noopId);
        return this.buildArmScope(scope, output, outputSchema);
    }

    private childScope(parent: ScopeContext): ScopeContext {
        return {
            nodes: {},
            nodeOrder: [],
            bindings: new Map(),
            parent,
        };
    }

    private scopeRef(nodeId: string, scope: ScopeContext): Template {
        this.referencedNodes.add(nodeId);
        return {
            $from: "scope",
            name: nodeId,
        } as unknown as Template;
    }

    // ---- Next-edge threading ----

    private threadNext(scope: ScopeContext): void {
        for (let i = 0; i < scope.nodeOrder.length - 1; i++) {
            const id = scope.nodeOrder[i];
            const node = scope.nodes[id];
            if (!node) continue;
            if (node.kind !== "branch" && !node.next) {
                node.next = scope.nodeOrder[i + 1];
            }
        }
    }

    private stripUnreferencedBinds(scope: ScopeContext): void {
        for (const [_id, node] of Object.entries(scope.nodes)) {
            if (node.kind === "task" && node.bind) {
                if (!this.referencedNodes.has(node.bind)) {
                    delete (node as unknown as Record<string, unknown>).bind;
                }
            }
        }
    }

    // ---- Mark template refs as optional ----

    /**
     * Deep-clone a template, adding `optional: true` to every `$from` ref.
     * Used for attempts body output where the exhaustion path always throws
     * before the output binding is reached, so the binding is guaranteed to
     * be set on any path that actually resolves the template.
     */
    private markTemplateOptional(template: Template): Template {
        if (template === null || template === undefined) return template;
        if (typeof template !== "object") return template;
        if (Array.isArray(template)) {
            return template.map((t) => this.markTemplateOptional(t));
        }
        const obj = template as Record<string, unknown>;
        if ("$from" in obj) {
            return { ...obj, optional: true } as unknown as Template;
        }
        if ("$literal" in obj) return template;
        const result: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(obj)) {
            result[key] = this.markTemplateOptional(value as Template);
        }
        return result as unknown as Template;
    }

    // ---- Prefix node refs for branch scoping ----

    private prefixNodeRefs(node: WorkflowNode, prefix: string): WorkflowNode {
        const clone = { ...node } as Record<string, unknown>;
        if ("next" in node && node.next) {
            clone.next = `${prefix}${node.next}`;
        }
        if ("onError" in node && node.onError) {
            clone.onError = `${prefix}${node.onError}`;
        }
        if (node.kind === "branch") {
            // cases/default are BranchArm sub-scope objects: their internal
            // node references are already self-contained. Only `next` and
            // `onError` on the branch itself need prefixing, which is
            // handled above by the generic checks.
        }
        return clone as unknown as WorkflowNode;
    }

    // ---- Helpers ----

    private templateVarName(expr: Expr, index: number): string {
        if (expr.kind === "DottedNameExpr" && expr.segments.length > 0) {
            return expr.segments[expr.segments.length - 1];
        }
        return `v${index}`;
    }

    private freshId(prefix: string): string {
        return `${prefix}_${this.nodeCounter++}`;
    }

    private isPureLiteral(expr: Expr): boolean {
        switch (expr.kind) {
            case "StringLiteralExpr":
            case "NumberLiteralExpr":
            case "BooleanLiteralExpr":
            case "NullLiteralExpr":
                return true;
            case "ArrayLiteralExpr":
                return expr.elements.every((e) => this.isPureLiteral(e));
            case "ObjectLiteralExpr":
                return expr.entries.every((e) => this.isPureLiteral(e.value));
            default:
                return false;
        }
    }

    private producesNode(expr: Expr): boolean {
        switch (expr.kind) {
            case "TaskCallExpr":
            case "WorkflowCallExpr":
            case "TemplateLiteralExpr":
            case "BinaryExpr":
            case "UnaryExpr":
            case "TernaryExpr":
            case "AttemptsNode":
            case "MapNode":
            case "FilterNode":
            case "ParallelNode":
            case "ParallelMapNode":
                return true;
            default:
                return false;
        }
    }

    private constExprToValue(expr: Expr): unknown {
        switch (expr.kind) {
            case "StringLiteralExpr":
                return decodeStringLiteral(expr.raw, expr.quote).value;
            case "NumberLiteralExpr":
                return expr.value;
            case "BooleanLiteralExpr":
                return expr.value;
            case "NullLiteralExpr":
                return null;
            case "ArrayLiteralExpr":
                return expr.elements.map((e) => this.constExprToValue(e));
            case "ObjectLiteralExpr": {
                const obj: Record<string, unknown> = {};
                for (const entry of expr.entries) {
                    obj[entry.key] = this.constExprToValue(entry.value);
                }
                return obj;
            }
            default:
                this.emitError(
                    "Expression must be a literal value",
                    expr.loc.line,
                    expr.loc.col,
                );
                return null;
        }
    }

    private inferLiteralSchema(expr: Expr): JSONSchema {
        switch (expr.kind) {
            case "StringLiteralExpr":
                return { type: "string" };
            case "NumberLiteralExpr":
                return Number.isInteger(expr.value)
                    ? { type: "integer" }
                    : { type: "number" };
            case "BooleanLiteralExpr":
                return { type: "boolean" };
            case "ArrayLiteralExpr":
                return { type: "array" };
            default:
                return {};
        }
    }

    private paramsToSchema(
        params: { name: string; type: TypeExpr }[],
    ): JSONSchema {
        const properties: Record<string, JSONSchema> = {};
        const required: string[] = [];
        for (const p of params) {
            properties[p.name] = typeExprToSchema(p.type);
            required.push(p.name);
        }
        return { type: "object", required, properties };
    }

    private emitError(
        msg: string,
        line: number,
        col: number,
        length: number = 1,
    ): void {
        this.errors.push({ message: msg, line, col, length });
    }
}
