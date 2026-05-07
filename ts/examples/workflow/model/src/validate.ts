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

    // NOTE: Binding name uniqueness is intentionally NOT validated.
    // Duplicate bindings are a deliberate design pattern used for
    // onError recovery (both paths produce the same binding name)
    // and sequential overwrites.

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
                // Binding not found in this scope. Could be valid if
                // produced conditionally (onError path). Don't error here;
                // runtime will catch unresolved refs.
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
                    const props = consumerInputSchema.properties as
                        | Record<string, JSONSchema>
                        | undefined;
                    if (props && remainder in props) {
                        consumerType = props[remainder].type as
                            | string
                            | string[]
                            | undefined;
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
