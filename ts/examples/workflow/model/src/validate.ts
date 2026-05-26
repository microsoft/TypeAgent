// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    WorkflowIR,
    WorkflowBody,
    WorkflowNode,
    TaskNode,
    LoopNode,
    ForkNode,
    ForkMapNode,
    WorkflowCallNode,
    BranchNode,
    BranchArm,
    Template,
    JSONSchema,
    ConstantDef,
    LoopStateVar,
} from "./ir.js";
import { TaskDefinition } from "./taskDefinition.js";

export interface ValidationError {
    path: string;
    message: string;
}

export interface ValidationResult {
    valid: boolean;
    errors: ValidationError[];
}

/** Primitive JSON Schema types that branch selectors may resolve to.
 *  String() coercion at runtime only produces useful case labels for
 *  these. Objects and arrays cannot be meaningfully coerced. */
const SELECTOR_PRIMITIVE_TYPES = new Set([
    "string",
    "number",
    "integer",
    "boolean",
]);

/** Field names the engine injects into recovery task inputs (§3.8). */
const RECOVERY_INJECTED_FIELDS = ["error", "trigger"] as const;

/** Valid namespaces for `$from` template refs. */
const VALID_FROM_NAMESPACES = new Set(["input", "constant", "scope", "state"]);

/**
 * A JSON Schema `{ "not": {} }` rejects every value (equivalent to `never`).
 * Tasks with this outputSchema always fail and never produce output.
 */
export function isNeverSchema(schema: JSONSchema | undefined): boolean {
    if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
        return false;
    }
    const keys = Object.keys(schema);
    return (
        keys.length === 1 &&
        keys[0] === "not" &&
        typeof (schema as Record<string, unknown>).not === "object" &&
        Object.keys((schema as Record<string, unknown>).not as object)
            .length === 0
    );
}

/**
 * Structural validation for an IR v1 document.
 *
 * Checks:
 * - Entry existence and node reference integrity.
 * - Task registration.
 * - Static schema compatibility: verifies that scope references point to
 *   producers whose outputSchema declares the referenced path.
 */
/**
 * Structural validation for an IR v1 document.
 *
 * Checks:
 * - Top-level: workflows table, entry resolution.
 * - Per workflow body: entry existence and node reference integrity,
 *   task registration, static schema compatibility, CFG passes,
 *   template passes, type compatibility.
 * - WorkflowCallNode: ref resolution, schema match, acyclic call graph.
 */
export function validateWorkflowIR(
    ir: WorkflowIR,
    tasks?: ReadonlyMap<string, TaskDefinition>,
): ValidationResult {
    const errors: ValidationError[] = [];

    if (ir.kind !== "workflow") {
        errors.push({ path: "kind", message: `Expected "workflow".` });
    }

    if (ir.version !== "1") {
        errors.push({
            path: "version",
            message: `Expected version "1" (got "${ir.version}").`,
        });
    }

    if (!ir.workflows || typeof ir.workflows !== "object") {
        errors.push({
            path: "workflows",
            message: `Missing or invalid "workflows" table.`,
        });
        return { valid: false, errors };
    }

    if (Object.keys(ir.workflows).length === 0) {
        errors.push({
            path: "workflows",
            message: `Workflows table must contain at least one workflow.`,
        });
    }

    if (typeof ir.entry !== "string" || ir.entry.length === 0) {
        errors.push({
            path: "entry",
            message: `Missing or invalid "entry" workflow name.`,
        });
    } else if (!(ir.entry in ir.workflows)) {
        errors.push({
            path: "entry",
            message: `Entry workflow "${ir.entry}" does not exist in workflows table.`,
        });
    }

    // Validate constant values against their declared schemas.
    if (ir.constants) {
        for (const [name, def] of Object.entries(ir.constants)) {
            if (def.schema) {
                const valueSchema = jsonValueToSchema(def.value);
                if (!isStructuralSubtype(valueSchema, def.schema)) {
                    errors.push({
                        path: `constants.${name}`,
                        message:
                            `Constant value type ${formatSchemaType(valueSchema)} ` +
                            `is not compatible with declared schema ` +
                            `${formatSchemaType(def.schema)}.`,
                    });
                }
            }
        }
    }

    // Validate each workflow body.
    for (const [wfName, body] of Object.entries(ir.workflows)) {
        validateWorkflowBody(ir, wfName, body, tasks, errors);
    }

    // Validate WorkflowCallNode references and acyclic call graph.
    validateWorkflowCalls(ir, errors);

    return { valid: errors.length === 0, errors };
}

/**
 * Validate a single workflow body within an IR artifact.
 *
 * Each body is validated as a self-contained scope (entry, nodes, output,
 * schemas). Cross-workflow concerns (call resolution, acyclic call graph)
 * are validated at the IR level by `validateWorkflowCalls`.
 */
function validateWorkflowBody(
    ir: WorkflowIR,
    wfName: string,
    body: WorkflowBody,
    tasks: ReadonlyMap<string, TaskDefinition> | undefined,
    errors: ValidationError[],
): void {
    const basePath = `workflows.${wfName}`;
    const nodesPath = `${basePath}.nodes`;

    if (!(body.entry in body.nodes)) {
        errors.push({
            path: `${basePath}.entry`,
            message: `Entry node "${body.entry}" does not exist in workflow "${wfName}".`,
        });
    }

    validateScopeNodes(body.nodes, nodesPath, tasks, errors);

    validateSchemaCompat(body.nodes, nodesPath, errors);

    if (body.output) {
        const bindings = buildBindingMap(body.nodes);
        const outputRefs = collectTemplateRefs(
            body.output,
            `${basePath}.output`,
            "scope",
        );
        for (const ref of outputRefs) {
            if (!bindings.has(ref.name)) {
                if (!ref.optional) {
                    errors.push({
                        path: ref.templatePath,
                        message:
                            `$from "scope", name "${ref.name}": no node in ` +
                            `the workflow binds that name.`,
                    });
                }
            } else {
                const producerSchema = bindings.get(ref.name)!;
                checkSchemaCompat(
                    producerSchema,
                    ref.path,
                    ref.templatePath,
                    `${ref.templatePath} ($from "scope", name "${ref.name}")`,
                    errors,
                );
            }
        }
    }

    validateScopeCFG(
        body.nodes,
        body.entry,
        nodesPath,
        errors,
        body.output ?? undefined,
        `${basePath}.output`,
    );

    checkReservedTemplateKeys(body.output, `${basePath}.output`, errors);
    validateScopeTemplates(body.nodes, nodesPath, errors);

    validateTypeCompatibility(
        body.nodes,
        nodesPath,
        errors,
        body.inputSchema,
        undefined,
        ir.constants,
        body.output,
        `${basePath}.output`,
        body.outputSchema,
    );
}

/**
 * Validate all WorkflowCallNodes across the IR.
 *
 * Checks:
 * - `workflowRef.name` resolves to a workflow in `ir.workflows`.
 * - `inputSchema` and `outputSchema` match the referenced body.
 * - The call graph (workflow A calls workflow B) is acyclic.
 */

/**
 * Exhaustiveness helper. Passing an allegedly-`never` value here causes a
 * TypeScript compile error, so any switch over `WorkflowNode` that forgets a
 * case will be caught at build time rather than silently skipped at runtime.
 */
function assertNever(x: never): never {
    throw new Error(
        `Unhandled WorkflowNode kind: ${(x as { kind: string }).kind}`,
    );
}

function validateWorkflowCalls(
    ir: WorkflowIR,
    errors: ValidationError[],
): void {
    // First pass: per-call resolution + schema match.
    for (const [wfName, body] of Object.entries(ir.workflows)) {
        for (const [nodeId, node] of Object.entries(body.nodes)) {
            collectCallsInNode(
                node,
                `workflows.${wfName}.nodes.${nodeId}`,
                ir,
                errors,
            );
        }
    }

    // Second pass: acyclic call graph (workflow -> referenced workflows).
    const callGraph = new Map<string, Set<string>>();
    for (const [wfName, body] of Object.entries(ir.workflows)) {
        const callees = new Set<string>();
        for (const node of Object.values(body.nodes)) {
            collectCalleesInNode(node, callees);
        }
        callGraph.set(wfName, callees);
    }
    const cycle = findCallGraphCycle(callGraph);
    if (cycle) {
        errors.push({
            path: "workflows",
            message: `Workflow call graph contains a cycle: ${cycle.join(" -> ")}. Recursion is not supported in IR v1.`,
        });
    }
}

function collectCallsInNode(
    node: WorkflowNode,
    path: string,
    ir: WorkflowIR,
    errors: ValidationError[],
): void {
    switch (node.kind) {
        case "task":
            // Leaf node - no nested workflow calls.
            break;
        case "workflowCall": {
            const refName = node.workflowRef?.name;
            if (typeof refName !== "string" || refName.length === 0) {
                errors.push({
                    path: `${path}.workflowRef.name`,
                    message: `Missing or invalid workflow reference name.`,
                });
                break;
            }
            const source = node.workflowRef.source ?? "bundle";
            if (source !== "bundle") {
                errors.push({
                    path: `${path}.workflowRef.source`,
                    message: `Unsupported workflow reference source "${source}". Only "bundle" is supported in IR v1.`,
                });
                break;
            }
            const target = ir.workflows[refName];
            if (!target) {
                errors.push({
                    path: `${path}.workflowRef.name`,
                    message: `Workflow "${refName}" not found in workflows table.`,
                });
                break;
            }
            if (
                canonicalStringify(node.inputSchema) !==
                canonicalStringify(target.inputSchema)
            ) {
                errors.push({
                    path: `${path}.inputSchema`,
                    message: `Call inputSchema does not match referenced workflow "${refName}" inputSchema.`,
                });
            }
            if (
                canonicalStringify(node.outputSchema) !==
                canonicalStringify(target.outputSchema)
            ) {
                errors.push({
                    path: `${path}.outputSchema`,
                    message: `Call outputSchema does not match referenced workflow "${refName}" outputSchema.`,
                });
            }
            break;
        }
        case "loop":
        case "forkMap":
            for (const [innerId, innerNode] of Object.entries(
                node.body.nodes,
            )) {
                collectCallsInNode(
                    innerNode,
                    `${path}.body.nodes.${innerId}`,
                    ir,
                    errors,
                );
            }
            break;
        case "fork":
            for (const [branchName, branch] of Object.entries(node.branches)) {
                for (const [innerId, innerNode] of Object.entries(
                    branch.scope.nodes,
                )) {
                    collectCallsInNode(
                        innerNode,
                        `${path}.branches.${branchName}.scope.nodes.${innerId}`,
                        ir,
                        errors,
                    );
                }
            }
            break;
        case "branch": {
            const arms: Array<[string, BranchArm]> = [
                ...Object.entries(node.cases),
                ...(node.default
                    ? [["default", node.default] as [string, BranchArm]]
                    : []),
            ];
            for (const [armKey, arm] of arms) {
                for (const [innerId, innerNode] of Object.entries(
                    arm.scope.nodes,
                )) {
                    collectCallsInNode(
                        innerNode,
                        `${path}.cases.${armKey}.scope.nodes.${innerId}`,
                        ir,
                        errors,
                    );
                }
            }
            break;
        }
        default:
            assertNever(node);
    }
}

function collectCalleesInNode(node: WorkflowNode, callees: Set<string>): void {
    switch (node.kind) {
        case "task":
            // Leaf node - no nested workflow calls.
            break;
        case "workflowCall":
            if (node.workflowRef?.name) {
                callees.add(node.workflowRef.name);
            }
            break;
        case "loop":
        case "forkMap":
            for (const inner of Object.values(node.body.nodes)) {
                collectCalleesInNode(inner, callees);
            }
            break;
        case "fork":
            for (const branch of Object.values(node.branches)) {
                for (const inner of Object.values(branch.scope.nodes)) {
                    collectCalleesInNode(inner, callees);
                }
            }
            break;
        case "branch": {
            const arms = [
                ...Object.values(node.cases),
                ...(node.default ? [node.default] : []),
            ];
            for (const arm of arms) {
                for (const inner of Object.values(arm.scope.nodes)) {
                    collectCalleesInNode(inner, callees);
                }
            }
            break;
        }
        default:
            assertNever(node);
    }
}

function findCallGraphCycle(graph: Map<string, Set<string>>): string[] | null {
    const WHITE = 0,
        GRAY = 1,
        BLACK = 2;
    const color = new Map<string, number>();
    for (const name of graph.keys()) color.set(name, WHITE);

    const stack: string[] = [];
    function dfs(node: string): string[] | null {
        color.set(node, GRAY);
        stack.push(node);
        const callees = graph.get(node);
        if (callees) {
            for (const next of callees) {
                if (!graph.has(next)) continue;
                const c = color.get(next);
                if (c === GRAY) {
                    const i = stack.indexOf(next);
                    return [...stack.slice(i), next];
                }
                if (c === WHITE) {
                    const cycle = dfs(next);
                    if (cycle) return cycle;
                }
            }
        }
        stack.pop();
        color.set(node, BLACK);
        return null;
    }

    for (const name of graph.keys()) {
        if (color.get(name) === WHITE) {
            const cycle = dfs(name);
            if (cycle) return cycle;
        }
    }
    return null;
}

// ---- CFG data structure ----

interface ScopeCFG {
    /** nodeId -> set of successor nodeIds */
    edges: Map<string, Set<string>>;
    entry: string;
    /** nodes with no successors (natural-completion sites). In the top
     *  level scope these terminate the workflow; in a sub-scope
     *  (loop body, fork branch, forkMap body, branch arm) these are
     *  natural-completion sites where the scope's `output` resolves. */
    terminals: Set<string>;
}

/**
 * Build a CFG for a scope. Control-flow edges include next, onError,
 * and (for branches) the branch's own next/onError. Branch arms are
 * independent WorkflowScopes that do not contribute edges to the
 * parent CFG. Loop body natural completion + `continueWhen` handle
 * loop termination.
 */
function buildScopeCFG(
    nodes: Record<string, WorkflowNode>,
    entry: string,
): ScopeCFG {
    const edges = new Map<string, Set<string>>();

    for (const [id, node] of Object.entries(nodes)) {
        const succs = new Set<string>();
        edges.set(id, succs);

        switch (node.kind) {
            case "task":
            case "branch":
            case "loop":
            case "fork":
            case "forkMap":
            case "workflowCall":
                if (node.next) succs.add(node.next);
                if (node.onError) succs.add(node.onError);
                break;
            default:
                assertNever(node);
        }
    }

    const terminals = new Set<string>();
    for (const [id, succs] of edges) {
        if (succs.size === 0) {
            terminals.add(id);
        }
    }

    return { edges, entry, terminals };
}

// ---- Pass 10: Acyclicity ----

/**
 * Detect cycles in a scope CFG using DFS with three-color marking.
 * Returns the set of node IDs involved in cycles (empty if acyclic).
 */
function detectCycles(cfg: ScopeCFG): string[][] {
    const WHITE = 0,
        GRAY = 1,
        BLACK = 2;
    const color = new Map<string, number>();
    for (const id of cfg.edges.keys()) {
        color.set(id, WHITE);
    }

    const cycles: string[][] = [];

    function dfsIterative(start: string): void {
        const stack: { node: string; iter: IterableIterator<string> }[] = [];
        const path: string[] = [];

        color.set(start, GRAY);
        path.push(start);
        const startSuccs = cfg.edges.get(start) ?? new Set<string>();
        stack.push({ node: start, iter: startSuccs.values() });

        while (stack.length > 0) {
            const frame = stack[stack.length - 1];
            const next = frame.iter.next();
            if (next.done) {
                color.set(frame.node, BLACK);
                path.pop();
                stack.pop();
            } else {
                const v = next.value;
                const c = color.get(v);
                if (c === GRAY) {
                    // Back edge: extract cycle from path
                    const idx = path.indexOf(v);
                    cycles.push(path.slice(idx));
                } else if (c === WHITE) {
                    color.set(v, GRAY);
                    path.push(v);
                    const vSuccs = cfg.edges.get(v) ?? new Set<string>();
                    stack.push({ node: v, iter: vSuccs.values() });
                }
            }
        }
    }

    // Start from entry, then visit any unreached nodes
    if (color.has(cfg.entry)) {
        dfsIterative(cfg.entry);
    }
    for (const id of cfg.edges.keys()) {
        if (color.get(id) === WHITE) {
            dfsIterative(id);
        }
    }

    return cycles;
}

// ---- Pass 9: Termination ----

/**
 * Check that every node can reach a terminal (a node with no
 * outgoing edges). This applies uniformly across all scopes
 * (top-level, loop body, fork branch, forkMap body, and branch arm):
 * a terminal in a sub-scope is the scope's natural completion site
 * where its `output` resolves.
 */
function checkTermination(cfg: ScopeCFG): Set<string> {
    const exitNodes = new Set<string>(cfg.terminals);

    // Build reverse graph
    const reverseEdges = new Map<string, Set<string>>();
    for (const id of cfg.edges.keys()) {
        reverseEdges.set(id, new Set());
    }
    for (const [u, succs] of cfg.edges) {
        for (const v of succs) {
            reverseEdges.get(v)?.add(u);
        }
    }

    // BFS backwards from exit nodes
    const reached = new Set<string>();
    const queue = [...exitNodes];
    for (const id of queue) {
        if (reached.has(id)) continue;
        reached.add(id);
        const preds = reverseEdges.get(id);
        if (preds) {
            for (const p of preds) {
                if (!reached.has(p)) queue.push(p);
            }
        }
    }

    // Unreachable nodes
    const unreachable = new Set<string>();
    for (const id of cfg.edges.keys()) {
        if (!reached.has(id)) {
            unreachable.add(id);
        }
    }
    return unreachable;
}

// ---- Pass 6: Dominator analysis ----

/**
 * Compute immediate dominators for an acyclic CFG using reverse postorder.
 * Returns a map from nodeId to its immediate dominator nodeId.
 * The entry node maps to itself.
 */
function computeImmediateDominators(cfg: ScopeCFG): Map<string, string> {
    // Compute reverse postorder via iterative DFS from entry
    const rpo: string[] = [];
    const visited = new Set<string>();
    {
        const stack: {
            node: string;
            iter: IterableIterator<string>;
        }[] = [];
        visited.add(cfg.entry);
        const entrySuccs = cfg.edges.get(cfg.entry) ?? new Set<string>();
        stack.push({ node: cfg.entry, iter: entrySuccs.values() });
        while (stack.length > 0) {
            const frame = stack[stack.length - 1];
            const next = frame.iter.next();
            if (next.done) {
                rpo.push(frame.node);
                stack.pop();
            } else if (!visited.has(next.value)) {
                visited.add(next.value);
                const vSuccs = cfg.edges.get(next.value) ?? new Set<string>();
                stack.push({ node: next.value, iter: vSuccs.values() });
            }
        }
    }
    rpo.reverse();

    // Map node -> rpo index for O(1) lookup
    const rpoIndex = new Map<string, number>();
    for (let i = 0; i < rpo.length; i++) {
        rpoIndex.set(rpo[i], i);
    }

    // Build predecessor map (only for reachable nodes)
    const preds = new Map<string, string[]>();
    for (const id of rpo) {
        preds.set(id, []);
    }
    for (const [u, succs] of cfg.edges) {
        if (!rpoIndex.has(u)) continue;
        for (const v of succs) {
            if (rpoIndex.has(v)) {
                preds.get(v)!.push(u);
            }
        }
    }

    // Cooper/Harvey/Kennedy iterative dominator algorithm
    const idom = new Map<string, string>();
    idom.set(cfg.entry, cfg.entry);

    function intersect(b1: string, b2: string): string {
        let f1 = rpoIndex.get(b1)!;
        let f2 = rpoIndex.get(b2)!;
        while (f1 !== f2) {
            while (f1 > f2) {
                b1 = idom.get(b1)!;
                f1 = rpoIndex.get(b1)!;
            }
            while (f2 > f1) {
                b2 = idom.get(b2)!;
                f2 = rpoIndex.get(b2)!;
            }
        }
        return b1;
    }

    let changed = true;
    while (changed) {
        changed = false;
        for (const b of rpo) {
            if (b === cfg.entry) continue;
            const bPreds = preds.get(b)!;
            // Pick first processed predecessor
            let newIdom: string | undefined;
            for (const p of bPreds) {
                if (idom.has(p)) {
                    newIdom = p;
                    break;
                }
            }
            if (newIdom === undefined) continue;
            for (const p of bPreds) {
                if (p === newIdom) continue;
                if (idom.has(p)) {
                    newIdom = intersect(p, newIdom);
                }
            }
            if (idom.get(b) !== newIdom) {
                idom.set(b, newIdom);
                changed = true;
            }
        }
    }

    return idom;
}

/**
 * Check whether node `a` dominates node `b` (a is on every path from
 * entry to b). Uses the idom tree.
 */
function dominates(
    a: string,
    b: string,
    idom: Map<string, string>,
    entry: string,
): boolean {
    let cur = b;
    while (cur !== entry) {
        if (cur === a) return true;
        const parent = idom.get(cur);
        if (!parent || parent === cur) break;
        cur = parent;
    }
    return cur === a;
}

/**
 * Collect all nodes dominated by `a` (including `a` itself).
 */
function dominatedSet(a: string, idom: Map<string, string>): Set<string> {
    const result = new Set<string>();
    // Build children map from idom
    const children = new Map<string, string[]>();
    for (const [node, parent] of idom) {
        if (node === parent) continue; // entry
        let ch = children.get(parent);
        if (!ch) {
            ch = [];
            children.set(parent, ch);
        }
        ch.push(node);
    }
    const stack = [a];
    while (stack.length > 0) {
        const n = stack.pop()!;
        result.add(n);
        const ch = children.get(n);
        if (ch) stack.push(...ch);
    }
    return result;
}

/**
 * Build the set of nodes on the "success side" vs "error side" of an
 * onError split. Used for phi soundness: binders on opposite sides are
 * mutually exclusive.
 */
interface OnErrorSplit {
    trigger: string;
    successSide: Set<string>; // nodes dominated via next
    errorSide: Set<string>; // nodes dominated via onError
}

function buildOnErrorSplits(
    nodes: Record<string, WorkflowNode>,
    cfg: ScopeCFG,
    idom: Map<string, string>,
): OnErrorSplit[] {
    const splits: OnErrorSplit[] = [];
    for (const [id, node] of Object.entries(nodes)) {
        if (isBindableNode(node) && node.onError) {
            const errorTarget = node.onError;
            const errorSide = dominatedSet(errorTarget, idom);
            let successSide = new Set<string>();
            const nextTarget = node.next;
            if (nextTarget) {
                successSide = dominatedSet(nextTarget, idom);
            }
            // The trigger node itself is on the success side: its binding
            // is only produced when it completes without error.
            successSide.add(id);
            splits.push({ trigger: id, successSide, errorSide });
        }
    }
    return splits;
}

/**
 * Check whether two nodes are on mutually exclusive sides of an onError
 * split (one on success side, one on error side of the same trigger).
 */
function areMutuallyExclusive(
    a: string,
    b: string,
    splits: OnErrorSplit[],
): boolean {
    for (const split of splits) {
        if (
            (split.successSide.has(a) && split.errorSide.has(b)) ||
            (split.successSide.has(b) && split.errorSide.has(a))
        ) {
            return true;
        }
    }
    return false;
}

/**
 * Check whether a binding is covered at a given node (consumer or terminal).
 *
 * A binding is covered if:
 * (a) A single binder dominates the target and is not excluded by an onError
 *     split (binder on success side, target on error side), OR
 * (b) Binders on BOTH sides of an onError split exist for this name, the
 *     trigger dominates the target, and the target is not on either side of
 *     that specific split (meaning it's downstream of the merge point).
 *     This is "joint coverage" across mutually exclusive paths.
 */
function isBindingCoveredAtNode(
    binderList: string[],
    targetId: string,
    idom: Map<string, string>,
    cfg: ScopeCFG,
    splits: OnErrorSplit[],
): boolean {
    // (a) Direct coverage: a single binder dominates target without
    // being on the wrong side of an onError split.
    const directlyCovered = binderList.some((b) => {
        if (!dominates(b, targetId, idom, cfg.entry)) return false;
        for (const split of splits) {
            if (split.successSide.has(b) && split.errorSide.has(targetId)) {
                return false;
            }
        }
        return true;
    });
    if (directlyCovered) return true;

    // (b) Joint coverage: for some onError split, binders exist on both
    // sides, and the trigger dominates the target. This means every path
    // from entry through the trigger to the target passes through a binder
    // on one side or the other.
    for (const split of splits) {
        const hasSuccessBinder = binderList.some((b) =>
            split.successSide.has(b),
        );
        const hasErrorBinder = binderList.some((b) => split.errorSide.has(b));
        if (
            hasSuccessBinder &&
            hasErrorBinder &&
            dominates(split.trigger, targetId, idom, cfg.entry)
        ) {
            return true;
        }
    }

    // (c) Split-point phi coverage: for some node with multiple successors
    // that dominates target, every arm has a binder that cuts all paths
    // from that arm's entry to the target. This handles branch nodes where
    // both arms bind the same name (e.g. ternary, short-circuit &&/||).
    const binderSet = new Set(binderList);
    for (const [nodeId, succs] of cfg.edges) {
        if (succs.size < 2) continue;
        if (!dominates(nodeId, targetId, idom, cfg.entry)) continue;

        let allArmsCovered = true;
        for (const armEntry of succs) {
            if (binderSet.has(armEntry)) continue; // arm entry itself binds

            // BFS from armEntry; can we reach target without hitting a binder?
            const visited = new Set<string>();
            const queue: string[] = [armEntry];
            let reachesWithoutBinder = false;
            while (queue.length > 0) {
                const current = queue.shift()!;
                if (visited.has(current)) continue;
                visited.add(current);
                if (current === targetId) {
                    reachesWithoutBinder = true;
                    break;
                }
                const nextSuccs = cfg.edges.get(current);
                if (nextSuccs) {
                    for (const s of nextSuccs) {
                        if (!binderSet.has(s) && !visited.has(s)) {
                            queue.push(s);
                        }
                    }
                }
            }
            if (reachesWithoutBinder) {
                allArmsCovered = false;
                break;
            }
        }
        if (allArmsCovered) return true;
    }

    return false;
}

/**
 * Run the dominator-based checks for a scope:
 * - Phi soundness (6a): no two binders of the same name on the same path
 * - Coverage (6b): every $from scope ref is covered on all paths
 * - Output coverage: output refs covered on all paths to terminals
 * - Phi-merge (Pass 7): merged binder types compatible with consumers
 */
function checkDominanceAndPhi(
    nodes: Record<string, WorkflowNode>,
    cfg: ScopeCFG,
    idom: Map<string, string>,
    prefix: string,
    errors: ValidationError[],
    outputTemplate?: Template,
    outputPrefix?: string,
): void {
    const splits = buildOnErrorSplits(nodes, cfg, idom);

    // Build binder sets: name -> list of nodeIds that bind that name
    const binders = new Map<string, string[]>();
    for (const [id, node] of Object.entries(nodes)) {
        if (isBindableNode(node) && node.bind) {
            let list = binders.get(node.bind);
            if (!list) {
                list = [];
                binders.set(node.bind, list);
            }
            list.push(id);
        }
    }

    // Phi soundness (6a): for names with multiple binders, verify they
    // are on mutually exclusive paths (no binder dominates another binder
    // of the same name, unless they're on opposite sides of an onError split).
    for (const [name, binderList] of binders) {
        if (binderList.length < 2) continue;
        for (let i = 0; i < binderList.length; i++) {
            for (let j = i + 1; j < binderList.length; j++) {
                const a = binderList[i];
                const b = binderList[j];
                if (areMutuallyExclusive(a, b, splits)) continue;
                if (
                    dominates(a, b, idom, cfg.entry) ||
                    dominates(b, a, idom, cfg.entry)
                ) {
                    errors.push({
                        path: `${prefix}`,
                        message:
                            `Bind name "${name}": nodes "${a}" and "${b}" both ` +
                            `bind this name and one dominates the other. ` +
                            `Duplicate binders must be on mutually exclusive paths ` +
                            `(e.g. opposite sides of a branch or onError split).`,
                    });
                }
            }
        }
    }

    // Coverage (6b): for each $from scope ref in node inputs, check that
    // at least one binder dominates the consumer on every path.
    for (const [id, node] of Object.entries(nodes)) {
        if (!hasInputs(node)) continue;

        const refs = collectTemplateRefs(
            node.inputs,
            `${prefix}.${id}.inputs`,
            "scope",
        );
        for (const ref of refs) {
            const binderList = binders.get(ref.name);
            if (!binderList || binderList.length === 0) continue; // caught by name resolution
            const covered = isBindingCoveredAtNode(
                binderList,
                id,
                idom,
                cfg,
                splits,
            );
            if (!covered && !ref.optional) {
                errors.push({
                    path: ref.templatePath,
                    message:
                        `$from "scope", name "${ref.name}": no binder of ` +
                        `"${ref.name}" dominates node "${id}" on every path ` +
                        `from entry. The binding may not be available when ` +
                        `this node executes. Mark the reference as optional ` +
                        `or restructure so a binder always runs first.`,
                });
            }
        }
    }

    // Output template coverage: check that output refs are covered on
    // all paths to any terminal.
    if (outputTemplate && outputPrefix) {
        const outputRefs = collectTemplateRefs(
            outputTemplate,
            outputPrefix,
            "scope",
        );
        for (const ref of outputRefs) {
            const binderList = binders.get(ref.name);
            if (!binderList || binderList.length === 0) continue;
            // The output is evaluated after the scope reaches a terminal.
            // Every path from entry to a terminal must pass through a binder.
            // We check: for each terminal, at least one binder dominates it.
            for (const terminal of cfg.terminals) {
                // Skip terminals not reachable from entry
                if (!idom.has(terminal)) continue;
                const terminalCovered = isBindingCoveredAtNode(
                    binderList,
                    terminal,
                    idom,
                    cfg,
                    splits,
                );
                if (!terminalCovered && !ref.optional) {
                    errors.push({
                        path: ref.templatePath,
                        message:
                            `$from "scope", name "${ref.name}": not covered ` +
                            `on the path through terminal "${terminal}". ` +
                            `No binder of "${ref.name}" dominates that path. ` +
                            `The output may reference an unbound name when ` +
                            `that path executes.`,
                    });
                }
            }
        }
    }

    // Pass 7 (phi-merge): when multiple binders contribute to the same
    // name, each binder's output type must be compatible with every
    // consumer's expected type.
    checkPhiMergeTypes(nodes, binders, prefix, errors);
}

// ---- Scope-level CFG validation entry ----

function validateScopeCFG(
    nodes: Record<string, WorkflowNode>,
    entry: string,
    prefix: string,
    errors: ValidationError[],
    outputTemplate?: Template,
    outputPrefix?: string,
    skipTermination?: boolean,
): void {
    // Don't run CFG passes if entry doesn't exist (already caught)
    if (!(entry in nodes)) return;

    const cfg = buildScopeCFG(nodes, entry);

    // Pass 10: Acyclicity
    const cycles = detectCycles(cfg);
    for (const cycle of cycles) {
        errors.push({
            path: prefix,
            message:
                `Cycle detected: ${cycle.join(" -> ")} -> ${cycle[0]}. ` +
                `Intra-scope cycles are not allowed; use a loop construct instead.`,
        });
    }

    // Pass 4 (completion): onError structural rules (does not require acyclicity)
    validateOnErrorRules(nodes, entry, prefix, errors);

    // If cycles exist, skip passes that depend on acyclicity
    if (cycles.length > 0) return;

    // Pass 5: Scope closure (loop bodies only)
    // Checked within the loop body recursion below.

    // Pass 9: Termination
    if (!skipTermination) {
        const unreachable = checkTermination(cfg);
        for (const id of unreachable) {
            errors.push({
                path: `${prefix}.${id}`,
                message: `Node "${id}" cannot reach a terminal node.`,
            });
        }
    }

    // Pass 6: Dominator analysis
    const idom = computeImmediateDominators(cfg);
    checkDominanceAndPhi(
        nodes,
        cfg,
        idom,
        prefix,
        errors,
        outputTemplate,
        outputPrefix,
    );

    // Recurse into sub-scopes of container nodes.
    for (const [id, node] of Object.entries(nodes)) {
        switch (node.kind) {
            case "task":
            case "workflowCall":
                // Leaf nodes - no sub-scopes to recurse into.
                break;
            case "loop":
                if (node.body.entry in node.body.nodes) {
                    const bodyPrefix = `${prefix}.${id}.body.nodes`;

                    // Pass 5: Scope closure
                    checkScopeClosure(
                        node,
                        id,
                        bodyPrefix,
                        prefix,
                        nodes,
                        errors,
                    );

                    // Pass 11: State soundness
                    checkStateSoundness(node, id, `${prefix}.${id}`, errors);

                    validateScopeCFG(
                        node.body.nodes,
                        node.body.entry,
                        bodyPrefix,
                        errors,
                        node.body.output,
                        `${prefix}.${id}.body.output`,
                        !!node.onError, // skip body termination check when loop has onError
                    );
                }
                break;
            case "fork":
                for (const [bName, branch] of Object.entries(node.branches)) {
                    if (branch.scope.entry in branch.scope.nodes) {
                        const branchPrefix = `${prefix}.${id}.branches.${bName}.scope.nodes`;
                        validateScopeCFG(
                            branch.scope.nodes,
                            branch.scope.entry,
                            branchPrefix,
                            errors,
                            branch.scope.output,
                            `${prefix}.${id}.branches.${bName}.scope.output`,
                        );
                    }
                }
                break;
            case "forkMap":
                if (node.body.entry in node.body.nodes) {
                    const bodyPrefix = `${prefix}.${id}.body.nodes`;
                    validateScopeCFG(
                        node.body.nodes,
                        node.body.entry,
                        bodyPrefix,
                        errors,
                        node.body.output,
                        `${prefix}.${id}.body.output`,
                    );
                }
                break;
            case "branch":
                // Recursively validate each branch arm sub-scope.
                for (const [label, arm] of Object.entries(node.cases)) {
                    if (arm?.scope && arm.scope.entry in arm.scope.nodes) {
                        const armPrefix = `${prefix}.${id}.cases.${label}.scope.nodes`;
                        validateScopeCFG(
                            arm.scope.nodes,
                            arm.scope.entry,
                            armPrefix,
                            errors,
                            arm.scope.output,
                            `${prefix}.${id}.cases.${label}.scope.output`,
                        );
                    }
                }
                if (
                    node.default?.scope &&
                    node.default.scope.entry in node.default.scope.nodes
                ) {
                    const armPrefix = `${prefix}.${id}.default.scope.nodes`;
                    validateScopeCFG(
                        node.default.scope.nodes,
                        node.default.scope.entry,
                        armPrefix,
                        errors,
                        node.default.scope.output,
                        `${prefix}.${id}.default.scope.output`,
                    );
                }
                break;
            default:
                assertNever(node);
        }
    }
}

// ---- Pass 4 (completion): onError structural rules ----

function validateOnErrorRules(
    nodes: Record<string, WorkflowNode>,
    entry: string,
    prefix: string,
    errors: ValidationError[],
): void {
    // Collect onError targets and normal targets
    const onErrorTargetToTrigger = new Map<string, string>();
    const normalTargets = new Set<string>();
    normalTargets.add(entry);

    for (const [id, node] of Object.entries(nodes)) {
        if (isBindableNode(node)) {
            if (node.next) normalTargets.add(node.next);
            if (node.onError) {
                const existing = onErrorTargetToTrigger.get(node.onError);
                if (existing) {
                    errors.push({
                        path: `${prefix}.${id}.onError`,
                        message:
                            `Recovery node "${node.onError}" is targeted by ` +
                            `both "${existing}" and "${id}". A recovery ` +
                            `target must have exactly one trigger in v1.`,
                    });
                } else {
                    onErrorTargetToTrigger.set(node.onError, id);
                }
            }
        }
    }

    for (const [target, trigger] of onErrorTargetToTrigger) {
        const targetNode = nodes[target];
        if (!targetNode) continue; // existence already checked elsewhere

        // Rule 1: exclusive path
        if (normalTargets.has(target)) {
            errors.push({
                path: `${prefix}.${trigger}.onError`,
                message:
                    `Recovery node "${target}" is also reachable via ` +
                    `a normal path (next, branch case/default, or entry). ` +
                    `Recovery targets must only be reachable via onError.`,
            });
        }

        // Rule 4: recovery target must be a task. If it isn't, Rules 3
        // and 5 (task-specific) don't apply, so skip them.
        if (targetNode.kind !== "task") {
            errors.push({
                path: `${prefix}.${trigger}.onError`,
                message:
                    `Recovery target "${target}" must be a task node ` +
                    `(got "${targetNode.kind}").`,
            });
            continue;
        }

        // Rule 3: no recursive recovery (task only; loops are already
        // rejected above as non-task targets).
        if (targetNode.onError) {
            errors.push({
                path: `${prefix}.${target}.onError`,
                message:
                    `Recovery node "${target}" must not itself declare ` +
                    `onError. Recursive recovery chains are not ` +
                    `allowed in v1.`,
            });
        }

        // Rule 5: recovery task inputSchema must declare "error" and "trigger" (§3.8)
        const required = targetNode.inputSchema.required ?? [];
        for (const field of RECOVERY_INJECTED_FIELDS) {
            if (!required.includes(field)) {
                errors.push({
                    path: `${prefix}.${target}.inputSchema`,
                    message:
                        `Recovery task "${target}" must declare "${field}" ` +
                        `as a required input field. The engine injects ` +
                        `"error" and "trigger" when dispatching via onError (§3.8).`,
                });
            }
        }
    }
}

// ---- Pass 5: Scope closure ----

function checkScopeClosure(
    loopNode: {
        body: { nodes: Record<string, WorkflowNode> };
        inputs: Record<string, Template>;
    },
    loopId: string,
    bodyPrefix: string,
    outerPrefix: string,
    outerNodes: Record<string, WorkflowNode>,
    errors: ValidationError[],
): void {
    const bodyBindings = buildBindingMap(loopNode.body.nodes);
    const outerBindings = buildBindingMap(outerNodes);
    // Also include names available via $from: "input" and $from: "state"
    // (those are legal cross-scope references). We only check $from: "scope".

    for (const [id, node] of Object.entries(loopNode.body.nodes)) {
        if (!hasInputs(node)) continue;

        const refs = collectTemplateRefs(
            node.inputs,
            `${bodyPrefix}.${id}.inputs`,
            "scope",
        );
        for (const ref of refs) {
            if (!bodyBindings.has(ref.name)) {
                // Check if this name exists in the outer scope
                if (outerBindings.has(ref.name)) {
                    errors.push({
                        path: ref.templatePath,
                        message:
                            `$from "scope", name "${ref.name}": references ` +
                            `outer-scope binding. Loop body nodes cannot ` +
                            `reach outer-scope bindings via $from "scope". ` +
                            `Pass the value through the loop's inputs instead.`,
                    });
                }
            }
        }
    }
}

// ---- Pass 11: State soundness ----

function checkStateSoundness(
    loopNode: {
        state: Record<string, { schema: JSONSchema; initial: Template }>;
        iterateState: Record<string, Template>;
        body: { nodes: Record<string, WorkflowNode> };
    },
    loopId: string,
    prefix: string,
    errors: ValidationError[],
): void {
    const stateNames = new Set(Object.keys(loopNode.state));
    const iterateNames = new Set(Object.keys(loopNode.iterateState));

    // Every state var must have a corresponding iterateState entry
    for (const name of stateNames) {
        if (!iterateNames.has(name)) {
            errors.push({
                path: `${prefix}.iterateState`,
                message:
                    `State variable "${name}" is declared but has no ` +
                    `corresponding entry in iterateState.`,
            });
        }
    }

    // Every iterateState entry must correspond to a declared state var
    for (const name of iterateNames) {
        if (!stateNames.has(name)) {
            errors.push({
                path: `${prefix}.iterateState.${name}`,
                message:
                    `iterateState entry "${name}" has no corresponding ` +
                    `state variable declaration.`,
            });
        }
    }

    // Check $from: "state" refs in body nodes reference declared state vars
    // and that the state variable's schema type is compatible with the
    // consumer's expected type at that input position.
    for (const [id, node] of Object.entries(loopNode.body.nodes)) {
        if (!hasInputs(node)) continue;

        const stateRefs = collectTemplateRefs(
            node.inputs,
            `${prefix}.body.nodes.${id}.inputs`,
            "state",
        );
        const inputsPrefix = `${prefix}.body.nodes.${id}.inputs.`;
        for (const ref of stateRefs) {
            if (!stateNames.has(ref.name)) {
                errors.push({
                    path: ref.templatePath,
                    message:
                        `$from "state", name "${ref.name}": no state ` +
                        `variable "${ref.name}" is declared on this loop.`,
                });
            } else {
                const stateSchema = loopNode.state[ref.name].schema;
                const consumerPropSchema = resolveConsumerPropertySchema(
                    ref.templatePath,
                    inputsPrefix,
                    nodeInputSchema(node),
                );
                if (
                    stateSchema.type &&
                    consumerPropSchema?.type &&
                    !typeSetsOverlap(stateSchema.type, consumerPropSchema.type)
                ) {
                    errors.push({
                        path: ref.templatePath,
                        message:
                            `$from "state", name "${ref.name}": type ` +
                            `mismatch: state variable declares ` +
                            `${JSON.stringify(stateSchema.type)} but ` +
                            `consumer expects ` +
                            `${JSON.stringify(consumerPropSchema.type)}.`,
                    });
                }
            }
        }
    }
}

/**
 * Branch arm sub-scope validation: structural validation, schema
 * compatibility, and the arm-scope $from:"state" restriction.
 *
 * The parameter is typed `unknown` because callers may pass malformed
 * IR objects (tests use `as any` and downstream tooling generates IR
 * from untrusted sources). The function reports structural errors
 * rather than throwing on malformed input.
 *
 * Branch arms are isolated sub-scopes — they have no state namespace
 * in their ScopeContext. State values must cross the arm boundary via
 * `arm.inputs` (the DSL emitter does this automatically).
 */
function validateBranchArm(
    arm: unknown,
    armPath: string,
    tasks: ReadonlyMap<string, TaskDefinition> | undefined,
    errors: ValidationError[],
): void {
    if (arm === null || typeof arm !== "object") {
        errors.push({
            path: armPath,
            message:
                `Branch arm must be an object with "inputs" and "scope" ` +
                `fields.`,
        });
        return;
    }
    const armObj = arm as Partial<BranchArm>;
    if (
        armObj.inputs === undefined ||
        typeof armObj.inputs !== "object" ||
        armObj.inputs === null
    ) {
        errors.push({
            path: `${armPath}.inputs`,
            message: `Branch arm "inputs" must be an object template.`,
        });
    }
    const scope = armObj.scope;
    if (!scope || typeof scope !== "object") {
        errors.push({
            path: `${armPath}.scope`,
            message: `Branch arm "scope" must be a WorkflowScope object.`,
        });
        return;
    }
    if (typeof scope.entry !== "string") {
        errors.push({
            path: `${armPath}.scope.entry`,
            message: `Branch arm scope must declare a string "entry".`,
        });
        return;
    }
    const armNodes = scope.nodes;
    if (!armNodes || typeof armNodes !== "object") {
        errors.push({
            path: `${armPath}.scope.nodes`,
            message: `Branch arm scope must declare a "nodes" object.`,
        });
        return;
    }
    if (!(scope.entry in armNodes)) {
        errors.push({
            path: `${armPath}.scope.entry`,
            message: `Branch arm entry "${scope.entry}" does not exist.`,
        });
    }
    validateSubScope(armNodes, `${armPath}.scope.nodes`, tasks, errors);

    for (const [id, node] of Object.entries(armNodes)) {
        if (!hasInputs(node)) continue;
        const stateRefs = collectTemplateRefs(
            node.inputs,
            `${armPath}.scope.nodes.${id}.inputs`,
            "state",
        );
        for (const ref of stateRefs) {
            errors.push({
                path: ref.templatePath,
                message:
                    `$from "state", name "${ref.name}": branch arm nodes ` +
                    `have no state namespace. Thread state values through ` +
                    `arm.inputs instead.`,
            });
        }
    }
}

/**
 * Structural validation for the nodes of a scope (top-level workflow,
 * loop body, fork branch, forkMap body, or branch arm).
 *
 * Per-node-kind validation is delegated to dedicated helpers
 * (validateTaskNode / validateBranchNode / validateLoopNode /
 * validateForkNode / validateForkMapNode); this function is the
 * dispatch loop.
 */
function validateScopeNodes(
    nodes: Record<string, WorkflowNode>,
    prefix: string,
    tasks: ReadonlyMap<string, TaskDefinition> | undefined,
    errors: ValidationError[],
): void {
    // NOTE: Binding name uniqueness is intentionally NOT validated.
    // Duplicate bindings are a deliberate design pattern used for:
    //  1. onError recovery: both the happy path and the error handler
    //     produce the same binding name so downstream nodes can consume
    //     the result regardless of which path executed.
    //  2. Sequential overwrites: a later node intentionally shadows an
    //     earlier binding (e.g., refining a value across steps).
    // The last writer wins at runtime. If this causes confusion during
    // authoring, consider a lint-level warning (not a hard error).
    const nodeIds = new Set(Object.keys(nodes));
    for (const [id, node] of Object.entries(nodes)) {
        const path = `${prefix}.${id}`;
        switch (node.kind) {
            case "task":
                validateTaskNode(node, path, nodeIds, tasks, errors);
                break;
            case "branch":
                validateBranchNode(node, path, nodeIds, tasks, errors);
                break;
            case "loop":
                validateLoopNode(node, path, nodeIds, tasks, errors);
                break;
            case "fork":
                validateForkNode(node, path, nodeIds, tasks, errors);
                break;
            case "forkMap":
                validateForkMapNode(node, path, nodeIds, tasks, errors);
                break;
        }
    }
}

function validateTaskNode(
    node: TaskNode,
    path: string,
    nodeIds: Set<string>,
    tasks: ReadonlyMap<string, TaskDefinition> | undefined,
    errors: ValidationError[],
): void {
    if (tasks && !tasks.has(node.task)) {
        errors.push({
            path: `${path}.task`,
            message: `Task "${node.task}" is not registered.`,
        });
    } else if (tasks) {
        const taskDef = tasks.get(node.task);
        if (taskDef) {
            checkNodeTaskSchemas(taskDef, node, path, errors);
        }
    }
    // Never-output tasks always fail: next, bind, and onError are unreachable.
    if (isNeverSchema(node.outputSchema)) {
        if (node.next) {
            errors.push({
                path: `${path}.next`,
                message: `Task "${node.task}" has outputSchema { "not": {} } (never) and must not have "next".`,
            });
        }
        if (node.bind) {
            errors.push({
                path: `${path}.bind`,
                message: `Task "${node.task}" has outputSchema { "not": {} } (never) and must not have "bind".`,
            });
        }
        if (node.onError) {
            errors.push({
                path: `${path}.onError`,
                message: `Task "${node.task}" has outputSchema { "not": {} } (never) and must not have "onError".`,
            });
        }
    }
    checkBindableTargets(nodeIds, node, path, errors);
}

function validateBranchNode(
    node: BranchNode,
    path: string,
    nodeIds: Set<string>,
    tasks: ReadonlyMap<string, TaskDefinition> | undefined,
    errors: ValidationError[],
): void {
    // Validate selectorSchema type: String() coercion at runtime only
    // produces useful results for primitive types.
    const selectorType = node.selectorSchema?.type;
    if (selectorType) {
        const types = normalizeTypeSet(selectorType);
        const invalid = types.filter((t) => !SELECTOR_PRIMITIVE_TYPES.has(t));
        if (invalid.length > 0) {
            errors.push({
                path: `${path}.selectorSchema`,
                message:
                    `Selector type must be string, number, or boolean ` +
                    `(got ${JSON.stringify(selectorType)}). ` +
                    `Objects and arrays cannot be meaningfully coerced to case labels.`,
            });
        }
    }
    for (const [label, arm] of Object.entries(node.cases)) {
        validateBranchArm(arm, `${path}.cases.${label}`, tasks, errors);
    }
    if (node.default !== undefined) {
        validateBranchArm(node.default, `${path}.default`, tasks, errors);
    }
    // Branch bind / outputSchema are mutually required.
    if (node.bind !== undefined && node.outputSchema === undefined) {
        errors.push({
            path: `${path}.outputSchema`,
            message:
                `Branch declares bind "${node.bind}" but no outputSchema. ` +
                `When a branch declares bind, outputSchema is required.`,
        });
    }
    if (node.outputSchema !== undefined && node.bind === undefined) {
        errors.push({
            path: `${path}.outputSchema`,
            message:
                `Branch declares outputSchema without bind. ` +
                `outputSchema is only meaningful when the ` +
                `branch publishes its value via bind.`,
        });
    }
    // Per-arm outputSchema covariance vs branch.outputSchema.
    if (node.outputSchema !== undefined) {
        const branchOutput = node.outputSchema;
        for (const [label, arm] of Object.entries(node.cases)) {
            checkArmCovariance(
                arm,
                `${path}.cases.${label}`,
                "Arm",
                branchOutput,
                errors,
            );
        }
        if (node.default) {
            checkArmCovariance(
                node.default,
                `${path}.default`,
                "Default arm",
                branchOutput,
                errors,
            );
        }
    }
    // Branch carries its own next / onError.
    checkBindableTargets(nodeIds, node, path, errors);
}

function validateLoopNode(
    node: LoopNode,
    path: string,
    nodeIds: Set<string>,
    tasks: ReadonlyMap<string, TaskDefinition> | undefined,
    errors: ValidationError[],
): void {
    if (!(node.body.entry in node.body.nodes)) {
        errors.push({
            path: `${path}.body.entry`,
            message: `Body entry "${node.body.entry}" does not exist.`,
        });
    }
    validateSubScope(node.body.nodes, `${path}.body.nodes`, tasks, errors);

    // continueWhen is required; loop body natural completion triggers evaluation.
    if (node.continueWhen === undefined) {
        errors.push({
            path: `${path}.continueWhen`,
            message:
                `Loop must declare continueWhen (a Template that ` +
                `resolves to a boolean in the body scope at body ` +
                `natural completion).`,
        });
    } else {
        // $from:scope refs in continueWhen must resolve to names bound
        // in the body scope.
        const bodyBindings = buildBindingMap(node.body.nodes);
        const cwScopeRefs = collectTemplateRefs(
            node.continueWhen,
            `${path}.continueWhen`,
            "scope",
        );
        for (const ref of cwScopeRefs) {
            if (!bodyBindings.has(ref.name)) {
                errors.push({
                    path: ref.templatePath,
                    message:
                        `$from "scope", name "${ref.name}": no node ` +
                        `in the loop body binds "${ref.name}".`,
                });
            }
        }
        // $from:state refs in continueWhen must resolve to declared state vars.
        const stateNames = new Set(Object.keys(node.state ?? {}));
        const cwStateRefs = collectTemplateRefs(
            node.continueWhen,
            `${path}.continueWhen`,
            "state",
        );
        for (const ref of cwStateRefs) {
            if (!stateNames.has(ref.name)) {
                errors.push({
                    path: ref.templatePath,
                    message:
                        `$from "state", name "${ref.name}": no state ` +
                        `variable "${ref.name}" is declared on this loop.`,
                });
            }
        }
    }

    checkPositiveIntegerField(
        node.maxIterations,
        path,
        "maxIterations",
        errors,
    );
    checkBindableTargets(nodeIds, node, path, errors);
}

function validateForkNode(
    node: ForkNode,
    path: string,
    nodeIds: Set<string>,
    tasks: ReadonlyMap<string, TaskDefinition> | undefined,
    errors: ValidationError[],
): void {
    const branchNames = Object.keys(node.branches);
    if (branchNames.length < 2) {
        errors.push({
            path: `${path}.branches`,
            message: `Fork must have at least 2 branches (got ${branchNames.length}).`,
        });
    }
    for (const [bName, branch] of Object.entries(node.branches)) {
        if (!(branch.scope.entry in branch.scope.nodes)) {
            errors.push({
                path: `${path}.branches.${bName}.scope.entry`,
                message: `Branch entry "${branch.scope.entry}" does not exist.`,
            });
        }
        validateSubScope(
            branch.scope.nodes,
            `${path}.branches.${bName}.scope.nodes`,
            tasks,
            errors,
        );
    }
    checkPositiveIntegerField(
        node.maxConcurrency,
        path,
        "maxConcurrency",
        errors,
    );
    checkBindableTargets(nodeIds, node, path, errors);
}

function validateForkMapNode(
    node: ForkMapNode,
    path: string,
    nodeIds: Set<string>,
    tasks: ReadonlyMap<string, TaskDefinition> | undefined,
    errors: ValidationError[],
): void {
    if (!normalizeTypeSet(node.collectionSchema?.type).includes("array")) {
        errors.push({
            path: `${path}.collectionSchema`,
            message: `forkMap collectionSchema must be type "array".`,
        });
    }
    if (!(node.body.entry in node.body.nodes)) {
        errors.push({
            path: `${path}.body.entry`,
            message: `Body entry "${node.body.entry}" does not exist.`,
        });
    }
    validateSubScope(node.body.nodes, `${path}.body.nodes`, tasks, errors);
    // forkMap body must not use $from: "state"
    for (const [bNodeId, bNode] of Object.entries(node.body.nodes)) {
        if (hasInputs(bNode) && templateRefersToState(bNode.inputs)) {
            errors.push({
                path: `${path}.body.nodes.${bNodeId}.inputs`,
                message: `forkMap body nodes must not use $from: "state".`,
            });
        }
    }
    checkPositiveIntegerField(
        node.maxConcurrency,
        path,
        "maxConcurrency",
        errors,
    );
    checkPositiveIntegerField(
        node.maxIterations,
        path,
        "maxIterations",
        errors,
    );
    checkBindableTargets(nodeIds, node, path, errors);
}

/**
 * Per-arm outputSchema covariance against the branch's declared
 * outputSchema. Shared by `cases[label]` and `default` (§3.8 / §8.15).
 * Tolerant of malformed `arm` (see `validateBranchArm`).
 */
function checkArmCovariance(
    arm: unknown,
    armPath: string,
    armLabel: string,
    branchOutputSchema: JSONSchema,
    errors: ValidationError[],
): void {
    if (!arm || typeof arm !== "object") return;
    const scope = (arm as Partial<BranchArm>).scope;
    if (!scope || typeof scope !== "object") return;
    const armOutput = scope.outputSchema;
    if (armOutput === undefined) return;
    if (isStructuralSubtype(armOutput, branchOutputSchema)) return;
    errors.push({
        path: `${armPath}.scope.outputSchema`,
        message:
            `${armLabel} outputSchema ${formatSchemaType(armOutput)} ` +
            `is not assignable to branch outputSchema ` +
            `${formatSchemaType(branchOutputSchema)}.`,
    });
}

/**
 * Recursively check whether a template contains any $from: "state" reference.
 */
function templateRefersToState(template: Template): boolean {
    if (template === null || template === undefined) return false;
    if (typeof template !== "object") return false;
    if (Array.isArray(template)) {
        return template.some((t) => templateRefersToState(t));
    }
    const obj = template as Record<string, unknown>;
    if ("$from" in obj && obj["$from"] === "state") return true;
    return Object.values(obj).some((v) => templateRefersToState(v as Template));
}

// ---- Static schema compatibility ----

/**
 * Build a map of bind-name to producer outputSchema for a scope.
 */
function buildBindingMap(
    nodes: Record<string, WorkflowNode>,
): Map<string, JSONSchema> {
    const map = new Map<string, JSONSchema>();
    for (const node of Object.values(nodes)) {
        if (isBindableNode(node) && node.bind) {
            map.set(node.bind, nodeOutputSchema(node));
        }
    }
    return map;
}

/**
 * Given a JSON Schema and a path of property keys, resolve the schema type
 * at that path. Returns undefined if the path cannot be resolved.
 */
function resolveSchemaPath(
    schema: JSONSchema,
    path: (string | number)[],
): JSONSchema | undefined {
    let current: JSONSchema = schema;
    for (const segment of path) {
        if (typeof segment === "number") {
            // Array index: look at items schema
            if (
                current.type !== "array" ||
                !current.items ||
                typeof current.items === "boolean" ||
                Array.isArray(current.items)
            ) {
                return undefined;
            }
            current = current.items;
        } else {
            // Object property
            const props = current.properties;
            if (!props || !(segment in props)) {
                return undefined;
            }
            const sub = props[segment];
            if (typeof sub === "boolean") {
                return undefined;
            }
            current = sub;
        }
    }
    return current;
}

/**
 * Check that a producer schema at a given path is type-compatible with
 * what the consumer expects. Returns an error message or undefined.
 *
 * This is a lightweight structural check: it verifies that the producer
 * declares the path exists and that the leaf types are compatible.
 */
/**
 * Verify that a producer's `outputSchema` declares the path that a
 * consumer references, and that the resolved types are compatible.
 * Pushes one error to `errors` per failure.
 *
 * `errorPath` is the JSON path attributed to the error (typically the
 * consumer's template path). `refDesc` is the human-readable prefix
 * embedded in error messages (e.g. `${templatePath} ($from "scope",
 * name "x")`).
 */
function checkSchemaCompat(
    producerSchema: JSONSchema,
    path: (string | number)[] | undefined,
    errorPath: string,
    refDesc: string,
    errors: ValidationError[],
    consumerType?: string | string[],
): void {
    if (!path || path.length === 0) {
        // Reference to the whole output; compatible by definition
        // (consumer will validate at their end).
        return;
    }
    const resolved = resolveSchemaPath(producerSchema, path);
    if (resolved === undefined) {
        errors.push({
            path: errorPath,
            message: `${refDesc}: path ${JSON.stringify(path)} not declared in producer outputSchema`,
        });
        return;
    }
    // Type compatibility check: if the consumer declares a type and the
    // producer declares a type, verify they overlap.
    if (consumerType && resolved.type) {
        if (!typeSetsOverlap(resolved.type, consumerType)) {
            errors.push({
                path: errorPath,
                message:
                    `${refDesc}: type mismatch: producer declares ` +
                    `${JSON.stringify(resolved.type)} but consumer expects ${JSON.stringify(consumerType)}`,
            });
        }
    }
}

/** Normalize a JSON Schema type (string or array) to an array of type strings. */
function normalizeTypeSet(type: unknown): string[] {
    if (Array.isArray(type)) return type as string[];
    if (typeof type === "string") return [type];
    return [];
}

/**
 * True when JSON Schema type `a` is assignable to type `b`.
 * Handles the `integer`-is-a-subtype-of-`number` rule.
 */
function typeAssignableTo(a: string, b: string): boolean {
    return a === b || (a === "integer" && b === "number");
}

/**
 * True when the type sets overlap: at least one type in `aTypes` is
 * assignable to at least one type in `bTypes`.
 */
function typeSetsOverlap(aType: unknown, bType: unknown): boolean {
    const aTypes = normalizeTypeSet(aType);
    const bTypes = normalizeTypeSet(bType);
    return aTypes.some((a) => bTypes.some((b) => typeAssignableTo(a, b)));
}

/** Type guard: node kinds that carry `bind`, `next`, and `onError`. */
function isBindableNode(
    node: WorkflowNode,
): node is
    | TaskNode
    | LoopNode
    | ForkNode
    | ForkMapNode
    | WorkflowCallNode
    | BranchNode {
    // Branches now produce values when `bind` + `outputSchema` are
    // declared (ir-v0.2 branch-as-value-producing-node).
    return true;
}

/** Type guard: node kinds that carry `inputs` (task, loop, workflowCall). */
function hasInputs(
    node: WorkflowNode,
): node is TaskNode | LoopNode | WorkflowCallNode {
    return (
        node.kind === "task" ||
        node.kind === "loop" ||
        node.kind === "workflowCall"
    );
}

/** Get the effective input schema for an input-bearing node. */
function nodeInputSchema(
    node: TaskNode | LoopNode | WorkflowCallNode,
): JSONSchema {
    return node.kind === "loop" ? node.body.inputSchema : node.inputSchema;
}

/** Get the effective output schema for a bindable node. */
function nodeOutputSchema(
    node:
        | TaskNode
        | LoopNode
        | ForkNode
        | ForkMapNode
        | WorkflowCallNode
        | BranchNode,
): JSONSchema {
    if (node.kind === "loop") return node.body.outputSchema;
    if (node.kind === "branch") return node.outputSchema ?? {};
    return node.outputSchema;
}

/**
 * Check that a target reference exists in the scope; push an error if not.
 */
function checkTargetExists(
    nodeIds: Set<string>,
    target: string | undefined,
    path: string,
    field: "next" | "onError",
    errors: ValidationError[],
): void {
    if (!target) return;
    if (!nodeIds.has(target)) {
        errors.push({
            path: `${path}.${field}`,
            message:
                field === "onError"
                    ? `Error target "${target}" does not exist.`
                    : `Target "${target}" does not exist.`,
        });
    }
}

/**
 * Validate that both `next` and `onError` (when present) point to existing
 * nodes in the enclosing scope. All bindable node kinds (task/branch/loop/
 * fork/forkMap) carry the same pair of fields.
 */
function checkBindableTargets(
    nodeIds: Set<string>,
    node: { next?: string; onError?: string },
    path: string,
    errors: ValidationError[],
): void {
    checkTargetExists(nodeIds, node.next, path, "next", errors);
    checkTargetExists(nodeIds, node.onError, path, "onError", errors);
}

/**
 * Validate a sub-scope's nodes: structural validation followed by static
 * schema compatibility. Used for loop bodies, fork branches, forkMap
 * bodies, and branch arms.
 */
function validateSubScope(
    nodes: Record<string, WorkflowNode>,
    prefix: string,
    tasks: ReadonlyMap<string, TaskDefinition> | undefined,
    errors: ValidationError[],
): void {
    validateScopeNodes(nodes, prefix, tasks, errors);
    validateSchemaCompat(nodes, prefix, errors);
}

/**
 * Validate that a numeric field (when present) is a positive integer.
 * Used for `maxConcurrency` and `maxIterations` on loop/fork/forkMap.
 */
function checkPositiveIntegerField(
    value: number | undefined,
    path: string,
    field: string,
    errors: ValidationError[],
): void {
    if (value === undefined) return;
    if (!Number.isInteger(value) || value < 1) {
        errors.push({
            path: `${path}.${field}`,
            message: `${field} must be a positive integer (got ${value}).`,
        });
    }
}

/**
 * Build an array schema whose `items` is set only when every element
 * schema is structurally identical. Used by both `jsonValueToSchema`
 * (array literals) and `resolveTemplateType` (Template arrays).
 */
function buildArraySchema(elemSchemas: JSONSchema[]): JSONSchema {
    if (elemSchemas.length === 0) return { type: "array" };
    const firstKey = canonicalStringify(elemSchemas[0]);
    const allSame = elemSchemas.every(
        (s) => s === elemSchemas[0] || canonicalStringify(s) === firstKey,
    );
    return allSame
        ? { type: "array", items: elemSchemas[0] }
        : { type: "array" };
}

/** True when a schema is the top type (empty object: no constraints). */
function isTopSchema(schema: JSONSchema): boolean {
    return Object.keys(schema).length === 0;
}

/**
 * Property-order-independent JSON stringification for schema comparison.
 * Object keys are sorted recursively so structurally identical schemas
 * produce the same string regardless of key insertion order.
 */
function canonicalStringify(value: unknown): string {
    if (value === null || typeof value !== "object") {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return "[" + value.map(canonicalStringify).join(",") + "]";
    }
    const sorted = Object.keys(value as Record<string, unknown>).sort();
    return (
        "{" +
        sorted
            .map(
                (k) =>
                    JSON.stringify(k) +
                    ":" +
                    canonicalStringify((value as Record<string, unknown>)[k]),
            )
            .join(",") +
        "}"
    );
}

/**
 * Look up the consumer's expected schema for an input field given a
 * template path. Returns undefined for nested paths (containing "." or
 * "[" after the inputs prefix) since those can't be directly mapped to
 * an inputSchema property.
 */
function resolveConsumerPropertySchema(
    templatePath: string,
    inputsPrefix: string,
    inputSchema: JSONSchema,
): JSONSchema | undefined {
    if (!templatePath.startsWith(inputsPrefix)) return undefined;
    const fieldName = templatePath.slice(inputsPrefix.length);
    if (!fieldName || fieldName.includes(".") || fieldName.includes("[")) {
        return undefined;
    }
    const propDef = inputSchema.properties?.[fieldName];
    if (!propDef || typeof propDef === "boolean") return undefined;
    return propDef;
}

// ---- Pass 7: Type compatibility ----

/** Context for resolving template types within a scope. */
interface TypeResolutionContext {
    bindings: Map<string, JSONSchema>;
    inputSchema: JSONSchema | undefined;
    stateVars: Record<string, LoopStateVar> | undefined;
    constants: Record<string, ConstantDef> | undefined;
}

/** Derive a JSON Schema from a literal JSON value. */
function jsonValueToSchema(value: unknown): JSONSchema {
    if (value === null) return { type: "null" };
    if (typeof value === "string") return { type: "string", const: value };
    if (typeof value === "number") {
        return Number.isInteger(value)
            ? { type: "integer", const: value }
            : { type: "number", const: value };
    }
    if (typeof value === "boolean") return { type: "boolean", const: value };
    if (Array.isArray(value)) {
        if (value.length === 0) return { type: "array" };
        return buildArraySchema(value.map(jsonValueToSchema));
    }
    if (typeof value === "object") {
        const properties: Record<string, JSONSchema> = {};
        const required: string[] = [];
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            properties[k] = jsonValueToSchema(v);
            required.push(k);
        }
        return {
            type: "object",
            properties,
            ...(required.length > 0 ? { required } : {}),
        };
    }
    return {};
}

/**
 * Compute the JSON Schema type that a template expression resolves to.
 * Returns undefined if the type cannot be determined (e.g. unknown ref).
 */
function resolveTemplateType(
    template: Template,
    ctx: TypeResolutionContext,
): JSONSchema | undefined {
    if (template === null) return { type: "null" };
    if (typeof template === "string")
        return { type: "string", const: template };
    if (typeof template === "number") {
        return Number.isInteger(template)
            ? { type: "integer", const: template }
            : { type: "number", const: template };
    }
    if (typeof template === "boolean")
        return { type: "boolean", const: template };
    if (Array.isArray(template)) {
        const elemSchemas = template
            .map((e) => resolveTemplateType(e, ctx))
            .filter((s): s is JSONSchema => s !== undefined);
        return buildArraySchema(elemSchemas);
    }

    const obj = template as Record<string, unknown>;

    if ("$from" in obj) {
        const from = obj["$from"] as string;
        const name = obj["name"] as string;
        const path = obj["path"] as (string | number)[] | undefined;

        let baseSchema: JSONSchema | undefined;
        switch (from) {
            case "scope":
                baseSchema = ctx.bindings.get(name);
                break;
            case "input":
                if (ctx.inputSchema?.properties) {
                    const prop = ctx.inputSchema.properties[name];
                    if (prop && typeof prop !== "boolean") {
                        baseSchema = prop;
                    }
                }
                break;
            case "state":
                baseSchema = ctx.stateVars?.[name]?.schema;
                break;
            case "constant":
                baseSchema = ctx.constants?.[name]?.schema;
                break;
        }
        if (!baseSchema) return undefined;
        if (path && path.length > 0) {
            return resolveSchemaPath(baseSchema, path);
        }
        return baseSchema;
    }

    if ("$literal" in obj) {
        return jsonValueToSchema(obj["$literal"]);
    }

    // Plain object: property-wise composition
    const properties: Record<string, JSONSchema> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(obj)) {
        const propType = resolveTemplateType(value as Template, ctx);
        if (propType) {
            properties[key] = propType;
            required.push(key);
        }
    }
    return {
        type: "object",
        properties,
        ...(required.length > 0 ? { required } : {}),
    };
}

/**
 * Structural subtype check per section 4.2.
 * Returns true if producer P is compatible with consumer C.
 */
function isStructuralSubtype(
    producer: JSONSchema,
    consumer: JSONSchema,
): boolean {
    if (isTopSchema(consumer)) return true;
    if (isTopSchema(producer) && !isTopSchema(consumer)) {
        // Producer is unconstrained; can't prove it's a subtype of
        // a constrained consumer. Be lenient: skip.
        return true;
    }

    // Handle union types (anyOf, oneOf) per §4.2:
    // "P compatible iff every variant of P compatible with some variant of C".
    const producerVariants = producer.anyOf ?? producer.oneOf;
    const consumerVariants = consumer.anyOf ?? consumer.oneOf;

    if (producerVariants) {
        // Every producer variant must be compatible with consumer (or some
        // consumer variant when consumer is also a union).
        return producerVariants.every((v) => {
            if (typeof v === "boolean") return false;
            return consumerVariants
                ? consumerVariants.some(
                      (cv) =>
                          typeof cv !== "boolean" && isStructuralSubtype(v, cv),
                  )
                : isStructuralSubtype(v, consumer);
        });
    }

    if (consumerVariants) {
        // Non-union producer: must be compatible with at least one consumer variant.
        return consumerVariants.some(
            (v) => typeof v !== "boolean" && isStructuralSubtype(producer, v),
        );
    }

    // Const / enum narrowing checks.
    // Only applied when both sides have const/enum constraints. When the
    // producer is wider (no const/enum), we stay lenient — narrowing is
    // verified by runtime input/selectorSchema validation. Exhaustiveness
    // checking uses isProvablyNarrowedTo (see below) for strict subset.
    if (consumer.const !== undefined) {
        if (producer.const !== undefined) {
            return producer.const === consumer.const;
        }
        if (producer.enum) {
            return producer.enum.every((v) => v === consumer.const);
        }
        // Producer is wider; stay lenient (defense-in-depth at runtime).
    } else if (consumer.enum) {
        const allowed = new Set(consumer.enum);
        if (producer.const !== undefined) {
            return allowed.has(producer.const);
        }
        if (producer.enum) {
            return producer.enum.every((v) => allowed.has(v));
        }
        // Producer is wider; stay lenient (defense-in-depth at runtime).
    }

    // Handle allOf: intersection semantics.
    if (producer.allOf) {
        // Producer satisfies every allOf member simultaneously (intersection).
        // It is compatible with C when any single member satisfies C, because
        // the intersection is at least as constrained as that member.
        return producer.allOf.some(
            (v) => typeof v !== "boolean" && isStructuralSubtype(v, consumer),
        );
    }

    if (consumer.allOf) {
        // Producer must satisfy every member of consumer's allOf.
        return consumer.allOf.every(
            (v) => typeof v !== "boolean" && isStructuralSubtype(producer, v),
        );
    }

    // Type check
    if (producer.type && consumer.type) {
        const pTypes = normalizeTypeSet(producer.type);
        const cTypes = normalizeTypeSet(consumer.type);
        for (const pt of pTypes) {
            if (!cTypes.some((ct) => typeAssignableTo(pt, ct))) return false;
        }
    } else if (consumer.type && !producer.type) {
        return true; // producer unconstrained, be lenient
    }

    // Object: every required property of C must be present in P
    // with a compatible type
    const cRequired = consumer.required ?? [];
    const pProps = producer.properties ?? {};
    const cProps = consumer.properties ?? {};

    for (const req of cRequired) {
        if (!(req in pProps)) return false;
        const pProp = pProps[req];
        const cProp = cProps[req];
        if (
            pProp &&
            cProp &&
            typeof pProp !== "boolean" &&
            typeof cProp !== "boolean"
        ) {
            if (!isStructuralSubtype(pProp, cProp)) return false;
        }
    }

    // Check optional consumer props present in producer
    for (const [key, cPropDef] of Object.entries(cProps)) {
        if (cRequired.includes(key)) continue;
        const pPropDef = pProps[key];
        if (
            pPropDef &&
            cPropDef &&
            typeof pPropDef !== "boolean" &&
            typeof cPropDef !== "boolean"
        ) {
            if (!isStructuralSubtype(pPropDef, cPropDef)) return false;
        }
    }

    // Array: element type compatibility
    if (consumer.items && producer.items) {
        if (
            typeof consumer.items !== "boolean" &&
            typeof producer.items !== "boolean" &&
            !Array.isArray(consumer.items) &&
            !Array.isArray(producer.items)
        ) {
            if (!isStructuralSubtype(producer.items, consumer.items)) {
                return false;
            }
        }
    }

    return true;
}

/**
 * Strict narrowing check used by exhaustive branch verification.
 *
 * Returns true iff `producer` is provably constrained to a subset of
 * `allowedValues`. Unlike `isStructuralSubtype` which stays lenient when
 * the producer is wider than a constraint, this function requires the
 * producer to have an explicit `const` or `enum` whose values all fall
 * within `allowedValues`.
 *
 * Used when `default` is absent on a branch: the selector's resolved
 * type must be statically narrowed so the engine can prove every
 * possible value has a matching case.
 */
function isProvablyNarrowedTo(
    producer: JSONSchema,
    allowedValues: ReadonlyArray<unknown>,
): boolean {
    const allowed = new Set(allowedValues);
    if (producer.const !== undefined) return allowed.has(producer.const);
    if (producer.enum) return producer.enum.every((v) => allowed.has(v));

    // Boolean is inherently a closed set {true, false}; treat it as
    // implicitly enum-typed.
    if (producer.type === "boolean") {
        return allowed.has(true) && allowed.has(false);
    }

    // Recurse into union variants — every variant must be narrowed.
    const variants = producer.anyOf ?? producer.oneOf;
    if (variants) {
        return variants.every(
            (v) =>
                typeof v !== "boolean" &&
                isProvablyNarrowedTo(v, allowedValues),
        );
    }
    return false;
}

/**
 * Validate type compatibility (pass 7) within a scope.
 *
 * For each node:
 * - Compute the resolved type of each input template value and check
 *   it against the corresponding inputSchema property.
 * - For branch nodes: check selector resolved type vs selectorSchema
 *   and validate cases keys against selectorSchema enum (if declared).
 *
 * Also checks the scope's output template resolved type against
 * outputSchema.
 */
function validateTypeCompatibility(
    nodes: Record<string, WorkflowNode>,
    prefix: string,
    errors: ValidationError[],
    scopeInputSchema?: JSONSchema,
    stateVars?: Record<string, LoopStateVar>,
    constants?: Record<string, ConstantDef>,
    outputTemplate?: Template,
    outputPrefix?: string,
    outputSchema?: JSONSchema,
): void {
    const bindings = buildBindingMap(nodes);
    const ctx: TypeResolutionContext = {
        bindings,
        inputSchema: scopeInputSchema,
        stateVars,
        constants,
    };

    for (const [id, node] of Object.entries(nodes)) {
        const path = `${prefix}.${id}`;

        if (hasInputs(node)) {
            // Check each input template value against the corresponding
            // inputSchema property.
            const inputs = node.inputs;
            const inputProps = nodeInputSchema(node).properties ?? {};
            for (const [fieldName, templateValue] of Object.entries(inputs)) {
                const resolved = resolveTemplateType(templateValue, ctx);
                if (!resolved) continue;
                const consumerPropDef = inputProps[fieldName];
                if (!consumerPropDef || typeof consumerPropDef === "boolean") {
                    continue;
                }
                if (!isStructuralSubtype(resolved, consumerPropDef)) {
                    errors.push({
                        path: `${path}.inputs.${fieldName}`,
                        message:
                            `Type mismatch: resolved input type ` +
                            `${formatSchemaType(resolved)} is not ` +
                            `compatible with expected type ` +
                            `${formatSchemaType(consumerPropDef)}.`,
                    });
                }
            }
        }

        if (node.kind === "branch") {
            // Check selector template resolved type vs selectorSchema
            const selectorType = resolveTemplateType(node.selector, ctx);
            if (selectorType) {
                // Verify resolved selector is a primitive type
                if (selectorType.type) {
                    const resolvedTypes = normalizeTypeSet(selectorType.type);
                    const nonPrimitive = resolvedTypes.filter(
                        (t) => !SELECTOR_PRIMITIVE_TYPES.has(t),
                    );
                    if (nonPrimitive.length > 0) {
                        errors.push({
                            path: `${path}.selector`,
                            message:
                                `Selector resolves to ` +
                                `${formatSchemaType(selectorType)} which ` +
                                `cannot be meaningfully coerced to a case ` +
                                `label. Selector must resolve to string, ` +
                                `number, or boolean.`,
                        });
                    }
                }
                if (!isTopSchema(node.selectorSchema)) {
                    if (
                        !isStructuralSubtype(selectorType, node.selectorSchema)
                    ) {
                        errors.push({
                            path: `${path}.selector`,
                            message:
                                `Selector resolved type ` +
                                `${formatSchemaType(selectorType)} is not ` +
                                `compatible with selectorSchema ` +
                                `${formatSchemaType(node.selectorSchema)}.`,
                        });
                    }
                }
            }

            // Check cases keys against selectorSchema enum
            if (node.selectorSchema.enum) {
                const validKeys = new Set(node.selectorSchema.enum.map(String));
                for (const caseKey of Object.keys(node.cases)) {
                    if (!validKeys.has(caseKey)) {
                        errors.push({
                            path: `${path}.cases.${caseKey}`,
                            message:
                                `Case key "${caseKey}" is not a valid ` +
                                `value in selectorSchema.enum ` +
                                `${JSON.stringify(node.selectorSchema.enum)}.`,
                        });
                    }
                }
            }

            // Exhaustiveness: when `default` is omitted, the branch must
            // be statically provable to cover every possible selector value.
            if (node.default === undefined) {
                // { type: "boolean" } is treated as an implicit enum [true, false].
                const isBooleanSelector =
                    node.selectorSchema.type === "boolean" &&
                    !node.selectorSchema.enum;
                const enumValues = isBooleanSelector
                    ? [true, false]
                    : node.selectorSchema.enum;
                if (!enumValues || enumValues.length === 0) {
                    errors.push({
                        path: `${path}.default`,
                        message:
                            `Branch has no default but selectorSchema is ` +
                            `not a closed enum (selectorSchema: ` +
                            `${formatSchemaType(node.selectorSchema)}). ` +
                            `Fix: add a default target, or declare ` +
                            `selectorSchema with an "enum" constraint.`,
                    });
                } else {
                    // Every enum value must have a matching case key.
                    const caseKeys = new Set(Object.keys(node.cases));
                    const missing = enumValues
                        .map(String)
                        .filter((v) => !caseKeys.has(v));
                    if (missing.length > 0) {
                        errors.push({
                            path: `${path}.cases`,
                            message:
                                `Branch has no default and is not ` +
                                `exhaustive. Missing case(s): ` +
                                `${JSON.stringify(missing)}. ` +
                                `Fix: add a case for each missing value, ` +
                                `or add a default target.`,
                        });
                    }
                    // Selector must be statically narrowed to the enum.
                    if (selectorType) {
                        if (!isProvablyNarrowedTo(selectorType, enumValues)) {
                            errors.push({
                                path: `${path}.selector`,
                                message:
                                    `Branch has no default but selector ` +
                                    `resolved type ` +
                                    `${formatSchemaType(selectorType)} is ` +
                                    `not statically narrowed to the enum ` +
                                    `${JSON.stringify(enumValues)}. ` +
                                    `Fix: narrow the selector's upstream ` +
                                    `type (declare an "enum" on the ` +
                                    `producing task output / constant), ` +
                                    `or add a default target.`,
                            });
                        }
                    }
                }
            }
        }

        // Recurse into sub-scopes of container nodes.
        switch (node.kind) {
            case "task":
            case "workflowCall":
                // Leaf nodes - no sub-scopes to recurse into.
                break;
            case "loop":
                if (node.body.entry in node.body.nodes) {
                    validateTypeCompatibility(
                        node.body.nodes,
                        `${path}.body.nodes`,
                        errors,
                        node.body.inputSchema,
                        node.state,
                        constants,
                        node.body.output,
                        `${path}.body.output`,
                        node.body.outputSchema,
                    );

                    // Check loop output template type vs loop outputSchema
                    const bodyBindings = buildBindingMap(node.body.nodes);
                    const bodyCtx: TypeResolutionContext = {
                        bindings: bodyBindings,
                        inputSchema: node.body.inputSchema,
                        stateVars: node.state,
                        constants,
                    };
                    if (node.body.output && node.body.outputSchema) {
                        const outputResolved = resolveTemplateType(
                            node.body.output,
                            bodyCtx,
                        );
                        if (
                            outputResolved &&
                            !isTopSchema(node.body.outputSchema)
                        ) {
                            if (
                                !isStructuralSubtype(
                                    outputResolved,
                                    node.body.outputSchema,
                                )
                            ) {
                                errors.push({
                                    path: `${path}.body.output`,
                                    message:
                                        `Loop output resolved type ` +
                                        `${formatSchemaType(outputResolved)} is not ` +
                                        `compatible with loop outputSchema ` +
                                        `${formatSchemaType(node.body.outputSchema)}.`,
                                });
                            }
                        }
                    }
                }
                break;
            case "fork":
                for (const [bName, branch] of Object.entries(node.branches)) {
                    if (branch.scope.entry in branch.scope.nodes) {
                        validateTypeCompatibility(
                            branch.scope.nodes,
                            `${path}.branches.${bName}.scope.nodes`,
                            errors,
                            scopeInputSchema,
                            undefined,
                            constants,
                        );
                    }
                }
                break;
            case "forkMap":
                if (node.body.entry in node.body.nodes) {
                    validateTypeCompatibility(
                        node.body.nodes,
                        `${path}.body.nodes`,
                        errors,
                        scopeInputSchema,
                        undefined,
                        constants,
                    );
                }
                break;
            case "branch":
                for (const [label, arm] of Object.entries(node.cases)) {
                    if (arm?.scope && arm.scope.entry in arm.scope.nodes) {
                        validateTypeCompatibility(
                            arm.scope.nodes,
                            `${path}.cases.${label}.scope.nodes`,
                            errors,
                            scopeInputSchema,
                            undefined,
                            constants,
                        );
                    }
                }
                if (
                    node.default?.scope &&
                    node.default.scope.entry in node.default.scope.nodes
                ) {
                    validateTypeCompatibility(
                        node.default.scope.nodes,
                        `${path}.default.scope.nodes`,
                        errors,
                        scopeInputSchema,
                        undefined,
                        constants,
                    );
                }
                break;
            default:
                assertNever(node);
        }
    }

    // Check scope output template type vs outputSchema
    if (outputTemplate && outputSchema && outputPrefix) {
        const outputResolved = resolveTemplateType(outputTemplate, ctx);
        if (outputResolved && !isTopSchema(outputSchema)) {
            if (!isStructuralSubtype(outputResolved, outputSchema)) {
                errors.push({
                    path: outputPrefix,
                    message:
                        `Output resolved type ` +
                        `${formatSchemaType(outputResolved)} is not ` +
                        `compatible with outputSchema ` +
                        `${formatSchemaType(outputSchema)}.`,
                });
            }
        }
    }
}

/**
 * Check that every binder of a phi-merged name produces a type
 * compatible with each consumer's expected type (pass 7 phi-merge).
 */
function checkPhiMergeTypes(
    nodes: Record<string, WorkflowNode>,
    binders: Map<string, string[]>,
    prefix: string,
    errors: ValidationError[],
): void {
    for (const [id, node] of Object.entries(nodes)) {
        if (!hasInputs(node)) continue;
        const inputs = node.inputs;
        const inputProps = nodeInputSchema(node).properties ?? {};

        for (const [fieldName, templateValue] of Object.entries(inputs)) {
            if (
                typeof templateValue !== "object" ||
                templateValue === null ||
                Array.isArray(templateValue)
            ) {
                continue;
            }
            const obj = templateValue as Record<string, unknown>;
            if (obj["$from"] !== "scope") continue;
            const refName = obj["name"] as string;
            const binderList = binders.get(refName);
            if (!binderList || binderList.length < 2) continue;

            const consumerPropDef = inputProps[fieldName];
            if (
                !consumerPropDef ||
                typeof consumerPropDef === "boolean" ||
                isTopSchema(consumerPropDef)
            ) {
                continue;
            }

            for (const binderId of binderList) {
                const binderNode = nodes[binderId];
                if (!binderNode || !isBindableNode(binderNode)) continue;
                const binderSchema = nodeOutputSchema(binderNode);

                // Apply path projection if present
                const refPath = obj["path"] as (string | number)[] | undefined;
                const projected =
                    refPath && refPath.length > 0
                        ? resolveSchemaPath(binderSchema, refPath)
                        : binderSchema;
                if (!projected) continue;

                if (!isStructuralSubtype(projected, consumerPropDef)) {
                    errors.push({
                        path: `${prefix}.${id}.inputs.${fieldName}`,
                        message:
                            `Phi-merge: binder "${binderId}" produces ` +
                            `${formatSchemaType(projected)} which is not ` +
                            `compatible with consumer's expected type ` +
                            `${formatSchemaType(consumerPropDef)}.`,
                    });
                }
            }
        }
    }
}

/** Format a schema type for error messages. */
function formatSchemaType(schema: JSONSchema): string {
    if (schema.type) return JSON.stringify(schema.type);
    if (schema.enum) return `enum ${JSON.stringify(schema.enum)}`;
    return JSON.stringify(schema);
}

/**
 * Validate that a workflow node's inputSchema and outputSchema are
 * compatible with the registered task definition's schemas.
 *
 * Rules:
 * - Input: the node must declare as required every property the task
 *   requires. Shared property types must be compatible.
 * - Output: the node can refine (narrow) the task's output. It must
 *   keep all task-required properties as required. It may only declare
 *   properties that the task itself declares. Task properties with
 *   empty schemas ({}, the top type) accept any refinement.
 */
function checkNodeTaskSchemas(
    taskDef: TaskDefinition,
    node: { inputSchema: JSONSchema; outputSchema: JSONSchema },
    path: string,
    errors: ValidationError[],
): void {
    // --- Input: node must satisfy task's requirements ---
    const taskInputReq = taskDef.inputSchema.required ?? [];
    const nodeInputReq = node.inputSchema.required ?? [];
    for (const prop of taskInputReq) {
        if (!nodeInputReq.includes(prop)) {
            errors.push({
                path: `${path}.inputSchema`,
                message:
                    `Task requires input "${prop}" but node ` +
                    `does not declare it as required.`,
            });
        }
    }

    const taskInputProps = taskDef.inputSchema.properties ?? {};
    const nodeInputProps = node.inputSchema.properties ?? {};
    for (const [propName, taskPropDef] of Object.entries(taskInputProps)) {
        if (typeof taskPropDef === "boolean" || isTopSchema(taskPropDef)) {
            continue;
        }
        const nodePropDef = nodeInputProps[propName];
        if (
            nodePropDef === undefined ||
            typeof nodePropDef === "boolean" ||
            !nodePropDef.type ||
            !taskPropDef.type
        ) {
            continue;
        }
        if (!typeSetsOverlap(nodePropDef.type, taskPropDef.type)) {
            errors.push({
                path: `${path}.inputSchema`,
                message:
                    `Input property "${propName}": node declares type ` +
                    `${JSON.stringify(nodePropDef.type)} but task expects ` +
                    `${JSON.stringify(taskPropDef.type)}.`,
            });
        }
    }

    // --- Output: node can only refine what the task produces ---
    const taskOutputReq = taskDef.outputSchema.required ?? [];
    const nodeOutputReq = node.outputSchema.required ?? [];
    for (const prop of taskOutputReq) {
        if (!nodeOutputReq.includes(prop)) {
            errors.push({
                path: `${path}.outputSchema`,
                message:
                    `Task requires output "${prop}" but node ` +
                    `does not declare it as required.`,
            });
        }
    }

    const taskOutputProps = taskDef.outputSchema.properties ?? {};
    const nodeOutputProps = node.outputSchema.properties ?? {};

    // Node must not claim output properties the task does not produce,
    // unless the task's entire outputSchema is unconstrained.
    if (!isTopSchema(taskDef.outputSchema)) {
        for (const propName of Object.keys(nodeOutputProps)) {
            if (!(propName in taskOutputProps)) {
                errors.push({
                    path: `${path}.outputSchema`,
                    message:
                        `Node declares output property "${propName}" ` +
                        `but task does not produce it.`,
                });
            }
        }
    }

    // Type compatibility for output properties (skip top-schema properties).
    for (const [propName, taskPropDef] of Object.entries(taskOutputProps)) {
        if (typeof taskPropDef === "boolean" || isTopSchema(taskPropDef)) {
            continue;
        }
        const nodePropDef = nodeOutputProps[propName];
        if (
            nodePropDef === undefined ||
            typeof nodePropDef === "boolean" ||
            !nodePropDef.type ||
            !taskPropDef.type
        ) {
            continue;
        }
        const taskTypes = normalizeTypeSet(taskPropDef.type);
        const nodeTypes = normalizeTypeSet(nodePropDef.type);
        for (const nt of nodeTypes) {
            if (!taskTypes.some((tt) => typeAssignableTo(nt, tt))) {
                errors.push({
                    path: `${path}.outputSchema`,
                    message:
                        `Output property "${propName}": node declares ` +
                        `type "${nt}" but task only produces ` +
                        `${JSON.stringify(taskPropDef.type)}.`,
                });
            }
        }
    }
}

// ---- Pass: Reserved $-key check (§3.4) ----

const KNOWN_DOLLAR_KEYS = new Set(["$from", "$literal"]);

/**
 * Walk a template recursively and report any object that contains an
 * unrecognised $-prefixed key. Per §3.4, only "$from" and "$literal"
 * are legal; every other $-prefixed key is reserved for future engine use
 * and MUST be rejected.
 */
function checkReservedTemplateKeys(
    template: Template,
    templatePath: string,
    errors: ValidationError[],
): void {
    if (template === null || typeof template !== "object") return;
    if (Array.isArray(template)) {
        for (let i = 0; i < template.length; i++) {
            checkReservedTemplateKeys(
                template[i],
                `${templatePath}[${i}]`,
                errors,
            );
        }
        return;
    }
    const obj = template as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
        if (key.startsWith("$") && !KNOWN_DOLLAR_KEYS.has(key)) {
            errors.push({
                path: templatePath,
                message:
                    `Unknown $-prefixed key "${key}" in template. ` +
                    `Only "$from" and "$literal" are recognized by the engine; ` +
                    `all other $-prefixed keys are reserved (§3.4).`,
            });
            return; // one error per object is sufficient
        }
    }
    // Don't recurse into $from or $literal — they have their own semantics.
    if ("$from" in obj) {
        const from = obj["$from"];
        if (typeof from !== "string" || !VALID_FROM_NAMESPACES.has(from)) {
            errors.push({
                path: templatePath,
                message:
                    `Unknown $from namespace "${from}". ` +
                    `Valid namespaces are: input, constant, scope, state.`,
            });
        }
        return;
    }
    if ("$literal" in obj) return;
    for (const value of Object.values(obj)) {
        checkReservedTemplateKeys(value as Template, templatePath, errors);
    }
}

function validateScopeTemplates(
    nodes: Record<string, WorkflowNode>,
    prefix: string,
    errors: ValidationError[],
): void {
    for (const [id, node] of Object.entries(nodes)) {
        const path = `${prefix}.${id}`;
        switch (node.kind) {
            case "task":
                for (const [fieldName, tmpl] of Object.entries(node.inputs)) {
                    checkReservedTemplateKeys(
                        tmpl,
                        `${path}.inputs.${fieldName}`,
                        errors,
                    );
                }
                break;
            case "workflowCall":
                for (const [fieldName, tmpl] of Object.entries(node.inputs)) {
                    checkReservedTemplateKeys(
                        tmpl,
                        `${path}.inputs.${fieldName}`,
                        errors,
                    );
                }
                break;
            case "branch":
                checkReservedTemplateKeys(
                    node.selector,
                    `${path}.selector`,
                    errors,
                );
                for (const [label, arm] of Object.entries(node.cases)) {
                    validateBranchArmTemplates(
                        arm,
                        `${path}.cases.${label}`,
                        errors,
                    );
                }
                if (node.default !== undefined) {
                    validateBranchArmTemplates(
                        node.default,
                        `${path}.default`,
                        errors,
                    );
                }
                break;
            case "loop":
                for (const [fieldName, tmpl] of Object.entries(node.inputs)) {
                    checkReservedTemplateKeys(
                        tmpl,
                        `${path}.inputs.${fieldName}`,
                        errors,
                    );
                }
                checkReservedTemplateKeys(
                    node.body.output,
                    `${path}.body.output`,
                    errors,
                );
                for (const [name, tmpl] of Object.entries(node.iterateState)) {
                    checkReservedTemplateKeys(
                        tmpl,
                        `${path}.iterateState.${name}`,
                        errors,
                    );
                }
                validateScopeTemplates(
                    node.body.nodes,
                    `${path}.body.nodes`,
                    errors,
                );
                break;
            case "fork":
                for (const [bName, branch] of Object.entries(node.branches)) {
                    for (const [fieldName, tmpl] of Object.entries(
                        branch.inputs,
                    )) {
                        checkReservedTemplateKeys(
                            tmpl,
                            `${path}.branches.${bName}.inputs.${fieldName}`,
                            errors,
                        );
                    }
                    checkReservedTemplateKeys(
                        branch.scope.output,
                        `${path}.branches.${bName}.scope.output`,
                        errors,
                    );
                    validateScopeTemplates(
                        branch.scope.nodes,
                        `${path}.branches.${bName}.scope.nodes`,
                        errors,
                    );
                }
                break;
            case "forkMap":
                checkReservedTemplateKeys(
                    node.collection,
                    `${path}.collection`,
                    errors,
                );
                if (node.inputs) {
                    for (const [fieldName, tmpl] of Object.entries(
                        node.inputs,
                    )) {
                        checkReservedTemplateKeys(
                            tmpl,
                            `${path}.inputs.${fieldName}`,
                            errors,
                        );
                    }
                }
                checkReservedTemplateKeys(
                    node.body.output,
                    `${path}.body.output`,
                    errors,
                );
                validateScopeTemplates(
                    node.body.nodes,
                    `${path}.body.nodes`,
                    errors,
                );
                break;
            default:
                assertNever(node);
        }
    }
}

/**
 * Recurse template checks into a branch arm: arm `inputs` templates,
 * the arm scope's `output` template, and the arm scope's nodes.
 */
function validateBranchArmTemplates(
    arm: unknown,
    prefix: string,
    errors: ValidationError[],
): void {
    if (!arm || typeof arm !== "object") return;
    const armObj = arm as Record<string, unknown>;
    if (armObj.inputs && typeof armObj.inputs === "object") {
        for (const [fieldName, tmpl] of Object.entries(
            armObj.inputs as Record<string, Template>,
        )) {
            checkReservedTemplateKeys(
                tmpl,
                `${prefix}.inputs.${fieldName}`,
                errors,
            );
        }
    }
    const scope = armObj.scope as Record<string, unknown> | undefined;
    if (!scope || typeof scope !== "object") return;
    if (scope.output !== undefined) {
        checkReservedTemplateKeys(
            scope.output as Template,
            `${prefix}.scope.output`,
            errors,
        );
    }
    if (scope.nodes && typeof scope.nodes === "object") {
        validateScopeTemplates(
            scope.nodes as Record<string, WorkflowNode>,
            `${prefix}.scope.nodes`,
            errors,
        );
    }
}

/**
 * A reference extracted from a template expression (e.g. $from: "scope"
 * or $from: "state").
 */
interface TemplateRef {
    name: string;
    path: (string | number)[] | undefined;
    optional: boolean;
    templatePath: string;
}

/**
 * Walk a template and collect all $from references matching the given
 * namespace (e.g. "scope", "state", "input", "constant").
 */
function collectTemplateRefs(
    template: Template,
    templatePath: string,
    fromValue: string,
): TemplateRef[] {
    if (template === null || template === undefined) return [];
    if (typeof template !== "object") return [];
    if (Array.isArray(template)) {
        const refs: TemplateRef[] = [];
        for (let i = 0; i < template.length; i++) {
            refs.push(
                ...collectTemplateRefs(
                    template[i],
                    `${templatePath}[${i}]`,
                    fromValue,
                ),
            );
        }
        return refs;
    }

    const obj = template as Record<string, unknown>;
    if (obj["$from"] === fromValue) {
        return [
            {
                name: obj["name"] as string,
                path: obj["path"] as (string | number)[] | undefined,
                optional: obj["optional"] === true,
                templatePath,
            },
        ];
    }
    if ("$literal" in obj) return [];

    const refs: TemplateRef[] = [];
    for (const [key, value] of Object.entries(obj)) {
        refs.push(
            ...collectTemplateRefs(
                value as Template,
                `${templatePath}.${key}`,
                fromValue,
            ),
        );
    }
    return refs;
}

/**
 * Check scope refs in a template against a binding map, pushing
 * schema compatibility errors.
 */
function checkScopeRefsAgainstBindings(
    template: Template,
    templatePath: string,
    bindings: Map<string, JSONSchema>,
    errors: ValidationError[],
): void {
    const refs = collectTemplateRefs(template, templatePath, "scope");
    for (const ref of refs) {
        const producerSchema = bindings.get(ref.name);
        if (!producerSchema) continue;
        checkSchemaCompat(
            producerSchema,
            ref.path,
            ref.templatePath,
            `${ref.templatePath} ($from "scope", name "${ref.name}")`,
            errors,
        );
    }
}

/**
 * Validate schema compatibility within a scope: for each node that
 * references a scope binding, verify that the binding's producer
 * outputSchema declares the referenced path.
 */
function validateSchemaCompat(
    nodes: Record<string, WorkflowNode>,
    prefix: string,
    errors: ValidationError[],
): void {
    const bindings = buildBindingMap(nodes);

    for (const [id, node] of Object.entries(nodes)) {
        const path = `${prefix}.${id}`;

        // For loop nodes, check iterateState and output templates
        // against body-scope bindings.
        if (node.kind === "loop") {
            const bodyBindings = buildBindingMap(node.body.nodes);
            for (const [stateName, stateTemplate] of Object.entries(
                node.iterateState,
            )) {
                checkScopeRefsAgainstBindings(
                    stateTemplate,
                    `${path}.iterateState.${stateName}`,
                    bodyBindings,
                    errors,
                );
            }
            checkScopeRefsAgainstBindings(
                node.body.output,
                `${path}.body.output`,
                bodyBindings,
                errors,
            );
        }

        if (!hasInputs(node)) continue;

        const inputsPrefix = `${path}.inputs.`;
        const refs = collectTemplateRefs(
            node.inputs,
            `${path}.inputs`,
            "scope",
        );
        for (const ref of refs) {
            const producerSchema = bindings.get(ref.name);
            if (!producerSchema) {
                if (!ref.optional) {
                    errors.push({
                        path: ref.templatePath,
                        message:
                            `$from "scope", name "${ref.name}": no node in ` +
                            `this scope binds that name.`,
                    });
                }
                continue;
            }
            const consumerType = resolveConsumerPropertySchema(
                ref.templatePath,
                inputsPrefix,
                nodeInputSchema(node),
            )?.type;
            checkSchemaCompat(
                producerSchema,
                ref.path,
                ref.templatePath,
                `${ref.templatePath} ($from "scope", name "${ref.name}")`,
                errors,
                consumerType,
            );
        }
    }
}
