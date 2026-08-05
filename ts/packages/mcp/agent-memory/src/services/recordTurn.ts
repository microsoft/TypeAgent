// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import {
    DomainError,
    asId,
    createArtifact,
    createArtifactChange,
    createDesignNote,
    createGoal,
    createProvenance,
    createTerm,
    createTopic,
    createTopicOutput,
    createTopicPropertyDefinition,
    createTopicPropertyValue,
    createTurn,
    createTurnAggregate,
    normalizeTopicPath,
    requireText,
    scopesEqual,
    type AccessScope,
    type ActionStatus,
    type Artifact,
    type ArtifactChangeKind,
    type Clock,
    type DesignNote,
    type DesignNoteState,
    type GoalState,
    type IdGenerator,
    type MemoryProvenance,
    type TermRole,
    type Topic,
    type TopicOutputState,
    type TopicPropertyData,
    type TopicPropertyType,
    type TurnTopic,
} from "../domain/index.js";
import { SystemClock, UuidV7IdGenerator } from "../domain/index.js";
import type { MemoryRepository } from "../repository/index.js";

export type RecordTurnActionInput = {
    actionId?: string;
    sequence: number;
    name: string;
    summary: string;
    status: ActionStatus;
    toolName?: string;
    affectedGoalIds?: readonly string[];
    affectedArtifactIds?: readonly string[];
    affectedOutputIds?: readonly string[];
    designNoteIds?: readonly string[];
};

export type RecordTurnArtifactInput = {
    artifactId: string;
    change: ArtifactChangeKind;
    summary: string;
    kind?: string;
    name?: string;
    uri?: string;
};

export type RecordTurnGoalInput = {
    goalId?: string;
    topicPath?: string;
    desiredState: string;
    state?: GoalState;
    revision?: number;
};

export type RecordTurnDesignNoteInput = {
    designNoteId?: string;
    topicPath?: string;
    title: string;
    body: string;
    addressedGoalIds?: readonly string[];
    state?: DesignNoteState;
    revision?: number;
};

export type RecordTurnOutputInput = {
    outputId?: string;
    topicPath?: string;
    artifactId: string;
    state?: TopicOutputState;
    designNotes?: ReadonlyArray<{
        designNoteId: string;
        revision?: number;
    }>;
    revision?: number;
};

export type RecordTurnPropertyInput = {
    definitionId?: string;
    topicPath?: string;
    name?: string;
    valueType?: TopicPropertyType;
    required?: boolean;
    allowedValues?: readonly string[];
    value: TopicPropertyData;
};

export type RecordTurnRequest = {
    turnId: string;
    idempotencyKey: string;
    scope: AccessScope;
    conversationId: string;
    sequence: number;
    primaryTopicPath: string;
    secondaryTopicPaths?: readonly string[];
    requestSummary: string;
    outcomeSummary: string;
    occurredAt: string;
    provenance: MemoryProvenance;
    terms?: ReadonlyArray<{ text: string; role?: TermRole }>;
    actions?: readonly RecordTurnActionInput[];
    artifactChanges?: readonly RecordTurnArtifactInput[];
    goals?: readonly RecordTurnGoalInput[];
    designNotes?: readonly RecordTurnDesignNoteInput[];
    outputs?: readonly RecordTurnOutputInput[];
    properties?: readonly RecordTurnPropertyInput[];
};

export type RecordTurnResult = {
    turnId: string;
    primaryTopicId: string;
    secondaryTopicIds: string[];
    termIds: string[];
    actionIds: string[];
    artifactIds: string[];
    goalIds: string[];
    designNoteIds: string[];
    outputIds: string[];
    propertyDefinitionIds: string[];
    warnings: string[];
};

const limits = {
    topicPaths: 32,
    terms: 128,
    actions: 128,
    artifactChanges: 128,
    facets: 128,
    summaryLength: 16_384,
    idempotencyKeyLength: 256,
} as const;

export class RecordTurnService {
    public constructor(
        private readonly repository: MemoryRepository,
        private readonly clock: Clock = new SystemClock(),
        private readonly ids: IdGenerator = new UuidV7IdGenerator(clock),
    ) {}

    public record(request: RecordTurnRequest): RecordTurnResult {
        validateRequest(request);
        const requestHash = hashRequest(request);

        return this.repository.runInTransaction(() => {
            const existing = this.repository.getIdempotencyRecord(
                request.scope.scopeId,
                request.idempotencyKey,
            );
            if (existing !== undefined) {
                if (existing.requestHash !== requestHash) {
                    throw new DomainError(
                        "IDEMPOTENCY_CONFLICT",
                        "Idempotency key was already used with different input",
                        { idempotencyKey: request.idempotencyKey },
                    );
                }
                return JSON.parse(existing.resultJson) as RecordTurnResult;
            }

            this.validateScope(request.scope);
            const createdAt = this.clock.now().toISOString();
            const primaryTopic = this.resolveTopic(
                request.scope,
                request.primaryTopicPath,
                createdAt,
            );
            const secondaryTopics = this.resolveSecondaryTopics(
                request,
                primaryTopic,
                createdAt,
            );
            const terms = (request.terms ?? []).map((term) => {
                const resolved =
                    this.repository.findTerm(
                        request.scope.scopeId,
                        term.text,
                    ) ??
                    createTerm(
                        this.ids.generate("Term"),
                        request.scope.scopeId,
                        term.text,
                        createdAt,
                    );
                if (
                    this.repository.findTerm(
                        request.scope.scopeId,
                        term.text,
                    ) === undefined
                ) {
                    this.repository.saveTerm(resolved);
                }
                return { term: resolved, role: term.role };
            });
            const uniqueTerms = [
                ...new Map(
                    terms.map((entry) => [entry.term.termId, entry]),
                ).values(),
            ];

            const turnId = asId(request.turnId, "Turn");
            const turn = createTurn({
                turnId,
                scopeId: request.scope.scopeId,
                conversationId: request.conversationId,
                sequence: request.sequence,
                requestSummary: request.requestSummary,
                outcomeSummary: request.outcomeSummary,
                occurredAt: request.occurredAt,
                recordedAt: createdAt,
                provenance: request.provenance,
            });
            const topicLinks: TurnTopic[] = [
                {
                    turnId,
                    topicId: primaryTopic.topicId,
                    role: "primary",
                },
                ...secondaryTopics.map((topic) => ({
                    turnId,
                    topicId: topic.topicId,
                    role: "secondary" as const,
                })),
            ];
            const actions = (request.actions ?? []).map((action) => ({
                actionId:
                    action.actionId === undefined
                        ? this.ids.generate("Action")
                        : asId(action.actionId, "Action"),
                turnId,
                sequence: action.sequence,
                name: action.name,
                summary: action.summary,
                status: action.status,
                ...(action.toolName === undefined
                    ? {}
                    : { toolName: action.toolName }),
                affectedGoalIds: (action.affectedGoalIds ?? []).map((id) =>
                    asId(id, "Goal"),
                ),
                affectedArtifactIds: (action.affectedArtifactIds ?? []).map(
                    (id) => asId(id, "Artifact"),
                ),
                affectedOutputIds: (action.affectedOutputIds ?? []).map((id) =>
                    asId(id, "Output"),
                ),
                designNoteIds: (action.designNoteIds ?? []).map((id) =>
                    asId(id, "DesignNote"),
                ),
            }));
            this.repository.saveTurnAggregate(
                createTurnAggregate(
                    turn,
                    topicLinks,
                    uniqueTerms.map(({ term, role }) => ({
                        turnId,
                        termId: term.termId,
                        ...(role === undefined ? {} : { role }),
                    })),
                    actions,
                ),
            );

            const artifactIds = this.saveArtifacts(request, turnId, createdAt);
            const goalIds = this.saveGoals(request, turnId, createdAt);
            const designNoteIds = this.saveDesignNotes(
                request,
                turnId,
                createdAt,
            );
            const warnings: string[] = [];
            const outputIds = this.saveOutputs(
                request,
                turnId,
                createdAt,
                warnings,
            );
            const propertyDefinitionIds = this.saveProperties(
                request,
                turnId,
                createdAt,
            );
            this.repository.rebuildSearchDocuments();

            const result: RecordTurnResult = {
                turnId,
                primaryTopicId: primaryTopic.topicId,
                secondaryTopicIds: secondaryTopics.map(
                    (topic) => topic.topicId,
                ),
                termIds: uniqueTerms.map(({ term }) => term.termId),
                actionIds: actions.map((action) => action.actionId),
                artifactIds,
                goalIds,
                designNoteIds,
                outputIds,
                propertyDefinitionIds,
                warnings,
            };
            this.repository.saveIdempotencyRecord({
                scopeId: request.scope.scopeId,
                key: request.idempotencyKey,
                requestHash,
                resultJson: JSON.stringify(result),
                createdAt,
            });
            return result;
        });
    }

    private validateScope(scope: AccessScope): void {
        const stored = this.repository.getScope(scope.scopeId);
        if (stored === undefined) {
            throw new DomainError("NOT_FOUND", "Scope was not found", {
                scopeId: scope.scopeId,
            });
        }
        if (!scopesEqual(stored, scope)) {
            throw new DomainError(
                "SCOPE_MISMATCH",
                "Resolved scope does not match the stored scope",
                { scopeId: scope.scopeId },
            );
        }
    }

    private resolveTopic(
        scope: AccessScope,
        path: string,
        createdAt: string,
    ): Topic {
        const resolved = this.repository.findTopicByPath(scope.scopeId, path);
        if (resolved !== undefined) {
            return resolved;
        }

        const normalizedSegments = normalizeTopicPath(path).slice(1).split("/");
        const displaySegments = path
            .split("/")
            .filter((segment) => segment.length > 0)
            .map((segment) => segment.trim());
        let parent: Topic | undefined;
        for (let index = 0; index < normalizedSegments.length; index++) {
            const partialPath = `/${normalizedSegments.slice(0, index + 1).join("/")}`;
            const existing = this.repository.findTopicByPath(
                scope.scopeId,
                partialPath,
            );
            if (existing !== undefined) {
                parent = existing;
                continue;
            }
            const topic = createTopic({
                topicId: this.ids.generate("Topic"),
                scopeId: scope.scopeId,
                displayName:
                    displaySegments[index] ?? normalizedSegments[index]!,
                slug: normalizedSegments[index]!,
                createdAt,
                ...(parent === undefined ? {} : { parent }),
            });
            this.repository.saveTopic(topic);
            parent = topic;
        }
        return parent!;
    }

    private resolveSecondaryTopics(
        request: RecordTurnRequest,
        primaryTopic: Topic,
        createdAt: string,
    ): Topic[] {
        const seen = new Set<string>([primaryTopic.topicId]);
        const topics: Topic[] = [];
        for (const path of request.secondaryTopicPaths ?? []) {
            const topic = this.resolveTopic(request.scope, path, createdAt);
            if (!seen.has(topic.topicId)) {
                seen.add(topic.topicId);
                topics.push(topic);
            }
        }
        return topics;
    }

    private saveArtifacts(
        request: RecordTurnRequest,
        turnId: ReturnType<typeof asId<"Turn">>,
        createdAt: string,
    ): string[] {
        return (request.artifactChanges ?? []).map((input) => {
            const artifactId = asId(input.artifactId, "Artifact");
            const existing = this.repository.getArtifact(artifactId);
            let artifact: Artifact;
            if (input.change === "created") {
                if (existing !== undefined) {
                    throw new DomainError(
                        "INVARIANT_VIOLATION",
                        "Created artifact already exists",
                        { artifactId },
                    );
                }
                artifact = createArtifact({
                    artifactId,
                    scopeId: request.scope.scopeId,
                    kind: requireText(input.kind ?? "", "artifact.kind"),
                    name: requireText(input.name ?? "", "artifact.name"),
                    ...(input.uri === undefined ? {} : { uri: input.uri }),
                    createdAt,
                });
            } else {
                if (existing === undefined) {
                    throw new DomainError(
                        "NOT_FOUND",
                        "Artifact was not found",
                        {
                            artifactId,
                        },
                    );
                }
                if (existing.scopeId !== request.scope.scopeId) {
                    throw new DomainError(
                        "SCOPE_MISMATCH",
                        "Artifact belongs to a different scope",
                        { artifactId },
                    );
                }
                artifact = {
                    ...existing,
                    kind: input.kind ?? existing.kind,
                    name: input.name ?? existing.name,
                    ...(input.uri === undefined ? {} : { uri: input.uri }),
                    state:
                        input.change === "deleted" ? "deleted" : existing.state,
                    revision: existing.revision + 1,
                };
            }
            this.repository.saveArtifact(artifact);
            this.repository.saveArtifactChange(
                createArtifactChange(artifact, {
                    turnId,
                    kind: input.change,
                    summary: input.summary,
                    occurredAt: request.occurredAt,
                    provenance: request.provenance,
                }),
            );
            return artifact.artifactId;
        });
    }

    private saveGoals(
        request: RecordTurnRequest,
        turnId: ReturnType<typeof asId<"Turn">>,
        updatedAt: string,
    ): string[] {
        return (request.goals ?? []).map((input) => {
            const goalId =
                input.goalId === undefined
                    ? this.ids.generate("Goal")
                    : asId(input.goalId, "Goal");
            const existing = this.repository.getGoal(goalId);
            const topic = this.resolveTopic(
                request.scope,
                input.topicPath ?? request.primaryTopicPath,
                updatedAt,
            );
            const base = createGoal({
                goalId,
                scopeId: request.scope.scopeId,
                topicId: topic.topicId,
                desiredState: input.desiredState,
                state: input.state ?? existing?.state ?? "active",
                updatedByTurnId: turnId,
                updatedAt,
                provenance: request.provenance,
            });
            this.repository.saveGoal({
                ...base,
                revision: input.revision ?? (existing?.revision ?? 0) + 1,
            });
            return goalId;
        });
    }

    private saveDesignNotes(
        request: RecordTurnRequest,
        turnId: ReturnType<typeof asId<"Turn">>,
        updatedAt: string,
    ): string[] {
        return (request.designNotes ?? []).map((input) => {
            const designNoteId =
                input.designNoteId === undefined
                    ? this.ids.generate("DesignNote")
                    : asId(input.designNoteId, "DesignNote");
            const existing = this.repository.getDesignNote(designNoteId);
            const topic = this.resolveTopic(
                request.scope,
                input.topicPath ?? request.primaryTopicPath,
                updatedAt,
            );
            const base = createDesignNote({
                designNoteId,
                scopeId: request.scope.scopeId,
                topicId: topic.topicId,
                title: input.title,
                body: input.body,
                addressedGoalIds: (input.addressedGoalIds ?? []).map((id) =>
                    asId(id, "Goal"),
                ),
                state: input.state ?? existing?.state ?? "draft",
                updatedByTurnId: turnId,
                updatedAt,
                provenance: request.provenance,
            });
            this.repository.saveDesignNote({
                ...base,
                revision: input.revision ?? (existing?.revision ?? 0) + 1,
            });
            return designNoteId;
        });
    }

    private saveOutputs(
        request: RecordTurnRequest,
        turnId: ReturnType<typeof asId<"Turn">>,
        updatedAt: string,
        warnings: string[],
    ): string[] {
        return (request.outputs ?? []).map((input) => {
            const outputId =
                input.outputId === undefined
                    ? this.ids.generate("Output")
                    : asId(input.outputId, "Output");
            const existing = this.repository.getTopicOutput(outputId);
            const topic = this.resolveTopic(
                request.scope,
                input.topicPath ?? request.primaryTopicPath,
                updatedAt,
            );
            const notes: DesignNote[] = [];
            for (const reference of input.designNotes ?? []) {
                const note = this.repository.getDesignNote(
                    reference.designNoteId,
                );
                if (
                    note === undefined ||
                    (reference.revision !== undefined &&
                        note.revision !== reference.revision)
                ) {
                    warnings.push(
                        `Design note ${reference.designNoteId} revision ${
                            reference.revision ?? "current"
                        } was not found`,
                    );
                    continue;
                }
                notes.push(note);
            }
            const base = createTopicOutput(
                {
                    outputId,
                    scopeId: request.scope.scopeId,
                    topicId: topic.topicId,
                    artifactId: asId(input.artifactId, "Artifact"),
                    state: input.state ?? existing?.state ?? "current",
                    updatedByTurnId: turnId,
                    updatedAt,
                    provenance: request.provenance,
                },
                notes,
            );
            this.repository.saveTopicOutput({
                ...base,
                revision: input.revision ?? (existing?.revision ?? 0) + 1,
            });
            return outputId;
        });
    }

    private saveProperties(
        request: RecordTurnRequest,
        turnId: ReturnType<typeof asId<"Turn">>,
        updatedAt: string,
    ): string[] {
        return (request.properties ?? []).map((input) => {
            const definitionId =
                input.definitionId === undefined
                    ? this.ids.generate("PropertyDefinition")
                    : asId(input.definitionId, "PropertyDefinition");
            let definition =
                this.repository.getPropertyDefinition(definitionId);
            if (definition === undefined) {
                const topic = this.resolveTopic(
                    request.scope,
                    input.topicPath ?? request.primaryTopicPath,
                    updatedAt,
                );
                definition = createTopicPropertyDefinition({
                    definitionId,
                    scopeId: request.scope.scopeId,
                    topicId: topic.topicId,
                    name: requireText(input.name ?? "", "property.name"),
                    valueType:
                        input.valueType ?? inferPropertyType(input.value),
                    required: input.required ?? false,
                    ...(input.allowedValues === undefined
                        ? {}
                        : { allowedValues: input.allowedValues }),
                });
                this.repository.savePropertyDefinition(definition);
            }
            this.repository.savePropertyValue(
                createTopicPropertyValue(definition, {
                    value: input.value,
                    updatedByTurnId: turnId,
                    updatedAt,
                }),
            );
            return definitionId;
        });
    }
}

function validateRequest(request: RecordTurnRequest): void {
    requireText(request.idempotencyKey, "idempotencyKey");
    if (request.idempotencyKey.length > limits.idempotencyKeyLength) {
        throw new DomainError(
            "INVALID_ARGUMENT",
            "Idempotency key is too long",
        );
    }
    asId(request.turnId, "Turn");
    createProvenance(request.provenance);
    requireText(request.requestSummary, "requestSummary");
    requireText(request.outcomeSummary, "outcomeSummary");
    if (
        request.requestSummary.length > limits.summaryLength ||
        request.outcomeSummary.length > limits.summaryLength
    ) {
        throw new DomainError("INVALID_ARGUMENT", "Turn summary is too long");
    }
    requireCount(
        1 + (request.secondaryTopicPaths?.length ?? 0),
        limits.topicPaths,
        "topic paths",
    );
    requireCount(request.terms?.length ?? 0, limits.terms, "terms");
    requireCount(request.actions?.length ?? 0, limits.actions, "actions");
    requireCount(
        request.artifactChanges?.length ?? 0,
        limits.artifactChanges,
        "artifact changes",
    );
    for (const [name, count] of [
        ["goals", request.goals?.length ?? 0],
        ["design notes", request.designNotes?.length ?? 0],
        ["outputs", request.outputs?.length ?? 0],
        ["properties", request.properties?.length ?? 0],
    ] as const) {
        requireCount(count, limits.facets, name);
    }
}

function requireCount(value: number, maximum: number, name: string): void {
    if (value > maximum) {
        throw new DomainError("INVALID_ARGUMENT", `Too many ${name}`, {
            maximum,
            value,
        });
    }
}

function hashRequest(request: RecordTurnRequest): string {
    return createHash("sha256").update(canonicalJson(request)).digest("hex");
}

function canonicalJson(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map(canonicalJson).join(",")}]`;
    }
    if (value !== null && typeof value === "object") {
        const entries = Object.entries(value as Record<string, unknown>)
            .filter(([, entry]) => entry !== undefined)
            .sort(([left], [right]) => left.localeCompare(right));
        return `{${entries
            .map(
                ([key, entry]) =>
                    `${JSON.stringify(key)}:${canonicalJson(entry)}`,
            )
            .join(",")}}`;
    }
    return JSON.stringify(value);
}

function inferPropertyType(value: TopicPropertyData): TopicPropertyType {
    if (Array.isArray(value)) {
        return "string-list";
    }
    switch (typeof value) {
        case "boolean":
            return "boolean";
        case "number":
            return "number";
        default:
            return "string";
    }
}
