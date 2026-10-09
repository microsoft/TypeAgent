// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ViewBuildRequest, ViewConflictResolution } from "./viewTypes.js";
import { validateViewDraft } from "./viewValidation.js";
import { assertViewIdentifier } from "./viewContent.js";
import { validateIsoTimestamp } from "./timestampValidation.js";
import { emptyProjectBrief } from "./projectBrief.js";
import { emptyWiki } from "./wiki.js";

export function parseViewDraftCapability(value: string | undefined): boolean {
    if (value === undefined || value === "false") return false;
    if (value === "true") return true;
    throw new Error(
        "TYPEAGENT_MEMORY_VIEW_DRAFTS must be true or false; draft views remain disabled by default",
    );
}

export function validateBuildRequest(request: ViewBuildRequest): void {
    if (
        !request ||
        typeof request !== "object" ||
        Object.keys(request).some(
            (key) =>
                ![
                    "corpusId",
                    "expectedHead",
                    "targets",
                    "bounds",
                    "publication",
                ].includes(key),
        )
    )
        throw new Error(
            "Unsupported build request field; actor and model are service-owned",
        );
    if (
        request.publication !== undefined &&
        typeof request.publication !== "boolean"
    )
        throw new Error(
            "Build publication override must be a boolean or absent to inherit",
        );
    if (
        !Array.isArray(request.targets) ||
        !request.targets.length ||
        request.targets.length > 32
    )
        throw new Error("A build requires 1 to 32 explicit targets");
    const ids = new Set<string>();
    for (const target of request.targets) {
        if (
            !target ||
            Object.keys(target).some(
                (key) => !["definition", "expectedVersion"].includes(key),
            )
        )
            throw new Error("Unsupported build target");
        validateViewDraft({
            corpusId: request.corpusId,
            viewId: target.definition?.viewId,
            expectedVersion: target.expectedVersion,
            expectedHead: request.expectedHead,
            definition: target.definition,
            content:
                target.definition?.kind === "timeline"
                    ? {
                          kind: "timeline",
                          title: "Timeline selection validation",
                          generatedAt: "2026-01-01T00:00:00.000Z",
                          citations: [],
                          sections: [
                              {
                                  id: "validation",
                                  role: "event",
                                  heading: "Record",
                                  body: "Selected evidence",
                                  details: {
                                      kind: "event",
                                      identity: {
                                          kind: "documentRecord",
                                          sourceId: "validation",
                                          sourceRecordId: "validation",
                                      },
                                      eventType: "unknown",
                                      state: "unknown",
                                      outcome: null,
                                      occurredAt: null,
                                      learnedAt: null,
                                      capturedAt: null,
                                      inventoryIds: [],
                                  },
                              },
                          ],
                      }
                    : target.definition?.kind === "wiki"
                      ? emptyWiki()
                      : target.definition?.kind === "projectBrief"
                        ? emptyProjectBrief()
                        : {
                              kind: "troubleshootingGuide",
                              title: "Build validation",
                              sections: [
                                  {
                                      id: "context",
                                      role: "context",
                                      heading: "Context",
                                      body: "Selected evidence",
                                  },
                              ],
                              citations: [],
                          },
            relationships: [],
        });
        const id = target.definition.viewId;
        if (ids.has(id)) throw new Error("Duplicate build target");
        ids.add(id);
        if (
            !(
                target.definition.selector.sources.length +
                (target.definition.selector.events?.length ?? 0)
            ) ||
            target.definition.selector.sources.length +
                (target.definition.selector.events?.length ?? 0) >
                32
        )
            throw new Error(
                "Each target must select 1 to 32 exact retained source revisions",
            );
    }
    validateBounds(request.bounds);
}

function validateBounds(value: ViewBuildRequest["bounds"]): void {
    const bounds = value ?? {};
    if (
        !bounds ||
        typeof bounds !== "object" ||
        Object.keys(bounds).some(
            (key) =>
                !["learnedBefore", "occurredFrom", "occurredTo"].includes(key),
        )
    )
        throw new Error("Unsupported temporal bounds");
    for (const date of Object.values(bounds)) {
        if (typeof date !== "string")
            throw new Error("Temporal bounds require ISO timestamps");
        validateIsoTimestamp("temporal bound", date);
    }
    if (
        bounds.occurredFrom &&
        bounds.occurredTo &&
        Date.parse(bounds.occurredFrom) > Date.parse(bounds.occurredTo)
    )
        throw new Error("Occurrence bounds are reversed");
}

export function validateConflictResolution(
    request: ViewConflictResolution,
): void {
    if (
        !request ||
        Object.keys(request).some(
            (key) =>
                ![
                    "corpusId",
                    "conflictId",
                    "expectedHead",
                    "expectedVersion",
                    "expectedRevisionId",
                    "inputFingerprint",
                    "choice",
                    "combined",
                ].includes(key),
        )
    )
        throw new Error(
            "Unsupported conflict resolution; actor is authenticated by the service",
        );
    assertViewIdentifier("conflict ID", request.conflictId);
    assertViewIdentifier("revision ID", request.expectedRevisionId);
    if (
        !/^[0-9a-f]{40}$/.test(request.expectedHead) ||
        !/^[0-9a-f]{64}$/.test(request.inputFingerprint) ||
        !Number.isSafeInteger(request.expectedVersion) ||
        request.expectedVersion < 1 ||
        !["human", "generated", "combined"].includes(request.choice)
    )
        throw new Error("Invalid conflict resolution guards or choice");
    if ((request.choice === "combined") !== (request.combined !== undefined))
        throw new Error(
            "Combined resolution requires exactly one explicit combined candidate",
        );
}
