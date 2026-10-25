// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    CROSSWORD_DECISION_LIMITS,
    type CrosswordDecisionCapabilities,
    type CrosswordRpcOrigin,
    type ResolveCrosswordClueRequest,
    type ResolveCrosswordClueResponse,
} from "@typeagent/browser-control-rpc/crosswordDecisionTypes";
import { getWebSocket } from "./websocket";

type Pending = {
    origin?: CrosswordRpcOrigin;
    snapshotId?: string;
    cancel: () => void;
};
const pending = new Map<string, Pending>();

function capabilitiesResponse(result: {
    available?: unknown;
    configGeneration?: unknown;
    provider?: unknown;
    model?: unknown;
}): CrosswordDecisionCapabilities {
    return {
        available: result.available === true,
        configGeneration:
            typeof result.configGeneration === "string"
                ? result.configGeneration.slice(0, 256)
                : "",
        provider:
            typeof result.provider === "string"
                ? result.provider.slice(0, 256)
                : undefined,
        model:
            typeof result.model === "string"
                ? result.model.slice(0, 256)
                : undefined,
    };
}

export async function getCrosswordRpcOrigin(
    sender: chrome.runtime.MessageSender,
): Promise<CrosswordRpcOrigin | undefined> {
    if (
        typeof sender.id !== "string" ||
        sender.id.length === 0 ||
        sender.id !== chrome.runtime.id ||
        (sender.documentLifecycle !== undefined &&
            sender.documentLifecycle !== "active") ||
        !Number.isInteger(sender.tab?.id) ||
        sender.tab!.id! < 0 ||
        !Number.isInteger(sender.frameId) ||
        sender.frameId! < 0 ||
        typeof sender.documentId !== "string" ||
        !sender.documentId ||
        sender.documentId.length > 256 ||
        !sender.url
    )
        return undefined;
    try {
        const url = new URL(sender.url);
        if (url.protocol !== "https:" && url.protocol !== "http:")
            return undefined;
        if (
            !(await chrome.permissions.contains({
                origins: [`${url.origin}/*`],
            }))
        ) {
            return undefined;
        }
        return {
            tabId: sender.tab!.id!,
            frameId: sender.frameId!,
            documentId: sender.documentId,
        };
    } catch {
        return undefined;
    }
}

function sameOrigin(a?: CrosswordRpcOrigin, b?: CrosswordRpcOrigin): boolean {
    return (
        !!a &&
        !!b &&
        a.tabId === b.tabId &&
        a.frameId === b.frameId &&
        a.documentId === b.documentId
    );
}

export function cancelCrosswordDecisionRpc(
    origin: CrosswordRpcOrigin,
    snapshotId?: string,
): void {
    for (const request of pending.values()) {
        if (
            sameOrigin(request.origin, origin) &&
            (snapshotId === undefined || request.snapshotId === snapshotId)
        ) {
            request.cancel();
        }
    }
}

export function forwardCrosswordDecisionRpc(
    method: "getCrosswordDecisionCapabilities",
    params?: undefined,
    origin?: CrosswordRpcOrigin,
): Promise<CrosswordDecisionCapabilities>;
export function forwardCrosswordDecisionRpc(
    method: "resolveCrosswordClue",
    params: ResolveCrosswordClueRequest,
    origin?: CrosswordRpcOrigin,
): Promise<ResolveCrosswordClueResponse>;
export async function forwardCrosswordDecisionRpc(
    method: "getCrosswordDecisionCapabilities" | "resolveCrosswordClue",
    params?: ResolveCrosswordClueRequest,
    origin?: CrosswordRpcOrigin,
): Promise<CrosswordDecisionCapabilities | ResolveCrosswordClueResponse> {
    const boundedText = (value: unknown): string =>
        typeof value === "string" && value.length <= 256 ? value : "";
    const boundedInteger = (value: unknown): number =>
        typeof value === "number" && Number.isSafeInteger(value) && value >= 0
            ? value
            : 0;
    const failure = (status: "unavailable" | "cancelled" | "unsupported") =>
        method === "getCrosswordDecisionCapabilities"
            ? { available: false, configGeneration: "", message: status }
            : {
                  snapshotId: boundedText(params?.snapshot?.snapshotId),
                  documentToken: boundedText(params?.snapshot?.documentToken),
                  puzzleId: boundedText(params?.snapshot?.puzzleId),
                  revision: boundedInteger(params?.snapshot?.revision),
                  modeGeneration: boundedInteger(
                      params?.snapshot?.modeGeneration,
                  ),
                  configGeneration: "",
                  status,
              };
    if (method === "resolveCrosswordClue" && !origin)
        return failure("unsupported");
    if (method === "resolveCrosswordClue") {
        try {
            if (
                !params?.snapshot ||
                new Blob([JSON.stringify(params)]).size >
                    CROSSWORD_DECISION_LIMITS.snapshotBytes
            ) {
                return failure("unsupported");
            }
        } catch {
            return failure("unsupported");
        }
    }
    const socket = getWebSocket();
    if (!socket || socket.readyState !== 1 || pending.size >= 128) {
        return failure("unavailable");
    }
    const id = crypto.randomUUID();
    return new Promise((resolve) => {
        let settled = false;
        const finish = (
            value: CrosswordDecisionCapabilities | ResolveCrosswordClueResponse,
        ) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            pending.delete(id);
            socket.removeEventListener("message", onMessage);
            socket.removeEventListener("close", onClose);
            resolve(value);
        };
        const cancel = () => {
            if (settled) return;
            try {
                if (socket.readyState === 1) {
                    socket.send(
                        JSON.stringify({
                            source: "webAgent",
                            method: "webAgent/message",
                            params: {
                                type: "builtInRpc",
                                id: crypto.randomUUID(),
                                method: "cancelCrosswordDecision",
                                params: { requestId: id, origin },
                            },
                        }),
                    );
                }
            } catch {}
            finish(failure("cancelled"));
        };
        const onClose = () => finish(failure("unavailable"));
        const onMessage = (event: MessageEvent) => {
            if (typeof event.data !== "string" || event.data.length > 16_384)
                return;
            let message;
            try {
                message = JSON.parse(event.data);
            } catch {
                return;
            }
            if (
                message?.source !== "dispatcher" ||
                message.method !== "crosswordDecision/response" ||
                message.type !== "builtInRpcResponse" ||
                message.id !== id
            )
                return;
            const result = message.result;
            if (!result || typeof result !== "object") {
                finish(failure("unavailable"));
                return;
            }
            if (method === "resolveCrosswordClue") {
                const snapshot = params?.snapshot;
                const identityKeys = [
                    "snapshotId",
                    "documentToken",
                    "puzzleId",
                    "revision",
                    "modeGeneration",
                ] as const;
                if (
                    !snapshot ||
                    identityKeys.some((key) => result[key] !== snapshot[key])
                ) {
                    finish(failure("cancelled"));
                    return;
                }
            }
            if (method === "getCrosswordDecisionCapabilities") {
                finish(capabilitiesResponse(result));
            } else {
                const statuses = [
                    "resolved",
                    "no_fit",
                    "ambiguous",
                    "unsupported",
                    "stale",
                    "unavailable",
                    "cancelled",
                    "provider_error",
                ];
                if (
                    !statuses.includes(result.status) ||
                    typeof result.configGeneration !== "string" ||
                    (result.status === "resolved" &&
                        !params!.snapshot.candidates.some(
                            (c) => c.id === result.candidateId,
                        ))
                ) {
                    finish(failure("unavailable"));
                    return;
                }
                finish({
                    ...failure("unavailable"),
                    snapshotId: result.snapshotId,
                    documentToken: result.documentToken,
                    puzzleId: result.puzzleId,
                    revision: result.revision,
                    modeGeneration: result.modeGeneration,
                    configGeneration: result.configGeneration.slice(0, 256),
                    status: result.status,
                    ...(typeof result.message === "string"
                        ? { message: result.message.slice(0, 512) }
                        : {}),
                    ...(result.status === "resolved"
                        ? {
                              candidateId: result.candidateId,
                              choiceProbability: result.choiceProbability,
                          }
                        : {}),
                });
            }
        };
        const timer = setTimeout(cancel, CROSSWORD_DECISION_LIMITS.timeoutMs);
        pending.set(id, {
            origin,
            snapshotId: params?.snapshot?.snapshotId,
            cancel,
        });
        socket.addEventListener("message", onMessage);
        socket.addEventListener("close", onClose);
        try {
            socket.send(
                JSON.stringify({
                    source: "webAgent",
                    method: "webAgent/message",
                    params: {
                        type: "builtInRpc",
                        id,
                        method,
                        params:
                            method === "resolveCrosswordClue"
                                ? { ...params, origin }
                                : {},
                    },
                }),
            );
        } catch {
            finish(failure("unavailable"));
        }
    });
}
