// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Workflow DSL v2 emitter: AST -> WorkflowIR.
 *
 * Walks the v2 AST and produces the flat IR JSON consumed by the engine.
 * Key responsibilities:
 *
 * - Scope-based name resolution (params, const bindings, node outputs)
 * - Conditional `bind`: only emit when a binding is referenced downstream
 * - Thread `next` edges from statement order
 * - Lower built-in expressions (retry, map, filter, parallel, parallelMap)
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
    RetryNode,
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
                this.emitIf(stmt, scope);
                return undefined;
            case "SwitchStatement":
                this.emitSwitch(stmt, scope);
                return undefined;
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
    ): void {
        // Emit condition - may produce a node
        const condTemplate = this.emitExpr(stmt.condition, scope);

        const branchId = this.freshId("branch");
        const mergeId = this.freshId("merge");

        // Create child scopes for then/else
        const thenScope = this.childScope(scope);
        for (const s of stmt.then) {
            this.emitStatement(s, thenScope);
        }
        this.threadNext(thenScope);

        let elseScope: ScopeContext | undefined;
        if (stmt.else_ && stmt.else_.length > 0) {
            elseScope = this.childScope(scope);
            for (const s of stmt.else_) {
                this.emitStatement(s, elseScope);
            }
            this.threadNext(elseScope);
        }

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
    }

    // ---- Switch statement ----

    private emitSwitch(
        stmt: import("./ast.js").SwitchStatement,
        scope: ScopeContext,
    ): void {
        const discTemplate = this.emitExpr(stmt.discriminant, scope);
        const branchId = this.freshId("switch");
        const mergeId = this.freshId("merge");

        const cases: Record<string, string> = {};
        let defaultTarget = mergeId; // fallthrough to merge if no default

        for (let i = 0; i < stmt.arms.length; i++) {
            const arm = stmt.arms[i];
            const armScope = this.childScope(scope);
            for (const s of arm.body) {
                this.emitStatement(s, armScope);
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
                this.emitStatement(s, defScope);
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
            outputSchema: {},
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
            case "RetryNode":
                return this.emitRetry(expr, scope);
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
            case "RetryNode":
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
        const left = this.emitExpr(expr.left, scope);
        const right = this.emitExpr(expr.right, scope);

        const taskName = this.binaryOpToTask(expr.op);
        const nodeId = this.freshId(taskName.replace(/\./g, "_"));

        const node: TaskNode = {
            kind: "task",
            task: taskName,
            inputSchema: {
                type: "object",
                required: ["left", "right"],
                properties: { left: {}, right: {} },
            },
            outputSchema: this.binaryOpOutputSchema(expr.op),
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
            case "&&":
                return "bool.and";
            case "||":
                return "bool.or";
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
            case "&&":
            case "||":
                return { type: "boolean" };
            case "+":
            case "-":
            case "*":
            case "/":
            case "%":
                return { type: "number" };
        }
    }

    private emitUnaryExpr(expr: UnaryExpr, scope: ScopeContext): Template {
        const operand = this.emitExpr(expr.operand, scope);

        const taskName = expr.op === "!" ? "bool.not" : "math.negate";
        const nodeId = this.freshId(taskName.replace(/\./g, "_"));

        const node: TaskNode = {
            kind: "task",
            task: taskName,
            inputSchema: {
                type: "object",
                required: ["value"],
                properties: { value: {} },
            },
            outputSchema:
                expr.op === "!" ? { type: "boolean" } : { type: "number" },
            inputs: { value: operand },
            bind: nodeId,
        };

        scope.nodes[nodeId] = node;
        scope.nodeOrder.push(nodeId);
        return this.scopeRef(nodeId, scope);
    }

    private emitTernaryExpr(expr: TernaryExpr, scope: ScopeContext): Template {
        const condTemplate = this.emitExpr(expr.condition, scope);

        const branchId = this.freshId("ternary");

        // Emit consequent and alternate as single-node sub-scopes
        const thenScope = this.childScope(scope);
        const thenResult = this.emitExpr(expr.consequent, thenScope);
        // If consequent produced nodes, use them; otherwise create a literal node
        let thenEntry: string;
        if (thenScope.nodeOrder.length > 0) {
            this.threadNext(thenScope);
            for (const [id, node] of Object.entries(thenScope.nodes)) {
                scope.nodes[`then_${id}`] = this.prefixNodeRefs(node, "then_");
            }
            thenEntry = `then_${thenScope.nodeOrder[0]}`;
        } else {
            // Create a passthrough node for the literal value
            const passId = this.freshId("ternary_then");
            scope.nodes[passId] = {
                kind: "task",
                task: "identity",
                inputSchema: {},
                outputSchema: {},
                inputs: { value: thenResult },
                bind: passId,
            };
            thenEntry = passId;
        }

        const elseScope = this.childScope(scope);
        const elseResult = this.emitExpr(expr.alternate, elseScope);
        let elseEntry: string;
        if (elseScope.nodeOrder.length > 0) {
            this.threadNext(elseScope);
            for (const [id, node] of Object.entries(elseScope.nodes)) {
                scope.nodes[`else_${id}`] = this.prefixNodeRefs(node, "else_");
            }
            elseEntry = `else_${elseScope.nodeOrder[0]}`;
        } else {
            const passId = this.freshId("ternary_else");
            scope.nodes[passId] = {
                kind: "task",
                task: "identity",
                inputSchema: {},
                outputSchema: {},
                inputs: { value: elseResult },
                bind: passId,
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

        scope.nodes[branchId] = branchNode;
        scope.nodeOrder.push(branchId);
        return {
            $from: "scope",
            name: branchId,
        } as unknown as Template;
    }

    // ---- Built-in nodes ----

    private emitRetry(expr: RetryNode, scope: ScopeContext): Template {
        const countTemplate = this.emitExpr(expr.count, scope);
        const loopId = this.freshId("retry");

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

        // --- Retry infrastructure (error path only) ---
        // On failure, control flows: step_attempt -> check_done -> branch
        //   can retry  -> @iterate
        //   exhausted  -> retry_exhaust (error.fail, triggers loop onError)
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
            outputSchema: {
                type: "object",
                required: ["result"],
                properties: { result: { type: "number" } },
            },
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
            outputSchema: {
                type: "object",
                required: ["result"],
                properties: { result: { type: "boolean" } },
            },
            inputs: {
                left: {
                    $from: "scope",
                    name: stepId,
                    path: ["result"],
                } as unknown as Template,
                right: countTemplate,
            },
            bind: compareId,
        };

        const exhaustId = this.freshId("retry_exhaust");
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
                value: "Retry exhausted",
            },
            bind: exhaustId,
            next: "@exit",
        };

        const checkBranchId = this.freshId("retry_check");
        bodyScope.nodes[checkBranchId] = {
            kind: "branch",
            selector: {
                $from: "scope",
                name: compareId,
                path: ["result"],
            } as unknown as Template,
            selectorSchema: { type: "boolean" },
            cases: { true: exhaustId },
            default: "@iterate",
        };

        // Chain the retry infrastructure nodes
        (bodyScope.nodes[stepId] as TaskNode).next = compareId;
        (bodyScope.nodes[compareId] as TaskNode).next = checkBranchId;

        // Wire body nodes: last body node -> @exit on success,
        // all body task nodes -> stepId on error (enters retry path)
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

        // Capture outer-scope references used in retry body
        const outer = this.captureOuterRefs(bodyScope, new Set<string>());

        // The body output is optional because the retry_exhaust path
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
                    path: ["result"],
                } as unknown as Template,
            },
            maxIterations: 100, // safety limit
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
        // Element access via list.elementAt
        // Use param name as both node ID and bind so $from:"scope" refs
        // match what the validator resolves via buildBindingMap (keyed on bind).
        const pickId = expr.param;
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

        // Loop infrastructure: step i, get length, compare, branch
        const stepId = this.freshId("step_i");
        bodyScope.nodes[stepId] = {
            kind: "task",
            task: "math.add",
            inputSchema: {
                type: "object",
                required: ["left", "right"],
                properties: {
                    left: { type: "integer" },
                    right: { type: "integer" },
                },
            },
            outputSchema: { type: "integer" },
            inputs: {
                left: { $from: "state", name: "i" } as unknown as Template,
                right: 1,
            },
            bind: stepId,
        };
        bodyScope.nodeOrder.push(stepId);

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
                    left: { type: "integer" },
                    right: { type: "integer" },
                },
            },
            outputSchema: { type: "boolean" },
            inputs: {
                left: {
                    $from: "scope",
                    name: stepId,
                } as unknown as Template,
                right: {
                    $from: "scope",
                    name: lengthId,
                } as unknown as Template,
            },
            bind: compareId,
        };
        bodyScope.nodeOrder.push(compareId);

        const checkId = this.freshId("check_done");
        bodyScope.nodes[checkId] = {
            kind: "branch",
            selector: {
                $from: "scope",
                name: compareId,
            } as unknown as Template,
            selectorSchema: { type: "boolean" },
            cases: { true: "@iterate" },
            default: "@exit",
        };
        bodyScope.nodeOrder.push(checkId);

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
                i: { $from: "scope", name: stepId } as unknown as Template,
                results: {
                    $from: "scope",
                    name: appendId,
                } as unknown as Template,
            },
            maxIterations: 10000,
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

        // Pick element - use param name as node ID to match bind
        const pickId = expr.param;
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

        // Loop infrastructure
        const stepId = this.freshId("step_i");
        bodyScope.nodes[stepId] = {
            kind: "task",
            task: "math.add",
            inputSchema: {
                type: "object",
                required: ["left", "right"],
                properties: {
                    left: { type: "integer" },
                    right: { type: "integer" },
                },
            },
            outputSchema: { type: "integer" },
            inputs: {
                left: { $from: "state", name: "i" } as unknown as Template,
                right: 1,
            },
            bind: stepId,
        };

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

        const compareId = this.freshId("compare");
        bodyScope.nodes[compareId] = {
            kind: "task",
            task: "compare.lessThan",
            inputSchema: {
                type: "object",
                required: ["left", "right"],
                properties: {
                    left: { type: "integer" },
                    right: { type: "integer" },
                },
            },
            outputSchema: { type: "boolean" },
            inputs: {
                left: { $from: "scope", name: stepId } as unknown as Template,
                right: {
                    $from: "scope",
                    name: lengthId,
                } as unknown as Template,
            },
            bind: compareId,
        };

        const checkId = this.freshId("check_done");
        bodyScope.nodes[checkId] = {
            kind: "branch",
            selector: {
                $from: "scope",
                name: compareId,
            } as unknown as Template,
            selectorSchema: { type: "boolean" },
            cases: { true: "@iterate" },
            default: "@exit",
        };

        // Branch on filter condition: true -> append, false -> keep_results
        // Both paths converge at merge_results, which iterateState references
        const keepResultsId = this.freshId("keep_results");
        bodyScope.nodes[keepResultsId] = {
            kind: "task",
            task: "identity",
            inputSchema: {},
            outputSchema: { type: "array" },
            inputs: {
                value: {
                    $from: "state",
                    name: "results",
                } as unknown as Template,
            },
            bind: keepResultsId,
        };

        // Merge node: whichever of append/keep_results ran, this node
        // captures the final results list. The engine's scope will have
        // either appendId or keepResultsId resolved. We use a branch
        // to merge: the merge just re-reads the state that was just written.
        // Actually, simplest: use a second branch that picks append or keep_results.
        // But the engine can't do that without re-evaluating the condition.
        //
        // Alternative: use the loop's iterateState to pick based on which node ran.
        // The engine resolves iterateState refs after the body completes.
        // Since exactly one of append/keep_results will have run, we need
        // iterateState to reference the right one.
        //
        // Solution: make both paths write to the SAME bind name. The last one
        // to execute wins. Since only one path runs per iteration, this is safe.
        (bodyScope.nodes[appendId] as TaskNode).bind = "updated_results";
        (bodyScope.nodes[keepResultsId] as TaskNode).bind = "updated_results";

        bodyScope.nodes[filterBranchId] = {
            kind: "branch",
            selector: condTemplate ?? false,
            selectorSchema: { type: "boolean" },
            cases: { true: appendId },
            default: keepResultsId,
        };
        bodyScope.nodeOrder.push(filterBranchId);
        // Append and keep_results both flow to step_i
        (bodyScope.nodes[appendId] as TaskNode).next = stepId;
        bodyScope.nodeOrder.push(appendId);
        (bodyScope.nodes[keepResultsId] as TaskNode).next = stepId;
        bodyScope.nodeOrder.push(keepResultsId);
        bodyScope.nodeOrder.push(stepId);
        bodyScope.nodeOrder.push(lengthId);
        bodyScope.nodeOrder.push(compareId);
        bodyScope.nodeOrder.push(checkId);

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
                i: { $from: "scope", name: stepId } as unknown as Template,
                results: {
                    $from: "scope",
                    name: "updated_results",
                } as unknown as Template,
            },
            maxIterations: 10000,
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
            for (const s of expr.bodies[i].body) {
                this.emitStatement(s, branchScope);
            }
            this.threadNext(branchScope);

            // Determine branch output: last node's bind, or null
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

            branches[`branch_${i}`] = {
                inputs: {},
                scope: {
                    inputSchema: {},
                    entry: branchScope.nodeOrder[0] ?? "",
                    nodes: branchScope.nodes,
                    output: outputBind
                        ? ({
                              $from: "scope",
                              name: outputBind,
                          } as unknown as Template)
                        : null,
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

        for (const s of expr.body) {
            this.emitStatement(s, bodyScope);
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

        // Determine body output: last node's bind
        const lastNodeId = bodyScope.nodeOrder[bodyScope.nodeOrder.length - 1];
        const lastNode = lastNodeId ? bodyScope.nodes[lastNodeId] : undefined;
        const outputBind =
            lastNode &&
            (lastNode.kind === "task" ||
                lastNode.kind === "loop" ||
                lastNode.kind === "fork" ||
                lastNode.kind === "forkMap") &&
            lastNode.bind
                ? lastNode.bind
                : undefined;

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
                output: outputBind
                    ? ({
                          $from: "scope",
                          name: outputBind,
                      } as unknown as Template)
                    : null,
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
                            path:
                                rest.length > 0
                                    ? rest
                                    : this.getAutoProjectPath(current, nodeId),
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
        const path = this.getAutoProjectPath(scope, nodeId);
        return {
            $from: "scope",
            name: nodeId,
            ...(path ? { path } : {}),
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
     * Used for retry body output where the exhaustion path always throws
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

    private getAutoProjectPath(
        scope: ScopeContext,
        nodeId: string,
    ): string[] | undefined {
        const node = scope.nodes[nodeId];
        if (!node || node.kind !== "task") return undefined;
        return this.getAutoProjectPathFromSchema(node.outputSchema);
    }

    private getAutoProjectPathFromSchema(
        schema: JSONSchema | undefined,
    ): string[] | undefined {
        if (!schema) return undefined;
        const outSchema = schema as Record<string, unknown>;
        if (outSchema.type !== "object") return undefined;
        const props = outSchema.properties as
            | Record<string, unknown>
            | undefined;
        if (!props) return undefined;
        const keys = Object.keys(props);
        if (keys.length === 1) return [keys[0]];
        return undefined;
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
            case "RetryNode":
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
                    case "any":
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
