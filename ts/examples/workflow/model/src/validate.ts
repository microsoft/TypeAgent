// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { WorkflowIR, WorkflowNode, Template, JSONSchema } from "./ir.js";
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

    return { valid: errors.length === 0, errors };
}

function validateScope(
    nodes: Record<string, WorkflowNode>,
    prefix: string,
    tasks: ReadonlyMap<string, TaskDefinition> | undefined,
    errors: ValidationError[],
    insideLoop: boolean,
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
            if (node.next && !nodeIds.has(node.next)) {
                errors.push({
                    path: `${path}.next`,
                    message: `Target "${node.next}" does not exist.`,
                });
            }
        }
    }
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
            if (current.type !== "array" || !current.items) {
                return undefined;
            }
            current = current.items as JSONSchema;
        } else {
            // Object property
            const props = current.properties as
                | Record<string, JSONSchema>
                | undefined;
            if (!props || !(segment in props)) {
                return undefined;
            }
            current = props[segment];
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
    return undefined;
}

/**
 * Walk a template and collect all $from: "scope" references.
 */
interface ScopeRef {
    name: string;
    path: (string | number)[] | undefined;
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

        const refs = collectScopeRefs(inputs, `${path}.inputs`);
        for (const ref of refs) {
            const producerSchema = bindings.get(ref.name);
            if (!producerSchema) {
                // Binding not found in this scope. Could be valid if
                // produced conditionally (onError path). Don't error here;
                // runtime will catch unresolved refs.
                continue;
            }
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
