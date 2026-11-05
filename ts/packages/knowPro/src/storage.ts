// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Batch } from "./common.js";
import {
    SemanticRef,
    SemanticRefOrdinal,
    IMessage,
    MessageOrdinal,
    ICollection,
    IStorageProvider,
    IMessageCollection,
    ISemanticRefCollection,
    IReadonlyCollection,
    JsonSerializer,
    SemanticRefMetadata,
} from "./interfaces.js";
import { timeSearchStage } from "./searchTiming.js";

export class Collection<T, TOrdinal extends number>
    implements ICollection<T, TOrdinal>
{
    protected items: T[];

    constructor(items?: T[] | undefined) {
        this.items = items ?? [];
    }

    public get isPersistent(): boolean {
        return false;
    }

    public get length(): number {
        return this.items.length;
    }

    public get(ordinal: TOrdinal): T {
        return this.items[ordinal];
    }

    public getSlice(start: TOrdinal, end: TOrdinal): T[] {
        return this.items.slice(start, end);
    }

    public getMultiple(ordinals: TOrdinal[]): T[] {
        const items = new Array<T>(ordinals.length);
        for (let i = 0; i < ordinals.length; ++i) {
            items[i] = this.get(ordinals[i]);
        }
        return items;
    }

    public getAll(): T[] {
        return this.items;
    }

    public append(...items: T[]): void {
        for (const item of items) {
            this.items.push(item);
        }
    }

    public [Symbol.iterator](): Iterator<T, any, any> {
        return this.items[Symbol.iterator]();
    }
}

export class SemanticRefCollection
    extends Collection<SemanticRef, SemanticRefOrdinal>
    implements ISemanticRefCollection
{
    constructor(semanticRefs?: SemanticRef[]) {
        super(semanticRefs);
    }

    public getMetadataMultiple(
        ordinals: SemanticRefOrdinal[],
    ): SemanticRefMetadata[] {
        return ordinals.map((ordinal) => {
            validateSemanticRefOrdinal(this, ordinal);
            const { semanticRefOrdinal, range, knowledgeType } =
                this.items[ordinal];
            return { semanticRefOrdinal, range, knowledgeType };
        });
    }
}

export function validateSemanticRefOrdinal(
    collection: ISemanticRefCollection,
    ordinal: number,
): void {
    if (
        !Number.isSafeInteger(ordinal) ||
        ordinal < 0 ||
        ordinal >= collection.length
    )
        throw new Error(
            `Ordinal ${ordinal} not found. Collection length is ${collection.length}`,
        );
}

export function* getSemanticRefMetadata(
    collection: ISemanticRefCollection,
    ordinals: SemanticRefOrdinal[],
): IterableIterator<SemanticRefMetadata> {
    for (let start = 0; start < ordinals.length; start += 128) {
        const batch = ordinals.slice(start, start + 128);
        for (const ordinal of batch)
            if (!Number.isSafeInteger(ordinal) || ordinal < 0)
                throw new Error(
                    `Invalid semantic-reference ordinal ${ordinal}`,
                );
        if (!collection.getMetadataMultiple)
            batch.forEach((ordinal) =>
                validateSemanticRefOrdinal(collection, ordinal),
            );
        const records = timeSearchStage(
            collection.getMetadataMultiple
                ? "query.metadata.read"
                : "query.knowledge.read",
            () =>
                collection.getMetadataMultiple
                    ? collection.getMetadataMultiple(batch)
                    : collection
                          .getMultiple(batch)
                          .map(
                              ({
                                  semanticRefOrdinal,
                                  range,
                                  knowledgeType,
                              }) => ({
                                  semanticRefOrdinal,
                                  range,
                                  knowledgeType,
                              }),
                          ),
            {
                items: batch.length,
                fullHydrations: collection.getMetadataMultiple
                    ? 0
                    : batch.length,
            },
        );
        if (
            records.length !== batch.length ||
            records.some(
                (record, index) => record?.semanticRefOrdinal !== batch[index],
            )
        )
            throw new Error("Semantic-reference metadata is not positional");
        yield* records;
    }
}

export class MessageCollection<TMessage extends IMessage = IMessage>
    extends Collection<TMessage, MessageOrdinal>
    implements IMessageCollection<TMessage>
{
    constructor(messages?: TMessage[]) {
        super(messages);
    }
}

export class MemoryStorageProvider implements IStorageProvider {
    constructor() {}

    public createMessageCollection<TMessage extends IMessage = IMessage>(
        serializer?: JsonSerializer<TMessage>,
    ): IMessageCollection<TMessage> {
        return new MessageCollection<TMessage>();
    }

    public createSemanticRefCollection(): ISemanticRefCollection {
        return new SemanticRefCollection();
    }

    public close(): void {}
}

export function* getBatchesFromCollection<T = any>(
    collection: IReadonlyCollection<T>,
    startAtOrdinal: number,
    batchSize: number,
): IterableIterator<Batch<T>> {
    let startAt = startAtOrdinal;
    while (true) {
        const batch = collection.getSlice(startAt, startAt + batchSize);
        if (batch.length === 0) {
            break;
        }
        yield { startAt, value: batch };
        startAt += batchSize;
    }
}

export function mapCollection<T = any>(
    collection: IReadonlyCollection<T>,
    callback: (item: T, index: number) => T,
) {
    const results: T[] = [];
    const length = collection.length;
    for (let i = 0; i < length; ++i) {
        results.push(callback(collection.get(i), i));
    }
    return results;
}

export function filterCollection<T = any>(
    collection: IReadonlyCollection<T>,
    predicate: (item: T, index: number) => boolean,
) {
    const results: T[] = [];
    const length = collection.length;
    for (let i = 0; i < length; ++i) {
        const item = collection.get(i);
        if (predicate(item, i)) {
            results.push(item);
        }
    }
    return results;
}
