// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as runtime from "../src/index.js";
import * as arrays from "../src/arrayAsync.js";
import * as collections from "../src/lib/index.js";
import * as promptLib from "../src/promptLib.js";
import { similarity } from "../src/vector/embeddings.js";
import { generateTextEmbeddings } from "../src/vector/vectorIndex.js";
import { createEmbeddingFolder } from "../src/storage/embeddingFS.js";
import { createObjectPage } from "../src/storage/objectPage.js";
import { createWorkQueueFolder } from "../src/storage/workQueue.js";

test("public barrel retains the direct module exports", () => {
    expect(runtime.asyncArray.mapAsync).toBe(arrays.mapAsync);
    expect(runtime.collections.createLazy).toBe(collections.createLazy);
    expect(runtime.promptLib.dateTimeRangePrompt).toBe(
        promptLib.dateTimeRangePrompt,
    );
    expect(runtime.similarity).toBe(similarity);
    expect(runtime.generateTextEmbeddings).toBe(generateTextEmbeddings);
    expect(runtime.createEmbeddingFolder).toBe(createEmbeddingFolder);
    expect(runtime.createObjectPage).toBe(createObjectPage);
    expect(runtime.createWorkQueueFolder).toBe(createWorkQueueFolder);
});
