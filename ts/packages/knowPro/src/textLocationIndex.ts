// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ListIndexingResult, TextLocation } from "./interfaces.js";
import { IndexingEventHandlers } from "./interfaces.js";
import {
    addTextBatchToEmbeddingIndex,
    addTextToEmbeddingIndex,
    EmbeddingIndex,
    indexOfNearestTextInIndex,
    indexOfNearestTextInIndexSubset,
    TextEmbeddingIndexSettings,
} from "./fuzzyIndex.js";
import { NormalizedEmbedding } from "typeagent";
import { Scored } from "./common.js";

export type ScoredTextLocation = {
    score: number;
    textLocation: TextLocation;
};

export interface ITextToTextLocationIndex {
    addTextLocation(
        text: string,
        textLocation: TextLocation,
    ): Promise<ListIndexingResult>;
    addTextLocations(
        textAndLocations: [string, TextLocation][],
        eventHandler?: IndexingEventHandlers,
    ): Promise<ListIndexingResult>;
    lookupText(
        text: string,
        maxMatches?: number,
        thresholdScore?: number,
    ): Promise<ScoredTextLocation[]>;

    serialize(): ITextToTextLocationIndexData;
    deserialize(data: ITextToTextLocationIndexData): void;
}

export interface ITextToTextLocationIndexData {
    textLocations: TextLocation[];
    embeddings: Float32Array[];
}

export class TextToTextLocationIndex implements ITextToTextLocationIndex {
    private textLocations: TextLocation[];
    private embeddingIndex: EmbeddingIndex;

    constructor(public settings: TextEmbeddingIndexSettings) {
        this.textLocations = [];
        this.embeddingIndex = new EmbeddingIndex();
    }

    public get size(): number {
        return this.embeddingIndex.size;
    }

    public get(pos: number): TextLocation {
        return this.textLocations[pos];
    }

    public async addTextLocation(
        text: string,
        textLocation: TextLocation,
    ): Promise<ListIndexingResult> {
        const result = await addTextToEmbeddingIndex(
            this.embeddingIndex,
            this.settings.embeddingModel,
            [text],
        );
        if (result.numberCompleted > 0) {
            this.textLocations.push(textLocation);
        }
        return result;
    }

    public async addTextLocations(
        textAndLocations: [string, TextLocation][],
        eventHandler?: IndexingEventHandlers,
        batchSize?: number,
    ): Promise<ListIndexingResult> {
        const indexingEvents = createMessageIndexingEventHandler(
            textAndLocations,
            eventHandler,
        );
        const result = await addTextBatchToEmbeddingIndex(
            this.embeddingIndex,
            this.settings.embeddingModel,
            textAndLocations.map((tl) => tl[0]),
            batchSize ?? this.settings.batchSize,
            indexingEvents,
        );
        if (result.numberCompleted > 0) {
            textAndLocations =
                result.numberCompleted === textAndLocations.length
                    ? textAndLocations
                    : textAndLocations.slice(0, result.numberCompleted);
            this.textLocations.push(...textAndLocations.map((tl) => tl[1]));
        }
        return result;
    }

    public async lookupText(
        text: string,
        maxMatches?: number,
        thresholdScore?: number,
    ): Promise<ScoredTextLocation[]> {
        const matches = await indexOfNearestTextInIndex(
            this.embeddingIndex,
            this.settings.embeddingModel,
            text,
            maxMatches,
            thresholdScore,
        );
        return matches.map((m) => {
            return {
                textLocation: this.textLocations[m.item],
                score: m.score,
            };
        });
    }

    /**
     * Find text locations nearest to the provided text.
     * But only search over the subset of text locations in this index identified by ordinalsToSearch
     * @param text
     * @param ordinalsToSearch
     * @param maxMatches
     * @param thresholdScore
     * @returns
     */
    public async lookupTextInSubset(
        text: string,
        ordinalsToSearch: number[],
        maxMatches?: number,
        thresholdScore?: number,
    ): Promise<ScoredTextLocation[]> {
        const matches = await indexOfNearestTextInIndexSubset(
            this.embeddingIndex,
            this.settings.embeddingModel,
            text,
            ordinalsToSearch,
            maxMatches,
            thresholdScore,
        );
        return matches.map((m) => {
            return {
                textLocation: this.textLocations[m.item],
                score: m.score,
            };
        });
    }

    public lookupByEmbedding(
        textEmbedding: NormalizedEmbedding,
        maxMatches?: number,
        thresholdScore?: number,
        predicate?: (messageOrdinal: number) => boolean,
    ): ScoredTextLocation[] {
        const matches = this.embeddingIndex.getIndexesOfNearest(
            textEmbedding,
            maxMatches,
            thresholdScore,
            predicate,
        );
        return this.toScoredLocations(matches);
    }

    public lookupInSubsetByEmbedding(
        textEmbedding: NormalizedEmbedding,
        ordinalsToSearch: number[],
        maxMatches?: number,
        thresholdScore?: number,
    ): ScoredTextLocation[] {
        const matches = this.embeddingIndex.getIndexesOfNearestInSubset(
            textEmbedding,
            ordinalsToSearch,
            maxMatches,
            thresholdScore,
        );
        return this.toScoredLocations(matches);
    }

    public clear(): void {
        this.textLocations = [];
        this.embeddingIndex.clear();
    }

    public serialize(): ITextToTextLocationIndexData {
        return {
            textLocations: this.textLocations,
            embeddings: this.embeddingIndex.serialize(),
        };
    }

    public deserialize(data: ITextToTextLocationIndexData): void {
        if (data.textLocations.length !== data.embeddings.length) {
            throw new Error(
                `TextToTextLocationIndexData corrupt. textLocation.length ${data.textLocations.length} != ${data.embeddings.length}`,
            );
        }
        this.textLocations = data.textLocations;
        this.embeddingIndex.deserialize(data.embeddings);
    }

    private toScoredLocations(matches: Scored[]): ScoredTextLocation[] {
        return matches.map((m) => {
            return {
                textLocation: this.textLocations[m.item],
                score: m.score,
            };
        });
    }
}

function createMessageIndexingEventHandler(
    textAndLocations: [string, TextLocation][],
    eventHandler?: IndexingEventHandlers | undefined,
): IndexingEventHandlers | undefined {
    return eventHandler && eventHandler.onTextIndexed !== undefined
        ? {
              onEmbeddingsCreated: (texts, batch, batchStartAt) => {
                  eventHandler.onTextIndexed!(
                      textAndLocations,
                      textAndLocations.slice(
                          batchStartAt,
                          batchStartAt + batch.length,
                      ),
                      batchStartAt,
                  );
                  return true;
              },
          }
        : eventHandler;
}
