// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { MemoryCenterInvokeFunctions } from "@typeagent/browser-control-rpc/serviceTypes";
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
): Promise<ViewResult<M>>;
export async function invokeView<M extends ViewMethod>(
    method: M,
    params?: Parameters<ViewInvokeFunctions[M]>[0],
): Promise<ViewResult<M>> {
    let response: Response;
    try {
        response = await fetch("/api/views/invoke", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ method, params: params ?? {} }),
        });
    } catch (error) {
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
