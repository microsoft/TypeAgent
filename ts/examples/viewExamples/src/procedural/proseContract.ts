// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    type ExtensionViewContent,
    type ViewBuildSnapshot,
    type ViewCitation,
    type ViewExtensionProvider,
    type ViewJsonValue,
    type ViewPayloadSchema,
    viewExtensionDigest,
    assertViewJson,
} from "@typeagent/memory-service";
import {
    fields,
    string,
    parseHeader,
    parseProcedureRecord,
    validateProcedureGraph,
    orderingConflictIds,
    type ProcedureDocument,
} from "./contract.js";
import type {
    ProcedureAssessment,
    ProcedureExtraction,
} from "./extractionSchema.js";
import type {
    JsonSchemaType,
    StructuredOutputJsonSchema,
} from "@typeagent/aiclient";
import { renderProcedureDocuments } from "./provider.js";

export type ProcedurePassage = {
    id: string;
    sourceId: string;
    revisionId: string;
    locator: string;
    excerpt: string;
};
export type ProcedurePacket = {
    inputFingerprint: string;
    procedureId: string;
    passages: ProcedurePassage[];
};

export function prosePacket(snapshot: ViewBuildSnapshot): ProcedurePacket {
    if (
        snapshot.inputs.length !== 1 ||
        snapshot.inputs[0].passages ||
        snapshot.inputs[0].evidence
    )
        throw new Error(
            "Prose procedure v1 requires one complete retained document",
        );
    const source = snapshot.inputs[0];
    if (!source.content.trim() || source.content.length > 120000)
        throw new Error(
            "Prose source is empty or exceeds the complete-input bound",
        );
    const passages = [
        ...source.content.matchAll(/[^\r\n]+(?:\r?\n(?!\r?\n)[^\r\n]+)*/g),
    ]
        .filter((match) => match[0].trim())
        .map((match, index) => {
            if (match[0].length > 12000)
                throw new Error(
                    "Prose paragraph exceeds the passage bound; split at meaningful section boundaries before ingestion",
                );
            return {
                id: `p${index}`,
                sourceId: source.sourceId,
                revisionId: source.revisionId,
                locator: `chars:${match.index!}-${match.index! + match[0].length}`,
                excerpt: match[0],
            };
        });
    if (passages.length > 128)
        throw new Error(
            "Prose source exceeds the complete passage-count bound",
        );
    const procedureId = snapshot.definition.extension?.targetKey;
    if (!procedureId) throw new Error("Prose target procedureId is required");
    return { inputFingerprint: snapshot.fingerprint, procedureId, passages };
}

function ids(
    value: unknown,
    packet: ProcedurePacket,
    label: string,
    nonempty = false,
): string[] {
    if (
        !Array.isArray(value) ||
        value.length > 128 ||
        (nonempty && value.length === 0)
    )
        throw new ProcedureExtractionRejection(
            `Invalid ${label} passage array`,
        );
    const result = value.map((id) => string(id, "passage ID", 128));
    if (
        new Set(result).size !== result.length ||
        result.some(
            (id) => !packet.passages.some((passage) => passage.id === id),
        )
    )
        throw new ProcedureExtractionRejection(
            `Duplicate or unknown ${label} passage`,
        );
    return result;
}

export class ProcedureExtractionRejection extends Error {}

export function parseExtraction(
    value: unknown,
    packet: ProcedurePacket,
): ProcedureExtraction {
    const candidate = fields(value, [
        "title",
        "entryStep",
        "titlePassageIds",
        "records",
        "unusedPassages",
    ]);
    if (
        !Array.isArray(candidate.records) ||
        candidate.records.length > 64 ||
        !Array.isArray(candidate.unusedPassages) ||
        candidate.unusedPassages.length > 128
    )
        throw new ProcedureExtractionRejection(
            "Invalid bounded extraction records or unused-passages array",
        );
    const header = parseHeader({
        schemaVersion: 1,
        procedureId: packet.procedureId,
        title: candidate.title,
        entryStep: candidate.entryStep,
    });
    const records = candidate.records.map((value) => {
        const entry = fields(value, [
            "record",
            "supportPassageIds",
            "oppositionPassageIds",
        ]);
        return {
            record: parseProcedureRecord(entry.record),
            supportPassageIds: ids(
                entry.supportPassageIds,
                packet,
                "support",
                true,
            ),
            oppositionPassageIds: ids(
                entry.oppositionPassageIds,
                packet,
                "opposition",
            ),
        };
    });
    validateProcedureGraph(
        header,
        records.map((entry) => entry.record),
        false,
    );
    const conflicts = orderingConflictIds(records.map(({ record }) => record));
    if (
        conflicts.length &&
        (!records.some(({ record }) => record.kind === "gap") ||
            records.some(
                ({ record, oppositionPassageIds }) =>
                    conflicts.includes(record.id) &&
                    !oppositionPassageIds.length,
            ))
    )
        throw new ProcedureExtractionRejection(
            "Cyclic source ordering requires an explicit gap and opposing evidence for each conflicting constraint",
        );
    const titlePassageIds = ids(
        candidate.titlePassageIds,
        packet,
        "title",
        true,
    );
    const used = new Set([
        ...titlePassageIds,
        ...records.flatMap((entry) => [
            ...entry.supportPassageIds,
            ...entry.oppositionPassageIds,
        ]),
    ]);
    const unusedPassages = candidate.unusedPassages.map((value) => {
        const entry = fields(value, ["passageId", "reason"]);
        const passageId = ids([entry.passageId], packet, "unused")[0];
        if (used.has(passageId))
            throw new ProcedureExtractionRejection(
                "Represented passage cannot also be declared unused",
            );
        return {
            passageId,
            reason: string(entry.reason, "unused-passage reason"),
        };
    });
    const accounted = new Set([
        ...used,
        ...unusedPassages.map((entry) => entry.passageId),
    ]);
    if (
        unusedPassages.length !==
            new Set(unusedPassages.map((entry) => entry.passageId)).size ||
        accounted.size !== packet.passages.length
    )
        throw new ProcedureExtractionRejection(
            "Every complete retained passage requires exactly one coverage disposition",
        );
    return {
        title: header.title,
        entryStep: header.entryStep,
        titlePassageIds,
        records,
        unusedPassages,
    };
}

export function parseAssessment(
    value: unknown,
    packet: ProcedurePacket,
): ProcedureAssessment {
    const assessment = fields(value, [
        "supported",
        "issues",
        "coveredPassageIds",
    ]);
    if (
        assessment.supported !== true ||
        !Array.isArray(assessment.issues) ||
        assessment.issues.length !== 0
    )
        throw new ProcedureExtractionRejection(
            `Semantic checker rejected procedure: ${JSON.stringify(assessment.issues)}`,
        );
    const coveredPassageIds = ids(
        assessment.coveredPassageIds,
        packet,
        "checked",
    );
    if (coveredPassageIds.length !== packet.passages.length)
        throw new ProcedureExtractionRejection(
            "Semantic checker did not account for every original passage",
        );
    return { supported: true, issues: [], coveredPassageIds };
}

function applyProcedurePresentation(
    content: ExtensionViewContent,
    candidate: ProcedureExtraction,
): void {
    const collection = candidate.records.some(
        ({ record }) => record.kind === "actionCollection",
    );
    const label = (id: string) => {
        const record = candidate.records.find(
            (entry) => entry.record.id === id,
        )!.record;
        return record.kind === "action" ? record.title : id.replace(/-/g, " ");
    };
    for (const { record } of candidate.records) {
        const section = content.sections.find(
            ({ id }) => id === `source-0-record-${record.id}`,
        )!;
        switch (record.kind) {
            case "description":
                section.heading = "Source scope";
                break;
            case "actionCollection":
                section.heading = "Source-listed options";
                break;
            case "workflow":
                section.heading =
                    "Source-defined workflow; no inferred total order";
                break;
            case "decisionTable":
                section.heading = record.title;
                break;
            case "orderingConstraint":
                section.heading = `${label(record.before)} before ${label(record.after)}`;
                section.body = `Source ordering condition: ${record.condition}`;
                break;
            case "policy":
                section.heading = "Source policy";
                break;
            case "gap":
                section.heading = "Not specified or ambiguous in this source";
                break;
            case "metadata":
                section.heading = "Source qualifications";
                break;
            case "step":
                section.heading = label(record.id);
                break;
            case "transition":
                section.heading = `From ${label(record.from)} to ${label(record.to)}`;
                section.body = `Source condition: ${record.condition}`;
                break;
            case "outcome":
                section.heading =
                    record.result === "unresolved"
                        ? "If the issue remains unresolved"
                        : "Source-defined result";
                break;
        }
    }
    const blocks = (kinds: string[]) =>
        candidate.records
            .filter(({ record }) => kinds.includes(record.kind))
            .map(({ record }) => `source-0-record-${record.id}`);
    const groups = [
        {
            id: "overview",
            label: "Source scope",
            blockIds: blocks([
                "description",
                "actionCollection",
                "workflow",
                "context",
            ]),
        },
        {
            id: "gaps",
            label: "Source limitations and unresolved choices",
            blockIds: blocks(["gap"]),
        },
        {
            id: "options",
            label: collection ? "Available options" : "Actions and decisions",
            blockIds: blocks(["action", "step", "decisionTable"]),
        },
        {
            id: "rules",
            label: "Common rules and prerequisites",
            blockIds: blocks(["policy", "prerequisite", "guard"]),
        },
        {
            id: "outcomes",
            label: "Source-defined closure",
            blockIds: blocks(["outcome"]),
        },
        {
            id: "technical",
            label: "Technical provenance and source qualifications",
            blockIds: [
                "source-0-goal",
                ...blocks(["metadata", "orderingConstraint", "transition"]),
            ],
        },
    ];
    content.presentation = {
        schemaVersion: 1,
        templateId: "procedure-guide-v1",
        templateVersion: 1,
        layouts: [
            { id: "guide", label: "Support guide", groups },
            { id: "agent", label: "For agents", groups },
            { id: "evidence", label: "Evidence & gaps", groups },
        ],
    };
    content.summary =
        "Source-grounded procedural actions and conditions; no execution authority or independent human approval.";
}

export function renderProseProcedure(
    snapshot: ViewBuildSnapshot,
    identity: ViewExtensionProvider["descriptor"]["identity"],
    extraction: ProcedureExtraction,
    assessment: ProcedureAssessment,
): ExtensionViewContent {
    const packet = prosePacket(snapshot);
    const candidate = parseExtraction(extraction, packet);
    const check = parseAssessment(assessment, packet);
    const citation = (id: string): ViewCitation => {
        const { sourceId, revisionId, locator, excerpt } = packet.passages.find(
            (passage) => passage.id === id,
        )!;
        return { sourceId, revisionId, locator, excerpt };
    };
    const span = (id: string) => {
        const match = /^chars:(\d+)-(\d+)$/.exec(citation(id).locator)!;
        return { start: Number(match[1]), end: Number(match[2]) };
    };
    const document: ProcedureDocument = {
        header: {
            schemaVersion: 1,
            procedureId: packet.procedureId,
            title: candidate.title,
            entryStep: candidate.entryStep,
        },
        headerSpan: span(candidate.titlePassageIds[0]),
        headerSupport: candidate.titlePassageIds.map(citation),
        records: candidate.records.map((entry) => ({
            record: entry.record,
            ...span(entry.supportPassageIds[0]),
            support: entry.supportPassageIds.map(citation),
            opposition: entry.oppositionPassageIds.map(citation),
        })),
    };
    const content = renderProcedureDocuments(snapshot, identity, [
        { source: snapshot.inputs[0], document },
    ]);
    if (
        !content.payload ||
        typeof content.payload !== "object" ||
        Array.isArray(content.payload)
    )
        throw new Error("Procedure renderer returned an invalid payload");
    content.payload = {
        ...content.payload,
        extraction: {
            inputFingerprint: snapshot.fingerprint,
            candidate,
            assessment: check,
            humanReview: "pending",
        },
    };
    content.payload.agentRepresentation = {
        topology: candidate.records.some(
            ({ record }) => record.kind === "workflow",
        )
            ? "partial-order"
            : candidate.records.some(
                    ({ record }) => record.kind === "actionCollection",
                )
              ? "action-collection"
              : "guarded-graph",
        orderingConflictIds: orderingConflictIds(
            candidate.records.map(({ record }) => record),
        ),
        status: content.payload.status,
        procedures: content.payload.procedures,
        evidence: content.evidence.map(({ blockId, support, opposition }) => ({
            blockId,
            support: support.map((citation) => ({ ...citation })),
            opposition: opposition.map((citation) => ({ ...citation })),
        })),
    };
    applyProcedurePresentation(content, candidate);
    content.fidelity.reasons.push(
        "Model semantic check only; independent human review remains pending",
    );
    return content;
}

export function validateProseContent(
    snapshot: ViewBuildSnapshot,
    identity: ViewExtensionProvider["descriptor"]["identity"],
    content: ExtensionViewContent,
): void {
    if (
        !content.payload ||
        typeof content.payload !== "object" ||
        Array.isArray(content.payload)
    )
        throw new Error("Prose procedure payload is required");
    const proof = fields(content.payload.extraction, [
        "inputFingerprint",
        "candidate",
        "assessment",
        "humanReview",
    ]);
    if (
        proof.inputFingerprint !== snapshot.fingerprint ||
        proof.humanReview !== "pending"
    )
        throw new Error(
            "Prose receipt belongs to another snapshot or falsely claims human review",
        );
    const packet = prosePacket(snapshot);
    const expected = renderProseProcedure(
        snapshot,
        identity,
        parseExtraction(proof.candidate, packet),
        parseAssessment(proof.assessment, packet),
    );
    if (viewExtensionDigest(content) !== viewExtensionDigest(expected))
        throw new Error(
            "Prose content differs from its validated evidence-bound extraction",
        );
}

export function proseOutputSchema(base: ViewPayloadSchema): ViewPayloadSchema {
    if (base.type !== "object")
        throw new Error("Procedure payload schema must be an object");
    const short: ViewPayloadSchema = { type: "string", maxLength: 128 };
    const object = (
        properties: Record<string, ViewPayloadSchema>,
    ): ViewPayloadSchema => ({
        type: "object",
        properties,
        required: Object.keys(properties),
    });
    const passageIds: ViewPayloadSchema = {
        type: "array",
        items: short,
        maxItems: 128,
    };
    const graph = base.properties.procedures;
    const citationList: ViewPayloadSchema = {
        type: "array",
        maxItems: 128,
        items: object({
            sourceId: short,
            revisionId: short,
            locator: { type: "string", maxLength: 512 },
            excerpt: { type: "string", maxLength: 12000 },
        }),
    };
    if (graph.type !== "array" || graph.items.type !== "object")
        throw new Error("Invalid procedure graph schema");
    const records = graph.items.properties.records;
    if (records.type !== "array" || records.items.type !== "object")
        throw new Error("Invalid procedure record schema");
    return object({
        ...base.properties,
        agentRepresentation: object({
            topology: short,
            orderingConflictIds: { type: "array", items: short, maxItems: 64 },
            status: short,
            procedures: base.properties.procedures,
            evidence: {
                type: "array",
                maxItems: 65,
                items: object({
                    blockId: short,
                    support: citationList,
                    opposition: citationList,
                }),
            },
        }),
        extraction: object({
            inputFingerprint: short,
            humanReview: short,
            candidate: object({
                title: { type: "string", maxLength: 1000 },
                entryStep: short,
                titlePassageIds: passageIds,
                records: {
                    type: "array",
                    maxItems: 64,
                    items: object({
                        record: records.items.properties.record,
                        supportPassageIds: passageIds,
                        oppositionPassageIds: passageIds,
                    }),
                },
                unusedPassages: {
                    type: "array",
                    maxItems: 128,
                    items: object({
                        passageId: short,
                        reason: { type: "string", maxLength: 1000 },
                    }),
                },
            }),
            assessment: object({
                supported: { type: "boolean" },
                issues: {
                    type: "array",
                    maxItems: 128,
                    items: object({
                        recordId: {
                            type: "union",
                            variants: [short, { type: "null" }],
                        },
                        reason: { type: "string", maxLength: 1000 },
                    }),
                },
                coveredPassageIds: passageIds,
            }),
        }),
    });
}

export function jsonCandidate(value: unknown): ViewJsonValue {
    const serialized: unknown = JSON.parse(JSON.stringify(value));
    assertViewJson(serialized);
    return serialized;
}

export function structuredProseSchema(
    name: string,
    value: ViewPayloadSchema,
): StructuredOutputJsonSchema {
    const convert = (schema: ViewPayloadSchema): JsonSchemaType => {
        switch (schema.type) {
            case "object": {
                const properties: Record<string, JsonSchemaType> =
                    Object.fromEntries(
                        Object.entries(schema.properties).map(
                            ([key, child]) => [key, convert(child)],
                        ),
                    );
                if ("kind" in properties) {
                    const discriminator = [
                        ["columns", "decisionTable"],
                        ["nodeIds", "workflow"],
                        ["before", "orderingConstraint"],
                        ["actionIds", "actionCollection"],
                        ["canonicalAction", "action"],
                        ["requiredInputs", "step"],
                        ["from", "transition"],
                        ["result", "outcome"],
                    ].find(([field]) => field in properties);
                    const kinds = discriminator
                        ? [discriminator[1]]
                        : [
                              "context",
                              "prerequisite",
                              "guard",
                              "description",
                              "policy",
                              "gap",
                              "metadata",
                          ];
                    properties.kind = { type: "string", enum: kinds };
                }
                if ("actionIds" in properties)
                    properties.order = {
                        type: "string",
                        enum: ["any-order", "unspecified"],
                    };
                if ("nodeIds" in properties)
                    properties.order = {
                        type: "string",
                        enum: ["partial-order"],
                    };
                if ("result" in properties)
                    properties.result = {
                        type: "string",
                        enum: [
                            "resolved",
                            "escalated",
                            "unresolved",
                            "unknown",
                        ],
                    };
                return {
                    type: "object",
                    properties,
                    required: Object.keys(properties),
                    additionalProperties: false,
                };
            }
            case "array":
                return { type: "array", items: convert(schema.items) };
            case "union":
                return { anyOf: schema.variants.map(convert) };
            default:
                return { type: schema.type };
        }
    };
    return { name, strict: true, schema: convert(value) };
}
