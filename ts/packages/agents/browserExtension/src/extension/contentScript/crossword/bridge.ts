// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    isCrosswordMode,
    isCrosswordDecisionStrategy,
} from "@typeagent/browser-control-rpc/crosswordDecisionTypes";
import { CrosswordDecisionHost } from "./decisionHost";

type CapturedParams = Parameters<CrosswordDecisionHost["executeCaptured"]>[1];

function isCapturedParams(value: unknown): value is CapturedParams {
    if (!value || typeof value !== "object") return false;
    const params = value as Record<string, unknown>;
    return (
        typeof params.snapshotId === "string" &&
        typeof params.candidateId === "string" &&
        typeof params.configGeneration === "string" &&
        typeof params.clueNumber === "number" &&
        (params.clueDirection === "across" ||
            params.clueDirection === "down") &&
        (params.value === undefined || typeof params.value === "string")
    );
}

async function dispatchFrameAction(
    host: CrosswordDecisionHost,
    method: "readClue" | "enterText",
    params: unknown,
): Promise<unknown> {
    if ((await host.getMode()).mode !== "decision")
        throw new Error("unsupported: decision mode is not selected");
    const intent =
        params && typeof params === "object"
            ? (params as Record<string, unknown>)
            : {};
    const response: unknown = await chrome.runtime.sendMessage({
        type: "crosswordFrameAction",
        method,
        params: {
            clueNumber: intent.clueNumber,
            clueDirection: intent.clueDirection,
            ...(method === "enterText" ? { value: intent.value } : {}),
        },
    });
    if (!response || typeof response !== "object")
        throw new Error("unavailable: crossword frame action");
    const result = response as { error?: unknown; result?: unknown };
    if (typeof result.error === "string") throw new Error(result.error);
    if (!Object.prototype.hasOwnProperty.call(result, "result"))
        throw new Error("unavailable: crossword frame action");
    return result.result;
}

export function initializeCrosswordBridge(): () => void {
    const host = new CrosswordDecisionHost((message) =>
        chrome.runtime.sendMessage(message),
    );
    const notifyMode = (mode: string) =>
        window.postMessage(
            { type: "typeagent-crossword-mode", mode },
            location.origin,
        );
    const pending = new Set<string>();
    const listener = async (event: MessageEvent) => {
        if (
            event.source !== window ||
            event.origin !== location.origin ||
            event.data?.type !== "typeagent-crossword-request"
        )
            return;
        const { requestId, method, params } = event.data;
        if (
            typeof requestId !== "string" ||
            requestId.length > 100 ||
            pending.has(requestId) ||
            pending.size >= 64
        )
            return;
        pending.add(requestId);
        try {
            let result: unknown;
            switch (method) {
                case "getMode":
                    result = await host.getMode();
                    break;
                case "status":
                    result = await host.status();
                    break;
                case "readClue":
                case "enterText":
                    result = await dispatchFrameAction(host, method, params);
                    break;
                default:
                    throw new Error(
                        "unsupported: unknown crossword bridge method",
                    );
            }
            window.postMessage(
                { type: "typeagent-crossword-response", requestId, result },
                location.origin,
            );
        } catch (error) {
            window.postMessage(
                {
                    type: "typeagent-crossword-response",
                    requestId,
                    error:
                        error instanceof Error
                            ? error.message
                            : "provider_error",
                },
                location.origin,
            );
        } finally {
            pending.delete(requestId);
        }
    };
    const modeListener = (message: {
        type?: string;
        mode?: unknown;
        strategy?: unknown;
    }) => {
        if (
            message.type === "crosswordModeChanged" &&
            isCrosswordMode(message.mode) &&
            (message.strategy === undefined ||
                isCrosswordDecisionStrategy(message.strategy))
        ) {
            host.changeMode(message.mode, message.strategy);
            notifyMode(message.mode);
        }
    };
    const invalidate = () => host.invalidate();
    const frameListener = (
        message: { type?: string; params?: unknown },
        sender: chrome.runtime.MessageSender,
        sendResponse: (response: unknown) => void,
    ) => {
        if (
            message?.type !== "crosswordFrameCapture" &&
            message?.type !== "crosswordFrameRead" &&
            message?.type !== "crosswordFrameEnter"
        )
            return;
        if (
            sender.id !== chrome.runtime.id ||
            sender.tab !== undefined ||
            (sender.url !== undefined &&
                !sender.url.startsWith(chrome.runtime.getURL("")))
        ) {
            sendResponse({
                error: "unsupported: untrusted crossword frame sender",
            });
            return false;
        }
        const execute = async () => {
            if (message.type === "crosswordFrameCapture")
                return { snapshot: await host.capture() };
            if (!isCapturedParams(message.params))
                throw new Error(
                    "unsupported: invalid captured crossword parameters",
                );
            return {
                result: await host.executeCaptured(
                    message.type === "crosswordFrameRead"
                        ? "readClue"
                        : "enterText",
                    message.params,
                ),
            };
        };
        void execute()
            .then(sendResponse)
            .catch((error) =>
                sendResponse({
                    error:
                        error instanceof Error
                            ? error.message
                            : "unavailable: crossword frame operation",
                }),
            );
        return true;
    };
    window.addEventListener("message", listener);
    window.addEventListener("pagehide", invalidate);
    window.addEventListener("popstate", invalidate);
    window.addEventListener("hashchange", invalidate);
    chrome.runtime.onMessage.addListener(modeListener);
    chrome.runtime.onMessage.addListener(frameListener);
    void host
        .getMode()
        .then(({ mode }) => notifyMode(mode))
        .catch(() => {});
    return () => {
        host.dispose();
        window.removeEventListener("message", listener);
        window.removeEventListener("pagehide", invalidate);
        window.removeEventListener("popstate", invalidate);
        window.removeEventListener("hashchange", invalidate);
        chrome.runtime.onMessage.removeListener(modeListener);
        chrome.runtime.onMessage.removeListener(frameListener);
    };
}
