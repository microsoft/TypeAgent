// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CorpusAccess } from "../src/corpusAccess.js";

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((finish) => {
        resolve = finish;
    });
    return { promise, resolve };
}

test("readers overlap, writers are exclusive, and later readers cannot overtake a writer", async () => {
    const access = new CorpusAccess();
    const first = deferred();
    const second = deferred();
    const writer = deferred();
    const writerEntered = deferred();
    const events: string[] = [];
    const readOne = access.read(async () => {
        events.push("read-one");
        await first.promise;
    });
    const readTwo = access.read(async () => {
        events.push("read-two");
        await second.promise;
    });
    const write = access.write(async () => {
        events.push("write");
        writerEntered.resolve();
        await writer.promise;
    });
    const laterRead = access.read(async () => {
        events.push("later-read");
    });
    try {
        await Promise.resolve();
        expect(events).toEqual(["read-one", "read-two"]);
        first.resolve();
        await readOne;
        expect(events).toEqual(["read-one", "read-two"]);
        second.resolve();
        await readTwo;
        await writerEntered.promise;
        expect(events).toEqual(["read-one", "read-two", "write"]);
        writer.resolve();
        await Promise.all([write, laterRead, access.idle()]);
        expect(events).toEqual(["read-one", "read-two", "write", "later-read"]);
    } finally {
        first.resolve();
        second.resolve();
        writer.resolve();
        await access.idle();
    }
});

test("failed reads and writes release their reservations", async () => {
    const access = new CorpusAccess();
    const read = access.read(async () => {
        throw new Error("Read failed");
    });
    const write = access.write(async () => {
        throw new Error("Write failed");
    });
    const laterRead = access.read(async () => "retained");
    await expect(read).rejects.toThrow("Read failed");
    await expect(write).rejects.toThrow("Write failed");
    await expect(laterRead).resolves.toBe("retained");
    await access.idle();
});
