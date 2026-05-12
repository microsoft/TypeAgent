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
