// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";

const comparison = (fieldId, op, value, unit) => ({
    fieldId,
    op,
    value,
    ...(unit ? { unit } : {}),
});
const source = (id, values) => ({
    ownerKey: `source:${id}`,
    itemKey: id,
    values,
});
const measurement = (id, values) => ({
    ownerKey: "source:measurements",
    itemKey: id,
    values,
});
const project = (values) => ({ ownerKey: "view:eval-project", values });
const question = (values) => ({ ownerKey: "view:eval-questions", values });
const calendar = (raw) => ({ kind: "calendar", raw });
const instant = (raw) => ({ kind: "instant", raw });
function queryCase(
    id,
    slice,
    schemaId,
    comparisons,
    expected,
    queries,
    scope = {},
) {
    return {
        id,
        slice,
        schemaId,
        predicate: { and: comparisons },
        expected,
        queries,
        scope,
    };
}

export const measurementDescriptor = {
    schema: {
        id: "eval.measurements",
        revision: 1,
        description:
            "Producer-reported component measurements; duration is in milliseconds",
        fields: {
            component: { type: "string" },
            duration: { type: "number", unit: "ms", optional: true },
            passed: { type: "boolean", optional: true },
            tags: { type: "string", multiple: true },
        },
    },
    rowsPointer: "/items",
    itemKeyPointer: "/id",
    fields: {
        component: "/component",
        duration: "/duration",
        passed: "/passed",
        tags: "/tags",
    },
};

const slot = (id, question, schema) => ({
    id,
    question,
    cardinality: schema.type === "object" ? "record" : "singleton",
    schema,
    rubric: {
        version: 1,
        selection: "mostRecent",
        requireConfirmation: false,
        authoritySourceIds: [],
    },
    approval: "approved",
    discoveryCitations: [],
});

export const frameFixture = {
    version: 1,
    provenance: {
        kind: "authored-synthetic",
        license: "MIT",
        description:
            "Fictional evaluation records, independent source facts and expected query results; no private sessions",
    },
    sources: [
        {
            sourceId: "scope-a",
            sourceType: "text",
            title: "O'Brien release note",
            text: "Synthetic release note: the widget service deployment completed in the test environment. This is a producer report, not independent verification.",
            tags: ["release"],
            capturedAt: "2026-11-03T09:00:00Z",
            metadata: {
                repository: "contoso/widgets",
                commit: "baseline",
                environment: "test",
            },
        },
        {
            sourceId: "scope-b",
            sourceType: "text",
            title: "Other release note",
            text: "Synthetic release note for a separate repository and production environment.",
            tags: ["other"],
            capturedAt: "2026-11-02T09:00:00Z",
            metadata: {
                repository: "contoso/other",
                commit: "different",
                environment: "production",
            },
        },
        {
            sourceId: "measurements",
            sourceType: "text",
            title: "Synthetic component measurements",
            text: JSON.stringify({
                items: [
                    {
                        id: "m1",
                        component: "api",
                        duration: 10,
                        passed: false,
                        tags: ["cold", "user"],
                        region: "west",
                    },
                    {
                        id: "m2",
                        component: "batch",
                        duration: 40,
                        passed: true,
                        tags: ["warm"],
                        region: "east",
                    },
                    {
                        id: "m3",
                        component: "api",
                        duration: 50,
                        passed: true,
                        tags: ["hot", "cold"],
                        region: "west",
                    },
                    {
                        id: "m4",
                        component: "api",
                        duration: null,
                        tags: [],
                        region: "east",
                    },
                    {
                        id: "m5",
                        component: "O'Brien",
                        duration: 30,
                        passed: false,
                        tags: ["hot"],
                        region: "west",
                    },
                ],
            }),
            metadata: { frameProviderId: "eval" },
        },
        {
            sourceId: "question-facts",
            sourceType: "text",
            title: "Synthetic approved account facts",
            text: "The evaluation account budget is 120. The shipping city is Dublin and the shipping tier is 2. Automated renewal is disabled (false). The account codename has never been supplied; there is no evidence for a codename.",
        },
        {
            sourceId: "project-facts",
            sourceType: "text",
            title: "Synthetic Northstar project brief",
            text: "Northstar project status: active. Incident status: not applicable. Capacity status: validated. Delivery responsibility has known owner Ada. Review responsibility is explicitly unassigned and has no owner. Milestone launch is confirmed for 2026-11-09. Milestone audit is blocked and dated 2026-11-12. Risk dependency-delay is open. Decision retain-api is confirmed. These are current recorded facts, not proposals.",
        },
    ],
    session: {
        sessionId: "eval-session",
        repository: "contoso/widgets",
        commit: "baseline",
        environment: "test",
        events: [
            {
                schemaVersion: 1,
                id: "event-objective",
                sessionId: "eval-session",
                kind: "objective",
                role: "user",
                timestamp: "2026-11-03T09:00:00Z",
                text: "Inspect the synthetic widget deployment.",
            },
            {
                schemaVersion: 1,
                id: "event-message",
                sessionId: "eval-session",
                kind: "message",
                role: "assistant",
                timestamp: "2026-11-03T09:01:00Z",
                text: "I will inspect the widget deployment. No outcome is reported in this message.",
            },
            {
                schemaVersion: 1,
                id: "event-verification",
                sessionId: "eval-session",
                kind: "verification",
                role: "tool",
                timestamp: "2026-11-03T09:02:00Z",
                outcome: "success",
                text: "The synthetic verification tool reports success.",
            },
        ],
    },
    slots: [
        slot("budget", "What is the evaluation account budget?", {
            type: "number",
        }),
        slot(
            "shipping",
            "What are the evaluation account shipping city and tier?",
            {
                type: "object",
                properties: {
                    city: { type: "string" },
                    tier: { type: "number" },
                },
                required: ["city", "tier"],
            },
        ),
        slot(
            "renewal",
            "Is automated renewal enabled for the evaluation account?",
            { type: "boolean" },
        ),
        slot("codename", "What is the evaluation account codename?", {
            type: "string",
        }),
    ],
    cases: [
        queryCase(
            "source-title",
            "source",
            "source",
            [comparison("title", "eq", "O'Brien release note")],
            [source("scope-a", { title: "O'Brien release note" })],
            [
                "Find the source whose title is exactly O'Brien release note.",
                "Which source has title O'Brien release note?",
            ],
        ),
        queryCase(
            "source-tag",
            "source",
            "source",
            [comparison("tags", "eq", "release")],
            [source("scope-a", { tags: ["release"] })],
            [
                "Find sources tagged release.",
                "Show source records with a release tag.",
            ],
        ),
        queryCase(
            "source-scope",
            "source",
            "source",
            [
                comparison("repository", "eq", "contoso/widgets"),
                comparison("commit", "eq", "baseline"),
                comparison("environment", "eq", "test"),
            ],
            [
                source("scope-a", {
                    repository: "contoso/widgets",
                    commit: "baseline",
                    environment: "test",
                }),
            ],
            [
                "Find sources in repository contoso/widgets at commit baseline in environment test.",
                "Select records where repository equals contoso/widgets, commit equals baseline and environment equals test.",
            ],
            { sourceIds: ["scope-a", "scope-b"] },
        ),
        queryCase(
            "source-instant",
            "source",
            "source",
            [comparison("capturedAt", "gte", instant("2026-11-03T00:00:00Z"))],
            [
                source("scope-a", {
                    capturedAt: instant("2026-11-03T09:00:00Z"),
                }),
            ],
            [
                "Find sources captured at or after 2026-11-03T00:00:00Z.",
                "Which sources have capturedAt greater than or equal to the instant 2026-11-03T00:00:00Z?",
            ],
            { sourceIds: ["scope-a", "scope-b"] },
        ),
        queryCase(
            "event-role",
            "source",
            "source.event",
            [comparison("role", "eq", "assistant")],
            [
                {
                    itemKey: "event-message",
                    values: { eventId: "event-message", role: "assistant" },
                },
            ],
            [
                "Find events whose role is assistant.",
                "Which event records have assistant as the role?",
            ],
        ),
        queryCase(
            "event-outcome",
            "source",
            "source.event",
            [comparison("outcome", "eq", "success")],
            [
                {
                    itemKey: "event-verification",
                    values: {
                        eventId: "event-verification",
                        outcome: "success",
                        authority: "producerReported",
                    },
                },
            ],
            [
                "Find events with reported outcome success.",
                "Select events whose outcome equals success.",
            ],
        ),
        queryCase(
            "event-boundary",
            "source",
            "source.event",
            [
                comparison("role", "eq", "tool"),
                comparison("timestamp", "gte", instant("2026-11-03T09:02:00Z")),
            ],
            [
                {
                    itemKey: "event-verification",
                    values: {
                        eventId: "event-verification",
                        timestamp: instant("2026-11-03T09:02:00Z"),
                    },
                },
            ],
            [
                "Find tool-role events at or after 2026-11-03T09:02:00Z.",
                "Select events with role tool and timestamp greater than or equal to 2026-11-03T09:02:00Z.",
            ],
        ),
        queryCase(
            "event-missing",
            "source",
            "source.event",
            [comparison("outcome", "neq", "failure")],
            [{ itemKey: "event-verification", values: { outcome: "success" } }],
            [
                "Find events with a recorded outcome unequal to failure; do not include events with no outcome.",
                "Select events whose known outcome is not equal to failure.",
            ],
        ),
        queryCase(
            "slot-inventory",
            "question",
            "question.slot",
            [comparison("slotId", "eq", "budget")],
            [question({ slotId: "budget", answerState: "answered" })],
            [
                "Find the question slot whose slotId is budget.",
                "Select the slot with ID budget.",
            ],
        ),
        queryCase(
            "slot-unresolved",
            "question",
            "question.slot",
            [comparison("slotId", "eq", "codename")],
            [question({ slotId: "codename", answerState: "pending" })],
            [
                "Find the question slot with slotId codename.",
                "Which slot has ID codename?",
            ],
        ),
        queryCase(
            "answer-budget",
            "question",
            "@budget",
            [comparison("value", "gte", 100)],
            [question({ value: 120, slotId: "budget" })],
            [
                "Find budget answers with a value at least 100.",
                "Select values greater than or equal to 100.",
            ],
        ),
        queryCase(
            "answer-budget-boundary",
            "question",
            "@budget",
            [comparison("value", "lt", 120)],
            [],
            [
                "Find budget answer values below 120.",
                "Which answers have value strictly less than 120?",
            ],
        ),
        queryCase(
            "answer-record",
            "question",
            "@shipping",
            [
                comparison("value.city", "eq", "Dublin"),
                comparison("value.tier", "gte", 2),
            ],
            [
                question({
                    "value.city": "Dublin",
                    "value.tier": 2,
                    slotId: "shipping",
                }),
            ],
            [
                "Find shipping answers with city Dublin and tier at least 2.",
                "Select records where value.city is Dublin and value.tier is greater than or equal to 2.",
            ],
        ),
        queryCase(
            "answer-record-boundary",
            "question",
            "@shipping",
            [comparison("value.tier", "gt", 2)],
            [],
            [
                "Find shipping answers with tier greater than 2.",
                "Which records have value.tier strictly above 2?",
            ],
        ),
        queryCase(
            "answer-false",
            "question",
            "@renewal",
            [comparison("value", "eq", false)],
            [question({ value: false, slotId: "renewal" })],
            [
                "Find renewal answers with Boolean value false.",
                "Select answers where value is false.",
            ],
        ),
        queryCase(
            "answer-missing",
            "question",
            "@codename",
            [comparison("value", "eq", "unknown")],
            [],
            [
                "Find codename answers whose literal value is unknown.",
                "Select answers with the exact string value unknown.",
            ],
        ),
        queryCase(
            "project-active",
            "project",
            "project.status",
            [comparison("project", "eq", "active")],
            [project({ project: "active", capacity: "validated" })],
            [
                "Find project status rows with project active.",
                "Select rows whose project status equals active.",
            ],
        ),
        queryCase(
            "project-negative",
            "project",
            "project.status",
            [comparison("project", "eq", "blocked")],
            [],
            [
                "Find project status rows with project blocked.",
                "Select blocked projects.",
            ],
        ),
        queryCase(
            "project-owner",
            "project",
            "project.owner",
            [comparison("owner", "eq", "Ada")],
            [project({ owner: "Ada", state: "known" })],
            [
                "Find owner assignments for Ada.",
                "Which owner rows have owner equal to Ada?",
            ],
        ),
        queryCase(
            "project-unassigned",
            "project",
            "project.owner",
            [comparison("state", "eq", "unassigned")],
            [project({ state: "unassigned", owner: null })],
            [
                "Find owner assignments whose state is unassigned.",
                "Select unassigned responsibility rows.",
            ],
        ),
        queryCase(
            "project-date",
            "project",
            "project.milestone",
            [comparison("date", "lte", calendar("2026-11-10"))],
            [project({ status: "confirmed", date: calendar("2026-11-09") })],
            [
                "Find milestones dated on or before 2026-11-10, using calendar dates.",
                "Which milestone dates are less than or equal to calendar date 2026-11-10?",
            ],
        ),
        queryCase(
            "project-blocked",
            "project",
            "project.milestone",
            [comparison("status", "eq", "blocked")],
            [project({ status: "blocked", date: calendar("2026-11-12") })],
            [
                "Find milestones with status blocked.",
                "Which milestone rows are blocked?",
            ],
        ),
        queryCase(
            "project-risk",
            "project",
            "project.risk",
            [comparison("status", "eq", "open")],
            [project({ status: "open" })],
            ["Find risks with status open.", "Select open risk rows."],
        ),
        queryCase(
            "project-decision",
            "project",
            "project.decision",
            [comparison("status", "eq", "confirmed")],
            [project({ status: "confirmed" })],
            [
                "Find decisions with status confirmed.",
                "Select confirmed decision rows.",
            ],
        ),
        queryCase(
            "provider-same-item",
            "provider",
            "eval.measurements",
            [
                comparison("component", "eq", "api"),
                comparison("duration", "gte", 30, "ms"),
            ],
            [measurement("m3", { component: "api", duration: 50 })],
            [
                "Find api measurements with duration at least 30 ms in the same record.",
                "Select records where component is api and duration is greater than or equal to 30 milliseconds.",
            ],
        ),
        queryCase(
            "provider-boundary",
            "provider",
            "eval.measurements",
            [comparison("duration", "lte", 30, "ms")],
            [
                measurement("m1", { duration: 10 }),
                measurement("m5", { duration: 30 }),
            ],
            [
                "Find measurements with duration at most 30 ms.",
                "Which durations are less than or equal to 30 milliseconds?",
            ],
        ),
        queryCase(
            "provider-false",
            "provider",
            "eval.measurements",
            [comparison("passed", "eq", false)],
            [
                measurement("m1", { passed: false }),
                measurement("m5", { passed: false }),
            ],
            [
                "Find measurements whose passed flag is false.",
                "Select records with passed equal to Boolean false.",
            ],
        ),
        queryCase(
            "provider-quoted",
            "provider",
            "eval.measurements",
            [comparison("component", "eq", "O'Brien")],
            [measurement("m5", { component: "O'Brien" })],
            [
                "Find measurements for component O'Brien.",
                "Select records where component equals O'Brien.",
            ],
        ),
        queryCase(
            "provider-existential",
            "provider",
            "eval.measurements",
            [comparison("tags", "neq", "hot")],
            [
                measurement("m1", { tags: ["cold", "user"] }),
                measurement("m2", { tags: ["warm"] }),
                measurement("m3", { tags: ["hot", "cold"] }),
            ],
            [
                "Find measurements with at least one tag unequal to hot, even if another tag is hot.",
                "Select records having any tag other than hot; include mixed hot and non-hot tag arrays.",
            ],
        ),
        queryCase(
            "provider-unit",
            "provider",
            "eval.measurements",
            [comparison("duration", "gte", 40, "ms")],
            [
                measurement("m2", { duration: 40 }),
                measurement("m3", { duration: 50 }),
            ],
            [
                "Find measurements lasting at least 40 milliseconds.",
                "Select duration greater than or equal to 40 ms.",
            ],
        ),
    ],
};

export function createFrameViewProvider(hash) {
    let authorized = true;
    const outputSchema = {
        type: "object",
        properties: {
            items: {
                type: "array",
                maxItems: 1,
                items: {
                    type: "object",
                    properties: {
                        id: { type: "string", maxLength: 100 },
                        blockId: { type: "string", maxLength: 100 },
                        duration: { type: "number" },
                    },
                    required: ["id", "blockId", "duration"],
                },
            },
        },
        required: ["items"],
    };
    const installed = {
        descriptor: {
            apiVersion: 1,
            label: "Deterministic retained-measurement recap",
            identity: {
                providerId: "eval-recap",
                version: "1",
                implementationDigest: hash("retained-measurement-recap-v1"),
                inputContract: "retained-measurement-input-v1",
                outputContract: "retained-measurement-output-v1",
                schemaDigest: hash(outputSchema),
                recipeDigest: hash(
                    "Select m3 and preserve the producer-report qualification",
                ),
            },
            outputSchema,
            indexProjection: [
                {
                    schema: {
                        id: "eval-recap.duration",
                        revision: 1,
                        description: "Retained producer-reported API duration",
                        fields: { duration: { type: "number", unit: "ms" } },
                    },
                    rowsPointer: "/items",
                    itemKeyPointer: "/id",
                    blockIdPointer: "/blockId",
                    fields: { duration: "/duration" },
                },
            ],
            definitions: [
                { id: "recap", eligibilityVersion: "1", mode: "static" },
            ],
            limits: {
                maxSources: 3,
                maxInputChars: 120000,
                maxOutputChars: 120000,
                maxModelCalls: 6,
                timeoutMs: 30000,
            },
        },
        authorize: async () => authorized,
        evaluateEligibility: async () => ({
            disposition: "eligible",
            reason: "Explicit evaluation provider over retained synthetic JSON",
        }),
        prepare: async (input) => {
            const source = input.inputs.find(
                (item) => item.sourceId === "measurements",
            );
            const qualification = input.inputs.find(
                (item) => item.sourceId === "provider-qualification",
            );
            assert.ok(
                source && qualification,
                "Provider requires numeric source and qualification",
            );
            const item = JSON.parse(source.content).items.find(
                (item) => item.id === "m3",
            );
            assert.ok(
                item && Number.isFinite(item.duration),
                "Provider requires an actual finite retained measurement",
            );
            assert.ok(
                qualification.content.includes(
                    "not independent performance verification",
                ),
            );
            const cite = (source) => ({
                sourceId: source.sourceId,
                revisionId: source.revisionId,
                locator: `chars:0-${source.content.length}`,
                excerpt: source.content,
            });
            return {
                duration: item.duration,
                support: cite(source),
                opposition: cite(qualification),
            };
        },
        generate: async (input, prepared) => ({
            kind: "extension",
            construction: "extension-v1",
            provider: installed.descriptor.identity,
            title: "Retained producer measurement",
            sections: [
                {
                    id: "measurement",
                    role: "context",
                    heading: "Producer report",
                    body: `The producer reported an API duration of ${prepared.duration} ms; independent performance verification is not established.`,
                },
            ],
            citations: [prepared.support, prepared.opposition],
            evidence: [
                {
                    blockId: "measurement",
                    support: [prepared.support],
                    opposition: [prepared.opposition],
                },
            ],
            payload: {
                items: [
                    {
                        id: "m3",
                        blockId: "measurement",
                        duration: prepared.duration,
                    },
                ],
            },
            presentation: {
                schemaVersion: 1,
                templateId: "document-v1",
                templateVersion: 1,
                layouts: [
                    {
                        id: "story",
                        label: "Report",
                        groups: [
                            {
                                id: "report",
                                label: "Measurement",
                                blockIds: ["measurement"],
                            },
                        ],
                    },
                ],
            },
            inputUse: input.inputs.map((source) => ({
                sourceId: source.sourceId,
                revisionId: source.revisionId,
                disposition: [
                    "measurements",
                    "provider-qualification",
                ].includes(source.sourceId)
                    ? "represented"
                    : "unused",
                reason:
                    source.sourceId === "scope-b"
                        ? "Retained context, not supporting evidence"
                        : "Exact retained measurement or qualification",
            })),
            fidelity: {
                supported: true,
                sections: [
                    {
                        sectionId: "measurement",
                        supported: true,
                        reason: "Deterministic projection of retained JSON with its exact qualification",
                    },
                ],
                relationships: [
                    "measurement.support.0",
                    "measurement.opposition.0",
                ].map((edgeId) => ({
                    edgeId,
                    supported: true,
                    reason: "Exact retained source span",
                })),
                missingContext: [],
                reasons: [],
            },
        }),
    };
    return {
        installed,
        revoke: () => {
            authorized = false;
        },
        restore: () => {
            authorized = true;
        },
    };
}
