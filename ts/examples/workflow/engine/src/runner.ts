// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { randomUUID } from "node:crypto";
import AjvModule from "ajv";
import {
    WorkflowIR,
    WorkflowNode,
    Template,
    TaskNode,
    LoopNode,
    TaskContext,
    TaskResult,
    TaskPolicy,
    TaskPolicyMode,
    ApprovalFn,
    validateWorkflowIR,
} from "workflow-model";
import { TaskRegistry } from "./taskRegistry.js";
import { WorkflowEvent, WorkflowEventListener } from "./events.js";

const AjvConstructor = (AjvModule as any).default ?? AjvModule;

// ---- Scope context ----

interface ScopeContext {
    /** The input namespace ($from: "input"). */
    input: Record<string, unknown>;
    /** The constant namespace ($from: "constant"). */
    constants: Map<string, unknown>;
    /** The scope namespace ($from: "scope") - bind names from executed nodes. */
    bindings: Map<string, unknown>;
    /** The state namespace ($from: "state") - only set inside loop bodies. */
    state?: Record<string, unknown>;
}

// ---- Template resolution ----

/**
 * Recursively evaluate a template against a scope context.
 *
 * - Objects with `$from`: resolve as a namespace reference.
 * - Objects with `$literal`: return the argument verbatim.
 * - Arrays: evaluate each element.
 * - Plain objects: evaluate each property value.
 * - Primitives (string, number, boolean, null): pass through.
 */
function resolveTemplate(template: Template, scope: ScopeContext): unknown {
    if (template === null || template === undefined) {
        return template;
    }
    if (typeof template !== "object") {
        return template; // string, number, boolean
    }
    if (Array.isArray(template)) {
        return template.map((t) => resolveTemplate(t, scope));
    }

    const obj = template as Record<string, unknown>;

    // $from reference
    if ("$from" in obj) {
        return resolveFromRef(obj, scope);
    }

    // $literal escape
    if ("$literal" in obj) {
        return obj["$literal"];
    }

    // Plain object: evaluate each property
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
        result[key] = resolveTemplate(value as Template, scope);
    }
    return result;
}

function resolveFromRef(
    ref: Record<string, unknown>,
    scope: ScopeContext,
): unknown {
    const from = ref["$from"] as string;
    const name = ref["name"] as string;
    const path = ref["path"] as (string | number)[] | undefined;
    const optional = ref["optional"] as boolean | undefined;

    let value: unknown;
    switch (from) {
        case "input":
            value = scope.input[name];
            break;
        case "constant":
            value = scope.constants.get(name);
            break;
        case "scope":
            value = scope.bindings.get(name);
            break;
        case "state":
            value = scope.state?.[name];
            break;
        default:
            throw new EngineError(`Unknown $from namespace: "${from}"`);
    }

    if (value === undefined) {
        if (optional) return null;
        throw new EngineError(
            `Reference unresolved: $from "${from}", name "${name}"`,
        );
    }

    // Path projection (RFC 6901 semantics)
    if (path) {
        for (const segment of path) {
            if (value === null || value === undefined) {
                if (optional) return null;
                throw new EngineError(
                    `Path projection failed at "${segment}" on null/undefined`,
                );
            }
            if (typeof segment === "number") {
                if (!Array.isArray(value)) {
                    if (optional) return null;
                    throw new EngineError(
                        `Path projection: expected array at index ${segment}`,
                    );
                }
                value = (value as unknown[])[segment];
            } else {
                if (typeof value !== "object" || Array.isArray(value)) {
                    if (optional) return null;
                    throw new EngineError(
                        `Path projection: expected object at key "${segment}"`,
                    );
                }
                value = (value as Record<string, unknown>)[segment];
            }
        }
    }

    return value;
}

// ---- Error types ----

class EngineError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "EngineError";
    }
}

class TaskFailure extends Error {
    constructor(
        public readonly taskError: { message: string; data?: unknown },
        public readonly taskName: string,
        public readonly nodeId: string,
        public readonly triggerInputs: unknown,
    ) {
        super(taskError.message);
        this.name = "TaskFailure";
    }
}

// ---- Scope exit ----

type ScopeExit =
    | { kind: "terminal" }
    | { kind: "sentinel"; sentinel: "@iterate" | "@exit" };

// ---- Public types ----

export interface RunOptions {
    /** Input data for the workflow. */
    input?: Record<string, unknown>;
    /** Abort signal for cooperative cancellation. */
    signal?: AbortSignal;
    /**
     * Per-task policy for side-effecting tasks.
     * Keys are task names; values are "allow", "prompt", or "deny".
     * Tasks with sideEffects=true default to "prompt" if not specified.
     * Tasks without sideEffects are always allowed.
     *
     * Secure-by-default: callers must explicitly allow side-effecting tasks
     * via policy or an approval callback.
     *
     * NOTE: Temporary guardrail. See TaskDefinition.sideEffects.
     */
    policy?: TaskPolicy;
    /**
     * Callback for tasks whose policy is "prompt".
     * Called with (taskName, resolvedInputs); return true to allow.
     * If not provided, "prompt" is treated as "deny".
     */
    approve?: ApprovalFn;
}

export interface RunResult {
    runId: string;
    success: boolean;
    output?: unknown;
    error?: { message: string; nodeId?: string | undefined };
}

// ---- Engine ----

export class WorkflowEngine {
    private listeners: WorkflowEventListener[] = [];
    private ajv = new AjvConstructor({ strict: false });
    private validatorCache = new Map<
        string,
        ReturnType<typeof this.ajv.compile>
    >();

    constructor(private readonly registry: TaskRegistry) {}

    /**
     * Get or create a cached JSON schema validator.
     * Keyed by JSON.stringify of the schema to handle structurally
     * identical schemas from parsed JSON (no reference identity).
     */
    private getValidator(schema: Record<string, unknown>) {
        const key = JSON.stringify(schema);
        let v = this.validatorCache.get(key);
        if (!v) {
            v = this.ajv.compile(schema);
            this.validatorCache.set(key, v);
        }
        return v;
    }

    on(listener: WorkflowEventListener): void {
        this.listeners.push(listener);
    }

    off(listener: WorkflowEventListener): void {
        const idx = this.listeners.indexOf(listener);
        if (idx >= 0) this.listeners.splice(idx, 1);
    }

    private emit(event: WorkflowEvent): void {
        for (const listener of this.listeners) {
            listener(event);
        }
    }

    async run(ir: WorkflowIR, options?: RunOptions): Promise<RunResult> {
        const input = options?.input;
        const policy = options?.policy;
        const approve = options?.approve;
        const abortSignalArg = options?.signal;

        // Validate
        const validation = validateWorkflowIR(ir, this.registry.all());
        if (!validation.valid) {
            const msgs = validation.errors.map(
                (e) => `${e.path}: ${e.message}`,
            );
            return {
                runId: "",
                success: false,
                error: { message: `Validation failed:\n${msgs.join("\n")}` },
            };
        }

        const runId = `run-${randomUUID()}`;
        const abortSignal = abortSignalArg ?? new AbortController().signal;

        // Validate workflow input against inputSchema.
        if (ir.inputSchema && input) {
            const validate = this.getValidator(ir.inputSchema);
            if (!validate(input)) {
                const msg = this.ajv.errorsText(validate.errors);
                return {
                    runId: "",
                    success: false,
                    error: {
                        message: `Input schema violation: ${msg}`,
                    },
                };
            }
        }

        // Build constants
        const constants = new Map<string, unknown>();
        for (const [name, def] of Object.entries(ir.constants ?? {})) {
            constants.set(name, def.value);
        }

        const scope: ScopeContext = {
            input: input ?? {},
            constants,
            bindings: new Map(),
        };

        const scopePath = [ir.name];

        this.emit({
            type: "runStarted",
            runId,
            workflowName: ir.name,
            timestamp: Date.now(),
        });

        try {
            await this.executeScope(
                ir.nodes,
                ir.entry,
                scope,
                scopePath,
                runId,
                abortSignal,
                policy,
                approve,
            );

            const output = resolveTemplate(ir.output, scope);

            this.emit({
                type: "runCompleted",
                runId,
                output,
                timestamp: Date.now(),
            });

            return { runId, success: true, output };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            const nodeId = err instanceof TaskFailure ? err.nodeId : undefined;

            this.emit({
                type: "runFailed",
                runId,
                error: { message },
                timestamp: Date.now(),
            });

            return { runId, success: false, error: { message, nodeId } };
        }
    }

    private async executeScope(
        nodes: Record<string, WorkflowNode>,
        entryId: string,
        scope: ScopeContext,
        scopePath: string[],
        runId: string,
        signal: AbortSignal,
        policy?: TaskPolicy,
        approve?: ApprovalFn,
    ): Promise<ScopeExit> {
        let currentId: string | undefined = entryId;
        let pendingError:
            | { error: Record<string, unknown>; trigger: unknown }
            | undefined;

        while (currentId) {
            if (signal.aborted) {
                throw new EngineError("Run cancelled");
            }

            // Sentinels (loop body only)
            if (currentId === "@iterate" || currentId === "@exit") {
                return { kind: "sentinel", sentinel: currentId };
            }

            const node = nodes[currentId];
            if (!node) {
                throw new EngineError(`Node "${currentId}" not found`);
            }

            // If we have a pending error (dispatching to onError target),
            // augment the input namespace for this node only.
            const activeScope: ScopeContext = pendingError
                ? {
                      ...scope,
                      input: {
                          ...scope.input,
                          error: pendingError.error,
                          trigger: pendingError.trigger,
                      },
                  }
                : scope;
            pendingError = undefined;

            switch (node.kind) {
                case "task":
                    currentId = await this.executeTask(
                        node,
                        currentId,
                        activeScope,
                        scope,
                        scopePath,
                        runId,
                        signal,
                        (err, trigger) => {
                            pendingError = { error: err, trigger };
                        },
                        policy,
                        approve,
                    );
                    break;

                case "branch": {
                    const branchNodeId = currentId;
                    this.emit({
                        type: "nodeStarted",
                        runId,
                        nodeId: branchNodeId,
                        scopePath: [...scopePath],
                        timestamp: Date.now(),
                    });
                    currentId = this.executeBranch(node, activeScope);
                    this.emit({
                        type: "nodeCompleted",
                        runId,
                        nodeId: branchNodeId,
                        scopePath: [...scopePath],
                        output: currentId,
                        timestamp: Date.now(),
                    });
                    break;
                }

                case "loop":
                    currentId = await this.executeLoop(
                        node,
                        currentId,
                        scope,
                        scopePath,
                        runId,
                        signal,
                        (err, trigger) => {
                            pendingError = { error: err, trigger };
                        },
                        policy,
                        approve,
                    );
                    break;
            }
        }

        return { kind: "terminal" };
    }

    private async executeTask(
        node: TaskNode,
        nodeId: string,
        resolveScope: ScopeContext,
        bindScope: ScopeContext,
        scopePath: string[],
        runId: string,
        signal: AbortSignal,
        onErrorDispatch: (
            error: Record<string, unknown>,
            trigger: unknown,
        ) => void,
        policy?: TaskPolicy,
        approveFn?: ApprovalFn,
    ): Promise<string | undefined> {
        this.emit({
            type: "nodeStarted",
            runId,
            nodeId,
            scopePath: [...scopePath],
            timestamp: Date.now(),
        });

        const resolvedInput = resolveTemplate(node.inputs, resolveScope);

        try {
            const task = this.registry.get(node.task);
            if (!task) {
                throw new EngineError(
                    `Task "${node.task}" not found in registry`,
                );
            }

            // Policy check for side-effecting tasks.
            // Secure-by-default: side-effecting tasks are ALWAYS gated.
            // Callers must explicitly allow them via policy or approval.
            if (task.sideEffects) {
                const mode: TaskPolicyMode = policy?.[task.name] ?? "prompt";
                if (mode === "deny") {
                    throw new EngineError(
                        `Task "${task.name}" denied by policy`,
                    );
                }
                if (mode === "prompt") {
                    const allowed = approveFn
                        ? await approveFn(task.name, resolvedInput)
                        : false;
                    if (!allowed) {
                        throw new EngineError(
                            `Task "${task.name}" denied: approval not granted`,
                        );
                    }
                }
            }

            const ctx: TaskContext = {
                runId,
                nodeId,
                scopePath: [...scopePath],
                signal,
            };

            const result: TaskResult = await task.execute(resolvedInput, ctx);

            if (result.kind === "fail") {
                throw new TaskFailure(
                    result.error,
                    node.task,
                    nodeId,
                    resolvedInput,
                );
            }

            // Runtime output schema validation.
            if (node.outputSchema) {
                const validate = this.getValidator(node.outputSchema);
                if (!validate(result.output)) {
                    const msg = this.ajv.errorsText(validate.errors);
                    throw new EngineError(
                        `Output schema violation at "${nodeId}" (task "${node.task}"): ${msg}`,
                    );
                }
            }

            if (node.bind) {
                bindScope.bindings.set(node.bind, result.output);
            }

            this.emit({
                type: "nodeCompleted",
                runId,
                nodeId,
                scopePath: [...scopePath],
                output: result.output,
                timestamp: Date.now(),
            });

            return node.next;
        } catch (err) {
            if (node.onError) {
                const errorObj = buildErrorObject(
                    err,
                    node.task,
                    nodeId,
                    scopePath,
                );

                this.emit({
                    type: "nodeFailed",
                    runId,
                    nodeId,
                    scopePath: [...scopePath],
                    error: { message: errorObj["message"] as string },
                    timestamp: Date.now(),
                });

                onErrorDispatch(errorObj, resolvedInput);
                return node.onError;
            }

            // No onError: propagate
            if (err instanceof TaskFailure || err instanceof EngineError) {
                throw err;
            }
            throw new TaskFailure(
                { message: err instanceof Error ? err.message : String(err) },
                node.task,
                nodeId,
                resolvedInput,
            );
        }
    }

    private executeBranch(
        node: {
            selector: Template;
            cases: Record<string, string>;
            default: string;
        },
        scope: ScopeContext,
    ): string {
        const raw = resolveTemplate(node.selector, scope);
        const selector = String(raw);
        return node.cases[selector] ?? node.default;
    }

    private async executeLoop(
        node: LoopNode,
        nodeId: string,
        outerScope: ScopeContext,
        scopePath: string[],
        runId: string,
        signal: AbortSignal,
        onErrorDispatch: (
            error: Record<string, unknown>,
            trigger: unknown,
        ) => void,
        policy?: TaskPolicy,
        approve?: ApprovalFn,
    ): Promise<string | undefined> {
        this.emit({
            type: "nodeStarted",
            runId,
            nodeId,
            scopePath: [...scopePath],
            timestamp: Date.now(),
        });

        // Resolve loop inputs from outer scope
        const loopInput = resolveTemplate(node.inputs, outerScope) as Record<
            string,
            unknown
        >;

        // Initialize state
        let state: Record<string, unknown> = {};
        for (const [name, stateVar] of Object.entries(node.state)) {
            state[name] = resolveTemplate(stateVar.initial, outerScope);
        }

        const bodyScopePath = [...scopePath, `${nodeId}.body`];

        try {
            for (let i = 0; i < node.maxIterations; i++) {
                if (signal.aborted) {
                    throw new EngineError("Run cancelled");
                }

                this.emit({
                    type: "loopIterationStarted",
                    runId,
                    nodeId,
                    scopePath: [...scopePath],
                    iteration: i,
                    timestamp: Date.now(),
                });

                // Create body scope
                const bodyScope: ScopeContext = {
                    input: loopInput,
                    constants: outerScope.constants,
                    bindings: new Map(),
                    state: { ...state },
                };

                // Execute body
                const exit = await this.executeScope(
                    node.body.nodes,
                    node.body.entry,
                    bodyScope,
                    bodyScopePath,
                    runId,
                    signal,
                    policy,
                    approve,
                );

                if (exit.kind === "terminal") {
                    throw new EngineError(
                        `Loop body at "${nodeId}" terminated without sentinel`,
                    );
                }

                if (exit.sentinel === "@exit") {
                    // Resolve output in body scope (state + body bindings)
                    const output = resolveTemplate(node.output, bodyScope);

                    if (node.bind) {
                        outerScope.bindings.set(node.bind, output);
                    }

                    this.emit({
                        type: "loopExited",
                        runId,
                        nodeId,
                        scopePath: [...scopePath],
                        iteration: i,
                        output,
                        timestamp: Date.now(),
                    });

                    this.emit({
                        type: "nodeCompleted",
                        runId,
                        nodeId,
                        scopePath: [...scopePath],
                        output,
                        timestamp: Date.now(),
                    });

                    return node.next;
                }

                // @iterate: compute next state
                const nextState: Record<string, unknown> = {};
                for (const [name, ref] of Object.entries(node.iterateState)) {
                    nextState[name] = resolveTemplate(
                        ref as Template,
                        bodyScope,
                    );
                }
                state = nextState;
            }

            throw new EngineError(
                `LoopMaxIterationsExceeded at "${nodeId}" (limit: ${node.maxIterations})`,
            );
        } catch (err) {
            if (node.onError) {
                const errorObj = buildErrorObject(
                    err,
                    "loop",
                    nodeId,
                    scopePath,
                );

                this.emit({
                    type: "nodeFailed",
                    runId,
                    nodeId,
                    scopePath: [...scopePath],
                    error: { message: errorObj["message"] as string },
                    timestamp: Date.now(),
                });

                onErrorDispatch(errorObj, loopInput);
                return node.onError;
            }
            throw err;
        }
    }
}

function buildErrorObject(
    err: unknown,
    taskName: string,
    nodeId: string,
    scopePath: string[],
): Record<string, unknown> {
    if (err instanceof TaskFailure) {
        return {
            code: "TASK_ERROR",
            message: err.taskError.message,
            source: "task",
            task: err.taskName,
            node: err.nodeId,
            scopePath: [...scopePath],
            data: err.taskError.data,
        };
    }
    return {
        code: "RUNTIME_ERROR",
        message: err instanceof Error ? err.message : String(err),
        source: "runtime",
        task: taskName,
        node: nodeId,
        scopePath: [...scopePath],
    };
}
