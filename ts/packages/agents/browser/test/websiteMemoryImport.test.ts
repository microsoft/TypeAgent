// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

const importWebsites = jest.fn();
const fetchHtml = jest.fn();

jest.mock("@typeagent/website-memory", () => ({
    ContentExtractor: class {},
    getDefaultBrowserPaths: () => ({
        chrome: {
            bookmarks: "chrome-bookmarks",
            history: "chrome-history",
        },
        edge: {
            bookmarks: "edge-bookmarks",
            history: "edge-history",
        },
    }),
    importWebsites,
    HtmlFetcher: jest.fn().mockImplementation(() => ({ fetchHtml })),
}));
jest.mock("../src/agent/durableWebSearch.mjs", () => ({
    searchWebMemories: jest.fn(),
}));

import type { SessionContext } from "@typeagent/agent-sdk";
import type { BrowserActionContext } from "../src/agent/browserActions.mjs";
import { importProgressEvents } from "../src/agent/import/importProgressEvents.mjs";
import { ImportStateManager } from "../src/agent/import/importStateManager.mjs";
import { importWebsiteDataFromSession } from "../src/agent/websiteMemory.mjs";

describe("non-basic website import", () => {
    afterEach(() => {
        jest.restoreAllMocks();
        jest.clearAllMocks();
        importProgressEvents.removeAllListeners();
    });

    test("submits one normalized document and forwards chunk policy", async () => {
        const site = {
            metadata: {
                url: "https://example.test/article",
                title: "Article",
                websiteSource: "history",
                domain: "example.test",
            },
            textChunks: ["metadata description"],
            tags: ["test"],
        };
        importWebsites.mockResolvedValue([site]);
        fetchHtml.mockResolvedValue({
            html: "\r\n<html>\r\n<body>Original HTML</body>\r\n</html>\r\n",
        });
        jest.spyOn(ImportStateManager, "saveImportState").mockResolvedValue();
        jest.spyOn(ImportStateManager, "deleteImportState").mockResolvedValue();

        const ingest = jest.fn(
            async (
                _document: unknown,
                _mode: unknown,
                options: {
                    onProgress?: (progress: {
                        completed: number;
                        total: number;
                        stage: string;
                    }) => void;
                },
            ) => {
                options.onProgress?.({
                    completed: 1,
                    total: 1,
                    stage: "complete",
                });
                return {
                    source: {},
                    entities: [],
                    topics: [],
                    relationships: [],
                };
            },
        );
        const context = {
            agentContext: {
                browserMemoryService: { ingest },
            },
        } as unknown as SessionContext<BrowserActionContext>;
        const progress: string[] = [];
        importProgressEvents.onProgressById("import-1", (event) =>
            progress.push(event.phase),
        );

        const result = await importWebsiteDataFromSession(
            {
                source: "chrome",
                type: "history",
                mode: "content",
                importId: "import-1",
                maxCharsPerChunk: 321,
            },
            context,
        );

        expect(result.success).toBe(true);
        expect(importWebsites).toHaveBeenCalledWith(
            "chrome",
            "history",
            "chrome-history",
            expect.objectContaining({ mode: "basic" }),
            expect.any(Function),
        );
        expect(fetchHtml).toHaveBeenCalledWith(
            "https://example.test/article",
            10000,
        );
        expect(ingest).toHaveBeenCalledTimes(1);
        expect(ingest).toHaveBeenCalledWith(
            {
                url: "https://example.test/article",
                title: "Article",
                markdown: "Original HTML",
                source: "history",
                domain: "example.test",
                tags: ["test"],
            },
            "content",
            expect.objectContaining({
                maxCharsPerChunk: 321,
                onProgress: expect.any(Function),
            }),
        );
        expect(progress).toContain("persisting");
        expect(progress.at(-1)).toBe("complete");
    });
});
