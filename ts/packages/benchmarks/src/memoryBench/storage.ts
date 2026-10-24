// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { writeBenchmarkJson } from "@typeagent/memory-service/benchmark";

export function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("Expected an object");
    return value as Record<string, unknown>;
}
export function list(value: unknown): unknown[] {
    if (!Array.isArray(value)) throw new Error("Expected an array");
    return value;
}
export function string(value: unknown): string {
    if (typeof value !== "string") throw new Error("Expected a string");
    return value;
}
export function text(value: unknown): string {
    const result = string(value);
    if (!result.trim()) throw new Error("Expected nonempty text");
    return result;
}
export const strings = (value: unknown) => list(value).map(string);
export function canonical(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value && typeof value === "object")
        return `{${Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b, "en"))
            .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
            .join(",")}}`;
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error("Cannot fingerprint undefined");
    return encoded;
}
export const digest = (value: unknown) =>
    createHash("sha256").update(canonical(value)).digest("hex");
export const bytesHash = (value: string | Uint8Array) =>
    createHash("sha256").update(value).digest("hex");
export async function readJson(file: string): Promise<unknown | undefined> {
    try {
        return JSON.parse(await readFile(file, "utf8"));
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
            return undefined;
        throw error;
    }
}
export const saveJson = (file: string, value: unknown) =>
    writeBenchmarkJson(file, JSON.stringify(value, null, 2) + "\n");

export async function updateProgress(
    file: string,
    values: Record<string, unknown>,
) {
    const previous = object((await readJson(file)) ?? {});
    const run = values.activeRun;
    if (run && run !== previous.activeRun)
        for (const key of [
            "activeQuery",
            "completed",
            "total",
            "documentCount",
            "turnCount",
            "accuracy",
            "accuracyDenominator",
            "correctOverTotal",
            "meanScore",
            "correct",
            "scored",
            "blocked",
            "failed",
            "coverage",
            "categories",
            "error",
            "diagnosis",
            "lastQuestionFailure",
        ])
            delete previous[key];
    const updatedAt = new Date().toISOString();
    if (run) {
        const runs = object(previous.runs ?? {});
        const entry: Record<string, unknown> = {
            ...object(runs[string(run)] ?? {}),
            ...values,
            updatedAt,
        };
        if (values.state !== "blocked") delete entry.error;
        runs[string(run)] = entry;
        previous.runs = runs;
    }
    if (values.state !== "blocked") delete previous.error;
    await saveJson(file, { ...previous, ...values, updatedAt });
}
