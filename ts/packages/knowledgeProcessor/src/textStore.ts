// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { FileSystem, ObjectFolderSettings, asyncArray } from "typeagent";
import { SourceTextBlock, TextBlock, TextBlockType } from "./text.js";
import {
    TemporalLog,
    TemporalLogSettings,
    createTemporalLog,
} from "./temporal.js";

export interface TextStore<TextId = string, TSourceId = TextId>
    extends TemporalLog<TextId, TextBlock<TSourceId>> {
    entries(): AsyncIterableIterator<SourceTextBlock<TSourceId, TextId>>;
    getText(id: TextId): Promise<TextBlock<TSourceId> | undefined>;
    getMultipleText(ids: TextId[]): Promise<TextBlock<TSourceId>[]>;
}

export async function createTextStore<TSourceId = string>(
    settings: TemporalLogSettings,
    rootPath: string,
    folderSettings?: ObjectFolderSettings,
    fSys?: FileSystem,
): Promise<TextStore<string, TSourceId>> {
    const corpus = await createTemporalLog<TextBlock<TSourceId>>(
        settings,
        rootPath,
        folderSettings,
        fSys,
    );

    return {
        ...corpus,
        entries,
        getText,
        getMultipleText,
    };

    async function* entries(): AsyncIterableIterator<
        SourceTextBlock<TSourceId>
    > {
        for await (const nv of corpus.all()) {
            const tValue = nv.value;
            yield {
                blockId: nv.name,
                timestamp: tValue.timestamp,
                ...tValue.value,
            };
        }
    }

    async function getText(
        id: string,
    ): Promise<TextBlock<TSourceId> | undefined> {
        const tValue = await corpus.get(id);
        return tValue ? tValue.value : undefined;
    }

    async function getMultipleText(
        ids: string[],
    ): Promise<TextBlock<TSourceId>[]> {
        return await asyncArray.mapAsync(
            ids,
            settings.concurrency,
            async (id) => {
                const block = await getText(id);
                return block ?? emptyBlock();
            },
        );
    }

    function emptyBlock(): TextBlock<TSourceId> {
        return {
            type: TextBlockType.Raw,
            value: "",
        };
    }
}
