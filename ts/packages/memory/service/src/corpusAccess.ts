// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export class CorpusAccess {
    private writeTail: Promise<void> = Promise.resolve();
    private readonly readers = new Set<Promise<void>>();

    public read<T>(operation: () => Promise<T>): Promise<T> {
        const result = this.writeTail.then(operation);
        const settled = result.then(
            () => undefined,
            () => undefined,
        );
        this.readers.add(settled);
        void settled.then(() => this.readers.delete(settled));
        return result;
    }

    public write<T>(operation: () => Promise<T>): Promise<T> {
        // Later readers wait behind this writer, so sustained reads cannot starve it.
        const result = Promise.all([this.writeTail, ...this.readers]).then(
            operation,
        );
        this.writeTail = result.then(
            () => undefined,
            () => undefined,
        );
        return result;
    }

    public async idle(): Promise<void> {
        await Promise.all([this.writeTail, ...this.readers]);
    }
}
