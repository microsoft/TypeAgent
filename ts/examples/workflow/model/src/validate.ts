// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import Ajv from "ajv";
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
    tasks?: Map<string, TaskDefinition>,
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
    const AjvConstructor = (Ajv as any).default ?? Ajv;
    const ajv = new AjvConstructor({ strict: false });
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
        validateNode(prefix, nodeId, node, nodeIds, tasks, errors);
    }

    return { valid: errors.length === 0, errors };
}

function validateNode(
    prefix: string,
    nodeId: string,
    node: WorkflowNode,
    nodeIds: Set<string>,
    tasks: Map<string, TaskDefinition> | undefined,
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
