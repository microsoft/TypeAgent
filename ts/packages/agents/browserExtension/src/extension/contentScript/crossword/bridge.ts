// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { isCrosswordMode } from "@typeagent/browser-control-rpc/crosswordDecisionTypes";
import { CrosswordDecisionHost } from "./decisionHost";

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
                    result = await host.readClue(
                        params?.clueNumber,
                        params?.clueDirection,
                    );
                    break;
                case "enterText":
                    result = await host.enterText(
                        params?.value,
                        params?.clueNumber,
                        params?.clueDirection,
                    );
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
    const modeListener = (message: { type?: string; mode?: unknown }) => {
        if (
            message.type === "crosswordModeChanged" &&
            isCrosswordMode(message.mode)
        ) {
            host.changeMode(message.mode);
            notifyMode(message.mode);
        }
    };
    const invalidate = () => host.invalidate();
    window.addEventListener("message", listener);
    window.addEventListener("pagehide", invalidate);
    window.addEventListener("popstate", invalidate);
    window.addEventListener("hashchange", invalidate);
    chrome.runtime.onMessage.addListener(modeListener);
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
    };
}
