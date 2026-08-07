// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import fs from "node:fs";
import { z } from "zod";

import type { TranslationBenchBenchmarkSchema } from "./benchmark.js";
import {
    parseJsonText,
    parseVersionedWithZod,
    parseWithZod,
} from "./zodJson.js";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

const workIdentitySchema = z
    .object({
        phase: z.string().trim().min(1),
        model: z.string().trim().min(1),
        scenario: z.string().trim().min(1),
        caseId: z.string().trim().min(1),
    })
    .strict();

const checkpointHeaderV1Schema = z
    .object({
        kind: z.literal("translation-bench-checkpoint"),
        version: z.literal(1),
        runFingerprint: sha256Schema,
        settings: z.unknown(),
        shardIndex: z.number().int().nonnegative(),
        shardCount: z.number().int().positive(),
    })
    .strict()
    .superRefine((header, ctx) => {
        if (header.shardIndex >= header.shardCount) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["shardIndex"],
                message: `must be < shardCount (${header.shardCount})`,
            });
        }
    });

export const translationBenchCheckpointHeaderSchemas = {
    1: checkpointHeaderV1Schema,
} as const;

const checkpointRowV1Schema = workIdentitySchema
    .extend({
        kind: z.literal("translation-bench-row"),
        version: z.literal(1),
        value: z.unknown(),
    })
    .strict();

export const translationBenchCheckpointRowSchemas = {
    1: checkpointRowV1Schema,
} as const;

export type TranslationBenchWorkIdentity = z.infer<typeof workIdentitySchema>;
export type TranslationBenchCheckpointHeader = z.infer<
    typeof checkpointHeaderV1Schema
>;
export type TranslationBenchCheckpointRow<T = unknown> = Omit<
    z.infer<typeof checkpointRowV1Schema>,
    "value"
> & { value: T };

export interface TranslationBenchCheckpoint<T = unknown> {
    header: TranslationBenchCheckpointHeader;
    rows: TranslationBenchCheckpointRow<T>[];
    resumeKeys: Set<string>;
}

export interface TranslationBenchCatalogCensus {
    schemaCount: number;
    actionCount: number;
    qualifiedActionKeys: string[];
    catalogDigest: string;
}

function sha256(value: string): string {
    return createHash("sha256").update(value).digest("hex");
}

function compareText(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalJson(
    value: unknown,
    path = "$",
    stack = new Set<object>(),
): string {
    if (value === null) return "null";
    if (typeof value === "string" || typeof value === "boolean") {
        return JSON.stringify(value);
    }
    if (typeof value === "number") {
        if (!Number.isFinite(value)) {
            throw new Error(`Non-finite JSON number at ${path}`);
        }
        return JSON.stringify(value);
    }
    if (typeof value !== "object") {
        throw new Error(`Non-JSON value at ${path}`);
    }
    if (stack.has(value)) {
        throw new Error(`Circular JSON value at ${path}`);
    }
    stack.add(value);
    try {
        if (Array.isArray(value)) {
            return `[${value
                .map((item, index) =>
                    item === undefined
                        ? "null"
                        : canonicalJson(item, `${path}[${index}]`, stack),
                )
                .join(",")}]`;
        }
        if (Object.prototype.toString.call(value) !== "[object Object]") {
            throw new Error(`Non-plain JSON object at ${path}`);
        }
        const record = value as Record<string, unknown>;
        return `{${Object.keys(record)
            .filter((key) => record[key] !== undefined)
            .sort(compareText)
            .map(
                (key) =>
                    `${JSON.stringify(key)}:${canonicalJson(
                        record[key],
                        `${path}.${key}`,
                        stack,
                    )}`,
            )
            .join(",")}}`;
    } finally {
        stack.delete(value);
    }
}

export function parseTranslationBenchCheckpointHeader(
    value: unknown,
): TranslationBenchCheckpointHeader {
    return parseVersionedWithZod(
        value,
        translationBenchCheckpointHeaderSchemas,
        "checkpoint header",
    );
}

export function parseTranslationBenchCheckpointRow<T = unknown>(
    value: unknown,
): TranslationBenchCheckpointRow<T> {
    return parseVersionedWithZod(
        value,
        translationBenchCheckpointRowSchemas,
        "checkpoint row",
    ) as TranslationBenchCheckpointRow<T>;
}

export function getTranslationBenchShardIndex(
    stableKey: string,
    shardCount: number,
): number {
    parseWithZod(z.string().trim().min(1), stableKey, "shard key");
    parseWithZod(z.number().int().positive(), shardCount, "shard count");
    const digest = createHash("sha256").update(stableKey).digest();
    return Number(digest.readBigUInt64BE(0) % BigInt(shardCount));
}

export function translationBenchResumeKey(
    identity: TranslationBenchWorkIdentity,
): string {
    const normalized = parseWithZod(
        workIdentitySchema,
        identity,
        "work identity",
    );
    return JSON.stringify([
        normalized.phase,
        normalized.model,
        normalized.scenario,
        normalized.caseId,
    ]);
}

function validateRowShard<T>(
    row: TranslationBenchCheckpointRow<T>,
    header: TranslationBenchCheckpointHeader,
): void {
    const actual = getTranslationBenchShardIndex(
        translationBenchResumeKey(row),
        header.shardCount,
    );
    if (actual !== header.shardIndex) {
        throw new Error(
            `Translation bench row '${translationBenchResumeKey(row)}' belongs to shard ${actual}, not shard ${header.shardIndex}`,
        );
    }
}

function settingsEqual(left: unknown, right: unknown): boolean {
    return canonicalJson(left) === canonicalJson(right);
}

function assertCompatibleHeaders(
    actual: TranslationBenchCheckpointHeader,
    expected: TranslationBenchCheckpointHeader,
): void {
    if (actual.runFingerprint !== expected.runFingerprint) {
        throw new Error(
            "Translation bench checkpoint run fingerprint is incompatible",
        );
    }
    if (!settingsEqual(actual.settings, expected.settings)) {
        throw new Error(
            "Translation bench checkpoint settings are incompatible",
        );
    }
    if (
        actual.shardIndex !== expected.shardIndex ||
        actual.shardCount !== expected.shardCount
    ) {
        throw new Error(
            "Translation bench checkpoint shard metadata is incompatible",
        );
    }
}

export function createTranslationBenchRunFingerprint(
    runInputs: unknown,
): string {
    return sha256(canonicalJson(runInputs));
}

export function readTranslationBenchCheckpoint<T = unknown>(
    filePath: string,
): TranslationBenchCheckpoint<T> {
    const text = fs.readFileSync(filePath, "utf8");
    const lines = text.endsWith("\n")
        ? text.slice(0, -1).split("\n")
        : text.split("\n");
    if (lines.length === 0 || (lines.length === 1 && lines[0] === "")) {
        throw new Error(`Translation bench checkpoint '${filePath}' is empty`);
    }
    if (lines.some((line) => line.trim().length === 0)) {
        throw new Error(
            `Translation bench checkpoint '${filePath}' contains a blank line`,
        );
    }

    const header = parseTranslationBenchCheckpointHeader(
        parseJsonText(lines[0]!, `checkpoint '${filePath}' line 1`),
    );
    const rows: TranslationBenchCheckpointRow<T>[] = [];
    const resumeKeys = new Set<string>();
    for (let index = 1; index < lines.length; index++) {
        const row = parseTranslationBenchCheckpointRow<T>(
            parseJsonText(
                lines[index]!,
                `checkpoint '${filePath}' line ${index + 1}`,
            ),
        );
        validateRowShard(row, header);
        const key = translationBenchResumeKey(row);
        if (resumeKeys.has(key)) {
            throw new Error(`Duplicate translation bench resume key '${key}'`);
        }
        resumeKeys.add(key);
        rows.push(row);
    }
    return { header, rows, resumeKeys };
}

export function appendTranslationBenchCheckpointRows<T = unknown>(
    filePath: string,
    checkpointHeader: TranslationBenchCheckpointHeader,
    rows: readonly TranslationBenchCheckpointRow<T>[],
): TranslationBenchCheckpoint<T> {
    const header = parseTranslationBenchCheckpointHeader(checkpointHeader);
    const batchKeys = new Set<string>();
    const normalizedRows = rows.map((row) => {
        const parsed = parseTranslationBenchCheckpointRow<T>(row);
        validateRowShard(parsed, header);
        const key = translationBenchResumeKey(parsed);
        if (batchKeys.has(key)) {
            throw new Error(`Duplicate translation bench resume key '${key}'`);
        }
        batchKeys.add(key);
        return parsed;
    });

    let current: TranslationBenchCheckpoint<T>;
    if (fs.existsSync(filePath)) {
        current = readTranslationBenchCheckpoint<T>(filePath);
        assertCompatibleHeaders(current.header, header);
    } else {
        try {
            fs.writeFileSync(filePath, `${canonicalJson(header)}\n`, {
                flag: "wx",
            });
            current = {
                header,
                rows: [],
                resumeKeys: new Set(),
            };
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (code !== "EEXIST") throw error;
            current = readTranslationBenchCheckpoint<T>(filePath);
            assertCompatibleHeaders(current.header, header);
        }
    }

    for (const key of batchKeys) {
        if (current.resumeKeys.has(key)) {
            throw new Error(`Duplicate translation bench resume key '${key}'`);
        }
    }
    if (normalizedRows.length > 0) {
        fs.appendFileSync(
            filePath,
            normalizedRows.map((row) => `${canonicalJson(row)}\n`).join(""),
        );
    }
    return {
        header: current.header,
        rows: [...current.rows, ...normalizedRows],
        resumeKeys: new Set([...current.resumeKeys, ...batchKeys]),
    };
}

export function getTranslationBenchCatalogCensus(
    schemas: readonly TranslationBenchBenchmarkSchema[],
): TranslationBenchCatalogCensus {
    if (schemas.length === 0) {
        throw new Error("Translation bench TypeAgent catalog is empty");
    }
    const schemaNames = new Set<string>();
    const actionKeys = new Set<string>();
    const normalizedSchemas = schemas.map((schema) => {
        parseWithZod(
            z.string().trim().min(1),
            schema?.schemaName,
            "catalog schema name",
        );
        if (schemaNames.has(schema.schemaName)) {
            throw new Error(
                `Duplicate translation bench catalog schema '${schema.schemaName}'`,
            );
        }
        schemaNames.add(schema.schemaName);
        if (schema.typeAgent === undefined) {
            throw new Error(
                `Translation bench catalog schema '${schema.schemaName}' is not pinned to TypeAgent`,
            );
        }
        parseWithZod(
            z.string().trim().min(1),
            schema.typeAgent.sourceHash,
            `catalog schema '${schema.schemaName}' source hash`,
        );
        if (
            schema.typeAgent.parsedActionSchema === null ||
            typeof schema.typeAgent.parsedActionSchema !== "object" ||
            Array.isArray(schema.typeAgent.parsedActionSchema)
        ) {
            throw new Error(
                `Translation bench catalog schema '${schema.schemaName}' has invalid TypeAgent provenance`,
            );
        }
        if (!Array.isArray(schema.tools) || schema.tools.length === 0) {
            throw new Error(
                `Translation bench catalog schema '${schema.schemaName}' has no actions`,
            );
        }
        const tools = [...schema.tools];
        for (const tool of tools) {
            if (tool?.type !== "function") {
                throw new Error(
                    `Translation bench catalog schema '${schema.schemaName}' has an invalid tool`,
                );
            }
            parseWithZod(
                z.string().trim().min(1),
                tool.function?.name,
                `catalog schema '${schema.schemaName}' action name`,
            );
            const actionKey = JSON.stringify([
                schema.schemaName,
                tool.function.name,
            ]);
            if (actionKeys.has(actionKey)) {
                throw new Error(
                    `Duplicate existing TypeAgent action '${schema.schemaName}.${tool.function.name}'`,
                );
            }
            actionKeys.add(actionKey);
        }
        tools.sort((left, right) =>
            compareText(left.function.name, right.function.name),
        );
        return {
            schemaName: schema.schemaName,
            description: schema.description,
            tools,
            typeAgent: schema.typeAgent,
        };
    });
    normalizedSchemas.sort((left, right) =>
        compareText(left.schemaName, right.schemaName),
    );
    return {
        schemaCount: normalizedSchemas.length,
        actionCount: actionKeys.size,
        qualifiedActionKeys: [...actionKeys].sort(compareText),
        catalogDigest: sha256(canonicalJson(normalizedSchemas)),
    };
}

export function assertTranslationBenchMinimumVisibleActions(
    schemas: readonly TranslationBenchBenchmarkSchema[],
    minimumActionCount: number,
): TranslationBenchCatalogCensus {
    parseWithZod(
        z.number().int().positive(),
        minimumActionCount,
        "minimum visible action count",
    );
    const census = getTranslationBenchCatalogCensus(schemas);
    if (census.actionCount < minimumActionCount) {
        throw new Error(
            `Translation bench requires at least ${minimumActionCount} existing TypeAgent actions; catalog has ${census.actionCount}`,
        );
    }
    return census;
}
