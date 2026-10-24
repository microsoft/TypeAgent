// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AsyncLocalStorage } from "node:async_hooks";
import { CorpusAccess, withCorpusAccessPriority } from "../src/corpusAccess.js";

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((finish) => {
        resolve = finish;
    });
    return { promise, resolve };
}

test("an aged maintenance writer stops new interactive readers until admitted readers finish", async () => {
    const access = new CorpusAccess();
    const holder = deferred();
    const readers = deferred();
    const events: string[] = [];
    const running = access.write(() => holder.promise);
    const maintenance = withCorpusAccessPriority("maintenance", () =>
        access.write(async () => {
            events.push("maintenance");
        }),
    );
    const requests = Array.from({ length: 24 }, () =>
        access.read(async () => {
            events.push("read");
            await readers.promise;
        }),
    );
    holder.resolve();
    await running;
    await new Promise((resolve) => setImmediate(resolve));
    expect(events).toEqual(Array(8).fill("read"));
    const later = access.read(async () => {
        events.push("later-read");
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(events).toHaveLength(8);
    readers.resolve();
    await Promise.all([...requests, running, maintenance, later]);
    expect(events.indexOf("maintenance")).toBe(8);
    await access.idle();
});

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

test("pending UI reads and writes overtake ingestion and maintenance, without preempting a holder", async () => {
    const access = new CorpusAccess();
    const holder = deferred();
    const events: string[] = [];
    const running = withCorpusAccessPriority("maintenance", () =>
        access.write(async () => {
            events.push("holder");
            await holder.promise;
        }),
    );
    const background = withCorpusAccessPriority("maintenance", () =>
        access.write(async () => {
            events.push("maintenance");
        }),
    );
    const ingestion = withCorpusAccessPriority("ingestion", () =>
        access.write(async () => {
            events.push("ingestion");
        }),
    );
    const read = access.read(async () => {
        events.push("ui-read");
    });
    const edit = access.write(async () => {
        events.push("ui-write");
    });
    await Promise.resolve();
    expect(events).toEqual(["holder"]);
    holder.resolve();
    await Promise.all([
        running,
        background,
        ingestion,
        read,
        edit,
        access.idle(),
    ]);
    expect(events).toEqual([
        "holder",
        "ui-read",
        "ui-write",
        "ingestion",
        "maintenance",
    ]);
});

test("aging serves ingestion and maintenance during continuous UI arrivals", async () => {
    const access = new CorpusAccess();
    const holder = deferred();
    const running = access.write(() => holder.promise);
    const events: string[] = [];
    const work: Promise<void>[] = [];
    let uiCount = 0;
    const enqueueUi = () => {
        work.push(
            access.write(async () => {
                events.push("ui");
                if (++uiCount < 40) enqueueUi();
            }),
        );
    };
    enqueueUi();
    work.push(
        withCorpusAccessPriority("ingestion", () =>
            access.write(async () => {
                events.push("ingestion");
            }),
        ),
    );
    work.push(
        withCorpusAccessPriority("maintenance", () =>
            access.write(async () => {
                events.push("maintenance");
            }),
        ),
    );
    holder.resolve();
    await running;
    await access.idle();
    await Promise.all(work);
    expect(uiCount).toBe(40);
    expect(events.indexOf("ingestion")).toBeLessThanOrEqual(10);
    expect(events.indexOf("maintenance")).toBeLessThanOrEqual(10);
    expect(events.slice(0, 8)).toEqual(Array(8).fill("ui"));
});

test("critical removal overtakes queued UI work and readers recheck the fence", async () => {
    let denied = false;
    const access = new CorpusAccess(() => {
        if (denied) throw new Error("Removal pending");
    });
    const holder = deferred();
    const running = access.write(() => holder.promise);
    const read = access.read(async () => "private");
    const rejected = expect(read).rejects.toThrow("Removal pending");
    const removal = withCorpusAccessPriority("critical", () =>
        access.write(async () => {
            denied = true;
        }),
    );
    holder.resolve();
    await Promise.all([running, removal, rejected, access.idle()]);
});

test("admission preserves the submitter's async context, not the releasing holder's", async () => {
    const context = new AsyncLocalStorage<string>();
    const access = new CorpusAccess();
    const holder = deferred();
    const running = context.run("background", () =>
        withCorpusAccessPriority("maintenance", () =>
            access.write(() => holder.promise),
        ),
    );
    const read = context.run("interactive-request", () =>
        access.read(async () => context.getStore()),
    );
    holder.resolve();
    await running;
    await expect(read).resolves.toBe("interactive-request");
    await access.idle();
});
