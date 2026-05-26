// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { randomUUID } from "node:crypto";
import Debug from "debug";
import {
    WorkflowIR,
    WorkflowBody,
    WorkflowNode,
    Template,
    TaskNode,
    BranchNode,
    BranchArm,
    LoopNode,
    ForkNode,
    ForkMapNode,
    WorkflowCallNode,
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

/**
 * Per-run state threaded through every internal execute* method.
 * Carrying this on the call stack (rather than on the engine instance)
 * is what makes a single `WorkflowEngine` safe to use for concurrent
 * `run()` invocations.
 */
interface RunCtx {
    /** The currently-executing IR's workflows table; consulted by sub-workflow dispatch. */
    workflows: Record<string, WorkflowBody>;
    /**
     * Immutable call stack for defense-in-depth cycle detection.
     * Each `executeWorkflowCall` creates a new RunCtx with the callee
     * appended, so concurrent fork branches each carry their own lineage
     * without sharing mutable state.
     */
    wfCallStack: readonly string[];
}

// ---- Template resolution ----
// Note: the error throws below (unknown namespace, unresolved reference,
// path projection failures) should never fire when static validation is
// enabled. The static validator's dominator analysis with onError-split
// coverage (§4.1) proves binding availability on all paths, namespace
// validation rejects unknown $from values, and checkSchemaCompat verifies
// path projections against declared schemas. These checks are kept
// unconditional because they are cheap and provide clear diagnostics if
// an IR somehow bypasses static validation.

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
            // Unreachable after static validation (namespace check).
            throw new EngineError(
                `Unknown $from namespace: "${from}"`,
                "UnrecoverableError",
                true,
            );
    }

    if (value === undefined) {
        if (optional) return null;
        // Unreachable after static validation (dominator + onError-split coverage).
        throw new EngineError(
            `Reference unresolved: $from "${from}", name "${name}"`,
            "UnrecoverableError",
            true,
        );
    }

    // Path projection (RFC 6901 semantics)
    if (path) {
        for (const segment of path) {
            if (value === null || value === undefined) {
                if (optional) return null;
                // Unreachable after static validation (type-compat + resolveSchemaPath).
                throw new EngineError(
                    `Path projection failed at "${segment}" on null/undefined`,
                    "UnrecoverableError",
                    true,
                );
            }
            if (typeof segment === "number") {
                if (!Array.isArray(value)) {
                    if (optional) return null;
                    // Unreachable after static validation.
                    throw new EngineError(
                        `Path projection: expected array at index ${segment}`,
                        "UnrecoverableError",
                        true,
                    );
                }
                value = (value as unknown[])[segment];
            } else {
                if (typeof value !== "object" || Array.isArray(value)) {
                    if (optional) return null;
                    // Unreachable after static validation.
                    throw new EngineError(
                        `Path projection: expected object at key "${segment}"`,
                        "UnrecoverableError",
                        true,
                    );
                }
                value = (value as Record<string, unknown>)[segment];
            }
        }
    }

    return value;
}

// ---- Error types ----

/**
 * Well-known engine-level error codes.
 * - "TaskError": a registered task returned {kind:"fail"} or threw.
 * - "RuntimeError": the engine raised a recoverable runtime condition
 *   (policy/approval, timeout, cancellation).
 * - "LoopMaxIterationsExceeded": loop hit its maxIterations cap (recoverable).
 * - "OutputSchemaViolation": task returned a value that failed outputSchema (recoverable).
 * - "UnrecoverableError": the engine raised a condition that is
 *   statically unreachable after validation (ReferenceUnresolved,
 *   BranchSelectorUnmatched, unknown namespace, invalid IR structure).
 *   These bypass onError handlers.
 */
type EngineErrorKind =
    | "TaskError"
    | "RuntimeError"
    | "LoopMaxIterationsExceeded"
    | "OutputSchemaViolation"
    | "UnrecoverableError";

class EngineError extends Error {
    readonly kind: EngineErrorKind;
    /** When true, this error bypasses onError handlers. */
    readonly unrecoverable: boolean;

    constructor(
        message: string,
        kind: EngineErrorKind = "RuntimeError",
        unrecoverable = false,
    ) {
        super(message);
        this.name = "EngineError";
        this.kind = kind;
        this.unrecoverable = unrecoverable;
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

type ScopeExit = {
    kind: "terminal";
    errorHandled?: { message: string; nodeId: string | undefined } | undefined;
};

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

        const entryBody = ir.workflows[ir.entry];
        if (!entryBody) {
            return {
                runId,
                success: false,
                error: {
                    message: `Entry workflow "${ir.entry}" not found in workflows table.`,
                },
            };
        }

        debug("run %s started (workflow: %s)", runId, ir.entry);

        // Per-run state. Carrying this on the call stack rather than on
        // `this` means a single engine instance can service multiple
        // concurrent `run()` calls without sub-workflow dispatch racing
        // across them.
        const ctx: RunCtx = {
            workflows: ir.workflows,
            wfCallStack: [ir.entry],
        };

        // Validate workflow input against inputSchema.
        if (entryBody.inputSchema) {
            const validate = this.getValidator(entryBody.inputSchema);
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

        // Set currentWorkflows only once we've passed all early-return
        // validation.
        const scope: ScopeContext = {
            input: input ?? {},
            constants,
            bindings: new Map(),
        };

        const scopePath = [ir.entry];

        this.emit({
            type: "runStarted",
            runId,
            workflowName: ir.entry,
            timestamp: Date.now(),
        });

        try {
            const exit = await this.executeScope(
                entryBody.nodes,
                entryBody.entry,
                scope,
                scopePath,
                runId,
                abortSignal,
                ctx,
                policy,
                approve,
                taskTimeoutMs,
                constraints,
            );

            let output: unknown;
            try {
                output = resolveTemplate(entryBody.output, scope);
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

            // Defense-in-depth: static validator checks output template type
            // compatibility; runtime #9 (task output schema) ensures upstream
            // values match declared types, so this is redundant.
            if (this.defenseInDepth && entryBody.outputSchema) {
                const validate = this.getValidator(entryBody.outputSchema);
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
        ctx: RunCtx,
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

            const node = nodes[currentId];
            // Unreachable after static validation: name-resolution pass
            // verifies all node references exist.
            if (!node) {
                throw new EngineError(
                    `Node "${currentId}" not found`,
                    "UnrecoverableError",
                    true,
                );
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
                    currentId = await this.executeBranch(
                        node,
                        branchNodeId,
                        activeScope,
                        scope,
                        scopePath,
                        runId,
                        signal,
                        ctx,
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
                }

                case "loop":
                    currentId = await this.executeLoop(
                        node,
                        currentId,
                        scope,
                        scopePath,
                        runId,
                        signal,
                        ctx,
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
                        ctx,
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
                        ctx,
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

                case "workflowCall":
                    currentId = await this.executeWorkflowCall(
                        node,
                        currentId,
                        activeScope,
                        scope,
                        scopePath,
                        runId,
                        signal,
                        ctx,
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
            // Unreachable after static validation: IR/task drift pass
            // checks all task names against the registry.
            if (!task) {
                throw new EngineError(
                    `Task "${node.task}" not found in registry`,
                    "UnrecoverableError",
                    true,
                );
            }
            const validTask = task;

            // Policy check: secure-by-default.
            // ALL tasks are gated unless explicitly marked sideEffects: false.
            // This ensures new or third-party tasks cannot bypass policy.
            if (validTask.sideEffects !== false) {
                const mode: TaskPolicyMode =
                    policy?.[validTask.name] ?? "prompt";
                if (mode === "deny") {
                    throw new EngineError(
                        `Task "${validTask.name}" denied by policy`,
                    );
                }
                if (mode === "prompt") {
                    const decision = approveFn
                        ? await approveFn(validTask.name, resolvedInput)
                        : { kind: "denied" as const };
                    if (decision.kind !== "approved") {
                        throw new EngineError(
                            `Task "${validTask.name}" denied: approval ${decision.kind}`,
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
                    result = await validTask.execute(resolvedInput, ctx);
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
                result = await validTask.execute(resolvedInput, ctx);
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
                    "UnrecoverableError",
                    true,
                );
            }

            // Runtime output schema validation (essential check §5.8.1 — always runs).
            if (node.outputSchema) {
                const validate = this.getValidator(node.outputSchema);
                if (!validate(result.output)) {
                    const msg = this.ajv.errorsText(validate.errors);
                    throw new EngineError(
                        `Output schema violation at "${nodeId}" (task "${node.task}"): ${msg}`,
                        "OutputSchemaViolation",
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
            if (
                node.onError &&
                !(err instanceof EngineError && err.unrecoverable)
            ) {
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

            // No onError (or unrecoverable): propagate
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

    private async executeBranch(
        node: BranchNode,
        nodeId: string,
        resolveScope: ScopeContext,
        bindScope: ScopeContext,
        scopePath: string[],
        runId: string,
        signal: AbortSignal,
        ctx: RunCtx,
        onErrorDispatch: (
            error: Record<string, unknown>,
            trigger: unknown,
        ) => void,
        policy?: TaskPolicy,
        approve?: ApprovalFn,
        taskTimeoutMs?: number,
        constraints?: TaskConstraints,
        iteration?: number,
    ): Promise<string | undefined> {
        const raw = resolveTemplate(node.selector, resolveScope);
        const caseKey = String(raw);
        const arm: BranchArm | undefined = node.cases[caseKey] ?? node.default;
        if (!arm) {
            // For exhaustive branches (default omitted), this is unreachable
            // after static validation: the validator proves every selector
            // value has a matching case. For non-exhaustive branches, this is
            // also unreachable because the validator requires a default.
            throw new EngineError(
                `Branch selector resolved to "${caseKey}" but no matching case or default exists`,
                "UnrecoverableError",
                true,
            );
        }

        debug("branch %s selector=%s -> arm", nodeId, caseKey);

        const armInput = resolveTemplate(arm.inputs, resolveScope) as Record<
            string,
            unknown
        >;
        const armScope: ScopeContext = {
            input: armInput,
            constants: resolveScope.constants,
            bindings: new Map(),
            // No state: branch arms are isolated sub-scopes like fork branches.
            // $from:"state" refs in arm nodes are hoisted through arm.inputs
            // by the DSL emitter (captureOuterRefs) and rewritten to
            // $from:"input". Hand-crafted IR must do the same; the validator
            // rejects $from:"state" in arm node inputs.
        };
        const armScopePath = [...scopePath, `${nodeId}.${caseKey}`];

        try {
            await this.executeScope(
                arm.scope.nodes,
                arm.scope.entry,
                armScope,
                armScopePath,
                runId,
                signal,
                ctx,
                policy,
                approve,
                taskTimeoutMs,
                constraints,
                iteration,
            );

            const armOutput = resolveTemplate(arm.scope.output, armScope);

            if (this.defenseInDepth && arm.scope.outputSchema) {
                const validate = this.getValidator(arm.scope.outputSchema);
                if (!validate(armOutput)) {
                    const msg = this.ajv.errorsText(validate.errors);
                    throw new EngineError(
                        `Branch "${nodeId}" arm "${caseKey}" output schema violation: ${msg}`,
                    );
                }
            }

            if (node.bind) {
                bindScope.bindings.set(node.bind, armOutput);
            }

            this.emit({
                type: "nodeCompleted",
                runId,
                nodeId,
                scopePath: [...scopePath],
                ...(iteration !== undefined ? { iteration } : {}),
                output: armOutput,
                timestamp: Date.now(),
            });

            return node.next;
        } catch (err) {
            if (
                node.onError &&
                !(err instanceof EngineError && err.unrecoverable)
            ) {
                const errorObj = buildErrorObject(
                    err,
                    "branch",
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

                onErrorDispatch(errorObj, armInput);
                return node.onError;
            }
            throw err;
        }
    }

    private async executeLoop(
        node: LoopNode,
        nodeId: string,
        outerScope: ScopeContext,
        scopePath: string[],
        runId: string,
        signal: AbortSignal,
        ctx: RunCtx,
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

        // Defense-in-depth: static validator checks input template type
        // compatibility; runtime task-output checks (#9) ensure upstream
        // values match declared types, making this redundant.
        if (this.defenseInDepth && node.body.inputSchema) {
            const validate = this.getValidator(node.body.inputSchema);
            if (!validate(loopInput)) {
                const msg = this.ajv.errorsText(validate.errors);
                throw new EngineError(
                    `Loop "${nodeId}" input schema violation: ${msg}`,
                );
            }
        }

        // Initialize state and validate against state[*].schema (§5.4 step 2)
        // Defense-in-depth: static validator checks initial-value template
        // types against state schemas; runtime task-output checks (#9)
        // ensure upstream values are correct.
        let state: Record<string, unknown> = {};
        for (const [name, stateVar] of Object.entries(node.state)) {
            state[name] = resolveTemplate(stateVar.initial, outerScope);
            if (this.defenseInDepth && stateVar.schema) {
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
                await this.executeScope(
                    node.body.nodes,
                    node.body.entry,
                    bodyScope,
                    bodyScopePath,
                    runId,
                    signal,
                    ctx,
                    policy,
                    approve,
                    taskTimeoutMs,
                    constraints,
                    i,
                );

                // Evaluate continueWhen to determine whether to iterate or exit.
                const continueResult = resolveTemplate(
                    node.continueWhen,
                    bodyScope,
                );
                if (typeof continueResult !== "boolean") {
                    throw new EngineError(
                        `Loop continueWhen at "${nodeId}" evaluated to non-boolean: ${typeof continueResult}`,
                        "UnrecoverableError",
                        true,
                    );
                }

                if (!continueResult) {
                    // Resolve output in body scope (state + body bindings)
                    const output = resolveTemplate(node.body.output, bodyScope);

                    // Defense-in-depth: static validator checks output template
                    // type compatibility; runtime task-output checks (#9)
                    // ensure body bindings are correct.
                    if (this.defenseInDepth && node.body.outputSchema) {
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

                // continueWhen === true: compute next state and validate (§5.4 step 4)
                // Defense-in-depth: static validator checks iterateState
                // template types against state schemas; runtime task-output
                // checks (#9) ensure body bindings are correct.
                const nextState: Record<string, unknown> = {};
                for (const [name, ref] of Object.entries(node.iterateState)) {
                    nextState[name] = resolveTemplate(
                        ref as Template,
                        bodyScope,
                    );
                    const stateVar = node.state[name];
                    if (this.defenseInDepth && stateVar?.schema) {
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
                "LoopMaxIterationsExceeded",
            );
        } catch (err) {
            if (
                node.onError &&
                !(err instanceof EngineError && err.unrecoverable)
            ) {
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
        ctx: RunCtx,
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

        // Unreachable after static validation: structural check
        // verifies fork has at least 2 branches.
        if (branchNames.length < 2) {
            throw new EngineError(
                `Fork "${nodeId}" must have at least 2 branches, got ${branchNames.length}`,
                "UnrecoverableError",
                true,
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
                    ctx,
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
            if (
                node.onError &&
                !(err instanceof EngineError && err.unrecoverable)
            ) {
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
        ctx: RunCtx,
        onErrorDispatch: (
            error: Record<string, unknown>,
            trigger: unknown,
        ) => void,
        policy?: TaskPolicy,
        approve?: ApprovalFn,
        taskTimeoutMs?: number,
        constraints?: TaskConstraints,
    ): Promise<string | undefined> {
        // Note: $from "state" refs in forkMap bodies are rejected statically
        // by the scope-closure check; at runtime they would surface as
        // "Unresolved reference" since item scope has no state.

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
            // Unreachable after static validation: type-compatibility pass
            // proves collection resolves to array type; task-output checks
            // ensure upstream values match declared types.
            if (!Array.isArray(collection)) {
                throw new EngineError(
                    `forkMap at "${nodeId}": collection did not resolve to an array`,
                    "UnrecoverableError",
                    true,
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
                    ctx,
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
            if (
                node.onError &&
                !(err instanceof EngineError && err.unrecoverable)
            ) {
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

    /**
     * Execute a `workflowCall` node: resolve inputs against the caller
     * scope, validate against the callee's inputSchema, execute the
     * callee body in a fresh sub-scope (shared `constants`, empty
     * `bindings`, no `state`), resolve the callee's `output` template,
     * validate, and bind the result back into the caller's scope.
     *
     * Sub-workflow failures propagate to the caller's `onError` if set.
     */
    private async executeWorkflowCall(
        node: WorkflowCallNode,
        nodeId: string,
        resolveScope: ScopeContext,
        bindScope: ScopeContext,
        scopePath: string[],
        runId: string,
        signal: AbortSignal,
        ctx: RunCtx,
        onErrorDispatch: (
            error: Record<string, unknown>,
            trigger: unknown,
        ) => void,
        policy?: TaskPolicy,
        approve?: ApprovalFn,
        taskTimeoutMs?: number,
        constraints?: TaskConstraints,
        iteration?: number,
    ): Promise<string | undefined> {
        const calleeName = node.workflowRef.name;
        const callee = ctx.workflows[calleeName];
        if (!callee) {
            // Unreachable after static validation: type checker verifies
            // workflowRef.name exists in the IR's workflows table.
            throw new EngineError(
                `Workflow "${calleeName}" not found at "${nodeId}"`,
                "UnrecoverableError",
                true,
            );
        }

        // Defense-in-depth: static validator (validateWorkflowCalls) already
        // proves the call graph is acyclic. This guards IR that bypasses
        // static validation and would otherwise cause unbounded recursion.
        if (this.defenseInDepth && ctx.wfCallStack.includes(calleeName)) {
            throw new EngineError(
                `Recursive workflow call detected at "${nodeId}": ${[...ctx.wfCallStack, calleeName].join(" -> ")} (workflow recursion is not supported)`,
                "UnrecoverableError",
                true,
            );
        }

        this.emit({
            type: "nodeStarted",
            runId,
            nodeId,
            scopePath: [...scopePath],
            ...(iteration !== undefined ? { iteration } : {}),
            timestamp: Date.now(),
        });

        const resolvedInput = resolveTemplate(node.inputs, resolveScope) as
            | Record<string, unknown>
            | undefined;

        try {
            // Defense-in-depth: static validator already checks the call
            // inputs are structurally compatible with the callee schema.
            if (this.defenseInDepth && callee.inputSchema) {
                const validate = this.getValidator(callee.inputSchema);
                if (!validate(resolvedInput ?? {})) {
                    const msg = this.ajv.errorsText(validate.errors);
                    throw new EngineError(
                        `Sub-workflow "${calleeName}" input schema violation at "${nodeId}": ${msg}`,
                    );
                }
            }

            const subScope: ScopeContext = {
                input: resolvedInput ?? {},
                // Constants are inherited from the run: a sub-workflow
                // sees the same constant namespace as the entry workflow.
                constants: bindScope.constants,
                bindings: new Map(),
            };

            const subScopePath = [...scopePath, nodeId, calleeName];
            const subCtx: RunCtx = {
                ...ctx,
                wfCallStack: [...ctx.wfCallStack, calleeName],
            };

            // Honor node.timeoutMs by composing a sub-signal that
            // aborts when the parent aborts OR when the sub-workflow
            // exceeds the deadline.
            const effectiveTimeout = node.timeoutMs;
            let subSignal = signal;
            let subAbort: AbortController | undefined;
            let timeoutId: ReturnType<typeof setTimeout> | undefined;
            let timedOut = false;
            let onParentAbort: (() => void) | undefined;
            if (effectiveTimeout !== undefined) {
                subAbort = new AbortController();
                if (signal.aborted) {
                    subAbort.abort(signal.reason);
                } else {
                    onParentAbort = () => subAbort!.abort(signal.reason);
                    signal.addEventListener("abort", onParentAbort, {
                        once: true,
                    });
                }
                timeoutId = setTimeout(() => {
                    timedOut = true;
                    subAbort!.abort("Sub-workflow timed out");
                }, effectiveTimeout);
                subSignal = subAbort.signal;
            }

            let exit;
            try {
                exit = await this.executeScope(
                    callee.nodes,
                    callee.entry,
                    subScope,
                    subScopePath,
                    runId,
                    subSignal,
                    subCtx,
                    policy,
                    approve,
                    taskTimeoutMs,
                    constraints,
                );
            } catch (e) {
                if (timedOut) {
                    throw new EngineError(
                        `Sub-workflow "${calleeName}" at "${nodeId}" timed out after ${effectiveTimeout}ms`,
                    );
                }
                throw e;
            } finally {
                if (timeoutId !== undefined) {
                    clearTimeout(timeoutId);
                }
                if (onParentAbort) {
                    signal.removeEventListener("abort", onParentAbort);
                }
            }
            if (timedOut) {
                throw new EngineError(
                    `Sub-workflow "${calleeName}" at "${nodeId}" timed out after ${effectiveTimeout}ms`,
                );
            }

            // Sub-workflow exit must be terminal (no sentinels escape).
            if (exit.kind !== "terminal") {
                throw new EngineError(
                    `Sub-workflow "${calleeName}" at "${nodeId}" exited via unexpected sentinel`,
                    "UnrecoverableError",
                    true,
                );
            }

            const output = resolveTemplate(callee.output, subScope);

            // Defense-in-depth: static validator checks output schema
            // compatibility between callee.outputSchema and the call site.
            if (this.defenseInDepth && callee.outputSchema) {
                const validate = this.getValidator(callee.outputSchema);
                if (!validate(output)) {
                    const msg = this.ajv.errorsText(validate.errors);
                    throw new EngineError(
                        `Sub-workflow "${calleeName}" output schema violation at "${nodeId}": ${msg}`,
                        "OutputSchemaViolation",
                    );
                }
            }

            if (node.bind) {
                bindScope.bindings.set(node.bind, output);
            }

            this.emit({
                type: "nodeCompleted",
                runId,
                nodeId,
                scopePath: [...scopePath],
                ...(iteration !== undefined ? { iteration } : {}),
                output,
                timestamp: Date.now(),
            });

            return node.next;
        } catch (err) {
            if (
                node.onError &&
                !(err instanceof EngineError && err.unrecoverable)
            ) {
                const errorObj = buildErrorObject(
                    err,
                    `workflow:${calleeName}`,
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

                onErrorDispatch(errorObj, resolvedInput ?? {});
                return node.onError;
            }

            if (err instanceof TaskFailure || err instanceof EngineError) {
                throw err;
            }
            throw new EngineError(
                `Sub-workflow "${calleeName}" at "${nodeId}" failed: ${err instanceof Error ? err.message : String(err)}`,
            );
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
            kind: "TaskError",
            message: err.taskError.message,
            source: "task",
            task: err.taskName,
            node: err.nodeId,
            scopePath: [...scopePath],
            data: err.taskError.data,
        };
    }
    return {
        kind: err instanceof EngineError ? err.kind : "RuntimeError",
        message: err instanceof Error ? err.message : String(err),
        source: "runtime",
        task: taskName,
        node: nodeId,
        scopePath: [...scopePath],
    };
}
