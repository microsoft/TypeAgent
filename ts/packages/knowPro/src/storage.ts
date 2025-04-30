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
} from "./interfaces.js";

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

    public createMessageCollection<
        TMessage extends IMessage = IMessage,
    >(): IMessageCollection<TMessage> {
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
        let batch = collection.getSlice(startAt, startAt + batchSize);
        if (batch.length === 0) {
            break;
        }
        yield { startAt, value: batch };
        startAt += batchSize;
    }
}
