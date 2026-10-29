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

test("reads queued before authorization recheck denial after the writer commits", async () => {
    let denied = false;
    const access = new CorpusAccess(() => {
        if (denied) throw new Error("Authorized removal pending");
    });
    const write = access.write(async () => {
        denied = true;
    });
    const operation = import.meta.jest.fn(async () => "private content");
    const queuedRead = access.read(operation);
    await write;
    await expect(queuedRead).rejects.toThrow("Authorized removal pending");
    expect(operation).not.toHaveBeenCalled();
    await access.write(async () => {
        denied = false;
    });
    await expect(access.read(async () => "eligible survivors")).resolves.toBe(
        "eligible survivors",
    );
});

test("committed reads overtake held and queued writers without exposing pending state", async () => {
    let live = "original";
    let committed = live;
    const entered = deferred();
    const release = deferred();
    const access = new CorpusAccess(undefined, {
        read: async (operation) => operation(),
        publish: async () => {
            committed = live;
        },
    });
    const first = access.write(async () => {
        live = "first";
        entered.resolve();
        await release.promise;
    });
    await entered.promise;
    const second = access.write(async () => {
        live = "second";
    });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
        const value = await Promise.race([
            access.read(async () => committed),
            new Promise<never>((_, reject) => {
                timeout = setTimeout(
                    () => reject(new Error("Read waited behind a writer")),
                    1000,
                );
            }),
        ]);
        expect(value).toBe("original");
        expect(live).toBe("first");
    } finally {
        clearTimeout(timeout);
        release.resolve();
        await Promise.all([first, second]);
        await access.idle();
    }
    expect(await access.read(async () => committed)).toBe("second");
});

test("failed writers do not publish their mutable state", async () => {
    let committed = "original";
    const access = new CorpusAccess(undefined, {
        read: async (operation) => operation(),
        publish: async () => {
            committed = "pending";
        },
    });
    await expect(
        access.write(async () => {
            throw new Error("Write failed");
        }),
    ).rejects.toThrow("Write failed");
    expect(await access.read(async () => committed)).toBe("original");
    await access.idle();
});

test("writers do not await committed readers and shutdown still drains them", async () => {
    const entered = deferred();
    const release = deferred();
    const access = new CorpusAccess(undefined, {
        read: async (operation) => operation(),
        publish: async () => {},
    });
    const read = access.read(async () => {
        entered.resolve();
        await release.promise;
    });
    await entered.promise;
    let published = false;
    try {
        await access.write(async () => {
            published = true;
        });
        expect(published).toBe(true);
        let idle = false;
        const draining = access.idle().then(() => {
            idle = true;
        });
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(idle).toBe(false);
        release.resolve();
        await Promise.all([read, draining]);
    } finally {
        release.resolve();
        await access.idle();
    }
});
