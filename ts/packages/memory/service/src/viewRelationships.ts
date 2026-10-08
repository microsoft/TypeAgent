// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash, randomUUID } from "node:crypto";
import type {
    ViewVersion,
    ViewRelationship,
    ViewRelationshipInput,
    ViewDefinition,
} from "./viewTypes.js";

export function materializeDefinition(
    input: Omit<ViewDefinition, "revisionId">,
    previous?: ViewDefinition,
): ViewDefinition {
    const identity = (definition: Omit<ViewDefinition, "revisionId">) =>
        JSON.stringify([
            definition.kind,
            definition.selector.sources.map((source) => [
                source.sourceId,
                source.revisionId,
            ]),
        ]);
    return {
        ...structuredClone(input),
        revisionId:
            previous && identity(input) === identity(previous)
                ? previous.revisionId
                : randomUUID(),
    };
}

export function versionRelationships(
    version: ViewVersion,
    authored: ViewRelationshipInput[],
): ViewRelationship[] {
    const from = {
        kind: "view" as const,
        viewId: version.viewId,
        revisionId: version.revisionId,
    };
    return [
        ...authored.map(
            (edge): ViewRelationship => ({
                ...structuredClone(edge),
                schemaVersion: 1,
                family:
                    edge.predicate === "supportedBy"
                        ? "evidence"
                        : "dependency",
                origin: "human",
                reviewState: "unreviewed",
            }),
        ),
        {
            id: "lineage:definition",
            schemaVersion: 1,
            predicate: "generatedFrom",
            family: "lineage",
            origin: "system",
            from,
            to: {
                kind: "definition",
                viewId: version.viewId,
                revisionId: version.definition.revisionId,
            },
        },
        ...version.definition.selector.sources.map(
            (source): ViewRelationship => ({
                id: `dependency:${createHash("sha256").update(source.sourceId).digest("hex").slice(0, 24)}`,
                schemaVersion: 1,
                predicate: "dependsOn",
                family: "dependency",
                origin: "system",
                from,
                to: { kind: "source", ...source },
            }),
        ),
    ];
}

export function authoredRelationships(
    version: ViewVersion,
): ViewRelationshipInput[] {
    return version.relationships.flatMap((edge) =>
        edge.origin === "human"
            ? [
                  {
                      id: edge.id,
                      predicate: edge.predicate,
                      from: edge.from,
                      to: edge.to,
                      citations: edge.citations,
                  },
              ]
            : [],
    );
}
