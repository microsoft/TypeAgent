// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ScoredItem, SearchOptions } from "typeagent";
import { TextIndex, TextIndexSettings } from "../knowledgeIndex.js";
import { unionMultiple } from "../setOperations.js";
import {
    StorageProvider,
    ValueDataType,
    ValueType,
} from "../storageProvider.js";

export interface TextMatcher<TTextId = any> {
    add(value: string, textId: TTextId): Promise<void>;
    remove(value: string, textId: TTextId): Promise<void>;
    match(
        value: string,
        options?: SearchOptions,
    ): Promise<ScoredItem<TTextId>[] | undefined>;
}

export async function createAliasMatcher<TTextId extends ValueType>(
    storageProvider: StorageProvider,
    basePath: string,
    name: string,
    textIdType: ValueDataType<TTextId>,
): Promise<TextMatcher<TTextId>> {
    const aliases = await storageProvider.createTextIndex<TTextId>(
        { caseSensitive: false, concurrency: 1 },
        basePath,
        "aliases",
        textIdType,
    );
    return {
        add,
        remove,
        match,
    };

    async function add(value: string, textId: TTextId): Promise<void> {
        await aliases.put(value, [textId]);
    }
    async function remove(value: string, textId: TTextId): Promise<void> {
        await aliases.remove(value, textId);
    }
    async function match(
        value: string,
        options?: SearchOptions,
    ): Promise<ScoredItem<TTextId>[] | undefined> {
        const matches = await aliases.get(value);
        return matches && matches.length > 0
            ? matches.map((item) => {
                  return {
                      item,
                      score: 1.0,
                  };
              })
            : undefined;
    }
}

export interface NameIndex<TTextId = any, TSourceId = any>
    extends TextIndex<TTextId, TSourceId> {
    readonly aliases: TextIndex<TTextId>;

    addAlias(name: string, alias: string): Promise<TTextId | undefined>;
    removeAlias(name: string, alias: string): Promise<void>;
}

export async function createNameIndex<TSourceId extends ValueType>(
    storageProvider: StorageProvider,
    settings: TextIndexSettings,
    basePath: string,
    name: string,
    sourceIdType: ValueDataType<TSourceId>,
): Promise<NameIndex<string, TSourceId>> {
    type TextId = string;
    const textIndex = await storageProvider.createTextIndex<TSourceId>(
        settings,
        basePath,
        name,
        sourceIdType,
    );
    const aliases = await storageProvider.createTextIndex<TextId>(
        settings,
        basePath,
        "aliases",
        "TEXT",
    );
    const nameIndex = {
        ...textIndex,
        get aliases() {
            return aliases;
        },
        get,
        addAlias,
        removeAlias,
    };
    return nameIndex;

    async function get(text: string): Promise<TSourceId[] | undefined> {
        const postings = await textIndex.get(text);
        if (postings) {
            return postings;
        }
        const textIds = await aliases.get(text);
        if (textIds) {
            const postingsList = await textIndex.getByIds(textIds);
            return [...unionMultiple(...postingsList)];
        }
        return undefined;
    }

    async function addAlias(
        name: string,
        alias: string,
    ): Promise<TextId | undefined> {
        const textId = await textIndex.getId(name);
        if (textId) {
            return await aliases.put(alias, [textId]);
        }
        return undefined;
    }

    async function removeAlias(name: string, alias: string): Promise<void> {
        const aliasId = await aliases.getId(alias);
        if (aliasId) {
            const textId = await textIndex.getId(name);
            if (textId) {
                await aliases.remove(aliasId, textId);
            }
        }
    }
}
