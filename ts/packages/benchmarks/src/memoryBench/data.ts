// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { asyncBufferFromFile, parquetReadObjects } from "hyparquet";
import { beamTurns, documentsFor } from "./normalize.js";
import { parseLiteral } from "./literal.js";
import {
    bytesHash,
    list,
    object,
    readJson,
    saveJson,
    strings,
    text,
} from "./storage.js";
import type { DatasetName, Query } from "./types.js";

export const beamRevisions: Record<string, string> = {
    "Mohammadta/BEAM": "3205395e897e7318c7b094ef4e6047b9b82dbb03",
    "Mohammadta/BEAM-10M": "9b2096193fe74e2837e4713e483351e19817773c",
};
export const beamSplits = ["100k", "500k", "1m", "10m"] as const;
const categories = [
    "abstention",
    "contradiction_resolution",
    "event_ordering",
    "information_extraction",
    "instruction_following",
    "knowledge_update",
    "multi_session_reasoning",
    "preference_following",
    "summarization",
    "temporal_reasoning",
];
export function validateDataset(name: string, split: string): void {
    if (name !== "beam") throw new Error(`Unsupported dataset: ${name}`);
    if (!beamSplits.some((supported) => supported === split))
        throw new Error(`Unknown BEAM split: ${split}`);
}
async function fetchBytes(url: string): Promise<Uint8Array> {
    const response = await fetch(url, { signal: AbortSignal.timeout(300000) });
    if (!response.ok)
        throw new Error(`Dataset download HTTP ${response.status}: ${url}`);
    return new Uint8Array(await response.arrayBuffer());
}
async function downloadBeam(
    split: string,
    directory: string,
    destination: string,
) {
    const name = split === "10m" ? "Mohammadta/BEAM-10M" : "Mohammadta/BEAM";
    const revision = beamRevisions[name];
    const hfSplit = (
        { "100k": "100K", "500k": "500K", "1m": "1M", "10m": "10M" } as Record<
            string,
            string
        >
    )[split];
    if (!hfSplit) throw new Error("Unknown BEAM split");
    const tree = JSON.parse(
        Buffer.from(
            await fetchBytes(
                `https://huggingface.co/api/datasets/${name}/tree/${revision}?recursive=true&limit=1000`,
            ),
        ).toString("utf8"),
    );
    const shards = list(tree)
        .map(object)
        .filter(
            (item) =>
                typeof item.path === "string" &&
                new RegExp(`(?:^|/)${hfSplit}(?:/|-)`).test(item.path) &&
                item.path.endsWith(".parquet"),
        );
    if (!shards.length) throw new Error("No pinned Parquet shards found");
    const rows: unknown[] = [],
        shardHashes: Record<string, string> = {};
    for (const shard of shards.sort((a, b) =>
        text(a.path).localeCompare(text(b.path)),
    )) {
        const relative = text(shard.path);
        const file = path.join(
            directory,
            `${hfSplit}-${path.basename(relative)}`,
        );
        const bytes = await fetchBytes(
            `https://huggingface.co/datasets/${name}/resolve/${revision}/${relative}`,
        );
        await writeFile(file, bytes);
        shardHashes[relative] = bytesHash(bytes);
        rows.push(
            ...(await parquetReadObjects({
                file: await asyncBufferFromFile(file),
            })),
        );
    }
    const portable: unknown = JSON.parse(
        JSON.stringify(rows, (_key, value: unknown) =>
            typeof value === "bigint" ? value.toString() : value,
        ),
    );
    await saveJson(destination, portable);
    await saveJson(`${destination}.provenance.json`, {
        dataset: name,
        revision,
        shardHashes,
        dataHash: bytesHash(await readFile(destination)),
    });
}
export async function loadDataset(
    name: DatasetName,
    split: string,
    cache: string,
    input?: string,
) {
    validateDataset(name, split);
    const file = input ?? path.join(cache, `${name}-${split}.json`);
    const revision =
        beamRevisions[
            split === "10m" ? "Mohammadta/BEAM-10M" : "Mohammadta/BEAM"
        ];
    if (!input && (await readJson(file)) === undefined) {
        await mkdir(cache, { recursive: true });
        await downloadBeam(split, cache, file);
    }
    const bytes = await readFile(file);
    const rows = list(JSON.parse(bytes.toString("utf8"))).map(object);
    if (!rows.length) throw new Error("Empty dataset");
    if (!input) {
        const provenance = object(await readJson(`${file}.provenance.json`));
        if (
            provenance.revision !== revision ||
            provenance.dataHash !== bytesHash(bytes)
        )
            throw new Error("Cached dataset provenance mismatch");
    }
    return {
        rows,
        file,
        hash: bytesHash(bytes),
        revision: input ? "local-json-sha256" : revision,
    };
}
function probingQuestions(
    row: Record<string, unknown>,
): Record<string, unknown> {
    const raw = row.probing_questions;
    const result = object(typeof raw === "string" ? parseLiteral(raw) : raw);
    if (!Object.keys(result).length)
        throw new Error("Missing BEAM probing questions");
    return result;
}
function beamQueries(row: Record<string, unknown>): Query[] {
    const unit = text(String(row.conversation_id ?? ""));
    const probing = probingQuestions(row);
    return categories.flatMap((category) =>
        list(probing[category] ?? []).map((value, index) => {
            const question = object(value);
            const rubric =
                typeof question.rubric === "string"
                    ? [question.rubric]
                    : strings(question.rubric);
            if (!rubric.length || rubric.some((item) => !item.trim()))
                throw new Error("Missing BEAM rubric");
            const answer = [
                "ideal_answer",
                "ideal_response",
                "answer",
                "expected_answer",
                "gold_answer",
            ]
                .map((key) => question[key])
                .find((item) => item !== undefined);
            return {
                id: `${unit}_${category}_${index}`,
                unit,
                category,
                query: text(question.question),
                rubric,
                goldIds: [unit],
                goldAnswers: answer === undefined ? [] : [String(answer)],
            };
        }),
    );
}
export function queriesFor(rows: Record<string, unknown>[]): Query[] {
    const queries = rows.flatMap(beamQueries);
    if (
        !queries.length ||
        new Set(queries.map((query) => query.id)).size !== queries.length
    )
        throw new Error("Empty queries or duplicate query identities");
    return queries;
}
export function documentsFrom(
    rows: Record<string, unknown>[],
    units: Set<string>,
) {
    return rows.flatMap((row) => {
        const unit = String(row.conversation_id);
        if (!units.has(unit)) return [];
        const chat =
            typeof row.chat === "string" ? parseLiteral(row.chat) : row.chat;
        return documentsFor(unit, beamTurns(chat));
    });
}
export function selectQueries(
    queries: Query[],
    stage: string,
    unit?: string,
): Query[] {
    if (stage === "full") return queries;
    const selected = queries.filter(
        (query) => query.unit === (unit ?? queries[0].unit),
    );
    if (!selected.length) throw new Error("Unknown conversation unit");
    if (stage !== "smoke") return selected;
    const seen = new Set<string>();
    return selected.filter((query) => {
        if (seen.has(query.category)) return false;
        seen.add(query.category);
        return true;
    });
}
