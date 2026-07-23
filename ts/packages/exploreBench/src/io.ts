// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    appendFile,
    mkdir,
    readFile,
    rename,
    writeFile,
} from "node:fs/promises";
import { dirname } from "node:path";
import {
    normalizeBenchmarkVariant,
    type BenchmarkVariant,
    type RunManifest,
    type RunResult,
} from "./types.js";

export async function readJsonFile<T>(path: string): Promise<T> {
    return JSON.parse(await readFile(path, "utf8")) as T;
}

export async function readJsonFileIfExists<T>(
    path: string,
): Promise<T | undefined> {
    try {
        return await readJsonFile<T>(path);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return undefined;
        }
        throw error;
    }
}

export async function readRunManifest(path: string): Promise<RunManifest> {
    return normalizeRunManifest(await readJsonFile<unknown>(path));
}

export async function readRunManifestIfExists(
    path: string,
): Promise<RunManifest | undefined> {
    const value = await readJsonFileIfExists<unknown>(path);
    return value === undefined ? undefined : normalizeRunManifest(value);
}

export async function writeJsonAtomic(
    path: string,
    value: unknown,
): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temporary, path);
}

export async function appendResult(
    path: string,
    value: RunResult,
): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${JSON.stringify(value)}\n`, "utf8");
}

export async function appendResults(
    path: string,
    values: RunResult[],
): Promise<void> {
    if (values.length === 0) {
        return;
    }
    await mkdir(dirname(path), { recursive: true });
    await appendFile(
        path,
        `${values.map((value) => JSON.stringify(value)).join("\n")}\n`,
        "utf8",
    );
}

export async function readResults(path: string): Promise<RunResult[]> {
    let text: string;
    try {
        text = await readFile(path, "utf8");
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return [];
        }
        throw error;
    }
    return text
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line, index) => {
            try {
                return normalizeRunResult(JSON.parse(line));
            } catch (error) {
                throw new Error(
                    `Invalid JSONL at ${path}:${index + 1}: ${(error as Error).message}`,
                );
            }
        });
}

export async function readEnvFile(
    path: string,
): Promise<Record<string, string>> {
    const values: Record<string, string> = {};
    const text = await readFile(path, "utf8");
    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#") || !line.includes("=")) {
            continue;
        }
        const [key, ...rest] = line.split("=");
        values[key] = rest
            .join("=")
            .trim()
            .replace(/^(['"])(.*)\1$/, "$2");
    }
    return values;
}

export function resultKey(
    taskId: string,
    matrixName: string,
    variant: BenchmarkVariant,
): string {
    return `${taskId}\0${matrixName}\0${variant}`;
}

function normalizeRunManifest(value: unknown): RunManifest {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error("Run manifest must be an object");
    }
    const manifest = value as Record<string, unknown>;
    if (!Array.isArray(manifest.variants)) {
        throw new Error("Run manifest variants must be an array");
    }
    return {
        ...manifest,
        variants: manifest.variants.map(normalizeBenchmarkVariant),
    } as unknown as RunManifest;
}

function normalizeRunResult(value: unknown): RunResult {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error("Result row must be an object");
    }
    const row = value as Record<string, unknown>;
    return {
        ...row,
        variant: normalizeBenchmarkVariant(row.variant),
    } as unknown as RunResult;
}

export function safeRunId(value: string): string {
    return value.replace(/[^A-Za-z0-9_.-]+/g, "-");
}

export function redact(value: string, secrets: readonly string[]): string {
    let redacted = value;
    for (const secret of secrets) {
        if (secret) {
            redacted = redacted.split(secret).join("[REDACTED]");
        }
    }
    return redacted;
}
