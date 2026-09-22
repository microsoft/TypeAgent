// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { isParamSpec } from "./paramTypes.js";
import {
    CREATE_SET,
    LEGACY_RULE_RE,
    VERIFY_SET,
    type ActionParameterFieldGrader,
    type ActionParametersGraderCatalog,
    type ActionParametersGraderEntry,
} from "./paramGraderTypes.js";
function isPlainObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateItemGrader(
    fieldName: string,
    item: unknown,
    actionIdLabel: string,
): void {
    if (!isPlainObject(item)) {
        throw new Error(
            `Invalid item grader for ${actionIdLabel}.${fieldName}: not an object`,
        );
    }
    if (typeof item.create !== "string" || !CREATE_SET.has(item.create)) {
        throw new Error(
            `Invalid item grader for ${actionIdLabel}.${fieldName}: create`,
        );
    }
    if (typeof item.verify !== "string" || !VERIFY_SET.has(item.verify)) {
        throw new Error(
            `Invalid item grader for ${actionIdLabel}.${fieldName}: verify`,
        );
    }
    if (typeof item.rule !== "string" || !item.rule.trim()) {
        throw new Error(
            `Invalid item grader for ${actionIdLabel}.${fieldName}: rule`,
        );
    }
    if (LEGACY_RULE_RE.test(item.rule) || /default/i.test(item.rule)) {
        throw new Error(
            `Invalid item grader for ${actionIdLabel}.${fieldName}: legacy/default rule '${item.rule}'`,
        );
    }
    if (
        item.source !== "regex" &&
        item.source !== "hardcode" &&
        item.source !== "llm"
    ) {
        throw new Error(
            `Invalid item grader for ${actionIdLabel}.${fieldName}: source must be regex|hardcode|llm`,
        );
    }
    if (item.item !== undefined) {
        validateItemGrader(`${fieldName}.item`, item.item, actionIdLabel);
    }
}

function validateFieldGrader(
    fieldName: string,
    field: unknown,
    actionIdLabel: string,
): asserts field is ActionParameterFieldGrader {
    if (!isPlainObject(field)) {
        throw new Error(
            `Invalid field grader for ${actionIdLabel}.${fieldName}: not an object`,
        );
    }
    if (typeof field.optional !== "boolean") {
        throw new Error(
            `Invalid field grader for ${actionIdLabel}.${fieldName}: optional`,
        );
    }
    if (!isParamSpec(field.type)) {
        throw new Error(
            `Invalid field grader for ${actionIdLabel}.${fieldName}: type`,
        );
    }
    if (typeof field.typeKind !== "string" || !field.typeKind) {
        throw new Error(
            `Invalid field grader for ${actionIdLabel}.${fieldName}: typeKind`,
        );
    }
    if (typeof field.create !== "string" || !CREATE_SET.has(field.create)) {
        throw new Error(
            `Invalid field grader for ${actionIdLabel}.${fieldName}: create`,
        );
    }
    if (typeof field.verify !== "string" || !VERIFY_SET.has(field.verify)) {
        throw new Error(
            `Invalid field grader for ${actionIdLabel}.${fieldName}: verify`,
        );
    }
    if (typeof field.rule !== "string" || !field.rule.trim()) {
        throw new Error(
            `Invalid field grader for ${actionIdLabel}.${fieldName}: rule`,
        );
    }
    if (LEGACY_RULE_RE.test(field.rule) || /default/i.test(field.rule)) {
        throw new Error(
            `Invalid field grader for ${actionIdLabel}.${fieldName}: legacy/default rule '${field.rule}'`,
        );
    }
    if (
        field.source !== "regex" &&
        field.source !== "hardcode" &&
        field.source !== "llm"
    ) {
        throw new Error(
            `Invalid field grader for ${actionIdLabel}.${fieldName}: source must be regex|hardcode|llm`,
        );
    }
    if (field.item !== undefined) {
        validateItemGrader(fieldName, field.item, actionIdLabel);
    }
}

function validateGraderEntry(
    id: string,
    entry: unknown,
): asserts entry is ActionParametersGraderEntry {
    if (!isPlainObject(entry)) {
        throw new Error(`Invalid grader entry for ${id}: not an object`);
    }
    if (typeof entry.schemaName !== "string" || !entry.schemaName) {
        throw new Error(`Invalid grader entry for ${id}: schemaName`);
    }
    if (typeof entry.actionName !== "string" || !entry.actionName) {
        throw new Error(`Invalid grader entry for ${id}: actionName`);
    }
    if (!isParamSpec(entry.paramSpec)) {
        throw new Error(`Invalid grader entry for ${id}: paramSpec`);
    }
    if (
        typeof entry.sourceFingerprint !== "string" ||
        !/^[0-9a-f]{16}$/.test(entry.sourceFingerprint)
    ) {
        throw new Error(`Invalid grader entry for ${id}: sourceFingerprint`);
    }
    // Load skips fingerprint recompute; build path force-rebuilds on rules/hash drift.
    if (!isPlainObject(entry.fields)) {
        throw new Error(`Invalid grader entry for ${id}: fields`);
    }
    for (const [name, field] of Object.entries(entry.fields)) {
        validateFieldGrader(name, field, id);
    }
    if (
        !isPlainObject(entry.parameterScore) ||
        !isPlainObject(entry.parameterScore.fields)
    ) {
        throw new Error(`Invalid grader entry for ${id}: parameterScore`);
    }
    const defaultMode = entry.parameterScore.defaultMode;
    if (typeof defaultMode !== "string" || !VERIFY_SET.has(defaultMode)) {
        throw new Error(
            `Invalid grader entry for ${id}: parameterScore.defaultMode`,
        );
    }
    const scoreFields = entry.parameterScore.fields as Record<string, unknown>;
    const fieldKeys = new Set(Object.keys(entry.fields));
    const scoreKeys = new Set(Object.keys(scoreFields));
    if (fieldKeys.size !== scoreKeys.size) {
        throw new Error(
            `Invalid grader entry for ${id}: parameterScore.fields key set ≠ fields`,
        );
    }
    for (const name of fieldKeys) {
        if (!scoreKeys.has(name)) {
            throw new Error(
                `Invalid grader entry for ${id}: parameterScore.fields missing '${name}'`,
            );
        }
        const mode = scoreFields[name];
        if (typeof mode !== "string" || !VERIFY_SET.has(mode)) {
            throw new Error(
                `Invalid grader entry for ${id}: parameterScore.fields.${name} mode`,
            );
        }
        const field = entry.fields[name] as ActionParameterFieldGrader;
        if (mode !== field.verify) {
            throw new Error(
                `Invalid grader entry for ${id}: parameterScore.fields.${name} !== fields.${name}.verify`,
            );
        }
    }
    // Object paramSpec field keys must match grader fields.
    if (entry.paramSpec.kind === "object") {
        const expected = new Set(Object.keys(entry.paramSpec.fields));
        if (
            expected.size !== fieldKeys.size ||
            [...expected].some((k) => !fieldKeys.has(k))
        ) {
            throw new Error(
                `Invalid grader entry for ${id}: fields keys ≠ paramSpec.fields`,
            );
        }
    }
}

export function loadActionParametersGraderCatalogFile(
    filePath: string,
): ActionParametersGraderCatalog | undefined {
    if (!existsSync(filePath)) {
        return undefined;
    }
    const raw = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    if (!isPlainObject(raw)) {
        throw new Error(`Invalid grader catalog at ${filePath}`);
    }
    if (raw.version !== 1 || !isPlainObject(raw.byAction)) {
        throw new Error(
            `Unsupported or corrupt grader catalog at ${filePath} (expected version 1 + byAction object)`,
        );
    }
    for (const [id, entry] of Object.entries(raw.byAction)) {
        validateGraderEntry(id, entry);
    }
    return raw as unknown as ActionParametersGraderCatalog;
}

const requireFromHere = createRequire(import.meta.url);
let cachedPackagedActionParametersGrader:
    | ActionParametersGraderCatalog
    | undefined;

/**
 * Packaged deterministic parameter grader, loaded from the generated JSON that
 * ships with the benchmark. Cached; used to derive per-case `parameterScore`
 * specs so the runner soft-matches params (e.g. free-text `nonempty`) instead
 * of exact-matching everything.
 */
export function getPackagedActionParametersGraderCatalog(): ActionParametersGraderCatalog {
    if (cachedPackagedActionParametersGrader === undefined) {
        const graderPath = requireFromHere.resolve(
            "../../action-parameters-grader.generated.json",
        );
        const catalog = loadActionParametersGraderCatalogFile(graderPath);
        if (catalog === undefined) {
            throw new Error(
                `Missing packaged action-parameters grader at ${graderPath}`,
            );
        }
        cachedPackagedActionParametersGrader = catalog;
    }
    return cachedPackagedActionParametersGrader;
}

export function clearPackagedActionParametersGraderCacheForTests(): void {
    cachedPackagedActionParametersGrader = undefined;
}
