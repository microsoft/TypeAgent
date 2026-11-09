// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Worker } from "node:worker_threads";
import {
    configureRecipeWorkerAssets,
    RecipeWorkerPool,
} from "./recipeWorkerPool.js";
import { verifyRecipeExecutable } from "./recipeCompiler.js";
import type {
    JsonValue,
    RecipeArtifact,
    RecipeCallContext,
    RecipeEffectCheckpoint,
    RecipeRunResult,
    RecipeSemanticOutcome,
} from "./recipeContracts.js";
import type { RecipeExecutionContext } from "./recipeRouting.js";
import {
    checkRecipeCapability,
    validateRecipeArtifact,
    validateRecipeValue,
} from "./recipeValidation.js";

/** Set relocatable worker assets when packaging without node_modules. */
export function configureRecipeExecutorAssets(assets: {
    workerUrl: URL;
    quickjsModulePath?: string;
}): void {
    configureRecipeWorkerAssets(assets);
}

export class RecipeExecutor {
    private readonly pool: RecipeWorkerPool;
    private readonly controller = new AbortController();
    private readonly executions = new Set<Promise<RecipeRunResult>>();
    private closed = false;
    private closing?: Promise<void>;

    constructor(options: { maxWorkers?: number } = {}) {
        this.pool = new RecipeWorkerPool(options.maxWorkers);
    }

    execute(
        artifact: RecipeArtifact,
        input: JsonValue,
        context: RecipeExecutionContext,
        options: RecipeExecutorOptions = {},
    ): Promise<RecipeRunResult> {
        if (this.closed)
            return Promise.reject(new Error("Recipe executor is closed."));
        const execution = executeWithPool(
            artifact,
            input,
            {
                ...context,
                signal: AbortSignal.any([
                    context.signal,
                    this.controller.signal,
                ]),
            },
            options,
            this.pool,
        );
        this.executions.add(execution);
        const finished = () => {
            this.executions.delete(execution);
        };
        void execution.then(finished, finished);
        return execution;
    }

    close(): Promise<void> {
        this.closed = true;
        this.closing ??= (async () => {
            this.controller.abort();
            try {
                await this.pool.close();
            } finally {
                await Promise.allSettled([...this.executions]);
            }
        })();
        return this.closing;
    }
}

export interface RecipeExecutorOptions {
    timeoutMs?: number;
    memoryLimitBytes?: number;
    stackLimitBytes?: number;
    maxCalls?: number;
    maxJsonBytes?: number;
    onCheckpoint?: (
        checkpoint: Readonly<RecipeEffectCheckpoint>,
    ) => Promise<void>;
}

interface Bounds {
    timeoutMs: number;
    memoryLimitBytes: number;
    stackLimitBytes: number;
    maxCalls: number;
    maxJsonBytes: number;
}

function boundsFor(options: RecipeExecutorOptions): Bounds {
    const bounds = {
        timeoutMs: options.timeoutMs ?? 5_000,
        memoryLimitBytes: options.memoryLimitBytes ?? 16 * 1024 * 1024,
        stackLimitBytes: options.stackLimitBytes ?? 256 * 1024,
        maxCalls: options.maxCalls ?? 64,
        maxJsonBytes: options.maxJsonBytes ?? 1024 * 1024,
    };
    const ceilings: Bounds = {
        timeoutMs: 60_000,
        memoryLimitBytes: 64 * 1024 * 1024,
        stackLimitBytes: 1024 * 1024,
        maxCalls: 1024,
        maxJsonBytes: 4 * 1024 * 1024,
    };
    for (const key of Object.keys(bounds) as (keyof Bounds)[])
        if (
            !Number.isSafeInteger(bounds[key]) ||
            bounds[key] <= 0 ||
            bounds[key] > ceilings[key]
        )
            throw new Error(`Invalid runtime bound: ${key}.`);
    return bounds;
}

class Stopped extends Error {}

async function preflightCapabilities(
    artifact: RecipeArtifact,
    context: RecipeExecutionContext,
    signal: AbortSignal,
) {
    const concurrency = 4;
    for (
        let offset = 0;
        offset < artifact.capabilities.length;
        offset += concurrency
    ) {
        const capabilities = artifact.capabilities.slice(
            offset,
            offset + concurrency,
        );
        const results = await Promise.all(
            capabilities.map((capability) =>
                observe(
                    () =>
                        context.host.inspectCapability(
                            capability,
                            context.binding,
                        ),
                    signal,
                ),
            ),
        );
        for (const [index, checked] of results.entries()) {
            if (checked.status !== "available") return checked;
            if (
                checkRecipeCapability(capabilities[index], checked.capability)
                    .length
            )
                return {
                    status: "unsupported" as const,
                    message: "Capability contract changed during preflight.",
                };
        }
    }
    return undefined;
}

// Host adapters must honor signal. A non-cooperative adapter may finish later,
// but its observation handlers never hold guest handles or dispatch more work.
function observe<T>(work: () => Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise((resolve, reject) => {
        const abort = () => {
            signal.removeEventListener("abort", abort);
            reject(new Stopped("Recipe execution stopped."));
        };
        if (signal.aborted) return abort();
        signal.addEventListener("abort", abort, { once: true });
        Promise.resolve()
            .then(() => {
                if (signal.aborted)
                    throw new Stopped("Recipe execution stopped.");
                return work();
            })
            .then(
                (value) => {
                    signal.removeEventListener("abort", abort);
                    if (!signal.aborted) resolve(value);
                },
                (error: unknown) => {
                    signal.removeEventListener("abort", abort);
                    reject(error);
                },
            );
    });
}

function jsonText(value: unknown, maxBytes: number): string {
    const seen = new Set<object>();
    function check(item: unknown, depth: number): void {
        if (depth > 100) throw new Error("JSON nesting limit exceeded.");
        if (
            item === null ||
            typeof item === "string" ||
            typeof item === "boolean"
        )
            return;
        if (typeof item === "number" && Number.isFinite(item)) return;
        if (typeof item !== "object" || seen.has(item))
            throw new Error("Expected finite, acyclic JSON data.");
        seen.add(item);
        if (Array.isArray(item)) {
            for (let index = 0; index < item.length; index++)
                check(item[index], depth + 1);
        } else {
            const prototype = Object.getPrototypeOf(item);
            if (prototype !== Object.prototype && prototype !== null)
                throw new Error("Expected plain JSON data.");
            for (const value of Object.values(item)) check(value, depth + 1);
        }
        seen.delete(item);
    }
    check(value, 0);
    const text = JSON.stringify(value);
    if (Buffer.byteLength(text) > maxBytes)
        throw new Error("JSON byte limit exceeded.");
    return text;
}

function guestSource(
    artifact: RecipeArtifact,
    inputText: string,
    maxBytes: number,
) {
    return `
((send, finish) => {
    delete globalThis.__recipeSend;
    delete globalThis.__recipeFinish;
    const stringify = JSON.stringify;
    const parse = JSON.parse;
    const keys = Object.keys;
    const isArray = Array.isArray;
    const finite = Number.isFinite;
    const prototype = Object.getPrototypeOf;
    const objectPrototype = Object.prototype;
    const pending = new Map();
    let next = 0;
    function encode(value) {
        const seen = new Set();
        function check(item, depth) {
            if (depth > 100) throw Error("JSON nesting limit exceeded");
            if (item === null || typeof item === "string" || typeof item === "boolean") return;
            if (typeof item === "number" && finite(item)) return;
            if (typeof item !== "object" || seen.has(item)) throw Error("Expected strict JSON");
            seen.add(item);
            if (isArray(item)) {
                for (let i = 0; i < item.length; i++) check(item[i], depth + 1);
            } else {
                if (prototype(item) !== objectPrototype && prototype(item) !== null)
                    throw Error("Expected plain JSON");
                for (const key of keys(item)) check(item[key], depth + 1);
            }
            seen.delete(item);
        }
        check(value, 0);
        const text = stringify(value);
        if (text.length > ${maxBytes}) throw Error("JSON limit exceeded");
        return text;
    }
    function call(kind, id, input) {
        return new Promise((resolve, reject) => {
            if (typeof id !== "string") throw Error("Call ID must be a string");
            const request = ++next;
            const text = encode({ request, kind, id, input });
            pending.set(request, { resolve, reject });
            send(text);
        });
    }
    const api = Object.freeze({
        tools: Object.freeze({ call: (id, input) => call("tools", id, input) }),
        semantic: Object.freeze({ call: (id, input) => call("semantic", id, input) })
    });
    ${artifact.executable.text}
    Promise.resolve().then(() => execute(api, parse(${JSON.stringify(inputText)}))).then(
        value => finish(encode({ status: "completed", value })),
        error => finish(encode({ status: "failed", message: String(error) }))
    ).catch(() => finish('{"status":"failed","message":"Invalid guest output"}'));
    return text => {
        const response = parse(text);
        const promise = pending.get(response.request);
        if (!promise) throw Error("Unknown broker response");
        pending.delete(response.request);
        promise.resolve(response.value);
    };
})(globalThis.__recipeSend, globalThis.__recipeFinish)
`;
}

interface Request {
    request: number;
    kind: "tools" | "semantic";
    id: string;
    input: JsonValue;
}

class Broker {
    private calls = 0;
    private readonly semanticCalls = new Map<string, number>();

    constructor(
        private readonly artifact: RecipeArtifact,
        private readonly context: RecipeExecutionContext,
        private readonly result: RecipeRunResult,
        private readonly bounds: Bounds,
        private readonly options: RecipeExecutorOptions,
        private readonly signal: AbortSignal,
        private readonly cancel: () => void,
    ) {}

    isConcurrentRead(request: Request): boolean {
        return (
            request.kind === "tools" &&
            this.artifact.capabilities.some(
                (capability) =>
                    capability.id === request.id &&
                    capability.effect === "read",
            )
        );
    }

    private stop(status: RecipeRunResult["status"], message: string): never {
        this.result.status = status;
        this.result.message = message;
        this.cancel();
        throw new Stopped(message);
    }

    private async checkpoint(
        checkpoint: RecipeEffectCheckpoint,
    ): Promise<void> {
        if (this.options.onCheckpoint)
            await observe(
                () => this.options.onCheckpoint!({ ...checkpoint }),
                this.signal,
            );
    }

    dispatch(request: Request): Promise<JsonValue> {
        return this.dispatchRequest(request).catch((error: unknown) => {
            this.cancel();
            throw error;
        });
    }

    private async dispatchRequest(request: Request): Promise<JsonValue> {
        if (this.signal.aborted) throw new Stopped("Recipe execution stopped.");
        if (++this.calls > this.bounds.maxCalls)
            this.stop("limit_exceeded", "Broker call limit exceeded.");
        const callContext: RecipeCallContext = {
            runId: this.context.runId,
            callId: `${this.context.runId}:${this.calls}`,
            binding: this.context.binding,
            signal: this.signal,
        };
        if (request.kind === "semantic")
            return this.semantic(request, callContext);
        if (request.kind !== "tools")
            this.stop("unsupported", "Unsupported broker request.");
        const capability = this.artifact.capabilities.find(
            (entry) => entry.id === request.id,
        );
        if (!capability) this.stop("unsupported", "Undeclared capability.");
        if (validateRecipeValue(capability.inputSchema, request.input).length)
            this.stop("failed", "Invalid capability input.");
        const availability = await observe(
            () =>
                this.context.host.inspectCapability(
                    capability,
                    this.context.binding,
                ),
            this.signal,
        );
        if (availability.status !== "available")
            this.stop(availability.status, availability.message);
        if (checkRecipeCapability(capability, availability.capability).length)
            this.stop("unsupported", "Capability contract changed.");
        const checkpoint: RecipeEffectCheckpoint = {
            callId: callContext.callId,
            capabilityId: capability.id,
            effect: capability.effect,
            phase: "not_dispatched",
        };
        this.result.checkpoints.push(checkpoint);
        await this.checkpoint(checkpoint);
        checkpoint.phase = "dispatched";
        await this.checkpoint(checkpoint);
        const outcome = await observe(
            () =>
                this.context.host.invokeCapability(
                    capability,
                    request.input,
                    callContext,
                ),
            this.signal,
        );
        if (outcome.status === "execution_uncertain") {
            checkpoint.phase = "uncertain";
            checkpoint.operationId = outcome.operationId;
            await this.checkpoint(checkpoint);
            this.stop(outcome.status, outcome.message);
        }
        if (outcome.status === "requires_interaction") {
            this.result.interactionId = outcome.interactionId;
            this.stop(outcome.status, outcome.prompt);
        }
        if (outcome.status !== "completed")
            this.stop(outcome.status, outcome.message);
        jsonText(outcome.value, this.bounds.maxJsonBytes);
        if (
            capability.outputSchema &&
            validateRecipeValue(capability.outputSchema, outcome.value).length
        )
            this.stop("failed", "Invalid capability output.");
        checkpoint.phase = "completed";
        this.result.completedCallIds.push(callContext.callId);
        await this.checkpoint(checkpoint);
        if (outcome.evidence?.privateArtifacts) {
            jsonText(
                outcome.evidence.privateArtifacts,
                this.bounds.maxJsonBytes,
            );
            this.result.artifacts = [
                ...(this.result.artifacts ?? []),
                ...outcome.evidence.privateArtifacts,
            ];
        }
        return outcome.value;
    }

    private async semantic(
        request: Request,
        context: RecipeCallContext,
    ): Promise<JsonValue> {
        const definition = this.artifact.semanticFunctions.find(
            (entry) => entry.id === request.id,
        );
        if (!definition)
            this.stop("unsupported", "Undeclared semantic function.");
        const calls = (this.semanticCalls.get(definition.id) ?? 0) + 1;
        this.semanticCalls.set(definition.id, calls);
        if (calls > definition.bounds.maxCalls)
            this.stop("limit_exceeded", "Semantic call limit exceeded.");
        jsonText(
            request.input,
            Math.min(this.bounds.maxJsonBytes, definition.bounds.maxInputBytes),
        );
        if (validateRecipeValue(definition.inputSchema, request.input).length)
            this.stop("failed", "Invalid semantic input.");
        const controller = new AbortController();
        const cancel = () => controller.abort();
        this.signal.addEventListener("abort", cancel, { once: true });
        const timer = setTimeout(cancel, definition.bounds.timeoutMs);
        let outcome: RecipeSemanticOutcome;
        try {
            if (this.signal.aborted) cancel();
            outcome = await observe(
                () =>
                    this.context.host.invokeSemantic(
                        definition,
                        request.input,
                        { ...context, signal: controller.signal },
                    ),
                controller.signal,
            );
        } catch (error) {
            if (controller.signal.aborted && !this.signal.aborted)
                this.stop("limit_exceeded", "Semantic call deadline exceeded.");
            throw error;
        } finally {
            clearTimeout(timer);
            this.signal.removeEventListener("abort", cancel);
            controller.abort();
        }
        if (outcome.status !== "completed") {
            const status =
                outcome.status === "abstained"
                    ? "abstained"
                    : outcome.status === "cancelled" ||
                        outcome.status === "unsupported" ||
                        outcome.status === "limit_exceeded"
                      ? outcome.status
                      : "failed";
            this.stop(
                status,
                outcome.status === "abstained"
                    ? outcome.reason
                    : outcome.message,
            );
        }
        jsonText(
            outcome.value,
            Math.min(
                this.bounds.maxJsonBytes,
                definition.bounds.maxOutputBytes,
            ),
        );
        jsonText(outcome.evidence, this.bounds.maxJsonBytes);
        if (
            validateRecipeValue(definition.outputSchema, outcome.value)
                .length ||
            outcome.evidence.functionId !== definition.id ||
            outcome.evidence.functionRevision !== definition.revision ||
            outcome.evidence.validation !== "passed" ||
            !outcome.evidence.resolvedModel ||
            !Array.isArray(outcome.evidence.sourceIds) ||
            outcome.evidence.sourceIds.some((id) => typeof id !== "string")
        )
            this.stop("failed", "Invalid semantic output or evidence.");
        this.result.semanticEvidence.push(outcome.evidence);
        this.result.completedCallIds.push(context.callId);
        return outcome.value;
    }
}

async function runGuest(
    artifact: RecipeArtifact,
    inputText: string,
    context: RecipeExecutionContext,
    result: RecipeRunResult,
    bounds: Bounds,
    options: RecipeExecutorOptions,
    signal: AbortSignal,
    deadline: number,
    pool: RecipeWorkerPool,
    cancel: () => void,
): Promise<void> {
    if (signal.aborted) throw new Stopped("Runtime stopped.");
    const lease = await pool.acquire(signal);
    result.performance = {
        workerQueueMs: lease.queueMs,
        workerReused: lease.reused,
    };
    const broker = new Broker(
        artifact,
        context,
        result,
        bounds,
        options,
        signal,
        cancel,
    );
    let healthy = false;
    try {
        const value = await workerResult(
            lease.worker,
            broker,
            bounds,
            signal,
            cancel,
            () =>
                lease.worker.postMessage({
                    kind: "execute",
                    data: {
                        source: guestSource(
                            artifact,
                            inputText,
                            bounds.maxJsonBytes,
                        ),
                        bounds,
                        deadline,
                    },
                }),
        );
        if (validateRecipeValue(artifact.outputSchema, value).length)
            throw new Error("Recipe output does not satisfy its schema.");
        result.output = value;
        result.status = "completed";
        healthy = true;
    } finally {
        await lease.release(healthy);
    }
}

function workerResult(
    worker: Worker,
    broker: Broker,
    bounds: Bounds,
    signal: AbortSignal,
    cancel: () => void,
    start: () => void,
): Promise<JsonValue> {
    return new Promise((resolve, reject) => {
        let settled = false;
        let calls = 0;
        let exclusive = false;
        const queued: Request[] = [];
        const active = new Set<number>();
        const clean = () => {
            signal.removeEventListener("abort", abort);
            worker.off("error", stop);
            worker.off("exit", exited);
            worker.off("message", receive);
        };
        const stop = (error: unknown) => {
            if (settled) return;
            settled = true;
            clean();
            cancel();
            reject(error);
        };
        const abort = () => stop(new Stopped("Runtime stopped."));
        const exited = () =>
            stop(new Error("Guest worker exited unexpectedly."));
        const pump = () => {
            while (
                !settled &&
                !signal.aborted &&
                queued.length &&
                active.size < 4 &&
                !exclusive
            ) {
                const request = queued[0];
                const concurrent = broker.isConcurrentRead(request);
                if (!concurrent && active.size) return;
                queued.shift();
                exclusive = !concurrent;
                active.add(request.request);
                void broker.dispatch(request).then((value) => {
                    try {
                        if (settled || signal.aborted) return;
                        const text = jsonText(
                            { request: request.request, value },
                            bounds.maxJsonBytes,
                        );
                        active.delete(request.request);
                        exclusive = false;
                        worker.postMessage(text);
                        pump();
                    } catch (error) {
                        stop(error);
                    }
                }, stop);
            }
        };
        const receive = (message: { kind: string; text: string }) => {
            if (settled) return;
            try {
                if (
                    !message ||
                    typeof message.text !== "string" ||
                    Buffer.byteLength(message.text) > bounds.maxJsonBytes
                )
                    throw new Error("Guest JSON limit exceeded.");
                if (message.kind === "failure") throw new Error(message.text);
                if (message.kind === "result") {
                    if (active.size || queued.length)
                        throw new Error("Guest completed with pending calls.");
                    const value: JsonValue = JSON.parse(message.text);
                    jsonText(value, bounds.maxJsonBytes);
                    settled = true;
                    clean();
                    resolve(value);
                    return;
                }
                if (message.kind !== "request" || ++calls > bounds.maxCalls)
                    throw new Error("Invalid or excessive broker requests.");
                const request = JSON.parse(message.text) as Request;
                if (
                    !request ||
                    request.request !== calls ||
                    typeof request.id !== "string" ||
                    !["tools", "semantic"].includes(request.kind)
                )
                    throw new Error("Invalid broker request.");
                queued.push(request);
                pump();
            } catch (error) {
                stop(error);
            }
        };
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) return abort();
        worker.on("error", stop);
        worker.on("exit", exited);
        worker.on("message", receive);
        try {
            start();
        } catch (error) {
            stop(error);
        }
    });
}

async function executeWithPool(
    artifact: RecipeArtifact,
    input: JsonValue,
    context: RecipeExecutionContext,
    options: RecipeExecutorOptions,
    pool: RecipeWorkerPool,
): Promise<RecipeRunResult> {
    const result: RecipeRunResult = {
        recipeId: artifact.recipeId,
        revision: artifact.revision,
        runId: context.runId,
        accepted: true,
        status: "failed",
        checkpoints: [],
        completedCallIds: [],
        semanticEvidence: [],
        fallback: "never",
    };
    const controller = new AbortController();
    const cancel = () => controller.abort();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let deadline = Infinity;
    try {
        artifact = structuredClone(artifact);
        const bounds = boundsFor(options);
        if (validateRecipeArtifact(artifact).length)
            throw new Error(
                "Recipe artifact integrity or compiler identity mismatch.",
            );
        verifyRecipeExecutable(artifact);
        if (validateRecipeValue(artifact.inputSchema, input).length)
            throw new Error("Recipe input does not satisfy its schema.");
        const inputText = jsonText(input, bounds.maxJsonBytes);
        context.signal.addEventListener("abort", cancel, { once: true });
        if (context.signal.aborted) cancel();
        deadline = Date.now() + bounds.timeoutMs;
        timer = setTimeout(cancel, bounds.timeoutMs);
        // Check every dependency before guest code can dispatch its first call.
        const missing = await preflightCapabilities(
            artifact,
            context,
            controller.signal,
        );
        if (missing) {
            result.status = missing.status;
            result.message = missing.message;
            return result;
        }
        await runGuest(
            artifact,
            inputText,
            context,
            result,
            bounds,
            options,
            controller.signal,
            deadline,
            pool,
            cancel,
        );
    } catch (error) {
        if (result.status === "failed") {
            if (context.signal.aborted) result.status = "cancelled";
            else if (Date.now() >= deadline) result.status = "limit_exceeded";
            result.message =
                error instanceof Error
                    ? error.message
                    : "Unexpected runtime failure.";
        }
        const uncertain = result.checkpoints.find(
            (checkpoint) =>
                checkpoint.phase === "dispatched" &&
                checkpoint.effect !== "read",
        );
        if (
            uncertain &&
            ![
                "denied",
                "requires_interaction",
                "unavailable",
                "unsupported",
            ].includes(result.status)
        ) {
            uncertain.phase = "uncertain";
            result.status = "execution_uncertain";
            if (options.onCheckpoint) {
                try {
                    // Do not let failed persistence hold a cancelled run open.
                    const recovery = new AbortController();
                    const recoveryTimer = setTimeout(
                        () => recovery.abort(),
                        1000,
                    );
                    try {
                        await observe(
                            () => options.onCheckpoint!({ ...uncertain }),
                            recovery.signal,
                        );
                    } finally {
                        clearTimeout(recoveryTimer);
                    }
                } catch {
                    result.message =
                        "Effect outcome and durable checkpoint are uncertain.";
                }
            }
        }
    } finally {
        controller.abort();
        if (timer) clearTimeout(timer);
        context.signal.removeEventListener("abort", cancel);
    }
    return result;
}

const defaultExecutor = new RecipeExecutor();

export function executeRecipeProgram(
    artifact: RecipeArtifact,
    input: JsonValue,
    context: RecipeExecutionContext,
    options: RecipeExecutorOptions = {},
): Promise<RecipeRunResult> {
    return defaultExecutor.execute(artifact, input, context, options);
}
