// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { BatchProcessor } from "../src/extraction/batchProcessor.js";

describe("BatchProcessor", () => {
    test("awaits per-item completion while other items are still extracting", async () => {
        let releaseSecond: () => void = () => {};
        const secondBlocked = new Promise<void>((resolve) => {
            releaseSecond = resolve;
        });
        let firstCompleted: () => void = () => {};
        const firstCompletion = new Promise<void>((resolve) => {
            firstCompleted = resolve;
        });
        const extractor = {
            isConfiguredForMode: () => true,
            extract: async (item: { url: string }) => {
                if (item.url === "second") {
                    await secondBlocked;
                }
                return { pageContent: { mainContent: item.url } };
            },
        };
        const completed: number[] = [];
        const processor = new BatchProcessor(extractor as any);

        const processing = processor.processBatch(
            [{ url: "first" }, { url: "second" }] as any,
            "basic",
            {
                itemCompleteCallback: async (_result, index) => {
                    completed.push(index);
                    if (index === 0) {
                        firstCompleted();
                    }
                },
            },
        );

        await firstCompletion;
        expect(completed).toEqual([0]);

        releaseSecond();
        await processing;
        expect(completed).toEqual([0, 1]);
    });
});
