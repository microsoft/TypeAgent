// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { WorkflowIR, WorkflowNode } from "./ir.js";
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
 * Minimal structural validation for an IR v1 document.
 *
 * This is a stub: it checks entry existence, node references, and task
 * registration. Full validation (dominator analysis, type compatibility,
 * phi-soundness) is deferred to a dedicated validator.
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

    validateScope(ir.nodes, "nodes", tasks, errors);

    return { valid: errors.length === 0, errors };
}

function validateScope(
    nodes: Record<string, WorkflowNode>,
    prefix: string,
    tasks: ReadonlyMap<string, TaskDefinition> | undefined,
    errors: ValidationError[],
): void {
    const nodeIds = new Set(Object.keys(nodes));

    for (const [id, node] of Object.entries(nodes)) {
        const path = `${prefix}.${id}`;

        if (node.kind === "task") {
            if (tasks && !tasks.has(node.task)) {
                errors.push({
                    path: `${path}.task`,
                    message: `Task "${node.task}" is not registered.`,
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
        } else if (node.kind === "branch") {
            for (const [label, target] of Object.entries(node.cases)) {
                if (target !== "@iterate" && target !== "@exit") {
                    if (!nodeIds.has(target)) {
                        errors.push({
                            path: `${path}.cases.${label}`,
                            message: `Target "${target}" does not exist.`,
                        });
                    }
                }
            }
            if (
                node.default !== "@iterate" &&
                node.default !== "@exit" &&
                !nodeIds.has(node.default)
            ) {
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
            validateScope(node.body.nodes, `${path}.body.nodes`, tasks, errors);
            if (node.next && !nodeIds.has(node.next)) {
                errors.push({
                    path: `${path}.next`,
                    message: `Target "${node.next}" does not exist.`,
                });
            }
        }
    }
}
