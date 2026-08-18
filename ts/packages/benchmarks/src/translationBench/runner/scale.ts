// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";

export interface TranslationBenchWorkIdentity {
    phase: string;
    model: string;
    scenario: string;
    caseId: string;
}

export interface TranslationBenchCheckpointRow<T = unknown>
    extends TranslationBenchWorkIdentity {
    kind: "translation-bench-row";
    value: T;
}

export interface TranslationBenchCheckpointHeader {
    kind: "translation-bench-checkpoint";
    version: 1;
    runFingerprint: string;
    settings: unknown;
    shardIndex: number;
    shardCount: number;
}

export interface TranslationBenchCheckpoint<T = unknown> {
    header: TranslationBenchCheckpointHeader;
    rows: TranslationBenchCheckpointRow<T>[];
    resumeKeys: Set<string>;
}

export interface TranslationBenchMergeCounts {
    shardCount: number;
    rowCount: number;
    byPhase: Record<string, number>;
    byModel: Record<string, number>;
    byScenario: Record<string, number>;
}

export interface TranslationBenchMergeResult<T = unknown> {
    runFingerprint: string;
    settings: unknown;
    rows: TranslationBenchCheckpointRow<T>[];
    counts: TranslationBenchMergeCounts;
}

function sha256(value: string): string {
    return createHash("sha256").update(value).digest("hex");
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

function compareText(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

function requireNonEmpty(
    value: unknown,
    name: string,
): asserts value is string {
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new Error(`${name} must be a non-empty string`);
    }
}

function requireShardCount(shardCount: number): void {
    if (!Number.isInteger(shardCount) || shardCount <= 0) {
        throw new Error(
            "Translation bench shard count must be a positive integer",
        );
    }
}

export function validateTranslationBenchCheckpointHeader(
    header: TranslationBenchCheckpointHeader,
): void {
    if (
        header?.kind !== "translation-bench-checkpoint" ||
        header.version !== 1
    ) {
        throw new Error("Invalid translation bench checkpoint header");
    }
    requireNonEmpty(header.runFingerprint, "Translation bench run fingerprint");
    canonicalJson(header.settings);
    requireShardCount(header.shardCount);
    if (
        !Number.isInteger(header.shardIndex) ||
        header.shardIndex < 0 ||
        header.shardIndex >= header.shardCount
    ) {
        throw new Error(
            `Translation bench shard index must be between 0 and ${header.shardCount - 1}`,
        );
    }
}

export function validateTranslationBenchCheckpointRow<T>(
    row: TranslationBenchCheckpointRow<T>,
): void {
    if (row?.kind !== "translation-bench-row") {
        throw new Error("Invalid translation bench checkpoint row");
    }
    requireNonEmpty(row.phase, "Translation bench row phase");
    requireNonEmpty(row.model, "Translation bench row model");
    requireNonEmpty(row.scenario, "Translation bench row scenario");
    requireNonEmpty(row.caseId, "Translation bench row caseId");
    canonicalJson(row.value);
}

export function validateTranslationBenchCheckpointRowShard<T>(
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

export function translationBenchCheckpointSettingsEqual(
    left: unknown,
    right: unknown,
): boolean {
    return canonicalJson(left) === canonicalJson(right);
}

export function assertTranslationBenchCheckpointHeadersCompatible(
    actual: TranslationBenchCheckpointHeader,
    expected: TranslationBenchCheckpointHeader,
): void {
    if (actual.runFingerprint !== expected.runFingerprint) {
        throw new Error(
            "Translation bench checkpoint run fingerprint is incompatible",
        );
    }
    if (
        !translationBenchCheckpointSettingsEqual(
            actual.settings,
            expected.settings,
        )
    ) {
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

export function translationBenchResumeKey(
    identity: TranslationBenchWorkIdentity,
): string {
    requireNonEmpty(identity.phase, "Translation bench phase");
    requireNonEmpty(identity.model, "Translation bench model");
    requireNonEmpty(identity.scenario, "Translation bench scenario");
    requireNonEmpty(identity.caseId, "Translation bench caseId");
    return JSON.stringify([
        identity.phase,
        identity.model,
        identity.scenario,
        identity.caseId,
    ]);
}

export function getTranslationBenchShardIndex(
    stableKey: string,
    shardCount: number,
): number {
    requireNonEmpty(stableKey, "Translation bench shard key");
    requireShardCount(shardCount);
    const digest = createHash("sha256").update(stableKey).digest();
    return Number(digest.readBigUInt64BE(0) % BigInt(shardCount));
}

export function validateTranslationBenchCheckpointWork(
    rows: readonly TranslationBenchCheckpointRow[],
    expectedWork: readonly TranslationBenchWorkIdentity[],
    requireComplete: boolean,
): void {
    const expectedKeys = new Set(expectedWork.map(translationBenchResumeKey));
    if (expectedKeys.size !== expectedWork.length) {
        throw new Error(
            "Translation bench expected work contains duplicate identities",
        );
    }
    const actualKeys = new Set<string>();
    for (const row of rows) {
        const key = translationBenchResumeKey(row);
        if (!expectedKeys.has(key)) {
            throw new Error(
                `Unexpected translation bench checkpoint work '${key}'`,
            );
        }
        if (actualKeys.has(key)) {
            throw new Error(`Duplicate translation bench resume key '${key}'`);
        }
        actualKeys.add(key);
    }
    if (!requireComplete) return;
    const missing = [...expectedKeys].filter((key) => !actualKeys.has(key));
    if (missing.length > 0) {
        throw new Error(
            `Translation bench checkpoints are incomplete: missing ${missing.length} work row(s), first '${missing[0]}'`,
        );
    }
}

/**
 * Split checkpoint JSONL into logical lines. A crash during append can leave
 * the final line incomplete; prior complete rows remain resumable.
 */
export function splitTranslationBenchCheckpointLines(text: string): string[] {
    if (text.length === 0) {
        return [];
    }
    const raw = text.endsWith("\n")
        ? text.slice(0, -1).split("\n")
        : text.split("\n");
    if (raw.length === 0) {
        return [];
    }
    if (!text.endsWith("\n")) {
        const last = raw[raw.length - 1]!;
        try {
            JSON.parse(last);
        } catch {
            raw.pop();
        }
    }
    return raw;
}
