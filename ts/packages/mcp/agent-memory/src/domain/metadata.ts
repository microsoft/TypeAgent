// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { invalidArgument } from "./errors.js";

export type Revision = number;

export type MemoryProvenance = {
    sourceType: "user" | "agent" | "tool" | "document" | "system";
    actorId: string;
    sourceId?: string;
    sourceUri?: string;
    observedAt?: string;
};

export type DerivationMetadata = {
    operation: string;
    sourceIds: readonly string[];
    sourceRevisions: readonly Revision[];
    generatedAt: string;
    providerId?: string;
    modelId?: string;
    promptVersion?: string;
    throughSequence?: number;
};

export function createProvenance(
    provenance: MemoryProvenance,
): MemoryProvenance {
    const actorId = requireText(provenance.actorId, "actorId");
    if (provenance.observedAt !== undefined) {
        requireAbsoluteTimestamp(provenance.observedAt, "observedAt");
    }

    return Object.freeze({
        ...provenance,
        actorId,
    });
}

export function createDerivationMetadata(
    metadata: DerivationMetadata,
): DerivationMetadata {
    requireUnique(metadata.sourceIds, "derivation source IDs");
    if (metadata.sourceIds.length !== metadata.sourceRevisions.length) {
        return invalidArgument(
            "Derivation source IDs and revisions must have equal lengths",
            {
                sourceIdCount: metadata.sourceIds.length,
                sourceRevisionCount: metadata.sourceRevisions.length,
            },
        );
    }

    return Object.freeze({
        ...metadata,
        operation: requireText(metadata.operation, "derivation.operation"),
        sourceIds: Object.freeze([...metadata.sourceIds]),
        sourceRevisions: Object.freeze(
            metadata.sourceRevisions.map(requireRevision),
        ),
        generatedAt: requireAbsoluteTimestamp(
            metadata.generatedAt,
            "derivation.generatedAt",
        ),
        ...(metadata.throughSequence === undefined
            ? {}
            : {
                  throughSequence: requireSequence(
                      metadata.throughSequence,
                      "derivation.throughSequence",
                  ),
              }),
    });
}

export function requireRevision(value: number): Revision {
    if (!Number.isSafeInteger(value) || value < 1) {
        return invalidArgument("revision must be a positive safe integer", {
            value,
        });
    }
    return value;
}

export function requireSequence(value: number, name: string): number {
    if (!Number.isSafeInteger(value) || value < 0) {
        return invalidArgument(`${name} must be a non-negative safe integer`, {
            name,
            value,
        });
    }
    return value;
}

export function requireAbsoluteTimestamp(value: string, name: string): string {
    const rfc3339Pattern =
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i;
    if (!rfc3339Pattern.test(value) || Number.isNaN(Date.parse(value))) {
        return invalidArgument(
            `${name} must be an absolute RFC3339 timestamp`,
            {
                name,
                value,
            },
        );
    }
    return value;
}

export function requireText(value: string, name: string): string {
    const normalized = value.trim();
    if (normalized.length === 0) {
        return invalidArgument(`${name} must not be empty`, { name });
    }
    return normalized;
}

function requireUnique(values: readonly string[], name: string): void {
    if (new Set(values).size !== values.length) {
        invalidArgument(`${name} must be unique`, { name });
    }
}
