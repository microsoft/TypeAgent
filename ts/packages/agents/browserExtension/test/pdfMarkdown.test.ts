// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { extractPdfMarkdown } from "@typeagent/browser-control-rpc/pdfMarkdown";
import type { PdfTextDocument } from "@typeagent/browser-control-rpc/pdfMarkdown";

describe("PDF Markdown extraction", () => {
    it.each([0, -1, NaN, Infinity, 1.5])(
        "rejects invalid page count %s before loading",
        async (numPages) => {
            const getPage = jest.fn();
            await expect(
                extractPdfMarkdown({
                    numPages,
                    getPage,
                } as unknown as PdfTextDocument),
            ).rejects.toThrow("pageCount");
            expect(getPage).not.toHaveBeenCalled();
        },
    );
    it("rejects excess pages and cancellation before operator loading", async () => {
        const getPage = jest.fn();
        const document = {
            numPages: 10,
            getPage,
        } as unknown as PdfTextDocument;
        await expect(
            extractPdfMarkdown(document, { maxPages: 2 }),
        ).rejects.toThrow("maxPages");
        await expect(
            extractPdfMarkdown(document, { signal: AbortSignal.abort() }),
        ).rejects.toThrow("cancelled");
        expect(getPage).not.toHaveBeenCalled();
    });
});
