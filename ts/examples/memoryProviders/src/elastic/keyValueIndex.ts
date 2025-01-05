// Copyright (c) Microsoft Corporation and Henry Lucco.
// Licensed under the MIT License.

import { Client } from "@elastic/elasticsearch";
import { KeyValueIndex, ValueType } from "knowledge-processor";
import { toValidIndexName } from "./common.js";

export async function createKeyValueIndex<
    TKeyId extends ValueType = string,
    TValueId extends ValueType = string,
>(
    elasticClient: Client,
    indexName: string,
): Promise<KeyValueIndex<TKeyId, TValueId>> {
    interface ElasticEntry {
        keyId: TKeyId;
        valueIds: TValueId[];
    }

    indexName = toValidIndexName(indexName);

    if (!(await elasticClient.indices.exists({ index: indexName }))) {
        elasticClient.indices.create({
            index: indexName,
        });
    }

    return {
        get,
        getMultiple,
        put,
        replace,
        remove,
    };

    async function get(id: TKeyId): Promise<TValueId[] | undefined> {
        try {
            const response = await elasticClient.get<ElasticEntry>({
                index: indexName,
                id: id as string,
            });

            return response._source?.valueIds;
        } catch (e) {
            // id is not found, return undefined
            return undefined;
        }
    }

    async function getMultiple(ids: TKeyId[]): Promise<TValueId[][]> {
        const response = await elasticClient.mget<ElasticEntry>({
            index: indexName,
            body: {
                ids: ids as string[],
            },
        });

        const textIds = response.docs.map((doc) => doc._id);
        const sourceIdsMaybe = await Promise.all(
            textIds.map(async (textId) => {
                return await get(textId as TKeyId);
            }),
        );

        const sourceIds = sourceIdsMaybe.filter(
            (sourceId) => sourceId !== undefined,
        ) as TValueId[][];

        return sourceIds;
    }

    async function put(postings: TValueId[], id?: TKeyId): Promise<TKeyId> {
        const entry: ElasticEntry = {
            keyId: id as TKeyId,
            valueIds: postings,
        };

        const putResponse = await elasticClient.index<ElasticEntry>({
            index: indexName,
            id: id as string,
            body: entry,
        });

        return putResponse._id as TKeyId;
    }

    async function replace(postings: TValueId[], id: TKeyId): Promise<TKeyId> {
        return await put(postings, id);
    }

    async function remove(id: TKeyId): Promise<void> {
        await elasticClient.delete({
            index: indexName,
            id: id as string,
        });
    }
}
