// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import AjvModule from "ajv";
import { WorkflowSpec, WorkflowNode } from "./workflowSpec.js";
import { TaskDefinition } from "./taskDefinition.js";

const CURRENT_SPEC_VERSION = 1;

/** Path prefix patterns for inputMap values. */
const validPathPrefixes = ["input.", "variables.", "nodes."];

export interface ValidationError {
    path: string;
    message: string;
}

export interface ValidationResult {
    valid: boolean;
    errors: ValidationError[];
}

/**
 * Validate a workflow spec structurally and against a set of registered tasks.
 *
 * Checks performed:
 *   - specVersion is supported
 *   - entry node exists
 *   - all `next` targets reference existing nodes
 *   - all `onError` targets reference existing nodes
 *   - inputMap paths have valid prefixes
 *   - inputMap paths referencing `nodes.<id>.output.*` point to existing nodes
 *   - decision nodes: `next` keys match task's `branchLabels` (if tasks provided)
 *   - non-decision nodes: `next` is a string or omitted (if tasks provided)
 *   - workflow input/output schemas are valid JSON Schema
 */
export function validateWorkflowSpec(
    spec: WorkflowSpec,
    tasks?: ReadonlyMap<string, TaskDefinition>,
): ValidationResult {
    const errors: ValidationError[] = [];

    // specVersion
    if (spec.specVersion !== CURRENT_SPEC_VERSION) {
        errors.push({
            path: "specVersion",
            message: `Unsupported spec version ${spec.specVersion}; expected ${CURRENT_SPEC_VERSION}.`,
        });
    }

    // entry
    if (!(spec.entry in spec.nodes)) {
        errors.push({
            path: "entry",
            message: `Entry node "${spec.entry}" does not exist in nodes.`,
        });
    }

    // Validate JSON Schemas for workflow input/output
    const Ajv = AjvModule.default ?? AjvModule;
    const ajv = new Ajv({ strict: false });
    try {
        ajv.compile(spec.input as object);
    } catch {
        errors.push({
            path: "input",
            message: "Workflow input schema is not valid JSON Schema.",
        });
    }
    try {
        ajv.compile(spec.output as object);
    } catch {
        errors.push({
            path: "output",
            message: "Workflow output schema is not valid JSON Schema.",
        });
    }

    const nodeIds = new Set(Object.keys(spec.nodes));

    for (const [nodeId, node] of Object.entries(spec.nodes)) {
        const prefix = `nodes.${nodeId}`;
        validateNode(
            prefix,
            nodeId,
            node,
            nodeIds,
            tasks,
            spec.variables,
            errors,
        );
    }

    // Check for unreachable nodes
    const reachable = findReachableNodes(spec.entry, spec.nodes);
    for (const nodeId of nodeIds) {
        if (!reachable.has(nodeId)) {
            errors.push({
                path: `nodes.${nodeId}`,
                message: `Node "${nodeId}" is not reachable from the entry node.`,
            });
        }
    }

    // Check for unconditional cycles (every cycle must contain a decision node)
    const cycleErrors = validateExitPaths(spec.nodes);
    errors.push(...cycleErrors);

    return { valid: errors.length === 0, errors };
}

function validateNode(
    prefix: string,
    nodeId: string,
    node: WorkflowNode,
    nodeIds: Set<string>,
    tasks: ReadonlyMap<string, TaskDefinition> | undefined,
    variables: Record<string, unknown> | undefined,
    errors: ValidationError[],
): void {
    const task = tasks?.get(node.task);

    // Check task exists (if registry provided)
    if (tasks && !task) {
        errors.push({
            path: `${prefix}.task`,
            message: `Task "${node.task}" is not registered.`,
        });
    }

    // Validate inputMap paths
    if (node.inputMap) {
        for (const [field, path] of Object.entries(node.inputMap)) {
            const fieldPath = `${prefix}.inputMap.${field}`;
            if (!validPathPrefixes.some((p) => path.startsWith(p))) {
                errors.push({
                    path: fieldPath,
                    message: `Invalid path "${path}". Must start with one of: ${validPathPrefixes.join(", ")}.`,
                });
                continue;
            }
            // Validate node references in paths
            if (path.startsWith("nodes.")) {
                const parts = path.split(".");
                if (parts.length < 4 || parts[2] !== "output") {
                    errors.push({
                        path: fieldPath,
                        message: `Invalid node path "${path}". Expected format: nodes.<nodeId>.output.<field>.`,
                    });
                } else if (!nodeIds.has(parts[1])) {
                    errors.push({
                        path: fieldPath,
                        message: `Path "${path}" references non-existent node "${parts[1]}".`,
                    });
                }
            }
            // Validate variable references (full path traversal)
            if (path.startsWith("variables.")) {
                const segments = path.split(".").slice(1);
                let current: unknown = variables;
                for (let i = 0; i < segments.length; i++) {
                    if (
                        current == null ||
                        typeof current !== "object" ||
                        !(segments[i] in (current as Record<string, unknown>))
                    ) {
                        const resolved =
                            "variables." + segments.slice(0, i + 1).join(".");
                        errors.push({
                            path: fieldPath,
                            message: `Path "${path}" is invalid: "${resolved}" does not exist.`,
                        });
                        break;
                    }
                    current = (current as Record<string, unknown>)[segments[i]];
                }
            }
        }
    }

    // Validate next
    if (node.next !== undefined) {
        if (typeof node.next === "string") {
            // Linear transition
            if (!nodeIds.has(node.next)) {
                errors.push({
                    path: `${prefix}.next`,
                    message: `Next node "${node.next}" does not exist.`,
                });
            }
            // If task is known, it should not have branchLabels
            if (task?.branchLabels && task.branchLabels.length > 0) {
                errors.push({
                    path: `${prefix}.next`,
                    message: `Task "${node.task}" declares branchLabels but node has a linear "next". Use a decision map instead.`,
                });
            }
        } else {
            // Decision map
            const nextKeys = Object.keys(node.next);
            for (const [label, targetId] of Object.entries(node.next)) {
                if (!nodeIds.has(targetId)) {
                    errors.push({
                        path: `${prefix}.next.${label}`,
                        message: `Target node "${targetId}" does not exist.`,
                    });
                }
            }
            // Validate branch labels match task declaration
            if (task?.branchLabels) {
                const declaredSet = new Set(task.branchLabels);
                const specSet = new Set(nextKeys);
                for (const label of task.branchLabels) {
                    if (!specSet.has(label)) {
                        errors.push({
                            path: `${prefix}.next`,
                            message: `Task "${node.task}" declares branch label "${label}" but it has no entry in next.`,
                        });
                    }
                }
                for (const label of nextKeys) {
                    if (!declaredSet.has(label)) {
                        errors.push({
                            path: `${prefix}.next.${label}`,
                            message: `Branch label "${label}" is not declared by task "${node.task}".`,
                        });
                    }
                }
            }
        }
    }

    // Validate onError
    if (node.onError !== undefined && !nodeIds.has(node.onError)) {
        errors.push({
            path: `${prefix}.onError`,
            message: `Error handler node "${node.onError}" does not exist.`,
        });
    }
}

/**
 * BFS to find all nodes reachable from a given entry via `next` and `onError` edges.
 */
function findReachableNodes(
    entry: string,
    nodes: Record<string, WorkflowNode>,
): Set<string> {
    const visited = new Set<string>();
    const queue: string[] = [entry];
    while (queue.length > 0) {
        const id = queue.shift()!;
        if (visited.has(id) || !(id in nodes)) {
            continue;
        }
        visited.add(id);
        const node = nodes[id];
        if (node.next !== undefined) {
            if (typeof node.next === "string") {
                queue.push(node.next);
            } else {
                for (const target of Object.values(node.next)) {
                    queue.push(target);
                }
            }
        }
        if (node.onError !== undefined) {
            queue.push(node.onError);
        }
    }
    return visited;
}

/**
 * Check that every cycle in the graph has a reachable exit. Uses Tarjan's
 * algorithm to find strongly connected components (SCCs). Any SCC with more
 * than one node, or a single node with a self-loop, is a cycle. A cycle is
 * valid only if at least one node in the SCC has a `next` successor that
 * points outside the SCC (i.e. there is a reachable exit path).
 */
function validateExitPaths(
    nodes: Record<string, WorkflowNode>,
): ValidationError[] {
    const errors: ValidationError[] = [];
    const sccs = findSCCs(nodes);

    for (const scc of sccs) {
        const isCycle =
            scc.length > 1 || (scc.length === 1 && hasSelfEdge(scc[0], nodes));

        if (!isCycle) {
            continue;
        }

        const sccSet = new Set(scc);
        const hasExit = scc.some((id) => {
            const node = nodes[id];
            if (node.next !== undefined) {
                if (typeof node.next === "string") {
                    if (!sccSet.has(node.next)) return true;
                } else {
                    if (Object.values(node.next).some((t) => !sccSet.has(t)))
                        return true;
                }
            }
            if (node.onError !== undefined && !sccSet.has(node.onError)) {
                return true;
            }
            return false;
        });

        if (!hasExit) {
            const nodeList = scc.join(", ");
            errors.push({
                path: `nodes`,
                message: `Cycle with no exit detected among nodes [${nodeList}]. At least one branch must lead outside the cycle.`,
            });
        }
    }

    return errors;
}

/**
 * Returns true if a node has any edge (next or onError) pointing to itself.
 */
function hasSelfEdge(
    nodeId: string,
    nodes: Record<string, WorkflowNode>,
): boolean {
    const node = nodes[nodeId];
    if (node.next !== undefined) {
        if (typeof node.next === "string") {
            if (node.next === nodeId) return true;
        } else {
            if (Object.values(node.next).some((t) => t === nodeId)) return true;
        }
    }
    if (node.onError === nodeId) return true;
    return false;
}

/**
 * Tarjan's algorithm for finding strongly connected components.
 * Returns SCCs in reverse topological order.
 */
function findSCCs(nodes: Record<string, WorkflowNode>): string[][] {
    let index = 0;
    const indices = new Map<string, number>();
    const lowlinks = new Map<string, number>();
    const onStack = new Set<string>();
    const stack: string[] = [];
    const sccs: string[][] = [];

    function successors(nodeId: string): string[] {
        const node = nodes[nodeId];
        const targets: string[] = [];
        if (node.next !== undefined) {
            if (typeof node.next === "string") {
                targets.push(node.next);
            } else {
                targets.push(...Object.values(node.next));
            }
        }
        if (node.onError !== undefined) {
            targets.push(node.onError);
        }
        return targets.filter((t) => t in nodes);
    }

    function strongConnect(v: string): void {
        indices.set(v, index);
        lowlinks.set(v, index);
        index++;
        stack.push(v);
        onStack.add(v);

        for (const w of successors(v)) {
            if (!indices.has(w)) {
                strongConnect(w);
                lowlinks.set(v, Math.min(lowlinks.get(v)!, lowlinks.get(w)!));
            } else if (onStack.has(w)) {
                lowlinks.set(v, Math.min(lowlinks.get(v)!, indices.get(w)!));
            }
        }

        if (lowlinks.get(v) === indices.get(v)) {
            const scc: string[] = [];
            let w: string;
            do {
                w = stack.pop()!;
                onStack.delete(w);
                scc.push(w);
            } while (w !== v);
            sccs.push(scc);
        }
    }

    for (const nodeId of Object.keys(nodes)) {
        if (!indices.has(nodeId)) {
            strongConnect(nodeId);
        }
    }

    return sccs;
}
