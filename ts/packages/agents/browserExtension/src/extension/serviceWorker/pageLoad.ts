// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

async function mainDocumentId(tabId: number): Promise<string> {
    const frame = await chrome.webNavigation.getFrame({ tabId, frameId: 0 });
    if (
        !frame ||
        !("documentId" in frame) ||
        typeof frame.documentId !== "string" ||
        !frame.documentId
    )
        throw new Error(
            "Page load is unavailable: missing main document identity",
        );
    return frame.documentId;
}

function navigationError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return [
        "Could not establish connection",
        "Receiving end does not exist",
        "message port closed",
        "message channel closed",
        "No document with id",
        "Frame with ID",
        "frame was removed",
    ].some((text) => message.includes(text));
}

async function withinDeadline<T>(
    operation: Promise<T>,
    timeout: number,
): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            operation,
            new Promise<never>((_, reject) => {
                timer = setTimeout(
                    () => reject(new Error("Page load timed out")),
                    timeout,
                );
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}

export async function awaitDocumentPageLoad(
    tabId: number,
    timeout = 5000,
): Promise<string> {
    if (!Number.isFinite(timeout) || timeout <= 0)
        throw new Error("Page load timeout must be a positive finite number");
    const deadline = Date.now() + timeout;
    const pause = async () => {
        const remaining = deadline - Date.now();
        if (remaining > 0)
            await new Promise((resolve) =>
                setTimeout(resolve, Math.min(100, remaining)),
            );
    };
    while (Date.now() < deadline) {
        if ((await chrome.tabs.get(tabId)).pendingUrl) {
            await pause();
            continue;
        }
        const documentId = await mainDocumentId(tabId);
        try {
            const remaining = deadline - Date.now();
            if (remaining <= 0) break;
            // This passive read may be retried after navigation; mutations never are.
            const result: unknown = await withinDeadline(
                chrome.tabs.sendMessage(
                    tabId,
                    { type: "await_page_incremental_load", timeout: remaining },
                    { documentId },
                ),
                remaining,
            );
            if ((await mainDocumentId(tabId)) !== documentId) continue;
            const tab = await chrome.tabs.get(tabId);
            // Readiness concerns the committed main document, not pending ad/frame resources.
            if (
                tab.pendingUrl ||
                (result === undefined && tab.status === "loading")
            ) {
                await pause();
                continue;
            }
            if (result && typeof result === "object" && "error" in result)
                throw new Error(`Page load failed: ${String(result.error)}`);
            if (typeof result !== "string")
                throw new Error(
                    "Page load returned an invalid document response",
                );
            return result;
        } catch (error) {
            if (!navigationError(error)) throw error;
            await pause();
        }
    }
    throw new Error("Page load timed out during navigation");
}
