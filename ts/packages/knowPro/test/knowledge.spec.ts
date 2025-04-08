// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describeIf, hasTestKeys } from "test-lib";
import { loadTunsFromFile } from "./testMessage.js";
import { extractKnowledgeForTextBatchQ } from "../src/knowledge.js";
import { getTestChatModel } from "./testCommon.js";
import { createKnowledgeExtractor } from "../src/conversation.js";

describeIf(
    "knowledge.online",
    () => hasTestKeys(),
    () => {
        const testTimeout = 5 * 60 * 1000;
        const extractor = createKnowledgeExtractor(getTestChatModel());
        test(
            "extractQ",
            async () => {
                const turns = loadTunsFromFile("./test/data/dialog.json");
                const textBatch = turns.map((t) => t.text);
                const concurrency = 3;
                const results = await extractKnowledgeForTextBatchQ(
                    extractor,
                    textBatch,
                    concurrency,
                );
                expect(results).toHaveLength(textBatch.length);
                for (const result of results) {
                    expect(result.success);
                    if (result.success) {
                        expect(result.data).toBeDefined();
                    }
                }
            },
            testTimeout,
        );
    },
);
