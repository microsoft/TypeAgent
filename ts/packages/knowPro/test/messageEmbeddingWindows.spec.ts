// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { MessageTextIndex } from "../src/messageIndex.js";
import type { IMessage } from "../src/interfaces.js";
import type { TextEmbeddingChunk } from "../src/textLocationIndex.js";

const messages: IMessage[] = [
    { textChunks: ["abcdef", "gh"], tags: [], getKnowledge: () => undefined },
    { textChunks: ["ijkl"], tags: [], getKnowledge: () => undefined },
];
const splitText = (text: string): TextEmbeddingChunk[] =>
    Array.from({ length: Math.ceil(text.length / 2) }, (_, i) => ({
        text: text.slice(i * 2, i * 2 + 2),
        start: i * 2,
        end: Math.min(text.length, i * 2 + 2),
    }));

function fixture() {
    let failure: "result" | "throw" | undefined;
    const index = new MessageTextIndex({
        splitText,
        embeddingIndexSettings: {
            embeddingSize: 2,
            batchSize: 1,
            minScore: 0,
            embeddingModel: {
                maxBatchSize: 1,
                generateEmbedding: async () => ({
                    success: true,
                    data: [1, 0],
                }),
            },
        },
    });
    const add = index.textLocationIndex.addTextLocations.bind(
        index.textLocationIndex,
    );
    index.textLocationIndex.addTextLocations = async (
        values,
        handler,
        batchSize,
    ) => {
        if (!failure) return add(values, handler, batchSize);
        await add(values.slice(0, 1), handler, batchSize);
        if (failure === "throw") throw new Error("controlled throw");
        return { numberCompleted: 1, error: "controlled failure" };
    };
    return {
        index,
        fail: (value: typeof failure) => {
            failure = value;
        },
    };
}

test("multiple windows retain original message/chunk locations, deduplicate ranking and survive restart/append", async () => {
    const { index } = fixture();
    await index.addMessages(messages);
    const data = index.serialize();
    expect(index.size).toBe(2);
    expect(data.indexData!.textLocations).toHaveLength(6);
    expect(data.indexData!.textLocations.slice(0, 3)).toEqual(
        [0, 2, 4].map((start) => ({
            messageOrdinal: 0,
            chunkOrdinal: 0,
            textRange: { start, end: start + 2 },
        })),
    );
    expect(index.lookupByEmbedding(new Float32Array([1, 0]), 2)).toHaveLength(
        2,
    );
    expect(
        index.lookupInSubsetByEmbedding(new Float32Array([1, 0]), [1], 2),
    ).toEqual([{ messageOrdinal: 1, score: 1 }]);
    const restored = fixture().index;
    restored.deserialize(data);
    await restored.addMessages([
        { textChunks: ["mn"], tags: [], getKnowledge: () => undefined },
    ]);
    expect(restored.size).toBe(3);
    expect(
        restored.serialize().indexData!.textLocations.at(-1)!.messageOrdinal,
    ).toBe(2);
});

test.each(["result", "throw", "cancel"] as const)(
    "a %s during a window batch rolls back all new vectors before retry",
    async (failure) => {
        const { index, fail } = fixture();
        if (failure !== "cancel") fail(failure);
        let callbacks = 0;
        const operation = index.addMessages(
            messages,
            failure === "cancel"
                ? {
                      onEmbeddingsCreated: () => ++callbacks < 2,
                  }
                : undefined,
        );
        if (failure === "throw") await expect(operation).rejects.toThrow();
        else expect((await operation).numberCompleted).toBe(0);
        expect(index.size).toBe(0);
        expect(index.serialize().indexData!.textLocations).toEqual([]);
        fail(undefined);
        await index.addMessages(messages);
        expect(index.size).toBe(2);
        expect(index.serialize().indexData!.textLocations).toHaveLength(6);
    },
);

test("incomplete splitter output fails before issuing embedding requests", async () => {
    const { index } = fixture();
    index.settings.splitText = (text) => [
        { text: text.slice(1), start: 1, end: text.length },
    ];
    await expect(index.addMessages(messages)).rejects.toThrow(
        "Invalid message embedding window",
    );
    expect(index.serialize().indexData!.textLocations).toEqual([]);
});
