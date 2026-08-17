// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import fs from "node:fs";

import type { TranslationBenchExplainerCaseResult } from "./explainer.js";
import type { TranslationBenchBenchmarkSchema } from "../synthesizer/benchmark.js";
import {
    aggregateTranslationBenchRows,
    groupTranslationBenchRowsByAction,
    groupTranslationBenchRowsByDimensions,
    type TranslationBenchBreakdown,
    type TranslationBenchRow,
    type TranslationBenchRunResult,
} from "./runner.js";

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

export type TranslationBenchTranslationCheckpointRow =
    TranslationBenchCheckpointRow<TranslationBenchRow> & {
        phase: "translation";
    };

export type TranslationBenchExplainerCheckpointRow =
    TranslationBenchCheckpointRow<TranslationBenchExplainerCaseResult> & {
        phase: "explainer";
    };

export type TranslationBenchExecutionCheckpointRow =
    | TranslationBenchTranslationCheckpointRow
    | TranslationBenchExplainerCheckpointRow;

export type TranslationBenchRunMetadata = Pick<
    TranslationBenchRunResult,
    "schemaHashes" | "settings"
>;

export interface TranslationBenchExecutionMergeResult
    extends TranslationBenchMergeResult<
        TranslationBenchRow | TranslationBenchExplainerCaseResult
    > {
    runResult: TranslationBenchRunResult;
    explainerRows: TranslationBenchExplainerCaseResult[];
}

export interface TranslationBenchExecutionResult {
    runResult: TranslationBenchRunResult;
    explainerRows: TranslationBenchExplainerCaseResult[];
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

function validateHeader(header: TranslationBenchCheckpointHeader): void {
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

function validateRow<T>(row: TranslationBenchCheckpointRow<T>): void {
    if (row?.kind !== "translation-bench-row") {
        throw new Error("Invalid translation bench checkpoint row");
    }
    requireNonEmpty(row.phase, "Translation bench row phase");
    requireNonEmpty(row.model, "Translation bench row model");
    requireNonEmpty(row.scenario, "Translation bench row scenario");
    requireNonEmpty(row.caseId, "Translation bench row caseId");
    canonicalJson(row.value);
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
 * Split checkpoint JSONL into logical lines.
 * If the file was truncated mid-write (crash during append), drop only the
 * final incomplete line so prior complete trajectory rows remain resumable.
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
    // Incomplete trailing line: no terminating newline when the process died
    // mid-append. Keep all prior full lines.
    if (!text.endsWith("\n") && raw.length > 0) {
        const last = raw[raw.length - 1]!;
        try {
            JSON.parse(last);
        } catch {
            raw.pop();
        }
    }
    return raw;
}

export function readTranslationBenchCheckpoint<T = unknown>(
    filePath: string,
): TranslationBenchCheckpoint<T> {
    const text = fs.readFileSync(filePath, "utf8");
    const lines = splitTranslationBenchCheckpointLines(text);
    if (lines.length === 0 || (lines.length === 1 && lines[0] === "")) {
        throw new Error(`Translation bench checkpoint '${filePath}' is empty`);
    }
    if (lines.some((line) => line.trim().length === 0)) {
        throw new Error(
            `Translation bench checkpoint '${filePath}' contains a blank line`,
        );
    }

    const parsed = lines.map((line, index) => {
        try {
            return JSON.parse(line) as unknown;
        } catch (error) {
            throw new Error(
                `Invalid translation bench checkpoint JSON on line ${index + 1}: ${String(error)}`,
            );
        }
    });
    const checkpointHeader = parsed[0] as TranslationBenchCheckpointHeader;
    validateHeader(checkpointHeader);
    const rows: TranslationBenchCheckpointRow<T>[] = [];
    const resumeKeys = new Set<string>();
    for (let index = 1; index < parsed.length; index++) {
        const row = parsed[index] as TranslationBenchCheckpointRow<T>;
        validateRow(row);
        validateRowShard(row, checkpointHeader);
        const key = translationBenchResumeKey(row);
        if (resumeKeys.has(key)) {
            throw new Error(`Duplicate translation bench resume key '${key}'`);
        }
        resumeKeys.add(key);
        rows.push(row);
    }
    return { header: checkpointHeader, rows, resumeKeys };
}

function fsyncPath(filePath: string): void {
    const fd = fs.openSync(filePath, "r+");
    try {
        fs.fsyncSync(fd);
    } finally {
        fs.closeSync(fd);
    }
}

export function appendTranslationBenchCheckpointRows<T = unknown>(
    filePath: string,
    checkpointHeader: TranslationBenchCheckpointHeader,
    rows: readonly TranslationBenchCheckpointRow<T>[],
    /**
     * Optional in-memory view from the previous append. When provided (and the
     * single writer serializes calls), skips a full-file re-read so per-row
     * trajectory appends stay O(batch) instead of O(file).
     */
    prior?: TranslationBenchCheckpoint<T>,
): TranslationBenchCheckpoint<T> {
    validateHeader(checkpointHeader);
    const batchKeys = new Set<string>();
    for (const row of rows) {
        validateRow(row);
        validateRowShard(row, checkpointHeader);
        const key = translationBenchResumeKey(row);
        if (batchKeys.has(key)) {
            throw new Error(`Duplicate translation bench resume key '${key}'`);
        }
        batchKeys.add(key);
    }

    let current: TranslationBenchCheckpoint<T>;
    if (prior !== undefined) {
        assertCompatibleHeaders(prior.header, checkpointHeader);
        current = prior;
    } else if (fs.existsSync(filePath)) {
        current = readTranslationBenchCheckpoint<T>(filePath);
        assertCompatibleHeaders(current.header, checkpointHeader);
    } else {
        try {
            fs.writeFileSync(filePath, `${canonicalJson(checkpointHeader)}\n`, {
                flag: "wx",
            });
            fsyncPath(filePath);
            current = {
                header: checkpointHeader,
                rows: [],
                resumeKeys: new Set(),
            };
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (code !== "EEXIST") throw error;
            current = readTranslationBenchCheckpoint<T>(filePath);
            assertCompatibleHeaders(current.header, checkpointHeader);
        }
    }

    for (const key of batchKeys) {
        if (current.resumeKeys.has(key)) {
            throw new Error(`Duplicate translation bench resume key '${key}'`);
        }
    }
    if (rows.length > 0) {
        // One append of complete newline-terminated records, then fsync so a
        // crash cannot lose accepted trajectory rows already acknowledged.
        fs.appendFileSync(
            filePath,
            rows.map((row) => `${canonicalJson(row)}\n`).join(""),
        );
        fsyncPath(filePath);
    }
    return {
        header: current.header,
        rows: [...current.rows, ...rows],
        resumeKeys: new Set([...current.resumeKeys, ...batchKeys]),
    };
}

function countBy(
    rows: readonly TranslationBenchCheckpointRow[],
    getValue: (row: TranslationBenchCheckpointRow) => string,
): Record<string, number> {
    const counts = new Map<string, number>();
    for (const row of rows) {
        const value = getValue(row);
        counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return Object.fromEntries(
        [...counts.entries()].sort(([left], [right]) =>
            compareText(left, right),
        ),
    );
}

function requireRecord(
    value: unknown,
    name: string,
): asserts value is Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`${name} must be an object`);
    }
}

function validateExecutionCheckpointRow(
    row: TranslationBenchCheckpointRow<
        TranslationBenchRow | TranslationBenchExplainerCaseResult
    >,
): asserts row is TranslationBenchExecutionCheckpointRow {
    requireRecord(row.value, "Translation bench checkpoint row value");
    const value = row.value;
    if (row.phase === "translation") {
        if (
            value.caseId !== row.caseId ||
            value.model !== row.model ||
            value.scenarioId !== row.scenario ||
            typeof value.score !== "object" ||
            typeof value.usage !== "object"
        ) {
            throw new Error(
                `Translation bench translation checkpoint identity does not match '${translationBenchResumeKey(row)}'`,
            );
        }
        return;
    }
    if (row.phase === "explainer") {
        if (
            value.caseId !== row.caseId ||
            value.model !== row.model ||
            row.scenario !== "construction" ||
            typeof value.summary !== "object" ||
            typeof value.explanationUsage !== "object"
        ) {
            throw new Error(
                `Translation bench explainer checkpoint identity does not match '${translationBenchResumeKey(row)}'`,
            );
        }
        return;
    }
    throw new Error(
        `Unsupported translation bench checkpoint phase '${row.phase}'`,
    );
}

export function createTranslationBenchTranslationCheckpointRow(
    row: TranslationBenchRow,
): TranslationBenchTranslationCheckpointRow {
    return {
        kind: "translation-bench-row",
        phase: "translation",
        model: row.model,
        scenario: row.scenarioId,
        caseId: row.caseId,
        value: row,
    };
}

export function createTranslationBenchExplainerCheckpointRow(
    row: TranslationBenchExplainerCaseResult,
): TranslationBenchExplainerCheckpointRow {
    let value = row;
    if (row.ruleJson !== undefined) {
        const serializedRule = JSON.stringify(row.ruleJson);
        if (serializedRule === undefined) {
            throw new Error(
                "Translation bench explainer rule is not JSON serializable",
            );
        }
        value = {
            ...row,
            ruleJson: JSON.parse(serializedRule) as unknown,
        };
    }
    return {
        kind: "translation-bench-row",
        phase: "explainer",
        model: row.model,
        scenario: "construction",
        caseId: row.caseId,
        value,
    };
}

function groupExecutionRows(
    rows: TranslationBenchRow[],
    getKey: (row: TranslationBenchRow) => string,
): TranslationBenchBreakdown[] {
    const groups = new Map<string, TranslationBenchRow[]>();
    for (const row of rows) {
        const key = getKey(row);
        const group = groups.get(key) ?? [];
        group.push(row);
        groups.set(key, group);
    }
    return [...groups.entries()]
        .sort(([left], [right]) => compareText(left, right))
        .map(([key, group]) => ({
            key,
            summary: aggregateTranslationBenchRows(group),
        }));
}

export function rebuildTranslationBenchRunResult(
    inputRows: readonly TranslationBenchRow[],
    metadata: TranslationBenchRunMetadata,
): TranslationBenchRunResult {
    const rows = [...inputRows].sort((left, right) =>
        compareText(
            JSON.stringify([left.model, left.scenarioId, left.caseId]),
            JSON.stringify([right.model, right.scenarioId, right.caseId]),
        ),
    );
    return {
        rows,
        summary: aggregateTranslationBenchRows(rows),
        byModel: groupExecutionRows(rows, (row) => row.model),
        byScenario: groupExecutionRows(
            rows,
            (row) => `model=${row.model};scenario=${row.scenarioId}`,
        ),
        byActionCount: groupExecutionRows(rows, (row) => {
            const expectedActions =
                row.expectedActions.length === 0
                    ? "abstain"
                    : row.expectedActions.length === 1
                      ? "single"
                      : `multi-${row.expectedActions.length}`;
            return `model=${row.model};activeActions=${row.activeActionCount};expectedActions=${expectedActions}`;
        }),
        byAction: groupTranslationBenchRowsByAction(rows),
        byDimension: groupTranslationBenchRowsByDimensions(rows),
        byShape: groupExecutionRows(
            rows,
            (row) => `model=${row.model};${row.shape.key}`,
        ),
        schemaHashes: structuredClone(metadata.schemaHashes),
        settings: structuredClone(metadata.settings),
    };
}

export function rebuildTranslationBenchExecutionRows(
    rows: readonly TranslationBenchCheckpointRow<
        TranslationBenchRow | TranslationBenchExplainerCaseResult
    >[],
    metadata: TranslationBenchRunMetadata,
): TranslationBenchExecutionResult {
    const translationRows: TranslationBenchRow[] = [];
    const explainerRows: TranslationBenchExplainerCaseResult[] = [];
    for (const row of rows) {
        validateExecutionCheckpointRow(row);
        if (row.phase === "translation") {
            translationRows.push(row.value);
        } else {
            explainerRows.push(row.value);
        }
    }
    explainerRows.sort((left, right) =>
        compareText(
            JSON.stringify([left.model, left.caseId]),
            JSON.stringify([right.model, right.caseId]),
        ),
    );
    return {
        runResult: rebuildTranslationBenchRunResult(translationRows, metadata),
        explainerRows,
    };
}

export function mergeTranslationBenchExecutionCheckpoints(
    checkpoints: readonly TranslationBenchCheckpoint<
        TranslationBenchRow | TranslationBenchExplainerCaseResult
    >[],
    metadata: TranslationBenchRunMetadata,
): TranslationBenchExecutionMergeResult {
    const merged = mergeTranslationBenchCheckpoints(checkpoints);
    const rebuilt = rebuildTranslationBenchExecutionRows(merged.rows, metadata);
    return {
        ...merged,
        ...rebuilt,
    };
}

export function mergeTranslationBenchCheckpoints<T = unknown>(
    checkpoints: readonly TranslationBenchCheckpoint<T>[],
): TranslationBenchMergeResult<T> {
    if (checkpoints.length === 0) {
        throw new Error("No translation bench checkpoints to merge");
    }
    for (const checkpoint of checkpoints) {
        validateHeader(checkpoint.header);
        const localKeys = new Set<string>();
        for (const row of checkpoint.rows) {
            validateRow(row);
            const key = translationBenchResumeKey(row);
            if (localKeys.has(key)) {
                throw new Error(
                    `Duplicate translation bench resume key '${key}'`,
                );
            }
            localKeys.add(key);
        }
    }

    const first = checkpoints[0]!.header;
    const byShard = new Map<number, TranslationBenchCheckpoint<T>>();
    for (const checkpoint of checkpoints) {
        const current = checkpoint.header;
        if (current.runFingerprint !== first.runFingerprint) {
            throw new Error(
                "Translation bench checkpoint run fingerprints are incompatible",
            );
        }
        if (!settingsEqual(current.settings, first.settings)) {
            throw new Error(
                "Translation bench checkpoint settings are incompatible",
            );
        }
        if (current.shardCount !== first.shardCount) {
            throw new Error(
                "Translation bench checkpoint shard counts are incompatible",
            );
        }
        if (byShard.has(current.shardIndex)) {
            throw new Error(
                `Duplicate translation bench checkpoint shard ${current.shardIndex}`,
            );
        }
        byShard.set(current.shardIndex, checkpoint);
    }

    const missing = Array.from(
        { length: first.shardCount },
        (_, index) => index,
    ).filter((index) => !byShard.has(index));
    if (missing.length > 0) {
        throw new Error(`Missing checkpoint shards: ${missing.join(", ")}`);
    }

    const rows: TranslationBenchCheckpointRow<T>[] = [];
    const resumeKeys = new Set<string>();
    for (let shardIndex = 0; shardIndex < first.shardCount; shardIndex++) {
        const checkpoint = byShard.get(shardIndex)!;
        for (const row of checkpoint.rows) {
            const key = translationBenchResumeKey(row);
            if (resumeKeys.has(key)) {
                throw new Error(
                    `Duplicate translation bench resume key '${key}'`,
                );
            }
            resumeKeys.add(key);
            rows.push(row);
        }
    }
    for (const checkpoint of checkpoints) {
        for (const row of checkpoint.rows) {
            validateRowShard(row, checkpoint.header);
        }
    }
    rows.sort((left, right) =>
        compareText(
            translationBenchResumeKey(left),
            translationBenchResumeKey(right),
        ),
    );

    return {
        runFingerprint: first.runFingerprint,
        settings: first.settings,
        rows,
        counts: {
            shardCount: first.shardCount,
            rowCount: rows.length,
            byPhase: countBy(rows, (row) => row.phase),
            byModel: countBy(rows, (row) => row.model),
            byScenario: countBy(rows, (row) => row.scenario),
        },
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
        requireNonEmpty(
            schema?.schemaName,
            "Translation bench catalog schema name",
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
        requireNonEmpty(
            schema.typeAgent.sourceHash,
            `Translation bench catalog schema '${schema.schemaName}' source hash`,
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
            requireNonEmpty(
                tool.function?.name,
                `Translation bench catalog schema '${schema.schemaName}' action name`,
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
    if (!Number.isSafeInteger(minimumActionCount) || minimumActionCount < 1) {
        throw new Error(
            "Translation bench minimum visible action count must be a positive integer",
        );
    }
    const census = getTranslationBenchCatalogCensus(schemas);
    if (census.actionCount < minimumActionCount) {
        throw new Error(
            `Translation bench requires at least ${minimumActionCount} existing TypeAgent actions; catalog has ${census.actionCount}`,
        );
    }
    return census;
}
