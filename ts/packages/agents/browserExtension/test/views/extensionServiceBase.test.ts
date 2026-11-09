// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ProgressCallback } from "../../src/extension/interfaces/websiteImport.types";
import type { KnowledgeProgressCallback } from "../../src/extension/interfaces/knowledgeExtraction.types";
import {
    ExtensionServiceBase,
    type SearchResult,
} from "../../src/extension/views/extensionServiceBase";

class TestExtensionService extends ExtensionServiceBase {
    public readonly messages: unknown[] = [];

    protected async sendMessage<T>(message: unknown): Promise<T> {
        this.messages.push(message);
        return { results: {} as SearchResult } as T;
    }

    protected onImportProgressImpl(
        _importId: string,
        _callback: ProgressCallback,
    ): void {}

    protected onExtractionProgressImpl(
        _extractionId: string,
        _callback: KnowledgeProgressCallback,
    ): void {}
}

describe("ExtensionServiceBase search filters", () => {
    test("forwards structured filters using backend source names", async () => {
        const service = new TestExtensionService();

        await service.searchWebMemories("design", {
            domain: "example.test",
            sourceType: "bookmarks",
            dateFrom: "2026-01-01T00:00:00.000Z",
            dateTo: "2026-03-01T00:00:00.000Z",
        });

        expect(service.messages).toEqual([
            expect.objectContaining({
                type: "searchWebMemories",
                parameters: expect.objectContaining({
                    query: "design",
                    domain: "example.test",
                    source: "bookmark",
                    dateFrom: "2026-01-01T00:00:00.000Z",
                    dateTo: "2026-03-01T00:00:00.000Z",
                }),
            }),
        ]);
    });
});
