// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AsyncLocalStorage } from "node:async_hooks";

interface Admission<T> {
    item: T;
    resolve: () => void;
    reject: (error: unknown) => void;
}

interface Group<T> {
    pending: Admission<T>[];
    closed: boolean;
    timer?: ReturnType<typeof setTimeout>;
}

export class BoundedIngestionGroup<T> {
    private readonly context = new AsyncLocalStorage<Group<T>>();

    public constructor(
        private readonly dispatch: (items: T[]) => Promise<void>,
    ) {}

    public async run(operation: () => Promise<void>): Promise<void> {
        const group: Group<T> = { pending: [], closed: false };
        await this.context.run(group, async () => {
            try {
                await operation();
            } finally {
                this.flush(group);
            }
        });
    }

    public submit(item: T): Promise<void> {
        const group = this.context.getStore();
        if (!group || group.closed) return this.dispatch([item]);
        return new Promise<void>((resolve, reject) => {
            group.pending.push({ item, resolve, reject });
            if (group.pending.length === 2) this.flush(group);
            else group.timer = setTimeout(() => this.flush(group), 25);
        });
    }

    private flush(group: Group<T>): void {
        if (group.closed) return;
        group.closed = true;
        clearTimeout(group.timer);
        if (!group.pending.length) return;
        const pending = group.pending.splice(0);
        void this.dispatch(pending.map((entry) => entry.item)).then(
            () => pending.forEach((entry) => entry.resolve()),
            (error: unknown) => pending.forEach((entry) => entry.reject(error)),
        );
    }
}
