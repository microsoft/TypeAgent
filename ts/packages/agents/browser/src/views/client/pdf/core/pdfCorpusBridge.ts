// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    extractPdfMarkdown,
    type PdfTextDocument,
} from "@typeagent/browser-control-rpc/pdfMarkdown";

interface PdfImportInput {
    document: PdfTextDocument;
    bytes: Uint8Array;
    byteHash: string;
    title: string;
    canonicalUri?: string;
}

const maxPdfBytes = 10 * 1024 * 1024;

function trustedParentOrigin(origin: string): boolean {
    return (
        /^chrome-extension:\/\/[a-p]{32}$/.test(origin) ||
        (origin !== "null" && origin === window.location.origin)
    );
}

export function setupPdfCorpusBridge(
    getInput: () => PdfImportInput | null,
    pdfjsVersion: string,
): () => void {
    let token: string | undefined;
    let parentOrigin: string | undefined;
    let disposed = false;
    let active: { requestId: string; abort: AbortController } | undefined;
    const button = document.getElementById("saveToCorpus") as HTMLButtonElement;
    const parent = window.parent;
    if (parent === window) return () => {};

    const send = (message: Record<string, unknown>) => {
        if (!disposed && token && parentOrigin)
            parent.postMessage({ ...message, token }, parentOrigin);
    };
    const checkCurrent = (
        input: PdfImportInput | null,
        signal: AbortSignal,
    ) => {
        if (disposed || signal.aborted)
            throw new DOMException("PDF request cancelled", "AbortError");
        if (input !== getInput())
            throw new Error("The PDF changed during the request. Try again.");
    };

    async function extract(
        input: PdfImportInput | null,
        requestId: string,
        signal: AbortSignal,
    ) {
        if (!input) throw new Error("Wait for the PDF to load.");
        if (input.bytes.length > maxPdfBytes)
            throw new Error("PDF imports are limited to 10 MiB.");
        const result = await extractPdfMarkdown(
            input.document,
            (completed, total) => {
                checkCurrent(input, signal);
                send({
                    type: "pdf-corpus-progress",
                    requestId,
                    completed,
                    total,
                });
            },
            {
                byteHash: input.byteHash,
                pdfjsVersion,
                signal,
                maxPages: 10000,
                maxTextChars: 10000000,
                maxBlocks: 100000,
            },
        );
        checkCurrent(input, signal);
        send({
            type: "pdf-corpus-result",
            requestId,
            result: {
                markdown: result.markdown,
                pageCount: result.pageCount,
                emptyPages: result.emptyPages,
                byteHash: input.byteHash,
                title: input.title,
                canonicalUri: input.canonicalUri ?? "",
            },
        });
    }

    async function run(requestId: string) {
        if (active) {
            send({
                type: "pdf-corpus-error",
                requestId,
                error: "A PDF request is already running.",
            });
            return;
        }
        const abort = new AbortController();
        active = { requestId, abort };
        button.disabled = true;
        const input = getInput();
        try {
            await extract(input, requestId, abort.signal);
        } catch (error) {
            send({
                type: "pdf-corpus-error",
                requestId,
                error: error instanceof Error ? error.message : String(error),
            });
        } finally {
            active = undefined;
            if (!disposed) button.disabled = false;
        }
    }

    function initialize(
        message: Record<string, unknown>,
        origin: string,
    ): boolean {
        if (message.type !== "pdf-corpus-init") return false;
        if (
            !trustedParentOrigin(origin) ||
            typeof message.token !== "string" ||
            message.token.length < 16 ||
            message.token.length > 256
        )
            return true;
        if (token && (token !== message.token || parentOrigin !== origin))
            return true;
        token = message.token;
        parentOrigin = origin;
        button.hidden = false;
        send({ type: "pdf-corpus-initialized" });
        return true;
    }

    function listener(event: MessageEvent<unknown>): void {
        if (
            disposed ||
            event.source !== parent ||
            !event.data ||
            typeof event.data !== "object"
        )
            return;
        const message = event.data as Record<string, unknown>;
        if (initialize(message, event.origin)) return;
        if (!token || event.origin !== parentOrigin || message.token !== token)
            return;
        if (
            typeof message.requestId !== "string" ||
            !message.requestId.length ||
            message.requestId.length > 256
        )
            return;
        if (message.type === "pdf-corpus-cancel") {
            if (message.requestId === active?.requestId) active.abort.abort();
            return;
        }
        if (message.type === "pdf-corpus-extract") void run(message.requestId);
    }

    const click = () => {
        if (getInput()) send({ type: "pdf-corpus-open" });
    };
    function dispose(): void {
        disposed = true;
        active?.abort.abort();
        window.removeEventListener("message", listener);
        window.removeEventListener("pagehide", dispose);
        button.removeEventListener("click", click);
        button.hidden = true;
    }
    button.addEventListener("click", click);
    window.addEventListener("message", listener);
    window.addEventListener("pagehide", dispose, { once: true });
    return dispose;
}
