// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";
import type { RegistryServerEntry } from "./mcpRegistryClient.js";

export interface RegistryCacheData {
    fetchedAt: number;
    updatedSince: string;
    entries: RegistryServerEntry[];
}

export interface RegistryCacheStorage {
    read(): RegistryCacheData | undefined;
    write(data: RegistryCacheData): void;
}

export function createRegistryCacheStorage(
    filePath: string,
): RegistryCacheStorage {
    return {
        read() {
            try {
                return JSON.parse(
                    fs.readFileSync(filePath, "utf8"),
                ) as RegistryCacheData;
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code === "ENOENT") {
                    return undefined;
                }
                throw error;
            }
        },
        write(data) {
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
            try {
                fs.writeFileSync(temp, JSON.stringify(data, null, 2));
                fs.renameSync(temp, filePath);
            } finally {
                fs.rmSync(temp, { force: true });
            }
        },
    };
}

export function mergeRegistryCache(
    previous: RegistryServerEntry[],
    updates: RegistryServerEntry[],
): RegistryServerEntry[] {
    const byKey = new Map(
        previous.map((entry) => [
            `${entry.server.name}\0${entry.server.version}`,
            entry,
        ]),
    );
    for (const entry of updates) {
        const key = `${entry.server.name}\0${entry.server.version}`;
        if (entry.meta.status === "deleted") {
            byKey.delete(key);
        } else {
            if (entry.meta.isLatest) {
                for (const [existingKey, existing] of byKey) {
                    if (
                        existing.server.name === entry.server.name &&
                        existing.meta.isLatest
                    ) {
                        byKey.delete(existingKey);
                    }
                }
            }
            byKey.set(key, entry);
        }
    }
    return [...byKey.values()];
}
