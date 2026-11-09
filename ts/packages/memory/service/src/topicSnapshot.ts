// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import type {
    TopicNode,
    TopicOccurrence,
    TopicQueryPage,
    TopicQueryRequest,
    TopicSnapshot,
} from "./topicTypes.js";
import { assertViewIdentifier } from "./viewContent.js";
import { parseIndexedLocator } from "./indexedFragments.js";
import { TopicEvidenceIndex, topicSourceKey } from "./topicLookup.js";
import {
    validateTopicCuration,
    validateTopicCurationProgress,
} from "./topicCuration.js";

export function topicId(corpusId: string, identity: string): string {
    return `topic:${createHash("sha256")
        .update(JSON.stringify([corpusId, identity]))
        .digest("hex")
        .slice(0, 32)}`;
}

export function occurrenceIdentity(occurrence: TopicOccurrence): string {
    const blockOrdinal = parseIndexedLocator(
        occurrence.citations[0].locator,
    ).blockOrdinal;
    return JSON.stringify([
        ...(occurrence.evidence ? ["event", occurrence.evidence.eventId] : []),
        occurrence.sourceId,
        occurrence.scope,
        blockOrdinal,
        occurrence.label.trim().toLowerCase(),
        occurrence.ordinal,
    ]);
}

export function initialTopicNodes(
    corpusId: string,
    occurrences: TopicOccurrence[],
): TopicNode[] {
    const nodes = new Map<string, TopicNode>();
    for (const occurrence of occurrences) {
        const identity = occurrenceIdentity(occurrence);
        const node = nodes.get(identity) ?? {
            id: topicId(corpusId, identity),
            identity,
            label: occurrence.label,
            scope: occurrence.scope,
            aliases: [],
            occurrenceIds: [],
            summary: "",
            citations: [],
            summaryState: "pending" as const,
            summaryAuthorship: "generated" as const,
            limits: [
                "Indexed occurrences are not exhaustive semantic coverage.",
                `Indexed nomination ${occurrence.ordinal + 1} in its original block; same names are not proven equivalent.`,
            ],
            authorship: "generated" as const,
        };
        node.occurrenceIds.push(occurrence.id);
        node.citations.push(...occurrence.citations);
        nodes.set(identity, node);
    }
    return [...nodes.values()];
}

function validateOccurrence(
    occurrence: TopicOccurrence,
    eventIds: ReadonlySet<string>,
    sourceRevisions: ReadonlySet<string>,
): void {
    if (
        occurrence.evidence &&
        (occurrence.sourceId !== occurrence.evidence.eventId ||
            occurrence.revisionId !== occurrence.evidence.eventId)
    )
        throw new Error(
            "Event topic incidence must retain canonical event identity",
        );
    if (
        !occurrence.label.trim() ||
        !occurrence.scope ||
        !Number.isSafeInteger(occurrence.ordinal) ||
        occurrence.ordinal < 0 ||
        !occurrence.citations.length
    )
        throw new Error("Topic occurrence requires scoped original evidence");
    if (
        occurrence.citations.some(
            (citation) =>
                citation.sourceId !== occurrence.sourceId ||
                citation.revisionId !== occurrence.revisionId ||
                !citation.locator ||
                !citation.excerpt ||
                JSON.stringify(citation.evidence) !==
                    JSON.stringify(occurrence.evidence),
        )
    )
        throw new Error(
            "Topic occurrence evidence must reference its original indexed revision",
        );
    for (const citation of occurrence.citations) {
        const range = parseIndexedLocator(citation.locator);
        if (range.end - range.start !== citation.excerpt.length)
            throw new Error(
                "Topic evidence excerpt does not match indexed coordinate length",
            );
    }
    if (
        occurrence.evidence
            ? !eventIds.has(occurrence.evidence.eventId)
            : !sourceRevisions.has(topicSourceKey(occurrence))
    )
        throw new Error(
            "Topic occurrence absent from captured source influence",
        );
}

function validateNodeMetadata(node: TopicNode): void {
    if (
        !["generated", "human"].includes(node.authorship) ||
        node.summaryAuthorship !== "generated" ||
        !["pending", "ready", "failed"].includes(node.summaryState) ||
        node.summary.length > 1600 ||
        (node.summaryState === "ready" && !node.summary.trim())
    )
        throw new Error("Invalid topic summary availability or authorship");
    if (node.aliases.some((alias) => !alias.label.trim() || !alias.scope))
        throw new Error("Topic aliases must retain readable labels and scope");
}

function validateNode(
    node: TopicNode,
    snapshot: TopicSnapshot,
    occurrences: Map<string, TopicOccurrence>,
    represented: Set<string>,
    evidenceIndex: TopicEvidenceIndex,
): void {
    validateNodeMetadata(node);
    if (
        node.id !== topicId(snapshot.corpusId, node.identity) ||
        !node.label.trim() ||
        !node.scope
    )
        throw new Error("Invalid scoped topic identity");
    const selected = node.occurrenceIds.map((id) => {
        const occurrence = occurrences.get(id);
        if (!occurrence || represented.has(id))
            throw new Error("Invalid or duplicate topic membership");
        represented.add(id);
        if (occurrenceIdentity(occurrence) !== node.identity)
            throw new Error(
                "Names, aliases and overlap cannot merge distinct scoped occurrences",
            );
        return occurrence;
    });
    if (!selected.length || (node.summary && !node.citations.length))
        throw new Error("Topic summary requires original incidence evidence");
    if (!evidenceIndex.ownsExactEvidence([node.id], node.citations))
        throw new Error("Topic summary cites unsupplied original evidence");
}

function validateEdges(
    snapshot: TopicSnapshot,
    nodes: ReadonlySet<string>,
): void {
    const children = new Map<string, string[]>();
    for (const edge of snapshot.parents) {
        if (
            !nodes.has(edge.parentId) ||
            !nodes.has(edge.childId) ||
            edge.parentId === edge.childId
        )
            throw new Error("Invalid organizational topic edge");
        children.set(edge.parentId, [
            ...(children.get(edge.parentId) ?? []),
            edge.childId,
        ]);
    }
    const visiting = new Set<string>(),
        visited = new Set<string>();
    const visit = (id: string) => {
        if (visiting.has(id))
            throw new Error("Organizational topic hierarchy must be a DAG");
        if (visited.has(id)) return;
        visiting.add(id);
        for (const child of children.get(id) ?? []) visit(child);
        visiting.delete(id);
        visited.add(id);
    };
    for (const id of nodes.keys()) visit(id);
    for (const edge of snapshot.related)
        if (
            edge.kind !== "related" ||
            !nodes.has(edge.fromId) ||
            !nodes.has(edge.toId) ||
            edge.fromId === edge.toId
        )
            throw new Error("Invalid related topic edge");
}

export function validateTopicSnapshot(snapshot: TopicSnapshot): void {
    if (snapshot.schemaVersion !== 1)
        throw new Error("Unsupported topic snapshot schema");
    assertViewIdentifier("corpus ID", snapshot.corpusId);
    assertViewIdentifier("topic generation", snapshot.generation);
    const eventIds = new Set<string>();
    for (const event of snapshot.influenceEvents ?? []) {
        assertViewIdentifier("topic event ID", event.eventId);
        if (
            eventIds.has(event.eventId) ||
            !/^[0-9a-f]{64}$/.test(event.fingerprint)
        )
            throw new Error("Invalid or duplicate topic event influence");
        eventIds.add(event.eventId);
    }
    const occurrences = new Map(
        snapshot.occurrences.map((entry) => [entry.id, entry]),
    );
    const nodes = new Map(snapshot.nodes.map((entry) => [entry.id, entry]));
    if (
        occurrences.size !== snapshot.occurrences.length ||
        nodes.size !== snapshot.nodes.length
    )
        throw new Error("Duplicate topic or occurrence identity");
    const represented = new Set<string>();
    const sourceRevisions = new Set(
        snapshot.influenceSources.map(topicSourceKey),
    );
    for (const occurrence of occurrences.values())
        validateOccurrence(occurrence, eventIds, sourceRevisions);
    const evidenceIndex = new TopicEvidenceIndex(snapshot);
    for (const node of nodes.values())
        validateNode(node, snapshot, occurrences, represented, evidenceIndex);
    if (represented.size !== occurrences.size)
        throw new Error(
            "Topic snapshot truncated maintained occurrence membership",
        );
    validateTopicCuration(snapshot, evidenceIndex);
    validateTopicCurationProgress(snapshot, evidenceIndex);
    validateEdges(
        snapshot,
        new Set([
            ...nodes.keys(),
            ...(snapshot.curation?.concepts.map((concept) => concept.id) ?? []),
        ]),
    );
}

export function validateTopicQuery(request: TopicQueryRequest): void {
    if (
        !request ||
        Object.keys(request).some(
            (key) =>
                ![
                    "corpusId",
                    "topicId",
                    "search",
                    "depth",
                    "pageSize",
                    "continuationToken",
                    "curated",
                    "summarize",
                ].includes(key),
        )
    )
        throw new Error("Unsupported topic query");
    if (request.curated !== undefined && typeof request.curated !== "boolean")
        throw new Error("Invalid curated topic selection");
    if (
        request.summarize !== undefined &&
        (typeof request.summarize !== "boolean" ||
            (request.summarize &&
                (!request.curated ||
                    !request.topicId ||
                    request.continuationToken ||
                    request.search)))
    )
        throw new Error(
            "Summary generation requires one explicit curated topic",
        );
    assertViewIdentifier("corpus ID", request.corpusId);
    if (request.topicId !== undefined)
        assertViewIdentifier("topic ID", request.topicId);
    if (
        request.search !== undefined &&
        (typeof request.search !== "string" || request.search.length > 1000)
    )
        throw new Error("Invalid topic search");
    for (const [name, value, maximum] of [
        ["depth", request.depth, 10],
        ["pageSize", request.pageSize, 200],
    ] as const)
        if (
            value !== undefined &&
            (!Number.isInteger(value) ||
                value < (name === "depth" ? 0 : 1) ||
                value > maximum)
        )
            throw new Error(`Invalid topic ${name}`);
    if (
        request.continuationToken !== undefined &&
        (typeof request.continuationToken !== "string" ||
            request.continuationToken.length > 2000)
    )
        throw new Error("Invalid topic continuation");
}

function topicSources(snapshot: TopicSnapshot, node: TopicNode): Set<string> {
    const membership = new Set(node.occurrenceIds);
    return new Set(
        snapshot.occurrences
            .filter((entry) => membership.has(entry.id))
            .map((entry) => entry.sourceId),
    );
}

function continuationOffset(
    request: TopicQueryRequest,
    snapshot: TopicSnapshot,
    selection: unknown[],
): number {
    if (!request.continuationToken) return 0;
    let token: unknown;
    try {
        token = JSON.parse(
            Buffer.from(request.continuationToken, "base64url").toString(
                "utf8",
            ),
        );
    } catch {
        throw new Error("Invalid topic continuation");
    }
    if (
        !Array.isArray(token) ||
        token.length !== 3 ||
        token[0] !== snapshot.generation ||
        JSON.stringify(token[1]) !== JSON.stringify(selection) ||
        !Number.isSafeInteger(token[2]) ||
        token[2] < 0
    )
        throw new Error(
            "Topic continuation is stale or belongs to another query",
        );
    return token[2];
}

function selectTopicNodes(
    snapshot: TopicSnapshot,
    request: TopicQueryRequest,
): TopicNode[] {
    let nodes = snapshot.nodes;
    if (request.topicId) {
        const selected = new Set([request.topicId]);
        if (!nodes.some((node) => node.id === request.topicId))
            throw new Error("Topic does not exist in this generation");
        for (let depth = 0; depth < (request.depth ?? 1); depth++) {
            const additions = snapshot.parents.flatMap((edge) =>
                selected.has(edge.parentId)
                    ? [edge.childId]
                    : selected.has(edge.childId)
                      ? [edge.parentId]
                      : [],
            );
            additions.forEach((id) => selected.add(id));
        }
        nodes = nodes.filter((node) => selected.has(node.id));
    }
    if (request.search) {
        const term = request.search.toLocaleLowerCase();
        nodes = nodes.filter((node) =>
            [
                node.label,
                node.scope,
                ...node.aliases.map((alias) => `${alias.scope} ${alias.label}`),
            ].some((text) => text.toLocaleLowerCase().includes(term)),
        );
    }
    return [...nodes].sort((a, b) => a.id.localeCompare(b.id));
}

function topicNeighborhoods(
    snapshot: TopicSnapshot,
    topicId: string,
): TopicQueryPage["neighborhoods"] {
    const node = snapshot.nodes.find((node) => node.id === topicId);
    if (!node) throw new Error("Topic does not exist in this generation");
    const source = topicSources(snapshot, node);
    return snapshot.nodes
        .filter((node) => node.id !== topicId)
        .map((node) => {
            const other = topicSources(snapshot, node);
            const sharedSources = [...source].filter((id) =>
                other.has(id),
            ).length;
            return {
                topicId: node.id,
                label: node.label,
                scope: node.scope,
                sharedSources,
                score: sharedSources / new Set([...source, ...other]).size,
            };
        })
        .filter((entry) => entry.sharedSources > 0)
        .sort(
            (a, b) => b.score - a.score || a.topicId.localeCompare(b.topicId),
        );
}

function queryCuratedTopics(
    snapshot: TopicSnapshot,
    request: TopicQueryRequest,
    empty: TopicQueryPage,
    offset: number,
    selection: unknown[],
): TopicQueryPage {
    const concepts = (snapshot.curation?.concepts ?? [])
        .filter((concept) => !request.topicId || concept.id === request.topicId)
        .filter(
            (concept) =>
                !request.search ||
                `${concept.label} ${concept.scope} ${concept.purpose}`
                    .toLocaleLowerCase()
                    .includes(request.search.toLocaleLowerCase()),
        )
        .sort((a, b) => b.salience - a.salience || a.id.localeCompare(b.id));
    if (offset > concepts.length)
        throw new Error("Curated topic continuation exceeds query");
    const page = concepts.slice(offset, offset + (request.pageSize ?? 50));
    const pending = pendingTopicAssignments(snapshot, request);
    return {
        ...empty,
        concepts: page.map((concept) => ({
            ...concept,
            memberIds: concept.memberIds.slice(0, 20),
            citations: concept.citations.slice(0, 8),
            memberCount: concept.memberIds.length,
            omittedMembers: Math.max(0, concept.memberIds.length - 20),
            citationCount: concept.citations.length,
            omittedCitations: Math.max(0, concept.citations.length - 8),
        })),
        totalConcepts: snapshot.curation?.concepts.length ?? 0,
        ...(snapshot.curation?.pending
            ? {
                  pendingAssignments: pending.slice(0, request.pageSize ?? 50),
                  pendingCount: snapshot.curation.pending.length,
                  omittedPendingAssignments: Math.max(
                      0,
                      pending.length - (request.pageSize ?? 50),
                  ),
              }
            : {}),
        matchingNodes: concepts.length,
        omittedNodes: snapshot.nodes.length,
        limits: [
            ...empty.limits,
            ...(snapshot.curation?.pending?.length
                ? [
                      `${snapshot.curation.pending.length} topic assignments remain pending; raw evidence is available but these assignments are not validated concepts.`,
                  ]
                : []),
            ...(snapshot.curation
                ? []
                : [
                      "Curated concepts have not been generated; raw occurrences remain available.",
                  ]),
        ],
        ...(offset + page.length < concepts.length
            ? {
                  nextContinuationToken: Buffer.from(
                      JSON.stringify([
                          snapshot.generation,
                          selection,
                          offset + page.length,
                      ]),
                  ).toString("base64url"),
              }
            : {}),
    };
}

function pendingTopicAssignments(
    snapshot: TopicSnapshot,
    request: TopicQueryRequest,
) {
    if (!snapshot.curation?.pending?.length) return [];
    const nodes = new Map(snapshot.nodes.map((node) => [node.id, node]));
    return (snapshot.curation?.pending ?? []).filter((entry) => {
        if (request.topicId && request.topicId !== entry.nodeId) return false;
        const node = nodes.get(entry.nodeId);
        return (
            !request.search ||
            (node !== undefined &&
                `${node.label} ${node.scope}`
                    .toLocaleLowerCase()
                    .includes(request.search.toLocaleLowerCase()))
        );
    });
}

export function queryTopicSnapshot(
    snapshot: TopicSnapshot | undefined,
    request: TopicQueryRequest,
): TopicQueryPage {
    validateTopicQuery(request);
    const limits = snapshot?.limits ?? ["Topic snapshot not yet maintained."];
    const empty: TopicQueryPage = {
        generation: snapshot?.generation ?? null,
        nodes: [],
        parents: [],
        related: [],
        neighborhoods: [],
        totalNodes: snapshot?.nodes.length ?? 0,
        matchingNodes: 0,
        omittedNodes: 0,
        omittedParents: 0,
        omittedRelated: 0,
        omittedNeighborhoods: 0,
        limits,
        io: { stateBytes: 0, snapshotBytes: 0, elapsedMs: 0 },
        ...(snapshot?.curation
            ? { totalConcepts: snapshot.curation.concepts.length }
            : {}),
    };
    if (!snapshot) {
        if (request.continuationToken)
            throw new Error("Topic continuation has no snapshot");
        return empty;
    }
    if (snapshot.corpusId !== request.corpusId)
        throw new Error("Topic snapshot belongs to another corpus");
    const selection = [
        request.topicId ?? null,
        request.search ?? null,
        request.depth ?? 1,
        request.pageSize ?? 50,
        ...(request.curated ? ["curated-v1"] : []),
    ];
    const offset = continuationOffset(request, snapshot, selection);
    if (request.curated)
        return queryCuratedTopics(snapshot, request, empty, offset, selection);
    const nodes = selectTopicNodes(snapshot, request);
    if (request.topicId) {
        const neighborhoods = topicNeighborhoods(snapshot, request.topicId);
        empty.neighborhoods = neighborhoods.slice(0, request.pageSize ?? 50);
        empty.omittedNeighborhoods =
            neighborhoods.length - empty.neighborhoods.length;
    }
    if (offset > nodes.length)
        throw new Error("Topic continuation exceeds query");
    const page = nodes.slice(offset, offset + (request.pageSize ?? 50));
    const ids = new Set(page.map((node) => node.id));
    const parents = snapshot.parents.filter(
        (edge) => ids.has(edge.parentId) && ids.has(edge.childId),
    );
    const related = snapshot.related.filter(
        (edge) => ids.has(edge.fromId) && ids.has(edge.toId),
    );
    return {
        ...empty,
        nodes: page.map((node) => ({
            ...node,
            occurrenceIds: node.occurrenceIds.slice(0, 20),
            citations: node.citations.slice(0, 8),
            occurrenceCount: node.occurrenceIds.length,
            citationCount: node.citations.length,
            omittedOccurrences: Math.max(0, node.occurrenceIds.length - 20),
            omittedCitations: Math.max(0, node.citations.length - 8),
        })),
        parents: parents.slice(0, 200),
        related: related.slice(0, 200),
        omittedParents: snapshot.parents.length - Math.min(parents.length, 200),
        omittedRelated: snapshot.related.length - Math.min(related.length, 200),
        matchingNodes: nodes.length,
        omittedNodes: snapshot.nodes.length - page.length,
        ...(offset + page.length < nodes.length
            ? {
                  nextContinuationToken: Buffer.from(
                      JSON.stringify([
                          snapshot.generation,
                          selection,
                          offset + page.length,
                      ]),
                  ).toString("base64url"),
              }
            : {}),
    };
}
