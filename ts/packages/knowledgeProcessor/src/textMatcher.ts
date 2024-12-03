// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { asyncArray, NameValue, ScoredItem } from "typeagent";
import {
    StorageProvider,
    ValueDataType,
    ValueType,
} from "./storageProvider.js";
import { removeUndefined } from "./setOperations.js";

export interface TextTable<TTextId = any> {
    getId(text: string): Promise<TTextId | undefined>;
    getText(id: TTextId): Promise<string | undefined>;
}

export interface TextMatcher<TTextId = any> {
    match(text: string): Promise<TTextId[] | undefined>;
}

export interface ApproxTextMatcher<TTextId = any> {
    match(
        value: string,
        maxMatches?: number,
        minScore?: number,
    ): Promise<ScoredItem<TTextId>[] | undefined>;
}

export interface AliasMatcher<TTextId = any, TAliasId = any>
    extends TextMatcher<TTextId> {
    entries(): AsyncIterableIterator<NameValue<string[]>>;

    getByAlias(text: string): Promise<string[] | undefined>;
    addAlias(alias: string, text: string): Promise<TAliasId | undefined>;
    removeAlias(alias: string, text: string): Promise<void>;
}

export async function createAliasMatcher<TTextId extends ValueType = string>(
    textTable: TextTable<TTextId>,
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
    const thisMatcher: AliasMatcher<TTextId, AliasId> = {
        entries,
        addAlias,
        removeAlias,
        match,
        getByAlias,
    };
    return thisMatcher;

    async function* entries(): AsyncIterableIterator<NameValue<string[]>> {
        for await (const alias of aliases.text()) {
            const texts = await getByAlias(alias);
            if (texts && texts.length > 0) {
                yield { name: alias, value: texts };
            }
        }
    }

    async function addAlias(
        alias: string,
        text: string,
    ): Promise<AliasId | undefined> {
        const textId = await textTable.getId(text);
        if (textId) {
            return aliases.put(alias, [textId]);
        }
        return undefined;
    }

    async function removeAlias(alias: string, text: string): Promise<void> {
        const aliasId = await aliases.getId(alias);
        if (aliasId) {
            const textId = await textTable.getId(text);
            if (textId) {
                await aliases.remove(aliasId, textId);
            }
        }
    }

    async function match(text: string): Promise<TTextId[] | undefined> {
        return aliases.get(text);
    }

    async function getByAlias(text: string): Promise<string[] | undefined> {
        const textIds = await match(text);
        if (textIds && textIds.length > 0) {
            const texts = await asyncArray.mapAsync(textIds, 1, (id) =>
                textTable.getText(id),
            );
            return removeUndefined(texts);
        }
        return undefined;
    }
}
