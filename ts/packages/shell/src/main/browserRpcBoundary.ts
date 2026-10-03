import type { IpcMainEvent, WebContents } from "electron";

const trustedViewPaths = new Set([
    "/views/annotationsLibrary.html",
    "/views/chatPanel.html",
    "/views/entityGraphView.html",
    "/views/memoryHub.html",
    "/views/macrosLibrary.html",
    "/views/options.html",
    "/views/pdfView.html",
    "/views/topicGraphView.html",
]);

export function isTrustedBrowserRpcSender(
    event: Pick<IpcMainEvent, "sender" | "senderFrame">,
    ownedContents: readonly WebContents[],
    extensionId: string | undefined,
): boolean {
    if (
        !extensionId ||
        event.sender.isDestroyed() ||
        !ownedContents.includes(event.sender) ||
        !event.senderFrame ||
        event.senderFrame !== event.sender.mainFrame
    ) {
        return false;
    }
    try {
        const url = new URL(event.senderFrame.url);
        return (
            url.protocol === "chrome-extension:" &&
            url.host === extensionId &&
            trustedViewPaths.has(url.pathname)
        );
    } catch {
        return false;
    }
}

export function isLegacyBrowserRelayMessage(message: unknown): boolean {
    if (!message || typeof message !== "object") return false;
    const record = message as Record<string, unknown>;
    return record.name === undefined && typeof record.method === "string";
}
