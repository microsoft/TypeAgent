// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    AnswerCandidate,
    AnswerSchema,
    QuestionDetails,
    QuestionSection,
    QuestionSlot,
    SchemaValue,
    SchemaViewContent,
    SchemaViewDefinition,
} from "./schemaViewTypes.js";
import type {
    ViewBuildSnapshot,
    ViewCitation,
    ViewDefinitionInput,
    ViewSynthesisOutput,
    ViewVersion,
    ViewRetainedInput,
} from "./viewTypes.js";
import {
    assertViewIdentifier,
    viewSourceKey,
    viewHash,
} from "./viewContent.js";
import { validateIsoTimestamp } from "./timestampValidation.js";

export const schemaViewLimits = {
    slots: 24,
    candidates: 64,
    schemaDepth: 5,
    fields: 24,
    specificationChars: 16000,
    proposals: 8,
} as const;

function object(
    value: unknown,
    allowed: string[],
    label: string,
): asserts value is Record<string, unknown> {
    if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        Object.keys(value).some((key) => !allowed.includes(key))
    )
        throw new Error(`Invalid ${label} fields`);
}

function boundedText(value: unknown, label: string, max = 1000): void {
    if (typeof value !== "string" || !value.trim() || value.length > max)
        throw new Error(
            `${label} requires nonempty text up to ${max} characters`,
        );
}

function uniqueStrings(value: unknown, label: string, max = 32): void {
    if (
        !Array.isArray(value) ||
        value.length > max ||
        value.some((entry) => typeof entry !== "string" || !entry.trim()) ||
        new Set(value).size !== value.length
    )
        throw new Error(`Invalid ${label}`);
}

export function validateAnswerSchema(
    value: unknown,
    depth = 0,
): asserts value is AnswerSchema {
    if (depth > schemaViewLimits.schemaDepth)
        throw new Error("Answer schema nesting limit exceeded");
    object(value, ["type", "enum", "properties", "required"], "answer schema");
    if (value.type === "object") {
        object(value, ["type", "properties", "required"], "record schema");
        if (!value.properties || typeof value.properties !== "object")
            throw new Error("Record properties are required");
        const entries = Object.entries(value.properties);
        if (!entries.length || entries.length > schemaViewLimits.fields)
            throw new Error("Record schema requires 1 to 24 properties");
        uniqueStrings(
            value.required,
            "required properties",
            schemaViewLimits.fields,
        );
        for (const [key, child] of entries) {
            assertViewIdentifier("property", key);
            if (["__proto__", "constructor", "prototype"].includes(key))
                throw new Error("Unsafe schema property");
            validateAnswerSchema(child, depth + 1);
        }
        if (
            (value.required as string[]).some(
                (key) =>
                    !Object.prototype.hasOwnProperty.call(
                        value.properties,
                        key,
                    ),
            )
        )
            throw new Error("Required property is not declared");
    } else if (value.type === "string") {
        object(value, ["type", "enum"], "string schema");
        if (value.enum !== undefined) {
            uniqueStrings(value.enum, "enum", 64);
            if (!(value.enum as string[]).length)
                throw new Error("Enum cannot be empty");
        }
    } else if (value.type === "number" || value.type === "boolean") {
        object(value, ["type"], "scalar schema");
    } else throw new Error("Unsupported answer schema type");
}

export function validateAnswerValue(
    schema: AnswerSchema,
    value: SchemaValue,
): void {
    if (schema.type === "object") {
        if (!value || typeof value !== "object" || Array.isArray(value))
            throw new Error("Answer must be a record");
        for (const [key, child] of Object.entries(value)) {
            if (!Object.prototype.hasOwnProperty.call(schema.properties, key))
                throw new Error(`Undeclared answer property: ${key}`);
            if (child !== null)
                validateAnswerValue(schema.properties[key], child);
        }
    } else if (
        typeof value !== schema.type ||
        (typeof value === "number" && !Number.isFinite(value)) ||
        (typeof value === "string" && value.length > 16000) ||
        (schema.type === "string" &&
            schema.enum &&
            !schema.enum.includes(String(value)))
    )
        throw new Error("Answer does not conform to its approved schema");
}

export function completeAnswer(
    schema: AnswerSchema,
    value: SchemaValue,
): boolean {
    if (schema.type !== "object") return value !== null;
    if (!value || typeof value !== "object" || Array.isArray(value))
        return false;
    return schema.required.every(
        (key) =>
            value[key] !== undefined &&
            value[key] !== null &&
            completeAnswer(schema.properties[key], value[key]),
    );
}

function validateQuestionAdmission(value: unknown): void {
    if (value === undefined) return;
    object(
        value,
        [
            "version",
            "actor",
            "policyVersion",
            "recipeIdentity",
            "modelIdentity",
            "inputFingerprint",
            "reason",
        ],
        "question admission",
    );
    if (
        value.version !== 1 ||
        value.policyVersion !== 1 ||
        (value.actor !== "user" && value.actor !== "policy")
    )
        throw new Error("Unsupported question admission provenance");
    for (const key of [
        "recipeIdentity",
        "modelIdentity",
        "inputFingerprint",
        "reason",
    ])
        boundedText(
            value[key],
            `Admission ${key}`,
            key === "reason" ? 2000 : 1000,
        );
}

export function validateQuestionSlot(
    value: unknown,
): asserts value is QuestionSlot {
    object(
        value,
        [
            "id",
            "question",
            "cardinality",
            "schema",
            "itemKey",
            "rubric",
            "approval",
            "discoveryCitations",
            "admission",
        ],
        "question slot",
    );
    assertViewIdentifier("slot ID", value.id as string);
    boundedText(value.question, "Question", 2000);
    validateAnswerSchema(value.schema);
    if (
        !["singleton", "record", "collection"].includes(
            String(value.cardinality),
        )
    )
        throw new Error("Unsupported question cardinality");
    if (value.cardinality !== "singleton" && value.schema.type !== "object")
        throw new Error("Record and collection slots require object schemas");
    if (value.cardinality === "collection") {
        if (
            value.schema.type !== "object" ||
            typeof value.itemKey !== "string" ||
            value.schema.properties[value.itemKey]?.type !== "string" ||
            !value.schema.required.includes(value.itemKey)
        )
            throw new Error(
                "Collections require an explicit required string identity property",
            );
    } else if (value.itemKey !== undefined)
        throw new Error("Only collections declare an item key");
    if (!["proposed", "approved", "rejected"].includes(String(value.approval)))
        throw new Error("Question approval is required");
    if (
        !Array.isArray(value.discoveryCitations) ||
        value.discoveryCitations.length > 32
    )
        throw new Error("Invalid discovery citations");
    validateQuestionAdmission(value.admission);
    object(
        value.rubric,
        [
            "version",
            "selection",
            "requireConfirmation",
            "authoritySourceIds",
            "freshnessDays",
        ],
        "question rubric",
    );
    if (
        !Number.isSafeInteger(value.rubric.version) ||
        Number(value.rubric.version) < 1 ||
        !["mostRecent", "independentSupport", "manual"].includes(
            String(value.rubric.selection),
        ) ||
        typeof value.rubric.requireConfirmation !== "boolean"
    )
        throw new Error("Invalid question rubric");
    uniqueStrings(value.rubric.authoritySourceIds, "authority source IDs");
    for (const id of value.rubric.authoritySourceIds as string[])
        assertViewIdentifier("authority source ID", id);
    if (
        value.rubric.freshnessDays !== undefined &&
        (typeof value.rubric.freshnessDays !== "number" ||
            !Number.isFinite(value.rubric.freshnessDays) ||
            value.rubric.freshnessDays <= 0 ||
            value.rubric.freshnessDays > 36500)
    )
        throw new Error("Invalid freshness allowance");
}

export function validateSchemaViewDefinition(
    definition: ViewDefinitionInput,
): void {
    const value = definition.schemaView;
    if (value === undefined) {
        if (definition.kind === "schemaView")
            throw new Error("Schema views require schema-defined-v1");
        return;
    }
    if (
        definition.kind !== "schemaView" ||
        definition.wiki ||
        definition.projectSummary
    )
        throw new Error(
            "Schema construction cannot be combined with another view kind",
        );
    object(
        value,
        ["construction", "title", "slots", "template", "discovery"],
        "schema view",
    );
    if (
        value.construction !== "schema-defined-v1" ||
        value.template !== "questions-v1"
    )
        throw new Error("Unsupported schema construction or template");
    boundedText(value.title, "Schema view title", 300);
    if (
        !Array.isArray(value.slots) ||
        !value.slots.length ||
        value.slots.length > schemaViewLimits.slots
    )
        throw new Error("Schema views require 1 to 24 slots");
    value.slots.forEach(validateQuestionSlot);
    if (new Set(value.slots.map((slot) => slot.id)).size !== value.slots.length)
        throw new Error("Duplicate question slot identity");
    object(
        value.discovery,
        ["enabled", "maxProposals", "lastEvaluatedScope"],
        "discovery bounds",
    );
    if (
        typeof value.discovery.enabled !== "boolean" ||
        !Number.isSafeInteger(value.discovery.maxProposals) ||
        value.discovery.maxProposals < 0 ||
        value.discovery.maxProposals > schemaViewLimits.proposals
    )
        throw new Error("Discovery requires a finite proposal allowance");
    if (
        value.discovery.lastEvaluatedScope !== undefined &&
        !/^[a-f0-9]{64}$/.test(value.discovery.lastEvaluatedScope)
    )
        throw new Error("Invalid discovery scope fingerprint");
}

export function candidateIdentity(
    value: SchemaValue,
    itemKey?: string,
): string {
    return `candidate-${viewHash({ value, itemKey }).slice(0, 24)}`;
}

export function questionContractRevision(
    definition: ViewDefinitionInput,
    slot: QuestionSlot,
): string {
    return viewHash({
        viewId: definition.viewId,
        slot,
        scope: definition.maintenance ?? definition.selector,
    });
}

export function independentSupport(
    candidate: AnswerCandidate,
): number | undefined {
    const known = candidate.support.filter(
        (support) =>
            support.independenceKey && support.derivedFrom.length === 0,
    );
    return known.length
        ? new Set(
              known.map(
                  (support) =>
                      `${support.assertionOwner ?? ""}:${support.independenceKey}`,
              ),
          ).size
        : undefined;
}

function eligibleCandidate(
    slot: QuestionSlot,
    candidate: AnswerCandidate,
): boolean {
    return (
        candidate.review !== "rejected" &&
        (!candidate.opposingCitations.length ||
            candidate.review === "confirmed") &&
        (candidate.origin === "user" ||
            !slot.rubric.authoritySourceIds.length ||
            candidate.citations.some((citation) =>
                slot.rubric.authoritySourceIds.includes(citation.sourceId),
            )) &&
        (!slot.rubric.requireConfirmation || candidate.review === "confirmed")
    );
}

function candidateEffectiveTime(
    slot: QuestionSlot,
    candidate: AnswerCandidate,
): { value: number; scope: string } | undefined {
    const times = candidate.support
        .filter(
            (support) =>
                !slot.rubric.authoritySourceIds.length ||
                slot.rubric.authoritySourceIds.includes(
                    support.citation.sourceId,
                ),
        )
        .flatMap((support) => {
            const time = chronologyTime(support);
            return time ? [time] : [];
        });
    if (times.length) {
        if (new Set(times.map((time) => time.scope)).size !== 1)
            return undefined;
        return {
            value: Math.max(...times.map((time) => time.value)),
            scope: times[0].scope,
        };
    }
    if (!slot.rubric.authoritySourceIds.length)
        return chronologyTime(candidate);
    return undefined;
}

function chronologyTime(
    value: Pick<AnswerCandidate, "effectiveAt" | "localChronology">,
): { value: number; scope: string } | undefined {
    if (value.localChronology) {
        // The UTC suffix computes an ordering key, not an asserted timezone.
        const parsed = Date.parse(`${value.localChronology.timestamp}Z`);
        return Number.isFinite(parsed)
            ? { value: parsed, scope: `local:${value.localChronology.scope}` }
            : undefined;
    }
    if (value.effectiveAt) {
        const parsed = Date.parse(value.effectiveAt);
        if (Number.isFinite(parsed))
            return { value: parsed, scope: "absolute" };
    }
    return undefined;
}

function score(slot: QuestionSlot, candidate: AnswerCandidate): number {
    if (candidate.review === "confirmed") return Number.MAX_SAFE_INTEGER;
    if (slot.rubric.selection === "manual") return 0;
    if (slot.rubric.selection === "independentSupport")
        return independentSupport(candidate) ?? 0;
    return candidateEffectiveTime(slot, candidate)?.value ?? 0;
}

function compareCandidates(
    slot: QuestionSlot,
    a: AnswerCandidate,
    b: AnswerCandidate,
): number {
    const primary = score(slot, b) - score(slot, a);
    if (primary !== 0) return primary;
    return 0;
}

function incomparableChronology(
    slot: QuestionSlot,
    group: AnswerCandidate[],
): boolean {
    return (
        slot.rubric.selection === "mostRecent" &&
        !group.some((candidate) => candidate.review === "confirmed") &&
        new Set(
            group.map(
                (candidate) =>
                    candidateEffectiveTime(slot, candidate)?.scope ?? "unknown",
            ),
        ).size > 1
    );
}

export function resolveQuestion(
    slot: QuestionSlot,
    candidates: AnswerCandidate[],
    evaluatedSources: QuestionDetails["evaluatedSources"],
    now = Date.now(),
): QuestionDetails {
    const groups = new Map<string, AnswerCandidate[]>();
    if (slot.approval === "approved") {
        for (const candidate of candidates.filter((entry) =>
            eligibleCandidate(slot, entry),
        )) {
            const key =
                slot.cardinality === "collection" ? candidate.itemKey! : "";
            const group = groups.get(key) ?? [];
            group.push(candidate);
            groups.set(key, group);
        }
    }
    const selected: AnswerCandidate[] = [];
    let conflict =
        slot.approval === "approved" &&
        candidates.some(
            (candidate) =>
                candidate.opposingCitations.length &&
                candidate.review === "unreviewed",
        );
    for (const group of groups.values()) {
        if (incomparableChronology(slot, group)) {
            conflict = true;
            continue;
        }
        const ranked = [...group].sort((a, b) => compareCandidates(slot, a, b));
        if (
            ranked.length > 1 &&
            compareCandidates(slot, ranked[0], ranked[1]) === 0
        ) {
            conflict = true;
            continue;
        }
        if (
            slot.rubric.selection !== "manual" ||
            ranked[0].review === "confirmed"
        )
            selected.push(ranked[0]);
    }
    const expired =
        slot.rubric.freshnessDays !== undefined &&
        selected.some(
            (candidate) =>
                !candidate.effectiveAt ||
                now - Date.parse(candidate.effectiveAt) >
                    slot.rubric.freshnessDays! * 86400000,
        );
    const partial =
        slot.cardinality === "collection" ||
        selected.some(
            (candidate) => !completeAnswer(slot.schema, candidate.value),
        );
    return {
        kind: "question",
        slotId: slot.id,
        candidates,
        selectedCandidateIds: selected.map((candidate) => candidate.id),
        answerState: conflict
            ? "conflicted"
            : selected.length
              ? partial
                  ? "partial"
                  : "answered"
              : "pending",
        reviewState:
            selected.length &&
            selected.every((candidate) => candidate.review === "confirmed")
                ? "confirmed"
                : candidates.length &&
                    candidates.every(
                        (candidate) => candidate.review === "rejected",
                    )
                  ? "rejected"
                  : "unreviewed",
        freshness: expired ? "expired" : "current",
        coverage: selected.length ? "partial" : "unknown",
        evaluatedSources,
        scopeFingerprint: viewHash(
            [...evaluatedSources].sort((a, b) =>
                viewSourceKey(a).localeCompare(viewSourceKey(b)),
            ),
        ),
    };
}

export function questionBody(
    slot: QuestionSlot,
    details: QuestionDetails,
): string {
    const selected = details.candidates.filter((candidate) =>
        details.selectedCandidateIds.includes(candidate.id),
    );
    return [
        `Answer state: ${details.answerState}; review: ${details.reviewState}; maintenance freshness: ${details.freshness}.`,
        ...(selected.some((candidate) => candidate.origin !== "user")
            ? [
                  "Retained-source answers report historical observations only, not verified present-day status. Maintenance freshness is not evidence that a past observation remains true today.",
              ]
            : []),
        ...(slot.cardinality === "collection"
            ? [
                  "Collection coverage is incomplete; absence is not evidence of non-membership.",
              ]
            : []),
        ...(selected.length
            ? selected.map(
                  (candidate) =>
                      `Origin: ${candidate.origin === "user" ? "authenticated user assertion, not retained-source evidence" : "retained source"}; review: ${candidate.review}.\n${candidateTemporalContext(candidate)}${JSON.stringify(candidate.value, null, 2)}`,
              )
            : ["Unknown: no uniquely eligible answer."]),
    ].join("\n\n");
}

function candidateTemporalContext(candidate: AnswerCandidate): string {
    if (candidate.origin === "user") return "";
    const observations = candidate.support.length
        ? candidate.support
        : [candidate];
    const times = [
        ...new Set(
            observations.map((observation) =>
                observation.localChronology
                    ? `${observation.localChronology.timestamp} (local chronology: ${observation.localChronology.scope}; timezone unspecified)`
                    : (observation.effectiveAt ?? "unknown observation time"),
            ),
        ),
    ];
    return `Source observation times: ${times.join("; ")}.\n`;
}

export function questionSection(
    slot: QuestionSlot,
    details: QuestionDetails,
): QuestionSection {
    return {
        id: slot.id,
        role: "question",
        heading: slot.question,
        body: questionBody(slot, details),
        details,
    };
}

export function schemaCitations(
    definition: SchemaViewDefinition,
    sections: QuestionSection[],
): ViewCitation[] {
    const all = [
        ...definition.slots.flatMap((slot) => slot.discoveryCitations),
        ...sections.flatMap((section) =>
            section.details.candidates.flatMap((candidate) => [
                ...candidate.citations,
                ...candidate.opposingCitations,
            ]),
        ),
    ];
    return [
        ...new Map(
            all.map((citation) => [viewHash(citation), citation]),
        ).values(),
    ];
}

export function emptySchemaView(
    definition: SchemaViewDefinition,
    sources: QuestionDetails["evaluatedSources"] = [],
): SchemaViewContent {
    const sections = definition.slots.map((slot) =>
        questionSection(slot, resolveQuestion(slot, [], sources)),
    );
    return {
        kind: "schemaView",
        construction: "schema-defined-v1",
        title: definition.title,
        sections,
        citations: schemaCitations(definition, sections),
    };
}

function validateCandidate(
    slot: QuestionSlot,
    candidate: AnswerCandidate,
): void {
    object(
        candidate,
        [
            "id",
            "value",
            "itemKey",
            "origin",
            "review",
            "citations",
            "opposingCitations",
            "effectiveAt",
            "localChronology",
            "assertionOwner",
            "independenceKey",
            "derivedFrom",
            "support",
        ],
        "answer candidate",
    );
    validateAnswerValue(slot.schema, candidate.value);
    if (candidate.id !== candidateIdentity(candidate.value, candidate.itemKey))
        throw new Error("Candidate identity does not match its value");
    validateCandidateKey(slot, candidate);
    if (
        !["source", "user"].includes(candidate.origin) ||
        !["unreviewed", "confirmed", "rejected"].includes(candidate.review)
    )
        throw new Error("Invalid candidate origin or review state");
    if (
        !Array.isArray(candidate.citations) ||
        !Array.isArray(candidate.opposingCitations) ||
        !Array.isArray(candidate.support)
    )
        throw new Error("Candidate evidence arrays are required");
    if (candidate.origin === "source" && !candidate.citations.length)
        throw new Error("Source candidate requires retained evidence");
    if (
        candidate.origin === "user" &&
        (candidate.citations.length || candidate.support.length)
    )
        throw new Error("User assertions cannot forge source support");
    if (candidate.effectiveAt !== undefined)
        validateIsoTimestamp("candidate effective time", candidate.effectiveAt);
    validateLocalChronology(candidate);
    uniqueStrings(candidate.derivedFrom, "candidate derivation");
    validateCandidateSupport(candidate);
}

function validateCandidateKey(
    slot: QuestionSlot,
    candidate: AnswerCandidate,
): void {
    if (slot.cardinality === "collection") {
        const value = candidate.value;
        if (
            !value ||
            typeof value !== "object" ||
            Array.isArray(value) ||
            typeof value[slot.itemKey!] !== "string" ||
            value[slot.itemKey!] !== candidate.itemKey ||
            !candidate.itemKey?.trim() ||
            candidate.itemKey.length > 200
        )
            throw new Error(
                "Collection candidate has an invalid or ambiguous identity",
            );
    } else if (candidate.itemKey !== undefined)
        throw new Error("Only collection candidates have item keys");
}

function validateCandidateSupport(candidate: AnswerCandidate): void {
    for (const support of candidate.support) {
        object(
            support,
            [
                "citation",
                "independenceKey",
                "assertionOwner",
                "effectiveAt",
                "localChronology",
                "derivedFrom",
            ],
            "candidate support",
        );
        if (
            !candidate.citations.some(
                (citation) => viewHash(citation) === viewHash(support.citation),
            )
        )
            throw new Error("Support must reference a candidate citation");
        uniqueStrings(support.derivedFrom, "support derivation");
        if (support.effectiveAt !== undefined)
            validateIsoTimestamp("support effective time", support.effectiveAt);
        validateLocalChronology(support);
        if (support.independenceKey !== undefined)
            boundedText(support.independenceKey, "Independence key", 200);
        if (support.assertionOwner !== undefined)
            boundedText(support.assertionOwner, "Assertion owner", 200);
    }
}

function validateLocalChronology(
    value: Pick<AnswerCandidate, "effectiveAt" | "localChronology">,
): void {
    const chronology = value.localChronology;
    if (chronology === undefined) return;
    object(chronology, ["timestamp", "scope"], "local chronology");
    if (
        value.effectiveAt !== undefined ||
        typeof chronology.timestamp !== "string" ||
        !/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?$/.test(chronology.timestamp)
    )
        throw new Error("Invalid local chronology timestamp");
    validateIsoTimestamp(
        "local chronology",
        `${chronology.timestamp}${chronology.timestamp.length === 16 ? ":00" : ""}Z`,
    );
    boundedText(chronology.scope, "Local chronology scope", 200);
}

export function validateSchemaViewContent(
    definition: ViewDefinitionInput,
    content: SchemaViewContent,
): void {
    const schema = definition.schemaView;
    if (
        !schema ||
        content.construction !== "schema-defined-v1" ||
        content.title !== schema.title ||
        content.sections.length !== schema.slots.length
    )
        throw new Error("Schema view content differs from its definition");
    for (const slot of schema.slots) {
        const section = content.sections.find((entry) => entry.id === slot.id);
        if (
            !section ||
            section.role !== "question" ||
            section.heading !== slot.question ||
            section.details?.kind !== "question" ||
            section.details.slotId !== slot.id
        )
            throw new Error("Question section identity mismatch");
        const details = section.details;
        object(
            details,
            [
                "kind",
                "slotId",
                "candidates",
                "selectedCandidateIds",
                "answerState",
                "reviewState",
                "freshness",
                "coverage",
                "evaluatedSources",
                "scopeFingerprint",
            ],
            "question state",
        );
        if (
            !Array.isArray(details.candidates) ||
            details.candidates.length > schemaViewLimits.candidates
        )
            throw new Error("Candidate bound exceeded");
        if (!["current", "stale", "expired"].includes(details.freshness))
            throw new Error("Invalid freshness state");
        details.candidates.forEach((candidate) =>
            validateCandidate(slot, candidate),
        );
        if (
            new Set(details.candidates.map((candidate) => candidate.id))
                .size !== details.candidates.length
        )
            throw new Error("Duplicate candidate identity");
        if (
            !Array.isArray(details.evaluatedSources) ||
            viewHash(details.evaluatedSources) !==
                viewHash(definition.selector.sources)
        )
            throw new Error(
                "Question evaluation must cover the selected exact source revisions",
            );
        const expected = resolveQuestion(
            slot,
            details.candidates,
            details.evaluatedSources,
        );
        if (
            viewHash({ ...details, freshness: expected.freshness }) !==
                viewHash(expected) ||
            section.body !==
                questionBody(slot, { ...details, freshness: details.freshness })
        )
            throw new Error(
                "Question resolution or rendered content is not canonical",
            );
    }

    if (
        viewHash(content.citations) !==
        viewHash(schemaCitations(schema, content.sections))
    )
        throw new Error(
            "All candidates and discovered questions must remain visible to provenance traversal",
        );
}

export function sourceAssertionLineage(
    metadata: Record<string, unknown> | undefined,
):
    | NonNullable<ViewBuildSnapshot["inputs"][number]["assertionLineage"]>
    | undefined {
    const value = metadata?.assertionLineage;
    if (value === undefined) return undefined;
    object(
        value,
        ["owner", "independenceKey", "derivedFrom"],
        "source assertion lineage",
    );
    if (value.owner !== undefined)
        boundedText(value.owner, "Assertion owner", 200);
    if (value.independenceKey !== undefined)
        boundedText(value.independenceKey, "Independence key", 200);
    uniqueStrings(value.derivedFrom, "source derivation");
    return {
        ...(typeof value.owner === "string" ? { owner: value.owner } : {}),
        ...(typeof value.independenceKey === "string"
            ? { independenceKey: value.independenceKey }
            : {}),
        derivedFrom: value.derivedFrom as string[],
    };
}

export function validateSchemaOutput(
    input: ViewBuildSnapshot,
    output: ViewSynthesisOutput,
): void {
    if (
        output.content.kind !== "schemaView" ||
        output.outcome !== "schemaAnswers"
    )
        throw new Error("Schema construction requires schemaAnswers output");
    const sources = new Map(
        input.inputs.map((source) => [viewSourceKey(source), source]),
    );
    for (const citation of output.content.citations)
        validateSchemaCitation(citation, sources.get(viewSourceKey(citation)));
    for (const section of output.content.sections) {
        for (const candidate of section.details.candidates) {
            if (candidate.origin === "user") continue;
            if (
                new Set(
                    candidate.support.map((support) =>
                        viewHash(support.citation),
                    ),
                ).size !== candidate.citations.length
            )
                throw new Error(
                    "Every citation requires one host-owned support lineage",
                );
            for (const support of candidate.support) {
                const lineage = sources.get(
                    viewSourceKey(support.citation),
                )?.assertionLineage;
                if (
                    support.assertionOwner !== lineage?.owner ||
                    support.independenceKey !== lineage?.independenceKey ||
                    viewHash(support.derivedFrom) !==
                        viewHash(lineage?.derivedFrom ?? [])
                )
                    throw new Error(
                        "Candidate support lineage differs from retained source metadata",
                    );
            }
        }
    }
}

function validateSchemaCitation(
    citation: ViewCitation,
    source: ViewRetainedInput | undefined,
): void {
    const offsets = /^chars:(\d+)-(\d+)$/.exec(citation.locator);
    const start = Number(offsets?.[1]),
        end = Number(offsets?.[2]);
    if (
        !source ||
        !offsets ||
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start < 0 ||
        end <= start ||
        end > source.content.length ||
        source.content.slice(start, end) !== citation.excerpt
    )
        throw new Error(
            "Schema candidate citation does not match frozen retained evidence",
        );
}

export function mergeSchemaAnswers(
    current: ViewVersion,
    proposed: ViewSynthesisOutput,
): { output: ViewSynthesisOutput; conflicts: string[] } {
    const output = structuredClone(proposed);
    if (
        current.content.kind !== "schemaView" ||
        output.content.kind !== "schemaView" ||
        !current.definition.schemaView
    )
        throw new Error("Schema merge requires schema views");
    const conflicts: string[] = [];
    for (const section of output.content.sections) {
        const slot = current.definition.schemaView.slots.find(
            (slot) => slot.id === section.id,
        );
        const prior = current.content.sections.find(
            (entry) => entry.id === section.id,
        );
        if (!slot || !prior) continue;
        const candidates = section.details.candidates;
        for (const previous of prior.details.candidates) {
            const next = candidates.find(
                (candidate) => candidate.id === previous.id,
            );
            if (previous.origin === "user") {
                try {
                    validateAnswerValue(slot.schema, previous.value);
                } catch {
                    conflicts.push(`section:${section.id}`);
                    continue;
                }
                if (next) Object.assign(next, structuredClone(previous));
                else candidates.push(structuredClone(previous));
            } else if (next) next.review = previous.review;
        }
        const details = resolveQuestion(
            slot,
            candidates,
            section.details.evaluatedSources,
        );
        Object.assign(section, questionSection(slot, details));
    }
    output.content.citations = schemaCitations(
        current.definition.schemaView,
        output.content.sections,
    );
    output.missingEvidence = output.content.sections
        .filter((section) => section.details.answerState !== "answered")
        .map((section) => section.heading);
    return { output, conflicts };
}
