// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Shared file/JSON IO helpers used across the benchmark tooling. Centralizes the
// JSONL line parse (with `label:line` context), the read-then-parse skeleton, and
// parent-directory creation so callers stay behavior-identical.

import fs from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

// Parse JSONL text, skipping blank lines and reporting `label:line` on the first
// unparseable row. e.g. readJsonlLines(text, "DroidCall_train.jsonl") -> rows.
export function readJsonlLines<T>(text: string, label: string): T[] {
    const rows: T[] = [];
    for (const [index, line] of text.split("\n").entries()) {
        if (line.trim().length === 0) continue;
        try {
            rows.push(JSON.parse(line) as T);
        } catch (error) {
            throw new Error(`${label}:${index + 1}: ${String(error)}`);
        }
    }
    return rows;
}

// Read a JSON file and parse it, wrapping read and parse failures with the label
// and path for actionable errors. e.g. readJsonFile(path, "runConfig").
export function readJsonFile<T>(path: string, label: string): T {
    let text: string;
    try {
        text = fs.readFileSync(path, "utf8");
    } catch (error) {
        throw new Error(`${label}: failed to read ${path}: ${String(error)}`);
    }
    try {
        return JSON.parse(text) as T;
    } catch (error) {
        throw new Error(`${label}: failed to parse ${path}: ${String(error)}`);
    }
}

// Create the parent directory of a path, if missing.
export async function ensureParentDir(path: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
}
