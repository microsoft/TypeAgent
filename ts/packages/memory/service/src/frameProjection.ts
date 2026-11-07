// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import { dataFrame as df, parseTemporalValue } from "@typeagent/knowpro";
import type { MemoryEvent, MemorySource } from "./types.js";
import type {
    AnswerSchema,
    SchemaValue,
    QuestionDetails,
    QuestionSlot,
} from "./schemaViewTypes.js";
import type { ViewVersion } from "./viewTypes.js";
import { resolveQuestion } from "./schemaView.js";

export function frameHash(value: unknown): string {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function schema(
    id: string,
    fields: df.FrameSchema["fields"],
    description = id,
    revision = 1,
): df.FrameSchema {
    return { id, revision, description, fields };
}
const string: df.FrameField = { type: "string", optional: true };
export const builtinFrameSchemas = [
    schema(
        "source",
        {
            sourceId: { type: "string" },
            type: { type: "string" },
            title: { type: "string" },
            uri: string,
            tags: { ...string, multiple: true },
            provider: string,
            repository: string,
            commit: string,
            environment: string,
            capturedAt: { type: "instant", optional: true },
            authoredAt: { type: "calendar", optional: true },
            authoredInstant: { type: "instant", optional: true },
            modifiedAt: { type: "calendar", optional: true },
            modifiedInstant: { type: "instant", optional: true },
        },
        "Current eligible source revisions and source metadata",
    ),
    schema(
        "source.event",
        {
            eventId: { type: "string" },
            kind: { type: "string" },
            producer: string,
            authority: string,
            role: string,
            sessionId: string,
            agentId: string,
            taskId: string,
            turnId: string,
            callId: string,
            outcome: string,
            repository: string,
            commit: string,
            environment: string,
            timestamp: { type: "instant", optional: true },
        },
        "Canonical conversation events and retained agent episode records",
    ),
    schema(
        "question.slot",
        {
            slotId: { type: "string" },
            answerSchemaId: { type: "string" },
            answerSchemaRevision: { type: "number" },
            question: { type: "string" },
            cardinality: string,
            answerState: string,
            reviewState: string,
            freshness: string,
            coverage: string,
        },
        "Approved question inventory, including unresolved slots",
        2,
    ),
    schema("project.status", {
        project: string,
        incident: string,
        capacity: string,
    }),
    schema(
        "project.owner",
        {
            responsibility: {
                ...string,
                description:
                    "Label of the work or responsibility, not its assignment state",
            },
            state: {
                ...string,
                description:
                    'Assignment state: "known", "unknown", or "unassigned". Use state to find unassigned responsibilities.',
            },
            owner: {
                ...string,
                description:
                    "Name of the assigned person; absent or null when no owner is known. Assignment states are not owner names.",
            },
        },
        "Project responsibilities and owner assignment states",
        2,
    ),
    schema("project.milestone", {
        status: string,
        date: { type: "calendar", optional: true },
    }),
    schema("project.risk", { status: string }),
    schema("project.decision", { status: string }),
];

function row(
    schemaId: string,
    itemKey: string,
    values: df.FrameRow["values"],
    eligible: boolean,
    evidence: df.FrameEvidence[] = [],
    opposition: df.FrameEvidence[] = [],
): df.FrameRow {
    return {
        schemaId,
        schemaRevision:
            builtinFrameSchemas.find((schema) => schema.id === schemaId)
                ?.revision ?? 1,
        itemKey,
        values,
        eligible,
        origin: "derived",
        granularity: "view",
        evidence,
        opposition,
        valueStates: Object.fromEntries(
            Object.keys(
                builtinFrameSchemas.find((s) => s.id === schemaId)?.fields ??
                    {},
            )
                .filter(
                    (key) => values[key] === undefined || values[key] === null,
                )
                .map((key) => [key, "unknown" as const]),
        ),
    };
}

function time(
    raw: string | undefined,
    kind: "calendar" | "instant",
): df.FrameScalar | undefined {
    if (!raw) return undefined;
    const value = parseTemporalValue(raw);
    if (kind === "instant" && value.kind !== "instant") return undefined;
    if (kind === "calendar" && value.kind === "instant") return undefined;
    return { kind, raw };
}

export function sourceFrameRows(
    source: MemorySource,
    retainedText?: string,
): df.FrameRow[] {
    const revision = source.revisions.find(
        (r) => r.revisionId === source.activeRevisionId,
    )!;
    const metadata = source.metadata ?? {};
    const agent =
        metadata.agentSession && typeof metadata.agentSession === "object"
            ? metadata.agentSession
            : {};
    const values: df.FrameRow["values"] = {
        sourceId: source.sourceId,
        type: source.sourceType,
        title: source.title,
        ...(source.canonicalUri ? { uri: source.canonicalUri } : {}),
        ...(source.tags ? { tags: source.tags } : {}),
    };
    for (const key of ["repository", "commit", "environment"] as const) {
        const value = Reflect.get(agent, key) ?? metadata[key];
        if (typeof value === "string") values[key] = value;
    }
    if (typeof metadata.frameProviderId === "string")
        values.provider = metadata.frameProviderId;
    for (const [field, raw, kind] of [
        ["capturedAt", revision.capturedAt, "instant"],
        ["authoredAt", revision.authoredAt, "calendar"],
        ["authoredInstant", revision.authoredAt, "instant"],
        ["modifiedAt", revision.sourceModifiedAt, "calendar"],
        ["modifiedInstant", revision.sourceModifiedAt, "instant"],
    ] as const) {
        const value = time(raw, kind);
        if (value !== undefined) values[field] = value;
    }
    const rows: df.FrameRow[] = [
        {
            ...row("source", source.sourceId, values, true),
            origin: "source" as const,
            granularity: "source" as const,
        },
    ];
    return rows.concat(
        retainedSourceEventRows(source, agent, values, retainedText),
    );
}

function retainedSourceEventRows(
    source: MemorySource,
    agent: object,
    values: df.FrameRow["values"],
    retainedText?: string,
): df.FrameRow[] {
    const rows: df.FrameRow[] = [];
    const events: unknown = Reflect.get(agent, "events");
    if (!Array.isArray(events)) return rows;
    for (const event of events) {
        if (
            !event ||
            typeof event !== "object" ||
            typeof event.id !== "string" ||
            typeof event.kind !== "string"
        )
            throw new Error("Invalid retained agent frame event");
        const record: df.FrameRow["values"] = {
            eventId: event.id,
            kind: event.kind,
            authority: "producerReported",
        };
        for (const key of [
            "role",
            "agentId",
            "taskId",
            "turnId",
            "callId",
            "outcome",
            "sessionId",
        ] as const)
            if (typeof event[key] === "string") record[key] = event[key];
        if (
            !record.sessionId &&
            typeof Reflect.get(agent, "sessionId") === "string"
        )
            record.sessionId = Reflect.get(agent, "sessionId");
        for (const key of ["repository", "commit", "environment"] as const)
            if (values[key] !== undefined) record[key] = values[key];
        const timestamp = time(event.timestamp, "instant");
        if (timestamp !== undefined) record.timestamp = timestamp;
        const span: unknown = Reflect.get(event, "span");
        const evidence = retainedEventEvidence(
            source,
            span,
            event.text,
            retainedText,
        );
        const projected: df.FrameRow = {
            ...row("source.event", event.id, record, true, evidence),
            origin: "source",
            granularity: evidence.length ? "record" : "source",
        };
        if (event.outcome === "unknown")
            projected.valueStates = {
                ...projected.valueStates,
                outcome: "unknown",
            };
        rows.push(projected);
    }
    return rows;
}

function retainedEventEvidence(
    source: MemorySource,
    span: unknown,
    text: unknown,
    retainedText?: string,
): df.FrameEvidence[] {
    if (span === undefined) return [];
    if (!span || typeof span !== "object")
        throw new Error("Invalid retained agent event span");
    const start: unknown = Reflect.get(span, "start"),
        end: unknown = Reflect.get(span, "end");
    if (
        typeof start !== "number" ||
        typeof end !== "number" ||
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start < 0 ||
        end <= start ||
        (retainedText !== undefined && end > retainedText.length)
    )
        throw new Error("Invalid retained agent event span");
    return [
        {
            sourceId: source.sourceId,
            revisionId: source.activeRevisionId,
            locator: `chars:${start}-${end}`,
            excerpt: typeof text === "string" ? text.slice(0, 1000) : "",
        },
    ];
}

export function eventFrameRow(
    event: MemoryEvent,
    authority: string,
): df.FrameRow {
    const values: df.FrameRow["values"] = {
        eventId: event.eventId,
        kind: event.eventType,
        producer: event.producer.producerId,
        authority,
    };
    for (const key of ["turnId", "runId", "conversationId"] as const)
        if (event[key] && key === "turnId") values.turnId = event[key]!;
    const timestamp = time(event.eventTime, "instant");
    if (timestamp !== undefined) values.timestamp = timestamp;
    return {
        ...row("source.event", event.eventId, values, true),
        origin: "source",
        granularity: "record",
    };
}

function answerFieldId(path: string): string {
    return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(path)
        ? path
        : `field.${frameHash(path).slice(0, 24)}`;
}
function questionFields(
    answer: AnswerSchema,
    path = "value",
): df.FrameSchema["fields"] {
    if (answer.type !== "object")
        return {
            [answerFieldId(path)]: {
                type: answer.type,
                optional: true,
                description: path,
            },
        };
    return Object.fromEntries(
        Object.entries(answer.properties).flatMap(([id, child]) =>
            Object.entries(questionFields(child, `${path}.${id}`)),
        ),
    );
}
function questionValues(
    value: SchemaValue,
    answer: AnswerSchema,
    path = "value",
): df.FrameRow["values"] {
    if (answer.type !== "object") {
        if (value !== null && typeof value !== answer.type)
            throw new Error(
                "Selected question value does not match its declared frame type",
            );
        if (
            value === null ||
            typeof value === "string" ||
            typeof value === "number" ||
            typeof value === "boolean"
        )
            return { [answerFieldId(path)]: value };
        throw new Error("Selected question value is not scalar");
    }
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error(
            "Selected question record does not match its declared frame type",
        );
    return Object.fromEntries(
        Object.entries(answer.properties).flatMap(([id, child]) =>
            Object.prototype.hasOwnProperty.call(value, id)
                ? Object.entries(
                      questionValues(value[id], child, `${path}.${id}`),
                  )
                : [],
        ),
    );
}

export function viewFrameRows(
    view: ViewVersion,
    eligible: boolean,
): { schemas: df.FrameSchema[]; rows: df.FrameRow[] } {
    const schemas: df.FrameSchema[] = [],
        rows: df.FrameRow[] = [];
    for (const section of view.content.sections) {
        const stored = section.details;
        if (!stored) continue;
        const slot =
            stored.kind === "question"
                ? view.definition.schemaView?.slots.find(
                      (s) => s.id === stored.slotId,
                  )
                : undefined;
        const details =
            stored.kind === "question" && slot
                ? resolveQuestion(
                      slot,
                      stored.candidates,
                      stored.evaluatedSources,
                  )
                : stored;
        if (details.kind === "question" && view.state === "stale")
            details.freshness = "stale";
        const evidence = view.content.citations;
        if (details.kind === "question" && view.definition.schemaView) {
            if (!slot || slot.approval !== "approved") continue;
            const projected = questionFrameRows(
                view.viewId,
                slot,
                details,
                eligible,
                evidence,
            );
            schemas.push(projected.schema);
            rows.push(...projected.rows);
        } else if (view.content.kind === "projectBrief") {
            switch (details.kind) {
                case "status":
                    rows.push(
                        row(
                            "project.status",
                            section.id,
                            {
                                project: details.project,
                                incident: details.incident,
                                capacity: details.capacity,
                            },
                            eligible,
                            evidence,
                        ),
                    );
                    break;
                case "owners":
                    rows.push(
                        ...details.assignments.map((item) =>
                            row(
                                "project.owner",
                                JSON.stringify([section.id, item.id]),
                                {
                                    responsibility: item.responsibility,
                                    state: item.state,
                                    owner: item.owner,
                                },
                                eligible,
                                evidence,
                            ),
                        ),
                    );
                    break;
                case "milestones":
                    rows.push(
                        ...details.items.map((item) => {
                            const date = time(
                                item.date ?? undefined,
                                "calendar",
                            );
                            return row(
                                "project.milestone",
                                JSON.stringify([section.id, item.id]),
                                {
                                    status: item.status,
                                    ...(date !== undefined ? { date } : {}),
                                },
                                eligible,
                                evidence,
                            );
                        }),
                    );
                    break;
                case "risks":
                case "decisions":
                    rows.push(
                        ...details.items.map((item) =>
                            row(
                                details.kind === "risks"
                                    ? "project.risk"
                                    : "project.decision",
                                JSON.stringify([section.id, item.id]),
                                { status: item.status },
                                eligible,
                                evidence,
                            ),
                        ),
                    );
                    break;
            }
        }
    }
    return { schemas, rows };
}

function questionFrameRows(
    viewId: string,
    slot: QuestionSlot,
    details: QuestionDetails,
    eligible: boolean,
    evidence: df.FrameEvidence[],
) {
    const answerSchema = schema(
        `question.answer.${frameHash([viewId, slot.id]).slice(0, 24)}`,
        {
            ...questionFields(slot.schema),
            slotId: string,
            candidateId: string,
            review: string,
            freshness: string,
            effectiveAt: { type: "instant", optional: true },
            effectiveLocal: { type: "calendar", optional: true },
        },
        slot.question,
    );
    answerSchema.revision =
        Number.parseInt(
            frameHash([answerSchema.description, answerSchema.fields]).slice(
                0,
                12,
            ),
            16,
        ) + 1;
    const rows = [
        row(
            "question.slot",
            slot.id,
            {
                slotId: slot.id,
                answerSchemaId: answerSchema.id,
                answerSchemaRevision: answerSchema.revision,
                question: slot.question,
                cardinality: slot.cardinality,
                answerState: details.answerState,
                reviewState: details.reviewState,
                freshness: details.freshness,
                coverage: details.coverage,
            },
            true,
            evidence,
        ),
    ];
    for (const candidate of details.candidates) {
        if (!details.selectedCandidateIds.includes(candidate.id)) continue;
        const values = questionValues(candidate.value, slot.schema);
        values.slotId = slot.id;
        values.candidateId = candidate.id;
        values.review = candidate.review;
        values.freshness = details.freshness;
        const effectiveAt = time(candidate.effectiveAt, "instant");
        if (effectiveAt !== undefined) values.effectiveAt = effectiveAt;
        const effectiveLocal = time(candidate.effectiveAt, "calendar");
        if (effectiveLocal !== undefined)
            values.effectiveLocal = effectiveLocal;
        rows.push({
            ...row(
                answerSchema.id,
                `${candidate.itemKey ?? slot.id}:${candidate.id}`,
                values,
                eligible &&
                    details.answerState !== "conflicted" &&
                    details.freshness === "current" &&
                    candidate.review !== "rejected" &&
                    (!slot.rubric.requireConfirmation ||
                        candidate.review === "confirmed"),
                candidate.citations,
                candidate.opposingCitations,
            ),
            origin: candidate.origin,
            schemaRevision: answerSchema.revision,
            granularity: "section",
            valueStates: Object.fromEntries(
                Object.keys(answerSchema.fields)
                    .filter(
                        (key) =>
                            values[key] === undefined || values[key] === null,
                    )
                    .map((key) => [key, "unknown" as const]),
            ),
        });
    }
    return { schema: answerSchema, rows };
}

function projectedValue(raw: unknown, field: df.FrameField): df.FrameValue {
    if (raw === null) return null;
    if (Array.isArray(raw)) {
        if (!field.multiple)
            throw new Error("Projected frame field is not multi-valued");
        return raw.map((item) => {
            const value = projectedValue(item, { ...field, multiple: false });
            if (Array.isArray(value))
                throw new Error("Nested frame arrays are unsupported");
            return value;
        });
    }
    if (
        (field.type === "calendar" || field.type === "instant") &&
        typeof raw === "string"
    ) {
        const value: df.FrameScalar = { kind: field.type, raw };
        df.frameValueKey(field, value);
        return value;
    }
    if (
        typeof raw !== "string" &&
        typeof raw !== "boolean" &&
        typeof raw !== "number"
    )
        throw new Error("Projected frame value is not a scalar");
    df.frameValueKey(field, raw);
    return raw;
}

export function descriptorFrameRows(
    payload: unknown,
    descriptor: df.FrameProjectionDescriptor,
    evidence: (
        index: number,
        record: unknown,
    ) => { support: df.FrameEvidence[]; opposition: df.FrameEvidence[] },
    eligible: boolean,
): df.FrameRow[] {
    df.assertFrameDescriptor(descriptor);
    const records = df.framePointer(payload, descriptor.rowsPointer);
    if (!Array.isArray(records))
        throw new Error("Frame record selector must resolve to an array");
    if (records.length > 10000) throw new Error("Frame record limit exceeded");
    return records.map((record, index) => {
        const key = df.framePointer(record, descriptor.itemKeyPointer);
        if (
            (typeof key !== "string" && typeof key !== "number") ||
            (typeof key === "number" && !Number.isFinite(key))
        )
            throw new Error("Frame item key must be a string or number");
        const values: df.FrameRow["values"] = {};
        const valueStates: NonNullable<df.FrameRow["valueStates"]> = {};
        for (const [id, field] of Object.entries(descriptor.schema.fields)) {
            const pointer = df.frameRecordValue(descriptor.fields, id);
            const raw =
                pointer === undefined
                    ? undefined
                    : df.framePointer(record, pointer);
            if (raw === undefined) valueStates[id] = "unavailable";
            else values[id] = projectedValue(raw, field);
        }
        const refs = evidence(index, record);
        return {
            ...row(
                descriptor.schema.id,
                String(key),
                values,
                eligible,
                refs.support,
                refs.opposition,
            ),
            schemaRevision: descriptor.schema.revision,
            valueStates,
            granularity: "record",
        };
    });
}

export function jsonFrameSpans(
    text: string,
): Map<string, { start: number; end: number }> {
    JSON.parse(text);
    let offset = 0;
    const spans = new Map<string, { start: number; end: number }>();
    const space = () => {
        while (/\s/u.test(text[offset] ?? "")) offset++;
    };
    const quoted = () => {
        const start = offset++;
        while (offset < text.length) {
            if (text[offset++] === '"') break;
            if (text[offset - 1] === "\\") offset++;
        }
        return JSON.parse(text.slice(start, offset)) as string;
    };
    const node = (path: string) => {
        space();
        const start = offset;
        if (text[offset] === "{") {
            offset++;
            space();
            while (text[offset] !== "}") {
                const key = quoted();
                space();
                offset++;
                node(
                    `${path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`,
                );
                space();
                if (text[offset] !== ",") break;
                offset++;
                space();
            }
            offset++;
        } else if (text[offset] === "[") {
            offset++;
            space();
            let index = 0;
            while (text[offset] !== "]") {
                node(`${path}/${index++}`);
                space();
                if (text[offset] !== ",") break;
                offset++;
                space();
            }
            offset++;
        } else if (text[offset] === '"') quoted();
        else
            while (offset < text.length && !/[\s,\]}]/u.test(text[offset]))
                offset++;
        spans.set(path, { start, end: offset });
    };
    node("");
    return spans;
}
