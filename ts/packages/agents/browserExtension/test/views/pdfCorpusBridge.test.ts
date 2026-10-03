// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { setupPdfCorpusBridge } from "../../../browser/src/views/client/pdf/core/pdfCorpusBridge";
import { extractPdfMarkdown } from "@typeagent/browser-control-rpc/pdfMarkdown";
import { pdfSemanticFixture } from "../pdfSemanticFixture";

jest.mock("@typeagent/browser-control-rpc/pdfMarkdown", () => ({
    ...jest.requireActual("@typeagent/browser-control-rpc/pdfMarkdown"),
    extractPdfMarkdown: jest.fn(),
}));
const origin = "chrome-extension://" + "a".repeat(32);
const token = "trusted-correlation-token";
async function settle() {
    for (let turn = 0; turn < 30; turn++) await Promise.resolve();
}

describe("PDF Markdown viewer corpus bridge", () => {
    let originalParent: Window;
    let parent: { postMessage: jest.Mock };
    let dispose: () => void;
    let input: {
        document: { numPages: number; getPage: jest.Mock };
        bytes: Uint8Array;
        byteHash: string;
        title: string;
        canonicalUri?: string;
    } | null;
    function send(
        data: Record<string, unknown>,
        overrides: MessageEventInit = {},
    ) {
        window.dispatchEvent(
            new MessageEvent("message", {
                origin,
                source: parent as unknown as Window,
                data: { token, ...data },
                ...overrides,
            }),
        );
    }
    function initialize() {
        send({ type: "pdf-corpus-init" });
    }
    function extract() {
        send({ type: "pdf-corpus-extract", requestId: "request-one" });
    }
    function replies(type: string) {
        return parent.postMessage.mock.calls.filter(
            ([message]) => message.type === type,
        );
    }
    beforeEach(() => {
        originalParent = window.parent;
        parent = { postMessage: jest.fn() };
        Object.defineProperty(window, "parent", {
            value: parent,
            configurable: true,
        });
        document.body.innerHTML =
            '<button id="saveToCorpus" hidden>Save to corpus</button>';
        input = {
            document: {
                numPages: 2,
                getPage: jest.fn(async () => ({
                    getTextContent: async () => ({
                        items: [{ str: "PDF text" }],
                    }),
                })),
            },
            bytes: new Uint8Array([37, 80, 68, 70]),
            byteHash: "a".repeat(64),
            title: "Local PDF",
        };
        jest.mocked(extractPdfMarkdown).mockReset();
        jest.mocked(extractPdfMarkdown).mockImplementation(
            async (document, progress, options) => {
                await document.getPage(1);
                if (options?.signal?.aborted)
                    throw new DOMException("Cancelled", "AbortError");
                if (typeof progress === "function")
                    progress(1, document.numPages);
                return {
                    markdown: "PDF text\n",
                    pageCount: document.numPages,
                    emptyPages: [2],
                    artifact: pdfSemanticFixture("PDF text", options?.byteHash),
                };
            },
        );
        dispose = setupPdfCorpusBridge(() => input, "5.3.31");
    });
    afterEach(() => {
        dispose();
        Object.defineProperty(window, "parent", {
            value: originalParent,
            configurable: true,
        });
    });
    it("requires trusted parent source/origin/token and posts only text and identity", async () => {
        send(
            { type: "pdf-corpus-init" },
            { origin: "https://attacker.example" },
        );
        expect(
            document.querySelector<HTMLButtonElement>("button")!.hidden,
        ).toBe(true);
        initialize();
        document.querySelector<HTMLButtonElement>("button")!.click();
        expect(parent.postMessage).toHaveBeenCalledWith(
            { type: "pdf-corpus-open", token },
            origin,
        );
        send(
            { type: "pdf-corpus-extract", requestId: "foreign" },
            { origin: "https://attacker.example" },
        );
        send({
            type: "pdf-corpus-extract",
            requestId: "foreign",
            token: "wrong",
        });
        send(
            { type: "pdf-corpus-extract", requestId: "foreign" },
            { source: window },
        );
        expect(extractPdfMarkdown).not.toHaveBeenCalled();
        extract();
        await settle();
        expect(extractPdfMarkdown).toHaveBeenCalledTimes(1);
        expect(replies("pdf-corpus-result")).toEqual([
            [
                {
                    type: "pdf-corpus-result",
                    requestId: "request-one",
                    token,
                    result: {
                        markdown: "PDF text\n",
                        pageCount: 2,
                        emptyPages: [2],
                        byteHash: "a".repeat(64),
                        title: "Local PDF",
                        canonicalUri: "",
                    },
                },
                origin,
            ],
        ]);
        expect(JSON.stringify(replies("pdf-corpus-result"))).not.toMatch(
            /bytesBase64|artifact|blocks|schemaVersion/,
        );
    });
    it("ignores obsolete retained reopening even from the trusted parent", async () => {
        initialize();
        send({
            type: "pdf-corpus-reopen",
            requestId: "old",
            bytesBase64: "JVBERg==",
            byteHash: "a".repeat(64),
            title: "Retained",
            page: 1,
        });
        await settle();
        expect(extractPdfMarkdown).not.toHaveBeenCalled();
        expect(replies("pdf-corpus-opened")).toHaveLength(0);
        expect(replies("pdf-corpus-result")).toHaveLength(0);
    });
    it("prevents duplicate extraction and cancels only the active request", async () => {
        let finish!: () => void;
        jest.mocked(extractPdfMarkdown).mockImplementation(
            async (_document, _progress, options) => {
                await new Promise<void>((resolve) => {
                    finish = resolve;
                });
                if (options?.signal?.aborted)
                    throw new DOMException("Cancelled", "AbortError");
                return { markdown: "Text", pageCount: 2, emptyPages: [] };
            },
        );
        initialize();
        extract();
        send({ type: "pdf-corpus-extract", requestId: "request-two" });
        send({ type: "pdf-corpus-cancel", requestId: "wrong" });
        expect(
            jest.mocked(extractPdfMarkdown).mock.calls[0][2]?.signal?.aborted,
        ).toBe(false);
        send({ type: "pdf-corpus-cancel", requestId: "request-one" });
        finish();
        await settle();
        expect(replies("pdf-corpus-result")).toHaveLength(0);
        expect(replies("pdf-corpus-error")).toHaveLength(2);
        expect(
            document.querySelector<HTMLButtonElement>("button")!.disabled,
        ).toBe(false);
    });
    it("discards late results if the local PDF changed", async () => {
        let finish!: () => void;
        jest.mocked(extractPdfMarkdown).mockImplementation(async () => {
            await new Promise<void>((resolve) => {
                finish = resolve;
            });
            return { markdown: "Text", pageCount: 2, emptyPages: [] };
        });
        initialize();
        extract();
        input = { ...input!, byteHash: "b".repeat(64) };
        finish();
        await settle();
        expect(replies("pdf-corpus-result")).toHaveLength(0);
        expect(replies("pdf-corpus-error")[0][0].error).toContain(
            "PDF changed",
        );
    });
    it.each(["missing", "oversize"])(
        "rejects %s local input before extraction",
        async (kind) => {
            if (kind === "missing") input = null;
            else input!.bytes = new Uint8Array(10 * 1024 * 1024 + 1);
            initialize();
            extract();
            await settle();
            expect(extractPdfMarkdown).not.toHaveBeenCalled();
            expect(replies("pdf-corpus-error")).toHaveLength(1);
        },
    );
    it("disposes the bridge on pagehide", async () => {
        initialize();
        window.dispatchEvent(new Event("pagehide"));
        extract();
        await settle();
        expect(extractPdfMarkdown).not.toHaveBeenCalled();
        expect(
            document.querySelector<HTMLButtonElement>("button")!.hidden,
        ).toBe(true);
    });
});
