// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    indexesOfNearest,
    NormalizedEmbedding,
    SimilarityType,
    generateEmbedding,
    ScoredItem,
    NameValue,
} from "typeagent";
import { TextEmbeddingModel, openai } from "aiclient";
import registerDebug from "debug";
const debugError = registerDebug("typeagent:desktop:error");

export interface ProgramNameIndex {
    addOrUpdate(programName: string): Promise<void>;
    remove(tabId: number): Promise<void>;
    reset(): Promise<void>;
    search(
        query: string | NormalizedEmbedding,
        maxMatches: number,
    ): Promise<ScoredItem<NameValue<string>>[]>;

    toJSON(): Record<string, string>;
}

export function loadProgramNameIndex(
    vals: Record<string, string | undefined>,
    json?: Record<string, string>,
) {
    const initialEmbeddings = json
        ? Object.fromEntries(
              Object.entries(json).map(([key, value]) => [
                  key,
                  new Float32Array(
                      Uint8Array.from(
                          [...atob(value)].map((c) => c.charCodeAt(0)),
                      ).buffer,
                  ),
              ]),
          )
        : undefined;

    return createProgramNameIndex(vals, initialEmbeddings);
}

export function createProgramNameIndex(
    vals: Record<string, string | undefined>,
    initialEmbeddings?: Record<string, Float32Array>,
) {
    let programEmbeddings: Record<string, NormalizedEmbedding> =
        initialEmbeddings ?? {};
    let embeddingModel: TextEmbeddingModel;
    const configValues = vals;

    const aiSettings = openai.apiSettingsFromEnv(
        openai.ModelType.Embedding,
        configValues,
    );

    embeddingModel = openai.createEmbeddingModel(aiSettings);

    return {
        addOrUpdate,
        remove,
        reset,
        search,
        toJSON,
    };

    function toJSON() {
        // Convert the Float32Array to a base64 string
        return Object.fromEntries(
            Object.entries(programEmbeddings).map(([key, value]) => [
                key,
                btoa(String.fromCharCode(...new Uint8Array(value.buffer))),
            ]),
        );
    }

    async function addOrUpdate(programName: string) {
        if (programEmbeddings[programName] !== undefined) {
            return;
        }
        try {
            const embedding = await generateEmbedding(
                embeddingModel,
                programName,
            );
            programEmbeddings[programName] = embedding;
        } catch (e: any) {
            debugError(
                `Could not create embedding for ${programName}. ${e.message}`,
            );
            // TODO: Retry with back-off for 429 responses
        }
    }

    async function remove(tabId: number): Promise<void> {
        if (programEmbeddings[tabId]) {
            delete programEmbeddings[tabId];
        }
    }

    async function reset() {
        programEmbeddings = {};
    }

    async function search(
        query: string | NormalizedEmbedding,
        maxMatches: number,
    ): Promise<ScoredItem<NameValue<string>>[]> {
        const embeddings = Object.values(programEmbeddings);
        const programNames = Object.keys(programEmbeddings);

        const embedding = await generateEmbedding(embeddingModel, query);
        const topN = indexesOfNearest(
            embeddings,
            embedding,
            maxMatches,
            SimilarityType.Dot,
        );

        return topN.map((m: { item: { toString: () => any }; score: any }) => {
            const itemIndex = Number(m.item);

            return {
                score: m.score,
                item: {
                    name: m.item.toString(),
                    value: programNames[itemIndex],
                },
            };
        });
    }
}
