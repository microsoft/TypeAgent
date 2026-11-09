// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { PDFViewPage } from "../../src/extension/views/pdfView";
import { createChromeRpcClient } from "../../src/extension/views/chromeRpcClient";
import {
    createPdfCorpusImport,
    type PdfImportContent,
    type PdfProvider,
} from "../../src/extension/views/pdfCorpusImport";
import { randomUUID } from "node:crypto";
import { TextEncoder } from "node:util";

jest.mock("../../src/extension/views/chromeRpcClient", () => ({
    createChromeRpcClient: jest.fn(),
}));
const mockElectronClient = jest.fn();
jest.mock("../../src/extension/views/electronRpcClient", () => ({
    createElectronRpcClient: () => mockElectronClient(),
}));
const mockOpen = jest.fn();
jest.mock("../../src/extension/views/pdfCorpusImport", () => ({
    createPdfCorpusImport: jest.fn(() => ({ open: mockOpen })),
}));
const invoke = jest.fn();
type Controller = {
    corpusReady: boolean;
    corpusToken: string;
    viewerUrl: string;
    loadPDFViewer: () => Promise<void>;
    extractForCorpus: (
        progress: (completed: number, total: number) => void,
        signal?: AbortSignal,
    ) => Promise<PdfImportContent>;
    resetCorpus: () => void;
};
const content: PdfImportContent = {
    markdown: "# Manual\nText",
    title: "Manual",
    byteHash: "a".repeat(64),
    canonicalUri: "https://example.com/manual.pdf",
    pageCount: 2,
    emptyPages: [],
};
async function settle() {
    for (let turn = 0; turn < 20; turn++) await Promise.resolve();
}

describe("PDF Markdown parent viewer", () => {
    let page: PDFViewPage;
    let controller: Controller;
    let frame: Window;
    let post: jest.SpyInstance;
    function send(
        data: Record<string, unknown>,
        overrides: MessageEventInit = {},
    ) {
        window.dispatchEvent(
            new MessageEvent("message", {
                origin: "http://localhost:5194",
                source: frame,
                data: { token: controller.corpusToken, ...data },
                ...overrides,
            }),
        );
    }
    function requestId(): string {
        return post.mock.calls.find(
            ([message]) => message.type === "pdf-corpus-extract",
        )![0].requestId;
    }
    beforeEach(() => {
        jest.useFakeTimers();
        Object.defineProperty(globalThis, "TextEncoder", {
            value: TextEncoder,
            configurable: true,
        });
        invoke.mockReset();
        mockElectronClient.mockReturnValue(undefined);
        mockOpen.mockReset();
        jest.mocked(createPdfCorpusImport).mockClear();
        jest.mocked(createChromeRpcClient).mockReturnValue({
            rpc: { invoke },
        } as unknown as ReturnType<typeof createChromeRpcClient>);
        Object.defineProperty(crypto, "randomUUID", {
            configurable: true,
            value: randomUUID,
        });
        Object.defineProperty(globalThis, "chrome", {
            configurable: true,
            value: {
                runtime: {
                    id: "trusted",
                    onMessage: {
                        addListener: jest.fn(),
                        removeListener: jest.fn(),
                    },
                },
            },
        });
        document.body.innerHTML =
            '<iframe id="pdfFrame"></iframe>' +
            [
                "loadingContainer",
                "errorContainer",
                "errorMessage",
                "pdfUrlDisplay",
                "urlInfo",
            ]
                .map((id) => `<div id="${id}"></div>`)
                .join("") +
            ["retryBtn", "openInNewTabBtn"]
                .map((id) => `<button id="${id}"></button>`)
                .join("");
        window.history.replaceState({}, "", "/");
        page = new PDFViewPage();
        controller = page as unknown as Controller;
        controller.corpusReady = true;
        controller.viewerUrl = "http://localhost:5194/pdf/";
        frame =
            document.querySelector<HTMLIFrameElement>("iframe")!.contentWindow!;
        post = jest.spyOn(frame, "postMessage").mockImplementation(() => {});
    });
    afterEach(() => {
        page.dispose();
        jest.clearAllTimers();
        jest.useRealTimers();
        jest.restoreAllMocks();
    });
    it("launches the local-file viewer without any retained PDF RPC", async () => {
        controller.loadPDFViewer = jest.fn(async () => {});
        await page.initialize();
        expect(controller.loadPDFViewer).toHaveBeenCalledTimes(1);
        expect(document.getElementById("urlInfo")!.style.display).toBe("none");
        expect(invoke).not.toHaveBeenCalled();
        expect(chrome.runtime.onMessage.addListener).not.toHaveBeenCalled();
    });
    it("reuses Electron preload RPC for viewer imports instead of Chrome runtime", () => {
        const nativeInvoke = jest.fn();
        const nativeRpc = { invoke: nativeInvoke };
        mockElectronClient.mockReturnValue({ rpc: nativeRpc });
        jest.mocked(createChromeRpcClient).mockClear();
        let nativePage: PDFViewPage | undefined;
        jest.isolateModules(() => {
            const {
                PDFViewPage: NativePage,
            } = require("../../src/extension/views/pdfView");
            nativePage = new NativePage();
        });
        expect(createPdfCorpusImport).toHaveBeenLastCalledWith(
            undefined,
            nativeRpc,
        );
        expect(createChromeRpcClient).not.toHaveBeenCalled();
        nativePage?.dispose();
    });
    it("ignores obsolete capture launch parameters without reading binaries", async () => {
        window.history.replaceState(
            {},
            "",
            `/?captureId=${"a".repeat(64)}&revisionId=old&page=2`,
        );
        controller.loadPDFViewer = jest.fn(async () => {});
        await page.initialize();
        expect(controller.loadPDFViewer).toHaveBeenCalledTimes(1);
        expect(invoke).not.toHaveBeenCalled();
        expect(page.getStatus()).toEqual(
            expect.objectContaining({ pdfUrl: null }),
        );
    });
    it("reuses parent RPC for the import dialog and opens only for trusted viewer messages", async () => {
        expect(createPdfCorpusImport).toHaveBeenCalledWith(undefined, {
            invoke,
        });
        send(
            { type: "pdf-corpus-open" },
            { origin: "https://attacker.example" },
        );
        send({ type: "pdf-corpus-open", token: "wrong" });
        send({ type: "pdf-corpus-open" }, { source: window });
        expect(mockOpen).not.toHaveBeenCalled();
        send({ type: "pdf-corpus-open" });
        expect(mockOpen).toHaveBeenCalledTimes(1);
        const provider = mockOpen.mock.calls[0][0] as PdfProvider;
        const response = provider(() => {});
        send({
            type: "pdf-corpus-result",
            requestId: requestId(),
            result: content,
        });
        await expect(response).resolves.toEqual(content);
        expect(invoke).not.toHaveBeenCalled();
    });
    it("returns only Markdown identity and statistics even if the viewer supplies obsolete fields", async () => {
        const response = controller.extractForCorpus(() => {});
        send({
            type: "pdf-corpus-result",
            requestId: requestId(),
            result: {
                ...content,
                bytesBase64: "SECRET",
                artifact: { secret: "layout" },
            },
        });
        await expect(response).resolves.toEqual(content);
        expect(post).toHaveBeenCalledWith(
            {
                type: "pdf-corpus-extract",
                requestId: requestId(),
                token: controller.corpusToken,
            },
            "http://localhost:5194",
        );
        expect(invoke).not.toHaveBeenCalled();
    });
    it("correlates origin, source, token and request ID before accepting progress or a result", async () => {
        const progress = jest.fn();
        const response = controller.extractForCorpus(progress);
        const id = requestId();
        send(
            { type: "pdf-corpus-result", requestId: id, result: content },
            { origin: "https://attacker.example" },
        );
        send({
            type: "pdf-corpus-result",
            requestId: id,
            token: "wrong",
            result: content,
        });
        send({
            type: "pdf-corpus-result",
            requestId: "wrong",
            result: content,
        });
        send(
            {
                type: "pdf-corpus-progress",
                requestId: id,
                completed: 1,
                total: 2,
            },
            { source: window },
        );
        await settle();
        expect(progress).not.toHaveBeenCalled();
        send({
            type: "pdf-corpus-progress",
            requestId: id,
            completed: 1,
            total: 2,
        });
        expect(progress).toHaveBeenCalledWith(1, 2);
        send({ type: "pdf-corpus-result", requestId: id, result: content });
        await expect(response).resolves.toEqual(content);
    });
    it.each([
        { ...content, byteHash: "invalid" },
        { ...content, markdown: undefined },
        { ...content, pageCount: 0 },
        { ...content, emptyPages: "invalid" },
        { ...content, emptyPages: [0] },
        { ...content, emptyPages: [3] },
        { ...content, emptyPages: [1.5] },
    ])("rejects malformed extraction results", async (result) => {
        const response = controller.extractForCorpus(() => {});
        const rejected = expect(response).rejects.toThrow(
            "Invalid PDF extraction response",
        );
        send({ type: "pdf-corpus-result", requestId: requestId(), result });
        await rejected;
        expect(post.mock.calls.at(-1)?.[0].type).toBe("pdf-corpus-cancel");
        expect(invoke).not.toHaveBeenCalled();
    });
    it("propagates viewer conversion errors without submitting", async () => {
        const response = controller.extractForCorpus(() => {});
        const rejected = expect(response).rejects.toThrow("Conversion failed");
        send({
            type: "pdf-corpus-error",
            requestId: requestId(),
            error: "Conversion failed",
        });
        await rejected;
        expect(invoke).not.toHaveBeenCalled();
    });
    it("cancels local extraction and ignores the late result", async () => {
        const abort = new AbortController();
        const response = controller.extractForCorpus(() => {}, abort.signal);
        const id = requestId();
        const rejected = expect(response).rejects.toThrow("cancelled");
        abort.abort();
        await rejected;
        expect(post).toHaveBeenLastCalledWith(
            {
                type: "pdf-corpus-cancel",
                requestId: id,
                token: controller.corpusToken,
            },
            "http://localhost:5194",
        );
        send({ type: "pdf-corpus-result", requestId: id, result: content });
        expect(invoke).not.toHaveBeenCalled();
    });
    it("discards extraction on frame reload", async () => {
        const response = controller.extractForCorpus(() => {});
        const rejected = expect(response).rejects.toThrow("changed or closed");
        controller.resetCorpus();
        await rejected;
        expect(controller.corpusReady).toBe(false);
    });
    it("rejects an extraction timeout and cleans up", async () => {
        const response = controller.extractForCorpus(() => {});
        const rejected = expect(response).rejects.toThrow("timed out");
        await jest.advanceTimersByTimeAsync(600000);
        await rejected;
        expect(post.mock.calls.at(-1)?.[0].type).toBe("pdf-corpus-cancel");
    });
    it("rejects requests after disposal", async () => {
        page.dispose();
        await expect(controller.extractForCorpus(() => {})).rejects.toThrow(
            "not ready",
        );
        expect(post).not.toHaveBeenCalled();
    });
    it("integrates parent conversion with the real Markdown importer and ordinary memory jobs", async () => {
        const { createPdfCorpusImport: createImporter } = jest.requireActual<
            typeof import("../../src/extension/views/pdfCorpusImport")
        >("../../src/extension/views/pdfCorpusImport");
        const identity = {
            jobId: "job-one",
            corpusId: "corpus-one",
            sourceId: "source-one",
            revisionId: "revision-one",
        };
        sessionStorage.clear();
        invoke.mockImplementation(async (method: string) => {
            if (method === "memoryListCorpora")
                return [{ corpusId: identity.corpusId, name: "Documents" }];
            if (method === "memoryImportDocument")
                return {
                    ...identity,
                    state: "accepted",
                    statusUri: "memory://job-one",
                };
            if (method === "memoryListJobs")
                return {
                    items: [
                        {
                            ...identity,
                            state: "complete",
                            progress: { completed: 2, total: 2 },
                            createdAt: "2026-10-02",
                            updatedAt: "2026-10-02",
                            warnings: [],
                        },
                    ],
                };
            throw new Error(`Unexpected RPC ${method}`);
        });
        HTMLDialogElement.prototype.showModal = function () {
            this.setAttribute("open", "");
        };
        HTMLDialogElement.prototype.close = function () {
            this.removeAttribute("open");
            this.dispatchEvent(new Event("close"));
        };
        const refresh = jest.fn(async () => {});
        const importer = createImporter(refresh, { invoke });
        await importer.open((progress, signal) =>
            controller.extractForCorpus(progress, signal),
        );
        document
            .querySelector("form")!
            .dispatchEvent(new Event("submit", { cancelable: true }));
        send({
            type: "pdf-corpus-result",
            requestId: requestId(),
            result: content,
        });
        await settle();
        expect(invoke).toHaveBeenCalledWith("memoryImportDocument", {
            corpusId: identity.corpusId,
            title: content.title,
            markdown: content.markdown,
            canonicalUri: content.canonicalUri,
        });
        await jest.advanceTimersByTimeAsync(1000);
        expect(invoke.mock.calls.map(([method]) => method)).toEqual([
            "memoryListCorpora",
            "memoryImportDocument",
            "memoryListJobs",
        ]);
        expect(refresh).toHaveBeenCalledTimes(1);
        expect(sessionStorage.getItem("pdfCorpusImport.pendingJob")).toBeNull();
        window.dispatchEvent(new Event("pagehide"));
    });
});
