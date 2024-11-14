// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "path";
import {
    FileSystem,
    ObjectFolder,
    ObjectFolderSettings,
    ScoredItem,
    SemanticIndex,
    asyncArray,
    collections,
    createEmbeddingFolder,
    createObjectFolder,
    createSemanticIndex,
    removeDir,
} from "typeagent";
import {
    HitTable,
    intersectMultiple,
    intersectUnionMultiple,
    removeUndefined,
    union,
    unionArrays,
    unionMultiple,
    unionMultipleScored,
} from "./setOperations.js";
import { TextBlock, TextBlockType } from "./text.js";
import { TextEmbeddingModel } from "aiclient";
import { KeyValueIndex } from "./keyValueIndex.js";

export async function createIndexFolder<TValueId>(
    folderPath: string,
    folderSettings?: ObjectFolderSettings,
    fSys?: FileSystem,
): Promise<KeyValueIndex<string, TValueId>> {
    type TKeyId = string;
    const indexFolder = await createObjectFolder<TValueId[]>(
        folderPath,
        folderSettings,
        fSys,
    );
    return {
        get,
        getMultiple,
        put,
        replace,
        remove,
    };

    async function get(id: TKeyId): Promise<TValueId[] | undefined> {
        return indexFolder.get(id);
    }

    async function getMultiple(
        ids: TKeyId[],
        concurrency?: number,
    ): Promise<TValueId[][]> {
        const values = await asyncArray.mapAsync(ids, concurrency ?? 1, (id) =>
            indexFolder.get(id),
        );
        return removeUndefined(values);
    }

    async function put(postings?: TValueId[], id?: TKeyId): Promise<TKeyId> {
        postings = preparePostings(postings);
        const existingPostings = id ? await indexFolder.get(id) : undefined;
        const updatedPostings =
            existingPostings && existingPostings.length > 0
                ? [...union(existingPostings, postings)]
                : postings;
        return await indexFolder.put(updatedPostings, id);
    }

    function replace(postings: TValueId[], id: TKeyId): Promise<TKeyId> {
        return indexFolder.put(postings, id);
    }

    function remove(id: TKeyId): Promise<void> {
        return indexFolder.remove(id);
    }

    function preparePostings(postings?: TValueId[]): TValueId[] {
        return postings ? postings.sort() : [];
    }
}

export interface TextIndex<TTextId = any, TSourceId = any> {
    text(): IterableIterator<string>;
    ids(): AsyncIterableIterator<TTextId>;
    entries(): AsyncIterableIterator<TextBlock<TSourceId>>;
    /**
     * Get the sourceIds (if any) for the text exactly matching the given value
     * For fuzzy matching, use getNearest
     * @param value
     */
    get(value: string): Promise<TSourceId[] | undefined>;
    getById(id: TTextId): Promise<TSourceId[] | undefined>;
    getByIds(ids: TTextId[]): Promise<(TSourceId[] | undefined)[]>;
    getId(value: string): Promise<TTextId | undefined>;
    getIds(values: string[]): Promise<(TTextId | undefined)[]>;
    getText(id: TTextId): Promise<string | undefined>;
    // TODO: rename put to "add"
    put(value: string, postings?: TSourceId[]): Promise<TTextId>;
    putMultiple(values: TextBlock<TSourceId>[]): Promise<TTextId[]>;
    /**
     * Add source Ids for the given text Id
     * @param id
     * @param postings
     */
    addSources(id: TTextId, postings: TSourceId[]): Promise<void>;
    /**
     * Get the sourceIds for the texts nearest to the given value
     * Ids are returned in sorted order, with duplicates removed
     * @param value
     * @param maxMatches
     * @param minScore
     */
    getNearest(
        value: string,
        maxMatches?: number,
        minScore?: number,
    ): Promise<TSourceId[]>;
    /**
     * Get the sourceIds for the texts nearest to the given values
     * Ids are returned in sorted order, with duplicates removed
     * @param values
     * @param maxMatches
     * @param minScore
     */
    getNearestMultiple(
        values: string[],
        maxMatches?: number,
        minScore?: number,
    ): Promise<TSourceId[]>;
    getNearestHits(
        value: string,
        hitTable: HitTable<TSourceId>,
        maxMatches?: number,
        minScore?: number,
        scoreBoost?: number,
    ): Promise<void>;
    getNearestHitsMultiple(
        values: string[],
        hitTable: HitTable<TSourceId>,
        maxMatches?: number,
        minScore?: number,
        scoreBoost?: number,
    ): Promise<void>;
    nearestNeighbors(
        value: string,
        maxMatches: number,
        minScore?: number,
    ): Promise<ScoredItem<TSourceId[]>[]>;
    /**
     * Return the TextIds of the text nearest to the given value.
     * @param value
     * @param maxMatches
     * @param minScore
     */
    getNearestText(
        value: string,
        maxMatches: number,
        minScore?: number,
    ): Promise<TTextId[]>;
    /**
     * Return the TextIds of the texts nearest to the given values.
     * @param value
     * @param maxMatches
     * @param minScore
     */
    getNearestTextMultiple(
        values: string[],
        maxMatches: number,
        minScore?: number,
    ): Promise<TTextId[]>;
    /**
     * Return the TextIds of the nearest matching text + their scores
     * @param value
     * @param maxMatches
     * @param minScore
     */
    nearestNeighborsText(
        value: string,
        maxMatches: number,
        minScore?: number,
    ): Promise<ScoredItem<TTextId>[]>;
    nearestNeighborsPairs(
        value: string,
        maxMatches: number,
        minScore?: number,
    ): Promise<ScoredItem<TextBlock<TSourceId>>[]>;
    remove(textId: TTextId, postings: TSourceId | TSourceId[]): Promise<void>;
}

export type TextIndexSettings = {
    caseSensitive: boolean;
    concurrency: number;
    semanticIndex?: boolean | undefined;
    embeddingModel?: TextEmbeddingModel | undefined;
};

// There are *three* important types here:
// - entries are always strings; typically words or sentences
// - postings are arrays of TSourceIds; typically unique IDs for other objects
// - TextId is a string that uniquely identifies an (entry, postings) pair internally
export async function createTextIndex<TSourceId = any>(
    settings: TextIndexSettings,
    folderPath: string,
    folderSettings?: ObjectFolderSettings,
    fSys?: FileSystem,
    textFolder?: ObjectFolder<string>,
): Promise<TextIndex<string, TSourceId>> {
    type TextId = string;
    const entriesFolder =
        textFolder ??
        (await createObjectFolder<string>(
            path.join(folderPath, "entries"),
            folderSettings,
            fSys,
        ));
    const textIdMap: Map<string, TextId> = await loadTextIdMap();
    const postingFolder = await createIndexFolder<TSourceId>(
        path.join(folderPath, "postings"),
        folderSettings,
        fSys,
    );
    const semanticIndex =
        settings.semanticIndex !== undefined && settings.semanticIndex
            ? await createSemanticIndexFolder(
                  folderPath,
                  folderSettings,
                  settings.concurrency,
                  settings.embeddingModel,
                  fSys,
              )
            : undefined;

    return {
        text: () => textIdMap.keys(),
        ids,
        entries,
        get,
        getById,
        getByIds,
        getId,
        getIds,
        getText,
        put,
        putMultiple,
        addSources,
        getNearest,
        getNearestHits,
        getNearestHitsMultiple,
        getNearestMultiple,
        getNearestText,
        getNearestTextMultiple,
        nearestNeighbors,
        nearestNeighborsText,
        nearestNeighborsPairs,
        remove,
    };

    async function* ids(): AsyncIterableIterator<TextId> {
        for (const id of textIdMap.values()) {
            yield id;
        }
    }

    async function* entries(): AsyncIterableIterator<TextBlock<TSourceId>> {
        for (const text of textIdMap.keys()) {
            yield {
                type: TextBlockType.Sentence,
                value: text,
                sourceIds: await get(text),
            };
        }
    }

    async function get(text: string): Promise<TSourceId[] | undefined> {
        const textId = textToId(text);
        if (textId) {
            return postingFolder.get(textId);
        }
        return undefined;
    }

    async function getById(id: TextId): Promise<TSourceId[] | undefined> {
        return postingFolder.get(id);
    }

    async function getByIds(
        ids: TextId[],
    ): Promise<(TSourceId[] | undefined)[]> {
        return asyncArray.mapAsync(ids, settings.concurrency, (id) =>
            getById(id),
        );
    }

    async function getId(text: string): Promise<TextId | undefined> {
        return textToId(text);
    }

    async function getIds(texts: string[]): Promise<(TextId | undefined)[]> {
        return texts.map((t) => textToId(t));
    }

    async function getText(id: TextId): Promise<string | undefined> {
        return entriesFolder.get(id);
    }

    async function put(text: string, postings?: TSourceId[]): Promise<TextId> {
        text = prepareText(text);
        postings = preparePostings(postings);
        let textId = textToId(text, false);
        if (textId) {
            await updatePostings(textId, postings);
        } else {
            textId = await addPostings(text, postings);
            textIdMap.set(text, textId);
        }

        return textId;
    }

    async function putMultiple(
        blocks: TextBlock<TSourceId>[],
    ): Promise<TextId[]> {
        // TODO: parallelize
        const ids: TextId[] = [];
        for (const b of blocks) {
            const id = await put(b.value, b.sourceIds);
            ids.push(id);
        }
        return ids;
    }

    function addSources(textId: TextId, sourceIds: TSourceId[]): Promise<void> {
        return updatePostings(textId, sourceIds);
    }

    async function addPostings(
        text: string,
        postings?: TSourceId[],
    ): Promise<TextId> {
        let textId = await entriesFolder.put(text);
        const tasks = [];
        if (postings && postings.length > 0) {
            tasks.push(postingFolder.put(postings, textId));
        }
        if (semanticIndex) {
            tasks.push(semanticIndex.put(text, textId));
        }
        await Promise.all(tasks);
        return textId;
    }

    async function updatePostings(
        textId: TextId,
        postings?: TSourceId[],
    ): Promise<void> {
        if (postings && postings.length > 0) {
            const existingPostings = await postingFolder.get(textId);
            const updatedPostings =
                existingPostings && existingPostings.length > 0
                    ? [...union(existingPostings.values(), postings.values())]
                    : postings;
            await postingFolder.replace(updatedPostings, textId);
        }
    }

    async function remove(
        textId: TextId,
        postings: TSourceId | TSourceId[],
    ): Promise<void> {
        const existingPostings = await postingFolder.get(textId);
        if (!existingPostings || existingPostings.length === 0) {
            return;
        }
        let updatedPostings = collections.removeItemFromArray(
            existingPostings,
            postings,
        );
        if (updatedPostings.length === 0) {
            await postingFolder.remove(textId);
        } else {
            await postingFolder.replace(updatedPostings, textId);
        }
    }

    async function getNearest(
        value: string,
        maxMatches?: number,
        minScore?: number,
    ): Promise<TSourceId[]> {
        maxMatches ??= 1;
        // Check exact match first
        let postings = await get(value);
        let postingsNearest: TSourceId[] | undefined;
        if (maxMatches > 1) {
            const nearestPostings = await getNearestPostings(
                value,
                maxMatches,
                minScore,
            );
            postingsNearest = [...unionMultiple(...nearestPostings)];
        } else if (semanticIndex && (!postings || postings.length === 0)) {
            const textId = await semanticIndex.nearestNeighbor(value, minScore);
            if (textId) {
                postingsNearest = await postingFolder.get(textId.item);
            }
        }
        postings = unionArrays(postings, postingsNearest);
        return postings ?? [];
    }

    async function getNearestHits(
        value: string,
        hitTable: HitTable<TSourceId>,
        maxMatches?: number,
        minScore?: number,
        scoreBoost?: number,
    ): Promise<void> {
        maxMatches ??= 1;
        // Check exact match first
        let postingsExact = await get(value);
        let postingsNearest:
            | ScoredItem<TSourceId>[]
            | IterableIterator<ScoredItem<TSourceId>>
            | undefined;
        if (maxMatches > 1) {
            const scoredPostings = await getNearestPostingsWithScore(
                value,
                maxMatches,
                minScore,
            );
            postingsNearest = unionMultipleScored(...scoredPostings);
        } else if (
            semanticIndex &&
            (!postingsExact || postingsExact.length === 0)
        ) {
            const textId = await semanticIndex.nearestNeighbor(value, minScore);
            if (textId) {
                const postings = await postingFolder.get(textId.item);
                if (postings) {
                    postingsNearest = scorePostings(
                        postings,
                        scoreBoost ? scoreBoost * textId.score : textId.score,
                    );
                }
            }
        }
        hitTable.addMultipleScored(
            unionMultipleScored(
                postingsExact ? scorePostings(postingsExact, 1.0) : undefined,
                postingsNearest,
            ),
        );
    }

    async function getNearestHitsMultiple(
        values: string[],
        hitTable: HitTable<TSourceId>,
        maxMatches?: number,
        minScore?: number,
        scoreBoost?: number,
    ): Promise<void> {
        return asyncArray.forEachAsync(values, settings.concurrency, (v) =>
            getNearestHits(v, hitTable, maxMatches, minScore, scoreBoost),
        );
    }

    async function getNearestMultiple(
        values: string[],
        maxMatches?: number,
        minScore?: number,
    ): Promise<TSourceId[]> {
        const matches = await asyncArray.mapAsync(
            values,
            settings.concurrency,
            (t) => getNearest(t, maxMatches, minScore),
        );

        const combined = intersectMultiple(...matches);
        return Array.isArray(combined) ? combined : [...combined];
    }

    async function getNearestText(
        value: string,
        maxMatches?: number,
        minScore?: number,
    ): Promise<TextId[]> {
        maxMatches ??= 1;
        // Check exact match first
        let matchedIds: TextId[] = [];
        let exactMatchId = textToId(value);
        if (exactMatchId) {
            matchedIds.push(exactMatchId);
        }
        if (semanticIndex && maxMatches > 1) {
            const nearestMatches = await semanticIndex.nearestNeighbors(
                value,
                maxMatches,
                minScore,
            );
            if (nearestMatches.length > 0) {
                const nearestIds = nearestMatches.map((m) => m.item).sort();
                matchedIds = unionArrays(matchedIds, nearestIds) as TextId[];
            }
        }
        return matchedIds;
    }

    async function getNearestTextMultiple(
        values: string[],
        maxMatches?: number,
        minScore?: number,
    ): Promise<TextId[]> {
        const matches = await asyncArray.mapAsync(
            values,
            settings.concurrency,
            (t) => getNearestText(t, maxMatches, minScore),
        );

        return intersectUnionMultiple(...matches) ?? [];
    }

    async function nearestNeighbors(
        value: string,
        maxMatches: number,
        minScore?: number,
    ): Promise<ScoredItem<TSourceId[]>[]> {
        const matches = await nearestNeighborsText(value, maxMatches, minScore);
        return asyncArray.mapAsync(matches, settings.concurrency, async (m) => {
            return {
                score: m.score,
                item: (await postingFolder.get(m.item)) ?? [],
            };
        });
    }

    async function nearestNeighborsText(
        value: string,
        maxMatches: number,
        minScore?: number,
    ): Promise<ScoredItem<TextId>[]> {
        if (!semanticIndex) {
            return [];
        }
        let matches = await semanticIndex.nearestNeighbors(
            value,
            maxMatches,
            minScore,
        );
        // Also do an exact match
        let textId: TextId | undefined = textToId(value);
        if (textId) {
            // Remove prior match
            const pos = matches.findIndex((m) => m.item === textId);
            if (pos >= 0) {
                matches.splice(pos, 1);
            }
            matches.splice(0, 0, { score: 1.0, item: textId });
        }
        return matches;
    }

    async function nearestNeighborsPairs(
        query: string,
        maxMatches: number,
        minScore?: number,
    ): Promise<ScoredItem<TextBlock<TSourceId>>[]> {
        return removeUndefined(
            await asyncArray.mapAsync(
                await nearestNeighborsText(query, maxMatches, minScore),
                settings.concurrency,
                async (m) => {
                    const value = await entriesFolder.get(m.item);
                    if (!value) return;
                    const sourceIds = await postingFolder.get(m.item);
                    if (!sourceIds) return;
                    return {
                        score: m.score,
                        item: {
                            type: TextBlockType.Sentence,
                            value,
                            sourceIds,
                        },
                    };
                },
            ),
        );
    }

    async function loadTextIdMap(): Promise<Map<string, TextId>> {
        const map = new Map<string, TextId>();
        const allIds: TextId[] = await entriesFolder.allNames();
        if (allIds.length > 0) {
            // Load all text entries
            const allText: (string | undefined)[] = await asyncArray.mapAsync(
                allIds,
                settings.concurrency,
                (id) => entriesFolder.get(id),
            );
            if (!allText || allIds.length !== allText.length) {
                throw Error(`TextIndex is corrupt: ${folderPath}`);
            }
            // And now map the text to its ids
            for (let i = 0; i < allIds.length; ++i) {
                const text = allText[i];
                if (text) {
                    map.set(text, allIds[i]);
                }
            }
        }
        return map;
    }

    async function getNearestPostings(
        value: string,
        maxMatches?: number,
        minScore?: number,
    ) {
        if (!semanticIndex) {
            return [];
        }
        maxMatches ??= 1;
        const nearestText = await semanticIndex.nearestNeighbors(
            value,
            maxMatches,
            minScore,
        );
        return asyncArray.mapAsync(nearestText, settings.concurrency, (m) =>
            postingFolder.get(m.item),
        );
    }

    async function getNearestPostingsWithScore(
        value: string,
        maxMatches?: number,
        minScore?: number,
    ): Promise<IterableIterator<ScoredItem<TSourceId>>[]> {
        if (!semanticIndex) {
            return [];
        }
        maxMatches ??= 1;
        const nearestText = await semanticIndex.nearestNeighbors(
            value,
            maxMatches,
            minScore,
        );
        const nearestPostings = await asyncArray.mapAsync(
            nearestText,
            settings.concurrency,
            (m) => postingFolder.get(m.item),
        );
        const scoredPostings: IterableIterator<ScoredItem<TSourceId>>[] = [];
        for (let i = 0; i < nearestPostings.length; ++i) {
            const posting = nearestPostings[i];
            if (posting) {
                scoredPostings.push(
                    scorePostings(posting, nearestText[i].score),
                );
            }
        }
        return scoredPostings;
    }

    function* scorePostings(
        postings: TSourceId[],
        score: number,
    ): IterableIterator<ScoredItem<TSourceId>> {
        for (const item of postings) {
            yield { item, score };
        }
    }

    function textToId(
        text: string,
        prepare: boolean = true,
    ): TextId | undefined {
        return textIdMap.get(prepare ? prepareText(text) : text);
    }

    function prepareText(text: string): string {
        return settings.caseSensitive ? text : text.toLowerCase();
    }

    function preparePostings(postings?: TSourceId[]): TSourceId[] {
        return postings ? postings.sort() : [];
    }
}

export async function searchIndex<TTextId = any, TPostingId = any>(
    index: TextIndex<TTextId, TPostingId>,
    value: string,
    exact: boolean,
    count?: number,
    minScore?: number,
): Promise<ScoredItem<TPostingId[]>[]> {
    if (exact) {
        const ids = await index.get(value);
        if (ids) {
            return [{ score: 1.0, item: ids }];
        }
        return [];
    }
    count ??= 1;
    const matches = await index.nearestNeighbors(value, count, minScore);
    return matches;
}

export async function searchIndexText<TTextId = any, TPostingId = any>(
    index: TextIndex<TTextId, TPostingId>,
    value: string,
    exact: boolean,
    count?: number,
    minScore?: number,
): Promise<ScoredItem<TTextId>[]> {
    if (exact) {
        const id = await index.getId(value);
        if (id) {
            return [{ score: 1.0, item: id }];
        }
        return [];
    }
    count ??= 1;
    const matches = await index.nearestNeighborsText(value, count, minScore);
    return matches;
}

export async function createSemanticIndexFolder(
    folderPath: string,
    folderSettings?: ObjectFolderSettings,
    concurrency?: number,
    model?: TextEmbeddingModel,
    fSys?: FileSystem,
): Promise<SemanticIndex> {
    return createSemanticIndex(
        await createEmbeddingFolder(
            path.join(folderPath, "embeddings"),
            folderSettings,
            concurrency,
            fSys,
        ),
        model,
    );
}

export async function removeSemanticIndexFolder(
    folderPath: string,
    fSys?: FileSystem,
) {
    await removeDir(path.join(folderPath, "embeddings"), fSys);
}

export interface TermSet {
    has(term: string): boolean;
    put(term: string): void;
}

export function createTermSet(caseSensitive: boolean = false) {
    const set = new Set();
    return {
        has(term: string): boolean {
            return set.has(prepareTerm(term));
        },
        put(term: string): void {
            set.add(prepareTerm(term));
        },
    };

    function prepareTerm(term: string): string {
        return caseSensitive ? term : term.toLowerCase();
    }
}

export interface TermMap {
    size(): number;
    get(term: string): string | undefined;
    put(term: string, value: string): void;
}

export function createTermMap(caseSensitive: boolean = false) {
    const map = new Map<string, string>();
    return {
        size() {
            return map.size;
        },
        get(term: string) {
            return map.get(prepareTerm(term));
        },
        put(term: string, value: string) {
            map.set(prepareTerm(term), value);
        },
    };

    function prepareTerm(term: string): string {
        return caseSensitive ? term : term.toLowerCase();
    }
}
