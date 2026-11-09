// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import {
    lstat,
    mkdir,
    readFile,
    readdir,
    rm,
    writeFile,
} from "node:fs/promises";
import path from "node:path";
import { writeRunbookJson } from "./durableRunbookJson.js";
import type { MemoryEvent } from "./types.js";

interface EventReference {
    sequence: number;
    identity: string;
    sha256: string;
    file: string;
}

interface EventDescriptor {
    eventStorageVersion: 1;
    sequence: number;
    eligibilityRevision: number;
    suppressionHash?: string;
    pendingPurge?: true;
}

interface Suppressions<T> {
    deleted: { sequence: number; identity: string }[];
    records: T[];
}

interface CommittedEvents<T> {
    descriptor: EventDescriptor;
    lookup: Map<string, EventReference>;
    suppressions: T[];
}

const digestPattern = /^[a-f0-9]{64}$/;
const eventFilePattern = /^(\d{16})-([a-f0-9]{64})-([a-f0-9]{64})\.jsonl$/;
const hash = (value: string | Buffer) =>
    createHash("sha256").update(value).digest("hex");
export type EventStorageFaultPoint =
    | "segment-written"
    | "descriptor-prepared"
    | "purge-started"
    | "purge-finished";

export class EventSegmentStore<TSuppression> {
    private descriptor?: EventDescriptor;
    private suppression: Suppressions<TSuppression> = {
        deleted: [],
        records: [],
    };
    private lookup = new Map<string, EventReference>();
    private tail = Promise.resolve();
    private committed?: CommittedEvents<TSuppression>;
    private readonly directory: string;

    public constructor(
        private readonly file: string,
        private readonly purgeIndexes: () => Promise<void>,
        private readonly checkpoint?: (
            point: EventStorageFaultPoint,
        ) => Promise<void>,
    ) {
        this.directory = path.join(path.dirname(file), "event-segments");
    }

    private async access<T>(operation: () => Promise<T>): Promise<T> {
        const result = this.tail.then(async () => {
            const result = await operation();
            if (this.descriptor && !this.descriptor.pendingPurge)
                this.committed = {
                    descriptor: { ...this.descriptor },
                    lookup: this.lookup,
                    suppressions: this.suppression.records,
                };
            return result;
        });
        this.tail = result.then(
            () => {},
            () => {},
        );
        return result;
    }

    private async files(): Promise<string[]> {
        try {
            return await readdir(this.directory);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
            throw error;
        }
    }

    private async readBlob(file: string, sha256: string): Promise<unknown> {
        const full = path.join(this.directory, file);
        const info = await lstat(full);
        if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1)
            throw new Error("Unsafe canonical event segment");
        const bytes = await readFile(full);
        if (hash(bytes) !== sha256)
            throw new Error("Corrupt canonical event segment");
        return JSON.parse(bytes.toString("utf8"));
    }

    private validateDescriptor(
        value: unknown,
    ): asserts value is EventDescriptor {
        if (
            !value ||
            typeof value !== "object" ||
            !("eventStorageVersion" in value) ||
            value.eventStorageVersion !== 1
        )
            throw new Error(
                "Unsupported canonical event store; reset/reimport explicitly (no automatic migration)",
            );
        if (
            !("sequence" in value) ||
            !Number.isSafeInteger(value.sequence) ||
            Number(value.sequence) < 0 ||
            !("eligibilityRevision" in value) ||
            !Number.isSafeInteger(value.eligibilityRevision) ||
            Number(value.eligibilityRevision) < 0 ||
            ("pendingPurge" in value && value.pendingPurge !== true) ||
            ("suppressionHash" in value &&
                (typeof value.suppressionHash !== "string" ||
                    !digestPattern.test(value.suppressionHash)))
        )
            throw new Error("Invalid canonical event descriptor");
    }

    private validateSuppressions(
        value: unknown,
        sequence: number,
    ): asserts value is Suppressions<TSuppression> {
        if (
            !value ||
            typeof value !== "object" ||
            !("records" in value) ||
            !Array.isArray(value.records) ||
            !("deleted" in value) ||
            !Array.isArray(value.deleted)
        )
            throw new Error("Invalid canonical event suppressions");
        const sequences = new Set<number>();
        const identities = new Set<string>();
        for (const entry of value.deleted) {
            if (
                !entry ||
                typeof entry !== "object" ||
                !Number.isSafeInteger(entry.sequence) ||
                entry.sequence < 1 ||
                entry.sequence > sequence ||
                sequences.has(entry.sequence) ||
                typeof entry.identity !== "string" ||
                !digestPattern.test(entry.identity) ||
                identities.has(entry.identity)
            )
                throw new Error("Invalid canonical event tombstone");
            sequences.add(entry.sequence);
            identities.add(entry.identity);
        }
    }

    private async rebuildLookup(descriptor: EventDescriptor): Promise<void> {
        const deleted = new Set(
            this.suppression.deleted.map((entry) => entry.sequence),
        );
        const sequences = new Set<number>();
        this.lookup.clear();
        for (const file of await this.files()) {
            const match = eventFilePattern.exec(file);
            if (!match) {
                if (!/^suppression-[a-f0-9]{64}\.json$/.test(file))
                    throw new Error("Unexpected canonical event segment file");
                continue;
            }
            const sequence = Number(match[1]);
            if (!Number.isSafeInteger(sequence) || sequence < 1)
                throw new Error("Invalid event segment sequence");
            if (sequence > descriptor.sequence || deleted.has(sequence))
                continue;
            if (sequences.has(sequence) || this.lookup.has(match[2]))
                throw new Error("Duplicate canonical event segment");
            sequences.add(sequence);
            this.lookup.set(match[2], {
                sequence,
                identity: match[2],
                sha256: match[3],
                file,
            });
        }
        if (sequences.size !== descriptor.sequence - deleted.size)
            throw new Error("Missing committed canonical event segment");
    }

    private async load(): Promise<EventDescriptor> {
        if (!this.descriptor) {
            let value: unknown;
            try {
                value = JSON.parse(await readFile(this.file, "utf8"));
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
                    if (error instanceof SyntaxError)
                        throw new Error(
                            "Incompatible canonical event store; reset/reimport explicitly (no automatic migration)",
                        );
                    throw error;
                }
                value = {
                    eventStorageVersion: 1,
                    sequence: 0,
                    eligibilityRevision: 0,
                };
            }
            this.validateDescriptor(value);
            if (value.suppressionHash) {
                const suppression = await this.readBlob(
                    `suppression-${value.suppressionHash}.json`,
                    value.suppressionHash,
                );
                this.validateSuppressions(suppression, value.sequence);
                this.suppression = suppression;
            }
            await this.rebuildLookup(value);
            this.descriptor = value;
            if (!value.pendingPurge) await this.collect(value);
        }
        if (this.descriptor.pendingPurge)
            await this.finishPurge(this.descriptor);
        return this.descriptor;
    }

    private async publish(value: EventDescriptor): Promise<void> {
        await this.checkpoint?.("descriptor-prepared");
        await writeRunbookJson(this.file, `${JSON.stringify(value)}\n`);
        this.descriptor = value;
    }

    private async collect(descriptor: EventDescriptor): Promise<void> {
        const retained = new Set(
            [...this.lookup.values()].map((reference) => reference.file),
        );
        if (descriptor.suppressionHash)
            retained.add(`suppression-${descriptor.suppressionHash}.json`);
        for (const file of await this.files()) {
            if (
                !eventFilePattern.test(file) &&
                !/^suppression-[a-f0-9]{64}\.json$/.test(file)
            )
                throw new Error("Unexpected canonical event segment file");
            if (!retained.has(file)) await rm(path.join(this.directory, file));
        }
    }

    private async finishPurge(value: EventDescriptor): Promise<void> {
        await this.checkpoint?.("purge-started");
        await this.purgeIndexes();
        await this.collect(value);
        await this.checkpoint?.("purge-finished");
        const ready = { ...value };
        delete ready.pendingPurge;
        await this.publish(ready);
    }

    private async read(reference: EventReference): Promise<MemoryEvent> {
        const value = await this.readBlob(reference.file, reference.sha256);
        if (
            !value ||
            typeof value !== "object" ||
            !("eventId" in value) ||
            typeof value.eventId !== "string" ||
            hash(value.eventId) !== reference.identity
        )
            throw new Error("Canonical event identity mismatch");
        return value as MemoryEvent;
    }

    public recover(): Promise<void> {
        if (this.committed && !this.descriptor?.pendingPurge)
            return Promise.resolve();
        return this.access(async () => {
            await this.load();
        });
    }

    private async readCommitted<T>(
        operation: (snapshot: CommittedEvents<TSuppression>) => Promise<T>,
    ): Promise<T> {
        if (!this.committed || this.descriptor?.pendingPurge)
            await this.recover();
        const snapshot = this.committed;
        if (!snapshot)
            throw new Error("Canonical event recovery is incomplete");
        const assertReadable = () => {
            if (
                this.descriptor?.pendingPurge ||
                this.descriptor?.eligibilityRevision !==
                    snapshot.descriptor.eligibilityRevision
            )
                throw new Error(
                    "Canonical event eligibility changed; retry after purge recovery",
                );
        };
        assertReadable();
        const result = await operation(snapshot);
        assertReadable();
        return result;
    }

    public get(eventId: string): Promise<MemoryEvent | undefined> {
        return this.readCommitted(async (snapshot) => {
            const reference = snapshot.lookup.get(hash(eventId));
            return reference &&
                reference.sequence <= snapshot.descriptor.sequence
                ? this.read(reference)
                : undefined;
        });
    }

    public records(): Promise<{
        events: MemoryEvent[];
        suppressions: TSuppression[];
    }> {
        return this.readCommitted(async (snapshot) => {
            const events: MemoryEvent[] = [];
            // Appends share immutable references; the captured descriptor
            // bounds visibility without copying the entire lookup on each write.
            for (const reference of [...snapshot.lookup.values()]
                .filter(
                    (reference) =>
                        reference.sequence <= snapshot.descriptor.sequence,
                )
                .sort((a, b) => a.sequence - b.sequence))
                events.push(await this.read(reference));
            return {
                events,
                suppressions: structuredClone(snapshot.suppressions),
            };
        });
    }

    public version(): Promise<{
        sequence: number;
        eligibilityRevision: number;
    }> {
        return this.readCommitted(async ({ descriptor: value }) => {
            return {
                sequence: value.sequence,
                eligibilityRevision: value.eligibilityRevision,
            };
        });
    }

    public suppressions(): Promise<TSuppression[]> {
        return this.readCommitted(async (snapshot) => {
            return structuredClone(snapshot.suppressions);
        });
    }

    public sequenceFor(eventId: string): number {
        return this.lookup.get(hash(eventId))?.sequence ?? 0;
    }

    public append(event: MemoryEvent): Promise<void> {
        return this.access(async () => {
            const current = await this.load();
            const identity = hash(event.eventId);
            if (
                this.lookup.has(identity) ||
                this.suppression.deleted.some(
                    (entry) => entry.identity === identity,
                )
            )
                throw new Error("Duplicate canonical event identity");
            const bytes = `${JSON.stringify(event)}\n`;
            const sha256 = hash(bytes);
            const sequence = current.sequence + 1;
            if (!Number.isSafeInteger(sequence))
                throw new Error("Canonical event sequence exhausted");
            const file = `${String(sequence).padStart(16, "0")}-${identity}-${sha256}.jsonl`;
            await mkdir(this.directory, { recursive: true });
            await writeFile(path.join(this.directory, file), bytes, {
                flag: "wx",
            });
            let committed = false;
            try {
                await this.checkpoint?.("segment-written");
                await this.publish({ ...current, sequence });
                committed = true;
                this.lookup.set(identity, { sequence, identity, sha256, file });
            } finally {
                if (!committed)
                    await rm(path.join(this.directory, file), { force: true });
            }
        });
    }

    public replace(
        events: MemoryEvent[],
        suppressions: TSuppression[],
    ): Promise<void> {
        return this.access(async () => {
            const current = await this.load();
            const ids = new Set(events.map((event) => hash(event.eventId)));
            if (
                ids.size !== events.length ||
                events.some((event) => !this.lookup.has(hash(event.eventId)))
            )
                throw new Error(
                    "Event compaction may only retain existing immutable events",
                );
            const deleted = [...this.lookup.values()].filter(
                (reference) => !ids.has(reference.identity),
            );
            const suppression: Suppressions<TSuppression> = {
                deleted: [
                    ...this.suppression.deleted,
                    ...deleted.map(({ sequence, identity }) => ({
                        sequence,
                        identity,
                    })),
                ],
                records: structuredClone(suppressions),
            };
            const bytes = `${JSON.stringify(suppression)}\n`;
            const suppressionHash = hash(bytes);
            await mkdir(this.directory, { recursive: true });
            const blob = path.join(
                this.directory,
                `suppression-${suppressionHash}.json`,
            );
            try {
                await writeFile(blob, bytes, { flag: "wx" });
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "EEXIST")
                    throw error;
                await this.readBlob(path.basename(blob), suppressionHash);
            }
            const next: EventDescriptor = {
                ...current,
                eligibilityRevision: current.eligibilityRevision + 1,
                suppressionHash,
                pendingPurge: true,
            };
            if (!Number.isSafeInteger(next.eligibilityRevision))
                throw new Error(
                    "Canonical event eligibility revision exhausted",
                );
            await this.publish(next);
            this.suppression = suppression;
            for (const reference of deleted)
                this.lookup.delete(reference.identity);
            await this.finishPurge(next);
        });
    }
}
