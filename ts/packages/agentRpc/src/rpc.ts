// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    context,
    isSpanContextValid,
    propagation,
    ROOT_CONTEXT,
    SpanKind,
    SpanStatusCode,
    trace,
    type Context,
    type Span,
} from "@opentelemetry/api";
import registerDebug from "debug";

import { RpcChannel } from "./common.js";

type RpcInvokeFunction = (...args: any[]) => Promise<unknown>;
type RpcCallFunction = (...args: any[]) => void;
type RpcInvokeFunctions = Record<string, RpcInvokeFunction>;
type RpcCallFunctions = Record<string, RpcCallFunction>;

type RpcInvokeMethod<T extends RpcInvokeFunctions> = <
    K extends keyof T & string,
>(
    name: K,
    ...args: Parameters<T[K]>
) => ReturnType<T[K]>;

type RpcInvokeWithOptionsMethod<T extends RpcInvokeFunctions> = <
    K extends keyof T & string,
>(
    name: K,
    options: RpcInvokeOptions,
    ...args: Parameters<T[K]>
) => ReturnType<T[K]>;

type RpcSendMethod<T extends RpcCallFunctions> = <K extends keyof T & string>(
    name: K,
    ...args: Parameters<T[K]>
) => void;

type RpcReturn<
    InvokeTargetFunctions extends RpcInvokeFunctions,
    CallTargetFunctions extends RpcCallFunctions,
> = {
    invoke: RpcInvokeMethod<InvokeTargetFunctions>;
    invokeWithOptions: RpcInvokeWithOptionsMethod<InvokeTargetFunctions>;
    send: RpcSendMethod<CallTargetFunctions>;
    rebind(channel: RpcChannel): void;
};

export const RPC_METADATA_VERSION = 1;

export type RpcCorrelationFields = {
    traceId?: string;
    sessionId?: string;
    activationId?: string;
};

export type RpcMetadataEnvelope = {
    version: typeof RPC_METADATA_VERSION;
    traceparent?: string;
    tracestate?: string;
    typeagent?: RpcCorrelationFields;
};

export type RpcInvokeOptions = {
    signal?: AbortSignal;
};

export type RpcTracingOptions = {
    /**
     * Accept propagated context and correlation fields from this channel.
     * This must only be enabled for an explicitly trusted transport.
     */
    trustRemoteContext?: boolean;
    /**
     * Supplies the allowlisted correlation identifiers for an outbound invoke.
     * Invalid or oversized values are omitted.
     */
    getCorrelationFields?: () => RpcCorrelationFields | undefined;
};

export type RpcOptions = {
    // When true, a disconnect rejects in-flight calls but leaves invoke/send
    // intact so the rpc can be reattached to a fresh channel via rebind().
    rebindable?: boolean;
    tracing?: RpcTracingOptions;
};

const RPC_SPAN_NAME = "typeagent.rpc.invoke";
const RPC_INSTRUMENTATION_SCOPE = "@typeagent/agent-rpc";
const RPC_INSTRUMENTATION_VERSION = "0.0.1";
const MAX_TRACEPARENT_LENGTH = 512;
const MAX_TRACESTATE_LENGTH = 512;
const MAX_CORRELATION_LENGTH = 256;
const MAX_RPC_METHOD_LENGTH = 256;
const MAX_TRACESTATE_MEMBERS = 32;
const CORRELATION_VALUE_PATTERN = /^[A-Za-z0-9._:@/-]+$/;
const RPC_METHOD_PATTERN = /^[A-Za-z0-9._:/-]+$/;
const TRACEPARENT_PATTERN =
    /^([0-9a-f]{2})-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}(.*)$/;
const SIMPLE_TRACESTATE_KEY_PATTERN = /^[a-z][a-z0-9_*/-]{0,255}$/;
const MULTITENANT_TRACESTATE_KEY_PATTERN =
    /^[a-z0-9][a-z0-9_*/-]{0,240}@[a-z][a-z0-9_*/-]{0,13}$/;
const TRACESTATE_VALUE_PATTERN = /^[\x20-\x2b\x2d-\x3c\x3e-\x7e]{0,255}$/;

type PendingInvoke = {
    resolve: (result: any) => void;
    reject: (error: any) => void;
};

type ServerCancellation = "client" | "disconnect" | "rebind";

type ServerInvoke = {
    cancel(reason: ServerCancellation): void;
};

type RpcFailureKind = "remote" | "cancelled";

type RpcFailure = Error & {
    rpcFailureKind?: RpcFailureKind;
};

export function createRpc<
    InvokeTargetFunctions extends RpcInvokeFunctions = {},
    CallTargetFunctions extends RpcCallFunctions = {},
    InvokeHandlers extends RpcInvokeFunctions = {},
    CallHandlers extends RpcCallFunctions = {},
>(
    name: string, // for debugging only.
    channel: RpcChannel,
    invokeHandlers?: InvokeHandlers,
    callHandlers?: CallHandlers,
    options?: RpcOptions,
): RpcReturn<InvokeTargetFunctions, CallTargetFunctions> {
    const debugIn = registerDebug(`typeagent:${name}:rpc:in`);
    const debugOut = registerDebug(`typeagent:${name}:rpc:out`);
    const debugError = registerDebug(`typeagent:${name}:rpc:error`);
    const tracer = trace.getTracer(
        RPC_INSTRUMENTATION_SCOPE,
        RPC_INSTRUMENTATION_VERSION,
    );
    const pending = new Map<number, PendingInvoke>();
    const serverInvokes = new Map<number, ServerInvoke>();

    const rebindable = options?.rebindable ?? false;
    let currentChannel: RpcChannel = channel;
    let connected = true;
    let bindGeneration = 0;
    const errorFunc = () => {
        throw new Error("Agent channel disconnected");
    };
    const rejectAllPending = (reason: string) => {
        for (const pendingInvoke of pending.values()) {
            pendingInvoke.reject(new Error(reason));
        }
        pending.clear();
    };
    const cancelAllServerInvokes = (reason: ServerCancellation) => {
        for (const serverInvoke of serverInvokes.values()) {
            serverInvoke.cancel(reason);
        }
        serverInvokes.clear();
    };

    const out = (
        message: RpcMessage,
        cbErr: (err: Error | null) => void = () => {},
    ) => {
        debugOut(message);
        currentChannel.send(message, cbErr);
    };

    const processInvoke = async (message: InvokeMessage) => {
        const remote = extractRemoteMetadata(
            message.metadata,
            options?.tracing?.trustRemoteContext === true,
        );
        await tracer.startActiveSpan(
            RPC_SPAN_NAME,
            {
                kind: SpanKind.SERVER,
                attributes: createSpanAttributes(message.name),
            },
            remote.parentContext,
            async (span) => {
                setCorrelationAttributes(span, remote.correlation);
                let cancelServerInvoke:
                    | ((reason: ServerCancellation) => void)
                    | undefined;
                const cancellation = new Promise<{
                    kind: "cancelled";
                    reason: ServerCancellation;
                }>((resolve) => {
                    cancelServerInvoke = (reason) =>
                        resolve({ kind: "cancelled", reason });
                });
                const serverInvoke: ServerInvoke = {
                    cancel(reason) {
                        cancelServerInvoke?.(reason);
                    },
                };
                serverInvokes.set(message.callId, serverInvoke);

                const handler = invokeHandlers?.[message.name];
                const handlerResult =
                    handler === undefined
                        ? Promise.resolve({
                              kind: "error" as const,
                              error: new Error(
                                  `No invoke handler ${message.name}`,
                              ),
                          })
                        : Promise.resolve()
                              .then(() => handler(...message.args))
                              .then(
                                  (result) => ({
                                      kind: "result" as const,
                                      result,
                                  }),
                                  (error) => ({
                                      kind: "error" as const,
                                      error,
                                  }),
                              );

                try {
                    const result = await Promise.race([
                        handlerResult,
                        cancellation,
                    ]);
                    if (result.kind === "cancelled") {
                        recordServerCancellation(span, result.reason);
                        return;
                    }
                    serverInvokes.delete(message.callId);
                    if (result.kind === "result") {
                        out({
                            type: "invokeResult",
                            callId: message.callId,
                            result: result.result,
                        });
                        return;
                    }

                    const cancellationError = isAbortError(result.error);
                    recordServerError(span, cancellationError);
                    out({
                        type: "invokeError",
                        callId: message.callId,
                        error: getErrorMessage(result.error),
                        ...(cancellationError
                            ? { cancelled: true }
                            : undefined),
                        ...(typeof result.error?.markdown === "string"
                            ? { errorMarkdown: result.error.markdown }
                            : undefined),
                        ...(debugError.enabled &&
                        typeof result.error?.stack === "string"
                            ? { stack: result.error.stack }
                            : undefined),
                    });
                } catch (error) {
                    recordLocalRpcError(span);
                    debugError(
                        "Failed to send invoke response",
                        getErrorMessage(error),
                    );
                } finally {
                    if (serverInvokes.get(message.callId) === serverInvoke) {
                        serverInvokes.delete(message.callId);
                    }
                    span.end();
                }
            },
        );
    };

    const cb = (message: any) => {
        debugIn(message);
        if (isCallMessage(message)) {
            const f = callHandlers?.[message.name];

            if (f === undefined) {
                debugError("No call handler", message);
            } else {
                // Call handlers are fire-and-forget (no callId), so any
                // synchronous throw cannot be reported back to the caller.
                // Swallow it here to keep the RPC bus alive.
                try {
                    f(...message.args);
                } catch (e: any) {
                    debugError(
                        "Call handler threw",
                        message.name,
                        e?.message ?? e,
                    );
                }
            }
            return;
        }
        if (isInvokeMessage(message)) {
            void processInvoke(message).catch((error) => {
                debugError(
                    "Invoke instrumentation failed",
                    getErrorMessage(error),
                );
            });
            return;
        }
        if (isInvokeCancel(message)) {
            serverInvokes.get(message.callId)?.cancel("client");
            return;
        }
        if (!isInvokeResult(message) && !isInvokeError(message)) {
            return;
        }
        const pendingInvoke = pending.get(message.callId);
        if (pendingInvoke === undefined) {
            debugError("Invalid callId", message);
            return;
        }
        pending.delete(message.callId);
        if (isInvokeResult(message)) {
            pendingInvoke.resolve(message.result);
        } else {
            debugError("Invoke error", message.stack);
            const error = new Error(message.error) as RpcFailure & {
                markdown?: string;
            };
            error.name = message.cancelled === true ? "AbortError" : "Error";
            error.rpcFailureKind =
                message.cancelled === true ? "cancelled" : "remote";
            // Only `message` survives structured cloning, so re-attach the
            // rich display the far side asked for.
            if (message.errorMarkdown !== undefined) {
                error.markdown = message.errorMarkdown;
            }
            pendingInvoke.reject(error);
        }
    };

    const bindChannel = (newChannel: RpcChannel) => {
        currentChannel = newChannel;
        connected = true;
        const generation = ++bindGeneration;
        newChannel.on("message", cb);
        newChannel.once("disconnect", () => {
            // Ignore a superseded binding: a later rebind already moved on.
            if (generation !== bindGeneration) {
                return;
            }
            debugError("disconnect");
            newChannel.off("message", cb);
            connected = false;
            rejectAllPending("Agent channel disconnected");
            cancelAllServerInvokes("disconnect");
            if (!rebindable) {
                rpc.invoke = errorFunc;
                rpc.invokeWithOptions = errorFunc;
                rpc.send = errorFunc;
            }
        });
    };

    let nextCallId = 0;
    const invoke = async (
        methodName: keyof InvokeTargetFunctions,
        args: any[],
        invokeOptions?: RpcInvokeOptions,
    ): Promise<any> => {
        if (!connected) {
            throw new Error("Agent channel disconnected");
        }

        return tracer.startActiveSpan(
            RPC_SPAN_NAME,
            {
                kind: SpanKind.CLIENT,
                attributes: createSpanAttributes(methodName as string),
            },
            async (span) => {
                const correlation = getOutboundCorrelation(options?.tracing);
                setCorrelationAttributes(span, correlation);
                try {
                    const signal = invokeOptions?.signal;
                    if (signal?.aborted === true) {
                        throw createCancellationError(signal.reason);
                    }

                    const metadata = createMetadataEnvelope(correlation);
                    const message: InvokeMessage = {
                        type: "invoke",
                        callId: nextCallId++,
                        name: methodName as string,
                        args,
                        ...(metadata === undefined ? undefined : { metadata }),
                    };

                    return await new Promise<any>((resolve, reject) => {
                        let settled = false;
                        const cleanup = () => {
                            signal?.removeEventListener("abort", onAbort);
                        };
                        const pendingInvoke: PendingInvoke = {
                            resolve(result) {
                                if (settled) {
                                    return;
                                }
                                settled = true;
                                cleanup();
                                resolve(result);
                            },
                            reject(error) {
                                if (settled) {
                                    return;
                                }
                                settled = true;
                                cleanup();
                                reject(error);
                            },
                        };
                        const onAbort = () => {
                            if (pending.get(message.callId) !== pendingInvoke) {
                                return;
                            }
                            pending.delete(message.callId);
                            try {
                                out({
                                    type: "invokeCancel",
                                    callId: message.callId,
                                });
                            } catch (error) {
                                debugError(
                                    "Failed to send invoke cancellation",
                                    getErrorMessage(error),
                                );
                            }
                            pendingInvoke.reject(
                                createCancellationError(signal?.reason),
                            );
                        };

                        pending.set(message.callId, pendingInvoke);
                        signal?.addEventListener("abort", onAbort, {
                            once: true,
                        });
                        if (signal?.aborted === true) {
                            onAbort();
                            return;
                        }
                        try {
                            out(message, (error) => {
                                if (
                                    error !== null &&
                                    pending.get(message.callId) ===
                                        pendingInvoke
                                ) {
                                    pending.delete(message.callId);
                                    pendingInvoke.reject(error);
                                }
                            });
                        } catch (error) {
                            pending.delete(message.callId);
                            pendingInvoke.reject(toError(error));
                        }
                    });
                } catch (error) {
                    recordClientError(span, error);
                    throw error;
                } finally {
                    span.end();
                }
            },
        );
    };

    const rpc = {
        invoke: (methodName: keyof InvokeTargetFunctions, ...args: any[]) =>
            invoke(methodName, args),
        invokeWithOptions: (
            methodName: keyof InvokeTargetFunctions,
            invokeOptions: RpcInvokeOptions,
            ...args: any[]
        ) => invoke(methodName, args, invokeOptions),
        send: (methodName: keyof CallTargetFunctions, ...args: any[]) => {
            if (!connected) {
                throw new Error("Agent channel disconnected");
            }
            out(
                {
                    type: "call",
                    callId: nextCallId++,
                    name: methodName as string,
                    args,
                },
                (error) => {
                    if (error !== null) {
                        throw error;
                    }
                },
            );
        },
        rebind: (newChannel: RpcChannel) => {
            if (!rebindable) {
                throw new Error("rpc was not created as rebindable");
            }
            currentChannel.off("message", cb);
            rejectAllPending("Agent channel rebound");
            cancelAllServerInvokes("rebind");
            bindChannel(newChannel);
        },
    } as RpcReturn<InvokeTargetFunctions, CallTargetFunctions>;
    bindChannel(channel);
    return rpc;
}

function createSpanAttributes(methodName: string) {
    return {
        "rpc.system": "typeagent",
        "rpc.method": isValidRpcMethod(methodName)
            ? methodName
            : "invalid_method",
    };
}

function isValidRpcMethod(value: string): boolean {
    return (
        value.length > 0 &&
        value.length <= MAX_RPC_METHOD_LENGTH &&
        RPC_METHOD_PATTERN.test(value)
    );
}

function setCorrelationAttributes(
    span: Span,
    correlation: RpcCorrelationFields | undefined,
): void {
    if (correlation?.traceId !== undefined) {
        span.setAttribute("typeagent.trace.id", correlation.traceId);
    }
    if (correlation?.sessionId !== undefined) {
        span.setAttribute("typeagent.session.id", correlation.sessionId);
    }
    if (correlation?.activationId !== undefined) {
        span.setAttribute("typeagent.activation.id", correlation.activationId);
    }
}

function getOutboundCorrelation(
    tracingOptions: RpcTracingOptions | undefined,
): RpcCorrelationFields | undefined {
    try {
        return validateCorrelationFields(
            tracingOptions?.getCorrelationFields?.(),
        );
    } catch {
        return undefined;
    }
}

function createMetadataEnvelope(
    correlation: RpcCorrelationFields | undefined,
): RpcMetadataEnvelope | undefined {
    const carrier: Record<string, string> = {};
    try {
        propagation.inject(context.active(), carrier, {
            set(target, key, value) {
                target[key.toLowerCase()] = value;
            },
        });
    } catch {
        // A host propagator must not be able to fail the RPC operation.
    }

    const traceparent = validateTraceparent(carrier.traceparent)
        ? carrier.traceparent
        : undefined;
    const tracestate = validateTracestate(carrier.tracestate)
        ? carrier.tracestate
        : undefined;
    if (
        traceparent === undefined &&
        tracestate === undefined &&
        correlation === undefined
    ) {
        return undefined;
    }
    return {
        version: RPC_METADATA_VERSION,
        ...(traceparent === undefined ? undefined : { traceparent }),
        ...(traceparent === undefined || tracestate === undefined
            ? undefined
            : { tracestate }),
        ...(correlation === undefined ? undefined : { typeagent: correlation }),
    };
}

function extractRemoteMetadata(
    metadata: unknown,
    trusted: boolean,
): {
    parentContext: Context;
    correlation: RpcCorrelationFields | undefined;
} {
    if (!trusted) {
        return { parentContext: ROOT_CONTEXT, correlation: undefined };
    }
    try {
        return extractTrustedRemoteMetadata(metadata);
    } catch {
        return { parentContext: ROOT_CONTEXT, correlation: undefined };
    }
}

function extractTrustedRemoteMetadata(metadata: unknown): {
    parentContext: Context;
    correlation: RpcCorrelationFields | undefined;
} {
    if (!isMetadataEnvelope(metadata)) {
        return { parentContext: ROOT_CONTEXT, correlation: undefined };
    }
    const traceparent = metadata.traceparent;
    const tracestate = metadata.tracestate;
    const correlation = validateCorrelationFields(metadata.typeagent);
    if (!validateTraceparent(traceparent)) {
        return { parentContext: ROOT_CONTEXT, correlation };
    }
    if (tracestate !== undefined && !validateTracestate(tracestate)) {
        return { parentContext: ROOT_CONTEXT, correlation };
    }

    const carrier: Record<string, string> = {
        traceparent,
    };
    if (tracestate !== undefined) {
        carrier.tracestate = tracestate;
    }
    try {
        const extracted = propagation.extract(ROOT_CONTEXT, carrier, {
            keys(target) {
                return Object.keys(target);
            },
            get(target, key) {
                return target[key.toLowerCase()];
            },
        });
        const spanContext = trace.getSpanContext(extracted);
        return {
            parentContext:
                spanContext !== undefined && isSpanContextValid(spanContext)
                    ? extracted
                    : ROOT_CONTEXT,
            correlation,
        };
    } catch {
        return { parentContext: ROOT_CONTEXT, correlation };
    }
}

function isMetadataEnvelope(value: unknown): value is RpcMetadataEnvelope {
    if (value === null || typeof value !== "object") {
        return false;
    }
    try {
        return (
            (value as { version?: unknown }).version === RPC_METADATA_VERSION
        );
    } catch {
        return false;
    }
}

function validateCorrelationFields(
    value: unknown,
): RpcCorrelationFields | undefined {
    if (value === null || typeof value !== "object") {
        return undefined;
    }
    const source = value as RpcCorrelationFields;
    const correlation: RpcCorrelationFields = {};
    if (isValidCorrelationValue(source.traceId)) {
        correlation.traceId = source.traceId;
    }
    if (isValidCorrelationValue(source.sessionId)) {
        correlation.sessionId = source.sessionId;
    }
    if (isValidCorrelationValue(source.activationId)) {
        correlation.activationId = source.activationId;
    }
    return Object.keys(correlation).length === 0 ? undefined : correlation;
}

function isValidCorrelationValue(value: unknown): value is string {
    return (
        typeof value === "string" &&
        value.length > 0 &&
        [...value].length <= MAX_CORRELATION_LENGTH &&
        CORRELATION_VALUE_PATTERN.test(value)
    );
}

function validateTraceparent(value: unknown): value is string {
    if (typeof value !== "string" || value.length > MAX_TRACEPARENT_LENGTH) {
        return false;
    }
    const match = TRACEPARENT_PATTERN.exec(value);
    if (match === null || match[1] === "ff") {
        return false;
    }
    return match[1] === "00" ? match[2] === "" : match[2].startsWith("-");
}

function validateTracestate(value: unknown): value is string {
    if (
        typeof value !== "string" ||
        value.length === 0 ||
        value.length > MAX_TRACESTATE_LENGTH
    ) {
        return false;
    }
    const members = value.split(",");
    if (members.length > MAX_TRACESTATE_MEMBERS) {
        return false;
    }
    const keys = new Set<string>();
    return members.every((member) => {
        const trimmed = member.trim();
        const separator = trimmed.indexOf("=");
        if (separator <= 0 || separator === trimmed.length - 1) {
            return false;
        }
        const key = trimmed.slice(0, separator);
        const stateValue = trimmed.slice(separator + 1);
        const valid =
            (SIMPLE_TRACESTATE_KEY_PATTERN.test(key) ||
                MULTITENANT_TRACESTATE_KEY_PATTERN.test(key)) &&
            TRACESTATE_VALUE_PATTERN.test(stateValue) &&
            !stateValue.endsWith(" ") &&
            !keys.has(key);
        keys.add(key);
        return valid;
    });
}

function recordClientError(span: Span, error: unknown): void {
    const failureKind = (error as RpcFailure | undefined)?.rpcFailureKind;
    if (failureKind === "cancelled" || isAbortError(error)) {
        span.recordException({ name: "AbortError", message: "cancelled" });
        span.setStatus({
            code: SpanStatusCode.ERROR,
            message: "cancelled",
        });
        return;
    }
    const message = failureKind === "remote" ? "remote error" : "rpc failed";
    span.recordException({ name: "RpcClientError", message });
    span.setStatus({ code: SpanStatusCode.ERROR, message });
}

function recordServerError(span: Span, cancelled: boolean): void {
    const name = cancelled ? "AbortError" : "RpcServerError";
    const message = cancelled ? "cancelled" : "request failed";
    span.recordException({ name, message });
    span.setStatus({ code: SpanStatusCode.ERROR, message });
}

function recordServerCancellation(
    span: Span,
    reason: ServerCancellation,
): void {
    if (reason === "client") {
        span.recordException({ name: "AbortError", message: "cancelled" });
        span.setStatus({
            code: SpanStatusCode.ERROR,
            message: "cancelled",
        });
    } else {
        recordLocalRpcError(span);
    }
}

function recordLocalRpcError(span: Span): void {
    span.recordException({ name: "RpcServerError", message: "rpc failed" });
    span.setStatus({ code: SpanStatusCode.ERROR, message: "rpc failed" });
}

function createCancellationError(reason: unknown): RpcFailure {
    if (isAbortError(reason)) {
        return reason as RpcFailure;
    }
    const error = new Error("The operation was aborted.") as RpcFailure;
    error.name = "AbortError";
    error.rpcFailureKind = "cancelled";
    return error;
}

function isAbortError(error: unknown): boolean {
    return (
        error !== null &&
        typeof error === "object" &&
        (error as { name?: unknown }).name === "AbortError"
    );
}

function getErrorMessage(error: unknown): string {
    return error !== null &&
        typeof error === "object" &&
        typeof (error as { message?: unknown }).message === "string"
        ? (error as { message: string }).message
        : String(error);
}

function toError(error: unknown): RpcFailure {
    return error instanceof Error
        ? (error as RpcFailure)
        : (new Error(String(error)) as RpcFailure);
}

function isCallMessage(message: any): message is CallMessage {
    return message?.type === "call";
}

function isInvokeMessage(message: any): message is InvokeMessage {
    return message?.type === "invoke";
}

function isInvokeCancel(message: any): message is InvokeCancel {
    return message?.type === "invokeCancel";
}

function isInvokeResult(message: any): message is InvokeResult {
    return message?.type === "invokeResult";
}

function isInvokeError(message: any): message is InvokeError {
    return message?.type === "invokeError";
}

type CallMessage = {
    type: "call";
    callId: number; // Not necessary for call messages. included for tracing.
    name: string;
    args: any[];
};

type InvokeMessage = {
    type: "invoke";
    callId: number;
    name: string;
    args: any[];
    metadata?: RpcMetadataEnvelope;
};

type InvokeCancel = {
    type: "invokeCancel";
    callId: number;
};

type InvokeResult = {
    type: "invokeResult";
    callId: number;
    result: any;
};

type InvokeError = {
    type: "invokeError";
    callId: number;
    error: string;
    cancelled?: boolean;
    errorMarkdown?: string; // Rich display for hosts that render markdown.
    stack?: string; // Optional stack trace for debugging.
};

type RpcMessage =
    | CallMessage
    | InvokeMessage
    | InvokeCancel
    | InvokeResult
    | InvokeError;
