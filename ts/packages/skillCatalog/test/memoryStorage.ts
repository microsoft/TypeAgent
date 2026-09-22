// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { InstanceStorage } from "../src/index.js";

export class MemoryStorage implements InstanceStorage {
    public readonly values = new Map<string, Uint8Array>();
    public failWritesContaining: string | undefined;

    public async read(path: string): Promise<Uint8Array>;
    public async read(
        path: string,
        encoding: "utf8" | "base64",
    ): Promise<string>;
    public async read(
        path: string,
        encoding?: "utf8" | "base64",
    ): Promise<Uint8Array | string> {
        const value = this.values.get(path);
        if (value === undefined) {
            throw new Error(`Not found: ${path}`);
        }
        if (encoding === "utf8") {
            return new TextDecoder().decode(value);
        }
        if (encoding === "base64") {
            return Buffer.from(value).toString("base64");
        }
        return value.slice();
    }

    public async write(
        path: string,
        data: string,
        encoding?: "utf8" | "base64",
    ): Promise<void>;
    public async write(path: string, data: Uint8Array): Promise<void>;
    public async write(
        path: string,
        data: string | Uint8Array,
        encoding: "utf8" | "base64" = "utf8",
    ): Promise<void> {
        if (
            this.failWritesContaining !== undefined &&
            path.includes(this.failWritesContaining)
        ) {
            throw new Error("Injected write failure");
        }
        const bytes =
            typeof data === "string"
                ? encoding === "base64"
                    ? Buffer.from(data, "base64")
                    : new TextEncoder().encode(data)
                : data;
        this.values.set(path, bytes.slice());
    }

    public async list(
        path: string,
        options?: { dirs?: boolean; fullPath?: boolean },
    ): Promise<string[]> {
        const prefix = `${path.replace(/\/+$/, "")}/`;
        const names = new Set<string>();
        for (const key of this.values.keys()) {
            if (!key.startsWith(prefix)) {
                continue;
            }
            const remainder = key.slice(prefix.length);
            const name = remainder.split("/")[0];
            if (options?.dirs !== true || remainder.includes("/")) {
                names.add(
                    options?.fullPath === true ? `${prefix}${name}` : name,
                );
            }
        }
        return [...names];
    }

    public async exists(path: string): Promise<boolean> {
        return (
            this.values.has(path) ||
            [...this.values.keys()].some((key) => key.startsWith(`${path}/`))
        );
    }

    public async delete(path: string): Promise<void> {
        this.values.delete(path);
        for (const key of [...this.values.keys()]) {
            if (key.startsWith(`${path}/`)) {
                this.values.delete(key);
            }
        }
    }
}
