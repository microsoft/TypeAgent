// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash, randomUUID } from "node:crypto";
import { viewSourceKey } from "./viewContent.js";
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
        JSON.stringify([definition.kind, definition.selector]);
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
    generated = false,
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
                origin:
                    generated &&
                    !version.edits?.some(
                        (edit) =>
                            edit.target === `edge:${edgeIdentity(edge)}` &&
                            edit.status !== "cleared",
                    )
                        ? "generator"
                        : "human",
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
                id: `dependency:${createHash("sha256").update(viewSourceKey(source)).digest("hex").slice(0, 24)}`,
                schemaVersion: 1,
                predicate: "dependsOn",
                family: "dependency",
                origin: "system",
                from,
                to: { kind: "source", ...source },
            }),
        ),
        ...(
            version.generation?.input?.inputs.filter(
                (input) => input.evidence,
            ) ?? []
        ).map(
            (input): ViewRelationship => ({
                id: `dependency:${createHash("sha256").update(viewSourceKey(input)).digest("hex").slice(0, 24)}`,
                schemaVersion: 1,
                predicate: "dependsOn",
                family: "dependency",
                origin: "system",
                from,
                to: {
                    kind: "source",
                    sourceId: input.sourceId,
                    revisionId: input.revisionId,
                    evidence: input.evidence!,
                },
            }),
        ),
    ];
}

export function edgeIdentity(edge: ViewRelationshipInput): string {
    return JSON.stringify([
        edge.predicate,
        ["section", edge.from.viewId, edge.from.sectionId],
        edge.to.kind === "source"
            ? edge.to.evidence
                ? ["event", edge.to.evidence.eventId]
                : ["source", edge.to.sourceId]
            : ["section", edge.to.viewId, edge.to.sectionId],
    ]);
}

export function authoredRelationships(
    version: ViewVersion,
): ViewRelationshipInput[] {
    return version.relationships.flatMap((edge) => {
        if (edge.origin === "system") return [];
        const {
            schemaVersion: _schemaVersion,
            family: _family,
            origin: _origin,
            reviewState: _reviewState,
            ...input
        } = edge;
        return [input];
    });
}
