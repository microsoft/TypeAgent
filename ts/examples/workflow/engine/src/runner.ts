// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { randomUUID } from "node:crypto";
import Debug from "debug";
import {
    WorkflowIR,
    WorkflowNode,
    Template,
    TaskNode,
    LoopNode,
    ForkNode,
    ForkMapNode,
    JSONSchema,
    TaskContext,
    TaskConstraints,
    TaskResult,
    TaskPolicy,
    TaskPolicyMode,
    ApprovalFn,
    validateWorkflowIR,
    isNeverSchema,
} from "workflow-model";
import { TaskRegistry } from "./taskRegistry.js";
import { WorkflowEvent, WorkflowEventListener } from "./events.js";
import { createAjv } from "./ajv.js";

const debug = Debug("typeagent:workflow:engine");

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
    | {
          kind: "terminal";
          errorHandled?:
              | { message: string; nodeId: string | undefined }
              | undefined;
      }
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
     * All tasks default to "prompt" unless marked sideEffects: false.
     * Tasks with sideEffects: false bypass policy entirely.
     *
     * Secure-by-default: callers must explicitly allow side-effecting tasks
     * via policy or an approval callback.
     *
     * NOTE: Temporary guardrail. See TaskDefinition.sideEffects.
     */
    policy?: TaskPolicy;
    /**
     * Callback for tasks whose policy is "prompt".
     * Called with (taskName, resolvedInputs); return an ApprovalResult.
     * If not provided, "prompt" is treated as "deny".
     */
    approve?: ApprovalFn;
    /**
     * Maximum time in milliseconds a single task execution may take.
     * When exceeded, the task is aborted via AbortSignal.
     * Defaults to 60000 (60 seconds). Set to 0 or Infinity to disable.
     */
    taskTimeoutMs?: number;
    /**
     * Constraints passed to task implementations for enforcement.
     * - allowedCommands: restrict which binaries shell.exec can run
     * - blockedHosts: additional hostnames to block in http.get
     * - allowedHosts: if set, only these hostnames are permitted in http.get
     */
    constraints?: TaskConstraints;
    /**
     * Skip structural validation before running. Use only in tests that
     * intentionally exercise invalid IRs for error-path coverage.
     */
    skipValidation?: boolean;
    /**
     * Enable defense-in-depth runtime checks that duplicate static validation.
     * Defaults to the value of `skipValidation` — when static validation is
     * skipped these checks act as the safety net; when static validation runs
     * they are redundant.  Set explicitly to override.
     */
    defenseInDepth?: boolean;
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
    private ajv = createAjv();
    private validatorCache = new Map<
        string,
        ReturnType<typeof this.ajv.compile>
    >();
    private defenseInDepth = true;

    constructor(private readonly registry: TaskRegistry) {}

    /**
     * Get or create a cached JSON schema validator.
     * Keyed by JSON.stringify of the schema to handle structurally
     * identical schemas from parsed JSON (no reference identity).
     */
    private getValidator(schema: JSONSchema) {
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
        const constraints = options?.constraints;
        const defenseInDepth =
            options?.defenseInDepth ?? (options?.skipValidation ? true : false);
        this.defenseInDepth = defenseInDepth;

        // Default timeout: 60 seconds. 0 or Infinity disables.
        const DEFAULT_TIMEOUT_MS = 60_000;
        const rawTimeout = options?.taskTimeoutMs ?? DEFAULT_TIMEOUT_MS;
        const taskTimeoutMs =
            rawTimeout === 0 || rawTimeout === Infinity
                ? undefined
                : rawTimeout;

        // Validate
        if (!options?.skipValidation) {
            const validation = validateWorkflowIR(ir, this.registry.all());
            if (!validation.valid) {
                const msgs = validation.errors.map(
                    (e) => `${e.path}: ${e.message}`,
                );
                return {
                    runId: "",
                    success: false,
                    error: {
                        message: `Validation failed:\n${msgs.join("\n")}`,
                    },
                };
            }
        }

        const runId = `run-${randomUUID()}`;
        const abortSignal = abortSignalArg ?? new AbortController().signal;

        debug("run %s started (workflow: %s)", runId, ir.name);

        // Validate workflow input against inputSchema.
        if (ir.inputSchema) {
            const validate = this.getValidator(ir.inputSchema);
            if (!validate(input ?? {})) {
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

        // Build constants, validating each against its declared schema.
        // Defense-in-depth: static validator already checks this via
        // jsonValueToSchema + isStructuralSubtype.
        const constants = new Map<string, unknown>();
        for (const [name, def] of Object.entries(ir.constants ?? {})) {
            if (this.defenseInDepth && def.schema) {
                const validate = this.getValidator(def.schema);
                if (!validate(def.value)) {
                    const msg = this.ajv.errorsText(validate.errors);
                    return {
                        runId,
                        success: false,
                        error: {
                            message: `Constant "${name}" schema violation: ${msg}`,
                        },
                    };
                }
            }
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
            const exit = await this.executeScope(
                ir.nodes,
                ir.entry,
                scope,
                scopePath,
                runId,
                abortSignal,
                policy,
                approve,
                taskTimeoutMs,
                constraints,
            );

            let output: unknown;
            try {
                output = resolveTemplate(ir.output, scope);
            } catch (resolveErr) {
                // Output resolution failed. If we went through an error
                // recovery path (e.g. cleanup), report the original error
                // instead of the confusing "unresolved reference" message.
                if (exit.kind === "terminal" && exit.errorHandled) {
                    const { message, nodeId } = exit.errorHandled;
                    debug(
                        "run %s failed (error handled, output unresolvable): %s",
                        runId,
                        message,
                    );
                    this.emit({
                        type: "runFailed",
                        runId,
                        error: { message },
                        timestamp: Date.now(),
                    });
                    return {
                        runId,
                        success: false,
                        error: { message, nodeId },
                    };
                }
                throw resolveErr;
            }

            debug("run %s completed", runId);

            // Validate workflow output against outputSchema
            if (ir.outputSchema) {
                const validate = this.getValidator(ir.outputSchema);
                if (!validate(output)) {
                    const msg = this.ajv.errorsText(validate.errors);
                    throw new EngineError(
                        `Workflow output schema violation: ${msg}`,
                    );
                }
            }

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
        taskTimeoutMs?: number,
        constraints?: TaskConstraints,
        iteration?: number,
    ): Promise<ScopeExit> {
        let currentId: string | undefined = entryId;
        let pendingError:
            | { error: Record<string, unknown>; trigger: unknown }
            | undefined;
        // Track the first error that was handled via onError so the caller
        // knows this scope completed through an error-recovery path.
        let handledError:
            | { message: string; nodeId: string | undefined }
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
                            if (!handledError) {
                                handledError = {
                                    message: err["message"] as string,
                                    nodeId: err["node"] as string | undefined,
                                };
                            }
                        },
                        policy,
                        approve,
                        taskTimeoutMs,
                        constraints,
                        iteration,
                    );
                    break;

                case "branch": {
                    const branchNodeId = currentId;
                    this.emit({
                        type: "nodeStarted",
                        runId,
                        nodeId: branchNodeId,
                        scopePath: [...scopePath],
                        ...(iteration !== undefined ? { iteration } : {}),
                        timestamp: Date.now(),
                    });
                    currentId = this.executeBranch(node, activeScope);
                    this.emit({
                        type: "nodeCompleted",
                        runId,
                        nodeId: branchNodeId,
                        scopePath: [...scopePath],
                        ...(iteration !== undefined ? { iteration } : {}),
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
                            if (!handledError) {
                                handledError = {
                                    message: err["message"] as string,
                                    nodeId: err["node"] as string | undefined,
                                };
                            }
                        },
                        policy,
                        approve,
                        taskTimeoutMs,
                        constraints,
                    );
                    break;

                case "fork":
                    currentId = await this.executeFork(
                        node,
                        currentId,
                        scope,
                        scopePath,
                        runId,
                        signal,
                        (err, trigger) => {
                            pendingError = { error: err, trigger };
                            if (!handledError) {
                                handledError = {
                                    message: err["message"] as string,
                                    nodeId: err["node"] as string | undefined,
                                };
                            }
                        },
                        policy,
                        approve,
                        taskTimeoutMs,
                        constraints,
                    );
                    break;

                case "forkMap":
                    currentId = await this.executeForkMap(
                        node,
                        currentId,
                        scope,
                        scopePath,
                        runId,
                        signal,
                        (err, trigger) => {
                            pendingError = { error: err, trigger };
                            if (!handledError) {
                                handledError = {
                                    message: err["message"] as string,
                                    nodeId: err["node"] as string | undefined,
                                };
                            }
                        },
                        policy,
                        approve,
                        taskTimeoutMs,
                        constraints,
                    );
                    break;
            }
        }

        return handledError
            ? { kind: "terminal", errorHandled: handledError }
            : { kind: "terminal" };
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
        taskTimeoutMs?: number,
        constraints?: TaskConstraints,
        iteration?: number,
    ): Promise<string | undefined> {
        this.emit({
            type: "nodeStarted",
            runId,
            nodeId,
            scopePath: [...scopePath],
            ...(iteration !== undefined ? { iteration } : {}),
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

            // Policy check: secure-by-default.
            // ALL tasks are gated unless explicitly marked sideEffects: false.
            // This ensures new or third-party tasks cannot bypass policy.
            if (task.sideEffects !== false) {
                const mode: TaskPolicyMode = policy?.[task.name] ?? "prompt";
                if (mode === "deny") {
                    throw new EngineError(
                        `Task "${task.name}" denied by policy`,
                    );
                }
                if (mode === "prompt") {
                    const decision = approveFn
                        ? await approveFn(task.name, resolvedInput)
                        : { kind: "denied" as const };
                    if (decision.kind !== "approved") {
                        throw new EngineError(
                            `Task "${task.name}" denied: approval ${decision.kind}`,
                        );
                    }
                }
            }

            debug("task %s (%s) executing", nodeId, node.task);

            // Build per-task signal with optional timeout.
            // Node-level timeoutMs overrides the global default.
            const effectiveTimeout = node.timeoutMs ?? taskTimeoutMs;
            let taskSignal = signal;
            let taskAbortController: AbortController | undefined;
            if (effectiveTimeout !== undefined) {
                taskAbortController = new AbortController();
                // Propagate parent signal
                if (signal.aborted) {
                    taskAbortController.abort(signal.reason);
                } else {
                    signal.addEventListener(
                        "abort",
                        () => taskAbortController!.abort(signal.reason),
                        { once: true },
                    );
                }
                taskSignal = taskAbortController.signal;
            }

            const ctx: TaskContext = {
                runId,
                nodeId,
                scopePath: [...scopePath],
                signal: taskSignal,
                ...(constraints ? { constraints } : {}),
                ...(node.outputSchema
                    ? { outputSchema: node.outputSchema }
                    : {}),
            };

            let result: TaskResult;
            if (effectiveTimeout !== undefined) {
                const timeoutSignal = AbortSignal.timeout(effectiveTimeout);
                const onParentAbort = () =>
                    taskAbortController!.abort(signal.reason);
                const onTimeoutAbort = () =>
                    taskAbortController!.abort("Task timed out");
                signal.addEventListener("abort", onParentAbort, {
                    once: true,
                });
                timeoutSignal.addEventListener("abort", onTimeoutAbort, {
                    once: true,
                });
                try {
                    result = await task.execute(resolvedInput, ctx);
                } catch (e) {
                    if (timeoutSignal.aborted) {
                        throw new EngineError(
                            `Task "${node.task}" at "${nodeId}" timed out after ${effectiveTimeout}ms`,
                        );
                    }
                    throw e;
                } finally {
                    signal.removeEventListener("abort", onParentAbort);
                    timeoutSignal.removeEventListener("abort", onTimeoutAbort);
                }
                if (timeoutSignal.aborted) {
                    throw new EngineError(
                        `Task "${node.task}" at "${nodeId}" timed out after ${effectiveTimeout}ms`,
                    );
                }
            } else {
                result = await task.execute(resolvedInput, ctx);
            }

            if (result.kind === "fail") {
                throw new TaskFailure(
                    result.error,
                    node.task,
                    nodeId,
                    resolvedInput,
                );
            }

            // Never-output contract: a task with outputSchema { "not": {} }
            // must always fail. If it returned ok, the implementation is broken.
            if (isNeverSchema(node.outputSchema)) {
                throw new EngineError(
                    `Task "${node.task}" at "${nodeId}" has never-output schema but returned ok.`,
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
                ...(iteration !== undefined ? { iteration } : {}),
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
                    ...(iteration !== undefined ? { iteration } : {}),
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
        const next = node.cases[selector] ?? node.default;
        if (!next) {
            throw new EngineError(
                `Branch selector resolved to "${selector}" but no matching case or default exists`,
            );
        }
        debug("branch selector=%s -> %s", selector, next);
        return next;
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
        taskTimeoutMs?: number,
        constraints?: TaskConstraints,
    ): Promise<string | undefined> {
        this.emit({
            type: "nodeStarted",
            runId,
            nodeId,
            scopePath: [...scopePath],
            timestamp: Date.now(),
        });

        // Resolve loop inputs from outer scope and validate against inputSchema (§5.4 step 1)
        const loopInput = resolveTemplate(node.inputs, outerScope) as Record<
            string,
            unknown
        >;

        if (node.body.inputSchema) {
            const validate = this.getValidator(node.body.inputSchema);
            if (!validate(loopInput)) {
                const msg = this.ajv.errorsText(validate.errors);
                throw new EngineError(
                    `Loop "${nodeId}" input schema violation: ${msg}`,
                );
            }
        }

        // Initialize state and validate against state[*].schema (§5.4 step 2)
        let state: Record<string, unknown> = {};
        for (const [name, stateVar] of Object.entries(node.state)) {
            state[name] = resolveTemplate(stateVar.initial, outerScope);
            if (stateVar.schema) {
                const validate = this.getValidator(stateVar.schema);
                if (!validate(state[name])) {
                    const msg = this.ajv.errorsText(validate.errors);
                    throw new EngineError(
                        `Loop "${nodeId}" state "${name}" initial value schema violation: ${msg}`,
                    );
                }
            }
        }

        const bodyScopePath = [...scopePath, `${nodeId}.body`];
        const maxIter = node.maxIterations ?? 10000;

        try {
            for (let i = 0; i < maxIter; i++) {
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
                    taskTimeoutMs,
                    constraints,
                    i,
                );

                if (exit.kind === "terminal") {
                    throw new EngineError(
                        `Loop body at "${nodeId}" terminated without sentinel`,
                    );
                }

                if (exit.sentinel === "@exit") {
                    // Resolve output in body scope (state + body bindings)
                    const output = resolveTemplate(node.body.output, bodyScope);

                    // Validate output against outputSchema (§5.4 step 4)
                    if (node.body.outputSchema) {
                        const validate = this.getValidator(
                            node.body.outputSchema,
                        );
                        if (!validate(output)) {
                            const msg = this.ajv.errorsText(validate.errors);
                            throw new EngineError(
                                `Loop "${nodeId}" output schema violation: ${msg}`,
                            );
                        }
                    }

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

                // @iterate: compute next state and validate (§5.4 step 4)
                const nextState: Record<string, unknown> = {};
                for (const [name, ref] of Object.entries(node.iterateState)) {
                    nextState[name] = resolveTemplate(
                        ref as Template,
                        bodyScope,
                    );
                    const stateVar = node.state[name];
                    if (stateVar?.schema) {
                        const validate = this.getValidator(stateVar.schema);
                        if (!validate(nextState[name])) {
                            const msg = this.ajv.errorsText(validate.errors);
                            throw new EngineError(
                                `Loop "${nodeId}" iterateState "${name}" schema violation: ${msg}`,
                            );
                        }
                    }
                }
                state = nextState;
            }

            throw new EngineError(
                `LoopMaxIterationsExceeded at "${nodeId}" (limit: ${maxIter})`,
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
    private async executeFork(
        node: ForkNode,
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
        taskTimeoutMs?: number,
        constraints?: TaskConstraints,
    ): Promise<string | undefined> {
        const branchNames = Object.keys(node.branches);

        // Defense-in-depth: static validator already checks fork min-2 branches.
        if (this.defenseInDepth && branchNames.length < 2) {
            throw new EngineError(
                `Fork "${nodeId}" must have at least 2 branches, got ${branchNames.length}`,
            );
        }

        this.emit({
            type: "nodeStarted",
            runId,
            nodeId,
            scopePath: [...scopePath],
            timestamp: Date.now(),
        });

        this.emit({
            type: "forkStarted",
            runId,
            nodeId,
            scopePath: [...scopePath],
            branchNames,
            timestamp: Date.now(),
        });

        try {
            const concurrency = node.maxConcurrency ?? branchNames.length;
            const results: Record<string, unknown> = {};

            // Execute branches with concurrency limiting
            const executing = new Set<Promise<void>>();
            const branchQueue = [...branchNames];

            const runBranch = async (bName: string) => {
                const branch = node.branches[bName];
                const branchInput = resolveTemplate(
                    branch.inputs,
                    outerScope,
                ) as Record<string, unknown>;
                const branchScope: ScopeContext = {
                    input: branchInput,
                    constants: outerScope.constants,
                    bindings: new Map(),
                };
                const branchScopePath = [...scopePath, `${nodeId}.${bName}`];
                await this.executeScope(
                    branch.scope.nodes,
                    branch.scope.entry,
                    branchScope,
                    branchScopePath,
                    runId,
                    signal,
                    policy,
                    approve,
                    taskTimeoutMs,
                    constraints,
                );
                results[bName] = resolveTemplate(
                    branch.scope.output,
                    branchScope,
                );
            };

            while (branchQueue.length > 0 || executing.size > 0) {
                while (branchQueue.length > 0 && executing.size < concurrency) {
                    const bName = branchQueue.shift()!;
                    const p = runBranch(bName).then(() => {
                        executing.delete(p);
                    });
                    executing.add(p);
                }
                if (executing.size > 0) {
                    await Promise.race(executing);
                }
            }

            if (node.bind) {
                outerScope.bindings.set(node.bind, results);
            }

            this.emit({
                type: "forkCompleted",
                runId,
                nodeId,
                scopePath: [...scopePath],
                output: results,
                timestamp: Date.now(),
            });

            this.emit({
                type: "nodeCompleted",
                runId,
                nodeId,
                scopePath: [...scopePath],
                output: results,
                timestamp: Date.now(),
            });

            return node.next;
        } catch (err) {
            if (node.onError) {
                const errorObj = buildErrorObject(
                    err,
                    "fork",
                    nodeId,
                    scopePath,
                );

                this.emit({
                    type: "forkFailed",
                    runId,
                    nodeId,
                    scopePath: [...scopePath],
                    error: { message: errorObj["message"] as string },
                    timestamp: Date.now(),
                });

                onErrorDispatch(errorObj, {});
                return node.onError;
            }
            throw err;
        }
    }

    private async executeForkMap(
        node: ForkMapNode,
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
        taskTimeoutMs?: number,
        constraints?: TaskConstraints,
    ): Promise<string | undefined> {
        // Defense-in-depth: static validator already checks forkMap state refs.
        if (this.defenseInDepth && containsStateRef(node.body)) {
            throw new EngineError(
                `forkMap "${nodeId}": body must not reference $from "state" (forkMap has no state; use loop for stateful iteration)`,
            );
        }

        this.emit({
            type: "nodeStarted",
            runId,
            nodeId,
            scopePath: [...scopePath],
            timestamp: Date.now(),
        });

        try {
            const collection = resolveTemplate(
                node.collection,
                outerScope,
            ) as unknown[];
            if (!Array.isArray(collection)) {
                throw new EngineError(
                    `forkMap at "${nodeId}": collection did not resolve to an array`,
                );
            }

            const maxIter = node.maxIterations ?? collection.length;
            const items = collection.slice(0, maxIter);
            const concurrency = node.maxConcurrency ?? items.length;
            const results: unknown[] = new Array(items.length).fill(null);

            const executing = new Set<Promise<void>>();
            const indexQueue = items.map((_, i) => i);

            const runItem = async (index: number) => {
                this.emit({
                    type: "forkMapIterationStarted",
                    runId,
                    nodeId,
                    scopePath: [...scopePath],
                    index,
                    timestamp: Date.now(),
                });

                const itemInput: Record<string, unknown> = {
                    [node.elementParam]: items[index],
                };
                if (node.inputs) {
                    const resolvedInputs = resolveTemplate(
                        node.inputs,
                        outerScope,
                    ) as Record<string, unknown>;
                    Object.assign(itemInput, resolvedInputs);
                }
                const itemScope: ScopeContext = {
                    input: itemInput,
                    constants: outerScope.constants,
                    bindings: new Map(),
                };
                const itemScopePath = [...scopePath, `${nodeId}[${index}]`];
                await this.executeScope(
                    node.body.nodes,
                    node.body.entry,
                    itemScope,
                    itemScopePath,
                    runId,
                    signal,
                    policy,
                    approve,
                    taskTimeoutMs,
                    constraints,
                );

                results[index] = resolveTemplate(node.body.output, itemScope);

                this.emit({
                    type: "forkMapIterationCompleted",
                    runId,
                    nodeId,
                    scopePath: [...scopePath],
                    index,
                    output: results[index],
                    timestamp: Date.now(),
                });
            };

            while (indexQueue.length > 0 || executing.size > 0) {
                while (indexQueue.length > 0 && executing.size < concurrency) {
                    const idx = indexQueue.shift()!;
                    const p = runItem(idx).then(() => {
                        executing.delete(p);
                    });
                    executing.add(p);
                }
                if (executing.size > 0) {
                    await Promise.race(executing);
                }
            }

            if (node.bind) {
                outerScope.bindings.set(node.bind, results);
            }

            this.emit({
                type: "nodeCompleted",
                runId,
                nodeId,
                scopePath: [...scopePath],
                output: results,
                timestamp: Date.now(),
            });

            return node.next;
        } catch (err) {
            if (node.onError) {
                const errorObj = buildErrorObject(
                    err,
                    "forkMap",
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

                onErrorDispatch(errorObj, {});
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

/**
 * Recursively check whether any template in a WorkflowScope contains
 * `$from: "state"` references. Used to reject state refs in forkMap bodies.
 */
function containsStateRef(scope: {
    nodes: Record<string, WorkflowNode>;
    output: Template;
}): boolean {
    function checkTemplate(t: Template): boolean {
        if (t === null || t === undefined || typeof t !== "object") return false;
        if (Array.isArray(t)) return t.some(checkTemplate);
        const obj = t as Record<string, unknown>;
        if (obj["$from"] === "state") return true;
        if ("$literal" in obj) return false;
        return Object.values(obj).some((v) => checkTemplate(v as Template));
    }
    for (const node of Object.values(scope.nodes)) {
        if ("inputs" in node && node.inputs) {
            if (checkTemplate(node.inputs as Template)) return true;
        }
        if ("selector" in node) {
            if (checkTemplate(node.selector as Template)) return true;
        }
    }
    return checkTemplate(scope.output);
}
