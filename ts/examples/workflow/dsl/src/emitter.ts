// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Workflow DSL emitter: AST -> WorkflowIR.
 *
 * This is the lowering pass. It walks the AST and produces the IR JSON
 * that the workflow engine consumes. Key responsibilities:
 *
 * - Scope-based name resolution (params, let bindings, constants, state vars)
 * - Conditional `bind`: only emit when a binding is referenced downstream
 * - Thread `next` edges from statement order
 * - Desugar `for..of` to loop nodes with index/length/compare/branch
 * - Desugar `while(true)` to loop nodes with state/break/continue
 * - Desugar `if`/`else` to branch nodes with boolean selectors
 * - Desugar `try`/`catch` to onError edges
 * - Lower `const` to IR constants section
 * - Lower object return to object output template
 * - Auto-project single-field output schemas
 */

import {
    WorkflowIR,
    WorkflowNode,
    TaskNode,
    LoopNode,
    Template,
    JSONSchema,
    LoopStateVar,
} from "workflow-model";
import {
    WorkflowDecl,
    Statement,
    Expr,
    TypeExpr,
    TaskCallExpr,
    TemplateLiteralExpr,
    ForOfStatement,
    WhileStatement,
    IfStatement,
    LetStatement,
    ConstStatement,
    AssignmentStatement,
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

/**
 * Binding records track how a name resolves.
 *
 *  - "node": a task/loop node in the current scope (use $from: "scope")
 *  - "param": a workflow parameter (use $from: "input")
 *  - "constant": an IR constant (use $from: "constant")
 *  - "state": a loop state variable (use $from: "state")
 *  - "loopInput": a loop-body input (use $from: "input")
 *  - "literal": an inline literal value (substituted directly)
 *  - "uninitialized": declared but not yet assigned (e.g. `let x: type;`)
 */
type BindingKind =
    | "node"
    | "param"
    | "constant"
    | "state"
    | "loopInput"
    | "literal"
    | "uninitialized";

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
    /** Parent scope for name resolution (lexical scoping) */
    parent?: ScopeContext | undefined;
    /** For loop body scopes: the loop variable name */
    loopVar?: string | undefined;
    /** For loop body scopes: the pick node ID */
    pickNodeId?: string | undefined;
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

        // Build root scope with params
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

        // Thread `next` edges
        this.threadNext(rootScope);

        // Strip `bind` from unreferenced nodes
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
            case "LetStatement":
                this.emitLet(stmt, scope);
                return undefined;
            case "ConstStatement":
                this.emitConst(stmt, scope);
                return undefined;
            case "AssignmentStatement":
                this.emitAssignment(stmt, scope);
                return undefined;
            case "ForOfStatement":
                this.emitForOf(stmt, scope);
                return undefined;
            case "WhileStatement":
                this.emitWhile(stmt, scope);
                return undefined;
            case "IfStatement":
                this.emitIf(stmt, scope);
                return undefined;
            case "TryStatement":
                this.emitError(
                    "try/catch is only supported inside while loop bodies",
                    stmt.loc.line,
                    stmt.loc.col,
                );
                return undefined;
            case "ReturnStatement":
                return {
                    output: this.exprToTemplate(stmt.value, scope),
                };
            case "BreakStatement":
            case "ContinueStatement":
                this.emitError(
                    `${stmt.kind === "BreakStatement" ? "break" : "continue"} is only valid inside a loop body`,
                    stmt.loc.line,
                    stmt.loc.col,
                );
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

    private emitLet(stmt: LetStatement, scope: ScopeContext): void {
        if (!stmt.value) {
            // Uninitialized: `let x: type;`
            scope.bindings.set(stmt.name, { kind: "uninitialized" });
            return;
        }

        const expr = stmt.value;

        if (expr.kind === "TaskCallExpr") {
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
            // Literal RHS
            const value = this.exprToTemplate(expr, scope);
            scope.bindings.set(stmt.name, { kind: "literal", value });
        }
    }

    private emitConst(stmt: ConstStatement, scope: ScopeContext): void {
        const value = this.constExprToValue(stmt.value);
        const schema = stmt.typeAnnotation
            ? this.typeToSchema(stmt.typeAnnotation)
            : this.inferLiteralSchema(stmt.value);
        this.constants[stmt.name] = { schema, value };
        scope.bindings.set(stmt.name, { kind: "constant" });
    }

    private emitAssignment(
        stmt: AssignmentStatement,
        _scope: ScopeContext,
    ): void {
        this.emitError(
            `Assignment to '${stmt.name}' outside a loop body is not supported`,
            stmt.loc.line,
            stmt.loc.col,
        );
    }

    // ---- Task call emission ----

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

        const inputs = this.resolveTaskArgs(expr, schema, scope);

        return {
            kind: "task",
            task: expr.task,
            inputSchema: schema.inputSchema,
            outputSchema: schema.outputSchema,
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
            vars[varName] = this.exprToTemplate(innerExpr, scope);
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

    private templateVarName(expr: Expr, index: number): string {
        if (expr.kind === "DottedNameExpr" && expr.segments.length > 0) {
            return expr.segments[expr.segments.length - 1];
        }
        return `v${index}`;
    }

    private resolveTaskArgs(
        expr: TaskCallExpr,
        schema: TaskSchemaInfo,
        scope: ScopeContext,
    ): Record<string, Template> {
        const inputs: Record<string, Template> = {};
        const schemaProps = (schema.inputSchema as Record<string, unknown>)
            .properties as Record<string, unknown> | undefined;
        const paramNames = schemaProps ? Object.keys(schemaProps) : [];

        // Single object-literal arg: unwrap entries into named inputs
        if (
            expr.args.length === 1 &&
            expr.args[0].kind === "PositionalArg" &&
            expr.args[0].value.kind === "ObjectLiteralExpr"
        ) {
            const objExpr = expr.args[0].value;
            for (const entry of objExpr.entries) {
                inputs[entry.key] = this.exprToTemplate(entry.value, scope);
            }
            return inputs;
        }

        let positionalIndex = 0;
        for (const arg of expr.args) {
            if (arg.kind === "NamedArg") {
                inputs[arg.name] = this.exprToTemplate(arg.value, scope);
            } else {
                if (positionalIndex < paramNames.length) {
                    inputs[paramNames[positionalIndex]] = this.exprToTemplate(
                        arg.value,
                        scope,
                    );
                    positionalIndex++;
                } else {
                    this.emitError(
                        `Too many positional arguments for task ${expr.task}`,
                        expr.loc.line,
                        expr.loc.col,
                    );
                }
            }
        }
        return inputs;
    }

    // ---- Name resolution ----

    private exprToTemplate(expr: Expr, scope: ScopeContext): Template {
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
                return expr.elements.map((e) => this.exprToTemplate(e, scope));
            case "ObjectLiteralExpr": {
                const obj: Record<string, Template> = {};
                for (const entry of expr.entries) {
                    obj[entry.key] = this.exprToTemplate(entry.value, scope);
                }
                return obj;
            }
            case "DottedNameExpr":
                return this.resolveDottedName(expr.segments, scope, expr);
            case "TaskCallExpr":
                this.emitError(
                    "Task calls can only appear on the right side of a let binding",
                    expr.loc.line,
                    expr.loc.col,
                );
                return null;
            default:
                return null;
        }
    }

    /**
     * Walk the scope chain to resolve a dotted name like `foo`, `foo.bar`,
     * `fetchResult.body`, etc.
     */
    private resolveDottedName(
        segments: string[],
        scope: ScopeContext,
        expr: Expr,
    ): Template {
        const first = segments[0];
        const rest = segments.slice(1);

        // Walk scope chain
        let current: ScopeContext | undefined = scope;
        while (current) {
            // Check loop variable
            if (current.loopVar && first === current.loopVar) {
                const pickId = current.pickNodeId ?? `pick_${first}`;
                return {
                    $from: "scope",
                    name: pickId,
                    path: ["element", ...rest],
                } as unknown as Template;
            }

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
                    case "state":
                        return {
                            $from: "state",
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
                    case "uninitialized":
                        this.emitError(
                            `Variable '${first}' is used before being assigned`,
                            expr.loc.line,
                            expr.loc.col,
                        );
                        return null;
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

    // ---- for..of loop ----

    private emitForOf(stmt: ForOfStatement, scope: ScopeContext): void {
        const loopId = this.freshId("loop");
        const iterableTemplate = this.exprToTemplate(stmt.iterable, scope);

        const loopInputs: Record<string, Template> = {
            items: iterableTemplate,
        };
        const loopInputSchema: JSONSchema = {
            type: "object",
            required: ["items"],
            properties: { items: { type: "array" } },
        };

        // Collect outer refs
        const outerRefs = this.collectOuterRefs(stmt.body, scope);
        for (const [name, template] of outerRefs) {
            loopInputs[name] = template;
            (
                (loopInputSchema as Record<string, unknown>)
                    .required as string[]
            ).push(name);
            const props = (loopInputSchema as Record<string, unknown>)
                .properties as Record<string, unknown>;
            props[name] = {};
        }

        // State: index counter + accumulator state vars
        const assignmentStateVars = this.findAssignmentStateVars(
            stmt.body,
            scope,
        );
        const state: Record<string, LoopStateVar> = {
            i: { schema: { type: "integer" }, initial: 0 },
        };
        for (const [name, initial] of assignmentStateVars) {
            state[name] = {
                schema: { type: "array" },
                initial: initial as unknown as Template[],
            };
        }

        // Build loop body scope
        const bodyScope = this.buildForOfBody(
            stmt,
            scope,
            assignmentStateVars,
            outerRefs,
        );

        // Determine output
        let output: Template;
        let outputSchema: JSONSchema;
        const stateVarNames = [...assignmentStateVars.keys()];
        if (stateVarNames.length > 0) {
            const lastSV = stateVarNames[stateVarNames.length - 1];
            const lastSVNodeId = `assign_${lastSV}`;
            output = {
                $from: "scope",
                name: lastSVNodeId,
                path: ["list"],
            } as unknown as Template;
            outputSchema = { type: "array" };
        } else {
            output = { $from: "state", name: "i" } as unknown as Template;
            outputSchema = { type: "integer" };
        }

        // Build iterateState
        const iterateState: Record<string, Template> = {
            i: {
                $from: "scope",
                name: "step_i",
                path: ["result"],
            } as unknown as Template,
        };
        for (const name of stateVarNames) {
            iterateState[name] = {
                $from: "scope",
                name: `assign_${name}`,
                path: ["list"],
            } as unknown as Template;
        }

        const loopNode: LoopNode = {
            kind: "loop",
            inputs: loopInputs,
            inputSchema: loopInputSchema,
            state,
            body: {
                entry: bodyScope.nodeOrder[0],
                nodes: bodyScope.nodes,
            },
            iterateState,
            output,
            outputSchema,
            maxIterations: 100,
            bind: loopId,
        };

        scope.nodes[loopId] = loopNode;
        scope.nodeOrder.push(loopId);
        scope.bindings.set(loopId, { kind: "node", nodeId: loopId });

        // Bind state variable names to the loop node
        for (const name of stateVarNames) {
            scope.bindings.set(name, { kind: "node", nodeId: loopId });
        }
    }

    private buildForOfBody(
        stmt: ForOfStatement,
        outerScope: ScopeContext,
        assignmentStateVars: Map<string, Template>,
        outerRefs: Map<string, Template>,
    ): ScopeContext {
        const stateVarNames = new Set(["i", ...assignmentStateVars.keys()]);
        const pickId = `pick_${stmt.variable}`;

        const bodyScope: ScopeContext = {
            nodes: {},
            nodeOrder: [],
            bindings: new Map(),
            parent: outerScope,
            loopVar: stmt.variable,
            pickNodeId: pickId,
        };

        // State vars
        for (const name of stateVarNames) {
            bodyScope.bindings.set(name, { kind: "state" });
        }

        // Loop inputs
        for (const [name] of outerRefs) {
            bodyScope.bindings.set(name, {
                kind: "loopInput",
                nodeId: name,
            });
        }

        // Pick element node
        bodyScope.nodes[pickId] = {
            kind: "task",
            task: "list.elementAt",
            inputSchema: this.taskSchemas.get("list.elementAt")!.inputSchema,
            outputSchema: this.taskSchemas.get("list.elementAt")!.outputSchema,
            inputs: {
                list: { $from: "input", name: "items" } as unknown as Template,
                index: { $from: "state", name: "i" } as unknown as Template,
            },
            bind: pickId,
        };
        bodyScope.nodeOrder.push(pickId);

        // Emit user body statements
        for (const s of stmt.body) {
            if (s.kind === "LetStatement" && s.value) {
                const expr = s.value;
                const nodeId = s.name;
                let node: TaskNode | undefined;
                if (expr.kind === "TaskCallExpr") {
                    node = this.emitTaskCall(expr, bodyScope, nodeId);
                } else if (expr.kind === "TemplateLiteralExpr") {
                    node = this.emitTemplateLiteral(expr, bodyScope, nodeId);
                }
                if (node) {
                    bodyScope.nodes[nodeId] = node;
                    bodyScope.nodeOrder.push(nodeId);
                    bodyScope.bindings.set(s.name, {
                        kind: "node",
                        nodeId,
                    });
                }
            } else if (s.kind === "AssignmentStatement") {
                const expr = s.value;
                if (expr.kind === "TaskCallExpr") {
                    const nodeId = `assign_${s.name}`;
                    const node = this.emitTaskCall(expr, bodyScope, nodeId);
                    if (node) {
                        bodyScope.nodes[nodeId] = node;
                        bodyScope.nodeOrder.push(nodeId);
                    }
                }
            }
        }

        // Index stepping + length check + branch
        this.appendForOfInfrastructure(bodyScope);

        // Thread next
        this.threadNext(bodyScope);

        return bodyScope;
    }

    private appendForOfInfrastructure(bodyScope: ScopeContext): void {
        const stepId = "step_i";
        const intAddSchema = this.taskSchemas.get("int.add");
        if (intAddSchema) {
            bodyScope.nodes[stepId] = {
                kind: "task",
                task: "int.add",
                inputSchema: intAddSchema.inputSchema,
                outputSchema: intAddSchema.outputSchema,
                inputs: {
                    a: { $from: "state", name: "i" } as unknown as Template,
                    b: 1,
                },
                bind: stepId,
            };
            bodyScope.nodeOrder.push(stepId);
        }

        const lengthId = "compute_length";
        const listLengthSchema = this.taskSchemas.get("list.length");
        if (listLengthSchema) {
            bodyScope.nodes[lengthId] = {
                kind: "task",
                task: "list.length",
                inputSchema: listLengthSchema.inputSchema,
                outputSchema: listLengthSchema.outputSchema,
                inputs: {
                    list: {
                        $from: "input",
                        name: "items",
                    } as unknown as Template,
                },
                bind: lengthId,
            };
            bodyScope.nodeOrder.push(lengthId);
        }

        const compareId = "compare_index";
        const intLessThanSchema = this.taskSchemas.get("int.lessThan");
        if (intLessThanSchema) {
            bodyScope.nodes[compareId] = {
                kind: "task",
                task: "int.lessThan",
                inputSchema: intLessThanSchema.inputSchema,
                outputSchema: intLessThanSchema.outputSchema,
                inputs: {
                    a: {
                        $from: "scope",
                        name: stepId,
                        path: ["result"],
                    } as unknown as Template,
                    b: {
                        $from: "scope",
                        name: lengthId,
                        path: ["length"],
                    } as unknown as Template,
                },
                bind: compareId,
            };
            bodyScope.nodeOrder.push(compareId);
        }

        const branchId = "check_done";
        bodyScope.nodes[branchId] = {
            kind: "branch",
            selector: {
                $from: "scope",
                name: compareId,
                path: ["result"],
            } as unknown as Template,
            selectorSchema: { type: "boolean" },
            cases: { true: "@iterate", false: "@exit" },
            default: "@exit",
        };
        bodyScope.nodeOrder.push(branchId);
    }

    // ---- while(true) loop ----

    private emitWhile(stmt: WhileStatement, scope: ScopeContext): void {
        if (
            stmt.condition.kind !== "BooleanLiteralExpr" ||
            !stmt.condition.value
        ) {
            this.emitError(
                "Only `while (true)` loops are supported",
                stmt.loc.line,
                stmt.loc.col,
            );
            return;
        }

        const loopId = this.freshId("loop");

        // Find state vars and output vars from pre-while declarations
        const stateVars = new Map<
            string,
            { schema: JSONSchema; initial: Template }
        >();
        const outputVars = new Set<string>();
        for (const s of stmt.body) {
            this.findWhileStateVars(s, scope, stateVars, outputVars);
        }

        // Collect outer refs (bound names read in body)
        const outerRefs = this.collectOuterRefs(stmt.body, scope);

        // Build loop inputs
        const loopInputs: Record<string, Template> = {};
        const loopInputSchemaProps: Record<string, JSONSchema> = {};
        const loopInputRequired: string[] = [];
        for (const [name, template] of outerRefs) {
            loopInputs[name] = template;
            loopInputSchemaProps[name] = {};
            loopInputRequired.push(name);
        }

        // Build state
        const state: Record<string, LoopStateVar> = {};
        for (const [name, info] of stateVars) {
            state[name] = { schema: info.schema, initial: info.initial };
        }

        // Build body
        const bodyResult = this.buildWhileBody(
            stmt.body,
            scope,
            stateVars,
            outerRefs,
            outputVars,
        );

        // Build iterateState
        const iterateState: Record<string, Template> = {};
        for (const [name] of stateVars) {
            if (bodyResult.iterateStateRefs.has(name)) {
                iterateState[name] = bodyResult.iterateStateRefs.get(name)!;
            } else {
                iterateState[name] = {
                    $from: "state",
                    name,
                } as unknown as Template;
            }
        }

        // Determine output
        let output: Template;
        let outputSchema: JSONSchema;
        if (bodyResult.outputRef) {
            output = bodyResult.outputRef;
            outputSchema = bodyResult.outputSchema ?? { type: "string" };
        } else {
            const firstName = [...stateVars.keys()][0];
            if (firstName) {
                output = {
                    $from: "state",
                    name: firstName,
                } as unknown as Template;
                outputSchema = stateVars.get(firstName)!.schema;
            } else {
                output = null;
                outputSchema = {};
            }
        }

        const loopNode: LoopNode = {
            kind: "loop",
            inputs: Object.keys(loopInputs).length > 0 ? loopInputs : {},
            inputSchema:
                Object.keys(loopInputs).length > 0
                    ? {
                          type: "object",
                          required: loopInputRequired,
                          properties: loopInputSchemaProps,
                      }
                    : { type: "object", properties: {} },
            state,
            body: {
                entry:
                    bodyResult.scope.nodeOrder.length > 0
                        ? bodyResult.scope.nodeOrder[0]
                        : "",
                nodes: bodyResult.scope.nodes,
            },
            iterateState,
            output,
            outputSchema,
            maxIterations: 100,
            bind: loopId,
        };

        scope.nodes[loopId] = loopNode;
        scope.nodeOrder.push(loopId);
        scope.bindings.set(loopId, { kind: "node", nodeId: loopId });

        // Bind output variable names to the loop
        if (bodyResult.outputVarName) {
            scope.bindings.set(bodyResult.outputVarName, {
                kind: "node",
                nodeId: loopId,
            });
        }
    }

    private findWhileStateVars(
        stmt: Statement,
        outerScope: ScopeContext,
        stateVars: Map<string, { schema: JSONSchema; initial: Template }>,
        outputVars: Set<string>,
    ): void {
        if (stmt.kind === "AssignmentStatement") {
            const binding = outerScope.bindings.get(stmt.name);
            if (binding) {
                if (binding.kind === "literal") {
                    stateVars.set(stmt.name, {
                        schema: this.inferTemplateSchema(binding.value!),
                        initial: binding.value!,
                    });
                } else if (binding.kind === "uninitialized") {
                    outputVars.add(stmt.name);
                }
            }
        } else if (stmt.kind === "TryStatement") {
            for (const s of stmt.tryBody) {
                this.findWhileStateVars(s, outerScope, stateVars, outputVars);
            }
            for (const s of stmt.catchBody) {
                this.findWhileStateVars(s, outerScope, stateVars, outputVars);
            }
        } else if (stmt.kind === "IfStatement") {
            for (const s of stmt.then) {
                this.findWhileStateVars(s, outerScope, stateVars, outputVars);
            }
            if (stmt.else_) {
                for (const s of stmt.else_) {
                    this.findWhileStateVars(
                        s,
                        outerScope,
                        stateVars,
                        outputVars,
                    );
                }
            }
        }
    }

    private buildWhileBody(
        stmts: Statement[],
        outerScope: ScopeContext,
        stateVars: Map<string, { schema: JSONSchema; initial: Template }>,
        outerRefs: Map<string, Template>,
        outputVars: Set<string>,
    ): {
        scope: ScopeContext;
        iterateStateRefs: Map<string, Template>;
        outputRef?: Template | undefined;
        outputSchema?: JSONSchema | undefined;
        outputVarName?: string | undefined;
    } {
        const bodyScope: ScopeContext = {
            nodes: {},
            nodeOrder: [],
            bindings: new Map(),
            parent: outerScope,
        };

        for (const [name] of stateVars) {
            bodyScope.bindings.set(name, { kind: "state" });
        }

        for (const [name] of outerRefs) {
            bodyScope.bindings.set(name, {
                kind: "loopInput",
                nodeId: name,
            });
        }

        const iterateStateRefs = new Map<string, Template>();
        let outputRef: Template | undefined = undefined;
        let outputSchema: JSONSchema | undefined = undefined;
        let outputVarName: string | undefined = undefined;

        this.emitWhileBodyStatements(
            stmts,
            bodyScope,
            iterateStateRefs,
            outputVars,
            (ref, schema, varName) => {
                outputRef = ref;
                outputSchema = schema;
                outputVarName = varName;
            },
        );

        this.threadNext(bodyScope);

        return {
            scope: bodyScope,
            iterateStateRefs,
            outputRef,
            outputSchema,
            outputVarName,
        };
    }

    private emitWhileBodyStatements(
        stmts: Statement[],
        bodyScope: ScopeContext,
        iterateStateRefs: Map<string, Template>,
        outputVars: Set<string>,
        setOutput: (
            ref: Template,
            schema: JSONSchema | undefined,
            varName: string | undefined,
        ) => void,
        onErrorTarget?: string,
    ): void {
        for (const s of stmts) {
            this.emitWhileBodyStatement(
                s,
                bodyScope,
                iterateStateRefs,
                outputVars,
                setOutput,
                onErrorTarget,
            );
        }
    }

    private emitWhileBodyStatement(
        stmt: Statement,
        bodyScope: ScopeContext,
        iterateStateRefs: Map<string, Template>,
        outputVars: Set<string>,
        setOutput: (
            ref: Template,
            schema: JSONSchema | undefined,
            varName: string | undefined,
        ) => void,
        onErrorTarget?: string,
    ): void {
        switch (stmt.kind) {
            case "LetStatement": {
                if (!stmt.value) return;
                const expr = stmt.value;
                const nodeId = stmt.name;
                let node: TaskNode | undefined;
                if (expr.kind === "TaskCallExpr") {
                    node = this.emitTaskCall(expr, bodyScope, nodeId);
                } else if (expr.kind === "TemplateLiteralExpr") {
                    node = this.emitTemplateLiteral(expr, bodyScope, nodeId);
                }
                if (node) {
                    if (onErrorTarget) {
                        node.onError = onErrorTarget;
                    }
                    bodyScope.nodes[nodeId] = node;
                    bodyScope.nodeOrder.push(nodeId);
                    bodyScope.bindings.set(stmt.name, {
                        kind: "node",
                        nodeId,
                    });
                }
                break;
            }
            case "AssignmentStatement": {
                const binding = this.resolveBinding(stmt.name, bodyScope);
                if (binding?.kind === "state") {
                    if (stmt.value.kind === "TaskCallExpr") {
                        const nodeId = `assign_${stmt.name}`;
                        const node = this.emitTaskCall(
                            stmt.value,
                            bodyScope,
                            nodeId,
                        );
                        if (node) {
                            if (onErrorTarget) node.onError = onErrorTarget;
                            bodyScope.nodes[nodeId] = node;
                            bodyScope.nodeOrder.push(nodeId);
                            const taskSchema = this.taskSchemas.get(
                                stmt.value.task,
                            );
                            if (taskSchema) {
                                const autoPath =
                                    this.getAutoProjectPathFromSchema(
                                        taskSchema.outputSchema,
                                    );
                                iterateStateRefs.set(stmt.name, {
                                    $from: "scope",
                                    name: nodeId,
                                    path: autoPath,
                                } as unknown as Template);
                            }
                        }
                    }
                } else if (
                    binding?.kind === "uninitialized" ||
                    outputVars.has(stmt.name)
                ) {
                    // Assignment to output var
                    const template = this.exprToTemplate(stmt.value, bodyScope);
                    setOutput(template, undefined, stmt.name);
                }
                break;
            }
            case "TryStatement": {
                // Emit catch body first to get template nodes
                const catchStartIdx = bodyScope.nodeOrder.length;
                this.emitWhileBodyStatements(
                    stmt.catchBody,
                    bodyScope,
                    iterateStateRefs,
                    outputVars,
                    setOutput,
                );
                const catchNodeIds = bodyScope.nodeOrder.slice(catchStartIdx);

                // Save and remove catch nodes
                const catchTemplate: [string, WorkflowNode][] =
                    catchNodeIds.map((id) => [id, bodyScope.nodes[id]]);
                for (const id of catchNodeIds) {
                    delete bodyScope.nodes[id];
                }
                bodyScope.nodeOrder.splice(catchStartIdx);

                // Emit try body WITHOUT onErrorTarget
                const tryStartIdx = bodyScope.nodeOrder.length;
                this.emitWhileBodyStatements(
                    stmt.tryBody,
                    bodyScope,
                    iterateStateRefs,
                    outputVars,
                    setOutput,
                    undefined,
                );

                // Find task nodes emitted in the try body
                const tryNodeIds = bodyScope.nodeOrder.slice(tryStartIdx);
                const tryTaskNodeIds = tryNodeIds.filter((id) => {
                    const n = bodyScope.nodes[id];
                    return n && (n.kind === "task" || n.kind === "loop");
                });

                if (tryTaskNodeIds.length === 1 && catchTemplate.length > 0) {
                    // Single trigger: set onError directly, compliant
                    const taskNode = bodyScope.nodes[tryTaskNodeIds[0]] as
                        | TaskNode
                        | LoopNode;
                    taskNode.onError = catchTemplate[0][0];
                    for (const [id, node] of catchTemplate) {
                        bodyScope.nodes[id] = node;
                        bodyScope.nodeOrder.push(id);
                    }
                } else if (
                    tryTaskNodeIds.length > 1 &&
                    catchTemplate.length > 0
                ) {
                    // Multiple triggers: clone catch per trigger
                    for (let ti = 0; ti < tryTaskNodeIds.length; ti++) {
                        const triggerId = tryTaskNodeIds[ti];
                        const taskNode = bodyScope.nodes[triggerId] as
                            | TaskNode
                            | LoopNode;
                        const suffix = `_t${ti}`;
                        const cloned = this.cloneCatchNodes(
                            catchTemplate,
                            suffix,
                        );
                        taskNode.onError = cloned[0][0];
                        for (const [id, node] of cloned) {
                            bodyScope.nodes[id] = node;
                            bodyScope.nodeOrder.push(id);
                        }
                        // Update iterateStateRefs for cloned state-modifying nodes
                        for (const [origId] of catchTemplate) {
                            const clonedId = origId + suffix;
                            for (const [
                                stateVar,
                                ref,
                            ] of iterateStateRefs.entries()) {
                                const r = ref as unknown as {
                                    $from: string;
                                    name: string;
                                };
                                if (r.$from === "scope" && r.name === origId) {
                                    // Point at last trigger's clone (all are
                                    // mutually exclusive; last is as good as any
                                    // since only one executes per iteration)
                                    iterateStateRefs.set(stateVar, {
                                        ...(ref as object),
                                        name: clonedId,
                                    } as unknown as Template);
                                }
                            }
                        }
                    }
                }
                // else: no tasks in try body or empty catch - nothing to wire
                break;
            }
            case "IfStatement": {
                let condTemplate: Template;
                if (stmt.condition.kind === "TaskCallExpr") {
                    // Emit the task call as an implicit node
                    const condNodeId = this.freshId("cond");
                    const condNode = this.emitTaskCall(
                        stmt.condition,
                        bodyScope,
                        condNodeId,
                    );
                    if (condNode) {
                        if (onErrorTarget) condNode.onError = onErrorTarget;
                        bodyScope.nodes[condNodeId] = condNode;
                        bodyScope.nodeOrder.push(condNodeId);
                        const taskSchema = this.taskSchemas.get(
                            stmt.condition.task,
                        );
                        const autoPath = taskSchema
                            ? this.getAutoProjectPathFromSchema(
                                  taskSchema.outputSchema,
                              )
                            : undefined;
                        condTemplate = {
                            $from: "scope",
                            name: condNodeId,
                            path: autoPath,
                        } as unknown as Template;
                    } else {
                        condTemplate = null;
                    }
                } else {
                    condTemplate = this.exprToTemplate(
                        stmt.condition,
                        bodyScope,
                    );
                }

                // Emit then-branch
                const thenStartIdx = bodyScope.nodeOrder.length;
                this.emitWhileBodyStatements(
                    stmt.then,
                    bodyScope,
                    iterateStateRefs,
                    outputVars,
                    setOutput,
                    onErrorTarget,
                );
                const thenNodeIds = bodyScope.nodeOrder.slice(thenStartIdx);
                const thenEntry =
                    thenNodeIds.length > 0 ? thenNodeIds[0] : undefined;

                // Emit else-branch
                let elseEntry: string | undefined;
                if (stmt.else_) {
                    const elseStartIdx = bodyScope.nodeOrder.length;
                    this.emitWhileBodyStatements(
                        stmt.else_,
                        bodyScope,
                        iterateStateRefs,
                        outputVars,
                        setOutput,
                        onErrorTarget,
                    );
                    const elseNodeIds = bodyScope.nodeOrder.slice(elseStartIdx);
                    elseEntry =
                        elseNodeIds.length > 0 ? elseNodeIds[0] : undefined;
                }

                // Insert branch before both branches
                const branchId = this.freshId("if_branch");
                const allBranchNodeIds =
                    bodyScope.nodeOrder.splice(thenStartIdx);

                const cases: Record<string, string> = {};
                if (thenEntry) cases["true"] = thenEntry;
                if (elseEntry) cases["false"] = elseEntry;

                bodyScope.nodes[branchId] = {
                    kind: "branch",
                    selector: condTemplate,
                    selectorSchema: { type: "boolean" },
                    cases,
                    default: elseEntry ?? thenEntry ?? "@exit",
                };
                bodyScope.nodeOrder.push(branchId);

                for (const id of allBranchNodeIds) {
                    bodyScope.nodeOrder.push(id);
                }
                break;
            }
            case "BreakStatement": {
                const exitId = this.freshId("break");
                bodyScope.nodes[exitId] = {
                    kind: "branch",
                    selector: "exit",
                    selectorSchema: { enum: ["exit"] },
                    cases: { exit: "@exit" },
                    default: "@exit",
                };
                bodyScope.nodeOrder.push(exitId);
                break;
            }
            case "ContinueStatement": {
                const iterateId = this.freshId("continue");
                bodyScope.nodes[iterateId] = {
                    kind: "branch",
                    selector: "iterate",
                    selectorSchema: { enum: ["iterate"] },
                    cases: { iterate: "@iterate" },
                    default: "@iterate",
                };
                bodyScope.nodeOrder.push(iterateId);
                break;
            }
            default:
                break;
        }
    }

    // ---- if/else (top-level) ----

    private emitIf(stmt: IfStatement, scope: ScopeContext): void {
        let condTemplate: Template;
        if (stmt.condition.kind === "TaskCallExpr") {
            const condNodeId = this.freshId("cond");
            const condNode = this.emitTaskCall(
                stmt.condition,
                scope,
                condNodeId,
            );
            if (condNode) {
                scope.nodes[condNodeId] = condNode;
                scope.nodeOrder.push(condNodeId);
                const taskSchema = this.taskSchemas.get(stmt.condition.task);
                const autoPath = taskSchema
                    ? this.getAutoProjectPathFromSchema(taskSchema.outputSchema)
                    : undefined;
                condTemplate = {
                    $from: "scope",
                    name: condNodeId,
                    path: autoPath,
                } as unknown as Template;
            } else {
                condTemplate = null;
            }
        } else {
            condTemplate = this.exprToTemplate(stmt.condition, scope);
        }

        const thenScope: ScopeContext = {
            nodes: {},
            nodeOrder: [],
            bindings: new Map(),
            parent: scope,
        };
        for (const s of stmt.then) {
            this.emitStatement(s, thenScope);
        }
        this.threadNext(thenScope);

        let elseScope: ScopeContext | undefined;
        if (stmt.else_) {
            elseScope = {
                nodes: {},
                nodeOrder: [],
                bindings: new Map(),
                parent: scope,
            };
            for (const s of stmt.else_) {
                this.emitStatement(s, elseScope);
            }
            this.threadNext(elseScope);
        }

        // Merge with prefixes
        for (const [id, node] of Object.entries(thenScope.nodes)) {
            scope.nodes[`then_${id}`] = node;
        }
        if (elseScope) {
            for (const [id, node] of Object.entries(elseScope.nodes)) {
                scope.nodes[`else_${id}`] = node;
            }
        }

        const branchId = this.freshId("if_branch");
        const cases: Record<string, string> = {};
        let defaultTarget: string;

        if (thenScope.nodeOrder.length > 0) {
            cases["true"] = `then_${thenScope.nodeOrder[0]}`;
        }
        if (elseScope && elseScope.nodeOrder.length > 0) {
            cases["false"] = `else_${elseScope.nodeOrder[0]}`;
            defaultTarget = `else_${elseScope.nodeOrder[0]}`;
        } else {
            defaultTarget =
                thenScope.nodeOrder.length > 0
                    ? `then_${thenScope.nodeOrder[0]}`
                    : "";
        }

        scope.nodes[branchId] = {
            kind: "branch",
            selector: condTemplate,
            selectorSchema: { type: "boolean" },
            cases,
            default: defaultTarget,
        };
        scope.nodeOrder.push(branchId);
    }

    // ---- Helpers ----

    /**
     * Deep-clone a set of catch template nodes with a suffix appended
     * to all node IDs, updating internal references (next, branch
     * cases/default) to use the renamed IDs. References to nodes
     * outside the template (sentinels like @exit/@iterate, scope refs)
     * are left unchanged.
     */
    private cloneCatchNodes(
        template: [string, WorkflowNode][],
        suffix: string,
    ): [string, WorkflowNode][] {
        const idMap = new Map<string, string>();
        for (const [id] of template) {
            idMap.set(id, id + suffix);
        }

        const cloned: [string, WorkflowNode][] = [];
        for (const [id, node] of template) {
            const newId = idMap.get(id)!;
            const c = JSON.parse(JSON.stringify(node)) as WorkflowNode;

            // Rename next edge
            if ("next" in c && typeof c.next === "string") {
                c.next = idMap.get(c.next) ?? c.next;
            }

            // Rename branch targets
            if (c.kind === "branch") {
                for (const key of Object.keys(c.cases)) {
                    const target = c.cases[key];
                    c.cases[key] = idMap.get(target) ?? target;
                }
                if (typeof c.default === "string") {
                    c.default = idMap.get(c.default) ?? c.default;
                }
            }

            // Rename onError (recovery nodes shouldn't have onError
            // per spec, but be safe)
            if ("onError" in c && typeof c.onError === "string") {
                c.onError = idMap.get(c.onError) ?? c.onError;
            }

            cloned.push([newId, c]);
        }
        return cloned;
    }

    private threadNext(scope: ScopeContext): void {
        for (let i = 0; i < scope.nodeOrder.length - 1; i++) {
            const nodeId = scope.nodeOrder[i];
            const node = scope.nodes[nodeId];
            if (node.kind === "task" || node.kind === "loop") {
                if (!node.next) {
                    node.next = scope.nodeOrder[i + 1];
                }
            }
        }
    }

    private resolveBinding(
        name: string,
        scope: ScopeContext,
    ): Binding | undefined {
        let current: ScopeContext | undefined = scope;
        while (current) {
            const b = current.bindings.get(name);
            if (b) return b;
            current = current.parent;
        }
        return undefined;
    }

    private collectOuterRefs(
        statements: Statement[],
        outerScope: ScopeContext,
    ): Map<string, Template> {
        const refs = new Map<string, Template>();
        for (const stmt of statements) {
            this.walkExprs(stmt, (expr) => {
                if (expr.kind === "DottedNameExpr") {
                    const first = expr.segments[0];
                    const binding = outerScope.bindings.get(first);
                    if (binding?.kind === "node") {
                        if (!refs.has(first)) {
                            refs.set(first, {
                                $from: "scope",
                                name: binding.nodeId!,
                            } as unknown as Template);
                        }
                    }
                }
            });
        }
        return refs;
    }

    private findAssignmentStateVars(
        statements: Statement[],
        outerScope: ScopeContext,
    ): Map<string, Template> {
        const stateVars = new Map<string, Template>();
        for (const stmt of statements) {
            if (stmt.kind === "AssignmentStatement") {
                const binding = outerScope.bindings.get(stmt.name);
                if (binding?.kind === "literal") {
                    stateVars.set(stmt.name, binding.value!);
                }
            }
        }
        return stateVars;
    }

    private walkExprs(stmt: Statement, visitor: (expr: Expr) => void): void {
        switch (stmt.kind) {
            case "LetStatement":
                if (stmt.value) this.walkExpr(stmt.value, visitor);
                break;
            case "ConstStatement":
                this.walkExpr(stmt.value, visitor);
                break;
            case "AssignmentStatement":
                this.walkExpr(stmt.value, visitor);
                break;
            case "ForOfStatement":
                this.walkExpr(stmt.iterable, visitor);
                for (const s of stmt.body) this.walkExprs(s, visitor);
                break;
            case "WhileStatement":
                this.walkExpr(stmt.condition, visitor);
                for (const s of stmt.body) this.walkExprs(s, visitor);
                break;
            case "IfStatement":
                this.walkExpr(stmt.condition, visitor);
                for (const s of stmt.then) this.walkExprs(s, visitor);
                if (stmt.else_)
                    for (const s of stmt.else_) this.walkExprs(s, visitor);
                break;
            case "TryStatement":
                for (const s of stmt.tryBody) this.walkExprs(s, visitor);
                for (const s of stmt.catchBody) this.walkExprs(s, visitor);
                break;
            case "ReturnStatement":
                this.walkExpr(stmt.value, visitor);
                break;
        }
    }

    private walkExpr(expr: Expr, visitor: (expr: Expr) => void): void {
        visitor(expr);
        switch (expr.kind) {
            case "TaskCallExpr":
                for (const arg of expr.args) {
                    this.walkExpr(arg.value, visitor);
                }
                break;
            case "ArrayLiteralExpr":
                for (const el of expr.elements) this.walkExpr(el, visitor);
                break;
            case "ObjectLiteralExpr":
                for (const entry of expr.entries)
                    this.walkExpr(entry.value, visitor);
                break;
            case "TemplateLiteralExpr":
                for (const e of expr.expressions) this.walkExpr(e, visitor);
                break;
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
                    "const initializer must be a literal value",
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

    private inferTemplateSchema(value: Template): JSONSchema {
        if (typeof value === "string") return { type: "string" };
        if (typeof value === "number")
            return Number.isInteger(value)
                ? { type: "integer" }
                : { type: "number" };
        if (typeof value === "boolean") return { type: "boolean" };
        if (Array.isArray(value)) return { type: "array" };
        return {};
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
                        return { type: t.name };
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
