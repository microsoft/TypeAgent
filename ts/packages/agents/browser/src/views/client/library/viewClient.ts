// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { MemoryCenterInvokeFunctions } from "@typeagent/browser-control-rpc/serviceTypes";
import type {
    UnderstandingRequest,
    UnderstandingResult,
} from "@typeagent/memory-service";
import type {
    ViewEvent as ViewEventEnvelope,
    ViewInvokeFunctions,
    ViewMethod,
    ViewResponse,
} from "@typeagent/browser-control-rpc/viewRpc";

type ViewResult<M extends ViewMethod> = Awaited<
    ReturnType<ViewInvokeFunctions[M]>
>;
type EmptyViewMethod = {
    [M in ViewMethod]: {} extends Parameters<ViewInvokeFunctions[M]>[0]
        ? M
        : never;
}[ViewMethod];

export function invokeView<M extends EmptyViewMethod>(
    method: M,
): Promise<ViewResult<M>>;
export function invokeView<M extends ViewMethod>(
    method: M,
    params: Parameters<ViewInvokeFunctions[M]>[0],
    options?: { signal?: AbortSignal },
): Promise<ViewResult<M>>;
export async function invokeView<M extends ViewMethod>(
    method: M,
    params?: Parameters<ViewInvokeFunctions[M]>[0],
    options?: { signal?: AbortSignal },
): Promise<ViewResult<M>> {
    let response: Response;
    try {
        response = await fetch("/api/views/invoke", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ method, params: params ?? {} }),
            ...(options?.signal ? { signal: options.signal } : {}),
        });
    } catch (error) {
        if (options?.signal?.aborted) throw error;
        throw new Error(
            `Browser view service is unavailable: ${String(error)}`,
        );
    }
    const body = (await response.json()) as ViewResponse<
        Awaited<ReturnType<ViewInvokeFunctions[M]>>
    >;
    if (!response.ok || !body.success) {
        throw new Error(
            !body.success
                ? body.error || `View request failed (${response.status})`
                : `View request failed (${response.status})`,
        );
    }
    return body.data;
}

export function invokeMemory<M extends keyof MemoryCenterInvokeFunctions>(
    method: M,
    params: Parameters<MemoryCenterInvokeFunctions[M]>[0],
): Promise<Awaited<ReturnType<MemoryCenterInvokeFunctions[M]>>> {
    return invokeView(method, params);
}

export async function checkViewHealth(): Promise<boolean> {
    const response = await fetch("/api/health");
    return response.ok;
}

export async function streamUnderstanding(
    request: UnderstandingRequest,
    onResult: (result: UnderstandingResult) => void,
    signal: AbortSignal,
): Promise<void> {
    const response = await fetch("/api/views/understand", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal,
    });
    if (!response.ok || !response.body)
        throw new Error(
            `Understanding stream is unavailable (${response.status})`,
        );
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    let completed = false;
    try {
        for (;;) {
            const chunk = await reader.read();
            if (chunk.done) break;
            pending += decoder.decode(chunk.value, { stream: true });
            if (pending.length > 512 * 1024)
                throw new Error(
                    "Understanding stream exceeded its frame limit",
                );
            let boundary: number;
            while ((boundary = pending.indexOf("\n\n")) >= 0) {
                const frame = pending.slice(0, boundary);
                pending = pending.slice(boundary + 2);
                if (!frame.startsWith("data: ")) continue;
                const event = JSON.parse(frame.slice(6)) as
                    | { type: "result"; data: UnderstandingResult }
                    | { type: "complete" }
                    | { type: "error"; error: string };
                if (completed)
                    throw new Error(
                        "Understanding data arrived after completion",
                    );
                if (event.type === "error") throw new Error(event.error);
                if (event.type === "result") {
                    if (
                        event.data.corpusId !== request.corpusId ||
                        event.data.question !== request.question.trim()
                    )
                        throw new Error(
                            "Understanding stream scope does not match",
                        );
                    onResult(event.data);
                } else if (event.type === "complete") completed = true;
                else throw new Error("Unknown understanding stream event");
            }
        }
        if (!completed)
            throw new Error(
                "Understanding stream ended before completion; retry the question",
            );
    } finally {
        await reader.cancel();
        reader.releaseLock();
    }
}

type ViewEvent = "importProgress" | "knowledgeExtractionProgress";
type EventListener = (payload: unknown) => void;
const listeners = new Map<ViewEvent, Set<EventListener>>();
let events: EventSource | undefined;
let ready: Promise<void> | undefined;

export function connectViewEvents(): Promise<void> {
    if (ready) return ready;
    if (!events) {
        events = new EventSource("/api/views/events");
        events.addEventListener("error", () => {
            ready = undefined;
            window.dispatchEvent(
                new CustomEvent("viewServiceError", {
                    detail: "Browser view progress stream disconnected. Import progress may be unavailable.",
                }),
            );
        });
        events.addEventListener("message", (event) => {
            try {
                const envelope = JSON.parse(
                    (event as MessageEvent<string>).data,
                ) as ViewEventEnvelope;
                listeners
                    .get(envelope.type)
                    ?.forEach((listener) => listener(envelope.data));
            } catch (error) {
                window.dispatchEvent(
                    new CustomEvent("viewServiceError", {
                        detail: `Invalid progress event: ${String(error)}`,
                    }),
                );
            }
        });
    }
    if (events.readyState === EventSource.OPEN) {
        return Promise.resolve();
    }
    const source = events;
    ready = new Promise((resolve, reject) => {
        const cleanup = () => {
            source.removeEventListener("open", onOpen);
            source.removeEventListener("error", onError);
        };
        const onOpen = () => {
            cleanup();
            resolve();
        };
        const onError = () => {
            cleanup();
            reject(
                new Error(
                    "Browser view progress stream is unavailable. It will reconnect automatically.",
                ),
            );
        };
        source.addEventListener("open", onOpen);
        source.addEventListener("error", onError);
    });
    return ready;
}

export function onViewEvent(
    name: ViewEvent,
    listener: EventListener,
): () => void {
    const callbacks = listeners.get(name) || new Set<EventListener>();
    callbacks.add(listener);
    listeners.set(name, callbacks);
    void connectViewEvents().catch((error) =>
        console.error("Browser view progress subscription failed:", error),
    );
    return () => callbacks.delete(listener);
}

window.addEventListener("pagehide", () => {
    events?.close();
    events = undefined;
    ready = undefined;
    listeners.clear();
});
