// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    WorkflowIR,
    WorkflowNode,
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

/**
 * Structural validation for an IR v1 document.
 *
 * Checks:
 * - Entry existence and node reference integrity.
 * - Task registration.
 * - Static schema compatibility: verifies that scope references point to
 *   producers whose outputSchema declares the referenced path.
 */
export function validateWorkflowIR(
    ir: WorkflowIR,
    tasks?: ReadonlyMap<string, TaskDefinition>,
): ValidationResult {
    const errors: ValidationError[] = [];

    if (ir.kind !== "workflow") {
        errors.push({ path: "kind", message: `Expected "workflow".` });
    }

    if (!(ir.entry in ir.nodes)) {
        errors.push({
            path: "entry",
            message: `Entry node "${ir.entry}" does not exist.`,
        });
    }

    validateScope(ir.nodes, "nodes", tasks, errors, false);

    // Static schema compatibility for the top-level scope.
    validateSchemaCompat(ir.nodes, "nodes", errors);

    // Validate that the workflow output template only references existing
    // bindings. This catches references to names that no node binds.
    if (ir.output) {
        const bindings = buildBindingMap(ir.nodes);
        const outputRefs = collectScopeRefs(ir.output, "output");
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
                const err = checkSchemaCompat(
                    producerSchema,
                    ref.path,
                    `${ref.templatePath} ($from "scope", name "${ref.name}")`,
                );
                if (err) {
                    errors.push({ path: ref.templatePath, message: err });
                }
            }
        }
    }

    // CFG-based passes: acyclicity, onError rules, termination,
    // scope closure, dominator analysis, state soundness, output binding.
    validateCFGPasses(ir, errors);

    // Pass 7: Type compatibility (compositional resolved types).
    validateTypeCompatibility(
        ir.nodes,
        "nodes",
        errors,
        ir.inputSchema,
        undefined,
        ir.constants,
        ir.output,
        "output",
        ir.outputSchema,
    );

    return { valid: errors.length === 0, errors };
}

// ---- CFG data structure ----

interface ScopeCFG {
    /** nodeId -> set of successor nodeIds (excluding sentinels) */
    edges: Map<string, Set<string>>;
    entry: string;
    /** nodes with no successors (task with no next, or all successors are sentinels) */
    terminals: Set<string>;
    /** nodes whose next/case target is a sentinel */
    sentinelTargets: Map<string, Set<"@iterate" | "@exit">>;
}

/**
 * Build a CFG for a scope. Control-flow edges include next, onError,
 * and branch cases/default. Sentinels (@iterate, @exit) are tracked
 * separately rather than as graph nodes.
 */
function buildScopeCFG(
    nodes: Record<string, WorkflowNode>,
    entry: string,
): ScopeCFG {
    const edges = new Map<string, Set<string>>();
    const sentinelTargets = new Map<string, Set<"@iterate" | "@exit">>();

    for (const [id, node] of Object.entries(nodes)) {
        const succs = new Set<string>();
        edges.set(id, succs);

        if (node.kind === "task") {
            if (node.next) {
                if (node.next === "@iterate" || node.next === "@exit") {
                    let st = sentinelTargets.get(id);
                    if (!st) {
                        st = new Set();
                        sentinelTargets.set(id, st);
                    }
                    st.add(node.next);
                } else {
                    succs.add(node.next);
                }
            }
            if (node.onError) {
                succs.add(node.onError);
            }
        } else if (node.kind === "branch") {
            for (const target of Object.values(node.cases)) {
                if (target === "@iterate" || target === "@exit") {
                    let st = sentinelTargets.get(id);
                    if (!st) {
                        st = new Set();
                        sentinelTargets.set(id, st);
                    }
                    st.add(target);
                } else {
                    succs.add(target);
                }
            }
            if (node.default === "@iterate" || node.default === "@exit") {
                let st = sentinelTargets.get(id);
                if (!st) {
                    st = new Set();
                    sentinelTargets.set(id, st);
                }
                st.add(node.default);
            } else {
                succs.add(node.default);
            }
        } else if (node.kind === "loop") {
            if (node.next) {
                succs.add(node.next);
            }
            if (node.onError) {
                succs.add(node.onError);
            }
        }
    }

    // Terminals: nodes with no non-sentinel successors
    const terminals = new Set<string>();
    for (const [id, succs] of edges) {
        if (succs.size === 0) {
            terminals.add(id);
        }
    }

    return { edges, entry, terminals, sentinelTargets };
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
    const stack: string[] = [];

    function dfs(u: string): void {
        color.set(u, GRAY);
        stack.push(u);
        const succs = cfg.edges.get(u);
        if (succs) {
            for (const v of succs) {
                const c = color.get(v);
                if (c === GRAY) {
                    // Back edge: extract cycle from stack
                    const idx = stack.indexOf(v);
                    cycles.push(stack.slice(idx));
                } else if (c === WHITE) {
                    dfs(v);
                }
            }
        }
        stack.pop();
        color.set(u, BLACK);
    }

    // Start from entry, then visit any unreached nodes
    if (color.has(cfg.entry)) {
        dfs(cfg.entry);
    }
    for (const id of cfg.edges.keys()) {
        if (color.get(id) === WHITE) {
            dfs(id);
        }
    }

    return cycles;
}

// ---- Pass 9: Termination ----

/**
 * Check that every node can reach a terminal (top-level) or a sentinel
 * (loop body). Uses reverse reachability from terminals/sentinel nodes.
 */
function checkTermination(cfg: ScopeCFG, insideLoop: boolean): Set<string> {
    // Collect "exit" nodes: terminals for top-level, sentinel targets for bodies
    const exitNodes = new Set<string>();
    if (insideLoop) {
        for (const id of cfg.sentinelTargets.keys()) {
            exitNodes.add(id);
        }
        // Also include terminals (nodes with no next) as they can still
        // be valid in a loop body if they're onError recovery nodes
        // that don't continue.
        // Actually, in a loop body, every path must reach a sentinel.
        // Terminals without sentinels are dead ends.
    } else {
        for (const id of cfg.terminals) {
            exitNodes.add(id);
        }
    }

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
    // Compute reverse postorder via DFS from entry
    const rpo: string[] = [];
    const visited = new Set<string>();
    function dfs(u: string): void {
        visited.add(u);
        const succs = cfg.edges.get(u);
        if (succs) {
            for (const v of succs) {
                if (!visited.has(v)) dfs(v);
            }
        }
        rpo.push(u);
    }
    dfs(cfg.entry);
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
        if ((node.kind === "task" || node.kind === "loop") && node.onError) {
            const errorTarget = node.onError;
            const errorSide = dominatedSet(errorTarget, idom);
            // Success side: nodes dominated by the next target (if any),
            // excluding nodes on the error side.
            let successSide = new Set<string>();
            const nextTarget = node.kind === "task" ? node.next : node.next;
            if (
                nextTarget &&
                nextTarget !== "@iterate" &&
                nextTarget !== "@exit"
            ) {
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
        const hasErrorBinder = binderList.some((b) =>
            split.errorSide.has(b),
        );
        if (
            hasSuccessBinder &&
            hasErrorBinder &&
            dominates(split.trigger, targetId, idom, cfg.entry)
        ) {
            return true;
        }
    }

    return false;
}

/**
 * Run the dominator-based checks for a scope:
 * - Coverage (6b): every $from scope ref is covered on all paths
 * - Phi soundness (6a): no two binders of the same name on the same path
 */
function checkDominance(
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
        if ((node.kind === "task" || node.kind === "loop") && node.bind) {
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
        let inputs: Record<string, Template> | undefined;
        if (node.kind === "task") inputs = node.inputs;
        else if (node.kind === "loop") inputs = node.inputs;
        if (!inputs) continue;

        const refs = collectScopeRefs(inputs, `${prefix}.${id}.inputs`);
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
        const outputRefs = collectScopeRefs(outputTemplate, outputPrefix);
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

// ---- Orchestrate CFG-based passes ----

function validateCFGPasses(ir: WorkflowIR, errors: ValidationError[]): void {
    validateScopeCFG(
        ir.nodes,
        ir.entry,
        "nodes",
        errors,
        false,
        ir.output,
        "output",
    );
}

function validateScopeCFG(
    nodes: Record<string, WorkflowNode>,
    entry: string,
    prefix: string,
    errors: ValidationError[],
    insideLoop: boolean,
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
                `Intra-scope cycles are not allowed; use a loop construct ` +
                `with @iterate instead.`,
        });
    }
    // If cycles exist, skip passes that depend on acyclicity
    if (cycles.length > 0) return;

    // Pass 4 (completion): onError structural rules
    validateOnErrorRules(nodes, entry, prefix, errors);

    // Pass 5: Scope closure (loop bodies only)
    // Checked within the loop body recursion below.

    // Pass 9: Termination
    if (!skipTermination) {
        const unreachable = checkTermination(cfg, insideLoop);
        for (const id of unreachable) {
            errors.push({
                path: `${prefix}.${id}`,
                message: insideLoop
                    ? `Node "${id}" cannot reach any sentinel (@iterate or @exit).`
                    : `Node "${id}" cannot reach a terminal node.`,
            });
        }
    }

    // Pass 6: Dominator analysis
    const idom = computeImmediateDominators(cfg);
    checkDominance(
        nodes,
        cfg,
        idom,
        prefix,
        errors,
        outputTemplate,
        outputPrefix,
    );

    // Recurse into loop body scopes
    for (const [id, node] of Object.entries(nodes)) {
        if (node.kind === "loop" && node.body.entry in node.body.nodes) {
            const bodyPrefix = `${prefix}.${id}.body.nodes`;

            // Pass 5: Scope closure
            checkScopeClosure(node, id, bodyPrefix, prefix, nodes, errors);

            // Pass 11: State soundness
            checkStateSoundness(node, id, `${prefix}.${id}`, errors);

            validateScopeCFG(
                node.body.nodes,
                node.body.entry,
                bodyPrefix,
                errors,
                true,
                node.output,
                `${prefix}.${id}.output`,
                !!node.onError, // skip body termination check when loop has onError
            );
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
        if (node.kind === "task") {
            if (node.next) normalTargets.add(node.next);
            if (node.onError) {
                const existing = onErrorTargetToTrigger.get(node.onError);
                if (existing) {
                    // Rule 2: single trigger
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
        } else if (node.kind === "branch") {
            for (const target of Object.values(node.cases)) {
                if (target !== "@iterate" && target !== "@exit") {
                    normalTargets.add(target);
                }
            }
            if (node.default !== "@iterate" && node.default !== "@exit") {
                normalTargets.add(node.default);
            }
        } else if (node.kind === "loop") {
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

        // Rule 3: no recursive recovery
        if (
            (targetNode.kind === "task" || targetNode.kind === "loop") &&
            targetNode.onError
        ) {
            errors.push({
                path: `${prefix}.${target}.onError`,
                message:
                    `Recovery node "${target}" must not itself declare ` +
                    `onError. Recursive recovery chains are not ` +
                    `allowed in v1.`,
            });
        }

        // Rule 4: recovery target must be a task
        if (targetNode.kind !== "task") {
            errors.push({
                path: `${prefix}.${trigger}.onError`,
                message:
                    `Recovery target "${target}" must be a task node ` +
                    `(got "${targetNode.kind}").`,
            });
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
    // Also include names available via $from: "input" and $from: "state"
    // (those are legal cross-scope references). We only check $from: "scope".

    for (const [id, node] of Object.entries(loopNode.body.nodes)) {
        let inputs: Record<string, Template> | undefined;
        if (node.kind === "task") inputs = node.inputs;
        else if (node.kind === "loop") inputs = node.inputs;
        if (!inputs) continue;

        const refs = collectScopeRefs(inputs, `${bodyPrefix}.${id}.inputs`);
        for (const ref of refs) {
            if (!bodyBindings.has(ref.name)) {
                // Check if this name exists in the outer scope
                const outerBindings = buildBindingMap(outerNodes);
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
        let inputs: Record<string, Template> | undefined;
        let inputSchema: JSONSchema | undefined;
        if (node.kind === "task") {
            inputs = node.inputs;
            inputSchema = node.inputSchema;
        } else if (node.kind === "loop") {
            inputs = node.inputs;
            inputSchema = node.inputSchema;
        }
        if (!inputs) continue;

        const stateRefs = collectStateRefs(
            inputs,
            `${prefix}.body.nodes.${id}.inputs`,
        );
        for (const ref of stateRefs) {
            if (!stateNames.has(ref.name)) {
                errors.push({
                    path: ref.templatePath,
                    message:
                        `$from "state", name "${ref.name}": no state ` +
                        `variable "${ref.name}" is declared on this loop.`,
                });
            } else if (inputSchema) {
                // Type-compatibility: check the state variable's schema
                // type against the consumer's expected type at this position.
                const stateSchema = loopNode.state[ref.name].schema;
                const inputKey = ref.templatePath.split(".").pop()!;
                const consumerPropDef =
                    inputSchema.properties?.[inputKey];
                const consumerPropSchema =
                    consumerPropDef !== undefined &&
                    typeof consumerPropDef !== "boolean"
                        ? consumerPropDef
                        : undefined;
                if (
                    stateSchema.type &&
                    consumerPropSchema?.type
                ) {
                    const stateTypes = normalizeTypeSet(stateSchema.type);
                    const consumerTypes = normalizeTypeSet(
                        consumerPropSchema.type,
                    );
                    const overlap = consumerTypes.some((ct) =>
                        stateTypes.includes(ct),
                    );
                    if (!overlap) {
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
}

/**
 * Walk a template and collect all $from: "state" references.
 */
function collectStateRefs(
    template: Template,
    templatePath: string,
): { name: string; templatePath: string }[] {
    if (template === null || template === undefined) return [];
    if (typeof template !== "object") return [];
    if (Array.isArray(template)) {
        const refs: { name: string; templatePath: string }[] = [];
        for (let i = 0; i < template.length; i++) {
            refs.push(
                ...collectStateRefs(template[i], `${templatePath}[${i}]`),
            );
        }
        return refs;
    }

    const obj = template as Record<string, unknown>;
    if (obj["$from"] === "state") {
        return [{ name: obj["name"] as string, templatePath }];
    }
    if ("$literal" in obj) return [];

    const refs: { name: string; templatePath: string }[] = [];
    for (const [key, value] of Object.entries(obj)) {
        refs.push(
            ...collectStateRefs(value as Template, `${templatePath}.${key}`),
        );
    }
    return refs;
}

function validateScope(
    nodes: Record<string, WorkflowNode>,
    prefix: string,
    tasks: ReadonlyMap<string, TaskDefinition> | undefined,
    errors: ValidationError[],
    insideLoop: boolean,
): void {
    const nodeIds = new Set(Object.keys(nodes));

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

        if (node.kind === "task") {
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
            if (node.next) {
                if (node.next === "@iterate" || node.next === "@exit") {
                    if (!insideLoop) {
                        errors.push({
                            path: `${path}.next`,
                            message: `Sentinel "${node.next}" is only valid inside a loop body.`,
                        });
                    }
                } else if (!nodeIds.has(node.next)) {
                    errors.push({
                        path: `${path}.next`,
                        message: `Target "${node.next}" does not exist.`,
                    });
                }
            }
            if (node.onError && !nodeIds.has(node.onError)) {
                errors.push({
                    path: `${path}.onError`,
                    message: `Error target "${node.onError}" does not exist.`,
                });
            }
        } else if (node.kind === "branch") {
            // Validate selectorSchema type: String() coercion at runtime
            // only produces useful results for string, number, and boolean.
            const selectorType = node.selectorSchema?.type;
            if (selectorType) {
                const allowed = ["string", "number", "integer", "boolean"];
                const types = Array.isArray(selectorType)
                    ? selectorType
                    : [selectorType];
                const invalid = types.filter(
                    (t: string) => !allowed.includes(t),
                );
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
            for (const [label, target] of Object.entries(node.cases)) {
                if (target === "@iterate" || target === "@exit") {
                    if (!insideLoop) {
                        errors.push({
                            path: `${path}.cases.${label}`,
                            message: `Sentinel "${target}" is only valid inside a loop body.`,
                        });
                    }
                } else if (!nodeIds.has(target)) {
                    errors.push({
                        path: `${path}.cases.${label}`,
                        message: `Target "${target}" does not exist.`,
                    });
                }
            }
            if (node.default === "@iterate" || node.default === "@exit") {
                if (!insideLoop) {
                    errors.push({
                        path: `${path}.default`,
                        message: `Sentinel "${node.default}" is only valid inside a loop body.`,
                    });
                }
            } else if (!nodeIds.has(node.default)) {
                errors.push({
                    path: `${path}.default`,
                    message: `Default target "${node.default}" does not exist.`,
                });
            }
        } else if (node.kind === "loop") {
            if (!(node.body.entry in node.body.nodes)) {
                errors.push({
                    path: `${path}.body.entry`,
                    message: `Body entry "${node.body.entry}" does not exist.`,
                });
            }
            validateScope(
                node.body.nodes,
                `${path}.body.nodes`,
                tasks,
                errors,
                true,
            );
            validateSchemaCompat(node.body.nodes, `${path}.body.nodes`, errors);

            // W6: Verify that the loop body contains at least one
            // branch/task target referencing @iterate or @exit.
            // Skip this check when the loop has an onError handler,
            // since the body may intentionally fail every iteration.
            if (!node.onError && !bodyScopeHasSentinel(node.body.nodes)) {
                errors.push({
                    path: `${path}.body`,
                    message: `Loop body must contain at least one reference to @iterate or @exit.`,
                });
            }

            if (node.next && !nodeIds.has(node.next)) {
                errors.push({
                    path: `${path}.next`,
                    message: `Target "${node.next}" does not exist.`,
                });
            }
            if (node.onError && !nodeIds.has(node.onError)) {
                errors.push({
                    path: `${path}.onError`,
                    message: `Error target "${node.onError}" does not exist.`,
                });
            }
        }
    }
}

/**
 * Check whether a set of nodes contains at least one reference to a
 * loop sentinel (@iterate or @exit). This catches loop bodies that
 * will always fail at runtime because they terminate without a sentinel.
 */
function bodyScopeHasSentinel(nodes: Record<string, WorkflowNode>): boolean {
    for (const node of Object.values(nodes)) {
        if (node.kind === "branch") {
            for (const target of Object.values(node.cases)) {
                if (target === "@iterate" || target === "@exit") return true;
            }
            if (node.default === "@iterate" || node.default === "@exit") {
                return true;
            }
        } else if (node.kind === "task") {
            if (node.next === "@iterate" || node.next === "@exit") return true;
        }
    }
    return false;
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
        if (node.kind === "task" && node.bind) {
            map.set(node.bind, node.outputSchema);
        } else if (node.kind === "loop" && node.bind) {
            map.set(node.bind, node.outputSchema);
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
function checkSchemaCompat(
    producerSchema: JSONSchema,
    path: (string | number)[] | undefined,
    refDesc: string,
    consumerType?: string | string[],
): string | undefined {
    if (!path || path.length === 0) {
        // Reference to the whole output; compatible by definition
        // (consumer will validate at their end).
        return undefined;
    }
    const resolved = resolveSchemaPath(producerSchema, path);
    if (resolved === undefined) {
        return `${refDesc}: path ${JSON.stringify(path)} not declared in producer outputSchema`;
    }
    // Type compatibility check: if the consumer declares a type and the
    // producer declares a type, verify they overlap.
    if (consumerType && resolved.type) {
        const producerTypes = normalizeTypeSet(resolved.type);
        const consumerTypes = normalizeTypeSet(consumerType);
        const overlap = consumerTypes.some((ct) => producerTypes.includes(ct));
        if (!overlap) {
            return (
                `${refDesc}: type mismatch: producer declares ` +
                `${JSON.stringify(resolved.type)} but consumer expects ${JSON.stringify(consumerType)}`
            );
        }
    }
    return undefined;
}

/** Normalize a JSON Schema type (string or array) to an array of type strings. */
function normalizeTypeSet(type: unknown): string[] {
    if (Array.isArray(type)) return type as string[];
    if (typeof type === "string") return [type];
    return [];
}

/** True when a schema is the top type (empty object: no constraints). */
function isTopSchema(schema: JSONSchema): boolean {
    return Object.keys(schema).length === 0;
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
    if (typeof value === "string") return { type: "string" };
    if (typeof value === "number") {
        return Number.isInteger(value)
            ? { type: "integer" }
            : { type: "number" };
    }
    if (typeof value === "boolean") return { type: "boolean" };
    if (Array.isArray(value)) {
        if (value.length === 0) return { type: "array" };
        const elemSchemas = value.map(jsonValueToSchema);
        const firstJson = JSON.stringify(elemSchemas[0]);
        const allSame = elemSchemas.every(
            (s) => JSON.stringify(s) === firstJson,
        );
        return allSame
            ? { type: "array", items: elemSchemas[0] }
            : { type: "array" };
    }
    if (typeof value === "object") {
        const properties: Record<string, JSONSchema> = {};
        const required: string[] = [];
        for (const [k, v] of Object.entries(
            value as Record<string, unknown>,
        )) {
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
    if (typeof template === "string") return { type: "string" };
    if (typeof template === "number") {
        return Number.isInteger(template)
            ? { type: "integer" }
            : { type: "number" };
    }
    if (typeof template === "boolean") return { type: "boolean" };
    if (Array.isArray(template)) {
        const elemSchemas = template
            .map((e) => resolveTemplateType(e, ctx))
            .filter((s): s is JSONSchema => s !== undefined);
        if (elemSchemas.length === 0) return { type: "array" };
        const firstJson = JSON.stringify(elemSchemas[0]);
        const allSame = elemSchemas.every(
            (s) => JSON.stringify(s) === firstJson,
        );
        return allSame
            ? { type: "array", items: elemSchemas[0] }
            : { type: "array" };
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

    // Type check
    if (producer.type && consumer.type) {
        const pTypes = normalizeTypeSet(producer.type);
        const cTypes = normalizeTypeSet(consumer.type);
        for (const pt of pTypes) {
            // "integer" is a subtype of "number"
            const ok = cTypes.some(
                (ct) => ct === pt || (pt === "integer" && ct === "number"),
            );
            if (!ok) return false;
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

        if (node.kind === "task" || node.kind === "loop") {
            // Check each input template value against the corresponding
            // inputSchema property.
            const inputs = node.inputs;
            const inputProps = node.inputSchema.properties ?? {};
            for (const [fieldName, templateValue] of Object.entries(inputs)) {
                const resolved = resolveTemplateType(
                    templateValue,
                    ctx,
                );
                if (!resolved) continue;
                const consumerPropDef = inputProps[fieldName];
                if (
                    !consumerPropDef ||
                    typeof consumerPropDef === "boolean"
                ) {
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
            if (selectorType && !isTopSchema(node.selectorSchema)) {
                if (!isStructuralSubtype(selectorType, node.selectorSchema)) {
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

            // Check cases keys against selectorSchema enum
            if (node.selectorSchema.enum) {
                const validKeys = new Set(
                    node.selectorSchema.enum.map(String),
                );
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
        }

        // Recurse into loop bodies
        if (node.kind === "loop" && node.body.entry in node.body.nodes) {
            const bodyBindings = buildBindingMap(node.body.nodes);
            const bodyCtx: TypeResolutionContext = {
                bindings: bodyBindings,
                inputSchema: node.inputSchema,
                stateVars: node.state,
                constants,
            };

            validateTypeCompatibility(
                node.body.nodes,
                `${path}.body.nodes`,
                errors,
                node.inputSchema,
                node.state,
                constants,
                node.output,
                `${path}.output`,
                node.outputSchema,
            );

            // Check loop output template type vs loop outputSchema
            if (node.output && node.outputSchema) {
                const outputResolved = resolveTemplateType(
                    node.output,
                    bodyCtx,
                );
                if (
                    outputResolved &&
                    !isTopSchema(node.outputSchema)
                ) {
                    if (
                        !isStructuralSubtype(
                            outputResolved,
                            node.outputSchema,
                        )
                    ) {
                        errors.push({
                            path: `${path}.output`,
                            message:
                                `Loop output resolved type ` +
                                `${formatSchemaType(outputResolved)} is not ` +
                                `compatible with loop outputSchema ` +
                                `${formatSchemaType(node.outputSchema)}.`,
                        });
                    }
                }
            }
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
        if (node.kind !== "task" && node.kind !== "loop") continue;
        const inputs = node.inputs;
        const inputProps = node.inputSchema.properties ?? {};

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
                if (!binderNode) continue;
                const binderSchema =
                    binderNode.kind === "task" || binderNode.kind === "loop"
                        ? binderNode.outputSchema
                        : undefined;
                if (!binderSchema) continue;

                // Apply path projection if present
                const refPath = obj["path"] as
                    | (string | number)[]
                    | undefined;
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
        const taskTypes = normalizeTypeSet(taskPropDef.type);
        const nodeTypes = normalizeTypeSet(nodePropDef.type);
        const overlap = nodeTypes.some((nt) => taskTypes.includes(nt));
        if (!overlap) {
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
        // Node output types must be a subset of task types (narrowing).
        for (const nt of nodeTypes) {
            if (!taskTypes.includes(nt)) {
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

/**
 * Walk a template and collect all $from: "scope" references.
 */
interface ScopeRef {
    name: string;
    path: (string | number)[] | undefined;
    optional: boolean;
    templatePath: string;
}

function collectScopeRefs(
    template: Template,
    templatePath: string,
): ScopeRef[] {
    if (template === null || template === undefined) return [];
    if (typeof template !== "object") return [];
    if (Array.isArray(template)) {
        const refs: ScopeRef[] = [];
        for (let i = 0; i < template.length; i++) {
            refs.push(
                ...collectScopeRefs(template[i], `${templatePath}[${i}]`),
            );
        }
        return refs;
    }

    const obj = template as Record<string, unknown>;
    if (obj["$from"] === "scope") {
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

    const refs: ScopeRef[] = [];
    for (const [key, value] of Object.entries(obj)) {
        refs.push(
            ...collectScopeRefs(value as Template, `${templatePath}.${key}`),
        );
    }
    return refs;
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
        let inputs: Record<string, Template> | undefined;

        if (node.kind === "task") {
            inputs = node.inputs;
        } else if (node.kind === "loop") {
            inputs = node.inputs;

            // Also check iterateState and output templates.
            for (const [stateName, stateTemplate] of Object.entries(
                node.iterateState,
            )) {
                const stateRefs = collectScopeRefs(
                    stateTemplate,
                    `${path}.iterateState.${stateName}`,
                );
                for (const ref of stateRefs) {
                    // iterateState refs resolve in the body scope
                    const bodyBindings = buildBindingMap(node.body.nodes);
                    const producerSchema = bodyBindings.get(ref.name);
                    if (!producerSchema) continue;
                    const err = checkSchemaCompat(
                        producerSchema,
                        ref.path,
                        `${ref.templatePath} ($from "scope", name "${ref.name}")`,
                    );
                    if (err) {
                        errors.push({ path: ref.templatePath, message: err });
                    }
                }
            }

            const outputRefs = collectScopeRefs(node.output, `${path}.output`);
            for (const ref of outputRefs) {
                // output refs resolve in the body scope
                const bodyBindings = buildBindingMap(node.body.nodes);
                const producerSchema = bodyBindings.get(ref.name);
                if (!producerSchema) continue;
                const err = checkSchemaCompat(
                    producerSchema,
                    ref.path,
                    `${ref.templatePath} ($from "scope", name "${ref.name}")`,
                );
                if (err) {
                    errors.push({ path: ref.templatePath, message: err });
                }
            }
        }

        if (!inputs) continue;

        // Resolve consumer types from the node's inputSchema for
        // type compatibility checking on direct input properties.
        const consumerInputSchema =
            node.kind === "task" || node.kind === "loop"
                ? node.inputSchema
                : undefined;

        const refs = collectScopeRefs(inputs, `${path}.inputs`);
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
            // Extract consumer expected type from inputSchema.
            // Only for direct (non-nested) input properties where the
            // entire value is a scope ref (e.g., inputs.a = { $from: ... }).
            // Nested refs like inputs.vars.diff can't be checked because
            // the consumer schema is for "vars" (object), not "vars.diff".
            let consumerType: string | string[] | undefined;
            const inputsPrefix = `${path}.inputs.`;
            if (
                consumerInputSchema &&
                ref.templatePath.startsWith(inputsPrefix)
            ) {
                const remainder = ref.templatePath.slice(inputsPrefix.length);
                // Only check when remainder is a simple property name (no dots)
                if (!remainder.includes(".") && !remainder.includes("[")) {
                    const props = consumerInputSchema.properties;
                    if (props && remainder in props) {
                        const sub = props[remainder];
                        if (typeof sub !== "boolean") {
                            consumerType = sub.type;
                        }
                    }
                }
            }
            const err = checkSchemaCompat(
                producerSchema,
                ref.path,
                `${ref.templatePath} ($from "scope", name "${ref.name}")`,
                consumerType,
            );
            if (err) {
                errors.push({ path: ref.templatePath, message: err });
            }
        }
    }
}
