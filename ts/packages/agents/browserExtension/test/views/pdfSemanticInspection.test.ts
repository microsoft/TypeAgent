// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { webcrypto } from "node:crypto";
import { TextEncoder, TextDecoder } from "node:util";
import {
    extractPdfMarkdown,
    renderPdfSemanticDocument,
    type PdfTextDocument,
    type PdfExtractionArtifact,
} from "@typeagent/browser-control-rpc/pdfMarkdown";
import { pdfSemanticFixture } from "../pdfSemanticFixture";
import {
    setupPdfInspection,
    sanitizedMarkdownPreview,
    openLocalPdf,
    retainPdfBytes,
    MAX_LOCAL_PDF_BYTES,
    type PdfCaptureInput,
    type PdfInspectionHost,
} from "../../../browser/src/views/client/pdf/core/pdfInspection";

jest.mock("@typeagent/browser-control-rpc/pdfMarkdown", () => ({
    ...jest.requireActual("@typeagent/browser-control-rpc/pdfMarkdown"),
    extractPdfMarkdown: jest.fn(),
}));
const extraction = jest.mocked(extractPdfMarkdown);

beforeAll(() => {
    Object.defineProperty(globalThis, "crypto", {
        value: webcrypto,
        configurable: true,
    });
    Object.assign(globalThis, { TextEncoder, TextDecoder });
});
beforeEach(() => {
    localStorage.clear();
    extraction.mockReset();
});
afterEach(() => jest.restoreAllMocks());

function fixture(pages = 1, blocks = 1) {
    document.body.innerHTML = `<button id="openLocalPdf"></button><button id="inspectPdf" aria-expanded="false"></button><input id="localPdfFile" type="file"><div id="viewerContainer"></div><div id="pdfInspection" hidden><span id="inspectionStatus"></span><section id="inspectionWarningsGroup" hidden><h2>Warnings</h2><pre id="inspectionWarnings"></pre></section><section data-inspection-content hidden><h2>Markdown</h2><div id="inspectionPreview"></div></section><button id="downloadPdfMarkdown"></button></div>`;
    const artifact: PdfExtractionArtifact = pdfSemanticFixture(
        "Unique page 1",
        "a".repeat(64),
    );
    artifact.pageCount = pages;
    artifact.pages = Array.from({ length: pages }, (_, index) => ({
        ...artifact.pages[0],
        page: index + 1,
    }));
    artifact.coverage = Array(pages).fill(1);
    artifact.blocks = artifact.pages.flatMap((page) =>
        Array.from({ length: blocks }, (_, order) => ({
            id: `p${page.page}-b${order}`,
            page: page.page,
            order,
            kind: "paragraph" as const,
            text: `Unique page ${page.page} block ${order}`,
            bbox: [40, 40, 200, 60] as [number, number, number, number],
        })),
    );
    artifact.semanticDocument = {
        pages: artifact.pages.map((page) => ({
            number: page.page,
            blocks: artifact.blocks
                .filter((block) => block.page === page.page)
                .map((block) => ({
                    type: "paragraph" as const,
                    text: block.text,
                })),
        })),
    };
    const getPage = jest.fn(async () => ({}));
    let input: PdfCaptureInput | null = {
        document: { numPages: pages, getPage } as unknown as PdfTextDocument,
        bytes: new Uint8Array([1]),
        title: "local.pdf",
        byteHash: artifact.byteHash,
    };
    extraction.mockImplementation(async (proxy, progress, options) => {
        for (let page = 1; page <= proxy.numPages; page++) {
            await proxy.getPage(page);
            if (options?.signal?.aborted)
                throw new DOMException("Cancelled", "AbortError");
            if (typeof progress === "function") progress(page, proxy.numPages);
        }
        return {
            artifact: JSON.parse(
                JSON.stringify(artifact),
            ) as PdfExtractionArtifact,
            markdown: renderPdfSemanticDocument(artifact.semanticDocument!, {
                math: "latex",
                images: "none",
                pageBreaks: false,
            }),
            pageCount: pages,
            emptyPages: [],
        };
    });
    const host: PdfInspectionHost = {
        getInput: () => input,
        load: jest.fn(async () => {}),
        pdfjsVersion: "5.3.31",
        getCurrentPage: () => 1,
        goToPage: jest.fn(),
        eventBus: { on: jest.fn(), off: jest.fn() },
    };
    return {
        host,
        artifact,
        getPage,
        replace: (value: PdfCaptureInput | null) => {
            input = value;
        },
    };
}

describe("semantic PDF inspection", () => {
    function controls() {
        document
            .getElementById("pdfInspection")!
            .insertAdjacentHTML(
                "beforeend",
                `<button id="extractPdf"></button><button id="pauseInspection"></button><button id="cancelInspection"></button>`,
            );
        return (id: string) => !document.getElementById(id)!.hidden;
    }

    it("shows only usable actions before, during, and after extraction", async () => {
        const { host, getPage, replace } = fixture();
        const visible = controls();
        let finish!: () => void;
        getPage.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    finish = () => resolve({});
                }),
        );
        const controller = setupPdfInspection(host);
        expect(visible("extractPdf")).toBe(true);
        expect(visible("pauseInspection")).toBe(false);
        expect(visible("cancelInspection")).toBe(false);
        expect(visible("downloadPdfMarkdown")).toBe(false);
        expect(
            document.querySelector<HTMLElement>("[data-inspection-content]")!
                .hidden,
        ).toBe(true);
        const running = controller.extract();
        expect(visible("extractPdf")).toBe(false);
        expect(visible("pauseInspection")).toBe(true);
        expect(visible("cancelInspection")).toBe(true);
        expect(visible("downloadPdfMarkdown")).toBe(false);
        finish();
        await running;
        expect(visible("extractPdf")).toBe(true);
        expect(visible("pauseInspection")).toBe(false);
        expect(visible("cancelInspection")).toBe(false);
        expect(visible("downloadPdfMarkdown")).toBe(true);
        expect(
            document.querySelector<HTMLElement>("[data-inspection-content]")!
                .hidden,
        ).toBe(false);
        replace(null);
        controller.documentChanged();
        expect(visible("downloadPdfMarkdown")).toBe(false);
        expect(
            document.querySelector<HTMLElement>("[data-inspection-content]")!
                .hidden,
        ).toBe(true);
        expect(
            (document.getElementById("extractPdf") as HTMLButtonElement)
                .disabled,
        ).toBe(true);
        controller.destroy();
    });

    it("keeps download and preview hidden after extraction with no text", async () => {
        const { host, artifact } = fixture();
        const visible = controls();
        artifact.blocks = [];
        artifact.semanticDocument = { pages: [{ number: 1, blocks: [] }] };
        const controller = setupPdfInspection(host);
        await controller.extract();
        expect(visible("extractPdf")).toBe(true);
        expect(visible("pauseInspection")).toBe(false);
        expect(visible("cancelInspection")).toBe(false);
        expect(visible("downloadPdfMarkdown")).toBe(false);
        expect(
            document.querySelector<HTMLElement>("[data-inspection-content]")!
                .hidden,
        ).toBe(true);
        controller.destroy();
    });

    it("toggles pause from the extraction toolbar and resets it on cancellation", async () => {
        const { host, getPage } = fixture(2);
        controls();
        let finish!: () => void;
        getPage.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    finish = () => resolve({});
                }),
        );
        const controller = setupPdfInspection(host);
        const running = controller.extract();
        const pause = document.getElementById("pauseInspection")!;
        pause.click();
        expect(pause.getAttribute("aria-pressed")).toBe("true");
        pause.click();
        expect(pause.getAttribute("aria-pressed")).toBe("false");
        pause.click();
        document.getElementById("cancelInspection")!.click();
        expect(pause.getAttribute("aria-pressed")).toBe("false");
        finish();
        await running;
        expect(controller.getCache()).toBeUndefined();
        controller.destroy();
    });

    it.each(["cancel", "failure"])(
        "restores idle controls after %s",
        async (outcome) => {
            const { host, getPage } = fixture();
            const visible = controls();
            let finish!: () => void;
            getPage.mockImplementationOnce(
                () =>
                    new Promise((resolve, reject) => {
                        finish = () =>
                            outcome === "failure"
                                ? reject(new Error("Extraction failed"))
                                : resolve({});
                    }),
            );
            const controller = setupPdfInspection(host);
            const running = controller.extract();
            if (outcome === "cancel") controller.cancel();
            finish();
            await running;
            expect(visible("extractPdf")).toBe(true);
            expect(visible("pauseInspection")).toBe(false);
            expect(visible("cancelInspection")).toBe(false);
            expect(visible("downloadPdfMarkdown")).toBe(false);
            controller.destroy();
        },
    );
    it("reuses only an in-memory semantic capture without persisting checkpoints", async () => {
        const { host, getPage } = fixture();
        const write = jest.spyOn(Storage.prototype, "setItem");
        const controller = setupPdfInspection(host);
        const cache = await controller.extract();
        expect(cache?.artifact.semanticDocument).toBeDefined();
        expect(getPage).toHaveBeenCalledTimes(1);
        expect(await controller.extract()).toBe(cache);
        expect(extraction).toHaveBeenCalledTimes(1);
        expect(localStorage.length).toBe(0);
        controller.destroy();
        const reopened = setupPdfInspection(host);
        expect(await reopened.extract()).not.toBe(cache);
        expect(getPage).toHaveBeenCalledTimes(2);
        expect(extraction).toHaveBeenCalledTimes(2);
        expect(write).not.toHaveBeenCalled();
        expect(localStorage.length).toBe(0);
        reopened.destroy();
    });
    it.each(["byteHash", "pdfjsVersion", "options"])(
        "invalidates semantic cache on %s changes",
        async (change) => {
            const { host } = fixture();
            const controller = setupPdfInspection(host);
            await controller.extract();
            if (change === "byteHash")
                host.getInput()!.byteHash = "b".repeat(64);
            if (change === "pdfjsVersion") host.pdfjsVersion = "different";
            await controller.extract(
                change === "options" ? { maxBlocks: 2 } : {},
            );
            expect(extraction).toHaveBeenCalledTimes(2);
            controller.destroy();
        },
    );
    it("renders selected-page semantics without transport location maps", async () => {
        const { host } = fixture(3);
        const controller = setupPdfInspection(host);
        const cache = await controller.extract();
        const preview = document.getElementById("inspectionPreview")!;
        expect(preview.textContent).toContain("Unique page 1");
        expect(preview.textContent).not.toContain("Unique page 2");
        host.getCurrentPage = () => 3;
        jest.mocked(host.eventBus.on).mock.calls[0][1]();
        expect(preview.textContent).toContain("Unique page 3");
        expect(preview.textContent).not.toContain("Unique page 1");
        expect(cache!.preparation.locationMap.entries).toEqual([]);
        controller.destroy();
    });
    it("discards stale extraction after the document changes", async () => {
        const { host, getPage, replace } = fixture();
        let finish!: () => void;
        getPage.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    finish = () => resolve({});
                }),
        );
        const controller = setupPdfInspection(host);
        const running = controller.extract();
        replace(null);
        controller.documentChanged();
        finish();
        await running;
        expect(controller.getCache()).toBeUndefined();
        expect(document.getElementById("inspectionPreview")!.textContent).toBe(
            "",
        );
        controller.destroy();
    });
    it("pauses at a live page boundary and cancels without persistent checkpoints", async () => {
        const { host, getPage } = fixture(2);
        let finish!: () => void;
        getPage.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    finish = () => resolve({});
                }),
        );
        const controller = setupPdfInspection(host);
        const running = controller.extract();
        controller.pause();
        finish();
        await Promise.resolve();
        await Promise.resolve();
        expect(getPage).toHaveBeenCalledTimes(1);
        controller.resume();
        await running;
        expect(controller.getArtifact()?.pageCount).toBe(2);
        controller.documentChanged();
        getPage.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    finish = () => resolve({});
                }),
        );
        const cancelled = controller.extract();
        controller.pause();
        finish();
        await Promise.resolve();
        await Promise.resolve();
        controller.cancel();
        await cancelled;
        expect(controller.getCache()).toBeUndefined();
        expect(localStorage.length).toBe(0);
        controller.destroy();
    });
    it("follows viewer navigation and updates selected-page warnings", async () => {
        const { host, artifact } = fixture(3);
        artifact.warnings = ["Document warning"];
        artifact.pages[1].warnings = ["Page two warning"];
        const controller = setupPdfInspection(host);
        await controller.extract();
        host.getCurrentPage = () => 2;
        const listener = jest.mocked(host.eventBus.on).mock.calls[0][1];
        listener();
        expect(
            document.getElementById("inspectionPreview")!.textContent,
        ).toContain("Unique page 2");
        expect(
            document.getElementById("inspectionPreview")!.textContent,
        ).not.toContain("Unique page 1");
        expect(document.getElementById("inspectionPage")).toBeNull();
        expect(document.getElementById("inspectionWarningsGroup")!.hidden).toBe(
            false,
        );
        expect(document.getElementById("inspectionWarnings")!.textContent).toBe(
            "Document warning\nPage two warning",
        );
        expect(host.goToPage).not.toHaveBeenCalled();
        host.getCurrentPage = () => 3;
        listener();
        expect(document.getElementById("inspectionWarnings")!.textContent).toBe(
            "Document warning",
        );
        expect(document.getElementById("inspectionWarningsGroup")!.hidden).toBe(
            false,
        );
        controller.destroy();
    });
    it("hides empty warnings and clears stale page warnings on navigation and reset", async () => {
        const { host, artifact, replace } = fixture(3);
        artifact.warnings = [];
        artifact.pages[1].warnings = ["Page two warning"];
        const controller = setupPdfInspection(host);
        const group = document.getElementById("inspectionWarningsGroup")!;
        const warnings = document.getElementById("inspectionWarnings")!;
        expect(group.hidden).toBe(true);
        expect(warnings.textContent).toBe("");
        await controller.extract();
        expect(group.hidden).toBe(true);
        const listener = jest.mocked(host.eventBus.on).mock.calls[0][1];
        host.getCurrentPage = () => 2;
        listener();
        expect(group.hidden).toBe(false);
        expect(warnings.textContent).toBe("Page two warning");
        host.getCurrentPage = () => 3;
        listener();
        expect(group.hidden).toBe(true);
        expect(warnings.textContent).toBe("");
        host.getCurrentPage = () => 2;
        listener();
        replace(null);
        controller.documentChanged();
        expect(group.hidden).toBe(true);
        expect(warnings.textContent).toBe("");
        expect(document.getElementById("inspectionPreview")!.textContent).toBe(
            "",
        );
        listener();
        expect(group.hidden).toBe(true);
        controller.destroy();
    });
    it("clears prior warnings when a replacement extraction starts", async () => {
        const { host, artifact, getPage } = fixture();
        artifact.warnings = ["Old document warning"];
        const controller = setupPdfInspection(host);
        await controller.extract();
        host.getInput()!.byteHash = "replacement";
        artifact.warnings = [];
        let finish!: () => void;
        getPage.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    finish = () => resolve({});
                }),
        );
        const running = controller.extract();
        expect(document.getElementById("inspectionWarningsGroup")!.hidden).toBe(
            true,
        );
        expect(document.getElementById("inspectionWarnings")!.textContent).toBe(
            "",
        );
        finish();
        await running;
        expect(document.getElementById("inspectionWarningsGroup")!.hidden).toBe(
            true,
        );
        controller.destroy();
    });
    it("keeps Markdown uncollapsed while allowing the flyout toolbar toggle", async () => {
        const { host } = fixture();
        const controller = setupPdfInspection(host);
        const toggle = document.getElementById("inspectPdf")!;
        const panel = document.getElementById("pdfInspection")!;
        toggle.click();
        expect(panel.hidden).toBe(false);
        expect(toggle.getAttribute("aria-expanded")).toBe("true");
        await controller.extract();
        expect(
            document.querySelectorAll(
                "#pdfInspection details, #pdfInspection summary",
            ),
        ).toHaveLength(0);
        expect(
            document.querySelector<HTMLElement>("[data-inspection-content]")!
                .hidden,
        ).toBe(false);
        toggle.click();
        expect(panel.hidden).toBe(true);
        expect(toggle.getAttribute("aria-expanded")).toBe("false");
        toggle.click();
        expect(
            document.getElementById("inspectionPreview")!.textContent,
        ).toContain("Unique page 1");
        controller.destroy();
    });
    it("keeps the preview page listener without render or scroll subscriptions", () => {
        const { host } = fixture();
        const container = document.getElementById("viewerContainer")!;
        const add = jest.spyOn(container, "addEventListener");
        const remove = jest.spyOn(container, "removeEventListener");
        const controller = setupPdfInspection(host);
        expect(
            jest.mocked(host.eventBus.on).mock.calls.map(([event]) => event),
        ).toEqual(["pagechanging"]);
        expect(add.mock.calls.map(([event]) => event)).toEqual([
            "dragover",
            "drop",
        ]);
        controller.destroy();
        expect(remove.mock.calls).toEqual(add.mock.calls);
        expect(host.eventBus.off).toHaveBeenCalledWith(
            ...jest.mocked(host.eventBus.on).mock.calls[0],
        );
    });
    it("renders semantics without mounting block buttons and removes listeners", async () => {
        const { host } = fixture(2, 120);
        const controller = setupPdfInspection(host);
        await controller.extract();
        expect(controller.getArtifact()!.blocks).toHaveLength(240);
        expect(
            document.querySelectorAll(
                ".inspection-block, .pdf-inspection-box, .pdf-inspection-overlay",
            ),
        ).toHaveLength(0);
        expect(
            document.getElementById("inspectionPreview")!.textContent,
        ).toContain("Unique page 1 block 119");
        controller.destroy();
        expect(host.eventBus.off).toHaveBeenCalledTimes(1);
        document
            .getElementById("viewerContainer")!
            .dispatchEvent(new Event("drop", { cancelable: true }));
        expect(host.load).not.toHaveBeenCalled();
    });
    it("exports canonical Markdown with sanitized previews", async () => {
        const { host } = fixture();
        const controller = setupPdfInspection(host);
        const cache = (await controller.extract())!;
        expect(document.getElementById("inspectionPreview")!.innerHTML).toBe(
            sanitizedMarkdownPreview(cache.preparation.markdown),
        );
        expect(
            sanitizedMarkdownPreview("<img src=x onerror=alert(1)>"),
        ).not.toContain("<img");
        const blobs: Blob[] = [];
        Object.defineProperty(URL, "createObjectURL", {
            configurable: true,
            value: jest.fn((blob: Blob) => {
                blobs.push(blob);
                return "blob:download";
            }),
        });
        Object.defineProperty(URL, "revokeObjectURL", {
            configurable: true,
            value: jest.fn(),
        });
        jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
            () => {},
        );
        document.getElementById("downloadPdfMarkdown")!.click();
        const read = (blob: Blob) =>
            new Promise<string>((resolve) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result));
                reader.readAsText(blob);
            });
        expect(await read(blobs[0])).toBe(cache.preparation.markdown);
        expect(blobs).toHaveLength(1);
        controller.destroy();
    });
    it("preflights size and preserves original PDF bytes", async () => {
        const load = jest.fn(async () => {});
        const read = jest.fn();
        await expect(
            openLocalPdf(
                {
                    size: MAX_LOCAL_PDF_BYTES + 1,
                    arrayBuffer: read,
                } as unknown as File,
                load,
            ),
        ).rejects.toThrow("50 MB");
        expect(read).not.toHaveBeenCalled();
        const data = new TextEncoder().encode("%PDF-test").buffer;
        await openLocalPdf(
            {
                size: data.byteLength,
                name: "file.pdf",
                arrayBuffer: async () => data,
            } as File,
            load,
        );
        expect(load).toHaveBeenCalledWith(data, "file.pdf");
        const retained = await retainPdfBytes(data);
        new Uint8Array(data).fill(0);
        expect(new TextDecoder().decode(retained.bytes)).toBe("%PDF-test");
    });
});
