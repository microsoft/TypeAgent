// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
export interface KeyValueIndex<TKeyId = any, TValueId = any> {
    get(id: TKeyId): Promise<TValueId[] | undefined>;
    getMultiple(ids: TKeyId[], concurrency?: number): Promise<TValueId[][]>;
    put(postings: TValueId[], id?: TKeyId): Promise<TKeyId>;
    replace(postings: TValueId[], id: TKeyId): Promise<TKeyId>;
    remove(id: TKeyId): Promise<void>;
}
