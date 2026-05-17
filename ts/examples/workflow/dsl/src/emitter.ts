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
    WorkflowNode,
    TaskNode,
    BranchNode,
    LoopNode,
    ForkNode,
    ForkMapNode,
    LoopStateVar,
    Template,
    JSONSchema,
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
} from "./ast.js";

export interface TaskSchemaInfo {
    name: string;
    inputSchema: JSONSchema;
    outputSchema: JSONSchema;
}

export interface EmitError {
    message: string;
    line: number;
    col: number;
}

// ---- Binding: how a name resolves in scope ----

type BindingKind = "node" | "param" | "constant" | "loopInput" | "literal";

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

export class Emitter {
    private errors: EmitError[] = [];
    private taskSchemas: Map<string, TaskSchemaInfo>;
    private nodeCounter = 0;
    private constants: Record<string, { schema: JSONSchema; value: unknown }> =
        {};
    /** Set of node IDs that are referenced by expressions */
    private referencedNodes = new Set<string>();

    constructor(taskSchemas: TaskSchemaInfo[]) {
        this.taskSchemas = new Map(taskSchemas.map((t) => [t.name, t]));
    }

    emit(ast: WorkflowDecl): {
        ir: WorkflowIR | undefined;
        errors: EmitError[];
    } {
        this.errors = [];
        this.nodeCounter = 0;
        this.constants = {};
        this.referencedNodes = new Set();

        const inputSchema = this.paramsToSchema(ast.params);
        const outputSchema = this.typeToSchema(ast.returnType);

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
                outputSchema: {},
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

        const ir: WorkflowIR = {
            kind: "workflow",
            name: ast.name,
            ...(ast.description ? { description: ast.description } : {}),
            version: "1",
            inputSchema,
            outputSchema,
            ...(Object.keys(this.constants).length > 0
                ? { constants: this.constants }
                : {}),
            nodes: rootScope.nodes,
            entry: rootScope.nodeOrder.length > 0 ? rootScope.nodeOrder[0] : "",
            output:
                outputTemplate ??
                ({ $from: "input", name: "" } as unknown as Template),
        };

        return {
            ir: this.errors.length === 0 ? ir : undefined,
            errors: this.errors,
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
                ? this.typeToSchema(stmt.typeAnnotation)
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
                // Each destructured name gets a binding that projects into the output
                for (let i = 0; i < stmt.names.length; i++) {
                    // Create a pick node for each element
                    const pickId = this.freshId(`pick_${stmt.names[i]}`);
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
                        outputSchema: {},
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

        const branchId = this.freshId("branch");
        const mergeId = this.freshId("merge");

        // Create child scopes for then/else, capturing return values
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

        // When both branches return, normalize through identity nodes
        // with a common bind name so the scope ref resolves regardless
        // of which branch actually executes.
        let resultBind: string | undefined;
        if (thenOutput !== undefined && elseOutput !== undefined) {
            resultBind = this.freshId("if_result");
            this.referencedNodes.add(resultBind);

            const thenWrapId = this.freshId("then_wrap");
            thenScope.nodes[thenWrapId] = {
                kind: "task",
                task: "identity",
                inputSchema: {
                    type: "object",
                    required: ["value"],
                    properties: { value: {} },
                },
                outputSchema: {},
                inputs: { value: thenOutput },
                bind: resultBind,
            };
            thenScope.nodeOrder.push(thenWrapId);

            const elseWrapId = this.freshId("else_wrap");
            elseScope!.nodes[elseWrapId] = {
                kind: "task",
                task: "identity",
                inputSchema: {
                    type: "object",
                    required: ["value"],
                    properties: { value: {} },
                },
                outputSchema: {},
                inputs: { value: elseOutput },
                bind: resultBind,
            };
            elseScope!.nodeOrder.push(elseWrapId);
        }

        this.threadNext(thenScope);
        if (elseScope) this.threadNext(elseScope);

        // Merge then/else nodes into parent with prefixes
        const thenEntry = thenScope.nodeOrder[0];
        const elseEntry = elseScope?.nodeOrder[0];

        for (const [id, node] of Object.entries(thenScope.nodes)) {
            scope.nodes[`then_${id}`] = this.prefixNodeRefs(node, "then_");
        }
        for (const [id, node] of Object.entries(elseScope?.nodes ?? {})) {
            scope.nodes[`else_${id}`] = this.prefixNodeRefs(node, "else_");
        }

        // Patch branch body tails to point to merge node
        this.patchBranchTail(thenScope, "then_", mergeId, scope);
        if (elseScope) {
            this.patchBranchTail(elseScope, "else_", mergeId, scope);
        }

        // Create branch and merge nodes
        const branchNode: BranchNode = {
            kind: "branch",
            selector: condTemplate,
            selectorSchema: { type: "boolean" },
            cases: {
                true: thenEntry ? `then_${thenEntry}` : mergeId,
            },
            default: elseEntry ? `else_${elseEntry}` : mergeId,
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

        // Propagate return value from branches
        if (resultBind) {
            // Both branches wrapped in identity with common bind
            return {
                output: {
                    $from: "scope",
                    name: resultBind,
                } as unknown as Template,
            };
        }
        if (thenOutput !== undefined) {
            return { output: thenOutput };
        }
        if (elseOutput !== undefined) {
            return { output: elseOutput };
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

        const cases: Record<string, string> = {};
        let defaultTarget = mergeId; // fallthrough to merge if no default
        let branchOutput: Template | undefined;

        for (let i = 0; i < stmt.arms.length; i++) {
            const arm = stmt.arms[i];
            const armScope = this.childScope(scope);
            for (const s of arm.body) {
                const r = this.emitStatement(s, armScope);
                if (r?.output !== undefined && branchOutput === undefined) {
                    branchOutput = r.output;
                }
            }
            this.threadNext(armScope);

            const armPrefix = `case${i}_`;
            for (const [id, node] of Object.entries(armScope.nodes)) {
                scope.nodes[`${armPrefix}${id}`] = this.prefixNodeRefs(
                    node,
                    armPrefix,
                );
            }

            this.patchBranchTail(armScope, armPrefix, mergeId, scope);

            const caseValue = this.constExprToValue(arm.value);
            const caseKey = String(caseValue);
            cases[caseKey] =
                armScope.nodeOrder.length > 0
                    ? `${armPrefix}${armScope.nodeOrder[0]}`
                    : mergeId;
        }

        if (stmt.default_ && stmt.default_.length > 0) {
            const defScope = this.childScope(scope);
            for (const s of stmt.default_) {
                const r = this.emitStatement(s, defScope);
                if (r?.output !== undefined && branchOutput === undefined) {
                    branchOutput = r.output;
                }
            }
            this.threadNext(defScope);

            const defPrefix = "default_";
            for (const [id, node] of Object.entries(defScope.nodes)) {
                scope.nodes[`${defPrefix}${id}`] = this.prefixNodeRefs(
                    node,
                    defPrefix,
                );
            }
            this.patchBranchTail(defScope, defPrefix, mergeId, scope);
            defaultTarget =
                defScope.nodeOrder.length > 0
                    ? `${defPrefix}${defScope.nodeOrder[0]}`
                    : mergeId;
        }

        const branchNode: BranchNode = {
            kind: "branch",
            selector: discTemplate,
            selectorSchema: {},
            cases,
            default: defaultTarget,
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

        if (branchOutput !== undefined) {
            return { output: branchOutput };
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
                return expr.value;
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
            );
            return undefined;
        }

        const inputs = this.resolveTaskArgs(expr.args, schema, scope);

        return {
            kind: "task",
            task: expr.task,
            inputSchema: schema.inputSchema,
            outputSchema: schema.outputSchema,
            inputs,
            bind: bindName,
        };
    }

    private emitWorkflowCall(
        expr: import("./ast.js").WorkflowCallExpr,
        scope: ScopeContext,
        bindName: string,
    ): TaskNode | undefined {
        // Emit as a task call with name "workflow.<name>"
        // The engine or a future pass handles workflow resolution
        const taskName = `workflow.${expr.name}`;
        const inputs = this.resolveTaskArgs(expr.args, undefined, scope);

        return {
            kind: "task",
            task: taskName,
            inputSchema: {},
            outputSchema: {},
            inputs,
            bind: bindName,
        };
    }

    private emitTemplateLiteral(
        expr: TemplateLiteralExpr,
        scope: ScopeContext,
        bindName: string,
    ): TaskNode | undefined {
        const schema = this.taskSchemas.get("text.template");
        if (!schema) {
            this.emitError(
                "Task schema for text.template not found",
                expr.loc.line,
                expr.loc.col,
            );
            return undefined;
        }

        let templateStr = expr.parts[0];
        const vars: Record<string, Template> = {};
        for (let i = 0; i < expr.expressions.length; i++) {
            const innerExpr = expr.expressions[i];
            const varName = this.templateVarName(innerExpr, i);
            templateStr += `{{${varName}}}`;
            templateStr += expr.parts[i + 1];
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
        const node: TaskNode = {
            kind: "task",
            task: taskName,
            inputSchema: schema?.inputSchema ?? {
                type: "object",
                required: ["left", "right"],
                properties: { left: {}, right: {} },
            },
            outputSchema:
                schema?.outputSchema ?? this.binaryOpOutputSchema(expr.op),
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
        const node: TaskNode = {
            kind: "task",
            task: taskName,
            inputSchema: schema?.inputSchema ?? {
                type: "object",
                required: ["value"],
                properties: { value: {} },
            },
            outputSchema:
                schema?.outputSchema ??
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
     */
    private emitShortCircuit(expr: BinaryExpr, scope: ScopeContext): Template {
        const isAnd = expr.op === "&&";
        const condTemplate = this.emitExpr(expr.left, scope);

        const branchId = this.freshId(isAnd ? "and" : "or");
        const mergeId = this.freshId(isAnd ? "and_merge" : "or_merge");
        const resultBind = this.freshId(isAnd ? "and_result" : "or_result");

        // The "evaluate" arm: evaluate the right operand
        const evalScope = this.childScope(scope);
        const evalResult = this.emitExpr(expr.right, evalScope);
        let evalEntry: string;
        const evalPrefix = isAnd ? "and_rhs_" : "or_rhs_";
        if (evalScope.nodeOrder.length > 0) {
            this.threadNext(evalScope);
            for (const [id, node] of Object.entries(evalScope.nodes)) {
                const prefixed = this.prefixNodeRefs(node, evalPrefix);
                if (
                    id === evalScope.nodeOrder[evalScope.nodeOrder.length - 1]
                ) {
                    (prefixed as TaskNode).bind = resultBind;
                    (prefixed as TaskNode).next = mergeId;
                }
                scope.nodes[`${evalPrefix}${id}`] = prefixed;
            }
            evalEntry = `${evalPrefix}${evalScope.nodeOrder[0]}`;
        } else {
            // Right operand is a simple value; wrap in identity
            const passId = this.freshId(isAnd ? "and_rhs" : "or_rhs");
            scope.nodes[passId] = {
                kind: "task",
                task: "identity",
                inputSchema: {
                    type: "object",
                    required: ["value"],
                    properties: { value: {} },
                },
                outputSchema: { type: "boolean" },
                inputs: { value: evalResult },
                bind: resultBind,
                next: mergeId,
            };
            evalEntry = passId;
        }

        // The "short-circuit" arm: return the known boolean literal
        const shortId = this.freshId(isAnd ? "and_short" : "or_short");
        scope.nodes[shortId] = {
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
            bind: resultBind,
            next: mergeId,
        };

        // &&: true -> evaluate rhs, false (default) -> short-circuit
        // ||: true -> short-circuit, false (default) -> evaluate rhs
        const branchNode: BranchNode = {
            kind: "branch",
            selector: condTemplate,
            selectorSchema: { type: "boolean" },
            cases: { true: isAnd ? evalEntry : shortId },
            default: isAnd ? shortId : evalEntry,
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

        const branchId = this.freshId("ternary");
        const mergeId = this.freshId("merge");
        const resultBind = this.freshId("ternary_result");

        // Emit consequent and alternate as single-node sub-scopes
        const thenScope = this.childScope(scope);
        const thenResult = this.emitExpr(expr.consequent, thenScope);
        let thenEntry: string;
        if (thenScope.nodeOrder.length > 0) {
            this.threadNext(thenScope);
            for (const [id, node] of Object.entries(thenScope.nodes)) {
                const prefixed = this.prefixNodeRefs(node, "then_");
                // Ensure the last node uses the common bind name
                if (
                    id === thenScope.nodeOrder[thenScope.nodeOrder.length - 1]
                ) {
                    (prefixed as TaskNode).bind = resultBind;
                    (prefixed as TaskNode).next = mergeId;
                }
                scope.nodes[`then_${id}`] = prefixed;
            }
            thenEntry = `then_${thenScope.nodeOrder[0]}`;
        } else {
            // Create a passthrough node for the literal value
            const passId = this.freshId("ternary_then");
            scope.nodes[passId] = {
                kind: "task",
                task: "identity",
                inputSchema: {
                    type: "object",
                    required: ["value"],
                    properties: { value: {} },
                },
                outputSchema: {},
                inputs: { value: thenResult },
                bind: resultBind,
                next: mergeId,
            };
            thenEntry = passId;
        }

        const elseScope = this.childScope(scope);
        const elseResult = this.emitExpr(expr.alternate, elseScope);
        let elseEntry: string;
        if (elseScope.nodeOrder.length > 0) {
            this.threadNext(elseScope);
            for (const [id, node] of Object.entries(elseScope.nodes)) {
                const prefixed = this.prefixNodeRefs(node, "else_");
                if (
                    id === elseScope.nodeOrder[elseScope.nodeOrder.length - 1]
                ) {
                    (prefixed as TaskNode).bind = resultBind;
                    (prefixed as TaskNode).next = mergeId;
                }
                scope.nodes[`else_${id}`] = prefixed;
            }
            elseEntry = `else_${elseScope.nodeOrder[0]}`;
        } else {
            const passId = this.freshId("ternary_else");
            scope.nodes[passId] = {
                kind: "task",
                task: "identity",
                inputSchema: {
                    type: "object",
                    required: ["value"],
                    properties: { value: {} },
                },
                outputSchema: {},
                inputs: { value: elseResult },
                bind: resultBind,
                next: mergeId,
            };
            elseEntry = passId;
        }

        const branchNode: BranchNode = {
            kind: "branch",
            selector: condTemplate,
            selectorSchema: { type: "boolean" },
            cases: { true: thenEntry },
            default: elseEntry,
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
        this.threadNext(bodyScope);

        // State: attempt counter
        const state: Record<string, LoopStateVar> = {
            attempt: { schema: { type: "number" }, initial: 0 },
        };

        // --- Attempts infrastructure (error path only) ---
        // On failure, control flows: step_attempt -> check_done -> branch
        //   can retry  -> @iterate
        //   exhausted  -> attempts_exhaust (error.fail, triggers loop onError)
        // On success, the last body node goes directly to @exit.

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
        };
        // NOT pushed to nodeOrder: these are only reachable via onError

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
        };

        const exhaustId = this.freshId("attempts_exhaust");
        bodyScope.nodes[exhaustId] = {
            kind: "task",
            task: "error.fail",
            inputSchema: {
                type: "object",
                required: ["value"],
                properties: { value: {} },
            },
            outputSchema: { type: "object" },
            inputs: {
                value: "Attempts exhausted",
            },
            bind: exhaustId,
            next: "@exit",
        };

        const checkBranchId = this.freshId("attempts_check");
        bodyScope.nodes[checkBranchId] = {
            kind: "branch",
            selector: {
                $from: "scope",
                name: compareId,
            } as unknown as Template,
            selectorSchema: { type: "boolean" },
            cases: { true: exhaustId },
            default: "@iterate",
        };

        // Chain the attempts infrastructure nodes
        (bodyScope.nodes[stepId] as TaskNode).next = compareId;
        (bodyScope.nodes[compareId] as TaskNode).next = checkBranchId;

        // Wire body nodes: last body node -> @exit on success,
        // all body task nodes -> stepId on error (enters attempts path)
        const lastBodyId = bodyScope.nodeOrder[bodyScope.nodeOrder.length - 1];
        if (lastBodyId) {
            const lastNode = bodyScope.nodes[lastBodyId];
            if (lastNode && lastNode.kind !== "branch") {
                lastNode.next = "@exit";
            }
        }
        for (const id of bodyScope.nodeOrder) {
            const node = bodyScope.nodes[id];
            if (node && node.kind === "task") {
                node.onError = stepId;
            }
        }

        // Handle fallback (onError at loop level, for exhaustion)
        let onError: string | undefined;
        if (expr.fallback) {
            const fbScope = this.childScope(scope);
            fbScope.bindings.set(expr.fallback.param, {
                kind: "loopInput",
                nodeId: "error",
            });
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
        const outer = this.captureOuterRefs(bodyScope, new Set<string>());

        // The body output is optional because the attempts_exhaust path
        // (error.fail) always throws before reaching @exit, so the output
        // binding is never actually unresolved. Mark optional to satisfy
        // the dominator coverage check.
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
                outputSchema: {},
            },
            state,
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

        // Build body scope: param is the loop element
        const bodyScope = this.childScope(scope);

        // --- Loop infrastructure (condition check FIRST) ---
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
        };
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
        };
        bodyScope.nodeOrder.push(compareId);

        // Branch: true (i < length) → continue to pick, false → @exit
        const pickId = expr.param;
        const checkId = this.freshId("check_done");
        bodyScope.nodes[checkId] = {
            kind: "branch",
            selector: {
                $from: "scope",
                name: compareId,
            } as unknown as Template,
            selectorSchema: { type: "boolean" },
            cases: { true: pickId },
            default: "@exit",
        };
        bodyScope.nodeOrder.push(checkId);

        // --- Body: pick element, user code, append, increment ---
        bodyScope.nodes[pickId] = {
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
            outputSchema: {},
            inputs: {
                list: { $from: "input", name: "items" } as unknown as Template,
                index: { $from: "state", name: "i" } as unknown as Template,
            },
            bind: pickId,
        };
        bodyScope.nodeOrder.push(pickId);
        bodyScope.bindings.set(expr.param, { kind: "node", nodeId: pickId });

        let outputTemplate: Template = null;
        for (const s of expr.body) {
            const result = this.emitStatement(s, bodyScope);
            if (result?.output !== undefined) {
                outputTemplate = result.output;
            }
        }

        // Accumulator for results
        const appendId = this.freshId("append");
        bodyScope.nodes[appendId] = {
            kind: "task",
            task: "list.append",
            inputSchema: {
                type: "object",
                required: ["list", "item"],
                properties: {
                    list: { type: "array" },
                    item: {},
                },
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
        };
        bodyScope.nodeOrder.push(appendId);

        // Increment i, then @iterate back to condition check
        const stepId = this.freshId("step_i");
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
                left: { $from: "state", name: "i" } as unknown as Template,
                right: 1,
            },
            next: "@iterate",
            bind: stepId,
        };
        bodyScope.nodeOrder.push(stepId);

        this.threadNext(bodyScope);

        const state: Record<string, LoopStateVar> = {
            i: { schema: { type: "integer" }, initial: 0 },
            results: { schema: { type: "array" }, initial: [] as Template[] },
        };

        // Capture outer-scope references used in body and promote to loop inputs
        const outer = this.captureOuterRefs(bodyScope, new Set(["items"]));

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
            iterateState: {
                i: {
                    $from: "scope",
                    name: stepId,
                } as unknown as Template,
                results: {
                    $from: "scope",
                    name: appendId,
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

        const bodyScope = this.childScope(scope);

        // --- Loop infrastructure (condition check FIRST) ---
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
        };
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
        };
        bodyScope.nodeOrder.push(compareId);

        // Branch: true (i < length) -> continue to pick, false -> @exit
        const pickId = expr.param;
        const checkId = this.freshId("check_done");
        bodyScope.nodes[checkId] = {
            kind: "branch",
            selector: {
                $from: "scope",
                name: compareId,
            } as unknown as Template,
            selectorSchema: { type: "boolean" },
            cases: { true: pickId },
            default: "@exit",
        };
        bodyScope.nodeOrder.push(checkId);

        // --- Body: pick element, user code, conditional append, increment ---
        bodyScope.nodes[pickId] = {
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
            outputSchema: {},
            inputs: {
                list: { $from: "input", name: "items" } as unknown as Template,
                index: { $from: "state", name: "i" } as unknown as Template,
            },
            bind: pickId,
        };
        bodyScope.nodeOrder.push(pickId);
        bodyScope.bindings.set(expr.param, { kind: "node", nodeId: pickId });

        // User body (should return boolean)
        let condTemplate: Template = null;
        for (const s of expr.body) {
            const result = this.emitStatement(s, bodyScope);
            if (result?.output !== undefined) {
                condTemplate = result.output;
            }
        }

        // Conditional append: if body returns true, append element to results
        const filterBranchId = this.freshId("filter_check");
        const appendId = this.freshId("append");
        const stepId = this.freshId("step_i");

        bodyScope.nodes[appendId] = {
            kind: "task",
            task: "list.append",
            inputSchema: {
                type: "object",
                required: ["list", "item"],
                properties: {
                    list: { type: "array" },
                    item: {},
                },
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
            bind: appendId,
        };

        // Normalize both paths through identity so both bind "updated_results"
        // with shape { result: array }, then converge at step_i.
        const wrapAppendId = this.freshId("wrap_append");
        bodyScope.nodes[wrapAppendId] = {
            kind: "task",
            task: "identity",
            inputSchema: {
                type: "object",
                required: ["value"],
                properties: { value: {} },
            },
            outputSchema: {},
            inputs: {
                value: {
                    $from: "scope",
                    name: appendId,
                } as unknown as Template,
            },
            bind: "updated_results",
            next: stepId,
        };

        const keepResultsId = this.freshId("keep_results");
        bodyScope.nodes[keepResultsId] = {
            kind: "task",
            task: "identity",
            inputSchema: {
                type: "object",
                required: ["value"],
                properties: { value: {} },
            },
            outputSchema: {},
            inputs: {
                value: {
                    $from: "state",
                    name: "results",
                } as unknown as Template,
            },
            bind: "updated_results",
            next: stepId,
        };

        // Branch on filter condition: true -> append -> wrap_append -> step_i
        //                             false -> keep_results -> step_i
        bodyScope.nodes[filterBranchId] = {
            kind: "branch",
            selector: condTemplate ?? false,
            selectorSchema: { type: "boolean" },
            cases: { true: appendId },
            default: keepResultsId,
        };
        bodyScope.nodeOrder.push(filterBranchId);
        (bodyScope.nodes[appendId] as TaskNode).next = wrapAppendId;
        bodyScope.nodeOrder.push(appendId);
        bodyScope.nodeOrder.push(wrapAppendId);
        bodyScope.nodeOrder.push(keepResultsId);

        // Increment i, then @iterate back to condition check
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
                left: { $from: "state", name: "i" } as unknown as Template,
                right: 1,
            },
            next: "@iterate",
            bind: stepId,
        };
        bodyScope.nodeOrder.push(stepId);

        this.threadNext(bodyScope);

        const state: Record<string, LoopStateVar> = {
            i: { schema: { type: "integer" }, initial: 0 },
            results: { schema: { type: "array" }, initial: [] as Template[] },
        };

        // Capture outer-scope references used in body
        const outer = this.captureOuterRefs(bodyScope, new Set(["items"]));

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
            iterateState: {
                i: {
                    $from: "scope",
                    name: stepId,
                } as unknown as Template,
                results: {
                    $from: "scope",
                    name: "updated_results",
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
                        lastNode.kind === "forkMap") &&
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

            branches[`branch_${i}`] = {
                inputs: {},
                scope: {
                    inputSchema: {},
                    entry: branchScope.nodeOrder[0] ?? "",
                    nodes: branchScope.nodes,
                    output: branchOutput,
                    outputSchema: {},
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
        const outer = this.captureOuterRefs(bodyScope, new Set([expr.param]));

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
                    lastNode.kind === "forkMap") &&
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
            collectionSchema: { type: "array" },
            elementParam: expr.param,
            ...(Object.keys(outer.inputs).length > 0
                ? { inputs: outer.inputs }
                : {}),
            body: {
                inputSchema: {},
                entry: bodyScope.nodeOrder[0] ?? "",
                nodes: bodyScope.nodes,
                output: bodyOutput,
                outputSchema: {},
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
                    case "literal":
                        if (rest.length > 0) {
                            this.emitError(
                                `Cannot access path on literal value '${first}'`,
                                expr.loc.line,
                                expr.loc.col,
                            );
                            return null;
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
    ): {
        inputs: Record<string, Template>;
        properties: Record<string, JSONSchema>;
        required: string[];
    } {
        const bodyNodeIds = new Set(Object.keys(bodyScope.nodes));
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
            visit(node);
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
     * before reaching @exit, so the output binding is guaranteed to be set
     * on any path that actually resolves the template.
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
            const cases = { ...node.cases };
            for (const [k, v] of Object.entries(cases)) {
                if (!v.startsWith("@")) {
                    cases[k] = `${prefix}${v}`;
                }
            }
            clone.cases = cases;
            if (!node.default.startsWith("@")) {
                clone.default = `${prefix}${node.default}`;
            }
        }
        return clone as unknown as WorkflowNode;
    }

    /**
     * Patch the last node in a branch body scope to point to the merge node
     * in the parent scope. The nodes have already been merged with the prefix.
     */
    private patchBranchTail(
        childScope: ScopeContext,
        prefix: string,
        mergeId: string,
        parentScope: ScopeContext,
    ): void {
        if (childScope.nodeOrder.length === 0) return;
        const lastChildId =
            childScope.nodeOrder[childScope.nodeOrder.length - 1];
        const prefixedId = `${prefix}${lastChildId}`;
        const node = parentScope.nodes[prefixedId];
        if (!node) return;
        if (node.kind !== "branch" && !("next" in node && node.next)) {
            (node as TaskNode).next = mergeId;
        }
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
                return expr.value;
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
            properties[p.name] = this.typeToSchema(p.type);
            required.push(p.name);
        }
        return { type: "object", required, properties };
    }

    private typeToSchema(t: TypeExpr): JSONSchema {
        switch (t.kind) {
            case "NamedType":
                switch (t.name) {
                    case "string":
                        return { type: "string" };
                    case "number":
                        return { type: "number" };
                    case "integer":
                        return { type: "integer" };
                    case "boolean":
                        return { type: "boolean" };
                    case "never":
                        return { not: {} };
                    case "unknown":
                        return {};
                    default:
                        return { type: t.name as JSONSchema["type"] };
                }
            case "ArrayType":
                return { type: "array", items: this.typeToSchema(t.element) };
            case "ObjectType": {
                const props: Record<string, JSONSchema> = {};
                const req: string[] = [];
                for (const f of t.fields) {
                    props[f.name] = this.typeToSchema(f.type);
                    if (!f.optional) req.push(f.name);
                }
                return { type: "object", required: req, properties: props };
            }
        }
    }

    private emitError(msg: string, line: number, col: number): void {
        this.errors.push({ message: msg, line, col });
    }
}
