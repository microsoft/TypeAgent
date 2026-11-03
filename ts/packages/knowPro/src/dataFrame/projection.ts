// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { parseTemporalValue } from "../temporal.js";

export type FrameScalar =
    | string
    | number
    | boolean
    | null
    | { kind: "calendar" | "instant"; raw: string };
export type FrameValue = FrameScalar | FrameScalar[];
export type FrameField = {
    type: "string" | "number" | "boolean" | "calendar" | "instant";
    optional?: boolean | undefined;
    multiple?: boolean | undefined;
    unit?: string | undefined;
    description?: string | undefined;
};
export interface FrameSchema {
    id: string;
    revision: number;
    description: string;
    fields: Record<string, FrameField>;
}
export interface FrameEvidence {
    sourceId: string;
    revisionId: string;
    locator: string;
    excerpt: string;
    evidence?: { kind: "event"; eventId: string } | undefined;
}
export interface FrameRow {
    schemaId: string;
    schemaRevision: number;
    itemKey: string;
    values: Record<string, FrameValue>;
    valueStates?:
        | Record<
              string,
              "unknown" | "unevaluated" | "unavailable" | "conflicted"
          >
        | undefined;
    eligible: boolean;
    origin: "source" | "user" | "derived";
    granularity: "source" | "view" | "section" | "record";
    evidence: FrameEvidence[];
    opposition: FrameEvidence[];
}
export interface FrameOwnerProjection {
    ownerKey: string;
    revisionId: string;
    fingerprint: string;
    dependencies: { sourceId: string; revisionId: string }[];
    rows: FrameRow[];
}
export type FrameComparison = {
    fieldId: string;
    op: "eq" | "neq" | "lt" | "lte" | "gt" | "gte";
    value: Exclude<FrameScalar, null>;
    unit?: string | undefined;
};
export type FramePredicate =
    | { and: FrameComparison[] }
    | { or: FrameComparison[] };
export interface FrameProjectionReceipt {
    ownerKey: string;
    revisionId: string;
    fingerprint: string;
    state: "pending" | "ready" | "failed";
    error?: string | undefined;
}
export interface FrameMatch extends FrameRow {
    ownerKey: string;
    ownerRevisionId: string;
}
export interface FrameProjectionStore {
    registerSchema(schema: FrameSchema): void;
    schemas(): FrameSchema[];
    receipts(): FrameProjectionReceipt[];
    stage(projection: FrameOwnerProjection): void;
    commit(projection: FrameOwnerProjection): void;
    fail(projection: FrameOwnerProjection, error: string): void;
    purgeDependency(sourceId: string): void;
    retainOwners(ownerKeys: ReadonlySet<string>): void;
    retainSchemas(keys: ReadonlySet<string>): void;
    query(
        schema: FrameSchema,
        predicate: FramePredicate,
        owners: ReadonlyMap<string, string>,
        includeUnconfirmed: boolean,
    ): FrameMatch[];
    close(): void;
}
export interface FrameProjectionDescriptor {
    schema: FrameSchema;
    rowsPointer: string;
    itemKeyPointer: string;
    fields: Record<string, string>;
    blockIdPointer?: string;
}

export function frameRecordValue<T>(
    record: Readonly<Record<string, T>> | undefined,
    id: string,
): T | undefined {
    return record && Object.prototype.hasOwnProperty.call(record, id)
        ? record[id]
        : undefined;
}

export function assertFrameSchema(schema: FrameSchema): void {
    if (
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(schema.id) ||
        !Number.isSafeInteger(schema.revision) ||
        schema.revision < 1 ||
        typeof schema.description !== "string" ||
        !schema.description ||
        schema.description.length > 120000 ||
        Object.keys(schema.fields).length === 0 ||
        Object.keys(schema.fields).length > 64
    )
        throw new Error("Invalid frame schema");
    for (const [id, field] of Object.entries(schema.fields)) {
        if (
            !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(id) ||
            !["string", "number", "boolean", "calendar", "instant"].includes(
                field.type,
            ) ||
            (field.optional !== undefined &&
                typeof field.optional !== "boolean") ||
            (field.multiple !== undefined &&
                typeof field.multiple !== "boolean") ||
            (field.description !== undefined &&
                (typeof field.description !== "string" ||
                    field.description.length > 2000)) ||
            (field.unit !== undefined &&
                (typeof field.unit !== "string" ||
                    field.type !== "number" ||
                    !field.unit.trim() ||
                    field.unit.length > 200))
        )
            throw new Error(`Invalid frame field ${id}`);
    }
}

export function frameValueKey(
    field: FrameField,
    value: FrameScalar,
): string | number | undefined {
    if (value === null) return undefined;
    switch (field.type) {
        case "string":
            if (
                typeof value === "string" &&
                value.length <= 120000 &&
                !/[\uD800-\uDFFF]/u.test(value)
            )
                return value;
            break;
        case "number":
            if (typeof value === "number" && Number.isFinite(value))
                return value;
            break;
        case "boolean":
            if (typeof value === "boolean") return Number(value);
            break;
        case "calendar":
        case "instant":
            if (
                typeof value === "object" &&
                value.kind === field.type &&
                typeof value.raw === "string" &&
                value.raw.length <= 100 &&
                Object.keys(value).every(
                    (key) => key === "kind" || key === "raw",
                )
            ) {
                const temporal = parseTemporalValue(value.raw);
                if (field.type === "instant" && temporal.instantUtc)
                    return Date.parse(temporal.instantUtc);
                if (field.type === "calendar" && temporal.kind !== "instant")
                    return temporal.localDateTime;
            }
    }
    throw new Error(`Invalid ${field.type} frame value`);
}

export function frameComparisons(
    schema: FrameSchema,
    predicate: FramePredicate,
): FrameComparison[] {
    if (
        !predicate ||
        typeof predicate !== "object" ||
        Object.keys(predicate).length !== 1
    )
        throw new Error("Invalid frame predicate");
    const terms = "and" in predicate ? predicate.and : predicate.or;
    if (
        !Array.isArray(terms) ||
        terms.length > 64 ||
        ("and" in predicate && "or" in predicate)
    )
        throw new Error("Invalid frame predicate");
    for (const term of terms) {
        if (
            !term ||
            typeof term !== "object" ||
            Object.keys(term).some(
                (key) => !["fieldId", "op", "value", "unit"].includes(key),
            )
        )
            throw new Error("Invalid frame comparison");
        const field = Object.prototype.hasOwnProperty.call(
            schema.fields,
            term.fieldId,
        )
            ? schema.fields[term.fieldId]
            : undefined;
        if (!field) throw new Error(`Unknown frame field ${term.fieldId}`);
        if (
            !["eq", "neq", "lt", "lte", "gt", "gte"].includes(term.op) ||
            (field.type === "boolean" && term.op !== "eq" && term.op !== "neq")
        )
            throw new Error(`Unsupported frame comparison for ${term.fieldId}`);
        if (term.unit !== undefined && term.unit !== field.unit)
            throw new Error(`Incompatible frame unit for ${term.fieldId}`);
        if (frameValueKey(field, term.value) === undefined)
            throw new Error("Null is not a frame comparison value");
    }
    return terms;
}

export function validateFrameRows(
    projection: FrameOwnerProjection,
    schemas: FrameSchema[],
): void {
    if (
        !projection.ownerKey ||
        !projection.revisionId ||
        !projection.fingerprint
    )
        throw new Error("Invalid frame owner projection");
    const keys = new Set<string>();
    for (const row of projection.rows) {
        const schema = schemas.find(
            (s) => s.id === row.schemaId && s.revision === row.schemaRevision,
        );
        if (!schema) throw new Error(`Unknown frame schema ${row.schemaId}`);
        const key = JSON.stringify([
            row.schemaId,
            row.schemaRevision,
            row.itemKey,
        ]);
        if (!row.itemKey || row.itemKey.length > 2000 || keys.has(key))
            throw new Error("Duplicate or empty frame item key");
        keys.add(key);
        for (const [id, state] of Object.entries(row.valueStates ?? {}))
            if (
                !Object.prototype.hasOwnProperty.call(schema.fields, id) ||
                ![
                    "unknown",
                    "unevaluated",
                    "unavailable",
                    "conflicted",
                ].includes(state)
            )
                throw new Error(`Invalid frame value state ${id}`);
        for (const id of Object.keys(row.values))
            if (!frameRecordValue(schema.fields, id))
                throw new Error(`Unknown frame field ${id}`);
        validateFrameValues(row, schema);
    }
}

function validateFrameValues(row: FrameRow, schema: FrameSchema): void {
    for (const [id, field] of Object.entries(schema.fields)) {
        const value = frameRecordValue(row.values, id);
        if (value === undefined) {
            if (!field.optional && !frameRecordValue(row.valueStates, id))
                throw new Error(`Missing frame field ${id}`);
            continue;
        }
        if (Array.isArray(value) && (!field.multiple || value.length > 10000))
            throw new Error(`Frame field ${id} is not multi-valued`);
        for (const scalar of Array.isArray(value) ? value : [value])
            frameValueKey(field, scalar);
    }
}

export function matchesFrame(
    row: FrameRow,
    schema: FrameSchema,
    predicate: FramePredicate,
): boolean {
    const terms = frameComparisons(schema, predicate);
    const matches = (term: FrameComparison) => {
        if (frameRecordValue(row.valueStates, term.fieldId)) return false;
        const value = frameRecordValue(row.values, term.fieldId);
        if (value === undefined) return false;
        const field = schema.fields[term.fieldId];
        const expected = frameValueKey(field, term.value)!;
        return (Array.isArray(value) ? value : [value]).some((scalar) => {
            const actual = frameValueKey(field, scalar);
            if (actual === undefined) return false;
            const order =
                term.op === "eq" || term.op === "neq"
                    ? 0
                    : compareFrameKeys(actual, expected);
            switch (term.op) {
                case "eq":
                    return actual === expected;
                case "neq":
                    return actual !== expected;
                case "lt":
                    return order < 0;
                case "lte":
                    return order <= 0;
                case "gt":
                    return order > 0;
                case "gte":
                    return order >= 0;
            }
        });
    };
    return "and" in predicate ? terms.every(matches) : terms.some(matches);
}

// SQLite BINARY orders well-formed UTF-8 by Unicode scalar value.
function compareFrameKeys(
    left: string | number,
    right: string | number,
): number {
    if (typeof left === "string" && typeof right === "string") {
        const a = Array.from(left, (character) => character.codePointAt(0)!);
        const b = Array.from(right, (character) => character.codePointAt(0)!);
        for (let i = 0; i < Math.min(a.length, b.length); i++)
            if (a[i] !== b[i]) return a[i] - b[i];
        return a.length - b.length;
    }
    return left < right ? -1 : left > right ? 1 : 0;
}

export class MemoryFrameProjectionStore implements FrameProjectionStore {
    private readonly catalog = new Map<string, FrameSchema>();
    private readonly pending = new Map<string, FrameProjectionReceipt>();
    private readonly owners = new Map<string, FrameOwnerProjection>();
    private readonly dependencies = new Map<string, Set<string>>();
    private readonly ownerSchemas = new Map<string, Set<string>>();

    registerSchema(schema: FrameSchema): void {
        assertFrameSchema(schema);
        const key = JSON.stringify([schema.id, schema.revision]);
        const old = this.catalog.get(key);
        if (old && JSON.stringify(old) !== JSON.stringify(schema))
            throw new Error("Frame schema revision is immutable");
        this.catalog.set(key, structuredClone(schema));
    }
    schemas() {
        return structuredClone(
            [...this.catalog.values()].sort((a, b) =>
                a.id < b.id ? -1 : a.id > b.id ? 1 : a.revision - b.revision,
            ),
        );
    }
    receipts() {
        return structuredClone(
            [...this.pending.values()].sort((a, b) =>
                a.ownerKey < b.ownerKey ? -1 : a.ownerKey > b.ownerKey ? 1 : 0,
            ),
        );
    }
    stage(projection: FrameOwnerProjection): void {
        validateFrameRows(projection, this.schemas());
        const dependencies =
            this.dependencies.get(projection.ownerKey) ?? new Set<string>();
        for (const dep of projection.dependencies)
            dependencies.add(dep.sourceId);
        this.dependencies.set(projection.ownerKey, dependencies);
        const schemas =
            this.ownerSchemas.get(projection.ownerKey) ?? new Set<string>();
        for (const row of projection.rows)
            schemas.add(JSON.stringify([row.schemaId, row.schemaRevision]));
        this.ownerSchemas.set(projection.ownerKey, schemas);
        this.pending.set(projection.ownerKey, {
            ownerKey: projection.ownerKey,
            revisionId: projection.revisionId,
            fingerprint: projection.fingerprint,
            state: "pending",
        });
    }
    commit(projection: FrameOwnerProjection): void {
        const receipt = this.pending.get(projection.ownerKey);
        if (
            receipt?.fingerprint !== projection.fingerprint ||
            receipt.revisionId !== projection.revisionId ||
            receipt.state !== "pending"
        )
            throw new Error("Frame projection intent is stale");
        validateFrameRows(projection, this.schemas());
        this.owners.set(projection.ownerKey, structuredClone(projection));
        this.ownerSchemas.set(
            projection.ownerKey,
            new Set(
                projection.rows.map((row) =>
                    JSON.stringify([row.schemaId, row.schemaRevision]),
                ),
            ),
        );
        receipt.state = "ready";
        this.dependencies.set(
            projection.ownerKey,
            new Set(projection.dependencies.map((dep) => dep.sourceId)),
        );
    }
    fail(projection: FrameOwnerProjection, error: string): void {
        const receipt = this.pending.get(projection.ownerKey);
        if (
            receipt?.fingerprint !== projection.fingerprint ||
            receipt.revisionId !== projection.revisionId ||
            receipt.state !== "pending"
        )
            throw new Error("Frame projection intent is stale");
        receipt.state = "failed";
        receipt.error = error;
    }
    purgeDependency(sourceId: string): void {
        const retained = new Set(
            [...this.pending.keys()].filter(
                (key) => !this.dependencies.get(key)?.has(sourceId),
            ),
        );
        this.retainOwners(retained);
        this.retainSchemas(
            new Set(
                [...this.ownerSchemas.values()].flatMap((schemas) => [
                    ...schemas,
                ]),
            ),
        );
    }
    retainSchemas(keys: ReadonlySet<string>): void {
        for (const [key, schema] of this.catalog)
            if (!keys.has(JSON.stringify([schema.id, schema.revision])))
                this.catalog.delete(key);
    }
    retainOwners(keys: ReadonlySet<string>): void {
        for (const key of this.pending.keys())
            if (!keys.has(key)) {
                this.pending.delete(key);
                this.owners.delete(key);
                this.dependencies.delete(key);
                this.ownerSchemas.delete(key);
            }
    }
    query(
        schema: FrameSchema,
        predicate: FramePredicate,
        owners: ReadonlyMap<string, string>,
        includeUnconfirmed: boolean,
    ): FrameMatch[] {
        frameComparisons(schema, predicate);
        return [...this.owners.values()].flatMap((owner) =>
            this.pending.get(owner.ownerKey)?.state === "ready" &&
            owners.get(owner.ownerKey) === owner.fingerprint
                ? owner.rows
                      .filter(
                          (row) =>
                              row.schemaId === schema.id &&
                              row.schemaRevision === schema.revision &&
                              (includeUnconfirmed || row.eligible) &&
                              matchesFrame(row, schema, predicate),
                      )
                      .map((row) => ({
                          ...structuredClone(row),
                          ownerKey: owner.ownerKey,
                          ownerRevisionId: owner.revisionId,
                      }))
                : [],
        );
    }
    close() {}
}

export function framePointer(value: unknown, pointer: string): unknown {
    if (pointer === "") return value;
    if (!pointer.startsWith("/") || /~(?![01])/u.test(pointer))
        throw new Error("Invalid frame JSON pointer");
    const keys = pointer
        .slice(1)
        .split("/")
        .map((component) =>
            component.replaceAll("~1", "/").replaceAll("~0", "~"),
        );
    for (const key of keys) {
        if (key === "__proto__" || key === "constructor" || key === "prototype")
            throw new Error("Unsafe frame JSON pointer");
    }
    for (const key of keys) {
        if (!value || typeof value !== "object") return undefined;
        value = Object.prototype.hasOwnProperty.call(value, key)
            ? Reflect.get(value, key)
            : undefined;
    }
    return value;
}

export function assertFrameDescriptor(
    descriptor: FrameProjectionDescriptor,
): void {
    assertFrameSchema(descriptor.schema);
    framePointer({}, descriptor.rowsPointer);
    framePointer({}, descriptor.itemKeyPointer);
    if (descriptor.blockIdPointer !== undefined)
        framePointer({}, descriptor.blockIdPointer);
    for (const [id, pointer] of Object.entries(descriptor.fields)) {
        if (!Object.prototype.hasOwnProperty.call(descriptor.schema.fields, id))
            throw new Error(`Unknown projected frame field ${id}`);
        framePointer({}, pointer);
    }
}
export function assertFrameDescriptorInventory(
    descriptors: readonly FrameProjectionDescriptor[],
    providerId: string,
    kind: "source" | "view",
): void {
    if (!Array.isArray(descriptors) || descriptors.length > 64)
        throw new Error("Invalid provider frame inventory");
    const ids = new Set<string>();
    for (const descriptor of descriptors) {
        assertFrameDescriptor(descriptor);
        if (
            !descriptor.schema.id.startsWith(`${providerId}.`) ||
            /^(source|question|project)\./.test(descriptor.schema.id) ||
            ids.has(descriptor.schema.id)
        )
            throw new Error(
                "Frame provider requires unique schemas in its own namespace",
            );
        if (kind === "view" && !descriptor.blockIdPointer)
            throw new Error("View frame projection requires block evidence");
        ids.add(descriptor.schema.id);
    }
}
