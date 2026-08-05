// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { invariant } from "./errors.js";
import type { ArtifactId, ScopeId, TurnId } from "./ids.js";
import {
    createProvenance,
    requireAbsoluteTimestamp,
    requireText,
    type MemoryProvenance,
    type Revision,
} from "./metadata.js";

export type ArtifactState = "active" | "deleted";

export type Artifact = {
    artifactId: ArtifactId;
    scopeId: ScopeId;
    kind: string;
    name: string;
    uri?: string;
    state: ArtifactState;
    revision: Revision;
    createdAt: string;
};

export type ArtifactChangeKind = "created" | "updated" | "deleted";

export type ArtifactChange = {
    artifactId: ArtifactId;
    turnId: TurnId;
    kind: ArtifactChangeKind;
    summary: string;
    occurredAt: string;
    artifactRevision: Revision;
    provenance: MemoryProvenance;
};

export function createArtifact(
    artifact: Omit<Artifact, "state" | "revision">,
): Artifact {
    return Object.freeze({
        ...artifact,
        kind: requireText(artifact.kind, "artifact.kind"),
        name: requireText(artifact.name, "artifact.name"),
        ...(artifact.uri === undefined
            ? {}
            : { uri: requireText(artifact.uri, "artifact.uri") }),
        state: "active",
        revision: 1,
        createdAt: requireAbsoluteTimestamp(
            artifact.createdAt,
            "artifact.createdAt",
        ),
    });
}

export function createArtifactChange(
    artifact: Artifact,
    change: Omit<ArtifactChange, "artifactId" | "artifactRevision">,
): ArtifactChange {
    invariant(
        change.kind === "created" ? artifact.revision === 1 : true,
        "Created artifact changes must reference the first revision",
        { artifactId: artifact.artifactId, revision: artifact.revision },
    );
    invariant(
        artifact.state !== "deleted" || change.kind === "deleted",
        "A deleted artifact cannot be updated",
        { artifactId: artifact.artifactId, changeKind: change.kind },
    );

    return Object.freeze({
        ...change,
        artifactId: artifact.artifactId,
        summary: requireText(change.summary, "artifactChange.summary"),
        occurredAt: requireAbsoluteTimestamp(
            change.occurredAt,
            "artifactChange.occurredAt",
        ),
        artifactRevision: artifact.revision,
        provenance: createProvenance(change.provenance),
    });
}
