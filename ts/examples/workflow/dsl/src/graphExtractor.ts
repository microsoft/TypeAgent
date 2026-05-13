// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Extracts a visual graph model from a workflow DSL AST.
 *
 * The graph model is a simplified representation suitable for layout
 * and rendering by a visual editor. It captures:
 *   - Nodes: task calls, parameters, constants, return
 *   - Edges: data flow (variable references between nodes)
 *   - Groups: control flow blocks (for, while, try/catch, if/else)
 */

import {
    WorkflowDecl,
    Statement,
    Expr,
    TaskCallExpr,
    TemplateLiteralExpr,
    ForOfStatement,
    WhileStatement,
    IfStatement,
    TryStatement,
    LetStatement,
    ConstStatement,
    AssignmentStatement,
    ReturnStatement,
} from "./ast.js";

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
    kind: "task" | "template" | "literal" | "constant" | "return" | "assign";
    label: string;
    /** Task type (e.g., "http.get", "llm.generate") */
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
    | "for"
    | "while"
    | "try"
    | "catch"
    | "if-then"
    | "if-else";

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
            case "LetStatement":
                this.extractLet(stmt, groupId);
                break;
            case "ConstStatement":
                this.extractConst(stmt, groupId);
                break;
            case "AssignmentStatement":
                this.extractAssignment(stmt, groupId);
                break;
            case "ForOfStatement":
                this.extractForOf(stmt, groupId);
                break;
            case "WhileStatement":
                this.extractWhile(stmt, groupId);
                break;
            case "IfStatement":
                this.extractIf(stmt, groupId);
                break;
            case "TryStatement":
                this.extractTry(stmt, groupId);
                break;
            case "ReturnStatement":
                this.extractReturn(stmt, groupId);
                break;
            case "BreakStatement":
            case "ContinueStatement":
                // Control flow markers - shown as annotations, not nodes
                break;
            case "MatchStatement":
                // Not yet visualized
                break;
        }
    }

    private extractLet(stmt: LetStatement, groupId: string | undefined): void {
        if (!stmt.value) {
            // Uninitialized declaration - no visual node needed
            return;
        }

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
            const nodeId = this.freshNodeId("lit");
            this.nodes.push({
                id: nodeId,
                kind: "literal",
                label: `${stmt.name} = ${this.exprSummary(expr)}`,
                bindName: stmt.name,
                groupId,
                line: stmt.loc.line,
            });
            this.bindings.set(stmt.name, nodeId);
            if (groupId) this.addToGroup(groupId, nodeId);
        }
    }

    private extractConst(
        stmt: ConstStatement,
        groupId: string | undefined,
    ): void {
        const nodeId = this.freshNodeId("const");
        this.nodes.push({
            id: nodeId,
            kind: "constant",
            label: `${stmt.name} = ${this.exprSummary(stmt.value)}`,
            bindName: stmt.name,
            groupId,
            line: stmt.loc.line,
        });
        this.bindings.set(stmt.name, nodeId);
        if (groupId) this.addToGroup(groupId, nodeId);
    }

    private extractAssignment(
        stmt: AssignmentStatement,
        groupId: string | undefined,
    ): void {
        if (stmt.value.kind === "TaskCallExpr") {
            const nodeId = this.freshNodeId("task");
            this.nodes.push({
                id: nodeId,
                kind: "assign",
                label: `${stmt.name} =`,
                taskType: stmt.value.task,
                bindName: stmt.name,
                groupId,
                line: stmt.loc.line,
            });
            // Update binding to point to this node
            this.bindings.set(stmt.name, nodeId);
            this.extractTaskCallEdges(stmt.value, nodeId);
            if (groupId) this.addToGroup(groupId, nodeId);
        } else if (stmt.value.kind === "DottedNameExpr") {
            // Simple assignment like `pageContent = fetchResult.body`
            const nodeId = this.freshNodeId("assign");
            this.nodes.push({
                id: nodeId,
                kind: "assign",
                label: `${stmt.name} = ${stmt.value.segments.join(".")}`,
                bindName: stmt.name,
                groupId,
                line: stmt.loc.line,
            });
            this.bindings.set(stmt.name, nodeId);
            this.addEdgesFromExpr(stmt.value, nodeId);
            if (groupId) this.addToGroup(groupId, nodeId);
        }
    }

    private extractForOf(
        stmt: ForOfStatement,
        parentGroupId: string | undefined,
    ): void {
        const gid = this.freshGroupId("for");
        this.groups.push({
            id: gid,
            kind: "for",
            label: `for (${stmt.variable} of ${this.exprSummary(stmt.iterable)})`,
            parentId: parentGroupId,
            children: [],
        });
        if (parentGroupId) this.addToGroup(parentGroupId, gid);

        // The iterable is an edge into the group
        this.addEdgesFromExpr(stmt.iterable, gid);

        for (const s of stmt.body) {
            this.extractStatement(s, gid);
        }
    }

    private extractWhile(
        stmt: WhileStatement,
        parentGroupId: string | undefined,
    ): void {
        const gid = this.freshGroupId("while");
        this.groups.push({
            id: gid,
            kind: "while",
            label: `while (${this.exprSummary(stmt.condition)})`,
            parentId: parentGroupId,
            children: [],
        });
        if (parentGroupId) this.addToGroup(parentGroupId, gid);

        for (const s of stmt.body) {
            this.extractStatement(s, gid);
        }
    }

    private extractIf(
        stmt: IfStatement,
        parentGroupId: string | undefined,
    ): void {
        // Then branch
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

        // Else branch
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

    private extractTry(
        stmt: TryStatement,
        parentGroupId: string | undefined,
    ): void {
        const tryGid = this.freshGroupId("try");
        this.groups.push({
            id: tryGid,
            kind: "try",
            label: "try",
            parentId: parentGroupId,
            children: [],
        });
        if (parentGroupId) this.addToGroup(parentGroupId, tryGid);

        for (const s of stmt.tryBody) {
            this.extractStatement(s, tryGid);
        }

        const catchGid = this.freshGroupId("catch");
        this.groups.push({
            id: catchGid,
            kind: "catch",
            label: "catch",
            parentId: parentGroupId,
            children: [],
        });
        if (parentGroupId) this.addToGroup(parentGroupId, catchGid);

        for (const s of stmt.catchBody) {
            this.extractStatement(s, catchGid);
        }
    }

    private extractReturn(
        stmt: ReturnStatement,
        groupId: string | undefined,
    ): void {
        const nodeId = this.freshNodeId("return");
        this.nodes.push({
            id: nodeId,
            kind: "return",
            label: "return",
            groupId,
            line: stmt.loc.line,
        });
        this.addEdgesFromExpr(stmt.value, nodeId);
        if (groupId) this.addToGroup(groupId, nodeId);
    }

    // ---- Edge extraction ----

    private extractTaskCallEdges(
        expr: TaskCallExpr,
        targetNodeId: string,
    ): void {
        for (const arg of expr.args) {
            const value = arg.kind === "NamedArg" ? arg.value : arg.value;
            const label = arg.kind === "NamedArg" ? arg.name : undefined;
            if (value.kind === "ObjectLiteralExpr") {
                // Unwrap object literal args
                for (const entry of value.entries) {
                    this.addEdgesFromExpr(entry.value, targetNodeId, entry.key);
                }
            } else {
                this.addEdgesFromExpr(value, targetNodeId, label);
            }
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
            // Task call used as expression (e.g., in if condition)
            this.extractTaskCallEdges(expr, targetNodeId);
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
            expr.kind === "ArrayLiteralExpr"
        );
    }

    private exprSummary(expr: Expr): string {
        switch (expr.kind) {
            case "DottedNameExpr":
                return expr.segments.join(".");
            case "StringLiteralExpr": {
                const s = expr.value;
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
