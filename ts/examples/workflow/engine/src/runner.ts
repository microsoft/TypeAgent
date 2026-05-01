// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    WorkflowSpec,
    WorkflowNode,
    TaskContext,
    TaskResult,
    SecretProvider,
    validateWorkflowSpec,
} from "workflow-model";
import { TaskRegistry } from "./taskRegistry.js";
import { WorkflowEvent, WorkflowEventListener } from "./events.js";

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
        const workflowInput = options?.input ?? {};

        // Data context: stores outputs from all executed nodes
        const nodeOutputs = new Map<string, unknown>();

        this.emit({
            type: "runStarted",
            runId,
            workflowName: spec.name,
            timestamp: Date.now(),
        });

        let currentNodeId: string | undefined = spec.entry;
        let lastOutput: unknown = undefined;

        while (currentNodeId) {
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

            this.emit({
                type: "nodeStarted",
                runId,
                nodeId: currentNodeId,
                taskName: node.task,
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

            // Execute task
            let result: TaskResult;
            try {
                const ctx: TaskContext = {
                    runId,
                    nodeId: currentNodeId,
                    signal,
                    secrets,
                    log: (_level, _msg, _data?) => {
                        // TODO: wire to debug package
                    },
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
                    // Route to error handler
                    const errorInput: ErrorInput = {
                        message: result.error.message,
                        data: result.error.data,
                        nodeId: currentNodeId,
                        taskName: node.task,
                    };
                    const errorNode = spec.nodes[node.onError];
                    const errorTask = this.registry.get(errorNode.task)!;
                    try {
                        const errorCtx: TaskContext = {
                            runId,
                            nodeId: node.onError,
                            signal,
                            secrets,
                            log: () => {},
                        };
                        await errorTask.execute(errorInput, errorCtx);
                    } catch {
                        // Error handler itself failed; ignore
                    }
                    // After error handler, the run ends
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

            // Success or branch
            const output = result.kind === "ok" ? result.output : result.output;
            nodeOutputs.set(currentNodeId, output);
            lastOutput = output;

            this.emit({
                type: "nodeCompleted",
                runId,
                nodeId: currentNodeId,
                taskName: node.task,
                output,
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
                const target = node.next[result.branch];
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

let runCounter = 0;
function generateRunId(): string {
    runCounter++;
    return `run-${Date.now()}-${runCounter}`;
}
