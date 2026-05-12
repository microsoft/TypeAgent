// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Workflow DSL emitter: AST -> WorkflowIR.
 *
 * This is the lowering pass. It walks the AST and produces the IR JSON
 * that the workflow engine consumes. Key responsibilities:
 *
 * - Infer node IDs from let-binding names
 * - Fill `bind` from let bindings (A3)
 * - Thread `next` edges from statement order
 * - Desugar `for..of` to loop nodes with index/length/compare/branch
 * - Look up task schemas from the registry (T1)
 * - Convert type annotations to JSON Schema (T2)
 * - Fill defaults: maxIterations, branch default (A1)
 */

import {
    WorkflowIR,
    WorkflowNode,
    TaskNode,
    BranchNode,
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
    IfStatement,
    LetStatement,
    AssignmentStatement,
    ReturnStatement,
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

interface ScopeContext {
    nodes: Record<string, WorkflowNode>;
    /** Ordered list of node IDs for threading `next` edges */
    nodeOrder: string[];
    /** Variables bound at this scope level (let bindings) */
    bindings: Map<string, string>; // variable name -> node ID
    /** Let bindings whose RHS is a literal (not a task call) */
    literalBindings: Map<string, Template>;
    /** The node ID of the return expression (workflow output or loop output) */
    outputNodeId?: string;
    /** The output template (for workflow output or loop output) */
    outputTemplate?: Template;
    /** For loop scopes: state variable names */
    stateVars?: Set<string> | undefined;
    /** For loop scopes: the loop variable name (the for..of iterator) */
    loopVar?: string | undefined;
    /** For loop scopes: the iterable expression's template */
    loopIterable?: Template | undefined;
    /** For loop body scopes: auto-project paths for input names from outer bindings */
    inputAutoProject?: Map<string, string[]> | undefined;
}

export class Emitter {
    private errors: EmitError[] = [];
    private taskSchemas: Map<string, TaskSchemaInfo>;
    private nodeCounter = 0;

    constructor(taskSchemas: TaskSchemaInfo[]) {
        this.taskSchemas = new Map(taskSchemas.map((t) => [t.name, t]));
    }

    emit(ast: WorkflowDecl): {
        ir: WorkflowIR | undefined;
        errors: EmitError[];
    } {
        this.errors = [];
        this.nodeCounter = 0;

        const inputSchema = this.paramsToSchema(ast.params);
        const outputSchema = this.typeToSchema(ast.returnType);

        const scope = this.emitScope(
            ast.body,
            new Set(ast.params.map((p) => p.name)),
        );

        // Thread `next` edges
        this.threadNext(scope);

        const ir: WorkflowIR = {
            kind: "workflow",
            name: ast.name,
            ...(ast.description ? { description: ast.description } : {}),
            version: "1",
            inputSchema,
            outputSchema,
            nodes: scope.nodes,
            entry: scope.nodeOrder.length > 0 ? scope.nodeOrder[0] : "",
            output:
                scope.outputTemplate ??
                ({ $from: "input", name: "" } as unknown as Template),
        };

        return {
            ir: this.errors.length === 0 ? ir : undefined,
            errors: this.errors,
        };
    }

    private emitScope(
        statements: Statement[],
        inputNames: Set<string>,
        stateVars?: Set<string>,
        loopVar?: string,
        loopIterable?: Template,
    ): ScopeContext {
        const scope: ScopeContext = {
            nodes: {},
            nodeOrder: [],
            bindings: new Map(),
            literalBindings: new Map(),
            stateVars,
            loopVar,
            loopIterable,
        };

        for (const stmt of statements) {
            this.emitStatement(stmt, scope, inputNames);
        }

        return scope;
    }

    private emitStatement(
        stmt: Statement,
        scope: ScopeContext,
        inputNames: Set<string>,
    ): void {
        switch (stmt.kind) {
            case "LetStatement":
                this.emitLet(stmt, scope, inputNames);
                break;
            case "AssignmentStatement":
                this.emitAssignment(stmt, scope, inputNames);
                break;
            case "ForOfStatement":
                this.emitForOf(stmt, scope, inputNames);
                break;
            case "IfStatement":
                this.emitIf(stmt, scope, inputNames);
                break;
            case "ReturnStatement":
                this.emitReturn(stmt, scope, inputNames);
                break;
            default:
                this.emitError(
                    `Unsupported statement kind: ${(stmt as Statement).kind}`,
                    stmt.loc.line,
                    stmt.loc.col,
                );
        }
    }

    private emitLet(
        stmt: LetStatement,
        scope: ScopeContext,
        inputNames: Set<string>,
    ): void {
        const expr = stmt.value;

        if (expr.kind === "TaskCallExpr") {
            const nodeId = stmt.name;
            const node = this.emitTaskCall(expr, scope, inputNames, nodeId);
            if (node) {
                scope.nodes[nodeId] = node;
                scope.nodeOrder.push(nodeId);
                scope.bindings.set(stmt.name, nodeId);
            }
        } else if (expr.kind === "TemplateLiteralExpr") {
            const nodeId = stmt.name;
            const node = this.emitTemplateLiteral(
                expr,
                scope,
                inputNames,
                nodeId,
            );
            if (node) {
                scope.nodes[nodeId] = node;
                scope.nodeOrder.push(nodeId);
                scope.bindings.set(stmt.name, nodeId);
            }
        } else {
            // Literal RHS: store for use as loop state initializer or constant
            const value = this.exprToTemplate(expr, scope, inputNames);
            scope.literalBindings.set(stmt.name, value);
        }
    }

    private emitAssignment(
        _stmt: AssignmentStatement,
        _scope: ScopeContext,
        _inputNames: Set<string>,
    ): void {
        // Assignments at the top level are not yet supported.
        // Inside loop bodies, they are handled by emitLoopBody directly.
        this.emitError(
            `Assignment to '${_stmt.name}' outside a loop body is not supported`,
            _stmt.loc.line,
            _stmt.loc.col,
        );
    }

    private emitTaskCall(
        expr: TaskCallExpr,
        scope: ScopeContext,
        inputNames: Set<string>,
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

        const inputs = this.resolveTaskArgs(expr, schema, scope, inputNames);

        return {
            kind: "task",
            task: expr.task,
            inputSchema: schema.inputSchema,
            outputSchema: schema.outputSchema,
            inputs,
            bind: bindName,
        };
    }

    /**
     * Lower a template literal expression to a text.template TaskNode.
     *
     * `\`--author=${input.author}\`` becomes:
     *   task: "text.template"
     *   inputs: { template: "--author={{author}}", vars: { author: {$from:"input", name:"author"} } }
     */
    private emitTemplateLiteral(
        expr: TemplateLiteralExpr,
        scope: ScopeContext,
        inputNames: Set<string>,
        bindName: string,
        loopVar?: string,
        pickNodeId?: string,
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

        // Build the template string and vars object
        let templateStr = expr.parts[0];
        const vars: Record<string, Template> = {};
        for (let i = 0; i < expr.expressions.length; i++) {
            const innerExpr = expr.expressions[i];
            // Use the expression text as the var name if it's a simple
            // dotted name (last segment), otherwise generate v0, v1, ...
            const varName = this.templateVarName(innerExpr, i);
            templateStr += `{{${varName}}}`;
            templateStr += expr.parts[i + 1];

            if (loopVar !== undefined && pickNodeId !== undefined) {
                vars[varName] = this.exprToTemplateInLoop(
                    innerExpr,
                    scope,
                    inputNames,
                    loopVar,
                    pickNodeId,
                );
            } else {
                vars[varName] = this.exprToTemplate(
                    innerExpr,
                    scope,
                    inputNames,
                );
            }
        }

        return {
            kind: "task",
            task: "text.template",
            inputSchema: schema.inputSchema,
            outputSchema: schema.outputSchema,
            inputs: {
                template: templateStr,
                vars,
            },
            bind: bindName,
        };
    }

    /**
     * Derive a readable variable name for a template interpolation.
     * For `${input.author}` -> "author", for `${gitResult.stdout}` -> "stdout",
     * for complex expressions -> "v0", "v1", ...
     */
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
        inputNames: Set<string>,
    ): Record<string, Template> {
        const inputs: Record<string, Template> = {};
        const schemaProps = (schema.inputSchema as Record<string, unknown>)
            .properties as Record<string, unknown> | undefined;
        const paramNames = schemaProps ? Object.keys(schemaProps) : [];

        // Single object-literal arg: unwrap entries into named inputs
        // e.g. shell.exec({ command: "git", cwd: repo })
        if (
            expr.args.length === 1 &&
            expr.args[0].kind === "PositionalArg" &&
            expr.args[0].value.kind === "ObjectLiteralExpr"
        ) {
            const objExpr = expr.args[0].value;
            for (const entry of objExpr.entries) {
                inputs[entry.key] = this.exprToTemplate(
                    entry.value,
                    scope,
                    inputNames,
                );
            }
            return inputs;
        }

        let positionalIndex = 0;
        for (const arg of expr.args) {
            if (arg.kind === "NamedArg") {
                inputs[arg.name] = this.exprToTemplate(
                    arg.value,
                    scope,
                    inputNames,
                );
            } else {
                // Positional: map to schema param names in order
                if (positionalIndex < paramNames.length) {
                    inputs[paramNames[positionalIndex]] = this.exprToTemplate(
                        arg.value,
                        scope,
                        inputNames,
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

    private emitForOf(
        stmt: ForOfStatement,
        scope: ScopeContext,
        inputNames: Set<string>,
    ): void {
        const loopId = this.freshId("loop");
        const iterableTemplate = this.exprToTemplate(
            stmt.iterable,
            scope,
            inputNames,
        );

        // The loop needs to bring in the iterable and any outer-scope bindings
        // referenced in the body. For now, we bring in the iterable.
        const loopInputs: Record<string, Template> = {
            items: iterableTemplate,
        };
        const loopInputSchema: JSONSchema = {
            type: "object",
            required: ["items"],
            properties: {
                items: { type: "array" },
            },
        };

        // Also bring in any outer scope bindings referenced in the body
        const outerRefs = this.collectOuterRefs(stmt.body, scope, inputNames);
        for (const [name, template] of outerRefs) {
            loopInputs[name] = template;
            (loopInputSchema as Record<string, unknown>).required = [
                ...((loopInputSchema as Record<string, unknown>)
                    .required as string[]),
                name,
            ];
            const props = (loopInputSchema as Record<string, unknown>)
                .properties as Record<string, unknown>;
            props[name] = {}; // any type
        }

        // State: index counter + state vars from assignments inside the body
        // that target literal bindings from the outer scope.
        const assignmentStateVars = this.findAssignmentStateVars(
            stmt.body,
            scope.literalBindings,
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

        // Build loop body
        const bodyScope = this.emitLoopBody(
            stmt,
            scope,
            inputNames,
            assignmentStateVars,
            outerRefs,
        );

        // Determine output: last state var if any, otherwise the index
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
        scope.bindings.set(loopId, loopId);

        // Bind state variable names to the loop node so post-loop references
        // (e.g. string.join(sections, ...)) resolve to the loop's output.
        for (const name of stateVarNames) {
            scope.bindings.set(name, loopId);
        }
    }

    private emitLoopBody(
        stmt: ForOfStatement,
        outerScope: ScopeContext,
        inputNames: Set<string>,
        assignmentStateVars: Map<string, Template>,
        outerRefs: Map<string, Template>,
    ): ScopeContext {
        const bodyNodes: Record<string, WorkflowNode> = {};
        const bodyOrder: string[] = [];
        const bodyBindings = new Map<string, string>();
        const bodyInputNames = new Set(["items", ...outerRefs.keys()]);

        const stateVarNames = new Set(["i", ...assignmentStateVars.keys()]);

        const bodyScope: ScopeContext = {
            nodes: bodyNodes,
            nodeOrder: bodyOrder,
            bindings: bodyBindings,
            literalBindings: new Map(),
            stateVars: stateVarNames,
            loopVar: stmt.variable,
            inputAutoProject: this.buildInputAutoProject(outerRefs, outerScope),
        };

        // First node: pick element at index
        const pickId = `pick_${stmt.variable}`;
        bodyNodes[pickId] = {
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
        bodyOrder.push(pickId);
        bodyBindings.set(stmt.variable, pickId);

        // Emit body statements
        for (const s of stmt.body) {
            if (s.kind === "LetStatement") {
                const expr = s.value;
                if (expr.kind === "TaskCallExpr") {
                    const nodeId = s.name;
                    const node = this.emitTaskCallInLoopBody(
                        expr,
                        bodyScope,
                        bodyInputNames,
                        nodeId,
                        stmt.variable,
                        pickId,
                    );
                    if (node) {
                        bodyNodes[nodeId] = node;
                        bodyOrder.push(nodeId);
                        bodyBindings.set(s.name, nodeId);
                    }
                } else if (expr.kind === "TemplateLiteralExpr") {
                    const nodeId = s.name;
                    const node = this.emitTemplateLiteral(
                        expr,
                        bodyScope,
                        bodyInputNames,
                        nodeId,
                        stmt.variable,
                        pickId,
                    );
                    if (node) {
                        bodyNodes[nodeId] = node;
                        bodyOrder.push(nodeId);
                        bodyBindings.set(s.name, nodeId);
                    }
                }
            } else if (s.kind === "AssignmentStatement") {
                const expr = s.value;
                if (expr.kind === "TaskCallExpr") {
                    // Assignment to a state var (e.g. sections = list.append(...))
                    const nodeId = `assign_${s.name}`;
                    const node = this.emitTaskCallInLoopBody(
                        expr,
                        bodyScope,
                        bodyInputNames,
                        nodeId,
                        stmt.variable,
                        pickId,
                    );
                    if (node) {
                        bodyNodes[nodeId] = node;
                        bodyOrder.push(nodeId);
                    }
                }
            }
        }

        // Step index
        const stepId = "step_i";
        const intAddSchema = this.taskSchemas.get("int.add");
        if (intAddSchema) {
            bodyNodes[stepId] = {
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
            bodyOrder.push(stepId);
        }

        // Compute length
        const lengthId = "compute_length";
        const listLengthSchema = this.taskSchemas.get("list.length");
        if (listLengthSchema) {
            bodyNodes[lengthId] = {
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
            bodyOrder.push(lengthId);
        }

        // Compare
        const compareId = "compare_index";
        const intLessThanSchema = this.taskSchemas.get("int.lessThan");
        if (intLessThanSchema) {
            bodyNodes[compareId] = {
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
            bodyOrder.push(compareId);
        }

        // Branch: continue or exit
        const branchId = "check_done";
        const branchNode: BranchNode = {
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
        bodyNodes[branchId] = branchNode;
        bodyOrder.push(branchId);

        // Thread next edges in body
        this.threadNext(bodyScope);

        return bodyScope;
    }

    private emitTaskCallInLoopBody(
        expr: TaskCallExpr,
        bodyScope: ScopeContext,
        inputNames: Set<string>,
        bindName: string,
        loopVar: string,
        pickNodeId: string,
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

        const inputs = this.resolveTaskArgsInLoop(
            expr,
            schema,
            bodyScope,
            inputNames,
            loopVar,
            pickNodeId,
        );

        return {
            kind: "task",
            task: expr.task,
            inputSchema: schema.inputSchema,
            outputSchema: schema.outputSchema,
            inputs,
            bind: bindName,
        };
    }

    private resolveTaskArgsInLoop(
        expr: TaskCallExpr,
        schema: TaskSchemaInfo,
        scope: ScopeContext,
        inputNames: Set<string>,
        loopVar: string,
        pickNodeId: string,
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
                inputs[entry.key] = this.exprToTemplateInLoop(
                    entry.value,
                    scope,
                    inputNames,
                    loopVar,
                    pickNodeId,
                );
            }
            return inputs;
        }

        let positionalIndex = 0;
        for (const arg of expr.args) {
            let name: string;
            let value: Expr;
            if (arg.kind === "NamedArg") {
                name = arg.name;
                value = arg.value;
            } else {
                if (positionalIndex < paramNames.length) {
                    name = paramNames[positionalIndex];
                    positionalIndex++;
                } else {
                    this.emitError(
                        `Too many positional arguments for task ${expr.task}`,
                        expr.loc.line,
                        expr.loc.col,
                    );
                    continue;
                }
                value = arg.value;
            }
            inputs[name] = this.exprToTemplateInLoop(
                value,
                scope,
                inputNames,
                loopVar,
                pickNodeId,
            );
        }
        return inputs;
    }

    private exprToTemplateInLoop(
        expr: Expr,
        scope: ScopeContext,
        inputNames: Set<string>,
        loopVar: string,
        pickNodeId: string,
    ): Template {
        if (expr.kind === "DottedNameExpr") {
            const first = expr.segments[0];
            const rest = expr.segments.slice(1);

            if (first === loopVar) {
                // Reference to loop variable: $from scope, name is the pick node
                if (rest.length > 0) {
                    return {
                        $from: "scope",
                        name: pickNodeId,
                        path: ["element", ...rest],
                    } as unknown as Template;
                }
                return {
                    $from: "scope",
                    name: pickNodeId,
                    path: ["element"],
                } as unknown as Template;
            }

            if (scope.stateVars?.has(first)) {
                return {
                    $from: "state",
                    name: first,
                    path: rest.length > 0 ? rest : undefined,
                } as unknown as Template;
            }

            if (scope.bindings.has(first)) {
                const nodeId = scope.bindings.get(first)!;
                return {
                    $from: "scope",
                    name: nodeId,
                    path:
                        rest.length > 0
                            ? rest
                            : this.getAutoProjectPath(scope, nodeId),
                } as unknown as Template;
            }

            if (inputNames.has(first)) {
                return {
                    $from: "input",
                    name: first,
                    path:
                        rest.length > 0
                            ? rest
                            : scope.inputAutoProject?.get(first),
                } as unknown as Template;
            }
        }

        return this.exprToTemplate(expr, scope, inputNames);
    }

    private exprToTemplate(
        expr: Expr,
        scope: ScopeContext,
        inputNames: Set<string>,
    ): Template {
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
                return expr.elements.map((e) =>
                    this.exprToTemplate(e, scope, inputNames),
                );
            case "ObjectLiteralExpr": {
                const obj: Record<string, Template> = {};
                for (const entry of expr.entries) {
                    obj[entry.key] = this.exprToTemplate(
                        entry.value,
                        scope,
                        inputNames,
                    );
                }
                return obj;
            }
            case "DottedNameExpr": {
                const first = expr.segments[0];
                const rest = expr.segments.slice(1);

                // Check if it's a loop variable reference
                if (scope.loopVar && first === scope.loopVar) {
                    const pickId = `pick_${first}`;
                    return {
                        $from: "scope",
                        name: pickId,
                        path: ["element", ...rest],
                    } as unknown as Template;
                }

                // Check state vars
                if (scope.stateVars?.has(first)) {
                    return {
                        $from: "state",
                        name: first,
                        path: rest.length > 0 ? rest : undefined,
                    } as unknown as Template;
                }

                // Check scope bindings
                if (scope.bindings.has(first)) {
                    const nodeId = scope.bindings.get(first)!;
                    return {
                        $from: "scope",
                        name: nodeId,
                        path:
                            rest.length > 0
                                ? rest
                                : this.getAutoProjectPath(scope, nodeId),
                    } as unknown as Template;
                }

                // Check workflow inputs
                if (inputNames.has(first)) {
                    return {
                        $from: "input",
                        name: first,
                        path: rest.length > 0 ? rest : undefined,
                    } as unknown as Template;
                }

                // Check if segments[0].segments[1] is a known input (e.g., input.repos)
                if (first === "input" && rest.length > 0) {
                    return {
                        $from: "input",
                        name: rest[0],
                        path: rest.length > 1 ? rest.slice(1) : undefined,
                    } as unknown as Template;
                }

                this.emitError(
                    `Unknown reference: ${expr.segments.join(".")}`,
                    expr.loc.line,
                    expr.loc.col,
                );
                return expr.segments.join(".");
            }
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

    private emitIf(
        stmt: IfStatement,
        scope: ScopeContext,
        inputNames: Set<string>,
    ): void {
        // Lower `if cond { ... } else { ... }` to:
        // 1. A bool.toLabel task to convert the boolean to a label
        // 2. A branch node
        // 3. The then/else bodies inlined into the scope
        const condTemplate = this.exprToTemplate(
            stmt.condition,
            scope,
            inputNames,
        );
        const labelId = this.freshId("if_label");
        const boolToLabelSchema = this.taskSchemas.get("bool.toLabel");
        if (boolToLabelSchema) {
            scope.nodes[labelId] = {
                kind: "task",
                task: "bool.toLabel",
                inputSchema: boolToLabelSchema.inputSchema,
                outputSchema: boolToLabelSchema.outputSchema,
                inputs: {
                    value: condTemplate,
                    ifTrue: "then",
                    ifFalse: "else",
                },
                bind: labelId,
            };
            scope.nodeOrder.push(labelId);
        }

        // Emit then branch
        const thenScope = this.emitScope(stmt.then, inputNames);
        const elseScope = stmt.else_
            ? this.emitScope(stmt.else_, inputNames)
            : undefined;

        // Merge nodes into parent scope
        for (const [id, node] of Object.entries(thenScope.nodes)) {
            scope.nodes[`then_${id}`] = node;
        }
        if (elseScope) {
            for (const [id, node] of Object.entries(elseScope.nodes)) {
                scope.nodes[`else_${id}`] = node;
            }
        }

        // Branch node
        const branchId = this.freshId("if_branch");
        const cases: Record<string, string> = {
            then:
                thenScope.nodeOrder.length > 0
                    ? `then_${thenScope.nodeOrder[0]}`
                    : "",
        };
        let defaultTarget: string;
        if (elseScope && elseScope.nodeOrder.length > 0) {
            cases["else"] = `else_${elseScope.nodeOrder[0]}`;
            defaultTarget = `else_${elseScope.nodeOrder[0]}`;
        } else {
            defaultTarget = "";
        }

        scope.nodes[branchId] = {
            kind: "branch",
            selector: {
                $from: "scope",
                name: labelId,
                path: ["label"],
            } as unknown as Template,
            selectorSchema: { type: "string" },
            cases,
            default: defaultTarget,
        };
        scope.nodeOrder.push(branchId);
    }

    private emitReturn(
        stmt: ReturnStatement,
        scope: ScopeContext,
        inputNames: Set<string>,
    ): void {
        scope.outputTemplate = this.exprToTemplate(
            stmt.value,
            scope,
            inputNames,
        );
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
            // Branch nodes don't get `next` - they have `cases`
        }
    }

    // ---- Helpers ----

    private collectOuterRefs(
        statements: Statement[],
        outerScope: ScopeContext,
        inputNames: Set<string>,
    ): Map<string, Template> {
        const refs = new Map<string, Template>();
        for (const stmt of statements) {
            this.walkExprs(stmt, (expr) => {
                if (expr.kind === "DottedNameExpr") {
                    const first = expr.segments[0];
                    if (outerScope.bindings.has(first)) {
                        const nodeId = outerScope.bindings.get(first)!;
                        // Bring in the full node output (no path projection).
                        // Inside the loop body, path resolution happens
                        // normally via exprToTemplateInLoop.
                        if (!refs.has(first)) {
                            refs.set(first, {
                                $from: "scope",
                                name: nodeId,
                            } as unknown as Template);
                        }
                    }
                }
            });
        }
        return refs;
    }

    private walkExprs(stmt: Statement, visitor: (expr: Expr) => void): void {
        switch (stmt.kind) {
            case "LetStatement":
                this.walkExpr(stmt.value, visitor);
                break;
            case "AssignmentStatement":
                this.walkExpr(stmt.value, visitor);
                break;
            case "ForOfStatement":
                this.walkExpr(stmt.iterable, visitor);
                for (const s of stmt.body) this.walkExprs(s, visitor);
                break;
            case "IfStatement":
                this.walkExpr(stmt.condition, visitor);
                for (const s of stmt.then) this.walkExprs(s, visitor);
                if (stmt.else_)
                    for (const s of stmt.else_) this.walkExprs(s, visitor);
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

    private findAssignmentStateVars(
        statements: Statement[],
        outerLiterals: Map<string, Template>,
    ): Map<string, Template> {
        const stateVars = new Map<string, Template>();
        for (const stmt of statements) {
            if (
                stmt.kind === "AssignmentStatement" &&
                outerLiterals.has(stmt.name)
            ) {
                stateVars.set(stmt.name, outerLiterals.get(stmt.name)!);
            }
        }
        return stateVars;
    }

    private freshId(prefix: string): string {
        return `${prefix}_${this.nodeCounter++}`;
    }

    /**
     * If the node has a single-property output schema, return the property
     * name as a path for auto-projection. Otherwise return undefined.
     */
    private getAutoProjectPath(
        scope: ScopeContext,
        nodeId: string,
    ): string[] | undefined {
        const node = scope.nodes[nodeId];
        if (!node || node.kind !== "task") return undefined;
        const outSchema = node.outputSchema as Record<string, unknown>;
        if (!outSchema || outSchema.type !== "object") return undefined;
        const props = outSchema.properties as
            | Record<string, unknown>
            | undefined;
        if (!props) return undefined;
        const keys = Object.keys(props);
        if (keys.length === 1) return [keys[0]];
        return undefined;
    }

    /**
     * Build the auto-project map for loop body input names, based on
     * the outer scope's task output schemas.
     */
    private buildInputAutoProject(
        outerRefs: Map<string, Template>,
        outerScope: ScopeContext,
    ): Map<string, string[]> {
        const map = new Map<string, string[]>();
        for (const [name] of outerRefs) {
            const outerNodeId = outerScope.bindings.get(name);
            if (outerNodeId) {
                const path = this.getAutoProjectPath(outerScope, outerNodeId);
                if (path) {
                    map.set(name, path);
                }
            }
        }
        return map;
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
