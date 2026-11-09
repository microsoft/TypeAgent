// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { TextEncoder, TextDecoder } from "node:util";
import {
    MAX_LOCAL_PDF_BYTES,
    openLocalPdf,
    retainPdfBytes,
    setupPdfInspection,
    sanitizedMarkdownPreview,
    type PdfCaptureInput,
    type PdfInspectionHost,
} from "../../../browser/src/views/client/pdf/core/pdfInspection";
import {
    extractPdfMarkdown,
    renderPdfSemanticDocument,
    serializePdfArtifact,
    type PdfExtractionArtifact,
    type PdfExtractionBlock,
    type PdfExtractionOptions,
    type PdfTextDocument,
} from "@typeagent/browser-control-rpc/pdfMarkdown";
import { pdfSemanticFixture } from "../pdfSemanticFixture";

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

function fixture() {
    extraction.mockImplementation(
        async (
            proxy: PdfTextDocument,
            progress:
                | ((completed: number, total: number) => void)
                | PdfExtractionOptions
                | undefined,
            options?: PdfExtractionOptions,
        ) => {
            const artifact: PdfExtractionArtifact = pdfSemanticFixture(
                "",
                "hash",
            );
            artifact.pageCount = proxy.numPages;
            artifact.pages = [];
            artifact.blocks = [];
            artifact.coverage = Array(proxy.numPages).fill(1);
            artifact.semanticDocument = { pages: [] };
            for (let page = 1; page <= proxy.numPages; page++) {
                const source = await proxy.getPage(page);
                if (options?.signal?.aborted)
                    throw new DOMException("Cancelled", "AbortError");
                const content = await source.getTextContent();
                const blocks: PdfExtractionBlock[] = content.items.flatMap(
                    (item: { str?: string }, order: number) =>
                        typeof item.str === "string"
                            ? [
                                  {
                                      id: `p${page}-b${order}`,
                                      page,
                                      order,
                                      kind: "paragraph" as const,
                                      text: item.str,
                                      bbox: [40, 40, 200, 60] as [
                                          number,
                                          number,
                                          number,
                                          number,
                                      ],
                                  },
                              ]
                            : [],
                );
                artifact.pages.push({
                    page,
                    width: 612,
                    height: 792,
                    rotation: 0,
                    warnings: [],
                });
                artifact.blocks.push(...blocks);
                artifact.semanticDocument.pages.push({
                    number: page,
                    blocks: blocks.map((block: PdfExtractionBlock) => ({
                        type: "paragraph" as const,
                        text: block.text,
                    })),
                });
                if (typeof progress === "function")
                    progress(page, proxy.numPages);
            }
            return {
                artifact,
                markdown: renderPdfSemanticDocument(artifact.semanticDocument, {
                    math: "latex",
                    images: "none",
                    pageBreaks: false,
                }),
                pageCount: proxy.numPages,
                emptyPages: [],
            };
        },
    );
    document.body.innerHTML = `<button id="openLocalPdf"></button><input id="localPdfFile" type="file"><div id="viewerContainer"></div><div id="pdfInspection"><span id="inspectionStatus"></span><section id="inspectionWarningsGroup" hidden><h2>Warnings</h2><pre id="inspectionWarnings"></pre></section><section data-inspection-content hidden><h2>Markdown</h2><div id="inspectionPreview"></div></section><button id="downloadPdfMarkdown"></button></div>`;
    let input: PdfCaptureInput | null = {
        document: {
            numPages: 1,
            getPage: async () => ({
                getTextContent: async () => ({
                    items: [{ str: "<script>alert(1)</script> text" }],
                }),
            }),
        },
        bytes: new Uint8Array([1]),
        title: "local.pdf",
        byteHash: "hash",
    };
    const host: PdfInspectionHost = {
        getInput: () => input,
        load: jest.fn(async () => {}),
        pdfjsVersion: "test",
        getCurrentPage: () => 1,
        goToPage: jest.fn(),
        eventBus: { on: jest.fn(), off: jest.fn() },
    };
    return {
        host,
        replace: (value: PdfCaptureInput | null) => {
            input = value;
        },
    };
}

describe("local PDF inspection", () => {
    beforeEach(() => localStorage.clear());
    afterEach(() => jest.restoreAllMocks());

    it("keeps real proxy pages without persisting checkpoints", async () => {
        const { host } = fixture();
        const write = jest.spyOn(Storage.prototype, "setItem");
        const getPage = jest.spyOn(host.getInput()!.document, "getPage");
        const controller = setupPdfInspection(host);
        const cache = await controller.extract();
        expect(getPage).toHaveBeenCalledTimes(1);
        expect(cache!.artifact.semanticDocument).toBeDefined();
        expect(localStorage.length).toBe(0);
        expect(write).not.toHaveBeenCalled();
        controller.destroy();
    });

    it("rereads live pages when the inspection controller is recreated", async () => {
        const { host } = fixture();
        const getPage = jest.spyOn(host.getInput()!.document, "getPage");
        const first = setupPdfInspection(host);
        const original = await first.extract();
        first.destroy();
        const second = setupPdfInspection(host);
        const restored = await second.extract();
        expect(getPage).toHaveBeenCalledTimes(2);
        expect(restored).not.toBe(original);
        expect(restored!.preparation).toEqual(original!.preparation);
        expect(localStorage.length).toBe(0);
        second.destroy();
    });

    it.each(["byteHash", "pdfjsVersion", "options"])(
        "invalidates the in-memory cache on %s changes",
        async (change) => {
            const { host } = fixture();
            const getPage = jest.spyOn(host.getInput()!.document, "getPage");
            const controller = setupPdfInspection(host);
            await controller.extract();
            getPage.mockClear();
            if (change === "byteHash") host.getInput()!.byteHash = "different";
            if (change === "pdfjsVersion") host.pdfjsVersion = "different";
            await controller.extract(
                change === "options" ? { maxBlocks: 2 } : {},
            );
            expect(getPage).toHaveBeenCalledTimes(1);
            expect(localStorage.length).toBe(0);
            controller.destroy();
        },
    );

    it("rereads all pages after cancelling an interrupted extraction", async () => {
        const { host } = fixture();
        let secondPage!: () => void;
        const getTextContent = jest.fn(async () => ({
            items: [{ str: "Unique first" }],
        }));
        const getPage = jest.fn(async (page: number) => {
            if (page === 2)
                await new Promise<void>((resolve) => {
                    secondPage = resolve;
                });
            return { getTextContent };
        });
        host.getInput()!.document = { numPages: 2, getPage };
        const first = setupPdfInspection(host);
        const running = first.extract();
        while (!secondPage)
            await new Promise((resolve) => setTimeout(resolve, 5));
        expect(localStorage.length).toBe(0);
        first.cancel();
        secondPage();
        await running;
        expect(localStorage.length).toBe(0);
        first.destroy();
        getPage.mockClear();
        getPage.mockImplementation(async () => ({ getTextContent }));
        const next = setupPdfInspection(host);
        expect(await next.extract()).toBeDefined();
        expect(getPage.mock.calls.map(([page]) => page)).toEqual([1, 2]);
        expect(localStorage.length).toBe(0);
        next.destroy();
    });

    it("restarts a cancelled 300-page document without saved page checkpoints", async () => {
        const { host } = fixture();
        let reachedBoundary!: () => void;
        let releaseBoundary!: () => void;
        const boundary = new Promise<void>((resolve) => {
            reachedBoundary = resolve;
        });
        const blocked = new Promise<void>((resolve) => {
            releaseBoundary = resolve;
        });
        const getPage = jest.fn(async (page: number) => {
            if (page === 11) {
                reachedBoundary();
                await blocked;
            }
            return {
                getTextContent: async () => ({
                    items: [{ str: `Unique page ${page}`, hasEOL: true }],
                }),
            };
        });
        host.getInput()!.document = { numPages: 300, getPage };
        const first = setupPdfInspection(host);
        const running = first.extract();
        await boundary;
        expect(localStorage.length).toBe(0);
        first.cancel();
        releaseBoundary();
        await running;
        first.destroy();
        expect(localStorage.length).toBe(0);
        getPage.mockClear();
        const restored = setupPdfInspection(host);
        const result = await restored.extract();
        expect(getPage.mock.calls.map(([page]) => page)).toEqual(
            Array.from({ length: 300 }, (_, index) => index + 1),
        );
        expect(localStorage.length).toBe(0);
        expect(result!.preparation.locationMap.entries).toHaveLength(0);
        expect(result!.preparation.markdown).toContain("Unique page 300");
        restored.destroy();
    }, 60000);

    it("does not access checkpoint storage even when writes would fail", async () => {
        const { host } = fixture();
        const write = jest
            .spyOn(Storage.prototype, "setItem")
            .mockImplementation(() => {
                throw new DOMException("Full", "QuotaExceededError");
            });
        const controller = setupPdfInspection(host);
        expect(await controller.extract()).toBeDefined();
        expect(write).not.toHaveBeenCalled();
        expect(document.getElementById("inspectionStatus")!.textContent).toBe(
            "Complete: 1 pages",
        );
        expect(localStorage.length).toBe(0);
        write.mockRestore();
        controller.destroy();
    });

    it("renders only selected-page semantic Markdown without service location maps", async () => {
        const { host } = fixture();
        host.getInput()!.document = {
            numPages: 3,
            getPage: async (page: number) => ({
                getTextContent: async () => ({
                    items: [{ str: `Unique page ${page}`, hasEOL: true }],
                }),
            }),
        };
        const controller = setupPdfInspection(host);
        const cache = await controller.extract();
        const preview = document.getElementById("inspectionPreview")!;
        expect(preview.textContent).toContain("Unique page 1");
        expect(preview.textContent).not.toContain("Unique page 2");
        host.getCurrentPage = () => 3;
        jest.mocked(host.eventBus.on).mock.calls[0][1]();
        expect(preview.textContent).toContain("Unique page 3");
        expect(preview.textContent).not.toContain("Unique page 1");
        expect(document.getElementById("inspectionPage")).toBeNull();
        expect(host.goToPage).not.toHaveBeenCalled();
        expect(cache!.preparation.locationMap.entries).toHaveLength(0);
        expect(cache!.preparation.markdown).toContain("Unique page 2");
        controller.destroy();
    });

    it("keeps the actual viewer HTML preview-only with extraction controls", async () => {
        const { host } = fixture();
        const html = readFileSync(
            resolve(
                __dirname,
                "../../../browser/src/views/client/pdf/index.html",
            ),
            "utf8",
        );
        document.body.innerHTML = new DOMParser().parseFromString(
            html,
            "text/html",
        ).body.innerHTML;
        for (const id of [
            "inspectionBlocks",
            "inspectionBlocksPrevious",
            "inspectionBlockRange",
            "inspectionBlocksNext",
            "inspectionOverlay",
            "cropInspectionBlock",
            "inspectionCropZoom",
            "inspectionCrop",
            "inspectionPage",
        ])
            expect(document.getElementById(id)).toBeNull();
        for (const id of [
            "extractPdf",
            "pauseInspection",
            "cancelInspection",
            "downloadPdfMarkdown",
            "inspectionPreview",
        ])
            expect(document.getElementById(id)).not.toBeNull();
        const controller = setupPdfInspection(host);
        const warningsGroup = document.getElementById(
            "inspectionWarningsGroup",
        )!;
        expect(warningsGroup.hidden).toBe(true);
        expect(
            document.querySelectorAll(
                "#pdfInspection details, #pdfInspection summary",
            ),
        ).toHaveLength(0);
        await controller.extract();
        expect(
            document.querySelector<HTMLElement>("[data-inspection-content]")!
                .hidden,
        ).toBe(false);
        expect(warningsGroup.hidden).toBe(true);
        expect(
            document.getElementById("inspectionPreview")!.textContent,
        ).toContain("text");
        expect(
            document.querySelectorAll(
                ".inspection-block, .pdf-inspection-box, .pdf-inspection-overlay",
            ),
        ).toHaveLength(0);
        controller.destroy();
    });

    it("preflights size without reading and opens original bytes", async () => {
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
        expect(retained.byteHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("routes picker and drop through the local loader", async () => {
        const { host } = fixture();
        const controller = setupPdfInspection(host);
        const file = {
            size: 9,
            name: "drop.pdf",
            arrayBuffer: async () =>
                new TextEncoder().encode("%PDF-test").buffer,
        } as File;
        const picker = document.getElementById("localPdfFile")!;
        Object.defineProperty(picker, "files", { value: [file] });
        picker.dispatchEvent(new Event("change"));
        await Promise.resolve();
        await Promise.resolve();
        const drop = new Event("drop", { cancelable: true });
        Object.defineProperty(drop, "dataTransfer", {
            value: { files: [file] },
        });
        document.getElementById("viewerContainer")!.dispatchEvent(drop);
        await Promise.resolve();
        await Promise.resolve();
        expect(host.load).toHaveBeenCalledTimes(2);
        expect(drop.defaultPrevented).toBe(true);
        controller.destroy();
    });

    it("discards stale extraction and clears retained cache", async () => {
        const { host, replace } = fixture();
        let finish!: () => void;
        host.getInput()!.document.getPage = async () => {
            await new Promise<void>((resolve) => {
                finish = resolve;
            });
            return {
                getTextContent: async () => ({ items: [{ str: "old" }] }),
            };
        };
        const controller = setupPdfInspection(host);
        const running = controller.extract();
        await Promise.resolve();
        await Promise.resolve();
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

    it("uses prepared Markdown for preview and exports and the shared JSON serializer", async () => {
        const { host } = fixture();
        const controller = setupPdfInspection(host);
        const cache = await controller.extract();
        expect(cache).toBeDefined();
        expect(document.getElementById("inspectionPreview")!.innerHTML).toBe(
            sanitizedMarkdownPreview(cache!.preparation.markdown),
        );
        expect(sanitizedMarkdownPreview("# Heading")).toContain(
            "<h1>Heading</h1>",
        );
        expect(document.querySelector("#inspectionPreview script")).toBeNull();
        expect(
            sanitizedMarkdownPreview("<img src=x onerror=alert(1)>"),
        ).not.toContain("<img");
        expect(JSON.parse(serializePdfArtifact(cache!.artifact)).byteHash).toBe(
            "hash",
        );
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
        const click = jest
            .spyOn(HTMLAnchorElement.prototype, "click")
            .mockImplementation(() => {});
        document.getElementById("downloadPdfMarkdown")!.click();
        const readBlob = (blob: Blob) =>
            new Promise<string>((resolve) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result));
                reader.readAsText(blob);
            });
        expect(await readBlob(blobs[0])).toBe(cache!.preparation.markdown);
        expect(blobs).toHaveLength(1);
        click.mockRestore();
        expect(await controller.extract()).toBe(cache);
        controller.destroy();
    });

    it("pauses at a page boundary without restarting and cancels a paused job", async () => {
        const { host } = fixture();
        let firstPage!: () => void;
        const getPage = jest.fn(async (page: number) => {
            if (page === 1)
                await new Promise<void>((resolve) => {
                    firstPage = resolve;
                });
            return {
                getTextContent: async () => ({
                    items: [{ str: `Page ${page}` }],
                }),
            };
        });
        host.getInput()!.document = { numPages: 2, getPage };
        const controller = setupPdfInspection(host);
        const running = controller.extract();
        await Promise.resolve();
        await Promise.resolve();
        controller.pause();
        firstPage();
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(getPage).toHaveBeenCalledTimes(1);
        controller.resume();
        await running;
        expect(getPage.mock.calls.map(([page]) => page)).toEqual([1, 2]);
        expect(controller.getArtifact()?.pageCount).toBe(2);
        controller.documentChanged();
        const cancelled = controller.extract();
        await Promise.resolve();
        await Promise.resolve();
        controller.pause();
        firstPage();
        await new Promise((resolve) => setTimeout(resolve, 20));
        controller.cancel();
        await cancelled;
        expect(controller.getArtifact()).toBeUndefined();
        controller.destroy();
    });

    it("renders preview without synthetic block buttons and removes listeners", async () => {
        const { host } = fixture();
        host.getInput()!.document = {
            numPages: 2,
            getPage: async () => ({
                getTextContent: async () => ({
                    items: Array.from({ length: 120 }, (_, index) => ({
                        str: `Block ${index}`,
                        hasEOL: true,
                    })),
                }),
            }),
        };
        const controller = setupPdfInspection(host);
        await controller.extract();
        expect(controller.getArtifact()?.blocks.length).toBeGreaterThan(50);
        expect(
            document.querySelectorAll(
                ".inspection-block, .pdf-inspection-box, .pdf-inspection-overlay",
            ),
        ).toHaveLength(0);
        expect(
            document.getElementById("inspectionPreview")!.textContent,
        ).toContain("Block 119");
        expect(host.eventBus.on).toHaveBeenCalledTimes(1);
        const listener = jest.mocked(host.eventBus.on).mock.calls[0][1];
        controller.destroy();
        expect(host.eventBus.off).toHaveBeenCalledTimes(1);
        expect(host.eventBus.off).toHaveBeenCalledWith(
            "pagechanging",
            listener,
        );
        expect(document.getElementById("inspectionPage")).toBeNull();
        expect(host.goToPage).not.toHaveBeenCalled();
        document
            .getElementById("viewerContainer")!
            .dispatchEvent(new Event("drop", { cancelable: true }));
        expect(host.load).not.toHaveBeenCalled();
    });
});
