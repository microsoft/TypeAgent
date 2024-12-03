// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ScoredItem, SearchOptions } from "typeagent";
import { TextIndex, TextIndexSettings } from "./knowledgeIndex.js";
import { unionMultiple } from "./setOperations.js";
import {
    StorageProvider,
    ValueDataType,
    ValueType,
} from "./storageProvider.js";

export interface TextMatcher<TTextId = any> {
    match(
        value: string,
        options?: SearchOptions,
    ): Promise<ScoredItem<TTextId>[] | undefined>;
}

export interface AliasMatcher<TTextId = any, TAliasId = any>
    extends TextMatcher<TTextId> {
    addAlias(alias: string, textId: TTextId): Promise<TAliasId>;
    removeAlias(alias: string, textId: TTextId): Promise<void>;
}

export async function createAliasMatcher<TTextId extends ValueType>(
    storageProvider: StorageProvider,
    basePath: string,
    name: string,
    textIdType: ValueDataType<TTextId>,
): Promise<AliasMatcher<TTextId, string>> {
    type AliasId = string;
    const aliases = await storageProvider.createTextIndex<TTextId>(
        { caseSensitive: false, concurrency: 1 },
        basePath,
        name,
        textIdType,
    );
    return {
        addAlias,
        removeAlias,
        match,
    };

    async function addAlias(alias: string, textId: TTextId): Promise<AliasId> {
        return aliases.put(alias, [textId]);
    }

    async function removeAlias(alias: string, textId: TTextId): Promise<void> {
        const aliasId = await aliases.getId(alias);
        if (aliasId) {
            await aliases.remove(aliasId, textId);
        }
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
