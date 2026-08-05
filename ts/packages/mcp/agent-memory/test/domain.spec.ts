// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    DomainError,
    FixedClock,
    SequenceIdGenerator,
    UuidV7IdGenerator,
    createAccessScope,
    createArtifact,
    createArtifactChange,
    createDerivationMetadata,
    createDesignNote,
    createTerm,
    createTopic,
    createTopicAlias,
    createTopicOutput,
    createTopicPropertyDefinition,
    createTopicPropertyValue,
    createTurn,
    createTurnAggregate,
    normalizeTerm,
    normalizeTopicPath,
    transitionTopic,
    type MemoryProvenance,
} from "../src/domain/index.js";

const ids = new SequenceIdGenerator(Date.UTC(2026, 0, 2));
const scopeId = ids.generate("Scope");
const turnId = ids.generate("Turn");
const topicId = ids.generate("Topic");
const now = "2026-01-02T03:04:05.000Z";
const provenance: MemoryProvenance = {
    sourceType: "agent",
    actorId: "test-agent",
    observedAt: now,
};

describe("domain runtime ports", () => {
    test("provides deterministic clocks and UUIDv7-compatible IDs", () => {
        const clock = new FixedClock(new Date(now));
        const generator = new UuidV7IdGenerator(clock);

        expect(clock.now().toISOString()).toBe(now);
        expect(generator.generate("Topic")).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        );
        expect(new SequenceIdGenerator().generate("Turn")).toBe(
            "00000000-0000-7000-8000-000000000000",
        );
    });
});

describe("scope, topic, and term contracts", () => {
    test("normalizes scope parts, topic paths, and terms", () => {
        expect(
            createAccessScope(scopeId, {
                userId: " user ",
                workspaceId: " workspace ",
            }),
        ).toMatchObject({ userId: "user", workspaceId: "workspace" });
        expect(normalizeTopicPath("//Agent Memory/Query_IR/")).toBe(
            "/agent-memory/query-ir",
        );
        expect(normalizeTerm("  Typed   Query  ")).toBe("typed query");
    });

    test("requires topic parents to share scope", () => {
        const parent = createTopic({
            topicId,
            scopeId,
            displayName: "Parent",
            createdAt: now,
        });

        expect(() =>
            createTopic({
                topicId: ids.generate("Topic"),
                scopeId: ids.generate("Scope"),
                displayName: "Child",
                createdAt: now,
                parent,
            }),
        ).toThrowDomainError("INVARIANT_VIOLATION");
    });

    test("normalizes aliases and enforces topic state transitions", () => {
        const topic = createTopic({
            topicId,
            scopeId,
            displayName: "Query IR",
            createdAt: now,
        });
        expect(createTopicAlias(topic, "/Query Language", now).path).toBe(
            "/query-language",
        );

        const established = transitionTopic(topic, "established", 1);
        expect(established).toMatchObject({
            state: "established",
            revision: 2,
        });
        expect(() =>
            transitionTopic(established, "provisional", 2),
        ).toThrowDomainError("INVALID_STATE_TRANSITION");
        expect(() =>
            transitionTopic(established, "archived", 1),
        ).toThrowDomainError("REVISION_CONFLICT");
    });

    test("creates canonical terms", () => {
        expect(
            createTerm(ids.generate("Term"), scopeId, " Typed Query ", now),
        ).toMatchObject({
            canonicalText: "typed query",
            displayText: "Typed Query",
        });
    });
});

describe("turn aggregate invariants", () => {
    const turn = createTurn({
        turnId,
        scopeId,
        conversationId: "conversation-1",
        sequence: 0,
        requestSummary: "Create a memory domain",
        outcomeSummary: "Created domain contracts",
        occurredAt: now,
        recordedAt: now,
        provenance,
    });

    test("requires exactly one primary topic", () => {
        expect(() => createTurnAggregate(turn, [], [], [])).toThrowDomainError(
            "INVARIANT_VIOLATION",
        );
    });

    test("rejects duplicate topics, terms, and action sequences", () => {
        const primary = { turnId, topicId, role: "primary" as const };
        const secondary = { turnId, topicId, role: "secondary" as const };
        expect(() =>
            createTurnAggregate(turn, [primary, secondary], [], []),
        ).toThrowDomainError("INVARIANT_VIOLATION");

        const termId = ids.generate("Term");
        expect(() =>
            createTurnAggregate(
                turn,
                [primary],
                [
                    { turnId, termId },
                    { turnId, termId },
                ],
                [],
            ),
        ).toThrowDomainError("INVARIANT_VIOLATION");

        const actionBase = {
            turnId,
            sequence: 0,
            name: "write",
            summary: "Wrote contracts",
            status: "completed" as const,
            affectedGoalIds: [],
            affectedArtifactIds: [],
            affectedOutputIds: [],
            designNoteIds: [],
        };
        expect(() =>
            createTurnAggregate(
                turn,
                [primary],
                [],
                [
                    { ...actionBase, actionId: ids.generate("Action") },
                    { ...actionBase, actionId: ids.generate("Action") },
                ],
            ),
        ).toThrowDomainError("INVARIANT_VIOLATION");
    });
});

describe("artifact and facet contracts", () => {
    test("binds artifact changes to an existing artifact revision", () => {
        const artifact = createArtifact({
            artifactId: ids.generate("Artifact"),
            scopeId,
            kind: "file",
            name: "domain.ts",
            createdAt: now,
        });
        const change = createArtifactChange(artifact, {
            turnId,
            kind: "created",
            summary: "Created the domain file",
            occurredAt: now,
            provenance,
        });

        expect(change).toMatchObject({
            artifactId: artifact.artifactId,
            artifactRevision: 1,
        });
    });

    test("captures exact design-note revisions on outputs", () => {
        const designNote = createDesignNote({
            designNoteId: ids.generate("DesignNote"),
            scopeId,
            topicId,
            title: "Domain boundaries",
            body: "Keep the domain dependency free.",
            addressedGoalIds: [],
            state: "accepted",
            updatedByTurnId: turnId,
            updatedAt: now,
            provenance,
        });
        const output = createTopicOutput(
            {
                outputId: ids.generate("Output"),
                scopeId,
                topicId,
                artifactId: ids.generate("Artifact"),
                state: "current",
                updatedByTurnId: turnId,
                updatedAt: now,
                provenance,
            },
            [designNote],
        );

        expect(output.designNotes).toEqual([
            { designNoteId: designNote.designNoteId, revision: 1 },
        ]);
    });
});

describe("typed properties and metadata", () => {
    test("accepts matching values and rejects mismatches", () => {
        const definition = createTopicPropertyDefinition({
            definitionId: ids.generate("PropertyDefinition"),
            scopeId,
            topicId,
            name: "priority",
            valueType: "string",
            required: false,
            allowedValues: ["high", "low"],
        });
        expect(
            createTopicPropertyValue(definition, {
                value: "high",
                updatedByTurnId: turnId,
                updatedAt: now,
            }).value,
        ).toBe("high");
        expect(() =>
            createTopicPropertyValue(definition, {
                value: "medium",
                updatedByTurnId: turnId,
                updatedAt: now,
            }),
        ).toThrowDomainError("INVALID_ARGUMENT");
    });

    test("rejects relative timestamps and invalid derivations", () => {
        const definition = createTopicPropertyDefinition({
            definitionId: ids.generate("PropertyDefinition"),
            scopeId,
            topicId,
            name: "reviewed-at",
            valueType: "timestamp",
            required: false,
        });
        expect(() =>
            createTopicPropertyValue(definition, {
                value: "yesterday",
                updatedByTurnId: turnId,
                updatedAt: now,
            }),
        ).toThrowDomainError("INVALID_ARGUMENT");
        expect(() =>
            createTopicPropertyValue(definition, {
                value: "2026-01-02 03:04:05Z",
                updatedByTurnId: turnId,
                updatedAt: now,
            }),
        ).toThrowDomainError("INVALID_ARGUMENT");
        expect(() =>
            createDerivationMetadata({
                operation: "summarize",
                sourceIds: ["source-1"],
                sourceRevisions: [],
                generatedAt: now,
            }),
        ).toThrowDomainError("INVALID_ARGUMENT");
    });
});

declare global {
    namespace jest {
        interface Matchers<R> {
            toThrowDomainError(code: DomainError["code"]): R;
        }
    }
}

expect.extend({
    toThrowDomainError(received: () => unknown, code: DomainError["code"]) {
        try {
            received();
        } catch (error) {
            const pass = error instanceof DomainError && error.code === code;
            return {
                pass,
                message: () =>
                    pass
                        ? `Expected function not to throw domain error ${code}`
                        : `Expected domain error ${code}, received ${String(error)}`,
            };
        }
        return {
            pass: false,
            message: () => `Expected function to throw domain error ${code}`,
        };
    },
});
