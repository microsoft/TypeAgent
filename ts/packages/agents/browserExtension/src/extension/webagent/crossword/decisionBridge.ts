// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    CrosswordMode,
    CrosswordDirection,
} from "@typeagent/browser-control-rpc/crosswordDecisionTypes";

export function crosswordBridge<T>(
    method: "getMode" | "status" | "readClue" | "enterText",
    params?: {
        clueNumber: number;
        clueDirection: CrosswordDirection;
        value?: string;
    },
): Promise<T> {
    return new Promise((resolve, reject) => {
        const requestId = crypto.randomUUID();
        const listener = (event: MessageEvent) => {
            if (
                event.source !== window ||
                event.origin !== location.origin ||
                event.data?.type !== "typeagent-crossword-response" ||
                event.data.requestId !== requestId
            )
                return;
            cleanup();
            if (event.data.error) reject(new Error(String(event.data.error)));
            else resolve(event.data.result);
        };
        const timer = setTimeout(() => {
            cleanup();
            reject(new Error("unavailable: isolated crossword bridge timeout"));
        }, 65_000);
        const cleanup = () => {
            clearTimeout(timer);
            window.removeEventListener("message", listener);
        };
        window.addEventListener("message", listener);
        window.postMessage(
            { type: "typeagent-crossword-request", requestId, method, params },
            location.origin,
        );
    });
}

export async function getCrosswordMode(): Promise<CrosswordMode> {
    // Electron does not inject the extension's isolated-world bridge.
    if (window.electronAPI?.getTabId) return "generative";
    const result = await crosswordBridge<{ mode: CrosswordMode }>("getMode");
    if (result.mode !== "decision" && result.mode !== "generative")
        throw new Error("unavailable: invalid crossword mode");
    return result.mode;
}
