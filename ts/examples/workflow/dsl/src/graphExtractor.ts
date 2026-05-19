// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Extracts a visual graph model from a workflow DSL AST.
 *
 * The graph model is a simplified representation suitable for layout
 * and rendering by a visual editor. It captures:
 *   - Nodes: task calls, workflow calls, parameters, constants, return,
 *     operators, throw
 *   - Edges: data flow (variable references between nodes)
 *   - Groups: control flow blocks (attempts, map, filter, parallel,
 *     parallelMap, if/else, switch, ternary)
 */

import {
    WorkflowDecl,
    Statement,
    Expr,
    TaskCallExpr,
    WorkflowCallExpr,
    TemplateLiteralExpr,
    ConstStatement,
    DestructuringConst,
    IfStatement,
    SwitchStatement,
    ReturnStatement,
    ThrowStatement,
    AttemptsNode,
    MapNode,
    FilterNode,
    ParallelNode,
    ParallelMapNode,
} from "./ast.js";
import { decodeStringLiteral } from "./literal.js";

// ---- Graph model types ----

export interface GraphModel {
    workflowName: string;
    params: ParamNode[];
    nodes: GraphNode[];
    edges: GraphEdge[];
    groups: GraphGroup[];
}

export interface ParamNode {
    id: string;
    name: string;
    type: string;
}

export interface GraphNode {
    id: string;
    kind:
        | "task"
        | "workflowCall"
        | "template"
        | "literal"
        | "constant"
        | "return"
        | "operator"
        | "error"
        | "branch";
    label: string;
    /** Task type (e.g., "web.fetch", "text.summarize") */
    taskType?: string | undefined;
    /** The variable name this node binds to */
    bindName?: string | undefined;
    /** Parent group ID, if inside a control flow block */
    groupId?: string | undefined;
    /** Source location for click-to-source */
    line?: number | undefined;
}

export interface GraphEdge {
    from: string; // source node or param ID
    to: string; // target node ID
    label?: string | undefined; // input field name
}

export type GroupKind =
    | "attempts"
    | "map"
    | "filter"
    | "parallel"
    | "parallelMap"
    | "if-then"
    | "if-else"
    | "switch"
    | "switch-case"
    | "switch-default";

export interface GraphGroup {
    id: string;
    kind: GroupKind;
    label: string;
    /** Parent group ID for nesting */
    parentId?: string | undefined;
    /** Node IDs and sub-group IDs contained */
    children: string[];
}

// ---- Extraction ----

export function extractGraph(ast: WorkflowDecl): GraphModel {
    const extractor = new GraphExtractor();
    return extractor.extract(ast);
}

class GraphExtractor {
    private nodeCounter = 0;
    private groupCounter = 0;
    private nodes: GraphNode[] = [];
    private edges: GraphEdge[] = [];
    private groups: GraphGroup[] = [];
    /** Maps variable names to the node ID that produces them */
    private bindings = new Map<string, string>();

    extract(ast: WorkflowDecl): GraphModel {
        const params: ParamNode[] = ast.params.map((p) => {
            const id = `param_${p.name}`;
            this.bindings.set(p.name, id);
            return {
                id,
                name: p.name,
                type: this.typeToString(p.type),
            };
        });

        for (const stmt of ast.body) {
            this.extractStatement(stmt, undefined);
        }

        return {
            workflowName: ast.name,
            params,
            nodes: this.nodes,
            edges: this.edges,
            groups: this.groups,
        };
    }

    private freshNodeId(prefix: string): string {
        return `${prefix}_${this.nodeCounter++}`;
    }

    private freshGroupId(kind: string): string {
        return `group_${kind}_${this.groupCounter++}`;
    }

    private extractStatement(
        stmt: Statement,
        groupId: string | undefined,
    ): void {
        switch (stmt.kind) {
            case "ConstStatement":
                this.extractConst(stmt, groupId);
                break;
            case "DestructuringConst":
                this.extractDestructuring(stmt, groupId);
                break;
            case "IfStatement":
                this.extractIf(stmt, groupId);
                break;
            case "SwitchStatement":
                this.extractSwitch(stmt, groupId);
                break;
            case "ThrowStatement":
                this.extractThrow(stmt, groupId);
                break;
            case "ReturnStatement":
                this.extractReturn(stmt, groupId);
                break;
            case "BreakStatement":
                break;
        }
    }

    // ---- Statement extraction ----

    private extractConst(
        stmt: ConstStatement,
        groupId: string | undefined,
    ): void {
        const expr = stmt.value;

        if (expr.kind === "TaskCallExpr") {
            const nodeId = this.freshNodeId("task");
            this.nodes.push({
                id: nodeId,
                kind: "task",
                label: stmt.name,
                taskType: expr.task,
                bindName: stmt.name,
                groupId,
                line: stmt.loc.line,
            });
            this.bindings.set(stmt.name, nodeId);
            this.extractTaskCallEdges(expr, nodeId);
            if (groupId) this.addToGroup(groupId, nodeId);
        } else if (expr.kind === "WorkflowCallExpr") {
            const nodeId = this.freshNodeId("call");
            this.nodes.push({
                id: nodeId,
                kind: "workflowCall",
                label: `${stmt.name} = ${expr.name}(...)`,
                taskType: expr.name,
                bindName: stmt.name,
                groupId,
                line: stmt.loc.line,
            });
            this.bindings.set(stmt.name, nodeId);
            this.extractWorkflowCallEdges(expr, nodeId);
            if (groupId) this.addToGroup(groupId, nodeId);
        } else if (expr.kind === "TemplateLiteralExpr") {
            const nodeId = this.freshNodeId("tmpl");
            this.nodes.push({
                id: nodeId,
                kind: "template",
                label: stmt.name,
                taskType: "text.template",
                bindName: stmt.name,
                groupId,
                line: stmt.loc.line,
            });
            this.bindings.set(stmt.name, nodeId);
            this.extractTemplateLiteralEdges(expr, nodeId);
            if (groupId) this.addToGroup(groupId, nodeId);
        } else if (this.isLiteral(expr)) {
            const nodeId = this.freshNodeId("const");
            this.nodes.push({
                id: nodeId,
                kind: "constant",
                label: `${stmt.name} = ${this.exprSummary(expr)}`,
                bindName: stmt.name,
                groupId,
                line: stmt.loc.line,
            });
            this.bindings.set(stmt.name, nodeId);
            if (groupId) this.addToGroup(groupId, nodeId);
        } else {
            // Complex expression (binary, built-in, etc.)
            const nodeId = this.extractExprAsNode(expr, groupId);
            if (nodeId) {
                this.bindings.set(stmt.name, nodeId);
            }
        }
    }

    private extractDestructuring(
        stmt: DestructuringConst,
        groupId: string | undefined,
    ): void {
        // If the value is a simple name reference, resolve the binding.
        // Otherwise extract as a node.
        let sourceId: string | undefined;
        if (stmt.value.kind === "DottedNameExpr") {
            sourceId = this.bindings.get(stmt.value.segments[0]);
        } else {
            sourceId = this.extractExprAsNode(stmt.value, groupId);
        }
        if (sourceId) {
            for (const name of stmt.names) {
                this.bindings.set(name, sourceId);
            }
        }
    }

    private extractIf(
        stmt: IfStatement,
        parentGroupId: string | undefined,
    ): void {
        const thenGid = this.freshGroupId("if_then");
        this.groups.push({
            id: thenGid,
            kind: "if-then",
            label: `if (${this.exprSummary(stmt.condition)})`,
            parentId: parentGroupId,
            children: [],
        });
        if (parentGroupId) this.addToGroup(parentGroupId, thenGid);
        this.addEdgesFromExpr(stmt.condition, thenGid);

        for (const s of stmt.then) {
            this.extractStatement(s, thenGid);
        }

        if (stmt.else_) {
            const elseGid = this.freshGroupId("if_else");
            this.groups.push({
                id: elseGid,
                kind: "if-else",
                label: "else",
                parentId: parentGroupId,
                children: [],
            });
            if (parentGroupId) this.addToGroup(parentGroupId, elseGid);

            for (const s of stmt.else_) {
                this.extractStatement(s, elseGid);
            }
        }
    }

    private extractSwitch(
        stmt: SwitchStatement,
        parentGroupId: string | undefined,
    ): void {
        const switchGid = this.freshGroupId("switch");
        this.groups.push({
            id: switchGid,
            kind: "switch",
            label: `switch (${this.exprSummary(stmt.discriminant)})`,
            parentId: parentGroupId,
            children: [],
        });
        if (parentGroupId) this.addToGroup(parentGroupId, switchGid);
        this.addEdgesFromExpr(stmt.discriminant, switchGid);

        for (let i = 0; i < stmt.arms.length; i++) {
            const arm = stmt.arms[i];
            const caseGid = this.freshGroupId("case");
            this.groups.push({
                id: caseGid,
                kind: "switch-case",
                label: `case ${this.exprSummary(arm.value)}`,
                parentId: switchGid,
                children: [],
            });
            this.addToGroup(switchGid, caseGid);

            for (const s of arm.body) {
                this.extractStatement(s, caseGid);
            }
        }

        if (stmt.default_) {
            const defGid = this.freshGroupId("default");
            this.groups.push({
                id: defGid,
                kind: "switch-default",
                label: "default",
                parentId: switchGid,
                children: [],
            });
            this.addToGroup(switchGid, defGid);

            for (const s of stmt.default_) {
                this.extractStatement(s, defGid);
            }
        }
    }

    private extractThrow(
        stmt: ThrowStatement,
        groupId: string | undefined,
    ): void {
        const nodeId = this.freshNodeId("error");
        this.nodes.push({
            id: nodeId,
            kind: "error",
            label: `throw ${this.exprSummary(stmt.value)}`,
            groupId,
            line: stmt.loc.line,
        });
        this.addEdgesFromExpr(stmt.value, nodeId);
        if (groupId) this.addToGroup(groupId, nodeId);
    }

    private extractReturn(
        stmt: ReturnStatement,
        groupId: string | undefined,
    ): void {
        // If the return value is a built-in node or complex expression,
        // extract it first, then edge from it to the return node.
        const valueId = this.extractExprAsNode(stmt.value, groupId);

        const nodeId = this.freshNodeId("return");
        this.nodes.push({
            id: nodeId,
            kind: "return",
            label: "return",
            groupId,
            line: stmt.loc.line,
        });
        if (valueId) {
            this.edges.push({ from: valueId, to: nodeId });
        } else {
            this.addEdgesFromExpr(stmt.value, nodeId);
        }
        if (groupId) this.addToGroup(groupId, nodeId);
    }

    // ---- Expression extraction ----

    /**
     * Extract an expression that should be represented as a graph node.
     * Returns the node ID, or undefined if no node was created.
     */
    private extractExprAsNode(
        expr: Expr,
        groupId: string | undefined,
    ): string | undefined {
        switch (expr.kind) {
            case "TaskCallExpr": {
                const nodeId = this.freshNodeId("task");
                this.nodes.push({
                    id: nodeId,
                    kind: "task",
                    label: expr.task,
                    taskType: expr.task,
                    groupId,
                    line: expr.loc.line,
                });
                this.extractTaskCallEdges(expr, nodeId);
                if (groupId) this.addToGroup(groupId, nodeId);
                return nodeId;
            }
            case "WorkflowCallExpr": {
                const nodeId = this.freshNodeId("call");
                this.nodes.push({
                    id: nodeId,
                    kind: "workflowCall",
                    label: `${expr.name}(...)`,
                    taskType: expr.name,
                    groupId,
                    line: expr.loc.line,
                });
                this.extractWorkflowCallEdges(expr, nodeId);
                if (groupId) this.addToGroup(groupId, nodeId);
                return nodeId;
            }
            case "BinaryExpr": {
                const nodeId = this.freshNodeId("op");
                this.nodes.push({
                    id: nodeId,
                    kind: "operator",
                    label: expr.op,
                    groupId,
                    line: expr.loc.line,
                });
                this.addEdgesFromExpr(expr.left, nodeId, "left");
                this.addEdgesFromExpr(expr.right, nodeId, "right");
                if (groupId) this.addToGroup(groupId, nodeId);
                return nodeId;
            }
            case "UnaryExpr": {
                const nodeId = this.freshNodeId("op");
                this.nodes.push({
                    id: nodeId,
                    kind: "operator",
                    label: expr.op,
                    groupId,
                    line: expr.loc.line,
                });
                this.addEdgesFromExpr(expr.operand, nodeId);
                if (groupId) this.addToGroup(groupId, nodeId);
                return nodeId;
            }
            case "TernaryExpr": {
                const nodeId = this.freshNodeId("branch");
                this.nodes.push({
                    id: nodeId,
                    kind: "branch",
                    label: `${this.exprSummary(expr.condition)} ? ... : ...`,
                    groupId,
                    line: expr.loc.line,
                });
                this.addEdgesFromExpr(expr.condition, nodeId);
                this.addEdgesFromExpr(expr.consequent, nodeId);
                this.addEdgesFromExpr(expr.alternate, nodeId);
                if (groupId) this.addToGroup(groupId, nodeId);
                return nodeId;
            }
            case "AttemptsNode":
                return this.extractAttempts(expr, groupId);
            case "MapNode":
                return this.extractMap(expr, groupId);
            case "FilterNode":
                return this.extractFilter(expr, groupId);
            case "ParallelNode":
                return this.extractParallel(expr, groupId);
            case "ParallelMapNode":
                return this.extractParallelMap(expr, groupId);
            default:
                return undefined;
        }
    }

    // ---- Built-in node extraction ----

    private extractAttempts(
        expr: AttemptsNode,
        parentGroupId: string | undefined,
    ): string {
        const gid = this.freshGroupId("attempts");
        this.groups.push({
            id: gid,
            kind: "attempts",
            label: `attempts(${this.exprSummary(expr.count)})`,
            parentId: parentGroupId,
            children: [],
        });
        if (parentGroupId) this.addToGroup(parentGroupId, gid);

        for (const s of expr.body) {
            this.extractStatement(s, gid);
        }

        if (expr.fallback) {
            for (const s of expr.fallback.body) {
                this.extractStatement(s, gid);
            }
        }

        return gid;
    }

    private extractMap(
        expr: MapNode,
        parentGroupId: string | undefined,
    ): string {
        const gid = this.freshGroupId("map");
        this.groups.push({
            id: gid,
            kind: "map",
            label: `map(${this.exprSummary(expr.collection)}, ${expr.param})`,
            parentId: parentGroupId,
            children: [],
        });
        if (parentGroupId) this.addToGroup(parentGroupId, gid);
        this.addEdgesFromExpr(expr.collection, gid);

        for (const s of expr.body) {
            this.extractStatement(s, gid);
        }

        return gid;
    }

    private extractFilter(
        expr: FilterNode,
        parentGroupId: string | undefined,
    ): string {
        const gid = this.freshGroupId("filter");
        this.groups.push({
            id: gid,
            kind: "filter",
            label: `filter(${this.exprSummary(expr.collection)}, ${expr.param})`,
            parentId: parentGroupId,
            children: [],
        });
        if (parentGroupId) this.addToGroup(parentGroupId, gid);
        this.addEdgesFromExpr(expr.collection, gid);

        for (const s of expr.body) {
            this.extractStatement(s, gid);
        }

        return gid;
    }

    private extractParallel(
        expr: ParallelNode,
        parentGroupId: string | undefined,
    ): string {
        const gid = this.freshGroupId("parallel");
        this.groups.push({
            id: gid,
            kind: "parallel",
            label: `parallel(${expr.bodies.length} branches)`,
            parentId: parentGroupId,
            children: [],
        });
        if (parentGroupId) this.addToGroup(parentGroupId, gid);

        for (const branch of expr.bodies) {
            for (const s of branch.body) {
                this.extractStatement(s, gid);
            }
        }

        return gid;
    }

    private extractParallelMap(
        expr: ParallelMapNode,
        parentGroupId: string | undefined,
    ): string {
        const gid = this.freshGroupId("parallelMap");
        this.groups.push({
            id: gid,
            kind: "parallelMap",
            label: `parallelMap(${this.exprSummary(expr.collection)}, ${expr.param})`,
            parentId: parentGroupId,
            children: [],
        });
        if (parentGroupId) this.addToGroup(parentGroupId, gid);
        this.addEdgesFromExpr(expr.collection, gid);

        for (const s of expr.body) {
            this.extractStatement(s, gid);
        }

        return gid;
    }

    // ---- Edge extraction ----

    private extractTaskCallEdges(
        expr: TaskCallExpr,
        targetNodeId: string,
    ): void {
        for (const arg of expr.args) {
            const value = arg.value;
            const label = arg.kind === "NamedArg" ? arg.name : undefined;
            if (value.kind === "ObjectLiteralExpr") {
                for (const entry of value.entries) {
                    this.addEdgesFromExpr(entry.value, targetNodeId, entry.key);
                }
            } else {
                this.addEdgesFromExpr(value, targetNodeId, label);
            }
        }
    }

    private extractWorkflowCallEdges(
        expr: WorkflowCallExpr,
        targetNodeId: string,
    ): void {
        for (const arg of expr.args) {
            const value = arg.value;
            const label = arg.kind === "NamedArg" ? arg.name : undefined;
            this.addEdgesFromExpr(value, targetNodeId, label);
        }
    }

    private extractTemplateLiteralEdges(
        expr: TemplateLiteralExpr,
        targetNodeId: string,
    ): void {
        for (const subExpr of expr.expressions) {
            this.addEdgesFromExpr(subExpr, targetNodeId);
        }
    }

    private addEdgesFromExpr(
        expr: Expr,
        targetNodeId: string,
        label?: string,
    ): void {
        if (expr.kind === "DottedNameExpr") {
            const firstName = expr.segments[0];
            const sourceId = this.bindings.get(firstName);
            if (sourceId) {
                this.edges.push({
                    from: sourceId,
                    to: targetNodeId,
                    label,
                });
            }
        } else if (expr.kind === "ObjectLiteralExpr") {
            for (const entry of expr.entries) {
                this.addEdgesFromExpr(entry.value, targetNodeId, entry.key);
            }
        } else if (expr.kind === "ArrayLiteralExpr") {
            for (const el of expr.elements) {
                this.addEdgesFromExpr(el, targetNodeId);
            }
        } else if (expr.kind === "TaskCallExpr") {
            this.extractTaskCallEdges(expr, targetNodeId);
        } else if (expr.kind === "WorkflowCallExpr") {
            this.extractWorkflowCallEdges(expr, targetNodeId);
        } else if (expr.kind === "BinaryExpr") {
            this.addEdgesFromExpr(expr.left, targetNodeId);
            this.addEdgesFromExpr(expr.right, targetNodeId);
        } else if (expr.kind === "UnaryExpr") {
            this.addEdgesFromExpr(expr.operand, targetNodeId);
        } else if (expr.kind === "TernaryExpr") {
            this.addEdgesFromExpr(expr.condition, targetNodeId);
            this.addEdgesFromExpr(expr.consequent, targetNodeId);
            this.addEdgesFromExpr(expr.alternate, targetNodeId);
        } else if (expr.kind === "TemplateLiteralExpr") {
            this.extractTemplateLiteralEdges(expr, targetNodeId);
        }
    }

    // ---- Helpers ----

    private addToGroup(groupId: string, childId: string): void {
        const group = this.groups.find((g) => g.id === groupId);
        if (group) {
            group.children.push(childId);
        }
    }

    private isLiteral(expr: Expr): boolean {
        return (
            expr.kind === "NumberLiteralExpr" ||
            expr.kind === "StringLiteralExpr" ||
            expr.kind === "BooleanLiteralExpr" ||
            expr.kind === "NullLiteralExpr" ||
            expr.kind === "ArrayLiteralExpr" ||
            expr.kind === "ObjectLiteralExpr"
        );
    }

    private exprSummary(expr: Expr): string {
        switch (expr.kind) {
            case "DottedNameExpr":
                return expr.segments.join(".");
            case "StringLiteralExpr": {
                const s = decodeStringLiteral(expr.raw, expr.quote).value;
                return s.length > 30 ? `"${s.slice(0, 27)}..."` : `"${s}"`;
            }
            case "TemplateLiteralExpr":
                return "`...`";
            case "NumberLiteralExpr":
                return String(expr.value);
            case "BooleanLiteralExpr":
                return String(expr.value);
            case "NullLiteralExpr":
                return "null";
            case "ArrayLiteralExpr":
                return `[${expr.elements.length} items]`;
            case "ObjectLiteralExpr":
                return `{${expr.entries.map((e) => e.key).join(", ")}}`;
            case "TaskCallExpr":
                return `${expr.task}(...)`;
            case "WorkflowCallExpr":
                return `${expr.name}(...)`;
            case "BinaryExpr":
                return `${this.exprSummary(expr.left)} ${expr.op} ${this.exprSummary(expr.right)}`;
            case "UnaryExpr":
                return `${expr.op}${this.exprSummary(expr.operand)}`;
            case "TernaryExpr":
                return `${this.exprSummary(expr.condition)} ? ...`;
            case "AttemptsNode":
                return `attempts(${this.exprSummary(expr.count)}, ...)`;
            case "MapNode":
                return `map(...)`;
            case "FilterNode":
                return `filter(...)`;
            case "ParallelNode":
                return `parallel(...)`;
            case "ParallelMapNode":
                return `parallelMap(...)`;
        }
    }

    private typeToString(type: import("./ast.js").TypeExpr): string {
        switch (type.kind) {
            case "NamedType":
                return type.name;
            case "ArrayType":
                return `${this.typeToString(type.element)}[]`;
            case "ObjectType":
                return `{${type.fields.map((f) => f.name).join(", ")}}`;
        }
    }
}
