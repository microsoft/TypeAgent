// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { TopicConcept, TopicCuration } from "./topicTypes.js";
import { viewHash } from "./viewContent.js";

function ownership(curation: TopicCuration): Map<string, string> {
    return new Map([
        ...curation.concepts.flatMap((concept) =>
            concept.memberIds.map((id): [string, string] => [
                id,
                `concept:${concept.id}`,
            ]),
        ),
        ...curation.deferred.map((entry): [string, string] => [
            entry.nodeId,
            `deferred:${entry.reason}`,
        ]),
    ]);
}

export function createTopicTransaction(
    base: TopicCuration,
    staged: TopicCuration,
    readIds: ReadonlySet<string>,
    readUniverse: boolean,
) {
    if (
        viewHash(staged.deferred.slice(0, base.deferred.length)) !==
        viewHash(base.deferred)
    )
        throw new Error("Speculative transaction rewrote existing deferrals");
    const before = new Map(
        base.concepts.map((concept) => [concept.id, concept]),
    );
    const after = new Map(
        staged.concepts.map((concept) => [concept.id, concept]),
    );
    const writes = new Map<string, TopicConcept | undefined>();
    for (const id of new Set([...before.keys(), ...after.keys()]))
        if (
            viewHash(before.get(id) ?? null) !== viewHash(after.get(id) ?? null)
        )
            writes.set(id, after.get(id));
    const reads = new Map<string, string>();
    for (const id of new Set([...readIds, ...writes.keys()]))
        if (before.has(id)) reads.set(id, viewHash(before.get(id)));
    const deferred = staged.deferred.slice(base.deferred.length);
    const nodes = new Set([
        ...[...writes.keys()].flatMap((id) => [
            ...(before.get(id)?.memberIds ?? []),
            ...(after.get(id)?.memberIds ?? []),
        ]),
        ...deferred.map((entry) => entry.nodeId),
    ]);
    const baseOwners = ownership(base);
    if (!readUniverse && [...writes.values()].some((concept) => !concept))
        throw new Error("Concept deletion requires a universe read");
    return {
        reads,
        writes,
        deferred,
        owners: new Map([...nodes].map((id) => [id, baseOwners.get(id)])),
        universe: readUniverse ? viewHash(base.concepts) : undefined,
        concepts: staged.concepts,
    };
}

export function applyTopicTransaction(
    current: TopicCuration,
    transaction: ReturnType<typeof createTopicTransaction>,
): { valid: false; reason: string } | { valid: true; curation: TopicCuration } {
    const concepts = new Map(
        current.concepts.map((concept) => [concept.id, concept]),
    );
    if (
        transaction.universe !== undefined &&
        transaction.universe !== viewHash(current.concepts)
    )
        return { valid: false, reason: "concept-universe-changed" };
    for (const [id, version] of transaction.reads)
        if (viewHash(concepts.get(id) ?? null) !== version)
            return { valid: false, reason: "concept-read-changed" };
    for (const id of transaction.writes.keys())
        if (!transaction.reads.has(id) && concepts.has(id))
            return { valid: false, reason: "concept-insert-collision" };
    const owners = ownership(current);
    for (const [id, owner] of transaction.owners)
        if (owners.get(id) !== owner)
            return { valid: false, reason: "node-ownership-changed" };
    const merged =
        transaction.universe !== undefined
            ? transaction.concepts
            : [
                  ...current.concepts.map(
                      (concept) =>
                          transaction.writes.get(concept.id) ?? concept,
                  ),
                  ...[...transaction.writes]
                      .filter(([id]) => !concepts.has(id))
                      .map(([, concept]) => {
                          if (!concept)
                              throw new Error("Missing inserted concept");
                          return concept;
                      }),
              ];
    return {
        valid: true,
        curation: structuredClone({
            concepts: merged,
            deferred: [...current.deferred, ...transaction.deferred],
        }),
    };
}
