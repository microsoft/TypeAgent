// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    WorkflowIR,
    WorkflowBody,
    WorkflowScope,
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
    SchemaTemplate,
    isTypeParamRef,
} from "./ir.js";
import {
    TaskDefinition,
    isGenericTask,
    GenericTaskDefinition,
} from "./taskDefinition.js";

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

/** Valid namespaces for `$from` template refs. */
const FROM_NAMESPACES = [
    "input",
    "constant",
    "scope",
    "state",
    "recovery",
] as const;

type FromNamespace = (typeof FROM_NAMESPACES)[number];

const VALID_FROM_NAMESPACES = new Set<string>(FROM_NAMESPACES);

/** Schema for the engine-injected error object in the recovery namespace. */
const RECOVERY_ERROR_SCHEMA: JSONSchema = {
    type: "object",
    properties: {
        kind: { type: "string" },
        message: { type: "string" },
        source: { type: "string" },
        task: { type: "string" },
        node: { type: "string" },
        scopePath: { type: "array", items: { type: "string" } },
    },
    required: ["kind", "message", "source", "task", "node", "scopePath"],
};

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
 * - WorkflowCallNode: ref resolution and schema match.
 * - Workflow call graph: acyclic call graph.
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
                checkStructuralSubtype(
                    valueSchema,
                    def.schema,
                    `constants.${name}`,
                    errors,
                    "Constant value",
                    "declared schema",
                );
            }
        }
    }

    const callGraph = new Map<string, Set<string>>();

    // Validate each workflow body and collect workflow call graph edges.
    for (const [wfName, body] of Object.entries(ir.workflows)) {
        const callees = validateWorkflowBody(ir, wfName, body, tasks, errors);
        callGraph.set(wfName, callees);
    }

    // Validate the workflow call graph after all bodies have recorded callees.
    validateWorkflowCallGraph(callGraph, errors);

    return { valid: errors.length === 0, errors };
}

/**
 * Validate a single workflow body within an IR artifact.
 *
 * Each body is validated as a self-contained scope (entry, nodes, output,
 * schemas). WorkflowCallNode validation records callee edges in the returned
 * set so the caller can perform graph-level checks without walking again.
 */
function validateWorkflowBody(
    ir: WorkflowIR,
    wfName: string,
    body: WorkflowBody,
    tasks: ReadonlyMap<string, TaskDefinition> | undefined,
    errors: ValidationError[],
): Set<string> {
    const basePath = `workflows.${wfName}`;
    const workflowCallees = new Set<string>();

    if (!(body.entry in body.nodes)) {
        errors.push({
            path: `${basePath}.entry`,
            message: `Entry node "${body.entry}" does not exist in workflow "${wfName}".`,
        });
    }

    const ambientCtx: ScopeAmbientContext = {
        constants: ir.constants,
        stateVars: undefined,
    };
    const workflowCallCtx: WorkflowCallContext = {
        workflows: ir.workflows,
        callees: workflowCallees,
    };
    validateScope(body, basePath, tasks, ambientCtx, workflowCallCtx, errors);
    return workflowCallees;
}

/**
 * Validate the workflow call graph across the IR.
 *
 * Checks:
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

function validateWorkflowCallGraph(
    callGraph: Map<string, Set<string>>,
    errors: ValidationError[],
): void {
    const cycle = findCallGraphCycle(callGraph);
    if (cycle) {
        errors.push({
            path: "workflows",
            message: `Workflow call graph contains a cycle: ${cycle.join(" -> ")}. Recursion is not supported in IR v1.`,
        });
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
    const unreachable = checkTermination(cfg);
    for (const id of unreachable) {
        errors.push({
            path: `${prefix}.${id}`,
            message: `Node "${id}" cannot reach a terminal node.`,
        });
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
                // Rule 2: single trigger
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

        // Recovery target must be a task node. If it isn't, Rule 4
        // (no recursive recovery) doesn't apply, so skip it.
        if (targetNode.kind !== "task") {
            errors.push({
                path: `${prefix}.${trigger}.onError`,
                message:
                    `Recovery target "${target}" must be a task node ` +
                    `(got "${targetNode.kind}").`,
            });
            continue;
        }

        // Rule 4: no recursive recovery.
        if (targetNode.onError) {
            errors.push({
                path: `${prefix}.${target}.onError`,
                message:
                    `Recovery node "${target}" must not itself declare ` +
                    `onError. Recursive recovery chains are not ` +
                    `allowed in v1.`,
            });
        }
    }

    // Rule 5: $from "recovery" refs must only appear in onError target nodes,
    // and only "error" and "trigger" are valid names in that namespace.
    // Path existence is checked by walkTemplateAndComputeType during the
    // normal per-node validation pass.
    const VALID_RECOVERY_NAMES = new Set(["error", "trigger"]);
    for (const [id, node] of Object.entries(nodes)) {
        if (!hasInputs(node)) continue;
        const recoveryRefs = collectTemplateRefs(
            node.inputs,
            `${prefix}.${id}.inputs`,
            "recovery",
        );
        if (recoveryRefs.length === 0) continue;
        if (!onErrorTargetToTrigger.has(id)) {
            errors.push({
                path: `${prefix}.${id}.inputs`,
                message:
                    `Node "${id}" uses $from "recovery" but is not an ` +
                    `onError target. The "recovery" namespace is only ` +
                    `available in nodes reached via onError dispatch.`,
            });
            continue;
        }
        for (const ref of recoveryRefs) {
            if (!VALID_RECOVERY_NAMES.has(ref.name)) {
                errors.push({
                    path: ref.templatePath,
                    message:
                        `$from "recovery", name "${ref.name}": only ` +
                        `"error" and "trigger" are valid recovery names.`,
                });
            } else if (ref.name === "trigger") {
                // Validate that the trigger node kind supports the "trigger" ref.
                // Path existence is checked by the template walk.
                const triggerId = onErrorTargetToTrigger.get(id);
                const triggerNode = triggerId ? nodes[triggerId] : undefined;
                const schema = triggerNode
                    ? triggerInputSchema(triggerNode)
                    : undefined;
                if (!schema) {
                    const triggerKind = triggerNode
                        ? triggerNode.kind
                        : "unknown";
                    errors.push({
                        path: ref.templatePath,
                        message:
                            `$from "recovery", name "trigger": the trigger ` +
                            `node is a ${triggerKind} which has no ` +
                            `resolved-inputs schema. "trigger" is only ` +
                            `available when the trigger is a task, ` +
                            `workflowCall, loop, or forkMap.`,
                    });
                }
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
    bodyPrefix: string,
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

    // Body-node state ref name/path/type checks are now handled by
    // walkTemplateAndComputeType when validateScope processes the loop body.
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
    ambientCtx: ScopeAmbientContext,
    workflowCallCtx: WorkflowCallContext,
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
    validateScope(
        scope,
        `${armPath}.scope`,
        tasks,
        withAmbientContext(ambientCtx, {
            stateVars: undefined,
            stateNamespaceUnavailableMessage: (name) =>
                `$from "state", name "${name}": branch arm nodes ` +
                `have no state namespace. Thread state values through ` +
                `arm.inputs instead.`,
        }),
        workflowCallCtx,
        errors,
    );
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
    state: ScopeValidationState,
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
    for (const [id, node] of Object.entries(nodes)) {
        const path = `${prefix}.${id}`;
        state.templateCtx.recoveryTriggerInputSchema =
            state.recoveryTriggerSchemas.get(id) ?? undefined;
        switch (node.kind) {
            case "task":
                validateTaskNode(node, path, state);
                break;
            case "branch":
                validateBranchNode(node, path, state);
                break;
            case "loop":
                validateLoopNode(node, path, state);
                break;
            case "fork":
                validateForkNode(node, path, state);
                break;
            case "forkMap":
                validateForkMapNode(node, path, state);
                break;
            case "workflowCall":
                validateWorkflowCallNode(node, path, state);
                break;
            default:
                assertNever(node);
        }
    }
}

/**
 * Per-node template checks for a single node using the single-pass walk.
 * For each template expression the walk simultaneously validates syntax,
 * checks $from ref name and path existence, and computes the type.
 * If the computed type is available after the walk, it is compared to the
 * declared consumer schema (after-walk schema validation).
 *
 * Sub-scope recursion is NOT done here — it happens via the per-node
 * structural validators calling validateScope for sub-scopes.
 *
 * Loop-body templates (continueWhen, iterateState) need the body-scope
 * TemplateResolutionContext and are handled in validateLoopNode after the body
 * scope is established.
 */
function validateNodeInputTemplates(
    node: TaskNode | LoopNode | WorkflowCallNode,
    path: string,
    templateCtx: TemplateResolutionContext,
    errors: ValidationError[],
): void {
    validateInputObjectTemplates(
        node.inputs,
        `${path}.inputs`,
        nodeInputSchema(node),
        templateCtx,
        errors,
    );
}

function validateBranchNodeTemplates(
    node: BranchNode,
    path: string,
    templateCtx: TemplateResolutionContext,
    errors: ValidationError[],
): void {
    const selectorType = walkTemplateAndComputeType(
        node.selector,
        `${path}.selector`,
        templateCtx,
        errors,
    );
    if (selectorType) {
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
        checkResolvedAssignability(
            selectorType,
            node.selectorSchema,
            `${path}.selector`,
            errors,
            "Selector resolved type",
            "selectorSchema",
        );
    }

    // Check cases keys against selectorSchema enum.
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

    // Exhaustiveness: when `default` is omitted, every enum value needs a case.
    if (node.default === undefined) {
        const isBooleanSelector =
            node.selectorSchema.type === "boolean" && !node.selectorSchema.enum;
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

    // Walk arm.inputs with the outer template context so $from refs are validated.
    const arms: Array<[string, BranchArm]> = [
        ...Object.entries(node.cases),
        ...(node.default
            ? [["default", node.default] as [string, BranchArm]]
            : []),
    ];
    for (const [armKey, arm] of arms) {
        validateInputObjectTemplates(
            arm.inputs,
            `${path}.cases.${armKey}.inputs`,
            arm.scope.inputSchema,
            templateCtx,
            errors,
        );
    }
}

function validateForkNodeTemplates(
    node: ForkNode,
    path: string,
    templateCtx: TemplateResolutionContext,
    errors: ValidationError[],
): void {
    for (const [bName, branch] of Object.entries(node.branches)) {
        validateInputObjectTemplates(
            branch.inputs,
            `${path}.branches.${bName}.inputs`,
            branch.scope.inputSchema,
            templateCtx,
            errors,
        );
    }
}

function validateForkMapNodeTemplates(
    node: ForkMapNode,
    path: string,
    templateCtx: TemplateResolutionContext,
    errors: ValidationError[],
): void {
    const collectionType = walkTemplateAndComputeType(
        node.collection,
        `${path}.collection`,
        templateCtx,
        errors,
    );
    if (collectionType !== undefined && node.collectionSchema) {
        checkResolvedAssignability(
            collectionType,
            node.collectionSchema,
            `${path}.collection`,
            errors,
            "Resolved collection",
            "collectionSchema",
        );
    }
    if (node.inputs) {
        validateInputObjectTemplates(
            node.inputs,
            `${path}.inputs`,
            node.body.inputSchema,
            templateCtx,
            errors,
        );
    }
}

function validateInputObjectTemplates(
    inputs: Record<string, Template>,
    inputsPath: string,
    inputSchema: JSONSchema,
    templateCtx: TemplateResolutionContext,
    errors: ValidationError[],
): void {
    for (const [fieldName, tmpl] of Object.entries(inputs)) {
        const templatePath = `${inputsPath}.${fieldName}`;
        const computed = walkTemplateAndComputeType(
            tmpl,
            templatePath,
            templateCtx,
            errors,
        );
        if (computed === undefined) continue;

        const consumerPropDef = inputSchema.properties?.[fieldName];
        if (!consumerPropDef || typeof consumerPropDef === "boolean") {
            continue;
        }
        checkResolvedAssignability(
            computed,
            consumerPropDef,
            templatePath,
            errors,
            "Resolved input",
            "expected",
        );
    }
}

function validateWorkflowCallNode(
    node: WorkflowCallNode,
    path: string,
    state: ScopeValidationState,
): void {
    const { nodeIds, workflowCallCtx, templateCtx, errors } = state;
    const refName = node.workflowRef?.name;
    if (typeof refName !== "string" || refName.length === 0) {
        errors.push({
            path: `${path}.workflowRef.name`,
            message: `Missing or invalid workflow reference name.`,
        });
    } else {
        workflowCallCtx.callees.add(refName);
        const source = node.workflowRef.source ?? "bundle";
        if (source !== "bundle") {
            errors.push({
                path: `${path}.workflowRef.source`,
                message: `Unsupported workflow reference source "${source}". Only "bundle" is supported in IR v1.`,
            });
        } else {
            const target = workflowCallCtx.workflows[refName];
            if (!target) {
                errors.push({
                    path: `${path}.workflowRef.name`,
                    message: `Workflow "${refName}" not found in workflows table.`,
                });
            } else {
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
            }
        }
    }
    checkNeverOutputControlFlow(
        node.outputSchema,
        node.workflowRef?.name
            ? `Workflow call "${node.workflowRef.name}"`
            : "Workflow call",
        node,
        path,
        errors,
    );
    validateNodeInputTemplates(node, path, templateCtx, errors);
    checkBindableTargets(nodeIds, node, path, errors);
}

function validateTaskNode(
    node: TaskNode,
    path: string,
    state: ScopeValidationState,
): void {
    const { nodeIds, tasks, templateCtx, errors } = state;
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
    checkNeverOutputControlFlow(
        node.outputSchema,
        `Task "${node.task}"`,
        node,
        path,
        errors,
    );
    validateNodeInputTemplates(node, path, templateCtx, errors);
    checkBindableTargets(nodeIds, node, path, errors);
}

function validateBranchNode(
    node: BranchNode,
    path: string,
    state: ScopeValidationState,
): void {
    const { nodeIds, tasks, ambientCtx, templateCtx, errors } = state;
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
        validateBranchArm(
            arm,
            `${path}.cases.${label}`,
            tasks,
            ambientCtx,
            state.workflowCallCtx,
            errors,
        );
    }
    if (node.default !== undefined) {
        validateBranchArm(
            node.default,
            `${path}.default`,
            tasks,
            ambientCtx,
            state.workflowCallCtx,
            errors,
        );
    }
    validateBranchNodeTemplates(node, path, templateCtx, errors);
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
    state: ScopeValidationState,
): void {
    const { nodeIds, outerNodes, tasks, ambientCtx, templateCtx, errors } =
        state;
    if (!(node.body.entry in node.body.nodes)) {
        errors.push({
            path: `${path}.body.entry`,
            message: `Body entry "${node.body.entry}" does not exist.`,
        });
    }
    const bodyPrefix = `${path}.body.nodes`;

    // Pass 5: Scope closure — body nodes must not reach outer-scope bindings.
    checkScopeClosure(node, bodyPrefix, outerNodes, errors);

    // Pass 11: State soundness — state vars and iterateState must align.
    checkStateSoundness(node, path, errors);

    const bodyBindings = validateScope(
        node.body,
        `${path}.body`,
        tasks,
        withAmbientContext(ambientCtx, {
            stateVars: node.state,
        }),
        state.workflowCallCtx,
        errors,
    );

    // Build a body-scope TemplateResolutionContext for templates evaluated in the
    // body context (continueWhen, iterateState). These templates reference body
    // bindings for $from:"scope" and body.inputSchema for $from:"input".
    const bodyTemplateCtx = createTemplateResolutionContext(
        node.body,
        bodyBindings,
        withAmbientContext(ambientCtx, {
            stateVars: node.state,
        }),
    );

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
        // Single-pass walk: validates syntax, name/path existence, and
        // computes the type — using the body scope context.
        walkTemplateAndComputeType(
            node.continueWhen,
            `${path}.continueWhen`,
            bodyTemplateCtx,
            errors,
        );
    }

    // iterateState templates are evaluated in the body scope.
    for (const [stateName, stateTemplate] of Object.entries(
        node.iterateState,
    )) {
        walkTemplateAndComputeType(
            stateTemplate,
            `${path}.iterateState.${stateName}`,
            bodyTemplateCtx,
            errors,
        );
    }

    checkPositiveIntegerField(
        node.maxIterations,
        path,
        "maxIterations",
        errors,
    );
    validateNodeInputTemplates(node, path, templateCtx, errors);
    checkBindableTargets(nodeIds, node, path, errors);
}

function validateForkNode(
    node: ForkNode,
    path: string,
    state: ScopeValidationState,
): void {
    const { nodeIds, tasks, ambientCtx, templateCtx, errors } = state;
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
        validateScope(
            branch.scope,
            `${path}.branches.${bName}.scope`,
            tasks,
            withAmbientContext(ambientCtx, {
                stateVars: undefined,
            }),
            state.workflowCallCtx,
            errors,
        );
    }
    validateForkNodeTemplates(node, path, templateCtx, errors);
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
    state: ScopeValidationState,
): void {
    const { nodeIds, tasks, ambientCtx, templateCtx, errors } = state;
    if (!normalizeTypeSet(node.collectionSchema?.type).includes("array")) {
        errors.push({
            path: `${path}.collectionSchema`,
            message: `forkMap collectionSchema must be type "array".`,
        });
    }
    // Validate collection item schema against the body input element parameter.
    const itemSchema = node.collectionSchema?.items;
    if (
        itemSchema &&
        typeof itemSchema !== "boolean" &&
        !Array.isArray(itemSchema) &&
        node.elementParam &&
        !isEmptySchema(node.body.inputSchema)
    ) {
        const bodyProp = node.body.inputSchema?.properties?.[node.elementParam];
        if (bodyProp && typeof bodyProp !== "boolean") {
            checkStructuralSubtype(
                itemSchema,
                bodyProp,
                `${path}.body.inputSchema.properties.${node.elementParam}`,
                errors,
                "collection element",
                "body elementParam",
            );
        }
    }
    if (!(node.body.entry in node.body.nodes)) {
        errors.push({
            path: `${path}.body.entry`,
            message: `Body entry "${node.body.entry}" does not exist.`,
        });
    }
    validateScope(
        node.body,
        `${path}.body`,
        tasks,
        withAmbientContext(ambientCtx, {
            stateVars: undefined,
            stateNamespaceUnavailableMessage: (name) =>
                `$from "state", name "${name}": forkMap body nodes ` +
                `have no state namespace. Pass state values through ` +
                `forkMap inputs or body input instead.`,
        }),
        state.workflowCallCtx,
        errors,
    );
    validateForkMapNodeTemplates(node, path, templateCtx, errors);
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
    checkStructuralSubtype(
        armOutput,
        branchOutputSchema,
        `${armPath}.scope.outputSchema`,
        errors,
        `${armLabel} outputSchema`,
        "branch outputSchema",
    );
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
            const outputSchema = nodeOutputSchema(node);
            if (outputSchema) {
                map.set(node.bind, outputSchema);
            }
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
): JSONSchema | undefined {
    if (node.kind === "loop") return node.body.outputSchema;
    if (node.kind === "branch") return node.outputSchema;
    return node.outputSchema;
}

/**
 * Get the schema of the "trigger" recovery value for a node that declares
 * onError. At runtime this is the resolved inputs object the engine built
 * for the failed node.
 *
 * Returns undefined for node kinds that have no meaningful inputs object
 * (fork, branch) since those don't produce a single resolved-inputs value.
 */
function triggerInputSchema(node: WorkflowNode): JSONSchema | undefined {
    switch (node.kind) {
        case "task":
        case "workflowCall":
            return node.inputSchema;
        case "loop":
        case "forkMap":
            return node.body.inputSchema;
        case "fork":
        case "branch":
            // Fork/branch don't have a single resolved-inputs object.
            return undefined;
        default:
            assertNever(node);
    }
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

function checkNeverOutputControlFlow(
    outputSchema: JSONSchema,
    label: string,
    node: { next?: string; bind?: string; onError?: string },
    path: string,
    errors: ValidationError[],
): void {
    if (!isNeverSchema(outputSchema)) return;
    if (node.next) {
        errors.push({
            path: `${path}.next`,
            message: `${label} has outputSchema { "not": {} } (never) and must not have "next".`,
        });
    }
    if (node.bind) {
        errors.push({
            path: `${path}.bind`,
            message: `${label} has outputSchema { "not": {} } (never) and must not have "bind".`,
        });
    }
    if (node.onError) {
        errors.push({
            path: `${path}.onError`,
            message: `${label} has outputSchema { "not": {} } (never) and must not have "onError".`,
        });
    }
}

/**
 * Validate a scope's nodes (structural + schema-compat + CFG).
 * Returns the binding map built during validation so callers can
 * reuse it without a second traversal.
 *
 * `entry`, `outputTemplate`, and `outputPrefix` are forwarded to
 * `validateScopeCFG`; omit them only when CFG validation is not
 * needed (e.g. branch arm structural pre-check before entry is verified).
 */
function validateScope(
    scope: WorkflowScope,
    basePath: string,
    tasks: ReadonlyMap<string, TaskDefinition> | undefined,
    ambientCtx: ScopeAmbientContext,
    workflowCallCtx: WorkflowCallContext,
    errors: ValidationError[],
): Map<string, JSONSchema> {
    const prefix = `${basePath}.nodes`;
    const bindings = buildBindingMap(scope.nodes);

    // Pre-pass: build recovery trigger schemas for TemplateResolutionContext.
    const recoveryTriggerSchemas = new Map<string, JSONSchema>();
    for (const node of Object.values(scope.nodes)) {
        if (isBindableNode(node) && node.onError) {
            const schema = triggerInputSchema(node);
            if (schema) {
                recoveryTriggerSchemas.set(node.onError, schema);
            }
        }
    }

    const templateCtx = createTemplateResolutionContext(
        scope,
        bindings,
        ambientCtx,
    );

    validateScopeNodes(scope.nodes, prefix, {
        nodeIds: new Set(Object.keys(scope.nodes)),
        outerNodes: scope.nodes,
        tasks,
        ambientCtx,
        workflowCallCtx,
        templateCtx,
        recoveryTriggerSchemas,
        errors,
    });
    validateScopeCFG(
        scope.nodes,
        scope.entry,
        prefix,
        errors,
        scope.output,
        `${basePath}.output`,
    );

    // Scope-level output template: single-pass walk (syntax + ref checks + type),
    // then after-walk comparison against declared outputSchema.
    if (scope.output) {
        const outputResolved = walkTemplateAndComputeType(
            scope.output,
            `${basePath}.output`,
            templateCtx,
            errors,
        );
        if (outputResolved && scope.outputSchema) {
            checkResolvedAssignability(
                outputResolved,
                scope.outputSchema,
                `${basePath}.output`,
                errors,
                "Output resolved type",
                "outputSchema",
            );
        }
    }

    return bindings;
}

function createTemplateResolutionContext(
    scope: WorkflowScope,
    bindings: Map<string, JSONSchema>,
    ambientCtx: ScopeAmbientContext,
): TemplateResolutionContext {
    const templateCtx: TemplateResolutionContext = {
        bindings,
        inputSchema: scope.inputSchema,
        stateVars: ambientCtx.stateVars,
        constants: ambientCtx.constants,
        recoveryTriggerInputSchema: undefined,
    };
    if (ambientCtx.stateNamespaceUnavailableMessage) {
        templateCtx.stateNamespaceUnavailableMessage =
            ambientCtx.stateNamespaceUnavailableMessage;
    }
    return templateCtx;
}

function withAmbientContext(
    ambientCtx: ScopeAmbientContext,
    overrides: Pick<
        ScopeAmbientContext,
        "stateVars" | "stateNamespaceUnavailableMessage"
    >,
): ScopeAmbientContext {
    const childCtx: ScopeAmbientContext = {
        constants: ambientCtx.constants,
        stateVars: overrides.stateVars,
    };
    if (overrides.stateNamespaceUnavailableMessage) {
        childCtx.stateNamespaceUnavailableMessage =
            overrides.stateNamespaceUnavailableMessage;
    }
    return childCtx;
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

/**
 * Returns true when a schema is `{}` (empty object: no constraints).
 *
 * In JSON Schema, `{}` is the **top type** — it accepts every value —
 * which the DSL/IR uses as the "unknown" marker for schema-less
 * positions (cf. Decision 0011: bound producers may carry `{}` but the
 * resulting value is opaque — only consumers whose expected schema is
 * also `{}` may read it).
 */
function isEmptySchema(schema: JSONSchema): boolean {
    return Object.keys(schema).length === 0;
}

/**
 * Validate a resolved template schema against a consumer slot.
 * Unknown producer schemas get the stricter Decision 0011 check before
 * falling back to the general structural subtype comparison.
 */
function checkResolvedAssignability(
    producer: JSONSchema,
    consumer: JSONSchema,
    path: string,
    errors: ValidationError[],
    producerLabel: string,
    consumerLabel: string,
): void {
    if (
        checkUnknownAssignability(
            producer,
            consumer,
            path,
            errors,
            producerLabel,
            consumerLabel,
        )
    ) {
        return;
    }
    checkStructuralSubtype(
        producer,
        consumer,
        path,
        errors,
        producerLabel,
        consumerLabel,
    );
}

/**
 * Decision 0011 enforcement at template-resolution sites: if a template
 * reference resolves to a `{}` (unknown) producer schema and the consumer
 * slot has a concrete schema, push an error. This is the consumer-side
 * counterpart to allowing `{}` on bound producers — the unknown value is
 * opaque, so reading it as a typed value is unsound.
 *
 * Only call this at sites where the producer schema came from resolving
 * a `$from` template reference (not from task/node definition compat,
 * where a `{}` task schema legitimately means "anything goes").
 *
 * Returns true if an error was pushed.
 */
function checkUnknownAssignability(
    producer: JSONSchema,
    consumer: JSONSchema,
    path: string,
    errors: ValidationError[],
    producerLabel: string,
    consumerLabel: string,
): boolean {
    if (!isEmptySchema(producer)) return false;
    if (isEmptySchema(consumer)) return false;
    errors.push({
        path,
        message:
            `${producerLabel} resolves to {} (unknown); not assignable to ` +
            `${consumerLabel} ${formatSchemaType(consumer)}. ` +
            `Only consumers that accept unknown (schema {}) may read ` +
            `from an unknown producer.`,
    });
    return true;
}

/**
 * Infer the `.type` of a schema from structural cues when `.type` is absent.
 * Returns a new schema with `.type` added if inferable, or the original if not.
 *
 * Note: only object (via `properties`/`required`/`additionalProperties`)
 * and array (via `items`) are inferred. Primitive validation keywords
 * (`minLength`, `minimum`, `pattern`, etc.) are intentionally NOT used
 * to infer type — they are ambiguous (e.g., `minLength` could apply to
 * strings or arrays in legacy JSON Schema) and inferring here would
 * mask malformed schemas that omit `type` by accident. Authors that
 * want primitive constraints must spell `type` explicitly.
 */
function inferSchemaType(schema: JSONSchema): JSONSchema {
    if (schema.type) return schema;
    if (schema.properties || schema.required || schema.additionalProperties) {
        return { ...schema, type: "object" };
    }
    if (schema.items) {
        return { ...schema, type: "array" };
    }
    return schema;
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

// ---- Pass 7: Type compatibility ----

/** Ambient data carried when validateScope recurses into child scopes. */
interface ScopeAmbientContext {
    /** IR-level constant definitions, for $from:"constant" ref checks. */
    constants: Record<string, ConstantDef> | undefined;
    /** Loop state variable declarations (only set when validating a loop body). */
    stateVars: Record<string, LoopStateVar> | undefined;
    /** Custom diagnostic for scopes that structurally disallow $from:"state". */
    stateNamespaceUnavailableMessage?: (name: string) => string;
}

interface WorkflowCallContext {
    /** Bundle-local workflows, for workflowCall ref checks. */
    workflows: Record<string, WorkflowBody>;
    /** Callees recorded while validating the current workflow body. */
    callees: Set<string>;
}

/** Derived context used by the template walker to resolve `$from` refs. */
interface TemplateResolutionContext {
    bindings: Map<string, JSONSchema>;
    inputSchema: JSONSchema | undefined;
    stateVars: Record<string, LoopStateVar> | undefined;
    constants: Record<string, ConstantDef> | undefined;
    /** When resolving inside an onError target, the trigger's inputSchema. */
    recoveryTriggerInputSchema: JSONSchema | undefined;
    /** Custom diagnostic for scopes that structurally disallow $from:"state". */
    stateNamespaceUnavailableMessage?: (name: string) => string;
}

interface ScopeValidationState {
    nodeIds: Set<string>;
    outerNodes: Record<string, WorkflowNode>;
    tasks: ReadonlyMap<string, TaskDefinition> | undefined;
    ambientCtx: ScopeAmbientContext;
    workflowCallCtx: WorkflowCallContext;
    templateCtx: TemplateResolutionContext;
    recoveryTriggerSchemas: Map<string, JSONSchema>;
    errors: ValidationError[];
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

const KNOWN_DOLLAR_KEYS = new Set(["$from", "$literal"]);

/**
 * Single-pass template walk: validates syntax, checks $from ref name and path
 * existence, and computes the resolved JSON Schema type.
 *
 * This fuses what were previously four separate passes:
 *   1. Reserved $-key syntax check (§3.4)
 *   2. $from namespace validity
 *   3. Name existence + path validity for input/constant/scope/state refs
 *   4. Type computation
 *
 * Recovery refs (name validity, path checks) are handled separately by
 * validateOnErrorRules, which has the structural context to know whether
 * a node is an onError target. The walk here only computes the type for
 * recovery refs without re-checking their structural rules.
 *
 * @returns The computed JSON Schema, or undefined if the type cannot be
 *          determined (unresolvable ref or earlier error in this walk).
 */
function walkTemplateAndComputeType(
    template: Template,
    templatePath: string,
    templateCtx: TemplateResolutionContext,
    errors: ValidationError[],
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
        const elemSchemas: JSONSchema[] = [];
        for (let i = 0; i < template.length; i++) {
            const elem = walkTemplateAndComputeType(
                template[i],
                `${templatePath}[${i}]`,
                templateCtx,
                errors,
            );
            if (elem !== undefined) elemSchemas.push(elem);
        }
        return buildArraySchema(elemSchemas);
    }

    const obj = template as Record<string, unknown>;

    // ---- Syntax: reserved $-key check (§3.4) ----
    for (const key of Object.keys(obj)) {
        if (key.startsWith("$") && !KNOWN_DOLLAR_KEYS.has(key)) {
            errors.push({
                path: templatePath,
                message:
                    `Unknown $-prefixed key "${key}" in template. ` +
                    `Only "$from" and "$literal" are recognized by the engine; ` +
                    `all other $-prefixed keys are reserved (§3.4).`,
            });
            return undefined;
        }
    }

    // ---- $from reference ----
    if ("$from" in obj) {
        const from = obj["$from"];
        if (typeof from !== "string" || !VALID_FROM_NAMESPACES.has(from)) {
            errors.push({
                path: templatePath,
                message:
                    `Unknown $from namespace "${from}". ` +
                    `Valid namespaces are: input, constant, scope, state, recovery.`,
            });
            return undefined;
        }

        const name = obj["name"] as string;
        const path = obj["path"] as (string | number)[] | undefined;
        const optional = obj["optional"] === true;

        let baseSchema: JSONSchema | undefined;

        switch (from as FromNamespace) {
            case "input": {
                // Empty name is the emitter convention for "entire scope input".
                if (name === "") break;
                const inputProps = templateCtx.inputSchema?.properties;
                if (!inputProps || !(name in inputProps)) {
                    if (!optional) {
                        errors.push({
                            path: templatePath,
                            message:
                                `$from "input", name "${name}": ` +
                                `not declared in scope inputSchema.`,
                        });
                    }
                    return undefined;
                }
                const prop = inputProps[name];
                if (typeof prop !== "boolean") baseSchema = prop;
                break;
            }
            case "constant": {
                if (
                    !templateCtx.constants ||
                    !(name in templateCtx.constants)
                ) {
                    if (!optional) {
                        errors.push({
                            path: templatePath,
                            message:
                                `$from "constant", name "${name}": ` +
                                `not declared in ir.constants.`,
                        });
                    }
                    return undefined;
                }
                baseSchema = templateCtx.constants[name]?.schema;
                break;
            }
            case "scope": {
                baseSchema = templateCtx.bindings.get(name);
                if (!baseSchema) {
                    if (!optional) {
                        errors.push({
                            path: templatePath,
                            message:
                                `$from "scope", name "${name}": no node in ` +
                                `this scope binds that name.`,
                        });
                    }
                    return undefined;
                }
                break;
            }
            case "state": {
                if (!templateCtx.stateVars) {
                    errors.push({
                        path: templatePath,
                        message:
                            templateCtx.stateNamespaceUnavailableMessage?.(
                                name,
                            ) ??
                            `$from "state", name "${name}": no state ` +
                                `namespace is available in this scope. ` +
                                `State references are only available in ` +
                                `loop body templates.`,
                    });
                    return undefined;
                }
                if (!(name in templateCtx.stateVars)) {
                    if (!optional) {
                        errors.push({
                            path: templatePath,
                            message:
                                `$from "state", name "${name}": no state ` +
                                `variable "${name}" is declared on this loop.`,
                        });
                    }
                    return undefined;
                }
                baseSchema = templateCtx.stateVars[name].schema;
                break;
            }
            case "recovery": {
                // Name validity and "must be onError target" are checked by
                // validateOnErrorRules; here we just resolve the type.
                if (name === "error") {
                    baseSchema = RECOVERY_ERROR_SCHEMA;
                } else if (name === "trigger") {
                    baseSchema = templateCtx.recoveryTriggerInputSchema;
                }
                break;
            }
            default:
                assertNever(from as never);
        }

        if (!baseSchema) return undefined;

        // ---- Path existence + type projection ----
        if (path && path.length > 0) {
            const resolved = resolveSchemaPath(baseSchema, path);
            if (resolved === undefined) {
                errors.push({
                    path: templatePath,
                    message: `${templatePath} ($from "${from}", name "${name}"): path ${JSON.stringify(path)} not declared in producer outputSchema`,
                });
                return undefined;
            }
            return resolved;
        }
        return baseSchema;
    }

    // ---- $literal ----
    if ("$literal" in obj) {
        return jsonValueToSchema(obj["$literal"]);
    }

    // ---- Plain object: property-wise composition ----
    const properties: Record<string, JSONSchema> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(obj)) {
        const propType = walkTemplateAndComputeType(
            value as Template,
            `${templatePath}.${key}`,
            templateCtx,
            errors,
        );
        if (propType !== undefined) {
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
 * Diagnostic structural subtype check per section 4.2.
 * Pushes path-qualified errors explaining why producer P is not compatible
 * with consumer C. Returns nothing; check errors.length to determine pass/fail.
 */
export function checkStructuralSubtype(
    producer: JSONSchema,
    consumer: JSONSchema,
    path: string,
    errors: ValidationError[],
    producerLabel: string = "Producer",
    consumerLabel: string = "consumer",
): void {
    if (isEmptySchema(consumer)) return;
    if (isEmptySchema(producer) && !isEmptySchema(consumer)) {
        // Producer is unconstrained; can't prove it's a subtype of
        // a constrained consumer. Be lenient: skip.
        // (Decision 0011: the stricter "unknown is not assignable to T"
        // rule is enforced narrowly at template-resolution sites \u2014 see
        // checkUnknownAssignability \u2014 rather than here, because this
        // helper is also used for task-vs-node schema compatibility where
        // a `{}` task schema legitimately means "task accepts anything".)
        return;
    }

    // Handle union types (anyOf, oneOf) per section 4.2:
    // "P compatible iff every variant of P compatible with some variant of C".
    const producerVariants = producer.anyOf ?? producer.oneOf;
    const consumerVariants = consumer.anyOf ?? consumer.oneOf;

    if (producerVariants) {
        for (let i = 0; i < producerVariants.length; i++) {
            const v = producerVariants[i];
            if (typeof v === "boolean") {
                errors.push({
                    path,
                    message: `${producerLabel} union variant [${i}] is a boolean schema.`,
                });
                continue;
            }
            if (consumerVariants) {
                const compatible = consumerVariants.some(
                    (cv) =>
                        typeof cv !== "boolean" && isStructuralSubtype(v, cv),
                );
                if (!compatible) {
                    errors.push({
                        path,
                        message:
                            `${producerLabel} union variant [${i}] ` +
                            `(${formatSchemaType(v)}) is not assignable to ` +
                            `any ${consumerLabel} variant.`,
                    });
                }
            } else {
                checkStructuralSubtype(
                    v,
                    consumer,
                    `${path}[${i}]`,
                    errors,
                    `${producerLabel} variant [${i}]`,
                    consumerLabel,
                );
            }
        }
        return;
    }

    if (consumerVariants) {
        const compatible = consumerVariants.some(
            (v) => typeof v !== "boolean" && isStructuralSubtype(producer, v),
        );
        if (!compatible) {
            errors.push({
                path,
                message:
                    `${producerLabel} type ${formatSchemaType(producer)} is ` +
                    `not assignable to any ${consumerLabel} union variant.`,
            });
        }
        return;
    }

    // Const / enum narrowing checks.
    if (consumer.const !== undefined) {
        if (producer.const !== undefined) {
            if (producer.const !== consumer.const) {
                errors.push({
                    path,
                    message:
                        `${producerLabel} const ${JSON.stringify(producer.const)} ` +
                        `does not equal ${consumerLabel} const ` +
                        `${JSON.stringify(consumer.const)}.`,
                });
            }
            return;
        }
        if (producer.enum) {
            const bad = producer.enum.filter((v) => v !== consumer.const);
            if (bad.length > 0) {
                errors.push({
                    path,
                    message:
                        `${producerLabel} enum values ${JSON.stringify(bad)} ` +
                        `do not match ${consumerLabel} const ` +
                        `${JSON.stringify(consumer.const)}.`,
                });
            }
            return;
        }
    } else if (consumer.enum) {
        const allowed = new Set(consumer.enum);
        if (producer.const !== undefined) {
            if (!allowed.has(producer.const)) {
                errors.push({
                    path,
                    message:
                        `${producerLabel} const ${JSON.stringify(producer.const)} ` +
                        `is not in ${consumerLabel} enum ` +
                        `${JSON.stringify(consumer.enum)}.`,
                });
            }
            return;
        }
        if (producer.enum) {
            const bad = producer.enum.filter((v) => !allowed.has(v));
            if (bad.length > 0) {
                errors.push({
                    path,
                    message:
                        `${producerLabel} enum values ${JSON.stringify(bad)} ` +
                        `are not in ${consumerLabel} enum ` +
                        `${JSON.stringify(consumer.enum)}.`,
                });
            }
            return;
        }
    }

    // Handle allOf: intersection semantics.
    if (producer.allOf) {
        const compatible = producer.allOf.some(
            (v) => typeof v !== "boolean" && isStructuralSubtype(v, consumer),
        );
        if (!compatible) {
            errors.push({
                path,
                message:
                    `No member of ${producerLabel} allOf satisfies ` +
                    `${consumerLabel} type ${formatSchemaType(consumer)}.`,
            });
        }
        return;
    }

    if (consumer.allOf) {
        for (let i = 0; i < consumer.allOf.length; i++) {
            const v = consumer.allOf[i];
            if (typeof v === "boolean") continue;
            checkStructuralSubtype(
                producer,
                v,
                `${path}.allOf[${i}]`,
                errors,
                producerLabel,
                `${consumerLabel} allOf[${i}]`,
            );
        }
        return;
    }

    // Normalize type from structural cues before comparison.
    producer = inferSchemaType(producer);
    consumer = inferSchemaType(consumer);

    // Type check
    if (producer.type && consumer.type) {
        const pTypes = normalizeTypeSet(producer.type);
        const cTypes = normalizeTypeSet(consumer.type);
        for (const pt of pTypes) {
            if (!cTypes.some((ct) => typeAssignableTo(pt, ct))) {
                errors.push({
                    path,
                    message:
                        `${producerLabel} type "${pt}" is not assignable ` +
                        `to ${consumerLabel} type ${JSON.stringify(consumer.type)}.`,
                });
            }
        }
    } else if (consumer.type && !producer.type) {
        return; // producer unconstrained, be lenient
    }

    // Object: every required property of C must be required by P
    const cRequired = consumer.required ?? [];
    const pRequired = new Set(producer.required ?? []);
    const pProps = producer.properties ?? {};
    const cProps = consumer.properties ?? {};

    for (const req of cRequired) {
        if (!pRequired.has(req)) {
            errors.push({
                path,
                message:
                    `${consumerLabel} requires "${req}" but ` +
                    `${producerLabel} does not declare it as required.`,
            });
            continue;
        }
        const pProp = pProps[req];
        const cProp = cProps[req];
        if (
            pProp &&
            cProp &&
            typeof pProp !== "boolean" &&
            typeof cProp !== "boolean"
        ) {
            checkStructuralSubtype(
                pProp,
                cProp,
                `${path}.${req}`,
                errors,
                `${producerLabel} property "${req}"`,
                `${consumerLabel} property "${req}"`,
            );
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
            checkStructuralSubtype(
                pPropDef,
                cPropDef,
                `${path}.${key}`,
                errors,
                `${producerLabel} property "${key}"`,
                `${consumerLabel} property "${key}"`,
            );
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
            checkStructuralSubtype(
                producer.items,
                consumer.items,
                `${path}.items`,
                errors,
                `${producerLabel} items`,
                `${consumerLabel} items`,
            );
        }
    }
}

/**
 * Boolean wrapper: returns true if producer P is compatible with consumer C.
 */
export function isStructuralSubtype(
    producer: JSONSchema,
    consumer: JSONSchema,
): boolean {
    const errors: ValidationError[] = [];
    checkStructuralSubtype(producer, consumer, "", errors);
    return errors.length === 0;
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
                isEmptySchema(consumerPropDef)
            ) {
                continue;
            }

            for (const binderId of binderList) {
                const binderNode = nodes[binderId];
                if (!binderNode || !isBindableNode(binderNode)) continue;
                const binderSchema = nodeOutputSchema(binderNode);
                if (!binderSchema) continue;

                // Apply path projection if present
                const refPath = obj["path"] as (string | number)[] | undefined;
                const projected =
                    refPath && refPath.length > 0
                        ? resolveSchemaPath(binderSchema, refPath)
                        : binderSchema;
                if (!projected) continue;

                checkStructuralSubtype(
                    projected,
                    consumerPropDef,
                    `${prefix}.${id}.inputs.${fieldName}`,
                    errors,
                    `Phi-merge binder "${binderId}"`,
                    "consumer's expected type",
                );
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
 * Each check explicitly names the producer/consumer or def/impl
 * relationship rather than deriving it from a "side" discriminator.
 */
function checkNodeTaskSchemas(
    taskDef: TaskDefinition,
    node: { inputSchema: JSONSchema; outputSchema: JSONSchema },
    path: string,
    errors: ValidationError[],
): void {
    // Generic tasks have schema templates with $typeParam markers.
    // The node's schemas are already resolved (concrete), so we validate
    // the structurally fixed parts of the template against the node.
    if (isGenericTask(taskDef)) {
        checkGenericNodeSchemas(taskDef, node, path, errors);
        return;
    }

    const inputPath = `${path}.inputSchema`;
    const outputPath = `${path}.outputSchema`;

    // Extra properties: node must not declare properties unknown to task.
    // This is stricter than structural subtyping (which allows extra producer
    // properties), so it stays as a separate check.
    checkExtraProperties(
        taskDef.inputSchema,
        node.inputSchema,
        inputPath,
        "input",
        "accept",
        errors,
    );
    checkExtraProperties(
        taskDef.outputSchema,
        node.outputSchema,
        outputPath,
        "output",
        "produce",
        errors,
    );

    // Structural subtype checks (includes required-field and type compat):
    // Input: node is producer (what it provides), task is consumer (what it needs)
    checkStructuralSubtype(
        node.inputSchema,
        taskDef.inputSchema,
        inputPath,
        errors,
        "Node",
        "task",
    );
    // Output: task is producer (what it emits), node is consumer (what it claims)
    checkStructuralSubtype(
        taskDef.outputSchema,
        node.outputSchema,
        outputPath,
        errors,
        "Task",
        "node",
    );
}

/**
 * Check that the implementation (node) does not declare properties
 * that the definition (task) does not know about.
 */
function checkExtraProperties(
    defSchema: JSONSchema,
    implSchema: JSONSchema,
    path: string,
    sideLabel: "input" | "output",
    verb: string,
    errors: ValidationError[],
): void {
    if (isEmptySchema(defSchema)) return;
    const defProps = defSchema.properties ?? {};
    const implProps = implSchema.properties ?? {};
    for (const propName of Object.keys(implProps)) {
        if (!(propName in defProps)) {
            errors.push({
                path,
                message:
                    `Node declares ${sideLabel} property "${propName}" ` +
                    `but task does not ${verb} it.`,
            });
        }
    }
}

/**
 * Validate a generic task's resolved node schemas against the structurally
 * fixed parts of its schema template. Each check explicitly names the
 * producer/consumer relationship via argument order.
 */
function checkGenericNodeSchemas(
    taskDef: GenericTaskDefinition,
    node: { inputSchema: JSONSchema; outputSchema: JSONSchema },
    path: string,
    errors: ValidationError[],
): void {
    const inputPath = `${path}.inputSchema`;
    const outputPath = `${path}.outputSchema`;

    // Build synthetic JSONSchemas from each template's concrete parts
    // (required array + non-$typeParam properties). checkStructuralSubtype
    // handles both required-field and type-compatibility checks in one call.
    const syntheticInput = buildSyntheticFromTemplate(
        taskDef.inputSchemaTemplate,
    );
    const syntheticOutput = buildSyntheticFromTemplate(
        taskDef.outputSchemaTemplate,
    );

    // Input: node is producer, template is consumer.
    // No extra-property check (type params may expand to additional properties).
    if (syntheticInput) {
        checkStructuralSubtype(
            node.inputSchema,
            syntheticInput,
            inputPath,
            errors,
            "Node",
            "task template",
        );
    }

    // Output: template is producer, node is consumer.
    if (syntheticOutput) {
        // Extra-property check uses full template properties (including $typeParam
        // slots) since even type-param properties are known property names.
        const tmplObj = taskDef.outputSchemaTemplate as Record<string, unknown>;
        const tmplProps = (tmplObj.properties as Record<string, unknown>) ?? {};
        const nodeProps = node.outputSchema.properties ?? {};
        for (const propName of Object.keys(nodeProps)) {
            if (!(propName in tmplProps)) {
                errors.push({
                    path: outputPath,
                    message:
                        `Node declares output property "${propName}" ` +
                        `but task does not produce it.`,
                });
            }
        }

        checkStructuralSubtype(
            syntheticOutput,
            node.outputSchema,
            outputPath,
            errors,
            "Task template",
            "node",
        );
    }

    // Check type parameter consistency: each $typeParam must resolve to the
    // same schema everywhere it appears across both templates.
    checkTypeParamConsistency(taskDef, node, path, errors);
}

/**
 * Build a synthetic JSONSchema from a schema template's concrete parts:
 * the full `required` array and only the non-$typeParam properties.
 * Returns undefined if the template is a $typeParam marker or non-object.
 */
function buildSyntheticFromTemplate(
    template: SchemaTemplate,
): JSONSchema | undefined {
    if (isTypeParamRef(template)) return undefined;
    if (
        typeof template !== "object" ||
        template === null ||
        typeof template === "boolean"
    ) {
        return undefined;
    }
    const tmplObj = template as Record<string, unknown>;
    const properties: Record<string, JSONSchema> = {};
    const taskProps =
        (tmplObj.properties as Record<string, SchemaTemplate>) ?? {};
    for (const [propName, taskPropTmpl] of Object.entries(taskProps)) {
        if (isTypeParamRef(taskPropTmpl)) continue;
        if (
            typeof taskPropTmpl !== "object" ||
            taskPropTmpl === null ||
            typeof taskPropTmpl === "boolean"
        ) {
            continue;
        }
        properties[propName] = taskPropTmpl as JSONSchema;
    }
    const schema: JSONSchema = { type: "object", properties };
    if (tmplObj.required) {
        schema.required = tmplObj.required as string[];
    }
    return schema;
}

/**
 * Verify that each type parameter resolves to the same schema at every
 * position where it appears in the input and output templates.
 */
function checkTypeParamConsistency(
    taskDef: GenericTaskDefinition,
    node: { inputSchema: JSONSchema; outputSchema: JSONSchema },
    path: string,
    errors: ValidationError[],
): void {
    // Collect resolved schemas for each type param across both templates
    const resolutions = new Map<
        string,
        { schema: unknown; location: string }[]
    >();

    collectTypeParamResolutions(
        taskDef.inputSchemaTemplate,
        node.inputSchema,
        "inputSchema",
        resolutions,
    );
    collectTypeParamResolutions(
        taskDef.outputSchemaTemplate,
        node.outputSchema,
        "outputSchema",
        resolutions,
    );

    // For each type param, verify all resolutions are structurally equal
    for (const [paramName, entries] of resolutions) {
        if (entries.length < 2) continue;
        const first = entries[0];
        for (let i = 1; i < entries.length; i++) {
            if (!schemasEqual(first.schema, entries[i].schema)) {
                errors.push({
                    path,
                    message:
                        `Type parameter "${paramName}" resolves inconsistently: ` +
                        `${JSON.stringify(first.schema)} at ${first.location} vs ` +
                        `${JSON.stringify(entries[i].schema)} at ${entries[i].location}.`,
                });
                break;
            }
        }
    }
}

/**
 * Walk a schema template and its corresponding resolved schema in parallel.
 * At each $typeParam marker position, record the resolved schema value.
 */
function collectTypeParamResolutions(
    template: SchemaTemplate,
    resolved: unknown,
    location: string,
    out: Map<string, { schema: unknown; location: string }[]>,
): void {
    if (isTypeParamRef(template)) {
        const paramName = template.$typeParam;
        let entries = out.get(paramName);
        if (!entries) {
            entries = [];
            out.set(paramName, entries);
        }
        entries.push({ schema: resolved, location });
        return;
    }
    if (
        typeof template !== "object" ||
        template === null ||
        typeof template === "boolean"
    ) {
        return;
    }
    if (typeof resolved !== "object" || resolved === null) return;

    const tmplObj = template as Record<string, unknown>;
    const resObj = resolved as Record<string, unknown>;

    // Recurse into properties
    const tmplProps = tmplObj.properties as
        | Record<string, SchemaTemplate>
        | undefined;
    const resProps = resObj.properties as Record<string, unknown> | undefined;
    if (tmplProps && resProps) {
        for (const [key, tmplProp] of Object.entries(tmplProps)) {
            if (key in resProps) {
                collectTypeParamResolutions(
                    tmplProp,
                    resProps[key],
                    `${location}.properties.${key}`,
                    out,
                );
            }
        }
    }

    // Recurse into items (array schema)
    if (tmplObj.items !== undefined && resObj.items !== undefined) {
        collectTypeParamResolutions(
            tmplObj.items as SchemaTemplate,
            resObj.items,
            `${location}.items`,
            out,
        );
    }

    // Recurse into additionalProperties
    if (
        tmplObj.additionalProperties !== undefined &&
        resObj.additionalProperties !== undefined
    ) {
        collectTypeParamResolutions(
            tmplObj.additionalProperties as SchemaTemplate,
            resObj.additionalProperties,
            `${location}.additionalProperties`,
            out,
        );
    }
}

/**
 * Deep-equal comparison for JSON schema values (plain JSON structures).
 */
function schemasEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a === null || b === null) return false;
    if (typeof a !== typeof b) return false;
    if (typeof a !== "object") return false;
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const aKeys = Object.keys(aObj);
    const bKeys = Object.keys(bObj);
    if (aKeys.length !== bKeys.length) return false;
    for (const key of aKeys) {
        if (!Object.prototype.hasOwnProperty.call(bObj, key)) return false;
        if (!schemasEqual(aObj[key], bObj[key])) return false;
    }
    return true;
}

// ---- Template ref collection (used by CFG and recovery-rule passes) ----

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
