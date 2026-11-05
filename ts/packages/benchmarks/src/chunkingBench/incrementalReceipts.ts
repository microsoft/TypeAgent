// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { appendFile, mkdir, open, rm } from "node:fs/promises";
import path from "node:path";
import { hostname } from "node:os";
import {
    bytesHash,
    digest,
    object,
    readJson,
    saveJson,
} from "../memoryBench/storage.js";

export async function freezeJson(file: string, value: unknown) {
    const saved = await readJson(file);
    if (saved !== undefined) {
        if (digest(saved) !== digest(value))
            throw new Error(
                `Experiment fingerprint drift: ${path.basename(file)}; use a new root`,
            );
        return;
    }

    await saveJson(file, value);
}

export async function withExperimentLock<T>(
    directory: string,
    run: () => Promise<T>,
): Promise<T> {
    await mkdir(directory, { recursive: true });
    const file = path.join(directory, "execution.lock");
    const saved = await readJson(file);
    if (saved !== undefined) {
        const owner = object(saved);
        let alive = true;
        if (owner.host === hostname() && typeof owner.pid === "number") {
            try {
                process.kill(owner.pid, 0);
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code === "ESRCH")
                    alive = false;
            }
        }
        if (alive)
            throw new Error(
                "Experiment is locked by another executor; do not run the same pilot concurrently",
            );
        await rm(file);
    }
    const handle = await open(file, "wx");
    try {
        await handle.writeFile(
            JSON.stringify({ host: hostname(), pid: process.pid }),
        );
        return await run();
    } finally {
        await handle.close();
        await rm(file, { force: true });
    }
}
/** Successful responses and grades are separate immutable files. */
export class PairReceipts {
    constructor(
        readonly directory: string,
        readonly fingerprint: string,
    ) {}
    async read(name: string) {
        const value = await readJson(path.join(this.directory, `${name}.json`));
        if (value === undefined) return undefined;
        const record = object(value);
        if (record.fingerprint !== this.fingerprint)
            throw new Error("Pair receipt fingerprint drift");
        return record;
    }
    async freeze(name: string, value: Record<string, unknown>) {
        await freezeJson(path.join(this.directory, `${name}.json`), {
            fingerprint: this.fingerprint,
            ...value,
        });
    }
    async event(value: Record<string, unknown>) {
        await mkdir(this.directory, { recursive: true });
        await appendFile(
            path.join(this.directory, "operations.jsonl"),
            JSON.stringify({
                ...value,
                fingerprint: this.fingerprint,
                at: new Date().toISOString(),
            }) + "\n",
        );
    }
    async operation<T>(phase: string, run: () => Promise<T>): Promise<T> {
        await this.event({ phase, state: "started" });
        try {
            const result = await run();
            await this.event({ phase, state: "returned" });
            return result;
        } catch (error) {
            await this.event({
                phase,
                state: "error",
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }
    async generate(
        request: Record<string, unknown>,
        execute: () => Promise<unknown>,
        validate: (response: unknown) => void = () => {},
        ordinal = 0,
    ) {
        const name = `judge-${ordinal}-${bytesHash(JSON.stringify(request))}`;
        const saved = await this.read(name);
        if (saved) return saved.response;
        const response = await this.operation("judge-generate", execute);
        try {
            validate(response);
        } catch (error) {
            await this.event({
                phase: "judge-validation",
                state: "invalid-response",
                response,
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
        await this.freeze(name, { response });
        return response;
    }
}
