// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { invariant } from "./errors.js";
import type {
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
    requireRevision,
    requireText,
    type MemoryProvenance,
    type Revision,
} from "./metadata.js";

export type GoalState = "active" | "achieved" | "abandoned";

export type Goal = {
    goalId: GoalId;
    scopeId: ScopeId;
    topicId: TopicId;
    desiredState: string;
    state: GoalState;
    revision: Revision;
    updatedByTurnId: TurnId;
    updatedAt: string;
    provenance: MemoryProvenance;
};

export type DesignNoteState = "draft" | "accepted" | "superseded";

export type DesignNote = {
    designNoteId: DesignNoteId;
    scopeId: ScopeId;
    topicId: TopicId;
    title: string;
    body: string;
    addressedGoalIds: readonly GoalId[];
    state: DesignNoteState;
    revision: Revision;
    updatedByTurnId: TurnId;
    updatedAt: string;
    provenance: MemoryProvenance;
};

export type DesignNoteRevisionReference = {
    designNoteId: DesignNoteId;
    revision: Revision;
};

export type TopicOutputState = "current" | "superseded" | "removed";

export type TopicOutput = {
    outputId: OutputId;
    scopeId: ScopeId;
    topicId: TopicId;
    artifactId: ArtifactId;
    state: TopicOutputState;
    revision: Revision;
    designNotes: readonly DesignNoteRevisionReference[];
    updatedByTurnId: TurnId;
    updatedAt: string;
    provenance: MemoryProvenance;
};

export function createGoal(input: Omit<Goal, "revision">): Goal {
    return Object.freeze({
        ...input,
        desiredState: requireText(input.desiredState, "goal.desiredState"),
        revision: 1,
        updatedAt: requireAbsoluteTimestamp(input.updatedAt, "goal.updatedAt"),
        provenance: createProvenance(input.provenance),
    });
}

export function createDesignNote(
    input: Omit<DesignNote, "revision">,
): DesignNote {
    invariant(
        new Set(input.addressedGoalIds).size === input.addressedGoalIds.length,
        "Design note contains a duplicate goal reference",
        { designNoteId: input.designNoteId },
    );

    return Object.freeze({
        ...input,
        title: requireText(input.title, "designNote.title"),
        body: requireText(input.body, "designNote.body"),
        addressedGoalIds: Object.freeze([...input.addressedGoalIds]),
        revision: 1,
        updatedAt: requireAbsoluteTimestamp(
            input.updatedAt,
            "designNote.updatedAt",
        ),
        provenance: createProvenance(input.provenance),
    });
}

export function createTopicOutput(
    input: Omit<TopicOutput, "revision" | "designNotes">,
    designNotes: readonly DesignNote[],
): TopicOutput {
    for (const designNote of designNotes) {
        invariant(
            designNote.scopeId === input.scopeId &&
                designNote.topicId === input.topicId,
            "Output design note must share its scope and topic",
            {
                outputId: input.outputId,
                designNoteId: designNote.designNoteId,
            },
        );
    }
    invariant(
        new Set(designNotes.map((note) => note.designNoteId)).size ===
            designNotes.length,
        "Output contains a duplicate design-note reference",
        { outputId: input.outputId },
    );

    return Object.freeze({
        ...input,
        revision: 1,
        designNotes: Object.freeze(
            designNotes.map((note) => ({
                designNoteId: note.designNoteId,
                revision: requireRevision(note.revision),
            })),
        ),
        updatedAt: requireAbsoluteTimestamp(
            input.updatedAt,
            "topicOutput.updatedAt",
        ),
        provenance: createProvenance(input.provenance),
    });
}
