// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    createMemoryClient,
    storyRecords,
} from "../src/memory/memoryClient.js";

// Adding the same story twice stores each record once, with its tags.
test("KnowPro client stores story records once", async () => {
    const endpointKey = "AZURE_OPENAI_ENDPOINT_GPT_6_LUNA_EASTUS";
    const apiKey = "AZURE_OPENAI_API_KEY_GPT_6_LUNA_EASTUS";
    const savedEndpoint = process.env[endpointKey];
    const savedApiKey = process.env[apiKey];
    const savedEmbeddingProvider = process.env.TYPEAGENT_EMBEDDING_PROVIDER;
    process.env[endpointKey] =
        "https://story-memory-test.invalid/chat/completions";
    process.env[apiKey] = "test-key";
    process.env.TYPEAGENT_EMBEDDING_PROVIDER = "none";
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "story-memory-"));
    try {
        const records = storyRecords("abc123", {
            schemaVersion: 1,
            title: "Story",
            description: "Description",
            sessions: [
                {
                    sessionId: "s1",
                    summary: [{ id: "1", text: "First change", memoryIds: [] }],
                    metadata: { clientName: "test", models: ["model-1"] },
                },
            ],
        });
        await (
            await createMemoryClient({ kind: "knowpro", directory })
        ).add(records);
        await (
            await createMemoryClient({ kind: "knowpro", directory })
        ).add(records);

        const file = path.join(directory, "commit-stories_data.json");
        const stored = JSON.parse(fs.readFileSync(file, "utf8"));
        expect(stored.messages).toHaveLength(1);
        expect(stored.messages[0].tags).toEqual([
            "id:abc123/s1/1",
            "commit:abc123",
            "session:s1",
            "model:model-1",
        ]);
    } finally {
        if (savedEndpoint === undefined) delete process.env[endpointKey];
        else process.env[endpointKey] = savedEndpoint;
        if (savedApiKey === undefined) delete process.env[apiKey];
        else process.env[apiKey] = savedApiKey;
        if (savedEmbeddingProvider === undefined)
            delete process.env.TYPEAGENT_EMBEDDING_PROVIDER;
        else process.env.TYPEAGENT_EMBEDDING_PROVIDER = savedEmbeddingProvider;
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
