// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TextIndex, TextIndexSettings } from "../knowledgeIndex.js";
import { unionMultiple } from "../setOperations.js";
import {
    StorageProvider,
    ValueDataType,
    ValueType,
} from "../storageProvider.js";

export interface NameIndex<TSourceId extends ValueType>
    extends TextIndex<string, TSourceId> {
    getAliases(): Promise<TextIndex<string>>;

    addAlias(name: string, alias: string): Promise<void>;
}

export async function createNameIndex<TSourceId extends ValueType>(
    storageProvider: StorageProvider,
    settings: TextIndexSettings,
    basePath: string,
    name: string,
    sourceIdType: ValueDataType<TSourceId>,
): Promise<NameIndex<TSourceId>> {
    type TextId = string;
    const textIndex = await storageProvider.createTextIndex<TSourceId>(
        settings,
        basePath,
        name,
        sourceIdType,
    );
    let aliasIndex: TextIndex<TextId> | undefined;
    return {
        ...textIndex,
        get,
        getAliases,
        addAlias,
    };

    async function get(text: string): Promise<TSourceId[] | undefined> {
        const postings = await textIndex.get(text);
        if (postings) {
            return postings;
        }
        const aliases = await getAliases();
        const textIds = await aliases.get(text);
        if (textIds) {
            const postingsList = await textIndex.getByIds(textIds);
            return [...unionMultiple(...postingsList)];
        }
        return undefined;
    }

    async function getAliases(): Promise<TextIndex<TextId>> {
        if (!aliasIndex) {
            aliasIndex = await storageProvider.createTextIndex<TextId>(
                settings,
                basePath,
                "aliases",
                "TEXT",
            );
        }
        return aliasIndex;
    }

    async function addAlias(name: string, alias: string): Promise<void> {
        const aliases = await getAliases();
        const textId = await textIndex.getId(name);
        if (textId) {
            await aliases.put(alias, [textId]);
        }
    }
}
