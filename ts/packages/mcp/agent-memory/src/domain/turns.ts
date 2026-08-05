// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { invariant } from "./errors.js";
import type {
    ActionId,
    ArtifactId,
    DesignNoteId,
    GoalId,
    OutputId,
    ScopeId,
    TopicId,
    TurnId,
} from "./ids.js";
import {
    createProvenance,
    requireAbsoluteTimestamp,
    requireSequence,
    requireText,
    type MemoryProvenance,
} from "./metadata.js";
import type { TurnTerm } from "./terms.js";

export type TurnRecord = {
    turnId: TurnId;
    scopeId: ScopeId;
    conversationId: string;
    sequence: number;
    requestSummary: string;
    outcomeSummary: string;
    occurredAt: string;
    recordedAt: string;
    provenance: MemoryProvenance;
};

export type TurnTopicRole = "primary" | "secondary";

export type TurnTopic = {
    turnId: TurnId;
    topicId: TopicId;
    role: TurnTopicRole;
};

export type ActionStatus = "completed" | "failed" | "skipped";

export type ActionEvent = {
    actionId: ActionId;
    turnId: TurnId;
    sequence: number;
    name: string;
    summary: string;
    status: ActionStatus;
    toolName?: string;
    affectedGoalIds: readonly GoalId[];
    affectedArtifactIds: readonly ArtifactId[];
    affectedOutputIds: readonly OutputId[];
    designNoteIds: readonly DesignNoteId[];
};

export type TurnAggregate = {
    turn: TurnRecord;
    topics: readonly TurnTopic[];
    terms: readonly TurnTerm[];
    actions: readonly ActionEvent[];
};

export type CreateTurnInput = Omit<
    TurnRecord,
    "conversationId" | "requestSummary" | "outcomeSummary" | "provenance"
> & {
    conversationId: string;
    requestSummary: string;
    outcomeSummary: string;
    provenance: MemoryProvenance;
};

export function createTurn(input: CreateTurnInput): TurnRecord {
    return Object.freeze({
        ...input,
        conversationId: requireText(input.conversationId, "conversationId"),
        sequence: requireSequence(input.sequence, "sequence"),
        requestSummary: requireText(input.requestSummary, "requestSummary"),
        outcomeSummary: requireText(input.outcomeSummary, "outcomeSummary"),
        occurredAt: requireAbsoluteTimestamp(input.occurredAt, "occurredAt"),
        recordedAt: requireAbsoluteTimestamp(input.recordedAt, "recordedAt"),
        provenance: createProvenance(input.provenance),
    });
}

export function createActionEvent(action: ActionEvent): ActionEvent {
    return Object.freeze({
        ...action,
        sequence: requireSequence(action.sequence, "action.sequence"),
        name: requireText(action.name, "action.name"),
        summary: requireText(action.summary, "action.summary"),
        ...(action.toolName === undefined
            ? {}
            : { toolName: requireText(action.toolName, "action.toolName") }),
        affectedGoalIds: Object.freeze([...action.affectedGoalIds]),
        affectedArtifactIds: Object.freeze([...action.affectedArtifactIds]),
        affectedOutputIds: Object.freeze([...action.affectedOutputIds]),
        designNoteIds: Object.freeze([...action.designNoteIds]),
    });
}

export function createTurnAggregate(
    turn: TurnRecord,
    topics: TurnTopic[],
    terms: TurnTerm[],
    actions: ActionEvent[],
): TurnAggregate {
    validateTurnReferences(turn, topics, terms, actions);

    return Object.freeze({
        turn,
        topics: Object.freeze([...topics]),
        terms: Object.freeze([...terms]),
        actions: Object.freeze(actions.map(createActionEvent)),
    });
}

function validateTurnReferences(
    turn: TurnRecord,
    topics: TurnTopic[],
    terms: TurnTerm[],
    actions: ActionEvent[],
): void {
    const primaryTopics = topics.filter((topic) => topic.role === "primary");
    invariant(primaryTopics.length === 1, "Turn must have one primary topic", {
        turnId: turn.turnId,
        primaryTopicCount: primaryTopics.length,
    });
    requireUnique(
        topics.map((topic) => topic.topicId),
        "Turn contains a duplicate topic link",
    );
    requireUnique(
        terms.map((term) => term.termId),
        "Turn contains a duplicate term link",
    );
    requireUnique(
        actions.map((action) => action.sequence),
        "Turn contains a duplicate action sequence",
    );

    for (const reference of [...topics, ...terms, ...actions]) {
        invariant(
            reference.turnId === turn.turnId,
            "Turn reference ID mismatch",
            {
                turnId: turn.turnId,
                referencedTurnId: reference.turnId,
            },
        );
    }
}

function requireUnique<T>(values: T[], message: string): void {
    invariant(new Set(values).size === values.length, message);
}
