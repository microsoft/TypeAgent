// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { randomUUID } from "node:crypto";
import AjvModule from "ajv";
import {
    WorkflowSpec,
    WorkflowNode,
    JSONSchema,
    TaskContext,
    TaskResult,
    SecretProvider,
    WorkflowLogger,
    validateWorkflowSpec,
} from "workflow-model";
import { TaskRegistry } from "./taskRegistry.js";
import { WorkflowEvent, WorkflowEventListener } from "./events.js";

const AjvConstructor = (AjvModule as any).default ?? AjvModule;

/**
 * Compile a JSON Schema into a validation function. Returns a function
 * that returns null on success or an error message on failure.
 */
function compileSchemaValidator(
    schema: JSONSchema,
): (data: unknown) => string | null {
    try {
        const ajv = new AjvConstructor({ strict: false, allErrors: true });
        const validate = ajv.compile(schema as object);
        return (data: unknown) => {
            if (validate(data)) {
                return null;
            }
            const msgs = (validate.errors ?? []).map(
                (e: any) => `${e.instancePath || "/"}: ${e.message}`,
            );
            return msgs.join("; ");
        };
    } catch {
        // Schema itself is invalid; skip runtime validation
        return () => null;
    }
}

/**
 * The resolved input for an error-handler node, constructed by the engine.
 */
interface ErrorInput {
    message: string;
    data?: unknown;
    nodeId: string;
    taskName: string;
}

export interface RunOptions {
    /** Workflow input data. Validated against the spec's input schema. */
    input?: Record<string, unknown>;

    /** Secret provider for workflow-scoped shared secrets. */
    secrets?: SecretProvider;

    /** AbortSignal for cooperative cancellation. */
    signal?: AbortSignal;

    /** Pluggable logger. Defaults to no-op if not provided. */
    logger?: WorkflowLogger;
}

export interface RunResult {
    /** Unique run identifier. */
    runId: string;

    /** Whether the run completed successfully. */
    success: boolean;

    /** Output from the terminal node (if successful). */
    output?: unknown;

    /** Error info (if failed). */
    error?: { message: string; nodeId?: string };
}

/**
 * Workflow execution engine. Loads a spec, resolves inputMaps, executes
 * tasks sequentially, and emits events.
 */
export class WorkflowEngine {
    private listeners: WorkflowEventListener[] = [];

    constructor(private readonly registry: TaskRegistry) {}

    on(listener: WorkflowEventListener): void {
        this.listeners.push(listener);
    }

    off(listener: WorkflowEventListener): void {
        const idx = this.listeners.indexOf(listener);
        if (idx >= 0) {
            this.listeners.splice(idx, 1);
        }
    }

    private emit(event: WorkflowEvent): void {
        for (const listener of this.listeners) {
            listener(event);
        }
    }

    /**
     * Execute a workflow spec.
     */
    async run(spec: WorkflowSpec, options?: RunOptions): Promise<RunResult> {
        // Validate
        const validation = validateWorkflowSpec(spec, this.registry.all());
        if (!validation.valid) {
            const msgs = validation.errors.map(
                (e) => `${e.path}: ${e.message}`,
            );
            return {
                runId: "",
                success: false,
                error: {
                    message: `Workflow validation failed:\n${msgs.join("\n")}`,
                },
            };
        }

        const runId = generateRunId();
        const signal = options?.signal ?? new AbortController().signal;
        const secrets: SecretProvider = options?.secrets ?? {
            get: async () => undefined,
        };
        const logger: WorkflowLogger = options?.logger ?? {
            log: () => {},
        };
        const workflowInput = options?.input ?? {};
        const maxIterations = spec.maxIterations ?? 1000;

        // Data context: stores outputs from all executed nodes
        const nodeOutputs = new Map<string, unknown>();
        // Per-node visit counter for loop-aware observability
        const nodeVisits = new Map<string, number>();

        this.emit({
            type: "runStarted",
            runId,
            workflowName: spec.name,
            timestamp: Date.now(),
        });

        let currentNodeId: string | undefined = spec.entry;
        let lastOutput: unknown = undefined;
        let iterationCount = 0;

        while (currentNodeId) {
            iterationCount++;
            if (iterationCount > maxIterations) {
                const msg = `Run exceeded maxIterations limit (${maxIterations}).`;
                this.emit({
                    type: "runFailed",
                    runId,
                    nodeId: currentNodeId,
                    error: { message: msg },
                    timestamp: Date.now(),
                });
                return {
                    runId,
                    success: false,
                    error: { message: msg, nodeId: currentNodeId },
                };
            }

            if (signal.aborted) {
                this.emit({
                    type: "runCancelled",
                    runId,
                    timestamp: Date.now(),
                });
                return {
                    runId,
                    success: false,
                    error: { message: "Run cancelled." },
                };
            }

            const node: WorkflowNode = spec.nodes[currentNodeId];
            const task = this.registry.get(node.task)!;
            const visitCount = (nodeVisits.get(currentNodeId) ?? 0) + 1;
            nodeVisits.set(currentNodeId, visitCount);

            this.emit({
                type: "nodeStarted",
                runId,
                nodeId: currentNodeId,
                taskName: node.task,
                iteration: visitCount,
                timestamp: Date.now(),
            });

            // Resolve input
            let resolvedInput: unknown;
            if (node.inputMap) {
                resolvedInput = resolveInputMap(
                    node.inputMap,
                    workflowInput,
                    spec.variables ?? {},
                    nodeOutputs,
                );
            } else {
                // Pipeline mode: use predecessor's output
                resolvedInput = lastOutput ?? workflowInput;
            }

            // Validate resolved input against the task's input schema
            let result: TaskResult;
            const inputError = compileSchemaValidator(task.inputSchema)(
                resolvedInput,
            );
            if (inputError) {
                const message: string = `Input validation failed for task "${node.task}" at node "${currentNodeId}": ${inputError}`;
                result = { kind: "fail", error: { message } };
            } else {
                // Execute task
                try {
                    const ctx: TaskContext = {
                        runId,
                        nodeId: currentNodeId,
                        signal,
                        secrets,
                        log: (level, msg, data?) =>
                            logger.log(
                                level,
                                `[${currentNodeId}] ${msg}`,
                                data,
                            ),
                    };
                    result = await task.execute(resolvedInput, ctx);
                } catch (err: unknown) {
                    const message =
                        err instanceof Error ? err.message : String(err);
                    result = {
                        kind: "fail",
                        error: { message },
                    };
                }
            }

            // Validate output against the task's output schema (on success)
            if (result.kind !== "fail") {
                const outputError = compileSchemaValidator(task.outputSchema)(
                    result.output,
                );
                if (outputError) {
                    result = {
                        kind: "fail",
                        error: {
                            message: `Output validation failed for task "${node.task}" at node "${currentNodeId}": ${outputError}`,
                        },
                    };
                }
            }

            // Handle result
            if (result.kind === "fail") {
                this.emit({
                    type: "nodeFailed",
                    runId,
                    nodeId: currentNodeId,
                    taskName: node.task,
                    error: result.error,
                    timestamp: Date.now(),
                });

                if (node.onError) {
                    // Redirect execution to the error handler node.
                    // Set the error data as lastOutput so the error node
                    // receives it via pipeline mode (or its own inputMap).
                    const errorInput: ErrorInput = {
                        message: result.error.message,
                        data: result.error.data,
                        nodeId: currentNodeId,
                        taskName: node.task,
                    };
                    lastOutput = errorInput;
                    currentNodeId = node.onError;
                    continue;
                }

                this.emit({
                    type: "runFailed",
                    runId,
                    nodeId: currentNodeId,
                    error: result.error,
                    timestamp: Date.now(),
                });
                return {
                    runId,
                    success: false,
                    error: {
                        message: result.error.message,
                        nodeId: currentNodeId,
                    },
                };
            }

            // Success or branch (both carry output, but branch output is optional)
            const output = result.output;
            nodeOutputs.set(currentNodeId, output);
            lastOutput = output;

            this.emit({
                type: "nodeCompleted",
                runId,
                nodeId: currentNodeId,
                taskName: node.task,
                output,
                iteration: visitCount,
                timestamp: Date.now(),
            });

            // Determine next node
            if (node.next === undefined) {
                // Terminal node
                currentNodeId = undefined;
            } else if (typeof node.next === "string") {
                currentNodeId = node.next;
            } else {
                // Decision map
                if (result.kind !== "branch") {
                    this.emit({
                        type: "runFailed",
                        runId,
                        nodeId: currentNodeId,
                        error: {
                            message: `Node has a decision map but task returned kind "${result.kind}" instead of "branch".`,
                        },
                        timestamp: Date.now(),
                    });
                    return {
                        runId,
                        success: false,
                        error: {
                            message: `Expected branch result from "${node.task}" at node "${currentNodeId}".`,
                            nodeId: currentNodeId,
                        },
                    };
                }
                const target: string | undefined = node.next[result.branch];
                if (!target) {
                    this.emit({
                        type: "runFailed",
                        runId,
                        nodeId: currentNodeId,
                        error: {
                            message: `Unknown branch label "${result.branch}" from task "${node.task}".`,
                        },
                        timestamp: Date.now(),
                    });
                    return {
                        runId,
                        success: false,
                        error: {
                            message: `Unknown branch "${result.branch}" at node "${currentNodeId}".`,
                            nodeId: currentNodeId,
                        },
                    };
                }
                currentNodeId = target;
            }
        }

        this.emit({
            type: "runCompleted",
            runId,
            output: lastOutput,
            timestamp: Date.now(),
        });

        return { runId, success: true, output: lastOutput };
    }
}

/**
 * Resolve an inputMap against the data context.
 */
function resolveInputMap(
    inputMap: Record<string, string>,
    workflowInput: Record<string, unknown>,
    variables: Record<string, unknown>,
    nodeOutputs: Map<string, unknown>,
): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [field, path] of Object.entries(inputMap)) {
        result[field] = resolvePath(
            path,
            workflowInput,
            variables,
            nodeOutputs,
        );
    }
    return result;
}

function resolvePath(
    path: string,
    workflowInput: Record<string, unknown>,
    variables: Record<string, unknown>,
    nodeOutputs: Map<string, unknown>,
): unknown {
    const parts = path.split(".");

    if (parts[0] === "input") {
        return traverseObject(workflowInput, parts.slice(1));
    }
    if (parts[0] === "variables") {
        return traverseObject(variables, parts.slice(1));
    }
    if (parts[0] === "nodes") {
        // nodes.<nodeId>.output.<field...>
        const nodeId = parts[1];
        const output = nodeOutputs.get(nodeId);
        // Skip "output" at parts[2]
        return traverseObject(
            output as Record<string, unknown>,
            parts.slice(3),
        );
    }
    return undefined;
}

function traverseObject(
    obj: Record<string, unknown> | undefined,
    keys: string[],
): unknown {
    let current: unknown = obj;
    for (const key of keys) {
        if (current == null || typeof current !== "object") {
            return undefined;
        }
        current = (current as Record<string, unknown>)[key];
    }
    return current;
}

function generateRunId(): string {
    return `run-${randomUUID()}`;
}
