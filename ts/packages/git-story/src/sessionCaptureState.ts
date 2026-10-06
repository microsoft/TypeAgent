// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { SessionCaptureCheckpoint } from "./sessionWatcher.js";

export type CaptureState = {
    version: 1;
    checkpoint: SessionCaptureCheckpoint;
    generation: string;
    fileIdentity: string;
    observedSize: number;
    prefixDigest: string;
    generatedIds: Record<string, string>;
};

export function byteOffset(value: string): number {
    const offset = Number(value);
    if (!/^(0|[1-9]\d*)$/.test(value) || !Number.isSafeInteger(offset)) {
        throw new Error("Capture byte offset must be a safe decimal integer");
    }
    return offset;
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isState(value: unknown): value is CaptureState {
    if (!isObject(value) || !isObject(value.checkpoint)) return false;
    const checkpoint = value.checkpoint;
    return (
        value.version === 1 &&
        typeof checkpoint.sessionId === "string" &&
        typeof checkpoint.transcriptPath === "string" &&
        typeof checkpoint.sourceByteOffset === "string" &&
        typeof value.generation === "string" &&
        /^[0-9a-f-]{36}$/.test(value.generation) &&
        typeof value.fileIdentity === "string" &&
        typeof value.observedSize === "number" &&
        Number.isSafeInteger(value.observedSize) &&
        value.observedSize >= 0 &&
        typeof value.prefixDigest === "string" &&
        /^[0-9a-f]{64}$/.test(value.prefixDigest) &&
        isObject(value.generatedIds) &&
        Object.entries(value.generatedIds).every(
            ([offset, id]) =>
                /^(0|[1-9]\d*)$/.test(offset) &&
                typeof id === "string" &&
                /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
                    id,
                ),
        )
    );
}

export function captureStatePath(
    sessionId: string,
    transcriptPath: string,
    directory = path.join(os.homedir(), ".typeagent", "git-story", "capture"),
): string {
    const key = createHash("sha256")
        .update(JSON.stringify([sessionId, transcriptPath]))
        .digest("hex");
    return path.join(directory, `${key}.json`);
}

export async function loadCaptureState(
    file: string,
): Promise<CaptureState | undefined> {
    let text: string;
    try {
        text = await fs.readFile(file, "utf8");
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
            return undefined;
        throw error;
    }
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch {
        // Parser errors can include persisted data. Do not echo their contents.
        throw new Error("Invalid session capture state JSON");
    }
    if (!isState(value)) throw new Error("Invalid session capture state");
    const end = byteOffset(value.checkpoint.sourceByteOffset);
    if (
        end > value.observedSize ||
        Object.keys(value.generatedIds).some(
            (offset) => byteOffset(offset) >= end,
        )
    ) {
        throw new Error("Invalid session capture state offsets");
    }
    return value;
}

export async function saveCaptureState(
    file: string,
    state: CaptureState,
): Promise<void> {
    const temporary = `${file}.${randomUUID()}.tmp`;
    const handle = await fs.open(temporary, "wx", 0o600);
    try {
        try {
            await handle.writeFile(JSON.stringify(state), "utf8");
            await handle.sync();
        } finally {
            await handle.close();
        }
        // IDs and read progress become visible together, never in separate writes.
        await fs.rename(temporary, file);
    } finally {
        await fs.rm(temporary, { force: true });
    }
}

export async function withCaptureStateLock<T>(
    file: string,
    capture: () => Promise<T>,
): Promise<T> {
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const lock = `${file}.lock`;
    let handle;
    try {
        handle = await fs.open(lock, "wx", 0o600);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
            throw new Error(
                "Session capture state is locked; serialize captures and remove an abandoned lock only after its writer has stopped",
            );
        }
        throw error;
    }
    try {
        return await capture();
    } finally {
        try {
            await handle.close();
        } finally {
            await fs.unlink(lock);
        }
    }
}
