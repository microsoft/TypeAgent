// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { lstat, open, realpath, type FileHandle } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type {
    AgentSessionImportReceipt,
    AgentSessionImportType,
    AgentSessionScope,
    MemoryService,
} from "@typeagent/memory-service";
import { isPathContained } from "./importer.js";

const MAX_CHUNK_BYTES = 512 * 1024;
const MAX_CHUNK_LINES = 1000;
const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;

export interface AgentSessionPathImportOptions extends AgentSessionScope {
    corpusId: string;
    sessionId: string;
    importType: AgentSessionImportType;
    path: string;
    cwd?: string;
    maxTotalBytes?: number;
    signal?: AbortSignal;
    pollIntervalMs?: number;
    timeoutMs?: number;
}

async function resolveSessionFile(options: AgentSessionPathImportOptions) {
    const maxBytes = options.maxTotalBytes ?? DEFAULT_MAX_BYTES;
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
        throw new Error("maxTotalBytes must be a positive safe integer");
    }
    const requested = resolve(options.cwd ?? process.cwd(), options.path);
    const root = await realpath(dirname(requested));
    const info = await lstat(requested);
    const actual = await realpath(requested);
    if (
        info.isSymbolicLink() ||
        !info.isFile() ||
        info.nlink !== 1 ||
        !isPathContained(root, actual)
    ) {
        throw new Error(
            "Agent session import requires a contained regular file, not a link",
        );
    }
    if (info.size > maxBytes) {
        throw new Error(
            `Agent session import exceeds the ${maxBytes} byte limit`,
        );
    }
    return { maxBytes, requested, actual, info };
}

async function validateSessionFileUnchanged(
    file: FileHandle,
    opened: Stats,
    requested: string,
    actual: string,
) {
    const finished = await file.stat();
    const current = await lstat(requested);
    if (
        finished.size !== opened.size ||
        finished.mtimeMs !== opened.mtimeMs ||
        finished.ctimeMs !== opened.ctimeMs ||
        current.isSymbolicLink() ||
        !current.isFile() ||
        current.nlink !== 1 ||
        current.dev !== opened.dev ||
        current.ino !== opened.ino ||
        (await realpath(requested)) !== actual
    ) {
        throw new Error(
            "Agent session file changed while reading; import was not finalized",
        );
    }
}

async function* readSessionChunks(options: AgentSessionPathImportOptions) {
    const { maxBytes, requested, actual, info } =
        await resolveSessionFile(options);
    const file = await open(
        actual,
        constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    try {
        const opened = await file.stat();
        if (
            !opened.isFile() ||
            opened.nlink !== 1 ||
            opened.dev !== info.dev ||
            opened.ino !== info.ino ||
            opened.size > maxBytes ||
            (await realpath(requested)) !== actual
        ) {
            throw new Error("Agent session file changed while opening");
        }
        const decoder = new TextDecoder("utf-8", {
            fatal: true,
            ignoreBOM: true,
        });
        const buffer = Buffer.alloc(64 * 1024);
        let pending = Buffer.alloc(0);
        let chunk: Buffer[] = [];
        let chunkBytes = 0;
        let total = 0;
        const addLine = async function* (line: Buffer) {
            if (line.byteLength > MAX_CHUNK_BYTES) {
                throw new Error("An agent session JSONL line exceeds 512 KiB");
            }
            if (
                chunkBytes + line.byteLength > MAX_CHUNK_BYTES ||
                chunk.length === MAX_CHUNK_LINES
            ) {
                yield decoder.decode(Buffer.concat(chunk));
                chunk = [];
                chunkBytes = 0;
            }
            chunk.push(line);
            chunkBytes += line.byteLength;
        };
        while (true) {
            options.signal?.throwIfAborted();
            const { bytesRead } = await file.read(
                buffer,
                0,
                buffer.length,
                null,
            );
            if (bytesRead === 0) break;
            total += bytesRead;
            if (total > maxBytes) {
                throw new Error(
                    `Agent session import exceeds the ${maxBytes} byte limit`,
                );
            }
            const data = Buffer.concat([
                pending,
                buffer.subarray(0, bytesRead),
            ]);
            let start = 0;
            let newline: number;
            while ((newline = data.indexOf(10, start)) !== -1) {
                yield* addLine(data.subarray(start, newline + 1));
                start = newline + 1;
            }
            pending = data.subarray(start);
            if (pending.byteLength > MAX_CHUNK_BYTES) {
                throw new Error("An agent session JSONL line exceeds 512 KiB");
            }
        }
        if (pending.byteLength > 0) yield* addLine(pending);
        await validateSessionFileUnchanged(file, opened, requested, actual);
        if (chunk.length > 0) yield decoder.decode(Buffer.concat(chunk));
    } finally {
        await file.close();
    }
}

export async function importAgentSessionPath(
    service: MemoryService,
    options: AgentSessionPathImportOptions,
): Promise<AgentSessionImportReceipt> {
    if (!service.importAgentSession || !service.getAgentSessionImport) {
        throw new Error("Memory agent session imports are not supported");
    }
    const pollIntervalMs = options.pollIntervalMs ?? 100;
    const timeoutMs = options.timeoutMs ?? 120_000;
    if (
        !Number.isFinite(pollIntervalMs) ||
        pollIntervalMs < 1 ||
        !Number.isFinite(timeoutMs) ||
        timeoutMs < 1
    ) {
        throw new Error("Polling interval and timeout must be positive");
    }
    const read = { corpusId: options.corpusId, sessionId: options.sessionId };
    // Replay every chunk with stable positional keys so the store validates its original request hash.
    let cursor = 0;
    let chunkIndex = 0;
    let receipt: AgentSessionImportReceipt;
    const submit = async (jsonl: string, final: boolean) => {
        options.signal?.throwIfAborted();
        const expectedEnd =
            cursor + jsonl.split("\n").filter((line) => line.trim()).length;
        const idempotencyKey = createHash("sha256")
            .update(
                JSON.stringify([
                    read,
                    options.importType,
                    cursor,
                    chunkIndex,
                    final,
                    options.repository,
                    options.commit,
                    options.environment,
                ]),
            )
            .digest("hex");
        receipt = await service.importAgentSession!({
            ...read,
            importType: options.importType,
            expectedCursor: cursor,
            idempotencyKey,
            jsonl,
            final,
            ...(options.repository === undefined
                ? {}
                : { repository: options.repository }),
            ...(options.commit === undefined ? {} : { commit: options.commit }),
            ...(options.environment === undefined
                ? {}
                : { environment: options.environment }),
        });
        const deadline = Date.now() + timeoutMs;
        while (
            receipt.state === "running" &&
            (final || expectedEnd === cursor || receipt.cursor < expectedEnd)
        ) {
            if (Date.now() >= deadline) {
                throw new Error(
                    "Timed out polling agent session import; inspect its receipt before retrying",
                );
            }
            await delay(pollIntervalMs, undefined, { signal: options.signal });
            const status = await service.getAgentSessionImport!(read);
            if (!status)
                throw new Error("Agent session import receipt disappeared");
            receipt = status;
        }
        if (
            (receipt.state === "failed" || receipt.state === "cancelled") &&
            (final || receipt.cursor < expectedEnd)
        ) {
            throw new Error(
                receipt.error ?? `Agent session import ${receipt.state}`,
            );
        }
        if (receipt.cursor < expectedEnd) {
            throw new Error("Agent session import did not advance its cursor");
        }
        if (final && (!receipt.final || receipt.cursor !== expectedEnd)) {
            throw new Error(
                "Agent session import did not finalize at the file cursor",
            );
        }
        cursor = expectedEnd;
        chunkIndex++;
        return receipt;
    };
    for await (const chunk of readSessionChunks(options)) {
        await submit(chunk, false);
    }
    return submit("", true);
}
