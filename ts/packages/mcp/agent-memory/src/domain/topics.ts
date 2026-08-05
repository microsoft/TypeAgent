// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DomainError, invalidArgument, invariant } from "./errors.js";
import type { ScopeId, TopicId } from "./ids.js";
import {
    requireAbsoluteTimestamp,
    requireRevision,
    requireText,
    type Revision,
} from "./metadata.js";

export type TopicState = "provisional" | "established" | "merged" | "archived";

export type Topic = {
    topicId: TopicId;
    scopeId: ScopeId;
    slug: string;
    displayName: string;
    state: TopicState;
    revision: Revision;
    createdAt: string;
    parentTopicId?: TopicId;
    mergedIntoTopicId?: TopicId;
};

export type TopicAlias = {
    topicId: TopicId;
    scopeId: ScopeId;
    path: string;
    createdAt: string;
};

export type CreateTopicInput = {
    topicId: TopicId;
    scopeId: ScopeId;
    displayName: string;
    createdAt: string;
    parent?: Topic;
    slug?: string;
};

export function createTopic(input: CreateTopicInput): Topic {
    const displayName = requireText(input.displayName, "displayName");
    const slug = normalizeTopicSlug(input.slug ?? displayName);
    requireAbsoluteTimestamp(input.createdAt, "createdAt");

    if (input.parent !== undefined) {
        invariant(
            input.parent.scopeId === input.scopeId,
            "Topic parent must have the same scope",
            {
                parentTopicId: input.parent.topicId,
                topicId: input.topicId,
            },
        );
        invariant(
            input.parent.state !== "merged" &&
                input.parent.state !== "archived",
            "Topic parent must be active",
            { parentTopicId: input.parent.topicId },
        );
    }

    return Object.freeze({
        topicId: input.topicId,
        scopeId: input.scopeId,
        slug,
        displayName,
        state: "provisional",
        revision: 1,
        createdAt: input.createdAt,
        ...(input.parent === undefined
            ? {}
            : { parentTopicId: input.parent.topicId }),
    });
}

export function createTopicAlias(
    topic: Topic,
    path: string,
    createdAt: string,
): TopicAlias {
    invariant(
        topic.state !== "merged" && topic.state !== "archived",
        "Aliases may only target active topics",
        { topicId: topic.topicId },
    );
    requireAbsoluteTimestamp(createdAt, "createdAt");

    return Object.freeze({
        topicId: topic.topicId,
        scopeId: topic.scopeId,
        path: normalizeTopicPath(path),
        createdAt,
    });
}

export function transitionTopic(
    topic: Topic,
    nextState: TopicState,
    expectedRevision: number,
    mergedIntoTopicId?: TopicId,
): Topic {
    requireRevision(expectedRevision);
    if (topic.revision !== expectedRevision) {
        throw new DomainError("REVISION_CONFLICT", "Topic revision changed", {
            topicId: topic.topicId,
            expectedRevision,
            actualRevision: topic.revision,
        });
    }

    const allowed = allowedTopicTransitions[topic.state];
    if (!allowed.includes(nextState)) {
        throw new DomainError(
            "INVALID_STATE_TRANSITION",
            `Cannot transition topic from ${topic.state} to ${nextState}`,
            { topicId: topic.topicId, from: topic.state, to: nextState },
        );
    }

    if (nextState === "merged") {
        invariant(
            mergedIntoTopicId !== undefined &&
                mergedIntoTopicId !== topic.topicId,
            "A merged topic must identify a different target topic",
            { topicId: topic.topicId },
        );
    } else {
        invariant(
            mergedIntoTopicId === undefined,
            "Only a merged topic may identify a merge target",
            { topicId: topic.topicId, nextState },
        );
    }

    return Object.freeze({
        ...topic,
        state: nextState,
        revision: topic.revision + 1,
        ...(mergedIntoTopicId === undefined ? {} : { mergedIntoTopicId }),
    });
}

export function normalizeTopicSlug(value: string): string {
    const slug = value
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");

    if (slug.length === 0) {
        return invalidArgument("Topic slug must contain a letter or number", {
            value,
        });
    }
    return slug;
}

export function normalizeTopicPath(value: string): string {
    const segments = value
        .split("/")
        .filter((segment) => segment.length > 0)
        .map(normalizeTopicSlug);

    if (segments.length === 0) {
        return invalidArgument("Topic path must contain at least one segment", {
            value,
        });
    }
    return `/${segments.join("/")}`;
}

const allowedTopicTransitions: Record<TopicState, readonly TopicState[]> = {
    provisional: ["established", "merged", "archived"],
    established: ["merged", "archived"],
    merged: ["archived"],
    archived: [],
};
