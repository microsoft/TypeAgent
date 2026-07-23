// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdir } from "node:fs/promises";
import path from "node:path";
import { readJsonFileIfExists, writeJsonAtomic } from "./io.js";
import {
    BENCHMARK_TOOL_CALL_LIMIT,
    type BenchTask,
    type RepositoryLanguage,
    type SwebenchRow,
} from "./types.js";

export const verifiedDataset = "princeton-nlp/SWE-bench_Verified";
const datasetConfig = "default";
const split = "test" as const;
const pageSize = 100;

interface DatasetServerRow {
    row_idx: number;
    row: SwebenchRow;
    truncated_cells?: string[];
}

interface DatasetServerResponse {
    rows: DatasetServerRow[];
    num_rows_total: number;
}

interface CachedRows {
    dataset: string;
    config: string;
    split: string;
    downloadedAt: string;
    rows: DatasetServerRow[];
}

export async function loadVerifiedTasks(options: {
    dataDir: string;
    limit: number;
    offset: number;
    seed?: string;
    taskIds?: readonly string[];
    languages?: readonly RepositoryLanguage[];
    dockerPlatform: string;
}): Promise<BenchTask[]> {
    const rows = await loadRows(options.dataDir);
    const selected = options.taskIds
        ? selectByInstanceIds(rows, options.taskIds)
        : options.seed === undefined
          ? selectByRepo(rows, options.limit, options.offset)
          : selectRandomBySeed(rows, options.limit, options.seed);
    if (selected.length < options.limit) {
        throw new Error(
            `SWE-bench Verified has only ${selected.length} selectable rows; requested ${options.limit}`,
        );
    }
    const tasks = selected.map((entry) => rowToTask(entry, options.dataDir));
    if (!options.languages?.length) {
        return tasks;
    }
    const languages = new Set(options.languages);
    const filtered = tasks.filter((task) =>
        patchLanguages(task.swebench.patch).some((language) =>
            languages.has(language),
        ),
    );
    if (options.taskIds && filtered.length !== tasks.length) {
        const retained = new Set(filtered.map((task) => task.id));
        const excluded = tasks
            .filter((task) => !retained.has(task.id))
            .map((task) => task.id);
        throw new Error(
            `Explicit tasks do not match the requested language filter: ${excluded.join(", ")}`,
        );
    }
    return filtered;
}

export function patchLanguages(patch: string): RepositoryLanguage[] {
    const languages = new Set<RepositoryLanguage>();
    for (const match of patch.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm)) {
        const file = match[2].toLowerCase();
        if (/\.(?:py|pyi)$/.test(file)) {
            languages.add("python");
        }
        if (/\.(?:cts|mts|ts|tsx)$/.test(file)) {
            languages.add("typescript");
        }
    }
    return [...languages].sort();
}

export function selectByRepo<T extends DatasetServerRow>(
    rows: T[],
    limit: number,
    offset = 0,
): T[] {
    const order: string[] = [];
    const byRepo = new Map<string, T[]>();
    for (const entry of rows) {
        const key =
            entry.row.repo?.trim() ||
            entry.row.instance_id.replace(/-\d+$/, "");
        if (!byRepo.has(key)) {
            byRepo.set(key, []);
            order.push(key);
        }
        byRepo.get(key)?.push(entry);
    }

    const selected: T[] = [];
    const selectionEnd = offset + limit;
    for (let round = 0; selected.length < selectionEnd; round += 1) {
        let added = false;
        for (const key of order) {
            const row = byRepo.get(key)?.[round];
            if (!row) {
                continue;
            }
            selected.push(row);
            added = true;
            if (selected.length >= selectionEnd) {
                break;
            }
        }
        if (!added) {
            break;
        }
    }
    return selected.slice(offset, selectionEnd);
}

export function selectByInstanceIds<T extends DatasetServerRow>(
    rows: T[],
    taskIds: readonly string[],
): T[] {
    if (taskIds.length === 0) {
        throw new Error("Explicit task IDs must not be empty");
    }
    if (new Set(taskIds).size !== taskIds.length) {
        throw new Error("Explicit task IDs must be unique");
    }
    const byId = new Map(rows.map((entry) => [entry.row.instance_id, entry]));
    return taskIds.map((taskId) => {
        const row = byId.get(taskId);
        if (!row) {
            throw new Error(
                `Explicit SWE-bench task ${JSON.stringify(taskId)} was not found`,
            );
        }
        return row;
    });
}

export function selectRandomBySeed<T>(
    rows: T[],
    limit: number,
    seed: number | string,
): T[] {
    if (!Number.isSafeInteger(limit) || limit <= 0 || limit > rows.length) {
        throw new Error(
            `Selection limit must be a positive integer no greater than ${rows.length}`,
        );
    }

    const shuffled = [...rows];
    const random = seededRandom(normalizeSeed(seed));
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
        const replacement = Math.floor(random() * (index + 1));
        [shuffled[index], shuffled[replacement]] = [
            shuffled[replacement],
            shuffled[index],
        ];
    }
    return shuffled.slice(0, limit);
}

function normalizeSeed(seed: number | string): number {
    if (typeof seed === "number") {
        if (!Number.isSafeInteger(seed) || seed < 0) {
            throw new Error("Selection seed must be a non-negative integer");
        }
        return seed;
    }
    if (seed.length === 0) {
        throw new Error("Selection seed must not be empty");
    }
    let value = 2_166_136_261;
    for (let index = 0; index < seed.length; index += 1) {
        value ^= seed.charCodeAt(index);
        value = Math.imul(value, 16_777_619);
    }
    return value >>> 0;
}

function seededRandom(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) | 0;
        let value = state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
    };
}

export function swebenchDockerImage(instanceId: string): string {
    const name = instanceId.replace(/__/g, "_1776_");
    return `docker.io/swebench/sweb.eval.x86_64.${name}:latest`.toLowerCase();
}

async function loadRows(dataDir: string): Promise<DatasetServerRow[]> {
    const cachePath = path.resolve(
        dataDir,
        "swebench",
        "datasets",
        "verified-test.rows.json",
    );
    const cached = await readJsonFileIfExists<CachedRows>(cachePath);
    if (
        cached?.dataset === verifiedDataset &&
        cached.config === datasetConfig &&
        cached.split === split
    ) {
        return cached.rows;
    }

    const rows: DatasetServerRow[] = [];
    let total = Number.POSITIVE_INFINITY;
    for (let offset = 0; offset < total; offset += pageSize) {
        const response = await fetch(datasetUrl(offset));
        if (!response.ok) {
            throw new Error(
                `Failed to download SWE-bench Verified rows: HTTP ${response.status}`,
            );
        }
        const page = (await response.json()) as DatasetServerResponse;
        total = page.num_rows_total;
        rows.push(...page.rows);
    }
    await mkdir(path.dirname(cachePath), { recursive: true });
    await writeJsonAtomic(cachePath, {
        dataset: verifiedDataset,
        config: datasetConfig,
        split,
        downloadedAt: new Date().toISOString(),
        rows,
    } satisfies CachedRows);
    return rows;
}

function datasetUrl(offset: number): string {
    const query = new URLSearchParams({
        dataset: verifiedDataset,
        config: datasetConfig,
        split,
        offset: String(offset),
        length: String(pageSize),
    });
    return `https://datasets-server.huggingface.co/rows?${query}`;
}

function rowToTask(entry: DatasetServerRow, dataDir: string): BenchTask {
    const truncated = new Set(entry.truncated_cells ?? []);
    if (truncated.has("problem_statement") || truncated.has("patch")) {
        throw new Error(
            `Dataset server truncated required fields for ${entry.row.instance_id}`,
        );
    }
    const dockerImage = swebenchDockerImage(entry.row.instance_id);
    const repoPath = path.resolve(
        dataDir,
        "swebench",
        "repos",
        "verified",
        entry.row.instance_id,
    );
    const swebench = {
        dataset: verifiedDataset,
        split,
        rowIndex: entry.row_idx,
        instanceId: entry.row.instance_id,
        patch: entry.row.patch,
        dockerImage,
        ...(entry.row.repo ? { repo: entry.row.repo } : {}),
        ...(entry.row.base_commit ? { baseCommit: entry.row.base_commit } : {}),
    };
    return {
        id: entry.row.instance_id,
        repoPath,
        query: `Explore the repository for this SWE-bench issue using static code search only from the current repository root. Do not scan outside the repository. Do not edit files, install dependencies, run tests, or run project code. Use at most ${BENCHMARK_TOOL_CALL_LIMIT} tool calls. Identify the code files and exact line ranges most likely needing changes.\n\n<problem_statement>\n${entry.row.problem_statement.trim()}\n</problem_statement>`,
        swebench,
    };
}
