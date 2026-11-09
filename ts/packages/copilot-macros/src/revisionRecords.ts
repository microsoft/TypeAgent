// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createRequire } from "node:module";

export async function withRecordLock<T>(
    file: string,
    operation: () => Promise<T>,
): Promise<T> {
    await mkdir(path.dirname(file), { recursive: true });
    // SQLite's OS locks are released on owner death, unlike a sentinel file.
    const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
        DatabaseSync: new (file: string) => {
            exec(sql: string): void;
            close(): void;
        };
    };
    const database = new DatabaseSync(`${file}.owner.sqlite`);
    try {
        for (let attempt = 0; ; attempt++) {
            try {
                database.exec("BEGIN IMMEDIATE");
                break;
            } catch (error) {
                if (
                    typeof error !== "object" ||
                    error === null ||
                    !("message" in error) ||
                    !String(error.message).includes("locked") ||
                    attempt === 200
                )
                    throw error;
                await delay(25);
            }
        }
        try {
            const result = await operation();
            database.exec("COMMIT");
            return result;
        } catch (error) {
            database.exec("ROLLBACK");
            throw error;
        }
    } finally {
        database.close();
    }
}

export async function publishImmutable(
    destination: string,
    bytes: string,
): Promise<void> {
    await mkdir(path.dirname(destination), { recursive: true });
    const staging = `${destination}.${randomUUID()}.tmp`;
    try {
        await writeFile(staging, bytes, { flag: "wx", flush: true });
        await link(staging, destination);
    } finally {
        await rm(staging, { force: true });
    }
}

interface Publication {
    schemaVersion: 2;
    revision: string;
    records: Record<string, string>;
}

export async function publishJson(destination: string, value: unknown) {
    await mkdir(path.dirname(destination), { recursive: true });
    const temporary = `${destination}.${randomUUID()}.tmp`;
    try {
        await writeFile(temporary, JSON.stringify(value), {
            flag: "wx",
            flush: true,
        });
        await rename(temporary, destination);
    } finally {
        await rm(temporary, { force: true });
    }
}

/** Payloads are immutable; only the small record-to-revision map is replaced. */
export class RevisionRecords {
    private publication?: Publication;
    private readonly sizes = new Map<string, number>();

    constructor(private readonly file: string) {}

    private payloadPath(digest: string) {
        return path.join(`${this.file}.records`, `${digest}.json`);
    }

    async load(): Promise<Map<string, unknown>> {
        return withRecordLock(this.file, () => this.loadLocked());
    }

    private async loadLocked(): Promise<Map<string, unknown>> {
        let publication: Publication;
        try {
            publication = JSON.parse(await readFile(this.file, "utf8"));
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            publication = { schemaVersion: 2, revision: "", records: {} };
        }
        if (
            publication.schemaVersion !== 2 ||
            typeof publication.revision !== "string" ||
            !publication.records ||
            typeof publication.records !== "object" ||
            Array.isArray(publication.records) ||
            Object.values(publication.records).some(
                (digest) => !/^[a-f0-9]{64}$/.test(digest),
            )
        )
            throw new Error(
                `Incompatible canonical macro store: ${this.file}. Explicitly reset/reimport this development store; it was not deleted.`,
            );
        const entries = await Promise.all(
            Object.entries(publication.records).map(async ([id, digest]) => {
                const bytes = await readFile(this.payloadPath(digest), "utf8");
                this.sizes.set(digest, Buffer.byteLength(bytes));
                if (createHash("sha256").update(bytes).digest("hex") !== digest)
                    throw new Error("Immutable macro record digest mismatch.");
                return [id, JSON.parse(bytes)] as const;
            }),
        );
        this.publication = publication;
        this.assertSize(publication.records);
        return new Map(entries);
    }

    private assertSize(records: Record<string, string>): void {
        const bytes = Object.values(records).reduce(
            (total, digest) => total + this.sizes.get(digest)!,
            0,
        );
        if (bytes > 16 * 1024 * 1024)
            throw new Error("Durable macro storage exceeds its 16 MiB limit.");
    }

    async commit(changes: Map<string, unknown | undefined>): Promise<void> {
        if (!this.publication) await this.load();
        await withRecordLock(this.file, () => this.commitLocked(changes));
    }

    private async commitLocked(
        changes: Map<string, unknown | undefined>,
    ): Promise<void> {
        const previous = this.publication!;
        let revision = "";
        try {
            revision = JSON.parse(await readFile(this.file, "utf8")).revision;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        if (revision !== previous.revision)
            throw new Error(
                "Macro record publication revision changed; reopen the owner before retrying.",
            );
        const records = { ...previous.records };
        for (const [id, value] of changes) {
            if (value === undefined) {
                delete records[id];
                continue;
            }
            const bytes = JSON.stringify(value);
            if (Buffer.byteLength(bytes) > 16 * 1024 * 1024)
                throw new Error(
                    "Durable macro record exceeds its 16 MiB limit.",
                );
            const digest = createHash("sha256").update(bytes).digest("hex");
            this.sizes.set(digest, Buffer.byteLength(bytes));
            if (records[id] === digest) continue;
            await mkdir(`${this.file}.records`, { recursive: true });
            try {
                await publishImmutable(this.payloadPath(digest), bytes);
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "EEXIST")
                    throw error;
                if (
                    (await readFile(this.payloadPath(digest), "utf8")) !== bytes
                )
                    throw new Error("Immutable macro record collision.");
            }
            records[id] = digest;
        }
        if (
            Object.keys(records).length ===
                Object.keys(previous.records).length &&
            Object.entries(records).every(
                ([id, value]) => previous.records[id] === value,
            )
        )
            return;
        const next: Publication = {
            schemaVersion: 2,
            revision: randomUUID(),
            records,
        };
        this.assertSize(records);
        await publishJson(this.file, next);
        this.publication = next;
    }

    /** Called only after publication, never while readers can select old payloads. */
    async purgeUnreferenced(): Promise<void> {
        await withRecordLock(this.file, async () => {
            const current = new RevisionRecords(this.file);
            await current.loadLocked();
            await current.purgeLocked();
        });
    }

    private async purgeLocked(): Promise<void> {
        const { readdir } = await import("node:fs/promises");
        const retained = new Set(Object.values(this.publication!.records));
        const directory = `${this.file}.records`;
        const files = await readdir(directory).catch(
            (error: NodeJS.ErrnoException) => {
                if (error.code === "ENOENT") return [];
                throw error;
            },
        );
        await Promise.all(
            files
                .filter(
                    (file) =>
                        /^[a-f0-9]{64}\.json(?:\.[a-f0-9-]+\.tmp)?$/.test(
                            file,
                        ) &&
                        (file.endsWith(".tmp") ||
                            !retained.has(file.slice(0, -5))),
                )
                .map((file) => rm(path.join(directory, file), { force: true })),
        );
    }
}
