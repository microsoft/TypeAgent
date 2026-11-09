// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    ViewCitation,
    ViewPayloadSchema,
} from "@typeagent/memory-service";
import type { ProcedureRecord } from "./extractionSchema.js";
export type { ProcedureRecord } from "./extractionSchema.js";

export type ProcedureHeader = {
    schemaVersion: 1;
    procedureId: string;
    title: string;
    entryStep: string;
};
export type ProcedureDocument = {
    header: ProcedureHeader;
    headerSpan: { start: number; end: number };
    headerSupport?: ViewCitation[];
    records: Array<{
        record: ProcedureRecord;
        start: number;
        end: number;
        support?: ViewCitation[];
        opposition?: ViewCitation[];
    }>;
};
export class ProcedureContractError extends Error {}

const short: ViewPayloadSchema = { type: "string", maxLength: 128 };
const text: ViewPayloadSchema = { type: "string", maxLength: 1000 };
const object = (
    properties: Record<string, ViewPayloadSchema>,
): ViewPayloadSchema => ({
    type: "object",
    properties,
    required: Object.keys(properties),
});
const base = { kind: short, id: short };
const nullableText: ViewPayloadSchema = {
    type: "union",
    variants: [text, { type: "null" }],
};
const nullableList: ViewPayloadSchema = {
    type: "union",
    variants: [{ type: "array", items: text, maxItems: 10 }, { type: "null" }],
};
export const procedureRecordSchema: ViewPayloadSchema = {
    type: "union",
    variants: [
        object({ ...base, text }),
        object({
            ...base,
            text,
            requiredInputs: { type: "array", items: short, maxItems: 10 },
            expectedObservation: {
                type: "union",
                variants: [text, { type: "null" }],
            },
        }),
        {
            type: "union",
            variants: [
                object({ ...base, from: short, to: short, condition: text }),
                object({
                    ...base,
                    before: short,
                    after: short,
                    condition: text,
                }),
            ],
        },
        object({ ...base, text, result: short }),
        object({
            ...base,
            text,
            actionIds: { type: "array", items: short, maxItems: 32 },
            order: short,
        }),
        object({
            ...base,
            text,
            nodeIds: { type: "array", items: short, maxItems: 32 },
            order: short,
        }),
        object({
            ...base,
            title: text,
            text,
            appliesTo: { type: "array", items: short, maxItems: 8 },
            columns: {
                type: "array",
                items: { type: "string", maxLength: 80 },
                maxItems: 4,
            },
            rows: {
                type: "array",
                maxItems: 8,
                items: {
                    type: "array",
                    items: { type: "string", maxLength: 300 },
                    maxItems: 4,
                },
            },
        }),
        object({
            ...base,
            title: text,
            text,
            canonicalAction: nullableText,
            informationRequests: nullableList,
            formInstruction: nullableText,
            interfaceParameters: nullableList,
            sequence: nullableList,
            selectionCondition: nullableText,
            expectedObservation: nullableText,
        }),
    ],
};
export const procedurePayloadSchema: ViewPayloadSchema = object({
    status: short,
    procedures: {
        type: "array",
        maxItems: 4,
        items: object({
            sourceId: short,
            revisionId: short,
            procedureId: short,
            title: text,
            entryStep: short,
            records: {
                type: "array",
                maxItems: 64,
                items: object({
                    blockId: short,
                    record: procedureRecordSchema,
                }),
            },
        }),
    },
});

export function fields(
    value: unknown,
    keys: string[],
): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new ProcedureContractError("Procedure record must be an object");
    const record = value as Record<string, unknown>;
    if (
        Object.keys(record).length !== keys.length ||
        keys.some((key) => !Object.prototype.hasOwnProperty.call(record, key))
    )
        throw new ProcedureContractError(
            `Procedure record requires exactly: ${keys.join(", ")}`,
        );
    return record;
}
export function string(value: unknown, label: string, max = 1000): string {
    if (typeof value !== "string" || !value.trim() || value.length > max)
        throw new ProcedureContractError(
            `Invalid or unbounded procedure ${label}`,
        );
    return value;
}
function id(value: unknown): string {
    const result = string(value, "identifier", 64);
    if (!/^[a-z][a-z0-9-]*$/.test(result))
        throw new ProcedureContractError(
            "Procedure identifiers must be lowercase kebab-case",
        );
    return result;
}
function optionalText(value: unknown, label: string): string | null {
    return value === null ? null : string(value, label);
}
function optionalList(value: unknown, label: string): string[] | null {
    if (value === null) return null;
    if (!Array.isArray(value) || value.length > 10)
        throw new ProcedureContractError(`Invalid bounded ${label} array`);
    const result = value.map((item) => string(item, label));
    if (new Set(result).size !== result.length)
        throw new ProcedureContractError(`Duplicate ${label}`);
    return result;
}
export function parseHeader(value: unknown): ProcedureHeader {
    const header = fields(value, [
        "schemaVersion",
        "procedureId",
        "title",
        "entryStep",
    ]);
    if (header.schemaVersion !== 1)
        throw new ProcedureContractError(
            "Unsupported procedure source schema version",
        );
    return {
        schemaVersion: 1,
        procedureId: id(header.procedureId),
        title: string(header.title, "title"),
        entryStep: id(header.entryStep),
    };
}
function parseActionCollection(
    value: unknown,
): Extract<ProcedureRecord, { kind: "actionCollection" }> {
    const record = fields(value, ["kind", "id", "text", "actionIds", "order"]);
    if (
        !Array.isArray(record.actionIds) ||
        !record.actionIds.length ||
        record.actionIds.length > 32
    )
        throw new ProcedureContractError(
            "Action collection requires 1 to 32 options",
        );
    if (record.order !== "any-order" && record.order !== "unspecified")
        throw new ProcedureContractError("Unsupported action collection order");
    return {
        kind: "actionCollection",
        id: id(record.id),
        text: string(record.text, "collection instruction"),
        actionIds: record.actionIds.map(id),
        order: record.order,
    };
}

function parseWorkflow(
    value: unknown,
): Extract<ProcedureRecord, { kind: "workflow" }> {
    const record = fields(value, ["kind", "id", "text", "nodeIds", "order"]);
    if (
        record.order !== "partial-order" ||
        !Array.isArray(record.nodeIds) ||
        !record.nodeIds.length ||
        record.nodeIds.length > 32
    )
        throw new ProcedureContractError(
            "Partial-order workflow requires 1 to 32 nodes",
        );
    return {
        kind: "workflow",
        id: id(record.id),
        text: string(record.text, "workflow scope"),
        nodeIds: record.nodeIds.map(id),
        order: record.order,
    };
}

function parseDecisionTable(
    value: unknown,
): Extract<ProcedureRecord, { kind: "decisionTable" }> {
    const record = fields(value, [
        "kind",
        "id",
        "title",
        "text",
        "appliesTo",
        "columns",
        "rows",
    ]);
    if (
        !Array.isArray(record.appliesTo) ||
        !record.appliesTo.length ||
        record.appliesTo.length > 8 ||
        !Array.isArray(record.columns) ||
        record.columns.length < 2 ||
        record.columns.length > 4 ||
        !Array.isArray(record.rows) ||
        !record.rows.length ||
        record.rows.length > 8
    )
        throw new ProcedureContractError(
            "Decision table requires 1 to 8 action references, 2 to 4 columns and 1 to 8 rows",
        );
    const columns = record.columns.map((column) =>
        string(column, "table column", 80),
    );
    const rows = record.rows.map((row) => {
        if (!Array.isArray(row) || row.length !== columns.length)
            throw new ProcedureContractError(
                "Decision table row must match its column count",
            );
        return row.map((cell) => string(cell, "table cell", 300));
    });
    return {
        kind: "decisionTable",
        id: id(record.id),
        title: string(record.title, "table title"),
        text: string(record.text, "table introduction"),
        appliesTo: record.appliesTo.map(id),
        columns,
        rows,
    };
}

function parseStep(value: unknown): Extract<ProcedureRecord, { kind: "step" }> {
    const record = fields(value, [
        "kind",
        "id",
        "text",
        "requiredInputs",
        "expectedObservation",
    ]);
    if (
        !Array.isArray(record.requiredInputs) ||
        record.requiredInputs.length > 10
    )
        throw new ProcedureContractError(
            "Procedure step requires a bounded requiredInputs array",
        );
    return {
        kind: "step",
        id: id(record.id),
        text: string(record.text, "instruction"),
        requiredInputs: record.requiredInputs.map((input) =>
            string(input, "required input", 128),
        ),
        expectedObservation: optionalText(
            record.expectedObservation,
            "observation",
        ),
    };
}

export function parseProcedureRecord(value: unknown): ProcedureRecord {
    if (!value || typeof value !== "object" || !("kind" in value))
        throw new ProcedureContractError("Procedure record kind is required");
    switch (value.kind) {
        case "context":
        case "prerequisite":
        case "guard":
        case "description":
        case "policy":
        case "gap":
        case "metadata": {
            const record = fields(value, ["kind", "id", "text"]);
            return {
                kind: value.kind,
                id: id(record.id),
                text: string(record.text, "text"),
            };
        }
        case "step":
            return parseStep(value);
        case "decisionTable":
            return parseDecisionTable(value);
        case "transition": {
            const record = fields(value, [
                "kind",
                "id",
                "from",
                "to",
                "condition",
            ]);
            return {
                kind: "transition",
                id: id(record.id),
                from: id(record.from),
                to: id(record.to),
                condition: string(record.condition, "condition"),
            };
        }
        case "actionCollection":
            return parseActionCollection(value);
        case "workflow":
            return parseWorkflow(value);
        case "orderingConstraint": {
            const record = fields(value, [
                "kind",
                "id",
                "before",
                "after",
                "condition",
            ]);
            return {
                kind: "orderingConstraint",
                id: id(record.id),
                before: id(record.before),
                after: id(record.after),
                condition: string(record.condition, "ordering condition"),
            };
        }
        case "action": {
            const record = fields(value, [
                "kind",
                "id",
                "title",
                "text",
                "canonicalAction",
                "informationRequests",
                "formInstruction",
                "interfaceParameters",
                "sequence",
                "selectionCondition",
                "expectedObservation",
            ]);
            return {
                kind: "action",
                id: id(record.id),
                title: string(record.title, "action title"),
                text: string(record.text, "action instruction"),
                canonicalAction: optionalText(
                    record.canonicalAction,
                    "canonical action",
                ),
                informationRequests: optionalList(
                    record.informationRequests,
                    "information request",
                ),
                formInstruction: optionalText(
                    record.formInstruction,
                    "form instruction",
                ),
                interfaceParameters: optionalList(
                    record.interfaceParameters,
                    "interface parameter",
                ),
                sequence: optionalList(
                    record.sequence,
                    "within-option instruction",
                ),
                selectionCondition: optionalText(
                    record.selectionCondition,
                    "selection condition",
                ),
                expectedObservation: optionalText(
                    record.expectedObservation,
                    "expected observation",
                ),
            };
        }
        case "outcome": {
            const record = fields(value, ["kind", "id", "text", "result"]);
            if (
                record.result !== "resolved" &&
                record.result !== "escalated" &&
                record.result !== "unresolved" &&
                record.result !== "unknown"
            )
                throw new ProcedureContractError(
                    "Procedure outcome must be resolved, escalated, unresolved or unknown",
                );
            return {
                kind: "outcome",
                id: id(record.id),
                text: string(record.text, "outcome"),
                result: record.result,
            };
        }
        default:
            throw new ProcedureContractError(
                "Unsupported procedure record kind",
            );
    }
}

export function orderingConflictIds(records: ProcedureRecord[]): string[] {
    const constraints = records.filter(
        (
            record,
        ): record is Extract<ProcedureRecord, { kind: "orderingConstraint" }> =>
            record.kind === "orderingConstraint",
    );
    const adjacency = new Map<string, string[]>();
    for (const edge of constraints)
        adjacency.set(edge.before, [
            ...(adjacency.get(edge.before) ?? []),
            edge.after,
        ]);
    return constraints
        .filter((edge) => {
            const pending = [edge.after];
            const visited = new Set<string>();
            while (pending.length) {
                const node = pending.pop()!;
                if (node === edge.before) return true;
                if (visited.has(node)) continue;
                visited.add(node);
                pending.push(...(adjacency.get(node) ?? []));
            }
            return false;
        })
        .map(({ id }) => id);
}

function validatePartialOrder(
    header: ProcedureHeader,
    records: ProcedureRecord[],
    structured: boolean,
): boolean {
    const workflows = records.filter(
        (record): record is Extract<ProcedureRecord, { kind: "workflow" }> =>
            record.kind === "workflow",
    );
    const constraints = records.filter(
        (
            record,
        ): record is Extract<ProcedureRecord, { kind: "orderingConstraint" }> =>
            record.kind === "orderingConstraint",
    );
    if (!workflows.length) {
        if (constraints.length)
            throw new ProcedureContractError(
                "Ordering constraints require a partial-order workflow",
            );
        return false;
    }
    if (
        structured ||
        workflows.length !== 1 ||
        workflows[0].id !== header.entryStep ||
        records.some(
            ({ kind }) => kind === "actionCollection" || kind === "transition",
        )
    )
        throw new ProcedureContractError(
            "Partial-order mode requires one entry workflow and no execution transitions or collections",
        );
    const nodes = records.filter(
        ({ kind }) =>
            kind === "action" || kind === "step" || kind === "outcome",
    );
    const references = new Set(workflows[0].nodeIds);
    if (
        references.size !== workflows[0].nodeIds.length ||
        references.size !== nodes.length ||
        nodes.some(({ id }) => !references.has(id)) ||
        !nodes.some(({ kind }) => kind === "action" || kind === "step") ||
        !nodes.some(({ kind }) => kind === "outcome")
    )
        throw new ProcedureContractError(
            `Every action, step and outcome must be referenced exactly once by its workflow; missing nodes: ${
                nodes
                    .filter(({ id }) => !references.has(id))
                    .map(({ id }) => id)
                    .join(", ") || "none"
            }; unknown/non-node references: ${[...references].filter((id) => !nodes.some((node) => node.id === id)).join(", ") || "none"}; duplicate references: ${workflows[0].nodeIds.filter((id, index, all) => all.indexOf(id) !== index).join(", ") || "none"}. A workflow also requires an action/step and an outcome.`,
        );
    if (
        constraints.some(
            ({ before, after }) =>
                !references.has(before) ||
                !references.has(after) ||
                before === after,
        )
    )
        throw new ProcedureContractError(
            "Workflow ordering endpoint is invalid",
        );
    return true;
}

export function validateProcedureGraph(
    header: ProcedureHeader,
    records: ProcedureRecord[],
    requireEscalation = true,
): void {
    if (records.length === 0 || records.length > 64)
        throw new ProcedureContractError("Procedure requires 1 to 64 records");
    const ids = new Set(records.map((record) => record.id));
    if (ids.size !== records.length)
        throw new ProcedureContractError("Duplicate procedure record ID");
    for (const table of records.filter(
        (
            record,
        ): record is Extract<ProcedureRecord, { kind: "decisionTable" }> =>
            record.kind === "decisionTable",
    )) {
        if (
            requireEscalation ||
            new Set(table.appliesTo).size !== table.appliesTo.length ||
            table.appliesTo.some(
                (id) =>
                    !records.some(
                        (record) =>
                            record.kind === "action" && record.id === id,
                    ),
            )
        )
            throw new ProcedureContractError(
                "Decision tables are prose-only and must reference distinct existing actions",
            );
    }
    if (validatePartialOrder(header, records, requireEscalation)) return;
    const hasCollection = records.some(
        (record) => record.kind === "actionCollection",
    );
    const steps = records.filter(
        (
            record,
        ): record is Extract<
            ProcedureRecord,
            { kind: "step" | "actionCollection" | "action" }
        > =>
            record.kind === "step" ||
            record.kind === "actionCollection" ||
            (record.kind === "action" && !hasCollection),
    );
    validateActionCollection(header, records, requireEscalation);
    const outcomes = records.filter(
        (record): record is Extract<ProcedureRecord, { kind: "outcome" }> =>
            record.kind === "outcome",
    );
    const nodes = new Set([...steps, ...outcomes].map((record) => record.id));
    const transitions = records.filter(
        (record): record is Extract<ProcedureRecord, { kind: "transition" }> =>
            record.kind === "transition",
    );
    if (!steps.some((record) => record.id === header.entryStep))
        throw new ProcedureContractError(
            "Procedure entryStep must identify a step",
        );
    if (
        requireEscalation &&
        !outcomes.some((record) => record.result === "escalated")
    )
        throw new ProcedureContractError(
            "Procedure requires an explicit terminal escalation",
        );
    if (!outcomes.length)
        throw new ProcedureContractError(
            "Procedure requires a source-defined terminal outcome",
        );
    const adjacency = new Map<string, string[]>();
    for (const step of steps) {
        const edges = transitions.filter((edge) => edge.from === step.id);
        if (!edges.length)
            throw new ProcedureContractError(
                `Procedure step ${step.id} has no guarded transition`,
            );
        if (new Set(edges.map((edge) => edge.condition)).size !== edges.length)
            throw new ProcedureContractError(
                "Duplicate branch condition for a procedure step",
            );
        adjacency.set(
            step.id,
            edges.map((edge) => edge.to),
        );
    }

    function validateActionCollection(
        header: ProcedureHeader,
        records: ProcedureRecord[],
        structured: boolean,
    ): void {
        const collections = records.filter(
            (
                record,
            ): record is Extract<
                ProcedureRecord,
                { kind: "actionCollection" }
            > => record.kind === "actionCollection",
        );
        const actions = records.filter(
            (record): record is Extract<ProcedureRecord, { kind: "action" }> =>
                record.kind === "action",
        );
        if (!collections.length && !actions.length) return;
        if (!collections.length && !structured) return;
        if (
            structured ||
            collections.length !== 1 ||
            collections[0].id !== header.entryStep ||
            records.some((record) => record.kind === "step")
        )
            throw new ProcedureContractError(
                "Unordered action mode requires one entry collection, not an invented mixed execution graph",
            );
        const references = collections[0].actionIds;
        if (
            new Set(references).size !== references.length ||
            references.length !== actions.length ||
            references.some(
                (reference) =>
                    !actions.some((action) => action.id === reference),
            )
        )
            throw new ProcedureContractError(
                "Every action must be referenced exactly once by its collection",
            );
    }
    for (const edge of transitions)
        if (!adjacency.has(edge.from) || !nodes.has(edge.to))
            throw new ProcedureContractError(
                "Procedure transition endpoint is invalid",
            );
    const reached = new Set<string>();
    const visiting = new Set<string>();
    function visit(node: string): void {
        if (visiting.has(node))
            throw new ProcedureContractError("Procedure graph must be acyclic");
        if (reached.has(node)) return;
        visiting.add(node);
        for (const next of adjacency.get(node) ?? []) visit(next);
        visiting.delete(node);
        reached.add(node);
    }
    visit(header.entryStep);
    if (reached.size !== nodes.size)
        throw new ProcedureContractError(
            "Procedure contains unreachable steps or outcomes",
        );
}

export function parseProcedureSource(content: string): ProcedureDocument {
    if (content.length > 120000)
        throw new ProcedureContractError(
            "Procedure source exceeds character limit",
        );
    const lines = [...content.matchAll(/[^\r\n]+/g)].filter((line) =>
        line[0].trim(),
    );
    if (lines.length < 2 || lines.length > 65)
        throw new ProcedureContractError(
            "Expected procedure-v1 JSONL header and 1 to 64 records",
        );
    const header = parseHeader(JSON.parse(lines[0][0]));
    const records = lines.slice(1).map((line) => ({
        record: parseProcedureRecord(JSON.parse(line[0])),
        start: line.index!,
        end: line.index! + line[0].length,
    }));
    if (
        records.some(
            ({ record }) =>
                (record.kind === "outcome" &&
                    record.result !== "resolved" &&
                    record.result !== "escalated") ||
                [
                    "action",
                    "actionCollection",
                    "workflow",
                    "orderingConstraint",
                    "decisionTable",
                    "description",
                    "policy",
                    "gap",
                    "metadata",
                ].includes(record.kind),
        )
    )
        throw new ProcedureContractError(
            "Structured procedure-v1 outcomes must be resolved/escalated, and records must retain the original kinds",
        );
    validateProcedureGraph(
        header,
        records.map((entry) => entry.record),
    );
    return {
        header,
        headerSpan: {
            start: lines[0].index!,
            end: lines[0].index! + lines[0][0].length,
        },
        records,
    };
}
