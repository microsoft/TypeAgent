// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import type { ProcedureVersion } from "@typeagent/memory-service";
import {
    canonicalizeProcedure as canonicalize,
    procedureToMarkdown,
    validateAgentEdition,
} from "@typeagent/memory-service";
import type { ProcedureLineage } from "./types.js";

function hash(value: string): string {
    return createHash("sha256").update(value).digest("hex");
}

export function validateProcedure(procedure: ProcedureVersion): void {
    if (procedure.state !== "saved") {
        throw new Error(
            `Procedure '${procedure.procedureId}' version ${procedure.version} must be in saved state; received ${procedure.state}.`,
        );
    }
    if (
        !procedure.corpusId.trim() ||
        !procedure.procedureId.trim() ||
        !Number.isSafeInteger(procedure.version) ||
        procedure.version < 1
    ) {
        throw new Error("Procedure lineage is incomplete or invalid.");
    }
    if (procedure.document.steps.length === 0) {
        throw new Error("A reviewed procedure must contain at least one step.");
    }
    if (procedure.document.agentEdition !== undefined) {
        validateAgentEdition(procedure.document.agentEdition);
        if (procedureToMarkdown(procedure.document) !== procedure.markdown) {
            throw new Error(
                "Agent-edition Markdown does not match its canonical document.",
            );
        }
    }
    if (canonicalize(procedure.document) !== procedure.canonicalJson) {
        throw new Error(
            `Procedure '${procedure.procedureId}' canonical document does not match its reviewed content.`,
        );
    }
    if (
        hash(procedure.canonicalJson) !== procedure.jsonHash ||
        hash(procedure.markdown) !== procedure.markdownHash
    ) {
        throw new Error(
            `Procedure '${procedure.procedureId}' version ${procedure.version} failed source manifest validation.`,
        );
    }
}

export function getProcedureLineage(
    procedure: ProcedureVersion,
): ProcedureLineage {
    return {
        corpusId: procedure.corpusId,
        procedureId: procedure.procedureId,
        version: procedure.version,
        jsonHash: procedure.jsonHash,
        markdownHash: procedure.markdownHash,
        ...(procedure.basedOnCandidateId === undefined
            ? {}
            : { basedOnCandidateId: procedure.basedOnCandidateId }),
        ...(procedure.previousVersion === undefined
            ? {}
            : { previousVersion: procedure.previousVersion }),
    };
}

export function hashArtifact(content: string | Uint8Array): string {
    return createHash("sha256").update(content).digest("hex");
}
