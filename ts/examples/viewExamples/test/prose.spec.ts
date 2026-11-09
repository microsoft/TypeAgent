// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { readFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { jest } from "@jest/globals";
import {
    ViewExtensionRegistry,
    FileMemoryService,
    viewExtensionDigest,
    type ViewBuildSnapshot,
    type ViewProviderContext,
} from "@typeagent/memory-service";
import {
    packageRoot,
    procedureDefinition,
    hostOptions,
    buildProcedure,
    completedIngestion,
} from "../src/host.js";
import {
    reserveSerializedRequestForDispatch,
    type ChatModel,
} from "@typeagent/aiclient";
import { createProseProcedureProvider } from "../src/procedural/proseProvider.js";
import {
    prosePacket,
    parseExtraction,
    parseAssessment,
    renderProseProcedure,
    validateProseContent,
    structuredProseSchema,
    proseOutputSchema,
} from "../src/procedural/proseContract.js";
import type {
    ProcedureExtraction,
    ProcedureRecord,
} from "../src/procedural/extractionSchema.js";
import {
    orderingConflictIds,
    parseProcedureSource,
    procedurePayloadSchema,
} from "../src/procedural/contract.js";

async function fixture() {
    const content = await readFile(
        path.join(packageRoot, "fixtures", "connectivity-prose.txt"),
        "utf8",
    );
    const model = {
        completionSettings: {},
        complete: jest.fn(async () => {
            throw new Error("Use managed context");
        }),
    };
    const provider = await createProseProcedureProvider({
        corpusId: "fixture-corpus",
        sourceIds: ["source"],
        authorize: async () => true,
        approvedModelWork: true,
        model,
        modelIdentity: viewExtensionDigest("test-model"),
    });
    const source = {
        sourceId: "source",
        revisionId: "revision",
        title: "Fictional support",
        content,
        contentHash: viewExtensionDigest(content),
    };
    const snapshot: ViewBuildSnapshot = {
        corpusId: "fixture-corpus",
        actor: "test",
        expectedVersion: 0,
        bounds: {},
        definition: procedureDefinition(provider, "mock-connectivity", [
            { sourceId: "source", revisionId: "revision" },
        ]),
        inputs: [source],
        pipeline: "extension-v1",
        model: "scripted",
        fingerprint: viewExtensionDigest(source),
    };
    const entry = (
        record: ProcedureRecord,
        ...supportPassageIds: string[]
    ) => ({
        record,
        supportPassageIds,
        oppositionPassageIds: [],
    });
    const candidate: ProcedureExtraction = {
        title: "Fictional lantern connection support",
        entryStep: "check-link",
        titlePassageIds: ["p0"],
        unusedPassages: [],
        records: [
            entry(
                {
                    kind: "context",
                    id: "scope",
                    text: "Fictional simulator guidance, not device automation.",
                },
                "p1",
            ),
            entry(
                {
                    kind: "guard",
                    id: "consent",
                    text: "Ask permission before inspection. Never request passwords, factory-reset or alter account settings.",
                },
                "p2",
            ),
            entry(
                {
                    kind: "step",
                    id: "check-link",
                    text: "With caller permission, ask them to read the simulator indicator.",
                    requiredInputs: ["caller consent", "link indicator"],
                    expectedObservation: "green or amber",
                },
                "p2",
                "p3",
            ),
            entry(
                {
                    kind: "step",
                    id: "verify-page",
                    text: "Ask the caller to open the simulator status page and report its result.",
                    requiredInputs: ["status-page result"],
                    expectedObservation: null,
                },
                "p4",
            ),
            entry(
                {
                    kind: "outcome",
                    id: "escalate",
                    text: "Stop and hand indicator and status-page observations to a human support reviewer.",
                    result: "escalated",
                },
                "p5",
            ),
            entry(
                {
                    kind: "outcome",
                    id: "resolved",
                    text: "Record caller-confirmed ready; do not claim a real device was repaired.",
                    result: "resolved",
                },
                "p6",
            ),
            entry(
                {
                    kind: "transition",
                    id: "green",
                    from: "check-link",
                    to: "verify-page",
                    condition: "Caller reports green.",
                },
                "p4",
            ),
            entry(
                {
                    kind: "transition",
                    id: "amber",
                    from: "check-link",
                    to: "escalate",
                    condition: "Amber or cannot inspect.",
                },
                "p5",
            ),
            entry(
                {
                    kind: "transition",
                    id: "ready",
                    from: "verify-page",
                    to: "resolved",
                    condition: "Caller reports status page ready.",
                },
                "p6",
            ),
            entry(
                {
                    kind: "transition",
                    id: "not-ready",
                    from: "verify-page",
                    to: "escalate",
                    condition: "Status page not ready or unknown.",
                },
                "p5",
            ),
        ],
    };
    const packet = prosePacket(snapshot);
    const assessment = {
        supported: true,
        issues: [],
        coveredPassageIds: packet.passages.map((passage) => passage.id),
    };
    return { provider, snapshot, model, candidate, assessment, packet };
}

function execution(outputs: Array<string | Error>): ViewProviderContext {
    return {
        signal: AbortSignal.timeout(60000),
        deadline: Date.now() + 60000,
        assertEligible: jest.fn(async () => {}),
        checkpoint: jest.fn(async () => {}),
        recordCandidate: jest.fn(async () => {}),
        complete: jest.fn(async () => {
            const value = outputs.shift();
            if (value instanceof Error) throw value;
            if (value === undefined)
                throw new Error("Unexpected managed model stage");
            return value;
        }),
    };
}

test("prose registration, static eligibility and cold validation never call the injected model", async () => {
    const { provider, snapshot, model, candidate, assessment } =
        await fixture();
    expect(() => new ViewExtensionRegistry([provider])).not.toThrow();
    await provider.evaluateEligibility(snapshot, execution([]));
    await provider.prepare(snapshot);
    const content = renderProseProcedure(
        snapshot,
        provider.descriptor.identity,
        candidate,
        assessment,
    );
    validateProseContent(snapshot, provider.descriptor.identity, content);
    expect(model.complete).not.toHaveBeenCalled();
    expect(
        await provider.authorize(
            { ...snapshot, corpusId: "revoked-corpus" },
            "read",
        ),
    ).toBe(false);
    expect(
        await provider.authorize(
            {
                ...snapshot,
                inputs: [{ ...snapshot.inputs[0], sourceId: "revoked" }],
            },
            "model",
        ),
    ).toBe(false);
});

async function collectionFixture() {
    const value = await fixture();
    const paragraphs = [
        "Fictional cart support",
        "The fictional cart does not update. Options may be chosen in any order. Give instructions in your own words.",
        "Refresh the simulator page and retry. Choose Try Again; no form entry is required.",
        "Log out and back in. Choose Log Out/In; no form entry is required.",
        "Check stock on the product page. Enter 'troubleshoot' and choose Enter Details. The generic interface lists details_slotval and account_id; required parameters for this scenario are unspecified.",
        "For fictional assisted purchase, ask for the fictional payment reference, enter a brand-and-item phrase, then choose Make Purchase.",
        "If nothing works, apologize and end the conversation. Successful recovery and escalation are unspecified.",
    ];
    value.snapshot.inputs[0].content = paragraphs.join("\n\n");
    value.snapshot.inputs[0].contentHash = viewExtensionDigest(
        value.snapshot.inputs[0].content,
    );
    value.snapshot.fingerprint = viewExtensionDigest(value.snapshot.inputs);
    const entry = (
        record: ProcedureRecord,
        ...supportPassageIds: string[]
    ) => ({ record, supportPassageIds, oppositionPassageIds: [] });
    const action = (
        id: string,
        title: string,
        text: string,
        canonicalAction: string,
    ): Extract<ProcedureRecord, { kind: "action" }> => ({
        kind: "action",
        id,
        title,
        text,
        canonicalAction,
        informationRequests: null,
        formInstruction: null,
        interfaceParameters: null,
        sequence: null,
        selectionCondition: null,
        expectedObservation: null,
    });
    value.candidate = {
        title: paragraphs[0],
        entryStep: "options",
        titlePassageIds: ["p0"],
        unusedPassages: [],
        records: [
            entry(
                {
                    kind: "description",
                    id: "symptom",
                    text: "The fictional cart does not update.",
                },
                "p1",
            ),
            entry(
                {
                    kind: "policy",
                    id: "communication",
                    text: "Give instructions in your own words.",
                },
                "p1",
            ),
            entry(
                {
                    kind: "actionCollection",
                    id: "options",
                    text: "Choose source-listed alternatives.",
                    actionIds: ["retry", "login", "stock", "purchase"],
                    order: "any-order",
                },
                "p1",
            ),
            entry(
                {
                    ...action(
                        "retry",
                        "Refresh and retry",
                        "Refresh the simulator page and retry.",
                        "try-again",
                    ),
                    formInstruction: "No form entry required.",
                },
                "p2",
            ),
            entry(
                {
                    ...action(
                        "login",
                        "Log out and back in",
                        "Log out and back in.",
                        "log-out-in",
                    ),
                    formInstruction: "No form entry required.",
                },
                "p3",
            ),
            entry(
                {
                    ...action(
                        "stock",
                        "Check stock",
                        "Check stock on the product page.",
                        "enter-details",
                    ),
                    formInstruction: "Enter 'troubleshoot'.",
                    interfaceParameters: ["details_slotval", "account_id"],
                },
                "p4",
            ),
            entry(
                {
                    ...action(
                        "purchase",
                        "Assisted purchase",
                        "Fictional assisted purchase.",
                        "make-purchase",
                    ),
                    informationRequests: ["fictional payment reference"],
                    formInstruction: "Enter a brand-and-item phrase.",
                    sequence: [
                        "Ask for the fictional payment reference.",
                        "Enter the brand-and-item phrase.",
                        "Choose Make Purchase.",
                    ],
                },
                "p5",
            ),
            entry(
                {
                    kind: "gap",
                    id: "source-gaps",
                    text: "Successful recovery and escalation are unspecified.",
                },
                "p6",
            ),
            entry(
                {
                    kind: "outcome",
                    id: "unresolved",
                    text: "Apologize and end if nothing works.",
                    result: "unresolved",
                },
                "p6",
            ),
            entry(
                {
                    kind: "outcome",
                    id: "unknown",
                    text: "No successful recovery is specified.",
                    result: "unknown",
                },
                "p6",
            ),
            entry(
                {
                    kind: "transition",
                    id: "nothing-works",
                    from: "options",
                    to: "unresolved",
                    condition: "Nothing works for the collection.",
                },
                "p6",
            ),
            entry(
                {
                    kind: "transition",
                    id: "unspecified-result",
                    from: "options",
                    to: "unknown",
                    condition:
                        "The nothing-works condition is not established; handling is unspecified.",
                },
                "p6",
            ),
        ],
    };
    value.packet = prosePacket(value.snapshot);
    value.assessment.coveredPassageIds = value.packet.passages.map(
        ({ id }) => id,
    );
    return value;
}

test("typed actions can form a guarded graph with readable branches and exact cold reconstruction", async () => {
    const { snapshot, provider, candidate, assessment, model } =
        await fixture();
    candidate.records = candidate.records.map((entry) => {
        const record = entry.record;
        if (record.kind !== "step") return entry;
        return {
            ...entry,
            record: {
                kind: "action" as const,
                id: record.id,
                title: record.id.replace(/-/g, " "),
                text: record.text,
                canonicalAction: null,
                informationRequests: record.requiredInputs,
                formInstruction: null,
                interfaceParameters: null,
                sequence: null,
                selectionCondition: null,
                expectedObservation: record.expectedObservation,
            },
        };
    });
    const content = renderProseProcedure(
        snapshot,
        provider.descriptor.identity,
        candidate,
        assessment,
    );
    expect(content.presentation.templateId).toBe("procedure-guide-v1");
    const options = content.presentation.layouts[0].groups.find(
        ({ id }) => id === "options",
    )!;
    expect(options.label).toBe("Actions and decisions");
    const transition = candidate.records.find(
        ({ record }) => record.kind === "transition",
    )!.record;
    expect(options.blockIds).not.toContain(`source-0-record-${transition.id}`);
    expect(
        content.presentation.layouts[0].groups.find(
            ({ id }) => id === "technical",
        )!.blockIds,
    ).toContain(`source-0-record-${transition.id}`);
    expect(
        content.sections.find(
            ({ id }) => id === `source-0-record-${transition.id}`,
        )!.heading,
    ).toContain("From check link to verify page");
    for (const layout of content.presentation.layouts)
        expect(layout.groups.flatMap((group) => group.blockIds).sort()).toEqual(
            content.sections.map(({ id }) => id).sort(),
        );
    await new ViewExtensionRegistry([provider]).validateContent(
        snapshot,
        content,
    );
    expect(model.complete).not.toHaveBeenCalled();
    const orphan = structuredClone(candidate);
    orphan.records.push({
        ...orphan.records.find(({ record }) => record.kind === "action")!,
        record: {
            ...orphan.records.find(({ record }) => record.kind === "action")!
                .record,
            id: "orphan-action",
        },
    });
    expect(() => parseExtraction(orphan, prosePacket(snapshot))).toThrow(
        "no guarded transition",
    );
});

async function partialOrderFixture() {
    const original = await fixture();
    const content = [
        "Fictional conflicting start instructions",
        "Start by asking for readiness. Then perform account lookup.",
        "All chats start with account lookup before any other action.",
        "Wrap up by asking whether further assistance is needed. No result verification is specified.",
    ].join("\n\n");
    original.snapshot.inputs[0] = {
        ...original.snapshot.inputs[0],
        content,
        contentHash: viewExtensionDigest(content),
    };
    original.snapshot.fingerprint = viewExtensionDigest(
        original.snapshot.inputs[0],
    );
    const entry = (
        record: ProcedureRecord,
        supportPassageIds: string[],
        oppositionPassageIds: string[] = [],
    ) => ({ record, supportPassageIds, oppositionPassageIds });
    const action = (id: string, text: string): ProcedureRecord => ({
        kind: "action",
        id,
        title: id,
        text,
        canonicalAction: null,
        informationRequests: null,
        formInstruction: null,
        interfaceParameters: null,
        sequence: null,
        selectionCondition: null,
        expectedObservation: null,
    });
    const candidate: ProcedureExtraction = {
        title: "Fictional conflicting start instructions",
        entryStep: "workflow",
        titlePassageIds: ["p0"],
        unusedPassages: [],
        records: [
            entry(
                {
                    kind: "workflow",
                    id: "workflow",
                    text: "Both source starting instructions are retained without an inferred total order.",
                    nodeIds: ["ask-readiness", "account-lookup", "closure"],
                    order: "partial-order",
                },
                ["p1", "p2"],
            ),
            entry(action("ask-readiness", "Ask for readiness."), ["p1"]),
            entry(action("account-lookup", "Perform account lookup."), ["p2"]),
            entry(
                {
                    kind: "orderingConstraint",
                    id: "readiness-first",
                    before: "ask-readiness",
                    after: "account-lookup",
                    condition:
                        "Start by asking for readiness, then perform account lookup.",
                },
                ["p1"],
                ["p2"],
            ),
            entry(
                {
                    kind: "orderingConstraint",
                    id: "account-first",
                    before: "account-lookup",
                    after: "ask-readiness",
                    condition:
                        "All chats start with account lookup before any other action.",
                },
                ["p2"],
                ["p1"],
            ),
            entry(
                {
                    kind: "outcome",
                    id: "closure",
                    text: "Ask whether further assistance is needed; verification is unspecified.",
                    result: "unknown",
                },
                ["p3"],
            ),
            entry(
                {
                    kind: "gap",
                    id: "conflicting-starts",
                    text: "Source instructions disagree about which action starts the chat. Neither is omitted.",
                },
                ["p1", "p2"],
                ["p2"],
            ),
        ],
    };
    const packet = prosePacket(original.snapshot);
    const assessment = {
        supported: true,
        issues: [],
        coveredPassageIds: packet.passages.map(({ id }) => id),
    };
    return { ...original, candidate, packet, assessment };
}

async function decisionTableFixture() {
    const original = await partialOrderFixture();
    const content =
        original.snapshot.inputs[0].content +
        "\n\nFor account lookup: if a blue token is chosen, ask for its label and enter that label. If an amber token is chosen, do not ask for a label; enter its account ID.";
    original.snapshot.inputs[0] = {
        ...original.snapshot.inputs[0],
        content,
        contentHash: viewExtensionDigest(content),
    };
    original.snapshot.fingerprint = viewExtensionDigest(
        original.snapshot.inputs[0],
    );
    original.candidate.records.push({
        record: {
            kind: "decisionTable",
            id: "lookup-choices",
            title: "Lookup choices",
            text: "Use the chosen token's source instructions.",
            appliesTo: ["account-lookup"],
            columns: ["Token", "Label request", "Form value"],
            rows: [
                ["Blue", "Ask for its label", "Token label"],
                ["Amber", "Do not ask for a label", "Account ID"],
            ],
        },
        supportPassageIds: ["p4"],
        oppositionPassageIds: [],
    });
    const packet = prosePacket(original.snapshot);
    return {
        ...original,
        packet,
        assessment: {
            supported: true,
            issues: [],
            coveredPassageIds: packet.passages.map(({ id }) => id),
        },
    };
}

test("decision tables retain exact cells, action references and cold evidence without turning relationships into primary actions", async () => {
    const { snapshot, provider, candidate, assessment } =
        await decisionTableFixture();
    const content = renderProseProcedure(
        snapshot,
        provider.descriptor.identity,
        candidate,
        assessment,
    );
    const groups = content.presentation.layouts[0].groups;
    expect(groups.find(({ id }) => id === "options")!.blockIds).toEqual([
        "source-0-record-ask-readiness",
        "source-0-record-account-lookup",
        "source-0-record-lookup-choices",
    ]);
    expect(groups.findIndex(({ id }) => id === "gaps")).toBeLessThan(
        groups.findIndex(({ id }) => id === "options"),
    );
    expect(
        content.sections.find(({ id }) => id.endsWith("lookup-choices"))!.body,
    ).toContain("Label request: Do not ask for a label");
    await new ViewExtensionRegistry([provider]).validateContent(
        snapshot,
        content,
    );
    const tampered = structuredClone(content);
    const proof = tampered.payload;
    if (!proof || typeof proof !== "object" || Array.isArray(proof))
        throw new Error("Invalid fixture payload");
    proof.agentRepresentation = {
        topology: "partial-order",
        fabricatedChoice: "Green",
    };
    expect(() =>
        validateProseContent(snapshot, provider.descriptor.identity, tampered),
    ).toThrow("differs from its validated");
    for (const layout of content.presentation.layouts)
        expect(
            layout.groups.flatMap(({ blockIds }) => blockIds).sort(),
        ).toEqual(content.sections.map(({ id }) => id).sort());
});

test.each([
    "arity",
    "oversized-cell",
    "too-many-columns",
    "unknown-action",
    "non-action",
    "duplicate-action",
] as const)(
    "decision table rejects %s without a lossy projection",
    async (fault) => {
        const { candidate, packet } = await decisionTableFixture();
        const table = candidate.records[candidate.records.length - 1].record;
        if (table.kind !== "decisionTable")
            throw new Error("Expected decision table");
        if (fault === "arity") table.rows[0].pop();
        if (fault === "oversized-cell") table.rows[0][0] = "x".repeat(301);
        if (fault === "too-many-columns") table.columns.push("Fourth", "Fifth");
        if (fault === "unknown-action") table.appliesTo = ["absent"];
        if (fault === "non-action") table.appliesTo = ["closure"];
        if (fault === "duplicate-action")
            table.appliesTo.push(table.appliesTo[0]);
        expect(() => parseExtraction(candidate, packet)).toThrow();
    },
);

test("partial-order workflows preserve cyclic source claims, all nodes and exact cold reconstruction", async () => {
    const { snapshot, provider, candidate, assessment, model } =
        await partialOrderFixture();
    const content = renderProseProcedure(
        snapshot,
        provider.descriptor.identity,
        candidate,
        assessment,
    );
    expect(
        orderingConflictIds(candidate.records.map(({ record }) => record)),
    ).toEqual(["readiness-first", "account-first"]);
    expect(content.payload).toMatchObject({
        status: "conflicted",
        agentRepresentation: {
            topology: "partial-order",
            orderingConflictIds: ["readiness-first", "account-first"],
        },
    });
    expect(
        content.sections.find(({ id }) => id.endsWith("readiness-first")),
    ).toMatchObject({
        heading: "ask-readiness before account-lookup",
    });
    for (const layout of content.presentation.layouts)
        expect(
            layout.groups.flatMap(({ blockIds }) => blockIds).sort(),
        ).toEqual(content.sections.map(({ id }) => id).sort());
    await new ViewExtensionRegistry([provider]).validateContent(
        snapshot,
        content,
    );
    expect(model.complete).not.toHaveBeenCalled();
    const tampered = structuredClone(content);
    if (
        !tampered.payload ||
        typeof tampered.payload !== "object" ||
        Array.isArray(tampered.payload)
    )
        throw new Error("Invalid fixture payload");
    tampered.payload.agentRepresentation = {
        topology: "guarded-graph",
        orderingConflictIds: [],
    };
    expect(() =>
        validateProseContent(snapshot, provider.descriptor.identity, tampered),
    ).toThrow("differs from its validated");
});

test.each([
    "duplicate-node",
    "missing-node",
    "non-node-reference",
    "bad-endpoint",
    "mixed-transition",
    "missing-gap",
    "missing-opposition",
] as const)(
    "partial-order mode rejects %s rather than silently weakening its contract",
    async (fault) => {
        const { candidate, packet } = await partialOrderFixture();
        const workflow = candidate.records[0].record;
        if (workflow.kind !== "workflow")
            throw new Error("Expected workflow fixture");
        if (fault === "duplicate-node")
            workflow.nodeIds.push(workflow.nodeIds[0]);
        if (fault === "missing-node") workflow.nodeIds.pop();
        if (fault === "non-node-reference")
            workflow.nodeIds.push("conflicting-starts");
        if (fault === "bad-endpoint") {
            const edge = candidate.records[3].record;
            if (edge.kind !== "orderingConstraint")
                throw new Error("Expected ordering fixture");
            edge.after = "missing";
        }
        if (fault === "mixed-transition")
            candidate.records.push({
                record: {
                    kind: "transition",
                    id: "invented-path",
                    from: "ask-readiness",
                    to: "account-lookup",
                    condition: "Always",
                },
                supportPassageIds: ["p1"],
                oppositionPassageIds: [],
            });
        if (fault === "missing-gap")
            candidate.records = candidate.records.filter(
                ({ record }) => record.kind !== "gap",
            );
        if (fault === "missing-opposition")
            candidate.records[3].oppositionPassageIds = [];
        const expected =
            fault === "missing-node"
                ? "missing nodes: closure"
                : fault === "non-node-reference"
                  ? "unknown/non-node references: conflicting-starts"
                  : fault === "duplicate-node"
                    ? "duplicate references: ask-readiness"
                    : undefined;
        expect(() => parseExtraction(candidate, packet)).toThrow(expected);
    },
);

test("partial ordering is prose-only and does not relax the strict structured DAG", async () => {
    const { candidate } = await partialOrderFixture();
    expect(() =>
        parseProcedureSource(
            [
                JSON.stringify({
                    schemaVersion: 1,
                    procedureId: "fictional",
                    title: candidate.title,
                    entryStep: candidate.entryStep,
                }),
                ...candidate.records.map(({ record }) =>
                    JSON.stringify(record),
                ),
            ].join("\n"),
        ),
    ).toThrow("original kinds");
    const noncyclic = candidate.records.filter(
        ({ record }) => record.id !== "account-first",
    );
    expect(orderingConflictIds(noncyclic.map(({ record }) => record))).toEqual(
        [],
    );
});

test("unordered options are typed, evidence-bound and readable without invented inputs or ordering", async () => {
    const { snapshot, provider, candidate, assessment, model } =
        await collectionFixture();
    const content = renderProseProcedure(
        snapshot,
        provider.descriptor.identity,
        candidate,
        assessment,
    );
    expect(content.presentation.templateId).toBe("procedure-guide-v1");
    expect(content.presentation.layouts.map(({ id }) => id)).toEqual([
        "guide",
        "agent",
        "evidence",
    ]);
    expect(
        content.sections.find(({ heading }) => heading === "Check stock")?.body,
    ).toContain("troubleshoot");
    expect(
        content.sections.find(({ heading }) => heading === "Check stock")?.body,
    ).not.toContain("account_id");
    const registry = new ViewExtensionRegistry([provider]);
    await registry.validateContent(snapshot, content);
    expect(model.complete).not.toHaveBeenCalled();
    const altered = structuredClone(content);
    altered.sections.find(({ heading }) => heading === "Check stock")!.body +=
        " All fields are mandatory.";
    expect(() =>
        validateProseContent(snapshot, provider.descriptor.identity, altered),
    ).toThrow("differs");
    const changedLayout = structuredClone(content);
    changedLayout.presentation.layouts[0].groups
        .find(({ id }) => id === "options")!
        .blockIds.pop();
    expect(() =>
        validateProseContent(
            snapshot,
            provider.descriptor.identity,
            changedLayout,
        ),
    ).toThrow("differs");
});

test.each(["duplicate", "missing", "orphan", "mixed"] as const)(
    "action collection rejects %s options rather than degrading to context",
    async (mode) => {
        const { candidate, packet } = await collectionFixture();
        const collection = candidate.records.find(
            ({ record }) => record.kind === "actionCollection",
        )!.record;
        if (collection.kind !== "actionCollection")
            throw new Error("Missing fixture collection");
        if (mode === "duplicate")
            collection.actionIds[1] = collection.actionIds[0];
        if (mode === "missing") collection.actionIds.push("not-present");
        if (mode === "orphan") collection.actionIds.pop();
        if (mode === "mixed")
            candidate.records.push({
                record: {
                    kind: "step",
                    id: "extra-step",
                    text: "Invented sequence",
                    requiredInputs: [],
                    expectedObservation: null,
                },
                supportPassageIds: ["p1"],
                oppositionPassageIds: [],
            });
        expect(() => parseExtraction(candidate, packet)).toThrow();
    },
);

test.each(["LF", "CRLF", "UTF-16"])(
    "prose %s preserves exact complete-source spans",
    async (variant) => {
        const { snapshot } = await fixture();
        const source = snapshot.inputs[0];
        source.content =
            variant === "CRLF"
                ? source.content.replace(/\n/g, "\r\n")
                : variant === "UTF-16"
                  ? source.content.replace("lantern", "lantern \ud83d\udd26")
                  : source.content;
        const packet = prosePacket(snapshot);
        expect(packet.passages).toHaveLength(7);
        for (const passage of packet.passages) {
            const offsets = /^chars:(\d+)-(\d+)$/.exec(passage.locator)!;
            expect(
                source.content.slice(Number(offsets[1]), Number(offsets[2])),
            ).toBe(passage.excerpt);
        }
    },
);

test("rejects omitted, duplicate or unknown passage dispositions and partial semantic coverage", async () => {
    const { candidate, packet, assessment } = await fixture();
    const missing = structuredClone(candidate);
    missing.records = missing.records.filter(
        ({ record }) => record.id !== "scope",
    );
    expect(() => parseExtraction(missing, packet)).toThrow(
        "Every complete retained passage",
    );
    missing.unusedPassages = [{ passageId: "p1", reason: "scope" }];
    expect(parseExtraction(missing, packet).unusedPassages).toHaveLength(1);
    missing.unusedPassages.push({ passageId: "p1", reason: "duplicate" });
    expect(() => parseExtraction(missing, packet)).toThrow(
        "Every complete retained passage",
    );
    candidate.records[0].supportPassageIds = ["absent"];
    expect(() => parseExtraction(candidate, packet)).toThrow("unknown");
    expect(() =>
        parseAssessment({ ...assessment, coveredPassageIds: ["p0"] }, packet),
    ).toThrow("every original passage");
});

test("semantic rejection for invented escalation/order or lost guards triggers exactly one bounded repair", async () => {
    const { provider, snapshot, candidate, assessment } = await fixture();
    const rejected = {
        supported: false,
        issues: [
            {
                recordId: "escalate",
                reason: "Invented escalation, mandatory ordering or omitted guard",
            },
        ],
        coveredPassageIds: [],
    };
    const context = execution([
        JSON.stringify(candidate),
        JSON.stringify(rejected),
        JSON.stringify(candidate),
        JSON.stringify(assessment),
    ]);
    const content = await provider.generate(
        snapshot,
        await provider.prepare(snapshot),
        context,
    );
    expect(context.complete).toHaveBeenCalledTimes(4);
    expect(context.complete).toHaveBeenNthCalledWith(
        1,
        "procedure-extraction-0",
        expect.any(Array),
        expect.objectContaining({ name: "ProcedureExtraction", strict: true }),
    );
    expect(context.complete).toHaveBeenNthCalledWith(
        2,
        "procedure-check-0",
        expect.any(Array),
        expect.objectContaining({ name: "ProcedureAssessment", strict: true }),
    );
    await provider.validateContent!(snapshot, content);
    expect(context.checkpoint).toHaveBeenCalledWith(
        "procedure-rejected-0",
        expect.objectContaining({
            reason: expect.stringContaining("Semantic checker"),
        }),
    );
    expect(context.checkpoint).toHaveBeenCalledWith(
        "procedure-model-accepted",
        expect.objectContaining({ humanReview: "pending" }),
    );
});

test("malformed candidate is repaired, unsupported second candidate is rejected, transport failures are not repaired", async () => {
    const { provider, snapshot, candidate, assessment } = await fixture();
    const repaired = execution([
        "not json",
        JSON.stringify(candidate),
        JSON.stringify(assessment),
    ]);
    await provider.generate(snapshot, null, repaired);
    expect(repaired.complete).toHaveBeenCalledTimes(3);
    const exhausted = execution(["not json", "not json"]);
    await expect(provider.generate(snapshot, null, exhausted)).rejects.toThrow(
        "Bounded procedure repair exhausted",
    );
    expect(exhausted.complete).toHaveBeenCalledTimes(2);
    const failed = execution([new Error("Transport unavailable")]);
    await expect(provider.generate(snapshot, null, failed)).rejects.toThrow(
        "Transport unavailable",
    );
    expect(failed.complete).toHaveBeenCalledTimes(1);
});

test("cold reads reject changed guards, false human-review claims and cross-snapshot receipts", async () => {
    const { provider, snapshot, candidate, assessment } = await fixture();
    const content = renderProseProcedure(
        snapshot,
        provider.descriptor.identity,
        candidate,
        assessment,
    );
    content.sections[0].body += " Unexpected action.";
    expect(() =>
        validateProseContent(snapshot, provider.descriptor.identity, content),
    ).toThrow("differs");
    const valid = renderProseProcedure(
        snapshot,
        provider.descriptor.identity,
        candidate,
        assessment,
    );
    expect(() =>
        validateProseContent(
            { ...snapshot, fingerprint: viewExtensionDigest("other") },
            provider.descriptor.identity,
            valid,
        ),
    ).toThrow("another snapshot");
    const serialized: unknown = JSON.parse(
        JSON.stringify(valid).replace(
            '"humanReview":"pending"',
            '"humanReview":"approved"',
        ),
    );
    expect(() =>
        provider.validateContent!(snapshot, serialized as typeof valid),
    ).toThrow("falsely claims human review");
});

test("ordinary prose can retain explicit unresolved/unknown outcomes without inventing human escalation", async () => {
    const { candidate, packet } = await fixture();
    for (const entry of candidate.records)
        if (entry.record.kind === "outcome") entry.record.result = "unresolved";
    expect(parseExtraction(candidate, packet).records).toHaveLength(
        candidate.records.length,
    );
});

test("oversized or partial retained sources are rejected rather than silently truncated", async () => {
    const { snapshot } = await fixture();
    snapshot.inputs[0].content = "x".repeat(12001);
    expect(() => prosePacket(snapshot)).toThrow("paragraph exceeds");
    snapshot.inputs[0].content = "x".repeat(120001);
    expect(() => prosePacket(snapshot)).toThrow("complete-input bound");
});

test("native structured output pins wrapper fields and record discriminators without relaxing domain validation", () => {
    const output = proseOutputSchema(procedurePayloadSchema);
    if (
        output.type !== "object" ||
        output.properties.extraction.type !== "object"
    )
        throw new Error("Invalid test schema");
    const schema = structuredProseSchema(
        "ProcedureExtraction",
        output.properties.extraction.properties.candidate,
    );
    expect(schema.strict).toBe(true);
    expect(schema.schema).toMatchObject({
        additionalProperties: false,
        properties: {
            records: {
                type: "array",
                items: {
                    additionalProperties: false,
                    required: [
                        "record",
                        "supportPassageIds",
                        "oppositionPassageIds",
                    ],
                    properties: {
                        record: {
                            anyOf: expect.arrayContaining([
                                expect.objectContaining({
                                    properties: expect.objectContaining({
                                        kind: {
                                            type: "string",
                                            enum: ["decisionTable"],
                                        },
                                        rows: {
                                            type: "array",
                                            items: {
                                                type: "array",
                                                items: { type: "string" },
                                            },
                                        },
                                    }),
                                }),
                                expect.objectContaining({
                                    properties: expect.objectContaining({
                                        kind: {
                                            type: "string",
                                            enum: ["workflow"],
                                        },
                                        order: {
                                            type: "string",
                                            enum: ["partial-order"],
                                        },
                                    }),
                                }),
                                expect.objectContaining({
                                    properties: expect.objectContaining({
                                        kind: {
                                            type: "string",
                                            enum: ["step"],
                                        },
                                    }),
                                }),
                                expect.objectContaining({
                                    anyOf: expect.arrayContaining([
                                        expect.objectContaining({
                                            properties: expect.objectContaining(
                                                {
                                                    kind: {
                                                        type: "string",
                                                        enum: ["transition"],
                                                    },
                                                },
                                            ),
                                        }),
                                        expect.objectContaining({
                                            properties: expect.objectContaining(
                                                {
                                                    kind: {
                                                        type: "string",
                                                        enum: [
                                                            "orderingConstraint",
                                                        ],
                                                    },
                                                },
                                            ),
                                        }),
                                    ]),
                                }),
                            ]),
                        },
                    },
                },
            },
        },
    });
});

test("real service saves the model-backed draft with durable managed stages; restart/revocation never infer", async () => {
    const original = await fixture();
    const outputs = [
        JSON.stringify(original.candidate),
        JSON.stringify(original.assessment),
    ];
    let calls = 0;
    let allowed = true;
    let sourceAllowed = true;
    const model: ChatModel = {
        completionSettings: {},
        async complete(prompt) {
            const finish = await reserveSerializedRequestForDispatch({
                method: "POST",
                body: JSON.stringify({ messages: prompt, max_tokens: 16000 }),
            });
            calls++;
            const output = outputs.shift();
            if (!output) throw new Error("Unexpected synthetic model call");
            await finish?.({
                state: "returned",
                at: new Date().toISOString(),
                elapsedMs: 1,
            });
            return { success: true, data: output };
        },
    };
    const root = await mkdtemp(
        path.join(os.tmpdir(), "typeagent-prose-service-"),
    );
    let service = new FileMemoryService(root, hostOptions([]));
    try {
        const corpus = await service.createCorpus("Synthetic prose lifecycle");
        await service.close();
        const provider = await createProseProcedureProvider({
            corpusId: corpus.corpusId,
            sourceIds: ["source"],
            authorize: async () => allowed,
            approvedModelWork: true,
            model,
            modelIdentity: viewExtensionDigest("test-native-model"),
        });
        const options = {
            ...hostOptions([provider]),
            sourceAuthorization: async () => sourceAllowed,
            informationalBudget: {
                inputTokens: 50000,
                outputTokens: 20000,
                safetyTokens: 100,
                chatAttempts: 4,
                embeddingAttempts: 1,
                reservedTokens: 1000000,
                elapsedMs: 60000,
                tokenizer: "test-char-upper-bound",
                countTokens: (serialized: string) => serialized.length,
            },
        };
        service = new FileMemoryService(root, options);
        const ingested = await service.ingestDocument({
            corpusId: corpus.corpusId,
            pipeline: { mode: "content" },
            source: {
                sourceId: "source",
                sourceType: "text",
                title: "Fictional support",
                text: original.snapshot.inputs[0].content,
            },
        });
        await completedIngestion(service, ingested.jobId);
        const source = await service.getSource(corpus.corpusId, "source");
        if (!source?.activeRevisionId)
            throw new Error("Missing synthetic retained revision");
        const definition = procedureDefinition(provider, "mock-connectivity", [
            { sourceId: "source", revisionId: source.activeRevisionId },
        ]);
        const { job, view } = await buildProcedure(
            service,
            corpus.corpusId,
            definition,
        );
        expect(calls).toBe(2);
        expect(job.results[0].providerAttempts).toHaveLength(2);
        expect(job.results[0].providerRequests).toHaveLength(2);
        expect(job.results[0].providerCheckpoints).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ stage: "procedure-model-accepted" }),
            ]),
        );
        await service.close();
        service = new FileMemoryService(root, options);
        const reference = {
            corpusId: corpus.corpusId,
            viewId: view.viewId,
            revisionId: view.revisionId,
        };
        expect((await service.getView(reference))?.content).toEqual(
            view.content,
        );
        expect(
            await service.searchViews({
                corpusId: corpus.corpusId,
                query: "indicator",
                freshness: "current",
            }),
        ).toHaveLength(0);
        allowed = false;
        expect(await service.getView(reference)).toBeUndefined();
        allowed = true;
        sourceAllowed = false;
        expect(await service.getView(reference)).toBeUndefined();
        expect(calls).toBe(2);
    } finally {
        await service.close();
        await rm(root, { recursive: true, force: true });
    }
});
